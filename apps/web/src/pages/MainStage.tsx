import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  LiveKitRoom,
  useRoomContext,
} from "@livekit/components-react";
import { ConnectionState, RoomEvent } from "livekit-client";
import { useMainStage, type MainStageState } from "@/hooks/useMainStage";
import { useMainStageRoom } from "@/components/mainstage/MainStageProvider";
import { getMainStageJoinCheck, acceptMainStageConsents, type MainStageJoinCheck } from "@/lib/api";
import { useMusicPlayer } from "@/hooks/useMusicPlayer";
import { useTutorial } from "@/hooks/useTutorial";
import { TutorialOverlay } from "@/components/tutorial/TutorialOverlay";
import { SpotlightGrid } from "@/components/mainstage/SpotlightGrid";
import { CinemaGrid } from "@/components/mainstage/CinemaGrid";
import { EqualGrid } from "@/components/mainstage/EqualGrid";
import { MEDIA_IDENTITY } from "@/components/mainstage/CinemaGrid";
import { useI18n } from "@/lib/i18n";
import { GUEST_SESSION_KEY } from "@/pages/MainStageGuestJoin";

// Extracted sub-components
import { ParticipantCollector, type CammerInfo } from "@/components/mainstage/ParticipantCollector";
import { BottomBarInner } from "@/components/mainstage/BottomBar";
import { ConnectionOverlay } from "@/components/mainstage/ConnectionOverlay";
import { ForceCamMicEnforcer } from "@/components/mainstage/ForceCamMicEnforcer";
import { KaraokeCammerOverlay } from "@/components/mainstage/KaraokeCammerOverlay";
import { WellnessTipsOverlay } from "@/components/mainstage/WellnessTipsOverlay";
import { NowPlayingChip } from "@/components/mainstage/NowPlayingChip";
import { FullscreenToggle } from "@/components/mainstage/FullscreenToggle";
import { TheaterCurtains } from "@/components/mainstage/TheaterCurtains";
import { AdminDrawer, AdminPanelContent, type ModeId } from "@/components/mainstage/AdminDrawer";

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
    livekitUrl,
    loading:     hookedLoading,
    error:       hookedError,
    leave,
    shuffle,
    admin,
  } = useMainStage();

  // Pull the shared Room instance from the provider. Members use the
  // provider-managed connection (persistent across route changes). Guests
  // bypass the provider entirely and use their own short-lived <LiveKitRoom>
  // with the guest token.
  const { room, isJoined, join } = useMainStageRoom();

  // Resolve effective values: guest path overrides everything from the hook.
  const state       = hookedState;
  const role        = isGuestMode ? ("guest" as const) : hookedRole;
  const loading     = isGuestMode ? false              : hookedLoading;
  const error       = isGuestMode ? null               : hookedError;

  const [adminOpen, setAdminOpen] = useState(false);
  const [connState, setConnState] = useState<ConnectionState>(ConnectionState.Connecting);
  const [hasEverConnected, setHasEverConnected] = useState(false);
  const [cammerInfos, setCammerInfos] = useState<CammerInfo[]>([]);
  const [camError, setCamError] = useState<string | null>(null);
  const [joining, setJoining] = useState(!isGuestMode);
  const [joinCheck, setJoinCheck] = useState<MainStageJoinCheck | null>(null);
  const [consentError, setConsentError] = useState<string | null>(null);
  const [acceptingConsents, setAcceptingConsents] = useState(false);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [acceptPrivacy, setAcceptPrivacy] = useState(false);
  const [confirmAge, setConfirmAge] = useState(false);
  const isParticipant = isGuestMode || role === "member" || role === "admin";

  // Refs so effect closures always read current values without stale captures.
  const hasEverConnectedRef = useRef(hasEverConnected);
  useEffect(() => { hasEverConnectedRef.current = hasEverConnected; }, [hasEverConnected]);

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
    const attemptJoin = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        setJoining(false);
        return;
      }
      // If the room is already connected the join() short-circuit will fire immediately.
      // Skip the loading spinner to avoid a flash on navigation-back-to-stage.
      if (room.state === ConnectionState.Connected) {
        join().catch(() => {});
        return;
      }
      setJoining(true);
      join()
        .catch(() => {})
        .finally(() => {
          if (!cancelled) setJoining(false);
        });
    };

    attemptJoin();

    const onVisibilityChange = () => {
      if (cancelled) return;
      if (document.visibilityState !== "visible") return;
      // After the first successful connect, tab-focus events must NOT trigger
      // an auto-rejoin. The ConnectionOverlay shows "Connection lost" with a
      // manual "Reintentar" button for post-connect drops. Auto-rejoin here
      // creates a kick loop when the user has multiple tabs open.
      if (hasEverConnectedRef.current) return;
      attemptJoin();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [isGuestMode, join, joinCheck?.canJoin, room]);

  useEffect(() => {
    if (connState === ConnectionState.Connected) {
      setHasEverConnected(true);
    }
  }, [connState]);

  useEffect(() => {
    if (!isParticipant) {
      setHasEverConnected(false);
      setConnState(ConnectionState.Connecting);
    }
  }, [isParticipant]);

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

  // Show the skeleton only while the join-check fetch is in flight. Once
  // joinCheck arrives, <LiveKitRoom> must stay mounted for the entire join
  // lifecycle — unmounting it while the room is connecting and remounting
  // it afterwards causes LiveKitRoom's internal connect={false} effect to
  // call room.disconnect() on an already-connected room (CLIENT_INITIATED).
  // ConnectionOverlay handles the connecting/reconnecting visual instead.
  if (
    !isGuestMode &&
    !error &&
    (!joinCheck && !consentError)
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
  const liveParticipants = state?.counts?.participants ?? state?.counts?.cammers ?? 0;

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
          minHeight: "54px",
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
          {liveParticipants > 0 && (
            <>
              <span className="text-white/20 mx-0.5">·</span>
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse flex-shrink-0" />
              <span className="tabular-nums text-white/70">{liveParticipants}</span>
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
        {isAdmin && (
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
        )}
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
      {isGuestMode ? (
        <LiveKitRoom
          key="main-stage-guest"
          token={guestCredsRef.current!.token}
          serverUrl={guestCredsRef.current!.livekitUrl}
          connect
          audio={false}
          video
          options={{
            adaptiveStream: true,
            dynacast: true,
            publishDefaults: { simulcast: true },
          }}
          className="contents"
          onMediaDeviceFailure={(failure) => {
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
          <ForceCamMicEnforcer active />
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
      ) : (
        <LiveKitRoom
          key="main-stage-prime"
          room={room}
          connect={false}
          serverUrl={livekitUrl}
          token=""
          className="contents"
          onMediaDeviceFailure={(failure) => {
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
          <ForceCamMicEnforcer active={false} />
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
      )}

      <ConnectionOverlay
        connState={connState}
        errorMessage={camError || error}
        hasEverConnected={hasEverConnected}
      />

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

// Re-export AdminPanelContent for any external consumers (e.g. standalone
// settings modal) that import it directly from this page module.
export { AdminPanelContent } from "@/components/mainstage/AdminDrawer";
