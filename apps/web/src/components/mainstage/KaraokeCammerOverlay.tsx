import { useTracks } from "@livekit/components-react";
import { ParticipantTile } from "@livekit/components-react";
import { Track } from "livekit-client";
import { MEDIA_IDENTITY } from "@/components/mainstage/CinemaGrid";

interface KaraokeCammerOverlayProps {
  spotlightIdentity: string | null | undefined;
}

/** Small circular cammer tile in the bottom-right for Karaoke mode. */
export function KaraokeCammerOverlay({ spotlightIdentity }: KaraokeCammerOverlayProps) {
  const tracks = useTracks(
    [{ source: Track.Source.Camera, withPlaceholder: false }],
    { onlySubscribed: false }
  );
  const pick = tracks.find(
    (t) =>
      t.participant.identity !== MEDIA_IDENTITY &&
      (spotlightIdentity ? t.participant.identity === spotlightIdentity : true)
  );

  if (!pick) return null;

  return (
    <div
      className="absolute z-20 rounded-full overflow-hidden shadow-2xl"
      style={{
        width: 140,
        height: 140,
        bottom: "calc(96px + env(safe-area-inset-bottom, 0px))",
        right: "1rem",
        border: "3px solid rgba(212,0,122,0.55)",
        boxShadow: "0 12px 32px rgba(0,0,0,0.55), 0 0 24px rgba(212,0,122,0.35)",
      }}
    >
      <ParticipantTile
        trackRef={pick}
        disableSpeakingIndicator
        style={{ width: "100%", height: "100%" }}
      />
    </div>
  );
}
