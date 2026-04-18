import React, { useState, useEffect, useRef, useCallback } from "react";
import { Helmet } from "react-helmet-async";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useTutorial } from "@/hooks/useTutorial";
import { TutorialOverlay } from "@/components/tutorial/TutorialOverlay";
import { useI18n } from "@/lib/i18n";
import { PermissionGate } from "@/components/PermissionGate";
import {
  createDmVideoCall,
  getMessageThreads,
  joinDmVideoCall,
  markThreadAsRead,
  toggleDmMessageReaction,
  type DmVideoCallSession,
  type MessageThread,
} from "@/lib/api";
import { connectSocket } from "@/lib/socket";
import { MediaMessage } from "@/components/hangouts/MediaMessage";
import { LiveKitRoom, VideoConference } from "@livekit/components-react";

const API_BASE = import.meta.env.VITE_API_URL || "";

// ─── Types ───────────────────────────────────────────────────────────────────

interface DmReaction {
  emoji: string;
  count: number;
  users: Array<{ id: string; username: string }>;
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
  reactions?: DmReaction[];
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

// ─── Emoji data ───────────────────────────────────────────────────────────────

const ALLOWED_REACTIONS = ["😈", "❤️", "😆", "🔝", "🐷", "🍆", "🍑", "💨", "🚀"] as const;
const QUICK_REACTIONS = ALLOWED_REACTIONS;
const URL_REGEX = /(https?:\/\/[^\s]+)/g;

const EMOJI_CATEGORIES = [
  { label: "Reactions", emojis: ALLOWED_REACTIONS },
] as const;

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

// ─── DM LiveKit Floating Panel ───────────────────────────────────────────────

const DM_PANEL_WIDTH = 420;
const DM_PANEL_HEIGHT = 560;

function clampVal(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function getDefaultDmPanelPos(): { x: number; y: number } {
  return {
    x: Math.max(16, window.innerWidth - DM_PANEL_WIDTH - 24),
    y: Math.max(16, window.innerHeight - DM_PANEL_HEIGHT - 96),
  };
}

interface DmLiveKitPanelProps {
  token: string;
  livekitUrl: string;
  roomName: string;
  partnerName: string;
  callLink: string;
  onCopyLink: () => void;
  onClose: () => void;
}

function DmLiveKitPanel({
  token,
  livekitUrl,
  roomName,
  partnerName,
  callLink,
  onCopyLink,
  onClose,
}: DmLiveKitPanelProps) {
  const dragRef = useRef<{
    pointerId: number | null;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  }>({ pointerId: null, startX: 0, startY: 0, originX: 0, originY: 0 });

  const [floatingPos, setFloatingPos] = useState<{ x: number; y: number }>(() => ({ x: 16, y: 16 }));

  useEffect(() => {
    setFloatingPos(getDefaultDmPanelPos());
  }, []);

  useEffect(() => {
    const onResize = () => {
      setFloatingPos((prev) => ({
        x: clampVal(prev.x, 8, Math.max(8, window.innerWidth - DM_PANEL_WIDTH - 8)),
        y: clampVal(prev.y, 8, Math.max(8, window.innerHeight - DM_PANEL_HEIGHT - 8)),
      }));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: floatingPos.x,
      originY: floatingPos.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current.pointerId !== event.pointerId) return;
    const nextX = dragRef.current.originX + (event.clientX - dragRef.current.startX);
    const nextY = dragRef.current.originY + (event.clientY - dragRef.current.startY);
    setFloatingPos({
      x: clampVal(nextX, 8, Math.max(8, window.innerWidth - DM_PANEL_WIDTH - 8)),
      y: clampVal(nextY, 8, Math.max(8, window.innerHeight - DM_PANEL_HEIGHT - 8)),
    });
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current.pointerId !== event.pointerId) return;
    dragRef.current.pointerId = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return (
    <div
      className="fixed z-[95]"
      style={{ width: DM_PANEL_WIDTH, height: DM_PANEL_HEIGHT, left: floatingPos.x, top: floatingPos.y }}
    >
      <div
        className="flex h-full flex-col overflow-hidden rounded-[22px] border shadow-2xl"
        style={{
          background: "linear-gradient(180deg, rgba(22,27,42,0.98), rgba(14,18,28,0.98))",
          borderColor: "rgba(100,210,255,0.22)",
        }}
      >
        {/* Draggable header */}
        <div
          className="flex items-center gap-3 border-b px-3 py-2 flex-shrink-0 cursor-grab active:cursor-grabbing select-none"
          style={{ borderColor: "rgba(255,255,255,0.08)" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
            <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse flex-shrink-0" />
            <p className="truncate text-sm font-bold text-white">
              {partnerName ? `Call with ${partnerName}` : "Video Call"}
            </p>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              type="button"
              onClick={onCopyLink}
              className="inline-flex h-8 items-center gap-1 rounded-full border px-2 text-[11px] text-white/60 transition-all hover:bg-white/10"
              style={{ borderColor: "rgba(255,255,255,0.1)" }}
              title="Copy call link"
            >
              Copy link
            </button>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border text-white/50 transition-all hover:bg-white/10"
              style={{ borderColor: "rgba(255,255,255,0.1)" }}
              aria-label="Leave call"
              title="Leave call"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
        {/* LiveKit room */}
        <div className="min-h-0 flex-1 overflow-hidden">
          <LiveKitRoom
            token={token}
            serverUrl={livekitUrl}
            connect={true}
            video={true}
            audio={true}
            onDisconnected={onClose}
            style={{ height: "100%", background: "transparent" }}
          >
            <VideoConference />
          </LiveKitRoom>
        </div>
      </div>
    </div>
  );
}

// ─── Chat View (conversation with a specific user) ──────────────────────────

function DmChatView({ userId, myDbId, myUserId }: { userId: string; myDbId: string; myUserId: string }) {
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

  // Context menu / emoji picker
  const [contextMenu, setContextMenu] = useState<{ msg: DmMessage; x: number; y: number } | null>(null);
  const [emojiPickerMsgId, setEmojiPickerMsgId] = useState<number | null>(null);
  const [emojiPickerPos, setEmojiPickerPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [recentlyReacted, setRecentlyReacted] = useState<Set<string>>(new Set());

  const messagesEndRef = useRef<HTMLDivElement>(null);
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

    socket.on("dm:message", onDmMessage);
    socket.on("dm:sent", onDmSent);
    socket.on("dm:typing", onDmTyping);
    socket.on("dm:message:edited", onDmEdited);
    socket.on("dm:message:deleted", onDmDeleted);
    socket.on("dm:reaction:updated", onDmReactionUpdated);
    socket.on("dm:error", onDmError);
    socket.on("dm:call:incoming", onDmCallIncoming);
    socket.on("dm:call:declined", onDmCallDeclined);

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
      if (mediaFile) {
        setUploadProgress(0);
        const data = await uploadMediaWithProgress(mediaFile, messageInput.trim());
        if (data.message) setMessages((prev) => prev.some((m) => m.id === data.message!.id) ? prev : [...prev, data.message!]);
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
        if (data.ticketNotice) {
          // DM to Cristina AI was redirected to support ticket
          if (data.message) setMessages((prev) => [...prev, data.message, { id: Date.now(), sender_id: "cristina-ai", recipient_id: userId, content: data.ticketNotice, is_read: true, created_at: new Date().toISOString() } as any]);
          setMessageInput("");
        } else {
          if (data.message) setMessages((prev) => prev.some((m) => m.id === data.message.id) ? prev : [...prev, data.message]);
          setMessageInput("");
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
    setEmojiPickerMsgId(null);
    try {
      const result = await toggleDmMessageReaction(msgId, emoji);
      setMessages((prev) => prev.map((m) => m.id === msgId ? { ...m, reactions: result.reactions } : m));
    } catch { /* silent */ }
  }, []);

  const openEmojiPicker = (msgId: number, x: number, y: number) => {
    setContextMenu(null);
    const PANEL_W = 280, PANEL_H = 280;
    setEmojiPickerPos({
      x: Math.min(x, window.innerWidth - PANEL_W - 8),
      y: Math.max(8, Math.min(y, window.innerHeight - PANEL_H - 8)),
    });
    setEmojiPickerMsgId(msgId);
  };

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
    }, 500);
  };

  const handleTouchEnd = () => {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
  };

  const handleDeleteMsg = (msg: DmMessage) => {
    setContextMenu(null);
    // Optimistic update — mark message deleted immediately so the UI responds instantly
    setMessages((prev) =>
      prev.map((m) => m.id === msg.id ? { ...m, is_deleted: true, content: null } : m)
    );
    // Server-side delete + broadcast to both participants via Socket.IO
    connectSocket().emit("dm:message:delete", { messageId: msg.id });
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
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-pnp-border flex-shrink-0 bg-pnp-background/95 backdrop-blur-sm">
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
        </button>
        <button onClick={() => navigate(`/profile/${userId}`)} className="flex-1 min-w-0 text-left">
          <p className="text-sm font-bold text-pnp-textPrimary truncate leading-tight">{partnerName || "Conversation"}</p>
          <p className="text-[11px] text-pnp-textSecondary leading-tight">Tap to view profile</p>
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
      </div>

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
                <div
                  key={msg.id}
                  className={`flex gap-2 ${isMe ? "flex-row-reverse" : "flex-row"} ${isGrouped ? "!mt-0.5" : ""}`}
                  onContextMenu={(e) => handleContextMenu(msg, e)}
                  onTouchStart={(e) => handleTouchStart(msg, e)}
                  onTouchEnd={handleTouchEnd}
                  onTouchMove={handleTouchEnd}
                >
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
                        {msg.media_url && msg.media_type && (
                          <div className="mb-1">
                            <MediaMessage mediaUrl={msg.media_url} mediaType={msg.media_type} thumbUrl={msg.media_thumb_url} onExpandImage={(url) => setLightboxUrl(url)} isMe={isMe} />
                          </div>
                        )}
                        {renderMessageContent(msg.content)}
                        <div className={`flex items-center gap-1 mt-0.5 ${isMe ? "justify-end" : ""}`}>
                          <span className={`text-[10px] ${isMe ? "text-white/50" : "text-pnp-textSecondary/60"}`}>{timeStr}</span>
                          {msg.edited_at && <span className={`text-[10px] ${isMe ? "text-white/40" : "text-pnp-textSecondary/50"}`}>(edited)</span>}
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
      <div className="flex items-end gap-2 px-3 py-2.5 border-t border-pnp-border flex-shrink-0 bg-pnp-background pb-safe">
        <input ref={mediaInputRef} type="file" accept="image/*,video/*,audio/*" className="hidden" onChange={handleMediaSelect} />
        <input ref={cameraInputRef} type="file" accept="image/*,video/*" capture="environment" className="hidden" onChange={handleMediaSelect} />
        <button type="button" onClick={() => mediaInputRef.current?.click()} className="p-2 rounded-full text-pnp-textSecondary hover:text-white hover:bg-white/10 active:scale-90 transition-all flex-shrink-0" aria-label="Attach media">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13" />
          </svg>
        </button>
        <button type="button" onClick={() => cameraInputRef.current?.click()} className="p-2 rounded-full text-pnp-textSecondary hover:text-white hover:bg-white/10 active:scale-90 transition-all flex-shrink-0 sm:hidden" aria-label="Take photo or video">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zM18.75 10.5h.008v.008h-.008V10.5z" />
          </svg>
        </button>
        <textarea
          value={messageInput}
          onChange={(e) => { setMessageInput(e.target.value); emitTyping(); }}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } }}
          placeholder="Type a message..."
          className="flex-1 bg-white/5 text-white placeholder-pnp-textSecondary rounded-2xl px-4 py-2.5 resize-none outline-none focus:ring-1 focus:ring-pnp-accent/50 max-h-24"
          rows={1}
          style={{ minHeight: "40px", fontSize: "16px" }}
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
            aria-label="Send message"
          >
            {sendingMessage ? (
              <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
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
              background: "#2C2C2E",
              border: "1px solid rgba(255,255,255,0.1)",
            }}
          >
            {/* Quick reaction bar */}
            <div className="flex items-center gap-1 px-2 py-2 border-b border-white/5">
              {QUICK_REACTIONS.map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => handleReaction(contextMenu.msg.id, emoji)}
                  className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-white/10 active:scale-90 transition-all text-xl"
                >
                  {emoji}
                </button>
              ))}
              <button
                onClick={() => openEmojiPicker(contextMenu.msg.id, contextMenu.x, contextMenu.y)}
                className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-white/10 active:scale-90 transition-all text-pnp-textSecondary"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
              </button>
            </div>
            {/* Delete option — sender only */}
            {String(contextMenu.msg.sender_id) === String(myDbId) && (
              <button
                onClick={() => handleDeleteMsg(contextMenu.msg)}
                className="w-full px-4 py-2.5 text-sm text-left text-red-400 hover:bg-white/10 transition-colors flex items-center gap-3"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                Delete
              </button>
            )}
          </div>
        </>
      )}

      {/* Full emoji picker */}
      {emojiPickerMsgId !== null && (
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => setEmojiPickerMsgId(null)} />
          <div
            className="fixed z-[61] rounded-2xl shadow-2xl overflow-hidden"
            style={{
              left: Math.max(8, Math.min(emojiPickerPos.x, window.innerWidth - Math.min(280, window.innerWidth - 16) - 8)),
              top: emojiPickerPos.y,
              width: Math.min(280, window.innerWidth - 16),
              background: "#1C1C1E",
              border: "1px solid rgba(255,255,255,0.12)",
            }}
          >
            <div className="flex items-center justify-between px-3 pt-2.5 pb-1">
              <p className="text-[11px] font-semibold text-pnp-textSecondary uppercase tracking-wider">Reactions</p>
              <button onClick={() => setEmojiPickerMsgId(null)} className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-white/10 text-pnp-textSecondary">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="overflow-y-auto" style={{ maxHeight: 240 }}>
              {EMOJI_CATEGORIES.map((cat) => (
                <div key={cat.label} className="px-2 pb-2">
                  <p className="text-[10px] font-semibold text-pnp-textSecondary/60 px-1 pt-1.5 pb-1 uppercase tracking-wider">{cat.label}</p>
                  <div className="flex flex-wrap gap-0.5">
                    {cat.emojis.map((emoji) => (
                      <button
                        key={emoji}
                        onClick={() => { handleReaction(emojiPickerMsgId!, emoji); setEmojiPickerMsgId(null); }}
                        className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-white/10 active:scale-90 transition-all text-xl"
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {showPermGate && (
        <PermissionGate
          onGranted={() => void handleJoinCall()}
          onCancel={() => setShowPermGate(false)}
        />
      )}

      {activeCall && (
        <DmLiveKitPanel
          token={activeCall.token}
          livekitUrl={activeCall.livekitUrl}
          roomName={activeCall.roomName}
          partnerName={partnerName}
          callLink={activeCall.callLink}
          onCopyLink={() => void copyToClipboard(activeCall.callLink)}
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
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-6 pb-2 mb-2">
        <div>
          <h1 className="text-2xl font-bold text-pnp-textPrimary">{t.messagesTitle}</h1>
          <p className="text-sm mt-1 text-pnp-textSecondary">{t.messagesSubtitle}</p>
        </div>
      </div>

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
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
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
          <DmChatView userId={activeUserId} myDbId={user?.dbId ?? user?.id ?? ""} myUserId={user?.id ?? ""} />
        ) : (
          <ThreadListView />
        )}
      </div>
    </>
  );
}
