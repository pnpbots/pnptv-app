import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { getLocalizedTips, type MainStageTip } from "@/lib/i18n/mainStageTips";

const TIP_FIRST_DELAY_MS = 10 * 1000;
const TIP_INTERVAL_MS = 5 * 60 * 1000;
const TIP_VISIBLE_MS = 15 * 1000;

type TipItem = MainStageTip;

function getWellnessTips(): TipItem[] {
  return getLocalizedTips();
}

export function WellnessTipsOverlay() {
  const { live: wellnessT } = useI18n();
  const [tip, setTip] = useState<TipItem | null>(null);
  const [visible, setVisible] = useState(false);
  const indexRef = useRef(0);
  const tipsRef = useRef<TipItem[]>(getWellnessTips());
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const showNext = () => {
      const tips = tipsRef.current;
      if (!tips.length) return;
      const next = tips[indexRef.current % tips.length];
      indexRef.current += 1;
      setTip(next);
      setVisible(true);
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = setTimeout(() => setVisible(false), TIP_VISIBLE_MS);
    };

    // Show the first tip shortly after entry so users actually see one in a
    // typical session, then settle into the longer recurring cadence.
    const firstTimer = setTimeout(showNext, TIP_FIRST_DELAY_MS);
    const intervalId = setInterval(showNext, TIP_INTERVAL_MS);
    return () => {
      clearTimeout(firstTimer);
      clearInterval(intervalId);
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    };
  }, []);

  const handleClose = () => {
    setVisible(false);
    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
  };

  if (!tip) return null;

  // Slim non-blocking ribbon anchored BELOW the cam grid, ABOVE the bottom bar.
  // Uses absolute positioning within the page's flex column so it never
  // overlaps cammer video tiles regardless of screen size.
  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="flex-shrink-0 overflow-hidden"
      style={{
        maxHeight: visible ? "56px" : "0px",
        opacity: visible ? 1 : 0,
        transition: "max-height 0.35s cubic-bezier(0.2,0.9,0.3,1), opacity 0.30s",
        background: "rgba(10,10,15,0.88)",
        borderTop: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      <div className="flex items-center gap-2.5 px-3 h-14">
        {/* Emoji icon */}
        <span className="text-xl flex-shrink-0" aria-hidden>
          {tip.emoji}
        </span>

        {/* Tip text */}
        <p className="flex-1 text-[12px] text-white/80 leading-snug line-clamp-2 min-w-0">
          {tip.body}
        </p>

        {/* Dismiss */}
        <button
          type="button"
          aria-label={wellnessT.mainStageWellnessAriaDismiss}
          onClick={handleClose}
          className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-full transition-all active:scale-[0.92] bg-white/[0.06] border border-white/[0.08]"
        >
          <svg className="w-3 h-3 text-white/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
