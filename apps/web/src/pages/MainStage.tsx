import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  LiveKitRoom,
  ParticipantTile,
  useLocalParticipant,
  useRoomContext,
  useTracks,
} from "@livekit/components-react";
import { ConnectionState, RoomEvent, Track } from "livekit-client";
import { useMainStage, type MainStageState } from "@/hooks/useMainStage";
import { useMainStageRoom } from "@/components/mainstage/MainStageProvider";
import { getMainStageJoinCheck, acceptMainStageConsents, type MainStageJoinCheck } from "@/lib/api";
import { useMusicPlayer } from "@/hooks/useMusicPlayer";
import { useTutorial } from "@/hooks/useTutorial";
import { TutorialOverlay } from "@/components/tutorial/TutorialOverlay";
import { SpotlightGrid } from "@/components/mainstage/SpotlightGrid";
import { CinemaGrid } from "@/components/mainstage/CinemaGrid";
import { EqualGrid } from "@/components/mainstage/EqualGrid";
import InvitePanel from "@/components/mainstage/InvitePanel";
import { getFeaturedPrimeVideos, getAssetUrl, type PrimeVideo } from "@/lib/directus";
import { MEDIA_IDENTITY } from "@/components/mainstage/CinemaGrid";
import { useI18n } from "@/lib/i18n";
import { GUEST_SESSION_KEY } from "@/pages/MainStageGuestJoin";
import { getLocalizedTips, type MainStageTip } from "@/lib/i18n/mainStageTips";

// ── Guest credential shape (written by MainStageGuestJoin, consumed once here) ─

interface GuestCredentials {
  token:       string;
  livekitUrl:  string;
  roomName:    string;
  displayName: string;
  identity:    string;
}

function readAndClearGuestCredentials(): GuestCredentials | null {
  try {
    const raw = sessionStorage.getItem(GUEST_SESSION_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(GUEST_SESSION_KEY);
    const parsed = JSON.parse(raw) as Partial<GuestCredentials>;
    if (
      typeof parsed.token       === "string" &&
      typeof parsed.livekitUrl  === "string" &&
      typeof parsed.roomName    === "string" &&
      typeof parsed.displayName === "string"
    ) {
      return parsed as GuestCredentials;
    }
  } catch {
    // sessionStorage blocked or JSON corrupt
  }
  return null;
}

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
  isParticipant: boolean;
  isAdmin: boolean;
  onLeave: () => void;
  spotlight?: MainStageState["spotlight"];
}

function BottomBarInner({
  isParticipant,
  isAdmin,
  onLeave,
  spotlight,
}: BottomBarProps) {
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant();
  const t = useI18n();

  // Queue-position indicator for cammers: shows "Position X / Y" or "Live now".
  // Re-renders every second when nextAt is set so the countdown stays current.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!isParticipant || !spotlight?.nextAt) return;
    const iv = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(iv);
  }, [isParticipant, spotlight?.nextAt]);

  const queueChip = (() => {
    if (!isParticipant || !spotlight) return null;
    const myIdentity = localParticipant?.identity || "";
    const queue = spotlight.queue || [];
    const myPos = queue.indexOf(myIdentity);
    const isLive = !!myIdentity && spotlight.cammer === myIdentity;
    if (isLive) {
      return (
        <span className="hidden md:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold bg-pnp-accent/15 border border-pnp-accent/30 text-pnp-accent">
          <span className="relative flex h-1.5 w-1.5">
            <span className="motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full bg-pnp-accent opacity-75" />
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-pnp-accent" />
          </span>
          {t.live.mainStageQueueLive}
        </span>
      );
    }
    if (myPos < 0) return null;
    const total = queue.length || 1;
    const secsToNext = spotlight.nextAt
      ? Math.max(0, Math.ceil((spotlight.nextAt - nowMs) / 1000))
      : 0;
    return (
      <span className="hidden md:inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold bg-white/[0.06] border border-white/10 text-white/70 tabular-nums">
        <span>{t.live.mainStageQueuePosition(myPos + 1, total)}</span>
        {spotlight.nextAt && myPos === 0 && (
          <span className="text-pnp-amber">· {t.live.mainStageQueueNext(secsToNext)}</span>
        )}
      </span>
    );
  })();

  // Cam/mic toggles are admin-only. Non-admin participants are subject to
  // forced-camera-on + forced-mic-mute rules enforced by MainStageProvider
  // (and the guest-room enforcer below).
  const handleMicToggle = useCallback(() => {
    if (!isAdmin) return;
    localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled);
  }, [isAdmin, localParticipant, isMicrophoneEnabled]);

  const handleCamToggle = useCallback(() => {
    if (!isAdmin) return;
    localParticipant.setCameraEnabled(!isCameraEnabled);
  }, [isAdmin, isCameraEnabled, localParticipant]);

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
        aria-label={t.live.mainStageAriaLeave}
        className="min-h-[40px] min-w-[40px] flex-shrink-0 flex items-center justify-center gap-1 px-2.5 rounded-full text-xs font-bold transition-all hover:bg-white/10 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black bg-pnp-error/15 border border-pnp-error/30 text-pnp-error"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
        </svg>
        <span className="hidden sm:inline">{t.live.mainStageLeave}</span>
      </button>

      {queueChip}

      {isParticipant && isAdmin && (
        <button
          type="button"
          onClick={handleCamToggle}
          aria-label={isCameraEnabled ? "Turn camera off" : "Turn camera on"}
          title={isCameraEnabled ? "Turn camera off" : "Turn camera on"}
          aria-pressed={isCameraEnabled}
          className="min-h-[40px] flex-shrink-0 flex items-center gap-1.5 px-3 rounded-full text-xs font-bold text-white transition-all hover:bg-white/10 active:scale-[0.94] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black"
          style={{
            background: isCameraEnabled
              ? "rgba(255,69,58,0.18)"
              : "linear-gradient(135deg,#D4007A,#7B61FF)",
            border: isCameraEnabled
              ? "1px solid rgba(255,69,58,0.45)"
              : "1px solid rgba(212,0,122,0.60)",
            boxShadow: isCameraEnabled
              ? "0 2px 10px rgba(255,69,58,0.25)"
              : "0 4px 16px rgba(212,0,122,0.45)",
            color: isCameraEnabled ? "#FF453A" : "#FFFFFF",
          }}
        >
          {isCameraEnabled ? (
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9A2.25 2.25 0 004.5 18.75zM3 3l18 18" />
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9A2.25 2.25 0 004.5 18.75z" />
            </svg>
          )}
          <span>Camera</span>
        </button>
      )}

      {isParticipant && isAdmin && (
        <button
          type="button"
          onClick={handleMicToggle}
          aria-label={isMicrophoneEnabled ? t.live.mainStageAriaMicMute : t.live.mainStageAriaMicUnmute}
          title={isMicrophoneEnabled ? "Mute" : "Unmute"}
          aria-pressed={isMicrophoneEnabled}
          className="min-h-[40px] min-w-[40px] flex-shrink-0 flex items-center justify-center rounded-full transition-all hover:bg-white/10 active:scale-[0.94] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black"
          style={{
            background: isMicrophoneEnabled
              ? "rgba(212,0,122,0.18)"
              : "rgba(255,255,255,0.05)",
            border: isMicrophoneEnabled
              ? "1px solid rgba(212,0,122,0.40)"
              : "1px solid rgba(255,255,255,0.12)",
          }}
        >
          {isMicrophoneEnabled ? (
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

      {isParticipant && !isAdmin && (
        <span
          className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold text-white/70"
          style={{
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.10)",
          }}
          title="Camera is required and your microphone is muted by the stage."
        >
          <svg className="w-3 h-3 text-pnp-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9A2.25 2.25 0 004.5 18.75z" />
          </svg>
          <span>Cam on · Mic muted</span>
        </span>
      )}

    </div>
  );
}

function ConnectionOverlay({
  connState,
  errorMessage,
}: {
  connState: ConnectionState;
  errorMessage?: string | null;
}) {
  const t = useI18n();
  const [dismissed, setDismissed] = useState(false);
  const [showEscape, setShowEscape] = useState(false);

  const isDisconnected = connState === ConnectionState.Disconnected;

  // Reset escape hatch every time the state actually changes.
  useEffect(() => {
    setShowEscape(false);
    setDismissed(false);
    if (connState === ConnectionState.Connected) return;
    // Disconnected: surface the retry immediately. Connecting/Reconnecting
    // gets the usual 6s breathing room first.
    const delay = isDisconnected ? 0 : 6000;
    const tid = setTimeout(() => setShowEscape(true), delay);
    return () => clearTimeout(tid);
  }, [connState, isDisconnected]);

  if (connState === ConnectionState.Connected) return null;
  if (dismissed) return null;

  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center"
      style={{ background: "rgba(10,10,15,0.92)", backdropFilter: "blur(12px)" }}
    >
      <div className="flex flex-col items-center gap-3 px-6 text-center max-w-xs">
        {!isDisconnected && (
          <div
            className="w-10 h-10 rounded-full border-2 animate-spin"
            style={{ borderColor: "rgba(212,0,122,0.3)", borderTopColor: "#D4007A" }}
          />
        )}
        {isDisconnected && (
          <div
            className="w-12 h-12 rounded-2xl flex items-center justify-center"
            style={{ background: "rgba(255,69,58,0.12)", border: "1px solid rgba(255,69,58,0.30)" }}
          >
            <svg className="w-7 h-7 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728L5.636 5.636m12.728 12.728L18.364 5.636M5.636 18.364l12.728-12.728" />
            </svg>
          </div>
        )}
        <p className="text-white/85 text-sm font-semibold">
          {isDisconnected
            ? "Conexión perdida / Connection lost"
            : connState === ConnectionState.Reconnecting
              ? t.live.mainStageReconnecting
              : t.live.mainStageConnecting}
        </p>
        <p className="text-white/40 text-[11px] font-mono">state: {String(connState)}</p>
        {errorMessage && (
          <p className="text-pnp-error/80 text-[11px] leading-snug max-w-[260px]">{errorMessage}</p>
        )}
        {showEscape && (
          <div className="flex gap-2 mt-1">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="min-h-[40px] px-4 rounded-full text-xs font-bold text-white transition-all active:scale-[0.97]"
              style={{
                background: "linear-gradient(135deg,#D4007A,#7B61FF)",
                border: "1px solid rgba(212,0,122,0.55)",
              }}
            >
              Reintentar / Try again
            </button>
            {!isDisconnected && (
              <button
                type="button"
                onClick={() => setDismissed(true)}
                className="min-h-[40px] px-4 rounded-full text-xs font-semibold text-white/80 transition-all active:scale-[0.97]"
                style={{
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(255,255,255,0.12)",
                }}
              >
                Continuar / Continue
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * ForceCamMicEnforcer — guest-only stage-rule enforcer.
 * Authenticated users are covered by MainStageProvider's listener that
 * runs across route changes. Guests bypass the provider, so we keep a
 * lightweight listener here while they are on /main-stage. We only act
 * once the room is fully Connected to avoid disrupting publish during
 * the connect/reconnect window.
 */
function ForceCamMicEnforcer({ active }: { active: boolean }) {
  const room = useRoomContext();
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant();

  useEffect(() => {
    if (!active || !localParticipant) return;
    if (room.state !== ConnectionState.Connected) return;
    let disposed = false;

    const enforce = async () => {
      if (disposed) return;
      try {
        if (isMicrophoneEnabled) {
          await localParticipant.setMicrophoneEnabled(false);
        }
        if (!isCameraEnabled) {
          await localParticipant.setCameraEnabled(true);
        }
      } catch {
        // Permission denied / no device — onMediaDeviceFailure surfaces it.
      }
    };

    void enforce();

    return () => { disposed = true; };
  }, [active, localParticipant, isMicrophoneEnabled, isCameraEnabled, room]);

  return null;
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
  isParticipant: boolean;
  isAdmin: boolean;
  onSpotlightPick: (identity: string) => void;
  onConnectionStateChange: (state: ConnectionState) => void;
  onCammersChange: (cammers: CammerInfo[]) => void;
  onLeave: () => void;
  spotlight?: MainStageState["spotlight"];
  showTips: boolean;
}

function MainStageInner({
  mode,
  spotlightCammer,
  spotlightNextAt,
  mediaKind,
  mediaSrc,
  mediaPlaying,
  mediaVolume,
  isParticipant,
  isAdmin,
  onSpotlightPick,
  onConnectionStateChange,
  onCammersChange,
  onLeave,
  spotlight,
  showTips,
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

      {/* Slim positive-tips ribbon — sits between cam grid and bottom bar
          so it is never in front of cammer video tiles. */}
      {showTips && <WellnessTipsOverlay />}

      <BottomBarInner
        isParticipant={isParticipant}
        isAdmin={isAdmin}
        onLeave={onLeave}
        spotlight={spotlight}
      />
    </>
  );
}

export default function MainStage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const t = useI18n();
  const { showTutorial, dismissTutorial, dismissForever, openTutorial } = useTutorial("mainstage");

  // Read guest credentials exactly once on mount (before useMainStage runs).
  const guestCredsRef = useRef<GuestCredentials | null>(
    searchParams.get("guest") === "1" ? readAndClearGuestCredentials() : null
  );
  const isGuestMode = guestCredsRef.current !== null;

  const {
    state:       hookedState,
    isAdmin,
    role:        hookedRole,
    loading:     hookedLoading,
    error:       hookedError,
    isJoined,
    join,
    leave,
    shuffle,
    admin,
  } = useMainStage();

  // Pull the shared Room instance from the provider. Members use the
  // provider-managed connection (persistent across route changes). Guests
  // bypass the provider entirely and use their own short-lived <LiveKitRoom>
  // with the guest token.
  const { room } = useMainStageRoom();

  // Resolve effective values: guest path overrides everything from the hook.
  const state       = hookedState;
  const role        = isGuestMode ? ("guest" as const) : hookedRole;
  const loading     = isGuestMode ? false              : hookedLoading;
  const error       = isGuestMode ? null               : hookedError;

  const [adminOpen, setAdminOpen] = useState(false);
  const [connState, setConnState] = useState<ConnectionState>(ConnectionState.Connecting);
  const [cammerInfos, setCammerInfos] = useState<CammerInfo[]>([]);
  const [camError, setCamError] = useState<string | null>(null);
  const [joining, setJoining] = useState(!isGuestMode);
  const [joinCheck, setJoinCheck] = useState<MainStageJoinCheck | null>(null);
  const [consentError, setConsentError] = useState<string | null>(null);
  const [acceptingConsents, setAcceptingConsents] = useState(false);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [acceptPrivacy, setAcceptPrivacy] = useState(false);
  const [confirmAge, setConfirmAge] = useState(false);
  const isParticipant = isGuestMode || role === "participant" || role === "admin";
  // Clear stale camera-permission banners whenever the user leaves the room.
  useEffect(() => {
    if (!isParticipant) setCamError(null);
  }, [isParticipant]);

  useEffect(() => {
    if (isGuestMode) return;
    let cancelled = false;
    getMainStageJoinCheck()
      .then((check) => {
        if (!cancelled) {
          setJoinCheck(check);
          if (!check.requiresAgeVerification) setConfirmAge(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setConsentError("We couldn't verify Main Stage access requirements. Please try again.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isGuestMode]);

  useEffect(() => {
    if (isGuestMode) return;
    if (!joinCheck?.canJoin) {
      setJoining(false);
      return;
    }
    let cancelled = false;
    setJoining(true);
    join()
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setJoining(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isGuestMode, join, joinCheck?.canJoin]);

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
    // Skip if the admin has music streaming via LiveKit ingress — playing our
    // local radio on top would double-up audio.
    if (state?.media?.kind === "music" && state?.media?.playing === true) {
      hasAutoStartedMusicRef.current = true;
      return;
    }
    hasAutoStartedMusicRef.current = true;
    playMusic();
  }, [musicTracks, musicIsPlaying, playMusic, state?.media?.kind, state?.media?.playing]);

  const handleCammersChange = useCallback((infos: CammerInfo[]) => {
    setCammerInfos(infos);
  }, []);

  const handleLeave = useCallback(() => {
    if (!isGuestMode) leave();
    navigate(-1);
  }, [isGuestMode, leave, navigate]);

  const handleAcceptConsents = useCallback(async () => {
    setConsentError(null);
    if (!acceptTerms || !acceptPrivacy || !confirmAge) {
      setConsentError("You must accept the Terms, Privacy Policy, and confirm you are 18+ to join Main Stage.");
      return;
    }
    try {
      setAcceptingConsents(true);
      const check = await acceptMainStageConsents({
        acceptTerms: true,
        acceptPrivacy: true,
        ageConfirmed: true,
      });
      setJoinCheck(check);
    } catch (err) {
      setConsentError(err instanceof Error ? err.message : "Failed to save Main Stage consents");
    } finally {
      setAcceptingConsents(false);
    }
  }, [acceptPrivacy, acceptTerms, confirmAge]);

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

  if (
    !isGuestMode &&
    !error &&
    (
      loading ||
      joining ||
      (joinCheck?.canJoin === true && !isJoined) ||
      (!joinCheck && !consentError)
    )
  ) {
    return (
      <div
        className="fixed inset-0 flex flex-col bg-pnp-background"
        role="status"
        aria-label={t.live.mainStageLoading}
      >
        <div
          className="flex-shrink-0 flex items-center justify-between px-4 h-14"
          style={{
            background: "rgba(10,10,15,0.9)",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
            paddingTop: "env(safe-area-inset-top, 0px)",
          }}
        >
          <div className="w-20 h-4 rounded animate-pulse bg-white/[0.08]" />
          <div className="w-24 h-5 rounded animate-pulse bg-white/[0.06]" />
          <div className="w-8 h-8 rounded-full animate-pulse bg-white/[0.08]" />
        </div>
        <div className="flex-1 animate-pulse bg-white/[0.03]">
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
      <div className="fixed inset-0 flex flex-col items-center justify-center gap-5 px-6 text-center bg-pnp-background">
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center bg-pnp-error/[0.12] border border-pnp-error/25">
          <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
        </div>
        <div>
          <p className="text-pnp-text-primary font-semibold text-sm mb-1">{t.live.mainStageFailedToConnect}</p>
          <p className="text-white/50 text-xs">{error}</p>
        </div>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="min-h-[44px] px-5 rounded-2xl text-sm font-semibold text-white transition-all active:scale-[0.97]"
            style={{ background: "linear-gradient(135deg,#D4007A,#7B61FF)" }}
          >
            {t.live.mainStageTryAgain}
          </button>
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="min-h-[44px] px-5 rounded-2xl text-sm font-semibold text-white/60 transition-all active:scale-[0.97] bg-white/[0.06] border border-white/10"
          >
            {t.live.mainStageGoBack}
          </button>
        </div>
      </div>
    );
  }

  if (!isGuestMode && consentError && !joinCheck) {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center gap-5 px-6 text-center bg-pnp-background">
        <div>
          <p className="text-pnp-text-primary font-semibold text-sm mb-1">Main Stage Access Check Failed</p>
          <p className="text-white/50 text-xs">{consentError}</p>
        </div>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="min-h-[44px] px-5 rounded-2xl text-sm font-semibold text-white"
          style={{ background: "linear-gradient(135deg,#D4007A,#7B61FF)" }}
        >
          Try Again
        </button>
      </div>
    );
  }

  if (!isGuestMode && joinCheck && !joinCheck.canJoin) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-pnp-background px-6 py-10">
        <div className="w-full max-w-md rounded-3xl border border-white/10 bg-white/[0.04] p-6 text-white shadow-2xl">
          <h1 className="text-xl font-bold mb-2">Before You Join Main Stage</h1>
          <p className="text-sm text-white/70 mb-5">
            Main Stage requires current consent to the Terms and Conditions, Privacy Policy, and confirmation that you are 18 or older.
          </p>
          <div className="space-y-3 text-sm">
            <label className="flex items-start gap-3">
              <input type="checkbox" checked={acceptTerms} onChange={(e) => setAcceptTerms(e.target.checked)} className="mt-1" />
              <span>
                I accept the <a href="/terms" target="_blank" rel="noreferrer" className="text-pnp-accent underline">Terms and Conditions</a>.
              </span>
            </label>
            <label className="flex items-start gap-3">
              <input type="checkbox" checked={acceptPrivacy} onChange={(e) => setAcceptPrivacy(e.target.checked)} className="mt-1" />
              <span>
                I accept the <a href="/privacy" target="_blank" rel="noreferrer" className="text-pnp-accent underline">Privacy Policy</a>.
              </span>
            </label>
            <label className="flex items-start gap-3">
              <input type="checkbox" checked={confirmAge} onChange={(e) => setConfirmAge(e.target.checked)} className="mt-1" />
              <span>I confirm that I am 18 years of age or older.</span>
            </label>
          </div>
          {consentError && (
            <p className="mt-4 text-sm text-red-400">{consentError}</p>
          )}
          <div className="mt-6 flex gap-3">
            <button
              type="button"
              onClick={handleAcceptConsents}
              disabled={acceptingConsents}
              className="min-h-[44px] flex-1 rounded-2xl px-5 text-sm font-semibold text-white"
              style={{ background: "linear-gradient(135deg,#D4007A,#7B61FF)" }}
            >
              {acceptingConsents ? "Saving..." : "Accept and Join"}
            </button>
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="min-h-[44px] rounded-2xl border border-white/10 bg-white/[0.06] px-5 text-sm font-semibold text-white/70"
            >
              Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Guests need a connecting spinner while state arrives async via socket;
  // showing the "unavailable" error before state hydrates would be wrong.
  if (isGuestMode && guestCredsRef.current && !state) {
    return (
      <div
        className="fixed inset-0 flex flex-col bg-pnp-background"
        role="status"
        aria-label="Connecting to Main Stage"
      >
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <div
              className="w-10 h-10 rounded-full border-2 animate-spin"
              style={{ borderColor: "rgba(212,0,122,0.2)", borderTopColor: "#D4007A" }}
            />
            <p className="text-white/50 text-sm">
              Connecting… / Conectando…
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center gap-5 px-6 text-center bg-pnp-background">
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center bg-pnp-purple/[0.12] border border-pnp-purple/25">
          <svg className="w-8 h-8 text-pnp-purple" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
        </div>
        <div>
          <p className="text-pnp-text-primary font-semibold text-sm mb-1">{t.live.mainStageUnavailable}</p>
          <p className="text-white/50 text-xs">{t.live.mainStageNoState}</p>
        </div>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="min-h-[44px] px-5 rounded-2xl text-sm font-semibold text-white transition-all active:scale-[0.97]"
            style={{ background: "linear-gradient(135deg,#D4007A,#7B61FF)" }}
          >
            {t.live.mainStageReload}
          </button>
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="min-h-[44px] px-5 rounded-2xl text-sm font-semibold text-white/60 transition-all active:scale-[0.97] bg-white/[0.06] border border-white/10"
          >
            {t.live.mainStageGoBack}
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

  // i18n mode label lookup — used in header and toolbar aria-labels.
  const modeLabels: Record<ModeId, string> = {
    spotlight: t.live.mainStageModeSpotlight,
    theater: t.live.mainStageModeTheater,
    cinema: t.live.mainStageModeCinema,
    karaoke: t.live.mainStageModeKaraoke,
    equal: t.live.mainStageModeEqual,
  };

  return (
    <div
      ref={stageRootRef}
      className="fixed inset-0 lg:left-72 flex flex-col bg-pnp-background"
    >
      {showTutorial && (
        <TutorialOverlay
          section="mainstage"
          onDismiss={dismissTutorial}
          onDismissForever={dismissForever}
        />
      )}
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
          className="h-7 w-auto object-contain brightness-110"
        />

        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-white/[0.06] border border-white/10 text-white/80">
          <span className="text-pnp-accent">{MODE_ICONS[mode]}</span>
          <span>{t.live.mainStageTitle}</span>
          <span className="text-white/30 mx-0.5">·</span>
          <span className="text-white/55">{modeLabels[mode]}</span>
          {liveCammers > 0 && (
            <>
              <span className="text-white/20 mx-0.5">·</span>
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse flex-shrink-0" />
              <span className="tabular-nums text-white/70">{liveCammers}</span>
            </>
          )}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {isGuestMode && (
            <span
              className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold"
              style={{
                background: "rgba(123,97,255,0.18)",
                border:     "1px solid rgba(123,97,255,0.40)",
                color:      "#A990FF",
              }}
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
              </svg>
              Guest
            </span>
          )}
          <button
            type="button"
            aria-label={t.live.mainStageAriaLeave}
            onClick={handleLeave}
            className="min-h-[36px] min-w-[36px] flex-shrink-0 flex items-center justify-center rounded-full transition-all hover:opacity-70 active:scale-[0.92] bg-white/[0.06] border border-white/10"
          >
            <svg className="w-3.5 h-3.5 text-white/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </header>

      {/* Floating vertical toolbar — fixed-positioned on the right edge,
          always visible at any viewport size. Contains the per-user view
          controls (cycle, reset) and shared utilities (shuffle, fullscreen,
          admin). Stacked vertically so it scales down to the narrowest
          phone without overflowing. Hidden while AdminDrawer is open so
          buttons remain reachable and don't bleed through the drawer scrim. */}
      <div
        className={`absolute flex flex-col items-center gap-2 z-40${adminOpen ? " hidden" : ""}`}
        style={{
          top: "calc(64px + env(safe-area-inset-top, 0px))",
          right: "calc(0.5rem + env(safe-area-inset-right, 0px))",
          // Defensive cap on small viewports — if more buttons get added,
          // the toolbar scrolls instead of running off-screen.
          maxHeight: "calc(100dvh - 200px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px))",
          overflowY: "auto",
          scrollbarWidth: "none",
        }}
      >
        <button
          type="button"
          onClick={handleCycleMode}
          aria-label={`Switch your view — current: ${modeLabels[mode]}. Next: ${modeLabels[NEXT_MODE[mode]]}`}
          title={`Your view · ${modeLabels[mode]} → ${modeLabels[NEXT_MODE[mode]]}`}
          className="relative min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full transition-all hover:bg-white/10 active:scale-[0.94] shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black"
          style={{
            background: "linear-gradient(135deg, rgba(212,0,122,0.85), rgba(123,97,255,0.80))",
            border: "1px solid rgba(255,255,255,0.25)",
            boxShadow: "0 4px 16px rgba(0,0,0,0.45), 0 0 0 1px rgba(212,0,122,0.30)",
          }}
        >
          <span className="text-white">{MODE_ICONS[mode]}</span>
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
            aria-label={`Reset to room default (${modeLabels[(state?.mode as ModeId) ?? "spotlight"]})`}
            title={t.live.mainStageAriaResetView}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full transition-all hover:bg-white/10 active:scale-[0.94] shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black"
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
          aria-label={t.live.mainStageAriaShuffle}
          title={t.live.mainStageAriaShuffle}
          className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full transition-all hover:bg-white/10 active:scale-[0.94] shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black"
          style={{
            background: "rgba(20,20,30,0.85)",
            border: "1px solid rgba(229,255,0,0.35)",
            backdropFilter: "blur(6px)",
            boxShadow: "0 4px 16px rgba(0,0,0,0.45)",
          }}
        >
          <svg className="w-4 h-4 text-pnp-lemon" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 4.5l3 3m0 0l-3 3m3-3H12M7.5 19.5l-3-3m0 0l3-3m-3 3H12M4.5 5.25L12 12.75M19.5 18.75L15 14.25" />
          </svg>
        </button>
        <FullscreenToggle targetRef={stageRootRef} />
        <button
          type="button"
          aria-label={isAdmin ? t.live.mainStageAriaOpenAdmin : t.live.mainStageSettingsTitle}
          title={isAdmin ? t.live.mainStageAriaOpenAdmin : t.live.mainStageSettingsTitle}
          onClick={() => setAdminOpen(true)}
          className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full transition-all hover:opacity-80 hover:bg-white/10 active:scale-[0.94] shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black"
          style={{
            background: "rgba(20,20,30,0.85)",
            border: "1px solid rgba(123,97,255,0.40)",
            backdropFilter: "blur(6px)",
            boxShadow: "0 4px 16px rgba(0,0,0,0.45)",
          }}
        >
          <svg className="w-4 h-4 text-pnp-purple" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
        <button
          type="button"
          aria-label={t.live.mainStageAriaShowTutorial}
          title={t.live.mainStageAriaShowTutorial}
          onClick={openTutorial}
          className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full transition-all hover:bg-white/10 active:scale-[0.94] shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black"
          style={{
            background: "rgba(20,20,30,0.85)",
            border: "1px solid rgba(255,255,255,0.18)",
            backdropFilter: "blur(6px)",
            boxShadow: "0 4px 16px rgba(0,0,0,0.45)",
          }}
        >
          <svg className="w-4 h-4 text-white/80" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.5M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" />
          </svg>
        </button>
      </div>

      {connState === ConnectionState.Reconnecting && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold bg-pnp-amber text-black">
          <span className="w-1.5 h-1.5 rounded-full bg-black/40 animate-pulse" />
          {t.live.mainStageReconnectingBanner}
        </div>
      )}

      {camError && (
        <div
          className="absolute left-1/2 -translate-x-1/2 z-40 flex items-start gap-2 px-3 py-2 rounded-xl text-xs font-semibold max-w-[92vw] sm:max-w-[480px] bg-pnp-error text-white"
          style={{
            top: "calc(60px + env(safe-area-inset-top, 0px))",
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
            aria-label={t.live.mainStageAriaDismiss}
            className="min-h-[20px] min-w-[20px] flex-shrink-0 flex items-center justify-center rounded-full opacity-80 hover:opacity-100"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/*
        The Room is created once in MainStageProvider and stays connected
        across route changes. We pass the external Room instance here so
        LiveKitRoom acts only as a React context bridge — it does NOT call
        room.connect() or room.disconnect() when this component mounts/unmounts.
        connect={false} is required to prevent LiveKitRoom from taking over
        the connection lifecycle on unmount.
      */}
      <LiveKitRoom
        key={isGuestMode ? "main-stage-guest" : "main-stage-prime"}
        // Guests bypass the persistent provider — they connect a fresh Room
        // with their short-lived guest token. Members use the provider's
        // shared Room so the connection survives route changes.
        {...(isGuestMode
          ? {
              token: guestCredsRef.current!.token,
              serverUrl: guestCredsRef.current!.livekitUrl,
              connect: true,
              audio: false,
              video: true,
              options: {
                adaptiveStream: true,
                dynacast: true,
                publishDefaults: { simulcast: true },
              },
            }
          : {
              room,
              connect: false,
            })}
        className="contents"
        onMediaDeviceFailure={(failure) => {
          // Surface the specific reason so users know why their cam didn't
          // turn on. Most common is NotAllowedError (permission denied)
          // or NotFoundError (no camera attached).
          const msg = failure?.toString() || "Camera failed";
          if (/NotAllowed|Permission/i.test(msg)) {
            setCamError(t.live.mainStageErrCameraPermission);
          } else if (/NotFound|Device/i.test(msg)) {
            setCamError(t.live.mainStageErrNoCamera);
          } else if (/NotReadable|Overconstrained/i.test(msg)) {
            setCamError(t.live.mainStageErrCameraInUse);
          } else {
            setCamError(`Camera error: ${msg}`);
          }
        }}
      >
        <ForceCamMicEnforcer active={isGuestMode} />
        <MainStageInner
          mode={mode as ModeId}
          spotlightCammer={state?.spotlight?.cammer}
          spotlightNextAt={state?.spotlight?.nextAt}
          mediaKind={state?.media?.kind || "off"}
          mediaSrc={state?.media?.src}
          mediaPlaying={state?.media?.playing ?? true}
          mediaVolume={state?.media?.volume ?? 70}
          isParticipant={isParticipant}
          isAdmin={isAdmin}
          onSpotlightPick={(identity) => admin.setSpotlight(identity)}
          onConnectionStateChange={setConnState}
          onCammersChange={handleCammersChange}
          onLeave={handleLeave}
          spotlight={state?.spotlight}
          showTips={!adminOpen}
        />
      </LiveKitRoom>

      <ConnectionOverlay connState={connState} errorMessage={camError || error} />

      {state?.media?.kind === "video" && state.media.title && !adminOpen && (
        <NowPlayingChip title={state.media.title} />
      )}

      {adminOpen && (
        <AdminDrawer
          state={state}
          admin={admin}
          cammerInfos={cammerInfos}
          onClose={() => setAdminOpen(false)}
          isAdmin={isAdmin}
          localViewMode={localViewMode}
          onSetLocalView={setLocalViewMode}
          onResetLocalView={handleResetViewMode}
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
  isAdmin: boolean;
  localViewMode: ModeId | null;
  onSetLocalView: (mode: ModeId) => void;
  onResetLocalView: () => void;
}

function AdminDrawer({ state, admin, cammerInfos, onClose, isAdmin, localViewMode, onSetLocalView, onResetLocalView }: AdminDrawerProps) {
  const t = useI18n();

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
        className="fixed inset-0 lg:left-72 z-40"
        style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }}
        onClick={onClose}
        aria-hidden
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={isAdmin ? t.live.mainStageAdminTitle : t.live.mainStageSettingsTitle}
        // No overflow on the wrapper — AdminPanelContent's body is the
        // single scroll container so iOS doesn't get confused.
        className="fixed top-0 right-0 bottom-0 z-50 flex flex-col bg-pnp-background border-l border-white/[0.08]"
        style={{
          width: "min(384px, 100vw)",
          maxHeight: "100dvh",
        }}
      >
        {/* Always-visible close button, fixed within the drawer regardless of
            scroll. Big red circle, top-right corner, above the panel header. */}
        <button
          type="button"
          aria-label={t.live.mainStageAriaCloseAdmin}
          onClick={onClose}
          className="absolute z-10 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full transition-all active:scale-[0.92] hover:opacity-90 text-white"
          style={{
            top: "calc(0.5rem + env(safe-area-inset-top, 0px))",
            right: "0.5rem",
            background: "rgba(255,69,58,0.95)",
            border: "1px solid rgba(255,255,255,0.30)",
            boxShadow: "0 4px 16px rgba(0,0,0,0.45)",
          }}
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        <AdminPanelContent
          state={state}
          admin={admin}
          cammerInfos={cammerInfos}
          onClose={onClose}
          isAdmin={isAdmin}
          localViewMode={localViewMode}
          onSetLocalView={onSetLocalView}
          onResetLocalView={onResetLocalView}
        />
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
  // When non-admin opens the same drawer, layout buttons set their personal
  // view (local-only) and the video / audio / participants sections are
  // greyed out. Server permissions still enforce admin-only on the API.
  isAdmin?: boolean;
  localViewMode?: ModeId | null;
  onSetLocalView?: (mode: ModeId) => void;
  onResetLocalView?: () => void;
}

const MODE_ICONS_ADMIN: Record<ModeId, JSX.Element> = {
  spotlight: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <circle cx="12" cy="10" r="4" />
      <path strokeLinecap="round" d="M12 14v5M8 19h8" />
    </svg>
  ),
  theater: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 5v14M20 5v14M4 7c2 0 4 2 4 4s-2 4-4 4M20 7c-2 0-4 2-4 4s2 4 4 4M9 12h6" />
    </svg>
  ),
  cinema: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path strokeLinecap="round" d="M8 10l4 2.5L8 15z" fill="currentColor" />
    </svg>
  ),
  karaoke: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <rect x="3" y="5" width="18" height="12" rx="1.5" />
      <circle cx="17" cy="15" r="3" fill="currentColor" />
    </svg>
  ),
  equal: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  ),
};

// Two-slider audio mix for the admin panel. Values are committed on
// pointer-up / blur to avoid spamming the API on every drag tick. Local
// optimistic state keeps the slider responsive even before the server
// broadcast catches up.
function AudioMixControls({
  mediaVolume,
  camsVolume,
  onSetMediaVolume,
  onSetCamsVolume,
}: {
  mediaVolume: number;
  camsVolume: number;
  onSetMediaVolume: (v: number) => void;
  onSetCamsVolume: (v: number) => void;
}) {
  const t = useI18n();
  const [localMedia, setLocalMedia] = useState(mediaVolume);
  const [localCams, setLocalCams] = useState(camsVolume);

  // Sync from server when not actively dragging.
  const draggingRef = useRef<"media" | "cams" | null>(null);
  useEffect(() => {
    if (draggingRef.current !== "media") setLocalMedia(mediaVolume);
  }, [mediaVolume]);
  useEffect(() => {
    if (draggingRef.current !== "cams") setLocalCams(camsVolume);
  }, [camsVolume]);

  return (
    <div className="space-y-3">
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label htmlFor="ms-vol-media" className="text-[11px] font-semibold text-white/80">
            {t.live.mainStageAdminAudioMedia}
          </label>
          <span className="text-[11px] text-white/50 tabular-nums">{localMedia}</span>
        </div>
        <input
          id="ms-vol-media"
          type="range"
          min={0}
          max={100}
          value={localMedia}
          onChange={(e) => { draggingRef.current = "media"; setLocalMedia(parseInt(e.target.value, 10)); }}
          onPointerUp={() => { draggingRef.current = null; onSetMediaVolume(localMedia); }}
          onBlur={() => { draggingRef.current = null; onSetMediaVolume(localMedia); }}
          className="w-full accent-pnp-accent"
          aria-label={t.live.mainStageAdminAudioMedia}
        />
      </div>
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label htmlFor="ms-vol-cams" className="text-[11px] font-semibold text-white/80">
            {t.live.mainStageAdminAudioCams}
          </label>
          <span className="text-[11px] text-white/50 tabular-nums">{localCams}</span>
        </div>
        <input
          id="ms-vol-cams"
          type="range"
          min={0}
          max={100}
          value={localCams}
          onChange={(e) => { draggingRef.current = "cams"; setLocalCams(parseInt(e.target.value, 10)); }}
          onPointerUp={() => { draggingRef.current = null; onSetCamsVolume(localCams); }}
          onBlur={() => { draggingRef.current = null; onSetCamsVolume(localCams); }}
          className="w-full accent-pnp-accent"
          aria-label={t.live.mainStageAdminAudioCams}
        />
      </div>
      <p className="text-[10px] text-white/30">{t.live.mainStageAdminAudioHint}</p>
    </div>
  );
}

export function AdminPanelContent({
  state,
  admin,
  cammerInfos,
  onClose,
  // Default to non-admin so any future caller that forgets to pass this
  // prop gets the safer rendered surface (greyed video/audio/participants,
  // local-only Layout) instead of full broadcast controls.
  isAdmin = false,
  localViewMode = null,
  onSetLocalView,
  onResetLocalView,
}: AdminPanelContentProps) {
  const t = useI18n();
  const [mediaUrl, setMediaUrl] = useState(state.media.src ?? "");
  const [primeVideos, setPrimeVideos] = useState<PrimeVideo[]>([]);
  const [primeLoading, setPrimeLoading] = useState(true);
  // For non-admins, the active highlight on layout buttons reflects their
  // *personal* view (local override or, if none, the room default).
  const effectiveLayoutMode: ModeId =
    !isAdmin ? ((localViewMode ?? (state?.mode as ModeId | undefined) ?? "spotlight"))
    : ((state?.mode as ModeId | undefined) ?? "spotlight");

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
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-4 border-b border-white/[0.07]">
        <div className="pr-12">
          <h2 className="text-pnp-text-primary font-bold text-sm">{isAdmin ? t.live.mainStageAdminTitle : t.live.mainStageSettingsTitle}</h2>
          <p className="text-white/40 text-xs mt-0.5">
            {state?.counts?.cammers || 0} participants in rotation
          </p>
        </div>
        {/* Close button moved to a fixed-positioned overlay in AdminDrawer
            so it's always reachable regardless of scroll position. */}
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain space-y-5 p-4">
        <section>
          <h3 className="text-white/50 text-[10px] font-bold uppercase tracking-widest mb-2.5">{t.live.mainStageAdminSectionLayout}</h3>
          {!isAdmin && (
            <p className="text-white/45 text-[11px] leading-snug mb-2.5">{t.live.mainStageLayoutPersonalHint}</p>
          )}
          <div className="grid grid-cols-3 gap-2">
            {(["spotlight", "theater", "cinema", "karaoke", "equal"] as ModeId[]).map((modeId) => {
              const active = effectiveLayoutMode === modeId;
              const modeLabel: Record<ModeId, string> = {
                spotlight: t.live.mainStageModeSpotlight,
                theater: t.live.mainStageModeTheater,
                cinema: t.live.mainStageModeCinema,
                karaoke: t.live.mainStageModeKaraoke,
                equal: t.live.mainStageModeEqual,
              };
              const modeSub: Record<ModeId, string> = {
                spotlight: t.live.mainStageModeSpotlightSub,
                theater: t.live.mainStageModeTheaterSub,
                cinema: t.live.mainStageModeCinemaSub,
                karaoke: t.live.mainStageModeKaraokeSub,
                equal: t.live.mainStageModeEqualSub,
              };
              return (
                <button
                  key={modeId}
                  type="button"
                  onClick={() => {
                    if (isAdmin) {
                      admin.setMode(modeId);
                    } else if (onSetLocalView) {
                      onSetLocalView(modeId);
                    }
                  }}
                  className="flex flex-col items-center gap-1.5 p-3 rounded-2xl text-center transition-all active:scale-[0.97]"
                  style={{
                    background: active
                      ? "linear-gradient(135deg,rgba(212,0,122,0.25),rgba(123,97,255,0.20))"
                      : "rgba(255,255,255,0.04)",
                    border: active ? "1.5px solid rgba(212,0,122,0.50)" : "1.5px solid rgba(255,255,255,0.08)",
                    color: active ? "#fff" : "rgba(255,255,255,0.50)",
                  }}
                >
                  <span className={active ? "text-pnp-accent" : "text-white/40"}>{MODE_ICONS_ADMIN[modeId]}</span>
                  <span className="text-[10px] font-bold leading-tight">{modeLabel[modeId]}</span>
                  <span className="text-[9px] text-white/30 leading-tight hidden sm:block">{modeSub[modeId]}</span>
                </button>
              );
            })}
          </div>
          {!isAdmin && localViewMode !== null && onResetLocalView && (
            <button
              type="button"
              onClick={onResetLocalView}
              className="mt-3 w-full min-h-[40px] flex items-center justify-center gap-2 rounded-xl text-[11px] font-semibold text-white/80 transition-all active:scale-[0.97] bg-white/[0.06] border border-white/10 hover:bg-white/[0.10]"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
              </svg>
              {t.live.mainStageResetToRoomDefault}
            </button>
          )}
        </section>

        {!isAdmin && (
          <div
            role="note"
            className="rounded-xl px-3 py-2.5 text-[11px] text-white/65 leading-snug flex items-start gap-2"
            style={{
              background: "rgba(123,97,255,0.08)",
              border: "1px solid rgba(123,97,255,0.20)",
            }}
          >
            <svg className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-pnp-purple" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>{t.live.mainStageHostControlsBanner}</span>
          </div>
        )}

        {/* Video / audio / participants — admins get full controls,
            non-admins see them greyed-out (visible but uninteractive) so
            they understand what the host can do without being able to
            broadcast changes themselves. The server still enforces
            admin-only on the underlying API regardless of UI state. */}
        <div
          aria-hidden={!isAdmin}
          style={
            !isAdmin
              ? { opacity: 0.4, pointerEvents: "none", filter: "grayscale(70%)" }
              : undefined
          }
          className="space-y-5"
        >

        <section>
          <h3 className="text-white/50 text-[10px] font-bold uppercase tracking-widest mb-2.5">
            {t.live.mainStageAdminSectionPrimeVideos}{primeVideos.length > 0 ? ` (${primeVideos.length})` : ""}
          </h3>
          {primeLoading ? (
            <div className="flex gap-2 overflow-hidden">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="flex-shrink-0 w-32 h-[88px] rounded-xl animate-pulse bg-white/[0.04]"
                />
              ))}
            </div>
          ) : primeVideos.length === 0 ? (
            <p className="text-white/30 text-xs">{t.live.mainStageAdminNoPrimeVideos}</p>
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
                    className="flex-shrink-0 relative w-32 h-[88px] rounded-xl overflow-hidden transition-all active:scale-[0.97] text-left bg-white/[0.04]"
                    style={{
                      border: active ? "1.5px solid #D4007A" : "1.5px solid rgba(255,255,255,0.08)",
                      boxShadow: active ? "0 0 0 2px rgba(212,0,122,0.30)" : "none",
                    }}
                    aria-label={t.live.mainStageAdminAriaPlayVideo(v.title)}
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
                      <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full flex items-center justify-center bg-pnp-accent">
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
          <h3 className="text-white/50 text-[10px] font-bold uppercase tracking-widest mb-2.5">{t.live.mainStageAdminSectionCustomUrl}</h3>
          <div className="space-y-3">
            <div className="flex gap-2">
              <input
                type="url"
                value={mediaUrl}
                onChange={(e) => setMediaUrl(e.target.value)}
                placeholder={t.live.mainStageAdminUrlPlaceholder}
                className="flex-1 min-w-0 px-3 py-2 rounded-xl text-xs text-white placeholder-white/30 focus:outline-none transition-colors bg-white/[0.06] border border-white/10"
                aria-label={t.live.mainStageAdminAriaMediaUrl}
              />
              <button
                type="button"
                onClick={handlePlayMedia}
                disabled={!mediaUrl.trim()}
                className="flex-shrink-0 min-h-[38px] px-3 rounded-xl text-xs font-bold text-white transition-all active:scale-[0.96] disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ background: "linear-gradient(135deg,#D4007A,#7B61FF)" }}
              >
                {t.live.mainStageAdminPlay}
              </button>
            </div>

            {state?.media?.kind && state.media.kind !== "off" && (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleTogglePlay}
                  className="flex-1 min-h-[40px] flex items-center justify-center gap-2 rounded-xl text-xs font-semibold text-white transition-all active:scale-[0.97] bg-white/[0.07] border border-white/10"
                >
                  {state.media.playing ? (
                    <>
                      <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M6 4h4v16H6zM14 4h4v16h-4z" /></svg>
                      {t.live.mainStageAdminPause}
                    </>
                  ) : (
                    <>
                      <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                      {t.live.mainStageAdminResume}
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={handleStopMedia}
                  className="flex-shrink-0 min-h-[40px] px-4 rounded-xl text-xs font-semibold transition-all active:scale-[0.97] bg-pnp-error/[0.12] border border-pnp-error/25 text-pnp-error"
                >
                  {t.live.mainStageAdminStop}
                </button>
              </div>
            )}
          </div>
        </section>

        <section>
          <h3 className="text-white/50 text-[10px] font-bold uppercase tracking-widest mb-2.5">
            {t.live.mainStageAdminSectionAudio}
          </h3>
          <AudioMixControls
            mediaVolume={state?.media?.volume ?? 70}
            camsVolume={state?.cams?.volume ?? 80}
            onSetMediaVolume={(v) => admin.setVolume({ media: v })}
            onSetCamsVolume={(v) => admin.setVolume({ cams: v })}
          />
        </section>

        <section>
          <h3 className="text-white/50 text-[10px] font-bold uppercase tracking-widest mb-2.5">
            {t.live.mainStageAdminSectionParticipants}{cammerInfos.length > 0 ? ` (${cammerInfos.length})` : ""}
          </h3>
          {cammerInfos.length === 0 ? (
            <p className="text-white/30 text-xs">{t.live.mainStageAdminNoCammers}</p>
          ) : (
            <div className="space-y-1.5">
              {cammerInfos.map((c) => (
                <div
                  key={c.identity}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/[0.04] border border-white/[0.06]"
                >
                  <span className="flex-1 min-w-0 text-xs text-white/70 truncate">{c.name}</span>
                  <button
                    type="button"
                    onClick={() => admin.moderate("mute", c.identity)}
                    aria-label={t.live.mainStageAdminAriaMute(c.identity)}
                    className="flex-shrink-0 px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all active:scale-[0.96] bg-pnp-amber/[0.12] border border-pnp-amber/25 text-pnp-amber"
                  >
                    {t.live.mainStageAdminMute}
                  </button>
                  <button
                    type="button"
                    onClick={() => admin.moderate("kick", c.identity)}
                    aria-label={t.live.mainStageAdminAriaKick(c.identity)}
                    className="flex-shrink-0 px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all active:scale-[0.96] bg-pnp-error/[0.12] border border-pnp-error/25 text-pnp-error"
                  >
                    {t.live.mainStageAdminKick}
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
        </div>

        {/* Invite Panel — admin-only, always visible (outside the aria-hidden block) */}
        {isAdmin && (
          <section>
            <div className="h-px bg-white/[0.06] mb-4" />
            <InvitePanel />
          </section>
        )}
      </div>
    </div>
  );
}

interface FullscreenToggleProps {
  targetRef: React.RefObject<HTMLElement>;
}

function FullscreenToggle({ targetRef }: FullscreenToggleProps) {
  const t = useI18n();
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
      aria-label={isFs ? t.live.mainStageAriaExitFullscreen : t.live.mainStageAriaFullscreen}
      title={isFs ? t.live.mainStageAriaExitFullscreen : t.live.mainStageTitleFullscreen}
      className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full transition-all hover:bg-white/10 active:scale-[0.94] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black bg-white/[0.06] border border-white/10"
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
  const t = useI18n();
  return (
    <div
      className="pointer-events-none fixed z-30 flex items-center gap-2 px-3 py-1.5 rounded-full border border-pnp-accent/[0.28]"
      style={{
        top: "calc(64px + env(safe-area-inset-top, 0px))",
        right: "1rem",
        maxWidth: "calc(100vw - 2rem)",
        background: "rgba(10,10,15,0.72)",
        backdropFilter: "blur(12px)",
      }}
      role="status"
      aria-live="polite"
      aria-label={t.live.mainStageNowPlayingAriaLabel(title)}
    >
      <span
        className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-pnp-accent"
        style={{ boxShadow: "0 0 8px rgba(212,0,122,0.7)" }}
        aria-hidden
      />
      <span className="text-white/45 text-[10px] font-bold uppercase tracking-wider flex-shrink-0">
        {t.live.mainStageNowPlayingLabel}
      </span>
      <span className="text-white text-xs font-medium truncate">{title}</span>
    </div>
  );
}

const TIP_FIRST_DELAY_MS = 10 * 1000;
const TIP_INTERVAL_MS = 5 * 60 * 1000;
const TIP_VISIBLE_MS = 15 * 1000;

type TipItem = MainStageTip;

function getWellnessTips(): TipItem[] {
  return getLocalizedTips();
}

function WellnessTipsOverlay() {
  const { live: wellnessT } = useI18n();
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

  // Slim non-blocking ribbon anchored BELOW the cam grid, ABOVE the bottom bar.
  // Uses absolute positioning within the page's flex column so it never
  // overlaps cammer video tiles regardless of screen size.
  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="flex-shrink-0 overflow-hidden"
      style={{
        maxHeight: visible ? "56px" : "0px",
        opacity: visible ? 1 : 0,
        transition: "max-height 0.35s cubic-bezier(0.2,0.9,0.3,1), opacity 0.30s",
        background: "rgba(10,10,15,0.88)",
        borderTop: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      <div className="flex items-center gap-2.5 px-3 h-14">
        {/* Emoji icon */}
        <span className="text-xl flex-shrink-0" aria-hidden>
          {tip.emoji}
        </span>

        {/* Tip text */}
        <p className="flex-1 text-[12px] text-white/80 leading-snug line-clamp-2 min-w-0">
          {tip.body}
        </p>

        {/* Dismiss */}
        <button
          type="button"
          aria-label={wellnessT.mainStageWellnessAriaDismiss}
          onClick={handleClose}
          className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-full transition-all active:scale-[0.92] bg-white/[0.06] border border-white/[0.08]"
        >
          <svg className="w-3 h-3 text-white/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
