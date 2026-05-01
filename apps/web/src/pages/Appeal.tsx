import React, { useState } from "react";
import { Helmet } from "react-helmet-async";
import { useI18n } from "@/lib/i18n";
import { submitAppeal } from "@/lib/api";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export default function Appeal() {
  const t = useI18n();
  const p = t.profile;

  const [identifier, setIdentifier] = useState("");
  const [email, setEmail] = useState("");
  const [explanation, setExplanation] = useState("");
  // Honeypot — hidden input bots fill in
  const [honeypot, setHoneypot] = useState("");

  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const canSubmit =
    identifier.trim().length > 0 &&
    EMAIL_RE.test(email.trim()) &&
    explanation.trim().length >= 20 &&
    !sending;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSending(true);
    setError(null);
    try {
      const res = await submitAppeal({
        submittedIdentifier: identifier.trim(),
        contactEmail: email.trim(),
        explanation: explanation.trim(),
        honeypot: honeypot.trim() || undefined,
      });
      if (res.success) {
        setSent(true);
      } else {
        switch (res.code) {
          case "INVALID_EMAIL":
            setError(p.appealErrorInvalidEmail);
            break;
          case "EXPLANATION_TOO_SHORT":
          case "EXPLANATION_TOO_LONG":
            setError(p.appealErrorTooShort);
            break;
          case "RATE_LIMITED_HOUR":
            setError(p.appealErrorRateLimitedHour);
            break;
          case "RATE_LIMITED_DAY":
            setError(p.appealErrorRateLimitedDay);
            break;
          case "DUPLICATE_PENDING":
            setError(p.appealErrorDuplicate);
            break;
          default:
            setError(res.error || p.appealErrorGeneric);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : p.appealErrorGeneric);
    }
    setSending(false);
  };

  return (
    <div className="min-h-dvh bg-pnp-background flex items-center justify-center px-4 py-12">
      <Helmet>
        <title>{p.appealPageTitle} — PNPtv!</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>

      <div className="w-full max-w-md">
        {/* Logo / header */}
        <div className="text-center mb-6">
          <div
            className="inline-flex w-16 h-16 rounded-2xl items-center justify-center mb-3 shadow-lg"
            style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
          >
            <span className="text-2xl font-black text-white">PNP</span>
          </div>
          <h1 className="text-2xl font-bold text-white">{p.appealPageTitle}</h1>
        </div>

        <div
          className="rounded-2xl p-5 sm:p-6"
          style={{ background: "rgba(28,28,30,0.85)", border: "1px solid rgba(255,255,255,0.08)", backdropFilter: "blur(20px)" }}
        >
          {sent ? (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <div className="w-14 h-14 rounded-full bg-green-500/15 flex items-center justify-center">
                <svg className="w-7 h-7 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-lg font-semibold text-white">{p.appealSuccessTitle}</h2>
              <p className="text-sm text-white/70 leading-relaxed">{p.appealSuccessBody}</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              <p className="text-sm text-white/70 leading-relaxed">{p.appealIntro}</p>

              <div>
                <label htmlFor="appeal-identifier" className="block text-xs font-medium text-white/60 mb-1.5">
                  {p.appealIdentifierLabel}
                </label>
                <input
                  id="appeal-identifier"
                  type="text"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder={p.appealIdentifierPlaceholder}
                  autoComplete="username"
                  maxLength={255}
                  className="w-full rounded-lg px-3 py-2.5 text-sm text-white outline-none transition-colors focus:border-pnp-accent"
                  style={{
                    background: "rgba(255,255,255,0.05)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    fontSize: "16px",
                  }}
                />
              </div>

              <div>
                <label htmlFor="appeal-email" className="block text-xs font-medium text-white/60 mb-1.5">
                  {p.appealEmailLabel}
                </label>
                <input
                  id="appeal-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={p.appealEmailPlaceholder}
                  autoComplete="email"
                  inputMode="email"
                  maxLength={255}
                  className="w-full rounded-lg px-3 py-2.5 text-sm text-white outline-none transition-colors focus:border-pnp-accent"
                  style={{
                    background: "rgba(255,255,255,0.05)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    fontSize: "16px",
                  }}
                />
              </div>

              <div>
                <label htmlFor="appeal-explanation" className="block text-xs font-medium text-white/60 mb-1.5">
                  {p.appealExplanationLabel}
                </label>
                <textarea
                  id="appeal-explanation"
                  value={explanation}
                  onChange={(e) => setExplanation(e.target.value)}
                  placeholder={p.appealExplanationPlaceholder}
                  rows={5}
                  maxLength={2000}
                  className="w-full rounded-lg px-3 py-2.5 text-sm text-white outline-none transition-colors focus:border-pnp-accent resize-none"
                  style={{
                    background: "rgba(255,255,255,0.05)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    fontSize: "16px",
                  }}
                />
                <div className="text-[10px] text-white/40 text-right mt-1">{explanation.length}/2000</div>
              </div>

              {/* Honeypot — visually hidden, aria-hidden, bots will fill it */}
              <div style={{ position: "absolute", left: "-10000px", top: "auto", width: 1, height: 1, overflow: "hidden" }} aria-hidden="true">
                <label htmlFor="appeal-website">Website</label>
                <input
                  id="appeal-website"
                  type="text"
                  tabIndex={-1}
                  autoComplete="off"
                  value={honeypot}
                  onChange={(e) => setHoneypot(e.target.value)}
                />
              </div>

              {error && <p className="text-xs text-red-400 text-center">{error}</p>}

              <button
                type="submit"
                disabled={!canSubmit}
                className="w-full py-3 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-40 active:scale-[0.98]"
                style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
              >
                {sending ? p.appealSubmitting : p.appealSubmit}
              </button>
            </form>
          )}
        </div>

        <p className="text-center text-[10px] text-white/30 mt-6">
          PNPtv! &middot; pnptv.app
        </p>
      </div>
    </div>
  );
}
