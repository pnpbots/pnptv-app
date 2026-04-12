import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Helmet } from "react-helmet-async";
import { Card, Button } from "@pnptv/ui-kit";
import { useAuth } from "@/hooks/useAuth";
import { useTier } from "@/hooks/useTier";
import { getSocket, connectSocket } from "@/lib/socket";
import {
  LiveKitRoom,
  useRoomContext,
  useTracks,
  useParticipants,
  useLocalParticipant,
  AudioTrack,
  VideoTrack,
  RoomAudioRenderer,
  useConnectionQualityIndicator,
} from "@livekit/components-react";
import { Track, RoomEvent, Participant, ConnectionQuality } from "livekit-client";
import {
  getFeaturedPrimeVideos,
  getAssetUrl,
  type PrimeVideo,
} from "@/lib/directus";

import {
  getCommunityRoomOccupancy,
  getStageState,
  setStageMode as apiSetStageMode,
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
  
  // Explicitly subscribe to camera tracks from all participants
  const tracks = useTracks([Track.Source.Camera], { onlySubscribed: false });
  
  // Force include the local participant camera track if it exists
  const userVideoTracks = useMemo(() => {
    return tracks.filter(t => t.participant.identity !== "cristina-ai");
  }, [tracks]);

  const [connected, setConnected] = useState(false);
  const [activeSpeakerId, setActiveSpeakerId] = useState<string | null>(null);
  const [focusedParticipantId, setFocusedParticipantId] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [showTapOverlay, setShowTapOverlay] = useState(false);
  const [showSelfView, setShowSelfView] = useState(true);
  const [showAttendants, setShowAttendants] = useState(false);
  const [videoIdx, setVideoIdx] = useState(0);
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  const participants = useParticipants();
  const others = participants.filter((p) => p.identity !== "cristina-ai" && !p.isLocal);
  const totalInRoom = participants.length;

  useEffect(() => {
    if (!room) return;
    const onConnected = () => setConnected(true);
    const onDisconnected = () => setConnected(false);
    const onActiveSpeaker = (speakers: Participant[]) => {
      const top = speakers.find((s) => !s.isLocal);
      setActiveSpeakerId(top ? top.identity : null);
    };
    room.on(RoomEvent.Connected, onConnected);
    room.on(RoomEvent.Disconnected, onDisconnected);
    room.on(RoomEvent.ActiveSpeakersChanged, onActiveSpeaker);
    if (room.state === "connected") setConnected(true);
    return () => {
      room.off(RoomEvent.Connected, onConnected);
      room.off(RoomEvent.Disconnected, onDisconnected);
      room.off(RoomEvent.ActiveSpeakersChanged, onActiveSpeaker);
    };
  }, [room]);

  // Handle camera publishing based on inCall state
  useEffect(() => {
    if (room && connected) {
      room.localParticipant.setCameraEnabled(inCall).catch(err => {
        console.error("Failed to set camera enabled:", err);
      });
      room.localParticipant.setMicrophoneEnabled(false).catch(() => {});
    }
  }, [room, connected, inCall]);

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

  const renderTile = (trackRef: typeof userVideoTracks[0], isActive: boolean, isFocused: boolean) => (
    <div
      key={`${trackRef.participant.identity}-${trackRef.source}`}
      onClick={(e) => { e.stopPropagation(); setFocusedParticipantId(trackRef.participant.identity); }}
      className={`relative w-full h-full rounded-xl overflow-hidden bg-[#1C1C1E] cursor-pointer transition-all ${
        isFocused ? "ring-4 ring-[#FFB454] shadow-lg shadow-[#FFB454]/20" :
        isActive ? "ring-2 ring-[#FFB454]/60" : "ring-1 ring-white/10"
      }`}
    >
      <VideoTrack trackRef={trackRef} className="w-full h-full object-cover" />
      <div className="absolute bottom-1.5 left-1.5 flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-black/60 backdrop-blur-sm pointer-events-none">
        <span className="text-white text-[9px] font-medium truncate max-w-[72px]">
          {trackRef.participant.isLocal ? "You" : (trackRef.participant.name || trackRef.participant.identity)}
        </span>
      </div>
    </div>
  );

  const renderCmsVideoTile = (isFocused: boolean = false) => (
    <div
      onClick={(e) => { e.stopPropagation(); setFocusedParticipantId("cms-video"); }}
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
    if (!showSelfView) activeTracks = activeTracks.filter(t => !t.participant.isLocal);

    // ── "Video Focus" Mode ──
    if (layout === "video") {
      return (
        <div className="w-full h-full flex flex-col gap-1 p-1">
          <div className="flex-1 min-h-0 relative">{renderCmsVideoTile(focusedParticipantId === "cms-video")}</div>
          {activeTracks.length > 0 && (
            <div className="h-24 sm:h-28 flex gap-1.5 overflow-x-auto scrollbar-none shrink-0 p-1 pointer-events-auto">
              {activeTracks.map((t) => (
                <div key={`${t.participant.identity}-${t.source}`} className="shrink-0 w-32 sm:w-40 aspect-video">
                  {renderTile(t, t.participant.identity === activeSpeakerId, t.participant.identity === focusedParticipantId)}
                </div>
              ))}
            </div>
          )}
        </div>
      );
    }

    // ── "Spotlight" Mode ──
    if (layout === "spotlight") {
      const targetId = focusedParticipantId && focusedParticipantId !== "cms-video" ? focusedParticipantId : (activeSpeakerId || (activeTracks.length > 0 ? activeTracks[0].participant.identity : "cms-video"));
      const primaryTrack = activeTracks.find(t => t.participant.identity === targetId);
      const stripTracks = activeTracks.filter(t => t.participant.identity !== targetId);

      return (
        <div className="w-full h-full flex flex-col gap-1 p-1">
          <div className="flex-1 min-h-0 relative">
            {primaryTrack ? renderTile(primaryTrack, targetId === activeSpeakerId, true) : renderCmsVideoTile(true)}
          </div>
          <div className="h-24 sm:h-28 flex gap-1.5 overflow-x-auto scrollbar-none shrink-0 p-1 pointer-events-auto">
            {targetId !== "cms-video" && <div className="shrink-0 w-32 sm:w-40 aspect-video">{renderCmsVideoTile()}</div>}
            {stripTracks.map((t) => (
              <div key={`${t.participant.identity}-${t.source}`} className="shrink-0 w-32 sm:w-40 aspect-video">
                {renderTile(t, t.participant.identity === activeSpeakerId, false)}
              </div>
            ))}
          </div>
        </div>
      );
    }

    // ── "Smart Grid" Mode ──
    const tiles = [
      { kind: "video" as const },
      ...activeTracks.map(t => ({ kind: "track" as const, track: t }))
    ];
    const cols = tiles.length === 1 ? "grid-cols-1" : tiles.length === 2 ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-3";

    return (
      <div className="w-full h-full overflow-y-auto p-1 scrollbar-none pointer-events-auto">
        <div className={`grid ${cols} gap-1.5`}>
          {tiles.map((item) => (
            <div key={item.kind === "video" ? "cms" : `${item.track.participant.identity}-${item.track.source}`} className="aspect-video">
              {item.kind === "video" ? renderCmsVideoTile(focusedParticipantId === "cms-video") : renderTile(item.track, item.track.participant.identity === activeSpeakerId, item.track.participant.identity === focusedParticipantId)}
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div
      ref={stageRef}
      className={`relative flex flex-col ${isFullscreen ? "fixed inset-0 z-[150] bg-black" : ""}`}
      onMouseMove={resetControlsTimer}
      onTouchStart={resetControlsTimer}
    >
      <div className={`relative w-full bg-black overflow-hidden ${isFullscreen ? "flex-1" : "aspect-video rounded-2xl"}`}>
        <div className="absolute inset-0 z-10">{renderVideoGrid()}</div>

        <div className="absolute top-3 left-3 z-[160] pointer-events-none"><StageBadge mode={stageMode} /></div>

        <div className="absolute top-3 right-3 z-[160] flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/50 backdrop-blur-sm border border-white/10 cursor-pointer hover:bg-black/70 transition-colors pointer-events-auto" onClick={() => setShowAttendants(!showAttendants)}>
          <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
          <span className="text-white text-xs font-semibold">{totalInRoom} in room</span>
        </div>

        {/* Vertical Smart Controls (Right) */}
        <div className={`absolute right-3 z-[170] flex flex-col gap-2 transition-opacity duration-300 ${isFullscreen ? "top-1/2 -translate-y-1/2" : "bottom-16"}`} style={{ opacity: isFullscreen && !controlsVisible ? 0 : 1 }}>
           <div className="flex flex-col items-center gap-1 px-1.5 py-1.5 rounded-full bg-black/60 backdrop-blur-sm border border-white/10 pointer-events-auto">
            {(["video", "spotlight", "grid"] as StageLayout[]).map((l) => (
              <button key={l} onClick={() => onLayoutChange(l)} className={`w-9 h-9 rounded-full flex items-center justify-center transition-all active:scale-90 ${layout === l ? "bg-[#FFB454]/30 text-[#FFB454]" : "text-white/50 hover:text-white/80"}`}>
                {l === "video" && <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M10 9.5v5l4-2.5-4-2.5z" fill="currentColor" /></svg>}
                {l === "spotlight" && <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><rect x="3" y="4" width="18" height="11" rx="1.5" /><rect x="3" y="17" width="5" height="3" rx="0.5" /><rect x="10" y="17" width="5" height="3" rx="0.5" /></svg>}
                {l === "grid" && <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><rect x="3.5" y="3.5" width="7" height="7" rx="1" /><rect x="13.5" y="3.5" width="7" height="7" rx="1" /><rect x="3.5" y="13.5" width="7" height="7" rx="1" /><rect x="13.5" y="13.5" width="7" height="7" rx="1" /></svg>}
              </button>
            ))}
          </div>
          <button onClick={() => setShowSelfView(!showSelfView)} className={`w-11 h-11 rounded-full flex items-center justify-center backdrop-blur-sm border transition-all active:scale-90 pointer-events-auto ${showSelfView ? "bg-[#FFB454]/30 border-[#FFB454]/40 text-[#FFB454]" : "bg-black/60 border-white/10 text-white/50"}`} title={showSelfView ? "Hide self-view" : "Show self-view"}>
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
          </button>
        </div>

        {nowPlaying?.track && (
          <div className="absolute bottom-0 left-0 right-0 z-[160] flex items-center gap-2 px-4 py-2.5 bg-gradient-to-t from-black/80 to-transparent pointer-events-none">
            <svg className="w-3.5 h-3.5 text-[#FFB454] shrink-0" fill="currentColor" viewBox="0 0 24 24"><path d="M9 9l10.5-3v12.553a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 1.1-.99-3.467l2.31-.66A2.25 2.25 0 0019.5 14.803V5.25L9 8.25v7.303a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 01-.99-3.467l2.31-.66A2.25 2.25 0 0019.5 14.803V5.25z" /></svg>
            <span className="text-white/60 text-[11px] truncate">{nowPlaying.track.title}</span>
          </div>
        )}
      </div>

      {showAttendants && (
        <div className="absolute inset-y-0 right-0 z-[180] w-64 bg-[#1C1C1E]/95 backdrop-blur-xl border-l border-white/10 animate-in slide-in-from-right duration-300 pointer-events-auto">
          <div className="p-4 border-b border-white/10 flex items-center justify-between">
            <span className="text-sm font-bold text-white">Attendants</span>
            <button onClick={() => setShowAttendants(false)} className="text-white/50 hover:text-white p-1"><svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M6 18L18 6M6 6l12 12" /></svg></button>
          </div>
          <div className="overflow-y-auto h-full p-2 space-y-1 pb-20">
            {participants.map((p) => (
              <div key={p.identity} onClick={() => !p.isLocal && onOpenDm(p.identity, p.name || p.identity)} className={`flex items-center gap-2 p-2 rounded-lg transition-colors ${p.isLocal ? "bg-white/5" : "hover:bg-white/10 cursor-pointer"}`}>
                <div className="w-8 h-8 rounded-full bg-[#FFB454]/20 flex items-center justify-center text-xs font-bold text-white">{(p.name || p.identity)[0].toUpperCase()}</div>
                <div className="min-w-0 flex-1"><p className="text-xs font-medium text-white truncate">{p.name || p.identity}</p><p className="text-[10px] text-white/40">{p.isLocal ? "You" : (p.identity === "cristina-ai" ? "AI Host" : "Member")}</p></div>
              </div>
            ))}
          </div>
        </div>
      )}

      <RoomAudioRenderer />

      <div
        className={`flex items-center justify-center gap-4 py-4 px-4 transition-opacity duration-300 ${isFullscreen ? "absolute bottom-0 left-0 right-0 z-[190] bg-gradient-to-t from-black/80 to-transparent pb-8 pt-12" : "relative z-[100] border-t border-white/5"}`}
        style={{ opacity: isFullscreen && !controlsVisible ? 0 : 1, pointerEvents: isFullscreen && !controlsVisible ? "none" : "auto" }}
      >
        {!inCall ? (
          <Button onClick={onGoOnStage} className="px-8 h-12 rounded-full shadow-lg shadow-[#FFB454]/20 pointer-events-auto">Join the Stage</Button>
        ) : (
          <>
            <div className="w-12 h-12 rounded-full flex items-center justify-center bg-red-500/20 border border-red-500/40 text-red-400 opacity-60 cursor-not-allowed"><svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /><path d="M3 3l18 18" stroke="currentColor" strokeWidth={2} /></svg></div>
            <div className="w-12 h-12 rounded-full flex items-center justify-center bg-green-500/20 border border-green-500/40 text-green-400 opacity-60 cursor-not-allowed"><svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg></div>
            <button onClick={(e) => { e.stopPropagation(); toggleFullscreen(); }} className="w-12 h-12 rounded-full flex items-center justify-center bg-white/10 border border-white/20 text-white hover:bg-white/20 transition-all pointer-events-auto">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>{isFullscreen ? <path d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" /> : <path d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />}</svg>
            </button>
            <button onClick={(e) => { e.stopPropagation(); onLeave(); }} className="w-12 h-12 rounded-full flex items-center justify-center bg-red-500 text-white hover:bg-red-600 transition-all shadow-lg shadow-red-500/20 pointer-events-auto">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" /></svg>
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
    "Hydrate, baby. Water is free self-care \u2014 your body deserves it right now.",
    "Check in with yourself: how\u2019s your breathing? Take three slow, deep breaths with me.",
    "You don\u2019t have to be productive to deserve rest. Rest is not a reward \u2014 it\u2019s a right.",
    "If you\u2019ve been sitting a while, stretch those legs. Your future self will thank you.",
    "Reminder: you are enough exactly as you are, right now, in this moment.",
    "When\u2019s the last time you ate something? Nourish that beautiful body.",
    "It\u2019s okay to step away from the screen. The stage will be here when you come back.",
    "Set a boundary today \u2014 even a small one. Boundaries are acts of self-love.",
    "Feeling anxious? Name 5 things you can see, 4 you can touch, 3 you can hear.",
    "Your community is here for you. You are not alone in this \u2014 never forget that.",
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
    joinHangoutCall(mainGroup.id).catch(() => startHangoutCall(mainGroup.id)).then(result => {
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
            video={true} // Allow video publishing
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
                  <div key={i} className="w-12 h-12 rounded-full border-2 border-black bg-[#FFB454] flex items-center justify-center text-[#1C1C1E] font-bold shadow-xl">{u.displayName ? u.displayName[0] : "?"}</div>
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
            <div><p className="text-sm font-bold text-white">Mics Off</p><p className="text-xs text-white/50">Main stage is for music and visuals. Mics are disabled.</p></div>
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
