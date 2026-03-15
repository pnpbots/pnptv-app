import React, { useState, useEffect, useCallback, useSyncExternalStore } from "react";
import { updateNearbyLocation, searchNearby, type NearbyUser } from "@/lib/api";

// ── Distance tier config ────────────────────────────────────────────────────
export const NEARBY_TIERS = [
  { maxKm: 1,        emoji: "🔥", short: "Right next door",   full: "You could be clouding together in minutes." },
  { maxKm: 5,        emoji: "💨", short: "So close",          full: "You could be clouding together tonight." },
  { maxKm: 25,       emoji: "😈", short: "Perfect distance",  full: "Future PNPtv weekend buddies." },
  { maxKm: 50,       emoji: "🚗", short: "Not far at all",    full: "Worth the ride for a proper cloud session." },
  { maxKm: 100,      emoji: "🌙", short: "A little trip",     full: "Plan a weekend spin-together." },
  { maxKm: 300,      emoji: "✈️", short: "Same region",       full: "Road trip or Hangouts tonight." },
  { maxKm: 1000,     emoji: "🌎", short: "Far but fun",       full: "Perfect excuse for a Hangouts cloud session." },
  { maxKm: Infinity, emoji: "☁️", short: "A flight away",     full: "But you can always get spun together at Hangouts" },
] as const;

export function getTier(distanceKm: number) {
  return NEARBY_TIERS.find((t) => distanceKm <= t.maxKm) ?? NEARBY_TIERS[NEARBY_TIERS.length - 1];
}

// ── Lemon-yellow style constants ────────────────────────────────────────────
const LEMON = "#FBFF00";
const LEMON_BG = "rgba(251,255,0,0.10)";
const LEMON_BORDER = "rgba(251,255,0,0.25)";

// ── Shared geolocation toggle (module-level singleton) ──────────────────────
const TOGGLE_KEY = "pnptv:nearbyEnabled";
const POS_KEY = "pnptv:nearbyPos";

type NearbyState = {
  enabled: boolean;
  position: { lat: number; lng: number } | null;
  distanceMap: Map<string, number>;
};

let state: NearbyState = {
  enabled: localStorage.getItem(TOGGLE_KEY) === "1",
  position: (() => {
    try { const p = JSON.parse(localStorage.getItem(POS_KEY) || ""); return p?.lat ? p : null; } catch { return null; }
  })(),
  distanceMap: new Map(),
};

let watchId: number | null = null;
let updateTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function emit() { listeners.forEach((l) => l()); }

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

function getSnapshot() { return state; }

function startWatch() {
  if (watchId !== null) return;
  if (!navigator.geolocation) return;
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const { latitude: lat, longitude: lng, accuracy } = pos.coords;
      state = { ...state, position: { lat, lng } };
      localStorage.setItem(POS_KEY, JSON.stringify({ lat, lng }));
      emit();
      // Debounce backend updates to 6s
      if (updateTimer) clearTimeout(updateTimer);
      updateTimer = setTimeout(() => {
        updateNearbyLocation(lat, lng, accuracy).catch(() => {});
      }, 6000);
    },
    () => {},
    { enableHighAccuracy: false, maximumAge: 30000, timeout: 15000 }
  );
}

function stopWatch() {
  if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
  if (updateTimer) { clearTimeout(updateTimer); updateTimer = null; }
}

export function toggleNearby() {
  const next = !state.enabled;
  state = { ...state, enabled: next };
  localStorage.setItem(TOGGLE_KEY, next ? "1" : "0");
  if (next) { startWatch(); } else { stopWatch(); state = { ...state, position: null, distanceMap: new Map() }; localStorage.removeItem(POS_KEY); }
  emit();
}

export function setDistanceMap(map: Map<string, number>) {
  state = { ...state, distanceMap: map };
  emit();
}

// Auto-start if previously enabled
if (state.enabled) startWatch();

// ── Hook ────────────────────────────────────────────────────────────────────
export function useNearbyToggle() {
  const s = useSyncExternalStore(subscribe, getSnapshot);
  return { enabled: s.enabled, position: s.position, distanceMap: s.distanceMap, toggle: toggleNearby };
}

// ── Bulk distance fetcher hook (for feeds) ──────────────────────────────────
export function useNearbyDistances(authorIds: string[]) {
  const { enabled, position } = useNearbyToggle();
  const [distances, setDistances] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    if (!enabled || !position || authorIds.length === 0) { setDistances(new Map()); return; }
    let cancelled = false;
    searchNearby(position.lat, position.lng, 20000, 200).then((res) => {
      if (cancelled || !res.success || !res.users) return;
      const map = new Map<string, number>();
      for (const u of res.users) {
        if (u.distance_km != null) map.set(String(u.user_id), u.distance_km);
      }
      setDistances(map);
      setDistanceMap(map);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [enabled, position?.lat, position?.lng, authorIds.length]);

  return distances;
}

// ── NearbyBadge Component ───────────────────────────────────────────────────
interface NearbyBadgeProps {
  distanceKm?: number | null;
  variant?: "compact" | "detailed";
}

export function NearbyBadge({ distanceKm, variant = "compact" }: NearbyBadgeProps) {
  if (distanceKm == null) return null;
  const tier = getTier(distanceKm);
  const distLabel = distanceKm < 1 ? `${Math.round(distanceKm * 1000)}m` : `${Math.round(distanceKm)}km`;

  if (variant === "detailed") {
    return (
      <div className="mt-1">
        <span
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold"
          style={{ background: LEMON_BG, color: LEMON, border: `1px solid ${LEMON_BORDER}` }}
        >
          {tier.emoji} {tier.short} · {distLabel}
        </span>
        <p className="text-[10px] mt-0.5 ml-1" style={{ color: `${LEMON}99` }}>
          {tier.full}
        </p>
      </div>
    );
  }

  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold flex-shrink-0"
      style={{ background: LEMON_BG, color: LEMON, border: `1px solid ${LEMON_BORDER}` }}
    >
      {tier.emoji} {tier.short} · {distLabel}
    </span>
  );
}
