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
  channelRef?: string | null;
  liveGoal?: import("@/lib/api").LiveGoal | null;
  onSetGoal?: (amount: number, label: string) => void;
  acceptingCalls?: boolean;
  onToggleAcceptingCalls?: () => void;
}

// ─── GoalSetForm ───────────────────────────────────────────────────────────────

function GoalSetForm({ onSetGoal }: { onSetGoal: (amount: number, label: string) => void }) {
  const [amount, setAmount] = useState("");
  const [label, setLabel] = useState("");
  return (
    <div className="space-y-1.5">
      <input
        type="number"
        min={1}
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        placeholder="Amount (T)"
        className="w-full bg-pnp-background border border-pnp-border rounded-lg px-2 py-1.5 text-[10px] text-pnp-textPrimary placeholder-pnp-textSecondary/50 focus:outline-none focus:ring-1 focus:ring-pnp-accent"
      />
      <input
        type="text"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="Label (e.g. 'Strip show')"
        maxLength={40}
        className="w-full bg-pnp-background border border-pnp-border rounded-lg px-2 py-1.5 text-[10px] text-pnp-textPrimary placeholder-pnp-textSecondary/50 focus:outline-none focus:ring-1 focus:ring-pnp-accent"
      />
      <button
        onClick={() => { const a = parseInt(amount); if (a > 0) { onSetGoal(a, label); setAmount(""); setLabel(""); }}}
        disabled={!amount || parseInt(amount) <= 0}
        className="w-full py-1.5 rounded-lg text-[10px] font-bold text-white transition-opacity disabled:opacity-40"
        style={{ background: "linear-gradient(135deg,#D4007A,#E69138)" }}
      >
        Set Goal
      </button>
    </div>
  );
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
  liveGoal,
  onSetGoal,
  acceptingCalls,
  onToggleAcceptingCalls,
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

      {/* Tip goal */}
      {(liveGoal || onSetGoal) && (
        <div className="pt-2 border-t border-pnp-border/30 space-y-2">
          <p className="text-[9px] font-semibold text-pnp-textSecondary uppercase tracking-wider">Tip Goal</p>
          {liveGoal ? (
            <>
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-pnp-textSecondary truncate">{liveGoal.goalLabel || "Goal"}</span>
                <span className={`font-bold tabular-nums ${liveGoal.completed ? "text-green-400" : "text-pnp-textPrimary"}`}>
                  {liveGoal.completed ? "✓ Reached!" : `${liveGoal.progress}/${liveGoal.goalAmount}T`}
                </span>
              </div>
              <div className="w-full bg-pnp-border rounded-full h-1.5">
                <div
                  className="h-1.5 rounded-full transition-all duration-500"
                  style={{
                    width: `${Math.min(100, (liveGoal.progress / liveGoal.goalAmount) * 100)}%`,
                    background: liveGoal.completed ? "#22c55e" : "linear-gradient(90deg,#D4007A,#E69138)",
                  }}
                />
              </div>
            </>
          ) : null}
          {onSetGoal && <GoalSetForm onSetGoal={onSetGoal} />}
        </div>
      )}

      {/* Accepting calls toggle */}
      {onToggleAcceptingCalls !== undefined && (
        <div className="pt-2 border-t border-pnp-border/30 flex items-center justify-between">
          <span className="text-[10px] text-pnp-textSecondary font-medium">Accepting Calls</span>
          <button
            onClick={onToggleAcceptingCalls}
            className={`relative w-9 h-5 rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent flex-shrink-0 ${acceptingCalls ? "bg-pnp-accent" : "bg-pnp-border"}`}
            role="switch"
            aria-checked={acceptingCalls}
            aria-label="Toggle accepting calls"
          >
            <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200 ${acceptingCalls ? "translate-x-4" : "translate-x-0"}`} />
          </button>
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
