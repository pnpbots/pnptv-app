import React, { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useNearbyToggle, getTier, toggleNearby } from "@/components/NearbyBadge";
import {
  searchNearby,
  searchNearbyPlaces,
  getPublicProfile,
  getOrCreateDmRoom,
  type NearbyUser,
  type NearbyPlace,
} from "@/lib/api";
import { useRoomMessages, sendMatrixMessage } from "@/hooks/useMatrix";
import type { UserProfile } from "@/lib/api";

// ── Lemon-yellow constants ──────────────────────────────────────────────────
const LEMON = "#FBFF00";
const GRID_SIZE = 9;
const MAX_USERS = 45;
const PINK = "#D4007A";

interface NearbyMember {
  user_id: number;
  username?: string | null;
  name?: string | null;
  photo_url?: string | null;
  distance_km: number;
}

// Grid item is either a user or a place
type GridItem =
  | { kind: "user"; data: NearbyMember }
  | { kind: "place"; data: NearbyPlace };

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

// ── DM chat sub-view ─────────────────────────────────────────────────────────

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
                  style={{
                    background: isMe ? PINK : "rgba(255,255,255,0.10)",
                  }}
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

// ── Nearby 3×3 Grid Widget ──────────────────────────────────────────────────

type WidgetView = "grid" | "profile" | "dm" | "place";

export function NearbyWidget() {
  const { enabled, position } = useNearbyToggle();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [members, setMembers] = useState<NearbyMember[]>([]);
  const [places, setPlaces] = useState<NearbyPlace[]>([]);
  const [loading, setLoading] = useState(false);

  // Sub-view state
  const [view, setView] = useState<WidgetView>("grid");
  const [selectedUser, setSelectedUser] = useState<NearbyMember | null>(null);
  const [selectedPlace, setSelectedPlace] = useState<NearbyPlace | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);

  // DM state
  const [dmRoomId, setDmRoomId] = useState<string | null>(null);
  const [dmLoading, setDmLoading] = useState(false);
  const [dmError, setDmError] = useState<string | null>(null);

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

  const closeModal = useCallback(() => {
    setOpen(false);
    setView("grid");
    setSelectedUser(null);
    setSelectedPlace(null);
    setProfile(null);
    setDmRoomId(null);
    setDmError(null);
  }, []);

  // Fetch nearby users + places when panel opens
  useEffect(() => {
    if (!open || !enabled || !position) return;
    let cancelled = false;
    setLoading(true);

    Promise.all([
      searchNearby(position.lat, position.lng, 20000, MAX_USERS).catch(() => null),
      searchNearbyPlaces(position.lat, position.lng, 20).catch(() => null),
    ]).then(([usersRes, placesRes]) => {
      if (cancelled) return;
      if (usersRes?.success && usersRes.users) {
        const sorted = usersRes.users
          .filter((u) => u.distance_km != null)
          .sort((a, b) => (a.distance_km ?? 9999) - (b.distance_km ?? 9999))
          .slice(0, MAX_USERS) as NearbyMember[];
        setMembers(sorted);
      }
      if (placesRes?.success && placesRes.places) {
        setPlaces(placesRes.places.slice(0, 12));
      }
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });

    return () => { cancelled = true; };
  }, [open, enabled, position?.lat, position?.lng]);

  // Build interleaved grid: users and places mixed, sorted by distance
  const gridItems: GridItem[] = React.useMemo(() => {
    const userItems: GridItem[] = members.map((u) => ({ kind: "user", data: u }));
    const placeItems: GridItem[] = places.map((p) => ({ kind: "place", data: p }));
    // Interleave: 2 users, 1 place, repeat
    const result: GridItem[] = [];
    let ui = 0;
    let pi = 0;
    while (result.length < GRID_SIZE && (ui < userItems.length || pi < placeItems.length)) {
      if (ui < userItems.length) result.push(userItems[ui++]);
      if (result.length < GRID_SIZE && ui < userItems.length) result.push(userItems[ui++]);
      if (result.length < GRID_SIZE && pi < placeItems.length) result.push(placeItems[pi++]);
    }
    return result.slice(0, GRID_SIZE);
  }, [members, places]);

  // Open user profile
  const openUserProfile = useCallback(async (member: NearbyMember) => {
    setSelectedUser(member);
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
  }, []);

  // Open DM room
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

  // FAB stagger
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

  // ── Render ─────────────────────────────────────────────────────────────────

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
          {totalCount > 0 && (
            <span
              className="absolute -top-1 -right-1 min-w-[18px] h-[18px] flex items-center justify-center rounded-full text-[9px] font-bold px-1"
              style={{ background: PINK, color: "#fff" }}
            >
              {totalCount}
            </span>
          )}
        </button>
      </div>

      {/* Modal Overlay */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={closeModal}
        >
          {/* Backdrop */}
          <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(6px)" }} />

          {/* Modal */}
          <div
            className="relative w-full max-w-[380px] rounded-2xl overflow-hidden animate-fade-in-up flex flex-col"
            style={{ background: "#1C1C1E", border: `1px solid rgba(251,255,0,0.20)`, maxHeight: "85vh" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* ── GRID VIEW ──────────────────────────────────────────────── */}
            {view === "grid" && (
              <>
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b flex-shrink-0" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
                  <div className="flex items-center gap-2">
                    <span className="text-base">📍</span>
                    <h3 className="text-sm font-bold" style={{ color: LEMON }}>Nearby</h3>
                    {totalCount > 0 && (
                      <span className="text-[10px] font-medium" style={{ color: "rgba(251,255,0,0.6)" }}>
                        {members.length} people · {places.length} places
                      </span>
                    )}
                  </div>
                  <button
                    onClick={closeModal}
                    className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="#8E8E93" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                {/* Grid content */}
                <div className="p-3 overflow-y-auto">
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
                  ) : gridItems.length === 0 ? (
                    <div className="text-center py-12">
                      <p className="text-sm" style={{ color: "#8E8E93" }}>No nearby people or places found</p>
                      <p className="text-xs mt-1" style={{ color: "#8E8E9366" }}>Keep your location on to discover others</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 gap-2">
                      {gridItems.map((item, idx) => {
                        if (item.kind === "user") {
                          const m = item.data;
                          const tier = getTier(m.distance_km);
                          const distLabel = m.distance_km < 1
                            ? `${Math.round(m.distance_km * 1000)}m`
                            : `${Math.round(m.distance_km)}km`;
                          const displayName = m.name || m.username || "Anonymous";
                          const initial = displayName[0]?.toUpperCase() || "?";

                          return (
                            <button
                              key={`user-${m.user_id}`}
                              onClick={() => openUserProfile(m)}
                              className="w-full rounded-xl overflow-hidden hover:ring-1 hover:ring-white/20 active:scale-[0.97] transition-all"
                              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}
                            >
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
                                <span className="absolute bottom-0.5 left-0.5 text-xs drop-shadow-lg">
                                  {tier.emoji}
                                </span>
                              </div>
                              <div className="px-1.5 py-1.5">
                                <p className="text-[10px] font-bold text-white truncate leading-tight">{displayName}</p>
                                <p className="text-[8px] truncate leading-tight mt-0.5" style={{ color: "#8E8E93" }}>
                                  {distLabel} · {tier.short}
                                </p>
                              </div>
                            </button>
                          );
                        }

                        // Place card
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
                                    el.nextElementSibling?.removeAttribute("style");
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
                              {/* Place badge */}
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
              </>
            )}

            {/* ── PROFILE VIEW ───────────────────────────────────────────── */}
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
                  <span className="text-sm font-bold flex-1" style={{ color: LEMON }}>Nearby</span>
                  <button
                    onClick={closeModal}
                    className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-white/10 transition-colors"
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
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = "none";
                            }}
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
                        <p className="text-sm text-white/70 max-w-[260px] leading-relaxed">
                          {profile.bio}
                        </p>
                      )}

                      {/* Location text */}
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
              </>
            )}

            {/* ── DM VIEW ────────────────────────────────────────────────── */}
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

            {/* ── PLACE VIEW ─────────────────────────────────────────────── */}
            {view === "place" && selectedPlace && (
              <>
                {/* Header */}
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
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="#8E8E93" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                <div className="overflow-y-auto flex-1">
                  {/* Photo / gradient banner */}
                  <div className="relative w-full h-36 overflow-hidden flex-shrink-0">
                    {selectedPlace.photoUrl ? (
                      <img
                        src={selectedPlace.photoUrl}
                        alt={selectedPlace.name}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = "none";
                        }}
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
                    {/* Name */}
                    <h3 className="text-lg font-bold text-white">{selectedPlace.name}</h3>

                    {/* Category + distance */}
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

                    {/* Description */}
                    {selectedPlace.description && (
                      <p className="text-sm text-white/70 leading-relaxed">{selectedPlace.description}</p>
                    )}

                    {/* Details */}
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
