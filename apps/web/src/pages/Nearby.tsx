import React, { useState, useEffect, useRef, useCallback } from "react";
import { Helmet } from "react-helmet-async";
import { useNavigate } from "react-router-dom";
import { Badge, Button } from "@pnptv/ui-kit";
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
  type NearbyUser,
  type NearbyPlace,
  type NearbySearchResponse,
  type SubmitPlacePayload,
} from "@/lib/api";
import { getSocket, connectSocket } from "@/lib/socket";
import { MapContainer, TileLayer, Marker, Circle, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const RADIUS_OPTIONS = [1, 5, 10, 25];
const REFRESH_INTERVAL = 15_000;
const LAST_POS_KEY = "pnptv:nearbyLastPos";
const FAV_PLACES_KEY = "pnptv:favPlaces";

// ─── Filter types ───────────────────────────────────────────────────────────

type FilterSegment = "all" | "users" | "places";

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

// ─── Custom marker icons ────────────────────────────────────────────────────

/** Escape a string for safe injection into an HTML attribute or text node. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Sanitize a phone number to only allow digits, +, -, spaces, and parentheses. */
function sanitizePhone(phone: string): string {
  return phone.replace(/[^0-9+\-\s()]/g, "");
}

function createUserAvatarIcon(photoUrl: string | null | undefined, displayName: string): L.DivIcon {
  const safeInitials = esc((displayName || "?")[0].toUpperCase());
  const inner = photoUrl
    ? `<img src="${esc(photoUrl)}" style="width:100%;height:100%;object-fit:cover;" onerror="this.style.display='none'" />`
    : `<span style="font-size:11px;font-weight:700;color:#FFB454;">${safeInitials}</span>`;
  return L.divIcon({
    className: "",
    iconSize: [38, 44],
    iconAnchor: [19, 44],
    popupAnchor: [0, -44],
    html: `
      <div style="position:relative;width:38px;height:44px;">
        <div style="position:absolute;bottom:0;left:50%;transform:translateX(-50%);width:0;height:0;border-left:7px solid transparent;border-right:7px solid transparent;border-top:10px solid #FFB454;"></div>
        <div style="position:absolute;top:0;left:0;width:34px;height:34px;border-radius:50%;background:linear-gradient(135deg,#D4007A,#E69138);padding:2px;overflow:hidden;display:flex;align-items:center;justify-content:center;border:2px solid #FFB454;box-shadow:0 2px 8px rgba(0,0,0,0.5);">
          <div style="width:100%;height:100%;border-radius:50%;overflow:hidden;display:flex;align-items:center;justify-content:center;background:#2C2C2E;">
            ${inner}
          </div>
        </div>
      </div>`,
  });
}

function createMyIcon() {
  return L.divIcon({
    className: "",
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    html: `<div style="width:18px;height:18px;border-radius:50%;background:#4A90D9;border:3px solid #fff;box-shadow:0 0 8px rgba(74,144,217,0.6);"></div>`,
  });
}

function createMyIconOffline() {
  return L.divIcon({
    className: "",
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    html: `<div style="width:18px;height:18px;border-radius:50%;background:#555;border:2px dashed #888;opacity:0.75;"></div>`,
  });
}

function createPlaceIcon(emoji = "📍"): L.DivIcon {
  return L.divIcon({
    className: "",
    iconSize: [36, 42],
    iconAnchor: [18, 42],
    popupAnchor: [0, -42],
    html: `
      <div style="position:relative;width:36px;height:42px;">
        <div style="position:absolute;bottom:0;left:50%;transform:translateX(-50%);width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-top:8px solid #34C85A;"></div>
        <div style="position:absolute;top:0;left:0;width:32px;height:32px;border-radius:50%;background:#1C2E1C;border:2px solid #34C85A;display:flex;align-items:center;justify-content:center;font-size:15px;box-shadow:0 2px 8px rgba(0,0,0,0.5);">${emoji}</div>
      </div>`,
  });
}

// Component that moves map to new center when position changes
function MapRecenter({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView([lat, lng], map.getZoom());
  }, [lat, lng, map]);
  return null;
}

// ─── Utility helpers ────────────────────────────────────────────────────────

function isValidPhotoUrl(url: string | null | undefined): url is string {
  return !!url && (url.startsWith("/") || url.startsWith("http"));
}

// ─── Discovery Strip ─────────────────────────────────────────────────────────

interface DiscoveryStripProps {
  users: NearbyUser[];
  places: NearbyPlace[];
}

function DiscoveryStrip({ users, places }: DiscoveryStripProps) {
  const cards: { emoji: string; title: string; subtitle: string }[] = [];

  // Community nudge card
  if (users.length > 0) {
    const count = users.length;
    const nudges = [
      `${count === 1 ? "Someone in the community is" : `${count} community members are`} nearby right now — go say hi!`,
      `${count} ${count === 1 ? "member is" : "members are"} around you today. Maybe make a new friend?`,
      `You're not alone — ${count} ${count === 1 ? "person from" : "people from"} the community ${count === 1 ? "is" : "are"} close by.`,
    ];
    cards.push({
      emoji: "👋",
      title: count === 1 ? "1 member nearby" : `${count} members nearby`,
      subtitle: nudges[count % nudges.length],
    });
  }

  // Nearest place per emoji (up to 3 unique places)
  const seenEmojis = new Set<string>();
  [...places]
    .filter((p) => p.location !== null)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 8)
    .forEach((p) => {
      const emoji = p.categoryEmoji || "📍";
      if (seenEmojis.has(emoji)) return;
      seenEmojis.add(emoji);
      const dist = p.distance < 1
        ? `${Math.round(p.distance * 1000)}m`
        : `${p.distance.toFixed(1)}km`;
      const slug = p.categorySlug || "";
      let subtitle = `${p.name} is ${dist} away`;
      if (slug === "saunas") subtitle = `${p.name} is ${dist} away — a hot spot in the community`;
      else if (slug === "bars-clubs") subtitle = `${p.name} is ${dist} away — PNP-friendly vibes nearby`;
      else if (slug === "wellness") subtitle = `${p.name} is ${dist} away — take a moment for yourself`;
      else if (slug === "pnp-friendly") subtitle = `${p.name} is ${dist} away — community-approved spot`;
      else if (slug === "hotels-lodging") subtitle = `${p.name} is ${dist} away — a great local option`;
      cards.push({
        emoji,
        title: `${p.name} · ${dist}`,
        subtitle,
      });
      if (cards.length >= 5) return;
    });

  if (cards.length === 0) return null;

  return (
    <div
      className="flex gap-2 overflow-x-auto pb-1 mb-2 scrollbar-none"
      style={{ scrollbarWidth: "none", msOverflowStyle: "none" } as React.CSSProperties}
    >
      {cards.map((card, i) => (
        <div
          key={i}
          className="flex-shrink-0 rounded-xl p-3 border border-white/10 backdrop-blur-md"
          style={{ background: "rgba(28,28,30,0.85)", minWidth: 200, maxWidth: 240 }}
        >
          <div className="flex items-center gap-2 mb-1">
            <span className="text-lg">{card.emoji}</span>
            <p className="text-xs font-semibold text-pnp-textPrimary truncate">{card.title}</p>
          </div>
          <p className="text-[11px] text-pnp-textSecondary leading-relaxed line-clamp-2">{card.subtitle}</p>
        </div>
      ))}
    </div>
  );
}

// ─── Detail sheet for tapped items ──────────────────────────────────────────

interface UserDetailSheetProps {
  user: NearbyUser;
  onClose: () => void;
  onNavigate: (path: string) => void;
}

function UserDetailSheet({ user, onClose, onNavigate }: UserDetailSheetProps) {
  const t = useI18n();
  const displayName = user.name || user.username || `User #${user.user_id}`;

  function formatUserDist(u: NearbyUser): string {
    if (u.distance_m !== undefined && u.distance_m < 1000) {
      return t.booking.metersAway(Math.round(u.distance_m));
    }
    if (u.distance_km !== undefined) {
      return t.booking.kmAway(u.distance_km.toFixed(1));
    }
    return t.booking.nearbyFallback;
  }

  return (
    <div className="absolute inset-x-0 bottom-0 z-[1100] animate-slide-up">
      <div
        className="mx-3 mb-3 rounded-2xl border border-white/10 overflow-hidden"
        style={{ background: "rgba(28,28,30,0.95)", backdropFilter: "blur(16px)" }}
      >
        {/* Handle bar */}
        <div className="flex justify-center pt-2 pb-1">
          <div className="w-8 h-1 rounded-full bg-white/20" />
        </div>

        <div className="px-4 pb-4">
          {/* User info */}
          <div className="flex items-center gap-3 mb-3">
            {isValidPhotoUrl(user.photo_url) ? (
              <img
                src={user.photo_url}
                className="w-12 h-12 rounded-full object-cover flex-shrink-0"
                alt={`${user.name || user.username || "User"}'s avatar`}
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
            ) : (
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold flex-shrink-0"
                style={{ background: "rgba(255,180,84,0.2)", color: "#FFB454" }}
              >
                {displayName[0].toUpperCase()}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm text-pnp-textPrimary truncate">{displayName}</p>
              {user.username && (
                <p className="text-xs text-pnp-textSecondary">@{user.username}</p>
              )}
              <p className="text-xs mt-0.5" style={{ color: "#FFB454" }}>
                {formatUserDist(user)}
              </p>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <button
              onClick={() => onNavigate(`/profile/${user.user_id}`)}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white active:scale-[0.98] transition-transform"
              style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
            >
              {t.booking.viewProfile}
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl text-sm text-pnp-textSecondary border border-white/10 hover:bg-white/5 active:scale-[0.98] transition-all"
            >
              {t.booking.close}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

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

  function formatPlaceDist(p: NearbyPlace): string {
    if (p.distance < 1) {
      return t.booking.metersAway(Math.round(p.distance * 1000));
    }
    return t.booking.kmAway(p.distance.toFixed(1));
  }

  // Check if place is currently open
  const isOpenNow = React.useMemo(() => {
    const hours = place.hoursOfOperation;
    if (!hours || Object.keys(hours).length === 0) return null;
    const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    const now = new Date();
    const dayKey = days[now.getDay()];
    const todayHours = hours[dayKey];
    if (!todayHours || todayHours.toLowerCase() === "closed") return false;
    return true; // Simplified — has hours for today
  }, [place.hoursOfOperation]);

  return (
    <div className="absolute inset-x-0 bottom-0 z-[1100] animate-slide-up">
      <div
        className="mx-3 mb-3 rounded-2xl border border-white/10 overflow-hidden max-h-[70vh] overflow-y-auto"
        style={{ background: "rgba(28,28,30,0.95)", backdropFilter: "blur(16px)" }}
      >
        {/* Handle bar */}
        <div className="flex justify-center pt-2 pb-1">
          <div className="w-8 h-1 rounded-full bg-white/20" />
        </div>

        <div className="px-4 pb-4">
          {/* Place header */}
          <div className="flex items-center gap-3 mb-3">
            {isValidPhotoUrl(place.photoUrl) ? (
              <img
                src={place.photoUrl}
                className="w-12 h-12 rounded-xl object-cover flex-shrink-0"
                alt={place.name}
              />
            ) : (
              <div
                className="w-12 h-12 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
                style={{ background: "rgba(52,200,90,0.15)" }}
              >
                {place.categoryEmoji || "📍"}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm text-pnp-textPrimary truncate">{place.name}</p>
              {place.categoryName && (
                <p className="text-xs text-pnp-textSecondary">{place.categoryName}</p>
              )}
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-xs" style={{ color: "#34C85A" }}>
                  {formatPlaceDist(place)}
                </span>
                {isOpenNow !== null && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                    isOpenNow ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"
                  }`}>
                    {isOpenNow ? "Abierto" : "Cerrado"}
                  </span>
                )}
              </div>
            </div>
            {/* Favorite button */}
            <button
              onClick={() => onToggleFavorite(place.id)}
              className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center active:scale-90 transition-transform"
              style={{ background: isFavorited ? "rgba(230,145,56,0.2)" : "rgba(255,255,255,0.05)" }}
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill={isFavorited ? "#E69138" : "none"} stroke={isFavorited ? "#E69138" : "#888"} strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
              </svg>
            </button>
          </div>

          {/* Details */}
          <div className="space-y-2 mb-3">
            {place.description && (
              <p className="text-xs text-pnp-textSecondary leading-relaxed">{place.description}</p>
            )}
            {place.address && (
              <div className="flex items-start gap-2">
                <svg className="w-3.5 h-3.5 text-pnp-textSecondary flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
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

          {/* Hours of operation */}
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
          <div className="flex gap-2">
            {place.website && /^https?:\/\//i.test(place.website) && (
              <a
                href={place.website}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white text-center active:scale-[0.98] transition-transform"
                style={{ background: "linear-gradient(135deg, #34C85A, #2EA04A)" }}
              >
                {t.booking.visitWebsite}
              </a>
            )}
            {place.instagram && (
              <a
                href={`https://instagram.com/${place.instagram.replace("@", "")}`}
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-2.5 rounded-xl text-sm font-semibold text-white text-center active:scale-[0.98] transition-transform"
                style={{ background: "linear-gradient(135deg, #833AB4, #E1306C)" }}
              >
                Instagram
              </a>
            )}
            {place.telegramUsername && (
              <a
                href={`https://t.me/${place.telegramUsername.replace("@", "")}`}
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-2.5 rounded-xl text-sm font-semibold text-white text-center active:scale-[0.98] transition-transform"
                style={{ background: "linear-gradient(135deg, #0088CC, #229ED9)" }}
              >
                Telegram
              </a>
            )}
            <button
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl text-sm text-pnp-textSecondary border border-white/10 hover:bg-white/5 active:scale-[0.98] transition-all"
            >
              {t.booking.close}
            </button>
          </div>

          {/* Report link */}
          <div className="mt-3 text-center">
            {reportSent ? (
              <p className="text-[11px] text-green-400">Reporte enviado. Gracias.</p>
            ) : showReportConfirm ? (
              <div className="flex items-center justify-center gap-2">
                <span className="text-[11px] text-pnp-textSecondary">Reportar como inapropiado?</span>
                <button
                  onClick={() => { setShowReportConfirm(false); }}
                  className="text-[11px] text-pnp-textSecondary underline"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => {
                    reportPlace(place.id).catch(() => {});
                    setReportSent(true);
                    setShowReportConfirm(false);
                  }}
                  className="text-[11px] text-red-400 underline font-medium"
                >
                  Reportar
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowReportConfirm(true)}
                className="text-[11px] text-pnp-textSecondary/60 hover:text-pnp-textSecondary"
              >
                Reportar lugar
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Submit Place Modal ──────────────────────────────────────────────────────

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
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-pnp-textPrimary">{t.booking.addAPlace}</h2>
          <button onClick={onClose} className="text-pnp-textSecondary hover:text-pnp-textPrimary">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
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
            <input
              placeholder={t.booking.placeName}
              value={form.name}
              onChange={e => set("name", e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg bg-pnp-surface border border-pnp-border text-sm text-pnp-textPrimary placeholder:text-pnp-textSecondary focus:outline-none focus:border-pnp-accent"
            />
            <select
              value={form.categoryId ?? ""}
              onChange={e => set("categoryId", e.target.value ? Number(e.target.value) : undefined)}
              className="w-full px-3 py-2.5 rounded-lg bg-pnp-surface border border-pnp-border text-sm text-pnp-textPrimary focus:outline-none focus:border-pnp-accent"
            >
              <option value="">{t.booking.selectCategory}</option>
              {PLACE_CATEGORIES_IDS.map(c => (
                <option key={c.id} value={c.id}>{c.emoji} {t.booking[c.key]}</option>
              ))}
            </select>
            <input
              placeholder={t.booking.address}
              value={form.address ?? ""}
              onChange={e => set("address", e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg bg-pnp-surface border border-pnp-border text-sm text-pnp-textPrimary placeholder:text-pnp-textSecondary focus:outline-none focus:border-pnp-accent"
            />
            <div className="flex gap-2">
              <input
                placeholder={t.booking.city}
                value={form.city ?? ""}
                onChange={e => set("city", e.target.value)}
                className="flex-1 px-3 py-2.5 rounded-lg bg-pnp-surface border border-pnp-border text-sm text-pnp-textPrimary placeholder:text-pnp-textSecondary focus:outline-none focus:border-pnp-accent"
              />
              <input
                placeholder={t.booking.country}
                value={form.country ?? ""}
                onChange={e => set("country", e.target.value)}
                className="flex-1 px-3 py-2.5 rounded-lg bg-pnp-surface border border-pnp-border text-sm text-pnp-textPrimary placeholder:text-pnp-textSecondary focus:outline-none focus:border-pnp-accent"
              />
            </div>
            <textarea
              placeholder={t.booking.descriptionOptional}
              value={form.description ?? ""}
              onChange={e => set("description", e.target.value)}
              rows={2}
              className="w-full px-3 py-2.5 rounded-lg bg-pnp-surface border border-pnp-border text-sm text-pnp-textPrimary placeholder:text-pnp-textSecondary focus:outline-none focus:border-pnp-accent resize-none"
            />
            <div className="flex gap-2">
              <input
                placeholder={t.booking.instagramOptional}
                value={form.instagram ?? ""}
                onChange={e => set("instagram", e.target.value)}
                className="flex-1 px-3 py-2.5 rounded-lg bg-pnp-surface border border-pnp-border text-sm text-pnp-textPrimary placeholder:text-pnp-textSecondary focus:outline-none focus:border-pnp-accent"
              />
              <input
                placeholder={t.booking.websiteOptional}
                value={form.website ?? ""}
                onChange={e => set("website", e.target.value)}
                className="flex-1 px-3 py-2.5 rounded-lg bg-pnp-surface border border-pnp-border text-sm text-pnp-textPrimary placeholder:text-pnp-textSecondary focus:outline-none focus:border-pnp-accent"
              />
            </div>
            {err && <p className="text-xs text-red-400">{err}</p>}
            <button
              onClick={submit}
              disabled={loading}
              className="w-full py-2.5 rounded-xl bg-pnp-accent text-white text-sm font-semibold hover:bg-pnp-accent/80 disabled:opacity-40 transition-colors"
            >
              {loading ? t.booking.submitting : t.booking.submitForReview}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

type PageState = "loading" | "denied" | "ready";

export default function Nearby() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const t = useI18n();
  const { showTutorial, dismissTutorial } = useTutorial("nearby");

  const [pageState, setPageState] = useState<PageState>("loading");
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
  const [nearbyUsers, setNearbyUsers] = useState<NearbyUser[]>([]);
  const [nearbyPlaces, setNearbyPlaces] = useState<NearbyPlace[]>([]);
  // Free-tier: count of nearby users returned from API
  const [nearbyCount, setNearbyCount] = useState(0);
  const [radius, setRadius] = useState(5);
  const radiusRef = useRef(radius);
  radiusRef.current = radius;
  const [incognito, setIncognito] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterSegment>("all");
  const [selectedUser, setSelectedUser] = useState<NearbyUser | null>(null);
  const [selectedPlace, setSelectedPlace] = useState<NearbyPlace | null>(null);
  const [submitPlaceOpen, setSubmitPlaceOpen] = useState(false);
  const [placeCategory, setPlaceCategory] = useState<string | null>(null);
  const [showUserList, setShowUserList] = useState(false);
  const [favoritedPlaces, setFavoritedPlaces] = useState<Set<number>>(() => {
    try {
      const cached = localStorage.getItem(FAV_PLACES_KEY);
      return cached ? new Set(JSON.parse(cached)) : new Set();
    } catch { return new Set(); }
  });
  const watchIdRef = useRef<number | null>(null);
  const refreshRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const myIconRef = useRef(createMyIcon());
  const myIconOfflineRef = useRef(createMyIconOffline());

  // Computed filtered counts
  const showUsers = filter === "all" || filter === "users";
  const showPlaces = filter === "all" || filter === "places";

  // Category-filtered places
  const filteredPlaces = placeCategory
    ? nearbyPlaces.filter((p) => p.categorySlug === placeCategory)
    : nearbyPlaces;

  // Favorite toggle handler
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
    if (selectedPlace) {
      trackPlaceView(selectedPlace.id).catch(() => {});
    }
  }, [selectedPlace]);

  // Fetch nearby users and places
  const fetchNearby = useCallback(
    async (lat: number, lng: number, rad: number) => {
      try {
        setIsSearching(true);
        const [usersData, placesData] = await Promise.allSettled([
          searchNearby(lat, lng, rad, 50),
          searchNearbyPlaces(lat, lng, rad),
        ]);
        if (usersData.status === "fulfilled") {
          const result = usersData.value as NearbySearchResponse & { tier?: string; count?: number };
          // Free-tier API response: { tier: 'free', count: N } — no users array
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
            // No places in radius — load nearest 1-5 as fallback so map is never empty
            getFallbackNearbyPlaces(lat, lng).then(fb => {
              setNearbyPlaces(fb.places || []);
            }).catch(() => {});
          }
        }
        setError(null);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Search failed";
        setError(msg);
      } finally {
        setIsSearching(false);
      }
    },
    []
  );

  // Send my location to backend
  const sendLocation = useCallback(
    async (lat: number, lng: number, accuracy: number) => {
      if (incognito) return;
      try {
        await updateNearbyLocation(lat, lng, accuracy);
      } catch {
        // Rate limited or error — silent
      }
    },
    [incognito]
  );

  // Load favorites from server on mount
  useEffect(() => {
    getPlaceFavorites().then((data) => {
      if (data.placeIds?.length) {
        setFavoritedPlaces(new Set(data.placeIds));
        try { localStorage.setItem(FAV_PLACES_KEY, JSON.stringify(data.placeIds)); } catch {}
      }
    }).catch(() => {});
  }, []);

  // If we have a cached position, show map immediately as "offline"
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

  // Start geolocation watch
  useEffect(() => {
    if (!navigator.geolocation) {
      setPageState("denied");
      return;
    }

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
        // Keep "ready" if we have a cached position, otherwise go to denied
        setMyPos((prev) => {
          if (!prev) setPageState("denied");
          return prev;
        });
        setLocationStatus("offline");
      },
      { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 }
    );

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, [sendLocation, fetchNearby]);

  // Auto-refresh with Page Visibility API (pause when tab hidden)
  useEffect(() => {
    if (!myPos || pageState !== "ready") return;

    const doRefresh = () => {
      fetchNearby(myPos.lat, myPos.lng, radius);
      if (!incognito) sendLocation(myPos.lat, myPos.lng, 50);
    };

    const startInterval = () => {
      if (refreshRef.current) clearInterval(refreshRef.current);
      refreshRef.current = setInterval(doRefresh, REFRESH_INTERVAL);
    };

    const onVisChange = () => {
      if (document.visibilityState === "visible") {
        doRefresh(); // immediate refresh on return
        startInterval();
      } else {
        if (refreshRef.current) { clearInterval(refreshRef.current); refreshRef.current = null; }
      }
    };

    startInterval();
    document.addEventListener("visibilitychange", onVisChange);

    return () => {
      if (refreshRef.current) clearInterval(refreshRef.current);
      document.removeEventListener("visibilitychange", onVisChange);
    };
  }, [myPos, radius, incognito, pageState, fetchNearby, sendLocation]);

  // Socket.IO: join nearby grid room + listen for real-time updates
  useEffect(() => {
    if (!myPos) return;
    const socket = connectSocket();
    socket.emit("nearby:join-grid", { lat: myPos.lat, lng: myPos.lng });

    let debounce: ReturnType<typeof setTimeout> | null = null;
    const handler = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        if (document.visibilityState === "visible" && myPos) {
          fetchNearby(myPos.lat, myPos.lng, radius);
        }
      }, 2000);
    };

    socket.on("nearby:location-updated", handler);
    return () => {
      socket.off("nearby:location-updated", handler);
      if (debounce) clearTimeout(debounce);
      socket.emit("nearby:leave");
    };
  }, [myPos, radius, fetchNearby]);

  // Close detail sheet when filter changes
  useEffect(() => {
    setSelectedUser(null);
    setSelectedPlace(null);
  }, [filter]);

  const handleNavigate = useCallback(
    (path: string) => navigate(path),
    [navigate]
  );

  // ─── Loading state (only show if no cached position) ───────────
  if (pageState === "loading" && !myPos) {
    return (
      <div className="page-container flex flex-col items-center justify-center min-h-[60vh]">
        <div className="relative w-20 h-20 mb-6">
          <div className="absolute inset-0 border-2 border-pnp-accent/30 rounded-full animate-ping" />
          <div className="absolute inset-2 border-2 border-pnp-accent/50 rounded-full animate-ping" style={{ animationDelay: "0.3s" }} />
          <div className="absolute inset-4 border-2 border-pnp-accent rounded-full animate-pulse" />
          <svg className="absolute inset-0 w-20 h-20 text-pnp-accent p-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </div>
        <p className="text-pnp-textPrimary font-medium">{t.booking.findingLocation}</p>
        <p className="text-sm text-pnp-textSecondary mt-1">
          {t.booking.grantLocationAccess}
        </p>
      </div>
    );
  }

  // ─── Permission denied state ────────────────────────────────────
  if (pageState === "denied") {
    return (
      <div className="page-container flex flex-col items-center justify-center min-h-[60vh]">
        <svg className="w-16 h-16 text-pnp-textSecondary mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
        </svg>
        <p className="text-pnp-textPrimary font-medium text-lg mb-2">{t.booking.locationAccessNeeded}</p>
        <p className="text-sm text-pnp-textSecondary text-center max-w-xs mb-6">
          {t.booking.locationAccessBody}
        </p>
        <Button
          variant="primary"
          onClick={() => {
            setPageState("loading");
            navigator.geolocation.getCurrentPosition(
              (pos) => {
                setMyPos({ lat: pos.coords.latitude, lng: pos.coords.longitude });
                setPageState("ready");
              },
              () => setPageState("denied"),
              { enableHighAccuracy: true }
            );
          }}
        >
          {t.booking.tryAgain}
        </Button>
      </div>
    );
  }

  // ─── Map ready state ────────────────────────────────────────────
  return (
    <div className="page-container !p-0 relative h-full">
      <Helmet>
        <title>{t.booking.pageTitle}</title>
        <meta name="description" content={t.booking.pageDescription} />
      </Helmet>
      {showTutorial && <TutorialOverlay section="nearby" onDismiss={dismissTutorial} />}
      {/* Map */}
      {myPos && (
        <div className="absolute inset-0">
          <style>{`
            .leaflet-tile-pane { filter: brightness(0.5) saturate(0.5) contrast(1.1); }
            .leaflet-container { background: #1C1C1E; }
            .leaflet-control-zoom a { background: #2C2C2E !important; color: #FFB454 !important; border-color: #3C3C3E !important; }
            .leaflet-control-attribution { display: none !important; }
            @keyframes slide-up { from { transform: translateY(100%); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
            .animate-slide-up { animation: slide-up 0.25s ease-out; }
          `}</style>
          <MapContainer
            center={[myPos.lat, myPos.lng]}
            zoom={14}
            style={{ width: "100%", height: "100%" }}
            zoomControl={false}
          >
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution=""
            />
            <MapRecenter lat={myPos.lat} lng={myPos.lng} />

            {/* Radius circle */}
            <Circle
              center={[myPos.lat, myPos.lng]}
              radius={radius * 1000}
              pathOptions={{
                color: "#E69138",
                fillColor: "#E69138",
                fillOpacity: 0.08,
                weight: 1.5,
                dashArray: "6 4",
              }}
            />

            {/* My position */}
            <Marker
              position={[myPos.lat, myPos.lng]}
              icon={locationStatus === "online" ? myIconRef.current : myIconOfflineRef.current}
            />

            {/* Nearby users — avatar markers */}
            {showUsers && nearbyUsers.map((u) => {
              const displayName = u.name || u.username || "?";
              const icon = createUserAvatarIcon(u.photo_url, displayName);
              return (
                <Marker
                  key={u.user_id}
                  position={[u.latitude, u.longitude]}
                  icon={icon}
                  eventHandlers={{
                    click: () => {
                      setSelectedPlace(null);
                      setSelectedUser(u);
                    },
                  }}
                />
              );
            })}

            {/* Nearby places — category emoji markers (filtered by category) */}
            {showPlaces && filteredPlaces.filter((p) => p.location !== null).map((p) => {
              const emoji = p.categoryEmoji || "📍";
              return (
                <Marker
                  key={`place-${p.id}`}
                  position={[p.location!.lat, p.location!.lng]}
                  icon={createPlaceIcon(emoji)}
                  eventHandlers={{
                    click: () => {
                      setSelectedUser(null);
                      setSelectedPlace(p);
                    },
                  }}
                />
              );
            })}
          </MapContainer>
        </div>
      )}

      {/* Top overlay — title + filter + badges */}
      <div className="absolute top-0 left-0 right-0 z-[1000] pointer-events-none">
        <div className="flex items-center justify-between px-4 pt-3 pb-2">
          <div className="pointer-events-auto bg-pnp-surface/80 backdrop-blur-md rounded-xl px-3 py-1.5 border border-white/5">
            <h1 className="text-sm font-bold text-pnp-textPrimary">{t.booking.nearby}</h1>
          </div>
          <div className="pointer-events-auto flex items-center gap-2">
            {isSearching && (
              <div className="w-2 h-2 rounded-full animate-pulse dot-gradient" />
            )}
            {/* Location status badge */}
            {locationStatus === "online" ? (
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
            ) : null}
            {showUsers && (
              <Badge variant="accent">
                {nearbyUsers.length} {nearbyUsers.length === 1 ? t.booking.userSingular : t.booking.userPlural}
              </Badge>
            )}
            {showPlaces && filteredPlaces.length > 0 && (
              <Badge variant="default">
                {filteredPlaces.length} {filteredPlaces.length === 1 ? t.booking.placeSingular : t.booking.placePlural}
              </Badge>
            )}
          </div>
        </div>

        {/* Filter segment control */}
        <div className="flex justify-center px-4 pb-1">
          <div className="pointer-events-auto inline-flex gap-1 bg-pnp-surface/80 backdrop-blur-md rounded-xl p-1 border border-white/5">
            {(
              [
                { key: "all" as const,    label: t.booking.filterAll },
                { key: "users" as const,  label: t.booking.filterUsers },
                { key: "places" as const, label: t.booking.filterPlaces },
              ]
            ).map((seg) => (
              <button
                key={seg.key}
                onClick={() => setFilter(seg.key)}
                className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  filter === seg.key
                    ? "text-white"
                    : "text-pnp-textSecondary hover:text-pnp-textPrimary"
                }`}
                style={
                  filter === seg.key
                    ? { background: "linear-gradient(135deg, #D4007A, #E69138)" }
                    : undefined
                }
              >
                {seg.label}
                {seg.key === "users" && ` (${nearbyUsers.length})`}
                {seg.key === "places" && ` (${nearbyPlaces.length})`}
              </button>
            ))}
          </div>
        </div>

        {/* Category filter chips — shown when places are visible */}
        {showPlaces && nearbyPlaces.length > 0 && (
          <div className="flex justify-center px-4 pb-1">
            <div
              className="pointer-events-auto flex gap-1 overflow-x-auto scrollbar-none py-1 px-1"
              style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
            >
              {PLACE_CATEGORY_CHIPS.map((chip) => (
                <button
                  key={chip.slug ?? "all"}
                  onClick={() => setPlaceCategory(chip.slug)}
                  className={`flex-shrink-0 px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors whitespace-nowrap ${
                    placeCategory === chip.slug
                      ? "bg-amber-500/20 border-amber-500/50 text-amber-400"
                      : "bg-pnp-surface/70 border-white/10 text-pnp-textSecondary hover:text-pnp-textPrimary"
                  }`}
                >
                  {chip.emoji} {chip.label}
                  {chip.slug && ` (${nearbyPlaces.filter(p => p.categorySlug === chip.slug).length})`}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* List view toggle */}
        {showUsers && nearbyUsers.length > 0 && (
          <div className="flex justify-end px-4 pb-1">
            <button
              onClick={() => setShowUserList(!showUserList)}
              className="pointer-events-auto p-1.5 rounded-lg bg-pnp-surface/80 border border-white/10 backdrop-blur-md"
              title={showUserList ? "Map view" : "List view"}
            >
              {showUserList ? (
                <svg className="w-4 h-4 text-pnp-textSecondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                </svg>
              ) : (
                <svg className="w-4 h-4 text-pnp-textSecondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                </svg>
              )}
            </button>
          </div>
        )}

        {/* Nearest place ambient pill */}
        {showPlaces && filteredPlaces.length > 0 && (() => {
          const nearest = [...filteredPlaces]
            .filter((p) => p.location !== null)
            .sort((a, b) => a.distance - b.distance)[0];
          if (!nearest) return null;
          const dist = nearest.distance < 1
            ? `${Math.round(nearest.distance * 1000)}m`
            : `${nearest.distance.toFixed(1)}km`;
          const emoji = nearest.categoryEmoji || "📍";
          return (
            <div className="flex justify-center pb-2 pointer-events-none">
              <div className="pointer-events-auto inline-flex items-center gap-1.5 bg-pnp-surface/80 backdrop-blur-md rounded-full px-3 py-1.5 border border-white/10 shadow-lg">
                <span className="text-sm">{emoji}</span>
                <span className="text-xs text-pnp-textPrimary font-medium truncate max-w-[160px]">{nearest.name}</span>
                <span className="text-xs text-pnp-textSecondary">· {dist}</span>
              </div>
            </div>
          );
        })()}
      </div>

      {/* User list panel (below map overlay) */}
      {showUserList && showUsers && nearbyUsers.length > 0 && !selectedUser && !selectedPlace && (
        <div className="absolute bottom-44 left-0 right-0 z-[1001] max-h-[40vh] overflow-y-auto px-3">
          <div className="bg-pnp-surface/90 backdrop-blur-md rounded-xl border border-white/10 p-2 space-y-1.5">
            {nearbyUsers.slice(0, 20).map((u) => {
              const displayName = u.name || u.username || `User #${u.user_id}`;
              const dist = u.distance_m !== undefined && u.distance_m < 1000
                ? `${Math.round(u.distance_m)}m`
                : u.distance_km !== undefined ? `${u.distance_km.toFixed(1)}km` : "";
              return (
                <div
                  key={u.user_id}
                  className="flex items-center gap-3 p-2 rounded-lg hover:bg-white/5 cursor-pointer active:bg-white/10 transition-colors"
                  onClick={() => { setSelectedUser(u); setShowUserList(false); }}
                >
                  {isValidPhotoUrl(u.photo_url) ? (
                    <img src={u.photo_url} className="w-9 h-9 rounded-full object-cover flex-shrink-0" alt="" />
                  ) : (
                    <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
                      style={{ background: "rgba(255,180,84,0.2)", color: "#FFB454" }}>
                      {displayName[0].toUpperCase()}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-xs font-semibold text-pnp-textPrimary truncate">{displayName}</p>
                      {u.is_followed && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-green-500/20 text-green-400 font-medium">Siguiendo</span>
                      )}
                    </div>
                    {u.username && <p className="text-[11px] text-pnp-textSecondary">@{u.username}</p>}
                  </div>
                  {dist && <span className="text-[11px] text-amber-400 font-medium flex-shrink-0">{dist}</span>}
                </div>
              );
            })}
            {nearbyUsers.length > 20 && (
              <p className="text-center text-[11px] text-pnp-textSecondary py-1">+{nearbyUsers.length - 20} more</p>
            )}
          </div>
        </div>
      )}

      {/* Submit place FAB */}
      {!submitPlaceOpen && (
        <button
          onClick={() => setSubmitPlaceOpen(true)}
          className="absolute bottom-32 right-4 z-[1001] w-11 h-11 rounded-full bg-pnp-accent text-white flex items-center justify-center shadow-lg hover:bg-pnp-accent/80 active:scale-95 transition-all"
          title={t.booking.addPlace}
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
        </button>
      )}

      {/* Submit place modal */}
      {submitPlaceOpen && (
        <SubmitPlaceModal
          myPos={myPos}
          onClose={() => setSubmitPlaceOpen(false)}
        />
      )}

      {/* Detail sheets */}
      {selectedUser && (
        <UserDetailSheet
          user={selectedUser}
          onClose={() => setSelectedUser(null)}
          onNavigate={handleNavigate}
        />
      )}
      {selectedPlace && (
        <PlaceDetailSheet
          place={selectedPlace}
          onClose={() => setSelectedPlace(null)}
          isFavorited={favoritedPlaces.has(selectedPlace.id)}
          onToggleFavorite={handleToggleFavorite}
        />
      )}

      {/* Bottom overlay — controls (hidden when detail sheet is open) */}
      {!selectedUser && !selectedPlace && (
        <div className="absolute bottom-0 left-0 right-0 z-[1000] pointer-events-none">
          <div className="px-4 pb-4 pt-2 pointer-events-auto">
            {/* Error banner */}
            {error && (
              <div className="mb-2 bg-red-900/50 backdrop-blur-md rounded-lg px-3 py-2 text-xs text-red-300 border border-red-500/20">
                {error}
              </div>
            )}

            {/* Discovery strip — shown when results exist */}
            {!isSearching && (nearbyUsers.length > 0 || nearbyPlaces.length > 0) && (
              <DiscoveryStrip users={nearbyUsers} places={nearbyPlaces} />
            )}

            {/* No results card */}
            {!isSearching && nearbyUsers.length === 0 && nearbyPlaces.length === 0 && (
              <div className="mb-3 bg-pnp-surface/80 backdrop-blur-md rounded-xl p-3 border border-white/5">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">🌍</span>
                  <div>
                    <p className="text-sm font-semibold text-pnp-textPrimary">The community is out there</p>
                    <p className="text-xs text-pnp-textSecondary mt-0.5">Try expanding your radius — members could be just a little further away</p>
                  </div>
                </div>
              </div>
            )}

            {/* Controls row */}
            <div className="flex items-center gap-2">
              {/* Radius selector */}
              <div className="flex-1 flex gap-1.5 bg-pnp-surface/80 backdrop-blur-md rounded-xl p-1.5 border border-white/5">
                {RADIUS_OPTIONS.map((r) => (
                  <button
                    key={r}
                    onClick={() => setRadius(r)}
                    className={`flex-1 text-xs font-medium py-1.5 rounded-lg transition-colors ${
                      radius === r
                        ? "text-white"
                        : "text-pnp-textSecondary hover:text-pnp-textPrimary"
                    }`}
                    style={radius === r ? { background: "linear-gradient(135deg, #D4007A, #E69138)" } : undefined}
                  >
                    {t.booking.radiusKm(r)}
                  </button>
                ))}
              </div>

              {/* Incognito toggle */}
              <button
                onClick={() => setIncognito(!incognito)}
                className={`flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center border transition-colors backdrop-blur-md ${
                  incognito
                    ? "border-transparent text-white"
                    : "bg-pnp-surface/80 border-white/5 text-pnp-textSecondary"
                }`}
                style={incognito ? { background: "linear-gradient(135deg, rgba(212,0,122,0.2), rgba(230,145,56,0.2))", borderColor: "rgba(212,0,122,0.4)" } : undefined}
                title={incognito ? t.booking.incognitoOn : t.booking.incognitoOff}
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  {incognito ? (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  )}
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
