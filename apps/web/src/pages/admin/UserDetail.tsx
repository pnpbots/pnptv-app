import React, { useState, useEffect, useCallback } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { ConfirmModal } from "@/components/admin/ConfirmModal";
import { useI18n } from "@/lib/i18n";
import { STATUS_BADGE_VARIANTS, formatDateShort } from "@/components/admin/shared";
import { Badge } from "@pnptv/ui-kit";
import { UserEntitlementsSection } from "@/components/admin/UserEntitlementsSection";
import { UserCreatorSection } from "@/components/admin/UserCreatorSection";
import {
  getAdminUser,
  getAdminPlans,
  updateAdminUser,
  assignAdminUserPlan,
  banAdminUser,
  deleteAdminUser,
  getAdminUserPayments,
  getUserLabel,
  getLabelColor,
  type AdminUser,
  type AdminPlan,
  type AdminPayment,
} from "@/lib/api";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function avatarLetter(user: AdminUser): string {
  const name = user.first_name || user.username || user.email || "?";
  return name[0].toUpperCase();
}

// ---------------------------------------------------------------------------
// Inline SVGs (no external icon library)
// ---------------------------------------------------------------------------

function IconChevronLeft() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.75 19.5L8.25 12l7.5-7.5" />
    </svg>
  );
}

// CopyField — click/tap to copy, long-press selects all text
function CopyField({ label, value }: { label: string; value?: string | null }) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;
  const copy = () => {
    navigator.clipboard.writeText(value).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="text-[10px] uppercase tracking-wider text-pnp-textSecondary flex-shrink-0 w-20 text-right">{label}</span>
      <button
        onClick={copy}
        title="Click to copy"
        className="flex-1 min-w-0 text-left text-xs font-mono text-pnp-textPrimary bg-pnp-background rounded px-2 py-1 truncate hover:bg-pnp-border transition-colors select-all"
      >
        {copied ? <span className="text-green-400">Copied!</span> : value}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Edit form type
// ---------------------------------------------------------------------------

interface EditForm {
  username: string;
  email: string;
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function UserDetail() {
  const t = useI18n().admin;
  const { id: userId } = useParams<{ id: string }>();
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
  });

  // Assign-plan one-shot: pick a plan and the backend grants entitlements,
  // syncs tier + subscription_status + plan_expiry.
  const [assignPlanId, setAssignPlanId] = useState("");
  const [assignLoading, setAssignLoading] = useState(false);

  const [banReason, setBanReason] = useState("");
  const [banConfirmOpen, setBanConfirmOpen] = useState(false);
  const [banAction, setBanAction] = useState<"ban" | "unban">("ban");
  const [banLoading, setBanLoading] = useState(false);

  // Payment history
  const [payments, setPayments] = useState<AdminPayment[]>([]);
  const [paymentsLoading, setPaymentsLoading] = useState(false);
  const [paymentsPage, setPaymentsPage] = useState(1);
  const [paymentsTotalPages, setPaymentsTotalPages] = useState(1);
  const [paymentsTotal, setPaymentsTotal] = useState(0);

  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);

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
      });
      setAssignPlanId(userRes.user.subscription_plan || "");
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.shared.failedToLoad);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  const loadPayments = useCallback(async (p: number) => {
    if (!userId) return;
    setPaymentsLoading(true);
    try {
      const res = await getAdminUserPayments(userId, p);
      setPayments(res.payments);
      setPaymentsTotalPages(res.pagination.totalPages);
      setPaymentsTotal(res.pagination.total);
    } catch { /* silent */ } finally {
      setPaymentsLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    loadPayments(paymentsPage);
  }, [loadPayments, paymentsPage]);

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
      });
      setUser((prev) => (prev ? { ...prev, ...res.user } : res.user));
      setSaveSuccess(true);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.userDetail.failedToSave);
    } finally {
      setSaveLoading(false);
    }
  };

  const handleAssignPlan = async () => {
    if (!userId || !assignPlanId) return;
    setAssignLoading(true);
    setSaveSuccess(false);
    try {
      const res = await assignAdminUserPlan(userId, assignPlanId);
      setUser(res.user);
      setSaveSuccess(true);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.userDetail.failedToSave);
    } finally {
      setAssignLoading(false);
    }
  };

  // Force a full refetch of the user record. Used after granting/revoking an
  // entitlement so the header badge reflects the new tier immediately.
  const refreshUser = useCallback(async () => {
    if (!userId) return;
    try {
      const res = await getAdminUser(userId);
      setUser(res.user);
    } catch { /* silent — entitlements section already shows the change */ }
  }, [userId]);

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
      setUser((prev) => (prev ? { ...prev, ...res.user } : res.user));
      setBanConfirmOpen(false);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.userDetail.banFailed);
      setBanConfirmOpen(false);
    } finally {
      setBanLoading(false);
    }
  };

  const executeDelete = async () => {
    if (!userId) return;
    setDeleteLoading(true);
    try {
      await deleteAdminUser(userId);
      setDeleteConfirmOpen(false);
      navigate("/admin/users");
    } catch (err) {
      setError(err instanceof Error ? err.message : t.userDetail.deleteFailed);
      setDeleteConfirmOpen(false);
    } finally {
      setDeleteLoading(false);
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
        <p className="text-pnp-textSecondary">{error || t.userDetail.userNotFound}</p>
        <Link to="/admin/users" className="mt-4 inline-block text-sm text-pnp-accent hover:underline">
          {t.userDetail.backToUsers}
        </Link>
      </div>
    );
  }

  const isBanned = user.tier === "banned";

  return (
    <div className="page-container space-y-6">
      {/* Back link */}
      <Link
        to="/admin/users"
        className="flex items-center gap-1.5 text-sm text-pnp-textSecondary hover:text-pnp-textPrimary transition-colors w-fit"
      >
        <IconChevronLeft />
        {t.userDetail.backToUsers}
      </Link>

      {error && (
        <div className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">
          {error}
          <button onClick={() => setError(null)} className="ml-2 text-red-400 hover:text-red-300">
            {t.shared.dismiss}
          </button>
        </div>
      )}

      {saveSuccess && (
        <div className="px-4 py-3 rounded-lg bg-green-500/10 border border-green-500/20 text-sm text-green-400">
          {t.userDetail.changesSaved}
        </div>
      )}

      {/* User header */}
      <div className="rounded-xl bg-pnp-surface border border-pnp-border p-5 space-y-4">
        <div className="flex items-start gap-4">
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center text-xl font-bold text-white flex-shrink-0"
            style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
          >
            {avatarLetter(user)}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <h1 className="text-xl font-bold text-pnp-textPrimary select-all">
                {user.first_name
                  ? `${user.first_name}${user.last_name ? " " + user.last_name : ""}`
                  : user.username || "Unknown"}
              </h1>
              {user.tier && (() => {
                const lbl = getUserLabel(user);
                const legacyTier = user.tier.toLowerCase();
                const showLegacy = lbl !== 'FREE' && legacyTier !== lbl.toLowerCase() && legacyTier !== 'banned';
                return (
                  <>
                    <span
                      className={`inline-flex items-center text-xs font-bold px-2 py-0.5 rounded-full border ${getLabelColor(lbl)}`}
                    >
                      {lbl}
                    </span>
                    {showLegacy && (
                      <span className="text-xs text-pnp-textSecondary">
                        (legacy: {user.tier})
                      </span>
                    )}
                    {legacyTier === 'banned' && (
                      <Badge variant="error">banned</Badge>
                    )}
                  </>
                );
              })()}
              {user.subscription_status && (
                <Badge variant={STATUS_BADGE_VARIANTS[user.subscription_status] ?? "default"}>
                  {user.subscription_status}
                </Badge>
              )}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-pnp-textSecondary">
              {user.role && <span className="capitalize">{user.role}</span>}
              {user.language && <span>🌐 {user.language.toUpperCase()}</span>}
              {user.location_name && <span>📍 {user.location_name}</span>}
              {user.last_login_at && (
                <span>Last login: {formatDateShort(user.last_login_at)}{user.last_login_method ? ` via ${user.last_login_method}` : ""}</span>
              )}
              {user.last_active && <span>Last active: {formatDateShort(user.last_active)}</span>}
            </div>
          </div>
        </div>

        {/* Copyable identity fields */}
        <div className="border-t border-pnp-border pt-3 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          <CopyField label={t.userDetail.id} value={user.id} />
          <CopyField label={t.userDetail.pnptvId} value={user.pnptv_id} />
          <CopyField label={t.userDetail.username} value={user.username} />
          <CopyField label={t.userDetail.email} value={user.email} />
          {user.telegram && <CopyField label="Telegram" value={user.telegram} />}
          {user.twitter && <CopyField label={t.userDetail.twitterX} value={user.x_username || user.twitter} />}
          {user.last_payment_date && (
            <CopyField label={t.userDetail.lastPaid} value={`${formatDateShort(user.last_payment_date)}${user.last_payment_amount ? ` · $${Number(user.last_payment_amount).toFixed(2)}` : ""}${user.last_payment_method ? ` · ${user.last_payment_method}` : ""}`} />
          )}
          {user.plan_expiry && <CopyField label={t.userDetail.expires} value={formatDateShort(user.plan_expiry)} />}
          <CopyField label="Joined" value={formatDateShort(user.created_at)} />
        </div>
      </div>

      {/* Edit identity (username + email only) */}
      <div className="rounded-xl bg-pnp-surface border border-pnp-border p-5 space-y-4">
        <h2 className="text-sm font-semibold text-pnp-textSecondary uppercase tracking-wider">
          {t.userDetail.editUser}
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-pnp-textSecondary mb-1" htmlFor="edit-username">
              {t.userDetail.username}
            </label>
            <input
              id="edit-username"
              type="text"
              value={editForm.username}
              onChange={(e) => handleFormChange("username", e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-pnp-border bg-pnp-background text-pnp-textPrimary focus:outline-none focus:border-pnp-accent" style={{ fontSize: "16px" }}
            />
          </div>
          <div>
            <label className="block text-xs text-pnp-textSecondary mb-1" htmlFor="edit-email">
              {t.userDetail.email}
            </label>
            <input
              id="edit-email"
              type="email"
              value={editForm.email}
              onChange={(e) => handleFormChange("email", e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-pnp-border bg-pnp-background text-pnp-textPrimary focus:outline-none focus:border-pnp-accent" style={{ fontSize: "16px" }}
            />
          </div>
        </div>

        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={saveLoading}
            className="px-5 py-2 rounded-lg bg-pnp-accent text-white text-sm font-medium hover:bg-pnp-accent/80 disabled:opacity-50 transition-colors min-h-[44px]"
          >
            {saveLoading ? t.shared.saving : t.userDetail.saveChanges}
          </button>
        </div>
      </div>

      {/* Assign plan — one-shot. Picks an active plan and the backend grants
          all entitlements + computes plan_expiry + syncs tier/status. */}
      <div className="rounded-xl bg-pnp-surface border border-pnp-border p-5 space-y-3">
        <h2 className="text-sm font-semibold text-pnp-textSecondary uppercase tracking-wider">
          {t.userDetail.subscriptionPlan}
        </h2>
        <p className="text-xs text-pnp-textSecondary">
          Pick an active plan. Tier, status, expiry, and entitlements are set automatically.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
          <div className="flex-1 min-w-0">
            <label className="block text-xs text-pnp-textSecondary mb-1" htmlFor="assign-plan">
              {t.userDetail.subscriptionPlan}
            </label>
            <select
              id="assign-plan"
              value={assignPlanId}
              onChange={(e) => { setAssignPlanId(e.target.value); setSaveSuccess(false); }}
              className="w-full px-3 py-2 rounded-lg border border-pnp-border bg-pnp-background text-pnp-textPrimary focus:outline-none focus:border-pnp-accent" style={{ fontSize: "16px" }}
            >
              <option value="">{t.userDetail.noOption}</option>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.display_name} ({p.tier})
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={handleAssignPlan}
            disabled={assignLoading || !assignPlanId || assignPlanId === (user.subscription_plan || "")}
            className="px-5 py-2 rounded-lg bg-pnp-accent text-white text-sm font-medium hover:bg-pnp-accent/80 disabled:opacity-50 transition-colors min-h-[44px] sm:flex-shrink-0"
          >
            {assignLoading ? t.shared.saving : "Assign Plan"}
          </button>
        </div>
        {user.subscription_plan && (
          <p className="text-xs text-pnp-textSecondary">
            Current: <span className="font-mono text-pnp-textPrimary">{user.subscription_plan}</span>
            {user.plan_expiry && <> · expires {formatDateShort(user.plan_expiry)}</>}
          </p>
        )}
      </div>

      {/* Entitlements section */}
      {userId && <UserEntitlementsSection userId={userId} onChanged={refreshUser} />}

      {/* Creator & Live Performer section */}
      {user && (
        <UserCreatorSection
          user={user}
          onUpdated={(patch) => setUser((prev) => (prev ? { ...prev, ...patch } : prev))}
        />
      )}

      {/* Payment History */}
      <div className="rounded-xl bg-pnp-surface border border-pnp-border p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-pnp-textSecondary uppercase tracking-wider">
            {t.userDetail.paymentHistory}
          </h2>
          {paymentsTotal > 0 && (
            <span className="text-xs text-pnp-textSecondary">
              {t.userDetail.transactionCount.replace("{0}", String(paymentsTotal))}
            </span>
          )}
        </div>

        {paymentsLoading ? (
          <div className="py-6 text-center text-pnp-textSecondary text-sm">{t.userDetail.loadingPayments}</div>
        ) : payments.length === 0 ? (
          <p className="text-sm text-pnp-textSecondary py-4 text-center">{t.userDetail.noPayments}</p>
        ) : (
          <>
            <div className="overflow-x-auto -mx-5 px-5">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-pnp-border">
                    <th className="text-left py-2 pr-3 text-pnp-textSecondary font-medium uppercase tracking-wider whitespace-nowrap">{t.userDetail.date}</th>
                    <th className="text-left py-2 pr-3 text-pnp-textSecondary font-medium uppercase tracking-wider whitespace-nowrap">{t.userDetail.method}</th>
                    <th className="text-left py-2 pr-3 text-pnp-textSecondary font-medium uppercase tracking-wider whitespace-nowrap">{t.shared.plan}</th>
                    <th className="text-right py-2 pr-3 text-pnp-textSecondary font-medium uppercase tracking-wider whitespace-nowrap">{t.userDetail.amount}</th>
                    <th className="text-left py-2 text-pnp-textSecondary font-medium uppercase tracking-wider whitespace-nowrap">{t.shared.status}</th>
                    <th className="text-left py-2 pl-3 text-pnp-textSecondary font-medium uppercase tracking-wider whitespace-nowrap">{t.userDetail.reference}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-pnp-border/50">
                  {payments.map((p) => (
                    <tr key={p.id} className="hover:bg-pnp-background/50 transition-colors">
                      <td className="py-2.5 pr-3 text-pnp-textSecondary whitespace-nowrap">{formatDateShort(p.payment_date)}</td>
                      <td className="py-2.5 pr-3 text-pnp-textPrimary font-medium capitalize whitespace-nowrap">{p.payment_method}</td>
                      <td className="py-2.5 pr-3 text-pnp-textSecondary whitespace-nowrap">{p.plan_name || p.product || "—"}</td>
                      <td className="py-2.5 pr-3 text-pnp-textPrimary font-mono text-right whitespace-nowrap">
                        {p.currency} {Number(p.amount).toFixed(2)}
                      </td>
                      <td className="py-2.5 whitespace-nowrap">
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                          p.status === "completed" ? "bg-green-500/15 text-green-400" :
                          p.status === "failed" ? "bg-red-500/15 text-red-400" :
                          "bg-yellow-500/15 text-yellow-400"
                        }`}>
                          {p.status}
                        </span>
                      </td>
                      <td className="py-2.5 pl-3 text-pnp-textSecondary font-mono select-all max-w-[140px] truncate" title={p.payment_reference}>
                        {p.payment_reference}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {paymentsTotalPages > 1 && (
              <div className="flex items-center justify-between pt-2">
                <button
                  onClick={() => setPaymentsPage((p) => Math.max(1, p - 1))}
                  disabled={paymentsPage <= 1}
                  className="px-3 py-1.5 text-xs rounded-lg border border-pnp-border text-pnp-textSecondary hover:text-pnp-textPrimary hover:bg-pnp-surface disabled:opacity-40 transition-colors"
                >
                  {t.userDetail.prevPage}
                </button>
                <span className="text-xs text-pnp-textSecondary">
                  {t.userDetail.pageOf.replace("{0}", String(paymentsPage)).replace("{1}", String(paymentsTotalPages))}
                </span>
                <button
                  onClick={() => setPaymentsPage((p) => Math.min(paymentsTotalPages, p + 1))}
                  disabled={paymentsPage >= paymentsTotalPages}
                  className="px-3 py-1.5 text-xs rounded-lg border border-pnp-border text-pnp-textSecondary hover:text-pnp-textPrimary hover:bg-pnp-surface disabled:opacity-40 transition-colors"
                >
                  {t.userDetail.nextPage}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Ban / Unban Section */}
      <div className="rounded-xl bg-red-500/5 border border-red-500/20 p-5 space-y-3">
        <h2 className="text-sm font-semibold text-red-400 uppercase tracking-wider">
          {isBanned ? t.userDetail.unbanUser : t.userDetail.banUser}
        </h2>
        <p className="text-xs text-pnp-textSecondary">
          {isBanned
            ? t.userDetail.bannedText
            : t.userDetail.banWarning}
        </p>
        {!isBanned && (
          <div>
            <label className="block text-xs text-pnp-textSecondary mb-1" htmlFor="ban-reason">
              {t.userDetail.banReason}
            </label>
            <textarea
              id="ban-reason"
              value={banReason}
              onChange={(e) => setBanReason(e.target.value)}
              rows={2}
              placeholder={t.userDetail.banReasonPlaceholder}
              className="w-full px-3 py-2 rounded-lg border border-pnp-border bg-pnp-background text-pnp-textPrimary text-sm focus:outline-none focus:border-red-500/50 resize-none"
            />
          </div>
        )}
        <div className="flex justify-end">
          <button
            onClick={() => openBanModal(isBanned ? "unban" : "ban")}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors min-h-[44px] ${
              isBanned
                ? "bg-green-500/10 text-green-400 border border-green-500/20 hover:bg-green-500/20"
                : "bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20"
            }`}
          >
            {isBanned ? t.userDetail.unbanUser : t.userDetail.banUser}
          </button>
        </div>
      </div>

      {/* Delete User Section */}
      <div className="rounded-xl bg-red-500/5 border border-red-500/20 p-5 space-y-3">
        <h2 className="text-sm font-semibold text-red-400 uppercase tracking-wider">
          {t.userDetail.deleteUser}
        </h2>
        <p className="text-xs text-pnp-textSecondary">
          {t.userDetail.deleteWarning}
        </p>
        <div className="flex justify-end">
          <button
            onClick={() => setDeleteConfirmOpen(true)}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-colors min-h-[44px] bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20"
          >
            {t.userDetail.deleteUser}
          </button>
        </div>
      </div>

      <ConfirmModal
        open={banConfirmOpen}
        title={banAction === "ban" ? t.userDetail.banUser : t.userDetail.unbanUser}
        message={
          banAction === "ban"
            ? `${t.userDetail.banConfirm.replace("{0}", user.username || user.id)}${banReason ? ` Reason: "${banReason}"` : ""}`
            : t.userDetail.unbanConfirm.replace("{0}", user.username || user.id)
        }
        confirmLabel={banAction === "ban" ? t.userDetail.banUser : t.userDetail.unbanUser}
        variant={banAction === "ban" ? "danger" : "default"}
        onConfirm={executeBan}
        onCancel={() => setBanConfirmOpen(false)}
        loading={banLoading}
      />

      <ConfirmModal
        open={deleteConfirmOpen}
        title={t.userDetail.deleteUser}
        message={t.userDetail.deleteConfirm.replace("{0}", user.username || user.id)}
        confirmLabel={t.userDetail.deleteUser}
        variant="danger"
        onConfirm={executeDelete}
        onCancel={() => setDeleteConfirmOpen(false)}
        loading={deleteLoading}
      />
    </div>
  );
}
