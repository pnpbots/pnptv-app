import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useNearbyToggle, getTier, NearbyBadge } from "@/components/NearbyBadge";
import { searchNearby, type NearbyUser } from "@/lib/api";

// ── Lemon-yellow constants ──────────────────────────────────────────────────
const LEMON = "#FBFF00";
const LEMON_BG = "rgba(251,255,0,0.12)";
const LEMON_BORDER = "rgba(251,255,0,0.30)";

const PAGE_SIZE = 9;
const MAX_USERS = 45;

interface NearbyMember {
  user_id: string;
  username?: string | null;
  name?: string | null;
  photo_url?: string | null;
  distance_km: number;
}

// ── Hangouts Floating Action Button + Bottom Sheet ──────────────────────────

export function NearbyWidget() {
  const { enabled, position } = useNearbyToggle();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [members, setMembers] = useState<NearbyMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);

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

  // Reset page when closing
  useEffect(() => { if (!open) setPage(1); }, [open]);

  if (!enabled || !position) return null;

  const visibleMembers = members.slice(0, page * PAGE_SIZE);
  const hasMore = members.length > visibleMembers.length;

  return (
    <>
      {/* FAB */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-20 right-4 z-40 w-14 h-14 rounded-full flex items-center justify-center shadow-lg transition-transform active:scale-90"
        style={{
          background: LEMON,
          boxShadow: `0 4px 20px ${LEMON}40`,
        }}
        aria-label="Nearby members"
      >
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="#0a0a14" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
        </svg>
        {members.length > 0 && (
          <span
            className="absolute -top-1 -right-1 min-w-[20px] h-5 flex items-center justify-center rounded-full text-[10px] font-bold px-1"
            style={{ background: "#D4007A", color: "#fff" }}
          >
            {members.length}
          </span>
        )}
      </button>

      {/* Bottom Sheet Overlay */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center"
          onClick={() => setOpen(false)}
        >
          {/* Backdrop */}
          <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }} />

          {/* Sheet */}
          <div
            className="relative w-full max-w-lg rounded-t-2xl overflow-hidden animate-slide-up"
            style={{ background: "#1C1C1E", border: `1px solid ${LEMON_BORDER}`, borderBottom: "none", maxHeight: "70vh" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
              <div className="flex items-center gap-2">
                <span className="text-lg">📍</span>
                <h3 className="text-base font-bold" style={{ color: LEMON }}>Nearby Members</h3>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="#8E8E93" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Content */}
            <div className="overflow-y-auto p-4 space-y-2" style={{ maxHeight: "calc(70vh - 64px)" }}>
              {loading ? (
                <div className="flex items-center justify-center py-10">
                  <div className="w-6 h-6 border-2 rounded-full animate-spin" style={{ borderColor: `${LEMON}30`, borderTopColor: LEMON }} />
                </div>
              ) : members.length === 0 ? (
                <div className="text-center py-10">
                  <p className="text-sm" style={{ color: "#8E8E93" }}>No nearby members found yet</p>
                  <p className="text-xs mt-1" style={{ color: "#8E8E9366" }}>Keep your location on to discover others</p>
                </div>
              ) : (
                <>
                  {visibleMembers.map((m) => {
                    const tier = getTier(m.distance_km);
                    const distLabel = m.distance_km < 1 ? `${Math.round(m.distance_km * 1000)}m` : `${Math.round(m.distance_km)}km`;
                    const displayName = m.name || m.username || "Anonymous";
                    const initial = displayName[0]?.toUpperCase() || "?";

                    return (
                      <button
                        key={m.user_id}
                        onClick={() => { setOpen(false); navigate(`/profile/${m.user_id}`); }}
                        className="w-full flex items-center gap-3 p-3 rounded-xl transition-colors hover:bg-white/5 active:bg-white/10"
                        style={{ border: `1px solid rgba(255,255,255,0.06)` }}
                      >
                        {/* Avatar */}
                        {m.photo_url ? (
                          <img
                            src={m.photo_url}
                            alt={displayName}
                            className="w-10 h-10 rounded-full object-cover flex-shrink-0"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; (e.target as HTMLImageElement).nextElementSibling?.removeAttribute("style"); }}
                          />
                        ) : null}
                        <div
                          className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
                          style={{
                            background: "linear-gradient(135deg, #D4007A, #E69138)",
                            color: "#fff",
                            display: m.photo_url ? "none" : undefined,
                          }}
                        >
                          {initial}
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0 text-left">
                          <p className="text-sm font-semibold text-white truncate">{displayName}</p>
                          {m.username && (
                            <p className="text-[10px] truncate" style={{ color: "#8E8E93" }}>@{m.username}</p>
                          )}
                        </div>

                        {/* Distance pill */}
                        <span
                          className="flex-shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-semibold"
                          style={{ background: LEMON_BG, color: LEMON, border: `1px solid ${LEMON_BORDER}` }}
                        >
                          {tier.emoji} {distLabel}
                        </span>
                      </button>
                    );
                  })}

                  {/* Load more */}
                  {hasMore && (
                    <button
                      onClick={() => setPage((p) => p + 1)}
                      className="w-full py-3 rounded-xl text-sm font-semibold transition-colors hover:bg-white/5"
                      style={{ color: LEMON, border: `1px dashed ${LEMON_BORDER}` }}
                    >
                      Load More ({members.length - visibleMembers.length} remaining)
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Slide-up animation */}
      <style>{`
        @keyframes slide-up { from { transform: translateY(100%); } to { transform: translateY(0); } }
        .animate-slide-up { animation: slide-up 0.3s cubic-bezier(0.22, 1, 0.36, 1) both; }
      `}</style>
    </>
  );
}
