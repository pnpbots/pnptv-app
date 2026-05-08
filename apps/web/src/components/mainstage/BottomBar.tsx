import { useCallback, useEffect, useState } from "react";
import { useLocalParticipant } from "@livekit/components-react";
import { useI18n } from "@/lib/i18n";
import type { MainStageState } from "@/hooks/useMainStage";

interface BottomBarProps {
  isParticipant: boolean;
  isAdmin: boolean;
  onLeave: () => void;
  spotlight?: MainStageState["spotlight"];
}

export function BottomBarInner({
  isParticipant,
  isAdmin,
  onLeave,
  spotlight,
}: BottomBarProps) {
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant();
  const t = useI18n();

  // Queue-position indicator for cammers: shows "Position X / Y" or "Live now".
  // Re-renders every second when nextAt is set so the countdown stays current.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!isParticipant || !spotlight?.nextAt) return;
    const iv = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(iv);
  }, [isParticipant, spotlight?.nextAt]);

  const queueChip = (() => {
    if (!isParticipant || !spotlight) return null;
    const myIdentity = localParticipant?.identity || "";
    const queue = spotlight.queue || [];
    const myPos = queue.indexOf(myIdentity);
    const isLive = !!myIdentity && spotlight.cammer === myIdentity;
    if (isLive) {
      return (
        <span className="hidden md:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold bg-pnp-accent/15 border border-pnp-accent/30 text-pnp-accent">
          <span className="relative flex h-1.5 w-1.5">
            <span className="motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full bg-pnp-accent opacity-75" />
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-pnp-accent" />
          </span>
          {t.live.mainStageQueueLive}
        </span>
      );
    }
    if (myPos < 0) return null;
    const total = queue.length || 1;
    const secsToNext = spotlight.nextAt
      ? Math.max(0, Math.ceil((spotlight.nextAt - nowMs) / 1000))
      : 0;
    return (
      <span className="hidden md:inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold bg-white/[0.06] border border-white/10 text-white/70 tabular-nums">
        <span>{t.live.mainStageQueuePosition(myPos + 1, total)}</span>
        {spotlight.nextAt && myPos === 0 && (
          <span className="text-pnp-amber">· {t.live.mainStageQueueNext(secsToNext)}</span>
        )}
      </span>
    );
  })();

  // Cam/mic toggles are admin-only. Non-admin participants are subject to
  // forced-camera-on + forced-mic-mute rules enforced by MainStageProvider
  // (and the guest-room enforcer below).
  const handleMicToggle = useCallback(() => {
    if (!isAdmin) return;
    localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled);
  }, [isAdmin, localParticipant, isMicrophoneEnabled]);

  const handleCamToggle = useCallback(() => {
    if (!isAdmin) return;
    localParticipant.setCameraEnabled(!isCameraEnabled);
  }, [isAdmin, isCameraEnabled, localParticipant]);

  return (
    <div
      className="relative flex-shrink-0 flex items-center justify-center gap-2 px-3 sm:px-4 py-2"
      style={{
        background: "rgba(10,10,15,0.95)",
        backdropFilter: "blur(16px)",
        borderTop: "1px solid rgba(255,255,255,0.07)",
        paddingBottom: "calc(0.5rem + env(safe-area-inset-bottom, 0px))",
        zIndex: 45,
      }}
    >
      {/* LEAVE — always first (critical exit) */}
      <button
        type="button"
        onClick={onLeave}
        aria-label={t.live.mainStageAriaLeave}
        className="min-h-[40px] min-w-[40px] flex-shrink-0 flex items-center justify-center gap-1 px-2.5 rounded-full text-xs font-bold transition-all hover:bg-white/10 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black bg-pnp-error/15 border border-pnp-error/30 text-pnp-error"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
        </svg>
        <span className="hidden sm:inline">{t.live.mainStageLeave}</span>
      </button>

      {queueChip}

      {isParticipant && isAdmin && (
        <button
          type="button"
          onClick={handleCamToggle}
          aria-label={isCameraEnabled ? "Turn camera off" : "Turn camera on"}
          title={isCameraEnabled ? "Turn camera off" : "Turn camera on"}
          aria-pressed={isCameraEnabled}
          className="min-h-[40px] flex-shrink-0 flex items-center gap-1.5 px-3 rounded-full text-xs font-bold text-white transition-all hover:bg-white/10 active:scale-[0.94] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black"
          style={{
            background: isCameraEnabled
              ? "rgba(255,69,58,0.18)"
              : "linear-gradient(135deg,#D4007A,#7B61FF)",
            border: isCameraEnabled
              ? "1px solid rgba(255,69,58,0.45)"
              : "1px solid rgba(212,0,122,0.60)",
            boxShadow: isCameraEnabled
              ? "0 2px 10px rgba(255,69,58,0.25)"
              : "0 4px 16px rgba(212,0,122,0.45)",
            color: isCameraEnabled ? "#FF453A" : "#FFFFFF",
          }}
        >
          {isCameraEnabled ? (
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9A2.25 2.25 0 004.5 18.75zM3 3l18 18" />
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9A2.25 2.25 0 004.5 18.75z" />
            </svg>
          )}
          <span>Camera</span>
        </button>
      )}

      {isParticipant && isAdmin && (
        <button
          type="button"
          onClick={handleMicToggle}
          aria-label={isMicrophoneEnabled ? t.live.mainStageAriaMicMute : t.live.mainStageAriaMicUnmute}
          title={isMicrophoneEnabled ? "Mute" : "Unmute"}
          aria-pressed={isMicrophoneEnabled}
          className="min-h-[40px] min-w-[40px] flex-shrink-0 flex items-center justify-center rounded-full transition-all hover:bg-white/10 active:scale-[0.94] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black"
          style={{
            background: isMicrophoneEnabled
              ? "rgba(212,0,122,0.18)"
              : "rgba(255,255,255,0.05)",
            border: isMicrophoneEnabled
              ? "1px solid rgba(212,0,122,0.40)"
              : "1px solid rgba(255,255,255,0.12)",
          }}
        >
          {isMicrophoneEnabled ? (
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
            </svg>
          ) : (
            <svg className="w-4 h-4 text-white/55" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3zM3 3l18 18" />
            </svg>
          )}
        </button>
      )}

      {isParticipant && !isAdmin && (
        <span
          className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold text-white/70"
          style={{
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.10)",
          }}
          title="Camera is required and your microphone is muted by the stage."
        >
          <svg className="w-3 h-3 text-pnp-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9A2.25 2.25 0 004.5 18.75z" />
          </svg>
          <span>Cam on · Mic muted</span>
        </span>
      )}

    </div>
  );
}
