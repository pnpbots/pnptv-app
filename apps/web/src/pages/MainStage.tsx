import React, { useState, useEffect, useCallback, useRef } from "react";
import { Helmet } from "react-helmet-async";
import { Card, Button } from "@pnptv/ui-kit";
import { useAuth } from "@/hooks/useAuth";
import { useTier } from "@/hooks/useTier";
import { PermissionGate } from "@/components/PermissionGate";
import { getSocket } from "@/lib/socket";
import { useHangoutSocket } from "@/hooks/useHangoutSocket";
import type { WebRtcPeer } from "@/hooks/useHangoutSocket";

import {
  joinCommunityRoom,
  getCommunityRoomOccupancy,
  getStageState,
  setStageMode as apiSetStageMode,
  knockToSpeak,
  approveKnock,
  denyKnock,
  clipMoment,
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

// ─── Remote peer video tile ──────────────────────────────────────────────────
function RemotePeerTile({ peer }: { peer: WebRtcPeer }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (videoRef.current && peer.stream) videoRef.current.srcObject = peer.stream;
  }, [peer.stream]);
  return (
    <div className="relative rounded-xl overflow-hidden bg-black/40 flex items-center justify-center">
      {peer.stream
        ? <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
        : <div className="w-16 h-16 rounded-full flex items-center justify-center text-2xl font-bold text-white" style={{ background: 'rgba(212,0,122,0.3)' }}>{(peer.displayName || '?')[0].toUpperCase()}</div>}
      <span className="absolute bottom-2 left-2 text-[11px] text-white/80 bg-black/40 px-2 py-0.5 rounded-full">{peer.displayName}</span>
    </div>
  );
}

export default function MainStage() {
  const { user, isAuthenticated } = useAuth();
  const { isPrime, isMember, isFree, isAdmin } = useTier();
  const [occupancy, setOccupancy] = useState<number>(0);
  const [occupancyUsers, setOccupancyUsers] = useState<
    Array<{ userId: string; displayName: string; role: string; tier?: string; avatarUrl?: string; joinedAt: string }>
  >([]);
  const [loading, setLoading] = useState(false);
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
  const [stageModeLoading, setStageModeLoading] = useState(false);
  const [knockQueue, setKnockQueue] = useState<Array<{ userId: string; displayName: string }>>([]);
  const [mainGroup, setMainGroup] = useState<HangoutGroup | null>(null);

  // WebRTC call state (tgcalls-compatible browser WebRTC)
  const [micEnabled, setMicEnabled] = useState(true);
  const [camEnabled, setCamEnabled] = useState(true);
  const localVideoRef = useRef<HTMLVideoElement>(null);

  const {
    inWebRtcCall,
    webRtcPeers,
    localStream,
    startWebRtcCall,
    leaveWebRtcCall,
    toggleMic,
    toggleCam,
  } = useHangoutSocket(mainGroup?.id ?? null, user?.dbId);

  useEffect(() => {
    if (localVideoRef.current && localStream) localVideoRef.current.srcObject = localStream;
  }, [localStream]);

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

    // Fetch main hangout group (for Telegram call link)
    getHangoutGroups()
      .then((res) => {
        const main = (res.groups || []).find((g: HangoutGroup) => g.isMain);
        if (main) setMainGroup(main);
      })
      .catch(() => {});

    return () => clearInterval(occupancyInterval);
  }, []);


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
      if (!mainGroup?.id) {
        setError("Main Stage group not found. Contact admin.");
        return;
      }
      // Join Socket.IO stage room for mode/knock events
      const socket = getSocket();
      if (socket) {
        socket.emit('mainstage:join');
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
      }
      // Start WebRTC call via tgcalls-compatible browser WebRTC
      const displayName = user.firstName || user.username || 'User';
      await startWebRtcCall(displayName);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not access camera/microphone. Check permissions.");
    } finally {
      setLoading(false);
    }
  }, [user, mainGroup, startWebRtcCall]);

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
    leaveWebRtcCall();
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

  // ─── In-call: fullscreen WebRTC video grid ──────────────────────────────────

  if (inWebRtcCall) {
    return (
      <div className="fixed inset-0 z-[34] flex flex-col" style={{ background: '#1C1C1E' }}>
        <Helmet><title>Main Stage | PNPtv</title></Helmet>

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-white/5 flex-shrink-0 gap-2" style={{ background: '#1C1C1E' }}>
          <div className="flex items-center gap-3">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-400" />
            </span>
            <span className="text-white font-bold text-sm">Main Stage</span>
            <span className="text-white/40 text-xs">{webRtcPeers.length + 1} in call</span>
          </div>
          {stageState?.mode && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-white/10 text-white/60 uppercase tracking-wide">{stageState.mode}</span>
          )}
        </div>

        {/* Video grid — spotlight for 1:1, grid otherwise */}
        {webRtcPeers.length === 1 ? (
          /* Spotlight mode: remote peer fills view, local is PiP corner */
          <div className="flex-1 min-h-0 relative p-2">
            <div className="w-full h-full rounded-xl overflow-hidden">
              <RemotePeerTile peer={webRtcPeers[0]} />
            </div>
            <div className="absolute bottom-4 right-4 w-24 h-32 rounded-xl overflow-hidden bg-black/40 shadow-xl ring-2 ring-black/50 z-10">
              <video ref={localVideoRef} autoPlay muted playsInline className="w-full h-full object-cover" />
              {!camEnabled && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/70">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-white" style={{ background: 'rgba(212,0,122,0.3)' }}>
                    {(user?.firstName || 'Y')[0].toUpperCase()}
                  </div>
                </div>
              )}
              <span className="absolute bottom-1 left-1.5 text-[9px] text-white/70 bg-black/50 px-1.5 py-0.5 rounded-full">You</span>
            </div>
          </div>
        ) : (
          <div className="flex-1 min-h-0 grid gap-1 p-2" style={{
            gridTemplateColumns: webRtcPeers.length === 0 ? '1fr' : 'repeat(2, 1fr)',
          }}>
            {/* Local tile */}
            <div className="relative rounded-xl overflow-hidden bg-black/40 flex items-center justify-center">
              <video ref={localVideoRef} autoPlay muted playsInline className="w-full h-full object-cover" />
              {!camEnabled && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/70">
                  <div className="w-16 h-16 rounded-full flex items-center justify-center text-2xl font-bold text-white" style={{ background: 'rgba(212,0,122,0.3)' }}>
                    {(user?.firstName || 'Y')[0].toUpperCase()}
                  </div>
                </div>
              )}
              <span className="absolute bottom-2 left-2 text-[11px] text-white/80 bg-black/40 px-2 py-0.5 rounded-full">You</span>
            </div>

            {/* Remote peers */}
            {webRtcPeers.map(peer => <RemotePeerTile key={peer.peerId} peer={peer} />)}

            {/* Waiting state */}
            {webRtcPeers.length === 0 && (
              <div className="flex flex-col items-center justify-center text-white/50 gap-3">
                <div className="w-10 h-10 border-2 border-white/20 border-t-pnp-accent rounded-full animate-spin" />
                <p className="text-sm">Waiting for others to join…</p>
                <p className="text-xs text-white/30">Share the stage link for others to join</p>
              </div>
            )}
          </div>
        )}

        {/* Knock/status banners */}
        {knockStatus === 'pending' && (
          <div className="mx-4 mb-2 flex items-center gap-2 px-4 py-2 bg-[#2C2C2E] border border-white/10 text-white rounded-full">
            <span className="w-2 h-2 bg-[#FFD60A] rounded-full animate-pulse" />
            <span className="text-sm">Waiting for approval...</span>
          </div>
        )}
        {knockStatus === 'approved' && (
          <div className="mx-4 mb-2 flex items-center gap-2 px-4 py-2 bg-[#30D158]/20 border border-[#30D158]/50 text-[#30D158] rounded-full">
            <span className="w-2 h-2 bg-[#30D158] rounded-full animate-pulse" />
            <span className="text-sm">You're live! Speak now</span>
          </div>
        )}

        {/* Admin: raise-hand queue in-call */}
        {(isAdmin || isPrime) && knockQueue.length > 0 && (
          <div className="mx-4 mb-2 flex flex-col gap-1.5 px-3 py-2.5 bg-[#2C2C2E] border border-white/10 rounded-xl">
            <p className="text-[10px] font-semibold text-white/50 uppercase tracking-wider">
              Raise Hand · {knockQueue.length} waiting
            </p>
            {knockQueue.map((k) => (
              <div key={k.userId} className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-pnp-accent flex-shrink-0" style={{ background: 'rgba(212,0,122,0.2)' }}>
                  {k.displayName[0].toUpperCase()}
                </div>
                <span className="flex-1 text-sm text-white truncate">{k.displayName}</span>
                <button
                  onClick={async () => { try { await approveKnock(k.userId); setKnockQueue((q) => q.filter((x) => x.userId !== k.userId)); } catch { /* silent */ } }}
                  className="px-2.5 py-1 rounded-lg text-[11px] font-semibold text-white active:scale-95 transition-all"
                  style={{ background: 'rgba(48,209,88,0.25)', color: '#30D158' }}
                >Let in</button>
                <button
                  onClick={async () => { try { await denyKnock(k.userId); setKnockQueue((q) => q.filter((x) => x.userId !== k.userId)); } catch { /* silent */ } }}
                  className="px-2.5 py-1 rounded-lg text-[11px] font-semibold active:scale-95 transition-all"
                  style={{ background: 'rgba(255,59,48,0.2)', color: '#FF3B30' }}
                >Deny</button>
              </div>
            ))}
          </div>
        )}

        {/* Controls */}
        <div className="flex items-center justify-center gap-4 py-4 flex-shrink-0">
          {/* Mic */}
          <button
            onClick={() => { const next = !micEnabled; setMicEnabled(next); toggleMic(next); }}
            className="w-14 h-14 rounded-full flex items-center justify-center transition-all active:scale-90"
            style={{ background: micEnabled ? 'rgba(255,255,255,0.15)' : 'rgba(255,59,48,0.8)' }}
          >
            {micEnabled
              ? <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" /></svg>
              : <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M17.25 9.75L19.5 12m0 0l2.25 2.25M19.5 12l2.25-2.25M19.5 12l-2.25 2.25m-10.5-6l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" /></svg>
            }
          </button>

          {/* Camera */}
          <button
            onClick={() => { const next = !camEnabled; setCamEnabled(next); toggleCam(next); }}
            className="w-14 h-14 rounded-full flex items-center justify-center transition-all active:scale-90"
            style={{ background: camEnabled ? 'rgba(255,255,255,0.15)' : 'rgba(255,59,48,0.8)' }}
          >
            {camEnabled
              ? <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
              : <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M12 18.75H4.5a2.25 2.25 0 01-2.25-2.25V9m12.841 9.091L16.5 19.5m-1.409-1.409c.407-.407.659-.97.659-1.591v-9a2.25 2.25 0 00-2.25-2.25h-9c-.621 0-1.184.252-1.591.659" /></svg>
            }
          </button>

          {/* Knock to speak (members only) */}
          {knockStatus === 'idle' && isMember && !isPrime && !isAdmin && (
            <button
              onClick={async () => { setKnockStatus('pending'); try { await knockToSpeak(); } catch { setKnockStatus('idle'); } }}
              className="h-14 px-5 rounded-full text-white text-sm font-semibold transition-all active:scale-90"
              style={{ background: 'linear-gradient(135deg, #D4007A, #E69138)' }}
            >
              Raise Hand
            </button>
          )}

          {/* End call */}
          <button
            onClick={handleLeave}
            className="w-16 h-16 rounded-full flex items-center justify-center transition-all active:scale-90"
            style={{ background: 'linear-gradient(135deg, #FF3B30, #FF2D55)' }}
          >
            <svg className="w-7 h-7 text-white" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/>
            </svg>
          </button>

          {/* Clip moment (admin/prime only) */}
          {(isAdmin || isPrime) && (
            <button
              onClick={() => setShowClipModal(true)}
              className="w-14 h-14 rounded-full flex items-center justify-center transition-all active:scale-90 bg-white/10 hover:bg-white/20"
              title="Clip this moment"
            >
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5V6a3.75 3.75 0 10-7.5 0v4.5m11.356-1.993l1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 01-1.12-1.243l1.264-12A1.125 1.125 0 015.513 7.5h12.974c.576 0 1.059.435 1.119 1.007z" />
              </svg>
            </button>
          )}
        </div>

        {/* Clip modal */}
        {showClipModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowClipModal(false)}>
            <div className="bg-[#2C2C2E] border border-white/10 rounded-xl p-6 w-full max-w-sm mx-4 space-y-4" onClick={e => e.stopPropagation()}>
              <h3 className="text-lg font-bold text-pnp-textPrimary">Clip This Moment</h3>
              <p className="text-pnp-textSecondary text-sm">Post a live announcement to the social feed</p>
              <input type="text" value={clipCaption} onChange={e => setClipCaption(e.target.value)} placeholder="What's happening?" maxLength={280} className="w-full px-3 py-2 bg-[#1C1C1E] border border-white/10 rounded-lg text-white placeholder-[#8E8E93] text-sm focus:outline-none focus:border-[#5ED1C4]" />
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" onClick={() => setShowClipModal(false)} className="flex-1">Cancel</Button>
                <Button size="sm" disabled={!clipCaption.trim() || clipLoading} onClick={async () => { setClipLoading(true); try { await clipMoment(clipCaption.trim()); setShowClipModal(false); setClipCaption(''); } catch {} setClipLoading(false); }} className="flex-1">{clipLoading ? 'Posting...' : 'Drop It'}</Button>
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

          {isAuthenticated ? (
            <Button
              onClick={handleJoinClick}
              disabled={loading}
              className="w-full"
            >
              {loading ? "Starting call…" : occupancy > 0 ? `Join ${occupancy} on Main Stage` : "Join Main Stage"}
            </Button>
          ) : (
            <p className="text-pnp-textSecondary text-sm text-center py-2">
              Please log in to join the room.
            </p>
          )}
        </div>
      </Card>

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
