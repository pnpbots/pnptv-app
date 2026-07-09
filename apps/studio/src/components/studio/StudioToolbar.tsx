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
  onRaid?: () => void;
}

// ─── StudioToolbar ────────────────────────────────────────────────────────────

export function StudioToolbar({
  isLive,
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
  onRaid,
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

        {/* Raid */}
        {isLive && onRaid && (
          <QuickActionButton
            icon={
              <svg className="w-full h-full" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0" />
              </svg>
            }
            label="Raid"
            onClick={onRaid}
            title="Raid another channel"
          />
        )}
      </div>
    </div>
  );
}
