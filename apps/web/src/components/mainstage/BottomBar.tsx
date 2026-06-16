import { useCallback, useEffect, useRef, useState } from "react";
import { useLocalParticipant } from "@livekit/components-react";
import { useI18n } from "@/lib/i18n";
import { getSocket } from "@/lib/socket";
import type { MainStageState } from "@/hooks/useMainStage";

const REACTION_EMOJIS = ['❤️', '🔥', '🎉', '👏', '🤩', '😍', '💊'] as const;

interface BottomBarProps {
  isParticipant: boolean;
  isAdmin: boolean;
  onLeave: () => void;
  spotlight?: MainStageState["spotlight"];
  onSendReaction?: (emoji: string) => void;
  canScreenShare?: boolean;
  /** Whether this user's token grants audio publish (member / prime / admin) */
  hasMic?: boolean;
  /** Skip-vote state — only shown for member / prime / admin */
  skipVoteCount?: number;
  skipVoteThreshold?: number;
  hasVotedSkip?: boolean;
  onVoteSkip?: () => void;
  /** PRIME play-next — only shown for prime / admin */
  onPlayNext?: () => void;
  playNextCooldown?: number; // seconds remaining
}

export function BottomBarInner({
  isParticipant,
  isAdmin,
  onLeave,
  spotlight,
  onSendReaction,
  canScreenShare,
  hasMic = false,
  skipVoteCount,
  skipVoteThreshold,
  hasVotedSkip = false,
  onVoteSkip,
  onPlayNext,
  playNextCooldown,
}: BottomBarProps) {
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant();
  const t = useI18n();
  const [reactionPickerOpen, setReactionPickerOpen] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const reactionPickerRef = useRef<HTMLDivElement>(null);

  // Close reaction picker on outside click
  useEffect(() => {
    if (!reactionPickerOpen) return;
    const handler = (e: MouseEvent) => {
      if (reactionPickerRef.current && !reactionPickerRef.current.contains(e.target as Node)) {
        setReactionPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [reactionPickerOpen]);

  const handleReactionClick = useCallback((emoji: string) => {
    setReactionPickerOpen(false);
    if (onSendReaction) {
      onSendReaction(emoji);
    } else {
      getSocket().emit('mainstage:reaction-send', { emoji });
    }
  }, [onSendReaction]);

  const handleScreenShare = useCallback(async () => {
    if (isScreenSharing) {
      await localParticipant.setScreenShareEnabled(false);
      setIsScreenSharing(false);
    } else {
      try {
        await localParticipant.setScreenShareEnabled(true);
        setIsScreenSharing(true);
      } catch {
        // User cancelled or permission denied
      }
    }
  }, [isScreenSharing, localParticipant]);

  // Queue-position indicator — re-renders every second while nextAt is set.
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

  const handleMicToggle = useCallback(() => {
    if (!isAdmin && !hasMic) return;
    localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled);
  }, [isAdmin, hasMic, localParticipant, isMicrophoneEnabled]);

  const handleCamToggle = useCallback(() => {
    if (!isAdmin) return;
    localParticipant.setCameraEnabled(!isCameraEnabled);
  }, [isAdmin, isCameraEnabled, localParticipant]);

  const showSkipVote = isParticipant && !!onVoteSkip && skipVoteThreshold !== undefined;
  const showPlayNext = isParticipant && !!onPlayNext;

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
      {/* LEAVE — always first */}
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

      {/* Skip vote — member / prime / admin */}
      {showSkipVote && (
        <button
          type="button"
          onClick={onVoteSkip}
          disabled={hasVotedSkip}
          aria-label="Vote to skip this video"
          title={hasVotedSkip ? `You voted · ${skipVoteCount}/${skipVoteThreshold} votes` : `Skip video (${skipVoteCount ?? 0}/${skipVoteThreshold} votes needed)`}
          className="min-h-[40px] flex-shrink-0 flex items-center gap-1.5 px-2.5 rounded-full text-[10px] font-bold transition-all active:scale-[0.94] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black disabled:cursor-default"
          style={{
            background: hasVotedSkip ? "rgba(123,97,255,0.22)" : "rgba(255,255,255,0.06)",
            border: hasVotedSkip ? "1px solid rgba(123,97,255,0.50)" : "1px solid rgba(255,255,255,0.12)",
            color: hasVotedSkip ? "#A990FF" : "rgba(255,255,255,0.60)",
          }}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 8.689c0-.864.933-1.406 1.683-.977l7.108 4.061a1.125 1.125 0 010 1.954l-7.108 4.061A1.125 1.125 0 013 16.811V8.69zM12.75 8.689c0-.864.933-1.406 1.683-.977l7.108 4.061a1.125 1.125 0 010 1.954l-7.108 4.061a1.125 1.125 0 01-1.683-.977V8.69z" />
          </svg>
          <span className="hidden sm:inline tabular-nums">
            {skipVoteCount ?? 0}/{skipVoteThreshold}
          </span>
        </button>
      )}

      {/* Play Next — PRIME / admin only */}
      {showPlayNext && (
        <button
          type="button"
          onClick={onPlayNext}
          disabled={!!playNextCooldown}
          aria-label="Play next video"
          title={playNextCooldown ? `Available in ${playNextCooldown}s` : "Play next video (PRIME)"}
          className="min-h-[40px] flex-shrink-0 flex items-center gap-1.5 px-2.5 rounded-full text-[10px] font-bold transition-all active:scale-[0.94] focus-visible:outline-none disabled:cursor-default"
          style={{
            background: playNextCooldown ? "rgba(255,255,255,0.04)" : "rgba(229,255,0,0.10)",
            border: playNextCooldown ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(229,255,0,0.30)",
            color: playNextCooldown ? "rgba(255,255,255,0.30)" : "#E5FF00",
          }}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 8.689c0-.864.933-1.406 1.683-.977l7.108 4.061a1.125 1.125 0 010 1.954l-7.108 4.061A1.125 1.125 0 013 16.811V8.69zM12.75 8.689c0-.864.933-1.406 1.683-.977l7.108 4.061a1.125 1.125 0 010 1.954l-7.108 4.061a1.125 1.125 0 01-1.683-.977V8.69z" />
          </svg>
          <span className="hidden sm:inline">
            {playNextCooldown ? `${playNextCooldown}s` : "Next"}
          </span>
        </button>
      )}

      {/* Reaction picker */}
      {isParticipant && (
        <div ref={reactionPickerRef} className="relative flex-shrink-0">
          <button
            type="button"
            onClick={() => setReactionPickerOpen((p) => !p)}
            aria-label="Send reaction"
            title="Send reaction"
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-full transition-all hover:bg-white/10 active:scale-[0.94] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black"
            style={{
              background: reactionPickerOpen ? "linear-gradient(135deg,#D4007A,#7B61FF)" : "rgba(255,255,255,0.06)",
              border: reactionPickerOpen ? "1px solid rgba(212,0,122,0.60)" : "1px solid rgba(255,255,255,0.12)",
            }}
          >
            <span className="text-base leading-none">❤️</span>
          </button>
          {reactionPickerOpen && (
            <div
              className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-2.5 py-2 rounded-2xl shadow-xl"
              style={{
                background: "rgba(12,12,20,0.97)",
                border: "1px solid rgba(255,255,255,0.12)",
                backdropFilter: "blur(16px)",
                boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
                zIndex: 46,
              }}
            >
              {REACTION_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => handleReactionClick(emoji)}
                  className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-xl text-xl transition-all hover:bg-white/10 active:scale-[0.92]"
                  title={emoji}
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Screen share — member / prime / admin when canScreenShare */}
      {isParticipant && canScreenShare && (
        <button
          type="button"
          onClick={handleScreenShare}
          aria-label={isScreenSharing ? "Stop screen share" : "Share screen"}
          title={isScreenSharing ? "Stop sharing" : "Share screen"}
          aria-pressed={isScreenSharing}
          className="min-h-[40px] flex-shrink-0 flex items-center gap-1.5 px-3 rounded-full text-xs font-bold text-white transition-all hover:bg-white/10 active:scale-[0.94] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black"
          style={{
            background: isScreenSharing ? "linear-gradient(135deg,#D4007A,#7B61FF)" : "rgba(255,255,255,0.06)",
            border: isScreenSharing ? "1px solid rgba(212,0,122,0.60)" : "1px solid rgba(255,255,255,0.12)",
            boxShadow: isScreenSharing ? "0 4px 16px rgba(212,0,122,0.45)" : undefined,
          }}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <rect x="2" y="4" width="20" height="14" rx="2" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 20h8M12 18v2" />
            {isScreenSharing && <path strokeLinecap="round" strokeLinejoin="round" d="M9 10l2 2 4-4" />}
          </svg>
          <span className="hidden sm:inline">{isScreenSharing ? "Stop sharing" : "Share"}</span>
        </button>
      )}

      {/* Camera toggle — admin only */}
      {isParticipant && isAdmin && (
        <button
          type="button"
          onClick={handleCamToggle}
          aria-label={isCameraEnabled ? "Turn camera off" : "Turn camera on"}
          title={isCameraEnabled ? "Turn camera off" : "Turn camera on"}
          aria-pressed={isCameraEnabled}
          className="min-h-[40px] flex-shrink-0 flex items-center gap-1.5 px-3 rounded-full text-xs font-bold text-white transition-all hover:bg-white/10 active:scale-[0.94] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black"
          style={{
            background: isCameraEnabled ? "rgba(255,69,58,0.18)" : "linear-gradient(135deg,#D4007A,#7B61FF)",
            border: isCameraEnabled ? "1px solid rgba(255,69,58,0.45)" : "1px solid rgba(212,0,122,0.60)",
            boxShadow: isCameraEnabled ? "0 2px 10px rgba(255,69,58,0.25)" : "0 4px 16px rgba(212,0,122,0.45)",
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

      {/* Mic toggle — admin + member/prime (hasMic) */}
      {isParticipant && (isAdmin || hasMic) && (
        <button
          type="button"
          onClick={handleMicToggle}
          aria-label={isMicrophoneEnabled ? t.live.mainStageAriaMicMute : t.live.mainStageAriaMicUnmute}
          title={isMicrophoneEnabled ? "Mute" : "Unmute"}
          aria-pressed={isMicrophoneEnabled}
          className="min-h-[40px] min-w-[40px] flex-shrink-0 flex items-center justify-center rounded-full transition-all hover:bg-white/10 active:scale-[0.94] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black"
          style={{
            background: isMicrophoneEnabled ? "rgba(212,0,122,0.18)" : "rgba(255,255,255,0.05)",
            border: isMicrophoneEnabled ? "1px solid rgba(212,0,122,0.40)" : "1px solid rgba(255,255,255,0.12)",
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

      {/* Newcomer badge — cam only, mic muted */}
      {isParticipant && !isAdmin && !hasMic && (
        <span
          className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold text-white/70"
          style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.10)" }}
          title="Camera is required and your microphone is muted. Become a Member to unlock your mic."
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
