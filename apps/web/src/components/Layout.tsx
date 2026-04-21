import React, { useState, useEffect, useRef, lazy, Suspense } from "react";
import { Outlet, NavLink, useNavigate, useLocation } from "react-router-dom";
import { BottomNav } from "./BottomNav";
import { useAuth } from "@/hooks/useAuth";
import { useTelegram } from "@/hooks/useTelegram";
import { useViewportHeight } from "@/hooks/useViewportHeight";
import { useOrientation } from "@/hooks/useOrientation";
const CristinaWidget = lazy(() => import("@/components/CristinaWidget").then((m) => ({ default: m.CristinaWidget })));

import { NotificationBell } from "@/components/NotificationBell";
import { Toast } from "@/components/Toast";
import { useNearbyToggle } from "@/components/NearbyBadge";
import { getMessageThreads, getHangoutGroups, markThreadAsRead, getProfile, type MessageThread, type HangoutGroup } from "@/lib/api";
import { useTier } from "@/hooks/useTier";
import { useI18n } from "@/lib/i18n";
import { LandingPage } from "@/pages/LandingPage";
import { connectSocket } from "@/lib/socket";
import { MediaMessage } from "@/components/hangouts/MediaMessage";

const SIDEBAR_DM_BASE = import.meta.env.VITE_API_URL || "";

// ── FlashBanner ───────────────────────────────────────────────────────────────
// Reads a one-shot message stashed by another route (e.g. HangoutInviteRedirect
// when the invite is invalid) from sessionStorage["pnptv:flash"] and shows it
// for 5s. Self-contained so any future redirect can drop a flash message
// without touching the toast/notifications system.

type FlashPayload = { type?: "error" | "success" | "info"; message: string };

function FlashBanner() {
  const [flash, setFlash] = useState<FlashPayload | null>(null);

  useEffect(() => {
    let raw: string | null = null;
    try { raw = sessionStorage.getItem("pnptv:flash"); } catch {}
    if (!raw) return;
    try { sessionStorage.removeItem("pnptv:flash"); } catch {}
    let parsed: FlashPayload | null = null;
    try {
      const obj = JSON.parse(raw);
      if (obj && typeof obj.message === "string") parsed = obj;
    } catch {
      // Allow plain string payloads too — be lenient about producers.
      parsed = { message: raw };
    }
    if (!parsed) return;
    setFlash(parsed);
    const t = setTimeout(() => setFlash(null), 5000);
    return () => clearTimeout(t);
  }, []);

  if (!flash) return null;

  const accent =
    flash.type === "success" ? "border-green-500/50 bg-green-500/15 text-green-200"
    : flash.type === "info"  ? "border-sky-500/50 bg-sky-500/15 text-sky-200"
    : "border-red-500/50 bg-red-500/15 text-red-200";

  return (
    <div
      role="alert"
      className={`fixed top-4 left-1/2 -translate-x-1/2 z-[300] max-w-sm px-4 py-2.5 rounded-2xl border backdrop-blur-md text-sm shadow-2xl flex items-center gap-3 animate-in slide-in-from-top-2 duration-200 ${accent}`}
    >
      <span className="flex-1">{flash.message}</span>
      <button
        type="button"
        onClick={() => setFlash(null)}
        className="text-white/70 hover:text-white"
        aria-label="Dismiss message"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

// ── HamburgerIcon / CloseIcon ─────────────────────────────────────────────────

function HamburgerIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
      <rect x="3" y="3" width="7" height="18" rx="1.5" />
      <path strokeLinecap="round" d="M14 6h7M14 10h7M14 14h5" />
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
    id: th.userId ?? th.partnerId,
    name: (th.firstName ?? th.partnerFirstName) || (th.username ?? th.partnerUsername),
    photoUrl: th.photoUrl ?? th.partnerPhoto,
    lastMessage: th.lastMessage,
    lastActivity: th.lastMessageAt,
    unreadCount: th.unreadCount ?? th.unread,
    path: `/dm/${th.userId ?? th.partnerId}`,
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
  myDbId: string;
  onBack: () => void;
}

function SidebarDmChat({ userId, myDbId, onBack }: SidebarDmChatProps) {
  const [messages, setMessages] = useState<SidebarDmMessage[]>([]);
  const dmNavigate = useNavigate();
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
  const [partnerName, setPartnerName] = useState("");
  const [partnerPhoto, setPartnerPhoto] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const lastTypingEmit = useRef(0);
  const hasFetched = useRef(false);

  useEffect(() => {
    if (hasFetched.current) return;
    hasFetched.current = true;

    // Fetch partner info
    fetch(`${SIDEBAR_DM_BASE}/api/webapp/dm/user/${userId}`, { credentials: "include" })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data?.success && data.user) {
          setPartnerName(data.user.first_name || data.user.username || "");
          setPartnerPhoto(data.user.photo_file_id || null);
        }
      })
      .catch(() => {});

    // Fetch messages
    fetch(`${SIDEBAR_DM_BASE}/api/webapp/dm/conversation/${userId}`, { credentials: "include" })
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load");
        return r.json();
      })
      .then((data) => {
        if (data.success) {
          setMessages(data.messages || []);
          setHasMore((data.messages || []).length >= 30);
        }
      })
      .catch(() => {
        setChatError("Failed to load messages");
      })
      .finally(() => {
        setIsLoading(false);
      });

    markThreadAsRead(userId).catch(() => {});
  }, [userId]);

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
        const res = await fetch(`${SIDEBAR_DM_BASE}/api/webapp/dm/media/${userId}`, {
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
        const res = await fetch(`${SIDEBAR_DM_BASE}/api/webapp/dm/send/${userId}`, {
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
        `${SIDEBAR_DM_BASE}/api/webapp/dm/conversation/${userId}?cursor=${encodeURIComponent(oldest.created_at)}`,
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

        {/* Partner avatar — clickable to profile */}
        <button onClick={() => dmNavigate(`/profile/${userId}`)} className="relative flex-shrink-0 cursor-pointer">
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
        </button>

        <span onClick={() => dmNavigate(`/profile/${userId}`)} className="text-sm font-semibold text-pnp-textPrimary truncate flex-1 min-w-0 cursor-pointer hover:underline">
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
          className="flex-1 bg-white/5 text-white placeholder-pnp-textSecondary rounded-2xl px-3 py-2 resize-none outline-none focus:ring-1 focus:ring-pnp-accent/50 max-h-20"
          rows={1}
          style={{ minHeight: "36px", fontSize: "16px" }}
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
  const { isAuthenticated, isAdmin, user, isLoading, logout } = useAuth();
  const { tier, isPrime, isMember } = useTier();
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
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<{ users: any[]; creators: any[]; posts: any[] } | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const { enabled: nearbyEnabled, toggle: toggleNearby } = useNearbyToggle();
  const mobileMenuRef = useRef<HTMLDivElement>(null);
  const [profileData, setProfileData] = useState<any>(null);
  const isLandscape = useOrientation();
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" ? window.innerWidth < 1024 : false);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 1024);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const navSections = [
    {
      label: "SOCIAL",
      links: [
        { to: "/?view=feed", label: "PNP Feed" },
        { to: "/channels", label: "PNP Channels" },
      ],
    },
    {
      label: "CONNECT",
      links: [
        { to: "/?view=hangouts", label: "PNP Hangouts" },
        { to: "/dm", label: "Inbox" },
      ],
    },
  ];

  const secondaryLinks = [
    { to: "/support", label: t.nav.help || "Help" },
    { to: "/settings", label: t.nav.settings || "Settings" },
  ];

  const mobileSecondaryLinks = [
    { to: "/support", label: t.nav.help || "Help" },
    { to: "/settings", label: t.nav.settings || "Settings" },
    { to: "/about", label: "About" },
    { to: "/community-resources", label: "Community" },
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

  // Fetch profile data when mobile menu opens
  useEffect(() => {
    if (!mobileMenuOpen || profileData) return;
    getProfile().then((r) => { if (r.success) setProfileData(r.profile); }).catch(() => {});
  }, [mobileMenuOpen, profileData]);

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

  // Fetch hangout groups on mount (for unread badge) and when mobile menu opens
  useEffect(() => {
    if (!isAuthenticated) return;
    const fetch = () => {
      setHangoutGroupsLoading(true);
      getHangoutGroups()
        .then((res) => { if (res.success) setHangoutGroups(res.groups); })
        .catch(() => {})
        .finally(() => setHangoutGroupsLoading(false));
    };
    fetch();
    const interval = setInterval(fetch, 60000);
    return () => clearInterval(interval);
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const fetchThreads = () => {
      getMessageThreads()
        .then((res) => {
          if (res.success) {
            setThreads(res.threads);
            setDmUnread(res.threads.filter((th) => (th.unreadCount ?? th.unread) > 0).length);
          }
        })
        .catch(() => {});
    };
    fetchThreads();
    const interval = setInterval(fetchThreads, 30000);
    return () => clearInterval(interval);
  }, [isAuthenticated]);

  // Debounced search
  useEffect(() => {
    if (!searchOpen || searchQuery.trim().length < 2) {
      setSearchResults(null);
      return;
    }
    const timer = setTimeout(() => {
      setSearchLoading(true);
      fetch(`/api/webapp/search?q=${encodeURIComponent(searchQuery.trim())}`, { credentials: "include" })
        .then((r) => r.json())
        .then((data) => {
          if (data.success !== false) {
            setSearchResults({
              users: data.users || [],
              creators: data.creators || [],
              posts: data.posts || [],
            });
          }
        })
        .catch(() => {})
        .finally(() => setSearchLoading(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, searchOpen]);

  const handleSearchClose = () => {
    setSearchOpen(false);
    setSearchQuery("");
    setSearchResults(null);
  };

  const handleLogout = () => {
    if (window.confirm("Sign out of PNPtv?")) {
      logout();
    }
  };

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
        <div className="flex items-center justify-between px-5 h-16 border-b border-pnp-border">
          <img src="/logo-header.png" alt="PNPtv!" className="h-9 w-auto" />
          <div className="flex items-center gap-1">
            {/* Search */}
            <button
              onClick={() => setSearchOpen(true)}
              className="p-2 rounded-lg text-pnp-textSecondary hover:text-pnp-textPrimary hover:bg-pnp-surface transition-colors"
              aria-label="Search"
              title="Search"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </button>
            {/* DM */}
            <button
              onClick={() => navigate("/dm")}
              className="relative p-2 rounded-lg text-pnp-textSecondary hover:text-pnp-textPrimary hover:bg-pnp-surface transition-colors"
              aria-label="Messages"
              title="Direct Messages"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              {dmUnread > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-0.5 bg-[#D4007A] rounded-full text-[9px] font-bold text-white flex items-center justify-center">
                  {dmUnread > 9 ? "9+" : dmUnread}
                </span>
              )}
            </button>
            <NotificationBell />
            {/* Logout */}
            <button
              onClick={handleLogout}
              className="p-2 rounded-lg text-pnp-textSecondary hover:text-pnp-textPrimary hover:bg-pnp-surface transition-colors"
              aria-label="Sign out"
              title="Sign out"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
              </svg>
            </button>
          </div>
        </div>

        {/* Primary nav — grouped sections */}
        <nav className="flex-1 py-4 px-3 overflow-y-auto" aria-label="Primary navigation">
          {navSections.map((section, idx) => (
            <div key={section.label} className={idx > 0 ? "mt-4" : ""}>
              <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-pnp-textSecondary/50">
                {section.label}
              </div>
              <div className="space-y-0.5">
                {section.links.map((link) => (
                  <NavLink
                    key={link.to}
                    to={link.to}
                    end={(link as any).end}
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
              </div>
            </div>
          ))}

          {isAdmin && (
            <div className="mt-4">
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
            </div>
          )}

          {user?.creator_status === "active" && (
            <div className="mt-2">
              <NavLink
                to="/creators"
                className={({ isActive }: { isActive: boolean }) =>
                  `block px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? "nav-active"
                      : "text-pnp-textSecondary hover:text-pnp-textPrimary hover:bg-pnp-surface"
                  }`
                }
              >
                {t.nav.creatorStudio || "Creator Studio"}
              </NavLink>
            </div>
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
      <header className="lg:hidden sticky top-0 z-40 h-14 flex items-center justify-between px-3 glass-nav border-b border-pnp-border">
        {/* Left: logo */}
        <img src="/logo-header.png" alt="PNPtv!" className="h-8 w-auto max-w-[110px] object-contain" />

        {/* Right: Search + DM + Bell + Hamburger + Logout */}
        <div className="flex items-center gap-0.5">
          {/* Search */}
          <button
            onClick={() => setSearchOpen(true)}
            className="p-2 rounded-lg text-pnp-textSecondary hover:text-pnp-textPrimary transition-colors"
            aria-label="Search"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </button>
          {/* DM */}
          <button
            onClick={() => navigate("/dm")}
            className="relative p-2 rounded-lg text-pnp-textSecondary hover:text-pnp-textPrimary transition-colors"
            aria-label="Messages"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            {dmUnread > 0 && (
              <span className="absolute top-0.5 right-0.5 min-w-[16px] h-4 px-0.5 bg-[#D4007A] rounded-full text-[9px] font-bold text-white flex items-center justify-center">
                {dmUnread > 9 ? "9+" : dmUnread}
              </span>
            )}
          </button>
          <NotificationBell />

          {/* Avatar — opens profile/settings menu */}
          <button
            onClick={() => setMobileMenuOpen(true)}
            className="relative ml-1 rounded-full transition-transform active:scale-95"
            aria-label="Open profile menu"
            aria-expanded={mobileMenuOpen}
          >
            {user?.photoUrl && (user.photoUrl.startsWith("/") || user.photoUrl.startsWith("http")) ? (
              <img
                src={user.photoUrl}
                alt={user.displayName || "Profile"}
                className="w-9 h-9 rounded-full object-cover ring-2 ring-white/10"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = "none";
                  (e.currentTarget.nextElementSibling as HTMLElement | null)?.style.removeProperty("display");
                }}
              />
            ) : null}
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold ring-2 ring-white/10"
              style={{
                background: "linear-gradient(135deg, #D4007A, #E69138)",
                color: "#fff",
                display: user?.photoUrl && (user.photoUrl.startsWith("/") || user.photoUrl.startsWith("http")) ? "none" : undefined,
              }}
            >
              {(user?.displayName || user?.username || "U").charAt(0).toUpperCase()}
            </div>
          </button>
        </div>
      </header>

      {/* ── Mobile slide-out menu ─────────────────────────────────────────────── */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 flex justify-end lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation menu">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => { setMobileMenuOpen(false); setInlineDmUserId(null); }}
            aria-hidden="true"
          />

          {/* Panel — slides in from right */}
          <div
            ref={mobileMenuRef}
            className="relative w-[min(288px,85vw)] h-full flex flex-col glass-nav border-l border-pnp-border animate-fade-in-up"
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

            {/* Profile card */}
            <div className="px-3 pt-3 pb-2 border-b border-pnp-border flex-shrink-0">
              <div className="flex items-center gap-3 mb-2">
                {user?.photoUrl && (user.photoUrl.startsWith("/") || user.photoUrl.startsWith("http")) ? (
                  <img src={user.photoUrl} alt="" className="w-12 h-12 rounded-full object-cover ring-2 ring-[#D4007A]/30 flex-shrink-0" />
                ) : (
                  <div className="w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold flex-shrink-0" style={{ background: "linear-gradient(135deg, #D4007A, #E69138)", color: "#fff" }}>
                    {(user?.displayName || "U")[0].toUpperCase()}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-white truncate">{user?.displayName || "Member"}</p>
                  {user?.username && <p className="text-[11px] text-pnp-textSecondary truncate">@{user.username}</p>}
                  <span
                    className="inline-block mt-0.5 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase"
                    style={{
                      background: isPrime ? "linear-gradient(135deg, #D4007A, #E69138)" : isMember ? "rgba(94,209,196,0.2)" : "rgba(255,255,255,0.08)",
                      color: isPrime ? "#fff" : isMember ? "#5ED1C4" : "#8E8E93",
                    }}
                  >
                    {tier || "free"}
                  </span>
                </div>
              </div>
              {profileData?.subscriptionExpires && (
                <div className="flex items-center justify-between px-2 py-1 rounded-lg bg-white/5 mb-2">
                  <span className="text-[11px] text-pnp-textSecondary">Next payment</span>
                  <span className="text-[11px] font-medium text-white">
                    {new Date(profileData.subscriptionExpires).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                  </span>
                </div>
              )}
              <button
                onClick={() => { setMobileMenuOpen(false); navigate("/profile"); }}
                className="w-full py-1.5 rounded-xl text-[11px] font-bold text-white transition-all active:scale-98"
                style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
              >
                View Full Profile
              </button>
            </div>

            {/* Scrollable link menu */}
            <nav className="flex-1 overflow-y-auto" aria-label="Mobile navigation">
              <div className="px-3 py-3 space-y-4">

                {/* ── Account ──────────────────────────────────────────── */}
                <div>
                  <p className="px-2 mb-1 text-[10px] font-semibold uppercase tracking-wider text-pnp-textSecondary/50">Account</p>
                  {[
                    { to: "/my-access", label: t.nav.myAccess || "My Access" },
                    { to: "/settings", label: t.nav.settings || "Settings" },
                    { to: "/support", label: t.nav.help || "Help & Support" },
                  ].map((link) => (
                    <NavLink
                      key={link.to}
                      to={link.to}
                      onClick={() => setMobileMenuOpen(false)}
                      className={({ isActive }: { isActive: boolean }) =>
                        `block px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                          isActive ? "nav-active" : "text-pnp-textSecondary hover:text-pnp-textPrimary hover:bg-pnp-surface"
                        }`
                      }
                    >
                      {link.label}
                    </NavLink>
                  ))}
                </div>

                {/* ── Community ────────────────────────────────────────── */}
                <div>
                  <p className="px-2 mb-1 text-[10px] font-semibold uppercase tracking-wider text-pnp-textSecondary/50">Community</p>
                  {[
                    { to: "/community-resources", label: "Community Resources" },
                    { to: "/about", label: "About PNPtv!" },
                    { to: "/blog", label: "Blog" },
                  ].map((link) => (
                    <NavLink
                      key={link.to}
                      to={link.to}
                      onClick={() => setMobileMenuOpen(false)}
                      className={({ isActive }: { isActive: boolean }) =>
                        `block px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                          isActive ? "nav-active" : "text-pnp-textSecondary hover:text-pnp-textPrimary hover:bg-pnp-surface"
                        }`
                      }
                    >
                      {link.label}
                    </NavLink>
                  ))}
                </div>

                {/* ── Legal ────────────────────────────────────────────── */}
                <div>
                  <p className="px-2 mb-1 text-[10px] font-semibold uppercase tracking-wider text-pnp-textSecondary/50">Legal</p>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 px-2">
                    {[
                      { to: "/terms", label: "Terms" },
                      { to: "/privacy", label: "Privacy" },
                      { to: "/community-guidelines", label: "Guidelines" },
                      { to: "/content-policy", label: "Content Policy" },
                      { to: "/dmca", label: "DMCA" },
                      { to: "/refunds", label: "Refunds" },
                    ].map((link) => (
                      <NavLink
                        key={link.to}
                        to={link.to}
                        onClick={() => setMobileMenuOpen(false)}
                        className={({ isActive }: { isActive: boolean }) =>
                          `text-xs py-1 transition-colors ${
                            isActive ? "text-pnp-textPrimary" : "text-pnp-textSecondary/60 hover:text-pnp-textSecondary"
                          }`
                        }
                      >
                        {link.label}
                      </NavLink>
                    ))}
                  </div>
                </div>

                {/* ── Admin (conditional) ───────────────────────────────── */}
                {isAdmin && (
                  <div>
                    <p className="px-2 mb-1 text-[10px] font-semibold uppercase tracking-wider text-pnp-textSecondary/50">Admin</p>
                    <NavLink
                      to="/admin"
                      onClick={() => setMobileMenuOpen(false)}
                      className={({ isActive }: { isActive: boolean }) =>
                        `block px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                          isActive ? "nav-active" : "text-pnp-textSecondary hover:text-pnp-textPrimary hover:bg-pnp-surface"
                        }`
                      }
                    >
                      {t.nav.admin}
                    </NavLink>
                  </div>
                )}

                {user?.creator_status === "active" && (
                  <div>
                    <p className="px-2 mb-1 text-[10px] font-semibold uppercase tracking-wider text-pnp-textSecondary/50">Creator</p>
                    <NavLink
                      to="/creators"
                      onClick={() => setMobileMenuOpen(false)}
                      className={({ isActive }: { isActive: boolean }) =>
                        `block px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                          isActive ? "nav-active" : "text-pnp-textSecondary hover:text-pnp-textPrimary hover:bg-pnp-surface"
                        }`
                      }
                    >
                      {t.nav.creatorStudio || "Creator Studio"}
                    </NavLink>
                  </div>
                )}

                {/* ── Sign out ──────────────────────────────────────────── */}
                <div className="pt-2 mt-2 border-t border-pnp-border">
                  <button
                    onClick={() => { setMobileMenuOpen(false); handleLogout(); }}
                    className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-sm font-medium text-pnp-textSecondary hover:text-red-400 hover:bg-red-500/10 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
                    </svg>
                    Sign out
                  </button>
                </div>

              </div>
            </nav>
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

      {/* Unified Cristina widget: AI Chat + VJ + Travel Agent — code-split to remove from initial bundle */}
      {isAuthenticated && (() => {
        const inVideoCall = location.pathname.startsWith("/chat/");
        const showCompact = isLandscape && isMobile && inVideoCall;
        return (
          <Suspense fallback={null}>
            <CristinaWidget compact={showCompact} />
          </Suspense>
        );
      })()}

      {/* ── Global Search Overlay ─────────────────────────────────────────────── */}
      {searchOpen && (
        <div className="fixed inset-0 z-50 bg-pnp-background flex flex-col" role="dialog" aria-modal="true" aria-label="Search">
          {/* Header */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-pnp-border flex-shrink-0">
            <button
              onClick={handleSearchClose}
              className="p-1.5 rounded-lg text-pnp-textSecondary hover:text-pnp-textPrimary hover:bg-pnp-surface transition-colors flex-shrink-0"
              aria-label="Close search"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
              </svg>
            </button>
            <div className="flex-1 flex items-center gap-2 bg-pnp-surface rounded-xl px-3 py-2">
              <svg className="w-4 h-4 text-pnp-textSecondary flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                autoFocus
                type="text"
                placeholder="Search people, creators, posts..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Escape") handleSearchClose(); }}
                className="flex-1 bg-transparent text-pnp-textPrimary text-sm outline-none placeholder:text-pnp-textSecondary min-w-0"
              />
              {searchQuery && (
                <button
                  onClick={() => { setSearchQuery(""); setSearchResults(null); }}
                  className="flex-shrink-0 text-pnp-textSecondary hover:text-pnp-textPrimary transition-colors"
                  aria-label="Clear search"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          </div>

          {/* Results */}
          <div className="flex-1 overflow-y-auto">
            {searchLoading ? (
              <div className="flex items-center justify-center py-16">
                <svg className="w-6 h-6 text-pnp-accent animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              </div>
            ) : searchQuery.trim().length < 2 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center px-6">
                <svg className="w-10 h-10 text-pnp-textSecondary/30 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <p className="text-sm text-pnp-textSecondary">Type at least 2 characters to search</p>
              </div>
            ) : !searchResults || (searchResults.users.length === 0 && searchResults.creators.length === 0 && searchResults.posts.length === 0) ? (
              <div className="flex flex-col items-center justify-center py-20 text-center px-6">
                <svg className="w-10 h-10 text-pnp-textSecondary/30 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.182 16.318A4.486 4.486 0 0012.016 15a4.486 4.486 0 00-3.198 1.318M21 12a9 9 0 11-18 0 9 9 0 0118 0zM9.75 9.75c0 .414-.168.75-.375.75S9 10.164 9 9.75 9.168 9 9.375 9s.375.336.375.75zm-.375 0h.008v.015h-.008V9.75zm5.625 0c0 .414-.168.75-.375.75s-.375-.336-.375-.75.168-.75.375-.75.375.336.375.75zm-.375 0h.008v.015h-.008V9.75z" />
                </svg>
                <p className="text-sm text-pnp-textSecondary">No results for &ldquo;{searchQuery}&rdquo;</p>
              </div>
            ) : (
              <div className="px-4 py-3 space-y-1">
                {/* People */}
                {searchResults.users.length > 0 && (
                  <div>
                    <p className="px-2 py-2 text-xs font-semibold uppercase tracking-wider text-pnp-textSecondary/50">People</p>
                    {searchResults.users.map((u: any) => {
                      const photo = u.photo_file_id
                        ? u.photo_file_id.startsWith("/") || u.photo_file_id.startsWith("http")
                          ? u.photo_file_id
                          : null
                        : null;
                      const initial = (u.first_name || u.username || "?")[0].toUpperCase();
                      return (
                        <button
                          key={u.id}
                          onClick={() => { handleSearchClose(); navigate(`/profile/${u.id}`); }}
                          className="w-full flex items-center gap-3 px-2 py-2.5 rounded-xl hover:bg-pnp-surface transition-colors text-left"
                        >
                          {photo ? (
                            <img src={photo} alt="" className="w-10 h-10 rounded-full object-cover flex-shrink-0" />
                          ) : (
                            <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0" style={{ background: "linear-gradient(135deg, #D4007A, #E69138)", color: "#fff" }}>
                              {initial}
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-pnp-textPrimary truncate">
                              {u.first_name}{u.last_name ? ` ${u.last_name}` : ""}
                            </p>
                            {u.username && <p className="text-xs text-pnp-textSecondary truncate">@{u.username}</p>}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Creators */}
                {searchResults.creators.length > 0 && (
                  <div>
                    <p className="px-2 py-2 text-xs font-semibold uppercase tracking-wider text-pnp-textSecondary/50">Creators</p>
                    {searchResults.creators.map((c: any) => {
                      const photo = c.photo_url
                        ? c.photo_url.startsWith("/") || c.photo_url.startsWith("http")
                          ? c.photo_url
                          : null
                        : null;
                      const initial = (c.display_name || c.username || "?")[0].toUpperCase();
                      return (
                        <button
                          key={c.id}
                          onClick={() => { handleSearchClose(); navigate(`/profile/${c.user_id}`); }}
                          className="w-full flex items-center gap-3 px-2 py-2.5 rounded-xl hover:bg-pnp-surface transition-colors text-left"
                        >
                          {photo ? (
                            <img src={photo} alt="" className="w-10 h-10 rounded-full object-cover flex-shrink-0" />
                          ) : (
                            <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0" style={{ background: "linear-gradient(135deg, #5ED1C4, #D4007A)", color: "#fff" }}>
                              {initial}
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-pnp-textPrimary truncate">{c.display_name || c.username}</p>
                            {c.category && <p className="text-xs text-pnp-textSecondary truncate">{c.category}</p>}
                          </div>
                          {c.verified && (
                            <span className="text-xs px-1.5 py-0.5 rounded flex-shrink-0" style={{ background: "rgba(94,209,196,0.15)", color: "#5ED1C4" }}>
                              Verified
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Posts */}
                {searchResults.posts.length > 0 && (
                  <div>
                    <p className="px-2 py-2 text-xs font-semibold uppercase tracking-wider text-pnp-textSecondary/50">Posts</p>
                    {searchResults.posts.map((post: any) => (
                      <button
                        key={post.id}
                        onClick={() => { handleSearchClose(); navigate(`/social/post/${post.id}`); }}
                        className="w-full flex items-start gap-3 px-2 py-2.5 rounded-xl hover:bg-pnp-surface transition-colors text-left"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-pnp-textSecondary mb-0.5">@{post.author_username}</p>
                          <p className="text-sm text-pnp-textPrimary line-clamp-2">{post.content}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Toast notifications */}
      {isAuthenticated && <Toast />}

      {/* One-shot flash messages stashed in sessionStorage by other routes
          (e.g. failed hangout-invite redirect). Shown regardless of auth so the
          message survives the redirect to /login. */}
      <FlashBanner />
    </div>
  );
}
