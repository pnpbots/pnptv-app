import React, { useRef, useState, useEffect } from "react";
import { Skeleton } from "@pnptv/ui-kit";

interface MediaPlayerProps {
  src: string;
  title?: string;
  artist?: string;
  cover?: string;
  type?: "audio" | "video";
}

export function MediaPlayer({ src, title, artist, cover, type = "audio" }: MediaPlayerProps) {
  const ref = useRef<HTMLAudioElement | HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const onTimeUpdate = () => setProgress(el.currentTime);
    const onDurationChange = () => setDuration(el.duration || 0);
    const onCanPlay = () => setIsLoading(false);
    const onEnded = () => setIsPlaying(false);

    el.addEventListener("timeupdate", onTimeUpdate);
    el.addEventListener("durationchange", onDurationChange);
    el.addEventListener("canplay", onCanPlay);
    el.addEventListener("ended", onEnded);

    return () => {
      el.removeEventListener("timeupdate", onTimeUpdate);
      el.removeEventListener("durationchange", onDurationChange);
      el.removeEventListener("canplay", onCanPlay);
      el.removeEventListener("ended", onEnded);
    };
  }, [src]);

  const togglePlay = () => {
    const el = ref.current;
    if (!el) return;
    if (isPlaying) {
      el.pause();
    } else {
      el.play();
    }
    setIsPlaying(!isPlaying);
  };

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    el.currentTime = ratio * duration;
  };

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  if (isLoading && !src) {
    return <Skeleton className="h-20 w-full rounded-xl" />;
  }

  return (
    <div className="bg-pnp-surface rounded-xl border border-pnp-border p-4">
      <div className="flex items-center gap-4">
        {cover && (
          <img src={cover} alt={title} className="w-14 h-14 rounded-lg object-cover" />
        )}
        <div className="flex-1 min-w-0">
          {title && <p className="font-medium text-pnp-textPrimary truncate">{title}</p>}
          {artist && <p className="text-sm text-pnp-textSecondary truncate">{artist}</p>}
        </div>
        <button
          onClick={togglePlay}
          className="w-10 h-10 rounded-full bg-pnp-accent flex items-center justify-center text-pnp-background hover:bg-pnp-accentHover transition-colors"
        >
          {isPlaying ? (
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
            </svg>
          ) : (
            <svg className="w-5 h-5 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>
      </div>

      <div className="mt-3 flex items-center gap-2 text-xs text-pnp-textSecondary">
        <span>{formatTime(progress)}</span>
        <div className="flex-1 h-1.5 bg-pnp-border rounded-full cursor-pointer" onClick={seek}>
          <div
            className="h-full bg-pnp-accent rounded-full transition-all"
            style={{ width: duration ? `${(progress / duration) * 100}%` : "0%" }}
          />
        </div>
        <span>{formatTime(duration)}</span>
      </div>

      {type === "audio" ? (
        <audio ref={ref as React.RefObject<HTMLAudioElement>} src={src} preload="metadata" />
      ) : (
        <video ref={ref as React.RefObject<HTMLVideoElement>} src={src} preload="metadata" className="hidden" />
      )}
    </div>
  );
}
