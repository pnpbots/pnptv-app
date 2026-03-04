import React, { useState, useEffect, useCallback } from "react";
import { DataTable } from "@/components/admin/DataTable";
import { ConfirmModal } from "@/components/admin/ConfirmModal";
import { Badge } from "@pnptv/ui-kit";
import {
  getAdminPlans,
  createAdminPlan,
  updateAdminPlan,
  deleteAdminPlan,
  type AdminPlan,
} from "@/lib/api";

const TIER_BADGE_VARIANTS: Record<string, "default" | "accent" | "success" | "warning" | "danger"> = {
  PRIME: "accent",
  member: "success",
  creator: "warning",
  free: "default",
};

interface PlanFormState {
  id: string;
  name: string;
  display_name: string;
  tier: string;
  price: string;
  currency: string;
  duration_days: string;
  is_lifetime: boolean;
  is_promo: boolean;
  active: boolean;
  features: string;
}

const EMPTY_FORM: PlanFormState = {
  id: "",
  name: "",
  display_name: "",
  tier: "PRIME",
  price: "0",
  currency: "USD",
  duration_days: "30",
  is_lifetime: false,
  is_promo: false,
  active: true,
  features: "",
};

function planToForm(plan: AdminPlan): PlanFormState {
  return {
    id: plan.id,
    name: plan.name,
    display_name: plan.display_name,
    tier: plan.tier,
    price: String(plan.price),
    currency: plan.currency || "USD",
    duration_days: String(plan.duration ?? 30),
    is_lifetime: plan.isLifetime ?? false,
    is_promo: plan.isPromo ?? false,
    active: plan.active,
    features: (plan.features ?? []).join("\n"),
  };
}

export default function PlanManagement() {
  const [plans, setPlans] = useState<AdminPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formState, setFormState] = useState<PlanFormState>(EMPTY_FORM);
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<AdminPlan | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getAdminPlans();
      setPlans(res.plans);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load plans");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = () => {
    setEditingId(null);
    setFormState(EMPTY_FORM);
    setFormError(null);
    setModalOpen(true);
  };

  const openEdit = (plan: AdminPlan) => {
    setEditingId(plan.id);
    setFormState(planToForm(plan));
    setFormError(null);
    setModalOpen(true);
  };

  const handleFieldChange = <K extends keyof PlanFormState>(
    key: K,
    value: PlanFormState[K]
  ) => {
    setFormState((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async () => {
    setFormLoading(true);
    setFormError(null);
    try {
      const payload: Partial<AdminPlan> & { id: string } = {
        id: formState.id.trim(),
        name: formState.name.trim(),
        display_name: formState.display_name.trim(),
        tier: formState.tier,
        price: parseFloat(formState.price) || 0,
        currency: formState.currency,
        duration: parseInt(formState.duration_days, 10) || 30,
        isLifetime: formState.is_lifetime,
        isPromo: formState.is_promo,
        active: formState.active,
        features: formState.features
          .split("\n")
          .map((f) => f.trim())
          .filter(Boolean),
      };

      if (editingId) {
        await updateAdminPlan(editingId, payload);
      } else {
        if (!payload.id) {
          setFormError("Plan ID is required");
          setFormLoading(false);
          return;
        }
        await createAdminPlan(payload as Partial<AdminPlan> & { id: string });
      }

      setModalOpen(false);
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to save plan");
    } finally {
      setFormLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      await deleteAdminPlan(deleteTarget.id);
      setDeleteTarget(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete plan");
      setDeleteTarget(null);
    } finally {
      setDeleteLoading(false);
    }
  };

  const columns = [
    { key: "id", header: "ID", render: (row: AdminPlan) => <span className="font-mono text-xs text-pnp-textSecondary">{row.id}</span> },
    { key: "display_name", header: "Name", render: (row: AdminPlan) => <span className="font-medium text-pnp-textPrimary">{row.display_name}</span> },
    {
      key: "tier",
      header: "Tier",
      render: (row: AdminPlan) => (
        <Badge variant={TIER_BADGE_VARIANTS[row.tier] ?? "default"}>{row.tier}</Badge>
      ),
    },
    {
      key: "price",
      header: "Price",
      render: (row: AdminPlan) => (
        <span className="text-pnp-textPrimary font-medium">
          ${(typeof row.price === "number" && !isNaN(row.price) ? row.price : 0).toFixed(2)}
        </span>
      ),
    },
    {
      key: "duration",
      header: "Days",
      render: (row: AdminPlan) => (
        <span className="text-pnp-textSecondary">
          {row.isLifetime ? "Lifetime" : row.duration != null ? `${row.duration}d` : "—"}
        </span>
      ),
    },
    {
      key: "isLifetime",
      header: "Lifetime?",
      render: (row: AdminPlan) => (
        <Badge variant={row.isLifetime ? "success" : "default"}>{row.isLifetime ? "Yes" : "No"}</Badge>
      ),
    },
    {
      key: "isPromo",
      header: "Promo?",
      render: (row: AdminPlan) => (
        <Badge variant={row.isPromo ? "warning" : "default"}>{row.isPromo ? "Yes" : "No"}</Badge>
      ),
    },
    {
      key: "active",
      header: "Active?",
      render: (row: AdminPlan) => (
        <Badge variant={row.active ? "success" : "danger"}>{row.active ? "Active" : "Inactive"}</Badge>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      render: (row: AdminPlan) => (
        <div className="flex items-center gap-2">
          <button
            onClick={(e) => { e.stopPropagation(); openEdit(row); }}
            className="text-xs text-pnp-accent hover:underline"
          >
            Edit
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); setDeleteTarget(row); }}
            className="text-xs text-red-400 hover:underline"
          >
            Delete
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="page-container space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-pnp-textPrimary">Plan Management</h1>
          <p className="text-sm text-pnp-textSecondary mt-1">Create, edit, and manage subscription plans</p>
        </div>
        <button
          onClick={openCreate}
          className="px-4 py-2 rounded-lg bg-pnp-accent text-white text-sm font-medium hover:bg-pnp-accent/80 transition-colors"
        >
          + Create Plan
        </button>
      </div>

      {error && (
        <div className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">
          {error}
          <button onClick={() => setError(null)} className="ml-2">Dismiss</button>
        </div>
      )}

      <DataTable
        columns={columns}
        data={plans}
        loading={loading}
        emptyMessage="No plans found. Create one above."
        getRowId={(row) => row.id}
      />

      {/* Create / Edit Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setModalOpen(false)}>
          <div className="fixed inset-0 bg-black/60" />
          <div
            className="relative bg-pnp-background border border-pnp-border rounded-xl p-6 max-w-lg w-full shadow-xl max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-pnp-textPrimary mb-4">
              {editingId ? "Edit Plan" : "Create Plan"}
            </h3>

            {formError && (
              <div className="mb-4 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">
                {formError}
              </div>
            )}

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-pnp-textSecondary mb-1">Plan ID {editingId && <span className="text-pnp-textSecondary">(read-only)</span>}</label>
                  <input
                    type="text"
                    value={formState.id}
                    onChange={(e) => handleFieldChange("id", e.target.value)}
                    disabled={!!editingId}
                    placeholder="e.g. prime_monthly"
                    className="w-full px-3 py-2 rounded-lg border border-pnp-border bg-pnp-background text-pnp-textPrimary text-sm focus:outline-none focus:border-pnp-accent disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                </div>
                <div>
                  <label className="block text-xs text-pnp-textSecondary mb-1">Internal Name</label>
                  <input
                    type="text"
                    value={formState.name}
                    onChange={(e) => handleFieldChange("name", e.target.value)}
                    placeholder="e.g. prime_monthly"
                    className="w-full px-3 py-2 rounded-lg border border-pnp-border bg-pnp-background text-pnp-textPrimary text-sm focus:outline-none focus:border-pnp-accent"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-pnp-textSecondary mb-1">Display Name</label>
                <input
                  type="text"
                  value={formState.display_name}
                  onChange={(e) => handleFieldChange("display_name", e.target.value)}
                  placeholder="e.g. PRIME Monthly"
                  className="w-full px-3 py-2 rounded-lg border border-pnp-border bg-pnp-background text-pnp-textPrimary text-sm focus:outline-none focus:border-pnp-accent"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-pnp-textSecondary mb-1">Tier</label>
                  <select
                    value={formState.tier}
                    onChange={(e) => handleFieldChange("tier", e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-pnp-border bg-pnp-background text-pnp-textPrimary text-sm focus:outline-none focus:border-pnp-accent"
                  >
                    <option value="free">free</option>
                    <option value="member">member</option>
                    <option value="PRIME">PRIME</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-pnp-textSecondary mb-1">Currency</label>
                  <select
                    value={formState.currency}
                    onChange={(e) => handleFieldChange("currency", e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-pnp-border bg-pnp-background text-pnp-textPrimary text-sm focus:outline-none focus:border-pnp-accent"
                  >
                    <option value="USD">USD</option>
                    <option value="COP">COP</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-pnp-textSecondary mb-1">Price</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={formState.price}
                    onChange={(e) => handleFieldChange("price", e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-pnp-border bg-pnp-background text-pnp-textPrimary text-sm focus:outline-none focus:border-pnp-accent"
                  />
                </div>
                <div>
                  <label className="block text-xs text-pnp-textSecondary mb-1">Duration (days)</label>
                  <input
                    type="number"
                    min="1"
                    value={formState.duration_days}
                    onChange={(e) => handleFieldChange("duration_days", e.target.value)}
                    disabled={formState.is_lifetime}
                    className="w-full px-3 py-2 rounded-lg border border-pnp-border bg-pnp-background text-pnp-textPrimary text-sm focus:outline-none focus:border-pnp-accent disabled:opacity-50"
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-6">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formState.is_lifetime}
                    onChange={(e) => handleFieldChange("is_lifetime", e.target.checked)}
                    className="rounded border-pnp-border"
                  />
                  <span className="text-sm text-pnp-textPrimary">Lifetime</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formState.is_promo}
                    onChange={(e) => handleFieldChange("is_promo", e.target.checked)}
                    className="rounded border-pnp-border"
                  />
                  <span className="text-sm text-pnp-textPrimary">Promo</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formState.active}
                    onChange={(e) => handleFieldChange("active", e.target.checked)}
                    className="rounded border-pnp-border"
                  />
                  <span className="text-sm text-pnp-textPrimary">Active</span>
                </label>
              </div>

              <div>
                <label className="block text-xs text-pnp-textSecondary mb-1">Features (one per line)</label>
                <textarea
                  value={formState.features}
                  onChange={(e) => handleFieldChange("features", e.target.value)}
                  rows={4}
                  placeholder={"Full access to PRIME content\nPriority support\nExclusive hangouts"}
                  className="w-full px-3 py-2 rounded-lg border border-pnp-border bg-pnp-background text-pnp-textPrimary text-sm focus:outline-none focus:border-pnp-accent resize-none"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-5">
              <button
                onClick={() => setModalOpen(false)}
                disabled={formLoading}
                className="px-4 py-2 text-sm rounded-lg border border-pnp-border text-pnp-textSecondary hover:bg-pnp-surface disabled:opacity-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={formLoading}
                className="px-4 py-2 text-sm rounded-lg bg-pnp-accent text-white font-medium hover:bg-pnp-accent/80 disabled:opacity-50 transition-colors"
              >
                {formLoading ? "Saving..." : editingId ? "Update Plan" : "Create Plan"}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        open={!!deleteTarget}
        title="Delete Plan"
        message={`Are you sure you want to delete the plan "${deleteTarget?.display_name ?? ""}" (${deleteTarget?.id ?? ""})? This action cannot be undone.`}
        confirmLabel="Delete Plan"
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
        loading={deleteLoading}
      />
    </div>
  );
}
