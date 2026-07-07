import { useEffect } from "react";
import { useLocalParticipant, useRoomContext } from "@livekit/components-react";
import { ConnectionState } from "livekit-client";

interface ForceCamMicEnforcerProps {
  active: boolean;
}

/**
 * ForceCamMicEnforcer — guest-only stage-rule enforcer.
 * Authenticated users are covered by MainStageProvider's listener that
 * runs across route changes. Guests bypass the provider, so we keep a
 * lightweight listener here while they are on /main-stage. We only act
 * once the room is fully Connected to avoid disrupting publish during
 * the connect/reconnect window.
 */
export function ForceCamMicEnforcer({ active }: ForceCamMicEnforcerProps) {
  const room = useRoomContext();
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant();

  useEffect(() => {
    if (!active || !localParticipant) return;
    if (room.state !== ConnectionState.Connected) return;
    let disposed = false;

    const enforce = async () => {
      if (disposed) return;
      // Re-check room state inside the async body — it may have changed during
      // the await gap (e.g. Reconnecting→Connected race on a flaky network).
      if (room.state !== ConnectionState.Connected) return;
      try {
        if (isMicrophoneEnabled) {
          await localParticipant.setMicrophoneEnabled(false);
          if (disposed) return;
        }
        if (!isCameraEnabled) {
          await localParticipant.setCameraEnabled(true);
        }
      } catch {
        // Permission denied / no device — onMediaDeviceFailure surfaces it.
      }
    };

    void enforce();

    return () => { disposed = true; };
  }, [active, localParticipant, isMicrophoneEnabled, isCameraEnabled, room]);

  return null;
}
