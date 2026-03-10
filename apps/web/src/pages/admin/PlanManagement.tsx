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
  getPlanAddOns,
  setPlanAddOns,
  type AdminPlan,
  type AddOn,
} from "@/lib/api";

// ─── Add-on display metadata ─────────────────────────────────────────────────

const ADD_ON_META: Record<string, { description: string }> = {
  "pnp-member": { description: "Full platform access — hangouts, live streams, DMs, tokens & calls" },
  "prime": { description: "PRIME content — exclusive VOD, prime streams & creator subscriptions" },
  "private-calls": { description: "One private video call credit" },
};

// ─── SKU/description generators ──────────────────────────────────────────────

function generateSku(addOns: Array<{ add_on_id: string; duration_days?: number; is_lifetime?: boolean }>): string {
  const memberAddon  = addOns.find((a) => a.add_on_id === 'pnp-member');
  const primeAddon   = addOns.find((a) => a.add_on_id === 'prime');
  const creatorAddon = addOns.find((a) => a.add_on_id === 'creator-subscription');

  if (!memberAddon && !primeAddon && !creatorAddon) return "";

  const pad = (n: number) => String(n).padStart(3, '0');

  let sku = 'PNP';
  if (memberAddon) {
    sku += `-${memberAddon.is_lifetime ? '000' : pad(memberAddon.duration_days ?? 30)}`;
  }
  if (primeAddon) {
    sku += `-P-${primeAddon.is_lifetime ? '000' : pad(primeAddon.duration_days ?? 30)}`;
  }
  if (creatorAddon) {
    sku += `-C-${creatorAddon.is_lifetime ? '000' : pad(creatorAddon.duration_days ?? 30)}`;
  }
  return sku;
}

function generateDescription(
  enabledAddOnNames: string[],
  durationDays: string,
  isLifetime: boolean
): string {
  if (enabledAddOnNames.length === 0) return "";
  const parts = enabledAddOnNames
    .map((n) => ADD_ON_META[n.toLowerCase().replace(/\s+/g, "-")]?.description ?? n)
    .join(". ");
  const durationSuffix = isLifetime
    ? " (Lifetime access)"
    : durationDays
    ? ` for ${durationDays} days`
    : "";
  return parts + durationSuffix + ".";
}

const TIER_BADGE_VARIANTS: Record<string, "default" | "accent" | "success" | "warning" | "error"> = {
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

// Per-add-on state tracked in the form
interface AddOnRowState {
  enabled: boolean;
  duration_days: string; // "" means inherit plan duration
  is_lifetime: boolean;
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

  // Add-ons catalogue — fetched once on mount
  const [allAddOns, setAllAddOns] = useState<AddOn[]>([]);
  const [addOnsLoading, setAddOnsLoading] = useState(false);

  // Per-add-on state for the currently open form, keyed by add_on_id
  const [addOnRows, setAddOnRows] = useState<Record<number, AddOnRowState>>({});
  const [addOnsLoadError, setAddOnsLoadError] = useState<string | null>(null);

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

  // Fetch the add-ons catalogue once when the component first mounts.
  useEffect(() => {
    setAddOnsLoading(true);
    getAddOns()
      .then((res) => setAllAddOns(res.addOns ?? []))
      .catch(() => {
        // Non-fatal — the add-ons section will just show empty.
        setAllAddOns([]);
      })
      .finally(() => setAddOnsLoading(false));
  }, []);

  // Build the initial addOnRows map: all add-ons disabled with blank config.
  const buildEmptyAddOnRows = useCallback(
    (catalogue: AddOn[]): Record<number, AddOnRowState> => {
      return Object.fromEntries(
        catalogue.map((a) => [a.id, { enabled: false, duration_days: "", is_lifetime: false }])
      );
    },
    []
  );

  const openCreate = () => {
    setEditingId(null);
    setFormState(EMPTY_FORM);
    setFormError(null);
    setAddOnsLoadError(null);
    setAddOnRows(buildEmptyAddOnRows(allAddOns));
    setModalOpen(true);
  };

  const openEdit = async (plan: AdminPlan) => {
    setEditingId(plan.id);
    setFormState(planToForm(plan));
    setFormError(null);
    setAddOnsLoadError(null);

    // Start with everything disabled, then overlay what the plan already has.
    const base = buildEmptyAddOnRows(allAddOns);

    try {
      const res = await getPlanAddOns(plan.id);
      for (const mapping of res.addOns ?? []) {
        base[mapping.add_on_id] = {
          enabled: true,
          duration_days: mapping.duration_days != null ? String(mapping.duration_days) : "",
          is_lifetime: mapping.is_lifetime ?? false,
        };
      }
    } catch {
      setAddOnsLoadError("Could not load existing add-on mappings. You can still save — existing mappings will be preserved unless you change them.");
    }

    setAddOnRows(base);
    setModalOpen(true);
  };

  const handleFieldChange = <K extends keyof PlanFormState>(
    key: K,
    value: PlanFormState[K]
  ) => {
    setFormState((prev) => ({ ...prev, [key]: value }));
  };

  const handleAddOnToggle = (id: number, enabled: boolean) => {
    setAddOnRows((prev) => ({
      ...prev,
      [id]: { ...prev[id], enabled },
    }));
  };

  const handleAddOnDuration = (id: number, value: string) => {
    setAddOnRows((prev) => ({
      ...prev,
      [id]: { ...prev[id], duration_days: value },
    }));
  };

  const handleAddOnLifetime = (id: number, is_lifetime: boolean) => {
    setAddOnRows((prev) => ({
      ...prev,
      [id]: { ...prev[id], is_lifetime },
    }));
  };

  const handleSubmit = async () => {
    setFormLoading(true);
    setFormError(null);
    try {
      const planId = editingId ?? formState.id.trim();

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

      // Persist add-on mappings for the plan that was just saved.
      const enabledAddOns = allAddOns
        .filter((a) => addOnRows[a.id]?.enabled)
        .map((a) => {
          const row = addOnRows[a.id];
          const parsed = parseInt(row.duration_days, 10);
          return {
            add_on_id: a.id,
            duration_days: !row.is_lifetime && row.duration_days !== "" && !isNaN(parsed) ? parsed : null,
            is_lifetime: row.is_lifetime,
          };
        });

      await setPlanAddOns(planId, enabledAddOns);

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

  // ─── Derived previews (create mode only) ───────────────────────────────────

  const enabledAddOnNames = useMemo(
    () => allAddOns.filter((a) => addOnRows[a.id]?.enabled).map((a) => a.name),
    [allAddOns, addOnRows]
  );

  const skuPreview = useMemo(() => {
    if (editingId) return "";
    const enabledAddOnsForSku = allAddOns
      .filter((a) => addOnRows[a.id]?.enabled)
      .map((a) => {
        const row = addOnRows[a.id];
        const parsedDays = parseInt(row.duration_days, 10);
        const overrideDays = row.duration_days !== "" && !isNaN(parsedDays) ? parsedDays : undefined;
        return {
          add_on_id: a.name as string,
          duration_days: row.is_lifetime ? undefined : (overrideDays ?? (parseInt(formState.duration_days, 10) || 30)),
          is_lifetime: row.is_lifetime,
        };
      });
    return generateSku(enabledAddOnsForSku);
  }, [editingId, allAddOns, addOnRows, formState.duration_days]);

  const descriptionPreview = useMemo(
    () => (!editingId ? generateDescription(enabledAddOnNames, formState.duration_days, formState.is_lifetime) : ""),
    [editingId, enabledAddOnNames, formState.duration_days, formState.is_lifetime]
  );

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
        <Badge variant={row.active ? "success" : "error"}>{row.active ? "Active" : "Inactive"}</Badge>
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

              {/* Auto-generated previews — create mode only */}
              {!editingId && (skuPreview || descriptionPreview) && (
                <div className="rounded-lg border border-pnp-border/60 bg-pnp-surface px-3 py-3 space-y-2">
                  <p className="text-xs font-semibold text-pnp-textSecondary uppercase tracking-wide">
                    Auto-generated preview
                  </p>
                  {skuPreview && (
                    <div>
                      <span className="text-xs text-pnp-textSecondary">SKU / slug</span>
                      <p className="font-mono text-xs text-pnp-textPrimary bg-pnp-background rounded px-2 py-1 mt-0.5 break-all">
                        {skuPreview}
                      </p>
                    </div>
                  )}
                  {descriptionPreview && (
                    <div>
                      <span className="text-xs text-pnp-textSecondary">Description</span>
                      <p className="text-xs text-pnp-textPrimary mt-0.5 leading-relaxed">
                        {descriptionPreview}
                      </p>
                    </div>
                  )}
                </div>
              )}

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

              {/* Plan Add-Ons section */}
              <div className="pt-2">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-sm font-semibold text-pnp-textPrimary">Plan Add-Ons</span>
                  <span className="text-xs text-pnp-textSecondary">— entitlements granted alongside this plan</span>
                </div>

                {addOnsLoadError && (
                  <div className="mb-2 px-3 py-2 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-xs text-yellow-400">
                    {addOnsLoadError}
                  </div>
                )}

                {addOnsLoading ? (
                  <div className="space-y-2">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="h-10 rounded-lg bg-pnp-surface animate-pulse" />
                    ))}
                  </div>
                ) : allAddOns.length === 0 ? (
                  <p className="text-xs text-pnp-textSecondary py-2">
                    No add-ons defined yet. Add entitlement add-ons in the system first.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {allAddOns.map((addOn) => {
                      const row = addOnRows[addOn.id] ?? { enabled: false, duration_days: "", is_lifetime: false };
                      return (
                        <div
                          key={addOn.id}
                          className={`rounded-lg border transition-colors ${
                            row.enabled
                              ? "border-pnp-accent/40 bg-pnp-surface"
                              : "border-pnp-border bg-pnp-surface/50"
                          }`}
                        >
                          {/* Add-on toggle row */}
                          <label className="flex items-center gap-3 px-3 py-2 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={row.enabled}
                              onChange={(e) => handleAddOnToggle(addOn.id, e.target.checked)}
                              className="rounded border-pnp-border flex-shrink-0"
                            />
                            <span className="text-sm text-pnp-textPrimary font-medium min-w-0 flex-1 truncate">
                              {addOn.name}
                            </span>
                          </label>

                          {/* Expanded config when enabled */}
                          {row.enabled && (
                            <div className="px-3 pb-3 pt-0 flex flex-wrap items-center gap-4 border-t border-pnp-border/50">
                              <div className="flex items-center gap-2 mt-2">
                                <label className="text-xs text-pnp-textSecondary whitespace-nowrap">Duration (days)</label>
                                <input
                                  type="number"
                                  min="1"
                                  value={row.duration_days}
                                  onChange={(e) => handleAddOnDuration(addOn.id, e.target.value)}
                                  disabled={row.is_lifetime}
                                  placeholder="Inherit"
                                  className="w-24 px-2 py-1 rounded border border-pnp-border bg-pnp-background text-pnp-textPrimary text-xs focus:outline-none focus:border-pnp-accent disabled:opacity-40 disabled:cursor-not-allowed"
                                />
                                <span className="text-xs text-pnp-textSecondary">empty = inherit plan duration</span>
                              </div>

                              <label className="flex items-center gap-2 cursor-pointer mt-2">
                                <input
                                  type="checkbox"
                                  checked={row.is_lifetime}
                                  onChange={(e) => handleAddOnLifetime(addOn.id, e.target.checked)}
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
