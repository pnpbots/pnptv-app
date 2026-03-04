import React, { useState, useEffect, useRef, useCallback } from "react";
import { Helmet } from "react-helmet-async";
import { useNavigate, Link } from "react-router-dom";
import { Badge, Button } from "@pnptv/ui-kit";
import { useTutorial } from "@/hooks/useTutorial";
import { TutorialOverlay } from "@/components/tutorial/TutorialOverlay";
import { useAuth } from "@/hooks/useAuth";
import {
  updateNearbyLocation,
  searchNearby,
  searchNearbyPlaces,
  type NearbyUser,
  type NearbyPlace,
  type NearbySearchResponse,
} from "@/lib/api";
import { MapContainer, TileLayer, Marker, Circle, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const RADIUS_OPTIONS = [1, 5, 10, 25];
const REFRESH_INTERVAL = 30_000;

// ─── Filter types ───────────────────────────────────────────────────────────

type FilterSegment = "all" | "users" | "places";

// ─── Custom marker icons ────────────────────────────────────────────────────

function createUserIcon() {
  return L.divIcon({
    className: "",
    iconSize: [28, 28],
    iconAnchor: [14, 28],
    popupAnchor: [0, -28],
    html: `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="#FFB454" stroke="#1C1C1E" stroke-width="1.5">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
      <circle cx="12" cy="10" r="3" fill="#1C1C1E" stroke="none"/>
    </svg>`,
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

function createPlaceIcon() {
  return L.divIcon({
    className: "",
    iconSize: [30, 30],
    iconAnchor: [15, 30],
    popupAnchor: [0, -30],
    html: `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 24 24" fill="#34C85A" stroke="#1C1C1E" stroke-width="1.5">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
      <rect x="9" y="8" width="6" height="5" rx="0.5" fill="#1C1C1E" stroke="none"/>
      <line x1="11" y1="13" x2="11" y2="8" stroke="#34C85A" stroke-width="1"/>
      <line x1="13" y1="13" x2="13" y2="8" stroke="#34C85A" stroke-width="1"/>
    </svg>`,
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

function formatUserDist(u: NearbyUser): string {
  if (u.distance_m !== undefined && u.distance_m < 1000) {
    return `${Math.round(u.distance_m)}m away`;
  }
  if (u.distance_km !== undefined) {
    return `${u.distance_km.toFixed(1)}km away`;
  }
  return "nearby";
}

function formatPlaceDist(p: NearbyPlace): string {
  if (p.distance < 1) {
    return `${Math.round(p.distance * 1000)}m away`;
  }
  return `${p.distance.toFixed(1)}km away`;
}

// ─── Detail sheet for tapped items ──────────────────────────────────────────

interface UserDetailSheetProps {
  user: NearbyUser;
  onClose: () => void;
  onNavigate: (path: string) => void;
}

function UserDetailSheet({ user, onClose, onNavigate }: UserDetailSheetProps) {
  const displayName = user.name || user.username || `User #${user.user_id}`;
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
              View Profile
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl text-sm text-pnp-textSecondary border border-white/10 hover:bg-white/5 active:scale-[0.98] transition-all"
            >
              Close
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
}

function PlaceDetailSheet({ place, onClose }: PlaceDetailSheetProps) {
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
              <p className="text-xs mt-0.5" style={{ color: "#34C85A" }}>
                {formatPlaceDist(place)}
              </p>
            </div>
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
                <a href={`tel:${place.phone}`} className="text-xs" style={{ color: "#34C85A" }}>{place.phone}</a>
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex gap-2">
            {place.website && (
              <a
                href={place.website}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white text-center active:scale-[0.98] transition-transform"
                style={{ background: "linear-gradient(135deg, #34C85A, #2EA04A)" }}
              >
                Visit Website
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
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Free-tier count card ────────────────────────────────────────────────────

function NearbyCountCard({ count }: { count: number }) {
  return (
    <div className="page-container flex flex-col items-center justify-center min-h-[60vh] px-6">
      <div
        className="w-24 h-24 rounded-full flex items-center justify-center mb-6"
        style={{ background: "linear-gradient(135deg, rgba(212,0,122,0.15), rgba(230,145,56,0.15))", border: "1px solid rgba(212,0,122,0.3)" }}
      >
        <svg className="w-12 h-12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} style={{ color: "#D4007A" }}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      </div>

      <p className="text-4xl font-bold text-pnp-textPrimary mb-1">
        {count > 0 ? count : "0"}
      </p>
      <p className="text-base text-pnp-textSecondary mb-1">
        {count === 1 ? "person" : "people"} near you
      </p>
      <p className="text-sm text-pnp-textSecondary mb-8 text-center max-w-xs">
        Upgrade to see who's nearby, browse profiles, and discover PNP spots on the map.
      </p>

      <Link
        to="/subscribe"
        className="inline-block px-6 py-3 rounded-full text-base font-semibold text-white"
        style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
      >
        Upgrade to see the map
      </Link>
    </div>
  );
}

// ─── Member-tier blurred profile list ────────────────────────────────────────

function MemberNearbyList({ users }: { users: NearbyUser[] }) {
  return (
    <div className="page-container px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-pnp-textPrimary">Nearby</h1>
          <p className="text-sm text-pnp-textSecondary mt-1">
            {users.length} {users.length === 1 ? "person" : "people"} nearby
          </p>
        </div>
        <Link
          to="/subscribe"
          className="text-xs px-3 py-1.5 rounded-full font-semibold text-white flex-shrink-0"
          style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
        >
          Upgrade to PRIME
        </Link>
      </div>

      {/* PRIME upgrade prompt */}
      <div
        className="rounded-xl p-4 mb-4 border"
        style={{ background: "rgba(255,180,84,0.06)", borderColor: "rgba(255,180,84,0.2)" }}
      >
        <div className="flex items-center gap-3">
          <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} style={{ color: "#FFB454" }}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <p className="text-sm text-pnp-textSecondary">
            Upgrade to{" "}
            <Link to="/subscribe" className="font-semibold" style={{ color: "#FFB454" }}>
              PRIME
            </Link>{" "}
            for the full map with exact distances
          </p>
        </div>
      </div>

      {users.length === 0 ? (
        <div className="glass-card-sm p-8 text-center">
          <p className="text-pnp-textPrimary font-medium mb-1">Nobody nearby yet</p>
          <p className="text-sm text-pnp-textSecondary">Check back later or expand your search area</p>
        </div>
      ) : (
        <div className="space-y-3">
          {users.map((u) => {
            const displayName = u.name || u.username || `User #${u.user_id}`;
            return (
              <div
                key={u.user_id}
                className="glass-card-sm p-3 flex items-center gap-3"
                style={{ filter: "blur(0px)" }}
              >
                {/* Photo placeholder — blurred */}
                <div
                  className="w-12 h-12 rounded-full flex-shrink-0 flex items-center justify-center text-lg font-bold"
                  style={{
                    background: "linear-gradient(135deg, rgba(212,0,122,0.2), rgba(230,145,56,0.2))",
                    color: "#D4007A",
                    filter: "blur(4px)",
                    userSelect: "none",
                  }}
                >
                  {displayName[0].toUpperCase()}
                </div>

                <div className="flex-1 min-w-0">
                  {/* Name visible, no click through */}
                  <p className="text-sm font-semibold text-pnp-textPrimary truncate">
                    {displayName}
                  </p>
                  {/* Distance blurred for member tier */}
                  <p
                    className="text-xs text-pnp-textSecondary"
                    style={{ filter: "blur(4px)", userSelect: "none" }}
                  >
                    {u.accuracy_estimate || "nearby"}
                  </p>
                </div>

                {/* No profile link for member tier */}
                <div
                  className="text-xs px-2.5 py-1 rounded-full border flex-shrink-0"
                  style={{ borderColor: "rgba(255,255,255,0.1)", color: "#8E8E93" }}
                >
                  PRIME
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

type PageState = "loading" | "denied" | "ready";

export default function Booking() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { showTutorial, dismissTutorial } = useTutorial("nearby");

  const userTier = user?.tier?.toLowerCase() ?? "free";
  const userRole = user?.role?.toLowerCase();
  const isAdmin = userRole === "admin" || userRole === "superadmin";
  const isFree = (userTier === "free" || !user?.tier) && !isAdmin;
  const isPrime = userTier === "prime" || isAdmin;

  const [pageState, setPageState] = useState<PageState>("loading");
  const [myPos, setMyPos] = useState<{ lat: number; lng: number } | null>(null);
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
  const watchIdRef = useRef<number | null>(null);
  const refreshRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const userIconRef = useRef(createUserIcon());
  const myIconRef = useRef(createMyIcon());
  const placeIconRef = useRef(createPlaceIcon());

  // Computed filtered counts
  const showUsers = filter === "all" || filter === "users";
  const showPlaces = filter === "all" || filter === "places";

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
          setNearbyPlaces(placesData.value.places || []);
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
        setMyPos({ lat: latitude, lng: longitude });
        setPageState("ready");
        sendLocation(latitude, longitude, accuracy);
        fetchNearby(latitude, longitude, radiusRef.current);
      },
      () => {
        setPageState("denied");
      },
      { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 }
    );

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, [sendLocation, fetchNearby]);

  // Auto-refresh nearby search
  useEffect(() => {
    if (!myPos || pageState !== "ready") return;

    refreshRef.current = setInterval(() => {
      fetchNearby(myPos.lat, myPos.lng, radius);
      if (!incognito) {
        sendLocation(myPos.lat, myPos.lng, 50);
      }
    }, REFRESH_INTERVAL);

    return () => {
      if (refreshRef.current) clearInterval(refreshRef.current);
    };
  }, [myPos, radius, incognito, pageState, fetchNearby, sendLocation]);

  // Close detail sheet when filter changes
  useEffect(() => {
    setSelectedUser(null);
    setSelectedPlace(null);
  }, [filter]);

  const handleNavigate = useCallback(
    (path: string) => navigate(path),
    [navigate]
  );

  // ─── Free-tier: show count card once we know the position ──────────────────
  if (isFree && pageState === "ready") {
    return <NearbyCountCard count={nearbyCount} />;
  }

  // ─── Member-tier: show blurred profile list (no map) ────────────────────────
  if (!isPrime && pageState === "ready") {
    return <MemberNearbyList users={nearbyUsers} />;
  }

  // ─── Loading state ──────────────────────────────────────────────
  if (pageState === "loading") {
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
        <p className="text-pnp-textPrimary font-medium">Finding your location...</p>
        <p className="text-sm text-pnp-textSecondary mt-1">
          Grant location access to discover nearby users
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
        <p className="text-pnp-textPrimary font-medium text-lg mb-2">Location Access Needed</p>
        <p className="text-sm text-pnp-textSecondary text-center max-w-xs mb-6">
          Enable location permissions in your browser or device settings to discover nearby users.
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
          Try Again
        </Button>
      </div>
    );
  }

  // ─── Map ready state ────────────────────────────────────────────
  return (
    <div className="page-container !p-0 relative" style={{ height: "calc(100vh - 8rem)" }}>
      <Helmet>
        <title>Nearby — PNPtv!</title>
        <meta name="description" content="Discover PNPtv members and venues near you. See who's around on the interactive map." />
      </Helmet>
      {showTutorial && <TutorialOverlay section="nearby" onDismiss={dismissTutorial} />}
      {/* Map */}
      {myPos && (
        <div className="absolute inset-0">
          <style>{`
            .leaflet-tile-pane { filter: invert(100%) hue-rotate(180deg) brightness(0.95) contrast(0.9); }
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
            <Marker position={[myPos.lat, myPos.lng]} icon={myIconRef.current} />

            {/* Nearby users */}
            {showUsers &&
              nearbyUsers.map((u) => (
                <Marker
                  key={u.user_id}
                  position={[u.latitude, u.longitude]}
                  icon={userIconRef.current}
                  eventHandlers={{
                    click: () => {
                      setSelectedPlace(null);
                      setSelectedUser(u);
                    },
                  }}
                />
              ))}

            {/* Nearby places */}
            {showPlaces &&
              nearbyPlaces.map((p) => (
                <Marker
                  key={`place-${p.id}`}
                  position={[p.location.lat, p.location.lng]}
                  icon={placeIconRef.current}
                  eventHandlers={{
                    click: () => {
                      setSelectedUser(null);
                      setSelectedPlace(p);
                    },
                  }}
                />
              ))}
          </MapContainer>
        </div>
      )}

      {/* Top overlay — title + filter + badges */}
      <div className="absolute top-0 left-0 right-0 z-[1000] pointer-events-none">
        <div className="flex items-center justify-between px-4 pt-3 pb-2">
          <div className="pointer-events-auto bg-pnp-surface/80 backdrop-blur-md rounded-xl px-3 py-1.5 border border-white/5">
            <h1 className="text-sm font-bold text-pnp-textPrimary">Nearby</h1>
          </div>
          <div className="pointer-events-auto flex items-center gap-2">
            {isSearching && (
              <div className="w-2 h-2 rounded-full animate-pulse dot-gradient" />
            )}
            {showUsers && (
              <Badge variant="accent">
                {nearbyUsers.length} {nearbyUsers.length === 1 ? "user" : "users"}
              </Badge>
            )}
            {showPlaces && nearbyPlaces.length > 0 && (
              <Badge variant="default">
                {nearbyPlaces.length} {nearbyPlaces.length === 1 ? "place" : "places"}
              </Badge>
            )}
          </div>
        </div>

        {/* Filter segment control */}
        <div className="flex justify-center px-4 pb-1">
          <div className="pointer-events-auto inline-flex gap-1 bg-pnp-surface/80 backdrop-blur-md rounded-xl p-1 border border-white/5">
            {(
              [
                { key: "all", label: "All" },
                { key: "users", label: "Users" },
                { key: "places", label: "Places" },
              ] as const
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
      </div>

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

            {/* No results card */}
            {!isSearching && nearbyUsers.length === 0 && nearbyPlaces.length === 0 && (
              <div className="mb-3 bg-pnp-surface/80 backdrop-blur-md rounded-xl p-3 border border-white/5">
                <div className="flex items-center gap-3">
                  <svg className="w-8 h-8 text-pnp-textSecondary flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  <div>
                    <p className="text-sm font-medium text-pnp-textPrimary">Nothing nearby yet</p>
                    <p className="text-xs text-pnp-textSecondary">Try increasing the search radius</p>
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
                    {r}km
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
                title={incognito ? "Incognito ON — your location is hidden" : "Incognito OFF — you are visible"}
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
