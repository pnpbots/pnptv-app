import React, { useState, useEffect, useCallback } from "react";
import { ConfirmModal } from "@/components/admin/ConfirmModal";
import { Badge } from "@pnptv/ui-kit";
import {
  getAdminHangouts,
  endAdminHangout,
  type AdminHangout,
} from "@/lib/api";

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const UsersIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
);

const CalendarIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
  </svg>
);

export default function HangoutModeration() {
  const [hangouts, setHangouts] = useState<AdminHangout[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [endTarget, setEndTarget] = useState<AdminHangout | null>(null);
  const [endLoading, setEndLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getAdminHangouts();
      setHangouts(res.hangouts);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load hangouts");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleEnd = async () => {
    if (!endTarget) return;
    setEndLoading(true);
    try {
      await endAdminHangout(endTarget.id);
      setEndTarget(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to end hangout");
      setEndTarget(null);
    } finally {
      setEndLoading(false);
    }
  };

  const participantFraction = (hangout: AdminHangout): string => {
    return `${hangout.currentParticipants} / ${hangout.maxParticipants}`;
  };

  const participantPct = (hangout: AdminHangout): number => {
    if (!hangout.maxParticipants) return 0;
    return Math.min((hangout.currentParticipants / hangout.maxParticipants) * 100, 100);
  };

  return (
    <div className="page-container space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-pnp-textPrimary">Hangout Moderation</h1>
          <p className="text-sm text-pnp-textSecondary mt-1">
            Monitor and manage active hangout rooms
          </p>
        </div>
        <button
          onClick={load}
          className="text-xs text-pnp-textSecondary hover:text-pnp-textPrimary border border-pnp-border rounded-lg px-3 py-1.5 transition-colors"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-2 hover:text-red-300">Dismiss</button>
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-36 rounded-xl bg-pnp-surface border border-pnp-border animate-pulse" />
          ))}
        </div>
      ) : hangouts.length === 0 ? (
        <div className="rounded-xl bg-pnp-surface border border-pnp-border py-16 text-center">
          <svg className="w-12 h-12 mx-auto mb-4 text-pnp-textSecondary/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <p className="text-pnp-textSecondary font-medium">No active hangouts</p>
          <p className="text-sm text-pnp-textSecondary/60 mt-1">
            All hangout rooms are currently empty or ended.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {hangouts.map((hangout) => (
            <div
              key={hangout.id}
              className="rounded-xl bg-pnp-surface border border-pnp-border p-4 flex flex-col gap-3"
            >
              {/* Header */}
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="font-semibold text-pnp-textPrimary truncate">{hangout.title}</h3>
                  <p className="text-xs text-pnp-textSecondary mt-0.5">
                    by {hangout.creatorName}
                  </p>
                </div>
                <Badge variant={hangout.isPublic ? "success" : "warning"}>
                  {hangout.isPublic ? "Public" : "Private"}
                </Badge>
              </div>

              {/* Participant bar */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1.5 text-xs text-pnp-textSecondary">
                    <UsersIcon />
                    <span>{participantFraction(hangout)} participants</span>
                  </div>
                  <span className="text-xs text-pnp-textSecondary">
                    {participantPct(hangout).toFixed(0)}% full
                  </span>
                </div>
                <div className="w-full bg-pnp-border rounded-full h-1.5">
                  <div
                    className="bg-pnp-accent h-1.5 rounded-full transition-all"
                    style={{ width: `${participantPct(hangout)}%` }}
                  />
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs text-pnp-textSecondary">
                  <CalendarIcon />
                  <span>{formatDate(hangout.createdAt)}</span>
                </div>
                <button
                  onClick={() => setEndTarget(hangout)}
                  className="px-3 py-1.5 text-xs rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors font-medium"
                >
                  End Hangout
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmModal
        open={!!endTarget}
        title="End Hangout"
        message={`Are you sure you want to end the hangout "${endTarget?.title ?? ""}"? All ${endTarget?.currentParticipants ?? 0} participant(s) will be disconnected immediately.`}
        confirmLabel="End Hangout"
        variant="danger"
        onConfirm={handleEnd}
        onCancel={() => setEndTarget(null)}
        loading={endLoading}
      />
    </div>
  );
}
