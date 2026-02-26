import React, { useState, useEffect, useRef, useCallback } from "react";
import { Card, Badge, Button } from "@pnptv/ui-kit";
import {
  updateNearbyLocation,
  searchNearby,
  type NearbyUser,
} from "@/lib/api";
import { MapContainer, TileLayer, Marker, Popup, Circle, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const RADIUS_OPTIONS = [1, 5, 10, 25];
const REFRESH_INTERVAL = 30_000;

// Custom amber marker icon using inline SVG
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

// Component that moves map to new center when position changes
function MapRecenter({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView([lat, lng], map.getZoom());
  }, [lat, lng, map]);
  return null;
}

type PageState = "loading" | "denied" | "ready";

export default function Booking() {
  const [pageState, setPageState] = useState<PageState>("loading");
  const [myPos, setMyPos] = useState<{ lat: number; lng: number } | null>(null);
  const [nearbyUsers, setNearbyUsers] = useState<NearbyUser[]>([]);
  const [radius, setRadius] = useState(5);
  const [incognito, setIncognito] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const refreshRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const userIconRef = useRef(createUserIcon());
  const myIconRef = useRef(createMyIcon());

  // Fetch nearby users
  const fetchNearby = useCallback(
    async (lat: number, lng: number, rad: number) => {
      try {
        setIsSearching(true);
        const data = await searchNearby(lat, lng, rad, 50);
        setNearbyUsers(data.users || []);
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
        fetchNearby(latitude, longitude, radius);
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
  }, [sendLocation, fetchNearby, radius]);

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

  // Format distance
  const formatDist = (u: NearbyUser) => {
    if (u.distance_m !== undefined && u.distance_m < 1000) {
      return `${Math.round(u.distance_m)}m`;
    }
    if (u.distance_km !== undefined) {
      return `${u.distance_km.toFixed(1)}km`;
    }
    return "nearby";
  };

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
      {/* Map */}
      {myPos && (
        <div className="absolute inset-0">
          <style>{`
            .leaflet-tile-pane { filter: invert(100%) hue-rotate(180deg) brightness(0.95) contrast(0.9); }
            .leaflet-container { background: #1C1C1E; }
            .leaflet-control-zoom a { background: #2C2C2E !important; color: #FFB454 !important; border-color: #3C3C3E !important; }
            .leaflet-control-attribution { display: none !important; }
            .nearby-popup .leaflet-popup-content-wrapper { background: rgba(44,44,46,0.95); backdrop-filter: blur(12px); border: 1px solid rgba(255,180,84,0.2); border-radius: 12px; color: #fff; }
            .nearby-popup .leaflet-popup-tip { background: rgba(44,44,46,0.95); }
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
            <Marker position={[myPos.lat, myPos.lng]} icon={myIconRef.current}>
              <Popup className="nearby-popup">
                <div className="text-center p-1">
                  <p className="font-medium text-sm">You are here</p>
                </div>
              </Popup>
            </Marker>

            {/* Nearby users */}
            {nearbyUsers.map((u) => (
              <Marker
                key={u.user_id}
                position={[u.latitude, u.longitude]}
                icon={userIconRef.current}
              >
                <Popup className="nearby-popup">
                  <div className="p-1 min-w-[140px]">
                    <p className="font-medium text-sm" style={{ color: "#FFB454" }}>
                      {u.name || u.username || `User #${u.user_id}`}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: "#ffffffaa" }}>
                      {formatDist(u)} away
                    </p>
                    {u.username && (
                      <p className="text-xs mt-1" style={{ color: "#ffffff80" }}>
                        @{u.username}
                      </p>
                    )}
                  </div>
                </Popup>
              </Marker>
            ))}
          </MapContainer>
        </div>
      )}

      {/* Top overlay — title + badge */}
      <div className="absolute top-0 left-0 right-0 z-[1000] pointer-events-none">
        <div className="flex items-center justify-between px-4 pt-3 pb-2">
          <div className="pointer-events-auto bg-pnp-surface/80 backdrop-blur-md rounded-xl px-3 py-1.5 border border-white/5">
            <h1 className="text-sm font-bold text-pnp-textPrimary">Nearby</h1>
          </div>
          <div className="pointer-events-auto flex items-center gap-2">
            {isSearching && (
              <div className="w-2 h-2 rounded-full animate-pulse dot-gradient" />
            )}
            <Badge variant="accent">
              {nearbyUsers.length} {nearbyUsers.length === 1 ? "user" : "users"}
            </Badge>
          </div>
        </div>
      </div>

      {/* Bottom overlay — controls */}
      <div className="absolute bottom-0 left-0 right-0 z-[1000] pointer-events-none">
        <div className="px-4 pb-4 pt-2 pointer-events-auto">
          {/* Error banner */}
          {error && (
            <div className="mb-2 bg-red-900/50 backdrop-blur-md rounded-lg px-3 py-2 text-xs text-red-300 border border-red-500/20">
              {error}
            </div>
          )}

          {/* No users card */}
          {!isSearching && nearbyUsers.length === 0 && (
            <Card className="mb-3 !bg-pnp-surface/80 backdrop-blur-md border border-white/5">
              <div className="flex items-center gap-3 p-1">
                <svg className="w-8 h-8 text-pnp-textSecondary flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <div>
                  <p className="text-sm font-medium text-pnp-textPrimary">No one nearby yet</p>
                  <p className="text-xs text-pnp-textSecondary">Try increasing the search radius</p>
                </div>
              </div>
            </Card>
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
    </div>
  );
}
