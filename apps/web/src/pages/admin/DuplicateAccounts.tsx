import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/hooks/useAuth";
import {
  getDuplicateAccounts,
  previewAccountMerge,
  mergeAccounts,
  renameAccountToTelegramId,
  type MergeCandidate,
  type MergeLogEntry,
  type MergePreview,
} from "@/lib/api";

// ─── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function truncate(str: string | null | undefined, max = 20): string {
  if (!str) return "—";
  return str.length > max ? str.slice(0, max) + "…" : str;
}

function isNumeric(id: string): boolean {
  return /^\d+$/.test(id);
}

function isUuid(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

const DIMENSION_COLORS: Record<string, string> = {
  email: "bg-blue-900 text-blue-200",
  telegram: "bg-green-900 text-green-200",
  x_id: "bg-sky-900 text-sky-200",
  pnptv_id: "bg-purple-900 text-purple-200",
  rename_tg: "bg-orange-900 text-orange-200",
  manual: "bg-zinc-700 text-zinc-200",
};

function DimensionBadge({ dimension }: { dimension: string }) {
  const cls = DIMENSION_COLORS[dimension] ?? "bg-zinc-700 text-zinc-200";
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-mono font-semibold ${cls}`}>
      {dimension}
    </span>
  );
}

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color =
    pct >= 95 ? "bg-green-500" :
    pct >= 80 ? "bg-yellow-500" :
    "bg-orange-500";
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-16 h-1.5 rounded-full bg-zinc-700 overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-zinc-400">{pct}%</span>
    </div>
  );
}

// ─── User Snapshot column ───────────────────────────────────────────────────

interface SnapshotColProps {
  snapshot: MergeCandidate["sourceSnapshot"];
  label: string;
  t: ReturnType<typeof useI18n>["admin"]["duplicateAccounts"];
}

function SnapshotCol({ snapshot, label, t }: SnapshotColProps) {
  const idType = isNumeric(snapshot.id) ? "numeric" : isUuid(snapshot.id) ? "uuid" : "other";
  const idColor =
    idType === "numeric" ? "text-green-400" :
    idType === "uuid" ? "text-orange-400" :
    "text-zinc-400";

  return (
    <div className="flex-1 min-w-0">
      <div className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-2">{label}</div>
      <div className="space-y-1 text-sm">
        <div className="flex gap-1 items-start">
          <span className="text-zinc-500 w-24 shrink-0">{t.id}</span>
          <span className={`font-mono text-xs break-all ${idColor}`}>{snapshot.id}</span>
        </div>
        <div className="flex gap-1 items-start">
          <span className="text-zinc-500 w-24 shrink-0">{t.username}</span>
          <span className="text-zinc-200 break-all">{snapshot.username || "—"}</span>
        </div>
        <div className="flex gap-1 items-start">
          <span className="text-zinc-500 w-24 shrink-0">{t.email}</span>
          <span className="text-zinc-200 break-all text-xs">{snapshot.email || "—"}</span>
        </div>
        <div className="flex gap-1 items-start">
          <span className="text-zinc-500 w-24 shrink-0">{t.tier}</span>
          <span className="text-zinc-200">{snapshot.tier}</span>
        </div>
        <div className="flex gap-1 items-start">
          <span className="text-zinc-500 w-24 shrink-0">{t.planId}</span>
          <span className="text-zinc-200 text-xs">{snapshot.planId || "—"}</span>
        </div>
        <div className="flex gap-1 items-start">
          <span className="text-zinc-500 w-24 shrink-0">{t.planExpiry}</span>
          <span className="text-zinc-200 text-xs">{formatDate(snapshot.planExpiry)}</span>
        </div>
        <div className="flex gap-1 items-start">
          <span className="text-zinc-500 w-24 shrink-0">{t.createdAt}</span>
          <span className="text-zinc-200 text-xs">{formatDate(snapshot.createdAt)}</span>
        </div>
        <div className="flex gap-1 items-start">
          <span className="text-zinc-500 w-24 shrink-0">{t.lastActive}</span>
          <span className="text-zinc-200 text-xs">{formatDate(snapshot.lastActive)}</span>
        </div>
        <div className="flex gap-1 items-start">
          <span className="text-zinc-500 w-24 shrink-0">{t.entitlements}</span>
          <span className="text-zinc-200">{snapshot.activeEntitlements}</span>
        </div>
        <div className="flex gap-1 items-start">
          <span className="text-zinc-500 w-24 shrink-0">{t.payments}</span>
          <span className="text-zinc-200">{snapshot.paymentCount}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Preview Modal ─────────────────────────────────────────────────────────────

interface PreviewModalProps {
  preview: MergePreview;
  candidate: MergeCandidate;
  onClose: () => void;
  onMerge: (reason: string) => void;
  onRename: () => void;
  merging: boolean;
  t: ReturnType<typeof useI18n>["admin"]["duplicateAccounts"];
}

function PreviewModal({ preview, candidate, onClose, onMerge, onRename, merging, t }: PreviewModalProps) {
  const { admin: adminT } = useI18n();
  const [confirmInput, setConfirmInput] = useState("");
  const [reason, setReason] = useState("");
  const [mode, setMode] = useState<"preview" | "confirm_merge" | "confirm_rename">("preview");

  const canConfirmMerge = confirmInput.trim() === "MERGE";
  const showRenameBtn = isUuid(candidate.sourceId) && isNumeric(candidate.targetId);

  const handleMerge = () => {
    if (!canConfirmMerge) return;
    onMerge(reason);
  };

  const handleRename = () => {
    if (!canConfirmMerge) return;
    onRename();
  };

  const tableEntries = Object.entries(preview.tablesAffected);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="bg-pnp-surface border border-zinc-700 rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 border-b border-zinc-700">
          <h2 className="text-lg font-bold text-pnp-textPrimary">
            {mode === "preview" ? t.previewTitle :
             mode === "confirm_merge" ? t.confirmMergeTitle :
             t.confirmRenamTitle}
          </h2>
        </div>

        <div className="p-5 space-y-4">
          {mode === "preview" && (
            <>
              <p className="text-sm text-zinc-400">{t.previewDesc}</p>

              {preview.warnings.length > 0 && (
                <div className="rounded-lg border border-yellow-700 bg-yellow-950/40 p-3 space-y-1">
                  <div className="text-xs font-semibold text-yellow-400 mb-1">{t.previewWarnings}</div>
                  {preview.warnings.map((w, i) => (
                    <div key={i} className="text-xs text-yellow-300">{w}</div>
                  ))}
                </div>
              )}

              {tableEntries.length === 0 ? (
                <p className="text-sm text-zinc-500 italic">{t.previewEmpty}</p>
              ) : (
                <div className="rounded-lg border border-zinc-700 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-zinc-800">
                      <tr>
                        <th className="text-left px-3 py-2 text-zinc-400 font-medium">{t.previewTable}</th>
                        <th className="text-right px-3 py-2 text-zinc-400 font-medium">{t.previewRows}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-700">
                      {tableEntries.map(([table, count]) => (
                        <tr key={table} className="hover:bg-zinc-800/40">
                          <td className="px-3 py-1.5 font-mono text-xs text-zinc-200">{table}</td>
                          <td className="px-3 py-1.5 text-right text-zinc-300">{count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={onClose}
                  className="px-4 py-2 rounded-lg bg-zinc-700 text-zinc-200 text-sm hover:bg-zinc-600 transition-colors"
                >
                  {adminT.shared.cancel}
                </button>
                {showRenameBtn && (
                  <button
                    onClick={() => setMode("confirm_rename")}
                    className="px-4 py-2 rounded-lg bg-orange-700 text-white text-sm hover:bg-orange-600 transition-colors"
                  >
                    {t.renameBtn}
                  </button>
                )}
                <button
                  onClick={() => setMode("confirm_merge")}
                  className="px-4 py-2 rounded-lg bg-red-700 text-white text-sm hover:bg-red-600 transition-colors"
                >
                  {t.mergeBtn}
                </button>
              </div>
            </>
          )}

          {(mode === "confirm_merge" || mode === "confirm_rename") && (
            <>
              <p className="text-sm text-zinc-300">
                {mode === "confirm_merge" ? t.confirmMergeDesc : t.confirmRenamDesc}
              </p>

              {mode === "confirm_merge" && (
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">{t.reasonLabel}</label>
                  <input
                    type="text"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder={t.reasonPlaceholder}
                    className="w-full rounded-lg bg-zinc-800 border border-zinc-600 text-zinc-200 text-sm px-3 py-2 focus:outline-none focus:border-zinc-400"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs text-zinc-400 mb-1">{t.confirmMergePlaceholder}</label>
                <input
                  type="text"
                  value={confirmInput}
                  onChange={(e) => setConfirmInput(e.target.value)}
                  placeholder={t.confirmMergePlaceholder}
                  className="w-full rounded-lg bg-zinc-800 border border-zinc-600 text-zinc-200 text-sm px-3 py-2 focus:outline-none focus:border-zinc-400"
                  autoFocus
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={() => { setMode("preview"); setConfirmInput(""); }}
                  className="px-4 py-2 rounded-lg bg-zinc-700 text-zinc-200 text-sm hover:bg-zinc-600 transition-colors"
                  disabled={merging}
                >
                  {adminT.shared.cancel}
                </button>
                <button
                  onClick={mode === "confirm_merge" ? handleMerge : handleRename}
                  disabled={!canConfirmMerge || merging}
                  className="px-4 py-2 rounded-lg bg-red-700 text-white text-sm hover:bg-red-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {merging ? t.merging :
                   mode === "confirm_merge" ? t.confirmMergeBtn : t.confirmRenamBtn}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Candidate Row ───────────────────────────────────────────────────────────

interface CandidateRowProps {
  candidate: MergeCandidate;
  onPreview: (c: MergeCandidate) => void;
  t: ReturnType<typeof useI18n>["admin"]["duplicateAccounts"];
}

function CandidateRow({ candidate, onPreview, t }: CandidateRowProps) {
  return (
    <div className="rounded-xl border border-zinc-700 bg-zinc-800/40 p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <DimensionBadge dimension={candidate.dimension} />
          <ConfidenceBar value={candidate.confidence} />
          <span className="text-xs text-zinc-500">{t.confidence}</span>
        </div>
        <button
          onClick={() => onPreview(candidate)}
          className="px-3 py-1.5 rounded-lg bg-pnp-accent text-white text-sm hover:opacity-90 transition-opacity"
        >
          {t.previewBtn}
        </button>
      </div>
      <div className="flex gap-4 flex-col sm:flex-row">
        <SnapshotCol snapshot={candidate.sourceSnapshot} label={t.sourceAccount} t={t} />
        <div className="hidden sm:flex items-center justify-center text-zinc-600 text-2xl font-light">→</div>
        <SnapshotCol snapshot={candidate.targetSnapshot} label={t.targetAccount} t={t} />
      </div>
    </div>
  );
}

// ─── History Tab ─────────────────────────────────────────────────────────────

interface HistoryTabProps {
  mergeLog: MergeLogEntry[];
  t: ReturnType<typeof useI18n>["admin"]["duplicateAccounts"];
}

function HistoryTab({ mergeLog, t }: HistoryTabProps) {
  if (mergeLog.length === 0) {
    return <p className="text-center py-12 text-zinc-500 text-sm">{t.noHistory}</p>;
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-700">
      <table className="w-full text-sm">
        <thead className="bg-zinc-800">
          <tr>
            <th className="text-left px-3 py-2 text-zinc-400 font-medium whitespace-nowrap">{t.historyId}</th>
            <th className="text-left px-3 py-2 text-zinc-400 font-medium whitespace-nowrap">{t.historyLoser}</th>
            <th className="text-left px-3 py-2 text-zinc-400 font-medium whitespace-nowrap">{t.historyWinner}</th>
            <th className="text-left px-3 py-2 text-zinc-400 font-medium whitespace-nowrap">{t.historyDimension}</th>
            <th className="text-left px-3 py-2 text-zinc-400 font-medium whitespace-nowrap">{t.historyReason}</th>
            <th className="text-left px-3 py-2 text-zinc-400 font-medium whitespace-nowrap">{t.historyPerformedBy}</th>
            <th className="text-left px-3 py-2 text-zinc-400 font-medium whitespace-nowrap">{t.historyAt}</th>
            <th className="text-right px-3 py-2 text-zinc-400 font-medium whitespace-nowrap">{t.historyRows}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-700">
          {mergeLog.map((entry) => {
            const totalRows = Object.values(entry.rows_transferred).reduce(
              (s, n) => s + (typeof n === "number" ? n : 0),
              0
            );
            return (
              <tr key={entry.id} className="hover:bg-zinc-800/40">
                <td className="px-3 py-2 text-zinc-300 font-mono text-xs">{entry.id}</td>
                <td className="px-3 py-2">
                  <div className="text-xs font-mono text-orange-400">{truncate(entry.loser_id, 16)}</div>
                  {entry.loser_username && (
                    <div className="text-xs text-zinc-400">@{entry.loser_username}</div>
                  )}
                </td>
                <td className="px-3 py-2">
                  <div className="text-xs font-mono text-green-400">{truncate(entry.winner_id, 16)}</div>
                  {entry.winner_username && (
                    <div className="text-xs text-zinc-400">@{entry.winner_username}</div>
                  )}
                </td>
                <td className="px-3 py-2">
                  <DimensionBadge dimension={entry.dimension} />
                </td>
                <td className="px-3 py-2 text-zinc-400 text-xs max-w-xs truncate">
                  {entry.merge_reason || "—"}
                </td>
                <td className="px-3 py-2 text-zinc-400 text-xs">
                  {entry.performed_by_username ? `@${entry.performed_by_username}` : truncate(entry.performed_by, 12)}
                </td>
                <td className="px-3 py-2 text-zinc-400 text-xs whitespace-nowrap">
                  {formatDate(entry.merged_at)}
                </td>
                <td className="px-3 py-2 text-right text-zinc-300">{totalRows}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function DuplicateAccounts() {
  const { admin: adminT } = useI18n();
  const t = adminT.duplicateAccounts;
  const { user } = useAuth();

  const [activeTab, setActiveTab] = useState<"candidates" | "history">("candidates");
  const [candidates, setCandidates] = useState<MergeCandidate[]>([]);
  const [mergeLog, setMergeLog] = useState<MergeLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Preview / action modal state
  const [selectedCandidate, setSelectedCandidate] = useState<MergeCandidate | null>(null);
  const [preview, setPreview] = useState<MergePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [merging, setMerging] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getDuplicateAccounts(50);
      setCandidates(res.candidates ?? []);
      setMergeLog(res.mergeLog ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.errorLoading);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleOpenPreview = useCallback(async (candidate: MergeCandidate) => {
    setSelectedCandidate(candidate);
    setPreview(null);
    setPreviewError(null);
    setPreviewLoading(true);
    try {
      const res = await previewAccountMerge(candidate.sourceId, candidate.targetId);
      setPreview(res.preview);
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : "Preview failed");
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  const handleCloseModal = useCallback(() => {
    setSelectedCandidate(null);
    setPreview(null);
    setPreviewError(null);
  }, []);

  const handleMerge = useCallback(
    async (reason: string) => {
      if (!selectedCandidate) return;
      setMerging(true);
      setActionFeedback(null);
      try {
        const result = await mergeAccounts(
          selectedCandidate.sourceId,
          selectedCandidate.targetId,
          reason,
          selectedCandidate.dimension
        );
        setActionFeedback({
          type: "success",
          message: t.mergeSuccess.replace("{0}", String(result.mergeLogId)),
        });
        handleCloseModal();
        await load();
      } catch (err) {
        setActionFeedback({
          type: "error",
          message: t.mergeError.replace("{0}", err instanceof Error ? err.message : "Unknown error"),
        });
      } finally {
        setMerging(false);
      }
    },
    [selectedCandidate, handleCloseModal, load, t]
  );

  const handleRename = useCallback(async () => {
    if (!selectedCandidate) return;
    setMerging(true);
    setActionFeedback(null);
    try {
      const result = await renameAccountToTelegramId(
        selectedCandidate.sourceId,
        selectedCandidate.targetId
      );
      setActionFeedback({
        type: "success",
        message: t.renameSuccess.replace("{0}", String(result.mergeLogId)),
      });
      handleCloseModal();
      await load();
    } catch (err) {
      setActionFeedback({
        type: "error",
        message: t.mergeError.replace("{0}", err instanceof Error ? err.message : "Unknown error"),
      });
    } finally {
      setMerging(false);
    }
  }, [selectedCandidate, handleCloseModal, load, t]);

  // Superadmin-only check (AdminLayout already blocks non-admins; this is an extra guard)
  if (user && user.role !== "superadmin") {
    return (
      <div className="p-6">
        <div className="rounded-xl border border-red-800 bg-red-950/30 p-6 text-center">
          <p className="text-red-400 font-semibold">{adminT.nav.restrictedSection}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-pnp-textPrimary">{t.title}</h1>
          <p className="text-sm text-zinc-400 mt-0.5">{t.subtitle}</p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="px-3 py-1.5 rounded-lg bg-zinc-700 text-zinc-200 text-sm hover:bg-zinc-600 transition-colors disabled:opacity-40"
        >
          {t.refresh}
        </button>
      </div>

      {/* Action feedback */}
      {actionFeedback && (
        <div
          className={`rounded-lg px-4 py-3 text-sm ${
            actionFeedback.type === "success"
              ? "bg-green-950/50 border border-green-700 text-green-300"
              : "bg-red-950/50 border border-red-700 text-red-300"
          }`}
        >
          {actionFeedback.message}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-zinc-700">
        {(["candidates", "history"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === tab
                ? "border-pnp-accent text-pnp-textPrimary"
                : "border-transparent text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {tab === "candidates" ? t.tabCandidates : t.tabHistory}
            {tab === "candidates" && candidates.length > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center w-5 h-5 rounded-full bg-pnp-accent text-white text-xs">
                {candidates.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-7 h-7 border-2 border-pnp-accent border-t-transparent rounded-full animate-spin" />
          <span className="ml-3 text-zinc-400 text-sm">
            {activeTab === "candidates" ? t.loadingCandidates : t.loadingHistory}
          </span>
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-800 bg-red-950/30 p-6 text-center">
          <p className="text-red-400 text-sm">{error}</p>
          <button
            onClick={load}
            className="mt-3 px-4 py-2 rounded-lg bg-red-800 text-white text-sm hover:bg-red-700 transition-colors"
          >
            {t.refresh}
          </button>
        </div>
      ) : activeTab === "candidates" ? (
        candidates.length === 0 ? (
          <p className="text-center py-12 text-zinc-500 text-sm">{t.noCandidates}</p>
        ) : (
          <div className="space-y-4">
            {candidates.map((c) => (
              <CandidateRow
                key={`${c.sourceId}-${c.targetId}`}
                candidate={c}
                onPreview={handleOpenPreview}
                t={t}
              />
            ))}
          </div>
        )
      ) : (
        <HistoryTab mergeLog={mergeLog} t={t} />
      )}

      {/* Preview Modal */}
      {selectedCandidate && (
        <>
          {previewLoading && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
              <div className="w-8 h-8 border-2 border-pnp-accent border-t-transparent rounded-full animate-spin" />
            </div>
          )}
          {previewError && !previewLoading && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={handleCloseModal}>
              <div
                className="bg-pnp-surface border border-red-700 rounded-xl shadow-2xl w-full max-w-md p-6"
                onClick={(e) => e.stopPropagation()}
              >
                <p className="text-red-400 text-sm mb-4">{previewError}</p>
                <button
                  onClick={handleCloseModal}
                  className="px-4 py-2 rounded-lg bg-zinc-700 text-zinc-200 text-sm hover:bg-zinc-600 transition-colors"
                >
                  {adminT.shared.cancel}
                </button>
              </div>
            </div>
          )}
          {preview && !previewLoading && (
            <PreviewModal
              preview={preview}
              candidate={selectedCandidate}
              onClose={handleCloseModal}
              onMerge={handleMerge}
              onRename={handleRename}
              merging={merging}
              t={t}
            />
          )}
        </>
      )}
    </div>
  );
}
