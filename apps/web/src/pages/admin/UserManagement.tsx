import React, { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { DataTable } from "@/components/admin/DataTable";
import { Pagination } from "@/components/admin/Pagination";
import { SearchBar } from "@/components/admin/SearchBar";
import { ConfirmModal } from "@/components/admin/ConfirmModal";
import { TIER_BADGE_VARIANTS, STATUS_BADGE_VARIANTS, formatDateShort } from "@/components/admin/shared";
import { Badge } from "@pnptv/ui-kit";
import { useI18n } from "@/lib/i18n";
import {
  getAdminUsers,
  getAdminPlans,
  bulkUpdateMemberships,
  type AdminUser,
  type AdminPlan,
  type AdminUserFilters,
} from "@/lib/api";

type BulkAction = "upgrade" | "downgrade" | "ban" | "unban" | "delete";

interface UpgradeForm {
  planId: string;
  expiry: string;
}

export default function UserManagement() {
  const navigate = useNavigate();
  const t = useI18n().admin;

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
      setError(err instanceof Error ? err.message : t.users.failedToLoad);
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
    upgrade: t.users.upgradeToPrime,
    downgrade: t.users.downgradeToFree,
    ban: t.users.banSelected,
    unban: t.users.unbanSelected,
    delete: t.users.deleteSelected,
  };

  const BULK_ACTION_VARIANTS: Record<BulkAction, "default" | "warning" | "danger"> = {
    upgrade: "default",
    downgrade: "warning",
    ban: "danger",
    unban: "default",
    delete: "danger",
  };

  function resolvePhotoUrl(photo: string | null | undefined): string | null {
    if (!photo || typeof photo !== "string") return null;
    if (photo.startsWith("/") || photo.startsWith("http")) return photo;
    return null;
  }

  const columns = [
    {
      key: "username",
      header: t.users.username,
      render: (row: AdminUser) => {
        const photoSrc = resolvePhotoUrl(row.photo_file_id);
        const initials = (row.first_name?.[0] || row.username?.[0] || "?").toUpperCase();
        return (
          <button
            className="flex items-center gap-2 text-left group"
            onClick={(e) => { e.stopPropagation(); navigate(`/admin/users/${row.id}`); }}
          >
            {photoSrc ? (
              <img
                src={photoSrc}
                alt={row.username || ""}
                className="w-8 h-8 rounded-full object-cover flex-shrink-0 ring-1 ring-pnp-border group-hover:ring-pnp-accent transition-all"
              />
            ) : (
              <span className="w-8 h-8 rounded-full bg-pnp-surface border border-pnp-border flex items-center justify-center text-xs font-bold text-pnp-textSecondary flex-shrink-0 group-hover:border-pnp-accent transition-all">
                {initials}
              </span>
            )}
            <span className="font-medium text-pnp-textPrimary group-hover:text-pnp-accent transition-colors">
              {row.username || "—"}
            </span>
          </button>
        );
      },
    },
    {
      key: "email",
      header: t.users.email,
      render: (row: AdminUser) => {
        if (!row.email) return <span className="text-pnp-textSecondary opacity-50">—</span>;
        return (
          <button
            type="button"
            title="Click para buscar por este email"
            onClick={(e) => {
              e.stopPropagation();
              handleFilterChange("emailFilter", row.email!);
              setPage(1);
            }}
            className="text-pnp-textSecondary hover:text-pnp-accent transition-colors text-left underline decoration-dotted"
          >
            {row.email}
          </button>
        );
      },
    },
    {
      key: "tier",
      header: t.users.tier,
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
      header: t.shared.status,
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
      header: t.users.plan,
      render: (row: AdminUser) => (
        <span className="text-pnp-textSecondary text-xs">{row.plan_name || "—"}</span>
      ),
    },
    {
      key: "plan_expiry",
      header: t.users.expiry,
      render: (row: AdminUser) => (
        <span className="text-pnp-textSecondary text-xs">{formatDateShort(row.plan_expiry)}</span>
      ),
    },
    {
      key: "telegram",
      header: "Telegram",
      render: (row: AdminUser) => {
        if (row.telegram) {
          return (
            <span
              className="text-xs font-semibold px-2 py-0.5 rounded-full"
              style={{ background: "rgba(42, 171, 238, 0.15)", color: "#2AABEE" }}
              title={`Telegram ID: ${row.telegram}`}
            >
              Linked
            </span>
          );
        }
        return (
          <span className="text-xs text-pnp-textSecondary opacity-60">—</span>
        );
      },
    },
    {
      key: "last_login_at",
      header: t.users.lastLogin,
      render: (row: AdminUser) => (
        <span className="text-pnp-textSecondary text-xs">
          {row.last_login_at ? formatDateShort(row.last_login_at) : "—"}
          {row.last_login_method && (
            <span className="ml-1 text-pnp-textSecondary opacity-60">({row.last_login_method})</span>
          )}
        </span>
      ),
    },
    {
      key: "created_at",
      header: t.users.joined,
      render: (row: AdminUser) => (
        <span className="text-pnp-textSecondary text-xs">{formatDateShort(row.created_at)}</span>
      ),
    },
    {
      key: "actions",
      header: t.shared.actions,
      render: (row: AdminUser) => (
        <button
          onClick={(e) => {
            e.stopPropagation();
            navigate(`/admin/users/${row.id}`);
          }}
          className="text-xs text-pnp-accent hover:underline"
        >
          {t.shared.view}
        </button>
      ),
    },
  ];

  return (
    <div className="page-container space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-pnp-textPrimary">{t.users.title}</h1>
        <p className="text-sm text-pnp-textSecondary mt-1">
          {t.users.subtitle}
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
          <button onClick={() => setBulkResult(null)} className="ml-2 text-green-400 hover:text-green-300">{t.shared.dismiss}</button>
        </div>
      )}

      <SearchBar
        value={search}
        onChange={handleSearch}
        placeholder={t.users.searchPlaceholder}
      />

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[200px]">
          <label className="block text-[10px] uppercase tracking-wider text-pnp-textSecondary mb-1">{t.users.emailExact}</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-pnp-textSecondary text-xs select-none">@</span>
            <input
              type="email"
              inputMode="email"
              value={filters.emailFilter || ""}
              onChange={(e) => handleFilterChange("emailFilter", e.target.value.trim())}
              placeholder="usuario@dominio.com"
              className="w-full pl-7 pr-3 py-2 rounded-lg border border-pnp-border bg-pnp-background text-pnp-textPrimary placeholder:text-pnp-textSecondary/50 focus:outline-none focus:border-pnp-accent"
              style={{ fontSize: "16px" }}
            />
          </div>
        </div>
        <div className="flex-1 min-w-[120px]">
          <label className="block text-[10px] uppercase tracking-wider text-pnp-textSecondary mb-1">{t.users.tier}</label>
          <select
            value={filters.tier || ""}
            onChange={(e) => handleFilterChange("tier", e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-pnp-border bg-pnp-background text-pnp-textPrimary focus:outline-none focus:border-pnp-accent" style={{ fontSize: "16px" }}
          >
            <option value="">{t.users.allTiers}</option>
            <option value="PRIME">{t.users.prime}</option>
            <option value="member">{t.users.member}</option>
            <option value="free">{t.users.free}</option>
            <option value="banned">{t.shared.banned}</option>
          </select>
        </div>
        <div className="flex-1 min-w-[120px]">
          <label className="block text-[10px] uppercase tracking-wider text-pnp-textSecondary mb-1">{t.users.status}</label>
          <select
            value={filters.status || ""}
            onChange={(e) => handleFilterChange("status", e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-pnp-border bg-pnp-background text-pnp-textPrimary focus:outline-none focus:border-pnp-accent" style={{ fontSize: "16px" }}
          >
            <option value="">{t.users.allStatuses}</option>
            <option value="active">{t.shared.active}</option>
            <option value="expired">{t.shared.expired}</option>
            <option value="churned">{t.shared.churned}</option>
            <option value="free">{t.users.free}</option>
          </select>
        </div>
        <div className="flex-1 min-w-[120px]">
          <label className="block text-[10px] uppercase tracking-wider text-pnp-textSecondary mb-1">{t.users.plan}</label>
          <select
            value={filters.plan || ""}
            onChange={(e) => handleFilterChange("plan", e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-pnp-border bg-pnp-background text-pnp-textPrimary focus:outline-none focus:border-pnp-accent" style={{ fontSize: "16px" }}
          >
            <option value="">{t.users.allPlans}</option>
            <option value="__none__">{t.users.noPlan}</option>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>{p.display_name || p.name}</option>
            ))}
          </select>
        </div>
        <div className="flex-1 min-w-[120px]">
          <label className="block text-[10px] uppercase tracking-wider text-pnp-textSecondary mb-1">{t.users.role}</label>
          <select
            value={filters.role || ""}
            onChange={(e) => handleFilterChange("role", e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-pnp-border bg-pnp-background text-pnp-textPrimary focus:outline-none focus:border-pnp-accent" style={{ fontSize: "16px" }}
          >
            <option value="">{t.users.allRoles}</option>
            <option value="superadmin">{t.users.superadmin}</option>
            <option value="admin">{t.users.admin}</option>
            <option value="user">{t.users.userRole}</option>
          </select>
        </div>
        <div className="flex-1 min-w-[120px]">
          <label className="block text-[10px] uppercase tracking-wider text-pnp-textSecondary mb-1">Telegram</label>
          <select
            value={filters.telegram || ""}
            onChange={(e) => handleFilterChange("telegram", e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-pnp-border bg-pnp-background text-pnp-textPrimary focus:outline-none focus:border-pnp-accent" style={{ fontSize: "16px" }}
          >
            <option value="">{t.users.telegramAny}</option>
            <option value="linked">{t.users.telegramLinked}</option>
            <option value="unlinked">{t.users.telegramNotLinked}</option>
          </select>
        </div>
        {hasActiveFilters && (
          <button
            onClick={clearFilters}
            className="px-3 py-2 text-xs rounded-lg border border-pnp-border text-pnp-textSecondary hover:text-pnp-textPrimary hover:bg-pnp-surface transition-colors whitespace-nowrap"
          >
            {t.shared.clearFilters}
          </button>
        )}
      </div>

      {/* Result count */}
      {!loading && (
        <p className="text-xs text-pnp-textSecondary">
          {t.users.usersFound.replace("{0}", String(total))}
          {hasActiveFilters ? ` ${t.users.filtered}` : ""}
        </p>
      )}

      {/* Bulk Actions Toolbar */}
      {selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 px-4 py-3 rounded-xl bg-pnp-surface border border-pnp-accent/30">
          <span className="text-sm font-medium text-pnp-accent mr-2">
            {t.users.selected.replace("{0}", String(selectedIds.size))}
          </span>
          <button
            onClick={() => openBulkAction("upgrade")}
            className="px-3 py-1.5 text-xs rounded-lg bg-pnp-accent/20 text-pnp-accent border border-pnp-accent/30 hover:bg-pnp-accent/30 transition-colors"
          >
            {t.users.upgradeToPrime}
          </button>
          <button
            onClick={() => openBulkAction("downgrade")}
            className="px-3 py-1.5 text-xs rounded-lg bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 hover:bg-yellow-500/20 transition-colors"
          >
            {t.users.downgradeToFree}
          </button>
          <button
            onClick={() => openBulkAction("ban")}
            className="px-3 py-1.5 text-xs rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors"
          >
            {t.users.banSelected}
          </button>
          <button
            onClick={() => openBulkAction("unban")}
            className="px-3 py-1.5 text-xs rounded-lg bg-pnp-border text-pnp-textSecondary border border-pnp-border hover:bg-pnp-surface transition-colors"
          >
            {t.users.unbanSelected}
          </button>
          <button
            onClick={() => openBulkAction("delete")}
            className="px-3 py-1.5 text-xs rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors"
          >
            {t.users.deleteSelected}
          </button>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="ml-auto text-xs text-pnp-textSecondary hover:text-pnp-textPrimary"
          >
            {t.users.clear}
          </button>
        </div>
      )}

      {/* Upgrade Form inline panel */}
      {showUpgradeForm && pendingAction === "upgrade" && (
        <div className="rounded-xl bg-pnp-surface border border-pnp-border p-4 space-y-3">
          <h3 className="text-sm font-semibold text-pnp-textPrimary">
            {t.users.upgradeTitle.replace("{0}", String(selectedIds.size))}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-pnp-textSecondary mb-1">{t.users.plan}</label>
              <select
                value={upgradeForm.planId}
                onChange={(e) => setUpgradeForm((prev) => ({ ...prev, planId: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-pnp-border bg-pnp-background text-pnp-textPrimary focus:outline-none focus:border-pnp-accent" style={{ fontSize: "16px" }}
              >
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.display_name} — {p.tier} ({p.price} {p.currency})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-pnp-textSecondary mb-1">{t.users.expiryDate}</label>
              <input
                type="date"
                value={upgradeForm.expiry}
                onChange={(e) => setUpgradeForm((prev) => ({ ...prev, expiry: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-pnp-border bg-pnp-background text-pnp-textPrimary focus:outline-none focus:border-pnp-accent" style={{ fontSize: "16px" }}
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleUpgradeSubmit}
              disabled={!upgradeForm.planId}
              className="px-4 py-2 text-sm rounded-lg bg-pnp-accent text-white font-medium hover:bg-pnp-accent/80 disabled:opacity-50 transition-colors"
            >
              {t.users.continue}
            </button>
            <button
              onClick={() => { setShowUpgradeForm(false); setPendingAction(null); }}
              className="px-4 py-2 text-sm rounded-lg border border-pnp-border text-pnp-textSecondary hover:bg-pnp-surface transition-colors"
            >
              {t.shared.cancel}
            </button>
          </div>
        </div>
      )}

      <DataTable
        columns={columns}
        data={users}
        loading={loading}
        onRowClick={(row) => navigate(`/admin/users/${row.id}`)}
        emptyMessage={t.users.noUsersFound}
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
        message={pendingAction ? t.users.bulkConfirm.replace("{0}", t.users.bulkVerbs[pendingAction]).replace("{1}", String(selectedIds.size)) : ""}
        confirmLabel={pendingAction ? BULK_ACTION_LABELS[pendingAction] : "Confirm"}
        variant={pendingAction ? BULK_ACTION_VARIANTS[pendingAction] : "default"}
        onConfirm={executeBulkAction}
        onCancel={() => { setConfirmOpen(false); setPendingAction(null); }}
        loading={bulkLoading}
      />
    </div>
  );
}
