import React, { useState, useRef, useEffect, useCallback } from "react";

interface MediaMessageProps {
  mediaUrl: string;
  mediaType: "image" | "video" | "audio";
  thumbUrl?: string | null;
  width?: number | null;
  height?: number | null;
  duration?: number | null;
  onExpandImage: (url: string) => void;
  isMe: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || isNaN(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// 30 decorative bars representing a waveform (fixed heights for visual appeal)
const WAVEFORM_HEIGHTS = [
  30, 55, 40, 70, 85, 60, 45, 80, 65, 50,
  75, 90, 55, 40, 70, 60, 85, 45, 65, 80,
  50, 70, 40, 60, 75, 55, 85, 45, 65, 30,
];
const TOTAL_BARS = WAVEFORM_HEIGHTS.length;

// ─── Audio player ─────────────────────────────────────────────────────────────

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

  // Keep duration updated from metadata
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    function onMetadata() {
      if (audio && isFinite(audio.duration)) {
        setDuration(audio.duration);
      }
    }
    function onEnded() {
      setIsPlaying(false);
      if (audio) setCurrentTime(audio.duration || 0);
    }
    function onError() {
      setLoadError(true);
      setIsPlaying(false);
    }

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

  // RAF-based smooth progress update
  useEffect(() => {
    function tick() {
      const audio = audioRef.current;
      if (audio && !audio.paused) {
        setCurrentTime(audio.currentTime);
        rafRef.current = requestAnimationFrame(tick);
      }
    }
    if (isPlaying) {
      rafRef.current = requestAnimationFrame(tick);
    }
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [isPlaying]);

  const togglePlay = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio || loadError) return;
    if (audio.paused) {
      try {
        await audio.play();
        setIsPlaying(true);
      } catch {
        setLoadError(true);
      }
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
    <div className="flex items-center gap-2 w-[200px] py-1">
      <audio ref={audioRef} src={src} preload="metadata" className="hidden" />

      {/* Play/Pause */}
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

      {/* Waveform + time */}
      <div className="flex-1 flex flex-col gap-1 min-w-0">
        {/* Clickable waveform bars */}
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
              className={[
                "flex-1 rounded-full transition-colors duration-150",
                i < filledBars ? accentClass : dimClass,
              ].join(" ")}
              style={{ height: `${Math.round((h / 100) * 22) + 2}px` }}
            />
          ))}
        </div>

        {/* Time row */}
        <div className="flex items-center justify-between">
          <span className={`text-[10px] tabular-nums ${textClass}`}>
            {isPlaying || currentTime > 0 ? formatTime(currentTime) : formatTime(displayDuration)}
          </span>
          {/* Speed toggle */}
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
}: MediaMessageProps) {
  const [imgError, setImgError] = useState(false);
  const [videoError, setVideoError] = useState(false);

  // Compute a max-width/aspect-ratio hint so images don't reflow.
  // Capped at 240 px wide to fit in the bubble max-w-[75%] constraint.
  const aspectStyle: React.CSSProperties =
    width && height
      ? { aspectRatio: `${width} / ${height}`, maxWidth: Math.min(width, 240) }
      : { maxWidth: 240 };

  // ─── Audio ───────────────────────────────────────────────────────────────

  if (mediaType === "audio") {
    return (
      <AudioPlayer src={mediaUrl} knownDuration={duration} isMe={isMe} />
    );
  }

  // ─── Image ───────────────────────────────────────────────────────────────

  if (mediaType === "image") {
    const src = thumbUrl || mediaUrl;

    if (imgError) {
      return (
        <div
          className="flex items-center justify-center rounded-xl bg-white/5 text-xs text-pnp-textSecondary px-3 py-2"
          style={{ maxWidth: 240 }}
        >
          <svg
            className="w-4 h-4 mr-1.5 flex-shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3 20.25h18M3.75 3h16.5A.75.75 0 0121 3.75v16.5a.75.75 0 01-.75.75H3.75A.75.75 0 013 20.25V3.75A.75.75 0 013.75 3z"
            />
          </svg>
          Image unavailable
        </div>
      );
    }

    return (
      <button
        onClick={() => onExpandImage(mediaUrl)}
        className={`block rounded-xl overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent ${
          isMe ? "self-end" : "self-start"
        }`}
        style={aspectStyle}
        aria-label="View full image"
      >
        <img
          src={src}
          alt=""
          className="w-full h-full object-cover rounded-xl"
          style={aspectStyle}
          onError={() => setImgError(true)}
          loading="lazy"
        />
      </button>
    );
  }

  // ─── Video ───────────────────────────────────────────────────────────────

  if (videoError) {
    return (
      <div
        className="flex items-center justify-center rounded-xl bg-white/5 text-xs text-pnp-textSecondary px-3 py-2"
        style={{ maxWidth: 240 }}
      >
        <svg
          className="w-4 h-4 mr-1.5 flex-shrink-0"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M12 18.75H4.5a2.25 2.25 0 01-2.25-2.25V9m12.841 9.091L16.5 19.5m-1.409-1.409c.407-.407.659-.97.659-1.591v-9a2.25 2.25 0 00-2.25-2.25h-9c-.621 0-1.184.252-1.591.659"
          />
        </svg>
        Video unavailable
      </div>
    );
  }

  return (
    <div
      className={`rounded-xl overflow-hidden bg-black ${isMe ? "self-end" : "self-start"}`}
      style={aspectStyle}
    >
      <video
        src={mediaUrl}
        poster={thumbUrl || undefined}
        controls
        controlsList="nodownload"
        onContextMenu={(e) => e.preventDefault()}
        playsInline
        preload="metadata"
        className="w-full h-full object-contain rounded-xl"
        style={aspectStyle}
        onError={() => setVideoError(true)}
      />
    </div>
  );
}
