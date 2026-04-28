import {
  GridLayout,
  ParticipantTile,
  useTracks,
} from "@livekit/components-react";
import { Track } from "livekit-client";
import { MEDIA_IDENTITY } from "./CinemaGrid";
import { useI18n } from "@/lib/i18n";

export function EqualGrid() {
  const t = useI18n().live;
  const allTracks = useTracks(
    [{ source: Track.Source.Camera, withPlaceholder: false }],
    { onlySubscribed: false }
  );
  // Drop the URL-ingress media bot so it doesn't get a tile alongside cammers.
  const tracks = allTracks.filter((track) => track.participant.identity !== MEDIA_IDENTITY);

  if (tracks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 px-6 text-center">
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center animate-pulse bg-pnp-accent/10 border border-pnp-accent/20">
          <svg className="w-8 h-8 text-pnp-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
          </svg>
        </div>
        <div>
          <p className="text-white font-semibold text-sm">{t.mainStageNobodyOnCam}</p>
          <p className="text-white/50 text-xs mt-1">
            {t.mainStageNobodyOnCamHint}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full bg-pnp-background">
      <GridLayout tracks={tracks} style={{ height: "100%" }}>
        <ParticipantTile />
      </GridLayout>
    </div>
  );
}
