import React, { useEffect, useRef, useState, useCallback } from "react";

// ─── Types ──────────────────────────────────────────────────────────────────

interface JitsiMeetComponentProps {
  /** The full Jitsi meeting URL (with JWT token) from the backend */
  meetingUrl: string;
  /** Unique room name for this meeting */
  roomName?: string;
  /** Called when the user leaves/ends the call */
  onCallEnd?: () => void;
  /** Called when a participant joins (from Jitsi postMessage events) */
  onParticipantJoined?: (count: number) => void;
  /** Called when a participant leaves */
  onParticipantLeft?: (count: number) => void;
  /** Whether to display in full-screen mode */
  fullScreen?: boolean;
  /** Optional className for the container */
  className?: string;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function JitsiMeetComponent({
  meetingUrl,
  roomName,
  onCallEnd,
  onParticipantJoined,
  onParticipantLeft,
  fullScreen = false,
  className,
}: JitsiMeetComponentProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  // Listen for Jitsi postMessage events
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      // Only accept messages from 8x8.vc or the Jitsi domain
      if (!event.origin.includes("8x8.vc") && !event.origin.includes("jitsi")) {
        return;
      }

      try {
        const data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;

        switch (data.event) {
          case "video-conference-joined":
            setIsLoading(false);
            break;
          case "video-conference-left":
          case "video-hangup":
            onCallEnd?.();
            break;
          case "participant-joined":
            onParticipantJoined?.(data.participantCount || 0);
            break;
          case "participant-left":
            onParticipantLeft?.(data.participantCount || 0);
            break;
          default:
            break;
        }
      } catch {
        // Not a JSON message, ignore
      }
    };

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [onCallEnd, onParticipantJoined, onParticipantLeft]);

  const handleIframeLoad = useCallback(() => {
    // Give a short delay for Jitsi to render after the iframe loads
    setTimeout(() => setIsLoading(false), 2000);
  }, []);

  const handleIframeError = useCallback(() => {
    setIsLoading(false);
    setHasError(true);
  }, []);

  // ─── Error state ──────────────────────────────────────────────────────

  if (hasError) {
    return (
      <div className={`flex flex-col items-center justify-center p-8 bg-pnp-surface rounded-xl ${className || ""}`}>
        <svg className="w-12 h-12 text-pnp-error mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
        </svg>
        <p className="text-sm font-medium text-pnp-textPrimary mb-1">
          Failed to load video call
        </p>
        <p className="text-xs text-pnp-textSecondary mb-4 text-center">
          The video call service may be temporarily unavailable.
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => {
              setHasError(false);
              setIsLoading(true);
            }}
            className="btn-gradient px-4 py-2 rounded-lg text-xs font-semibold text-white active:scale-95 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent"
          >
            Try Again
          </button>
          {onCallEnd && (
            <button
              onClick={onCallEnd}
              className="px-4 py-2 rounded-lg text-xs font-semibold text-pnp-textSecondary border border-white/10 hover:bg-white/5 active:scale-95 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent"
            >
              Close
            </button>
          )}
        </div>
      </div>
    );
  }

  // ─── Main render ──────────────────────────────────────────────────────

  const containerClass = fullScreen
    ? "fixed inset-0 z-[46] bg-pnp-background"
    : `relative w-full aspect-video rounded-xl overflow-hidden bg-pnp-surface ${className || ""}`;

  return (
    <div className={containerClass}>
      {/* Loading overlay */}
      {isLoading && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-pnp-surface rounded-xl">
          <div className="relative mb-4">
            <div className="w-12 h-12 rounded-full border-2 border-pnp-border border-t-pnp-accent animate-spin" />
          </div>
          <p className="text-sm text-pnp-textPrimary font-medium">
            Connecting to video call...
          </p>
          <p className="text-xs text-pnp-textSecondary mt-1">
            Please allow camera and microphone access
          </p>
        </div>
      )}

      {/* Jitsi iframe */}
      <iframe
        ref={iframeRef}
        src={meetingUrl}
        className="w-full h-full border-0"
        allow="camera; microphone; display-capture; autoplay; clipboard-write; speaker-selection; fullscreen"
        allowFullScreen
        title={roomName ? `Video call: ${roomName}` : "Video call"}
        onLoad={handleIframeLoad}
        onError={handleIframeError}
      />

      {/* Full-screen close button (only in full-screen mode) */}
      {fullScreen && (
        <button
          onClick={onCallEnd}
          className="absolute top-4 right-4 z-20 w-11 h-11 flex items-center justify-center rounded-full bg-black/50 hover:bg-black/70 active:scale-95 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent"
          aria-label="Leave video call"
        >
          <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}
