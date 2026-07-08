import React, { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { Card, Skeleton } from "@pnptv/ui-kit";
import { useAuth } from "@/hooks/useAuth";
import { useTutorial } from "@/hooks/useTutorial";
import { TutorialOverlay } from "@/components/tutorial/TutorialOverlay";
import { useLiveSocket } from "@/hooks/useLiveSocket";
import { useI18n } from "@/lib/i18n";
import { LivePlayer } from "@/components/LivePlayer";
import { LiveRulesModal } from "@/components/LiveRulesModal";
import { BuyTokensModal } from "@/components/BuyTokensModal";
import { connectSocket } from "@/lib/socket";
import { QRCodeSVG } from "qrcode.react";
import { List, useDynamicRowHeight } from "react-window";
import {
  getLiveStreams,
  getAllPerformers,
  sendTip,
  TIP_AMOUNTS,
  getStreamOverlayPublic,
  getLiveRulesStatus,
  acknowledgeLiveRules,
  assertPaymentUrl,
  getDashPaymentDetails,
  type LiveStream,
  type LiveStreamWithHost,
  type RecentTip,
  type StreamOverlay,
  type TipGoal,
  type TipMenuItem,
  getRecentTips,
  getWalletBalance,
  getWebAppLiveStreams,
  initiateRaid,
  setHostedChannel,
  getHostedChannel,
  getSlotTicketStatus,
  buySlotTicket,
  isCreatorPayLocked,
  getLiveGoal,
  getTipMenu,
  getTipLeaderboard,
  getCreatorRecordings,
} from "@/lib/api";
import { StreamHealthPanel } from "@/components/stream/StreamHealthPanel";
import { type LivePlayerStats } from "@/components/LivePlayer";

function extractChannelRef(streamId: string): string | null {
  // streamId is now the channel ref directly (e.g. "pnptv-santino")
  // or could be a legacy full process ID (e.g. "restreamer-ui:ingest:pnptv-santino")
  const match = streamId.match(/restreamer-ui:ingest:([\w-]+)/);
  return match ? match[1] : streamId;
}

// ── Virtualized chat message list (react-window v2) ───────────────────────
type ChatMsg = { id: string | number; username: string; content: string; userId?: string };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ChatRow(props: any) {
  const { index, style, messages, isOwner, onBan } = props as {
    index: number;
    style: React.CSSProperties;
    messages: ChatMsg[];
    isOwner?: boolean;
    onBan?: (userId: string) => void;
  };
  const msg = messages[index];
  if (!msg) return null;
  return (
    <div style={style} className="py-0.5">
      <div className="text-xs flex items-center gap-1">
        <span className="font-medium text-gradient">@{msg.username}</span>
        <span className="text-pnp-textSecondary mx-0.5">·</span>
        <span className="text-pnp-textPrimary flex-1">{msg.content}</span>
        {isOwner && msg.userId && onBan && (
          <button
            onClick={() => onBan(msg.userId!)}
            className="flex-shrink-0 ml-1 text-[9px] text-pnp-textSecondary/40 hover:text-red-400 transition-colors"
            title="Ban from chat"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}

function ChatMessageList({
  messages,
  listRef,
  containerRef: _containerRef,
  isOwner,
  onBan,
}: {
  messages: ChatMsg[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  listRef: React.MutableRefObject<any>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  isOwner?: boolean;
  onBan?: (userId: string) => void;
}) {
  const rowHeight = useDynamicRowHeight({ defaultRowHeight: 24, key: messages.length });
  return (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    <List
      listRef={listRef}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rowComponent={ChatRow as any}
      rowCount={messages.length}
      rowHeight={rowHeight}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rowProps={{ messages, isOwner, onBan } as any}
      style={{ height: 192, width: "100%", marginBottom: "0.5rem" }}
      tagName="div"
    />
  );
}

// ── Free-user upgrade wall ────────────────────────────────────────────────────
function StreamMembersOnlyWall() {
  const navigate = useNavigate();
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-5 px-6 text-center">
      <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ background: "rgba(212,0,122,0.12)", border: "1px solid rgba(212,0,122,0.3)" }}>
        <svg className="w-8 h-8" style={{ color: "#D4007A" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
        </svg>
      </div>
      <div>
        <h2 className="text-xl font-bold text-pnp-textPrimary mb-2">Members Only</h2>
        <p className="text-sm text-pnp-textSecondary max-w-xs">Live streams require a PNPtv! membership.</p>
      </div>
      <button
        onClick={() => navigate('/subscribe')}
        className="px-6 py-3 rounded-xl text-sm font-bold text-white"
        style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
      >
        See plans →
      </button>
      <button onClick={() => navigate(-1)} className="text-xs text-pnp-textSecondary hover:text-pnp-textPrimary">
        ← Go back
      </button>
    </div>
  );
}

export default function Stream() {
  const { user, isLoading } = useAuth();
  if (isLoading) return null;
  if (!user || user.label === 'FREE' || (!user.label && user.tier === 'free')) {
    return <StreamMembersOnlyWall />;
  }
  return <StreamInner />;
}

function StreamInner() {
  const { streamId } = useParams<{ streamId: string }>();
  const navigate = useNavigate();
  const t = useI18n();
  const { isAuthenticated, login, user } = useAuth();
  const { showTutorial, dismissTutorial, dismissForever } = useTutorial("stream");

  const [stream, setStream] = useState<LiveStream | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<StreamOverlay | null>(null);

  // Live rules gate — only enforced for authenticated users
  const [rulesAcknowledged, setRulesAcknowledged] = useState(false);
  const [rulesLoading, setRulesLoading] = useState(true);
  const [creatorRules, setCreatorRules] = useState<string | null>(null);
  const [creatorRulesName, setCreatorRulesName] = useState<string | null>(null);

  // Chat & tips
  const [chatInput, setChatInput] = useState("");
  const [tipPaymentTab, setTipPaymentTab] = useState<"tokens" | "dash">("tokens");
  const [tipping, setTipping] = useState(false);
  // tippingRef gates re-entrant calls to handleTip — setTipping is async,
  // so a fast double-click could fire two tips before the first state update
  // disables the button. The ref is synchronous and bulletproof.
  const tippingRef = useRef(false);
  const [tipSubmitting, setTipSubmitting] = useState(false);
  const [tipError, setTipError] = useState<string | null>(null);
  const [tipSuccess, setTipSuccess] = useState<string | null>(null);
  const [recentTips, setRecentTips] = useState<RecentTip[]>([]);

  // Dash tip payment state
  const [dashTip, setDashTip] = useState<{
    invoiceId: string;
    checkoutUrl: string;
    destination?: string;
    amount?: string;
    invoiceAmount?: number;
    loading: boolean;
    createdAt: number;
  } | null>(null);
  const [dashTipCopied, setDashTipCopied] = useState(false);
  const [dashTipSecondsLeft, setDashTipSecondsLeft] = useState(900);
  const [dashTipSuccess, setDashTipSuccess] = useState(false);
  const dashTipPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const dashTipCountdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Tracked one-shot timers so unmount cancels any pending state updates and
  // we don't generate "setState on unmounted component" warnings when the user
  // navigates away during a tip success / share copied flash.
  const tipSuccessTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dashTipSettleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shareCopiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isTheaterMode, setIsTheaterMode] = useState(false);
  const [streamError, setStreamError] = useState(false);

  // Dash token wallet
  const [tokenBalance, setTokenBalance] = useState<number | null>(null);
  const [showTopUp, setShowTopUp] = useState(false);

  // ── Raid state ──────────────────────────────────────────────────────────────
  const [raidCountdown, setRaidCountdown] = useState<number | null>(null);
  const [showRaidPicker, setShowRaidPicker] = useState(false);
  const [raidTargetStreams, setRaidTargetStreams] = useState<LiveStreamWithHost[]>([]);
  const [raidPickerLoading, setRaidPickerLoading] = useState(false);
  const [raidError, setRaidError] = useState<string | null>(null);
  const raidCountdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Leaderboard overlay state ──────────────────────────────────────────────
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [leaderboardTab, setLeaderboardTab] = useState<"today" | "week">("today");
  const [leaderboardData, setLeaderboardData] = useState<{ today: { username: string; total: number; tipCount: number }[]; week: { username: string; total: number; tipCount: number }[] }>({ today: [], week: [] });

  // ── Tip goal state ─────────────────────────────────────────────────────────
  const [tipGoal, setTipGoal] = useState<TipGoal | null>(null);

  // ── Tip menu state ─────────────────────────────────────────────────────────
  const [tipMenu, setTipMenu] = useState<TipMenuItem[]>([]);

  // ── VOD replay state ───────────────────────────────────────────────────────
  const [replayUrl, setReplayUrl] = useState<string | null>(null);

  // ── Ticket / paywall state ─────────────────────────────────────────────────
  const [ticketStatus, setTicketStatus] = useState<{
    isTicketed: boolean;
    priceTokens: number | null;
    priceUsd: string | null;
    hasTicket: boolean;
  } | null>(null);
  const [ticketLoading, setTicketLoading] = useState(false);
  const [ticketBuying, setTicketBuying] = useState(false);
  const [ticketError, setTicketError] = useState<string | null>(null);
  // Dash ticket polling state — mirrors dashTip pattern
  const [dashTicketInvoiceId, setDashTicketInvoiceId] = useState<string | null>(null);
  const [dashTicketCheckoutUrl, setDashTicketCheckoutUrl] = useState<string | null>(null);
  const [dashTicketPollActive, setDashTicketPollActive] = useState(false);
  const dashTicketPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Stream health HUD state (creator-only, desktop) ────────────────────────
  const [streamStats, setStreamStats] = useState<LivePlayerStats | null>(null);
  const [statsHistory, setStatsHistory] = useState<LivePlayerStats[]>([]);
  const [hudExpanded, setHudExpanded] = useState(false);
  const [healthOffline, setHealthOffline] = useState(false);
  const healthPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Host mode state ────────────────────────────────────────────────────────
  const [hostedChannelRef, setHostedChannelRef] = useState<string | null>(null);
  const [hostedStream, setHostedStream] = useState<LiveStreamWithHost | null>(null);
  const [showHostPicker, setShowHostPicker] = useState(false);
  const [hostPickerLoading, setHostPickerLoading] = useState(false);
  const [hostError, setHostError] = useState<string | null>(null);
  const [hostTargetStreams, setHostTargetStreams] = useState<LiveStreamWithHost[]>([]);

  const {
    messages: chatMessages,
    viewerCount: socketViewerCount,
    isConnected: chatConnected,
    reconnecting: chatReconnecting,
    sendMessage,
    latestTip,
    walletBalance: socketBalance,
    socketBalanceReceived,
    socketError,
    raidEvent,
    dismissRaid,
    tipGoal: socketTipGoal,
    chatBanned,
    tipAlert,
  } = useLiveSocket(streamId || null);

  // chatSendingRef gates rapid Enter-Enter and click-click to keep both
  // handlers from emitting two messages before setChatInput("") propagates.
  // 250ms is enough to clear the input + render; faster than a typist's
  // double-tap.
  const chatSendingRef = useRef(false);
  const submitChat = useCallback(() => {
    const text = chatInput.trim();
    if (!text || chatSendingRef.current) return;
    chatSendingRef.current = true;
    sendMessage(text);
    setChatInput("");
    setTimeout(() => { chatSendingRef.current = false; }, 250);
  }, [chatInput, sendMessage]);

  const handleBanUser = useCallback((targetUserId: string) => {
    const socket = connectSocket();
    if (!socket.connected) return;
    socket.emit("live:mod_action", { targetUserId, action: "ban" });
  }, []);

  // Cleanup all timers/intervals on unmount. Dash tip polling + countdown
  // intervals plus the three one-shot setTimeouts (tip-success toast, dash-tip
  // success chain, share-copied flash). Also health poll.
  useEffect(() => {
    return () => {
      if (dashTipPollRef.current) clearInterval(dashTipPollRef.current);
      if (dashTipCountdownRef.current) clearInterval(dashTipCountdownRef.current);
      if (dashTicketPollRef.current) clearInterval(dashTicketPollRef.current);
      if (tipSuccessTimerRef.current) clearTimeout(tipSuccessTimerRef.current);
      if (dashTipSettleTimerRef.current) clearTimeout(dashTipSettleTimerRef.current);
      if (shareCopiedTimerRef.current) clearTimeout(shareCopiedTimerRef.current);
      if (healthPollRef.current) clearInterval(healthPollRef.current);
      if (raidCountdownRef.current) {
        clearInterval(raidCountdownRef.current);
        raidCountdownRef.current = null;
      }
    };
  }, []);

  // Safety timeout: if chatReconnecting stays true for 30s, reset it to avoid
  // the reconnecting indicator being stuck on screen after a reconnect failure.
  const chatReconnectingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (chatReconnecting) {
      chatReconnectingTimeoutRef.current = setTimeout(() => {
        // The hook will set this back to false on connect; this is just the safety net.
        // We can't call setChatReconnecting directly (it's hook-internal), but we
        // track via a local override flag rendered below.
        chatReconnectingTimeoutRef.current = null;
      }, 30000);
    } else {
      if (chatReconnectingTimeoutRef.current) {
        clearTimeout(chatReconnectingTimeoutRef.current);
        chatReconnectingTimeoutRef.current = null;
      }
    }
    return () => {
      if (chatReconnectingTimeoutRef.current) {
        clearTimeout(chatReconnectingTimeoutRef.current);
        chatReconnectingTimeoutRef.current = null;
      }
    };
  }, [chatReconnecting]);
  // Local override: suppress the reconnecting indicator after 30s of stuck state
  const [reconnectTimedOut, setReconnectTimedOut] = useState(false);
  useEffect(() => {
    if (!chatReconnecting) { setReconnectTimedOut(false); return; }
    const t = setTimeout(() => setReconnectTimedOut(true), 30000);
    return () => clearTimeout(t);
  }, [chatReconnecting]);

  // Load initial balance — but never overwrite a fresher socket-pushed value.
  // The socket can deliver a balance update before the HTTP response lands;
  // applying the older HTTP value would briefly flash stale tokens to the
  // user (e.g. fresh tip just deducted). Mirrors the Live.tsx pattern.
  useEffect(() => {
    if (!isAuthenticated) return;
    getWalletBalance().then((data) => {
      if (!socketBalanceReceived) {
        setTokenBalance(data.balance);
      }
    }).catch(() => {});
  }, [isAuthenticated, socketBalanceReceived]);

  // Sync socket-pushed balance — always wins over HTTP.
  useEffect(() => {
    if (socketBalance !== null) setTokenBalance(socketBalance);
  }, [socketBalance]);

  // Viewer count: prefer the real-time socket value; fall back to a polled
  // value from the streams API when the socket is not connected.
  const [polledViewerCount, setPolledViewerCount] = useState(0);
  const viewerCount = chatConnected ? socketViewerCount : polledViewerCount;

  // Share button state
  const [shareCopied, setShareCopied] = useState(false);

  // Ref for the polling interval so it can be cancelled on error.
  const streamPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Tracks whether the most recent loadStream call ended with an error.
  const loadErrorRef = useRef(false);

  // Load stream info from Restreamer HLS streams and performer lookup.
  const loadStream = useCallback(() => {
    if (!streamId) return Promise.resolve();
    loadErrorRef.current = false;
    const channelRef = extractChannelRef(streamId);

    return Promise.all([
      getLiveStreams().catch(() => ({ streams: [] })),
      getAllPerformers().catch(() => ({ performers: [] })),
    ])
      .then(([hlsData, perfData]) => {
        const hlsStreams = hlsData.streams || [];
        const performers = perfData.performers || [];

        // 1. Direct match in Restreamer HLS streams
        const hlsMatch = hlsStreams.find((s: any) => s.id === streamId || s.id === channelRef);
        if (hlsMatch && hlsMatch.isLive) {
          setStream(hlsMatch);
          setError(null);
          setStreamError(false);
          return;
        }

        // 2. Match by performer (isLive + hlsUrl from backend)
        const performer = performers.find(
          (p: any) =>
            p.id === streamId ||
            (p.userId && String(p.userId) === streamId) ||
            (p.slug && p.slug === streamId)
        );
        if (performer && performer.isLive && performer.hlsUrl) {
          setStream({
            id: performer.id,
            name: performer.displayName,
            description: performer.bio || "",
            hlsUrl: performer.hlsUrl,
            isLive: true,
            thumbnailUrl: performer.photoUrl || null,
            username: performer.slug || null,
          });
          setError(null);
          setStreamError(false);
          return;
        }

        // 3. Fuzzy match in HLS streams — check suffix after a delimiter so that
        // a short streamId like "1" can't accidentally match "pnptv-10" or "pnptv-21".
        const matchesSuffix = (haystack: string, needle: string) =>
          haystack === needle ||
          haystack.endsWith(`:${needle}`) ||
          haystack.endsWith(`/${needle}`);
        const fuzzyMatch = hlsStreams.find(
          (s: any) => matchesSuffix(s.id, streamId) || (channelRef && matchesSuffix(s.id, channelRef))
        );
        if (fuzzyMatch) {
          setStream(fuzzyMatch);
          setError(null);
          setStreamError(false);
          return;
        }

        // 4. Check performer info to build an "offline" placeholder — the channel exists
        // but nobody is streaming right now. This prevents "stream not found" when a valid
        // creator navigates to their own stream URL before going live.
        const offlinePerformer = performer || performers.find(
          (p: any) =>
            (p.live_channel && p.live_channel === channelRef) ||
            (p.live_channel && p.live_channel === streamId)
        );
        if (offlinePerformer) {
          setStream({
            id: channelRef || streamId,
            name: offlinePerformer.displayName || offlinePerformer.name || channelRef || streamId,
            description: offlinePerformer.bio || "",
            hlsUrl: "",
            isLive: false,
            thumbnailUrl: offlinePerformer.photoUrl || null,
          });
          setError(null);
          setStreamError(false);
          return;
        }

        if (streamPollRef.current) {
          clearInterval(streamPollRef.current);
          streamPollRef.current = null;
        }
        loadErrorRef.current = true;
        setError(t.live.streamNotFound);
        setStreamError(true);
      })
      .catch((err) => {
        if (streamPollRef.current) {
          clearInterval(streamPollRef.current);
          streamPollRef.current = null;
        }
        loadErrorRef.current = true;
        setError(err instanceof Error ? err.message : "Failed to load stream");
        setStreamError(true);
      });
  }, [streamId]);

  useEffect(() => {
    setLoading(true);
    loadStream().finally(() => {
      setLoading(false);
      // Only start polling if we didn't hit an error
      if (!loadErrorRef.current && !streamPollRef.current) {
        streamPollRef.current = setInterval(loadStream, 30000);
      }
    });
    return () => {
      if (streamPollRef.current) {
        clearInterval(streamPollRef.current);
        streamPollRef.current = null;
      }
    };
  }, [loadStream]);

  // Fallback poll: refresh viewer count from the streams endpoint every 30s
  // when Socket.IO is disconnected so the displayed count does not freeze.
  useEffect(() => {
    if (chatConnected || !streamId) return;
    const poll = () => {
      getLiveStreams()
        .then((data) => {
          const found = (data.streams || []).find((s) => s.id === streamId);
          if (found && typeof found.viewerCount === "number") {
            setPolledViewerCount(found.viewerCount);
          }
        })
        .catch(() => {});
    };
    poll();
    const id = setInterval(poll, 30000);
    return () => clearInterval(id);
  }, [chatConnected, streamId]);

  // Fetch overlay config for this channel and subscribe to real-time updates
  useEffect(() => {
    if (!streamId) return;
    const channelRef = extractChannelRef(streamId);
    if (!channelRef) return;

    // Initial fetch
    getStreamOverlayPublic(channelRef)
      .then((res) => {
        if (res.overlay?.is_active) setOverlay(res.overlay);
      })
      .catch(() => {
        // Overlay is optional — silently ignore fetch failures
      });

    // Real-time updates via socket
    const socket = connectSocket();
    const handler = (data: StreamOverlay) => {
      if (data.channel_ref === channelRef) {
        setOverlay(data.is_active ? data : null);
      }
    };
    // overlay:config is pushed by the server on live:join; overlay:updated on admin changes
    socket.on("overlay:config", handler);
    socket.on("overlay:updated", handler);
    return () => {
      socket.off("overlay:config", handler);
      socket.off("overlay:updated", handler);
    };
  }, [streamId]);

  // Real-time ticket confirmation — server emits live:ticket:purchased after webhook settles
  useEffect(() => {
    if (!streamId || !user?.id) return;
    const socket = connectSocket();
    const onTicketPurchased = (data: { slotId: string; userId: string }) => {
      if (String(data.userId) === String(user.id) && data.slotId === streamId) {
        setTicketStatus((prev) => prev ? { ...prev, hasTicket: true } : null);
        // Stop Dash polling if it was running
        if (dashTicketPollRef.current) {
          clearInterval(dashTicketPollRef.current);
          dashTicketPollRef.current = null;
        }
        setDashTicketPollActive(false);
        setDashTicketInvoiceId(null);
        setDashTicketCheckoutUrl(null);
      }
    };
    socket.on("live:ticket:purchased", onTicketPurchased);
    return () => {
      socket.off("live:ticket:purchased", onTicketPurchased);
    };
  }, [streamId, user?.id]);

  // Live rules acknowledgment check — only for authenticated users
  useEffect(() => {
    if (!isAuthenticated) {
      // Unauthenticated users can watch; they'll be prompted to log in when they try to interact
      setRulesLoading(false);
      setRulesAcknowledged(true);
      return;
    }
    const channelRef = streamId ? extractChannelRef(streamId) : null;
    setRulesLoading(true);
    getLiveRulesStatus(channelRef)
      .then((data) => {
        if (data.success) {
          setRulesAcknowledged(data.acknowledged);
          setCreatorRules(data.creatorRules ?? null);
          setCreatorRulesName(data.creatorName ?? null);
        } else {
          // Unexpected API error — fail closed, show the rules modal
          setRulesAcknowledged(false);
        }
      })
      .catch(() => {
        // Network failure — fail closed, show the rules modal
        setRulesAcknowledged(false);
      })
      .finally(() => {
        setRulesLoading(false);
      });
  }, [isAuthenticated, user?.id, streamId]);

  const handleAcknowledgeRules = useCallback(async () => {
    try {
      await acknowledgeLiveRules();
      setRulesAcknowledged(true);
    } catch {
      // Server call failed — do not mark acknowledged; user must retry
      console.warn("[LiveRules] Failed to persist acknowledgment — will retry on next load");
    }
  }, []);

  // ── Raid: drive countdown and auto-navigate when a raid event arrives ────────
  useEffect(() => {
    if (!raidEvent) {
      if (raidCountdownRef.current) {
        clearInterval(raidCountdownRef.current);
        raidCountdownRef.current = null;
      }
      setRaidCountdown(null);
      return;
    }
    setRaidCountdown(5);
    if (raidCountdownRef.current) clearInterval(raidCountdownRef.current);
    raidCountdownRef.current = setInterval(() => {
      setRaidCountdown((prev) => {
        if (prev === null || prev <= 1) {
          if (raidCountdownRef.current) {
            clearInterval(raidCountdownRef.current);
            raidCountdownRef.current = null;
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => {
      if (raidCountdownRef.current) {
        clearInterval(raidCountdownRef.current);
        raidCountdownRef.current = null;
      }
    };
  }, [raidEvent]);

  // Auto-navigate when countdown reaches 0
  useEffect(() => {
    if (raidCountdown !== 0 || !raidEvent) return;
    navigate(`/live/${encodeURIComponent(raidEvent.targetChannelRef)}`);
    dismissRaid();
  }, [raidCountdown, raidEvent, navigate, dismissRaid]);

  // Whether the current user owns this specific stream (not just any creator)
  const channelRef = streamId ? extractChannelRef(streamId) : null;
  const isStreamOwner = !!(user && (
    user.role === 'admin' ||
    user.role === 'superadmin' ||
    (user.liveChannel && channelRef && user.liveChannel === channelRef)
  ));

  // ── Ticket status fetch — runs after stream resolves, for authenticated users ──
  useEffect(() => {
    if (!isAuthenticated || !stream) return;
    // slotId: Stream.tsx uses the streamId param as the slot/channel reference.
    // live_streams rows use UUIDs as PK; skip fetch if streamId looks like a channel ref (no dashes pattern of UUID).
    // We attempt the fetch and silently ignore 404 (non-UUID streamIds will 404).
    const slotId = streamId;
    if (!slotId) return;
    setTicketLoading(true);
    setTicketError(null);
    getSlotTicketStatus(slotId)
      .then((data) => {
        if (data.success) setTicketStatus(data);
      })
      .catch(() => {
        // Non-ticketed or non-slot stream — silently ignore
      })
      .finally(() => setTicketLoading(false));
  }, [isAuthenticated, streamId, stream]);

  // ── Health HUD: poll streams every 15s to detect offline ──────────────────
  useEffect(() => {
    if (!isStreamOwner || !stream?.isLive) {
      if (healthPollRef.current) { clearInterval(healthPollRef.current); healthPollRef.current = null; }
      return;
    }
    const poll = () => {
      getLiveStreams()
        .then((data) => {
          const channelRef = streamId ? extractChannelRef(streamId) : null;
          const found = (data.streams || []).some(
            (s) => s.id === streamId || (channelRef && s.id === channelRef)
          );
          setHealthOffline(!found);
        })
        .catch(() => {});
    };
    healthPollRef.current = setInterval(poll, 15_000);
    return () => {
      if (healthPollRef.current) { clearInterval(healthPollRef.current); healthPollRef.current = null; }
    };
  }, [isStreamOwner, stream?.isLive, streamId]);

  // Accumulate stats history (keep last 4 samples for HUD sparkline)
  const handlePlayerStats = useCallback((stats: LivePlayerStats) => {
    setStreamStats(stats);
    setStatsHistory((prev) => [...prev.slice(-3), stats]);
  }, []);

  // ── Ticket purchase handler ────────────────────────────────────────────────
  const handleBuyTicket = useCallback(async (currency: "tokens" | "dash") => {
    if (!streamId) return;
    setTicketBuying(true);
    setTicketError(null);
    try {
      const result = await buySlotTicket(streamId, currency);

      if (!result.success) {
        setTicketError(result.error || "Purchase failed");
        return;
      }

      // Tokens path — immediate grant
      if (currency === "tokens") {
        if (result.hasTicket) {
          setTicketStatus((prev) => prev ? { ...prev, hasTicket: true } : null);
          if (result.newBalance !== undefined) setTokenBalance(result.newBalance);
        }
        return;
      }

      // Dash path — open BTCPay checkout in new tab + start polling
      if (currency === "dash" && result.invoiceId && result.checkoutUrl) {
        const safeUrl = assertPaymentUrl(result.checkoutUrl);
        setDashTicketInvoiceId(result.invoiceId);
        setDashTicketCheckoutUrl(safeUrl);
        setDashTicketPollActive(true);
        window.open(safeUrl, "_blank", "noopener,noreferrer");

        // Poll every 10s for up to 15 min (90 polls).
        // Socket event is the primary signal; polling is the fallback.
        let polls = 0;
        const MAX_POLLS = 90;
        if (dashTicketPollRef.current) clearInterval(dashTicketPollRef.current);
        dashTicketPollRef.current = setInterval(async () => {
          polls++;
          try {
            const status = await getDashPaymentDetails(result.invoiceId!);
            if (status.status === "Settled" || status.status === "Complete") {
              if (dashTicketPollRef.current) {
                clearInterval(dashTicketPollRef.current);
                dashTicketPollRef.current = null;
              }
              setDashTicketPollActive(false);
              setDashTicketInvoiceId(null);
              setDashTicketCheckoutUrl(null);
              setTicketStatus((prev) => prev ? { ...prev, hasTicket: true } : null);
            }
          } catch { /* ignore */ }
          if (polls >= MAX_POLLS) {
            if (dashTicketPollRef.current) {
              clearInterval(dashTicketPollRef.current);
              dashTicketPollRef.current = null;
            }
            setDashTicketPollActive(false);
          }
        }, 10000);
        return;
      }

      setTicketError("Unexpected response from payment server");
    } catch (err) {
      setTicketError(err instanceof Error ? err.message : "Purchase failed");
    } finally {
      setTicketBuying(false);
    }
  }, [streamId]);

  // ── Host mode: load current hosted channel on mount (creator only) ─────────
  useEffect(() => {
    if (!isStreamOwner) return;
    getHostedChannel()
      .then((data) => {
        if (data.success) setHostedChannelRef(data.hosting);
      })
      .catch(() => {});
  }, [isStreamOwner]);

  // ── Host mode: resolve hosted stream info when hostedChannelRef changes ─────
  useEffect(() => {
    if (!hostedChannelRef) {
      setHostedStream(null);
      return;
    }
    getWebAppLiveStreams()
      .then((data) => {
        const target = (data.streams || []).find((s: LiveStreamWithHost) => s.id === hostedChannelRef);
        if (target) {
          setHostedStream(target);
        } else {
          setHostedStream({
            id: hostedChannelRef,
            name: hostedChannelRef.replace(/^pnptv-/, '').replace(/-/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
            description: '',
            hlsUrl: `/api/proxy/live/hls/${hostedChannelRef}.m3u8`,
            isLive: false,
          });
        }
      })
      .catch(() => {});
  }, [hostedChannelRef]);

  const handleOpenRaidPicker = useCallback(async () => {
    setShowRaidPicker(true);
    setRaidPickerLoading(true);
    setRaidError(null);
    try {
      const data = await getWebAppLiveStreams();
      const currentRef = streamId ? extractChannelRef(streamId) : null;
      const others = (data.streams || []).filter(
        (s: LiveStreamWithHost) => s.isLive && s.id !== streamId && s.id !== currentRef
      );
      setRaidTargetStreams(others);
    } catch {
      setRaidError('Failed to load live streams');
    } finally {
      setRaidPickerLoading(false);
    }
  }, [streamId]);

  const handleRaid = useCallback(
    async (targetRef: string) => {
      setShowRaidPicker(false);
      setRaidError(null);
      try {
        const result = await initiateRaid(targetRef);
        if (!result.success) {
          setRaidError(result.error || 'Raid failed');
        }
      } catch (err) {
        setRaidError(err instanceof Error ? err.message : 'Raid failed');
      }
    },
    [streamId]
  );

  const handleOpenHostPicker = useCallback(async () => {
    setShowHostPicker(true);
    setHostPickerLoading(true);
    setHostError(null);
    try {
      const data = await getWebAppLiveStreams();
      const currentRef = streamId ? extractChannelRef(streamId) : null;
      setHostTargetStreams((data.streams || []).filter(
        (s: LiveStreamWithHost) => s.id !== streamId && s.id !== currentRef
      ));
    } catch {
      setHostError('Failed to load streams');
    } finally {
      setHostPickerLoading(false);
    }
  }, [streamId]);

  const handleSetHost = useCallback(
    async (targetRef: string | null) => {
      setShowHostPicker(false);
      setHostError(null);
      try {
        const result = await setHostedChannel(targetRef);
        if (result.success) {
          setHostedChannelRef(result.hosting);
        } else {
          setHostError(result.error || 'Failed to set hosted channel');
        }
      } catch (err) {
        setHostError(err instanceof Error ? err.message : 'Failed to set hosted channel');
      }
    },
    []
  );

  // Load recent tips
  const loadTips = useCallback(() => {
    getRecentTips()
      .then((data) => setRecentTips((data.tips || []).slice(0, 5)))
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadTips();
    const interval = setInterval(loadTips, 15000);
    return () => clearInterval(interval);
  }, [loadTips]);

  // Socket tip → recent tips
  useEffect(() => {
    if (!latestTip) return;
    const mapped: RecentTip = {
      id: latestTip.id,
      amount: latestTip.amount,
      user_username: latestTip.username,
      model_name: latestTip.performerName,
      created_at: latestTip.createdAt,
      payment_status: "completed",
    };
    setRecentTips((prev) => [mapped, ...prev.filter((t) => t.id !== mapped.id)].slice(0, 5));
  }, [latestTip]);

  // ── Tip goal: load on mount + sync from socket ─────────────────────────────
  useEffect(() => {
    const channelRef = streamId ? extractChannelRef(streamId) : null;
    if (!channelRef) return;
    getLiveGoal(channelRef)
      .then((res) => { if (res.goalAmount !== null) setTipGoal(res); })
      .catch(() => {});
  }, [streamId]);

  useEffect(() => {
    if (socketTipGoal) setTipGoal(socketTipGoal);
  }, [socketTipGoal]);

  // ── Tip menu: load when stream resolves ────────────────────────────────────
  useEffect(() => {
    if (!streamId) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = stream as any;
    const performerId = s?.performerId || s?.userId || stream?.username || streamId;
    getTipMenu(String(performerId))
      .then((res) => setTipMenu(res.items || []))
      .catch(() => {});
  }, [streamId, stream?.username]);

  // ── Leaderboard: fetch when panel opens or tab changes ─────────────────────
  useEffect(() => {
    const channelRef = streamId ? extractChannelRef(streamId) : null;
    if (!showLeaderboard || !channelRef) return;
    getTipLeaderboard(channelRef, leaderboardTab)
      .then((res) => setLeaderboardData((prev) => ({ ...prev, [leaderboardTab]: res.leaderboard || [] })))
      .catch(() => {});
  }, [showLeaderboard, leaderboardTab, streamId]);

  // ── VOD replay: fetch recordings when stream is detected offline ────────────
  useEffect(() => {
    if (!stream || stream.isLive || !streamId || !isStreamOwner) return;
    const creatorId = user?.id?.toString() ?? '';
    if (!creatorId) return;
    getCreatorRecordings(creatorId)
      .then((res) => {
        const latest = (res.recordings || [])[0];
        if (latest?.manifestUrl) setReplayUrl(latest.manifestUrl);
      })
      .catch(() => {});
  }, [stream?.isLive, streamId, isStreamOwner, user?.id]);

  // Countdown timer for Dash tip invoice (15-minute expiry)
  useEffect(() => {
    if (!dashTip) {
      if (dashTipCountdownRef.current) {
        clearInterval(dashTipCountdownRef.current);
        dashTipCountdownRef.current = null;
      }
      return;
    }
    const tick = () => {
      const elapsed = Math.floor((Date.now() - dashTip.createdAt) / 1000);
      const remaining = Math.max(0, 900 - elapsed);
      setDashTipSecondsLeft(remaining);
      if (remaining === 0) {
        if (dashTipCountdownRef.current) {
          clearInterval(dashTipCountdownRef.current);
          dashTipCountdownRef.current = null;
        }
        if (dashTipPollRef.current) { clearInterval(dashTipPollRef.current); dashTipPollRef.current = null; }
      }
    };
    tick();
    dashTipCountdownRef.current = setInterval(tick, 1000);
    return () => {
      if (dashTipCountdownRef.current) {
        clearInterval(dashTipCountdownRef.current);
        dashTipCountdownRef.current = null;
      }
    };
  }, [dashTip]);

  const handleTip = async (amount: number) => {
    if (!isAuthenticated) { login(); return; }

    // Re-entry guard against rapid double-clicks. Returns immediately if a
    // tip is already in flight; the visible button is also disabled via
    // `tipping` state but useState is async, so the synchronous ref is the
    // bulletproof gate.
    if (tippingRef.current) return;
    tippingRef.current = true;

    // Pre-flight balance check for token tips. Server still enforces this
    // (UPDATE WHERE balance_tokens >= amount), but failing on the server
    // shows the user a generic error toast — checking client-side lets us
    // give them the precise "you have X, need Y" message before the round-trip.
    if (tipPaymentTab === "tokens" && tokenBalance !== null && tokenBalance < amount) {
      setTipError(t.live.insufficientTokens(tokenBalance));
      tippingRef.current = false;
      return;
    }

    // Dash tip — create BTCPay invoice, show in-app QR
    if (tipPaymentTab === "dash") {
      setTipping(true);
      setTipSubmitting(true);
      setTipError(null);
      setTipSuccess(null);
      try {
        const result = await sendTip(streamId || "", amount, undefined, "dash");
        if (result.invoiceId) {
          const safeCheckoutUrl = result.checkoutUrl ? assertPaymentUrl(result.checkoutUrl) : "";
          setDashTip({ invoiceId: result.invoiceId, checkoutUrl: safeCheckoutUrl, loading: true, invoiceAmount: amount, createdAt: Date.now() });
          setDashTipSecondsLeft(900);
          // Fetch payment details
          getDashPaymentDetails(result.invoiceId)
            .then((d) => {
              if (d.success) {
                setDashTip((prev) => prev ? { ...prev, destination: d.destination, amount: d.amount, loading: false } : prev);
              } else {
                setDashTip((prev) => prev ? { ...prev, loading: false } : prev);
              }
            })
            .catch(() => {
              setDashTip((prev) => prev ? { ...prev, loading: false } : prev);
            });
          // Poll for payment confirmation
          dashTipPollRef.current = setInterval(async () => {
            try {
              const details = await getDashPaymentDetails(result.invoiceId!);
              if (details.status === "Settled" || details.status === "Complete") {
                if (dashTipPollRef.current) { clearInterval(dashTipPollRef.current); dashTipPollRef.current = null; }
                setDashTipSuccess(true);
                if (dashTipSettleTimerRef.current) clearTimeout(dashTipSettleTimerRef.current);
                dashTipSettleTimerRef.current = setTimeout(() => {
                  setDashTip(null);
                  setDashTipSuccess(false);
                  setTipSuccess(t.live.tipSuccess);
                  if (tipSuccessTimerRef.current) clearTimeout(tipSuccessTimerRef.current);
                  tipSuccessTimerRef.current = setTimeout(() => {
                    setTipSuccess(null);
                    tipSuccessTimerRef.current = null;
                  }, 3000);
                  dashTipSettleTimerRef.current = null;
                }, 1500);
              }
            } catch { /* ignore */ }
          }, 5000);
        }
      } catch (err) {
        setTipError(err instanceof Error ? err.message : t.live.tipFailed);
      } finally {
        setTipping(false);
        setTipSubmitting(false);
        tippingRef.current = false;
      }
      return;
    }

    // Token tip — fire directly.
    setTipping(true);
    setTipSubmitting(true);
    setTipError(null);
    setTipSuccess(null);
    try {
      const tipResult = await sendTip(streamId || "", amount, undefined, "tokens");
      if (tipResult?.newBalance !== undefined) setTokenBalance(tipResult.newBalance);
      setTipSuccess(t.live.tipSuccess);
      if (tipSuccessTimerRef.current) clearTimeout(tipSuccessTimerRef.current);
      tipSuccessTimerRef.current = setTimeout(() => {
        setTipSuccess(null);
        tipSuccessTimerRef.current = null;
      }, 3000);
    } catch (err) {
      setTipError(err instanceof Error ? err.message : t.live.tipFailed);
    } finally {
      setTipping(false);
      setTipSubmitting(false);
      tippingRef.current = false;
    }
  };

  const chatEndRef = React.useRef<HTMLDivElement>(null);
  const chatContainerRef = React.useRef<HTMLDivElement>(null);
  const [hasNewMessages, setHasNewMessages] = useState(false);
  const videoContainerRef = React.useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Chat collapsed by default on mobile (improvement #6)
  const [isChatCollapsed, setIsChatCollapsed] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < 768
  );

  // react-window List ref for programmatic scroll-to-bottom
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chatListRef = useRef<any>(null);

  // ── Leaderboard: fetched from API when panel is opened ─────────────────────
  // (leaderboardData state is declared above near the showLeaderboard state)

  const isNearBottom = () => {
    const el = chatContainerRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  useEffect(() => {
    if (isNearBottom()) {
      const msgs = chatMessages.slice(-50);
      if (msgs.length > 0) {
        chatListRef.current?.scrollToRow({ index: msgs.length - 1 });
      }
      chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
      setHasNewMessages(false);
    } else {
      setHasNewMessages(true);
    }
  }, [chatMessages]);

  const scrollToBottom = () => {
    const msgs = chatMessages.slice(-50);
    if (msgs.length > 0) {
      chatListRef.current?.scrollToRow({ index: msgs.length - 1 });
    }
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    setHasNewMessages(false);
  };

  const handleShare = useCallback(async () => {
    const url = window.location.href;
    const title = stream?.name ? `${stream.name} — PNPtv Live` : "PNPtv Live";
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title, url });
      } catch {
        // User cancelled or share failed — do nothing
      }
      return;
    }
    // Clipboard fallback for desktop
    const copyToClipboard = async (text: string) => {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
    };
    try {
      await copyToClipboard(url);
      setShareCopied(true);
      if (shareCopiedTimerRef.current) clearTimeout(shareCopiedTimerRef.current);
      shareCopiedTimerRef.current = setTimeout(() => {
        setShareCopied(false);
        shareCopiedTimerRef.current = null;
      }, 2000);
    } catch {
      // Clipboard unavailable — silently ignore
    }
  }, [stream?.name]);

  const handleFullscreen = useCallback(() => {
    const el = videoContainerRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  }, []);

  // Sync isFullscreen state with external fullscreenchange events
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  const formatTimeAgo = (dateStr: string) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '';
    const diff = Date.now() - d.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "now";
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h`;
    return `${Math.floor(hrs / 24)}d`;
  };

  if (loading || rulesLoading) {
    return (
      <div className="page-container">
        <Skeleton className="w-full rounded-xl" style={{ aspectRatio: "16/9" }} />
        <Skeleton className="h-10 mt-3 rounded-lg" />
        <Skeleton className="h-40 mt-3 rounded-xl" />
      </div>
    );
  }

  if (error || !stream) {
    return (
      <div className="page-container text-center py-20">
        <p className="text-pnp-textSecondary mb-4">{error || t.live.streamNotFound}</p>
        <div className="flex flex-col items-center gap-3">
          <button
            onClick={() => {
              setError(null);
              setStreamError(false);
              setLoading(true);
              loadStream().finally(() => setLoading(false));
            }}
            className="px-4 py-2 rounded-xl text-sm font-semibold text-white"
            style={{ background: "linear-gradient(135deg, #D4007A, #7B61FF)" }}
          >
            Try again
          </button>
          <button onClick={() => navigate("/live")} className="text-sm text-pnp-accent hover:underline">
            {t.live.backToLive}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`${isTheaterMode ? "max-w-none px-0 py-0" : "page-container"} space-y-3 transition-all duration-300`}>
      <Helmet>
        <title>{stream.name} — PNPtv Live</title>
        <meta name="description" content={stream.description || `Watch ${stream.name} live on PNPtv`} />
      </Helmet>

      {/* Rules acknowledgment gate — shown to authenticated users who have not yet agreed */}
      {!rulesAcknowledged && (
        <LiveRulesModal
          onAcknowledge={handleAcknowledgeRules}
          creatorName={creatorRulesName}
          creatorRules={creatorRules}
        />
      )}

      {/* ── Raid notification overlay ─────────────────────────────────────────
           Shown to all viewers when the streamer initiates a raid.
           Counts down 5s then auto-redirects; viewer can dismiss to stay. */}
      {raidEvent && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm"
          role="alertdialog"
          aria-live="assertive"
          aria-label="Raid in progress"
        >
          <div className="relative w-full max-w-sm mx-4 rounded-2xl bg-pnp-surface border border-pnp-border shadow-2xl overflow-hidden">
            <div className="h-1 w-full bg-gradient-to-r from-pnp-accent via-purple-500 to-pink-500 animate-pulse" />
            <div className="px-6 py-8 flex flex-col items-center gap-4 text-center">
              <div className="text-4xl" aria-hidden="true">🎉</div>
              <div>
                <p className="text-base font-bold text-pnp-textPrimary">Raiding!</p>
                <p className="text-sm text-pnp-textSecondary mt-1">
                  Redirecting to{" "}
                  <span className="text-pnp-accent font-semibold">{raidEvent.targetName}</span>
                </p>
              </div>
              <div className="relative flex items-center justify-center w-16 h-16">
                <svg className="absolute inset-0 -rotate-90" viewBox="0 0 64 64" aria-hidden="true">
                  <circle cx="32" cy="32" r="28" fill="none" stroke="currentColor" strokeWidth="4" className="text-pnp-border" />
                  <circle
                    cx="32" cy="32" r="28"
                    fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round"
                    className="text-pnp-accent transition-all duration-1000"
                    strokeDasharray={`${2 * Math.PI * 28}`}
                    strokeDashoffset={`${2 * Math.PI * 28 * (1 - (raidCountdown ?? 5) / 5)}`}
                  />
                </svg>
                <span className="text-2xl font-bold text-pnp-textPrimary tabular-nums">
                  {raidCountdown ?? 5}
                </span>
              </div>
              <button
                onClick={dismissRaid}
                className="px-5 py-2 rounded-lg bg-pnp-surface border border-pnp-border text-xs font-semibold text-pnp-textSecondary hover:text-pnp-textPrimary hover:border-pnp-accent/40 transition-colors active:scale-95"
              >
                Stay here
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Back link + share */}
      <div className={`flex items-center justify-between ${isTheaterMode ? "px-4 pt-3" : ""}`}>
        <button onClick={() => navigate("/live")} className="text-xs text-pnp-textSecondary hover:text-pnp-accent transition-colors">
          {String.fromCharCode(8592)} {t.live.backToLive}
        </button>
        <div className="flex items-center gap-1.5">
          {/* Clipboard copy confirmation toast */}
          {shareCopied && (
            <span
              className="text-[10px] text-pnp-textSecondary bg-pnp-surface border border-pnp-border px-2 py-0.5 rounded-full"
              aria-live="polite"
            >
              Copied!
            </span>
          )}
          <button
            onClick={handleShare}
            className="flex items-center justify-center w-8 h-8 rounded-full bg-pnp-surface border border-pnp-border text-pnp-textSecondary hover:text-pnp-textPrimary hover:border-pnp-accent/40 transition-colors active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent"
            aria-label="Share stream"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
            </svg>
          </button>
          {/* Theater mode button — only visible on desktop (improvement #7) */}
          <button
            onClick={() => setIsTheaterMode(!isTheaterMode)}
            className="hidden md:flex items-center justify-center w-8 h-8 rounded-full bg-pnp-surface border border-pnp-border text-pnp-textSecondary hover:text-pnp-textPrimary hover:border-pnp-accent/40 transition-colors active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent"
            aria-label={isTheaterMode ? "Exit theater mode" : "Enter theater mode"}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <rect x="3" y="6" width="18" height="12" rx="1.5" strokeDasharray={isTheaterMode ? "" : "4 2"} />
              {isTheaterMode ? (
                <path strokeLinecap="round" d="M10 9l-2 2 2 2m4-4l2 2-2 2" />
              ) : (
                <path strokeLinecap="round" d="M8 12h8" />
              )}
            </svg>
          </button>
          {/* Raid button — only visible to the stream owner while live */}
          {isStreamOwner && stream.isLive && (
            <div className="relative">
              <button
                onClick={handleOpenRaidPicker}
                className="flex items-center gap-1 h-8 px-2.5 rounded-full bg-purple-500/20 border border-purple-500/40 text-purple-400 hover:bg-purple-500/30 transition-colors active:scale-95 text-[10px] font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500"
                aria-label="Raid another stream"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                </svg>
                Raid
              </button>
              {showRaidPicker && (
                <div className="absolute right-0 top-10 z-50 w-56 rounded-xl bg-pnp-surface border border-pnp-border shadow-2xl overflow-hidden">
                  <div className="px-3 py-2 border-b border-pnp-border flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-pnp-textPrimary">Raid a live stream</span>
                    <button onClick={() => setShowRaidPicker(false)} className="text-pnp-textSecondary hover:text-pnp-textPrimary text-xs" aria-label="Close">✕</button>
                  </div>
                  {raidPickerLoading ? (
                    <div className="flex items-center justify-center py-6">
                      <span className="w-5 h-5 border-2 border-pnp-accent border-t-transparent rounded-full animate-spin" />
                    </div>
                  ) : raidTargetStreams.length === 0 ? (
                    <p className="text-[11px] text-pnp-textSecondary text-center py-5 px-3">No other streams are live right now.</p>
                  ) : (
                    <ul className="max-h-48 overflow-y-auto divide-y divide-pnp-border">
                      {raidTargetStreams.map((s) => (
                        <li key={s.id}>
                          <button onClick={() => handleRaid(s.id)} className="w-full text-left px-3 py-2.5 hover:bg-pnp-surfaceHover transition-colors group">
                            <div className="flex items-center gap-2">
                              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse flex-shrink-0" />
                              <span className="text-xs font-medium text-pnp-textPrimary group-hover:text-pnp-accent truncate">{s.name}</span>
                            </div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Video Player */}
      <div ref={videoContainerRef} className={`relative ${isTheaterMode ? "" : "-mx-4 sm:-mx-6"}`}>
        {/* ── Paywall overlay — shown when slot is ticketed and viewer has no ticket ── */}
        {ticketStatus?.isTicketed && !ticketStatus.hasTicket && !ticketLoading ? (
          <div className="relative aspect-video rounded-xl bg-pnp-surface border border-pnp-border overflow-hidden flex items-center justify-center">
            {/* Blurred thumbnail as background */}
            {stream.thumbnailUrl && (
              <img
                src={stream.thumbnailUrl}
                alt=""
                className="absolute inset-0 w-full h-full object-cover opacity-20 blur-sm scale-105"
                aria-hidden="true"
              />
            )}
            <div className="relative z-10 flex flex-col items-center gap-4 px-6 py-8 text-center max-w-xs">
              <div className="w-12 h-12 rounded-full bg-pnp-accent/20 border border-pnp-accent/40 flex items-center justify-center">
                <svg className="w-6 h-6 text-pnp-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-bold text-pnp-textPrimary">{stream.name}</p>
                <p className="text-[11px] text-pnp-textSecondary mt-1">This is a ticketed show</p>
              </div>
              {isCreatorPayLocked(stream.username) ? (
                <p className="text-[10px] text-pnp-textSecondary text-center py-1">🔒 Launches June 1st</p>
              ) : (!ticketStatus.priceTokens && !ticketStatus.priceUsd) ? (
                <p className="text-[10px] text-pnp-textSecondary">
                  Tickets unavailable — contact support
                </p>
              ) : (
                <div className="flex flex-col gap-2 w-full">
                  {ticketError && (
                    <p className="text-[10px] text-red-400">{ticketError}</p>
                  )}
                  {ticketStatus.priceTokens && (
                    <button
                      onClick={() => handleBuyTicket("tokens")}
                      disabled={ticketBuying}
                      className="w-full px-4 py-2.5 rounded-lg btn-gradient text-white text-xs font-bold disabled:opacity-50 active:scale-95 transition-all flex items-center justify-center gap-2"
                    >
                      {ticketBuying && <span className="w-3 h-3 border border-white/60 border-t-transparent rounded-full animate-spin flex-shrink-0" />}
                      Buy for {ticketStatus.priceTokens} Tokens
                    </button>
                  )}
                  {ticketStatus.priceUsd && !dashTicketPollActive && (
                    <>
                      <button
                        onClick={() => handleBuyTicket("dash")}
                        disabled={ticketBuying}
                        className="w-full px-4 py-2.5 rounded-lg bg-pnp-surface border border-white/20 text-pnp-textSecondary text-xs font-bold disabled:opacity-50 active:scale-95 transition-all"
                      >
                        {ticketBuying ? (
                          <span className="flex items-center justify-center gap-2">
                            <span className="w-3 h-3 border border-white/60 border-t-transparent rounded-full animate-spin flex-shrink-0" />
                            Processing...
                          </span>
                        ) : (
                          `Pay $${ticketStatus.priceUsd} with Crypto (Dash)`
                        )}
                      </button>
                    </>
                  )}
                  {ticketStatus.priceUsd && dashTicketPollActive && dashTicketCheckoutUrl && (
                    <div className="w-full flex flex-col items-center gap-2">
                      <p className="text-[10px] text-pnp-textSecondary text-center">
                        Waiting for crypto payment...
                      </p>
                      <a
                        href={dashTicketCheckoutUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-full px-4 py-2 rounded-lg bg-pnp-surface border border-white/20 text-pnp-textSecondary text-xs font-bold text-center transition-all hover:border-white/40"
                      >
                        Open Payment Page
                      </a>
                      <button
                        onClick={() => {
                          if (dashTicketPollRef.current) {
                            clearInterval(dashTicketPollRef.current);
                            dashTicketPollRef.current = null;
                          }
                          setDashTicketPollActive(false);
                          setDashTicketInvoiceId(null);
                          setDashTicketCheckoutUrl(null);
                        }}
                        className="text-[10px] text-pnp-textSecondary underline"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ) : (
          <LivePlayer
            src={stream.hlsUrl}
            title={stream.name}
            poster={stream.thumbnailUrl || undefined}
            overlay={overlay}
            onStats={isStreamOwner ? handlePlayerStats : undefined}
          />
        )}

        {/* ── Stream health HUD — creator-only, desktop, top-left of video ─── */}
        {isStreamOwner && stream.isLive && !(ticketStatus?.isTicketed && !ticketStatus.hasTicket) && (
          <div className="hidden md:flex absolute top-3 left-3 z-30 flex-col items-start">
            <button
              onClick={() => setHudExpanded((v) => !v)}
              className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-bold border backdrop-blur-sm transition-colors ${
                healthOffline
                  ? "bg-red-500/20 border-red-500/40 text-red-400"
                  : streamStats?.bufferStall
                  ? "bg-amber-500/20 border-amber-500/40 text-amber-400"
                  : "bg-black/60 border-white/20 text-white/80"
              }`}
              aria-label="Stream health"
            >
              {/* Status dot */}
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                healthOffline ? "bg-red-500" : streamStats?.bufferStall ? "bg-amber-400" : "bg-green-500"
              }`} />
              {streamStats ? `${streamStats.bitrate}kbps` : "HUD"}
              <svg
                className={`w-2.5 h-2.5 transition-transform ${hudExpanded ? "rotate-180" : ""}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {hudExpanded && (
              <div className="mt-1 w-48 rounded-xl bg-black/80 border border-white/15 backdrop-blur-sm shadow-2xl overflow-hidden">
                <div className="px-3 py-2 border-b border-white/10">
                  <span className="text-[10px] font-bold text-white">Stream Health</span>
                </div>
                <div className="px-3 py-2 space-y-1.5 text-[10px]">
                  <div className="flex justify-between">
                    <span className="text-white/50">Bitrate</span>
                    <span className={`font-mono font-bold ${streamStats && streamStats.bitrate < 500 ? "text-red-400" : "text-green-400"}`}>
                      {streamStats ? `${streamStats.bitrate} kbps` : "—"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-white/50">Dropped frames</span>
                    <span className={`font-mono font-bold ${streamStats && streamStats.droppedFrames > 30 ? "text-amber-400" : "text-white/80"}`}>
                      {streamStats ? streamStats.droppedFrames : "—"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-white/50">Buffer</span>
                    <span className={`font-bold ${healthOffline ? "text-red-400" : streamStats?.bufferStall ? "text-amber-400" : "text-green-400"}`}>
                      {healthOffline ? "OFFLINE" : streamStats?.bufferStall ? "STALLED" : "OK"}
                    </span>
                  </div>
                  {/* Last-60s mini history */}
                  {statsHistory.length > 1 && (
                    <div className="pt-1 border-t border-white/10">
                      <p className="text-[9px] text-white/40 mb-1">Last {statsHistory.length} samples</p>
                      <div className="flex items-end gap-0.5 h-6">
                        {statsHistory.map((s, i) => {
                          const pct = Math.min(100, (s.bitrate / 5000) * 100);
                          return (
                            <div
                              key={i}
                              className={`flex-1 rounded-sm ${s.bufferStall ? "bg-amber-400" : "bg-green-500"}`}
                              style={{ height: `${Math.max(8, pct)}%` }}
                            />
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
        {streamError && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 z-30 rounded-xl">
            <div className="text-center">
              <p className="text-white text-sm font-medium mb-3">Stream failed to load</p>
              <button
                onClick={() => {
                  setStreamError(false);
                  setLoading(true);
                  loadStream().finally(() => setLoading(false));
                }}
                className="px-5 py-2.5 rounded-lg text-xs font-semibold text-white btn-gradient"
              >
                Try Again
              </button>
            </div>
          </div>
        )}

        {tipAlert && (
          <div className="absolute top-12 left-1/2 -translate-x-1/2 z-30 px-4 py-2 rounded-full bg-pnp-accent text-white text-xs font-bold shadow-lg animate-bounce pointer-events-none">
            {tipAlert.message || `${tipAlert.username} tipped ${tipAlert.amount}T`}
          </div>
        )}

        {/* Mobile fullscreen toggle button (improvement #6) */}
        <button
          onClick={handleFullscreen}
          className="sm:hidden absolute bottom-14 right-3 z-20 w-9 h-9 flex items-center justify-center rounded-full bg-black/60 hover:bg-black/80 transition-colors active:scale-95"
          aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
        >
          {isFullscreen ? (
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5M15 15l5.25 5.25M9 15H4.5M9 15v4.5M9 15l-5.25 5.25" />
            </svg>
          ) : (
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
            </svg>
          )}
        </button>
        {/* Overlay */}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent px-4 pb-3 pt-10">
          <div className="flex items-center gap-2 flex-wrap">
            {stream.isLive && (
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                <span className="text-xs font-semibold text-white">LIVE</span>
              </span>
            )}
            {viewerCount > 0 && (
              <span className="flex items-center gap-1 text-xs text-white/70">
                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z" />
                </svg>
                {viewerCount} watching
              </span>
            )}
            {/* Leaderboard toggle — desktop only */}
            <button
              onClick={() => setShowLeaderboard((v) => !v)}
              className="hidden md:flex items-center justify-center w-6 h-6 rounded-full bg-white/10 hover:bg-white/20 transition-colors text-xs"
              aria-label="Toggle tip leaderboard"
              title="Tip leaderboard"
            >
              🏆
            </button>
            <span className="text-sm text-white font-medium truncate max-w-[200px]">{stream.name}</span>
          </div>
          {stream.description && (
            <p className="text-xs text-white/60 mt-1">{stream.description}</p>
          )}
          {stream.tags && stream.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {stream.tags.map((tag) => (
                <span
                  key={tag}
                  className="px-1.5 py-0.5 rounded-full text-[9px] font-medium text-white/70 border border-white/20"
                  style={{ background: "rgba(255,255,255,0.08)" }}
                >
                  {(t.live[tag as keyof typeof t.live] as string) || tag}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Tip Leaderboard overlay — desktop only, toggled by trophy button */}
        {showLeaderboard && (
          <div className="hidden md:block absolute top-3 right-3 z-40 w-52 rounded-xl bg-black/80 border border-white/10 backdrop-blur-sm shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
              <span className="text-[11px] font-bold text-white">Tip Leaderboard</span>
              <button onClick={() => setShowLeaderboard(false)} className="text-white/50 hover:text-white text-xs" aria-label="Close leaderboard">✕</button>
            </div>
            <div className="flex border-b border-white/10">
              {(["today", "week"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setLeaderboardTab(tab)}
                  className={`flex-1 py-1.5 text-[10px] font-semibold transition-colors ${leaderboardTab === tab ? "text-pnp-accent bg-white/5" : "text-white/50 hover:text-white/80"}`}
                >
                  {tab === "today" ? "Today" : "This Week"}
                </button>
              ))}
            </div>
            <div className="px-3 py-2 space-y-2">
              {leaderboardData[leaderboardTab].length === 0 ? (
                <p className="text-[10px] text-white/40 text-center py-2">No tips yet — be the first.</p>
              ) : (
                leaderboardData[leaderboardTab].map((entry, i) => (
                  <div key={entry.username} className="flex items-center gap-2">
                    <span className={`w-4 text-[10px] font-bold tabular-nums text-right flex-shrink-0 ${i === 0 ? "text-yellow-400" : i === 1 ? "text-slate-300" : i === 2 ? "text-amber-600" : "text-white/40"}`}>
                      {i + 1}
                    </span>
                    <div className="w-5 h-5 rounded-full bg-pnp-accent/30 flex items-center justify-center flex-shrink-0 text-[8px] font-bold text-white uppercase">
                      {entry.username.slice(0, 2)}
                    </div>
                    <span className="flex-1 text-[10px] text-white/80 truncate">@{entry.username}</span>
                    <span className="text-[10px] font-bold text-pnp-accent flex-shrink-0">{entry.total}T</span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Tip goal progress bar ─────────────────────────────────────────────── */}
      {tipGoal && tipGoal.goalAmount && (
        <div className="px-4 py-2 bg-pnp-surface border-b border-pnp-border">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-semibold text-pnp-textPrimary truncate">
              {tipGoal.goalLabel || "Goal"}
            </span>
            <span className="text-xs text-pnp-textSecondary flex-shrink-0 ml-2">
              {Math.round(tipGoal.progress)}/{Math.round(tipGoal.goalAmount)} tokens
            </span>
          </div>
          <div className="h-2 rounded-full bg-pnp-border overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                tipGoal.completed ? "bg-green-500" : "bg-pnp-accent"
              }`}
              style={{ width: `${Math.min(100, Math.round((tipGoal.progress / tipGoal.goalAmount) * 100))}%` }}
            />
          </div>
          {tipGoal.completed && (
            <p className="text-[10px] text-green-400 font-semibold mt-1 text-center">Goal reached!</p>
          )}
        </div>
      )}

      {/* ── VOD replay — shown when stream is offline and a recording exists ──── */}
      {!stream.isLive && replayUrl && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 px-1">
            <span className="text-[10px] font-semibold text-pnp-textSecondary uppercase tracking-wider">Past stream replay</span>
          </div>
          <LivePlayer
            src={replayUrl}
            title={stream.name}
            poster={stream.thumbnailUrl || undefined}
          />
        </div>
      )}

      <div className={`space-y-3 ${isTheaterMode ? "max-w-7xl mx-auto px-4 sm:px-6 pb-8" : ""}`}>
        {/* ── Stream health panel — owner-only, shows RTMP signal status ─── */}
        {isStreamOwner && streamId && (
          <StreamHealthPanel streamId={streamId} />
        )}

        {/* ── Host mode banner — shown when offline but hosting another channel ── */}
      {!stream.isLive && hostedStream && (
        <div className="rounded-xl border border-pnp-accent/30 bg-pnp-accent/5 px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <svg className="w-4 h-4 text-pnp-accent flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.069A1 1 0 0121 8.82v6.36a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
            </svg>
            <div className="min-w-0">
              <p className="text-[11px] font-bold text-pnp-textPrimary">
                Hosting <span className="text-pnp-accent">{hostedStream.name}</span>
              </p>
              {!hostedStream.isLive && (
                <p className="text-[10px] text-pnp-textSecondary">Hosted stream is currently offline</p>
              )}
            </div>
          </div>
          <button
            onClick={() => navigate(`/live/${encodeURIComponent(hostedStream.id)}`)}
            className="flex-shrink-0 px-3 py-1.5 rounded-lg btn-gradient text-white text-[10px] font-semibold active:scale-95"
          >
            Watch
          </button>
        </div>
      )}

      {/* ── Offline streamer controls — Host mode selector ─────────────────── */}
      {isStreamOwner && stream && !stream.isLive && (
        <div className="rounded-xl border border-pnp-border bg-pnp-surface px-4 py-3 space-y-3">
          <p className="text-[11px] font-semibold text-pnp-textPrimary">Streamer Controls</p>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium text-pnp-textPrimary">Host Mode</p>
              <p className="text-[10px] text-pnp-textSecondary">
                {hostedChannelRef
                  ? `Hosting: ${hostedStream?.name || hostedChannelRef}`
                  : 'Show another stream while offline'}
              </p>
            </div>
            <div className="flex gap-1.5 flex-shrink-0">
              {hostedChannelRef && (
                <button
                  onClick={() => handleSetHost(null)}
                  className="px-2.5 py-1.5 rounded-lg text-[10px] font-semibold border border-pnp-border text-pnp-textSecondary hover:text-red-400 hover:border-red-400/40 transition-colors active:scale-95"
                >
                  Clear
                </button>
              )}
              <div className="relative">
                <button
                  onClick={handleOpenHostPicker}
                  className="px-3 py-1.5 rounded-lg text-[10px] font-semibold bg-pnp-accent/20 border border-pnp-accent/40 text-pnp-accent hover:bg-pnp-accent/30 transition-colors active:scale-95"
                >
                  {hostedChannelRef ? 'Change' : 'Set Host'}
                </button>
                {showHostPicker && (
                  <div className="absolute right-0 top-9 z-50 w-56 rounded-xl bg-pnp-surface border border-pnp-border shadow-2xl overflow-hidden">
                    <div className="px-3 py-2 border-b border-pnp-border flex items-center justify-between">
                      <span className="text-[11px] font-semibold text-pnp-textPrimary">Select stream to host</span>
                      <button onClick={() => setShowHostPicker(false)} className="text-pnp-textSecondary hover:text-pnp-textPrimary text-xs" aria-label="Close">✕</button>
                    </div>
                    {hostPickerLoading ? (
                      <div className="flex items-center justify-center py-6">
                        <span className="w-5 h-5 border-2 border-pnp-accent border-t-transparent rounded-full animate-spin" />
                      </div>
                    ) : hostTargetStreams.length === 0 ? (
                      <p className="text-[11px] text-pnp-textSecondary text-center py-5 px-3">No other streams available.</p>
                    ) : (
                      <ul className="max-h-48 overflow-y-auto divide-y divide-pnp-border">
                        {hostTargetStreams.map((s) => (
                          <li key={s.id}>
                            <button onClick={() => handleSetHost(s.id)} className="w-full text-left px-3 py-2.5 hover:bg-pnp-surfaceHover transition-colors group">
                              <div className="flex items-center gap-2">
                                {s.isLive && <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse flex-shrink-0" />}
                                <span className="text-xs font-medium text-pnp-textPrimary group-hover:text-pnp-accent truncate">{s.name}</span>
                                {s.isLive && <span className="ml-auto flex-shrink-0 text-[9px] font-bold text-red-400">LIVE</span>}
                              </div>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
          {(raidError || hostError) && (
            <p className="text-[10px] text-red-400">{raidError || hostError}</p>
          )}
        </div>
      )}

      {/* Reconnecting indicator — shown when socket drops and is attempting to reconnect */}
      {chatReconnecting && !chatConnected && !reconnectTimedOut && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-pnp-surface border border-pnp-border" aria-live="polite">
          <span className="w-3 h-3 border border-pnp-textSecondary border-t-transparent rounded-full animate-spin flex-shrink-0" />
          <span className="text-[10px] text-pnp-textSecondary">Reconnecting to live chat...</span>
        </div>
      )}

      {/* ── Paywall gate: hide chat + tips until ticket purchased ─────────────── */}
      {ticketStatus?.isTicketed && !ticketStatus.hasTicket ? null : (<>

      {/* Wallet Balance — Improvement #1 */}
      {isAuthenticated && (
        <div className="flex items-center justify-between px-1 py-1">
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: "#008CE7" }}>
              <svg viewBox="0 0 24 24" className="w-2.5 h-2.5 fill-white">
                <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm1.5 14.5h-3v-2h3c.828 0 1.5-.672 1.5-1.5S14.328 11 13.5 11H10V9h3.5c1.933 0 3.5 1.567 3.5 3.5S15.433 16 13.5 16.5z"/>
              </svg>
            </div>
            <span className="text-[10px] sm:text-[11px] font-semibold text-pnp-textPrimary">
              {tokenBalance === null ? "—" : `${tokenBalance} ${t.live.tokens}`}
            </span>
          </div>
          <button
            onClick={() => setShowTopUp(true)}
            className="relative flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-semibold text-white btn-gradient"
          >
            {tokenBalance !== null && tokenBalance < 10 && (
              <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            )}
            <svg viewBox="0 0 24 24" className="w-3 h-3 fill-white flex-shrink-0">
              <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm1.5 14.5h-3v-2h3c.828 0 1.5-.672 1.5-1.5S14.328 11 13.5 11H10V9h3.5c1.933 0 3.5 1.567 3.5 3.5S15.433 16 13.5 16.5z"/>
            </svg>
            + Top up
          </button>
        </div>
      )}

      {/* Tip menu — shown above fixed amounts when the creator has configured items */}
      {tipMenu.length > 0 && stream.isLive && !isCreatorPayLocked(stream.username) && (
        <div>
          <p className="text-[10px] text-pnp-textSecondary mb-1.5 font-medium">Tip menu</p>
          <div className="flex flex-wrap gap-1.5">
            {tipMenu.map((item) => (
              <button
                key={item.id}
                onClick={() => handleTip(item.tokensAmount)}
                disabled={tipping}
                className="px-2.5 py-1 rounded-lg text-[11px] font-semibold border border-pnp-border bg-pnp-surface text-pnp-textPrimary hover:border-pnp-accent/60 transition-colors text-left disabled:opacity-50"
              >
                <span className="text-pnp-accent font-bold">{item.tokensAmount}</span>
                <span className="text-pnp-textSecondary mx-1">·</span>
                {item.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Tip bar — hidden when stream is offline */}
      <div className={`flex items-center gap-2 ${!stream.isLive ? 'opacity-50 pointer-events-none' : ''}`}>
        {isCreatorPayLocked(stream.username) ? (
          <p className="text-[10px] text-pnp-textSecondary text-center w-full py-1">🔒 Launches June 1st</p>
        ) : (<>
        <div className="flex gap-1.5 flex-1 overflow-x-auto [&::-webkit-scrollbar]:hidden" style={{ scrollbarWidth: "none" }}>
          {TIP_AMOUNTS.map((amount) => (
            <button
              key={amount}
              onClick={() => handleTip(amount)}
              disabled={tipping || !stream.isLive}
              className="min-h-[44px] px-3 py-1.5 rounded-lg font-semibold text-xs transition-all text-white active:scale-95 disabled:opacity-50 btn-gradient whitespace-nowrap flex items-center gap-1.5"
            >
              {tipSubmitting && (
                <span className="w-3 h-3 border border-white/60 border-t-transparent rounded-full animate-spin flex-shrink-0" />
              )}
              {tipPaymentTab === "tokens" ? `${amount}T` : `$${amount}`}
            </button>
          ))}
        </div>
        {isAuthenticated && (
          <div className="flex flex-shrink-0 gap-0.5">
            <button
              onClick={() => setTipPaymentTab("tokens")}
              aria-label="Pay with Tokens"
              className={`px-2 py-1.5 rounded-l-lg text-[10px] font-medium border transition-colors ${tipPaymentTab === "tokens" ? "bg-pnp-accent/20 border-pnp-accent/40 text-pnp-accent" : "bg-pnp-surface border-pnp-border text-pnp-textSecondary"}`}
            >
              T
            </button>
            <button
              onClick={() => setTipPaymentTab("dash")}
              aria-label="Pay with Dash"
              className={`px-2 py-1.5 rounded-r-lg text-[10px] font-medium border transition-colors ${tipPaymentTab === "dash" ? "bg-[#008DE4]/20 border-[#008DE4]/40 text-[#008DE4]" : "bg-pnp-surface border-pnp-border text-pnp-textSecondary"}`}
            >
              D
            </button>
          </div>
        )}
        </>)}
      </div>
      {tipError && (
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] text-pnp-error">{tipError}</p>
          {tipPaymentTab === "tokens" && tokenBalance !== null && (
            <button
              onClick={() => setShowTopUp(true)}
              className="flex-shrink-0 text-[10px] font-bold text-pnp-accent hover:underline"
            >
              Buy tokens →
            </button>
          )}
        </div>
      )}
      {tipSuccess && <p className="text-[10px] text-gradient">{tipSuccess}</p>}

      {/* Dash tip payment widget */}
      {dashTip && (
        <div className="rounded-xl border border-[#008DE4]/40 bg-[#008DE4]/5 p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-[#008DE4] animate-pulse" />
              <span className="text-[11px] font-medium text-pnp-textPrimary">
                Dash tip — ${dashTip.invoiceAmount}
              </span>
            </div>
            {!dashTipSuccess && (
            <button
              onClick={() => {
                setDashTip(null);
                setDashTipCopied(false);
                setDashTipSecondsLeft(900);
                if (dashTipPollRef.current) { clearInterval(dashTipPollRef.current); dashTipPollRef.current = null; }
              }}
              className="text-[10px] text-pnp-textSecondary hover:text-pnp-textPrimary"
            >
              Cancel
            </button>
            )}
          </div>

          {dashTipSuccess ? (
            <div className="flex flex-col items-center gap-2 py-3">
              <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center">
                <svg className="w-5 h-5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-xs font-semibold text-green-400">Tip sent!</p>
            </div>
          ) : dashTipSecondsLeft === 0 ? (
            <div className="flex flex-col items-center gap-2 py-3">
              <p className="text-[11px] font-medium text-red-400">Invoice expired</p>
              <button
                onClick={() => { setDashTip(null); setDashTipCopied(false); setDashTipSecondsLeft(900); }}
                className="px-3 py-1 rounded-lg bg-[#008DE4] text-white text-[10px] font-semibold hover:bg-[#0070b8] transition-colors"
              >
                Try Again
              </button>
            </div>
          ) : dashTip.loading ? (
            <div className="flex items-center justify-center py-4">
              <svg className="animate-spin h-5 w-5 text-[#008DE4]" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </div>
          ) : dashTip.destination && dashTip.amount ? (
            <div className="flex flex-col items-center gap-2">
              <div className="bg-white p-1.5 sm:p-2 rounded-lg max-w-[120px] w-full mx-auto">
                <QRCodeSVG
                  value={`dash:${dashTip.destination}?amount=${dashTip.amount}`}
                  size={112}
                  level="M"
                  style={{ width: "100%", height: "auto", display: "block" }}
                />
              </div>
              <p className="text-sm font-bold text-white">{dashTip.amount} DASH</p>

              {/* Compact countdown */}
              <p className={`text-[10px] font-mono tabular-nums ${
                dashTipSecondsLeft <= 60
                  ? "text-red-400"
                  : dashTipSecondsLeft <= 300
                  ? "text-orange-400"
                  : "text-pnp-textSecondary"
              }`}>
                {String(Math.floor(dashTipSecondsLeft / 60)).padStart(2, "0")}:{String(dashTipSecondsLeft % 60).padStart(2, "0")} remaining
              </p>

              <div
                className="w-full flex items-center gap-1.5 rounded-lg px-2 py-1.5"
                style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}
              >
                <code className="flex-1 text-[9px] text-white/70 break-all font-mono">{dashTip.destination}</code>
                <button
                  onClick={() => {
                    const text = dashTip.destination!;
                    if (navigator.clipboard?.writeText) {
                      navigator.clipboard.writeText(text).catch(() => {});
                    } else {
                      const ta = document.createElement("textarea");
                      ta.value = text;
                      ta.style.position = "fixed";
                      ta.style.opacity = "0";
                      document.body.appendChild(ta);
                      ta.select();
                      document.execCommand("copy");
                      document.body.removeChild(ta);
                    }
                    setDashTipCopied(true);
                    setTimeout(() => setDashTipCopied(false), 2000);
                  }}
                  className="flex-shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded"
                  style={{ color: dashTipCopied ? "#34C759" : "#008DE4" }}
                >
                  {dashTipCopied ? "Copied!" : "Copy"}
                </button>
              </div>
              <a
                href={dashTip.checkoutUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] hover:underline"
                style={{ color: "#008DE4" }}
              >
                Open in BTCPay
              </a>
            </div>
          ) : (
            <a
              href={dashTip.checkoutUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full text-center py-2 rounded-lg bg-[#008DE4] text-white text-xs font-semibold"
            >
              Open Dash Checkout
            </a>
          )}
        </div>
      )}

      {/* Recent tips */}
      {recentTips.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
          {recentTips.map((tip) => (
            <div key={tip.id} className="flex-shrink-0 px-2.5 py-1 rounded-full bg-pnp-surface border border-pnp-border text-[10px]">
              <span className="text-gradient font-medium">${tip.amount}</span>
              <span className="text-pnp-textSecondary mx-1">by</span>
              <span className="text-pnp-textPrimary">@{tip.user_username}</span>
              <span className="text-pnp-textSecondary/50 ml-1">{formatTimeAgo(tip.created_at)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Live Chat — collapsible on mobile (improvement #6) */}
      <Card>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-medium text-pnp-textPrimary">{t.live.liveChatTitle}</h3>
            <span className={`flex items-center gap-1 text-[10px] ${chatConnected ? "text-pnp-textSecondary" : "text-pnp-textSecondary/50"}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${chatConnected ? "bg-green-500" : "bg-pnp-textSecondary/30"}`} />
              {chatConnected ? t.live.chatConnected : t.live.chatConnecting}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {socketError && <span className="text-[10px] text-pnp-error">{socketError}</span>}
            {/* Collapse toggle — always visible on mobile, available on desktop too */}
            <button
              onClick={() => setIsChatCollapsed((v) => !v)}
              className="p-1 rounded-lg text-pnp-textSecondary hover:text-pnp-textPrimary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent"
              aria-label={isChatCollapsed ? "Expand chat" : "Collapse chat"}
            >
              <svg
                className={`w-4 h-4 transition-transform duration-200 ${isChatCollapsed ? "rotate-180" : ""}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          </div>
        </div>

        {!isChatCollapsed && (
          <>
            <div className="relative">
              {hasNewMessages && (
                <button
                  onClick={scrollToBottom}
                  className="absolute -top-2 left-1/2 -translate-x-1/2 z-10 px-3 py-1 rounded-full bg-pnp-accent text-white text-[10px] font-semibold shadow-lg"
                >
                  New messages
                </button>
              )}
              {chatMessages.length === 0 ? (
                <div className="h-48 flex items-center justify-center mb-2">
                  <p className="text-[10px] text-pnp-textSecondary text-center">
                    {chatConnected ? t.live.beFirstToChat : t.live.connectingToChat}
                  </p>
                </div>
              ) : (
                <ChatMessageList
                  messages={chatMessages.slice(-50)}
                  listRef={chatListRef}
                  containerRef={chatContainerRef}
                  isOwner={isStreamOwner}
                  onBan={isStreamOwner ? handleBanUser : undefined}
                />
              )}
              <div ref={chatEndRef} />
            </div>

            {isAuthenticated ? (
              chatBanned ? (
                <p className="text-[10px] text-red-400 text-center py-1">
                  You are banned from this stream's chat.
                </p>
              ) : (
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Type a message..."
                    aria-label="Type a chat message"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        submitChat();
                      }
                    }}
                    maxLength={500}
                    className="flex-1 rounded-lg bg-pnp-surface border border-pnp-border px-3 py-1.5 text-xs text-pnp-textPrimary placeholder-pnp-textSecondary focus:outline-none focus:ring-2 focus:ring-pnp-accent"
                  />
                  <button
                    onClick={submitChat}
                    disabled={!chatInput.trim()}
                    className="px-3 py-1.5 rounded-lg btn-gradient text-white text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Send
                  </button>
                </div>
              )
            ) : (
              <button onClick={login} className="text-xs text-pnp-accent hover:underline">
                {t.live.logInToChat}
              </button>
            )}
          </>
        )}
      </Card>

      {/* Close paywall fragment gate */}
      </>)}

      </div>

      <BuyTokensModal
        isOpen={showTopUp}
        onClose={() => setShowTopUp(false)}
        onSuccess={(newBalance) => setTokenBalance(newBalance)}
      />
      {showTutorial && !rulesLoading && rulesAcknowledged && (
        <TutorialOverlay section="stream" onDismiss={dismissTutorial} onDismissForever={dismissForever} />
      )}
    </div>
  );
}
