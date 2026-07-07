import React, { useState, useEffect, useRef, useCallback } from "react";
import { Helmet } from "react-helmet-async";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@pnptv/ui-kit";
import { useTutorial } from "@/hooks/useTutorial";
import { TutorialOverlay } from "@/components/tutorial/TutorialOverlay";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/lib/i18n";
import {
  updateNearbyLocation,
  searchNearby,
  searchNearbyPlaces,
  getFallbackNearbyPlaces,
  submitNearbyPlace,
  favoritePlaceToggle,
  trackPlaceView,
  reportPlace,
  getPlaceFavorites,
  blockUser,
  getOnlineUsers,
  browseCreatorChannels,
  getAllPerformers,
  getPublicProfile,
  type NearbyUser,
  type NearbyPlace,
  type NearbySearchResponse,
  type OnlineUser,
  type SubmitPlacePayload,
  type CreatorChannel,
  type FeaturedPerformer,
  type SocialPostItem,
} from "@/lib/api";
import { connectSocket } from "@/lib/socket";
import { BookCallModal } from "@/components/creators/BookCallModal";
// Inline SVG icon helpers (no lucide-react dependency)
const IcoMapPin = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
);
const IcoGlobe = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
    <circle cx="12" cy="12" r="10" /><path strokeLinecap="round" strokeLinejoin="round" d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
  </svg>
);
const IcoEye = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
  </svg>
);
const IcoEyeOff = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
  </svg>
);
const IcoShield = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
  </svg>
);
const IcoX = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
  </svg>
);
const IcoMessage = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
  </svg>
);
const IcoUser = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
  </svg>
);
const IcoSlash = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
    <circle cx="12" cy="12" r="10" /><path strokeLinecap="round" strokeLinejoin="round" d="M4.93 4.93l14.14 14.14" />
  </svg>
);
const IcoAlert = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
    <circle cx="12" cy="12" r="10" /><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4M12 16h.01" />
  </svg>
);
const IcoSpinner = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
  </svg>
);
const IcoPlus = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
  </svg>
);
const IcoChevronDown = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
  </svg>
);
const IcoHeart = ({ className, filled }: { className?: string; filled?: boolean }) => (
  <svg className={className} viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth={2} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
  </svg>
);
const IcoMap = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
  </svg>
);

// ─── Constants ───────────────────────────────────────────────────────────────

const RADIUS_OPTIONS_KM = [5, 10, 25, 50] as const;
type RadiusKm = (typeof RADIUS_OPTIONS_KM)[number];

// Miles approximations for display (5km≈3mi, 10km≈6mi, 25km≈15mi, 50km≈31mi)
const KM_TO_MI_LABEL: Record<RadiusKm, string> = {
  5: "3 mi",
  10: "6 mi",
  25: "15 mi",
  50: "31 mi",
};

const DEFAULT_RADIUS: RadiusKm = 25;
const ONLINE_REFRESH_INTERVAL = 30_000;
const REALWORLD_REFRESH_INTERVAL = 15_000;
// Minimum gap between location pushes to the server (GPS watch fires every 1-2s on mobile)
const MIN_LOCATION_SEND_MS = 30_000;
// Send immediately if user moved more than this many meters since the last push
const MIN_MOVEMENT_METERS = 50;
const LAST_POS_KEY = "pnptv:nearbyLastPos";
const FAV_PLACES_KEY = "pnptv:favPlaces";
const SAFETY_BANNER_KEY = "pnptv:nearbyBannerDismissed";

type Mode = "realworld" | "online" | "calls";
type PageState = "loading" | "denied" | "ready";

// ─── Utility helpers ──────────────────────────────────────────────────────────

function isValidPhotoUrl(url: string | null | undefined): url is string {
  return !!url && (url.startsWith("/uploads/") || url.startsWith("http"));
}

function sanitizePhone(phone: string): string {
  return phone.replace(/[^0-9+\-\s()]/g, "");
}

function formatLastSeen(iso: string | null | undefined): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 2) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function formatUserDistMi(u: NearbyUser): string {
  const km = u.distance_km;
  const m = u.distance_m;
  if (m !== undefined && m < 1609) return "< 1 mi";
  if (km !== undefined) {
    const mi = km * 0.621371;
    if (mi < 1) return "< 1 mi";
    return `${Math.round(mi)} mi`;
  }
  return "nearby";
}

function formatOnlineTime(iso: string | undefined): string {
  if (!iso) return "online";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 2) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ─── Place categories ────────────────────────────────────────────────────────

const PLACE_CATEGORY_CHIPS = [
  { slug: null, emoji: "All", label: "All" },
  { slug: "wellness", emoji: "🧘", label: "Wellness" },
  { slug: "cruising-spots", emoji: "🌙", label: "Cruising" },
  { slug: "adult-entertainment", emoji: "🔞", label: "+18" },
  { slug: "pnp-friendly", emoji: "💨", label: "PNP" },
  { slug: "saunas", emoji: "🧖", label: "Saunas" },
  { slug: "bars-clubs", emoji: "🍸", label: "Bars" },
  { slug: "community-businesses", emoji: "🏪", label: "Community" },
  { slug: "hotels-lodging", emoji: "🏨", label: "Hotels" },
] as const;

const PLACE_CATEGORIES_IDS = [
  { id: 1,  key: "categoryWellness" as const,           emoji: "🧘" },
  { id: 2,  key: "categoryCruisingSpots" as const,      emoji: "🌙" },
  { id: 3,  key: "categoryAdultBusinesses" as const,    emoji: "🔞" },
  { id: 4,  key: "categoryPnpFriendly" as const,        emoji: "💨" },
  { id: 5,  key: "categoryHelpCenters" as const,        emoji: "🏥" },
  { id: 6,  key: "categorySaunas" as const,             emoji: "🧖" },
  { id: 7,  key: "categoryBarsClubs" as const,          emoji: "🍸" },
  { id: 8,  key: "categoryCommunityBusinesses" as const,emoji: "🏪" },
  { id: 25, key: "categoryHotelsLodging" as const,      emoji: "🏨" },
];

// ─── UserCard (grid cell) ─────────────────────────────────────────────────────

interface UserCardProps {
  name: string;
  photoUrl?: string | null;
  label: string;
  labelColor?: string;
  isOnline?: boolean;
  onClick: () => void;
}

const UserCard = React.memo(function UserCard({
  name,
  photoUrl,
  label,
  labelColor = "#8E8E93",
  isOnline = false,
  onClick,
}: UserCardProps) {
  const initial = (name || "?")[0].toUpperCase();
  return (
    <button
      onClick={onClick}
      className="aspect-square relative overflow-hidden rounded-lg focus-visible:ring-2 focus-visible:ring-pnp-accent focus-visible:ring-offset-1 focus-visible:ring-offset-pnp-background active:scale-[0.97] transition-transform"
      aria-label={`View profile of ${name}`}
    >
      {isValidPhotoUrl(photoUrl) ? (
        <img
          src={photoUrl}
          alt=""
          className="w-full h-full object-cover"
          loading="lazy"
        />
      ) : (
        <div
          className="w-full h-full flex items-center justify-center text-2xl font-bold text-white"
          style={{ background: "linear-gradient(135deg, #2C1654, #4A1932)" }}
          aria-hidden="true"
        >
          {initial}
        </div>
      )}

      {/* Bottom gradient + labels */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent pointer-events-none" />

      {/* Name — bottom-left */}
      <span className="absolute bottom-1 left-1.5 text-[10px] font-semibold text-white truncate max-w-[70%] leading-tight drop-shadow-sm">
        {name}
      </span>

      {/* Distance / city label — bottom-right */}
      <span
        className="absolute bottom-1 right-1.5 text-[9px] font-medium leading-tight drop-shadow-sm"
        style={{ color: labelColor }}
      >
        {label}
      </span>

      {/* Online dot — top-right */}
      {isOnline && (
        <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-green-500 ring-2 ring-black" aria-label="Online" />
      )}
    </button>
  );
});

// ─── PlaceCard (horizontal scroll strip) ─────────────────────────────────────

interface PlaceCardProps {
  place: NearbyPlace;
  isFavorited: boolean;
  onClick: () => void;
}

const PlaceCard = React.memo(function PlaceCard({ place, isFavorited, onClick }: PlaceCardProps) {
  const emoji = place.categoryEmoji || "📍";
  const distKm = place.distance;
  const distMi = distKm * 0.621371;
  const distLabel = distMi < 0.1
    ? `${Math.round(distKm * 1000)}m`
    : distMi < 1
    ? "< 1 mi"
    : `${Math.round(distMi)} mi`;

  return (
    <button
      onClick={onClick}
      className="flex-shrink-0 w-40 rounded-xl overflow-hidden border border-white/10 text-left active:scale-[0.97] transition-transform focus-visible:ring-2 focus-visible:ring-pnp-accent focus-visible:ring-offset-1 focus-visible:ring-offset-pnp-background"
      style={{ background: "rgba(28,28,30,0.85)" }}
      aria-label={`View details for ${place.name}`}
    >
      {/* Photo or emoji bg */}
      <div className="relative h-20 flex items-center justify-center overflow-hidden"
        style={{ background: "linear-gradient(135deg, #1C2E1C, #2C1654)" }}>
        {isValidPhotoUrl(place.photoUrl) ? (
          <img src={place.photoUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <span className="text-3xl" aria-hidden="true">{emoji}</span>
        )}
        {isFavorited && (
          <span className="absolute top-1.5 right-1.5">
            <IcoHeart className="w-3.5 h-3.5 text-pnp-accent" filled />
          </span>
        )}
      </div>

      {/* Info */}
      <div className="p-2">
        <p className="text-[11px] font-semibold text-pnp-textPrimary truncate leading-tight">{place.name}</p>
        {place.categoryName && (
          <span className="inline-block mt-0.5 text-[9px] px-1.5 py-0.5 rounded-full bg-green-500/15 text-green-400 font-medium truncate max-w-full">
            {place.categoryName}
          </span>
        )}
        <div className="flex items-center justify-between mt-1">
          <span className="text-[10px]" style={{ color: "#34C85A" }}>{distLabel}</span>
          {place.favoriteCount !== undefined && place.favoriteCount > 0 && (
            <span className="text-[9px] text-pnp-textSecondary flex items-center gap-0.5">
              <IcoHeart className="w-2.5 h-2.5" />
              {place.favoriteCount}
            </span>
          )}
        </div>
      </div>
    </button>
  );
});

// ─── UserQuickView (bottom sheet) ─────────────────────────────────────────────

interface UserQuickViewProps {
  user: NearbyUser | null;
  onlineUser: OnlineUser | null;
  onClose: () => void;
  onNavigate: (path: string) => void;
  onBlock: (userId: string) => void;
}

function UserQuickView({ user, onlineUser, onClose, onNavigate, onBlock }: UserQuickViewProps) {
  const t = useI18n();
  const [blocking, setBlocking] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const backdropRef = useRef<HTMLDivElement>(null);

  const name = user
    ? (user.name || user.username || `User #${user.user_id}`)
    : (onlineUser?.name || onlineUser?.username || "User");

  const photoUrl = user?.photo_url ?? onlineUser?.photo_url;
  const username = user?.username ?? onlineUser?.username;
  const isOnline = user ? user.status !== "offline" : (onlineUser?.is_online ?? false);
  const userId = user ? String(user.user_id) : (onlineUser?.user_id ?? "");

  const sublabel = user
    ? (user.status === "offline" && user.last_seen
        ? `Last seen ${formatLastSeen(user.last_seen)}`
        : formatUserDistMi(user))
    : onlineUser
    ? [onlineUser.city, onlineUser.country].filter(Boolean).join(", ")
    : "";

  const handleBlock = async () => {
    if (!userId || blocking || blocked) return;
    setBlocking(true);
    try {
      await blockUser(userId);
      setBlocked(true);
      onBlock(userId);
      setTimeout(onClose, 800);
    } catch {
      // silent
    } finally {
      setBlocking(false);
    }
  };

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-[1100] flex items-end"
      style={{ backdropFilter: "blur(4px)", backgroundColor: "rgba(0,0,0,0.5)" }}
      onClick={(e) => { if (e.target === backdropRef.current) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label={`Profile of ${name}`}
    >
      <div
        className="w-full max-w-lg mx-auto rounded-t-2xl border border-white/10 overflow-hidden animate-slide-up"
        style={{ background: "rgba(28,28,30,0.98)", backdropFilter: "blur(20px)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-2.5 pb-1">
          <div className="w-9 h-1 rounded-full bg-white/20" />
        </div>

        {/* Close button */}
        <div className="absolute top-3 right-4">
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/15 active:scale-95 transition-all"
            aria-label={t.booking.close}
          >
            <IcoX className="w-4 h-4 text-white/70" />
          </button>
        </div>

        <div className="px-5 pb-6 pt-2">
          {/* Avatar + info */}
          <div className="flex flex-col items-center text-center mb-5">
            <div className="relative mb-3">
              {isValidPhotoUrl(photoUrl) ? (
                <img
                  src={photoUrl}
                  alt={name}
                  className="w-20 h-20 rounded-2xl object-cover"
                />
              ) : (
                <div
                  className="w-20 h-20 rounded-2xl flex items-center justify-center text-3xl font-bold text-white"
                  style={{ background: "linear-gradient(135deg, #2C1654, #4A1932)" }}
                  aria-hidden="true"
                >
                  {(name || "?")[0].toUpperCase()}
                </div>
              )}
              {isOnline && (
                <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-green-500 ring-2 ring-[#1C1C1E]" aria-label="Online now" />
              )}
            </div>

            <p className="text-base font-bold text-pnp-textPrimary">{name}</p>
            {username && (
              <p className="text-sm text-pnp-textSecondary mt-0.5">@{username}</p>
            )}
            {sublabel && (
              <p className="text-xs mt-1.5 font-medium" style={{ color: isOnline ? "#FFB454" : "#555" }}>
                {sublabel}
              </p>
            )}
          </div>

          {/* Action buttons */}
          {blocked ? (
            <p className="text-center text-sm text-red-400 font-medium py-2">User blocked</p>
          ) : (
            <div className="flex gap-2">
              <button
                onClick={() => onNavigate(`/dm/${userId}`)}
                className="flex-1 min-h-[44px] rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
                style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
              >
                <IcoMessage className="w-4 h-4" />
                Message
              </button>

              <button
                onClick={() => onNavigate(`/profile/${userId}`)}
                className="flex-1 min-h-[44px] rounded-xl text-sm font-semibold text-white/80 border border-white/10 hover:bg-white/5 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
              >
                <IcoUser className="w-4 h-4" />
                {t.booking.viewProfile}
              </button>

              <button
                onClick={handleBlock}
                disabled={blocking}
                className="min-h-[44px] px-4 rounded-xl text-sm font-semibold text-red-400 border border-red-500/30 hover:bg-red-500/10 active:scale-[0.98] transition-all disabled:opacity-40 flex items-center justify-center"
                aria-label="Block this user"
              >
                {blocking ? (
                  <IcoSpinner className="w-4 h-4 animate-spin" />
                ) : (
                  <IcoSlash className="w-4 h-4" />
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── PlaceDetailSheet ─────────────────────────────────────────────────────────

interface PlaceDetailSheetProps {
  place: NearbyPlace;
  onClose: () => void;
  isFavorited: boolean;
  onToggleFavorite: (placeId: number) => void;
}

function PlaceDetailSheet({ place, onClose, isFavorited, onToggleFavorite }: PlaceDetailSheetProps) {
  const t = useI18n();
  const [reportSent, setReportSent] = useState(false);
  const [showReportConfirm, setShowReportConfirm] = useState(false);
  const backdropRef = useRef<HTMLDivElement>(null);

  function formatPlaceDist(p: NearbyPlace): string {
    const mi = p.distance * 0.621371;
    if (mi < 0.1) return t.booking.metersAway(Math.round(p.distance * 1000));
    if (mi < 1) return "< 1 mi";
    return `${Math.round(mi)} mi`;
  }

  const isOpenNow = React.useMemo(() => {
    const hours = place.hoursOfOperation;
    if (!hours || Object.keys(hours).length === 0) return null;
    const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    const dayKey = days[new Date().getDay()];
    const todayHours = hours[dayKey];
    if (!todayHours || todayHours.toLowerCase() === "closed") return false;
    return true;
  }, [place.hoursOfOperation]);

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-[1100] flex items-end"
      style={{ backdropFilter: "blur(4px)", backgroundColor: "rgba(0,0,0,0.5)" }}
      onClick={(e) => { if (e.target === backdropRef.current) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label={`Details for ${place.name}`}
    >
      <div
        className="w-full max-w-lg mx-auto rounded-t-2xl border border-white/10 overflow-hidden max-h-[75vh] overflow-y-auto animate-slide-up"
        style={{ background: "rgba(28,28,30,0.98)", backdropFilter: "blur(20px)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-center pt-2.5 pb-1">
          <div className="w-9 h-1 rounded-full bg-white/20" />
        </div>

        <div className="px-4 pb-5">
          {/* Place header */}
          <div className="flex items-center gap-3 mb-3">
            {isValidPhotoUrl(place.photoUrl) ? (
              <img src={place.photoUrl} className="w-12 h-12 rounded-xl object-cover flex-shrink-0" alt={place.name} />
            ) : (
              <div className="w-12 h-12 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
                style={{ background: "rgba(52,200,90,0.15)" }}>
                {place.categoryEmoji || "📍"}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm text-pnp-textPrimary truncate">{place.name}</p>
              {place.categoryName && (
                <p className="text-xs text-pnp-textSecondary">{place.categoryName}</p>
              )}
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-xs" style={{ color: "#34C85A" }}>{formatPlaceDist(place)}</span>
                {isOpenNow !== null && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                    isOpenNow ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"
                  }`}>
                    {isOpenNow ? "Abierto" : "Cerrado"}
                  </span>
                )}
              </div>
            </div>
            <button
              onClick={() => onToggleFavorite(place.id)}
              className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center active:scale-90 transition-transform"
              style={{ background: isFavorited ? "rgba(230,145,56,0.2)" : "rgba(255,255,255,0.05)" }}
              aria-label={isFavorited ? "Remove from favorites" : "Add to favorites"}
            >
              <IcoHeart className="w-5 h-5" filled={isFavorited} />
            </button>
          </div>

          {/* Details */}
          <div className="space-y-2 mb-3">
            {place.description && (
              <p className="text-xs text-pnp-textSecondary leading-relaxed">{place.description}</p>
            )}
            {place.address && (
              <div className="flex items-start gap-2">
                <IcoMapPin className="w-3.5 h-3.5 text-pnp-textSecondary flex-shrink-0 mt-0.5" />
                <p className="text-xs text-pnp-textSecondary">{place.address}{place.city ? `, ${place.city}` : ""}</p>
              </div>
            )}
            {place.phone && (
              <div className="flex items-center gap-2">
                <svg className="w-3.5 h-3.5 text-pnp-textSecondary flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                </svg>
                <a href={`tel:${sanitizePhone(place.phone ?? "")}`} className="text-xs" style={{ color: "#34C85A" }}>{place.phone}</a>
              </div>
            )}
          </div>

          {/* Hours */}
          {place.hoursOfOperation && Object.keys(place.hoursOfOperation).length > 0 && (
            <div className="mb-3 bg-white/5 rounded-lg p-2.5">
              <p className="text-[10px] font-semibold text-pnp-textSecondary uppercase tracking-wider mb-1.5">Horario</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                {["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map((day) => {
                  const label = { monday: "Lun", tuesday: "Mar", wednesday: "Mie", thursday: "Jue", friday: "Vie", saturday: "Sab", sunday: "Dom" }[day];
                  const val = place.hoursOfOperation?.[day] || "Cerrado";
                  return (
                    <div key={day} className="flex justify-between text-[11px]">
                      <span className="text-pnp-textSecondary">{label}</span>
                      <span className="text-pnp-textPrimary">{val}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-2 flex-wrap">
            {place.website && /^https?:\/\//i.test(place.website) && (
              <a href={place.website} target="_blank" rel="noopener noreferrer"
                className="flex-1 min-h-[44px] py-2.5 rounded-xl text-sm font-semibold text-white text-center active:scale-[0.98] transition-transform flex items-center justify-center"
                style={{ background: "linear-gradient(135deg, #34C85A, #2EA04A)" }}>
                {t.booking.visitWebsite}
              </a>
            )}
            {place.instagram && (
              <a href={`https://instagram.com/${place.instagram.replace("@", "")}`} target="_blank" rel="noopener noreferrer"
                className="min-h-[44px] px-4 py-2.5 rounded-xl text-sm font-semibold text-white text-center active:scale-[0.98] transition-transform flex items-center justify-center"
                style={{ background: "linear-gradient(135deg, #833AB4, #E1306C)" }}>
                Instagram
              </a>
            )}
            {place.telegramUsername && (
              <a href={`https://t.me/${place.telegramUsername.replace("@", "")}`} target="_blank" rel="noopener noreferrer"
                className="min-h-[44px] px-4 py-2.5 rounded-xl text-sm font-semibold text-white text-center active:scale-[0.98] transition-transform flex items-center justify-center"
                style={{ background: "linear-gradient(135deg, #0088CC, #229ED9)" }}>
                Telegram
              </a>
            )}
            <button onClick={onClose}
              className="min-h-[44px] px-4 py-2.5 rounded-xl text-sm text-pnp-textSecondary border border-white/10 hover:bg-white/5 active:scale-[0.98] transition-all">
              {t.booking.close}
            </button>
          </div>

          {/* Report */}
          <div className="mt-3 text-center">
            {reportSent ? (
              <p className="text-[11px] text-green-400">Reporte enviado. Gracias.</p>
            ) : showReportConfirm ? (
              <div className="flex items-center justify-center gap-2">
                <span className="text-[11px] text-pnp-textSecondary">¿Reportar como inapropiado?</span>
                <button onClick={() => setShowReportConfirm(false)} className="text-[11px] text-pnp-textSecondary underline">Cancelar</button>
                <button
                  onClick={() => { reportPlace(place.id).catch(() => {}); setReportSent(true); setShowReportConfirm(false); }}
                  className="text-[11px] text-red-400 underline font-medium">
                  Reportar
                </button>
              </div>
            ) : (
              <button onClick={() => setShowReportConfirm(true)} className="text-[11px] text-pnp-textSecondary/60 hover:text-pnp-textSecondary">
                Reportar lugar
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── SubmitPlaceModal ─────────────────────────────────────────────────────────

function SubmitPlaceModal({ myPos, onClose }: { myPos: { lat: number; lng: number } | null; onClose: () => void }) {
  const t = useI18n();
  const [form, setForm] = React.useState<SubmitPlacePayload>({
    name: "", placeType: "establishment",
    lat: myPos?.lat, lng: myPos?.lng,
  });
  const [loading, setLoading] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  const set = (k: keyof SubmitPlacePayload, v: string | number | undefined) =>
    setForm(f => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.name.trim()) { setErr(t.booking.errorNameRequired); return; }
    if (form.lat !== undefined && form.lng !== undefined) {
      if (form.lat < -90 || form.lat > 90 || form.lng < -180 || form.lng > 180) {
        setErr(t.booking.errorInvalidCoordinates); return;
      }
    }
    setLoading(true); setErr(null);
    try {
      await submitNearbyPlace(form);
      setDone(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t.booking.errorFailedToSubmit);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[2000] flex items-end justify-center" onClick={onClose}>
      <div className="fixed inset-0 bg-black/60" />
      <div
        className="relative w-full max-w-lg bg-pnp-background border-t border-pnp-border rounded-t-2xl p-5 pb-8 animate-slide-up"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t.booking.addAPlace}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-pnp-textPrimary">{t.booking.addAPlace}</h2>
          <button onClick={onClose} className="text-pnp-textSecondary hover:text-pnp-textPrimary min-h-[44px] min-w-[44px] flex items-center justify-center" aria-label={t.booking.close}>
            <IcoX className="w-5 h-5" />
          </button>
        </div>
        {done ? (
          <div className="text-center py-6">
            <div className="text-3xl mb-3">📍</div>
            <p className="text-pnp-textPrimary font-semibold mb-1">{t.booking.submitThanksTitle}</p>
            <p className="text-sm text-pnp-textSecondary mb-4">{t.booking.submitThanksBody}</p>
            <button onClick={onClose} className="px-4 py-2 rounded-lg bg-pnp-accent text-white text-sm">{t.booking.close}</button>
          </div>
        ) : (
          <div className="space-y-3">
            <input placeholder={t.booking.placeName} value={form.name} onChange={e => set("name", e.target.value)}
              style={{ fontSize: "16px" }}
              className="w-full px-3 py-2.5 rounded-lg bg-pnp-surface border border-pnp-border text-pnp-textPrimary placeholder:text-pnp-textSecondary focus:outline-none focus:border-pnp-accent" />
            <select value={form.categoryId ?? ""} onChange={e => set("categoryId", e.target.value ? Number(e.target.value) : undefined)}
              style={{ fontSize: "16px" }}
              className="w-full px-3 py-2.5 rounded-lg bg-pnp-surface border border-pnp-border text-pnp-textPrimary focus:outline-none focus:border-pnp-accent">
              <option value="">{t.booking.selectCategory}</option>
              {PLACE_CATEGORIES_IDS.map(c => (
                <option key={c.id} value={c.id}>{c.emoji} {t.booking[c.key]}</option>
              ))}
            </select>
            <input placeholder={t.booking.address} value={form.address ?? ""} onChange={e => set("address", e.target.value)}
              style={{ fontSize: "16px" }}
              className="w-full px-3 py-2.5 rounded-lg bg-pnp-surface border border-pnp-border text-pnp-textPrimary placeholder:text-pnp-textSecondary focus:outline-none focus:border-pnp-accent" />
            <div className="flex gap-2">
              <input placeholder={t.booking.city} value={form.city ?? ""} onChange={e => set("city", e.target.value)}
                style={{ fontSize: "16px" }}
                className="flex-1 min-w-0 px-3 py-2.5 rounded-lg bg-pnp-surface border border-pnp-border text-pnp-textPrimary placeholder:text-pnp-textSecondary focus:outline-none focus:border-pnp-accent" />
              <input placeholder={t.booking.country} value={form.country ?? ""} onChange={e => set("country", e.target.value)}
                style={{ fontSize: "16px" }}
                className="flex-1 min-w-0 px-3 py-2.5 rounded-lg bg-pnp-surface border border-pnp-border text-pnp-textPrimary placeholder:text-pnp-textSecondary focus:outline-none focus:border-pnp-accent" />
            </div>
            <textarea placeholder={t.booking.descriptionOptional} value={form.description ?? ""} onChange={e => set("description", e.target.value)}
              rows={2} style={{ fontSize: "16px" }} className="w-full px-3 py-2.5 rounded-lg bg-pnp-surface border border-pnp-border text-pnp-textPrimary placeholder:text-pnp-textSecondary focus:outline-none focus:border-pnp-accent resize-none" />
            <div className="flex gap-2">
              <input placeholder={t.booking.instagramOptional} value={form.instagram ?? ""} onChange={e => set("instagram", e.target.value)}
                style={{ fontSize: "16px" }}
                className="flex-1 min-w-0 px-3 py-2.5 rounded-lg bg-pnp-surface border border-pnp-border text-pnp-textPrimary placeholder:text-pnp-textSecondary focus:outline-none focus:border-pnp-accent" />
              <input placeholder={t.booking.websiteOptional} value={form.website ?? ""} onChange={e => set("website", e.target.value)}
                style={{ fontSize: "16px" }}
                className="flex-1 min-w-0 px-3 py-2.5 rounded-lg bg-pnp-surface border border-pnp-border text-pnp-textPrimary placeholder:text-pnp-textSecondary focus:outline-none focus:border-pnp-accent" />
            </div>
            {err && <p className="text-xs text-red-400">{err}</p>}
            <button onClick={submit} disabled={loading}
              className="w-full min-h-[44px] py-2.5 rounded-xl bg-pnp-accent text-white text-sm font-semibold hover:bg-pnp-accentHover disabled:opacity-40 transition-colors">
              {loading ? t.booking.submitting : t.booking.submitForReview}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Safety Banner ────────────────────────────────────────────────────────────

function SafetyBanner({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div
      className="mx-3 mt-2 mb-0 rounded-xl border border-white/10 flex items-start gap-3 px-3 py-2.5"
      style={{ background: "rgba(28,28,30,0.85)", backdropFilter: "blur(12px)" }}
      role="note"
      aria-label="Safety reminder"
    >
      <IcoShield className="w-4 h-4 text-pnp-accent flex-shrink-0 mt-0.5" />
      <p className="text-[11px] text-pnp-textSecondary leading-relaxed flex-1 min-w-0">
        Meeting someone? Share your plans with a trusted friend before you go.
      </p>
      <button
        onClick={onDismiss}
        className="flex-shrink-0 text-pnp-textSecondary/50 hover:text-pnp-textSecondary transition-colors min-h-[28px] min-w-[28px] flex items-center justify-center"
        aria-label="Dismiss safety banner"
      >
        <IcoX className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ─── Grid Skeleton ────────────────────────────────────────────────────────────

function GridSkeleton() {
  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-0.5 px-0">
      {Array.from({ length: 12 }).map((_, i) => (
        <div key={i} className="aspect-square rounded-lg bg-pnp-surface animate-pulse" />
      ))}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function Nearby() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  useAuth(); // ensure auth context is mounted (tier-gating handled by route guards)
  const t = useI18n();
  const { showTutorial, dismissTutorial, dismissForever } = useTutorial("nearby");

  // ── Mode & Page state ──────────────────────────────────────────────────────
  const [mode, setMode] = useState<Mode>(() => {
    const p = searchParams.get("mode");
    if (p === "calls" || p === "online") return p;
    return "realworld";
  });
  const [pageState, setPageState] = useState<PageState>("loading");
  const [selectedPerformer, setSelectedPerformer] = useState<FeaturedPerformer | null>(null);
  const [callsOnlineOnly, setCallsOnlineOnly] = useState(false);
  const [allPerformers, setAllPerformers] = useState<FeaturedPerformer[]>([]);

  // ── Location ───────────────────────────────────────────────────────────────
  const [locationStatus, setLocationStatus] = useState<"online" | "offline">("offline");
  const [lastPosSavedAt, setLastPosSavedAt] = useState<number | null>(null);
  const [myPos, setMyPos] = useState<{ lat: number; lng: number } | null>(() => {
    try {
      const cached = localStorage.getItem(LAST_POS_KEY);
      if (cached) {
        const { lat, lng } = JSON.parse(cached);
        if (typeof lat === "number" && typeof lng === "number") return { lat, lng };
      }
    } catch { /* ignore */ }
    return null;
  });

  // ── Real World state ───────────────────────────────────────────────────────
  const [nearbyUsers, setNearbyUsers] = useState<NearbyUser[]>([]);
  const [nearbyPlaces, setNearbyPlaces] = useState<NearbyPlace[]>([]);
  const [nearbyCount, setNearbyCount] = useState(0);
  const [radius, setRadius] = useState<RadiusKm>(DEFAULT_RADIUS);
  const radiusRef = useRef(radius);
  radiusRef.current = radius;
  const [incognito, setIncognito] = useState(false);
  const [placeCategory, setPlaceCategory] = useState<string | null>(null);
  const [showSafetyBanner, setShowSafetyBanner] = useState(() => {
    try { return !localStorage.getItem(SAFETY_BANNER_KEY); } catch { return true; }
  });

  // ── Online state ───────────────────────────────────────────────────────────
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([]);
  const [onlineRegion, setOnlineRegion] = useState<string>("");
  const [onlineRegions, setOnlineRegions] = useState<string[]>([]);

  // ── Shared UI state ────────────────────────────────────────────────────────
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedUser, setSelectedUser] = useState<NearbyUser | null>(null);
  const [selectedOnlineUser, setSelectedOnlineUser] = useState<OnlineUser | null>(null);
  const [selectedPlace, setSelectedPlace] = useState<NearbyPlace | null>(null);
  const [submitPlaceOpen, setSubmitPlaceOpen] = useState(false);
  const [favoritedPlaces, setFavoritedPlaces] = useState<Set<number>>(() => {
    try {
      const cached = localStorage.getItem(FAV_PLACES_KEY);
      return cached ? new Set(JSON.parse(cached)) : new Set();
    } catch { return new Set(); }
  });

  // ── Explore: Channels & Performers ─────────────────────────────────────────
  const [exploreChannels, setExploreChannels] = useState<CreatorChannel[]>([]);
  const [explorePerformers, setExplorePerformers] = useState<FeaturedPerformer[]>([]);
  const [performerVideos, setPerformerVideos] = useState<Record<string, SocialPostItem[]>>({});

  const watchIdRef = useRef<number | null>(null);
  const refreshRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastSentRef = useRef<{ lat: number; lng: number; at: number } | null>(null);

  // ── Derived data ───────────────────────────────────────────────────────────
  const filteredPlaces = placeCategory
    ? nearbyPlaces.filter((p) => p.categorySlug === placeCategory)
    : nearbyPlaces;

  const filteredOnlineUsers = onlineRegion
    ? onlineUsers.filter((u) => u.country === onlineRegion || u.city === onlineRegion)
    : onlineUsers;

  // ── Favorites ──────────────────────────────────────────────────────────────
  const handleToggleFavorite = useCallback((placeId: number) => {
    setFavoritedPlaces((prev) => {
      const next = new Set(prev);
      if (next.has(placeId)) next.delete(placeId);
      else next.add(placeId);
      try { localStorage.setItem(FAV_PLACES_KEY, JSON.stringify([...next])); } catch {}
      return next;
    });
    favoritePlaceToggle(placeId).catch(() => {});
  }, []);

  // Track view when place detail opens
  useEffect(() => {
    if (selectedPlace) trackPlaceView(selectedPlace.id).catch(() => {});
  }, [selectedPlace]);

  // ── Fetch nearby (Real World) ─────────────────────────────────────────────
  const fetchNearby = useCallback(async (lat: number, lng: number, rad: number) => {
    try {
      setIsSearching(true);
      const [usersData, placesData] = await Promise.allSettled([
        searchNearby(lat, lng, rad, 60),
        searchNearbyPlaces(lat, lng, rad),
      ]);
      if (usersData.status === "fulfilled") {
        const result = usersData.value as NearbySearchResponse & { tier?: string; count?: number };
        if (result.tier === "free" && typeof result.count === "number") {
          setNearbyCount(result.count);
          setNearbyUsers([]);
        } else {
          setNearbyUsers(result.users || []);
          setNearbyCount(result.users?.length ?? 0);
        }
      }
      if (placesData.status === "fulfilled") {
        const places = placesData.value.places || [];
        if (places.length > 0) {
          setNearbyPlaces(places);
        } else {
          getFallbackNearbyPlaces(lat, lng).then(fb => {
            setNearbyPlaces(fb.places || []);
          }).catch(() => {});
        }
      }
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setIsSearching(false);
    }
  }, []);

  // ── Fetch online users ────────────────────────────────────────────────────
  const fetchOnline = useCallback(async (region?: string) => {
    try {
      setIsSearching(true);
      const data = await getOnlineUsers(region || undefined, 100);
      setOnlineUsers(data.users || []);
      // Extract unique regions (countries) from response for filter dropdown
      const regions = Array.from(
        new Set((data.users || []).map((u) => u.country).filter((c): c is string => !!c))
      ).sort();
      setOnlineRegions(regions);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load online users");
    } finally {
      setIsSearching(false);
    }
  }, []);

  // ── Send my location to backend ───────────────────────────────────────────
  const sendLocation = useCallback(async (lat: number, lng: number, accuracy: number) => {
    if (incognito) return;
    const now = Date.now();
    const last = lastSentRef.current;
    if (last) {
      const elapsed = now - last.at;
      const dlat = (lat - last.lat) * 111_000;
      const dlng = (lng - last.lng) * 111_000 * Math.cos(lat * Math.PI / 180);
      const movedMeters = Math.sqrt(dlat * dlat + dlng * dlng);
      if (elapsed < MIN_LOCATION_SEND_MS && movedMeters < MIN_MOVEMENT_METERS) return;
    }
    lastSentRef.current = { lat, lng, at: now };
    try {
      await updateNearbyLocation(lat, lng, accuracy);
    } catch { /* silent */ }
  }, [incognito]);

  // ── Load favorites from server on mount ───────────────────────────────────
  useEffect(() => {
    getPlaceFavorites().then((data) => {
      if (data.placeIds?.length) {
        setFavoritedPlaces(new Set(data.placeIds));
        try { localStorage.setItem(FAV_PLACES_KEY, JSON.stringify(data.placeIds)); } catch {}
      }
    }).catch(() => {});
  }, []);

  // ── Restore cached position ───────────────────────────────────────────────
  useEffect(() => {
    try {
      const cached = localStorage.getItem(LAST_POS_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (typeof parsed.lat === "number" && typeof parsed.lng === "number") {
          setPageState("ready");
          setLocationStatus("offline");
          setLastPosSavedAt(parsed.savedAt || null);
        }
      }
    } catch { /* ignore */ }
  }, []);

  // ── Geolocation watch ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!navigator.geolocation) { setPageState("denied"); return; }
    setPageState("loading");

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        const now = Date.now();
        setMyPos({ lat: latitude, lng: longitude });
        setPageState("ready");
        setLocationStatus("online");
        setLastPosSavedAt(now);
        try {
          localStorage.setItem(LAST_POS_KEY, JSON.stringify({ lat: latitude, lng: longitude, savedAt: now }));
        } catch { /* ignore */ }
        sendLocation(latitude, longitude, accuracy);
        fetchNearby(latitude, longitude, radiusRef.current);
      },
      () => {
        setMyPos((prev) => {
          if (!prev) setPageState("denied");
          return prev;
        });
        setLocationStatus("offline");
      },
      { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 }
    );

    return () => {
      if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
    };
  }, [sendLocation, fetchNearby]);

  // ── Auto-refresh: Real World ──────────────────────────────────────────────
  useEffect(() => {
    if (mode !== "realworld" || !myPos || pageState !== "ready") return;

    const doRefresh = () => {
      fetchNearby(myPos.lat, myPos.lng, radius);
      if (!incognito) sendLocation(myPos.lat, myPos.lng, 50);
    };

    const startInterval = () => {
      if (refreshRef.current) clearInterval(refreshRef.current);
      refreshRef.current = setInterval(doRefresh, REALWORLD_REFRESH_INTERVAL);
    };

    const onVisChange = () => {
      if (document.visibilityState === "visible") { doRefresh(); startInterval(); }
      else { if (refreshRef.current) { clearInterval(refreshRef.current); refreshRef.current = null; } }
    };

    startInterval();
    document.addEventListener("visibilitychange", onVisChange);
    return () => {
      if (refreshRef.current) clearInterval(refreshRef.current);
      document.removeEventListener("visibilitychange", onVisChange);
    };
  }, [mode, myPos, radius, incognito, pageState, fetchNearby, sendLocation]);

  // ── Auto-refresh: Online ──────────────────────────────────────────────────
  useEffect(() => {
    if (mode !== "online") return;

    fetchOnline(onlineRegion || undefined);

    const interval = setInterval(() => {
      if (document.visibilityState === "visible") fetchOnline(onlineRegion || undefined);
    }, ONLINE_REFRESH_INTERVAL);

    return () => clearInterval(interval);
  }, [mode, onlineRegion, fetchOnline]);

  // ── Socket.IO: Real World grid room ──────────────────────────────────────
  useEffect(() => {
    if (!myPos || mode !== "realworld") return;
    const socket = connectSocket();
    socket.emit("nearby:join-grid", { lat: myPos.lat, lng: myPos.lng });

    let debounce: ReturnType<typeof setTimeout> | null = null;
    const handler = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        if (document.visibilityState === "visible" && myPos)
          fetchNearby(myPos.lat, myPos.lng, radius);
      }, 2000);
    };

    socket.on("nearby:location-updated", handler);
    return () => {
      socket.off("nearby:location-updated", handler);
      if (debounce) clearTimeout(debounce);
      socket.emit("nearby:leave");
    };
  }, [myPos, radius, fetchNearby, mode]);

  // ── Fetch Explore: Channels & Performers (once on mount) ────────────────
  useEffect(() => {
    browseCreatorChannels({ limit: 12 })
      .then((res) => { if (res.success) setExploreChannels(res.channels); })
      .catch(() => {});
    getAllPerformers()
      .then((res) => {
        if (res.success) {
          setAllPerformers(res.performers);
          setExplorePerformers(res.performers.slice(0, 12));
        }
      })
      .catch(() => {});
  }, []);

  // Fetch recent videos for each performer once they're loaded
  useEffect(() => {
    if (explorePerformers.length === 0) return;
    explorePerformers.forEach((p) => {
      const uid = p.userId || p.id;
      if (!uid) return;
      getPublicProfile(uid, undefined, 6)
        .then((res) => {
          if (!res.success) return;
          const videos = res.posts.filter(
            (post) => post.media_type === "video" && (post.video_thumbnail_url || post.media_url)
          );
          if (videos.length > 0) {
            setPerformerVideos((prev) => ({ ...prev, [uid]: videos.slice(0, 3) }));
          }
        })
        .catch(() => {});
    });
  }, [explorePerformers]);

  // ── Mode switch ───────────────────────────────────────────────────────────
  const handleModeSwitch = (newMode: Mode) => {
    setMode(newMode);
    setSelectedUser(null);
    setSelectedOnlineUser(null);
    setSelectedPlace(null);
    setError(null);
  };

  // ── Block handler (removes user from grid) ────────────────────────────────
  const handleBlock = useCallback((userId: string) => {
    setNearbyUsers((prev) => prev.filter((u) => String(u.user_id) !== userId));
    setOnlineUsers((prev) => prev.filter((u) => u.user_id !== userId));
  }, []);

  const handleNavigate = useCallback((path: string) => navigate(path), [navigate]);

  // ─── Loading state ─────────────────────────────────────────────────────────
  if (pageState === "loading" && !myPos && mode === "realworld") {
    return (
      <div className="page-container flex flex-col items-center justify-center min-h-[60vh]">
        <div className="relative w-20 h-20 mb-6">
          <div className="absolute inset-0 border-2 border-pnp-accent/30 rounded-full animate-ping" />
          <div className="absolute inset-2 border-2 border-pnp-accent/50 rounded-full animate-ping" style={{ animationDelay: "0.3s" }} />
          <div className="absolute inset-4 border-2 border-pnp-accent rounded-full animate-pulse" />
          <IcoMapPin className="absolute inset-0 w-20 h-20 text-pnp-accent p-5" />
        </div>
        <p className="text-pnp-textPrimary font-medium">{t.booking.findingLocation}</p>
        <p className="text-sm text-pnp-textSecondary mt-1 text-center px-8">{t.booking.grantLocationAccess}</p>
      </div>
    );
  }

  // ─── Permission denied ─────────────────────────────────────────────────────
  if (pageState === "denied" && mode === "realworld") {
    return (
      <div className="page-container flex flex-col items-center justify-center min-h-[60vh] px-6">
        <IcoAlert className="w-16 h-16 text-pnp-textSecondary mb-4" />
        <p className="text-pnp-textPrimary font-medium text-lg mb-2 text-center">{t.booking.locationAccessNeeded}</p>
        <p className="text-sm text-pnp-textSecondary text-center max-w-xs mb-6">{t.booking.locationAccessBody}</p>
        <Button variant="primary" onClick={() => {
          setPageState("loading");
          navigator.geolocation.getCurrentPosition(
            (pos) => { setMyPos({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setPageState("ready"); },
            () => setPageState("denied"),
            { enableHighAccuracy: true }
          );
        }}>
          {t.booking.tryAgain}
        </Button>
      </div>
    );
  }

  // ─── Main render ───────────────────────────────────────────────────────────
  return (
    <div className="page-container !p-0 flex flex-col min-h-full" style={{ background: "var(--pnp-background)" }}>
      <Helmet>
        <title>{t.booking.pageTitle}</title>
        <meta name="description" content={t.booking.pageDescription} />
      </Helmet>

      {/* Inline animation keyframes */}
      <style>{`
        @keyframes slide-up { from { transform: translateY(100%); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        .animate-slide-up { animation: slide-up 0.25s ease-out; }
      `}</style>

      {showTutorial && (
        <TutorialOverlay section="nearby" onDismiss={dismissTutorial} onDismissForever={dismissForever} />
      )}

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 px-3 pt-3 pb-0">
        {/* Title row */}
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="text-2xl font-bold text-pnp-textPrimary">{t.booking.nearby}</h1>
            <p className="text-sm mt-1 text-pnp-textSecondary">{t.booking.nearbySubtitle}</p>
          </div>
          <div className="flex items-center gap-2">
            {/* Location status */}
            {mode === "realworld" && (
              locationStatus === "online" ? (
                <div className="flex items-center gap-1 bg-green-500/20 border border-green-500/30 rounded-full px-2 py-0.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                  <span className="text-[10px] text-green-400 font-medium">{t.booking.locationOnline}</span>
                </div>
              ) : myPos ? (
                <div className="flex items-center gap-1 bg-pnp-surface/80 border border-white/10 rounded-full px-2 py-0.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-gray-400" />
                  <span className="text-[10px] text-pnp-textSecondary font-medium">
                    {lastPosSavedAt
                      ? `${t.booking.locationLastSeen} ${t.booking.minutesAgo(Math.round((Date.now() - lastPosSavedAt) / 60000))}`
                      : t.booking.locationLastKnown}
                  </span>
                </div>
              ) : null
            )}

            {/* Incognito toggle — Real World only */}
            {mode === "realworld" && (
              <button
                onClick={() => setIncognito(!incognito)}
                className={`min-h-[36px] min-w-[36px] rounded-xl flex items-center justify-center border transition-all ${
                  incognito
                    ? "border-pnp-accent/40 text-white"
                    : "bg-pnp-surface border-white/10 text-pnp-textSecondary hover:text-pnp-textPrimary"
                }`}
                style={incognito ? { background: "rgba(212,0,122,0.15)" } : undefined}
                aria-label={incognito ? t.booking.incognitoOn : t.booking.incognitoOff}
                aria-pressed={incognito}
              >
                {incognito ? <IcoEyeOff className="w-4 h-4" /> : <IcoEye className="w-4 h-4" />}
              </button>
            )}

            {/* Searching spinner */}
            {isSearching && (
              <IcoSpinner className="w-3.5 h-3.5 text-pnp-accent animate-spin" />
            )}
          </div>
        </div>

        {/* Mode toggle: pill segmented control */}
        <div className="flex rounded-xl p-0.5 mb-3" style={{ background: "rgba(255,255,255,0.05)" }}>
          <button
            onClick={() => handleModeSwitch("realworld")}
            className={`flex-1 min-h-[36px] rounded-[10px] flex items-center justify-center gap-1.5 text-sm font-semibold transition-all ${
              mode === "realworld" ? "text-white shadow-sm" : "text-pnp-textSecondary hover:text-pnp-textPrimary"
            }`}
            style={mode === "realworld" ? { background: "linear-gradient(135deg, #D4007A, #E69138)" } : undefined}
            aria-pressed={mode === "realworld"}
          >
            <IcoMapPin className="w-3.5 h-3.5" />
            Nearby
          </button>
          <button
            onClick={() => handleModeSwitch("online")}
            className={`flex-1 min-h-[36px] rounded-[10px] flex items-center justify-center gap-1.5 text-sm font-semibold transition-all ${
              mode === "online" ? "text-white shadow-sm" : "text-pnp-textSecondary hover:text-pnp-textPrimary"
            }`}
            style={mode === "online" ? { background: "linear-gradient(135deg, #D4007A, #E69138)" } : undefined}
            aria-pressed={mode === "online"}
          >
            <IcoGlobe className="w-3.5 h-3.5" />
            Online
          </button>
          <button
            onClick={() => handleModeSwitch("calls")}
            className={`flex-1 min-h-[36px] rounded-[10px] flex items-center justify-center gap-1.5 text-sm font-semibold transition-all ${
              mode === "calls" ? "text-white shadow-sm" : "text-pnp-textSecondary hover:text-pnp-textPrimary"
            }`}
            style={mode === "calls" ? { background: "linear-gradient(135deg, #7B61FF, #D4007A)" } : undefined}
            aria-pressed={mode === "calls"}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
            </svg>
            Calls
          </button>
        </div>

        {/* Filter row */}
        {mode === "calls" ? (
          /* Calls mode — online-only toggle */
          <div className="flex gap-2 mb-1">
            <button
              onClick={() => setCallsOnlineOnly(false)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${!callsOnlineOnly ? "text-white border-transparent" : "text-pnp-textSecondary border-white/10 hover:text-pnp-textPrimary"}`}
              style={!callsOnlineOnly ? { background: "linear-gradient(135deg,#7B61FF,#D4007A)" } : { background: "rgba(255,255,255,0.05)" }}
            >
              All Models
            </button>
            <button
              onClick={() => setCallsOnlineOnly(true)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${callsOnlineOnly ? "text-white border-transparent" : "text-pnp-textSecondary border-white/10 hover:text-pnp-textPrimary"}`}
              style={callsOnlineOnly ? { background: "linear-gradient(135deg,#7B61FF,#D4007A)" } : { background: "rgba(255,255,255,0.05)" }}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />
              Online Now
            </button>
          </div>
        ) : mode === "realworld" ? (
          /* Radius chips */
          <div className="flex gap-1.5 mb-1 overflow-x-auto pb-0.5" style={{ scrollbarWidth: "none" }}>
            {RADIUS_OPTIONS_KM.map((r) => (
              <button
                key={r}
                onClick={() => {
                  setRadius(r);
                  if (myPos) fetchNearby(myPos.lat, myPos.lng, r);
                }}
                className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                  radius === r
                    ? "text-white border-transparent"
                    : "text-pnp-textSecondary border-white/10 hover:text-pnp-textPrimary hover:border-white/20"
                }`}
                style={radius === r ? { background: "linear-gradient(135deg, #D4007A, #E69138)" } : { background: "rgba(255,255,255,0.05)" }}
                aria-pressed={radius === r}
              >
                {KM_TO_MI_LABEL[r]}
              </button>
            ))}
          </div>
        ) : (
          /* Region dropdown */
          <div className="mb-1">
            <div className="relative">
              <select
                value={onlineRegion}
                onChange={(e) => setOnlineRegion(e.target.value)}
                className="w-full pl-3 pr-8 py-2 rounded-xl text-pnp-textPrimary border border-white/10 appearance-none focus:outline-none focus:border-pnp-accent transition-colors"
                style={{ background: "rgba(255,255,255,0.05)", fontSize: "16px" }}
                aria-label="Filter by region"
              >
                <option value="">All regions ({onlineUsers.length} online)</option>
                {onlineRegions.map((r) => (
                  <option key={r} value={r}>
                    {r} ({onlineUsers.filter((u) => u.country === r || u.city === r).length})
                  </option>
                ))}
              </select>
              <IcoChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-pnp-textSecondary pointer-events-none" />
            </div>
          </div>
        )}
      </div>

      {/* ── Safety banner (Real World only) ─────────────────────────────────── */}
      {mode === "realworld" && showSafetyBanner && (
        <SafetyBanner onDismiss={() => {
          setShowSafetyBanner(false);
          try { localStorage.setItem(SAFETY_BANNER_KEY, "1"); } catch {}
        }} />
      )}

      {/* ── Scrollable content area ──────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto pb-4">

        {/* ── Error state ────────────────────────────────────────────────────── */}
        {error && (
          <div className="mx-3 mt-3 flex items-start gap-3 px-3 py-2.5 rounded-xl border border-red-500/20 bg-red-900/30" role="alert">
            <IcoAlert className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-red-300 leading-relaxed">{error}</p>
            </div>
            <button
              onClick={() => {
                setError(null);
                if (mode === "realworld" && myPos) fetchNearby(myPos.lat, myPos.lng, radius);
                else if (mode === "online") fetchOnline(onlineRegion || undefined);
                else if (mode === "calls") getAllPerformers().then((r) => { if (r.success) { setAllPerformers(r.performers); setExplorePerformers(r.performers.slice(0, 12)); } }).catch(() => {});
              }}
              className="flex-shrink-0 text-xs text-red-400 font-medium underline hover:text-red-300 transition-colors"
            >
              Retry
            </button>
          </div>
        )}

        {/* ── Real World mode ─────────────────────────────────────────────────── */}
        {mode === "realworld" && (
          <>
            {/* Merged users + places grid, sorted by distance */}
            <div className="mt-3 px-3">
              {isSearching && nearbyUsers.length === 0 ? (
                <GridSkeleton />
              ) : nearbyUsers.length === 0 && filteredPlaces.length === 0 && !isSearching ? (
                /* Empty state */
                <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
                  <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4"
                    style={{ background: "rgba(212,0,122,0.1)" }}>
                    <IcoMap className="w-8 h-8 text-pnp-accent" />
                  </div>
                  <p className="text-pnp-textPrimary font-semibold mb-1">
                    {nearbyCount > 0
                      ? `${nearbyCount} ${nearbyCount === 1 ? t.booking.personSingular : t.booking.personPlural} ${t.booking.nearYou}`
                      : t.booking.nobodyNearbyYet}
                  </p>
                  <p className="text-sm text-pnp-textSecondary">
                    {nearbyCount > 0
                      ? t.booking.freeUpgradeBody
                      : t.booking.nobodyNearbyHint}
                  </p>
                </div>
              ) : (
                <>
                  {/* Category chips for place filtering */}
                  {nearbyPlaces.length > 0 && (
                    <div className="flex gap-1.5 mb-2.5 overflow-x-auto pb-0.5" style={{ scrollbarWidth: "none" }}>
                      {PLACE_CATEGORY_CHIPS.map((chip) => (
                        <button
                          key={chip.slug ?? "all"}
                          onClick={() => setPlaceCategory(chip.slug)}
                          className={`flex-shrink-0 px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors whitespace-nowrap ${
                            placeCategory === chip.slug
                              ? "bg-amber-500/20 border-amber-500/50 text-amber-400"
                              : "border-white/10 text-pnp-textSecondary hover:text-pnp-textPrimary"
                          }`}
                          style={placeCategory !== chip.slug ? { background: "rgba(255,255,255,0.05)" } : undefined}
                          aria-pressed={placeCategory === chip.slug}
                        >
                          {chip.emoji} {chip.label}
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-0.5">
                    {/* Merge users + places into one sorted array by distance */}
                    {(() => {
                      const userItems = nearbyUsers.map((u) => ({ kind: "user" as const, distKm: u.distance_km ?? 9999, data: u }));
                      const placeItems = filteredPlaces.map((p) => ({ kind: "place" as const, distKm: p.distance ?? 9999, data: p }));
                      const merged = [...userItems, ...placeItems].sort((a, b) => a.distKm - b.distKm);

                      return merged.map((item) => {
                        if (item.kind === "user") {
                          const u = item.data;
                          const name = u.name || u.username || `User #${u.user_id}`;
                          const isOnline = u.status !== "offline";
                          return (
                            <UserCard
                              key={`u-${u.user_id}`}
                              name={name}
                              photoUrl={u.photo_url}
                              label={formatUserDistMi(u)}
                              labelColor={isOnline ? "#FFB454" : "#555"}
                              isOnline={isOnline}
                              onClick={() => { setSelectedUser(u); setSelectedOnlineUser(null); setSelectedPlace(null); }}
                            />
                          );
                        }
                        const p = item.data;
                        const distMi = p.distance ? (p.distance * 0.621371) : null;
                        const distLabel = distMi != null ? (distMi < 0.1 ? `${Math.round((p.distance || 0) * 1000)}m` : `${distMi.toFixed(1)} mi`) : "";
                        return (
                          <button
                            key={`p-${p.id}`}
                            onClick={() => { setSelectedPlace(p); setSelectedUser(null); setSelectedOnlineUser(null); }}
                            className="flex flex-col items-center text-center p-1 rounded-xl transition-all active:scale-[0.95]"
                            style={{ background: "rgba(255,255,255,0.03)" }}
                          >
                            <div className="relative w-full aspect-square rounded-lg overflow-hidden mb-1">
                              {isValidPhotoUrl(p.photoUrl) ? (
                                <img src={p.photoUrl} alt={p.name} className="w-full h-full object-cover" loading="lazy" />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center" style={{ background: "linear-gradient(135deg, #1a3a2a, #2a4a3a)" }}>
                                  <span className="text-lg">{p.categoryEmoji || "📍"}</span>
                                </div>
                              )}
                              <span className="absolute top-1 left-1 px-1 py-0.5 rounded text-[8px] font-bold text-white bg-amber-600/90">
                                PLACE
                              </span>
                            </div>
                            <p className="text-[11px] font-medium text-pnp-textPrimary leading-tight truncate w-full">{p.name}</p>
                            {distLabel && <p className="text-[9px] text-amber-400 font-medium">{distLabel}</p>}
                          </button>
                        );
                      });
                    })()}
                  </div>

                  {/* Suggest a place button */}
                  <button
                    onClick={() => setSubmitPlaceOpen(true)}
                    className="w-full mt-3 py-3 rounded-xl border border-dashed border-white/15 flex items-center justify-center gap-2 hover:border-pnp-accent/40 hover:bg-pnp-accent/5 transition-all text-pnp-textSecondary hover:text-pnp-textPrimary active:scale-[0.98]"
                  >
                    <IcoPlus className="w-4 h-4 text-pnp-accent" />
                    <span className="text-xs font-medium">Know a PNP-friendly place? Add it</span>
                  </button>
                </>
              )}
            </div>
          </>
        )}

        {/* ── Online mode ─────────────────────────────────────────────────────── */}
        {mode === "online" && (
          <div className="mt-3 px-3">
            {isSearching && onlineUsers.length === 0 ? (
              <GridSkeleton />
            ) : filteredOnlineUsers.length === 0 && !isSearching ? (
              <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
                <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4"
                  style={{ background: "rgba(212,0,122,0.1)" }}>
                  <IcoGlobe className="w-8 h-8 text-pnp-accent" />
                </div>
                <p className="text-pnp-textPrimary font-semibold mb-1">Nobody online right now</p>
                <p className="text-sm text-pnp-textSecondary">
                  {onlineRegion ? "Try selecting a different region." : "Check back soon — the community is always active."}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-0.5">
                {filteredOnlineUsers.map((u) => {
                  const name = u.name || u.username || "User";
                  return (
                    <UserCard
                      key={u.user_id}
                      name={name}
                      photoUrl={u.photo_url}
                      label={formatOnlineTime(u.last_active)}
                      labelColor="#8E8E93"
                      isOnline={u.is_online}
                      onClick={() => { setSelectedOnlineUser(u); setSelectedUser(null); setSelectedPlace(null); }}
                    />
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Private Calls mode ──────────────────────────────────────────────── */}
        {mode === "calls" && (() => {
          const filtered = callsOnlineOnly
            ? allPerformers.filter((p) => p.isOnline)
            : allPerformers;
          return (
            <div className="mt-3 px-3">
              {filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
                  <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4"
                    style={{ background: "rgba(123,97,255,0.1)" }}>
                    <svg className="w-8 h-8" style={{ color: "#7B61FF" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                    </svg>
                  </div>
                  <p className="text-pnp-textPrimary font-semibold mb-1">
                    {callsOnlineOnly ? "No models online right now" : "No models available"}
                  </p>
                  <p className="text-sm text-pnp-textSecondary">
                    {callsOnlineOnly ? "Check back soon or browse all models." : "Check back later — models update their availability."}
                  </p>
                  {callsOnlineOnly && (
                    <button onClick={() => setCallsOnlineOnly(false)} className="mt-4 text-sm font-semibold px-4 py-2 rounded-full" style={{ background: "rgba(123,97,255,.15)", color: "#7B61FF" }}>
                      Show all models
                    </button>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {filtered.map((p) => {
                    const name = p.displayName || p.name || "Model";
                    const userId = p.userId || p.id;
                    return (
                      <div key={p.id} className="rounded-[18px] border overflow-hidden flex flex-col"
                        style={{ background: "rgba(18,18,28,.9)", borderColor: p.isOnline ? "rgba(34,197,94,.3)" : "rgba(255,255,255,.08)" }}>
                        {/* Photo */}
                        <button onClick={() => navigate(`/profile/${userId}`)} className="relative aspect-[3/4] w-full block overflow-hidden">
                          {p.photoUrl ? (
                            <img src={p.photoUrl} alt={name} className="w-full h-full object-cover" loading="lazy" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-3xl font-black"
                              style={{ background: "linear-gradient(135deg,#2C1654,#4A1932)" }}>
                              {name[0].toUpperCase()}
                            </div>
                          )}
                          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent pointer-events-none" />
                          {/* Online badge — FIX HIGH-08: only show when online AND accepting calls */}
                          {p.isOnline && p.isAcceptingCalls && (
                            <span className="absolute top-2 left-2 flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black"
                              style={{ background: "rgba(34,197,94,.9)", color: "#fff" }}>
                              <span className="w-1.5 h-1.5 rounded-full bg-white inline-block" />
                              ONLINE
                            </span>
                          )}
                          {p.isLive && (
                            <span className="absolute top-2 right-2 flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black bg-red-600 text-white animate-pulse">
                              LIVE
                            </span>
                          )}
                          {/* Name overlay */}
                          <div className="absolute bottom-0 left-0 right-0 px-2.5 pb-2">
                            <p className="text-white font-bold text-[13px] truncate drop-shadow">{name}</p>
                            {p.basePrice > 0 && (
                              <p className="text-white/70 text-[11px]">from ${p.basePrice}/30min</p>
                            )}
                          </div>
                        </button>
                        {/* Book button — FIX HIGH-08: disabled with tooltip when not accepting calls */}
                        <button
                          onClick={() => p.isAcceptingCalls !== false && setSelectedPerformer(p)}
                          disabled={p.isAcceptingCalls === false}
                          title={p.isAcceptingCalls === false ? "Not accepting calls right now" : undefined}
                          className="w-full py-2.5 text-[12px] font-bold transition-all active:scale-[.97] flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                          style={{ background: p.isAcceptingCalls === false ? "rgba(123,97,255,0.3)" : "linear-gradient(135deg,#7B61FF,#D4007A)", color: "#fff" }}
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                          </svg>
                          {p.isAcceptingCalls === false ? "Unavailable" : "Book a Call"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })()}

        {/* Prime Channels and Performers strips removed — available via Channels tab */}
        {false && exploreChannels.length > 0 && (
          <div className="mt-5 px-3">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-bold text-pnp-textPrimary">Prime Channels</h2>
              <button
                onClick={() => navigate("/channels")}
                className="text-xs text-pnp-accent font-medium hover:underline"
              >
                See all
              </button>
            </div>
            <div className="flex gap-2.5 overflow-x-auto pb-2" style={{ scrollbarWidth: "none" }}>
              {exploreChannels.map((ch) => (
                <button
                  key={ch.id}
                  onClick={() => navigate(`/channels?id=${ch.id}`)}
                  className="flex-shrink-0 w-36 rounded-xl overflow-hidden border border-white/10 text-left active:scale-[0.97] transition-transform focus-visible:ring-2 focus-visible:ring-pnp-accent"
                  style={{ background: "rgba(28,28,30,0.85)" }}
                  aria-label={`View channel ${ch.name}`}
                >
                  <div
                    className="relative h-20 flex items-center justify-center overflow-hidden"
                    style={{ background: "linear-gradient(135deg, #2C1654, #4A1932)" }}
                  >
                    {ch.coverImageUrl ? (
                      <img src={ch.coverImageUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
                    ) : (
                      <span className="text-2xl" aria-hidden="true">📺</span>
                    )}
                    {ch.isPremium && (
                      <span className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded text-[9px] font-bold text-white bg-amber-500/90">
                        PRIME
                      </span>
                    )}
                  </div>
                  <div className="p-2">
                    <p className="text-xs font-semibold text-pnp-textPrimary truncate">{ch.name}</p>
                    <p className="text-[10px] text-pnp-textSecondary truncate mt-0.5">
                      {ch.creatorName || ch.creatorUsername || "Creator"}
                      {ch.postCount > 0 ? ` · ${ch.postCount} posts` : ""}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {false && explorePerformers.length > 0 && (
          <div className="mt-5 px-3">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-bold text-pnp-textPrimary">Performers</h2>
              <button
                onClick={() => navigate("/live")}
                className="text-xs text-pnp-accent font-medium hover:underline"
              >
                See all
              </button>
            </div>
            <div className="flex gap-2.5 overflow-x-auto pb-2" style={{ scrollbarWidth: "none" }}>
              {explorePerformers.map((p) => {
                const uid = p.userId || p.id;
                const videos = performerVideos[uid] || [];
                return (
                  <div
                    key={p.id}
                    className={`flex-shrink-0 w-36 rounded-xl overflow-hidden border text-left ${
                      p.isLive ? "border-red-500/60" : "border-white/10"
                    }`}
                    style={{ background: "rgba(28,28,30,0.85)" }}
                  >
                    {/* Performer photo */}
                    <button
                      onClick={() => p.isLive && p.hlsUrl ? navigate(`/live/${p.live_channel || p.id}`) : navigate(`/profile/${uid}`)}
                      className="w-full active:scale-[0.97] transition-transform focus-visible:ring-2 focus-visible:ring-pnp-accent"
                      aria-label={`View ${p.displayName || p.name}`}
                    >
                      <div
                        className="relative aspect-square flex items-center justify-center overflow-hidden"
                        style={{ background: "linear-gradient(135deg, #2C1654, #4A1932)" }}
                      >
                        {p.photoUrl ? (
                          <img src={p.photoUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
                        ) : (
                          <span className="text-2xl font-bold text-white" aria-hidden="true">
                            {(p.displayName || p.name || "?")[0].toUpperCase()}
                          </span>
                        )}
                        {p.isLive && (
                          <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded text-[9px] font-bold text-white bg-red-600 animate-pulse">
                            LIVE
                          </span>
                        )}
                        {p.isFeatured && !p.isLive && (
                          <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded text-[9px] font-bold text-white bg-purple-600/90">
                            Featured
                          </span>
                        )}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent pointer-events-none" />
                        <span className="absolute bottom-1 left-1.5 text-[10px] font-semibold text-white truncate max-w-[90%] drop-shadow-sm">
                          {p.displayName || p.name}
                        </span>
                      </div>
                    </button>

                    {/* Video thumbnails row */}
                    {videos.length > 0 && (
                      <div className="flex gap-0.5 p-1">
                        {videos.map((v) => (
                          <button
                            key={v.id}
                            onClick={() => navigate(`/profile/${uid}`)}
                            className="relative flex-1 aspect-[4/3] rounded overflow-hidden active:scale-[0.95] transition-transform focus-visible:ring-1 focus-visible:ring-pnp-accent"
                            aria-label={v.video_title || "Video"}
                          >
                            <img
                              src={v.video_thumbnail_url || v.media_url || ""}
                              alt=""
                              className="w-full h-full object-cover"
                              loading="lazy"
                            />
                            {/* Play icon overlay */}
                            <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                              <svg className="w-3.5 h-3.5 text-white/90" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                <path d="M8 5v14l11-7z" />
                              </svg>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ── Modals & sheets ─────────────────────────────────────────────────── */}

      {/* User Quick View */}
      {(selectedUser || selectedOnlineUser) && (
        <UserQuickView
          user={selectedUser}
          onlineUser={selectedOnlineUser}
          onClose={() => { setSelectedUser(null); setSelectedOnlineUser(null); }}
          onNavigate={handleNavigate}
          onBlock={handleBlock}
        />
      )}

      {/* Place Detail Sheet */}
      {selectedPlace && (
        <PlaceDetailSheet
          place={selectedPlace}
          onClose={() => setSelectedPlace(null)}
          isFavorited={favoritedPlaces.has(selectedPlace.id)}
          onToggleFavorite={handleToggleFavorite}
        />
      )}

      {/* Submit Place Modal */}
      {submitPlaceOpen && (
        <SubmitPlaceModal
          myPos={myPos}
          onClose={() => setSubmitPlaceOpen(false)}
        />
      )}

      {/* Book a Call Modal */}
      {selectedPerformer && (() => {
        const creator = {
          id: selectedPerformer.userId || selectedPerformer.id || "",
          username: selectedPerformer.slug || selectedPerformer.displayName || selectedPerformer.name || "",
          photo_url: selectedPerformer.photoUrl ?? null,
          bio: selectedPerformer.bio ?? null,
          creator_type: "full_time" as const,
          creator_price_usd: selectedPerformer.basePrice,
        };
        return (
          <BookCallModal
            creator={creator}
            isOnline={!!selectedPerformer.isOnline}
            open={true}
            onClose={() => setSelectedPerformer(null)}
            performers={allPerformers}
          />
        );
      })()}
    </div>
  );
}
