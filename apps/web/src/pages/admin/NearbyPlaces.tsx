import React, { useState, useEffect, useCallback } from "react";
import { DataTable } from "@/components/admin/DataTable";
import { Pagination } from "@/components/admin/Pagination";
import { ConfirmModal } from "@/components/admin/ConfirmModal";
import { Badge } from "@pnptv/ui-kit";
import {
  getAdminPlaces,
  getAdminPlaceStats,
  approveAdminPlace,
  rejectAdminPlace,
  suspendAdminPlace,
  deleteAdminPlace,
  type AdminPlace,
} from "@/lib/api";

type PlaceStatus = "all" | "pending" | "approved" | "rejected" | "suspended";

const STATUS_BADGE: Record<string, "default" | "accent" | "success" | "warning" | "danger"> = {
  pending: "warning",
  approved: "success",
  rejected: "danger",
  suspended: "default",
};

const STATUS_TABS: { value: PlaceStatus; label: string }[] = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "suspended", label: "Suspended" },
];

function formatDate(dateStr: string | undefined): string {
  if (!dateStr) return "\u2014";
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function NearbyPlaces() {
  const [places, setPlaces] = useState<AdminPlace[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [statusFilter, setStatusFilter] = useState<PlaceStatus>("all");

  // Stats
  const [stats, setStats] = useState<Record<string, number>>({});

  // Modals
  const [confirmAction, setConfirmAction] = useState<{
    type: "approve" | "reject" | "suspend" | "unsuspend" | "delete";
    placeId: string;
    placeName: string;
  } | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  const loadPlaces = useCallback(async (p: number, status: PlaceStatus) => {
    setLoading(true);
    try {
      const res = await getAdminPlaces(p, status === "all" ? undefined : status);
      setPlaces(res.places);
      setTotalPages(res.pagination.totalPages);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load places");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadStats = useCallback(async () => {
    try {
      const res = await getAdminPlaceStats();
      setStats(res.stats || {});
    } catch {
      // non-critical
    }
  }, []);

  useEffect(() => {
    loadPlaces(page, statusFilter);
  }, [loadPlaces, page, statusFilter]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  const handleStatusFilter = (status: PlaceStatus) => {
    setStatusFilter(status);
    setPage(1);
  };

  const openAction = (type: typeof confirmAction extends infer T | null ? NonNullable<T>["type"] : never, place: AdminPlace) => {
    setConfirmAction({ type, placeId: place.id, placeName: place.name });
    setRejectReason("");
  };

  const executeAction = async () => {
    if (!confirmAction) return;
    setActionLoading(true);
    try {
      const { type, placeId } = confirmAction;
      if (type === "approve") {
        await approveAdminPlace(placeId);
      } else if (type === "reject") {
        await rejectAdminPlace(placeId, rejectReason || undefined);
      } else if (type === "suspend") {
        await suspendAdminPlace(placeId, true);
      } else if (type === "unsuspend") {
        await suspendAdminPlace(placeId, false);
      } else if (type === "delete") {
        await deleteAdminPlace(placeId);
      }
      setSuccess(`Place ${type === "unsuspend" ? "unsuspended" : type + "d"} successfully`);
      setConfirmAction(null);
      await Promise.all([loadPlaces(page, statusFilter), loadStats()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setActionLoading(false);
    }
  };

  const getConfirmMessage = () => {
    if (!confirmAction) return "";
    const { type, placeName } = confirmAction;
    switch (type) {
      case "approve": return `Approve "${placeName}"? It will become visible to users.`;
      case "reject": return `Reject "${placeName}"? You can provide a reason below.`;
      case "suspend": return `Suspend "${placeName}"? It will be hidden from users.`;
      case "unsuspend": return `Unsuspend "${placeName}"? It will become visible again.`;
      case "delete": return `Permanently delete "${placeName}"? This cannot be undone.`;
      default: return "";
    }
  };

  const getConfirmVariant = (): "default" | "warning" | "danger" => {
    if (!confirmAction) return "default";
    if (confirmAction.type === "delete") return "danger";
    if (confirmAction.type === "reject" || confirmAction.type === "suspend") return "warning";
    return "default";
  };

  const columns = [
    {
      key: "name",
      header: "Name",
      render: (row: AdminPlace) => (
        <div>
          <span className="font-medium text-pnp-textPrimary">{row.name}</span>
          {row.address && (
            <div className="text-[10px] text-pnp-textSecondary truncate max-w-[200px]">{row.address}</div>
          )}
        </div>
      ),
    },
    {
      key: "category",
      header: "Category",
      render: (row: AdminPlace) => (
        <span className="text-xs text-pnp-textSecondary">
          {row.categoryEmoji ? `${row.categoryEmoji} ` : ""}{row.categoryName || "\u2014"}
        </span>
      ),
    },
    {
      key: "city",
      header: "City",
      render: (row: AdminPlace) => (
        <span className="text-xs text-pnp-textSecondary">{row.city || "\u2014"}</span>
      ),
    },
    {
      key: "placeType",
      header: "Type",
      render: (row: AdminPlace) => (
        <span className="text-xs text-pnp-textSecondary capitalize">
          {row.placeType?.replace("_", " ") || "\u2014"}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (row: AdminPlace) => (
        <Badge variant={STATUS_BADGE[row.status] ?? "default"}>
          {row.status}
        </Badge>
      ),
    },
    {
      key: "viewCount",
      header: "Views",
      render: (row: AdminPlace) => (
        <span className="text-xs text-pnp-textSecondary">{row.viewCount ?? 0}</span>
      ),
    },
    {
      key: "createdAt",
      header: "Created",
      render: (row: AdminPlace) => (
        <span className="text-xs text-pnp-textSecondary">{formatDate(row.createdAt)}</span>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      render: (row: AdminPlace) => (
        <div className="flex flex-wrap gap-1" onClick={(e) => e.stopPropagation()}>
          {row.status === "pending" && (
            <>
              <button onClick={() => openAction("approve", row)} className="text-[10px] px-2 py-1 rounded bg-green-500/10 text-green-400 hover:bg-green-500/20">
                Approve
              </button>
              <button onClick={() => openAction("reject", row)} className="text-[10px] px-2 py-1 rounded bg-red-500/10 text-red-400 hover:bg-red-500/20">
                Reject
              </button>
            </>
          )}
          {row.status === "approved" && (
            <button onClick={() => openAction("suspend", row)} className="text-[10px] px-2 py-1 rounded bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20">
              Suspend
            </button>
          )}
          {row.status === "suspended" && (
            <button onClick={() => openAction("unsuspend", row)} className="text-[10px] px-2 py-1 rounded bg-green-500/10 text-green-400 hover:bg-green-500/20">
              Unsuspend
            </button>
          )}
          <button onClick={() => openAction("delete", row)} className="text-[10px] px-2 py-1 rounded bg-red-500/10 text-red-400 hover:bg-red-500/20">
            Delete
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="page-container space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-pnp-textPrimary">Nearby Places</h1>
        <p className="text-sm text-pnp-textSecondary mt-1">
          Manage nearby places, businesses, and points of interest
        </p>
      </div>

      {/* Stats */}
      {Object.keys(stats).length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Total", value: stats.total, color: "text-pnp-textPrimary" },
            { label: "Pending", value: stats.pending, color: "text-yellow-400" },
            { label: "Approved", value: stats.approved, color: "text-green-400" },
            { label: "Rejected", value: stats.rejected, color: "text-red-400" },
          ].map((s) => (
            <div key={s.label} className="rounded-xl bg-pnp-surface border border-pnp-border p-3">
              <div className="text-xs text-pnp-textSecondary">{s.label}</div>
              <div className={`text-xl font-bold ${s.color}`}>{s.value ?? 0}</div>
            </div>
          ))}
        </div>
      )}

      {/* Alerts */}
      {error && (
        <div className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400 flex justify-between items-center">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-300 ml-2">Dismiss</button>
        </div>
      )}
      {success && (
        <div className="px-4 py-3 rounded-lg bg-green-500/10 border border-green-500/20 text-sm text-green-400 flex justify-between items-center">
          <span>{success}</span>
          <button onClick={() => setSuccess(null)} className="text-green-400 hover:text-green-300 ml-2">Dismiss</button>
        </div>
      )}

      {/* Status filter tabs */}
      <div className="flex flex-wrap gap-2">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => handleStatusFilter(tab.value)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
              statusFilter === tab.value
                ? "border-pnp-accent bg-pnp-accent/20 text-pnp-accent"
                : "border-pnp-border text-pnp-textSecondary hover:bg-pnp-surface"
            }`}
          >
            {tab.label}
            {tab.value !== "all" && stats[tab.value] !== undefined && (
              <span className="ml-1 opacity-70">({stats[tab.value]})</span>
            )}
          </button>
        ))}
      </div>

      {/* Table */}
      <DataTable
        columns={columns}
        data={places}
        loading={loading}
        emptyMessage="No places found"
        getRowId={(row) => row.id}
      />

      <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />

      {/* Confirm Modal */}
      <ConfirmModal
        open={!!confirmAction && confirmAction.type !== "reject"}
        title={confirmAction ? `${confirmAction.type.charAt(0).toUpperCase() + confirmAction.type.slice(1)} Place` : "Confirm"}
        message={getConfirmMessage()}
        confirmLabel={confirmAction?.type === "delete" ? "Delete" : "Confirm"}
        variant={getConfirmVariant()}
        onConfirm={executeAction}
        onCancel={() => setConfirmAction(null)}
        loading={actionLoading}
      />

      {/* Reject Modal with reason input */}
      {confirmAction?.type === "reject" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setConfirmAction(null)}>
          <div className="fixed inset-0 bg-black/60" />
          <div
            className="relative bg-pnp-background border border-pnp-border rounded-xl p-6 max-w-md w-full shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-pnp-textPrimary mb-2">Reject Place</h3>
            <p className="text-sm text-pnp-textSecondary mb-4">{getConfirmMessage()}</p>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Reason for rejection (optional)"
              rows={3}
              className="w-full px-3 py-2 rounded-lg border border-pnp-border bg-pnp-background text-pnp-textPrimary text-sm focus:outline-none focus:border-pnp-accent mb-4 resize-none"
            />
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setConfirmAction(null)}
                disabled={actionLoading}
                className="px-4 py-2 text-sm rounded-lg border border-pnp-border text-pnp-textSecondary hover:bg-pnp-surface disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={executeAction}
                disabled={actionLoading}
                className="px-4 py-2 text-sm rounded-lg font-medium bg-yellow-600 hover:bg-yellow-700 text-white disabled:opacity-50"
              >
                {actionLoading ? "Processing..." : "Reject"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
