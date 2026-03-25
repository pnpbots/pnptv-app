import React, { useState, useEffect, useRef, useCallback } from "react";
import { Outlet, NavLink, useNavigate, useLocation } from "react-router-dom";
import { BottomNav } from "./BottomNav";
import { useAuth } from "@/hooks/useAuth";
import { useTelegram } from "@/hooks/useTelegram";
import { useViewportHeight } from "@/hooks/useViewportHeight";
import { useOrientation } from "@/hooks/useOrientation";
import { CristinaWidget } from "@/components/CristinaWidget";

import { NotificationBell } from "@/components/NotificationBell";
import { Toast } from "@/components/Toast";
import { useNearbyToggle } from "@/components/NearbyBadge";
import { getMessageThreads, getHangoutGroups, markThreadAsRead, type MessageThread, type HangoutGroup } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { LandingPage } from "@/pages/LandingPage";
import { RadioWidget } from "@/components/RadioWidget";
import { NearbyWidget } from "@/components/NearbyWidget";
import { connectSocket } from "@/lib/socket";
import { MediaMessage } from "@/components/hangouts/MediaMessage";

const SIDEBAR_API_BASE = import.meta.env.VITE_API_URL || (typeof window !== "undefined" && window.location.hostname === "app.pnptv.app" ? "https://app.pnptv.app" : "https://pnptv.app");

// ── HamburgerIcon / CloseIcon ─────────────────────────────────────────────────

function HamburgerIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

// ── Conversation Hub helpers ──────────────────────────────────────────────────

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

interface ConversationItem {
  type: "dm" | "hangout";
  id: string;
  name: string;
  photoUrl: string | null;
  lastMessage: string | null;
  lastActivity: string;
  unreadCount: number;
  memberCount?: number;
  hasActiveCall?: boolean;
  path: string;
}

interface MobileConversationListProps {
  filter: "all" | "dms" | "hangouts";
  threads: MessageThread[];
  hangoutGroups: HangoutGroup[];
  hangoutGroupsLoading: boolean;
  onNavigate: (path: string, type: "dm" | "hangout") => void;
  noConversationsLabel: string;
}

function MobileConversationList({
  filter,
  threads,
  hangoutGroups,
  hangoutGroupsLoading,
  onNavigate,
  noConversationsLabel,
}: MobileConversationListProps) {
  const dmItems: ConversationItem[] = threads.map((th) => ({
    type: "dm",
    id: th.userId,
    name: th.firstName || th.username,
    photoUrl: th.photoUrl,
    lastMessage: th.lastMessage,
    lastActivity: th.lastMessageAt,
    unreadCount: th.unreadCount,
    path: `/dm/${th.userId}`,
  }));

  const hangoutItems: ConversationItem[] = hangoutGroups.map((g) => ({
    type: "hangout",
    id: String(g.id),
    name: g.name,
    photoUrl: g.avatarUrl,
    lastMessage: g.lastMessage,
    lastActivity: g.createdAt,
    unreadCount: g.unreadCount ?? 0,
    memberCount: g.memberCount,
    hasActiveCall: g.hasActiveCall,
    path: `/chat/${g.id}`,
  }));

  let items: ConversationItem[] = [];
  if (filter === "dms") {
    items = dmItems;
  } else if (filter === "hangouts") {
    items = hangoutItems;
  } else {
    // Merge and sort by most recent activity
    items = [...dmItems, ...hangoutItems].sort(
      (a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime()
    );
  }

  const isLoading = filter !== "dms" && hangoutGroupsLoading && hangoutItems.length === 0;

  if (isLoading) {
    return (
      <div className="space-y-2 pb-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-3 px-1 py-2 animate-pulse">
            <div className="w-10 h-10 rounded-full bg-white/10 flex-shrink-0" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3 bg-white/10 rounded w-28" />
              <div className="h-2.5 bg-white/10 rounded w-40" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <p className="text-xs text-pnp-textSecondary/50 text-center py-4 px-2">
        {noConversationsLabel}
      </p>
    );
  }

  return (
    <div className="space-y-0.5 flex-1 overflow-y-auto pb-1">
      {items.map((item) => (
        <button
          key={`${item.type}-${item.id}`}
          onClick={() => onNavigate(item.path, item.type)}
          className="w-full flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-pnp-surface transition-colors text-left"
        >
          {/* Avatar */}
          <div className="relative flex-shrink-0">
            {item.photoUrl &&
            (item.photoUrl.startsWith("/") || item.photoUrl.startsWith("http")) ? (
              <img
                src={item.photoUrl}
                alt=""
                className="w-10 h-10 rounded-full object-cover"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = "none";
                  (e.currentTarget.nextElementSibling as HTMLElement | null)?.style.removeProperty("display");
                }}
              />
            ) : null}
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
              style={{
                background: item.type === "hangout" ? "rgba(212,0,122,0.15)" : "rgba(212,0,122,0.2)",
                color: "#D4007A",
                display:
                  item.photoUrl &&
                  (item.photoUrl.startsWith("/") || item.photoUrl.startsWith("http"))
                    ? "none"
                    : undefined,
              }}
            >
              {item.type === "hangout" ? (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
                </svg>
              ) : (
                (item.name || "?")[0].toUpperCase()
              )}
            </div>
            {/* Active call indicator */}
            {item.hasActiveCall && (
              <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-pnp-background bg-green-500" />
            )}
          </div>

          {/* Text */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-1">
              <span
                className={`text-sm truncate ${
                  item.unreadCount > 0 ? "font-semibold text-pnp-textPrimary" : "font-medium text-pnp-textSecondary"
                }`}
              >
                {item.name}
              </span>
              <span className="text-[10px] text-pnp-textSecondary/50 flex-shrink-0">
                {timeAgo(item.lastActivity)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-1 mt-0.5">
              <span className="text-xs text-pnp-textSecondary/60 truncate">
                {item.lastMessage
                  ? item.lastMessage
                  : item.memberCount !== undefined
                    ? `${item.memberCount} members`
                    : ""}
              </span>
              {item.unreadCount > 0 && (
                <span className="flex-shrink-0 min-w-[18px] h-[18px] rounded-full text-[10px] font-bold text-white flex items-center justify-center px-1" style={{ background: "#D4007A" }}>
                  {item.unreadCount > 9 ? "9+" : item.unreadCount}
                </span>
              )}
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}

// ── SidebarDmChat ─────────────────────────────────────────────────────────────

interface SidebarDmMessage {
  id: number;
  sender_id: string;
  recipient_id: string;
  content: string | null;
  media_url: string | null;
  media_type: "image" | "video" | "audio" | null;
  media_mime?: string | null;
  media_thumb_url?: string | null;
  is_read: boolean;
  created_at: string;
}

interface SidebarDmChatProps {
  userId: string;
  partnerName: string;
  partnerPhoto: string | null;
  myDbId: string;
  onBack: () => void;
  onThreadsRefresh: () => void;
}

function SidebarDmChat({ userId, partnerName, partnerPhoto, myDbId, onBack, onThreadsRefresh }: SidebarDmChatProps) {
  const [messages, setMessages] = useState<SidebarDmMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [messageInput, setMessageInput] = useState("");
  const [sendingMessage, setSendingMessage] = useState(false);
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaPreview, setMediaPreview] = useState<string | null>(null);
  const [isTyping, setIsTyping] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const lastTypingEmit = useRef(0);

  const loadMessages = useCallback(async () => {
    setIsLoading(true);
    setChatError(null);
    try {
      const res = await fetch(`${SIDEBAR_API_BASE}/api/webapp/dm/conversation/${userId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load");
      const data = await res.json();
      if (data.success) {
        setMessages(data.messages || []);
        setHasMore((data.messages || []).length >= 30);
      }
    } catch {
      setChatError("Failed to load messages");
    } finally {
      setIsLoading(false);
    }
    markThreadAsRead(userId).catch(() => {});
    onThreadsRefresh();
  }, [userId, onThreadsRefresh]);

  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  // Auto-scroll to bottom on initial load
  useEffect(() => {
    if (!isLoading && messages.length > 0) {
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "auto" }), 50);
    }
  }, [isLoading]);

  // Socket: real-time incoming messages
  useEffect(() => {
    const socket = connectSocket();

    const onDmMessage = (msg: SidebarDmMessage) => {
      if (String(msg.sender_id) !== String(userId)) return;
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
      markThreadAsRead(userId).catch(() => {});
    };

    const onDmSent = (data: { success: boolean; message?: SidebarDmMessage }) => {
      if (!data.message) return;
      setMessages((prev) => {
        if (prev.some((m) => m.id === data.message!.id)) return prev;
        return [...prev, data.message!];
      });
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    };

    const onDmTyping = (data: { from: string }) => {
      if (String(data.from) !== String(userId)) return;
      setIsTyping(true);
      setTimeout(() => setIsTyping(false), 3000);
    };

    socket.on("dm:message", onDmMessage);
    socket.on("dm:sent", onDmSent);
    socket.on("dm:typing", onDmTyping);

    return () => {
      socket.off("dm:message", onDmMessage);
      socket.off("dm:sent", onDmSent);
      socket.off("dm:typing", onDmTyping);
    };
  }, [userId]);

  const emitTyping = () => {
    const now = Date.now();
    if (now - lastTypingEmit.current < 2000) return;
    lastTypingEmit.current = now;
    const socket = connectSocket();
    socket.emit("dm:typing", { recipientId: userId });
  };

  const handleSendMessage = async () => {
    if (!messageInput.trim() && !mediaFile) return;
    if (sendingMessage) return;
    setSendingMessage(true);
    setChatError(null);
    try {
      if (mediaFile) {
        const formData = new FormData();
        formData.append("media", mediaFile);
        if (messageInput.trim()) formData.append("content", messageInput.trim());
        const res = await fetch(`${SIDEBAR_API_BASE}/api/webapp/dm/media/${userId}`, {
          method: "POST",
          credentials: "include",
          body: formData,
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error((err as { error?: string }).error || "Failed to send media");
        }
        const data = await res.json();
        if (data.message) {
          setMessages((prev) => prev.some((m) => m.id === data.message.id) ? prev : [...prev, data.message]);
        }
        setMediaFile(null);
        if (mediaPreview) { URL.revokeObjectURL(mediaPreview); setMediaPreview(null); }
        setMessageInput("");
      } else {
        const res = await fetch(`${SIDEBAR_API_BASE}/api/webapp/dm/send/${userId}`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: messageInput.trim() }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error((err as { error?: string }).error || "Failed to send");
        }
        const data = await res.json();
        if (data.message) {
          setMessages((prev) => prev.some((m) => m.id === data.message.id) ? prev : [...prev, data.message]);
        }
        setMessageInput("");
      }
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    } catch (err) {
      setChatError(err instanceof Error ? err.message : "Failed to send message");
    } finally {
      setSendingMessage(false);
    }
  };

  const handleMediaSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setMediaFile(file);
    if (file.type.startsWith("image/")) {
      setMediaPreview(URL.createObjectURL(file));
    } else {
      setMediaPreview(null);
    }
    e.target.value = "";
  };

  const cancelMedia = () => {
    setMediaFile(null);
    if (mediaPreview) { URL.revokeObjectURL(mediaPreview); setMediaPreview(null); }
  };

  const loadMoreMessages = async () => {
    if (loadingMore || !hasMore || messages.length === 0) return;
    setLoadingMore(true);
    try {
      const oldest = messages[0];
      const res = await fetch(
        `${SIDEBAR_API_BASE}/api/webapp/dm/conversation/${userId}?cursor=${encodeURIComponent(oldest.created_at)}`,
        { credentials: "include" }
      );
      if (!res.ok) throw new Error("Failed");
      const data = await res.json();
      if (data.success) {
        setMessages((prev) => [...(data.messages || []), ...prev]);
        setHasMore((data.messages || []).length >= 30);
      }
    } catch { /* silent */ }
    finally { setLoadingMore(false); }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-2 py-2 border-b border-pnp-border flex-shrink-0">
        <button
          onClick={onBack}
          className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/5 active:scale-95 transition-all flex-shrink-0"
          aria-label="Back to conversations"
        >
          <svg className="w-4 h-4 text-pnp-textPrimary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        {/* Partner avatar */}
        <div className="relative flex-shrink-0">
          {partnerPhoto && (partnerPhoto.startsWith("/") || partnerPhoto.startsWith("http")) ? (
            <img src={partnerPhoto} alt="" className="w-8 h-8 rounded-full object-cover" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; (e.currentTarget.nextElementSibling as HTMLElement | null)?.style.removeProperty("display"); }} />
          ) : null}
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
            style={{
              background: "rgba(212,0,122,0.2)",
              color: "#D4007A",
              display: partnerPhoto && (partnerPhoto.startsWith("/") || partnerPhoto.startsWith("http")) ? "none" : undefined,
            }}
          >
            {(partnerName || "?")[0].toUpperCase()}
          </div>
        </div>

        <span className="text-sm font-semibold text-pnp-textPrimary truncate flex-1 min-w-0">
          {partnerName || "Conversation"}
        </span>
      </div>

      {/* Error banner */}
      {chatError && (
        <div className="px-3 py-1.5 bg-red-500/10 border-b border-red-500/20 flex-shrink-0">
          <p className="text-xs text-red-400">{chatError}</p>
        </div>
      )}

      {/* Messages area */}
      <div
        className="flex-1 min-h-0 overflow-y-auto px-2 py-2 space-y-1"
        onScroll={(e) => {
          const el = e.currentTarget;
          if (el.scrollTop < 60 && hasMore && !loadingMore) loadMoreMessages();
        }}
      >
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <div className="w-6 h-6 border-2 border-white/20 border-t-pnp-accent rounded-full animate-spin" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center px-4">
              <p className="text-lg mb-1">💬</p>
              <p className="text-xs text-pnp-textSecondary">Start a conversation!</p>
            </div>
          </div>
        ) : (
          <>
            {loadingMore && (
              <div className="flex justify-center py-1">
                <svg className="w-4 h-4 text-pnp-accent animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              </div>
            )}
            {messages.map((msg) => {
              const isMe = String(msg.sender_id) === String(myDbId);
              const timeStr = new Date(msg.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
              return (
                <div key={msg.id} className={`flex gap-1.5 ${isMe ? "flex-row-reverse" : "flex-row"}`}>
                  <div className={`max-w-[85%] flex flex-col ${isMe ? "items-end" : "items-start"}`}>
                    <div
                      className={`rounded-2xl px-2.5 py-1.5 text-xs break-words ${isMe ? "text-white rounded-br-md" : "bg-white/10 text-white rounded-bl-md"}`}
                      style={isMe ? { background: "linear-gradient(135deg, #D4007A, #E69138)" } : undefined}
                    >
                      {msg.media_url && msg.media_type && (
                        <div className="mb-1">
                          <MediaMessage
                            mediaUrl={msg.media_url}
                            mediaType={msg.media_type}
                            thumbUrl={msg.media_thumb_url}
                            onExpandImage={(url) => setLightboxUrl(url)}
                            isMe={isMe}
                          />
                        </div>
                      )}
                      {msg.content && <p>{msg.content}</p>}
                      <p className={`text-[9px] mt-0.5 ${isMe ? "text-white/60" : "text-pnp-textSecondary"}`}>{timeStr}</p>
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Typing indicator */}
      {isTyping && (
        <div className="px-3 py-1 flex-shrink-0">
          <p className="text-[10px] text-pnp-textSecondary italic">{partnerName || "User"} is typing...</p>
        </div>
      )}

      {/* Media preview */}
      {mediaFile && (
        <div className="px-2 py-1.5 border-t border-pnp-border flex items-center gap-2 flex-shrink-0">
          {mediaPreview ? (
            <img src={mediaPreview} alt="" className="w-10 h-10 rounded-lg object-cover" />
          ) : (
            <div className="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center">
              <svg className="w-4 h-4 text-pnp-textSecondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
              </svg>
            </div>
          )}
          <span className="text-[10px] text-pnp-textSecondary flex-1 truncate">{mediaFile.name}</span>
          <button onClick={cancelMedia} className="text-red-400 text-[10px] font-semibold">Remove</button>
        </div>
      )}

      {/* Input bar */}
      <div className="flex items-end gap-1.5 px-2 py-2 border-t border-pnp-border flex-shrink-0" style={{ background: "#1C1C1E" }}>
        <input
          ref={mediaInputRef}
          type="file"
          accept="image/*,video/*,audio/*"
          className="hidden"
          onChange={handleMediaSelect}
        />
        <button
          type="button"
          onClick={() => mediaInputRef.current?.click()}
          className="p-1.5 rounded-full text-pnp-textSecondary hover:text-white hover:bg-white/10 active:scale-90 transition-all flex-shrink-0"
          aria-label="Attach media"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13" />
          </svg>
        </button>

        <textarea
          value={messageInput}
          onChange={(e) => { setMessageInput(e.target.value); emitTyping(); }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendMessage(); }
          }}
          placeholder="Type a message..."
          className="flex-1 bg-white/5 text-white placeholder-pnp-textSecondary rounded-2xl px-3 py-2 text-xs resize-none outline-none focus:ring-1 focus:ring-pnp-accent/50 max-h-20"
          rows={1}
          style={{ minHeight: "36px" }}
        />

        <button
          type="button"
          onClick={handleSendMessage}
          disabled={sendingMessage || (!messageInput.trim() && !mediaFile)}
          className="p-1.5 rounded-full text-white active:scale-90 transition-all flex-shrink-0 disabled:opacity-30"
          style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
          aria-label="Send message"
        >
          {sendingMessage ? (
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
            </svg>
          )}
        </button>
      </div>

      {/* Lightbox */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-[80] bg-black/90 flex items-center justify-center"
          onClick={() => setLightboxUrl(null)}
        >
          <button
            onClick={() => setLightboxUrl(null)}
            className="absolute top-4 right-4 z-10 p-2 rounded-full bg-white/10 text-white"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <img
            src={lightboxUrl}
            alt=""
            className="max-w-full max-h-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}

// ── Layout ────────────────────────────────────────────────────────────────────

export function Layout() {
  const { isAuthenticated, isAdmin, user, isLoading } = useAuth();
  const { isTelegram } = useTelegram();
  useViewportHeight();
  const navigate = useNavigate();
  const location = useLocation();
  const t = useI18n();
  const [dmUnread, setDmUnread] = useState(0);
  const [threads, setThreads] = useState<MessageThread[]>([]);
  const [hangoutGroups, setHangoutGroups] = useState<HangoutGroup[]>([]);
  const [conversationFilter, setConversationFilter] = useState<"all" | "dms" | "hangouts">("all");
  const [hangoutGroupsLoading, setHangoutGroupsLoading] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [inlineDmUserId, setInlineDmUserId] = useState<string | null>(null);
  const { enabled: nearbyEnabled, toggle: toggleNearby } = useNearbyToggle();
  const mobileMenuRef = useRef<HTMLDivElement>(null);
  const isLandscape = useOrientation();
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" ? window.innerWidth < 1024 : false);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 1024);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const primaryLinks = [
    { to: "/", label: t.nav.home, end: true },
    { to: "/chat", label: t.nav.hangouts },
    { to: "/media", label: t.nav.prime },
    { to: "/live", label: t.nav.live },
    { to: "/channels", label: "Channels" },
    { to: "/dm", label: t.nav.messages },
    { to: "/main-stage", label: t.nav.mainStage },
    { to: "/creators/apply", label: t.nav.becomeModel },
  ];

  const secondaryLinks = [
    { to: "/blog", label: "Blog" },
    { to: "/support", label: "Help" },
    { to: "/community-resources", label: "Community" },
  ];

  const mobileSecondaryLinks = [
    { to: "/blog", label: "Blog" },
    { to: "/support", label: "Help" },
    { to: "/community-resources", label: "Community Resources" },
    { to: "/about", label: "About" },
    { to: "/careers", label: "Careers" },
    { to: "/creators/apply", label: t.nav.becomeModel },
  ];

  // Close mobile menu on route change and reset inline DM
  useEffect(() => {
    setMobileMenuOpen(false);
    setInlineDmUserId(null);
  }, [location.pathname]);

  // Close menu on outside click
  useEffect(() => {
    if (!mobileMenuOpen) return;
    function handleClick(e: MouseEvent) {
      if (mobileMenuRef.current && !mobileMenuRef.current.contains(e.target as Node)) {
        setMobileMenuOpen(false);
        setInlineDmUserId(null);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [mobileMenuOpen]);

  // Prevent body scroll when mobile menu is open
  useEffect(() => {
    if (mobileMenuOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileMenuOpen]);

  // Fetch hangout groups when mobile menu opens (cache in state between opens)
  useEffect(() => {
    if (!mobileMenuOpen || !isAuthenticated) return;
    if (hangoutGroups.length > 0) return; // already loaded
    setHangoutGroupsLoading(true);
    getHangoutGroups()
      .then((res) => {
        if (res.success) {
          setHangoutGroups(res.groups);
        }
      })
      .catch(() => {})
      .finally(() => setHangoutGroupsLoading(false));
  }, [mobileMenuOpen, isAuthenticated]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isAuthenticated) return;
    const fetchThreads = () => {
      getMessageThreads()
        .then((res) => {
          if (res.success) {
            setThreads(res.threads);
            setDmUnread(res.threads.filter((th) => th.unreadCount > 0).length);
          }
        })
        .catch(() => {});
    };
    fetchThreads();
    const interval = setInterval(fetchThreads, 30000);
    return () => clearInterval(interval);
  }, [isAuthenticated]);

  // Show loading state briefly to avoid flash
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-pnp-background">
        <div className="w-8 h-8 rounded-full border-2 border-[#D4007A] border-t-transparent animate-spin" />
      </div>
    );
  }

  // Unauthenticated: render the marketing landing page without any app chrome
  if (!isAuthenticated) {
    return <LandingPage />;
  }

  return (
    <div className="app-shell bg-pnp-background">
      {/* ── Desktop sidebar ─────────────────────────────────────────────────── */}
      <aside className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:flex lg:w-72 lg:flex-col border-r border-pnp-border glass-nav">
        {/* Sidebar header */}
        <div className="flex items-center justify-between px-6 h-16 border-b border-pnp-border">
          <img src="/logo-header.png" alt="PNPtv!" className="h-9 w-auto" />
          <div className="flex items-center gap-2">
            {isAdmin && (
              <button
                onClick={() => navigate("/admin")}
                className="p-1.5 rounded-lg text-pnp-textSecondary hover:text-pnp-textPrimary hover:bg-pnp-surface transition-colors"
                aria-label="Admin panel"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>
            )}
            <button
              onClick={() => navigate("/dm")}
              className="relative p-1.5 rounded-lg text-pnp-textSecondary hover:text-pnp-textPrimary hover:bg-pnp-surface transition-colors"
              aria-label="Direct messages"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              {dmUnread > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-[#D4007A] rounded-full text-[9px] font-bold text-white flex items-center justify-center">
                  {dmUnread > 9 ? "9+" : dmUnread}
                </span>
              )}
            </button>
            <button
              onClick={toggleNearby}
              className="p-1.5 rounded-lg transition-colors"
              style={{ color: nearbyEnabled ? "#FBFF00" : "#8E8E93" }}
              aria-label={nearbyEnabled ? "Disable nearby" : "Enable nearby"}
              title={nearbyEnabled ? "Nearby: ON" : "Nearby: OFF"}
            >
              <svg className="w-5 h-5" fill={nearbyEnabled ? "currentColor" : "none"} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
              </svg>
            </button>
            <NotificationBell />
          </div>
        </div>

        {/* Primary nav */}
        <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto" aria-label="Primary navigation">
          {primaryLinks.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.end}
              className={({ isActive }: { isActive: boolean }) =>
                `block px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? "nav-active"
                    : "text-pnp-textSecondary hover:text-pnp-textPrimary hover:bg-pnp-surface"
                }`
              }
            >
              {link.label}
            </NavLink>
          ))}
          {isAdmin && (
            <NavLink
              to="/admin"
              className={({ isActive }: { isActive: boolean }) =>
                `block px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? "nav-active"
                    : "text-pnp-textSecondary hover:text-pnp-textPrimary hover:bg-pnp-surface"
                }`
              }
            >
              {t.nav.admin}
            </NavLink>
          )}

          {/* Divider before secondary links */}
          <div className="pt-3 pb-1">
            <div className="h-px bg-pnp-border" />
          </div>

          {/* Secondary links */}
          {secondaryLinks.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }: { isActive: boolean }) =>
                `block px-3 py-1.5 rounded-lg text-xs transition-colors ${
                  isActive
                    ? "text-pnp-textPrimary"
                    : "text-pnp-textSecondary/70 hover:text-pnp-textSecondary hover:bg-pnp-surface"
                }`
              }
            >
              {link.label}
            </NavLink>
          ))}
        </nav>

        {/* User profile card + language */}
        <div className="p-4 border-t border-pnp-border">
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate("/profile")}
              className="flex items-center gap-3 flex-1 min-w-0 px-2 py-1.5 rounded-lg hover:bg-white/5 transition-colors"
            >
              {user?.photoUrl && (user.photoUrl.startsWith("/") || user.photoUrl.startsWith("http")) ? (
                <img
                  src={user.photoUrl}
                  alt={user.displayName || "Profile"}
                  className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; (e.currentTarget.nextElementSibling as HTMLElement | null)?.style.removeProperty("display"); }}
                />
              ) : null}
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
                style={{ background: "linear-gradient(135deg, #D4007A, #E69138)", color: "#fff", display: (user?.photoUrl && (user.photoUrl.startsWith("/") || user.photoUrl.startsWith("http"))) ? "none" : undefined }}
              >
                {(user?.displayName || t.nav.user)[0].toUpperCase()}
              </div>
              <span className="text-sm text-pnp-textSecondary truncate">
                {user?.displayName || t.nav.user}
              </span>
            </button>

          </div>
        </div>
      </aside>

      {/* ── Mobile topbar ────────────────────────────────────────────────────── */}
      <header className="lg:hidden sticky top-0 z-40 h-14 flex items-center justify-between px-4 glass-nav border-b border-pnp-border">
        <div className="flex items-center gap-2">
          {/* Hamburger */}
          <button
            onClick={() => setMobileMenuOpen(true)}
            className="p-1.5 -ml-1 text-pnp-textSecondary hover:text-pnp-textPrimary transition-colors"
            aria-label="Open menu"
            aria-expanded={mobileMenuOpen}
          >
            <HamburgerIcon />
          </button>
          <img src="/logo-header.png" alt="PNPtv!" className="h-9 w-auto" />
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={toggleNearby}
            className="p-1 rounded-lg transition-colors"
            style={{ color: nearbyEnabled ? "#FBFF00" : "#8E8E93" }}
            aria-label={nearbyEnabled ? "Disable nearby" : "Enable nearby"}
          >
            <svg className="w-5 h-5" fill={nearbyEnabled ? "currentColor" : "none"} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
            </svg>
          </button>
          <NotificationBell />
          <button
            onClick={() => navigate("/profile")}
            className="p-0.5 rounded-full transition-colors"
            aria-label="My profile"
          >
            {user?.photoUrl && (user.photoUrl.startsWith("/") || user.photoUrl.startsWith("http")) ? (
              <img
                src={user.photoUrl}
                alt=""
                className="w-7 h-7 rounded-full object-cover"
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; (e.currentTarget.nextElementSibling as HTMLElement | null)?.style.removeProperty("display"); }}
              />
            ) : null}
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold"
              style={{
                background: "linear-gradient(135deg, #D4007A, #E69138)",
                color: "#fff",
                display: user?.photoUrl && (user.photoUrl.startsWith("/") || user.photoUrl.startsWith("http")) ? "none" : undefined,
              }}
            >
              {(user?.displayName || "U")[0].toUpperCase()}
            </div>
          </button>
        </div>
      </header>

      {/* ── Mobile slide-out menu ─────────────────────────────────────────────── */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation menu">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => { setMobileMenuOpen(false); setInlineDmUserId(null); }}
            aria-hidden="true"
          />

          {/* Panel — slides in from left */}
          <div
            ref={mobileMenuRef}
            className="relative w-72 h-full flex flex-col glass-nav border-r border-pnp-border animate-fade-in-up"
            style={{ animationDuration: "0.18s" }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-3 h-11 border-b border-pnp-border flex-shrink-0">
              <img src="/logo-header.png" alt="PNPtv!" className="h-7 w-auto" />
              <button
                className="p-1.5 text-pnp-textSecondary hover:text-pnp-textPrimary transition-colors"
                onClick={() => { setMobileMenuOpen(false); setInlineDmUserId(null); }}
                aria-label="Close menu"
              >
                <CloseIcon />
              </button>
            </div>

            {/* Scrollable nav body — switches between conversation hub and inline DM chat */}
            {inlineDmUserId ? (
              <div className="flex-1 min-h-0 flex flex-col">
                {(() => {
                  const dmThread = threads.find((th) => String(th.userId) === String(inlineDmUserId));
                  return (
                    <SidebarDmChat
                      userId={inlineDmUserId}
                      partnerName={dmThread ? (dmThread.firstName || dmThread.username) : ""}
                      partnerPhoto={dmThread?.photoUrl ?? null}
                      myDbId={user?.dbId ?? ""}
                      onBack={() => {
                        setInlineDmUserId(null);
                        // Refresh threads so unread counts update in the list
                        getMessageThreads()
                          .then((res) => {
                            if (res.success) {
                              setThreads(res.threads);
                              setDmUnread(res.threads.filter((th) => th.unreadCount > 0).length);
                            }
                          })
                          .catch(() => {});
                      }}
                      onThreadsRefresh={() => {
                        getMessageThreads()
                          .then((res) => {
                            if (res.success) {
                              setThreads(res.threads);
                              setDmUnread(res.threads.filter((th) => th.unreadCount > 0).length);
                            }
                          })
                          .catch(() => {});
                      }}
                    />
                  );
                })()}
              </div>
            ) : (
              <>
                <nav className="flex-1 overflow-y-auto flex flex-col min-h-0" aria-label="Mobile navigation">
                  {/* ── Conversation Hub ─────────────────────────────────── */}
                  <div className="px-3 pt-2 pb-1 flex flex-col flex-1 min-h-0">
                    {/* Filter tabs */}
                    <div className="flex gap-1 mb-2 flex-shrink-0">
                      {(["all", "dms", "hangouts"] as const).map((filter) => {
                        const label =
                          filter === "all"
                            ? t.nav.filterAll
                            : filter === "dms"
                              ? t.nav.filterDMs
                              : t.nav.filterHangouts;
                        const isActive = conversationFilter === filter;
                        return (
                          <button
                            key={filter}
                            onClick={() => setConversationFilter(filter)}
                            className={`flex-1 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                              isActive
                                ? "text-white"
                                : "text-pnp-textSecondary hover:text-pnp-textPrimary hover:bg-pnp-surface"
                            }`}
                            style={isActive ? { background: "#D4007A" } : {}}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>

                    {/* Conversation list */}
                    <MobileConversationList
                      filter={conversationFilter}
                      threads={threads}
                      hangoutGroups={hangoutGroups}
                      hangoutGroupsLoading={hangoutGroupsLoading}
                      onNavigate={(path, type) => {
                        if (type === "dm") {
                          const dmUserId = path.replace("/dm/", "");
                          setInlineDmUserId(dmUserId);
                        } else {
                          setMobileMenuOpen(false);
                          setInlineDmUserId(null);
                          navigate(path);
                        }
                      }}
                      noConversationsLabel={t.nav.noConversations}
                    />
                  </div>
                </nav>

                {/* Bottom section: secondary links + admin + profile */}
                <div className="flex-shrink-0 border-t border-pnp-border">
                  {/* Compact secondary links row */}
                  <div className="px-3 pt-2 pb-1 flex flex-wrap gap-x-3 gap-y-0.5">
                    {mobileSecondaryLinks.map((link) => (
                      <NavLink
                        key={link.to}
                        to={link.to}
                        onClick={() => setMobileMenuOpen(false)}
                        className={({ isActive }: { isActive: boolean }) =>
                          `text-[11px] transition-colors ${
                            isActive
                              ? "text-pnp-textPrimary"
                              : "text-pnp-textSecondary/50 hover:text-pnp-textSecondary"
                          }`
                        }
                      >
                        {link.label}
                      </NavLink>
                    ))}
                    {isAdmin && (
                      <NavLink
                        to="/admin"
                        onClick={() => setMobileMenuOpen(false)}
                        className={({ isActive }: { isActive: boolean }) =>
                          `text-[11px] font-semibold transition-colors ${
                            isActive
                              ? "nav-active"
                              : "text-pnp-textSecondary/50 hover:text-pnp-textSecondary"
                          }`
                        }
                      >
                        {t.nav.admin}
                      </NavLink>
                    )}
                  </div>

                  {/* User profile card */}
                  <div className="px-3 pb-3 pt-1">
                    <button
                      onClick={() => {
                        setMobileMenuOpen(false);
                        navigate("/profile");
                      }}
                      className="flex items-center gap-2 w-full px-2 py-1.5 rounded-lg hover:bg-white/5 transition-colors"
                    >
                      {user?.photoUrl && (user.photoUrl.startsWith("/") || user.photoUrl.startsWith("http")) ? (
                        <img
                          src={user.photoUrl}
                          alt={user.displayName || "Profile"}
                          className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; (e.currentTarget.nextElementSibling as HTMLElement | null)?.style.removeProperty("display"); }}
                        />
                      ) : null}
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                        style={{ background: "linear-gradient(135deg, #D4007A, #E69138)", color: "#fff", display: (user?.photoUrl && (user.photoUrl.startsWith("/") || user.photoUrl.startsWith("http"))) ? "none" : undefined }}
                      >
                        {(user?.displayName || t.nav.user)[0].toUpperCase()}
                      </div>
                      <div className="text-left min-w-0">
                        <div className="text-sm font-medium text-pnp-textPrimary truncate">
                          {user?.displayName || t.nav.user}
                        </div>
                      </div>
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Main content ─────────────────────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto overscroll-contain lg:pl-72 lg:overflow-visible lg:pb-0 pb-16">
        <Outlet />
      </main>

      {/* Bottom nav */}
      <div className="flex-shrink-0 lg:hidden">
        <BottomNav />
      </div>

      {/* Widgets: compact strip in landscape video calls on mobile, normal FABs otherwise */}
      {isAuthenticated && (() => {
        const inVideoCall = location.pathname.startsWith("/chat/") || location.pathname === "/main-stage";
        const showWidgetStrip = isLandscape && isMobile && inVideoCall;

        if (showWidgetStrip) {
          return (
            <div className="fixed bottom-3 right-3 z-[38] flex items-center gap-2 rounded-full px-2 py-1.5" style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(8px)" }}>
              <RadioWidget compact />
              <NearbyWidget compact />
              <CristinaWidget compact />
            </div>
          );
        }

        return (
          <>
            <RadioWidget />
            <NearbyWidget />
            <CristinaWidget />
          </>
        );
      })()}

      {/* Toast notifications */}
      {isAuthenticated && <Toast />}
    </div>
  );
}
