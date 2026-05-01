import React, { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { Card, Skeleton, Button } from "@pnptv/ui-kit";
import { useAuth } from "@/hooks/useAuth";
import { useTier } from "@/hooks/useTier";
import { useTutorial } from "@/hooks/useTutorial";
import { TutorialOverlay } from "@/components/tutorial/TutorialOverlay";
import { useLiveSocket } from "@/hooks/useLiveSocket";
import { useI18n } from "@/lib/i18n";
import { CreateEventModal } from "@/components/events/CreateEventModal";
import { EventDetailModal } from "@/components/events";
import type { EventItem } from "@/components/events/EventCard";
import { CallPackageCards } from "@/components/creators/CallPackageCards";
import { SpotlightStrip, type SpotlightItem } from "@/components/SpotlightStrip";
import { BuyTokensModal } from "@/components/BuyTokensModal";
import { getUpcomingEvents, getCastingStatus, submitCastingApplication, type CastingStatus } from "@/lib/api";
import {
  getFeaturedPerformers,
  getLiveStreams,
  getWalletBalance,
  getTokenPackages,
  buyTokens,
  buyTokensCard,
  buyTokensWallet,
  linkDPNS,
  getWalletHistory,
  assertPaymentUrl,
  getLiveSchedule,
  subscribeToSlotReminder,
  unsubscribeFromSlotReminder,
  getSlotNotifyStatus,
  listCreatorMedia,
  type FeaturedPerformer,
  type LiveStream,
  type LiveScheduleSlot,
  type TokenPackage,
  type TokenPurchase,
  type CreatorMediaItem,
} from "@/lib/api";
import { PerformerDrawer } from "@/components/live/PerformerDrawer";
import { MainStageLiveBanner } from "@/components/mainstage/MainStageLiveBanner";

const ALLOWED_IMAGE_HOSTS = ["cms.pnptv.app", "app.pnptv.app", "pnptv.app"];
function isValidPhotoUrl(photo: string | null | undefined): photo is string {
  if (!photo) return false;
  if (photo.startsWith("/uploads/")) return true;
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
  const { isAuthenticated, user, login } = useAuth();
  const { isFree } = useTier();
  const t = useI18n();
  const navigate = useNavigate();
  const { showTutorial, dismissTutorial, dismissForever } = useTutorial("live");
  const canCreateLive = isAuthenticated && (user?.role === "model" || user?.role === "creator" || user?.role === "admin" || user?.role === "superadmin");
  const [showCreateEvent, setShowCreateEvent] = useState(false);
  const [liveEvents, setLiveEvents] = useState<EventItem[]>([]);
  const [detailEvent, setDetailEvent] = useState<EventItem | null>(null);

  // Category filtering
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const CATEGORIES = [
    { id: "all", label: "All" },
    { id: "clouds", label: t.live.tagClouds || "Clouds" },
    { id: "slamming", label: t.live.tagSlamming || "Slamming" },
    { id: "kinks", label: t.live.tagKinks || "Kinks" },
    { id: "chill", label: t.live.tagChill || "Chill" },
    { id: "party", label: t.live.tagParty || "Party" },
    { id: "hookups", label: t.live.tagHookups || "Hookups" },
    { id: "after-hours", label: t.live.tagAfterHours || "After Hours" },
  ];

  // Casting application
  const [castingStatus, setCastingStatus] = useState<CastingStatus | null>(null);
  const [castingSubmitting, setCastingSubmitting] = useState(false);

  // Performers & streams
  const [performers, setPerformers] = useState<FeaturedPerformer[]>([]);
  const [performersLoading, setPerformersLoading] = useState(true);
  const [liveStreams, setLiveStreams] = useState<LiveStream[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [prime247Live, setPrime247Live] = useState(false);

  // Dash token wallet
  const [tokenBalance, setTokenBalance] = useState<number | null>(null);
  const [dpnsHandle, setDpnsHandle] = useState<string | null>(null);
  const [showBuyModal, setShowBuyModal] = useState(false);
  const [tokenPackages, setTokenPackages] = useState<TokenPackage[]>([]);
  const [buyingPackage, setBuyingPackage] = useState<string | null>(null);
  const [buyError, setBuyError] = useState<string | null>(null);
  const [buyMethod, setBuyMethod] = useState<"card" | "wallet" | "dash">("card");
  const [showDpnsInput, setShowDpnsInput] = useState(false);
  const [dpnsInput, setDpnsInput] = useState("");
  const [dpnsSaving, setDpnsSaving] = useState(false);

  // Wallet history
  const [showWalletHistory, setShowWalletHistory] = useState(false);
  const [walletHistory, setWalletHistory] = useState<TokenPurchase[]>([]);
  const [walletHistoryLoading, setWalletHistoryLoading] = useState(false);

  // Performer drawer
  const [drawerPerformer, setDrawerPerformer] = useState<FeaturedPerformer | null>(null);
  const [drawerStreamId, setDrawerStreamId] = useState<string | null>(null);
  // Album thumbnail cache: creatorId → first 2 thumbs
  const [albumThumbs, setAlbumThumbs] = useState<Record<string, CreatorMediaItem[]>>({});
  const thumbLoadedRef = useRef<Set<string>>(new Set());

  // Next Up schedule hero
  const [nextSlot, setNextSlot] = useState<LiveScheduleSlot | null>(null);
  const [nextSlotSubscribed, setNextSlotSubscribed] = useState(false);
  const [nextSlotNotifying, setNextSlotNotifying] = useState(false);
  const [countdownLabel, setCountdownLabel] = useState<string>("");
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Socket (null stream — connected only for wallet push events)
  const {
    walletBalance: socketBalance,
    socketBalanceReceived,
  } = useLiveSocket(null);

  const fetchStreams = useCallback(() => {
    return getLiveStreams()
      .catch(() => ({ streams: [] }))
      .then((data) => (data.streams || []).filter((s: LiveStream) => s.isLive));
  }, []);

  const loadLiveEvents = useCallback(() => {
    getUpcomingEvents({ type: "live_stream", limit: 8 })
      .then((res) => { if (res.success) setLiveEvents(res.events); })
      .catch(() => {});
  }, []);

  // Probe the 24/7 Prime channel HLS manifest so the tile only renders when
  // the backend broadcaster is actually pushing. Restreamer's master playlist
  // references a .ts chunk when segments exist — that's our proof of life.
  useEffect(() => {
    let cancelled = false;
    const probe = async () => {
      try {
        const res = await fetch("https://live.pnptv.app/memfs/pnptv-main.m3u8", { cache: "no-store" });
        if (!res.ok) { if (!cancelled) setPrime247Live(false); return; }
        const text = await res.text();
        if (!cancelled) setPrime247Live(/\.ts/.test(text) || /\.m3u8\?/.test(text));
      } catch {
        if (!cancelled) setPrime247Live(false);
      }
    };
    probe();
    const iv = setInterval(probe, 45_000);
    return () => { cancelled = true; clearInterval(iv); };
  }, []);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setPerformersLoading(true);
    setLoadError(false);
    Promise.all([
      getFeaturedPerformers(),
      fetchStreams(),
    ]).then(([perfData, mergedStreams]) => {
      const perf = perfData.performers || [];
      setPerformers(perf);
      setLiveStreams(mergedStreams as LiveStream[]);
      // Preload first 2 album thumbs for each performer (fire-and-forget)
      for (const p of perf) {
        const cid = p.userId || p.id;
        if (!cid || thumbLoadedRef.current.has(cid)) continue;
        thumbLoadedRef.current.add(cid);
        listCreatorMedia(cid, 2).then((res) => {
          setAlbumThumbs((prev) => ({ ...prev, [cid]: res.items || [] }));
        }).catch(() => {});
      }
    }).catch(() => {
      setLoadError(true);
    }).finally(() => setPerformersLoading(false));
    loadLiveEvents();

    // Refresh streams periodically, paused when tab is hidden
    intervalRef.current = setInterval(() => {
      fetchStreams()
        .then((merged) => setLiveStreams(merged as LiveStream[]))
        .catch(() => {});
    }, 30000);

    const handleVisibility = () => {
      if (document.hidden) {
        if (intervalRef.current !== null) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      } else {
        fetchStreams()
          .then((merged) => setLiveStreams(merged as LiveStream[]))
          .catch(() => {});
        intervalRef.current = setInterval(() => {
          fetchStreams()
            .then((merged) => setLiveStreams(merged as LiveStream[]))
            .catch(() => {});
        }, 30000);
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      if (intervalRef.current !== null) clearInterval(intervalRef.current);
    };
  }, [fetchStreams, loadLiveEvents]);

  // Load wallet balance + packages when authenticated
  useEffect(() => {
    if (!isAuthenticated) return;
    getWalletBalance()
      .then((data) => {
        // FE-M1: only apply the HTTP-fetched balance if the socket has not yet
        // delivered an authoritative value — prevents a stale HTTP response
        // from overwriting a more recent socket-pushed balance.
        if (!socketBalanceReceived) {
          setTokenBalance(data.balance);
        }
        setDpnsHandle(data.dpnsHandle);
      })
      .catch(() => {});
    getTokenPackages()
      .then((data) => setTokenPackages(data.packages || []))
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  // Sync socket-pushed balance updates — socket value always wins (FE-M1)
  useEffect(() => {
    if (socketBalance !== null) setTokenBalance(socketBalance);
  }, [socketBalance]);

  // Load casting status
  useEffect(() => {
    if (!isAuthenticated) return;
    getCastingStatus().then(setCastingStatus).catch(() => {});
  }, [isAuthenticated]);

  // Load next upcoming slot
  useEffect(() => {
    getLiveSchedule()
      .then((res) => {
        if (!res.success || !res.slots?.length) return;
        const now = Date.now();
        // Exclude currently-live slots (edge case — performer grid handles those)
        const upcoming = res.slots
          .filter((s) => !s.is_live && new Date(s.start_time).getTime() > now)
          .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
        const slot = upcoming[0] ?? null;
        setNextSlot(slot);
        if (slot) {
          return getSlotNotifyStatus(slot.id)
            .then((r) => setNextSlotSubscribed(r.subscribed))
            .catch(() => {});
        }
      })
      .catch(() => {});
  }, []);

  // Countdown ticker — recomputes every 30s, cleaned up on unmount
  useEffect(() => {
    if (!nextSlot) {
      setCountdownLabel("");
      return;
    }
    const compute = () => {
      const diffMs = new Date(nextSlot.start_time).getTime() - Date.now();
      if (diffMs <= 0) {
        setCountdownLabel("Starting now");
        return;
      }
      const totalMinutes = Math.floor(diffMs / 60000);
      const hours = Math.floor(totalMinutes / 60);
      const minutes = totalMinutes % 60;
      if (hours > 0) {
        setCountdownLabel(`Starts in ${hours}h ${minutes}m`);
      } else {
        setCountdownLabel(`Starts in ${minutes}m`);
      }
    };
    compute();
    countdownRef.current = setInterval(compute, 30000);
    return () => {
      if (countdownRef.current !== null) {
        clearInterval(countdownRef.current);
        countdownRef.current = null;
      }
    };
  }, [nextSlot]);

  const handleBuyTokens = async (pkg: TokenPackage) => {
    setBuyingPackage(pkg.id);
    setBuyError(null);
    try {
      let checkoutUrl: string;
      let openedPopup: Window | null = null;
      if (buyMethod === 'card') {
        const result = await buyTokensCard(pkg.id);
        checkoutUrl = assertPaymentUrl(result.checkoutUrl);
        openedPopup = window.open(checkoutUrl, "_blank", "noopener,width=600,height=700");
      } else if (buyMethod === 'wallet') {
        const result = await buyTokensWallet(pkg.id);
        checkoutUrl = assertPaymentUrl(result.checkoutUrl);
        openedPopup = window.open(checkoutUrl, "_blank", "noopener,width=600,height=700");
      } else {
        // Dash — BTCPay has its own checkout page
        const result = await buyTokens(pkg.id);
        checkoutUrl = assertPaymentUrl(result.checkoutUrl);
        openedPopup = window.open(checkoutUrl, "_blank", "noopener,width=600,height=700");
      }
      if (!openedPopup) {
        setBuyError("Your browser blocked the payment popup. Please allow popups for this site and try again.");
        return; // don't close modal — user can retry
      }
      setShowBuyModal(false);
      // Fallback balance refresh 15s after checkout opens (in case Socket.IO event is missed)
      setTimeout(() => {
        getWalletBalance().then((res) => {
          if (typeof res.balance === 'number') setTokenBalance(res.balance);
        }).catch(() => {});
      }, 15_000);
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

  const handleCastingApply = async () => {
    setCastingSubmitting(true);
    try {
      const res = await submitCastingApplication();
      if (res.success) {
        setCastingStatus((prev) => prev ? { ...prev, application: res.application } : prev);
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to submit application");
    } finally {
      setCastingSubmitting(false);
    }
  };

  const handleSlotNotify = async () => {
    if (!nextSlot || nextSlotNotifying) return;
    setNextSlotNotifying(true);
    try {
      if (nextSlotSubscribed) {
        await unsubscribeFromSlotReminder(nextSlot.id);
        setNextSlotSubscribed(false);
      } else {
        await subscribeToSlotReminder(nextSlot.id);
        setNextSlotSubscribed(true);
      }
    } catch {
      // ignore — state stays as-is
    } finally {
      setNextSlotNotifying(false);
    }
  };

  // Match a performer to their live stream by hlsUrl (injected by backend) or
  // exact userId. Fuzzy name/slug matching is intentionally excluded — it
  // caused false positives when multiple performers had similar display names.
  const findLiveStream = (p: FeaturedPerformer): LiveStream | undefined => {
    // Fast path: backend already injected hlsUrl — find the matching stream
    if (p.hlsUrl) {
      const match = liveStreams.find((s) => s.hlsUrl === p.hlsUrl);
      if (match) return match;
    }
    // Fall back to exact userId match only
    const userId = p.userId ? String(p.userId) : null;
    if (!userId) return undefined;
    return liveStreams.find((s) => s.id === userId);
  };

  // Free-tier gate — show upsell instead of live content
  if (isAuthenticated && isFree) {
    return (
      <div className="page-container">
        <Helmet>
          <title>{t.live.pageTitle}</title>
          <meta name="description" content={t.live.pageDescription} />
        </Helmet>
        <div className="flex flex-col items-center justify-center min-h-[60vh] px-6">
          <div
            className="w-24 h-24 rounded-full flex items-center justify-center mb-6"
            style={{ background: "linear-gradient(135deg, rgba(212,0,122,0.15), rgba(94,209,196,0.15))", border: "1px solid rgba(212,0,122,0.3)" }}
          >
            <svg className="w-12 h-12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} style={{ color: "#D4007A" }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-pnp-textPrimary mb-2">{t.live.liveStreamsTitle}</h2>
          <p className="text-sm text-pnp-textSecondary text-center max-w-xs mb-8">
            {t.live.freeUserUpsell}
          </p>
          <button
            onClick={() => navigate("/subscribe")}
            className="px-6 py-3 rounded-full text-base font-semibold text-white"
            style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
          >
            {t.live.upgradeToMember}
          </button>

          {/* Casting banner for free users */}
          {castingStatus && (
            <div
              className="mt-8 w-full max-w-sm rounded-2xl p-4 text-left"
              style={{
                background: "linear-gradient(135deg, rgba(212,0,122,0.12), rgba(94,209,196,0.08))",
                border: "1px solid rgba(212,0,122,0.25)",
              }}
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                <h3 className="text-sm font-bold text-white">We are casting now!</h3>
              </div>
              <p className="text-xs mb-3" style={{ color: "rgba(255,255,255,0.65)" }}>
                Want to perform on PNP Live? You need a profile picture and {castingStatus.requiredPosts} posts to apply.
              </p>
              <div className="space-y-1.5 mb-3">
                <div className="flex items-center gap-2 text-xs" style={{ color: castingStatus.hasPhoto ? "#34C759" : "#FF3B30" }}>
                  <svg className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                    {castingStatus.hasPhoto ? (
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    ) : (
                      <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                    )}
                  </svg>
                  Profile picture
                </div>
                <div className="flex items-center gap-2 text-xs" style={{ color: castingStatus.postCount >= castingStatus.requiredPosts ? "#34C759" : "#FF3B30" }}>
                  <svg className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                    {castingStatus.postCount >= castingStatus.requiredPosts ? (
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    ) : (
                      <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                    )}
                  </svg>
                  {castingStatus.postCount}/{castingStatus.requiredPosts} posts
                </div>
              </div>
              {castingStatus.application?.status === "pending" ? (
                <span className="text-xs font-medium" style={{ color: "#FFB340" }}>Application pending review</span>
              ) : castingStatus.eligible ? (
                <button
                  onClick={handleCastingApply}
                  disabled={castingSubmitting}
                  className="px-5 py-2 rounded-xl text-sm font-bold text-white transition-opacity hover:opacity-90 active:scale-95 disabled:opacity-50"
                  style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
                >
                  {castingSubmitting ? "Submitting..." : "Apply Now"}
                </button>
              ) : null}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <Helmet>
        <title>{t.live.pageTitle}</title>
        <meta name="description" content={t.live.pageDescription} />
      </Helmet>
      {showTutorial && <TutorialOverlay section="live" onDismiss={dismissTutorial} onDismissForever={dismissForever} />}

      {/* Main Stage live banner — only when broadcasting, hidden on /main-stage itself */}
      <MainStageLiveBanner />

      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-pnp-textPrimary">{t.live.liveTitle}</h1>
          <p className="text-sm mt-1 text-pnp-textSecondary">{t.live.liveSubtitle}</p>
        </div>
      </div>

      {/* ── Categories (improvement #9) ── */}
      <div className="flex gap-2 overflow-x-auto pb-4 no-scrollbar -mx-4 px-4 sm:mx-0 sm:px-0">
        {CATEGORIES.map((cat) => {
          const isActive = selectedCategory === cat.id;
          return (
            <button
              key={cat.id}
              onClick={() => setSelectedCategory(cat.id)}
              className={`flex-shrink-0 px-4 py-1.5 rounded-full text-xs font-bold transition-all border ${
                isActive
                  ? "bg-pnp-accent text-white border-pnp-accent"
                  : "bg-pnp-surface text-pnp-textSecondary border-pnp-border hover:border-pnp-accent/40"
              }`}
            >
              {cat.label}
            </button>
          );
        })}
      </div>
      {loadError && (
        <div className="mb-4 p-3 rounded-xl bg-pnp-error/10 border border-pnp-error/20 flex items-center justify-between">
          <p className="text-xs text-pnp-error">{t.live.failedToLoadStreams}</p>
          <button onClick={() => window.location.reload()} className="text-xs font-semibold text-pnp-accent">
            {t.live.retryLoading}
          </button>
        </div>
      )}
      {/* ── Casting Banner ── */}
      {isAuthenticated && castingStatus && (
        <div
          className="rounded-2xl p-4 mb-4 relative overflow-hidden"
          style={{
            background: "linear-gradient(135deg, rgba(212,0,122,0.12) 0%, rgba(94,209,196,0.08) 100%)",
            border: "1px solid rgba(212,0,122,0.25)",
          }}
        >
          <div className="flex items-center gap-2 mb-2">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <h3 className="text-sm font-bold text-white">We are casting now!</h3>
          </div>
          <p className="text-xs mb-3" style={{ color: "rgba(255,255,255,0.65)" }}>
            Join PNP Live as a performer. Apply now and start streaming.
          </p>

          {castingStatus.application?.status === "pending" ? (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: "rgba(255,179,64,0.1)", border: "1px solid rgba(255,179,64,0.25)" }}>
              <svg className="w-4 h-4 flex-shrink-0" style={{ color: "#FFB340" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-xs font-medium" style={{ color: "#FFB340" }}>Application pending review</span>
            </div>
          ) : castingStatus.application?.status === "approved" ? (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: "rgba(52,199,89,0.1)", border: "1px solid rgba(52,199,89,0.25)" }}>
              <svg className="w-4 h-4 flex-shrink-0" style={{ color: "#34C759" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-xs font-medium" style={{ color: "#34C759" }}>Approved! Welcome to the team.</span>
            </div>
          ) : castingStatus.application?.status === "rejected" ? (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: "rgba(255,59,48,0.1)", border: "1px solid rgba(255,59,48,0.25)" }}>
              <span className="text-xs" style={{ color: "#FF3B30" }}>Not approved this time. Keep posting and try again!</span>
            </div>
          ) : castingStatus.eligible ? (
            <button
              onClick={handleCastingApply}
              disabled={castingSubmitting}
              className="px-5 py-2 rounded-xl text-sm font-bold text-white transition-opacity hover:opacity-90 active:scale-95 disabled:opacity-50"
              style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
            >
              {castingSubmitting ? "Submitting..." : "Apply Now"}
            </button>
          ) : (
            <div>
              <div className="space-y-1.5 mb-3">
                <div className="flex items-center gap-2 text-xs" style={{ color: castingStatus.hasPhoto ? "#34C759" : "#FF3B30" }}>
                  <svg className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                    {castingStatus.hasPhoto ? (
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    ) : (
                      <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                    )}
                  </svg>
                  Profile picture
                </div>
                <div className="flex items-center gap-2 text-xs" style={{ color: castingStatus.postCount >= castingStatus.requiredPosts ? "#34C759" : "#FF3B30" }}>
                  <svg className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                    {castingStatus.postCount >= castingStatus.requiredPosts ? (
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    ) : (
                      <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                    )}
                  </svg>
                  {castingStatus.postCount}/{castingStatus.requiredPosts} posts
                </div>
              </div>
              <button
                disabled
                className="px-5 py-2 rounded-xl text-sm font-bold text-white/40 cursor-not-allowed"
                style={{ background: "rgba(255,255,255,0.08)" }}
              >
                Apply Now
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── SpotlightStrip — active streams pinned + upcoming live events ── */}
      <SpotlightStrip
        items={[
          ...liveStreams
            .filter((s) => s.isLive && (selectedCategory === "all" || s.tags?.includes(selectedCategory)))
            .map((s) => ({
              kind: "action" as const,
              id: `stream-${s.id}`,
              label: s.title || s.performerName || "Live",
              sublabel: "LIVE NOW",
              icon: (
                <span className="relative flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
                </span>
              ),
              gradient: "linear-gradient(135deg, rgba(212,0,122,0.35), rgba(230,145,56,0.25))",
              onClick: () => navigate(`/live/${s.id}`),
              pinned: true,
            })),
          ...liveEvents.map((ev) => ({ kind: "event" as const, data: ev })),
        ]}
        onItemClick={(item) => {
          if (item.kind === "event") setDetailEvent(item.data);
        }}
        showAction={canCreateLive}
        onAction={() => setShowCreateEvent(true)}
        actionLabel="Schedule live"
        emptyAction={canCreateLive ? () => setShowCreateEvent(true) : undefined}
      />

      {/* ── Next Up Hero ── */}
      {(() => {
        if (!nextSlot) return null;
        const startMs = new Date(nextSlot.start_time).getTime();
        const diffMs = startMs - Date.now();
        // Hide if the slot somehow went live (edge case race)
        if (nextSlot.is_live || diffMs <= 0) return null;
        const startingSoon = diffMs < 5 * 60 * 1000; // within 5 minutes
        const title = nextSlot.title || nextSlot.performer_display_name || "Upcoming Show";
        const avatar = isValidPhotoUrl(nextSlot.performer_avatar) ? nextSlot.performer_avatar : "/default-performer.svg";
        return (
          <div
            className={`rounded-2xl p-4 mb-4 transition-all ${
              startingSoon
                ? "animate-pulse border-2 border-pnp-accent/60"
                : "border border-pnp-border"
            } bg-pnp-surface`}
          >
            {/* Mobile: stacked. sm+: row */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              {/* Avatar */}
              <img
                src={avatar}
                alt={title}
                className="w-16 h-16 rounded-full object-cover border-2 border-pnp-border self-center sm:self-auto flex-shrink-0"
                onError={(e) => { (e.target as HTMLImageElement).src = "/default-performer.svg"; }}
              />
              {/* Info */}
              <div className="flex-1 min-w-0 text-center sm:text-left">
                <div className="flex items-center justify-center sm:justify-start gap-2 mb-1">
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider text-white ${
                      startingSoon ? "bg-pnp-accent" : "bg-pnp-border"
                    }`}
                    style={startingSoon ? {} : { color: "#5ED1C4", background: "rgba(94,209,196,0.15)" }}
                  >
                    {startingSoon ? "Starting Soon" : "Next Up"}
                  </span>
                </div>
                <p className="text-sm font-bold text-pnp-textPrimary truncate">{title}</p>
                <p className="text-xs text-pnp-textSecondary mt-0.5">{countdownLabel}</p>
              </div>
              {/* Notify button */}
              <button
                onClick={handleSlotNotify}
                disabled={nextSlotNotifying}
                className={`w-full sm:w-auto flex-shrink-0 px-4 py-2 rounded-xl text-xs font-semibold transition-all active:scale-95 disabled:opacity-50 ${
                  nextSlotSubscribed
                    ? "bg-pnp-surface border border-pnp-accent/40 text-pnp-accent"
                    : "text-white btn-gradient"
                }`}
              >
                {nextSlotNotifying
                  ? "..."
                  : nextSlotSubscribed
                  ? "\u2713 You'll be notified"
                  : "Remind me"}
              </button>
            </div>
          </div>
        );
      })()}

      {/* ── PNPtv! 24/7 tile (only when the broadcaster is actually pushing) ── */}
      {prime247Live && (
        <div className="mb-4">
          <h2 className="text-xs font-semibold text-pnp-textSecondary uppercase tracking-wider mb-2">
            Now playing
          </h2>
          <button
            type="button"
            onClick={() => navigate("/live/pnptv-main")}
            className="group relative w-full overflow-hidden rounded-2xl border border-pnp-accent/30 bg-pnp-surface transition-all active:scale-[0.99] hover:border-pnp-accent/60"
            style={{
              background: "linear-gradient(135deg, rgba(212,0,122,0.14), rgba(123,97,255,0.14))",
            }}
          >
            <div className="flex items-center gap-3 p-4">
              <div
                className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: "linear-gradient(135deg, #D4007A, #7B61FF)" }}
              >
                <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </div>
              <div className="min-w-0 flex-1 text-left">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-white">PNPtv! 24/7</span>
                  <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-red-500 text-white text-[9px] font-bold">
                    <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" aria-hidden />
                    LIVE
                  </span>
                </div>
                <div className="text-xs text-pnp-textSecondary truncate">
                  Always-on channel — curated Prime videos, all day.
                </div>
              </div>
              <svg className="w-4 h-4 text-pnp-textSecondary group-hover:text-pnp-accent transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </div>
          </button>
        </div>
      )}

      {/* ── Performer Grid ── */}
      {performersLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-4">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-44 rounded-xl" />)}
        </div>
      ) : performers.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-4">
          {performers
            .map((p) => {
            // Use the backend-supplied isLive flag first (set when the performer
            // is actively streaming via Restreamer). Fall back to matching by name
            // or userId against the separately-fetched liveStreams list.
            const stream = findLiveStream(p);
            const isLive = p.isLive === true || !!stream;
            // Navigate using the stream's channel ref (e.g. "pnptv-santino") — simple,
            // URL-safe, and directly resolvable by the Stream page.
            const watchUrl = stream
              ? `/live/${stream.id}`
              : p.hlsUrl && p.userId
              ? `/live/${String(p.userId)}`
              : null;
            const cid = p.userId || p.id;
            const thumbs = cid ? (albumThumbs[cid] || []) : [];
            const thumb1 = thumbs[0];
            const thumb2 = thumbs[1];
            return (
              <div
                key={p.id}
                role="button"
                tabIndex={0}
                aria-label={`Open ${p.displayName} profile`}
                onClick={() => {
                  setDrawerPerformer(p);
                  setDrawerStreamId(stream ? stream.id : p.hlsUrl && p.userId ? String(p.userId) : null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    setDrawerPerformer(p);
                    setDrawerStreamId(stream ? stream.id : p.hlsUrl && p.userId ? String(p.userId) : null);
                  }
                }}
                className={`rounded-xl border bg-pnp-surface overflow-hidden cursor-pointer active:scale-95 transition-all ${isLive ? "border-red-500/50 ring-1 ring-red-500/20" : "border-pnp-border"}`}
              >
                {/* 3-image mosaic: avatar left, 2 album thumbs stacked right */}
                <div className="flex h-28">
                  {/* Avatar (left, larger) */}
                  <div className="relative w-[58%] flex-shrink-0">
                    <img
                      src={isValidPhotoUrl(p.photoUrl) ? p.photoUrl as string : "/default-performer.svg"}
                      alt={p.displayName}
                      className="w-full h-full object-cover"
                      onError={(e) => { (e.target as HTMLImageElement).src = "/default-performer.svg"; }}
                    />
                    {isLive && (
                      <span className="absolute top-1.5 left-1.5 flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-red-500 text-white text-[9px] font-bold">
                        <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                        LIVE
                      </span>
                    )}
                  </div>
                  {/* Two album thumbs (right column, stacked) */}
                  <div className="flex flex-col flex-1 gap-px">
                    {[thumb1, thumb2].map((thumb, idx) => (
                      <div key={idx} className="flex-1 relative bg-pnp-border/30 overflow-hidden">
                        {thumb && (thumb.thumbUrl || thumb.url) ? (
                          thumb.type === "video" ? (
                            <video
                              src={(thumb.thumbUrl || thumb.url) as string}
                              className="w-full h-full object-cover"
                              muted
                              playsInline
                              preload="none"
                            />
                          ) : (
                            <img
                              src={(thumb.thumbUrl || thumb.url) as string}
                              alt=""
                              className="w-full h-full object-cover"
                              loading="lazy"
                            />
                          )
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <svg className="w-4 h-4 text-pnp-border/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909" />
                            </svg>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
                {/* Name row */}
                <div className="px-2.5 py-2 flex items-center justify-between gap-1">
                  <span className="text-xs font-semibold text-pnp-textPrimary truncate">{p.displayName}</span>
                  {p.isFeatured && (
                    <span className="text-[9px] font-bold flex-shrink-0" style={{ color: "#5ED1C4" }}>★</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {/* ── Community Live — streams not matched to any performer ── */}
      {(() => {
        // A stream is "matched" if a performer card already shows it — either via
        // findLiveStream() name/id match, or because the performer's own hlsUrl
        // points to it (backend-injected live users).
        const matchedStreamIds = new Set(
          performers.map((p) => findLiveStream(p)?.id).filter(Boolean)
        );
        // Additionally exclude streams whose hlsUrl is already represented by a
        // performer that has isLive: true — those users appear in the performer grid.
        const livePerformerIds = new Set(
          performers.filter((p) => p.isLive).map((p) => String(p.userId)).filter(Boolean)
        );
        const communityStreams = liveStreams.filter(
          (s) => !matchedStreamIds.has(s.id) && !livePerformerIds.has(s.id) && (selectedCategory === "all" || s.tags?.includes(selectedCategory))
        );
        if (!performersLoading && communityStreams.length === 0 && performers.length === 0) {
          return (
            <p className="text-sm text-pnp-textSecondary text-center py-8">{t.live.noStreamsAvailable}</p>
          );
        }
        if (communityStreams.length === 0) return null;
        return (
          <div className="mb-4">
            <h2 className="text-xs font-semibold text-pnp-textSecondary uppercase tracking-wider mb-2">{t.live.communityLive}</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {communityStreams.map((s) => (
                <div
                  key={s.id}
                  className="rounded-xl border border-red-500/50 ring-1 ring-red-500/20 bg-pnp-surface p-3 flex flex-col items-center text-center"
                >
                  <div className="relative">
                    {isValidPhotoUrl(s.thumbnailUrl) ? (
                      <img
                        src={s.thumbnailUrl}
                        alt={s.name}
                        className="w-20 h-20 rounded-full object-cover mb-2 border-2 border-red-500"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                      />
                    ) : (
                      <div className="w-20 h-20 rounded-full mb-2 border-2 border-red-500 bg-pnp-border flex items-center justify-center">
                        <svg className="w-8 h-8 text-red-500/70" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M17 10.5V7a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h12a1 1 0 001-1v-3.5l4 4v-11l-4 4z" />
                        </svg>
                      </div>
                    )}
                    <span className="absolute -top-1 -right-1 flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-red-500 text-white text-[9px] font-bold">
                      <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                      LIVE
                    </span>
                  </div>
                  <span className="text-sm font-medium text-pnp-textPrimary truncate max-w-full">{s.name}</span>
                  {s.description ? (
                    <span className="text-[10px] text-pnp-textSecondary mt-0.5 line-clamp-1">{s.description}</span>
                  ) : null}
                  {s.tags && s.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 justify-center mt-1">
                      {s.tags.slice(0, 2).map((tag) => (
                        <span key={tag} className="px-1.5 py-0.5 rounded-full text-[9px] font-medium bg-pnp-surface border border-pnp-border text-pnp-textSecondary">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                  <button
                    onClick={() => navigate(`/live/${s.id}`)}
                    className="mt-2 w-full py-1.5 rounded-lg font-semibold text-xs active:scale-95 transition-all text-white bg-red-500 hover:bg-red-600"
                  >
                    {t.live.watchLive}
                  </button>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Book a Private Session ── */}
      {isAuthenticated && (
        <CallPackageCards
          performers={performers}
          className="mb-4"
        />
      )}

      {/* ── Wallet ── */}
      {isAuthenticated && (
        <div className="flex items-center justify-between py-2 border-t border-white/5">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: "#008CE7" }}>
              <svg viewBox="0 0 24 24" className="w-3 h-3 fill-white">
                <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm1.5 14.5h-3v-2h3c.828 0 1.5-.672 1.5-1.5S14.328 11 13.5 11H10V9h3.5c1.933 0 3.5 1.567 3.5 3.5S15.433 16 13.5 16.5z"/>
              </svg>
            </div>
            <span className="text-xs font-semibold text-pnp-textPrimary">
              {tokenBalance === null ? "—" : `${tokenBalance} ${t.live.tokens}`}
            </span>
            {dpnsHandle && <span className="text-[10px] text-pnp-textSecondary">@{dpnsHandle}</span>}
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
            <button onClick={() => setShowBuyModal(true)} className="px-2 py-1 rounded-md text-[10px] font-semibold text-white btn-gradient">
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
            style={{ fontSize: "16px" }}
            className="flex-1 min-w-0 rounded-lg bg-pnp-surface border border-pnp-border px-3 py-1.5 text-pnp-textPrimary placeholder-pnp-textSecondary focus:outline-none focus:ring-2 focus:ring-pnp-accent"
          />
          <button onClick={handleSaveDpns} disabled={dpnsSaving} className="px-3 py-1.5 rounded-lg btn-gradient text-white text-xs font-medium disabled:opacity-50">
            {dpnsSaving ? t.live.saving : t.live.save}
          </button>
        </div>
      )}


      {/* Buy Tokens Modal */}
      <BuyTokensModal
        isOpen={showBuyModal}
        onClose={() => setShowBuyModal(false)}
        onSuccess={(newBalance) => setTokenBalance(newBalance)}
        dpnsHandle={dpnsHandle}
      />

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

      {showCreateEvent && (
        <CreateEventModal
          defaultType="live_stream"
          canCreateLive={canCreateLive}
          onClose={() => setShowCreateEvent(false)}
          onCreated={(_event: EventItem) => {
            setShowCreateEvent(false);
            loadLiveEvents();
          }}
        />
      )}

      {detailEvent && (
        <EventDetailModal
          event={detailEvent}
          onClose={() => setDetailEvent(null)}
          onRsvp={async (eventId, shouldRsvp) => {
            setLiveEvents((prev) =>
              prev.map((e) => e.id === eventId ? { ...e, userRsvpd: shouldRsvp, rsvpCount: e.rsvpCount + (shouldRsvp ? 1 : -1) } : e)
            );
          }}
          onUpdated={(updated) => {
            setLiveEvents((prev) => prev.map((e) => e.id === updated.id ? updated : e));
            setDetailEvent(updated);
          }}
        />
      )}

      {/* ── Performer Drawer ── */}
      {drawerPerformer && (
        <PerformerDrawer
          performer={drawerPerformer}
          liveStreamId={drawerStreamId}
          onClose={() => { setDrawerPerformer(null); setDrawerStreamId(null); }}
        />
      )}
    </div>
  );
}
