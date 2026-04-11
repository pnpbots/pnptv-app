import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  LiveKitRoom,
  useRoomContext,
  useTracks,
  useParticipants,
  AudioTrack,
  VideoTrack,
} from "@livekit/components-react";
import { Track, RoomEvent, Participant } from "livekit-client";
import { getFeaturedPrimeVideos, getLowResAssetUrl, type PrimeVideo } from "@/lib/directus";

// ── Types ────────────────────────────────────────────────────────────────────

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

interface MediaDevice {
  deviceId: string;
  label: string;
}

// ── Inner component that renders inside LiveKitRoom context ──────────────────

function CallContent({
  onClose,
  startedBy,
  durationLabel,
  onReconnectingEvent,
}: {
  onClose: () => void;
  startedBy: string | null;
  durationLabel: string;
  onReconnectingEvent?: () => void;
}) {
  const room = useRoomContext();
  const participants = useParticipants();

  // Track sources
  const allTracks = useTracks(
    [Track.Source.Camera, Track.Source.Microphone],
    { onlySubscribed: false }
  );
  const audioTracks = allTracks.filter((t) => t.source === Track.Source.Microphone);
  const videoTracks = allTracks.filter((t) => t.source === Track.Source.Camera);

  // Core state — join muted by default, cam always on
  const [muted, setMuted] = useState(true);
  const [camOff, setCamOff] = useState(false);
  const [connected, setConnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [callEnded, setCallEnded] = useState(false);
  const [permissionError, setPermissionError] = useState<"camera" | "microphone" | null>(null);
  const [activeSpeakerId, setActiveSpeakerId] = useState<string | null>(null);

  // CMS clip state
  const [featuredVideos, setFeaturedVideos] = useState<PrimeVideo[]>([]);
  const [clipIndex, setClipIndex] = useState(0);

  // Grid layout
  type GridLayout = "auto" | "focus" | "stack" | "cinema";
  const [gridLayout, setGridLayout] = useState<GridLayout>("auto");

  // UI panels
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Auto-hide controls in fullscreen
  const [controlsVisible, setControlsVisible] = useState(true);
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Settings — devices
  const [videoInputs, setVideoInputs] = useState<MediaDevice[]>([]);
  const [audioInputs, setAudioInputs] = useState<MediaDevice[]>([]);
  const [audioOutputs, setAudioOutputs] = useState<MediaDevice[]>([]);
  const [selectedVideoInput, setSelectedVideoInput] = useState("");
  const [selectedAudioInput, setSelectedAudioInput] = useState("");
  const [selectedAudioOutput, setSelectedAudioOutput] = useState("");

  // Panel ref for fullscreen
  const panelRef = useRef<HTMLDivElement>(null);

  // ── Room connection events ────────────────────────────────────────────────

  useEffect(() => {
    if (!room) return;

    const onConnected = () => {
      setConnected(true);
      setReconnecting(false);
      setCallEnded(false);
      // Join muted by default
      room.localParticipant.setMicrophoneEnabled(false).catch(() => {});
    };
    const onDisconnected = () => {
      setConnected(false);
      // If room is still in reconnecting state, show overlay; otherwise treat as call ended
      if (room.state === "reconnecting") {
        setReconnecting(true);
      } else {
        setReconnecting(false);
        setCallEnded(true);
      }
    };
    const onReconnecting = () => {
      setReconnecting(true);
      setConnected(false);
      onReconnectingEvent?.();
    };
    const onReconnected = () => {
      setReconnecting(false);
      setConnected(true);
    };

    const onActiveSpeaker = (speakers: Participant[]) => {
      const top = speakers.find((s) => !s.isLocal);
      setActiveSpeakerId(top ? top.identity : null);
    };

    room.on(RoomEvent.Connected, onConnected);
    room.on(RoomEvent.Disconnected, onDisconnected);
    room.on(RoomEvent.Reconnecting, onReconnecting);
    room.on(RoomEvent.Reconnected, onReconnected);
    room.on(RoomEvent.ActiveSpeakersChanged, onActiveSpeaker);

    if (room.state === "connected") {
      setConnected(true);
      room.localParticipant.setMicrophoneEnabled(false).catch(() => {});
    }

    return () => {
      room.off(RoomEvent.Connected, onConnected);
      room.off(RoomEvent.Disconnected, onDisconnected);
      room.off(RoomEvent.Reconnecting, onReconnecting);
      room.off(RoomEvent.Reconnected, onReconnected);
      room.off(RoomEvent.ActiveSpeakersChanged, onActiveSpeaker);
    };
  }, [room, onReconnectingEvent]);

  // ── Fetch CMS clips ──────────────────────────────────────────────────────

  useEffect(() => {
    getFeaturedPrimeVideos(10).then((vids) => {
      const withFile = vids.filter((v) => v.video_file);
      setFeaturedVideos(withFile);
    });
  }, []);

  // ── Fullscreen API ────────────────────────────────────────────────────────

  useEffect(() => {
    const onChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("webkitfullscreenchange", onChange);
    };
  }, []);

  // Prevent body scroll when panel is open
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  const toggleFullscreen = useCallback(async () => {
    const el = panelRef.current;
    if (!el) return;
    try {
      if (!document.fullscreenElement) {
        if (el.requestFullscreen) {
          await el.requestFullscreen();
        } else if ((el as any).webkitRequestFullscreen) {
          (el as any).webkitRequestFullscreen();
        }
      } else {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        } else if ((document as any).webkitExitFullscreen) {
          (document as any).webkitExitFullscreen();
        }
      }
    } catch {
      // Browser may deny fullscreen outside a user gesture — ignore
    }
  }, []);

  // Auto-hide controls overlay in fullscreen after 3s of no interaction
  const resetControlsTimer = useCallback(() => {
    setControlsVisible(true);
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    if (isFullscreen) {
      controlsTimerRef.current = setTimeout(() => setControlsVisible(false), 3000);
    }
  }, [isFullscreen]);

  useEffect(() => {
    if (isFullscreen) {
      resetControlsTimer();
    } else {
      setControlsVisible(true);
      if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    }
    return () => {
      if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    };
  }, [isFullscreen, resetControlsTimer]);

  // ── Controls ──────────────────────────────────────────────────────────────

  const toggleMute = async () => {
    try {
      await room.localParticipant.setMicrophoneEnabled(muted);
      setMuted(!muted);
      setPermissionError(null);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        setPermissionError("microphone");
      }
    }
  };

  const toggleCam = async () => {
    try {
      await room.localParticipant.setCameraEnabled(camOff);
      setCamOff(!camOff);
      setPermissionError(null);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        setPermissionError("camera");
      }
    }
  };

  // ── Settings / Device enumeration ─────────────────────────────────────────

  const enumerateDevices = useCallback(async () => {
    try {
      // Request permission so labels are populated
      await navigator.mediaDevices.getUserMedia({ audio: true, video: true }).catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "NotAllowedError") {
          setPermissionError("camera");
        }
      });
      const devices = await navigator.mediaDevices.enumerateDevices();
      const labelOrId = (d: MediaDeviceInfo) => d.label || d.deviceId;

      setVideoInputs(
        devices
          .filter((d) => d.kind === "videoinput")
          .map((d) => ({ deviceId: d.deviceId, label: labelOrId(d) }))
      );
      setAudioInputs(
        devices
          .filter((d) => d.kind === "audioinput")
          .map((d) => ({ deviceId: d.deviceId, label: labelOrId(d) }))
      );
      setAudioOutputs(
        devices
          .filter((d) => d.kind === "audiooutput")
          .map((d) => ({ deviceId: d.deviceId, label: labelOrId(d) }))
      );
    } catch {}
  }, []);

  const openSettings = useCallback(() => {
    enumerateDevices();
    setSettingsOpen(true);
  }, [enumerateDevices]);

  const switchDevice = useCallback(
    async (kind: "videoinput" | "audioinput" | "audiooutput", deviceId: string) => {
      try {
        await room.switchActiveDevice(kind, deviceId);
        if (kind === "videoinput") setSelectedVideoInput(deviceId);
        if (kind === "audioinput") setSelectedAudioInput(deviceId);
        if (kind === "audiooutput") setSelectedAudioOutput(deviceId);
      } catch {}
    },
    [room]
  );

  // ── Derived participants ───────────────────────────────────────────────────

  const cristina = participants.find((p) => p.identity === "cristina-ai");
  const others = participants.filter(
    (p) => p.identity !== "cristina-ai" && !p.isLocal
  );
  const totalPeople = others.length + 1;

  // Filter cristina-ai's black video track out — replaced by CristinaClipTile
  const userVideoTracks = videoTracks.filter(
    (t) => t.participant.identity !== "cristina-ai"
  );
  const showCristinaTile = cristina || featuredVideos.length > 0;

  const cycleLayout = useCallback(() => {
    setGridLayout((l) => {
      const order: GridLayout[] = ["auto", "focus", "stack", "cinema"];
      return order[(order.indexOf(l) + 1) % order.length];
    });
  }, []);

  // ── Helpers ───────────────────────────────────────────────────────────────

  const isMicMuted = (participantIdentity: string) => {
    const p = participants.find((x) => x.identity === participantIdentity);
    if (!p) return false;
    const micPub = p.getTrackPublication(Track.Source.Microphone);
    return !micPub || micPub.isMuted;
  };

  // ── Shared style helpers ──────────────────────────────────────────────────

  const btnBase =
    "flex flex-col items-center justify-center gap-1 rounded-2xl transition-all active:scale-95 select-none";
  const btnSizeMobile = "min-w-[52px] min-h-[52px] p-2";
  const btnLabel = "text-[9px] font-medium text-white/50 leading-none";

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      ref={panelRef}
      className="flex flex-col w-full h-full"
      style={{
        background: "linear-gradient(180deg, #12141C 0%, #0A0C14 100%)",
        borderColor: "rgba(123,97,255,0.2)",
        boxShadow: "0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(123,97,255,0.1)",
      }}
      onMouseMove={resetControlsTimer}
      onTouchStart={resetControlsTimer}
      onClick={() => isFullscreen && resetControlsTimer()}
    >
      {/* ── Permission denied banner ── */}
      {permissionError && (
        <div
          className="flex items-center justify-between gap-3 px-4 py-2.5 flex-shrink-0 z-30"
          style={{
            background: "rgba(255,59,48,0.15)",
            borderBottom: "1px solid rgba(255,59,48,0.30)",
            paddingTop: "calc(0.625rem + env(safe-area-inset-top, 0px))",
          }}
          role="alert"
        >
          <span className="text-xs text-red-300 font-medium">
            {permissionError === "camera"
              ? "Camera access denied — enable in browser settings"
              : "Microphone access denied — enable in browser settings"}
          </span>
          <button
            type="button"
            onClick={() => permissionError === "camera" ? toggleCam() : toggleMute()}
            className="flex-shrink-0 px-3 min-h-[32px] rounded-lg text-xs font-semibold text-white bg-red-500/30 border border-red-500/50 hover:bg-red-500/50 transition-colors"
            aria-label={`Retry ${permissionError} access`}
          >
            Retry
          </button>
        </div>
      )}

      {/* ── Reconnecting overlay ── */}
      {reconnecting && (
        <div
          className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black/75 backdrop-blur-sm"
          aria-live="assertive"
          aria-label="Reconnecting to call"
        >
          <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin" />
          <span className="text-white text-sm font-medium">Reconnecting...</span>
        </div>
      )}

      {/* ── Call ended state ── */}
      {callEnded && !reconnecting && (
        <div
          className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-black/80 backdrop-blur-sm"
          aria-live="assertive"
        >
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center"
            style={{ background: "rgba(255,59,48,0.18)" }}
          >
            <svg className="w-7 h-7 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16 8l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M5 3a2 2 0 00-2 2v1c0 8.284 6.716 15 15 15h1a2 2 0 002-2v-3.28a1 1 0 00-.684-.948l-4.493-1.498a1 1 0 00-1.21.502l-1.13 2.257a11.042 11.042 0 01-5.516-5.517l2.257-1.128a1 1 0 00.502-1.21L9.228 3.683A1 1 0 008.279 3H5z" />
            </svg>
          </div>
          <p className="text-white text-base font-semibold">Call ended</p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => { setCallEnded(false); onClose(); }}
              className="px-4 min-h-[44px] rounded-xl text-sm font-medium text-white/70 bg-white/10 border border-white/15 hover:bg-white/15 transition-colors"
              aria-label="Close call dock"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* ── Header ── */}
      <div
        className="flex items-center justify-between px-4 py-3 flex-shrink-0"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
      >
        <div className="flex items-center gap-2.5">
          <div className="relative">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center"
              style={{ background: "linear-gradient(135deg, #D4007A, #7B61FF)" }}
            >
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
            </div>
            {connected && (
              <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-green-500 ring-2 ring-[#12141C]" />
            )}
          </div>
          <div>
            <p className="text-sm font-semibold text-white leading-tight">Main Stage</p>
            <p className="text-[10px] text-white/40 leading-tight">
              {connected ? `${totalPeople} in the room · ${durationLabel}` : "Connecting..."}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {/* Layout toggle */}
          <button
            onClick={cycleLayout}
            className="w-7 h-7 rounded-full flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 transition-all"
            title={`Layout: ${gridLayout}`}
            aria-label={`Video layout, currently ${gridLayout}`}
          >
            {gridLayout === "auto" && (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
              </svg>
            )}
            {gridLayout === "focus" && (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 4h18v12H3V4zM5 19h2M9 19h2M13 19h2M17 19h2" />
              </svg>
            )}
            {gridLayout === "stack" && (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            )}
            {gridLayout === "cinema" && (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7 4v16M17 4v16M3 8h4M17 8h4M3 12h18M3 16h4M17 16h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" />
              </svg>
            )}
          </button>
          {/* Close */}
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-full flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 transition-all"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* ── Video grid area (flex-1 to fill available space) ── */}
      <div className="relative flex-1 overflow-hidden">
        <div className="absolute inset-0 overflow-y-auto p-2">

          {/* ── AUTO layout ── */}
          {gridLayout === "auto" && (
            <div
              className={`grid gap-1.5 ${
                (showCristinaTile ? 1 : 0) + userVideoTracks.length <= 1
                  ? "grid-cols-1"
                  : "grid-cols-1 sm:grid-cols-2"
              }`}
            >
              {showCristinaTile && (
                <CristinaClipTile
                  featuredVideos={featuredVideos}
                  clipIndex={clipIndex}
                  onClipEnded={() => setClipIndex((i) => (i + 1) % Math.max(featuredVideos.length, 1))}
                />
              )}
              {userVideoTracks.map((trackRef) => (
                <VideoTile
                  key={trackRef.publication.trackSid}
                  trackRef={trackRef}
                  isActiveSpeaker={activeSpeakerId === trackRef.participant.identity}
                  isMuted={isMicMuted(trackRef.participant.identity)}
                  compact={false}
                />
              ))}
            </div>
          )}

          {/* ── FOCUS layout ── */}
          {gridLayout === "focus" && (
            <div className="flex flex-col gap-1.5 h-full">
              {/* Spotlight: active speaker or Cristina */}
              <div className="flex-1 min-h-0">
                {activeSpeakerId && userVideoTracks.find((t) => t.participant.identity === activeSpeakerId) ? (
                  <VideoTile
                    trackRef={userVideoTracks.find((t) => t.participant.identity === activeSpeakerId)!}
                    isActiveSpeaker={true}
                    isMuted={isMicMuted(activeSpeakerId)}
                    compact={false}
                  />
                ) : showCristinaTile ? (
                  <CristinaClipTile
                    featuredVideos={featuredVideos}
                    clipIndex={clipIndex}
                    onClipEnded={() => setClipIndex((i) => (i + 1) % Math.max(featuredVideos.length, 1))}
                    fill
                  />
                ) : userVideoTracks.length > 0 ? (
                  <VideoTile
                    trackRef={userVideoTracks[0]}
                    isActiveSpeaker={false}
                    isMuted={isMicMuted(userVideoTracks[0].participant.identity)}
                    compact={false}
                  />
                ) : null}
              </div>
              {/* Strip: remaining tiles */}
              <div className="flex-shrink-0 flex gap-1.5 overflow-x-auto pb-1" style={{ minHeight: "56px" }}>
                {showCristinaTile && activeSpeakerId && userVideoTracks.find((t) => t.participant.identity === activeSpeakerId) && (
                  <div className="w-14 h-14 flex-shrink-0">
                    <CristinaClipTile
                      featuredVideos={featuredVideos}
                      clipIndex={clipIndex}
                      onClipEnded={() => setClipIndex((i) => (i + 1) % Math.max(featuredVideos.length, 1))}
                      compact
                    />
                  </div>
                )}
                {userVideoTracks
                  .filter((t) => t.participant.identity !== activeSpeakerId)
                  .map((trackRef) => (
                    <div key={trackRef.publication.trackSid} className="w-14 h-14 flex-shrink-0">
                      <VideoTile
                        trackRef={trackRef}
                        isActiveSpeaker={false}
                        isMuted={isMicMuted(trackRef.participant.identity)}
                        compact={true}
                      />
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* ── STACK layout ── */}
          {gridLayout === "stack" && (
            <div className="flex flex-col gap-1.5">
              {showCristinaTile && (
                <CristinaClipTile
                  featuredVideos={featuredVideos}
                  clipIndex={clipIndex}
                  onClipEnded={() => setClipIndex((i) => (i + 1) % Math.max(featuredVideos.length, 1))}
                />
              )}
              {userVideoTracks.map((trackRef) => (
                <VideoTile
                  key={trackRef.publication.trackSid}
                  trackRef={trackRef}
                  isActiveSpeaker={activeSpeakerId === trackRef.participant.identity}
                  isMuted={isMicMuted(trackRef.participant.identity)}
                  compact={false}
                />
              ))}
            </div>
          )}

          {/* ── CINEMA layout ── */}
          {gridLayout === "cinema" && (
            <div className="flex flex-col gap-1.5 h-full">
              {/* Cristina dominant */}
              {showCristinaTile && (
                <div className="flex-[2] min-h-0">
                  <CristinaClipTile
                    featuredVideos={featuredVideos}
                    clipIndex={clipIndex}
                    onClipEnded={() => setClipIndex((i) => (i + 1) % Math.max(featuredVideos.length, 1))}
                    fill
                  />
                </div>
              )}
              {/* User cams strip */}
              {userVideoTracks.length > 0 && (
                <div className="flex-shrink-0 flex gap-1.5 overflow-x-auto pb-1" style={{ minHeight: "48px" }}>
                  {userVideoTracks.map((trackRef) => (
                    <div key={trackRef.publication.trackSid} className="w-12 h-12 flex-shrink-0 rounded-full overflow-hidden">
                      <VideoTile
                        trackRef={trackRef}
                        isActiveSpeaker={activeSpeakerId === trackRef.participant.identity}
                        isMuted={isMicMuted(trackRef.participant.identity)}
                        compact={true}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

        </div>
      </div>

      {/* ── Audio-only participants list ── */}
      {others.length > 0 && userVideoTracks.length === 0 && !showCristinaTile && (
        <div className="px-4 py-2 flex-shrink-0" style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
          <p className="text-[10px] text-white/30 uppercase tracking-wider font-semibold mb-2">
            {totalPeople} in the room
          </p>
          <div className="flex flex-wrap gap-1.5">
            {others.slice(0, 12).map((p) => (
              <div
                key={p.identity}
                className="flex items-center gap-1.5 px-2 py-1 rounded-full"
                style={{ background: "rgba(255,255,255,0.05)" }}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0" />
                <span className="text-[11px] text-white/70 truncate max-w-[80px]">
                  {p.name || p.identity}
                </span>
                {isMicMuted(p.identity) && (
                  <svg className="w-3 h-3 text-red-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                  </svg>
                )}
              </div>
            ))}
            {others.length > 12 && (
              <div
                className="flex items-center px-2 py-1 rounded-full"
                style={{ background: "rgba(255,255,255,0.05)" }}
              >
                <span className="text-[11px] text-white/40">+{others.length - 12}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Controls bar ── */}
      <div
        className="flex-shrink-0 transition-opacity duration-300"
        style={{
          opacity: isFullscreen && !controlsVisible ? 0 : 1,
          pointerEvents: isFullscreen && !controlsVisible ? "none" : "auto",
        }}
      >
        <div
          className="flex items-center justify-between px-3 py-3 gap-1"
          style={{
            background: "rgba(10,12,20,0.85)",
            backdropFilter: "blur(20px)",
            borderTop: "1px solid rgba(255,255,255,0.06)",
            paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom, 0px))",
          }}
        >
          {/* Left group: Mic, Camera, ScreenShare, Chat, Settings */}
          <div className="flex items-center gap-1">
            {/* Mic */}
            <button
              onClick={toggleMute}
              className={`${btnBase} ${btnSizeMobile}`}
              style={{
                background: muted ? "rgba(255,59,48,0.18)" : "rgba(255,255,255,0.07)",
                border: `1px solid ${muted ? "rgba(255,59,48,0.35)" : "rgba(255,255,255,0.1)"}`,
              }}
              title={muted ? "Unmute" : "Mute"}
              aria-label={muted ? "Unmute microphone" : "Mute microphone"}
            >
              {muted ? (
                <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                </svg>
              ) : (
                <svg className="w-5 h-5 text-white/70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
              )}
              <span className={btnLabel}>{muted ? "Unmute" : "Mute"}</span>
            </button>

            {/* Camera */}
            <button
              onClick={toggleCam}
              className={`${btnBase} ${btnSizeMobile}`}
              style={{
                background: camOff ? "rgba(255,59,48,0.18)" : "rgba(255,255,255,0.07)",
                border: `1px solid ${camOff ? "rgba(255,59,48,0.35)" : "rgba(255,255,255,0.1)"}`,
              }}
              title={camOff ? "Camera on" : "Camera off"}
              aria-label={camOff ? "Turn camera on" : "Turn camera off"}
            >
              {camOff ? (
                <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M12 18.75H4.5a2.25 2.25 0 01-2.25-2.25V7.5A2.25 2.25 0 014.5 5.25H12a2.25 2.25 0 012.25 2.25v9A2.25 2.25 0 0112 18.75z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 3l18 18" />
                </svg>
              ) : (
                <svg className="w-5 h-5 text-white/70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M12 18.75H4.5a2.25 2.25 0 01-2.25-2.25V7.5A2.25 2.25 0 014.5 5.25H12a2.25 2.25 0 012.25 2.25v9A2.25 2.25 0 0112 18.75z" />
                </svg>
              )}
              <span className={btnLabel}>{camOff ? "Start Cam" : "Stop Cam"}</span>
            </button>

            {/* Settings */}
            <button
              onClick={openSettings}
              className={`${btnBase} ${btnSizeMobile}`}
              style={{
                background: settingsOpen ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.07)",
                border: "1px solid rgba(255,255,255,0.1)",
              }}
              title="Settings"
              aria-label="Open device settings"
            >
              <svg className="w-5 h-5 text-white/70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span className={btnLabel}>Settings</span>
            </button>

            {/* Fullscreen */}
            <button
              onClick={toggleFullscreen}
              className={`${btnBase} ${btnSizeMobile}`}
              style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.1)" }}
              title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
              aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            >
              {isFullscreen ? (
                <svg className="w-5 h-5 text-white/70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" />
                </svg>
              ) : (
                <svg className="w-5 h-5 text-white/70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
                </svg>
              )}
              <span className={btnLabel}>{isFullscreen ? "Exit Full" : "Fullscreen"}</span>
            </button>
          </div>

          {/* Right: Leave (always red, separated) */}
          <button
            onClick={onClose}
            className={`${btnBase} px-3 py-2`}
            style={{
              background: "rgba(255,59,48,0.18)",
              border: "1px solid rgba(255,59,48,0.35)",
              marginLeft: "auto",
            }}
            title="Leave call"
            aria-label="Leave call"
          >
            <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16 8l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M5 3a2 2 0 00-2 2v1c0 8.284 6.716 15 15 15h1a2 2 0 002-2v-3.28a1 1 0 00-.684-.948l-4.493-1.498a1 1 0 00-1.21.502l-1.13 2.257a11.042 11.042 0 01-5.516-5.517l2.257-1.128a1 1 0 00.502-1.21L9.228 3.683A1 1 0 008.279 3H5z" />
            </svg>
            <span className={btnLabel} style={{ color: "rgba(255,100,90,0.8)" }}>Leave</span>
          </button>
        </div>
      </div>

      {/* ── Settings slide-up panel ── */}
      {settingsOpen && (
        <div
          className="absolute inset-0 z-50 flex items-end"
          style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }}
          onClick={(e) => { if (e.target === e.currentTarget) setSettingsOpen(false); }}
        >
          <div
            className="w-full rounded-t-2xl p-5 flex flex-col gap-4"
            style={{
              background: "rgba(18,20,28,0.97)",
              backdropFilter: "blur(24px)",
              border: "1px solid rgba(123,97,255,0.2)",
              boxShadow: "0 -8px 32px rgba(0,0,0,0.5)",
              paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom, 0px))",
            }}
          >
            {/* Settings header */}
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-white">Device Settings</p>
              <button
                onClick={() => setSettingsOpen(false)}
                className="w-11 h-11 flex items-center justify-center rounded-full text-white/40 hover:text-white hover:bg-white/10 transition-all"
                aria-label="Close device settings"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Camera */}
            {permissionError ? (
              <p className="text-xs text-red-300 text-center py-2">
                Allow camera/mic access to pick devices
              </p>
            ) : null}

            <DeviceSelector
              label="Camera"
              icon={
                <svg className="w-4 h-4 text-white/50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M12 18.75H4.5a2.25 2.25 0 01-2.25-2.25V7.5A2.25 2.25 0 014.5 5.25H12a2.25 2.25 0 012.25 2.25v9A2.25 2.25 0 0112 18.75z" />
                </svg>
              }
              devices={videoInputs}
              selected={selectedVideoInput}
              onChange={(id) => switchDevice("videoinput", id)}
            />

            {/* Microphone */}
            <DeviceSelector
              label="Microphone"
              icon={
                <svg className="w-4 h-4 text-white/50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
              }
              devices={audioInputs}
              selected={selectedAudioInput}
              onChange={(id) => switchDevice("audioinput", id)}
            />

            {/* Speaker */}
            <DeviceSelector
              label="Speaker"
              icon={
                <svg className="w-4 h-4 text-white/50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.536 8.464a5 5 0 010 7.072M12 6v12m0-12l-4.5 4.5H4a1 1 0 00-1 1v1a1 1 0 001 1h3.5L12 18V6z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.07 4.93a10 10 0 010 14.14" />
                </svg>
              }
              devices={audioOutputs}
              selected={selectedAudioOutput}
              onChange={(id) => switchDevice("audiooutput", id)}
            />
          </div>
        </div>
      )}

      {/* Hidden audio tracks */}
      <div className="hidden">
        {audioTracks.map((trackRef) => (
          <AudioTrack key={trackRef.publication.trackSid} trackRef={trackRef} />
        ))}
      </div>

      {/* Keyframes */}
      <style>{`
        @keyframes eqBounce1 { from { height: 4px; } to { height: 16px; } }
        @keyframes eqBounce2 { from { height: 8px; } to { height: 12px; } }
        @keyframes eqBounce3 { from { height: 6px; } to { height: 14px; } }
        @keyframes eqBounce4 { from { height: 10px; } to { height: 8px; } }
        @keyframes speakerGlow {
          0%, 100% { box-shadow: 0 0 0 2px rgba(123,97,255,0.6); }
          50%       { box-shadow: 0 0 0 4px rgba(123,97,255,0.3); }
        }
      `}</style>
    </div>
  );
}

// ── VideoTile sub-component ──────────────────────────────────────────────────

function VideoTile({
  trackRef,
  isActiveSpeaker,
  isMuted,
  compact,
}: {
  trackRef: any;
  isActiveSpeaker: boolean;
  isMuted: boolean;
  compact: boolean;
}) {
  return (
    <div
      className="relative rounded-xl overflow-hidden bg-black"
      style={{
        aspectRatio: compact ? "auto" : "16/9",
        minHeight: compact ? "80px" : undefined,
        border: isActiveSpeaker
          ? "2px solid rgba(123,97,255,0.8)"
          : "1px solid rgba(255,255,255,0.06)",
        animation: isActiveSpeaker ? "speakerGlow 1.5s ease-in-out infinite" : "none",
      }}
    >
      <VideoTrack trackRef={trackRef} className="w-full h-full object-cover" />

      {/* Name overlay */}
      <div
        className="absolute bottom-0 left-0 right-0 flex items-center justify-between px-2 py-1"
        style={{ background: "linear-gradient(to top, rgba(0,0,0,0.7) 0%, transparent 100%)" }}
      >
        <span className="text-[10px] text-white/90 font-medium truncate">
          {trackRef.participant.name || trackRef.participant.identity}
        </span>
        {isMuted && (
          <svg className="w-3 h-3 text-red-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
          </svg>
        )}
      </div>

      {/* Active speaker indicator */}
      {isActiveSpeaker && (
        <div
          className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full"
          style={{ background: "#7B61FF", boxShadow: "0 0 6px rgba(123,97,255,0.8)" }}
        />
      )}
    </div>
  );
}

// ── CristinaClipTile sub-component ──────────────────────────────────────────

function CristinaClipTile({
  featuredVideos,
  clipIndex,
  onClipEnded,
  compact = false,
  fill = false,
}: {
  featuredVideos: PrimeVideo[];
  clipIndex: number;
  onClipEnded: () => void;
  compact?: boolean;
  fill?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const currentVideo = featuredVideos[clipIndex] ?? null;
  const videoUrl = currentVideo ? getLowResAssetUrl(currentVideo.video_file) : null;

  useEffect(() => {
    if (videoRef.current && videoUrl) {
      videoRef.current.load();
      videoRef.current.play().catch(() => {});
    }
  }, [videoUrl]);

  if (compact) {
    return (
      <div
        className="relative w-full h-full rounded-xl overflow-hidden bg-black"
        style={{ border: "1px solid rgba(123,97,255,0.3)" }}
      >
        {videoUrl ? (
          <video
            ref={videoRef}
            src={videoUrl}
            autoPlay
            muted
            playsInline
            onEnded={onClipEnded}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-[#1a1a2e]">
            <span className="text-lg">🧜‍♀️</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className="relative rounded-xl overflow-hidden bg-black"
      style={{
        aspectRatio: fill ? undefined : "16/9",
        height: fill ? "100%" : undefined,
        border: "1px solid rgba(123,97,255,0.3)",
      }}
    >
      {videoUrl ? (
        <video
          ref={videoRef}
          src={videoUrl}
          autoPlay
          muted
          playsInline
          onEnded={onClipEnded}
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center gap-2 bg-[#1a1a2e]">
          <span className="text-3xl">🧜‍♀️</span>
          <p className="text-[10px] text-purple-300/70">No clips available</p>
        </div>
      )}

      {/* Bottom overlay — merged DJ bar info */}
      <div
        className="absolute bottom-0 left-0 right-0 flex items-center gap-2 px-2 py-1.5"
        style={{ background: "linear-gradient(to top, rgba(0,0,0,0.75) 0%, transparent 100%)" }}
      >
        <span className="text-base flex-shrink-0">🧜‍♀️</span>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-semibold text-white leading-tight">Cristina AI</p>
          <p className="text-[9px] text-purple-300/70 truncate leading-tight">
            {currentVideo?.title ?? "PNP Radio DJ"}
          </p>
        </div>
        <div className="flex items-end gap-0.5 h-3 flex-shrink-0">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="w-[2px] rounded-full bg-purple-400"
              style={{
                height: `${6 + i * 2}px`,
                animation: `eqBounce${i} ${0.4 + i * 0.1}s ease-in-out infinite alternate`,
              }}
            />
          ))}
        </div>
      </div>

      {/* AI pill badge — top-right */}
      <div
        className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold text-white/90"
        style={{
          background: "linear-gradient(135deg, rgba(212,0,122,0.7), rgba(123,97,255,0.7))",
          backdropFilter: "blur(4px)",
        }}
      >
        AI
      </div>
    </div>
  );
}

// ── DeviceSelector sub-component ─────────────────────────────────────────────

function DeviceSelector({
  label,
  icon,
  devices,
  selected,
  onChange,
}: {
  label: string;
  icon: React.ReactNode;
  devices: MediaDevice[];
  selected: string;
  onChange: (deviceId: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        {icon}
        <span className="text-xs text-white/50 font-medium">{label}</span>
      </div>
      <select
        value={selected}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl px-3 py-2.5 text-sm text-white outline-none appearance-none"
        style={{
          background: "rgba(255,255,255,0.06)",
          border: "1px solid rgba(255,255,255,0.1)",
        }}
      >
        {devices.length === 0 && (
          <option value="" disabled>
            No devices found
          </option>
        )}
        {devices.map((d) => (
          <option key={d.deviceId} value={d.deviceId} style={{ background: "#12141C" }}>
            {d.label}
          </option>
        ))}
      </select>
    </div>
  );
}

// ── Outer wrapper ─────────────────────────────────────────────────────────────

// ── JWT expiry helper ─────────────────────────────────────────────────────────

function decodeJwtExp(token: string): number | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const decoded = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return typeof decoded.exp === "number" ? decoded.exp : null;
  } catch {
    return null;
  }
}

function isTokenNearExpiry(token: string, thresholdSeconds = 300): boolean {
  const exp = decodeJwtExp(token);
  if (exp === null) return false;
  return exp - Math.floor(Date.now() / 1000) < thresholdSeconds;
}

function LiveKitCallPanel({
  open,
  onClose,
  token,
  livekitUrl,
  roomName,
  startedBy = null,
  durationLabel = "0:00",
  onCallEnded,
}: LiveKitCallPanelProps) {
  const [activeToken, setActiveToken] = useState<string | null>(token);

  // Keep token in sync with prop (parent may issue a new one)
  useEffect(() => { setActiveToken(token); }, [token]);

  // Attempt to refresh token on reconnect if it's near expiry
  const handleReconnecting = useCallback(async () => {
    if (!activeToken || !roomName) return;
    if (!isTokenNearExpiry(activeToken)) return;
    try {
      const { joinHangoutCall, startHangoutCall } = await import("@/lib/api");
      // Extract groupId from roomName convention (e.g. "hangout-{id}-{...}")
      const match = roomName.match(/hangout[-_](\d+)/);
      if (!match) return;
      const groupId = parseInt(match[1], 10);
      let result;
      try {
        result = await joinHangoutCall(groupId);
      } catch {
        result = await startHangoutCall(groupId);
      }
      setActiveToken(result.token);
    } catch {
      // Proceed with existing token — reconnect will still attempt
    }
  }, [activeToken, roomName]);

  if (!open || !activeToken) return null;

  return (
    <div
      className="mx-3 mt-2 mb-1 flex-shrink-0 rounded-2xl overflow-hidden"
      style={{
        minHeight: "420px",
        maxHeight: "80vh",
        display: "flex",
        flexDirection: "column",
        border: "1px solid rgba(123,97,255,0.2)",
      }}
    >
      <LiveKitRoom
        token={activeToken}
        serverUrl={livekitUrl}
        connect={true}
        audio={false}
        video={true}
        options={{
          adaptiveStream: true,
          dynacast: true,
          publishDefaults: {
            simulcast: true,
            videoCodec: "vp9",
          },
        }}
        onDisconnected={() => onCallEnded?.()}
        style={{ display: "contents" }}
      >
        <CallContent
          onClose={onClose}
          startedBy={startedBy}
          durationLabel={durationLabel}
          onReconnectingEvent={handleReconnecting}
        />
      </LiveKitRoom>
    </div>
  );
}

export const TelegramCallDock = LiveKitCallPanel;
export default LiveKitCallPanel;
