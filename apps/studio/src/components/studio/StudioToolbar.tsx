import React from "react";
import {
  QuickActionButton,
  MicIcon,
  MicOffIcon,
  VideoIcon,
  VideoOffIcon,
  MonitorIcon,
  PauseIcon,
  CameraIcon,
  RefreshCwIcon,
} from "./shared";

// ─── Props ────────────────────────────────────────────────────────────────────

export interface StudioToolbarProps {
  isLive: boolean;
  isMuted: boolean;
  isCameraOff: boolean;
  isScreenSharing: boolean;
  canFlipCamera: boolean;
  onToggleMute: () => void;
  onToggleCamera: () => void;
  onScreenShare: () => void;
  onBrb: () => void;
  onSnapshot: () => void;
  onFlipCamera: () => void;
}

// ─── StudioToolbar ────────────────────────────────────────────────────────────

export function StudioToolbar({
  isMuted,
  isCameraOff,
  isScreenSharing,
  canFlipCamera,
  onToggleMute,
  onToggleCamera,
  onScreenShare,
  onBrb,
  onSnapshot,
  onFlipCamera,
}: StudioToolbarProps) {
  return (
    <div
      className="flex-shrink-0 px-3 py-2.5 border-b border-pnp-border"
      style={{ background: "rgba(18,18,18,0.85)" }}
    >
      <div className="flex items-center justify-center gap-2 flex-wrap">
        {/* Mute */}
        <QuickActionButton
          icon={isMuted ? <MicOffIcon className="w-full h-full" /> : <MicIcon className="w-full h-full" />}
          label={isMuted ? "Unmute" : "Mute"}
          active={isMuted}
          activeColor="#FF453A"
          onClick={onToggleMute}
          title={isMuted ? "Unmute microphone" : "Mute microphone"}
        />

        {/* Camera */}
        <QuickActionButton
          icon={isCameraOff ? <VideoOffIcon className="w-full h-full" /> : <VideoIcon className="w-full h-full" />}
          label={isCameraOff ? "Cam On" : "Cam Off"}
          active={isCameraOff}
          activeColor="#FF453A"
          onClick={onToggleCamera}
          title={isCameraOff ? "Turn camera on" : "Turn camera off"}
        />

        {/* Screen Share */}
        <QuickActionButton
          icon={<MonitorIcon className="w-full h-full" />}
          label="Share"
          active={isScreenSharing}
          onClick={onScreenShare}
          title={isScreenSharing ? "Stop screen share" : "Share screen"}
        />

        {/* BRB */}
        <QuickActionButton
          icon={<PauseIcon className="w-full h-full" />}
          label="BRB"
          onClick={onBrb}
          title="Be Right Back — mutes mic and camera"
        />

        {/* Snapshot */}
        <QuickActionButton
          icon={<CameraIcon className="w-full h-full" />}
          label="Snapshot"
          onClick={onSnapshot}
          title="Capture screenshot"
        />

        {/* Flip Camera */}
        <QuickActionButton
          icon={<RefreshCwIcon className="w-full h-full" />}
          label="Flip"
          onClick={onFlipCamera}
          disabled={!canFlipCamera}
          title="Switch camera"
        />
      </div>
    </div>
  );
}
