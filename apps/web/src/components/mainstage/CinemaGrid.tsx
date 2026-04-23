import {
  ParticipantTile,
  useTracks,
} from "@livekit/components-react";
import type { TrackReferenceOrPlaceholder } from "@livekit/components-react";
import { Track } from "livekit-client";

interface CinemaGridProps {
  mediaIdentity: string;
  mediaKind: "video" | "music" | "off";
  mediaSrc: string | null;
}

export function CinemaGrid({ mediaIdentity, mediaKind, mediaSrc }: CinemaGridProps) {
  const tracks = useTracks(
    [{ source: Track.Source.Camera, withPlaceholder: true }],
    { onlySubscribed: false }
  );

  const mediaTrack: TrackReferenceOrPlaceholder | undefined = tracks.find(
    (t) => t.participant.identity === mediaIdentity
  );

  const cammerTracks = tracks.filter((t) => t.participant.identity !== mediaIdentity);

  const showStandby = mediaKind === "off" || (!mediaTrack && !mediaSrc);

  return (
    <div className="flex flex-col h-full" style={{ background: "#000" }}>
      {/* Main area */}
      <div className="relative flex-1 min-h-0 flex items-center justify-center" style={{ background: "#000" }}>
        {showStandby ? (
          <div className="flex flex-col items-center gap-4 px-6 text-center">
            <div
              className="w-20 h-20 rounded-2xl flex items-center justify-center"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
            >
              <svg className="w-10 h-10 text-white/20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 01-1.125-1.125M3.375 19.5h1.5C5.496 19.5 6 18.996 6 18.375m-3.75 0V5.625m0 12.75v-1.5c0-.621.504-1.125 1.125-1.125m18.375 2.625V5.625m0 12.75c0 .621-.504 1.125-1.125 1.125m1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125m0 3.75h-1.5A1.125 1.125 0 0118 18.375M20.625 4.5H3.375m17.25 0c.621 0 1.125.504 1.125 1.125M20.625 4.5h-1.5C18.504 4.5 18 5.004 18 5.625m3.75 0v1.5c0 .621-.504 1.125-1.125 1.125M3.375 4.5c-.621 0-1.125.504-1.125 1.125M3.375 4.5h1.5C5.496 4.5 6 5.004 6 5.625m-3.75 0v1.5c0 .621.504 1.125 1.125 1.125m0 0h1.5m-1.5 0c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125m1.5-3.75C5.496 8.25 6 8.754 6 9.375v1.5m0-5.25v5.25m0-5.25C6 5.004 6.504 4.5 7.125 4.5h9.75c.621 0 1.125.504 1.125 1.125m1.125 2.625h1.5m-1.5 0A1.125 1.125 0 0118 9.375v1.5m1.5-3.75C19.496 8.25 20 8.754 20 9.375v1.5m0-5.25v5.25m0-5.25C20 5.004 19.496 4.5 18.875 4.5M9 11.25v1.5M12 9v3.75m3-6v6" />
              </svg>
            </div>
            <div>
              <p className="text-white/40 font-medium text-sm">Standby</p>
              <p className="text-white/25 text-xs mt-1">No media playing · Admin controls playback</p>
            </div>
          </div>
        ) : mediaTrack ? (
          <div className="absolute inset-0">
            <ParticipantTile
              trackRef={mediaTrack}
              style={{ width: "100%", height: "100%" }}
            />
          </div>
        ) : (
          // Fallback: media source without LiveKit participant (e.g. music)
          <div className="flex flex-col items-center gap-3 px-6 text-center">
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center"
              style={{ background: "rgba(212,0,122,0.12)" }}
            >
              <svg className="w-8 h-8" style={{ color: "#D4007A" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 11-.99-3.467l2.31-.66a2.25 2.25 0 001.632-2.163zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 01-.99-3.467l2.31-.66A2.25 2.25 0 009 15.553z" />
              </svg>
            </div>
            <p className="text-white/60 text-sm font-medium">Now Playing</p>
            {mediaSrc && (
              <p className="text-white/30 text-xs max-w-[200px] truncate" title={mediaSrc}>
                {mediaSrc}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Cammer strip */}
      {cammerTracks.length > 0 && (
        <div
          className="flex-shrink-0 flex gap-1.5 overflow-x-auto"
          style={{
            height: "88px",
            padding: "6px 8px",
            background: "rgba(0,0,0,0.8)",
          }}
        >
          {cammerTracks.map((t) => (
            <div
              key={t.participant.identity}
              className="flex-shrink-0 rounded-xl overflow-hidden"
              style={{
                width: "calc(16/9 * 76px)",
                height: "76px",
                border: "1.5px solid rgba(255,255,255,0.10)",
              }}
            >
              <ParticipantTile
                trackRef={t}
                style={{ width: "100%", height: "100%" }}
              />
            </div>
          ))}
        </div>
      )}

      {/* No cammers empty state */}
      {tracks.length === 0 && !showStandby && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
          <p className="text-white/30 text-sm">Waiting for performers</p>
        </div>
      )}
    </div>
  );
}
