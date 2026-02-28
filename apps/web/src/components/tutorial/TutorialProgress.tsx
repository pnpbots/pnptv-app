import React from "react";

interface TutorialProgressProps {
  current: number;
  total: number;
  onBack: () => void;
  onNext: () => void;
  onSkip: () => void;
  lang: "en" | "es";
}

export function TutorialProgress({ current, total, onBack, onNext, onSkip, lang }: TutorialProgressProps) {
  const isLast = current === total - 1;

  return (
    <div className="flex flex-col gap-4">
      {/* Progress dots */}
      <div className="flex items-center justify-center gap-2">
        {Array.from({ length: total }).map((_, i) => (
          <div
            key={i}
            className="h-1.5 rounded-full transition-all duration-300"
            style={{
              width: i === current ? 24 : 8,
              background: i === current
                ? "linear-gradient(135deg, #D4007A, #E69138)"
                : "rgba(255, 255, 255, 0.2)",
            }}
          />
        ))}
      </div>

      {/* Buttons */}
      <div className="flex items-center justify-between">
        {current > 0 ? (
          <button
            onClick={onBack}
            className="px-4 py-2 rounded-lg text-sm text-white/60 hover:text-white/90 transition-colors"
          >
            {lang === "es" ? "Atras" : "Back"}
          </button>
        ) : (
          <button
            onClick={onSkip}
            className="px-4 py-2 rounded-lg text-sm text-white/60 hover:text-white/90 transition-colors"
          >
            {lang === "es" ? "Saltar" : "Skip"}
          </button>
        )}

        <button
          onClick={onNext}
          className="px-6 py-2 rounded-lg text-sm font-semibold text-white btn-gradient"
        >
          {isLast
            ? (lang === "es" ? "Comenzar" : "Got it!")
            : (lang === "es" ? "Siguiente" : "Next")}
        </button>
      </div>
    </div>
  );
}
