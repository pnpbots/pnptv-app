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
  type LocalTrackPublication,
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

export function MainStageProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();

  const [role, setRole] = useState<MainStageRole>(null);
  const [state, setState] = useState<MainStageState | null>(null);
  const [livekitUrl, setLivekitUrl] = useState(DEFAULT_LIVEKIT_URL);
  const [roomName, setRoomName] = useState("main-stage-prime");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isJoined, setIsJoined] = useState(false);
  const [isCammerActive, setIsCammerActive] = useState(false);

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
        // If the room is connected, reconnect with the fresh token so
        // the old token doesn't expire mid-session.
        if (intentConnectedRef.current && sharedRoom.state !== "disconnected") {
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

  // ── Force cam-on / mic-muted enforcement (non-admin only) ───────────────
  // Stage rules: every non-admin participant must have camera ON and
  // microphone MUTED at all times. We re-assert on any local-track event
  // so a user (or a permission flicker) cannot defeat the rule.
  useEffect(() => {
    if (!isJoined) return;
    if (role !== "participant") return; // admins keep manual control

    let cancelled = false;
    let enforcing = false;

    const enforce = async () => {
      if (cancelled || enforcing) return;
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

    const onMuted = (_pub: LocalTrackPublication) => { void enforce(); };
    const onUnmuted = (_pub: LocalTrackPublication) => { void enforce(); };
    const onPublished = () => { void enforce(); };
    const onUnpublished = () => { void enforce(); };

    sharedRoom.on(RoomEvent.LocalTrackPublished, onPublished);
    sharedRoom.on(RoomEvent.LocalTrackUnpublished, onUnpublished);
    sharedRoom.on(RoomEvent.TrackMuted, onMuted);
    sharedRoom.on(RoomEvent.TrackUnmuted, onUnmuted);

    // Initial sweep to cover the case where state drifts before listeners attach.
    void enforce();

    return () => {
      cancelled = true;
      sharedRoom.off(RoomEvent.LocalTrackPublished, onPublished);
      sharedRoom.off(RoomEvent.LocalTrackUnpublished, onUnpublished);
      sharedRoom.off(RoomEvent.TrackMuted, onMuted);
      sharedRoom.off(RoomEvent.TrackUnmuted, onUnmuted);
    };
  }, [isJoined, role]);

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
          ? "Cammer slots are full right now. Try again in a moment."
          : "Main Stage error");
      setError(msg);
    };

    const onConnect = () => {
      getMainStageState()
        .then((s) => {
          if (mountedRef.current) setState(s);
        })
        .catch(() => {});
    };

    socket.on("mainstage:state", onState);
    socket.on("mainstage:error", onError);
    socket.on("connect", onConnect);

    return () => {
      socket.off("mainstage:state", onState);
      socket.off("mainstage:error", onError);
      socket.off("connect", onConnect);
    };
  }, [isAuthenticated]);

  // ── Public API ───────────────────────────────────────────────────────────

  const join = useCallback(async () => {
    if (!isAuthenticated) {
      if (mountedRef.current) setError("You must be logged in to join Main Stage");
      return;
    }
    try {
      setLoading(true);
      setError(null);
      if (intentConnectedRef.current && sharedRoom.state !== "disconnected") {
        const stateRes = await getMainStageState();
        if (mountedRef.current) setState(stateRes);
        setIsJoined(true);
        return;
      }
      const [stateRes, res] = await Promise.all([getMainStageState(), getMainStageToken()]);
      if (!mountedRef.current) return;

      tokenRef.current = res.token;
      setLivekitUrl(res.livekitUrl);
      setRoomName(res.roomName);
      setRole(res.role);
      setState(stateRes);

      // Join the room, then force camera on and mic muted for entry.
      await connectRoom(res.livekitUrl, res.token);
      await sharedRoom.localParticipant.setCameraEnabled(true);
      await sharedRoom.localParticipant.setMicrophoneEnabled(false);
      if (mountedRef.current) setIsCammerActive(true);

      scheduleTokenRefresh();
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : "Failed to join Main Stage");
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [connectRoom, isAuthenticated, scheduleTokenRefresh]);

  const leave = useCallback(() => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
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
  }, []);

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
