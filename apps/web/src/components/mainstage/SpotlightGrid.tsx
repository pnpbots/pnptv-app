import { useEffect, useState } from "react";
import {
  ParticipantTile,
  useTracks,
} from "@livekit/components-react";
import type { TrackReferenceOrPlaceholder } from "@livekit/components-react";
import { Track } from "livekit-client";

interface SpotlightGridProps {
  focusIdentity: string | null;
  nextAt: number | null;
  onTileClick?: (identity: string) => void;
}

function CountdownChip({ nextAt }: { nextAt: number | null }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (nextAt == null) return;
    setNow(Date.now());
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, [nextAt]);

  if (nextAt == null) return null;
  const diff = Math.max(0, Math.floor((nextAt - now) / 1000));
  const label = diff <= 0 ? "Rotating..." : (() => {
    const m = Math.floor(diff / 60);
    const s = diff % 60;
    return `Next: ${m}:${String(s).padStart(2, "0")}`;
  })();

  return (
    <div
      className="absolute top-3 right-3 z-10 px-2.5 py-1 rounded-full text-xs font-semibold tabular-nums pointer-events-none"
      style={{
        background: "rgba(0,0,0,0.65)",
        color: "#D4007A",
        border: "1px solid rgba(212,0,122,0.35)",
        backdropFilter: "blur(8px)",
      }}
    >
      {label}
    </div>
  );
}

export function SpotlightGrid({ focusIdentity, nextAt, onTileClick }: SpotlightGridProps) {
  const tracks = useTracks(
    [{ source: Track.Source.Camera, withPlaceholder: true }],
    { onlySubscribed: false }
  );

  const heroTrack: TrackReferenceOrPlaceholder | undefined = focusIdentity
    ? tracks.find((t) => t.participant.identity === focusIdentity) ?? tracks[0]
    : tracks[0];

  const stripTracks = heroTrack
    ? tracks.filter((t) => t.participant.identity !== heroTrack.participant.identity)
    : tracks;

  // Empty state
  if (tracks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 px-6 text-center">
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center animate-pulse"
          style={{ background: "rgba(212,0,122,0.12)" }}
        >
          <svg className="w-8 h-8" style={{ color: "#D4007A" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9A2.25 2.25 0 004.5 18.75z" />
          </svg>
        </div>
        <div>
          <p className="text-white font-semibold text-sm">Waiting for performers</p>
          <p className="text-white/50 text-xs mt-1">The Main Stage is getting ready</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full" style={{ background: "#0A0A0F" }}>
      {/* Hero */}
      <div className="relative flex-1 min-h-0">
        {heroTrack && (
          <div
            className={`absolute inset-0${onTileClick ? " cursor-pointer" : ""}`}
            onClick={onTileClick ? () => onTileClick(heroTrack.participant.identity) : undefined}
          >
            <ParticipantTile
              trackRef={heroTrack}
              style={{ width: "100%", height: "100%" }}
            />
            <CountdownChip nextAt={nextAt} />
          </div>
        )}
      </div>

      {/* Strip */}
      {stripTracks.length > 0 && (
        <div
          className="flex-shrink-0 flex gap-1.5 overflow-x-auto"
          style={{
            height: "88px",
            padding: "6px 8px",
            background: "rgba(0,0,0,0.6)",
          }}
        >
          {stripTracks.map((t) => (
            <button
              key={t.participant.identity}
              type="button"
              aria-label={`Focus ${t.participant.identity}`}
              onClick={() => onTileClick?.(t.participant.identity)}
              className="flex-shrink-0 rounded-xl overflow-hidden relative transition-all hover:scale-[1.04] active:scale-[0.97]"
              style={{
                width: "calc(16/9 * 76px)",
                height: "76px",
                border: "1.5px solid rgba(255,255,255,0.12)",
              }}
            >
              <ParticipantTile
                trackRef={t}
                style={{ width: "100%", height: "100%" }}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
