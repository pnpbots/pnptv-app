import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useI18n } from "@/lib/i18n";
import { getRtmpKey } from "@/lib/api";

export default function StudioHome() {
  const t = useI18n();
  const navigate = useNavigate();

  // RTMP credentials
  const [rtmpInfo, setRtmpInfo] = useState<{ rtmpUrl: string; streamKey: string } | null>(null);
  const [rtmpLoading, setRtmpLoading] = useState(false);
  const [rtmpError, setRtmpError] = useState<string | null>(null);
  const [showStreamKey, setShowStreamKey] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const loadRtmpCredentials = async () => {
    if (rtmpInfo) return; // Already loaded
    setRtmpLoading(true);
    setRtmpError(null);
    try {
      const result = await getRtmpKey();
      if (result.success && result.rtmpUrl && result.streamKey) {
        setRtmpInfo({ rtmpUrl: result.rtmpUrl, streamKey: result.streamKey });
      } else {
        setRtmpError(result.error || t.errorLoadingCredentials);
      }
    } catch (err: unknown) {
      setRtmpError(err instanceof Error ? err.message : t.errorLoadingCredentials);
    } finally {
      setRtmpLoading(false);
    }
  };

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard?.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  return (
    <div className="space-y-6 animate-fade-in-up">
      <div>
        <h1 className="text-lg font-bold text-white">{t.studioTitle}</h1>
        <p className="text-xs text-pnp-textSecondary mt-1">{t.studioSubtitle}</p>
      </div>

      {/* Stream from Browser */}
      <button
        onClick={() => navigate("/stream")}
        className="w-full flex items-center gap-4 p-5 rounded-2xl border border-pnp-accent/30 bg-pnp-accent/5 hover:bg-pnp-accent/10 transition-colors text-left"
      >
        <div className="w-12 h-12 rounded-full bg-pnp-accent/20 flex items-center justify-center flex-shrink-0">
          <svg className="w-6 h-6 text-pnp-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white">{t.streamFromBrowser}</p>
          <p className="text-xs text-pnp-textSecondary mt-0.5">{t.streamFromBrowserDesc}</p>
        </div>
        <svg className="w-5 h-5 text-pnp-textSecondary flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </button>

      {/* RTMP / OBS */}
      <div className="glass-card-sm p-5 space-y-4">
        <button
          onClick={loadRtmpCredentials}
          disabled={rtmpLoading}
          className="w-full flex items-center gap-4 text-left"
        >
          <div className="w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: "rgba(255,255,255,0.05)" }}>
            <svg className="w-6 h-6 text-pnp-textSecondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-white">{t.rtmpObs}</p>
            <p className="text-xs text-pnp-textSecondary mt-0.5">{t.rtmpObsDesc}</p>
          </div>
          {!rtmpInfo && (
            <svg className="w-5 h-5 text-pnp-textSecondary flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={rtmpLoading ? "M12 6v6m0 0v6m0-6h6m-6 0H6" : "M19 9l-7 7-7-7"} />
            </svg>
          )}
        </button>

        {rtmpLoading && (
          <div className="flex justify-center py-4">
            <div className="w-6 h-6 border-2 border-pnp-accent border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {rtmpError && (
          <div className="px-4 py-3 rounded-xl text-xs bg-pnp-error/10 border border-pnp-error/25 text-white/80">
            {rtmpError}
          </div>
        )}

        {rtmpInfo && (
          <div className="space-y-3 pt-2 border-t border-pnp-border/30">
            {/* OBS Setup guide */}
            <div className="space-y-2 pb-1">
              <p className="text-[10px] font-semibold text-pnp-textSecondary uppercase tracking-wider">OBS Setup</p>
              {([
                { step: 1 as const, text: t.obsStep1 },
                { step: 2 as const, text: t.obsStep2 },
                { step: 3 as const, text: t.obsStep3 },
              ]).map(({ step, text }) => (
                <div key={step} className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center text-[10px] font-bold text-white" style={{ background: "linear-gradient(135deg,#D4007A,#E69138)" }}>{step}</span>
                  <p className="text-xs text-pnp-textSecondary pt-0.5">{text}</p>
                </div>
              ))}
            </div>
            {/* RTMP Server */}
            <div>
              <label className="text-xs text-pnp-textSecondary uppercase tracking-wider block mb-1">{t.rtmpServer}</label>
              <div className="flex items-center gap-2 bg-pnp-surface border border-pnp-border rounded-lg px-3 py-2">
                <code className="text-sm text-pnp-textPrimary flex-1 break-all">{rtmpInfo.rtmpUrl}</code>
                <button
                  onClick={() => copyToClipboard(rtmpInfo.rtmpUrl, "rtmp")}
                  className="text-pnp-textSecondary hover:text-pnp-accent flex-shrink-0 transition-colors"
                  aria-label={t.copyRtmpUrl}
                >
                  {copiedField === "rtmp" ? (
                    <svg className="w-4 h-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                  )}
                </button>
              </div>
            </div>

            {/* Stream Key */}
            <div>
              <label className="text-xs text-pnp-textSecondary uppercase tracking-wider block mb-1">{t.streamKey}</label>
              <div className="flex items-center gap-2 bg-pnp-surface border border-pnp-border rounded-lg px-3 py-2">
                <code className="text-sm text-pnp-textPrimary flex-1">
                  {showStreamKey ? rtmpInfo.streamKey : "\u2022".repeat(Math.min(rtmpInfo.streamKey.length, 20))}
                </code>
                <button
                  onClick={() => setShowStreamKey(!showStreamKey)}
                  className="text-pnp-textSecondary hover:text-pnp-accent flex-shrink-0 transition-colors"
                  aria-label={showStreamKey ? t.hideStreamKey : t.showStreamKey}
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    {showStreamKey ? (
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 4.411m0 0L21 21" />
                    ) : (
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    )}
                  </svg>
                </button>
                <button
                  onClick={() => copyToClipboard(rtmpInfo.streamKey, "key")}
                  className="text-pnp-textSecondary hover:text-pnp-accent flex-shrink-0 transition-colors"
                  aria-label={t.copyStreamKey}
                >
                  {copiedField === "key" ? (
                    <svg className="w-4 h-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                  )}
                </button>
              </div>
              <p className="text-xs text-pnp-error mt-1">{t.streamKeyWarning}</p>
            </div>
          </div>
        )}
      </div>

      {/* Settings link */}
      <button
        onClick={() => navigate("/settings")}
        className="w-full flex items-center gap-4 p-4 rounded-xl border border-pnp-border/30 hover:border-pnp-border/60 transition-colors text-left"
      >
        <svg className="w-5 h-5 text-pnp-textSecondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        <span className="text-sm text-pnp-textPrimary">{t.settings}</span>
        <svg className="w-4 h-4 text-pnp-textSecondary ml-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </button>
    </div>
  );
}
