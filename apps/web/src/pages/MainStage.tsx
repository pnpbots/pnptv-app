import React, { useState, useEffect, useCallback } from "react";
import { Helmet } from "react-helmet-async";
import { Card, Button } from "@pnptv/ui-kit";
import { useAuth } from "@/hooks/useAuth";
import { useTier } from "@/hooks/useTier";
import { getSocket } from "@/lib/socket";
import { connectSocket } from "@/lib/socket";
import TelegramCallDock from "@/components/hangouts/TelegramCallDock";

import {
  getCommunityRoomOccupancy,
  getStageState,
  setStageMode as apiSetStageMode,
  knockToSpeak,
  getHangoutGroups,
  startHangoutCall,
  joinHangoutCall,
  type StageState,
  type HangoutGroup,
} from "@/lib/api";
import { UpcomingEvents } from "@/components/events";

export default function MainStage() {
  const { user, isAuthenticated } = useAuth();
  const { isPrime, isMember, isFree, isAdmin } = useTier();
  const [occupancy, setOccupancy] = useState<number>(0);
  const [occupancyUsers, setOccupancyUsers] = useState<
    Array<{ userId: string; displayName: string; role: string; tier?: string; avatarUrl?: string; joinedAt: string }>
  >([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [occupancyError, setOccupancyError] = useState(false);
  const [stageState, setStageState] = useState<StageState | null>(null);
  const [knockStatus, setKnockStatus] = useState<'idle' | 'pending' | 'approved' | 'denied'>('idle');
  const [stageModeLoading, setStageModeLoading] = useState(false);
  const [knockQueue, setKnockQueue] = useState<Array<{ userId: string; displayName: string }>>([]);
  const [mainGroup, setMainGroup] = useState<HangoutGroup | null>(null);
  const [showTelegramDock, setShowTelegramDock] = useState(false);
  const [callToken, setCallToken] = useState<string | null>(null);
  const [callRoomName, setCallRoomName] = useState<string | null>(null);
  const [callLivekitUrl, setCallLivekitUrl] = useState<string>("wss://livekit.pnptv.app");
  const [callStartedBy, setCallStartedBy] = useState<string | null>(null);
  const [callParticipantCount, setCallParticipantCount] = useState(0);
  const [callStartTime, setCallStartTime] = useState<Date | null>(null);
  const [callDuration, setCallDuration] = useState("0:00");
  const [callError, setCallError] = useState<string | null>(null);

  useEffect(() => {
    const fetchOccupancy = () => {
      getCommunityRoomOccupancy()
        .then((res) => {
          setOccupancy(res.occupancy?.activeUsers ?? 0);
          setOccupancyUsers(res.occupancy?.users ?? []);
        })
        .catch(() => setOccupancyError(true));
    };
    fetchOccupancy();
    const occupancyInterval = setInterval(fetchOccupancy, 30000);

    getStageState()
      .then((res) => { if (res.stageState) setStageState(res.stageState); })
      .catch(() => {});

    // Fetch main hangout group (for call state)
    getHangoutGroups()
      .then((res) => {
        const main = (res.groups || []).find((g: HangoutGroup) => g.isMain);
        if (main) {
          setMainGroup(main);
        }
      })
      .catch(() => {});

    return () => clearInterval(occupancyInterval);
  }, []);

  useEffect(() => {
    if (!mainGroup?.id) return;
    const socket = connectSocket();

    const onCallStarted = (data: {
      groupId: number;
      startedBy?: { firstName?: string; username?: string };
    }) => {
      if (data.groupId !== mainGroup.id) return;
      setCallParticipantCount(0);
      setCallStartTime(new Date());
      setCallStartedBy(data.startedBy?.firstName || data.startedBy?.username || null);
    };

    const onCallEnded = (data: { groupId: number }) => {
      if (data.groupId !== mainGroup.id) return;
      setShowTelegramDock(false);
      setCallToken(null);
      setCallRoomName(null);
      setCallParticipantCount(0);
      setCallStartTime(null);
      setCallStartedBy(null);
      setCallDuration("0:00");
    };

    const onParticipantJoined = (data: { groupId: number; count?: number }) => {
      if (data.groupId !== mainGroup.id) return;
      setCallParticipantCount((prev) => prev + (data.count ?? 1));
    };

    socket.on("hangout:call:started", onCallStarted);
    socket.on("hangout:call:ended", onCallEnded);
    socket.on("hangout:call:participant-joined", onParticipantJoined);

    return () => {
      socket.off("hangout:call:started", onCallStarted);
      socket.off("hangout:call:ended", onCallEnded);
      socket.off("hangout:call:participant-joined", onParticipantJoined);
    };
  }, [mainGroup?.id]);

  useEffect(() => {
    if (!callStartTime) {
      setCallDuration("0:00");
      return;
    }
    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - callStartTime.getTime()) / 1000);
      const minutes = Math.floor(elapsed / 60);
      const seconds = elapsed % 60;
      setCallDuration(`${minutes}:${seconds.toString().padStart(2, "0")}`);
    }, 1000);
    return () => clearInterval(interval);
  }, [callStartTime]);


  const handleJoinClick = async () => {
    if (!user || !mainGroup?.id) return;
    try {
      setCallError(null);
      setError("");
      let result;
      try {
        result = await joinHangoutCall(mainGroup.id);
      } catch (joinErr: any) {
        if (joinErr?.status === 404 || joinErr?.message?.includes('404')) {
          result = await startHangoutCall(mainGroup.id);
        } else {
          throw joinErr;
        }
      }
      setCallToken(result.token);
      setCallRoomName(result.roomName);
      setCallLivekitUrl(result.livekitUrl || "wss://livekit.pnptv.app");
      setShowTelegramDock(true);
    } catch {
      setCallError("Could not connect to the call. Please try again.");
    }
  };

  const joinStageEvents = useCallback(() => {
    const socket = getSocket();
    socket.emit('mainstage:join');
    socket.off('mainstage:mode-changed');
    socket.off('mainstage:knock:approved');
    socket.off('mainstage:knock:denied');
    socket.off('mainstage:knock:new');
    socket.off('mainstage:knock:resolved');
    socket.off('mainstage:clip-dropped');
    socket.on('mainstage:mode-changed', (data: { mode: string; master: any }) => {
      setStageState({ mode: data.mode as StageState['mode'], master: data.master });
    });
    socket.on('mainstage:knock:approved', () => setKnockStatus('approved'));
    socket.on('mainstage:knock:denied', () => setKnockStatus('denied'));
    socket.on('mainstage:knock:new', (data: { userId: string; displayName: string }) => {
      setKnockQueue((q) => q.some((k) => k.userId === data.userId) ? q : [...q, data]);
    });
    socket.on('mainstage:knock:resolved', (data: { targetUserId: string }) => {
      setKnockQueue((q) => q.filter((k) => k.userId !== data.targetUserId));
    });
    socket.on('mainstage:clip-dropped', (data: { displayName: string }) => {
      setError(`🎬 ${data.displayName || 'Someone'} dropped a clip!`);
      setTimeout(() => setError(''), 4000);
    });
  }, []);

  useEffect(() => {
    if (!showTelegramDock) return;
    joinStageEvents();
  }, [joinStageEvents, showTelegramDock]);

  const handleLeave = () => {
    const socket = getSocket();
    if (socket) {
      socket.emit('mainstage:leave');
      socket.off('mainstage:mode-changed');
      socket.off('mainstage:knock:approved');
      socket.off('mainstage:knock:denied');
      socket.off('mainstage:knock:new');
      socket.off('mainstage:knock:resolved');
      socket.off('mainstage:clip-dropped');
    }
    setShowTelegramDock(false);
    setKnockStatus('idle');
    setKnockQueue([]);
    getCommunityRoomOccupancy()
      .then((res) => {
        setOccupancy(res.occupancy?.activeUsers ?? 0);
        setOccupancyUsers(res.occupancy?.users ?? []);
      })
      .catch(() => {});
  };

  // ─── Pre-join lobby ────────────────────────────────────────────────────

  return (
    <div className="p-4 pb-24 max-w-2xl mx-auto space-y-6">
      <Helmet>
        <title>Main Stage | PNPtv</title>
      </Helmet>

      {/* Stage Preview — visual hero */}
      <Card className="overflow-hidden">
        {/* Animated gradient stage backdrop */}
        <div
          className="relative w-full aspect-video flex flex-col items-center justify-center overflow-hidden"
          style={{
            background: stageState?.mode === 'dj-live'
              ? 'linear-gradient(135deg, #1C1C1E 0%, #2C0A18 40%, #5C0A28 70%, #1C1C1E 100%)'
              : stageState?.mode === 'community'
              ? 'linear-gradient(135deg, #1C1C1E 0%, #0A2E1A 40%, #0D3D24 70%, #1C1C1E 100%)'
              : 'linear-gradient(135deg, #1C1C1E 0%, #0D2030 40%, #0D2A30 70%, #1C1C1E 100%)',
            backgroundSize: '300% 300%',
            animation: 'stageGradient 8s ease infinite',
          }}
        >
          {/* Animated scanlines overlay */}
          <div className="absolute inset-0 opacity-10" style={{
            backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,0.03) 2px, rgba(255,255,255,0.03) 4px)',
          }} />

          {/* Grid dots overlay */}
          <div className="absolute inset-0 opacity-5" style={{
            backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.3) 1px, transparent 1px)',
            backgroundSize: '20px 20px',
          }} />

          {/* Stage mode badge top-left */}
          {stageState && (
            <div className="absolute top-3 left-3 z-10">
              {stageState.mode === 'dj-live' ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-500/30 backdrop-blur-sm border border-red-500/50 text-red-300 text-xs font-bold uppercase tracking-wider">
                  <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                  DJ LIVE {stageState.master ? `— ${stageState.master.displayName}` : ''}
                </span>
              ) : stageState.mode === 'community' ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-green-500/30 backdrop-blur-sm border border-green-500/50 text-green-300 text-xs font-bold uppercase tracking-wider">
                  <span className="w-2 h-2 bg-green-400 rounded-full" />
                  Community Hangout
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 backdrop-blur-sm border border-white/20 text-white/80 text-xs font-bold uppercase tracking-wider">
                  <span className="w-2 h-2 bg-pnp-accent rounded-full" />
                  Ambient Vibes
                </span>
              )}
            </div>
          )}

          {/* LIVE indicator top-right when people are inside */}
          {occupancy > 0 && (
            <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/40 backdrop-blur-sm border border-white/10">
              <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
              <span className="text-white text-xs font-semibold">{occupancy} LIVE</span>
            </div>
          )}

          {/* Center content */}
          <div className="relative z-10 flex flex-col items-center gap-4 px-4">
            {/* Overlapping avatar stack when people are in the room */}
            {occupancyUsers.length > 0 ? (
              <>
                <div className="flex items-center -space-x-3">
                  {occupancyUsers.slice(0, 6).map((u, i) => (
                    <div
                      key={u.userId}
                      className="relative w-12 h-12 rounded-full border-2 border-black/60 overflow-hidden shadow-lg"
                      style={{ zIndex: 6 - i }}
                    >
                      {u.avatarUrl ? (
                        <img
                          src={u.avatarUrl}
                          alt={u.displayName}
                          className="w-full h-full object-cover"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden'); }}
                        />
                      ) : null}
                      <div className={`${u.avatarUrl ? 'hidden' : ''} w-full h-full flex items-center justify-center bg-pnp-accent/40 text-white font-bold text-sm`}>
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
                <div className="flex flex-col items-center gap-1">
                  <p className="text-white/90 text-sm font-medium drop-shadow-lg">
                    {occupancyUsers.slice(0, 3).map(u => u.displayName).join(', ')}
                    {occupancyUsers.length > 3 ? ` and ${occupancyUsers.length - 3} more` : ''}
                  </p>
                  <p className="text-white/60 text-xs">are vibing right now</p>
                </div>
              </>
            ) : (
              <>
                <div className="w-20 h-20 rounded-full flex items-center justify-center bg-white/10 backdrop-blur-sm border border-white/20">
                  <svg className="w-10 h-10 text-white/70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </div>
                <p className="text-white/60 text-sm">The stage is empty — be the first to join!</p>
              </>
            )}
          </div>

          {/* Bottom gradient fade */}
          <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-[#1C1C1E] to-transparent" />
        </div>

        {/* Info below the preview */}
        <div className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-pnp-textPrimary">Main Stage</h1>
              <p className="text-pnp-textSecondary text-sm mt-0.5">24/7 Telegram community hangout</p>
            </div>
            {/* Tier badge */}
            <div className="shrink-0">
              {isAdmin ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-pnp-accent/15 text-pnp-accent text-xs font-semibold">
                  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" /></svg>
                  Moderator
                </span>
              ) : isPrime ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-yellow-500/15 text-yellow-400 text-xs font-semibold">
                  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" /></svg>
                  Prime
                </span>
              ) : isMember ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-blue-500/15 text-blue-400 text-xs font-semibold">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
                  Member
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-white/5 text-pnp-textSecondary text-xs font-semibold">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                  View Only
                </span>
              )}
            </div>
          </div>

          {/* What you get */}
          <div className="flex flex-wrap gap-2">
            {(isAdmin || isPrime) && (
              <>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white/5 text-pnp-textSecondary text-xs">
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                  Camera
                </span>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white/5 text-pnp-textSecondary text-xs">
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
                  Mic
                </span>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white/5 text-pnp-textSecondary text-xs">
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                  Screenshare
                </span>
              </>
            )}
            {isMember && !isPrime && !isAdmin && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 text-xs">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
                Knock to speak
              </span>
            )}
            {isFree && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white/5 text-pnp-textSecondary text-xs">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                Watch &amp; listen
              </span>
            )}
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white/5 text-pnp-textSecondary text-xs">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
              Encrypted
            </span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white/5 text-pnp-textSecondary text-xs">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              24/7
            </span>
          </div>

          {error && (
            <p className="text-red-400 text-sm bg-red-950/30 border border-red-900/50 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          {mainGroup?.hasActiveCall && !showTelegramDock && (
            <div className="rounded-2xl border px-4 py-3 text-sm text-white/75" style={{ borderColor: "rgba(100,210,255,0.28)", background: "rgba(100,210,255,0.06)" }}>
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                <span className="font-semibold text-white">Live call in progress</span>
              </div>
              <p className="mt-1 text-xs text-white/55">
                {callStartedBy ? `${callStartedBy} started the call. ` : ""}
                Tap the button below to join.
              </p>
            </div>
          )}

          {callError && (
            <p className="text-red-400 text-sm bg-red-950/30 border border-red-900/50 rounded-lg px-3 py-2">
              {callError}
            </p>
          )}

          {isAuthenticated ? (
            <Button
              onClick={handleJoinClick}
              disabled={loading}
              className="w-full"
            >
              {loading
                ? "Connecting…"
                : showTelegramDock
                ? "Reopen Call Panel"
                : mainGroup?.hasActiveCall
                ? "Join Live Call"
                : "Start Group Call"}
            </Button>
          ) : (
            <p className="text-pnp-textSecondary text-sm text-center py-2">
              Please log in to join the room.
            </p>
          )}
        </div>
      </Card>

      <TelegramCallDock
        open={showTelegramDock}
        onClose={handleLeave}
        token={callToken}
        livekitUrl={callLivekitUrl || "wss://livekit.pnptv.app"}
        roomName={callRoomName}
        startedBy={callStartedBy}
        participantCount={callParticipantCount}
        durationLabel={callDuration}
        onCallEnded={() => { setShowTelegramDock(false); setCallToken(null); setCallRoomName(null); }}
      />

      {/* Admin Stage Control */}
      {isAdmin && (
        <Card className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-pnp-textPrimary">Stage Control</h3>
            <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wide" style={{ background: 'rgba(212,0,122,0.12)', color: '#D4007A' }}>Admin</span>
          </div>
          <p className="text-xs text-pnp-textSecondary">Set the mood for all viewers watching right now.</p>
          <div className="grid grid-cols-3 gap-2">
            {([
              { mode: 'ambient' as const, label: 'Ambient', icon: '🌊', desc: 'Chill vibes' },
              { mode: 'community' as const, label: 'Community', icon: '🌈', desc: 'Open hangout' },
              { mode: 'dj-live' as const, label: 'DJ Live', icon: '🎧', desc: 'Live DJ set' },
            ]).map(({ mode, label, icon, desc }) => {
              const isActive = stageState?.mode === mode;
              return (
                <button
                  key={mode}
                  disabled={stageModeLoading || isActive}
                  onClick={async () => {
                    setStageModeLoading(true);
                    try {
                      await apiSetStageMode(mode);
                      setStageState((s) => s ? { ...s, mode } : { mode, master: null });
                    } catch { /* silent */ } finally { setStageModeLoading(false); }
                  }}
                  className={`flex flex-col items-center gap-1 p-3 rounded-xl border transition-all active:scale-95 disabled:opacity-60 disabled:cursor-default ${
                    isActive
                      ? 'border-pnp-accent/50 bg-pnp-accent/10'
                      : 'border-white/10 bg-white/5 hover:bg-white/10'
                  }`}
                >
                  <span className="text-xl">{icon}</span>
                  <span className={`text-[11px] font-semibold leading-tight ${isActive ? 'text-pnp-accent' : 'text-pnp-textPrimary'}`}>{label}</span>
                  <span className="text-[10px] text-pnp-textSecondary leading-tight">{desc}</span>
                </button>
              );
            })}
          </div>
        </Card>
      )}

      {/* Who's in the room — detailed list */}
      {!occupancyError && occupancyUsers.length > 0 && (
        <Card className="p-4 space-y-3">
          <h2 className="text-sm font-semibold text-pnp-textSecondary uppercase tracking-wide">
            Currently Inside
          </h2>
          <div className="space-y-2">
            {occupancyUsers.map((u) => (
              <div
                key={u.userId}
                className="flex items-center gap-3 p-2 rounded-lg hover:bg-white/5 transition-colors"
              >
                <div className="relative w-9 h-9 rounded-full overflow-hidden shrink-0 border border-white/10">
                  {u.avatarUrl ? (
                    <img
                      src={u.avatarUrl}
                      alt={u.displayName}
                      className="w-full h-full object-cover"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden'); }}
                    />
                  ) : null}
                  <div className={`${u.avatarUrl ? 'hidden' : ''} w-full h-full flex items-center justify-center bg-pnp-accent/30 text-white font-bold text-xs`}>
                    {u.displayName.charAt(0).toUpperCase()}
                  </div>
                  <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-green-500 rounded-full border-2 border-pnp-surface" />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-pnp-textPrimary text-sm font-medium truncate block">
                    {u.displayName}
                  </span>
                </div>
                {u.role === "moderator" && (
                  <span className="text-xs text-pnp-accent bg-pnp-accent/10 px-2 py-0.5 rounded-full">mod</span>
                )}
                {u.tier === 'prime' && u.role !== 'moderator' && (
                  <span className="text-xs text-yellow-400 bg-yellow-400/10 px-2 py-0.5 rounded-full">prime</span>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Upcoming Hangout Events */}
      <UpcomingEvents type="hangout_event" limit={3} title="Upcoming Hangout Events" />

      {/* Stage Rules */}
      <Card className="p-6 space-y-3">
        <h3 className="font-semibold text-pnp-textPrimary">Stage Rules</h3>
        <ul className="text-pnp-textSecondary text-sm space-y-2.5">
          <li className="flex items-start gap-2.5">
            <span className="mt-0.5 shrink-0">🔒</span>
            <span>
              End-to-end encrypted — your privacy is protected at all times
            </span>
          </li>
          <li className="flex items-start gap-2.5">
            <span className="mt-0.5 shrink-0">🚫</span>
            <span>
              No recording — what happens on the Stage stays on the Stage
            </span>
          </li>
          <li className="flex items-start gap-2.5">
            <span className="mt-0.5 shrink-0">💬</span>
            <span>
              Be respectful — hate speech and harassment will get you removed
              immediately
            </span>
          </li>
          <li className="flex items-start gap-2.5">
            <span className="mt-0.5 shrink-0">🌈</span>
            <span>
              All are welcome — this is a safe space for the PNP community
            </span>
          </li>
          <li className="flex items-start gap-2.5">
            <span className="mt-0.5 shrink-0">🕐</span>
            <span>Open 24/7 — the door is always unlocked</span>
          </li>
        </ul>
      </Card>
    </div>
  );
}
