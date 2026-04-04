import React, { useState, useEffect, useRef, useCallback } from "react";
import { Helmet } from "react-helmet-async";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useTutorial } from "@/hooks/useTutorial";
import { TutorialOverlay } from "@/components/tutorial/TutorialOverlay";
import { useI18n } from "@/lib/i18n";
import { getMessageThreads, markThreadAsRead, type MessageThread } from "@/lib/api";
import { connectSocket } from "@/lib/socket";
import { MediaMessage } from "@/components/hangouts/MediaMessage";

const API_BASE = import.meta.env.VITE_API_URL || "";

// ─── Types ───────────────────────────────────────────────────────────────────

interface DmMessage {
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

// ─── Utilities ───────────────────────────────────────────────────────────────

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

// ─── Chat View (conversation with a specific user) ──────────────────────────

function DmChatView({ userId, myDbId }: { userId: string; myDbId: string }) {
  const navigate = useNavigate();
  const [messages, setMessages] = useState<DmMessage[]>([]);
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

  // Fetch partner info + messages
  useEffect(() => {
    if (hasFetched.current) return;
    hasFetched.current = true;

    fetch(`${API_BASE}/api/webapp/dm/user/${userId}`, { credentials: "include" })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data?.success && data.user) {
          setPartnerName(data.user.first_name || data.user.username || "User");
          setPartnerPhoto(data.user.photo_file_id || null);
        }
      })
      .catch(() => {});

    fetch(`${API_BASE}/api/webapp/dm/conversation/${userId}`, { credentials: "include" })
      .then((r) => { if (!r.ok) throw new Error("Failed to load"); return r.json(); })
      .then((data) => {
        if (data.success) {
          setMessages(data.messages || []);
          setHasMore((data.messages || []).length >= 30);
        }
      })
      .catch(() => setChatError("Failed to load messages"))
      .finally(() => setIsLoading(false));

    markThreadAsRead(userId).catch(() => {});
  }, [userId]);

  // Auto-scroll on load
  useEffect(() => {
    if (!isLoading && messages.length > 0) {
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "auto" }), 50);
    }
  }, [isLoading]);

  // Socket.IO real-time
  useEffect(() => {
    const socket = connectSocket();

    const onDmMessage = (msg: DmMessage) => {
      if (String(msg.sender_id) !== String(userId)) return;
      setMessages((prev) => prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]);
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
      markThreadAsRead(userId).catch(() => {});
    };

    const onDmSent = (data: { success: boolean; message?: DmMessage }) => {
      if (!data.message) return;
      setMessages((prev) => prev.some((m) => m.id === data.message!.id) ? prev : [...prev, data.message!]);
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
    return () => { socket.off("dm:message", onDmMessage); socket.off("dm:sent", onDmSent); socket.off("dm:typing", onDmTyping); };
  }, [userId]);

  const emitTyping = () => {
    const now = Date.now();
    if (now - lastTypingEmit.current < 2000) return;
    lastTypingEmit.current = now;
    connectSocket().emit("dm:typing", { recipientId: userId });
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
        const res = await fetch(`${API_BASE}/api/webapp/dm/media/${userId}`, { method: "POST", credentials: "include", body: formData });
        if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error((err as { error?: string }).error || "Failed to send media"); }
        const data = await res.json();
        if (data.message) setMessages((prev) => prev.some((m) => m.id === data.message.id) ? prev : [...prev, data.message]);
        setMediaFile(null);
        if (mediaPreview) { URL.revokeObjectURL(mediaPreview); setMediaPreview(null); }
        setMessageInput("");
      } else {
        const res = await fetch(`${API_BASE}/api/webapp/dm/send/${userId}`, {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: messageInput.trim() }),
        });
        if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error((err as { error?: string }).error || "Failed to send"); }
        const data = await res.json();
        if (data.message) setMessages((prev) => prev.some((m) => m.id === data.message.id) ? prev : [...prev, data.message]);
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
    setMediaPreview(file.type.startsWith("image/") ? URL.createObjectURL(file) : null);
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
      const res = await fetch(`${API_BASE}/api/webapp/dm/conversation/${userId}?cursor=${encodeURIComponent(oldest.created_at)}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      const data = await res.json();
      if (data.success) { setMessages((prev) => [...(data.messages || []), ...prev]); setHasMore((data.messages || []).length >= 30); }
    } catch { /* silent */ }
    finally { setLoadingMore(false); }
  };

  const isValidPhoto = (p: string | null | undefined) => p && (p.startsWith("/") || p.startsWith("http"));

  return (
    <div className="flex flex-col" style={{ height: "calc(100dvh - 3.5rem - 4rem)" }}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-pnp-border flex-shrink-0 bg-pnp-background/95 backdrop-blur-sm">
        <button onClick={() => navigate("/dm")} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/5 active:scale-95 transition-all flex-shrink-0" aria-label="Back">
          <svg className="w-5 h-5 text-pnp-textPrimary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <button onClick={() => navigate(`/profile/${userId}`)} className="relative flex-shrink-0 active:scale-95 transition-transform">
          {isValidPhoto(partnerPhoto) ? (
            <img src={partnerPhoto!} alt="" className="w-9 h-9 rounded-full object-cover ring-1 ring-white/10" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; (e.currentTarget.nextElementSibling as HTMLElement | null)?.style.removeProperty("display"); }} />
          ) : null}
          <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold" style={{ background: "rgba(212,0,122,0.2)", color: "#D4007A", display: isValidPhoto(partnerPhoto) ? "none" : undefined }}>
            {(partnerName || "?")[0].toUpperCase()}
          </div>
        </button>
        <button onClick={() => navigate(`/profile/${userId}`)} className="flex-1 min-w-0 text-left">
          <p className="text-sm font-bold text-pnp-textPrimary truncate leading-tight">{partnerName || "Conversation"}</p>
          <p className="text-[11px] text-pnp-textSecondary leading-tight">Tap to view profile</p>
        </button>
      </div>

      {/* Error banner — dismissible */}
      {chatError && (
        <div className="px-4 py-2 bg-red-500/10 border-b border-red-500/20 flex-shrink-0 flex items-center justify-between gap-2">
          <p className="text-xs text-red-400 flex-1">{chatError}</p>
          <button onClick={() => setChatError(null)} className="text-red-400/60 hover:text-red-400 flex-shrink-0">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-2" onScroll={(e) => { if (e.currentTarget.scrollTop < 60 && hasMore && !loadingMore) loadMoreMessages(); }}>
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <div className="w-8 h-8 border-2 border-white/20 border-t-pnp-accent rounded-full animate-spin" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center px-6">
              <div className="w-14 h-14 rounded-full mx-auto mb-3 flex items-center justify-center" style={{ background: "rgba(212,0,122,0.1)" }}>
                <svg className="w-7 h-7 text-pnp-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
                </svg>
              </div>
              <p className="text-sm font-semibold text-pnp-textPrimary mb-0.5">Say hi to {partnerName || "them"}!</p>
              <p className="text-xs text-pnp-textSecondary">Send a message to start the conversation.</p>
            </div>
          </div>
        ) : (
          <>
            {loadingMore && (
              <div className="flex justify-center py-2">
                <div className="w-5 h-5 border-2 border-white/20 border-t-pnp-accent rounded-full animate-spin" />
              </div>
            )}
            {messages.map((msg, idx) => {
              const isMe = String(msg.sender_id) === String(myDbId);
              const timeStr = new Date(msg.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
              const prev = idx > 0 ? messages[idx - 1] : null;
              const sameSenderAsPrev = prev && String(prev.sender_id) === String(msg.sender_id);
              const timeDiff = prev ? new Date(msg.created_at).getTime() - new Date(prev.created_at).getTime() : Infinity;
              const isGrouped = sameSenderAsPrev && timeDiff < 60000;
              return (
                <div key={msg.id} className={`flex gap-2 ${isMe ? "flex-row-reverse" : "flex-row"} ${isGrouped ? "!mt-0.5" : ""}`}>
                  <div className={`max-w-[78%] flex flex-col ${isMe ? "items-end" : "items-start"}`}>
                    <div className={`rounded-2xl px-3 py-2 text-sm break-words ${isMe ? "text-white rounded-br-md" : "bg-white/10 text-white rounded-bl-md"}`} style={isMe ? { background: "linear-gradient(135deg, #D4007A, #E69138)" } : undefined}>
                      {msg.media_url && msg.media_type && (
                        <div className="mb-1">
                          <MediaMessage mediaUrl={msg.media_url} mediaType={msg.media_type} thumbUrl={msg.media_thumb_url} onExpandImage={(url) => setLightboxUrl(url)} isMe={isMe} />
                        </div>
                      )}
                      {msg.content && <p>{msg.content}</p>}
                      {/* Timestamp — only show on last message of a group or non-grouped */}
                      {(!isGrouped || idx === messages.length - 1 || (messages[idx + 1] && String(messages[idx + 1].sender_id) !== String(msg.sender_id))) && (
                        <p className={`text-[10px] mt-0.5 ${isMe ? "text-white/50" : "text-pnp-textSecondary/60"}`}>{timeStr}</p>
                      )}
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
        <div className="px-4 py-1 flex-shrink-0">
          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5">
            <span className="flex gap-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-pnp-textSecondary animate-bounce" style={{ animationDelay: "0ms" }} />
              <span className="w-1.5 h-1.5 rounded-full bg-pnp-textSecondary animate-bounce" style={{ animationDelay: "150ms" }} />
              <span className="w-1.5 h-1.5 rounded-full bg-pnp-textSecondary animate-bounce" style={{ animationDelay: "300ms" }} />
            </span>
            <span className="text-[11px] text-pnp-textSecondary">{partnerName}</span>
          </div>
        </div>
      )}

      {/* Media preview */}
      {mediaFile && (
        <div className="px-3 py-2 border-t border-pnp-border flex items-center gap-3 flex-shrink-0 bg-pnp-background">
          {mediaPreview ? <img src={mediaPreview} alt="" className="w-10 h-10 rounded-lg object-cover" /> : (
            <div className="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center">
              <svg className="w-4 h-4 text-pnp-textSecondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
              </svg>
            </div>
          )}
          <span className="text-xs text-pnp-textSecondary flex-1 truncate">{mediaFile.name}</span>
          <button onClick={cancelMedia} className="w-6 h-6 rounded-full flex items-center justify-center bg-red-500/10 text-red-400 hover:bg-red-500/20 active:scale-90 transition-all">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
      )}

      {/* Input bar — uses theme background */}
      <div className="flex items-end gap-2 px-3 py-2.5 border-t border-pnp-border flex-shrink-0 bg-pnp-background pb-safe">
        <input ref={mediaInputRef} type="file" accept="image/*,video/*,audio/*" className="hidden" onChange={handleMediaSelect} />
        <button type="button" onClick={() => mediaInputRef.current?.click()} className="p-2 rounded-full text-pnp-textSecondary hover:text-white hover:bg-white/10 active:scale-90 transition-all flex-shrink-0" aria-label="Attach media">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13" />
          </svg>
        </button>
        <textarea
          value={messageInput}
          onChange={(e) => { setMessageInput(e.target.value); emitTyping(); }}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } }}
          placeholder="Type a message..."
          className="flex-1 bg-white/5 text-white placeholder-pnp-textSecondary rounded-2xl px-4 py-2.5 text-sm resize-none outline-none focus:ring-1 focus:ring-pnp-accent/50 max-h-24"
          rows={1}
          style={{ minHeight: "40px" }}
        />
        <button
          type="button"
          onClick={handleSendMessage}
          disabled={sendingMessage || (!messageInput.trim() && !mediaFile)}
          className="p-2.5 rounded-full text-white active:scale-90 transition-all flex-shrink-0 disabled:opacity-30"
          style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
          aria-label="Send message"
        >
          {sendingMessage ? (
            <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
          ) : (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" /></svg>
          )}
        </button>
      </div>

      {/* Lightbox */}
      {lightboxUrl && (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center" onClick={() => setLightboxUrl(null)}>
          <button className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-white hover:bg-white/20 transition-colors" onClick={() => setLightboxUrl(null)} aria-label="Close">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
          <img src={lightboxUrl} alt="" className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg" />
        </div>
      )}
    </div>
  );
}

// ─── Thread List View (all conversations) ────────────────────────────────────

function ThreadListView() {
  const navigate = useNavigate();
  const { dm: t } = useI18n();
  const [threads, setThreads] = useState<MessageThread[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    getMessageThreads()
      .then((res) => { if (res.success) setThreads(res.threads); })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, []);

  // Listen for new messages to update thread list
  useEffect(() => {
    const socket = connectSocket();
    const onDmMessage = () => {
      getMessageThreads().then((res) => { if (res.success) setThreads(res.threads); }).catch(() => {});
    };
    socket.on("dm:message", onDmMessage);
    socket.on("dm:sent", onDmMessage);
    return () => { socket.off("dm:message", onDmMessage); socket.off("dm:sent", onDmMessage); };
  }, []);

  const isValidPhoto = (p: string | null | undefined) => p && (p.startsWith("/") || p.startsWith("http"));

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-white/20 border-t-pnp-accent rounded-full animate-spin" />
      </div>
    );
  }

  if (threads.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 px-6">
        <p className="text-4xl mb-3">💬</p>
        <p className="text-lg font-semibold text-pnp-textPrimary mb-1">{t.noConversations || "No conversations yet"}</p>
        <p className="text-sm text-pnp-textSecondary text-center mb-6">Visit someone's profile to start a conversation.</p>
        <div className="flex gap-3">
          <button
            onClick={() => navigate("/nearby")}
            className="px-4 py-2 rounded-xl text-sm font-semibold text-white transition-all active:scale-95"
            style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
          >
            Find People Nearby
          </button>
          <button
            onClick={() => navigate("/")}
            className="px-4 py-2 rounded-xl text-sm font-semibold text-pnp-textPrimary border border-pnp-border hover:bg-white/5 transition-all active:scale-95"
          >
            Browse Feed
          </button>
        </div>
      </div>
    );
  }

  const filteredThreads = search.trim()
    ? threads.filter((t) =>
        (t.firstName || "").toLowerCase().includes(search.toLowerCase()) ||
        (t.username || "").toLowerCase().includes(search.toLowerCase())
      )
    : threads;

  return (
    <div className="relative">
      {/* Search bar */}
      {threads.length > 3 && (
        <div className="px-4 pt-3 pb-1">
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-pnp-textSecondary pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search conversations..."
              className="w-full bg-white/5 text-sm text-pnp-textPrimary placeholder-pnp-textSecondary/50 rounded-xl pl-9 pr-3 py-2 outline-none focus:ring-1 focus:ring-pnp-accent/50 transition-colors"
            />
            {search && (
              <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-white/10 flex items-center justify-center text-pnp-textSecondary hover:text-white">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            )}
          </div>
        </div>
      )}
      <div className="divide-y divide-pnp-border">
      {filteredThreads.map((thread) => (
        <button
          key={thread.userId}
          onClick={() => navigate(`/dm/${thread.userId}`)}
          className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-colors text-left"
        >
          {isValidPhoto(thread.photoUrl) ? (
            <img src={thread.photoUrl!} alt="" className="w-12 h-12 rounded-full object-cover flex-shrink-0" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; (e.currentTarget.nextElementSibling as HTMLElement | null)?.style.removeProperty("display"); }} />
          ) : null}
          <div className="w-12 h-12 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0" style={{ background: "rgba(212,0,122,0.2)", color: "#D4007A", display: isValidPhoto(thread.photoUrl) ? "none" : undefined }}>
            {(thread.firstName || thread.username || "?")[0].toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-pnp-textPrimary truncate">
                {thread.firstName || thread.username || "User"}
              </p>
              <span className="text-[11px] text-pnp-textSecondary flex-shrink-0">
                {timeAgo(thread.lastMessageAt)}
              </span>
            </div>
            <p className="text-xs text-pnp-textSecondary truncate mt-0.5">
              {thread.lastMessage || "..."}
            </p>
          </div>
          {thread.unreadCount > 0 && (
            <span className="min-w-[20px] h-5 px-1 bg-[#D4007A] rounded-full text-[10px] font-bold text-white flex items-center justify-center flex-shrink-0">
              {thread.unreadCount > 99 ? "99+" : thread.unreadCount}
            </span>
          )}
        </button>
      ))}
      </div>
      {/* FAB — New Message (above bottom nav) */}
      <button
        onClick={() => navigate("/nearby")}
        title="Find people to message"
        className="fixed bottom-20 lg:bottom-6 right-4 w-12 h-12 rounded-full text-white flex items-center justify-center shadow-lg active:scale-95 transition-all z-30"
        style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
        aria-label="New Message"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" />
        </svg>
      </button>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function DirectMessages() {
  const { userId } = useParams<{ userId: string }>();
  const { user } = useAuth();
  const { showTutorial, dismissTutorial, dismissForever } = useTutorial("dm");
  const { dm: t } = useI18n();

  return (
    <>
      <Helmet>
        <title>{t.pageTitle || "Messages"} — PNPtv!</title>
        <meta name="description" content={t.pageDescription || "Your direct messages"} />
      </Helmet>
      {showTutorial && !userId && <TutorialOverlay section="dm" onDismiss={dismissTutorial} onDismissForever={dismissForever} />}
      <div className="max-w-3xl mx-auto">
        {userId ? (
          <DmChatView userId={userId} myDbId={user?.dbId ?? user?.id ?? ""} />
        ) : (
          <ThreadListView />
        )}
      </div>
    </>
  );
}
