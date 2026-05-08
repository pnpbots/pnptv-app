import { useEffect, useMemo } from "react";
import { useTracks } from "@livekit/components-react";
import { Track } from "livekit-client";

export interface CammerInfo {
  identity: string;
  name: string;
}

interface ParticipantCollectorProps {
  onCammersChange: (cammers: CammerInfo[]) => void;
}

/**
 * ParticipantCollector — subscribes to all camera tracks and notifies the
 * parent only when participant identity or count changes. Track quality,
 * mute state, and speaking changes do NOT trigger a re-notify.
 */
export function ParticipantCollector({ onCammersChange }: ParticipantCollectorProps) {
  const tracks = useTracks(
    [{ source: Track.Source.Camera, withPlaceholder: false }],
    { onlySubscribed: false }
  );

  // Build a stable key from sorted identities only — changes in track
  // quality / mute / speaking do NOT change this and therefore do NOT
  // fire the effect.
  const identityKey = useMemo(
    () => tracks.map((t) => t.participant.identity).sort().join("\0"),
    [tracks]
  );

  // Compute the cammer list only when identityKey changes.
  const cammerInfos = useMemo(
    () =>
      tracks.map((t) => ({
        identity: t.participant.identity,
        name: t.participant.name || t.participant.identity,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [identityKey]
  );

  useEffect(() => {
    onCammersChange(cammerInfos);
  }, [cammerInfos, onCammersChange]);

  return null;
}
