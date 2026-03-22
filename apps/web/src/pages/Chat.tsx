import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  memo,
} from "react";
import { Helmet } from "react-helmet-async";
import { useNavigate, useParams } from "react-router-dom";
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
  getOrCreateHangoutRoom,
  sendHangoutMessage,
  getHangoutGroup,
  kickHangoutMember,
  banHangoutMember,
  unbanHangoutMember,
  muteHangoutMember,
  unmuteHangoutMember,
  promoteHangoutMember,
  demoteHangoutMember,
  pinHangoutMessage,
  unpinHangoutMessage,
  getHangoutPins,
  updateHangoutSettings,
  transferHangoutOwnership,
  getHangoutInviteLink,
  updateHangoutNotification,
  deleteHangoutMessage,
  reactToChatMessage,
  getChatReactions,
  updateHangoutGroup,
  uploadGroupAvatar,
  kickGroupMember,
  updateMemberRole,
  type HangoutGroup,
  type GroupMessage,
  type GroupMember,
  type StartCallResponse,
  type GetActiveCallResponse,
  type DiscoverGroup,
  type JoinRequest,
} from "@/lib/api";
import {
  useRoomMessages,
  sendMatrixMessage,
  sendMatrixReply,
  sendReadReceipt,
  sendReaction,
  redactEvent,
  useRoomReactions,
  getMatrixClient,
  type ReactionEntry,
} from "@/hooks/useMatrix";
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
import { HangoutEventReminder } from "@/components/events/HangoutEventReminder";
import { NearbyBadge, useNearbyToggle } from "@/components/NearbyBadge";
import { SpotlightStrip, type SpotlightItem } from "@/components/SpotlightStrip";
import { getUpcomingEvents } from "@/lib/api";
import type { EventItem } from "@/components/events/EventCard";
import { CreateEventModal } from "@/components/events/CreateEventModal";
import { EventDetailModal } from "@/components/events";
import { HangoutsPaywall } from "@/components/HangoutsPaywall";
import { ApiError } from "@/lib/api";

const API_BASE = import.meta.env.VITE_API_URL || "https://pnptv.app";

// ─── Reaction emojis (PNP-themed) ──────────────────────────────────────────

const QUICK_REACTIONS = ["❤️", "😈", "💨", "🧊", "💎", "🔥", "👹", "🍆", "🍑"];
const EXTENDED_REACTIONS = ["❤️", "😈", "💨", "🧊", "💎", "🔥", "👹", "🍆", "🍑", "😍", "🤤", "👅", "💦", "🥵", "😏", "🤪", "💜", "🖤", "⚡", "🌈", "👑", "🫦", "🫠", "😮‍💨"];

// ─── Utilities ──────────────────────────────────────────────────────────────

function isValidPhotoUrl(photo: string | null | undefined): photo is string {
  return !!photo && (photo.startsWith("/") || photo.startsWith("http"));
}

/** Extract the telegram/db ID from a Matrix user ID like @pnptv_1234567:matrix.pnptv.app → "1234567" */
function telegramIdFromMatrixId(matrixId: string): string {
  return matrixId.split(":")[0].replace(/^@pnptv_/, "").replace(/^@/, "");
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
  currentUserId?: string;
  /** Matrix event ID for this message (for reactions) */
  matrixEventId?: string;
  /** Reactions on this message */
  reactions?: ReactionEntry[];
  /** Called when user toggles a reaction emoji */
  onReaction?: (eventId: string, emoji: string) => void;
  /** Called when user taps reply */
  onReply?: (msg: GroupMessage) => void;
  /** Quoted reply reference */
  replyTo?: { name: string; content: string } | null;
  /** Called when owner/mod pins a message */
  onPin?: (eventId: string, body: string) => void;
  /** Called when owner/mod deletes a message */
  onDelete?: (eventId: string) => void;
  /** Whether the current viewer is owner or mod */
  isOwnerOrMod?: boolean;
}

const MessageBubble = memo(function MessageBubble({
  msg,
  isMe,
  userLang,
  onNavigate,
  onExpandImage,
  currentUserId,
  matrixEventId,
  reactions,
  onReaction,
  onReply,
  replyTo,
  onPin,
  onDelete,
  isOwnerOrMod,
}: MessageBubbleProps) {
  const profilePath = isMe ? "/profile" : `/profile/${msg.user_id}`;
  const hasMedia = !!(msg.media_url && msg.media_type);
  const hasText = !!(msg.content && msg.content.trim());
  const [translatedContent, setTranslatedContent] = useState<string | null>(null);
  const [isTranslating, setIsTranslating] = useState(false);
  const [avatarError, setAvatarError] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const [showFullReactions, setShowFullReactions] = useState(false);
  const showAvatarFallback = !isValidPhotoUrl(msg.photo_url) || avatarError;
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleTranslate = useCallback(async () => {
    if (isTranslating) return;
    if (translatedContent) { setTranslatedContent(null); return; }
    if (!msg.content) return;
    setIsTranslating(true);
    const result = await translateText(msg.content, userLang || "en");
    if (result) setTranslatedContent(result);
    setIsTranslating(false);
  }, [isTranslating, translatedContent, msg.content, userLang]);

  // Long-press to show action bar on mobile
  const touchStartPos = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('[data-action-bar]')) return;
    touchStartPos.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    longPressTimer.current = setTimeout(() => {
      setShowActions(true);
      // Haptic feedback if available
      try { navigator.vibrate?.(30); } catch {}
    }, 400);
  }, []);
  const onTouchMove = useCallback((e: React.TouchEvent) => {
    // Cancel long-press if finger moved more than 10px (user is scrolling)
    if (longPressTimer.current && touchStartPos.current) {
      const dx = Math.abs(e.touches[0].clientX - touchStartPos.current.x);
      const dy = Math.abs(e.touches[0].clientY - touchStartPos.current.y);
      if (dx > 10 || dy > 10) {
        clearTimeout(longPressTimer.current);
        longPressTimer.current = null;
      }
    }
  }, []);
  const onTouchEnd = useCallback(() => {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
  }, []);

  return (
    <div className={`flex gap-2 ${isMe ? "flex-row-reverse" : ""}`}>
      {/* Avatar */}
      <button
        onClick={() => onNavigate(profilePath)}
        className="w-11 h-11 flex items-center justify-center rounded-full flex-shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent"
        aria-label={`View ${msg.first_name || msg.username || "user"}'s profile`}
      >
        {!showAvatarFallback && (
          <img
            src={msg.photo_url!}
            alt=""
            className="w-8 h-8 rounded-full object-cover"
            onError={() => setAvatarError(true)}
          />
        )}
        {showAvatarFallback && (
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
            style={{ background: "linear-gradient(135deg, #D4007A, #E69138)", color: "#fff" }}
          >
            {(msg.first_name || msg.username || "?")[0].toUpperCase()}
          </div>
        )}
      </button>

      {/* Bubble */}
      <div
        className={`max-w-[75%] ${isMe ? "text-right items-end" : "items-start"} flex flex-col group`}
        onClick={(e) => {
          // Toggle action bar on tap (mobile-friendly)
          const target = e.target as HTMLElement;
          if (target.closest('[data-action-bar]')) return; // Don't toggle if tapping action buttons
          setShowActions((prev) => !prev);
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
      >
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

        {/* Reply quote */}
        {replyTo && (
          <div
            className={`rounded-xl px-2.5 py-1.5 mb-1 text-[11px] border-l-2 ${isMe ? "self-end" : "self-start"}`}
            style={{ background: "rgba(255,255,255,0.04)", borderColor: "#D4007A", color: "#8E8E93" }}
          >
            <span className="font-semibold" style={{ color: "#D4007A" }}>{replyTo.name}</span>
            <p className="truncate max-w-[200px]">{replyTo.content}</p>
          </div>
        )}

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

        {/* Reaction pills */}
        {reactions && reactions.length > 0 && (
          <div className={`flex flex-wrap gap-1 mt-1 ${isMe ? "justify-end" : ""}`}>
            {reactions.map((r) => {
              const myReaction = currentUserId && r.users.some((u) => u.userId === currentUserId);
              return (
                <button
                  key={r.emoji}
                  onClick={() => matrixEventId && onReaction?.(matrixEventId, r.emoji)}
                  className={`flex items-center gap-0.5 px-1.5 h-6 rounded-full text-xs border transition-all active:scale-95 ${
                    myReaction
                      ? "bg-pnp-accent/20 border-pnp-accent"
                      : "bg-white/5 border-white/10 hover:bg-white/10"
                  }`}
                >
                  <span>{r.emoji}</span>
                  <span className="text-[10px]" style={{ color: myReaction ? "#D4007A" : "#8E8E93" }}>{r.count}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Quick-react + reply — visible on hover (desktop) or long-press (mobile) */}
        {matrixEventId && (
          <div
            data-action-bar
            className={`flex flex-wrap items-center gap-0.5 mt-0.5 transition-opacity ${showFullReactions ? "max-w-[200px] p-1.5 rounded-xl bg-black/40 backdrop-blur-sm" : ""} ${showActions ? "opacity-100" : "opacity-0 group-hover:opacity-100"} ${isMe ? "justify-end" : ""}`}
            onTouchStart={(e) => e.stopPropagation()}
          >
            {(showFullReactions ? EXTENDED_REACTIONS : QUICK_REACTIONS.slice(0, 6)).map((emoji) => (
              <button
                key={emoji}
                onTouchEnd={(e) => { e.stopPropagation(); onReaction?.(matrixEventId, emoji); setShowActions(false); setShowFullReactions(false); }}
                onClick={() => { onReaction?.(matrixEventId, emoji); setShowActions(false); setShowFullReactions(false); }}
                className="text-sm hover:scale-125 active:scale-125 transition-transform p-0.5 rounded hover:bg-white/10 active:bg-white/10"
                aria-label={`React ${emoji}`}
              >
                {emoji}
              </button>
            ))}
            {!showFullReactions && (
              <button
                onTouchEnd={(e) => { e.stopPropagation(); setShowFullReactions(true); }}
                onClick={() => setShowFullReactions(true)}
                className="text-xs p-0.5 rounded hover:bg-white/10 active:bg-white/10 transition-colors text-pnp-textSecondary"
                aria-label="More reactions"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v6m3-3H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </button>
            )}
            {onReply && (
              <button
                onTouchEnd={(e) => { e.stopPropagation(); onReply(msg); setShowActions(false); }}
                onClick={() => { onReply(msg); setShowActions(false); }}
                className="p-1 rounded hover:bg-white/10 active:bg-white/10 transition-colors ml-0.5"
                aria-label="Reply"
              >
                <svg className="w-3.5 h-3.5" style={{ color: "#8E8E93" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                </svg>
              </button>
            )}
            {isOwnerOrMod && matrixEventId && onPin && (
              <button
                onTouchEnd={(e) => { e.stopPropagation(); onPin(matrixEventId, msg.content || ""); setShowActions(false); }}
                onClick={() => { onPin(matrixEventId, msg.content || ""); setShowActions(false); }}
                className="p-1 rounded hover:bg-white/10 active:bg-white/10 transition-colors ml-0.5"
                aria-label="Pin message"
                title="Pin"
              >
                <svg className="w-3.5 h-3.5" style={{ color: "#7B61FF" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                </svg>
              </button>
            )}
            {isOwnerOrMod && matrixEventId && onDelete && (
              <button
                onTouchEnd={(e) => { e.stopPropagation(); onDelete(matrixEventId); setShowActions(false); }}
                onClick={() => { onDelete(matrixEventId); setShowActions(false); }}
                className="p-1 rounded hover:bg-white/10 active:bg-white/10 transition-colors ml-0.5"
                aria-label="Delete message"
                title="Delete"
              >
                <svg className="w-3.5 h-3.5" style={{ color: "#FF6B6B" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            )}
            {showActions && (
              <button
                onTouchEnd={(e) => { e.stopPropagation(); setShowActions(false); }}
                onClick={() => setShowActions(false)}
                className="p-1 rounded hover:bg-white/10 active:bg-white/10 transition-colors ml-0.5"
                aria-label="Close"
              >
                <svg className="w-3 h-3" style={{ color: "#8E8E93" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
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

// ─── Call Invite Toast ──────────────────────────────────────────────────────

function CallInviteToast({
  notif,
  groups,
  onOpen,
  onDismiss,
  navigate,
  t,
}: {
  notif: { groupId: number; groupName: string; fromName: string; fromPhotoUrl: string | null } | null;
  groups: HangoutGroup[];
  onOpen: (group: HangoutGroup) => Promise<void>;
  onDismiss: () => void;
  navigate: (path: string) => void;
  t: any;
}) {
  if (!notif) return null;
  const group = groups.find(g => g.id === notif.groupId);
  const validPhoto = notif.fromPhotoUrl && (notif.fromPhotoUrl.startsWith("/") || notif.fromPhotoUrl.startsWith("http"));
  return (
    <div className="absolute top-3 left-3 right-3 z-50 animate-fade-in-up" style={{ animationDuration: "0.2s" }}>
      <div className="glass-card-sm p-3 flex items-center gap-3" style={{ borderColor: "rgba(94,209,196,0.3)" }}>
        {validPhoto ? (
          <img src={notif.fromPhotoUrl!} alt="" className="w-9 h-9 rounded-full object-cover flex-shrink-0" />
        ) : (
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
            style={{ background: "linear-gradient(135deg, #D4007A, #E69138)", color: "#fff" }}
          >
            {(notif.fromName || "?")[0].toUpperCase()}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-white truncate">{t.chat.callInviteTitle(notif.fromName)}</p>
          <p className="text-[10px] text-pnp-textSecondary truncate">{t.chat.callInviteBody(notif.groupName)}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => {
              if (group) {
                onOpen(group).catch(() => {});
              } else {
                // User isn't a member — navigate to hangouts so they can find the group
                navigate("/chat");
              }
              onDismiss();
            }}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white active:scale-95 transition-all hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent focus-visible:ring-offset-1 focus-visible:ring-offset-pnp-background"
            style={{ background: "linear-gradient(135deg, #5ED1C4, #00D4E8)" }}
          >
            {t.chat.joinCall}
          </button>
          <button
            onClick={onDismiss}
            className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-white/10 active:scale-95 transition-all"
            style={{ color: "#8E8E93" }}
            aria-label="Dismiss"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function Chat() {
  const { user } = useAuth();
  const { isPrime, isMember, isFree, isBanned, isAdmin } = useTier();
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

  // Discover groups
  const [discoverList, setDiscoverList] = useState<DiscoverGroup[]>([]);
  const [showDiscover, setShowDiscover] = useState(false);
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [discoverTagFilter, setDiscoverTagFilter] = useState<string | null>(null);

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
  const reactionInFlight = useRef(new Set<string>());

  // Group members (loaded on chat open for display name/avatar lookup)
  const [groupMembers, setGroupMembers] = useState<any[]>([]);

  // Member lookup: telegram ID → { name, photoUrl } for resolving Matrix sender IDs
  const memberLookup = React.useMemo(() => {
    const map = new Map<string, { name: string; photoUrl: string | null }>();
    for (const m of groupMembers) {
      map.set(String(m.user_id), {
        name: m.first_name || m.username || "User",
        photoUrl: m.photo_url || null,
      });
    }
    if (user) {
      map.set(String(user.dbId), {
        name: user.firstName || user.displayName || "You",
        photoUrl: user.photoUrl || null,
      });
    }
    return map;
  }, [groupMembers, user]);

  // Matrix room for hangout chat
  const [matrixRoomId, setMatrixRoomId] = useState<string | null>(null);
  const { messages: matrixMessages } = useRoomMessages(matrixRoomId);

  // Resolve a Matrix user ID to a display name using multiple fallback sources
  const resolveDisplayName = useCallback((matrixId: string): { name: string; photoUrl: string | null } => {
    const telegramId = telegramIdFromMatrixId(matrixId);

    // 1. Try groupMembers lookup (PNPtv DB data)
    const memberInfo = memberLookup.get(telegramId);
    if (memberInfo && memberInfo.name !== "User") return memberInfo;

    // 2. Try Matrix room member display name from the SDK
    try {
      const client = getMatrixClient();
      if (client && matrixRoomId) {
        const room = client.getRoom(matrixRoomId);
        if (room) {
          const member = room.getMember(matrixId);
          if (member?.name && member.name !== matrixId) {
            return { name: member.name, photoUrl: memberInfo?.photoUrl || null };
          }
        }
      }
    } catch { /* ignore */ }

    // 3. Fallback to member info or telegram ID
    return memberInfo || { name: telegramId, photoUrl: null };
  }, [memberLookup, matrixRoomId]);

  // Convert Matrix messages to GroupMessage shape for existing MessageBubble components.
  // We use a stable hash of the eventId string as the numeric id field.
  const matrixAsGroupMessages: GroupMessage[] = matrixMessages.map((m) => {
    // FNV-1a 32-bit hash for stable numeric id
    let hash = 2166136261;
    for (let i = 0; i < m.eventId.length; i++) {
      hash ^= m.eventId.charCodeAt(i);
      hash = (hash * 16777619) >>> 0;
    }
    const senderTelegramId = telegramIdFromMatrixId(m.senderId);
    const senderInfo = resolveDisplayName(m.senderId);
    const replyTelegramId = m.replyToSenderId ? telegramIdFromMatrixId(m.replyToSenderId) : undefined;
    const replyInfo = replyTelegramId ? resolveDisplayName(m.replyToSenderId!) : undefined;
    return {
      id: hash,
      room: matrixRoomId ?? "",
      content: m.body,
      user_id: senderTelegramId,
      username: senderInfo.name,
      first_name: senderInfo.name,
      photo_url: senderInfo.photoUrl || null,
      created_at: new Date(m.timestamp).toISOString(),
      media_url: m.mediaUrl ?? null,
      media_type: m.mediaType === "file" ? null : (m.mediaType ?? null),
      media_mime: m.mediaMime ?? null,
      media_thumb_url: null,
      media_width: null,
      media_height: null,
      // Reply-to from Matrix event relations
      reply_to: m.replyToEventId ? {
        name: replyInfo?.name || "User",
        content: m.replyToBody || "[message]",
      } : null,
    } satisfies GroupMessage;
  });

  // Map from GroupMessage numeric id → Matrix eventId (for reactions)
  const matrixEventIdMap = React.useMemo(() => {
    const map = new Map<number, string>();
    matrixMessages.forEach((m) => {
      let hash = 2166136261;
      for (let i = 0; i < m.eventId.length; i++) {
        hash ^= m.eventId.charCodeAt(i);
        hash = (hash * 16777619) >>> 0;
      }
      map.set(hash, m.eventId);
    });
    return map;
  }, [matrixMessages]);

  // Matrix reactions for this room
  const { reactions: matrixReactions } = useRoomReactions(matrixRoomId);

  // Reply-to state
  const [replyToMsg, setReplyToMsg] = useState<GroupMessage | null>(null);


  // Socket hook — kept for presence, typing, calls only (messages come from Matrix)
  const {
    emitTyping,
    typingUsers,
    callState,
    isConnected,
    onlineMembers,
    inviteToCall,
    screenShareUser,
    callStartedAt,
    callParticipants,
    readReceipts,
    emitMarkRead,
  } = useHangoutSocket(activeGroup?.id ?? null, user?.dbId, matrixRoomId);

  // Messages: Matrix is the single source of truth
  const messages: GroupMessage[] = React.useMemo(() => {
    return matrixAsGroupMessages;
  }, [matrixAsGroupMessages]);

  // Handle reaction toggle — always via Matrix
  const handleReaction = useCallback(async (idOrEventId: string, emoji: string) => {
    if (!matrixRoomId) {
      console.warn("[Reaction] No matrixRoomId, cannot react");
      return;
    }
    // Resolve to Matrix event ID
    const eventId = idOrEventId.startsWith("$")
      ? idOrEventId
      : matrixEventIdMap.get(parseInt(idOrEventId, 10)) ?? null;
    if (!eventId) {
      console.warn("[Reaction] Could not resolve eventId for", idOrEventId);
      return;
    }

    // Debounce: prevent double-sends for the same event+emoji while in flight
    const flightKey = `${eventId}:${emoji}`;
    if (reactionInFlight.current.has(flightKey)) return;
    reactionInFlight.current.add(flightKey);

    const entries = matrixReactions.get(eventId);
    const myMatrixId = user?.dbId ? `@pnptv_${user.dbId}:matrix.pnptv.app` : "";
    const existing = entries?.find((e) => e.emoji === emoji);
    const myEntry = myMatrixId ? existing?.users.find((u) => u.userId === myMatrixId) : undefined;
    if (myEntry) {
      // Already reacted — remove (toggle off)
      redactEvent(matrixRoomId, myEntry.reactionEventId)
        .catch((err) => console.warn("[Reaction] redact failed:", err))
        .finally(() => { reactionInFlight.current.delete(flightKey); });
    } else {
      // Send new reaction — handle duplicate gracefully (toggle off if server says duplicate)
      sendReaction(matrixRoomId, eventId, emoji)
        .catch((err) => {
          const errObj = err as { errcode?: string };
          if (errObj.errcode === "M_DUPLICATE_ANNOTATION") {
            // Already reacted but local state didn't know — find and redact via timeline
            console.info("[Reaction] Duplicate detected, toggling off");
            try {
              const client = getMatrixClient();
              if (!client) return;
              const room = client.getRoom(matrixRoomId);
              if (!room) return;
              const timeline = room.getLiveTimeline().getEvents();
              for (const ev of timeline) {
                if (ev.getType() !== "m.reaction" || ev.isRedacted()) continue;
                const rel = ev.getContent()?.["m.relates_to"];
                if (rel?.event_id === eventId && rel?.key === emoji && ev.getSender() === myMatrixId) {
                  redactEvent(matrixRoomId, ev.getId()!).catch(() => {});
                  break;
                }
              }
            } catch { /* best effort */ }
          } else {
            console.warn("[Reaction] send failed:", err);
          }
        })
        .finally(() => { reactionInFlight.current.delete(flightKey); });
    }
  }, [matrixRoomId, matrixReactions, matrixEventIdMap, user?.dbId]);

  // sendMessage: send via Matrix (with optional reply-to via Matrix event relation)
  const sendMessage = useCallback(
    async (text: string, replyToEventId?: string | null) => {
      if (!activeGroup) return;
      try {
        if (replyToEventId && matrixRoomId) {
          // Reply via Matrix event relation
          await sendMatrixReply(matrixRoomId, text, replyToEventId);
        } else {
          await sendHangoutMessage(activeGroup.id, text);
        }
        // Message will appear via Matrix timeline listener
      } catch {
        // Fallback: try direct Matrix send if REST fails
        if (matrixRoomId) {
          await sendMatrixMessage(matrixRoomId, text).catch(() => {});
        }
      }
    },
    [activeGroup, matrixRoomId]
  );

  // Media upload state
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaPreviewUrl, setMediaPreviewUrl] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Voice recording state
  const [isRecording, setIsRecording] = useState(false);

  // Drag-and-drop state
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounter = useRef(0);

  // Message search state
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Filtered messages for search
  const filteredMessages = React.useMemo(() => {
    if (!searchQuery.trim()) return messages;
    const q = searchQuery.toLowerCase();
    return messages.filter((m) =>
      (m.content && m.content.toLowerCase().includes(q)) ||
      (m.first_name && m.first_name.toLowerCase().includes(q)) ||
      (m.username && m.username.toLowerCase().includes(q))
    );
  }, [messages, searchQuery]);

  // Lightbox
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  // Video call — JaaS/Jitsi credentials
  const [callMeetingUrl, setCallMeetingUrl] = useState<string | null>(null);
  const [callId, setCallId] = useState<string | null>(null);
  const [callIsModerator, setCallIsModerator] = useState(false);
  const [callLoading, setCallLoading] = useState(false);
  const [showPaywall, setShowPaywall] = useState(false);
  const loadingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Pinned messages
  const [pinnedMessages, setPinnedMessages] = useState<any[]>([]);
  const [showPins, setShowPins] = useState(false);

  // Invite link
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [inviteCopied, setInviteCopied] = useState(false);

  // Member action loading
  const [memberActionLoading, setMemberActionLoading] = useState<string | null>(null);

  const [showGroupSettings, setShowGroupSettings] = useState(false);
  const [settingsMembers, setSettingsMembers] = useState<GroupMember[]>([]);
  const [settingsMembersLoading, setSettingsMembersLoading] = useState(false);
  const [settingsName, setSettingsName] = useState("");
  const [settingsDesc, setSettingsDesc] = useState("");
  const [settingsIsPublic, setSettingsIsPublic] = useState(true);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsSuccess, setSettingsSuccess] = useState(false);
  const [settingsAvatarUploading, setSettingsAvatarUploading] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  // Dedicated error states for non-upload errors
  const [discoverError, setDiscoverError] = useState<string | null>(null);

  // Incoming invite notification (global — received even from other groups)
  const [inviteNotif, setInviteNotif] = useState<{
    groupId: number;
    groupName: string;
    fromName: string;
    fromPhotoUrl: string | null;
  } | null>(null);

  // SpotlightStrip — hangout events
  const [hangoutEvents, setHangoutEvents] = useState<EventItem[]>([]);
  const [showCreateEvent, setShowCreateEvent] = useState(false);
  const [detailEvent, setDetailEvent] = useState<EventItem | null>(null);
  const [eventKey, setEventKey] = useState(0);

  // Slow mode cooldown (seconds remaining after sending a message)
  const [slowModeCooldown, setSlowModeCooldown] = useState(0);

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
      }
    } catch { /* silent */ }
  }, []);

  const loadPins = useCallback(async (groupId: number) => {
    try {
      const data = await getHangoutPins(groupId);
      if (data.success) setPinnedMessages(data.pins || []);
    } catch { /* silent */ }
  }, []);

  const loadHangoutEvents = useCallback(() => {
    getUpcomingEvents({ type: "hangout_event", limit: 8 })
      .then((res) => { if (res.success) setHangoutEvents(res.events); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    setIsLoading(true);
    loadGroups().finally(() => setIsLoading(false));
    loadHangoutEvents();
  }, [loadGroups, loadHangoutEvents]);

  // Deep-link: auto-open group from /chat/:groupId
  const deepLinkHandled = useRef(false);
  useEffect(() => {
    if (!urlGroupId || deepLinkHandled.current || isLoading || groups.length === 0) return;
    const target = groups.find((g) => String(g.id) === urlGroupId);
    if (target) {
      deepLinkHandled.current = true;
      openChat(target);
    }
  }, [urlGroupId, isLoading, groups]);

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
      setDiscoverError(err instanceof Error ? err.message : "Failed to join group");
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

  // Voice recording handler — turns blob into a File for the existing media upload pipeline
  const handleVoiceRecord = useCallback((blob: Blob, duration: number) => {
    setIsRecording(false);
    const file = new File([blob], `voice-${Date.now()}.webm`, { type: blob.type || "audio/webm" });
    const previewUrl = URL.createObjectURL(blob);
    clearMedia();
    setMediaFile(file);
    setMediaPreviewUrl(previewUrl);
    setUploadError(null);
  }, [clearMedia]);

  // Drag-and-drop handlers for media upload
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    if (e.dataTransfer.types.includes("Files")) setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) setIsDragOver(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    dragCounter.current = 0;
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];
      const isImage = file.type.startsWith("image/");
      const isVideo = file.type.startsWith("video/");
      const isAudio = file.type.startsWith("audio/");
      if (!isImage && !isVideo && !isAudio) {
        setUploadError("Only images, videos, and audio files are supported");
        return;
      }
      if (isImage && file.size > 10 * 1024 * 1024) {
        setUploadError("Image must be under 10MB");
        return;
      }
      if (isVideo && file.size > 50 * 1024 * 1024) {
        setUploadError("Video must be under 50MB");
        return;
      }
      const previewUrl = URL.createObjectURL(file);
      clearMedia();
      setMediaFile(file);
      setMediaPreviewUrl(previewUrl);
    }
  }, [clearMedia]);

  // ─── Smart auto-scroll ─────────────────────────────────────────────

  // Track last read-receipt eventId to avoid spamming
  const lastReceiptId = useRef<string | null>(null);

  const handleScroll = useCallback(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isNearBottom.current = distFromBottom < 150;

    // Infinite scroll: paginate Matrix room when near top
    if (el.scrollTop < 100 && matrixRoomId) {
      prevScrollHeight.current = el.scrollHeight;
      import("@/hooks/useMatrix").then(({ paginateRoom }) => {
        paginateRoom(matrixRoomId).catch(() => {});
      });
    }

    // Send Matrix read receipt when near bottom + emit socket mark-read
    if (isNearBottom.current && matrixRoomId && matrixMessages.length > 0) {
      const lastMsg = matrixMessages[matrixMessages.length - 1];
      if (lastMsg.eventId !== lastReceiptId.current) {
        lastReceiptId.current = lastMsg.eventId;
        sendReadReceipt(matrixRoomId, lastMsg.eventId);
        emitMarkRead();
      }
    }
  }, [matrixRoomId, matrixMessages]);

  // Start (and cancel) the messagesLoading fallback timer whenever the active group changes.
  // Using a useEffect here ensures the previous timer is always cancelled before a new one
  // starts, preventing stale timers from clearing the loading state for the wrong group.
  useEffect(() => {
    if (!activeGroup) return;
    loadingTimerRef.current = setTimeout(() => setMessagesLoading(false), 8000);
    return () => {
      if (loadingTimerRef.current) {
        clearTimeout(loadingTimerRef.current);
        loadingTimerRef.current = null;
      }
    };
  }, [activeGroup?.id]);

  // Preserve scroll position after loading older messages
  useEffect(() => {
    if (prevScrollHeight.current > 0) {
      const el = messagesContainerRef.current;
      if (el) {
        el.scrollTop = el.scrollHeight - prevScrollHeight.current;
      }
      prevScrollHeight.current = 0;
    }
  }, [matrixMessages.length]);

  // Auto-scroll on new messages (only when near bottom)
  useEffect(() => {
    if (isNearBottom.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  // ─── Chat view open/close ──────────────────────────────────────────

  const openChat = async (group: HangoutGroup) => {
    // Banned users cannot access hangouts
    if (isBanned) {
      setError("Your account has been suspended and you cannot access hangouts.");
      return;
    }
    // Dismiss the tutorial immediately when entering a chat so the overlay
    // can never surface while the user is in the chat input view.
    if (showTutorial) dismissTutorial();
    setActiveGroup(group);
    setView("chat");
    // Update URL so NearbyWidget and other route-aware components detect the hangout
    navigate(`/chat/${group.id}`, { replace: true });
    setCallId(null);
    setCallIsModerator(false);
    setMessagesLoading(true);
    setMsgInput("");
    setUploadError(null);
    clearMedia();
    isNearBottom.current = true;

    // Mark as read
    markGroupAsRead(group.id).catch(() => {});

    // Load group members for display name/avatar lookup in Matrix messages
    loadGroupDetail(group.id);

    // Silently try to provision a Matrix room for this group (non-blocking upgrade)
    setMatrixRoomId(null);
    getOrCreateHangoutRoom(group.id)
      .then((res) => { if (res.success) setMatrixRoomId(res.roomId); })
      .catch(() => { /* Matrix unavailable — Socket.IO continues as sole message source */ });

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
    navigate("/chat", { replace: true });
    setActiveGroup(null);
    setMatrixRoomId(null);
    setCallId(null);
    setCallIsModerator(false);
    setShowOnline(false);
    setShowGroupSettings(false);
    setMsgInput("");
    setUploadError(null);
    clearMedia();
    loadGroups();
  };

  const openGroupSettings = useCallback(async (group: HangoutGroup) => {
    setSettingsName(group.name);
    setSettingsDesc(group.description || "");
    setSettingsIsPublic(group.isPublic);
    setSettingsError(null);
    setSettingsSuccess(false);
    setShowGroupMenu(false);
    setShowGroupSettings(true);
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
      });
      setActiveGroup((prev) => prev ? { ...prev, name: settingsName.trim(), description: settingsDesc.trim(), isPublic: settingsIsPublic } : prev);
      setGroups((prev) => prev.map((g) => g.id === activeGroup.id ? { ...g, name: settingsName.trim(), description: settingsDesc.trim(), isPublic: settingsIsPublic } : g));
      setSettingsSuccess(true);
      setTimeout(() => setSettingsSuccess(false), 2500);
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : "Failed to save settings");
    } finally {
      setSettingsSaving(false);
    }
  }, [activeGroup, settingsName, settingsDesc, settingsIsPublic, settingsSaving]);

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
    // Look up the Matrix eventId for the reply target
    const replyToEventId = replyToMsg ? (matrixEventIdMap.get(replyToMsg.id) || null) : null;
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
        // Message will arrive via Matrix timeline (backend bridges media to Matrix)
        if (!data.success) throw new Error(t.chat.errorUploadFailed);
        clearMedia();
      } else {
        // Text messages go via Matrix (with optional reply-to)
        await sendMessage(text, replyToEventId);
      }
      // Apply slow mode cooldown for regular members (not creator/mod/admin)
      const slowSecs = groupDetail?.slowModeSeconds;
      if (slowSecs && slowSecs > 0) {
        const senderMember = groupMembers.find((m: any) => String(m.user_id) === String(user?.dbId));
        const isPrivileged =
          String(activeGroup.creatorId) === String(user?.dbId) ||
          senderMember?.role === "moderator" ||
          senderMember?.role === "owner";
        if (!isPrivileged) {
          setSlowModeCooldown(slowSecs);
        }
      }
    } catch (err) {
      if (!hasMediaFile) setMsgInput(text);
      setUploadError(
        err instanceof Error ? err.message : t.chat.errorFailedToSend
      );
      setUploadProgress(null);
    } finally {
      setSending(false);
      setReplyToMsg(null);
    }
  }, [sending, activeGroup, msgInput, mediaFile, clearMedia, sendMessage, replyToMsg, groupDetail, groupMembers, user, t.chat, matrixEventIdMap]);

  // ─── Slow mode countdown ─────────────────────────────────────────────
  useEffect(() => {
    if (slowModeCooldown <= 0) return;
    const interval = setInterval(() => {
      setSlowModeCooldown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [slowModeCooldown]);

  // ─── Video call ─────────────────────────────────────────────────────

  const handleStartCall = async () => {
    if (!activeGroup || callLoading) return;
    setCallLoading(true);
    try {
      const data = await startGroupCall(activeGroup.id);
      if (data.jaas?.meetingUrl && data.call?.id) {
        setCallMeetingUrl(data.jaas.meetingUrl);
        setCallId(data.call.id);
        setCallIsModerator(data.call?.isModerator ?? false);
      } else if (data.jaas === null) {
        setUploadError(t.chat.videoCallsUnavailable);
      } else {
        setUploadError(t.chat.videoCallUrlInvalid);
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === "MEMBERSHIP_REQUIRED") {
        setShowPaywall(true);
      } else {
        const msg = err instanceof Error ? err.message : "Failed to start video call";
        setUploadError(msg);
      }
    } finally {
      setCallLoading(false);
    }
  };

  const handleEndCall = useCallback(() => {
    const resolvedCallId = callId ?? callState.callId;
    if (activeGroup && resolvedCallId) {
      leaveGroupCall(activeGroup.id, resolvedCallId).catch(() => {});
    }
    setCallMeetingUrl(null);
    setCallId(null);
    setCallIsModerator(false);
  }, [activeGroup, callId, callState.callId]);

  // Show notification when call ends due to creator leaving
  useEffect(() => {
    if (callState.endReason === "creator_left") {
      setUploadError(t.chat.callEndedHostLeft);
      setCallMeetingUrl(null);
      setCallId(null);
      setCallIsModerator(false);
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
    // Derive current user's member record and enforce group settings
    const myMember = groupMembers.find((m: any) => String(m.user_id) === String(user?.dbId));
    const isOwnerOrMod =
      String(activeGroup.creatorId) === String(user?.dbId) ||
      myMember?.role === "moderator" ||
      myMember?.role === "owner" ||
      isAdmin;
    const isMuted = myMember?.is_muted === true;
    const mutedUntil: string | null = myMember?.muted_until ?? null;
    const isReadOnly = groupDetail?.isReadOnly === true && !isOwnerOrMod;
    const isSlowModeActive = slowModeCooldown > 0 && !isOwnerOrMod;
    const canSend = !sending && !isSlowModeActive && (msgInput.trim().length > 0 || mediaFile !== null);
    const showCallBanner = !callMeetingUrl && callState.isActive;

    return (
      <div className="fixed inset-0 flex flex-col bg-pnp-background z-[30]">
        {/* Membership paywall — shown when a non-member tries to start/join a call */}
        {showPaywall && (
          <HangoutsPaywall onBack={() => setShowPaywall(false)} />
        )}

        {/* Incoming call invite toast */}
        <CallInviteToast notif={inviteNotif} groups={groups} onOpen={openChat} onDismiss={() => setInviteNotif(null)} navigate={navigate} t={t} />

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

          {/* Search button */}
          <button
            onClick={() => {
              setShowSearch((v) => !v);
              if (!showSearch) setTimeout(() => searchInputRef.current?.focus(), 100);
            }}
            className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-white/5 active:scale-95 transition-all"
            style={{ color: showSearch ? "#D4007A" : "#8E8E93" }}
            aria-label="Search messages"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
          </button>

          {/* Online members button — count hidden on xs to save space */}
          <button
            onClick={() => setShowOnline((v) => !v)}
            className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg transition-colors hover:bg-white/5 min-w-[32px] min-h-[32px] justify-center"
            title={t.chat.onlineNow}
            aria-label={t.chat.showOnlineMembers}
          >
            <span className="relative flex h-2 w-2 flex-shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-60" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-400" />
            </span>
            <span className="text-xs font-medium text-green-400">{onlineMembers.length}</span>
          </button>

          {/* Video call: Main Stage link for main group, regular call button for others */}
          {activeGroup.isMain ? (
            <button
              onClick={() => navigate("/main-stage")}
              className="flex items-center gap-1.5 px-2 sm:px-2.5 py-1.5 rounded-lg text-xs font-semibold text-white transition-colors"
              style={{ background: "linear-gradient(135deg, #5ED1C4, #00D4E8)" }}
              aria-label="Go to Main Stage"
            >
              <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              <span className="hidden sm:inline">Main Stage</span>
            </button>
          ) : (
            <VideoCallButton
              hasActiveCall={!!callMeetingUrl || callState.isActive}
              onStartCall={handleStartCall}
              isLoading={callLoading}
              participantCount={callState.participantCount}
            />
          )}

          {/* Three-dot overflow menu */}
          <div className="relative">
            <button
              onClick={() => setShowGroupMenu(v => !v)}
              className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-white/10 active:scale-95 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent"
              style={{ color: "#8E8E93" }}
              aria-label="Group options"
              aria-expanded={showGroupMenu}
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" />
              </svg>
            </button>
            {showGroupMenu && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setShowGroupMenu(false)} />
                <div className="absolute right-0 top-10 z-40 rounded-xl overflow-hidden shadow-xl min-w-[160px]" style={{ background: "#2C2C2E", border: "1px solid rgba(255,255,255,0.1)" }}>
                  <button
                    onClick={() => { setShowGroupMenu(false); setShowOnline(true); }}
                    className="w-full px-4 py-3 text-sm text-left text-white hover:bg-white/10 transition-colors flex items-center gap-3"
                  >
                    <svg className="w-4 h-4 text-pnp-textSecondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                    Members
                  </button>
                  <button
                    onClick={async () => {
                      setShowGroupMenu(false);
                      setShowSettings(true);
                      setSettingsLoading(true);
                      await Promise.all([
                        loadGroupDetail(activeGroup.id),
                        loadPins(activeGroup.id),
                      ]);
                      setSettingsLoading(false);
                    }}
                    className="w-full px-4 py-3 text-sm text-left text-white hover:bg-white/10 transition-colors flex items-center gap-3"
                  >
                    <svg className="w-4 h-4 text-pnp-textSecondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                    Settings
                  </button>
                  <button
                    onClick={() => {
                      setShowGroupMenu(false);
                      setShowPins(!showPins);
                      if (!showPins && activeGroup) loadPins(activeGroup.id);
                    }}
                    className="w-full px-4 py-3 text-sm text-left text-white hover:bg-white/10 transition-colors flex items-center gap-3"
                  >
                    <svg className="w-4 h-4 text-pnp-textSecondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" /></svg>
                    Pinned Messages
                  </button>
                  {!activeGroup.isMain && !activeGroup.isWallOfFame && (isAdmin || String(activeGroup.creatorId) === String(user?.dbId)) && (
                    <button
                      onClick={() => openGroupSettings(activeGroup)}
                      className="w-full px-4 py-3 text-sm text-left text-white hover:bg-white/10 transition-colors flex items-center gap-3"
                    >
                      <svg className="w-4 h-4 text-pnp-textSecondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                      Group Settings
                    </button>
                  )}
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
                  {isAdmin && (
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

        {/* Search bar */}
        {showSearch && (
          <div className="px-4 py-2 border-b border-pnp-border flex items-center gap-2 animate-fade-in-up">
            <svg className="w-4 h-4 text-pnp-textSecondary flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            <input
              ref={searchInputRef}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search messages..."
              className="flex-1 bg-transparent text-sm text-pnp-textPrimary placeholder:text-pnp-textSecondary/50 focus:outline-none min-w-0"
            />
            {searchQuery && (
              <span className="text-[10px] text-pnp-textSecondary flex-shrink-0">
                {filteredMessages.length} found
              </span>
            )}
            <button
              onClick={() => { setShowSearch(false); setSearchQuery(""); }}
              className="w-6 h-6 rounded-full flex items-center justify-center hover:bg-white/10"
              style={{ color: "#8E8E93" }}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        {/* Active call banner (not for main group — uses Main Stage) */}
        {showCallBanner && !activeGroup.isMain && (
          <VideoCallBanner
            isActive={true}
            onJoin={handleStartCall}
            isJoining={callLoading}
            participantCount={callState.participantCount}
            callId={callState.callId}
            callStartedAt={callStartedAt}
            isSomeoneSharing={!!screenShareUser}
          />
        )}

        {/* Embedded video call (not for main group) */}
        {callMeetingUrl && !activeGroup.isMain && (
          <VideoCallOverlay
            meetingUrl={callMeetingUrl}
            groupName={activeGroup.name}
            onClose={handleEndCall}
            initialMode="embedded"
            isAdmin={isAdmin}
            isModerator={callIsModerator}
            callStartedAt={callStartedAt}
            participantCount={callState.participantCount}
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
                  className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors"
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
                ) : !activeGroup.isMain ? (
                  /* ── Member-created hangouts: 3×3 grid with promo placeholders ── */
                  (() => {
                    const GRID = 9;
                    const shown = onlineMembers.slice(0, GRID);
                    const promoCards = [
                      { label: "Learn DashPay", icon: "💳", color: "#5ED1C4" },
                      { label: "Buy Tokens", icon: "🪙", color: "#E69138" },
                      { label: "Upgrade to Prime", icon: "⭐", color: "#D4007A" },
                      { label: "Invite Friends", icon: "🔗", color: "#7B61FF" },
                      { label: "Earn Rewards", icon: "🎁", color: "#00D4E8" },
                      { label: "PNPtv! Studio", icon: "🎬", color: "#FF6B6B" },
                      { label: "Create Hangout", icon: "🏠", color: "#48c774" },
                      { label: "Explore Nearby", icon: "📍", color: "#FBFF00" },
                      { label: "Get Verified", icon: "✅", color: "#1DA1F2" },
                    ];
                    const placeholders = promoCards.slice(0, GRID - shown.length);
                    return (
                      <div className="grid grid-cols-3 gap-2">
                        {shown.map((member) => {
                          const isMe = member.userId === user?.dbId;
                          return (
                            <button
                              key={member.userId}
                              onClick={() => { setShowOnline(false); navigate(`/profile/${member.userId}`); }}
                              className="w-full rounded-xl overflow-hidden hover:ring-1 hover:ring-white/20 active:scale-[0.97] transition-all"
                              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}
                            >
                              <div className="relative h-16 w-full">
                                {member.photoUrl ? (
                                  <img
                                    src={member.photoUrl}
                                    alt={member.name}
                                    className="w-full h-full object-cover"
                                    onError={(e) => {
                                      (e.target as HTMLImageElement).style.display = "none";
                                      const sib = (e.target as HTMLElement).nextElementSibling as HTMLElement | null;
                                      if (sib) sib.style.display = "flex";
                                    }}
                                  />
                                ) : null}
                                <div
                                  className="absolute inset-0 flex items-center justify-center text-lg font-bold"
                                  style={{
                                    background: "linear-gradient(135deg, #D4007A, #E69138)",
                                    color: "#fff",
                                    display: member.photoUrl ? "none" : undefined,
                                  }}
                                >
                                  {(member.name || "?")[0].toUpperCase()}
                                </div>
                                <span className="absolute bottom-0.5 left-0.5 w-2 h-2 rounded-full bg-green-400 ring-1 ring-black/30" />
                              </div>
                              <div className="px-1.5 py-1.5">
                                <p className="text-[10px] font-bold text-white truncate leading-tight">
                                  {member.name}{isMe ? " (You)" : ""}
                                </p>
                                <p className="text-[8px] truncate leading-tight mt-0.5" style={{ color: "#8E8E93" }}>Online</p>
                              </div>
                            </button>
                          );
                        })}
                        {placeholders.map((promo, i) => (
                          <div
                            key={`promo-${i}`}
                            className="w-full rounded-xl overflow-hidden opacity-70 hover:opacity-100 transition-opacity cursor-default"
                            style={{ background: "rgba(255,255,255,0.03)", border: "1px dashed rgba(255,255,255,0.10)" }}
                          >
                            <div
                              className="h-16 w-full flex items-center justify-center text-2xl"
                              style={{ background: `${promo.color}15` }}
                            >
                              {promo.icon}
                            </div>
                            <div className="px-1.5 py-1.5">
                              <p className="text-[10px] font-bold truncate leading-tight" style={{ color: promo.color }}>{promo.label}</p>
                              <p className="text-[8px] truncate leading-tight mt-0.5" style={{ color: "#8E8E9366" }}>Coming soon</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  })()
                ) : (
                  /* ── Main/community hangouts: original list view ── */
                  <div className="space-y-2">
                    {onlineMembers.map((member) => {
                      const isMe = member.userId === user?.dbId;
                      return (
                        <div key={member.userId} className="flex items-center gap-3 py-2">
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
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-white truncate">
                              {member.name}{isMe ? ` ${t.chat.you}` : ""}
                            </p>
                            <div className="flex items-center gap-1 mt-0.5">
                              <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
                              <span className="text-xs" style={{ color: "#8E8E93" }}>{t.chat.online}</span>
                              <NearbyBadge distanceKm={(member as any).distance_km} variant="compact" />
                            </div>
                          </div>
                          {(callState.isActive || callMeetingUrl) && !isMe && (
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
              className="rounded-t-2xl w-full max-h-[80vh] flex flex-col"
              style={{ background: "#1C1C1E", borderTop: "1px solid rgba(255,255,255,0.1)" }}
            >
              <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
                <div className="w-10 h-1 rounded-full" style={{ background: "rgba(255,255,255,0.2)" }} />
              </div>
              <div className="flex items-center justify-between px-5 pt-2 pb-3 flex-shrink-0">
                <p className="text-sm font-semibold text-white">Group Settings</p>
                <button onClick={() => setShowSettings(false)} className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-white/10" style={{ color: "#8E8E93" }}>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
              <div className="overflow-y-auto flex-1 px-5 pb-6 space-y-4">
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
                            try {
                              const data = await getHangoutInviteLink(activeGroup.id);
                              if (data.success) {
                                setInviteUrl(data.inviteUrl);
                                await navigator.clipboard.writeText(data.inviteUrl);
                                setInviteCopied(true);
                                setTimeout(() => setInviteCopied(false), 2000);
                              }
                            } catch { /* silent */ }
                          }}
                          className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2 transition-all active:scale-95"
                          style={{ background: "linear-gradient(135deg, #7B61FF, #D4007A)" }}
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
                          {inviteCopied ? "Copied!" : "Copy Invite Link"}
                        </button>
                      </div>
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

                    {/* Owner/Mod settings */}
                    {(String(activeGroup.creatorId) === String(user?.dbId) || isAdmin) && (
                      <>
                        <div className="border-t border-white/10 pt-4">
                          <p className="text-xs font-semibold text-pnp-textSecondary mb-3 uppercase tracking-wider">Admin Controls</p>

                          {/* Public/Private Toggle */}
                          <button
                            onClick={async () => {
                              const newVal = !(groupDetail?.is_public ?? activeGroup.isPublic);
                              await updateHangoutSettings(activeGroup.id, { isPublic: newVal });
                              loadGroupDetail(activeGroup.id);
                              loadGroups();
                            }}
                            className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg bg-white/5 mb-2"
                          >
                            <span className="text-sm text-white">{(groupDetail?.is_public ?? activeGroup.isPublic) ? "Public" : "Private"}</span>
                            <div className={`w-9 h-5 rounded-full transition-colors relative ${(groupDetail?.is_public ?? activeGroup.isPublic) ? "bg-pnp-accent" : "bg-white/20"}`}>
                              <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${(groupDetail?.is_public ?? activeGroup.isPublic) ? "left-[18px]" : "left-0.5"}`} />
                            </div>
                          </button>

                          {/* Read-Only Toggle */}
                          <button
                            onClick={async () => {
                              const newVal = !(groupDetail?.is_read_only ?? false);
                              await updateHangoutSettings(activeGroup.id, { isReadOnly: newVal });
                              loadGroupDetail(activeGroup.id);
                            }}
                            className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg bg-white/5 mb-2"
                          >
                            <span className="text-sm text-white">Read-Only Mode</span>
                            <div className={`w-9 h-5 rounded-full transition-colors relative ${(groupDetail?.is_read_only) ? "bg-pnp-accent" : "bg-white/20"}`}>
                              <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${(groupDetail?.is_read_only) ? "left-[18px]" : "left-0.5"}`} />
                            </div>
                          </button>

                          {/* Slow Mode */}
                          <div className="px-3 py-2.5 rounded-lg bg-white/5 mb-2">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-sm text-white">Slow Mode</span>
                              <span className="text-xs text-pnp-textSecondary">{(groupDetail?.slow_mode_seconds ?? 0) === 0 ? "Off" : `${groupDetail?.slow_mode_seconds}s`}</span>
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
                                    background: (groupDetail?.slow_mode_seconds ?? 0) === sec ? "linear-gradient(135deg, #D4007A, #E69138)" : "rgba(255,255,255,0.05)",
                                    color: "#fff",
                                  }}
                                >
                                  {sec === 0 ? "Off" : sec < 60 ? `${sec}s` : `${sec / 60}m`}
                                </button>
                              ))}
                            </div>
                          </div>

                          {/* Tags */}
                          <div className="px-3 py-2.5 rounded-lg bg-white/5 mb-2">
                            <span className="text-sm text-white block mb-1">Tags <span className="text-pnp-textSecondary text-[10px] font-normal">(max 5)</span></span>
                            <div className="flex flex-wrap gap-1 mb-2">
                              {/* Preset tags */}
                              {["chill", "party", "dating", "music", "gaming", "art", "fitness", "travel"].map((tag) => {
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
                                .filter((t: string) => !["chill", "party", "dating", "music", "gaming", "art", "fitness", "travel"].includes(t))
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
                                  className="flex-1 bg-white/5 border border-white/10 rounded-lg px-2.5 py-1 text-[11px] text-white placeholder-pnp-textSecondary outline-none focus:border-pnp-accent"
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
                                  <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                                    style={{ background: "linear-gradient(135deg, #D4007A, #E69138)", color: "#fff" }}>
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
                                    <div className="flex gap-1 flex-shrink-0">
                                      {!isMod && !m.is_banned && (
                                        <button
                                          onClick={async () => {
                                            setMemberActionLoading(m.user_id);
                                            await promoteHangoutMember(activeGroup.id, m.user_id).catch(() => {});
                                            loadGroupDetail(activeGroup.id);
                                            setMemberActionLoading(null);
                                          }}
                                          className="px-1.5 py-1 rounded text-[9px] font-semibold bg-blue-500/20 text-blue-400"
                                          title="Promote to Mod"
                                        >Mod</button>
                                      )}
                                      {isMod && (
                                        <button
                                          onClick={async () => {
                                            setMemberActionLoading(m.user_id);
                                            await demoteHangoutMember(activeGroup.id, m.user_id).catch(() => {});
                                            loadGroupDetail(activeGroup.id);
                                            setMemberActionLoading(null);
                                          }}
                                          className="px-1.5 py-1 rounded text-[9px] font-semibold bg-yellow-500/20 text-yellow-400"
                                          title="Demote"
                                        >Demote</button>
                                      )}
                                      {!m.is_muted && !m.is_banned && (
                                        <button
                                          onClick={async () => {
                                            setMemberActionLoading(m.user_id);
                                            await muteHangoutMember(activeGroup.id, m.user_id, 60).catch(() => {});
                                            loadGroupDetail(activeGroup.id);
                                            setMemberActionLoading(null);
                                          }}
                                          className="px-1.5 py-1 rounded text-[9px] font-semibold bg-orange-500/20 text-orange-400"
                                          title="Mute 1h"
                                        >Mute</button>
                                      )}
                                      {m.is_muted && (
                                        <button
                                          onClick={async () => {
                                            setMemberActionLoading(m.user_id);
                                            await unmuteHangoutMember(activeGroup.id, m.user_id).catch(() => {});
                                            loadGroupDetail(activeGroup.id);
                                            setMemberActionLoading(null);
                                          }}
                                          className="px-1.5 py-1 rounded text-[9px] font-semibold bg-green-500/20 text-green-400"
                                          title="Unmute"
                                        >Unmute</button>
                                      )}
                                      <button
                                        onClick={async () => {
                                          setConfirmAction({
                                            title: "Kick Member",
                                            message: `Remove ${m.first_name || m.username} from the group?`,
                                            isDanger: true,
                                            onConfirm: async () => {
                                              await kickHangoutMember(activeGroup.id, m.user_id);
                                              loadGroupDetail(activeGroup.id);
                                              loadGroups();
                                            },
                                          });
                                        }}
                                        className="px-1.5 py-1 rounded text-[9px] font-semibold bg-red-500/20 text-red-400"
                                        title="Kick"
                                      >Kick</button>
                                      {!m.is_banned ? (
                                        <button
                                          onClick={async () => {
                                            setConfirmAction({
                                              title: "Ban Member",
                                              message: `Ban ${m.first_name || m.username}? They won't be able to rejoin.`,
                                              isDanger: true,
                                              onConfirm: async () => {
                                                await banHangoutMember(activeGroup.id, m.user_id);
                                                loadGroupDetail(activeGroup.id);
                                              },
                                            });
                                          }}
                                          className="px-1.5 py-1 rounded text-[9px] font-semibold bg-red-700/30 text-red-500"
                                          title="Ban"
                                        >Ban</button>
                                      ) : (
                                        <button
                                          onClick={async () => {
                                            setMemberActionLoading(m.user_id);
                                            await unbanHangoutMember(activeGroup.id, m.user_id).catch(() => {});
                                            loadGroupDetail(activeGroup.id);
                                            setMemberActionLoading(null);
                                          }}
                                          className="px-1.5 py-1 rounded text-[9px] font-semibold bg-green-500/20 text-green-400"
                                          title="Unban"
                                        >Unban</button>
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

        {/* Pinned Messages Bar */}
        {pinnedMessages.length > 0 && !showPins && (
          <button
            onClick={() => setShowPins(true)}
            className="w-full px-4 py-2 flex items-center gap-2 text-xs border-b border-pnp-border hover:bg-white/5 transition-colors"
            style={{ background: "rgba(123,97,255,0.08)" }}
          >
            <svg className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "#7B61FF" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
            </svg>
            <span className="font-semibold" style={{ color: "#7B61FF" }}>{pinnedMessages.length} pinned</span>
            <span className="text-pnp-textSecondary truncate flex-1 text-left">{pinnedMessages[0]?.message_body || "View pinned messages"}</span>
          </button>
        )}
        {showPins && (
          <div className="w-full px-4 py-2 border-b border-pnp-border space-y-1 max-h-32 overflow-y-auto" style={{ background: "rgba(123,97,255,0.05)" }}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold" style={{ color: "#7B61FF" }}>Pinned Messages</span>
              <button onClick={() => setShowPins(false)} className="text-[10px] text-pnp-textSecondary">Hide</button>
            </div>
            {pinnedMessages.map((pin: any) => (
              <div key={pin.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-white/5">
                <p className="text-xs text-white flex-1 truncate">{pin.message_body || "[message]"}</p>
                <span className="text-[10px] text-pnp-textSecondary flex-shrink-0">by {pin.pinned_by_name || "admin"}</span>
                {isOwnerOrMod && (
                  <button
                    onClick={async () => {
                      if (activeGroup) {
                        await unpinHangoutMessage(activeGroup.id, pin.matrix_event_id).catch(() => {});
                        loadPins(activeGroup.id);
                      }
                    }}
                    className="text-[10px] text-red-400 flex-shrink-0"
                  >Unpin</button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Hangout event reminder — shown for non-main groups that have upcoming events */}
        {!activeGroup.isMain && !activeGroup.isWallOfFame && (
          <HangoutEventReminder groupId={activeGroup.id} />
        )}

        {/* Messages area */}
        <div
          ref={messagesContainerRef}
          onScroll={handleScroll}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          className="flex-1 overflow-y-auto px-4 py-3 pb-20 space-y-3 min-h-0 relative"
        >
          {/* Drag-and-drop overlay */}
          {isDragOver && (
            <div className="absolute inset-0 z-30 flex items-center justify-center bg-pnp-background/80 backdrop-blur-sm border-2 border-dashed border-pnp-accent rounded-xl pointer-events-none">
              <div className="text-center">
                <svg className="w-12 h-12 mx-auto mb-2 text-pnp-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                </svg>
                <p className="text-sm font-semibold text-pnp-accent">Drop to upload</p>
              </div>
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
              <svg className="w-16 h-16 mx-auto mb-4 text-pnp-textSecondary/50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              <p className="text-pnp-textPrimary font-semibold text-base mb-1">{t.chat.noMessagesYet}</p>
              <p className="text-sm text-pnp-textSecondary mt-1 max-w-[240px]">
                {t.chat.beFirstToSay}
              </p>
              <div className="flex items-center gap-3 mt-4 text-[11px] text-pnp-textSecondary/60">
                <span className="flex items-center gap-1">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25a2.25 2.25 0 00-2.25-2.25H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" /></svg>
                  Share media
                </span>
                <span className="flex items-center gap-1">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" /></svg>
                  Voice notes
                </span>
                <span className="flex items-center gap-1">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" /></svg>
                  Video call
                </span>
              </div>
            </div>
          ) : (
            <>
              {searchQuery && filteredMessages.length === 0 && (
                <div className="text-center py-8">
                  <p className="text-sm text-pnp-textSecondary">No messages match "{searchQuery}"</p>
                </div>
              )}
              {(searchQuery ? filteredMessages : messages).map((msg, idx, arr) => (
                <React.Fragment key={msg.id}>
                  {/* Date separator */}
                  {(idx === 0 || !isSameDay(arr[idx - 1].created_at, msg.created_at)) && (
                    <DateSeparator date={msg.created_at} />
                  )}
                  <MessageBubble
                    msg={msg}
                    isMe={msg.user_id === user?.dbId}
                    userLang={user?.language || "en"}
                    onNavigate={handleNavigate}
                    onExpandImage={handleExpandImage}
                    currentUserId={user?.dbId != null ? `@pnptv_${user.dbId}:matrix.pnptv.app` : undefined}
                    matrixEventId={matrixEventIdMap.get(msg.id) || undefined}
                    reactions={
                      matrixEventIdMap.get(msg.id)
                        ? matrixReactions.get(matrixEventIdMap.get(msg.id)!) ?? undefined
                        : undefined
                    }
                    onReaction={handleReaction}
                    onReply={setReplyToMsg}
                    replyTo={msg.reply_to || null}
                    isOwnerOrMod={isOwnerOrMod}
                    onPin={isOwnerOrMod ? (eventId, body) => {
                      if (activeGroup) pinHangoutMessage(activeGroup.id, eventId, body).then(() => loadPins(activeGroup.id)).catch(() => {});
                    } : undefined}
                    onDelete={isOwnerOrMod ? (eventId) => {
                      if (activeGroup) {
                        setConfirmAction({
                          title: "Delete Message",
                          message: "Delete this message for everyone?",
                          isDanger: true,
                          onConfirm: async () => {
                            await deleteHangoutMessage(activeGroup.id, eventId);
                          },
                        });
                      }
                    } : undefined}
                  />
                  {/* Seen-by indicators — show tiny avatars of who read up to this message */}
                  {msg.user_id === user?.dbId && idx === arr.length - 1 && readReceipts.size > 0 && (
                    <div className="flex justify-end gap-0.5 -mt-1 mr-12">
                      {Array.from(readReceipts.entries())
                        .filter(([uid]) => uid !== user?.dbId)
                        .slice(0, 5)
                        .map(([uid, receipt]) => (
                          <div key={uid} className="relative group/seen">
                            {receipt.photoUrl ? (
                              <img src={receipt.photoUrl} alt={receipt.name} className="w-4 h-4 rounded-full object-cover ring-1 ring-pnp-background" />
                            ) : (
                              <div className="w-4 h-4 rounded-full bg-pnp-accent/30 flex items-center justify-center text-[7px] font-bold text-pnp-accent ring-1 ring-pnp-background">
                                {receipt.name[0]?.toUpperCase()}
                              </div>
                            )}
                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-1.5 py-0.5 bg-black/80 rounded text-[8px] text-white whitespace-nowrap opacity-0 group-hover/seen:opacity-100 transition-opacity pointer-events-none">
                              {receipt.name}
                            </div>
                          </div>
                        ))}
                      {readReceipts.size > 5 && (
                        <div className="w-4 h-4 rounded-full bg-white/10 flex items-center justify-center text-[7px] text-pnp-textSecondary ring-1 ring-pnp-background">
                          +{readReceipts.size - 5}
                        </div>
                      )}
                    </div>
                  )}
                </React.Fragment>
              ))}
            </>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Typing indicator */}
        <TypingIndicator users={typingUsers} />

        {/* Reply-to bar */}
        {replyToMsg && (
          <div className="mx-4 mb-1 flex items-center gap-2 px-3 py-2 rounded-xl animate-fade-in-up" style={{ background: "rgba(212,0,122,0.08)", borderLeft: "3px solid #D4007A" }}>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-semibold" style={{ color: "#D4007A" }}>
                {replyToMsg.first_name || replyToMsg.username || "User"}
              </p>
              <p className="text-xs text-pnp-textSecondary truncate">{replyToMsg.content || "[media]"}</p>
            </div>
            <button
              onClick={() => setReplyToMsg(null)}
              className="w-6 h-6 rounded-full flex items-center justify-center hover:bg-white/10"
              aria-label="Cancel reply"
            >
              <svg className="w-3.5 h-3.5" style={{ color: "#8E8E93" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

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
        <div className="relative z-50 border-t border-pnp-border flex-shrink-0 bg-pnp-background">
          {isReadOnly ? (
            /* Read-only mode: group is read-only and current user is not owner/mod */
            <div className="px-4 py-3 flex items-center justify-center">
              <div className="w-full rounded-full bg-white/5 px-4 py-2.5 flex items-center justify-center gap-2">
                <svg className="w-4 h-4 flex-shrink-0 text-pnp-textSecondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                </svg>
                <span className="text-sm text-pnp-textSecondary">This group is read-only</span>
              </div>
            </div>
          ) : isMuted ? (
            /* Muted: current user is muted in this group */
            <div className="px-4 py-3 flex items-center justify-center">
              <div className="w-full rounded-full bg-white/5 px-4 py-2.5 flex items-center justify-center gap-2">
                <svg className="w-4 h-4 flex-shrink-0 text-pnp-textSecondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 9.75L19.5 12m0 0l2.25 2.25M19.5 12l2.25-2.25M19.5 12l-2.25 2.25m-10.5-6l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
                </svg>
                <span className="text-sm text-pnp-textSecondary">
                  You are muted
                  {mutedUntil
                    ? ` until ${new Date(mutedUntil).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`
                    : ""}
                </span>
              </div>
            </div>
          ) : (
            /* Normal input area */
            <div className="px-4 py-3">
              <div className="flex items-center gap-2">
                {/* Media upload button — hidden when group has allowMedia set to false */}
                {groupDetail?.allowMedia !== false && (
                  <MediaUploadButton
                    onFileSelect={handleFileSelect}
                    onError={handleFileError}
                    disabled={sending}
                    onVoiceRecord={handleVoiceRecord}
                  />
                )}

                {/* Text input */}
                <input
                  value={msgInput}
                  onChange={(e) => {
                    setMsgInput(e.target.value);
                    emitTyping(isRecording);
                  }}
                  onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
                  placeholder={
                    isSlowModeActive
                      ? `Slow mode \u2014 wait ${slowModeCooldown}s`
                      : mediaFile
                      ? t.chat.addACaption
                      : t.chat.typeAMessage
                  }
                  className="flex-1 bg-white/5 rounded-full px-4 py-2.5 text-sm text-pnp-textPrimary placeholder:text-pnp-textSecondary/50 focus:outline-none focus:ring-1 focus:ring-pnp-accent/50 min-w-0 transition-colors"
                  maxLength={2000}
                  disabled={sending || isSlowModeActive}
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
                  ) : isSlowModeActive ? (
                    <span className="text-white text-xs font-bold tabular-nums">{slowModeCooldown}s</span>
                  ) : (
                    <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>

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
                  {confirmLoading ? "..." : confirmAction.title}
                </button>
              </div>
            </div>
          </div>
        )}
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
      {showTutorial && <TutorialOverlay section="hangouts" onDismiss={dismissTutorial} onDismissForever={dismissForever} />}

      {/* Incoming call invite toast */}
      <CallInviteToast notif={inviteNotif} groups={groups} onOpen={openChat} onDismiss={() => setInviteNotif(null)} navigate={navigate} t={t} />
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

      {/* SpotlightStrip — Main Stage pinned + hangout events */}
      <SpotlightStrip
        items={[
          {
            kind: "action",
            id: "main-stage",
            label: "Main Stage",
            sublabel: "24/7 open",
            icon: (
              <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} style={{ color: "#5ED1C4" }}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            ),
            gradient: "linear-gradient(135deg, rgba(94,209,196,0.3), rgba(212,0,122,0.2))",
            onClick: () => navigate("/main-stage"),
            pinned: true,
          },
          ...hangoutEvents.map((ev) => ({ kind: "event" as const, data: ev })),
        ]}
        onItemClick={(item) => {
          if (item.kind === "event") setDetailEvent(item.data);
        }}
        showAction={isPrime}
        onAction={() => setShowCreateEvent(true)}
        actionLabel="Create event"
        emptyAction={isPrime ? () => setShowCreateEvent(true) : undefined}
      />

      {/* Create group form */}
      {showCreate && (
        <div className="glass-card-sm p-4 mb-4 animate-fade-in-up">
          <h3 className="text-sm font-semibold text-pnp-textPrimary mb-1">{t.chat.createSubgroupTitle}</h3>
          <p className="text-xs text-pnp-textSecondary mb-3">{t.chat.createSubgroupHint}</p>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs text-pnp-textSecondary" htmlFor="new-group-name">{t.chat.groupNameLabel}</label>
            <span className={`text-[10px] ${newName.length > 90 ? "text-red-400" : "text-pnp-textSecondary"}`}>{newName.length}/100</span>
          </div>
          <input
            id="new-group-name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={t.chat.groupNamePlaceholder}
            className="w-full bg-white/5 rounded-lg px-3 py-2.5 text-sm text-pnp-textPrimary placeholder:text-pnp-textSecondary/50 focus:outline-none focus:ring-1 focus:ring-pnp-accent/50 mb-2 transition-colors"
            maxLength={100}
          />
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs text-pnp-textSecondary" htmlFor="new-group-desc">{t.chat.groupDescriptionLabel}</label>
            <span className={`text-[10px] ${newDesc.length > 450 ? "text-red-400" : "text-pnp-textSecondary"}`}>{newDesc.length}/500</span>
          </div>
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
        <div className="glass-card-sm p-8 text-center">
          <svg className="w-16 h-16 mx-auto mb-3 text-pnp-textSecondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <p className="text-pnp-textPrimary font-medium mb-1">{t.chat.noGroupsYet}</p>
          <p className="text-sm text-pnp-textSecondary">
            {t.chat.noGroupsLoginHint}
          </p>
          {isPrime && (
            <button
              onClick={() => setShowCreate(true)}
              className="mt-4 px-6 py-2.5 rounded-xl text-sm font-semibold text-white active:scale-95 transition-transform"
              style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
            >
              Create a Group
            </button>
          )}
        </div>
      ) : (
        /* Group list */
        <div className="space-y-2">
          {groups.map((group) => (
            <button
              key={group.id}
              onClick={() => openChat(group)}
              className="w-full glass-card-sm p-4 text-left hover:border-white/20 active:scale-[0.97] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent"
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
                  {group.isMain ? "P" : group.isWallOfFame ? "\u{1F3C6}" : (group.name?.[0] || "?").toUpperCase()}
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
                  {!group.isMain && !group.isWallOfFame && group.description && (
                    <p className="text-[10px] text-pnp-textSecondary truncate mt-0.5">{group.description}</p>
                  )}
                  {!group.isMain && !group.isWallOfFame && (group.tags || []).length > 0 && (
                    <div className="flex flex-wrap gap-0.5 mt-0.5">
                      {(group.tags || []).slice(0, 3).map((tag: string) => (
                        <span key={tag} className="px-1.5 py-0.5 rounded-full text-[9px] bg-white/10 text-pnp-textSecondary">{tag}</span>
                      ))}
                    </div>
                  )}
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
          aria-expanded={showDiscover}
          aria-controls="discover-groups-list"
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
                <div className="mb-3">
                  <input
                    type="text"
                    placeholder="Search groups by name..."
                    className="w-full bg-white/5 rounded-lg px-3 py-2 text-sm text-pnp-textPrimary placeholder:text-pnp-textSecondary/50 focus:outline-none focus:ring-1 focus:ring-pnp-accent/50 transition-colors"
                    onChange={(e) => {
                      const q = e.target.value.toLowerCase();
                      if (!q) { loadDiscover(); return; }
                      setDiscoverList((prev) => prev.filter((g) =>
                        g.name.toLowerCase().includes(q) ||
                        (g.description || "").toLowerCase().includes(q)
                      ));
                    }}
                  />
                </div>
                {/* Tag filter row */}
                <div className="flex flex-wrap gap-1.5 mb-3">
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
                {discoverList
                  .filter((g) => !discoverTagFilter || (g.tags || []).includes(discoverTagFilter))
                  .map((group) => (
                    <div key={group.id} className="glass-card-sm p-4">
                      <div className="flex gap-3 items-center">
                        <div
                          className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
                          style={{ background: "rgba(212, 0, 122, 0.2)", color: "#D4007A" }}
                        >
                          {(group.name?.[0] || "?").toUpperCase()}
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
                          <p className="text-xs text-pnp-textSecondary truncate mt-0.5">
                            {group.memberCount} {group.memberCount === 1 ? t.chat.membersSingular : t.chat.membersPlural}
                          </p>
                          {group.description && (
                            <p className="text-[10px] text-pnp-textSecondary truncate mt-0.5">{group.description}</p>
                          )}
                          {(group.tags || []).length > 0 && (
                            <div className="flex flex-wrap gap-0.5 mt-1">
                              {(group.tags || []).slice(0, 3).map((tag: string) => (
                                <span key={tag} className="px-1.5 py-0.5 rounded-full text-[9px] bg-white/10 text-pnp-textSecondary">{tag}</span>
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
                {confirmLoading ? "..." : confirmAction.title}
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

    </div>
  );
}
