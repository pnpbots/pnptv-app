import React, { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { Card, Skeleton } from "@pnptv/ui-kit";
import { useAuth } from "@/hooks/useAuth";
import { useLiveSocket } from "@/hooks/useLiveSocket";
import { useI18n } from "@/lib/i18n";
import { LivePlayer } from "@/components/LivePlayer";
import { LiveRulesModal } from "@/components/LiveRulesModal";
import { connectSocket } from "@/lib/socket";
import {
  getLiveStreams,
  getAllPerformers,
  sendTip,
  TIP_AMOUNTS,
  getStreamOverlayPublic,
  getLiveRulesStatus,
  acknowledgeLiveRules,
  assertPaymentUrl,
  type LiveStream,
  type RecentTip,
  type StreamOverlay,
  getRecentTips,
} from "@/lib/api";

function extractChannelRef(streamId: string): string | null {
  const match = streamId.match(/restreamer-ui:ingest:([\w-]+)/);
  return match ? match[1] : null;
}

export default function Stream() {
  const { streamId } = useParams<{ streamId: string }>();
  const navigate = useNavigate();
  const t = useI18n();
  const { isAuthenticated, login } = useAuth();

  const [stream, setStream] = useState<LiveStream | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<StreamOverlay | null>(null);

  // Live rules gate — only enforced for authenticated users
  const [rulesAcknowledged, setRulesAcknowledged] = useState(false);
  const [rulesLoading, setRulesLoading] = useState(true);

  // Chat & tips
  const [chatInput, setChatInput] = useState("");
  const [tipPaymentTab, setTipPaymentTab] = useState<"tokens" | "daimo">("tokens");
  const [tipping, setTipping] = useState(false);
  const [tipSubmitting, setTipSubmitting] = useState(false);
  const [tipError, setTipError] = useState<string | null>(null);
  const [tipSuccess, setTipSuccess] = useState<string | null>(null);
  const [recentTips, setRecentTips] = useState<RecentTip[]>([]);
  const [streamError, setStreamError] = useState(false);

  const {
    messages: chatMessages,
    viewerCount: socketViewerCount,
    isConnected: chatConnected,
    reconnecting: chatReconnecting,
    sendMessage,
    latestTip,
    socketError,
  } = useLiveSocket(streamId || null);

  // Viewer count: prefer the real-time socket value; fall back to a polled
  // value from the streams API when the socket is not connected.
  const [polledViewerCount, setPolledViewerCount] = useState(0);
  const viewerCount = chatConnected ? socketViewerCount : polledViewerCount;

  // Share button state
  const [shareCopied, setShareCopied] = useState(false);

  // Load stream info.
  // streamId may be a Restreamer process ID (navigated from Community Live section)
  // or a performer ID like "live-42" / "db-42" (navigated from the performer grid
  // when the backend injects isLive + hlsUrl directly on the performer object).
  const loadStream = useCallback(() => {
    if (!streamId) return Promise.resolve();
    return getLiveStreams()
      .then(async (data) => {
        const found = (data.streams || []).find((s) => s.id === streamId);
        if (found) {
          setStream(found);
          setError(null);
          setStreamError(false);
          return;
        }
        // Not found in the Restreamer stream list — try resolving via the performers
        // endpoint, which injects live users with their own isLive/hlsUrl fields.
        try {
          const perfData = await getAllPerformers();
          const performer = (perfData.performers || []).find(
            (p) => p.id === streamId || (p.userId && String(p.userId) === streamId)
          );
          if (performer && performer.isLive) {
            // Use performer hlsUrl if available; fall back to constructing it
            // from the streams list or the known public URL pattern.
            const hlsUrl =
              performer.hlsUrl ||
              (stream ? stream.hlsUrl : null) ||
              null;
            if (hlsUrl) {
              const syntheticStream: LiveStream = {
                id: performer.id,
                name: performer.displayName,
                description: performer.bio || "",
                hlsUrl,
                isLive: true,
              };
              setStream(syntheticStream);
              setError(null);
              setStreamError(false);
            } else {
              setError(t.live.streamNotFound);
              setStreamError(true);
            }
          } else {
            setError(t.live.streamNotFound);
            setStreamError(true);
          }
        } catch {
          setError(t.live.streamNotFound);
          setStreamError(true);
        }
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load stream");
        setStreamError(true);
      });
  }, [streamId]);

  useEffect(() => {
    setLoading(true);
    loadStream().finally(() => setLoading(false));
    const interval = setInterval(loadStream, 30000);
    return () => clearInterval(interval);
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
    socket.on("overlay:updated", handler);
    return () => {
      socket.off("overlay:updated", handler);
    };
  }, [streamId]);

  // Live rules acknowledgment check — only for authenticated users
  useEffect(() => {
    if (!isAuthenticated) {
      // Unauthenticated users can watch; they'll be prompted to log in when they try to interact
      setRulesLoading(false);
      setRulesAcknowledged(true);
      return;
    }
    setRulesLoading(true);
    getLiveRulesStatus()
      .then((data) => {
        if (data.success) {
          setRulesAcknowledged(data.acknowledged);
        } else {
          // On unexpected API error, fail open so the user isn't permanently blocked
          setRulesAcknowledged(true);
        }
      })
      .catch(() => {
        // Network failure — fail open
        setRulesAcknowledged(true);
      })
      .finally(() => {
        setRulesLoading(false);
      });
  }, [isAuthenticated]);

  const handleAcknowledgeRules = useCallback(async () => {
    try {
      await acknowledgeLiveRules();
    } catch {
      // Persist locally even if the network call fails — the user has seen the rules
      console.warn("[LiveRules] Failed to persist acknowledgment — session may have expired");
    }
    setRulesAcknowledged(true);
  }, []);

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

  const handleTip = async (amount: number) => {
    if (!isAuthenticated) { login(); return; }

    if (tipPaymentTab === "daimo") {
      // For Daimo/USDC tips, create a payment server-side and navigate to the
      // dedicated checkout page in the same tab.  This avoids popup blockers
      // and gives the user the full Daimo embedded modal UX.
      setTipping(true);
      setTipSubmitting(true);
      setTipError(null);
      setTipSuccess(null);
      try {
        const result = await sendTip(streamId || "", amount, undefined, "daimo");
        if (result.paymentUrl) {
          // Open checkout in new tab so user stays on the live stream
          window.open(new URL(assertPaymentUrl(result.paymentUrl)).pathname, "_blank", "noopener,noreferrer");
        } else {
          // Backend returned success but no URL — treat as immediate success
          // (e.g. the tip was credited via a pre-funded balance).
          setTipSuccess(t.live.tipSuccess);
          setTimeout(() => setTipSuccess(null), 3000);
        }
      } catch (err) {
        setTipError(err instanceof Error ? err.message : t.live.tipFailed);
      } finally {
        setTipping(false);
        setTipSubmitting(false);
      }
      return;
    }

    // Token tip — fire directly.
    setTipping(true);
    setTipSubmitting(true);
    setTipError(null);
    setTipSuccess(null);
    try {
      await sendTip(streamId || "", amount, undefined, "tokens");
      setTipSuccess(t.live.tipSuccess);
      setTimeout(() => setTipSuccess(null), 3000);
    } catch (err) {
      setTipError(err instanceof Error ? err.message : t.live.tipFailed);
    } finally {
      setTipping(false);
      setTipSubmitting(false);
    }
  };

  const chatEndRef = React.useRef<HTMLDivElement>(null);
  const chatContainerRef = React.useRef<HTMLDivElement>(null);
  const [hasNewMessages, setHasNewMessages] = useState(false);
  const videoContainerRef = React.useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Chat collapsed by default on mobile (improvement #6)
  const [isChatCollapsed, setIsChatCollapsed] = useState(
    () => window.innerWidth < 768
  );

  const isNearBottom = () => {
    const el = chatContainerRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  useEffect(() => {
    if (isNearBottom()) {
      chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
      setHasNewMessages(false);
    } else {
      setHasNewMessages(true);
    }
  }, [chatMessages]);

  const scrollToBottom = () => {
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
    try {
      await navigator.clipboard.writeText(url);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
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
    const diff = Date.now() - new Date(dateStr).getTime();
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
        <button onClick={() => navigate("/live")} className="text-sm text-pnp-accent hover:underline">
          {t.live.backToLive}
        </button>
      </div>
    );
  }

  return (
    <div className="page-container space-y-3">
      <Helmet>
        <title>{stream.name} — PNPtv Live</title>
        <meta name="description" content={stream.description || `Watch ${stream.name} live on PNPtv`} />
      </Helmet>

      {/* Rules acknowledgment gate — shown to authenticated users who have not yet agreed */}
      {!rulesAcknowledged && (
        <LiveRulesModal onAcknowledge={handleAcknowledgeRules} />
      )}

      {/* Back link + share */}
      <div className="flex items-center justify-between">
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
        </div>
      </div>

      {/* Video Player */}
      <div ref={videoContainerRef} className="relative -mx-4 sm:-mx-6">
        <LivePlayer src={stream.hlsUrl} title={stream.name} overlay={overlay} />
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
            <span className="text-sm text-white font-medium">{stream.name}</span>
          </div>
          {stream.description && (
            <p className="text-xs text-white/60 mt-1">{stream.description}</p>
          )}
        </div>
      </div>

      {/* Reconnecting indicator — shown when socket drops and is attempting to reconnect */}
      {chatReconnecting && !chatConnected && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-pnp-surface border border-pnp-border" aria-live="polite">
          <span className="w-3 h-3 border border-pnp-textSecondary border-t-transparent rounded-full animate-spin flex-shrink-0" />
          <span className="text-[10px] text-pnp-textSecondary">Reconnecting to live chat...</span>
        </div>
      )}

      {/* Tip bar */}
      <div className="flex items-center gap-2">
        <div className="flex gap-1.5 flex-1 overflow-x-auto">
          {TIP_AMOUNTS.map((amount) => (
            <button
              key={amount}
              onClick={() => handleTip(amount)}
              disabled={tipping}
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
          <button
            onClick={() => setTipPaymentTab(tipPaymentTab === "tokens" ? "daimo" : "tokens")}
            className="flex-shrink-0 px-2 py-1.5 rounded-lg text-[10px] font-medium bg-pnp-surface border border-pnp-border text-pnp-textSecondary hover:border-pnp-accent/40 transition-colors"
          >
            {tipPaymentTab === "tokens" ? "T" : "$"}
          </button>
        )}
      </div>
      {tipError && <p className="text-[10px] text-pnp-error">{tipError}</p>}
      {tipSuccess && <p className="text-[10px] text-gradient">{tipSuccess}</p>}

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
              <div ref={chatContainerRef} className="h-48 overflow-y-auto space-y-1 mb-2 pr-1" style={{ scrollbarWidth: "thin" }}>
                {chatMessages.length === 0 ? (
                  <p className="text-[10px] text-pnp-textSecondary text-center py-4">
                    {chatConnected ? t.live.beFirstToChat : t.live.connectingToChat}
                  </p>
                ) : (
                  chatMessages.map((msg) => (
                    <div key={msg.id} className="text-xs">
                      <span className="font-medium text-gradient">@{msg.username}</span>
                      <span className="text-pnp-textSecondary mx-1">·</span>
                      <span className="text-pnp-textPrimary">{msg.content}</span>
                    </div>
                  ))
                )}
                <div ref={chatEndRef} />
              </div>
            </div>

            {isAuthenticated ? (
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Type a message..."
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && chatInput.trim()) {
                      sendMessage(chatInput.trim());
                      setChatInput("");
                    }
                  }}
                  maxLength={500}
                  className="flex-1 rounded-lg bg-pnp-surface border border-pnp-border px-3 py-1.5 text-xs text-pnp-textPrimary placeholder-pnp-textSecondary focus:outline-none focus:ring-2 focus:ring-pnp-accent"
                />
                <button
                  onClick={() => {
                    if (chatInput.trim()) {
                      sendMessage(chatInput.trim());
                      setChatInput("");
                    }
                  }}
                  className="px-3 py-1.5 rounded-lg btn-gradient text-white text-xs font-medium"
                >
                  Send
                </button>
              </div>
            ) : (
              <button onClick={login} className="text-xs text-pnp-accent hover:underline">
                {t.live.logInToChat}
              </button>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
