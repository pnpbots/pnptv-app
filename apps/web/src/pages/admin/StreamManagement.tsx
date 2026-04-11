import React, { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Card, Skeleton } from "@pnptv/ui-kit";
import {
  getStreamOverlays,
  type StreamOverlay,
} from "@/lib/api";
import { OverlayEditorModal } from "@/components/admin/OverlayEditorModal";
import { useI18n } from "@/lib/i18n";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractChannelName(channelRef: string): string {
  // e.g. "pnptv-santino" → "Pnptv Santino"
  return channelRef
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ─── Channel Card ─────────────────────────────────────────────────────────────

interface ChannelCardProps {
  overlay: StreamOverlay;
  onEdit: (overlay: StreamOverlay) => void;
}

function ChannelCard({ overlay, onEdit }: ChannelCardProps) {
  const t = useI18n().admin;
  return (
    <Card className="flex flex-col gap-3 p-4">
      {/* Header row */}
      <div className="flex items-start justify-between gap-2 min-w-0">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-pnp-textPrimary truncate">
            {extractChannelName(overlay.channel_ref)}
          </p>
          <p className="text-xs text-pnp-textSecondary truncate mt-0.5">
            {overlay.channel_ref}
          </p>
        </div>
        <span
          className={`flex-shrink-0 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
            overlay.is_active
              ? "bg-green-500/20 text-green-400"
              : "bg-pnp-surfaceHover text-pnp-textSecondary"
          }`}
        >
          {overlay.is_active ? t.shared.active : t.shared.inactive}
        </span>
      </div>

      {/* Logo preview */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-pnp-surfaceHover flex items-center justify-center flex-shrink-0 overflow-hidden">
          {overlay.logo_url ? (
            <img
              src={overlay.logo_url}
              alt="Logo"
              className="w-full h-full object-contain"
            />
          ) : (
            <svg
              className="w-5 h-5 text-pnp-textSecondary"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z"
              />
            </svg>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-pnp-textSecondary">
            {overlay.logo_url ? t.streams.logoSet : t.streams.noLogo}
          </p>
          {overlay.banner_text ? (
            <p className="text-xs text-pnp-textPrimary truncate mt-0.5">
              "{overlay.banner_text}"
            </p>
          ) : (
            <p className="text-xs text-pnp-textSecondary/60 mt-0.5">
              {t.streams.noBannerText}
            </p>
          )}
        </div>
      </div>

      {/* Updated at */}
      <p className="text-[10px] text-pnp-textSecondary/60">
        Updated {formatDate(overlay.updated_at)}
      </p>

      {/* Edit button */}
      <button
        onClick={() => onEdit(overlay)}
        className="w-full min-h-[44px] rounded-lg bg-pnp-surfaceHover border border-pnp-border text-sm font-medium text-pnp-textPrimary hover:border-pnp-accent/40 hover:text-pnp-accent active:scale-[0.98] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent focus-visible:ring-offset-2 focus-visible:ring-offset-pnp-background"
      >
        {t.streams.editOverlay}
      </button>
    </Card>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function StreamManagement() {
  const { isAdmin, isLoading: authLoading } = useAuth();
  const navigate = useNavigate();
  const t = useI18n().admin;

  const [overlays, setOverlays] = useState<StreamOverlay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<StreamOverlay | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    return getStreamOverlays()
      .then((res) => setOverlays(res.overlays || []))
      .catch((err) =>
        setError(
          err instanceof Error ? err.message : "Failed to load stream overlays"
        )
      )
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!authLoading && isAdmin) {
      load();
    }
  }, [authLoading, isAdmin, load]);

  function handleOverlaySaved(updated: StreamOverlay) {
    setOverlays((prev) =>
      prev.map((o) => (o.channel_ref === updated.channel_ref ? updated : o))
    );
    setEditing(null);
    setSuccessMsg(`Overlay for "${updated.channel_ref}" saved.`);
    setTimeout(() => setSuccessMsg(null), 3000);
  }

  // Auth guard (AdminLayout already handles this, but double-check)
  if (authLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64 rounded-xl" />
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-52 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-pnp-textPrimary">
            {t.streams.title}
          </h1>
          <p className="text-sm text-pnp-textSecondary mt-1">
            {t.streams.subtitle}
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          aria-label={t.streams.refreshOverlays}
          className="min-h-[44px] min-w-[44px] px-4 flex items-center gap-2 rounded-xl border border-pnp-border text-sm text-pnp-textSecondary hover:text-pnp-textPrimary hover:border-pnp-accent/40 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent focus-visible:ring-offset-2 focus-visible:ring-offset-pnp-background"
        >
          <svg
            className={`w-4 h-4 ${loading ? "animate-spin" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
          {t.shared.refresh}
        </button>
      </div>

      {/* Success toast */}
      {successMsg && (
        <div
          role="status"
          aria-live="polite"
          className="px-4 py-3 rounded-xl bg-green-500/10 border border-green-500/30 text-sm text-green-400"
        >
          {successMsg}
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="rounded-xl bg-pnp-surface border border-pnp-border p-4 space-y-3 animate-pulse"
            >
              <div className="flex items-center justify-between">
                <div className="h-4 w-32 rounded bg-pnp-surfaceHover" />
                <div className="h-4 w-14 rounded-full bg-pnp-surfaceHover" />
              </div>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-pnp-surfaceHover flex-shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 w-20 rounded bg-pnp-surfaceHover" />
                  <div className="h-3 w-32 rounded bg-pnp-surfaceHover" />
                </div>
              </div>
              <div className="h-3 w-24 rounded bg-pnp-surfaceHover" />
              <div className="h-10 rounded-lg bg-pnp-surfaceHover" />
            </div>
          ))}
        </div>
      )}

      {/* Error state */}
      {!loading && error && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-12 h-12 rounded-full bg-pnp-error/10 flex items-center justify-center mb-4">
            <svg
              className="w-6 h-6 text-pnp-error"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
          <p className="text-pnp-textPrimary font-medium mb-1">
            {t.streams.failedToLoad}
          </p>
          <p className="text-sm text-pnp-textSecondary mb-4">{error}</p>
          <button
            onClick={load}
            className="px-5 py-2.5 min-h-[44px] rounded-xl btn-gradient text-white text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent focus-visible:ring-offset-2 focus-visible:ring-offset-pnp-background"
          >
            {t.shared.tryAgain}
          </button>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && overlays.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-12 h-12 rounded-full bg-pnp-surfaceHover flex items-center justify-center mb-4">
            <svg
              className="w-6 h-6 text-pnp-textSecondary"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
              />
            </svg>
          </div>
          <p className="text-pnp-textPrimary font-medium mb-1">
            {t.streams.noChannels}
          </p>
          <p className="text-sm text-pnp-textSecondary">
            {t.streams.noChannelsDesc}
          </p>
        </div>
      )}

      {/* Channel grid */}
      {!loading && !error && overlays.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          {overlays.map((overlay) => (
            <ChannelCard
              key={overlay.channel_ref}
              overlay={overlay}
              onEdit={setEditing}
            />
          ))}
        </div>
      )}

      {/* Editor Modal */}
      {editing && (
        <OverlayEditorModal
          overlay={editing}
          onClose={() => setEditing(null)}
          onSaved={handleOverlaySaved}
        />
      )}
    </div>
  );
}
