import React, { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { ConfirmModal } from "@/components/admin/ConfirmModal";
import { Badge } from "@pnptv/ui-kit";
import {
  getAdminUser,
  getAdminPlans,
  updateAdminUser,
  banAdminUser,
  type AdminUser,
  type AdminPlan,
} from "@/lib/api";

const TIER_BADGE_VARIANTS: Record<string, "default" | "accent" | "success" | "warning" | "danger"> = {
  prime: "accent",
  member: "success",
  creator: "warning",
  free: "default",
  banned: "danger",
};

const STATUS_BADGE_VARIANTS: Record<string, "default" | "accent" | "success" | "warning" | "danger"> = {
  active: "success",
  expired: "warning",
  cancelled: "danger",
  free: "default",
};

function avatarLetter(user: AdminUser): string {
  const name = user.first_name || user.username || user.email || "?";
  return name[0].toUpperCase();
}

interface EditForm {
  username: string;
  email: string;
  subscriptionStatus: string;
  subscriptionPlan: string;
  planExpiry: string;
  tier: string;
}

export default function UserDetail() {
  const { userId } = useParams<{ userId: string }>();
  const navigate = useNavigate();

  const [user, setUser] = useState<AdminUser | null>(null);
  const [plans, setPlans] = useState<AdminPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveLoading, setSaveLoading] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const [editForm, setEditForm] = useState<EditForm>({
    username: "",
    email: "",
    subscriptionStatus: "free",
    subscriptionPlan: "",
    planExpiry: "",
    tier: "free",
  });

  const [banReason, setBanReason] = useState("");
  const [banConfirmOpen, setBanConfirmOpen] = useState(false);
  const [banAction, setBanAction] = useState<"ban" | "unban">("ban");
  const [banLoading, setBanLoading] = useState(false);

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const [userRes, plansRes] = await Promise.all([
        getAdminUser(userId),
        getAdminPlans(),
      ]);
      setUser(userRes.user);
      setPlans(plansRes.plans);
      setEditForm({
        username: userRes.user.username || "",
        email: userRes.user.email || "",
        subscriptionStatus: userRes.user.subscription_status || "free",
        subscriptionPlan: userRes.user.subscription_plan || "",
        planExpiry: userRes.user.plan_expiry
          ? new Date(userRes.user.plan_expiry).toISOString().split("T")[0]
          : "",
        tier: userRes.user.tier || "free",
      });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load user");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleFormChange = (field: keyof EditForm, value: string) => {
    setEditForm((prev) => ({ ...prev, [field]: value }));
    setSaveSuccess(false);
  };

  const handleSave = async () => {
    if (!userId) return;
    setSaveLoading(true);
    setSaveSuccess(false);
    try {
      const res = await updateAdminUser(userId, {
        username: editForm.username || undefined,
        email: editForm.email || undefined,
        subscriptionStatus: editForm.subscriptionStatus || undefined,
        subscriptionPlan: editForm.subscriptionPlan || undefined,
        tier: editForm.tier || undefined,
        planExpiry: editForm.planExpiry || undefined,
      });
      setUser(res.user);
      setSaveSuccess(true);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save changes");
    } finally {
      setSaveLoading(false);
    }
  };

  const openBanModal = (action: "ban" | "unban") => {
    setBanAction(action);
    setBanReason("");
    setBanConfirmOpen(true);
  };

  const executeBan = async () => {
    if (!userId || !user) return;
    setBanLoading(true);
    try {
      const res = await banAdminUser(userId, banAction === "ban", banReason || undefined);
      setUser(res.user);
      setBanConfirmOpen(false);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ban action failed");
      setBanConfirmOpen(false);
    } finally {
      setBanLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="page-container">
        <div className="space-y-4 animate-pulse">
          <div className="h-8 w-48 bg-pnp-border rounded" />
          <div className="h-24 bg-pnp-surface rounded-xl" />
          <div className="h-64 bg-pnp-surface rounded-xl" />
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="page-container text-center py-16">
        <p className="text-pnp-textSecondary">{error || "User not found"}</p>
        <Link to="/admin/users" className="mt-4 inline-block text-sm text-pnp-accent hover:underline">
          Back to Users
        </Link>
      </div>
    );
  }

  const isBanned = user.tier === "banned" || user.subscription_status === "cancelled";

  return (
    <div className="page-container space-y-6">
      {/* Back link */}
      <Link
        to="/admin/users"
        className="flex items-center gap-1.5 text-sm text-pnp-textSecondary hover:text-pnp-textPrimary transition-colors w-fit"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.75 19.5L8.25 12l7.5-7.5" />
        </svg>
        Back to Users
      </Link>

      {error && (
        <div className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">
          {error}
          <button onClick={() => setError(null)} className="ml-2 text-red-400 hover:text-red-300">Dismiss</button>
        </div>
      )}

      {saveSuccess && (
        <div className="px-4 py-3 rounded-lg bg-green-500/10 border border-green-500/20 text-sm text-green-400">
          Changes saved successfully.
        </div>
      )}

      {/* User header */}
      <div className="rounded-xl bg-pnp-surface border border-pnp-border p-5 flex items-start gap-4">
        <div className="w-14 h-14 rounded-full flex items-center justify-center text-xl font-bold text-white flex-shrink-0"
          style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}>
          {avatarLetter(user)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <h1 className="text-xl font-bold text-pnp-textPrimary">
              {user.first_name
                ? `${user.first_name}${user.last_name ? " " + user.last_name : ""}`
                : user.username || "Unknown"}
            </h1>
            <Badge variant={TIER_BADGE_VARIANTS[user.tier] ?? "default"}>{user.tier}</Badge>
            <Badge variant={STATUS_BADGE_VARIANTS[user.subscription_status] ?? "default"}>
              {user.subscription_status}
            </Badge>
          </div>
          {user.username && (
            <p className="text-sm text-pnp-textSecondary">@{user.username}</p>
          )}
          {user.email && (
            <p className="text-sm text-pnp-textSecondary">{user.email}</p>
          )}
          <p className="text-xs text-pnp-textSecondary mt-1">ID: {user.id}</p>
        </div>
      </div>

      {/* Edit Form */}
      <div className="rounded-xl bg-pnp-surface border border-pnp-border p-5 space-y-4">
        <h2 className="text-sm font-semibold text-pnp-textSecondary uppercase tracking-wider">
          Edit User
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-pnp-textSecondary mb-1">Username</label>
            <input
              type="text"
              value={editForm.username}
              onChange={(e) => handleFormChange("username", e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-pnp-border bg-pnp-background text-pnp-textPrimary text-sm focus:outline-none focus:border-pnp-accent"
            />
          </div>
          <div>
            <label className="block text-xs text-pnp-textSecondary mb-1">Email</label>
            <input
              type="email"
              value={editForm.email}
              onChange={(e) => handleFormChange("email", e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-pnp-border bg-pnp-background text-pnp-textPrimary text-sm focus:outline-none focus:border-pnp-accent"
            />
          </div>
          <div>
            <label className="block text-xs text-pnp-textSecondary mb-1">Subscription Status</label>
            <select
              value={editForm.subscriptionStatus}
              onChange={(e) => handleFormChange("subscriptionStatus", e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-pnp-border bg-pnp-background text-pnp-textPrimary text-sm focus:outline-none focus:border-pnp-accent"
            >
              <option value="active">active</option>
              <option value="expired">expired</option>
              <option value="cancelled">cancelled</option>
              <option value="free">free</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-pnp-textSecondary mb-1">Subscription Plan</label>
            <select
              value={editForm.subscriptionPlan}
              onChange={(e) => handleFormChange("subscriptionPlan", e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-pnp-border bg-pnp-background text-pnp-textPrimary text-sm focus:outline-none focus:border-pnp-accent"
            >
              <option value="">— None —</option>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.display_name} ({p.tier})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-pnp-textSecondary mb-1">Plan Expiry</label>
            <input
              type="date"
              value={editForm.planExpiry}
              onChange={(e) => handleFormChange("planExpiry", e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-pnp-border bg-pnp-background text-pnp-textPrimary text-sm focus:outline-none focus:border-pnp-accent"
            />
          </div>
          <div>
            <label className="block text-xs text-pnp-textSecondary mb-1">Tier</label>
            <select
              value={editForm.tier}
              onChange={(e) => handleFormChange("tier", e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-pnp-border bg-pnp-background text-pnp-textPrimary text-sm focus:outline-none focus:border-pnp-accent"
            >
              <option value="free">free</option>
              <option value="member">member</option>
              <option value="prime">prime</option>
              <option value="creator">creator</option>
              <option value="banned">banned</option>
            </select>
          </div>
        </div>

        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={saveLoading}
            className="px-5 py-2 rounded-lg bg-pnp-accent text-white text-sm font-medium hover:bg-pnp-accent/80 disabled:opacity-50 transition-colors"
          >
            {saveLoading ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </div>

      {/* Ban / Unban Section */}
      <div className="rounded-xl bg-red-500/5 border border-red-500/20 p-5 space-y-3">
        <h2 className="text-sm font-semibold text-red-400 uppercase tracking-wider">
          {isBanned ? "Unban User" : "Ban User"}
        </h2>
        <p className="text-xs text-pnp-textSecondary">
          {isBanned
            ? "This user is currently banned. Unbanning will restore their access."
            : "Banning a user will immediately revoke their access and set their tier to 'banned'."}
        </p>
        {!isBanned && (
          <div>
            <label className="block text-xs text-pnp-textSecondary mb-1">Ban Reason (optional)</label>
            <textarea
              value={banReason}
              onChange={(e) => setBanReason(e.target.value)}
              rows={2}
              placeholder="Reason for banning this user..."
              className="w-full px-3 py-2 rounded-lg border border-pnp-border bg-pnp-background text-pnp-textPrimary text-sm focus:outline-none focus:border-red-500/50 resize-none"
            />
          </div>
        )}
        <div className="flex justify-end">
          <button
            onClick={() => openBanModal(isBanned ? "unban" : "ban")}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              isBanned
                ? "bg-green-500/10 text-green-400 border border-green-500/20 hover:bg-green-500/20"
                : "bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20"
            }`}
          >
            {isBanned ? "Unban User" : "Ban User"}
          </button>
        </div>
      </div>

      <ConfirmModal
        open={banConfirmOpen}
        title={banAction === "ban" ? "Ban User" : "Unban User"}
        message={
          banAction === "ban"
            ? `Are you sure you want to ban @${user.username || user.id}? They will lose all access immediately.${banReason ? ` Reason: "${banReason}"` : ""}`
            : `Are you sure you want to unban @${user.username || user.id}? Their access will be restored.`
        }
        confirmLabel={banAction === "ban" ? "Ban User" : "Unban User"}
        variant={banAction === "ban" ? "danger" : "default"}
        onConfirm={executeBan}
        onCancel={() => setBanConfirmOpen(false)}
        loading={banLoading}
      />
    </div>
  );
}
