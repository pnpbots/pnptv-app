/**
 * StreamHealthPanel — owner-only real-time RTMP signal status panel.
 *
 * Polls /api/webapp/streams/:streamId/health every 5 seconds and displays:
 *   - A large pill showing signal state (connected / waiting / failed / unknown)
 *   - A metrics row: bitrate · fps · viewers · uptime
 *
 * The component renders nothing for non-owners (safe to drop in unconditionally).
 * Polling is cleaned up on unmount.
 *
 * Inline EN/ES strings follow the UploadVideoModal pattern.
 */

import React, { useEffect, useRef, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/lib/i18n";
import { getStreamHealth, type StreamHealth } from "@/lib/api";

// ── Bilingual strings ──────────────────────────────────────────────────────
const STR = {
  en: {
    pillConnected: "RTMP Active",
    pillWaiting: "Waiting for your stream…",
    pillFailed: "No input detected — check OBS",
    pillUnknown: "Connection status unknown",
    labelBitrate: "Bitrate",
    labelFps: "FPS",
    labelViewers: "Viewers",
    labelUptime: "Uptime",
    unitKbps: "kbps",
  },
  es: {
    pillConnected: "RTMP Activo",
    pillWaiting: "Esperando tu stream…",
    pillFailed: "Sin señal de entrada — revisa OBS",
    pillUnknown: "Estado de conexión desconocido",
    labelBitrate: "Bitrate",
    labelFps: "FPS",
    labelViewers: "Espectadores",
    labelUptime: "Tiempo",
    unitKbps: "kbps",
  },
} as const;

// ── Helpers ────────────────────────────────────────────────────────────────

function formatUptime(seconds: number): string {
  if (seconds <= 0) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// ── Component ──────────────────────────────────────────────────────────────

interface Props {
  /** Channel ref string — e.g. "pnptv-frank". Matches the :streamId route param. */
  streamId: string;
  /** Optional callback fired on every health poll result with the derived live state. */
  onHealth?: (isLive: boolean) => void;
}

export function StreamHealthPanel({ streamId, onHealth }: Props) {
  const { user } = useAuth();
  const i18n = useI18n();
  const s = STR[i18n.lang === "es" ? "es" : "en"];

  const [health, setHealth] = useState<StreamHealth | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Only creators and admins own streams
  const isOwner = !!(
    user && ["model", "creator", "admin", "superadmin"].includes(user.role)
  );

  useEffect(() => {
    if (!isOwner || !streamId) return;

    let cancelled = false;

    const poll = () => {
      getStreamHealth(streamId)
        .then((data) => {
          if (!cancelled) {
            setHealth(data);
            onHealth?.(data.inputState === "connected" && (data.bitrateKbps ?? 0) > 0);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setHealth({
              inputState: "unknown",
              bitrateKbps: 0,
              fps: 0,
              viewerCount: 0,
              lastInputAt: null,
              uptimeSeconds: 0,
              error: "restreamer_unreachable",
            });
            onHealth?.(false);
          }
        });
    };

    // Immediate first fetch
    poll();
    intervalRef.current = setInterval(poll, 5000);

    return () => {
      cancelled = true;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isOwner, streamId]);

  // Not an owner — render nothing
  if (!isOwner) return null;

  // Derive pill appearance
  const isStale =
    health?.inputState === "connected" &&
    health.lastInputAt !== null &&
    Date.now() - new Date(health.lastInputAt).getTime() > 30_000;

  const effectiveState =
    isStale ? "failed" : (health?.inputState ?? "idle");

  type PillVariant = "connected" | "waiting" | "failed" | "unknown";

  const pillVariant: PillVariant =
    effectiveState === "connected" && (health?.bitrateKbps ?? 0) > 0
      ? "connected"
      : effectiveState === "idle"
      ? "waiting"
      : effectiveState === "unknown"
      ? "unknown"
      : "failed";

  const pillConfig: Record<
    PillVariant,
    { label: string; bg: string; text: string; dot: string; icon: string }
  > = {
    connected: {
      label: s.pillConnected,
      bg: "bg-green-500/15 border-green-500/40",
      text: "text-green-400",
      dot: "bg-green-500 animate-pulse",
      icon: "●",
    },
    waiting: {
      label: s.pillWaiting,
      bg: "bg-amber-500/15 border-amber-500/40",
      text: "text-amber-400",
      dot: "bg-amber-400 animate-pulse",
      icon: "⏳",
    },
    failed: {
      label: s.pillFailed,
      bg: "bg-red-500/15 border-red-500/40",
      text: "text-red-400",
      dot: "bg-red-500",
      icon: "⚠️",
    },
    unknown: {
      label: s.pillUnknown,
      bg: "bg-pnp-surface border-pnp-border",
      text: "text-pnp-textSecondary",
      dot: "bg-pnp-textSecondary",
      icon: "❓",
    },
  };

  const pill = pillConfig[pillVariant];

  return (
    <div className="rounded-xl border p-3 space-y-2.5 mt-3">
      {/* ── Signal pill ──────────────────────────────────────────────────── */}
      <div
        className={`flex items-center gap-2.5 rounded-full px-4 py-2.5 border ${pill.bg}`}
        role="status"
        aria-live="polite"
      >
        <span
          className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${pill.dot}`}
          aria-hidden="true"
        />
        <span className={`text-sm font-bold tracking-wide ${pill.text}`}>
          {pill.icon}&nbsp;{pill.label}
        </span>
        {/* Loading skeleton when health hasn't loaded yet */}
        {health === null && (
          <span className="ml-auto w-4 h-4 border-2 border-pnp-textSecondary/40 border-t-pnp-textSecondary rounded-full animate-spin flex-shrink-0" />
        )}
      </div>

      {/* ── Metrics row ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-4 divide-x divide-pnp-border rounded-lg border border-pnp-border overflow-hidden">
        <MetricCell
          label={s.labelBitrate}
          value={
            health
              ? `${health.bitrateKbps} ${s.unitKbps}`
              : "—"
          }
          alert={
            health !== null &&
            health.inputState === "connected" &&
            health.bitrateKbps > 0 &&
            health.bitrateKbps < 500
          }
        />
        <MetricCell
          label={s.labelFps}
          value={health ? String(health.fps) : "—"}
          alert={
            health !== null &&
            health.inputState === "connected" &&
            health.fps > 0 &&
            health.fps < 20
          }
        />
        <MetricCell
          label={s.labelViewers}
          value={health ? String(health.viewerCount) : "—"}
        />
        <MetricCell
          label={s.labelUptime}
          value={health ? formatUptime(health.uptimeSeconds) : "—"}
        />
      </div>
    </div>
  );
}

// ── Sub-component ──────────────────────────────────────────────────────────

function MetricCell({
  label,
  value,
  alert = false,
}: {
  label: string;
  value: string;
  alert?: boolean;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-2 py-2 bg-pnp-surface">
      <span
        className={`text-sm font-bold tabular-nums ${
          alert ? "text-amber-400" : "text-pnp-textPrimary"
        }`}
      >
        {value}
      </span>
      <span className="text-[10px] text-pnp-textSecondary mt-0.5">{label}</span>
    </div>
  );
}
