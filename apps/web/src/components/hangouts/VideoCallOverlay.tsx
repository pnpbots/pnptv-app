import React, { useState, useCallback, useEffect } from "react";
import { JitsiMeetComponent } from "./JitsiMeetComponent";
import { VideoCallModBot } from "./VideoCallModBot";
import { PermissionGate } from "@/components/PermissionGate";

// ─── Types ──────────────────────────────────────────────────────────────────

type ViewMode = "fullscreen" | "embedded" | "pip";

interface SocketChatData {
  messages: import("@/lib/api").GroupMessage[];
  sendMessage: (content: string) => void;
  emitTyping: () => void;
  typingUsers: string[];
}

interface VideoCallOverlayProps {
  /** Full JaaS/Jitsi meeting URL */
  meetingUrl: string;
  /** Room name for display/accessibility */
  roomName?: string;
  /** Group name for display in the header */
  groupName?: string;
  /** Called when the user closes/ends the call */
  onClose: () => void;
  /** Initial view mode */
  initialMode?: ViewMode;
  /** Admin/superadmin gets full toolbar */
  isAdmin?: boolean;
  /** Group owner or call creator — also receives moderator toolbar */
  isModerator?: boolean;
  /** Group ID for side panel chat */
  groupId?: number;
  /** User ID for side panel chat */
  userId?: string;
  /** Pre-wired socket data from parent */
  socketChat?: SocketChatData;
  /** Whether this overlay is inside the Main Stage */
  isMainStage?: boolean;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function VideoCallOverlay({
  meetingUrl,
  roomName,
  groupName,
  onClose,
  initialMode = "embedded",
  isAdmin = false,
  isModerator = false,
  groupId,
  userId,
  socketChat,
  isMainStage = false,
}: VideoCallOverlayProps) {
  const [viewMode, setViewMode] = useState<ViewMode>(initialMode);
  const [permsGranted, setPermsGranted] = useState(false);
  // Jitsi External API object — provided by JitsiMeetComponent via onApiReady
  const [jitsiApi, setJitsiApi] = useState<any>(null);

  // Prevent body scroll in fullscreen mode
  useEffect(() => {
    if (viewMode === "fullscreen") {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [viewMode]);

  // Escape key to exit fullscreen
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && viewMode === "fullscreen") {
        setViewMode("embedded");
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [viewMode]);

  const handleApiReady = useCallback((api: any) => {
    setJitsiApi(api);
  }, []);

  // ─── PiP (Picture-in-Picture) mode ────────────────────────────────────

  if (viewMode === "pip") {
    return (
      <div
        className="fixed bottom-24 right-4 z-[35] w-40 h-28 sm:w-56 sm:h-36 rounded-xl overflow-hidden shadow-2xl ring-1 ring-white/10 animate-fade-in-up"
        style={{ touchAction: "none" }}
        role="dialog"
        aria-label="Video call picture-in-picture"
      >
        {/* Overlay controls */}
        <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between px-2 py-1 bg-gradient-to-b from-black/70 to-transparent">
          <span className="text-[9px] font-semibold text-white truncate max-w-[60%]">
            {groupName || "Video Call"}
          </span>
          <div className="flex gap-1">
            <button
              onClick={() => setViewMode("embedded")}
              className="w-6 h-6 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 active:scale-90 transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-pnp-accent"
              aria-label="Expand video call"
            >
              <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
              </svg>
            </button>
            <button
              onClick={onClose}
              className="w-6 h-6 flex items-center justify-center rounded-full bg-pnp-error/80 hover:bg-pnp-error active:scale-90 transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-pnp-accent"
              aria-label="End video call"
            >
              <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <JitsiMeetComponent
          meetingUrl={meetingUrl}
          roomName={roomName}
          onCallEnd={onClose}
          isAdmin={isAdmin}
          isModerator={isModerator}
          disableChat={true}
          onApiReady={handleApiReady}
        />
      </div>
    );
  }

  // ─── Fullscreen mode ──────────────────────────────────────────────────

  if (viewMode === "fullscreen") {
    return (
      <div
        className="fixed inset-0 z-[35] bg-pnp-background flex"
        role="dialog"
        aria-modal="true"
        aria-label="Video call fullscreen"
      >
        {/* Video area — widgets (Nearby, Cristina, Radio) float on top via Layout.tsx */}
        <div className="flex-1 flex flex-col min-w-0 relative">
          <JitsiMeetComponent
            meetingUrl={meetingUrl}
            roomName={roomName}
            onCallEnd={onClose}
            isAdmin={isAdmin}
            isModerator={isModerator}
            disableChat={true}
            onApiReady={handleApiReady}
            fullScreen
          />

          {/* View-mode controls overlay */}
          <div className="absolute top-3 right-3 z-20 flex items-center gap-2">
            {/* Minimize to PiP */}
            <button
              onClick={() => setViewMode("pip")}
              className="w-9 h-9 flex items-center justify-center rounded-full bg-black/40 hover:bg-black/60 active:scale-95 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent"
              aria-label="Minimize to picture-in-picture"
            >
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" />
              </svg>
            </button>

            {/* Exit fullscreen */}
            <button
              onClick={() => setViewMode("embedded")}
              className="w-9 h-9 flex items-center justify-center rounded-full bg-black/40 hover:bg-black/60 active:scale-95 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent"
              aria-label="Exit fullscreen"
            >
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" />
              </svg>
            </button>
          </div>
        </div>

        {/* Mod Bot (right, admin only) */}
        {isAdmin && (
          <div className="hidden sm:flex flex-shrink-0 p-2">
            <VideoCallModBot room={jitsiApi} isAdmin={isAdmin} />
          </div>
        )}

      </div>
    );
  }

  // ─── Permission gate ──────────────────────────────────────────────────
  if (!permsGranted) {
    return (
      <PermissionGate
        onGranted={() => setPermsGranted(true)}
        onCancel={onClose}
      />
    );
  }

  // ─── Embedded mode (default) ──────────────────────────────────────────

  return (
    <div className="glass-card-sm mx-4 mt-2 flex-shrink-0 overflow-hidden animate-fade-in-up">
      {/* Header bar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/5">
        <div className="flex items-center gap-2 min-w-0">
          <span className="relative flex h-2 w-2 flex-shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-pnp-accent opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 dot-gradient" />
          </span>
          <span className="text-xs font-medium text-pnp-textPrimary truncate">
            {groupName ? `Call - ${groupName}` : "Video Call"}
          </span>
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          {/* Fullscreen toggle */}
          <button
            onClick={() => setViewMode("fullscreen")}
            className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-white/10 active:scale-95 transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-pnp-accent"
            aria-label="Enter fullscreen"
          >
            <svg className="w-3.5 h-3.5 text-pnp-textSecondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
            </svg>
          </button>

          {/* Minimize to PiP */}
          <button
            onClick={() => setViewMode("pip")}
            className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-white/10 active:scale-95 transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-pnp-accent"
            aria-label="Minimize to picture-in-picture"
          >
            <svg className="w-3.5 h-3.5 text-pnp-textSecondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" />
            </svg>
          </button>

          {/* Close/end */}
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 px-3 h-8 rounded-lg text-xs font-semibold border active:scale-95 transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-pnp-error"
            style={{ color: "#FF6B6B", borderColor: "rgba(255,107,107,0.4)" }}
            aria-label="End video call"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
            End
          </button>
        </div>
      </div>

      {/* Video — widgets (Nearby, Cristina, Radio) float on top via Layout.tsx */}
      <div className="flex">
        <div className="flex-1 min-w-0">
          <JitsiMeetComponent
            meetingUrl={meetingUrl}
            roomName={roomName}
            onCallEnd={onClose}
            isAdmin={isAdmin}
            isModerator={isModerator}
            disableChat={true}
            onApiReady={handleApiReady}
          />
        </div>

        {/* Mod Bot (desktop, admin only) */}
        {isAdmin && (
          <div className="hidden lg:flex flex-shrink-0 p-2 border-l border-white/5">
            <VideoCallModBot room={jitsiApi} isAdmin={isAdmin} />
          </div>
        )}
      </div>
    </div>
  );
}
