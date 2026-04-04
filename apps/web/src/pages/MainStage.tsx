import React, { useState, useEffect, useCallback } from "react";
import { Helmet } from "react-helmet-async";
import { Card, Button } from "@pnptv/ui-kit";
import { useAuth } from "@/hooks/useAuth";
import { useTier } from "@/hooks/useTier";
import { PermissionGate } from "@/components/PermissionGate";
import { getSocket } from "@/lib/socket";

import {
  joinCommunityRoom,
  getCommunityRoomOccupancy,
  getStageState,
  setStageMode as apiSetStageMode,
  knockToSpeak,
  approveKnock,
  denyKnock,
  clipMoment,
  getVideoChatStatus,
  getHangoutGroups,
  type CommunityRoomInfo,
  type StagePermissions,
  type StageState,
  type HangoutGroup,
} from "@/lib/api";
import { UpcomingEvents } from "@/components/events";

function getTelegramDeepLink(inviteLink: string): string {
  const match = inviteLink.match(/t\.me\/\+(.+)/);
  return match ? `tg://join?invite=${match[1]}` : inviteLink;
}

export default function MainStage() {
  const { user, isAuthenticated } = useAuth();
  const { isPrime, isMember, isFree, isAdmin } = useTier();
  const [occupancy, setOccupancy] = useState<number>(0);
  const [occupancyUsers, setOccupancyUsers] = useState<
    Array<{ userId: string; displayName: string; role: string; tier?: string; avatarUrl?: string; joinedAt: string }>
  >([]);
  const [loading, setLoading] = useState(false);
  const [joined, setJoined] = useState(false);
  const [iframeSrc, setIframeSrc] = useState("");
  const [roomInfo, setRoomInfo] = useState<CommunityRoomInfo | null>(null);
  const [error, setError] = useState("");
  const [occupancyError, setOccupancyError] = useState(false);
  const [showPermGate, setShowPermGate] = useState(false);
  const [permissions, setPermissions] = useState<StagePermissions | null>(null);
  const [stageState, setStageState] = useState<StageState | null>(null);
  const [knockStatus, setKnockStatus] = useState<'idle' | 'pending' | 'approved' | 'denied'>('idle');
  const [showClipModal, setShowClipModal] = useState(false);
  const [clipCaption, setClipCaption] = useState('');
  const [clipLoading, setClipLoading] = useState(false);
  const [knockQueue, setKnockQueue] = useState<Array<{ userId: string; displayName: string }>>([]);
  const [mainGroup, setMainGroup] = useState<HangoutGroup | null>(null);
  const [telegramCallActive, setTelegramCallActive] = useState(false);

  useEffect(() => {
    getCommunityRoomOccupancy()
      .then((res) => {
        setOccupancy(res.occupancy?.activeUsers ?? 0);
        setOccupancyUsers(res.occupancy?.users ?? []);
      })
      .catch(() => {
        setOccupancyError(true);
      });

    getStageState()
      .then((res) => { if (res.stageState) setStageState(res.stageState); })
      .catch(() => {});

    // Fetch main hangout group (for Telegram call link)
    getHangoutGroups()
      .then((res) => {
        const main = (res.groups || []).find((g: HangoutGroup) => g.isMain);
        if (main) setMainGroup(main);
      })
      .catch(() => {});
  }, []);

  // Poll Telegram video chat status for main group
  useEffect(() => {
    if (!mainGroup?.telegramChatId) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await getVideoChatStatus(mainGroup.id);
        if (!cancelled) setTelegramCallActive(res.active);
      } catch { /* silent */ }
    };
    poll();
    const interval = setInterval(poll, telegramCallActive ? 15000 : 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [mainGroup?.id, mainGroup?.telegramChatId, telegramCallActive]);

  const handleJoinClick = () => {
    if (!user) return;
    setShowPermGate(true);
  };

  const handlePermGranted = useCallback(async () => {
    setShowPermGate(false);
    if (!user) return;
    setLoading(true);
    setError("");
    try {
      // Open Telegram group for video calls
      const tgLink = mainGroup?.telegramInviteLink;
      if (!tgLink) {
        setError("No Telegram group linked to Main Stage. Contact admin.");
        return;
      }
      // Open Telegram deep link
      window.open(getTelegramDeepLink(tgLink), "_blank");

      // Also join socket room for stage events
      const socket = getSocket();
      if (socket) {
        socket.emit('mainstage:join');
        socket.on('mainstage:mode-changed', (data: { mode: string; master: any }) => {
          setStageState({ mode: data.mode as StageState['mode'], master: data.master });
        });
      }

      setJoined(true);
      setIframeSrc("telegram"); // flag that we're in Telegram mode
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to join room");
    } finally {
      setLoading(false);
    }
  }, [user, mainGroup]);

  const handleLeave = () => {
    // Clean up socket listeners
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

    setJoined(false);
    setIframeSrc("");
    setRoomInfo(null);
    setPermissions(null);
    setKnockStatus('idle');
    setKnockQueue([]);
    setShowClipModal(false);
    setClipCaption('');
    getCommunityRoomOccupancy()
      .then((res) => {
        setOccupancy(res.occupancy?.activeUsers ?? 0);
        setOccupancyUsers(res.occupancy?.users ?? []);
      })
      .catch(() => {});
  };

  // ─── Joined: fullscreen with side panel + mod bot ──────────────────────

  if (joined && iframeSrc) {
    return (
      <div className="fixed inset-0 z-[34] bg-black flex">
        <Helmet>
          <title>Main Stage | PNPtv</title>
        </Helmet>

        {/* Center: Telegram video call view */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Header bar */}
          <div className="flex items-center justify-between px-4 py-2 bg-[#1C1C1E] border-b border-white/5 flex-shrink-0 gap-2">
            <div className="flex items-center gap-3">
              <svg className="w-5 h-5 text-pnp-accent shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              <div>
                <h2 className="text-pnp-textPrimary font-bold text-base leading-tight">Main Stage</h2>
                <p className="text-pnp-textSecondary text-xs">Video calls via Telegram</p>
              </div>
              {telegramCallActive && (
                <div className="flex items-center gap-2 px-3 py-1 bg-green-500/20 border border-green-500/40 rounded-full">
                  <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                  <span className="text-green-400 text-xs font-medium">LIVE</span>
                </div>
              )}
            </div>
            <Button variant="secondary" size="sm" onClick={handleLeave}>
              Back
            </Button>
          </div>

          {/* Telegram call area */}
          <div className="flex-1 w-full relative flex flex-col items-center justify-center gap-4 p-8 bg-pnp-background">
            <div className="flex flex-col items-center gap-4 max-w-sm text-center">
              <div className="w-20 h-20 rounded-full flex items-center justify-center" style={{ background: "rgba(41,168,226,0.15)" }}>
                <svg className="w-10 h-10" viewBox="0 0 24 24" fill="#29A8E2">
                  <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221l-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12l-6.871 4.326-2.962-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.833.941z"/>
                </svg>
              </div>

              {telegramCallActive ? (
                <>
                  <h3 className="text-pnp-textPrimary font-bold text-lg">Call is Live!</h3>
                  <p className="text-pnp-textSecondary text-sm">
                    A video call is happening right now in the PNPtv Telegram group. Tap below to join.
                  </p>
                </>
              ) : (
                <>
                  <h3 className="text-pnp-textPrimary font-bold text-lg">Main Stage on Telegram</h3>
                  <p className="text-pnp-textSecondary text-sm">
                    Open the PNPtv Telegram group and tap the video icon to start or join a call.
                  </p>
                </>
              )}

              {mainGroup?.telegramInviteLink && (
                <a
                  href={getTelegramDeepLink(mainGroup.telegramInviteLink)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-white text-sm transition-all active:scale-95"
                  style={{ background: telegramCallActive ? "#34C759" : "linear-gradient(135deg, #29A8E2, #0088CC)" }}
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221l-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12l-6.871 4.326-2.962-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.833.941z"/>
                  </svg>
                  {telegramCallActive ? "Join Live Call" : "Open in Telegram"}
                </a>
              )}
            </div>

            {/* Knock-to-speak overlay buttons */}
            {knockStatus === 'idle' && isMember && !isPrime && !isAdmin && (
              <button
                onClick={async () => {
                  setKnockStatus('pending');
                  try { await knockToSpeak(); } catch { setKnockStatus('idle'); }
                }}
                className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 px-4 py-2 text-white rounded-full shadow-lg transition-opacity hover:opacity-90"
                style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
              >
                <span>Request to Speak</span>
              </button>
            )}
            {knockStatus === 'pending' && (
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 px-4 py-2 bg-[#2C2C2E] border border-white/10 text-white rounded-full shadow-lg">
                <span className="w-2 h-2 bg-[#FFD60A] rounded-full animate-pulse" />
                <span>Waiting for approval...</span>
              </div>
            )}
            {knockStatus === 'approved' && (
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 px-4 py-2 bg-[#30D158]/20 border border-[#30D158]/50 text-[#30D158] rounded-full shadow-lg">
                <span className="w-2 h-2 bg-[#30D158] rounded-full animate-pulse" />
                <span>You're live! Speak now</span>
              </div>
            )}
            {knockStatus === 'denied' && (
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 px-4 py-2 bg-[#FF453A]/20 border border-[#FF453A]/50 text-[#FF453A] rounded-full shadow-lg">
                <span>Request denied</span>
              </div>
            )}
          </div>
        </div>

        {/* Clip modal */}
        {showClipModal && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
            onClick={() => setShowClipModal(false)}
          >
            <div
              className="bg-[#2C2C2E] border border-white/10 rounded-xl p-6 w-full max-w-sm mx-4 space-y-4"
              onClick={e => e.stopPropagation()}
            >
              <h3 className="text-lg font-bold text-pnp-textPrimary">Clip This Moment</h3>
              <p className="text-pnp-textSecondary text-sm">Post a live announcement to the social feed</p>
              <input
                type="text"
                value={clipCaption}
                onChange={(e) => setClipCaption(e.target.value)}
                placeholder="What's happening?"
                maxLength={280}
                className="w-full px-3 py-2 bg-[#1C1C1E] border border-white/10 rounded-lg text-white placeholder-[#8E8E93] text-sm focus:outline-none focus:border-[#5ED1C4]"
              />
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setShowClipModal(false)}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  disabled={!clipCaption.trim() || clipLoading}
                  onClick={async () => {
                    setClipLoading(true);
                    try {
                      await clipMoment(clipCaption.trim());
                      setShowClipModal(false);
                      setClipCaption('');
                    } catch {}
                    setClipLoading(false);
                  }}
                  className="flex-1"
                >
                  {clipLoading ? 'Posting...' : 'Drop It'}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

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
              <p className="text-pnp-textSecondary text-sm mt-0.5">24/7 open community video room</p>
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

          {/* Active Telegram call banner */}
          {telegramCallActive && mainGroup?.telegramInviteLink && (
            <div
              className="flex items-center gap-3 px-4 py-2.5 rounded-xl"
              style={{ background: "rgba(52,199,89,0.12)", border: "1px solid rgba(52,199,89,0.2)" }}
            >
              <span className="relative flex h-2.5 w-2.5 flex-shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-400" />
              </span>
              <p className="flex-1 text-xs font-medium" style={{ color: "#34C759" }}>
                Video call is live in Telegram
              </p>
              <a
                href={getTelegramDeepLink(mainGroup.telegramInviteLink)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-bold px-3 py-1 rounded-lg transition-all hover:opacity-90 active:scale-95 flex-shrink-0"
                style={{ background: "#34C759", color: "#fff" }}
              >
                Join
              </a>
            </div>
          )}

          {isAuthenticated ? (
            <Button
              onClick={handleJoinClick}
              disabled={loading}
              className="w-full"
            >
              {loading ? "Opening Telegram..." : telegramCallActive ? "Join Live Call on Telegram" : occupancy > 0 ? `Join ${occupancy} on Main Stage` : "Open Main Stage on Telegram"}
            </Button>
          ) : (
            <p className="text-pnp-textSecondary text-sm text-center py-2">
              Please log in to join the room.
            </p>
          )}
        </div>
      </Card>

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

      {/* Permission gate modal */}
      {showPermGate && (
        <PermissionGate
          onGranted={handlePermGranted}
          onCancel={() => setShowPermGate(false)}
        />
      )}
    </div>
  );
}
