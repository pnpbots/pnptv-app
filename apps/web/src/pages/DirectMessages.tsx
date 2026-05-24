import React, { useState, useEffect, useRef, useCallback } from "react";
import { Helmet } from "react-helmet-async";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useTier } from "@/hooks/useTier";
import { useTutorial } from "@/hooks/useTutorial";
import { TutorialOverlay } from "@/components/tutorial/TutorialOverlay";
import { useI18n } from "@/lib/i18n";
import { PermissionGate } from "@/components/PermissionGate";
import {
  createDmVideoCall,
  getDmThreads,
  joinDmVideoCall,
  markThreadAsRead,
  toggleDmMessageReaction,
  editDmMessage,
  pinDmThread,
  muteDmThread,
  archiveDmThread,
  setDmReadReceipts,
  markDmThreadUnread,
  pinDmMessage as pinDmMessageApi,
  deleteDmMessage as deleteDmMessageApi,
  searchAllDms,
  forwardDmMessage,
  getDmPresence,
  searchUsersForNewChat,
  type DmSearchResult,
  type DmVideoCallSession,
  type MessageThread,
} from "@/lib/api";
import { connectSocket } from "@/lib/socket";
import { MediaMessage } from "@/components/hangouts/MediaMessage";
import LiveKitCallPanel from "@/components/hangouts/LiveKitCallDock";

const API_BASE = import.meta.env.VITE_API_URL || "";

// ─── Types ───────────────────────────────────────────────────────────────────

interface DmReaction {
  emoji: string;
  count: number;
  users: Array<{ id: string; username: string }>;
}

interface ReplyPreview {
  id: number;
  senderId: string;
  content: string;
  mediaType: "image" | "video" | "audio" | null;
  isDeleted: boolean;
}

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
  read_at?: string | null;
  reply_to_id?: number | null;
  replyPreview?: ReplyPreview | null;
  reactions?: DmReaction[];
  message_type?: "text" | "post_card" | string;
  meta?: {
    postId?: number;
    snapshot?: {
      authorUsername?: string | null;
      authorFirstName?: string | null;
      content?: string | null;
      mediaUrl?: string | null;
      mediaType?: string | null;
      note?: string | null;
    };
  } | null;
}

interface ParsedDmCallInvite {
  roomName: string;
  callerId: string;
  calleeId: string;
  url: string;
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

// Telegram-style smart timestamp for thread list rows
function smartTimestamp(dateStr: string): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const yest = new Date(now); yest.setDate(now.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return "Yesterday";
  const diffDays = (now.getTime() - d.getTime()) / 86400000;
  if (diffDays < 7) return d.toLocaleDateString([], { weekday: "short" });
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString([], { day: "2-digit", month: "short" });
  return d.toLocaleDateString([], { day: "2-digit", month: "short", year: "2-digit" });
}

// Date separator label between message groups
function dayLabel(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return "Today";
  const yest = new Date(now); yest.setDate(now.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return "Yesterday";
  const diffDays = (now.getTime() - d.getTime()) / 86400000;
  if (diffDays < 7) return d.toLocaleDateString([], { weekday: "long" });
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString([], { day: "2-digit", month: "long" });
  return d.toLocaleDateString([], { day: "2-digit", month: "long", year: "numeric" });
}

// "Last seen 5m" formatter (presence subtitle)
function lastSeenLabel(iso: string | null): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "last seen recently";
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `last seen ${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `last seen ${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `last seen ${days}d ago`;
  return `last seen ${new Date(iso).toLocaleDateString([], { day: "2-digit", month: "short" })}`;
}

// Format last-message preview line for thread list ("You: 📷 Photo")
function buildPreview(t: MessageThread, myDbId: string): string {
  const isMine = t.lastMessageSenderId && String(t.lastMessageSenderId) === String(myDbId);
  const prefix = isMine ? "You: " : "";
  const mediaType = t.lastMessageMediaType;
  if (mediaType === "image") return prefix + (t.lastMessage ? `📷 ${t.lastMessage}` : "📷 Photo");
  if (mediaType === "video") return prefix + (t.lastMessage ? `🎥 ${t.lastMessage}` : "🎥 Video");
  if (mediaType === "audio") return prefix + "🎤 Voice message";
  return prefix + (t.lastMessage || "…");
}

// Compute partner identity from MessageThread (handle legacy + new keys)
function partnerOf(t: MessageThread): { id: string; name: string; photo: string | null } {
  return {
    id: String(t.partnerId ?? t.userId ?? ""),
    name: t.partnerFirstName || t.partnerUsername || t.firstName || t.username || "User",
    photo: (t.partnerPhoto ?? t.photoUrl ?? null) as string | null,
  };
}

// ─── Emoji data ───────────────────────────────────────────────────────────────

const ALLOWED_REACTIONS = ["😈", "❤️", "😆", "🔝", "🐷", "🍆", "🍑", "💨", "🚀"] as const;
const QUICK_REACTIONS = ALLOWED_REACTIONS;
const URL_REGEX = /(https?:\/\/[^\s]+)/g;


function parseDmCallInvite(content: string | null): ParsedDmCallInvite | null {
  if (!content) return null;

  const urlMatch = content.match(URL_REGEX)?.[0];
  if (!urlMatch) return null;

  try {
    const url = new URL(urlMatch);
    const roomName = url.searchParams.get("call");
    const callerId = url.searchParams.get("caller");
    const calleeId = url.searchParams.get("callee");

    if (!roomName || !callerId || !calleeId || url.pathname !== "/dm") {
      return null;
    }

    return {
      roomName,
      callerId,
      calleeId,
      url: url.toString(),
    };
  } catch {
    return null;
  }
}

function renderTextWithLinks(content: string) {
  const matches = content.match(URL_REGEX) || [];
  const parts = content.split(URL_REGEX);

  return parts.map((part, idx) => (
    <React.Fragment key={`${part}-${idx}`}>
      {part}
      {matches[idx] && (
        <a
          href={matches[idx]}
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2 break-all text-white/90"
        >
          {matches[idx]}
        </a>
      )}
    </React.Fragment>
  ));
}

// ─── DM LiveKit Surface ──────────────────────────────────────────────────────

interface DmCallSurfaceProps {
  token: string;
  livekitUrl: string;
  roomName: string;
  partnerName: string;
  onClose: () => void;
}

// Standardized DM call surface — uses the same LiveKitCallPanel as hangout
// group calls so toolbar / device selector / layout / mute-on-join all match.
// Wrapped in a fixed overlay so the call floats above the chat (same UX role
// the old draggable panel served).
function DmCallSurface({ token, livekitUrl, roomName, partnerName, onClose }: DmCallSurfaceProps) {
  return (
    <div className="fixed inset-0 z-[95] flex items-stretch justify-center bg-black/60 backdrop-blur-sm p-2 sm:p-4">
      <div className="flex w-full max-w-3xl flex-col">
        <LiveKitCallPanel
          open={true}
          token={token}
          livekitUrl={livekitUrl}
          roomName={roomName}
          startedBy={partnerName || null}
          onClose={onClose}
          onCallEnded={onClose}
        />
      </div>
    </div>
  );
}

// ─── Chat View (conversation with a specific user) ──────────────────────────

function DmChatView({ userId, myDbId, myUserId, isAdmin }: { userId: string; myDbId: string; myUserId: string; isAdmin: boolean }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [messages, setMessages] = useState<DmMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [messageInput, setMessageInput] = useState("");
  const [sendingMessage, setSendingMessage] = useState(false);
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaPreview, setMediaPreview] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [isTyping, setIsTyping] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [partnerName, setPartnerName] = useState("");
  const [partnerPhoto, setPartnerPhoto] = useState<string | null>(null);
  const [showPermGate, setShowPermGate] = useState(false);
  const [pendingCallRoom, setPendingCallRoom] = useState<string | null>(null);
  const [activeCall, setActiveCall] = useState<DmVideoCallSession | null>(null);
  const [callBusy, setCallBusy] = useState(false);
  const [incomingCall, setIncomingCall] = useState<{ roomName: string; callerId: string; calleeId: string; callerName: string } | null>(null);
  const incomingCallDismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Context menu / delete confirm
  const [contextMenu, setContextMenu] = useState<{ msg: DmMessage; x: number; y: number } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<DmMessage | null>(null);
  const [recentlyReacted, setRecentlyReacted] = useState<Set<string>>(new Set());

  // Telegram-style: presence, reply, edit, forward, pin, scroll-to-bottom, in-chat search, more-menu
  const [partnerOnline, setPartnerOnline] = useState(false);
  const [partnerLastSeen, setPartnerLastSeen] = useState<string | null>(null);
  const [partnerMutedUntil, setPartnerMutedUntil] = useState<string | null>(null);
  const [hideReadReceipts, setHideReadReceipts] = useState<boolean>(false);
  const [pinnedMessageId, setPinnedMessageId] = useState<number | null>(null);
  const [replyTo, setReplyTo] = useState<DmMessage | null>(null);
  const [editingMsg, setEditingMsg] = useState<DmMessage | null>(null);
  const [forwardingMsg, setForwardingMsg] = useState<DmMessage | null>(null);
  const [showHeaderMenu, setShowHeaderMenu] = useState(false);
  const [inChatSearch, setInChatSearch] = useState<{ open: boolean; q: string; results: DmMessage[]; idx: number } | null>(null);
  const [scrolledUpBy, setScrolledUpBy] = useState(0);
  const [newMessagesWhileScrolledUp, setNewMessagesWhileScrolledUp] = useState(0);
  const [partnerReadAt, setPartnerReadAt] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<number | null>(null);
  const swipeState = useRef<{ id: number | null; startX: number; startY: number; dx: number }>({ id: null, startX: 0, startY: 0, dx: 0 });
  const messageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const jumpToParam = searchParams.get("jumpTo");

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageInputRef = useRef<HTMLTextAreaElement>(null);
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recorderStreamRef = useRef<MediaStream | null>(null);
  const recorderChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastTypingEmit = useRef(0);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inviteRoomFromQuery = searchParams.get("call");

  const syncCallParams = useCallback((roomName: string, callerId: string, calleeId: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("call", roomName);
    next.set("caller", callerId);
    next.set("callee", calleeId);
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const clearCallParams = useCallback(() => {
    const next = new URLSearchParams(searchParams);
    next.delete("call");
    next.delete("caller");
    next.delete("callee");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const copyToClipboard = useCallback(async (value: string) => {
    if (!navigator.clipboard?.writeText) return false;
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      return false;
    }
  }, []);

  // Fetch partner info + messages
  useEffect(() => {
    setIsLoading(true);
    setChatError(null);
    setMessages([]);
    setHasMore(true);
    setPartnerName("");
    setPartnerPhoto(null);

    fetch(`${API_BASE}/api/webapp/dm/user/${userId}`, { credentials: "include" })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data?.success && data.user) {
          setPartnerName(data.user.first_name || data.user.username || "User");
          setPartnerPhoto(data.user.photo_file_id || null);
        }
      })
      .catch(() => {});

    // Initial presence
    getDmPresence([userId])
      .then((r) => {
        const entry = r.presence?.[0];
        if (entry) {
          setPartnerOnline(!!entry.online);
          setPartnerLastSeen(entry.lastSeen || null);
        }
      })
      .catch(() => {});

    // Thread state (pinnedMessageId / mutedUntil) — derive from threads list
    getDmThreads()
      .then((r) => {
        const t = (r.threads || []).find((x) => String(partnerOf(x).id) === String(userId));
        if (t) {
          setPinnedMessageId(t.pinnedMessageId || null);
          setPartnerMutedUntil(t.mutedUntil || null);
          setHideReadReceipts(t.hideReadReceipts === true);
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

  useEffect(() => {
    if (!inviteRoomFromQuery || activeCall?.roomName === inviteRoomFromQuery) return;
    setPendingCallRoom(inviteRoomFromQuery);
  }, [activeCall?.roomName, inviteRoomFromQuery]);

  // Socket.IO real-time
  useEffect(() => {
    const socket = connectSocket();

    const onDmMessage = (msg: DmMessage) => {
      // Accept messages where userId (the partner) is on either side of the conversation.
      // Also accept messages the current user sent via Socket.IO dm:send (sender_id === myDbId)
      // that arrive on the dm:message channel (some server paths emit to sender room too).
      const involvesPartner = String(msg.sender_id) === String(userId) || String(msg.recipient_id) === String(userId);
      const isMySend = String(msg.sender_id) === String(myDbId);
      if (!involvesPartner && !isMySend) return;
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
      setMessages((prev) =>
        prev.map((m) =>
          m.id === data.messageId
            ? { ...m, content: data.content, edited_at: data.editedAt }
            : m
        )
      );
    };

    const onDmDeleted = (data: { messageId: number; forAll: boolean }) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === data.messageId ? { ...m, is_deleted: true, content: null } : m
        )
      );
    };

    const onDmReactionUpdated = (data: { messageId: number; reactions: DmReaction[] }) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === data.messageId ? { ...m, reactions: data.reactions } : m
        )
      );
    };

    const onDmError = (data: { message?: string; error?: string }) => {
      setChatError(data.message || data.error || "Something went wrong");
    };

    const onDmCallIncoming = (data: { roomName: string; callerId: string; calleeId: string; callerName: string }) => {
      // Only show if we're the callee
      if (String(data.calleeId) !== String(myUserId)) return;
      setIncomingCall(data);
      // Auto-dismiss after 30 seconds
      if (incomingCallDismissTimer.current) clearTimeout(incomingCallDismissTimer.current);
      incomingCallDismissTimer.current = setTimeout(() => {
        setIncomingCall(null);
        incomingCallDismissTimer.current = null;
      }, 30000);
    };

    const onDmCallDeclined = () => {
      setIncomingCall(null);
      if (incomingCallDismissTimer.current) {
        clearTimeout(incomingCallDismissTimer.current);
        incomingCallDismissTimer.current = null;
      }
    };

    const onPresenceUpdate = (data: { userId: string; online: boolean; lastSeen: string | null }) => {
      if (String(data.userId) !== String(userId)) return;
      setPartnerOnline(!!data.online);
      setPartnerLastSeen(data.lastSeen || null);
    };

    const onDmReadByPartner = (data: { partnerId: string; readAt: string }) => {
      if (String(data.partnerId) !== String(userId)) return;
      setPartnerReadAt(data.readAt);
    };

    socket.on("dm:message", onDmMessage);
    socket.on("dm:sent", onDmSent);
    socket.on("dm:typing", onDmTyping);
    socket.on("dm:message:edited", onDmEdited);
    socket.on("dm:message:deleted", onDmDeleted);
    socket.on("dm:reaction:updated", onDmReactionUpdated);
    socket.on("dm:error", onDmError);
    socket.on("dm:call:incoming", onDmCallIncoming);
    socket.on("dm:call:declined", onDmCallDeclined);
    socket.on("presence:update", onPresenceUpdate);
    socket.on("dm:message:read", onDmReadByPartner);

    // Heartbeat so the server keeps me marked online while this tab is open
    heartbeatRef.current = setInterval(() => {
      try { socket.emit("presence:heartbeat"); } catch { /* ignore */ }
    }, 45_000);

    return () => {
      socket.off("dm:message", onDmMessage);
      socket.off("dm:sent", onDmSent);
      socket.off("dm:typing", onDmTyping);
      socket.off("dm:message:edited", onDmEdited);
      socket.off("dm:message:deleted", onDmDeleted);
      socket.off("dm:reaction:updated", onDmReactionUpdated);
      socket.off("dm:error", onDmError);
      socket.off("dm:call:incoming", onDmCallIncoming);
      socket.off("dm:call:declined", onDmCallDeclined);
      socket.off("presence:update", onPresenceUpdate);
      socket.off("dm:message:read", onDmReadByPartner);
      if (heartbeatRef.current) { clearInterval(heartbeatRef.current); heartbeatRef.current = null; }
      // Clear any pending long-press timer to avoid state updates after unmount
      if (longPressTimer.current) {
        clearTimeout(longPressTimer.current);
        longPressTimer.current = null;
      }
      if (incomingCallDismissTimer.current) {
        clearTimeout(incomingCallDismissTimer.current);
        incomingCallDismissTimer.current = null;
      }
    };
  }, [userId, myUserId]);

  const emitTyping = () => {
    const now = Date.now();
    if (now - lastTypingEmit.current < 2000) return;
    lastTypingEmit.current = now;
    connectSocket().emit("dm:typing", { recipientId: userId });
  };

  // Auto-grow the message textarea so multi-line drafts expand naturally
  // (matches WhatsApp/Telegram/iMessage). Capped at ~4 lines via max-height
  // in the className; beyond that the textarea scrolls internally.
  useEffect(() => {
    const el = messageInputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [messageInput]);

  const beginJoinCall = useCallback((roomName: string, callerId?: string | null, calleeId?: string | null) => {
    setPendingCallRoom(roomName);
    if (callerId && calleeId) {
      syncCallParams(roomName, callerId, calleeId);
    }
    setShowPermGate(true);
  }, [syncCallParams]);

  const handleJoinCall = useCallback(async () => {
    if (!pendingCallRoom) return;

    setShowPermGate(false);
    setCallBusy(true);
    setChatError(null);

    try {
      const session = await joinDmVideoCall(pendingCallRoom);
      setActiveCall(session);
      syncCallParams(session.roomName, session.callerId, session.calleeId);
    } catch (err) {
      setChatError(err instanceof Error ? err.message : "Failed to join video call");
    } finally {
      setCallBusy(false);
    }
  }, [pendingCallRoom, syncCallParams]);

  const handleStartVideoCall = useCallback(async () => {
    if (callBusy) return;

    setCallBusy(true);
    setChatError(null);

    try {
      const invite = await createDmVideoCall(userId);
      const inviteMessage = `Join my PNPtv video call:\n${invite.callLink}`;
      const res = await fetch(`${API_BASE}/api/webapp/dm/send/${userId}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: inviteMessage }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.message) {
          setMessages((prev) => prev.some((m) => m.id === data.message.id) ? prev : [...prev, data.message]);
          setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
        }
      }

      await copyToClipboard(invite.callLink);
      setPendingCallRoom(invite.roomName);
      syncCallParams(invite.roomName, invite.callerId, invite.calleeId);
      setShowPermGate(true);
    } catch (err) {
      setChatError(err instanceof Error ? err.message : "Failed to start video call");
    } finally {
      setCallBusy(false);
    }
  }, [callBusy, copyToClipboard, syncCallParams, userId]);

  const closeActiveCall = useCallback(() => {
    setActiveCall(null);
    setPendingCallRoom(null);
    clearCallParams();
  }, [clearCallParams]);

  const uploadMediaWithProgress = (file: File, caption: string): Promise<{ message?: DmMessage }> => {
    return new Promise((resolve, reject) => {
      const formData = new FormData();
      formData.append("media", file);
      if (caption) formData.append("content", caption);
      if (replyTo) formData.append("replyToId", String(replyTo.id));
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${API_BASE}/api/webapp/dm/media/${userId}`);
      xhr.withCredentials = true;
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) setUploadProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        setUploadProgress(null);
        let data: { error?: string; message?: DmMessage } = {};
        try { data = JSON.parse(xhr.responseText); } catch { /* ignore */ }
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else reject(new Error(data.error || `Upload failed (${xhr.status})`));
      };
      xhr.onerror = () => { setUploadProgress(null); reject(new Error("Network error during upload")); };
      xhr.onabort = () => { setUploadProgress(null); reject(new Error("Upload cancelled")); };
      xhr.send(formData);
    });
  };

  const handleSendMessage = async () => {
    if (!messageInput.trim() && !mediaFile) return;
    if (sendingMessage) return;
    setSendingMessage(true);
    setChatError(null);
    try {
      // Edit mode: just patch the message via API
      if (editingMsg) {
        const trimmed = messageInput.trim();
        if (!trimmed) { setSendingMessage(false); return; }
        await editDmMessage(editingMsg.id, trimmed);
        setMessages((prev) => prev.map((m) =>
          m.id === editingMsg.id ? { ...m, content: trimmed, edited_at: new Date().toISOString() } : m
        ));
        setEditingMsg(null);
        setMessageInput("");
        setSendingMessage(false);
        return;
      }

      if (mediaFile) {
        setUploadProgress(0);
        const data = await uploadMediaWithProgress(mediaFile, messageInput.trim());
        if (data.message) setMessages((prev) => prev.some((m) => m.id === data.message!.id) ? prev : [...prev, data.message!]);
        setMediaFile(null);
        if (mediaPreview) { URL.revokeObjectURL(mediaPreview); setMediaPreview(null); }
        setMessageInput("");
        setReplyTo(null);
      } else {
        const body: { content: string; replyToId?: number } = { content: messageInput.trim() };
        if (replyTo) body.replyToId = replyTo.id;
        const res = await fetch(`${API_BASE}/api/webapp/dm/send/${userId}`, {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error((err as { error?: string }).error || "Failed to send"); }
        const data = await res.json();
        if (data.ticketNotice) {
          // DM to Cristina AI was redirected to support ticket
          if (data.message) setMessages((prev) => [...prev, data.message, { id: Date.now(), sender_id: "cristina-ai", recipient_id: userId, content: data.ticketNotice, is_read: true, created_at: new Date().toISOString() } as any]);
          setMessageInput("");
        } else {
          if (data.message) {
            const augmented = replyTo ? { ...data.message, replyPreview: { id: replyTo.id, senderId: replyTo.sender_id, content: (replyTo.content || "").slice(0, 80), mediaType: replyTo.media_type, isDeleted: !!replyTo.is_deleted } } : data.message;
            setMessages((prev) => prev.some((m) => m.id === augmented.id) ? prev : [...prev, augmented]);
          }
          setMessageInput("");
          setReplyTo(null);
        }
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

  // ── Voice note recording ─────────────────────────────────────────────────
  const pickAudioMime = (): string => {
    const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];
    for (const m of candidates) {
      if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)) return m;
    }
    return "";
  };

  const stopRecordingStream = () => {
    if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
    recorderStreamRef.current?.getTracks().forEach((t) => t.stop());
    recorderStreamRef.current = null;
    mediaRecorderRef.current = null;
    setIsRecording(false);
    setRecordingSeconds(0);
  };

  const startRecording = async () => {
    if (isRecording) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recorderStreamRef.current = stream;
      const mime = pickAudioMime();
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      recorderChunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) recorderChunksRef.current.push(e.data); };
      rec.onstop = () => {
        const blob = new Blob(recorderChunksRef.current, { type: rec.mimeType || "audio/webm" });
        recorderChunksRef.current = [];
        const ext = (rec.mimeType || "audio/webm").includes("mp4") ? "m4a" : (rec.mimeType || "").includes("ogg") ? "ogg" : "webm";
        const file = new File([blob], `voice-${Date.now()}.${ext}`, { type: blob.type });
        setMediaFile(file);
        setMediaPreview(null);
        stopRecordingStream();
      };
      mediaRecorderRef.current = rec;
      rec.start();
      setIsRecording(true);
      setRecordingSeconds(0);
      recordingTimerRef.current = setInterval(() => {
        setRecordingSeconds((s) => {
          if (s >= 119) { // 2-minute hard cap
            try { rec.state === "recording" && rec.stop(); } catch { /* ignore */ }
            return s;
          }
          return s + 1;
        });
      }, 1000);
    } catch (err) {
      setChatError(err instanceof Error && err.name === "NotAllowedError" ? "Permiso de micrófono denegado" : "No se pudo iniciar la grabación");
      stopRecordingStream();
    }
  };

  const stopRecording = () => {
    const rec = mediaRecorderRef.current;
    if (rec && rec.state === "recording") {
      rec.stop();
    } else {
      stopRecordingStream();
    }
  };

  const cancelRecording = () => {
    const rec = mediaRecorderRef.current;
    if (rec && rec.state === "recording") {
      rec.ondataavailable = null;
      rec.onstop = null;
      try { rec.stop(); } catch { /* ignore */ }
    }
    recorderChunksRef.current = [];
    stopRecordingStream();
  };

  // Clean up on unmount
  useEffect(() => () => { cancelRecording(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

  const handleReaction = useCallback(async (msgId: number, emoji: string) => {
    const key = `${msgId}-${emoji}`;
    setRecentlyReacted((prev) => new Set(prev).add(key));
    setTimeout(() => {
      setRecentlyReacted((prev) => { const next = new Set(prev); next.delete(key); return next; });
    }, 300);
    setContextMenu(null);
    try {
      const result = await toggleDmMessageReaction(msgId, emoji);
      setMessages((prev) => prev.map((m) => m.id === msgId ? { ...m, reactions: result.reactions } : m));
    } catch { /* silent */ }
  }, []);

  const handleContextMenu = (msg: DmMessage, e: React.MouseEvent) => {
    if (msg.is_deleted) return;
    e.preventDefault();
    setContextMenu({ msg, x: e.clientX, y: e.clientY });
  };

  const handleTouchStart = (msg: DmMessage, e: React.TouchEvent) => {
    if (msg.is_deleted) return;
    const touch = e.touches[0];
    longPressTimer.current = setTimeout(() => {
      setContextMenu({ msg, x: touch.clientX, y: touch.clientY });
      try { (window as any).Telegram?.WebApp?.HapticFeedback?.impactOccurred?.("medium"); } catch { /* ignore */ }
    }, 380);
  };

  const handleTouchEnd = () => {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
  };

  const handleDeleteMsg = (msg: DmMessage) => {
    setContextMenu(null);
    setConfirmDelete(msg);
  };

  const handleDeleteConfirm = async (forAll: boolean) => {
    if (!confirmDelete) return;
    const msg = confirmDelete;
    setConfirmDelete(null);
    const isOwnMsg = String(msg.sender_id) === String(myDbId);
    if (forAll || isAdmin) {
      setMessages((prev) => prev.map((m) => m.id === msg.id ? { ...m, is_deleted: true, content: null } : m));
    }
    if (isAdmin && !isOwnMsg) {
      // Use HTTP API for admin deletes on others' messages so the backend respects the role
      try { await deleteDmMessageApi(msg.id); } catch { /* non-fatal; optimistic update already applied */ }
    } else {
      connectSocket().emit("dm:message:delete", { messageId: msg.id, forAll });
    }
  };

  const handleReply = (msg: DmMessage) => {
    setContextMenu(null);
    setEditingMsg(null);
    setReplyTo(msg);
  };

  const handleStartEdit = (msg: DmMessage) => {
    setContextMenu(null);
    setReplyTo(null);
    setEditingMsg(msg);
    setMessageInput(msg.content || "");
  };

  const handleCopyMsg = async (msg: DmMessage) => {
    setContextMenu(null);
    if (!msg.content) return;
    try { await navigator.clipboard.writeText(msg.content); } catch { /* ignore */ }
  };

  const handleForwardMsg = (msg: DmMessage) => {
    setContextMenu(null);
    setForwardingMsg(msg);
  };

  const handlePinMsg = async (msg: DmMessage) => {
    setContextMenu(null);
    const isPinning = pinnedMessageId !== msg.id;
    setPinnedMessageId(isPinning ? msg.id : null);
    try {
      await pinDmMessageApi(userId, isPinning ? msg.id : null);
    } catch {
      // revert on failure
      setPinnedMessageId(pinnedMessageId);
    }
  };

  const scrollToMessage = useCallback((id: number) => {
    const el = messageRefs.current.get(id);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightId(id);
    setTimeout(() => setHighlightId((curr) => (curr === id ? null : curr)), 1600);
  }, []);

  // Handle ?jumpTo=:id query
  useEffect(() => {
    if (!jumpToParam || isLoading || !messages.length) return;
    const id = Number(jumpToParam);
    if (Number.isFinite(id)) {
      setTimeout(() => scrollToMessage(id), 200);
      // Strip the param so reload doesn't re-jump
      const next = new URLSearchParams(searchParams);
      next.delete("jumpTo");
      setSearchParams(next, { replace: true });
    }
  }, [jumpToParam, isLoading, messages.length, scrollToMessage, searchParams, setSearchParams]);

  // Track scroll position for scroll-to-bottom FAB and new-message badge
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setScrolledUpBy(distanceFromBottom);
    if (distanceFromBottom < 60) setNewMessagesWhileScrolledUp(0);
    if (el.scrollTop < 60 && hasMore && !loadingMore) loadMoreMessages();
  };

  // Bump new-message badge if a message arrived while scrolled up
  useEffect(() => {
    if (scrolledUpBy > 200 && messages.length > 0) {
      const last = messages[messages.length - 1];
      if (last && String(last.sender_id) !== String(myDbId)) {
        setNewMessagesWhileScrolledUp((n) => n + 1);
      }
    }
    // intentionally only watch messages length
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length]);

  // Swipe-to-reply on mobile
  const handleBubbleTouchStart = (msg: DmMessage, e: React.TouchEvent<HTMLDivElement>) => {
    if (msg.is_deleted) return;
    const touch = e.touches[0];
    swipeState.current = { id: msg.id, startX: touch.clientX, startY: touch.clientY, dx: 0 };
  };
  const handleBubbleTouchMove = (msg: DmMessage, e: React.TouchEvent<HTMLDivElement>) => {
    if (swipeState.current.id !== msg.id) return;
    const touch = e.touches[0];
    const dx = touch.clientX - swipeState.current.startX;
    const dy = Math.abs(touch.clientY - swipeState.current.startY);
    if (dy > 20) { swipeState.current.id = null; return; }
    if (dx > 0 && dx < 100) {
      swipeState.current.dx = dx;
      const el = e.currentTarget as HTMLElement;
      el.style.transform = `translateX(${dx * 0.6}px)`;
    }
  };
  const handleBubbleTouchEnd = (msg: DmMessage, e: React.TouchEvent<HTMLDivElement>) => {
    const el = e.currentTarget as HTMLElement;
    el.style.transform = "";
    if (swipeState.current.id === msg.id && swipeState.current.dx > 50) {
      handleReply(msg);
    }
    swipeState.current = { id: null, startX: 0, startY: 0, dx: 0 };
  };

  // In-chat search
  const runInChatSearch = async (q: string) => {
    setInChatSearch((curr) => ({ open: true, q, results: curr?.results || [], idx: 0 }));
    if (q.trim().length < 2) {
      setInChatSearch({ open: true, q, results: [], idx: 0 });
      return;
    }
    try {
      const r = await fetch(`${API_BASE}/api/webapp/dm/conversation/${userId}/search?q=${encodeURIComponent(q.trim())}`, { credentials: "include" });
      const data = await r.json();
      if (data.success) {
        setInChatSearch({ open: true, q, results: data.messages || [], idx: 0 });
        if ((data.messages || []).length > 0) scrollToMessage(data.messages[0].id);
      }
    } catch { /* silent */ }
  };

  const isPartnerMuted = !!(partnerMutedUntil && new Date(partnerMutedUntil).getTime() > Date.now());

  const handleToggleMute = async () => {
    setShowHeaderMenu(false);
    try {
      const r = await muteDmThread(userId, isPartnerMuted ? null : "forever");
      setPartnerMutedUntil(r.mutedUntil);
    } catch { /* silent */ }
  };

  // N-07: toggle per-thread read-receipts visibility
  const handleToggleReadReceipts = async () => {
    setShowHeaderMenu(false);
    const next = !hideReadReceipts;
    setHideReadReceipts(next); // optimistic
    try {
      const r = await setDmReadReceipts(userId, next);
      setHideReadReceipts(r.hideReadReceipts);
    } catch {
      setHideReadReceipts(!next); // revert on failure
    }
  };

  // Forward submit
  const submitForward = async (recipientIds: string[], note: string) => {
    if (!forwardingMsg) return;
    try {
      await forwardDmMessage(forwardingMsg.id, recipientIds, note || undefined);
      setForwardingMsg(null);
    } catch (err) {
      setChatError(err instanceof Error ? err.message : "Failed to forward");
    }
  };

  const isValidPhoto = (p: string | null | undefined) => p && (p.startsWith("/") || p.startsWith("http"));

  const renderMessageContent = (content: string | null) => {
    if (!content) return null;

    const callInvite = parseDmCallInvite(content);
    if (callInvite) {
      const inviteLabel = content.replace(callInvite.url, "").trim() || "PNPtv video call invite";
      const inviteActive = activeCall?.roomName === callInvite.roomName;
      const canJoinInvite =
        String(myUserId) === String(callInvite.callerId) ||
        String(myUserId) === String(callInvite.calleeId);

      return (
        <div className="space-y-2">
          <div>
            <p className="font-semibold">{inviteLabel}</p>
            <p className="text-xs mt-1 text-white/70">Open the call right here in chat.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => beginJoinCall(callInvite.roomName, callInvite.callerId, callInvite.calleeId)}
              disabled={!canJoinInvite}
              className="px-3 py-1.5 rounded-xl text-xs font-semibold text-white transition-all active:scale-95 disabled:opacity-50"
              style={{ background: "rgba(255,255,255,0.16)" }}
            >
              {inviteActive ? "Return to call" : "Join call"}
            </button>
            <button
              type="button"
              onClick={() => void copyToClipboard(callInvite.url)}
              className="px-3 py-1.5 rounded-xl text-xs font-semibold text-white/80 border border-white/10 hover:bg-white/5 transition-all active:scale-95"
            >
              Copy link
            </button>
          </div>
        </div>
      );
    }

    return <p>{renderTextWithLinks(content)}</p>;
  };

  return (
    <div className="flex flex-col" style={{ height: "calc(100dvh - 3.5rem - 4rem)" }}>
      {/* Header — sticky-pinned so the video-call button is always reachable
          even when iOS PWA chrome shifts or the on-screen keyboard reflows
          the chat. The flex-column layout already keeps it from shrinking;
          sticky+top-0+z-10 is belt-and-suspenders for mobile edge cases. */}
      <div className="sticky top-0 z-10 flex items-center gap-2 px-3 py-2.5 border-b border-pnp-border flex-shrink-0 bg-pnp-background/95 backdrop-blur-sm">
        <button onClick={() => navigate("/dm")} className="w-11 h-11 flex items-center justify-center rounded-full hover:bg-white/5 active:scale-95 transition-all flex-shrink-0" aria-label="Back">
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
          {partnerOnline && (
            <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-green-400 ring-2 ring-pnp-background" aria-label="online" />
          )}
        </button>
        <button onClick={() => navigate(`/profile/${userId}`)} className="flex-1 min-w-0 text-left">
          <p className="text-sm font-bold text-pnp-textPrimary truncate leading-tight flex items-center gap-1">
            {partnerName || "Conversation"}
            {isPartnerMuted && (
              <svg className="w-3 h-3 text-pnp-textSecondary/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15zM17 14l4-4m0 4l-4-4" /></svg>
            )}
          </p>
          <p className="text-[11px] leading-tight">
            {isTyping ? (
              <span className="italic text-pnp-accent">typing…</span>
            ) : partnerOnline ? (
              <span className="text-green-400">online</span>
            ) : partnerLastSeen ? (
              <span className="text-pnp-textSecondary">{lastSeenLabel(partnerLastSeen)}</span>
            ) : (
              <span className="text-pnp-textSecondary">Tap to view profile</span>
            )}
          </p>
        </button>
        <button
          type="button"
          onClick={() => void handleStartVideoCall()}
          disabled={callBusy}
          className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-white/5 active:scale-95 transition-all flex-shrink-0 disabled:opacity-50"
          title={`Start video call with ${partnerName || "this user"}`}
          aria-label="Start video call"
        >
          {callBusy ? (
            <svg className="w-5 h-5 animate-spin text-pnp-accent" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="#29A8E2" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
            </svg>
          )}
        </button>
        <div className="relative flex-shrink-0">
          <button
            type="button"
            onClick={() => setShowHeaderMenu((v) => !v)}
            className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-white/5 active:scale-95 transition-all"
            aria-label="More"
          >
            <svg className="w-5 h-5 text-pnp-textPrimary" fill="currentColor" viewBox="0 0 20 20"><circle cx="10" cy="4" r="1.5" /><circle cx="10" cy="10" r="1.5" /><circle cx="10" cy="16" r="1.5" /></svg>
          </button>
          {showHeaderMenu && (
            <>
              <div className="fixed inset-0 z-[40]" onClick={() => setShowHeaderMenu(false)} />
              <div className="absolute right-0 mt-1 w-52 z-[41] rounded-2xl shadow-2xl overflow-hidden" style={{ background: "var(--pnp-surface-hover)", border: "1px solid rgba(255,255,255,0.1)" }}>
                <button onClick={() => { setShowHeaderMenu(false); setInChatSearch({ open: true, q: "", results: [], idx: 0 }); }} className="w-full px-4 py-2.5 text-sm text-left text-pnp-textPrimary hover:bg-white/10 transition-colors flex items-center gap-3">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" /></svg>
                  Search in chat
                </button>
                <button onClick={handleToggleMute} className="w-full px-4 py-2.5 text-sm text-left text-pnp-textPrimary hover:bg-white/10 transition-colors flex items-center gap-3">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>
                  {isPartnerMuted ? "Unmute" : "Mute notifications"}
                </button>
                <button onClick={handleToggleReadReceipts} className="w-full px-4 py-2.5 text-sm text-left text-pnp-textPrimary hover:bg-white/10 transition-colors flex items-center gap-3">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    {hideReadReceipts ? (
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                    ) : (
                      <>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </>
                    )}
                  </svg>
                  {hideReadReceipts ? "Show read receipts" : "Hide read receipts"}
                </button>
                <button onClick={() => { setShowHeaderMenu(false); navigate(`/profile/${userId}`); }} className="w-full px-4 py-2.5 text-sm text-left text-pnp-textPrimary hover:bg-white/10 transition-colors flex items-center gap-3">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                  View profile
                </button>
              </div>
            </>
          )}
        </div>
      </div>
      {inChatSearch?.open && (
        <div className="px-3 py-2 border-b border-pnp-border flex items-center gap-2 flex-shrink-0 bg-pnp-background/95 backdrop-blur-sm">
          <input
            type="text"
            autoFocus
            value={inChatSearch.q}
            onChange={(e) => runInChatSearch(e.target.value)}
            placeholder="Search in this chat…"
            className="flex-1 bg-white/5 text-pnp-textPrimary placeholder-pnp-textSecondary/50 rounded-xl px-3 py-2 outline-none focus:ring-1 focus:ring-pnp-accent/50"
            style={{ fontSize: "16px" }}
          />
          {inChatSearch.results.length > 0 && (
            <span className="text-[11px] text-pnp-textSecondary tabular-nums px-1">
              {inChatSearch.idx + 1}/{inChatSearch.results.length}
            </span>
          )}
          <button
            onClick={() => {
              if (!inChatSearch.results.length) return;
              const next = (inChatSearch.idx + 1) % inChatSearch.results.length;
              setInChatSearch({ ...inChatSearch, idx: next });
              scrollToMessage(inChatSearch.results[next].id);
            }}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/5 active:scale-95 disabled:opacity-30"
            disabled={!inChatSearch.results.length}
            aria-label="Next match"
          >
            <svg className="w-4 h-4 text-pnp-textPrimary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
          </button>
          <button onClick={() => setInChatSearch(null)} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/5 active:scale-95" aria-label="Close search">
            <svg className="w-4 h-4 text-pnp-textPrimary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
      )}
      {pinnedMessageId && (() => {
        const pinned = messages.find((m) => m.id === pinnedMessageId);
        if (!pinned) return null;
        const label = pinned.is_deleted
          ? "(deleted)"
          : pinned.media_type === "image"
            ? `📷 ${pinned.content || "Photo"}`
            : pinned.media_type === "video"
              ? `🎥 ${pinned.content || "Video"}`
              : pinned.media_type === "audio"
                ? "🎤 Voice message"
                : (pinned.content || "");
        return (
          <button
            onClick={() => scrollToMessage(pinned.id)}
            className="w-full px-3 py-2 border-b border-pnp-border flex items-center gap-2 flex-shrink-0 text-left hover:bg-white/5 transition-colors"
            style={{ background: "rgba(212,0,122,0.06)" }}
          >
            <div className="w-1 h-8 rounded-full" style={{ background: "linear-gradient(180deg, #D4007A, #E69138)" }} />
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-bold text-pnp-accent uppercase tracking-wider">📌 Pinned message</p>
              <p className="text-xs text-pnp-textPrimary truncate">{label}</p>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); void pinDmMessageApi(userId, null).then(() => setPinnedMessageId(null)); }}
              className="w-6 h-6 rounded-full flex items-center justify-center text-pnp-textSecondary hover:text-pnp-textPrimary hover:bg-white/10"
              aria-label="Unpin"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </button>
        );
      })()}

      {inviteRoomFromQuery && !activeCall && (
        <div className="px-3 py-2 border-b border-pnp-border bg-[#101114] flex items-center justify-between gap-3 flex-shrink-0">
          <div>
            <p className="text-sm font-semibold text-pnp-textPrimary">Video call invite</p>
            <p className="text-xs text-pnp-textSecondary">Join the call without leaving this chat.</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => beginJoinCall(inviteRoomFromQuery)}
              className="px-3 py-1.5 rounded-xl text-xs font-semibold text-white transition-all active:scale-95"
              style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
            >
              Join
            </button>
            <button
              type="button"
              onClick={clearCallParams}
              className="px-3 py-1.5 rounded-xl text-xs font-semibold text-pnp-textSecondary border border-white/10 hover:bg-white/5 transition-all active:scale-95"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Incoming call notification banner */}
      {incomingCall && (
        <div className="px-3 py-2.5 border-b border-pnp-border flex items-center justify-between gap-3 flex-shrink-0 bg-[#0d1f0d]">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-2.5 h-2.5 rounded-full bg-green-400 animate-pulse flex-shrink-0" />
            <p className="text-sm font-semibold text-white truncate">
              Incoming call from {incomingCall.callerName}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              type="button"
              onClick={() => {
                const call = incomingCall;
                setIncomingCall(null);
                if (incomingCallDismissTimer.current) {
                  clearTimeout(incomingCallDismissTimer.current);
                  incomingCallDismissTimer.current = null;
                }
                beginJoinCall(call.roomName, call.callerId, call.calleeId);
              }}
              className="px-3 py-1.5 rounded-xl text-xs font-semibold text-white transition-all active:scale-95 bg-green-600 hover:bg-green-500"
            >
              Answer
            </button>
            <button
              type="button"
              onClick={() => {
                const call = incomingCall;
                setIncomingCall(null);
                if (incomingCallDismissTimer.current) {
                  clearTimeout(incomingCallDismissTimer.current);
                  incomingCallDismissTimer.current = null;
                }
                connectSocket().emit("dm:call:decline", { roomName: call.roomName });
              }}
              className="px-3 py-1.5 rounded-xl text-xs font-semibold text-white/80 border border-white/10 hover:bg-red-500/20 hover:border-red-500/40 hover:text-red-400 transition-all active:scale-95"
            >
              Decline
            </button>
          </div>
        </div>
      )}

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
      <div ref={scrollContainerRef} className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-2 relative" onScroll={handleScroll}>
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
              const showDaySeparator = !prev || new Date(msg.created_at).toDateString() !== new Date(prev.created_at).toDateString();
              const wasReadByPartner = isMe && (msg.read_at != null || (partnerReadAt != null && new Date(msg.created_at).getTime() <= new Date(partnerReadAt).getTime()));
              const isHighlighted = highlightId === msg.id;

              return (
                <React.Fragment key={msg.id}>
                  {showDaySeparator && (
                    <div className="flex justify-center my-3 sticky top-0 z-[1] pointer-events-none">
                      <span className="px-3 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider text-pnp-textSecondary" style={{ background: "rgba(20,20,22,0.85)", backdropFilter: "blur(6px)" }}>
                        {dayLabel(msg.created_at)}
                      </span>
                    </div>
                  )}
                <div
                  ref={(el) => { if (el) messageRefs.current.set(msg.id, el); else messageRefs.current.delete(msg.id); }}
                  className={`flex gap-2 ${isMe ? "flex-row-reverse" : "flex-row"} items-end ${isGrouped ? "!mt-0.5" : ""} transition-all group/msg`}
                  onContextMenu={(e) => handleContextMenu(msg, e)}
                  onTouchStart={(e) => { handleTouchStart(msg, e); handleBubbleTouchStart(msg, e); }}
                  onTouchEnd={(e) => { handleTouchEnd(); handleBubbleTouchEnd(msg, e); }}
                  onTouchMove={(e) => { handleTouchEnd(); handleBubbleTouchMove(msg, e); }}
                  style={{ transition: "transform 200ms ease-out", background: isHighlighted ? "rgba(212,0,122,0.12)" : undefined, borderRadius: isHighlighted ? "12px" : undefined }}
                >
                  {/* Partner avatar — only on incoming messages, only at bottom of group to avoid repetition */}
                  {!isMe && (
                    isGrouped ? (
                      <div className="w-7 flex-shrink-0" aria-hidden />
                    ) : partnerPhoto ? (
                      <img
                        src={partnerPhoto}
                        alt=""
                        className="w-7 h-7 rounded-full object-cover flex-shrink-0 self-end"
                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                      />
                    ) : (
                      <div
                        className="w-7 h-7 rounded-full flex-shrink-0 self-end flex items-center justify-center text-[11px] font-bold text-white"
                        style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
                      >
                        {(partnerName || "?")[0].toUpperCase()}
                      </div>
                    )
                  )}
                  <div className={`max-w-[78%] flex flex-col ${isMe ? "items-end" : "items-start"}`}>
                    {msg.is_deleted ? (
                      <div className="rounded-2xl px-3 py-1.5 text-xs italic text-pnp-textSecondary/50 bg-white/5">
                        Message deleted
                      </div>
                    ) : (
                      <div
                        className={`rounded-2xl px-3 py-2 text-sm break-words ${isMe ? "text-white rounded-br-md" : "bg-white/10 text-white rounded-bl-md"}`}
                        style={isMe ? { background: "linear-gradient(135deg, #D4007A, #E69138)" } : undefined}
                      >
                        {msg.replyPreview && (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); scrollToMessage(msg.replyPreview!.id); }}
                            className="block text-left -mx-3 -mt-2 mb-1.5 px-3 py-2 border-l-[3px] rounded-t-2xl hover:brightness-110 transition-all"
                            style={{ borderColor: isMe ? "rgba(255,255,255,0.85)" : "#D4007A", background: isMe ? "rgba(0,0,0,0.25)" : "rgba(212,0,122,0.15)" }}
                          >
                            <p className={`text-[11px] font-semibold flex items-center gap-1 mb-0.5 ${isMe ? "text-white" : "text-pnp-accent"}`}>
                              <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a5 5 0 015 5v4M3 10l4-4m-4 4l4 4" />
                              </svg>
                              <span className="truncate">{String(msg.replyPreview.senderId) === String(myDbId) ? "You" : (partnerName || "Them")}</span>
                            </p>
                            <p className={`text-[11px] line-clamp-2 leading-snug ${isMe ? "text-white/90" : "text-pnp-textSecondary"}`}>
                              {msg.replyPreview.isDeleted ? "(deleted)" : msg.replyPreview.mediaType === "image" ? "📷 Photo" : msg.replyPreview.mediaType === "video" ? "🎥 Video" : msg.replyPreview.mediaType === "audio" ? "🎤 Voice" : (msg.replyPreview.content || "")}
                            </p>
                          </button>
                        )}
                        {msg.media_url && msg.media_type === "audio" ? (
                          <VoiceBubble src={msg.media_url} id={msg.id} isMe={isMe} />
                        ) : msg.media_url && msg.media_type ? (
                          <div className="mb-1">
                            <MediaMessage mediaUrl={msg.media_url} mediaType={msg.media_type} thumbUrl={msg.media_thumb_url} onExpandImage={(url) => setLightboxUrl(url)} isMe={isMe} />
                          </div>
                        ) : null}
                        {msg.message_type === "post_card" && (msg.meta as any)?.kind === "forward" ? (() => {
                          const meta = msg.meta as any;
                          const src = (meta?.source || {}) as {
                            authorUsername?: string | null;
                            authorFirstName?: string | null;
                            text?: string | null;
                            mediaUrl?: string | null;
                            mediaType?: string | null;
                            mediaThumbUrl?: string | null;
                          };
                          const author = src.authorUsername
                            ? `@${src.authorUsername}`
                            : (src.authorFirstName || "User");
                          const authorPath = src.authorUsername ? `/profile/${src.authorUsername}` : null;
                          const srcText = typeof src.text === "string" ? src.text : "";
                          const noteText = typeof meta?.note === "string" ? meta.note : "";
                          const thumb = src.mediaThumbUrl
                            || (src.mediaType === "image" || src.mediaType === "video" ? src.mediaUrl : null);
                          const isVideo = src.mediaType === "video";
                          const hasThumb = !!thumb;
                          return (
                            <>
                              {noteText && <p className="mb-1.5 text-sm">{noteText}</p>}
                              <div className="w-full rounded-lg overflow-hidden border border-white/15 bg-black/20">
                                {hasThumb && (
                                  <div className="relative w-full bg-black/40" style={{ aspectRatio: "16/9" }}>
                                    {isVideo ? (
                                      <video src={thumb!} className="w-full h-full object-cover" muted playsInline preload="metadata" />
                                    ) : (
                                      <img src={thumb!} alt="" className="w-full h-full object-cover" />
                                    )}
                                    {isVideo && (
                                      <span className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                        <span className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: "rgba(0,0,0,0.55)" }}>
                                          <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>
                                        </span>
                                      </span>
                                    )}
                                  </div>
                                )}
                                <div className="px-2.5 py-2">
                                  <div className="flex items-center gap-1.5">
                                    <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} style={{ color: isMe ? "rgba(255,255,255,0.85)" : "#5ED1C4" }} aria-hidden="true">
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 17l5-5-5-5M4 18v-2a4 4 0 014-4h12" />
                                    </svg>
                                    {authorPath ? (
                                      <button
                                        type="button"
                                        onClick={(e) => { e.stopPropagation(); navigate(authorPath); }}
                                        className="text-[11px] font-semibold hover:underline truncate"
                                        style={{ color: isMe ? "rgba(255,255,255,0.95)" : "#5ED1C4" }}
                                      >
                                        Forwarded from {author}
                                      </button>
                                    ) : (
                                      <span className="text-[11px] font-semibold truncate" style={{ color: isMe ? "rgba(255,255,255,0.95)" : "#5ED1C4" }}>
                                        Forwarded from {author}
                                      </span>
                                    )}
                                  </div>
                                  {srcText && (
                                    <div className={`text-xs mt-0.5 line-clamp-4 ${isMe ? "text-white/85" : "text-white/80"}`}>
                                      {srcText}
                                    </div>
                                  )}
                                  {!srcText && !hasThumb && src.mediaType === "audio" && (
                                    <p className={`text-xs mt-0.5 ${isMe ? "text-white/70" : "text-white/60"}`}>🎤 Voice message</p>
                                  )}
                                </div>
                              </div>
                            </>
                          );
                        })() : msg.message_type === "post_card" && msg.meta?.postId ? (() => {
                          const snap = msg.meta.snapshot || {};
                          const handleName = snap.authorUsername
                            ? `@${snap.authorUsername}`
                            : (snap.authorFirstName || "User");
                          const preview = snap.content || "";
                          const isVideo = snap.mediaType === "video";
                          const authorPath = snap.authorUsername ? `/profile/${snap.authorUsername}` : null;
                          return (
                            <>
                              {snap.note && <p className="mb-1.5 text-sm">{snap.note}</p>}
                              <div className="w-full rounded-lg overflow-hidden border border-white/15 hover:border-white/25 bg-black/20 transition-colors">
                                {(snap.videoThumbnailUrl || snap.mediaUrl) && (
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); navigate(`/post/${msg.meta!.postId}`); }}
                                    className="w-full text-left"
                                    aria-label="View post"
                                  >
                                    <div className="relative w-full bg-black/40" style={{ aspectRatio: "16/9" }}>
                                      <img src={snap.videoThumbnailUrl || snap.mediaUrl} alt="" className="w-full h-full object-cover" />
                                      {isVideo && (
                                        <span className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                          <span className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: "rgba(0,0,0,0.55)" }}>
                                            <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                                          </span>
                                        </span>
                                      )}
                                    </div>
                                  </button>
                                )}
                                <div className="px-2.5 py-2">
                                  {authorPath ? (
                                    <button
                                      type="button"
                                      onClick={(e) => { e.stopPropagation(); navigate(authorPath); }}
                                      className="text-[11px] font-semibold hover:underline"
                                      style={{ color: isMe ? "rgba(255,255,255,0.95)" : "#5ED1C4" }}
                                    >
                                      📎 {handleName}
                                    </button>
                                  ) : (
                                    <div className="text-[11px] font-semibold" style={{ color: isMe ? "rgba(255,255,255,0.95)" : "#5ED1C4" }}>
                                      📎 {handleName}
                                    </div>
                                  )}
                                  {preview && (
                                    <div className={`text-xs mt-0.5 line-clamp-3 ${isMe ? "text-white/85" : "text-white/80"}`}>
                                      {preview}
                                    </div>
                                  )}
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); navigate(`/post/${msg.meta!.postId}`); }}
                                    className={`text-[10px] mt-1 hover:underline ${isMe ? "text-white/70" : "text-pnp-accent"}`}
                                  >
                                    Tap to view post →
                                  </button>
                                </div>
                              </div>
                            </>
                          );
                        })() : renderMessageContent(msg.content)}
                        <div className={`flex items-center gap-1 mt-0.5 ${isMe ? "justify-end" : ""}`}>
                          {msg.id === pinnedMessageId && (
                            <svg className={`w-2.5 h-2.5 ${isMe ? "text-white/50" : "text-pnp-textSecondary/60"}`} fill="currentColor" viewBox="0 0 20 20"><path d="M10 2a1 1 0 011 1v3.586l1.707 1.707a1 1 0 01.293.707V13a1 1 0 01-1 1h-2v4a1 1 0 11-2 0v-4H6a1 1 0 01-1-1V9a1 1 0 01.293-.707L7 6.586V3a1 1 0 011-1h2z" /></svg>
                          )}
                          <span className={`text-[10px] ${isMe ? "text-white/50" : "text-pnp-textSecondary/60"}`}>{timeStr}</span>
                          {msg.edited_at && <span className={`text-[10px] ${isMe ? "text-white/40" : "text-pnp-textSecondary/50"}`}>(edited)</span>}
                          {isMe && (
                            <span aria-label={wasReadByPartner ? "read" : "sent"} title={wasReadByPartner ? "Read" : "Sent"}>
                              {wasReadByPartner ? (
                                <svg className="w-3.5 h-3.5" viewBox="0 0 20 12" fill="none">
                                  <path d="M1 6.5L5 10L13.5 1" stroke="#7BE2FF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                  <path d="M6 6.5L10 10L18.5 1" stroke="#7BE2FF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                              ) : (
                                <svg className="w-3 h-3" viewBox="0 0 14 12" fill="none">
                                  <path d="M1 6.5L5 10L13.5 1" stroke="rgba(255,255,255,0.6)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                              )}
                            </span>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Reactions display */}
                    {!msg.is_deleted && msg.reactions && msg.reactions.length > 0 && (
                      <div className={`flex flex-wrap gap-1 mt-0.5 ${isMe ? "justify-end" : ""}`}>
                        {msg.reactions.map((r) => {
                          const iReacted = r.users.some((u) => String(u.id) === String(myDbId));
                          const key = `${msg.id}-${r.emoji}`;
                          return (
                            <button
                              key={r.emoji}
                              onClick={() => handleReaction(msg.id, r.emoji)}
                              className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs transition-all active:scale-90 ${recentlyReacted.has(key) ? "scale-110" : ""}`}
                              style={{
                                background: iReacted ? "rgba(212,0,122,0.2)" : "rgba(255,255,255,0.08)",
                                border: `1px solid ${iReacted ? "rgba(212,0,122,0.5)" : "rgba(255,255,255,0.1)"}`,
                              }}
                            >
                              <span>{r.emoji}</span>
                              <span className={`font-semibold ${iReacted ? "text-pnp-accent" : "text-pnp-textSecondary"}`}>{r.count}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  {/* Admin: direct trash on others' messages (hover, desktop) */}
                  {!msg.is_deleted && isAdmin && !isMe && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDeleteMsg(msg); }}
                      aria-label="Delete message (admin)"
                      title="Delete message (admin)"
                      className={`hidden md:flex items-center justify-center w-7 h-7 rounded-full bg-red-500/10 hover:bg-red-500/25 ring-1 ring-red-500/30 text-red-400 opacity-0 group-hover/msg:opacity-100 transition-all active:scale-90 self-center flex-shrink-0 ${isMe ? "mr-1" : "ml-1"}`}
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    </button>
                  )}
                  {/* Hover kebab — desktop only */}
                  {!msg.is_deleted && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setContextMenu({ msg, x: e.clientX, y: e.clientY }); }}
                      className={`hidden md:flex items-center justify-center w-7 h-7 rounded-full text-pnp-textSecondary/40 hover:text-pnp-textSecondary hover:bg-white/8 opacity-0 group-hover/msg:opacity-100 transition-all active:scale-90 self-center flex-shrink-0 ${isMe ? "mr-1" : "ml-1"}`}
                      title="Message options"
                    >
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><circle cx="10" cy="4" r="1.5" /><circle cx="10" cy="10" r="1.5" /><circle cx="10" cy="16" r="1.5" /></svg>
                    </button>
                  )}
                </div>
                </React.Fragment>
              );
            })}
            <div ref={messagesEndRef} />
          </>
        )}
        {scrolledUpBy > 200 && (
          <button
            type="button"
            onClick={() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })}
            className="sticky bottom-2 ml-auto mr-1 w-10 h-10 rounded-full flex items-center justify-center shadow-lg transition-all active:scale-90 z-[5]"
            style={{ background: "rgba(28,28,30,0.95)", border: "1px solid rgba(255,255,255,0.1)", float: "right" }}
            aria-label="Scroll to bottom"
          >
            <svg className="w-5 h-5 text-pnp-textPrimary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
            </svg>
            {newMessagesWhileScrolledUp > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold text-white flex items-center justify-center" style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}>
                {newMessagesWhileScrolledUp > 99 ? "99+" : newMessagesWhileScrolledUp}
              </span>
            )}
          </button>
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

      {/* Reply preview bar */}
      {replyTo && !editingMsg && (
        <div className="px-3 py-2 border-t border-white/10 flex items-center gap-2.5 flex-shrink-0 bg-pnp-surface/80 backdrop-blur">
          <svg className="w-4 h-4 text-pnp-accent flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a5 5 0 015 5v4M3 10l4-4m-4 4l4 4" />
          </svg>
          <div className="w-[3px] self-stretch rounded-full" style={{ background: "linear-gradient(180deg, #D4007A, #E69138)" }} />
          {(replyTo.media_type === "image" || replyTo.media_type === "video") && (replyTo.media_thumb_url || replyTo.media_url) && (
            <div className="relative w-9 h-9 rounded-lg overflow-hidden flex-shrink-0 bg-white/5">
              <img src={replyTo.media_thumb_url || replyTo.media_url || ""} alt="" className="w-full h-full object-cover" />
              {replyTo.media_type === "video" && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                  <svg className="w-3.5 h-3.5 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                </div>
              )}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-bold text-pnp-accent uppercase tracking-wider truncate">Replying to {String(replyTo.sender_id) === String(myDbId) ? "yourself" : (partnerName || "Them")}</p>
            <p className="text-xs text-pnp-textPrimary truncate">
              {replyTo.is_deleted ? "(deleted)" : replyTo.media_type === "image" ? "Photo" : replyTo.media_type === "video" ? "Video" : replyTo.media_type === "audio" ? "🎤 Voice message" : (replyTo.content || "")}
            </p>
          </div>
          <button onClick={() => setReplyTo(null)} className="w-9 h-9 rounded-full flex items-center justify-center text-pnp-textSecondary hover:text-pnp-textPrimary hover:bg-white/10 active:scale-95 transition-all flex-shrink-0" aria-label="Cancel reply">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
      )}

      {/* Edit bar with countdown */}
      {editingMsg && (() => {
        const createdMs = new Date(editingMsg.created_at).getTime();
        const remainingMs = Math.max(0, 24 * 3600 * 1000 - (Date.now() - createdMs));
        const hoursLeft = Math.floor(remainingMs / 3600000);
        const minutesLeft = Math.floor((remainingMs % 3600000) / 60000);
        const timeLeftLabel = hoursLeft >= 1 ? `${hoursLeft}h ${minutesLeft}m left` : `${minutesLeft}m left`;
        return (
          <div className="px-3 py-2.5 border-t border-pnp-border flex items-center gap-3 flex-shrink-0 bg-pnp-background">
            <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 bg-blue-500/15">
              <svg className="w-4 h-4 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <p className="text-[11px] font-bold text-blue-400 uppercase tracking-wider">Editing message</p>
                <span className="text-[10px] text-pnp-textSecondary/60">· {timeLeftLabel}</span>
              </div>
              <p className="text-xs text-pnp-textSecondary truncate">{editingMsg.content?.slice(0, 80) || ""}</p>
            </div>
            <button onClick={() => { setEditingMsg(null); setMessageInput(""); }} className="w-7 h-7 rounded-full flex items-center justify-center text-pnp-textSecondary hover:text-pnp-textPrimary hover:bg-white/10 active:scale-95 transition-all" aria-label="Cancel edit (Esc)">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        );
      })()}

      {/* Media preview + upload progress */}
      {mediaFile && (
        <div className="px-3 py-2 border-t border-pnp-border flex items-center gap-3 flex-shrink-0 bg-pnp-background">
          {mediaPreview ? <img src={mediaPreview} alt="" className="w-10 h-10 rounded-lg object-cover" /> : (
            <div className="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center">
              <svg className="w-4 h-4 text-pnp-textSecondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
              </svg>
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="text-xs text-pnp-textSecondary truncate">{mediaFile.name}</div>
            {uploadProgress !== null && (
              <div className="mt-1 h-1 bg-white/10 rounded overflow-hidden">
                <div
                  className="h-full transition-all"
                  style={{ width: `${uploadProgress}%`, background: "linear-gradient(90deg, #D4007A, #E69138)" }}
                />
              </div>
            )}
          </div>
          {uploadProgress !== null ? (
            <span className="text-[11px] font-semibold text-pnp-textPrimary tabular-nums">{uploadProgress}%</span>
          ) : (
            <button onClick={cancelMedia} className="w-6 h-6 rounded-full flex items-center justify-center bg-red-500/10 text-red-400 hover:bg-red-500/20 active:scale-90 transition-all">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          )}
        </div>
      )}

      {/* Recording bar — replaces input bar while recording */}
      {isRecording ? (
        <div className="flex items-center gap-2 px-3 py-2.5 border-t border-pnp-border flex-shrink-0 bg-pnp-background pb-safe">
          <button
            type="button"
            onClick={cancelRecording}
            className="p-2 rounded-full text-pnp-textSecondary hover:text-white hover:bg-white/10 active:scale-90 transition-all flex-shrink-0"
            aria-label="Cancelar grabación"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
          <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-2xl bg-red-500/10 border border-red-500/30">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <span className="text-sm text-white font-medium">Grabando…</span>
            <span className="ml-auto text-sm text-white font-mono tabular-nums">
              {Math.floor(recordingSeconds / 60)}:{String(recordingSeconds % 60).padStart(2, "0")}
            </span>
          </div>
          <button
            type="button"
            onClick={stopRecording}
            className="p-2.5 rounded-full text-white active:scale-90 transition-all flex-shrink-0"
            style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
            aria-label="Enviar nota de voz"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" /></svg>
          </button>
        </div>
      ) : (
      /* Input bar */
      <div className="flex items-end gap-2 px-3 py-2 border-t border-pnp-border flex-shrink-0 bg-pnp-background pb-safe">
        <input ref={mediaInputRef} type="file" accept="image/*,video/*,audio/*" className="hidden" onChange={handleMediaSelect} />
        <input ref={cameraInputRef} type="file" accept="image/*,video/*" capture="environment" className="hidden" onChange={handleMediaSelect} />
        <button type="button" onClick={() => mediaInputRef.current?.click()} className="p-2.5 rounded-full text-pnp-textSecondary hover:text-white hover:bg-white/10 active:scale-90 transition-all flex-shrink-0" aria-label="Attach media">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13" />
          </svg>
        </button>
        <textarea
          ref={messageInputRef}
          value={messageInput}
          onChange={(e) => { setMessageInput(e.target.value); emitTyping(); }}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } }}
          placeholder="Type a message..."
          className="flex-1 bg-white/5 text-white placeholder-pnp-textSecondary rounded-2xl px-4 py-2 resize-none outline-none focus:ring-1 focus:ring-pnp-accent/50 max-h-32 leading-6"
          rows={1}
          style={{ fontSize: "16px" }}
        />
        {/* Mic button — shown only when input is empty and no media attached */}
        {!messageInput.trim() && !mediaFile && (
          <button
            type="button"
            onClick={startRecording}
            className="p-2.5 rounded-full text-white active:scale-90 transition-all flex-shrink-0"
            style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
            aria-label="Grabar nota de voz"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
            </svg>
          </button>
        )}
        {(messageInput.trim() || mediaFile) && (
          <button
            type="button"
            onClick={handleSendMessage}
            disabled={sendingMessage}
            className="p-2.5 rounded-full text-white active:scale-90 transition-all flex-shrink-0 disabled:opacity-30"
            style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
            aria-label={editingMsg ? "Save edit" : "Send message"}
          >
            {sendingMessage ? (
              <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
            ) : editingMsg ? (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
            ) : (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" /></svg>
            )}
          </button>
        )}
      </div>
      )}

      {/* Context menu */}
      {contextMenu && (
        <>
          <div className="fixed inset-0 z-[50]" onClick={() => setContextMenu(null)} />
          <div
            className="fixed z-[51] rounded-2xl shadow-2xl overflow-hidden"
            style={{
              left: Math.min(contextMenu.x, Math.max(8, window.innerWidth - 196 - 8)),
              top: Math.min(contextMenu.y, window.innerHeight - 260 - 8),
              minWidth: Math.min(180, window.innerWidth - 24),
              maxWidth: "calc(100vw - 24px)",
              background: "var(--pnp-surface-hover)",
              border: "1px solid rgba(255,255,255,0.1)",
            }}
          >
            {/* Quick reaction bar — all 9 reactions inline */}
            <div className="flex items-center justify-around px-2 py-2 border-b border-white/5">
              {QUICK_REACTIONS.map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => handleReaction(contextMenu.msg.id, emoji)}
                  className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-white/10 active:scale-90 transition-all text-xl"
                >
                  {emoji}
                </button>
              ))}
            </div>
            <button onClick={() => handleReply(contextMenu.msg)} className="w-full px-4 py-2.5 text-sm text-left text-pnp-textPrimary hover:bg-white/10 transition-colors flex items-center gap-3">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" /></svg>
              Reply
            </button>
            {contextMenu.msg.content && (
              <button onClick={() => handleCopyMsg(contextMenu.msg)} className="w-full px-4 py-2.5 text-sm text-left text-pnp-textPrimary hover:bg-white/10 transition-colors flex items-center gap-3">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                Copy text
              </button>
            )}
            {String(contextMenu.msg.sender_id) === String(myDbId) && contextMenu.msg.content && !contextMenu.msg.media_url && (
              <button onClick={() => handleStartEdit(contextMenu.msg)} className="w-full px-4 py-2.5 text-sm text-left text-pnp-textPrimary hover:bg-white/10 transition-colors flex items-center gap-3">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                Edit
              </button>
            )}
            <button onClick={() => handleForwardMsg(contextMenu.msg)} className="w-full px-4 py-2.5 text-sm text-left text-pnp-textPrimary hover:bg-white/10 transition-colors flex items-center gap-3">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
              Forward
            </button>
            <button onClick={() => handlePinMsg(contextMenu.msg)} className="w-full px-4 py-2.5 text-sm text-left text-pnp-textPrimary hover:bg-white/10 transition-colors flex items-center gap-3">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M10 2a1 1 0 011 1v3.586l1.707 1.707a1 1 0 01.293.707V13a1 1 0 01-1 1h-2v4a1 1 0 11-2 0v-4H6a1 1 0 01-1-1V9a1 1 0 01.293-.707L7 6.586V3a1 1 0 011-1h2z" /></svg>
              {pinnedMessageId === contextMenu.msg.id ? "Unpin from chat" : "Pin in chat"}
            </button>
            {/* Delete option — sender or admin */}
            {(String(contextMenu.msg.sender_id) === String(myDbId) || isAdmin) && (
              <button
                onClick={() => handleDeleteMsg(contextMenu.msg)}
                className="w-full px-4 py-2.5 text-sm text-left text-red-400 hover:bg-white/10 transition-colors flex items-center gap-3 border-t border-white/5"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                {isAdmin && String(contextMenu.msg.sender_id) !== String(myDbId) ? "Delete (admin)" : "Delete"}
              </button>
            )}
          </div>
        </>
      )}

      {/* Forward modal */}
      {forwardingMsg && (
        <ForwardModal
          msg={forwardingMsg}
          onClose={() => setForwardingMsg(null)}
          onSubmit={submitForward}
          myDbId={myDbId}
        />
      )}

      {/* Delete confirmation modal — Telegram iOS style */}
      {confirmDelete && (() => {
        const isSender = String(confirmDelete.sender_id) === String(myDbId);
        const canDeleteForAll = isSender || isAdmin;
        const preview = confirmDelete.media_type === "image" ? "📷 Photo"
          : confirmDelete.media_type === "video" ? "🎥 Video"
          : confirmDelete.media_type === "audio" ? "🎤 Voice message"
          : (confirmDelete.content || "").slice(0, 80);
        return (
          <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm px-4 pb-safe" onClick={() => setConfirmDelete(null)}>
            <div className="w-full max-w-[320px] rounded-2xl overflow-hidden mb-2 sm:mb-0" style={{ background: "var(--pnp-surface)" }} onClick={(e) => e.stopPropagation()}>
              <div className="px-5 pt-5 pb-4 space-y-1.5">
                <h3 className="text-base font-semibold text-white text-center">Delete message?</h3>
                {preview && <p className="text-sm text-pnp-textSecondary text-center line-clamp-3">{preview}</p>}
              </div>
              <div className="flex flex-col border-t border-white/5">
                {canDeleteForAll && (
                  <button onClick={() => handleDeleteConfirm(true)} className="w-full px-5 py-3.5 text-sm font-medium text-red-400 hover:bg-white/5 transition-colors border-b border-white/5">
                    Delete for everyone
                  </button>
                )}
                {isSender && (
                  <button onClick={() => handleDeleteConfirm(false)} className="w-full px-5 py-3.5 text-sm font-medium text-red-400 hover:bg-white/5 transition-colors border-b border-white/5">
                    Delete for me only
                  </button>
                )}
                <button onClick={() => setConfirmDelete(null)} className="w-full px-5 py-3.5 text-sm font-medium text-pnp-textSecondary hover:bg-white/5 transition-colors">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {showPermGate && (
        <PermissionGate
          onGranted={() => void handleJoinCall()}
          onCancel={() => setShowPermGate(false)}
        />
      )}

      {activeCall && (
        <DmCallSurface
          token={activeCall.token}
          livekitUrl={activeCall.livekitUrl}
          roomName={activeCall.roomName}
          partnerName={partnerName}
          onClose={closeActiveCall}
        />
      )}

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

// ─── Voice note bubble (waveform + play/pause + scrubber) ────────────────────

function VoiceBubble({ src, id, isMe }: { src: string; id: number; isMe: boolean }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // Stable per-message bar pattern
  const bars = React.useMemo(() => {
    const out: number[] = [];
    let seed = id;
    for (let i = 0; i < 28; i++) {
      seed = (seed * 9301 + 49297) % 233280;
      out.push(0.25 + (seed / 233280) * 0.75);
    }
    return out;
  }, [id]);

  const toggle = () => {
    const a = audioRef.current; if (!a) return;
    if (playing) { a.pause(); } else { a.play().catch(() => {}); }
  };

  useEffect(() => {
    const a = audioRef.current; if (!a) return;
    const onTime = () => setCurrentTime(a.currentTime);
    const onLoaded = () => setDuration(Number.isFinite(a.duration) ? a.duration : 0);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => { setPlaying(false); setCurrentTime(0); };
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("loadedmetadata", onLoaded);
    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onPause);
    a.addEventListener("ended", onEnded);
    return () => {
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("loadedmetadata", onLoaded);
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
      a.removeEventListener("ended", onEnded);
    };
  }, []);

  const progress = duration > 0 ? Math.min(1, currentTime / duration) : 0;
  const progressColor = isMe ? "rgba(255,255,255,0.95)" : "#D4007A";
  const restColor = isMe ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.3)";

  const fmt = (s: number) => {
    if (!Number.isFinite(s)) return "0:00";
    const m = Math.floor(s / 60);
    const r = Math.floor(s % 60);
    return `${m}:${String(r).padStart(2, "0")}`;
  };

  return (
    <div className="flex items-center gap-2 mb-1 min-w-[160px] max-w-full">
      <button
        type="button"
        onClick={toggle}
        className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 active:scale-90 transition-all"
        style={{ background: isMe ? "rgba(255,255,255,0.25)" : "rgba(212,0,122,0.85)" }}
        aria-label={playing ? "Pause" : "Play"}
      >
        {playing ? (
          <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20"><path d="M6 4h3v12H6zM11 4h3v12h-3z" /></svg>
        ) : (
          <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20"><path d="M5 3.868v12.264a1 1 0 001.555.832l9-6.132a1 1 0 000-1.664l-9-6.132A1 1 0 005 3.868z" /></svg>
        )}
      </button>
      <div className="flex-1 flex flex-col gap-0.5">
        <div className="flex items-end gap-[2px] h-7">
          {bars.map((h, i) => {
            const filled = i / bars.length < progress;
            return <span key={i} className="w-[2px] rounded-full" style={{ height: `${h * 100}%`, background: filled ? progressColor : restColor }} />;
          })}
        </div>
        <span className={`text-[10px] tabular-nums ${isMe ? "text-white/70" : "text-pnp-textSecondary"}`}>{fmt(playing || currentTime > 0 ? currentTime : duration)}</span>
      </div>
      <audio ref={audioRef} src={src} preload="metadata" />
    </div>
  );
}

// ─── Forward modal ───────────────────────────────────────────────────────────

function ForwardModal({ msg, onClose, onSubmit, myDbId }: { msg: DmMessage; onClose: () => void; onSubmit: (recipientIds: string[], note: string) => Promise<void>; myDbId: string }) {
  const [threads, setThreads] = useState<MessageThread[]>([]);
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    getDmThreads().then((r) => { if (r.success) setThreads(r.threads); }).catch(() => {});
  }, []);

  const filtered = search.trim()
    ? threads.filter((t) => {
        const p = partnerOf(t);
        return p.name.toLowerCase().includes(search.toLowerCase()) || (t.partnerUsername || t.username || "").toLowerCase().includes(search.toLowerCase());
      })
    : threads;

  const toggle = (id: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < 5) next.add(id);
      return next;
    });
  };

  const submit = async () => {
    if (picked.size === 0 || submitting) return;
    setSubmitting(true);
    await onSubmit(Array.from(picked), note);
    setSubmitting(false);
  };

  const previewText = msg.media_type === "image" ? "Photo" : msg.media_type === "video" ? "Video" : msg.media_type === "audio" ? "Voice message" : (msg.content || "");
  const previewThumb = msg.media_thumb_url
    || (msg.media_type === "image" || msg.media_type === "video" ? msg.media_url : null);
  const previewIsVideo = msg.media_type === "video";

  return (
    <div className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full sm:max-w-md max-h-[80vh] flex flex-col rounded-t-3xl sm:rounded-2xl overflow-hidden" style={{ background: "var(--pnp-surface)", border: "1px solid rgba(255,255,255,0.1)" }}>
        <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-pnp-textPrimary">Forward to…</h3>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center text-pnp-textSecondary hover:text-pnp-textPrimary hover:bg-white/10" aria-label="Close">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="px-4 py-2 border-b border-white/5">
          <div className="flex items-center gap-2 rounded-lg p-2" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
            {previewThumb && (
              <div className="relative w-12 h-12 rounded-md overflow-hidden flex-shrink-0" style={{ background: "rgba(0,0,0,0.4)" }}>
                {previewIsVideo ? (
                  <video src={previewThumb} className="w-full h-full object-cover" muted playsInline preload="metadata" />
                ) : (
                  <img src={previewThumb} alt="" className="w-full h-full object-cover" />
                )}
                {previewIsVideo && (
                  <span className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <span className="w-5 h-5 rounded-full flex items-center justify-center" style={{ background: "rgba(0,0,0,0.55)" }}>
                      <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>
                    </span>
                  </span>
                )}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold" style={{ color: "#5ED1C4" }}>📎 Message</p>
              <p className="text-xs text-white/80 line-clamp-2 mt-0.5">{previewText || "Media"}</p>
            </div>
          </div>
        </div>
        <div className="px-3 py-2 border-b border-white/5">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search conversations…"
            className="w-full bg-white/5 text-pnp-textPrimary placeholder-pnp-textSecondary/50 rounded-xl px-3 py-2 outline-none focus:ring-1 focus:ring-pnp-accent/50"
            style={{ fontSize: "16px" }}
          />
        </div>
        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="text-sm text-pnp-textSecondary text-center py-8">No conversations.</p>
          ) : filtered.map((t) => {
            const p = partnerOf(t);
            const isPicked = picked.has(p.id);
            return (
              <button
                key={p.id}
                onClick={() => toggle(p.id)}
                className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/5 transition-colors text-left"
              >
                {p.photo && (p.photo.startsWith("/") || p.photo.startsWith("http")) ? (
                  <img src={p.photo} alt="" className="w-10 h-10 rounded-full object-cover" />
                ) : (
                  <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold" style={{ background: "rgba(212,0,122,0.2)", color: "#D4007A" }}>{p.name[0]?.toUpperCase() || "?"}</div>
                )}
                <span className="flex-1 min-w-0 text-sm font-semibold text-pnp-textPrimary truncate">{p.name}</span>
                <span className={`w-5 h-5 rounded-full border flex items-center justify-center ${isPicked ? "border-pnp-accent" : "border-white/30"}`} style={{ background: isPicked ? "linear-gradient(135deg, #D4007A, #E69138)" : "transparent" }}>
                  {isPicked && <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                </span>
              </button>
            );
          })}
        </div>
        <div className="px-3 py-2 border-t border-white/10 flex items-end gap-2">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Add a comment…"
            rows={1}
            className="flex-1 bg-white/5 text-white placeholder-pnp-textSecondary rounded-2xl px-3 py-2 resize-none outline-none focus:ring-1 focus:ring-pnp-accent/50 max-h-20"
            style={{ fontSize: "16px" }}
          />
          <button
            onClick={submit}
            disabled={picked.size === 0 || submitting}
            className="px-4 py-2 rounded-2xl text-sm font-semibold text-white transition-all active:scale-95 disabled:opacity-30 flex-shrink-0"
            style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
          >
            {submitting ? "Sending…" : `Send${picked.size > 0 ? ` (${picked.size})` : ""}`}
          </button>
        </div>
      </div>
      {/* Suppress unused variable warnings for myDbId */}
      <span className="hidden">{myDbId}</span>
    </div>
  );
}

// ─── New chat modal (user picker) ────────────────────────────────────────────

function NewChatModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Array<{ id: string; username: string; first_name: string; photo_file_id: string | null }>>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!q.trim() || q.trim().length < 2) { setResults([]); return; }
    debounceRef.current = setTimeout(() => {
      setLoading(true);
      searchUsersForNewChat(q.trim(), 20)
        .then((r) => setResults(r.users || []))
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, 250);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [q]);

  return (
    <div className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full sm:max-w-md max-h-[80vh] flex flex-col rounded-t-3xl sm:rounded-2xl overflow-hidden" style={{ background: "var(--pnp-surface)", border: "1px solid rgba(255,255,255,0.1)" }}>
        <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
          <h3 className="text-base font-bold text-pnp-textPrimary">New message</h3>
          <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center text-pnp-textSecondary hover:text-pnp-textPrimary hover:bg-white/10" aria-label="Close">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="px-3 py-2 border-b border-white/5">
          <input
            autoFocus
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search users by name or @username…"
            className="w-full bg-white/5 text-pnp-textPrimary placeholder-pnp-textSecondary/50 rounded-xl px-3 py-2 outline-none focus:ring-1 focus:ring-pnp-accent/50"
            style={{ fontSize: "16px" }}
          />
        </div>
        <div className="flex-1 overflow-y-auto min-h-[200px]">
          {loading ? (
            <div className="flex items-center justify-center py-8"><div className="w-6 h-6 border-2 border-white/20 border-t-pnp-accent rounded-full animate-spin" /></div>
          ) : !q.trim() ? (
            <p className="text-sm text-pnp-textSecondary text-center py-8 px-6">Type to search for someone to message.</p>
          ) : results.length === 0 ? (
            <p className="text-sm text-pnp-textSecondary text-center py-8 px-6">No users found.</p>
          ) : results.map((u) => {
            const name = u.first_name || u.username || "User";
            const photo = u.photo_file_id;
            return (
              <button
                key={u.id}
                onClick={() => { onClose(); navigate(`/dm/${u.id}`); }}
                className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/5 transition-colors text-left"
              >
                {photo && (photo.startsWith("/") || photo.startsWith("http")) ? (
                  <img src={photo} alt="" className="w-10 h-10 rounded-full object-cover" />
                ) : (
                  <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold" style={{ background: "rgba(212,0,122,0.2)", color: "#D4007A" }}>{name[0]?.toUpperCase()}</div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-pnp-textPrimary truncate">{name}</p>
                  {u.username && <p className="text-[11px] text-pnp-textSecondary truncate">@{u.username}</p>}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Thread List View (all conversations) ────────────────────────────────────

type ListFilter = "all" | "unread" | "archived";

function ThreadListView({ myDbId }: { myDbId: string }) {
  const navigate = useNavigate();
  const { dm: t } = useI18n();
  const [threads, setThreads] = useState<MessageThread[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ListFilter>("all");
  const [searchResults, setSearchResults] = useState<DmSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [rowMenu, setRowMenu] = useState<{ thread: MessageThread; x: number; y: number } | null>(null);
  const [showNewChat, setShowNewChat] = useState(false);
  const [muteSubmenu, setMuteSubmenu] = useState<MessageThread | null>(null);
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = () => {
    getDmThreads()
      .then((res) => { if (res.success) setThreads(res.threads); })
      .catch(() => {});
  };

  useEffect(() => {
    refresh();
    setIsLoading(false);
  }, []);

  // Realtime updates
  useEffect(() => {
    const socket = connectSocket();
    const onChange = () => refresh();
    const onPresence = (data: { userId: string; online: boolean; lastSeen: string | null }) => {
      setThreads((prev) => prev.map((t) => {
        if (String(partnerOf(t).id) !== String(data.userId)) return t;
        return { ...t, online: !!data.online, lastSeen: data.lastSeen };
      }));
    };
    const onRead = (data: { partnerId: string }) => {
      setThreads((prev) => prev.map((t) =>
        String(partnerOf(t).id) === String(data.partnerId) ? { ...t, lastMessageReadByOther: true } : t
      ));
    };
    socket.on("dm:message", onChange);
    socket.on("dm:sent", onChange);
    socket.on("presence:update", onPresence);
    socket.on("dm:message:read", onRead);
    return () => {
      socket.off("dm:message", onChange);
      socket.off("dm:sent", onChange);
      socket.off("presence:update", onPresence);
      socket.off("dm:message:read", onRead);
    };
  }, []);

  // Global DM search (server-side, debounced) when ≥2 chars
  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    if (search.trim().length < 2) { setSearchResults([]); return; }
    searchDebounceRef.current = setTimeout(() => {
      setSearching(true);
      searchAllDms(search.trim())
        .then((r) => setSearchResults(r.results || []))
        .catch(() => setSearchResults([]))
        .finally(() => setSearching(false));
    }, 300);
    return () => { if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current); };
  }, [search]);

  const isValidPhoto = (p: string | null | undefined) => p && (p.startsWith("/") || p.startsWith("http"));

  const counts = React.useMemo(() => {
    const total = threads.length;
    const unread = threads.filter((t) => (t.unread ?? t.unreadCount ?? 0) > 0 && !t.archivedAt).length;
    const archived = threads.filter((t) => !!t.archivedAt).length;
    return { total, unread, archived };
  }, [threads]);

  // Apply filter pill + name filter (search)
  const visibleThreads = React.useMemo(() => {
    let arr = threads.slice();
    if (filter === "archived") arr = arr.filter((x) => !!x.archivedAt);
    else arr = arr.filter((x) => !x.archivedAt);
    if (filter === "unread") arr = arr.filter((x) => (x.unread ?? x.unreadCount ?? 0) > 0);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      arr = arr.filter((x) => {
        const p = partnerOf(x);
        return p.name.toLowerCase().includes(q) || (x.partnerUsername || x.username || "").toLowerCase().includes(q);
      });
    }
    // Sort: pinned (by pinnedAt desc) first, then unpinned by lastMessageAt desc
    arr.sort((a, b) => {
      const ap = a.pinnedAt ? new Date(a.pinnedAt).getTime() : 0;
      const bp = b.pinnedAt ? new Date(b.pinnedAt).getTime() : 0;
      if (ap !== bp) return bp - ap;
      const at = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
      const bt = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
      return bt - at;
    });
    return arr;
  }, [threads, filter, search]);

  const longPressFiredRef = useRef(false);

  const handleRowContextMenu = (thread: MessageThread, e: React.MouseEvent) => {
    e.preventDefault();
    setRowMenu({ thread, x: e.clientX, y: e.clientY });
  };
  const handleRowTouchStart = (thread: MessageThread, e: React.TouchEvent) => {
    const touch = e.touches[0];
    longPressFiredRef.current = false;
    longPressRef.current = setTimeout(() => {
      longPressFiredRef.current = true;
      setRowMenu({ thread, x: touch.clientX, y: touch.clientY });
    }, 500);
  };
  const handleRowTouchEnd = () => { if (longPressRef.current) { clearTimeout(longPressRef.current); longPressRef.current = null; } };
  // Suppress the click that fires after a long-press triggered the row menu.
  const handleRowClick = (thread: MessageThread, e: React.MouseEvent) => {
    if (longPressFiredRef.current) {
      e.preventDefault();
      e.stopPropagation();
      longPressFiredRef.current = false;
      return;
    }
    navigate(`/dm/${partnerOf(thread).id}`);
  };

  const togglePin = async (thread: MessageThread) => {
    const id = partnerOf(thread).id;
    setRowMenu(null);
    setThreads((prev) => prev.map((x) => partnerOf(x).id === id ? { ...x, pinnedAt: x.pinnedAt ? null : new Date().toISOString() } : x));
    try { await pinDmThread(id); } catch { refresh(); }
  };
  const toggleArchive = async (thread: MessageThread) => {
    const id = partnerOf(thread).id;
    setRowMenu(null);
    setThreads((prev) => prev.map((x) => partnerOf(x).id === id ? { ...x, archivedAt: x.archivedAt ? null : new Date().toISOString() } : x));
    try { await archiveDmThread(id); } catch { refresh(); }
  };
  const markUnreadRow = async (thread: MessageThread) => {
    const id = partnerOf(thread).id;
    setRowMenu(null);
    setThreads((prev) => prev.map((x) => partnerOf(x).id === id ? { ...x, unread: Math.max(1, x.unread ?? 0), unreadCount: Math.max(1, x.unreadCount ?? 0) } : x));
    try { await markDmThreadUnread(id); } catch { refresh(); }
  };
  const muteFor = async (thread: MessageThread, untilIso: string | null | "forever") => {
    const id = partnerOf(thread).id;
    setRowMenu(null); setMuteSubmenu(null);
    try {
      const r = await muteDmThread(id, untilIso);
      setThreads((prev) => prev.map((x) => partnerOf(x).id === id ? { ...x, mutedUntil: r.mutedUntil } : x));
    } catch { refresh(); }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-white/20 border-t-pnp-accent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="relative">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-6 pb-2 mb-2">
        <div>
          <h1 className="text-2xl font-bold text-pnp-textPrimary">{t.messagesTitle}</h1>
          <p className="text-sm mt-1 text-pnp-textSecondary">{t.messagesSubtitle}</p>
        </div>
      </div>

      {/* Search bar — always visible */}
      <div className="px-4 pt-1 pb-2">
        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-pnp-textSecondary pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search conversations and messages…"
            className="w-full bg-white/5 text-pnp-textPrimary placeholder-pnp-textSecondary/50 rounded-xl pl-9 pr-3 py-2 outline-none focus:ring-1 focus:ring-pnp-accent/50 transition-colors"
            style={{ fontSize: "16px" }}
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-white/10 flex items-center justify-center text-pnp-textSecondary hover:text-white">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          )}
        </div>
      </div>

      {/* Filter pills */}
      <div className="px-4 pb-2 flex items-center gap-2 overflow-x-auto">
        {([
          ["all", "All", counts.total],
          ["unread", "Unread", counts.unread],
          ["archived", "Archived", counts.archived],
        ] as Array<[ListFilter, string, number]>).map(([key, label, count]) => {
          const active = filter === key;
          return (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className="px-3 py-1.5 rounded-full text-xs font-semibold transition-all active:scale-95 flex items-center gap-1.5 flex-shrink-0"
              style={active
                ? { background: "linear-gradient(135deg, #D4007A, #E69138)", color: "white" }
                : { background: "rgba(255,255,255,0.05)", color: "var(--pnp-textSecondary, rgba(255,255,255,0.7))" }
              }
            >
              {label}
              {count > 0 && <span className={`text-[10px] tabular-nums ${active ? "text-white/80" : "text-pnp-textSecondary/60"}`}>{count}</span>}
            </button>
          );
        })}
      </div>

      {threads.length === 0 && !search.trim() ? (
        <div className="flex flex-col items-center justify-center py-20 px-6">
          <p className="text-4xl mb-3">💬</p>
          <p className="text-lg font-semibold text-pnp-textPrimary mb-1">{t.noConversations || "No conversations yet"}</p>
          <p className="text-sm text-pnp-textSecondary text-center mb-6">Tap the pencil to start a new chat.</p>
          <button
            onClick={() => setShowNewChat(true)}
            className="px-4 py-2 rounded-xl text-sm font-semibold text-white transition-all active:scale-95"
            style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
          >
            New message
          </button>
        </div>
      ) : (
        <>
          <div className="divide-y divide-pnp-border">
            {visibleThreads.map((thread) => {
              const p = partnerOf(thread);
              const muted = !!(thread.mutedUntil && new Date(thread.mutedUntil).getTime() > Date.now());
              const unread = thread.unread ?? thread.unreadCount ?? 0;
              const isMine = thread.lastMessageSenderId && String(thread.lastMessageSenderId) === String(myDbId);
              return (
                <button
                  key={p.id}
                  onClick={(e) => handleRowClick(thread, e)}
                  onContextMenu={(e) => handleRowContextMenu(thread, e)}
                  onTouchStart={(e) => handleRowTouchStart(thread, e)}
                  onTouchEnd={handleRowTouchEnd}
                  onTouchMove={handleRowTouchEnd}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-colors text-left"
                >
                  <div className="relative flex-shrink-0">
                    {isValidPhoto(p.photo) ? (
                      <img src={p.photo!} alt="" className="w-12 h-12 rounded-full object-cover" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; (e.currentTarget.nextElementSibling as HTMLElement | null)?.style.removeProperty("display"); }} />
                    ) : null}
                    <div className="w-12 h-12 rounded-full flex items-center justify-center text-sm font-bold" style={{ background: "rgba(212,0,122,0.2)", color: "#D4007A", display: isValidPhoto(p.photo) ? "none" : undefined }}>
                      {p.name[0]?.toUpperCase() || "?"}
                    </div>
                    {thread.online && (
                      <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-green-400 ring-2 ring-pnp-background" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-pnp-textPrimary truncate flex items-center gap-1">
                        {thread.pinnedAt && (
                          <svg className="w-3 h-3 text-pnp-textSecondary" fill="currentColor" viewBox="0 0 20 20"><path d="M10 2a1 1 0 011 1v3.586l1.707 1.707a1 1 0 01.293.707V13a1 1 0 01-1 1h-2v4a1 1 0 11-2 0v-4H6a1 1 0 01-1-1V9a1 1 0 01.293-.707L7 6.586V3a1 1 0 011-1h2z" /></svg>
                        )}
                        {p.name}
                        {muted && (
                          <svg className="w-3 h-3 text-pnp-textSecondary/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15zM17 14l4-4m0 4l-4-4" /></svg>
                        )}
                      </p>
                      <span className="text-[11px] text-pnp-textSecondary flex-shrink-0">
                        {smartTimestamp(thread.lastMessageAt)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-0.5">
                      <p className="text-xs text-pnp-textSecondary truncate flex items-center gap-1">
                        {isMine && thread.lastMessageReadByOther && (
                          <svg className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 20 12" fill="none">
                            <path d="M1 6.5L5 10L13.5 1" stroke="#7BE2FF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            <path d="M6 6.5L10 10L18.5 1" stroke="#7BE2FF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                        <span className="truncate">{buildPreview(thread, myDbId)}</span>
                      </p>
                      {unread > 0 && (
                        <span className={`min-w-[20px] h-5 px-1 rounded-full text-[10px] font-bold flex items-center justify-center flex-shrink-0 ${muted ? "bg-white/20 text-white/70" : "text-white"}`} style={muted ? undefined : { background: "#D4007A" }}>
                          {unread > 99 ? "99+" : unread}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Global message search results */}
          {search.trim().length >= 2 && (
            <div className="border-t border-pnp-border mt-2">
              <div className="px-4 pt-3 pb-1 flex items-center justify-between">
                <p className="text-[10px] font-bold text-pnp-textSecondary uppercase tracking-wider">In messages</p>
                {searching && <div className="w-3 h-3 border border-white/20 border-t-pnp-accent rounded-full animate-spin" />}
              </div>
              {!searching && searchResults.length === 0 && (
                <p className="text-xs text-pnp-textSecondary px-4 py-3">No matches in your messages.</p>
              )}
              {searchResults.map((r) => (
                <button
                  key={`${r.id}-${r.partnerId}`}
                  onClick={() => navigate(`/dm/${r.partnerId}?jumpTo=${r.id}`)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/5 transition-colors text-left"
                >
                  {r.partnerPhoto && (r.partnerPhoto.startsWith("/") || r.partnerPhoto.startsWith("http")) ? (
                    <img src={r.partnerPhoto} alt="" className="w-9 h-9 rounded-full object-cover flex-shrink-0" />
                  ) : (
                    <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0" style={{ background: "rgba(212,0,122,0.2)", color: "#D4007A" }}>{r.partnerName[0]?.toUpperCase() || "?"}</div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-pnp-textPrimary truncate">{r.partnerName}</p>
                      <span className="text-[10px] text-pnp-textSecondary flex-shrink-0">{smartTimestamp(r.createdAt)}</span>
                    </div>
                    <p className="text-xs text-pnp-textSecondary truncate mt-0.5">
                      {r.isMine ? "You: " : ""}{r.mediaType === "image" ? "📷 " : r.mediaType === "video" ? "🎥 " : r.mediaType === "audio" ? "🎤 " : ""}{r.snippet}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {/* Row context menu */}
      {rowMenu && (
        <>
          <div className="fixed inset-0 z-[50]" onClick={() => { setRowMenu(null); setMuteSubmenu(null); }} />
          <div className="fixed z-[51] rounded-2xl shadow-2xl overflow-hidden" style={{
            left: Math.min(rowMenu.x, Math.max(8, window.innerWidth - 220 - 8)),
            top: Math.min(rowMenu.y, window.innerHeight - 280 - 8),
            minWidth: 200,
            background: "var(--pnp-surface-hover)",
            border: "1px solid rgba(255,255,255,0.1)",
          }}>
            <button onClick={() => togglePin(rowMenu.thread)} className="w-full px-4 py-2.5 text-sm text-left text-pnp-textPrimary hover:bg-white/10 transition-colors flex items-center gap-3">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M10 2a1 1 0 011 1v3.586l1.707 1.707a1 1 0 01.293.707V13a1 1 0 01-1 1h-2v4a1 1 0 11-2 0v-4H6a1 1 0 01-1-1V9a1 1 0 01.293-.707L7 6.586V3a1 1 0 011-1h2z" /></svg>
              {rowMenu.thread.pinnedAt ? "Unpin" : "Pin to top"}
            </button>
            <button onClick={() => setMuteSubmenu(rowMenu.thread)} className="w-full px-4 py-2.5 text-sm text-left text-pnp-textPrimary hover:bg-white/10 transition-colors flex items-center gap-3">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>
              {rowMenu.thread.mutedUntil && new Date(rowMenu.thread.mutedUntil).getTime() > Date.now() ? "Unmute" : "Mute…"}
            </button>
            <button onClick={() => toggleArchive(rowMenu.thread)} className="w-full px-4 py-2.5 text-sm text-left text-pnp-textPrimary hover:bg-white/10 transition-colors flex items-center gap-3">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" /></svg>
              {rowMenu.thread.archivedAt ? "Unarchive" : "Archive"}
            </button>
            {(rowMenu.thread.unread ?? rowMenu.thread.unreadCount ?? 0) === 0 && (
              <button onClick={() => markUnreadRow(rowMenu.thread)} className="w-full px-4 py-2.5 text-sm text-left text-pnp-textPrimary hover:bg-white/10 transition-colors flex items-center gap-3">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="3" /></svg>
                Mark as unread
              </button>
            )}
          </div>
        </>
      )}

      {muteSubmenu && (() => {
        const isCurrentlyMuted = muteSubmenu.mutedUntil && new Date(muteSubmenu.mutedUntil).getTime() > Date.now();
        return (
          <>
            <div className="fixed inset-0 z-[60]" onClick={() => setMuteSubmenu(null)} />
            <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[61] rounded-2xl shadow-2xl overflow-hidden w-72" style={{ background: "var(--pnp-surface-hover)", border: "1px solid rgba(255,255,255,0.1)" }}>
              <p className="px-4 pt-3 pb-2 text-[11px] font-bold text-pnp-textSecondary uppercase tracking-wider">Mute notifications</p>
              {isCurrentlyMuted && (
                <button onClick={() => muteFor(muteSubmenu, null)} className="w-full px-4 py-2.5 text-sm text-left text-green-400 hover:bg-white/10 transition-colors">Unmute</button>
              )}
              <button onClick={() => muteFor(muteSubmenu, new Date(Date.now() + 60 * 60 * 1000).toISOString())} className="w-full px-4 py-2.5 text-sm text-left text-pnp-textPrimary hover:bg-white/10 transition-colors">For 1 hour</button>
              <button onClick={() => muteFor(muteSubmenu, new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString())} className="w-full px-4 py-2.5 text-sm text-left text-pnp-textPrimary hover:bg-white/10 transition-colors">For 8 hours</button>
              <button onClick={() => muteFor(muteSubmenu, "forever")} className="w-full px-4 py-2.5 text-sm text-left text-pnp-textPrimary hover:bg-white/10 transition-colors">Until I turn it back on</button>
              <button onClick={() => setMuteSubmenu(null)} className="w-full px-4 py-2.5 text-sm text-left text-pnp-textSecondary hover:bg-white/10 transition-colors border-t border-white/5">Cancel</button>
            </div>
          </>
        );
      })()}

      {/* FAB — New Chat modal */}
      <button
        onClick={() => setShowNewChat(true)}
        title="New message"
        className="fixed bottom-20 lg:bottom-6 right-4 w-12 h-12 rounded-full text-white flex items-center justify-center shadow-lg active:scale-95 transition-all z-30"
        style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
        aria-label="New Message"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" />
        </svg>
      </button>

      {showNewChat && <NewChatModal onClose={() => setShowNewChat(false)} />}
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function DirectMessages() {
  const { userId } = useParams<{ userId: string }>();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const { isAdmin } = useTier();
  const { showTutorial, dismissTutorial, dismissForever } = useTutorial("dm");
  const { dm: t } = useI18n();
  const inviteCallerId = searchParams.get("caller");
  const inviteCalleeId = searchParams.get("callee");

  let activeUserId = userId;
  if (!activeUserId && user?.id && inviteCallerId && inviteCalleeId) {
    if (String(user.id) === String(inviteCallerId)) {
      activeUserId = inviteCalleeId;
    } else if (String(user.id) === String(inviteCalleeId)) {
      activeUserId = inviteCallerId;
    }
  }

  return (
    <>
      <Helmet>
        <title>{t.pageTitle || "Messages"} — PNPtv!</title>
        <meta name="description" content={t.pageDescription || "Your direct messages"} />
      </Helmet>
      {showTutorial && !activeUserId && <TutorialOverlay section="dm" onDismiss={dismissTutorial} onDismissForever={dismissForever} />}
      <div className="max-w-3xl mx-auto">
        {activeUserId ? (
          <DmChatView userId={activeUserId} myDbId={user?.dbId ?? user?.id ?? ""} myUserId={user?.id ?? ""} isAdmin={isAdmin} />
        ) : (
          <ThreadListView myDbId={user?.dbId ?? user?.id ?? ""} />
        )}
      </div>
    </>
  );
}
