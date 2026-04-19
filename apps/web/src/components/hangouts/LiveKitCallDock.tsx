import { useCallback, useEffect, useRef, useState } from "react";
import { LiveKitRoom, VideoConference } from "@livekit/components-react";
import type { LocalUserChoices } from "@livekit/components-core";

interface LiveKitCallPanelProps {
  open: boolean;
  onClose: () => void;
  token: string | null;
  livekitUrl: string;
  roomName: string | null;
  startedBy?: string | null;
  participantCount?: number;
  durationLabel?: string;
  initialChoices?: LocalUserChoices | null;
  onCallEnded?: () => void;
}

function extractGroupId(name: string | null): number | null {
  if (!name) return null;
  const match = name.match(/hangout[-_](\d+)/);
  if (!match) return null;
  const id = parseInt(match[1], 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function LiveKitCallPanel({
  open,
  onClose,
  token,
  livekitUrl,
  roomName,
  initialChoices = null,
  onCallEnded,
}: LiveKitCallPanelProps) {
  const [activeToken, setActiveToken] = useState<string | null>(token);
  const hasLeftRef = useRef(false);

  useEffect(() => { setActiveToken(token); }, [token]);

  // Fire /leave when the dock unmounts or closes so hangout_call_participants
  // rows get left_at and the DB trigger recomputes participant_count.
  useEffect(() => {
    if (!open || !roomName) return;
    hasLeftRef.current = false;
    return () => {
      if (hasLeftRef.current) return;
      hasLeftRef.current = true;
      const groupId = extractGroupId(roomName);
      if (groupId == null) return;
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      import("@/lib/api").then(({ leaveHangoutCall }) => {
        leaveHangoutCall(groupId).catch(() => {});
      }).catch(() => {});
    };
  }, [open, roomName]);

  // LiveKit disconnect event also fires /leave so the participant row is
  // marked left_at even if the component stays mounted (remote end-of-call).
  const handleDisconnected = useCallback(() => {
    if (!hasLeftRef.current && roomName) {
      hasLeftRef.current = true;
      const groupId = extractGroupId(roomName);
      if (groupId != null) {
        import("@/lib/api").then(({ leaveHangoutCall }) => {
          leaveHangoutCall(groupId).catch(() => {});
        }).catch(() => {});
      }
    }
    onCallEnded?.();
  }, [roomName, onCallEnded]);

  if (!open || !activeToken) return null;

  // Safari <16 can't publish VP9 reliably — fall back to h264.
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const isSafari = /^((?!chrome|android|crios|fxios).)*safari/i.test(ua);
  const publishCodec: "vp9" | "h264" = isSafari ? "h264" : "vp9";

  return (
    <div
      className="mx-3 mt-2 mb-1 flex-shrink-0 rounded-2xl overflow-hidden relative"
      style={{
        minHeight: "min(420px, 60dvh)",
        maxHeight: "min(80dvh, calc(100dvh - 5rem))",
        display: "flex",
        flexDirection: "column",
        border: "1px solid rgba(123,97,255,0.2)",
        background: "#000",
      }}
      data-lk-theme="default"
    >
      <LiveKitRoom
        token={activeToken}
        serverUrl={livekitUrl}
        connect={true}
        audio={initialChoices
          ? (initialChoices.audioEnabled ? { deviceId: initialChoices.audioDeviceId || undefined } : false)
          : false}
        video={initialChoices
          ? (initialChoices.videoEnabled ? { deviceId: initialChoices.videoDeviceId || undefined } : false)
          : true}
        options={{
          adaptiveStream: true,
          dynacast: true,
          publishDefaults: {
            simulcast: true,
            videoCodec: publishCodec,
          },
        }}
        onDisconnected={handleDisconnected}
        style={{ display: "contents" }}
      >
        <VideoConference />
      </LiveKitRoom>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close call"
        className="absolute top-2 right-2 z-20 w-8 h-8 rounded-full bg-black/60 text-white hover:bg-black/80 flex items-center justify-center text-lg leading-none"
      >
        ×
      </button>
    </div>
  );
}

export const LiveKitCallDock = LiveKitCallPanel;
export default LiveKitCallPanel;
