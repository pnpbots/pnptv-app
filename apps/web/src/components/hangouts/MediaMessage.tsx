import React, { useState, useRef, useEffect, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";

export interface MediaGroupItem {
  mediaUrl: string;
  mediaType: "image" | "video" | "audio";
  thumbUrl?: string | null;
  width?: number | null;
  height?: number | null;
  duration?: number | null;
}

interface MediaMessageProps {
  mediaUrl: string;
  mediaType: "image" | "video" | "audio";
  thumbUrl?: string | null;
  width?: number | null;
  height?: number | null;
  duration?: number | null;
  onExpandImage: (url: string) => void;
  isMe: boolean;
  mediaGroup?: MediaGroupItem[];
  hasCaption?: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || isNaN(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// Returns an aspect-ratio string clamped to Instagram-style limits.
// Portrait images are capped at 4:5 (0.8); landscape at 1.91:1.
function clampAspect(w: number | null | undefined, h: number | null | undefined): string {
  if (!w || !h || w <= 0 || h <= 0) return "4 / 3";
  const ratio = w / h;
  if (ratio < 0.563) return "9 / 16"; // very tall portrait
  if (ratio < 0.8)   return "4 / 5";  // portrait
  if (ratio > 1.91)  return "1.91 / 1"; // very wide landscape
  return `${w} / ${h}`;
}

// Bleed container: extends the element to the full bubble width by compensating
// for the bubble's px-3 py-2 padding via negative margins.
// calc(100% + 1.5rem) = inner content width + 2×0.75rem padding = full bubble width.
const BLEED = "-mx-3 -mt-2 overflow-hidden rounded-xl";
const BLEED_W = "calc(100% + 1.5rem)";

// ─── Audio player ─────────────────────────────────────────────────────────────

const WAVEFORM_HEIGHTS = [
  30, 55, 40, 70, 85, 60, 45, 80, 65, 50,
  75, 90, 55, 40, 70, 60, 85, 45, 65, 80,
  50, 70, 40, 60, 75, 55, 85, 45, 65, 30,
];
const TOTAL_BARS = WAVEFORM_HEIGHTS.length;

interface AudioPlayerProps {
  src: string;
  knownDuration?: number | null;
  isMe: boolean;
}

function AudioPlayer({ src, knownDuration, isMe }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState<number>(knownDuration ?? 0);
  const [speed, setSpeed] = useState<1 | 1.5 | 2>(1);
  const [loadError, setLoadError] = useState(false);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    function onMetadata() {
      if (audio && isFinite(audio.duration)) setDuration(audio.duration);
    }
    function onEnded() {
      setIsPlaying(false);
      if (audio) setCurrentTime(audio.duration || 0);
    }
    function onError() { setLoadError(true); setIsPlaying(false); }
    audio.addEventListener("loadedmetadata", onMetadata);
    audio.addEventListener("durationchange", onMetadata);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);
    return () => {
      audio.removeEventListener("loadedmetadata", onMetadata);
      audio.removeEventListener("durationchange", onMetadata);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
    };
  }, []);

  useEffect(() => {
    function tick() {
      const audio = audioRef.current;
      if (audio && !audio.paused) {
        setCurrentTime(audio.currentTime);
        rafRef.current = requestAnimationFrame(tick);
      }
    }
    if (isPlaying) rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current); };
  }, [isPlaying]);

  const togglePlay = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio || loadError) return;
    if (audio.paused) {
      try { await audio.play(); setIsPlaying(true); }
      catch { setLoadError(true); }
    } else {
      audio.pause();
      setIsPlaying(false);
    }
  }, [loadError]);

  function cycleSpeed() {
    const audio = audioRef.current;
    const next: 1 | 1.5 | 2 = speed === 1 ? 1.5 : speed === 1.5 ? 2 : 1;
    setSpeed(next);
    if (audio) audio.playbackRate = next;
  }

  function handleWaveformClick(e: React.MouseEvent<HTMLDivElement>) {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audio.currentTime = ratio * duration;
    setCurrentTime(audio.currentTime);
  }

  const progress = duration > 0 ? currentTime / duration : 0;
  const filledBars = Math.round(progress * TOTAL_BARS);
  const displayDuration = duration > 0 ? duration : (knownDuration ?? 0);
  const accentClass = isMe ? "bg-white/90" : "bg-pnp-accent";
  const dimClass = isMe ? "bg-white/25" : "bg-white/20";
  const textClass = isMe ? "text-white/80" : "text-pnp-textSecondary";

  if (loadError) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/5 text-xs text-pnp-textSecondary">
        <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
        </svg>
        Voice message unavailable
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 w-full max-w-[200px] py-1">
      <audio ref={audioRef} src={src} preload="metadata" className="hidden" />
      <button
        type="button"
        onClick={togglePlay}
        className={[
          "w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-full transition-all active:scale-90",
          isMe
            ? "bg-white/20 hover:bg-white/30 text-white"
            : "bg-pnp-accent/20 hover:bg-pnp-accent/30 text-pnp-accent",
        ].join(" ")}
        aria-label={isPlaying ? "Pause" : "Play voice message"}
      >
        {isPlaying ? (
          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
            <rect x="6" y="4" width="4" height="16" rx="1" />
            <rect x="14" y="4" width="4" height="16" rx="1" />
          </svg>
        ) : (
          <svg className="w-3.5 h-3.5 translate-x-px" fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 5.14v14l11-7-11-7z" />
          </svg>
        )}
      </button>
      <div className="flex-1 flex flex-col gap-1 min-w-0">
        <div
          className="flex items-end gap-[2px] h-6 cursor-pointer"
          onClick={handleWaveformClick}
          role="progressbar"
          aria-valuenow={Math.round(currentTime)}
          aria-valuemax={Math.round(displayDuration)}
          aria-valuemin={0}
          aria-label="Audio progress"
        >
          {WAVEFORM_HEIGHTS.map((h, i) => (
            <div
              key={i}
              className={["flex-1 rounded-full transition-colors duration-150", i < filledBars ? accentClass : dimClass].join(" ")}
              style={{ height: `${Math.round((h / 100) * 22) + 2}px` }}
            />
          ))}
        </div>
        <div className="flex items-center justify-between">
          <span className={`text-[10px] tabular-nums ${textClass}`}>
            {isPlaying || currentTime > 0 ? formatTime(currentTime) : formatTime(displayDuration)}
          </span>
          <button
            type="button"
            onClick={cycleSpeed}
            className={[
              "text-[10px] font-semibold tabular-nums px-1 rounded transition-colors",
              isMe
                ? "text-white/70 hover:text-white hover:bg-white/10"
                : "text-pnp-textSecondary hover:text-pnp-textPrimary hover:bg-white/10",
            ].join(" ")}
            aria-label={`Playback speed ${speed}x, click to change`}
          >
            {speed}x
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Album grid ───────────────────────────────────────────────────────────────

function GridCell({
  item,
  style,
  overflow,
  onExpandImage,
}: {
  item: MediaGroupItem;
  style: React.CSSProperties;
  overflow?: number;
  onExpandImage: (url: string) => void;
}) {
  const src = item.thumbUrl || (item.mediaType === "image" ? item.mediaUrl : undefined);
  return (
    <div className="relative overflow-hidden bg-black/30" style={style}>
      {item.mediaType === "image" && src ? (
        <button
          onClick={() => onExpandImage(item.mediaUrl)}
          className="w-full h-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent"
          aria-label="View image"
        >
          <img src={src} alt="" className="w-full h-full object-cover" loading="lazy" />
        </button>
      ) : item.mediaType === "video" ? (
        <div className="w-full h-full">
          <video
            src={item.mediaUrl}
            poster={item.thumbUrl || undefined}
            className="w-full h-full object-cover pointer-events-none"
            muted
            playsInline
            preload="metadata"
          />
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-9 h-9 rounded-full bg-black/55 flex items-center justify-center">
              <svg className="w-4 h-4 text-white translate-x-px" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
          </div>
        </div>
      ) : (
        <div className="w-full h-full flex items-center justify-center text-white/25">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </div>
      )}
      {overflow != null && overflow > 0 && (
        <div className="absolute inset-0 bg-black/65 flex items-center justify-center pointer-events-none">
          <span className="text-white font-bold text-xl">+{overflow}</span>
        </div>
      )}
    </div>
  );
}

// Album layout — Telegram/Instagram style, bleeds to bubble edges.
// Each layout variant has a distinct composition that looks intentional.
function MediaGrid({ items, onExpandImage }: { items: MediaGroupItem[]; onExpandImage: (url: string) => void }) {
  const MAX_SHOW = 4;
  const shown = items.slice(0, MAX_SHOW);
  const overflow = items.length > MAX_SHOW ? items.length - MAX_SHOW : 0;

  const TALL = 200; // hero row height
  const MID  = 160; // two-column row height
  const SHORT = 130; // second row in 3-image layout

  // 2 images: side by side, equal height
  if (shown.length === 2) {
    return (
      <div
        className={`${BLEED} grid grid-cols-2 gap-0.5`}
        style={{ width: BLEED_W }}
      >
        {shown.map((item, i) => (
          <GridCell key={i} item={item} style={{ height: MID }} onExpandImage={onExpandImage} />
        ))}
      </div>
    );
  }

  // 3 images: tall hero on top, two smaller below
  if (shown.length === 3) {
    return (
      <div className={`${BLEED} flex flex-col gap-0.5`} style={{ width: BLEED_W }}>
        <GridCell item={shown[0]} style={{ width: "100%", height: TALL }} onExpandImage={onExpandImage} />
        <div className="grid grid-cols-2 gap-0.5">
          {shown.slice(1).map((item, i) => (
            <GridCell key={i} item={item} style={{ height: SHORT }} onExpandImage={onExpandImage} />
          ))}
        </div>
      </div>
    );
  }

  // 4+: 2×2 grid, +N badge on last visible cell
  return (
    <div className={`${BLEED} grid grid-cols-2 gap-0.5`} style={{ width: BLEED_W }}>
      {shown.map((item, i) => (
        <GridCell
          key={i}
          item={item}
          style={{ height: MID }}
          onExpandImage={onExpandImage}
          overflow={i === 3 && overflow > 0 ? overflow : undefined}
        />
      ))}
    </div>
  );
}

// ─── Watermark positions ──────────────────────────────────────────────────────

const WM_POSITIONS = [
  { top: '10px', left: '10px' },
  { top: '10px', right: '10px' },
  { bottom: '40px', left: '10px' },
  { bottom: '40px', right: '10px' },
] as const;

// ─── Main export ─────────────────────────────────────────────────────────────

export function MediaMessage({
  mediaUrl,
  mediaType,
  thumbUrl,
  width,
  height,
  duration,
  onExpandImage,
  isMe,
  mediaGroup,
  hasCaption,
}: MediaMessageProps) {
  const { user } = useAuth();
  const [imgError, setImgError] = useState(false);
  const [videoError, setVideoError] = useState(false);

  // Watermark rotation — only active for video
  const [wmIdx, setWmIdx] = useState(0);
  useEffect(() => {
    if (mediaType !== "video") return;
    const t = setInterval(() => setWmIdx(i => (i + 1) % 4), 30_000);
    return () => clearInterval(t);
  }, [mediaType]);
  const viewerLabel = user?.username
    ? `@${user.username} · pnptv.app`
    : user?.firstName
    ? `${user.firstName} · pnptv.app`
    : null;

  // Album: delegate to MediaGrid, with gap before caption if present
  if (mediaGroup && mediaGroup.length > 1) {
    return (
      <>
        <MediaGrid items={mediaGroup} onExpandImage={onExpandImage} />
        {hasCaption && <div className="h-2" />}
      </>
    );
  }

  // ─── Audio ─────────────────────────────────────────────────────────────────

  if (mediaType === "audio") {
    return <AudioPlayer src={mediaUrl} knownDuration={duration} isMe={isMe} />;
  }

  // ─── Single image ───────────────────────────────────────────────────────────

  if (mediaType === "image") {
    if (imgError) {
      return (
        <div className="flex items-center justify-center rounded-xl bg-white/5 text-xs text-pnp-textSecondary px-3 py-2">
          <svg className="w-4 h-4 mr-1.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3 20.25h18M3.75 3h16.5A.75.75 0 0121 3.75v16.5a.75.75 0 01-.75.75H3.75A.75.75 0 013 20.25V3.75A.75.75 0 013.75 3z" />
          </svg>
          Image unavailable
        </div>
      );
    }

    const src = thumbUrl || mediaUrl;
    const aspect = clampAspect(width, height);
    // When there's a caption below, leave a small visual gap by NOT adding -mb-2.
    // When it's a standalone image, let the bubble's own py-2 serve as the bottom inset.
    const bottomClass = hasCaption ? "mb-2" : "";

    return (
      <button
        onClick={() => onExpandImage(mediaUrl)}
        className={`${BLEED} ${bottomClass} block w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent`}
        style={{ width: BLEED_W, aspectRatio: aspect, maxHeight: 420 }}
        aria-label="View full image"
      >
        <img
          src={src}
          alt=""
          className="w-full h-full object-cover"
          onError={() => setImgError(true)}
          loading="lazy"
        />
      </button>
    );
  }

  // ─── Single video ───────────────────────────────────────────────────────────

  if (videoError) {
    return (
      <div className="flex items-center justify-center rounded-xl bg-white/5 text-xs text-pnp-textSecondary px-3 py-2">
        <svg className="w-4 h-4 mr-1.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M12 18.75H4.5a2.25 2.25 0 01-2.25-2.25V9m12.841 9.091L16.5 19.5m-1.409-1.409c.407-.407.659-.97.659-1.591v-9a2.25 2.25 0 00-2.25-2.25h-9c-.621 0-1.184.252-1.591.659" />
        </svg>
        Video unavailable
      </div>
    );
  }

  const videoAspect = clampAspect(width, height);
  return (
    <div
      className={`${BLEED} bg-black relative`}
      style={{ width: BLEED_W, aspectRatio: videoAspect, maxHeight: 420 }}
    >
      <video
        src={mediaUrl}
        poster={thumbUrl || undefined}
        controls
        controlsList="nodownload"
        disablePictureInPicture
        onContextMenu={(e) => e.preventDefault()}
        playsInline
        preload="metadata"
        className="w-full h-full object-contain"
        onError={() => setVideoError(true)}
      />
      {viewerLabel && (
        <div
          style={{
            position: 'absolute',
            pointerEvents: 'none',
            userSelect: 'none',
            color: 'rgba(255,255,255,0.12)',
            fontSize: 10,
            fontFamily: 'monospace',
            letterSpacing: '0.5px',
            textShadow: '0 1px 2px rgba(0,0,0,0.5)',
            zIndex: 20,
            ...WM_POSITIONS[wmIdx],
          }}
        >
          {viewerLabel}
        </div>
      )}
    </div>
  );
}
