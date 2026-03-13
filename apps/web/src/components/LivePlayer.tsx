import React, { useRef, useEffect, useState } from "react";
import Hls from "hls.js";
import { Badge, Skeleton } from "@pnptv/ui-kit";
import { StreamOverlayLayer, type StreamOverlayConfig } from "@/components/StreamOverlayLayer";
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
  const hlsRef = useRef<Hls | null>(null);
  const t = useI18n();

  const initHls = (video: HTMLVideoElement, source: string) => {
    hlsRef.current?.destroy();
    hlsRef.current = null;

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
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
        video.play().catch(() => {});
      });

      hls.on(Hls.Events.ERROR, (_, data) => {
        console.warn("[LivePlayer] HLS error:", data.type, data.details, data.fatal ? "(FATAL)" : "");
        if (data.fatal) {
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            // Show retrying spinner immediately, then go offline after 3s if not recovered
            console.warn("[LivePlayer] Fatal network error, attempting recovery…");
            setStatus("retrying");
            hls.startLoad();
            setTimeout(() => {
              if (hls.media && hls.media.readyState === 0) {
                setStatus("offline");
              }
            }, 3000);
          } else {
            setStatus("error");
          }
        }
      });
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      // Safari native HLS
      video.src = source;
      const onMetadata = () => {
        setStatus("live");
        video.play().catch(() => {});
      };
      const onError = () => setStatus("error");
      video.addEventListener("loadedmetadata", onMetadata);
      video.addEventListener("error", onError);
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
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  const handleRetry = () => {
    const video = videoRef.current;
    if (!video || !src) return;
    setStatus("loading");
    initHls(video, src);
  };

  if (status === "loading" || status === "retrying") {
    return (
      <div className={`relative aspect-video overflow-hidden rounded-xl ${className}`}>
        <Skeleton className="w-full h-full" />
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
          <div className="w-10 h-10 border-2 border-pnp-accent border-t-transparent rounded-full animate-spin" />
          {status === "retrying" && (
            <p className="text-xs text-pnp-textSecondary/80 animate-pulse">Reconnecting…</p>
          )}
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
              Retry
            </button>
            <a
              href="/live"
              className="px-4 py-2 rounded-lg text-xs font-semibold text-pnp-textSecondary bg-pnp-surface border border-pnp-border hover:border-pnp-accent/40 transition-colors"
            >
              Back to Live
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
      />
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
      {/* Stream overlay: logos and banners configured by admins */}
      {overlay?.is_active !== false && (
        <StreamOverlayLayer overlay={overlay ?? null} />
      )}
    </div>
  );
}
