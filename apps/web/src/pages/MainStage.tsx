import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  LiveKitRoom,
  useLocalParticipant,
  useRoomContext,
  useTracks,
} from "@livekit/components-react";
import { ConnectionState, RoomEvent, Track } from "livekit-client";
import { useMainStage } from "@/hooks/useMainStage";
import { SpotlightGrid } from "@/components/mainstage/SpotlightGrid";
import { CinemaGrid } from "@/components/mainstage/CinemaGrid";
import { EqualGrid } from "@/components/mainstage/EqualGrid";

const MEDIA_IDENTITY = "mainstage-media";

// ── Cammer identity collection (needs LiveKit context) ────────────────────────

interface CammerInfo {
  identity: string;
  name: string;
}

function ParticipantCollector({ onCammersChange }: { onCammersChange: (cammers: CammerInfo[]) => void }) {
  const tracks = useTracks(
    [{ source: Track.Source.Camera, withPlaceholder: true }],
    { onlySubscribed: false }
  );
  useEffect(() => {
    onCammersChange(
      tracks.map((t) => ({ identity: t.participant.identity, name: t.participant.name || t.participant.identity }))
    );
  }, [tracks, onCammersChange]);
  return null;
}

// ── Mode label ────────────────────────────────────────────────────────────────

const MODE_LABELS: Record<string, string> = {
  spotlight: "Spotlight",
  cinema: "Cinema",
  equal: "Everyone",
};

const MODE_ICONS: Record<string, JSX.Element> = {
  spotlight: (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <circle cx="12" cy="10" r="4" />
      <path strokeLinecap="round" d="M12 14v5M8 19h8" />
    </svg>
  ),
  cinema: (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path strokeLinecap="round" d="M8 10l4 2.5L8 15z" fill="currentColor" />
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

// ── Bottom bar inner (needs LiveKit context) ──────────────────────────────────

interface BottomBarProps {
  canBeCammer: boolean;
  isCammer: boolean;
  isAdmin: boolean;
  counts: { cammers: number; viewers: number };
  onJoinCam: () => void;
  onLeaveCam: () => void;
  onOpenAdmin: () => void;
}

function BottomBarInner({
  canBeCammer,
  isCammer,
  isAdmin,
  counts,
  onJoinCam,
  onLeaveCam,
  onOpenAdmin,
}: BottomBarProps) {
  const { localParticipant, isCameraEnabled, isMicrophoneEnabled } = useLocalParticipant();

  const toggleCamera = useCallback(() => {
    localParticipant.setCameraEnabled(!isCameraEnabled);
  }, [localParticipant, isCameraEnabled]);

  const toggleMic = useCallback(() => {
    localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled);
  }, [localParticipant, isMicrophoneEnabled]);

  return (
    <div
      className="flex-shrink-0 flex items-center justify-between gap-3 px-4 py-3"
      style={{
        background: "rgba(10,10,15,0.9)",
        backdropFilter: "blur(16px)",
        borderTop: "1px solid rgba(255,255,255,0.07)",
        paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom, 0px))",
      }}
    >
      {/* Live counter */}
      <div className="flex items-center gap-2 min-w-0 flex-shrink-0">
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full" style={{ background: "rgba(255,255,255,0.06)" }}>
          <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse flex-shrink-0" aria-hidden />
          <span className="text-white text-xs font-semibold tabular-nums">{counts.cammers}</span>
          <span className="text-white/40 text-xs">cam</span>
          <span className="text-white/20 text-xs mx-0.5">·</span>
          <span className="text-white text-xs font-semibold tabular-nums">{counts.viewers}</span>
          <span className="text-white/40 text-xs">watching</span>
        </div>
      </div>

      {/* Cammer controls */}
      <div className="flex items-center gap-2 flex-shrink-0">
        {isCammer && (
          <>
            <button
              type="button"
              aria-label={isMicrophoneEnabled ? "Mute microphone" : "Unmute microphone"}
              onClick={toggleMic}
              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full transition-all active:scale-[0.94]"
              style={{
                background: isMicrophoneEnabled ? "rgba(255,255,255,0.08)" : "rgba(255,69,58,0.20)",
                border: isMicrophoneEnabled ? "1px solid rgba(255,255,255,0.12)" : "1px solid rgba(255,69,58,0.40)",
              }}
            >
              {isMicrophoneEnabled ? (
                <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
                </svg>
              ) : (
                <svg className="w-4 h-4 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3zM3 3l18 18" />
                </svg>
              )}
            </button>

            <button
              type="button"
              aria-label={isCameraEnabled ? "Turn off camera" : "Turn on camera"}
              onClick={toggleCamera}
              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full transition-all active:scale-[0.94]"
              style={{
                background: isCameraEnabled ? "rgba(255,255,255,0.08)" : "rgba(255,69,58,0.20)",
                border: isCameraEnabled ? "1px solid rgba(255,255,255,0.12)" : "1px solid rgba(255,69,58,0.40)",
              }}
            >
              {isCameraEnabled ? (
                <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9A2.25 2.25 0 004.5 18.75z" />
                </svg>
              ) : (
                <svg className="w-4 h-4 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9A2.25 2.25 0 004.5 18.75zM3 3l18 18" />
                </svg>
              )}
            </button>
          </>
        )}

        {canBeCammer && (
          isCammer ? (
            <button
              type="button"
              onClick={onLeaveCam}
              className="min-h-[44px] px-4 rounded-full text-xs font-bold text-white transition-all active:scale-[0.96]"
              style={{
                background: "rgba(255,69,58,0.18)",
                border: "1px solid rgba(255,69,58,0.35)",
                color: "#FF453A",
              }}
            >
              Leave cam
            </button>
          ) : (
            <button
              type="button"
              onClick={onJoinCam}
              className="min-h-[44px] px-4 rounded-full text-xs font-bold text-white transition-all active:scale-[0.96]"
              style={{
                background: "linear-gradient(135deg,#D4007A,#7B61FF)",
                boxShadow: "0 4px 16px rgba(212,0,122,0.35)",
              }}
            >
              Go on cam
            </button>
          )
        )}

        {isAdmin && (
          <button
            type="button"
            aria-label="Open admin controls"
            onClick={onOpenAdmin}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full transition-all active:scale-[0.94] hover:opacity-80"
            style={{
              background: "rgba(123,97,255,0.15)",
              border: "1px solid rgba(123,97,255,0.30)",
            }}
          >
            <svg className="w-4 h-4" style={{ color: "#7B61FF" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

// ── Connection state overlay ──────────────────────────────────────────────────

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

// ── Room event listener ───────────────────────────────────────────────────────

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

// ── MainStage inner (inside LiveKitRoom) ─────────────────────────────────────

interface MainStageInnerProps {
  mode: "spotlight" | "cinema" | "equal";
  spotlightCammer: string | null;
  spotlightNextAt: number | null;
  mediaKind: "video" | "music" | "off";
  mediaSrc: string | null;
  canBeCammer: boolean;
  isAdmin: boolean;
  counts: { cammers: number; viewers: number };
  isCammer: boolean;
  onJoinCam: () => void;
  onLeaveCam: () => void;
  onOpenAdmin: () => void;
  onSpotlightPick: (identity: string) => void;
  onConnectionStateChange: (state: ConnectionState) => void;
  onCammersChange: (cammers: CammerInfo[]) => void;
}

function MainStageInner({
  mode,
  spotlightCammer,
  spotlightNextAt,
  mediaKind,
  mediaSrc,
  canBeCammer,
  isAdmin,
  counts,
  isCammer,
  onJoinCam,
  onLeaveCam,
  onOpenAdmin,
  onSpotlightPick,
  onConnectionStateChange,
  onCammersChange,
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
          />
        )}
        {mode === "equal" && <EqualGrid />}
      </div>

      <BottomBarInner
        canBeCammer={canBeCammer}
        isCammer={isCammer}
        isAdmin={isAdmin}
        counts={counts}
        onJoinCam={onJoinCam}
        onLeaveCam={onLeaveCam}
        onOpenAdmin={onOpenAdmin}
      />
    </>
  );
}

// ── MainStage page ────────────────────────────────────────────────────────────

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
    admin,
  } = useMainStage();

  const [adminOpen, setAdminOpen] = useState(false);
  const [connState, setConnState] = useState<ConnectionState>(ConnectionState.Connecting);
  const [cammerInfos, setCammerInfos] = useState<CammerInfo[]>([]);
  const isCammer = role === "cammer" || role === "admin";

  useEffect(() => {
    setConnState(ConnectionState.Connecting);
  }, [token]);

  const handleJoinCam = useCallback(async () => {
    await joinAsCammer();
  }, [joinAsCammer]);

  const handleLeaveCam = useCallback(async () => {
    await leaveCammer();
  }, [leaveCammer]);

  const handleCammersChange = useCallback((infos: CammerInfo[]) => {
    setCammerInfos(infos);
  }, []);

  // Loading skeleton
  if (loading) {
    return (
      <div
        className="fixed inset-0 flex flex-col"
        style={{ background: "#0A0A0F" }}
        role="status"
        aria-label="Loading Main Stage"
      >
        {/* Header skeleton */}
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
        {/* Video area skeleton */}
        <div className="flex-1 animate-pulse" style={{ background: "rgba(255,255,255,0.03)" }}>
          <div className="absolute inset-0 flex items-center justify-center">
            <div
              className="w-10 h-10 rounded-full border-2 animate-spin"
              style={{ borderColor: "rgba(212,0,122,0.2)", borderTopColor: "#D4007A" }}
            />
          </div>
        </div>
        {/* Bottom bar skeleton */}
        <div
          className="flex-shrink-0 h-16 animate-pulse"
          style={{ background: "rgba(10,10,15,0.9)", borderTop: "1px solid rgba(255,255,255,0.06)" }}
        />
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div
        className="fixed inset-0 flex flex-col items-center justify-center gap-5 px-6 text-center"
        style={{ background: "#0A0A0F" }}
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

  if (!token || !state) return null;

  const mode = state.mode;
  const liveCammers = state?.counts?.cammers ?? 0;

  return (
    <div
      className="fixed inset-0 flex flex-col"
      style={{ background: "#0A0A0F" }}
    >
      {/* Header */}
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
        {/* Logo */}
        <img
          src="/logo-login.png"
          alt="PNPtv!"
          className="h-7 w-auto object-contain"
          style={{ filter: "brightness(1.1)" }}
        />

        {/* Mode indicator */}
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

        {/* Close */}
        <button
          type="button"
          aria-label="Leave Main Stage"
          onClick={() => navigate(-1)}
          className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full transition-all hover:opacity-70 active:scale-[0.92]"
          style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.10)" }}
        >
          <svg className="w-4 h-4 text-white/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </header>

      {/* Reconnecting banner */}
      {connState === ConnectionState.Reconnecting && (
        <div
          className="absolute top-14 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold"
          style={{ background: "#E69138", color: "#000" }}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-black/40 animate-pulse" />
          Reconnecting…
        </div>
      )}

      {/* LiveKit room */}
      <LiveKitRoom
        key={token}
        token={token}
        serverUrl={livekitUrl}
        connect={true}
        audio={isCammer}
        video={isCammer}
        options={{
          adaptiveStream: true,
          dynacast: true,
          publishDefaults: { simulcast: true },
        }}
        style={{ display: "contents" }}
      >
        <MainStageInner
          mode={mode}
          spotlightCammer={state?.spotlight?.cammer}
          spotlightNextAt={state?.spotlight?.nextAt}
          mediaKind={state?.media?.kind || "off"}
          mediaSrc={state?.media?.src}
          canBeCammer={canBeCammer}
          isAdmin={isAdmin}
          counts={state?.counts || { cammers: 0, viewers: 0 }}
          isCammer={isCammer}
          onJoinCam={handleJoinCam}
          onLeaveCam={handleLeaveCam}
          onOpenAdmin={() => setAdminOpen(true)}
          onSpotlightPick={(identity) => admin.setSpotlight(identity)}
          onConnectionStateChange={setConnState}
          onCammersChange={handleCammersChange}
        />
      </LiveKitRoom>

      <ConnectionOverlay connState={connState} />

      {/* Admin drawer */}
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

// ── Inline admin drawer (embedded, not standalone) ────────────────────────────

interface AdminDrawerProps {
  state: import("@/hooks/useMainStage").MainStageState;
  admin: ReturnType<typeof useMainStage>["admin"];
  cammerInfos: CammerInfo[];
  onClose: () => void;
}

function AdminDrawer({ state, admin, cammerInfos, onClose }: AdminDrawerProps) {
  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40"
        style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }}
        onClick={onClose}
        aria-hidden
      />
      {/* Drawer */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Admin controls"
        className="fixed top-0 right-0 bottom-0 z-50 overflow-y-auto"
        style={{
          width: "min(384px, 100vw)",
          background: "#111117",
          borderLeft: "1px solid rgba(255,255,255,0.08)",
          paddingTop: "env(safe-area-inset-top, 0px)",
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
        }}
      >
        {/* Inline admin content — imports MainStageAdmin logic */}
        <AdminPanelContent state={state} admin={admin} cammerInfos={cammerInfos} onClose={onClose} />
      </aside>
    </>
  );
}

// ── Inline admin panel content ────────────────────────────────────────────────

type AdminType = ReturnType<typeof useMainStage>["admin"];

interface AdminPanelContentProps {
  state: import("@/hooks/useMainStage").MainStageState;
  admin: AdminType;
  cammerInfos: CammerInfo[];
  onClose?: () => void;
}

const MODES: Array<{ id: "spotlight" | "cinema" | "equal"; label: string; sub: string; icon: JSX.Element }> = [
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

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div
        className="flex-shrink-0 flex items-center justify-between px-4 py-4"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}
      >
        <div>
          <h2 className="text-white font-bold text-sm">Admin Controls</h2>
          <p className="text-white/40 text-xs mt-0.5">
            {state?.counts?.cammers || 0} cammers · {state?.counts?.viewers || 0} watching
          </p>
        </div>
        {onClose && (
          <button
            type="button"
            aria-label="Close admin panel"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full hover:opacity-70 transition-opacity active:scale-[0.94]"
            style={{ background: "rgba(255,255,255,0.06)" }}
          >
            <svg className="w-4 h-4 text-white/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto space-y-5 p-4">
        {/* Mode picker */}
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

        {/* Media controls */}
        <section>
          <h3 className="text-white/50 text-[10px] font-bold uppercase tracking-widest mb-2.5">Media</h3>
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

        {/* Participants */}
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
