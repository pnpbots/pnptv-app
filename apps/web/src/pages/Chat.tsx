import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  memo,
} from "react";
import { Helmet } from "react-helmet-async";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useTier } from "@/hooks/useTier";
import { useTutorial } from "@/hooks/useTutorial";
import { TutorialOverlay } from "@/components/tutorial/TutorialOverlay";
import { useHangoutSocket } from "@/hooks/useHangoutSocket";
import { useI18n } from "@/lib/i18n";
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
import { connectSocket } from "@/lib/socket";
import { translateText } from "@/lib/feedI18n";

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

function formatDateSeparator(dateStr: string, today: string, yesterday: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const todayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const messageDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.floor((todayDate.getTime() - messageDay.getTime()) / 86400000);

  if (diffDays === 0) return today;
  if (diffDays === 1) return yesterday;
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
  userLang: string;
  onNavigate: (path: string) => void;
  onExpandImage: (src: string) => void;
}

const MessageBubble = memo(function MessageBubble({
  msg,
  isMe,
  userLang,
  onNavigate,
  onExpandImage,
}: MessageBubbleProps) {
  const profilePath = isMe ? "/profile" : `/profile/${msg.user_id}`;
  const hasMedia = !!(msg.media_url && msg.media_type);
  const hasText = !!(msg.content && msg.content.trim());
  const [translatedContent, setTranslatedContent] = useState<string | null>(null);
  const [isTranslating, setIsTranslating] = useState(false);

  const handleTranslate = useCallback(async () => {
    if (isTranslating) return;
    if (translatedContent) { setTranslatedContent(null); return; }
    if (!msg.content) return;
    setIsTranslating(true);
    const result = await translateText(msg.content, userLang || "en");
    if (result) setTranslatedContent(result);
    setIsTranslating(false);
  }, [isTranslating, translatedContent, msg.content, userLang]);

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
          <div>
            <div
              className="rounded-2xl px-3 py-2 text-sm text-pnp-textPrimary whitespace-pre-wrap break-words"
              style={{
                background: isMe
                  ? "linear-gradient(135deg, #D4007A, #E69138)"
                  : "rgba(255,255,255,0.08)",
              }}
            >
              {translatedContent ?? msg.content}
            </div>
            <div className={`flex items-center gap-1 mt-0.5 ${isMe ? "justify-end" : ""}`}>
              <button
                onClick={handleTranslate}
                disabled={isTranslating}
                className="flex items-center gap-0.5 text-[10px] transition-colors hover:text-teal-400 disabled:opacity-40 px-1 py-0.5 rounded"
                style={translatedContent ? { color: "#5ED1C4" } : { color: "#8E8E93" }}
                title={translatedContent ? "Show original" : "Translate"}
              >
                {isTranslating ? (
                  <span>...</span>
                ) : (
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 21l5.25-11.25L21 21m-9-3h7.5M3 5.621a48.474 48.474 0 016-.371m0 0c1.12 0 2.233.038 3.334.114M9 5.25V3m3.334 2.364C11.176 10.658 7.69 15.08 3 17.502m9.334-12.138c.896.061 1.785.147 2.666.257m-4.589 8.495a18.023 18.023 0 01-3.827-5.802" />
                  </svg>
                )}
              </button>
            </div>
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
  const t = useI18n();
  if (users.length === 0) return null;
  let text: string;
  if (users.length === 1) text = t.chat.isTyping(users[0]);
  else if (users.length === 2) text = t.chat.areTyping(users[0], users[1]);
  else text = t.chat.othersTyping(users[0], users.length - 1);

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
  const t = useI18n();
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="flex-1 h-px bg-white/10" />
      <span className="text-[10px] font-medium text-pnp-textSecondary uppercase tracking-wider">
        {formatDateSeparator(date, t.chat.today, t.chat.yesterday)}
      </span>
      <div className="flex-1 h-px bg-white/10" />
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function Chat() {
  const { user } = useAuth();
  const { isPrime, isMember, isFree, isAdmin } = useTier();
  const navigate = useNavigate();
  const t = useI18n();
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
    onlineMembers,
    inviteToCall,
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

  // Online members panel
  const [showOnline, setShowOnline] = useState(false);

  // Incoming invite notification (global — received even from other groups)
  const [inviteNotif, setInviteNotif] = useState<{
    groupId: number;
    groupName: string;
    fromName: string;
    fromPhotoUrl: string | null;
  } | null>(null);

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
      setCreateError(err instanceof Error ? err.message : t.chat.errorFailedToCreate);
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
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Failed to join group");
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
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : `Failed to ${action} request`);
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
    setShowOnline(false);
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
        if (!data.success) throw new Error(t.chat.errorUploadFailed);
        clearMedia();
      } else {
        // Text messages go via socket for instant delivery
        sendMessage(text);
      }
    } catch (err) {
      if (!hasMediaFile) setMsgInput(text);
      setUploadError(
        err instanceof Error ? err.message : t.chat.errorFailedToSend
      );
      setUploadProgress(null);
    } finally {
      setSending(false);
    }
  }, [sending, activeGroup, msgInput, mediaFile, clearMedia, sendMessage, t.chat]);

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
        setUploadError(t.chat.videoCallsUnavailable);
      } else {
        setUploadError(t.chat.videoCallUrlInvalid);
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
      setUploadError(t.chat.callEndedHostLeft);
      setCallUrl(null);
      setCallId(null);
    }
  }, [callState.endReason, t.chat]);

  // Global invite listener — works regardless of which group is active
  useEffect(() => {
    const socket = connectSocket();
    let dismissTimer: ReturnType<typeof setTimeout> | null = null;
    const onInvite = (data: {
      groupId: number;
      groupName: string;
      fromUserId: string;
      fromName: string;
      fromPhotoUrl: string | null;
    }) => {
      setInviteNotif({
        groupId: data.groupId,
        groupName: data.groupName,
        fromName: data.fromName,
        fromPhotoUrl: data.fromPhotoUrl,
      });
      if (dismissTimer) clearTimeout(dismissTimer);
      dismissTimer = setTimeout(() => setInviteNotif(null), 8000);
    };
    socket.on("hangout:invite:received", onInvite);
    return () => {
      socket.off("hangout:invite:received", onInvite);
      if (dismissTimer) clearTimeout(dismissTimer);
    };
  }, []);

  // ─── Group management ──────────────────────────────────────────────

  const handleLeaveGroup = async (gid: number) => {
    if (!window.confirm(t.chat.leaveGroupConfirm)) return;
    try {
      await leaveHangoutGroup(gid);
      closeChat();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Failed to leave group");
    }
  };

  const handleDeleteGroup = async (gid: number) => {
    if (!window.confirm(t.chat.deleteGroupConfirm)) return;
    try {
      await deleteHangoutGroup(gid);
      closeChat();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Failed to delete group");
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
      <div className="relative flex flex-col h-full">
        {/* Incoming call invite toast */}
        {inviteNotif && (
          <div
            className="fixed top-4 left-1/2 z-50 w-full max-w-sm -translate-x-1/2 px-4 animate-fade-in-up"
            style={{ pointerEvents: "none" }}
          >
            <div
              className="rounded-2xl p-4 flex items-center gap-3 shadow-2xl"
              style={{
                background: "#1C1C1E",
                border: "1px solid rgba(94,209,196,0.3)",
                pointerEvents: "auto",
              }}
            >
              {/* Avatar */}
              {inviteNotif.fromPhotoUrl ? (
                <img src={inviteNotif.fromPhotoUrl} alt="" className="w-10 h-10 rounded-full object-cover flex-shrink-0" />
              ) : (
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
                  style={{ background: "linear-gradient(135deg, #5ED1C4, #00D4E8)", color: "#fff" }}
                >
                  {(inviteNotif.fromName || "?")[0].toUpperCase()}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-white truncate">
                  {t.chat.callInviteTitle(inviteNotif.fromName)}
                </p>
                <p className="text-xs truncate" style={{ color: "#8E8E93" }}>
                  {t.chat.callInviteBody(inviteNotif.groupName)}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => {
                    const g = groups.find((gr) => gr.id === inviteNotif.groupId);
                    if (g) openChat(g);
                    setInviteNotif(null);
                  }}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white"
                  style={{ background: "linear-gradient(135deg, #5ED1C4, #00D4E8)" }}
                >
                  {t.chat.joinCall}
                </button>
                <button
                  onClick={() => setInviteNotif(null)}
                  className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors"
                  style={{ color: "#8E8E93" }}
                  aria-label={t.chat.dismissInvite}
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        )}

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
            aria-label={t.chat.backToGroupList}
          >
            <svg className="w-5 h-5 text-pnp-textPrimary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-bold text-pnp-textPrimary truncate">{activeGroup.name}</h2>
            <p className="text-xs text-pnp-textSecondary">
              {activeGroup.memberCount} {activeGroup.memberCount === 1 ? t.chat.membersSingular : t.chat.membersPlural}
              {isConnected && (
                <span className="ml-1.5 inline-flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
                </span>
              )}
            </p>
          </div>

          {/* Online members button */}
          <button
            onClick={() => setShowOnline((v) => !v)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg transition-colors hover:bg-white/5"
            title={t.chat.onlineNow}
            aria-label={t.chat.showOnlineMembers}
          >
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-60" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-400" />
            </span>
            <span className="text-xs font-medium text-green-400">{onlineMembers.length}</span>
          </button>

          {/* Video call: Main Stage link for main group, regular call button for others */}
          {activeGroup.isMain ? (
            <button
              onClick={() => navigate("/main-stage")}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-white transition-colors"
              style={{ background: "linear-gradient(135deg, #5ED1C4, #00D4E8)" }}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              Main Stage
            </button>
          ) : (
            <VideoCallButton
              hasActiveCall={!!callUrl || callState.isActive}
              onStartCall={handleStartCall}
              isLoading={callLoading}
              participantCount={callState.participantCount}
            />
          )}

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
              {activeGroup.creatorId === user?.dbId ? t.chat.deleteGroup : t.chat.leaveGroup}
            </button>
          )}
        </div>

        {/* Active call banner (not for main group — uses Main Stage) */}
        {showCallBanner && !activeGroup.isMain && (
          <VideoCallBanner
            isActive={true}
            onJoin={handleStartCall}
            isJoining={callLoading}
            participantCount={callState.participantCount}
            callId={callState.callId}
          />
        )}

        {/* Embedded video call (not for main group) */}
        {callUrl && !activeGroup.isMain && (
          <VideoCallOverlay
            meetingUrl={callUrl}
            groupName={activeGroup.name}
            onClose={handleEndCall}
            initialMode="embedded"
            isAdmin={isAdmin}
            groupId={activeGroup.id}
            userId={user?.id ? String(user.id) : undefined}
            socketChat={{ messages, sendMessage, emitTyping, typingUsers }}
          />
        )}

        {/* Online Members Panel */}
        {showOnline && (
          <div
            className="absolute inset-0 z-40 flex flex-col justify-end"
            style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }}
            onClick={(e) => { if (e.target === e.currentTarget) setShowOnline(false); }}
          >
            <div
              className="rounded-t-2xl w-full max-h-[60vh] flex flex-col"
              style={{ background: "#1C1C1E", borderTop: "1px solid rgba(255,255,255,0.1)" }}
            >
              {/* Panel header */}
              <div className="flex items-center justify-between px-5 pt-4 pb-3 flex-shrink-0">
                <div>
                  <p className="text-sm font-semibold text-white">{t.chat.onlineNow}</p>
                  <p className="text-xs" style={{ color: "#8E8E93" }}>{t.chat.onlineOfTotal(onlineMembers.length, activeGroup.memberCount)}</p>
                </div>
                <button
                  onClick={() => setShowOnline(false)}
                  className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors"
                  style={{ color: "#8E8E93" }}
                  aria-label={t.chat.closeOnlinePanel}
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              {/* Member list */}
              <div className="overflow-y-auto flex-1 px-4 pb-6 space-y-2">
                {onlineMembers.length === 0 ? (
                  <p className="text-center text-sm py-6" style={{ color: "#8E8E93" }}>{t.chat.noOtherMembersOnline}</p>
                ) : (
                  onlineMembers.map((member) => {
                    const isMe = member.userId === user?.dbId;
                    return (
                      <div key={member.userId} className="flex items-center gap-3 py-2">
                        {/* Avatar */}
                        {member.photoUrl ? (
                          <img src={member.photoUrl} alt="" className="w-10 h-10 rounded-full object-cover flex-shrink-0" />
                        ) : (
                          <div
                            className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
                            style={{ background: "linear-gradient(135deg, #D4007A, #E69138)", color: "#fff" }}
                          >
                            {(member.name || "?")[0].toUpperCase()}
                          </div>
                        )}
                        {/* Name */}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-white truncate">
                            {member.name}{isMe ? ` ${t.chat.you}` : ""}
                          </p>
                          <div className="flex items-center gap-1 mt-0.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
                            <span className="text-xs" style={{ color: "#8E8E93" }}>{t.chat.online}</span>
                          </div>
                        </div>
                        {/* Invite button — only if call is active and not self */}
                        {(callState.isActive || callUrl) && !isMe && (
                          <button
                            onClick={() => {
                              inviteToCall(member.userId);
                              setShowOnline(false);
                            }}
                            className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white flex-shrink-0 transition-all active:scale-95"
                            style={{ background: "linear-gradient(135deg, #5ED1C4, #00D4E8)" }}
                          >
                            {t.chat.invite}
                          </button>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
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
              <p className="text-pnp-textPrimary font-medium text-sm">{t.chat.noMessagesYet}</p>
              <p className="text-xs text-pnp-textSecondary mt-1">
                {t.chat.beFirstToSay}
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
                  userLang={user?.language || "en"}
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
              aria-label={t.chat.dismissError}
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
              placeholder={mediaFile ? t.chat.addACaption : t.chat.typeAMessage}
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
              aria-label={t.chat.sendMessage}
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
      <Helmet>
        <title>{t.chat.pageTitle}</title>
        <meta name="description" content={t.chat.pageDescription} />
      </Helmet>
      {showTutorial && <TutorialOverlay section="hangouts" onDismiss={dismissTutorial} />}

      {/* Incoming call invite toast */}
      {inviteNotif && (
        <div
          className="fixed top-4 left-1/2 z-50 w-full max-w-sm -translate-x-1/2 px-4 animate-fade-in-up"
          style={{ pointerEvents: "none" }}
        >
          <div
            className="rounded-2xl p-4 flex items-center gap-3 shadow-2xl"
            style={{
              background: "#1C1C1E",
              border: "1px solid rgba(94,209,196,0.3)",
              pointerEvents: "auto",
            }}
          >
            {/* Avatar */}
            {inviteNotif.fromPhotoUrl ? (
              <img src={inviteNotif.fromPhotoUrl} alt="" className="w-10 h-10 rounded-full object-cover flex-shrink-0" />
            ) : (
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
                style={{ background: "linear-gradient(135deg, #5ED1C4, #00D4E8)", color: "#fff" }}
              >
                {(inviteNotif.fromName || "?")[0].toUpperCase()}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-white truncate">
                {t.chat.callInviteTitle(inviteNotif.fromName)}
              </p>
              <p className="text-xs truncate" style={{ color: "#8E8E93" }}>
                {t.chat.callInviteBody(inviteNotif.groupName)}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={() => {
                  const g = groups.find((gr) => gr.id === inviteNotif.groupId);
                  if (g) openChat(g);
                  setInviteNotif(null);
                }}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white"
                style={{ background: "linear-gradient(135deg, #5ED1C4, #00D4E8)" }}
              >
                {t.chat.joinCall}
              </button>
              <button
                onClick={() => setInviteNotif(null)}
                className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors"
                style={{ color: "#8E8E93" }}
                aria-label={t.chat.dismissInvite}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-pnp-textPrimary">{t.chat.hangoutsTitle}</h1>
          <p className="text-sm mt-1 text-pnp-textSecondary">
            {t.chat.hangoutsSubtitle}
          </p>
        </div>
        {isPrime && (
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="btn-gradient px-3 py-1.5 rounded-lg text-white text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent active:scale-95 transition-transform"
          >
            {t.chat.newGroup}
          </button>
        )}
      </div>

      {/* Create group form */}
      {showCreate && (
        <div className="glass-card-sm p-4 mb-4 animate-fade-in-up">
          <h3 className="text-sm font-semibold text-pnp-textPrimary mb-1">{t.chat.createSubgroupTitle}</h3>
          <p className="text-xs text-pnp-textSecondary mb-3">{t.chat.createSubgroupHint}</p>
          <label className="sr-only" htmlFor="new-group-name">{t.chat.groupNameLabel}</label>
          <input
            id="new-group-name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={t.chat.groupNamePlaceholder}
            className="w-full bg-white/5 rounded-lg px-3 py-2.5 text-sm text-pnp-textPrimary placeholder:text-pnp-textSecondary/50 focus:outline-none focus:ring-1 focus:ring-pnp-accent/50 mb-2 transition-colors"
            maxLength={100}
          />
          <label className="sr-only" htmlFor="new-group-desc">{t.chat.groupDescriptionLabel}</label>
          <textarea
            id="new-group-desc"
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            placeholder={t.chat.groupDescriptionPlaceholder}
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
                {newIsPublic ? t.chat.anyoneCanJoin : t.chat.approvalRequired}
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
              {t.chat.cancel}
            </button>
            <button
              onClick={handleCreate}
              disabled={!newName.trim() || creating}
              className="flex-1 btn-gradient py-2.5 rounded-lg text-sm text-white font-semibold disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent"
            >
              {creating ? t.chat.creating : t.chat.create}
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
          <p className="text-pnp-textPrimary font-medium mb-1">{t.chat.noGroupsYet}</p>
          <p className="text-sm text-pnp-textSecondary">
            {t.chat.noGroupsLoginHint}
          </p>
        </div>
      ) : (
        /* Group list */
        <div className="space-y-2">
          {/* Free-tier upgrade prompt */}
          {isFree && (
            <div className="glass-card-sm p-4 mb-2 text-center border border-purple-500/30 bg-purple-900/20">
              <p className="text-sm text-purple-200 mb-2">
                {t.chat.freeTierJoinPrompt}
              </p>
              <button
                onClick={() => navigate("/subscribe")}
                className="px-4 py-2 rounded-full text-sm font-semibold bg-gradient-to-r from-purple-500 to-pink-500 text-white active:scale-95 transition-transform"
              >
                {t.chat.freeTierJoinButton}
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
                        {t.chat.labelMain}
                      </span>
                    )}
                    {group.isWallOfFame && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded flex-shrink-0 text-yellow-300" style={{ background: "rgba(255,215,0,0.15)" }}>
                        {t.chat.labelWallOfFame}
                      </span>
                    )}
                    {!group.isPublic && !group.isMain && !group.isWallOfFame && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-pnp-textSecondary flex-shrink-0">
                        {t.chat.labelPrivate}
                      </span>
                    )}
                    {group.hasActiveCall && (
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <span className="relative flex h-1.5 w-1.5">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-pnp-accent opacity-75" />
                          <span className="relative inline-flex rounded-full h-1.5 w-1.5 dot-gradient" />
                        </span>
                        <span className="text-[10px] text-gradient font-semibold">{t.chat.labelLive}</span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs flex-shrink-0 text-pnp-textSecondary">
                      {group.memberCount} {group.memberCount === 1 ? t.chat.membersSingular : t.chat.membersPlural}
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
            {t.chat.discoverGroups}
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
              <p className="text-xs text-pnp-textSecondary px-1">{t.chat.noGroupsToDiscover}</p>
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
                            {t.chat.labelPrivate}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-pnp-textSecondary truncate">
                        {group.memberCount} {group.memberCount === 1 ? t.chat.membersSingular : t.chat.membersPlural}{group.description ? ` \u00b7 ${group.description}` : ""}
                      </p>
                    </div>
                    {isFree ? (
                      <button
                        onClick={() => navigate("/subscribe")}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold flex-shrink-0 border border-purple-500/50 text-purple-300 hover:bg-purple-500/10 active:scale-95 transition-all"
                      >
                        {t.chat.freeTierDiscoverButton}
                      </button>
                    ) : group.isPublic ? (
                      <button
                        onClick={() => handleDiscoverJoin(group)}
                        className="btn-gradient px-3 py-1.5 rounded-lg text-white text-xs font-semibold flex-shrink-0 active:scale-95 transition-transform"
                      >
                        {t.chat.joinButton}
                      </button>
                    ) : group.myRequestStatus === "pending" ? (
                      <span className="text-xs px-3 py-1.5 rounded-lg bg-white/10 text-pnp-textSecondary flex-shrink-0">
                        {t.chat.requestedStatus}
                      </span>
                    ) : (
                      <button
                        onClick={() => handleDiscoverJoin(group)}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold flex-shrink-0 border border-pnp-accent text-pnp-accent hover:bg-pnp-accent/10 active:scale-95 transition-all"
                      >
                        {t.chat.requestButton}
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
          <h2 className="text-sm font-semibold text-pnp-textSecondary mb-3">{t.chat.pendingRequests}</h2>
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
                        <p className="text-xs text-pnp-textSecondary">{t.chat.noPendingRequests}</p>
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
                                {t.chat.accept}
                              </button>
                              <button
                                onClick={() => handleRequest(group.id, req.id, "reject")}
                                className="px-2.5 py-1 rounded text-xs font-semibold text-pnp-textSecondary bg-white/10 hover:bg-white/20 active:scale-95 transition-all"
                              >
                                {t.chat.deny}
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
          <p className="text-sm text-pnp-textPrimary font-medium mb-1">{t.chat.primeUpsellTitle}</p>
          <p className="text-xs text-pnp-textSecondary mb-3">
            {t.chat.primeUpsellBody}
          </p>
          <button
            onClick={() => navigate("/subscribe")}
            className="btn-gradient px-6 py-2 rounded-lg text-white text-sm font-semibold active:scale-95 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent"
          >
            {t.chat.upgradeToPrime}
          </button>
        </div>
      )}
    </div>
  );
}
