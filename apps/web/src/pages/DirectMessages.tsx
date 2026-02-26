import React, { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import {
  getMessageThreads,
  getMessages,
  sendMessage,
  markThreadAsRead,
  type MessageThread,
  type DirectMessage,
} from "@/lib/api";

function timeAgo(dateStr: string): string {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

export default function DirectMessages() {
  const { userId } = useParams<{ userId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();

  // If userId param is present, show conversation; otherwise show thread list
  if (userId) {
    return <Conversation userId={userId} currentUser={user} navigate={navigate} />;
  }
  return <ThreadList currentUser={user} navigate={navigate} />;
}

// ─── Thread List ──────────────────────────────────────────
function ThreadList({
  currentUser,
  navigate,
}: {
  currentUser: any;
  navigate: (path: string) => void;
}) {
  const [threads, setThreads] = useState<MessageThread[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadThreads = useCallback(async () => {
    try {
      const data = await getMessageThreads();
      setThreads(data.threads || []);
      setError(null);
    } catch {
      setError("Failed to load messages");
    }
  }, []);

  useEffect(() => {
    setIsLoading(true);
    loadThreads().finally(() => setIsLoading(false));
  }, [loadThreads]);

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Messages</h1>
          <p className="text-sm mt-1" style={{ color: "#8E8E93" }}>
            Direct messages
          </p>
        </div>
      </div>

      {error && (
        <div
          className="glass-card-sm p-3 mb-4 border-l-4"
          style={{ borderLeftColor: "#FF453A" }}
        >
          <p className="text-sm text-white/80">{error}</p>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="glass-card-sm p-4 animate-pulse">
              <div className="flex gap-3">
                <div className="w-12 h-12 rounded-full bg-white/10" />
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
          <svg
            className="w-16 h-16 mx-auto mb-3"
            style={{ color: "#8E8E93" }}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
            />
          </svg>
          <p className="text-white font-medium mb-1">No messages yet</p>
          <p className="text-sm" style={{ color: "#8E8E93" }}>
            Visit a profile and tap Message to start a conversation
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {threads.map((thread) => (
            <button
              key={thread.userId}
              onClick={() => navigate(`/dm/${thread.userId}`)}
              className="w-full glass-card-sm p-4 text-left hover:border-white/20 transition-colors"
            >
              <div className="flex gap-3">
                {thread.photoUrl ? (
                  <img
                    src={thread.photoUrl}
                    className="w-12 h-12 rounded-full object-cover flex-shrink-0"
                    alt=""
                  />
                ) : (
                  <div
                    className="w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold flex-shrink-0"
                    style={{
                      background: "rgba(212, 0, 122, 0.2)",
                      color: "#D4007A",
                    }}
                  >
                    {(thread.firstName || thread.username || "?")[0].toUpperCase()}
                  </div>
                )}

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-white text-sm truncate">
                      {thread.firstName || thread.username}
                    </span>
                    <span className="text-[10px] flex-shrink-0 ml-2" style={{ color: "#8E8E93" }}>
                      {timeAgo(thread.lastMessageAt)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between mt-0.5">
                    <span
                      className="text-xs truncate"
                      style={{ color: "#8E8E93" }}
                    >
                      {thread.lastMessage}
                    </span>
                    {thread.unreadCount > 0 && (
                      <span className="ml-2 flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white bg-gradient-to-r from-[#D4007A] to-[#E69138]">
                        {thread.unreadCount > 9 ? "9+" : thread.unreadCount}
                      </span>
                    )}
                  </div>
                </div>

                <svg
                  className="w-4 h-4 flex-shrink-0 self-center"
                  style={{ color: "#8E8E93" }}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 5l7 7-7 7"
                  />
                </svg>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Conversation View ────────────────────────────────────
function Conversation({
  userId,
  currentUser,
  navigate,
}: {
  userId: string;
  currentUser: any;
  navigate: (path: string) => void;
}) {
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [msgInput, setMsgInput] = useState("");
  const [sending, setSending] = useState(false);
  const [partnerName, setPartnerName] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadMessages = useCallback(async () => {
    try {
      const data = await getMessages(userId, 50);
      setMessages(data.messages || []);
      // Derive partner name from first message that isn't ours
      if (!partnerName && data.messages?.length) {
        const other = data.messages.find((m: DirectMessage) => !m.isMine);
        if (other) setPartnerName(""); // name comes from thread; will be set from profile
      }
    } catch {
      // silent
    }
  }, [userId, partnerName]);

  useEffect(() => {
    setIsLoading(true);
    loadMessages().finally(() => setIsLoading(false));
    markThreadAsRead(userId).catch(() => {});

    // Poll for new messages every 4s
    pollRef.current = setInterval(() => {
      loadMessages();
    }, 4000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [userId, loadMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    if (!msgInput.trim() || sending) return;
    setSending(true);
    const text = msgInput.trim();
    setMsgInput("");
    try {
      const data = await sendMessage(userId, text);
      if (data.success && data.message) {
        setMessages((prev) => [...prev, data.message]);
      }
    } catch {
      // restore input on failure
      setMsgInput(text);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 5rem)" }}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/5">
        <button onClick={() => navigate("/dm")} className="text-white">
          <svg
            className="w-5 h-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
        </button>
        <button
          onClick={() => navigate(`/profile/${userId}`)}
          className="flex-1 min-w-0 text-left"
        >
          <h2 className="text-sm font-bold text-white truncate">
            {partnerName || "Conversation"}
          </h2>
          <p className="text-xs" style={{ color: "#8E8E93" }}>
            Tap to view profile
          </p>
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="animate-pulse flex gap-2">
                <div className="w-8 h-8 rounded-full bg-white/10" />
                <div className="flex-1 space-y-1">
                  <div className="h-3 bg-white/10 rounded w-24" />
                  <div className="h-3 bg-white/10 rounded w-48" />
                </div>
              </div>
            ))}
          </div>
        ) : messages.length === 0 ? (
          <div className="text-center py-12">
            <svg
              className="w-12 h-12 mx-auto mb-3"
              style={{ color: "#8E8E93" }}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
              />
            </svg>
            <p className="text-white font-medium text-sm">No messages yet</p>
            <p className="text-xs mt-1" style={{ color: "#8E8E93" }}>
              Say hello!
            </p>
          </div>
        ) : (
          messages.map((msg) => {
            const isMe = msg.isMine;
            return (
              <div
                key={msg.id}
                className={`flex gap-2 ${isMe ? "flex-row-reverse" : ""}`}
              >
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                  style={{
                    background: isMe
                      ? "rgba(230, 145, 56, 0.2)"
                      : "rgba(212, 0, 122, 0.2)",
                    color: isMe ? "#E69138" : "#D4007A",
                  }}
                >
                  {isMe
                    ? (currentUser?.firstName || currentUser?.username || "Y")[0].toUpperCase()
                    : (partnerName || "U")[0].toUpperCase()}
                </div>
                <div className={`max-w-[75%] ${isMe ? "text-right" : ""}`}>
                  <div
                    className={`flex items-center gap-1.5 mb-0.5 ${isMe ? "justify-end" : ""}`}
                  >
                    <span className="text-[10px]" style={{ color: "#8E8E93" }}>
                      {timeAgo(msg.createdAt)}
                    </span>
                  </div>
                  <div
                    className="rounded-2xl px-3 py-2 text-sm text-white"
                    style={{
                      background: isMe
                        ? "linear-gradient(135deg, #D4007A, #E69138)"
                        : "rgba(255,255,255,0.08)",
                    }}
                  >
                    {msg.content}
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input bar */}
      <div className="px-4 py-3 border-t border-white/5">
        <div className="flex gap-2">
          <input
            value={msgInput}
            onChange={(e) => setMsgInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
            placeholder="Type a message..."
            className="flex-1 bg-white/5 rounded-full px-4 py-2.5 text-sm text-white placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-white/20"
            maxLength={1000}
          />
          <button
            onClick={handleSend}
            disabled={!msgInput.trim() || sending}
            className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 disabled:opacity-30"
            style={{
              background: "linear-gradient(135deg, #D4007A, #E69138)",
            }}
          >
            <svg
              className="w-5 h-5 text-white"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
