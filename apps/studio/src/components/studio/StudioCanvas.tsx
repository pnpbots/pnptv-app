import React from "react";
import {
  VideoOffIcon,
  RotateCwIcon,
  UsersIcon,
  NetworkQualityPill,
  formatDuration,
} from "./shared";
import type { NetworkQuality } from "./shared";
import { useI18n } from "@/lib/i18n";

// ─── Props ────────────────────────────────────────────────────────────────────

export interface StudioCanvasProps {
  videoRef: React.RefObject<HTMLVideoElement>;
  isLive: boolean;
  isConnecting: boolean;
  isCameraOff: boolean;
  isRecording: boolean;
  viewerCount: number;
  durationSec: number;
  orientation: "portrait" | "landscape";
  streamTitle: string;
  category: string;
  networkQuality: NetworkQuality;
  setStreamTitle: (v: string) => void;
  onGoLive: () => void;
}

// ─── StudioCanvas ─────────────────────────────────────────────────────────────

export function StudioCanvas({
  videoRef,
  isLive,
  isConnecting,
  isCameraOff,
  isRecording,
  viewerCount,
  durationSec,
  orientation,
  streamTitle,
  category,
  networkQuality,
  setStreamTitle,
  onGoLive,
}: StudioCanvasProps) {
  const t = useI18n();
  const isPortraitMobile = orientation === "portrait";

  return (
    <div
      className="relative w-full bg-black overflow-hidden"
      style={{
        aspectRatio: isPortraitMobile ? "16/9" : undefined,
        flex: isPortraitMobile ? undefined : "1",
      }}
    >
      {/* ── Camera preview ─────────────────────────────────────────────────── */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="w-full h-full object-cover"
        aria-label="Camera preview"
      />

      {/* ── Camera off overlay ─────────────────────────────────────────────── */}
      {isCameraOff && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black">
          <VideoOffIcon className="w-10 h-10 text-pnp-textSecondary" aria-hidden="true" />
          <p className="text-xs text-pnp-textSecondary font-medium">Camera Off</p>
        </div>
      )}

      {/* ── Go Live CTA overlay (when not live and not connecting) ─────────── */}
      {!isLive && !isConnecting && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6"
          style={{ background: "rgba(0,0,0,0.72)", backdropFilter: "blur(4px)" }}
        >
          {/* Pulsing broadcast icon */}
          <div className="relative flex items-center justify-center">
            <span
              className="absolute w-16 h-16 rounded-full animate-ping opacity-30"
              style={{ background: "#D4007A" }}
              aria-hidden="true"
            />
            <span className="relative text-3xl" aria-hidden="true">📡</span>
          </div>

          <p className="text-base font-bold text-white text-center">
            Ready to Go Live?
          </p>

          {/* Stream title input */}
          <input
            type="text"
            value={streamTitle}
            onChange={(e) => setStreamTitle(e.target.value)}
            placeholder="Stream title (optional)"
            maxLength={80}
            className="
              w-full max-w-xs rounded-xl
              bg-white/10 border border-white/20
              px-4 py-2.5 text-sm text-white placeholder-white/40 text-center
              focus:outline-none focus:ring-2 focus:ring-pnp-accent
            "
          />

          {/* Network quality pill */}
          <NetworkQualityPill quality={networkQuality} />

          {/* Go Live button */}
          <button
            onClick={onGoLive}
            className="
              flex items-center gap-2 px-8 py-4 rounded-2xl
              text-base font-bold text-white w-full max-w-xs justify-center
              transition-all duration-150 active:scale-[0.97]
              disabled:opacity-50 disabled:cursor-not-allowed
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent
            "
            style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
            aria-label="Go Live Now"
          >
            <span aria-hidden="true">🔴</span>
            Go Live Now
          </button>
        </div>
      )}

      {/* ── Status badge — top-left ─────────────────────────────────────────── */}
      <div className="absolute top-3 left-3 flex items-center gap-2">
        {isLive ? (
          <span
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold text-white"
            style={{ background: "rgba(239,68,68,0.9)", backdropFilter: "blur(4px)" }}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" aria-hidden="true" />
            LIVE
          </span>
        ) : (
          <span
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold text-white/70"
            style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }}
          >
            PREVIEW
          </span>
        )}

        {isRecording && (
          <span
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold text-white"
            style={{ background: "rgba(255,69,58,0.8)" }}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" aria-hidden="true" />
            REC
          </span>
        )}
      </div>

      {/* ── Viewer count — top-right (when live) ───────────────────────────── */}
      {isLive && (
        <div className="absolute top-3 right-3">
          <span
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold text-white"
            style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)" }}
          >
            <UsersIcon className="w-3.5 h-3.5" aria-hidden="true" />
            {viewerCount}
          </span>
        </div>
      )}

      {/* ── Duration — bottom-left (when live) ─────────────────────────────── */}
      {isLive && (
        <div className="absolute bottom-3 left-3 flex flex-col gap-1.5 items-start">
          <div className="flex items-center gap-1.5">
            {streamTitle && (
              <span
                className="px-2.5 py-1 rounded-lg text-xs font-bold text-white max-w-[200px] truncate"
                style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)" }}
              >
                {streamTitle}
              </span>
            )}
            {category && (
              <span
                className="px-2 py-0.5 rounded-lg text-[10px] font-bold text-pnp-accent border border-pnp-accent/30"
                style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)" }}
              >
                {t[category as keyof typeof t] || category}
              </span>
            )}
          </div>
          <span
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold text-white tabular-nums"
            style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)" }}
          >
            {formatDuration(durationSec)}
          </span>
        </div>
      )}

      {/* ── Portrait orientation hint — bottom-right (mobile only) ────────── */}
      {isPortraitMobile && (
        <div
          className="absolute bottom-3 right-3 flex items-center gap-1 px-2 py-1 rounded-lg"
          style={{ background: "rgba(0,0,0,0.5)" }}
        >
          <RotateCwIcon className="w-3 h-3 text-pnp-textSecondary" aria-hidden="true" />
          <span className="text-[9px] text-pnp-textSecondary">Landscape for more</span>
        </div>
      )}
    </div>
  );
}
