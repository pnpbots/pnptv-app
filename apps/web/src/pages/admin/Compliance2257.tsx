import React, { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import {
  get2257Records,
  approve2257Record,
  reject2257Record,
  export2257Records,
  type Record2257,
} from "@/lib/api";

type StatusFilter = "pending" | "approved" | "rejected";

const ID_TYPE_LABELS: Record<string, string> = {
  passport: "Passport",
  drivers_license: "Driver's License",
  national_id: "National ID",
  state_id: "State ID",
  other: "Other",
};

function statusBadgeStyle(status: string): React.CSSProperties {
  if (status === "pending") return { background: "rgba(255,180,84,0.15)", color: "#FFB454" };
  if (status === "approved") return { background: "rgba(94,209,196,0.15)", color: "#5ED1C4" };
  return { background: "rgba(239,68,68,0.15)", color: "#EF4444" };
}

function extractFilename(docPath: string | null): string | null {
  if (!docPath) return null;
  return docPath.split("/").pop() || null;
}

export default function Compliance2257() {
  const { isAdmin } = useAuth();
  const navigate = useNavigate();

  const [tab, setTab] = useState<StatusFilter>("pending");
  const [records, setRecords] = useState<Record2257[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState<string | null>(null);
  const [rejectNotes, setRejectNotes] = useState<Record<string, string>>({});
  const [approveNotes, setApproveNotes] = useState<Record<string, string>>({});
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [reRejectingId, setReRejectingId] = useState<string | null>(null);
  const [reRejectNotes, setReRejectNotes] = useState<Record<string, string>>({});
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await get2257Records(tab);
      setRecords(res.records);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load records");
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin, load]);

  const handleApprove = async (userId: string) => {
    if (processing) return;
    setProcessing(userId);
    try {
      await approve2257Record(userId, approveNotes[userId]);
      setApproveNotes((prev) => { const n = { ...prev }; delete n[userId]; return n; });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to approve");
    } finally {
      setProcessing(null);
    }
  };

  const handleReject = async (userId: string) => {
    const notes = rejectNotes[userId]?.trim();
    if (!notes) {
      setError("Rejection reason is required.");
      return;
    }
    if (processing) return;
    setProcessing(userId);
    try {
      await reject2257Record(userId, notes);
      setRejectNotes((prev) => { const n = { ...prev }; delete n[userId]; return n; });
      setRejectingId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reject");
    } finally {
      setProcessing(null);
    }
  };

  const handleReReject = async (userId: string) => {
    const notes = reRejectNotes[userId]?.trim();
    if (!notes) {
      setError("Rejection reason is required.");
      return;
    }
    if (processing) return;
    setProcessing(userId);
    try {
      await reject2257Record(userId, notes);
      setReRejectNotes((prev) => { const n = { ...prev }; delete n[userId]; return n; });
      setReRejectingId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to re-reject");
    } finally {
      setProcessing(null);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      await export2257Records();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  if (!isAdmin) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <p className="text-white/60">Admin access required.</p>
      </div>
    );
  }

  const tabs: { value: StatusFilter; label: string }[] = [
    { value: "pending", label: "Pending" },
    { value: "approved", label: "Approved" },
    { value: "rejected", label: "Rejected" },
  ];

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <button
        onClick={() => navigate("/admin")}
        className="flex items-center gap-2 text-sm mb-4 hover:text-pnp-accent transition-colors"
        style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
        </svg>
        Admin Dashboard
      </button>

      <div className="flex items-start justify-between mb-1 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white">18 U.S.C. § 2257 Records</h1>
          <p className="text-sm mt-0.5" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
            Identity verification submissions for creator compliance.
          </p>
        </div>
        <button
          onClick={handleExport}
          disabled={exporting}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 flex-shrink-0"
          style={{ background: "rgba(255,255,255,0.06)", color: "#fff", border: "1px solid rgba(255,255,255,0.12)" }}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          {exporting ? "Exporting…" : "Export JSON"}
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 mb-5 mt-5 p-1 rounded-xl" style={{ background: "rgba(255,255,255,0.04)" }}>
        {tabs.map((t) => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
            className="flex-1 py-2 rounded-lg text-xs font-semibold transition-all"
            style={
              tab === t.value
                ? {
                    background: "linear-gradient(135deg, rgba(212,0,122,0.25), rgba(230,145,56,0.18))",
                    color: "#fff",
                    border: "1px solid rgba(212,0,122,0.3)",
                  }
                : { color: "var(--pnp-text-secondary, #8E8E93)" }
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <div
          className="mb-4 px-4 py-3 rounded-lg text-sm text-red-300 flex items-center justify-between"
          style={{ background: "rgba(239,68,68,0.1)" }}
        >
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-3 text-red-400 hover:text-red-300">
            Dismiss
          </button>
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-32 bg-white/5 rounded-lg animate-pulse" />
          ))}
        </div>
      ) : records.length === 0 ? (
        <div className="text-center py-16">
          <svg className="w-10 h-10 mx-auto mb-3 text-white/20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <p className="text-white/40 text-sm">No {tab} records.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {records.map((rec) => {
            const filename = extractFilename(rec.id_document_path);
            const selfieFilename = extractFilename((rec as typeof rec & { id_selfie_path?: string }).id_selfie_path);
            const docUrl = filename ? `/api/admin/creator-2257/doc/${filename}` : null;
            const selfieUrl = selfieFilename ? `/api/admin/creator-2257/doc/${selfieFilename}` : null;
            const displayName = [rec.first_name, rec.last_name].filter(Boolean).join(" ") || rec.username || rec.user_id;
            const isProcessing = processing === rec.user_id;
            const isRejectOpen = rejectingId === rec.user_id;

            return (
              <div key={rec.user_id} className="glass-card-sm p-4">
                {/* Header row */}
                <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        onClick={() => navigate(`/admin/users/${rec.user_id}`)}
                        className="text-sm font-semibold text-white hover:underline"
                      >
                        {displayName}
                      </button>
                      {rec.username && (
                        <span className="text-xs" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
                          @{rec.username}
                        </span>
                      )}
                      <span
                        className="text-xs px-2 py-0.5 rounded-full font-medium"
                        style={statusBadgeStyle(rec.verification_status)}
                      >
                        {rec.verification_status}
                      </span>
                    </div>
                    <p className="text-xs mt-1" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
                      Legal name:{" "}
                      <strong className="text-white">{rec.legal_name}</strong>
                      {" · "}
                      DOB:{" "}
                      <strong className="text-white">
                        {new Date(rec.date_of_birth).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
                      </strong>
                      {" · "}
                      ID:{" "}
                      <strong className="text-white">{ID_TYPE_LABELS[rec.id_type] || rec.id_type}</strong>
                      {" · "}
                      Submitted:{" "}
                      <strong className="text-white">{new Date(rec.submitted_at).toLocaleDateString()}</strong>
                    </p>
                  </div>

                  {/* View ID Document + Selfie */}
                  <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
                    {docUrl ? (
                      <button
                        onClick={() => setPreviewUrl(docUrl)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors hover:opacity-80"
                        style={{ background: "rgba(255,255,255,0.06)", color: "#fff", border: "1px solid rgba(255,255,255,0.12)" }}
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                        </svg>
                        ID Doc
                      </button>
                    ) : (
                      <span className="text-xs px-2 py-1.5 rounded-lg" style={{ background: "rgba(239,68,68,0.1)", color: "#f87171" }}>No ID</span>
                    )}
                    {selfieUrl ? (
                      <button
                        onClick={() => setPreviewUrl(selfieUrl)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors hover:opacity-80"
                        style={{ background: "rgba(94,209,196,0.1)", color: "#5ED1C4", border: "1px solid rgba(94,209,196,0.2)" }}
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                        </svg>
                        Selfie w/ ID
                      </button>
                    ) : (
                      <span className="text-xs px-2 py-1.5 rounded-lg font-semibold" style={{ background: "rgba(239,68,68,0.12)", color: "#f87171", border: "1px solid rgba(239,68,68,0.2)" }}>⚠️ No selfie</span>
                    )}
                  </div>
                </div>

                {/* Admin notes on resolved records */}
                {rec.admin_notes && (
                  <p className="text-xs text-white/50 italic mb-2">
                    Admin notes: {rec.admin_notes}
                  </p>
                )}
                {rec.verified_at && (
                  <p className="text-xs mb-2" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
                    {rec.verification_status === "approved" ? "Approved" : "Reviewed"} on{" "}
                    {new Date(rec.verified_at).toLocaleDateString()}
                  </p>
                )}

                {/* Ban badge — rejected records with active ban */}
                {rec.banned_from_applying_until && new Date(rec.banned_from_applying_until) > new Date() && (
                  <p className="text-xs mb-2 font-medium" style={{ color: "#EF4444" }}>
                    Banned from resubmitting until{" "}
                    {new Date(rec.banned_from_applying_until).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
                    {rec.resubmission_count != null && ` · ${rec.resubmission_count} resubmission(s)`}
                  </p>
                )}
                {rec.resubmission_count != null && rec.resubmission_count > 0 && !(rec.banned_from_applying_until && new Date(rec.banned_from_applying_until) > new Date()) && (
                  <p className="text-xs mb-2" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
                    {rec.resubmission_count} resubmission(s)
                  </p>
                )}

                {/* Re-reject — approved records only */}
                {tab === "approved" && (
                  <div className="mt-3">
                    {reRejectingId === rec.user_id ? (
                      <div className="space-y-2">
                        <textarea
                          placeholder="Rejection reason (required)"
                          value={reRejectNotes[rec.user_id] || ""}
                          onChange={(e) =>
                            setReRejectNotes((prev) => ({ ...prev, [rec.user_id]: e.target.value }))
                          }
                          rows={3}
                          style={{ fontSize: "16px" }}
                          className="w-full bg-white/5 text-white rounded-lg px-3 py-2 outline-none border border-red-500/30 focus:border-red-500/60 placeholder:text-white/20 resize-none"
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleReReject(rec.user_id)}
                            disabled={processing === rec.user_id || !reRejectNotes[rec.user_id]?.trim()}
                            className="flex-1 py-2 rounded-lg text-xs font-semibold transition-colors disabled:opacity-40"
                            style={{ background: "rgba(239,68,68,0.2)", color: "#EF4444", border: "1px solid rgba(239,68,68,0.4)" }}
                          >
                            {processing === rec.user_id ? "Processing…" : "Confirm Re-reject"}
                          </button>
                          <button
                            onClick={() => setReRejectingId(null)}
                            disabled={processing === rec.user_id}
                            className="px-4 py-2 rounded-lg text-xs font-semibold transition-colors"
                            style={{ background: "rgba(255,255,255,0.06)", color: "#8E8E93", border: "1px solid rgba(255,255,255,0.1)" }}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => setReRejectingId(rec.user_id)}
                        className="py-2 px-4 rounded-lg text-xs font-semibold transition-colors"
                        style={{ background: "rgba(239,68,68,0.08)", color: "#EF4444", border: "1px solid rgba(239,68,68,0.2)" }}
                      >
                        Re-reject &amp; revoke
                      </button>
                    )}
                  </div>
                )}

                {/* Actions — pending records only */}
                {tab === "pending" && (
                  <div className="mt-3 space-y-2">
                    {/* Optional approve notes */}
                    <input
                      type="text"
                      placeholder="Approval notes (optional)"
                      value={approveNotes[rec.user_id] || ""}
                      onChange={(e) =>
                        setApproveNotes((prev) => ({ ...prev, [rec.user_id]: e.target.value }))
                      }
                      style={{ fontSize: "16px" }}
                      className="w-full bg-white/5 text-white rounded-lg px-3 py-2 outline-none border border-white/10 focus:border-white/30 placeholder:text-white/20"
                    />

                    <div className="flex gap-2">
                      <button
                        onClick={() => handleApprove(rec.user_id)}
                        disabled={isProcessing}
                        className="flex-1 py-2 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
                        style={{
                          background: "rgba(94,209,196,0.15)",
                          color: "#5ED1C4",
                          border: "1px solid rgba(94,209,196,0.3)",
                        }}
                      >
                        {isProcessing && !isRejectOpen ? "Processing…" : "Approve"}
                      </button>
                      <button
                        onClick={() => setRejectingId(isRejectOpen ? null : rec.user_id)}
                        disabled={isProcessing}
                        className="flex-1 py-2 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
                        style={{
                          background: "rgba(239,68,68,0.1)",
                          color: "#EF4444",
                          border: "1px solid rgba(239,68,68,0.2)",
                        }}
                      >
                        {isRejectOpen ? "Cancel" : "Reject"}
                      </button>
                    </div>

                    {isRejectOpen && (
                      <div className="space-y-2 pt-1">
                        <textarea
                          placeholder="Rejection reason (required)"
                          value={rejectNotes[rec.user_id] || ""}
                          onChange={(e) =>
                            setRejectNotes((prev) => ({ ...prev, [rec.user_id]: e.target.value }))
                          }
                          rows={3}
                          style={{ fontSize: "16px" }}
                          className="w-full bg-white/5 text-white rounded-lg px-3 py-2 outline-none border border-red-500/30 focus:border-red-500/60 placeholder:text-white/20 resize-none"
                        />
                        <button
                          onClick={() => handleReject(rec.user_id)}
                          disabled={isProcessing || !rejectNotes[rec.user_id]?.trim()}
                          className="w-full py-2 rounded-lg text-xs font-semibold transition-colors disabled:opacity-40"
                          style={{
                            background: "rgba(239,68,68,0.2)",
                            color: "#EF4444",
                            border: "1px solid rgba(239,68,68,0.4)",
                          }}
                        >
                          {isProcessing ? "Processing…" : "Confirm Rejection"}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Inline ID document lightbox */}
      {previewUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.88)", backdropFilter: "blur(6px)" }}
          onClick={() => setPreviewUrl(null)}
        >
          <div
            className="relative max-w-2xl w-full max-h-[90vh] flex flex-col items-center"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between w-full mb-3">
              <p className="text-xs font-semibold text-white/60 uppercase tracking-wider">ID Document</p>
              <div className="flex items-center gap-2">
                <a
                  href={previewUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs px-3 py-1.5 rounded-lg font-semibold"
                  style={{ background: "rgba(255,255,255,0.08)", color: "#fff", border: "1px solid rgba(255,255,255,0.15)" }}
                >
                  Open full size ↗
                </a>
                <button
                  onClick={() => setPreviewUrl(null)}
                  className="w-7 h-7 rounded-full flex items-center justify-center text-white/50 hover:text-white hover:bg-white/10 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
            <img
              src={previewUrl}
              alt="ID document"
              className="rounded-xl object-contain max-h-[80vh] w-full"
              style={{ border: "1px solid rgba(255,255,255,0.1)" }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
