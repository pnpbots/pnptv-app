import React, { useRef, useState, useEffect } from "react";

interface Props {
  videoUrl: string | null;
  posterUrl: string | null;
  alt: string;
  /**
   * Pre-extracted still frames (cheap, fast). When provided, these are cycled
   * via opacity crossfade — no video bytes are pulled. Falls back to live
   * video seeking only when this is empty/undefined.
   */
  frames?: string[] | null;
  /** Crossfade interval between frames in ms. */
  frameIntervalMs?: number;
}

/**
 * Channel-feed thumbnail. Prefers cycling pre-extracted still frames (fast,
 * cheap, no large video download). Falls back to seeking the actual video on
 * the fly when no frames are available.
 */
export function AnimatedVideoThumbnail({ videoUrl, posterUrl, alt, frames, frameIntervalMs = 1500 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [frameIdx, setFrameIdx] = useState(0);

  const usableFrames = Array.isArray(frames) ? frames.filter((u) => typeof u === "string" && u.length > 0) : [];
  const useFrames = usableFrames.length >= 2;

  // Visibility — only animate / load when on screen
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setIsVisible(entry.isIntersecting),
      { threshold: 0.2 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Frame cycling (cheap path)
  useEffect(() => {
    if (!useFrames || !isVisible) return;
    const id = setInterval(() => {
      setFrameIdx((i) => (i + 1) % usableFrames.length);
    }, frameIntervalMs);
    return () => clearInterval(id);
  }, [useFrames, isVisible, usableFrames.length, frameIntervalMs]);

  // Live-video seek path (expensive — only when no frames provided)
  useEffect(() => {
    if (useFrames || !isVisible || !videoReady) return;
    const video = videoRef.current;
    if (!video || !video.duration || video.duration < 2) return;
    const seekRandom = () => {
      const safeStart = Math.min(1, video.duration * 0.05);
      const safeEnd = video.duration * 0.95;
      video.currentTime = safeStart + Math.random() * (safeEnd - safeStart);
    };
    const id = setInterval(seekRandom, 3500);
    return () => clearInterval(id);
  }, [useFrames, isVisible, videoReady]);

  const handleMetadataLoaded = () => {
    const video = videoRef.current;
    if (!video || !video.duration || video.duration < 1) return;
    const safeStart = Math.min(1, video.duration * 0.05);
    const safeEnd = video.duration * 0.95;
    video.currentTime = safeStart + Math.random() * (safeEnd - safeStart);
  };

  const handleSeeked = () => {
    if (!videoReady) setVideoReady(true);
  };

  // ── Render: pre-extracted frames path ──
  if (useFrames) {
    return (
      <div ref={containerRef} className="w-full h-full relative">
        {usableFrames.map((url, i) => (
          <img
            key={url}
            src={url}
            alt={i === 0 ? alt : ""}
            loading={i === 0 ? "eager" : "lazy"}
            className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-700 ${
              i === frameIdx ? "opacity-100" : "opacity-0"
            }`}
          />
        ))}
      </div>
    );
  }

  // ── Render: live-video fallback ──
  return (
    <div ref={containerRef} className="w-full h-full relative">
      {posterUrl && (
        <img
          src={posterUrl}
          alt={alt}
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-700 ${
            videoReady ? "opacity-0" : "opacity-100"
          }`}
        />
      )}

      {isVisible && videoUrl && (
        <video
          ref={videoRef}
          src={videoUrl}
          muted
          playsInline
          preload="metadata"
          onContextMenu={(e) => e.preventDefault()}
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-700 ${
            videoReady ? "opacity-100" : "opacity-0"
          }`}
          onLoadedMetadata={handleMetadataLoaded}
          onSeeked={handleSeeked}
        />
      )}

      {!posterUrl && !videoUrl && (
        <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-pnp-surface to-pnp-bg">
          <svg className="w-8 h-8 text-pnp-textSecondary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
      )}
    </div>
  );
}
