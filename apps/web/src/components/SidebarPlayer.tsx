import React, { useState, useRef } from "react";
import { useMusicPlayer } from "@/hooks/useMusicPlayer";

function formatTime(s: number) {
  if (!s || !isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function ArtistName({ artist }: { artist: { name: string } | string | undefined }) {
  if (!artist) return null;
  const name = typeof artist === "string" ? artist : artist.name;
  return <span className="text-[11px] text-pnp-textSecondary truncate block">{name}</span>;
}

// ── Playlist Panel ──────────────────────────────────────────────────────────

function PlaylistPanel({ onClose }: { onClose: () => void }) {
  const { tracks, currentTrack, play, isLoadingTracks, hasMore, loadMore } = useMusicPlayer();
  const listRef = useRef<HTMLDivElement>(null);

  const handleScroll = () => {
    const el = listRef.current;
    if (!el || !hasMore || isLoadingTracks) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 40) {
      loadMore();
    }
  };

  return (
    <div className="border-t border-pnp-border">
      <div className="flex items-center justify-between px-3 py-1.5">
        <span className="text-[11px] font-medium text-pnp-textSecondary uppercase tracking-wider">
          Playlist ({tracks.length})
        </span>
        <button
          onClick={onClose}
          className="text-pnp-textSecondary hover:text-pnp-textPrimary p-0.5"
          aria-label="Close playlist"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div
        ref={listRef}
        onScroll={handleScroll}
        className="max-h-48 overflow-y-auto scrollbar-thin"
      >
        {tracks.map((track, i) => {
          const isActive = currentTrack?.id === track.id;
          return (
            <button
              key={track.id}
              onClick={() => play(track)}
              className={`w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-white/5 ${
                isActive ? "bg-white/10" : ""
              }`}
            >
              {track.art ? (
                <img src={track.art} alt="" className="w-7 h-7 rounded object-cover flex-shrink-0" />
              ) : (
                <div className="w-7 h-7 rounded bg-pnp-border flex items-center justify-center flex-shrink-0">
                  <svg className="w-3.5 h-3.5 text-pnp-textSecondary" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
                  </svg>
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className={`text-xs truncate ${isActive ? "text-[#D4007A] font-medium" : "text-pnp-textPrimary"}`}>
                  {track.title}
                </p>
                <ArtistName artist={track.artist} />
              </div>
              {isActive && (
                <div className="flex gap-0.5 items-end h-3 flex-shrink-0">
                  <span className="w-0.5 bg-[#D4007A] rounded-full animate-pulse" style={{ height: "8px", animationDelay: "0ms" }} />
                  <span className="w-0.5 bg-[#D4007A] rounded-full animate-pulse" style={{ height: "12px", animationDelay: "150ms" }} />
                  <span className="w-0.5 bg-[#D4007A] rounded-full animate-pulse" style={{ height: "6px", animationDelay: "300ms" }} />
                </div>
              )}
            </button>
          );
        })}
        {isLoadingTracks && (
          <div className="py-2 text-center">
            <div className="w-4 h-4 mx-auto border-2 border-[#D4007A] border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Desktop Sidebar Player ──────────────────────────────────────────────────

export function SidebarPlayer() {
  const {
    currentTrack, isPlaying, progress, duration, volume,
    shuffle, repeat, isLoading,
    togglePlay, next, prev, seek, setVolume,
    toggleShuffle, toggleRepeat, tracks, play,
  } = useMusicPlayer();
  const [showPlaylist, setShowPlaylist] = useState(false);
  const [showVolume, setShowVolume] = useState(false);
  const progressRef = useRef<HTMLDivElement>(null);

  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!duration || !isFinite(duration)) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    seek(ratio * duration);
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setVolume(parseFloat(e.target.value));
  };

  // If no tracks at all, show nothing
  if (tracks.length === 0) return null;

  const hasTrack = !!currentTrack;

  return (
    <div className="border-t border-pnp-border bg-pnp-background/50">
      {/* Playlist panel (above controls) */}
      {showPlaylist && <PlaylistPanel onClose={() => setShowPlaylist(false)} />}

      {/* Track info + controls */}
      <div className="px-3 pt-3 pb-2">
        {/* Track info row */}
        <div className="flex items-center gap-2.5 mb-2">
          {hasTrack && currentTrack.art ? (
            <img
              src={currentTrack.art}
              alt={currentTrack.title}
              className="w-10 h-10 rounded-lg object-cover flex-shrink-0"
            />
          ) : (
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#D4007A]/30 to-[#E69138]/30 flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-[#D4007A]" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
              </svg>
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-pnp-textPrimary truncate">
              {hasTrack ? currentTrack.title : "PNP Radio"}
            </p>
            {hasTrack && <ArtistName artist={currentTrack.artist} />}
            {!hasTrack && (
              <span className="text-[11px] text-pnp-textSecondary">Select a track to play</span>
            )}
          </div>
        </div>

        {/* Progress bar */}
        {hasTrack && (
          <div className="mb-1.5">
            <div
              ref={progressRef}
              className="h-1 bg-pnp-border rounded-full cursor-pointer group"
              onClick={handleProgressClick}
            >
              <div
                className="h-full bg-gradient-to-r from-[#D4007A] to-[#E69138] rounded-full relative transition-all"
                style={{ width: duration ? `${(progress / duration) * 100}%` : "0%" }}
              >
                <div className="absolute right-0 top-1/2 -translate-y-1/2 w-2 h-2 bg-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            </div>
            <div className="flex justify-between mt-0.5">
              <span className="text-[9px] text-pnp-textSecondary/60">{formatTime(progress)}</span>
              <span className="text-[9px] text-pnp-textSecondary/60">{formatTime(duration)}</span>
            </div>
          </div>
        )}

        {/* Controls row */}
        <div className="flex items-center justify-between">
          {/* Shuffle */}
          <button
            onClick={toggleShuffle}
            className={`p-1 rounded transition-colors ${
              shuffle ? "text-[#D4007A]" : "text-pnp-textSecondary hover:text-pnp-textPrimary"
            }`}
            aria-label={shuffle ? "Disable shuffle" : "Enable shuffle"}
          >
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z" />
            </svg>
          </button>

          {/* Prev */}
          <button
            onClick={prev}
            className="p-1 text-pnp-textSecondary hover:text-pnp-textPrimary transition-colors"
            aria-label="Previous track"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
            </svg>
          </button>

          {/* Play/Pause */}
          <button
            onClick={hasTrack ? togglePlay : () => tracks.length > 0 && play(tracks[0])}
            disabled={isLoading && hasTrack}
            className="w-8 h-8 rounded-full bg-gradient-to-r from-[#D4007A] to-[#E69138] flex items-center justify-center text-white hover:brightness-110 transition-all disabled:opacity-50"
            aria-label={isPlaying ? "Pause" : "Play"}
          >
            {isLoading && hasTrack ? (
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : isPlaying ? (
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
              </svg>
            ) : (
              <svg className="w-4 h-4 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>

          {/* Next */}
          <button
            onClick={next}
            className="p-1 text-pnp-textSecondary hover:text-pnp-textPrimary transition-colors"
            aria-label="Next track"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
            </svg>
          </button>

          {/* Repeat */}
          <button
            onClick={toggleRepeat}
            className={`p-1 rounded transition-colors relative ${
              repeat !== "off" ? "text-[#D4007A]" : "text-pnp-textSecondary hover:text-pnp-textPrimary"
            }`}
            aria-label={`Repeat: ${repeat}`}
          >
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z" />
            </svg>
            {repeat === "one" && (
              <span className="absolute -top-0.5 -right-0.5 text-[7px] font-bold text-[#D4007A]">1</span>
            )}
          </button>
        </div>

        {/* Volume + Playlist toggles */}
        <div className="flex items-center gap-1 mt-1.5">
          <button
            onClick={() => setShowVolume(!showVolume)}
            className="p-1 text-pnp-textSecondary hover:text-pnp-textPrimary transition-colors"
            aria-label="Volume"
          >
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
              {volume === 0 ? (
                <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.796 8.796 0 0021 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 003.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" />
              ) : volume < 0.5 ? (
                <path d="M18.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z" />
              ) : (
                <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
              )}
            </svg>
          </button>
          {showVolume && (
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={volume}
              onChange={handleVolumeChange}
              className="flex-1 h-1 accent-[#D4007A] cursor-pointer"
              aria-label="Volume slider"
            />
          )}
          <div className="flex-1" />
          <button
            onClick={() => setShowPlaylist(!showPlaylist)}
            className={`p-1 rounded transition-colors ${
              showPlaylist ? "text-[#D4007A]" : "text-pnp-textSecondary hover:text-pnp-textPrimary"
            }`}
            aria-label={showPlaylist ? "Hide playlist" : "Show playlist"}
          >
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Mobile Mini Player ──────────────────────────────────────────────────────

export function MobilePlayer() {
  const {
    currentTrack, isPlaying, progress, duration, isLoading,
    togglePlay, next, tracks, play,
  } = useMusicPlayer();

  // Don't show if no tracks loaded
  if (tracks.length === 0) return null;

  const hasTrack = !!currentTrack;

  return (
    <div className="lg:hidden border-t border-pnp-border bg-pnp-background/95 backdrop-blur-sm">
      {/* Thin progress bar at top */}
      {hasTrack && (
        <div className="h-0.5 bg-pnp-border">
          <div
            className="h-full bg-gradient-to-r from-[#D4007A] to-[#E69138]"
            style={{ width: duration ? `${(progress / duration) * 100}%` : "0%" }}
          />
        </div>
      )}

      <div className="flex items-center gap-2 px-3 py-2">
        {/* Art */}
        {hasTrack && currentTrack.art ? (
          <img src={currentTrack.art} alt="" className="w-9 h-9 rounded-lg object-cover flex-shrink-0" />
        ) : (
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-[#D4007A]/30 to-[#E69138]/30 flex items-center justify-center flex-shrink-0">
            <svg className="w-4 h-4 text-[#D4007A]" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
            </svg>
          </div>
        )}

        {/* Track info */}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-pnp-textPrimary truncate">
            {hasTrack ? currentTrack.title : "PNP Radio"}
          </p>
          {hasTrack && <ArtistName artist={currentTrack.artist} />}
        </div>

        {/* Play/Pause */}
        <button
          onClick={hasTrack ? togglePlay : () => tracks.length > 0 && play(tracks[0])}
          disabled={isLoading && hasTrack}
          className="w-8 h-8 rounded-full bg-gradient-to-r from-[#D4007A] to-[#E69138] flex items-center justify-center text-white flex-shrink-0"
          aria-label={isPlaying ? "Pause" : "Play"}
        >
          {isLoading && hasTrack ? (
            <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : isPlaying ? (
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>

        {/* Next */}
        <button
          onClick={next}
          className="p-1.5 text-pnp-textSecondary hover:text-pnp-textPrimary transition-colors flex-shrink-0"
          aria-label="Next track"
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
