import { useCallback, useEffect, useRef, useState } from "react";
import {
  getMainStageState,
  getMainStageToken,
  setMainStageMode,
  setMainStageMedia,
  setMainStageVolume,
  setMainStageSpotlight,
  moderateMainStage,
  type MainStageState,
  type MainStageTokenResponse,
} from "@/lib/api";
import { getSocket } from "@/lib/socket";
import { useAuth } from "@/hooks/useAuth";

export type { MainStageState };

interface UseMainStageReturn {
  state: MainStageState | null;
  isAdmin: boolean;
  canBeCammer: boolean;
  token: string | null;
  livekitUrl: string;
  roomName: string;
  role: MainStageTokenResponse["role"] | null;
  loading: boolean;
  error: string | null;
  joinAsCammer: () => Promise<void>;
  leaveCammer: () => void;
  admin: {
    setMode: (mode: MainStageState["mode"]) => Promise<void>;
    setMedia: (payload: {
      kind: "video" | "music" | "off";
      src?: string | null;
      playing?: boolean;
      volume?: number;
    }) => Promise<void>;
    setVolume: (payload: { cams?: number; media?: number }) => Promise<void>;
    setSpotlight: (cammer: string) => Promise<void>;
    moderate: (action: "skip" | "mute" | "kick", identity: string) => Promise<void>;
  };
}

const ROOM_NAME = "main-stage-prime";

export function useMainStage(): UseMainStageReturn {
  const { isAdmin: authIsAdmin, isAuthenticated } = useAuth();

  const [state, setState] = useState<MainStageState | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [livekitUrl, setLivekitUrl] = useState(
    (typeof import.meta !== "undefined" && (import.meta as { env?: Record<string, string> }).env?.VITE_LIVEKIT_URL) ||
    "wss://livekit.pnptv.app"
  );
  const [roomName, setRoomName] = useState(ROOM_NAME);
  const [role, setRole] = useState<MainStageTokenResponse["role"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Track whether the current token was minted as cammer so the refresh
  // timer re-mints with the same grants.
  const tokenAsCammerRef = useRef(false);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Schedule a silent re-mint 30 min before the 6h token expires so a session
  // open past the TTL doesn't get silently kicked off LiveKit.
  const scheduleTokenRefresh = useCallback(() => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    const REFRESH_MS = (6 * 60 - 30) * 60 * 1000; // 5h30m
    refreshTimerRef.current = setTimeout(async () => {
      if (!mountedRef.current) return;
      try {
        const res = await getMainStageToken({ asCammer: tokenAsCammerRef.current });
        if (!mountedRef.current) return;
        setToken(res.token);
        setLivekitUrl(res.livekitUrl);
        setRoomName(res.roomName);
        setRole(res.role);
        scheduleTokenRefresh();
      } catch {
        // If refresh fails, retry in 5 minutes. The user can also hit
        // "Go on cam" / reload to force a new token.
        refreshTimerRef.current = setTimeout(scheduleTokenRefresh, 5 * 60 * 1000);
      }
    }, REFRESH_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, []);

  // Initial state + viewer token fetch
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
        setState(stateRes);
        setToken(tokenRes.token);
        setLivekitUrl(tokenRes.livekitUrl);
        setRoomName(tokenRes.roomName);
        setRole(tokenRes.role);
        tokenAsCammerRef.current = false;
        scheduleTokenRefresh();
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to connect to Main Stage");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    init();
    return () => { cancelled = true; };
  }, [isAuthenticated]);

  // Subscribe to socket state updates
  useEffect(() => {
    if (!isAuthenticated) return;

    const socket = getSocket();
    if (!socket.connected) socket.connect();

    function onState(payload: MainStageState) {
      if (mountedRef.current) setState(payload);
    }

    socket.on("mainstage:state", onState);

    return () => {
      socket.off("mainstage:state", onState);
    };
  }, [isAuthenticated]);

  const joinAsCammer = useCallback(async () => {
    try {
      setError(null);
      const res = await getMainStageToken({ asCammer: true });
      if (mountedRef.current) {
        setToken(res.token);
        setLivekitUrl(res.livekitUrl);
        setRoomName(res.roomName);
        setRole(res.role);
        tokenAsCammerRef.current = true;
        scheduleTokenRefresh();
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : "Failed to join as cammer");
      }
    }
  }, [scheduleTokenRefresh]);

  const leaveCammer = useCallback(async () => {
    // Re-mint as viewer to demote from cammer role
    try {
      setError(null);
      const res = await getMainStageToken({ asCammer: false });
      if (mountedRef.current) {
        setToken(res.token);
        setLivekitUrl(res.livekitUrl);
        setRoomName(res.roomName);
        setRole(res.role);
        tokenAsCammerRef.current = false;
        scheduleTokenRefresh();
      }
    } catch {
      // silent — user still sees the feed
    }
  }, [scheduleTokenRefresh]);

  const adminSetMode = useCallback(async (mode: MainStageState["mode"]) => {
    await setMainStageMode(mode);
  }, []);

  const adminSetMedia = useCallback(
    async (payload: { kind: "video" | "music" | "off"; src?: string | null; playing?: boolean; volume?: number }) => {
      await setMainStageMedia(payload);
    },
    []
  );

  const adminSetVolume = useCallback(async (payload: { cams?: number; media?: number }) => {
    await setMainStageVolume(payload);
  }, []);

  const adminSetSpotlight = useCallback(async (cammer: string) => {
    await setMainStageSpotlight(cammer);
  }, []);

  const adminModerate = useCallback(async (action: "skip" | "mute" | "kick", identity: string) => {
    await moderateMainStage(action, identity);
  }, []);

  // Any authenticated user can request a cammer token; the backend enforces caps
  // and returns the effective role in the minted token.
  const canBeCammer = isAuthenticated;

  return {
    state,
    isAdmin: authIsAdmin,
    canBeCammer,
    token,
    livekitUrl,
    roomName,
    role,
    loading,
    error,
    joinAsCammer,
    leaveCammer,
    admin: {
      setMode: adminSetMode,
      setMedia: adminSetMedia,
      setVolume: adminSetVolume,
      setSpotlight: adminSetSpotlight,
      moderate: adminModerate,
    },
  };
}
