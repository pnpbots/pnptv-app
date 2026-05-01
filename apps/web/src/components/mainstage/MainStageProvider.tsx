/**
 * MainStageProvider
 *
 * Holds a single LiveKit Room instance that persists across route changes.
 * MainStage.tsx passes `room={room}` to its <LiveKitRoom> component so the
 * connection is owned here, not inside the page.
 *
 * Consumers call `useMainStageRoom()` to read/write the shared state.
 * SelfCamFloater reads `localVideoTrack` to render the floating self-cam tile.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { Room } from "livekit-client";

export interface MainStageContextValue {
  /** Stable Room instance — pass to LiveKitRoom's `room` prop. */
  room: Room;
  /**
   * True while the user is an active cammer on Main Stage.
   * Set by MainStage when it joins/leaves cam so the floater knows to render.
   */
  isCammerActive: boolean;
  setIsCammerActive: (v: boolean) => void;
  /** Whether the floater has been permanently dismissed this session. */
  floaterDismissed: boolean;
  dismissFloater: () => void;
}

const MainStageContext = createContext<MainStageContextValue | null>(null);

const FLOATER_DISMISSED_KEY = "pnptv:ms:floater_dismissed";

function readDismissed(): boolean {
  try {
    return sessionStorage.getItem(FLOATER_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function MainStageProvider({ children }: { children: React.ReactNode }) {
  // Create the Room instance once and keep it for the entire session.
  const roomRef = useRef<Room>(new Room());
  const room = roomRef.current;

  const [isCammerActive, setIsCammerActive] = useState(false);
  const [floaterDismissed, setFloaterDismissed] = useState<boolean>(readDismissed);

  const dismissFloater = useCallback(() => {
    setFloaterDismissed(true);
    try {
      sessionStorage.setItem(FLOATER_DISMISSED_KEY, "1");
    } catch {}
  }, []);

  const value = useMemo<MainStageContextValue>(
    () => ({ room, isCammerActive, setIsCammerActive, floaterDismissed, dismissFloater }),
    [room, isCammerActive, setIsCammerActive, floaterDismissed, dismissFloater]
  );

  return (
    <MainStageContext.Provider value={value}>
      {children}
    </MainStageContext.Provider>
  );
}

export function useMainStageRoom(): MainStageContextValue {
  const ctx = useContext(MainStageContext);
  if (!ctx) {
    throw new Error("useMainStageRoom must be used inside <MainStageProvider>");
  }
  return ctx;
}
