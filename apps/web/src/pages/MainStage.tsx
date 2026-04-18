import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Helmet } from "react-helmet-async";
import { Card, Button } from "@pnptv/ui-kit";
import { useAuth } from "@/hooks/useAuth";
import { useTier } from "@/hooks/useTier";
import { useMusicPlayer } from "@/hooks/useMusicPlayer";
import { getSocket } from "@/lib/socket";
import {
  LiveKitRoom,
  useRoomContext,
  useTracks,
  useParticipants,
  useLocalParticipant,
  VideoTrack,
  RoomAudioRenderer,
  useConnectionQualityIndicator,
} from "@livekit/components-react";
import type { TrackReferenceOrPlaceholder } from "@livekit/components-core";
import {
  Track,
  RoomEvent,
  Participant,
  ConnectionQuality,
  VideoPresets,
} from "livekit-client";
import {
  getFeaturedPrimeVideos,
  getAssetUrl,
  type PrimeVideo,
} from "@/lib/directus";

import {
  getCommunityRoomOccupancy,
  getStageState,
  knockToSpeak,
  approveKnock,
  denyKnock,
  getHangoutGroups,
  startHangoutCall,
  joinHangoutCall,
  getRadioNowPlaying,
  type StageState,
  type HangoutGroup,
  type NowPlaying,
} from "@/lib/api";
import { UpcomingEvents } from "@/components/events";

// ─── Types ───────────────────────────────────────────────────────────────────

type StageLayout = "video" | "spotlight" | "grid";

type FloatReaction = { id: string; emoji: string; x: number };

type KnockEntry = { userId: string; displayName: string };

// ─── Floating DM Component ──────────────────────────────────────────────────

interface FloatingDmProps {
  userId: string | number;
  displayName: string;
  onClose: () => void;
}

function FloatingDm({ userId, displayName, onClose }: FloatingDmProps) {
  return (
    <div className="fixed bottom-20 right-4 z-[200] w-80 h-96 bg-[#1C1C1E] border border-white/10 rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-bottom-4 duration-300">
      <div className="px-4 py-3 bg-white/5 border-b border-white/10 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-green-500 rounded-full" />
          <span className="text-sm font-bold text-white truncate max-w-[180px]">{displayName}</span>
        </div>
        <button onClick={onClose} className="p-1 hover:bg-white/10 rounded-full transition-colors">
          <svg className="w-4 h-4 text-white/50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <iframe
        src={`/dm/${userId}?embedded=true`}
        className="flex-1 w-full border-0"
        title={`Chat with ${displayName}`}
      />
    </div>
  );
}

// ─── Participant Tile ──────────────────────────────────────────────────────

interface ParticipantTileProps {
  trackRef: TrackReferenceOrPlaceholder;
  isActive: boolean;
  isFocused: boolean;
  isSpeaking: boolean;
  onSelect: () => void;
  onPin: () => void;
}

function ParticipantTile({ trackRef, isActive, isFocused, isSpeaking, onSelect, onPin }: ParticipantTileProps) {
  const { quality } = useConnectionQualityIndicator({ participant: trackRef.participant });
  const micPub = trackRef.participant.getTrackPublication?.(Track.Source.Microphone);
  const micMuted = !micPub || micPub.isMuted;

  const qualityColor =
    quality === ConnectionQuality.Excellent ? "bg-green-400" :
    quality === ConnectionQuality.Good ? "bg-green-400/70" :
    quality === ConnectionQuality.Poor ? "bg-amber-400" :
    "bg-red-400";

  const ring =
    isFocused ? "ring-4 ring-[#FFB454] shadow-lg shadow-[#FFB454]/20" :
    isSpeaking ? "ring-2 ring-green-400 shadow-lg shadow-green-400/30" :
    isActive ? "ring-2 ring-[#FFB454]/60" :
    "ring-1 ring-white/10";

  return (
    <div
      onClick={(e) => { e.stopPropagation(); onSelect(); }}
      className={`relative w-full h-full rounded-xl overflow-hidden bg-[#1C1C1E] cursor-pointer transition-all group ${ring}`}
    >
      <VideoTrack trackRef={trackRef} className="w-full h-full object-cover" />

      {/* Quality dot */}
      <div className="absolute top-1.5 left-1.5 flex items-center gap-1 pointer-events-none">
        <span className={`w-1.5 h-1.5 rounded-full ${qualityColor} ${quality === ConnectionQuality.Poor ? "animate-pulse" : ""}`} />
      </div>

      {/* Pin / focus indicator */}
      <button
        onClick={(e) => { e.stopPropagation(); onPin(); }}
        className={`absolute top-1.5 right-1.5 w-7 h-7 rounded-full bg-black/60 backdrop-blur-sm flex items-center justify-center text-white/80 hover:text-white transition-opacity ${isFocused ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
        title={isFocused ? "Unpin" : "Pin to spotlight"}
      >
        <svg className="w-3.5 h-3.5" fill={isFocused ? "currentColor" : "none"} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 5v11l7-3 7 3V5a2 2 0 00-2-2H7a2 2 0 00-2 2z" />
        </svg>
      </button>

      {/* Name + mute badge */}
      <div className="absolute bottom-1.5 left-1.5 flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-black/60 backdrop-blur-sm pointer-events-none">
        {micMuted && (
          <svg className="w-2.5 h-2.5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" d="M19 11a7 7 0 01-11.95 4.95M4.929 4.929l14.142 14.142" />
            <rect x="9" y="3" width="6" height="11" rx="3" />
          </svg>
        )}
        <span className="text-white text-[9px] font-medium truncate max-w-[72px]">
          {trackRef.participant.isLocal ? "You" : (trackRef.participant.name || trackRef.participant.identity)}
        </span>
      </div>
    </div>
  );
}

// ─── Inline LiveKit Stage Room ──────────────────────────────────────────────

interface StageRoomProps {
  onLeave: () => void;
  stageMode: string;
  isAdmin: boolean;
  isPrime: boolean;
  isMember: boolean;
  inCall: boolean;
  onGoOnStage: () => void;
  layout: StageLayout;
  onLayoutChange: (l: StageLayout) => void;
  primeVideos: PrimeVideo[];
  nowPlaying: NowPlaying | null;
  wellnessTip: string;
  onOpenDm: (userId: string, name: string) => void;
}

function StageRoom({
  onLeave,
  stageMode,
  isAdmin,
  isPrime,
  isMember,
  inCall,
  onGoOnStage,
  layout,
  onLayoutChange,
  primeVideos,
  nowPlaying,
  wellnessTip,
  onOpenDm,
}: StageRoomProps) {
  const room = useRoomContext();
  const { localParticipant } = useLocalParticipant();
  const { setDucking } = useMusicPlayer();
  const tracks = useTracks([Track.Source.Camera], { onlySubscribed: false });
  const userVideoTracks = useMemo(
    () => tracks.filter((t) => t.participant.identity !== "cristina-ai"),
    [tracks]
  );

  const [connected, setConnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [ownQuality, setOwnQuality] = useState<ConnectionQuality>(ConnectionQuality.Unknown);
  const [activeSpeakerIds, setActiveSpeakerIds] = useState<Set<string>>(new Set());
  const [focusedParticipantId, setFocusedParticipantId] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [showSelfView, setShowSelfView] = useState(true);
  const [showAttendants, setShowAttendants] = useState(false);
  const [videoIdx, setVideoIdx] = useState(0);

  // Mic / Cam / Device state — stage rules: cam on by default, mic off, admins can override
  const [cameraOn, setCameraOn] = useState(true);
  const [micOn, setMicOn] = useState(false);
  const canToggleMic = isAdmin || isPrime;
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [activeCamId, setActiveCamId] = useState<string>("");
  const [showDevices, setShowDevices] = useState(false);

  // Reactions + Raise-hand
  const [reactions, setReactions] = useState<FloatReaction[]>([]);
  const [showReactionPicker, setShowReactionPicker] = useState(false);
  const [raiseHand, setRaiseHand] = useState(false);
  const [knockToast, setKnockToast] = useState<string | null>(null);
  const [knockQueue, setKnockQueue] = useState<KnockEntry[]>([]);
  const [showKnockTray, setShowKnockTray] = useState(false);

  const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  const participants = useParticipants();
  const totalInRoom = participants.length;

  // Connection + speaker + quality events
  useEffect(() => {
    if (!room) return;
    const onConnected = () => {
      setConnected(true);
      setReconnecting(false);
      document.body.classList.add("allow-landscape");
      try { (screen.orientation as any)?.unlock?.(); } catch {}
    };
    const onDisconnected = () => {
      setConnected(false);
      document.body.classList.remove("allow-landscape");
      try { (screen.orientation as any)?.lock?.("portrait").catch(() => {}); } catch {}
    };
    const onReconnecting = () => setReconnecting(true);
    const onReconnected = () => setReconnecting(false);
    const onActiveSpeakers = (speakers: Participant[]) => {
      setActiveSpeakerIds(new Set(speakers.map((s) => s.identity)));
    };
    const onQuality = (q: ConnectionQuality, p: Participant) => {
      if (p.isLocal) setOwnQuality(q);
    };

    room.on(RoomEvent.Connected, onConnected);
    room.on(RoomEvent.Disconnected, onDisconnected);
    room.on(RoomEvent.Reconnecting, onReconnecting);
    room.on(RoomEvent.Reconnected, onReconnected);
    room.on(RoomEvent.ActiveSpeakersChanged, onActiveSpeakers);
    room.on(RoomEvent.ConnectionQualityChanged, onQuality);

    if (room.state === "connected") setConnected(true);
    return () => {
      room.off(RoomEvent.Connected, onConnected);
      room.off(RoomEvent.Disconnected, onDisconnected);
      room.off(RoomEvent.Reconnecting, onReconnecting);
      room.off(RoomEvent.Reconnected, onReconnected);
      room.off(RoomEvent.ActiveSpeakersChanged, onActiveSpeakers);
      room.off(RoomEvent.ConnectionQualityChanged, onQuality);
    };
  }, [room]);

  // Camera publishing — only when user is "on stage" AND cameraOn
  useEffect(() => {
    if (!room || !connected) return;
    room.localParticipant.setCameraEnabled(inCall && cameraOn).catch(() => {});
  }, [room, connected, inCall, cameraOn]);

  // Mic — only admins/prime can unmute themselves; everyone else stays muted
  useEffect(() => {
    if (!room || !connected) return;
    const allowMic = inCall && micOn && canToggleMic;
    room.localParticipant.setMicrophoneEnabled(allowMic).catch(() => {});
  }, [room, connected, inCall, micOn, canToggleMic]);

  // Reactions over LiveKit data channel
  useEffect(() => {
    if (!room) return;
    const onData = (payload: Uint8Array) => {
      try {
        const msg = JSON.parse(new TextDecoder().decode(payload));
        if (msg?.type === "reaction" && typeof msg.emoji === "string") {
          spawnReaction(msg.emoji);
        }
      } catch {}
    };
    room.on(RoomEvent.DataReceived, onData);
    return () => { room.off(RoomEvent.DataReceived, onData); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room]);

  const spawnReaction = useCallback((emoji: string) => {
    const id = (globalThis.crypto as any)?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
    const x = Math.random() * 0.65 + 0.15;
    setReactions((r) => [...r, { id, emoji, x }]);
    setTimeout(() => setReactions((r) => r.filter((x) => x.id !== id)), 2600);
  }, []);

  const sendReaction = useCallback((emoji: string) => {
    spawnReaction(emoji);
    setShowReactionPicker(false);
    if (!room) return;
    try {
      const payload = new TextEncoder().encode(JSON.stringify({ type: "reaction", emoji }));
      room.localParticipant.publishData(payload, { reliable: false });
    } catch {}
  }, [room, spawnReaction]);

  // Device enumeration
  useEffect(() => {
    if (!inCall) return;
    let cancelled = false;
    const loadDevices = async () => {
      try {
        const all = await navigator.mediaDevices.enumerateDevices();
        if (cancelled) return;
        setCameras(all.filter((d) => d.kind === "videoinput"));
      } catch {}
    };
    loadDevices();
    navigator.mediaDevices?.addEventListener?.("devicechange", loadDevices);
    return () => {
      cancelled = true;
      navigator.mediaDevices?.removeEventListener?.("devicechange", loadDevices);
    };
  }, [inCall]);

  const switchCamera = useCallback(async (deviceId: string) => {
    if (!room) return;
    try {
      await room.switchActiveDevice("videoinput", deviceId);
      setActiveCamId(deviceId);
      setShowDevices(false);
    } catch {}
  }, [room]);

  // Knock-queue wiring (admins only)
  useEffect(() => {
    const sock = getSocket?.();
    if (!sock) return;

    const onNew = (entry: KnockEntry) => {
      if (!isAdmin) return;
      setKnockQueue((q) => [{ userId: entry.userId, displayName: entry.displayName || entry.userId }, ...q.filter((x) => x.userId !== entry.userId)]);
    };
    const onResolved = (p: { targetUserId: string }) => {
      setKnockQueue((q) => q.filter((x) => x.userId !== p.targetUserId));
    };
    const onApproved = () => {
      setRaiseHand(false);
      setKnockToast("You were invited to speak! Unmute when ready.");
      setTimeout(() => setKnockToast(null), 4000);
    };
    sock.on?.("mainstage:knock:new", onNew);
    sock.on?.("mainstage:knock:resolved", onResolved);
    sock.on?.("mainstage:knock:approved", onApproved);
    return () => {
      sock.off?.("mainstage:knock:new", onNew);
      sock.off?.("mainstage:knock:resolved", onResolved);
      sock.off?.("mainstage:knock:approved", onApproved);
    };
  }, [isAdmin]);

  const handleRaiseHand = useCallback(async () => {
    if (raiseHand) return;
    setRaiseHand(true);
    setKnockToast("Hand raised — waiting for an admin to invite you.");
    setTimeout(() => setKnockToast(null), 4000);
    try {
      await knockToSpeak();
    } catch {
      setRaiseHand(false);
      setKnockToast("Could not send knock. Try again in a moment.");
      setTimeout(() => setKnockToast(null), 4000);
    }
  }, [raiseHand]);

  const handleApproveKnock = useCallback(async (entry: KnockEntry) => {
    try { await approveKnock(entry.userId); } catch {}
    setKnockQueue((q) => q.filter((x) => x.userId !== entry.userId));
  }, []);

  const handleDenyKnock = useCallback(async (entry: KnockEntry) => {
    try { await denyKnock(entry.userId); } catch {}
    setKnockQueue((q) => q.filter((x) => x.userId !== entry.userId));
  }, []);

  // Fullscreen
  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("webkitfullscreenchange", onChange);
    };
  }, []);

  const resetControlsTimer = useCallback(() => {
    setControlsVisible(true);
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    if (isFullscreen) {
      controlsTimerRef.current = setTimeout(() => setControlsVisible(false), 3000);
    }
  }, [isFullscreen]);

  useEffect(() => {
    if (isFullscreen) resetControlsTimer();
    else setControlsVisible(true);
  }, [isFullscreen, resetControlsTimer]);

  const toggleFullscreen = useCallback(async () => {
    const el = stageRef.current;
    if (!el) return;
    try {
      if (!document.fullscreenElement) {
        if (el.requestFullscreen) await el.requestFullscreen();
        else if ((el as any).webkitRequestFullscreen) await (el as any).webkitRequestFullscreen();
      } else {
        if (document.exitFullscreen) await document.exitFullscreen();
        else if ((document as any).webkitExitFullscreen) await (document as any).webkitExitFullscreen();
      }
    } catch {}
  }, []);

  const currentVideoSrc = primeVideos.length > 0
    ? getAssetUrl(primeVideos[videoIdx % primeVideos.length]?.video_file || null) ?? undefined
    : undefined;

  const primaryActiveSpeakerId = useMemo(() => {
    for (const id of activeSpeakerIds) {
      if (id !== "cristina-ai" && id !== localParticipant?.identity) return id;
    }
    return null;
  }, [activeSpeakerIds, localParticipant?.identity]);

  // Music ducking: drop background music ~9 dB whenever any remote (non-AI) speaker is active.
  useEffect(() => {
    const anySpeaker = Array.from(activeSpeakerIds).some(
      (id) => id !== "cristina-ai" && id !== localParticipant?.identity
    );
    setDucking(anySpeaker);
    return () => setDucking(false);
  }, [activeSpeakerIds, localParticipant?.identity, setDucking]);

  const handleTileSelect = useCallback((id: string) => {
    setFocusedParticipantId((prev) => (prev === id ? null : id));
  }, []);

  const renderTile = (trackRef: TrackReferenceOrPlaceholder, isActive: boolean, isFocused: boolean) => {
    const id = trackRef.participant.identity;
    return (
      <ParticipantTile
        key={`${id}-${trackRef.source}`}
        trackRef={trackRef}
        isActive={isActive}
        isFocused={isFocused}
        isSpeaking={activeSpeakerIds.has(id)}
        onSelect={() => handleTileSelect(id)}
        onPin={() => handleTileSelect(id)}
      />
    );
  };

  const renderCmsVideoTile = (isFocused: boolean = false) => (
    <div
      onClick={(e) => { e.stopPropagation(); setFocusedParticipantId((prev) => (prev === "cms-video" ? null : "cms-video")); }}
      className={`relative w-full h-full rounded-xl overflow-hidden bg-black cursor-pointer transition-all ${
        isFocused ? "ring-4 ring-[#FFB454] shadow-lg shadow-[#FFB454]/20" : "ring-1 ring-white/10"
      }`}
    >
      {currentVideoSrc && (
        <video
          key={currentVideoSrc}
          className="w-full h-full object-cover"
          src={currentVideoSrc}
          autoPlay
          muted
          playsInline
          loop={primeVideos.length === 1}
          onEnded={() => setVideoIdx((i) => (i + 1) % Math.max(1, primeVideos.length))}
          onError={() => setVideoIdx((i) => (i + 1) % Math.max(1, primeVideos.length))}
        />
      )}
      <div className="absolute bottom-1.5 left-1.5 flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-black/60 backdrop-blur-sm pointer-events-none">
        <span className="text-white text-[9px] font-medium">Stage Feature</span>
      </div>
    </div>
  );

  const renderVideoGrid = () => {
    let activeTracks = userVideoTracks;
    if (!showSelfView) activeTracks = activeTracks.filter((t) => !t.participant.isLocal);

    if (layout === "video") {
      return (
        <div className="w-full h-full flex flex-col gap-1 p-1">
          <div className="flex-1 min-h-0 relative">{renderCmsVideoTile(focusedParticipantId === "cms-video")}</div>
          {activeTracks.length > 0 && (
            <div className="h-24 sm:h-28 flex gap-1.5 overflow-x-auto scrollbar-none shrink-0 p-1 pointer-events-auto">
              {activeTracks.map((t) => (
                <div key={`${t.participant.identity}-${t.source}`} className="shrink-0 w-32 sm:w-40 aspect-video">
                  {renderTile(t, t.participant.identity === primaryActiveSpeakerId, t.participant.identity === focusedParticipantId)}
                </div>
              ))}
            </div>
          )}
        </div>
      );
    }

    if (layout === "spotlight") {
      const targetId = focusedParticipantId && focusedParticipantId !== "cms-video"
        ? focusedParticipantId
        : (primaryActiveSpeakerId || (activeTracks.length > 0 ? activeTracks[0].participant.identity : "cms-video"));
      const primaryTrack = activeTracks.find((t) => t.participant.identity === targetId);
      const stripTracks = activeTracks.filter((t) => t.participant.identity !== targetId);

      return (
        <div className="w-full h-full flex flex-col gap-1 p-1">
          <div className="flex-1 min-h-0 relative">
            {primaryTrack ? renderTile(primaryTrack, targetId === primaryActiveSpeakerId, true) : renderCmsVideoTile(true)}
          </div>
          <div className="h-24 sm:h-28 flex gap-1.5 overflow-x-auto scrollbar-none shrink-0 p-1 pointer-events-auto">
            {targetId !== "cms-video" && <div className="shrink-0 w-32 sm:w-40 aspect-video">{renderCmsVideoTile()}</div>}
            {stripTracks.map((t) => (
              <div key={`${t.participant.identity}-${t.source}`} className="shrink-0 w-32 sm:w-40 aspect-video">
                {renderTile(t, t.participant.identity === primaryActiveSpeakerId, false)}
              </div>
            ))}
          </div>
        </div>
      );
    }

    const tiles: Array<{ kind: "video" } | { kind: "track"; track: TrackReferenceOrPlaceholder }> = [
      { kind: "video" },
      ...activeTracks.map((t) => ({ kind: "track" as const, track: t })),
    ];
    const cols = tiles.length === 1 ? "grid-cols-1" : tiles.length === 2 ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-3";

    return (
      <div className="w-full h-full overflow-y-auto p-1 scrollbar-none pointer-events-auto">
        <div className={`grid ${cols} gap-1.5`}>
          {tiles.map((item) => (
            <div key={item.kind === "video" ? "cms" : `${item.track.participant.identity}-${item.track.source}`} className="aspect-video">
              {item.kind === "video"
                ? renderCmsVideoTile(focusedParticipantId === "cms-video")
                : renderTile(item.track, item.track.participant.identity === primaryActiveSpeakerId, item.track.participant.identity === focusedParticipantId)}
            </div>
          ))}
        </div>
      </div>
    );
  };

  const qualityPill = (() => {
    const map: Record<ConnectionQuality, { dot: string; label: string }> = {
      [ConnectionQuality.Excellent]: { dot: "bg-green-400", label: "HD" },
      [ConnectionQuality.Good]: { dot: "bg-green-400/80", label: "Good" },
      [ConnectionQuality.Poor]: { dot: "bg-amber-400", label: "Weak" },
      [ConnectionQuality.Lost]: { dot: "bg-red-400", label: "Lost" },
      [ConnectionQuality.Unknown]: { dot: "bg-white/40", label: "…" },
    };
    return map[ownQuality] ?? map[ConnectionQuality.Unknown];
  })();

  return (
    <div
      ref={stageRef}
      className={`relative flex flex-col ${isFullscreen ? "fixed inset-0 z-[150] bg-black" : ""}`}
      onMouseMove={resetControlsTimer}
      onTouchStart={resetControlsTimer}
    >
      <div className={`relative w-full bg-black overflow-hidden ${isFullscreen ? "flex-1" : "aspect-video rounded-2xl"}`}>
        <div className="absolute inset-0 z-10">{renderVideoGrid()}</div>

        {/* Reactions overlay */}
        <div className="absolute inset-0 z-[155] pointer-events-none overflow-hidden">
          {reactions.map((r) => (
            <div
              key={r.id}
              className="absolute bottom-4 stage-reaction-float text-3xl"
              style={{ left: `${r.x * 100}%` }}
            >
              {r.emoji}
            </div>
          ))}
        </div>

        {/* Reconnecting overlay */}
        {reconnecting && (
          <div className="absolute inset-0 z-[175] flex items-center justify-center bg-black/70 backdrop-blur-sm pointer-events-none">
            <div className="flex items-center gap-3 px-5 py-3 rounded-full bg-black/80 border border-white/10">
              <span className="w-3 h-3 rounded-full bg-amber-400 animate-pulse" />
              <span className="text-sm font-medium text-white">Reconnecting…</span>
            </div>
          </div>
        )}

        {/* Top-left mode badge */}
        <div className="absolute top-3 left-3 z-[160] pointer-events-none"><StageBadge mode={stageMode} /></div>

        {/* Top-right: quality + attendants */}
        <div className="absolute top-3 right-3 z-[160] flex items-center gap-2">
          {connected && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/50 backdrop-blur-sm border border-white/10 pointer-events-none">
              <span className={`w-2 h-2 rounded-full ${qualityPill.dot}`} />
              <span className="text-white text-[10px] font-semibold uppercase tracking-wider">{qualityPill.label}</span>
            </div>
          )}
          <button
            type="button"
            onClick={() => setShowAttendants((v) => !v)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/50 backdrop-blur-sm border border-white/10 cursor-pointer hover:bg-black/70 transition-colors pointer-events-auto"
          >
            <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
            <span className="text-white text-xs font-semibold">{totalInRoom} in room</span>
          </button>
          {isAdmin && knockQueue.length > 0 && (
            <button
              type="button"
              onClick={() => setShowKnockTray((v) => !v)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/90 text-black font-bold text-xs shadow-lg shadow-amber-500/30 pointer-events-auto"
              title="Pending knocks"
            >
              <span className="stage-hand-wave">✋</span>
              <span>{knockQueue.length}</span>
            </button>
          )}
        </div>

        {/* Vertical smart controls (right) */}
        <div
          className={`absolute right-3 z-[170] flex flex-col gap-2 transition-opacity duration-300 ${isFullscreen ? "top-1/2 -translate-y-1/2" : "bottom-16"}`}
          style={{ opacity: isFullscreen && !controlsVisible ? 0 : 1 }}
        >
          <div className="flex flex-col items-center gap-1 px-1.5 py-1.5 rounded-full bg-black/60 backdrop-blur-sm border border-white/10 pointer-events-auto">
            {(["video", "spotlight", "grid"] as StageLayout[]).map((l) => (
              <button
                key={l}
                onClick={() => onLayoutChange(l)}
                className={`w-9 h-9 rounded-full flex items-center justify-center transition-all active:scale-90 ${layout === l ? "bg-[#FFB454]/30 text-[#FFB454]" : "text-white/50 hover:text-white/80"}`}
                title={l === "video" ? "Video focus" : l === "spotlight" ? "Spotlight" : "Grid"}
              >
                {l === "video" && (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <rect x="3" y="5" width="18" height="14" rx="2" />
                    <path d="M10 9.5v5l4-2.5-4-2.5z" fill="currentColor" />
                  </svg>
                )}
                {l === "spotlight" && (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <rect x="3" y="4" width="18" height="11" rx="1.5" />
                    <rect x="3" y="17" width="5" height="3" rx="0.5" />
                    <rect x="10" y="17" width="5" height="3" rx="0.5" />
                  </svg>
                )}
                {l === "grid" && (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <rect x="3.5" y="3.5" width="7" height="7" rx="1" />
                    <rect x="13.5" y="3.5" width="7" height="7" rx="1" />
                    <rect x="3.5" y="13.5" width="7" height="7" rx="1" />
                    <rect x="13.5" y="13.5" width="7" height="7" rx="1" />
                  </svg>
                )}
              </button>
            ))}
          </div>
          <button
            onClick={() => setShowSelfView(!showSelfView)}
            className={`w-11 h-11 rounded-full flex items-center justify-center backdrop-blur-sm border transition-all active:scale-90 pointer-events-auto ${showSelfView ? "bg-[#FFB454]/30 border-[#FFB454]/40 text-[#FFB454]" : "bg-black/60 border-white/10 text-white/50"}`}
            title={showSelfView ? "Hide self-view" : "Show self-view"}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
          </button>
        </div>

        {/* Now playing */}
        {nowPlaying?.track && !isFullscreen && (
          <div className="absolute bottom-0 left-0 right-0 z-[160] flex items-center gap-2 px-4 py-2.5 bg-gradient-to-t from-black/80 to-transparent pointer-events-none">
            <svg className="w-3.5 h-3.5 text-[#FFB454] shrink-0" fill="currentColor" viewBox="0 0 24 24">
              <path d="M9 9l10.5-3v12.553a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 01-.99-3.467l2.31-.66A2.25 2.25 0 0019.5 14.803V5.25L9 8.25v7.303a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 01-.99-3.467l2.31-.66A2.25 2.25 0 0011 16.803V9z" />
            </svg>
            <span className="text-white/60 text-[11px] truncate">{nowPlaying.track.title}</span>
          </div>
        )}

        {/* Knock toast */}
        {knockToast && (
          <div className="absolute left-1/2 -translate-x-1/2 top-16 z-[195] px-4 py-2 rounded-full bg-black/80 backdrop-blur-md border border-white/10 text-white text-xs font-medium pointer-events-none animate-in slide-in-from-top-2 duration-200">
            {knockToast}
          </div>
        )}
      </div>

      {/* Attendants drawer */}
      {showAttendants && (
        <div className="absolute inset-y-0 right-0 z-[180] w-64 bg-[#1C1C1E]/95 backdrop-blur-xl border-l border-white/10 animate-in slide-in-from-right duration-300 pointer-events-auto">
          <div className="p-4 border-b border-white/10 flex items-center justify-between">
            <span className="text-sm font-bold text-white">Attendants</span>
            <button onClick={() => setShowAttendants(false)} className="text-white/50 hover:text-white p-1">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="overflow-y-auto h-full p-2 space-y-1 pb-20">
            {participants.map((p) => (
              <div
                key={p.identity}
                onClick={() => !p.isLocal && onOpenDm(p.identity, p.name || p.identity)}
                className={`flex items-center gap-2 p-2 rounded-lg transition-colors ${p.isLocal ? "bg-white/5" : "hover:bg-white/10 cursor-pointer"}`}
              >
                <div className="w-8 h-8 rounded-full bg-[#FFB454]/20 flex items-center justify-center text-xs font-bold text-white">
                  {(p.name || p.identity)[0]?.toUpperCase() || "?"}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-white truncate">{p.name || p.identity}</p>
                  <p className="text-[10px] text-white/40">{p.isLocal ? "You" : (p.identity === "cristina-ai" ? "AI Host" : "Member")}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Knock tray (admin) */}
      {isAdmin && showKnockTray && knockQueue.length > 0 && (
        <div className="absolute top-14 right-3 z-[185] w-64 bg-[#1C1C1E]/95 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl animate-in slide-in-from-top-2 duration-200 pointer-events-auto overflow-hidden">
          <div className="px-3 py-2 border-b border-white/10 flex items-center justify-between">
            <span className="text-xs font-bold text-white uppercase tracking-wider">Raised hands</span>
            <button onClick={() => setShowKnockTray(false)} className="text-white/50 hover:text-white p-1">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="max-h-64 overflow-y-auto p-2 space-y-1.5">
            {knockQueue.map((k) => (
              <div key={k.userId} className="flex items-center gap-2 p-2 rounded-lg bg-white/5">
                <div className="w-7 h-7 rounded-full bg-amber-500/30 flex items-center justify-center text-xs">✋</div>
                <span className="flex-1 text-xs font-medium text-white truncate">{k.displayName}</span>
                <button
                  onClick={() => handleApproveKnock(k)}
                  className="h-7 px-2 rounded-full bg-green-500 text-white text-[10px] font-bold hover:bg-green-600 active:scale-95 transition-all"
                >
                  Invite
                </button>
                <button
                  onClick={() => handleDenyKnock(k)}
                  className="h-7 px-2 rounded-full bg-white/10 text-white/70 text-[10px] font-bold hover:bg-white/20 active:scale-95 transition-all"
                >
                  Deny
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Device picker */}
      {showDevices && cameras.length > 0 && (
        <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-[185] min-w-[220px] max-w-[80%] bg-[#1C1C1E]/95 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl animate-in fade-in duration-200 pointer-events-auto overflow-hidden">
          <div className="px-3 py-2 border-b border-white/10 flex items-center justify-between">
            <span className="text-[10px] font-bold text-white/60 uppercase tracking-wider">Camera</span>
            <button onClick={() => setShowDevices(false)} className="text-white/50 hover:text-white p-1">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="max-h-56 overflow-y-auto p-1">
            {cameras.map((cam) => (
              <button
                key={cam.deviceId}
                onClick={() => switchCamera(cam.deviceId)}
                className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors ${activeCamId === cam.deviceId ? "bg-[#FFB454]/20 text-[#FFB454]" : "text-white/80 hover:bg-white/10"}`}
              >
                {cam.label || `Camera ${cam.deviceId.slice(0, 6)}`}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Reaction picker */}
      {showReactionPicker && (
        <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-[185] px-3 py-2 bg-[#1C1C1E]/95 backdrop-blur-xl border border-white/10 rounded-full shadow-2xl animate-in fade-in zoom-in-95 duration-200 pointer-events-auto flex items-center gap-1">
          {["❤️", "🎉", "👏", "🔥", "😂", "🥳", "🙌"].map((e) => (
            <button
              key={e}
              onClick={() => sendReaction(e)}
              className="w-10 h-10 rounded-full flex items-center justify-center text-2xl hover:bg-white/10 active:scale-90 transition-all"
            >
              {e}
            </button>
          ))}
        </div>
      )}

      <RoomAudioRenderer />

      {/* Bottom control bar */}
      <div
        className={`flex items-center justify-center gap-3 sm:gap-4 py-4 px-4 transition-opacity duration-300 ${isFullscreen ? "absolute bottom-0 left-0 right-0 z-[190] bg-gradient-to-t from-black/80 to-transparent pb-8 pt-12" : "relative z-[100] border-t border-white/5"}`}
        style={{ opacity: isFullscreen && !controlsVisible ? 0 : 1, pointerEvents: isFullscreen && !controlsVisible ? "none" : "auto" }}
      >
        {!inCall ? (
          <Button onClick={onGoOnStage} className="px-8 h-12 rounded-full shadow-lg shadow-[#FFB454]/20 pointer-events-auto">
            Join the Stage
          </Button>
        ) : (
          <>
            {/* Mic */}
            <button
              onClick={() => canToggleMic && setMicOn((v) => !v)}
              disabled={!canToggleMic}
              className={`w-12 h-12 rounded-full flex items-center justify-center border transition-all active:scale-95 pointer-events-auto ${
                !canToggleMic
                  ? "bg-red-500/20 border-red-500/40 text-red-400 opacity-60 cursor-not-allowed"
                  : micOn
                  ? "bg-green-500 border-green-500 text-white shadow-lg shadow-green-500/30"
                  : "bg-white/10 border-white/20 text-white/80 hover:bg-white/20"
              }`}
              title={!canToggleMic ? "Mics reserved for admins & Prime" : micOn ? "Mute mic" : "Unmute mic"}
            >
              {micOn && canToggleMic ? (
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-14 0m7 7v4m-4 0h8m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
              ) : (
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                  <path d="M3 3l18 18" strokeWidth={2} />
                </svg>
              )}
            </button>

            {/* Cam */}
            <button
              onClick={() => setCameraOn((v) => !v)}
              className={`w-12 h-12 rounded-full flex items-center justify-center border transition-all active:scale-95 pointer-events-auto ${
                cameraOn
                  ? "bg-white/10 border-white/20 text-white hover:bg-white/20"
                  : "bg-red-500/20 border-red-500/40 text-red-400"
              }`}
              title={cameraOn ? "Turn camera off" : "Turn camera on"}
            >
              {cameraOn ? (
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              ) : (
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  <path d="M3 3l18 18" strokeWidth={2} />
                </svg>
              )}
            </button>

            {/* Reactions */}
            <button
              onClick={() => setShowReactionPicker((v) => !v)}
              className={`w-12 h-12 rounded-full flex items-center justify-center border transition-all active:scale-95 pointer-events-auto ${showReactionPicker ? "bg-[#FFB454]/30 border-[#FFB454]/50 text-[#FFB454]" : "bg-white/10 border-white/20 text-white hover:bg-white/20"}`}
              title="Send a reaction"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
              </svg>
            </button>

            {/* Raise hand (member knock) */}
            {!isAdmin && (
              <button
                onClick={handleRaiseHand}
                disabled={raiseHand}
                className={`w-12 h-12 rounded-full flex items-center justify-center border transition-all active:scale-95 pointer-events-auto ${raiseHand ? "bg-amber-500 border-amber-500 text-black shadow-lg shadow-amber-500/30" : "bg-white/10 border-white/20 text-white hover:bg-white/20"}`}
                title={raiseHand ? "Hand raised" : "Raise hand to speak"}
              >
                <span className={`text-xl ${raiseHand ? "stage-hand-wave" : ""}`}>✋</span>
              </button>
            )}

            {/* Device picker (gear) */}
            {cameras.length > 1 && (
              <button
                onClick={() => setShowDevices((v) => !v)}
                className={`w-12 h-12 rounded-full flex items-center justify-center border transition-all active:scale-95 pointer-events-auto ${showDevices ? "bg-[#FFB454]/30 border-[#FFB454]/50 text-[#FFB454]" : "bg-white/10 border-white/20 text-white hover:bg-white/20"}`}
                title="Camera & device settings"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>
            )}

            {/* Fullscreen */}
            <button
              onClick={(e) => { e.stopPropagation(); toggleFullscreen(); }}
              className="w-12 h-12 rounded-full flex items-center justify-center bg-white/10 border border-white/20 text-white hover:bg-white/20 transition-all pointer-events-auto"
              title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                {isFullscreen ? (
                  <path d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" />
                ) : (
                  <path d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
                )}
              </svg>
            </button>

            {/* Leave */}
            <button
              onClick={(e) => { e.stopPropagation(); onLeave(); }}
              className="w-12 h-12 rounded-full flex items-center justify-center bg-red-500 text-white hover:bg-red-600 transition-all shadow-lg shadow-red-500/20 pointer-events-auto"
              title="Leave stage"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
              </svg>
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function MainStage() {
  const { user, isAuthenticated } = useAuth();
  const { isPrime, isMember, isAdmin } = useTier();

  const [occupancy, setOccupancy] = useState(0);
  const [occupancyUsers, setOccupancyUsers] = useState<Array<any>>([]);
  const [stageState, setStageState] = useState<StageState | null>(null);
  const [mainGroup, setMainGroup] = useState<HangoutGroup | null>(null);
  const [callToken, setCallToken] = useState<string | null>(null);
  const [callRoomName, setCallRoomName] = useState<string | null>(null);
  const [callLivekitUrl, setCallLivekitUrl] = useState("wss://livekit.pnptv.app");
  const [inCall, setInCall] = useState(false);
  const [activeDm, setActiveDm] = useState<{ id: string; name: string } | null>(null);
  const autoConnectedRef = useRef(false);

  const [nowPlaying, setNowPlaying] = useState<NowPlaying | null>(null);
  const [primeVideos, setPrimeVideos] = useState<PrimeVideo[]>([]);
  const [layout, setLayout] = useState<StageLayout>("video");

  const wellnessTips = useMemo(() => [
    "Hydrate, baby. Water is free self-care — your body deserves it right now.",
    "Check in with yourself: how\u2019s your breathing? Take three slow, deep breaths with me.",
    "You don\u2019t have to be productive to deserve rest. Rest is not a reward — it\u2019s a right.",
    "If you\u2019ve been sitting a while, stretch those legs. Your future self will thank you.",
    "Reminder: you are enough exactly as you are, right now, in this moment.",
    "When\u2019s the last time you ate something? Nourish that beautiful body.",
    "It\u2019s okay to step away from the screen. The stage will be here when you come back.",
    "Set a boundary today — even a small one. Boundaries are acts of self-love.",
    "Feeling anxious? Name 5 things you can see, 4 you can touch, 3 you can hear.",
    "Your community is here for you. You are not alone in this — never forget that.",
  ], []);
  const [tipIndex, setTipIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => { setTipIndex((prev) => (prev + 1) % wellnessTips.length); }, 30000);
    return () => clearInterval(interval);
  }, [wellnessTips.length]);

  useEffect(() => {
    getCommunityRoomOccupancy().then((res) => { setOccupancy(res.occupancy?.activeUsers ?? 0); setOccupancyUsers(res.occupancy?.users ?? []); }).catch(() => {});
    getStageState().then((res) => { if (res.stageState) setStageState(res.stageState); }).catch(() => {});
    getHangoutGroups().then((res) => { const main = (res.groups || []).find((g: any) => g.isMain); if (main) setMainGroup(main); }).catch(() => {});
    const fetchNP = () => { getRadioNowPlaying().then(setNowPlaying).catch(() => {}); };
    fetchNP();
    const npInterval = setInterval(fetchNP, 15000);
    getFeaturedPrimeVideos(10).then(setPrimeVideos).catch(() => {});
    return () => clearInterval(npInterval);
  }, []);

  useEffect(() => {
    if (!mainGroup?.id || autoConnectedRef.current || !isAuthenticated) return;
    autoConnectedRef.current = true;
    joinHangoutCall(mainGroup.id).catch(() => startHangoutCall(mainGroup.id)).then((result) => {
      setCallToken(result.token);
      setCallRoomName(result.roomName);
      setCallLivekitUrl(result.livekitUrl || "wss://livekit.pnptv.app");
    }).catch(() => { autoConnectedRef.current = false; });
  }, [mainGroup?.id, isAuthenticated]);

  const handleJoin = async () => {
    if (!user || !mainGroup?.id) return;
    if (callToken) { setInCall(true); return; }
    try {
      const result = await joinHangoutCall(mainGroup.id).catch(() => startHangoutCall(mainGroup.id));
      setCallToken(result.token);
      setCallRoomName(result.roomName);
      setInCall(true);
    } catch {}
  };

  const currentVideoSrc = primeVideos.length > 0 ? getAssetUrl(primeVideos[0]?.video_file || null) : undefined;

  const liveKitOptions = useMemo(() => ({
    adaptiveStream: true,
    dynacast: true,
    publishDefaults: {
      simulcast: true,
      videoCodec: "vp9" as const,
    },
    videoCaptureDefaults: {
      resolution: VideoPresets.h540.resolution,
    },
  }), []);

  return (
    <div className="pb-24 max-w-4xl mx-auto space-y-4 px-4 pt-4">
      <Helmet><title>Main Stage | PNPtv</title></Helmet>

      <div className="relative overflow-hidden rounded-2xl border border-white/5 bg-black shadow-2xl">
        {callToken && callRoomName ? (
          <LiveKitRoom
            token={callToken}
            serverUrl={callLivekitUrl}
            connect={true}
            audio={false}
            video={true}
            options={liveKitOptions}
            onDisconnected={() => { setInCall(false); setCallToken(null); autoConnectedRef.current = false; }}
            style={{ display: "contents" }}
          >
            <StageRoom
              onLeave={() => setInCall(false)}
              stageMode={stageState?.mode || "ambient"}
              isAdmin={isAdmin}
              isPrime={isPrime}
              isMember={isMember}
              inCall={inCall}
              onGoOnStage={handleJoin}
              layout={layout}
              onLayoutChange={setLayout}
              primeVideos={primeVideos}
              nowPlaying={nowPlaying}
              wellnessTip={wellnessTips[tipIndex]}
              onOpenDm={(id, name) => setActiveDm({ id, name })}
            />
          </LiveKitRoom>
        ) : (
          <div className="aspect-video relative flex flex-col items-center justify-center bg-[#1C1C1E]">
            {currentVideoSrc && <video src={currentVideoSrc} autoPlay muted playsInline loop className="absolute inset-0 w-full h-full object-cover opacity-40" />}
            <div className="relative z-10 flex flex-col items-center gap-6 text-center px-4">
              <div className="flex flex-col items-center gap-2">
                <h1 className="text-3xl font-black text-white tracking-tight uppercase">THE MAIN STAGE</h1>
                <p className="text-[#FFB454] text-sm font-medium">24/7 Community Hangout & Live Music</p>
              </div>
              <div className="flex -space-x-3">
                {occupancyUsers.slice(0, 5).map((u, i) => (
                  <div key={i} className="w-12 h-12 rounded-full border-2 border-black bg-[#FFB454] flex items-center justify-center text-[#1C1C1E] font-bold shadow-xl">
                    {u.displayName ? u.displayName[0] : "?"}
                  </div>
                ))}
                {occupancy > 5 && <div className="w-12 h-12 rounded-full border-2 border-black bg-white/10 backdrop-blur flex items-center justify-center text-white text-xs font-bold">+{occupancy - 5}</div>}
              </div>
              <Button onClick={handleJoin} className="px-10 h-14 rounded-full text-lg shadow-2xl shadow-[#FFB454]/30">Join the Room</Button>
              {nowPlaying?.track && (
                <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-black/60 backdrop-blur-md border border-white/10">
                  <span className="text-[10px] text-[#FFB454] font-bold uppercase tracking-widest">LIVE MUSIC</span>
                  <span className="text-xs text-white/80 font-medium">{nowPlaying.track.title}</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {activeDm && <FloatingDm userId={activeDm.id} displayName={activeDm.name} onClose={() => setActiveDm(null)} />}

      <UpcomingEvents type="hangout_event" limit={3} title="Featured Events" />

      <Card className="p-6 bg-[#1C1C1E]/40 backdrop-blur-sm border-white/5">
        <h3 className="font-bold text-white text-lg mb-4">Stage Rules</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-lg bg-[#FFB454]/10 flex items-center justify-center text-[#FFB454]">📷</div>
            <div><p className="text-sm font-bold text-white">Cams Mandatory</p><p className="text-xs text-white/50">Everyone on stage must have their camera on.</p></div>
          </div>
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-lg bg-red-500/10 flex items-center justify-center text-red-400">🔇</div>
            <div><p className="text-sm font-bold text-white">Mics Off</p><p className="text-xs text-white/50">Main stage is for music and visuals. Raise hand to request the mic.</p></div>
          </div>
        </div>
      </Card>
    </div>
  );
}

function StageBadge({ mode }: { mode: string }) {
  if (mode === "dj-live") return <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-500/30 backdrop-blur-sm border border-red-500/50 text-red-300 text-xs font-bold uppercase tracking-wider"><span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />DJ LIVE</span>;
  if (mode === "community") return <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-green-500/30 backdrop-blur-sm border border-green-500/50 text-green-300 text-xs font-bold uppercase tracking-wider"><span className="w-2 h-2 bg-green-400 rounded-full" />Community</span>;
  return <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 backdrop-blur-sm border border-white/20 text-white/80 text-xs font-bold uppercase tracking-wider"><span className="w-2 h-2 bg-[#FFB454] rounded-full" />Ambient</span>;
}
