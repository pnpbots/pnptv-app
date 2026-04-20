import { useState, useEffect, useRef, useCallback } from "react";
import { connectSocket } from "@/lib/socket";
import { type MediaTrack } from "@/lib/api";

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

// ── Cristina in-call types ───────────────────────────────────────────────────
export interface CristinaTip {
  content: string;
  at: number;
}

export interface CristinaReply {
  userId: string;
  userName: string;
  prompt: string;
  reply: string;
  at: number;
}

export interface CristinaVideo {
  id: string;
  url: string;
  title: string;
  thumbUrl: string | null;
  durationSec: number | null;
  at: number;
}

export interface CristinaVideoState {
  id: string;
  url: string;
  title: string;
  thumbUrl: string | null;
  startedAt: number;
  startedBy: string;
}

interface UseHangoutMusicOptions {
  groupId: number | null;
  isModerator: boolean;
  // When true, music gain is reduced ~9 dB so a speaker can cut through.
  duckActive?: boolean;
}

export function useHangoutMusic({ groupId, isModerator, duckActive }: UseHangoutMusicOptions) {
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

  // Cristina in-call state
  const [cristinaTip, setCristinaTip] = useState<CristinaTip | null>(null);
  const [cristinaReplies, setCristinaReplies] = useState<CristinaReply[]>([]);
  const [cristinaSuggestion, setCristinaSuggestion] = useState<CristinaVideo | null>(null);
  const [cristinaVideo, setCristinaVideo] = useState<CristinaVideoState | null>(null);
  const [cristinaError, setCristinaError] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const stateRef = useRef<HangoutMusicTrackState | null>(null);

  const groupIdRef = useRef<number | null>(groupId);

  // Web Audio mastering chain (lazy, built on first play)
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const duckGainRef = useRef<GainNode | null>(null);
  const graphFailedRef = useRef(false);
  const volumeRef = useRef(localVolume);

  // Keep stateRef in sync with remoteState
  useEffect(() => {
    stateRef.current = remoteState;
  }, [remoteState]);

  useEffect(() => {
    groupIdRef.current = groupId;
  }, [groupId]);

  useEffect(() => {
    volumeRef.current = localVolume;
  }, [localVolume]);

  const ensureAudioGraph = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || audioCtxRef.current || graphFailedRef.current) return;
    try {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      if (!Ctx) { graphFailedRef.current = true; return; }
      // latencyHint only — do not pin sampleRate: forcing 48 kHz on 44.1 kHz
      // streams triggers resampling that sounded gritty in earlier testing.
      let ctx: AudioContext;
      try { ctx = new Ctx({ latencyHint: "playback" }); } catch { ctx = new Ctx(); }
      const source = ctx.createMediaElementSource(audio);

      // Minimal graph: duck → master → destination. No EQ, no compressor,
      // no make-up gain. The Ampache streams are already mastered; earlier
      // processing was making them sound squashed / pumpy.
      const duck = ctx.createGain();
      duck.gain.value = duckActive ? 0.355 : 1.0;

      const master = ctx.createGain();
      master.gain.value = volumeRef.current;

      source.connect(duck);
      duck.connect(master);
      master.connect(ctx.destination);

      audioCtxRef.current = ctx;
      sourceNodeRef.current = source;
      duckGainRef.current = duck;
      masterGainRef.current = master;
      audio.volume = 1.0;
    } catch {
      graphFailedRef.current = true;
    }
  }, [duckActive]);

  // Smoothly duck/unduck when duckActive toggles
  useEffect(() => {
    const ctx = audioCtxRef.current;
    const duck = duckGainRef.current;
    if (!ctx || !duck) return;
    const target = duckActive ? 0.355 : 1.0;
    duck.gain.setTargetAtTime(target, ctx.currentTime, 0.07);
  }, [duckActive]);

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
      ensureAudioGraph();
      const ctx = audioCtxRef.current;
      if (ctx?.state === "suspended") {
        ctx.resume().catch(() => {});
      }
      audio.play().catch(() => {
        // Autoplay may be blocked; user interaction will unblock on next event
      });
    } else {
      audio.pause();
    }
  }, [ensureAudioGraph]);


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

    const onCristinaTip = (data: { groupId: number; content: string; at: number }) => {
      if (data.groupId !== groupIdRef.current) return;
      setCristinaTip({ content: data.content, at: data.at });
    };
    const onCristinaReply = (data: CristinaReply & { groupId: number }) => {
      if (data.groupId !== groupIdRef.current) return;
      setCristinaReplies((prev) => [...prev.slice(-9), {
        userId: data.userId, userName: data.userName, prompt: data.prompt, reply: data.reply, at: data.at,
      }]);
    };
    const onCristinaVideo = (data: { groupId: number; video: Omit<CristinaVideo, "at">; at: number }) => {
      if (data.groupId !== groupIdRef.current) return;
      setCristinaSuggestion({ ...data.video, at: data.at });
    };
    const onCristinaVideoState = (state: CristinaVideoState | null) => {
      setCristinaVideo(state);
    };
    const onCristinaError = (data: { message: string }) => {
      setCristinaError(data.message);
      setTimeout(() => setCristinaError((cur) => (cur === data.message ? null : cur)), 4000);
    };
    const onCristinaJoined = (data: { groupId: number; greeting: string; at: number }) => {
      if (data.groupId !== groupIdRef.current) return;
      setCristinaTip({ content: data.greeting, at: data.at });
    };

    socket.on("hangout:music:state", onMusicState);
    socket.on("hangout:music:play", onMusicPlay);
    socket.on("hangout:music:pause", onMusicPause);
    socket.on("hangout:music:resume", onMusicResume);
    socket.on("hangout:music:seek", onMusicSeek);
    socket.on("hangout:music:stop", onMusicStop);
    socket.on("hangout:music:shuffle", onMusicShuffle);
    socket.on("hangout:cristina:joined", onCristinaJoined);
    socket.on("hangout:cristina:tip", onCristinaTip);
    socket.on("hangout:cristina:reply", onCristinaReply);
    socket.on("hangout:cristina:video", onCristinaVideo);
    socket.on("hangout:cristina:videoState", onCristinaVideoState);
    socket.on("hangout:cristina:error", onCristinaError);

    return () => {
      socket.off("hangout:music:state", onMusicState);
      socket.off("hangout:music:play", onMusicPlay);
      socket.off("hangout:music:pause", onMusicPause);
      socket.off("hangout:music:resume", onMusicResume);
      socket.off("hangout:music:seek", onMusicSeek);
      socket.off("hangout:music:stop", onMusicStop);
      socket.off("hangout:music:shuffle", onMusicShuffle);
      socket.off("hangout:cristina:joined", onCristinaJoined);
      socket.off("hangout:cristina:tip", onCristinaTip);
      socket.off("hangout:cristina:reply", onCristinaReply);
      socket.off("hangout:cristina:video", onCristinaVideo);
      socket.off("hangout:cristina:videoState", onCristinaVideoState);
      socket.off("hangout:cristina:error", onCristinaError);
    };
  }, [groupId, applyState]);

  const setLocalVolume = useCallback((v: number) => {
    const clamped = Math.max(0, Math.min(1, v));
    setLocalVolumeState(clamped);
    const ctx = audioCtxRef.current;
    const master = masterGainRef.current;
    if (ctx && master) {
      master.gain.setTargetAtTime(clamped, ctx.currentTime, 0.015);
    } else if (audioRef.current) {
      audioRef.current.volume = clamped;
    }
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

  // ── Cristina actions ──────────────────────────────────────────────────────

  const cristinaAttach = useCallback(() => {
    if (!groupId) return;
    const socket = connectSocket();
    socket.emit("hangout:cristina:attach", { groupId });
  }, [groupId]);

  const cristinaAsk = useCallback(
    (prompt: string) => {
      if (!groupId) return;
      const trimmed = prompt.trim();
      if (trimmed.length < 2) return;
      const socket = connectSocket();
      socket.emit("hangout:cristina:ask", { groupId, prompt: trimmed });
    },
    [groupId]
  );

  const cristinaPlayVideo = useCallback(
    (video: { id: string; url: string; title: string; thumbUrl: string | null }) => {
      if (!groupId || !isModerator) return;
      const socket = connectSocket();
      socket.emit("hangout:cristina:videoPlay", { groupId, video });
    },
    [groupId, isModerator]
  );

  const cristinaStopVideo = useCallback(() => {
    if (!groupId || !isModerator) return;
    const socket = connectSocket();
    socket.emit("hangout:cristina:videoStop", { groupId });
  }, [groupId, isModerator]);

  const dismissCristinaSuggestion = useCallback(() => setCristinaSuggestion(null), []);
  const dismissCristinaTip = useCallback(() => setCristinaTip(null), []);

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
    // Cristina
    cristinaTip,
    cristinaReplies,
    cristinaSuggestion,
    cristinaVideo,
    cristinaError,
    cristinaAttach,
    cristinaAsk,
    cristinaPlayVideo,
    cristinaStopVideo,
    dismissCristinaSuggestion,
    dismissCristinaTip,
  };
}
