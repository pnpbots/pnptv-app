import React from "react";
import { CristinaAvatar } from "./CristinaAvatar";
import { TutorialIllustration } from "./tutorialIllustrations";
import type { TutorialSlide as SlideData } from "@/lib/tutorialContent";

interface TutorialSlideProps {
  slide: SlideData;
  direction: "left" | "right";
  lang: "en" | "es";
}

export function TutorialSlideView({ slide, direction, lang }: TutorialSlideProps) {
  const title = lang === "es" ? slide.titleEs : slide.titleEn;
  const desc = lang === "es" ? slide.descEs : slide.descEn;
  const animClass = direction === "right" ? "tutorial-slide-enter-right" : "tutorial-slide-enter-left";

  return (
    <div className={animClass} key={title}>
      {/* Illustration */}
      <div className="mb-5">
        <TutorialIllustration name={slide.illustration} />
      </div>

      {/* Narrator */}
      <div className="flex items-center gap-2 mb-3">
        <CristinaAvatar size={28} />
        <span className="text-xs text-cyan-400 font-semibold">Cristina AI</span>
      </div>

      {/* Title */}
      <h2
        className="text-lg font-bold text-white mb-2"
        style={{ fontFamily: '"Ethnocentric Rg", "Roboto Mono", monospace', letterSpacing: "0.04em" }}
      >
        {title}
      </h2>

      {/* Description */}
      <p className="text-sm text-white/70 leading-relaxed">{desc}</p>
    </div>
  );
}
