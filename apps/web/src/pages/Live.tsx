import React, { useState, useEffect, useCallback } from "react";
import { LivePlayer } from "@/components/LivePlayer";
import { Card, Badge, Skeleton, Button } from "@pnptv/ui-kit";
import { useAuth } from "@/hooks/useAuth";
import {
  getLiveStreams,
  getPerformers,
  getRecentTips,
  sendTip,
  TIP_AMOUNTS,
  type LiveStream,
  type Performer,
  type RecentTip,
} from "@/lib/api";

const CALCOM_URL = import.meta.env.VITE_CALCOM_URL || "https://booking.pnptv.app";

export default function Live() {
  const { isAuthenticated, login } = useAuth();

  const [streams, setStreams] = useState<LiveStream[]>([]);
  const [activeStream, setActiveStream] = useState<LiveStream | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Performers
  const [performers, setPerformers] = useState<Performer[]>([]);
  const [performersLoading, setPerformersLoading] = useState(true);

  // Tips
  const [recentTips, setRecentTips] = useState<RecentTip[]>([]);
  const [selectedPerformer, setSelectedPerformer] = useState<Performer | null>(null);
  const [tipMessage, setTipMessage] = useState("");
  const [showTipMessage, setShowTipMessage] = useState(false);
  const [tipping, setTipping] = useState(false);
  const [tipError, setTipError] = useState<string | null>(null);
  const [tipSuccess, setTipSuccess] = useState<string | null>(null);

  // Booking
  const [showBooking, setShowBooking] = useState(false);
  const [bookingLoaded, setBookingLoaded] = useState(false);

  // Load streams
  useEffect(() => {
    setIsLoading(true);
    getLiveStreams()
      .then((data) => {
        const liveStreams = data.streams || [];
        setStreams(liveStreams);
        const live = liveStreams.find((s) => s.isLive);
        if (live) setActiveStream(live);
        else if (liveStreams.length > 0) setActiveStream(liveStreams[0]);
      })
      .catch((err) => setError(err.message))
      .finally(() => setIsLoading(false));
  }, []);

  // Load performers
  useEffect(() => {
    setPerformersLoading(true);
    getPerformers()
      .then((data) => {
        const p = data.performers || [];
        setPerformers(p);
        if (p.length > 0 && !selectedPerformer) {
          setSelectedPerformer(p[0]);
        }
      })
      .catch(() => {})
      .finally(() => setPerformersLoading(false));
  }, []);

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

  const handleTip = async (amount: number) => {
    if (!isAuthenticated) {
      login();
      return;
    }
    if (!selectedPerformer) {
      setTipError("Select a performer to tip");
      return;
    }

    setTipping(true);
    setTipError(null);
    setTipSuccess(null);

    try {
      const result = await sendTip(
        selectedPerformer.id,
        amount,
        tipMessage || undefined
      );

      if (result.paymentUrl) {
        window.open(result.paymentUrl, "_blank", "noopener,width=500,height=700");
        setTipSuccess(`Payment window opened for $${amount} tip`);
      } else {
        setTipSuccess(`$${amount} tip submitted!`);
      }

      setTipMessage("");
      setShowTipMessage(false);
      setTimeout(loadTips, 3000);
    } catch (err: unknown) {
      setTipError(err instanceof Error ? err.message : "Failed to send tip");
    } finally {
      setTipping(false);
    }
  };

  const formatTimeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  return (
    <div className="page-container">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-bold text-pnp-textPrimary">Live</h1>
          <p className="text-sm text-pnp-textSecondary mt-1">
            Watch live broadcasts and tip performers
          </p>
        </div>
        <Badge variant="error">Live</Badge>
      </div>

      {/* Main Player */}
      {isLoading ? (
        <Skeleton className="aspect-video rounded-xl mb-4" />
      ) : activeStream ? (
        <div className="mb-4">
          <LivePlayer src={activeStream.hlsUrl} title={activeStream.name} />
          <div className="flex items-center gap-2 mt-2">
            {activeStream.isLive && (
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full dot-gradient animate-pulse" />
                <span className="text-xs font-medium text-gradient">LIVE</span>
              </span>
            )}
            <span className="text-sm text-pnp-textPrimary font-medium">{activeStream.name}</span>
          </div>
          {activeStream.description && (
            <p className="text-sm text-pnp-textSecondary mt-1">{activeStream.description}</p>
          )}
        </div>
      ) : (
        <Card className="text-center py-12 mb-4">
          <svg
            className="w-16 h-16 text-pnp-textSecondary mx-auto mb-3"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
            />
          </svg>
          <p className="text-pnp-textPrimary font-medium mb-1">No Streams Available</p>
          <p className="text-sm text-pnp-textSecondary">Check back later for live content</p>
        </Card>
      )}

      {/* Tip Bar */}
      <Card className="mb-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-pnp-textPrimary">Send a Tip</h3>
          {selectedPerformer && (
            <span className="text-xs text-gradient">
              to {selectedPerformer.name}
            </span>
          )}
        </div>

        {/* Performer selector (compact) */}
        {performers.length > 1 && (
          <div className="flex gap-2 mb-3 overflow-x-auto pb-1 -mx-1 px-1">
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
                {p.photo ? (
                  <img
                    src={p.photo}
                    alt=""
                    className="w-4 h-4 rounded-full object-cover"
                  />
                ) : (
                  <span className="w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold" style={{ background: "linear-gradient(135deg, #D4007A, #E69138)", color: "#fff" }}>
                    {p.name.charAt(0)}
                  </span>
                )}
                {p.name}
              </button>
            ))}
          </div>
        )}

        {/* Tip amount buttons */}
        <div className="flex gap-2 flex-wrap">
          {TIP_AMOUNTS.map((amount) => (
            <button
              key={amount}
              onClick={() => handleTip(amount)}
              disabled={tipping}
              className="flex-1 min-w-[56px] py-2 rounded-lg font-semibold text-sm transition-all text-white active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed btn-gradient"
            >
              ${amount}
            </button>
          ))}
        </div>

        {/* Optional message toggle */}
        <button
          onClick={() => setShowTipMessage(!showTipMessage)}
          className="text-xs text-pnp-textSecondary mt-2 hover:text-pnp-accent transition-colors"
        >
          {showTipMessage ? "Hide message" : "+ Add a message"}
        </button>

        {showTipMessage && (
          <input
            type="text"
            placeholder="Your message (optional)"
            value={tipMessage}
            onChange={(e) => setTipMessage(e.target.value)}
            maxLength={200}
            className="w-full mt-2 rounded-lg bg-pnp-surface border border-pnp-border px-3 py-2 text-sm text-pnp-textPrimary placeholder-pnp-textSecondary focus:outline-none focus:ring-2 focus:ring-pnp-accent"
          />
        )}

        {tipError && <p className="text-xs text-pnp-error mt-2">{tipError}</p>}
        {tipSuccess && <p className="text-xs mt-2 text-gradient">{tipSuccess}</p>}

        {!isAuthenticated && (
          <p className="text-xs text-pnp-textSecondary mt-2">
            Log in to send tips to performers
          </p>
        )}
      </Card>

      {/* Recent Tips Ticker */}
      {recentTips.length > 0 && (
        <div className="mb-6">
          <h3 className="text-xs font-medium text-pnp-textSecondary uppercase tracking-wider mb-2">
            Recent Tips
          </h3>
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
            {recentTips.map((tip) => (
              <div
                key={tip.id}
                className="flex-shrink-0 px-3 py-1.5 rounded-full bg-pnp-surface border border-pnp-border text-xs"
              >
                <span className="text-gradient font-medium">${tip.amount}</span>
                <span className="text-pnp-textSecondary mx-1">by</span>
                <span className="text-pnp-textPrimary">@{tip.user_username}</span>
                <span className="text-pnp-textSecondary ml-1">to {tip.model_name}</span>
                <span className="text-pnp-textSecondary/50 ml-1.5">{formatTimeAgo(tip.created_at)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Stream list (if multiple) */}
      {streams.length > 1 && (
        <>
          <h2 className="text-sm font-medium text-pnp-textSecondary uppercase tracking-wider mb-3">
            All Streams
          </h2>
          <div className="space-y-2 mb-6">
            {streams.map((stream) => (
              <Card
                key={stream.id}
                onClick={() => setActiveStream(stream)}
                hover
                className={activeStream?.id === stream.id ? "border-pnp-accent" : ""}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-3 h-3 rounded-full ${
                      stream.isLive ? "bg-pnp-error animate-pulse" : "bg-pnp-textSecondary"
                    }`}
                  />
                  <div className="flex-1">
                    <p className="font-medium text-pnp-textPrimary">{stream.name}</p>
                    {stream.description && (
                      <p className="text-sm text-pnp-textSecondary truncate">{stream.description}</p>
                    )}
                  </div>
                  <Badge variant={stream.isLive ? "error" : "default"}>
                    {stream.isLive ? "LIVE" : "Offline"}
                  </Badge>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}

      {/* Performer List */}
      {!performersLoading && performers.length > 0 && (
        <>
          <h2 className="text-sm font-medium text-pnp-textSecondary uppercase tracking-wider mb-3">
            Performers
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
            {performers.map((p) => (
              <Card
                key={p.id}
                hover
                onClick={() => setSelectedPerformer(p)}
                className={selectedPerformer?.id === p.id ? "border-pnp-accent" : ""}
              >
                <div className="text-center">
                  {p.photo ? (
                    <img
                      src={p.photo}
                      alt={p.name}
                      className="w-14 h-14 rounded-full object-cover mx-auto mb-2"
                    />
                  ) : (
                    <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-2" style={{ background: "linear-gradient(135deg, rgba(212,0,122,0.2), rgba(230,145,56,0.2))" }}>
                      <span className="text-lg text-gradient font-bold">
                        {p.name.charAt(0)}
                      </span>
                    </div>
                  )}
                  <p className="text-sm font-medium text-pnp-textPrimary truncate">{p.name}</p>
                  {p.categories.length > 0 && (
                    <p className="text-[10px] text-pnp-textSecondary truncate mt-0.5">
                      {Array.isArray(p.categories) ? p.categories.join(", ") : p.categories}
                    </p>
                  )}
                </div>
              </Card>
            ))}
          </div>
        </>
      )}

      {performersLoading && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
      )}

      {error && (
        <p className="text-xs text-pnp-textSecondary mt-4">
          Stream service temporarily unavailable.
        </p>
      )}

      {/* Book a Session */}
      <div className="mt-4">
        <button
          onClick={() => setShowBooking(!showBooking)}
          className="w-full flex items-center justify-between py-3 border-t border-white/5"
        >
          <div className="flex items-center gap-2">
            <svg
              className="w-5 h-5 text-pnp-accent"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
            <span className="text-sm font-medium text-pnp-textPrimary">Book a Private Session</span>
          </div>
          <svg
            className={`w-4 h-4 text-pnp-textSecondary transition-transform ${showBooking ? "rotate-180" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {showBooking && (
          <div className="mt-2">
            <div className="flex gap-2 mb-3">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => window.open(CALCOM_URL, "_blank")}
              >
                Open Full Calendar
              </Button>
            </div>
            <div className="embed-frame relative" style={{ minHeight: "500px" }}>
              {!bookingLoaded && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="text-center">
                    <div className="w-8 h-8 border-2 border-pnp-accent border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                    <p className="text-xs text-pnp-textSecondary">Loading booking...</p>
                  </div>
                </div>
              )}
              <iframe
                src={CALCOM_URL}
                className="w-full border-0 rounded-xl"
                style={{ height: "600px", opacity: bookingLoaded ? 1 : 0 }}
                onLoad={() => setBookingLoaded(true)}
                allow="camera; microphone"
                title="Booking Calendar"
              />
            </div>
            <Card className="mt-3">
              <div className="flex items-start gap-3">
                <svg
                  className="w-4 h-4 text-pnp-accent flex-shrink-0 mt-0.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <p className="text-xs text-pnp-textSecondary">
                  Sessions are scheduled in your local timezone. You'll receive a confirmation with
                  details.
                </p>
              </div>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
