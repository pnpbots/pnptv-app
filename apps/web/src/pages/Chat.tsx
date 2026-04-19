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
  getPaymentStatus,
  ApiError,
  type HangoutGroup,
  type GroupMessage,
  type GroupMember,
  type DiscoverGroup,
  type JoinRequest,
  type SocialPostItem,
  type MessageReaction,
} from "@/lib/api";
import SocialPostCard from "@/components/social/SocialPostCard";
import { PostComposer } from "@/components/PostComposer";
import { HangoutEventReminder } from "@/components/events/HangoutEventReminder";
import { NearbyBadge } from "@/components/NearbyBadge";
import { SpotlightStrip } from "@/components/SpotlightStrip";
import { getUpcomingEvents } from "@/lib/api";
import type { EventItem } from "@/components/events/EventCard";
import { CreateEventModal } from "@/components/events/CreateEventModal";
import { EventDetailModal } from "@/components/events";
import { connectSocket } from "@/lib/socket";
import { MediaMessage } from "@/components/hangouts/MediaMessage";
import { VideoCallButton } from "@/components/hangouts/VideoCallButton";
import LiveKitCallDock from "@/components/hangouts/LiveKitCallDock";

type View = "list" | "chat";

// ─── Telegram helpers ────────────────────────────────────────────────────────

function getTelegramDeepLink(inviteLink: string): string {
  // https://t.me/+HASH → tg://join?invite=HASH
  const match = inviteLink.match(/t\.me\/\+(.+)/);
  return match ? `tg://join?invite=${match[1]}` : inviteLink;
}

// ─── HangoutChatPanel (PostgreSQL + Socket.IO) ──────────────────────────────

const API_BASE = import.meta.env.VITE_API_URL || "";

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}


function HangoutChatPanel({
  activeGroup,
  isOwnerOrMod,
  groupMembers,
}: {
  activeGroup: HangoutGroup;
  isOwnerOrMod: boolean;
  groupMembers: any[];
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

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const lastTypingEmit = useRef(0);
  const hasFetched = useRef<number | null>(null);
  const isNearBottom = useRef(true);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const ALLOWED_REACTIONS = ["😈", "❤️", "😆", "🔝", "🐷", "🍆", "🍑", "💨", "🚀"] as const;
  const QUICK_REACTIONS = ALLOWED_REACTIONS;

  const EMOJI_CATEGORIES = [
    { label: "Reactions", emojis: ALLOWED_REACTIONS },
  ] as const;

  // Emoji picker state
  const [emojiPickerMsgId, setEmojiPickerMsgId] = useState<number | null>(null);
  const [emojiPickerPos, setEmojiPickerPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Animated reaction state — key is "${msgId}-${emoji}"
  const [recentlyReacted, setRecentlyReacted] = useState<Set<string>>(new Set());

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
    // Keep panel inside viewport
    const PANEL_W = 280;
    const PANEL_H = 260;
    setEmojiPickerPos({
      x: Math.min(x, window.innerWidth - PANEL_W - 8),
      y: Math.max(8, Math.min(y, window.innerHeight - PANEL_H - 8)),
    });
  };

  const handleReactionWithAnimation = async (msgId: number, emoji: string) => {
    const key = `${msgId}-${emoji}`;
    setRecentlyReacted((prev) => new Set(prev).add(key));
    setTimeout(() => {
      setRecentlyReacted((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }, 300);
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
    longPressTimer.current = setTimeout(() => {
      setContextMenu({ msg, x: touch.clientX, y: touch.clientY });
    }, 500);
  };

  const handleTouchEnd = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
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

  const handleDeleteMsg = async (msg: GroupMessage) => {
    setContextMenu(null);
    try {
      await deleteGroupMessage(groupId, msg.id);
    } catch (err) {
      setChatError(err instanceof Error ? err.message : "Failed to delete");
    }
  };

  const handleReaction = async (msgId: number, emoji: string) => {
    setContextMenu(null);
    try {
      await toggleMessageReaction(groupId, msgId, emoji);
    } catch { /* silent */ }
  };

  const handleShareToFeed = async (msg: GroupMessage) => {
    setContextMenu(null);
    try {
      await dropToFeed(groupId, msg.id);
      setChatError('Shared to group feed!');
      setTimeout(() => setChatError(null), 2500);
    } catch {
      setChatError('Could not share to feed. Try again.');
    }
  };

  const isValidPhoto = (p: string | null | undefined) => p && (p.startsWith("/") || p.startsWith("http"));

  return (
    <div className="flex flex-col h-full relative">
      {chatError && (
        <div className="px-4 py-2 bg-red-500/10 border-b border-red-500/20 flex-shrink-0 flex items-center justify-between gap-2">
          <p className="text-xs text-red-400 flex-1">{chatError}</p>
          <button onClick={() => setChatError(null)} className="text-red-400/60 hover:text-red-400 flex-shrink-0 p-1">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
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
                    <div className={`flex gap-2 ${isMe ? "flex-row-reverse" : "flex-row"} ${grouped ? "" : "mt-2"}`}>
                      {!isMe && <div className="w-6 flex-shrink-0" />}
                      <div className="max-w-[75%] rounded-2xl px-3 py-1.5 text-xs italic text-pnp-textSecondary/50 bg-white/5">
                        Message deleted
                      </div>
                    </div>
                  ) : (
                    <div
                      className={`flex gap-2 ${isMe ? "flex-row-reverse" : "flex-row"} ${grouped ? "" : "mt-2"} group/msg`}
                      onContextMenu={(e) => handleContextMenu(msg, e)}
                      onTouchStart={(e) => handleTouchStart(msg, e)}
                      onTouchEnd={handleTouchEnd}
                      onTouchMove={handleTouchEnd}
                    >
                      {/* Avatar — only for first message in group, linked to profile */}
                      {!isMe && (
                        <div className="flex-shrink-0 mt-auto w-6" onClick={() => navigate(`/profile/${msg.user_id}`)} role="button" tabIndex={0}>
                          {!grouped ? (
                            isValidPhoto(msg.photo_url) ? (
                              <img src={msg.photo_url!} alt="" className="w-6 h-6 rounded-full object-cover cursor-pointer" />
                            ) : (
                              <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold cursor-pointer" style={{ background: "rgba(212,0,122,0.2)", color: "#D4007A" }}>
                                {(msg.first_name || msg.username || "?")[0].toUpperCase()}
                              </div>
                            )
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
                            <div className="mb-1 pl-2 border-l-2 border-white/30 text-[10px] text-white/60">
                              <span className="font-semibold">{msg.reply_to.name}</span>: {msg.reply_to.content?.slice(0, 80)}
                            </div>
                          )}
                          {msg.content && <p>{msg.content}</p>}
                          <div className={`flex items-center gap-1 mt-0.5 ${isMe ? "justify-end" : ""}`}>
                            <span className={`text-[10px] ${isMe ? "text-white/60" : "text-pnp-textSecondary"}`}>{timeStr}</span>
                            {msg.edited_at && <span className={`text-[10px] ${isMe ? "text-white/40" : "text-pnp-textSecondary/60"}`}>(edited)</span>}
                          </div>
                        </div>

                        {/* Reactions display */}
                        {msg.reactions && (msg.reactions as MessageReaction[]).length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-0.5 px-1">
                            {(msg.reactions as MessageReaction[]).map((r) => {
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
                                    onClick={() => handleReactionWithAnimation(msg.id, r.emoji)}
                                    className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[11px] transition-all active:scale-95 ${
                                      recentlyReacted.has(animKey) ? "scale-110" : ""
                                    } ${
                                      r.reacted_by_me
                                        ? "bg-pnp-accent/20 ring-1 ring-pnp-accent/40"
                                        : "bg-white/5 hover:bg-white/10"
                                    }`}
                                  >
                                    <span>{r.emoji}</span>
                                    <span className="text-[10px] text-pnp-textSecondary">{r.count}</span>
                                  </button>
                                  {reactorNames.length > 0 && (
                                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 hidden group-hover/rxn:block z-50 pointer-events-none">
                                      <div
                                        className="rounded-lg px-2 py-1 text-[10px] text-white whitespace-nowrap shadow-xl"
                                        style={{ background: "#1C1C1E", border: "1px solid rgba(255,255,255,0.12)", maxWidth: "200px", whiteSpace: "normal", textAlign: "center" }}
                                      >
                                        {tooltipText}
                                      </div>
                                      <div className="w-2 h-2 rotate-45 mx-auto -mt-1" style={{ background: "#1C1C1E" }} />
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {/* Quick reaction row — visible on hover (desktop) */}
                        <div className={`hidden group-hover/msg:flex items-center gap-0.5 mt-0.5 px-1 ${isMe ? "flex-row-reverse" : ""}`}>
                          {QUICK_REACTIONS.map((emoji) => (
                            <button
                              key={emoji}
                              onClick={() => handleReactionWithAnimation(msg.id, emoji)}
                              className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-white/10 active:scale-90 transition-all text-xs"
                            >
                              {emoji}
                            </button>
                          ))}
                          <button
                            onClick={(e) => { e.stopPropagation(); openEmojiPicker(msg.id, e.clientX, e.clientY); }}
                            className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-white/10 active:scale-90 transition-all text-xs text-pnp-textSecondary font-bold"
                            title="More emojis"
                          >+</button>
                          <button
                            onClick={() => startReply(msg)}
                            className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-white/10 active:scale-90 transition-all"
                            title="Reply"
                          >
                            <svg className="w-3 h-3 text-pnp-textSecondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                            </svg>
                          </button>
                        </div>
                      </div>
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

      {/* Context menu */}
      {contextMenu && (
        <>
          <div className="fixed inset-0 z-50" onClick={() => setContextMenu(null)} />
          <div
            className="fixed z-50 rounded-xl overflow-hidden shadow-xl py-1 min-w-[160px] animate-fade-in-up"
            style={{
              background: "#2C2C2E",
              border: "1px solid rgba(255,255,255,0.1)",
              left: Math.min(contextMenu.x, window.innerWidth - 192),
              top: Math.min(contextMenu.y, window.innerHeight - 320),
            }}
          >
            {/* Quick reactions in context menu */}
            <div className="flex items-center justify-center gap-1 px-2 py-2 border-b border-white/5">
              {QUICK_REACTIONS.slice(0, 6).map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => handleReactionWithAnimation(contextMenu.msg.id, emoji)}
                  className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 active:scale-90 transition-all text-base"
                >
                  {emoji}
                </button>
              ))}
              <button
                onClick={(e) => { e.stopPropagation(); openEmojiPicker(contextMenu.msg.id, e.clientX, e.clientY); }}
                className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 active:scale-90 transition-all text-sm text-pnp-textSecondary font-bold"
                title="More emojis"
              >+</button>
            </div>
            {contextMenu.msg.media_url && (
              <button
                onClick={() => handleShareToFeed(contextMenu.msg)}
                className="w-full px-4 py-2.5 text-sm text-left text-white hover:bg-white/10 transition-colors flex items-center gap-3"
              >
                <svg className="w-4 h-4 text-pnp-textSecondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z" />
                </svg>
                Share to Feed
              </button>
            )}
            <button
              onClick={() => startReply(contextMenu.msg)}
              className="w-full px-4 py-2.5 text-sm text-left text-white hover:bg-white/10 transition-colors flex items-center gap-3"
            >
              <svg className="w-4 h-4 text-pnp-textSecondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
              </svg>
              Reply
            </button>
            {String(contextMenu.msg.user_id) === String(myId) && (
              <>
                <button
                  onClick={() => startEdit(contextMenu.msg)}
                  className="w-full px-4 py-2.5 text-sm text-left text-white hover:bg-white/10 transition-colors flex items-center gap-3"
                >
                  <svg className="w-4 h-4 text-pnp-textSecondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
                  </svg>
                  Edit
                </button>
                <div className="border-t border-white/5" />
                <button
                  onClick={() => handleDeleteMsg(contextMenu.msg)}
                  className="w-full px-4 py-2.5 text-sm text-left text-red-400 hover:bg-white/10 transition-colors flex items-center gap-3"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  Delete
                </button>
              </>
            )}
            {isOwnerOrMod && String(contextMenu.msg.user_id) !== String(myId) && (
              <>
                <div className="border-t border-white/5" />
                <button
                  onClick={() => handleDeleteMsg(contextMenu.msg)}
                  className="w-full px-4 py-2.5 text-sm text-left text-red-400 hover:bg-white/10 transition-colors flex items-center gap-3"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  Delete
                </button>
              </>
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
              left: emojiPickerPos.x,
              top: emojiPickerPos.y,
              width: 280,
              background: "#1C1C1E",
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
            <div className="overflow-y-auto" style={{ maxHeight: 220 }}>
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

      {/* Typing indicator */}
      {typingNames.length > 0 && (
        <div className="px-4 py-1 flex-shrink-0">
          <p className="text-xs text-pnp-textSecondary italic">
            {typingNames.join(", ")} {typingNames.length === 1 ? "is" : "are"} typing...
          </p>
        </div>
      )}

      {/* Reply bar */}
      {replyTo && !editingMsg && (
        <div className="px-3 py-2 border-t border-pnp-border flex items-center gap-2 flex-shrink-0 bg-white/5">
          <div className="w-1 h-8 rounded-full flex-shrink-0" style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }} />
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-semibold text-pnp-accent">{replyTo.first_name || replyTo.username || "User"}</p>
            <p className="text-xs text-pnp-textSecondary truncate">{replyTo.content?.slice(0, 80) || (replyTo.media_type ? "Media" : "")}</p>
          </div>
          <button onClick={() => setReplyTo(null)} className="text-pnp-textSecondary hover:text-white p-1 flex-shrink-0">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
      )}

      {/* Edit bar */}
      {editingMsg && (
        <div className="px-3 py-2 border-t border-pnp-border flex items-center gap-2 flex-shrink-0 bg-blue-500/5">
          <div className="w-1 h-8 rounded-full bg-blue-400 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-semibold text-blue-400">Editing message</p>
            <p className="text-xs text-pnp-textSecondary truncate">{editingMsg.content?.slice(0, 80)}</p>
          </div>
          <button onClick={cancelEdit} className="text-pnp-textSecondary hover:text-white p-1 flex-shrink-0">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
      )}

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
          <>
            <input ref={mediaInputRef} type="file" accept="image/*,video/*,audio/*" className="hidden" onChange={handleMediaSelect} />
            <button type="button" onClick={() => mediaInputRef.current?.click()} className="w-10 h-10 flex items-center justify-center rounded-full text-pnp-textSecondary hover:text-white hover:bg-white/10 active:scale-90 transition-all flex-shrink-0 mb-0.5" aria-label="Attach media">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13" />
              </svg>
            </button>
          </>
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
  const [pgProvider, setPgProvider] = useState<'epayco' | 'dash'>('epayco');
  const [pgLoading, setPgLoading] = useState(false);
  const [pgPolling, setPgPolling] = useState(false);

  // Join requests management (for creators)
  const [joinRequests, setJoinRequests] = useState<Record<number, JoinRequest[]>>({});
  const [showRequests, setShowRequests] = useState<number | null>(null);

  // Chat view state
  const [view, setView] = useState<View>("list");
  const [activeGroup, setActiveGroup] = useState<HangoutGroup | null>(null);

  // Group members (loaded on chat open for member management panels)
  const [groupMembers, setGroupMembers] = useState<any[]>([]);

  // Socket hook — presence + socket connection state
  const {
    isConnected,
    onlineMembers,
  } = useHangoutSocket(activeGroup?.id ?? null, user?.dbId);

  // Video call / general chat error
  const [chatError, setChatError] = useState<string | null>(null);

  // Create group error
  const [createError, setCreateError] = useState<string | null>(null);

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
  // Button click opens the pre-join card; the network call is deferred until
  // the user confirms their mic/cam in `handleConfirmJoinCall` below.
  const handleStartCall = useCallback(() => {
    if (!activeGroup?.id) return;
    setCallError(null);
    setShowCallPreview(true);
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
      const hasActive = activeGroup.hasActiveCall;
      let result: { token: string; livekitUrl: string; roomName: string };
      if (hasActive) {
        try {
          result = await joinHangoutCall(activeGroup.id);
        } catch (joinErr: unknown) {
          // 404 means the active call already ended — fall through to start
          if (joinErr instanceof ApiError && joinErr.status === 404) {
            result = await startHangoutCall(activeGroup.id);
          } else {
            throw joinErr;
          }
        }
      } else {
        result = await startHangoutCall(activeGroup.id);
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
        if (err.code === "TIER_NOT_ELIGIBLE_FOR_CALLS") {
          setCallError("Your plan doesn't include video calls. Upgrade to join or host a call.");
        } else if (err.code === "CALL_PARTICIPANT_LIMIT_REACHED") {
          setCallError(err.message || "This call is full. Try again when someone leaves.");
        } else if (err.code === "CALL_ROOMS_PER_DAY_EXCEEDED") {
          setCallError(err.message || "You've hit your daily call limit. Try again tomorrow.");
        } else if (err.status === 403) {
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
      // Standalone paid hangouts are fixed at $5
      const paidPrice = isPaidEffective ? 5 : 0;
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
      setNewPrice("");
      setNewRules("");
      setNewTags([]);
      setNewReadOnly(false);
      setNewSlowMode(0);
      setNewFeedVisibility("public");
      setNewChannelId(null);
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
  const handlePurchaseChannel = async () => {
    if (!paymentGateInfo) return;
    const { channelId, groupId } = paymentGateInfo;
    if (!channelId && !groupId) return;
    setPgLoading(true);
    try {
      const res = channelId
        ? await purchaseChannelAccess(channelId, pgProvider)
        : await purchaseHangoutAccess(groupId, pgProvider);
      if (pgProvider === 'epayco' && res.paymentUrl) {
        window.open(res.paymentUrl, '_blank');
      } else if (pgProvider === 'dash' && res.checkoutUrl) {
        window.open(res.checkoutUrl, '_blank');
      }
      setPgPolling(true);
      const pollId = res.paymentId;
      const interval = setInterval(async () => {
        try {
          const status = await getPaymentStatus(pollId);
          if (['completed', 'paid', 'success'].includes(status.status)) {
            clearInterval(interval);
            setPgPolling(false);
            setShowPaymentGate(false);
            setPaymentGateInfo(null);
            loadGroups();
            loadDiscover();
          }
        } catch {}
      }, 5000);
      setTimeout(() => { clearInterval(interval); setPgPolling(false); }, 600000);
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
            {/* Video call button — opens LiveKit call panel */}
            <VideoCallButton
              hasActiveCall={showTelegramDock || !!activeGroup?.hasActiveCall}
              participantCount={callParticipantCount}
              onStartCall={handleStartCall}
              isLoading={false}
            />

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
                  <div className="fixed z-[71] rounded-xl overflow-hidden shadow-xl min-w-[200px]" style={{ background: "#2C2C2E", border: "1px solid rgba(255,255,255,0.1)", top: groupMenuPos.top, right: groupMenuPos.right }}>
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
              style={{ maxHeight: "60dvh", background: "#1C1C1E", borderTop: "1px solid rgba(255,255,255,0.1)" }}
            >
              {/* Drag handle */}
              <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
                <div className="w-10 h-1 rounded-full" style={{ background: "rgba(255,255,255,0.2)" }} />
              </div>
              {/* Panel header */}
              <div className="flex items-center justify-between px-5 pt-4 pb-3 flex-shrink-0">
                <div>
                  <p className="text-sm font-semibold text-white">{t.chat.onlineNow}</p>
                  <p className="text-xs" style={{ color: "#8E8E93" }}>{t.chat.onlineOfTotal(onlineMembers.length, activeGroup.memberCount)}</p>
                </div>
                <button
                  onClick={() => setShowOnline(false)}
                  className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors"
                  style={{ color: "#8E8E93" }}
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
                  <p className="text-center text-sm py-6" style={{ color: "#8E8E93" }}>{t.chat.noOtherMembersOnline}</p>
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
              style={{ maxHeight: "80dvh", background: "#1C1C1E", borderTop: "1px solid rgba(255,255,255,0.1)" }}
            >
              <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
                <div className="w-10 h-1 rounded-full" style={{ background: "rgba(255,255,255,0.2)" }} />
              </div>
              <div className="flex items-center justify-between px-5 pt-2 pb-3 flex-shrink-0">
                <p className="text-sm font-semibold text-white">Group Settings</p>
                <button onClick={() => setShowSettings(false)} className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-white/10" style={{ color: "#8E8E93" }} aria-label="Close settings">
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
                    {(String(activeGroup.creatorId) === String(user?.dbId) || isAdmin) && (
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
                              accept="image/jpeg,image/png,image/webp,image/gif"
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

                          {/* Transfer Ownership */}
                          {String(activeGroup.creatorId) === String(user?.dbId) && (
                            <button
                              onClick={() => {
                                setConfirmAction({
                                  title: "Transfer Ownership",
                                  message: "Select a member to transfer ownership to from the Members panel.",
                                  onConfirm: async () => { setShowSettings(false); setShowOnline(true); },
                                });
                              }}
                              className="w-full px-3 py-2.5 rounded-lg bg-white/5 text-sm text-left text-yellow-400 hover:bg-white/10 transition-colors"
                            >
                              Transfer Ownership
                            </button>
                          )}
                        </div>

                        {/* Members Management */}
                        <div className="border-t border-white/10 pt-4">
                          <p className="text-xs font-semibold text-pnp-textSecondary mb-2 uppercase tracking-wider">Members ({groupMembers.length})</p>
                          <div className="space-y-1 max-h-48 overflow-y-auto">
                            {groupMembers.map((m: any) => {
                              const isMe = String(m.user_id) === String(user?.dbId);
                              const isOwner = m.role === "owner";
                              const isMod = m.role === "moderator";
                              const canManage = !isMe && !isOwner && (String(activeGroup.creatorId) === String(user?.dbId) || isAdmin);
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
                                          <div className="absolute right-0 top-8 z-40 rounded-xl overflow-hidden shadow-xl min-w-[140px] py-1" style={{ background: "#2C2C2E", border: "1px solid rgba(255,255,255,0.1)" }}>
                                            {!isMod && !m.is_banned && (
                                              <button onClick={async () => { setMemberActionMenu(null); setMemberActionLoading(m.user_id); await promoteHangoutMember(activeGroup.id, m.user_id).catch(() => {}); loadGroupDetail(activeGroup.id); setMemberActionLoading(null); }} className="w-full px-3 py-2 text-xs text-left text-blue-400 hover:bg-white/10">Promote to Mod</button>
                                            )}
                                            {isMod && (
                                              <button onClick={async () => { setMemberActionMenu(null); setMemberActionLoading(m.user_id); await demoteHangoutMember(activeGroup.id, m.user_id).catch(() => {}); loadGroupDetail(activeGroup.id); setMemberActionLoading(null); }} className="w-full px-3 py-2 text-xs text-left text-yellow-400 hover:bg-white/10">Demote</button>
                                            )}
                                            {!m.is_muted && !m.is_banned && (
                                              <button onClick={async () => { setMemberActionMenu(null); setMemberActionLoading(m.user_id); await muteHangoutMember(activeGroup.id, m.user_id, 60).catch(() => {}); loadGroupDetail(activeGroup.id); setMemberActionLoading(null); }} className="w-full px-3 py-2 text-xs text-left text-orange-400 hover:bg-white/10">Mute (1h)</button>
                                            )}
                                            {m.is_muted && (
                                              <button onClick={async () => { setMemberActionMenu(null); setMemberActionLoading(m.user_id); await unmuteHangoutMember(activeGroup.id, m.user_id).catch(() => {}); loadGroupDetail(activeGroup.id); setMemberActionLoading(null); }} className="w-full px-3 py-2 text-xs text-left text-green-400 hover:bg-white/10">Unmute</button>
                                            )}
                                            <div className="border-t border-white/5 my-0.5" />
                                            <button onClick={() => { setMemberActionMenu(null); setConfirmAction({ title: "Kick Member", message: `Remove ${m.first_name || m.username} from the group?`, isDanger: true, onConfirm: async () => { await kickHangoutMember(activeGroup.id, m.user_id); loadGroupDetail(activeGroup.id); loadGroups(); } }); }} className="w-full px-3 py-2 text-xs text-left text-red-400 hover:bg-white/10">Kick</button>
                                            {!m.is_banned ? (
                                              <button onClick={() => { setMemberActionMenu(null); setConfirmAction({ title: "Ban Member", message: `Ban ${m.first_name || m.username}? They won't be able to rejoin.`, isDanger: true, onConfirm: async () => { await banHangoutMember(activeGroup.id, m.user_id); loadGroupDetail(activeGroup.id); } }); }} className="w-full px-3 py-2 text-xs text-left text-red-500 hover:bg-white/10">Ban</button>
                                            ) : (
                                              <button onClick={async () => { setMemberActionMenu(null); setMemberActionLoading(m.user_id); await unbanHangoutMember(activeGroup.id, m.user_id).catch(() => {}); loadGroupDetail(activeGroup.id); setMemberActionLoading(null); }} className="w-full px-3 py-2 text-xs text-left text-green-400 hover:bg-white/10">Unban</button>
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
                      try {
                        await deleteSocialPost(id);
                        setHangoutFeedPosts((prev) => prev.filter((p) => p.id !== id));
                      } catch {}
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
            <div className="w-full max-w-lg rounded-t-2xl p-6 space-y-4" style={{ background: "#1C1C1E", borderTop: "1px solid rgba(255,255,255,0.1)" }}>
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
      <div className="flex items-center justify-between mb-6">
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
        emptyAction={isPrime ? () => setShowCreate(true) : undefined}
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
                  {newIsPaid ? "Paid Hangout" : "Free Hangout"}
                </span>
                <span className="text-[11px] text-pnp-textSecondary">
                  {newIsPaid ? "Members pay to join" : "Anyone can join for free"}
                </span>
              </div>
            </div>
            <div className={`w-10 rounded-full transition-colors relative ${newIsPaid ? "bg-amber-500" : "bg-white/20"}`} style={{ width: 40, height: 22 }}>
              <div className={`absolute top-0.5 w-[18px] h-[18px] rounded-full bg-white transition-transform shadow-sm ${newIsPaid ? "translate-x-[19px]" : "translate-x-[2px]"}`} />
            </div>
          </button>}

          {/* Standalone paid hangout: fixed $5 price info */}
          {!newChannelId && newIsPaid && (
            <div className="px-3 py-2.5 rounded-xl" style={{ background: "rgba(230,145,56,0.1)", border: "1px solid rgba(230,145,56,0.2)" }}>
              <p className="text-sm font-semibold text-amber-400">$5.00 entry fee</p>
              <p className="text-[11px] text-white/40 mt-0.5">Standalone hangouts have a fixed $5 entry fee.</p>
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

          {/* Action buttons */}
          <div className="flex gap-2">
            <button
              onClick={() => { setShowCreate(false); setCreateError(null); setNewTags([]); }}
              className="flex-1 py-2.5 rounded-xl text-sm text-pnp-textSecondary border border-white/10 hover:bg-white/5 active:scale-[0.98] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent"
            >
              {t.chat.cancel}
            </button>
            <button
              onClick={handleCreate}
              disabled={!newName.trim() || creating}
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
              onClick={() => openChat(group)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openChat(group); } }}
              className="w-full glass-card-sm p-3 sm:p-4 text-left hover:border-white/20 active:scale-[0.97] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent cursor-pointer"
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
                        ? "linear-gradient(135deg, #D4007A, #E69138)"
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
                    <span className="text-xs flex-shrink-0 text-pnp-textSecondary">
                      {group.memberCount} {group.memberCount === 1 ? t.chat.membersSingular : t.chat.membersPlural}
                    </span>
                    {group.lastMessage && (
                      <span className="text-xs truncate min-w-0 text-pnp-textSecondary">
                        &middot; {group.lastMessage}
                      </span>
                    )}
                  </div>
                  {/* Description */}
                  {!group.isWallOfFame && group.description && (
                    <p className="text-xs text-pnp-textSecondary truncate mt-0.5">{group.description}</p>
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
                          <div className="fixed z-[151] rounded-xl overflow-hidden shadow-xl min-w-[150px]" style={{ background: "#2C2C2E", border: "1px solid rgba(255,255,255,0.1)", top: groupCardMenuPos.top, right: groupCardMenuPos.right }}>
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
                  <svg className="w-4 h-4 text-pnp-textSecondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </div>
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
                      <div className="w-10 h-10 rounded-full flex-shrink-0" style={{ background: "#2C2C2E" }} />
                      <div className="flex-1 space-y-2">
                        <div className="h-4 rounded w-32" style={{ background: "#2C2C2E" }} />
                        <div className="h-3 rounded w-24" style={{ background: "#2C2C2E" }} />
                      </div>
                      <div className="h-8 w-16 rounded-lg flex-shrink-0" style={{ background: "#2C2C2E" }} />
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
          <div className="w-full max-w-lg rounded-t-2xl p-6 space-y-4" style={{ background: "#1C1C1E", borderTop: "1px solid rgba(255,255,255,0.1)" }}>
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
          <div className="w-full max-w-lg rounded-t-2xl p-6 space-y-4" style={{ background: "#1C1C1E", borderTop: "1px solid rgba(255,255,255,0.1)" }}>
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
            style={{ background: "#1C1C1E", borderTop: "1px solid rgba(255,255,255,0.1)" }}
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
                      onClick={() => { setPgProvider('epayco'); handlePurchaseChannel(); }}
                      disabled={pgLoading}
                      className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold text-white transition-all active:scale-[0.98] disabled:opacity-50"
                      style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
                    >
                      Pay with Card
                    </button>
                    <button
                      onClick={() => { setPgProvider('dash'); handlePurchaseChannel(); }}
                      disabled={pgLoading}
                      className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold text-white transition-all active:scale-[0.98] disabled:opacity-50"
                      style={{ background: "linear-gradient(135deg, #008DE4, #0066B2)" }}
                    >
                      🥷 Pay with Dash (Crypto)
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
