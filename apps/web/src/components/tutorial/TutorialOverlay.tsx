import React, { useState, useRef, useCallback, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { tutorialContent } from "@/lib/tutorialContent";
import { TutorialSlideView } from "./TutorialSlide";
import { TutorialProgress } from "./TutorialProgress";

interface TutorialOverlayProps {
  section: string;
  onDismiss: () => void;
  onDismissForever?: () => void;
}

export function TutorialOverlay({ section, onDismiss, onDismissForever }: TutorialOverlayProps) {
  const { user } = useAuth();
  const lang = user?.language === "es" ? "es" : "en";

  const content = tutorialContent[section];
  const slides = content?.slides ?? [];
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState<"left" | "right">("right");
  const [exiting, setExiting] = useState(false);

  const touchStartX = useRef(0);

  // Lock body scroll while overlay is open
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  const close = useCallback(() => {
    setExiting(true);
    setTimeout(onDismiss, 300);
  }, [onDismiss]);

  const next = useCallback(() => {
    if (index >= slides.length - 1) {
      close();
    } else {
      setDirection("right");
      setIndex((i) => i + 1);
    }
  }, [index, slides.length, close]);

  const back = useCallback(() => {
    if (index > 0) {
      setDirection("left");
      setIndex((i) => i - 1);
    }
  }, [index]);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  }, []);

  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    const dx = touchStartX.current - e.changedTouches[0].clientX;
    if (Math.abs(dx) < 50) return;
    if (dx > 0) next();
    else back();
  }, [next, back]);

  if (!content) return null;

  return (
    <div
      className={`fixed inset-0 z-[60] flex items-center justify-center p-4 ${exiting ? "tutorial-overlay-exit" : "tutorial-overlay-enter"}`}
      style={{ background: "rgba(0, 0, 0, 0.80)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" }}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <div className="tutorial-glass-card w-full max-w-sm p-6">
        <TutorialSlideView
          slide={slides[index]}
          direction={direction}
          lang={lang as "en" | "es"}
        />
        <div className="mt-6">
          <TutorialProgress
            current={index}
            total={slides.length}
            onBack={back}
            onNext={next}
            onSkip={close}
            lang={lang as "en" | "es"}
          />
          {onDismissForever && (
            <button
              onClick={() => {
                setExiting(true);
                setTimeout(onDismissForever, 300);
              }}
              className="w-full mt-3 py-2 text-xs text-white/40 hover:text-white/70 transition-colors text-center"
            >
              {lang === "es" ? "No mostrar de nuevo" : "Don't show again"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
