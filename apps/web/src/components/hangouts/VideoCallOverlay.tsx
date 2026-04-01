import React, { useState, useCallback, useEffect, useRef } from "react";
import { JitsiMeetComponent } from "./JitsiMeetComponent";
import type { JitsiParticipant } from "./JitsiMeetComponent";

// ─── Types ──────────────────────────────────────────────────────────────────

type ViewMode = "fullscreen" | "embedded" | "pip";
type PreCallStage = "preview" | "live";

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
  /** Whether this overlay is inside the Main Stage */
  isMainStage?: boolean;
  /** ISO string of when the call started — drives the duration timer */
  callStartedAt?: string | null;
  /** Current participant count from the backend */
  participantCount?: number;
}

// ─── Duration timer hook ─────────────────────────────────────────────────────

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

// ─── Pre-call preview ────────────────────────────────────────────────────────

type DeviceError = "denied" | "notfound" | "inuse" | "unavailable" | null;

interface PreCallPreviewProps {
  onJoin: (audioMuted: boolean, videoMuted: boolean) => void;
  onCancel: () => void;
  groupName?: string;
}

function PreCallPreview({ onJoin, onCancel, groupName }: PreCallPreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [audioMuted, setAudioMuted] = useState(false);
  const [videoOff, setVideoOff] = useState(false);
  const [deviceError, setDeviceError] = useState<DeviceError>(null);
  const [acquiring, setAcquiring] = useState(true);

  // Start local preview stream
  useEffect(() => {
    let cancelled = false;

    const start = async () => {
      setAcquiring(true);
      setDeviceError(null);
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: true,
        });
        if (cancelled) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch (err: unknown) {
        if (cancelled) return;
        const e = err as DOMException;
        if (e.name === "NotAllowedError" || e.name === "PermissionDeniedError") {
          setDeviceError("denied");
        } else if (e.name === "NotFoundError") {
          setDeviceError("notfound");
        } else if (e.name === "NotReadableError") {
          setDeviceError("inuse");
        } else {
          setDeviceError("unavailable");
        }
      } finally {
        if (!cancelled) setAcquiring(false);
      }
    };

    const hasGetUserMedia =
      typeof navigator !== "undefined" &&
      !!navigator.mediaDevices &&
      typeof navigator.mediaDevices.getUserMedia === "function";

    if (hasGetUserMedia) {
      start();
    } else {
      setDeviceError("unavailable");
      setAcquiring(false);
    }

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    };
  }, []);

  // Toggle mic track
  const toggleAudio = useCallback(() => {
    setAudioMuted(prev => {
      const next = !prev;
      streamRef.current?.getAudioTracks().forEach(t => { t.enabled = !next; });
      return next;
    });
  }, []);

  // Toggle camera track
  const toggleVideo = useCallback(() => {
    setVideoOff(prev => {
      const next = !prev;
      streamRef.current?.getVideoTracks().forEach(t => { t.enabled = !next; });
      return next;
    });
  }, []);

  const handleJoin = useCallback(() => {
    // Stop preview stream — Jitsi will acquire its own
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    onJoin(audioMuted, videoOff);
  }, [audioMuted, videoOff, onJoin]);

  const handleCancel = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    onCancel();
  }, [onCancel]);

  // Error messages
  const errorMessages: Record<NonNullable<DeviceError>, string> = {
    denied: "Camera or microphone access was denied. You can still join — Jitsi will prompt you inside the call.",
    notfound: "No camera or microphone found on this device.",
    inuse: "Camera is already in use by another app. Close it and try again, or join anyway.",
    unavailable: "Camera/microphone not available in this browser. You can still join the call.",
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm px-4">
      <div className="w-full max-w-md rounded-2xl overflow-hidden bg-pnp-surface border border-white/10 animate-fade-in-up">
        {/* Header */}
        <div className="px-5 pt-5 pb-3">
          <h2 className="text-base font-bold text-pnp-textPrimary">
            {groupName ? `Join – ${groupName}` : "Join Video Call"}
          </h2>
          <p className="text-xs text-pnp-textSecondary mt-0.5">
            Set up your camera and microphone before joining
          </p>
        </div>

        {/* Video preview area */}
        <div className="relative mx-5 rounded-xl overflow-hidden bg-black aspect-video">
          {/* Local video — mirrored so it looks natural */}
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            onContextMenu={(e) => e.preventDefault()}
            className={`w-full h-full object-cover [transform:scaleX(-1)] ${videoOff || deviceError ? "invisible" : "visible"}`}
          />

          {/* Camera-off / error overlay */}
          {(videoOff || deviceError || acquiring) && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
              {acquiring && !deviceError && (
                <div className="w-8 h-8 rounded-full border-2 border-pnp-border border-t-pnp-accent animate-spin" />
              )}
              {!acquiring && (videoOff || deviceError) && (
                <svg className="w-10 h-10 text-pnp-textSecondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  {videoOff ? (
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M12 18.75H4.5a2.25 2.25 0 01-2.25-2.25V9m12.841 9.091L16.5 19.5m-1.409-1.409c.407-.407.659-.97.659-1.591v-9a2.25 2.25 0 00-2.25-2.25h-9c-.621 0-1.184.252-1.591.659m12.182 12.182L2.909 5.909M1.5 4.5l1.409 1.409" />
                  )}
                </svg>
              )}
              {videoOff && <p className="text-xs text-pnp-textSecondary">Camera is off</p>}
            </div>
          )}

          {/* Mic muted badge */}
          {audioMuted && (
            <div className="absolute bottom-2 left-2 flex items-center gap-1 bg-black/60 rounded-full px-2 py-1">
              <svg className="w-3 h-3 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
              </svg>
              <span className="text-[10px] text-red-400 font-medium">Muted</span>
            </div>
          )}
        </div>

        {/* Device error message */}
        {deviceError && (
          <div className="mx-5 mt-3 flex items-start gap-2 bg-yellow-500/10 border border-yellow-500/30 rounded-lg px-3 py-2.5">
            <svg className="w-4 h-4 text-yellow-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
            <p className="text-xs text-yellow-300">{errorMessages[deviceError]}</p>
          </div>
        )}

        {/* Device toggle controls */}
        <div className="flex items-center justify-center gap-4 px-5 pt-4 pb-2">
          {/* Mic toggle */}
          <button
            onClick={toggleAudio}
            disabled={deviceError === "denied" || deviceError === "notfound"}
            className={`flex flex-col items-center gap-1 group disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent rounded-xl p-1`}
            aria-label={audioMuted ? "Unmute microphone" : "Mute microphone"}
          >
            <div className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${audioMuted ? "bg-red-500/20 ring-1 ring-red-500/50" : "bg-white/10 group-hover:bg-white/15"}`}>
              {audioMuted ? (
                <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
                </svg>
              ) : (
                <svg className="w-5 h-5 text-pnp-textPrimary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
                </svg>
              )}
            </div>
            <span className={`text-[10px] font-medium ${audioMuted ? "text-red-400" : "text-pnp-textSecondary"}`}>
              {audioMuted ? "Unmute" : "Mute"}
            </span>
          </button>

          {/* Camera toggle */}
          <button
            onClick={toggleVideo}
            disabled={deviceError === "denied" || deviceError === "notfound"}
            className="flex flex-col items-center gap-1 group disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent rounded-xl p-1"
            aria-label={videoOff ? "Turn camera on" : "Turn camera off"}
          >
            <div className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${videoOff ? "bg-red-500/20 ring-1 ring-red-500/50" : "bg-white/10 group-hover:bg-white/15"}`}>
              {videoOff ? (
                <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M12 18.75H4.5a2.25 2.25 0 01-2.25-2.25V9m12.841 9.091L16.5 19.5m-1.409-1.409c.407-.407.659-.97.659-1.591v-9a2.25 2.25 0 00-2.25-2.25h-9c-.621 0-1.184.252-1.591.659m12.182 12.182L2.909 5.909M1.5 4.5l1.409 1.409" />
                </svg>
              ) : (
                <svg className="w-5 h-5 text-pnp-textPrimary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              )}
            </div>
            <span className={`text-[10px] font-medium ${videoOff ? "text-red-400" : "text-pnp-textSecondary"}`}>
              {videoOff ? "Camera off" : "Camera on"}
            </span>
          </button>
        </div>

        {/* Action buttons */}
        <div className="flex gap-3 px-5 pt-2 pb-5">
          <button
            onClick={handleCancel}
            className="flex-1 py-3 rounded-xl text-sm font-semibold text-pnp-textSecondary border border-white/10 hover:bg-white/5 active:scale-95 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent"
          >
            Cancel
          </button>
          <button
            onClick={handleJoin}
            className="flex-[2] py-3 rounded-xl text-sm font-semibold text-white btn-gradient active:scale-95 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent"
          >
            Join Call
          </button>
        </div>
      </div>
    </div>
  );
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
  isMainStage = false,
  callStartedAt,
  participantCount = 0,
}: VideoCallOverlayProps) {
  const [viewMode, setViewMode] = useState<ViewMode>(initialMode);
  const [stage, setStage] = useState<PreCallStage>("preview");
  const [startAudioMuted, setStartAudioMuted] = useState(false);
  const [startVideoMuted, setStartVideoMuted] = useState(false);
  // Jitsi External API object — provided by JitsiMeetComponent via onApiReady
  const [jitsiApi, setJitsiApi] = useState<any>(null);
  // Live participant list from Jitsi events
  const [liveParticipants, setLiveParticipants] = useState<JitsiParticipant[]>([]);
  // Screen sharing state
  const [isSomeoneSharingScreen, setIsSomeoneSharingScreen] = useState(false);

  const duration = useCallDuration(stage === "live" ? callStartedAt : null);

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

  const handleParticipantsChange = useCallback((participants: JitsiParticipant[]) => {
    setLiveParticipants(participants);
  }, []);

  const handleScreenShareChange = useCallback((sharing: boolean) => {
    setIsSomeoneSharingScreen(sharing);
  }, []);

  const handleJoinFromPreview = useCallback((audioMuted: boolean, videoMuted: boolean) => {
    setStartAudioMuted(audioMuted);
    setStartVideoMuted(videoMuted);
    setStage("live");
  }, []);

  // Effective participant count: prefer live Jitsi count, fall back to backend count
  const effectiveParticipantCount = stage === "live" && liveParticipants.length > 0
    ? liveParticipants.length
    : participantCount;

  // ─── Pre-call preview ──────────────────────────────────────────────────

  if (stage === "preview") {
    return (
      <PreCallPreview
        onJoin={handleJoinFromPreview}
        onCancel={onClose}
        groupName={groupName}
      />
    );
  }

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
          onParticipantsChange={handleParticipantsChange}
          onScreenShareChange={handleScreenShareChange}
          startWithAudioMuted={startAudioMuted}
          startWithVideoMuted={startVideoMuted}
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
        {/* Video area */}
        <div className="flex-1 flex flex-col min-w-0 relative">
          <JitsiMeetComponent
            meetingUrl={meetingUrl}
            roomName={roomName}
            onCallEnd={onClose}
            isAdmin={isAdmin}
            isModerator={isModerator}
            disableChat={true}
            onApiReady={handleApiReady}
            onParticipantsChange={handleParticipantsChange}
            onScreenShareChange={handleScreenShareChange}
            fullScreen
            startWithAudioMuted={startAudioMuted}
            startWithVideoMuted={startVideoMuted}
          />

          {/* HUD bar — top right */}
          <div className="absolute top-3 right-3 z-20 flex items-center gap-2">
            {/* Screen share indicator */}
            {isSomeoneSharingScreen && (
              <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-pnp-accent/20 ring-1 ring-pnp-accent/50">
                <svg className="w-3.5 h-3.5 text-pnp-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0H3" />
                </svg>
                <span className="text-[10px] font-semibold text-pnp-accent">Sharing</span>
              </div>
            )}

            {/* Duration timer */}
            {callStartedAt && (
              <div className="px-2 py-1 rounded-full bg-black/50 text-[11px] font-mono text-white">
                {duration}
              </div>
            )}

            {/* Participant count */}
            {effectiveParticipantCount > 0 && (
              <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-black/50">
                <svg className="w-3 h-3 text-white/70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
                </svg>
                <span className="text-[11px] text-white/80 font-medium">{effectiveParticipantCount}</span>
              </div>
            )}

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
      </div>
    );
  }

  // ─── Embedded mode (default) ──────────────────────────────────────────

  return (
    <div className="glass-card-sm mx-4 mt-2 flex-shrink-0 overflow-hidden animate-fade-in-up">
      {/* Header bar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/5">
        <div className="flex items-center gap-2 min-w-0">
          {/* Live dot */}
          <span className="relative flex h-2 w-2 flex-shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-pnp-accent opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 dot-gradient" />
          </span>

          <span className="text-xs font-medium text-pnp-textPrimary truncate">
            {groupName ? `Call – ${groupName}` : "Video Call"}
          </span>

          {/* Duration timer */}
          {callStartedAt && (
            <span className="text-[10px] font-mono text-pnp-textSecondary tabular-nums flex-shrink-0">
              {duration}
            </span>
          )}

          {/* Screen share indicator */}
          {isSomeoneSharingScreen && (
            <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-pnp-accent/15 ring-1 ring-pnp-accent/40 flex-shrink-0">
              <svg className="w-3 h-3 text-pnp-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0H3" />
              </svg>
              <span className="text-[9px] font-semibold text-pnp-accent">Sharing</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          {/* Participant count badge */}
          {effectiveParticipantCount > 0 && (
            <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/5 border border-white/10">
              <svg className="w-3 h-3 text-pnp-textSecondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
              </svg>
              <span className="text-[10px] font-medium text-pnp-textSecondary tabular-nums">
                {effectiveParticipantCount}
              </span>
            </div>
          )}

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
            className="flex items-center gap-1.5 px-3 h-8 rounded-lg text-xs font-semibold border border-red-500/40 text-red-400 hover:bg-red-500/10 active:scale-95 transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-pnp-error"
            aria-label="End video call"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
            End
          </button>
        </div>
      </div>

      {/* Video */}
      <div className="flex relative">
        <div className="flex-1 min-w-0">
          <JitsiMeetComponent
            meetingUrl={meetingUrl}
            roomName={roomName}
            onCallEnd={onClose}
            isAdmin={isAdmin}
            isModerator={isModerator}
            disableChat={true}
            onApiReady={handleApiReady}
            onParticipantsChange={handleParticipantsChange}
            onScreenShareChange={handleScreenShareChange}
            startWithAudioMuted={startAudioMuted}
            startWithVideoMuted={startVideoMuted}
          />
        </div>
      </div>
    </div>
  );
}
