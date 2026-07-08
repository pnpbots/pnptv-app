import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
} from "react";
import { createPortal } from "react-dom";
import { Helmet } from "react-helmet-async";
import { useNavigate, useParams } from "react-router-dom";
import { PreJoin, type LocalUserChoices } from "@livekit/components-react";
import "@livekit/components-styles";
import { useAuth } from "@/hooks/useAuth";
import { useTier } from "@/hooks/useTier";
import { useTutorial } from "@/hooks/useTutorial";
import { TutorialOverlay } from "@/components/tutorial/TutorialOverlay";
import { useHangoutSocket } from "@/hooks/useHangoutSocket";
import { useI18n } from "@/lib/i18n";
import {
  getHangoutGroups,
  createHangoutGroup,
  leaveHangoutGroup,
  deleteHangoutGroup,
  markGroupAsRead,
  pinHangoutGroup,
  muteHangoutGroupForUser,
  forwardHangoutMessage,
  joinHangoutGroup,
  discoverHangoutGroups,
  requestJoinGroup,
  getJoinRequests,
  handleJoinRequest,
  getHangoutGroup,
  kickHangoutMember,
  banHangoutMember,
  unbanHangoutMember,
  muteHangoutMember,
  unmuteHangoutMember,
  promoteHangoutMember,
  demoteHangoutMember,
  updateHangoutSettings,
  getHangoutInviteLink,
  updateHangoutNotification,
  updateHangoutGroup,
  uploadGroupAvatar,
  kickGroupMember,
  updateMemberRole,
  transferHangoutOwnership,
  notifyHangoutOnlineMembers,
  getHangoutFeed,
  startHangoutCall,
  joinHangoutCall,
  dropToFeed,
  togglePostLike,
  deleteSocialPost,
  getGroupMessages,
  sendGroupMessage,
  sendGroupMediaMessage,
  editGroupMessage,
  deleteGroupMessage,
  toggleMessageReaction,
  getOwnChannels,
  purchaseChannelAccess,
  purchaseHangoutAccess,
  getDashSubscriptionStatus,
  getUsdcSubscriptionStatus,
  ApiError,
  type HangoutGroup,
  type GroupMessage,
  type GroupMember,
  type DiscoverGroup,
  type JoinRequest,
  type SocialPostItem,
  type MessageReaction,
  type ForwardTarget,
  type ForwardSource,
} from "@/lib/api";
import SocialPostCard from "@/components/social/SocialPostCard";
import { PostComposer } from "@/components/PostComposer";
import { HangoutEventReminder } from "@/components/events/HangoutEventReminder";
import { NearbyBadge } from "@/components/NearbyBadge";
import { SpotlightStrip } from "@/components/SpotlightStrip";
import { getUpcomingEvents, getMainStageState, type MainStageState } from "@/lib/api";
import type { EventItem } from "@/components/events/EventCard";
import { CreateEventModal } from "@/components/events/CreateEventModal";
import { EventDetailModal } from "@/components/events";
import { connectSocket } from "@/lib/socket";
import { MediaMessage } from "@/components/hangouts/MediaMessage";
import { MediaUploadButton } from "@/components/hangouts/MediaUploadButton";
import { UserAvatar } from "@/components/UserAvatar";
import { VideoCallButton } from "@/components/hangouts/VideoCallButton";
import LiveKitCallDock from "@/components/hangouts/LiveKitCallDock";
import { ForwardTargetPicker } from "@/components/forwarding/ForwardTargetPicker";
import { MentionText } from "@/components/MentionText";
import { SharedPostCard } from "@/components/social/SharedPostCard";

type View = "list" | "chat";

// ─── Telegram helpers ────────────────────────────────────────────────────────

function getTelegramDeepLink(inviteLink: string): string {
  // https://t.me/+HASH → tg://join?invite=HASH
  const match = inviteLink.match(/t\.me\/\+(.+)/);
  if (match) return `tg://join?invite=${match[1]}`;
  // Fallback: only allow safe https://t.me/ links — block javascript: and other schemes
  if (/^https:\/\/t\.me\/.+/.test(inviteLink)) return inviteLink;
  return "#";
}

// ─── UX Polish Styles ────────────────────────────────────────────────────────

const UX_STYLES = `
@keyframes reactionBounce {
  0% { transform: scale(1); }
  30% { transform: scale(1.3); }
  60% { transform: scale(0.9); }
  100% { transform: scale(1); }
}
.chat-reaction-pop {
  animation: reactionBounce 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
}
.msg-highlight-glow {
  background: rgba(255, 180, 84, 0.15) !important;
  box-shadow: 0 0 15px rgba(255, 180, 84, 0.25);
  transition: all 0.5s ease;
}
.reply-line-gradient {
  background: linear-gradient(to bottom, #D4007A, #E69138);
}
@keyframes slideUpSheet {
  from { transform: translateY(100%); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}
.context-sheet-enter {
  animation: slideUpSheet 0.22s cubic-bezier(0.32, 0.72, 0, 1);
}
`;

// ─── HangoutChatPanel (PostgreSQL + Socket.IO) ──────────────────────────────

const API_BASE = import.meta.env.VITE_API_URL || "";

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}


function HangoutChatPanel({
  activeGroup,
  isOwnerOrMod,
  groupMembers,
  readReceipts,
  emitReadMessage,
  isConnected,
}: {
  activeGroup: HangoutGroup;
  isOwnerOrMod: boolean;
  groupMembers: any[];
  readReceipts: Record<string, number>;
  emitReadMessage: (messageId: number) => void;
  isConnected: boolean;
}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  // Only use dbId (Telegram numeric ID) — user.id is the Authentik UUID and will
  // never match msg.user_id which is always a Telegram ID.
  const myId = user?.dbId ?? "";
  const groupId = activeGroup.id;
  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [inputText, setInputText] = useState("");
  const [sending, setSending] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaPreview, setMediaPreview] = useState<string | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [typingNames, setTypingNames] = useState<string[]>([]);

  // Enhanced UX state
  const [replyTo, setReplyTo] = useState<GroupMessage | null>(null);
  const [editingMsg, setEditingMsg] = useState<GroupMessage | null>(null);
  const [contextMenu, setContextMenu] = useState<{ msg: GroupMessage; x: number; y: number } | null>(null);
  const [showScrollFab, setShowScrollFab] = useState(false);
  const [unreadBelow, setUnreadBelow] = useState(0);
  const [forwardingMsg, setForwardingMsg] = useState<GroupMessage | null>(null);
  const [shareFeedMsg, setShareFeedMsg] = useState<GroupMessage | null>(null);
  const [shareFeedNote, setShareFeedNote] = useState("");
  const [shareFeedSending, setShareFeedSending] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<GroupMessage | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Inject UX polish styles
  useEffect(() => {
    const style = document.createElement("style");
    style.innerHTML = UX_STYLES;
    document.head.appendChild(style);
    return () => { document.head.removeChild(style); };
  }, []);

  const handleForwardMessage = useCallback(
    async (targets: ForwardTarget[], note?: string) => {
      if (!forwardingMsg) return;
      await forwardHangoutMessage(forwardingMsg.id, targets, note);
      setForwardingMsg(null);
    },
    [forwardingMsg]
  );

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const lastTypingEmit = useRef(0);
  const hasFetched = useRef<number | null>(null);
  const isNearBottom = useRef(true);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const ALLOWED_REACTIONS = ["😈", "❤️", "😆", "🔝", "🐷", "🍆", "🍑", "💨", "🚀"] as const;
  const QUICK_REACTIONS = ALLOWED_REACTIONS;

  const EMOJI_CATEGORIES = [
    { label: "Quick", emojis: ALLOWED_REACTIONS },
    { label: "Faces", emojis: ["😀", "😃", "😄", "😁", "😅", "😂", "🤣", "☺️", "😊", "😇", "🙂", "🙃", "😉", "😌", "😍", "🥰", "😘", "😗", "😙", "😚", "😋", "😛", "😝", "😜", "🤪", "🤨", "🧐", "🤓", "😎", "🤩", "🥳", "😏", "😒", "😞", "😔", "😟", "😕", "🙁", "☹️", "😣", "😖", "😫", "😩", "🥺", "😢", "😭", "😤", "😠", "😡", "🤬", "🤯", "😳", "🥵", "🥶", "😱", "😨", "😰", "😥", "😓", "🤗", "🤔", "🤭", "🤫", "🤥", "😶", "😐", "😑", "😬", "🙄", "😯", "😦", "😧", "😮", "😲", "🥱", "😴", "🤤", "😪", "😵", "🤐", "🥴", "🤢", "🤮", "🤧", "😷", "🤒", "🤕"] },
    { label: "Hands", emojis: ["👋", "🤚", "🖐️", "✋", "🖖", "👌", "🤌", "🤏", "✌️", "🤞", "🤟", "🤘", "🤙", "👈", "👉", "👆", "🖕", "👇", "☝️", "👍", "👎", "✊", "👊", "🤛", "🤜", "👏", "🙌", "👐", "🤲", "🤝", "🙏", "✍️", "💅", "🤳", "💪", "🦾"] },
    { label: "Hearts", emojis: ["❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "🤎", "💔", "❣️", "💕", "💞", "💓", "💗", "💖", "💘", "💝", "💟"] },
    { label: "Random", emojis: ["🔥", "✨", "🌟", "⭐", "🌈", "⚡", "💥", "❄️", "☀️", "🌙", "☁️", "🍎", "🍕", "🍺", "🥂", "☕", "🎮", "🎸", "🏀", "⚽", "🚗", "🚲", "🏙️", "🌍", "📱", "💻", "⌚", "💡", "💰", "💎", "🎁", "🎉", "🎈"] },
  ] as const;

  // Emoji picker state
  const [emojiPickerMsgId, setEmojiPickerMsgId] = useState<number | null>(null);
  const [emojiPickerPos, setEmojiPickerPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Animated reaction state — key is "${msgId}-${emoji}"
  const [recentlyReacted, setRecentlyReacted] = useState<Set<string>>(new Set());
  // Floating-emoji overlays — one per tap, removed after animation ends
  const [floatingReactions, setFloatingReactions] = useState<Array<{ id: string; msgId: number; emoji: string; x?: number; y?: number }>>([]);
  // Reactors bottom sheet
  const [reactorsSheet, setReactorsSheet] = useState<{ emoji: string; users: string[] } | null>(null);
  // Chat toast (inline, replaces alert)
  const [chatToast, setChatToast] = useState<string | null>(null);
  // Double-tap tracking ref
  // Swipe-to-reply tracking ref
  const swipeRef = useRef<{ startX: number; startY: number; startTime: number; msgId: number; el: HTMLDivElement | null; cancelled: boolean } | null>(null);

  // Build memberMap: userId → displayName
  const memberMap = React.useMemo<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    for (const m of groupMembers) {
      const id = String(m.user_id ?? m.userId ?? "");
      const name = m.first_name || m.username || m.name || "User";
      if (id) map[id] = name;
    }
    return map;
  }, [groupMembers]);

  const openEmojiPicker = (msgId: number, x: number, y: number) => {
    setContextMenu(null);
    setEmojiPickerMsgId(msgId);
    // Use visualViewport to account for on-screen keyboard offset
    const vw = window.visualViewport?.width ?? window.innerWidth;
    const vh = window.visualViewport?.height ?? window.innerHeight;
    const PANEL_W = 320;
    const PANEL_H = 380;
    setEmojiPickerPos({
      x: Math.min(x, vw - PANEL_W - 8),
      y: Math.max(8, Math.min(y, vh - PANEL_H - 8)),
    });
  };

  const handleReactionWithAnimation = async (msgId: number, emoji: string, anchor?: { x: number; y: number }) => {
    // Determine if this is an add (not already reacted) before mutating state
    const existingMsg = messages.find(m => m.id === msgId);
    const existingReaction = (existingMsg?.reactions as MessageReaction[] | undefined)?.find(r => r.emoji === emoji);
    const alreadyReacted = existingReaction ? (existingReaction.users || []).map(String).includes(String(myId)) : false;
    const isAdd = !alreadyReacted;
    if (isAdd) {
      const key = `${msgId}-${emoji}`;
      const floatId = `${key}-${Date.now()}`;
      setRecentlyReacted((prev) => new Set(prev).add(key));
      setFloatingReactions((prev) => [...prev, { id: floatId, msgId, emoji, x: anchor?.x, y: anchor?.y }]);
      setTimeout(() => setRecentlyReacted((prev) => { const n = new Set(prev); n.delete(key); return n; }), 600);
      setTimeout(() => setFloatingReactions((prev) => prev.filter((f) => f.id !== floatId)), 700);
      try { (window as any).Telegram?.WebApp?.HapticFeedback?.impactOccurred?.("light"); } catch {}
    }
    await handleReaction(msgId, emoji);
  };

  // Date separator helper
  const formatDateLabel = (dateStr: string): string => {
    const d = new Date(dateStr);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return "Today";
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
    return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  };

  // Message grouping — same user within 2 min
  const isSameGroup = (curr: GroupMessage, prev: GroupMessage | undefined): boolean => {
    if (!prev) return false;
    if (String(curr.user_id) !== String(prev.user_id)) return false;
    if (curr.is_deleted || prev.is_deleted) return false;
    return new Date(curr.created_at).getTime() - new Date(prev.created_at).getTime() < 120000;
  };

  // Fetch messages on group change
  useEffect(() => {
    if (hasFetched.current === groupId) return;
    hasFetched.current = groupId;
    setIsLoading(true);
    setChatError(null);
    getGroupMessages(groupId)
      .then((data) => {
        if (data.success) {
          setMessages(data.messages || []);
          setHasMore((data.messages || []).length >= 30);
        }
      })
      .catch(() => setChatError("Failed to load messages"))
      .finally(() => setIsLoading(false));
  }, [groupId]);

  // Auto-scroll on load
  useEffect(() => {
    if (!isLoading && messages.length > 0) {
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "auto" }), 50);
    }
  }, [isLoading]);

  // Mark the latest visible message as read whenever messages change and the
  // user is at the bottom of the chat (i.e., actually viewing new content).
  useEffect(() => {
    if (messages.length === 0) return;
    if (!isNearBottom.current && !isLoading) return;
    const last = messages[messages.length - 1];
    if (!last?.id) return;
    // Only emit when the last message isn't our own (no point telling ourselves).
    if (String(last.user_id) === String(myId)) return;
    emitReadMessage(Number(last.id));
  }, [messages, isLoading, myId, emitReadMessage]);

  // Socket.IO real-time messages
  useEffect(() => {
    const socket = connectSocket();
    const room = `hangout:${groupId}`;

    const onChatMessage = (msg: GroupMessage) => {
      if (msg.room && msg.room !== room) return;
      setMessages((prev) => prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]);
      if (isNearBottom.current) {
        setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
      } else {
        setUnreadBelow((c) => c + 1);
      }
    };

    const onTyping = (data: { userId: string; firstName?: string; name?: string }) => {
      if (String(data.userId) === String(myId)) return;
      // Server emits `firstName`; fall back to `name` for older payloads
      const displayName = data.firstName || data.name || "Someone";
      setTypingNames((prev) => prev.includes(displayName) ? prev : [...prev, displayName]);
      setTimeout(() => setTypingNames((prev) => prev.filter((n) => n !== displayName)), 3000);
    };

    const onMessageEdited = (data: { messageId: number; content: string; editedAt: string; editCount: number }) => {
      setMessages((prev) => prev.map((m) => m.id === data.messageId ? { ...m, content: data.content, edited_at: data.editedAt, edit_count: data.editCount } : m));
    };

    const onMessageDeleted = (data: { messageId: number }) => {
      setMessages((prev) => prev.map((m) => m.id === data.messageId ? { ...m, is_deleted: true, content: null } : m));
    };

    const onReactionUpdated = (data: { messageId: number; reactions: MessageReaction[] }) => {
      setMessages((prev) => prev.map((m) => m.id === data.messageId ? { ...m, reactions: data.reactions } : m));
    };

    const onHangoutError = (data: { message: string; code?: string }) => {
      setChatError(data.message || "Something went wrong");
    };

    socket.on("chat:message", onChatMessage);
    socket.on("hangout:typing", onTyping);
    socket.on("hangout:message:edited", onMessageEdited);
    socket.on("hangout:message:deleted", onMessageDeleted);
    socket.on("hangout:reaction:updated", onReactionUpdated);
    socket.on("hangout:error", onHangoutError);
    return () => {
      socket.off("chat:message", onChatMessage);
      socket.off("hangout:typing", onTyping);
      socket.off("hangout:message:edited", onMessageEdited);
      socket.off("hangout:message:deleted", onMessageDeleted);
      socket.off("hangout:reaction:updated", onReactionUpdated);
      socket.off("hangout:error", onHangoutError);
      // Clear any pending long-press timer to avoid state updates after unmount
      if (longPressTimer.current) {
        clearTimeout(longPressTimer.current);
        longPressTimer.current = null;
      }
    };
  }, [groupId, myId]);

  // Auto-dismiss chatToast after 2.5s
  useEffect(() => {
    if (!chatToast) return;
    const t = setTimeout(() => setChatToast(null), 2500);
    return () => clearTimeout(t);
  }, [chatToast]);

  const emitTyping = () => {
    const now = Date.now();
    if (now - lastTypingEmit.current < 2000) return;
    lastTypingEmit.current = now;
    connectSocket().emit("hangout:typing", { groupId });
  };

  const handleSend = async () => {
    if (!inputText.trim() && !mediaFile) return;
    if (sending) return;
    setSending(true);
    setChatError(null);
    try {
      if (editingMsg) {
        const editData = await editGroupMessage(groupId, editingMsg.id, inputText.trim());
        if (editData?.message) {
          setMessages((prev) =>
            prev.map((m) => m.id === editData.message.id ? editData.message : m)
          );
        }
        setEditingMsg(null);
      } else if (mediaFile) {
        await sendGroupMediaMessage(groupId, mediaFile, inputText.trim() || undefined);
        setMediaFile(null);
        if (mediaPreview) { URL.revokeObjectURL(mediaPreview); setMediaPreview(null); }
      } else {
        const sendData = await sendGroupMessage(groupId, inputText.trim(), replyTo?.id ?? null);
        if (sendData?.message) {
          setMessages((prev) =>
            prev.some((m) => m.id === sendData.message.id) ? prev : [...prev, sendData.message]
          );
        }
      }
      setInputText("");
      setReplyTo(null);
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    } catch (err) {
      setChatError(err instanceof Error ? err.message : "Failed to send message");
    } finally {
      setSending(false);
    }
  };

  const handleMediaFilePicked = (file: File, previewUrl: string) => {
    setMediaFile(file);
    setMediaPreview(file.type.startsWith("image/") ? previewUrl : null);
  };

  const handleVoiceRecorded = async (blob: Blob, durationSeconds: number) => {
    if (!durationSeconds) return;
    const ext = blob.type.includes("mp4") ? "m4a" : blob.type.includes("ogg") ? "ogg" : "webm";
    const file = new File([blob], `voice-${Date.now()}.${ext}`, { type: blob.type || "audio/webm" });
    setSending(true);
    setChatError(null);
    try {
      await sendGroupMediaMessage(groupId, file);
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    } catch (err) {
      setChatError(err instanceof Error ? err.message : "Failed to send voice note");
    } finally {
      setSending(false);
    }
  };

  const cancelMedia = () => {
    setMediaFile(null);
    if (mediaPreview) { URL.revokeObjectURL(mediaPreview); setMediaPreview(null); }
  };

  const loadMore = async () => {
    if (loadingMore || !hasMore || messages.length === 0) return;
    setLoadingMore(true);
    try {
      const oldest = messages[0];
      const data = await getGroupMessages(groupId, oldest.created_at);
      if (data.success) {
        setMessages((prev) => [...(data.messages || []), ...prev]);
        setHasMore((data.messages || []).length >= 30);
      }
    } catch { /* silent */ }
    finally { setLoadingMore(false); }
  };

  // Scroll tracking
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isNearBottom.current = distFromBottom < 200;
    setShowScrollFab(distFromBottom > 300);
    if (isNearBottom.current) setUnreadBelow(0);
    if (el.scrollTop < 60 && hasMore && !loadingMore) loadMore();
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    setUnreadBelow(0);
    setShowScrollFab(false);
  };

  // Context menu handlers
  const handleContextMenu = (msg: GroupMessage, e: React.MouseEvent) => {
    if (msg.is_deleted) return;
    e.preventDefault();
    setContextMenu({ msg, x: e.clientX, y: e.clientY });
  };

  const handleTouchStart = (msg: GroupMessage, e: React.TouchEvent) => {
    if (msg.is_deleted) return;
    const touch = e.touches[0];
    const now = Date.now();
    // Swipe-to-reply tracking
    swipeRef.current = { startX: touch.clientX, startY: touch.clientY, startTime: now, msgId: msg.id, el: e.currentTarget as HTMLDivElement, cancelled: false };
    // Long-press: 380ms → unified action sheet (reactions + menu)
    longPressTimer.current = setTimeout(() => {
      swipeRef.current = null;
      setContextMenu({ msg, x: touch.clientX, y: touch.clientY });
      try { (window as any).Telegram?.WebApp?.HapticFeedback?.impactOccurred?.("medium"); } catch {}
    }, 380);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!swipeRef.current || swipeRef.current.cancelled) return;
    const touch = e.touches[0];
    const dx = touch.clientX - swipeRef.current.startX;
    const dy = touch.clientY - swipeRef.current.startY;
    // Cancel long-press if clearly moving
    if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
      if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
    }
    // Swipe-right-to-reply: horizontal drag dominant + rightward
    if (dx > 0 && Math.abs(dx) > Math.abs(dy) * 1.5 && swipeRef.current.el) {
      const clampedX = Math.min(dx, 48);
      swipeRef.current.el.style.transform = `translateX(${clampedX}px)`;
      swipeRef.current.el.style.transition = "none";
    }
  };

  const handleTouchEnd = (msg?: GroupMessage) => {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
    if (swipeRef.current && swipeRef.current.el) {
      const el = swipeRef.current.el;
      const startX = swipeRef.current.startX;
      const elapsed = Date.now() - swipeRef.current.startTime;
      const currentX = parseFloat(el.style.transform?.replace("translateX(", "") || "0");
      el.style.transform = "";
      el.style.transition = "transform 0.2s ease";
      setTimeout(() => { if (el) el.style.transition = ""; }, 250);
      // Trigger reply on sufficient swipe
      if (currentX > 44 && elapsed < 500 && msg && !msg.is_deleted) {
        startReply(msg);
        try { (window as any).Telegram?.WebApp?.HapticFeedback?.impactOccurred?.("light"); } catch {}
      }
    }
    swipeRef.current = null;
  };

  // Message actions
  const startReply = (msg: GroupMessage) => {
    setContextMenu(null);
    setEditingMsg(null);
    setReplyTo(msg);
    inputRef.current?.focus();
  };

  const startEdit = (msg: GroupMessage) => {
    setContextMenu(null);
    setReplyTo(null);
    setEditingMsg(msg);
    setInputText(msg.content || "");
    inputRef.current?.focus();
  };

  const cancelEdit = () => {
    setEditingMsg(null);
    setInputText("");
  };

  const handleDeleteMsg = (msg: GroupMessage) => {
    setContextMenu(null);
    setConfirmDelete(msg);
  };

  const handleDeleteConfirm = async (forAll: boolean) => {
    if (!confirmDelete || deleting) return;
    setDeleting(true);
    try {
      await deleteGroupMessage(groupId, confirmDelete.id, forAll);
      setConfirmDelete(null);
    } catch (err) {
      setChatError(err instanceof Error ? err.message : "Failed to delete");
    } finally {
      setDeleting(false);
    }
  };

  const handleReaction = async (msgId: number, emoji: string) => {
    setContextMenu(null);
    const myDbId = String(myId ?? "");
    if (!myDbId) return;
    // Optimistic update — apply immediately, revert on error
    const snapshot = messages;
    setMessages(prev => prev.map(m => {
      if (m.id !== msgId) return m;
      const reactions: MessageReaction[] = Array.isArray(m.reactions) ? (m.reactions as MessageReaction[]).map(r => ({ ...r })) : [];
      const idx = reactions.findIndex(r => r.emoji === emoji);
      if (idx >= 0) {
        const users = (reactions[idx].users || []).map(String);
        if (users.includes(myDbId)) {
          const newUsers = users.filter(u => u !== myDbId);
          if (newUsers.length === 0) reactions.splice(idx, 1);
          else reactions[idx] = { ...reactions[idx], count: newUsers.length, users: newUsers };
        } else {
          reactions[idx] = { ...reactions[idx], count: (reactions[idx].count || 0) + 1, users: [...users, myDbId] };
        }
      } else {
        reactions.push({ emoji, count: 1, users: [myDbId], reacted_by_me: true });
      }
      return { ...m, reactions };
    }));
    try {
      await toggleMessageReaction(groupId, msgId, emoji);
    } catch (err: any) {
      setMessages(snapshot);
      const code = err?.body?.code || err?.code;
      if (code === "REACTION_LIMIT") setChatToast("Maximum emoji reactions reached for this message");
      else if (code === "EMOJI_NOT_ALLOWED") setChatToast("This emoji is not allowed");
      else setChatToast("Could not update reaction — please try again");
    }
  };

  const handleShareToFeed = (msg: GroupMessage) => {
    setContextMenu(null);
    setShareFeedMsg(msg);
    setShareFeedNote("");
  };

  const handleShareFeedConfirm = async () => {
    if (!shareFeedMsg || shareFeedSending) return;
    setShareFeedSending(true);
    try {
      await dropToFeed(groupId, shareFeedMsg.id, shareFeedNote.trim() || undefined);
      setShareFeedMsg(null);
      setChatToast("Shared to feed!");
    } catch {
      setChatToast("Could not share to feed. Try again.");
      setShareFeedMsg(null);
    } finally {
      setShareFeedSending(false);
    }
  };

  const isValidPhoto = (p: string | null | undefined) => p && (p.startsWith("/") || p.startsWith("http"));

  return (
    <div className="flex flex-col h-full relative">
      {/* Offline banner */}
      {!isConnected && (
        <div className="flex items-center justify-center gap-2 bg-amber-500/10 border-b border-amber-500/30 py-1.5 px-3 text-xs text-amber-300 flex-shrink-0">
          <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse flex-shrink-0" />
          <span>Reconnecting to chat…</span>
        </div>
      )}
      {chatError && (
        <div className="px-4 py-2 bg-red-500/10 border-b border-red-500/20 flex-shrink-0 flex items-center justify-between gap-2">
          <p className="text-xs text-red-400 flex-1">{chatError}</p>
          <button onClick={() => setChatError(null)} className="text-red-400/60 hover:text-red-400 flex-shrink-0 p-1">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
      )}
      {/* Inline toast for reaction errors */}
      {chatToast && (
        <div className="absolute bottom-28 left-1/2 -translate-x-1/2 z-[100] px-4 py-2 rounded-xl text-xs text-white shadow-xl pointer-events-none" style={{ background: "rgba(30,30,32,0.95)", border: "1px solid rgba(255,255,255,0.12)" }}>
          {chatToast}
        </div>
      )}

      {/* Messages */}
      <div
        ref={scrollContainerRef}
        className="flex-1 min-h-0 overflow-y-auto px-3 py-2 space-y-0.5"
        onScroll={handleScroll}
      >
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <div className="w-8 h-8 border-2 border-white/20 border-t-pnp-accent rounded-full animate-spin" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center px-6">
              <p className="text-3xl mb-2">💬</p>
              <p className="text-sm text-pnp-textSecondary">No messages yet. Start the conversation!</p>
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
              const prev = idx > 0 ? messages[idx - 1] : undefined;
              const isMe = String(msg.user_id) === String(myId);
              const timeStr = formatTime(new Date(msg.created_at).getTime());
              const grouped = isSameGroup(msg, prev);
              const showDate = !prev || new Date(msg.created_at).toDateString() !== new Date(prev.created_at).toDateString();

              return (
                <React.Fragment key={msg.id}>
                  {/* Date separator */}
                  {showDate && (
                    <div className="flex items-center justify-center py-2 my-1">
                      <span className="px-3 py-0.5 rounded-full text-[10px] font-semibold text-pnp-textSecondary bg-white/5">
                        {formatDateLabel(msg.created_at)}
                      </span>
                    </div>
                  )}

                  {msg.is_deleted ? (
                    <div className={`flex ${isMe ? "flex-row-reverse" : "flex-row"} ${grouped ? "" : "mt-2"} px-2`}>
                      <span className="text-[11px] italic text-pnp-textSecondary/40 flex items-center gap-1">
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728L5.636 5.636m12.728 12.728L18.364 18.364" />
                        </svg>
                        Message deleted
                      </span>
                    </div>
                  ) : (
                    <div
                      id={`msg-${msg.id}`}
                      className={`flex gap-2 ${isMe ? "flex-row-reverse" : "flex-row"} ${grouped ? "" : "mt-2"} group/msg`}
                      onContextMenu={(e) => handleContextMenu(msg, e)}
                      onTouchStart={(e) => handleTouchStart(msg, e)}
                      onTouchEnd={() => handleTouchEnd(msg)}
                      onTouchMove={handleTouchMove}
                    >
                      {/* Avatar — only for first message in group, linked to profile */}
                      {!isMe && (
                        <div className="flex-shrink-0 mt-auto w-6">
                          {!grouped ? (
                            <UserAvatar
                              userId={msg.user_id}
                              photoUrl={msg.photo_url}
                              displayName={msg.first_name || msg.username}
                              size="xs"
                            />
                          ) : null}
                        </div>
                      )}
                      <div className={`max-w-[80%] sm:max-w-[75%] flex flex-col ${isMe ? "items-end" : "items-start"}`}>
                        {/* Name — only for first in group, linked to profile */}
                        {!isMe && !grouped && (
                          <p className="text-[10px] text-pnp-textSecondary mb-0.5 px-1 cursor-pointer hover:text-pnp-accent transition-colors" onClick={() => navigate(`/profile/${msg.user_id}`)}>{msg.first_name || msg.username || "User"}</p>
                        )}
                        <div
                          className={`rounded-2xl px-3 py-2 text-sm ${isMe ? "text-white rounded-br-md" : "bg-white/10 text-white rounded-bl-md"}`}
                          style={isMe ? { background: "linear-gradient(135deg, #D4007A, #E69138)", overflowWrap: "anywhere" as const } : { overflowWrap: "anywhere" as const }}
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
                          {msg.reply_to && (
                            <div
                              className="mb-1.5 pl-2.5 py-0.5 border-l-[3px] border-transparent relative cursor-pointer hover:bg-white/5 transition-all group/reply rounded-r-md overflow-hidden flex gap-1.5 items-center"
                              onClick={() => {
                                const target = document.getElementById(`msg-${msg.reply_to_id}`);
                                if (target) {
                                  target.scrollIntoView({ behavior: "smooth", block: "center" });
                                  target.classList.add("msg-highlight-glow", "rounded-2xl");
                                  setTimeout(() => target.classList.remove("msg-highlight-glow", "rounded-2xl"), 1500);
                                }
                              }}
                            >
                              <div className="absolute inset-y-0 left-0 w-[3px] rounded-full reply-line-gradient" />
                              <div className="flex-1 min-w-0">
                                <p className="font-bold text-[11px] leading-tight text-pnp-accent/90 group-hover/reply:text-pnp-accent">{msg.reply_to.name}</p>
                                <p className="text-[10px] leading-snug text-white/50 line-clamp-1 group-hover/reply:text-white/70">{msg.reply_to.content?.slice(0, 80)}</p>
                              </div>
                              {(msg.reply_to.mediaThumbUrl || (msg.reply_to.mediaType === "image" && msg.reply_to.mediaUrl)) && (
                                <img
                                  src={msg.reply_to.mediaThumbUrl || msg.reply_to.mediaUrl!}
                                  alt=""
                                  className="w-8 h-8 rounded object-cover flex-shrink-0 opacity-80"
                                />
                              )}
                              {msg.reply_to.mediaType === "video" && !msg.reply_to.mediaThumbUrl && !msg.reply_to.mediaUrl && (
                                <span className="w-8 h-8 rounded bg-white/10 flex-shrink-0 flex items-center justify-center text-[10px]">🎥</span>
                              )}
                              {msg.reply_to.mediaType === "audio" && (
                                <span className="w-8 h-8 rounded bg-white/10 flex-shrink-0 flex items-center justify-center text-[10px]">🎤</span>
                              )}
                            </div>
                          )}
                          {msg.message_type === "post_card" && msg.meta?.kind === "forward" ? (() => {
                            const src: ForwardSource = msg.meta.source || ({} as ForwardSource);
                            const author = src.authorUsername
                              ? `@${src.authorUsername}`
                              : (src.authorFirstName || "User");
                            const authorPath = src.authorUsername ? `/profile/${src.authorUsername}` : null;
                            const srcText = typeof src.text === "string" ? src.text : "";
                            const noteText = typeof msg.meta.note === "string" ? msg.meta.note : "";
                            const thumb = src.mediaThumbUrl
                              || (src.mediaType === "image" || src.mediaType === "video" ? src.mediaUrl : null);
                            const isVideo = src.mediaType === "video";
                            const hasThumb = !!thumb;
                            return (
                              <>
                                {noteText && (
                                  <p className="mb-1.5">
                                    <MentionText text={noteText} />
                                  </p>
                                )}
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
                                        <MentionText text={srcText} />
                                      </div>
                                    )}
                                    {!srcText && !hasThumb && src.mediaType === "audio" && (
                                      <p className={`text-xs mt-0.5 ${isMe ? "text-white/70" : "text-white/60"}`}>🎤 Voice message</p>
                                    )}
                                  </div>
                                </div>
                              </>
                            );
                          })() : msg.message_type === "post_card" && msg.meta?.postId ? (
                            <SharedPostCard postId={msg.meta.postId} snapshot={msg.meta.snapshot || {}} isMe={isMe} />
                          ) : msg.content && <p><MentionText text={msg.content} /></p>}
                          <div className={`flex items-center gap-1 mt-0.5 ${isMe ? "justify-end" : ""}`}>
                            <span className={`text-[10px] ${isMe ? "text-white/60" : "text-pnp-textSecondary"}`}>{timeStr}</span>
                            {msg.edited_at && (
                              <span
                                className={`text-[10px] ${isMe ? "text-white/40" : "text-pnp-textSecondary/60"}`}
                                title={msg.edit_count && msg.edit_count > 1 ? `Edited ${msg.edit_count} times · ${new Date(msg.edited_at).toLocaleString()}` : `Edited · ${new Date(msg.edited_at).toLocaleString()}`}
                              >
                                edited{msg.edit_count && msg.edit_count > 1 ? ` ·${msg.edit_count}×` : ""}
                              </span>
                            )}
                            {isMe && !msg.is_deleted && (() => {
                              let readByOther = false;
                              for (const uid in readReceipts) {
                                if (String(uid) === String(myId)) continue;
                                if (readReceipts[uid] >= Number(msg.id)) { readByOther = true; break; }
                              }
                              return (
                                <span
                                  className="text-[11px] leading-none ml-0.5"
                                  style={{ color: readByOther ? "#4FC3F7" : "rgba(255,255,255,0.5)" }}
                                  title={readByOther ? "Read" : "Sent"}
                                  aria-label={readByOther ? "Read" : "Sent"}
                                >
                                  {readByOther ? "✓✓" : "✓"}
                                </span>
                              );
                            })()}
                          </div>
                        </div>

                        {/* Reactions display */}
                        {msg.reactions && (msg.reactions as MessageReaction[]).length > 0 && (
                          <div className="relative flex flex-wrap gap-1 mt-1 px-1">
                            {(msg.reactions as MessageReaction[]).map((r) => {
                              const isReacted = myId && Array.isArray(r.users) && r.users.map(String).includes(String(myId));
                              const reactorNames = (r.users || [])
                                .map((uid: string) => memberMap[String(uid)] || "User")
                                .filter(Boolean);
                              const tooltipText = reactorNames.length <= 3
                                ? reactorNames.join(", ")
                                : `${reactorNames.slice(0, 3).join(", ")} and ${reactorNames.length - 3} more`;
                              const animKey = `${msg.id}-${r.emoji}`;
                              return (
                                <div key={r.emoji} className="relative group/rxn">
                                  <button
                                    onClick={(e) => {
                                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                      handleReactionWithAnimation(msg.id, r.emoji, { x: rect.left + rect.width / 2, y: rect.top });
                                    }}
                                    onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setReactorsSheet({ emoji: r.emoji, users: r.users || [] }); }}
                                    aria-pressed={isReacted ? "true" : "false"}
                                    aria-label={`${r.emoji} ${r.count} reaction${r.count !== 1 ? "s" : ""}`}
                                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs transition-all active:scale-90 focus-visible:ring-2 focus-visible:ring-pnp-accent focus-visible:outline-none backdrop-blur-md ${
                                      recentlyReacted.has(animKey) ? "chat-reaction-pop" : ""
                                    } ${
                                      isReacted
                                        ? "ring-1 ring-pnp-accent/60 shadow-[0_2px_10px_-2px_rgba(212,0,122,0.4)] border-white/10"
                                        : "bg-white/[0.08] hover:bg-white/[0.12] ring-1 ring-white/10"
                                    }`}
                                    style={isReacted ? { background: "linear-gradient(135deg, rgba(212,0,122,0.3), rgba(230,145,56,0.25))" } : undefined}
                                  >
                                    <span className="leading-none text-[14px]">{r.emoji}</span>
                                    <span className={`text-[11px] tabular-nums font-bold ${isReacted ? "text-white" : "text-pnp-textSecondary"}`}>{r.count}</span>
                                  </button>
                                  {reactorNames.length > 0 && (
                                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover/rxn:block z-50 pointer-events-none animate-fade-in">
                                      <div
                                        className="rounded-xl px-2.5 py-1.5 text-[11px] text-white whitespace-nowrap shadow-2xl backdrop-blur-xl border border-white/10"
                                        style={{ background: "rgba(28,28,30,0.95)", maxWidth: "200px", whiteSpace: "normal", textAlign: "center" }}
                                      >
                                        {tooltipText}
                                      </div>
                                      <div className="w-2.5 h-2.5 rotate-45 mx-auto -mt-1.5 border-r border-b border-white/10" style={{ background: "rgba(28,28,30,0.95)" }} />
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                            {/* "+" add-reaction chip */}
                            <button
                              onClick={(e) => { e.stopPropagation(); openEmojiPicker(msg.id, e.clientX, e.clientY); }}
                              aria-label="Add reaction"
                              className="flex items-center justify-center w-8 h-[26px] rounded-full bg-white/[0.06] hover:bg-white/[0.12] ring-1 ring-white/10 text-pnp-textSecondary text-sm transition-all active:scale-90 backdrop-blur-md"
                            >+</button>
                          </div>
                        )}

                      </div>
                      {/* Admin: direct trash on others' messages (hover) */}
                      {isOwnerOrMod && !isMe && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDeleteMsg(msg); }}
                          aria-label="Delete message (admin)"
                          title="Delete message (admin)"
                          className="hidden group-hover/msg:flex self-center flex-shrink-0 w-7 h-7 items-center justify-center rounded-full bg-red-500/10 hover:bg-red-500/25 ring-1 ring-red-500/30 text-red-400 active:scale-90 transition-all backdrop-blur-md ml-1"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        </button>
                      )}
                      {/* Desktop hover kebab — opens unified action sheet */}
                      <button
                        onClick={(e) => { e.stopPropagation(); setContextMenu({ msg, x: e.clientX, y: e.clientY }); }}
                        aria-label="Message actions"
                        className={`hidden group-hover/msg:flex self-center flex-shrink-0 w-7 h-7 items-center justify-center rounded-full bg-pnp-surface/80 hover:bg-white/10 ring-1 ring-white/10 text-pnp-textSecondary active:scale-90 transition-all backdrop-blur-md ${isMe ? "mr-1" : "ml-1"}`}
                      >
                        <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20"><path d="M10 3a1.5 1.5 0 110 3 1.5 1.5 0 010-3zm0 5.5a1.5 1.5 0 110 3 1.5 1.5 0 010-3zM10 14a1.5 1.5 0 110 3 1.5 1.5 0 010-3z"/></svg>
                      </button>
                    </div>
                  )}
                </React.Fragment>
              );
            })}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Scroll-to-bottom FAB */}
      {showScrollFab && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-24 right-3 w-10 h-10 rounded-full bg-pnp-surface border border-pnp-border shadow-lg flex items-center justify-center hover:bg-white/15 active:scale-90 transition-all z-20"
          aria-label="Scroll to bottom"
        >
          <svg className="w-5 h-5 text-pnp-textSecondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>
          {unreadBelow > 0 && (
            <span
              className="absolute -top-1.5 -right-1 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold text-white flex items-center justify-center"
              style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
            >
              {unreadBelow > 99 ? "99+" : unreadBelow}
            </span>
          )}
        </button>
      )}

      {/* Context menu — bottom sheet on mobile, floating popup on desktop */}
      {contextMenu && (() => {
        const useMobileSheet = window.innerWidth < 640;
        const cmsg = contextMenu.msg;
        const isMine = String(cmsg.user_id) === String(myId);
        const canMod = isOwnerOrMod && !isMine;
        const menuItems = (py: string) => (
          <>
            {cmsg.media_url && (
              <button onClick={() => handleShareToFeed(cmsg)} className={`w-full px-5 ${py} text-[15px] text-left text-white active:bg-white/10 hover:bg-white/10 transition-colors flex items-center gap-3`}>
                <svg className="w-5 h-5 text-pnp-textSecondary flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z" />
                </svg>
                Share to Feed
              </button>
            )}
            <button onClick={() => startReply(cmsg)} className={`w-full px-5 ${py} text-[15px] text-left text-white active:bg-white/10 hover:bg-white/10 transition-colors flex items-center gap-3`}>
              <svg className="w-5 h-5 text-pnp-textSecondary flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
              </svg>
              Reply
            </button>
            <button onClick={() => { setContextMenu(null); setForwardingMsg(cmsg); }} className={`w-full px-5 ${py} text-[15px] text-left text-white active:bg-white/10 hover:bg-white/10 transition-colors flex items-center gap-3`}>
              <svg className="w-5 h-5 text-pnp-textSecondary flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 17l5-5-5-5M4 18v-2a4 4 0 014-4h12" />
              </svg>
              Forward
            </button>
            {isMine && (
              <>
                <button onClick={() => startEdit(cmsg)} className={`w-full px-5 ${py} text-[15px] text-left text-white active:bg-white/10 hover:bg-white/10 transition-colors flex items-center gap-3`}>
                  <svg className="w-5 h-5 text-pnp-textSecondary flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
                  </svg>
                  Edit
                </button>
                <div className="border-t border-white/8" />
                <button onClick={() => handleDeleteMsg(cmsg)} className={`w-full px-5 ${py} text-[15px] text-left text-red-400 active:bg-white/10 hover:bg-white/10 transition-colors flex items-center gap-3`}>
                  <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  Delete
                </button>
              </>
            )}
            {canMod && (
              <>
                <div className="border-t border-white/8" />
                <button onClick={() => handleDeleteMsg(cmsg)} className={`w-full px-5 ${py} text-[15px] text-left text-red-400 active:bg-white/10 hover:bg-white/10 transition-colors flex items-center gap-3`}>
                  <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  Delete (mod)
                </button>
              </>
            )}
          </>
        );
        const reactionRow = (size: string) => (
          <div className={`flex items-center gap-0.5 px-2 py-2 border-b border-white/8 overflow-x-auto scrollbar-hide`}>
            {QUICK_REACTIONS.map((emoji) => (
              <button key={emoji} onClick={() => { handleReactionWithAnimation(cmsg.id, emoji); setContextMenu(null); }} aria-label={`React ${emoji}`}
                className={`flex-shrink-0 ${size} flex items-center justify-center rounded-full hover:bg-white/10 active:scale-90 transition-all text-xl`}>{emoji}</button>
            ))}
            <button onClick={(e) => { e.stopPropagation(); openEmojiPicker(cmsg.id, e.clientX, e.clientY); }} aria-label="More emojis"
              className={`flex-shrink-0 ${size} flex items-center justify-center rounded-full hover:bg-white/10 active:scale-90 transition-all text-sm text-pnp-textSecondary font-bold`}>+</button>
          </div>
        );
        if (useMobileSheet) {
          return (
            <>
              <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" onClick={() => setContextMenu(null)} />
              <div className="fixed bottom-0 inset-x-0 z-50 context-sheet-enter" style={{ background: "var(--pnp-surface)", borderTopLeftRadius: 20, borderTopRightRadius: 20, border: "1px solid rgba(255,255,255,0.1)", paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
                <div className="flex justify-center pt-2.5 pb-1">
                  <div className="w-10 h-1 rounded-full bg-white/20" />
                </div>
                {cmsg.content && (
                  <p className="px-5 pb-2 text-[12px] text-white/40 line-clamp-2 leading-snug">{cmsg.content.slice(0, 100)}</p>
                )}
                {reactionRow("w-10 h-10")}
                {menuItems("py-4")}
                <div className="border-t border-white/8" />
                <button onClick={() => setContextMenu(null)} className="w-full px-5 py-4 text-[15px] font-semibold text-white/60 active:bg-white/10 transition-colors">
                  Cancel
                </button>
              </div>
            </>
          );
        }
        return (
          <>
            <div className="fixed inset-0 z-50" onClick={() => setContextMenu(null)} />
            <div className="fixed z-50 rounded-xl overflow-hidden shadow-xl py-1 min-w-[180px] animate-fade-in-up"
              style={{ background: "var(--pnp-surface-hover)", border: "1px solid rgba(255,255,255,0.1)", left: Math.max(8, Math.min(contextMenu.x, window.innerWidth - 200)), top: Math.max(60, Math.min(contextMenu.y, window.innerHeight - 380)) }}>
              {reactionRow("w-8 h-8")}
              {menuItems("py-2.5")}
            </div>
          </>
        );
      })()}

      {/* Full emoji picker */}
      {emojiPickerMsgId !== null && (
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => setEmojiPickerMsgId(null)} />
          <div
            className="fixed z-[61] rounded-2xl shadow-2xl overflow-hidden"
            style={{
              left: emojiPickerPos.x,
              top: emojiPickerPos.y,
              width: 320,
              background: "var(--pnp-surface)",
              border: "1px solid rgba(255,255,255,0.12)",
            }}
          >
            <div className="flex items-center justify-between px-3 pt-2.5 pb-1">
              <p className="text-[11px] font-semibold text-pnp-textSecondary uppercase tracking-wider">Reactions</p>
              <button
                onClick={() => setEmojiPickerMsgId(null)}
                className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-white/10 text-pnp-textSecondary transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="overflow-y-auto" style={{ maxHeight: 350 }}>
              {EMOJI_CATEGORIES.map((cat) => (
                <div key={cat.label} className="px-2 pb-2">
                  <p className="text-[10px] font-semibold text-pnp-textSecondary/60 px-1 pt-1.5 pb-1 uppercase tracking-wider">{cat.label}</p>
                  <div className="flex flex-wrap gap-0.5">
                    {cat.emojis.map((emoji) => (
                      <button
                        key={emoji}
                        onClick={() => {
                          handleReactionWithAnimation(emojiPickerMsgId!, emoji);
                          setEmojiPickerMsgId(null);
                        }}
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

      {/* Reactors bottom sheet */}
      {reactorsSheet && createPortal(
        <>
          <div className="fixed inset-0 z-[80] bg-black/50" onClick={() => setReactorsSheet(null)} />
          <div className="fixed bottom-0 left-0 right-0 z-[81] rounded-t-2xl shadow-2xl max-h-[60vh] flex flex-col overflow-hidden" style={{ background: "var(--pnp-surface)", border: "1px solid rgba(255,255,255,0.1)" }}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
              <p className="text-sm font-semibold text-white">{reactorsSheet.emoji} {reactorsSheet.users.length} reaction{reactorsSheet.users.length !== 1 ? "s" : ""}</p>
              <button onClick={() => setReactorsSheet(null)} className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-white/10 text-pnp-textSecondary" aria-label="Close">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="overflow-y-auto py-2 px-4 space-y-1">
              {reactorsSheet.users.map((uid) => {
                const name = memberMap[String(uid)] || messages.find(m => String(m.user_id) === String(uid))?.first_name || "Member";
                return (
                  <div key={uid} className="flex items-center gap-3 py-2">
                    <UserAvatar
                      userId={String(uid)}
                      photoUrl={null}
                      displayName={name}
                      size="sm"
                    />
                    <span className="text-sm text-white">{name}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </>,
        document.body
      )}

      {/* Portal-based floating emoji overlays */}
      {floatingReactions.length > 0 && createPortal(
        <>
          {floatingReactions.map((f) => (
            <span
              key={f.id}
              className="chat-reaction-float pointer-events-none text-2xl"
              aria-hidden="true"
              style={f.x != null ? { position: "fixed", left: f.x, top: f.y ?? 0, transform: "translateX(-50%)", zIndex: 9999 } : { position: "fixed", left: "50%", top: "50%", transform: "translateX(-50%)", zIndex: 9999 }}
            >
              {f.emoji}
            </span>
          ))}
        </>,
        document.body
      )}

      {/* Typing indicator */}
      {typingNames.length > 0 && (
        <div className="px-4 py-1 flex-shrink-0 flex items-center gap-1">
          <span className="text-xs text-pnp-textSecondary italic">{typingNames.join(", ")} {typingNames.length === 1 ? "is" : "are"} typing</span>
          <span className="inline-flex items-end gap-px ml-0.5 mb-0.5">
            <span className="w-1 h-1 rounded-full bg-pnp-textSecondary" style={{ animation: "typingDot 1.2s infinite 0ms" }} />
            <span className="w-1 h-1 rounded-full bg-pnp-textSecondary" style={{ animation: "typingDot 1.2s infinite 200ms" }} />
            <span className="w-1 h-1 rounded-full bg-pnp-textSecondary" style={{ animation: "typingDot 1.2s infinite 400ms" }} />
          </span>
        </div>
      )}

      {/* Reply bar */}
      {replyTo && !editingMsg && (
        <div className="px-3 py-2 border-t border-pnp-border flex items-center gap-2.5 flex-shrink-0 bg-white/[0.03] backdrop-blur-xl animate-fade-in-up">
          <div className="w-[3px] h-9 rounded-full flex-shrink-0 reply-line-gradient" />
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-bold text-pnp-accent uppercase tracking-tight">{replyTo.first_name || replyTo.username || "User"}</p>
            <p className="text-xs text-white/50 truncate leading-relaxed">
              {replyTo.content?.slice(0, 80) || (replyTo.media_type === "image" ? "📷 Photo" : replyTo.media_type === "video" ? "🎥 Video" : replyTo.media_type === "audio" ? "🎤 Voice" : "Media")}
            </p>
          </div>
          {replyTo.media_thumb_url && (
            <img src={replyTo.media_thumb_url} alt="" className="w-9 h-9 rounded-md object-cover flex-shrink-0 opacity-80" />
          )}
          {!replyTo.media_thumb_url && replyTo.media_type === "image" && replyTo.media_url && (
            <img src={replyTo.media_url} alt="" className="w-9 h-9 rounded-md object-cover flex-shrink-0 opacity-80" />
          )}
          <button onClick={() => setReplyTo(null)} className="w-8 h-8 rounded-full flex items-center justify-center text-pnp-textSecondary hover:text-white hover:bg-white/10 transition-all active:scale-90 flex-shrink-0" aria-label="Cancel reply">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
      )}

      {/* Edit bar */}
      {editingMsg && (() => {
        const createdMs = new Date(editingMsg.created_at).getTime();
        const remainingMs = Math.max(0, 48 * 3600 * 1000 - (Date.now() - createdMs));
        const hoursLeft = Math.floor(remainingMs / 3600000);
        const minutesLeft = Math.floor((remainingMs % 3600000) / 60000);
        const timeLeftLabel = hoursLeft >= 1 ? `${hoursLeft}h ${minutesLeft}m left` : `${minutesLeft}m left`;
        return (
          <div className="px-3 py-2.5 border-t border-pnp-border flex items-center gap-3 flex-shrink-0 bg-blue-500/[0.04] backdrop-blur-xl animate-fade-in-up">
            <div className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center bg-blue-500/15 text-blue-400">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <p className="text-[11px] font-bold text-blue-400 uppercase tracking-tight">Editing message</p>
                <span className="text-[10px] text-white/30 tabular-nums" title="Edit window is 48 hours from send time">· {timeLeftLabel}</span>
                {editingMsg.edit_count && editingMsg.edit_count > 0 && (
                  <span className="text-[10px] text-white/30 tabular-nums">· {editingMsg.edit_count}×</span>
                )}
              </div>
              <p className="text-xs text-white/50 truncate leading-relaxed">{editingMsg.content?.slice(0, 80)}</p>
            </div>
            <button onClick={cancelEdit} className="w-8 h-8 rounded-full flex items-center justify-center text-pnp-textSecondary hover:text-white hover:bg-white/10 transition-all active:scale-90 flex-shrink-0" aria-label="Cancel edit (Esc)" title="Cancel edit (Esc)">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        );
      })()}

      {/* Media preview */}
      {mediaFile && !editingMsg && (
        <div className="px-3 py-2 border-t border-pnp-border flex items-center gap-3 flex-shrink-0">
          {mediaPreview ? <img src={mediaPreview} alt="" className="w-12 h-12 rounded-lg object-cover" /> : (
            <div className="w-12 h-12 rounded-lg bg-white/10 flex items-center justify-center">
              <svg className="w-5 h-5 text-pnp-textSecondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
              </svg>
            </div>
          )}
          <span className="text-xs text-pnp-textSecondary flex-1 truncate">{mediaFile.name}</span>
          <button onClick={cancelMedia} className="text-red-400 text-xs font-semibold">Remove</button>
        </div>
      )}

      {/* Input bar */}
      <div className="flex items-end gap-1.5 px-2 py-1.5 border-t border-pnp-border flex-shrink-0 bg-pnp-background">
        {!editingMsg && (
          <div className="flex items-end gap-1 mb-0.5">
            <MediaUploadButton
              onFileSelect={handleMediaFilePicked}
              onError={(msg) => setChatError(msg)}
              onVoiceRecord={handleVoiceRecorded}
              disabled={sending}
            />
          </div>
        )}
        <textarea
          ref={(el) => {
            inputRef.current = el;
            if (el) {
              el.style.height = "auto";
              el.style.height = Math.min(el.scrollHeight, 120) + "px";
            }
          }}
          value={inputText}
          onChange={(e) => {
            setInputText(e.target.value);
            if (!editingMsg) emitTyping();
            const el = e.target;
            el.style.height = "auto";
            el.style.height = Math.min(el.scrollHeight, 120) + "px";
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
            if (e.key === "Escape" && editingMsg) cancelEdit();
            if (e.key === "Escape" && replyTo) setReplyTo(null);
          }}
          placeholder={editingMsg ? "Edit message..." : "Type a message..."}
          className="flex-1 bg-white/5 text-white placeholder-pnp-textSecondary/50 rounded-2xl px-4 py-2 resize-none outline-none focus:ring-1 focus:ring-pnp-accent/40 transition-shadow leading-snug"
          rows={1}
          style={{ fontSize: "16px", minHeight: "40px", maxHeight: "120px" }}
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={sending || (!inputText.trim() && !mediaFile)}
          className="w-10 h-10 flex items-center justify-center rounded-full text-white active:scale-90 transition-all flex-shrink-0 disabled:opacity-30 mb-0.5"
          style={{ background: editingMsg ? "#3B82F6" : "linear-gradient(135deg, #D4007A, #E69138)" }}
          aria-label={editingMsg ? "Save edit" : "Send message"}
        >
          {sending ? (
            <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
          ) : editingMsg ? (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
          ) : (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" /></svg>
          )}
        </button>
      </div>

      {/* Lightbox */}
      {lightboxUrl && (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4 pt-safe pb-safe" onClick={() => setLightboxUrl(null)}>
          <button className="absolute top-4 right-4 mt-safe w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-white hover:bg-white/20 transition-colors z-10" onClick={() => setLightboxUrl(null)} aria-label="Close">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
          <img src={lightboxUrl} alt="" className="max-w-full max-h-full object-contain rounded-lg" />
        </div>
      )}

      {/* Forward target picker — reusable picker for DM + hangout destinations */}
      <ForwardTargetPicker
        isOpen={!!forwardingMsg}
        onClose={() => setForwardingMsg(null)}
        onForward={handleForwardMessage}
        title="Forward message"
        sourcePreview={forwardingMsg ? {
          authorName: forwardingMsg.first_name || forwardingMsg.username || "User",
          authorPhoto: forwardingMsg.photo_url || null,
          text: forwardingMsg.content || null,
          mediaUrl: forwardingMsg.media_url || null,
          mediaType: forwardingMsg.media_type || null,
          mediaThumbUrl: forwardingMsg.media_thumb_url || null,
        } : undefined}
      />

      {/* Share to Feed sheet — preview + comment before posting */}
      {shareFeedMsg && (
        <div
          className="fixed inset-0 z-[70] flex items-end justify-center"
          style={{ background: "rgba(0,0,0,0.65)", backdropFilter: "blur(6px)" }}
          onClick={() => !shareFeedSending && setShareFeedMsg(null)}
        >
          <div
            className="w-full max-w-lg rounded-t-2xl p-5 pb-8 space-y-3"
            style={{ background: "var(--pnp-surface)", border: "1px solid rgba(255,255,255,0.08)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-center mb-1" aria-hidden="true">
              <div className="w-10 h-1 rounded-full" style={{ background: "rgba(255,255,255,0.15)" }} />
            </div>
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-white">Share to Feed</h2>
              <button
                type="button"
                onClick={() => setShareFeedMsg(null)}
                disabled={shareFeedSending}
                className="w-7 h-7 rounded-full flex items-center justify-center hover:opacity-80 disabled:opacity-40"
                style={{ background: "rgba(255,255,255,0.08)" }}
                aria-label="Cancel"
              >
                <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            {/* Message preview */}
            <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.10)", background: "rgba(255,255,255,0.04)" }}>
              {shareFeedMsg.media_url && shareFeedMsg.media_type && (
                <div className="relative w-full bg-black/40" style={{ aspectRatio: "16/9" }}>
                  {shareFeedMsg.media_type === "video" ? (
                    <video src={shareFeedMsg.media_url} className="w-full h-full object-cover" muted playsInline preload="metadata" />
                  ) : shareFeedMsg.media_type === "image" ? (
                    <img src={shareFeedMsg.media_thumb_url || shareFeedMsg.media_url} alt="" className="w-full h-full object-cover" />
                  ) : null}
                  {shareFeedMsg.media_type === "video" && (
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <div className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: "rgba(0,0,0,0.55)" }}>
                        <svg className="w-4 h-4 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                      </div>
                    </div>
                  )}
                </div>
              )}
              <div className="px-3 py-2.5">
                <p className="text-[11px] font-semibold text-pnp-accent">{shareFeedMsg.first_name || shareFeedMsg.username || "User"}</p>
                {shareFeedMsg.content && (
                  <p className="text-sm text-white/80 line-clamp-3 mt-0.5">{shareFeedMsg.content}</p>
                )}
                {!shareFeedMsg.content && shareFeedMsg.media_type && (
                  <p className="text-sm text-white/50 mt-0.5 italic">
                    {shareFeedMsg.media_type === "image" ? "📷 Photo" : shareFeedMsg.media_type === "video" ? "🎥 Video" : "🎤 Audio"}
                  </p>
                )}
              </div>
            </div>

            {/* Comment input */}
            <div>
              <textarea
                value={shareFeedNote}
                onChange={(e) => setShareFeedNote(e.target.value.slice(0, 500))}
                rows={3}
                placeholder="Add your comment… (optional)"
                className="w-full text-sm text-white rounded-xl px-3 py-2.5 outline-none resize-none focus:border-pnp-accent/50 transition-colors"
                style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.10)" }}
                autoFocus
                disabled={shareFeedSending}
              />
              <p className="text-[10px] text-right mt-0.5" style={{ color: "#555" }}>{shareFeedNote.length}/500</p>
            </div>

            <button
              type="button"
              onClick={handleShareFeedConfirm}
              disabled={shareFeedSending}
              className="w-full py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-40 disabled:cursor-not-allowed transition-all active:scale-[0.98] flex items-center justify-center gap-2"
              style={{ background: "linear-gradient(135deg, #7B61FF, #D4007A)" }}
            >
              {shareFeedSending ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                  Sharing…
                </>
              ) : "Share to Feed"}
            </button>
          </div>
        </div>
      )}

      {/* Delete confirmation — Telegram-style explicit choice */}
      {confirmDelete && (() => {
        const isSender = String(confirmDelete.user_id) === String(myId);
        const canDeleteForEveryone = isSender || isOwnerOrMod;
        const preview = confirmDelete.is_deleted
          ? "(deleted)"
          : confirmDelete.content?.slice(0, 80)
            || (confirmDelete.media_type === "image" ? "📷 Photo" : confirmDelete.media_type === "video" ? "🎥 Video" : confirmDelete.media_type === "audio" ? "🎤 Voice message" : "Message");
        return (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-fade-in" onClick={() => !deleting && setConfirmDelete(null)}>
            <div className="w-full max-w-[320px] rounded-2xl overflow-hidden shadow-[0_20px_50px_rgba(0,0,0,0.5)] border border-white/10 animate-fade-in-up" style={{ background: "var(--pnp-surface)" }} onClick={(e) => e.stopPropagation()}>
              <div className="px-5 pt-5 pb-4 space-y-2">
                <h3 className="text-base font-bold text-white">Delete message?</h3>
                <p className="text-[13px] text-white/60 line-clamp-2 leading-snug">{preview}</p>
              </div>
              <div className="flex flex-col border-t border-white/5">
                {canDeleteForEveryone && (
                  <button
                    onClick={() => handleDeleteConfirm(true)}
                    disabled={deleting}
                    className="w-full px-5 py-3.5 text-[15px] font-semibold text-left text-red-400 hover:bg-white/5 active:bg-white/10 disabled:opacity-50 transition-colors flex items-center justify-between"
                  >
                    <span>Delete for everyone</span>
                    {deleting && (
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                    )}
                  </button>
                )}
                <button
                  onClick={() => handleDeleteConfirm(false)}
                  disabled={deleting}
                  className={`w-full px-5 py-3.5 text-[15px] font-semibold text-left hover:bg-white/5 active:bg-white/10 disabled:opacity-50 transition-colors ${canDeleteForEveryone ? "border-t border-white/5 text-red-400" : "text-red-400"}`}
                >
                  Delete for me only
                </button>
                <button
                  onClick={() => setConfirmDelete(null)}
                  disabled={deleting}
                  className="w-full px-5 py-3.5 text-[15px] font-semibold text-white/80 hover:bg-white/5 active:bg-white/10 disabled:opacity-50 transition-colors border-t border-white/5"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function Chat({ embeddedMode = false }: { embeddedMode?: boolean } = {}) {
  const { user } = useAuth();
  const { isPrime, isBanned, isAdmin } = useTier();
  const navigate = useNavigate();
  const { groupId: urlGroupId } = useParams<{ groupId?: string }>();
  const t = useI18n();
  const { showTutorial, dismissTutorial, dismissForever } = useTutorial("hangouts");

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
  const [newTags, setNewTags] = useState<string[]>([]);
  const [newIsPaid, setNewIsPaid] = useState(false);
  const [newPriceUsd, setNewPriceUsd] = useState<number>(5);
  const [newPrice, setNewPrice] = useState("");
  const [newRules, setNewRules] = useState("");
  const [newReadOnly, setNewReadOnly] = useState(false);
  const [newSlowMode, setNewSlowMode] = useState(0);
  const [newFeedVisibility, setNewFeedVisibility] = useState<"public" | "shadow" | "ghost">("public");
  const [createSuccess, setCreateSuccess] = useState<{ id: number; name: string } | null>(null);
  const [newChannelId, setNewChannelId] = useState<number | null>(null);
  const [ownChannels, setOwnChannels] = useState<any[]>([]);

  // Discover groups
  const [discoverList, setDiscoverList] = useState<DiscoverGroup[]>([]);
  const [discoverQuery, setDiscoverQuery] = useState("");
  const [showDiscover, setShowDiscover] = useState(true);
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [discoverTagFilter, setDiscoverTagFilter] = useState<string | null>(null);

  // Payment gate modal
  const [showPaymentGate, setShowPaymentGate] = useState(false);
  const [paymentGateInfo, setPaymentGateInfo] = useState<{
    accessType: 'prime' | 'subscription' | 'paid';
    priceUsd?: number;
    channelId?: number;
    channelName?: string;
    creatorId?: string;
    groupId: number;
    groupName?: string;
  } | null>(null);
  const [pgProvider, setPgProvider] = useState<'dash' | 'nowpayments'>('nowpayments');
  const [pgLoading, setPgLoading] = useState(false);
  const [pgPolling, setPgPolling] = useState(false);
  const pgIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pgTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Join requests management (for creators)
  const [joinRequests, setJoinRequests] = useState<Record<number, JoinRequest[]>>({});
  const [showRequests, setShowRequests] = useState<number | null>(null);

  // Chat view state
  const [view, setView] = useState<View>("list");
  const [activeGroup, setActiveGroup] = useState<HangoutGroup | null>(null);

  // Group members (loaded on chat open for member management panels)
  const [groupMembers, setGroupMembers] = useState<any[]>([]);

  // Socket hook — presence + socket connection state + read receipts
  const {
    isConnected,
    onlineMembers,
    readReceipts,
    emitReadMessage,
  } = useHangoutSocket(activeGroup?.id ?? null, user?.dbId);

  // Video call / general chat error
  const [chatError, setChatError] = useState<string | null>(null);

  // Create group error
  const [createError, setCreateError] = useState<string | null>(null);
  const [createTermsAccepted, setCreateTermsAccepted] = useState(false);

  // Online members panel
  const [showOnline, setShowOnline] = useState(false);

  // In-app confirmation modal (replaces window.confirm)
  const [confirmAction, setConfirmAction] = useState<{
    title: string;
    message: string;
    onConfirm: () => Promise<void>;
    isDanger?: boolean;
  } | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);

  // Group overflow menu
  const [showGroupMenu, setShowGroupMenu] = useState(false);

  // Group settings panel
  const [showSettings, setShowSettings] = useState(false);
  const [groupDetail, setGroupDetail] = useState<any>(null);
  const [settingsLoading, setSettingsLoading] = useState(false);

  // Hangout Feed tab state
  const [chatTab, setChatTab] = useState<"chat" | "feed">("chat");
  const [hangoutFeedPosts, setHangoutFeedPosts] = useState<SocialPostItem[]>([]);
  const [hangoutFeedLoading, setHangoutFeedLoading] = useState(false);
  const [hangoutFeedLoaded, setHangoutFeedLoaded] = useState(false);
  const [hangoutFeedNextCursor, setHangoutFeedNextCursor] = useState<string | null>(null);
  const [hangoutFeedLoadingMore, setHangoutFeedLoadingMore] = useState(false);

  // Invite link
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  // Member action loading
  const [memberActionLoading, setMemberActionLoading] = useState<string | null>(null);
  const [memberActionMenu, setMemberActionMenu] = useState<string | null>(null);
  const [memberSearch, setMemberSearch] = useState("");
  const [notifyPicker, setNotifyPicker] = useState(false);
  const [notifyState, setNotifyState] = useState<{ sending: boolean; result: string | null }>({ sending: false, result: null });

  // showGroupSettings was dead state — panel uses showSettings instead
  const [settingsMembers, setSettingsMembers] = useState<GroupMember[]>([]);
  const [settingsMembersLoading, setSettingsMembersLoading] = useState(false);
  const [settingsName, setSettingsName] = useState("");
  const [settingsDesc, setSettingsDesc] = useState("");
  const [settingsRules, setSettingsRules] = useState("");
  const [settingsIsPublic, setSettingsIsPublic] = useState(true);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsSuccess, setSettingsSuccess] = useState(false);
  const [settingsAvatarUploading, setSettingsAvatarUploading] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const groupMenuBtnRef = useRef<HTMLButtonElement>(null);
  const [groupMenuPos, setGroupMenuPos] = useState<{ top: number; right: number }>({ top: 56, right: 8 });

  // Group card context menu (list view)
  const [groupCardMenuId, setGroupCardMenuId] = useState<number | null>(null);
  const [groupCardMenuPos, setGroupCardMenuPos] = useState<{ top: number; right: number }>({ top: 0, right: 0 });
  // Inline edit modal for group list
  const [editingGroup, setEditingGroup] = useState<HangoutGroup | null>(null);
  const [editingName, setEditingName] = useState("");
  const [editingDesc, setEditingDesc] = useState("");
  const [editingSaving, setEditingSaving] = useState(false);
  const [editingError, setEditingError] = useState<string | null>(null);

  // Dedicated error states for non-upload errors
  const [discoverError, setDiscoverError] = useState<string | null>(null);

  // LiveKit call panel state
  const [showTelegramDock, setShowTelegramDock] = useState(false);
  const [callToken, setCallToken] = useState<string | null>(null);
  const [callRoomName, setCallRoomName] = useState<string | null>(null);
  const [callLivekitUrl, setCallLivekitUrl] = useState<string>("wss://livekit.pnptv.app");
  const [callStartedBy, setCallStartedBy] = useState<string | null>(null);
  const [callStartTime, setCallStartTime] = useState<Date | null>(null);
  const [callParticipantCount, setCallParticipantCount] = useState<number>(0);
  const [callPanelDismissed, setCallPanelDismissed] = useState(false);
  const [callDuration, setCallDuration] = useState("0:00");
  const [callError, setCallError] = useState<string | null>(null);
  const [showCallPreview, setShowCallPreview] = useState(false);
  const [preJoinChoices, setPreJoinChoices] = useState<LocalUserChoices | null>(null);
  // Prefetched call token — kicked off when the preview opens so the
  // "Join Call" tap in PreJoin feels instant instead of waiting on a round-trip.
  const prefetchedCallRef = useRef<Promise<{ token: string; livekitUrl: string; roomName: string }> | null>(null);
  const prefetchedGroupIdRef = useRef<number | null>(null);

  // SpotlightStrip — hangout events
  const [hangoutEvents, setHangoutEvents] = useState<EventItem[]>([]);
  const [showCreateEvent, setShowCreateEvent] = useState(false);
  const [detailEvent, setDetailEvent] = useState<EventItem | null>(null);
  const [eventKey, setEventKey] = useState(0);


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

  // ─── Per-row actions: pin / mute ────────────────────────────────────

  const handleTogglePin = useCallback(async (group: HangoutGroup) => {
    const next = !group.isPinned;
    setGroups((prev) =>
      prev
        .map((g) => (g.id === group.id ? { ...g, isPinned: next } : g))
        .sort((a, b) => Number(!!b.isPinned) - Number(!!a.isPinned))
    );
    setGroupCardMenuId(null);
    try {
      await pinHangoutGroup(group.id, next);
    } catch {
      setGroups((prev) => prev.map((g) => (g.id === group.id ? { ...g, isPinned: !next } : g)));
    }
  }, []);

  const handleToggleMute = useCallback(async (group: HangoutGroup) => {
    const currentlyMuted = !!group.isUserMuted;
    const until = currentlyMuted ? null : "forever";
    setGroups((prev) =>
      prev.map((g) => (g.id === group.id ? { ...g, isUserMuted: !currentlyMuted } : g))
    );
    setGroupCardMenuId(null);
    try {
      await muteHangoutGroupForUser(group.id, until);
    } catch {
      setGroups((prev) => prev.map((g) => (g.id === group.id ? { ...g, isUserMuted: currentlyMuted } : g)));
    }
  }, []);

  const loadGroupDetail = useCallback(async (groupId: number) => {
    try {
      const data = await getHangoutGroup(groupId);
      if (data.success) {
        setGroupDetail(data.group);
        setGroupMembers(data.members || []);
        // Merge authoritative server state into activeGroup so the video-call
        // button + dock reflect reality instead of the stale groups-list cache.
        setActiveGroup((prev) => prev && prev.id === data.group.id ? {
          ...prev,
          hasActiveCall: data.group.hasActiveCall,
          activeCallId: data.group.activeCallId,
          memberCount: data.group.memberCount ?? prev.memberCount,
          name: data.group.name ?? prev.name,
          avatarUrl: data.group.avatarUrl ?? prev.avatarUrl,
        } : prev);
      }
    } catch { /* silent */ }
  }, []);

  const loadHangoutEvents = useCallback(() => {
    getUpcomingEvents({ type: "hangout_event", limit: 8 })
      .then((res) => { if (res.success) setHangoutEvents(res.events); })
      .catch(() => {});
  }, []);

  // ─── LiveKit call handlers ────────────────────────────────────────────────
  // Button click opens the pre-join card AND prefetches the LiveKit token in
  // parallel, so when the user confirms mic/cam the dock mounts with no wait.
  const handleStartCall = useCallback(() => {
    if (!activeGroup?.id) return;
    setCallError(null);
    setShowCallPreview(true);

    const gid = activeGroup.id;
    const hasActive = activeGroup.hasActiveCall;
    // Reuse an in-flight prefetch for the same group; otherwise kick off a new one.
    if (prefetchedGroupIdRef.current !== gid || !prefetchedCallRef.current) {
      prefetchedGroupIdRef.current = gid;
      prefetchedCallRef.current = (async () => {
        if (hasActive) {
          try {
            return await joinHangoutCall(gid);
          } catch (err: unknown) {
            if (err instanceof ApiError && err.status === 404) {
              return await startHangoutCall(gid);
            }
            throw err;
          }
        }
        return await startHangoutCall(gid);
      })();
      // Swallow unhandled-rejection noise — the error will surface in the
      // confirm handler where it can be shown to the user in-context.
      prefetchedCallRef.current.catch(() => {});
    }
  }, [activeGroup]);

  const handleConfirmJoinCall = useCallback(async (choices: LocalUserChoices) => {
    console.log("[Chat] PreJoin submit", { groupId: activeGroup?.id, hasActive: activeGroup?.hasActiveCall, choices });
    if (!activeGroup?.id) {
      console.warn("[Chat] No activeGroup.id — aborting join");
      return;
    }
    setPreJoinChoices(choices);
    setShowCallPreview(false);
    try {
      setCallError(null);
      let result: { token: string; livekitUrl: string; roomName: string };
      // Use the prefetch from handleStartCall; if it's missing or for a
      // different group (shouldn't happen, but guard), fall back to a fresh call.
      if (prefetchedCallRef.current && prefetchedGroupIdRef.current === activeGroup.id) {
        result = await prefetchedCallRef.current;
        prefetchedCallRef.current = null;
        prefetchedGroupIdRef.current = null;
      } else {
        const hasActive = activeGroup.hasActiveCall;
        if (hasActive) {
          try {
            result = await joinHangoutCall(activeGroup.id);
          } catch (joinErr: unknown) {
            if (joinErr instanceof ApiError && joinErr.status === 404) {
              result = await startHangoutCall(activeGroup.id);
            } else {
              throw joinErr;
            }
          }
        } else {
          result = await startHangoutCall(activeGroup.id);
        }
      }
      console.log("[Chat] Got LiveKit token", { roomName: result.roomName, livekitUrl: result.livekitUrl });
      setCallToken(result.token);
      setCallRoomName(result.roomName);
      setCallLivekitUrl(result.livekitUrl || "wss://livekit.pnptv.app");
      setShowTelegramDock(true);
      setCallPanelDismissed(false);
      // Scroll the dock into view — it mounts inline in the chat column, so
      // if the user was scrolled elsewhere the dock can otherwise be off-screen.
      requestAnimationFrame(() => {
        const dock = document.querySelector('[data-lk-theme="default"]') as HTMLElement | null;
        dock?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    } catch (err: unknown) {
      console.error("[Chat] Video call start/join failed", err);
      if (err instanceof ApiError) {
        if (err.status === 403) {
          setCallError("You were removed from this hangout.");
          loadGroups();
        } else if (err.status === 402) {
          setCallError("This is a paid hangout. You need access to join the video call.");
        } else if (err.status === 404) {
          setCallError("No active call and unable to start one. Please retry.");
        } else {
          setCallError(`Could not connect to the call (${err.status}). Please try again.`);
        }
      } else {
        setCallError("Could not connect to the call. Please try again.");
      }
    }
  }, [activeGroup, loadGroups]);

  const handleCancelCallPreview = useCallback(() => {
    setShowCallPreview(false);
    // Drop the prefetched token — next open will fetch fresh (token may expire).
    prefetchedCallRef.current = null;
    prefetchedGroupIdRef.current = null;
  }, []);

  const handleLeaveCall = useCallback(() => {
    setShowTelegramDock(false);
    setCallPanelDismissed(true);
  }, []);

  // ─── Socket.IO listeners for LiveKit call events ─────────────────────────
  useEffect(() => {
    if (!activeGroup?.id) return;
    const socket = connectSocket();

    const onCallStarted = (data: { groupId: number; callId?: string | number; startedBy?: { firstName?: string; username?: string } }) => {
      if (data.groupId !== activeGroup.id) return;
      setCallStartTime(new Date());
      setCallParticipantCount(0);
      setCallStartedBy(data.startedBy?.firstName || data.startedBy?.username || null);
      // Sync active-call flags so the call button reflects real state without
      // waiting for the next poll/refresh.
      setActiveGroup((prev) => prev && prev.id === data.groupId ? { ...prev, hasActiveCall: true, activeCallId: data.callId != null ? String(data.callId) : (prev.activeCallId ?? null) } : prev);
      setGroups((prev) => prev.map((g) => g.id === data.groupId ? { ...g, hasActiveCall: true, activeCallId: data.callId != null ? String(data.callId) : (g.activeCallId ?? null) } : g));
    };

    const onCallEnded = (data: { groupId: number }) => {
      if (data.groupId !== activeGroup.id) return;
      setShowTelegramDock(false);
      setCallToken(null);
      setCallRoomName(null);
      setCallStartTime(null);
      setCallStartedBy(null);
      setCallParticipantCount(0);
      setCallDuration("0:00");
      setActiveGroup((prev) => prev && prev.id === data.groupId ? { ...prev, hasActiveCall: false, activeCallId: null } : prev);
      setGroups((prev) => prev.map((g) => g.id === data.groupId ? { ...g, hasActiveCall: false, activeCallId: null } : g));
    };

    const onParticipantJoined = (data: { groupId: number; count?: number }) => {
      if (data.groupId !== activeGroup.id) return;
      setCallParticipantCount((prev) => prev + (data.count ?? 1));
    };

    const onParticipantLeft = (data: { groupId?: number; callId?: number }) => {
      // groupId may not be present in older payloads; guard gracefully
      if (data.groupId !== undefined && data.groupId !== activeGroup.id) return;
      setCallParticipantCount((prev) => Math.max(0, prev - 1));
    };

    socket.on("hangout:call:started", onCallStarted);
    socket.on("hangout:call:ended", onCallEnded);
    socket.on("hangout:call:participant-joined", onParticipantJoined);
    socket.on("hangout:call:participant-left", onParticipantLeft);

    return () => {
      socket.off("hangout:call:started", onCallStarted);
      socket.off("hangout:call:ended", onCallEnded);
      socket.off("hangout:call:participant-joined", onParticipantJoined);
      socket.off("hangout:call:participant-left", onParticipantLeft);
    };
  }, [activeGroup?.id]);

  // ─── Call duration counter ────────────────────────────────────────────────
  useEffect(() => {
    if (!callStartTime) { setCallDuration("0:00"); return; }
    const iv = setInterval(() => {
      const secs = Math.floor((Date.now() - callStartTime.getTime()) / 1000);
      const m = Math.floor(secs / 60), s = secs % 60;
      setCallDuration(`${m}:${s.toString().padStart(2, "0")}`);
    }, 1000);
    return () => clearInterval(iv);
  }, [callStartTime]);

  // Reset call state when switching groups
  useEffect(() => {
    setShowTelegramDock(false);
    setCallToken(null);
    setCallRoomName(null);
    setCallStartedBy(null);
    setCallStartTime(null);
    setCallParticipantCount(0);
    setCallPanelDismissed(false);
    setCallDuration("0:00");
    setCallError(null);
  }, [activeGroup?.id]);

  // ─── Global hangout socket events (invite received, feed posts) ──────────
  useEffect(() => {
    const socket = connectSocket();

    const onInviteReceived = (data: { groupId: number; groupName: string; invitedBy: string }) => {
      // Reload group list so the invited group appears
      loadGroups();
      // Show a brief notification via chatError channel (repurposed as info)
      setChatError(`You were invited to "${data.groupName}" by ${data.invitedBy}`);
      setTimeout(() => setChatError(null), 5000);
    };

    const onHangoutFeedPost = (data: { groupId: number }) => {
      // If we're viewing that group's feed tab, refresh it
      if (activeGroup?.id === data.groupId && chatTab === "feed") {
        setHangoutFeedLoaded(false);
      }
    };

    socket.on("hangout:invite:received", onInviteReceived);
    socket.on("hangout:feed:new_post", onHangoutFeedPost);
    return () => {
      socket.off("hangout:invite:received", onInviteReceived);
      socket.off("hangout:feed:new_post", onHangoutFeedPost);
    };
  }, [activeGroup?.id, chatTab, loadGroups]);

  // ─── Discover groups ──────────────────────────────────────────────────

  const loadDiscover = useCallback(async () => {
    setDiscoverLoading(true);
    setDiscoverError(null);
    try {
      const data = await discoverHangoutGroups();
      setDiscoverList(data.groups || []);
    } catch {
      setDiscoverError("Failed to load groups. Tap to retry.");
    } finally {
      setDiscoverLoading(false);
    }
  }, []);

  useEffect(() => {
    setIsLoading(true);
    loadGroups().finally(() => setIsLoading(false));
    loadHangoutEvents();
    loadDiscover();
  }, [loadGroups, loadHangoutEvents, loadDiscover]);

  // Cleanup payment polling on unmount
  useEffect(() => () => {
    if (pgIntervalRef.current) clearInterval(pgIntervalRef.current);
    if (pgTimeoutRef.current) clearTimeout(pgTimeoutRef.current);
  }, []);

  // Deep-link: auto-open group from /chat/:groupId
  const deepLinkHandled = useRef(false);
  useEffect(() => {
    if (!urlGroupId || deepLinkHandled.current) return;
    // Try from already-loaded groups first
    const target = groups.find((g) => String(g.id) === urlGroupId);
    if (target) {
      deepLinkHandled.current = true;
      openChat(target);
      return;
    }
    // If groups haven't loaded yet, fetch the group directly
    if (!isLoading && groups.length === 0) return; // no groups at all
    if (isLoading) return; // still loading, wait
    // Groups loaded but target not found — fetch directly
    (async () => {
      try {
        const data = await getHangoutGroup(parseInt(urlGroupId, 10));
        if (data.success && data.group) {
          deepLinkHandled.current = true;
          openChat(data.group as any);
        }
      } catch { /* silent */ }
    })();
  }, [urlGroupId, isLoading, groups]);

  // ─── Group creation ─────────────────────────────────────────────────

  const handleCreate = async () => {
    if (!newName.trim() || creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      // When linked to a channel, access rules come from the channel — no standalone paid
      const isPaidEffective = newChannelId ? false : newIsPaid;
      // Standalone paid hangouts: creator-set monthly price ($0.99 – $999.99)
      let paidPrice = 0;
      if (isPaidEffective) {
        const parsed = Number(newPriceUsd);
        if (!Number.isFinite(parsed) || parsed < 0.99 || parsed > 999.99) {
          setCreateError("Price must be between $0.99 and $999.99");
          setCreating(false);
          return;
        }
        paidPrice = Math.round(parsed * 100) / 100;
      }
      const result = await createHangoutGroup(
        newName.trim(),
        newDesc.trim(),
        newIsPublic,
        isPaidEffective,
        paidPrice,
        newRules.trim() || undefined,
        newChannelId
      );
      const createdGroup = result?.group;
      // Apply advanced settings after creation (tags, read-only, slow mode, feed visibility)
      if (createdGroup?.id) {
        const advancedSettings: Record<string, unknown> = {};
        if (newTags.length > 0) advancedSettings.tags = newTags;
        if (newReadOnly) advancedSettings.isReadOnly = true;
        if (newSlowMode > 0) advancedSettings.slowModeSeconds = newSlowMode;
        if (newFeedVisibility !== "public") advancedSettings.feedVisibility = newFeedVisibility;
        if (Object.keys(advancedSettings).length > 0) {
          try {
            await updateHangoutSettings(createdGroup.id, advancedSettings);
          } catch { /* non-blocking */ }
        }
      }
      // Show success state
      setCreateSuccess({ id: createdGroup?.id, name: newName.trim() });
      setNewName("");
      setNewDesc("");
      setNewIsPublic(true);
      setNewIsPaid(false);
      setNewPriceUsd(5);
      setNewPrice("");
      setNewRules("");
      setNewTags([]);
      setNewReadOnly(false);
      setNewSlowMode(0);
      setNewFeedVisibility("public");
      setNewChannelId(null);
      setCreateTermsAccepted(false);
      loadGroups();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : t.chat.errorFailedToCreate);
    } finally {
      setCreating(false);
    }
  };

  // Fetch own unlinked channels when the create form opens (active creators only)
  useEffect(() => {
    if (!showCreate) return;
    if (!isPrime) return;
    getOwnChannels()
      .then((res) => {
        if (res.success) {
          // Only show channels that haven't been linked to a hangout yet
          setOwnChannels(res.channels.filter((ch: any) => !ch.hangoutGroupId));
        }
      })
      .catch(() => setOwnChannels([]));
  }, [showCreate, isPrime]);

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
    } catch (err: any) {
      if (err?.isPaid || err?.message?.includes("Payment required")) {
        const gAny = group as any;
        const accessType = gAny.channelAccessType || (group.isPaid ? 'paid' : 'free');
        setPaymentGateInfo({
          accessType: accessType as any,
          priceUsd: Number(gAny.channelPriceUsd || group.priceUsd || 5),
          channelId: gAny.channelId || undefined,
          channelName: gAny.channelName || undefined,
          creatorId: gAny.creatorId || group.creatorId || undefined,
          groupId: group.id,
          groupName: group.name,
        });
        setShowPaymentGate(true);
      } else {
        setDiscoverError(err instanceof Error ? err.message : "Failed to join group");
      }
    }
  };

  // ─── Payment gate handler ────────────────────────────────────────────
  // Unified purchase handler: picks channel-access or hangout-access based on
  // whether the gated resource is a channel-linked hangout (channelId present)
  // or a standalone paid hangout.
  const handlePurchaseChannel = async (provider: 'dash' | 'nowpayments' = pgProvider) => {
    if (!paymentGateInfo) return;
    const { channelId, groupId } = paymentGateInfo;
    if (!channelId && !groupId) return;
    setPgProvider(provider);
    setPgLoading(true);
    try {
      const res = channelId
        ? await purchaseChannelAccess(channelId, provider)
        : await purchaseHangoutAccess(groupId!, provider);
      if (res.checkoutUrl) {
        const w = window.screen.width, h = window.screen.height;
        const pw = 560, ph = 780;
        window.open(res.checkoutUrl, 'pnptv_payment', `width=${pw},height=${ph},left=${Math.round((w - pw) / 2)},top=${Math.round((h - ph) / 2)},resizable=yes,scrollbars=yes`);
      }
      setPgPolling(true);
      const invoiceId = res.invoiceId;
      pgIntervalRef.current = setInterval(async () => {
        try {
          const poll = provider === 'nowpayments'
            ? await getUsdcSubscriptionStatus(invoiceId)
            : await getDashSubscriptionStatus(invoiceId);
          const done = poll.completed || poll.status === 'completed' || poll.status === 'paid' || poll.status === 'success';
          if (done) {
            if (pgIntervalRef.current) { clearInterval(pgIntervalRef.current); pgIntervalRef.current = null; }
            if (pgTimeoutRef.current) { clearTimeout(pgTimeoutRef.current); pgTimeoutRef.current = null; }
            setPgPolling(false);
            setShowPaymentGate(false);
            setPaymentGateInfo(null);
            loadGroups();
            loadDiscover();
          }
        } catch {}
      }, 5000);
      pgTimeoutRef.current = setTimeout(() => {
        if (pgIntervalRef.current) { clearInterval(pgIntervalRef.current); pgIntervalRef.current = null; }
        pgTimeoutRef.current = null;
        setPgPolling(false);
      }, 600000);
    } catch (err: any) {
      setDiscoverError(err?.message || 'Payment failed');
      setShowPaymentGate(false);
    } finally {
      setPgLoading(false);
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
      setError(err instanceof Error ? err.message : `Failed to ${action} request`);
    }
  };


  // ─── Chat view open/close ──────────────────────────────────────────

  const openChat = async (group: HangoutGroup) => {
    if (isBanned) {
      setError("Your account has been suspended and you cannot access hangouts.");
      return;
    }
    if (showTutorial) dismissTutorial();
    setActiveGroup(group);
    setView("chat");
    navigate(`/chat/${group.id}`, { replace: true });
    setChatError(null);

    markGroupAsRead(group.id).catch(() => {});
    loadGroupDetail(group.id);
  };

  const closeChat = () => {
    setView("list");
    navigate("/chat", { replace: true });
    setActiveGroup(null);
    setShowOnline(false);
    setShowSettings(false);
    loadGroups();
  };

  // ─── Group settings ─────────────────────────────────────────────────

  const openGroupSettings = useCallback(async (group: HangoutGroup) => {
    setSettingsName(group.name);
    setSettingsDesc(group.description || "");
    setSettingsRules(group.rules || "");
    setSettingsIsPublic(group.isPublic);
    setSettingsError(null);
    setSettingsSuccess(false);
    setShowGroupMenu(false);
    setSettingsMembersLoading(true);
    try {
      const data = await getHangoutGroup(group.id);
      setSettingsMembers(data.members || []);
    } catch {
      setSettingsMembers([]);
    } finally {
      setSettingsMembersLoading(false);
    }
  }, []);

  const handleSaveGroupSettings = useCallback(async () => {
    if (!activeGroup || settingsSaving) return;
    setSettingsSaving(true);
    setSettingsError(null);
    setSettingsSuccess(false);
    try {
      await updateHangoutGroup(activeGroup.id, {
        name: settingsName.trim(),
        description: settingsDesc.trim(),
        isPublic: settingsIsPublic,
        rules: settingsRules.trim() || undefined,
      });
      setActiveGroup((prev) => prev ? { ...prev, name: settingsName.trim(), description: settingsDesc.trim(), isPublic: settingsIsPublic, rules: settingsRules.trim() || null } : prev);
      setGroups((prev) => prev.map((g) => g.id === activeGroup.id ? { ...g, name: settingsName.trim(), description: settingsDesc.trim(), isPublic: settingsIsPublic, rules: settingsRules.trim() || null } : g));
      setSettingsSuccess(true);
      setTimeout(() => setSettingsSuccess(false), 2500);
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : "Failed to save settings");
    } finally {
      setSettingsSaving(false);
    }
  }, [activeGroup, settingsName, settingsDesc, settingsRules, settingsIsPublic, settingsSaving]);

  const handleGroupAvatarUpload = useCallback(async (file: File) => {
    if (!activeGroup || settingsAvatarUploading) return;
    setSettingsAvatarUploading(true);
    setSettingsError(null);
    try {
      const result = await uploadGroupAvatar(activeGroup.id, file);
      if (result.avatarUrl) {
        setActiveGroup((prev) => prev ? { ...prev, avatarUrl: result.avatarUrl! } : prev);
        setGroups((prev) => prev.map((g) => g.id === activeGroup.id ? { ...g, avatarUrl: result.avatarUrl! } : g));
      }
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : "Failed to upload avatar");
    } finally {
      setSettingsAvatarUploading(false);
    }
  }, [activeGroup, settingsAvatarUploading]);

  const handleKickMember = useCallback(async (userId: string) => {
    if (!activeGroup) return;
    try {
      await kickGroupMember(activeGroup.id, userId);
      setSettingsMembers((prev) => prev.filter((m) => m.user_id !== userId));
      setActiveGroup((prev) => prev ? { ...prev, memberCount: Math.max(0, prev.memberCount - 1) } : prev);
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : "Failed to kick member");
    }
  }, [activeGroup]);

  const handleChangeRole = useCallback(async (userId: string, role: string) => {
    if (!activeGroup) return;
    try {
      await updateMemberRole(activeGroup.id, userId, role);
      setSettingsMembers((prev) => prev.map((m) => m.user_id === userId ? { ...m, role } : m));
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : "Failed to update role");
    }
  }, [activeGroup]);

  // ─── Group management ──────────────────────────────────────────────

  const handleLeaveGroup = useCallback((gid: number) => {
    const group = groups.find(g => g.id === gid);
    setConfirmAction({
      title: t.chat.leaveGroup,
      message: `Leave "${group?.name ?? "this group"}"? You can rejoin later if it's public.`,
      isDanger: true,
      onConfirm: async () => {
        await leaveHangoutGroup(gid);
        if (activeGroup?.id === gid) closeChat();
        loadGroups();
      },
    });
  }, [groups, activeGroup, t, loadGroups]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSaveInlineEdit = useCallback(async () => {
    if (!editingGroup || editingSaving || !editingName.trim()) return;
    setEditingSaving(true);
    setEditingError(null);
    try {
      await updateHangoutGroup(editingGroup.id, { name: editingName.trim(), description: editingDesc.trim() });
      setGroups((prev) => prev.map((g) => g.id === editingGroup.id ? { ...g, name: editingName.trim(), description: editingDesc.trim() } : g));
      setEditingGroup(null);
    } catch (err) {
      setEditingError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setEditingSaving(false);
    }
  }, [editingGroup, editingName, editingDesc, editingSaving]);

  const handleDeleteGroup = useCallback((gid: number) => {
    const group = groups.find(g => g.id === gid);
    setConfirmAction({
      title: "Delete Group",
      message: `Permanently delete "${group?.name ?? "this group"}"? This cannot be undone.`,
      isDanger: true,
      onConfirm: async () => {
        await deleteHangoutGroup(gid);
        if (activeGroup?.id === gid) closeChat();
        loadGroups();
      },
    });
  }, [groups, activeGroup, loadGroups]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Hangout Feed helpers ─────────────────────────────────────────────

  const loadHangoutFeed = useCallback(async () => {
    if (!activeGroup) return;
    setHangoutFeedLoading(true);
    try {
      const res = await getHangoutFeed(activeGroup.id);
      if (res.success) {
        setHangoutFeedPosts(res.posts);
        setHangoutFeedNextCursor(res.nextCursor);
        setHangoutFeedLoaded(true);
      }
    } catch {
      setHangoutFeedLoaded(true);
    }
    setHangoutFeedLoading(false);
  }, [activeGroup]);

  const loadMoreHangoutFeed = useCallback(async () => {
    if (!activeGroup || !hangoutFeedNextCursor || hangoutFeedLoadingMore) return;
    setHangoutFeedLoadingMore(true);
    try {
      const res = await getHangoutFeed(activeGroup.id, hangoutFeedNextCursor);
      if (res.success) {
        setHangoutFeedPosts((prev) => [...prev, ...res.posts]);
        setHangoutFeedNextCursor(res.nextCursor);
      }
    } catch { /* silent */ }
    setHangoutFeedLoadingMore(false);
  }, [activeGroup, hangoutFeedNextCursor, hangoutFeedLoadingMore]);

  // Reset feed state when switching groups
  useEffect(() => {
    setChatTab("chat");
    setHangoutFeedPosts([]);
    setHangoutFeedLoaded(false);
    setHangoutFeedNextCursor(null);
  }, [activeGroup?.id]);

  // ─── Chat View ────────────────────────────────────────────────────────

  if (view === "chat" && activeGroup) {
    const myMember = groupMembers.find((m: any) => String(m.user_id) === String(user?.dbId));
    const isOwnerOrMod =
      String(activeGroup.creatorId) === String(user?.dbId) ||
      myMember?.role === "moderator" ||
      myMember?.role === "owner" ||
      isAdmin;

    return (
      <>
      <div className="chat-overlay-safe left-0 right-0 lg:left-72 flex flex-col bg-pnp-background overflow-hidden">
        {/* Chat header — sticky strip: name, members, video call */}
        <div
          className="sticky top-0 z-30 flex items-center px-1.5 sm:px-3 border-b border-pnp-border flex-shrink-0 bg-pnp-surface shadow-sm"
          style={{
            minHeight: 56,
            paddingTop: "max(0.75rem, env(safe-area-inset-top, 0px))",
            paddingBottom: "0.75rem",
            boxShadow: "0 2px 8px rgba(0,0,0,0.35)",
          }}
        >
          {/* Left: back + avatar + info */}
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
            <button
              onClick={closeChat}
              className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-white/5 active:scale-95 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent flex-shrink-0 -ml-1"
              aria-label={t.chat.backToGroupList}
            >
              <svg className="w-5 h-5 text-pnp-textPrimary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>

            {/* Avatar with online indicator */}
            <button
              onClick={() => setShowOnline((v) => !v)}
              className="relative flex-shrink-0 active:scale-95 transition-transform"
              aria-label={t.chat.showOnlineMembers}
            >
              {activeGroup.avatarUrl && !activeGroup.isMain && !activeGroup.isWallOfFame ? (
                <img src={activeGroup.avatarUrl} alt="" className="w-10 h-10 rounded-full object-cover ring-1 ring-white/10" />
              ) : (
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold"
                  style={{
                    background: activeGroup.isMain
                      ? "linear-gradient(135deg, #D4007A, #E69138)"
                      : activeGroup.isWallOfFame
                        ? "linear-gradient(135deg, #FFD700, #E69138)"
                        : "linear-gradient(135deg, rgba(212,0,122,0.3), rgba(123,97,255,0.3))",
                    color: activeGroup.isMain || activeGroup.isWallOfFame ? "#fff" : "#D4007A",
                  }}
                >
                  {activeGroup.isMain ? "P" : activeGroup.isWallOfFame ? "\u{1F3C6}" : (activeGroup.name?.[0] || "?").toUpperCase()}
                </div>
              )}
              {isConnected && (
                <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-green-500 ring-2 ring-pnp-background" />
              )}
              {/* Online count badge */}
              {onlineMembers.length > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-green-500 text-[10px] font-bold text-white flex items-center justify-center ring-2 ring-pnp-background">
                  {onlineMembers.length}
                </span>
              )}
            </button>

            {/* Name + member count + setting badges */}
            <div className="flex-1 min-w-0">
              <h2 className="text-sm font-bold text-pnp-textPrimary truncate leading-tight">{activeGroup.name}</h2>
              <div className="flex items-center gap-1 mt-0.5 overflow-hidden">
                <span className="text-xs text-pnp-textSecondary flex-shrink-0">
                  {activeGroup.memberCount} {activeGroup.memberCount === 1 ? t.chat.membersSingular : t.chat.membersPlural}
                </span>
                {activeGroup.isPaid && (activeGroup.priceUsd ?? 0) > 0 && (
                  <span className="text-[10px] text-amber-400 font-medium flex-shrink-0">${Number(activeGroup.priceUsd).toFixed(2)}</span>
                )}
                {(groupDetail?.isReadOnly || activeGroup.isReadOnly) && (
                  <span className="text-[10px] px-1 py-0.5 rounded bg-red-500/15 text-red-400 font-semibold flex-shrink-0">Read-Only</span>
                )}
                {(groupDetail?.slowModeSeconds ?? activeGroup.slowModeSeconds ?? 0) > 0 && (
                  <span className="text-[10px] px-1 py-0.5 rounded bg-amber-500/15 text-amber-400 font-semibold flex-shrink-0">
                    Slow {(groupDetail?.slowModeSeconds ?? activeGroup.slowModeSeconds ?? 0) < 60 ? `${groupDetail?.slowModeSeconds ?? activeGroup.slowModeSeconds}s` : `${(groupDetail?.slowModeSeconds ?? activeGroup.slowModeSeconds ?? 0) / 60}m`}
                  </span>
                )}
                {activeGroup.feedVisibility === "shadow" && (
                  <span className="text-[10px] px-1 py-0.5 rounded bg-purple-500/15 text-purple-400 font-semibold flex-shrink-0">Shadow</span>
                )}
                {activeGroup.feedVisibility === "ghost" && (
                  <span className="text-[10px] px-1 py-0.5 rounded bg-white/10 text-pnp-textSecondary font-semibold flex-shrink-0">Ghost</span>
                )}
              </div>
            </div>
          </div>

          {/* Right: call + menu — 44px min touch targets */}
          <div className="flex items-center flex-shrink-0">
            {/* Create event button */}
            {isOwnerOrMod && (
              <button
                onClick={() => setShowCreateEvent(true)}
                className="w-11 h-11 flex items-center justify-center rounded-full hover:bg-white/5 active:scale-95 transition-all"
                aria-label="Create event"
                title="Create event"
              >
                <svg className="w-5 h-5 text-pnp-textSecondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5m-9-6h.008v.008H12v-.008zM12 15h.008v.008H12V15zm0 2.25h.008v.008H12v-.008zM9.75 15h.008v.008H9.75V15zm0 2.25h.008v.008H9.75v-.008zM7.5 15h.008v.008H7.5V15zm0 2.25h.008v.008H7.5v-.008zm6.75-4.5h.008v.008h-.008v-.008zm0 2.25h.008v.008h-.008V15zm0 2.25h.008v.008h-.008v-.008zm2.25-4.5h.008v.008H16.5v-.008zm0 2.25h.008v.008H16.5V15z" />
                </svg>
              </button>
            )}

            {/* Video call button — opens LiveKit call panel.
                For the official PNPtv hangout (isMain), the in-thread call is
                replaced with a one-tap entry into Main Stage so the room has
                a single, official video surface. */}
            {activeGroup.isMain ? (
              <button
                type="button"
                onClick={() => navigate("/main-stage")}
                aria-label="Join Main Stage"
                title="Join Main Stage — official video call"
                className="flex items-center gap-2 h-11 px-3.5 rounded-full font-bold text-white text-xs sm:text-sm transition-all hover:brightness-110 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent"
                style={{
                  background: "linear-gradient(135deg,#D4007A,#7B61FF)",
                  border: "1px solid rgba(255,255,255,0.18)",
                  boxShadow: "0 4px 14px rgba(212,0,122,0.45)",
                }}
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <rect x="3"  y="3"  width="8" height="8" rx="1.5" />
                  <rect x="13" y="3"  width="8" height="8" rx="1.5" />
                  <rect x="3"  y="13" width="8" height="8" rx="1.5" />
                  <rect x="13" y="13" width="8" height="8" rx="1.5" />
                </svg>
                <span className="hidden sm:inline">Join Main Stage</span>
                <span className="sm:hidden">Stage</span>
              </button>
            ) : (
              <VideoCallButton
                hasActiveCall={showTelegramDock || !!activeGroup?.hasActiveCall}
                participantCount={callParticipantCount}
                onStartCall={handleStartCall}
                isLoading={false}
              />
            )}

            {/* Telegram quick-link — merged into menu on mobile, shown on sm+ */}
            {activeGroup.telegramInviteLink && (
              <a
                href={getTelegramDeepLink(activeGroup.telegramInviteLink)}
                target="_blank"
                rel="noopener noreferrer"
                className="hidden sm:flex w-11 h-11 items-center justify-center rounded-full hover:bg-white/5 active:scale-95 transition-all"
                title="Open in Telegram"
                aria-label="Open Telegram group"
              >
                <svg className="w-4.5 h-4.5" viewBox="0 0 24 24" fill="#29A8E2">
                  <path d="M21.8 2.3L2.1 9.7c-1.2.5-1.2 1.7-.2 2l4.8 1.5 1.8 5.6c.2.7 1 .9 1.5.4l2.7-2.7 5.3 3.9c1 .7 1.8.3 2-1L22.8 3.7c.3-1.3-.5-1.8-1-.4z" />
                </svg>
              </a>
            )}

            {/* Overflow menu */}
            <div className="relative">
              <button
                ref={groupMenuBtnRef}
                onClick={() => {
                  if (!showGroupMenu && groupMenuBtnRef.current) {
                    const r = groupMenuBtnRef.current.getBoundingClientRect();
                    setGroupMenuPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
                  }
                  setShowGroupMenu(v => !v);
                }}
                className="w-11 h-11 flex items-center justify-center rounded-full hover:bg-white/5 active:scale-95 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent"
                aria-label="Group options"
                aria-expanded={showGroupMenu}
              >
                <svg className="w-5 h-5 text-pnp-textSecondary" fill="currentColor" viewBox="0 0 24 24">
                  <circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" />
                </svg>
              </button>
              {showGroupMenu && (
                <>
                  <div className="fixed inset-0 z-[70]" onClick={() => setShowGroupMenu(false)} />
                  <div className="fixed z-[71] rounded-xl overflow-hidden shadow-xl min-w-[200px] max-w-[calc(100vw-16px)]" style={{ background: "var(--pnp-surface-hover)", border: "1px solid rgba(255,255,255,0.1)", top: groupMenuPos.top, right: groupMenuPos.right }}>
                    <button
                      onClick={() => { setShowGroupMenu(false); setShowOnline(true); }}
                      className="w-full px-4 py-3 text-sm text-left text-white hover:bg-white/10 transition-colors flex items-center gap-3"
                    >
                      <svg className="w-4 h-4 text-pnp-textSecondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                      Members
                    </button>
                    {/* Open in Telegram — shown in menu on mobile */}
                    {activeGroup.telegramInviteLink && (
                      <a
                        href={getTelegramDeepLink(activeGroup.telegramInviteLink)}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => setShowGroupMenu(false)}
                        className="sm:hidden w-full px-4 py-3 text-sm text-left text-white hover:bg-white/10 transition-colors flex items-center gap-3"
                      >
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="#29A8E2"><path d="M21.8 2.3L2.1 9.7c-1.2.5-1.2 1.7-.2 2l4.8 1.5 1.8 5.6c.2.7 1 .9 1.5.4l2.7-2.7 5.3 3.9c1 .7 1.8.3 2-1L22.8 3.7c.3-1.3-.5-1.8-1-.4z" /></svg>
                        Open in Telegram
                      </a>
                    )}
                    <button
                      onClick={async () => {
                        setShowGroupMenu(false);
                        setSettingsName(activeGroup.name);
                        setSettingsDesc(activeGroup.description || "");
                        setSettingsRules(activeGroup.rules || "");
                        setSettingsError(null);
                        setSettingsSuccess(false);
                        setShowSettings(true);
                        setSettingsLoading(true);
                        await loadGroupDetail(activeGroup.id);
                        setSettingsLoading(false);
                      }}
                      className="w-full px-4 py-3 text-sm text-left text-white hover:bg-white/10 transition-colors flex items-center gap-3"
                    >
                      <svg className="w-4 h-4 text-pnp-textSecondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                      Settings
                    </button>
                    <div className="border-t border-white/5" />
                    {!activeGroup.isMain && (
                      <button
                        onClick={() => { setShowGroupMenu(false); handleLeaveGroup(activeGroup.id); }}
                        className="w-full px-4 py-3 text-sm text-left hover:bg-white/10 transition-colors flex items-center gap-3"
                        style={{ color: "#FF6B6B" }}
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
                        Leave Group
                      </button>
                    )}
                    {(isAdmin || String(activeGroup.creatorId) === String(user?.dbId) || myMember?.role === "owner") && (
                      <button
                        onClick={() => { setShowGroupMenu(false); handleDeleteGroup(activeGroup.id); }}
                        className="w-full px-4 py-3 text-sm text-left hover:bg-white/10 transition-colors flex items-center gap-3"
                        style={{ color: "#FF6B6B" }}
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        Delete Group
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Call-active banner — visible when a call is running and the user
            is not currently in the dock. One tap re-uses handleStartCall,
            which routes to the join flow when a call already exists. */}
        {activeGroup?.hasActiveCall && !showTelegramDock && (
          <button
            type="button"
            onClick={handleStartCall}
            className="mx-3 mt-2 px-3 py-2 rounded-xl flex items-center gap-2 bg-gradient-to-r from-pink-500/15 to-amber-500/15 border border-pink-500/25 hover:from-pink-500/25 hover:to-amber-500/25 active:scale-[0.99] transition-all text-left animate-fade-in-up min-h-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent"
            aria-label={
              callStartedBy
                ? t.chat.callActiveBannerWith(callStartedBy)
                : t.chat.callActiveBanner
            }
          >
            <span className="relative flex h-2.5 w-2.5 flex-shrink-0">
              <span className="motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-400" />
            </span>
            <svg className="w-4 h-4 text-pnp-amber flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-white truncate">
                {callStartedBy
                  ? t.chat.callActiveBannerWith(callStartedBy)
                  : t.chat.callActiveBanner}
              </p>
              {callParticipantCount > 0 && (
                <p className="text-[10px] text-pnp-textSecondary truncate">
                  {t.chat.callActiveParticipants(callParticipantCount)}
                </p>
              )}
            </div>
            <span className="text-[11px] font-bold text-pnp-amber flex-shrink-0">{t.chat.joinCall}</span>
          </button>
        )}

        {/* Error toast (video call errors etc.) */}
        {chatError && (
          <div className="mx-3 mt-2 px-3 py-2 rounded-xl flex items-center gap-2 bg-red-500/10 border border-red-500/20 animate-fade-in-up">
            <svg className="w-4 h-4 text-red-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
            <p className="flex-1 text-xs text-red-300">{chatError}</p>
            <button onClick={() => setChatError(null)} className="text-red-400 hover:text-red-300 transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        {callError && (
          <div className="mx-3 mt-2 rounded-xl border px-3 py-2 text-xs text-red-300 flex-shrink-0" style={{ background: "rgba(255,59,48,0.08)", borderColor: "rgba(255,59,48,0.2)" }}>
            {callError}
          </div>
        )}

        <LiveKitCallDock
          open={showTelegramDock && !callPanelDismissed}
          onClose={() => { setCallPanelDismissed(true); setShowTelegramDock(false); }}
          token={callToken}
          livekitUrl={callLivekitUrl || "wss://livekit.pnptv.app"}
          roomName={callRoomName}
          startedBy={callStartedBy}
          participantCount={callParticipantCount}
          durationLabel={callDuration}
          initialChoices={preJoinChoices}
          isModerator={isOwnerOrMod}
          onCallEnded={() => { setShowTelegramDock(false); setCallToken(null); setCallRoomName(null); }}
        />

        {/* Pre-join card — camera preview + mic/cam toggles + device picker */}
        {showCallPreview && activeGroup && createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center p-4"
            style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)" }}
            onClick={handleCancelCallPreview}
          >
            <div
              className="relative w-full max-w-lg rounded-2xl overflow-hidden shadow-2xl"
              style={{ background: "#0b0b12", border: "1px solid rgba(123,97,255,0.25)" }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-4 pt-4 pb-2 flex items-center justify-between">
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-pnp-textSecondary">Joining</div>
                  <div className="text-base font-semibold text-white">{activeGroup.name}</div>
                  {!!activeGroup.hasActiveCall && callParticipantCount > 0 && (
                    <div className="text-[11px] text-green-300 mt-0.5">{callParticipantCount} in call</div>
                  )}
                </div>
                <button
                  onClick={handleCancelCallPreview}
                  className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors"
                  aria-label="Cancel"
                >
                  <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="px-2 pb-2">
                <PreJoin
                  defaults={{
                    username:
                      user?.displayName ||
                      user?.firstName ||
                      user?.username ||
                      (user?.id ? `guest-${String(user.id).slice(-4)}` : "Guest"),
                    videoEnabled: true,
                    audioEnabled: false,
                  }}
                  onValidate={(v) => v.username.trim().length >= 1}
                  onSubmit={handleConfirmJoinCall}
                  onError={(err) => {
                    console.error("[Chat] PreJoin error", err);
                    setCallError(
                      err?.message
                        ? `Camera/mic error: ${err.message}. Check browser permissions.`
                        : "Could not access camera or microphone. Check browser permissions."
                    );
                    setShowCallPreview(false);
                  }}
                  joinLabel={activeGroup.hasActiveCall ? "Join Call" : "Start Call"}
                  micLabel="Microphone"
                  camLabel="Camera"
                  userLabel="Display Name"
                  persistUserChoices
                  data-lk-theme="default"
                />
              </div>
            </div>
          </div>,
          document.body
        )}

        {/* Online Members Panel */}
        {showOnline && (
          <div
            className="absolute inset-0 z-40 flex flex-col justify-end"
            style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }}
            onClick={(e) => { if (e.target === e.currentTarget) setShowOnline(false); }}
          >
            <div
              className="rounded-t-2xl w-full flex flex-col"
              style={{ maxHeight: "60dvh", background: "var(--pnp-surface)", borderTop: "1px solid rgba(255,255,255,0.1)" }}
            >
              {/* Drag handle */}
              <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
                <div className="w-10 h-1 rounded-full" style={{ background: "rgba(255,255,255,0.2)" }} />
              </div>
              {/* Panel header */}
              <div className="flex items-center justify-between px-5 pt-4 pb-3 flex-shrink-0">
                <div>
                  <p className="text-sm font-semibold text-white">{t.chat.onlineNow}</p>
                  <p className="text-xs" style={{ color: "var(--pnp-text-secondary)" }}>{t.chat.onlineOfTotal(onlineMembers.length, activeGroup.memberCount)}</p>
                </div>
                <button
                  onClick={() => setShowOnline(false)}
                  className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors"
                  style={{ color: "var(--pnp-text-secondary)" }}
                  aria-label={t.chat.closeOnlinePanel}
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              {/* Member grid / list */}
              <div className="overflow-y-auto flex-1 px-4 pb-6">
                {onlineMembers.length === 0 ? (
                  <p className="text-center text-sm py-6" style={{ color: "var(--pnp-text-secondary)" }}>{t.chat.noOtherMembersOnline}</p>
                ) : (
                  <div className="space-y-1">
                    {onlineMembers.map((member) => {
                      const isMe = member.userId === user?.dbId;
                      return (
                        <button
                          key={member.userId}
                          onClick={() => { setShowOnline(false); navigate(`/profile/${member.userId}`); }}
                          className="w-full flex items-center gap-3 py-2.5 px-1 rounded-xl hover:bg-white/5 active:scale-[0.98] transition-all text-left"
                        >
                          <div className="relative flex-shrink-0">
                            {member.photoUrl ? (
                              <img src={member.photoUrl} alt="" className="w-10 h-10 rounded-full object-cover" />
                            ) : (
                              <div
                                className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold"
                                style={{ background: "linear-gradient(135deg, #D4007A, #E69138)", color: "#fff" }}
                              >
                                {(member.name || "?")[0].toUpperCase()}
                              </div>
                            )}
                            <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-green-400 ring-2 ring-pnp-background" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-white truncate">
                              {member.name}{isMe ? ` ${t.chat.you}` : ""}
                            </p>
                            <div className="flex items-center gap-1 mt-0.5">
                              <span className="text-xs text-pnp-textSecondary">{t.chat.online}</span>
                              <NearbyBadge distanceKm={(member as any).distance_km} variant="compact" />
                            </div>
                          </div>
                          <svg className="w-4 h-4 text-pnp-textSecondary flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                          </svg>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              {/* View on Map button */}
              <div className="px-4 pb-4 flex-shrink-0">
                <button
                  onClick={() => { setShowOnline(false); navigate("/nearby"); }}
                  className="w-full py-2.5 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2 transition-all active:scale-95"
                  style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  View on Map
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Group Settings Panel */}
        {showSettings && activeGroup && (
          <div
            className="absolute inset-0 z-40 flex flex-col justify-end"
            style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }}
            onClick={(e) => { if (e.target === e.currentTarget) setShowSettings(false); }}
          >
            <div
              className="rounded-t-2xl w-full flex flex-col"
              style={{ maxHeight: "80dvh", background: "var(--pnp-surface)", borderTop: "1px solid rgba(255,255,255,0.1)" }}
            >
              <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
                <div className="w-10 h-1 rounded-full" style={{ background: "rgba(255,255,255,0.2)" }} />
              </div>
              <div className="flex items-center justify-between px-5 pt-2 pb-3 flex-shrink-0">
                <p className="text-sm font-semibold text-white">Group Settings</p>
                <button onClick={() => setShowSettings(false)} className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-white/10" style={{ color: "var(--pnp-text-secondary)" }} aria-label="Close settings">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
              <div className="overflow-y-auto flex-1 px-5 pb-safe space-y-4" style={{ paddingBottom: "max(24px, env(safe-area-inset-bottom))" }}>
                {settingsLoading ? (
                  <div className="py-8 text-center text-pnp-textSecondary text-sm">Loading...</div>
                ) : (
                  <>
                    {/* Invite Link */}
                    <div>
                      <p className="text-xs font-semibold text-pnp-textSecondary mb-2 uppercase tracking-wider">Invite Link</p>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={async () => {
                            setInviteError(null);
                            try {
                              const data = await getHangoutInviteLink(activeGroup.id);
                              if (!data.success || !data.inviteUrl) {
                                setInviteError("Couldn't generate invite link");
                                setTimeout(() => setInviteError(null), 3000);
                                return;
                              }
                              setInviteUrl(data.inviteUrl);
                              try {
                                await navigator.clipboard.writeText(data.inviteUrl);
                                setInviteCopied(true);
                                setTimeout(() => setInviteCopied(false), 2000);
                              } catch {
                                // Clipboard API blocked (HTTP, no permission, in-app webview).
                                // Link still showed below — user can long-press to copy manually.
                                setInviteError("Tap link below to copy");
                                setTimeout(() => setInviteError(null), 3000);
                              }
                            } catch (err) {
                              const msg = err instanceof Error && err.message
                                ? err.message
                                : "Couldn't generate invite link";
                              setInviteError(msg);
                              setTimeout(() => setInviteError(null), 3000);
                            }
                          }}
                          className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2 transition-all active:scale-95"
                          style={{ background: "linear-gradient(135deg, #7B61FF, #D4007A)" }}
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
                          {inviteCopied ? "Copied!" : "Copy Invite Link"}
                        </button>
                      </div>
                      {inviteError && (
                        <p role="alert" className="text-[11px] text-red-300 mt-1.5">{inviteError}</p>
                      )}
                      {inviteUrl && <p className="text-[10px] text-pnp-textSecondary mt-1 truncate">{inviteUrl}</p>}
                    </div>

                    {/* Notification Mode */}
                    <div>
                      <p className="text-xs font-semibold text-pnp-textSecondary mb-2 uppercase tracking-wider">Notifications</p>
                      <div className="flex gap-2">
                        {(["all", "mentions", "muted"] as const).map((mode) => (
                          <button
                            key={mode}
                            onClick={() => updateHangoutNotification(activeGroup.id, mode).catch(() => {})}
                            className="flex-1 py-2 rounded-lg text-xs font-semibold transition-all"
                            style={{
                              background: "rgba(255,255,255,0.05)",
                              border: "1px solid rgba(255,255,255,0.1)",
                              color: "#fff",
                            }}
                          >
                            {mode === "all" ? "All" : mode === "mentions" ? "Mentions" : "Muted"}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Group Rules — visible to all members */}
                    {activeGroup.rules && (
                      <div>
                        <p className="text-xs font-semibold text-pnp-textSecondary mb-2 uppercase tracking-wider">Group Rules</p>
                        <div
                          style={{
                            background: 'rgba(255,255,255,0.05)',
                            border: '1px solid rgba(255,255,255,0.1)',
                            borderRadius: '12px',
                            padding: '12px',
                          }}
                        >
                          <p className="text-sm text-white/80" style={{ whiteSpace: 'pre-wrap', lineHeight: '1.5' }}>{activeGroup.rules}</p>
                        </div>
                      </div>
                    )}

                    {/* Owner/Mod settings */}
                    {isOwnerOrMod && (
                      <>
                        <div className="border-t border-white/10 pt-4">
                          <p className="text-xs font-semibold text-pnp-textSecondary mb-3 uppercase tracking-wider">Admin Controls</p>

                          {/* Group Avatar Upload */}
                          <div className="flex items-center gap-3 mb-4">
                            <button
                              onClick={() => avatarInputRef.current?.click()}
                              disabled={settingsAvatarUploading}
                              className="relative flex-shrink-0 group"
                            >
                              {activeGroup.avatarUrl && !activeGroup.isMain ? (
                                <img src={activeGroup.avatarUrl} alt="" className="w-16 h-16 rounded-full object-cover ring-2 ring-white/10" />
                              ) : (
                                <div
                                  className="w-16 h-16 rounded-full flex items-center justify-center text-xl font-bold"
                                  style={{
                                    background: "linear-gradient(135deg, rgba(212,0,122,0.3), rgba(123,97,255,0.3))",
                                    color: "#D4007A",
                                  }}
                                >
                                  {(activeGroup.name?.[0] || "?").toUpperCase()}
                                </div>
                              )}
                              <div className="absolute inset-0 rounded-full bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                                </svg>
                              </div>
                              {settingsAvatarUploading && (
                                <div className="absolute inset-0 rounded-full bg-black/60 flex items-center justify-center">
                                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                </div>
                              )}
                            </button>
                            <input
                              ref={avatarInputRef}
                              type="file"
                              accept="image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif"
                              className="hidden"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) handleGroupAvatarUpload(file);
                                e.target.value = "";
                              }}
                            />
                            <div>
                              <p className="text-xs text-white font-medium">Group Photo</p>
                              <p className="text-[10px] text-pnp-textSecondary">Tap to upload (max 5MB)</p>
                            </div>
                          </div>

                          {/* Edit name & description */}
                          <div className="space-y-2 mb-3">
                            <input
                              type="text"
                              value={settingsName}
                              onChange={(e) => setSettingsName(e.target.value)}
                              maxLength={80}
                              placeholder="Group name"
                              className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-white placeholder-pnp-textSecondary outline-none focus:border-pnp-accent transition-colors"
                            style={{ fontSize: "16px" }}
                            />
                            <textarea
                              value={settingsDesc}
                              onChange={(e) => setSettingsDesc(e.target.value)}
                              maxLength={500}
                              rows={2}
                              placeholder="Description (optional)"
                              className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-white placeholder-pnp-textSecondary outline-none focus:border-pnp-accent transition-colors resize-none"
                              style={{ fontSize: "16px" }}
                            />
                            <div>
                              <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', color: 'rgba(255,255,255,0.5)' }}>
                                Group Rules <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: '11px' }}>(optional)</span>
                              </label>
                              <textarea
                                value={settingsRules}
                                onChange={(e) => setSettingsRules(e.target.value.slice(0, 1000))}
                                maxLength={1000}
                                rows={3}
                                placeholder="e.g. Respect each other · No sharing outside the group · Keep it consensual"
                                style={{
                                  width: '100%',
                                  background: 'rgba(255,255,255,0.05)',
                                  border: '1px solid rgba(255,255,255,0.1)',
                                  borderRadius: '12px',
                                  padding: '10px 12px',
                                  color: '#fff',
                                  fontSize: '16px',
                                  resize: 'vertical',
                                  fontFamily: 'inherit',
                                  outline: 'none',
                                  boxSizing: 'border-box',
                                }}
                              />
                              <div style={{ textAlign: 'right', fontSize: '11px', color: 'rgba(255,255,255,0.3)', marginTop: '2px' }}>
                                {settingsRules.length}/1000
                              </div>
                            </div>
                            {settingsError && (
                              <p className="text-xs text-red-400">{settingsError}</p>
                            )}
                            <button
                              onClick={handleSaveGroupSettings}
                              disabled={settingsSaving || !settingsName.trim()}
                              className="w-full py-2.5 rounded-xl text-sm font-semibold text-white transition-all active:scale-95 disabled:opacity-50"
                              style={{ background: "linear-gradient(135deg, #7B61FF, #D4007A)" }}
                            >
                              {settingsSaving ? "Saving…" : settingsSuccess ? "Saved!" : "Save Changes"}
                            </button>
                          </div>

                          {/* Public/Private Toggle */}
                          <button
                            onClick={async () => {
                              const newVal = !(groupDetail?.isPublic ?? activeGroup.isPublic);
                              await updateHangoutSettings(activeGroup.id, { isPublic: newVal });
                              loadGroupDetail(activeGroup.id);
                              loadGroups();
                            }}
                            className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg bg-white/5 mb-2"
                          >
                            <span className="text-sm text-white">{(groupDetail?.isPublic ?? activeGroup.isPublic) ? "Public" : "Private"}</span>
                            <div className={`w-9 h-5 rounded-full transition-colors relative ${(groupDetail?.isPublic ?? activeGroup.isPublic) ? "bg-pnp-accent" : "bg-white/20"}`}>
                              <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${(groupDetail?.isPublic ?? activeGroup.isPublic) ? "left-[18px]" : "left-0.5"}`} />
                            </div>
                          </button>

                          {/* Read-Only Toggle */}
                          <button
                            onClick={async () => {
                              const newVal = !(groupDetail?.isReadOnly ?? false);
                              await updateHangoutSettings(activeGroup.id, { isReadOnly: newVal });
                              loadGroupDetail(activeGroup.id);
                            }}
                            className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg bg-white/5 mb-2"
                          >
                            <span className="text-sm text-white">Read-Only Mode</span>
                            <div className={`w-9 h-5 rounded-full transition-colors relative ${(groupDetail?.isReadOnly) ? "bg-pnp-accent" : "bg-white/20"}`}>
                              <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${(groupDetail?.isReadOnly) ? "left-[18px]" : "left-0.5"}`} />
                            </div>
                          </button>

                          {/* Slow Mode */}
                          <div className="px-3 py-2.5 rounded-lg bg-white/5 mb-2">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-sm text-white">Slow Mode</span>
                              <span className="text-xs text-pnp-textSecondary">{(groupDetail?.slowModeSeconds ?? 0) === 0 ? "Off" : `${groupDetail?.slowModeSeconds}s`}</span>
                            </div>
                            <div className="flex gap-1.5">
                              {[0, 10, 30, 60, 300].map((sec) => (
                                <button
                                  key={sec}
                                  onClick={async () => {
                                    await updateHangoutSettings(activeGroup.id, { slowModeSeconds: sec });
                                    loadGroupDetail(activeGroup.id);
                                  }}
                                  className="flex-1 py-1.5 rounded text-[10px] font-semibold transition-all"
                                  style={{
                                    background: (groupDetail?.slowModeSeconds ?? 0) === sec ? "linear-gradient(135deg, #D4007A, #E69138)" : "rgba(255,255,255,0.05)",
                                    color: "#fff",
                                  }}
                                >
                                  {sec === 0 ? "Off" : sec < 60 ? `${sec}s` : `${sec / 60}m`}
                                </button>
                              ))}
                            </div>
                          </div>

                          {/* Feed Visibility */}
                          <div className="px-3 py-2.5 rounded-lg bg-white/5 mb-2">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-sm text-white">Feed Mode</span>
                              <span className="text-xs text-pnp-textSecondary capitalize">{groupDetail?.feedVisibility ?? activeGroup.feedVisibility ?? "public"}</span>
                            </div>
                            <div className="flex gap-1.5">
                              {([
                                { value: "public", label: "Public", desc: "Visible to all" },
                                { value: "shadow", label: "Shadow", desc: "Members only" },
                                { value: "ghost", label: "Ghost", desc: "No feed" },
                              ] as const).map(({ value, label }) => (
                                <button
                                  key={value}
                                  onClick={async () => {
                                    await updateHangoutSettings(activeGroup.id, { feedVisibility: value });
                                    loadGroupDetail(activeGroup.id);
                                    // Update local state
                                    setGroups((prev) => prev.map((g) => g.id === activeGroup.id ? { ...g, feedVisibility: value } : g));
                                    if (value === "ghost") setChatTab("chat");
                                  }}
                                  className="flex-1 py-1.5 rounded text-[10px] font-semibold transition-all"
                                  style={{
                                    background: (groupDetail?.feedVisibility ?? activeGroup.feedVisibility ?? "public") === value
                                      ? "linear-gradient(135deg, #7B61FF, #D4007A)"
                                      : "rgba(255,255,255,0.05)",
                                    color: "#fff",
                                  }}
                                >
                                  {label}
                                </button>
                              ))}
                            </div>
                          </div>

                          {/* Tags */}
                          <div className="px-3 py-2.5 rounded-lg bg-white/5 mb-2">
                            <span className="text-sm text-white block mb-1">Tags <span className="text-pnp-textSecondary text-[10px] font-normal">(max 5)</span></span>
                            <div className="flex flex-wrap gap-1 mb-2">
                              {/* Preset tags */}
                              {["clouds", "slamming", "kinks", "chill", "party", "dating", "hookups", "after-hours"].map((tag) => {
                                const current = groupDetail?.tags || [];
                                const isActive = current.includes(tag);
                                return (
                                  <button
                                    key={tag}
                                    onClick={async () => {
                                      const newTags = isActive ? current.filter((t: string) => t !== tag) : [...current, tag].slice(0, 5);
                                      await updateHangoutSettings(activeGroup.id, { tags: newTags });
                                      loadGroupDetail(activeGroup.id);
                                    }}
                                    className="px-2 py-1 rounded-full text-[10px] font-semibold transition-all"
                                    style={{
                                      background: isActive ? "linear-gradient(135deg, #D4007A, #E69138)" : "rgba(255,255,255,0.08)",
                                      color: "#fff",
                                    }}
                                  >
                                    {tag}
                                  </button>
                                );
                              })}
                              {/* Custom tags already added (not in preset list) */}
                              {(groupDetail?.tags || [])
                                .filter((t: string) => !["clouds", "slamming", "kinks", "chill", "party", "dating", "hookups", "after-hours"].includes(t))
                                .map((tag: string) => (
                                  <button
                                    key={tag}
                                    onClick={async () => {
                                      const newTags = (groupDetail?.tags || []).filter((t: string) => t !== tag);
                                      await updateHangoutSettings(activeGroup.id, { tags: newTags });
                                      loadGroupDetail(activeGroup.id);
                                    }}
                                    className="px-2 py-1 rounded-full text-[10px] font-semibold transition-all flex items-center gap-1"
                                    style={{ background: "linear-gradient(135deg, #D4007A, #E69138)", color: "#fff" }}
                                  >
                                    {tag}
                                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                                  </button>
                                ))}
                            </div>
                            {/* Add custom tag */}
                            {(groupDetail?.tags || []).length < 5 && (
                              <form
                                onSubmit={async (e) => {
                                  e.preventDefault();
                                  const input = (e.currentTarget.elements.namedItem("customTag") as HTMLInputElement);
                                  const val = input.value.trim().toLowerCase().replace(/[^a-z0-9-_]/g, "").slice(0, 30);
                                  if (!val) return;
                                  const current = groupDetail?.tags || [];
                                  if (current.includes(val)) { input.value = ""; return; }
                                  const newTags = [...current, val].slice(0, 5);
                                  await updateHangoutSettings(activeGroup.id, { tags: newTags });
                                  loadGroupDetail(activeGroup.id);
                                  input.value = "";
                                }}
                                className="flex gap-1.5"
                              >
                                <input
                                  name="customTag"
                                  type="text"
                                  placeholder="Add custom tag..."
                                  maxLength={30}
                                  style={{ fontSize: "16px" }}
                                  className="flex-1 bg-white/5 border border-white/10 rounded-lg px-2.5 py-1 text-white placeholder-pnp-textSecondary outline-none focus:border-pnp-accent"
                                />
                                <button
                                  type="submit"
                                  className="px-2.5 py-1 rounded-lg text-[10px] font-semibold text-white transition-all active:scale-95"
                                  style={{ background: "linear-gradient(135deg, #7B61FF, #D4007A)" }}
                                >
                                  Add
                                </button>
                              </form>
                            )}
                          </div>

                        </div>

                        {/* Members Management */}
                        <div className="border-t border-white/10 pt-4">
                          <div className="flex items-center justify-between mb-2 gap-2">
                            <p className="text-xs font-semibold text-pnp-textSecondary uppercase tracking-wider shrink-0">
                              Members ({memberSearch ? `${groupMembers.filter((m: any) => { const q = memberSearch.toLowerCase(); return (m.first_name || "").toLowerCase().includes(q) || (m.username || "").toLowerCase().includes(q); }).length}/` : ""}{groupMembers.length})
                            </p>
                            {isOwnerOrMod && (
                              <div className="relative shrink-0">
                                <button
                                  onClick={() => { setNotifyPicker(v => !v); setNotifyState({ sending: false, result: null }); }}
                                  className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold text-pnp-textSecondary hover:text-white hover:bg-white/10 transition-colors"
                                  title="Notify online members"
                                >
                                  🔔 Notify online
                                </button>
                                {notifyPicker && (
                                  <>
                                    <div className="fixed inset-0 z-30" onClick={() => setNotifyPicker(false)} />
                                    <div className="absolute right-0 top-7 z-40 rounded-xl shadow-xl min-w-[190px] py-1.5 px-1" style={{ background: "var(--pnp-surface-hover)", border: "1px solid rgba(255,255,255,0.1)" }}>
                                      {notifyState.result ? (
                                        <p className="text-xs text-center text-pnp-textSecondary px-2 py-1">{notifyState.result}</p>
                                      ) : notifyState.sending ? (
                                        <p className="text-xs text-center text-pnp-textSecondary px-2 py-1">Sending…</p>
                                      ) : (
                                        <>
                                          <p className="text-[10px] text-pnp-textSecondary px-2 pb-1">Push notification to online members:</p>
                                          {([
                                            { type: "call_started" as const, label: "📞 A call has started" },
                                            { type: "mainstage" as const, label: "🎭 Someone joined the Main Stage" },
                                          ]).map(opt => (
                                            <button
                                              key={opt.type}
                                              onClick={async () => {
                                                setNotifyState({ sending: true, result: null });
                                                try {
                                                  const r = await notifyHangoutOnlineMembers(activeGroup.id, opt.type);
                                                  setNotifyState({ sending: false, result: r.sent > 0 ? `✓ Sent to ${r.sent} member${r.sent !== 1 ? "s" : ""}` : "No online members to notify" });
                                                } catch (err: any) {
                                                  setNotifyState({ sending: false, result: err?.message || "Failed to send" });
                                                }
                                                setTimeout(() => setNotifyPicker(false), 2000);
                                              }}
                                              className="w-full px-2 py-1.5 text-xs text-left text-white hover:bg-white/10 rounded-lg transition-colors"
                                            >
                                              {opt.label}
                                            </button>
                                          ))}
                                        </>
                                      )}
                                    </div>
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                          {/* Member search */}
                          <div className="relative mb-2">
                            <input
                              type="text"
                              placeholder="Search members…"
                              value={memberSearch}
                              onChange={e => setMemberSearch(e.target.value)}
                              className="w-full bg-white/5 border border-white/10 rounded-lg pl-7 pr-3 py-1.5 text-xs text-white placeholder:text-white/30 focus:outline-none focus:border-white/25"
                            />
                            <svg className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-white/30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                            </svg>
                          </div>
                          <div className="space-y-1 max-h-48 overflow-y-auto">
                            {groupMembers.filter((m: any) => {
                              if (!memberSearch) return true;
                              const q = memberSearch.toLowerCase();
                              return (m.first_name || "").toLowerCase().includes(q) || (m.username || "").toLowerCase().includes(q);
                            }).map((m: any) => {
                              const isMe = String(m.user_id) === String(user?.dbId);
                              const isOwner = m.role === "owner";
                              const isMod = m.role === "moderator";
                              // isGroupOwner: creator, platform admin, or has owner role in this group
                              const isGroupOwner = String(activeGroup.creatorId) === String(user?.dbId) || isAdmin || myMember?.role === "owner";
                              // Owners can manage mods + members; mods can manage regular members only
                              const canManage = !isMe && (isGroupOwner ? !isOwner : (!isOwner && !isMod && myMember?.role === "moderator"));
                              return (
                                <div key={m.user_id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/5">
                                  <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 cursor-pointer"
                                    style={{ background: "linear-gradient(135deg, #D4007A, #E69138)", color: "#fff" }}
                                    onClick={() => navigate(`/profile/${m.user_id}`)}>
                                    {m.photo_url ? <img src={m.photo_url} alt="" className="w-7 h-7 rounded-full object-cover" /> : (m.first_name || m.username || "?")[0].toUpperCase()}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-xs font-medium text-white truncate">
                                      {m.first_name || m.username}{isMe ? " (You)" : ""}
                                    </p>
                                    <p className="text-[10px] text-pnp-textSecondary">
                                      {isOwner ? "Owner" : isMod ? "Mod" : "Member"}
                                      {m.is_muted ? " · Muted" : ""}
                                      {m.is_banned ? " · Banned" : ""}
                                    </p>
                                  </div>
                                  {canManage && (
                                    <div className="relative flex-shrink-0">
                                      <button
                                        onClick={() => setMemberActionMenu(memberActionMenu === m.user_id ? null : m.user_id)}
                                        className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-white/10 active:scale-95 transition-all"
                                        aria-label="Member actions"
                                      >
                                        <svg className="w-4 h-4 text-pnp-textSecondary" fill="currentColor" viewBox="0 0 24 24">
                                          <circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" />
                                        </svg>
                                      </button>
                                      {memberActionMenu === m.user_id && (
                                        <>
                                          <div className="fixed inset-0 z-30" onClick={() => setMemberActionMenu(null)} />
                                          <div className="absolute right-0 top-8 z-40 rounded-xl overflow-hidden shadow-xl min-w-[160px] py-1" style={{ background: "var(--pnp-surface-hover)", border: "1px solid rgba(255,255,255,0.1)" }}>
                                            {/* Promote/Demote — owner only */}
                                            {isGroupOwner && !isMod && !m.is_banned && (
                                              <button onClick={async () => { setMemberActionMenu(null); setMemberActionLoading(m.user_id); await promoteHangoutMember(activeGroup.id, m.user_id).catch(() => {}); loadGroupDetail(activeGroup.id); setMemberActionLoading(null); }} className="w-full px-3 py-2 text-xs text-left text-blue-400 hover:bg-white/10">Promote to Mod</button>
                                            )}
                                            {isGroupOwner && isMod && (
                                              <button onClick={async () => { setMemberActionMenu(null); setMemberActionLoading(m.user_id); await demoteHangoutMember(activeGroup.id, m.user_id).catch(() => {}); loadGroupDetail(activeGroup.id); setMemberActionLoading(null); }} className="w-full px-3 py-2 text-xs text-left text-yellow-400 hover:bg-white/10">Demote to Member</button>
                                            )}
                                            {/* Mute/Unmute — owners and mods */}
                                            {!m.is_muted && !m.is_banned && (
                                              <button onClick={async () => { setMemberActionMenu(null); setMemberActionLoading(m.user_id); await muteHangoutMember(activeGroup.id, m.user_id, 60).catch(() => {}); loadGroupDetail(activeGroup.id); setMemberActionLoading(null); }} className="w-full px-3 py-2 text-xs text-left text-orange-400 hover:bg-white/10">Mute (1h)</button>
                                            )}
                                            {m.is_muted && (
                                              <button onClick={async () => { setMemberActionMenu(null); setMemberActionLoading(m.user_id); await unmuteHangoutMember(activeGroup.id, m.user_id).catch(() => {}); loadGroupDetail(activeGroup.id); setMemberActionLoading(null); }} className="w-full px-3 py-2 text-xs text-left text-green-400 hover:bg-white/10">Unmute</button>
                                            )}
                                            <div className="border-t border-white/5 my-0.5" />
                                            {/* Kick / Ban / Unban — owners and mods */}
                                            <button onClick={() => { setMemberActionMenu(null); setConfirmAction({ title: "Kick Member", message: `Remove ${m.first_name || m.username} from the group?`, isDanger: true, onConfirm: async () => { await kickHangoutMember(activeGroup.id, m.user_id); loadGroupDetail(activeGroup.id); loadGroups(); } }); }} className="w-full px-3 py-2 text-xs text-left text-red-400 hover:bg-white/10">Kick</button>
                                            {!m.is_banned ? (
                                              <button onClick={() => { setMemberActionMenu(null); setConfirmAction({ title: "Ban Member", message: `Ban ${m.first_name || m.username}? They won't be able to rejoin.`, isDanger: true, onConfirm: async () => { await banHangoutMember(activeGroup.id, m.user_id); loadGroupDetail(activeGroup.id); } }); }} className="w-full px-3 py-2 text-xs text-left text-red-500 hover:bg-white/10">Ban</button>
                                            ) : (
                                              <button onClick={async () => { setMemberActionMenu(null); setMemberActionLoading(m.user_id); await unbanHangoutMember(activeGroup.id, m.user_id).catch(() => {}); loadGroupDetail(activeGroup.id); setMemberActionLoading(null); }} className="w-full px-3 py-2 text-xs text-left text-green-400 hover:bg-white/10">Unban</button>
                                            )}
                                            {/* Transfer Ownership — creator only, to non-owner non-banned members */}
                                            {String(activeGroup.creatorId) === String(user?.dbId) && !m.is_banned && (
                                              <>
                                                <div className="border-t border-white/5 my-0.5" />
                                                <button onClick={() => { setMemberActionMenu(null); setConfirmAction({ title: "Transfer Ownership", message: `Transfer this group to ${m.first_name || m.username || "this member"}? You'll become a regular member. This cannot be undone.`, isDanger: true, onConfirm: async () => { await transferHangoutOwnership(activeGroup.id, m.user_id); loadGroupDetail(activeGroup.id); loadGroups(); } }); }} className="w-full px-3 py-2 text-xs text-left text-yellow-400 hover:bg-white/10">Transfer Ownership</button>
                                              </>
                                            )}
                                          </div>
                                        </>
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Hangout event reminder */}
        {!activeGroup.isWallOfFame && (
          <HangoutEventReminder groupId={activeGroup.id} />
        )}

        {/* Tab bar — Chat + Feed */}
        {activeGroup.feedVisibility !== "ghost" && (
          <div className="flex border-b border-pnp-border flex-shrink-0">
            <button
              onClick={() => setChatTab("chat")}
              className={`flex-1 py-2 text-xs font-bold transition-colors ${chatTab === "chat" ? "text-pnp-accent border-b-2 border-pnp-accent" : "text-pnp-textSecondary hover:text-white"}`}
            >
              Chat
            </button>
            <button
              onClick={() => { setChatTab("feed"); if (!hangoutFeedLoaded) loadHangoutFeed(); }}
              className={`flex-1 py-2 text-xs font-bold transition-colors ${chatTab === "feed" ? "text-pnp-accent border-b-2 border-pnp-accent" : "text-pnp-textSecondary hover:text-white"}`}
            >
              Feed
            </button>
          </div>
        )}

        {/* Hangout Feed Tab */}
        {chatTab === "feed" && activeGroup.feedVisibility !== "ghost" ? (
          <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2 space-y-3">
            <PostComposer
              compact
              hangoutGroupId={activeGroup.id}
              placeholder="Post to this hangout's feed..."
              onPostCreated={(post) => setHangoutFeedPosts((prev) => [post, ...prev])}
            />
            {hangoutFeedLoading && hangoutFeedPosts.length === 0 ? (
              <div className="flex items-center justify-center py-12">
                <svg className="w-8 h-8 text-pnp-accent animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              </div>
            ) : hangoutFeedPosts.length === 0 ? (
              <div className="text-center py-12 text-pnp-textSecondary">
                <p className="text-2xl mb-2">📰</p>
                <p className="text-sm font-medium mb-1">No posts yet</p>
                <p className="text-xs">Be the first to post in this hangout's feed!</p>
              </div>
            ) : (
              <>
                {hangoutFeedPosts.map((post) => (
                  <SocialPostCard
                    key={post.id}
                    post={post}
                    currentUserId={user?.dbId || ""}
                    isAdmin={isAdmin}
                    userLang="en"
                    onLike={async (id) => {
                      try {
                        const res = await togglePostLike(id);
                        setHangoutFeedPosts((prev) =>
                          prev.map((p) => p.id === id ? { ...p, liked_by_me: res.liked, likes_count: res.likes_count ?? p.likes_count } : p)
                        );
                      } catch {}
                    }}
                    onDelete={async (id) => {
                      await deleteSocialPost(id);
                      setHangoutFeedPosts((prev) => prev.filter((p) => p.id !== id));
                    }}
                    onNavigate={navigate}
                  />
                ))}
                {hangoutFeedNextCursor && (
                  <button
                    onClick={loadMoreHangoutFeed}
                    disabled={hangoutFeedLoadingMore}
                    className="w-full py-2 text-xs font-medium text-pnp-accent hover:text-white transition-colors"
                  >
                    {hangoutFeedLoadingMore ? "Loading..." : "Load more"}
                  </button>
                )}
              </>
            )}
          </div>
        ) : (
          /* Hangout chat panel (PostgreSQL + Socket.IO) */
          <HangoutChatPanel
            key={activeGroup.id}
            activeGroup={activeGroup}
            isOwnerOrMod={isOwnerOrMod}
            groupMembers={groupMembers}
            readReceipts={readReceipts}
            emitReadMessage={emitReadMessage}
            isConnected={isConnected}
          />
        )}

        {/* Video calls are now handled natively in Telegram */}

        {/* In-app confirmation modal */}
        {confirmAction && (
          <div
            className="fixed inset-0 z-[70] flex items-end justify-center"
            style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
            onClick={(e) => { if (e.target === e.currentTarget && !confirmLoading) setConfirmAction(null); }}
          >
            <div className="w-full max-w-lg rounded-t-2xl p-6 space-y-4" style={{ background: "var(--pnp-surface)", borderTop: "1px solid rgba(255,255,255,0.1)" }}>
              {/* Drag handle */}
              <div className="flex justify-center -mt-2 mb-2"><div className="w-10 h-1 rounded-full bg-white/20" /></div>
              <h3 className="text-base font-bold text-white">{confirmAction.title}</h3>
              <p className="text-sm text-pnp-textSecondary">{confirmAction.message}</p>
              <div className="flex gap-3">
                <button
                  onClick={() => !confirmLoading && setConfirmAction(null)}
                  className="flex-1 py-3 rounded-xl text-sm font-semibold text-pnp-textSecondary border border-pnp-border hover:bg-white/5 active:scale-98 transition-all"
                  disabled={confirmLoading}
                >
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    setConfirmLoading(true);
                    try { await confirmAction.onConfirm(); setConfirmAction(null); }
                    catch { /* silent */ }
                    finally { setConfirmLoading(false); }
                  }}
                  disabled={confirmLoading}
                  className="flex-1 py-3 rounded-xl text-sm font-semibold text-white active:scale-98 transition-all disabled:opacity-50"
                  style={{ background: confirmAction.isDanger ? "#C0392B" : "linear-gradient(135deg, #D4007A, #E69138)" }}
                >
                  {confirmLoading ? "Processing…" : confirmAction.title}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Create event modal — available from within the active group view */}
      {showCreateEvent && (
        <CreateEventModal
          canCreateLive={false}
          userGroups={groups}
          onClose={() => setShowCreateEvent(false)}
          onCreated={() => {
            setShowCreateEvent(false);
            setEventKey((k) => k + 1);
            loadHangoutEvents();
          }}
        />
      )}
      </>
    );
  }

  // ─── Group List View ──────────────────────────────────────────────────

  return (
    <div className={embeddedMode ? "px-1 py-2" : "max-w-2xl mx-auto px-4 py-6 pb-safe"}>
      {!embeddedMode && (
        <Helmet>
          <title>{t.chat.pageTitle}</title>
          <meta name="description" content={t.chat.pageDescription} />
        </Helmet>
      )}
      {!embeddedMode && showTutorial && <TutorialOverlay section="hangouts" onDismiss={dismissTutorial} onDismissForever={dismissForever} />}

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-pnp-textPrimary">{t.chat.hangoutsTitle}</h1>
          <p className="text-sm mt-1 text-pnp-textSecondary">
            {t.chat.hangoutsSubtitle}
          </p>
        </div>
        {/* Actions handled by SpotlightStrip + icon */}
      </div>

      {/* SpotlightStrip — hangout events */}
      <SpotlightStrip
        items={[
          ...hangoutEvents.map((ev) => ({ kind: "event" as const, data: ev })),
        ]}
        onItemClick={(item) => {
          if (item.kind === "event") setDetailEvent(item.data);
        }}
        showAction={isPrime}
        onAction={() => setShowCreate(true)}
        actionLabel="New group"
        emptyAction={isPrime ? () => setShowCreateEvent(true) : undefined}
      />

      {/* Create hangout — success state with Telegram linking instructions */}
      {createSuccess && (
        <div className="glass-card-sm p-5 mb-4 animate-fade-in-up space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: "linear-gradient(135deg, rgba(94,209,196,0.2), rgba(0,212,232,0.2))" }}>
              <svg className="w-6 h-6 text-pnp-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <h3 className="text-base font-bold text-pnp-textPrimary">Hangout Created!</h3>
              <p className="text-sm text-pnp-textSecondary">
                <span className="font-semibold text-pnp-textPrimary">{createSuccess.name}</span> is ready. Now link a Telegram group for chat.
              </p>
            </div>
          </div>
          <div className="rounded-xl p-4 space-y-2" style={{ background: "rgba(40,168,226,0.08)", border: "1px solid rgba(40,168,226,0.15)" }}>
            <p className="text-xs font-semibold text-pnp-textSecondary uppercase tracking-wider">Link a Telegram Group</p>
            <ol className="space-y-1.5 text-xs text-pnp-textSecondary list-none">
              <li className="flex items-start gap-2">
                <span className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white" style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}>1</span>
                <span>Create a Telegram group or use an existing one</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white" style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}>2</span>
                <span>Add <span className="font-semibold text-pnp-textPrimary">@PNPLatinoTV_Bot</span> as an admin</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white" style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}>3</span>
                <span>In the group, send: <span className="font-semibold text-pnp-textPrimary font-mono">/link {createSuccess.id}</span></span>
              </li>
            </ol>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setCreateSuccess(null)}
              className="flex-1 py-2.5 rounded-lg text-sm text-pnp-textSecondary border border-white/10 hover:bg-white/5 active:scale-[0.98] transition-all"
            >
              Later
            </button>
            <button
              onClick={() => {
                // Use the freshly-created group data from createSuccess rather than
                // searching groups[] which may not be updated yet after loadGroups()
                const freshGroup: HangoutGroup = groups.find((g) => g.id === createSuccess.id) ?? {
                  id: createSuccess.id,
                  name: createSuccess.name,
                  description: "",
                  avatarUrl: null,
                  creatorId: user?.dbId ?? "",
                  isMain: false,
                  isWallOfFame: false,
                  isPublic: newIsPublic,
                  maxMembers: 200000,
                  memberCount: 1,
                  createdAt: new Date().toISOString(),
                  hasActiveCall: false,
                  activeCallId: null,
                  lastMessage: null,
                  unreadCount: 0,
                  feedVisibility: "public",
                  telegramChatId: null,
                  telegramInviteLink: null,
                };
                setCreateSuccess(null);
                setShowCreate(false);
                openChat(freshGroup);
              }}
              className="flex-1 btn-gradient py-2.5 rounded-lg text-sm text-white font-semibold active:scale-[0.98] transition-all"
            >
              Open Hangout
            </button>
          </div>
        </div>
      )}

      {/* Create group form */}
      {showCreate && !createSuccess && (
        <div className="glass-card-sm p-4 mb-4 animate-fade-in-up space-y-4">
          {/* What is a Hangout — visual explainer */}
          <div className="rounded-xl p-3 space-y-2" style={{ background: "linear-gradient(135deg, rgba(212,0,122,0.08), rgba(123,97,255,0.08))" }}>
            <h3 className="text-sm font-bold text-pnp-textPrimary">Create a Hangout</h3>
            <p className="text-xs text-pnp-textSecondary leading-relaxed">
              A hangout is your private space — a <span className="text-pnp-textPrimary font-medium">Telegram group</span> + <span className="text-pnp-textPrimary font-medium">video room</span> for your crew. Only members can join the call.
            </p>
            <div className="flex gap-3 pt-1">
              <div className="flex items-center gap-1.5 text-[11px] text-pnp-textSecondary">
                <div className="w-6 h-6 rounded-full flex items-center justify-center" style={{ background: "rgba(40,168,226,0.15)" }}>
                  <svg className="w-3.5 h-3.5" style={{ color: "#29A8E2" }} viewBox="0 0 24 24" fill="currentColor">
                    <path d="M21.8 2.3L2.1 9.7c-1.2.5-1.2 1.7-.2 2l4.8 1.5 1.8 5.6c.2.7 1 .9 1.5.4l2.7-2.7 5.3 3.9c1 .7 1.8.3 2-1L22.8 3.7c.3-1.3-.5-1.8-1-.4z" />
                  </svg>
                </div>
                Telegram Chat
              </div>
              <div className="flex items-center gap-1.5 text-[11px] text-pnp-textSecondary">
                <div className="w-6 h-6 rounded-full flex items-center justify-center" style={{ background: "rgba(123,97,255,0.15)" }}>
                  <svg className="w-3.5 h-3.5" style={{ color: "#7B61FF" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </div>
                Video Call
              </div>
              <div className="flex items-center gap-1.5 text-[11px] text-pnp-textSecondary">
                <div className="w-6 h-6 rounded-full flex items-center justify-center" style={{ background: "rgba(212,0,122,0.15)" }}>
                  <svg className="w-3.5 h-3.5" style={{ color: "#D4007A" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
                  </svg>
                </div>
                Up to 25
              </div>
            </div>
          </div>

          {/* Name */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-pnp-textSecondary" htmlFor="new-group-name">{t.chat.groupNameLabel}</label>
              <span className={`text-[10px] ${newName.length > 90 ? "text-red-400" : "text-pnp-textSecondary"}`}>{newName.length}/100</span>
            </div>
            <input
              id="new-group-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t.chat.groupNamePlaceholder}
              className="w-full bg-white/5 rounded-xl px-3 py-2.5 text-pnp-textPrimary placeholder:text-pnp-textSecondary/50 focus:outline-none focus:ring-1 focus:ring-pnp-accent/50 transition-colors"
              maxLength={100}
              style={{ fontSize: "16px" }}
            />
          </div>

          {/* Description */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-pnp-textSecondary" htmlFor="new-group-desc">{t.chat.groupDescriptionLabel}</label>
              <span className={`text-[10px] ${newDesc.length > 450 ? "text-red-400" : "text-pnp-textSecondary"}`}>{newDesc.length}/500</span>
            </div>
            <textarea
              id="new-group-desc"
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder={t.chat.groupDescriptionPlaceholder}
              className="w-full bg-white/5 rounded-xl px-3 py-2.5 text-pnp-textPrimary placeholder:text-pnp-textSecondary/50 focus:outline-none focus:ring-1 focus:ring-pnp-accent/50 resize-none transition-colors"
              rows={2}
              maxLength={500}
              style={{ fontSize: "16px" }}
            />
          </div>

          {/* Tags — pick during creation */}
          <div>
            <p className="text-xs font-medium text-pnp-textSecondary mb-1.5">Vibe tags <span className="text-pnp-textSecondary/60 font-normal">(optional, up to 5)</span></p>
            <div className="flex flex-wrap gap-1.5">
              {["clouds", "slamming", "kinks", "chill", "party", "dating", "hookups", "after-hours"].map((tag) => {
                const isActive = newTags.includes(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => {
                      if (isActive) setNewTags(newTags.filter((t) => t !== tag));
                      else if (newTags.length < 5) setNewTags([...newTags, tag]);
                    }}
                    className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-all active:scale-95 ${
                      isActive
                        ? "text-white"
                        : "bg-white/8 text-pnp-textSecondary hover:bg-white/15"
                    }`}
                    style={isActive ? { background: "linear-gradient(135deg, #D4007A, #7B61FF)" } : undefined}
                  >
                    {tag}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Public/Private toggle */}
          <button
            type="button"
            onClick={() => setNewIsPublic(!newIsPublic)}
            className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl bg-white/5 transition-colors hover:bg-white/10"
          >
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: newIsPublic ? "rgba(94,209,196,0.15)" : "rgba(255,255,255,0.08)" }}>
                <svg className="w-4 h-4" style={{ color: newIsPublic ? "#5ED1C4" : "#8E8E93" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  {newIsPublic ? (
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5a17.92 17.92 0 01-8.716-2.247m0 0A9.015 9.015 0 003 12c0-1.605.42-3.113 1.157-4.418" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                  )}
                </svg>
              </div>
              <div className="text-left">
                <span className="text-sm text-pnp-textPrimary font-medium block">
                  {newIsPublic ? "Public Hangout" : "Private Hangout"}
                </span>
                <span className="text-[11px] text-pnp-textSecondary">
                  {newIsPublic ? t.chat.anyoneCanJoin : t.chat.approvalRequired}
                </span>
              </div>
            </div>
            <div className={`w-10 h-5.5 rounded-full transition-colors relative ${newIsPublic ? "bg-pnp-accent" : "bg-white/20"}`} style={{ width: 40, height: 22 }}>
              <div className={`absolute top-0.5 w-[18px] h-[18px] rounded-full bg-white transition-transform shadow-sm ${newIsPublic ? "translate-x-[19px]" : "translate-x-[2px]"}`} />
            </div>
          </button>

          {/* Link to Channel — only when the creator has unlinked channels */}
          {ownChannels.length > 0 && (
            <div>
              <p className="text-xs font-medium text-pnp-textSecondary mb-2">
                Link to Channel <span className="text-pnp-textSecondary/60 font-normal">(optional)</span>
              </p>
              <div className="space-y-1.5">
                <button
                  type="button"
                  onClick={() => setNewChannelId(null)}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-left transition-all"
                  style={newChannelId === null
                    ? { background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.2)" }
                    : { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }
                  }
                >
                  <div className="w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center"
                    style={{ borderColor: newChannelId === null ? "#fff" : "rgba(255,255,255,0.3)" }}>
                    {newChannelId === null && <div className="w-2 h-2 rounded-full bg-white" />}
                  </div>
                  <span className="text-sm text-pnp-textPrimary">None — standalone hangout</span>
                </button>
                {ownChannels.map((ch: any) => {
                  const at = ch.accessType ?? (ch.isPremium ? "subscription" : "free");
                  let badgeBg = "rgba(94,209,196,0.2)";
                  let badgeColor = "#5ED1C4";
                  let badgeLabel = "Free";
                  if (at === "prime") { badgeBg = "rgba(167,139,250,0.2)"; badgeColor = "#A78BFA"; badgeLabel = "Prime"; }
                  else if (at === "subscription") { badgeBg = "rgba(212,0,122,0.2)"; badgeColor = "#D4007A"; badgeLabel = "Sub"; }
                  else if (at === "paid") { badgeBg = "rgba(230,145,56,0.2)"; badgeColor = "#E69138"; badgeLabel = `$${ch.priceUsd ?? 0}`; }
                  const isSelected = newChannelId === ch.id;
                  return (
                    <button
                      key={ch.id}
                      type="button"
                      onClick={() => setNewChannelId(ch.id)}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-left transition-all"
                      style={isSelected
                        ? { background: "rgba(212,0,122,0.12)", border: "1px solid rgba(212,0,122,0.4)" }
                        : { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }
                      }
                    >
                      <div className="w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center"
                        style={{ borderColor: isSelected ? "#D4007A" : "rgba(255,255,255,0.3)" }}>
                        {isSelected && <div className="w-2 h-2 rounded-full" style={{ background: "#D4007A" }} />}
                      </div>
                      <span className="flex-1 text-sm text-pnp-textPrimary truncate">{ch.name}</span>
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold flex-shrink-0"
                        style={{ background: badgeBg, color: badgeColor }}>
                        {badgeLabel}
                      </span>
                    </button>
                  );
                })}
              </div>
              {newChannelId && (
                <p className="text-[11px] text-white/40 mt-1.5 leading-relaxed">
                  Access rules are inherited from the channel. The paid toggle below will be hidden.
                </p>
              )}
            </div>
          )}

          {/* Paid hangout toggle — hidden when a channel is linked */}
          {!newChannelId && <button
            type="button"
            onClick={() => setNewIsPaid(!newIsPaid)}
            className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl bg-white/5 transition-colors hover:bg-white/10"
          >
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: newIsPaid ? "rgba(230,145,56,0.15)" : "rgba(255,255,255,0.08)" }}>
                <svg className="w-4 h-4" style={{ color: newIsPaid ? "#E69138" : "#8E8E93" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="text-left">
                <span className="text-sm text-pnp-textPrimary font-medium block">
                  {newIsPaid ? "Paid Hangout (30-day pass)" : "Free Hangout"}
                </span>
                <span className="text-[11px] text-pnp-textSecondary">
                  {newIsPaid ? "Basic/PRIME members buy 30-day passes" : "Members can join for free"}
                </span>
              </div>
            </div>
            <div className={`w-10 rounded-full transition-colors relative ${newIsPaid ? "bg-amber-500" : "bg-white/20"}`} style={{ width: 40, height: 22 }}>
              <div className={`absolute top-0.5 w-[18px] h-[18px] rounded-full bg-white transition-transform shadow-sm ${newIsPaid ? "translate-x-[19px]" : "translate-x-[2px]"}`} />
            </div>
          </button>}

          {/* Standalone paid hangout: creator-set 30-day pass price */}
          {!newChannelId && newIsPaid && (
            <div className="px-3 py-2.5 rounded-xl space-y-2" style={{ background: "rgba(230,145,56,0.1)", border: "1px solid rgba(230,145,56,0.2)" }}>
              <p className="text-[11px] text-amber-300/70">30-day access pass. Subscribers get an email + push + Telegram reminder 3 days before expiry, with a one-tap renewal link. They can cancel reminders anytime.</p>
              <label className="block text-xs text-white/60">Price per 30 days (USD)</label>
              <div className="flex gap-2 flex-wrap items-center">
                {[5, 10, 15, 20, 25].map((price) => (
                  <button
                    key={price}
                    type="button"
                    onClick={() => setNewPriceUsd(price)}
                    className="px-3 py-1.5 rounded-lg text-sm font-semibold transition-all border"
                    style={newPriceUsd === price
                      ? { background: "rgba(230,145,56,0.25)", color: "#E69138", borderColor: "rgba(230,145,56,0.6)" }
                      : { background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.5)", borderColor: "rgba(255,255,255,0.1)" }
                    }
                  >
                    ${price}/mo
                  </button>
                ))}
                <input
                  type="number"
                  min="0.99"
                  max="999.99"
                  step="0.01"
                  value={newPriceUsd || ""}
                  onChange={(e) => setNewPriceUsd(Number(e.target.value) || 0)}
                  placeholder="Custom"
                  className="w-24 px-3 py-1.5 rounded-lg text-sm bg-white/5 border border-white/10 text-white placeholder-white/30 focus:outline-none focus:border-orange-500/50"
                />
              </div>
              <p className="text-[10px] text-white/40">Free users cannot subscribe — must upgrade to Basic or PRIME first. Range: $0.99 – $999.99 per 30-day pass.</p>
            </div>
          )}

          {/* Group Rules */}
          <div>
            <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', color: 'rgba(255,255,255,0.7)' }}>
              Group Rules <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: '11px' }}>(optional, shown to new members)</span>
            </label>
            <textarea
              value={newRules}
              onChange={e => setNewRules(e.target.value.slice(0, 1000))}
              placeholder="e.g. Respect each other · No sharing outside the group · Keep it consensual"
              maxLength={1000}
              rows={3}
              style={{
                width: '100%',
                background: 'rgba(255,255,255,0.08)',
                border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: '8px',
                padding: '10px 12px',
                color: '#fff',
                fontSize: '14px',
                resize: 'vertical',
                fontFamily: 'inherit',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
            <div style={{ textAlign: 'right', fontSize: '11px', color: 'rgba(255,255,255,0.35)', marginTop: '4px' }}>
              {newRules.length}/1000
            </div>
          </div>

          {/* Advanced Settings */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-pnp-textSecondary">Advanced <span className="text-pnp-textSecondary/60 font-normal">(optional)</span></p>

            {/* Read-Only Toggle */}
            <button
              type="button"
              onClick={() => setNewReadOnly(!newReadOnly)}
              className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl bg-white/5 transition-colors hover:bg-white/10"
            >
              <div className="text-left">
                <span className="text-sm text-pnp-textPrimary font-medium block">Read-Only</span>
                <span className="text-[11px] text-pnp-textSecondary">Only mods/owner can send messages</span>
              </div>
              <div className={`w-10 rounded-full transition-colors relative ${newReadOnly ? "bg-pnp-accent" : "bg-white/20"}`} style={{ width: 40, height: 22 }}>
                <div className={`absolute top-0.5 w-[18px] h-[18px] rounded-full bg-white transition-transform shadow-sm ${newReadOnly ? "translate-x-[19px]" : "translate-x-[2px]"}`} />
              </div>
            </button>

            {/* Slow Mode */}
            <div className="px-3 py-2.5 rounded-xl bg-white/5">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-sm text-pnp-textPrimary font-medium">Slow Mode</span>
                <span className="text-[11px] text-pnp-textSecondary">{newSlowMode === 0 ? "Off" : newSlowMode < 60 ? `${newSlowMode}s` : `${newSlowMode / 60}m`}</span>
              </div>
              <div className="flex gap-1.5">
                {[0, 10, 30, 60, 300].map((sec) => (
                  <button
                    key={sec}
                    type="button"
                    onClick={() => setNewSlowMode(sec)}
                    className="flex-1 py-1.5 rounded text-[10px] font-semibold transition-all"
                    style={{
                      background: newSlowMode === sec ? "linear-gradient(135deg, #D4007A, #E69138)" : "rgba(255,255,255,0.05)",
                      color: "#fff",
                    }}
                  >
                    {sec === 0 ? "Off" : sec < 60 ? `${sec}s` : `${sec / 60}m`}
                  </button>
                ))}
              </div>
            </div>

            {/* Feed Visibility */}
            <div className="px-3 py-2.5 rounded-xl bg-white/5">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-sm text-pnp-textPrimary font-medium">Feed Mode</span>
                <span className="text-[11px] text-pnp-textSecondary capitalize">{newFeedVisibility}</span>
              </div>
              <div className="flex gap-1.5">
                {([
                  { value: "public" as const, label: "Public" },
                  { value: "shadow" as const, label: "Shadow" },
                  { value: "ghost" as const, label: "Ghost" },
                ]).map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setNewFeedVisibility(value)}
                    className="flex-1 py-1.5 rounded text-[10px] font-semibold transition-all"
                    style={{
                      background: newFeedVisibility === value ? "linear-gradient(135deg, #7B61FF, #D4007A)" : "rgba(255,255,255,0.05)",
                      color: "#fff",
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {createError && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20">
              <svg className="w-4 h-4 text-red-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
              </svg>
              <p className="text-xs text-red-300">{createError}</p>
            </div>
          )}

          {/* Creator accountability acknowledgment */}
          <label className="flex items-start gap-2.5 cursor-pointer select-none" htmlFor="create-terms-accept">
            <div className="relative mt-0.5 flex-shrink-0">
              <input
                id="create-terms-accept"
                type="checkbox"
                className="sr-only"
                checked={createTermsAccepted}
                onChange={(e) => setCreateTermsAccepted(e.target.checked)}
              />
              <div
                className="w-4 h-4 rounded border transition-all"
                style={{
                  background: createTermsAccepted ? "linear-gradient(135deg, #D4007A, #7B61FF)" : "rgba(255,255,255,0.06)",
                  borderColor: createTermsAccepted ? "transparent" : "rgba(255,255,255,0.2)",
                }}
              >
                {createTermsAccepted && (
                  <svg className="w-4 h-4 text-white p-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </div>
            </div>
            <p className="text-[11px] text-pnp-textSecondary leading-relaxed">
              I understand that as the creator of this Hangout I am <span className="text-pnp-textPrimary font-medium">solely responsible</span> for moderating member conduct, enforcing community rules, and ensuring no prohibited content is shared (no solicitation, no minors, no off-platform recruitment). PNPtv is not liable for content posted in creator-owned Hangouts. Violations may result in removal of the group and suspension of my account.
            </p>
          </label>

          {/* Action buttons */}
          <div className="flex gap-2">
            <button
              onClick={() => { setShowCreate(false); setCreateError(null); setNewTags([]); setCreateTermsAccepted(false); }}
              className="flex-1 py-2.5 rounded-xl text-sm text-pnp-textSecondary border border-white/10 hover:bg-white/5 active:scale-[0.98] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent"
            >
              {t.chat.cancel}
            </button>
            <button
              onClick={handleCreate}
              disabled={!newName.trim() || creating || !createTermsAccepted}
              className="flex-1 py-2.5 rounded-xl text-sm text-white font-semibold disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent"
              style={{ background: "linear-gradient(135deg, #D4007A, #7B61FF)" }}
            >
              {creating ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Creating...
                </span>
              ) : "Create Hangout"}
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
          {Array.from({ length: 5 }).map((_, i) => (
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
        <div className="glass-card-sm p-8 text-center space-y-4">
          <div className="w-20 h-20 mx-auto rounded-full flex items-center justify-center" style={{ background: "linear-gradient(135deg, rgba(212,0,122,0.12), rgba(123,97,255,0.12))" }}>
            <svg className="w-10 h-10" style={{ color: "#D4007A" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
            </svg>
          </div>
          <div>
            <p className="text-pnp-textPrimary font-bold text-lg mb-1">{t.chat.noGroupsYet}</p>
            <p className="text-sm text-pnp-textSecondary leading-relaxed max-w-[280px] mx-auto">
              {t.chat.noGroupsLoginHint}
            </p>
          </div>
          {/* What's a hangout explainer */}
          <div className="flex justify-center gap-4 text-[11px] text-pnp-textSecondary/70">
            <span className="flex items-center gap-1">
              <svg className="w-3.5 h-3.5" style={{ color: "#29A8E2" }} viewBox="0 0 24 24" fill="currentColor"><path d="M21.8 2.3L2.1 9.7c-1.2.5-1.2 1.7-.2 2l4.8 1.5 1.8 5.6c.2.7 1 .9 1.5.4l2.7-2.7 5.3 3.9c1 .7 1.8.3 2-1L22.8 3.7c.3-1.3-.5-1.8-1-.4z" /></svg>
              Telegram Chat
            </span>
            <span className="flex items-center gap-1">
              <svg className="w-3.5 h-3.5" style={{ color: "#7B61FF" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" /></svg>
              Video Calls
            </span>
            <span className="flex items-center gap-1">
              <svg className="w-3.5 h-3.5" style={{ color: "#E69138" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" /></svg>
              Members Only
            </span>
          </div>
          {isPrime && (
            <button
              onClick={() => setShowCreate(true)}
              className="px-6 py-2.5 rounded-xl text-sm font-semibold text-white active:scale-95 transition-transform"
              style={{ background: "linear-gradient(135deg, #D4007A, #7B61FF)" }}
            >
              Create Your First Hangout
            </button>
          )}
        </div>
      ) : (
        /* Group list */
        <div className="space-y-2">
          {groups.map((group) => (
            <div
              key={group.id}
              {...(group.isMain
                ? {}
                : {
                    onClick: () => openChat(group),
                    role: "button" as const,
                    tabIndex: 0,
                    onKeyDown: (e: React.KeyboardEvent) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        openChat(group);
                      }
                    },
                  })}
              className={`w-full p-3 sm:p-4 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent ${
                group.isMain ? "" : "active:scale-[0.97] cursor-pointer"
              } ${
                group.isMain
                  ? "rounded-2xl relative overflow-hidden hover:brightness-110"
                  : "glass-card-sm hover:border-white/20"
              }`}
              style={
                group.isMain
                  ? {
                      background:
                        "linear-gradient(135deg, rgba(212,0,122,0.16), rgba(123,97,255,0.14)) padding-box, linear-gradient(135deg,#D4007A,#7B61FF) border-box",
                      border: "1.5px solid transparent",
                      boxShadow:
                        "0 8px 28px rgba(212,0,122,0.20), 0 0 0 1px rgba(212,0,122,0.10), inset 0 1px 0 rgba(255,255,255,0.06)",
                    }
                  : undefined
              }
            >
              <div className="flex gap-3 items-center">
                {/* Group avatar */}
                <div className="relative w-10 h-10 sm:w-12 sm:h-12 flex-shrink-0">
                  {group.avatarUrl && !group.isMain && !group.isWallOfFame ? (
                    <img
                      src={group.avatarUrl}
                      alt=""
                      className="w-10 h-10 sm:w-12 sm:h-12 rounded-full object-cover ring-2 ring-white/10"
                      onError={(e) => {
                        const img = e.target as HTMLImageElement;
                        img.style.display = "none";
                        const fb = img.nextElementSibling as HTMLElement | null;
                        if (fb) fb.style.removeProperty("display");
                      }}
                    />
                  ) : null}
                  <div
                    className="w-10 h-10 sm:w-12 sm:h-12 rounded-full flex items-center justify-center text-base sm:text-lg font-bold"
                    style={{
                      display: group.avatarUrl && !group.isMain && !group.isWallOfFame ? "none" : undefined,
                      background: group.isMain
                        ? "linear-gradient(135deg, #D4007A, #7B61FF)"
                        : group.isWallOfFame
                          ? "linear-gradient(135deg, #FFD700, #E69138)"
                          : "linear-gradient(135deg, rgba(212,0,122,0.3), rgba(123,97,255,0.3))",
                      color: group.isMain || group.isWallOfFame ? "#fff" : "#D4007A",
                    }}
                  >
                    {group.isMain ? "P" : group.isWallOfFame ? "\u{1F3C6}" : (group.name?.[0] || "?").toUpperCase()}
                  </div>
                  {/* Active call pulse dot */}
                  {group.hasActiveCall && (
                    <span className="absolute -top-0.5 -right-0.5 flex h-3.5 w-3.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-60" />
                      <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-green-400 ring-2 ring-pnp-background" />
                    </span>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  {/* Name row — badges on mobile pushed to right side via ml-auto on the badge cluster */}
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-pnp-textPrimary text-sm truncate min-w-0">
                      {group.name}
                    </span>
                    {/* Status badges: main/wof/private/live — always visible */}
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {group.isMain && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold" style={{ background: "rgba(212,0,122,0.15)", color: "#D4007A" }}>
                          {t.chat.labelMain}
                        </span>
                      )}
                      {group.isWallOfFame && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded text-yellow-300" style={{ background: "rgba(255,215,0,0.15)" }}>
                          {t.chat.labelWallOfFame}
                        </span>
                      )}
                      {!group.isPublic && !group.isMain && !group.isWallOfFame && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-pnp-textSecondary">
                          {t.chat.labelPrivate}
                        </span>
                      )}
                      {group.channelId && group.channelAccessType && group.channelAccessType !== "free" ? (
                        <span
                          className="text-[10px] px-1.5 py-0.5 rounded font-semibold"
                          style={
                            group.channelAccessType === "prime"
                              ? { background: "rgba(167,139,250,0.15)", color: "#A78BFA", border: "1px solid rgba(167,139,250,0.25)" }
                              : group.channelAccessType === "subscription"
                              ? { background: "rgba(212,0,122,0.15)", color: "#D4007A", border: "1px solid rgba(212,0,122,0.25)" }
                              : { background: "rgba(230,145,56,0.15)", color: "#E69138", border: "1px solid rgba(230,145,56,0.25)" }
                          }
                        >
                          {group.channelAccessType === "prime" ? "Prime" : group.channelAccessType === "subscription" ? "Sub" : `$${Number(group.channelPriceUsd ?? 0).toFixed(0)}`}
                        </span>
                      ) : group.isPaid && (group.priceUsd ?? 0) > 0 ? (
                        <span
                          className="text-[10px] px-1.5 py-0.5 rounded font-semibold"
                          style={{ background: "rgba(230,145,56,0.15)", color: "#E69138", border: "1px solid rgba(230,145,56,0.25)" }}
                        >
                          ${Number(group.priceUsd).toFixed(2)}
                        </span>
                      ) : null}
                      {group.hasActiveCall && (
                        <div className="flex items-center gap-1">
                          <span className="relative flex h-1.5 w-1.5">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-pnp-accent opacity-75" />
                            <span className="relative inline-flex rounded-full h-1.5 w-1.5 dot-gradient" />
                          </span>
                          <span className="text-[10px] text-gradient font-semibold">{t.chat.labelLive}</span>
                        </div>
                      )}
                    </div>
                    {/* Unread badge — right-aligned via ml-auto */}
                    {(group.unreadCount ?? 0) > 0 && (
                      <span
                        className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full text-white font-bold flex-shrink-0 min-w-[18px] text-center"
                        style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
                      >
                        {group.unreadCount! > 99 ? "99+" : group.unreadCount}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span
                      className={`text-xs flex-shrink-0 ${group.isMain ? "" : "text-pnp-textSecondary"}`}
                      style={group.isMain ? { color: "rgba(255,255,255,0.85)" } : undefined}
                    >
                      {group.memberCount} {group.memberCount === 1 ? t.chat.membersSingular : t.chat.membersPlural}
                    </span>
                    {group.lastMessage && (
                      <span
                        className={`text-xs truncate min-w-0 ${group.isMain ? "" : "text-pnp-textSecondary"}`}
                        style={group.isMain ? { color: "rgba(255,255,255,0.75)" } : undefined}
                      >
                        &middot; {group.lastMessage}
                      </span>
                    )}
                  </div>
                  {/* Crystal-tier marker for the official PNPtv hangout */}
                  {group.isMain && (
                    <div
                      className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wide text-white"
                      style={{
                        background: "linear-gradient(135deg,#D4007A,#7B61FF)",
                        border: "1px solid rgba(255,255,255,0.20)",
                        textShadow: "0 1px 2px rgba(0,0,0,0.35)",
                      }}
                      title="Crystal Hangout — Main Stage video call enabled"
                    >
                      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                      </svg>
                      <span>Crystal Hangout · Main Stage</span>
                    </div>
                  )}
                  {/* Description */}
                  {!group.isWallOfFame && group.description && (
                    <p
                      className={`text-xs truncate mt-0.5 ${group.isMain ? "" : "text-pnp-textSecondary"}`}
                      style={group.isMain ? { color: "rgba(255,255,255,0.78)" } : undefined}
                    >
                      {group.description}
                    </p>
                  )}
                  {!group.isMain && !group.isWallOfFame && (group.tags || []).length > 0 && (
                    <div className="flex flex-wrap gap-0.5 mt-0.5">
                      {(group.tags || []).slice(0, 3).map((tag: string) => (
                        <span key={tag} className="px-1.5 py-0.5 rounded-full text-[10px] bg-white/10 text-pnp-textSecondary">{tag}</span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {/* Telegram linked indicator */}
                  {group.telegramChatId && (
                    <span title="Telegram group linked">
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="#29A8E2" aria-hidden="true">
                        <path d="M21.8 2.3L2.1 9.7c-1.2.5-1.2 1.7-.2 2l4.8 1.5 1.8 5.6c.2.7 1 .9 1.5.4l2.7-2.7 5.3 3.9c1 .7 1.8.3 2-1L22.8 3.7c.3-1.3-.5-1.8-1-.4z" />
                      </svg>
                    </span>
                  )}
                  {/* "Link TG" hint — only for group creator/owner when not linked */}
                  {!group.telegramChatId && !group.isMain && !group.isWallOfFame && String(group.creatorId) === String(user?.dbId) && (
                    <span
                      className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
                      style={{ background: "rgba(41,168,226,0.12)", color: "#29A8E2", border: "1px solid rgba(41,168,226,0.2)" }}
                      title={`Run /link ${group.id} in your Telegram group`}
                    >
                      Link TG
                    </span>
                  )}
                  {/* Owner actions — ⋮ menu */}
                  {!group.isMain && !group.isWallOfFame && (isAdmin || String(group.creatorId) === String(user?.dbId)) && (
                    <div className="relative" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={(e) => {
                          if (groupCardMenuId !== group.id) {
                            const r = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
                            setGroupCardMenuPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
                          }
                          setGroupCardMenuId(groupCardMenuId === group.id ? null : group.id);
                        }}
                        className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-white/10 active:scale-95 transition-all"
                        aria-label="Group options"
                      >
                        <svg className="w-4 h-4 text-pnp-textSecondary" fill="currentColor" viewBox="0 0 24 24">
                          <circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" />
                        </svg>
                      </button>
                      {groupCardMenuId === group.id && createPortal(
                        <>
                          <div className="fixed inset-0 z-[150]" onClick={() => setGroupCardMenuId(null)} />
                          <div className="fixed z-[151] rounded-xl overflow-hidden shadow-xl min-w-[150px] max-w-[calc(100vw-16px)]" style={{ background: "var(--pnp-surface-hover)", border: "1px solid rgba(255,255,255,0.1)", top: groupCardMenuPos.top, right: groupCardMenuPos.right }}>
                            <button
                              onClick={() => {
                                setGroupCardMenuId(null);
                                setEditingGroup(group);
                                setEditingName(group.name);
                                setEditingDesc(group.description || "");
                                setEditingError(null);
                              }}
                              className="w-full px-4 py-3 text-sm text-left text-white hover:bg-white/10 transition-colors flex items-center gap-3"
                            >
                              <svg className="w-4 h-4 text-pnp-textSecondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                              Edit
                            </button>
                            <div className="border-t border-white/5" />
                            <button
                              onClick={() => { setGroupCardMenuId(null); handleDeleteGroup(group.id); }}
                              className="w-full px-4 py-3 text-sm text-left hover:bg-white/10 transition-colors flex items-center gap-3"
                              style={{ color: "#FF6B6B" }}
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                              Delete
                            </button>
                          </div>
                        </>,
                        document.body
                      )}
                    </div>
                  )}
                  {!group.isMain && (
                    <svg className="w-4 h-4 text-pnp-textSecondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  )}
                </div>
              </div>
              {/* Crystal Hangout — explicit dual-action row instead of whole-card tap.
                  Open Chat opens the regular thread; Join Main Stage enters the
                  official platform-wide video room. Equal weight, no ambiguity. */}
              {group.isMain && (
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => openChat(group)}
                    aria-label="Open chat"
                    className="min-h-[44px] flex items-center justify-center gap-2 rounded-xl text-xs font-bold text-white transition-all hover:bg-white/[0.10] active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent"
                    style={{
                      background: "rgba(255,255,255,0.06)",
                      border: "1px solid rgba(255,255,255,0.14)",
                    }}
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.76c0 1.6 1.123 2.994 2.707 3.227 1.068.157 2.148.279 3.238.364.466.037.893.281 1.153.671L12 21l2.652-3.978c.26-.39.687-.634 1.153-.67 1.09-.086 2.17-.208 3.238-.365 1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
                    </svg>
                    <span>Open Chat</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate("/main-stage")}
                    aria-label="Join Main Stage"
                    className="min-h-[44px] flex items-center justify-center gap-2 rounded-xl text-xs font-bold text-white transition-all hover:brightness-110 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent"
                    style={{
                      background: "linear-gradient(135deg,#D4007A,#7B61FF)",
                      border: "1px solid rgba(255,255,255,0.18)",
                      boxShadow: "0 4px 14px rgba(212,0,122,0.45)",
                    }}
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <rect x="3"  y="3"  width="8" height="8" rx="1.5" />
                      <rect x="13" y="3"  width="8" height="8" rx="1.5" />
                      <rect x="3"  y="13" width="8" height="8" rx="1.5" />
                      <rect x="13" y="13" width="8" height="8" rx="1.5" />
                    </svg>
                    <span>Join Main Stage</span>
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Discover Groups */}
      <div className="mt-6">
        <button
          onClick={() => {
            const next = !showDiscover;
            setShowDiscover(next);
            if (!next) { setDiscoverQuery(""); setDiscoverTagFilter(null); }
          }}
          className="flex items-center gap-2 mb-3 group w-full"
          aria-expanded={showDiscover}
          aria-controls="discover-groups-list"
        >
          <h2 className="text-sm font-semibold text-pnp-textPrimary group-hover:text-white transition-colors flex-1 text-left">
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
          <div id="discover-groups-list" className="space-y-2 animate-fade-in-up">
            {discoverLoading ? (
              <div className="space-y-2">
                {[0, 1, 2].map(i => (
                  <div key={i} className="glass-card-sm p-4 animate-pulse">
                    <div className="flex gap-3 items-center">
                      <div className="w-10 h-10 rounded-full flex-shrink-0" style={{ background: "var(--pnp-surface-hover)" }} />
                      <div className="flex-1 space-y-2">
                        <div className="h-4 rounded w-32" style={{ background: "var(--pnp-surface-hover)" }} />
                        <div className="h-3 rounded w-24" style={{ background: "var(--pnp-surface-hover)" }} />
                      </div>
                      <div className="h-8 w-16 rounded-lg flex-shrink-0" style={{ background: "var(--pnp-surface-hover)" }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : discoverError ? (
              <div className="text-center py-4">
                <p className="text-sm text-pnp-textSecondary mb-2">{discoverError}</p>
                <button onClick={() => { setDiscoverError(null); loadDiscover(); }} className="text-sm text-pnp-accent hover:underline">Retry</button>
              </div>
            ) : discoverList.length === 0 ? (
              <p className="text-sm text-pnp-textSecondary text-center py-4">No public groups to join yet.</p>
            ) : (
              <>
                {/* Discover search */}
                {/* Tag filter chips — shown above search for quick filtering */}
                <div className="flex flex-wrap gap-1.5 mb-2.5">
                  {[...new Set(["chill", "party", "dating", "music", "gaming", "art", "fitness", "travel", ...discoverList.flatMap((g: any) => g.tags || [])])].map((tag) => (
                    <button
                      key={tag}
                      onClick={() => setDiscoverTagFilter(discoverTagFilter === tag ? null : tag)}
                      className={`px-2.5 py-1 rounded-full text-[10px] font-medium transition-all active:scale-95 ${
                        discoverTagFilter === tag
                          ? "bg-pnp-accent text-white"
                          : "bg-white/10 text-pnp-textSecondary hover:bg-white/20"
                      }`}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
                <div className="mb-3 relative">
                  <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-pnp-textSecondary pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  <input
                    type="text"
                    value={discoverQuery}
                    placeholder="Search groups by name..."
                    className="w-full bg-white/5 rounded-lg pl-9 pr-3 py-2 text-pnp-textPrimary placeholder:text-pnp-textSecondary/50 focus:outline-none focus:ring-1 focus:ring-pnp-accent/50 transition-colors"
                    style={{ fontSize: "16px" }}
                    onChange={(e) => setDiscoverQuery(e.target.value)}
                  />
                  {discoverQuery && (
                    <button
                      onClick={() => setDiscoverQuery("")}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-white/10 flex items-center justify-center text-pnp-textSecondary hover:bg-white/20 transition-colors"
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
                {discoverList
                  .filter((g) => {
                    const q = discoverQuery.toLowerCase();
                    const matchesQuery = !q || g.name.toLowerCase().includes(q) || (g.description || "").toLowerCase().includes(q);
                    const matchesTag = !discoverTagFilter || (g.tags || []).includes(discoverTagFilter);
                    return matchesQuery && matchesTag;
                  })
                  .map((group) => (
                    <div key={group.id} className="glass-card-sm p-4">
                      <div className="flex gap-3 items-center">
                        {/* Discover group avatar */}
                        <div className="w-10 h-10 flex-shrink-0 relative">
                          {(group as any).avatarUrl ? (
                            <img src={(group as any).avatarUrl} alt="" className="w-10 h-10 rounded-full object-cover ring-1 ring-white/10" />
                          ) : (
                            <div
                              className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold"
                              style={{ background: "linear-gradient(135deg, rgba(212,0,122,0.25), rgba(123,97,255,0.25))", color: "#D4007A" }}
                            >
                              {(group.name?.[0] || "?").toUpperCase()}
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-pnp-textPrimary text-sm truncate">{group.name}</span>
                            {!group.isPublic && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-pnp-textSecondary flex-shrink-0">
                                {t.chat.labelPrivate}
                              </span>
                            )}
                            {(group as any).channelId && (group as any).channelAccessType && (group as any).channelAccessType !== "free" ? (
                              <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold flex-shrink-0"
                                style={
                                  (group as any).channelAccessType === "prime"
                                    ? { background: "rgba(167,139,250,0.15)", color: "#A78BFA" }
                                    : (group as any).channelAccessType === "subscription"
                                    ? { background: "rgba(212,0,122,0.15)", color: "#D4007A" }
                                    : { background: "rgba(230,145,56,0.15)", color: "#E69138" }
                                }
                              >
                                {(group as any).channelAccessType === "prime" ? "Prime" : (group as any).channelAccessType === "subscription" ? "Sub" : `$${Number((group as any).channelPriceUsd ?? 0).toFixed(0)}`}
                              </span>
                            ) : group.isPaid && (group.priceUsd ?? 0) > 0 ? (
                              <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold flex-shrink-0" style={{ background: "rgba(230,145,56,0.15)", color: "#E69138" }}>
                                ${Number(group.priceUsd).toFixed(2)}
                              </span>
                            ) : null}
                          </div>
                          <p className="text-xs text-pnp-textSecondary truncate mt-0.5">
                            {group.memberCount} {group.memberCount === 1 ? t.chat.membersSingular : t.chat.membersPlural}
                          </p>
                          {group.description && (
                            <p className="text-[10px] text-pnp-textSecondary truncate mt-0.5">{group.description}</p>
                          )}
                          {(group.tags || []).length > 0 && (
                            <div className="flex flex-wrap gap-0.5 mt-1">
                              {(group.tags || []).slice(0, 3).map((tag: string) => (
                                <span key={tag} className="px-1.5 py-0.5 rounded-full text-[10px] bg-white/10 text-pnp-textSecondary">{tag}</span>
                              ))}
                            </div>
                          )}
                        </div>
                        {group.isPublic ? (
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
                  ))}
              </>
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
                            <div className="w-8 h-8 rounded-full bg-pnp-surface flex items-center justify-center text-xs font-bold text-pnp-textPrimary flex-shrink-0 cursor-pointer" onClick={() => navigate(`/profile/${req.user_id}`)}>
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

      {/* Inline edit group modal */}
      {editingGroup && (
        <div
          className="fixed inset-0 z-[70] flex items-end justify-center"
          style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
          onClick={(e) => { if (e.target === e.currentTarget) setEditingGroup(null); }}
        >
          <div className="w-full max-w-lg rounded-t-2xl p-6 space-y-4" style={{ background: "var(--pnp-surface)", borderTop: "1px solid rgba(255,255,255,0.1)" }}>
            <div className="flex justify-center -mt-2 mb-2"><div className="w-10 h-1 rounded-full bg-white/20" /></div>
            <h3 className="text-base font-bold text-white">Edit Group</h3>
            <div className="space-y-3">
              <input
                type="text"
                value={editingName}
                onChange={(e) => setEditingName(e.target.value)}
                maxLength={80}
                placeholder="Group name"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-3 text-white placeholder-pnp-textSecondary outline-none focus:border-pnp-accent transition-colors"
                style={{ fontSize: "16px" }}
              />
              <textarea
                value={editingDesc}
                onChange={(e) => setEditingDesc(e.target.value)}
                maxLength={500}
                rows={3}
                placeholder="Description (optional)"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-3 text-white placeholder-pnp-textSecondary outline-none focus:border-pnp-accent transition-colors resize-none"
                style={{ fontSize: "16px" }}
              />
              {editingError && <p className="text-xs text-red-400">{editingError}</p>}
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setEditingGroup(null)}
                className="flex-1 py-3 rounded-xl text-sm font-semibold text-pnp-textSecondary border border-pnp-border hover:bg-white/5 transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveInlineEdit}
                disabled={editingSaving || !editingName.trim()}
                className="flex-1 py-3 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-50 active:scale-98"
                style={{ background: "linear-gradient(135deg, #7B61FF, #D4007A)" }}
              >
                {editingSaving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* In-app confirmation modal */}
      {confirmAction && (
        <div
          className="fixed inset-0 z-[70] flex items-end justify-center"
          style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
          onClick={(e) => { if (e.target === e.currentTarget && !confirmLoading) setConfirmAction(null); }}
        >
          <div className="w-full max-w-lg rounded-t-2xl p-6 space-y-4" style={{ background: "var(--pnp-surface)", borderTop: "1px solid rgba(255,255,255,0.1)" }}>
            <div className="flex justify-center -mt-2 mb-2"><div className="w-10 h-1 rounded-full bg-white/20" /></div>
            <h3 className="text-base font-bold text-white">{confirmAction.title}</h3>
            <p className="text-sm text-pnp-textSecondary">{confirmAction.message}</p>
            <div className="flex gap-3">
              <button
                onClick={() => !confirmLoading && setConfirmAction(null)}
                className="flex-1 py-3 rounded-xl text-sm font-semibold text-pnp-textSecondary border border-pnp-border hover:bg-white/5 active:scale-98 transition-all"
                disabled={confirmLoading}
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  setConfirmLoading(true);
                  try { await confirmAction.onConfirm(); setConfirmAction(null); }
                  catch { /* silent */ }
                  finally { setConfirmLoading(false); }
                }}
                disabled={confirmLoading}
                className="flex-1 py-3 rounded-xl text-sm font-semibold text-white active:scale-98 transition-all disabled:opacity-50"
                style={{ background: confirmAction.isDanger ? "#C0392B" : "linear-gradient(135deg, #D4007A, #E69138)" }}
              >
                {confirmLoading ? "Processing…" : confirmAction.title}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Event modals */}
      {showCreateEvent && (
        <CreateEventModal
          canCreateLive={false}
          userGroups={groups}
          onClose={() => setShowCreateEvent(false)}
          onCreated={() => {
            setShowCreateEvent(false);
            setEventKey((k) => k + 1);
            loadHangoutEvents();
          }}
        />
      )}

      {detailEvent && (
        <EventDetailModal
          event={detailEvent}
          onClose={() => setDetailEvent(null)}
          onRsvp={async (eventId, shouldRsvp) => {
            // Update locally
            setHangoutEvents((prev) =>
              prev.map((e) => e.id === eventId ? { ...e, userRsvpd: shouldRsvp, rsvpCount: e.rsvpCount + (shouldRsvp ? 1 : -1) } : e)
            );
          }}
          onUpdated={(updated) => {
            setHangoutEvents((prev) => prev.map((e) => e.id === updated.id ? updated : e));
            setDetailEvent(updated);
          }}
        />
      )}

      {/* ── Payment Gate Modal ─────────────────────────────────────────── */}
      {showPaymentGate && paymentGateInfo && (
        <div
          className="fixed inset-0 z-[60] flex items-end justify-center"
          style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
          onClick={(e) => { if (e.target === e.currentTarget) { setShowPaymentGate(false); setPgPolling(false); } }}
        >
          <div
            className="w-full max-w-md rounded-t-2xl p-5 pb-safe space-y-4"
            style={{ background: "var(--pnp-surface)", borderTop: "1px solid rgba(255,255,255,0.1)" }}
          >
            <div className="flex justify-center">
              <div className="w-10 h-1 rounded-full bg-white/20" />
            </div>

            {paymentGateInfo.accessType === 'prime' && (
              <>
                <div className="text-center">
                  <span className="text-3xl">👑</span>
                  <h3 className="text-lg font-bold text-white mt-2">PRIME Required</h3>
                  <p className="text-sm text-pnp-textSecondary mt-1">This hangout is exclusive to PRIME members</p>
                </div>
                <button
                  onClick={() => { setShowPaymentGate(false); navigate('/subscribe'); }}
                  className="w-full py-3 rounded-xl text-sm font-bold text-white"
                  style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
                >
                  Upgrade to PRIME
                </button>
              </>
            )}

            {paymentGateInfo.accessType === 'subscription' && (
              <>
                <div className="text-center">
                  <span className="text-3xl">🔒</span>
                  <h3 className="text-lg font-bold text-white mt-2">Creator Subscription</h3>
                  <p className="text-sm text-pnp-textSecondary mt-1">Subscribe to this creator to access their hangout</p>
                </div>
                <button
                  onClick={() => { setShowPaymentGate(false); if (paymentGateInfo.creatorId) navigate(`/profile/${paymentGateInfo.creatorId}`); }}
                  className="w-full py-3 rounded-xl text-sm font-bold text-white"
                  style={{ background: "linear-gradient(135deg, #8B5CF6, #D946EF)" }}
                >
                  Subscribe to Creator
                </button>
              </>
            )}

            {paymentGateInfo.accessType === 'paid' && (
              <>
                <div className="text-center">
                  <span className="text-3xl">🎟</span>
                  <h3 className="text-lg font-bold text-white mt-2">
                    {paymentGateInfo.channelName || paymentGateInfo.groupName || 'Hangout'}
                  </h3>
                  <p className="text-2xl font-black mt-1" style={{ color: "#E69138" }}>
                    ${paymentGateInfo.priceUsd?.toFixed(0)} USD
                  </p>
                  <p className="text-xs text-pnp-textSecondary mt-1">One-time access — includes video calls</p>
                </div>

                {pgPolling ? (
                  <div className="flex flex-col items-center gap-3 py-4">
                    <div className="w-8 h-8 border-2 border-pnp-accent border-t-transparent rounded-full animate-spin" />
                    <p className="text-sm text-pnp-textSecondary">Waiting for payment confirmation...</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-[10px] text-pnp-textSecondary text-center uppercase tracking-wider font-semibold">Choose payment method</p>
                    <button
                      onClick={() => handlePurchaseChannel('nowpayments')}
                      disabled={pgLoading}
                      className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold text-white transition-all active:scale-[0.98] disabled:opacity-50"
                      style={{ background: "linear-gradient(135deg, #6366F1, #8B5CF6)" }}
                    >
                      💳 Pay with Crypto (BTC, ETH, USDT…)
                    </button>
                    <button
                      onClick={() => handlePurchaseChannel('dash')}
                      disabled={pgLoading}
                      className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold text-white transition-all active:scale-[0.98] disabled:opacity-50"
                      style={{ background: "linear-gradient(135deg, #008DE4, #0066B2)" }}
                    >
                      🥷 Pay with Dash
                    </button>
                  </div>
                )}
              </>
            )}

            <button
              onClick={() => { setShowPaymentGate(false); setPgPolling(false); }}
              className="w-full py-2 text-sm text-pnp-textSecondary hover:text-white transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
