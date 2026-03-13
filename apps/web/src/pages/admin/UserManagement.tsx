import React, { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { DataTable } from "@/components/admin/DataTable";
import { Pagination } from "@/components/admin/Pagination";
import { SearchBar } from "@/components/admin/SearchBar";
import { ConfirmModal } from "@/components/admin/ConfirmModal";
import { TIER_BADGE_VARIANTS, STATUS_BADGE_VARIANTS, formatDateShort } from "@/components/admin/shared";
import { Badge } from "@pnptv/ui-kit";
import {
  getAdminUsers,
  getAdminPlans,
  bulkUpdateMemberships,
  type AdminUser,
  type AdminPlan,
  type AdminUserFilters,
} from "@/lib/api";

type BulkAction = "upgrade" | "downgrade" | "ban" | "unban";

interface UpgradeForm {
  planId: string;
  expiry: string;
}

export default function UserManagement() {
  const navigate = useNavigate();

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [plans, setPlans] = useState<AdminPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Filters
  const [filters, setFilters] = useState<AdminUserFilters>({});

  // Bulk action confirm modal state
  const [pendingAction, setPendingAction] = useState<BulkAction | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkResult, setBulkResult] = useState<string | null>(null);

  // Upgrade form
  const [upgradeForm, setUpgradeForm] = useState<UpgradeForm>({ planId: "", expiry: "" });
  const [showUpgradeForm, setShowUpgradeForm] = useState(false);

  const load = useCallback(async (p: number, q: string, f: AdminUserFilters) => {
    setLoading(true);
    try {
      const res = await getAdminUsers(p, q, f);
      setUsers(res.users);
      setTotalPages(res.pagination.totalPages);
      setTotal(res.pagination.total);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(page, search, filters);
  }, [load, page, search, filters]);

  useEffect(() => {
    getAdminPlans()
      .then((res) => setPlans(res.plans))
      .catch(() => {});
  }, []);

  const handleSearch = (value: string) => {
    setSearch(value);
    setPage(1);
    setSelectedIds(new Set());
  };

  const handleFilterChange = (key: keyof AdminUserFilters, value: string) => {
    setFilters((prev) => {
      const next = { ...prev };
      if (value) {
        next[key] = value;
      } else {
        delete next[key];
      }
      return next;
    });
    setPage(1);
    setSelectedIds(new Set());
  };

  const clearFilters = () => {
    setFilters({});
    setPage(1);
    setSelectedIds(new Set());
  };

  const hasActiveFilters = Object.values(filters).some(Boolean);

  const handleSelectToggle = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    if (users.every((u) => selectedIds.has(u.id))) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(users.map((u) => u.id)));
    }
  };

  const openBulkAction = (action: BulkAction) => {
    setPendingAction(action);
    if (action === "upgrade") {
      setShowUpgradeForm(true);
      setUpgradeForm({ planId: plans[0]?.id ?? "", expiry: "" });
    } else {
      setShowUpgradeForm(false);
      setConfirmOpen(true);
    }
  };

  const handleUpgradeSubmit = () => {
    setShowUpgradeForm(false);
    setConfirmOpen(true);
  };

  const executeBulkAction = async () => {
    if (!pendingAction) return;
    setBulkLoading(true);
    try {
      const ids = Array.from(selectedIds);
      const res = await bulkUpdateMemberships(
        ids,
        pendingAction,
        pendingAction === "upgrade" ? upgradeForm.planId : undefined,
        pendingAction === "upgrade" ? upgradeForm.expiry || undefined : undefined
      );
      setBulkResult(`Updated ${res.updated} user(s). ${res.failed > 0 ? `${res.failed} failed.` : ""}`);
      setSelectedIds(new Set());
      await load(page, search, filters);
    } catch (err) {
      setBulkResult(err instanceof Error ? err.message : "Bulk action failed");
    } finally {
      setBulkLoading(false);
      setConfirmOpen(false);
      setPendingAction(null);
    }
  };

  const BULK_ACTION_LABELS: Record<BulkAction, string> = {
    upgrade: "Upgrade to PRIME",
    downgrade: "Downgrade to Free",
    ban: "Ban Selected",
    unban: "Unban Selected",
  };

  const BULK_ACTION_VARIANTS: Record<BulkAction, "default" | "warning" | "danger"> = {
    upgrade: "default",
    downgrade: "warning",
    ban: "danger",
    unban: "default",
  };

  const columns = [
    {
      key: "username",
      header: "Username",
      render: (row: AdminUser) => (
        <span className="font-medium text-pnp-textPrimary">
          {row.username || "—"}
        </span>
      ),
    },
    {
      key: "email",
      header: "Email",
      render: (row: AdminUser) => (
        <span className="text-pnp-textSecondary">{row.email || "—"}</span>
      ),
    },
    {
      key: "tier",
      header: "Tier",
      render: (row: AdminUser) => {
        const tier = row.tier ?? "free";
        return (
          <Badge variant={TIER_BADGE_VARIANTS[tier] ?? "default"}>
            {tier}
          </Badge>
        );
      },
    },
    {
      key: "subscription_status",
      header: "Status",
      render: (row: AdminUser) => {
        const status = row.subscription_status ?? "free";
        return (
          <Badge variant={STATUS_BADGE_VARIANTS[status] ?? "default"}>
            {status}
          </Badge>
        );
      },
    },
    {
      key: "subscription_plan",
      header: "Plan",
      render: (row: AdminUser) => (
        <span className="text-pnp-textSecondary text-xs">{row.subscription_plan || "—"}</span>
      ),
    },
    {
      key: "plan_expiry",
      header: "Expiry",
      render: (row: AdminUser) => (
        <span className="text-pnp-textSecondary text-xs">{formatDateShort(row.plan_expiry)}</span>
      ),
    },
    {
      key: "created_at",
      header: "Joined",
      render: (row: AdminUser) => (
        <span className="text-pnp-textSecondary text-xs">{formatDateShort(row.created_at)}</span>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      render: (row: AdminUser) => (
        <button
          onClick={(e) => {
            e.stopPropagation();
            navigate(`/admin/users/${row.id}`);
          }}
          className="text-xs text-pnp-accent hover:underline"
        >
          View
        </button>
      ),
    },
  ];

  return (
    <div className="page-container space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-pnp-textPrimary">User Management</h1>
        <p className="text-sm text-pnp-textSecondary mt-1">
          Search, view, and manage all platform users
        </p>
      </div>

      {error && (
        <div className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">
          {error}
        </div>
      )}

      {bulkResult && (
        <div className="px-4 py-3 rounded-lg bg-green-500/10 border border-green-500/20 text-sm text-green-400 flex items-center justify-between">
          <span>{bulkResult}</span>
          <button onClick={() => setBulkResult(null)} className="ml-2 text-green-400 hover:text-green-300">Dismiss</button>
        </div>
      )}

      <SearchBar
        value={search}
        onChange={handleSearch}
        placeholder="Search by username, email, or ID..."
      />

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[120px]">
          <label className="block text-[10px] uppercase tracking-wider text-pnp-textSecondary mb-1">Tier</label>
          <select
            value={filters.tier || ""}
            onChange={(e) => handleFilterChange("tier", e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-pnp-border bg-pnp-background text-pnp-textPrimary text-sm focus:outline-none focus:border-pnp-accent"
          >
            <option value="">All Tiers</option>
            <option value="PRIME">PRIME</option>
            <option value="member">Member</option>
            <option value="creator">Creator</option>
            <option value="free">Free</option>
            <option value="banned">Banned</option>
          </select>
        </div>
        <div className="flex-1 min-w-[120px]">
          <label className="block text-[10px] uppercase tracking-wider text-pnp-textSecondary mb-1">Status</label>
          <select
            value={filters.status || ""}
            onChange={(e) => handleFilterChange("status", e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-pnp-border bg-pnp-background text-pnp-textPrimary text-sm focus:outline-none focus:border-pnp-accent"
          >
            <option value="">All Statuses</option>
            <option value="active">Active</option>
            <option value="expired">Expired</option>
            <option value="churned">Churned</option>
            <option value="cancelled">Cancelled</option>
            <option value="free">Free</option>
          </select>
        </div>
        <div className="flex-1 min-w-[120px]">
          <label className="block text-[10px] uppercase tracking-wider text-pnp-textSecondary mb-1">Plan</label>
          <select
            value={filters.plan || ""}
            onChange={(e) => handleFilterChange("plan", e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-pnp-border bg-pnp-background text-pnp-textPrimary text-sm focus:outline-none focus:border-pnp-accent"
          >
            <option value="">All Plans</option>
            <option value="__none__">No Plan</option>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>{p.display_name || p.name}</option>
            ))}
          </select>
        </div>
        <div className="flex-1 min-w-[120px]">
          <label className="block text-[10px] uppercase tracking-wider text-pnp-textSecondary mb-1">Role</label>
          <select
            value={filters.role || ""}
            onChange={(e) => handleFilterChange("role", e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-pnp-border bg-pnp-background text-pnp-textPrimary text-sm focus:outline-none focus:border-pnp-accent"
          >
            <option value="">All Roles</option>
            <option value="superadmin">Superadmin</option>
            <option value="admin">Admin</option>
            <option value="user">User</option>
          </select>
        </div>
        {hasActiveFilters && (
          <button
            onClick={clearFilters}
            className="px-3 py-2 text-xs rounded-lg border border-pnp-border text-pnp-textSecondary hover:text-pnp-textPrimary hover:bg-pnp-surface transition-colors whitespace-nowrap"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Result count */}
      {!loading && (
        <p className="text-xs text-pnp-textSecondary">
          {total} user{total !== 1 ? "s" : ""} found
          {hasActiveFilters ? " (filtered)" : ""}
        </p>
      )}

      {/* Bulk Actions Toolbar */}
      {selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 px-4 py-3 rounded-xl bg-pnp-surface border border-pnp-accent/30">
          <span className="text-sm font-medium text-pnp-accent mr-2">
            {selectedIds.size} selected
          </span>
          <button
            onClick={() => openBulkAction("upgrade")}
            className="px-3 py-1.5 text-xs rounded-lg bg-pnp-accent/20 text-pnp-accent border border-pnp-accent/30 hover:bg-pnp-accent/30 transition-colors"
          >
            Upgrade to PRIME
          </button>
          <button
            onClick={() => openBulkAction("downgrade")}
            className="px-3 py-1.5 text-xs rounded-lg bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 hover:bg-yellow-500/20 transition-colors"
          >
            Downgrade to Free
          </button>
          <button
            onClick={() => openBulkAction("ban")}
            className="px-3 py-1.5 text-xs rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors"
          >
            Ban Selected
          </button>
          <button
            onClick={() => openBulkAction("unban")}
            className="px-3 py-1.5 text-xs rounded-lg bg-pnp-border text-pnp-textSecondary border border-pnp-border hover:bg-pnp-surface transition-colors"
          >
            Unban Selected
          </button>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="ml-auto text-xs text-pnp-textSecondary hover:text-pnp-textPrimary"
          >
            Clear
          </button>
        </div>
      )}

      {/* Upgrade Form inline panel */}
      {showUpgradeForm && pendingAction === "upgrade" && (
        <div className="rounded-xl bg-pnp-surface border border-pnp-border p-4 space-y-3">
          <h3 className="text-sm font-semibold text-pnp-textPrimary">
            Upgrade {selectedIds.size} user(s) to PRIME
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-pnp-textSecondary mb-1">Plan</label>
              <select
                value={upgradeForm.planId}
                onChange={(e) => setUpgradeForm((prev) => ({ ...prev, planId: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-pnp-border bg-pnp-background text-pnp-textPrimary text-sm focus:outline-none focus:border-pnp-accent"
              >
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.display_name} — {p.tier} ({p.price} {p.currency})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-pnp-textSecondary mb-1">Expiry Date</label>
              <input
                type="date"
                value={upgradeForm.expiry}
                onChange={(e) => setUpgradeForm((prev) => ({ ...prev, expiry: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-pnp-border bg-pnp-background text-pnp-textPrimary text-sm focus:outline-none focus:border-pnp-accent"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleUpgradeSubmit}
              disabled={!upgradeForm.planId}
              className="px-4 py-2 text-sm rounded-lg bg-pnp-accent text-white font-medium hover:bg-pnp-accent/80 disabled:opacity-50 transition-colors"
            >
              Continue
            </button>
            <button
              onClick={() => { setShowUpgradeForm(false); setPendingAction(null); }}
              className="px-4 py-2 text-sm rounded-lg border border-pnp-border text-pnp-textSecondary hover:bg-pnp-surface transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <DataTable
        columns={columns}
        data={users}
        loading={loading}
        onRowClick={(row) => navigate(`/admin/users/${row.id}`)}
        emptyMessage="No users found"
        selectable
        selectedIds={selectedIds}
        onSelectToggle={handleSelectToggle}
        onSelectAll={handleSelectAll}
        getRowId={(row) => row.id}
      />

      <Pagination page={page} totalPages={totalPages} onPageChange={(p) => { setPage(p); setSelectedIds(new Set()); }} />

      <ConfirmModal
        open={confirmOpen && !!pendingAction && !showUpgradeForm}
        title={pendingAction ? BULK_ACTION_LABELS[pendingAction] : "Confirm"}
        message={`Are you sure you want to ${pendingAction} ${selectedIds.size} user(s)? This action cannot be undone easily.`}
        confirmLabel={pendingAction ? BULK_ACTION_LABELS[pendingAction] : "Confirm"}
        variant={pendingAction ? BULK_ACTION_VARIANTS[pendingAction] : "default"}
        onConfirm={executeBulkAction}
        onCancel={() => { setConfirmOpen(false); setPendingAction(null); }}
        loading={bulkLoading}
      />
    </div>
  );
}
