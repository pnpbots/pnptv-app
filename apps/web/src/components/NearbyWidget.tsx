import React, { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useNearbyToggle, getTier, toggleNearby } from "@/components/NearbyBadge";
import { searchNearby, type NearbyUser } from "@/lib/api";

// ── Lemon-yellow constants ──────────────────────────────────────────────────
const LEMON = "#FBFF00";
const GRID_SIZE = 9;
const MAX_USERS = 45;

interface NearbyMember {
  user_id: number;
  username?: string | null;
  name?: string | null;
  photo_url?: string | null;
  distance_km: number;
}

// ── Shared stagger helper (all 3 widgets share these keys) ──────────────────
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

// ── Nearby 3×3 Grid Widget ──────────────────────────────────────────────────

export function NearbyWidget() {
  const { enabled, position } = useNearbyToggle();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [members, setMembers] = useState<NearbyMember[]>([]);
  const [loading, setLoading] = useState(false);

  // FAB corner: tl/tr/bl/br — draggable to any corner
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
    const isLeft = e.clientX < window.innerWidth / 2;
    const isTop = e.clientY < window.innerHeight / 2;
    const newCorner: Corner = isTop ? (isLeft ? "tl" : "tr") : (isLeft ? "bl" : "br");
    setFabCorner(newCorner);
    try { localStorage.setItem("nearby_fab_corner", newCorner); } catch {}
  }, []);

  // Fetch nearby users when panel opens
  useEffect(() => {
    if (!open || !enabled || !position) return;
    let cancelled = false;
    setLoading(true);
    searchNearby(position.lat, position.lng, 20000, MAX_USERS)
      .then((res) => {
        if (cancelled) return;
        if (res.success && res.users) {
          const sorted = res.users
            .filter((u) => u.distance_km != null)
            .sort((a, b) => (a.distance_km ?? 9999) - (b.distance_km ?? 9999))
            .slice(0, MAX_USERS) as NearbyMember[];
          setMembers(sorted);
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, enabled, position?.lat, position?.lng]);

  const gridMembers = members.slice(0, GRID_SIZE);

  // Compute stagger offset so FABs in the same corner don't overlap
  const MY_ORDER = 1;
  const offset = getCornerOffset(MY_ORDER, fabCorner);
  const isTop = fabCorner.startsWith("t");
  const isLeft = fabCorner.endsWith("l");
  const posStyle = {
    [isTop ? "top" : "bottom"]: `calc(5rem + ${offset * 56}px)`,
    [isLeft ? "left" : "right"]: "0.75rem",
    touchAction: "none" as const,
  };

  return (
    <>
      {/* FAB — draggable to any corner */}
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
          className="w-12 h-12 rounded-full flex items-center justify-center shadow-lg transition-transform active:scale-90"
          style={{
            background: LEMON,
            boxShadow: `0 4px 20px ${LEMON}40`,
          }}
          aria-label="Nearby members"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="#0a0a14" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
          </svg>
          {members.length > 0 && (
            <span
              className="absolute -top-1 -right-1 min-w-[18px] h-[18px] flex items-center justify-center rounded-full text-[9px] font-bold px-1"
              style={{ background: "#D4007A", color: "#fff" }}
            >
              {members.length}
            </span>
          )}
        </button>
      </div>

      {/* Modal Overlay — 3×3 Grid */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={() => setOpen(false)}
        >
          {/* Backdrop */}
          <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(6px)" }} />

          {/* Modal */}
          <div
            className="relative w-full max-w-[380px] rounded-2xl overflow-hidden animate-fade-in-up"
            style={{ background: "#1C1C1E", border: "1px solid rgba(251,255,0,0.20)" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
              <div className="flex items-center gap-2">
                <span className="text-base">📍</span>
                <h3 className="text-sm font-bold" style={{ color: LEMON }}>Nearby</h3>
                {members.length > 0 && (
                  <span className="text-[10px] font-medium" style={{ color: "rgba(251,255,0,0.6)" }}>
                    {members.length} found
                  </span>
                )}
              </div>
              <button
                onClick={() => setOpen(false)}
                className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="#8E8E93" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Grid content */}
            <div className="p-3">
              {!enabled || !position ? (
                <div className="text-center py-12 px-4">
                  <div className="text-3xl mb-3">📍</div>
                  <p className="text-sm font-semibold" style={{ color: LEMON }}>
                    {!enabled ? "Nearby is off" : "Waiting for location..."}
                  </p>
                  <p className="text-xs mt-2" style={{ color: "#8E8E93" }}>
                    {!enabled
                      ? "Turn on location access to discover members near you"
                      : "Your browser is requesting location — please allow access if prompted"}
                  </p>
                  {!enabled ? (
                    <button
                      onClick={() => toggleNearby()}
                      className="mt-4 px-5 py-2 rounded-full text-sm font-bold transition-all active:scale-95 hover:brightness-110"
                      style={{ background: LEMON, color: "#0a0a14" }}
                    >
                      Enable Location
                    </button>
                  ) : (
                    <div className="mt-4 flex items-center justify-center gap-2">
                      <div className="w-4 h-4 border-2 rounded-full animate-spin" style={{ borderColor: `${LEMON}30`, borderTopColor: LEMON }} />
                      <span className="text-xs" style={{ color: "#8E8E9399" }}>Acquiring GPS...</span>
                    </div>
                  )}
                </div>
              ) : loading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="w-6 h-6 border-2 rounded-full animate-spin" style={{ borderColor: `${LEMON}30`, borderTopColor: LEMON }} />
                </div>
              ) : gridMembers.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-sm" style={{ color: "#8E8E93" }}>No nearby members found</p>
                  <p className="text-xs mt-1" style={{ color: "#8E8E9366" }}>Keep your location on to discover others</p>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {gridMembers.map((m) => {
                    const tier = getTier(m.distance_km);
                    const distLabel = m.distance_km < 1
                      ? `${Math.round(m.distance_km * 1000)}m`
                      : `${Math.round(m.distance_km)}km`;
                    const displayName = m.name || m.username || "Anonymous";
                    const initial = displayName[0]?.toUpperCase() || "?";

                    return (
                      <button
                        key={m.user_id}
                        onClick={() => { setOpen(false); navigate(`/profile/${m.user_id}`); }}
                        className="w-full rounded-xl overflow-hidden hover:ring-1 hover:ring-white/20 active:scale-[0.97] transition-all"
                        style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}
                      >
                        {/* Cover — avatar or gradient fallback */}
                        <div className="relative h-16 w-full">
                          {m.photo_url ? (
                            <img
                              src={m.photo_url}
                              alt={displayName}
                              className="w-full h-full object-cover"
                              onError={(e) => {
                                const el = e.target as HTMLImageElement;
                                el.style.display = "none";
                                el.nextElementSibling?.removeAttribute("style");
                              }}
                            />
                          ) : null}
                          <div
                            className="absolute inset-0 flex items-center justify-center text-lg font-bold"
                            style={{
                              background: "linear-gradient(135deg, #D4007A, #E69138)",
                              color: "#fff",
                              display: m.photo_url ? "none" : undefined,
                            }}
                          >
                            {initial}
                          </div>
                          {/* Distance tier emoji badge */}
                          <span className="absolute bottom-0.5 left-0.5 text-xs drop-shadow-lg">
                            {tier.emoji}
                          </span>
                        </div>

                        {/* Info */}
                        <div className="px-1.5 py-1.5">
                          <p className="text-[10px] font-bold text-white truncate leading-tight">{displayName}</p>
                          <p className="text-[8px] truncate leading-tight mt-0.5" style={{ color: "#8E8E93" }}>
                            {distLabel} · {tier.short}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
