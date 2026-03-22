import React, { useState, useRef, useEffect } from "react";

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

// ─── Tooltip ─────────────────────────────────────────────────────────────────

interface TooltipProps {
  text: string;
  visible: boolean;
}

function Tooltip({ text, visible }: TooltipProps) {
  return (
    <div
      role="tooltip"
      className={`absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-white bg-pnp-surfaceHover border border-white/10 whitespace-nowrap pointer-events-none shadow-lg transition-all duration-150 z-50 ${
        visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-1"
      }`}
    >
      {text}
      {/* Arrow */}
      <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-pnp-surfaceHover" />
    </div>
  );
}

// ─── Component ──────────────────────────────────────────────────────────────

export function VideoCallButton({
  hasActiveCall,
  participantCount = 0,
  onStartCall,
  isLoading = false,
  disabled = false,
}: VideoCallButtonProps) {
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clean up tooltip hide timer on unmount
  useEffect(() => {
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, []);

  const showTooltip = () => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    setTooltipVisible(true);
  };

  const hideTooltip = () => {
    hideTimerRef.current = setTimeout(() => setTooltipVisible(false), 80);
  };

  const tooltipText = hasActiveCall
    ? participantCount > 0
      ? `Join active call (${participantCount} participant${participantCount !== 1 ? "s" : ""})`
      : "Join active call"
    : "Start a new call";

  if (hasActiveCall) {
    return (
      <div className="relative flex-shrink-0">
        <button
          onClick={onStartCall}
          disabled={disabled || isLoading}
          onMouseEnter={showTooltip}
          onMouseLeave={hideTooltip}
          onFocus={showTooltip}
          onBlur={hideTooltip}
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
              {/* Pulsing green dot — active call indicator */}
              <span className="relative flex h-2 w-2 flex-shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-400" />
              </span>

              {/* Video camera icon */}
              <svg className="w-4 h-4 text-pnp-amber" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>

              {/* Text label — hidden on mobile */}
              <span className="hidden sm:inline text-xs font-semibold text-gradient">
                Join
              </span>

              {/* Participant count badge */}
              {participantCount > 0 && (
                <span className="hidden sm:flex items-center justify-center h-4 min-w-[16px] px-1 rounded-full bg-green-400/20 text-[10px] font-bold text-green-300 ring-1 ring-green-400/30">
                  {participantCount}
                </span>
              )}
            </>
          )}
        </button>

        <Tooltip text={tooltipText} visible={tooltipVisible && !isLoading} />
      </div>
    );
  }

  // No active call — "Start Call" button
  return (
    <div className="relative flex-shrink-0">
      <button
        onClick={onStartCall}
        disabled={disabled || isLoading}
        onMouseEnter={showTooltip}
        onMouseLeave={hideTooltip}
        onFocus={showTooltip}
        onBlur={hideTooltip}
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

      <Tooltip text={tooltipText} visible={tooltipVisible && !isLoading} />
    </div>
  );
}
