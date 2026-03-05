import React, { useState, useEffect, useCallback, useRef } from "react";
import { Helmet } from "react-helmet-async";
import { LivePlayer } from "@/components/LivePlayer";
import { Card, Badge, Skeleton, Button } from "@pnptv/ui-kit";
import { useAuth } from "@/hooks/useAuth";
import { useTutorial } from "@/hooks/useTutorial";
import { TutorialOverlay } from "@/components/tutorial/TutorialOverlay";
import { useLiveSocket } from "@/hooks/useLiveSocket";
import {
  getLiveStreams,
  getAllPerformers,
  getRecentTips,
  sendTip,
  getRtmpKey,
  TIP_AMOUNTS,
  type LiveStream,
  type FeaturedPerformer,
  type RecentTip,
} from "@/lib/api";

const CALCOM_URL = import.meta.env.VITE_CALCOM_URL || "https://booking.pnptv.app";

function isValidPhotoUrl(photo: string | null | undefined): photo is string {
  return !!photo && (photo.startsWith("/") || photo.startsWith("http"));
}

export default function Live() {
  const { isAuthenticated, login, user } = useAuth();
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

  // Booking
  const [showBooking, setShowBooking] = useState(false);
  const [bookingLoaded, setBookingLoaded] = useState(false);

  // Go Live
  const [showGoLive, setShowGoLive] = useState(false);
  const [rtmpInfo, setRtmpInfo] = useState<{ rtmpUrl: string; streamKey: string } | null>(null);
  const [goLiveLoading, setGoLiveLoading] = useState(false);
  const [showStreamKey, setShowStreamKey] = useState(false);

  // Live chat
  const [chatInput, setChatInput] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Socket
  const { messages: chatMessages, viewerCount, isConnected: chatConnected, sendMessage, latestTip } = useLiveSocket(activeStream?.id ?? null);

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
    getAllPerformers()
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

  // Push socket-confirmed tips to the front of recentTips
  useEffect(() => {
    if (!latestTip) return;
    setRecentTips((prev) => {
      const next = [latestTip as unknown as RecentTip, ...prev.filter((t) => t.id !== (latestTip as unknown as RecentTip).id)].slice(0, 5);
      return next;
    });
  }, [latestTip]);

  // Auto-scroll chat to bottom on new messages
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

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

  const handleGoLive = async () => {
    setGoLiveLoading(true);
    try {
      const result = await getRtmpKey();
      if (result.success && result.rtmpUrl && result.streamKey) {
        setRtmpInfo({ rtmpUrl: result.rtmpUrl, streamKey: result.streamKey });
        setShowGoLive(true);
      }
    } catch {
      // silently fail
    } finally {
      setGoLiveLoading(false);
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
      <Helmet>
        <title>Live Streams — PNPtv!</title>
        <meta name="description" content="Watch live broadcasts, tip performers, and book private sessions on PNPtv." />
      </Helmet>
      {showTutorial && <TutorialOverlay section="live" onDismiss={dismissTutorial} />}
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-bold text-pnp-textPrimary">Live</h1>
          <p className="text-sm text-pnp-textSecondary mt-1">
            Watch live broadcasts and tip performers
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isCreator && (
            <button
              onClick={handleGoLive}
              disabled={goLiveLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white btn-gradient disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
            >
              <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
              {goLiveLoading ? "Loading..." : "Go Live"}
            </button>
          )}
          <Badge variant="error">Live</Badge>
        </div>
      </div>

      {/* Main Player */}
      {isLoading ? (
        <Skeleton className="aspect-video rounded-xl mb-4" />
      ) : activeStream ? (
        <div className="mb-4">
          <LivePlayer src={activeStream.hlsUrl} title={activeStream.name} />
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            {activeStream.isLive && (
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full dot-gradient animate-pulse" />
                <span className="text-xs font-medium text-gradient">LIVE</span>
              </span>
            )}
            {viewerCount > 0 && (
              <span className="flex items-center gap-1 text-xs text-pnp-textSecondary">
                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z" />
                </svg>
                {viewerCount} watching
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
              to {selectedPerformer.displayName}
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
                {isValidPhotoUrl(p.photoUrl) ? (
                  <img
                    src={p.photoUrl}
                    alt={`${p.displayName}'s avatar`}
                    className="w-4 h-4 rounded-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                      const fallback = (e.target as HTMLImageElement).nextElementSibling as HTMLElement;
                      if (fallback) fallback.style.display = "inline-flex";
                    }}
                  />
                ) : null}
                <span className="w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold" style={{ background: "linear-gradient(135deg, #D4007A, #E69138)", color: "#fff", display: isValidPhotoUrl(p.photoUrl) ? "none" : undefined }}>
                  {p.displayName.charAt(0)}
                </span>
                {p.displayName}
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

      {/* Live Chat */}
      {activeStream?.isLive && (
        <Card className="mb-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-pnp-textPrimary">Live Chat</h3>
            {chatConnected && (
              <span className="flex items-center gap-1 text-xs text-pnp-textSecondary">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                Live
              </span>
            )}
          </div>

          <div className="h-40 overflow-y-auto space-y-1.5 mb-3 pr-1" style={{ scrollbarWidth: "thin" }}>
            {chatMessages.length === 0 ? (
              <p className="text-xs text-pnp-textSecondary text-center py-4">Be the first to say hi!</p>
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
                placeholder="Say something..."
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && chatInput.trim()) {
                    sendMessage(chatInput.trim());
                    setChatInput("");
                  }
                }}
                maxLength={500}
                className="flex-1 rounded-lg bg-pnp-surface border border-pnp-border px-3 py-2 text-sm text-pnp-textPrimary placeholder-pnp-textSecondary focus:outline-none focus:ring-2 focus:ring-pnp-accent"
              />
              <button
                onClick={() => {
                  if (chatInput.trim()) {
                    sendMessage(chatInput.trim());
                    setChatInput("");
                  }
                }}
                className="px-3 py-2 rounded-lg btn-gradient text-white text-sm font-medium"
                aria-label="Send chat message"
              >
                Send
              </button>
            </div>
          ) : (
            <p className="text-xs text-pnp-textSecondary">Log in to chat</p>
          )}
        </Card>
      )}

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
                  <img
                    src={isValidPhotoUrl(p.photoUrl) ? p.photoUrl : "/default-performer.svg"}
                    alt={p.displayName}
                    className="w-14 h-14 rounded-full object-cover mx-auto mb-2"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = "/default-performer.svg";
                    }}
                  />
                  <p className="text-sm font-medium text-pnp-textPrimary truncate">{p.displayName}</p>
                  {p.isFeatured && (
                    <p className="text-[10px] mt-0.5 truncate" style={{ color: "#5ED1C4" }}>
                      Featured
                    </p>
                  )}
                  {p.isAvailable && !p.isFeatured && (
                    <p className="text-[10px] mt-0.5 truncate" style={{ color: "#5ED1C4" }}>
                      Available
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
      {/* Go Live Modal */}
      {showGoLive && rtmpInfo && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setShowGoLive(false)}
        >
          <div
            className="w-full max-w-lg bg-pnp-background border border-pnp-border rounded-t-2xl p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold text-pnp-textPrimary">Go Live</h2>
              <button
                onClick={() => setShowGoLive(false)}
                className="text-pnp-textSecondary hover:text-pnp-textPrimary transition-colors"
                aria-label="Close Go Live modal"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <p className="text-sm text-pnp-textSecondary mb-4">
              Use these credentials in OBS, Streamlabs, or any RTMP broadcaster.
            </p>

            <div className="space-y-3">
              <div>
                <label className="text-xs text-pnp-textSecondary uppercase tracking-wider block mb-1">
                  RTMP Server
                </label>
                <div className="flex items-center gap-2 bg-pnp-surface border border-pnp-border rounded-lg px-3 py-2">
                  <code className="text-sm text-pnp-textPrimary flex-1 break-all">{rtmpInfo.rtmpUrl}</code>
                  <button
                    onClick={() => navigator.clipboard?.writeText(rtmpInfo.rtmpUrl)}
                    className="text-pnp-textSecondary hover:text-pnp-accent flex-shrink-0 transition-colors"
                    aria-label="Copy RTMP server URL"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  </button>
                </div>
              </div>

              <div>
                <label className="text-xs text-pnp-textSecondary uppercase tracking-wider block mb-1">
                  Stream Key
                </label>
                <div className="flex items-center gap-2 bg-pnp-surface border border-pnp-border rounded-lg px-3 py-2">
                  <code className="text-sm text-pnp-textPrimary flex-1">
                    {showStreamKey ? rtmpInfo.streamKey : "•".repeat(Math.min(rtmpInfo.streamKey.length, 20))}
                  </code>
                  <button
                    onClick={() => setShowStreamKey(!showStreamKey)}
                    className="text-pnp-textSecondary hover:text-pnp-accent flex-shrink-0 transition-colors"
                    aria-label={showStreamKey ? "Hide stream key" : "Show stream key"}
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
                    aria-label="Copy stream key"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  </button>
                </div>
                <p className="text-xs text-pnp-error mt-1">Keep this private. Never share your stream key.</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
