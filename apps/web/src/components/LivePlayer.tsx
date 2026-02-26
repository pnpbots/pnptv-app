import React, { useRef, useEffect, useState } from "react";
import Hls from "hls.js";
import { Badge, Skeleton } from "@pnptv/ui-kit";

interface LivePlayerProps {
  src: string;
  title?: string;
  poster?: string;
}

export function LivePlayer({ src, title, poster }: LivePlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<"loading" | "live" | "offline" | "error">("loading");

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    let hls: Hls | null = null;

    if (Hls.isSupported()) {
      hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
      });

      hls.loadSource(src);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setStatus("live");
        video.play().catch(() => {});
      });

      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            setStatus("offline");
          } else {
            setStatus("error");
          }
        }
      });
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = src;
      video.addEventListener("loadedmetadata", () => {
        setStatus("live");
        video.play().catch(() => {});
      });
      video.addEventListener("error", () => setStatus("error"));
    } else {
      setStatus("error");
    }

    return () => {
      hls?.destroy();
    };
  }, [src]);

  if (status === "loading") {
    return (
      <div className="relative aspect-video rounded-xl overflow-hidden">
        <Skeleton className="w-full h-full" />
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-10 h-10 border-2 border-pnp-accent border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (status === "offline") {
    return (
      <div className="relative aspect-video rounded-xl overflow-hidden bg-pnp-surface border border-pnp-border flex items-center justify-center">
        <div className="text-center">
          <svg className="w-16 h-16 text-pnp-textSecondary mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          <p className="text-pnp-textSecondary font-medium">Stream Offline</p>
          <p className="text-sm text-pnp-textSecondary/60 mt-1">Check back later</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative aspect-video rounded-xl overflow-hidden bg-black">
      <video
        ref={videoRef}
        className="w-full h-full object-contain"
        poster={poster}
        playsInline
        controls
      />
      {status === "live" && (
        <div className="absolute top-3 left-3">
          <Badge variant="error">LIVE</Badge>
        </div>
      )}
      {title && (
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4 pt-8">
          <p className="text-white font-medium">{title}</p>
        </div>
      )}
    </div>
  );
}
