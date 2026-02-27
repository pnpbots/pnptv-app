import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  memo,
} from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import {
  getHangoutGroups,
  createHangoutGroup,
  getGroupMessages,
  sendGroupMessage,
  sendGroupMediaMessage,
  startGroupCall,
  leaveHangoutGroup,
  deleteHangoutGroup,
  type HangoutGroup,
  type GroupMessage,
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

function isVideo(file: File): boolean {
  return file.type.startsWith("video/");
}

type View = "list" | "chat";

// ─── Lightbox ────────────────────────────────────────────────────────────────

interface LightboxProps {
  src: string;
  onClose: () => void;
}

function Lightbox({ src, onClose }: LightboxProps) {
  // Close on Escape key
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
        className="absolute top-4 right-4 w-11 h-11 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 active:scale-95 transition-all"
        aria-label="Close fullscreen image"
      >
        {/* X icon */}
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
  // Show thumbnail in bubble, open full image in lightbox
  const displayUrl = (mediaType === "image" && thumbUrl) ? thumbUrl : mediaUrl;

  if (mediaType === "image") {
    if (imgError) {
      return (
        <div className="mt-2 flex items-center gap-2 text-xs" style={{ color: "#FF453A" }}>
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
      <div className="mt-2 flex items-center gap-2 text-xs" style={{ color: "#FF453A" }}>
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

interface MessageBubbleProps {
  msg: GroupMessage;
  isMe: boolean;
  onNavigate: (path: string) => void;
  onExpandImage: (src: string) => void;
}

const MessageBubble = memo(function MessageBubble({
  msg,
  isMe,
  onNavigate,
  onExpandImage,
}: MessageBubbleProps) {
  const profilePath = isMe ? "/profile" : `/profile/${msg.user_id}`;
  const hasMedia = !!(msg.media_url && msg.media_type);
  const hasText = !!(msg.content && msg.content.trim());

  return (
    <div className={`flex gap-2 ${isMe ? "flex-row-reverse" : ""}`}>
      {/* Avatar */}
      <button
        onClick={() => onNavigate(profilePath)}
        className="flex-shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 rounded-full"
        aria-label={`View ${msg.first_name || msg.username || "user"}'s profile`}
      >
        {msg.photo_url ? (
          <img
            src={msg.photo_url}
            className="w-8 h-8 rounded-full object-cover"
            alt=""
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        ) : null}
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
          style={{
            background: isMe ? "rgba(230, 145, 56, 0.2)" : "rgba(212, 0, 122, 0.2)",
            color: isMe ? "#E69138" : "#D4007A",
            display: msg.photo_url ? "none" : undefined,
          }}
        >
          {(msg.first_name || msg.username || "?")[0].toUpperCase()}
        </div>
      </button>

      {/* Bubble */}
      <div className={`max-w-[75%] ${isMe ? "text-right items-end" : "items-start"} flex flex-col`}>
        {/* Name + time */}
        <div className={`flex items-center gap-1.5 mb-0.5 ${isMe ? "justify-end" : ""}`}>
          <button
            onClick={() => onNavigate(profilePath)}
            className="text-xs font-medium text-white hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/40 rounded"
          >
            {msg.first_name || msg.username || "User"}
          </button>
          <span className="text-[10px]" style={{ color: "#8E8E93" }}>
            {timeAgo(msg.created_at)}
          </span>
        </div>

        {/* Content container — only render bubble if there's text */}
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

        {/* Media (renders outside the text bubble for visual clarity) */}
        {hasMedia && (
          <div className={isMe ? "self-end" : "self-start"}>
            <MediaBubble
              mediaUrl={msg.media_url!}
              mediaType={msg.media_type!}
              thumbUrl={msg.media_thumb_url}
              onExpandImage={onExpandImage}
            />
          </div>
        )}
      </div>
    </div>
  );
});

// ─── Upload preview strip ─────────────────────────────────────────────────────

interface UploadPreviewProps {
  file: File;
  previewUrl: string;
  uploadProgress: number | null;
  uploadError: string | null;
  onCancel: () => void;
}

function UploadPreview({
  file,
  previewUrl,
  uploadProgress,
  uploadError,
  onCancel,
}: UploadPreviewProps) {
  const isVid = isVideo(file);

  return (
    <div className="mx-4 mb-2 glass-card-sm p-2 flex items-start gap-2 animate-fade-in-up">
      {/* Thumbnail */}
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
        {/* File type badge */}
        <div
          className="absolute bottom-1 left-1 text-[9px] font-bold px-1 rounded"
          style={{ background: "rgba(0,0,0,0.7)", color: isVid ? "#E69138" : "#D4007A" }}
        >
          {isVid ? "VID" : "IMG"}
        </div>
      </div>

      {/* Info + progress */}
      <div className="flex-1 min-w-0">
        <p className="text-xs text-white truncate">{file.name}</p>
        <p className="text-[10px]" style={{ color: "#8E8E93" }}>
          {(file.size / 1024 / 1024).toFixed(1)} MB
        </p>

        {uploadError ? (
          <p className="text-[10px] mt-1" style={{ color: "#FF453A" }}>
            {uploadError}
          </p>
        ) : uploadProgress !== null ? (
          <div className="mt-1.5">
            {/* Indeterminate progress bar (fetch doesn't give progress; this is a visual affordance) */}
            <div className="h-1 rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full rounded-full animate-pulse"
                style={{
                  width: `${uploadProgress}%`,
                  background: "linear-gradient(90deg, #D4007A, #E69138)",
                }}
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

      {/* Cancel */}
      {uploadProgress === null && (
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

// ─── Main Component ───────────────────────────────────────────────────────────

export default function Chat() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isPrime = user?.tier?.toLowerCase() === "prime";

  // Group list state
  const [groups, setGroups] = useState<HangoutGroup[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create group
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [creating, setCreating] = useState(false);

  // Chat view state
  const [view, setView] = useState<View>("list");
  const [activeGroup, setActiveGroup] = useState<HangoutGroup | null>(null);
  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [msgInput, setMsgInput] = useState("");
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Media upload state
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaPreview, setMediaPreview] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Lightbox
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  // Video call
  const [callUrl, setCallUrl] = useState<string | null>(null);

  const loadGroups = useCallback(async () => {
    try {
      const data = await getHangoutGroups();
      setGroups(data.groups || []);
      setError(null);
    } catch {
      setError("Failed to load groups");
    }
  }, []);

  useEffect(() => {
    setIsLoading(true);
    loadGroups().finally(() => setIsLoading(false));
  }, [loadGroups]);

  const handleCreate = async () => {
    if (!newName.trim() || creating) return;
    setCreating(true);
    try {
      await createHangoutGroup(newName.trim(), newDesc.trim());
      setNewName("");
      setNewDesc("");
      setShowCreate(false);
      loadGroups();
    } catch {
      // silent
    } finally {
      setCreating(false);
    }
  };

  const openChat = async (group: HangoutGroup) => {
    setActiveGroup(group);
    setView("chat");
    setMessages([]);
    setCallUrl(null);
    setMessagesLoading(true);
    clearMedia();
    try {
      const data = await getGroupMessages(group.id);
      setMessages(data.messages || []);
    } catch {
      // silent
    } finally {
      setMessagesLoading(false);
    }

    if (group.hasActiveCall) {
      try {
        const callData = await startGroupCall(group.id);
        if (callData.jitsiUrl) setCallUrl(callData.jitsiUrl);
      } catch { /* silent */ }
    }

    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const data = await getGroupMessages(group.id);
        setMessages(data.messages || []);
      } catch {
        // silent
      }
    }, 5000);
  };

  const closeChat = () => {
    setView("list");
    setActiveGroup(null);
    setMessages([]);
    setCallUrl(null);
    clearMedia();
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    loadGroups();
  };

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ─── Media handling ────────────────────────────────────────────────────────

  const clearMedia = useCallback(() => {
    setMediaFile(null);
    if (mediaPreview) URL.revokeObjectURL(mediaPreview);
    setMediaPreview(null);
    setUploadProgress(null);
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

  // ─── Send logic ────────────────────────────────────────────────────────────

  const handleSend = useCallback(async () => {
    if (sending || !activeGroup) return;
    const hasText = msgInput.trim().length > 0;
    const hasMedia = mediaFile !== null;
    if (!hasText && !hasMedia) return;

    setSending(true);
    const text = msgInput.trim();
    setMsgInput("");

    try {
      if (hasMedia && mediaFile) {
        // Simulate progress (fetch XHR doesn't support upload progress easily)
        setUploadProgress(30);
        const data = await sendGroupMediaMessage(
          activeGroup.id,
          mediaFile,
          text || undefined
        );
        setUploadProgress(100);
        if (data.success && data.message) {
          setMessages((prev) => [...prev, data.message]);
        }
        clearMedia();
      } else {
        const data = await sendGroupMessage(activeGroup.id, text);
        if (data.success && data.message) {
          setMessages((prev) => [...prev, data.message]);
        }
      }
    } catch (err) {
      // Restore text if text-only send failed
      if (!hasMedia) setMsgInput(text);
      setUploadError(
        err instanceof Error ? err.message : "Failed to send message"
      );
      setUploadProgress(null);
    } finally {
      setSending(false);
      if (uploadProgress === 100) setUploadProgress(null);
    }
  }, [sending, activeGroup, msgInput, mediaFile, clearMedia, uploadProgress]);

  const handleStartCall = async () => {
    if (!activeGroup) return;
    try {
      const data = await startGroupCall(activeGroup.id);
      if (data.jitsiUrl) {
        setCallUrl(data.jitsiUrl);
      } else {
        alert("Video calls are not available right now. Please try again later.");
      }
    } catch {
      alert("Failed to start video call. Please try again later.");
    }
  };

  const handleLeaveGroup = async (groupId: number) => {
    try {
      await leaveHangoutGroup(groupId);
      closeChat();
    } catch { /* silent */ }
  };

  const handleDeleteGroup = async (groupId: number) => {
    try {
      await deleteHangoutGroup(groupId);
      closeChat();
    } catch { /* silent */ }
  };

  // ─── Navigate helper (memoised so MessageBubble doesn't re-render) ──────────
  const handleNavigate = useCallback(
    (path: string) => navigate(path),
    [navigate]
  );

  const handleExpandImage = useCallback((src: string) => {
    setLightboxSrc(src);
  }, []);

  // ─── Chat View ─────────────────────────────────────────────────────────────
  if (view === "chat" && activeGroup) {
    const canSend = !sending && (msgInput.trim().length > 0 || mediaFile !== null);

    return (
      <div className="flex flex-col" style={{ height: "calc(100vh - 5rem)" }}>
        {/* Lightbox */}
        {lightboxSrc && (
          <Lightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
        )}

        {/* Chat header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-white/5 flex-shrink-0">
          <button
            onClick={closeChat}
            className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-white/5 active:scale-95 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
            aria-label="Back to group list"
          >
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-bold text-white truncate">{activeGroup.name}</h2>
            <p className="text-xs" style={{ color: "#8E8E93" }}>
              {activeGroup.memberCount} members
            </p>
          </div>
          {/* Video call button */}
          <button
            onClick={handleStartCall}
            className="w-9 h-9 rounded-full flex items-center justify-center hover:opacity-80 active:scale-95 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
            style={{ background: "linear-gradient(135deg, rgba(212,0,122,0.15), rgba(230,145,56,0.15))" }}
            aria-label="Start video call"
          >
            <svg className="w-5 h-5" style={{ color: "#E69138" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </button>
          {/* Leave/delete button */}
          {!activeGroup.isMain && (
            <button
              onClick={() => {
                if (activeGroup.creatorId === user?.dbId) {
                  handleDeleteGroup(activeGroup.id);
                } else {
                  handleLeaveGroup(activeGroup.id);
                }
              }}
              className="text-xs px-2 py-1.5 rounded hover:bg-white/5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
              style={{ color: "#FF453A" }}
            >
              {activeGroup.creatorId === user?.dbId ? "Delete" : "Leave"}
            </button>
          )}
        </div>

        {/* Active call banner */}
        {callUrl && (
          <div className="glass-card-sm mx-4 mt-2 p-3 flex-shrink-0">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full animate-pulse dot-gradient" />
                <span className="text-xs font-medium text-white">Video Call Active</span>
              </div>
              <button
                onClick={() => setCallUrl(null)}
                className="text-xs hover:opacity-70 transition-opacity focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30 rounded"
                style={{ color: "#FF453A" }}
              >
                Close
              </button>
            </div>
            <div className="aspect-video rounded-lg overflow-hidden">
              <iframe
                src={callUrl}
                className="w-full h-full border-0"
                allow="camera; microphone; display-capture; autoplay"
                title="Video Call"
              />
            </div>
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
          {messagesLoading ? (
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
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center py-12">
              <svg className="w-12 h-12 mx-auto mb-3" style={{ color: "#8E8E93" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              <p className="text-white font-medium text-sm">No messages yet</p>
              <p className="text-xs mt-1" style={{ color: "#8E8E93" }}>
                Be the first to say something!
              </p>
            </div>
          ) : (
            messages.map((msg) => (
              <MessageBubble
                key={msg.id}
                msg={msg}
                isMe={msg.user_id === user?.dbId}
                onNavigate={handleNavigate}
                onExpandImage={handleExpandImage}
              />
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Upload preview */}
        {mediaFile && mediaPreview && (
          <UploadPreview
            file={mediaFile}
            previewUrl={mediaPreview}
            uploadProgress={sending ? (uploadProgress ?? 10) : null}
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
              {/* Image icon */}
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
              maxLength={2000}
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

  // ─── Group List View ───────────────────────────────────────────────────────
  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Hangouts</h1>
          <p className="text-sm mt-1" style={{ color: "#8E8E93" }}>
            Group chats + video calls
          </p>
        </div>
        {isPrime && (
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="btn-gradient px-3 py-1.5 rounded-lg text-white text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
          >
            + New Group
          </button>
        )}
      </div>

      {/* Create group form */}
      {showCreate && (
        <div className="glass-card-sm p-4 mb-4 animate-fade-in-up">
          <h3 className="text-sm font-semibold text-white mb-3">Create Subgroup</h3>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Group name…"
            className="w-full bg-white/5 rounded-lg px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none mb-2"
            maxLength={100}
            aria-label="New group name"
          />
          <textarea
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            placeholder="Description (optional)…"
            className="w-full bg-white/5 rounded-lg px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none mb-3 resize-none"
            rows={2}
            maxLength={500}
            aria-label="New group description"
          />
          <div className="flex gap-2">
            <button
              onClick={() => setShowCreate(false)}
              className="flex-1 py-2.5 rounded-lg text-sm text-white/60 border border-white/10 hover:bg-white/5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={!newName.trim() || creating}
              className="flex-1 btn-gradient py-2.5 rounded-lg text-sm text-white font-semibold disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
            >
              {creating ? "Creating…" : "Create"}
            </button>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div
          className="glass-card-sm p-3 mb-4 border-l-4 flex items-start gap-2"
          style={{ borderLeftColor: "#FF453A" }}
          role="alert"
        >
          <svg className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: "#FF453A" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-white/80">{error}</p>
          </div>
          <button
            onClick={() => { setIsLoading(true); loadGroups().finally(() => setIsLoading(false)); }}
            className="text-xs font-semibold focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30 rounded"
            style={{ color: "#D4007A" }}
          >
            Retry
          </button>
        </div>
      )}

      {/* Loading */}
      {isLoading ? (
        <div className="space-y-3" aria-label="Loading groups" aria-busy="true">
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
      ) : groups.length === 0 ? (
        <div className="glass-card-sm p-8 text-center">
          <svg className="w-16 h-16 mx-auto mb-3" style={{ color: "#8E8E93" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <p className="text-white font-medium mb-1">No groups yet</p>
          <p className="text-sm" style={{ color: "#8E8E93" }}>
            Log in to join the community
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {groups.map((group) => (
            <button
              key={group.id}
              onClick={() => openChat(group)}
              className="w-full glass-card-sm p-4 text-left hover:border-white/20 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
            >
              <div className="flex gap-3 items-center">
                {/* Group avatar */}
                <div
                  className="w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold flex-shrink-0"
                  style={{
                    background: group.isMain
                      ? "linear-gradient(135deg, #D4007A, #E69138)"
                      : "rgba(212, 0, 122, 0.2)",
                    color: group.isMain ? "#fff" : "#D4007A",
                  }}
                >
                  {group.isMain ? "P" : group.name[0]?.toUpperCase()}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-white text-sm truncate">
                      {group.name}
                    </span>
                    {group.isMain && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-white/60 flex-shrink-0">
                        MAIN
                      </span>
                    )}
                    {group.hasActiveCall && (
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <div className="w-1.5 h-1.5 rounded-full animate-pulse dot-gradient" />
                        <span className="text-[10px] text-gradient">LIVE</span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs flex-shrink-0" style={{ color: "#8E8E93" }}>
                      {group.memberCount} members
                    </span>
                    {group.lastMessage && (
                      <span className="text-xs truncate min-w-0" style={{ color: "#8E8E93" }}>
                        &middot; {group.lastMessage}
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

      {/* PRIME upsell */}
      {!isPrime && (
        <div className="mt-6 glass-card-sm p-4 text-center">
          <p className="text-sm text-white font-medium mb-1">Want to create your own group?</p>
          <p className="text-xs mb-3" style={{ color: "#8E8E93" }}>
            Upgrade to PRIME to create subgroups with video calls
          </p>
          <button
            onClick={() => navigate("/subscribe")}
            className="btn-gradient px-6 py-2 rounded-lg text-white text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
          >
            Upgrade to PRIME
          </button>
        </div>
      )}
    </div>
  );
}
