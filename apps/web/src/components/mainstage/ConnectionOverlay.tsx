import { useEffect, useState } from "react";
import { ConnectionState } from "livekit-client";
import { useI18n } from "@/lib/i18n";

interface ConnectionOverlayProps {
  connState: ConnectionState;
  errorMessage?: string | null;
}

export function ConnectionOverlay({
  connState,
  errorMessage,
}: ConnectionOverlayProps) {
  const t = useI18n();
  const [dismissed, setDismissed] = useState(false);
  const [showEscape, setShowEscape] = useState(false);

  const isDisconnected = connState === ConnectionState.Disconnected;

  // Reset escape hatch every time the state actually changes.
  useEffect(() => {
    setShowEscape(false);
    setDismissed(false);
    if (connState === ConnectionState.Connected) return;
    // Disconnected: surface the retry immediately. Connecting/Reconnecting
    // gets the usual 6s breathing room first.
    const delay = isDisconnected ? 0 : 6000;
    const tid = setTimeout(() => setShowEscape(true), delay);
    return () => clearTimeout(tid);
  }, [connState, isDisconnected]);

  if (connState === ConnectionState.Connected) return null;
  if (dismissed) return null;

  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center"
      style={{ background: "rgba(10,10,15,0.92)", backdropFilter: "blur(12px)" }}
    >
      <div className="flex flex-col items-center gap-3 px-6 text-center max-w-xs">
        {!isDisconnected && (
          <div
            className="w-10 h-10 rounded-full border-2 animate-spin"
            style={{ borderColor: "rgba(212,0,122,0.3)", borderTopColor: "#D4007A" }}
          />
        )}
        {isDisconnected && (
          <div
            className="w-12 h-12 rounded-2xl flex items-center justify-center"
            style={{ background: "rgba(255,69,58,0.12)", border: "1px solid rgba(255,69,58,0.30)" }}
          >
            <svg className="w-7 h-7 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728L5.636 5.636m12.728 12.728L18.364 5.636M5.636 18.364l12.728-12.728" />
            </svg>
          </div>
        )}
        <p className="text-white/85 text-sm font-semibold">
          {isDisconnected
            ? "Conexión perdida / Connection lost"
            : connState === ConnectionState.Reconnecting
              ? t.live.mainStageReconnecting
              : t.live.mainStageConnecting}
        </p>
        {errorMessage && (
          <p className="text-pnp-error/80 text-[11px] leading-snug max-w-[260px]">{errorMessage}</p>
        )}
        {showEscape && (
          <div className="flex gap-2 mt-1">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="min-h-[40px] px-4 rounded-full text-xs font-bold text-white transition-all active:scale-[0.97]"
              style={{
                background: "linear-gradient(135deg,#D4007A,#7B61FF)",
                border: "1px solid rgba(212,0,122,0.55)",
              }}
            >
              Reintentar / Try again
            </button>
            {!isDisconnected && (
              <button
                type="button"
                onClick={() => setDismissed(true)}
                className="min-h-[40px] px-4 rounded-full text-xs font-semibold text-white/80 transition-all active:scale-[0.97]"
                style={{
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(255,255,255,0.12)",
                }}
              >
                Continuar / Continue
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
