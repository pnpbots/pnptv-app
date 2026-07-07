import { useEffect, useRef, useState } from "react";
import {
  ParticipantTile,
  useTracks,
} from "@livekit/components-react";
import type { TrackReferenceOrPlaceholder } from "@livekit/components-react";
import { Track, VideoQuality } from "livekit-client";
import type { RemoteTrackPublication } from "livekit-client";
import Hls from "hls.js";
import { useI18n } from "@/lib/i18n";
import { useMainStageRoom } from "@/components/mainstage/MainStageProvider";

/**
 * Identity of the media-bot participant that publishes URL-backed media
 * (e.g. auto-rotated Prime Videos). Must match MEDIA_BOT_IDENTITY in
 * apps/backend/services/mainStageService.js. Single source of truth for the
 * frontend — import from here in grids and pages.
 */
export const MEDIA_IDENTITY = "mainstage-media";

interface CinemaGridProps {
  mediaIdentity: string;
  mediaKind: "video" | "music" | "off";
  mediaSrc: string | null;
  mediaPlaying?: boolean;
  mediaVolume?: number;
  mediaStartedAt?: number | null;
  /** Karaoke mode hides the bottom cammer strip — the spotlighted cammer
   *  is rendered as a floating corner tile by the caller instead. */
  hideCammerStrip?: boolean;
}

interface UrlMediaPlayerProps {
  src: string;
  kind: "video" | "music";
  playing: boolean;
  volume: number;
  startedAt?: number | null;
}

// ── SVG icon helpers ──────────────────────────────────────────────────────────

function IconPlay({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 5.14v14l11-7-11-7z" />
    </svg>
  );
}

function IconPause({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
    </svg>
  );
}

function IconVolumeOff({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" />
    </svg>
  );
}

function IconVolumeUp({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M3 10v4h4l5 5V5L7 10H3zm13.5 2a4.5 4.5 0 00-2.5-4v8a4.5 4.5 0 002.5-4zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
    </svg>
  );
}

// ── UrlMediaPlayer ────────────────────────────────────────────────────────────

function UrlMediaPlayer({ src, kind, playing, volume, startedAt }: UrlMediaPlayerProps) {
  const t = useI18n().live;
  const { userMusicPlaying: userOptedIn, userMusicMuted: muted, setUserMusicPlaying: setUserOptedIn, setUserMusicMuted: setMuted } = useMainStageRoom();
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [canPlay, setCanPlay] = useState(false);

  const isHls = /\.m3u8(\?|$)/i.test(src);

  // Load media source
  useEffect(() => {
    const el: HTMLMediaElement | null = kind === "music" ? audioRef.current : videoRef.current;
    if (!el || !src) return;

    setCanPlay(false);
    hlsRef.current?.destroy();
    hlsRef.current = null;

    if (isHls && Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        manifestLoadingMaxRetry: 6,
        manifestLoadingRetryDelay: 2000,
        levelLoadingMaxRetry: 6,
        levelLoadingRetryDelay: 2000,
        fragLoadingMaxRetry: 6,
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
      return () => {
        hlsRef.current?.destroy();
        hlsRef.current = null;
      };
    } else {
      el.src = src;
      el.load();
      const onReady = () => setCanPlay(true);
      el.addEventListener("loadedmetadata", onReady, { once: true });
      const fallbackTimer = setTimeout(() => setCanPlay(true), 5000);
      return () => {
        el.removeEventListener("loadedmetadata", onReady);
        clearTimeout(fallbackTimer);
        el.src = "";
        el.load();
      };
    }
  }, [src, isHls, kind]);

  // Play/pause & volume — only play if user opted in AND admin says playing
  useEffect(() => {
    const el: HTMLMediaElement | null = kind === "music" ? audioRef.current : videoRef.current;
    if (!el) return;

    const normalized = volume > 1 ? volume / 100 : volume;
    el.volume = Math.max(0, Math.min(1, normalized));
    el.muted = muted;

    if (!canPlay) return;

    const shouldPlay = playing && userOptedIn;

    if (shouldPlay) {
      if (startedAt && el instanceof HTMLVideoElement && el.duration > 0) {
        const expectedPos = Math.max(0, (Date.now() - startedAt) / 1000);
        if (Math.abs(el.currentTime - expectedPos) > 3) {
          el.currentTime = Math.min(expectedPos, el.duration - 0.5);
        }
      }
      el.play().catch((err: unknown) => {
        // AbortError means our own cleanup pause() interrupted play() — harmless,
        // the element will resume correctly. Do NOT mute for this case.
        if ((err as DOMException)?.name === "AbortError") return;
        // NotAllowedError / anything else → autoplay blocked; fall back to muted.
        setMuted(true);
        if (el) el.muted = true;
        el.play().catch(() => {});
      });
    } else {
      el.pause();
    }
  }, [playing, userOptedIn, volume, muted, canPlay, kind, startedAt]);

  const handlePlay = () => {
    setUserOptedIn(true);
    setMuted(false);
    const el: HTMLMediaElement | null = kind === "music" ? audioRef.current : videoRef.current;
    if (el) {
      el.muted = false;
      el.play().catch(() => {});
    }
  };

  const handlePause = () => setUserOptedIn(false);

  const handleToggleMute = () => {
    const el: HTMLMediaElement | null = kind === "music" ? audioRef.current : videoRef.current;
    const next = !muted;
    setMuted(next);
    if (el) el.muted = next;
  };

  const isPlaying = userOptedIn && playing;

  // ── Music UI ────────────────────────────────────────────────────────────────
  if (kind === "music") {
    return (
      <div className="flex flex-col items-center gap-6 px-6 text-center">
        {/* Vinyl disc */}
        <div
          className="relative w-28 h-28 rounded-full flex items-center justify-center"
          style={{
            background: "radial-gradient(circle at 30% 30%, rgba(212,0,122,0.45), rgba(123,97,255,0.25) 60%, rgba(0,0,0,0.6) 100%)",
            boxShadow: "0 18px 60px rgba(212,0,122,0.30)",
            animation: isPlaying ? "spin 12s linear infinite" : "none",
          }}
        >
          <div
            className="absolute inset-0 rounded-full"
            style={{ border: "1px solid rgba(255,255,255,0.12)" }}
          />
          <svg className="w-10 h-10 text-white/90" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 11-.99-3.467l2.31-.66a2.25 2.25 0 001.632-2.163zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 01-.99-3.467l2.31-.66A2.25 2.25 0 009 15.553z" />
          </svg>
        </div>

        {/* Track info */}
        <div>
          <p className="text-white/80 text-sm font-semibold tracking-wide">
            {isPlaying ? t.mainStageNowPlaying : playing ? t.mainStagePaused : t.mainStagePaused}
          </p>
          <p className="text-white/30 text-[11px] mt-1 max-w-[240px] truncate mx-auto" title={src}>
            {decodeURIComponent(src.split("/").pop() || src)}
          </p>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-3">
          {/* Mute toggle */}
          <button
            type="button"
            onClick={handleToggleMute}
            disabled={!userOptedIn}
            aria-label={muted ? "Unmute" : "Mute"}
            title={muted ? "Unmute" : "Mute"}
            className="w-10 h-10 rounded-full flex items-center justify-center transition-all active:scale-[0.93] disabled:opacity-30"
            style={{
              background: muted ? "rgba(255,255,255,0.06)" : "rgba(94,209,196,0.15)",
              border: muted ? "1px solid rgba(255,255,255,0.12)" : "1px solid rgba(94,209,196,0.4)",
              color: muted ? "rgba(255,255,255,0.4)" : "#5ED1C4",
            }}
          >
            {muted ? <IconVolumeOff size={16} /> : <IconVolumeUp size={16} />}
          </button>

          {/* Play / Pause */}
          {!userOptedIn ? (
            <button
              type="button"
              onClick={handlePlay}
              aria-label="Play music"
              className="w-14 h-14 rounded-full flex items-center justify-center text-white transition-all active:scale-[0.93] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black"
              style={{
                background: "linear-gradient(135deg,#D4007A,#7B61FF)",
                boxShadow: "0 6px 24px rgba(212,0,122,0.45)",
              }}
            >
              <IconPlay size={24} />
            </button>
          ) : (
            <button
              type="button"
              onClick={handlePause}
              aria-label="Pause music"
              className="w-14 h-14 rounded-full flex items-center justify-center text-white transition-all active:scale-[0.93] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black"
              style={{
                background: "rgba(255,255,255,0.08)",
                border: "1px solid rgba(255,255,255,0.18)",
              }}
            >
              <IconPause size={24} />
            </button>
          )}

          {/* Spacer to balance the mute button */}
          <div className="w-10" />
        </div>

        <audio ref={audioRef} playsInline preload="auto" muted />
      </div>
    );
  }

  // ── Video UI ────────────────────────────────────────────────────────────────
  return (
    <div className="absolute inset-0 bg-black">
      <video
        ref={videoRef}
        className="w-full h-full object-contain"
        playsInline
        preload="auto"
        muted={muted}
        controls={false}
        loop
        onEnded={() => { videoRef.current?.play().catch(() => {}); }}
      />

      {/* Loading spinner */}
      {!canPlay && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60">
          <div
            className="w-10 h-10 rounded-full border-2 animate-spin border-pnp-accent/30"
            style={{ borderTopColor: "#D4007A" }}
          />
        </div>
      )}

      {/* Play overlay — shown until user opts in */}
      {canPlay && !userOptedIn && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center gap-4"
          style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(2px)" }}
        >
          <button
            type="button"
            onClick={handlePlay}
            aria-label="Play video"
            className="w-16 h-16 rounded-full flex items-center justify-center text-white transition-all active:scale-[0.93] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent"
            style={{
              background: "linear-gradient(135deg,#D4007A,#7B61FF)",
              boxShadow: "0 8px 32px rgba(212,0,122,0.55)",
            }}
          >
            <IconPlay size={28} />
          </button>
          <p className="text-white/60 text-xs font-medium">{t.mainStageTapForSound}</p>
        </div>
      )}

      {/* Always-visible controls (bottom-right) — only when playing */}
      {canPlay && userOptedIn && (
        <div
          className="absolute bottom-4 right-4 flex items-center gap-2"
          style={{ zIndex: 10 }}
        >
          {/* Pause */}
          <button
            type="button"
            onClick={handlePause}
            aria-label="Pause"
            className="w-9 h-9 rounded-full flex items-center justify-center text-white transition-all active:scale-[0.93]"
            style={{
              background: "rgba(0,0,0,0.55)",
              border: "1px solid rgba(255,255,255,0.18)",
              backdropFilter: "blur(8px)",
            }}
          >
            <IconPause size={14} />
          </button>

          {/* Mute toggle */}
          <button
            type="button"
            onClick={handleToggleMute}
            aria-label={muted ? "Unmute" : "Mute"}
            title={muted ? "Unmute" : "Mute"}
            className="w-9 h-9 rounded-full flex items-center justify-center transition-all active:scale-[0.93]"
            style={{
              background: muted ? "rgba(0,0,0,0.55)" : "rgba(212,0,122,0.25)",
              border: muted ? "1px solid rgba(255,255,255,0.18)" : "1px solid rgba(212,0,122,0.5)",
              backdropFilter: "blur(8px)",
              color: muted ? "rgba(255,255,255,0.7)" : "#fff",
            }}
          >
            {muted ? <IconVolumeOff size={14} /> : <IconVolumeUp size={14} />}
          </button>
        </div>
      )}
    </div>
  );
}


/**
 * Strip tile for the Cinema layout cammer row.
 * Requests VideoQuality.MEDIUM to provide better visual clarity for cammers.
 * Tile height uses viewport-relative clamping for clean desktop scaling.
 */
function CinemaStripTile({ trackRef }: { trackRef: TrackReferenceOrPlaceholder }) {
  useEffect(() => {
    const pub = trackRef.publication as RemoteTrackPublication | undefined;
    if (!pub || !("setVideoQuality" in pub)) return;
    pub.setVideoQuality(VideoQuality.MEDIUM);
  }, [trackRef.publication]);

  return (
    <div
      className="flex-shrink-0 rounded-2xl overflow-hidden"
      style={{
        width: "calc(16/9 * clamp(120px, 17vh, 210px))",
        height: "clamp(120px, 17vh, 210px)",
        border: "2px solid rgba(212,0,122,0.28)",
        boxShadow: "0 6px 18px rgba(0,0,0,0.45), 0 0 20px rgba(212,0,122,0.15)",
      }}
    >
      <ParticipantTile trackRef={trackRef} style={{ width: "100%", height: "100%" }} />
    </div>
  );
}

export function CinemaGrid({
  mediaIdentity,
  mediaKind,
  mediaSrc,
  mediaPlaying = true,
  mediaVolume = 0.8,
  mediaStartedAt = null,
  hideCammerStrip = false,
}: CinemaGridProps) {
  const t = useI18n().live;
  const tracks = useTracks(
    [{ source: Track.Source.Camera, withPlaceholder: false }],
    { onlySubscribed: false }
  );

  const mediaTrack: TrackReferenceOrPlaceholder | undefined = tracks.find(
    (t) => t.participant.identity === mediaIdentity
  );

  const cammerTracks = tracks.filter((t) => t.participant.identity !== mediaIdentity);

  const showStandby = mediaKind === "off" || (!mediaTrack && !mediaSrc);

  return (
    <div className="flex flex-col h-full bg-black">
      <div className="relative flex-1 min-h-0 flex items-center justify-center bg-black">
        {showStandby ? (
          <div className="flex flex-col items-center gap-4 px-6 text-center">
            <div className="w-20 h-20 rounded-2xl flex items-center justify-center bg-white/[0.04] border border-white/[0.08]">
              <svg className="w-10 h-10 text-white/20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 01-1.125-1.125M3.375 19.5h1.5C5.496 19.5 6 18.996 6 18.375m-3.75 0V5.625m0 12.75v-1.5c0-.621.504-1.125 1.125-1.125m18.375 2.625V5.625m0 12.75c0 .621-.504 1.125-1.125 1.125m1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125m0 3.75h-1.5A1.125 1.125 0 0118 18.375M20.625 4.5H3.375m17.25 0c.621 0 1.125.504 1.125 1.125M20.625 4.5h-1.5C18.504 4.5 18 5.004 18 5.625m3.75 0v1.5c0 .621-.504 1.125 1.125 1.125M3.375 4.5c-.621 0-1.125.504-1.125 1.125M3.375 4.5h1.5C5.496 4.5 6 5.004 6 5.625m-3.75 0v1.5c0 .621.504 1.125 1.125 1.125m0 0h1.5m-1.5 0c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125m1.5-3.75C5.496 8.25 6 8.754 6 9.375v1.5m0-5.25v5.25m0-5.25C6 5.004 6.504 4.5 7.125 4.5h9.75c.621 0 1.125.504 1.125 1.125m1.125 2.625h1.5m-1.5 0A1.125 1.125 0 0118 9.375v1.5m1.5-3.75C19.496 8.25 20 8.754 20 9.375v1.5m0-5.25v5.25m0-5.25C20 5.004 19.496 4.5 18.875 4.5M9 11.25v1.5M12 9v3.75m3-6v6" />
              </svg>
            </div>
            <div>
              <p className="text-white/40 font-medium text-sm">{t.mainStageStandby}</p>
              <p className="text-white/25 text-xs mt-1">{t.mainStageNoMediaPlaying}</p>
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
            startedAt={mediaStartedAt}
          />
        ) : null}
      </div>

      {!hideCammerStrip && cammerTracks.length > 0 && (
        <div
          className="flex-shrink-0 flex gap-2 overflow-x-auto no-scrollbar"
          style={{
            height: "clamp(140px, 20vh, 240px)",
            padding: "12px 14px",
            background: "rgba(0,0,0,0.85)",
            scrollbarWidth: "none",
            msOverflowStyle: "none",
          }}
        >
          {cammerTracks.map((track) => (
            <CinemaStripTile key={track.participant.identity} trackRef={track} />
          ))}
        </div>
      )}
    </div>
  );
}
