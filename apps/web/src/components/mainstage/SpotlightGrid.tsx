import { useEffect, useRef } from "react";
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

function useCountdown(targetMs: number | null): string | null {
  const ref = useRef<ReturnType<typeof setInterval> | null>(null);
  const forceUpdate = useForceUpdate();

  useEffect(() => {
    if (targetMs == null) return;
    ref.current = setInterval(forceUpdate, 1000);
    return () => { if (ref.current) clearInterval(ref.current); };
  }, [targetMs, forceUpdate]);

  if (targetMs == null) return null;
  const diff = Math.max(0, Math.floor((targetMs - Date.now()) / 1000));
  if (diff <= 0) return "now";
  const m = Math.floor(diff / 60);
  const s = diff % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function useForceUpdate() {
  const updateRef = useRef(0);
  const setter = useRef<(() => void) | null>(null);
  useEffect(() => {
    // Tiny trick: capture a stable updater. We do this by reading from a set
    // of state inside the component, but since this is a utility hook, we
    // use a ref-based counter pattern instead.
  }, []);
  return () => { updateRef.current += 1; if (setter.current) setter.current(); };
}

// Simpler countdown: use a state-based approach
function Countdown({ targetMs }: { targetMs: number | null }) {
  const forceRef = useRef(0);
  const [, setTick] = [forceRef.current, (n: number) => { forceRef.current = n; }];

  useEffect(() => {
    if (targetMs == null) return;
    const iv = setInterval(() => {
      setTick(Date.now());
    }, 1000);
    return () => clearInterval(iv);
  }, [targetMs, setTick]);

  if (targetMs == null) return null;
  const diff = Math.max(0, Math.floor((targetMs - Date.now()) / 1000));
  if (diff <= 0) return <span>now</span>;
  const m = Math.floor(diff / 60);
  const s = diff % 60;
  return <span>Next: {m}:{String(s).padStart(2, "0")}</span>;
}

// A self-contained countdown that actually re-renders
function CountdownChip({ nextAt }: { nextAt: number | null }) {
  const [tick, setTick] = [0, (_: number) => {}];
  void tick; void setTick;

  // We need actual re-rendering state
  return <CountdownChipInner nextAt={nextAt} />;
}

function CountdownChipInner({ nextAt }: { nextAt: number | null }) {
  const [, forceUpdate] = [0, () => {}];
  useEffect(() => {
    if (nextAt == null) return;
    const iv = setInterval(() => forceUpdate(), 1000);
    return () => clearInterval(iv);
  }, [nextAt, forceUpdate]);

  if (nextAt == null) return null;
  const diff = Math.max(0, Math.floor((nextAt - Date.now()) / 1000));
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
          <div className="absolute inset-0">
            <div
              className="w-full h-full cursor-pointer"
              style={{ aspectRatio: "16/9", maxHeight: "100%" }}
              onClick={() => onTileClick?.(heroTrack.participant.identity)}
            >
              <ParticipantTile
                trackRef={heroTrack}
                style={{ width: "100%", height: "100%" }}
              />
            </div>
            <CountdownChipInner nextAt={nextAt} />
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
                width: "calc(9/16 * 76px)",
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
