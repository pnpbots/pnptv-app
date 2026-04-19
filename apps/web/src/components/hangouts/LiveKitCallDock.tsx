import { useCallback, useEffect, useRef, useState } from "react";
import {
  LiveKitRoom,
  VideoConference,
  useRoomContext,
  useParticipants,
} from "@livekit/components-react";
import { ConnectionState, RoomEvent } from "livekit-client";
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

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

// Inner overlay — uses room hooks, so must live inside <LiveKitRoom>.
function CallOverlay({ startedBy }: { startedBy: string | null }) {
  const room = useRoomContext();
  const participants = useParticipants();
  const [elapsed, setElapsed] = useState(0);
  const [connState, setConnState] = useState<ConnectionState>(ConnectionState.Connecting);
  const joinTsRef = useRef<number | null>(null);

  useEffect(() => {
    if (!room) return;
    const handler = (s: ConnectionState) => {
      setConnState(s);
      if (s === ConnectionState.Connected && !joinTsRef.current) {
        joinTsRef.current = Date.now();
      }
    };
    room.on(RoomEvent.ConnectionStateChanged, handler);
    handler(room.state);
    return () => { room.off(RoomEvent.ConnectionStateChanged, handler); };
  }, [room]);

  useEffect(() => {
    const iv = setInterval(() => {
      if (joinTsRef.current) {
        setElapsed(Math.floor((Date.now() - joinTsRef.current) / 1000));
      }
    }, 1000);
    return () => clearInterval(iv);
  }, []);

  const isConnected = connState === ConnectionState.Connected;
  const isConnecting = connState === ConnectionState.Connecting;
  const isReconnecting = connState === ConnectionState.Reconnecting;
  const isAlone = isConnected && participants.length <= 1;

  return (
    <>
      <div
        className="pointer-events-none absolute top-0 left-0 right-0 z-10 p-2.5 flex items-center justify-between gap-2"
        style={{ background: "linear-gradient(180deg, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0) 100%)" }}
      >
        <div className="flex items-center gap-1.5 text-white text-xs min-w-0">
          {startedBy && (
            <span
              className="px-2.5 py-1 rounded-full bg-black/50 backdrop-blur-md truncate max-w-[180px] border border-white/10"
              title={`Hosted by ${startedBy}`}
            >
              <span className="mr-1">👑</span>
              <span className="font-medium">{startedBy}</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-white text-xs">
          {isConnected && (
            <span className="px-2.5 py-1 rounded-full bg-black/50 backdrop-blur-md tabular-nums font-medium border border-white/10">
              {formatDuration(elapsed)}
            </span>
          )}
          <span className="px-2.5 py-1 rounded-full bg-black/50 backdrop-blur-md border border-white/10">
            <span className="mr-1">👥</span>{participants.length}
          </span>
        </div>
      </div>

      {isReconnecting && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 z-10 px-3 py-1.5 rounded-full bg-amber-500/95 text-black text-xs font-semibold backdrop-blur-sm shadow-lg flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-amber-900 animate-pulse" />
          Reconnecting…
        </div>
      )}

      {isAlone && (
        <div className="pointer-events-none absolute bottom-24 left-1/2 -translate-x-1/2 z-10 px-4 py-3 rounded-2xl bg-black/70 text-white text-sm backdrop-blur-md border border-white/10 max-w-[280px] text-center">
          <div className="font-semibold mb-0.5">You're the only one here</div>
          <div className="text-xs text-white/70">Others can join from the hangout chat.</div>
        </div>
      )}

      {isConnecting && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black">
          <div className="flex flex-col items-center gap-3 text-white">
            <div
              className="w-10 h-10 rounded-full border-2 border-white/15 animate-spin"
              style={{ borderTopColor: "#D4007A" }}
            />
            <div className="text-sm text-white/80">Connecting…</div>
          </div>
        </div>
      )}
    </>
  );
}

function LiveKitCallPanel({
  open,
  onClose,
  token,
  livekitUrl,
  roomName,
  startedBy = null,
  initialChoices = null,
  onCallEnded,
}: LiveKitCallPanelProps) {
  const [activeToken, setActiveToken] = useState<string | null>(token);
  const [connectedAt, setConnectedAt] = useState<number | null>(null);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const hasLeftRef = useRef(false);

  useEffect(() => { setActiveToken(token); }, [token]);

  // Allow landscape while the call is open (portrait-lock CSS otherwise blocks it).
  useEffect(() => {
    if (!open) return;
    document.body.classList.add("allow-landscape");
    return () => { document.body.classList.remove("allow-landscape"); };
  }, [open]);

  // Fire /leave when the dock unmounts or closes so
  // hangout_call_participants.left_at is set and the DB trigger recomputes
  // participant_count.
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

  // LiveKit disconnect event also fires /leave so the participant row closes
  // even if the component stays mounted (e.g. remote end-of-call).
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

  const handleConnected = useCallback(() => {
    setConnectedAt(Date.now());
  }, []);

  // Leave flow — require confirmation after 10s of connection so accidental
  // taps on the × don't drop people from meaningful calls.
  const requestClose = useCallback(() => {
    const secondsInCall = connectedAt ? (Date.now() - connectedAt) / 1000 : 0;
    if (secondsInCall < 10) {
      onClose();
    } else {
      setShowLeaveConfirm(true);
    }
  }, [connectedAt, onClose]);

  const confirmLeave = useCallback(() => {
    setShowLeaveConfirm(false);
    onClose();
  }, [onClose]);

  if (!open || !activeToken) return null;

  // Safari <16 can't publish VP9 reliably — fall back to h264.
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const isSafari = /^((?!chrome|android|crios|fxios).)*safari/i.test(ua);
  const publishCodec: "vp9" | "h264" = isSafari ? "h264" : "vp9";

  return (
    <div
      className="lk-pnptv-call mx-3 mt-2 mb-1 flex-shrink-0 rounded-2xl overflow-hidden relative"
      data-lk-theme="default"
      style={{
        minHeight: "min(420px, 60dvh)",
        maxHeight: "min(80dvh, calc(100dvh - 5rem))",
        display: "flex",
        flexDirection: "column",
        border: "1px solid rgba(123,97,255,0.25)",
        background: "#000",
        boxShadow: "0 10px 40px rgba(123,97,255,0.12)",
      }}
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
          publishDefaults: { simulcast: true, videoCodec: publishCodec },
        }}
        onConnected={handleConnected}
        onDisconnected={handleDisconnected}
        style={{ display: "contents" }}
      >
        <VideoConference />
        <CallOverlay startedBy={startedBy} />
      </LiveKitRoom>

      <button
        type="button"
        onClick={requestClose}
        aria-label="Close call"
        className="absolute top-2 right-2 z-30 w-9 h-9 rounded-full bg-black/60 text-white hover:bg-black/80 active:scale-95 flex items-center justify-center text-xl leading-none backdrop-blur-md border border-white/10 transition-transform"
      >
        ×
      </button>

      {showLeaveConfirm && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="leave-call-title"
            className="rounded-2xl p-5 max-w-sm w-full text-white"
            style={{
              background: "rgba(19, 16, 26, 0.98)",
              border: "1px solid rgba(123,97,255,0.25)",
              boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
            }}
          >
            <div id="leave-call-title" className="text-lg font-semibold mb-1">Leave call?</div>
            <div className="text-sm text-white/70 mb-4">
              You'll be disconnected from this hangout. You can rejoin anytime.
            </div>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setShowLeaveConfirm(false)}
                className="px-4 py-2 rounded-full bg-white/10 text-white hover:bg-white/20 text-sm font-medium transition-colors"
              >
                Stay
              </button>
              <button
                type="button"
                onClick={confirmLeave}
                className="px-4 py-2 rounded-full text-white font-semibold text-sm transition-transform active:scale-95"
                style={{
                  background: "#D4007A",
                  boxShadow: "0 4px 14px rgba(212,0,122,0.45)",
                }}
              >
                Leave call
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export const LiveKitCallDock = LiveKitCallPanel;
export default LiveKitCallPanel;
