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
  type LocalParticipant,
} from "livekit-client";
import {
  getMainStageState,
  getMainStageToken,
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

  const scheduleTokenRefresh = useCallback(() => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    // Refresh 30 min before the 6h token expires.
    const REFRESH_MS = (6 * 60 - 30) * 60 * 1000;
    refreshTimerRef.current = setTimeout(async () => {
      if (!mountedRef.current) return;
      try {
        const res = await getMainStageToken();
        if (!mountedRef.current) return;
        tokenRef.current = res.token;
        setLivekitUrl(res.livekitUrl);
        setRoomName(res.roomName);
        setRole(res.role);
        // Only reconnect if the room has fully disconnected. Calling connect()
        // on an already-connected room forces a full reconnect cycle, dropping
        // all published tracks for every viewer for ~1-2s. LiveKit handles
        // token refresh internally when the room is still connected — we just
        // need to store the new token so it's available for the next reconnect.
        if (intentConnectedRef.current && sharedRoom.state === "disconnected") {
          await sharedRoom.connect(res.livekitUrl, res.token);
        }
        scheduleTokenRefresh();
      } catch {
        // Retry in 5 min on refresh failure.
        refreshTimerRef.current = setTimeout(scheduleTokenRefresh, 5 * 60 * 1000);
      }
    }, REFRESH_MS);
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
    const onDisconnected = () => {
      if (!mountedRef.current) return;
      if (!intentConnectedRef.current) return; // user-initiated leave — already handled
      setIsJoined(false);
    };
    sharedRoom.on(RoomEvent.Disconnected, onDisconnected);
    return () => {
      sharedRoom.off(RoomEvent.Disconnected, onDisconnected);
    };
  }, []);

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
        const [stateRes, res] = await Promise.all([getMainStageState(), getMainStageToken()]);
        if (!mountedRef.current) return;

        tokenRef.current = res.token;
        setLivekitUrl(res.livekitUrl);
        setRoomName(res.roomName);
        setRole(res.role);
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

        scheduleTokenRefresh();
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
    ]
  );

  return (
    <MainStageContext.Provider value={value}>
      {children}
    </MainStageContext.Provider>
  );
}
