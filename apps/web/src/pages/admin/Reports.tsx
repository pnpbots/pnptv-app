import React, { useCallback, useEffect, useState } from "react";
import {
  listAdminReports,
  reviewAdminReport,
  listAdminAppeals,
  reviewAdminAppeal,
  type AdminReport,
  type AdminAppeal,
  type AppealStatus,
  type ReportAction,
  type ReportStatus,
  type ReportCategory,
} from "@/lib/api";

const STATUS_TABS: { key: ReportStatus | "all"; label: string; tone: string }[] = [
  { key: "pending",      label: "Pending",      tone: "#FFB454" },
  { key: "reviewed",     label: "Reviewed",     tone: "#5BC8F5" },
  { key: "action_taken", label: "Action Taken", tone: "#FF453A" },
  { key: "dismissed",    label: "Dismissed",    tone: "#8E8E93" },
  { key: "all",          label: "All",          tone: "#FFFFFF" },
];

const CATEGORY_LABELS: Record<ReportCategory, string> = {
  harassment:            "Harassment",
  hate:                  "Hate / Discrimination",
  spam_scam:             "Spam / Scam",
  impersonation:         "Impersonation",
  csam:                  "Child Safety (urgent)",
  nudity_nonconsensual:  "Non-consensual intimate",
  self_harm:             "Self-harm",
  other:                 "Other",
};

const CATEGORY_COLORS: Record<ReportCategory, string> = {
  csam:                  "#FF453A",
  nudity_nonconsensual:  "#FF453A",
  hate:                  "#E69138",
  harassment:            "#E69138",
  self_harm:             "#A78BFA",
  impersonation:         "#5BC8F5",
  spam_scam:             "#FFD60A",
  other:                 "#8E8E93",
};

function resolvePhoto(url: string | null): string | null {
  if (!url) return null;
  if (url.startsWith("/") || url.startsWith("http")) return url;
  return null;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function Avatar({ url, name }: { url: string | null; name: string | null }) {
  const photo = resolvePhoto(url);
  const initial = (name || "?")[0].toUpperCase();
  if (photo) return <img src={photo} alt="" className="w-9 h-9 rounded-full object-cover ring-1 ring-white/10" />;
  return (
    <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold" style={{ background: "linear-gradient(135deg, #D4007A, #E69138)", color: "#fff" }}>
      {initial}
    </div>
  );
}

export default function AdminReports() {
  const [view, setView] = useState<"reports" | "appeals">("reports");
  const [reportsPending, setReportsPending] = useState(0);
  const [appealsPending, setAppealsPending] = useState(0);

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <div className="mb-4 flex gap-1">
        <button
          onClick={() => setView("reports")}
          className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${view === "reports" ? "text-white" : "text-white/60"}`}
          style={view === "reports"
            ? { background: "rgba(212,0,122,0.18)", border: "1px solid rgba(212,0,122,0.4)" }
            : { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }
          }
        >
          Reports{reportsPending > 0 && <span className="ml-2 text-xs opacity-80">({reportsPending})</span>}
        </button>
        <button
          onClick={() => setView("appeals")}
          className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${view === "appeals" ? "text-white" : "text-white/60"}`}
          style={view === "appeals"
            ? { background: "rgba(255,180,84,0.18)", border: "1px solid rgba(255,180,84,0.4)" }
            : { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }
          }
        >
          Appeals{appealsPending > 0 && <span className="ml-2 text-xs opacity-80">({appealsPending})</span>}
        </button>
      </div>
      {view === "reports" ? (
        <ReportsView onPendingCount={setReportsPending} />
      ) : (
        <AppealsView onPendingCount={setAppealsPending} />
      )}
    </div>
  );
}

function ReportsView({ onPendingCount }: { onPendingCount: (n: number) => void }) {
  const [statusFilter, setStatusFilter] = useState<ReportStatus | "all">("pending");
  const [reports, setReports] = useState<AdminReport[]>([]);
  const [counts, setCounts] = useState<Partial<Record<ReportStatus, number>>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<AdminReport | null>(null);
  const [actionNotes, setActionNotes] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listAdminReports({ status: statusFilter, limit: 100 });
      setReports(res.reports);
      setCounts(res.counts);
      onPendingCount(res.pending);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load reports");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, onPendingCount]);

  useEffect(() => { load(); }, [load]);

  const handleAction = async (action: ReportAction) => {
    if (!selected || actionLoading) return;
    setActionLoading(true);
    setActionError(null);
    try {
      const res = await reviewAdminReport(selected.id, action, actionNotes.trim() || undefined);
      if (res.success) {
        setSelected(null);
        setActionNotes("");
        await load();
      } else {
        setActionError(res.error || "Action failed");
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Action failed");
    }
    setActionLoading(false);
  };

  const pendingCount = counts.pending || 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Community Reports</h1>
          <p className="text-sm text-white/50 mt-0.5">
            {pendingCount > 0 ? `${pendingCount} pending review` : "No pending reports"}
          </p>
        </div>
        <button
          onClick={load}
          className="px-3 py-2 rounded-lg text-sm font-medium text-white/70 hover:text-white transition-colors"
          style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}
        >
          Refresh
        </button>
      </div>

      {/* Status tabs */}
      <div className="flex gap-1 mb-5 overflow-x-auto scrollbar-hide">
        {STATUS_TABS.map((tab) => {
          const active = statusFilter === tab.key;
          const count = tab.key === "all"
            ? Object.values(counts).reduce((s, n) => s + (n || 0), 0)
            : counts[tab.key as ReportStatus] ?? 0;
          return (
            <button
              key={tab.key}
              onClick={() => setStatusFilter(tab.key)}
              className={`px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${active ? "text-white" : "text-white/60 hover:text-white/85"}`}
              style={active
                ? { background: `${tab.tone}22`, border: `1px solid ${tab.tone}55` }
                : { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }
              }
            >
              {tab.label}
              {count > 0 && <span className="ml-2 text-xs opacity-75">({count})</span>}
            </button>
          );
        })}
      </div>

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-6 h-6 border-2 border-pnp-accent border-t-transparent rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="glass-card-sm p-6 text-center text-sm text-red-400">{error}</div>
      ) : reports.length === 0 ? (
        <div className="glass-card-sm p-8 text-center text-sm text-white/60">No reports in this view.</div>
      ) : (
        <div className="space-y-2">
          {reports.map((r) => (
            <button
              key={r.id}
              onClick={() => { setSelected(r); setActionNotes(r.action_notes || ""); setActionError(null); }}
              className="w-full glass-card-sm p-3 sm:p-4 text-left hover:border-white/25 transition-all"
            >
              <div className="flex items-start gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <Avatar url={r.reporter_photo} name={r.reporter_first_name || r.reporter_username} />
                  <svg className="w-4 h-4 text-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                  <Avatar url={r.reported_photo} name={r.reported_first_name || r.reported_username} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-white truncate">
                      {r.reporter_first_name || r.reporter_username || r.reporter_id}
                    </span>
                    <span className="text-xs text-white/40">reported</span>
                    <span className="text-sm font-medium text-white truncate">
                      {r.reported_first_name || r.reported_username || r.reported_user_id}
                    </span>
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold"
                      style={{ background: `${CATEGORY_COLORS[r.category]}22`, color: CATEGORY_COLORS[r.category], border: `1px solid ${CATEGORY_COLORS[r.category]}40` }}
                    >
                      {CATEGORY_LABELS[r.category]}
                    </span>
                    {!r.reported_is_active && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-500/15 text-red-400 font-semibold">suspended</span>
                    )}
                  </div>
                  {r.description && (
                    <p className="text-xs text-white/60 mt-1 line-clamp-2">{r.description}</p>
                  )}
                  <p className="text-[10px] text-white/40 mt-1">{formatDate(r.created_at)}</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Detail / action panel */}
      {selected && (
        <div
          className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center"
          onClick={() => !actionLoading && setSelected(null)}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div
            className="relative w-full sm:max-w-lg mx-auto bg-pnp-surface rounded-t-2xl sm:rounded-2xl p-5 shadow-2xl border border-white/10"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-white">Report #{selected.id}</h2>
              <button
                onClick={() => setSelected(null)}
                className="p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/5 transition-colors"
                aria-label="Close"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-3 text-sm">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-white/40 font-semibold">Reporter</p>
                <div className="flex items-center gap-2 mt-1">
                  <Avatar url={selected.reporter_photo} name={selected.reporter_first_name || selected.reporter_username} />
                  <div>
                    <p className="text-white">{selected.reporter_first_name || selected.reporter_username || selected.reporter_id}</p>
                    {selected.reporter_username && <p className="text-xs text-white/50">@{selected.reporter_username}</p>}
                  </div>
                  <a href={`/profile/${selected.reporter_id}`} target="_blank" rel="noreferrer" className="ml-auto text-xs text-pnp-accent hover:underline">Open</a>
                </div>
              </div>

              <div>
                <p className="text-[10px] uppercase tracking-wider text-white/40 font-semibold">Reported user</p>
                <div className="flex items-center gap-2 mt-1">
                  <Avatar url={selected.reported_photo} name={selected.reported_first_name || selected.reported_username} />
                  <div>
                    <p className="text-white">{selected.reported_first_name || selected.reported_username || selected.reported_user_id}</p>
                    {selected.reported_username && <p className="text-xs text-white/50">@{selected.reported_username}</p>}
                    <p className="text-[10px] text-white/40">role: {selected.reported_role || "user"}{!selected.reported_is_active && " · suspended"}</p>
                  </div>
                  <a href={`/profile/${selected.reported_user_id}`} target="_blank" rel="noreferrer" className="ml-auto text-xs text-pnp-accent hover:underline">Open</a>
                </div>
              </div>

              <div>
                <p className="text-[10px] uppercase tracking-wider text-white/40 font-semibold">Category</p>
                <span
                  className="inline-block mt-1 text-xs px-2 py-1 rounded-full font-semibold"
                  style={{ background: `${CATEGORY_COLORS[selected.category]}22`, color: CATEGORY_COLORS[selected.category], border: `1px solid ${CATEGORY_COLORS[selected.category]}40` }}
                >
                  {CATEGORY_LABELS[selected.category]}
                </span>
              </div>

              {selected.description && (
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-white/40 font-semibold">Description</p>
                  <p className="text-sm text-white/80 mt-1 whitespace-pre-wrap">{selected.description}</p>
                </div>
              )}

              {selected.evidence_type && (
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-white/40 font-semibold">Evidence</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-white/50 capitalize">{selected.evidence_type}{selected.evidence_id ? ` #${selected.evidence_id}` : ""}</span>
                    {(selected.evidence_type === "post" || selected.evidence_type === "profile") && (
                      <a
                        href={`/profile/${selected.reported_user_id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-lg transition-colors"
                        style={{ background: "rgba(212,0,122,0.12)", color: "#D4007A", border: "1px solid rgba(212,0,122,0.25)" }}
                      >
                        View {selected.evidence_type === "post" ? "Post" : "Profile"}
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                      </svg>
                      </a>
                    )}
                  </div>
                </div>
              )}

              <div>
                <p className="text-[10px] uppercase tracking-wider text-white/40 font-semibold">Filed at</p>
                <p className="text-xs text-white/60 mt-0.5">{formatDate(selected.created_at)}</p>
              </div>

              {selected.status !== "pending" && (
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-white/40 font-semibold">Previous notes</p>
                  <p className="text-xs text-white/60 mt-0.5">{selected.action_notes || "—"}</p>
                </div>
              )}

              <div>
                <label className="text-[10px] uppercase tracking-wider text-white/40 font-semibold block mb-1">Action notes</label>
                <textarea
                  value={actionNotes}
                  onChange={(e) => setActionNotes(e.target.value)}
                  rows={3}
                  placeholder="Optional notes about the action taken"
                  className="w-full rounded-lg p-2.5 text-sm bg-pnp-dark text-white placeholder:text-white/30 border border-white/10 focus:border-pnp-accent/50 focus:outline-none resize-none"
                />
              </div>

              {actionError && <p className="text-xs text-red-400 text-center">{actionError}</p>}

              <div className="grid grid-cols-2 gap-2 pt-1">
                <button
                  onClick={() => handleAction("dismiss")}
                  disabled={actionLoading}
                  className="py-2.5 rounded-lg text-sm font-semibold text-white/80 disabled:opacity-50 transition-colors"
                  style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)" }}
                >
                  Dismiss
                </button>
                <button
                  onClick={() => handleAction("warn")}
                  disabled={actionLoading}
                  className="py-2.5 rounded-lg text-sm font-semibold text-[#5BC8F5] disabled:opacity-50 transition-colors"
                  style={{ background: "rgba(91,200,245,0.1)", border: "1px solid rgba(91,200,245,0.3)" }}
                >
                  Warn
                </button>
                <button
                  onClick={() => handleAction("suspend_7d")}
                  disabled={actionLoading}
                  className="py-2.5 rounded-lg text-sm font-semibold text-[#E69138] disabled:opacity-50 transition-colors"
                  style={{ background: "rgba(230,145,56,0.1)", border: "1px solid rgba(230,145,56,0.3)" }}
                >
                  Suspend 7d
                </button>
                <button
                  onClick={() => handleAction("ban")}
                  disabled={actionLoading}
                  className="py-2.5 rounded-lg text-sm font-semibold text-white disabled:opacity-50 transition-colors"
                  style={{ background: "rgba(255,59,48,0.18)", border: "1px solid rgba(255,59,48,0.4)", color: "#FF453A" }}
                >
                  Ban
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Appeals view
// ─────────────────────────────────────────────────────────────────────────────

const APPEAL_TABS: { key: AppealStatus | "all"; label: string; tone: string }[] = [
  { key: "pending",  label: "Pending",  tone: "#FFB454" },
  { key: "approved", label: "Approved", tone: "#34C759" },
  { key: "denied",   label: "Denied",   tone: "#FF453A" },
  { key: "all",      label: "All",      tone: "#FFFFFF" },
];

function AppealsView({ onPendingCount }: { onPendingCount: (n: number) => void }) {
  const [statusFilter, setStatusFilter] = useState<AppealStatus | "all">("pending");
  const [appeals, setAppeals] = useState<AdminAppeal[]>([]);
  const [counts, setCounts] = useState<Partial<Record<AppealStatus, number>>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<AdminAppeal | null>(null);
  const [notes, setNotes] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listAdminAppeals({ status: statusFilter, limit: 100 });
      setAppeals(res.appeals);
      setCounts(res.counts);
      onPendingCount(res.pending);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load appeals");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, onPendingCount]);

  useEffect(() => { load(); }, [load]);

  const handleAction = async (action: "approve" | "deny") => {
    if (!selected || actionLoading) return;
    setActionLoading(true);
    setActionError(null);
    try {
      const res = await reviewAdminAppeal(selected.id, action, notes.trim() || undefined);
      if (res.success) {
        setSelected(null);
        setNotes("");
        await load();
      } else {
        setActionError(res.error || "Action failed");
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Action failed");
    }
    setActionLoading(false);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Appeals</h1>
          <p className="text-sm text-white/50 mt-0.5">
            Suspended or banned users requesting reinstatement
          </p>
        </div>
        <button
          onClick={load}
          className="px-3 py-2 rounded-lg text-sm font-medium text-white/70 hover:text-white transition-colors"
          style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}
        >
          Refresh
        </button>
      </div>

      <div className="flex gap-1 mb-5 overflow-x-auto scrollbar-hide">
        {APPEAL_TABS.map((tab) => {
          const active = statusFilter === tab.key;
          const count = tab.key === "all"
            ? Object.values(counts).reduce((s, n) => s + (n || 0), 0)
            : counts[tab.key as AppealStatus] ?? 0;
          return (
            <button
              key={tab.key}
              onClick={() => setStatusFilter(tab.key)}
              className={`px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${active ? "text-white" : "text-white/60 hover:text-white/85"}`}
              style={active
                ? { background: `${tab.tone}22`, border: `1px solid ${tab.tone}55` }
                : { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }
              }
            >
              {tab.label}
              {count > 0 && <span className="ml-2 text-xs opacity-75">({count})</span>}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-6 h-6 border-2 border-pnp-accent border-t-transparent rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="glass-card-sm p-6 text-center text-sm text-red-400">{error}</div>
      ) : appeals.length === 0 ? (
        <div className="glass-card-sm p-8 text-center text-sm text-white/60">No appeals in this view.</div>
      ) : (
        <div className="space-y-2">
          {appeals.map((a) => (
            <button
              key={a.id}
              onClick={() => { setSelected(a); setNotes(a.admin_notes || ""); setActionError(null); }}
              className="w-full glass-card-sm p-3 sm:p-4 text-left hover:border-white/25 transition-all"
            >
              <div className="flex items-start gap-3 flex-wrap">
                <Avatar url={a.resolved_photo} name={a.resolved_first_name || a.resolved_username || a.submitted_identifier} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-white truncate">
                      {a.resolved_first_name || a.resolved_username || a.submitted_identifier}
                    </span>
                    {a.resolved_user_id ? (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/15 text-green-400 font-semibold">matched</span>
                    ) : (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/10 text-white/60 font-semibold">unmatched</span>
                    )}
                    {a.resolved_role === "banned" && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-500/15 text-red-400 font-semibold">banned</span>
                    )}
                    {a.resolved_is_active === false && a.resolved_role !== "banned" && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-orange-500/15 text-orange-400 font-semibold">suspended</span>
                    )}
                    <span className="text-[10px] text-white/40 ml-auto">{a.contact_email}</span>
                  </div>
                  <p className="text-xs text-white/60 mt-1 line-clamp-2">{a.explanation}</p>
                  <p className="text-[10px] text-white/40 mt-1">{formatDate(a.created_at)}</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <div
          className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center"
          onClick={() => !actionLoading && setSelected(null)}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div
            className="relative w-full sm:max-w-lg mx-auto bg-pnp-surface rounded-t-2xl sm:rounded-2xl p-5 shadow-2xl border border-white/10"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-white">Appeal #{selected.id}</h2>
              <button
                onClick={() => setSelected(null)}
                className="p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/5 transition-colors"
                aria-label="Close"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-3 text-sm">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-white/40 font-semibold">Submitted identifier</p>
                <p className="text-white mt-0.5">{selected.submitted_identifier}</p>
              </div>

              {selected.resolved_user_id ? (
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-white/40 font-semibold">Matched account</p>
                  <div className="flex items-center gap-2 mt-1">
                    <Avatar url={selected.resolved_photo} name={selected.resolved_first_name || selected.resolved_username} />
                    <div>
                      <p className="text-white">{selected.resolved_first_name || selected.resolved_username || selected.resolved_user_id}</p>
                      {selected.resolved_username && <p className="text-xs text-white/50">@{selected.resolved_username}</p>}
                      <p className="text-[10px] text-white/40">role: {selected.resolved_role || "user"}{selected.resolved_is_active === false && " · inactive"}</p>
                    </div>
                    <a href={`/profile/${selected.resolved_user_id}`} target="_blank" rel="noreferrer" className="ml-auto text-xs text-pnp-accent hover:underline">Open</a>
                  </div>
                </div>
              ) : (
                <div className="rounded-lg p-3" style={{ background: "rgba(255,180,84,0.08)", border: "1px solid rgba(255,180,84,0.25)" }}>
                  <p className="text-xs text-[#FFB454]">No matching account found. The identifier may be misspelled — reply by email to confirm.</p>
                </div>
              )}

              <div>
                <p className="text-[10px] uppercase tracking-wider text-white/40 font-semibold">Contact email</p>
                <p className="text-white mt-0.5 break-all">{selected.contact_email}</p>
              </div>

              <div>
                <p className="text-[10px] uppercase tracking-wider text-white/40 font-semibold">Explanation</p>
                <p className="text-sm text-white/80 mt-1 whitespace-pre-wrap">{selected.explanation}</p>
              </div>

              <div className="flex items-center gap-4 text-[10px] text-white/40">
                <span>Filed: {formatDate(selected.created_at)}</span>
                {selected.ip && <span>IP: {selected.ip}</span>}
              </div>

              {selected.status !== "pending" && (
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-white/40 font-semibold">Previous decision</p>
                  <p className="text-xs text-white/60 mt-0.5">
                    {selected.status} · {selected.admin_notes || "no notes"}
                  </p>
                </div>
              )}

              <div>
                <label className="text-[10px] uppercase tracking-wider text-white/40 font-semibold block mb-1">Admin notes</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  placeholder="Optional notes about the decision"
                  className="w-full rounded-lg p-2.5 text-sm bg-pnp-dark text-white placeholder:text-white/30 border border-white/10 focus:border-pnp-accent/50 focus:outline-none resize-none"
                />
              </div>

              {actionError && <p className="text-xs text-red-400 text-center">{actionError}</p>}

              <div className="grid grid-cols-2 gap-2 pt-1">
                <button
                  onClick={() => handleAction("deny")}
                  disabled={actionLoading || selected.status !== "pending"}
                  className="py-2.5 rounded-lg text-sm font-semibold text-[#FF453A] disabled:opacity-40 transition-colors"
                  style={{ background: "rgba(255,59,48,0.12)", border: "1px solid rgba(255,59,48,0.3)" }}
                >
                  Deny
                </button>
                <button
                  onClick={() => handleAction("approve")}
                  disabled={actionLoading || selected.status !== "pending"}
                  className="py-2.5 rounded-lg text-sm font-semibold text-white disabled:opacity-40 transition-all"
                  style={{ background: "linear-gradient(135deg, #34C759, #28A745)" }}
                >
                  Approve &amp; Reinstate
                </button>
              </div>
              {selected.status !== "pending" && (
                <p className="text-[10px] text-white/40 text-center">This appeal has already been decided.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
