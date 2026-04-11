import React, { useRef, useEffect, useState } from "react";
import Hls from "hls.js";
import { Badge, Skeleton } from "@pnptv/ui-kit";
import { StreamOverlayLayer, type StreamOverlayConfig } from "@/components/StreamOverlayLayer";
import ErrorBoundary from "@/components/ErrorBoundary";
import { useI18n } from "@/lib/i18n";

interface LivePlayerProps {
  src: string;
  title?: string;
  poster?: string;
  className?: string;
  overlay?: StreamOverlayConfig | null;
}

export function LivePlayer({ src, title, poster, className = "", overlay }: LivePlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<"loading" | "live" | "offline" | "error" | "retrying">("loading");
  const [showReload, setShowReload] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const hlsRef = useRef<Hls | null>(null);
  // FE-H3: track retry setTimeout so it can be cleared on unmount
  const retryTimerRef = useRef<number | undefined>(undefined);
  const reloadTimerRef = useRef<number | undefined>(undefined);
  const mediaErrorCountRef = useRef(0);
  const t = useI18n();

  const initHls = (video: HTMLVideoElement, source: string) => {
    // FE-H3: clear any pending retry timer before reinitialising
    clearTimeout(retryTimerRef.current);
    retryTimerRef.current = undefined;
    clearTimeout(reloadTimerRef.current);
    reloadTimerRef.current = undefined;
    setShowReload(false);
    mediaErrorCountRef.current = 0;

    hlsRef.current?.destroy();
    hlsRef.current = null;

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        // Retry faster on live streams to handle brief RTMP reconnects
        manifestLoadingMaxRetry: 6,
        manifestLoadingRetryDelay: 2000,
        levelLoadingMaxRetry: 6,
        levelLoadingRetryDelay: 2000,
        fragLoadingMaxRetry: 6,
        fragLoadingRetryDelay: 2000,
      });

      hlsRef.current = hls;
      hls.loadSource(source);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setStatus("live");
        clearTimeout(reloadTimerRef.current);
        setShowReload(false);
        video.play().catch(() => {});
      });

      hls.on(Hls.Events.ERROR, (_, data) => {
        console.warn("[LivePlayer] HLS error:", data.type, data.details, data.fatal ? "(FATAL)" : "");
        if (data.fatal) {
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            // Show retrying spinner immediately, then go offline after 10s if not recovered.
            // 10s aligns better with hls.js internal manifestLoadingMaxRetry=6 * 2s.
            console.warn("[LivePlayer] Fatal network error, attempting recovery…");
            setStatus("retrying");
            hls.startLoad();

            // Show reload button after 5s of retrying
            reloadTimerRef.current = window.setTimeout(() => {
              setShowReload(true);
            }, 5000);
            
            // FE-H3: track the timer so it can be cleared on unmount
            retryTimerRef.current = window.setTimeout(() => {
              if (hls.media && (hls.media.readyState === 0 || (hls.media as HTMLVideoElement).networkState === 3)) {
                setStatus("offline");
              }
            }, 10000);
          } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            mediaErrorCountRef.current += 1;
            if (mediaErrorCountRef.current <= 3) {
              console.warn(`[LivePlayer] Fatal media error, attempting recovery (${mediaErrorCountRef.current}/3)…`);
              hls.recoverMediaError();
            } else {
              console.warn("[LivePlayer] Media error recovery limit reached, giving up.");
              hls.destroy();
              hlsRef.current = null;
              setStatus("error");
            }
          } else {
            setStatus("error");
          }
        }
      });
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      // FE-H4: Safari native HLS — use { once: true } so listeners self-remove
      // and store references so the cleanup function can also remove them.
      video.src = source;
      const onMetadata = () => {
        setStatus("live");
        video.play().catch(() => {});
      };
      const onError = () => setStatus("error");
      // { once: true } ensures each fires at most once; cleanup below handles
      // the case where unmount occurs before either event fires.
      video.addEventListener("loadedmetadata", onMetadata, { once: true });
      video.addEventListener("error", onError, { once: true });
      // Store references on the video element so the useEffect cleanup can
      // remove them if the component unmounts before the events fire.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (video as any)._pnpOnMetadata = onMetadata;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (video as any)._pnpOnError = onError;
    } else {
      setStatus("error");
    }
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) {
      // No source provided — show offline instead of infinite spinner
      if (!src) setStatus("offline");
      return;
    }

    setStatus("loading");
    initHls(video, src);

    return () => {
      // FE-H3: cancel any pending retry timer
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = undefined;
      clearTimeout(reloadTimerRef.current);
      reloadTimerRef.current = undefined;

      hlsRef.current?.destroy();
      hlsRef.current = null;

      // FE-H4: remove Safari native HLS listeners if they haven't fired yet
      if (video) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const onMeta = (video as any)._pnpOnMetadata;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const onErr = (video as any)._pnpOnError;
        if (onMeta) {
          video.removeEventListener("loadedmetadata", onMeta);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          delete (video as any)._pnpOnMetadata;
        }
        if (onErr) {
          video.removeEventListener("error", onErr);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          delete (video as any)._pnpOnError;
        }
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  // Recover from iOS Safari background stalls when tab becomes visible again
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      const video = videoRef.current;
      if (!video) return;
      if (hlsRef.current) {
        hlsRef.current.startLoad();
        video.play().catch(() => {});
      } else if (video.src) {
        // Native Safari HLS path
        video.load();
        video.play().catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  // MediaSession API — lock-screen metadata + play/pause controls on mobile.
  // Without this, iOS/Android show no metadata when the stream plays in the
  // background and users cannot pause from the notification shade.
  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    const video = videoRef.current;
    if (!video) return;

    const artworkUrl = poster || "/logo.png";
    try {
      navigator.mediaSession.metadata = new window.MediaMetadata({
        title: title || "PNPtv Live",
        artist: "PNPtv!",
        album: "Live Stream",
        artwork: [
          { src: artworkUrl, sizes: "512x512", type: "image/png" },
        ],
      });
      navigator.mediaSession.setActionHandler("play", () => {
        video.play().catch(() => {});
      });
      navigator.mediaSession.setActionHandler("pause", () => {
        video.pause();
      });
      // Live streams have no seek / skip semantics — explicitly clear them.
      navigator.mediaSession.setActionHandler("seekbackward", null);
      navigator.mediaSession.setActionHandler("seekforward", null);
      navigator.mediaSession.setActionHandler("previoustrack", null);
      navigator.mediaSession.setActionHandler("nexttrack", null);
    } catch {
      // MediaMetadata constructor not available — silently degrade.
    }

    return () => {
      try {
        navigator.mediaSession.metadata = null;
        navigator.mediaSession.setActionHandler("play", null);
        navigator.mediaSession.setActionHandler("pause", null);
      } catch {
        // no-op
      }
    };
  }, [title, poster]);

  const handleRetry = () => {
    const video = videoRef.current;
    if (!video || !src) return;
    setStatus("loading");
    initHls(video, src);
  };

  const handleUnmute = () => {
    if (videoRef.current) {
      videoRef.current.muted = false;
      setIsMuted(false);
    }
  };

  if (status === "loading" || status === "retrying") {
    return (
      <div className={`relative aspect-video overflow-hidden rounded-xl bg-black ${className}`}>
        <Skeleton className="w-full h-full opacity-20" />
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
          <div className="w-10 h-10 border-2 border-pnp-accent border-t-transparent rounded-full animate-spin" />
          <div className="text-center">
            <p className="text-xs text-white/80 animate-pulse font-medium">
              {status === "retrying" ? "Reconnecting…" : "Loading stream…"}
            </p>
            {showReload && (
              <button
                onClick={handleRetry}
                className="mt-4 px-4 py-2 rounded-lg text-[10px] font-bold text-white bg-pnp-accent/20 border border-pnp-accent/40 hover:bg-pnp-accent/30 transition-colors"
              >
                Reload Player
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className={`relative aspect-video overflow-hidden rounded-xl bg-pnp-surface border border-pnp-border flex items-center justify-center ${className}`}>
        <div className="text-center px-4">
          <svg className="w-16 h-16 text-pnp-error mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          <p className="text-pnp-textSecondary font-medium">{t.live.streamOffline}</p>
          <p className="text-sm text-pnp-textSecondary/60 mt-1">{t.live.checkBackLater}</p>
          <div className="flex items-center justify-center gap-2 mt-4">
            <button
              onClick={handleRetry}
              className="px-4 py-2 rounded-lg text-xs font-semibold text-white btn-gradient"
            >
              {t.live.retryLoading}
            </button>
            <a
              href="/live"
              className="px-4 py-2 rounded-lg text-xs font-semibold text-pnp-textSecondary bg-pnp-surface border border-pnp-border hover:border-pnp-accent/40 transition-colors"
            >
              {t.live.backToLive}
            </a>
          </div>
        </div>
      </div>
    );
  }

  if (status === "offline") {
    return (
      <div className={`relative aspect-video overflow-hidden rounded-xl bg-pnp-surface border border-pnp-border flex items-center justify-center ${className}`}>
        <div className="text-center">
          <svg className="w-16 h-16 text-pnp-textSecondary mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          <p className="text-pnp-textSecondary font-medium">{t.live.streamOffline}</p>
          <p className="text-sm text-pnp-textSecondary/60 mt-1">{t.live.checkBackLater}</p>
          <div className="flex items-center justify-center gap-2 mt-4">
            <button
              onClick={handleRetry}
              className="px-4 py-2 rounded-lg text-xs font-semibold text-white btn-gradient"
            >
              {t.live.retryLoading}
            </button>
            <a
              href="/live"
              className="px-4 py-2 rounded-lg text-xs font-semibold text-pnp-textSecondary bg-pnp-surface border border-pnp-border hover:border-pnp-accent/40 transition-colors"
            >
              {t.live.backToLive}
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`relative aspect-video overflow-hidden rounded-xl bg-black ${className}`}>
      {/* Fix #15: muted allows autoplay to succeed in all browsers.
           User can unmute via the native controls. */}
      <video
        ref={videoRef}
        className="w-full h-full object-contain"
        poster={poster}
        playsInline
        muted
        controls
        controlsList="nodownload"
        onContextMenu={(e) => e.preventDefault()}
        onVolumeChange={(e) => {
          setIsMuted((e.target as HTMLVideoElement).muted || (e.target as HTMLVideoElement).volume === 0);
        }}
      />
      {status === "live" && isMuted && (
        <button
          onClick={handleUnmute}
          className="absolute top-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 px-4 py-2 rounded-full bg-black/80 backdrop-blur-sm border border-white/20 hover:bg-black/90 active:scale-95 transition-all"
          aria-label="Unmute video"
        >
          <svg className="w-4 h-4 text-white flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
          </svg>
          <span className="text-white text-xs font-bold uppercase tracking-wider">Tap to Unmute</span>
        </button>
      )}
      {status === "live" && (
        <div className="absolute top-3 left-3 z-10">
          <Badge variant="error">LIVE</Badge>
        </div>
      )}
      {title && (
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4 pt-8 z-10">
          <p className="text-white font-medium">{title}</p>
        </div>
      )}
      {/* Stream overlay: logos and banners configured by admins.
           FE-M6: wrapped in ErrorBoundary so a broken overlay config never
           crashes the entire player. fallback=null renders nothing on error. */}
      {overlay?.is_active !== false && (
        <ErrorBoundary fallback={null}>
          <StreamOverlayLayer overlay={overlay ?? null} />
        </ErrorBoundary>
      )}
    </div>
  );
}
