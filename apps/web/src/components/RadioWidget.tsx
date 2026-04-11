import React, { useState, useRef, useCallback, useEffect } from "react";
import { useMusicPlayer } from "@/hooks/useMusicPlayer";
import { resolveSoundCloud, importSoundCloud, getRadioRequests, updateRadioRequest, getSoundCloudArtistTracks, getMediaTracks, type MediaTrack, type RadioRequest } from "@/lib/api";
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

function extractArtistUrl(trackUrl: string): string | null {
  try {
    const url = new URL(trackUrl);
    if (!url.hostname.includes("soundcloud.com")) return null;
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length >= 1) return `https://soundcloud.com/${parts[0]}`;
  } catch {}
  return null;
}

// ── Inline SVG icon components ────────────────────────────────────────────────

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
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


function AlertTriangleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
    </svg>
  );
}

// ── Equalizer bars (animated) ─────────────────────────────────────────────────
// Exported so CristinaWidget and other callers can reuse the FAB indicator.

export function EqualizerBars({ color = "#fff", size = "sm" }: { color?: string; size?: "sm" | "xs" }) {
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


// ── Pending Requests Panel (Admin) ────────────────────────────────────────────

function PendingRequestsPanel({ onAutoImport }: { onAutoImport: (url: string) => void }) {
  const [requests, setRequests] = useState<RadioRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [acting, setActing] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<{ id: number; type: "approved" | "rejected" } | null>(null);

  useEffect(() => {
    getRadioRequests("pending")
      .then((res) => {
        if (res.success) setRequests(res.requests || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleApprove = useCallback(async (req: RadioRequest) => {
    setActing(req.id);
    try {
      const res = await updateRadioRequest(req.id, "approved");
      if (res.success) {
        setFeedback({ id: req.id, type: "approved" });
        if (req.url) {
          onAutoImport(req.url);
        }
        setTimeout(() => {
          setRequests((prev) => prev.filter((r) => r.id !== req.id));
          setFeedback(null);
        }, 800);
      }
    } catch { /* silent */ }
    setActing(null);
  }, [onAutoImport]);

  const handleReject = useCallback(async (id: number) => {
    setActing(id);
    try {
      const res = await updateRadioRequest(id, "rejected");
      if (res.success) {
        setFeedback({ id, type: "rejected" });
        setTimeout(() => {
          setRequests((prev) => prev.filter((r) => r.id !== id));
          setFeedback(null);
        }, 800);
      }
    } catch { /* silent */ }
    setActing(null);
  }, []);

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
        <div className="max-h-48 overflow-y-auto px-2 pb-2 space-y-1">
          {requests.map((req) => {
            const meta = req.metadata as Record<string, any> | null;
            const coverUrl = meta?.coverUrl || meta?.thumbnail_url;
            const isFeedback = feedback?.id === req.id;
            return (
              <div
                key={req.id}
                className={[
                  "flex items-center gap-2 px-2 py-1.5 rounded-lg transition-all",
                  isFeedback && feedback.type === "approved" ? "bg-emerald-500/20" :
                  isFeedback && feedback.type === "rejected" ? "bg-red-500/20" :
                  "bg-white/5",
                ].join(" ")}
              >
                {/* Cover art thumbnail */}
                <div className="w-8 h-8 rounded flex-shrink-0 overflow-hidden">
                  {coverUrl ? (
                    <img src={coverUrl} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div
                      className="w-full h-full flex items-center justify-center"
                      style={{ background: "linear-gradient(135deg, rgba(255,85,0,0.3), rgba(255,85,0,0.15))" }}
                    >
                      <SoundCloudIcon className="w-3.5 h-3.5 text-[#ff5500]" />
                    </div>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <p className="text-[11px] text-pnp-textPrimary font-medium truncate">
                    {req.song_name || "Unknown"}
                  </p>
                  <div className="flex items-center gap-1">
                    <p className="text-[9px] text-pnp-textSecondary truncate">
                      {req.artist || "Unknown artist"}
                    </p>
                    {req.url && (
                      <a
                        href={req.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-shrink-0"
                        onClick={(e) => e.stopPropagation()}
                        title="Open on SoundCloud"
                        aria-label="Open on SoundCloud"
                      >
                        <SoundCloudIcon className="w-3 h-3 text-[#ff5500] hover:text-[#ff7733] transition-colors" />
                      </a>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {isFeedback ? (
                    <span className={`text-[10px] font-semibold ${feedback.type === "approved" ? "text-emerald-400" : "text-red-400"}`}>
                      {feedback.type === "approved" ? "Imported!" : "Rejected"}
                    </span>
                  ) : (
                    <>
                      {/* Approve — auto-imports the track */}
                      <button
                        onClick={() => handleApprove(req)}
                        disabled={acting === req.id}
                        className="w-11 h-11 flex items-center justify-center rounded-lg bg-emerald-500/20 hover:bg-emerald-500/40 active:scale-95 transition-all disabled:opacity-40"
                        aria-label="Approve and import track"
                        title="Approve & import"
                      >
                        <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                        </svg>
                      </button>
                      {/* Reject */}
                      <button
                        onClick={() => handleReject(req.id)}
                        disabled={acting === req.id}
                        className="w-11 h-11 flex items-center justify-center rounded-lg bg-red-500/20 hover:bg-red-500/40 active:scale-95 transition-all disabled:opacity-40"
                        aria-label="Reject track request"
                        title="Reject"
                      >
                        <svg className="w-3.5 h-3.5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Flight Mode definitions ──────────────────────────────────────────────────

type FlightMode = "takeoff" | "flying" | "landing";

const FLIGHT_MODES: { id: FlightMode; emoji: string; label: string; labelEs: string; desc: string; descEs: string; gradient: string; color: string }[] = [
  { id: "takeoff", emoji: "🛫", label: "Take Off", labelEs: "Despegue", desc: "Warm up & get ready", descEs: "Calentando motores", gradient: "linear-gradient(135deg, #F59E0B, #EF4444)", color: "#F59E0B" },
  { id: "flying",  emoji: "🚀", label: "Flying",   labelEs: "Volando",  desc: "Peak energy",        descEs: "Energia al maximo",   gradient: "linear-gradient(135deg, #8B5CF6, #D946EF)", color: "#D946EF" },
  { id: "landing", emoji: "🛬", label: "Landing",  labelEs: "Aterrizaje", desc: "Chill & decompress", descEs: "Relax y a dormir",   gradient: "linear-gradient(135deg, #06B6D4, #3B82F6)", color: "#06B6D4" },
];

// ── RadioPanel ────────────────────────────────────────────────────────────────
// Flight Mode Radio — 3 simple modes: Take Off, Flying, Landing.

export function RadioPanel({ onClose }: { onClose: () => void }) {
  const {
    currentTrack,
    isPlaying,
    progress,
    duration,
    volume,
    isLoading,
    loadError,
    play,
    togglePlay,
    next,
    prev,
    seek,
    setVolume,
    loadMore,
    retryLoad,
  } = useMusicPlayer();

  const { isAdmin } = useAuth();
  const [activeMode, setActiveMode] = useState<FlightMode | null>(null);

  // Admin import state
  const [scUrl, setScUrl] = useState("");
  const [isResolving, setIsResolving] = useState(false);
  const [importLabel, setImportLabel] = useState("");
  const [importFeedback, setImportFeedback] = useState<string | null>(null);
  const [artistTracks, setArtistTracks] = useState<Array<{ title: string; artist: string; coverUrl: string; url: string; externalId: string }>>([]);
  const [showArtistCatalog, setShowArtistCatalog] = useState(false);
  const [fetchingCatalog, setFetchingCatalog] = useState(false);

  const autoImportSC = useCallback(async (url: string) => {
    try {
      const res = await resolveSoundCloud(url);
      if (res.success && res.metadata) {
        const importRes = await importSoundCloud(res.metadata, importLabel || undefined);
        if (importRes.success) loadMore();
      }
    } catch { /* silent */ }
  }, [importLabel, loadMore]);

  const handleImportSC = async () => {
    if (!scUrl.trim()) return;
    setIsResolving(true);
    setImportFeedback(null);
    try {
      const res = await resolveSoundCloud(scUrl);
      if (res.success && res.metadata) {
        const importRes = await importSoundCloud(res.metadata, importLabel || undefined);
        if (importRes.success) {
          setImportFeedback("Track imported!");
          setScUrl("");
          loadMore();
          const artistUrl = extractArtistUrl(res.metadata.url);
          if (artistUrl) {
            setFetchingCatalog(true);
            try {
              const catalogRes = await getSoundCloudArtistTracks(artistUrl);
              if (catalogRes.success && catalogRes.tracks?.length > 0) {
                setArtistTracks(catalogRes.tracks);
                setShowArtistCatalog(true);
              }
            } catch { /* silent */ }
            setFetchingCatalog(false);
          }
          setTimeout(() => setImportFeedback(null), 2500);
        }
      }
    } catch (err: any) {
      setImportFeedback(err.message || "Failed to import");
      setTimeout(() => setImportFeedback(null), 3000);
    } finally {
      setIsResolving(false);
    }
  };

  const handleImportCatalogTrack = async (track: { title: string; artist: string; coverUrl: string; url: string; externalId: string }) => {
    try {
      const importRes = await importSoundCloud(track, importLabel || undefined);
      if (importRes.success) {
        setArtistTracks((prev) => prev.filter((t) => t.url !== track.url));
        loadMore();
      }
    } catch { /* silent */ }
  };

  const [loadingMode, setLoadingMode] = useState<FlightMode | null>(null);
  // Cache loaded tracks per mode so we don't re-fetch
  const modeCacheRef = useRef<Record<string, MediaTrack[]>>({});

  // Handle mode selection — fetch mode tracks from API and play
  const handleModeSelect = useCallback(async (mode: FlightMode) => {
    setActiveMode(mode);
    setLoadingMode(mode);
    try {
      let modeTracks = modeCacheRef.current[mode];
      if (!modeTracks) {
        const res = await getMediaTracks(0, 500, mode);
        modeTracks = res.success ? res.tracks : [];
        modeCacheRef.current[mode] = modeTracks;
      }
      if (modeTracks.length > 0) {
        play(modeTracks[Math.floor(Math.random() * modeTracks.length)], modeTracks);
      }
    } catch { /* silent */ }
    setLoadingMode(null);
  }, [play]);

  // Progress bar
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

  const hasTrack = !!currentTrack;
  const progressPct = duration ? (progress / duration) * 100 : 0;
  const artistName = getArtistName(currentTrack?.artist);
  const activeModeConfig = FLIGHT_MODES.find((m) => m.id === activeMode);

  return (
    <div className="flex flex-col" style={{ maxHeight: "calc(85vh - 6rem)" }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div
        className="flex items-center justify-between px-4 py-3 flex-shrink-0 border-b border-white/8"
        style={{ borderBottomColor: "rgba(255,255,255,0.08)" }}
      >
        <div className="flex items-center gap-2">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: activeModeConfig?.gradient || "linear-gradient(135deg, #8B5CF6, #D946EF)" }}
            aria-hidden="true"
          >
            <span className="text-sm">{activeModeConfig?.emoji || "🎧"}</span>
          </div>
          <div>
            <h3 className="text-sm font-bold text-pnp-textPrimary leading-tight">PNP Radio</h3>
            <p className="text-[10px] text-pnp-textSecondary leading-tight">
              {activeModeConfig ? activeModeConfig.label : "Choose your flight mode"}
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg transition-colors text-pnp-textSecondary hover:text-pnp-textPrimary hover:bg-white/10 active:scale-95"
          aria-label="Close radio player"
        >
          <CloseIcon className="w-4 h-4" />
        </button>
      </div>

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto flex flex-col">

        {/* Admin Import Bar */}
        {isAdmin && (
          <div className="px-4 py-2 bg-white/5 border-b border-white/5 space-y-1.5">
            <div className="flex gap-2">
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
            <div className="flex items-center gap-2">
              <span className="text-[9px] text-pnp-textSecondary">Mode:</span>
              <select
                value={importLabel}
                onChange={(e) => setImportLabel(e.target.value)}
                className="bg-black/40 border border-white/10 rounded px-1.5 py-0.5 text-[10px] text-white focus:outline-none focus:border-purple-500"
              >
                <option value="">None</option>
                <option value="takeoff">🛫 Take Off</option>
                <option value="flying">🚀 Flying</option>
                <option value="landing">🛬 Landing</option>
              </select>
              {importFeedback && (
                <span className={`text-[10px] font-semibold ${importFeedback.includes("Failed") ? "text-red-400" : "text-emerald-400"}`}>
                  {importFeedback}
                </span>
              )}
              {fetchingCatalog && (
                <span className="text-[9px] text-pnp-textSecondary animate-pulse">Fetching catalog...</span>
              )}
            </div>

            {showArtistCatalog && artistTracks.length > 0 && (
              <div className="bg-black/30 rounded-lg border border-white/5 p-2 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-semibold text-[#ff5500]">Artist Catalog ({artistTracks.length})</span>
                  <button onClick={() => { setShowArtistCatalog(false); setArtistTracks([]); }} className="text-[9px] text-pnp-textSecondary hover:text-white transition-colors">Dismiss</button>
                </div>
                <div className="max-h-28 overflow-y-auto space-y-0.5">
                  {artistTracks.map((t) => (
                    <div key={t.url} className="flex items-center gap-1.5 py-0.5">
                      {t.coverUrl && <img src={t.coverUrl} alt="" className="w-5 h-5 rounded flex-shrink-0 object-cover" />}
                      <span className="text-[10px] text-pnp-textPrimary truncate flex-1">{t.title}</span>
                      <button onClick={() => handleImportCatalogTrack(t)} className="text-[9px] text-purple-400 hover:text-purple-300 font-semibold flex-shrink-0 transition-colors">+Add</button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {isAdmin && <PendingRequestsPanel onAutoImport={autoImportSC} />}

        {/* Error state */}
        {loadError && (
          <div className="flex flex-col items-center justify-center gap-3 py-10 px-4">
            <AlertTriangleIcon className="w-8 h-8 text-pnp-error" />
            <p className="text-xs text-pnp-textPrimary text-center font-medium">Couldn't load tracks</p>
            <p className="text-[11px] text-pnp-textSecondary text-center">{loadError}</p>
            <button
              onClick={retryLoad}
              className="px-4 py-2 rounded-lg text-xs font-semibold text-white btn-gradient min-h-[44px] min-w-[44px] flex items-center justify-center"
            >
              Retry
            </button>
          </div>
        )}

        {/* ── Flight Mode Selector ─────────────────────────────────────────── */}
        {!loadError && (
          <div className="px-4 pt-4 pb-2">
            <div className="grid grid-cols-3 gap-2">
              {FLIGHT_MODES.map((mode) => {
                const isActive = activeMode === mode.id;
                const isModeLoading = loadingMode === mode.id;
                return (
                  <button
                    key={mode.id}
                    onClick={() => handleModeSelect(mode.id)}
                    disabled={isModeLoading}
                    className={[
                      "relative flex flex-col items-center justify-center rounded-2xl py-4 px-2 transition-all",
                      "active:scale-95 disabled:opacity-60",
                      isActive
                        ? "ring-2 ring-[var(--pnp-ring-color)] shadow-lg"
                        : "bg-white/5 hover:bg-white/10",
                    ].join(" ")}
                    style={isActive ? {
                      background: mode.gradient,
                      ["--pnp-ring-color" as any]: mode.color,
                      boxShadow: `0 0 24px ${mode.color}40`,
                    } as React.CSSProperties : undefined}
                  >
                    {isModeLoading ? (
                      <div className="w-6 h-6 border-2 border-white/40 border-t-white rounded-full animate-spin mb-1.5" />
                    ) : (
                      <span className="text-3xl mb-1.5">{mode.emoji}</span>
                    )}
                    <span className={`text-xs font-bold leading-tight ${isActive ? "text-white" : "text-pnp-textPrimary"}`}>
                      {mode.label}
                    </span>
                    <span className={`text-[9px] mt-0.5 leading-tight ${isActive ? "text-white/80" : "text-pnp-textSecondary"}`}>
                      {mode.desc}
                    </span>
                    {isActive && isPlaying && !isModeLoading && (
                      <div className="absolute top-2 right-2">
                        <EqualizerBars color="#fff" size="xs" />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Now Playing Bar ──────────────────────────────────────────────── */}
        {hasTrack && activeModeConfig && (
          <div className="px-4 pt-2 pb-3 flex-shrink-0">
            {/* Track info + art */}
            <div className="flex items-center gap-3 mb-3">
              <div className="w-12 h-12 rounded-xl overflow-hidden flex-shrink-0">
                {currentTrack.art ? (
                  <img src={currentTrack.art} alt={currentTrack.title} className="w-full h-full object-cover" style={{ pointerEvents: "none" }} />
                ) : (
                  <div className="w-full h-full flex items-center justify-center" style={{ background: activeModeConfig.gradient }}>
                    <span className="text-xl">{activeModeConfig.emoji}</span>
                  </div>
                )}
              </div>
              <div role="status" aria-live="polite" className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-pnp-textPrimary truncate">{currentTrack.title}</p>
                {artistName && <p className="text-[10px] text-pnp-textSecondary truncate">{artistName}</p>}
              </div>
            </div>

            {/* Progress bar */}
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
                style={{ width: `${progressPct}%`, background: activeModeConfig.gradient }}
              >
                <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow-sm" />
              </div>
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-[10px] text-pnp-textSecondary/60">{formatTime(progress)}</span>
              <span className="text-[10px] text-pnp-textSecondary/60">{formatTime(duration)}</span>
            </div>

            {/* Controls: prev, play/pause, next */}
            <div className="flex items-center justify-center gap-4 mt-3">
              <button
                onClick={prev}
                className="p-2 rounded-lg text-pnp-textSecondary hover:text-pnp-textPrimary hover:bg-white/5 active:scale-95 transition-colors"
                aria-label="Previous track"
              >
                <PrevIcon className="w-5 h-5" />
              </button>

              <button
                onClick={togglePlay}
                disabled={isLoading}
                className="w-12 h-12 rounded-full flex items-center justify-center text-white shadow-md transition-all hover:brightness-110 active:scale-95 disabled:opacity-50"
                style={{ background: activeModeConfig.gradient }}
                aria-label={isPlaying ? "Pause" : "Play"}
              >
                {isLoading ? (
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : isPlaying ? (
                  <PauseIcon className="w-5 h-5" />
                ) : (
                  <PlayIcon className="w-5 h-5 ml-0.5" />
                )}
              </button>

              <button
                onClick={next}
                className="p-2 rounded-lg text-pnp-textSecondary hover:text-pnp-textPrimary hover:bg-white/5 active:scale-95 transition-colors"
                aria-label="Next track"
              >
                <NextIcon className="w-5 h-5" />
              </button>
            </div>

            {/* Volume */}
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
                  accentColor: activeModeConfig.color,
                  background: `linear-gradient(to right, ${activeModeConfig.color} ${volume * 100}%, rgba(255,255,255,0.1) ${volume * 100}%)`,
                }}
                aria-label="Volume"
              />
              <span className="text-[10px] text-pnp-textSecondary/60 w-6 text-right flex-shrink-0">{Math.round(volume * 100)}</span>
            </div>
          </div>
        )}

        {/* Empty state — no mode selected yet, show instruction */}
        {!hasTrack && !loadError && !loadingMode && (
          <div className="flex flex-col items-center justify-center py-6 px-4">
            <p className="text-[11px] text-pnp-textSecondary text-center">
              Tap a flight mode to start the music
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── RadioWidget — backward-compat no-op stub ──────────────────────────────────
// The FAB and modal overlay are now owned by CristinaWidget (or another parent).
// This export is kept so existing import sites don't break at compile time.

export function RadioWidget(_props?: { compact?: boolean }) {
  return null;
}
