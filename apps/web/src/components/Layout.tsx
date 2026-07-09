import React, { useState, useEffect, useRef, lazy, Suspense } from "react";
import { createPortal } from "react-dom";
import { Outlet, NavLink, useNavigate, useLocation, Navigate } from "react-router-dom";
import { BottomNav } from "./BottomNav";
import { AnnouncementStrip } from "./AnnouncementStrip";
import { VerificationGate } from "./VerificationGate";
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
import { connectSocket } from "@/lib/socket";
import { MediaMessage } from "@/components/hangouts/MediaMessage";
import { SelfCamFloater } from "@/components/mainstage/SelfCamFloater";
import { ThreadListView, DmChatView } from "@/pages/DirectMessages";

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
  const hasFetched = useRef<string | null>(null);

  useEffect(() => {
    if (hasFetched.current === userId) return;
    hasFetched.current = userId;

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
      <div className="flex items-end gap-1.5 px-2 py-2 border-t border-pnp-border flex-shrink-0" style={{ background: "var(--pnp-surface, #1C1C1E)" }}>
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
  // Latches to true on first render at /main-stage with a valid guest session
  // in sessionStorage. Stays true for the life of the Layout instance so
  // subsequent re-renders don't bounce the guest to /login after MainStage
  // consumes (deletes) the sessionStorage key.
  const mainStageGuestLatchRef = useRef<boolean>(false);
  const [cruiseMode, setCruiseMode] = useState(false);
  const [dmUnread, setDmUnread] = useState(0);
  const [threads, setThreads] = useState<MessageThread[]>([]);
  const [hangoutGroups, setHangoutGroups] = useState<HangoutGroup[]>([]);
  const [conversationFilter, setConversationFilter] = useState<"all" | "dms" | "hangouts">("all");
  const [hangoutGroupsLoading, setHangoutGroupsLoading] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [inlineDmUserId, setInlineDmUserId] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<{ users: any[]; creators: any[]; channels: any[]; hangouts: any[]; posts: any[] } | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchSubmitted, setSearchSubmitted] = useState(false);
  const [searchTab, setSearchTab] = useState<"all"|"members"|"creators"|"channels"|"hangouts"|"posts">("all");
  const [searchFullResults, setSearchFullResults] = useState<{ users: any[]; creators: any[]; channels: any[]; hangouts: any[]; posts: any[] } | null>(null);
  const [searchFullLoading, setSearchFullLoading] = useState(false);
  const [isDmPanelOpen, setIsDmPanelOpen] = useState(false);
  const [dmPartnerId, setDmPartnerId] = useState<string | null>(null);
  const [dmPanelPos, setDmPanelPos] = useState({ top: 0, left: 0 });
  const dmButtonRef = useRef<HTMLButtonElement>(null);
  const dmPanelRef = useRef<HTMLDivElement>(null);
  const [searchPanelPos, setSearchPanelPos] = useState({ top: 0, left: 0 });
  const searchButtonRef = useRef<HTMLButtonElement>(null);
  const searchPanelRef = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    const handler = (e: Event) => setCruiseMode((e as CustomEvent).detail as boolean);
    window.addEventListener("pnp-cruise-mode", handler);
    return () => window.removeEventListener("pnp-cruise-mode", handler);
  }, []);

  const sidebarSections = [
    {
      label: "DISCOVER",
      items: [
        {
          to: "/",
          label: t.nav.feed || "Home Feed",
          end: true,
          checkActive: (p: string, s: string) => p === "/" && !s.includes("view=hangouts"),
          icon: <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" /></svg>,
        },
        {
          to: "/live",
          label: "Live",
          icon: <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" /></svg>,
        },
        {
          to: "/nearby?mode=calls",
          label: "Performers",
          checkActive: (p: string, s: string) => p === "/nearby" && s.includes("mode=calls"),
          icon: <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.562.562 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" /></svg>,
        },
        {
          to: "/channels",
          label: t.nav.channels || "Channels",
          icon: <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M6 20.25h12m-7.5-3v3m-4.875-3h16.5a1.125 1.125 0 000-2.25H3.375a1.125 1.125 0 000 2.25zm0-12.75h16.5a1.125 1.125 0 000-2.25H3.375a1.125 1.125 0 000 2.25zm0 6h16.5a1.125 1.125 0 000-2.25H3.375a1.125 1.125 0 000 2.25z" /></svg>,
        },
        {
          to: "/nearby",
          label: t.nav.nearby || "Nearby",
          checkActive: (p: string, s: string) => p === "/nearby" && !s.includes("mode=calls"),
          icon: <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" /></svg>,
        },
      ],
    },
    {
      label: "COMMUNITY",
      items: [
        {
          to: "/?view=hangouts",
          label: t.nav.hangouts || "Hangouts",
          checkActive: (p: string, s: string) => p === "/" && s.includes("view=hangouts"),
          icon: <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" /></svg>,
        },
        {
          to: "/dm",
          isDm: true,
          label: t.nav.inbox || "Inbox",
          icon: <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M8.625 9.75a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375m-13.5 3.01c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.184-4.183a1.14 1.14 0 01.778-.332 48.294 48.294 0 005.83-.498c1.585-.233 2.708-1.626 2.708-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" /></svg>,
        },
        {
          to: "/main-stage",
          label: "Main Stage",
          icon: <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 01-1.125-1.125M3.375 19.5h1.5C5.496 19.5 6 18.996 6 18.375m-3.75.125C2.25 18.375 1.875 18 1.875 17.25v-1.5a.75.75 0 01.75-.75h.375M3 10.5h18M3 7.5h18M12 3v3m3-3v3m-6-3v3" /></svg>,
        },
      ],
    },
    {
      label: "YOU",
      items: [
        {
          to: "/profile",
          label: "My Profile",
          icon: <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" /></svg>,
        },
        {
          to: "/my-access",
          label: t.nav.myAccess || "My Access",
          icon: <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" /></svg>,
        },
        {
          to: "/subscribe",
          label: "Subscribe",
          icon: <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" /></svg>,
        },
        {
          to: "/badges",
          label: "Badges",
          icon: <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M16.5 18.75h-9m9 0a3 3 0 013 3h-15a3 3 0 013-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497m5.007 0a7.454 7.454 0 01-.982-3.172M9.497 14.25a7.454 7.454 0 00.981-3.172M5.25 4.236c-.982.143-1.954.317-2.916.52A6.003 6.003 0 007.73 9.728M5.25 4.236V4.5c0 2.108.966 3.99 2.48 5.228M5.25 4.236V2.721C7.456 2.41 9.71 2.25 12 2.25c2.291 0 4.545.16 6.75.47v1.516M7.73 9.728a6.726 6.726 0 002.748 1.35m8.272-6.842V4.5c0 2.108-.966 3.99-2.48 5.228m2.48-5.492a46.32 46.32 0 012.916.52 6.003 6.003 0 01-5.395 4.972m0 0a6.726 6.726 0 01-2.749 1.35m0 0a6.772 6.772 0 01-3.044 0" /></svg>,
        },
      ],
    },
  ];

  const secondaryLinks = [
    {
      to: "/settings",
      label: t.nav.settings || "Settings",
      icon: <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>,
    },
    {
      to: "/support",
      label: t.nav.help || "Help",
      icon: <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" /></svg>,
    },
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

  useEffect(() => {
    if (!isDmPanelOpen) return;
    const onMouse = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!dmButtonRef.current?.contains(t) && !dmPanelRef.current?.contains(t)) setIsDmPanelOpen(false);
    };
    document.addEventListener("mousedown", onMouse);
    return () => document.removeEventListener("mousedown", onMouse);
  }, [isDmPanelOpen]);

  useEffect(() => {
    if (!isDmPanelOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setIsDmPanelOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isDmPanelOpen]);

  useEffect(() => {
    if (!isDmPanelOpen || !isMobile) return;
    const vv = window.visualViewport;
    if (!vv) return;
    const onVVChange = () => {
      const panel = dmPanelRef.current;
      if (!panel) return;
      const keyboardH = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      panel.style.bottom = `${keyboardH}px`;
      panel.style.height = `${vv.height * 0.96}px`;
    };
    vv.addEventListener("resize", onVVChange);
    vv.addEventListener("scroll", onVVChange);
    onVVChange();
    return () => {
      vv.removeEventListener("resize", onVVChange);
      vv.removeEventListener("scroll", onVVChange);
      const panel = dmPanelRef.current;
      if (panel) { panel.style.bottom = ""; panel.style.height = ""; }
    };
  }, [isDmPanelOpen, isMobile]);

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

  // Debounced live-preview search (4 results per category)
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
              channels: data.channels || [],
              hangouts: data.hangouts || [],
              posts: data.posts || [],
            });
          }
        })
        .catch(() => {})
        .finally(() => setSearchLoading(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, searchOpen]);

  // Full search triggered on Enter
  const handleSearchSubmit = () => {
    const q = searchQuery.trim();
    if (q.length < 2) return;
    setSearchSubmitted(true);
    setSearchTab("all");
    setSearchFullLoading(true);
    fetch(`/api/webapp/search?q=${encodeURIComponent(q)}&full=1`, { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        if (data.success !== false) {
          setSearchFullResults({
            users: data.users || [],
            creators: data.creators || [],
            channels: data.channels || [],
            hangouts: data.hangouts || [],
            posts: data.posts || [],
          });
        }
      })
      .catch(() => {})
      .finally(() => setSearchFullLoading(false));
  };

  const handleSearchClose = () => {
    setSearchOpen(false);
    setSearchQuery("");
    setSearchResults(null);
    setSearchSubmitted(false);
    setSearchFullResults(null);
    setSearchTab("all");
  };

  const handleLogout = () => {
    if (window.confirm("Sign out of PNPtv?")) {
      logout();
    }
  };

  // Show loading state briefly to avoid flash
  if (isLoading) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-pnp-background">
        <div className="w-8 h-8 rounded-full border-2 border-[#D4007A] border-t-transparent animate-spin" />
      </div>
    );
  }

  // Unauthenticated: send users to the real login screen, preserving where
  // they were trying to go so post-login return still works.
  // Exception: /main-stage with a valid guest session in sessionStorage —
  // guests redeemed an invite and already accepted terms + confirmed age on
  // the invite form, so they must not be bounced to /login. We latch the
  // decision in a ref because MainStage clears sessionStorage on mount; a
  // subsequent re-render of Layout would otherwise see an empty storage and
  // bounce the guest mid-session.
  if (!isAuthenticated) {
    if (location.pathname === "/main-stage") {
      if (!mainStageGuestLatchRef.current) {
        try {
          const raw = typeof sessionStorage !== "undefined" ? sessionStorage.getItem("pnptv:ms:guest") : null;
          if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed?.token && parsed?.livekitUrl && parsed?.roomName) {
              mainStageGuestLatchRef.current = true;
            }
          }
        } catch { /* noop */ }
      }
    }
    if (!mainStageGuestLatchRef.current) {
      const returnTo = `${location.pathname}${location.search}${location.hash}`;
      return <Navigate to={`/login?returnTo=${encodeURIComponent(returnTo)}`} replace />;
    }
  }

  return (
    <div className="app-shell bg-pnp-background">
      {/* ── Desktop sidebar ─────────────────────────────────────────────────── */}
      <aside className={`${cruiseMode ? "hidden" : "hidden lg:fixed lg:inset-y-0 lg:left-0 lg:flex"} lg:w-72 lg:flex-col border-r border-pnp-border glass-nav`}>
        {/* Sidebar header */}
        <div className="flex items-center justify-between px-5 h-16 border-b border-pnp-border">
          <img src="/logo-header.png" alt="PNPtv!" className="h-9 w-auto" />
          <div className="flex items-center gap-1">
            {/* Search */}
            <button
              ref={searchButtonRef}
              onClick={() => {
                if (!searchOpen && searchButtonRef.current) {
                  const r = searchButtonRef.current.getBoundingClientRect();
                  setSearchPanelPos({ top: r.bottom + 8, left: r.right + 8 });
                }
                setSearchOpen(true);
              }}
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
              ref={dmButtonRef}
              onClick={() => {
                if (!isDmPanelOpen && dmButtonRef.current) {
                  const r = dmButtonRef.current.getBoundingClientRect();
                  setDmPanelPos({ top: r.bottom + 8, left: r.right + 8 });
                }
                setDmPartnerId(null);
                setIsDmPanelOpen(v => !v);
              }}
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

        {/* Primary nav */}
        <nav className="flex-1 py-3 px-3 overflow-y-auto" aria-label="Primary navigation" translate="no" lang="en">
          {sidebarSections.map((section, idx) => (
            <div key={section.label} className={idx > 0 ? "mt-5" : ""}>
              <div className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-pnp-textSecondary/40 select-none">
                {section.label}
              </div>
              <div className="space-y-0.5">
                {section.items.map((item) => {
                  const isItemActive = item.checkActive
                    ? item.checkActive(location.pathname, location.search)
                    : location.pathname === item.to || location.pathname.startsWith(item.to + "/");
                  const baseClasses = "flex items-center gap-3 w-full px-2.5 py-2 rounded-lg text-sm font-medium transition-colors";
                  const activeClasses = "nav-active";
                  const inactiveClasses = "text-pnp-textSecondary hover:text-pnp-textPrimary hover:bg-pnp-surface";

                  if ((item as any).isDm) {
                    return (
                      <button
                        key={item.to}
                        onClick={() => { setDmPartnerId(null); setIsDmPanelOpen(true); }}
                        className={`${baseClasses} ${isDmPanelOpen ? activeClasses : inactiveClasses}`}
                      >
                        {item.icon}
                        <span className="flex-1 text-left">{item.label}</span>
                        {dmUnread > 0 && (
                          <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-[#D4007A] text-white text-[10px] font-bold flex items-center justify-center">
                            {dmUnread > 9 ? "9+" : dmUnread}
                          </span>
                        )}
                      </button>
                    );
                  }

                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={(item as any).end}
                      className={() => `${baseClasses} ${isItemActive ? activeClasses : inactiveClasses}`}
                    >
                      {item.icon}
                      <span>{item.label}</span>
                    </NavLink>
                  );
                })}
              </div>
            </div>
          ))}

          {/* Divider */}
          <div className="my-4 h-px bg-pnp-border" />

          {/* Secondary links — Settings & Help */}
          <div className="space-y-0.5">
            {secondaryLinks.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                className={({ isActive }: { isActive: boolean }) =>
                  `flex items-center gap-3 px-2.5 py-1.5 rounded-lg text-xs transition-colors ${
                    isActive
                      ? "text-pnp-textPrimary bg-pnp-surface"
                      : "text-pnp-textSecondary/60 hover:text-pnp-textSecondary hover:bg-pnp-surface"
                  }`
                }
              >
                {link.icon}
                <span>{link.label}</span>
              </NavLink>
            ))}
          </div>

          {/* Creator Studio & Admin — only shown to eligible users */}
          {(user?.creator_status === "active" || isAdmin) && (
            <>
              <div className="mt-4 mb-1 h-px bg-pnp-border" />
              <div className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-pnp-textSecondary/40 select-none">
                STUDIO
              </div>
              <div className="space-y-0.5">
                {(user?.creator_status === "active" || isAdmin) && (
                  <NavLink
                    to="/creators"
                    className={({ isActive }: { isActive: boolean }) =>
                      `flex items-center gap-3 px-2.5 py-2 rounded-lg text-sm font-medium transition-colors ${
                        isActive ? "nav-active" : "text-pnp-textSecondary hover:text-pnp-textPrimary hover:bg-pnp-surface"
                      }`
                    }
                  >
                    <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 01-1.125-1.125M3.375 19.5h7.5c.621 0 1.125-.504 1.125-1.125m-9.75 0V5.625m0 12.75v-1.5c0-.621.504-1.125 1.125-1.125m18.375 2.625V5.625m0 12.75c0 .621-.504 1.125-1.125 1.125m1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125m0 3.75h-7.5A1.125 1.125 0 0112 18.375m9.75-12.75c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125m19.5 0v1.5c0 .621-.504 1.125-1.125 1.125M2.25 5.625v1.5c0 .621.504 1.125 1.125 1.125m0 0h17.25m-17.25 0h7.5c.621 0 1.125.504 1.125 1.125M3.375 8.25c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125m17.25-3.75h-7.5c-.621 0-1.125.504-1.125 1.125m8.625-1.125c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125m-17.25 0h7.5m-7.5 0c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125M12 10.875v-1.5m0 1.5c0 .621-.504 1.125-1.125 1.125M12 10.875c0 .621.504 1.125 1.125 1.125m-2.25 0c.621 0 1.125.504 1.125 1.125M13.125 12h7.5m-7.5 0c-.621 0-1.125.504-1.125 1.125M20.625 12c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125m-17.25 0h7.5M12 14.625v-1.5m0 1.5c0 .621-.504 1.125-1.125 1.125M12 14.625c0 .621.504 1.125 1.125 1.125m-2.25 0c.621 0 1.125.504 1.125 1.125m0 1.5v-1.5m0 0c0-.621.504-1.125 1.125-1.125m0 0h7.5" /></svg>
                    <span>{t.nav.creatorStudio || "Creator Studio"}</span>
                  </NavLink>
                )}
                {isAdmin && (
                  <NavLink
                    to="/admin"
                    className={({ isActive }: { isActive: boolean }) =>
                      `flex items-center gap-3 px-2.5 py-2 rounded-lg text-sm font-medium transition-colors ${
                        isActive ? "nav-active" : "text-pnp-textSecondary hover:text-pnp-textPrimary hover:bg-pnp-surface"
                      }`
                    }
                  >
                    <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.276 3.277a3.004 3.004 0 01-2.25-2.25l3.276-3.276a4.5 4.5 0 00-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437l1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008z" /></svg>
                    <span>{t.nav.admin || "Admin"}</span>
                  </NavLink>
                )}
              </div>
            </>
          )}
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
            onClick={() => {
              setDmPartnerId(null);
              setIsDmPanelOpen(v => !v);
            }}
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

            {/* Scrollable link menu — native <details> for collapsibles
                 (built-in a11y, prefers-reduced-motion-respecting, no JS state). */}
            <nav className="flex-1 overflow-y-auto" aria-label="Mobile navigation" translate="no" lang="en">
              <div className="px-3 py-3 space-y-2">

                {/* ── Navigation (open by default) ────────────────────────── */}
                <details open className="group">
                  <summary className="flex items-center justify-between px-2 py-1.5 cursor-pointer list-none select-none">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-pnp-textSecondary/50">{t.nav.navigation || "Navigation"}</span>
                    <svg className="w-3.5 h-3.5 text-pnp-textSecondary/50 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" /></svg>
                  </summary>
                  <div className="mt-1 space-y-0.5">
                    {[
                      { to: "/?view=feed", label: t.nav.feed || "PNP Feed" },
                      { to: "/main-stage", label: "Main Stage", isLive: true },
                      { to: "/channels", label: t.nav.channels || "PNP Channels" },
                      { to: "/?view=hangouts", label: t.nav.hangouts || "PNP Hangouts" },
                      { to: "/nearby", label: t.nav.nearby || "PNP Connect" },
                    ].map((link) => (
                      <NavLink
                        key={link.to}
                        to={link.to}
                        onClick={() => setMobileMenuOpen(false)}
                        className={({ isActive }: { isActive: boolean }) =>
                          `flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                            isActive ? "nav-active" : "text-pnp-textSecondary hover:text-pnp-textPrimary hover:bg-pnp-surface"
                          }`
                        }
                      >
                        <span>{link.label}</span>
                        {link.isLive && (
                          <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-red-500 text-white text-[9px] font-bold">
                            <span className="w-1 h-1 rounded-full bg-white animate-pulse" />
                            LIVE
                          </span>
                        )}
                      </NavLink>
                    ))}
                  </div>
                </details>

                {/* ── You (Inbox, Self-Care, Access, Settings) — collapsed ── */}
                <details className="group">
                  <summary className="flex items-center justify-between px-2 py-1.5 cursor-pointer list-none select-none">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-pnp-textSecondary/50">{t.nav.you || "You"}</span>
                    <svg className="w-3.5 h-3.5 text-pnp-textSecondary/50 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" /></svg>
                  </summary>
                  <div className="mt-1 space-y-0.5">
                    <button
                      onClick={() => { setMobileMenuOpen(false); setDmPartnerId(null); setIsDmPanelOpen(true); }}
                      className="flex items-center justify-between w-full px-3 py-2 rounded-lg text-sm font-medium transition-colors text-pnp-textSecondary hover:text-pnp-textPrimary hover:bg-pnp-surface"
                    >
                      <span>{t.nav.inbox || "Inbox"}</span>
                      {dmUnread > 0 && <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-[#D4007A] text-white text-[10px] font-bold flex items-center justify-center">{dmUnread > 9 ? "9+" : dmUnread}</span>}
                    </button>
                    {[
                      { to: "/self-care", label: t.nav.selfCare || "Self-Care Center", emoji: "🧘" },
                      { to: "/my-access", label: t.nav.myAccess || "My Access" },
                      { to: "/settings", label: t.nav.settings || "Settings" },
                    ].map((link) => (
                      <NavLink
                        key={link.to}
                        to={link.to}
                        onClick={() => setMobileMenuOpen(false)}
                        className={({ isActive }: { isActive: boolean }) =>
                          `flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                            isActive ? "nav-active" : "text-pnp-textSecondary hover:text-pnp-textPrimary hover:bg-pnp-surface"
                          }`
                        }
                      >
                        <span className="flex items-center gap-2">
                          {(link as any).emoji && <span aria-hidden="true">{(link as any).emoji}</span>}
                          {link.label}
                        </span>
                      </NavLink>
                    ))}
                  </div>
                </details>

                {/* ── Help & Community — collapsed ─────────────────────── */}
                <details className="group">
                  <summary className="flex items-center justify-between px-2 py-1.5 cursor-pointer list-none select-none">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-pnp-textSecondary/50">{t.nav.helpCommunity || "Help & Community"}</span>
                    <svg className="w-3.5 h-3.5 text-pnp-textSecondary/50 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" /></svg>
                  </summary>
                  <div className="mt-1 space-y-0.5">
                    {[
                      { to: "/support", label: t.nav.help || "Help & Support" },
                      { to: "/community-resources", label: t.nav.communityResources || "Community Resources" },
                      { to: "/about", label: t.nav.about || "About PNPtv!" },
                      { to: "/blog", label: t.nav.blog || "Blog" },
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
                </details>

                {/* ── Legal — collapsed ────────────────────────────────── */}
                <details className="group">
                  <summary className="flex items-center justify-between px-2 py-1.5 cursor-pointer list-none select-none">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-pnp-textSecondary/50">{t.nav.legal || "Legal"}</span>
                    <svg className="w-3.5 h-3.5 text-pnp-textSecondary/50 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" /></svg>
                  </summary>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 px-2">
                    {[
                      { to: "/terms", label: t.nav.terms || "Terms" },
                      { to: "/privacy", label: t.nav.privacy || "Privacy" },
                      { to: "/community-guidelines", label: t.nav.guidelines || "Guidelines" },
                      { to: "/content-policy", label: t.nav.contentPolicy || "Content Policy" },
                      { to: "/dmca", label: "DMCA" },
                      { to: "/refunds", label: t.nav.refunds || "Refunds" },
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
                </details>

                {/* ── Admin (conditional, collapsed) ─────────────────────── */}
                {isAdmin && (
                  <details className="group">
                    <summary className="flex items-center justify-between px-2 py-1.5 cursor-pointer list-none select-none">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-pnp-textSecondary/50">{t.nav.admin}</span>
                      <svg className="w-3.5 h-3.5 text-pnp-textSecondary/50 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" /></svg>
                    </summary>
                    <div className="mt-1 space-y-0.5">
                      <NavLink
                        to="/admin"
                        onClick={() => setMobileMenuOpen(false)}
                        className={({ isActive }: { isActive: boolean }) =>
                          `block px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                            isActive ? "nav-active" : "text-pnp-textSecondary hover:text-pnp-textPrimary hover:bg-pnp-surface"
                          }`
                        }
                      >
                        {t.nav.adminDashboard || "Admin Dashboard"}
                      </NavLink>
                    </div>
                  </details>
                )}

                {(user?.creator_status === "active" || isAdmin) && (
                  <details className="group">
                    <summary className="flex items-center justify-between px-2 py-1.5 cursor-pointer list-none select-none">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-pnp-textSecondary/50">{t.nav.creatorStudio || "Creator"}</span>
                      <svg className="w-3.5 h-3.5 text-pnp-textSecondary/50 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" /></svg>
                    </summary>
                    <div className="mt-1 space-y-0.5">
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
                  </details>
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
                    {t.nav.signOut || "Sign out"}
                  </button>
                </div>

              </div>
            </nav>
          </div>
        </div>
      )}

      {/* ── Main content ─────────────────────────────────────────────────────── */}
      {/* pb-28 mobile = 64px BottomNav + ~44px AnnouncementStrip; pb-12 desktop
           = ~44px AnnouncementStrip (no bottom nav on lg). Without this, the
           strip overlays the bottom of any video <controls> bar in the feed. */}
      <main className={`flex-1 overflow-y-auto overscroll-contain lg:overflow-visible lg:pb-12 pb-28 ${cruiseMode ? "" : "lg:pl-72"}`}>
        <Outlet />
      </main>

      {/* Global announcement strip — only after verification */}
      {isAuthenticated && user?.ageVerified && user?.termsAccepted && (
        <div className={`fixed left-0 right-0 z-40 pointer-events-none ${cruiseMode ? "bottom-28" : "bottom-16 lg:bottom-0 lg:left-72"}`}>
          <div className="pointer-events-auto">
            <AnnouncementStrip />
          </div>
        </div>
      )}

      {/* Bottom nav */}
      <div className={`flex-shrink-0 ${cruiseMode ? "" : "lg:hidden"}`}>
        <BottomNav />
      </div>

      {/* Unified Cristina widget — only after verification */}
      {isAuthenticated && user?.ageVerified && user?.termsAccepted && (() => {
        const inVideoCall = location.pathname.startsWith("/chat/");
        const showCompact = isLandscape && isMobile && inVideoCall;
        return (
          <FloatingWidgets showCompact={showCompact} />
        );
      })()}

      {/* ── Search Panel ────────────────────────────────────────────────────── */}
      {searchOpen && createPortal(
        <>
          <div
            className={`fixed inset-0 z-40 ${isMobile ? "bg-black/60" : ""}`}
            onClick={handleSearchClose}
            aria-hidden="true"
          />
          <div
            ref={searchPanelRef}
            className={isMobile
              ? "fixed bottom-0 left-0 right-0 z-50 animate-slide-up w-full h-[92dvh] flex flex-col rounded-t-2xl bg-pnp-background border-t border-pnp-border shadow-2xl overflow-hidden"
              : "flex flex-col rounded-xl bg-pnp-background border border-pnp-border shadow-xl overflow-hidden"
            }
            style={!isMobile ? { position: "fixed", top: searchPanelPos.top, left: searchPanelPos.left, zIndex: 50, width: "480px", height: "82svh" } : undefined}
            role="dialog"
            aria-modal="true"
            aria-label="Search"
          >
            {/* Drag handle */}
            {isMobile && <div className="flex justify-center pt-2 pb-1 flex-shrink-0"><div className="w-10 h-1 rounded-full bg-pnp-border" /></div>}

            {/* Search input bar */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-pnp-border flex-shrink-0">
              <svg className="w-4 h-4 text-pnp-textSecondary flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                autoFocus
                type="search"
                enterKeyHint="search"
                placeholder="People, creators, channels, hangouts…"
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setSearchSubmitted(false); setSearchFullResults(null); }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") handleSearchClose();
                  if (e.key === "Enter") handleSearchSubmit();
                }}
                className="flex-1 bg-transparent text-pnp-textPrimary text-sm outline-none placeholder:text-pnp-textSecondary min-w-0"
                style={{ fontSize: "16px" }}
              />
              {searchQuery ? (
                <button
                  onClick={() => { setSearchQuery(""); setSearchResults(null); setSearchSubmitted(false); setSearchFullResults(null); }}
                  className="flex-shrink-0 text-pnp-textSecondary hover:text-pnp-textPrimary transition-colors"
                  aria-label="Clear"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              ) : (
                <button onClick={handleSearchClose} className="flex-shrink-0 text-pnp-textSecondary hover:text-pnp-textPrimary transition-colors" aria-label="Close">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              )}
            </div>

            {/* Tab bar — visible only in full-results mode */}
            {searchSubmitted && (
              <div className="flex items-center gap-1 px-3 py-2 border-b border-pnp-border flex-shrink-0 overflow-x-auto">
                {(["all", "members", "creators", "channels", "hangouts", "posts"] as const).map((tab) => {
                  const labels: Record<string, string> = { all: "All", members: "Members", creators: "Creators", channels: "Channels", hangouts: "Hangouts", posts: "Posts" };
                  const active = searchTab === tab;
                  return (
                    <button
                      key={tab}
                      onClick={() => setSearchTab(tab)}
                      className="px-3 py-1.5 rounded-full text-xs font-semibold transition-all active:scale-95 flex-shrink-0"
                      style={active
                        ? { background: "linear-gradient(135deg,#D4007A,#E69138)", color: "#fff" }
                        : { background: "rgba(255,255,255,0.05)", color: "var(--pnp-textSecondary,rgba(255,255,255,0.6))" }
                      }
                    >
                      {labels[tab]}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Results body */}
            <div className="flex-1 min-h-0 overflow-y-auto" style={{ WebkitOverflowScrolling: "touch" }}>
              {/* ── Idle: tag cloud ── */}
              {searchQuery.trim().length < 2 && (
                <div className="px-4 py-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-pnp-textSecondary/50 mb-3">Browse by interest</p>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { tag: "leather", emoji: "🥋" }, { tag: "bear", emoji: "🐻" }, { tag: "daddy", emoji: "👨" },
                      { tag: "clouds", emoji: "☁️" }, { tag: "pig-play", emoji: "🐷" }, { tag: "raw", emoji: "🔥" },
                      { tag: "bdsm", emoji: "⛓️" }, { tag: "twink", emoji: "🌸" }, { tag: "fisting", emoji: "✊" },
                      { tag: "watersports", emoji: "💦" }, { tag: "outdoor", emoji: "🌲" }, { tag: "jock", emoji: "💪" },
                      { tag: "latino", emoji: "🌶️" }, { tag: "group", emoji: "👥" }, { tag: "voyeur", emoji: "👁️" },
                      { tag: "muscle", emoji: "🏋️" }, { tag: "sober", emoji: "💧" }, { tag: "roleplay", emoji: "🎭" },
                      { tag: "solo", emoji: "1️⃣" }, { tag: "breeding", emoji: "💦" }, { tag: "bondage", emoji: "🪢" },
                    ].map(({ tag, emoji }) => (
                      <button
                        key={tag}
                        onClick={() => { navigate(`/channels?discover=${encodeURIComponent(tag)}`); handleSearchClose(); }}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-pnp-surface hover:bg-white/10 text-pnp-textSecondary hover:text-pnp-textPrimary transition-colors border border-pnp-border"
                      >
                        <span>{emoji}</span><span>{tag}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Live preview: compact rows while typing ── */}
              {searchQuery.trim().length >= 2 && !searchSubmitted && (() => {
                if (searchLoading) return (
                  <div className="flex items-center justify-center py-12">
                    <svg className="w-5 h-5 text-pnp-accent animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                  </div>
                );
                const empty = !searchResults || (searchResults.users.length + searchResults.creators.length + searchResults.channels.length + searchResults.hangouts.length + searchResults.posts.length === 0);
                if (empty) return (
                  <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
                    <p className="text-sm text-pnp-textSecondary">No results for &ldquo;{searchQuery}&rdquo;</p>
                    <p className="text-xs text-pnp-textSecondary/50 mt-1">Press Enter for a full search</p>
                  </div>
                );
                const r = searchResults!;
                type SearchRow = { key: string; label: string; rows: any[]; renderRow: (item: any) => React.ReactNode };
                const sections: SearchRow[] = [
                  { key: "members", label: "Members", rows: r.users, renderRow: (u: any) => {
                    const photo = u.photo_file_id && (u.photo_file_id.startsWith("/") || u.photo_file_id.startsWith("http")) ? u.photo_file_id : null;
                    return (
                      <button key={u.id} onClick={() => { handleSearchClose(); navigate(`/profile/${u.id}`); }} className="w-full flex items-center gap-3 px-2 py-2 rounded-xl hover:bg-pnp-surface transition-colors text-left">
                        {photo ? <img src={photo} alt="" className="w-8 h-8 rounded-full object-cover flex-shrink-0" /> : <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0" style={{ background: "linear-gradient(135deg,#D4007A,#E69138)", color: "#fff" }}>{(u.first_name || u.username || "?")[0].toUpperCase()}</div>}
                        <div className="flex-1 min-w-0"><p className="text-sm font-medium text-pnp-textPrimary truncate">{u.first_name}{u.last_name ? ` ${u.last_name}` : ""}</p>{u.username && <p className="text-xs text-pnp-textSecondary truncate">@{u.username}</p>}</div>
                      </button>
                    );
                  }},
                  { key: "creators", label: "Creators", rows: r.creators, renderRow: (c: any) => {
                    const photo = c.photo_url && (c.photo_url.startsWith("/") || c.photo_url.startsWith("http")) ? c.photo_url : null;
                    return (
                      <button key={c.id} onClick={() => { handleSearchClose(); navigate(`/profile/${c.user_id}`); }} className="w-full flex items-center gap-3 px-2 py-2 rounded-xl hover:bg-pnp-surface transition-colors text-left">
                        {photo ? <img src={photo} alt="" className="w-8 h-8 rounded-full object-cover flex-shrink-0" /> : <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0" style={{ background: "linear-gradient(135deg,#5ED1C4,#D4007A)", color: "#fff" }}>{(c.display_name || c.username || "?")[0].toUpperCase()}</div>}
                        <div className="flex-1 min-w-0"><p className="text-sm font-medium text-pnp-textPrimary truncate">{c.display_name || c.username}</p></div>
                        {c.verified && <span className="text-[10px] px-1.5 py-0.5 rounded flex-shrink-0" style={{ background: "rgba(94,209,196,0.15)", color: "#5ED1C4" }}>✓</span>}
                      </button>
                    );
                  }},
                  { key: "channels", label: "Channels", rows: r.channels, renderRow: (ch: any) => (
                    <button key={ch.id} onClick={() => { handleSearchClose(); navigate(`/channels/${ch.id}`); }} className="w-full flex items-center gap-3 px-2 py-2 rounded-xl hover:bg-pnp-surface transition-colors text-left">
                      {ch.cover_photo_url ? <img src={ch.cover_photo_url} alt="" className="w-8 h-8 rounded-lg object-cover flex-shrink-0" /> : <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "rgba(212,0,122,0.15)" }}><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="#D4007A" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg></div>}
                      <div className="flex-1 min-w-0"><p className="text-sm font-medium text-pnp-textPrimary truncate">{ch.name}</p>{ch.subscriber_count != null && <p className="text-xs text-pnp-textSecondary">{ch.subscriber_count} subscribers</p>}</div>
                    </button>
                  )},
                  { key: "hangouts", label: "Hangouts", rows: r.hangouts, renderRow: (h: any) => (
                    <button key={h.id} onClick={() => { handleSearchClose(); navigate(`/chat/${h.id}`); }} className="w-full flex items-center gap-3 px-2 py-2 rounded-xl hover:bg-pnp-surface transition-colors text-left">
                      {h.cover_image_url ? <img src={h.cover_image_url} alt="" className="w-8 h-8 rounded-lg object-cover flex-shrink-0" /> : <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "rgba(94,209,196,0.15)" }}><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="#5ED1C4" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg></div>}
                      <div className="flex-1 min-w-0"><p className="text-sm font-medium text-pnp-textPrimary truncate">{h.name}</p>{h.member_count != null && <p className="text-xs text-pnp-textSecondary">{h.member_count} members</p>}</div>
                    </button>
                  )},
                  { key: "posts", label: "Posts", rows: r.posts, renderRow: (p: any) => (
                    <button key={p.id} onClick={() => { handleSearchClose(); navigate(`/social/post/${p.id}`); }} className="w-full flex items-start gap-3 px-2 py-2 rounded-xl hover:bg-pnp-surface transition-colors text-left">
                      <div className="flex-1 min-w-0"><p className="text-xs text-pnp-textSecondary mb-0.5">@{p.author_username}</p><p className="text-sm text-pnp-textPrimary line-clamp-2">{p.content}</p></div>
                    </button>
                  )},
                ];
                const activeSections = sections.filter(s => s.rows.length > 0);
                return (
                  <div className="px-3 py-2 space-y-1">
                    {activeSections.map(s => (
                      <div key={s.key}>
                        <div className="flex items-center justify-between px-2 py-1.5">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-pnp-textSecondary/50">{s.label}</p>
                          <button onClick={handleSearchSubmit} className="text-[10px] text-pnp-accent hover:underline">See all →</button>
                        </div>
                        {s.rows.map(item => s.renderRow(item))}
                      </div>
                    ))}
                    <button
                      onClick={handleSearchSubmit}
                      className="w-full mt-2 py-2.5 rounded-xl text-sm font-semibold text-white transition-all active:scale-95"
                      style={{ background: "linear-gradient(135deg,#D4007A,#E69138)" }}
                    >
                      See all results for &ldquo;{searchQuery}&rdquo;
                    </button>
                  </div>
                );
              })()}

              {/* ── Full results: tabbed view after Enter ── */}
              {searchSubmitted && (() => {
                if (searchFullLoading) return (
                  <div className="flex items-center justify-center py-12">
                    <svg className="w-5 h-5 text-pnp-accent animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                  </div>
                );
                if (!searchFullResults) return null;
                const fr = searchFullResults;

                const renderMember = (u: any) => {
                  const photo = u.photo_file_id && (u.photo_file_id.startsWith("/") || u.photo_file_id.startsWith("http")) ? u.photo_file_id : null;
                  return (
                    <button key={u.id} onClick={() => { handleSearchClose(); navigate(`/profile/${u.id}`); }} className="w-full flex items-center gap-3 px-2 py-2.5 rounded-xl hover:bg-pnp-surface transition-colors text-left">
                      {photo ? <img src={photo} alt="" className="w-9 h-9 rounded-full object-cover flex-shrink-0" /> : <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0" style={{ background: "linear-gradient(135deg,#D4007A,#E69138)", color: "#fff" }}>{(u.first_name || u.username || "?")[0].toUpperCase()}</div>}
                      <div className="flex-1 min-w-0"><p className="text-sm font-medium text-pnp-textPrimary truncate">{u.first_name}{u.last_name ? ` ${u.last_name}` : ""}</p>{u.username && <p className="text-xs text-pnp-textSecondary truncate">@{u.username}</p>}</div>
                    </button>
                  );
                };
                const renderCreator = (c: any) => {
                  const photo = c.photo_url && (c.photo_url.startsWith("/") || c.photo_url.startsWith("http")) ? c.photo_url : null;
                  return (
                    <button key={c.id} onClick={() => { handleSearchClose(); navigate(`/profile/${c.user_id}`); }} className="w-full flex items-center gap-3 px-2 py-2.5 rounded-xl hover:bg-pnp-surface transition-colors text-left">
                      {photo ? <img src={photo} alt="" className="w-9 h-9 rounded-full object-cover flex-shrink-0" /> : <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0" style={{ background: "linear-gradient(135deg,#5ED1C4,#D4007A)", color: "#fff" }}>{(c.display_name || c.username || "?")[0].toUpperCase()}</div>}
                      <div className="flex-1 min-w-0"><p className="text-sm font-medium text-pnp-textPrimary truncate">{c.display_name || c.username}</p></div>
                      {c.verified && <span className="text-xs px-1.5 py-0.5 rounded flex-shrink-0" style={{ background: "rgba(94,209,196,0.15)", color: "#5ED1C4" }}>Verified</span>}
                    </button>
                  );
                };
                const renderChannel = (ch: any) => (
                  <button key={ch.id} onClick={() => { handleSearchClose(); navigate(`/channels/${ch.id}`); }} className="w-full flex items-center gap-3 px-2 py-2.5 rounded-xl hover:bg-pnp-surface transition-colors text-left">
                    {ch.cover_photo_url ? <img src={ch.cover_photo_url} alt="" className="w-9 h-9 rounded-lg object-cover flex-shrink-0" /> : <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "rgba(212,0,122,0.15)" }}><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="#D4007A" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg></div>}
                    <div className="flex-1 min-w-0"><p className="text-sm font-medium text-pnp-textPrimary truncate">{ch.name}</p><p className="text-xs text-pnp-textSecondary truncate">{ch.channel_type} · {ch.subscriber_count ?? 0} subscribers</p></div>
                  </button>
                );
                const renderHangout = (h: any) => (
                  <button key={h.id} onClick={() => { handleSearchClose(); navigate(`/chat/${h.id}`); }} className="w-full flex items-center gap-3 px-2 py-2.5 rounded-xl hover:bg-pnp-surface transition-colors text-left">
                    {h.cover_image_url ? <img src={h.cover_image_url} alt="" className="w-9 h-9 rounded-lg object-cover flex-shrink-0" /> : <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "rgba(94,209,196,0.15)" }}><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="#5ED1C4" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg></div>}
                    <div className="flex-1 min-w-0"><p className="text-sm font-medium text-pnp-textPrimary truncate">{h.name}</p><p className="text-xs text-pnp-textSecondary truncate">{h.member_count ?? 0} members</p></div>
                  </button>
                );
                const renderPost = (p: any) => (
                  <button key={p.id} onClick={() => { handleSearchClose(); navigate(`/social/post/${p.id}`); }} className="w-full flex items-start gap-3 px-2 py-2.5 rounded-xl hover:bg-pnp-surface transition-colors text-left">
                    <div className="flex-1 min-w-0"><p className="text-xs text-pnp-textSecondary mb-0.5">@{p.author_username}</p><p className="text-sm text-pnp-textPrimary line-clamp-2">{p.content}</p></div>
                  </button>
                );

                const noResults = fr.users.length + fr.creators.length + fr.channels.length + fr.hangouts.length + fr.posts.length === 0;
                if (noResults) return (
                  <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
                    <p className="text-sm text-pnp-textSecondary">No results for &ldquo;{searchQuery}&rdquo;</p>
                  </div>
                );

                if (searchTab === "all") {
                  const allSections = [
                    { key: "members", label: "Members", rows: fr.users, tab: "members" as const, render: renderMember },
                    { key: "creators", label: "Creators", rows: fr.creators, tab: "creators" as const, render: renderCreator },
                    { key: "channels", label: "Channels", rows: fr.channels, tab: "channels" as const, render: renderChannel },
                    { key: "hangouts", label: "Hangouts", rows: fr.hangouts, tab: "hangouts" as const, render: renderHangout },
                    { key: "posts", label: "Posts", rows: fr.posts, tab: "posts" as const, render: renderPost },
                  ].filter(s => s.rows.length > 0);
                  return (
                    <div className="px-3 py-2 space-y-2">
                      {allSections.map(s => (
                        <div key={s.key}>
                          <div className="flex items-center justify-between px-2 py-1.5">
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-pnp-textSecondary/50">{s.label}</p>
                            {s.rows.length >= 3 && <button onClick={() => setSearchTab(s.tab)} className="text-[10px] text-pnp-accent hover:underline">See all →</button>}
                          </div>
                          {s.rows.slice(0, 3).map(item => s.render(item))}
                        </div>
                      ))}
                    </div>
                  );
                }

                const tabContent: Record<string, { rows: any[]; render: (item: any) => React.ReactNode }> = {
                  members: { rows: fr.users, render: renderMember },
                  creators: { rows: fr.creators, render: renderCreator },
                  channels: { rows: fr.channels, render: renderChannel },
                  hangouts: { rows: fr.hangouts, render: renderHangout },
                  posts: { rows: fr.posts, render: renderPost },
                };
                const current = tabContent[searchTab];
                if (!current || current.rows.length === 0) return (
                  <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
                    <p className="text-sm text-pnp-textSecondary">No {searchTab} found for &ldquo;{searchQuery}&rdquo;</p>
                  </div>
                );
                return <div className="px-3 py-2">{current.rows.map(item => current.render(item))}</div>;
              })()}
            </div>
          </div>
        </>,
        document.body
      )}

      {/* ── DM Panel ────────────────────────────────────────────────────────── */}
      {isDmPanelOpen && createPortal(
        <>
          <div
            className={`fixed inset-0 z-40 ${isMobile ? "bg-black/60" : ""}`}
            onClick={() => setIsDmPanelOpen(false)}
            aria-hidden="true"
          />
          <div
            ref={dmPanelRef}
            className={isMobile
              ? "fixed bottom-0 left-0 right-0 z-50 animate-slide-up w-full h-[92dvh] flex flex-col rounded-t-2xl bg-pnp-background border-t border-pnp-border shadow-2xl overflow-hidden"
              : "flex flex-col rounded-xl bg-pnp-background border border-pnp-border shadow-xl overflow-hidden"
            }
            style={!isMobile ? { position: "fixed", top: dmPanelPos.top, left: dmPanelPos.left, zIndex: 50, width: "480px", height: "82svh" } : undefined}
            role="dialog"
            aria-modal="true"
            aria-label="Messages"
          >
            {isMobile && <div className="flex justify-center pt-2 pb-1"><div className="w-10 h-1 rounded-full bg-pnp-border" /></div>}
            <div className="flex items-center justify-between px-4 py-3 border-b border-pnp-border flex-shrink-0">
              {dmPartnerId ? (
                <button onClick={() => setDmPartnerId(null)} className="flex items-center gap-2 text-pnp-textPrimary hover:opacity-80 transition-opacity">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                  </svg>
                  <span className="text-sm font-semibold">Back</span>
                </button>
              ) : (
                <h2 className="text-sm font-semibold text-pnp-textPrimary">Messages</h2>
              )}
              <button onClick={() => setIsDmPanelOpen(false)} className="text-pnp-textSecondary hover:text-pnp-textPrimary transition-colors" aria-label="Close">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex-1 min-h-0 relative">
              {dmPartnerId ? (
                <DmChatView
                  userId={dmPartnerId}
                  myDbId={user?.dbId ?? user?.id ?? ""}
                  myUserId={String(user?.id ?? "")}
                  isAdmin={isAdmin}
                  onBack={() => setDmPartnerId(null)}
                  panelMode
                />
              ) : (
                <ThreadListView
                  myDbId={user?.dbId ?? user?.id ?? ""}
                  onThreadSelect={(uid) => setDmPartnerId(uid)}
                  panelMode
                />
              )}
            </div>
          </div>
        </>,
        document.body
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

/**
 * Floating widgets layer — SelfCamFloater + CristinaWidget.
 * MainStageFAB removed 2026-05-02 (entry is centralized on the Crystal
 * Hangout card and /main-stage). SelfCamFloater stays so users who joined
 * the stage and navigated away still see their live cam preview.
 */
function FloatingWidgets({ showCompact }: { showCompact: boolean }) {
  return (
    <>
      <SelfCamFloater />
      <Suspense fallback={null}>
        <CristinaWidget compact={showCompact} />
      </Suspense>
    </>
  );
}

// REMOVED 2026-05-01 — FloatingMainStagePlayer (220×130 fixed PiP video).
// Replaced by MainStageLiveBanner mounted on Home / Live / Chat pages.
// Original code deleted from tree; recoverable from git history.
