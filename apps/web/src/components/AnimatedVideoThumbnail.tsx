import React, { useRef, useState, useEffect } from "react";

interface Props {
  videoUrl: string | null;
  posterUrl: string | null;
  alt: string;
}

/**
 * Displays a video thumbnail that cycles through random frames.
 * Only loads the video when the element is visible (IntersectionObserver).
 * Falls back to the static poster image if video can't load.
 */
export function AnimatedVideoThumbnail({ videoUrl, posterUrl, alt }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [videoReady, setVideoReady] = useState(false);

  // Only activate when scrolled into view
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !videoUrl) return;

    const observer = new IntersectionObserver(
      ([entry]) => setIsVisible(entry.isIntersecting),
      { threshold: 0.2 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [videoUrl]);

  // Seek to random frames periodically
  useEffect(() => {
    if (!isVisible || !videoReady) return;
    const video = videoRef.current;
    if (!video || !video.duration || video.duration < 2) return;

    const seekRandom = () => {
      // Avoid the very start and end (often black frames)
      const safeStart = Math.min(1, video.duration * 0.05);
      const safeEnd = video.duration * 0.95;
      video.currentTime = safeStart + Math.random() * (safeEnd - safeStart);
    };

    // Initial random seek already happened in onLoadedMetadata,
    // so start the interval for subsequent seeks
    const id = setInterval(seekRandom, 3500);
    return () => clearInterval(id);
  }, [isVisible, videoReady]);

  const handleMetadataLoaded = () => {
    const video = videoRef.current;
    if (!video || !video.duration || video.duration < 1) return;
    // Seek to a random initial frame
    const safeStart = Math.min(1, video.duration * 0.05);
    const safeEnd = video.duration * 0.95;
    video.currentTime = safeStart + Math.random() * (safeEnd - safeStart);
  };

  const handleSeeked = () => {
    // Video has seeked to the new frame — it's ready to show
    if (!videoReady) setVideoReady(true);
  };

  return (
    <div ref={containerRef} className="w-full h-full relative">
      {/* Static poster — always rendered as fallback */}
      {posterUrl && (
        <img
          src={posterUrl}
          alt={alt}
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-700 ${
            videoReady ? "opacity-0" : "opacity-100"
          }`}
        />
      )}

      {/* Video frame cycler — only mounted when visible */}
      {isVisible && videoUrl && (
        <video
          ref={videoRef}
          src={videoUrl}
          muted
          playsInline
          preload="metadata"
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-700 ${
            videoReady ? "opacity-100" : "opacity-0"
          }`}
          onLoadedMetadata={handleMetadataLoaded}
          onSeeked={handleSeeked}
        />
      )}

      {/* Fallback when no poster and no video */}
      {!posterUrl && !videoUrl && (
        <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-pnp-surface to-pnp-bg">
          <svg
            className="w-8 h-8 text-pnp-textSecondary"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </div>
      )}
    </div>
  );
}
