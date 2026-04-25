import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  LiveKitRoom,
  ParticipantTile,
  useLocalParticipant,
  useRoomContext,
  useTracks,
} from "@livekit/components-react";
import { ConnectionState, RoomEvent, Track } from "livekit-client";
import { useMainStage } from "@/hooks/useMainStage";
import { useMusicPlayer } from "@/hooks/useMusicPlayer";
import { SpotlightGrid } from "@/components/mainstage/SpotlightGrid";
import { CinemaGrid } from "@/components/mainstage/CinemaGrid";
import { EqualGrid } from "@/components/mainstage/EqualGrid";
import { communityResources } from "@/lib/i18n/communityResources";
import { getFeaturedPrimeVideos, getAssetUrl, type PrimeVideo } from "@/lib/directus";
import { MEDIA_IDENTITY } from "@/components/mainstage/CinemaGrid";

interface CammerInfo {
  identity: string;
  name: string;
}

function ParticipantCollector({ onCammersChange }: { onCammersChange: (cammers: CammerInfo[]) => void }) {
  const tracks = useTracks(
    [{ source: Track.Source.Camera, withPlaceholder: false }],
    { onlySubscribed: false }
  );
  useEffect(() => {
    onCammersChange(
      tracks.map((t) => ({ identity: t.participant.identity, name: t.participant.name || t.participant.identity }))
    );
  }, [tracks, onCammersChange]);
  return null;
}

type ModeId = "spotlight" | "theater" | "cinema" | "karaoke" | "equal";

const MODE_LABELS: Record<ModeId, string> = {
  spotlight: "Spotlight",
  theater: "Theater",
  cinema: "Cinema",
  karaoke: "Karaoke",
  equal: "Everyone",
};

const MODE_ICONS: Record<ModeId, JSX.Element> = {
  spotlight: (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <circle cx="12" cy="10" r="4" />
      <path strokeLinecap="round" d="M12 14v5M8 19h8" />
    </svg>
  ),
  theater: (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 5v14M20 5v14M4 7c2 0 4 2 4 4s-2 4-4 4M20 7c-2 0-4 2-4 4s2 4 4 4M9 12h6" />
    </svg>
  ),
  cinema: (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path strokeLinecap="round" d="M8 10l4 2.5L8 15z" fill="currentColor" />
    </svg>
  ),
  karaoke: (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <rect x="3" y="5" width="18" height="12" rx="1.5" />
      <circle cx="17" cy="15" r="3" fill="currentColor" />
    </svg>
  ),
  equal: (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  ),
};

const NEXT_MODE: Record<ModeId, ModeId> = {
  spotlight: "theater",
  theater: "cinema",
  cinema: "karaoke",
  karaoke: "equal",
  equal: "spotlight",
};

interface BottomBarProps {
  canBeCammer: boolean;
  isCammer: boolean;
  onJoinCam: () => void;
  onLeaveCam: () => void;
  onLeave: () => void;
}

function BottomBarInner({
  canBeCammer,
  isCammer,
  onJoinCam,
  onLeaveCam,
  onLeave,
}: BottomBarProps) {
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant();

  // The cam button is now the single entry/exit point for being a cammer.
  // Off+gray (not cammer) → tap → joinAsCammer() promotes + LiveKit auto-
  // enables video via `video={isCammer}` on LiveKitRoom.
  // On+pink (cammer)       → tap → leaveCammer() demotes back to viewer.
  const handleCamToggle = useCallback(() => {
    if (!canBeCammer) return;
    if (isCammer) onLeaveCam();
    else onJoinCam();
  }, [canBeCammer, isCammer, onJoinCam, onLeaveCam]);

  const handleMicToggle = useCallback(() => {
    if (!isCammer) return; // grayed-out state — no-op
    localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled);
  }, [isCammer, localParticipant, isMicrophoneEnabled]);

  return (
    <div
      className="relative flex-shrink-0 flex items-center justify-center gap-2 px-3 sm:px-4 py-2"
      style={{
        background: "rgba(10,10,15,0.95)",
        backdropFilter: "blur(16px)",
        borderTop: "1px solid rgba(255,255,255,0.07)",
        paddingBottom: "calc(0.5rem + env(safe-area-inset-bottom, 0px))",
        zIndex: 45,
      }}
    >
      {/* LEAVE — always first (critical exit) */}
      <button
        type="button"
        onClick={onLeave}
        aria-label="Leave Main Stage"
        className="min-h-[40px] min-w-[40px] flex-shrink-0 flex items-center justify-center gap-1 px-2.5 rounded-full text-xs font-bold transition-all active:scale-[0.96]"
        style={{
          background: "rgba(255,69,58,0.14)",
          border: "1px solid rgba(255,69,58,0.30)",
          color: "#FF453A",
        }}
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
        </svg>
        <span className="hidden sm:inline">Leave</span>
      </button>

      {/* CAMERA / GO LIVE — prominent CTA. Always labeled so users
          understand it's the control to start streaming. */}
      {canBeCammer && (
        <button
          type="button"
          onClick={handleCamToggle}
          aria-label={isCammer ? "Stop streaming (leave cam)" : "Go live (start streaming)"}
          title={isCammer ? "Tap to stop streaming" : "Tap to go live"}
          aria-pressed={isCammer}
          className="min-h-[40px] flex-shrink-0 flex items-center gap-1.5 px-3 rounded-full text-xs font-bold text-white transition-all active:scale-[0.94]"
          style={{
            background: isCammer
              ? "rgba(255,69,58,0.18)"
              : "linear-gradient(135deg,#D4007A,#7B61FF)",
            border: isCammer
              ? "1px solid rgba(255,69,58,0.45)"
              : "1px solid rgba(212,0,122,0.60)",
            boxShadow: isCammer
              ? "0 2px 10px rgba(255,69,58,0.25)"
              : "0 4px 16px rgba(212,0,122,0.45)",
            color: isCammer ? "#FF453A" : "#FFFFFF",
          }}
        >
          {isCammer ? (
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9A2.25 2.25 0 004.5 18.75zM3 3l18 18" />
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9A2.25 2.25 0 004.5 18.75z" />
            </svg>
          )}
          <span>{isCammer ? "Stop" : "Go live"}</span>
        </button>
      )}

      {/* MIC — grayed until user is a cammer; tap toggles mute. */}
      {canBeCammer && (
        <button
          type="button"
          onClick={handleMicToggle}
          disabled={!isCammer}
          aria-label={
            !isCammer
              ? "Microphone disabled (turn on camera first)"
              : isMicrophoneEnabled ? "Mute microphone" : "Unmute microphone"
          }
          title={!isCammer ? "Turn on camera to enable mic" : isMicrophoneEnabled ? "Mute" : "Unmute"}
          aria-pressed={isMicrophoneEnabled}
          className="min-h-[40px] min-w-[40px] flex-shrink-0 flex items-center justify-center rounded-full transition-all active:scale-[0.94] disabled:cursor-not-allowed"
          style={{
            background: !isCammer
              ? "rgba(255,255,255,0.03)"
              : isMicrophoneEnabled
                ? "rgba(212,0,122,0.18)"
                : "rgba(255,255,255,0.05)",
            border: !isCammer
              ? "1px solid rgba(255,255,255,0.08)"
              : isMicrophoneEnabled
                ? "1px solid rgba(212,0,122,0.40)"
                : "1px solid rgba(255,255,255,0.12)",
            opacity: !isCammer ? 0.4 : 1,
          }}
        >
          {isMicrophoneEnabled && isCammer ? (
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
            </svg>
          ) : (
            <svg className="w-4 h-4 text-white/55" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3zM3 3l18 18" />
            </svg>
          )}
        </button>
      )}

    </div>
  );
}

function ConnectionOverlay({ connState }: { connState: ConnectionState }) {
  if (connState === ConnectionState.Connected) return null;

  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center"
      style={{ background: "rgba(10,10,15,0.92)", backdropFilter: "blur(12px)" }}
    >
      <div className="flex flex-col items-center gap-4">
        <div
          className="w-10 h-10 rounded-full border-2 animate-spin"
          style={{ borderColor: "rgba(212,0,122,0.3)", borderTopColor: "#D4007A" }}
        />
        <p className="text-white/70 text-sm">
          {connState === ConnectionState.Reconnecting ? "Reconnecting…" : "Connecting…"}
        </p>
      </div>
    </div>
  );
}

interface RoomListenerProps {
  onConnectionStateChange: (state: ConnectionState) => void;
}

function RoomListener({ onConnectionStateChange }: RoomListenerProps) {
  const room = useRoomContext();

  useEffect(() => {
    const handleState = (nextState: ConnectionState) => {
      onConnectionStateChange(nextState);
    };

    room.on(RoomEvent.ConnectionStateChanged, handleState);
    handleState(room.state);

    return () => {
      room.off(RoomEvent.ConnectionStateChanged, handleState);
    };
  }, [onConnectionStateChange, room]);

  return null;
}

interface MainStageInnerProps {
  mode: ModeId;
  spotlightCammer: string | null;
  spotlightNextAt: number | null;
  mediaKind: "video" | "music" | "off";
  mediaSrc: string | null;
  mediaPlaying: boolean;
  mediaVolume: number;
  canBeCammer: boolean;
  isAdmin: boolean;
  isCammer: boolean;
  onJoinCam: () => void;
  onLeaveCam: () => void;
  onSpotlightPick: (identity: string) => void;
  onConnectionStateChange: (state: ConnectionState) => void;
  onCammersChange: (cammers: CammerInfo[]) => void;
  onLeave: () => void;
}

function MainStageInner({
  mode,
  spotlightCammer,
  spotlightNextAt,
  mediaKind,
  mediaSrc,
  mediaPlaying,
  mediaVolume,
  canBeCammer,
  isAdmin,
  isCammer,
  onJoinCam,
  onLeaveCam,
  onSpotlightPick,
  onConnectionStateChange,
  onCammersChange,
  onLeave,
}: MainStageInnerProps) {
  return (
    <>
      <ParticipantCollector onCammersChange={onCammersChange} />
      <RoomListener onConnectionStateChange={onConnectionStateChange} />

      <div className="flex-1 min-h-0 relative overflow-hidden" style={{ transition: "background 0.3s" }}>
        {mode === "spotlight" && (
          <SpotlightGrid
            focusIdentity={spotlightCammer}
            nextAt={spotlightNextAt}
            onTileClick={isAdmin ? onSpotlightPick : undefined}
          />
        )}
        {mode === "cinema" && (
          <CinemaGrid
            mediaIdentity={MEDIA_IDENTITY}
            mediaKind={mediaKind}
            mediaSrc={mediaSrc}
            mediaPlaying={mediaPlaying}
            mediaVolume={mediaVolume}
          />
        )}
        {mode === "theater" && (
          <div className="relative h-full w-full">
            <CinemaGrid
              mediaIdentity={MEDIA_IDENTITY}
              mediaKind={mediaKind}
              mediaSrc={mediaSrc}
              mediaPlaying={mediaPlaying}
              mediaVolume={mediaVolume}
            />
            <TheaterCurtains />
          </div>
        )}
        {mode === "karaoke" && (
          <>
            <CinemaGrid
              mediaIdentity={MEDIA_IDENTITY}
              mediaKind={mediaKind}
              mediaSrc={mediaSrc}
              mediaPlaying={mediaPlaying}
              mediaVolume={mediaVolume}
              hideCammerStrip
            />
            <KaraokeCammerOverlay spotlightIdentity={spotlightCammer} />
          </>
        )}
        {mode === "equal" && <EqualGrid />}
      </div>

      <BottomBarInner
        canBeCammer={canBeCammer}
        isCammer={isCammer}
        onJoinCam={onJoinCam}
        onLeaveCam={onLeaveCam}
        onLeave={onLeave}
      />
    </>
  );
}

export default function MainStage() {
  const navigate = useNavigate();
  const {
    state,
    isAdmin,
    canBeCammer,
    token,
    livekitUrl,
    role,
    loading,
    error,
    joinAsCammer,
    leaveCammer,
    shuffle,
    admin,
  } = useMainStage();

  const [adminOpen, setAdminOpen] = useState(false);
  const [connState, setConnState] = useState<ConnectionState>(ConnectionState.Connecting);
  const [cammerInfos, setCammerInfos] = useState<CammerInfo[]>([]);
  const [camError, setCamError] = useState<string | null>(null);
  const isCammer = role === "cammer" || role === "admin";
  // Clear stale camera-permission banners whenever user flips back to viewer.
  useEffect(() => {
    if (!isCammer) setCamError(null);
  }, [isCammer]);
  // Ref to the MainStage root container, used by FullscreenToggle so we
  // fullscreen just the stage (not the whole document, which fails on iOS).
  const stageRootRef = useRef<HTMLDivElement>(null);

  // Local view-mode override. Each user can pick their preferred layout
  // without affecting anyone else. When null, we fall back to the server's
  // mode (admin-controlled default). Persisted in localStorage so the
  // choice survives reloads. Admin writes still go to the server via the
  // AdminDrawer; those change the default for un-overridden users.
  const LOCAL_MODE_KEY = "mainstage:localViewMode";
  const [localViewMode, setLocalViewMode] = useState<ModeId | null>(() => {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(LOCAL_MODE_KEY);
    const isValid = raw === "spotlight" || raw === "theater" || raw === "cinema" || raw === "karaoke" || raw === "equal";
    return isValid ? (raw as ModeId) : null;
  });
  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    if (localViewMode === null) localStorage.removeItem(LOCAL_MODE_KEY);
    else localStorage.setItem(LOCAL_MODE_KEY, localViewMode);
  }, [localViewMode]);

  useEffect(() => {
    setConnState(ConnectionState.Connecting);
  }, [token]);

  // Auto-start Cristina's radio when entering Main Stage so the room has
  // music over the silent video. Fires at most once per page mount. If the
  // user pauses, we don't restart. If tracks refetch after a pause, we
  // don't restart. Ref guard is the source of truth.
  const { play: playMusic, isPlaying: musicIsPlaying, tracks: musicTracks } = useMusicPlayer();
  const hasAutoStartedMusicRef = useRef(false);
  useEffect(() => {
    if (hasAutoStartedMusicRef.current) return;
    if (musicIsPlaying) { hasAutoStartedMusicRef.current = true; return; }
    if (!musicTracks || musicTracks.length === 0) return; // provider still loading
    hasAutoStartedMusicRef.current = true;
    playMusic();
  }, [musicTracks, musicIsPlaying, playMusic]);

  const handleJoinCam = useCallback(async () => {
    await joinAsCammer();
  }, [joinAsCammer]);

  const handleLeaveCam = useCallback(async () => {
    await leaveCammer();
  }, [leaveCammer]);

  const handleCammersChange = useCallback((infos: CammerInfo[]) => {
    setCammerInfos(infos);
  }, []);

  const handleLeave = useCallback(() => {
    navigate(-1);
  }, [navigate]);

  // Cycle the *local* view mode — each user's personal preference. The
  // server's mode remains the default for anyone who hasn't overridden.
  const handleCycleMode = useCallback(() => {
    const currentEffective: ModeId =
      (localViewMode ?? (state?.mode as ModeId | undefined) ?? "spotlight");
    const next = NEXT_MODE[currentEffective] ?? "spotlight";
    setLocalViewMode(next);
  }, [localViewMode, state?.mode]);

  const handleResetViewMode = useCallback(() => {
    setLocalViewMode(null);
  }, []);

  const handleShuffle = useCallback(() => {
    shuffle();
  }, [shuffle]);

  if (loading) {
    return (
      <div
        className="fixed inset-0 flex flex-col"
        style={{ background: "var(--pnp-background, #0A0A0F)" }}
        role="status"
        aria-label="Loading Main Stage"
      >
        <div
          className="flex-shrink-0 flex items-center justify-between px-4 h-14"
          style={{
            background: "rgba(10,10,15,0.9)",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
            paddingTop: "env(safe-area-inset-top, 0px)",
          }}
        >
          <div className="w-20 h-4 rounded animate-pulse" style={{ background: "rgba(255,255,255,0.08)" }} />
          <div className="w-24 h-5 rounded animate-pulse" style={{ background: "rgba(255,255,255,0.06)" }} />
          <div className="w-8 h-8 rounded-full animate-pulse" style={{ background: "rgba(255,255,255,0.08)" }} />
        </div>
        <div className="flex-1 animate-pulse" style={{ background: "rgba(255,255,255,0.03)" }}>
          <div className="absolute inset-0 flex items-center justify-center">
            <div
              className="w-10 h-10 rounded-full border-2 animate-spin"
              style={{ borderColor: "rgba(212,0,122,0.2)", borderTopColor: "#D4007A" }}
            />
          </div>
        </div>
        <div
          className="flex-shrink-0 h-16 animate-pulse"
          style={{ background: "rgba(10,10,15,0.9)", borderTop: "1px solid rgba(255,255,255,0.06)" }}
        />
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="fixed inset-0 flex flex-col items-center justify-center gap-5 px-6 text-center"
        style={{ background: "var(--pnp-background, #0A0A0F)" }}
      >
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center"
          style={{ background: "rgba(255,69,58,0.12)", border: "1px solid rgba(255,69,58,0.25)" }}
        >
          <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
        </div>
        <div>
          <p className="text-white font-semibold text-sm mb-1">Failed to connect</p>
          <p className="text-white/50 text-xs">{error}</p>
        </div>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="min-h-[44px] px-5 rounded-2xl text-sm font-semibold text-white transition-all active:scale-[0.97]"
            style={{ background: "linear-gradient(135deg,#D4007A,#7B61FF)" }}
          >
            Try again
          </button>
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="min-h-[44px] px-5 rounded-2xl text-sm font-semibold text-white/60 transition-all active:scale-[0.97]"
            style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.10)" }}
          >
            Go back
          </button>
        </div>
      </div>
    );
  }

  if (!token || !state) {
    return (
      <div
        className="fixed inset-0 flex flex-col items-center justify-center gap-5 px-6 text-center"
        style={{ background: "var(--pnp-background, #0A0A0F)" }}
      >
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center"
          style={{ background: "rgba(123,97,255,0.12)", border: "1px solid rgba(123,97,255,0.25)" }}
        >
          <svg className="w-8 h-8" style={{ color: "#7B61FF" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
        </div>
        <div>
          <p className="text-white font-semibold text-sm mb-1">Main Stage unavailable</p>
          <p className="text-white/50 text-xs">No state received from the server. Try reloading.</p>
        </div>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="min-h-[44px] px-5 rounded-2xl text-sm font-semibold text-white transition-all active:scale-[0.97]"
            style={{ background: "linear-gradient(135deg,#D4007A,#7B61FF)" }}
          >
            Reload
          </button>
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="min-h-[44px] px-5 rounded-2xl text-sm font-semibold text-white/60 transition-all active:scale-[0.97]"
            style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.10)" }}
          >
            Go back
          </button>
        </div>
      </div>
    );
  }

  // Effective mode: per-user local override wins over the server's
  // shared mode. Everything downstream uses this.
  const mode: ModeId =
    (localViewMode ?? (state.mode as ModeId | undefined) ?? "spotlight");
  const liveCammers = state?.counts?.cammers ?? 0;

  return (
    <div
      ref={stageRootRef}
      className="fixed inset-0 flex flex-col"
      style={{ background: "var(--pnp-background, #0A0A0F)" }}
    >
      <header
        className="flex-shrink-0 flex items-center justify-between px-4 gap-3"
        style={{
          height: "54px",
          paddingTop: "env(safe-area-inset-top, 0px)",
          background: "rgba(10,10,15,0.85)",
          backdropFilter: "blur(16px)",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          zIndex: 20,
        }}
      >
        <img
          src="/logo-login.png"
          alt="PNPtv!"
          className="h-7 w-auto object-contain"
          style={{ filter: "brightness(1.1)" }}
        />

        <div
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold"
          style={{
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.10)",
            color: "rgba(255,255,255,0.80)",
          }}
        >
          <span style={{ color: "#D4007A" }}>{MODE_ICONS[mode]}</span>
          <span>Main Stage</span>
          <span className="text-white/30 mx-0.5">·</span>
          <span style={{ color: "rgba(255,255,255,0.55)" }}>{MODE_LABELS[mode]}</span>
          {liveCammers > 0 && (
            <>
              <span className="text-white/20 mx-0.5">·</span>
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse flex-shrink-0" />
              <span className="tabular-nums" style={{ color: "rgba(255,255,255,0.70)" }}>{liveCammers}</span>
            </>
          )}
        </div>

        <button
          type="button"
          aria-label="Leave Main Stage"
          onClick={() => navigate(-1)}
          className="min-h-[36px] min-w-[36px] flex-shrink-0 flex items-center justify-center rounded-full transition-all hover:opacity-70 active:scale-[0.92]"
          style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.10)" }}
        >
          <svg className="w-3.5 h-3.5 text-white/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </header>

      {/* Floating vertical toolbar — fixed-positioned on the right edge,
          always visible at any viewport size. Contains the per-user view
          controls (cycle, reset) and shared utilities (shuffle, fullscreen,
          admin). Stacked vertically so it scales down to the narrowest
          phone without overflowing. */}
      <div
        className="absolute flex flex-col items-center gap-2 z-40"
        style={{
          top: "calc(64px + env(safe-area-inset-top, 0px))",
          right: "calc(0.5rem + env(safe-area-inset-right, 0px))",
        }}
      >
        <button
          type="button"
          onClick={handleCycleMode}
          aria-label={`Switch your view — current: ${MODE_LABELS[mode]}. Next: ${MODE_LABELS[NEXT_MODE[mode]]}`}
          title={`Your view · ${MODE_LABELS[mode]} → ${MODE_LABELS[NEXT_MODE[mode]]}`}
          className="relative min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full transition-all active:scale-[0.94] shadow-lg"
          style={{
            background: "linear-gradient(135deg, rgba(212,0,122,0.85), rgba(123,97,255,0.80))",
            border: "1px solid rgba(255,255,255,0.25)",
            boxShadow: "0 4px 16px rgba(0,0,0,0.45), 0 0 0 1px rgba(212,0,122,0.30)",
          }}
        >
          <span style={{ color: "#FFF" }}>{MODE_ICONS[mode]}</span>
          {localViewMode !== null && (
            <span
              className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full border"
              style={{ background: "#E5FF00", borderColor: "rgba(10,10,15,0.95)", boxShadow: "0 0 6px rgba(229,255,0,0.8)" }}
              aria-hidden
              title="You've picked your own view"
            />
          )}
        </button>
        {localViewMode !== null && (
          <button
            type="button"
            onClick={handleResetViewMode}
            aria-label={`Reset to room default (${MODE_LABELS[(state?.mode as ModeId) ?? "spotlight"]})`}
            title="Reset to room default"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full transition-all active:scale-[0.94] shadow-lg"
            style={{
              background: "rgba(20,20,30,0.85)",
              border: "1px solid rgba(255,255,255,0.18)",
              backdropFilter: "blur(6px)",
              boxShadow: "0 4px 16px rgba(0,0,0,0.45)",
            }}
          >
            <svg className="w-4 h-4 text-white/80" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
            </svg>
          </button>
        )}
        <button
          type="button"
          onClick={handleShuffle}
          aria-label="Shuffle cammers"
          title="Shuffle cammers"
          className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full transition-all active:scale-[0.94] shadow-lg"
          style={{
            background: "rgba(20,20,30,0.85)",
            border: "1px solid rgba(229,255,0,0.35)",
            backdropFilter: "blur(6px)",
            boxShadow: "0 4px 16px rgba(0,0,0,0.45)",
          }}
        >
          <svg className="w-4 h-4" style={{ color: "#E5FF00" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 4.5l3 3m0 0l-3 3m3-3H12M7.5 19.5l-3-3m0 0l3-3m-3 3H12M4.5 5.25L12 12.75M19.5 18.75L15 14.25" />
          </svg>
        </button>
        <FullscreenToggle targetRef={stageRootRef} />
        {isAdmin && (
          <button
            type="button"
            aria-label="Open admin controls"
            onClick={() => setAdminOpen(true)}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full transition-all hover:opacity-80 active:scale-[0.94] shadow-lg"
            style={{
              background: "rgba(20,20,30,0.85)",
              border: "1px solid rgba(123,97,255,0.40)",
              backdropFilter: "blur(6px)",
              boxShadow: "0 4px 16px rgba(0,0,0,0.45)",
            }}
          >
            <svg className="w-4 h-4" style={{ color: "#7B61FF" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        )}
      </div>

      {connState === ConnectionState.Reconnecting && (
        <div
          className="absolute top-14 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold"
          style={{ background: "#E69138", color: "#000" }}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-black/40 animate-pulse" />
          Reconnecting…
        </div>
      )}

      {camError && (
        <div
          className="absolute left-1/2 -translate-x-1/2 z-40 flex items-start gap-2 px-3 py-2 rounded-xl text-xs font-semibold max-w-[92vw] sm:max-w-[480px]"
          style={{
            top: "calc(60px + env(safe-area-inset-top, 0px))",
            background: "rgba(255,69,58,0.95)",
            color: "#fff",
            boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
          }}
          role="alert"
          aria-live="assertive"
        >
          <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
          <span className="flex-1 text-left">{camError}</span>
          <button
            type="button"
            onClick={() => setCamError(null)}
            aria-label="Dismiss"
            className="min-h-[20px] min-w-[20px] flex-shrink-0 flex items-center justify-center rounded-full opacity-80 hover:opacity-100"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      <LiveKitRoom
        key={token}
        token={token}
        serverUrl={livekitUrl}
        connect={true}
        // Mic starts off — cammers unmute via the bottom-bar mic toggle.
        // Camera auto-publishes via video={isCammer} on mount.
        audio={false}
        video={isCammer}
        options={{
          adaptiveStream: true,
          dynacast: true,
          publishDefaults: { simulcast: true },
        }}
        style={{ display: "contents" }}
        onMediaDeviceFailure={(failure) => {
          // Surface the specific reason so users know why their cam didn't
          // turn on. Most common is NotAllowedError (permission denied)
          // or NotFoundError (no camera attached).
          const msg = failure?.toString() || "Camera failed";
          if (/NotAllowed|Permission/i.test(msg)) {
            setCamError("Camera permission denied. Enable it in your browser settings and tap Go live again.");
          } else if (/NotFound|Device/i.test(msg)) {
            setCamError("No camera detected. Make sure a camera is connected.");
          } else if (/NotReadable|Overconstrained/i.test(msg)) {
            setCamError("Camera is in use by another app. Close it and retry.");
          } else {
            setCamError(`Camera error: ${msg}`);
          }
        }}
      >
        <MainStageInner
          mode={mode as ModeId}
          spotlightCammer={state?.spotlight?.cammer}
          spotlightNextAt={state?.spotlight?.nextAt}
          mediaKind={state?.media?.kind || "off"}
          mediaSrc={state?.media?.src}
          mediaPlaying={state?.media?.playing ?? true}
          mediaVolume={state?.media?.volume ?? 70}
          canBeCammer={canBeCammer}
          isAdmin={isAdmin}
          isCammer={isCammer}
          onJoinCam={handleJoinCam}
          onLeaveCam={handleLeaveCam}
          onSpotlightPick={(identity) => admin.setSpotlight(identity)}
          onConnectionStateChange={setConnState}
          onCammersChange={handleCammersChange}
          onLeave={handleLeave}
        />
      </LiveKitRoom>

      <ConnectionOverlay connState={connState} />

      {state?.media?.kind === "video" && state.media.title && !adminOpen && (
        <NowPlayingChip title={state.media.title} />
      )}

      {!adminOpen && <WellnessTipsOverlay />}

      {adminOpen && (
        <AdminDrawer
          state={state}
          admin={admin}
          cammerInfos={cammerInfos}
          onClose={() => setAdminOpen(false)}
        />
      )}
    </div>
  );
}

interface AdminDrawerProps {
  state: import("@/hooks/useMainStage").MainStageState;
  admin: ReturnType<typeof useMainStage>["admin"];
  cammerInfos: CammerInfo[];
  onClose: () => void;
}

function AdminDrawer({ state, admin, cammerInfos, onClose }: AdminDrawerProps) {
  // Lock body scroll while drawer is open so iOS doesn't capture pan gestures
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div
        className="fixed inset-0 z-40"
        style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }}
        onClick={onClose}
        aria-hidden
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Admin controls"
        // No overflow on the wrapper — AdminPanelContent's body is the
        // single scroll container so iOS doesn't get confused.
        className="fixed top-0 right-0 bottom-0 z-50 flex flex-col"
        style={{
          width: "min(384px, 100vw)",
          maxHeight: "100dvh",
          background: "var(--pnp-background, #111117)",
          borderLeft: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        {/* Always-visible close button, fixed within the drawer regardless of
            scroll. Big red circle, top-right corner, above the panel header. */}
        <button
          type="button"
          aria-label="Close admin panel"
          onClick={onClose}
          className="absolute z-10 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full transition-all active:scale-[0.92] hover:opacity-90"
          style={{
            top: "calc(0.5rem + env(safe-area-inset-top, 0px))",
            right: "0.5rem",
            background: "rgba(255,69,58,0.95)",
            border: "1px solid rgba(255,255,255,0.30)",
            boxShadow: "0 4px 16px rgba(0,0,0,0.45)",
            color: "#fff",
          }}
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        <AdminPanelContent state={state} admin={admin} cammerInfos={cammerInfos} onClose={onClose} />
      </aside>
    </>
  );
}

type AdminType = ReturnType<typeof useMainStage>["admin"];

interface AdminPanelContentProps {
  state: import("@/hooks/useMainStage").MainStageState;
  admin: AdminType;
  cammerInfos: CammerInfo[];
  onClose?: () => void;
}

const MODES: Array<{ id: ModeId; label: string; sub: string; icon: JSX.Element }> = [
  {
    id: "spotlight",
    label: "Spotlight",
    sub: "Pin one cammer as hero",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <circle cx="12" cy="10" r="4" />
        <path strokeLinecap="round" d="M12 14v5M8 19h8" />
      </svg>
    ),
  },
  {
    id: "theater",
    label: "Theater",
    sub: "Velvet curtains frame the video",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 5v14M20 5v14M4 7c2 0 4 2 4 4s-2 4-4 4M20 7c-2 0-4 2-4 4s2 4 4 4M9 12h6" />
      </svg>
    ),
  },
  {
    id: "cinema",
    label: "Cinema",
    sub: "Media takes the stage",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path strokeLinecap="round" d="M8 10l4 2.5L8 15z" fill="currentColor" />
      </svg>
    ),
  },
  {
    id: "karaoke",
    label: "Karaoke",
    sub: "Video full, cammer in corner",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <rect x="3" y="5" width="18" height="12" rx="1.5" />
        <circle cx="17" cy="15" r="3" fill="currentColor" />
      </svg>
    ),
  },
  {
    id: "equal",
    label: "Everyone",
    sub: "Grid of all cammers",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </svg>
    ),
  },
];

export function AdminPanelContent({ state, admin, cammerInfos, onClose }: AdminPanelContentProps) {
  const [mediaUrl, setMediaUrl] = useState(state.media.src ?? "");
  const [primeVideos, setPrimeVideos] = useState<PrimeVideo[]>([]);
  const [primeLoading, setPrimeLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setPrimeLoading(true);
    getFeaturedPrimeVideos(40)
      .then((items) => {
        if (cancelled) return;
        setPrimeVideos(items.filter((v) => v.video_file));
      })
      .catch(() => {
        if (!cancelled) setPrimeVideos([]);
      })
      .finally(() => {
        if (!cancelled) setPrimeLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const handlePlayMedia = useCallback(() => {
    if (!mediaUrl.trim()) return;
    admin.setMedia({ kind: "video", src: mediaUrl.trim(), playing: true });
  }, [admin, mediaUrl]);

  const handleStopMedia = useCallback(() => {
    admin.setMedia({ kind: "off", src: null, playing: false });
  }, [admin]);

  const handleTogglePlay = useCallback(() => {
    if (!state?.media) return;
    admin.setMedia({ ...state.media, playing: !state.media.playing });
  }, [admin, state?.media]);

  const handlePickPrimeVideo = useCallback(
    async (video: PrimeVideo) => {
      const src = getAssetUrl(video.video_file);
      if (!src) return;
      setMediaUrl(src);
      if (state.mode !== "cinema") {
        await admin.setMode("cinema").catch(() => {});
      }
      await admin.setMedia({ kind: "video", src, playing: true }).catch(() => {});
    },
    [admin, state.mode]
  );

  return (
    <div
      className="flex flex-col h-full min-h-0"
      style={{
        paddingTop: "env(safe-area-inset-top, 0px)",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}
    >
      <div
        className="flex-shrink-0 flex items-center justify-between px-4 py-4"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}
      >
        <div className="pr-12">
          <h2 className="text-white font-bold text-sm">Admin Controls</h2>
          <p className="text-white/40 text-xs mt-0.5">
            {state?.counts?.cammers || 0} cammers · {state?.counts?.viewers || 0} watching
          </p>
        </div>
        {/* Close button moved to a fixed-positioned overlay in AdminDrawer
            so it's always reachable regardless of scroll position. */}
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain space-y-5 p-4">
        <section>
          <h3 className="text-white/50 text-[10px] font-bold uppercase tracking-widest mb-2.5">Layout Mode</h3>
          <div className="grid grid-cols-3 gap-2">
            {MODES.map((m) => {
              const active = state?.mode === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => admin.setMode(m.id)}
                  className="flex flex-col items-center gap-1.5 p-3 rounded-2xl text-center transition-all active:scale-[0.97]"
                  style={{
                    background: active
                      ? "linear-gradient(135deg,rgba(212,0,122,0.25),rgba(123,97,255,0.20))"
                      : "rgba(255,255,255,0.04)",
                    border: active ? "1.5px solid rgba(212,0,122,0.50)" : "1.5px solid rgba(255,255,255,0.08)",
                    color: active ? "#fff" : "rgba(255,255,255,0.50)",
                  }}
                >
                  <span style={{ color: active ? "#D4007A" : "rgba(255,255,255,0.40)" }}>{m.icon}</span>
                  <span className="text-[10px] font-bold leading-tight">{m.label}</span>
                  <span className="text-[9px] text-white/30 leading-tight hidden sm:block">{m.sub}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section>
          <h3 className="text-white/50 text-[10px] font-bold uppercase tracking-widest mb-2.5">
            Prime Videos{primeVideos.length > 0 ? ` (${primeVideos.length})` : ""}
          </h3>
          {primeLoading ? (
            <div className="flex gap-2 overflow-hidden">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="flex-shrink-0 w-32 h-[88px] rounded-xl animate-pulse"
                  style={{ background: "rgba(255,255,255,0.04)" }}
                />
              ))}
            </div>
          ) : primeVideos.length === 0 ? (
            <p className="text-white/30 text-xs">No published Prime Videos in CMS</p>
          ) : (
            <div
              className="flex gap-2 overflow-x-auto pb-1"
              style={{ scrollbarWidth: "none", WebkitOverflowScrolling: "touch" }}
            >
              {primeVideos.map((v) => {
                const thumb = getAssetUrl(v.thumbnail) || getAssetUrl(v.cover_url);
                const src = getAssetUrl(v.video_file);
                const active = state.mode === "cinema" && state.media.src === src;
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => handlePickPrimeVideo(v)}
                    className="flex-shrink-0 relative w-32 h-[88px] rounded-xl overflow-hidden transition-all active:scale-[0.97] text-left"
                    style={{
                      border: active ? "1.5px solid #D4007A" : "1.5px solid rgba(255,255,255,0.08)",
                      background: "rgba(255,255,255,0.04)",
                      boxShadow: active ? "0 0 0 2px rgba(212,0,122,0.30)" : "none",
                    }}
                    aria-label={`Play ${v.title}`}
                    title={v.title}
                  >
                    {thumb ? (
                      <img
                        src={thumb}
                        alt=""
                        className="absolute inset-0 w-full h-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div
                        className="absolute inset-0"
                        style={{ background: "linear-gradient(135deg, rgba(212,0,122,0.25), rgba(123,97,255,0.20))" }}
                      />
                    )}
                    <div
                      className="absolute inset-0"
                      style={{ background: "linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.15) 60%, rgba(0,0,0,0) 100%)" }}
                    />
                    <div className="absolute inset-x-0 bottom-0 px-2 pb-1.5">
                      <p className="text-white text-[10px] font-semibold leading-tight line-clamp-2">
                        {v.title}
                      </p>
                    </div>
                    {active && (
                      <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full flex items-center justify-center" style={{ background: "#D4007A" }}>
                        <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M8 5v14l11-7z" />
                        </svg>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <section>
          <h3 className="text-white/50 text-[10px] font-bold uppercase tracking-widest mb-2.5">Custom URL</h3>
          <div className="space-y-3">
            <div className="flex gap-2">
              <input
                type="url"
                value={mediaUrl}
                onChange={(e) => setMediaUrl(e.target.value)}
                placeholder="Video or stream URL…"
                className="flex-1 min-w-0 px-3 py-2 rounded-xl text-xs text-white placeholder-white/30 focus:outline-none transition-colors"
                style={{
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(255,255,255,0.10)",
                }}
                aria-label="Media URL"
              />
              <button
                type="button"
                onClick={handlePlayMedia}
                disabled={!mediaUrl.trim()}
                className="flex-shrink-0 min-h-[38px] px-3 rounded-xl text-xs font-bold text-white transition-all active:scale-[0.96] disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ background: "linear-gradient(135deg,#D4007A,#7B61FF)" }}
              >
                Play
              </button>
            </div>

            {state?.media?.kind && state.media.kind !== "off" && (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleTogglePlay}
                  className="flex-1 min-h-[40px] flex items-center justify-center gap-2 rounded-xl text-xs font-semibold text-white transition-all active:scale-[0.97]"
                  style={{
                    background: "rgba(255,255,255,0.07)",
                    border: "1px solid rgba(255,255,255,0.10)",
                  }}
                >
                  {state.media.playing ? (
                    <>
                      <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M6 4h4v16H6zM14 4h4v16h-4z" /></svg>
                      Pause
                    </>
                  ) : (
                    <>
                      <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                      Resume
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={handleStopMedia}
                  className="flex-shrink-0 min-h-[40px] px-4 rounded-xl text-xs font-semibold transition-all active:scale-[0.97]"
                  style={{
                    background: "rgba(255,69,58,0.12)",
                    border: "1px solid rgba(255,69,58,0.25)",
                    color: "#FF453A",
                  }}
                >
                  Stop
                </button>
              </div>
            )}
          </div>
        </section>

        <section>
          <h3 className="text-white/50 text-[10px] font-bold uppercase tracking-widest mb-2.5">
            Participants{cammerInfos.length > 0 ? ` (${cammerInfos.length})` : ""}
          </h3>
          {cammerInfos.length === 0 ? (
            <p className="text-white/30 text-xs">No cammers on stage</p>
          ) : (
            <div className="space-y-1.5">
              {cammerInfos.map((c) => (
                <div
                  key={c.identity}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl"
                  style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}
                >
                  <span className="flex-1 min-w-0 text-xs text-white/70 truncate">{c.name}</span>
                  <button
                    type="button"
                    onClick={() => admin.moderate("mute", c.identity)}
                    className="flex-shrink-0 px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all active:scale-[0.96]"
                    style={{
                      background: "rgba(230,145,56,0.12)",
                      border: "1px solid rgba(230,145,56,0.25)",
                      color: "#E69138",
                    }}
                  >
                    Mute
                  </button>
                  <button
                    type="button"
                    onClick={() => admin.moderate("kick", c.identity)}
                    className="flex-shrink-0 px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all active:scale-[0.96]"
                    style={{
                      background: "rgba(255,69,58,0.12)",
                      border: "1px solid rgba(255,69,58,0.25)",
                      color: "#FF453A",
                    }}
                  >
                    Kick
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

interface FullscreenToggleProps {
  targetRef: React.RefObject<HTMLElement>;
}

function FullscreenToggle({ targetRef }: FullscreenToggleProps) {
  const [isFs, setIsFs] = useState(
    typeof document !== "undefined" &&
      !!(document.fullscreenElement ||
        // iOS Safari webkit variant
        (document as Document & { webkitFullscreenElement?: Element }).webkitFullscreenElement)
  );

  useEffect(() => {
    const onChange = () =>
      setIsFs(
        !!document.fullscreenElement ||
          !!(document as Document & { webkitFullscreenElement?: Element }).webkitFullscreenElement
      );
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("webkitfullscreenchange", onChange);
    };
  }, []);

  const handleClick = useCallback(async () => {
    const doc = document as Document & {
      webkitExitFullscreen?: () => Promise<void> | void;
      webkitFullscreenElement?: Element;
    };
    try {
      if (doc.fullscreenElement || doc.webkitFullscreenElement) {
        if (document.exitFullscreen) await document.exitFullscreen();
        else if (doc.webkitExitFullscreen) await doc.webkitExitFullscreen();
      } else {
        // Target the Main Stage container specifically so the rest of the
        // document (and any route listeners) aren't involved.
        const el = (targetRef.current || document.documentElement) as HTMLElement & {
          webkitRequestFullscreen?: () => Promise<void> | void;
        };
        if (el.requestFullscreen) await el.requestFullscreen();
        else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
      }
    } catch {
      // Some browsers (iOS Safari on non-video elements) reject — silent
    }
  }, [targetRef]);

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={isFs ? "Exit fullscreen" : "Enter fullscreen"}
      title={isFs ? "Exit fullscreen" : "Fullscreen"}
      className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full transition-all active:scale-[0.94]"
      style={{
        background: "rgba(255,255,255,0.06)",
        border: "1px solid rgba(255,255,255,0.10)",
      }}
    >
      {isFs ? (
        <svg className="w-4 h-4 text-white/80" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9V4.5M15 9h4.5M15 9l5.25-5.25M15 15v4.5M15 15h4.5M15 15l5.25 5.25" />
        </svg>
      ) : (
        <svg className="w-4 h-4 text-white/80" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
        </svg>
      )}
    </button>
  );
}

/** Red velvet curtains flanking the Prime Video for Theater mode. */
function TheaterCurtains() {
  return (
    <>
      {/* Left curtain */}
      <div
        className="absolute left-0 top-0 bottom-0 pointer-events-none z-10"
        aria-hidden
        style={{
          width: "9%",
          background:
            "linear-gradient(90deg, rgba(30,5,10,0.98) 0%, rgba(150,15,35,0.65) 65%, rgba(180,30,55,0) 100%), " +
            "repeating-linear-gradient(90deg, rgba(255,255,255,0.05) 0 2px, transparent 2px 14px)",
        }}
      />
      {/* Right curtain */}
      <div
        className="absolute right-0 top-0 bottom-0 pointer-events-none z-10"
        aria-hidden
        style={{
          width: "9%",
          background:
            "linear-gradient(270deg, rgba(30,5,10,0.98) 0%, rgba(150,15,35,0.65) 65%, rgba(180,30,55,0) 100%), " +
            "repeating-linear-gradient(90deg, rgba(255,255,255,0.05) 0 2px, transparent 2px 14px)",
        }}
      />
      {/* Top valance — a short burgundy band hanging from the top edge */}
      <div
        className="absolute inset-x-0 top-0 h-4 pointer-events-none z-10"
        aria-hidden
        style={{
          background:
            "linear-gradient(180deg, rgba(90,10,20,0.95) 0%, rgba(180,30,55,0.25) 100%)",
          borderBottom: "1px solid rgba(255,180,80,0.25)",
        }}
      />
    </>
  );
}

/** Small circular cammer tile in the bottom-right for Karaoke mode. */
function KaraokeCammerOverlay({ spotlightIdentity }: { spotlightIdentity: string | null | undefined }) {
  const tracks = useTracks(
    [{ source: Track.Source.Camera, withPlaceholder: false }],
    { onlySubscribed: false }
  );
  const pick = tracks.find(
    (t) =>
      t.participant.identity !== MEDIA_IDENTITY &&
      (spotlightIdentity ? t.participant.identity === spotlightIdentity : true)
  );

  if (!pick) return null;

  return (
    <div
      className="absolute z-20 rounded-full overflow-hidden shadow-2xl"
      style={{
        width: 140,
        height: 140,
        bottom: "calc(96px + env(safe-area-inset-bottom, 0px))",
        right: "1rem",
        border: "3px solid rgba(212,0,122,0.55)",
        boxShadow: "0 12px 32px rgba(0,0,0,0.55), 0 0 24px rgba(212,0,122,0.35)",
      }}
    >
      <ParticipantTile
        trackRef={pick}
        disableSpeakingIndicator
        style={{ width: "100%", height: "100%" }}
      />
    </div>
  );
}

function NowPlayingChip({ title }: { title: string }) {
  return (
    <div
      className="pointer-events-none fixed z-30 flex items-center gap-2 px-3 py-1.5 rounded-full"
      style={{
        top: "calc(64px + env(safe-area-inset-top, 0px))",
        right: "1rem",
        maxWidth: "calc(100vw - 2rem)",
        background: "rgba(10,10,15,0.72)",
        border: "1px solid rgba(212,0,122,0.28)",
        backdropFilter: "blur(12px)",
      }}
      role="status"
      aria-live="polite"
      aria-label={`Now playing: ${title}`}
    >
      <span
        className="w-1.5 h-1.5 rounded-full flex-shrink-0"
        style={{ background: "#D4007A", boxShadow: "0 0 8px rgba(212,0,122,0.7)" }}
        aria-hidden
      />
      <span className="text-white/45 text-[10px] font-bold uppercase tracking-wider flex-shrink-0">
        Now playing
      </span>
      <span className="text-white text-xs font-medium truncate">{title}</span>
    </div>
  );
}

const TIP_FIRST_DELAY_MS = 10 * 1000;
const TIP_INTERVAL_MS = 5 * 60 * 1000;
const TIP_VISIBLE_MS = 15 * 1000;

type TipItem = { title: string; body: string };

function getWellnessTips(): TipItem[] {
  const lang = typeof navigator !== "undefined" && navigator.language?.startsWith("es") ? "es" : "en";
  const bundle = communityResources[lang];
  const items = [...bundle.harmReductionItems, ...bundle.mentalHealthItems];
  return items.map((it) => ({ title: it.title, body: it.body }));
}

function WellnessTipsOverlay() {
  const [tip, setTip] = useState<TipItem | null>(null);
  const [visible, setVisible] = useState(false);
  const indexRef = useRef(0);
  const tipsRef = useRef<TipItem[]>(getWellnessTips());
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const showNext = () => {
      const tips = tipsRef.current;
      if (!tips.length) return;
      const next = tips[indexRef.current % tips.length];
      indexRef.current += 1;
      setTip(next);
      setVisible(true);
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = setTimeout(() => setVisible(false), TIP_VISIBLE_MS);
    };

    // Show the first tip shortly after entry so users actually see one in a
    // typical session, then settle into the longer recurring cadence.
    const firstTimer = setTimeout(showNext, TIP_FIRST_DELAY_MS);
    const intervalId = setInterval(showNext, TIP_INTERVAL_MS);
    return () => {
      clearTimeout(firstTimer);
      clearInterval(intervalId);
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    };
  }, []);

  const handleClose = () => {
    setVisible(false);
    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
  };

  if (!tip) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed left-1/2 -translate-x-1/2 z-40 w-full max-w-[480px] px-4"
      style={{
        bottom: "calc(84px + env(safe-area-inset-bottom, 0px))",
        transform: `translate(-50%, ${visible ? "0" : "24px"})`,
        opacity: visible ? 1 : 0,
        transition: "transform 0.35s cubic-bezier(0.2,0.9,0.3,1), opacity 0.35s",
      }}
    >
      <div
        className="pointer-events-auto relative rounded-2xl p-4 pr-10"
        style={{
          background: "linear-gradient(135deg, rgba(15,15,22,0.92), rgba(25,15,35,0.92))",
          border: "1px solid rgba(212,0,122,0.35)",
          backdropFilter: "blur(20px)",
          boxShadow: "0 16px 48px rgba(0,0,0,0.45), 0 0 0 1px rgba(123,97,255,0.08) inset",
        }}
      >
        <div className="flex items-start gap-3">
          <div
            className="flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center mt-0.5"
            style={{
              background: "linear-gradient(135deg,rgba(212,0,122,0.25),rgba(123,97,255,0.25))",
              border: "1px solid rgba(212,0,122,0.35)",
            }}
          >
            <svg className="w-4 h-4" style={{ color: "#FF4FB0" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: "#FF4FB0" }}>
              Wellness tip
            </p>
            <p className="text-white text-[13px] font-semibold leading-snug mb-1">
              {tip.title}
            </p>
            <p className="text-white/70 text-[12px] leading-snug line-clamp-3">
              {tip.body}
            </p>
            <a
              href="/community-resources"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 mt-2 text-[11px] font-bold"
              style={{ color: "#7B61FF" }}
            >
              More resources
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </a>
          </div>
        </div>
        <button
          type="button"
          aria-label="Dismiss wellness tip"
          onClick={handleClose}
          className="absolute top-2.5 right-2.5 w-7 h-7 flex items-center justify-center rounded-full transition-all active:scale-[0.92]"
          style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)" }}
        >
          <svg className="w-3 h-3 text-white/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
