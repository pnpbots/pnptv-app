import React, { createContext, useContext, useState, useRef, useCallback, useEffect } from "react";
import { getMediaTracks, type MediaTrack } from "@/lib/api";

declare global {
  interface Window {
    SC: any;
  }
}

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
  const soundcloudPlayerRef = useRef<any>(null);
  const scIframeRef = useRef<HTMLIFrameElement | null>(null);
  const nextRef = useRef<() => void>(() => {});
  const playGenRef = useRef(0);
  const loadingRef = useRef(false);

  const [tracks, setTracks] = useState<MediaTrack[]>([]);
  const [currentTrack, setCurrentTrack] = useState<MediaTrack | null>(null);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
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
  const [loadError, setLoadError] = useState<string | null>(null);
  const offsetRef = useRef(0);
  const shuffleHistoryRef = useRef<number[]>([]);

  // Local audio element effects
  useEffect(() => {
    const audio = new Audio();
    audio.volume = volume;
    audioRef.current = audio;

    const onTimeUpdate = () => {
      if (currentTrack?.provider !== "soundcloud") {
        setProgress(audio.currentTime);
      }
    };
    const onDurationChange = () => {
      if (currentTrack?.provider !== "soundcloud") {
        setDuration(audio.duration || 0);
      }
    };
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
  }, [currentTrack]);

  // Handle track ended
  const handleTrackEnd = useCallback(() => {
    if (repeat === "one") {
      if (currentTrack?.provider === "soundcloud") {
        soundcloudPlayerRef.current?.seekTo(0);
        soundcloudPlayerRef.current?.play();
      } else {
        const audio = audioRef.current;
        if (audio) {
          audio.currentTime = 0;
          audio.play().catch(() => {});
        }
      }
      return;
    }
    nextRef.current();
  }, [repeat, currentTrack]);

  // Audio element ended event
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onEnded = () => handleTrackEnd();
    audio.addEventListener("ended", onEnded);
    return () => audio.removeEventListener("ended", onEnded);
  }, [handleTrackEnd]);

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
      .catch(() => { setLoadError("Music service unavailable"); })
      .finally(() => setIsLoadingTracks(false));
  }, []);

  // Hidden SoundCloud iframe — must exist before Widget API initializes
  useEffect(() => {
    let iframe = document.getElementById("soundcloud-player") as HTMLIFrameElement | null;
    if (!iframe) {
      iframe = document.createElement("iframe");
      iframe.id = "soundcloud-player";
      iframe.allow = "autoplay";
      iframe.style.display = "none";
      iframe.src = "https://w.soundcloud.com/player/?url=https%3A//api.soundcloud.com/tracks/1";
      document.body.appendChild(iframe);
    }
    scIframeRef.current = iframe;
    return () => {
      if (iframe && iframe.parentNode) iframe.parentNode.removeChild(iframe);
      scIframeRef.current = null;
    };
  }, []);

  // SoundCloud Widget API loading — initializes widget on the iframe
  useEffect(() => {
    const initWidget = () => {
      if (!scIframeRef.current) return;
      soundcloudPlayerRef.current = window.SC.Widget(scIframeRef.current);
      soundcloudPlayerRef.current.bind(window.SC.Widget.Events.FINISH, () => {
        handleTrackEnd();
      });
      soundcloudPlayerRef.current.bind(window.SC.Widget.Events.PLAY, () => setIsPlaying(true));
      soundcloudPlayerRef.current.bind(window.SC.Widget.Events.PAUSE, () => setIsPlaying(false));
      soundcloudPlayerRef.current.bind(window.SC.Widget.Events.READY, () => {
        soundcloudPlayerRef.current.setVolume(volume * 100);
      });
    };

    if (window.SC) {
      initWidget();
      return;
    }

    const existing = document.querySelector('script[src*="soundcloud.com/player/api.js"]');
    if (existing) {
      existing.addEventListener("load", initWidget);
      return () => existing.removeEventListener("load", initWidget);
    }

    const script = document.createElement("script");
    script.src = "https://w.soundcloud.com/player/api.js";
    script.async = true;
    script.onload = initWidget;
    document.body.appendChild(script);
  }, [handleTrackEnd, volume]);

  // Poll SoundCloud position/duration
  useEffect(() => {
    let interval: any;
    if (isPlaying && currentTrack?.provider === "soundcloud" && soundcloudPlayerRef.current) {
      interval = setInterval(() => {
        soundcloudPlayerRef.current.getPosition((ms: number) => {
          setProgress(ms / 1000);
        });
        soundcloudPlayerRef.current.getDuration((ms: number) => {
          setDuration(ms / 1000);
        });
      }, 500);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isPlaying, currentTrack]);

  const playTrack = useCallback(async (track: MediaTrack) => {
    const audio = audioRef.current;
    if (!audio) return;
    const gen = ++playGenRef.current;
    setIsLoading(true);
    setCurrentTrack(track);

    try {
      // Stop other players
      audio.pause();
      if (soundcloudPlayerRef.current) soundcloudPlayerRef.current.pause();

      if (track.provider === "soundcloud" && track.url) {
        const scPlayer = soundcloudPlayerRef.current;
        if (scPlayer) {
          scPlayer.load(track.url, {
            auto_play: true,
            show_artwork: true,
            callback: () => {
              if (gen !== playGenRef.current) return;
              setIsPlaying(true);
              setIsLoading(false);
              scPlayer.setVolume(volume * 100);
            }
          });
        } else {
          // Widget not ready yet — retry after a short delay
          setTimeout(() => {
            if (gen !== playGenRef.current) return;
            const retryPlayer = soundcloudPlayerRef.current;
            if (retryPlayer) {
              retryPlayer.load(track.url!, {
                auto_play: true,
                callback: () => {
                  if (gen !== playGenRef.current) return;
                  setIsPlaying(true);
                  setIsLoading(false);
                  retryPlayer.setVolume(volume * 100);
                }
              });
            } else {
              setIsLoading(false);
            }
          }, 1500);
        }
      } else if (track.url && (track.url.startsWith("http") || track.url.startsWith("/"))) {
        // Direct URL playback (non-SoundCloud with a playable URL)
        audio.src = track.url;
        audio.volume = volume;
        await audio.play();
      } else {
        // No playable source
        setIsLoading(false);
      }
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
      if (currentTrack.provider === "soundcloud") {
        soundcloudPlayerRef.current?.play();
      } else {
        audioRef.current?.play().catch(() => {});
      }
    } else if (list.length > 0) {
      setCurrentIndex(0);
      playTrack(list[0]);
    }
  }, [tracks, currentTrack, playTrack]);

  const pause = useCallback(() => {
    audioRef.current?.pause();
    if (soundcloudPlayerRef.current) {
      soundcloudPlayerRef.current.pause();
    }
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
    
    // SoundCloud logic
    if (currentTrack?.provider === "soundcloud") {
      soundcloudPlayerRef.current?.getPosition((ms: number) => {
        if (ms > 3000) {
          soundcloudPlayerRef.current?.seekTo(0);
        } else {
          const prevIdx = currentIndex - 1;
          if (prevIdx >= 0) {
            setCurrentIndex(prevIdx);
            playTrack(tracks[prevIdx]);
          } else if (repeat === "all") {
            const last = tracks.length - 1;
            setCurrentIndex(last);
            playTrack(tracks[last]);
          }
        }
      });
      return;
    }

    const audio = audioRef.current;
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
  }, [tracks, currentIndex, repeat, playTrack, currentTrack]);

  useEffect(() => { nextRef.current = next; }, [next]);

  const seek = useCallback((time: number) => {
    if (currentTrack?.provider === "soundcloud") {
      soundcloudPlayerRef.current?.seekTo(time * 1000);
    } else {
      const audio = audioRef.current;
      if (audio) audio.currentTime = time;
    }
  }, [currentTrack]);

  const setVolume = useCallback((v: number) => {
    const clamped = Math.max(0, Math.min(1, v));
    setVolumeState(clamped);
    if (audioRef.current) audioRef.current.volume = clamped;
    if (soundcloudPlayerRef.current) {
      soundcloudPlayerRef.current.setVolume(clamped * 100);
    }
    localStorage.setItem("pnp:music:volume", String(clamped));
  }, []);

  const toggleShuffle = useCallback(() => {
    setShuffle((s) => !s);
    shuffleHistoryRef.current = [];
  }, []);

  const toggleRepeat = useCallback(() => {
    setRepeat((r) => (r === "off" ? "all" : r === "all" ? "one" : "off"));
  }, []);

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
