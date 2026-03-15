import React, { useState, useRef, useCallback, useEffect } from "react";
import { useMusicPlayer } from "@/hooks/useMusicPlayer";
import { resolveSoundCloud, importSoundCloud, requestSoundCloud, getRadioRequests, updateRadioRequest, type MediaTrack, type RadioRequest } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";

// ── Helpers ───────────────────────────────────────────────────────────────────

function SoundCloudIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M11.56 17H19c2.21 0 4-1.79 4-4s-1.79-4-4-4c-.11 0-.21 0-.32.02C17.82 7.16 16.06 6 14 6c-.26 0-.51.02-.75.07C12.58 4.39 10.93 3 8.89 3c-2.32 0-4.28 1.71-4.63 3.96C1.91 7.28 0 9.38 0 12c0 2.1 1.27 3.91 3.1 4.68.03.01.05.02.08.02h8.38v.3c0 .17.13.3.3.3s.3-.13.3-.3V17z" />
    </svg>
  );
}

function formatTime(s: number): string {
  if (!s || !isFinite(s)) return "0:00";
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

function getArtistName(artist: { name: string } | string | undefined): string {
  if (!artist) return "";
  return typeof artist === "string" ? artist : artist.name;
}

// ── Inline SVG icon components ────────────────────────────────────────────────

function RadioIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 6h-2.18c.07-.31.18-.62.18-.94C18 3.37 16.63 2 14.94 2c-.87 0-1.65.36-2.22.94L12 3.66l-.72-.72C10.71 2.36 9.93 2 9.06 2 7.37 2 6 3.37 6 5.06c0 .32.1.63.18.94H4c-1.1 0-2 .9-2 2v11c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zM14.94 4c.59 0 1.06.47 1.06 1.06 0 .59-.47 1.06-1.06 1.06-.59 0-1.06-.47-1.06-1.06C13.88 4.47 14.35 4 14.94 4zM9.06 4c.59 0 1.06.47 1.06 1.06 0 .59-.47 1.06-1.06 1.06C8.47 6.12 8 5.65 8 5.06 8 4.47 8.47 4 9.06 4zM20 19H4V8h16v11zm-8-2c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0-6c1.1 0 2 .9 2 2s-.9 2-2 2-2-.9-2-2 .9-2 2-2z" />
    </svg>
  );
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

function ShuffleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z" />
    </svg>
  );
}

function PrevIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
    </svg>
  );
}

function NextIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
    </svg>
  );
}

function RepeatIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z" />
    </svg>
  );
}

function PlayIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function PauseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
    </svg>
  );
}

function VolumeIcon({ level, className }: { level: number; className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      {level === 0 ? (
        <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.796 8.796 0 0021 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 003.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" />
      ) : level < 0.5 ? (
        <path d="M18.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z" />
      ) : (
        <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
      )}
    </svg>
  );
}

function MusicNoteIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
    </svg>
  );
}

function AlertTriangleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
    </svg>
  );
}

// ── Equalizer bars (animated) ─────────────────────────────────────────────────
// These live inside the FAB when playing, and on active playlist rows.

function EqualizerBars({ color = "#fff", size = "sm" }: { color?: string; size?: "sm" | "xs" }) {
  const h = size === "xs" ? { a: "8px", b: "12px", c: "6px" } : { a: "10px", b: "16px", c: "8px" };
  const w = size === "xs" ? "w-px" : "w-0.5";
  return (
    <div className="flex gap-px items-end" style={{ height: size === "xs" ? "12px" : "16px" }} aria-hidden="true">
      <span
        className={`${w} rounded-full radio-eq-bar-1`}
        style={{ height: h.a, backgroundColor: color, transformOrigin: "bottom" }}
      />
      <span
        className={`${w} rounded-full radio-eq-bar-2`}
        style={{ height: h.b, backgroundColor: color, transformOrigin: "bottom" }}
      />
      <span
        className={`${w} rounded-full radio-eq-bar-3`}
        style={{ height: h.c, backgroundColor: color, transformOrigin: "bottom" }}
      />
    </div>
  );
}

// ── Playlist row ──────────────────────────────────────────────────────────────

interface PlaylistRowProps {
  track: MediaTrack;
  isActive: boolean;
  isPlaying: boolean;
  onPlay: (track: MediaTrack) => void;
}

const PlaylistRow = React.memo(function PlaylistRow({ track, isActive, isPlaying, onPlay }: PlaylistRowProps) {
  const artistName = getArtistName(track.artist);
  return (
    <button
      onClick={() => onPlay(track)}
      className={[
        "w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors",
        "hover:bg-white/5 active:bg-white/10",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-purple-400/60",
        isActive ? "bg-white/8" : "",
      ].join(" ")}
      aria-label={`Play ${track.title}`}
      aria-current={isActive ? "true" : undefined}
    >
      {/* Art or placeholder */}
      <div className="w-8 h-8 rounded flex-shrink-0 overflow-hidden">
        {track.art ? (
          <img src={track.art} alt="" className="w-full h-full object-cover" style={{ pointerEvents: "none" }} />
        ) : (
          <div
            className="w-full h-full flex items-center justify-center"
            style={{ background: "linear-gradient(135deg, rgba(139,92,246,0.35), rgba(217,70,239,0.35))" }}
          >
            <span style={{ color: "rgba(217,70,239,0.9)" }}><MusicNoteIcon className="w-3.5 h-3.5" /></span>
          </div>
        )}
      </div>

      {/* Title + artist */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p
            className={[
              "text-xs truncate leading-tight",
              isActive ? "font-semibold" : "text-pnp-textPrimary",
            ].join(" ")}
            style={isActive ? { color: "#D946EF" } : undefined}
          >
            {track.title}
          </p>
          {track.provider === "soundcloud" && (
            <SoundCloudIcon className="w-3 h-3 text-[#ff5500] flex-shrink-0" />
          )}
        </div>
        {artistName && (
          <p className="text-[10px] text-pnp-textSecondary truncate leading-tight mt-0.5">{artistName}</p>
        )}
      </div>

      {/* Duration or equalizer */}
      <div className="flex-shrink-0 flex items-center justify-end w-8">
        {isActive && isPlaying ? (
          <EqualizerBars color="#D946EF" size="xs" />
        ) : (
          <span className="text-[10px] text-pnp-textSecondary/60">{formatTime(track.time)}</span>
        )}
      </div>
    </button>
  );
});

// ── Pending Requests Panel (Admin) ────────────────────────────────────────────

function PendingRequestsPanel({ onImport }: { onImport: (url: string) => void }) {
  const [requests, setRequests] = useState<RadioRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [acting, setActing] = useState<number | null>(null);

  useEffect(() => {
    getRadioRequests("pending")
      .then((res) => {
        if (res.success) setRequests(res.requests || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleAction = useCallback(async (id: number, status: "approved" | "rejected", url?: string | null) => {
    setActing(id);
    try {
      const res = await updateRadioRequest(id, status);
      if (res.success) {
        setRequests((prev) => prev.filter((r) => r.id !== id));
        if (status === "approved" && url) {
          onImport(url);
        }
      }
    } catch { /* silent */ }
    setActing(null);
  }, [onImport]);

  if (loading || requests.length === 0) return null;

  return (
    <div className="border-b border-white/5">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2 hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-1.5">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
          </span>
          <span className="text-[10px] font-semibold text-amber-400 uppercase tracking-wider">
            {requests.length} request{requests.length !== 1 ? "s" : ""}
          </span>
        </div>
        <svg
          className={`w-3 h-3 text-pnp-textSecondary transition-transform ${expanded ? "rotate-180" : ""}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      {expanded && (
        <div className="max-h-40 overflow-y-auto px-2 pb-2 space-y-1">
          {requests.map((req) => (
            <div
              key={req.id}
              className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-white/5"
            >
              <div className="flex-1 min-w-0">
                <p className="text-[11px] text-pnp-textPrimary font-medium truncate">
                  {req.song_name || "Unknown"}
                </p>
                <p className="text-[9px] text-pnp-textSecondary truncate">
                  {req.artist || "Unknown artist"}
                  {req.url && (
                    <span className="ml-1 text-[#ff5500]">SC</span>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                {/* Approve — auto-fills import bar */}
                <button
                  onClick={() => handleAction(req.id, "approved", req.url)}
                  disabled={acting === req.id}
                  className="w-6 h-6 flex items-center justify-center rounded bg-emerald-500/20 hover:bg-emerald-500/30 active:scale-95 transition-all disabled:opacity-40"
                  title="Approve & import"
                >
                  <svg className="w-3 h-3 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                </button>
                {/* Reject */}
                <button
                  onClick={() => handleAction(req.id, "rejected")}
                  disabled={acting === req.id}
                  className="w-6 h-6 flex items-center justify-center rounded bg-red-500/20 hover:bg-red-500/30 active:scale-95 transition-all disabled:opacity-40"
                  title="Reject"
                >
                  <svg className="w-3 h-3 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main RadioWidget component ────────────────────────────────────────────────

export function RadioWidget() {
  const {
    tracks,
    currentTrack,
    isPlaying,
    progress,
    duration,
    volume,
    shuffle,
    repeat,
    isLoading,
    isLoadingTracks,
    hasMore,
    loadError,
    play,
    togglePlay,
    next,
    prev,
    seek,
    setVolume,
    toggleShuffle,
    toggleRepeat,
    loadMore,
  } = useMusicPlayer();

  const { isAdmin } = useAuth();
  const [scUrl, setScUrl] = useState("");
  const [isResolving, setIsResolving] = useState(false);

  // User Request State
  const [reqUrl, setReqUrl] = useState("");
  const [isRequesting, setIsRequesting] = useState(false);

  const handleRequestSC = async () => {
    if (!reqUrl.trim()) return;
    setIsRequesting(true);
    try {
      const res = await requestSoundCloud(reqUrl);
      if (res.success) {
        alert("Request sent successfully! An admin will review it.");
        setReqUrl("");
      }
    } catch (err: any) {
      alert(err.message || "Failed to send request");
    } finally {
      setIsRequesting(false);
    }
  };

  const handleImportSC = async () => {
    if (!scUrl.trim()) return;
    setIsResolving(true);
    try {
      const res = await resolveSoundCloud(scUrl);
      if (res.success && res.metadata) {
        const importRes = await importSoundCloud(res.metadata);
        if (importRes.success) {
          alert("Track imported successfully!");
          setScUrl("");
          loadMore(); // Refresh list
        }
      }
    } catch (err: any) {
      alert(err.message || "Failed to import track");
    } finally {
      setIsResolving(false);
    }
  };

  // Panel open/close
  const [isOpen, setIsOpen] = useState(false);

  // FAB corner: bl = bottom-left (default), br = bottom-right
  const [fabCorner, setFabCorner] = useState<"bl" | "br">(() => {
    try {
      return (localStorage.getItem("radio_fab_corner") as "bl" | "br") || "bl";
    } catch {
      return "bl";
    }
  });

  // Drag state
  const fabRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{
    startX: number;
    startY: number;
    dragging: boolean;
    moved: boolean;
  }>({ startX: 0, startY: 0, dragging: false, moved: false });

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
    if (!wasDragged) return; // tap — let onClick handle open/close
    e.preventDefault();
    e.stopPropagation();
    if (fabRef.current) {
      fabRef.current.style.transition = "";
      fabRef.current.style.transform = "";
    }
    const newCorner: "bl" | "br" = e.clientX < window.innerWidth / 2 ? "bl" : "br";
    setFabCorner(newCorner);
    try {
      localStorage.setItem("radio_fab_corner", newCorner);
    } catch { /* storage unavailable */ }
  }, []);

  // Playlist infinite scroll
  const playlistRef = useRef<HTMLDivElement>(null);
  const handlePlaylistScroll = useCallback(() => {
    const el = playlistRef.current;
    if (!el || !hasMore || isLoadingTracks) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 48) {
      loadMore();
    }
  }, [hasMore, isLoadingTracks, loadMore]);

  // Progress bar click/seek
  const progressBarRef = useRef<HTMLDivElement>(null);
  const handleProgressClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!duration || !isFinite(duration)) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      seek(ratio * duration);
    },
    [duration, seek]
  );

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isOpen]);

  const hasTrack = !!currentTrack;
  const progressPct = duration ? (progress / duration) * 100 : 0;
  const artistName = getArtistName(currentTrack?.artist);

  // ── Panel position classes ──────────────────────────────────────────────────
  const panelPosition =
    fabCorner === "bl"
      ? "fixed bottom-[88px] left-3 sm:bottom-24 sm:left-4"
      : "fixed bottom-[88px] right-3 sm:bottom-24 sm:right-4";

  const fabPosition =
    fabCorner === "bl"
      ? "fixed bottom-20 left-3 sm:bottom-24 sm:left-4"
      : "fixed bottom-20 right-3 sm:bottom-24 sm:right-4";

  // ── FAB (closed) ─────────────────────────────────────────────────────────────
  const fab = (
    <div
      ref={fabRef}
      className={`${fabPosition} z-[38]`}
      style={{ transition: "left 0.3s ease, right 0.3s ease", touchAction: "none" }}
      onPointerDown={handleFabPointerDown}
      onPointerMove={handleFabPointerMove}
      onPointerUp={handleFabPointerUp}
    >
      {/* Ping ring — only when playing */}
      {isPlaying && (
        <span
          className="absolute inset-0 rounded-full animate-ping pointer-events-none"
          style={{
            background: "linear-gradient(135deg, #8B5CF6, #D946EF)",
            opacity: 0.25,
            animationDuration: "2s",
          }}
          aria-hidden="true"
        />
      )}

      <button
        onClick={() => {
          if (!dragState.current.moved) setIsOpen(true);
        }}
        className={[
          "relative w-12 h-12 rounded-full shadow-lg flex items-center justify-center",
          "transition-transform hover:scale-110 active:scale-95",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 focus-visible:ring-offset-2 focus-visible:ring-offset-pnp-background",
        ].join(" ")}
        style={{ background: "linear-gradient(135deg, #8B5CF6, #D946EF)" }}
        aria-label="Open PNP Radio player"
      >
        {/* Glow halo */}
        <span
          className="absolute -inset-1 rounded-full pointer-events-none"
          style={{
            background: "linear-gradient(135deg, #8B5CF6, #D946EF)",
            opacity: 0.2,
            filter: "blur(8px)",
          }}
          aria-hidden="true"
        />

        {/* Icon: equalizer when playing, emoji when paused/idle */}
        <span className="relative flex items-center justify-center w-full h-full">
          {isPlaying ? (
            <EqualizerBars color="#fff" size="sm" />
          ) : (
            <span className="text-xl">🎧</span>
          )}
        </span>
      </button>
    </div>
  );

  // ── Panel (open) ──────────────────────────────────────────────────────────────
  const panel = isOpen ? (
    <div
      className={[
        panelPosition,
        "z-[42] w-[320px] max-w-[calc(100vw-24px)] flex flex-col overflow-hidden",
        "rounded-2xl shadow-2xl border border-white/10",
      ].join(" ")}
      style={{ background: "rgba(15, 12, 25, 0.97)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)" }}
      role="dialog"
      aria-label="PNP Radio player"
    >
      {/* ── Header ───────────────────────────────────────────────────────────── */}
      <div
        className="flex items-center justify-between px-4 py-3 flex-shrink-0 border-b border-white/8"
        style={{ borderBottomColor: "rgba(255,255,255,0.08)" }}
      >
        <div className="flex items-center gap-2">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: "linear-gradient(135deg, #8B5CF6, #D946EF)" }}
            aria-hidden="true"
          >
            <span className="text-sm">🎧</span>
          </div>
          <div>
            <h3 className="text-sm font-bold text-pnp-textPrimary leading-tight">PNP Radio</h3>
            <p className="text-[10px] text-pnp-textSecondary leading-tight">
              {tracks.length > 0 ? `${tracks.length} tracks` : "Loading library..."}
            </p>
          </div>
        </div>
        <button
          onClick={() => setIsOpen(false)}
          className={[
            "p-1.5 rounded-lg transition-colors",
            "text-pnp-textSecondary hover:text-pnp-textPrimary hover:bg-white/10",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-purple-400/60",
            "active:scale-95",
          ].join(" ")}
          aria-label="Close radio player"
        >
          <CloseIcon className="w-4 h-4" />
        </button>
      </div>

      {/* ── Body ─────────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-hidden flex flex-col">

        {/* SoundCloud Import Bar (Admin Only) */}
        {isAdmin && (
          <div className="px-4 py-2 bg-white/5 border-b border-white/5 flex gap-2">
            <input
              type="text"
              value={scUrl}
              onChange={(e) => setScUrl(e.target.value)}
              placeholder="SoundCloud URL..."
              className="flex-1 bg-black/40 border border-white/10 rounded px-2 py-1 text-[10px] text-white focus:outline-none focus:border-purple-500"
            />
            <button
              onClick={handleImportSC}
              disabled={isResolving || !scUrl.trim()}
              className="bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-[10px] px-2 py-1 rounded transition-colors"
            >
              {isResolving ? "..." : "Add"}
            </button>
          </div>
        )}

        {/* Pending Requests (Admin Only) */}
        {isAdmin && <PendingRequestsPanel onImport={(url) => { setScUrl(url); }} />}

        {/* Request Song Bar (Regular Users) */}
        {!isAdmin && (
          <div className="px-4 py-2 bg-white/5 border-b border-white/5 flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5">
              <SoundCloudIcon className="w-3 h-3 text-[#ff5500]" />
              <span className="text-[10px] text-pnp-textSecondary font-medium uppercase tracking-tight">Request Track</span>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={reqUrl}
                onChange={(e) => setReqUrl(e.target.value)}
                placeholder="Paste SoundCloud link..."
                className="flex-1 bg-black/40 border border-white/10 rounded px-2 py-1 text-[10px] text-white focus:outline-none focus:border-[#ff5500]"
              />
              <button
                onClick={handleRequestSC}
                disabled={isRequesting || !reqUrl.trim()}
                className="bg-[#ff5500] hover:bg-[#ff4400] disabled:opacity-50 text-white text-[10px] px-2 py-1 rounded transition-colors font-semibold"
              >
                {isRequesting ? "..." : "Request"}
              </button>
            </div>
          </div>
        )}

        {/* Loading tracks state (initial) */}
        {isLoadingTracks && !hasTrack && tracks.length === 0 && !loadError && (
          <div className="flex flex-col items-center justify-center gap-3 py-10 px-4">
            <div
              className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin"
              style={{ borderColor: "rgba(217,70,239,0.6)", borderTopColor: "transparent" }}
              aria-label="Loading tracks"
            />
            <p className="text-xs text-pnp-textSecondary text-center">Loading radio stations...</p>
          </div>
        )}

        {/* Error state */}
        {loadError && (
          <div className="flex flex-col items-center justify-center gap-3 py-10 px-4">
            <AlertTriangleIcon className="w-8 h-8 text-pnp-error" />
            <p className="text-xs text-pnp-textPrimary text-center font-medium">Radio unavailable</p>
            <p className="text-[11px] text-pnp-textSecondary text-center">{loadError}</p>
          </div>
        )}

        {/* Empty state — tracks loaded but none found */}
        {!isLoadingTracks && !loadError && tracks.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-3 py-10 px-4">
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center"
              style={{ background: "rgba(139,92,246,0.15)" }}
              aria-hidden="true"
            >
              <span className="text-2xl">🎧</span>
            </div>
            <p className="text-sm font-semibold text-pnp-textPrimary text-center">No tracks found</p>
            <p className="text-xs text-pnp-textSecondary text-center">The radio library appears to be empty.</p>
          </div>
        )}

        {/* Now playing + controls */}
        {tracks.length > 0 && (
          <>
            {/* Album art */}
            <div className="px-4 pt-4 pb-3 flex-shrink-0">
              {hasTrack && currentTrack.art ? (
                <div className="w-full aspect-video rounded-xl overflow-hidden">
                  <img
                    src={currentTrack.art}
                    alt={currentTrack.title}
                    className="w-full h-full object-cover"
                    style={{ pointerEvents: "none" }}
                  />
                </div>
              ) : (
                <div
                  className="w-full aspect-video rounded-xl flex items-center justify-center"
                  style={{ background: "linear-gradient(135deg, rgba(139,92,246,0.3) 0%, rgba(217,70,239,0.3) 100%)" }}
                  aria-hidden="true"
                >
                  {isLoading && hasTrack ? (
                    <div
                      className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin"
                      style={{ borderColor: "rgba(217,70,239,0.6)", borderTopColor: "transparent" }}
                    />
                  ) : (
                    <span className="text-4xl">🎧</span>
                  )}
                </div>
              )}

              {/* Track title + artist */}
              <div className="mt-3">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-pnp-textPrimary truncate leading-tight">
                    {hasTrack ? currentTrack.title : "Select a track"}
                  </p>
                  {currentTrack?.provider === "soundcloud" && (
                    <SoundCloudIcon className="w-4 h-4 text-[#ff5500]" />
                  )}
                </div>
                {artistName ? (
                  <p className="text-xs text-pnp-textSecondary truncate mt-0.5">{artistName}</p>
                ) : !hasTrack ? (
                  <p className="text-xs text-pnp-textSecondary mt-0.5">PNP Radio</p>
                ) : null}
              </div>

              {/* Progress bar */}
              {hasTrack && (
                <div className="mt-3">
                  <div
                    ref={progressBarRef}
                    className="h-1.5 bg-white/10 rounded-full cursor-pointer group relative"
                    onClick={handleProgressClick}
                    role="slider"
                    aria-label="Seek"
                    aria-valuemin={0}
                    aria-valuemax={duration || 0}
                    aria-valuenow={Math.round(progress)}
                  >
                    <div
                      className="h-full rounded-full relative transition-all duration-150"
                      style={{
                        width: `${progressPct}%`,
                        background: "linear-gradient(90deg, #8B5CF6, #D946EF)",
                      }}
                    >
                      {/* Scrubber thumb — visible on hover */}
                      <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow-sm" />
                    </div>
                  </div>
                  <div className="flex justify-between mt-1">
                    <span className="text-[10px] text-pnp-textSecondary/60">{formatTime(progress)}</span>
                    <span className="text-[10px] text-pnp-textSecondary/60">{formatTime(duration)}</span>
                  </div>
                </div>
              )}

              {/* Controls row */}
              <div className="flex items-center justify-between mt-2">
                {/* Shuffle */}
                <button
                  onClick={toggleShuffle}
                  className={[
                    "p-2 rounded-lg transition-colors min-w-[36px] min-h-[36px] flex items-center justify-center",
                    "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-purple-400/60",
                    "active:scale-95",
                    shuffle
                      ? "text-purple-400 bg-purple-400/10"
                      : "text-pnp-textSecondary hover:text-pnp-textPrimary hover:bg-white/5",
                  ].join(" ")}
                  aria-label={shuffle ? "Disable shuffle" : "Enable shuffle"}
                  aria-pressed={shuffle}
                >
                  <ShuffleIcon className="w-4 h-4" />
                </button>

                {/* Prev */}
                <button
                  onClick={prev}
                  disabled={tracks.length === 0}
                  className={[
                    "p-2 rounded-lg transition-colors min-w-[36px] min-h-[36px] flex items-center justify-center",
                    "text-pnp-textSecondary hover:text-pnp-textPrimary hover:bg-white/5",
                    "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-purple-400/60",
                    "active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed",
                  ].join(" ")}
                  aria-label="Previous track"
                >
                  <PrevIcon className="w-5 h-5" />
                </button>

                {/* Play / Pause — larger tap target */}
                <button
                  onClick={hasTrack ? togglePlay : () => tracks.length > 0 && play(tracks[0])}
                  disabled={isLoading && hasTrack}
                  className={[
                    "w-12 h-12 rounded-full flex items-center justify-center text-white shadow-md",
                    "transition-all hover:brightness-110 active:scale-95",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 focus-visible:ring-offset-2",
                    "disabled:opacity-50 disabled:cursor-not-allowed",
                  ].join(" ")}
                  style={{ background: "linear-gradient(135deg, #8B5CF6, #D946EF)" }}
                  aria-label={isPlaying ? "Pause" : "Play"}
                >
                  {isLoading && hasTrack ? (
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : isPlaying ? (
                    <PauseIcon className="w-5 h-5" />
                  ) : (
                    <PlayIcon className="w-5 h-5 ml-0.5" />
                  )}
                </button>

                {/* Next */}
                <button
                  onClick={next}
                  disabled={tracks.length === 0}
                  className={[
                    "p-2 rounded-lg transition-colors min-w-[36px] min-h-[36px] flex items-center justify-center",
                    "text-pnp-textSecondary hover:text-pnp-textPrimary hover:bg-white/5",
                    "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-purple-400/60",
                    "active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed",
                  ].join(" ")}
                  aria-label="Next track"
                >
                  <NextIcon className="w-5 h-5" />
                </button>

                {/* Repeat */}
                <button
                  onClick={toggleRepeat}
                  className={[
                    "relative p-2 rounded-lg transition-colors min-w-[36px] min-h-[36px] flex items-center justify-center",
                    "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-purple-400/60",
                    "active:scale-95",
                    repeat !== "off"
                      ? "text-purple-400 bg-purple-400/10"
                      : "text-pnp-textSecondary hover:text-pnp-textPrimary hover:bg-white/5",
                  ].join(" ")}
                  aria-label={`Repeat: ${repeat}`}
                  aria-pressed={repeat !== "off"}
                >
                  <RepeatIcon className="w-4 h-4" />
                  {repeat === "one" && (
                    <span
                      className="absolute -top-0.5 -right-0.5 text-[7px] font-bold"
                      style={{ color: "#D946EF" }}
                      aria-hidden="true"
                    >
                      1
                    </span>
                  )}
                </button>
              </div>

              {/* Volume control */}
              <div className="flex items-center gap-2 mt-3">
                <VolumeIcon level={volume} className="w-4 h-4 text-pnp-textSecondary flex-shrink-0" />
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={volume}
                  onChange={(e) => setVolume(parseFloat(e.target.value))}
                  className="flex-1 h-1.5 rounded-full cursor-pointer appearance-none radio-volume-slider"
                  style={{
                    accentColor: "#D946EF",
                    background: `linear-gradient(to right, #8B5CF6 ${volume * 100}%, rgba(255,255,255,0.1) ${volume * 100}%)`,
                  }}
                  aria-label="Volume"
                />
                <span className="text-[10px] text-pnp-textSecondary/60 w-6 text-right flex-shrink-0">
                  {Math.round(volume * 100)}
                </span>
              </div>
            </div>

            {/* ── Playlist section ────────────────────────────────────────────── */}
            <div className="border-t border-white/8 flex-shrink-0" style={{ borderTopColor: "rgba(255,255,255,0.08)" }}>
              <div className="flex items-center justify-between px-4 py-2">
                <span className="text-[10px] font-semibold text-pnp-textSecondary uppercase tracking-wider">
                  Playlist
                </span>
                <span className="text-[10px] text-pnp-textSecondary/60">{tracks.length} tracks</span>
              </div>

              <div
                ref={playlistRef}
                onScroll={handlePlaylistScroll}
                className="max-h-[180px] overflow-y-auto"
              >
                {tracks.map((track) => (
                  <PlaylistRow
                    key={track.id}
                    track={track}
                    isActive={currentTrack?.id === track.id}
                    isPlaying={isPlaying}
                    onPlay={play}
                  />
                ))}

                {/* Load more spinner */}
                {isLoadingTracks && (
                  <div className="flex items-center justify-center py-3">
                    <div
                      className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin"
                      style={{ borderColor: "rgba(217,70,239,0.5)", borderTopColor: "transparent" }}
                      aria-label="Loading more tracks"
                    />
                  </div>
                )}

                {/* End of list */}
                {!hasMore && tracks.length > 0 && (
                  <p className="text-center text-[10px] text-pnp-textSecondary/40 py-2 pb-3">
                    End of playlist
                  </p>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  ) : null;

  return (
    <>
      {panel}
      {fab}
    </>
  );
}
