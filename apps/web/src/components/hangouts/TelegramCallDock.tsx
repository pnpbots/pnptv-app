import React, { useEffect, useRef, useState } from "react";
import { LiveKitRoom, VideoConference } from "@livekit/components-react";

interface LiveKitCallPanelProps {
  open: boolean;
  onClose: () => void;
  token: string | null;
  livekitUrl: string;
  roomName: string | null;
  startedBy?: string | null;
  participantCount?: number;
  durationLabel?: string;
  onCallEnded?: () => void;
}

type DockPosition = {
  x: number;
  y: number;
};

const PANEL_WIDTH = 420;
const PANEL_HEIGHT = 560;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function getDefaultFloatingPosition(): DockPosition {
  return {
    x: Math.max(16, window.innerWidth - PANEL_WIDTH - 24),
    y: Math.max(16, window.innerHeight - PANEL_HEIGHT - 96),
  };
}

function LiveKitCallPanel({
  open,
  onClose,
  token,
  livekitUrl,
  roomName,
  startedBy = null,
  participantCount = 0,
  durationLabel = "0:00",
  onCallEnded,
}: LiveKitCallPanelProps) {
  const dragRef = useRef<{
    pointerId: number | null;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  }>({ pointerId: null, startX: 0, startY: 0, originX: 0, originY: 0 });

  const [floatingPos, setFloatingPos] = useState<DockPosition>(() => ({ x: 16, y: 16 }));
  const [detached, setDetached] = useState(true);

  useEffect(() => {
    setFloatingPos(getDefaultFloatingPosition());
  }, [open]);

  useEffect(() => {
    const onResize = () => {
      setFloatingPos((prev) => ({
        x: clamp(prev.x, 8, Math.max(8, window.innerWidth - PANEL_WIDTH - 8)),
        y: clamp(prev.y, 8, Math.max(8, window.innerHeight - PANEL_HEIGHT - 8)),
      }));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  if (!open || !token) return null;

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!detached) return;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: floatingPos.x,
      originY: floatingPos.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!detached || dragRef.current.pointerId !== event.pointerId) return;
    const nextX = dragRef.current.originX + (event.clientX - dragRef.current.startX);
    const nextY = dragRef.current.originY + (event.clientY - dragRef.current.startY);
    setFloatingPos({
      x: clamp(nextX, 8, Math.max(8, window.innerWidth - PANEL_WIDTH - 8)),
      y: clamp(nextY, 8, Math.max(8, window.innerHeight - PANEL_HEIGHT - 8)),
    });
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current.pointerId !== event.pointerId) return;
    dragRef.current.pointerId = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const shell = (
    <div
      className="flex h-full flex-col overflow-hidden rounded-[22px] border shadow-2xl"
      style={{
        background: "linear-gradient(180deg, rgba(22,27,42,0.98), rgba(14,18,28,0.98))",
        borderColor: "rgba(100,210,255,0.22)",
      }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-3 border-b px-3 py-2 flex-shrink-0"
        style={{ borderColor: "rgba(255,255,255,0.08)", cursor: detached ? "grab" : "default" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        {/* Live call indicator */}
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse flex-shrink-0" />
          <p className="truncate text-sm font-bold text-white">Group Call</p>
          {participantCount > 0 && (
            <span
              className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ml-1"
              style={{ background: "rgba(255,59,48,0.14)", color: "#FF5A52" }}
            >
              {participantCount}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          {(startedBy || durationLabel !== "0:00") && (
            <span className="hidden sm:block text-[11px] text-white/45 mr-1">
              {startedBy ? `${startedBy} · ` : ""}{durationLabel}
            </span>
          )}
          <button
            onClick={() => setDetached((v) => !v)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border text-white/60 transition-all hover:bg-white/10"
            style={{ borderColor: "rgba(255,255,255,0.1)" }}
            aria-label={detached ? "Dock call panel" : "Detach call panel"}
            title={detached ? "Dock into page" : "Float as panel"}
          >
            {detached ? (
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 7.5A2.5 2.5 0 016.5 5h11A2.5 2.5 0 0120 7.5v9A2.5 2.5 0 0117.5 19h-11A2.5 2.5 0 014 16.5v-9z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 9h8M8 12h5" />
              </svg>
            ) : (
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5h6v6m0-6L12 12" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 6.75h4.5m-4.5 0v10.5a1.5 1.5 0 001.5 1.5h10.5" />
              </svg>
            )}
          </button>
          <button
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border text-white/50 transition-all hover:bg-white/10"
            style={{ borderColor: "rgba(255,255,255,0.1)" }}
            aria-label="Close call panel"
            title="Close call panel"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* LiveKit room */}
      <div className="min-h-0 flex-1 overflow-hidden">
        <LiveKitRoom
          token={token}
          serverUrl={livekitUrl}
          connect={true}
          video={true}
          audio={true}
          onDisconnected={() => {
            onCallEnded?.();
          }}
          style={{ height: "100%", background: "transparent" }}
        >
          <VideoConference />
        </LiveKitRoom>
      </div>
    </div>
  );

  if (detached) {
    return (
      <div
        className="fixed z-[95]"
        style={{
          width: PANEL_WIDTH,
          height: PANEL_HEIGHT,
          left: floatingPos.x,
          top: floatingPos.y,
        }}
      >
        {shell}
      </div>
    );
  }

  return <div className="overflow-hidden rounded-[22px]">{shell}</div>;
}

export const TelegramCallDock = LiveKitCallPanel;
export default LiveKitCallPanel;
