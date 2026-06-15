/**
 * useMainStage — thin adapter that merges the provider's connection/role/state
 * with the admin-control helpers. All LiveKit connection lifecycle has moved
 * to MainStageProvider; this hook is now purely about UX state + API calls.
 */
import { useCallback } from "react";
import {
  setMainStageMode,
  setMainStageMedia,
  setMainStageVolume,
  setMainStageSpotlight,
  moderateMainStage,
  shuffleMainStageCammers,
  type MainStageState,
  type MainStageTokenResponse,
} from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { useMainStageRoom } from "@/components/mainstage/MainStageProvider";

export type { MainStageState };

interface UseMainStageReturn {
  state: MainStageState | null;
  isAdmin: boolean;
  canJoinStage: boolean;
  role: MainStageTokenResponse["role"] | null;
  livekitUrl: string;
  roomName: string;
  loading: boolean;
  error: string | null;
  join: () => Promise<void>;
  leave: () => void;
  shuffle: () => Promise<void>;
  admin: {
    setMode: (mode: MainStageState["mode"]) => Promise<void>;
    setMedia: (payload: {
      kind: "video" | "music" | "off";
      src?: string | null;
      playing?: boolean;
      volume?: number;
      adminLocked?: boolean;
    }) => Promise<void>;
    setVolume: (payload: { cams?: number; media?: number }) => Promise<void>;
    setSpotlight: (cammer: string) => Promise<void>;
    moderate: (action: "skip" | "mute" | "kick", identity: string) => Promise<void>;
  };
}

export function useMainStage(): UseMainStageReturn {
  const { isAdmin: authIsAdmin, isAuthenticated } = useAuth();
  const {
    role,
    state,
    livekitUrl,
    roomName,
    loading,
    error,
    join,
    leave,
  } = useMainStageRoom();

  const adminSetMode = useCallback(async (mode: MainStageState["mode"]) => {
    await setMainStageMode(mode);
  }, []);

  const adminSetMedia = useCallback(
    async (payload: { kind: "video" | "music" | "off"; src?: string | null; playing?: boolean; volume?: number; adminLocked?: boolean }) => {
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

  const shuffle = useCallback(async () => {
    try {
      await shuffleMainStageCammers();
    } catch {
      // state will recover on next socket tick
    }
  }, []);

  const canJoinStage = isAuthenticated;

  return {
    state,
    isAdmin: authIsAdmin,
    canJoinStage,
    role,
    livekitUrl,
    roomName,
    loading,
    error,
    join,
    leave,
    shuffle,
    admin: {
      setMode: adminSetMode,
      setMedia: adminSetMedia,
      setVolume: adminSetVolume,
      setSpotlight: adminSetSpotlight,
      moderate: adminModerate,
    },
  };
}
