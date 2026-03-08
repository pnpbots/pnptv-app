import React, { useEffect, useRef, useState, useCallback } from "react";

// ─── Types ──────────────────────────────────────────────────────────────────

interface JitsiMeetComponentProps {
  /** The full Jitsi meeting URL — domain and room are extracted from this */
  meetingUrl: string;
  /** Unique room name for this meeting (fallback if not parseable from URL) */
  roomName?: string;
  /** Called when the user leaves/ends the call */
  onCallEnd?: () => void;
  /** Called when a participant joins */
  onParticipantJoined?: (count: number) => void;
  /** Called when a participant leaves */
  onParticipantLeft?: (count: number) => void;
  /** Whether to display in full-screen mode */
  fullScreen?: boolean;
  /** Optional className for the container */
  className?: string;
}

/** Parse domain, room, and JWT from a meeting URL.
 *  Supports both JaaS (https://8x8.vc/vpaas-xxx/room?jwt=xxx) and
 *  public Jitsi (https://meet.jit.si/room#config...) formats. */
function parseMeetingUrl(url: string): { domain: string; room: string; jwt: string; displayName: string } {
  try {
    const parsed = new URL(url);
    const domain = parsed.hostname;
    const pathParts = parsed.pathname.replace(/^\//, "").split("/");
    // For 8x8.vc: path is /vpaas-magic-cookie-xxx/roomName — room includes the tenant prefix
    const room = pathParts.join("/");
    const jwt = parsed.searchParams.get("jwt") || "";
    // Extract displayName from hash params (public Jitsi format)
    const hash = parsed.hash || "";
    const nameMatch = hash.match(/userInfo\.displayName=([^&]*)/);
    const displayName = nameMatch ? decodeURIComponent(nameMatch[1]) : "";
    return { domain, room, jwt, displayName };
  } catch {
    return { domain: "8x8.vc", room: "pnptv-fallback", jwt: "", displayName: "" };
  }
}

/** Load the Jitsi External API script if not already loaded */
function loadJitsiScript(domain: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if ((window as any).JitsiMeetExternalAPI) {
      resolve();
      return;
    }
    const existing = document.querySelector(`script[src*="external_api"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Failed to load Jitsi API")));
      return;
    }
    const script = document.createElement("script");
    script.src = `https://${domain}/external_api.js`;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Jitsi API"));
    document.head.appendChild(script);
  });
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
  const containerRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  // Store callbacks in refs so event listeners always see the latest
  const onCallEndRef = useRef(onCallEnd);
  const onParticipantJoinedRef = useRef(onParticipantJoined);
  const onParticipantLeftRef = useRef(onParticipantLeft);
  useEffect(() => { onCallEndRef.current = onCallEnd; }, [onCallEnd]);
  useEffect(() => { onParticipantJoinedRef.current = onParticipantJoined; }, [onParticipantJoined]);
  useEffect(() => { onParticipantLeftRef.current = onParticipantLeft; }, [onParticipantLeft]);

  useEffect(() => {
    let disposed = false;

    const init = async () => {
      const { domain, room, jwt, displayName } = parseMeetingUrl(meetingUrl);
      const resolvedRoom = room || roomName || "pnptv-room";

      try {
        await loadJitsiScript(domain);
      } catch {
        if (!disposed) setHasError(true);
        return;
      }

      if (disposed || !containerRef.current) return;

      const JitsiMeetExternalAPI = (window as any).JitsiMeetExternalAPI;
      if (!JitsiMeetExternalAPI) {
        setHasError(true);
        return;
      }

      const apiOptions: Record<string, any> = {
        roomName: resolvedRoom,
        parentNode: containerRef.current,
        width: "100%",
        height: "100%",
        configOverwrite: {
          prejoinPageEnabled: false,
          startWithAudioMuted: false,
          startWithVideoMuted: false,
          disableDeepLinking: true,
          disableThirdPartyRequests: true,
          enableClosePage: false,
          hideConferenceSubject: false,
          disableInviteFunctions: true,
          lobbyModeEnabled: false,
          requireDisplayName: false,
          enableInsecureRoomNameWarning: false,
        },
        interfaceConfigOverwrite: {
          MOBILE_APP_PROMO: false,
          SHOW_JITSI_WATERMARK: false,
          SHOW_WATERMARK_FOR_GUESTS: false,
          SHOW_BRAND_WATERMARK: false,
          SHOW_POWERED_BY: false,
          DISABLE_PRESENCE_STATUS: true,
          GENERATE_ROOMNAMES_ON_WELCOME_PAGE: false,
        },
        userInfo: displayName ? { displayName } : undefined,
      };

      // Pass JWT token if present (JaaS/8x8.vc authentication)
      if (jwt) {
        apiOptions.jwt = jwt;
      }

      const api = new JitsiMeetExternalAPI(domain, apiOptions);

      apiRef.current = api;

      api.addListener("videoConferenceJoined", () => {
        if (!disposed) setIsLoading(false);
      });

      api.addListener("videoConferenceLeft", () => {
        onCallEndRef.current?.();
      });

      api.addListener("readyToClose", () => {
        onCallEndRef.current?.();
      });

      api.addListener("participantJoined", () => {
        const count = api.getNumberOfParticipants?.() || 0;
        onParticipantJoinedRef.current?.(count);
      });

      api.addListener("participantLeft", () => {
        const count = api.getNumberOfParticipants?.() || 0;
        onParticipantLeftRef.current?.(count);
      });

      // Fallback: if videoConferenceJoined never fires, remove loading after 5s
      setTimeout(() => {
        if (!disposed) setIsLoading(false);
      }, 5000);
    };

    init();

    return () => {
      disposed = true;
      if (apiRef.current) {
        try { apiRef.current.dispose(); } catch { /* ignore */ }
        apiRef.current = null;
      }
    };
  }, [meetingUrl, roomName]);

  const handleRetry = useCallback(() => {
    setHasError(false);
    setIsLoading(true);
    // Force re-mount by clearing and re-setting
    if (apiRef.current) {
      try { apiRef.current.dispose(); } catch { /* ignore */ }
      apiRef.current = null;
    }
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
            onClick={handleRetry}
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

      {/* Jitsi container — the External API creates an iframe inside this div */}
      <div ref={containerRef} className="w-full h-full" />

      {/* Full-screen close button */}
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
