import React, { useState, useEffect, useCallback, useMemo } from "react";
import { DataTable } from "@/components/admin/DataTable";
import { ConfirmModal } from "@/components/admin/ConfirmModal";
import { Badge } from "@pnptv/ui-kit";
import {
  getAdminPlans,
  createAdminPlan,
  updateAdminPlan,
  deleteAdminPlan,
  getAddOns,
  type AdminPlan,
  type AddOn,
} from "@/lib/api";

// ─── SKU generator (mirrors backend) ──────────────────────────────────────────

function generateSku(
  addOns: Array<{ add_on_id: string; duration_days?: number; is_lifetime?: boolean }>
): string {
  const member = addOns.find((a) => a.add_on_id === "pnp-member");
  const prime = addOns.find((a) => a.add_on_id === "prime");
  const creator = addOns.find((a) => a.add_on_id === "creator-subscription");
  if (!member && !prime && !creator) return "";
  const pad = (n: number) => String(n).padStart(3, "0");
  let sku = "PNP";
  if (member) sku += `-${member.is_lifetime ? "000" : pad(member.duration_days ?? 30)}`;
  if (prime) sku += `-P-${prime.is_lifetime ? "000" : pad(prime.duration_days ?? 30)}`;
  if (creator) sku += `-C-${creator.is_lifetime ? "000" : pad(creator.duration_days ?? 30)}`;
  return sku;
}

function deriveLabel(addOns: Array<{ add_on_id: string }>): string {
  const ids = addOns.map((a) => a.add_on_id);
  if (ids.includes("prime")) return "PRIME";
  if (ids.includes("pnp-member")) return "BASIC";
  return "FREE";
}

const LABEL_VARIANTS: Record<string, "accent" | "success" | "default"> = {
  PRIME: "accent",
  BASIC: "success",
  FREE: "default",
};

// ─── Form types ───────────────────────────────────────────────────────────────

interface AddOnRowState {
  enabled: boolean;
  duration_days: string;
  is_lifetime: boolean;
}

interface PlanFormState {
  name: string;
  price: string;
  active: boolean;
}

const EMPTY_FORM: PlanFormState = { name: "", price: "", active: true };

// ─── Component ────────────────────────────────────────────────────────────────

export default function PlanManagement() {
  const [plans, setPlans] = useState<AdminPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<AdminPlan | null>(null);
  const [form, setForm] = useState<PlanFormState>(EMPTY_FORM);
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<AdminPlan | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const [allAddOns, setAllAddOns] = useState<AddOn[]>([]);
  const [addOnRows, setAddOnRows] = useState<Record<string, AddOnRowState>>({});

  // ── Data loading ──────────────────────────────────────────────────────────

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

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    getAddOns()
      .then((res) => setAllAddOns(res.addOns ?? []))
      .catch(() => setAllAddOns([]));
  }, []);

  // ── Helpers ───────────────────────────────────────────────────────────────

  const buildEmptyRows = useCallback(
    (catalogue: AddOn[]): Record<string, AddOnRowState> =>
      Object.fromEntries(
        catalogue.map((a) => [a.id, { enabled: false, duration_days: "30", is_lifetime: false }])
      ),
    []
  );

  const openCreate = () => {
    setEditingPlan(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setAddOnRows(buildEmptyRows(allAddOns));
    setModalOpen(true);
  };

  const openEdit = (plan: AdminPlan) => {
    setEditingPlan(plan);
    setForm({ name: plan.display_name || plan.name, price: String(plan.price), active: plan.active });
    setFormError(null);

    const rows = buildEmptyRows(allAddOns);
    for (const ao of plan.add_ons ?? []) {
      rows[ao.add_on_id] = {
        enabled: true,
        duration_days: ao.duration_days != null ? String(ao.duration_days) : "30",
        is_lifetime: ao.is_lifetime ?? false,
      };
    }
    setAddOnRows(rows);
    setModalOpen(true);
  };

  // ── Form handlers ─────────────────────────────────────────────────────────

  const setField = <K extends keyof PlanFormState>(key: K, val: PlanFormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: val }));

  const toggleAddOn = (id: string, enabled: boolean) =>
    setAddOnRows((prev) => ({ ...prev, [id]: { ...prev[id], enabled } }));

  const setAddOnDuration = (id: string, val: string) =>
    setAddOnRows((prev) => ({ ...prev, [id]: { ...prev[id], duration_days: val } }));

  const setAddOnLifetime = (id: string, lt: boolean) =>
    setAddOnRows((prev) => ({ ...prev, [id]: { ...prev[id], is_lifetime: lt } }));

  // ── Derived previews ──────────────────────────────────────────────────────

  const enabledAddOns = useMemo(
    () =>
      allAddOns
        .filter((a) => addOnRows[a.id]?.enabled)
        .map((a) => {
          const row = addOnRows[a.id];
          const days = parseInt(row.duration_days, 10);
          return {
            add_on_id: a.id,
            duration_days: row.is_lifetime ? undefined : (isNaN(days) ? 30 : days),
            is_lifetime: row.is_lifetime,
            name: a.name,
          };
        }),
    [allAddOns, addOnRows]
  );

  const skuPreview = useMemo(() => generateSku(enabledAddOns), [enabledAddOns]);
  const labelPreview = useMemo(() => deriveLabel(enabledAddOns), [enabledAddOns]);

  // ── Submit ────────────────────────────────────────────────────────────────

  const handleSubmit = async () => {
    if (!form.name.trim()) { setFormError("Plan name is required"); return; }
    const price = parseFloat(form.price);
    if (isNaN(price) || price <= 0) { setFormError("Price must be a positive number"); return; }
    if (enabledAddOns.length === 0) { setFormError("Select at least one add-on"); return; }

    setFormLoading(true);
    setFormError(null);
    try {
      const addOnsPayload = enabledAddOns.map(({ add_on_id, duration_days, is_lifetime }) => ({
        add_on_id,
        duration_days: is_lifetime ? undefined : duration_days,
        is_lifetime,
      }));

      if (editingPlan) {
        await updateAdminPlan(editingPlan.id, {
          name: form.name.trim(),
          display_name: form.name.trim(),
          price,
          is_active: form.active,
          add_ons: addOnsPayload,
        });
      } else {
        await createAdminPlan({
          name: form.name.trim(),
          price,
          add_ons: addOnsPayload,
          is_active: form.active,
        });
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

  // ── Table columns ─────────────────────────────────────────────────────────

  const columns = [
    {
      key: "name",
      header: "Plan",
      render: (row: AdminPlan) => (
        <div>
          <span className="font-medium text-pnp-textPrimary">{row.display_name || row.name}</span>
          {row.sku && (
            <span className="block font-mono text-[10px] text-pnp-textSecondary mt-0.5">{row.sku}</span>
          )}
        </div>
      ),
    },
    {
      key: "label",
      header: "Label",
      render: (row: AdminPlan) => {
        const label = deriveLabel(row.add_ons ?? []);
        return <Badge variant={LABEL_VARIANTS[label] ?? "default"}>{label}</Badge>;
      },
    },
    {
      key: "add_ons",
      header: "Entitlements",
      render: (row: AdminPlan) => (
        <div className="flex flex-wrap gap-1">
          {(row.add_ons ?? []).map((ao) => (
            <span
              key={ao.add_on_id}
              className="inline-block px-1.5 py-0.5 rounded text-[10px] bg-pnp-surface border border-pnp-border text-pnp-textSecondary"
            >
              {ao.name || ao.add_on_id}
              <span className="ml-1 text-pnp-textSecondary/60">
                {ao.is_lifetime ? "LT" : ao.duration_days ? `${ao.duration_days}d` : ""}
              </span>
            </span>
          ))}
        </div>
      ),
    },
    {
      key: "price",
      header: "Price",
      render: (row: AdminPlan) => (
        <span className="text-pnp-textPrimary font-medium">
          ${(typeof row.price === "number" ? row.price : 0).toFixed(2)}
        </span>
      ),
    },
    {
      key: "active",
      header: "Status",
      render: (row: AdminPlan) => (
        <Badge variant={row.active ? "success" : "error"}>
          {row.active ? "Active" : "Inactive"}
        </Badge>
      ),
    },
    {
      key: "actions",
      header: "",
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

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="page-container space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-pnp-textPrimary">Plan Builder</h1>
          <p className="text-sm text-pnp-textSecondary mt-1">
            Create and manage entitlement-based subscription plans
          </p>
        </div>
        <button
          onClick={openCreate}
          className="px-4 py-2 rounded-lg bg-pnp-accent text-white text-sm font-medium hover:bg-pnp-accent/80 transition-colors"
        >
          + New Plan
        </button>
      </div>

      {error && (
        <div className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline">Dismiss</button>
        </div>
      )}

      <DataTable
        columns={columns}
        data={plans}
        loading={loading}
        emptyMessage="No plans yet. Click '+ New Plan' to create one."
        getRowId={(row) => row.id}
      />

      {/* ─── Create / Edit Modal ──────────────────────────────────────────── */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/60" onClick={() => setModalOpen(false)} />
          <div
            className="relative bg-pnp-background border border-pnp-border rounded-xl p-6 max-w-lg w-full shadow-xl max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-pnp-textPrimary mb-4">
              {editingPlan ? "Edit Plan" : "New Plan"}
            </h3>

            {formError && (
              <div className="mb-4 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">
                {formError}
              </div>
            )}

            <div className="space-y-4">
              {/* Name */}
              <div>
                <label className="block text-xs text-pnp-textSecondary mb-1">Plan Name</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setField("name", e.target.value)}
                  placeholder="e.g. PRIME Monthly"
                  className="w-full px-3 py-2 rounded-lg border border-pnp-border bg-pnp-background text-pnp-textPrimary text-sm focus:outline-none focus:border-pnp-accent"
                />
              </div>

              {/* Price */}
              <div>
                <label className="block text-xs text-pnp-textSecondary mb-1">Price (USD)</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-pnp-textSecondary text-sm">$</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.price}
                    onChange={(e) => setField("price", e.target.value)}
                    placeholder="0.00"
                    className="w-full pl-7 pr-3 py-2 rounded-lg border border-pnp-border bg-pnp-background text-pnp-textPrimary text-sm focus:outline-none focus:border-pnp-accent"
                  />
                </div>
              </div>

              {/* Add-ons */}
              <div>
                <label className="block text-xs text-pnp-textSecondary mb-2">
                  Entitlements
                  <span className="ml-1 text-pnp-textSecondary/60">— what this plan grants</span>
                </label>

                {allAddOns.length === 0 ? (
                  <p className="text-xs text-pnp-textSecondary py-2">Loading add-ons...</p>
                ) : (
                  <div className="space-y-2">
                    {allAddOns.map((addOn) => {
                      const row = addOnRows[addOn.id] ?? { enabled: false, duration_days: "30", is_lifetime: false };
                      return (
                        <div
                          key={addOn.id}
                          className={`rounded-lg border transition-colors ${
                            row.enabled
                              ? "border-pnp-accent/40 bg-pnp-surface"
                              : "border-pnp-border bg-pnp-surface/50"
                          }`}
                        >
                          <label className="flex items-center gap-3 px-3 py-2.5 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={row.enabled}
                              onChange={(e) => toggleAddOn(addOn.id, e.target.checked)}
                              className="rounded border-pnp-border flex-shrink-0"
                            />
                            <div className="min-w-0 flex-1">
                              <span className="text-sm text-pnp-textPrimary font-medium">
                                {addOn.name}
                              </span>
                              {addOn.ui_description && (
                                <span className="block text-[11px] text-pnp-textSecondary mt-0.5">
                                  {addOn.ui_description}
                                </span>
                              )}
                            </div>
                          </label>

                          {row.enabled && (
                            <div className="px-3 pb-3 pt-0 flex flex-wrap items-center gap-4 border-t border-pnp-border/50">
                              <div className="flex items-center gap-2 mt-2">
                                <label className="text-xs text-pnp-textSecondary whitespace-nowrap">Days</label>
                                <input
                                  type="number"
                                  min="1"
                                  value={row.duration_days}
                                  onChange={(e) => setAddOnDuration(addOn.id, e.target.value)}
                                  disabled={row.is_lifetime}
                                  className="w-20 px-2 py-1 rounded border border-pnp-border bg-pnp-background text-pnp-textPrimary text-xs focus:outline-none focus:border-pnp-accent disabled:opacity-40"
                                />
                              </div>
                              <label className="flex items-center gap-2 cursor-pointer mt-2">
                                <input
                                  type="checkbox"
                                  checked={row.is_lifetime}
                                  onChange={(e) => setAddOnLifetime(addOn.id, e.target.checked)}
                                  className="rounded border-pnp-border"
                                />
                                <span className="text-xs text-pnp-textPrimary">Lifetime</span>
                              </label>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Active toggle */}
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(e) => setField("active", e.target.checked)}
                  className="rounded border-pnp-border"
                />
                <span className="text-sm text-pnp-textPrimary">Active</span>
              </label>

              {/* Auto-generated preview */}
              {enabledAddOns.length > 0 && (
                <div className="rounded-lg border border-pnp-border/60 bg-pnp-surface px-3 py-3 space-y-2">
                  <p className="text-[10px] font-semibold text-pnp-textSecondary uppercase tracking-wide">
                    Preview
                  </p>
                  <div className="flex items-center gap-3">
                    {skuPreview && (
                      <div>
                        <span className="text-[10px] text-pnp-textSecondary">SKU</span>
                        <p className="font-mono text-xs text-pnp-textPrimary bg-pnp-background rounded px-2 py-0.5 mt-0.5">
                          {skuPreview}
                        </p>
                      </div>
                    )}
                    <div>
                      <span className="text-[10px] text-pnp-textSecondary">Label</span>
                      <div className="mt-0.5">
                        <Badge variant={LABEL_VARIANTS[labelPreview] ?? "default"}>
                          {labelPreview}
                        </Badge>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Actions */}
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
                {formLoading ? "Saving..." : editingPlan ? "Update Plan" : "Create Plan"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      <ConfirmModal
        open={!!deleteTarget}
        title="Delete Plan"
        message={`Are you sure you want to delete "${deleteTarget?.display_name ?? deleteTarget?.name ?? ""}"? If it has active subscriptions, it will be deactivated instead.`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
        loading={deleteLoading}
      />
    </div>
  );
}
