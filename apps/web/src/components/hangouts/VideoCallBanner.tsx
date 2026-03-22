import React, { useState, useEffect } from "react";

function isValidPhotoUrl(photo: string | null | undefined): photo is string {
  return !!photo && (photo.startsWith("/") || photo.startsWith("http"));
}

// ─── Duration timer hook ──────────────────────────────────────────────────────

function useCallDuration(callStartedAt: string | null | undefined): string {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!callStartedAt) {
      setElapsed(0);
      return;
    }
    const startMs = new Date(callStartedAt).getTime();
    if (isNaN(startMs)) {
      setElapsed(0);
      return;
    }

    const tick = () => {
      const diff = Math.max(0, Math.floor((Date.now() - startMs) / 1000));
      setElapsed(diff);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [callStartedAt]);

  const h = Math.floor(elapsed / 3600);
  const m = Math.floor((elapsed % 3600) / 60);
  const s = elapsed % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

// ─── Types ──────────────────────────────────────────────────────────────────

interface Participant {
  userId: string;
  name: string;
  photoUrl?: string | null;
}

interface VideoCallBannerProps {
  /** Whether there is an active call */
  isActive: boolean;
  /** Number of participants in the call */
  participantCount?: number;
  /** Participant details (for avatar display) */
  participants?: Participant[];
  /** Called when user clicks "Join" */
  onJoin: () => void;
  /** Called when user dismisses the banner */
  onDismiss?: () => void;
  /** Whether join action is in progress */
  isJoining?: boolean;
  /** Call ID — used to scope dismiss state so new calls show the banner again */
  callId?: string | null;
  /** ISO string of when the call started — drives the duration timer */
  callStartedAt?: string | null;
  /** Whether someone in the call is currently sharing their screen */
  isSomeoneSharing?: boolean;
}

// ─── Avatar stack ─────────────────────────────────────────────────────────────

interface AvatarStackProps {
  participants: Participant[];
  overflow: number;
}

function AvatarStack({ participants, overflow }: AvatarStackProps) {
  return (
    <div className="flex -space-x-2">
      {participants.map((p) => (
        <div
          key={p.userId}
          className="w-7 h-7 rounded-full ring-2 ring-pnp-surface flex-shrink-0 overflow-hidden"
          title={p.name}
        >
          {isValidPhotoUrl(p.photoUrl) && (
            <img
              src={p.photoUrl}
              alt=""
              className="w-full h-full object-cover"
              onError={(e) => {
                const img = e.target as HTMLImageElement;
                img.style.display = "none";
                const fallback = img.nextElementSibling as HTMLElement | null;
                if (fallback) fallback.style.removeProperty("display");
              }}
            />
          )}
          <div
            className="w-full h-full flex items-center justify-center text-[10px] font-bold bg-pnp-accent/30 text-pnp-accent"
            style={{ display: isValidPhotoUrl(p.photoUrl) ? "none" : undefined }}
          >
            {p.name[0]?.toUpperCase() || "?"}
          </div>
        </div>
      ))}
      {overflow > 0 && (
        <div className="w-7 h-7 rounded-full ring-2 ring-pnp-surface bg-pnp-surfaceHover flex items-center justify-center text-[10px] font-bold text-pnp-textSecondary flex-shrink-0">
          +{overflow}
        </div>
      )}
    </div>
  );
}

// ─── Component ──────────────────────────────────────────────────────────────

export function VideoCallBanner({
  isActive,
  participantCount = 0,
  participants = [],
  onJoin,
  onDismiss,
  isJoining = false,
  callId,
  callStartedAt,
  isSomeoneSharing = false,
}: VideoCallBannerProps) {
  const [dismissedCallId, setDismissedCallId] = useState<string | null>(null);
  // Controls CSS entry animation — slide-down
  const [mounted, setMounted] = useState(false);

  // Hook must be called unconditionally before any early return
  const duration = useCallDuration(callStartedAt);

  // Trigger the slide-down animation on first paint
  useEffect(() => {
    if (isActive) {
      // Small rAF delay so the initial transform is applied before transition
      const id = requestAnimationFrame(() => setMounted(true));
      return () => cancelAnimationFrame(id);
    } else {
      setMounted(false);
    }
  }, [isActive]);

  // Reset dismissed state when a new call starts (different callId)
  const isDismissed = !!callId && dismissedCallId === callId;

  if (!isActive || isDismissed) return null;

  const handleDismiss = () => {
    if (callId) setDismissedCallId(callId);
    onDismiss?.();
  };

  // Show up to 4 participant avatars
  const displayParticipants = participants.slice(0, 4);
  const overflow = participantCount > 4 ? participantCount - 4 : 0;

  return (
    <div
      className={`mx-4 mt-2 glass-card-sm p-3 flex-shrink-0 transition-all duration-300 ease-out ${
        mounted
          ? "opacity-100 translate-y-0"
          : "opacity-0 -translate-y-3"
      }`}
      role="status"
      aria-live="polite"
      aria-label="Video call in progress"
    >
      <div className="flex items-center gap-3">
        {/* Pulsing indicator + icon */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-400" />
          </span>
          <svg className="w-5 h-5 text-pnp-amber" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        </div>

        {/* Text + participants + timer */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium text-pnp-textPrimary">
              Video call in progress
            </p>

            {/* Duration timer */}
            {callStartedAt && (
              <span className="text-[11px] font-mono text-pnp-textSecondary tabular-nums">
                {duration}
              </span>
            )}

            {/* Screen sharing indicator */}
            {isSomeoneSharing && (
              <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-pnp-accent/15 ring-1 ring-pnp-accent/40">
                <svg className="w-3 h-3 text-pnp-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0H3" />
                </svg>
                <span className="text-[10px] font-semibold text-pnp-accent">Screen sharing</span>
              </div>
            )}
          </div>

          {/* Avatar stack + participant count */}
          <div className="flex items-center gap-2 mt-1.5">
            {displayParticipants.length > 0 && (
              <AvatarStack participants={displayParticipants} overflow={overflow} />
            )}
            {participantCount > 0 && (
              <span className="text-xs text-pnp-textSecondary">
                {participantCount} participant{participantCount !== 1 ? "s" : ""}
              </span>
            )}
          </div>
        </div>

        {/* Join button */}
        <button
          onClick={onJoin}
          disabled={isJoining}
          className="flex-shrink-0 btn-gradient px-4 py-2 rounded-lg text-xs font-semibold text-white active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent focus-visible:ring-offset-2 focus-visible:ring-offset-pnp-background"
        >
          {isJoining ? (
            <svg className="w-4 h-4 text-white animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : (
            "Join"
          )}
        </button>

        {/* Dismiss */}
        {onDismiss && (
          <button
            onClick={handleDismiss}
            className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-full hover:bg-white/10 active:scale-95 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent"
            aria-label="Dismiss call notification"
          >
            <svg className="w-3.5 h-3.5 text-pnp-textSecondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
