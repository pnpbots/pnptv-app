import React, { useState, useCallback, useEffect } from "react";
import { useHangoutMusic } from "@/hooks/useHangoutMusic";
import { getMediaTracks, type MediaTrack } from "@/lib/api";

// ─── Types ───────────────────────────────────────────────────────────────────

interface HangoutMusicBarProps {
  groupId: number;
  isModerator: boolean;
  isMainStage?: boolean;
}

// ─── Animated equalizer bars ─────────────────────────────────────────────────

function EqBars({ active }: { active: boolean }) {
  const heights = [0.6, 1, 0.75, 0.9, 0.5];
  return (
    <div className="flex items-end gap-[2px] h-4 w-5">
      {heights.map((h, i) => (
        <div
          key={i}
          className="w-[3px] rounded-full transition-all duration-150"
          style={{
            height: active ? `${h * 100}%` : "30%",
            background: active ? "var(--pnp-accent, #5ED1C4)" : "rgba(255,255,255,0.2)",
            animation: active ? `pnp-eq-bounce ${0.5 + i * 0.1}s ease-in-out infinite alternate` : "none",
            animationDelay: `${i * 0.05}s`,
          }}
        />
      ))}
    </div>
  );
}

// ─── Track list picker ───────────────────────────────────────────────────────

function TrackPicker({
  onSelect,
  onClose,
}: {
  onSelect: (track: MediaTrack) => void;
  onClose: () => void;
}) {
  const [tracks, setTracks] = useState<MediaTrack[]>([]);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    setLoading(true);
    getMediaTracks(0, 20)
      .then((res) => {
        if (res.success) {
          setTracks(res.tracks || []);
          setOffset(20);
          setHasMore((res.tracks?.length || 0) >= 20);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const loadMore = useCallback(() => {
    if (!hasMore || loading) return;
    setLoading(true);
    getMediaTracks(offset, 20)
      .then((res) => {
        if (res.success && res.tracks?.length) {
          setTracks((prev) => [...prev, ...res.tracks]);
          setOffset((o) => o + res.tracks.length);
          setHasMore(res.tracks.length >= 20);
        } else {
          setHasMore(false);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [hasMore, loading, offset]);

  const filtered = search.trim()
    ? tracks.filter((t) => {
        const artistName =
          typeof t.artist === "string"
            ? t.artist
            : (t.artist as { name: string })?.name || "";
        const q = search.toLowerCase();
        return (
          t.title?.toLowerCase().includes(q) ||
          artistName.toLowerCase().includes(q)
        );
      })
    : tracks;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/5 flex-shrink-0">
        <span className="text-xs font-semibold text-pnp-textPrimary flex-1">
          Choose a Track
        </span>
        <button
          onClick={onClose}
          className="w-6 h-6 flex items-center justify-center rounded hover:bg-white/10 active:scale-95 transition-all"
          aria-label="Close track picker"
        >
          <svg
            className="w-3.5 h-3.5 text-pnp-textSecondary"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>

      {/* Search */}
      <div className="px-2 pt-2 flex-shrink-0">
        <input
          type="text"
          placeholder="Search tracks..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full text-xs bg-pnp-surface/50 border border-white/5 rounded-lg px-2.5 py-1.5 text-pnp-textPrimary placeholder:text-pnp-textSecondary/50 focus:outline-none focus:ring-1 focus:ring-pnp-accent/50"
        />
      </div>

      {/* Track list */}
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1 scrollbar-thin">
        {loading && tracks.length === 0 && (
          <div className="flex items-center justify-center py-8">
            <div className="w-4 h-4 rounded-full border-2 border-pnp-accent/30 border-t-pnp-accent animate-spin" />
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <p className="text-[10px] text-pnp-textSecondary text-center py-6">
            {search.trim() ? "No tracks match your search" : "No tracks available"}
          </p>
        )}

        {filtered.map((track) => {
          const artistName =
            typeof track.artist === "string"
              ? track.artist
              : (track.artist as { name: string })?.name || "Unknown";
          return (
            <button
              key={track.id}
              onClick={() => {
                onSelect(track);
                onClose();
              }}
              className="w-full flex items-center gap-2 p-2 rounded-lg hover:bg-pnp-surface active:scale-[0.99] transition-all text-left"
            >
              {track.art ? (
                <img
                  src={track.art}
                  alt=""
                  className="w-8 h-8 rounded object-cover flex-shrink-0"
                />
              ) : (
                <div className="w-8 h-8 rounded bg-pnp-accent/10 flex items-center justify-center flex-shrink-0">
                  <svg
                    className="w-4 h-4 text-pnp-accent/50"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.5}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 11-.99-3.467l2.31-.66a2.25 2.25 0 001.632-2.163zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 01-.99-3.467l2.31-.66A2.25 2.25 0 009 15.553z"
                    />
                  </svg>
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-medium text-pnp-textPrimary truncate">
                  {track.title}
                </p>
                <p className="text-[10px] text-pnp-textSecondary truncate">
                  {artistName}
                </p>
              </div>
            </button>
          );
        })}

        {hasMore && !search && (
          <button
            onClick={loadMore}
            disabled={loading}
            className="w-full py-2 text-[10px] text-pnp-accent/70 hover:text-pnp-accent transition-colors disabled:opacity-50"
          >
            {loading ? "Loading..." : "Load more"}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Track picker modal wrapper ──────────────────────────────────────────────

function TrackPickerModal({
  onSelect,
  onClose,
}: {
  onSelect: (track: MediaTrack) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative w-full sm:w-96 h-[70vh] sm:h-[500px] flex flex-col bg-pnp-background rounded-t-2xl sm:rounded-2xl border border-white/10 overflow-hidden">
        <TrackPicker onSelect={onSelect} onClose={onClose} />
      </div>
    </div>
  );
}

// ─── Main HangoutMusicBar component ─────────────────────────────────────────

export function HangoutMusicBar({
  groupId,
  isModerator,
  isMainStage = false,
}: HangoutMusicBarProps) {
  const {
    remoteState,
    localVolume,
    setLocalVolume,
    isLocalPlaying,
    playTrack,
    pause,
    resume,
  } = useHangoutMusic({ groupId, isModerator, isMainStage });

  const [showPicker, setShowPicker] = useState(false);
  const [showVolume, setShowVolume] = useState(false);

  const handlePlayPause = useCallback(() => {
    if (!remoteState) {
      setShowPicker(true);
      return;
    }
    if (remoteState.isPlaying) {
      pause();
    } else {
      resume();
    }
  }, [remoteState, pause, resume]);

  // ── No music yet: empty state ─────────────────────────────────────────

  if (!remoteState && !isMainStage) {
    if (!isModerator) {
      return (
        <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-pnp-surface/30 border border-white/5">
          <svg
            className="w-4 h-4 text-pnp-textSecondary/50 flex-shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 11-.99-3.467l2.31-.66a2.25 2.25 0 001.632-2.163zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 01-.99-3.467l2.31-.66A2.25 2.25 0 009 15.553z"
            />
          </svg>
          <span className="text-[10px] text-pnp-textSecondary/50 italic">
            Waiting for music...
          </span>
        </div>
      );
    }

    return (
      <>
        <button
          onClick={() => setShowPicker(true)}
          className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl bg-pnp-surface/30 border border-dashed border-pnp-accent/30 hover:bg-pnp-surface/50 hover:border-pnp-accent/60 active:scale-[0.99] transition-all"
        >
          <svg
            className="w-4 h-4 text-pnp-accent/60 flex-shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 11-.99-3.467l2.31-.66a2.25 2.25 0 001.632-2.163zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 01-.99-3.467l2.31-.66A2.25 2.25 0 009 15.553z"
            />
          </svg>
          <span className="text-[11px] text-pnp-accent/70 font-medium">
            Start music for everyone
          </span>
          <svg
            className="w-3.5 h-3.5 text-pnp-accent/50 ml-auto"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 4.5v15m7.5-7.5h-15"
            />
          </svg>
        </button>

        {showPicker && (
          <TrackPickerModal
            onSelect={playTrack}
            onClose={() => setShowPicker(false)}
          />
        )}
      </>
    );
  }

  // ── Main bar (music playing or main stage placeholder) ────────────────

  const trackTitle =
    remoteState?.trackTitle || (isMainStage ? "Radio PNP" : "—");
  const trackArtist =
    remoteState?.trackArtist || (isMainStage ? "PNPtv!" : "");
  const trackArt = remoteState?.trackArt || null;
  const playing = remoteState?.isPlaying ?? false;

  return (
    <>
      {/* Keyframe for equalizer animation — injected once via a style tag */}
      <style>{`
        @keyframes pnp-eq-bounce {
          from { transform: scaleY(0.4); }
          to   { transform: scaleY(1); }
        }
      `}</style>

      {/* Now-playing bar */}
      <div className="flex items-center gap-2 px-2.5 py-2 rounded-xl bg-pnp-surface/40 border border-white/5">
        {/* Album art / eq overlay */}
        <div className="relative flex-shrink-0 w-8 h-8 rounded overflow-hidden">
          {trackArt ? (
            <img
              src={trackArt}
              alt=""
              className="w-full h-full object-cover"
            />
          ) : (
            <div
              className="w-full h-full flex items-center justify-center"
              style={{ background: "rgba(94,209,196,0.12)" }}
            >
              <svg
                className="w-4 h-4"
                style={{ color: "#5ED1C4" }}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 11-.99-3.467l2.31-.66a2.25 2.25 0 001.632-2.163zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 01-.99-3.467l2.31-.66A2.25 2.25 0 009 15.553z"
                />
              </svg>
            </div>
          )}
          {isLocalPlaying && (
            <div className="absolute inset-0 flex items-end justify-center pb-1 bg-black/40">
              <EqBars active={true} />
            </div>
          )}
        </div>

        {/* Track info */}
        <div className="flex-1 min-w-0">
          {isMainStage && (
            <span
              className="text-[8px] font-bold px-1 py-0.5 rounded"
              style={{
                background: "rgba(94,209,196,0.2)",
                color: "#5ED1C4",
              }}
            >
              RADIO
            </span>
          )}
          <p className="text-[11px] font-medium text-pnp-textPrimary truncate leading-tight">
            {trackTitle}
          </p>
          <p className="text-[9px] text-pnp-textSecondary truncate">
            {trackArtist}
          </p>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {/* Play/pause — moderators in non-main-stage rooms only */}
          {isModerator && !isMainStage && (
            <button
              onClick={handlePlayPause}
              className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-white/10 active:scale-95 transition-all"
              aria-label={playing ? "Pause music" : "Play music"}
            >
              {playing ? (
                <svg
                  className="w-3.5 h-3.5 text-pnp-textPrimary"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                </svg>
              ) : (
                <svg
                  className="w-3.5 h-3.5 text-pnp-textPrimary"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
            </button>
          )}

          {/* Change track — moderators only */}
          {isModerator && (
            <button
              onClick={() => setShowPicker(true)}
              className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-white/10 active:scale-95 transition-all"
              aria-label="Change track"
              title="Change track"
            >
              <svg
                className="w-3.5 h-3.5 text-pnp-textSecondary"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25H12"
                />
              </svg>
            </button>
          )}

          {/* Volume toggle */}
          <button
            onClick={() => setShowVolume((v) => !v)}
            className={`w-7 h-7 flex items-center justify-center rounded-full active:scale-95 transition-all ${
              showVolume ? "bg-white/10" : "hover:bg-white/10"
            }`}
            aria-label="Volume"
          >
            {localVolume === 0 ? (
              <svg
                className="w-3.5 h-3.5 text-pnp-textSecondary"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M17.25 9.75L19.5 12m0 0l2.25 2.25M19.5 12l2.25-2.25M19.5 12l-2.25 2.25m-10.5-6l4.72-4.72a.75.75 0 011.28.531V19.94a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.506-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z"
                />
              </svg>
            ) : (
              <svg
                className="w-3.5 h-3.5 text-pnp-textSecondary"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53L6.75 15.75H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.757 3.63 8.25 4.51 8.25H6.75z"
                />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Inline volume slider — appears below the bar when active */}
      {showVolume && (
        <div className="flex items-center gap-2 px-3 py-1.5">
          <svg
            className="w-3 h-3 text-pnp-textSecondary/50 flex-shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53L6.75 15.75H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.757 3.63 8.25 4.51 8.25H6.75z"
            />
          </svg>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={localVolume}
            onChange={(e) => setLocalVolume(parseFloat(e.target.value))}
            className="flex-1 h-1.5 appearance-none rounded-full cursor-pointer accent-pnp-accent"
            style={{
              background: `linear-gradient(to right, var(--pnp-accent, #5ED1C4) 0%, var(--pnp-accent, #5ED1C4) ${
                localVolume * 100
              }%, rgba(255,255,255,0.1) ${localVolume * 100}%, rgba(255,255,255,0.1) 100%)`,
            }}
            aria-label="Music volume"
          />
          <span className="text-[9px] text-pnp-textSecondary/70 w-6 text-right">
            {Math.round(localVolume * 100)}
          </span>
        </div>
      )}

      {/* Track picker modal */}
      {showPicker && (
        <TrackPickerModal
          onSelect={playTrack}
          onClose={() => setShowPicker(false)}
        />
      )}
    </>
  );
}
