import React, { useState, useRef, useEffect, useCallback } from "react";

interface MediaPreviewProps {
  file: File;
  previewUrl: string;
  uploadProgress: number | null;
  uploadError: string | null;
  onCancel: () => void;
}

// 30 decorative waveform bar heights (same pattern as the player for visual consistency)
const WAVEFORM_HEIGHTS = [
  30, 55, 40, 70, 85, 60, 45, 80, 65, 50,
  75, 90, 55, 40, 70, 60, 85, 45, 65, 80,
  50, 70, 40, 60, 75, 55, 85, 45, 65, 30,
];

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || isNaN(seconds) || seconds <= 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// ─── Audio preview sub-component ────────────────────────────────────────────

interface AudioPreviewPlayerProps {
  src: string;
  duration: number;
}

function AudioPreviewPlayer({ src, duration: knownDuration }: AudioPreviewPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(knownDuration);
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
    audio.addEventListener("loadedmetadata", onMetadata);
    audio.addEventListener("durationchange", onMetadata);
    audio.addEventListener("ended", onEnded);
    return () => {
      audio.removeEventListener("loadedmetadata", onMetadata);
      audio.removeEventListener("durationchange", onMetadata);
      audio.removeEventListener("ended", onEnded);
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
    if (isPlaying) {
      rafRef.current = requestAnimationFrame(tick);
    }
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [isPlaying]);

  // Stop audio on unmount
  useEffect(() => {
    return () => {
      const audio = audioRef.current;
      if (audio && !audio.paused) audio.pause();
    };
  }, []);

  const togglePlay = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      try {
        await audio.play();
        setIsPlaying(true);
      } catch {
        // Ignore playback errors in preview
      }
    } else {
      audio.pause();
      setIsPlaying(false);
    }
  }, []);

  function handleWaveformClick(e: React.MouseEvent<HTMLDivElement>) {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audio.currentTime = ratio * duration;
    setCurrentTime(audio.currentTime);
  }

  const progress = duration > 0 ? currentTime / duration : 0;
  const filledBars = Math.round(progress * WAVEFORM_HEIGHTS.length);

  return (
    <div className="flex items-center gap-2 w-full">
      <audio ref={audioRef} src={src} preload="metadata" className="hidden" />

      {/* Play/pause */}
      <button
        type="button"
        onClick={togglePlay}
        className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-full bg-pnp-accent/20 hover:bg-pnp-accent/30 text-pnp-accent transition-colors active:scale-90"
        aria-label={isPlaying ? "Pause preview" : "Play preview"}
        title={isPlaying ? "Pause" : "Play preview"}
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
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <div
          className="flex items-end gap-[2px] h-6 cursor-pointer"
          onClick={handleWaveformClick}
          aria-label="Audio preview progress"
        >
          {WAVEFORM_HEIGHTS.map((h, i) => (
            <div
              key={i}
              className={[
                "flex-1 rounded-full transition-colors duration-100",
                i < filledBars ? "bg-pnp-accent" : "bg-white/20",
              ].join(" ")}
              style={{ height: `${Math.round((h / 100) * 22) + 2}px` }}
            />
          ))}
        </div>
        <span className="text-[10px] tabular-nums text-pnp-textSecondary">
          {isPlaying || currentTime > 0
            ? `${formatTime(currentTime)} / ${formatTime(duration)}`
            : formatTime(duration)}
        </span>
      </div>
    </div>
  );
}

// ─── Main export ─────────────────────────────────────────────────────────────

export function MediaPreview({
  file,
  previewUrl,
  uploadProgress,
  uploadError,
  onCancel,
}: MediaPreviewProps) {
  const isVideo = file.type.startsWith("video/");
  const isAudio = file.type.startsWith("audio/");
  const fileSizeMb = (file.size / 1_048_576).toFixed(1);

  // For audio blobs, the File may have size but no meaningful name.
  // Approximate duration from size + bitrate (~16 KB/s for opus).
  const estimatedDuration = isAudio
    ? Math.round(file.size / (16 * 1024))
    : 0;

  const mediaLabel = isAudio ? "Voice message" : isVideo ? "Video" : "Image";

  return (
    <div className="mx-4 mb-2 rounded-xl border border-pnp-border bg-white/5 overflow-hidden animate-fade-in-up">
      <div className="flex items-start gap-3 p-3">

        {/* Thumbnail / audio preview */}
        <div
          className={[
            "flex-shrink-0 rounded-lg overflow-hidden bg-black/30 flex items-center justify-center",
            isAudio ? "w-full" : "w-16 h-16",
          ].join(" ")}
        >
          {isAudio ? (
            <div className="w-full px-1 py-2">
              <AudioPreviewPlayer src={previewUrl} duration={estimatedDuration} />
            </div>
          ) : isVideo ? (
            <video
              src={previewUrl}
              className="w-full h-full object-cover"
              muted
              playsInline
              preload="metadata"
              disablePictureInPicture
              onContextMenu={(e) => e.preventDefault()}
            />
          ) : (
            <img
              src={previewUrl}
              alt=""
              className="w-full h-full object-cover"
            />
          )}
        </div>

        {/* Info (only shown for non-audio since audio preview is full-width) */}
        {!isAudio && (
          <div className="flex-1 min-w-0 flex flex-col gap-1">
            <p className="text-xs font-medium text-pnp-textPrimary truncate" title={file.name}>
              {file.name}
            </p>
            <p className="text-[10px] text-pnp-textSecondary">
              {mediaLabel} &middot; {fileSizeMb} MB
            </p>

            {/* Progress bar */}
            {uploadProgress !== null && (
              <div className="mt-1">
                <div className="h-1 w-full rounded-full bg-white/10 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-pnp-accent transition-all duration-300"
                    style={{ width: `${Math.min(uploadProgress, 100)}%` }}
                  />
                </div>
                <p className="text-[10px] text-pnp-textSecondary mt-0.5">
                  Uploading&hellip; {Math.round(uploadProgress)}%
                </p>
              </div>
            )}

            {/* Error state */}
            {uploadError && (
              <p className="text-[10px] text-pnp-error mt-0.5">{uploadError}</p>
            )}
          </div>
        )}

        {/* Cancel button */}
        <button
          onClick={onCancel}
          className="w-7 h-7 flex-shrink-0 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-pnp-textSecondary hover:text-pnp-textPrimary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent"
          aria-label="Remove attachment"
          disabled={uploadProgress !== null && uploadProgress > 0 && uploadProgress < 100}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Audio upload progress shown below the full-width player */}
      {isAudio && uploadProgress !== null && (
        <div className="px-3 pb-3">
          <div className="h-1 w-full rounded-full bg-white/10 overflow-hidden">
            <div
              className="h-full rounded-full bg-pnp-accent transition-all duration-300"
              style={{ width: `${Math.min(uploadProgress, 100)}%` }}
            />
          </div>
          <p className="text-[10px] text-pnp-textSecondary mt-0.5">
            Uploading&hellip; {Math.round(uploadProgress)}%
          </p>
        </div>
      )}
      {isAudio && uploadError && (
        <p className="text-[10px] text-pnp-error px-3 pb-3">{uploadError}</p>
      )}
    </div>
  );
}
