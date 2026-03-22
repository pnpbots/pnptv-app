import React from "react";
import { MiniStat, NetworkQualityPill, formatDuration } from "./shared";
import type { NetworkQuality } from "./shared";
import type { HealthStatus, StreamStats } from "@/hooks/useStreamer";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function healthColor(status: HealthStatus): string {
  if (status === "good") return "#5ED1C4";
  if (status === "degraded") return "#FFD60A";
  return "#FF453A";
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface StudioStatusBarProps {
  isLive: boolean;
  stats: StreamStats;
  viewerCount: number;
  durationSec: number;
  networkQuality: NetworkQuality;
  health: HealthStatus;
}

// ─── StudioStatusBar ──────────────────────────────────────────────────────────
// Compact mobile-only stats bar. Hidden on desktop (lg:hidden).

export function StudioStatusBar({
  isLive,
  stats,
  viewerCount,
  durationSec,
  networkQuality,
  health,
}: StudioStatusBarProps) {
  const hColor = healthColor(health);

  return (
    <div
      className="lg:hidden flex items-center justify-between gap-2 px-3 py-2 border-b border-pnp-border flex-shrink-0"
      style={{ background: "rgba(18,18,18,0.9)" }}
    >
      <MiniStat label="Bitrate" value={isLive ? `${stats.bitrate}k` : "—"} />
      <MiniStat label="FPS" value={isLive ? String(stats.fps) : "—"} />
      <MiniStat label="Viewers" value={isLive ? String(viewerCount) : "—"} />
      <MiniStat label="Time" value={isLive ? formatDuration(durationSec) : "—"} monospace />
      <NetworkQualityPill quality={networkQuality} />
      <span
        className="w-2 h-2 rounded-full flex-shrink-0"
        style={{ background: hColor }}
        aria-label={`Health: ${health}`}
      />
    </div>
  );
}
