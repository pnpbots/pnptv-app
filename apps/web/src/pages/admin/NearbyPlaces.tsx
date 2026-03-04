import React, { useState, useEffect, useCallback, useRef } from "react";
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

interface CategoryOption {
  id: number;
  name: string;
  emoji: string;
  slug: string;
}

const CATEGORIES: CategoryOption[] = [
  { id: 1,  name: "Wellness",              emoji: "🧘", slug: "wellness" },
  { id: 2,  name: "Cruising Spots",        emoji: "🌙", slug: "cruising" },
  { id: 3,  name: "+18 Businesses",        emoji: "🔞", slug: "adult_entertainment" },
  { id: 4,  name: "PNP Friendly",          emoji: "💨", slug: "pnp_friendly" },
  { id: 5,  name: "Help Centers",          emoji: "🏥", slug: "help_centers" },
  { id: 6,  name: "Saunas & Bath Houses",  emoji: "🧖", slug: "saunas" },
  { id: 7,  name: "Bars & Clubs",          emoji: "🍸", slug: "bars_clubs" },
  { id: 8,  name: "Community Businesses",  emoji: "🏪", slug: "community_business" },
  { id: 25, name: "Hotels & Lodging",      emoji: "🏨", slug: "hotels_lodging" },
];

const STATUS_BADGE: Record<string, "default" | "accent" | "success" | "warning" | "danger"> = {
  pending: "warning",
  approved: "success",
  rejected: "danger",
  suspended: "default",
};

const STATUS_TABS: { value: PlaceStatus; label: string }[] = [
  { value: "all",       label: "All" },
  { value: "pending",   label: "Pending" },
  { value: "approved",  label: "Approved" },
  { value: "rejected",  label: "Rejected" },
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
  const [places, setPlaces]             = useState<AdminPlace[]>([]);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState<string | null>(null);
  const [success, setSuccess]           = useState<string | null>(null);
  const [page, setPage]                 = useState(1);
  const [totalPages, setTotalPages]     = useState(1);
  const [statusFilter, setStatusFilter] = useState<PlaceStatus>("all");
  const [categoryFilter, setCategoryFilter] = useState<number | undefined>(undefined);
  const [searchInput, setSearchInput]   = useState("");
  const [search, setSearch]             = useState("");
  const searchTimerRef                  = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const loadPlaces = useCallback(
    async (p: number, status: PlaceStatus, catId: number | undefined, q: string) => {
      setLoading(true);
      try {
        const res = await getAdminPlaces(
          p,
          status === "all" ? undefined : status,
          catId,
          q || undefined
        );
        setPlaces(res.places);
        setTotalPages(res.pagination.totalPages);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load places");
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const loadStats = useCallback(async () => {
    try {
      const res = await getAdminPlaceStats();
      setStats(res.stats || {});
    } catch {
      // non-critical
    }
  }, []);

  useEffect(() => {
    loadPlaces(page, statusFilter, categoryFilter, search);
  }, [loadPlaces, page, statusFilter, categoryFilter, search]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  const handleStatusFilter = (status: PlaceStatus) => {
    setStatusFilter(status);
    setPage(1);
  };

  const handleCategoryFilter = (id: number | undefined) => {
    setCategoryFilter(id);
    setPage(1);
  };

  const handleSearchChange = (value: string) => {
    setSearchInput(value);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setSearch(value.trim());
      setPage(1);
    }, 400);
  };

  const openAction = (
    type: NonNullable<typeof confirmAction>["type"],
    place: AdminPlace
  ) => {
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
      await Promise.all([loadPlaces(page, statusFilter, categoryFilter, search), loadStats()]);
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
      case "approve":   return `Approve "${placeName}"? It will become visible to users.`;
      case "reject":    return `Reject "${placeName}"? You can provide a reason below.`;
      case "suspend":   return `Suspend "${placeName}"? It will be hidden from users.`;
      case "unsuspend": return `Unsuspend "${placeName}"? It will become visible again.`;
      case "delete":    return `Permanently delete "${placeName}"? This cannot be undone.`;
      default:          return "";
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
            <div className="text-[10px] text-pnp-textSecondary truncate max-w-[200px]">
              {row.address}
            </div>
          )}
        </div>
      ),
    },
    {
      key: "category",
      header: "Category",
      render: (row: AdminPlace) => (
        <span className="text-xs text-pnp-textSecondary">
          {row.categoryEmoji ? `${row.categoryEmoji} ` : ""}
          {row.categoryName || "\u2014"}
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
        <Badge variant={STATUS_BADGE[row.status] ?? "default"}>{row.status}</Badge>
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
              <button
                onClick={() => openAction("approve", row)}
                className="text-[10px] px-2 py-1 rounded bg-green-500/10 text-green-400 hover:bg-green-500/20"
              >
                Approve
              </button>
              <button
                onClick={() => openAction("reject", row)}
                className="text-[10px] px-2 py-1 rounded bg-red-500/10 text-red-400 hover:bg-red-500/20"
              >
                Reject
              </button>
            </>
          )}
          {row.status === "approved" && (
            <button
              onClick={() => openAction("suspend", row)}
              className="text-[10px] px-2 py-1 rounded bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20"
            >
              Suspend
            </button>
          )}
          {row.status === "suspended" && (
            <button
              onClick={() => openAction("unsuspend", row)}
              className="text-[10px] px-2 py-1 rounded bg-green-500/10 text-green-400 hover:bg-green-500/20"
            >
              Unsuspend
            </button>
          )}
          <button
            onClick={() => openAction("delete", row)}
            className="text-[10px] px-2 py-1 rounded bg-red-500/10 text-red-400 hover:bg-red-500/20"
          >
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
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            { label: "Total",     key: "total",     color: "text-pnp-textPrimary" },
            { label: "Pending",   key: "pending",   color: "text-yellow-400" },
            { label: "Approved",  key: "approved",  color: "text-green-400" },
            { label: "Rejected",  key: "rejected",  color: "text-red-400" },
            { label: "Suspended", key: "suspended", color: "text-pnp-textSecondary" },
          ].map((s) => (
            <div key={s.label} className="rounded-xl bg-pnp-surface border border-pnp-border p-3">
              <div className="text-xs text-pnp-textSecondary">{s.label}</div>
              <div className={`text-xl font-bold ${s.color}`}>{stats[s.key] ?? 0}</div>
            </div>
          ))}
        </div>
      )}

      {/* Alerts */}
      {error && (
        <div className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400 flex justify-between items-center">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-300 ml-2">
            Dismiss
          </button>
        </div>
      )}
      {success && (
        <div className="px-4 py-3 rounded-lg bg-green-500/10 border border-green-500/20 text-sm text-green-400 flex justify-between items-center">
          <span>{success}</span>
          <button onClick={() => setSuccess(null)} className="text-green-400 hover:text-green-300 ml-2">
            Dismiss
          </button>
        </div>
      )}

      {/* Search & Category Filter */}
      <div className="flex flex-wrap gap-3 items-center">
        <input
          type="text"
          value={searchInput}
          onChange={(e) => handleSearchChange(e.target.value)}
          placeholder="Search by name, city, address..."
          className="px-3 py-2 text-sm rounded-lg border border-pnp-border bg-pnp-surface text-pnp-textPrimary placeholder-pnp-textSecondary focus:outline-none focus:border-pnp-accent w-64"
        />
        <select
          value={categoryFilter ?? ""}
          onChange={(e) => handleCategoryFilter(e.target.value ? Number(e.target.value) : undefined)}
          className="px-3 py-2 text-sm rounded-lg border border-pnp-border bg-pnp-surface text-pnp-textPrimary focus:outline-none focus:border-pnp-accent"
        >
          <option value="">All Categories</option>
          {CATEGORIES.map((cat) => (
            <option key={cat.id} value={cat.id}>
              {cat.emoji} {cat.name}
            </option>
          ))}
        </select>
        {(categoryFilter !== undefined || search) && (
          <button
            onClick={() => {
              handleCategoryFilter(undefined);
              setSearchInput("");
              setSearch("");
            }}
            className="text-xs px-3 py-2 rounded-lg border border-pnp-border text-pnp-textSecondary hover:bg-pnp-surface"
          >
            Clear Filters
          </button>
        )}
      </div>

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
        title={
          confirmAction
            ? `${confirmAction.type.charAt(0).toUpperCase() + confirmAction.type.slice(1)} Place`
            : "Confirm"
        }
        message={getConfirmMessage()}
        confirmLabel={confirmAction?.type === "delete" ? "Delete" : "Confirm"}
        variant={getConfirmVariant()}
        onConfirm={executeAction}
        onCancel={() => setConfirmAction(null)}
        loading={actionLoading}
      />

      {/* Reject Modal with reason input */}
      {confirmAction?.type === "reject" && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={() => setConfirmAction(null)}
        >
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
