import React, { useState } from "react";
import { submitCallSurvey } from "@/lib/api";

interface PostCallSurveyModalProps {
  open: boolean;
  bookingId: number;
  creatorName: string;
  onClose: () => void;
}

export function PostCallSurveyModal({ open, bookingId, creatorName, onClose }: PostCallSurveyModalProps) {
  const [rating, setRating] = useState(0);
  const [feedback, setFeedback] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      setError(err instanceof Error ? err.message : "Failed to submit");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.7)" }}>
      <div
        className="w-full max-w-sm rounded-2xl p-6"
        style={{ background: "#1C1C1E", border: "1px solid rgba(255,255,255,0.1)" }}
      >
        {submitted ? (
          <div className="flex flex-col items-center gap-3 py-6">
            <div className="w-14 h-14 rounded-full flex items-center justify-center" style={{ background: "rgba(52,199,89,0.15)" }}>
              <svg width="28" height="28" fill="none" viewBox="0 0 24 24" stroke="#34C759" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <span className="text-white font-semibold text-lg">Thank you!</span>
            <span className="text-sm" style={{ color: "#8E8E93" }}>Your feedback helps improve the experience.</span>
          </div>
        ) : (
          <>
            <h3 className="text-white font-semibold text-lg text-center mb-1">
              How was your call?
            </h3>
            <p className="text-sm text-center mb-5" style={{ color: "#8E8E93" }}>
              with {creatorName}
            </p>

            {/* Star rating */}
            <div className="flex justify-center gap-2 mb-5">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  onClick={() => setRating(star)}
                  className="transition-transform hover:scale-110"
                  style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}
                  aria-label={`${star} star${star > 1 ? "s" : ""}`}
                >
                  <svg
                    width="32"
                    height="32"
                    viewBox="0 0 24 24"
                    fill={star <= rating ? "#FFD60A" : "none"}
                    stroke={star <= rating ? "#FFD60A" : "#636366"}
                    strokeWidth={1.5}
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
              placeholder="Share your experience (optional)"
              rows={3}
              className="w-full rounded-xl px-3 py-2.5 text-sm resize-none mb-4"
              style={{
                background: "#2C2C2E",
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
              {submitting ? "Submitting..." : "Submit"}
            </button>

            <button
              onClick={onClose}
              className="w-full py-2 mt-2 text-sm text-center"
              style={{ color: "#8E8E93", background: "none", border: "none", cursor: "pointer" }}
            >
              Skip
            </button>
          </>
        )}
      </div>
    </div>
  );
}
