import { useState, useEffect, useCallback } from "react";
import { Helmet } from "react-helmet-async";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useTutorial } from "@/hooks/useTutorial";
import { TutorialOverlay } from "@/components/tutorial/TutorialOverlay";
import { useI18n } from "@/lib/i18n";
import {
  getMessageThreads,
  getMatrixToken,
  getOrCreateDmRoom,
  markThreadAsRead,
  type MessageThread,
} from "@/lib/api";

// ─── Utilities ────────────────────────────────────────────────────────────────

function timeAgo(dateStr: string, nowLabel: string): string {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return nowLabel;
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

// ─── Main entry ───────────────────────────────────────────────────────────────

export default function DirectMessages() {
  const { userId } = useParams<{ userId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { showTutorial, dismissTutorial, dismissForever } = useTutorial("dm");
  const { dm: t } = useI18n();

  if (userId) {
    return <Conversation userId={userId} navigate={navigate} />;
  }
  return (
    <>
      <Helmet>
        <title>{t.pageTitle}</title>
        <meta name="description" content={t.pageDescription} />
      </Helmet>
      {showTutorial && <TutorialOverlay section="dm" onDismiss={dismissTutorial} onDismissForever={dismissForever} />}
      <ThreadList navigate={navigate} />
    </>
  );
}

// ─── Thread List ──────────────────────────────────────────────────────────────

function ThreadList({ navigate }: { navigate: (path: string) => void }) {
  const { dm: t } = useI18n();
  const [threads, setThreads] = useState<MessageThread[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadThreads = useCallback(async () => {
    try {
      const data = await getMessageThreads();
      setThreads(data.threads || []);
      setError(null);
    } catch {
      setError(t.loadThreadsError);
    }
  }, [t.loadThreadsError]);

  useEffect(() => {
    setIsLoading(true);
    loadThreads().finally(() => setIsLoading(false));
  }, [loadThreads]);

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">{t.messagesTitle}</h1>
          <p className="text-sm mt-1" style={{ color: "#8E8E93" }}>
            {t.directMessagesSubtitle}
          </p>
        </div>
      </div>

      {error && (
        <div
          className="glass-card-sm p-3 mb-4 border-l-4 flex items-start gap-2"
          style={{ borderLeftColor: "#FF453A" }}
          role="alert"
        >
          <svg className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: "#FF453A" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
          <p className="flex-1 text-sm text-white/80">{error}</p>
          <button
            onClick={() => { setIsLoading(true); loadThreads().finally(() => setIsLoading(false)); }}
            className="text-xs font-semibold focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30 rounded"
            style={{ color: "#D4007A" }}
          >
            {t.retry}
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3" aria-label="Loading threads" aria-busy="true">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="glass-card-sm p-4 animate-pulse">
              <div className="flex gap-3">
                <div className="w-12 h-12 rounded-full bg-white/10 flex-shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-white/10 rounded w-32" />
                  <div className="h-3 bg-white/10 rounded w-48" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : threads.length === 0 ? (
        <div className="glass-card-sm p-8 text-center">
          <svg className="w-16 h-16 mx-auto mb-3" style={{ color: "#8E8E93" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          <p className="text-white font-medium mb-1">{t.noThreadsTitle}</p>
          <p className="text-sm" style={{ color: "#8E8E93" }}>
            {t.noThreadsHint}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {threads.map((thread) => (
            <button
              key={thread.userId}
              onClick={() => navigate(`/dm/${thread.userId}`)}
              className="w-full glass-card-sm p-4 text-left hover:border-white/20 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
            >
              <div className="flex gap-3 items-center">
                <div
                  className="flex-shrink-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate(`/profile/${thread.userId}`);
                  }}
                >
                  {thread.photoUrl &&
                  (thread.photoUrl.startsWith("/") ||
                    thread.photoUrl.startsWith("http")) ? (
                    <img
                      src={thread.photoUrl}
                      className="w-12 h-12 rounded-full object-cover"
                      alt=""
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                      }}
                    />
                  ) : (
                    <div
                      className="w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold"
                      style={{
                        background: "rgba(212, 0, 122, 0.2)",
                        color: "#D4007A",
                      }}
                    >
                      {(thread.firstName || thread.username || "?")[0].toUpperCase()}
                    </div>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-white text-sm truncate min-w-0">
                      {thread.firstName || thread.username}
                    </span>
                    <span className="text-[10px] flex-shrink-0" style={{ color: "#8E8E93" }}>
                      {timeAgo(thread.lastMessageAt, t.timeNow)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between mt-0.5 gap-2">
                    <span className="text-xs truncate min-w-0" style={{ color: "#8E8E93" }}>
                      {thread.lastMessage || t.mediaFallback}
                    </span>
                    {thread.unreadCount > 0 && (
                      <span
                        className="ml-2 flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white"
                        style={{
                          background: "linear-gradient(135deg, #D4007A, #E69138)",
                        }}
                      >
                        {thread.unreadCount > 9 ? "9+" : thread.unreadCount}
                      </span>
                    )}
                  </div>
                </div>

                <svg className="w-4 h-4 flex-shrink-0" style={{ color: "#8E8E93" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Conversation View (Element Web iframe) ──────────────────────────────────

function Conversation({
  userId,
  navigate,
}: {
  userId: string;
  navigate: (path: string) => void;
}) {
  const { dm: t } = useI18n();
  const [matrixRoomId, setMatrixRoomId] = useState<string | null>(null);
  const [matrixCreds, setMatrixCreds] = useState<{
    userId: string;
    accessToken: string;
    deviceId?: string;
    homeserver: string;
  } | null>(null);
  const [matrixError, setMatrixError] = useState<string | null>(null);
  const [partnerName, setPartnerName] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  const loadChat = useCallback(() => {
    setMatrixRoomId(null);
    setMatrixCreds(null);
    setMatrixError(null);
    setIsLoading(true);

    // Fetch partner name from thread list
    getMessageThreads()
      .then((res) => {
        const thread = (res.threads || []).find(
          (th: MessageThread) => String(th.userId) === String(userId)
        );
        if (thread) setPartnerName(thread.firstName || thread.username || "");
      })
      .catch(() => {});

    // Fetch Matrix token + DM room in parallel
    Promise.all([
      getOrCreateDmRoom(userId),
      getMatrixToken(),
    ])
      .then(([roomRes, tokenRes]) => {
        if (roomRes.success) setMatrixRoomId(roomRes.roomId);
        if (tokenRes.success)
          setMatrixCreds({
            userId: tokenRes.matrixUserId,
            accessToken: tokenRes.accessToken,
            deviceId: tokenRes.deviceId || undefined,
            homeserver: tokenRes.homeserverUrl,
          });
      })
      .catch(() => {
        setMatrixError("Chat unavailable");
      })
      .finally(() => setIsLoading(false));

    markThreadAsRead(userId).catch(() => {});
  }, [userId]);

  useEffect(() => {
    loadChat();
  }, [loadChat]);

  const elementSrc =
    matrixRoomId && matrixCreds
      ? `/element-login.html#hs=${encodeURIComponent(matrixCreds.homeserver)}&uid=${encodeURIComponent(matrixCreds.userId)}&token=${encodeURIComponent(matrixCreds.accessToken)}&room=${encodeURIComponent(matrixRoomId)}${matrixCreds.deviceId ? "&did=" + encodeURIComponent(matrixCreds.deviceId) : ""}`
      : null;

  return (
    <div className="flex flex-col h-[calc(100dvh-4rem)]">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/5">
        <button
          onClick={() => navigate("/dm")}
          className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-white/5 active:scale-95 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
          aria-label={t.backToThreads}
        >
          <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <button
          onClick={() => navigate(`/profile/${userId}`)}
          className="flex-1 min-w-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 rounded-lg px-1"
        >
          <h2 className="font-semibold text-white text-sm truncate">
            {partnerName || t.conversationFallbackTitle}
          </h2>
          <p className="text-[10px]" style={{ color: "#8E8E93" }}>
            {t.tapToViewProfile}
          </p>
        </button>
      </div>

      {/* Element Web iframe */}
      {isLoading ? (
        <div className="flex-1 flex items-center justify-center min-h-0">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-white/20 border-t-pnp-accent rounded-full animate-spin" />
            <p className="text-sm" style={{ color: "#8E8E93" }}>Loading chat...</p>
          </div>
        </div>
      ) : elementSrc ? (
        <iframe
          key={`${matrixRoomId}-${matrixCreds!.userId}`}
          src={elementSrc}
          className="flex-1 min-h-0 w-full border-0"
          allow="microphone; camera; clipboard-write; encrypted-media; display-capture; autoplay; speaker-selection"
          title="Direct Message"
        />
      ) : matrixError ? (
        <div className="flex-1 flex items-center justify-center min-h-0">
          <div className="text-center px-6">
            <svg className="w-8 h-8 mx-auto mb-3 text-pnp-textSecondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
            <p className="text-sm text-pnp-textSecondary mb-3">Chat unavailable</p>
            <button
              onClick={loadChat}
              className="px-4 py-2 rounded-lg text-sm font-semibold text-white"
              style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
            >
              {t.tryAgain}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
