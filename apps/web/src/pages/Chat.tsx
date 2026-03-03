import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  memo,
} from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useTutorial } from "@/hooks/useTutorial";
import { TutorialOverlay } from "@/components/tutorial/TutorialOverlay";
import { useHangoutSocket } from "@/hooks/useHangoutSocket";
import {
  getHangoutGroups,
  createHangoutGroup,
  sendGroupMediaMessage,
  startGroupCall,
  getActiveGroupCall,
  leaveHangoutGroup,
  deleteHangoutGroup,
  markGroupAsRead,
  leaveGroupCall,
  joinHangoutGroup,
  discoverHangoutGroups,
  requestJoinGroup,
  getJoinRequests,
  handleJoinRequest,
  type HangoutGroup,
  type GroupMessage,
  type StartCallResponse,
  type GetActiveCallResponse,
  type DiscoverGroup,
  type JoinRequest,
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

function isValidPhotoUrl(photo: string | null | undefined): photo is string {
  return !!photo && (photo.startsWith("/") || photo.startsWith("http"));
}

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

function formatDateSeparator(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const messageDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.floor((today.getTime() - messageDay.getTime()) / 86400000);

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function isSameDay(a: string, b: string): boolean {
  const dA = new Date(a);
  const dB = new Date(b);
  return (
    dA.getFullYear() === dB.getFullYear() &&
    dA.getMonth() === dB.getMonth() &&
    dA.getDate() === dB.getDate()
  );
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
        {isValidPhotoUrl(msg.photo_url) ? (
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
            display: isValidPhotoUrl(msg.photo_url) ? "none" : undefined,
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

// ─── Typing Indicator ───────────────────────────────────────────────────────

function TypingIndicator({ users }: { users: string[] }) {
  if (users.length === 0) return null;
  let text: string;
  if (users.length === 1) text = `${users[0]} is typing`;
  else if (users.length === 2) text = `${users[0]} and ${users[1]} are typing`;
  else text = `${users[0]} and ${users.length - 1} others are typing`;

  return (
    <div className="flex items-center gap-1.5 px-4 py-1 text-xs text-pnp-textSecondary animate-fade-in-up">
      <span className="flex gap-0.5">
        <span className="w-1 h-1 rounded-full bg-pnp-textSecondary animate-bounce" style={{ animationDelay: "0ms" }} />
        <span className="w-1 h-1 rounded-full bg-pnp-textSecondary animate-bounce" style={{ animationDelay: "150ms" }} />
        <span className="w-1 h-1 rounded-full bg-pnp-textSecondary animate-bounce" style={{ animationDelay: "300ms" }} />
      </span>
      <span>{text}...</span>
    </div>
  );
}

// ─── Date Separator ─────────────────────────────────────────────────────────

function DateSeparator({ date }: { date: string }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="flex-1 h-px bg-white/10" />
      <span className="text-[10px] font-medium text-pnp-textSecondary uppercase tracking-wider">
        {formatDateSeparator(date)}
      </span>
      <div className="flex-1 h-px bg-white/10" />
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function Chat() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const userRole = user?.role?.toLowerCase();
  const isAdmin = userRole === "admin" || userRole === "superadmin";
  const isPrime = user?.tier?.toLowerCase() === "prime" || isAdmin;
  const isMember = user?.tier?.toLowerCase() === "member" || isPrime;
  const isFree = !isMember;
  const { showTutorial, dismissTutorial } = useTutorial("hangouts");

  // Group list state
  const [groups, setGroups] = useState<HangoutGroup[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create group
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newIsPublic, setNewIsPublic] = useState(true);
  const [creating, setCreating] = useState(false);

  // Discover groups
  const [discoverList, setDiscoverList] = useState<DiscoverGroup[]>([]);
  const [showDiscover, setShowDiscover] = useState(false);
  const [discoverLoading, setDiscoverLoading] = useState(false);

  // Join requests management (for creators)
  const [joinRequests, setJoinRequests] = useState<Record<number, JoinRequest[]>>({});
  const [showRequests, setShowRequests] = useState<number | null>(null);

  // Chat view state
  const [view, setView] = useState<View>("list");
  const [activeGroup, setActiveGroup] = useState<HangoutGroup | null>(null);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [msgInput, setMsgInput] = useState("");
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const isNearBottom = useRef(true);
  const prevScrollHeight = useRef(0);

  // Socket hook
  const {
    messages,
    sendMessage,
    emitTyping,
    typingUsers,
    callState,
    isConnected,
    loadOlderMessages,
    hasMore,
    isLoadingMore,
  } = useHangoutSocket(activeGroup?.id ?? null, user?.dbId);

  // Media upload state
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaPreviewUrl, setMediaPreviewUrl] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Lightbox
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  // Video call
  const [callUrl, setCallUrl] = useState<string | null>(null);
  const [callId, setCallId] = useState<string | null>(null);
  const [callLoading, setCallLoading] = useState(false);
  const loadingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Create group error
  const [createError, setCreateError] = useState<string | null>(null);

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
    setCreateError(null);
    try {
      await createHangoutGroup(newName.trim(), newDesc.trim(), newIsPublic);
      setNewName("");
      setNewDesc("");
      setNewIsPublic(true);
      setShowCreate(false);
      loadGroups();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create group");
    } finally {
      setCreating(false);
    }
  };

  // ─── Discover groups ──────────────────────────────────────────────────

  const loadDiscover = useCallback(async () => {
    setDiscoverLoading(true);
    try {
      const data = await discoverHangoutGroups();
      setDiscoverList(data.groups || []);
    } catch {
      // silent fail
    } finally {
      setDiscoverLoading(false);
    }
  }, []);

  const handleDiscoverJoin = async (group: DiscoverGroup) => {
    try {
      if (group.isPublic) {
        await joinHangoutGroup(group.id);
        loadGroups();
        loadDiscover();
      } else {
        await requestJoinGroup(group.id);
        loadDiscover();
      }
    } catch {
      // silent fail
    }
  };

  // ─── Join request management ──────────────────────────────────────────

  const loadJoinRequests = async (groupId: number) => {
    try {
      const data = await getJoinRequests(groupId);
      setJoinRequests((prev) => ({ ...prev, [groupId]: data.requests || [] }));
    } catch {
      // silent fail
    }
  };

  const handleRequest = async (groupId: number, requestId: number, action: "accept" | "reject") => {
    try {
      await handleJoinRequest(groupId, requestId, action);
      loadJoinRequests(groupId);
      if (action === "accept") loadGroups();
    } catch {
      // silent fail
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

  // ─── Smart auto-scroll ─────────────────────────────────────────────

  const handleScroll = useCallback(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isNearBottom.current = distFromBottom < 150;

    // Infinite scroll: load older messages when near top
    if (el.scrollTop < 100 && hasMore && !isLoadingMore) {
      prevScrollHeight.current = el.scrollHeight;
      loadOlderMessages();
    }
  }, [hasMore, isLoadingMore, loadOlderMessages]);

  // Cleanup loading timer on unmount
  useEffect(() => {
    return () => {
      if (loadingTimerRef.current) clearTimeout(loadingTimerRef.current);
    };
  }, []);

  // Preserve scroll position after loading older messages
  useEffect(() => {
    if (!isLoadingMore && prevScrollHeight.current > 0) {
      const el = messagesContainerRef.current;
      if (el) {
        el.scrollTop = el.scrollHeight - prevScrollHeight.current;
      }
      prevScrollHeight.current = 0;
    }
  }, [isLoadingMore]);

  // Auto-scroll on new messages (only when near bottom)
  useEffect(() => {
    if (isNearBottom.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  // ─── Chat view open/close ──────────────────────────────────────────

  const openChat = async (group: HangoutGroup) => {
    // Free-tier users cannot enter hangout rooms — redirect to subscribe
    if (isFree) {
      navigate("/subscribe");
      return;
    }

    // Dismiss the tutorial immediately when entering a chat so the overlay
    // can never surface while the user is in the chat input view.
    if (showTutorial) dismissTutorial();
    setActiveGroup(group);
    setView("chat");
    setCallUrl(null);
    setCallId(null);
    setMessagesLoading(true);
    clearMedia();
    isNearBottom.current = true;

    // Mark as read
    markGroupAsRead(group.id).catch(() => {});

    // Give socket a moment to deliver history, then clear loading
    if (loadingTimerRef.current) clearTimeout(loadingTimerRef.current);
    loadingTimerRef.current = setTimeout(() => setMessagesLoading(false), 1000);

    // If there's already an active call, fetch the URL so the banner/overlay appears.
    // We only auto-open the overlay when the user explicitly clicks Join (not on entering
    // the chat), but we do set callId so the banner renders with an accurate callId.
    if (group.hasActiveCall) {
      try {
        const callData = await getActiveGroupCall(group.id);
        if (callData.call) {
          setCallId(callData.call.id);
          // Do NOT auto-open the overlay — let the user choose to join via the banner
          // (keeps the chat readable without forcing the call on them).
        }
      } catch {
        /* silent */
      }
    }
  };

  const closeChat = () => {
    if (loadingTimerRef.current) clearTimeout(loadingTimerRef.current);
    setView("list");
    setActiveGroup(null);
    setCallUrl(null);
    setCallId(null);
    clearMedia();
    loadGroups();
  };

  // Clear messagesLoading once socket delivers messages
  useEffect(() => {
    if (messages.length > 0) {
      setMessagesLoading(false);
    }
  }, [messages]);

  // ─── Send logic ─────────────────────────────────────────────────────

  const handleSend = useCallback(async () => {
    if (sending || !activeGroup) return;
    const hasText = msgInput.trim().length > 0;
    const hasMediaFile = mediaFile !== null;
    if (!hasText && !hasMediaFile) return;

    setSending(true);
    const text = msgInput.trim();
    setMsgInput("");

    try {
      if (hasMediaFile && mediaFile) {
        // Media uploads still use HTTP
        setUploadProgress(30);
        const data = await sendGroupMediaMessage(
          activeGroup.id,
          mediaFile,
          text || undefined
        );
        setUploadProgress(100);
        // Message will arrive via socket broadcast, no need to manually append
        if (!data.success) throw new Error("Upload failed");
        clearMedia();
      } else {
        // Text messages go via socket for instant delivery
        sendMessage(text);
      }
    } catch (err) {
      if (!hasMediaFile) setMsgInput(text);
      setUploadError(
        err instanceof Error ? err.message : "Failed to send message"
      );
      setUploadProgress(null);
    } finally {
      setSending(false);
    }
  }, [sending, activeGroup, msgInput, mediaFile, clearMedia, sendMessage]);

  // ─── Video call ─────────────────────────────────────────────────────

  const ALLOWED_CALL_ORIGINS = ["https://8x8.vc/", "https://meet.jit.si/"];

  /**
   * Extract a usable meeting URL and call ID from either a startGroupCall or
   * getActiveGroupCall response.  The backend nests the URL inside `jaas.meetingUrl`
   * and the call ID inside `call.id`.
   */
  const resolveCallData = (
    data: StartCallResponse | GetActiveCallResponse
  ): { url: string; callId: string } | null => {
    const meetingUrl = data.jaas?.meetingUrl ?? null;
    const callId = data.call?.id ?? null;

    if (!meetingUrl || !callId) return null;

    const isValidOrigin = ALLOWED_CALL_ORIGINS.some((prefix) =>
      meetingUrl.startsWith(prefix)
    );
    if (!isValidOrigin) {
      console.error("Rejected invalid call URL from API:", meetingUrl);
      return null;
    }

    return { url: meetingUrl, callId };
  };

  const handleStartCall = async () => {
    if (!activeGroup || callLoading) return;
    setCallLoading(true);
    try {
      const data = await startGroupCall(activeGroup.id);
      const resolved = resolveCallData(data);
      if (resolved) {
        setCallUrl(resolved.url);
        setCallId(resolved.callId);
      } else if (data.jaas === null) {
        // JaaS not configured on the server
        setUploadError("Video calls are not available right now. Please contact support.");
      } else {
        setUploadError("Video call URL is invalid. Please contact support.");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to start video call";
      setUploadError(msg);
    } finally {
      setCallLoading(false);
    }
  };

  const handleEndCall = useCallback(() => {
    const resolvedCallId = callId ?? callState.callId;
    if (activeGroup && resolvedCallId) {
      leaveGroupCall(activeGroup.id, resolvedCallId).catch(() => {});
    }
    setCallUrl(null);
    setCallId(null);
  }, [activeGroup, callId, callState.callId]);

  // Show notification when call ends due to creator leaving
  useEffect(() => {
    if (callState.endReason === "creator_left") {
      setUploadError("Call ended: the host left the call");
      setCallUrl(null);
      setCallId(null);
    }
  }, [callState.endReason]);

  // ─── Group management ──────────────────────────────────────────────

  const handleLeaveGroup = async (gid: number) => {
    if (!window.confirm("Leave this group?")) return;
    try {
      await leaveHangoutGroup(gid);
      closeChat();
    } catch {
      /* silent */
    }
  };

  const handleDeleteGroup = async (gid: number) => {
    if (!window.confirm("Permanently delete this group and all its messages?")) return;
    try {
      await deleteHangoutGroup(gid);
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
  const mediaUrls = React.useMemo(
    () => messages.filter((m) => m.media_url && m.media_type === "image").map((m) => m.media_url!),
    [messages]
  );

  const handleLightboxNavigate = useCallback((src: string) => {
    setLightboxSrc(src);
  }, []);

  // ─── Chat View ────────────────────────────────────────────────────────

  if (view === "chat" && activeGroup) {
    const canSend = !sending && (msgInput.trim().length > 0 || mediaFile !== null);
    const showCallBanner = !callUrl && callState.isActive;

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
              {isConnected && (
                <span className="ml-1.5 inline-flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
                </span>
              )}
            </p>
          </div>

          {/* Video call button */}
          <VideoCallButton
            hasActiveCall={!!callUrl || callState.isActive}
            onStartCall={handleStartCall}
            isLoading={callLoading}
            participantCount={callState.participantCount}
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

        {/* Active call banner */}
        {showCallBanner && (
          <VideoCallBanner
            isActive={true}
            onJoin={handleStartCall}
            isJoining={callLoading}
            participantCount={callState.participantCount}
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
        <div
          ref={messagesContainerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0"
        >
          {/* Loading more indicator */}
          {isLoadingMore && (
            <div className="flex justify-center py-2">
              <svg className="w-5 h-5 text-pnp-textSecondary animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </div>
          )}

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
            messages.map((msg, idx) => (
              <React.Fragment key={msg.id}>
                {/* Date separator */}
                {(idx === 0 || !isSameDay(messages[idx - 1].created_at, msg.created_at)) && (
                  <DateSeparator date={msg.created_at} />
                )}
                <MessageBubble
                  msg={msg}
                  isMe={msg.user_id === user?.dbId}
                  onNavigate={handleNavigate}
                  onExpandImage={handleExpandImage}
                />
              </React.Fragment>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Typing indicator */}
        <TypingIndicator users={typingUsers} />

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

        {/* Input bar — relative + z-50 ensures it stacks above any fixed
            floating widgets (e.g. CristinaWidget FAB) that share the same
            bottom region of the viewport on mobile. */}
        <div className="relative z-50 px-4 py-3 border-t border-pnp-border flex-shrink-0 bg-pnp-background">
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
              onChange={(e) => {
                setMsgInput(e.target.value);
                emitTyping();
              }}
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
      {showTutorial && <TutorialOverlay section="hangouts" onDismiss={dismissTutorial} />}
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
          <h3 className="text-sm font-semibold text-pnp-textPrimary mb-1">Create Subgroup</h3>
          <p className="text-xs text-pnp-textSecondary mb-3">Max 25 members &middot; 3 per month &middot; Inactive groups are auto-deleted after 72h</p>
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
          {/* Public/Private toggle */}
          <button
            type="button"
            onClick={() => setNewIsPublic(!newIsPublic)}
            className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg bg-white/5 mb-3 transition-colors hover:bg-white/10"
          >
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-pnp-textSecondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                {newIsPublic ? (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5a17.92 17.92 0 01-8.716-2.247m0 0A9.015 9.015 0 003 12c0-1.605.42-3.113 1.157-4.418" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                )}
              </svg>
              <span className="text-sm text-pnp-textPrimary">
                {newIsPublic ? "Anyone can join" : "Approval required to join"}
              </span>
            </div>
            <div className={`w-9 h-5 rounded-full transition-colors relative ${newIsPublic ? "bg-pnp-accent" : "bg-white/20"}`}>
              <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${newIsPublic ? "left-[18px]" : "left-0.5"}`} />
            </div>
          </button>
          {createError && (
            <p className="text-xs text-pnp-error mb-2">{createError}</p>
          )}
          <div className="flex gap-2">
            <button
              onClick={() => { setShowCreate(false); setCreateError(null); }}
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
          {/* Free-tier upgrade prompt */}
          {isFree && (
            <div className="glass-card-sm p-4 mb-2 text-center border border-purple-500/30 bg-purple-900/20">
              <p className="text-sm text-purple-200 mb-2">
                Become a Member to join hangout rooms
              </p>
              <button
                onClick={() => navigate("/subscribe")}
                className="px-4 py-2 rounded-full text-sm font-semibold bg-gradient-to-r from-purple-500 to-pink-500 text-white active:scale-95 transition-transform"
              >
                Become a Member
              </button>
            </div>
          )}
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
                    {/* Unread badge */}
                    {(group.unreadCount ?? 0) > 0 && (
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded-full text-white font-bold flex-shrink-0 min-w-[18px] text-center"
                        style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
                      >
                        {group.unreadCount! > 99 ? "99+" : group.unreadCount}
                      </span>
                    )}
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
                    {!group.isPublic && !group.isMain && !group.isWallOfFame && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-pnp-textSecondary flex-shrink-0">
                        PRIVATE
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

      {/* Discover Groups */}
      <div className="mt-6">
        <button
          onClick={() => {
            const next = !showDiscover;
            setShowDiscover(next);
            if (next && discoverList.length === 0) loadDiscover();
          }}
          className="flex items-center gap-2 mb-3 group"
        >
          <h2 className="text-sm font-semibold text-pnp-textSecondary group-hover:text-pnp-textPrimary transition-colors">
            Discover Groups
          </h2>
          <svg
            className={`w-3.5 h-3.5 text-pnp-textSecondary transition-transform ${showDiscover ? "rotate-180" : ""}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {showDiscover && (
          <div className="space-y-2 animate-fade-in-up">
            {discoverLoading ? (
              <div className="glass-card-sm p-4 animate-pulse">
                <div className="h-4 bg-pnp-surface rounded w-40" />
              </div>
            ) : discoverList.length === 0 ? (
              <p className="text-xs text-pnp-textSecondary px-1">No groups to discover right now.</p>
            ) : (
              discoverList.map((group) => (
                <div key={group.id} className="glass-card-sm p-4">
                  <div className="flex gap-3 items-center">
                    <div
                      className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
                      style={{ background: "rgba(212, 0, 122, 0.2)", color: "#D4007A" }}
                    >
                      {group.name[0]?.toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-pnp-textPrimary text-sm truncate">{group.name}</span>
                        {!group.isPublic && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-pnp-textSecondary flex-shrink-0">
                            PRIVATE
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-pnp-textSecondary truncate">
                        {group.memberCount} members{group.description ? ` \u00b7 ${group.description}` : ""}
                      </p>
                    </div>
                    {isFree ? (
                      <button
                        onClick={() => navigate("/subscribe")}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold flex-shrink-0 border border-purple-500/50 text-purple-300 hover:bg-purple-500/10 active:scale-95 transition-all"
                      >
                        Upgrade to Join
                      </button>
                    ) : group.isPublic ? (
                      <button
                        onClick={() => handleDiscoverJoin(group)}
                        className="btn-gradient px-3 py-1.5 rounded-lg text-white text-xs font-semibold flex-shrink-0 active:scale-95 transition-transform"
                      >
                        Join
                      </button>
                    ) : group.myRequestStatus === "pending" ? (
                      <span className="text-xs px-3 py-1.5 rounded-lg bg-white/10 text-pnp-textSecondary flex-shrink-0">
                        Requested
                      </span>
                    ) : (
                      <button
                        onClick={() => handleDiscoverJoin(group)}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold flex-shrink-0 border border-pnp-accent text-pnp-accent hover:bg-pnp-accent/10 active:scale-95 transition-all"
                      >
                        Request
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Join Request Management (for group creators) */}
      {groups.filter((g) => !g.isPublic && !g.isMain && !g.isWallOfFame && String(g.creatorId) === String(user?.dbId)).length > 0 && (
        <div className="mt-6">
          <h2 className="text-sm font-semibold text-pnp-textSecondary mb-3">Pending Requests</h2>
          <div className="space-y-2">
            {groups
              .filter((g) => !g.isPublic && !g.isMain && !g.isWallOfFame && String(g.creatorId) === String(user?.dbId))
              .map((group) => (
                <div key={`req-${group.id}`} className="glass-card-sm p-3">
                  <button
                    onClick={() => {
                      const next = showRequests === group.id ? null : group.id;
                      setShowRequests(next);
                      if (next) loadJoinRequests(group.id);
                    }}
                    className="w-full flex items-center justify-between text-left"
                  >
                    <span className="text-sm font-medium text-pnp-textPrimary truncate">{group.name}</span>
                    <svg
                      className={`w-3.5 h-3.5 text-pnp-textSecondary transition-transform flex-shrink-0 ${showRequests === group.id ? "rotate-180" : ""}`}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {showRequests === group.id && (
                    <div className="mt-2 space-y-2 animate-fade-in-up">
                      {(joinRequests[group.id] || []).length === 0 ? (
                        <p className="text-xs text-pnp-textSecondary">No pending requests.</p>
                      ) : (
                        (joinRequests[group.id] || []).map((req) => (
                          <div key={req.id} className="flex items-center gap-2 p-2 rounded-lg bg-white/5">
                            <div className="w-8 h-8 rounded-full bg-pnp-surface flex items-center justify-center text-xs font-bold text-pnp-textPrimary flex-shrink-0">
                              {req.photo_url ? (
                                <img src={req.photo_url} alt="" className="w-8 h-8 rounded-full object-cover" />
                              ) : (
                                (req.first_name || req.username || "?")[0].toUpperCase()
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-pnp-textPrimary truncate">
                                {req.first_name || req.username}
                              </p>
                            </div>
                            <div className="flex gap-1 flex-shrink-0">
                              <button
                                onClick={() => handleRequest(group.id, req.id, "accept")}
                                className="px-2.5 py-1 rounded text-xs font-semibold text-white bg-green-600 hover:bg-green-500 active:scale-95 transition-all"
                              >
                                Accept
                              </button>
                              <button
                                onClick={() => handleRequest(group.id, req.id, "reject")}
                                className="px-2.5 py-1 rounded text-xs font-semibold text-pnp-textSecondary bg-white/10 hover:bg-white/20 active:scale-95 transition-all"
                              >
                                Deny
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              ))}
          </div>
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
