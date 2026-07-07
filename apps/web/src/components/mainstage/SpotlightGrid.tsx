import { useEffect, useState } from "react";
import {
  ParticipantTile,
  useTracks,
} from "@livekit/components-react";
import type { TrackReferenceOrPlaceholder } from "@livekit/components-react";
import { Track, VideoQuality } from "livekit-client";
import type { RemoteTrackPublication } from "livekit-client";
import { MEDIA_IDENTITY } from "./CinemaGrid";
import { useI18n } from "@/lib/i18n";

interface SpotlightGridProps {
  focusIdentity: string | null;
  nextAt: number | null;
  onTileClick?: (identity: string) => void;
}

function CountdownChip({ nextAt }: { nextAt: number | null }) {
  const t = useI18n().live;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (nextAt == null) return;
    setNow(Date.now());
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, [nextAt]);

  if (nextAt == null) return null;
  const diff = Math.max(0, Math.floor((nextAt - now) / 1000));
  const label = diff <= 0
    ? t.mainStageCountdownRotating
    : (() => {
        const m = Math.floor(diff / 60);
        const s = String(diff % 60).padStart(2, "0");
        return t.mainStageCountdownNext(m, s);
      })();

  return (
    <div
      className="absolute top-3 right-3 z-10 px-2.5 py-1 rounded-full text-xs font-semibold tabular-nums pointer-events-none text-pnp-accent"
      style={{
        background: "rgba(0,0,0,0.65)",
        border: "1px solid rgba(212,0,122,0.35)",
        backdropFilter: "blur(8px)",
      }}
    >
      {label}
    </div>
  );
}

/**
 * Strip tile for the Spotlight layout thumbnail row.
 * Requests VideoQuality.LOW to reduce decoder slot pressure.
 * Uses viewport-relative clamping for responsive height across screen sizes.
 */
function SpotlightStripTile({
  trackRef,
  onTileClick,
}: {
  trackRef: TrackReferenceOrPlaceholder;
  onTileClick?: (identity: string) => void;
}) {
  const t = useI18n().live;

  useEffect(() => {
    const pub = trackRef.publication as RemoteTrackPublication | undefined;
    if (!pub || !("setVideoQuality" in pub)) return;
    pub.setVideoQuality(VideoQuality.LOW);
  }, [trackRef.publication]);

  return (
    <button
      key={trackRef.participant.identity}
      type="button"
      aria-label={t.mainStageAriaFocusTile(trackRef.participant.identity)}
      onClick={onTileClick ? () => onTileClick(trackRef.participant.identity) : undefined}
      className="flex-shrink-0 rounded-xl overflow-hidden relative transition-all hover:scale-[1.04] active:scale-[0.97]"
      style={{
        width: "calc(16/9 * clamp(68px, 12vh, 120px))",
        height: "clamp(68px, 12vh, 120px)",
        border: "1.5px solid rgba(255,255,255,0.12)",
        cursor: onTileClick ? "pointer" : "default",
      }}
    >
      <ParticipantTile trackRef={trackRef} style={{ width: "100%", height: "100%" }} />
    </button>
  );
}

/**
 * Hero tile wrapper that requests VideoQuality.HIGH for the spotlighted participant.
 */
function SpotlightHeroTile({
  trackRef,
  onTileClick,
  nextAt,
}: {
  trackRef: TrackReferenceOrPlaceholder;
  onTileClick?: (identity: string) => void;
  nextAt: number | null;
}) {
  useEffect(() => {
    const pub = trackRef.publication as RemoteTrackPublication | undefined;
    if (!pub || !("setVideoQuality" in pub)) return;
    pub.setVideoQuality(VideoQuality.HIGH);
  }, [trackRef.publication]);

  return (
    <div
      className={`absolute inset-0${onTileClick ? " cursor-pointer" : ""}`}
      onClick={onTileClick ? () => onTileClick(trackRef.participant.identity) : undefined}
    >
      <ParticipantTile trackRef={trackRef} style={{ width: "100%", height: "100%" }} />
      <CountdownChip nextAt={nextAt} />
    </div>
  );
}

export function SpotlightGrid({ focusIdentity, nextAt, onTileClick }: SpotlightGridProps) {
  const t = useI18n().live;
  const allTracks = useTracks(
    [{ source: Track.Source.Camera, withPlaceholder: false }],
    { onlySubscribed: false }
  );
  // The URL-ingress media bot publishes a Camera track too; never let it
  // appear as a spotlight or strip tile.
  const tracks = allTracks.filter((track) => track.participant.identity !== MEDIA_IDENTITY);

  const heroTrack: TrackReferenceOrPlaceholder | undefined = focusIdentity
    ? tracks.find((track) => track.participant.identity === focusIdentity) ?? tracks[0]
    : tracks[0];

  const stripTracks = heroTrack
    ? tracks.filter((track) => track.participant.identity !== heroTrack.participant.identity)
    : tracks;

  // Empty state
  if (tracks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 px-6 text-center">
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center animate-pulse bg-pnp-accent/10">
          <svg className="w-8 h-8 text-pnp-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9A2.25 2.25 0 004.5 18.75z" />
          </svg>
        </div>
        <div>
          <p className="text-white font-semibold text-sm">{t.mainStageStageQuiet}</p>
          <p className="text-white/50 text-xs mt-1">
            {t.mainStageStageQuietHint}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-pnp-background">
      {/* Hero — requests HIGH quality for the spotlighted participant */}
      <div className="relative flex-1 min-h-0">
        {heroTrack && (
          <SpotlightHeroTile
            trackRef={heroTrack}
            onTileClick={onTileClick}
            nextAt={nextAt}
          />
        )}
      </div>

      {/* Strip — requests LOW quality to reduce decoder pressure */}
      {stripTracks.length > 0 && (
        <div
          className="flex-shrink-0 flex gap-1.5 overflow-x-auto no-scrollbar"
          style={{
            height: "clamp(80px, 14vh, 140px)",
            padding: "6px 8px",
            background: "rgba(0,0,0,0.6)",
            scrollbarWidth: "none",
            msOverflowStyle: "none",
          }}
        >
          {stripTracks.map((track) => (
            <SpotlightStripTile
              key={track.participant.identity}
              trackRef={track}
              onTileClick={onTileClick}
            />
          ))}
        </div>
      )}
    </div>
  );
}
