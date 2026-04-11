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
  retryLoad: () => void;
}

type MusicPlayerContextType = MusicPlayerState & MusicPlayerActions;

const MusicPlayerContext = createContext<MusicPlayerContextType | null>(null);

export function MusicPlayerProvider({ children }: { children: React.ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const soundcloudPlayerRef = useRef<any>(null);
  const scIframeRef = useRef<HTMLIFrameElement | null>(null);
  const nextRef = useRef<() => void>(() => {});
  const prevRef = useRef<() => void>(() => {});
  const playGenRef = useRef(0);
  const loadingRef = useRef(false);
  const handleTrackEndRef = useRef<() => void>(() => {});
  const currentTrackRef = useRef<MediaTrack | null>(null);

  const [tracks, setTracks] = useState<MediaTrack[]>([]);
  const [currentTrack, setCurrentTrack] = useState<MediaTrack | null>(null);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(() => {
    try {
      const saved = localStorage.getItem("pnp:music:volume");
      if (saved) {
        const parsed = parseFloat(saved);
        return isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : 0.7;
      }
    } catch {
      // Telegram in-app browsers can throw SecurityError on localStorage access
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

  // Audio element singleton — created once, never torn down until unmount
  useEffect(() => {
    const audio = new Audio();
    audio.volume = volume;
    audioRef.current = audio;

    const onTimeUpdate = () => {
      if (currentTrackRef.current?.provider !== "soundcloud") {
        setProgress(audio.currentTime);
      }
    };
    const onDurationChange = () => {
      if (currentTrackRef.current?.provider !== "soundcloud") {
        setDuration(audio.duration || 0);
      }
    };
    const onCanPlay = () => setIsLoading(false);
    const onWaiting = () => setIsLoading(true);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    // Use ref to avoid stale closure on ended
    const onEnded = () => handleTrackEndRef.current();

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("durationchange", onDurationChange);
    audio.addEventListener("canplay", onCanPlay);
    audio.addEventListener("waiting", onWaiting);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);

    return () => {
      audio.pause();
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("durationchange", onDurationChange);
      audio.removeEventListener("canplay", onCanPlay);
      audio.removeEventListener("waiting", onWaiting);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync volume to audio element when it changes
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

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

  // Keep refs current (runs after every render with no dep array)
  useEffect(() => {
    handleTrackEndRef.current = handleTrackEnd;
    currentTrackRef.current = currentTrack;
  });

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

  // MediaSession API — update lock-screen controls when track changes
  useEffect(() => {
    if (!currentTrack || !("mediaSession" in navigator)) return;
    const artistName = typeof currentTrack.artist === "string"
      ? currentTrack.artist
      : (currentTrack.artist as { name: string } | undefined)?.name ?? "";
    navigator.mediaSession.metadata = new MediaMetadata({
      title: currentTrack.title ?? "",
      artist: artistName,
      artwork: currentTrack.art ? [{ src: currentTrack.art, sizes: "256x256", type: "image/png" }] : [],
    });
    navigator.mediaSession.setActionHandler("play", () => { audioRef.current?.play().catch(() => {}); });
    navigator.mediaSession.setActionHandler("pause", () => { audioRef.current?.pause(); });
    navigator.mediaSession.setActionHandler("previoustrack", () => { prevRef.current(); });
    navigator.mediaSession.setActionHandler("nexttrack", () => { nextRef.current(); });
    navigator.mediaSession.setActionHandler("seekbackward", (d) => {
      const audio = audioRef.current;
      if (audio) audio.currentTime = Math.max(0, audio.currentTime - (d.seekOffset ?? 10));
    });
    navigator.mediaSession.setActionHandler("seekforward", (d) => {
      const audio = audioRef.current;
      if (audio) audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + (d.seekOffset ?? 10));
    });
  }, [currentTrack]);

  // Hidden SoundCloud iframe — created on first use only, not on mount.
  // The iframe is injected the first time a SoundCloud track is played,
  // using that track's URL so the widget initializes with valid content.
  const ensureScIframe = useCallback((trackUrl: string): HTMLIFrameElement => {
    let iframe = document.getElementById("soundcloud-player") as HTMLIFrameElement | null;
    if (!iframe) {
      iframe = document.createElement("iframe");
      iframe.id = "soundcloud-player";
      iframe.allow = "autoplay";
      iframe.style.cssText = "display:none;position:absolute;width:0;height:0;border:0;";
      // Initialize with the actual track URL so SC.Widget can bind properly.
      const encoded = encodeURIComponent(trackUrl);
      iframe.src = `https://w.soundcloud.com/player/?url=${encoded}&auto_play=false&show_artwork=false`;
      document.body.appendChild(iframe);
      scIframeRef.current = iframe;
    }
    return iframe;
  }, []);

  // Lazily load the SoundCloud Widget API script (no iframe yet — deferred until first play).
  // The script is fetched once; subsequent calls reuse the existing <script> tag.
  const ensureScApi = useCallback((onReady: () => void) => {
    if (window.SC) {
      onReady();
      return;
    }
    const existing = document.querySelector('script[src*="soundcloud.com/player/api.js"]') as HTMLScriptElement | null;
    if (existing) {
      // Script already in DOM but may still be loading
      if ((existing as any)._scLoaded) {
        onReady();
      } else {
        existing.addEventListener("load", onReady, { once: true });
      }
      return;
    }
    const script = document.createElement("script");
    script.src = "https://w.soundcloud.com/player/api.js";
    script.async = true;
    script.onload = () => {
      (script as any)._scLoaded = true;
      onReady();
    };
    document.body.appendChild(script);
  }, []);

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
        const trackUrl = track.url;
        // Ensure the API script is loaded, then ensure the iframe exists and bind the widget.
        ensureScApi(() => {
          if (gen !== playGenRef.current) return;
          // Pass the actual track URL so the iframe initializes with valid SC content.
          const iframe = ensureScIframe(trackUrl);

          const initAndPlay = () => {
            if (gen !== playGenRef.current) return;
            // If widget not yet bound to this iframe, create it now.
            if (!soundcloudPlayerRef.current) {
              soundcloudPlayerRef.current = window.SC.Widget(iframe);
              soundcloudPlayerRef.current.bind(window.SC.Widget.Events.FINISH, () => handleTrackEnd());
              soundcloudPlayerRef.current.bind(window.SC.Widget.Events.PLAY, () => setIsPlaying(true));
              soundcloudPlayerRef.current.bind(window.SC.Widget.Events.PAUSE, () => setIsPlaying(false));
              soundcloudPlayerRef.current.bind(window.SC.Widget.Events.READY, () => {
                soundcloudPlayerRef.current?.setVolume(volume * 100);
                // The first track was loaded via the iframe src, so just play it.
                soundcloudPlayerRef.current?.play();
                setIsPlaying(true);
                setIsLoading(false);
              });
              return; // READY event will handle first play
            }
            // Widget already exists — load the new track
            soundcloudPlayerRef.current.load(trackUrl, {
              auto_play: true,
              show_artwork: true,
              callback: () => {
                if (gen !== playGenRef.current) return;
                setIsPlaying(true);
                setIsLoading(false);
                soundcloudPlayerRef.current?.setVolume(volume * 100);
              },
            });
          };

          // The iframe needs a moment to load its own document before SC.Widget can bind to it.
          if (iframe.contentWindow && iframe.contentDocument?.readyState === "complete") {
            initAndPlay();
          } else {
            iframe.addEventListener("load", initAndPlay, { once: true });
          }
        });
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
  }, [volume, ensureScApi, ensureScIframe, handleTrackEnd]);

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
  useEffect(() => { prevRef.current = prev; }, [prev]);

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
    try { localStorage.setItem("pnp:music:volume", String(clamped)); } catch { /* SecurityError in Telegram browsers */ }
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

  const retryLoad = useCallback(() => {
    setLoadError(null);
    setTracks([]);
    offsetRef.current = 0;
    setHasMore(true);
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

  const value: MusicPlayerContextType = {
    tracks, currentTrack, currentIndex, isPlaying, progress, duration,
    volume, shuffle, repeat, isLoading, isLoadingTracks, hasMore, loadError,
    play, pause, togglePlay, next, prev, seek, setVolume,
    toggleShuffle, toggleRepeat, loadMore, retryLoad,
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
