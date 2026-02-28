import React, { useState } from "react";

function isValidPhotoUrl(photo: string | null | undefined): photo is string {
  return !!photo && (photo.startsWith("/") || photo.startsWith("http"));
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
}

// ─── Component ──────────────────────────────────────────────────────────────

export function VideoCallBanner({
  isActive,
  participantCount = 0,
  participants = [],
  onJoin,
  onDismiss,
  isJoining = false,
}: VideoCallBannerProps) {
  const [dismissed, setDismissed] = useState(false);

  if (!isActive || dismissed) return null;

  const handleDismiss = () => {
    setDismissed(true);
    onDismiss?.();
  };

  // Show up to 3 participant avatars
  const displayParticipants = participants.slice(0, 3);
  const overflow = participantCount > 3 ? participantCount - 3 : 0;

  return (
    <div
      className="mx-4 mt-2 glass-card-sm p-3 flex-shrink-0 animate-fade-in-up"
      role="status"
      aria-live="polite"
      aria-label="Video call in progress"
    >
      <div className="flex items-center gap-3">
        {/* Pulsing indicator + icon */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-pnp-accent opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 dot-gradient" />
          </span>
          <svg className="w-5 h-5 text-pnp-amber" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        </div>

        {/* Text + participants */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-pnp-textPrimary">
            Video call in progress
          </p>
          <div className="flex items-center gap-2 mt-1">
            {/* Participant avatars */}
            {displayParticipants.length > 0 && (
              <div className="flex -space-x-2">
                {displayParticipants.map((p) => (
                  <div
                    key={p.userId}
                    className="w-6 h-6 rounded-full ring-2 ring-pnp-surface flex-shrink-0 overflow-hidden"
                    title={p.name}
                  >
                    {isValidPhotoUrl(p.photoUrl) ? (
                      <img
                        src={p.photoUrl}
                        alt=""
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = "none";
                          const fallback = (e.target as HTMLImageElement).nextElementSibling as HTMLElement;
                          if (fallback) fallback.style.display = "flex";
                        }}
                      />
                    ) : null}
                    <div
                      className="w-full h-full flex items-center justify-center text-[9px] font-bold"
                      style={{
                        background: "rgba(212,0,122,0.3)",
                        color: "#D4007A",
                        display: isValidPhotoUrl(p.photoUrl) ? "none" : undefined,
                      }}
                    >
                      {p.name[0]?.toUpperCase() || "?"}
                    </div>
                  </div>
                ))}
                {overflow > 0 && (
                  <div className="w-6 h-6 rounded-full ring-2 ring-pnp-surface bg-pnp-surfaceHover flex items-center justify-center text-[9px] font-bold text-pnp-textSecondary flex-shrink-0">
                    +{overflow}
                  </div>
                )}
              </div>
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
