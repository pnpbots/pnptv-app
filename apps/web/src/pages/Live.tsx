import React, { useState, useEffect, useCallback, useRef } from "react";
import { Helmet } from "react-helmet-async";
import { LivePlayer } from "@/components/LivePlayer";
import { Card, Badge, Skeleton, Button } from "@pnptv/ui-kit";
import { useAuth } from "@/hooks/useAuth";
import { useTutorial } from "@/hooks/useTutorial";
import { TutorialOverlay } from "@/components/tutorial/TutorialOverlay";
import { useLiveSocket } from "@/hooks/useLiveSocket";
import { useI18n } from "@/lib/i18n";
import {
  getLiveStreams,
  getAllPerformers,
  getRecentTips,
  sendTip,
  getRtmpKey,
  getWalletBalance,
  getTokenPackages,
  buyTokens,
  linkDPNS,
  getWalletHistory,
  TIP_AMOUNTS,
  type LiveStream,
  type FeaturedPerformer,
  type RecentTip,
  type TokenPackage,
  type TokenPurchase,
} from "@/lib/api";

const CALCOM_URL = import.meta.env.VITE_CALCOM_URL || "https://booking.pnptv.app";

const ALLOWED_IMAGE_HOSTS = ["cms.pnptv.app", "app.pnptv.app", "pnptv.app"];
function isValidPhotoUrl(photo: string | null | undefined): photo is string {
  if (!photo) return false;
  if (photo.startsWith("/")) return true;
  try {
    const url = new URL(photo);
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      ALLOWED_IMAGE_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`))
    );
  } catch {
    return false;
  }
}

export default function Live() {
  const { isAuthenticated, login, user } = useAuth();
  const t = useI18n();
  const isCreator = isAuthenticated && (user?.role === "admin" || user?.role === "superadmin" || user?.role === "creator");
  const { showTutorial, dismissTutorial } = useTutorial("live");

  const [streams, setStreams] = useState<LiveStream[]>([]);
  const [activeStream, setActiveStream] = useState<LiveStream | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Performers
  const [performers, setPerformers] = useState<FeaturedPerformer[]>([]);
  const [performersLoading, setPerformersLoading] = useState(true);

  // Tips
  const [recentTips, setRecentTips] = useState<RecentTip[]>([]);
  const [selectedPerformer, setSelectedPerformer] = useState<FeaturedPerformer | null>(null);
  const [tipMessage, setTipMessage] = useState("");
  const [showTipMessage, setShowTipMessage] = useState(false);
  const [tipping, setTipping] = useState(false);
  const [tipError, setTipError] = useState<string | null>(null);
  const [tipSuccess, setTipSuccess] = useState<string | null>(null);
  const [tipPaymentTab, setTipPaymentTab] = useState<"daimo" | "tokens">("tokens");

  // Dash token wallet
  const [tokenBalance, setTokenBalance] = useState<number | null>(null);
  const [dpnsHandle, setDpnsHandle] = useState<string | null>(null);
  const [showBuyModal, setShowBuyModal] = useState(false);
  const [tokenPackages, setTokenPackages] = useState<TokenPackage[]>([]);
  const [buyingPackage, setBuyingPackage] = useState<string | null>(null);
  const [showDpnsInput, setShowDpnsInput] = useState(false);
  const [dpnsInput, setDpnsInput] = useState("");
  const [dpnsSaving, setDpnsSaving] = useState(false);
  const [buyError, setBuyError] = useState<string | null>(null);

  // Wallet history
  const [showWalletHistory, setShowWalletHistory] = useState(false);
  const [walletHistory, setWalletHistory] = useState<TokenPurchase[]>([]);
  const [walletHistoryLoading, setWalletHistoryLoading] = useState(false);

  // Booking
  const [showBooking, setShowBooking] = useState(false);
  const [bookingLoaded, setBookingLoaded] = useState(false);

  // Chat toggle
  const [showChat, setShowChat] = useState(true);

  // Go Live
  const [showGoLive, setShowGoLive] = useState(false);
  const [rtmpInfo, setRtmpInfo] = useState<{ rtmpUrl: string; streamKey: string } | null>(null);
  const [goLiveLoading, setGoLiveLoading] = useState(false);
  const [goLiveError, setGoLiveError] = useState<string | null>(null);
  const [showStreamKey, setShowStreamKey] = useState(false);

  // Live chat
  const [chatInput, setChatInput] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Socket
  const {
    messages: chatMessages,
    viewerCount,
    isConnected: chatConnected,
    sendMessage,
    latestTip,
    walletBalance: socketBalance,
    socketError,
  } = useLiveSocket(activeStream?.id ?? null);

  // Load streams + auto-refresh every 30s
  const loadStreams = useCallback(() => {
    return getLiveStreams()
      .then((data) => {
        const liveStreams = data.streams || [];
        setStreams(liveStreams);
        setActiveStream((prev) => {
          // Keep selection if stream still exists; pick first live stream otherwise
          if (prev) {
            const still = liveStreams.find((s) => s.id === prev.id);
            if (still) return still;
          }
          const live = liveStreams.find((s) => s.isLive);
          if (live) return live;
          return liveStreams.length > 0 ? liveStreams[0] : null;
        });
        setError(null);
      })
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    setIsLoading(true);
    loadStreams().finally(() => setIsLoading(false));
    const interval = setInterval(loadStreams, 30000);
    return () => clearInterval(interval);
  }, [loadStreams]);

  // Load performers
  useEffect(() => {
    setPerformersLoading(true);
    getAllPerformers()
      .then((data) => {
        const p = data.performers || [];
        setPerformers(p);
        if (p.length > 0 && !selectedPerformer) {
          setSelectedPerformer(p[0]);
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load performers"))
      .finally(() => setPerformersLoading(false));
  }, []);

  // Load wallet balance + packages when authenticated
  useEffect(() => {
    if (!isAuthenticated) return;
    getWalletBalance()
      .then((data) => {
        setTokenBalance(data.balance);
        setDpnsHandle(data.dpnsHandle);
      })
      .catch(() => {});
    getTokenPackages()
      .then((data) => setTokenPackages(data.packages || []))
      .catch(() => {});
  }, [isAuthenticated]);

  // Sync socket-pushed balance updates
  useEffect(() => {
    if (socketBalance !== null) setTokenBalance(socketBalance);
  }, [socketBalance]);

  // Load recent tips
  const loadTips = useCallback(() => {
    getRecentTips(5)
      .then((data) => setRecentTips(data.tips || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadTips();
    const interval = setInterval(loadTips, 15000);
    return () => clearInterval(interval);
  }, [loadTips]);

  // Push socket-confirmed tips to front of recentTips
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
    setRecentTips((prev) => {
      const next = [mapped, ...prev.filter((t) => t.id !== mapped.id)].slice(0, 5);
      return next;
    });
  }, [latestTip]);

  // Auto-scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  const handleTip = async (amount: number) => {
    if (!isAuthenticated) { login(); return; }
    if (!selectedPerformer) { setTipError(t.live.selectPerformerError); return; }
    if (tipPaymentTab === "tokens" && tokenBalance !== null && tokenBalance < amount) {
      setTipError(t.live.insufficientTokens(tokenBalance));
      setShowBuyModal(true);
      return;
    }
    setTipping(true);
    setTipError(null);
    setTipSuccess(null);
    try {
      const result = await sendTip(selectedPerformer.id, amount, tipMessage || undefined, tipPaymentTab);
      if (tipPaymentTab === "tokens") {
        if (result.newBalance !== undefined) setTokenBalance(result.newBalance);
        setTipSuccess(t.live.tokensSentSuccess(amount, selectedPerformer.displayName));
      } else if (result.paymentUrl) {
        window.open(result.paymentUrl, "_blank", "noopener,width=500,height=700");
        setTipSuccess(t.live.paymentWindowOpened(amount));
      } else {
        setTipSuccess(t.live.tipSubmitted(amount));
      }
      setTipMessage("");
      setShowTipMessage(false);
      setTimeout(loadTips, 3000);
    } catch (err: unknown) {
      setTipError(err instanceof Error ? err.message : t.live.errorFailedToSendTip);
    } finally {
      setTipping(false);
    }
  };

  const handleBuyTokens = async (pkg: TokenPackage) => {
    setBuyingPackage(pkg.id);
    setBuyError(null);
    try {
      const result = await buyTokens(pkg.id);
      window.open(result.checkoutUrl, "_blank", "noopener,width=600,height=800");
      setShowBuyModal(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("not available") || msg.includes("not configured")) {
        setBuyError(t.live.errorDashUnavailable);
      } else if (msg.includes("temporarily unavailable")) {
        setBuyError(t.live.errorPaymentServerDown);
      } else {
        setBuyError(msg || t.live.errorFailedToOpenCheckout);
      }
    } finally {
      setBuyingPackage(null);
    }
  };

  const handleSaveDpns = async () => {
    if (!dpnsInput.trim()) return;
    setDpnsSaving(true);
    try {
      const result = await linkDPNS(dpnsInput.trim());
      setDpnsHandle(result.dpnsHandle);
      setShowDpnsInput(false);
      setDpnsInput("");
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : t.live.invalidDpnsHandle);
    } finally {
      setDpnsSaving(false);
    }
  };

  const handleGoLive = async () => {
    setGoLiveLoading(true);
    setGoLiveError(null);
    try {
      const result = await getRtmpKey();
      if (result.success && result.rtmpUrl && result.streamKey) {
        setRtmpInfo({ rtmpUrl: result.rtmpUrl, streamKey: result.streamKey });
        setShowGoLive(true);
      } else {
        setGoLiveError(result.error || t.live.errorStreamingUnavailable);
      }
    } catch (err: unknown) {
      setGoLiveError(err instanceof Error ? err.message : t.live.errorFailedToLoadCredentials);
    } finally {
      setGoLiveLoading(false);
    }
  };

  const handleLoadWalletHistory = async () => {
    if (walletHistoryLoading) return;
    setWalletHistoryLoading(true);
    try {
      const data = await getWalletHistory();
      setWalletHistory(data.history || []);
    } catch {
      // ignore
    } finally {
      setWalletHistoryLoading(false);
    }
  };

  const openWalletHistory = () => {
    setShowWalletHistory(true);
    handleLoadWalletHistory();
  };

  const formatTimeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return t.live.justNow;
    if (mins < 60) return t.live.minutesAgo(mins);
    const hours = Math.floor(mins / 60);
    if (hours < 24) return t.live.hoursAgo(hours);
    return t.live.daysAgo(Math.floor(hours / 24));
  };

  return (
    <div className="page-container">
      <Helmet>
        <title>{t.live.pageTitle}</title>
        <meta name="description" content={t.live.pageDescription} />
      </Helmet>
      {showTutorial && <TutorialOverlay section="live" onDismiss={dismissTutorial} />}

      {/* ── Hero Stream Section ── */}
      <div className="relative -mx-4 -mt-6 sm:-mx-6 sm:-mt-6">
        {/* Player area */}
        {isLoading ? (
          <Skeleton className="w-full aspect-video" />
        ) : activeStream ? (
          <div className="relative">
            <LivePlayer src={activeStream.hlsUrl} className="rounded-none" />

            {/* Overlay controls on top of player */}
            <div className="absolute top-3 right-3 flex items-center gap-2 z-10">
              {isCreator && (
                <button
                  onClick={handleGoLive}
                  disabled={goLiveLoading}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-black/60 backdrop-blur-sm border border-white/10 hover:bg-black/80 disabled:opacity-50 transition-all"
                >
                  <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                  {goLiveLoading ? t.live.goLiveLoading : t.live.goLive}
                </button>
              )}
              <button
                onClick={loadStreams}
                className="p-1.5 rounded-lg bg-black/60 backdrop-blur-sm border border-white/10 text-white/70 hover:text-white transition-colors"
                title={t.live.refreshStreams}
                aria-label={t.live.refreshStreams}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
            </div>

            {/* Bottom info bar overlaid on player */}
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent px-4 pb-3 pt-10">
              <div className="flex items-center gap-2 flex-wrap">
                {activeStream.isLive && (
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                    <span className="text-xs font-semibold text-white">{t.live.statusLive}</span>
                  </span>
                )}
                {viewerCount > 0 && (
                  <span className="flex items-center gap-1 text-xs text-white/70">
                    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z" />
                    </svg>
                    {t.live.watching(viewerCount)}
                  </span>
                )}
                <span className="text-sm text-white font-medium">{activeStream.name}</span>
              </div>
              {activeStream.description && (
                <p className="text-xs text-white/60 mt-1">{activeStream.description}</p>
              )}
            </div>
          </div>
        ) : (
          <div className="relative w-full aspect-video bg-gradient-to-br from-pnp-surface via-black to-pnp-surface">
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <svg className="w-12 h-12 text-white/20 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              <p className="text-white/40 text-sm font-medium">{t.live.noStreamsAvailable}</p>
              <p className="text-white/25 text-xs mt-1">{t.live.noStreamsHint}</p>
            </div>

            {/* Overlay controls */}
            <div className="absolute top-3 right-3 flex items-center gap-2">
              {isCreator && (
                <button
                  onClick={handleGoLive}
                  disabled={goLiveLoading}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white btn-gradient disabled:opacity-50 transition-all"
                >
                  <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
                  {goLiveLoading ? t.live.goLiveLoading : t.live.goLive}
                </button>
              )}
              <button
                onClick={loadStreams}
                className="p-1.5 rounded-lg bg-black/40 text-white/50 hover:text-white transition-colors"
                title={t.live.refreshStreams}
                aria-label={t.live.refreshStreams}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
            </div>

            {/* Featured performers carousel at bottom of offline hero */}
            {performers.length > 0 && (
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent px-4 pb-3 pt-8">
                <div className="flex gap-3 overflow-x-auto pb-1">
                  {performers.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setSelectedPerformer(p)}
                      className="flex flex-col items-center flex-shrink-0 group"
                    >
                      <div className={`w-12 h-12 rounded-full overflow-hidden border-2 transition-colors ${selectedPerformer?.id === p.id ? "border-pnp-accent" : "border-white/20 group-hover:border-white/40"}`}>
                        <img
                          src={isValidPhotoUrl(p.photoUrl) ? p.photoUrl : "/default-performer.svg"}
                          alt={p.displayName}
                          className="w-full h-full object-cover"
                          onError={(e) => { (e.target as HTMLImageElement).src = "/default-performer.svg"; }}
                        />
                      </div>
                      <span className="text-[10px] text-white/70 mt-1 max-w-[60px] truncate">{p.displayName}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        {goLiveError && (
          <p className="text-[10px] text-pnp-error text-center mt-1 px-4">{goLiveError}</p>
        )}
      </div>

      {/* ── Performer selector + Tip bar (compact, right below stream) ── */}
      <div className="mt-3">
        {/* Performer pills */}
        {performers.length > 0 && (
          <div className="flex gap-2 mb-2 overflow-x-auto pb-1 -mx-1 px-1">
            {performers.map((p) => (
              <button
                key={p.id}
                onClick={() => setSelectedPerformer(p)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs whitespace-nowrap transition-colors ${
                  selectedPerformer?.id === p.id
                    ? "badge-gradient text-white"
                    : "bg-pnp-surface border border-pnp-border text-pnp-textSecondary hover:border-pnp-accent/40"
                }`}
              >
                {isValidPhotoUrl(p.photoUrl) ? (
                  <img
                    src={p.photoUrl}
                    alt={`${p.displayName}'s avatar`}
                    className="w-4 h-4 rounded-full object-cover"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                ) : (
                  <span className="w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold" style={{ background: "linear-gradient(135deg, #D4007A, #E69138)", color: "#fff" }}>
                    {p.displayName.charAt(0)}
                  </span>
                )}
                {p.displayName}
              </button>
            ))}
          </div>
        )}

        {/* Tip buttons — always visible, compact */}
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5 flex-1 overflow-x-auto">
            {TIP_AMOUNTS.map((amount) => (
              <button
                key={amount}
                onClick={() => handleTip(amount)}
                disabled={tipping}
                className="px-3 py-1.5 rounded-lg font-semibold text-xs transition-all text-white active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed btn-gradient whitespace-nowrap"
              >
                {tipPaymentTab === "tokens" ? `${amount}T` : `$${amount}`}
              </button>
            ))}
          </div>
          {/* Payment method toggle */}
          {isAuthenticated && (
            <button
              onClick={() => setTipPaymentTab(tipPaymentTab === "tokens" ? "daimo" : "tokens")}
              className="flex-shrink-0 px-2 py-1.5 rounded-lg text-[10px] font-medium bg-pnp-surface border border-pnp-border text-pnp-textSecondary hover:border-pnp-accent/40 transition-colors"
              title={tipPaymentTab === "tokens" ? t.live.tabDaimoCrypto : t.live.tabTokens}
            >
              {tipPaymentTab === "tokens" ? "T" : "$"}
            </button>
          )}
          {/* Chat toggle */}
          {activeStream && (
            <button
              onClick={() => setShowChat(!showChat)}
              className={`flex-shrink-0 p-1.5 rounded-lg border transition-colors ${showChat ? "bg-pnp-accent/20 border-pnp-accent/40 text-pnp-accent" : "bg-pnp-surface border-pnp-border text-pnp-textSecondary hover:border-pnp-accent/40"}`}
              title={t.live.liveChatTitle}
              aria-label={t.live.liveChatTitle}
              aria-pressed={showChat}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </button>
          )}
        </div>
        {selectedPerformer && (
          <p className="text-[10px] text-gradient mt-1">{t.live.tipTo(selectedPerformer.displayName)}</p>
        )}
        {tipError && <p className="text-[10px] text-pnp-error mt-1">{tipError}</p>}
        {tipSuccess && <p className="text-[10px] mt-1 text-gradient">{tipSuccess}</p>}
        {!isAuthenticated && (
          <p className="text-[10px] text-pnp-textSecondary mt-1">{t.live.loginToTip}</p>
        )}

        {/* Tip message input (expandable) */}
        <button
          onClick={() => setShowTipMessage(!showTipMessage)}
          className="text-[10px] text-pnp-textSecondary mt-1 hover:text-pnp-accent transition-colors"
        >
          {showTipMessage ? t.live.hideMessage : t.live.addAMessage}
        </button>
        {showTipMessage && (
          <input
            type="text"
            placeholder={t.live.tipMessagePlaceholder}
            value={tipMessage}
            onChange={(e) => setTipMessage(e.target.value)}
            maxLength={200}
            className="w-full mt-1 rounded-lg bg-pnp-surface border border-pnp-border px-3 py-1.5 text-xs text-pnp-textPrimary placeholder-pnp-textSecondary focus:outline-none focus:ring-2 focus:ring-pnp-accent"
          />
        )}
      </div>

      {/* ── Live Chat (collapsible) ── */}
      {activeStream && showChat && (
        <Card className="mt-3">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-medium text-pnp-textPrimary">{t.live.liveChatTitle}</h3>
              <span className={`flex items-center gap-1 text-[10px] ${chatConnected ? "text-pnp-textSecondary" : "text-pnp-textSecondary/50"}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${chatConnected ? "bg-green-500" : "bg-pnp-textSecondary/30"}`} />
                {chatConnected ? t.live.chatConnected : t.live.chatConnecting}
              </span>
            </div>
            {socketError && <span className="text-[10px] text-pnp-error">{socketError}</span>}
          </div>

          <div className="h-36 overflow-y-auto space-y-1 mb-2 pr-1" style={{ scrollbarWidth: "thin" }}>
            {chatMessages.length === 0 ? (
              <p className="text-[10px] text-pnp-textSecondary text-center py-4">
                {chatConnected ? t.live.chatBeFirstToSay : t.live.chatConnectingToChat}
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

          {isAuthenticated ? (
            <div className="flex gap-2">
              <input
                type="text"
                placeholder={t.live.saySomething}
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
                aria-label={t.live.sendChatMessage}
              >
                {t.live.send}
              </button>
            </div>
          ) : (
            <button onClick={login} className="text-xs text-pnp-accent hover:underline">
              {t.live.loginToChat}
            </button>
          )}
        </Card>
      )}

      {/* ── Recent Tips Ticker ── */}
      {recentTips.length > 0 && (
        <div className="mt-3 mb-4">
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
            {recentTips.map((tip) => (
              <div key={tip.id} className="flex-shrink-0 px-2.5 py-1 rounded-full bg-pnp-surface border border-pnp-border text-[10px]">
                <span className="text-gradient font-medium">${tip.amount}</span>
                <span className="text-pnp-textSecondary mx-1">{t.live.recentTipBy}</span>
                <span className="text-pnp-textPrimary">@{tip.user_username}</span>
                <span className="text-pnp-textSecondary/50 ml-1">{formatTimeAgo(tip.created_at)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Wallet (compact) ── */}
      {isAuthenticated && (
        <div className="flex items-center justify-between py-2 border-t border-white/5 mt-2">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: "#008CE7" }}>
              <svg viewBox="0 0 24 24" className="w-3 h-3 fill-white">
                <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm1.5 14.5h-3v-2h3c.828 0 1.5-.672 1.5-1.5S14.328 11 13.5 11H10V9h3.5c1.933 0 3.5 1.567 3.5 3.5S15.433 16 13.5 16.5z"/>
              </svg>
            </div>
            <span className="text-xs font-semibold text-pnp-textPrimary">
              {tokenBalance === null ? "—" : `${tokenBalance} ${t.live.tokens}`}
            </span>
            {dpnsHandle && (
              <span className="text-[10px] text-pnp-textSecondary">@{dpnsHandle}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {!dpnsHandle && (
              <button onClick={() => setShowDpnsInput(!showDpnsInput)} className="text-[10px] text-pnp-textSecondary hover:text-pnp-accent transition-colors">
                {t.live.linkDpns}
              </button>
            )}
            <button onClick={openWalletHistory} className="text-[10px] text-pnp-textSecondary hover:text-pnp-accent transition-colors">
              {t.live.history}
            </button>
            <button onClick={() => { setBuyError(null); setShowBuyModal(true); }} className="px-2 py-1 rounded-md text-[10px] font-semibold text-white btn-gradient">
              {t.live.buyTokens}
            </button>
          </div>
        </div>
      )}
      {isAuthenticated && showDpnsInput && (
        <div className="flex gap-2 mb-2">
          <input
            type="text"
            placeholder={t.live.dpnsPlaceholder}
            value={dpnsInput}
            onChange={(e) => setDpnsInput(e.target.value)}
            className="flex-1 rounded-lg bg-pnp-surface border border-pnp-border px-3 py-1.5 text-xs text-pnp-textPrimary placeholder-pnp-textSecondary focus:outline-none focus:ring-2 focus:ring-pnp-accent"
          />
          <button onClick={handleSaveDpns} disabled={dpnsSaving} className="px-3 py-1.5 rounded-lg btn-gradient text-white text-xs font-medium disabled:opacity-50">
            {dpnsSaving ? t.live.saving : t.live.save}
          </button>
        </div>
      )}

      {/* ── Stream list (if multiple) ── */}
      {streams.length > 1 && (
        <div className="mt-3">
          <h2 className="text-xs font-medium text-pnp-textSecondary uppercase tracking-wider mb-2">{t.live.allStreams}</h2>
          <div className="space-y-1.5 mb-4">
            {streams.map((stream) => (
              <button
                key={stream.id}
                onClick={() => setActiveStream(stream)}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg border transition-colors ${activeStream?.id === stream.id ? "border-pnp-accent bg-pnp-accent/5" : "border-pnp-border bg-pnp-surface hover:border-pnp-accent/30"}`}
              >
                <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${stream.isLive ? "bg-red-500 animate-pulse" : "bg-pnp-textSecondary/30"}`} />
                <span className="text-sm text-pnp-textPrimary font-medium flex-1 text-left truncate">{stream.name}</span>
                <span className={`text-[10px] font-semibold ${stream.isLive ? "text-red-400" : "text-pnp-textSecondary"}`}>
                  {stream.isLive ? t.live.statusLive : t.live.statusOffline}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Performers Grid ── */}
      {!performersLoading && performers.length > 0 && (
        <div className="mt-3">
          <h2 className="text-xs font-medium text-pnp-textSecondary uppercase tracking-wider mb-2">{t.live.performers}</h2>
          <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
            {performers.map((p) => (
              <button
                key={p.id}
                onClick={() => setSelectedPerformer(p)}
                className={`flex flex-col items-center flex-shrink-0 p-2 rounded-xl border transition-colors min-w-[80px] ${selectedPerformer?.id === p.id ? "border-pnp-accent bg-pnp-accent/5" : "border-pnp-border bg-pnp-surface hover:border-pnp-accent/30"}`}
              >
                <img
                  src={isValidPhotoUrl(p.photoUrl) ? p.photoUrl : "/default-performer.svg"}
                  alt={p.displayName}
                  className="w-12 h-12 rounded-full object-cover mb-1.5"
                  onError={(e) => { (e.target as HTMLImageElement).src = "/default-performer.svg"; }}
                />
                <span className="text-xs font-medium text-pnp-textPrimary truncate max-w-[70px]">{p.displayName}</span>
                {p.isFeatured && (
                  <span className="text-[9px] mt-0.5" style={{ color: "#5ED1C4" }}>{t.live.performerFeatured}</span>
                )}
                {selectedPerformer?.id === p.id && (
                  <span className="text-[9px] mt-0.5 text-gradient font-medium">{t.live.performerTipping}</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {performersLoading && (
        <div className="flex gap-3 mt-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="w-20 h-24 rounded-xl flex-shrink-0" />)}
        </div>
      )}

      {error && (
        <p className="text-xs text-pnp-textSecondary mt-4">{t.live.streamServiceUnavailable}</p>
      )}

      {/* Book a Session */}
      <div className="mt-4">
        <button
          onClick={() => setShowBooking(!showBooking)}
          className="w-full flex items-center justify-between py-3 border-t border-white/5"
        >
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-pnp-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <span className="text-sm font-medium text-pnp-textPrimary">{t.live.bookAPrivateSession}</span>
          </div>
          <svg className={`w-4 h-4 text-pnp-textSecondary transition-transform ${showBooking ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {showBooking && (
          <div className="mt-2">
            <div className="flex gap-2 mb-3">
              <Button variant="secondary" size="sm" onClick={() => window.open(CALCOM_URL, "_blank")}>
                {t.live.openFullCalendar}
              </Button>
            </div>
            <div className="embed-frame relative" style={{ minHeight: "500px" }}>
              {!bookingLoaded && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="text-center">
                    <div className="w-8 h-8 border-2 border-pnp-accent border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                    <p className="text-xs text-pnp-textSecondary">{t.live.loadingBooking}</p>
                  </div>
                </div>
              )}
              <iframe
                src={`${CALCOM_URL}?embed=true`}
                className="w-full border-0 rounded-xl"
                style={{ height: "600px", opacity: bookingLoaded ? 1 : 0 }}
                onLoad={() => setBookingLoaded(true)}
                title={t.live.bookingCalendarTitle}
              />
            </div>
            <Card className="mt-3">
              <div className="flex items-start gap-3">
                <svg className="w-4 h-4 text-pnp-accent flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-xs text-pnp-textSecondary">
                  {t.live.sessionTimezoneNote}
                </p>
              </div>
            </Card>
          </div>
        )}
      </div>

      {/* Buy Tokens Modal */}
      {showBuyModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowBuyModal(false)}>
          <div className="w-full max-w-lg bg-pnp-background border border-pnp-border rounded-t-2xl p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: "#008CE7" }}>
                  <svg viewBox="0 0 24 24" className="w-4 h-4 fill-white">
                    <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm1.5 14.5h-3v-2h3c.828 0 1.5-.672 1.5-1.5S14.328 11 13.5 11H10V9h3.5c1.933 0 3.5 1.567 3.5 3.5S15.433 16 13.5 16.5z"/>
                  </svg>
                </div>
                <h2 className="text-base font-bold text-pnp-textPrimary">{t.live.buyPnpTokensTitle}</h2>
              </div>
              <button onClick={() => setShowBuyModal(false)} className="text-pnp-textSecondary hover:text-pnp-textPrimary transition-colors" aria-label="Close">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <p className="text-xs text-pnp-textSecondary mb-4">
              {t.live.buyTokensPoweredBy} <span style={{ color: "#008CE7" }}>Dash InstaSend</span> via BTCPay Server.{" "}
              {t.live.buyTokensRateNote}
            </p>

            {buyError && <p className="text-xs text-pnp-error mb-3">{buyError}</p>}

            {tokenPackages.length === 0 ? (
              <p className="text-sm text-pnp-textSecondary text-center py-6">{t.live.loadingPackages}</p>
            ) : (
              <div className="grid grid-cols-2 gap-2 mb-4">
                {tokenPackages.map((pkg) => (
                  <button
                    key={pkg.id}
                    onClick={() => handleBuyTokens(pkg)}
                    disabled={buyingPackage === pkg.id}
                    className="p-3 rounded-xl border border-pnp-border bg-pnp-surface hover:border-pnp-accent/50 transition-colors text-left disabled:opacity-50"
                  >
                    <p className="text-lg font-bold text-pnp-textPrimary">{pkg.tokens}</p>
                    <p className="text-xs text-pnp-textSecondary">{t.live.tokensLabel}</p>
                    <p className="text-sm font-semibold mt-1" style={{ color: "#008CE7" }}>${pkg.usd}</p>
                    {buyingPackage === pkg.id && (
                      <p className="text-[10px] text-pnp-textSecondary mt-1">{t.live.opening}</p>
                    )}
                  </button>
                ))}
              </div>
            )}

            <div className="flex items-start gap-2 p-3 rounded-lg bg-pnp-surface border border-pnp-border/50">
              <svg className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: "#008CE7" }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-[11px] text-pnp-textSecondary">
                {t.live.buyTokensCheckoutNote}
                {dpnsHandle && t.live.yourDashIdentity(dpnsHandle)}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Wallet History Modal */}
      {showWalletHistory && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowWalletHistory(false)}>
          <div className="w-full max-w-lg bg-pnp-background border border-pnp-border rounded-t-2xl p-6 max-h-[70vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold text-pnp-textPrimary">{t.live.tokenPurchaseHistoryTitle}</h2>
              <button onClick={() => setShowWalletHistory(false)} className="text-pnp-textSecondary hover:text-pnp-textPrimary" aria-label="Close">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="overflow-y-auto flex-1">
              {walletHistoryLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 rounded-lg" />)}
                </div>
              ) : walletHistory.length === 0 ? (
                <p className="text-sm text-pnp-textSecondary text-center py-8">{t.live.noPurchasesYet}</p>
              ) : (
                <div className="space-y-2">
                  {walletHistory.map((h) => (
                    <div key={h.id} className="flex items-center justify-between p-3 rounded-lg bg-pnp-surface border border-pnp-border">
                      <div>
                        <p className="text-sm font-semibold text-pnp-textPrimary">{h.tokens_credited} {t.live.tokensLabel}</p>
                        <p className="text-xs text-pnp-textSecondary">${h.usd_amount} · {new Date(h.created_at).toLocaleDateString()}</p>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${h.status === "settled" ? "bg-green-500/10 text-green-400" : "bg-pnp-surface text-pnp-textSecondary border border-pnp-border"}`}>
                        {h.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Go Live Modal */}
      {showGoLive && rtmpInfo && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowGoLive(false)}>
          <div className="w-full max-w-lg bg-pnp-background border border-pnp-border rounded-t-2xl p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold text-pnp-textPrimary">{t.live.goLiveModalTitle}</h2>
              <button onClick={() => setShowGoLive(false)} className="text-pnp-textSecondary hover:text-pnp-textPrimary transition-colors" aria-label={t.live.closeGoLiveModal}>
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <p className="text-sm text-pnp-textSecondary mb-4">
              {t.live.goLiveCredentialsNote}
            </p>

            <div className="space-y-3">
              <div>
                <label className="text-xs text-pnp-textSecondary uppercase tracking-wider block mb-1">{t.live.rtmpServer}</label>
                <div className="flex items-center gap-2 bg-pnp-surface border border-pnp-border rounded-lg px-3 py-2">
                  <code className="text-sm text-pnp-textPrimary flex-1 break-all">{rtmpInfo.rtmpUrl}</code>
                  <button
                    onClick={() => navigator.clipboard?.writeText(rtmpInfo.rtmpUrl)}
                    className="text-pnp-textSecondary hover:text-pnp-accent flex-shrink-0 transition-colors"
                    aria-label={t.live.copyRtmpUrl}
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  </button>
                </div>
              </div>

              <div>
                <label className="text-xs text-pnp-textSecondary uppercase tracking-wider block mb-1">{t.live.streamKey}</label>
                <div className="flex items-center gap-2 bg-pnp-surface border border-pnp-border rounded-lg px-3 py-2">
                  <code className="text-sm text-pnp-textPrimary flex-1">
                    {showStreamKey ? rtmpInfo.streamKey : "•".repeat(Math.min(rtmpInfo.streamKey.length, 20))}
                  </code>
                  <button
                    onClick={() => setShowStreamKey(!showStreamKey)}
                    className="text-pnp-textSecondary hover:text-pnp-accent flex-shrink-0 transition-colors"
                    aria-label={showStreamKey ? t.live.hideStreamKey : t.live.showStreamKey}
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      {showStreamKey ? (
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 4.411m0 0L21 21" />
                      ) : (
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      )}
                    </svg>
                  </button>
                  <button
                    onClick={() => navigator.clipboard?.writeText(rtmpInfo.streamKey)}
                    className="text-pnp-textSecondary hover:text-pnp-accent flex-shrink-0 transition-colors"
                    aria-label={t.live.copyStreamKey}
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  </button>
                </div>
                <p className="text-xs text-pnp-error mt-1">{t.live.streamKeyWarning}</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
