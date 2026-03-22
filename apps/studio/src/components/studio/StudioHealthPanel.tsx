import React from "react";
import type { StreamStats } from "@/hooks/useStreamer";
import { BitrateSparkline, StatRow, formatDuration } from "./shared";

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface StudioHealthPanelProps {
  isLive: boolean;
  stats: StreamStats;
  health: "good" | "degraded" | "critical";
  bitrateSamples: number[];
  selectedPreset: { id: string; label: string; width: number; height: number };
  durationSec: number;
  viewerCount: number;
  sessionEarnings: number;
}

// ─── Health color helper ────────────────────────────────────────────────────────

function healthColor(health: StudioHealthPanelProps["health"]): string {
  if (health === "good") return "#5ED1C4";
  if (health === "degraded") return "#FFD60A";
  return "#FF453A";
}

// ─── StudioHealthPanel ─────────────────────────────────────────────────────────

export function StudioHealthPanel({
  isLive,
  stats,
  health,
  bitrateSamples,
  selectedPreset,
  durationSec,
  viewerCount,
  sessionEarnings,
}: StudioHealthPanelProps) {
  const hColor = healthColor(health);

  return (
    <div className="glass-card-sm p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs font-semibold text-pnp-textSecondary uppercase tracking-wider">
          Stream Health
        </p>
        <span
          className="w-2.5 h-2.5 rounded-full flex-shrink-0"
          style={{ background: hColor, boxShadow: `0 0 6px ${hColor}` }}
          aria-label={`Health: ${health}`}
          role="img"
        />
      </div>

      {/* Bitrate sparkline — only while live with enough samples */}
      {isLive && bitrateSamples.length > 1 && (
        <div className="rounded-lg overflow-hidden">
          <BitrateSparkline samples={bitrateSamples} />
        </div>
      )}

      {/* Stats grid */}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5">
        <StatRow
          label="Bitrate"
          value={isLive ? `${stats.bitrate.toLocaleString()} kbps` : "—"}
          color={isLive ? hColor : undefined}
          monospace
        />
        <StatRow
          label="FPS"
          value={isLive ? String(stats.fps) : "—"}
          monospace
        />
        <StatRow
          label="Resolution"
          value={`${selectedPreset.width}×${selectedPreset.height}`}
        />
        <StatRow
          label="Duration"
          value={isLive ? formatDuration(durationSec) : "—"}
          monospace
        />
        <StatRow
          label="Viewers"
          value={isLive ? String(viewerCount) : "—"}
        />
        <StatRow
          label="Dropped"
          value={isLive ? `${stats.droppedFrames} fr` : "—"}
          color={isLive && stats.droppedFrames > 0 ? "#FFD60A" : undefined}
          monospace
        />
        <StatRow
          label="Latency"
          value={isLive ? `${stats.latency} ms` : "—"}
          monospace
        />
        <StatRow
          label="Earnings"
          value={isLive ? `${sessionEarnings} T` : "—"}
          color={isLive && sessionEarnings > 0 ? "#5ED1C4" : undefined}
          monospace
        />
        <StatRow
          label="Sent"
          value={isLive ? `${(stats.bytesSent / 1_000_000).toFixed(1)} MB` : "—"}
          monospace
        />
      </dl>
    </div>
  );
}
