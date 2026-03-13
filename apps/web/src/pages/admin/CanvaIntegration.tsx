import React, { useState, useEffect, useCallback, useRef } from "react";
import { DataTable } from "@/components/admin/DataTable";
import { Pagination } from "@/components/admin/Pagination";
import { StatCard } from "@/components/admin/StatCard";
import { ConfirmModal } from "@/components/admin/ConfirmModal";
import { Badge, Skeleton } from "@pnptv/ui-kit";
import {
  getAdminCanvaStats,
  getAdminCanvaUsers,
  adminUnlinkCanvaUser,
  getAdminCanvaJobs,
  adminRetryCanvaJob,
  adminCancelCanvaJob,
  getCanvaLoginUrl,
  getCanvaStatus,
  unlinkCanva,
  listCanvaDesigns,
  startCanvaExport,
  type AdminCanvaStats,
  type AdminCanvaUser,
  type AdminCanvaJob,
  type CanvaDesign,
} from "@/lib/api";

type JobStatus = "all" | "pending" | "exporting" | "downloading" | "uploading" | "completed" | "failed";

const STATUS_TABS: { value: JobStatus; label: string }[] = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "exporting", label: "Exporting" },
  { value: "completed", label: "Completed" },
  { value: "failed", label: "Failed" },
];

const STATUS_BADGE: Record<string, "default" | "accent" | "success" | "warning" | "error"> = {
  pending: "warning",
  exporting: "accent",
  downloading: "accent",
  uploading: "accent",
  completed: "success",
  failed: "error",
};

function formatDate(dateStr: string | undefined): string {
  if (!dateStr) return "\u2014";
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function CanvaIntegration() {
  // Stats
  const [stats, setStats] = useState<AdminCanvaStats | null>(null);

  // Admin Canva connection
  const [canvaConnected, setCanvaConnected] = useState(false);
  const [canvaDisplayName, setCanvaDisplayName] = useState<string>();
  const [designs, setDesigns] = useState<CanvaDesign[]>([]);
  const [showDesigns, setShowDesigns] = useState(false);
  const [loadingDesigns, setLoadingDesigns] = useState(false);
  const [exportingId, setExportingId] = useState<string | null>(null);

  // Connected users
  const [users, setUsers] = useState<AdminCanvaUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);

  // Export jobs
  const [jobs, setJobs] = useState<AdminCanvaJob[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [jobPage, setJobPage] = useState(1);
  const [jobTotalPages, setJobTotalPages] = useState(1);
  const [jobStatusFilter, setJobStatusFilter] = useState<JobStatus>("all");

  // UI feedback
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<{
    type: "unlink" | "retry" | "cancel";
    id: string;
    label: string;
  } | null>(null);

  // Auto-poll
  const pollRef = useRef<ReturnType<typeof setInterval>>();

  const loadStats = useCallback(async () => {
    try {
      const res = await getAdminCanvaStats();
      setStats(res.stats);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load Canva stats");
    }
  }, []);

  const loadUsers = useCallback(async () => {
    setLoadingUsers(true);
    try {
      const res = await getAdminCanvaUsers();
      setUsers(res.users);
    } catch {
      setUsers([]);
    } finally {
      setLoadingUsers(false);
    }
  }, []);

  const loadJobs = useCallback(async (page = 1, status?: JobStatus) => {
    setLoadingJobs(true);
    try {
      const statusParam = status && status !== "all" ? status : undefined;
      const res = await getAdminCanvaJobs(page, statusParam);
      setJobs(res.jobs);
      setJobTotalPages(res.pagination.totalPages);
    } catch {
      setJobs([]);
    } finally {
      setLoadingJobs(false);
    }
  }, []);

  // Initial load + read URL params from OAuth callback
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const canvaError = params.get("canva_error");
    const canvaConnectedParam = params.get("canva_connected");
    if (canvaError) {
      setError(`Canva OAuth failed: ${canvaError}`);
      window.history.replaceState({}, "", window.location.pathname);
    }
    if (canvaConnectedParam) {
      setSuccess("Canva account connected successfully!");
      window.history.replaceState({}, "", window.location.pathname);
    }

    loadStats();
    loadUsers();
    loadJobs(1);
    getCanvaStatus()
      .then((s) => {
        setCanvaConnected(s.connected);
        setCanvaDisplayName(s.displayName);
      })
      .catch(() => {});
  }, [loadStats, loadUsers, loadJobs]);

  // Auto-poll every 10s while active jobs exist
  useEffect(() => {
    const hasActive = stats?.activeJobs && stats.activeJobs > 0;
    if (hasActive) {
      pollRef.current = setInterval(() => {
        loadStats();
        loadJobs(jobPage, jobStatusFilter);
      }, 10000);
    } else if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = undefined;
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [stats?.activeJobs, loadStats, loadJobs, jobPage, jobStatusFilter]);

  // Reload jobs when filter/page changes
  useEffect(() => {
    loadJobs(jobPage, jobStatusFilter);
  }, [jobPage, jobStatusFilter, loadJobs]);

  // Clear feedback
  useEffect(() => {
    if (success || error) {
      const t = setTimeout(() => {
        setSuccess(null);
        setError(null);
      }, 4000);
      return () => clearTimeout(t);
    }
  }, [success, error]);

  // Handlers
  const handleConfirm = async () => {
    if (!confirmAction) return;
    try {
      if (confirmAction.type === "unlink") {
        await adminUnlinkCanvaUser(confirmAction.id);
        setSuccess("User Canva account unlinked");
        loadUsers();
        loadStats();
      } else if (confirmAction.type === "retry") {
        await adminRetryCanvaJob(confirmAction.id);
        setSuccess("Job queued for retry");
        loadJobs(jobPage, jobStatusFilter);
        loadStats();
      } else if (confirmAction.type === "cancel") {
        await adminCancelCanvaJob(confirmAction.id);
        setSuccess("Job cancelled");
        loadJobs(jobPage, jobStatusFilter);
        loadStats();
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setConfirmAction(null);
    }
  };

  const handleLoadDesigns = async () => {
    setShowDesigns(true);
    setLoadingDesigns(true);
    try {
      const res = await listCanvaDesigns();
      setDesigns(res.designs);
    } catch {
      setDesigns([]);
    } finally {
      setLoadingDesigns(false);
    }
  };

  const handleExport = async (design: CanvaDesign) => {
    setExportingId(design.id);
    try {
      await startCanvaExport(design.id, design.title || "Untitled");
      setSuccess("Export job created");
      setShowDesigns(false);
      loadJobs(1, jobStatusFilter);
      loadStats();
    } catch {
      setError("Failed to start export");
    } finally {
      setExportingId(null);
    }
  };

  const handleDisconnect = async () => {
    try {
      await unlinkCanva();
      setCanvaConnected(false);
      setCanvaDisplayName(undefined);
      setDesigns([]);
      setSuccess("Canva account disconnected");
      loadUsers();
      loadStats();
    } catch {
      setError("Failed to disconnect");
    }
  };

  // Table columns
  const userColumns = [
    { key: "username", header: "Username" },
    {
      key: "canva_display_name",
      header: "Canva Name",
      render: (row: AdminCanvaUser) => row.canva_display_name || "\u2014",
    },
    {
      key: "canva_connected_at",
      header: "Connected",
      render: (row: AdminCanvaUser) => formatDate(row.canva_connected_at),
    },
    {
      key: "export_count",
      header: "Exports",
      render: (row: AdminCanvaUser) => String(row.export_count || 0),
    },
    {
      key: "actions",
      header: "",
      render: (row: AdminCanvaUser) => (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setConfirmAction({ type: "unlink", id: row.id, label: `Unlink ${row.username}?` });
          }}
          className="text-xs text-red-400 hover:text-red-300 transition-colors"
        >
          Unlink
        </button>
      ),
    },
  ];

  const jobColumns = [
    {
      key: "design_title",
      header: "Design",
      render: (row: AdminCanvaJob) => (
        <div className="max-w-[200px]">
          <p className="truncate text-sm">{row.design_title || "Untitled"}</p>
          <p className="text-xs text-pnp-textSecondary truncate">{row.username || row.user_id}</p>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (row: AdminCanvaJob) => (
        <Badge variant={STATUS_BADGE[row.status] || "default"}>{row.status}</Badge>
      ),
    },
    {
      key: "export_quality",
      header: "Quality",
    },
    {
      key: "retry_count",
      header: "Retries",
      render: (row: AdminCanvaJob) => String(row.retry_count || 0),
    },
    {
      key: "created_at",
      header: "Created",
      render: (row: AdminCanvaJob) => formatDate(row.created_at),
    },
    {
      key: "error_message",
      header: "Error",
      render: (row: AdminCanvaJob) =>
        row.status === "failed" && row.error_message ? (
          <span className="text-xs text-red-400 truncate block max-w-[200px]" title={row.error_message}>
            {row.error_message}
          </span>
        ) : (
          "\u2014"
        ),
    },
    {
      key: "actions",
      header: "",
      render: (row: AdminCanvaJob) => (
        <div className="flex gap-2">
          {row.status === "failed" && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setConfirmAction({ type: "retry", id: row.id, label: `Retry "${row.design_title}"?` });
              }}
              className="text-xs text-pnp-accent hover:text-pnp-accent/80 transition-colors"
            >
              Retry
            </button>
          )}
          {!["completed", "failed"].includes(row.status) && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setConfirmAction({ type: "cancel", id: row.id, label: `Cancel "${row.design_title}"?` });
              }}
              className="text-xs text-red-400 hover:text-red-300 transition-colors"
            >
              Cancel
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <h1 className="text-xl font-bold text-pnp-textPrimary mb-1">Canva Integration</h1>
      <p className="text-sm text-pnp-textSecondary mb-6">
        Manage Canva connections, browse designs, and monitor export jobs.
      </p>

      {/* Feedback */}
      {success && (
        <div className="mb-4 p-3 rounded-lg bg-green-500/10 border border-green-500/30 text-green-400 text-sm">
          {success}
        </div>
      )}
      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <StatCard label="Connected Users" value={stats?.connectedUsers ?? "\u2014"} />
        <StatCard label="Total Exports" value={stats?.totalExports ?? "\u2014"} />
        <StatCard
          label="Success Rate"
          value={stats ? `${stats.successRate}%` : "\u2014"}
          variant={stats && stats.successRate >= 80 ? "success" : stats && stats.successRate >= 50 ? "warning" : "default"}
        />
        <StatCard
          label="Active Jobs"
          value={stats?.activeJobs ?? "\u2014"}
          variant={stats && stats.activeJobs > 0 ? "warning" : "default"}
        />
      </div>

      {/* Admin Connection Card */}
      <div className="mb-6 p-4 rounded-xl bg-pnp-surface border border-pnp-border">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-pnp-textPrimary">Admin Canva Connection</h2>
          {canvaConnected && canvaDisplayName && (
            <span className="text-xs text-pnp-textSecondary">
              Connected as: {canvaDisplayName}
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {!canvaConnected ? (
            <a
              href={getCanvaLoginUrl()}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-[#7B2FBE] text-white hover:bg-[#6B21A8] transition-colors"
            >
              Connect Canva
            </a>
          ) : (
            <>
              <a
                href="https://www.canva.com/video-editor/"
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-[#7B2FBE] text-white hover:bg-[#6B21A8] transition-colors"
              >
                Create in Canva
              </a>
              <button
                onClick={handleLoadDesigns}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-pnp-accent text-white hover:bg-pnp-accent/80 transition-colors"
              >
                Import from Canva
              </button>
              <button
                onClick={handleDisconnect}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-pnp-textSecondary hover:text-red-400 transition-colors"
              >
                Disconnect
              </button>
            </>
          )}
        </div>

        {/* Designs drawer */}
        {showDesigns && canvaConnected && (
          <div className="mt-3 border-t border-pnp-border pt-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-pnp-textPrimary">Your Canva Designs</p>
              <button
                onClick={() => setShowDesigns(false)}
                className="text-xs text-pnp-textSecondary hover:text-pnp-textPrimary"
              >
                Close
              </button>
            </div>
            {loadingDesigns ? (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="aspect-video rounded-lg" />
                ))}
              </div>
            ) : designs.length === 0 ? (
              <p className="text-xs text-pnp-textSecondary py-4 text-center">
                No designs found. Create a video in Canva first!
              </p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 max-h-64 overflow-y-auto">
                {designs.map((d) => (
                  <div key={d.id} className="rounded-lg bg-pnp-background border border-pnp-border overflow-hidden">
                    {d.thumbnail?.url ? (
                      <img src={d.thumbnail.url} alt={d.title} className="w-full aspect-video object-cover" />
                    ) : (
                      <div className="w-full aspect-video bg-pnp-border flex items-center justify-center">
                        <svg className="w-6 h-6 text-pnp-textSecondary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                      </div>
                    )}
                    <div className="p-1.5">
                      <p className="text-[10px] font-medium text-pnp-textPrimary truncate">{d.title || "Untitled"}</p>
                      <button
                        onClick={() => handleExport(d)}
                        disabled={exportingId === d.id}
                        className="mt-1 w-full px-2 py-1 rounded text-[10px] font-medium bg-pnp-accent text-white hover:bg-pnp-accent/80 disabled:opacity-50 transition-colors"
                      >
                        {exportingId === d.id ? "Starting..." : "Export as PRIME Video"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Connected Users Table */}
      <div className="mb-6">
        <h2 className="text-sm font-semibold text-pnp-textPrimary mb-3">Connected Users</h2>
        <DataTable
          columns={userColumns}
          data={users}
          loading={loadingUsers}
          emptyMessage="No users have connected Canva"
          getRowId={(row) => row.id}
        />
      </div>

      {/* Export Jobs Table */}
      <div>
        <h2 className="text-sm font-semibold text-pnp-textPrimary mb-3">Export Jobs</h2>

        {/* Status filter tabs */}
        <div className="flex gap-2 overflow-x-auto pb-2 mb-3 scrollbar-none">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => {
                setJobStatusFilter(tab.value);
                setJobPage(1);
              }}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                jobStatusFilter === tab.value
                  ? "bg-pnp-accent text-white"
                  : "bg-pnp-surface border border-pnp-border text-pnp-textSecondary hover:border-pnp-accent/50"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <DataTable
          columns={jobColumns}
          data={jobs}
          loading={loadingJobs}
          emptyMessage="No export jobs found"
          getRowId={(row) => row.id}
        />

        {jobTotalPages > 1 && (
          <div className="mt-3">
            <Pagination page={jobPage} totalPages={jobTotalPages} onPageChange={setJobPage} />
          </div>
        )}
      </div>

      {/* Confirm Modal */}
      {confirmAction && (
        <ConfirmModal
          open={true}
          title={confirmAction.type === "unlink" ? "Unlink Canva Account" : confirmAction.type === "retry" ? "Retry Export" : "Cancel Export"}
          message={confirmAction.label}
          confirmLabel={confirmAction.type === "unlink" ? "Unlink" : confirmAction.type === "retry" ? "Retry" : "Cancel Job"}
          variant={confirmAction.type === "retry" ? "default" : "danger"}
          onConfirm={handleConfirm}
          onCancel={() => setConfirmAction(null)}
        />
      )}
    </div>
  );
}
