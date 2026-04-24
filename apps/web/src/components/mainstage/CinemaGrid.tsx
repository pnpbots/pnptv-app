import { useEffect, useRef, useState } from "react";
import {
  ParticipantTile,
  useTracks,
} from "@livekit/components-react";
import type { TrackReferenceOrPlaceholder } from "@livekit/components-react";
import { Track } from "livekit-client";
import Hls from "hls.js";

interface CinemaGridProps {
  mediaIdentity: string;
  mediaKind: "video" | "music" | "off";
  mediaSrc: string | null;
  mediaPlaying?: boolean;
  mediaVolume?: number;
  /** Karaoke mode hides the bottom cammer strip — the spotlighted cammer
   *  is rendered as a floating corner tile by the caller instead. */
  hideCammerStrip?: boolean;
}

interface UrlMediaPlayerProps {
  src: string;
  kind: "video" | "music";
  playing: boolean;
  volume: number;
}

function UrlMediaPlayer({ src, kind, playing, volume }: UrlMediaPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [muted, setMuted] = useState(true);
  const [canPlay, setCanPlay] = useState(false);

  const isHls = /\.m3u8(\?|$)/i.test(src);

  useEffect(() => {
    const el: HTMLMediaElement | null = kind === "music" ? audioRef.current : videoRef.current;
    if (!el || !src) return;

    setCanPlay(false);
    hlsRef.current?.destroy();
    hlsRef.current = null;

    if (isHls && Hls.isSupported() && kind === "video") {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        manifestLoadingMaxRetry: 4,
        manifestLoadingRetryDelay: 2000,
        levelLoadingMaxRetry: 4,
        levelLoadingRetryDelay: 2000,
        fragLoadingMaxRetry: 4,
        fragLoadingRetryDelay: 2000,
      });
      hlsRef.current = hls;
      hls.loadSource(src);
      hls.attachMedia(el as HTMLVideoElement);
      hls.on(Hls.Events.MANIFEST_PARSED, () => setCanPlay(true));
      hls.on(Hls.Events.ERROR, (_evt, data) => {
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
        else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
      });
    } else {
      el.src = src;
      el.load();
      const onReady = () => setCanPlay(true);
      el.addEventListener("loadedmetadata", onReady, { once: true });
      return () => {
        el.removeEventListener("loadedmetadata", onReady);
      };
    }

    return () => {
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
  }, [src, isHls, kind]);

  useEffect(() => {
    const el: HTMLMediaElement | null = kind === "music" ? audioRef.current : videoRef.current;
    if (!el) return;
    // Backend stores volume on a 0-100 scale; HTMLMediaElement expects 0-1.
    const normalized = volume > 1 ? volume / 100 : volume;
    el.volume = Math.max(0, Math.min(1, normalized));
    el.muted = muted;
    // Anti-capture: play Prime Videos slightly fast so screen recordings
    // desync and don't match the original master. Main Stage is silent by
    // design so there's no pitch artifact.
    if (kind === "video") el.playbackRate = 1.25;
    if (!canPlay) return;
    if (playing) {
      el.play().catch(() => {
        setMuted(true);
        if (el) el.muted = true;
        el.play().catch(() => {});
      });
    } else {
      el.pause();
    }
  }, [playing, volume, muted, canPlay, kind]);

  const handleUnmute = () => {
    setMuted(false);
    const el: HTMLMediaElement | null = kind === "music" ? audioRef.current : videoRef.current;
    if (el) {
      el.muted = false;
      el.play().catch(() => {});
    }
  };

  if (kind === "music") {
    return (
      <div className="flex flex-col items-center gap-5 px-6 text-center">
        <div
          className="relative w-28 h-28 rounded-full flex items-center justify-center"
          style={{
            background: "radial-gradient(circle at 30% 30%, rgba(212,0,122,0.45), rgba(123,97,255,0.25) 60%, rgba(0,0,0,0.6) 100%)",
            boxShadow: "0 18px 60px rgba(212,0,122,0.30)",
          }}
        >
          <div
            className="absolute inset-0 rounded-full"
            style={{
              border: "1px solid rgba(255,255,255,0.12)",
              animation: playing ? "spin 12s linear infinite" : "none",
            }}
          />
          <svg className="w-10 h-10 text-white/90" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 11-.99-3.467l2.31-.66a2.25 2.25 0 001.632-2.163zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 01-.99-3.467l2.31-.66A2.25 2.25 0 009 15.553z" />
          </svg>
        </div>
        <div>
          <p className="text-white/80 text-sm font-semibold tracking-wide">
            {playing ? "Now Playing" : "Paused"}
          </p>
          <p className="text-white/30 text-[11px] mt-1 max-w-[240px] truncate mx-auto" title={src}>
            {decodeURIComponent(src.split("/").pop() || src)}
          </p>
        </div>
        {muted && canPlay && playing && (
          <button
            type="button"
            onClick={handleUnmute}
            className="min-h-[40px] px-4 rounded-full text-xs font-bold text-white transition-all active:scale-[0.96]"
            style={{ background: "linear-gradient(135deg,#D4007A,#7B61FF)", boxShadow: "0 4px 16px rgba(212,0,122,0.35)" }}
          >
            Tap for sound
          </button>
        )}
        <audio ref={audioRef} autoPlay playsInline preload="auto" />
      </div>
    );
  }

  return (
    <div className="absolute inset-0 bg-black">
      <video
        ref={videoRef}
        className="w-full h-full object-contain"
        autoPlay
        playsInline
        preload="auto"
        muted={muted}
        controls={false}
      />
      {!canPlay && (
        <div className="absolute inset-0 flex items-center justify-center" style={{ background: "rgba(10,10,15,0.6)" }}>
          <div
            className="w-10 h-10 rounded-full border-2 animate-spin"
            style={{ borderColor: "rgba(212,0,122,0.3)", borderTopColor: "#D4007A" }}
          />
        </div>
      )}
      {muted && canPlay && playing && (
        <button
          type="button"
          onClick={handleUnmute}
          aria-label="Unmute"
          className="absolute bottom-4 right-4 z-10 flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-bold text-white transition-all active:scale-[0.96]"
          style={{
            background: "linear-gradient(135deg,#D4007A,#7B61FF)",
            boxShadow: "0 4px 16px rgba(212,0,122,0.35)",
            backdropFilter: "blur(8px)",
          }}
        >
          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M3 10v4h4l5 5V5L7 10H3zm13.5 2a4.5 4.5 0 00-2.5-4v8a4.5 4.5 0 002.5-4z" />
          </svg>
          Tap for sound
        </button>
      )}
    </div>
  );
}

export function CinemaGrid({
  mediaIdentity,
  mediaKind,
  mediaSrc,
  mediaPlaying = true,
  mediaVolume = 0.8,
  hideCammerStrip = false,
}: CinemaGridProps) {
  const tracks = useTracks(
    [{ source: Track.Source.Camera, withPlaceholder: true }],
    { onlySubscribed: false }
  );

  const mediaTrack: TrackReferenceOrPlaceholder | undefined = tracks.find(
    (t) => t.participant.identity === mediaIdentity
  );

  const cammerTracks = tracks.filter((t) => t.participant.identity !== mediaIdentity);

  const showStandby = mediaKind === "off" || (!mediaTrack && !mediaSrc);

  return (
    <div className="flex flex-col h-full" style={{ background: "#000" }}>
      <div className="relative flex-1 min-h-0 flex items-center justify-center" style={{ background: "#000" }}>
        {showStandby ? (
          <div className="flex flex-col items-center gap-4 px-6 text-center">
            <div
              className="w-20 h-20 rounded-2xl flex items-center justify-center"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
            >
              <svg className="w-10 h-10 text-white/20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 01-1.125-1.125M3.375 19.5h1.5C5.496 19.5 6 18.996 6 18.375m-3.75 0V5.625m0 12.75v-1.5c0-.621.504-1.125 1.125-1.125m18.375 2.625V5.625m0 12.75c0 .621-.504 1.125-1.125 1.125m1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125m0 3.75h-1.5A1.125 1.125 0 0118 18.375M20.625 4.5H3.375m17.25 0c.621 0 1.125.504 1.125 1.125M20.625 4.5h-1.5C18.504 4.5 18 5.004 18 5.625m3.75 0v1.5c0 .621-.504 1.125-1.125 1.125M3.375 4.5c-.621 0-1.125.504-1.125 1.125M3.375 4.5h1.5C5.496 4.5 6 5.004 6 5.625m-3.75 0v1.5c0 .621.504 1.125 1.125 1.125m0 0h1.5m-1.5 0c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125m1.5-3.75C5.496 8.25 6 8.754 6 9.375v1.5m0-5.25v5.25m0-5.25C6 5.004 6.504 4.5 7.125 4.5h9.75c.621 0 1.125.504 1.125 1.125m1.125 2.625h1.5m-1.5 0A1.125 1.125 0 0118 9.375v1.5m1.5-3.75C19.496 8.25 20 8.754 20 9.375v1.5m0-5.25v5.25m0-5.25C20 5.004 19.496 4.5 18.875 4.5M9 11.25v1.5M12 9v3.75m3-6v6" />
              </svg>
            </div>
            <div>
              <p className="text-white/40 font-medium text-sm">Standby</p>
              <p className="text-white/25 text-xs mt-1">No media playing · Admin controls playback</p>
            </div>
          </div>
        ) : mediaTrack ? (
          <div className="absolute inset-0">
            <ParticipantTile
              trackRef={mediaTrack}
              style={{ width: "100%", height: "100%" }}
            />
          </div>
        ) : mediaSrc ? (
          <UrlMediaPlayer
            src={mediaSrc}
            kind={mediaKind === "music" ? "music" : "video"}
            playing={mediaPlaying}
            volume={mediaVolume}
          />
        ) : null}
      </div>

      {!hideCammerStrip && cammerTracks.length > 0 && (
        <div
          className="flex-shrink-0 flex gap-1.5 overflow-x-auto"
          style={{
            height: "88px",
            padding: "6px 8px",
            background: "rgba(0,0,0,0.8)",
          }}
        >
          {cammerTracks.map((t) => (
            <div
              key={t.participant.identity}
              className="flex-shrink-0 rounded-xl overflow-hidden"
              style={{
                width: "calc(16/9 * 76px)",
                height: "76px",
                border: "1.5px solid rgba(255,255,255,0.10)",
              }}
            >
              <ParticipantTile
                trackRef={t}
                style={{ width: "100%", height: "100%" }}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
