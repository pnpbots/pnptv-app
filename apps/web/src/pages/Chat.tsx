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
import {
  MediaUploadButton,
  MediaPreview,
  MediaMessage,
  MediaLightbox,
  VideoCallButton,
  VideoCallBanner,
  VideoCallOverlay,
} from "@/components/hangouts";

// ─── Utilities ──────────────────────────────────────────────────────────────

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

type View = "list" | "chat";

// ─── Message Bubble ─────────────────────────────────────────────────────────

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
        className="flex-shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent rounded-full"
        aria-label={`View ${msg.first_name || msg.username || "user"}'s profile`}
      >
        {msg.photo_url ? (
          <img
            src={msg.photo_url}
            className="w-8 h-8 rounded-full object-cover"
            alt=""
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
              const fallback = (e.target as HTMLImageElement).nextElementSibling as HTMLElement;
              if (fallback) fallback.style.display = "flex";
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
            className="text-xs font-medium text-pnp-textPrimary hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-pnp-accent rounded"
          >
            {msg.first_name || msg.username || "User"}
          </button>
          <span className="text-[10px] text-pnp-textSecondary">
            {timeAgo(msg.created_at)}
          </span>
        </div>

        {/* Text content */}
        {hasText && (
          <div
            className="rounded-2xl px-3 py-2 text-sm text-pnp-textPrimary whitespace-pre-wrap break-words"
            style={{
              background: isMe
                ? "linear-gradient(135deg, #D4007A, #E69138)"
                : "rgba(255,255,255,0.08)",
            }}
          >
            {msg.content}
          </div>
        )}

        {/* Media attachment */}
        {hasMedia && (
          <div className={isMe ? "self-end" : "self-start"}>
            <MediaMessage
              mediaUrl={msg.media_url!}
              mediaType={msg.media_type!}
              thumbUrl={msg.media_thumb_url}
              width={msg.media_width}
              height={msg.media_height}
              onExpandImage={onExpandImage}
              isMe={isMe}
            />
          </div>
        )}
      </div>
    </div>
  );
});

// ─── Main Component ─────────────────────────────────────────────────────────

export default function Chat() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isPrime = user?.tier === "PRIME";

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
  const [mediaPreviewUrl, setMediaPreviewUrl] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Lightbox
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  // Video call
  const [callUrl, setCallUrl] = useState<string | null>(null);
  const [callLoading, setCallLoading] = useState(false);

  // ─── Group list loading ─────────────────────────────────────────────

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

  // ─── Group creation ─────────────────────────────────────────────────

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

  // ─── Media handling ─────────────────────────────────────────────────

  const clearMedia = useCallback(() => {
    if (mediaPreviewUrl) URL.revokeObjectURL(mediaPreviewUrl);
    setMediaFile(null);
    setMediaPreviewUrl(null);
    setUploadProgress(null);
    setUploadError(null);
  }, [mediaPreviewUrl]);

  const handleFileSelect = useCallback(
    (file: File, previewUrl: string) => {
      clearMedia();
      setMediaFile(file);
      setMediaPreviewUrl(previewUrl);
      setUploadError(null);
    },
    [clearMedia]
  );

  const handleFileError = useCallback((message: string) => {
    setUploadError(message);
  }, []);

  // ─── Chat view open/close ──────────────────────────────────────────

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

    // If there's already an active call, fetch the URL
    if (group.hasActiveCall) {
      try {
        const callData = await startGroupCall(group.id);
        if (callData.jitsiUrl) setCallUrl(callData.jitsiUrl);
      } catch {
        /* silent */
      }
    }

    // Start polling for new messages
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

  // Clean up polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ─── Send logic ─────────────────────────────────────────────────────

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
      if (!hasMedia) setMsgInput(text);
      setUploadError(
        err instanceof Error ? err.message : "Failed to send message"
      );
      setUploadProgress(null);
    } finally {
      setSending(false);
    }
  }, [sending, activeGroup, msgInput, mediaFile, clearMedia]);

  // ─── Video call ─────────────────────────────────────────────────────

  const ALLOWED_CALL_ORIGINS = ["https://8x8.vc/", "https://meet.jit.si/"];

  const handleStartCall = async () => {
    if (!activeGroup || callLoading) return;
    setCallLoading(true);
    try {
      const data = await startGroupCall(activeGroup.id);
      if (data.jitsiUrl) {
        // Validate URL origin before loading in iframe with camera/mic permissions
        const isValidOrigin = ALLOWED_CALL_ORIGINS.some((prefix) =>
          data.jitsiUrl.startsWith(prefix)
        );
        if (!isValidOrigin) {
          console.error("Rejected invalid call URL from API:", data.jitsiUrl);
          setUploadError("Video call URL is invalid. Please contact support.");
          return;
        }
        setCallUrl(data.jitsiUrl);
      } else {
        setUploadError("Video calls are not available right now.");
      }
    } catch {
      setUploadError("Failed to start video call. Please try again.");
    } finally {
      setCallLoading(false);
    }
  };

  const handleEndCall = useCallback(() => {
    setCallUrl(null);
  }, []);

  // ─── Group management ──────────────────────────────────────────────

  const handleLeaveGroup = async (groupId: number) => {
    try {
      await leaveHangoutGroup(groupId);
      closeChat();
    } catch {
      /* silent */
    }
  };

  const handleDeleteGroup = async (groupId: number) => {
    try {
      await deleteHangoutGroup(groupId);
      closeChat();
    } catch {
      /* silent */
    }
  };

  // ─── Memoized callbacks ────────────────────────────────────────────

  const handleNavigate = useCallback(
    (path: string) => navigate(path),
    [navigate]
  );

  const handleExpandImage = useCallback((src: string) => {
    setLightboxSrc(src);
  }, []);

  // Build media list for lightbox navigation
  const mediaUrls = messages
    .filter((m) => m.media_url && m.media_type === "image")
    .map((m) => m.media_url!);

  const handleLightboxNavigate = useCallback((src: string) => {
    setLightboxSrc(src);
  }, []);

  // ─── Chat View ────────────────────────────────────────────────────────

  if (view === "chat" && activeGroup) {
    const canSend = !sending && (msgInput.trim().length > 0 || mediaFile !== null);

    return (
      <div className="flex flex-col" style={{ height: "calc(100vh - 5rem)" }}>
        {/* Lightbox */}
        {lightboxSrc && (
          <MediaLightbox
            src={lightboxSrc}
            mediaType="image"
            mediaList={mediaUrls}
            onClose={() => setLightboxSrc(null)}
            onNavigate={handleLightboxNavigate}
          />
        )}

        {/* Chat header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-pnp-border flex-shrink-0">
          <button
            onClick={closeChat}
            className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-white/5 active:scale-95 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent"
            aria-label="Back to group list"
          >
            <svg className="w-5 h-5 text-pnp-textPrimary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-bold text-pnp-textPrimary truncate">{activeGroup.name}</h2>
            <p className="text-xs text-pnp-textSecondary">
              {activeGroup.memberCount} members
            </p>
          </div>

          {/* Video call button */}
          <VideoCallButton
            hasActiveCall={!!callUrl || activeGroup.hasActiveCall}
            onStartCall={handleStartCall}
            isLoading={callLoading}
          />

          {/* Leave/delete button (hidden for main + Wall of Fame groups) */}
          {!activeGroup.isMain && !activeGroup.isWallOfFame && (
            <button
              onClick={() => {
                if (activeGroup.creatorId === user?.dbId) {
                  handleDeleteGroup(activeGroup.id);
                } else {
                  handleLeaveGroup(activeGroup.id);
                }
              }}
              className="text-xs px-2 py-1.5 rounded text-pnp-error hover:bg-white/5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent"
            >
              {activeGroup.creatorId === user?.dbId ? "Delete" : "Leave"}
            </button>
          )}
        </div>

        {/* Active call banner (when call URL is set but not embedded yet) */}
        {!callUrl && activeGroup.hasActiveCall && (
          <VideoCallBanner
            isActive={true}
            onJoin={handleStartCall}
            isJoining={callLoading}
          />
        )}

        {/* Embedded video call */}
        {callUrl && (
          <VideoCallOverlay
            meetingUrl={callUrl}
            groupName={activeGroup.name}
            onClose={handleEndCall}
            initialMode="embedded"
          />
        )}

        {/* Messages area */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
          {messagesLoading ? (
            <div className="space-y-3" aria-label="Loading messages" aria-busy="true">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="animate-pulse flex gap-2">
                  <div className="w-8 h-8 rounded-full bg-pnp-surface flex-shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 bg-pnp-surface rounded w-24" />
                    <div className="h-8 bg-pnp-surface rounded-2xl w-48" />
                  </div>
                </div>
              ))}
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center py-12">
              <svg className="w-12 h-12 mx-auto mb-3 text-pnp-textSecondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              <p className="text-pnp-textPrimary font-medium text-sm">No messages yet</p>
              <p className="text-xs text-pnp-textSecondary mt-1">
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
        {mediaFile && mediaPreviewUrl && (
          <MediaPreview
            file={mediaFile}
            previewUrl={mediaPreviewUrl}
            uploadProgress={sending ? (uploadProgress ?? 10) : null}
            uploadError={uploadError}
            onCancel={clearMedia}
          />
        )}

        {/* Upload error (without a file selected) */}
        {uploadError && !mediaFile && (
          <div className="mx-4 mb-2 flex items-center gap-2 text-xs text-pnp-error animate-fade-in-up" role="alert">
            <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
            <span>{uploadError}</span>
            <button
              onClick={() => setUploadError(null)}
              className="ml-auto text-pnp-textSecondary hover:text-pnp-textPrimary"
              aria-label="Dismiss error"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        {/* Input bar */}
        <div className="px-4 py-3 border-t border-pnp-border flex-shrink-0">
          <div className="flex items-center gap-2">
            {/* Media upload button */}
            <MediaUploadButton
              onFileSelect={handleFileSelect}
              onError={handleFileError}
              disabled={sending}
            />

            {/* Text input */}
            <input
              value={msgInput}
              onChange={(e) => setMsgInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
              placeholder={mediaFile ? "Add a caption..." : "Type a message..."}
              className="flex-1 bg-white/5 rounded-full px-4 py-2.5 text-sm text-pnp-textPrimary placeholder:text-pnp-textSecondary/50 focus:outline-none focus:ring-1 focus:ring-pnp-accent/50 min-w-0 transition-colors"
              maxLength={2000}
              disabled={sending}
              aria-label="Message input"
            />

            {/* Send button */}
            <button
              onClick={handleSend}
              disabled={!canSend}
              className="flex-shrink-0 w-11 h-11 rounded-full flex items-center justify-center active:scale-95 transition-all disabled:opacity-30 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent focus-visible:ring-offset-2 focus-visible:ring-offset-pnp-background"
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

  // ─── Group List View ──────────────────────────────────────────────────

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-pnp-textPrimary">Hangouts</h1>
          <p className="text-sm mt-1 text-pnp-textSecondary">
            Group chats + video calls
          </p>
        </div>
        {isPrime && (
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="btn-gradient px-3 py-1.5 rounded-lg text-white text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent active:scale-95 transition-transform"
          >
            + New Group
          </button>
        )}
      </div>

      {/* Create group form */}
      {showCreate && (
        <div className="glass-card-sm p-4 mb-4 animate-fade-in-up">
          <h3 className="text-sm font-semibold text-pnp-textPrimary mb-3">Create Subgroup</h3>
          <label className="sr-only" htmlFor="new-group-name">Group name</label>
          <input
            id="new-group-name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Group name..."
            className="w-full bg-white/5 rounded-lg px-3 py-2.5 text-sm text-pnp-textPrimary placeholder:text-pnp-textSecondary/50 focus:outline-none focus:ring-1 focus:ring-pnp-accent/50 mb-2 transition-colors"
            maxLength={100}
          />
          <label className="sr-only" htmlFor="new-group-desc">Group description</label>
          <textarea
            id="new-group-desc"
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            placeholder="Description (optional)..."
            className="w-full bg-white/5 rounded-lg px-3 py-2.5 text-sm text-pnp-textPrimary placeholder:text-pnp-textSecondary/50 focus:outline-none focus:ring-1 focus:ring-pnp-accent/50 mb-3 resize-none transition-colors"
            rows={2}
            maxLength={500}
          />
          <div className="flex gap-2">
            <button
              onClick={() => setShowCreate(false)}
              className="flex-1 py-2.5 rounded-lg text-sm text-pnp-textSecondary border border-white/10 hover:bg-white/5 active:scale-[0.98] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent"
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={!newName.trim() || creating}
              className="flex-1 btn-gradient py-2.5 rounded-lg text-sm text-white font-semibold disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent"
            >
              {creating ? "Creating..." : "Create"}
            </button>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div
          className="glass-card-sm p-3 mb-4 border-l-4 border-l-pnp-error flex items-start gap-2"
          role="alert"
        >
          <svg className="w-4 h-4 flex-shrink-0 mt-0.5 text-pnp-error" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-pnp-textPrimary/80">{error}</p>
          </div>
          <button
            onClick={() => {
              setIsLoading(true);
              loadGroups().finally(() => setIsLoading(false));
            }}
            className="text-xs font-semibold text-pnp-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-pnp-accent rounded hover:opacity-80 transition-opacity"
          >
            Retry
          </button>
        </div>
      )}

      {/* Loading skeletons */}
      {isLoading ? (
        <div className="space-y-3" aria-label="Loading groups" aria-busy="true">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="glass-card-sm p-4 animate-pulse">
              <div className="flex gap-3">
                <div className="w-12 h-12 rounded-full bg-pnp-surface flex-shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-pnp-surface rounded w-32" />
                  <div className="h-3 bg-pnp-surface rounded w-48" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : groups.length === 0 ? (
        /* Empty state */
        <div className="glass-card-sm p-8 text-center">
          <svg className="w-16 h-16 mx-auto mb-3 text-pnp-textSecondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <p className="text-pnp-textPrimary font-medium mb-1">No groups yet</p>
          <p className="text-sm text-pnp-textSecondary">
            Log in to join the community
          </p>
        </div>
      ) : (
        /* Group list */
        <div className="space-y-2">
          {groups.map((group) => (
            <button
              key={group.id}
              onClick={() => openChat(group)}
              className="w-full glass-card-sm p-4 text-left hover:border-white/20 active:scale-[0.99] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent"
            >
              <div className="flex gap-3 items-center">
                {/* Group avatar */}
                <div
                  className="w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold flex-shrink-0"
                  style={{
                    background: group.isMain
                      ? "linear-gradient(135deg, #D4007A, #E69138)"
                      : group.isWallOfFame
                        ? "linear-gradient(135deg, #FFD700, #E69138)"
                        : "rgba(212, 0, 122, 0.2)",
                    color: group.isMain || group.isWallOfFame ? "#fff" : "#D4007A",
                  }}
                >
                  {group.isMain ? "P" : group.isWallOfFame ? "\u{1F3C6}" : group.name[0]?.toUpperCase()}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-pnp-textPrimary text-sm truncate">
                      {group.name}
                    </span>
                    {group.isMain && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-pnp-textSecondary flex-shrink-0">
                        MAIN
                      </span>
                    )}
                    {group.isWallOfFame && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded flex-shrink-0 text-yellow-300" style={{ background: "rgba(255,215,0,0.15)" }}>
                        WALL OF FAME
                      </span>
                    )}
                    {group.hasActiveCall && (
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <span className="relative flex h-1.5 w-1.5">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-pnp-accent opacity-75" />
                          <span className="relative inline-flex rounded-full h-1.5 w-1.5 dot-gradient" />
                        </span>
                        <span className="text-[10px] text-gradient font-semibold">LIVE</span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs flex-shrink-0 text-pnp-textSecondary">
                      {group.memberCount} members
                    </span>
                    {group.lastMessage && (
                      <span className="text-xs truncate min-w-0 text-pnp-textSecondary">
                        &middot; {group.lastMessage}
                      </span>
                    )}
                  </div>
                </div>

                <svg className="w-4 h-4 flex-shrink-0 text-pnp-textSecondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
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
          <p className="text-sm text-pnp-textPrimary font-medium mb-1">Want to create your own group?</p>
          <p className="text-xs text-pnp-textSecondary mb-3">
            Upgrade to PRIME to create subgroups with video calls
          </p>
          <button
            onClick={() => navigate("/subscribe")}
            className="btn-gradient px-6 py-2 rounded-lg text-white text-sm font-semibold active:scale-95 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent"
          >
            Upgrade to PRIME
          </button>
        </div>
      )}
    </div>
  );
}
