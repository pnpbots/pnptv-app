import React from "react";

// ─── Types ──────────────────────────────────────────────────────────────────

interface VideoCallButtonProps {
  /** Whether a call is currently active for this group */
  hasActiveCall: boolean;
  /** Number of participants currently in the call */
  participantCount?: number;
  /** Called when the user wants to start or join a call */
  onStartCall: () => void;
  /** Whether the call action is in progress */
  isLoading?: boolean;
  /** Disables the button */
  disabled?: boolean;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function VideoCallButton({
  hasActiveCall,
  participantCount = 0,
  onStartCall,
  isLoading = false,
  disabled = false,
}: VideoCallButtonProps) {
  if (hasActiveCall) {
    return (
      <button
        onClick={onStartCall}
        disabled={disabled || isLoading}
        className="flex items-center gap-1.5 px-3 h-9 rounded-full transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent focus-visible:ring-offset-2 focus-visible:ring-offset-pnp-background"
        style={{ background: "linear-gradient(135deg, rgba(212,0,122,0.2), rgba(230,145,56,0.2))" }}
        aria-label={`Join active video call with ${participantCount} participant${participantCount !== 1 ? "s" : ""}`}
      >
        {isLoading ? (
          <svg className="w-4 h-4 text-pnp-amber animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        ) : (
          <>
            {/* Pulsing live indicator */}
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-pnp-accent opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 dot-gradient" />
            </span>

            {/* Video camera icon */}
            <svg className="w-4 h-4 text-pnp-amber" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>

            <span className="text-xs font-semibold text-gradient">
              Join{participantCount > 0 ? ` (${participantCount})` : ""}
            </span>
          </>
        )}
      </button>
    );
  }

  // No active call -- "Start Call" button
  return (
    <button
      onClick={onStartCall}
      disabled={disabled || isLoading}
      className="w-9 h-9 rounded-full flex items-center justify-center hover:opacity-80 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent focus-visible:ring-offset-2 focus-visible:ring-offset-pnp-background"
      style={{ background: "linear-gradient(135deg, rgba(212,0,122,0.15), rgba(230,145,56,0.15))" }}
      aria-label="Start video call"
    >
      {isLoading ? (
        <svg className="w-4 h-4 text-pnp-amber animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      ) : (
        <svg className="w-5 h-5 text-pnp-amber" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
      )}
    </button>
  );
}
