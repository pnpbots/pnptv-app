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

const LIVEKIT_URL =
  (typeof import.meta !== "undefined" && (import.meta as { env?: Record<string, string> }).env?.VITE_LIVEKIT_URL) ||
  "wss://livekit.pnptv.app";
const ROOM_NAME = "main-stage-prime";

export function useMainStage(): UseMainStageReturn {
  const { isAdmin: authIsAdmin, isAuthenticated } = useAuth();

  const [state, setState] = useState<MainStageState | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [role, setRole] = useState<MainStageTokenResponse["role"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
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
        setRole(tokenRes.role);
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
      const res = await getMainStageToken({ asCammer: true });
      if (mountedRef.current) {
        setToken(res.token);
        setRole(res.role);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : "Failed to join as cammer");
      }
    }
  }, []);

  const leaveCammer = useCallback(async () => {
    // Re-mint as viewer to demote from cammer role
    try {
      const res = await getMainStageToken({ asCammer: false });
      if (mountedRef.current) {
        setToken(res.token);
        setRole(res.role);
      }
    } catch {
      // silent — user still sees the feed
    }
  }, []);

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

  // Admins can always be cammers; regular users can only be viewers unless role permits
  const canBeCammer = authIsAdmin || role === "cammer";

  return {
    state,
    isAdmin: authIsAdmin,
    canBeCammer,
    token,
    livekitUrl: LIVEKIT_URL,
    roomName: ROOM_NAME,
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
