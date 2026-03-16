import React, { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useNearbyToggle, getTier, toggleNearby } from "@/components/NearbyBadge";
import {
  searchNearby,
  searchNearbyPlaces,
  getPublicProfile,
  getOrCreateDmRoom,
  getNearbyFeedPosters,
  getNearbyHangoutMembers,
  getNearbyStreamViewers,
  getNearbyEventAttendees,
  getNearbyAllUsers,
  getWalletBalance,
  type NearbyUser,
  type NearbyPlace,
  type NearbyContextUser,
} from "@/lib/api";
import { useRoomMessages, sendMatrixMessage } from "@/hooks/useMatrix";
import type { UserProfile } from "@/lib/api";

// ── Helpers ──────────────────────────────────────────────────────────────────
function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return days === 1 ? "Yesterday" : `${days}d ago`;
}

// ── Constants ────────────────────────────────────────────────────────────────
const LEMON = "#FBFF00";
const GRID_SIZE = 9;
const MAX_USERS = 45;
const PINK = "#D4007A";
const COMMUNITY_GROUP_ID = 1;

// ── Context detection ────────────────────────────────────────────────────────
type NearbyContext = "feed" | "hangouts" | "live" | "events" | "profile" | "default";

function getContext(pathname: string): NearbyContext {
  if (pathname === "/") return "feed";
  if (pathname.startsWith("/chat")) return "hangouts";
  if (pathname.startsWith("/live")) return "live";
  if (pathname.startsWith("/events")) return "events";
  if (pathname === "/profile") return "profile";
  return "default";
}

function getContextLabel(ctx: NearbyContext): string {
  switch (ctx) {
    case "feed": return "Recent Posters";
    case "hangouts": return "Group Members";
    case "live": return "In This Stream";
    case "events": return "Event Attendees";
    case "profile": return "Everyone Nearby";
    default: return "Nearby";
  }
}

// ── NearbyMember (grid-compatible, unifies NearbyUser + NearbyContextUser) ──
interface NearbyMember {
  user_id: number | string;
  username?: string | null;
  name?: string | null;
  photo_url?: string | null;
  distance_km: number;
  is_online?: boolean;
  last_post_media?: string | null;
  last_post_caption?: string | null;
  // hangouts: direct DM shortcut
  allowDirectDm?: boolean;
  // live: is the model/streamer
  isModel?: boolean;
}

// Community card sentinel
interface CommunityCard {
  type: "community";
  name: string;
}

type GridItem =
  | { kind: "user"; data: NearbyMember }
  | { kind: "place"; data: NearbyPlace }
  | { kind: "community"; data: CommunityCard };

// ── Shared stagger helper ─────────────────────────────────────────────────────
const WIDGET_KEYS = [
  { key: "radio_fab_corner", order: 0, defaultCorner: "bl" },
  { key: "nearby_fab_corner", order: 1, defaultCorner: "br" },
  { key: "cristina_fab_corner", order: 2, defaultCorner: "tr" },
] as const;

function getCornerOffset(myOrder: number, myCorner: string): number {
  let count = 0;
  for (const { key, order, defaultCorner } of WIDGET_KEYS) {
    if (order >= myOrder) continue;
    try {
      const otherCorner = localStorage.getItem(key) || defaultCorner;
      if (otherCorner === myCorner) count++;
    } catch {}
  }
  return count;
}

// ── DM chat sub-view ──────────────────────────────────────────────────────────
function DmView({
  roomId,
  partnerName,
  myUserId,
  onBack,
}: {
  roomId: string;
  partnerName: string;
  myUserId: string | null;
  onBack: () => void;
}) {
  const { messages, loading } = useRoomMessages(roomId);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setSendError(null);
    setText("");
    try {
      await sendMatrixMessage(roomId, trimmed);
    } catch (err) {
      setText(trimmed);
      setSendError(err instanceof Error ? err.message : "Failed to send");
    } finally {
      setSending(false);
    }
  }, [text, sending, roomId]);

  return (
    <div className="flex flex-col h-full" style={{ minHeight: 0 }}>
      {/* Header */}
      <div
        className="flex items-center gap-2 px-3 py-2.5 border-b flex-shrink-0"
        style={{ borderColor: "rgba(255,255,255,0.08)" }}
      >
        <button
          onClick={onBack}
          className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-white/10 transition-colors"
          aria-label="Back"
        >
          <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <span className="text-sm font-bold text-white truncate flex-1">{partnerName}</span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2" style={{ minHeight: 0 }}>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="w-5 h-5 border-2 rounded-full animate-spin" style={{ borderColor: `${LEMON}30`, borderTopColor: LEMON }} />
          </div>
        ) : messages.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-xs" style={{ color: "#8E8E93" }}>No messages yet — say hi!</p>
          </div>
        ) : (
          messages.map((msg) => {
            const isMe = msg.isMine;
            return (
              <div key={msg.eventId} className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
                <div
                  className="max-w-[80%] rounded-2xl px-3 py-2 text-sm text-white break-words whitespace-pre-wrap"
                  style={{ background: isMe ? PINK : "rgba(255,255,255,0.10)" }}
                >
                  {msg.body}
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* Error */}
      {sendError && (
        <p className="px-3 text-xs mb-1" style={{ color: "#FF453A" }}>{sendError}</p>
      )}

      {/* Input */}
      <div
        className="flex items-center gap-2 px-3 py-2 border-t flex-shrink-0"
        style={{ borderColor: "rgba(255,255,255,0.08)" }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
          placeholder="Type a message..."
          className="flex-1 bg-white/5 rounded-full px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-white/20 min-w-0"
          maxLength={2000}
          disabled={sending}
        />
        <button
          onClick={handleSend}
          disabled={!text.trim() || sending}
          className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 active:scale-90 transition-all disabled:opacity-30"
          style={{ background: PINK }}
          aria-label="Send"
        >
          {sending ? (
            <svg className="w-3.5 h-3.5 text-white animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : (
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}

// ── Pagination arrows ─────────────────────────────────────────────────────────
function PaginationRow({
  page,
  totalPages,
  onPrev,
  onNext,
}: {
  page: number;
  totalPages: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-center gap-4 py-2 border-t flex-shrink-0" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
      <button
        onClick={onPrev}
        disabled={page === 0}
        className="w-8 h-8 rounded-full flex items-center justify-center transition-all hover:bg-white/10 active:scale-90 disabled:opacity-25 disabled:cursor-not-allowed"
        aria-label="Previous page"
      >
        <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
      </button>
      <span className="text-[11px] font-medium" style={{ color: "rgba(251,255,0,0.7)" }}>
        {page + 1} / {totalPages}
      </span>
      <button
        onClick={onNext}
        disabled={page >= totalPages - 1}
        className="w-8 h-8 rounded-full flex items-center justify-center transition-all hover:bg-white/10 active:scale-90 disabled:opacity-25 disabled:cursor-not-allowed"
        aria-label="Next page"
      >
        <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </button>
    </div>
  );
}

// ── Profile prev/next arrows ──────────────────────────────────────────────────
function ProfileNavRow({
  index,
  total,
  onPrev,
  onNext,
}: {
  index: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  if (total <= 1) return null;
  return (
    <div className="flex items-center justify-center gap-4 py-2 border-t flex-shrink-0" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
      <button
        onClick={onPrev}
        disabled={index === 0}
        className="w-8 h-8 rounded-full flex items-center justify-center transition-all hover:bg-white/10 active:scale-90 disabled:opacity-25 disabled:cursor-not-allowed"
        aria-label="Previous user"
      >
        <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
      </button>
      <span className="text-[11px] font-medium" style={{ color: "rgba(251,255,0,0.7)" }}>
        {index + 1} / {total}
      </span>
      <button
        onClick={onNext}
        disabled={index >= total - 1}
        className="w-8 h-8 rounded-full flex items-center justify-center transition-all hover:bg-white/10 active:scale-90 disabled:opacity-25 disabled:cursor-not-allowed"
        aria-label="Next user"
      >
        <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </button>
    </div>
  );
}

// ── Community card component ──────────────────────────────────────────────────
function CommunityCardButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full rounded-xl overflow-hidden hover:ring-1 hover:ring-white/20 active:scale-[0.97] transition-all"
      style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.10)" }}
      aria-label="Open PNPtv Community group chat"
    >
      <div
        className="relative h-16 w-full flex items-center justify-center"
        style={{ background: "linear-gradient(135deg, #f64f59, #c471ed, #12c2e9, #48c774, #f64f59)" }}
      >
        <span className="text-2xl">🌈</span>
      </div>
      <div className="px-1.5 py-1.5">
        <p className="text-[10px] font-bold text-white truncate leading-tight">PNPtv</p>
        <p className="text-[8px] truncate leading-tight mt-0.5" style={{ color: "#8E8E93" }}>
          Community Chat
        </p>
      </div>
    </button>
  );
}

// ── User card for grid ────────────────────────────────────────────────────────
function UserCard({
  member,
  context,
  onTap,
  onDirectDm,
}: {
  member: NearbyMember;
  context: NearbyContext;
  onTap: (m: NearbyMember) => void;
  onDirectDm?: (m: NearbyMember, e: React.MouseEvent) => void;
}) {
  const tier = getTier(member.distance_km);
  const distLabel = member.distance_km < 1
    ? `${Math.round(member.distance_km * 1000)}m`
    : `${Math.round(member.distance_km)}km`;
  const displayName = member.name || member.username || "Anonymous";
  const initial = displayName[0]?.toUpperCase() || "?";
  const isOffline = context === "profile" && !member.is_online;

  // Feed context: show last post cover if available
  const coverUrl = (context === "feed" || context === "default") && member.last_post_media
    ? member.last_post_media
    : member.photo_url;

  return (
    <button
      onClick={() => onTap(member)}
      className="w-full rounded-xl overflow-hidden hover:ring-1 hover:ring-white/20 active:scale-[0.97] transition-all relative"
      style={{
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.06)",
        filter: isOffline ? "grayscale(1)" : undefined,
        opacity: isOffline ? 0.7 : 1,
      }}
    >
      {/* Cover / avatar */}
      <div className="relative h-16 w-full">
        {coverUrl ? (
          <img
            src={coverUrl}
            alt={displayName}
            className="w-full h-full object-cover"
            onError={(e) => {
              const el = e.target as HTMLImageElement;
              el.style.display = "none";
              const sibling = el.nextElementSibling as HTMLElement | null;
              if (sibling) sibling.style.display = "flex";
            }}
          />
        ) : null}
        <div
          className="absolute inset-0 flex items-center justify-center text-lg font-bold"
          style={{
            background: "linear-gradient(135deg, #D4007A, #E69138)",
            color: "#fff",
            display: coverUrl ? "none" : undefined,
          }}
        >
          {initial}
        </div>

        {/* Distance tier emoji (hidden when no distance) */}
        {member.distance_km != null && (
          <span className="absolute bottom-0.5 left-0.5 text-xs drop-shadow-lg">
            {tier.emoji}
          </span>
        )}

        {/* Live: Model badge */}
        {context === "live" && member.isModel && (
          <span
            className="absolute top-0.5 left-0.5 text-[7px] font-bold px-1 rounded"
            style={{ background: PINK, color: "#fff" }}
          >
            MODEL
          </span>
        )}

        {/* Profile: Offline badge */}
        {isOffline && (
          <span
            className="absolute top-0.5 right-0.5 text-[7px] font-bold px-1 rounded"
            style={{ background: "rgba(0,0,0,0.6)", color: "#8E8E93" }}
          >
            Offline
          </span>
        )}

        {/* Feed: post media indicator */}
        {(context === "feed" || context === "default") && member.last_post_media && (
          <span className="absolute top-0.5 right-0.5 text-[9px]">🔥</span>
        )}

        {/* Hangouts / Live: direct DM button */}
        {(context === "hangouts" || context === "live") && onDirectDm && (
          <button
            onClick={(e) => { e.stopPropagation(); onDirectDm(member, e); }}
            className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full flex items-center justify-center transition-colors hover:bg-white/20 active:scale-90"
            style={{ background: "rgba(0,0,0,0.50)" }}
            aria-label={`DM ${displayName}`}
          >
            <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          </button>
        )}
      </div>

      {/* Info row */}
      <div className="px-1.5 py-1.5">
        <p className="text-[10px] font-bold text-white truncate leading-tight">{displayName}</p>
        <p className="text-[8px] truncate leading-tight mt-0.5" style={{ color: "#8E8E93" }}>
          {member.distance_km != null
            ? `${distLabel} · ${tier.short}`
            : member.last_post_caption || (member.last_post_at ? timeAgo(member.last_post_at) : "Posted recently")
          }
        </p>
      </div>
    </button>
  );
}

// ── Main NearbyWidget ─────────────────────────────────────────────────────────
type WidgetView = "grid" | "profile" | "dm" | "place";

export function NearbyWidget({ compact = false }: { compact?: boolean } = {}) {
  const { enabled, position } = useNearbyToggle();
  const navigate = useNavigate();
  const location = useLocation();

  const context = getContext(location.pathname);
  const inHangout = location.pathname.startsWith("/chat/");

  // Extract IDs from URL for context-specific fetches
  const hangoutGroupId = React.useMemo(() => {
    const match = location.pathname.match(/^\/chat\/(\d+)/);
    return match ? parseInt(match[1], 10) : null;
  }, [location.pathname]);

  const streamId = React.useMemo(() => {
    const match = location.pathname.match(/^\/live\/([^/]+)/);
    return match ? match[1] : null;
  }, [location.pathname]);

  const eventId = React.useMemo(() => {
    const match = location.pathname.match(/^\/events\/([^/]+)/);
    return match ? match[1] : null;
  }, [location.pathname]);

  // ── Widget state ──────────────────────────────────────────────────────────
  const [open, setOpen] = useState(false);
  const [members, setMembers] = useState<NearbyMember[]>([]);
  const [places, setPlaces] = useState<NearbyPlace[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(0);
  const [hangoutGroupName, setHangoutGroupName] = useState<string | null>(null);
  const [tokenBalance, setTokenBalance] = useState<number | null>(null);

  // Fetch token balance for live context gate
  useEffect(() => {
    if (context !== "live") return;
    getWalletBalance().then((d) => setTokenBalance(d.balance)).catch(() => setTokenBalance(0));
  }, [context]);

  // Sub-view state
  const [view, setView] = useState<WidgetView>("grid");
  const [selectedUser, setSelectedUser] = useState<NearbyMember | null>(null);
  const [selectedPlace, setSelectedPlace] = useState<NearbyPlace | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileIndex, setProfileIndex] = useState(0);

  // DM state
  const [dmRoomId, setDmRoomId] = useState<string | null>(null);
  const [dmLoading, setDmLoading] = useState(false);
  const [dmError, setDmError] = useState<string | null>(null);

  // ── FAB corner drag ───────────────────────────────────────────────────────
  type Corner = "tl" | "tr" | "bl" | "br";
  const [fabCorner, setFabCorner] = useState<Corner>(() => {
    try { return (localStorage.getItem("nearby_fab_corner") as Corner) || "br"; } catch { return "br"; }
  });
  const fabRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{ startX: number; startY: number; dragging: boolean; moved: boolean }>({ startX: 0, startY: 0, dragging: false, moved: false });

  const handleFabPointerDown = useCallback((e: React.PointerEvent) => {
    dragState.current = { startX: e.clientX, startY: e.clientY, dragging: true, moved: false };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const handleFabPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragState.current.dragging) return;
    const dx = e.clientX - dragState.current.startX;
    const dy = e.clientY - dragState.current.startY;
    if (Math.abs(dx) > 8 || Math.abs(dy) > 8) dragState.current.moved = true;
    if (!dragState.current.moved || !fabRef.current) return;
    fabRef.current.style.transition = "none";
    fabRef.current.style.transform = `translate(${dx}px, ${dy}px)`;
  }, []);

  const handleFabPointerUp = useCallback((e: React.PointerEvent) => {
    if (!dragState.current.dragging) return;
    const wasDragged = dragState.current.moved;
    dragState.current.dragging = false;
    if (!wasDragged) return;
    e.preventDefault();
    e.stopPropagation();
    if (fabRef.current) { fabRef.current.style.transition = ""; fabRef.current.style.transform = ""; }
    const isLeftSide = e.clientX < window.innerWidth / 2;
    const isTopSide = e.clientY < window.innerHeight / 2;
    const newCorner: Corner = isTopSide ? (isLeftSide ? "tl" : "tr") : (isLeftSide ? "bl" : "br");
    setFabCorner(newCorner);
    try { localStorage.setItem("nearby_fab_corner", newCorner); } catch {}
  }, []);

  // ── Reset on route change ─────────────────────────────────────────────────
  useEffect(() => {
    setOpen(false);
    setView("grid");
    setSelectedUser(null);
    setSelectedPlace(null);
    setProfile(null);
    setDmRoomId(null);
    setDmError(null);
    setPage(0);
    setProfileIndex(0);
    setMembers([]);
    setPlaces([]);
  }, [location.pathname]);

  // ── Close modal ───────────────────────────────────────────────────────────
  const closeModal = useCallback(() => {
    setOpen(false);
    setView("grid");
    setSelectedUser(null);
    setSelectedPlace(null);
    setProfile(null);
    setDmRoomId(null);
    setDmError(null);
    setPage(0);
    setProfileIndex(0);
  }, []);

  // ── Fetch data when panel opens, based on context ─────────────────────────
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setMembers([]);
    setPlaces([]);
    setPage(0);

    async function fetchContextData() {
      try {
        switch (context) {
          case "feed": {
            const res = await getNearbyFeedPosters().catch(() => null);
            if (!cancelled && res?.success && res.users) {
              const sorted = [...res.users].sort((a, b) => (a.distance_km ?? 9999) - (b.distance_km ?? 9999));
              setMembers(sorted as NearbyMember[]);
            }
            break;
          }
          case "hangouts": {
            if (hangoutGroupId) {
              const res = await getNearbyHangoutMembers(hangoutGroupId).catch(() => null);
              if (!cancelled && res?.success && res.users) {
                // Cap at 44 — first slot is reserved for group chat card
                const sorted = [...res.users].sort((a, b) => (a.distance_km ?? 9999) - (b.distance_km ?? 9999));
                setMembers(sorted.slice(0, 44).map((u) => ({ ...u, allowDirectDm: true })) as NearbyMember[]);
                if ((res as any).groupName) setHangoutGroupName((res as any).groupName);
              }
            } else {
              // Fallback: generic nearby search
              if (!enabled || !position) break;
              const res = await searchNearby(position.lat, position.lng, 20000, MAX_USERS).catch(() => null);
              if (!cancelled && res?.success && res.users) {
                const sorted = (res.users as NearbyMember[])
                  .filter((u) => u.distance_km != null)
                  .sort((a, b) => (a.distance_km ?? 9999) - (b.distance_km ?? 9999))
                  .slice(0, MAX_USERS);
                setMembers(sorted);
              }
            }
            break;
          }
          case "live": {
            if (streamId) {
              const res = await getNearbyStreamViewers(streamId).catch(() => null);
              if (!cancelled && res?.success && res.users) {
                // First user becomes model
                const withModel = res.users.map((u, i) => ({ ...u, isModel: i === 0, allowDirectDm: i === 0 }));
                const sorted = [withModel[0], ...withModel.slice(1).sort((a, b) => (a.distance_km ?? 9999) - (b.distance_km ?? 9999))].filter(Boolean);
                setMembers(sorted as NearbyMember[]);
              }
            } else {
              if (!enabled || !position) break;
              const res = await searchNearby(position.lat, position.lng, 20000, MAX_USERS).catch(() => null);
              if (!cancelled && res?.success && res.users) {
                const sorted = (res.users as NearbyMember[])
                  .filter((u) => u.distance_km != null)
                  .sort((a, b) => (a.distance_km ?? 9999) - (b.distance_km ?? 9999))
                  .slice(0, MAX_USERS);
                setMembers(sorted);
              }
            }
            break;
          }
          case "events": {
            if (eventId) {
              const res = await getNearbyEventAttendees(eventId).catch(() => null);
              if (!cancelled && res?.success && res.users) {
                const sorted = [...res.users].sort((a, b) => (a.distance_km ?? 9999) - (b.distance_km ?? 9999));
                setMembers(sorted as NearbyMember[]);
              }
            } else {
              if (!enabled || !position) break;
              const res = await searchNearby(position.lat, position.lng, 20000, MAX_USERS).catch(() => null);
              if (!cancelled && res?.success && res.users) {
                const sorted = (res.users as NearbyMember[])
                  .filter((u) => u.distance_km != null)
                  .sort((a, b) => (a.distance_km ?? 9999) - (b.distance_km ?? 9999))
                  .slice(0, MAX_USERS);
                setMembers(sorted);
              }
            }
            break;
          }
          case "profile": {
            const res = await getNearbyAllUsers().catch(() => null);
            if (!cancelled && res?.success && res.users) {
              const sorted = [...res.users].sort((a, b) => (a.distance_km ?? 9999) - (b.distance_km ?? 9999));
              setMembers(sorted as NearbyMember[]);
            }
            break;
          }
          default: {
            // Classic: users + places interleaved
            if (!enabled || !position) break;
            const [usersRes, placesRes] = await Promise.all([
              searchNearby(position.lat, position.lng, 20000, MAX_USERS).catch(() => null),
              searchNearbyPlaces(position.lat, position.lng, 20).catch(() => null),
            ]);
            if (!cancelled) {
              if (usersRes?.success && usersRes.users) {
                const sorted = (usersRes.users as NearbyMember[])
                  .filter((u) => u.distance_km != null)
                  .sort((a, b) => (a.distance_km ?? 9999) - (b.distance_km ?? 9999))
                  .slice(0, MAX_USERS);
                setMembers(sorted);
              }
              if (placesRes?.success && placesRes.places) {
                setPlaces(placesRes.places.slice(0, 12));
              }
            }
            break;
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchContextData();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, context, hangoutGroupId, streamId, eventId, enabled, position?.lat, position?.lng]);

  // ── Build paged grid items ─────────────────────────────────────────────────
  const allGridItems: GridItem[] = React.useMemo(() => {
    const showCommunity = context === "feed" || context === "default";
    const showHangoutChat = context === "hangouts" && hangoutGroupId;

    if (context === "default") {
      // Classic interleaved users + places
      const userItems: GridItem[] = members.map((u) => ({ kind: "user", data: u }));
      const placeItems: GridItem[] = places.map((p) => ({ kind: "place", data: p }));
      const interleaved: GridItem[] = [];
      let ui = 0;
      let pi = 0;
      while (ui < userItems.length || pi < placeItems.length) {
        if (ui < userItems.length) interleaved.push(userItems[ui++]);
        if (ui < userItems.length) interleaved.push(userItems[ui++]);
        if (pi < placeItems.length) interleaved.push(placeItems[pi++]);
      }
      if (showCommunity) {
        const communityItem: GridItem = { kind: "community", data: { type: "community", name: "PNPtv Community" } };
        return [communityItem, ...interleaved];
      }
      return interleaved;
    }

    const userItems: GridItem[] = members.map((u) => ({ kind: "user", data: u }));
    if (showCommunity) {
      const communityItem: GridItem = { kind: "community", data: { type: "community", name: "PNPtv Community" } };
      return [communityItem, ...userItems];
    }
    if (showHangoutChat) {
      const hangoutChatItem: GridItem = { kind: "community", data: { type: "community", name: hangoutGroupName || "Group Chat" } };
      return [hangoutChatItem, ...userItems];
    }
    return userItems;
  }, [members, places, context, hangoutGroupId, hangoutGroupName]);

  const totalPages = Math.ceil(allGridItems.length / GRID_SIZE);
  const gridItems = allGridItems.slice(page * GRID_SIZE, (page + 1) * GRID_SIZE);

  // ── Open user profile ──────────────────────────────────────────────────────
  const openUserProfile = useCallback(async (member: NearbyMember, indexInMembers?: number) => {
    const idx = indexInMembers !== undefined ? indexInMembers : members.findIndex((m) => m.user_id === member.user_id);
    setSelectedUser(member);
    setProfileIndex(idx >= 0 ? idx : 0);
    setView("profile");
    setProfile(null);
    setProfileLoading(true);
    try {
      const res = await getPublicProfile(String(member.user_id));
      if (res.success) setProfile(res.profile);
    } catch {
      // profile stays null — fallback to basic info
    } finally {
      setProfileLoading(false);
    }
  }, [members]);

  const navigateProfile = useCallback(async (newIndex: number) => {
    if (newIndex < 0 || newIndex >= members.length) return;
    const member = members[newIndex];
    setSelectedUser(member);
    setProfileIndex(newIndex);
    setProfile(null);
    setProfileLoading(true);
    try {
      const res = await getPublicProfile(String(member.user_id));
      if (res.success) setProfile(res.profile);
    } catch {}
    finally { setProfileLoading(false); }
  }, [members]);

  // ── Open DM room ───────────────────────────────────────────────────────────
  const openDm = useCallback(async (member: NearbyMember) => {
    setDmLoading(true);
    setDmError(null);
    setDmRoomId(null);
    try {
      const res = await getOrCreateDmRoom(String(member.user_id));
      if (res.success) {
        setDmRoomId(res.roomId);
        setView("dm");
      } else {
        setDmError("Could not open DM room");
      }
    } catch (err) {
      setDmError(err instanceof Error ? err.message : "Failed to open DM");
    } finally {
      setDmLoading(false);
    }
  }, []);

  // Direct DM from card (hangouts/live — skips profile view)
  const handleDirectDm = useCallback((member: NearbyMember, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedUser(member);
    openDm(member);
  }, [openDm]);

  // Open community/hangout group chat
  const openCommunityChat = useCallback(() => {
    closeModal();
    // In hangouts context, stay on current group; otherwise go to community
    const targetGroup = context === "hangouts" && hangoutGroupId ? hangoutGroupId : COMMUNITY_GROUP_ID;
    navigate(`/chat/${targetGroup}`);
  }, [closeModal, navigate, context, hangoutGroupId]);

  // ── FAB position ───────────────────────────────────────────────────────────
  const MY_ORDER = 1;
  const offset = getCornerOffset(MY_ORDER, fabCorner);
  const isTop = fabCorner.startsWith("t");
  const isLeft = fabCorner.endsWith("l");
  const posStyle = {
    [isTop ? "top" : "bottom"]: `calc(5rem + ${offset * 56}px)`,
    [isLeft ? "left" : "right"]: "0.75rem",
    touchAction: "none" as const,
  };

  const totalCount = members.length + places.length;

  // Live context: only show Nearby for users who have tokens
  if (context === "live" && (tokenBalance === null || tokenBalance <= 0)) return null;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      {/* FAB */}
      {compact ? (
        <button
          onClick={() => setOpen(true)}
          className="relative w-9 h-9 rounded-full shadow-lg flex items-center justify-center transition-transform active:scale-90"
          style={{ background: LEMON, boxShadow: `0 4px 20px ${LEMON}40` }}
          aria-label="Nearby members"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="#0a0a14" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
          </svg>
          {totalCount > 0 && (
            <span
              className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] text-[7px] flex items-center justify-center rounded-full font-bold px-1"
              style={{ background: LEMON, color: "#0a0a14" }}
            >
              {totalCount}
            </span>
          )}
        </button>
      ) : (
        <div
          ref={fabRef}
          className="fixed z-[38]"
          style={posStyle}
          onPointerDown={handleFabPointerDown}
          onPointerMove={handleFabPointerMove}
          onPointerUp={handleFabPointerUp}
        >
          <button
            onClick={() => { if (!dragState.current.moved) setOpen(true); }}
            className={`${inHangout ? "w-9 h-9" : "w-12 h-12"} rounded-full flex items-center justify-center shadow-lg transition-transform active:scale-90`}
            style={{ background: LEMON, boxShadow: `0 4px 20px ${LEMON}40` }}
            aria-label="Nearby members"
          >
            <svg className={inHangout ? "w-4 h-4" : "w-5 h-5"} fill="none" viewBox="0 0 24 24" stroke="#0a0a14" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
            </svg>
            {totalCount > 0 && (
              <span
                className={`absolute ${inHangout ? "-top-0.5 -right-0.5 min-w-[14px] h-[14px] text-[7px]" : "-top-1 -right-1 min-w-[18px] h-[18px] text-[9px]"} flex items-center justify-center rounded-full font-bold px-1`}
                style={{ background: LEMON, color: "#0a0a14" }}
              >
                {totalCount}
              </span>
            )}
            {inHangout && (
              <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-green-500 ring-2 ring-pnp-background animate-pulse" />
            )}
          </button>
        </div>
      )}

      {/* Modal Overlay */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={closeModal}
        >
          <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(6px)" }} />

          <div
            className="relative w-full max-w-[380px] rounded-2xl overflow-hidden animate-fade-in-up flex flex-col"
            style={{ background: "#1C1C1E", border: `1px solid rgba(251,255,0,0.20)`, maxHeight: "85vh" }}
            onClick={(e) => e.stopPropagation()}
          >

            {/* ── GRID VIEW ─────────────────────────────────────────────── */}
            {view === "grid" && (
              <>
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b flex-shrink-0" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
                  <div className="flex items-center gap-2">
                    <span className="text-base">📍</span>
                    <h3 className="text-sm font-bold" style={{ color: LEMON }}>
                      {getContextLabel(context)}
                    </h3>
                    {totalCount > 0 && (
                      <span className="text-[10px] font-medium" style={{ color: "rgba(251,255,0,0.6)" }}>
                        {context === "default"
                          ? `${members.length} people · ${places.length} places`
                          : `${members.length} people`}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={closeModal}
                    className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors"
                    aria-label="Close"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="#8E8E93" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                {/* Grid content */}
                <div className="p-3 overflow-y-auto flex-1">
                  {/* Location not ready states (only relevant for default context fallback) */}
                  {(context === "default" || context === "hangouts" || context === "live" || context === "events") && !enabled && !hangoutGroupId && !streamId && !eventId ? (
                    <div className="text-center py-12 px-4">
                      <div className="text-3xl mb-3">📍</div>
                      <p className="text-sm font-semibold" style={{ color: LEMON }}>Nearby is off</p>
                      <p className="text-xs mt-2" style={{ color: "#8E8E93" }}>
                        Turn on location access to discover members near you
                      </p>
                      <button
                        onClick={() => toggleNearby()}
                        className="mt-4 px-5 py-2 rounded-full text-sm font-bold transition-all active:scale-95 hover:brightness-110"
                        style={{ background: LEMON, color: "#0a0a14" }}
                      >
                        Enable Location
                      </button>
                    </div>
                  ) : loading ? (
                    <div className="flex items-center justify-center py-12">
                      <div className="w-6 h-6 border-2 rounded-full animate-spin" style={{ borderColor: `${LEMON}30`, borderTopColor: LEMON }} />
                    </div>
                  ) : gridItems.length === 0 ? (
                    <div className="text-center py-12">
                      <p className="text-sm" style={{ color: "#8E8E93" }}>No nearby people found</p>
                      <p className="text-xs mt-1" style={{ color: "#8E8E9366" }}>Keep your location on to discover others</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 gap-2">
                      {gridItems.map((item, idx) => {
                        if (item.kind === "community") {
                          return (
                            <CommunityCardButton
                              key="community"
                              onClick={openCommunityChat}
                            />
                          );
                        }
                        if (item.kind === "user") {
                          const m = item.data;
                          // Find the original index in members array for profile nav
                          const memberIdx = members.findIndex((mem) => mem.user_id === m.user_id);
                          return (
                            <UserCard
                              key={`user-${m.user_id}`}
                              member={m}
                              context={context}
                              onTap={(member) => openUserProfile(member, memberIdx)}
                              onDirectDm={(context === "hangouts" || context === "live") ? handleDirectDm : undefined}
                            />
                          );
                        }

                        // Place card (default context only)
                        const p = item.data;
                        const placeDistLabel = p.distance < 1
                          ? `${Math.round(p.distance * 1000)}m`
                          : `${Math.round(p.distance)}km`;
                        const placeInitial = (p.categoryEmoji || p.name[0] || "📍");

                        return (
                          <button
                            key={`place-${p.id}`}
                            onClick={() => { setSelectedPlace(p); setView("place"); }}
                            className="w-full rounded-xl overflow-hidden hover:ring-1 hover:ring-yellow-400/20 active:scale-[0.97] transition-all"
                            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(251,255,0,0.10)" }}
                          >
                            <div className="relative h-16 w-full">
                              {p.photoUrl ? (
                                <img
                                  src={p.photoUrl}
                                  alt={p.name}
                                  className="w-full h-full object-cover"
                                  onError={(e) => {
                                    const el = e.target as HTMLImageElement;
                                    el.style.display = "none";
                                    const sibling = el.nextElementSibling as HTMLElement | null;
                                    if (sibling) sibling.style.display = "flex";
                                  }}
                                />
                              ) : null}
                              <div
                                className="absolute inset-0 flex items-center justify-center text-2xl"
                                style={{
                                  background: "linear-gradient(135deg, #2a2a40, #1a2a40)",
                                  display: p.photoUrl ? "none" : undefined,
                                }}
                              >
                                {placeInitial}
                              </div>
                              <span
                                className="absolute top-0.5 right-0.5 text-[7px] font-bold px-1 rounded"
                                style={{ background: "rgba(251,255,0,0.15)", color: LEMON }}
                              >
                                PLACE
                              </span>
                            </div>
                            <div className="px-1.5 py-1.5">
                              <p className="text-[10px] font-bold text-white truncate leading-tight">{p.name}</p>
                              <p className="text-[8px] truncate leading-tight mt-0.5" style={{ color: "#8E8E93" }}>
                                {placeDistLabel} · {p.categoryName || p.placeType || "Place"}
                              </p>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Pagination */}
                <PaginationRow
                  page={page}
                  totalPages={totalPages}
                  onPrev={() => setPage((p) => Math.max(0, p - 1))}
                  onNext={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                />
              </>
            )}

            {/* ── PROFILE VIEW ──────────────────────────────────────────── */}
            {view === "profile" && selectedUser && (
              <>
                {/* Header */}
                <div className="flex items-center gap-2 px-3 py-2.5 border-b flex-shrink-0" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
                  <button
                    onClick={() => { setView("grid"); setProfile(null); setSelectedUser(null); }}
                    className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-white/10 transition-colors"
                    aria-label="Back"
                  >
                    <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                  <span className="text-sm font-bold flex-1" style={{ color: LEMON }}>
                    {getContextLabel(context)}
                  </span>
                  <button
                    onClick={closeModal}
                    className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-white/10 transition-colors"
                    aria-label="Close"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="#8E8E93" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                <div className="overflow-y-auto flex-1">
                  {profileLoading ? (
                    <div className="flex items-center justify-center py-16">
                      <div className="w-6 h-6 border-2 rounded-full animate-spin" style={{ borderColor: `${PINK}30`, borderTopColor: PINK }} />
                    </div>
                  ) : (
                    <div className="px-5 py-5 flex flex-col items-center text-center gap-3">
                      {/* Avatar */}
                      <div className="w-20 h-20 rounded-full overflow-hidden flex-shrink-0">
                        {selectedUser.photo_url ? (
                          <img
                            src={selectedUser.photo_url}
                            alt=""
                            className="w-full h-full object-cover"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                          />
                        ) : (
                          <div
                            className="w-full h-full flex items-center justify-center text-2xl font-bold"
                            style={{ background: "linear-gradient(135deg, #D4007A, #E69138)", color: "#fff" }}
                          >
                            {(profile?.firstName || selectedUser.name || selectedUser.username || "?")[0].toUpperCase()}
                          </div>
                        )}
                      </div>

                      {/* Name + username */}
                      <div>
                        <p className="text-base font-bold text-white">
                          {profile?.firstName
                            ? `${profile.firstName}${profile.lastName ? " " + profile.lastName : ""}`
                            : selectedUser.name || selectedUser.username || "Anonymous"}
                        </p>
                        {(profile?.username || selectedUser.username) && (
                          <p className="text-xs mt-0.5" style={{ color: "#8E8E93" }}>
                            @{profile?.username || selectedUser.username}
                          </p>
                        )}
                      </div>

                      {/* Distance */}
                      <div className="flex items-center gap-1 text-xs" style={{ color: "#8E8E93" }}>
                        <span>📍</span>
                        <span>
                          {selectedUser.distance_km < 1
                            ? `${Math.round(selectedUser.distance_km * 1000)}m`
                            : `${Math.round(selectedUser.distance_km)}km`} ·{" "}
                          {getTier(selectedUser.distance_km).short}
                        </span>
                      </div>

                      {/* Bio */}
                      {profile?.bio && (
                        <p className="text-sm text-white/70 max-w-[260px] leading-relaxed">{profile.bio}</p>
                      )}

                      {/* Location */}
                      {profile?.city && (
                        <p className="text-xs" style={{ color: "#8E8E93" }}>
                          {[profile.city, profile.country].filter(Boolean).join(", ")}
                        </p>
                      )}

                      {/* DM error */}
                      {dmError && (
                        <p className="text-xs" style={{ color: "#FF453A" }}>{dmError}</p>
                      )}

                      {/* Action buttons */}
                      <div className="flex items-center gap-3 mt-2 w-full">
                        <button
                          onClick={() => openDm(selectedUser)}
                          disabled={dmLoading}
                          className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-1.5"
                          style={{ background: PINK }}
                        >
                          {dmLoading ? (
                            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                            </svg>
                          ) : (
                            <>
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                              </svg>
                              Message
                            </>
                          )}
                        </button>
                        <button
                          onClick={() => { closeModal(); navigate(`/profile/${selectedUser.user_id}`); }}
                          className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white transition-all active:scale-95 flex items-center justify-center gap-1.5"
                          style={{ background: "rgba(255,255,255,0.10)" }}
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                          </svg>
                          Profile
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Profile prev/next arrows */}
                <ProfileNavRow
                  index={profileIndex}
                  total={members.length}
                  onPrev={() => navigateProfile(profileIndex - 1)}
                  onNext={() => navigateProfile(profileIndex + 1)}
                />
              </>
            )}

            {/* ── DM VIEW ───────────────────────────────────────────────── */}
            {view === "dm" && selectedUser && dmRoomId && (
              <DmView
                roomId={dmRoomId}
                partnerName={
                  profile?.firstName ||
                  selectedUser.name ||
                  selectedUser.username ||
                  "User"
                }
                myUserId={null}
                onBack={() => setView("profile")}
              />
            )}

            {/* ── PLACE VIEW ────────────────────────────────────────────── */}
            {view === "place" && selectedPlace && (
              <>
                <div className="flex items-center gap-2 px-3 py-2.5 border-b flex-shrink-0" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
                  <button
                    onClick={() => { setView("grid"); setSelectedPlace(null); }}
                    className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-white/10 transition-colors"
                    aria-label="Back"
                  >
                    <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                  <span className="text-sm font-bold flex-1" style={{ color: LEMON }}>Nearby</span>
                  <button
                    onClick={closeModal}
                    className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-white/10 transition-colors"
                    aria-label="Close"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="#8E8E93" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                <div className="overflow-y-auto flex-1">
                  <div className="relative w-full h-36 overflow-hidden flex-shrink-0">
                    {selectedPlace.photoUrl ? (
                      <img
                        src={selectedPlace.photoUrl}
                        alt={selectedPlace.name}
                        className="w-full h-full object-cover"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                      />
                    ) : (
                      <div
                        className="w-full h-full flex items-center justify-center text-5xl"
                        style={{ background: "linear-gradient(135deg, #2a2a40, #1a2a40)" }}
                      >
                        {selectedPlace.categoryEmoji || "📍"}
                      </div>
                    )}
                  </div>

                  <div className="px-4 py-4 space-y-3">
                    <h3 className="text-lg font-bold text-white">{selectedPlace.name}</h3>
                    <div className="flex flex-wrap gap-3">
                      {selectedPlace.categoryName && (
                        <span className="text-sm" style={{ color: LEMON }}>
                          {selectedPlace.categoryEmoji && `${selectedPlace.categoryEmoji} `}{selectedPlace.categoryName}
                        </span>
                      )}
                      <span className="text-sm" style={{ color: "#8E8E93" }}>
                        📍 {selectedPlace.distance < 1
                          ? `${Math.round(selectedPlace.distance * 1000)}m`
                          : `${selectedPlace.distance.toFixed(1)}km`} away
                      </span>
                    </div>
                    {selectedPlace.description && (
                      <p className="text-sm text-white/70 leading-relaxed">{selectedPlace.description}</p>
                    )}
                    <div className="space-y-2">
                      {selectedPlace.address && (
                        <div className="flex items-start gap-2 text-sm text-white/70">
                          <span className="flex-shrink-0">📍</span>
                          <span>{selectedPlace.address}{selectedPlace.city ? `, ${selectedPlace.city}` : ""}</span>
                        </div>
                      )}
                      {selectedPlace.website && (
                        <a
                          href={selectedPlace.website.startsWith("http") ? selectedPlace.website : `https://${selectedPlace.website}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2 text-sm hover:opacity-80 transition-opacity"
                          style={{ color: LEMON }}
                        >
                          <span>🌐</span>
                          <span className="truncate">{selectedPlace.website}</span>
                        </a>
                      )}
                      {selectedPlace.phone && (
                        <a
                          href={`tel:${selectedPlace.phone}`}
                          className="flex items-center gap-2 text-sm text-white/70 hover:opacity-80 transition-opacity"
                        >
                          <span>📞</span>
                          <span>{selectedPlace.phone}</span>
                        </a>
                      )}
                      {selectedPlace.instagram && (
                        <a
                          href={`https://instagram.com/${selectedPlace.instagram.replace(/^@/, "")}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2 text-sm hover:opacity-80 transition-opacity"
                          style={{ color: PINK }}
                        >
                          <span>📸</span>
                          <span>@{selectedPlace.instagram.replace(/^@/, "")}</span>
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
