import React, { useState, useRef, useEffect } from "react";
import { Helmet } from "react-helmet-async";
import { useI18n } from "@/lib/i18n";
import { CristinaWidget } from "@/components/CristinaWidget";
import { createSupportTicket } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";

function getDeviceContext() {
  const loc = window.location;
  return [
    `URL: ${loc.pathname}${loc.search}`,
    `UA: ${navigator.userAgent}`,
    `Screen: ${screen.width}x${screen.height} (${window.devicePixelRatio}x)`,
    `Viewport: ${window.innerWidth}x${window.innerHeight}`,
    `Lang: ${navigator.language}`,
    `Time: ${new Date().toISOString()}`,
  ].join("\n");
}

export function Support() {
  const { support: t } = useI18n();
  const { isAuthenticated } = useAuth();
  const [showBugModal, setShowBugModal] = useState(false);
  const [bugText, setBugText] = useState("");
  const [bugSending, setBugSending] = useState(false);
  const [bugSent, setBugSent] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (showBugModal && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [showBugModal]);

  const handleSubmitBug = async () => {
    if (!bugText.trim() || bugText.trim().length < 10) return;
    setBugSending(true);
    try {
      const desc = `${bugText.trim()}\n\n--- Device Info ---\n${getDeviceContext()}`;
      await createSupportTicket("bug", desc);
      setBugSent(true);
      setTimeout(() => {
        setShowBugModal(false);
        setBugText("");
        setBugSent(false);
      }, 2000);
    } catch {
      // fall through
    } finally {
      setBugSending(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <Helmet>
        <title>{t.pageTitle}</title>
        <meta name="description" content={t.pageDescription} />
      </Helmet>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-pnp-textPrimary mb-1">
          {t.pageHeading}
        </h1>
        <p className="text-sm text-pnp-textSecondary">
          {t.pageSubtitle}
        </p>
      </div>

      {/* Quick Bug Report Card */}
      {isAuthenticated && (
        <button
          onClick={() => setShowBugModal(true)}
          className="w-full mb-6 p-4 rounded-xl text-left transition-all hover:scale-[1.01] active:scale-[0.99]"
          style={{
            background: "linear-gradient(135deg, rgba(239,68,68,0.12), rgba(239,68,68,0.04))",
            border: "1px solid rgba(239,68,68,0.2)",
          }}
        >
          <div className="flex items-center gap-3">
            <div className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center text-lg"
              style={{ background: "rgba(239,68,68,0.15)" }}>
              <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 12.75c1.148 0 2.278.08 3.383.237 1.037.146 1.866.966 1.866 2.013 0 3.728-2.35 6.75-5.25 6.75S6.75 18.728 6.75 15c0-1.046.83-1.867 1.866-2.013A24.204 24.204 0 0112 12.75zm0 0c2.883 0 5.647.508 8.207 1.44a23.91 23.91 0 01-1.152-6.135 23.863 23.863 0 01.497-5.93c.15-.667-.107-1.358-.661-1.755a1.908 1.908 0 00-1.902-.098L12 3.75 6.99.375a1.91 1.91 0 00-1.902.098c-.554.397-.81 1.088-.66 1.755.27 1.215.426 2.47.496 5.93a23.91 23.91 0 01-1.152 6.135A24.087 24.087 0 0112 12.75z" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-red-400">{t.reportBugCard}</p>
              <p className="text-xs text-pnp-textSecondary mt-0.5 line-clamp-2">{t.reportBugCardDesc}</p>
            </div>
            <svg className="w-4 h-4 text-pnp-textSecondary flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
            </svg>
          </div>
        </button>
      )}

      <CristinaWidget mode="page" />

      {/* Bug Report Modal */}
      {showBugModal && (
        <div
          className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center"
          onClick={() => !bugSending && setShowBugModal(false)}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div
            className="relative w-full sm:max-w-md mx-auto bg-pnp-surface rounded-t-2xl sm:rounded-2xl p-5 shadow-2xl border border-white/10 animate-in slide-in-from-bottom duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-pnp-textPrimary flex items-center gap-2">
                <span className="text-red-400">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 12.75c1.148 0 2.278.08 3.383.237 1.037.146 1.866.966 1.866 2.013 0 3.728-2.35 6.75-5.25 6.75S6.75 18.728 6.75 15c0-1.046.83-1.867 1.866-2.013A24.204 24.204 0 0112 12.75zm0 0c2.883 0 5.647.508 8.207 1.44a23.91 23.91 0 01-1.152-6.135 23.863 23.863 0 01.497-5.93c.15-.667-.107-1.358-.661-1.755a1.908 1.908 0 00-1.902-.098L12 3.75 6.99.375a1.91 1.91 0 00-1.902.098c-.554.397-.81 1.088-.66 1.755.27 1.215.426 2.47.496 5.93a23.91 23.91 0 01-1.152 6.135A24.087 24.087 0 0112 12.75z" />
                  </svg>
                </span>
                {t.reportBugTitle}
              </h2>
              <button
                onClick={() => !bugSending && setShowBugModal(false)}
                className="p-1.5 rounded-lg text-pnp-textSecondary hover:text-pnp-textPrimary hover:bg-white/5 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {bugSent ? (
              <div className="flex flex-col items-center py-8 gap-3">
                <div className="w-12 h-12 rounded-full bg-green-500/15 flex items-center justify-center">
                  <svg className="w-6 h-6 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <p className="text-sm text-green-400 font-medium text-center">{t.reportBugSuccess}</p>
              </div>
            ) : (
              <>
                <textarea
                  ref={textareaRef}
                  value={bugText}
                  onChange={(e) => setBugText(e.target.value)}
                  placeholder={t.reportBugPlaceholder}
                  maxLength={2000}
                  rows={5}
                  className="w-full rounded-xl p-3 text-sm bg-pnp-dark text-pnp-textPrimary placeholder:text-pnp-textSecondary/50 border border-white/10 focus:border-red-400/50 focus:outline-none resize-none"
                />
                <div className="flex items-center justify-between mt-2 mb-4">
                  <p className="text-[10px] text-pnp-textSecondary">{t.reportBugDeviceInfo}</p>
                  <p className="text-[10px] text-pnp-textSecondary">{bugText.length}/2000</p>
                </div>
                <button
                  onClick={handleSubmitBug}
                  disabled={bugSending || bugText.trim().length < 10}
                  className="w-full py-2.5 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-40"
                  style={{ background: "linear-gradient(135deg, #ef4444, #dc2626)" }}
                >
                  {bugSending ? t.reportBugSending : t.reportBugSubmit}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default Support;
