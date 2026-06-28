import React, { useEffect, useCallback, useRef, useState } from "react";

interface MediaLightboxProps {
  src: string;
  mediaType: "image" | "video";
  mediaList: string[];
  onClose: () => void;
  onNavigate: (url: string) => void;
}

// ─── Touch tracking types ────────────────────────────────────────────────────

interface TouchPoint {
  x: number;
  y: number;
}

function midpoint(a: TouchPoint, b: TouchPoint): TouchPoint {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function distance(a: TouchPoint, b: TouchPoint): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

// ─── Main component ──────────────────────────────────────────────────────────

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

  // ─── Zoom state ─────────────────────────────────────────────────────────
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState<TouchPoint>({ x: 0, y: 0 });

  // Refs for gesture tracking
  const imageWrapRef = useRef<HTMLDivElement>(null);
  // Pinch-to-zoom
  const lastPinchDistRef = useRef<number | null>(null);
  const lastPinchMidRef = useRef<TouchPoint | null>(null);
  const pinchScaleOriginRef = useRef(1);
  const pinchTranslateOriginRef = useRef<TouchPoint>({ x: 0, y: 0 });
  // Swipe
  const swipeStartRef = useRef<TouchPoint | null>(null);
  const swipeStartTimeRef = useRef(0);
  const isSwiping = useRef(false);
  const isZoomedRef = useRef(false);
  // Double-tap
  const lastTapTimeRef = useRef(0);
  const lastTapPosRef = useRef<TouchPoint>({ x: 0, y: 0 });

  // Keep a ref in sync with scale for gesture handlers (avoid stale closures)
  useEffect(() => {
    isZoomedRef.current = scale > 1.05;
  }, [scale]);

  // Reset zoom/pan when navigating to a new item
  useEffect(() => {
    setScale(1);
    setTranslate({ x: 0, y: 0 });
  }, [src]);

  // ─── Navigation ─────────────────────────────────────────────────────────

  const handlePrev = useCallback(() => {
    if (hasPrev) onNavigate(mediaList[currentIndex - 1]);
  }, [hasPrev, currentIndex, mediaList, onNavigate]);

  const handleNext = useCallback(() => {
    if (hasNext) onNavigate(mediaList[currentIndex + 1]);
  }, [hasNext, currentIndex, mediaList, onNavigate]);

  // ─── Keyboard navigation ────────────────────────────────────────────────

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") handlePrev();
      if (e.key === "ArrowRight") handleNext();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, handlePrev, handleNext]);

  // ─── Background scroll lock ──────────────────────────────────────────────

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // ─── Touch handlers ──────────────────────────────────────────────────────

  function getTouchPoint(t: React.Touch): TouchPoint {
    return { x: t.clientX, y: t.clientY };
  }

  function handleTouchStart(e: React.TouchEvent) {
    const now = Date.now();

    if (e.touches.length === 2) {
      // Begin pinch
      const a = getTouchPoint(e.touches[0]);
      const b = getTouchPoint(e.touches[1]);
      lastPinchDistRef.current = distance(a, b);
      lastPinchMidRef.current = midpoint(a, b);
      pinchScaleOriginRef.current = scale;
      pinchTranslateOriginRef.current = { ...translate };
      swipeStartRef.current = null;
      return;
    }

    if (e.touches.length === 1) {
      const pt = getTouchPoint(e.touches[0]);

      // Detect double-tap
      const timeSinceLast = now - lastTapTimeRef.current;
      const tapDist = distance(pt, lastTapPosRef.current);
      if (timeSinceLast < 300 && tapDist < 30) {
        // Double-tap: toggle 1x ↔ 2x
        e.preventDefault();
        if (isZoomedRef.current) {
          setScale(1);
          setTranslate({ x: 0, y: 0 });
        } else {
          // Zoom into the tapped point
          const wrap = imageWrapRef.current;
          if (wrap) {
            const rect = wrap.getBoundingClientRect();
            const cx = pt.x - rect.left - rect.width / 2;
            const cy = pt.y - rect.top - rect.height / 2;
            setScale(2);
            setTranslate({ x: -cx * 0.5, y: -cy * 0.5 });
          } else {
            setScale(2);
            setTranslate({ x: 0, y: 0 });
          }
        }
        lastTapTimeRef.current = 0;
        return;
      }
      lastTapTimeRef.current = now;
      lastTapPosRef.current = pt;

      // Begin swipe/pan
      swipeStartRef.current = pt;
      swipeStartTimeRef.current = now;
      isSwiping.current = false;
      lastPinchDistRef.current = null;
    }
  }

  function handleTouchMove(e: React.TouchEvent) {
    if (e.touches.length === 2) {
      e.preventDefault();
      const a = getTouchPoint(e.touches[0]);
      const b = getTouchPoint(e.touches[1]);
      const currentDist = distance(a, b);
      const currentMid = midpoint(a, b);

      if (lastPinchDistRef.current !== null && lastPinchMidRef.current !== null) {
        const scaleFactor = currentDist / lastPinchDistRef.current;
        const newScale = Math.max(1, Math.min(4, pinchScaleOriginRef.current * scaleFactor));

        // Pan by the delta of the pinch midpoint
        const midDx = currentMid.x - lastPinchMidRef.current.x;
        const midDy = currentMid.y - lastPinchMidRef.current.y;

        setScale(newScale);
        setTranslate({
          x: pinchTranslateOriginRef.current.x + midDx,
          y: pinchTranslateOriginRef.current.y + midDy,
        });
      }
      return;
    }

    if (e.touches.length === 1 && swipeStartRef.current) {
      const pt = getTouchPoint(e.touches[0]);
      const dx = pt.x - swipeStartRef.current.x;
      const dy = pt.y - swipeStartRef.current.y;

      if (isZoomedRef.current) {
        // Panning while zoomed — move image
        e.preventDefault();
        setTranslate((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
        swipeStartRef.current = pt;
      } else {
        // Swipe to navigate — only horizontal, not started a big vertical
        if (!isSwiping.current && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
          isSwiping.current = true;
        }
        if (isSwiping.current) {
          e.preventDefault();
        }
      }
    }
  }

  function handleTouchEnd(e: React.TouchEvent) {
    // Pinch ended — clamp translate so image doesn't drift too far off-screen
    if (e.touches.length < 2 && lastPinchDistRef.current !== null) {
      lastPinchDistRef.current = null;
      lastPinchMidRef.current = null;
      clampTranslate();
      return;
    }

    if (swipeStartRef.current && !isZoomedRef.current) {
      const changedTouches = e.changedTouches;
      if (changedTouches.length > 0) {
        const pt = getTouchPoint(changedTouches[0]);
        const dx = pt.x - swipeStartRef.current.x;
        const elapsed = Date.now() - swipeStartTimeRef.current;
        const isQuick = elapsed < 350;
        const isLong = Math.abs(dx) > 50;

        if (isSwiping.current && (isLong || (isQuick && Math.abs(dx) > 30))) {
          if (dx < 0) {
            handleNext();
          } else {
            handlePrev();
          }
        }
      }
    }

    swipeStartRef.current = null;
    isSwiping.current = false;

    // Clamp after pan-while-zoomed
    if (isZoomedRef.current) {
      clampTranslate();
    }
  }

  // Keep the image within a reasonable pan boundary so it stays visible
  function clampTranslate() {
    setTranslate((prev) => {
      const wrap = imageWrapRef.current;
      if (!wrap) return prev;
      const { width, height } = wrap.getBoundingClientRect();
      // Max pan is half the image's scaled size minus some margin
      const maxX = (width * (scale - 1)) / 2;
      const maxY = (height * (scale - 1)) / 2;
      return {
        x: Math.max(-maxX, Math.min(maxX, prev.x)),
        y: Math.max(-maxY, Math.min(maxY, prev.y)),
      };
    });
  }

  // Reset zoom via button
  function handleResetZoom(e: React.MouseEvent) {
    e.stopPropagation();
    setScale(1);
    setTranslate({ x: 0, y: 0 });
  }

  const isZoomed = scale > 1.05;

  const imageTransformStyle: React.CSSProperties = {
    transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
    transition: lastPinchDistRef.current !== null ? "none" : "transform 0.2s ease",
    touchAction: "none",
    cursor: isZoomed ? "grab" : "default",
    userSelect: "none",
  };

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/90"
      role="dialog"
      aria-modal="true"
      aria-label="Media viewer"
      onClick={isZoomed ? undefined : onClose}
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

      {/* Reset zoom button — only shown when zoomed */}
      {isZoomed && (
        <button
          onClick={handleResetZoom}
          className="absolute top-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent"
          aria-label="Reset zoom"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 15.803M10.5 7.5v6m3-3h-6" />
          </svg>
          {Math.round(scale * 10) / 10}x — tap to reset
        </button>
      )}

      {/* Prev button */}
      {hasPrev && !isZoomed && (
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

      {/* Media content */}
      <div
        ref={imageWrapRef}
        className="flex items-center justify-center max-w-[90vw] max-h-[90vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        onTouchStart={mediaType === "image" ? handleTouchStart : undefined}
        onTouchMove={mediaType === "image" ? handleTouchMove : undefined}
        onTouchEnd={mediaType === "image" ? handleTouchEnd : undefined}
      >
        {mediaType === "image" ? (
          <img
            src={src}
            alt=""
            className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg select-none"
            draggable={false}
            style={imageTransformStyle}
          />
        ) : (
          <video
            src={src}
            controls
            controlsList="nodownload"
            disablePictureInPicture
            onContextMenu={(e) => e.preventDefault()}
            autoPlay
            playsInline
            className="max-w-[90vw] max-h-[90vh] rounded-lg"
          />
        )}
      </div>

      {/* Next button */}
      {hasNext && !isZoomed && (
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
