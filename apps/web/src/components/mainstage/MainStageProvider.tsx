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
import { Room, RoomOptions } from "livekit-client";
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

  /**
   * Mint a cammer token (atomically reserves a slot via Redis Lua) and
   * connect the Room as a publisher. Calling this is idempotent — if the
   * Room is already connected as cammer, it re-mints so the token timer
   * resets but does NOT disconnect+reconnect.
   */
  joinAsCammer: () => Promise<void>;

  /**
   * Demote back to viewer: tells the server to remove us from the spotlight
   * queue, re-mints a viewer token, and reconnects the Room with that token.
   */
  leaveCammer: () => Promise<void>;

  /**
   * Disconnect the Room completely and clear role/token. Called by the
   * floater ✕ button and on logout.
   */
  leave: () => void;

  /** Clear the error banner */
  clearError: () => void;
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // The current live LiveKit token — needed to reconnect after a role change.
  const tokenRef = useRef<string | null>(null);
  // Track whether the current slot was reserved as cammer so token refresh
  // uses the right grant.
  const tokenAsCammerRef = useRef(false);
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
        const res = await getMainStageToken({ asCammer: tokenAsCammerRef.current });
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
    } catch (err) {
      intentConnectedRef.current = false;
      throw err;
    }
  }, []);

  // ── Initial token + state fetch ─────────────────────────────────────────

  useEffect(() => {
    if (!isAuthenticated) return;

    let cancelled = false;

    async function init() {
      setLoading(true);
      setError(null);
      try {
        const [stateRes, tokenRes] = await Promise.all([
          getMainStageState(),
          getMainStageToken({ asCammer: false }),
        ]);
        if (cancelled) return;
        tokenRef.current = tokenRes.token;
        setLivekitUrl(tokenRes.livekitUrl);
        setRoomName(tokenRes.roomName);
        setRole(tokenRes.role);
        setState(stateRes);
        tokenAsCammerRef.current = false;

        // Connect the room as viewer immediately so the socket is live
        // and remote participants are visible without clicking anything.
        await connectRoom(tokenRes.livekitUrl, tokenRes.token);
        if (!cancelled) scheduleTokenRefresh();
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to connect to Main Stage");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    init();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, connectRoom, scheduleTokenRefresh]);

  // ── Logout cleanup ──────────────────────────────────────────────────────

  useEffect(() => {
    if (isAuthenticated) return;
    // User logged out — disconnect cleanly.
    if (intentConnectedRef.current) {
      intentConnectedRef.current = false;
      tokenRef.current = null;
      tokenAsCammerRef.current = false;
      setRole(null);
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

  const joinAsCammer = useCallback(async () => {
    try {
      setError(null);
      const res = await getMainStageToken({ asCammer: true });
      if (!mountedRef.current) return;

      tokenRef.current = res.token;
      setLivekitUrl(res.livekitUrl);
      setRoomName(res.roomName);
      setRole(res.role);
      tokenAsCammerRef.current = true;

      // Reconnect with the cammer token so LiveKit grants publish permissions.
      await connectRoom(res.livekitUrl, res.token);

      // Enable cam + mic after the Room is connected.
      await sharedRoom.localParticipant.setCameraEnabled(true);
      await sharedRoom.localParticipant.setMicrophoneEnabled(true);

      scheduleTokenRefresh();

      // Best-effort socket notification for queue broadcast.
      try {
        const socket = getSocket();
        if (!socket.connected) socket.connect();
        socket.emit("mainstage:join-cammer");
      } catch {
        // non-fatal
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : "Failed to join as cammer");
      }
    }
  }, [connectRoom, scheduleTokenRefresh]);

  const leaveCammer = useCallback(async () => {
    tokenAsCammerRef.current = false;

    // Turn off cam + mic before demoting.
    try {
      await sharedRoom.localParticipant.setCameraEnabled(false);
      await sharedRoom.localParticipant.setMicrophoneEnabled(false);
    } catch {
      // non-fatal — the token demotion below is the authoritative step
    }

    // Notify server to remove us from the spotlight queue.
    try {
      const socket = getSocket();
      if (socket.connected) socket.emit("mainstage:leave-cammer");
    } catch {
      // non-fatal
    }

    // Re-mint as viewer and reconnect so server revokes publish permissions.
    try {
      setError(null);
      const res = await getMainStageToken({ asCammer: false });
      if (!mountedRef.current) return;
      tokenRef.current = res.token;
      setLivekitUrl(res.livekitUrl);
      setRoomName(res.roomName);
      setRole(res.role);
      await connectRoom(res.livekitUrl, res.token);
      scheduleTokenRefresh();
    } catch (err) {
      if (mountedRef.current) {
        setError(
          err instanceof Error
            ? err.message
            : "Failed to leave cammer — please reload if the issue persists"
        );
      }
    }
  }, [connectRoom, scheduleTokenRefresh]);

  const leave = useCallback(() => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    intentConnectedRef.current = false;
    tokenRef.current = null;
    tokenAsCammerRef.current = false;
    setRole(null);
    setError(null);

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
      joinAsCammer,
      leaveCammer,
      leave,
      clearError,
    }),
    [role, state, livekitUrl, roomName, loading, error, joinAsCammer, leaveCammer, leave, clearError]
  );

  return (
    <MainStageContext.Provider value={value}>
      {children}
    </MainStageContext.Provider>
  );
}
