import React, { useState, useEffect, useCallback, useRef } from "react";

// ─── Types ──────────────────────────────────────────────────────────────────

interface MediaLightboxProps {
  /** The full-resolution URL of the currently displayed media */
  src: string;
  /** Media type: "image" or "video" */
  mediaType?: "image" | "video";
  /** All media URLs in the conversation for swipe-navigation */
  mediaList?: string[];
  /** Called when the lightbox should close */
  onClose: () => void;
  /** Called when the user navigates to a different media item */
  onNavigate?: (src: string) => void;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function MediaLightbox({
  src,
  mediaType = "image",
  mediaList = [],
  onClose,
  onNavigate,
}: MediaLightboxProps) {
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });
  const [swipeX, setSwipeX] = useState(0);
  const [swipeStartX, setSwipeStartX] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const currentIndex = mediaList.indexOf(src);
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < mediaList.length - 1;

  // Reset transform when src changes
  useEffect(() => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
    setSwipeX(0);
  }, [src]);

  // Close on Escape, navigate with arrows
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft" && hasPrev && onNavigate) {
        onNavigate(mediaList[currentIndex - 1]);
      }
      if (e.key === "ArrowRight" && hasNext && onNavigate) {
        onNavigate(mediaList[currentIndex + 1]);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose, hasPrev, hasNext, currentIndex, mediaList, onNavigate]);

  // Lock body scroll while lightbox is open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Double-tap to zoom (toggle between 1x and 2.5x)
  const lastTap = useRef(0);
  const handleTap = useCallback(() => {
    const now = Date.now();
    if (now - lastTap.current < 300) {
      // Double-tap
      if (scale > 1) {
        setScale(1);
        setPosition({ x: 0, y: 0 });
      } else {
        setScale(2.5);
      }
    }
    lastTap.current = now;
  }, [scale]);

  // Pinch-to-zoom support
  const initialDistance = useRef<number | null>(null);
  const initialScale = useRef(1);

  const getDistance = (touches: React.TouchList) => {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      // Pinch start
      initialDistance.current = getDistance(e.touches);
      initialScale.current = scale;
    } else if (e.touches.length === 1 && scale > 1) {
      // Pan start when zoomed
      setIsDragging(true);
      setStartPos({
        x: e.touches[0].clientX - position.x,
        y: e.touches[0].clientY - position.y,
      });
    } else if (e.touches.length === 1 && scale <= 1 && mediaList.length > 1) {
      // Swipe start for navigation
      setSwipeStartX(e.touches[0].clientX);
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && initialDistance.current !== null) {
      // Pinch move
      const dist = getDistance(e.touches);
      const newScale = Math.max(0.5, Math.min(5, initialScale.current * (dist / initialDistance.current)));
      setScale(newScale);
    } else if (e.touches.length === 1 && isDragging && scale > 1) {
      // Pan move
      setPosition({
        x: e.touches[0].clientX - startPos.x,
        y: e.touches[0].clientY - startPos.y,
      });
    } else if (e.touches.length === 1 && swipeStartX !== null && scale <= 1) {
      // Swipe move
      const dx = e.touches[0].clientX - swipeStartX;
      setSwipeX(dx);
    }
  };

  const handleTouchEnd = () => {
    initialDistance.current = null;
    setIsDragging(false);

    // Handle swipe navigation
    if (swipeStartX !== null && scale <= 1) {
      const threshold = 80;
      if (swipeX < -threshold && hasNext && onNavigate) {
        onNavigate(mediaList[currentIndex + 1]);
      } else if (swipeX > threshold && hasPrev && onNavigate) {
        onNavigate(mediaList[currentIndex - 1]);
      }
      setSwipeX(0);
      setSwipeStartX(null);
    }

    // Snap back if scale is less than 1
    if (scale < 1) {
      setScale(1);
      setPosition({ x: 0, y: 0 });
    }
  };

  // Desktop click-to-zoom
  const handleDoubleClick = () => {
    if (scale > 1) {
      setScale(1);
      setPosition({ x: 0, y: 0 });
    } else {
      setScale(2.5);
    }
  };

  // Download handler
  const handleDownload = () => {
    const a = document.createElement("a");
    a.href = src;
    a.download = src.split("/").pop() || "media";
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === containerRef.current) {
      onClose();
    }
  };

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/95"
      onClick={handleBackdropClick}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      role="dialog"
      aria-modal="true"
      aria-label="Full-screen media viewer"
    >
      {/* Top bar: close + download */}
      <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between p-3 bg-gradient-to-b from-black/60 to-transparent">
        <button
          onClick={onClose}
          className="w-11 h-11 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 active:scale-95 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent"
          aria-label="Close media viewer"
        >
          <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Counter */}
        {mediaList.length > 1 && (
          <span className="text-xs text-white/60 font-mono">
            {currentIndex + 1} / {mediaList.length}
          </span>
        )}

        <button
          onClick={handleDownload}
          className="w-11 h-11 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 active:scale-95 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent"
          aria-label="Download media"
        >
          <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
        </button>
      </div>

      {/* Navigation arrows (desktop) */}
      {hasPrev && onNavigate && (
        <button
          onClick={() => onNavigate(mediaList[currentIndex - 1])}
          className="hidden sm:flex absolute left-3 top-1/2 -translate-y-1/2 z-10 w-11 h-11 items-center justify-center rounded-full bg-white/10 hover:bg-white/20 active:scale-95 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent"
          aria-label="Previous media"
        >
          <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      )}
      {hasNext && onNavigate && (
        <button
          onClick={() => onNavigate(mediaList[currentIndex + 1])}
          className="hidden sm:flex absolute right-3 top-1/2 -translate-y-1/2 z-10 w-11 h-11 items-center justify-center rounded-full bg-white/10 hover:bg-white/20 active:scale-95 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent"
          aria-label="Next media"
        >
          <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      )}

      {/* Media content */}
      <div
        className="flex items-center justify-center w-full h-full select-none"
        style={{
          transform: `translate(${position.x + swipeX}px, ${position.y}px) scale(${scale})`,
          transition: isDragging || swipeStartX !== null ? "none" : "transform 0.2s ease-out",
          touchAction: "none",
        }}
        onClick={handleTap}
        onDoubleClick={handleDoubleClick}
      >
        {mediaType === "video" ? (
          <video
            src={src}
            controls
            autoPlay
            playsInline
            className="max-w-full max-h-full object-contain rounded-lg"
            aria-label="Full-screen video"
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <img
            src={src}
            alt="Full-size media"
            className="max-w-full max-h-full object-contain rounded-lg"
            draggable={false}
            onClick={(e) => e.stopPropagation()}
          />
        )}
      </div>
    </div>
  );
}
