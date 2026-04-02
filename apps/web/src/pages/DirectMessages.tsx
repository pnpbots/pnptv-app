import React, { useState, useEffect, useCallback, useRef } from "react";
import { Helmet } from "react-helmet-async";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useTutorial } from "@/hooks/useTutorial";
import { TutorialOverlay } from "@/components/tutorial/TutorialOverlay";
import { useI18n } from "@/lib/i18n";
import { connectSocket } from "@/lib/socket";
import { MediaMessage } from "@/components/hangouts/MediaMessage";
import { VideoCallOverlay } from "@/components/hangouts/VideoCallOverlay";
import {
  getMessageThreads,
  markThreadAsRead,
  editDmMessage,
  deleteDmMessage,
  searchDmMessages,
  startDmCall,
  endDmCall,
  getActiveDmCall,
  type MessageThread,
  type MessageReaction,
} from "@/lib/api";

const API_BASE = import.meta.env.VITE_API_URL || "";

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
  is_deleted?: boolean;
  created_at: string;
  edited_at?: string | null;
  edit_count?: number;
  reply_to_id?: number | null;
  reply_to?: { name: string; content: string } | null;
  reactions?: MessageReaction[];
  senderName?: string;
  senderPhoto?: string | null;
}

// Quick reaction emojis
const QUICK_REACTIONS = ["\u{1F44D}", "\u{2764}\u{FE0F}", "\u{1F602}", "\u{1F62E}", "\u{1F622}", "\u{1F44E}"];
const EMOJI_GRID = [
  "\u{1F44D}","\u{1F44E}","\u{2764}\u{FE0F}","\u{1F525}","\u{1F389}","\u{1F602}","\u{1F62E}","\u{1F622}",
  "\u{1F914}","\u{1F60D}","\u{1F44F}","\u{1F64F}","\u{1F4AF}","\u{1F60E}","\u{1F92F}","\u{1F973}",
  "\u{1F60B}","\u{1F611}","\u{1F62D}","\u{1F621}","\u{1F47B}","\u{1F4A9}","\u{1F496}","\u{2B50}",
  "\u{1F308}","\u{1F64C}","\u{270C}\u{FE0F}","\u{1F918}","\u{1F440}","\u{1F4AA}","\u{1F37B}","\u{1F381}",
];

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
        <div className="glass-card-sm p-3 mb-4 border-l-4 flex items-start gap-2" style={{ borderLeftColor: "#FF453A" }} role="alert">
          <svg className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: "#FF453A" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
          <p className="flex-1 text-sm text-white/80">{error}</p>
          <button onClick={() => { setIsLoading(true); loadThreads().finally(() => setIsLoading(false)); }} className="text-xs font-semibold" style={{ color: "#D4007A" }}>{t.retry}</button>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3" aria-label="Loading threads" aria-busy="true">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="glass-card-sm p-4 animate-pulse">
              <div className="flex gap-3">
                <div className="w-12 h-12 rounded-full bg-white/10 flex-shrink-0" />
                <div className="flex-1 space-y-2"><div className="h-4 bg-white/10 rounded w-32" /><div className="h-3 bg-white/10 rounded w-48" /></div>
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
          <p className="text-sm" style={{ color: "#8E8E93" }}>{t.noThreadsHint}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {threads.map((thread) => (
            <button key={thread.userId} onClick={() => navigate(`/dm/${thread.userId}`)} className="w-full glass-card-sm p-4 text-left hover:border-white/20 transition-colors">
              <div className="flex gap-3 items-center">
                <div className="flex-shrink-0" onClick={(e) => { e.stopPropagation(); navigate(`/profile/${thread.userId}`); }}>
                  {thread.photoUrl && (thread.photoUrl.startsWith("/") || thread.photoUrl.startsWith("http")) ? (
                    <img src={thread.photoUrl} className="w-12 h-12 rounded-full object-cover" alt="" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                  ) : (
                    <div className="w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold" style={{ background: "rgba(212, 0, 122, 0.2)", color: "#D4007A" }}>
                      {(thread.firstName || thread.username || "?")[0].toUpperCase()}
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-white text-sm truncate min-w-0">{thread.firstName || thread.username}</span>
                    <span className="text-[10px] flex-shrink-0" style={{ color: "#8E8E93" }}>{timeAgo(thread.lastMessageAt, t.timeNow)}</span>
                  </div>
                  <div className="flex items-center justify-between mt-0.5 gap-2">
                    <span className="text-xs truncate min-w-0" style={{ color: "#8E8E93" }}>{thread.lastMessage || t.mediaFallback}</span>
                    {thread.unreadCount > 0 && (
                      <span className="ml-2 flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white" style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}>
                        {thread.unreadCount > 9 ? "9+" : thread.unreadCount}
                      </span>
                    )}
                  </div>
                </div>
                <svg className="w-4 h-4 flex-shrink-0" style={{ color: "#8E8E93" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Telegram-Style Conversation View ────────────────────────────────────────

function Conversation({ userId, navigate }: { userId: string; navigate: (path: string) => void }) {
  const { user: authUser } = useAuth();
  const { dm: t } = useI18n();

  // Core state
  const [messages, setMessages] = useState<DmMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [partnerName, setPartnerName] = useState("");
  const [partnerPhoto, setPartnerPhoto] = useState<string | null>(null);
  const [messageInput, setMessageInput] = useState("");
  const [sendingMessage, setSendingMessage] = useState(false);
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaPreview, setMediaPreview] = useState<string | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const lastTypingEmit = useRef(0);

  // Telegram-style features
  const [replyingTo, setReplyingTo] = useState<DmMessage | null>(null);
  const [editingMessage, setEditingMessage] = useState<DmMessage | null>(null);
  const [contextMenu, setContextMenu] = useState<{ msg: DmMessage; x: number; y: number } | null>(null);
  const [reactionPickerMsgId, setReactionPickerMsgId] = useState<number | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<DmMessage[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [showScrollFab, setShowScrollFab] = useState(false);
  const [localDeletedIds, setLocalDeletedIds] = useState<Set<number>>(new Set());
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Video call state
  const [dmCallUrl, setDmCallUrl] = useState<string | null>(null);
  const [dmInCall, setDmInCall] = useState(false);
  const [dmCallLoading, setDmCallLoading] = useState(false);
  const [incomingCall, setIncomingCall] = useState<{ callId: string; callerName: string } | null>(null);

  // ─── Load chat ──────────────────────────────────────────────────────
  const loadChat = useCallback(async () => {
    setIsLoading(true);
    setChatError(null);

    getMessageThreads().then((res) => {
      const thread = (res.threads || []).find((th: MessageThread) => String(th.userId) === String(userId));
      if (thread) {
        setPartnerName(thread.firstName || thread.username || "");
        setPartnerPhoto(thread.photoUrl);
      }
    }).catch(() => {});

    try {
      const res = await fetch(`${API_BASE}/api/webapp/dm/conversation/${userId}`, { credentials: "include" });
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
  }, [userId]);

  useEffect(() => { loadChat(); }, [loadChat]);

  useEffect(() => {
    if (!isLoading && messages.length > 0) {
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "auto" }), 50);
    }
  }, [isLoading]);

  // ─── Socket.IO real-time ────────────────────────────────────────────
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

    const onDmEdited = (data: { messageId: number; content: string; editedAt: string; editCount: number }) => {
      setMessages((prev) => prev.map((m) => m.id === data.messageId ? { ...m, content: data.content, edited_at: data.editedAt, edit_count: data.editCount } : m));
    };

    const onDmDeleted = (data: { messageId: number; forAll: boolean }) => {
      if (data.forAll) {
        setMessages((prev) => prev.map((m) => m.id === data.messageId ? { ...m, is_deleted: true, content: null } : m));
      }
    };

    // DM call events
    const onDmCallStarted = (data: { callId: string; callerName: string; roomName: string }) => {
      setIncomingCall({ callId: data.callId, callerName: data.callerName });
    };

    const onDmCallEnded = () => {
      setIncomingCall(null);
      setDmInCall(false);
      setDmCallUrl(null);
    };

    socket.on("dm:message", onDmMessage);
    socket.on("dm:sent", onDmSent);
    socket.on("dm:typing", onDmTyping);
    socket.on("dm:message:edited", onDmEdited);
    socket.on("dm:message:deleted", onDmDeleted);
    socket.on("dm:call:started", onDmCallStarted);
    socket.on("dm:call:ended", onDmCallEnded);

    return () => {
      socket.off("dm:message", onDmMessage);
      socket.off("dm:sent", onDmSent);
      socket.off("dm:typing", onDmTyping);
      socket.off("dm:message:edited", onDmEdited);
      socket.off("dm:message:deleted", onDmDeleted);
      socket.off("dm:call:started", onDmCallStarted);
      socket.off("dm:call:ended", onDmCallEnded);
    };
  }, [userId]);

  // ─── Message actions ────────────────────────────────────────────────

  const handleSendMessage = async () => {
    if (!messageInput.trim() && !mediaFile) return;
    if (sendingMessage) return;
    setSendingMessage(true);

    try {
      // Editing
      if (editingMessage) {
        if (!messageInput.trim()) return;
        await editDmMessage(editingMessage.id, messageInput.trim());
        setMessageInput("");
        setEditingMessage(null);
        setSendingMessage(false);
        return;
      }

      if (mediaFile) {
        const formData = new FormData();
        formData.append("media", mediaFile);
        if (messageInput.trim()) formData.append("content", messageInput.trim());
        const res = await fetch(`${API_BASE}/api/webapp/dm/media/${userId}`, { method: "POST", credentials: "include", body: formData });
        if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || "Failed to send media"); }
        const data = await res.json();
        if (data.message) setMessages((prev) => prev.some((m) => m.id === data.message.id) ? prev : [...prev, data.message]);
        setMediaFile(null);
        if (mediaPreview) { URL.revokeObjectURL(mediaPreview); setMediaPreview(null); }
        setMessageInput("");
        setReplyingTo(null);
      } else {
        const body: any = { content: messageInput.trim() };
        if (replyingTo) body.replyToId = replyingTo.id;
        const res = await fetch(`${API_BASE}/api/webapp/dm/send/${userId}`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || "Failed to send"); }
        const data = await res.json();
        if (data.message) setMessages((prev) => prev.some((m) => m.id === data.message.id) ? prev : [...prev, data.message]);
        setMessageInput("");
        setReplyingTo(null);
      }
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    } catch (err) {
      setChatError(err instanceof Error ? err.message : "Failed to send message");
    } finally {
      setSendingMessage(false);
    }
  };

  const emitTyping = () => {
    const now = Date.now();
    if (now - lastTypingEmit.current < 2000) return;
    lastTypingEmit.current = now;
    connectSocket().emit("dm:typing", { recipientId: userId });
  };

  const handleMediaSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setMediaFile(file);
    setMediaPreview(file.type.startsWith("image/") ? URL.createObjectURL(file) : null);
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
      if (data.success) {
        setMessages((prev) => [...(data.messages || []), ...prev]);
        setHasMore((data.messages || []).length >= 30);
      }
    } catch { /* silent */ }
    finally { setLoadingMore(false); }
  };

  // ─── Telegram-style handlers ────────────────────────────────────────

  const handleContextMenu = useCallback((e: React.MouseEvent | React.TouchEvent, msg: DmMessage) => {
    e.preventDefault();
    e.stopPropagation();
    const x = "clientX" in e ? e.clientX : e.touches?.[0]?.clientX ?? 0;
    const y = "clientY" in e ? e.clientY : e.touches?.[0]?.clientY ?? 0;
    setContextMenu({ msg, x, y });
  }, []);

  const handleLongPressStart = useCallback((e: React.TouchEvent, msg: DmMessage) => {
    longPressTimer.current = setTimeout(() => handleContextMenu(e, msg), 500);
  }, [handleContextMenu]);

  const handleLongPressEnd = useCallback(() => {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
  }, []);

  const handleReply = useCallback((msg: DmMessage) => { setReplyingTo(msg); setContextMenu(null); }, []);
  const handleCopy = useCallback((msg: DmMessage) => { if (msg.content) navigator.clipboard.writeText(msg.content).catch(() => {}); setContextMenu(null); }, []);

  const handleEditStart = useCallback((msg: DmMessage) => {
    setEditingMessage(msg);
    setMessageInput(msg.content || "");
    setContextMenu(null);
  }, []);

  const cancelEdit = useCallback(() => { setEditingMessage(null); setMessageInput(""); }, []);

  const handleDelete = useCallback(async (msg: DmMessage, forAll: boolean) => {
    try {
      if (forAll) { await deleteDmMessage(msg.id, true); }
      else { setLocalDeletedIds((prev) => new Set(prev).add(msg.id)); }
    } catch (err) { setChatError(err instanceof Error ? err.message : "Failed to delete"); }
    setContextMenu(null);
  }, []);

  const handleReaction = useCallback(async (msgId: number, emoji: string) => {
    try {
      await fetch(`${API_BASE}/api/webapp/dm/messages/${msgId}/react`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emoji }),
      });
    } catch { /* silent */ }
    setContextMenu(null);
    setReactionPickerMsgId(null);
  }, []);

  const handleSearch = useCallback(async (q: string) => {
    if (!q.trim() || q.length < 2) return;
    setSearchLoading(true);
    try {
      const res = await searchDmMessages(userId, q);
      setSearchResults(res.messages || []);
    } catch { setSearchResults([]); }
    finally { setSearchLoading(false); }
  }, [userId]);

  // ─── Video call handlers ────────────────────────────────────────────

  const handleStartCall = async () => {
    if (dmCallLoading) return;
    setDmCallLoading(true);
    try {
      const res = await startDmCall(userId);
      if (res.meetingUrl) {
        setDmCallUrl(res.meetingUrl);
        setDmInCall(true);
      }
    } catch (err) {
      setChatError(err instanceof Error ? err.message : "Failed to start call");
    } finally {
      setDmCallLoading(false);
    }
  };

  const handleAcceptCall = async () => {
    setDmCallLoading(true);
    try {
      const res = await getActiveDmCall(userId);
      if (res.active && res.meetingUrl) {
        setDmCallUrl(res.meetingUrl);
        setDmInCall(true);
        setIncomingCall(null);
      }
    } catch (err) {
      setChatError(err instanceof Error ? err.message : "Failed to join call");
    } finally {
      setDmCallLoading(false);
    }
  };

  const handleDeclineCall = () => {
    connectSocket().emit("dm:call:decline", { callId: incomingCall?.callId });
    setIncomingCall(null);
  };

  const handleEndCall = async () => {
    try { await endDmCall(userId); } catch { /* silent */ }
    setDmInCall(false);
    setDmCallUrl(null);
  };

  // ─── Render ─────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-[calc(100dvh-4rem)] relative">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/5">
        <button onClick={() => navigate("/dm")} className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-white/5 active:scale-95 transition-all" aria-label={t.backToThreads}>
          <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
        </button>
        <button onClick={() => navigate(`/profile/${userId}`)} className="flex-1 min-w-0 text-left rounded-lg px-1">
          <h2 className="font-semibold text-white text-sm truncate">{partnerName || t.conversationFallbackTitle}</h2>
          <p className="text-[10px]" style={{ color: "#8E8E93" }}>{t.tapToViewProfile}</p>
        </button>
        {/* Search button */}
        <button onClick={() => setShowSearch(true)} className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-white/5 text-pnp-textSecondary">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" /></svg>
        </button>
        {/* Video call button */}
        <button onClick={handleStartCall} disabled={dmCallLoading} className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-white/5 text-pnp-textSecondary disabled:opacity-30">
          {dmCallLoading ? (
            <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
          ) : (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" /></svg>
          )}
        </button>
      </div>

      {/* Incoming call banner */}
      {incomingCall && (
        <div className="px-4 py-3 border-b border-white/10 flex items-center gap-3" style={{ background: "rgba(212, 0, 122, 0.15)" }}>
          <div className="flex-1">
            <p className="text-sm font-semibold text-white">{incomingCall.callerName} is calling...</p>
          </div>
          <button onClick={handleAcceptCall} className="px-4 py-1.5 rounded-full text-sm font-semibold text-white" style={{ background: "#30D158" }}>Accept</button>
          <button onClick={handleDeclineCall} className="px-4 py-1.5 rounded-full text-sm font-semibold text-white" style={{ background: "#FF453A" }}>Decline</button>
        </div>
      )}

      {/* Chat error */}
      {chatError && (
        <div className="px-4 py-2 bg-red-500/10 border-b border-red-500/20">
          <p className="text-xs text-red-400">{chatError}</p>
        </div>
      )}

      {/* Messages */}
      <div
        ref={messagesContainerRef}
        className="flex-1 min-h-0 overflow-y-auto px-3 py-2 space-y-0.5"
        onScroll={(e) => {
          const el = e.currentTarget;
          if (el.scrollTop < 60 && hasMore && !loadingMore) loadMoreMessages();
          setShowScrollFab(el.scrollHeight - el.scrollTop - el.clientHeight > 200);
        }}
      >
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <div className="flex flex-col items-center gap-3">
              <div className="w-8 h-8 border-2 border-white/20 border-t-pnp-accent rounded-full animate-spin" />
              <p className="text-sm" style={{ color: "#8E8E93" }}>Loading chat...</p>
            </div>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center px-6">
              <p className="text-2xl mb-2">💬</p>
              <p className="text-sm text-pnp-textSecondary">Start a conversation!</p>
            </div>
          </div>
        ) : (
          <>
            {loadingMore && (
              <div className="flex justify-center py-2">
                <svg className="w-5 h-5 text-pnp-accent animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
              </div>
            )}

            {(() => {
              const visible = messages.filter((m) => !localDeletedIds.has(m.id));
              let lastDateStr = "";
              return visible.map((msg, idx) => {
                const isMe = String(msg.sender_id) === String(authUser?.dbId);
                const prev = idx > 0 ? visible[idx - 1] : null;
                const next = idx < visible.length - 1 ? visible[idx + 1] : null;
                const timeStr = new Date(msg.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

                const sameUserAsPrev = prev && String(prev.sender_id) === String(msg.sender_id) &&
                  (new Date(msg.created_at).getTime() - new Date(prev.created_at).getTime()) < 60000;
                const sameUserAsNext = next && String(next.sender_id) === String(msg.sender_id) &&
                  (new Date(next.created_at).getTime() - new Date(msg.created_at).getTime()) < 60000;
                const isLastInGroup = !sameUserAsNext;

                // Date separator
                const msgDate = new Date(msg.created_at);
                const dateStr = msgDate.toDateString();
                let dateSeparator = null;
                if (dateStr !== lastDateStr) {
                  lastDateStr = dateStr;
                  const today = new Date().toDateString();
                  const yesterday = new Date(Date.now() - 86400000).toDateString();
                  const label = dateStr === today ? "Today" : dateStr === yesterday ? "Yesterday" : msgDate.toLocaleDateString([], { month: "long", day: "numeric" });
                  dateSeparator = <div key={`date-${dateStr}`} className="flex justify-center py-2"><span className="text-[11px] text-pnp-textSecondary bg-white/5 px-3 py-0.5 rounded-full">{label}</span></div>;
                }

                // Deleted
                if (msg.is_deleted) {
                  return (
                    <React.Fragment key={msg.id}>
                      {dateSeparator}
                      <div className={`flex gap-2 ${isMe ? "flex-row-reverse" : "flex-row"} ${!sameUserAsPrev ? "mt-2" : "mt-0.5"}`}>
                        <div className={`max-w-[75%] flex flex-col ${isMe ? "items-end" : "items-start"}`}>
                          <div className="rounded-2xl px-3 py-2 text-sm bg-white/5 border border-white/10 italic text-pnp-textSecondary">This message was deleted</div>
                        </div>
                      </div>
                    </React.Fragment>
                  );
                }

                return (
                  <React.Fragment key={msg.id}>
                    {dateSeparator}
                    <div
                      data-msg-id={msg.id}
                      className={`flex gap-2 ${isMe ? "flex-row-reverse" : "flex-row"} ${!sameUserAsPrev ? "mt-2" : "mt-0.5"}`}
                      onContextMenu={(e) => handleContextMenu(e, msg)}
                      onTouchStart={(e) => handleLongPressStart(e, msg)}
                      onTouchEnd={handleLongPressEnd}
                      onTouchMove={handleLongPressEnd}
                    >
                      <div className={`max-w-[75%] flex flex-col ${isMe ? "items-end" : "items-start"}`}>
                        {/* Reply preview */}
                        {msg.reply_to && (
                          <div className={`text-[10px] px-2 py-1 mb-0.5 rounded-lg border-l-2 max-w-full ${isMe ? "bg-white/10 border-white/30" : "bg-white/5 border-pnp-accent/50"}`}>
                            <span className="font-semibold text-pnp-accent">{msg.reply_to.name}</span>
                            <p className="text-pnp-textSecondary truncate">{msg.reply_to.content}</p>
                          </div>
                        )}

                        <div
                          className={`relative px-3 py-2 text-sm break-words ${
                            isMe
                              ? `text-white ${isLastInGroup ? "rounded-2xl rounded-br-sm" : "rounded-2xl"}`
                              : `bg-white/10 text-white ${isLastInGroup ? "rounded-2xl rounded-bl-sm" : "rounded-2xl"}`
                          }`}
                          style={isMe ? { background: "linear-gradient(135deg, #D4007A, #E69138)" } : undefined}
                        >
                          {/* SVG tail */}
                          {isLastInGroup && (
                            <svg className={`absolute bottom-0 w-2 h-3 ${isMe ? "-right-1.5" : "-left-1.5"}`} viewBox="0 0 8 12" fill={isMe ? "#E69138" : "rgba(255,255,255,0.1)"}>
                              {isMe ? <path d="M0 0 C0 0 0 12 8 12 C3 12 0 8 0 0Z" /> : <path d="M8 0 C8 0 8 12 0 12 C5 12 8 8 8 0Z" />}
                            </svg>
                          )}

                          {/* Media */}
                          {msg.media_url && msg.media_type && (
                            <div className="mb-1">
                              <MediaMessage mediaUrl={msg.media_url} mediaType={msg.media_type} thumbUrl={msg.media_thumb_url} onExpandImage={(url) => setLightboxUrl(url)} isMe={isMe} />
                            </div>
                          )}

                          {/* Text */}
                          {msg.content && <p>{msg.content}</p>}

                          {/* Timestamp + edited + read receipt */}
                          <div className={`flex items-center gap-1 mt-0.5 ${isMe ? "justify-end" : ""}`}>
                            {msg.edited_at && <span className={`text-[9px] ${isMe ? "text-white/50" : "text-pnp-textSecondary"}`}>edited</span>}
                            <span className={`text-[10px] ${isMe ? "text-white/60" : "text-pnp-textSecondary"}`}>{timeStr}</span>
                            {isMe && (
                              <span className={`text-[10px] ${msg.is_read ? "text-blue-400" : "text-white/40"}`}>
                                {msg.is_read ? "\u2713\u2713" : "\u2713"}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Reactions */}
                        {msg.reactions && msg.reactions.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-0.5 ml-1">
                            {msg.reactions.map((r) => (
                              <button key={r.emoji} onClick={() => handleReaction(msg.id, r.emoji)} className={`inline-flex items-center gap-0.5 text-xs px-1.5 py-0.5 rounded-full border transition-colors ${r.reacted_by_me ? "border-pnp-accent/50 bg-pnp-accent/10" : "border-white/10 bg-white/5 hover:bg-white/10"}`}>
                                <span>{r.emoji}</span><span className="text-[10px] text-pnp-textSecondary">{r.count}</span>
                              </button>
                            ))}
                            <button onClick={() => setReactionPickerMsgId(msg.id)} className="text-xs px-1.5 py-0.5 rounded-full border border-white/10 bg-white/5 hover:bg-white/10 text-pnp-textSecondary">+</button>
                          </div>
                        )}
                      </div>
                    </div>
                  </React.Fragment>
                );
              });
            })()}

            {/* Scroll FAB */}
            {showScrollFab && (
              <button onClick={() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })} className="sticky bottom-2 left-1/2 -translate-x-1/2 z-10 w-10 h-10 rounded-full bg-pnp-surface border border-pnp-border shadow-lg flex items-center justify-center hover:bg-white/10">
                <svg className="w-5 h-5 text-pnp-textSecondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" /></svg>
              </button>
            )}

            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Telegram typing indicator */}
      {isTyping && (
        <div className="px-4 py-1 flex items-center gap-2">
          <div className="bg-white/10 rounded-2xl rounded-bl-sm px-3 py-2 inline-flex items-center gap-1.5">
            <span className="text-[10px] text-pnp-textSecondary mr-1">{partnerName}</span>
            <span className="w-1.5 h-1.5 rounded-full bg-pnp-textSecondary animate-bounce" style={{ animationDelay: "0ms" }} />
            <span className="w-1.5 h-1.5 rounded-full bg-pnp-textSecondary animate-bounce" style={{ animationDelay: "150ms" }} />
            <span className="w-1.5 h-1.5 rounded-full bg-pnp-textSecondary animate-bounce" style={{ animationDelay: "300ms" }} />
          </div>
        </div>
      )}

      {/* Reply/Edit preview bar */}
      {(replyingTo || editingMessage) && (
        <div className="px-3 py-2 border-t border-pnp-border flex items-center gap-2" style={{ background: "#1C1C1E" }}>
          <div className="flex-1 border-l-2 border-pnp-accent pl-2">
            <p className="text-[10px] font-semibold text-pnp-accent">{editingMessage ? "Editing message" : `Reply to ${partnerName || "User"}`}</p>
            <p className="text-xs text-pnp-textSecondary truncate">{(editingMessage?.content || replyingTo?.content || "[media]").slice(0, 80)}</p>
          </div>
          <button onClick={() => { setReplyingTo(null); cancelEdit(); }} className="p-1 rounded-full hover:bg-white/10 text-pnp-textSecondary">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
      )}

      {/* Media preview */}
      {mediaFile && (
        <div className="px-3 py-2 border-t border-pnp-border flex items-center gap-2">
          {mediaPreview ? <img src={mediaPreview} alt="" className="w-12 h-12 rounded-lg object-cover" /> : (
            <div className="w-12 h-12 rounded-lg bg-white/10 flex items-center justify-center">
              <svg className="w-5 h-5 text-pnp-textSecondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" /></svg>
            </div>
          )}
          <span className="text-xs text-pnp-textSecondary flex-1 truncate">{mediaFile.name}</span>
          <button onClick={cancelMedia} className="text-red-400 text-xs font-semibold">Remove</button>
        </div>
      )}

      {/* Message input */}
      <div className="flex items-end gap-2 px-3 py-2 border-t border-pnp-border" style={{ background: "#1C1C1E" }}>
        <input ref={mediaInputRef} type="file" accept="image/*,video/*,audio/*" className="hidden" onChange={handleMediaSelect} />
        <button type="button" onClick={() => mediaInputRef.current?.click()} className="p-2 rounded-full text-pnp-textSecondary hover:text-white hover:bg-white/10 active:scale-90 transition-all flex-shrink-0" aria-label="Attach media">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13" /></svg>
        </button>
        <textarea value={messageInput} onChange={(e) => { setMessageInput(e.target.value); emitTyping(); }} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } }} placeholder="Type a message..." className="flex-1 bg-white/5 text-white placeholder-pnp-textSecondary rounded-2xl px-4 py-2.5 text-sm resize-none outline-none focus:ring-1 focus:ring-pnp-accent/50 max-h-24" rows={1} style={{ minHeight: "40px" }} />
        <button type="button" onClick={handleSendMessage} disabled={sendingMessage || (!messageInput.trim() && !mediaFile)} className="p-2 rounded-full text-white active:scale-90 transition-all flex-shrink-0 disabled:opacity-30" style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }} aria-label="Send message">
          {sendingMessage ? (
            <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
          ) : (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" /></svg>
          )}
        </button>
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div className="fixed inset-0 z-[85]" onClick={() => setContextMenu(null)}>
          <div className="absolute rounded-xl overflow-hidden shadow-2xl border border-white/10" style={{ background: "#2C2C2E", left: Math.min(contextMenu.x, window.innerWidth - 200), top: Math.min(contextMenu.y, window.innerHeight - 300), minWidth: 180 }} onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-around px-3 py-2 border-b border-white/10">
              {QUICK_REACTIONS.map((emoji) => (
                <button key={emoji} onClick={() => handleReaction(contextMenu.msg.id, emoji)} className="text-lg hover:scale-125 transition-transform active:scale-90">{emoji}</button>
              ))}
            </div>
            <div className="py-1">
              <button onClick={() => handleReply(contextMenu.msg)} className="w-full text-left px-4 py-2.5 text-sm text-white hover:bg-white/10 flex items-center gap-3">
                <svg className="w-4 h-4 text-pnp-textSecondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" /></svg>Reply
              </button>
              {contextMenu.msg.content && (
                <button onClick={() => handleCopy(contextMenu.msg)} className="w-full text-left px-4 py-2.5 text-sm text-white hover:bg-white/10 flex items-center gap-3">
                  <svg className="w-4 h-4 text-pnp-textSecondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" /></svg>Copy
                </button>
              )}
              {String(contextMenu.msg.sender_id) === String(authUser?.dbId) && contextMenu.msg.content && (Date.now() - new Date(contextMenu.msg.created_at).getTime()) < 48 * 3600 * 1000 && (
                <button onClick={() => handleEditStart(contextMenu.msg)} className="w-full text-left px-4 py-2.5 text-sm text-white hover:bg-white/10 flex items-center gap-3">
                  <svg className="w-4 h-4 text-pnp-textSecondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" /></svg>Edit
                </button>
              )}
              {String(contextMenu.msg.sender_id) === String(authUser?.dbId) && (
                <>
                  <button onClick={() => handleDelete(contextMenu.msg, false)} className="w-full text-left px-4 py-2.5 text-sm text-red-400 hover:bg-white/10 flex items-center gap-3">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" /></svg>Delete for me
                  </button>
                  {(Date.now() - new Date(contextMenu.msg.created_at).getTime()) < 48 * 3600 * 1000 && (
                    <button onClick={() => handleDelete(contextMenu.msg, true)} className="w-full text-left px-4 py-2.5 text-sm text-red-400 hover:bg-white/10 flex items-center gap-3">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" /></svg>Delete for everyone
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Reaction picker */}
      {reactionPickerMsgId && (
        <div className="fixed inset-0 z-[85] flex items-end justify-center" style={{ background: "rgba(0,0,0,0.5)" }} onClick={() => setReactionPickerMsgId(null)}>
          <div className="w-full max-w-md rounded-t-2xl p-4" style={{ background: "#2C2C2E" }} onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-center mb-3"><div className="w-10 h-1 rounded-full bg-white/20" /></div>
            <div className="grid grid-cols-8 gap-2">
              {EMOJI_GRID.map((emoji) => (
                <button key={emoji} onClick={() => handleReaction(reactionPickerMsgId, emoji)} className="text-2xl p-1 hover:scale-125 transition-transform active:scale-90 rounded-lg hover:bg-white/10">{emoji}</button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Search overlay */}
      {showSearch && (
        <div className="absolute inset-0 z-[60] flex flex-col" style={{ background: "#1C1C1E" }}>
          <div className="flex items-center gap-2 px-3 py-2 border-b border-pnp-border">
            <button onClick={() => { setShowSearch(false); setSearchQuery(""); setSearchResults([]); }} className="p-2 text-pnp-textSecondary">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" /></svg>
            </button>
            <input type="text" value={searchQuery} onChange={(e) => { setSearchQuery(e.target.value); if (e.target.value.length >= 2) handleSearch(e.target.value); }} placeholder="Search messages..." className="flex-1 bg-white/5 text-white placeholder-pnp-textSecondary rounded-xl px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-pnp-accent/50" autoFocus />
          </div>
          <div className="flex-1 overflow-y-auto">
            {searchLoading ? (
              <div className="flex justify-center py-8"><svg className="w-6 h-6 text-pnp-accent animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg></div>
            ) : searchResults.length === 0 && searchQuery.length >= 2 ? (
              <p className="text-center text-sm text-pnp-textSecondary py-8">No messages found</p>
            ) : (
              searchResults.map((msg) => (
                <button key={msg.id} onClick={() => { setShowSearch(false); setSearchQuery(""); setSearchResults([]); const el = document.querySelector(`[data-msg-id="${msg.id}"]`); if (el) el.scrollIntoView({ behavior: "smooth", block: "center" }); }} className="w-full text-left px-4 py-3 border-b border-white/5 hover:bg-white/5">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-semibold text-pnp-accent">{String(msg.sender_id) === String(authUser?.dbId) ? "You" : partnerName}</span>
                    <span className="text-[10px] text-pnp-textSecondary">{new Date(msg.created_at).toLocaleDateString([], { month: "short", day: "numeric" })}</span>
                  </div>
                  <p className="text-sm text-white truncate">{msg.content}</p>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {/* Lightbox */}
      {lightboxUrl && (
        <div className="fixed inset-0 z-[80] bg-black/90 flex items-center justify-center" onClick={() => setLightboxUrl(null)}>
          <button onClick={() => setLightboxUrl(null)} className="absolute top-4 right-4 z-10 p-2 rounded-full bg-white/10 text-white" aria-label="Close">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
          <img src={lightboxUrl} alt="" className="max-w-full max-h-full object-contain" onClick={(e) => e.stopPropagation()} />
        </div>
      )}

      {/* Video call overlay */}
      {dmInCall && dmCallUrl && (
        <VideoCallOverlay
          meetingUrl={dmCallUrl}
          groupName={partnerName || "Video Call"}
          onClose={handleEndCall}
          isAdmin={false}
          isModerator={true}
        />
      )}
    </div>
  );
}
