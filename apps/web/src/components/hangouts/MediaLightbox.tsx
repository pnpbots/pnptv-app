import React, { useEffect, useCallback } from "react";

interface MediaLightboxProps {
  src: string;
  mediaType: "image" | "video";
  mediaList: string[];
  onClose: () => void;
  onNavigate: (url: string) => void;
}

export function MediaLightbox({
  src,
  mediaType,
  mediaList,
  onClose,
  onNavigate,
}: MediaLightboxProps) {
  const currentIndex = mediaList.indexOf(src);
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < mediaList.length - 1;

  const handlePrev = useCallback(() => {
    if (hasPrev) onNavigate(mediaList[currentIndex - 1]);
  }, [hasPrev, currentIndex, mediaList, onNavigate]);

  const handleNext = useCallback(() => {
    if (hasNext) onNavigate(mediaList[currentIndex + 1]);
  }, [hasNext, currentIndex, mediaList, onNavigate]);

  // Keyboard navigation
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") handlePrev();
      if (e.key === "ArrowRight") handleNext();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, handlePrev, handleNext]);

  // Prevent background scroll while lightbox is open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/90"
      role="dialog"
      aria-modal="true"
      aria-label="Media viewer"
      onClick={onClose}
    >
      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 z-10 w-10 h-10 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent"
        aria-label="Close"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      {/* Prev button */}
      {hasPrev && (
        <button
          onClick={(e) => { e.stopPropagation(); handlePrev(); }}
          className="absolute left-3 z-10 w-10 h-10 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent"
          aria-label="Previous image"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      )}

      {/* Media content — stopPropagation so clicking the image itself doesn't close */}
      <div
        className="flex items-center justify-center max-w-[90vw] max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {mediaType === "image" ? (
          <img
            src={src}
            alt=""
            className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg select-none"
            draggable={false}
          />
        ) : (
          <video
            src={src}
            controls
            autoPlay
            playsInline
            className="max-w-[90vw] max-h-[90vh] rounded-lg"
          />
        )}
      </div>

      {/* Next button */}
      {hasNext && (
        <button
          onClick={(e) => { e.stopPropagation(); handleNext(); }}
          className="absolute right-3 z-10 w-10 h-10 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent"
          aria-label="Next image"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      )}

      {/* Position counter */}
      {mediaList.length > 1 && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-xs text-white/60 bg-black/40 px-3 py-1 rounded-full">
          {currentIndex + 1} / {mediaList.length}
        </div>
      )}
    </div>
  );
}
