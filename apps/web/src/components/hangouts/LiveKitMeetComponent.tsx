import React, {
  useState,
  useCallback,
  useEffect,
  useRef,
  useMemo,
} from "react";
import {
  LiveKitRoom,
  useLocalParticipant,
  useRemoteParticipants,
  useParticipants,
  useTracks,
  useRoomContext,
  TrackToggle,
  useMediaDeviceSelect,
  VideoTrack,
  AudioTrack,
  useIsSpeaking,
  useConnectionQualityIndicator,
  useDataChannel,
} from "@livekit/components-react";
import {
  Track,
  Participant,
  ConnectionQuality,
  RoomEvent,
} from "livekit-client";
import type { LocalParticipant as LKLocalParticipant } from "livekit-client";

// ─── Types ───────────────────────────────────────────────────────────────────

interface LiveKitMeetProps {
  token: string;
  wsUrl: string;
  roomName?: string;
  onCallEnd: () => void;
  onParticipantJoined?: (count: number) => void;
  onParticipantLeft?: (count: number) => void;
  isAdmin?: boolean;
  isModerator?: boolean;
  fullScreen?: boolean;
  disableChat?: boolean;
  onRoomConnected?: (room: unknown) => void;
}

type LayoutMode = "grid" | "spotlight" | "gallery";

type VideoQuality = "low" | "medium" | "high";

interface DataMessage {
  type: "reaction" | "hand_raise";
  emoji?: string;
  raised?: boolean;
  identity?: string;
}

interface FloatingReaction {
  id: number;
  emoji: string;
  x: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const VIDEO_QUALITY_PRESETS: Record<VideoQuality, { width: number; height: number; frameRate: number; label: string }> = {
  low:    { width: 640,  height: 360,  frameRate: 30, label: "Low (360p)"    },
  medium: { width: 1280, height: 720,  frameRate: 30, label: "Medium (720p)" },
  high:   { width: 1920, height: 1080, frameRate: 30, label: "High (1080p)"  },
};

const EMOJI_REACTIONS = ["👍", "❤️", "😂", "🔥", "👏", "🎉"];

const ICON_BTN_STYLE: React.CSSProperties = {
  width: 44,
  height: 44,
  borderRadius: "50%",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "rgba(255,255,255,0.1)",
  border: "none",
  cursor: "pointer",
  transition: "background 0.15s",
  color: "white",
  flexShrink: 0,
  padding: 0,
};

const SELECT_STYLE: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  borderRadius: "8px",
  background: "#2C2C2E",
  border: "1px solid rgba(255,255,255,0.1)",
  color: "#EBEBF5",
  fontSize: "13px",
  outline: "none",
  cursor: "pointer",
};

const LABEL_STYLE: React.CSSProperties = {
  fontSize: "11px",
  fontWeight: 600,
  color: "#8E8E93",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  marginBottom: "6px",
  display: "block",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// ─── Signal Bars Icon ─────────────────────────────────────────────────────────

function SignalBars({ quality }: { quality: ConnectionQuality }) {
  const barConfig: Record<ConnectionQuality, { heights: number[]; color: string }> = {
    [ConnectionQuality.Excellent]: { heights: [4, 7, 10], color: "#34D399" },
    [ConnectionQuality.Good]:      { heights: [4, 7, 5],  color: "#FFB454" },
    [ConnectionQuality.Poor]:      { heights: [4, 3, 3],  color: "#FF6B6B" },
    [ConnectionQuality.Lost]:      { heights: [4, 3, 3],  color: "#636366" },
    [ConnectionQuality.Unknown]:   { heights: [4, 3, 3],  color: "#636366" },
  };

  const cfg = barConfig[quality] ?? barConfig[ConnectionQuality.Unknown];

  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ flexShrink: 0 }}>
      {cfg.heights.map((h, i) => (
        <rect
          key={i}
          x={i * 4}
          y={12 - h}
          width="3"
          height={h}
          rx="1"
          fill={i === 0 || quality !== ConnectionQuality.Unknown ? cfg.color : "#2C2C2E"}
          opacity={quality === ConnectionQuality.Unknown ? 0.4 : 1}
        />
      ))}
    </svg>
  );
}

// ─── Connection Quality Dot ───────────────────────────────────────────────────

function QualityDot({ participant }: { participant: Participant }) {
  const { quality } = useConnectionQualityIndicator({ participant });

  const colorMap: Record<ConnectionQuality, string> = {
    [ConnectionQuality.Excellent]: "#34D399",
    [ConnectionQuality.Good]:      "#FFB454",
    [ConnectionQuality.Poor]:      "#FF6B6B",
    [ConnectionQuality.Lost]:      "#FF6B6B",
    [ConnectionQuality.Unknown]:   "#636366",
  };

  const color = colorMap[quality] ?? "#636366";

  return (
    <div
      style={{
        position: "absolute",
        top: 6,
        right: 6,
        display: "flex",
        alignItems: "center",
        gap: 3,
        background: "rgba(0,0,0,0.55)",
        borderRadius: 6,
        padding: "2px 4px",
        zIndex: 2,
      }}
    >
      <SignalBars quality={quality} />
    </div>
  );
}

// ─── Speaking Volume Bars ─────────────────────────────────────────────────────

function SpeakingBars({ speaking }: { speaking: boolean }) {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ flexShrink: 0 }}>
      {[2, 4, 6, 8].map((x, i) => (
        <rect
          key={i}
          x={x - 1}
          y={speaking ? 10 - (i % 2 === 0 ? 8 : 5) : 7}
          width="1.5"
          height={speaking ? (i % 2 === 0 ? 8 : 5) : 3}
          rx="0.75"
          fill={speaking ? "#34D399" : "#636366"}
          style={{ transition: "all 0.15s ease" }}
        />
      ))}
    </svg>
  );
}

// ─── Participant Tile ─────────────────────────────────────────────────────────

interface ParticipantTileProps {
  participant: Participant;
  isPinned?: boolean;
  onPin?: () => void;
  handRaised?: boolean;
  mirrorSelf?: boolean;
  isLocal?: boolean;
}

function ParticipantTile({
  participant,
  isPinned,
  onPin,
  handRaised,
  mirrorSelf,
  isLocal,
}: ParticipantTileProps) {
  const allTracks = useTracks(
    [Track.Source.Camera, Track.Source.ScreenShare],
    { onlySubscribed: true }
  );

  const videoTrack = allTracks.find(
    (t) =>
      t.participant.identity === participant.identity &&
      t.source === Track.Source.Camera
  );
  const screenTrack = allTracks.find(
    (t) =>
      t.participant.identity === participant.identity &&
      t.source === Track.Source.ScreenShare
  );

  const activeTrack = screenTrack || videoTrack;
  const displayName = participant.name || participant.identity || "User";
  const initials = displayName.slice(0, 2).toUpperCase();

  const speaking = useIsSpeaking(participant);

  return (
    <div
      className="relative rounded-xl overflow-hidden flex items-center justify-center"
      style={{
        background: "#2C2C2E",
        aspectRatio: "16/9",
        cursor: onPin ? "pointer" : "default",
        border: speaking
          ? "2px solid #34D399"
          : isPinned
          ? "2px solid #D4007A"
          : "1px solid rgba(255,255,255,0.06)",
        boxShadow: speaking ? "0 0 0 3px rgba(52,211,153,0.2)" : undefined,
        transition: "border-color 0.2s, box-shadow 0.2s",
      }}
      onClick={onPin}
    >
      {activeTrack ? (
        <VideoTrack
          trackRef={activeTrack}
          className="w-full h-full object-cover"
          style={
            isLocal && mirrorSelf && !screenTrack
              ? { transform: "scaleX(-1)" }
              : undefined
          }
        />
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center gap-2">
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center text-xl font-bold text-white"
            style={{ background: "linear-gradient(135deg, #D4007A, #7B2FBE)" }}
          >
            {initials}
          </div>
        </div>
      )}

      {/* Connection quality */}
      <QualityDot participant={participant} />

      {/* Hand raised badge */}
      {handRaised && (
        <div
          style={{
            position: "absolute",
            top: 6,
            left: 6,
            fontSize: "16px",
            filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.8))",
            zIndex: 2,
          }}
        >
          ✋
        </div>
      )}

      {/* Name bar */}
      <div
        className="absolute bottom-0 inset-x-0 px-2 py-1.5 flex items-center gap-1.5"
        style={{ background: "linear-gradient(to top, rgba(0,0,0,0.85), transparent)" }}
      >
        <SpeakingBars speaking={speaking} />
        <span
          className="text-[10px] font-medium truncate flex-1"
          style={{ color: "rgba(255,255,255,0.92)" }}
        >
          {displayName}
          {isLocal && (
            <span style={{ color: "#8E8E93", marginLeft: 3 }}>(you)</span>
          )}
        </span>
      </div>

      {/* Remote audio playback */}
      {!isLocal &&
        (() => {
          const audioEntries = Array.from(participant.audioTrackPublications.values());
          return audioEntries.map((pub) =>
            pub.track ? (
              <AudioTrack
                key={pub.trackSid}
                trackRef={{
                  participant,
                  publication: pub,
                  source: Track.Source.Microphone,
                }}
              />
            ) : null
          );
        })()}
    </div>
  );
}

// ─── Device Settings Panel ────────────────────────────────────────────────────

interface DeviceSettingsPanelProps {
  onClose: () => void;
  videoQuality: VideoQuality;
  onVideoQualityChange: (q: VideoQuality) => void;
  mirrorSelf: boolean;
  onMirrorToggle: () => void;
}

function DeviceSettingsPanel({
  onClose,
  videoQuality,
  onVideoQualityChange,
  mirrorSelf,
  onMirrorToggle,
}: DeviceSettingsPanelProps) {
  const cameraSelect = useMediaDeviceSelect({ kind: "videoinput" });
  const micSelect = useMediaDeviceSelect({ kind: "audioinput" });
  const speakerSelect = useMediaDeviceSelect({ kind: "audiooutput" });

  return (
    <div
      className="absolute bottom-16 left-1/2 z-50 w-80 max-w-[calc(100vw-2rem)] rounded-2xl shadow-2xl"
      style={{
        transform: "translateX(-50%)",
        background: "#1C1C1E",
        border: "1px solid rgba(255,255,255,0.1)",
        padding: "20px",
      }}
    >
      <div className="flex items-center justify-between mb-4">
        <span style={{ color: "#EBEBF5", fontWeight: 600, fontSize: "15px" }}>
          Settings
        </span>
        <button
          onClick={onClose}
          style={{
            background: "rgba(255,255,255,0.08)",
            border: "none",
            borderRadius: "50%",
            width: 28,
            height: 28,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            color: "#8E8E93",
          }}
          aria-label="Close settings"
        >
          <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        {/* Camera */}
        <div>
          <span style={LABEL_STYLE}>Camera</span>
          <select
            style={SELECT_STYLE}
            value={cameraSelect.activeDeviceId}
            onChange={(e) => cameraSelect.setActiveMediaDevice(e.target.value)}
          >
            {cameraSelect.devices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `Camera ${d.deviceId.slice(0, 6)}`}
              </option>
            ))}
          </select>
        </div>

        {/* Video quality */}
        <div>
          <span style={LABEL_STYLE}>Video Quality</span>
          <select
            style={SELECT_STYLE}
            value={videoQuality}
            onChange={(e) => onVideoQualityChange(e.target.value as VideoQuality)}
          >
            {(Object.entries(VIDEO_QUALITY_PRESETS) as [VideoQuality, typeof VIDEO_QUALITY_PRESETS[VideoQuality]][]).map(([key, preset]) => (
              <option key={key} value={key}>
                {preset.label}
              </option>
            ))}
          </select>
        </div>

        {/* Microphone */}
        <div>
          <span style={LABEL_STYLE}>Microphone</span>
          <select
            style={SELECT_STYLE}
            value={micSelect.activeDeviceId}
            onChange={(e) => micSelect.setActiveMediaDevice(e.target.value)}
          >
            {micSelect.devices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `Microphone ${d.deviceId.slice(0, 6)}`}
              </option>
            ))}
          </select>
        </div>

        {/* Speaker */}
        <div>
          <span style={LABEL_STYLE}>Speaker</span>
          <select
            style={SELECT_STYLE}
            value={speakerSelect.activeDeviceId}
            onChange={(e) => speakerSelect.setActiveMediaDevice(e.target.value)}
          >
            {speakerSelect.devices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `Speaker ${d.deviceId.slice(0, 6)}`}
              </option>
            ))}
          </select>
        </div>

        {/* Mirror self-view */}
        <div className="flex items-center justify-between">
          <span style={{ ...LABEL_STYLE, marginBottom: 0 }}>Mirror self-view</span>
          <button
            onClick={onMirrorToggle}
            style={{
              width: 40,
              height: 22,
              borderRadius: 11,
              background: mirrorSelf ? "#D4007A" : "#2C2C2E",
              border: "1px solid rgba(255,255,255,0.1)",
              cursor: "pointer",
              position: "relative",
              transition: "background 0.2s",
              flexShrink: 0,
            }}
            aria-label="Toggle mirror self-view"
          >
            <span
              style={{
                position: "absolute",
                top: 2,
                left: mirrorSelf ? 20 : 2,
                width: 16,
                height: 16,
                borderRadius: "50%",
                background: "white",
                transition: "left 0.2s",
                display: "block",
              }}
            />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Stats Panel ──────────────────────────────────────────────────────────────

interface StatsPanelProps {
  onClose: () => void;
}

function StatsPanel({ onClose }: StatsPanelProps) {
  const { localParticipant } = useLocalParticipant();
  const [stats, setStats] = useState<{
    codec: string;
    width: number;
    height: number;
    frameRate: number;
    label: string;
  } | null>(null);

  useEffect(() => {
    const videoPublication = localParticipant?.videoTrackPublications
      ? Array.from(localParticipant.videoTrackPublications.values())[0]
      : null;

    const track = videoPublication?.track;
    if (!track) {
      setStats(null);
      return;
    }

    const mediaTrack = track.mediaStreamTrack;
    if (!mediaTrack) {
      setStats(null);
      return;
    }

    try {
      const settings = mediaTrack.getSettings();
      setStats({
        codec: "H264",
        width: settings.width ?? 0,
        height: settings.height ?? 0,
        frameRate: Math.round(settings.frameRate ?? 0),
        label: mediaTrack.label,
      });
    } catch {
      setStats(null);
    }
  }, [localParticipant]);

  return (
    <div
      style={{
        position: "absolute",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        background: "#1C1C1E",
        border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: "16px",
        padding: "20px",
        width: 280,
        zIndex: 60,
        boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
      }}
    >
      <div className="flex items-center justify-between mb-4">
        <span style={{ color: "#EBEBF5", fontWeight: 600, fontSize: "14px" }}>
          Connection Stats
        </span>
        <button
          onClick={onClose}
          style={{
            background: "rgba(255,255,255,0.08)",
            border: "none",
            borderRadius: "50%",
            width: 26,
            height: 26,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            color: "#8E8E93",
          }}
          aria-label="Close stats"
        >
          <svg width="10" height="10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {stats ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[
            { label: "Resolution", value: stats.width && stats.height ? `${stats.width}×${stats.height}` : "Unknown" },
            { label: "Frame Rate", value: stats.frameRate ? `${stats.frameRate} fps` : "Unknown" },
            { label: "Codec", value: stats.codec },
            { label: "Device", value: stats.label || "Unknown" },
          ].map(({ label, value }) => (
            <div key={label} className="flex justify-between">
              <span style={{ color: "#8E8E93", fontSize: "12px" }}>{label}</span>
              <span style={{ color: "#EBEBF5", fontSize: "12px", fontWeight: 500 }}>{value}</span>
            </div>
          ))}
        </div>
      ) : (
        <p style={{ color: "#636366", fontSize: "12px", textAlign: "center" }}>
          Camera not active — no stats available.
        </p>
      )}
    </div>
  );
}

// ─── Emoji Reaction Picker ────────────────────────────────────────────────────

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
  onClose: () => void;
}

function EmojiPicker({ onSelect, onClose }: EmojiPickerProps) {
  return (
    <div
      className="absolute bottom-16 z-50 rounded-2xl shadow-2xl"
      style={{
        background: "#1C1C1E",
        border: "1px solid rgba(255,255,255,0.1)",
        padding: "12px",
        left: "50%",
        transform: "translateX(-50%)",
      }}
    >
      <div className="flex gap-2">
        {EMOJI_REACTIONS.map((emoji) => (
          <button
            key={emoji}
            onClick={() => {
              onSelect(emoji);
              onClose();
            }}
            style={{
              fontSize: "22px",
              background: "none",
              border: "none",
              cursor: "pointer",
              borderRadius: "8px",
              width: 40,
              height: 40,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "background 0.1s",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.1)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = "none";
            }}
            aria-label={`React with ${emoji}`}
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Floating Reactions ───────────────────────────────────────────────────────

function FloatingReactions({ reactions }: { reactions: FloatingReaction[] }) {
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 50 }}>
      {reactions.map((r) => (
        <div
          key={r.id}
          style={{
            position: "absolute",
            bottom: "80px",
            left: `${r.x}%`,
            fontSize: "28px",
            animation: "floatUp 2s ease-out forwards",
            userSelect: "none",
          }}
        >
          {r.emoji}
        </div>
      ))}
      <style>{`
        @keyframes floatUp {
          0%   { transform: translateY(0) scale(1);   opacity: 1; }
          60%  { transform: translateY(-80px) scale(1.2); opacity: 0.9; }
          100% { transform: translateY(-140px) scale(0.8); opacity: 0; }
        }
      `}</style>
    </div>
  );
}

// ─── Control Bar ──────────────────────────────────────────────────────────────

interface ControlBarProps {
  onLeave: () => void;
  onSettingsToggle: () => void;
  showSettings: boolean;
  layoutMode: LayoutMode;
  onLayoutCycle: () => void;
  onEmojiToggle: () => void;
  showEmojiPicker: boolean;
  handRaised: boolean;
  onHandRaiseToggle: () => void;
  onStatsToggle: () => void;
  showStats: boolean;
  isDesktop?: boolean;
}

const LAYOUT_ICONS: Record<LayoutMode, React.ReactNode> = {
  grid: (
    <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  spotlight: (
    <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <rect x="3" y="3" width="18" height="13" rx="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="3" y="19" width="5" height="2" rx="1" fill="currentColor" stroke="none" />
      <rect x="10" y="19" width="5" height="2" rx="1" fill="currentColor" stroke="none" />
      <rect x="17" y="19" width="4" height="2" rx="1" fill="currentColor" stroke="none" />
    </svg>
  ),
  gallery: (
    <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <rect x="3" y="3" width="5" height="8" rx="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="10" y="3" width="5" height="8" rx="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="17" y="3" width="4" height="8" rx="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="3" y="13" width="5" height="8" rx="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="10" y="13" width="5" height="8" rx="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="17" y="13" width="4" height="8" rx="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
};

function ControlBar({
  onLeave,
  onSettingsToggle,
  showSettings,
  layoutMode,
  onLayoutCycle,
  onEmojiToggle,
  showEmojiPicker,
  handRaised,
  onHandRaiseToggle,
  onStatsToggle,
  showStats,
  isDesktop,
}: ControlBarProps) {
  return (
    <div
      className="flex items-center justify-center gap-2 px-4 py-3 flex-shrink-0 flex-wrap"
      style={{
        background: isDesktop ? "rgba(0,0,0,0.6)" : "#1C1C1E",
        borderTop: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      {/* Camera toggle */}
      <TrackToggle source={Track.Source.Camera} style={ICON_BTN_STYLE} showIcon={false}>
        <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
        </svg>
      </TrackToggle>

      {/* Microphone toggle */}
      <TrackToggle source={Track.Source.Microphone} style={ICON_BTN_STYLE} showIcon={false}>
        <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
        </svg>
      </TrackToggle>

      {/* Screenshare (desktop only) */}
      <div className="hidden sm:flex">
        <TrackToggle source={Track.Source.ScreenShare} style={ICON_BTN_STYLE} showIcon={false}>
          <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0H3" />
          </svg>
        </TrackToggle>
      </div>

      {/* Layout cycle */}
      <button
        style={{
          ...ICON_BTN_STYLE,
          background: "rgba(255,255,255,0.1)",
          position: "relative",
        }}
        onClick={onLayoutCycle}
        title={`Layout: ${layoutMode}`}
        aria-label="Cycle layout mode"
      >
        {LAYOUT_ICONS[layoutMode]}
        <span
          style={{
            position: "absolute",
            bottom: -2,
            right: -2,
            fontSize: "8px",
            background: "#7B2FBE",
            color: "white",
            borderRadius: "3px",
            padding: "0 2px",
            lineHeight: "12px",
          }}
        >
          {layoutMode.slice(0, 3).toUpperCase()}
        </span>
      </button>

      {/* Hand raise */}
      <button
        style={{
          ...ICON_BTN_STYLE,
          background: handRaised ? "rgba(255,180,84,0.25)" : "rgba(255,255,255,0.1)",
          border: handRaised ? "1px solid #FFB454" : "none",
          fontSize: "16px",
        }}
        onClick={onHandRaiseToggle}
        aria-label={handRaised ? "Lower hand" : "Raise hand"}
        title={handRaised ? "Lower hand" : "Raise hand"}
      >
        ✋
      </button>

      {/* Emoji reactions */}
      <button
        style={{
          ...ICON_BTN_STYLE,
          background: showEmojiPicker ? "rgba(212,0,122,0.25)" : "rgba(255,255,255,0.1)",
          border: showEmojiPicker ? "1px solid #D4007A" : "none",
          fontSize: "16px",
        }}
        onClick={onEmojiToggle}
        aria-label="Send emoji reaction"
        title="Emoji reactions"
      >
        😊
      </button>

      {/* Connection stats */}
      <button
        style={{
          ...ICON_BTN_STYLE,
          background: showStats ? "rgba(123,47,190,0.3)" : "rgba(255,255,255,0.1)",
          border: showStats ? "1px solid #7B2FBE" : "none",
        }}
        onClick={onStatsToggle}
        aria-label="Connection stats"
        title="Connection stats"
      >
        <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
        </svg>
      </button>

      {/* Device settings */}
      <button
        style={{
          ...ICON_BTN_STYLE,
          background: showSettings ? "rgba(212,0,122,0.3)" : "rgba(255,255,255,0.1)",
          border: showSettings ? "1px solid #D4007A" : "none",
        }}
        onClick={onSettingsToggle}
        aria-label="Toggle device settings"
        title="Settings"
      >
        <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      </button>

      {/* Leave button */}
      <button
        style={{
          ...ICON_BTN_STYLE,
          width: 56,
          borderRadius: "22px",
          background: "#D4007A",
        }}
        onClick={onLeave}
        aria-label="Leave call"
      >
        <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 3.75v4.5m0-4.5h-4.5m4.5 0l-6 6m3 12c-8.284 0-15-6.716-15-15V4.5A2.25 2.25 0 016.75 2.25h1.372c.516 0 .966.351 1.091.852l1.106 4.423c.11.44-.054.902-.417 1.173l-1.293.97a1.062 1.062 0 00-.38 1.21 12.035 12.035 0 007.143 7.143c.441.162.928-.004 1.21-.38l.97-1.293a1.125 1.125 0 011.173-.417l4.423 1.106c.5.125.852.575.852 1.091V19.5a2.25 2.25 0 01-2.25 2.25h-2.25z" />
        </svg>
      </button>
    </div>
  );
}

// ─── Top Bar ──────────────────────────────────────────────────────────────────

interface TopBarProps {
  duration: number;
  participantCount: number;
  roomName?: string;
}

function TopBar({ duration, participantCount, roomName }: TopBarProps) {
  return (
    <div
      className="flex items-center justify-between px-4 py-2 flex-shrink-0"
      style={{
        background: "rgba(0,0,0,0.5)",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        minHeight: 40,
      }}
    >
      <span
        className="text-xs font-medium truncate"
        style={{ color: "#8E8E93", maxWidth: "40%" }}
      >
        {roomName || "Video Call"}
      </span>

      <div className="flex items-center gap-3">
        {/* Participant count */}
        <div
          className="flex items-center gap-1 px-2 py-0.5 rounded-full"
          style={{ background: "rgba(255,255,255,0.08)" }}
        >
          <svg width="11" height="11" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} style={{ color: "#8E8E93" }}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
          </svg>
          <span style={{ color: "#EBEBF5", fontSize: "11px", fontWeight: 600 }}>
            {participantCount}
          </span>
        </div>

        {/* Duration */}
        <div
          className="flex items-center gap-1 px-2 py-0.5 rounded-full"
          style={{ background: "rgba(212,0,122,0.15)" }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "#D4007A",
              display: "inline-block",
              flexShrink: 0,
            }}
          />
          <span style={{ color: "#D4007A", fontSize: "11px", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
            {formatDuration(duration)}
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Inner Room ───────────────────────────────────────────────────────────────

interface InnerRoomProps {
  onCallEnd: () => void;
  onParticipantJoined?: (count: number) => void;
  onParticipantLeft?: (count: number) => void;
  onRoomConnected?: (room: unknown) => void;
  fullScreen?: boolean;
  roomName?: string;
}

function InnerRoom({
  onCallEnd,
  onParticipantJoined,
  onParticipantLeft,
  onRoomConnected,
  fullScreen,
  roomName,
}: InnerRoomProps) {
  const room = useRoomContext();
  const { localParticipant } = useLocalParticipant();
  const remoteParticipants = useRemoteParticipants();
  const allParticipants = useParticipants();

  // ── State ──
  const [layoutMode, setLayoutMode] = useState<LayoutMode>("grid");
  const [showSettings, setShowSettings] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [videoQuality, setVideoQuality] = useState<VideoQuality>("medium");
  const [mirrorSelf, setMirrorSelf] = useState(true);
  const [handRaised, setHandRaised] = useState(false);
  const [raisedHands, setRaisedHands] = useState<Set<string>>(new Set());
  const [floatingReactions, setFloatingReactions] = useState<FloatingReaction[]>([]);
  const [duration, setDuration] = useState(0);

  const prevCountRef = useRef(0);
  const reactionCounterRef = useRef(0);
  const encoder = useMemo(() => new TextEncoder(), []);
  const decoder = useMemo(() => new TextDecoder(), []);

  // ── Timer ──
  useEffect(() => {
    const interval = setInterval(() => setDuration((d) => d + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  // ── Room connected callback ──
  useEffect(() => {
    if (room && onRoomConnected) {
      onRoomConnected(room);
    }
  }, [room, onRoomConnected]);

  // ── Participant count callbacks ──
  useEffect(() => {
    const count = allParticipants.length;
    if (count > prevCountRef.current && onParticipantJoined) {
      onParticipantJoined(count);
    } else if (count < prevCountRef.current && onParticipantLeft) {
      onParticipantLeft(count);
    }
    prevCountRef.current = count;
  }, [allParticipants.length, onParticipantJoined, onParticipantLeft]);

  // ── Data channel: receive reactions + hand raises ──
  useDataChannel((msg) => {
    try {
      const text = decoder.decode(msg.payload);
      const parsed: DataMessage = JSON.parse(text);

      if (parsed.type === "reaction" && parsed.emoji) {
        const id = ++reactionCounterRef.current;
        const x = 10 + Math.random() * 80;
        setFloatingReactions((prev) => [...prev, { id, emoji: parsed.emoji!, x }]);
        setTimeout(() => {
          setFloatingReactions((prev) => prev.filter((r) => r.id !== id));
        }, 2100);
      }

      if (parsed.type === "hand_raise" && parsed.identity) {
        setRaisedHands((prev) => {
          const next = new Set(prev);
          if (parsed.raised) {
            next.add(parsed.identity!);
          } else {
            next.delete(parsed.identity!);
          }
          return next;
        });
      }
    } catch {
      // malformed data — ignore
    }
  });

  // ── Get the send function from useDataChannel without a topic ──
  const { send: sendData } = useDataChannel();

  // ── Send emoji reaction ──
  const handleSendReaction = useCallback(
    async (emoji: string) => {
      const msg: DataMessage = { type: "reaction", emoji };
      try {
        await sendData(encoder.encode(JSON.stringify(msg)), { reliable: true });
        // Also show locally
        const id = ++reactionCounterRef.current;
        const x = 10 + Math.random() * 80;
        setFloatingReactions((prev) => [...prev, { id, emoji, x }]);
        setTimeout(() => {
          setFloatingReactions((prev) => prev.filter((r) => r.id !== id));
        }, 2100);
      } catch {
        // data channel unavailable — ignore
      }
    },
    [sendData, encoder]
  );

  // ── Toggle hand raise ──
  const handleHandRaiseToggle = useCallback(async () => {
    const nextRaised = !handRaised;
    setHandRaised(nextRaised);
    const msg: DataMessage = {
      type: "hand_raise",
      raised: nextRaised,
      identity: localParticipant?.identity,
    };
    try {
      await sendData(encoder.encode(JSON.stringify(msg)), { reliable: true });
    } catch {
      // data channel unavailable — ignore
    }
    // Update local raised hands set
    setRaisedHands((prev) => {
      const next = new Set(prev);
      if (nextRaised && localParticipant?.identity) {
        next.add(localParticipant.identity);
      } else if (localParticipant?.identity) {
        next.delete(localParticipant.identity);
      }
      return next;
    });
  }, [handRaised, localParticipant, sendData, encoder]);

  // ── Video quality change ──
  const handleVideoQualityChange = useCallback(
    async (quality: VideoQuality) => {
      setVideoQuality(quality);
      if (!localParticipant) return;
      const preset = VIDEO_QUALITY_PRESETS[quality];
      try {
        await (localParticipant as LKLocalParticipant).setCameraEnabled(true, {
          resolution: {
            width: preset.width,
            height: preset.height,
            frameRate: preset.frameRate,
          },
        });
      } catch {
        // camera may not be active — silent fail
      }
    },
    [localParticipant]
  );

  // ── Leave ──
  const handleLeave = useCallback(() => {
    room.disconnect();
    onCallEnd();
  }, [room, onCallEnd]);

  // ── Layout cycle ──
  const handleLayoutCycle = useCallback(() => {
    setLayoutMode((prev) => {
      const order: LayoutMode[] = ["grid", "spotlight", "gallery"];
      const idx = order.indexOf(prev);
      return order[(idx + 1) % order.length];
    });
  }, []);

  // ── Participants list ──
  const participants: Participant[] = useMemo(() => {
    const list: Participant[] = [];
    if (localParticipant) list.push(localParticipant as Participant);
    list.push(...remoteParticipants);
    return list;
  }, [localParticipant, remoteParticipants]);

  // ── Active speaker for spotlight ──
  const activeSpeaker = useMemo(() => {
    if (layoutMode !== "spotlight") return null;
    const speaking = participants.find((p) => p.isSpeaking);
    return speaking ?? participants[0] ?? null;
  }, [layoutMode, participants]);

  // ── Render participant tiles ──
  function renderTile(p: Participant, isPinned = false) {
    return (
      <ParticipantTile
        key={p.identity}
        participant={p}
        isPinned={isPinned}
        handRaised={raisedHands.has(p.identity)}
        mirrorSelf={mirrorSelf}
        isLocal={p.identity === localParticipant?.identity}
      />
    );
  }

  function renderGrid() {
    if (participants.length === 0) {
      return (
        <div
          className="col-span-full flex items-center justify-center py-12"
          style={{ color: "#636366", fontSize: "14px" }}
        >
          Connecting to room...
        </div>
      );
    }
    return participants.map((p) => renderTile(p));
  }

  function renderSpotlight() {
    if (!activeSpeaker) return renderGrid();
    const rest = participants.filter((p) => p.identity !== activeSpeaker.identity);
    return (
      <>
        {/* Large main tile */}
        <div className="col-span-full" style={{ aspectRatio: "16/9" }}>
          {renderTile(activeSpeaker, true)}
        </div>
        {/* Strip of thumbnails */}
        {rest.length > 0 && (
          <div
            className="col-span-full flex gap-2 overflow-x-auto"
            style={{ paddingBottom: 2 }}
          >
            {rest.map((p) => (
              <div key={p.identity} style={{ width: 120, flexShrink: 0 }}>
                {renderTile(p)}
              </div>
            ))}
          </div>
        )}
      </>
    );
  }

  function renderGallery() {
    if (participants.length === 0) return renderGrid();
    return participants.map((p) => renderTile(p));
  }

  const gridCols: Record<LayoutMode, string> = {
    grid:      participants.length === 1 ? "1fr" : "repeat(auto-fill, minmax(180px, 1fr))",
    spotlight: "1fr",
    gallery:   "repeat(auto-fill, minmax(220px, 1fr))",
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: fullScreen ? "100%" : "auto",
        minHeight: fullScreen ? "0" : "320px",
        background: "#111113",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Top bar */}
      <TopBar
        duration={duration}
        participantCount={allParticipants.length}
        roomName={roomName}
      />

      {/* Video area */}
      <div
        className="flex-1 overflow-auto p-2 grid gap-2"
        style={{ gridTemplateColumns: gridCols[layoutMode] }}
      >
        {layoutMode === "grid" && renderGrid()}
        {layoutMode === "spotlight" && renderSpotlight()}
        {layoutMode === "gallery" && renderGallery()}
      </div>

      {/* Floating reactions */}
      <FloatingReactions reactions={floatingReactions} />

      {/* Stats overlay */}
      {showStats && <StatsPanel onClose={() => setShowStats(false)} />}

      {/* Emoji picker (above controls) */}
      {showEmojiPicker && (
        <div className="relative">
          <EmojiPicker
            onSelect={handleSendReaction}
            onClose={() => setShowEmojiPicker(false)}
          />
        </div>
      )}

      {/* Device settings (above controls) */}
      {showSettings && (
        <div className="relative">
          <DeviceSettingsPanel
            onClose={() => setShowSettings(false)}
            videoQuality={videoQuality}
            onVideoQualityChange={handleVideoQualityChange}
            mirrorSelf={mirrorSelf}
            onMirrorToggle={() => setMirrorSelf((m) => !m)}
          />
        </div>
      )}

      {/* Control bar */}
      <ControlBar
        onLeave={handleLeave}
        onSettingsToggle={() => {
          setShowSettings((s) => !s);
          setShowEmojiPicker(false);
        }}
        showSettings={showSettings}
        layoutMode={layoutMode}
        onLayoutCycle={handleLayoutCycle}
        onEmojiToggle={() => {
          setShowEmojiPicker((s) => !s);
          setShowSettings(false);
        }}
        showEmojiPicker={showEmojiPicker}
        handRaised={handRaised}
        onHandRaiseToggle={handleHandRaiseToggle}
        onStatsToggle={() => {
          setShowStats((s) => !s);
          setShowSettings(false);
          setShowEmojiPicker(false);
        }}
        showStats={showStats}
        isDesktop={fullScreen}
      />
    </div>
  );
}

// ─── Exported Component ───────────────────────────────────────────────────────

export function LiveKitMeetComponent({
  token,
  wsUrl,
  roomName,
  onCallEnd,
  onParticipantJoined,
  onParticipantLeft,
  isAdmin = false,
  isModerator = false,
  fullScreen = false,
  disableChat = false,
  onRoomConnected,
}: LiveKitMeetProps) {
  // Suppress unused-prop warnings — these are part of the public interface
  void isAdmin;
  void isModerator;
  void disableChat;

  const [connectError, setConnectError] = useState<string | null>(null);

  if (!token || !wsUrl) {
    return (
      <div
        className="flex items-center justify-center p-8 text-sm"
        style={{ color: "#636366", background: "#111113", minHeight: "200px" }}
      >
        Video call credentials are missing. Please try rejoining.
      </div>
    );
  }

  if (connectError) {
    return (
      <div
        className="flex flex-col items-center justify-center gap-4 p-8"
        style={{ color: "#FF6B6B", background: "#111113", minHeight: "200px" }}
      >
        <svg width="32" height="32" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} style={{ color: "#FF6B6B", flexShrink: 0 }}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
        </svg>
        <span className="text-sm text-center">{connectError}</span>
        <button
          onClick={onCallEnd}
          style={{
            padding: "8px 20px",
            borderRadius: "8px",
            background: "#D4007A",
            color: "white",
            border: "none",
            cursor: "pointer",
            fontSize: "13px",
            fontWeight: 600,
          }}
        >
          Close
        </button>
      </div>
    );
  }

  return (
    <LiveKitRoom
      token={token}
      serverUrl={wsUrl}
      video={true}
      audio={true}
      connect={true}
      onDisconnected={() => onCallEnd()}
      onError={(err: Error) => {
        console.error("LiveKit connection error", err);
        setConnectError(
          err?.message || "Failed to connect to video room. Please try again."
        );
      }}
      style={{ height: fullScreen ? "100%" : "auto" }}
    >
      <InnerRoom
        onCallEnd={onCallEnd}
        onParticipantJoined={onParticipantJoined}
        onParticipantLeft={onParticipantLeft}
        onRoomConnected={onRoomConnected}
        fullScreen={fullScreen}
        roomName={roomName}
      />
    </LiveKitRoom>
  );
}
