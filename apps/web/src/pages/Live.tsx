import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { Card, Skeleton, Button } from "@pnptv/ui-kit";
import { useAuth } from "@/hooks/useAuth";
import { useTutorial } from "@/hooks/useTutorial";
import { TutorialOverlay } from "@/components/tutorial/TutorialOverlay";
import { useLiveSocket } from "@/hooks/useLiveSocket";
import { useI18n } from "@/lib/i18n";
import {
  getAllPerformers,
  getLiveStreams,
  getRtmpKey,
  getWalletBalance,
  getTokenPackages,
  buyTokens,
  linkDPNS,
  getWalletHistory,
  type FeaturedPerformer,
  type LiveStream,
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
  const { isAuthenticated, login } = useAuth();
  const t = useI18n();
  const navigate = useNavigate();
  const { showTutorial, dismissTutorial } = useTutorial("live");

  // Performers & streams
  const [performers, setPerformers] = useState<FeaturedPerformer[]>([]);
  const [performersLoading, setPerformersLoading] = useState(true);
  const [liveStreams, setLiveStreams] = useState<LiveStream[]>([]);


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

  // Go Live
  const [showGoLive, setShowGoLive] = useState(false);
  const [rtmpInfo, setRtmpInfo] = useState<{ rtmpUrl: string; streamKey: string } | null>(null);
  const [goLiveLoading, setGoLiveLoading] = useState(false);
  const [goLiveError, setGoLiveError] = useState<string | null>(null);
  const [showStreamKey, setShowStreamKey] = useState(false);

  // Socket (null stream — connected only for wallet push events)
  const {
    walletBalance: socketBalance,
  } = useLiveSocket(null);

  // Load performers + streams
  useEffect(() => {
    setPerformersLoading(true);
    Promise.all([
      getAllPerformers().catch(() => ({ performers: [] })),
      getLiveStreams().catch(() => ({ streams: [] })),
    ]).then(([perfData, streamData]) => {
      setPerformers(perfData.performers || []);
      setLiveStreams((streamData.streams || []).filter((s: LiveStream) => s.isLive));
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

  // Match a performer to their live stream by userId, display name, or slug
  const findLiveStream = (p: FeaturedPerformer): LiveStream | undefined => {
    const name = p.displayName.toLowerCase().split(/[^a-z]/)[0];
    const slug = p.slug?.toLowerCase();
    const userId = p.userId ? String(p.userId) : null;
    return liveStreams.find((s) => {
      const sName = s.name.toLowerCase();
      const sId = s.id.toLowerCase();
      return (
        (userId && (sId.includes(userId) || sName.includes(userId))) ||
        (name && (sName.includes(name) || sId.includes(name))) ||
        (slug && (sName.includes(slug) || sId.includes(slug)))
      );
    });
  };

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
        {isAuthenticated && (
          <button
            onClick={handleGoLive}
            disabled={goLiveLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white btn-gradient disabled:opacity-50 transition-all"
          >
            <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
            {goLiveLoading ? t.live.goLiveLoading : t.live.goLive}
          </button>
        )}
      </div>
      {goLiveError && (
        <p className="text-[10px] text-pnp-error mb-2">{goLiveError}</p>
      )}

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
            // Prefer the direct hlsUrl from the performer object; fall back to
            // the matched stream's id for the /live/:streamId route.
            const watchUrl = p.hlsUrl
              ? `/live/${encodeURIComponent(p.id)}`
              : stream
              ? `/live/${encodeURIComponent(stream.id)}`
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
                  {isLive ? "Watch Live" : (t.live.viewProfile || "View Profile")}
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
            <h2 className="text-xs font-semibold text-pnp-textSecondary uppercase tracking-wider mb-2">Community Live</h2>
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
                    onClick={() => navigate(`/live/${encodeURIComponent(s.id)}`)}
                    className="mt-2 w-full py-1.5 rounded-lg font-semibold text-xs active:scale-95 transition-all text-white bg-red-500 hover:bg-red-600"
                  >
                    Watch Live
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
