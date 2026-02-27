import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  memo,
} from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import {
  getMessageThreads,
  getMessages,
  sendMessage,
  sendDmMediaMessage,
  markThreadAsRead,
  type MessageThread,
  type DirectMessage,
} from "@/lib/api";

// ─── Utilities ────────────────────────────────────────────────────────────────

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

const ACCEPTED_TYPES = "image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm";
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

function isVideoFile(file: File): boolean {
  return file.type.startsWith("video/");
}

// ─── Lightbox ────────────────────────────────────────────────────────────────

interface LightboxProps {
  src: string;
  onClose: () => void;
}

function Lightbox({ src, onClose }: LightboxProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Image fullscreen view"
    >
      <button
        onClick={onClose}
        className="absolute top-4 right-4 w-11 h-11 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 active:scale-95 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
        aria-label="Close fullscreen image"
      >
        <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
      <img
        src={src}
        alt="Full size"
        className="max-w-full max-h-full object-contain rounded-lg"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

// ─── Media bubble ─────────────────────────────────────────────────────────────

interface MediaBubbleProps {
  mediaUrl: string;
  mediaType: "image" | "video";
  thumbUrl?: string | null;
  onExpandImage: (src: string) => void;
}

const MediaBubble = memo(function MediaBubble({
  mediaUrl,
  mediaType,
  thumbUrl,
  onExpandImage,
}: MediaBubbleProps) {
  const [imgError, setImgError] = useState(false);
  const [vidError, setVidError] = useState(false);
  // For images: use thumbnail for display, open full URL in lightbox
  const displayUrl = (mediaType === "image" && thumbUrl) ? thumbUrl : mediaUrl;

  if (mediaType === "image") {
    if (imgError) {
      return (
        <div className="mt-2 flex items-center gap-1.5 text-xs" style={{ color: "#FF453A" }}>
          <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
          Image failed to load
        </div>
      );
    }
    return (
      <button
        onClick={() => onExpandImage(mediaUrl)}
        className="mt-2 block max-w-[240px] sm:max-w-[300px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 rounded-lg"
        aria-label="View full image"
      >
        <img
          src={displayUrl}
          alt="Shared image"
          loading="lazy"
          className="max-h-60 rounded-lg object-cover w-full hover:opacity-90 active:opacity-75 transition-opacity"
          onError={() => setImgError(true)}
        />
      </button>
    );
  }

  if (vidError) {
    return (
      <div className="mt-2 flex items-center gap-1.5 text-xs" style={{ color: "#FF453A" }}>
        <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
        </svg>
        Video failed to load
      </div>
    );
  }

  return (
    <video
      src={mediaUrl}
      controls
      preload="metadata"
      className="mt-2 max-h-60 max-w-[240px] sm:max-w-[300px] w-full rounded-lg object-cover"
      onError={() => setVidError(true)}
      aria-label="Shared video"
    />
  );
});

// ─── Message bubble ───────────────────────────────────────────────────────────

interface DmBubbleProps {
  msg: DirectMessage;
  userId: string;
  initial: string;
  currentUser: { photoUrl?: string | null; firstName?: string; username?: string } | null;
  partnerName: string;
  onNavigate: (path: string) => void;
  onExpandImage: (src: string) => void;
}

const DmBubble = memo(function DmBubble({
  msg,
  userId,
  initial,
  currentUser,
  onNavigate,
  onExpandImage,
}: DmBubbleProps) {
  const isMe = msg.isMine;
  const avatarPath = isMe ? "/profile" : `/profile/${userId}`;
  const rawAvatarUrl = isMe ? currentUser?.photoUrl : null;
  const avatarUrl =
    rawAvatarUrl &&
    (rawAvatarUrl.startsWith("/") || rawAvatarUrl.startsWith("http"))
      ? rawAvatarUrl
      : null;

  const hasText = !!(msg.content && msg.content.trim());
  const hasMedia = !!(msg.mediaUrl && msg.mediaType);

  return (
    <div className={`flex gap-2 ${isMe ? "flex-row-reverse" : ""}`}>
      {/* Avatar */}
      <button
        onClick={() => onNavigate(avatarPath)}
        className="flex-shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 rounded-full"
        aria-label={isMe ? "View your profile" : "View conversation partner's profile"}
      >
        {avatarUrl ? (
          <img
            src={avatarUrl}
            className="w-8 h-8 rounded-full object-cover"
            alt=""
          />
        ) : (
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
            style={{
              background: isMe ? "rgba(230, 145, 56, 0.2)" : "rgba(212, 0, 122, 0.2)",
              color: isMe ? "#E69138" : "#D4007A",
            }}
          >
            {initial}
          </div>
        )}
      </button>

      {/* Bubble */}
      <div className={`max-w-[75%] flex flex-col ${isMe ? "items-end" : "items-start"}`}>
        {/* Timestamp */}
        <div className={`flex items-center gap-1.5 mb-0.5 ${isMe ? "justify-end" : ""}`}>
          <span className="text-[10px]" style={{ color: "#8E8E93" }}>
            {timeAgo(msg.createdAt)}
          </span>
        </div>

        {/* Text bubble */}
        {hasText && (
          <div
            className="rounded-2xl px-3 py-2 text-sm text-white whitespace-pre-wrap break-words"
            style={{
              background: isMe
                ? "linear-gradient(135deg, #D4007A, #E69138)"
                : "rgba(255,255,255,0.08)",
            }}
          >
            {msg.content}
          </div>
        )}

        {/* Media */}
        {hasMedia && (
          <MediaBubble
            mediaUrl={msg.mediaUrl!}
            mediaType={msg.mediaType!}
            thumbUrl={msg.mediaThumbUrl}
            onExpandImage={onExpandImage}
          />
        )}
      </div>
    </div>
  );
});

// ─── Upload preview ───────────────────────────────────────────────────────────

interface UploadPreviewProps {
  file: File;
  previewUrl: string;
  isSending: boolean;
  uploadError: string | null;
  onCancel: () => void;
}

function UploadPreview({
  file,
  previewUrl,
  isSending,
  uploadError,
  onCancel,
}: UploadPreviewProps) {
  const isVid = isVideoFile(file);

  return (
    <div className="mx-4 mb-2 glass-card-sm p-2 flex items-start gap-2 animate-fade-in-up">
      <div className="relative flex-shrink-0">
        {isVid ? (
          <video
            src={previewUrl}
            className="w-16 h-16 rounded-lg object-cover"
            muted
            playsInline
            aria-label="Video preview"
          />
        ) : (
          <img
            src={previewUrl}
            alt="Upload preview"
            className="w-16 h-16 rounded-lg object-cover"
          />
        )}
        <div
          className="absolute bottom-1 left-1 text-[9px] font-bold px-1 rounded"
          style={{
            background: "rgba(0,0,0,0.7)",
            color: isVid ? "#E69138" : "#D4007A",
          }}
        >
          {isVid ? "VID" : "IMG"}
        </div>
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-xs text-white truncate">{file.name}</p>
        <p className="text-[10px]" style={{ color: "#8E8E93" }}>
          {(file.size / 1024 / 1024).toFixed(1)} MB
        </p>

        {uploadError ? (
          <p className="text-[10px] mt-1" style={{ color: "#FF453A" }}>
            {uploadError}
          </p>
        ) : isSending ? (
          <div className="mt-1.5">
            <div className="h-1 rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full w-2/3 rounded-full animate-pulse"
                style={{ background: "linear-gradient(90deg, #D4007A, #E69138)" }}
              />
            </div>
            <p className="text-[10px] mt-0.5" style={{ color: "#8E8E93" }}>
              Uploading…
            </p>
          </div>
        ) : (
          <p className="text-[10px] mt-1" style={{ color: "#8E8E93" }}>
            Press send to share
          </p>
        )}
      </div>

      {!isSending && (
        <button
          onClick={onCancel}
          className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-full hover:bg-white/10 active:scale-95 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
          aria-label="Remove selected media"
        >
          <svg className="w-4 h-4" style={{ color: "#8E8E93" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}

// ─── Root component ───────────────────────────────────────────────────────────

export default function DirectMessages() {
  const { userId } = useParams<{ userId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();

  if (userId) {
    return (
      <Conversation
        userId={userId}
        currentUser={user}
        navigate={navigate}
      />
    );
  }
  return <ThreadList currentUser={user} navigate={navigate} />;
}

// ─── Thread List ──────────────────────────────────────────────────────────────

function ThreadList({
  currentUser,
  navigate,
}: {
  currentUser: { firstName?: string; username?: string } | null;
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
            Retry
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
                      {timeAgo(thread.lastMessageAt)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between mt-0.5 gap-2">
                    <span className="text-xs truncate min-w-0" style={{ color: "#8E8E93" }}>
                      {thread.lastMessage || "Photo/Video"}
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

// ─── Conversation View ────────────────────────────────────────────────────────

function Conversation({
  userId,
  currentUser,
  navigate,
}: {
  userId: string;
  currentUser: { photoUrl?: string | null; firstName?: string; username?: string; dbId?: string } | null;
  navigate: (path: string) => void;
}) {
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [msgInput, setMsgInput] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [partnerName, setPartnerName] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Media upload state
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaPreview, setMediaPreview] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Lightbox
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  const loadMessages = useCallback(async () => {
    try {
      const data = await getMessages(userId, 50);
      setMessages(data.messages || []);
      setLoadError(null);
      if (!partnerName && data.messages?.length) {
        const other = data.messages.find((m: DirectMessage) => !m.isMine);
        if (other) {
          // partnerName is derived from thread; clear it if still unknown
          setPartnerName((prev) => prev);
        }
      }
    } catch {
      setLoadError("Failed to load messages. Tap to retry.");
    }
  }, [userId, partnerName]);

  useEffect(() => {
    setIsLoading(true);
    loadMessages().finally(() => setIsLoading(false));
    markThreadAsRead(userId).catch(() => {});

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

  // ─── Media handling ──────────────────────────────────────────────────────

  const clearMedia = useCallback(() => {
    setMediaFile(null);
    if (mediaPreview) URL.revokeObjectURL(mediaPreview);
    setMediaPreview(null);
    setUploadError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [mediaPreview]);

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      if (file.size > MAX_FILE_SIZE) {
        setUploadError("File too large. Maximum size is 50 MB.");
        if (fileInputRef.current) fileInputRef.current.value = "";
        return;
      }

      clearMedia();
      setMediaFile(file);
      setMediaPreview(URL.createObjectURL(file));
      setUploadError(null);
    },
    [clearMedia]
  );

  // ─── Send logic ──────────────────────────────────────────────────────────

  const handleSend = useCallback(async () => {
    if (sending) return;
    const hasText = msgInput.trim().length > 0;
    const hasMedia = mediaFile !== null;
    if (!hasText && !hasMedia) return;

    setSending(true);
    setSendError(null);
    const text = msgInput.trim();
    setMsgInput("");

    try {
      if (hasMedia && mediaFile) {
        const data = await sendDmMediaMessage(userId, mediaFile, text || undefined);
        if (data.success && data.message) {
          setMessages((prev) => [...prev, data.message]);
        }
        clearMedia();
      } else {
        const data = await sendMessage(userId, text);
        if (data.success && data.message) {
          setMessages((prev) => [...prev, data.message]);
        }
      }
    } catch (err) {
      if (!hasMedia) setMsgInput(text);
      setSendError(
        err instanceof Error ? err.message : "Failed to send message. Try again."
      );
      setUploadError(
        hasMedia
          ? err instanceof Error
            ? err.message
            : "Upload failed. Try again."
          : null
      );
    } finally {
      setSending(false);
    }
  }, [sending, msgInput, mediaFile, userId, clearMedia]);

  const handleNavigate = useCallback(
    (path: string) => navigate(path),
    [navigate]
  );

  const handleExpandImage = useCallback((src: string) => {
    setLightboxSrc(src);
  }, []);

  const canSend = !sending && (msgInput.trim().length > 0 || mediaFile !== null);

  // Derive initials for current user + partner
  const myInitial = (
    currentUser?.firstName ||
    currentUser?.username ||
    "Y"
  )[0].toUpperCase();
  const partnerInitial = (partnerName || "U")[0].toUpperCase();

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 5rem)" }}>
      {/* Lightbox */}
      {lightboxSrc && (
        <Lightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
      )}

      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/5 flex-shrink-0">
        <button
          onClick={() => navigate("/dm")}
          className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-white/5 active:scale-95 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
          aria-label="Back to message threads"
        >
          <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <button
          onClick={() => navigate(`/profile/${userId}`)}
          className="flex-1 min-w-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 rounded-lg px-1"
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
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
        {isLoading ? (
          <div className="space-y-3" aria-label="Loading messages" aria-busy="true">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="animate-pulse flex gap-2">
                <div className="w-8 h-8 rounded-full bg-white/10 flex-shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 bg-white/10 rounded w-24" />
                  <div className="h-8 bg-white/10 rounded-2xl w-48" />
                </div>
              </div>
            ))}
          </div>
        ) : loadError ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-12">
            <svg className="w-12 h-12 mx-auto mb-3" style={{ color: "#FF453A" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
            <p className="text-white/80 text-sm mb-3">{loadError}</p>
            <button
              onClick={() => { setIsLoading(true); loadMessages().finally(() => setIsLoading(false)); }}
              className="btn-gradient px-5 py-2 rounded-lg text-white text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
            >
              Try Again
            </button>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-12">
            <svg className="w-12 h-12 mx-auto mb-3" style={{ color: "#8E8E93" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            <p className="text-white font-medium text-sm">No messages yet</p>
            <p className="text-xs mt-1" style={{ color: "#8E8E93" }}>
              Say hello!
            </p>
          </div>
        ) : (
          messages.map((msg) => (
            <DmBubble
              key={msg.id}
              msg={msg}
              userId={userId}
              initial={msg.isMine ? myInitial : partnerInitial}
              currentUser={currentUser}
              partnerName={partnerName}
              onNavigate={handleNavigate}
              onExpandImage={handleExpandImage}
            />
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Send error banner */}
      {sendError && (
        <div
          className="mx-4 mb-2 flex items-center gap-2 text-xs px-3 py-2 rounded-lg"
          style={{ background: "rgba(255,69,58,0.1)", color: "#FF453A" }}
          role="alert"
          aria-live="polite"
        >
          <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
          <span className="flex-1 min-w-0">{sendError}</span>
          <button
            onClick={() => setSendError(null)}
            className="flex-shrink-0 hover:opacity-70 transition-opacity"
            aria-label="Dismiss error"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Upload preview */}
      {mediaFile && mediaPreview && (
        <UploadPreview
          file={mediaFile}
          previewUrl={mediaPreview}
          isSending={sending}
          uploadError={uploadError}
          onCancel={clearMedia}
        />
      )}

      {/* Input bar */}
      <div className="px-4 py-3 border-t border-white/5 flex-shrink-0">
        <div className="flex items-center gap-2">
          {/* Media picker button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={sending}
            className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center hover:bg-white/5 active:scale-95 transition-all disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
            aria-label="Attach photo or video"
          >
            <svg className="w-5 h-5" style={{ color: "#D4007A" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
            </svg>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_TYPES}
            className="hidden"
            onChange={handleFileSelect}
            aria-label="Select photo or video to send"
          />

          {/* Text input */}
          <input
            value={msgInput}
            onChange={(e) => setMsgInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
            placeholder={mediaFile ? "Add a caption…" : "Type a message…"}
            className="flex-1 bg-white/5 rounded-full px-4 py-2.5 text-sm text-white placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-white/20 min-w-0"
            maxLength={1000}
            disabled={sending}
            aria-label="Message input"
          />

          {/* Send button */}
          <button
            onClick={handleSend}
            disabled={!canSend}
            className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center active:scale-95 transition-all disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
            style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
            aria-label="Send message"
          >
            {sending ? (
              <svg className="w-4 h-4 text-white animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
