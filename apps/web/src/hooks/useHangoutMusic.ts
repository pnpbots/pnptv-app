import { useState, useEffect, useRef, useCallback } from "react";
import { connectSocket } from "@/lib/socket";
import { getMediaTracks, type MediaTrack } from "@/lib/api";

export interface HangoutMusicTrackState {
  trackId: string;
  trackUrl: string;
  trackTitle: string;
  trackArtist: string;
  trackArt: string | null;
  isPlaying: boolean;
  position: number;
  startedAt: number | null;
}

interface UseHangoutMusicOptions {
  groupId: number | null;
  isModerator: boolean;
  isMainStage?: boolean;
}

export function useHangoutMusic({ groupId, isModerator, isMainStage }: UseHangoutMusicOptions) {
  const [remoteState, setRemoteState] = useState<HangoutMusicTrackState | null>(null);
  const [localVolume, setLocalVolumeState] = useState<number>(() => {
    const saved = localStorage.getItem("pnp:call:music:volume");
    if (saved) {
      const v = parseFloat(saved);
      return isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.5;
    }
    return 0.5;
  });
  const [isLocalPlaying, setIsLocalPlaying] = useState(false);
  const [shuffle, setShuffle] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const stateRef = useRef<HangoutMusicTrackState | null>(null);
  const mainStageAutoStarted = useRef(false);
  const groupIdRef = useRef<number | null>(groupId);

  // Keep stateRef in sync with remoteState
  useEffect(() => {
    stateRef.current = remoteState;
  }, [remoteState]);

  useEffect(() => {
    groupIdRef.current = groupId;
  }, [groupId]);

  // Create audio element once on mount, destroy on unmount
  useEffect(() => {
    const audio = new Audio();
    audio.volume = localVolume;
    audio.preload = "auto";
    audioRef.current = audio;

    const onPlay = () => setIsLocalPlaying(true);
    const onPause = () => setIsLocalPlaying(false);
    const onEnded = () => {
      setIsLocalPlaying(false);
      const gid = groupIdRef.current;
      if (gid) {
        const s = connectSocket();
        s.emit("hangout:music:ended", { groupId: gid });
      }
    };

    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);

    return () => {
      audio.pause();
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
      audioRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const applyState = useCallback((state: HangoutMusicTrackState) => {
    const audio = audioRef.current;
    if (!audio) return;

    const newSrc = `/api/proxy/media/stream/${state.trackId}`;
    const urlChanged = !audio.src.endsWith(`/stream/${state.trackId}`);
    if (urlChanged) {
      audio.src = newSrc;
      audio.load();
    }

    const expectedPos = state.isPlaying && state.startedAt
      ? state.position + (Date.now() - state.startedAt) / 1000
      : state.position;

    // Only seek if position is off by more than 3 seconds to avoid constant micro-seeks
    if (Math.abs(audio.currentTime - expectedPos) > 3) {
      audio.currentTime = Math.max(0, expectedPos);
    }

    if (state.isPlaying) {
      audio.play().catch(() => {
        // Autoplay may be blocked; user interaction will unblock on next event
      });
    } else {
      audio.pause();
    }
  }, []);

  // Main stage auto-start: if we are the moderator and no music state arrives within 1.5s,
  // automatically start the first available Ampache track as Radio PNP
  useEffect(() => {
    if (!isMainStage || !isModerator || mainStageAutoStarted.current || !groupId) return;

    const timer = setTimeout(async () => {
      if (stateRef.current || mainStageAutoStarted.current) return;
      mainStageAutoStarted.current = true;
      try {
        const res = await getMediaTracks(0, 1);
        if (!res.success || !res.tracks?.length) return;
        const track = res.tracks[0];
        const artistName = typeof track.artist === "string"
          ? track.artist
          : (track.artist as { name: string })?.name || "Unknown";
        const socket = connectSocket();
        socket.emit("hangout:music:play", {
          groupId,
          trackId: track.id,
          trackUrl: `/api/proxy/media/stream/${track.id}`,
          trackTitle: track.title,
          trackArtist: artistName,
          trackArt: track.art || null,
        });
      } catch {
        // Silent — non-critical feature
      }
    }, 1500);

    return () => clearTimeout(timer);
  }, [isMainStage, isModerator, groupId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Socket event subscriptions
  useEffect(() => {
    if (!groupId) return;
    const socket = connectSocket();

    const onMusicState = (data: HangoutMusicTrackState & { shuffle?: boolean }) => {
      setRemoteState(data);
      applyState(data);
      if (typeof data.shuffle === "boolean") setShuffle(data.shuffle);
    };

    const onMusicPlay = (data: HangoutMusicTrackState) => {
      setRemoteState(data);
      applyState(data);
    };

    const onMusicPause = (data: { position: number }) => {
      setRemoteState((prev) =>
        prev ? { ...prev, isPlaying: false, position: data.position, startedAt: null } : prev
      );
      const audio = audioRef.current;
      if (audio) {
        audio.currentTime = Math.max(0, data.position);
        audio.pause();
      }
    };

    const onMusicResume = (data: { position: number; startedAt: number; trackId: string }) => {
      setRemoteState((prev) =>
        prev ? { ...prev, isPlaying: true, position: data.position, startedAt: data.startedAt } : prev
      );
      const audio = audioRef.current;
      if (audio) {
        const expectedPos = data.position + (Date.now() - data.startedAt) / 1000;
        if (Math.abs(audio.currentTime - expectedPos) > 2) {
          audio.currentTime = Math.max(0, expectedPos);
        }
        audio.play().catch(() => {});
      }
    };

    const onMusicSeek = (data: { position: number; startedAt: number | null }) => {
      setRemoteState((prev) =>
        prev ? { ...prev, position: data.position, startedAt: data.startedAt } : prev
      );
      const audio = audioRef.current;
      if (audio) {
        const expectedPos = data.startedAt
          ? data.position + (Date.now() - data.startedAt) / 1000
          : data.position;
        audio.currentTime = Math.max(0, expectedPos);
      }
    };

    const onMusicStop = () => {
      setRemoteState(null);
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        audio.src = "";
      }
    };

    const onMusicShuffle = (data: { shuffle: boolean }) => {
      setShuffle(data.shuffle);
    };

    socket.on("hangout:music:state", onMusicState);
    socket.on("hangout:music:play", onMusicPlay);
    socket.on("hangout:music:pause", onMusicPause);
    socket.on("hangout:music:resume", onMusicResume);
    socket.on("hangout:music:seek", onMusicSeek);
    socket.on("hangout:music:stop", onMusicStop);
    socket.on("hangout:music:shuffle", onMusicShuffle);

    return () => {
      socket.off("hangout:music:state", onMusicState);
      socket.off("hangout:music:play", onMusicPlay);
      socket.off("hangout:music:pause", onMusicPause);
      socket.off("hangout:music:resume", onMusicResume);
      socket.off("hangout:music:seek", onMusicSeek);
      socket.off("hangout:music:stop", onMusicStop);
      socket.off("hangout:music:shuffle", onMusicShuffle);
    };
  }, [groupId, applyState]);

  const setLocalVolume = useCallback((v: number) => {
    const clamped = Math.max(0, Math.min(1, v));
    setLocalVolumeState(clamped);
    if (audioRef.current) audioRef.current.volume = clamped;
    localStorage.setItem("pnp:call:music:volume", String(clamped));
  }, []);

  const playTrack = useCallback(
    (track: MediaTrack) => {
      if (!groupId || !isModerator) return;
      const artistName = typeof track.artist === "string"
        ? track.artist
        : (track.artist as { name: string })?.name || "Unknown";
      const socket = connectSocket();
      socket.emit("hangout:music:play", {
        groupId,
        trackId: track.id,
        trackUrl: `/api/proxy/media/stream/${track.id}`,
        trackTitle: track.title,
        trackArtist: artistName,
        trackArt: track.art || null,
      });
    },
    [groupId, isModerator]
  );

  const pause = useCallback(() => {
    if (!groupId || !isModerator) return;
    const audio = audioRef.current;
    const socket = connectSocket();
    socket.emit("hangout:music:pause", { groupId, position: audio?.currentTime ?? 0 });
  }, [groupId, isModerator]);

  const resume = useCallback(() => {
    if (!groupId || !isModerator) return;
    const audio = audioRef.current;
    const socket = connectSocket();
    socket.emit("hangout:music:resume", { groupId, position: audio?.currentTime ?? 0 });
  }, [groupId, isModerator]);

  const seek = useCallback(
    (position: number) => {
      if (!groupId || !isModerator) return;
      const socket = connectSocket();
      socket.emit("hangout:music:seek", { groupId, position });
    },
    [groupId, isModerator]
  );

  const stop = useCallback(() => {
    if (!groupId || !isModerator) return;
    const socket = connectSocket();
    socket.emit("hangout:music:stop", { groupId });
  }, [groupId, isModerator]);

  const toggleShuffle = useCallback(() => {
    if (!groupId || !isModerator) return;
    const socket = connectSocket();
    socket.emit("hangout:music:shuffle", { groupId });
  }, [groupId, isModerator]);

  return {
    remoteState,
    localVolume,
    setLocalVolume,
    isLocalPlaying,
    playTrack,
    pause,
    resume,
    seek,
    stop,
    shuffle,
    toggleShuffle,
  };
}
