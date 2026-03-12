import React, { useState, useCallback, useEffect, useRef } from "react";
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
  useTrackVolume,
} from "@livekit/components-react";
import { Track, Participant, LocalParticipant } from "livekit-client";

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
  onRoomConnected?: (room: any) => void;
}

// ─── Device Settings Panel ───────────────────────────────────────────────────

function DeviceSettingsPanel({ onClose }: { onClose: () => void }) {
  const cameraSelect = useMediaDeviceSelect({ kind: "videoinput" });
  const micSelect = useMediaDeviceSelect({ kind: "audioinput" });
  const speakerSelect = useMediaDeviceSelect({ kind: "audiooutput" });

  const selectStyle: React.CSSProperties = {
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

  const labelStyle: React.CSSProperties = {
    fontSize: "11px",
    fontWeight: 600,
    color: "#8E8E93",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    marginBottom: "6px",
    display: "block",
  };

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
          Device Settings
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
          <span style={labelStyle}>Camera</span>
          <select
            style={selectStyle}
            value={cameraSelect.activeDeviceId}
            onChange={(e) => cameraSelect.setActiveMediaDevice(e.target.value)}
          >
            {cameraSelect.devices.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `Camera ${device.deviceId.slice(0, 6)}`}
              </option>
            ))}
          </select>
        </div>

        {/* Microphone */}
        <div>
          <span style={labelStyle}>Microphone</span>
          <select
            style={selectStyle}
            value={micSelect.activeDeviceId}
            onChange={(e) => micSelect.setActiveMediaDevice(e.target.value)}
          >
            {micSelect.devices.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `Microphone ${device.deviceId.slice(0, 6)}`}
              </option>
            ))}
          </select>
        </div>

        {/* Speaker */}
        <div>
          <span style={labelStyle}>Speaker</span>
          <select
            style={selectStyle}
            value={speakerSelect.activeDeviceId}
            onChange={(e) => speakerSelect.setActiveMediaDevice(e.target.value)}
          >
            {speakerSelect.devices.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `Speaker ${device.deviceId.slice(0, 6)}`}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}

// ─── Participant Tile ────────────────────────────────────────────────────────

interface ParticipantTileProps {
  participant: Participant;
  isPinned?: boolean;
  onPin?: () => void;
}

function ParticipantTile({ participant, isPinned, onPin }: ParticipantTileProps) {
  const videoTracks = useTracks([Track.Source.Camera], {
    onlySubscribed: true,
  });
  const screenTracks = useTracks([Track.Source.ScreenShare], {
    onlySubscribed: true,
  });

  const videoTrack = videoTracks.find(
    (t) => t.participant.identity === participant.identity
  );
  const screenTrack = screenTracks.find(
    (t) => t.participant.identity === participant.identity
  );

  const activeTrack = screenTrack || videoTrack;
  const isCameraOn = !!videoTrack;
  const displayName = participant.name || participant.identity || "User";
  const initials = displayName.slice(0, 2).toUpperCase();

  return (
    <div
      className={`relative rounded-xl overflow-hidden flex items-center justify-center ${isPinned ? "col-span-2 row-span-2" : ""}`}
      style={{
        background: "#2C2C2E",
        aspectRatio: "16/9",
        minHeight: isPinned ? "240px" : "120px",
        cursor: onPin ? "pointer" : "default",
        border: isPinned ? "2px solid #D4007A" : "1px solid rgba(255,255,255,0.06)",
      }}
      onClick={onPin}
    >
      {activeTrack ? (
        <VideoTrack trackRef={activeTrack} className="w-full h-full object-cover" />
      ) : (
        <div
          className="w-full h-full flex flex-col items-center justify-center gap-2"
          style={{ background: "#2C2C2E" }}
        >
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold text-white"
            style={{ background: "linear-gradient(135deg, #D4007A, #7B2FBE)" }}
          >
            {initials}
          </div>
        </div>
      )}

      {/* Name bar */}
      <div
        className="absolute bottom-0 inset-x-0 px-2 py-1 flex items-center gap-1.5"
        style={{
          background: "linear-gradient(to top, rgba(0,0,0,0.8), transparent)",
        }}
      >
        {!isCameraOn && (
          <svg className="w-3 h-3 flex-shrink-0" style={{ color: "#FF6B6B" }} fill="currentColor" viewBox="0 0 20 20">
            <path d="M2 6.75C2 5.784 2.784 5 3.75 5h6.5C11.216 5 12 5.784 12 6.75v6.5A1.75 1.75 0 0110.25 15h-6.5A1.75 1.75 0 012 13.25v-6.5zM13.5 7.411l3.302-2.205A.75.75 0 0118 5.842v8.316a.75.75 0 01-1.198.601L13.5 12.554V7.411z" />
          </svg>
        )}
        <span
          className="text-[10px] font-medium truncate"
          style={{ color: "rgba(255,255,255,0.9)" }}
        >
          {displayName}
        </span>
      </div>

      {/* Audio track (invisible — just for playback) */}
      {(() => {
        const audioTracks = participant.audioTrackPublications;
        const audioEntries = Array.from(audioTracks.values());
        return audioEntries.map((pub) =>
          pub.track ? (
            <AudioTrack
              key={pub.trackSid}
              trackRef={{ participant, publication: pub, source: Track.Source.Microphone }}
            />
          ) : null
        );
      })()}
    </div>
  );
}

// ─── Control Bar ─────────────────────────────────────────────────────────────

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
};

interface ControlBarProps {
  onLeave: () => void;
  onSettingsToggle: () => void;
  showSettings: boolean;
  isDesktop?: boolean;
}

function ControlBar({ onLeave, onSettingsToggle, showSettings, isDesktop }: ControlBarProps) {
  return (
    <div
      className="flex items-center justify-center gap-3 px-4 py-3 flex-shrink-0"
      style={{
        background: isDesktop ? "rgba(0,0,0,0.6)" : "#1C1C1E",
        borderTop: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      {/* Camera toggle */}
      <TrackToggle
        source={Track.Source.Camera}
        style={ICON_BTN_STYLE}
        showIcon={false}
      >
        <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
        </svg>
      </TrackToggle>

      {/* Microphone toggle */}
      <TrackToggle
        source={Track.Source.Microphone}
        style={ICON_BTN_STYLE}
        showIcon={false}
      >
        <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
        </svg>
      </TrackToggle>

      {/* Screenshare (desktop only) */}
      <div className="hidden sm:flex">
        <TrackToggle
          source={Track.Source.ScreenShare}
          style={ICON_BTN_STYLE}
          showIcon={false}
        >
          <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0H3" />
          </svg>
        </TrackToggle>
      </div>

      {/* Settings */}
      <button
        style={{
          ...ICON_BTN_STYLE,
          background: showSettings ? "rgba(212,0,122,0.3)" : "rgba(255,255,255,0.1)",
          border: showSettings ? "1px solid #D4007A" : "none",
        }}
        onClick={onSettingsToggle}
        aria-label="Toggle device settings"
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
          gap: 6,
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

// ─── Inner Room — rendered inside <LiveKitRoom> context ──────────────────────

interface InnerRoomProps {
  onCallEnd: () => void;
  onParticipantJoined?: (count: number) => void;
  onParticipantLeft?: (count: number) => void;
  onRoomConnected?: (room: any) => void;
  fullScreen?: boolean;
}

function InnerRoom({
  onCallEnd,
  onParticipantJoined,
  onParticipantLeft,
  onRoomConnected,
  fullScreen,
}: InnerRoomProps) {
  const room = useRoomContext();
  const { localParticipant } = useLocalParticipant();
  const remoteParticipants = useRemoteParticipants();
  const allParticipants = useParticipants();

  const [pinnedIdentity, setPinnedIdentity] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const prevCountRef = useRef(0);

  // Notify parent of room connection
  useEffect(() => {
    if (room && onRoomConnected) {
      onRoomConnected(room);
    }
  }, [room, onRoomConnected]);

  // Notify parent of participant count changes
  useEffect(() => {
    const count = allParticipants.length;
    if (count > prevCountRef.current && onParticipantJoined) {
      onParticipantJoined(count);
    } else if (count < prevCountRef.current && onParticipantLeft) {
      onParticipantLeft(count);
    }
    prevCountRef.current = count;
  }, [allParticipants.length, onParticipantJoined, onParticipantLeft]);

  const handleLeave = useCallback(() => {
    room.disconnect();
    onCallEnd();
  }, [room, onCallEnd]);

  const handlePin = useCallback((identity: string) => {
    setPinnedIdentity((prev) => (prev === identity ? null : identity));
  }, []);

  // Build grid of participants: pinned first, then rest
  const participants: Participant[] = [
    localParticipant,
    ...remoteParticipants,
  ].filter(Boolean) as Participant[];

  const pinnedParticipant = pinnedIdentity
    ? participants.find((p) => p.identity === pinnedIdentity)
    : null;
  const unpinned = pinnedParticipant
    ? participants.filter((p) => p.identity !== pinnedIdentity)
    : participants;

  // Grid: 1 col mobile, 2 col sm, 3 col lg (up to 9 visible tiles)
  const visibleUnpinned = unpinned.slice(0, pinnedParticipant ? 8 : 9);

  const containerStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    width: "100%",
    height: fullScreen ? "100%" : "auto",
    minHeight: fullScreen ? "0" : "320px",
    background: "#111113",
  };

  return (
    <div style={containerStyle}>
      {/* Video grid */}
      <div
        className="flex-1 overflow-hidden p-2 grid gap-2"
        style={{
          gridTemplateColumns: participants.length === 1
            ? "1fr"
            : "repeat(auto-fill, minmax(180px, 1fr))",
        }}
      >
        {pinnedParticipant && (
          <ParticipantTile
            participant={pinnedParticipant}
            isPinned
            onPin={() => handlePin(pinnedParticipant.identity)}
          />
        )}
        {visibleUnpinned.map((p) => (
          <ParticipantTile
            key={p.identity}
            participant={p}
            onPin={() => handlePin(p.identity)}
          />
        ))}
        {participants.length === 0 && (
          <div
            className="col-span-full flex items-center justify-center py-12"
            style={{ color: "#636366", fontSize: "14px" }}
          >
            Connecting to room...
          </div>
        )}
      </div>

      {/* Settings panel (above controls) */}
      {showSettings && (
        <div className="relative">
          <DeviceSettingsPanel onClose={() => setShowSettings(false)} />
        </div>
      )}

      {/* Control bar */}
      <ControlBar
        onLeave={handleLeave}
        onSettingsToggle={() => setShowSettings((s) => !s)}
        showSettings={showSettings}
        isDesktop={fullScreen}
      />
    </div>
  );
}

// ─── Component (exported) ────────────────────────────────────────────────────

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
      onError={(err) => {
        console.error("LiveKit connection error", err);
        setConnectError(err?.message || "Failed to connect to video room. Please try again.");
      }}
      style={{ height: fullScreen ? "100%" : "auto" }}
    >
      <InnerRoom
        onCallEnd={onCallEnd}
        onParticipantJoined={onParticipantJoined}
        onParticipantLeft={onParticipantLeft}
        onRoomConnected={onRoomConnected}
        fullScreen={fullScreen}
      />
    </LiveKitRoom>
  );
}
