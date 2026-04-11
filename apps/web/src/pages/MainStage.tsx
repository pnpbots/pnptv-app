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
  AudioTrack,
  VideoTrack,
  RoomAudioRenderer,
} from "@livekit/components-react";
import { Track, RoomEvent, Participant } from "livekit-client";
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
}: StageRoomProps) {
  const room = useRoomContext();
  const participants = useParticipants();
  const allTracks = useTracks(
    [Track.Source.Camera, Track.Source.Microphone, Track.Source.ScreenShare],
    { onlySubscribed: false },
  );
  const audioTracks = allTracks.filter((t) => t.source === Track.Source.Microphone);
  const videoTracks = allTracks.filter(
    (t) => t.source === Track.Source.Camera || t.source === Track.Source.ScreenShare,
  );
  const userVideoTracks = videoTracks.filter((t) => t.participant.identity !== "cristina-ai");

  // Mic is permanently muted, cam is permanently on when publishing — no toggles
  const muted = true;
  const camOff = false;
  const [connected, setConnected] = useState(false);
  const [activeSpeakerId, setActiveSpeakerId] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [showTapOverlay, setShowTapOverlay] = useState(false);
  const [videoIdx, setVideoIdx] = useState(0);
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  const cristina = participants.find((p) => p.identity === "cristina-ai");
  const others = participants.filter((p) => p.identity !== "cristina-ai" && !p.isLocal);
  const localP = participants.find((p) => p.isLocal);
  const totalInRoom = others.length + (localP ? 1 : 0);

  // Connect/disconnect events
  useEffect(() => {
    if (!room) return;
    const onConnected = () => {
      setConnected(true);
      // Listener-only on auto-connect: ensure mic+cam are off
      room.localParticipant.setMicrophoneEnabled(false).catch(() => {});
      room.localParticipant.setCameraEnabled(false).catch(() => {});
    };
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

  // Autoplay unlock detection — show overlay if browser suspends AudioContext
  useEffect(() => {
    if (!connected) return;
    try {
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioContextClass();
      if (ctx.state === "suspended") setShowTapOverlay(true);
      ctx.close().catch(() => {});
    } catch {
      // AudioContext not supported — no overlay needed
    }
  }, [connected]);

  // Fullscreen detection
  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("webkitfullscreenchange", onChange);
    };
  }, []);

  // Auto-hide controls in fullscreen
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

  // Enforce: mic always muted; cam on when publishing, off otherwise
  useEffect(() => {
    if (!room || !connected) return;
    room.localParticipant.setMicrophoneEnabled(false).catch(() => {});
    const camOn = inCall && (isAdmin || isPrime);
    room.localParticipant.setCameraEnabled(camOn).catch(() => {});
  }, [room, connected, inCall, isAdmin, isPrime]);
  const toggleFullscreen = useCallback(async () => {
    const el = stageRef.current;
    if (!el) return;
    try {
      if (!document.fullscreenElement) {
        await (el.requestFullscreen?.() || (el as unknown as { webkitRequestFullscreen: () => Promise<void> }).webkitRequestFullscreen?.());
      } else {
        await (document.exitFullscreen?.() || (document as unknown as { webkitExitFullscreen: () => Promise<void> }).webkitExitFullscreen?.());
      }
    } catch {}
  }, []);

  const isMicMuted = (identity: string) => {
    const p = participants.find((x) => x.identity === identity);
    if (!p) return false;
    const pub = p.getTrackPublication(Track.Source.Microphone);
    return !pub || pub.isMuted;
  };

  const canPublish = inCall && (isAdmin || isPrime);

  // ── CMS video background state ──
  const currentVideoSrc = primeVideos.length > 0
    ? getAssetUrl(primeVideos[videoIdx % primeVideos.length]?.video_file || null) ?? undefined
    : undefined;
  // CMS video is the always-on background for the stage. Spotlight/grid layouts cover it with
  // webcam tiles; "video" layout shows it through with webcams as an overlay strip. DJ-live mode
  // hides it entirely so live video takes full priority.
  const showVideoBackground = stageMode !== "dj-live" && !!currentVideoSrc;

  // Shared tile renderer — used by all layouts
  const renderTile = (trackRef: typeof userVideoTracks[0], isActive: boolean) => (
    <div key={trackRef.publication.trackSid} className={`relative w-full h-full rounded-xl overflow-hidden bg-pnp-surface ${isActive ? "ring-2 ring-pnp-accent" : "ring-1 ring-white/10"}`}>
      <VideoTrack trackRef={trackRef} className="w-full h-full object-cover" />
      <div className="absolute bottom-1.5 left-1.5 flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-black/60 backdrop-blur-sm">
        {isMicMuted(trackRef.participant.identity) && (
          <svg className="w-2.5 h-2.5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
          </svg>
        )}
        <span className="text-white text-[9px] font-medium truncate max-w-[72px]">
          {trackRef.participant.isLocal ? "You" : (trackRef.participant.name || trackRef.participant.identity)}
        </span>
      </div>
    </div>
  );

  // ── Layout-specific video grid ──
  const renderVideoGrid = () => {
    const activeTracks = activeSpeakerId
      ? [...userVideoTracks].sort((a, b) =>
          a.participant.identity === activeSpeakerId ? -1 :
          b.participant.identity === activeSpeakerId ? 1 : 0
        )
      : userVideoTracks;

    // ── "video" mode — CMS video is the focus; webcams sit as thumbs at the bottom ──
    if (layout === "video") {
      if (activeTracks.length === 0) return null; // nothing to overlay
      return (
        <div className="absolute inset-x-0 bottom-12 z-[15] px-2 pointer-events-none">
          <div className="flex gap-1.5 overflow-x-auto scrollbar-none pointer-events-auto">
            {activeTracks.map((trackRef) => (
              <div key={trackRef.publication.trackSid} className="shrink-0 w-28 h-20 sm:w-36 sm:h-24">
                {renderTile(trackRef, trackRef.participant.identity === activeSpeakerId)}
              </div>
            ))}
          </div>
        </div>
      );
    }

    // ── "spotlight" mode — focus on other webcammers ──
    // Primary slot = first non-local active speaker; local user sits in the strip
    if (layout === "spotlight") {
      const remoteTracks = activeTracks.filter((t) => !t.participant.isLocal);
      const localTracks = activeTracks.filter((t) => t.participant.isLocal);
      if (activeTracks.length === 0) return null;
      if (remoteTracks.length === 0) {
        // No remotes yet — show local large so user isn't staring at a void
        return (
          <div className="w-full h-full p-1">
            {renderTile(localTracks[0]!, false)}
          </div>
        );
      }
      const [primary, ...rest] = remoteTracks;
      const strip = [...rest, ...localTracks];
      return (
        <div className="w-full h-full flex flex-col gap-1 p-1">
          <div className="flex-1 min-h-0 relative">
            {renderTile(primary, primary.participant.identity === activeSpeakerId)}
          </div>
          {strip.length > 0 && (
            <div className="h-20 sm:h-24 flex gap-1 overflow-x-auto scrollbar-none shrink-0">
              {strip.map((t) => (
                <div key={t.publication.trackSid} className="shrink-0 w-28 sm:w-32 aspect-video">
                  {renderTile(t, t.participant.identity === activeSpeakerId)}
                </div>
              ))}
            </div>
          )}
        </div>
      );
    }

    // ── "grid" mode — equal for everyone ──
    if (activeTracks.length === 0) return null;
    return (
      <div className={`w-full h-full grid gap-1 p-1 ${
        activeTracks.length === 1 ? "grid-cols-1" :
        activeTracks.length <= 4 ? "grid-cols-2" :
        "grid-cols-3"
      }`}>
        {activeTracks.map((trackRef) =>
          renderTile(trackRef, trackRef.participant.identity === activeSpeakerId)
        )}
      </div>
    );
  };

  if (!connected) {
    return (
      <div className="w-full aspect-video flex items-center justify-center bg-pnp-surface rounded-2xl">
        <div className="flex items-center gap-3 text-pnp-textSecondary">
          <div className="w-5 h-5 border-2 border-pnp-accent/40 border-t-pnp-accent rounded-full animate-spin" />
          Connecting to stage...
        </div>
      </div>
    );
  }

  return (
    <div
      ref={stageRef}
      className={`relative flex flex-col ${isFullscreen ? "fixed inset-0 z-50 bg-black" : ""}`}
      onMouseMove={isFullscreen ? resetControlsTimer : undefined}
      onTouchStart={isFullscreen ? resetControlsTimer : undefined}
    >
      {/* ── Tap-to-enable-sound overlay ───────────────────────────────── */}
      {showTapOverlay && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm rounded-2xl">
          <button
            onClick={() => {
              setShowTapOverlay(false);
              // Resume AudioContext via user gesture
              try {
                const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
                const ctx = new AudioContextClass();
                ctx.resume().then(() => ctx.close()).catch(() => {});
              } catch {}
            }}
            className="flex flex-col items-center gap-3 px-8 py-5 rounded-2xl bg-white/10 border border-white/20 text-white transition-all active:scale-95"
          >
            <svg className="w-10 h-10 text-pnp-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
            </svg>
            <span className="text-sm font-semibold">Tap to enable sound</span>
            <span className="text-xs text-white/50">Browser blocked autoplay</span>
          </button>
        </div>
      )}

      {/* ── Video area ───────────────────────────────────────────────── */}
      <div className={`relative w-full bg-black overflow-hidden ${isFullscreen ? "flex-1" : "aspect-video rounded-2xl"}`}>

        {/* CMS video background (audio-only state, not dj-live) */}
        {showVideoBackground && (
          <video
            key={currentVideoSrc}
            className="absolute inset-0 w-full h-full object-cover opacity-30 pointer-events-none"
            src={currentVideoSrc}
            autoPlay
            muted
            playsInline
            preload="auto"
            loop={primeVideos.length === 1}
            controls={false}
            controlsList="nodownload"
            onEnded={() => setVideoIdx((i) => (i + 1) % Math.max(1, primeVideos.length))}
            onError={() => setVideoIdx((i) => (i + 1) % Math.max(1, primeVideos.length))}
            onContextMenu={(e) => e.preventDefault()}
            style={{ zIndex: 0 }}
          />
        )}

        {/* Mode badge overlay */}
        <div className="absolute top-3 left-3 z-20">
          <StageBadge mode={stageMode} />
        </div>

        {/* Participant count overlay */}
        <div className="absolute top-3 right-3 z-20 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/50 backdrop-blur-sm border border-white/10">
          <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
          <span className="text-white text-xs font-semibold">{totalInRoom} in room</span>
        </div>

        {/* Layout switcher — always visible, three modes: Video / Spotlight / Grid */}
        <div className="absolute bottom-16 right-3 z-[35] flex items-center gap-0.5 px-1.5 py-1.5 rounded-full bg-black/60 backdrop-blur-sm border border-white/10">
          {(["video", "spotlight", "grid"] as StageLayout[]).map((l) => {
            const labels: Record<StageLayout, string> = {
              video: "Video focus",
              spotlight: "Spotlight a webcammer",
              grid: "Equal grid",
            };
            return (
              <button
                key={l}
                onClick={() => onLayoutChange(l)}
                className={`w-8 h-8 rounded-full flex items-center justify-center transition-all active:scale-90 ${
                  layout === l ? "bg-pnp-accent/30 text-pnp-accent" : "text-white/50 hover:text-white/80"
                }`}
                title={labels[l]}
                aria-label={labels[l]}
              >
                {l === "video" && (
                  /* Play-in-frame icon: video is the focus */
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <rect x="3" y="5" width="18" height="14" rx="2" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10 9.5v5l4-2.5-4-2.5z" fill="currentColor" />
                  </svg>
                )}
                {l === "spotlight" && (
                  /* Large tile + strip: focus on a webcammer */
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <rect x="3" y="4" width="18" height="11" rx="1.5" />
                    <rect x="3" y="17" width="5" height="3" rx="0.5" />
                    <rect x="10" y="17" width="5" height="3" rx="0.5" />
                    <rect x="17" y="17" width="4" height="3" rx="0.5" />
                  </svg>
                )}
                {l === "grid" && (
                  /* 2x2 grid: equal for everyone */
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <rect x="3.5" y="3.5" width="7" height="7" rx="1" />
                    <rect x="13.5" y="3.5" width="7" height="7" rx="1" />
                    <rect x="3.5" y="13.5" width="7" height="7" rx="1" />
                    <rect x="13.5" y="13.5" width="7" height="7" rx="1" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>

        {userVideoTracks.length > 0 ? (
          <div className="absolute inset-0 z-10">
            {renderVideoGrid()}
          </div>
        ) : (
          /* Audio-only state */
          <div
            className="relative w-full h-full flex flex-col items-center justify-center z-10"
            style={{
              background: showVideoBackground ? "transparent" :
                stageMode === "dj-live"
                ? "linear-gradient(135deg, #1C1C1E 0%, #2C0A18 40%, #5C0A28 70%, #1C1C1E 100%)"
                : stageMode === "community"
                ? "linear-gradient(135deg, #1C1C1E 0%, #0A2E1A 40%, #0D3D24 70%, #1C1C1E 100%)"
                : "linear-gradient(135deg, #1C1C1E 0%, #0D2030 40%, #0D2A30 70%, #1C1C1E 100%)",
            }}
          >
            {/* Pulsing audio ring */}
            <div className="relative mb-4">
              <div className="w-16 h-16 rounded-full bg-white/5 border border-white/10 flex items-center justify-center">
                <svg className="w-7 h-7 text-white/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
              </div>
              <div className="absolute inset-0 w-16 h-16 rounded-full border border-white/10 animate-ping" style={{ animationDuration: "2s" }} />
            </div>

            {/* Cristina now-playing card — prominent when no video */}
            {cristina && nowPlaying?.track && (
              <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-xl bg-black/40 border border-white/10 backdrop-blur-sm max-w-[220px]">
                <div className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-xs font-bold text-white" style={{ background: "linear-gradient(135deg, #7B61FF, #D4007A)" }}>C</div>
                <div className="min-w-0">
                  <p className="text-[10px] text-white/50 font-medium">Cristina AI</p>
                  <p className="text-xs text-white/80 font-semibold truncate">{nowPlaying.track.title}</p>
                </div>
                <svg className="w-3 h-3 text-pnp-accent shrink-0 animate-pulse" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M9 9l10.5-3v12.553a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 11-.99-3.467l2.31-.66A2.25 2.25 0 0019.5 14.803V5.25L9 8.25v7.303a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 01-.99-3.467l2.31-.66A2.25 2.25 0 009 12.553V9z" />
                </svg>
              </div>
            )}

            {/* Audio-only participant list */}
            {others.length > 0 && (
              <div className="flex flex-wrap justify-center gap-2 px-6 max-w-xs">
                {others.slice(0, 8).map((p) => (
                  <div
                    key={p.identity}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/8 border ${
                      p.identity === activeSpeakerId ? "border-pnp-accent/60" : "border-white/10"
                    }`}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
                    <span className="text-[11px] text-white/80 truncate max-w-[70px]">
                      {p.name || p.identity}
                    </span>
                    {isMicMuted(p.identity) && (
                      <svg className="w-2.5 h-2.5 text-red-400/60 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                      </svg>
                    )}
                  </div>
                ))}
                {others.length > 8 && (
                  <div className="flex items-center px-2.5 py-1 rounded-full bg-white/5 border border-white/10">
                    <span className="text-[11px] text-white/50">+{others.length - 8}</span>
                  </div>
                )}
              </div>
            )}

            {others.length === 0 && !cristina && (
              <p className="text-white/40 text-sm">Listening to the stage...</p>
            )}
          </div>
        )}

        {/* Cristina wellness tip — fullscreen-only overlay (sits above now-playing strip) */}
        {isFullscreen && wellnessTip && (
          <div
            className="absolute left-3 right-3 z-[55] flex items-start gap-2 px-3 py-2 rounded-xl bg-black/60 backdrop-blur-md border border-white/10 transition-opacity duration-300 pointer-events-none"
            style={{
              bottom: nowPlaying?.track ? "48px" : "12px",
              opacity: controlsVisible ? 1 : 0,
              maxWidth: "560px",
              marginLeft: "auto",
              marginRight: "auto",
            }}
          >
            <div className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white" style={{ background: "linear-gradient(135deg, #7B61FF, #D4007A)" }}>
              C
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[9px] uppercase tracking-wider text-white/40 font-semibold mb-0.5">Cristina · wellness</div>
              <p className="text-[12px] text-white/80 leading-snug line-clamp-2">{wellnessTip}</p>
            </div>
          </div>
        )}

        {/* Now Playing strip */}
        {nowPlaying?.track && (
          <div className="absolute bottom-0 left-0 right-0 z-20 flex items-center gap-2 px-4 py-2.5 bg-gradient-to-t from-black/80 to-transparent">
            <svg className="w-3.5 h-3.5 text-pnp-accent shrink-0" fill="currentColor" viewBox="0 0 24 24">
              <path d="M9 9l10.5-3v12.553a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 11-.99-3.467l2.31-.66A2.25 2.25 0 0019.5 14.803V5.25L9 8.25v7.303a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 01-.99-3.467l2.31-.66A2.25 2.25 0 009 12.553V9z" />
            </svg>
            <span className="text-white/60 text-[11px] truncate">{nowPlaying.track.title}</span>
          </div>
        )}
      </div>

      {/* ── Hidden audio renderer ─────────────────────────────────────── */}
      <div className="hidden">
        {audioTracks.map((trackRef) => (
          <AudioTrack key={trackRef.publication.trackSid} trackRef={trackRef} />
        ))}
      </div>

      {/* ── Controls Bar ──────────────────────────────────────────────── */}
      <div
        className={`flex items-center justify-center gap-3 py-3 px-4 transition-opacity duration-300 ${
          isFullscreen ? "absolute bottom-0 left-0 right-0 z-[60] bg-gradient-to-t from-black/80 to-transparent pb-6 pt-10" : "relative z-30"
        }`}
        style={{
          opacity: isFullscreen && !controlsVisible ? 0 : 1,
          pointerEvents: isFullscreen && !controlsVisible ? "none" : "auto",
        }}
      >
        {/* Go On Stage / listener indicator */}
        {!inCall && (
          <button
            onClick={onGoOnStage}
            className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-pnp-accent/20 border border-pnp-accent/40 text-pnp-accent text-xs font-semibold transition-all active:scale-95"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            </svg>
            Go On Stage
          </button>
        )}

        {/* Mic — permanently muted, non-interactive */}
        {canPublish && (
          <div
            title="Microphone is disabled on the main stage"
            aria-label="Microphone permanently muted"
            className="relative w-11 h-11 rounded-full flex items-center justify-center bg-red-500/20 border border-red-500/40 text-red-400 cursor-not-allowed opacity-80 select-none"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
            </svg>
            <svg className="absolute -bottom-0.5 -right-0.5 w-3 h-3 text-white/70 bg-black/60 rounded-full p-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
            </svg>
          </div>
        )}

        {/* Camera — permanently on, non-interactive */}
        {canPublish && (
          <div
            title="Camera is required on the main stage"
            aria-label="Camera permanently on"
            className="relative w-11 h-11 rounded-full flex items-center justify-center bg-white/10 border border-white/20 text-white cursor-not-allowed opacity-80 select-none"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            <svg className="absolute -bottom-0.5 -right-0.5 w-3 h-3 text-white/70 bg-black/60 rounded-full p-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
            </svg>
          </div>
        )}

        {/* Fullscreen */}
        <button
          onClick={toggleFullscreen}
          className="w-11 h-11 rounded-full flex items-center justify-center bg-white/10 border border-white/20 text-white transition-all active:scale-90"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            {isFullscreen ? (
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
            )}
          </svg>
        </button>

        {/* Leave (only shown when in full call mode) */}
        {inCall && (
          <button
            onClick={onLeave}
            className="w-11 h-11 rounded-full flex items-center justify-center bg-red-500/80 text-white transition-all active:scale-90"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Stage Mode Badge ────────────────────────────────────────────────────────

function StageBadge({ mode }: { mode: string }) {
  if (mode === "dj-live") {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-500/30 backdrop-blur-sm border border-red-500/50 text-red-300 text-xs font-bold uppercase tracking-wider">
        <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
        DJ LIVE
      </span>
    );
  }
  if (mode === "community") {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-green-500/30 backdrop-blur-sm border border-green-500/50 text-green-300 text-xs font-bold uppercase tracking-wider">
        <span className="w-2 h-2 bg-green-400 rounded-full" />
        Community
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 backdrop-blur-sm border border-white/20 text-white/80 text-xs font-bold uppercase tracking-wider">
      <span className="w-2 h-2 bg-pnp-accent rounded-full" />
      Ambient
    </span>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function MainStage() {
  const { user, isAuthenticated } = useAuth();
  const { isPrime, isMember, isFree, isAdmin } = useTier();

  // Occupancy
  const [occupancy, setOccupancy] = useState(0);
  const [occupancyUsers, setOccupancyUsers] = useState<
    Array<{ userId: string; displayName: string; role: string; tier?: string; avatarUrl?: string; joinedAt: string }>
  >([]);

  // Stage state
  const [stageState, setStageState] = useState<StageState | null>(null);
  const [stageModeLoading, setStageModeLoading] = useState(false);

  // Call state
  const [mainGroup, setMainGroup] = useState<HangoutGroup | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [callToken, setCallToken] = useState<string | null>(null);
  const [callRoomName, setCallRoomName] = useState<string | null>(null);
  const [callLivekitUrl, setCallLivekitUrl] = useState("wss://livekit.pnptv.app");
  // inCall = user has actively joined as publisher; token presence = ambient listener connected
  const [inCall, setInCall] = useState(false);
  const [callError, setCallError] = useState<string | null>(null);
  const autoConnectedRef = useRef(false);

  // Knock
  const [knockStatus, setKnockStatus] = useState<"idle" | "pending" | "approved" | "denied">("idle");
  const [knockSending, setKnockSending] = useState(false);
  const [knockQueue, setKnockQueue] = useState<Array<{ userId: string; displayName: string }>>([]);

  // Clip

  // Now playing
  const [nowPlaying, setNowPlaying] = useState<NowPlaying | null>(null);

  // CMS prime videos
  const [primeVideos, setPrimeVideos] = useState<PrimeVideo[]>([]);

  // Layout — persisted in localStorage
  const [layout, setLayout] = useState<StageLayout>(() => {
    try {
      const saved = localStorage.getItem("mainstage:layout");
      if (saved === "video" || saved === "spotlight" || saved === "grid") return saved;
    } catch {}
    return "video";
  });

  const handleLayoutChange = useCallback((l: StageLayout) => {
    setLayout(l);
    try { localStorage.setItem("mainstage:layout", l); } catch {}
  }, []);

  // Wellness tips
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
    "Harm reduction is love in action. Test your substances, know your limits, look out for each other.",
    "Joy is resistance. Let yourself laugh, dance, be silly \u2014 the world needs your light.",
    "Loneliness is temporary. Connection is a phone call, a message, a knock away.",
    "Sunlight does wonders. Even 10 minutes outside can shift your whole mood.",
    "You showed up today \u2014 that counts. Give yourself credit for being here.",
    "Sleep isn\u2019t optional, love. Your brain heals and resets while you rest.",
    "Unclench your jaw. Drop your shoulders. You were holding tension \u2014 now let it go.",
    "Asking for help is brave, not weak. Reach out if you need to \u2014 we\u2019ve got you.",
    "Move your body in a way that feels good \u2014 dance, walk, stretch. No rules, just movement.",
    "You are worthy of love and connection exactly as you are. Don\u2019t let anyone tell you different.",
  ], []);
  const [tipIndex, setTipIndex] = useState(() => Math.floor(Math.random() * 20));
  const [tipFading, setTipFading] = useState(false);

  // ── Effects ───────────────────────────────────────────────────────

  // Wellness tip rotation
  useEffect(() => {
    const interval = setInterval(() => {
      setTipFading(true);
      setTimeout(() => {
        setTipIndex((prev) => (prev + 1) % wellnessTips.length);
        setTipFading(false);
      }, 400);
    }, 45000);
    return () => clearInterval(interval);
  }, [wellnessTips.length]);

  // Fetch occupancy, stage state, main group, now playing, prime videos
  useEffect(() => {
    const fetchOccupancy = () => {
      getCommunityRoomOccupancy()
        .then((res) => {
          setOccupancy(res.occupancy?.activeUsers ?? 0);
          setOccupancyUsers(res.occupancy?.users ?? []);
        })
        .catch(() => {});
    };
    fetchOccupancy();
    const occupancyInterval = setInterval(fetchOccupancy, 30000);

    getStageState()
      .then((res) => { if (res.stageState) setStageState(res.stageState); })
      .catch(() => {});

    getHangoutGroups()
      .then((res) => {
        const main = (res.groups || []).find((g: HangoutGroup) => g.isMain);
        if (main) setMainGroup(main);
      })
      .catch(() => {});

    // Now playing
    const fetchNP = () => {
      getRadioNowPlaying().then(setNowPlaying).catch(() => {});
    };
    fetchNP();
    const npInterval = setInterval(fetchNP, 15000);

    // CMS prime videos for background
    getFeaturedPrimeVideos(10).then(setPrimeVideos).catch(() => {});

    return () => { clearInterval(occupancyInterval); clearInterval(npInterval); };
  }, []);

  // Auto-connect as ambient listener once mainGroup resolves
  useEffect(() => {
    if (!mainGroup?.id || autoConnectedRef.current || !isAuthenticated) return;
    autoConnectedRef.current = true;

    const autoConnect = async () => {
      try {
        let result;
        try {
          result = await joinHangoutCall(mainGroup.id);
        } catch (joinErr: unknown) {
          const err = joinErr as { status?: number; message?: string };
          if (err?.status === 404 || err?.message?.includes("404")) {
            result = await startHangoutCall(mainGroup.id);
          } else throw joinErr;
        }
        setCallToken(result.token);
        setCallRoomName(result.roomName);
        setCallLivekitUrl(result.livekitUrl || "wss://livekit.pnptv.app");
        // Do NOT set inCall = true — user is listener-only until they click "Go On Stage"
      } catch {
        // Auto-connect failed — silent fallback to static hero UI
        autoConnectedRef.current = false;
      }
    };

    autoConnect();
  }, [mainGroup?.id, isAuthenticated]);

  // Socket events: hangout call + mainstage
  useEffect(() => {
    if (!mainGroup?.id) return;
    const socket = connectSocket();
    socket.emit("hangout:join", { groupId: mainGroup.id });
    socket.emit("mainstage:join");

    const onCallEnded = (data: { groupId: number }) => {
      if (data.groupId !== mainGroup.id) return;
      setInCall(false);
      setCallToken(null);
      setCallRoomName(null);
      autoConnectedRef.current = false;
    };

    socket.on("hangout:call:ended", onCallEnded);
    socket.on("mainstage:mode-changed", (data: { mode: string; master: StageState["master"] }) => {
      setStageState({ mode: data.mode as StageState["mode"], master: data.master });
    });
    socket.on("mainstage:knock:approved", () => setKnockStatus("approved"));
    socket.on("mainstage:knock:denied", () => setKnockStatus("denied"));
    socket.on("mainstage:knock:new", (data: { userId: string; displayName: string }) => {
      setKnockQueue((q) => q.some((k) => k.userId === data.userId) ? q : [...q, data]);
    });
    socket.on("mainstage:knock:resolved", (data: { targetUserId: string }) => {
      setKnockQueue((q) => q.filter((k) => k.userId !== data.targetUserId));
    });
    socket.on("mainstage:clip-dropped", (data: { displayName: string }) => {
      setError(`${data.displayName || "Someone"} dropped a clip!`);
      setTimeout(() => setError(""), 4000);
    });

    return () => {
      socket.off("hangout:call:ended", onCallEnded);
      socket.off("mainstage:mode-changed");
      socket.off("mainstage:knock:approved");
      socket.off("mainstage:knock:denied");
      socket.off("mainstage:knock:new");
      socket.off("mainstage:knock:resolved");
      socket.off("mainstage:clip-dropped");
    };
  }, [mainGroup?.id]);

  // ── Handlers ──────────────────────────────────────────────────────

  // "Go On Stage" — promote from listener to publisher
  const handleGoOnStage = async () => {
    if (!user || !mainGroup?.id || loading) return;
    if (callToken && callRoomName) {
      // Already connected as listener — just flip inCall flag
      setInCall(true);
      return;
    }
    // Fallback: obtain token if auto-connect failed
    try {
      setLoading(true);
      setCallError(null);
      let result;
      try {
        result = await joinHangoutCall(mainGroup.id);
      } catch (joinErr: unknown) {
        const err = joinErr as { status?: number; message?: string };
        if (err?.status === 404 || err?.message?.includes("404")) {
          result = await startHangoutCall(mainGroup.id);
        } else throw joinErr;
      }
      setCallToken(result.token);
      setCallRoomName(result.roomName);
      setCallLivekitUrl(result.livekitUrl || "wss://livekit.pnptv.app");
      setInCall(true);
    } catch {
      setCallError("Could not connect. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // Legacy "Join Call" used by the pre-connect hero card when auto-connect failed
  const handleJoin = handleGoOnStage;

  const handleLeave = () => {
    const socket = getSocket();
    if (socket) {
      socket.emit("mainstage:leave");
      if (mainGroup?.id) socket.emit("hangout:leave", { groupId: mainGroup.id });
    }
    setInCall(false);
    setCallToken(null);
    setCallRoomName(null);
    setKnockStatus("idle");
    setKnockQueue([]);
    autoConnectedRef.current = false;
    getCommunityRoomOccupancy()
      .then((res) => {
        setOccupancy(res.occupancy?.activeUsers ?? 0);
        setOccupancyUsers(res.occupancy?.users ?? []);
      })
      .catch(() => {});
  };

  const handleKnock = async () => {
    if (knockSending || knockStatus === "pending") return;
    setKnockSending(true);
    try { await knockToSpeak(); setKnockStatus("pending"); }
    catch { setError("Could not send knock request."); setTimeout(() => setError(""), 3000); }
    finally { setKnockSending(false); }
  };

  const stageMode = stageState?.mode || "ambient";
  const hasLiveKitToken = !!(callToken && callRoomName);

  // ── Render ────────────────────────────────────────────────────────

  return (
    <div className="pb-24 max-w-2xl mx-auto space-y-4">
      <Helmet><title>Main Stage | PNPtv</title></Helmet>

      {/* ─── Stage Area ──────────────────────────────────────────── */}
      <div className="overflow-hidden">
        {hasLiveKitToken ? (
          <LiveKitRoom
            token={callToken!}
            serverUrl={callLivekitUrl}
            connect={true}
            audio={false}
            video={false}
            onDisconnected={handleLeave}
            style={{ display: "contents" }}
          >
            <RoomAudioRenderer />
            <StageRoom
              onLeave={handleLeave}
              stageMode={stageMode}
              isAdmin={isAdmin}
              isPrime={isPrime}
              isMember={isMember}
              inCall={inCall}
              onGoOnStage={handleGoOnStage}
              layout={layout}
              onLayoutChange={handleLayoutChange}
              primeVideos={primeVideos}
              nowPlaying={nowPlaying}
              wellnessTip={wellnessTips[tipIndex]}
            />
          </LiveKitRoom>
        ) : (
          /* ── Pre-join Hero (shown while auto-connecting or if auth needed) ── */
          <Card className="overflow-hidden">
            <div
              className="relative w-full aspect-video flex flex-col items-center justify-center overflow-hidden"
              style={{
                background: stageMode === "dj-live"
                  ? "linear-gradient(135deg, #1C1C1E 0%, #2C0A18 40%, #5C0A28 70%, #1C1C1E 100%)"
                  : stageMode === "community"
                  ? "linear-gradient(135deg, #1C1C1E 0%, #0A2E1A 40%, #0D3D24 70%, #1C1C1E 100%)"
                  : "linear-gradient(135deg, #1C1C1E 0%, #0D2030 40%, #0D2A30 70%, #1C1C1E 100%)",
                backgroundSize: "300% 300%",
                animation: "stageGradient 8s ease infinite",
              }}
            >
              {/* Scanlines + grid overlays */}
              <div className="absolute inset-0 opacity-10" style={{ backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,0.03) 2px, rgba(255,255,255,0.03) 4px)" }} />
              <div className="absolute inset-0 opacity-5" style={{ backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.3) 1px, transparent 1px)", backgroundSize: "20px 20px" }} />

              {/* Mode badge */}
              <div className="absolute top-3 left-3 z-10">
                <StageBadge mode={stageMode} />
              </div>

              {/* LIVE indicator */}
              {occupancy > 0 && (
                <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/40 backdrop-blur-sm border border-white/10">
                  <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                  <span className="text-white text-xs font-semibold">{occupancy} LIVE</span>
                </div>
              )}

              {/* Center content */}
              <div className="relative z-10 flex flex-col items-center gap-3 px-4">
                {isAuthenticated ? (
                  <div className="flex items-center gap-3 text-pnp-textSecondary">
                    <div className="w-5 h-5 border-2 border-pnp-accent/40 border-t-pnp-accent rounded-full animate-spin" />
                    <span className="text-white/60 text-sm">Connecting to stage...</span>
                  </div>
                ) : occupancyUsers.length > 0 ? (
                  <>
                    <div className="flex items-center -space-x-3">
                      {occupancyUsers.slice(0, 6).map((u, i) => (
                        <div key={u.userId} className="relative w-12 h-12 rounded-full border-2 border-black/60 overflow-hidden shadow-lg" style={{ zIndex: 6 - i }}>
                          {u.avatarUrl ? (
                            <img src={u.avatarUrl} alt={u.displayName} className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; (e.target as HTMLImageElement).nextElementSibling?.classList.remove("hidden"); }} />
                          ) : null}
                          <div className={`${u.avatarUrl ? "hidden" : ""} w-full h-full flex items-center justify-center bg-pnp-accent/40 text-white font-bold text-sm`}>
                            {u.displayName.charAt(0).toUpperCase()}
                          </div>
                        </div>
                      ))}
                      {occupancyUsers.length > 6 && (
                        <div className="relative w-12 h-12 rounded-full border-2 border-black/60 bg-black/50 backdrop-blur flex items-center justify-center shadow-lg" style={{ zIndex: 0 }}>
                          <span className="text-white text-xs font-bold">+{occupancyUsers.length - 6}</span>
                        </div>
                      )}
                    </div>
                    <p className="text-white/90 text-sm font-medium drop-shadow-lg">
                      {occupancyUsers.slice(0, 3).map((u) => u.displayName).join(", ")}
                      {occupancyUsers.length > 3 ? ` and ${occupancyUsers.length - 3} more` : ""}
                    </p>
                  </>
                ) : (
                  <>
                    <div className="relative">
                      <div className="w-20 h-20 rounded-full flex items-center justify-center bg-white/10 backdrop-blur-sm border border-white/20">
                        <svg className="w-9 h-9 text-white/70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 11-.99-3.467l2.31-.66a2.25 2.25 0 001.632-2.163zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 01-.99-3.467l2.31-.66A2.25 2.25 0 009 15.553z" />
                        </svg>
                      </div>
                      <div className="absolute inset-[-8px] rounded-full border border-white/8 animate-ping" style={{ animationDuration: "3s" }} />
                      <div className="absolute inset-[-16px] rounded-full border border-white/5 animate-ping" style={{ animationDuration: "3s", animationDelay: "0.5s" }} />
                    </div>
                    <p className="text-white/60 text-sm">Cristina is playing {stageMode === "dj-live" ? "DJ" : stageMode} vibes</p>
                  </>
                )}
              </div>

              {/* Now Playing strip */}
              {nowPlaying?.track && (
                <div className="absolute bottom-0 left-0 right-0 z-10 flex items-center gap-2 px-4 py-2.5 bg-gradient-to-t from-black/80 to-transparent">
                  <svg className="w-3.5 h-3.5 text-pnp-accent shrink-0" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M9 9l10.5-3v12.553a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 11-.99-3.467l2.31-.66A2.25 2.25 0 0019.5 14.803V5.25L9 8.25v7.303a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 01-.99-3.467l2.31-.66A2.25 2.25 0 009 12.553V9z" />
                  </svg>
                  <span className="text-white/60 text-[11px] truncate">{nowPlaying.track.title}</span>
                </div>
              )}
            </div>

            {/* Info + join button */}
            <div className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h1 className="text-lg font-bold text-pnp-textPrimary">Main Stage</h1>
                  <p className="text-pnp-textSecondary text-xs mt-0.5">24/7 community hangout with LiveKit</p>
                </div>
                {isAdmin ? (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-pnp-accent/15 text-pnp-accent text-xs font-semibold">Mod</span>
                ) : isPrime ? (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-yellow-500/15 text-yellow-400 text-xs font-semibold">Prime</span>
                ) : isMember ? (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-blue-500/15 text-blue-400 text-xs font-semibold">Member</span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-white/5 text-pnp-textSecondary text-xs font-semibold">View Only</span>
                )}
              </div>

              <div className="flex flex-wrap gap-1.5">
                {(isAdmin || isPrime) && (
                  <>
                    <span className="px-2 py-0.5 rounded bg-white/5 text-pnp-textSecondary text-[11px]">Camera</span>
                    <span className="px-2 py-0.5 rounded bg-white/5 text-pnp-textSecondary text-[11px]">Mic</span>
                    <span className="px-2 py-0.5 rounded bg-white/5 text-pnp-textSecondary text-[11px]">Screen</span>
                  </>
                )}
                {isMember && !isPrime && !isAdmin && (
                  <span className="px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 text-[11px]">Knock to speak</span>
                )}
                {isFree && (
                  <span className="px-2 py-0.5 rounded bg-white/5 text-pnp-textSecondary text-[11px]">Watch & listen</span>
                )}
                <span className="px-2 py-0.5 rounded bg-white/5 text-pnp-textSecondary text-[11px]">Encrypted</span>
                <span className="px-2 py-0.5 rounded bg-white/5 text-pnp-textSecondary text-[11px]">24/7</span>
              </div>

              {error && (
                <p className="text-sm bg-red-950/30 border border-red-900/50 rounded-lg px-3 py-2 text-red-400">{error}</p>
              )}
              {callError && (
                <p className="text-sm bg-red-950/30 border border-red-900/50 rounded-lg px-3 py-2 text-red-400">{callError}</p>
              )}

              {isAuthenticated ? (
                <Button onClick={handleJoin} disabled={loading} className="w-full">
                  {loading ? "Connecting..." : "Connect to Stage"}
                </Button>
              ) : (
                <p className="text-pnp-textSecondary text-sm text-center py-2">Please log in to join the room.</p>
              )}
            </div>
          </Card>
        )}
      </div>

      {/* ─── Cristina Wellness Tip ─────────────────────────────────── */}
      <div
        className="rounded-2xl border border-white/8 overflow-hidden"
        style={{ background: "linear-gradient(135deg, rgba(123,97,255,0.08) 0%, rgba(212,0,122,0.06) 100%)" }}
      >
        <div className="px-4 py-3 flex items-start gap-3">
          <div className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-white" style={{ background: "linear-gradient(135deg, #7B61FF, #D4007A)" }}>
            C
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-xs font-semibold text-white/90">Cristina</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/8 text-white/40 font-medium">wellness</span>
            </div>
            <p className="text-sm text-white/70 leading-relaxed transition-opacity duration-400" style={{ opacity: tipFading ? 0 : 1 }}>
              {wellnessTips[tipIndex]}
            </p>
          </div>
        </div>
      </div>

      {/* ─── Knock to Speak (connected, member only) ────────────────── */}
      {hasLiveKitToken && isMember && !isPrime && !isAdmin && (
        <Card className="p-4 space-y-2">
          {knockStatus === "idle" && (
            <button
              onClick={handleKnock}
              disabled={knockSending}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold text-blue-400 transition-all active:scale-95 disabled:opacity-50"
              style={{ background: "rgba(59,130,246,0.1)", border: "1px solid rgba(59,130,246,0.2)" }}
            >
              {knockSending ? "Sending..." : "Knock to Speak"}
            </button>
          )}
          {knockStatus === "pending" && (
            <div className="flex items-center gap-2 py-2 text-yellow-400 text-sm">
              <div className="w-4 h-4 border-2 border-yellow-400/30 border-t-yellow-400 rounded-full animate-spin" />
              Waiting for a moderator...
            </div>
          )}
          {knockStatus === "approved" && (
            <div className="flex items-center gap-2 py-2 text-green-400 text-sm font-semibold">You can speak now!</div>
          )}
          {knockStatus === "denied" && (
            <div className="flex items-center gap-2 py-2 text-red-400 text-sm">Request denied</div>
          )}
        </Card>
      )}

      {/* ─── Admin: Knock Queue ───────────────────────────────────── */}
      {isAdmin && knockQueue.length > 0 && (
        <Card className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-pnp-textPrimary">Knock Requests</h3>
            <span className="text-[10px] px-2 py-0.5 rounded-full font-bold" style={{ background: "rgba(255,180,84,0.15)", color: "#FFB454" }}>
              {knockQueue.length}
            </span>
          </div>
          <div className="space-y-2">
            {knockQueue.map((k) => (
              <div key={k.userId} className="flex items-center justify-between p-2 rounded-lg bg-white/5">
                <span className="text-sm text-white font-medium">{k.displayName}</span>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => approveKnock(k.userId).catch(() => {})}
                    className="px-3 py-1 rounded-lg text-xs font-semibold text-green-400 transition-all active:scale-95"
                    style={{ background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.2)" }}
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => denyKnock(k.userId).catch(() => {})}
                    className="px-3 py-1 rounded-lg text-xs font-semibold text-red-400 transition-all active:scale-95"
                    style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)" }}
                  >
                    Deny
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ─── Admin: Stage Control ─────────────────────────────────── */}
      {isAdmin && (
        <Card className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-pnp-textPrimary">Stage Control</h3>
            <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wide" style={{ background: "rgba(212,0,122,0.12)", color: "#D4007A" }}>Admin</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {([
              { mode: "ambient" as const, label: "Ambient", desc: "Chill vibes" },
              { mode: "community" as const, label: "Community", desc: "Open hangout" },
              { mode: "dj-live" as const, label: "DJ Live", desc: "Live set" },
            ]).map(({ mode, label, desc }) => {
              const isActive = stageState?.mode === mode;
              return (
                <button
                  key={mode}
                  disabled={stageModeLoading || isActive}
                  onClick={async () => {
                    setStageModeLoading(true);
                    try { await apiSetStageMode(mode); setStageState((s) => s ? { ...s, mode } : { mode, master: null }); }
                    catch {} finally { setStageModeLoading(false); }
                  }}
                  className={`flex flex-col items-center gap-1 p-3 rounded-xl border transition-all active:scale-95 disabled:opacity-60 disabled:cursor-default ${
                    isActive ? "border-pnp-accent/50 bg-pnp-accent/10" : "border-white/10 bg-white/5"
                  }`}
                >
                  <span className={`text-xs font-semibold ${isActive ? "text-pnp-accent" : "text-pnp-textPrimary"}`}>{label}</span>
                  <span className="text-[10px] text-pnp-textSecondary">{desc}</span>
                </button>
              );
            })}
          </div>
        </Card>
      )}

      {/* ─── Who's Inside ─────────────────────────────────────────── */}
      {occupancyUsers.length > 0 && (
        <Card className="p-4 space-y-3">
          <h2 className="text-xs font-semibold text-pnp-textSecondary uppercase tracking-wide">Currently Inside</h2>
          <div className="space-y-1.5">
            {occupancyUsers.map((u) => (
              <div key={u.userId} className="flex items-center gap-3 p-1.5 rounded-lg">
                <div className="relative w-8 h-8 rounded-full overflow-hidden shrink-0 border border-white/10">
                  {u.avatarUrl ? (
                    <img src={u.avatarUrl} alt={u.displayName} className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; (e.target as HTMLImageElement).nextElementSibling?.classList.remove("hidden"); }} />
                  ) : null}
                  <div className={`${u.avatarUrl ? "hidden" : ""} w-full h-full flex items-center justify-center bg-pnp-accent/30 text-white font-bold text-xs`}>
                    {u.displayName.charAt(0).toUpperCase()}
                  </div>
                  <span className="absolute bottom-0 right-0 w-2 h-2 bg-green-500 rounded-full border border-pnp-surface" />
                </div>
                <span className="text-pnp-textPrimary text-sm font-medium truncate flex-1">{u.displayName}</span>
                {u.role === "moderator" && <span className="text-[10px] text-pnp-accent bg-pnp-accent/10 px-1.5 py-0.5 rounded-full">mod</span>}
                {u.tier === "prime" && u.role !== "moderator" && <span className="text-[10px] text-yellow-400 bg-yellow-400/10 px-1.5 py-0.5 rounded-full">prime</span>}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ─── Upcoming Events ──────────────────────────────────────── */}
      <UpcomingEvents type="hangout_event" limit={3} title="Upcoming Hangout Events" />

      {/* ─── Stage Rules ──────────────────────────────────────────── */}
      <Card className="p-5 space-y-3">
        <h3 className="font-semibold text-pnp-textPrimary text-sm">Stage Rules</h3>
        <ul className="text-pnp-textSecondary text-sm space-y-2">
          <li className="flex items-start gap-2.5"><span className="mt-0.5 shrink-0 text-xs">E2E</span><span>End-to-end encrypted — your privacy is protected</span></li>
          <li className="flex items-start gap-2.5"><span className="mt-0.5 shrink-0 text-xs">NR</span><span>No recording — what happens on the Stage stays here</span></li>
          <li className="flex items-start gap-2.5"><span className="mt-0.5 shrink-0 text-xs">HR</span><span>Be respectful — hate speech gets you removed immediately</span></li>
          <li className="flex items-start gap-2.5"><span className="mt-0.5 shrink-0 text-xs">AW</span><span>All are welcome — safe space for the PNP community</span></li>
          <li className="flex items-start gap-2.5"><span className="mt-0.5 shrink-0 text-xs">24/7</span><span>Open around the clock — the door is always unlocked</span></li>
        </ul>
      </Card>
    </div>
  );
}
