import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  useRoomContext,
} from "@livekit/components-react";
import { ConnectionState, RoomEvent } from "livekit-client";
import { useMainStage, type MainStageState } from "@/hooks/useMainStage";
import { useMainStageRoom } from "@/components/mainstage/MainStageProvider";
import { getMainStageJoinCheck, acceptMainStageConsents, getWalletBalance, getMainStageViewerToken, getMainStageState, voteSkipMainStage, playNextMainStage, type MainStageJoinCheck } from "@/lib/api";
import { getSocket } from "@/lib/socket";
import { useAuth } from "@/hooks/useAuth";
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
import { BuyTokensModal } from "@/components/BuyTokensModal";

// ── Guest credential shape (written by MainStageGuestJoin, consumed once here) ─

interface GuestCredentials {
  token:               string;
  livekitUrl:          string;
  roomName:            string;
  displayName:         string;
  identity:            string;
  sessionStartedAt?:   number;
  sessionLimitSeconds?: number;
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
  mediaStartedAt: number | null;
  isParticipant: boolean;
  isAdmin: boolean;
  onSpotlightPick: (identity: string) => void;
  onConnectionStateChange: (state: ConnectionState) => void;
  onCammersChange: (cammers: CammerInfo[]) => void;
  onLeave: () => void;
  spotlight?: MainStageState["spotlight"];
  showTips: boolean;
  showBottomBar?: boolean;
  onSendReaction?: (emoji: string) => void;
  canScreenShare?: boolean;
  hasMic?: boolean;
  skipVoteCount?: number;
  skipVoteThreshold?: number;
  hasVotedSkip?: boolean;
  onVoteSkip?: () => void;
  onPlayNext?: () => void;
  playNextCooldown?: number;
}

function MainStageInner({
  mode,
  spotlightCammer,
  spotlightNextAt,
  mediaKind,
  mediaSrc,
  mediaPlaying,
  mediaVolume,
  mediaStartedAt,
  isParticipant,
  isAdmin,
  onSpotlightPick,
  onConnectionStateChange,
  onCammersChange,
  onLeave,
  spotlight,
  showTips,
  showBottomBar = true,
  onSendReaction,
  canScreenShare,
  hasMic,
  skipVoteCount,
  skipVoteThreshold,
  hasVotedSkip,
  onVoteSkip,
  onPlayNext,
  playNextCooldown,
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
            mediaStartedAt={mediaStartedAt}
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
              mediaStartedAt={mediaStartedAt}
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
              mediaStartedAt={mediaStartedAt}
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

      {showBottomBar && (
        <BottomBarInner
          isParticipant={isParticipant}
          isAdmin={isAdmin}
          onLeave={onLeave}
          spotlight={spotlight}
          onSendReaction={onSendReaction}
          canScreenShare={canScreenShare}
          hasMic={hasMic}
          skipVoteCount={skipVoteCount}
          skipVoteThreshold={skipVoteThreshold}
          hasVotedSkip={hasVotedSkip}
          onVoteSkip={onVoteSkip}
          onPlayNext={onPlayNext}
          playNextCooldown={playNextCooldown}
        />
      )}
    </>
  );
}

interface ChatMessage { id: string; userId: string | number; displayName: string; text: string; timestamp: number; }
interface FloatingReaction { id: string; emoji: string; x: number; }

function fmtMmSs(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
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
  const { room, isJoined, join, cooldownSeconds, clearCooldown, sessionStartedAt, sessionLimitSeconds, canScreenShare, participantTier } = useMainStageRoom();

  // Auth state — viewer mode only applies to unauthenticated users.
  const { user, isLoading: isAuthLoading } = useAuth();
  // Any logged-in user is a cammer. Viewer mode is for unauthenticated visitors only.
  const canParticipate = user !== null;
  const isViewerMode = !isGuestMode && !isAuthLoading && !canParticipate;

  // Viewer-mode state
  const [viewerLkToken, setViewerLkToken] = useState<string | null>(null);
  const [viewerLkUrl, setViewerLkUrl] = useState<string | null>(null);
  const [viewerAgeConfirmed, setViewerAgeConfirmed] = useState(false);
  const [viewerConnecting, setViewerConnecting] = useState(false);
  const [viewerConnState, setViewerConnState] = useState<ConnectionState>(ConnectionState.Disconnected);
  const [viewerError, setViewerError] = useState<string | null>(null);
  // Viewer REST state override — unauthenticated viewers don't receive socket state updates.
  const [viewerStateOverride, setViewerStateOverride] = useState<MainStageState | null>(null);
  // Viewer token refresh timer (2h TTL — refresh 15 min early).
  const viewerRefreshRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const [tokenBalance, setTokenBalance] = useState<number | null>(null);
  const [showBuyTokens, setShowBuyTokens] = useState(false);
  useEffect(() => {
    if (isGuestMode) return;
    getWalletBalance().then((res) => { if (typeof res.balance === "number") setTokenBalance(res.balance); }).catch(() => {});
  }, [isGuestMode]);

  // ── In-room chat ─────────────────────────────────────────────────────────────
  const [chatOverlayVisible, setChatOverlayVisible] = useState(true);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const chatInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const socket = getSocket();
    const onChatMessage = (msg: ChatMessage) => {
      setChatMessages((prev) => {
        const next = [...prev, msg];
        return next.length > 200 ? next.slice(next.length - 200) : next;
      });
    };
    socket.on('mainstage:chat-message', onChatMessage);
    return () => { socket.off('mainstage:chat-message', onChatMessage); };
  }, []);

  const handleChatSend = useCallback(() => {
    const text = chatInput.trim();
    if (!text) return;
    getSocket().emit('mainstage:chat-send', { text });
    setChatInput("");
  }, [chatInput]);

  // ── Floating emoji reactions ──────────────────────────────────────────────────
  const [reactions, setReactions] = useState<FloatingReaction[]>([]);

  useEffect(() => {
    const socket = getSocket();
    const onReaction = (payload: { id: string; emoji: string; userId: string | number }) => {
      const x = 20 + Math.random() * 60; // 20-80% of screen width
      setReactions((prev) => [...prev, { id: payload.id, emoji: payload.emoji, x }]);
      setTimeout(() => {
        setReactions((prev) => prev.filter((r) => r.id !== payload.id));
      }, 3000);
    };
    socket.on('mainstage:reaction', onReaction);
    return () => { socket.off('mainstage:reaction', onReaction); };
  }, []);

  const handleSendReaction = useCallback((emoji: string) => {
    getSocket().emit('mainstage:reaction-send', { emoji });
  }, []);

  // ── Skip-vote & Play-next ─────────────────────────────────────────────────────
  const [skipVoteCount, setSkipVoteCount] = useState(0);
  const [skipVoteThreshold, setSkipVoteThreshold] = useState(3);
  const [hasVotedSkip, setHasVotedSkip] = useState(false);
  const [playNextCooldown, setPlayNextCooldown] = useState(0);
  const playNextTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Reset skip-vote state whenever the playing video src changes
  const lastMediaSrc = useRef<string | null>(null);
  useEffect(() => {
    const src = state?.media?.src ?? null;
    if (src !== lastMediaSrc.current) {
      lastMediaSrc.current = src;
      setSkipVoteCount(0);
      setHasVotedSkip(false);
    }
  }, [state?.media?.src]);

  useEffect(() => {
    const socket = getSocket();
    const onSkipVoteUpdate = (payload: { count: number; threshold: number }) => {
      setSkipVoteCount(payload.count);
      setSkipVoteThreshold(payload.threshold);
    };
    socket.on('mainstage:skip-vote-update', onSkipVoteUpdate);
    return () => { socket.off('mainstage:skip-vote-update', onSkipVoteUpdate); };
  }, []);

  const hasMic = isAdmin || participantTier === 'member' || participantTier === 'prime';
  const canPlayNext = isAdmin || participantTier === 'prime';

  const handleVoteSkip = useCallback(async () => {
    if (hasVotedSkip) return;
    try {
      const result = await voteSkipMainStage();
      setHasVotedSkip(true);
      setSkipVoteCount(result.count);
      setSkipVoteThreshold(result.threshold);
      if (result.triggered) {
        setSkipVoteCount(0);
        setHasVotedSkip(false);
      }
    } catch {
      // silently ignore
    }
  }, [hasVotedSkip]);

  const handlePlayNext = useCallback(async () => {
    if (playNextCooldown > 0) return;
    try {
      const result = await playNextMainStage();
      if (result.cooldownSeconds) {
        setPlayNextCooldown(result.cooldownSeconds);
      } else {
        setPlayNextCooldown(300); // default 5 min
      }
    } catch {
      // silently ignore
    }
  }, [playNextCooldown]);

  // Count down play-next cooldown every second
  useEffect(() => {
    if (playNextCooldown <= 0) {
      if (playNextTimerRef.current) { clearInterval(playNextTimerRef.current); playNextTimerRef.current = null; }
      return;
    }
    playNextTimerRef.current = setInterval(() => {
      setPlayNextCooldown((n) => {
        if (n <= 1) { clearInterval(playNextTimerRef.current!); playNextTimerRef.current = null; return 0; }
        return n - 1;
      });
    }, 1000);
    return () => { if (playNextTimerRef.current) clearInterval(playNextTimerRef.current); };
  }, [playNextCooldown > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  // canScreenShare is already destructured from useMainStageRoom() above

  // ── Countdown timers ────────────────────────────────────────────────────────
  // For authenticated free users: remaining seconds of their 1h session.
  const [sessionSecsLeft, setSessionSecsLeft] = useState<number | null>(null);
  useEffect(() => {
    if (!sessionStartedAt || !sessionLimitSeconds) { setSessionSecsLeft(null); return; }
    const tick = () => {
      const elapsed = Math.floor((Date.now() - sessionStartedAt) / 1000);
      const left = Math.max(0, sessionLimitSeconds - elapsed);
      setSessionSecsLeft(left);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [sessionStartedAt, sessionLimitSeconds]);

  // For guest mode: remaining seconds of their 15-min session.
  const guestSessionLimit = guestCredsRef.current?.sessionLimitSeconds ?? 900;
  const guestSessionStart = guestCredsRef.current?.sessionStartedAt ?? 0;
  const [guestSecsLeft, setGuestSecsLeft] = useState<number | null>(null);
  useEffect(() => {
    if (!isGuestMode || !guestSessionStart) return;
    const tick = () => {
      const elapsed = Math.floor((Date.now() - guestSessionStart) / 1000);
      const left = Math.max(0, guestSessionLimit - elapsed);
      setGuestSecsLeft(left);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [isGuestMode, guestSessionStart, guestSessionLimit]);

  // Cooldown countdown (ticks down from cooldownSeconds)
  const [cooldownLeft, setCooldownLeft] = useState<number | null>(null);
  useEffect(() => {
    if (cooldownSeconds === null) { setCooldownLeft(null); return; }
    setCooldownLeft(cooldownSeconds);
    const id = setInterval(() => {
      setCooldownLeft((prev) => {
        if (prev === null || prev <= 1) { clearInterval(id); return 0; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [cooldownSeconds]);

  // When guest timer hits 0, redirect to /register with a prompt.
  useEffect(() => {
    if (guestSecsLeft === 0 && isGuestMode) {
      navigate("/register?from=mainstage-guest", { replace: true });
    }
  }, [guestSecsLeft, isGuestMode, navigate]);

  // Refs so effect closures always read current values without stale captures.
  const hasEverConnectedRef = useRef(hasEverConnected);
  useEffect(() => { hasEverConnectedRef.current = hasEverConnected; }, [hasEverConnected]);

  // Clear stale camera-permission banners whenever the user leaves the room.
  useEffect(() => {
    if (!isParticipant) setCamError(null);
  }, [isParticipant]);

  useEffect(() => {
    if (isGuestMode || isViewerMode || isAuthLoading) return;
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
  }, [isGuestMode, isViewerMode, isAuthLoading]);

  useEffect(() => {
    if (isGuestMode || isViewerMode) return;
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
  }, [isGuestMode, isViewerMode, join, joinCheck?.canJoin, room]);

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
    if (!isGuestMode && !isViewerMode) leave();
    navigate(-1);
  }, [isGuestMode, isViewerMode, leave, navigate]);

  const handleViewerWatch = useCallback(async () => {
    setViewerConnecting(true);
    setViewerError(null);
    try {
      const res = await getMainStageViewerToken();
      setViewerLkToken(res.token);
      setViewerLkUrl(res.livekitUrl);
      // Clear any previous refresh timer and schedule refresh 15 min before 2h expiry.
      if (viewerRefreshRef.current) clearTimeout(viewerRefreshRef.current);
      viewerRefreshRef.current = setTimeout(async () => {
        try {
          const refreshed = await getMainStageViewerToken();
          setViewerLkToken(refreshed.token);
          setViewerLkUrl(refreshed.livekitUrl);
        } catch {
          // On failure, let the connection expire naturally.
        }
      }, (2 * 60 - 15) * 60 * 1000);
    } catch {
      setViewerError("Couldn't connect to Main Stage. Please try again.");
    } finally {
      setViewerConnecting(false);
    }
  }, []);

  // Cleanup viewer refresh timer on unmount.
  useEffect(() => {
    return () => {
      if (viewerRefreshRef.current) clearTimeout(viewerRefreshRef.current);
    };
  }, []);

  // Fix 1-D: Poll state via REST for viewers (unauthenticated viewers don't
  // receive socket state updates from the provider).
  useEffect(() => {
    if (!isViewerMode || !viewerLkToken) return;
    // Fetch initial state immediately.
    getMainStageState().then(s => setViewerStateOverride(s)).catch(() => {});
    const id = setInterval(() => {
      getMainStageState().then(s => setViewerStateOverride(s)).catch(() => {});
    }, 10_000);
    return () => clearInterval(id);
  }, [isViewerMode, viewerLkToken]);

  // Fix 1-F: Mid-session tier upgrade — reload to promote viewer to participant.
  useEffect(() => {
    if (!isViewerMode) return;
    const socket = getSocket();
    const onEntitlementChange = () => {
      // User's entitlements changed — reload so the new tier is picked up.
      window.location.reload();
    };
    socket.on('user:entitlement-change', onEntitlementChange);
    return () => {
      socket.off('user:entitlement-change', onEntitlementChange);
    };
  }, [isViewerMode]);

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

  // ── Free-user cooldown screen ────────────────────────────────────────────────
  if (!isGuestMode && cooldownSeconds !== null) {
    const mins = cooldownLeft !== null ? Math.ceil(cooldownLeft / 60) : Math.ceil(cooldownSeconds / 60);
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center gap-6 px-6 text-center bg-pnp-background">
        <img src="/logo-login.png" alt="PNPtv!" className="h-10 w-auto object-contain brightness-110 mb-2" />
        <div
          className="w-20 h-20 rounded-3xl flex items-center justify-center"
          style={{ background: "linear-gradient(135deg,rgba(212,0,122,0.18),rgba(123,97,255,0.18))", border: "1px solid rgba(212,0,122,0.3)" }}
        >
          <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} style={{ color: "#D4007A" }}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <div>
          <p className="text-white font-bold text-xl mb-1">Preview over — great session!</p>
          <p className="text-white/70 text-sm max-w-xs mx-auto">
            Your free 1-hour preview ended. Come back in{" "}
            <span className="text-pink-400 font-bold tabular-nums">
              {cooldownLeft !== null ? fmtMmSs(cooldownLeft) : `${mins} min`}
            </span>
            , or become a Member to stay on cam all day.
          </p>
          <p className="text-white/35 text-xs mt-1 max-w-xs mx-auto">
            Tu hora de cámara gratuita terminó. Vuelve en {mins} min o únete como Miembro.
          </p>
        </div>
        <div className="flex flex-col gap-3 w-full max-w-xs">
          <button
            type="button"
            onClick={() => navigate("/subscribe")}
            className="min-h-[50px] w-full rounded-2xl text-sm font-bold text-white transition-all active:scale-[0.97]"
            style={{ background: "linear-gradient(135deg,#D4007A,#7B61FF)" }}
          >
            Become a Member — Cam + Mic, 4h Sessions
          </button>
          <button
            type="button"
            onClick={() => { clearCooldown(); navigate(-1); }}
            className="min-h-[40px] w-full rounded-xl text-xs font-semibold text-white/40 transition-all active:scale-[0.97]"
          >
            Leave Main Stage
          </button>
        </div>
      </div>
    );
  }

  // Show the skeleton while auth is resolving (can't determine viewer vs member yet).
  if (!isGuestMode && isAuthLoading) {
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

  // Viewer age gate — shown before the viewer fetches a LiveKit token.
  if (isViewerMode && !viewerLkToken) {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center gap-6 px-6 text-center bg-pnp-background">
        <img src="/logo-login.png" alt="PNPtv!" className="h-10 w-auto object-contain brightness-110 mb-2" />
        <div
          className="w-20 h-20 rounded-3xl flex items-center justify-center"
          style={{ background: "linear-gradient(135deg,rgba(212,0,122,0.18),rgba(123,97,255,0.18))", border: "1px solid rgba(212,0,122,0.3)" }}
        >
          <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} style={{ color: "#D4007A" }}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9A2.25 2.25 0 004.5 18.75z" />
          </svg>
        </div>
        <div>
          <p className="text-white font-bold text-xl mb-1">Main Stage · Live Now</p>
          <p className="text-white/55 text-sm max-w-xs mx-auto">
            Watch live for free — or sign up and get 1 hour on cam, no subscription needed.
          </p>
          <p className="text-white/35 text-xs mt-2 max-w-xs mx-auto">
            Ver gratis, o regístrate y obtén 1 hora de cámara sin pagar.
          </p>
        </div>
        <label className="flex items-center gap-3 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={viewerAgeConfirmed}
            onChange={(e) => setViewerAgeConfirmed(e.target.checked)}
            className="w-4 h-4 accent-pink-500"
          />
          <span className="text-sm text-white/80">I confirm I'm 18+ / Confirmo que tengo 18+</span>
        </label>
        {viewerError && <p className="text-sm text-red-400">{viewerError}</p>}
        <div className="flex flex-col gap-3 w-full max-w-xs">
          <button
            type="button"
            onClick={handleViewerWatch}
            disabled={!viewerAgeConfirmed || viewerConnecting}
            className="min-h-[50px] w-full rounded-2xl text-sm font-bold text-white transition-all active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: "linear-gradient(135deg,#D4007A,#7B61FF)" }}
          >
            {viewerConnecting ? "Connecting…" : "Watch Live"}
          </button>
          <button
            type="button"
            onClick={() => navigate("/register")}
            className="min-h-[44px] w-full rounded-2xl text-sm font-semibold text-white transition-all active:scale-[0.97]"
            style={{ background: "rgba(123,97,255,0.15)", border: "1px solid rgba(123,97,255,0.40)" }}
          >
            Sign Up Free — Get 1 Hour on Cam
          </button>
          <button
            type="button"
            onClick={() => navigate("/subscribe")}
            className="min-h-[44px] w-full rounded-2xl text-sm font-semibold text-white transition-all active:scale-[0.97]"
            style={{ background: "rgba(212,0,122,0.12)", border: "1px solid rgba(212,0,122,0.35)" }}
          >
            ⭐ Go Member — Cam + Mic, All Day
          </button>
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="min-h-[40px] w-full rounded-xl text-xs font-semibold text-white/40 transition-all active:scale-[0.97]"
          >
            {t.live.mainStageGoBack}
          </button>
        </div>
      </div>
    );
  }

  // Member skeleton — PRIME user waiting for join-check to resolve.
  if (!isGuestMode && !isViewerMode && !error && (!joinCheck && !consentError)) {
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

  if (!state && !isViewerMode) {
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
    (localViewMode ?? (state?.mode as ModeId | undefined) ?? "spotlight");
  // In viewer mode, prefer the REST-polled state override (socket state not delivered to unauthed viewers).
  const effectiveState = (isViewerMode && viewerStateOverride) ? viewerStateOverride : state;
  const liveParticipants = effectiveState?.counts?.participants ?? effectiveState?.counts?.cammers ?? 0;

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
        className="flex-shrink-0 flex items-center justify-between px-2 sm:px-4 gap-2 sm:gap-3"
        style={{
          minHeight: "54px",
          paddingTop: "env(safe-area-inset-top, 0px)",
          paddingLeft: "calc(0.5rem + env(safe-area-inset-left, 0px))",
          paddingRight: "calc(0.5rem + env(safe-area-inset-right, 0px))",
          background: "rgba(10,10,15,0.85)",
          backdropFilter: "blur(16px)",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          zIndex: 20,
        }}
      >
        <img
          src="/logo-login.png"
          alt="PNPtv!"
          className="h-7 w-auto object-contain brightness-110 flex-shrink-0"
        />

        {/* Mode chip — flex-shrink + min-w-0 so on 360px screens it yields
            space to the right-side action buttons instead of pushing them
            off the edge. Mode label hides below sm. */}
        <div className="flex items-center gap-1.5 px-2 sm:px-3 py-1.5 rounded-full text-xs font-semibold bg-white/[0.06] border border-white/10 text-white/80 min-w-0 flex-shrink overflow-hidden">
          <span className="text-pnp-accent flex-shrink-0">{MODE_ICONS[mode]}</span>
          <span className="truncate">{t.live.mainStageTitle}</span>
          <span className="hidden sm:inline text-white/30 mx-0.5">·</span>
          <span className="hidden sm:inline text-white/55 truncate">{modeLabels[mode]}</span>
          {liveParticipants > 0 && (
            <>
              <span className="text-white/20 mx-0.5">·</span>
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse flex-shrink-0" />
              <span className="tabular-nums text-white/70 flex-shrink-0">{liveParticipants}</span>
            </>
          )}
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
          {isViewerMode && (
            <span
              className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold"
              style={{
                background: "rgba(212,0,122,0.12)",
                border:     "1px solid rgba(212,0,122,0.35)",
                color:      "#D4007A",
              }}
            >
              Viewer
            </span>
          )}
          {!isGuestMode && !isViewerMode && tokenBalance !== null && (
            <button
              onClick={() => setShowBuyTokens(true)}
              className="relative flex items-center gap-1 px-2 py-1 rounded-full bg-white/[0.06] border border-white/10 hover:bg-white/10 active:scale-95 transition-all"
              title="Buy tokens"
            >
              {tokenBalance < 10 && (
                <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              )}
              <div className="w-3.5 h-3.5 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: "#008CE7" }}>
                <svg viewBox="0 0 24 24" className="w-2 h-2 fill-white"><path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm1.5 14.5h-3v-2h3c.828 0 1.5-.672 1.5-1.5S14.328 11 13.5 11H10V9h3.5c1.933 0 3.5 1.567 3.5 3.5S15.433 16 13.5 16.5z"/></svg>
              </div>
              <span className="text-[11px] font-semibold text-white/80 tabular-nums">{tokenBalance}</span>
            </button>
          )}
          {/* Guest badge + 15-min countdown */}
          {isGuestMode && (
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold"
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
              {guestSecsLeft !== null && guestSecsLeft > 0 && (
                <span className="tabular-nums ml-1">{fmtMmSs(guestSecsLeft)}</span>
              )}
              {guestSecsLeft === 0 && (
                <button
                  onClick={() => navigate("/register")}
                  className="ml-1 underline"
                >
                  Join!
                </button>
              )}
            </span>
          )}
          {/* Newcomer session countdown + upgrade nudge */}
          {!isGuestMode && participantTier === 'newcomer' && sessionSecsLeft !== null && sessionSecsLeft > 0 && (
            <button
              type="button"
              onClick={() => navigate("/subscribe")}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold transition-opacity hover:opacity-80"
              style={{
                background: sessionSecsLeft < 300 ? "rgba(212,0,122,0.20)" : "rgba(123,97,255,0.18)",
                border:     `1px solid ${sessionSecsLeft < 300 ? "rgba(212,0,122,0.5)" : "rgba(123,97,255,0.40)"}`,
                color:      sessionSecsLeft < 300 ? "#FF6BB0" : "#A990FF",
              }}
              title="Free preview — tap to become a Member for mic + all-day cam"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {fmtMmSs(sessionSecsLeft)}
              {sessionSecsLeft < 300 && <span className="ml-0.5">· Upgrade</span>}
            </button>
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
        {/* Chat overlay toggle */}
        <button
          type="button"
          aria-label={chatOverlayVisible ? "Hide chat messages" : "Show chat messages"}
          title={chatOverlayVisible ? "Hide messages" : "Show messages"}
          onClick={() => setChatOverlayVisible((o) => !o)}
          className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full transition-all hover:bg-white/10 active:scale-[0.94] shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black"
          style={{
            background: chatOverlayVisible ? "linear-gradient(135deg,#D4007A,#7B61FF)" : "rgba(20,20,30,0.85)",
            border: chatOverlayVisible ? "1px solid rgba(212,0,122,0.60)" : "1px solid rgba(212,0,122,0.35)",
            backdropFilter: "blur(6px)",
            boxShadow: "0 4px 16px rgba(0,0,0,0.45)",
          }}
        >
          <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
          </svg>
        </button>
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
          <RoomAudioRenderer />
          <ForceCamMicEnforcer active />
          <MainStageInner
            mode={mode as ModeId}
            spotlightCammer={state?.spotlight?.cammer ?? null}
            spotlightNextAt={state?.spotlight?.nextAt ?? null}
            mediaKind={state?.media?.kind || "off"}
            mediaSrc={state?.media?.src ?? null}
            mediaPlaying={state?.media?.playing ?? true}
            mediaVolume={state?.media?.volume ?? 70}
            mediaStartedAt={state?.media?.startedAt ?? null}
            isParticipant={isParticipant}
            isAdmin={isAdmin}
            onSpotlightPick={(identity) => admin.setSpotlight(identity)}
            onConnectionStateChange={setConnState}
            onCammersChange={handleCammersChange}
            onLeave={handleLeave}
            spotlight={state?.spotlight}
            showTips={!adminOpen}
            onSendReaction={handleSendReaction}
            canScreenShare={canScreenShare}
            hasMic={hasMic}
            skipVoteCount={skipVoteCount}
            skipVoteThreshold={skipVoteThreshold}
            hasVotedSkip={hasVotedSkip}
            onVoteSkip={handleVoteSkip}
            onPlayNext={canPlayNext ? handlePlayNext : undefined}
            playNextCooldown={playNextCooldown}
          />
        </LiveKitRoom>
      ) : isViewerMode ? (
        /* ── Viewer: subscribe-only LiveKit connection ── */
        <>
          <LiveKitRoom
            key="main-stage-viewer"
            token={viewerLkToken!}
            serverUrl={viewerLkUrl!}
            connect
            audio={false}
            video={false}
            className="contents"
          >
            <RoomAudioRenderer />
            <ForceCamMicEnforcer active={false} />
            <MainStageInner
              mode={mode as ModeId}
              spotlightCammer={(viewerStateOverride ?? state)?.spotlight?.cammer ?? null}
              spotlightNextAt={(viewerStateOverride ?? state)?.spotlight?.nextAt ?? null}
              mediaKind={(viewerStateOverride ?? state)?.media?.kind || "off"}
              mediaSrc={(viewerStateOverride ?? state)?.media?.src ?? null}
              mediaPlaying={(viewerStateOverride ?? state)?.media?.playing ?? true}
              mediaVolume={(viewerStateOverride ?? state)?.media?.volume ?? 70}
              mediaStartedAt={(viewerStateOverride ?? state)?.media?.startedAt ?? null}
              isParticipant={false}
              isAdmin={false}
              onSpotlightPick={() => {}}
              onConnectionStateChange={setViewerConnState}
              onCammersChange={handleCammersChange}
              onLeave={handleLeave}
              spotlight={(viewerStateOverride ?? state)?.spotlight}
              showTips={false}
              showBottomBar={false}
            />
          </LiveKitRoom>

          {/* Login CTA — viewers are unauthenticated, prompt them to sign in and join */}
          <div
            className="flex-shrink-0 flex items-center gap-3 px-4 py-3"
            style={{
              background: "rgba(10,10,15,0.97)",
              borderTop: "1px solid rgba(255,255,255,0.08)",
              paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom, 0px))",
            }}
          >
            <button
              type="button"
              onClick={handleLeave}
              aria-label={t.live.mainStageAriaLeave}
              className="min-h-[40px] min-w-[40px] flex-shrink-0 flex items-center justify-center rounded-full bg-pnp-error/15 border border-pnp-error/30 text-pnp-error hover:bg-white/10 active:scale-[0.96] transition-all"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
              </svg>
            </button>
            <div className="flex-1 min-w-0">
              <p className="text-white font-semibold text-sm leading-tight">
                {liveParticipants > 0 ? `${liveParticipants} on camera` : "Join the show"}
              </p>
              <p className="text-white/45 text-xs leading-tight mt-0.5">Create a free account to turn your camera on</p>
            </div>
            <button
              type="button"
              onClick={() => navigate("/login?return_to=/main-stage")}
              className="flex-shrink-0 min-h-[40px] px-4 rounded-2xl text-xs font-bold text-white transition-all active:scale-[0.97] whitespace-nowrap"
              style={{ background: "linear-gradient(135deg,#D4007A,#7B61FF)", boxShadow: "0 4px 16px rgba(212,0,122,0.45)" }}
            >
              Sign in
            </button>
          </div>
        </>
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
          <RoomAudioRenderer />
          <ForceCamMicEnforcer active={false} />
          <MainStageInner
            mode={mode as ModeId}
            spotlightCammer={state?.spotlight?.cammer ?? null}
            spotlightNextAt={state?.spotlight?.nextAt ?? null}
            mediaKind={state?.media?.kind || "off"}
            mediaSrc={state?.media?.src ?? null}
            mediaPlaying={state?.media?.playing ?? true}
            mediaVolume={state?.media?.volume ?? 70}
            mediaStartedAt={state?.media?.startedAt ?? null}
            isParticipant={isParticipant}
            isAdmin={isAdmin}
            onSpotlightPick={(identity) => admin.setSpotlight(identity)}
            onConnectionStateChange={setConnState}
            onCammersChange={handleCammersChange}
            onLeave={handleLeave}
            spotlight={state?.spotlight}
            showTips={!adminOpen}
            onSendReaction={handleSendReaction}
            canScreenShare={canScreenShare}
            hasMic={hasMic}
            skipVoteCount={skipVoteCount}
            skipVoteThreshold={skipVoteThreshold}
            hasVotedSkip={hasVotedSkip}
            onVoteSkip={handleVoteSkip}
            onPlayNext={canPlayNext ? handlePlayNext : undefined}
            playNextCooldown={playNextCooldown}
          />
        </LiveKitRoom>
      )}

      {/* ── Always-visible chat input — sits below the participant bottom bar ── */}
      {!isViewerMode && (
        <div
          className="flex-shrink-0 flex items-center gap-2 px-3 py-2 z-40"
          style={{
            background: "rgba(8,8,14,0.88)",
            backdropFilter: "blur(16px)",
            borderTop: "1px solid rgba(255,255,255,0.06)",
            paddingBottom: "calc(0.5rem + env(safe-area-inset-bottom, 0px))",
          }}
        >
          <input
            ref={chatInputRef}
            type="text"
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleChatSend(); } }}
            placeholder={user ? "Say something…" : "Sign in to chat"}
            disabled={!user}
            maxLength={300}
            className="flex-1 min-h-[38px] px-3 rounded-xl text-sm text-white placeholder-white/30 bg-white/[0.07] border border-white/10 focus:outline-none focus:border-pnp-accent/50 disabled:opacity-40"
          />
          <button
            type="button"
            onClick={handleChatSend}
            disabled={!user || !chatInput.trim()}
            aria-label="Send message"
            className="flex-shrink-0 min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl transition-all active:scale-[0.94] disabled:opacity-30 disabled:cursor-not-allowed"
            style={{ background: "linear-gradient(135deg,#D4007A,#7B61FF)" }}
          >
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
            </svg>
          </button>
        </div>
      )}

      <ConnectionOverlay
        connState={isViewerMode ? viewerConnState : connState}
        errorMessage={isViewerMode ? (viewerError ?? null) : (camError || error)}
        hasEverConnected={hasEverConnected}
      />

      {state?.media?.kind === "video" && state.media.title && !adminOpen && (
        <NowPlayingChip title={state.media.title} />
      )}

      {adminOpen && state && (
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

      <BuyTokensModal
        isOpen={showBuyTokens}
        onClose={() => setShowBuyTokens(false)}
        onSuccess={(newBalance) => setTokenBalance(newBalance)}
        dpnsHandle={null}
      />

      {/* ── YouTube-style chat messages overlay ─────────────────────────────── */}
      <style>{`
        @keyframes mainstage-float-up {
          0%   { transform: translateY(0) scale(1);   opacity: 1; }
          80%  { transform: translateY(-60vh) scale(1.2); opacity: 0.9; }
          100% { transform: translateY(-80vh) scale(0.8); opacity: 0; }
        }
        @keyframes chat-msg-in {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      {chatOverlayVisible && !isViewerMode && chatMessages.length > 0 && (
        <div
          aria-live="polite"
          aria-label="Chat messages"
          className="absolute left-3 pointer-events-none z-30 flex flex-col justify-end gap-1"
          style={{
            bottom: "calc(116px + env(safe-area-inset-bottom, 0px))",
            maxWidth: "min(280px, 58vw)",
            maxHeight: "38vh",
            overflow: "hidden",
          }}
        >
          {chatMessages.slice(-10).map((msg) => {
            const isMe = user && String(msg.userId) === String(user.id);
            return (
              <div
                key={msg.id}
                className="flex flex-col"
                style={{ animation: "chat-msg-in 0.2s ease-out" }}
              >
                <div
                  className="inline-flex flex-col px-2.5 py-1 rounded-2xl self-start"
                  style={{
                    background: isMe
                      ? "linear-gradient(135deg,rgba(212,0,122,0.55),rgba(123,97,255,0.45))"
                      : "rgba(0,0,0,0.58)",
                    backdropFilter: "blur(8px)",
                    border: isMe ? "1px solid rgba(212,0,122,0.30)" : "1px solid rgba(255,255,255,0.06)",
                    maxWidth: "100%",
                  }}
                >
                  <span
                    className="text-[10px] font-bold leading-tight"
                    style={{
                      background: isMe ? "rgba(255,255,255,0.9)" : "linear-gradient(90deg,#FF6BB0,#A990FF)",
                      WebkitBackgroundClip: "text",
                      WebkitTextFillColor: "transparent",
                    }}
                  >
                    {msg.displayName}
                  </span>
                  <span className="text-[12px] leading-snug text-white/92 break-words">{msg.text}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Floating reaction emojis ────────────────────────────────────────── */}
      {reactions.map((r) => (
        <div
          key={r.id}
          aria-hidden
          style={{
            position: "fixed",
            left: `${r.x}%`,
            bottom: "80px",
            fontSize: "2rem",
            lineHeight: 1,
            pointerEvents: "none",
            userSelect: "none",
            animation: "mainstage-float-up 3s ease-out forwards",
            zIndex: 44,
          }}
        >
          {r.emoji}
        </div>
      ))}
    </div>
  );
}

// Re-export AdminPanelContent for any external consumers (e.g. standalone
// settings modal) that import it directly from this page module.
export { AdminPanelContent } from "@/components/mainstage/AdminDrawer";
