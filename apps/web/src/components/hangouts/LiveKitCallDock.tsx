import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CarouselLayout,
  ControlBar,
  FocusLayoutContainer,
  GridLayout,
  LayoutContextProvider,
  LiveKitRoom,
  ParticipantTile,
  RoomAudioRenderer,
  useCreateLayoutContext,
  useMaybeTrackRefContext,
  usePinnedTracks,
  useRoomContext,
  useTracks,
  useParticipants,
} from "@livekit/components-react";
import type { TrackReferenceOrPlaceholder } from "@livekit/components-react";
import { ConnectionState, RoomEvent, Track, VideoQuality } from "livekit-client";
import type { RemoteTrackPublication } from "livekit-client";
import type { LocalUserChoices } from "@livekit/components-core";
import { useI18n } from "@/lib/i18n";
import { joinHangoutCall, muteHangoutCallParticipant, kickHangoutCallParticipant } from "@/lib/api";

interface LiveKitCallPanelProps {
  open: boolean;
  onClose: () => void;
  token: string | null;
  livekitUrl: string;
  roomName: string | null;
  startedBy?: string | null;
  participantCount?: number;
  durationLabel?: string;
  initialChoices?: LocalUserChoices | null;
  onCallEnded?: () => void;
  isModerator?: boolean;
}

function extractGroupId(name: string | null): number | null {
  if (!name) return null;
  const match = name.match(/hangout[-_](\d+)/);
  if (!match) return null;
  const id = parseInt(match[1], 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

type PresenceToast = { id: number; name: string; kind: "joined" | "left" };

// Inner overlay — uses room hooks, so must live inside <LiveKitRoom>.
function CallOverlay({
  startedBy,
  isModerator,
  groupId,
}: {
  startedBy: string | null;
  isModerator: boolean;
  groupId: number | null;
}) {
  const room = useRoomContext();
  const participants = useParticipants();
  const [elapsed, setElapsed] = useState(0);
  const [connState, setConnState] = useState<ConnectionState>(ConnectionState.Connecting);
  const joinTsRef = useRef<number | null>(null);

  // Presence toasts ("Sara joined" / "John left")
  const [presenceToasts, setPresenceToasts] = useState<PresenceToast[]>([]);
  const prevRemoteIdsRef = useRef<Set<string> | null>(null);
  const prevRemoteNamesRef = useRef<Map<string, string>>(new Map());
  const presenceSeqRef = useRef(0);

  // Moderator participant roster
  const [rosterOpen, setRosterOpen] = useState(false);
  const [mutingId, setMutingId] = useState<string | null>(null);
  const [kickingId, setKickingId] = useState<string | null>(null);

  useEffect(() => {
    if (!room) return;
    const handler = (s: ConnectionState) => {
      setConnState(s);
      if (s === ConnectionState.Connected && !joinTsRef.current) {
        joinTsRef.current = Date.now();
      }
    };
    room.on(RoomEvent.ConnectionStateChanged, handler);
    handler(room.state);
    return () => { room.off(RoomEvent.ConnectionStateChanged, handler); };
  }, [room]);

  useEffect(() => {
    const iv = setInterval(() => {
      if (joinTsRef.current) {
        setElapsed(Math.floor((Date.now() - joinTsRef.current) / 1000));
      }
    }, 1000);
    return () => clearInterval(iv);
  }, []);

  // Diff remote participants on every change → emit transient toasts.
  // Skip the initial population so we don't spam "X joined" for everyone
  // already in the call when the local user joins.
  useEffect(() => {
    const remote = participants.filter((p) => !p.isLocal);
    const currentIds = new Set(remote.map((p) => p.identity));
    const currentNames = new Map(
      remote.map((p) => [p.identity, p.name?.trim() || p.identity] as const),
    );

    const prev = prevRemoteIdsRef.current;
    if (prev === null) {
      prevRemoteIdsRef.current = currentIds;
      prevRemoteNamesRef.current = currentNames;
      return;
    }

    const toAdd: PresenceToast[] = [];
    for (const id of currentIds) {
      if (!prev.has(id)) {
        toAdd.push({
          id: ++presenceSeqRef.current,
          name: currentNames.get(id) || "Someone",
          kind: "joined",
        });
      }
    }
    for (const id of prev) {
      if (!currentIds.has(id)) {
        toAdd.push({
          id: ++presenceSeqRef.current,
          name: prevRemoteNamesRef.current.get(id) || "Someone",
          kind: "left",
        });
      }
    }

    if (toAdd.length > 0) {
      setPresenceToasts((curr) => [...curr, ...toAdd].slice(-3));
      for (const t of toAdd) {
        setTimeout(() => {
          setPresenceToasts((curr) => curr.filter((x) => x.id !== t.id));
        }, 3000);
      }
    }

    prevRemoteIdsRef.current = currentIds;
    prevRemoteNamesRef.current = currentNames;
  }, [participants]);

  const isConnected = connState === ConnectionState.Connected;
  const isConnecting = connState === ConnectionState.Connecting;
  const isReconnecting = connState === ConnectionState.Reconnecting;
  const isAlone = isConnected && participants.length <= 1;

  return (
    <>
      <div
        className="pointer-events-none absolute top-0 left-0 right-0 z-10 px-2 py-2 sm:px-3 flex items-center justify-between gap-1.5 sm:gap-2"
        style={{
          background: "linear-gradient(180deg, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0) 100%)",
          paddingRight: "calc(3rem + env(safe-area-inset-right, 0px))", // leave room for × button
          paddingTop: "calc(0.5rem + env(safe-area-inset-top, 0px))",
          paddingLeft: "calc(0.5rem + env(safe-area-inset-left, 0px))",
        }}
      >
        <div className="flex items-center gap-1 sm:gap-1.5 text-white text-[11px] sm:text-xs min-w-0 flex-shrink">
          {startedBy && (
            <span
              className="px-2 sm:px-2.5 py-1 rounded-full bg-black/50 backdrop-blur-md truncate max-w-[40vw] sm:max-w-[200px] border border-white/10"
              title={`Hosted by ${startedBy}`}
            >
              <span className="mr-1" aria-hidden>👑</span>
              <span className="font-medium">{startedBy}</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 sm:gap-1.5 text-white text-[11px] sm:text-xs flex-shrink-0">
          {isConnected && (
            <span className="px-2 sm:px-2.5 py-1 rounded-full bg-black/50 backdrop-blur-md tabular-nums font-medium border border-white/10">
              {formatDuration(elapsed)}
            </span>
          )}
          <button
            type="button"
            onClick={() => setRosterOpen((v) => !v)}
            aria-label={`${participants.length} participants — ${rosterOpen ? "close" : "open"} roster`}
            className="px-2 sm:px-2.5 py-1 rounded-full bg-black/50 backdrop-blur-md border border-white/10 whitespace-nowrap hover:bg-black/70 active:scale-95 transition-all pointer-events-auto"
          >
            <span className="mr-1" aria-hidden>👥</span>{participants.length}
          </button>
        </div>
      </div>

      {/* Moderator participant roster — slides in from the top */}
      {rosterOpen && (
        <div
          className="absolute left-2 right-12 z-10 mt-1 rounded-xl overflow-hidden shadow-2xl animate-fade-in-up"
          style={{
            top: "calc(2.75rem + env(safe-area-inset-top, 0px))",
            background: "rgba(10,10,20,0.92)",
            border: "1px solid rgba(255,255,255,0.1)",
            backdropFilter: "blur(12px)",
            maxHeight: "min(55dvh, 320px)",
            overflowY: "auto",
          }}
        >
          <div className="px-3 py-2 text-[10px] uppercase tracking-wider text-white/40 font-semibold border-b border-white/10">
            Participants ({participants.length})
          </div>
          {participants.map((p) => {
            const name = p.name?.trim() || p.identity;
            const isLocal = p.isLocal;
            return (
              <div
                key={p.identity}
                className="flex items-center gap-2 px-3 py-2 hover:bg-white/5 transition-colors"
              >
                <div className="w-6 h-6 rounded-full bg-pink-500/30 flex items-center justify-center text-[10px] font-bold text-pink-200 flex-shrink-0">
                  {name.slice(0, 1).toUpperCase()}
                </div>
                <span className="flex-1 text-xs text-white truncate min-w-0">
                  {name}
                  {isLocal && (
                    <span className="ml-1 text-[10px] text-white/40">(you)</span>
                  )}
                </span>
                {isModerator && !isLocal && groupId != null && (
                  <div className="flex gap-1 flex-shrink-0">
                    <button
                      type="button"
                      title="Mute"
                      disabled={mutingId === p.identity}
                      onClick={async () => {
                        setMutingId(p.identity);
                        try { await muteHangoutCallParticipant(groupId, p.identity); }
                        catch { /* best-effort */ }
                        finally { setMutingId(null); }
                      }}
                      className="w-6 h-6 rounded-full flex items-center justify-center bg-white/10 hover:bg-amber-500/30 active:scale-90 transition-all disabled:opacity-40"
                      aria-label={`Mute ${name}`}
                    >
                      {mutingId === p.identity ? (
                        <span className="w-2.5 h-2.5 border border-white/40 border-t-white rounded-full animate-spin" />
                      ) : (
                        <svg className="w-3 h-3 text-amber-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                          <line x1="3" y1="3" x2="21" y2="21" strokeLinecap="round" />
                        </svg>
                      )}
                    </button>
                    <button
                      type="button"
                      title="Remove"
                      disabled={kickingId === p.identity}
                      onClick={async () => {
                        setKickingId(p.identity);
                        try { await kickHangoutCallParticipant(groupId, p.identity); }
                        catch { /* best-effort */ }
                        finally { setKickingId(null); }
                      }}
                      className="w-6 h-6 rounded-full flex items-center justify-center bg-white/10 hover:bg-red-500/30 active:scale-90 transition-all disabled:opacity-40"
                      aria-label={`Remove ${name}`}
                    >
                      {kickingId === p.identity ? (
                        <span className="w-2.5 h-2.5 border border-white/40 border-t-red-400 rounded-full animate-spin" />
                      ) : (
                        <svg className="w-3 h-3 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      )}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {isReconnecting && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 z-10 px-3 py-1.5 rounded-full bg-amber-500/95 text-black text-xs font-semibold backdrop-blur-sm shadow-lg flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-amber-900 animate-pulse" />
          Reconnecting…
        </div>
      )}

      {isAlone && (
        <div
          className="pointer-events-none absolute left-1/2 -translate-x-1/2 z-10 px-4 py-3 rounded-2xl bg-black/70 text-white text-sm backdrop-blur-md border border-white/10 max-w-[min(280px,calc(100%-2rem))] text-center"
          style={{ bottom: "calc(5.5rem + env(safe-area-inset-bottom, 0px))" }}
        >
          <div className="font-semibold mb-0.5">You're the only one here</div>
          <div className="text-xs text-white/70">Others can join from the hangout chat.</div>
        </div>
      )}

      {isConnecting && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 z-10 px-3 py-1.5 rounded-full bg-pink-500/95 text-white text-xs font-semibold backdrop-blur-sm shadow-lg flex items-center gap-2">
          <span
            className="w-3 h-3 rounded-full border-2 border-white/30 animate-spin"
            style={{ borderTopColor: "#fff" }}
          />
          Connecting…
        </div>
      )}

      {presenceToasts.length > 0 && (
        <div
          className="pointer-events-none absolute z-20 flex flex-col items-end gap-1.5"
          style={{
            top: "calc(3.25rem + env(safe-area-inset-top, 0px))",
            right: "calc(0.75rem + env(safe-area-inset-right, 0px))",
            maxWidth: "min(70vw, 240px)",
          }}
        >
          {presenceToasts.map((toast) => (
            <div
              key={toast.id}
              className="px-2.5 py-1 rounded-full bg-black/70 backdrop-blur-md border border-white/10 text-white text-[11px] font-medium animate-fade-in-up shadow-lg flex items-center gap-1.5 max-w-full"
            >
              <span aria-hidden>{toast.kind === "joined" ? "→" : "←"}</span>
              <span className="truncate">
                {toast.name} {toast.kind === "joined" ? "joined" : "left"}
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function LiveKitCallPanel({
  open,
  onClose,
  token,
  livekitUrl,
  roomName,
  startedBy = null,
  initialChoices = null,
  onCallEnded,
  isModerator = false,
}: LiveKitCallPanelProps) {
  const [activeToken, setActiveToken] = useState<string | null>(token);
  const [connectedAt, setConnectedAt] = useState<number | null>(null);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const hasLeftRef = useRef(false);

  useEffect(() => { setActiveToken(token); }, [token]);

  // Proactive token refresh: re-mint 30 min before the 2h token expires so
  // users are never silently kicked by LiveKit at the token TTL boundary.
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const scheduleTokenRefresh = useCallback((groupId: number | null) => {
    if (groupId == null) return;
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    // Refresh 30 min before the 2h hangout token expires → fire at 1h30m.
    const REFRESH_MS = (90) * 60 * 1000;
    refreshTimerRef.current = setTimeout(async () => {
      if (!mountedRef.current) return;
      try {
        const res = await joinHangoutCall(groupId);
        if (!mountedRef.current) return;
        setActiveToken(res.token);
        scheduleTokenRefresh(groupId);
      } catch {
        // Retry in 5 minutes if the refresh endpoint fails.
        refreshTimerRef.current = setTimeout(
          () => scheduleTokenRefresh(groupId),
          5 * 60 * 1000,
        );
      }
    }, REFRESH_MS);
  }, []);

  useEffect(() => {
    if (!open || !token) return;
    const groupId = extractGroupId(roomName);
    scheduleTokenRefresh(groupId);
    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, [open, token, roomName, scheduleTokenRefresh]);

  // Allow landscape while the call is open (portrait-lock CSS otherwise blocks it).
  useEffect(() => {
    if (!open) return;
    document.body.classList.add("allow-landscape");
    return () => { document.body.classList.remove("allow-landscape"); };
  }, [open]);

  // Fire /leave when the dock unmounts or closes so
  // hangout_call_participants.left_at is set and the DB trigger recomputes
  // participant_count.
  useEffect(() => {
    if (!open || !roomName) return;
    hasLeftRef.current = false;
    return () => {
      if (hasLeftRef.current) return;
      hasLeftRef.current = true;
      const groupId = extractGroupId(roomName);
      if (groupId == null) return;
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      import("@/lib/api").then(({ leaveHangoutCall }) => {
        leaveHangoutCall(groupId).catch(() => {});
      }).catch(() => {});
    };
  }, [open, roomName]);

  // LiveKit disconnect event also fires /leave so the participant row closes
  // even if the component stays mounted (e.g. remote end-of-call).
  const handleDisconnected = useCallback(() => {
    if (!hasLeftRef.current && roomName) {
      hasLeftRef.current = true;
      const groupId = extractGroupId(roomName);
      if (groupId != null) {
        import("@/lib/api").then(({ leaveHangoutCall }) => {
          leaveHangoutCall(groupId).catch(() => {});
        }).catch(() => {});
      }
    }
    onCallEnded?.();
  }, [roomName, onCallEnded]);

  const handleConnected = useCallback(() => {
    setConnectedAt(Date.now());
  }, []);

  // Leave flow — require confirmation after 10s of connection so accidental
  // taps on the × don't drop people from meaningful calls.
  const requestClose = useCallback(() => {
    const secondsInCall = connectedAt ? (Date.now() - connectedAt) / 1000 : 0;
    if (secondsInCall < 10) {
      onClose();
    } else {
      setShowLeaveConfirm(true);
    }
  }, [connectedAt, onClose]);

  const confirmLeave = useCallback(() => {
    setShowLeaveConfirm(false);
    onClose();
  }, [onClose]);

  if (!open || !activeToken) return null;

  // Safari <16 can't publish VP9 reliably — fall back to h264.
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const isSafari = /^((?!chrome|android|crios|fxios).)*safari/i.test(ua);
  const publishCodec: "vp9" | "h264" = isSafari ? "h264" : "vp9";

  return (
    <div
      className="lk-pnptv-call mx-3 mt-2 mb-1 md:mx-auto md:my-3 md:self-center flex-shrink-0 rounded-2xl overflow-hidden relative w-auto md:w-full"
      data-call-container
      data-lk-theme="default"
      style={{
        // Adaptive sizing: fits landscape phones (min-height shrinks with dvh)
        // and caps width on tablet/desktop so it doesn't stretch full-monitor.
        minHeight: "min(360px, calc(100dvh - 120px))",
        maxHeight: "min(80dvh, calc(100dvh - 5rem))",
        maxWidth: "min(64rem, calc(100vw - 1.5rem))",
        display: "flex",
        flexDirection: "column",
        border: "1px solid rgba(123,97,255,0.25)",
        background: "#000",
        boxShadow: "0 10px 40px rgba(123,97,255,0.12)",
      }}
    >
      <LiveKitRoom
        token={activeToken}
        serverUrl={livekitUrl}
        connect={true}
        audio={initialChoices
          ? (initialChoices.audioEnabled ? { deviceId: initialChoices.audioDeviceId || undefined } : false)
          : false}
        video={initialChoices
          ? (initialChoices.videoEnabled ? { deviceId: initialChoices.videoDeviceId || undefined } : false)
          : true}
        options={{
          adaptiveStream: true,
          dynacast: true,
          publishDefaults: { simulcast: true, videoCodec: publishCodec },
          // Prefer front camera on mobile so private calls don't open with the rear cam.
          videoCaptureDefaults: { facingMode: "user" },
        }}
        onConnected={handleConnected}
        onDisconnected={handleDisconnected}
        style={{ display: "contents" }}
      >
        <CallStage />
        <CallOverlay
          startedBy={startedBy}
          isModerator={isModerator}
          groupId={extractGroupId(roomName)}
        />
      </LiveKitRoom>

      <button
        type="button"
        onClick={requestClose}
        aria-label="Close call"
        className="absolute z-30 w-10 h-10 sm:w-9 sm:h-9 rounded-full bg-black/60 text-white hover:bg-black/80 active:scale-95 flex items-center justify-center text-xl leading-none backdrop-blur-md border border-white/10 transition-transform"
        style={{
          top: "calc(0.5rem + env(safe-area-inset-top, 0px))",
          right: "calc(0.5rem + env(safe-area-inset-right, 0px))",
        }}
      >
        ×
      </button>

      {showLeaveConfirm && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="leave-call-title"
            className="rounded-2xl p-5 max-w-sm w-full text-white"
            style={{
              background: "rgba(19, 16, 26, 0.98)",
              border: "1px solid rgba(123,97,255,0.25)",
              boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
            }}
          >
            <div id="leave-call-title" className="text-lg font-semibold mb-1">Leave call?</div>
            <div className="text-sm text-white/70 mb-4">
              You'll be disconnected from this hangout. You can rejoin anytime.
            </div>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setShowLeaveConfirm(false)}
                className="px-4 py-2 rounded-full bg-white/10 text-white hover:bg-white/20 text-sm font-medium transition-colors"
              >
                Stay
              </button>
              <button
                type="button"
                onClick={confirmLeave}
                className="px-4 py-2 rounded-full text-white font-semibold text-sm transition-transform active:scale-95"
                style={{
                  background: "#D4007A",
                  boxShadow: "0 4px 14px rgba(212,0,122,0.45)",
                }}
              >
                Leave call
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export const LiveKitCallDock = LiveKitCallPanel;
export default LiveKitCallPanel;

// ── CallStage (used by LiveKitCallDock and formerly by CallRoom) ──────────────

type ViewMode = "grid" | "spotlight" | "cinema";
const VIEW_MODE_STORAGE_KEY = "pnptv:call:viewMode";

const STAGE_STRINGS = {
  en: {
    modeGrid: "Grid", modeGridTitle: "Everyone equally",
    modeSpotlight: "Spotlight", modeSpotlightTitle: "One large + thumbnails",
    modeCinema: "Cinema", modeCinemaTitle: "Focus one cam, full screen",
    fullScreen: "Full screen", exitFullScreen: "Exit full screen",
    enterFullScreen: "Enter full screen",
  },
  es: {
    modeGrid: "Cuadrícula", modeGridTitle: "Todos por igual",
    modeSpotlight: "Destacado", modeSpotlightTitle: "Uno grande + miniaturas",
    modeCinema: "Cine", modeCinemaTitle: "Enfoca una cámara, pantalla completa",
    fullScreen: "Pantalla completa", exitFullScreen: "Salir de pantalla completa",
    enterFullScreen: "Entrar a pantalla completa",
  },
};

function readStoredMode(): ViewMode {
  try {
    const v = localStorage.getItem(VIEW_MODE_STORAGE_KEY);
    if (v === "grid" || v === "spotlight" || v === "cinema") return v;
  } catch { /* ignore */ }
  return "spotlight";
}

function refKey(t: TrackReferenceOrPlaceholder | undefined): string {
  if (!t) return "";
  const src = (t.publication?.source as string | undefined) ?? (t.source as unknown as string);
  return `${t.participant.identity}:${src}`;
}

function CarouselStripTile() {
  const trackRef = useMaybeTrackRefContext();
  useEffect(() => {
    if (!trackRef) return;
    const pub = trackRef.publication as RemoteTrackPublication | undefined;
    if (!pub || !("setVideoQuality" in pub)) return;
    pub.setVideoQuality(VideoQuality.LOW);
  }, [trackRef?.publication]);
  return <ParticipantTile />;
}

function FocusHeroTile({ trackRef }: { trackRef: TrackReferenceOrPlaceholder }) {
  useEffect(() => {
    const pub = trackRef.publication as RemoteTrackPublication | undefined;
    if (!pub || !("setVideoQuality" in pub)) return;
    pub.setVideoQuality(VideoQuality.HIGH);
  }, [trackRef.publication]);
  return <ParticipantTile trackRef={trackRef} />;
}

const MODE_ICONS: Record<ViewMode, JSX.Element> = {
  grid: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  ),
  spotlight: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <rect x="3" y="3" width="18" height="13" rx="1.8" /><rect x="3" y="18" width="5" height="3" rx="0.8" />
      <rect x="10" y="18" width="5" height="3" rx="0.8" /><rect x="17" y="18" width="4" height="3" rx="0.8" />
    </svg>
  ),
  cinema: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path strokeLinecap="round" d="M8 10l4 2.5L8 15z" fill="currentColor" />
    </svg>
  ),
};

function ViewModeToggle({ value, onChange }: { value: ViewMode; onChange: (v: ViewMode) => void }) {
  const i18n = useI18n();
  const ss = STAGE_STRINGS[i18n.lang === "es" ? "es" : "en"];
  const modes: Array<{ id: ViewMode; label: string; title: string }> = [
    { id: "grid", label: ss.modeGrid, title: ss.modeGridTitle },
    { id: "spotlight", label: ss.modeSpotlight, title: ss.modeSpotlightTitle },
    { id: "cinema", label: ss.modeCinema, title: ss.modeCinemaTitle },
  ];
  return (
    <div
      className="absolute top-4 left-1/2 -translate-x-1/2 z-50 flex gap-1 p-1 rounded-2xl"
      style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)", border: "1px solid rgba(255,255,255,0.10)" }}
      role="tablist"
      aria-label={i18n.lang === "es" ? "Modo de vista de llamada" : "Call view mode"}
    >
      {modes.map((m) => {
        const active = m.id === value;
        return (
          <button
            key={m.id} type="button" role="tab" aria-selected={active} title={m.title}
            onClick={() => onChange(m.id)}
            className="min-h-[36px] px-3 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all"
            style={{ background: active ? "#D4007A" : "transparent", color: active ? "#FFFFFF" : "#EBEBF5", opacity: active ? 1 : 0.75 }}
          >
            {MODE_ICONS[m.id]}
            <span className="hidden sm:inline">{m.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function FullscreenButton() {
  const i18n = useI18n();
  const ss = STAGE_STRINGS[i18n.lang === "es" ? "es" : "en"];
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const [isFs, setIsFs] = useState(() => typeof document !== "undefined" && document.fullscreenElement !== null);
  useEffect(() => {
    const onChange = () => setIsFs(document.fullscreenElement !== null);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  const toggle = () => {
    if (document.fullscreenElement) { document.exitFullscreen().catch(() => {}); return; }
    const target = btnRef.current?.closest<HTMLElement>("[data-call-container]");
    if (!target) return;
    target.requestFullscreen().catch(() => {});
  };
  return (
    <button ref={btnRef} type="button" onClick={toggle}
      aria-label={isFs ? ss.exitFullScreen : ss.enterFullScreen}
      title={isFs ? ss.exitFullScreen : ss.fullScreen}
      className="absolute top-4 z-50 w-9 h-9 rounded-xl flex items-center justify-center transition-opacity hover:opacity-80"
      style={{ right: "calc(3.25rem + env(safe-area-inset-right, 0px))", background: "rgba(0,0,0,0.55)", color: "#EBEBF5", border: "1px solid rgba(255,255,255,0.10)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)" }}
    >
      {isFs ? (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 9H5V5m0 14h4v-4m10 4h-4v-4m0-6h4V5" />
        </svg>
      ) : (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4h4m8 0h4v4m0 8v4h-4m-8 0H4v-4" />
        </svg>
      )}
    </button>
  );
}

export function CallStage() {
  const [mode, setMode] = useState<ViewMode>(() => readStoredMode());
  useEffect(() => {
    try { localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode); } catch { /* ignore */ }
  }, [mode]);

  const tracks = useTracks(
    [{ source: Track.Source.Camera, withPlaceholder: true }, { source: Track.Source.ScreenShare, withPlaceholder: false }],
    { onlySubscribed: true },
  );
  const layoutContext = useCreateLayoutContext();
  const pinnedTracks = usePinnedTracks(layoutContext);

  const screenShareTracks = useMemo(
    () => tracks.filter((t) => t.publication?.source === Track.Source.ScreenShare),
    [tracks],
  );

  const lastAutoPinnedRef = useRef<string | null>(null);
  useEffect(() => {
    const dispatch = layoutContext.pin.dispatch;
    if (!dispatch) return;
    const current = pinnedTracks?.[0];
    if (screenShareTracks.length > 0) {
      const ss = screenShareTracks[0];
      const key = refKey(ss);
      if (!current && lastAutoPinnedRef.current !== key) {
        dispatch({ msg: "set_pin", trackReference: ss });
        lastAutoPinnedRef.current = key;
      }
    } else if (lastAutoPinnedRef.current && current && refKey(current) === lastAutoPinnedRef.current) {
      dispatch({ msg: "clear_pin" });
      lastAutoPinnedRef.current = null;
    }
  }, [screenShareTracks, pinnedTracks, layoutContext.pin.dispatch]);

  const focusTrack: TrackReferenceOrPlaceholder | undefined =
    pinnedTracks?.[0] ?? screenShareTracks[0] ?? tracks.find((t) => !t.participant.isLocal) ?? tracks[0];

  const focusKey = refKey(focusTrack);
  const carouselTracks = useMemo(() => tracks.filter((t) => refKey(t) !== focusKey), [tracks, focusKey]);

  return (
    <LayoutContextProvider value={layoutContext}>
      <ViewModeToggle value={mode} onChange={setMode} />
      <FullscreenButton />
      <div className="absolute inset-0" style={{ paddingBottom: "96px" }}>
        {mode === "grid" && (
          <GridLayout tracks={tracks} style={{ height: "100%" }}>
            <ParticipantTile />
          </GridLayout>
        )}
        {mode === "spotlight" && focusTrack && (
          <FocusLayoutContainer style={{ height: "100%" }}>
            <CarouselLayout tracks={carouselTracks}><CarouselStripTile /></CarouselLayout>
            <FocusHeroTile trackRef={focusTrack} />
          </FocusLayoutContainer>
        )}
        {mode === "cinema" && focusTrack && (
          <div className="w-full h-full flex items-center justify-center">
            <FocusHeroTile trackRef={focusTrack} />
          </div>
        )}
      </div>
      <RoomAudioRenderer />
      <ControlBar
        variation="minimal"
        controls={{ chat: false, screenShare: true, leave: true }}
        style={{ position: "absolute", bottom: 0, left: 0, right: 0, zIndex: 40 }}
      />
    </LayoutContextProvider>
  );
}
