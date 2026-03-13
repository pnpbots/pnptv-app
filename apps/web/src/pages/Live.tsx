import React, { lazy, Suspense, useState, useEffect, useCallback } from "react";
import Cal, { getCalApi } from "@calcom/embed-react";
import { useNavigate } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { Card, Skeleton, Button } from "@pnptv/ui-kit";
import { useAuth } from "@/hooks/useAuth";
import { useTier } from "@/hooks/useTier";
import { useTutorial } from "@/hooks/useTutorial";
import { TutorialOverlay } from "@/components/tutorial/TutorialOverlay";
import { useLiveSocket } from "@/hooks/useLiveSocket";
import { useI18n } from "@/lib/i18n";
import { UpcomingEvents } from "@/components/events/UpcomingEvents";
import { CreateEventModal } from "@/components/events/CreateEventModal";
import type { EventItem } from "@/components/events/EventCard";

const StreamerDashboard = lazy(() => import("@/components/streaming/StreamerDashboard"));
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
  type FeaturedPerformer,
  type LiveStream,
  type TokenPackage,
  type TokenPurchase,
} from "@/lib/api";

// ── PerformerCard ─────────────────────────────────────────────────────────────
// Extracted so each card can track its own image loading state independently.
interface PerformerCardProps {
  p: FeaturedPerformer;
  isLive: boolean;
  watchUrl: string | null;
  onWatch: () => void;
  watchLabel: string;
  profileLabel: string;
  featuredLabel: string;
}

function PerformerCard({ p, isLive, watchUrl, onWatch, watchLabel, profileLabel, featuredLabel }: PerformerCardProps) {
  const [imgLoaded, setImgLoaded] = useState(false);

  return (
    <div
      className={`rounded-xl border bg-pnp-surface p-3 flex flex-col items-center text-center ${isLive ? "border-red-500/50 ring-1 ring-red-500/20" : "border-pnp-border"}`}
    >
      <div className="relative">
        {/* Skeleton shown until the image fires onLoad */}
        {!imgLoaded && (
          <div className="w-20 h-20 rounded-full mb-2 bg-pnp-surfaceHover animate-pulse" aria-hidden="true" />
        )}
        <img
          src={isValidPhotoUrl(p.photoUrl) ? p.photoUrl : "/default-performer.svg"}
          alt={p.displayName}
          className={`w-20 h-20 rounded-full object-cover mb-2 border-2 ${isLive ? "border-red-500" : "border-pnp-border"} ${imgLoaded ? "block" : "hidden"}`}
          onLoad={() => setImgLoaded(true)}
          onError={(e) => {
            (e.target as HTMLImageElement).src = "/default-performer.svg";
            setImgLoaded(true);
          }}
        />
        {isLive && (
          <span className="absolute -top-1 -right-1 flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-red-500 text-white text-[9px] font-bold">
            <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
            LIVE
          </span>
        )}
      </div>
      <span className="text-sm font-medium text-pnp-textPrimary truncate max-w-full">{p.displayName}</span>
      {p.isFeatured && (
        <span className="text-[10px] mt-0.5 font-semibold" style={{ color: "#5ED1C4" }}>{featuredLabel}</span>
      )}
      <button
        onClick={onWatch}
        className={`mt-2 w-full py-1.5 rounded-lg font-semibold text-xs active:scale-95 transition-all ${
          isLive
            ? "text-white bg-red-500 hover:bg-red-600"
            : "text-pnp-textPrimary bg-pnp-surface border border-pnp-border hover:border-pnp-accent/40"
        }`}
      >
        {isLive ? watchLabel : profileLabel}
      </button>
    </div>
  );
}

const CALCOM_URL = import.meta.env.VITE_CALCOM_URL || "https://booking.pnptv.app";
if (!CALCOM_URL.startsWith("https://")) {
  throw new Error(`Invalid CALCOM_URL: must start with https:// (got: ${CALCOM_URL})`);
}

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
  const { isAuthenticated, user, login } = useAuth();
  const { isFree } = useTier();
  const t = useI18n();
  const navigate = useNavigate();
  const { showTutorial, dismissTutorial } = useTutorial("live");
  const canCreateLive = isAuthenticated && (user?.role === "model" || user?.role === "creator" || user?.role === "admin" || user?.role === "superadmin");
  const [showCreateEvent, setShowCreateEvent] = useState(false);
  const [liveEventsKey, setLiveEventsKey] = useState(0);

  // Performers & streams
  const [performers, setPerformers] = useState<FeaturedPerformer[]>([]);
  const [performersLoading, setPerformersLoading] = useState(true);
  const [liveStreams, setLiveStreams] = useState<LiveStream[]>([]);
  const [loadError, setLoadError] = useState(false);

  // Dash token wallet
  const [tokenBalance, setTokenBalance] = useState<number | null>(null);
  const [dpnsHandle, setDpnsHandle] = useState<string | null>(null);
  const [showBuyModal, setShowBuyModal] = useState(false);
  const [buyMethod, setBuyMethod] = useState<'select' | 'card' | 'wallet' | 'dash'>('select');
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
  const [bookingError, setBookingError] = useState<string | null>(null);

  // Go Live
  const [showBrowserStreamer, setShowBrowserStreamer] = useState(false);

  // Socket (null stream — connected only for wallet push events)
  const {
    walletBalance: socketBalance,
    socketBalanceReceived,
  } = useLiveSocket(null);

  // Load performers + streams
  useEffect(() => {
    setPerformersLoading(true);
    setLoadError(false);
    Promise.all([
      getFeaturedPerformers(),
      getLiveStreams(),
    ]).then(([perfData, streamData]) => {
      setPerformers(perfData.performers || []);
      setLiveStreams((streamData.streams || []).filter((s: LiveStream) => s.isLive));
    }).catch(() => {
      setLoadError(true);
    }).finally(() => setPerformersLoading(false));

    // Refresh streams periodically
    const interval = setInterval(() => {
      getLiveStreams()
        .then((data) => setLiveStreams((data.streams || []).filter((s: LiveStream) => s.isLive)))
        .catch(() => {});
    }, 30000);
    return () => clearInterval(interval);
  }, []);

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

  // Booking iframe timeout — show error if still not loaded after 15 seconds.
  // The effect re-runs when bookingLoaded flips true; the cleanup cancels the
  // pending timer, so setBookingError is never called on a successful load.
  useEffect(() => {
    if (!showBooking || bookingLoaded) return;
    const timer = setTimeout(() => setBookingError(t.live.failedToLoadStreams ?? "The booking calendar failed to load. Please try again."), 15000);
    return () => clearTimeout(timer);
  }, [showBooking, bookingLoaded, t.live]);

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
      {showTutorial && <TutorialOverlay section="live" onDismiss={dismissTutorial} />}

      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-lg font-bold text-pnp-textPrimary">{t.live.liveTitle}</h1>
          <p className="text-xs text-pnp-textSecondary mt-0.5">{t.live.liveSubtitle}</p>
        </div>
        {isAuthenticated && (user?.role === "model" || user?.role === "admin" || user?.role === "superadmin") && (
          <button
            onClick={() => setShowBrowserStreamer(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white btn-gradient transition-all"
          >
            <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
            {t.live.goLive}
          </button>
        )}
      </div>
      {loadError && (
        <div className="mb-4 p-3 rounded-xl bg-pnp-error/10 border border-pnp-error/20 flex items-center justify-between">
          <p className="text-xs text-pnp-error">{t.live.failedToLoadStreams}</p>
          <button onClick={() => window.location.reload()} className="text-xs font-semibold text-pnp-accent">
            {t.live.retryLoading}
          </button>
        </div>
      )}
      {/* ── Upcoming Live Events ── */}
      <UpcomingEvents
        key={liveEventsKey}
        type="live_stream"
        limit={6}
        title="Scheduled Live Events"
        canCreate={canCreateLive}
        onCreateClick={() => setShowCreateEvent(true)}
        className="mb-2"
      />

      {/* ── Performer Grid ── */}
      {performersLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-4">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-44 rounded-xl" />)}
        </div>
      ) : performers.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-4">
          {performers.map((p) => {
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
            return (
              <div
                key={p.id}
                className={`rounded-xl border bg-pnp-surface p-3 flex flex-col items-center text-center ${isLive ? "border-red-500/50 ring-1 ring-red-500/20" : "border-pnp-border"}`}
              >
                <div className="relative">
                  <img
                    src={isValidPhotoUrl(p.photoUrl) ? p.photoUrl : "/default-performer.svg"}
                    alt={p.displayName}
                    className={`w-20 h-20 rounded-full object-cover mb-2 border-2 ${isLive ? "border-red-500" : "border-pnp-border"}`}
                    onError={(e) => { (e.target as HTMLImageElement).src = "/default-performer.svg"; }}
                  />
                  {isLive && (
                    <span className="absolute -top-1 -right-1 flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-red-500 text-white text-[9px] font-bold">
                      <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                      LIVE
                    </span>
                  )}
                </div>
                <span className="text-sm font-medium text-pnp-textPrimary truncate max-w-full">{p.displayName}</span>
                {p.isFeatured && (
                  <span className="text-[10px] mt-0.5 font-semibold" style={{ color: "#5ED1C4" }}>{t.live.performerFeatured}</span>
                )}
                <button
                  onClick={() => {
                    if (isLive && watchUrl) {
                      navigate(watchUrl);
                    } else if (p.userId) {
                      navigate(`/profile/${p.userId}`);
                    }
                  }}
                  className={`mt-2 w-full py-1.5 rounded-lg font-semibold text-xs active:scale-95 transition-all ${
                    isLive
                      ? "text-white bg-red-500 hover:bg-red-600"
                      : "text-pnp-textPrimary bg-pnp-surface border border-pnp-border hover:border-pnp-accent/40"
                  }`}
                >
                  {isLive ? t.live.watchLive : t.live.viewProfile}
                </button>
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
          (s) => !matchedStreamIds.has(s.id) && !livePerformerIds.has(s.id)
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
                    <div className="w-20 h-20 rounded-full mb-2 border-2 border-red-500 bg-pnp-border flex items-center justify-center">
                      <svg className="w-8 h-8 text-red-500/70" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M17 10.5V7a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h12a1 1 0 001-1v-3.5l4 4v-11l-4 4z" />
                      </svg>
                    </div>
                    <span className="absolute -top-1 -right-1 flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-red-500 text-white text-[9px] font-bold">
                      <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                      LIVE
                    </span>
                  </div>
                  <span className="text-sm font-medium text-pnp-textPrimary truncate max-w-full">{s.name}</span>
                  {s.description ? (
                    <span className="text-[10px] text-pnp-textSecondary mt-0.5 line-clamp-1">{s.description}</span>
                  ) : null}
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
            <button onClick={() => { setBuyError(null); setBuyMethod('select'); setShowBuyModal(true); }} className="px-2 py-1 rounded-md text-[10px] font-semibold text-white btn-gradient">
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

      {/* Book a Session */}
      <div className="mt-4">
        <button
          onClick={() => isAuthenticated && setShowBooking(!showBooking)}
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

        {!isAuthenticated ? (
          <div className="mt-2 flex items-center gap-3 p-4 rounded-xl border border-pnp-border bg-pnp-surface">
            <svg className="w-5 h-5 text-pnp-accent flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-pnp-textPrimary">Sign in to book a session</p>
              <p className="text-xs text-pnp-textSecondary mt-0.5">You must be logged in to book a private session with a performer.</p>
            </div>
            <button
              onClick={login}
              className="flex-shrink-0 px-3 py-1.5 rounded-lg btn-gradient text-white text-xs font-semibold"
            >
              Sign in
            </button>
          </div>
        ) : showBooking && (
          <div className="mt-2">
            <div className="flex gap-2 mb-3">
              <Button variant="secondary" size="sm" onClick={() => window.open(CALCOM_URL, "_blank")}>
                {t.live.openFullCalendar}
              </Button>
            </div>
            {bookingError ? (
              <div className="flex flex-col items-center gap-3 p-6 rounded-xl border border-pnp-error/20 bg-pnp-error/10">
                <svg className="w-8 h-8 text-pnp-error flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <p className="text-sm text-pnp-error text-center">{bookingError}</p>
                <button
                  onClick={() => {
                    setBookingError(null);
                    setBookingLoaded(false);
                  }}
                  className="px-4 py-2 rounded-lg btn-gradient text-white text-xs font-semibold"
                >
                  {t.live.retryLoading}
                </button>
              </div>
            ) : (
              <div className="embed-frame overflow-hidden" style={{ minHeight: "500px" }}>
                <Cal
                  calLink="pnptv/private-session"
                  config={{ theme: "dark" }}
                  calOrigin={CALCOM_URL}
                  embedJsUrl={`${CALCOM_URL}/embed/embed.js`}
                  style={{ width: "100%", height: "100%", minHeight: "500px" }}
                />
              </div>
            )}
            {!bookingError && (
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
            )}
          </div>
        )}
      </div>

      {/* Buy Tokens Modal */}
      {showBuyModal && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setShowBuyModal(false)}
        >
          <div
            className="w-full max-w-lg bg-pnp-background border border-pnp-border rounded-t-2xl p-6"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal header — shared between both steps */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                {buyMethod !== 'select' && (
                  <button
                    onClick={() => { setBuyMethod('select'); setBuyError(null); }}
                    className="flex items-center justify-center w-7 h-7 rounded-full bg-pnp-surface hover:bg-pnp-surfaceHover transition-colors"
                    aria-label="Back to payment method selection"
                  >
                    <svg className="w-4 h-4 text-pnp-textSecondary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                )}
                <h2 className="text-base font-bold text-pnp-textPrimary">
                  {buyMethod === 'select' ? 'Buy PNP Tokens' : 'Choose a Package'}
                </h2>
              </div>
              <button
                onClick={() => setShowBuyModal(false)}
                className="flex items-center justify-center w-8 h-8 rounded-full text-pnp-textSecondary hover:text-pnp-textPrimary hover:bg-pnp-surface transition-colors"
                aria-label="Close"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Step 1: Payment method selector */}
            {buyMethod === 'select' && (
              <div className="space-y-2">
                <p className="text-xs text-pnp-textSecondary mb-3">
                  Select how you want to pay for your tokens.
                </p>

                {/* Card */}
                <button
                  onClick={() => setBuyMethod('card')}
                  className="w-full flex items-center gap-4 p-4 rounded-xl border border-pnp-border bg-pnp-surface hover:bg-pnp-surfaceHover hover:border-green-500/40 active:scale-[0.99] transition-all text-left min-h-[64px]"
                >
                  <div className="w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center" style={{ background: "rgba(76,175,80,0.15)" }}>
                    <svg className="w-5 h-5" style={{ color: "#4CAF50" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                      <rect x="2" y="5" width="20" height="14" rx="2" ry="2" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2 10h20" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-pnp-textPrimary">Buy with Card</p>
                    <p className="text-xs text-pnp-textSecondary truncate">Visa, Mastercard, PSE</p>
                  </div>
                  <svg className="w-4 h-4 flex-shrink-0 text-pnp-textSecondary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>

                {/* Wallet */}
                <button
                  onClick={() => setBuyMethod('wallet')}
                  className="w-full flex items-center gap-4 p-4 rounded-xl border border-pnp-border bg-pnp-surface hover:bg-pnp-surfaceHover hover:border-violet-500/40 active:scale-[0.99] transition-all text-left min-h-[64px]"
                >
                  <div className="w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center" style={{ background: "rgba(124,58,237,0.15)" }}>
                    <svg className="w-5 h-5" style={{ color: "#7C3AED" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-pnp-textPrimary">Buy with Wallet</p>
                    <p className="text-xs text-pnp-textSecondary truncate">USDC on Base — fast &amp; easy</p>
                  </div>
                  <svg className="w-4 h-4 flex-shrink-0 text-pnp-textSecondary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>

                {/* Dash / Privacy */}
                <button
                  onClick={() => setBuyMethod('dash')}
                  className="w-full flex items-center gap-4 p-4 rounded-xl border border-pnp-border bg-pnp-surface hover:bg-pnp-surfaceHover hover:border-sky-400/40 active:scale-[0.99] transition-all text-left min-h-[64px]"
                >
                  <div className="w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center" style={{ background: "rgba(0,140,231,0.15)" }}>
                    <svg className="w-5 h-5" style={{ color: "#008CE7" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-pnp-textPrimary">Buy with More Privacy</p>
                    <p className="text-xs text-pnp-textSecondary truncate">Dash cryptocurrency</p>
                  </div>
                  <svg className="w-4 h-4 flex-shrink-0 text-pnp-textSecondary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
            )}

            {/* Step 2: Package grid after method selected */}
            {buyMethod !== 'select' && (
              <>
                {/* Method explanation */}
                <p className="text-xs text-pnp-textSecondary mb-4 leading-relaxed">
                  {buyMethod === 'card' && "Pay instantly with your credit or debit card via ePayco. Secure checkout — your card details are never stored on our servers."}
                  {buyMethod === 'wallet' && "Pay with USDC stablecoin from any crypto wallet via Daimo. Fast, low fees, and no personal info required."}
                  {buyMethod === 'dash' && "Pay with Dash cryptocurrency via BTCPay Server. Maximum privacy — fully anonymous, no account needed."}
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
                        className="p-3 rounded-xl border border-pnp-border bg-pnp-surface hover:bg-pnp-surfaceHover hover:border-pnp-accent/50 active:scale-[0.98] transition-all text-left disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent focus-visible:ring-offset-2 focus-visible:ring-offset-pnp-background"
                      >
                        <p className="text-lg font-bold text-pnp-textPrimary">{pkg.tokens}</p>
                        <p className="text-xs text-pnp-textSecondary">{t.live.tokensLabel}</p>
                        <p className="text-sm font-semibold mt-1" style={{
                          color: buyMethod === 'card' ? '#4CAF50' : buyMethod === 'wallet' ? '#7C3AED' : '#008CE7'
                        }}>${pkg.usd}</p>
                        {buyingPackage === pkg.id && (
                          <p className="text-[10px] text-pnp-textSecondary mt-1">{t.live.opening}</p>
                        )}
                      </button>
                    ))}
                  </div>
                )}

                {/* Dash-specific DPNS info — only shown for the Dash method */}
                {buyMethod === 'dash' && (
                  <div className="flex items-start gap-2 p-3 rounded-lg bg-pnp-surface border border-pnp-border/50">
                    <svg className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: "#008CE7" }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <p className="text-[11px] text-pnp-textSecondary">
                      {t.live.buyTokensCheckoutNote}
                      {dpnsHandle && t.live.yourDashIdentity(dpnsHandle)}
                    </p>
                  </div>
                )}
              </>
            )}
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

      {/* Streamer Dashboard — full-screen overlay (OBS-like pro UI) */}
      {showBrowserStreamer && (
        <Suspense fallback={
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-pnp-background">
            <div className="w-8 h-8 border-2 border-pnp-accent border-t-transparent rounded-full animate-spin" />
          </div>
        }>
          <StreamerDashboard onClose={() => setShowBrowserStreamer(false)} />
        </Suspense>
      )}

      {showCreateEvent && (
        <CreateEventModal
          defaultType="live_stream"
          canCreateLive={canCreateLive}
          onClose={() => setShowCreateEvent(false)}
          onCreated={(_event: EventItem) => {
            setShowCreateEvent(false);
            setLiveEventsKey((k) => k + 1);
          }}
        />
      )}
    </div>
  );
}
