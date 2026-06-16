/**
 * MainStageProvider — owns the single shared LiveKit Room instance
 * and its connection lifecycle across all route changes.
 *
 * Architecture decision: we use LiveKit's `<LiveKitRoom room={room} connect={false}>`
 * pattern. Passing an external `room` prop means the component acts only as
 * a context bridge — it never calls `room.connect()` or `room.disconnect()`
 * on its own. All connection management lives here.
 *
 * Drop rules:
 *   - User calls leave() via SelfCamFloater ✕ or BottomBar leave
 *   - isAuthenticated flips to false (logout)
 *
 * The Room stays alive across:
 *   - Route changes (MainStage → DMs → any other page)
 *   - React re-renders
 *   - MainStage page mount/unmount cycles
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Room,
  RoomOptions,
  RoomEvent,
  Track,
  DisconnectReason,
  type LocalParticipant,
} from "livekit-client";
import {
  getMainStageState,
  getMainStageToken,
  ApiError,
  type MainStageState,
  type MainStageTokenResponse,
} from "@/lib/api";
import { getSocket } from "@/lib/socket";
import { useAuth } from "@/hooks/useAuth";

// ─── Types ─────────────────────────────────────────────────────────────────

export type MainStageRole = MainStageTokenResponse["role"] | null;

export interface MainStageProviderValue {
  /** The single shared Room instance — stable across re-renders and routes */
  room: Room;

  /** Current connection role for the local user. null = not connected */
  role: MainStageRole;

  /** Latest server-side Main Stage state (mode, spotlight, counts, …) */
  state: MainStageState | null;

  /** LiveKit URL (from the last minted token) */
  livekitUrl: string;

  /** Room name (from the last minted token) */
  roomName: string;

  /** True while the initial token+state fetch is in progress */
  loading: boolean;

  /** Non-null when the token mint or room connect fails */
  error: string | null;

  /** True once the shared Room is connected for this user */
  isJoined: boolean;

  /**
   * Join the Main Stage room as a participant. Entry forces camera on and
   * microphone muted.
   */
  join: () => Promise<void>;

  /**
   * Disconnect the Room completely and clear role/token. Called by the
   * floater ✕ button and on logout.
   */
  leave: () => void;

  /** Clear the error banner */
  clearError: () => void;

  /** UI flag for whether the local camera tile should be active/visible */
  isCammerActive: boolean;
  setIsCammerActive: (active: boolean) => void;

  /** True when this user is allowed to share their screen (PRIME / member / creator) */
  canScreenShare: boolean;

  /** ms epoch when the current free-user session started (null for premium users) */
  sessionStartedAt: number | null;
  /** seconds — total allowed session length for free users (3600), null for premium */
  sessionLimitSeconds: number | null;

  /** When the user hits their free-user cooldown: seconds remaining (null otherwise) */
  cooldownSeconds: number | null;
  clearCooldown: () => void;
}

// ─── Mini Stage Player helpers ─────────────────────────────────────────────

const MINI_MEDIA_IDENTITY = "mainstage-media";
type MiniView = "stage" | "mycam" | "others";

interface MiniTrackInfo {
  identity: string;
  isLocal: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  track: any;
}

function useMiniTracks(room: Room, enabled: boolean): MiniTrackInfo[] {
  const [tracks, setTracks] = useState<MiniTrackInfo[]>([]);
  useEffect(() => {
    if (!enabled) { setTracks([]); return; }
    const collect = () => {
      const result: MiniTrackInfo[] = [];
      room.remoteParticipants.forEach((p) => {
        p.trackPublications.forEach((pub) => {
          if (pub.kind === Track.Kind.Video && pub.track) {
            result.push({ identity: p.identity, isLocal: false, track: pub.track });
          }
        });
      });
      if (room.localParticipant) {
        room.localParticipant.trackPublications.forEach((pub) => {
          if (pub.kind === Track.Kind.Video && pub.track && pub.source !== Track.Source.ScreenShare) {
            result.push({ identity: room.localParticipant.identity, isLocal: true, track: pub.track });
          }
        });
      }
      setTracks(result);
    };
    collect();
    room.on(RoomEvent.TrackSubscribed, collect);
    room.on(RoomEvent.TrackUnsubscribed, collect);
    room.on(RoomEvent.LocalTrackPublished, collect);
    room.on(RoomEvent.LocalTrackUnpublished, collect);
    room.on(RoomEvent.ParticipantConnected, collect);
    room.on(RoomEvent.ParticipantDisconnected, collect);
    return () => {
      room.off(RoomEvent.TrackSubscribed, collect);
      room.off(RoomEvent.TrackUnsubscribed, collect);
      room.off(RoomEvent.LocalTrackPublished, collect);
      room.off(RoomEvent.LocalTrackUnpublished, collect);
      room.off(RoomEvent.ParticipantConnected, collect);
      room.off(RoomEvent.ParticipantDisconnected, collect);
    };
  }, [room, enabled]);
  return tracks;
}

function MiniVideoElement({ track }: { track: unknown }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !track) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const t = track as any;
    if (typeof t.attach === "function") t.attach(el);
    return () => { try { if (typeof t.detach === "function") t.detach(el); } catch { /* noop */ } };
  }, [track]);
  return <video ref={ref} autoPlay playsInline muted className="w-full h-full object-cover" />;
}

function MiniUrlVideo({ src, playing }: { src: string; playing: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !src) return;
    el.src = src;
    el.load();
    if (playing) el.play().catch(() => {});
    return () => { el.pause(); el.src = ""; };
  }, [src, playing]);
  return <video ref={ref} playsInline muted loop className="w-full h-full object-cover" />;
}

// ─── Room singleton ────────────────────────────────────────────────────────

const ROOM_OPTIONS: RoomOptions = {
  adaptiveStream: true,
  dynacast: true,
  publishDefaults: { simulcast: true },
};

// The Room object is created once outside React so it truly never changes
// across hot-module reloads in dev or StrictMode double-invocations in prod.
const sharedRoom = new Room(ROOM_OPTIONS);

// ─── Context ───────────────────────────────────────────────────────────────

const MainStageContext = createContext<MainStageProviderValue | null>(null);

export function useMainStageRoom(): MainStageProviderValue {
  const ctx = useContext(MainStageContext);
  if (!ctx) {
    throw new Error("useMainStageRoom must be used inside <MainStageProvider>");
  }
  return ctx;
}

// ─── Provider ──────────────────────────────────────────────────────────────

const DEFAULT_LIVEKIT_URL =
  (typeof import.meta !== "undefined" &&
    (import.meta as { env?: Record<string, string> }).env?.VITE_LIVEKIT_URL) ||
  "wss://livekit.pnptv.app";
const REALTIME_SESSION_KEY = "pnptv:active-realtime-session";

export function MainStageProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, user } = useAuth();

  const [role, setRole] = useState<MainStageRole>(null);
  const [state, setState] = useState<MainStageState | null>(null);
  const [livekitUrl, setLivekitUrl] = useState(DEFAULT_LIVEKIT_URL);
  const [roomName, setRoomName] = useState("main-stage-prime");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isJoined, setIsJoined] = useState(false);
  const [isCammerActive, setIsCammerActive] = useState(false);
  const [canScreenShare, setCanScreenShare] = useState(false);
  const [sessionStartedAt, setSessionStartedAt] = useState<number | null>(null);
  const [sessionLimitSeconds, setSessionLimitSeconds] = useState<number | null>(null);
  const [cooldownSeconds, setCooldownSeconds] = useState<number | null>(null);
  const roleRef = useRef<MainStageRole>(null);
  const roomNameRef = useRef("main-stage-prime");
  const userIdRef = useRef<string | null>(null);
  const joinInFlightRef = useRef<Promise<void> | null>(null);
  const diagnosticSessionIdRef = useRef(
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `ms-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  );

  // The current live LiveKit token — needed to reconnect after a role change.
  const tokenRef = useRef<string | null>(null);
  // Whether the Room is intentionally connected (provider owns this state).
  const intentConnectedRef = useRef(false);
  // Prevents state updates after unmount.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    roleRef.current = role;
  }, [role]);

  useEffect(() => {
    roomNameRef.current = roomName;
  }, [roomName]);

  useEffect(() => {
    userIdRef.current = user?.id ?? null;
  }, [user?.id]);

  // ── Token refresh timer ──────────────────────────────────────────────────
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // tokenTtlSeconds — how long until the current token expires.
  // Refresh 30s before expiry (minimum 30s ahead to avoid races).
  // For free users (1h TTL), this fires at ~59:30 and issues a new token
  // or a 429 cooldown response.
  const scheduleTokenRefresh = useCallback((tokenTtlSeconds = 6 * 3600) => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    const refreshInMs = Math.max(30_000, (tokenTtlSeconds - 30) * 1000);
    refreshTimerRef.current = setTimeout(async () => {
      if (!mountedRef.current) return;
      try {
        const res = await getMainStageToken();
        if (!mountedRef.current) return;
        tokenRef.current = res.token;
        setLivekitUrl(res.livekitUrl);
        setRoomName(res.roomName);
        setRole(res.role);
        if (res.canScreenShare !== undefined) setCanScreenShare(res.canScreenShare);
        if (res.sessionStartedAt !== undefined) setSessionStartedAt(res.sessionStartedAt);
        if (res.sessionLimitSeconds !== undefined) setSessionLimitSeconds(res.sessionLimitSeconds);
        if (intentConnectedRef.current && sharedRoom.state === "disconnected") {
          await sharedRoom.connect(res.livekitUrl, res.token);
        }
        scheduleTokenRefresh(res.sessionLimitSeconds ?? 6 * 3600);
      } catch (err: unknown) {
        if (err instanceof ApiError && err.status === 429 && err.code === 'FREE_USER_COOLDOWN') {
          if (mountedRef.current) {
            setCooldownSeconds(err.details.cooldownSeconds ?? 1800);
            leave('free-user-cooldown');
          }
          return;
        }
        const is403 = err instanceof ApiError && err.status === 403;
        if (is403 && mountedRef.current) {
          setError('Your membership has expired. Please renew to continue.');
          leave('entitlement-expired');
        } else {
          refreshTimerRef.current = setTimeout(() => scheduleTokenRefresh(tokenTtlSeconds), 5 * 60 * 1000);
        }
      }
    }, refreshInMs);
  // leave is stable (defined below with useCallback). Add to deps when hoisting.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, []);

  // ── Internal connect helper ──────────────────────────────────────────────

  const connectRoom = useCallback(async (url: string, token: string) => {
    try {
      intentConnectedRef.current = true;
      await sharedRoom.connect(url, token);
      // Pre-set the session key synchronously here — before setCameraEnabled() runs —
      // so any service-worker controller-change that fires while camera is initialising
      // will see an active session and defer the page reload instead of blowing the
      // LiveKit connection away. The useEffect([isJoined]) path sets the same key later;
      // this is just an earlier, synchronous guard against the race window.
      try { sessionStorage.setItem(REALTIME_SESSION_KEY, "main-stage"); } catch { /* noop */ }
      if (mountedRef.current) setIsJoined(true);
    } catch (err) {
      intentConnectedRef.current = false;
      if (mountedRef.current) setIsJoined(false);
      throw err;
    }
  }, []);

  const emitDiagnostic = useCallback((event: string, extra: Record<string, unknown> = {}) => {
    try {
      const socket = getSocket();
      if (!socket.connected) return;
      socket.emit("mainstage:client-lifecycle", {
        event,
        role: roleRef.current,
        roomName: roomNameRef.current,
        livekitState: sharedRoom.state,
        sessionId: diagnosticSessionIdRef.current,
        pathname: typeof window !== "undefined" ? window.location.pathname : null,
        visibilityState: typeof document !== "undefined" ? document.visibilityState : null,
        userId: userIdRef.current,
        ...extra,
      });
    } catch {
      // Diagnostics must never affect the room lifecycle.
    }
  }, []);

  // ── Force cam-on / mic-muted enforcement (non-admin only) ───────────────
  // Stage rules: every non-admin participant must have camera ON and
  // microphone MUTED at all times. join() already sets the initial state;
  // this listener only re-asserts if the user (or a permission flicker)
  // tries to defeat the rule afterwards. It deliberately runs only on
  // post-connect track events — never an initial sweep — so we never
  // race the connect/publish pipeline.
  useEffect(() => {
    if (!isJoined) return;
    if (!role || role === "admin") return;

    let cancelled = false;
    let enforcing = false;

    const enforce = async () => {
      if (cancelled || enforcing) return;
      // Only act on a fully-connected room. Acting during connect or
      // reconnect can cancel the LiveKit publish pipeline.
      if (sharedRoom.state !== "connected") return;
      enforcing = true;
      try {
        const lp: LocalParticipant = sharedRoom.localParticipant;
        const camPub = lp.getTrackPublication(Track.Source.Camera);
        const micPub = lp.getTrackPublication(Track.Source.Microphone);
        const camOn = !!camPub && !camPub.isMuted;
        const micOn = !!micPub && !micPub.isMuted;
        if (!camOn) {
          try { await lp.setCameraEnabled(true); } catch { /* no permission, etc. */ }
        }
        if (micOn) {
          try { await lp.setMicrophoneEnabled(false); } catch { /* noop */ }
        }
      } finally {
        enforcing = false;
      }
    };

    const onMuted = () => { void enforce(); };
    const onUnmuted = () => { void enforce(); };
    const onUnpublished = () => { void enforce(); };

    sharedRoom.on(RoomEvent.LocalTrackUnpublished, onUnpublished);
    sharedRoom.on(RoomEvent.TrackMuted, onMuted);
    sharedRoom.on(RoomEvent.TrackUnmuted, onUnmuted);

    return () => {
      cancelled = true;
      sharedRoom.off(RoomEvent.LocalTrackUnpublished, onUnpublished);
      sharedRoom.off(RoomEvent.TrackMuted, onMuted);
      sharedRoom.off(RoomEvent.TrackUnmuted, onUnmuted);
    };
  }, [isJoined, role]);

  useEffect(() => {
    const onConnectionStateChanged = (nextState: string) => {
      emitDiagnostic("livekit-connection-state", { nextState });
    };

    sharedRoom.on(RoomEvent.ConnectionStateChanged, onConnectionStateChanged);
    return () => {
      sharedRoom.off(RoomEvent.ConnectionStateChanged, onConnectionStateChanged);
    };
  }, [emitDiagnostic]);

  // Track external (non-user-initiated) disconnects so isJoined stays accurate.
  // leave() sets intentConnectedRef.current = false BEFORE calling sharedRoom.disconnect(),
  // so we skip those here — leave() already resets all state itself.
  useEffect(() => {
    const onDisconnected = (reason?: DisconnectReason) => {
      if (!mountedRef.current) return;
      if (!intentConnectedRef.current) return; // user-initiated leave — already handled
      setIsJoined(false);
      // Log reason so we can diagnose DUPLICATE_IDENTITY vs SIGNAL_CLOSE vs network drop.
      emitDiagnostic("room-disconnected", {
        disconnectReason: reason ?? null,
        disconnectReasonName: reason !== undefined ? DisconnectReason[reason] ?? String(reason) : "none",
      });
    };
    sharedRoom.on(RoomEvent.Disconnected, onDisconnected);
    return () => {
      sharedRoom.off(RoomEvent.Disconnected, onDisconnected);
    };
  }, [emitDiagnostic]);

  // ── Logout cleanup ──────────────────────────────────────────────────────

  useEffect(() => {
    if (isAuthenticated) return;
    // User logged out — disconnect cleanly.
    if (intentConnectedRef.current) {
      intentConnectedRef.current = false;
      tokenRef.current = null;
      setRole(null);
      setIsJoined(false);
      setIsCammerActive(false);
      sharedRoom.disconnect();
    }
  }, [isAuthenticated]);

  useEffect(() => {
    const notifyRealtimeSessionChange = () => {
      window.dispatchEvent(new Event("pnptv:realtime-session-change"));
    };

    try {
      if (isJoined) {
        sessionStorage.setItem(REALTIME_SESSION_KEY, "main-stage");
      } else if (sessionStorage.getItem(REALTIME_SESSION_KEY) === "main-stage") {
        sessionStorage.removeItem(REALTIME_SESSION_KEY);
      }
    } catch {
      // Storage failures should not affect room connectivity.
    }

    notifyRealtimeSessionChange();

    return () => {
      try {
        if (sessionStorage.getItem(REALTIME_SESSION_KEY) === "main-stage") {
          sessionStorage.removeItem(REALTIME_SESSION_KEY);
        }
      } catch {
        // ignore cleanup failures
      }
      notifyRealtimeSessionChange();
    };
  }, [isJoined]);

  useEffect(() => {
    if (!isJoined) return;

    const onVisibilityChange = () => {
      emitDiagnostic("page-visibility", { reason: document.visibilityState });
    };
    const onPageHide = () => {
      emitDiagnostic("pagehide");
    };
    const onBeforeUnload = () => {
      emitDiagnostic("beforeunload");
    };
    const onPageShow = (evt: PageTransitionEvent) => {
      emitDiagnostic("pageshow", { persisted: evt.persisted === true });
    };
    const onFreeze = () => {
      emitDiagnostic("freeze");
    };
    const onResume = () => {
      emitDiagnostic("resume");
    };
    const onOnline = () => {
      emitDiagnostic("network-online");
    };
    const onOffline = () => {
      emitDiagnostic("network-offline");
    };
    const onNavigation = (evt: Event) => {
      const detail = evt instanceof CustomEvent ? evt.detail : undefined;
      emitDiagnostic("navigation", {
        reason: typeof detail?.kind === "string" ? detail.kind : "unknown",
        href: typeof detail?.href === "string" ? detail.href : null,
        prevPath: typeof detail?.prevPath === "string" ? detail.prevPath : null,
        nextPath: typeof detail?.nextPath === "string" ? detail.nextPath : null,
      });
    };
    const onSwUpdateStatus = (evt: Event) => {
      const detail = evt instanceof CustomEvent ? evt.detail : undefined;
      emitDiagnostic("sw-update-status", {
        reason: typeof detail?.status === "string" ? detail.status : "unknown",
      });
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("pageshow", onPageShow);
    document.addEventListener("freeze", onFreeze as EventListener);
    document.addEventListener("resume", onResume as EventListener);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener("pnptv:navigation", onNavigation as EventListener);
    window.addEventListener("pnptv:sw-update-status", onSwUpdateStatus as EventListener);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("pageshow", onPageShow);
      document.removeEventListener("freeze", onFreeze as EventListener);
      document.removeEventListener("resume", onResume as EventListener);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("pnptv:navigation", onNavigation as EventListener);
      window.removeEventListener("pnptv:sw-update-status", onSwUpdateStatus as EventListener);
    };
  }, [emitDiagnostic, isJoined]);

  // ── REST state polling for unauthenticated viewers ───────────────────────
  // Authenticated users get state via socket; unauthenticated users are skipped
  // by the socket subscription below, so we poll REST for them instead.

  useEffect(() => {
    if (isAuthenticated) return; // authenticated users get state via socket
    getMainStageState()
      .then(s => { if (mountedRef.current) setState(s); })
      .catch(() => {});
    const id = setInterval(() => {
      getMainStageState()
        .then(s => { if (mountedRef.current) setState(s); })
        .catch(() => {});
    }, 30_000);
    return () => clearInterval(id);
  }, [isAuthenticated]);

  // ── Socket state subscription ────────────────────────────────────────────

  useEffect(() => {
    if (!isAuthenticated) return;

    const socket = getSocket();
    if (!socket.connected) socket.connect();

    const onState = (payload: MainStageState) => {
      if (mountedRef.current) setState(payload);
    };

    const onError = (payload: { code?: string; message?: string }) => {
      if (!mountedRef.current) return;
      const msg =
        payload?.message ||
        (payload?.code === "CAMMER_CAP_REACHED"
          ? "Main Stage is full right now. Try again in a moment."
          : "Main Stage error");
      setError(msg);
    };

    const onConnect = () => {
      emitDiagnostic("socket-connect");
      getMainStageState()
        .then((s) => {
          if (mountedRef.current) setState(s);
        })
        .catch(() => {});
    };
    const onDisconnect = (reason: string) => {
      emitDiagnostic("socket-disconnect", { reason });
    };

    socket.on("mainstage:state", onState);
    socket.on("mainstage:error", onError);
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);

    return () => {
      socket.off("mainstage:state", onState);
      socket.off("mainstage:error", onError);
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
    };
  }, [emitDiagnostic, isAuthenticated]);

  // ── Public API ───────────────────────────────────────────────────────────

  const join = useCallback(async () => {
    if (joinInFlightRef.current) return joinInFlightRef.current;

    const joinPromise = (async () => {
      if (!isAuthenticated) {
        if (mountedRef.current) setError("You must be logged in to join Main Stage");
        return;
      }
      try {
        const visibility = typeof document !== "undefined" ? document.visibilityState : "visible";
        if (visibility !== "visible") {
          emitDiagnostic("join-deferred-hidden", { reason: visibility });
          if (mountedRef.current) setError("Switch to this tab before joining Main Stage.");
          return;
        }

        emitDiagnostic("join-start");
        setLoading(true);
        setError(null);
        if (intentConnectedRef.current && sharedRoom.state !== "disconnected") {
          const stateRes = await getMainStageState();
          if (mountedRef.current) setState(stateRes);
          setIsJoined(true);
          emitDiagnostic("join-short-circuit", { reason: "already-connected" });
          return;
        }
        let stateRes: MainStageState;
        let res: MainStageTokenResponse;
        try {
          [stateRes, res] = await Promise.all([getMainStageState(), getMainStageToken()]);
        } catch (tokenErr: unknown) {
          if (!mountedRef.current) return;
          if (tokenErr instanceof ApiError && tokenErr.status === 429 && tokenErr.code === 'FREE_USER_COOLDOWN') {
            setCooldownSeconds(tokenErr.details.cooldownSeconds ?? 1800);
            setLoading(false);
            return;
          }
          throw tokenErr;
        }
        if (!mountedRef.current) return;

        tokenRef.current = res.token;
        setLivekitUrl(res.livekitUrl);
        setRoomName(res.roomName);
        setRole(res.role);
        setCanScreenShare(res.canScreenShare ?? false);
        if (res.sessionStartedAt !== undefined) setSessionStartedAt(res.sessionStartedAt);
        if (res.sessionLimitSeconds !== undefined) setSessionLimitSeconds(res.sessionLimitSeconds);
        setCooldownSeconds(null);
        setState(stateRes);
        emitDiagnostic("token-minted", { tokenRole: res.role });

        // Join the room, then force camera on and mic muted for entry.
        await connectRoom(res.livekitUrl, res.token);

        // Guard: if the tab became hidden during the LiveKit handshake, the browser
        // will deny getUserMedia. Bail early with a clear error instead of a silent
        // permission denial that leaves the room in a half-connected state.
        if (typeof document !== "undefined" && document.visibilityState !== "visible") {
          intentConnectedRef.current = false;
          await sharedRoom.disconnect();
          if (mountedRef.current) {
            setIsJoined(false);
            setError("Please switch to this tab before joining Main Stage.");
          }
          emitDiagnostic("join-abort-tab-hidden", { reason: "hidden-after-connect" });
          return;
        }

        try {
          await sharedRoom.localParticipant.setCameraEnabled(true);
        } catch (camErr) {
          // Camera permission denied or device unavailable — surface a clear message
          // instead of letting this propagate to the outer catch and showing a generic error.
          const msg =
            camErr instanceof Error && camErr.message
              ? camErr.message
              : "Camera access was denied. Please allow camera access and try again.";
          // Reset connection intent so subsequent join() calls don't short-circuit.
          intentConnectedRef.current = false;
          if (mountedRef.current) {
            setError(msg);
            setIsJoined(false);
          }
          emitDiagnostic("camera-error", { reason: msg });
          // Leave the room cleanly — we joined but can't publish.
          await sharedRoom.disconnect();
          return;
        }
        try {
          await sharedRoom.localParticipant.setMicrophoneEnabled(false);
        } catch {
          // Member/guest tokens may not have audio publish permission.
        }
        if (mountedRef.current) setIsCammerActive(true);
        emitDiagnostic("join-connected");

        scheduleTokenRefresh(res.sessionLimitSeconds ?? 6 * 3600);
      } catch (err) {
        if (mountedRef.current) {
          setError(err instanceof Error ? err.message : "Failed to join Main Stage");
        }
        emitDiagnostic("join-error", {
          reason: err instanceof Error ? err.message : "Failed to join Main Stage",
        });
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    })();

    joinInFlightRef.current = joinPromise;
    try {
      await joinPromise;
    } finally {
      if (joinInFlightRef.current === joinPromise) {
        joinInFlightRef.current = null;
      }
    }
  }, [connectRoom, emitDiagnostic, isAuthenticated, scheduleTokenRefresh]);

  const leave = useCallback((reason = "explicit-leave") => {
    emitDiagnostic("leave", { reason });
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    joinInFlightRef.current = null;
    intentConnectedRef.current = false;
    tokenRef.current = null;
    setRole(null);
    setError(null);
    setLoading(false);
    setIsJoined(false);
    setIsCammerActive(false);
    setCanScreenShare(false);
    setSessionStartedAt(null);
    setSessionLimitSeconds(null);

    // Notify server before disconnecting.
    try {
      const socket = getSocket();
      if (socket.connected) socket.emit("mainstage:leave-cammer");
    } catch {
      // non-fatal
    }

    sharedRoom.disconnect();
  }, [emitDiagnostic]);

  const clearError = useCallback(() => setError(null), []);
  const clearCooldown = useCallback(() => setCooldownSeconds(null), []);

  // ── Mini player state ──────────────────────────────────────────────────────
  const [miniDismissed, setMiniDismissed] = useState(false);
  const [miniView, setMiniView] = useState<MiniView>("stage");
  const [miniPos, setMiniPos] = useState({ x: 0, y: 0 });
  const miniDragOrigin = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null);
  const [miniPathname, setMiniPathname] = useState(() =>
    typeof window !== "undefined" ? window.location.pathname : "/"
  );
  const isOnMainStage = miniPathname.startsWith("/main-stage") || miniPathname === "/subscribe" || miniPathname === "/lifetime100";
  const hasActiveMiniMedia =
    state?.media?.kind === "video" && Boolean(state?.media?.playing) && Boolean(state?.media?.src);

  // Collect tracks early (before showMiniPlayer) so we can check if cammers are present.
  // useMiniTracks only subscribes when isJoined, so this is safe even when disconnected.
  const miniTracks = useMiniTracks(sharedRoom, isJoined);

  const miniOtherTracksCount = miniTracks.filter((t) => !t.isLocal && t.identity !== MINI_MEDIA_IDENTITY).length;

  // Only surface the mini player when there is something meaningful to watch:
  // admin is playing media OR live cammers are present in the room.
  const hasMeaningfulContent = hasActiveMiniMedia || (isJoined && miniOtherTracksCount > 0);

  // Reset dismiss only when leaving main-stage while content is actually live —
  // prevents the player from hijacking the screen after every empty-stage visit.
  useEffect(() => {
    const onNav = () => {
      const p = window.location.pathname;
      setMiniPathname(p);
      if (!p.startsWith("/main-stage") && hasMeaningfulContent) {
        setMiniDismissed(false);
      }
    };
    window.addEventListener("pnptv:navigation", onNav);
    window.addEventListener("popstate", onNav);
    return () => {
      window.removeEventListener("pnptv:navigation", onNav);
      window.removeEventListener("popstate", onNav);
    };
  }, [hasMeaningfulContent]);

  // Surface the player when admin starts a new broadcast so users don't miss live content,
  // but only if they are not on the main stage page itself.
  const prevHasActiveMiniMediaRef = useRef(hasActiveMiniMedia);
  useEffect(() => {
    if (hasActiveMiniMedia && !prevHasActiveMiniMediaRef.current && !isOnMainStage) {
      setMiniDismissed(false);
    }
    prevHasActiveMiniMediaRef.current = hasActiveMiniMedia;
  }, [hasActiveMiniMedia, isOnMainStage]);

  const showMiniPlayer = isAuthenticated && !isOnMainStage && !miniDismissed && hasMeaningfulContent;
  const miniMediaTrack = miniTracks.find((t) => t.identity === MINI_MEDIA_IDENTITY);
  const miniLocalTrack = miniTracks.find((t) => t.isLocal);
  const miniOtherTracks = miniTracks.filter((t) => !t.isLocal && t.identity !== MINI_MEDIA_IDENTITY);

  const value = useMemo<MainStageProviderValue>(
    () => ({
      room: sharedRoom,
      role,
      state,
      livekitUrl,
      roomName,
      loading,
      error,
      isJoined,
      join,
      leave,
      clearError,
      isCammerActive,
      setIsCammerActive,
      canScreenShare,
      sessionStartedAt,
      sessionLimitSeconds,
      cooldownSeconds,
      clearCooldown,
    }),
    [
      role,
      state,
      livekitUrl,
      roomName,
      loading,
      error,
      isJoined,
      join,
      leave,
      clearError,
      isCammerActive,
      canScreenShare,
      sessionStartedAt,
      sessionLimitSeconds,
      cooldownSeconds,
      clearCooldown,
    ]
  );

  return (
    <MainStageContext.Provider value={value}>
      {children}

      {/* ── Persistent mini player — survives route changes ── */}
      {showMiniPlayer && (
        <div
          className="fixed z-[200] select-none touch-none"
          style={{
            bottom: 88,
            right: 16,
            transform: `translate(${miniPos.x}px, ${miniPos.y}px)`,
            width: 210,
            borderRadius: 14,
            overflow: "hidden",
            boxShadow: "0 8px 32px rgba(0,0,0,0.65), 0 0 0 1px rgba(255,255,255,0.09)",
            background: "#0d0d0f",
            cursor: miniDragOrigin.current ? "grabbing" : "grab",
          }}
          onPointerDown={(e) => {
            if ((e.target as HTMLElement).closest("[data-no-drag]")) return;
            miniDragOrigin.current = { px: e.clientX, py: e.clientY, ox: miniPos.x, oy: miniPos.y };
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (!miniDragOrigin.current) return;
            setMiniPos({
              x: miniDragOrigin.current.ox + (e.clientX - miniDragOrigin.current.px),
              y: miniDragOrigin.current.oy + (e.clientY - miniDragOrigin.current.py),
            });
          }}
          onPointerUp={() => { miniDragOrigin.current = null; }}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between px-2.5 py-1.5"
            style={{ background: "rgba(0,0,0,0.88)", borderBottom: "1px solid rgba(255,255,255,0.07)" }}
          >
            <span className="text-[11px] font-bold tracking-wide" style={{ color: "#D4007A" }}>
              Main Stage
            </span>
            <div className="flex items-center gap-2" data-no-drag>
              <a
                href="/main-stage"
                className="text-white/35 hover:text-white/75 transition-colors"
                aria-label="Open Main Stage"
                style={{ lineHeight: 0 }}
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
              <button
                onClick={() => setMiniDismissed(true)}
                className="text-white/35 hover:text-white/75 transition-colors"
                aria-label="Close mini player"
                style={{ lineHeight: 0 }}
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Video area — 16:9 */}
          <div className="relative bg-black" style={{ paddingTop: "56.25%" }}>
            <div className="absolute inset-0">
              {miniView === "stage" && (
                miniMediaTrack ? (
                  <MiniVideoElement track={miniMediaTrack.track} />
                ) : hasActiveMiniMedia && state?.media?.src ? (
                  <MiniUrlVideo src={state.media.src} playing={Boolean(state.media.playing)} />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <svg className="w-6 h-6 text-white/12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.2} aria-hidden>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 01-1.125-1.125M3.375 19.5h1.5C5.496 19.5 6 18.996 6 18.375m-3.75 0V5.625m0 12.75v-1.5c0-.621.504-1.125 1.125-1.125m18.375 2.625V5.625m0 12.75c0 .621-.504 1.125-1.125 1.125m1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125m0 3.75h-1.5A1.125 1.125 0 0118 18.375M20.625 4.5H3.375m17.25 0c.621 0 1.125.504 1.125 1.125M20.625 4.5h-1.5C18.504 4.5 18 5.004 18 5.625m3.75 0v1.5c0 .621-.504 1.125-1.125 1.125M3.375 4.5c-.621 0-1.125.504-1.125 1.125M3.375 4.5h1.5C5.496 4.5 6 5.004 6 5.625m-3.75 0v1.5c0 .621.504 1.125 1.125 1.125m0 0h1.5m-1.5 0c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125m1.5-3.75C5.496 8.25 6 8.754 6 9.375v1.5m0-5.25v5.25m0-5.25C6 5.004 6.504 4.5 7.125 4.5h9.75c.621 0 1.125.504 1.125 1.125m1.125 2.625h1.5m-1.5 0A1.125 1.125 0 0118 9.375v1.5m1.5-3.75C19.496 8.25 20 8.754 20 9.375v1.5m0-5.25v5.25m0-5.25C20 5.004 19.496 4.5 18.875 4.5M9 11.25v1.5M12 9v3.75m3-6v6" />
                    </svg>
                  </div>
                )
              )}
              {miniView === "mycam" && (
                miniLocalTrack ? (
                  <MiniVideoElement track={miniLocalTrack.track} />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-white/25 text-[10px]">
                    Camera off
                  </div>
                )
              )}
              {miniView === "others" && (
                miniOtherTracks.length > 0 ? (
                  <div className="w-full h-full flex">
                    {miniOtherTracks.slice(0, 2).map((t) => (
                      <div key={t.identity} className="flex-1 h-full overflow-hidden">
                        <MiniVideoElement track={t.track} />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-white/25 text-[10px]">
                    No cammers yet
                  </div>
                )
              )}
            </div>
          </div>

          {/* View tabs */}
          <div
            className="flex"
            style={{ background: "rgba(0,0,0,0.90)", borderTop: "1px solid rgba(255,255,255,0.06)" }}
            data-no-drag
          >
            {(["stage", "mycam", "others"] as MiniView[]).map((v) => (
              <button
                key={v}
                onClick={() => setMiniView(v)}
                className="flex-1 py-1.5 text-[10px] font-semibold transition-colors"
                style={{
                  color: miniView === v ? "#D4007A" : "rgba(255,255,255,0.32)",
                  borderBottom: miniView === v ? "2px solid #D4007A" : "2px solid transparent",
                }}
              >
                {v === "stage" ? "Stage" : v === "mycam" ? "My Cam" : "Others"}
              </button>
            ))}
          </div>
        </div>
      )}
    </MainStageContext.Provider>
  );
}
