import React, { createContext, useContext, useState, useRef, useCallback, useEffect } from "react";
import { getMediaTracks, type MediaTrack } from "@/lib/api";

interface MusicPlayerState {
  tracks: MediaTrack[];
  currentTrack: MediaTrack | null;
  currentIndex: number;
  isPlaying: boolean;
  progress: number;
  duration: number;
  volume: number;
  shuffle: boolean;
  repeat: "off" | "all" | "one";
  isLoading: boolean;
  isLoadingTracks: boolean;
  hasMore: boolean;
  loadError: string | null;
}

interface MusicPlayerActions {
  play: (track?: MediaTrack, playlist?: MediaTrack[]) => void;
  pause: () => void;
  togglePlay: () => void;
  next: () => void;
  prev: () => void;
  seek: (time: number) => void;
  setVolume: (v: number) => void;
  toggleShuffle: () => void;
  toggleRepeat: () => void;
  loadMore: () => void;
}

type MusicPlayerContextType = MusicPlayerState & MusicPlayerActions;

const MusicPlayerContext = createContext<MusicPlayerContextType | null>(null);

export function MusicPlayerProvider({ children }: { children: React.ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Fix 2: ref so handleTrackEnd always calls the latest next()
  const nextRef = useRef<() => void>(() => {});
  // Fix 4: generation counter to guard against stale async responses
  const playGenRef = useRef(0);
  // Fix 8: ref to prevent duplicate concurrent loadMore requests
  const loadingRef = useRef(false);

  const [tracks, setTracks] = useState<MediaTrack[]>([]);
  const [currentTrack, setCurrentTrack] = useState<MediaTrack | null>(null);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  // Fix 3: validate localStorage volume — clamp to [0,1], reject NaN/Infinity
  const [volume, setVolumeState] = useState(() => {
    const saved = localStorage.getItem("pnp:music:volume");
    if (saved) {
      const parsed = parseFloat(saved);
      return isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : 0.7;
    }
    return 0.7;
  });
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<"off" | "all" | "one">("off");
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingTracks, setIsLoadingTracks] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  // Fix 5: error state for when Ampache is down
  const [loadError, setLoadError] = useState<string | null>(null);
  const offsetRef = useRef(0);
  const shuffleHistoryRef = useRef<number[]>([]);

  // Create audio element once — Fix 1: no ended listener here; handled by the
  // re-attach effect below so the closure always reflects the current repeat value.
  useEffect(() => {
    const audio = new Audio();
    audio.volume = volume;
    audioRef.current = audio;

    const onTimeUpdate = () => setProgress(audio.currentTime);
    const onDurationChange = () => setDuration(audio.duration || 0);
    const onCanPlay = () => setIsLoading(false);
    const onWaiting = () => setIsLoading(true);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("durationchange", onDurationChange);
    audio.addEventListener("canplay", onCanPlay);
    audio.addEventListener("waiting", onWaiting);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);

    return () => {
      audio.pause();
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("durationchange", onDurationChange);
      audio.removeEventListener("canplay", onCanPlay);
      audio.removeEventListener("waiting", onWaiting);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Load initial tracks
  useEffect(() => {
    setIsLoadingTracks(true);
    getMediaTracks(0, 30)
      .then((res) => {
        if (res.success && res.tracks?.length) {
          setTracks(res.tracks);
          offsetRef.current = res.tracks.length;
          setHasMore(res.tracks.length >= 30);
        }
      })
      // Fix 5: surface Ampache unavailability instead of silently swallowing
      .catch(() => { setLoadError("Music service unavailable"); })
      .finally(() => setIsLoadingTracks(false));
  }, []);

  // Fix 7: MediaSession — metadata only, re-runs when track changes
  useEffect(() => {
    if (!currentTrack || !("mediaSession" in navigator)) return;
    const artistName = typeof currentTrack.artist === "string"
      ? currentTrack.artist
      : currentTrack.artist?.name || "Unknown";
    navigator.mediaSession.metadata = new MediaMetadata({
      title: currentTrack.title,
      artist: artistName,
      artwork: currentTrack.art ? [{ src: currentTrack.art, sizes: "256x256" }] : [],
    });
  }, [currentTrack]);

  // Fix 7: MediaSession action handlers — separate effect so prev/next are fresh
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.setActionHandler("play", () => audioRef.current?.play());
    navigator.mediaSession.setActionHandler("pause", () => audioRef.current?.pause());
    navigator.mediaSession.setActionHandler("previoustrack", () => prev());
    navigator.mediaSession.setActionHandler("nexttrack", () => next());
  }, [prev, next]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fix 2: keep nextRef current so handleTrackEnd always calls the latest next()
  useEffect(() => { nextRef.current = next; }, [next]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fix 1+2: handleTrackEnd uses nextRef — no stale closure on next()
  const handleTrackEnd = useCallback(() => {
    if (repeat === "one") {
      const audio = audioRef.current;
      if (audio) {
        audio.currentTime = 0;
        audio.play().catch(() => {});
      }
      return;
    }
    nextRef.current();
  }, [repeat]);

  // Re-attach ended handler whenever handleTrackEnd changes (i.e. repeat changes)
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onEnded = () => handleTrackEnd();
    audio.addEventListener("ended", onEnded);
    return () => audio.removeEventListener("ended", onEnded);
  }, [handleTrackEnd]);

  // Fix 4: playTrack uses a generation counter to drop stale responses
  const playTrack = useCallback(async (track: MediaTrack) => {
    const audio = audioRef.current;
    if (!audio) return;
    const gen = ++playGenRef.current;
    setIsLoading(true);
    setCurrentTrack(track);
    try {
      // Point directly at the proxy endpoint — backend streams audio.
      // This avoids the Docker-internal URL that getMediaStreamUrl() returns,
      // which is unreachable from the browser.
      audio.src = `/api/proxy/media/stream/${track.id}`;
      audio.volume = volume;
      await audio.play();
    } catch {
      if (gen === playGenRef.current) setIsLoading(false);
    }
  }, [volume]);

  const play = useCallback((track?: MediaTrack, playlist?: MediaTrack[]) => {
    if (playlist) {
      setTracks(playlist);
      offsetRef.current = playlist.length;
    }
    const list = playlist || tracks;
    if (track) {
      const idx = list.findIndex((t) => t.id === track.id);
      setCurrentIndex(idx >= 0 ? idx : 0);
      playTrack(track);
    } else if (currentTrack) {
      audioRef.current?.play().catch(() => {});
    } else if (list.length > 0) {
      setCurrentIndex(0);
      playTrack(list[0]);
    }
  }, [tracks, currentTrack, playTrack]);

  const pause = useCallback(() => {
    audioRef.current?.pause();
  }, []);

  const togglePlay = useCallback(() => {
    if (isPlaying) {
      pause();
    } else {
      play();
    }
  }, [isPlaying, play, pause]);

  const getNextIndex = useCallback((list: MediaTrack[], current: number): number => {
    if (shuffle) {
      const remaining = list.map((_, i) => i).filter((i) => i !== current);
      if (remaining.length === 0) return 0;
      return remaining[Math.floor(Math.random() * remaining.length)];
    }
    const nextIdx = current + 1;
    if (nextIdx >= list.length) {
      return repeat === "all" ? 0 : -1;
    }
    return nextIdx;
  }, [shuffle, repeat]);

  const next = useCallback(() => {
    if (tracks.length === 0) return;
    const nextIdx = getNextIndex(tracks, currentIndex);
    if (nextIdx === -1) {
      setIsPlaying(false);
      return;
    }
    setCurrentIndex(nextIdx);
    playTrack(tracks[nextIdx]);
  }, [tracks, currentIndex, getNextIndex, playTrack]);

  const prev = useCallback(() => {
    if (tracks.length === 0) return;
    const audio = audioRef.current;
    // If more than 3s in, restart current track
    if (audio && audio.currentTime > 3) {
      audio.currentTime = 0;
      return;
    }
    const prevIdx = currentIndex - 1;
    if (prevIdx < 0) {
      if (repeat === "all") {
        const last = tracks.length - 1;
        setCurrentIndex(last);
        playTrack(tracks[last]);
      }
      return;
    }
    setCurrentIndex(prevIdx);
    playTrack(tracks[prevIdx]);
  }, [tracks, currentIndex, repeat, playTrack]);

  const seek = useCallback((time: number) => {
    const audio = audioRef.current;
    if (audio) audio.currentTime = time;
  }, []);

  const setVolume = useCallback((v: number) => {
    const clamped = Math.max(0, Math.min(1, v));
    setVolumeState(clamped);
    if (audioRef.current) audioRef.current.volume = clamped;
    localStorage.setItem("pnp:music:volume", String(clamped));
  }, []);

  const toggleShuffle = useCallback(() => {
    setShuffle((s) => !s);
    shuffleHistoryRef.current = [];
  }, []);

  const toggleRepeat = useCallback(() => {
    setRepeat((r) => (r === "off" ? "all" : r === "all" ? "one" : "off"));
  }, []);

  // Fix 8: loadingRef prevents duplicate concurrent requests
  const loadMore = useCallback(() => {
    if (loadingRef.current || !hasMore) return;
    loadingRef.current = true;
    setIsLoadingTracks(true);
    getMediaTracks(offsetRef.current, 30)
      .then((res) => {
        if (res.success && res.tracks?.length) {
          setTracks((prev) => {
            const ids = new Set(prev.map((t) => t.id));
            const newTracks = res.tracks.filter((t) => !ids.has(t.id));
            return [...prev, ...newTracks];
          });
          offsetRef.current += res.tracks.length;
          setHasMore(res.tracks.length >= 30);
        } else {
          setHasMore(false);
        }
      })
      .catch(() => {})
      .finally(() => {
        loadingRef.current = false;
        setIsLoadingTracks(false);
      });
  }, [hasMore]);

  const value: MusicPlayerContextType = {
    tracks, currentTrack, currentIndex, isPlaying, progress, duration,
    volume, shuffle, repeat, isLoading, isLoadingTracks, hasMore, loadError,
    play, pause, togglePlay, next, prev, seek, setVolume,
    toggleShuffle, toggleRepeat, loadMore,
  };

  return (
    <MusicPlayerContext.Provider value={value}>
      {children}
    </MusicPlayerContext.Provider>
  );
}

export function useMusicPlayer() {
  const ctx = useContext(MusicPlayerContext);
  if (!ctx) throw new Error("useMusicPlayer must be used within MusicPlayerProvider");
  return ctx;
}
