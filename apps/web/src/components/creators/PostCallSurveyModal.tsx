import React, { useState, useEffect } from "react";
import { submitCallSurvey } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

interface PostCallSurveyModalProps {
  open: boolean;
  bookingId: number;
  creatorName: string;
  onClose: () => void;
}

export function PostCallSurveyModal({ open, bookingId, creatorName, onClose }: PostCallSurveyModalProps) {
  const t = useI18n();
  const [rating, setRating] = useState(0);
  const [feedback, setFeedback] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Bug M-07: reset form state each time the modal is opened so stale data never shows
  useEffect(() => {
    if (open) {
      setRating(0);
      setFeedback("");
      setSubmitted(false);
      setError(null);
    }
  }, [open]);

  const modalRef = React.useRef<HTMLDivElement>(null);

  // Escape key handler + focus trap
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (!submitting) onClose();
        return;
      }
      if (e.key === "Tab" && modalRef.current) {
        const focusable = modalRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        const focusableArr = Array.from(focusable).filter((el) => !el.hasAttribute("disabled"));
        if (focusableArr.length === 0) return;
        const first = focusableArr[0];
        const last = focusableArr[focusableArr.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) { e.preventDefault(); last.focus(); }
        } else {
          if (document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose, submitting]);

  if (!open) return null;

  const handleSubmit = async () => {
    if (rating < 1) return;
    setSubmitting(true);
    setError(null);
    try {
      await submitCallSurvey(bookingId, { rating: rating as 1|2|3|4|5, feedback: feedback || undefined });
      setSubmitted(true);
      setTimeout(onClose, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.creator.surveyFailedToSubmit);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}
      onClick={() => { if (!submitting) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label={t.creator.ariaPostCallSurvey}
    >
      <div
        ref={modalRef}
        className="w-full max-w-sm rounded-2xl p-6"
        style={{ background: "var(--pnp-surface, #1C1C1E)", border: "1px solid rgba(255,255,255,0.1)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {submitted ? (
          <div
            className="flex flex-col items-center gap-3 py-6"
            aria-live="assertive"
            aria-atomic="true"
          >
            <div className="w-14 h-14 rounded-full flex items-center justify-center" style={{ background: "rgba(52,199,89,0.15)" }}>
              <svg width="28" height="28" fill="none" viewBox="0 0 24 24" stroke="#34C759" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <span className="text-white font-semibold text-lg">{t.creator.surveyThankYou}</span>
            <span className="text-sm" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>{t.creator.surveyFeedbackHelps}</span>
          </div>
        ) : (
          <>
            <h3 className="text-white font-semibold text-lg text-center mb-1">
              {t.creator.surveyHowWasCall}
            </h3>
            <p className="text-sm text-center mb-5" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
              {t.creator.surveyWith(creatorName)}
            </p>

            {/* Star rating */}
            <div
              className="flex justify-center gap-1 mb-5"
              role="radiogroup"
              aria-label={t.creator.ariaRateYourCall}
            >
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  role="radio"
                  aria-checked={rating === star}
                  onClick={() => setRating(star)}
                  className="min-w-[44px] min-h-[44px] flex items-center justify-center transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#1C1C1E] rounded-lg"
                  style={{ background: "none", border: "none", cursor: "pointer" }}
                  aria-label={star === 1 ? t.creator.ariaStar(star) : t.creator.ariaStars(star)}
                >
                  <svg
                    width="32"
                    height="32"
                    viewBox="0 0 24 24"
                    fill={star <= rating ? "#FFD60A" : "none"}
                    stroke={star <= rating ? "#FFD60A" : "#636366"}
                    strokeWidth={1.5}
                    aria-hidden="true"
                  >
                    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                  </svg>
                </button>
              ))}
            </div>

            {/* Feedback textarea */}
            <textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder={t.creator.surveyPlaceholder}
              rows={3}
              className="w-full rounded-xl px-3 py-2.5 text-sm resize-none mb-4"
              style={{
                background: "var(--pnp-surface-hover, #2C2C2E)",
                border: "1px solid rgba(255,255,255,0.1)",
                color: "#EBEBF5",
                outline: "none",
              }}
            />

            {error && (
              <p className="text-xs text-center mb-3" style={{ color: "#FF6B6B" }}>{error}</p>
            )}

            <button
              onClick={handleSubmit}
              disabled={rating < 1 || submitting}
              className="w-full py-3 rounded-xl font-semibold text-sm text-white transition-opacity disabled:opacity-40"
              style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
            >
              {submitting ? t.creator.surveySubmitting : t.creator.surveySubmit}
            </button>

            <button
              onClick={onClose}
              className="w-full py-2 mt-2 text-sm text-center"
              style={{ color: "var(--pnp-text-secondary, #8E8E93)", background: "none", border: "none", cursor: "pointer" }}
            >
              {t.creator.surveySkip}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
