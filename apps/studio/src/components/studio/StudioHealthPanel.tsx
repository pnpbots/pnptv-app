import React, { useState } from "react";
import type { StreamStats } from "@/hooks/useStreamer";
import type { EarningsHistory } from "@/lib/api";
import { BitrateSparkline, StatRow, formatDuration, ShareIcon, ExternalLinkIcon } from "./shared";

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
  channel: { ref: string } | null;
  // Gap 1: historical earnings (optional — panel degrades gracefully if null)
  earningsHistory?: EarningsHistory | null;
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
  channel,
  earningsHistory,
}: StudioHealthPanelProps) {
  const hColor = healthColor(health);
  const [copied, setCopied] = useState(false);

  const publicUrl = channel 
    ? `${import.meta.env.VITE_APP_URL || "https://pnptv.app"}/live/${channel.ref}`
    : null;

  const handleShare = async () => {
    if (!publicUrl) return;
    if (navigator.share) {
      try {
        await navigator.share({ title: "Watch my live stream on PNPtv!", url: publicUrl });
      } catch { /* ignore */ }
    } else {
      navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

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

      {/* Gap 1: Historical earnings — two compact stat cards */}
      {earningsHistory && (
        <div className="grid grid-cols-2 gap-2 pt-1 border-t border-pnp-border/30">
          <div className="rounded-lg bg-pnp-background border border-pnp-border/50 px-2.5 py-2">
            <p className="text-[9px] font-semibold text-pnp-textSecondary uppercase tracking-wider mb-0.5">
              30-day
            </p>
            <p className="text-xs font-bold text-pnp-textPrimary tabular-nums">
              ${earningsHistory.totalLast30Days.toFixed(2)}
            </p>
          </div>
          <div className="rounded-lg bg-pnp-background border border-pnp-border/50 px-2.5 py-2">
            <p className="text-[9px] font-semibold text-pnp-textSecondary uppercase tracking-wider mb-0.5">
              All-time
            </p>
            <p className="text-xs font-bold text-pnp-textPrimary tabular-nums">
              ${earningsHistory.totalAllTime.toFixed(2)}
            </p>
          </div>
        </div>
      )}

      {/* Actions (improvement #10) */}
      {channel && (
        <div className="grid grid-cols-2 gap-2 pt-2 border-t border-pnp-border/30">
          <button
            onClick={handleShare}
            className="flex items-center justify-center gap-1.5 py-2 rounded-lg bg-pnp-surface border border-pnp-border hover:bg-pnp-surfaceHover transition-colors text-[10px] font-bold text-pnp-textPrimary"
          >
            <ShareIcon className="w-3.5 h-3.5 text-pnp-accent" />
            {copied ? "COPIED!" : "SHARE"}
          </button>
          <a
            href={publicUrl!}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-1.5 py-2 rounded-lg bg-pnp-surface border border-pnp-border hover:bg-pnp-surfaceHover transition-colors text-[10px] font-bold text-pnp-textPrimary"
          >
            <ExternalLinkIcon className="w-3.5 h-3.5 text-pnp-accent" />
            VIEW LIVE
          </a>
        </div>
      )}
    </div>
  );
}
