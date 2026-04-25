import React, { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Button } from "@pnptv/ui-kit";
import { useNearbyToggle, getTier, toggleNearby } from "@/components/NearbyBadge";
import { useTier } from "@/hooks/useTier";
import { getSocket } from "@/lib/socket";
import {
  searchNearby,
  searchNearbyPlaces,
  getPublicProfile,
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
    default: return "PNP Connect";
  }
}

interface NearbyMember {
  user_id: number | string;
  username?: string | null;
  name?: string | null;
  photo_url?: string | null;
  distance_km: number;
  is_online?: boolean;
  last_post_media?: string | null;
  last_post_caption?: string | null;
  last_post_at?: string | null;
  allowDirectDm?: boolean;
  isModel?: boolean;
}

interface CommunityCard {
  type: "community";
  name: string;
}

type GridItem =
  | { kind: "user"; data: NearbyMember }
  | { kind: "place"; data: NearbyPlace }
  | { kind: "community"; data: CommunityCard };

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
      >
        <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </button>
    </div>
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
      <div className="relative h-16 w-full">
        {coverUrl ? (
          <img
            src={coverUrl}
            alt={displayName}
            className="w-full h-full object-cover"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
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
        {member.distance_km != null && (
          <span className="absolute bottom-0.5 left-0.5 text-xs drop-shadow-lg">{tier.emoji}</span>
        )}
        {onDirectDm && (
          <button
            onClick={(e) => { e.stopPropagation(); onDirectDm(member, e); }}
            className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full flex items-center justify-center transition-colors hover:bg-white/20 active:scale-90"
            style={{ background: "rgba(0,0,0,0.50)" }}
          >
            <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          </button>
        )}
      </div>
      <div className="px-1.5 py-1.5 text-left">
        <p className="text-[10px] font-bold text-white truncate leading-tight">{displayName}</p>
        <p className="text-[8px] truncate leading-tight mt-0.5" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
          {member.distance_km != null ? `${distLabel} · ${tier.short}` : "Active recently"}
        </p>
      </div>
    </button>
  );
}

export function NearbyPanel({ onClose }: { onClose: () => void }) {
  const { enabled, position } = useNearbyToggle();
  const navigate = useNavigate();
  const location = useLocation();
  const context = getContext(location.pathname);

  const [members, setMembers] = useState<NearbyMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(0);
  const [view, setView] = useState<"grid" | "profile">("grid");
  const [selectedUser, setSelectedUser] = useState<NearbyMember | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    async function fetchData() {
      try {
        if (!enabled || !position) { setLoading(false); return; }
        const res = await searchNearby(position.lat, position.lng, 20000, MAX_USERS).catch(() => null);
        if (!cancelled && res?.success && res.users) {
          setMembers(res.users as NearbyMember[]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchData();
    return () => { cancelled = true; };
  }, [enabled, position]);

  const totalPages = Math.ceil(members.length / GRID_SIZE);
  const gridItems = members.slice(page * GRID_SIZE, (page + 1) * GRID_SIZE);

  const openUserProfile = async (member: NearbyMember) => {
    setSelectedUser(member);
    setView("profile");
    setProfile(null);
    setProfileLoading(true);
    try {
      const res = await getPublicProfile(String(member.user_id));
      if (res.success) setProfile(res.profile);
    } catch {} finally { setProfileLoading(false); }
  };

  const openDm = (member: NearbyMember) => {
    onClose();
    navigate(`/dm/${member.user_id}`);
  };

  return (
    <div className="flex flex-col bg-[#1C1C1E] rounded-t-3xl overflow-hidden" style={{ maxHeight: "80vh" }}>
      <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between">
        <h3 className="text-sm font-bold text-[#FFB454]">PNP Connect</h3>
        <button onClick={onClose} className="p-1"><svg className="w-5 h-5 text-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M6 18L18 6M6 6l12 12" /></svg></button>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {view === "grid" ? (
          <div className="grid grid-cols-3 gap-2">
            {gridItems.map((m) => (
              <UserCard key={m.user_id} member={m} context={context} onTap={openUserProfile} onDirectDm={openDm} />
            ))}
          </div>
        ) : selectedUser && (
          <div className="flex flex-col items-center py-6 text-center gap-4">
            <div className="w-24 h-24 rounded-full overflow-hidden bg-pnp-accent">
              {selectedUser.photo_url ? <img src={selectedUser.photo_url} className="w-full h-full object-cover" /> : <span className="text-3xl font-bold text-white uppercase">{selectedUser.name?.[0]}</span>}
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">{selectedUser.name || "Anonymous"}</h2>
              <p className="text-xs text-white/40">@{selectedUser.username}</p>
            </div>
            <div className="flex gap-2 w-full px-4">
              <Button onClick={() => openDm(selectedUser)} className="flex-1">Message</Button>
              <Button onClick={() => navigate(`/profile/${selectedUser.user_id}`)} variant="secondary" className="flex-1">Profile</Button>
            </div>
            <button onClick={() => setView("grid")} className="text-sm text-pnp-accent font-medium">Back to grid</button>
          </div>
        )}
      </div>

      {view === "grid" && <PaginationRow page={page} totalPages={totalPages} onPrev={() => setPage(p => Math.max(0, p - 1))} onNext={() => setPage(p => Math.min(totalPages - 1, p + 1))} />}
    </div>
  );
}

export function NearbyWidget() { return null; }
