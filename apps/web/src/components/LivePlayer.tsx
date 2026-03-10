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
  const [status, setStatus] = useState<"loading" | "live" | "offline" | "error">("loading");
  const t = useI18n();

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) {
      // No source provided — show offline instead of infinite spinner
      if (!src) setStatus("offline");
      return;
    }

    setStatus("loading");
    let hls: Hls | null = null;

    if (Hls.isSupported()) {
      hls = new Hls({
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

      hls.loadSource(src);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setStatus("live");
        video.play().catch(() => {});
      });

      hls.on(Hls.Events.ERROR, (_, data) => {
        console.warn("[LivePlayer] HLS error:", data.type, data.details, data.fatal ? "(FATAL)" : "");
        if (data.fatal) {
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            // Try to recover once before showing offline
            console.warn("[LivePlayer] Fatal network error, attempting recovery…");
            hls!.startLoad();
            // If recovery fails, the next fatal error will set offline
            setTimeout(() => {
              if (hls && hls.media && hls.media.readyState === 0) {
                setStatus("offline");
              }
            }, 8000);
          } else {
            setStatus("error");
          }
        }
      });
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      // Safari native HLS
      const onMetadata = () => {
        setStatus("live");
        video.play().catch(() => {});
      };
      const onError = () => setStatus("error");
      video.src = src;
      video.addEventListener("loadedmetadata", onMetadata);
      video.addEventListener("error", onError);
      return () => {
        hls?.destroy();
        video.removeEventListener("loadedmetadata", onMetadata);
        video.removeEventListener("error", onError);
      };
    } else {
      setStatus("error");
    }

    return () => {
      hls?.destroy();
    };
  }, [src]);

  if (status === "loading") {
    return (
      <div className={`relative aspect-video overflow-hidden rounded-xl ${className}`}>
        <Skeleton className="w-full h-full" />
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-10 h-10 border-2 border-pnp-accent border-t-transparent rounded-full animate-spin" />
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
          <a
            href="/live"
            className="inline-block mt-4 px-4 py-2 rounded-lg text-xs font-semibold text-white btn-gradient"
          >
            Back to Live
          </a>
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
