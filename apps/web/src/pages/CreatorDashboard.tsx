import React, { useState, useEffect, useCallback, lazy, Suspense } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { CreatorAvailabilitySettings } from "@/components/creators";
import {
  getCreatorEligibility,
  getCreatorDashboard,
  activateCreator,
  getModelEarnings,
  getWithdrawableAmount,
  requestWithdrawal,
  getWithdrawalHistory,
  getCreatorWallet,
  saveCreatorWallet,
  changeCreatorTier,
  getCmsProfile,
  updateCmsProfile,
  listCmsContent,
  createCmsContent,
  updateCmsContent,
  deleteCmsContent,
  listCmsShows,
  createCmsShow,
  updateCmsShow,
  deleteCmsShow,
  uploadCmsMedia,
  createSocialPost,
  getMyCallPackages,
  createMyCallPackage,
  updateMyCallPackage,
  deactivateMyCallPackage,
  getCreatorCallBookings,
  getCreatorCallEarnings,
  type CreatorEligibility,
  type CreatorDashboard as DashboardData,
  type ModelEarnings,
  type ModelWithdrawal,
  type CmsPerformer,
  type CmsContent,
  type CmsShow,
  type CallPackage,
  type CreatorCallBooking,
  type CreatorCallEarnings,
} from "@/lib/api";
import { useI18n } from "@/lib/i18n";

const BrowserStreamer = lazy(() => import("@/components/BrowserStreamer"));

const ETHEREUM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

const TIERS: { key: "ice" | "crystal" | "diamond"; label: string; price: number; emoji: string }[] = [
  { key: "ice", label: "Ice", price: 5, emoji: "❄" },
  { key: "crystal", label: "Crystal", price: 10, emoji: "🔮" },
  { key: "diamond", label: "Diamond", price: 15, emoji: "💎" },
];

// ─── Call Package Manager ─────────────────────────────────────────────────────

function CallPackageManager() {
  const [packages, setPackages] = useState<CallPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create form state
  const [duration, setDuration] = useState<30 | 60>(30);
  const [quantity, setQuantity] = useState(1);
  const [price, setPrice] = useState("");
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Edit state: packageId -> { priceUsd, title }
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editPrice, setEditPrice] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const loadPackages = useCallback(() => {
    setLoading(true);
    setError(null);
    getMyCallPackages()
      .then((res) => setPackages(res.packages))
      .catch((err) => setError(err.message || "Failed to load packages"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadPackages();
  }, [loadPackages]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const priceNum = parseFloat(price);
    if (isNaN(priceNum) || priceNum <= 0 || priceNum > 1000) {
      setCreateError("Price must be between $0.01 and $1000");
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      await createMyCallPackage({
        durationMinutes: duration,
        quantity,
        priceUsd: priceNum,
        title: title.trim() || undefined,
      });
      setPrice("");
      setTitle("");
      setQuantity(1);
      setDuration(30);
      loadPackages();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to create package";
      setCreateError(msg);
    } finally {
      setCreating(false);
    }
  };

  const startEdit = (pkg: CallPackage) => {
    setEditingId(pkg.id);
    setEditPrice(String(parseFloat(pkg.price_usd)));
    setEditTitle(pkg.title ?? "");
    setSaveError(null);
  };

  const handleSave = async (pkg: CallPackage) => {
    const priceNum = parseFloat(editPrice);
    if (isNaN(priceNum) || priceNum <= 0 || priceNum > 1000) {
      setSaveError("Price must be between $0.01 and $1000");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await updateMyCallPackage(pkg.id, {
        priceUsd: priceNum,
        title: editTitle.trim() || undefined,
      });
      setEditingId(null);
      loadPackages();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to save changes";
      setSaveError(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleDeactivate = async (pkg: CallPackage) => {
    if (!confirm(`Deactivate "${pkg.title || `${pkg.duration_minutes}min x${pkg.quantity}`}"? Members with existing credits will keep them.`)) return;
    try {
      await deactivateMyCallPackage(pkg.id);
      loadPackages();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to deactivate";
      setError(msg);
    }
  };

  return (
    <div className="space-y-4 mt-6">
      <p className="text-sm font-semibold text-white">Call Packages</p>

      {/* Create form */}
      <div className="glass-card-sm p-4">
        <p className="text-xs font-semibold text-white/70 mb-3 uppercase tracking-wide">New Package</p>
        <form onSubmit={handleCreate} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-white/50 mb-1">Duration</label>
              <select
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value) as 30 | 60)}
                className="w-full px-3 py-2 rounded-lg text-sm text-white bg-white/5 border border-white/10 focus:outline-none focus:border-pnp-accent"
              >
                <option value={30}>30 minutes</option>
                <option value={60}>60 minutes</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-white/50 mb-1">Quantity</label>
              <input
                type="number"
                min={1}
                max={20}
                value={quantity}
                onChange={(e) => setQuantity(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg text-sm text-white bg-white/5 border border-white/10 focus:outline-none focus:border-pnp-accent"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-white/50 mb-1">Price (USD)</label>
              <input
                type="number"
                min={0.01}
                max={1000}
                step={0.01}
                placeholder="e.g. 49.99"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="w-full px-3 py-2 rounded-lg text-sm text-white bg-white/5 border border-white/10 focus:outline-none focus:border-pnp-accent"
                required
              />
            </div>
            <div>
              <label className="block text-xs text-white/50 mb-1">Title (optional)</label>
              <input
                type="text"
                maxLength={80}
                placeholder="e.g. Intro Session"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-3 py-2 rounded-lg text-sm text-white bg-white/5 border border-white/10 focus:outline-none focus:border-pnp-accent"
              />
            </div>
          </div>
          {createError && <p className="text-xs text-red-400">{createError}</p>}
          <button
            type="submit"
            disabled={creating}
            className="w-full py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
            style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
          >
            {creating ? "Creating…" : "Create Package"}
          </button>
        </form>
      </div>

      {/* Package list */}
      {loading ? (
        <p className="text-xs text-white/40 text-center py-4">Loading packages…</p>
      ) : error ? (
        <p className="text-xs text-red-400 text-center py-4">{error}</p>
      ) : packages.length === 0 ? (
        <p className="text-xs text-white/40 text-center py-4">No active packages yet.</p>
      ) : (
        <div className="space-y-3">
          {packages.map((pkg) => (
            <div key={pkg.id} className="glass-card-sm p-4">
              {editingId === pkg.id ? (
                <div className="space-y-3">
                  <p className="text-xs text-white/50">
                    {pkg.duration_minutes} min · x{pkg.quantity}
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-white/50 mb-1">Price (USD)</label>
                      <input
                        type="number"
                        min={0.01}
                        max={1000}
                        step={0.01}
                        value={editPrice}
                        onChange={(e) => setEditPrice(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg text-sm text-white bg-white/5 border border-white/10 focus:outline-none focus:border-pnp-accent"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-white/50 mb-1">Title</label>
                      <input
                        type="text"
                        maxLength={80}
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg text-sm text-white bg-white/5 border border-white/10 focus:outline-none focus:border-pnp-accent"
                      />
                    </div>
                  </div>
                  {saveError && <p className="text-xs text-red-400">{saveError}</p>}
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleSave(pkg)}
                      disabled={saving}
                      className="flex-1 py-2 rounded-xl text-xs font-semibold text-white disabled:opacity-50"
                      style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
                    >
                      {saving ? "Saving…" : "Save"}
                    </button>
                    <button
                      onClick={() => { setEditingId(null); setSaveError(null); }}
                      className="flex-1 py-2 rounded-xl text-xs text-white/60 border border-white/10 hover:bg-white/5"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    {pkg.title && (
                      <p className="text-sm font-semibold text-white truncate">{pkg.title}</p>
                    )}
                    <p className="text-xs text-white/50 mt-0.5">
                      {pkg.duration_minutes} min · {pkg.quantity} session{pkg.quantity !== 1 ? "s" : ""}
                    </p>
                    <p className="text-base font-bold mt-1" style={{ color: "#5ED1C4" }}>
                      ${parseFloat(pkg.price_usd).toFixed(2)}
                    </p>
                    <p className="text-xs text-white/30 mt-0.5 font-mono">{pkg.sku}</p>
                  </div>
                  <div className="flex flex-col gap-2 flex-shrink-0">
                    <button
                      onClick={() => startEdit(pkg)}
                      className="px-3 py-1.5 rounded-lg text-xs text-white/70 border border-white/10 hover:bg-white/5 transition-colors"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDeactivate(pkg)}
                      className="px-3 py-1.5 rounded-lg text-xs text-red-400 border border-red-400/20 hover:bg-red-400/10 transition-colors"
                    >
                      Deactivate
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Call Earnings Summary ─────────────────────────────────────────────────────

function CallEarningsSummary() {
  const [earnings, setEarnings] = useState<CreatorCallEarnings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getCreatorCallEarnings()
      .then((res) => {
        if (res.success) setEarnings(res.earnings);
        else setError("Failed to load call earnings");
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load call earnings"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="glass-card-sm p-4 mb-4">
        <p className="text-xs font-semibold text-white/70 mb-3 uppercase tracking-wide">Call Earnings</p>
        <div className="grid grid-cols-3 gap-2">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="animate-pulse h-14 rounded-lg bg-white/5" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !earnings) {
    return null;
  }

  const stats: { label: string; value: string }[] = [
    { label: "Revenue", value: `$${earnings.totalRevenue.toFixed(2)}` },
    { label: "Purchases", value: String(earnings.totalPurchases) },
    { label: "Calls Sold", value: String(earnings.totalCallsSold) },
    { label: "Completed", value: String(earnings.totalCallsCompleted) },
    { label: "Scheduled", value: String(earnings.totalCallsScheduled) },
    {
      label: earnings.totalReviews > 0 ? `Rating (${earnings.totalReviews})` : "Rating",
      value: earnings.totalReviews > 0 ? `${earnings.averageRating.toFixed(1)} ★` : "—",
    },
  ];

  return (
    <div className="glass-card-sm p-4 mb-4">
      <p className="text-xs font-semibold text-white/70 mb-3 uppercase tracking-wide">Call Earnings</p>
      <div className="grid grid-cols-3 gap-2">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="rounded-xl px-3 py-2.5 text-center"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}
          >
            <p className="text-base font-bold text-white leading-tight">{stat.value}</p>
            <p className="text-xs mt-0.5" style={{ color: "#8E8E93" }}>{stat.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Upcoming Bookings ─────────────────────────────────────────────────────────

const BOOKING_STATUS_LABELS: Record<CreatorCallBooking["status"], { label: string; color: string }> = {
  unused:   { label: "Unused",    color: "#5ED1C4" },
  partial:  { label: "Partial",   color: "#E69138" },
  completed:{ label: "Completed", color: "#8E8E93" },
  expired:  { label: "Expired",   color: "#8E8E93" },
  refunded: { label: "Refunded",  color: "#EF4444" },
};

function UpcomingBookings() {
  const [bookings, setBookings] = useState<CreatorCallBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getCreatorCallBookings("upcoming")
      .then((res) => {
        if (res.success) setBookings(res.bookings.slice(0, 5));
        else setError("Failed to load bookings");
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load bookings"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="glass-card-sm p-4 mb-4">
      <p className="text-xs font-semibold text-white/70 mb-3 uppercase tracking-wide">Upcoming Bookings</p>

      {loading ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="animate-pulse h-12 rounded-lg bg-white/5" />
          ))}
        </div>
      ) : error ? (
        <p className="text-xs text-red-400 py-2">{error}</p>
      ) : bookings.length === 0 ? (
        <p className="text-xs py-4 text-center" style={{ color: "#8E8E93" }}>No upcoming bookings</p>
      ) : (
        <div className="space-y-2">
          {bookings.map((booking) => {
            const statusInfo = BOOKING_STATUS_LABELS[booking.status] ?? { label: booking.status, color: "#8E8E93" };
            const memberName = booking.member_display_name || booking.member_username || "Member";
            const initials = memberName.charAt(0).toUpperCase();
            const remaining = booking.quantity_total - booking.quantity_used - booking.quantity_scheduled;
            const purchasedAt = new Date(booking.created_at);
            const dateStr = purchasedAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

            return (
              <div
                key={booking.id}
                className="flex items-center gap-3 py-2.5 px-3 rounded-xl"
                style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
              >
                {/* Member avatar */}
                {booking.member_photo ? (
                  <img
                    src={booking.member_photo}
                    alt={memberName}
                    className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                  />
                ) : (
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0"
                    style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
                  >
                    {initials}
                  </div>
                )}

                {/* Booking info */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">{memberName}</p>
                  <p className="text-xs" style={{ color: "#8E8E93" }}>
                    {booking.duration_minutes} min &middot; {remaining} call{remaining !== 1 ? "s" : ""} remaining &middot; {dateStr}
                  </p>
                </div>

                {/* Status badge */}
                <span
                  className="flex-shrink-0 text-xs font-semibold px-2 py-0.5 rounded-full"
                  style={{
                    color: statusInfo.color,
                    background: `${statusInfo.color}1A`,
                    border: `1px solid ${statusInfo.color}33`,
                  }}
                >
                  {statusInfo.label}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CriterionBar({ label, current, required, met }: { label: string; current: number; required: number; met: boolean }) {
  const pct = Math.min((current / required) * 100, 100);
  return (
    <div className="mb-3">
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="text-white/80">{label}</span>
        <span style={{ color: met ? "#5ED1C4" : "#8E8E93" }}>
          {current}/{required} {met ? "\u2713" : ""}
        </span>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${pct}%`,
            background: met ? "#5ED1C4" : "linear-gradient(to right, #D4007A, #E69138)",
          }}
        />
      </div>
    </div>
  );
}

export default function CreatorDashboard() {
  const { user, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const { creator: t } = useI18n();

  const [eligibility, setEligibility] = useState<CreatorEligibility | null>(null);
  const [dashboard, setDashboard] = useState<(DashboardData & { success: boolean }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Earnings & withdrawal state
  const [earnings, setEarnings] = useState<ModelEarnings | null>(null);
  const [withdrawable, setWithdrawable] = useState<number>(0);
  const [withdrawals, setWithdrawals] = useState<ModelWithdrawal[]>([]);
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const [withdrawSuccess, setWithdrawSuccess] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"overview" | "earnings" | "payouts" | "settings" | "content" | "golive" | "availability">("overview");

  // Settings tab — payout method
  const [payoutMethod, setPayoutMethod] = useState<"crypto" | "meru">("crypto");
  const [walletAddress, setWalletAddress] = useState<string>("");
  const [meruAccount, setMeruAccount] = useState<string>("");
  const [walletLoading, setWalletLoading] = useState(false);
  const [walletSaving, setWalletSaving] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [walletSuccess, setWalletSuccess] = useState<string | null>(null);

  // Activation modal state (eligible → active)
  const [showActivateModal, setShowActivateModal] = useState(false);
  const [activateTier] = useState<"ice" | "crystal" | "diamond">("ice");
  const [activateTerms, setActivateTerms] = useState(false);
  const [activating, setActivating] = useState(false);
  const [activateError, setActivateError] = useState<string | null>(null);

  // Settings tab — tier change
  const [selectedTier, setSelectedTier] = useState<"ice" | "crystal" | "diamond" | null>(null);
  const [tierChanging, setTierChanging] = useState(false);
  const [tierError, setTierError] = useState<string | null>(null);
  const [tierSuccess, setTierSuccess] = useState<string | null>(null);

  // Content (CMS) tab
  const [cmsPerformer, setCmsPerformer] = useState<CmsPerformer | null>(null);
  const [cmsContent, setCmsContent] = useState<CmsContent[]>([]);
  const [cmsShows, setCmsShows] = useState<CmsShow[]>([]);
  const [cmsLoading, setCmsLoading] = useState(false);
  const [cmsError, setCmsError] = useState<string | null>(null);
  const [cmsContentSection, setCmsContentSection] = useState<"profile" | "content" | "shows">("profile");

  // CMS profile edit form
  const [cmsProfileForm, setCmsProfileForm] = useState<Partial<CmsPerformer>>({});
  const [cmsProfileSaving, setCmsProfileSaving] = useState(false);
  const [cmsProfileMsg, setCmsProfileMsg] = useState<string | null>(null);

  // CMS content form (create/edit)
  const [contentModal, setContentModal] = useState<{ mode: "create" | "edit"; item?: CmsContent } | null>(null);
  const [contentForm, setContentForm] = useState<Partial<CmsContent>>({});
  const [contentSaving, setContentSaving] = useState(false);
  const [contentUploadFile, setContentUploadFile] = useState<File | null>(null);
  const [contentUploadProgress, setContentUploadProgress] = useState(false);

  // CMS show form (create/edit)
  const [showModal, setShowModal] = useState<{ mode: "create" | "edit"; item?: CmsShow } | null>(null);
  const [showForm, setShowForm] = useState<Partial<CmsShow>>({});
  const [showSaving, setShowSaving] = useState(false);

  // Inline error/confirm states (replaces browser alert/confirm)
  const [contentSaveError, setContentSaveError] = useState<string | null>(null);
  const [contentDeleteConfirm, setContentDeleteConfirm] = useState<number | null>(null);
  const [showSaveError, setShowSaveError] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<number | null>(null);

  // Share to Feed modal
  const [shareModal, setShareModal] = useState<{ text: string } | null>(null);
  const [sharePosting, setSharePosting] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [eligRes, dashRes] = await Promise.all([
        getCreatorEligibility(),
        getCreatorDashboard(),
      ]);
      setEligibility(eligRes);
      setDashboard(dashRes);

      // If active creator, also load model earnings data
      if (dashRes.creatorStatus === "active") {
        const [earningsRes, withdrawableRes, historyRes] = await Promise.allSettled([
          getModelEarnings(),
          getWithdrawableAmount(),
          getWithdrawalHistory(),
        ]);
        if (earningsRes.status === "fulfilled" && earningsRes.value.success) {
          setEarnings(earningsRes.value.data);
        }
        if (withdrawableRes.status === "fulfilled" && withdrawableRes.value.success) {
          setWithdrawable(withdrawableRes.value.data.withdrawable.amount);
        }
        if (historyRes.status === "fulfilled" && historyRes.value.success) {
          setWithdrawals(historyRes.value.data.withdrawals);
        }
        // Prefill wallet from dashboard data if available; otherwise fetch separately
        if (dashRes.walletAddress) {
          setWalletAddress(dashRes.walletAddress);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadWallet = useCallback(async () => {
    setWalletLoading(true);
    try {
      const res = await getCreatorWallet();
      if (res.success) {
        setPayoutMethod(res.payoutMethod || "crypto");
        setWalletAddress(res.address || "");
        setMeruAccount(res.meruAccount || "");
      }
    } catch {
      // Non-critical — silently ignore
    } finally {
      setWalletLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) load();
  }, [isAuthenticated, load]);

  // Load wallet when Settings tab is opened (to ensure freshness)
  useEffect(() => {
    if (activeTab === "settings" && dashboard?.creatorStatus === "active") {
      loadWallet();
      // Initialize selectedTier from dashboard
      if (dashboard.creatorType && ["ice", "crystal", "diamond"].includes(dashboard.creatorType)) {
        setSelectedTier(dashboard.creatorType as "ice" | "crystal" | "diamond");
      }
    }
  }, [activeTab, dashboard, loadWallet]);

  // Load CMS data when Content tab is opened
  useEffect(() => {
    if (activeTab !== "content" || dashboard?.creatorStatus !== "active") return;
    if (cmsPerformer) return; // already loaded
    setCmsLoading(true);
    setCmsError(null);
    Promise.all([getCmsProfile(), listCmsContent(), listCmsShows()])
      .then(([prof, cont, shows]) => {
        setCmsPerformer(prof.performer);
        setCmsProfileForm({
          name: prof.performer.name,
          bio: prof.performer.bio ?? "",
          bio_short: prof.performer.bio_short ?? "",
          categories: prof.performer.categories ?? [],
          is_available: prof.performer.is_available,
          availability_message: prof.performer.availability_message ?? "",
          base_price_cents: prof.performer.base_price_cents ?? null,
          currency: prof.performer.currency ?? "USD",
          timezone: prof.performer.timezone ?? "",
          social_links: prof.performer.social_links ?? {},
        });
        setCmsContent(cont.content);
        setCmsShows(shows.shows);
      })
      .catch((err) => setCmsError(err.message || t.errorFailedLoadCms))
      .finally(() => setCmsLoading(false));
  }, [activeTab, dashboard, cmsPerformer, t.errorFailedLoadCms]);

  const handleActivate = () => {
    setActivateError(null);
    setActivateTerms(false);
    setShowActivateModal(true);
  };

  const handleConfirmActivate = async () => {
    if (!activateTerms) {
      setActivateError(t.errorMustAcceptTerms);
      return;
    }
    setActivating(true);
    setActivateError(null);
    try {
      await activateCreator(activateTier, true);
      setShowActivateModal(false);
      await load();
    } catch (err) {
      setActivateError(err instanceof Error ? err.message : t.errorActivationFailed);
    } finally {
      setActivating(false);
    }
  };

  const handleWithdraw = async () => {
    setWithdrawing(true);
    setWithdrawError(null);
    setWithdrawSuccess(null);
    try {
      const res = await requestWithdrawal("bank_transfer");
      setWithdrawSuccess(t.withdrawAmount(res.data.withdrawal.amountUsd.toFixed(2)) + " requested successfully");
      await load();
    } catch (err) {
      setWithdrawError(err instanceof Error ? err.message : "Failed to request withdrawal");
    } finally {
      setWithdrawing(false);
    }
  };

  const handleSaveWallet = async () => {
    setWalletError(null);
    setWalletSuccess(null);

    if (payoutMethod === "crypto") {
      const trimmed = walletAddress.trim();
      if (!ETHEREUM_ADDRESS_RE.test(trimmed)) {
        setWalletError(t.errorInvalidAddress);
        return;
      }
      setWalletSaving(true);
      try {
        const res = await saveCreatorWallet({ payoutMethod: "crypto", address: trimmed });
        if (res.success) {
          setWalletSuccess(t.walletSavedCrypto);
          setWalletAddress(trimmed.toLowerCase());
        } else {
          setWalletError((res as { error?: string }).error || t.errorSaveWallet);
        }
      } catch (err) {
        setWalletError(err instanceof Error ? err.message : t.errorSaveWallet);
      } finally {
        setWalletSaving(false);
      }
    } else {
      const meru = meruAccount.trim();
      if (!meru) {
        setWalletError(t.errorMeruEmpty);
        return;
      }
      setWalletSaving(true);
      try {
        const res = await saveCreatorWallet({ payoutMethod: "meru", meruAccount: meru });
        if (res.success) {
          setWalletSuccess(t.walletSavedMeru);
          setMeruAccount(meru);
        } else {
          setWalletError((res as { error?: string }).error || t.errorSaveMeru);
        }
      } catch (err) {
        setWalletError(err instanceof Error ? err.message : t.errorSaveMeru);
      } finally {
        setWalletSaving(false);
      }
    }
  };

  const handleChangeTier = async () => {
    if (!selectedTier) return;
    setTierError(null);
    setTierSuccess(null);
    setTierChanging(true);
    try {
      const res = await changeCreatorTier(selectedTier);
      if (res.success) {
        setTierSuccess(`Tier changed to ${res.tier} ($${res.price.toFixed(2)}/mo) successfully.`);
        // Update local dashboard state so the overview reflects new tier immediately
        setDashboard((prev) => prev ? { ...prev, creatorType: res.tier, priceUsd: res.price } : prev);
      } else {
        setTierError((res as { error?: string }).error || "Failed to change tier.");
      }
    } catch (err) {
      setTierError(err instanceof Error ? err.message : "Failed to change tier.");
    } finally {
      setTierChanging(false);
    }
  };

  // ── CMS handlers ──────────────────────────────────────────────────────────

  const handleCmsProfileSave = async () => {
    setCmsProfileSaving(true);
    setCmsProfileMsg(null);
    try {
      const res = await updateCmsProfile(cmsProfileForm);
      setCmsPerformer(res.performer);
      setCmsProfileMsg(t.profileUpdated);
    } catch (err) {
      setCmsProfileMsg(err instanceof Error ? err.message : t.profileSaveFailed);
    } finally {
      setCmsProfileSaving(false);
    }
  };

  const openContentCreate = () => {
    setContentForm({ status: "draft", type: "video", tags: [], is_premium: false });
    setContentUploadFile(null);
    setContentModal({ mode: "create" });
  };

  const openContentEdit = (item: CmsContent) => {
    setContentForm({ ...item });
    setContentUploadFile(null);
    setContentModal({ mode: "edit", item });
  };

  const handleContentSave = async () => {
    if (!contentForm.title || !contentForm.type) return;
    setContentSaving(true);
    try {
      let mediaUrl = contentForm.media_url;
      if (contentUploadFile) {
        setContentUploadProgress(true);
        const uploaded = await uploadCmsMedia(contentUploadFile);
        mediaUrl = uploaded.url;
        setContentUploadProgress(false);
      }
      setContentSaveError(null);
      const payload = { ...contentForm, media_url: mediaUrl };
      if (contentModal?.mode === "edit" && contentModal.item) {
        const res = await updateCmsContent(contentModal.item.id, payload);
        setCmsContent((prev) => prev.map((c) => c.id === res.content.id ? res.content : c));
      } else {
        const res = await createCmsContent(payload);
        setCmsContent((prev) => [res.content, ...prev]);
      }
      setContentModal(null);
    } catch (err) {
      setContentSaveError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setContentSaving(false);
      setContentUploadProgress(false);
    }
  };

  const handleContentDelete = (id: number) => {
    setContentDeleteConfirm(id);
  };

  const confirmContentDelete = async (id: number) => {
    setContentDeleteConfirm(null);
    try {
      await deleteCmsContent(id);
      setCmsContent((prev) => prev.filter((c) => c.id !== id));
    } catch (err) {
      setContentSaveError(err instanceof Error ? err.message : "Delete failed");
    }
  };

  const openShowCreate = () => {
    const dt = new Date(); dt.setDate(dt.getDate() + 1);
    setShowForm({ status: "draft", is_premium: false, scheduled_at: dt.toISOString().slice(0, 16) });
    setShowModal({ mode: "create" });
  };

  const openShowEdit = (item: CmsShow) => {
    setShowForm({ ...item, scheduled_at: item.scheduled_at?.slice(0, 16) });
    setShowModal({ mode: "edit", item });
  };

  const handleShowSave = async () => {
    if (!showForm.title || !showForm.scheduled_at) return;
    setShowSaving(true);
    try {
      if (showModal?.mode === "edit" && showModal.item) {
        const res = await updateCmsShow(showModal.item.id, showForm);
        setCmsShows((prev) => prev.map((s) => s.id === res.show.id ? res.show : s));
      } else {
        const res = await createCmsShow(showForm);
        setCmsShows((prev) => [...prev, res.show]);
      }
      setShowModal(null);
      setShowSaveError(null);
    } catch (err) {
      setShowSaveError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setShowSaving(false);
    }
  };

  const handleShowDelete = (id: number) => {
    setShowDeleteConfirm(id);
  };

  const confirmShowDelete = async (id: number) => {
    setShowDeleteConfirm(null);
    try {
      await deleteCmsShow(id);
      setCmsShows((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      setShowSaveError(err instanceof Error ? err.message : "Delete failed");
    }
  };

  const openShareModal = (text: string) => {
    setShareError(null);
    setShareModal({ text });
  };

  const handleConfirmShare = async () => {
    if (!shareModal?.text.trim()) return;
    setSharePosting(true);
    setShareError(null);
    try {
      await createSocialPost(shareModal.text.trim());
      setShareModal(null);
    } catch (err) {
      setShareError(err instanceof Error ? err.message : "Failed to post");
    } finally {
      setSharePosting(false);
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <p className="text-white/60">{t.signInRequired}</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-white/5 rounded w-48" />
          <div className="h-32 bg-white/5 rounded-lg" />
          <div className="h-32 bg-white/5 rounded-lg" />
        </div>
      </div>
    );
  }

  const isActive = dashboard?.creatorStatus === "active";
  const isEligible = dashboard?.creatorStatus === "eligible";
  const isPending = dashboard?.creatorStatus === "pending_review";

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-2 text-sm mb-4 hover:text-pnp-accent transition-colors"
        style={{ color: "#8E8E93" }}
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
        </svg>
        {t.back}
      </button>

      <h1 className="text-2xl font-bold text-white mb-1">{t.dashboardTitle}</h1>
      <p className="text-sm mb-4" style={{ color: "#8E8E93" }}>
        {t.dashboardSubtitle}
      </p>

      {/* Creator identity hero — shown only for active creators */}
      {isActive && dashboard && (() => {
        const tierInfo = TIERS.find((tier) => tier.key === dashboard.creatorType);
        const initials = (user?.displayName || user?.username || "C").charAt(0).toUpperCase();
        return (
          <div className="flex items-center gap-4 mb-6 px-4 py-3 rounded-2xl" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>
            <div className="w-12 h-12 rounded-full flex items-center justify-center text-xl font-bold flex-shrink-0 text-white" style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}>
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-bold text-white truncate">{user?.displayName || user?.username || "Creator"}</span>
                {dashboard.verified && (
                  <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="#5ED1C4">
                    <path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                )}
                {tierInfo && (
                  <span className="text-xs px-2 py-0.5 rounded-full font-semibold flex-shrink-0" style={{ background: "rgba(212,0,122,0.15)", color: "#D4007A" }}>
                    {tierInfo.emoji} {tierInfo.label}
                  </span>
                )}
              </div>
              <p className="text-xs mt-0.5" style={{ color: "#8E8E93" }}>
                {dashboard.subscriberCount} subscriber{dashboard.subscriberCount !== 1 ? "s" : ""} &middot; ${dashboard.priceUsd.toFixed(2)}/mo
              </p>
            </div>
          </div>
        );
      })()}

      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg text-sm text-red-300" style={{ background: "rgba(239,68,68,0.1)" }}>
          {error}
        </div>
      )}

      {/* ── Active Creator Dashboard ── */}
      {isActive && dashboard && (
        <>
          {/* Tab navigation */}
          <div className="flex overflow-x-auto border-b border-white/10 mb-4 scrollbar-hide">
            {(["overview", "earnings", "payouts", "content", "golive", "availability", "settings"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex-shrink-0 flex-1 min-w-[60px] py-3 text-xs font-semibold text-center transition-colors ${
                  activeTab === tab ? "text-white border-b-2" : "text-white/50"
                }`}
                style={activeTab === tab ? { borderImage: "linear-gradient(to right, #D4007A, #E69138) 1" } : undefined}
              >
                {tab === "overview" ? t.tabOverview
                  : tab === "earnings" ? t.tabEarnings
                  : tab === "payouts" ? t.tabPayouts
                  : tab === "content" ? t.tabContent
                  : tab === "golive" ? t.tabGoLive
                  : tab === "availability" ? "Availability"
                  : t.tabSettings
                }
              </button>
            ))}
          </div>

          {/* Overview Tab */}
          {activeTab === "overview" && (
            <>
              <CallEarningsSummary />
              <UpcomingBookings />

              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="glass-card-sm p-4 text-center">
                  <p className="text-2xl font-bold text-white">{dashboard.subscriberCount}</p>
                  <p className="text-xs mt-1" style={{ color: "#8E8E93" }}>{t.statSubscribers}</p>
                </div>
                <div className="glass-card-sm p-4 text-center">
                  <p className="text-2xl font-bold" style={{ color: "#5ED1C4" }}>${dashboard.monthlyEarnings.toFixed(2)}</p>
                  <p className="text-xs mt-1" style={{ color: "#8E8E93" }}>{t.statThisMonth}</p>
                </div>
                <div className="glass-card-sm p-4 text-center">
                  <p className="text-2xl font-bold text-white">${dashboard.totalEarnings.toFixed(2)}</p>
                  <p className="text-xs mt-1" style={{ color: "#8E8E93" }}>{t.statTotalEarnings}</p>
                </div>
                <div className="glass-card-sm p-4 text-center">
                  <p className="text-2xl font-bold text-white">{dashboard.exclusivePostCount}</p>
                  <p className="text-xs mt-1" style={{ color: "#8E8E93" }}>{t.statExclusivePosts}</p>
                </div>
              </div>

              <div className="glass-card-sm p-4 mb-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-white">
                      {dashboard.creatorType === "full_time" ? t.creatorTypeFullTime
                        : dashboard.creatorType === "diamond" ? `💎 ${t.creatorTypeDiamond}`
                        : dashboard.creatorType === "crystal" ? `🔮 ${t.creatorTypeCrystal}`
                        : dashboard.creatorType === "ice" ? `❄ ${t.creatorTypeIce}`
                        : t.creatorTypeDefault}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: "#8E8E93" }}>
                      ${dashboard.priceUsd.toFixed(2)}/month &middot; {t.revenueSplit}
                    </p>
                  </div>
                  {dashboard.verified && (
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="#5ED1C4" aria-label="Verified">
                      <path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                    </svg>
                  )}
                </div>
              </div>

              {/* Withdrawable amount card */}
              {withdrawable > 0 && (
                <div className="glass-card-sm p-4 mb-4" style={{ borderColor: "rgba(94,209,196,0.3)" }}>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs" style={{ color: "#8E8E93" }}>{t.availableToWithdraw}</p>
                      <p className="text-xl font-bold" style={{ color: "#5ED1C4" }}>${withdrawable.toFixed(2)}</p>
                    </div>
                    <button
                      onClick={() => setActiveTab("payouts")}
                      className="text-xs font-semibold px-4 py-2 rounded-lg"
                      style={{ background: "rgba(94,209,196,0.15)", color: "#5ED1C4", border: "1px solid rgba(94,209,196,0.3)" }}
                    >
                      {t.withdrawBtn}
                    </button>
                  </div>
                </div>
              )}

              {/* Upgrade to full-time if on a tier (ice/crystal/diamond) */}
              {dashboard.creatorType && !["full_time", ""].includes(dashboard.creatorType) && (
                <div className="glass-card-sm p-4 mb-4" style={{ borderColor: "rgba(212,0,122,0.2)" }}>
                  <p className="text-sm font-medium text-white mb-1">{t.wantMore}</p>
                  <p className="text-xs mb-3" style={{ color: "#8E8E93" }}>
                    {t.wantMoreDesc}
                  </p>
                  <button
                    onClick={() => navigate("/apply")}
                    className="text-xs font-semibold px-4 py-2 rounded-lg transition-colors"
                    style={{ background: "linear-gradient(135deg, #D4007A, #E69138)", color: "#fff" }}
                  >
                    {t.applyFullTime}
                  </button>
                </div>
              )}
            </>
          )}

          {/* Earnings Tab */}
          {activeTab === "earnings" && (
            <div className="space-y-4">
              {earnings ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="glass-card-sm p-4 text-center">
                      <p className="text-xl font-bold" style={{ color: "#5ED1C4" }}>
                        ${(earnings.summary.total_creator || 0).toFixed(2)}
                      </p>
                      <p className="text-xs mt-1" style={{ color: "#8E8E93" }}>{t.yourEarnings70}</p>
                    </div>
                    <div className="glass-card-sm p-4 text-center">
                      <p className="text-xl font-bold text-white">
                        ${(earnings.summary.total_gross || 0).toFixed(2)}
                      </p>
                      <p className="text-xs mt-1" style={{ color: "#8E8E93" }}>{t.grossRevenue}</p>
                    </div>
                  </div>

                  {/* Revenue trends */}
                  {earnings.trends && earnings.trends.length > 0 && (
                    <div className="glass-card-sm p-4">
                      <p className="text-sm font-semibold text-white mb-3">{t.monthlyTrends}</p>
                      <div className="space-y-2">
                        {earnings.trends.slice(-6).map((trend, i) => {
                          const maxAmount = Math.max(...earnings.trends.slice(-6).map(x => x.amount), 1);
                          const pct = (trend.amount / maxAmount) * 100;
                          return (
                            <div key={i} className="flex items-center gap-3">
                              <span className="text-xs w-16 flex-shrink-0" style={{ color: "#8E8E93" }}>
                                {new Date(trend.month).toLocaleDateString("en-US", { month: "short", year: "2-digit" })}
                              </span>
                              <div className="flex-1 h-4 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.05)" }}>
                                <div
                                  className="h-full rounded-full"
                                  style={{ width: `${pct}%`, background: "linear-gradient(to right, #D4007A, #E69138)" }}
                                />
                              </div>
                              <span className="text-xs font-medium text-white w-16 text-right">${trend.amount.toFixed(2)}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="glass-card-sm p-8 text-center">
                  <p className="text-white/60 text-sm">{t.noEarningsYet}</p>
                </div>
              )}
            </div>
          )}

          {/* Payouts Tab */}
          {activeTab === "payouts" && (
            <div className="space-y-4">
              {/* Withdraw card */}
              <div className="glass-card-sm p-5" style={{ borderColor: "rgba(94,209,196,0.2)" }}>
                <p className="text-sm font-semibold text-white mb-1">{t.requestWithdrawalTitle}</p>
                <p className="text-xs mb-3" style={{ color: "#8E8E93" }}>
                  {t.availableBalance} <strong style={{ color: "#5ED1C4" }}>${withdrawable.toFixed(2)}</strong>
                </p>
                {withdrawSuccess && (
                  <div className="mb-3 px-3 py-2 rounded-lg text-xs" style={{ background: "rgba(94,209,196,0.1)", color: "#5ED1C4" }}>
                    {withdrawSuccess}
                  </div>
                )}
                {withdrawError && (
                  <div className="mb-3 px-3 py-2 rounded-lg text-xs text-red-300" style={{ background: "rgba(239,68,68,0.1)" }}>
                    {withdrawError}
                  </div>
                )}
                <button
                  onClick={handleWithdraw}
                  disabled={withdrawing || withdrawable <= 0}
                  className="text-xs font-semibold px-4 py-2 rounded-lg transition-colors disabled:opacity-40"
                  style={{ background: "linear-gradient(135deg, #5ED1C4, #00D4E8)", color: "#000" }}
                >
                  {withdrawing ? t.processing : withdrawable <= 0 ? t.noBalance : t.withdrawAmount(withdrawable.toFixed(2))}
                </button>
              </div>

              {/* Withdrawal history */}
              <div className="glass-card-sm p-4">
                <p className="text-sm font-semibold text-white mb-3">{t.withdrawalHistoryTitle}</p>
                {withdrawals.length === 0 ? (
                  <p className="text-xs text-center py-4" style={{ color: "#8E8E93" }}>{t.noWithdrawalsYet}</p>
                ) : (
                  <div className="space-y-2">
                    {withdrawals.map((w) => (
                      <div key={w.id} className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
                        <div>
                          <p className="text-sm font-medium text-white">${w.amountUsd.toFixed(2)}</p>
                          <p className="text-xs" style={{ color: "#8E8E93" }}>
                            {new Date(w.requestedAt).toLocaleDateString()} &middot; {w.method.replace("_", " ")}
                          </p>
                        </div>
                        <span
                          className="text-xs font-semibold px-2 py-0.5 rounded-full"
                          style={{
                            background: w.status === "completed" ? "rgba(94,209,196,0.15)" :
                                        w.status === "pending" ? "rgba(255,180,84,0.15)" : "rgba(142,142,147,0.15)",
                            color: w.status === "completed" ? "#5ED1C4" :
                                   w.status === "pending" ? "#FFB454" : "#8E8E93",
                          }}
                        >
                          {w.status}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Go Live Tab */}
          {activeTab === "golive" && (
            <div className="glass-card-sm p-4">
              <Suspense
                fallback={
                  <div className="space-y-4">
                    <div className="h-6 w-40 rounded-lg bg-pnp-surface animate-pulse" />
                    <div className="rounded-2xl bg-pnp-surface animate-pulse" style={{ aspectRatio: "16/9" }} />
                    <div className="grid grid-cols-2 gap-3">
                      <div className="h-10 rounded-xl bg-pnp-surface animate-pulse" />
                      <div className="h-10 rounded-xl bg-pnp-surface animate-pulse" />
                    </div>
                    <div className="h-[52px] rounded-2xl bg-pnp-surface animate-pulse" />
                  </div>
                }
              >
                <BrowserStreamer />
              </Suspense>
            </div>
          )}

          {/* Content (CMS) Tab */}
          {activeTab === "content" && (
            <div className="space-y-4">
              {cmsLoading && (
                <div className="text-center py-10 text-white/40 text-sm">{t.loadingCmsData}</div>
              )}
              {cmsError && (
                <div className="px-4 py-3 rounded-lg text-sm text-red-300" style={{ background: "rgba(239,68,68,0.1)" }}>
                  {cmsError}
                </div>
              )}
              {!cmsLoading && !cmsError && (
                <>
                  {/* Sub-nav */}
                  <div className="flex gap-2">
                    {(["profile", "content", "shows"] as const).map((s) => (
                      <button
                        key={s}
                        onClick={() => setCmsContentSection(s)}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
                        style={cmsContentSection === s
                          ? { background: "linear-gradient(135deg, #D4007A, #E69138)", color: "#fff" }
                          : { background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.5)", border: "1px solid rgba(255,255,255,0.1)" }
                        }
                      >
                        {s === "profile" ? t.subNavProfile : s === "content" ? t.subNavContent : t.subNavShows}
                      </button>
                    ))}
                  </div>

                  {/* ── Performer Profile Section ── */}
                  {cmsContentSection === "profile" && cmsPerformer && (
                    <div className="glass-card-sm p-5 space-y-4">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-semibold text-white">{t.performerProfileTitle}</p>
                        <span className="text-xs px-2 py-0.5 rounded-full" style={{
                          background: cmsPerformer.status === "published" ? "rgba(94,209,196,0.15)" : "rgba(255,255,255,0.08)",
                          color: cmsPerformer.status === "published" ? "#5ED1C4" : "#8E8E93",
                        }}>
                          {cmsPerformer.status}
                        </span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs text-white/50 mb-1">{t.fieldDisplayName}</label>
                          <input
                            value={cmsProfileForm.name ?? ""}
                            onChange={(e) => setCmsProfileForm((p) => ({ ...p, name: e.target.value }))}
                            className="w-full px-3 py-2 rounded-lg text-sm text-white bg-white/5 border border-white/10 focus:outline-none focus:border-pnp-accent"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-white/50 mb-1">{t.fieldAvailabilityMessage}</label>
                          <input
                            value={cmsProfileForm.availability_message ?? ""}
                            onChange={(e) => setCmsProfileForm((p) => ({ ...p, availability_message: e.target.value }))}
                            className="w-full px-3 py-2 rounded-lg text-sm text-white bg-white/5 border border-white/10 focus:outline-none focus:border-pnp-accent"
                          />
                        </div>
                        <div className="sm:col-span-2">
                          <label className="block text-xs text-white/50 mb-1">{t.fieldShortBio}</label>
                          <input
                            value={cmsProfileForm.bio_short ?? ""}
                            onChange={(e) => setCmsProfileForm((p) => ({ ...p, bio_short: e.target.value }))}
                            className="w-full px-3 py-2 rounded-lg text-sm text-white bg-white/5 border border-white/10 focus:outline-none focus:border-pnp-accent"
                          />
                        </div>
                        <div className="sm:col-span-2">
                          <label className="block text-xs text-white/50 mb-1">{t.fieldFullBio}</label>
                          <textarea
                            rows={3}
                            value={cmsProfileForm.bio ?? ""}
                            onChange={(e) => setCmsProfileForm((p) => ({ ...p, bio: e.target.value }))}
                            className="w-full px-3 py-2 rounded-lg text-sm text-white bg-white/5 border border-white/10 focus:outline-none focus:border-pnp-accent resize-none"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-white/50 mb-1">{t.fieldBasePriceCents}</label>
                          <input
                            type="number"
                            value={cmsProfileForm.base_price_cents ?? ""}
                            onChange={(e) => setCmsProfileForm((p) => ({ ...p, base_price_cents: Number(e.target.value) || null }))}
                            className="w-full px-3 py-2 rounded-lg text-sm text-white bg-white/5 border border-white/10 focus:outline-none focus:border-pnp-accent"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-white/50 mb-1">{t.fieldCurrency}</label>
                          <select
                            value={cmsProfileForm.currency ?? "USD"}
                            onChange={(e) => setCmsProfileForm((p) => ({ ...p, currency: e.target.value }))}
                            className="w-full px-3 py-2 rounded-lg text-sm text-white bg-white/5 border border-white/10 focus:outline-none focus:border-pnp-accent"
                          >
                            <option value="USD">USD</option>
                            <option value="EUR">EUR</option>
                            <option value="COP">COP</option>
                          </select>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <label className="flex items-center gap-2 text-sm text-white/70 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={!!cmsProfileForm.is_available}
                            onChange={(e) => setCmsProfileForm((p) => ({ ...p, is_available: e.target.checked }))}
                            className="rounded"
                          />
                          {t.fieldAvailableForBookings}
                        </label>
                        <select
                          value={cmsProfileForm.status ?? "draft"}
                          onChange={(e) => setCmsProfileForm((p) => ({ ...p, status: e.target.value as CmsPerformer["status"] }))}
                          className="ml-auto px-3 py-1.5 rounded-lg text-xs text-white bg-white/5 border border-white/10 focus:outline-none"
                        >
                          <option value="draft">{t.statusDraft}</option>
                          <option value="published">{t.statusPublished}</option>
                          <option value="archived">{t.statusArchived}</option>
                        </select>
                      </div>

                      {cmsProfileMsg && (
                        <p className="text-xs" style={{ color: cmsProfileMsg.includes("fail") || cmsProfileMsg.includes("error") ? "#FF453A" : "#5ED1C4" }}>
                          {cmsProfileMsg}
                        </p>
                      )}

                      <button
                        onClick={handleCmsProfileSave}
                        disabled={cmsProfileSaving}
                        className="px-5 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50 transition-colors"
                        style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
                      >
                        {cmsProfileSaving ? t.savingProfile : t.saveProfile}
                      </button>
                    </div>
                  )}

                  {/* ── Content Library Section ── */}
                  {cmsContentSection === "content" && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-semibold text-white">{t.contentLibraryTitle(cmsContent.length)}</p>
                        <button
                          onClick={openContentCreate}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white"
                          style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
                        >
                          {t.newItemBtn}
                        </button>
                      </div>

                      {cmsContent.length === 0 && (
                        <div className="glass-card-sm p-6 text-center">
                          <p className="text-sm text-white/40">{t.noContentYet}</p>
                        </div>
                      )}

                      {cmsContent.map((item) => (
                        <div key={item.id} className="glass-card-sm p-4 flex items-start gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-sm font-medium text-white truncate">{item.title}</span>
                              <span className="text-xs px-1.5 py-0.5 rounded-full flex-shrink-0" style={{
                                background: item.status === "published" ? "rgba(94,209,196,0.15)" : "rgba(255,255,255,0.06)",
                                color: item.status === "published" ? "#5ED1C4" : "#8E8E93",
                              }}>{item.status}</span>
                              {item.is_premium && <span className="text-xs px-1.5 py-0.5 rounded-full flex-shrink-0" style={{ background: "rgba(212,0,122,0.15)", color: "#D4007A" }}>{t.primeBadge}</span>}
                            </div>
                            <p className="text-xs text-white/40">
                              {item.type === "video" ? "🎬" : item.type === "audio" ? "🎵" : "🎙"} {item.type}{item.duration_seconds ? ` · ${Math.round(item.duration_seconds / 60)}m` : ""}
                            </p>
                          </div>
                          <div className="flex gap-2 flex-shrink-0">
                            <button
                              onClick={() => openShareModal(
                                `${item.type === "video" ? "🎬" : item.type === "audio" ? "🎵" : "🎙"} New ${item.type}: "${item.title}"${item.description ? `\n\n${item.description}` : ""}\n\n#PNPtv #Creator`
                              )}
                              className="text-xs hover:underline"
                              style={{ color: "#E69138" }}
                            >
                              {t.shareBtn}
                            </button>
                            <button onClick={() => openContentEdit(item)} className="text-xs text-pnp-accent hover:underline">{t.editBtn}</button>
                            <button onClick={() => handleContentDelete(item.id)} className="text-xs text-red-400 hover:underline">{t.deleteBtn}</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* ── Shows Section ── */}
                  {cmsContentSection === "shows" && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-semibold text-white">{t.scheduledShowsTitle(cmsShows.length)}</p>
                        <button
                          onClick={openShowCreate}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white"
                          style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
                        >
                          {t.scheduleShowBtn}
                        </button>
                      </div>

                      {cmsShows.length === 0 && (
                        <div className="glass-card-sm p-6 text-center">
                          <p className="text-sm text-white/40">{t.noShowsYet}</p>
                        </div>
                      )}

                      {cmsShows.map((show) => (
                        <div key={show.id} className="glass-card-sm p-4 flex items-start gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-sm font-medium text-white truncate">{show.title}</span>
                              <span className="text-xs px-1.5 py-0.5 rounded-full flex-shrink-0" style={{
                                background: show.status === "published" ? "rgba(94,209,196,0.15)" : "rgba(255,255,255,0.06)",
                                color: show.status === "published" ? "#5ED1C4" : "#8E8E93",
                              }}>{show.status}</span>
                              {show.is_premium && <span className="text-xs px-1.5 py-0.5 rounded-full flex-shrink-0" style={{ background: "rgba(212,0,122,0.15)", color: "#D4007A" }}>{t.primeBadge}</span>}
                            </div>
                            <p className="text-xs text-white/40">
                              {show.scheduled_at ? new Date(show.scheduled_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}
                              {show.duration_minutes ? ` · ${show.duration_minutes}min` : ""}
                            </p>
                          </div>
                          <div className="flex gap-2 flex-shrink-0">
                            <button
                              onClick={() => openShareModal(
                                `🎥 Live show: "${show.title}"${show.scheduled_at ? `\n📅 ${new Date(show.scheduled_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}` : ""}${show.duration_minutes ? ` · ${show.duration_minutes}min` : ""}${show.description ? `\n\n${show.description}` : ""}\n\n#PNPtv #LiveShow`
                              )}
                              className="text-xs hover:underline"
                              style={{ color: "#E69138" }}
                            >
                              {t.shareBtn}
                            </button>
                            <button onClick={() => openShowEdit(show)} className="text-xs text-pnp-accent hover:underline">{t.editBtn}</button>
                            <button onClick={() => handleShowDelete(show.id)} className="text-xs text-red-400 hover:underline">{t.deleteBtn}</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── Content Modal (create/edit) ── */}
          {contentModal && (
            <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)" }}>
              <div className="w-full max-w-md rounded-2xl p-5 space-y-4" style={{ background: "#1C1C1E", border: "1px solid rgba(255,255,255,0.08)" }}>
                <div className="flex items-center justify-between">
                  <p className="text-base font-semibold text-white">{contentModal.mode === "create" ? t.newContentTitle : t.editContentTitle}</p>
                  <button onClick={() => setContentModal(null)} className="text-white/40 hover:text-white text-xl leading-none">&times;</button>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="block text-xs text-white/50 mb-1">{t.fieldTitle}</label>
                    <input value={contentForm.title ?? ""} onChange={(e) => setContentForm((p) => ({ ...p, title: e.target.value }))}
                      className="w-full px-3 py-2 rounded-lg text-sm text-white bg-white/5 border border-white/10 focus:outline-none focus:border-pnp-accent" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-white/50 mb-1">{t.fieldType}</label>
                      <select value={contentForm.type ?? "video"} onChange={(e) => setContentForm((p) => ({ ...p, type: e.target.value as CmsContent["type"] }))}
                        className="w-full px-3 py-2 rounded-lg text-sm text-white bg-white/5 border border-white/10 focus:outline-none">
                        <option value="video">{t.contentTypeVideo}</option>
                        <option value="audio">{t.contentTypeAudio}</option>
                        <option value="podcast">{t.contentTypePodcast}</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-white/50 mb-1">{t.fieldContentStatus}</label>
                      <select value={contentForm.status ?? "draft"} onChange={(e) => setContentForm((p) => ({ ...p, status: e.target.value as CmsContent["status"] }))}
                        className="w-full px-3 py-2 rounded-lg text-sm text-white bg-white/5 border border-white/10 focus:outline-none">
                        <option value="draft">{t.statusDraft}</option>
                        <option value="published">{t.statusPublished}</option>
                        <option value="archived">{t.statusArchived}</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-white/50 mb-1">{t.fieldMediaUrl}</label>
                    <input value={contentForm.media_url ?? ""} onChange={(e) => setContentForm((p) => ({ ...p, media_url: e.target.value }))}
                      placeholder={t.mediaUrlPlaceholder} className="w-full px-3 py-2 rounded-lg text-sm text-white bg-white/5 border border-white/10 focus:outline-none focus:border-pnp-accent" />
                  </div>
                  <div>
                    <label className="block text-xs text-white/50 mb-1">{t.fieldUploadFile}</label>
                    <input type="file" accept="video/*,audio/*" onChange={(e) => setContentUploadFile(e.target.files?.[0] ?? null)}
                      className="w-full text-xs text-white/60 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-white/10 file:text-white/70 hover:file:bg-white/20" />
                    {contentUploadFile && <p className="text-xs text-white/40 mt-1">{contentUploadFile.name}</p>}
                  </div>
                  <div>
                    <label className="block text-xs text-white/50 mb-1">{t.fieldDescription}</label>
                    <textarea rows={2} value={contentForm.description ?? ""} onChange={(e) => setContentForm((p) => ({ ...p, description: e.target.value }))}
                      className="w-full px-3 py-2 rounded-lg text-sm text-white bg-white/5 border border-white/10 focus:outline-none resize-none" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-white/50 mb-1">{t.fieldDurationSec}</label>
                      <input type="number" value={contentForm.duration_seconds ?? ""} onChange={(e) => setContentForm((p) => ({ ...p, duration_seconds: Number(e.target.value) || null }))}
                        className="w-full px-3 py-2 rounded-lg text-sm text-white bg-white/5 border border-white/10 focus:outline-none" />
                    </div>
                    <div className="flex items-end pb-2">
                      <label className="flex items-center gap-2 text-sm text-white/70 cursor-pointer">
                        <input type="checkbox" checked={!!contentForm.is_premium} onChange={(e) => setContentForm((p) => ({ ...p, is_premium: e.target.checked }))} className="rounded" />
                        {t.fieldPrimeOnly}
                      </label>
                    </div>
                  </div>
                </div>

                {contentSaveError && (
                  <div className="px-3 py-2 rounded-lg text-xs text-red-300" style={{ background: "rgba(239,68,68,0.1)" }}>
                    {contentSaveError}
                  </div>
                )}

                <div className="flex gap-3">
                  <button onClick={handleContentSave} disabled={contentSaving || !contentForm.title || !contentForm.type}
                    className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                    style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}>
                    {contentUploadProgress ? t.uploadingMedia : contentSaving ? t.savingContent : contentModal.mode === "create" ? t.createBtn : t.saveBtn}
                  </button>
                  <button onClick={() => { setContentModal(null); setContentSaveError(null); }} className="px-4 py-2.5 rounded-xl text-sm text-white/60 border border-white/10 hover:bg-white/5">{t.cancelBtn}</button>
                </div>
              </div>
            </div>
          )}

          {/* ── Show Modal (create/edit) ── */}
          {showModal && (
            <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)" }}>
              <div className="w-full max-w-md rounded-2xl p-5 space-y-4" style={{ background: "#1C1C1E", border: "1px solid rgba(255,255,255,0.08)" }}>
                <div className="flex items-center justify-between">
                  <p className="text-base font-semibold text-white">{showModal.mode === "create" ? t.scheduleShowTitle : t.editShowTitle}</p>
                  <button onClick={() => setShowModal(null)} className="text-white/40 hover:text-white text-xl leading-none">&times;</button>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="block text-xs text-white/50 mb-1">{t.fieldShowTitle}</label>
                    <input value={showForm.title ?? ""} onChange={(e) => setShowForm((p) => ({ ...p, title: e.target.value }))}
                      className="w-full px-3 py-2 rounded-lg text-sm text-white bg-white/5 border border-white/10 focus:outline-none focus:border-pnp-accent" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-white/50 mb-1">{t.fieldDateTime}</label>
                      <input type="datetime-local" value={showForm.scheduled_at ?? ""} onChange={(e) => setShowForm((p) => ({ ...p, scheduled_at: e.target.value }))}
                        className="w-full px-3 py-2 rounded-lg text-sm text-white bg-white/5 border border-white/10 focus:outline-none focus:border-pnp-accent" />
                    </div>
                    <div>
                      <label className="block text-xs text-white/50 mb-1">{t.fieldDurationMin}</label>
                      <input type="number" value={showForm.duration_minutes ?? ""} onChange={(e) => setShowForm((p) => ({ ...p, duration_minutes: Number(e.target.value) || null }))}
                        className="w-full px-3 py-2 rounded-lg text-sm text-white bg-white/5 border border-white/10 focus:outline-none" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-white/50 mb-1">{t.fieldDescription}</label>
                    <textarea rows={2} value={showForm.description ?? ""} onChange={(e) => setShowForm((p) => ({ ...p, description: e.target.value }))}
                      className="w-full px-3 py-2 rounded-lg text-sm text-white bg-white/5 border border-white/10 focus:outline-none resize-none" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-white/50 mb-1">{t.fieldCategory}</label>
                      <input value={showForm.category ?? ""} onChange={(e) => setShowForm((p) => ({ ...p, category: e.target.value }))}
                        className="w-full px-3 py-2 rounded-lg text-sm text-white bg-white/5 border border-white/10 focus:outline-none" />
                    </div>
                    <div>
                      <label className="block text-xs text-white/50 mb-1">{t.fieldContentStatus}</label>
                      <select value={showForm.status ?? "draft"} onChange={(e) => setShowForm((p) => ({ ...p, status: e.target.value as CmsShow["status"] }))}
                        className="w-full px-3 py-2 rounded-lg text-sm text-white bg-white/5 border border-white/10 focus:outline-none">
                        <option value="draft">{t.statusDraft}</option>
                        <option value="published">{t.statusPublished}</option>
                      </select>
                    </div>
                  </div>
                  <label className="flex items-center gap-2 text-sm text-white/70 cursor-pointer">
                    <input type="checkbox" checked={!!showForm.is_premium} onChange={(e) => setShowForm((p) => ({ ...p, is_premium: e.target.checked }))} className="rounded" />
                    {t.fieldPrimeOnly}
                  </label>
                </div>

                {showSaveError && (
                  <div className="px-3 py-2 rounded-lg text-xs text-red-300" style={{ background: "rgba(239,68,68,0.1)" }}>
                    {showSaveError}
                  </div>
                )}

                <div className="flex gap-3">
                  <button onClick={handleShowSave} disabled={showSaving || !showForm.title || !showForm.scheduled_at}
                    className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                    style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}>
                    {showSaving ? t.schedulingShow : showModal.mode === "create" ? t.scheduleBtn : t.saveBtn}
                  </button>
                  <button onClick={() => { setShowModal(null); setShowSaveError(null); }} className="px-4 py-2.5 rounded-xl text-sm text-white/60 border border-white/10 hover:bg-white/5">{t.cancelBtn}</button>
                </div>
              </div>
            </div>
          )}

          {/* Availability Tab */}
          {activeTab === "availability" && (
            <div className="space-y-4">
              <CreatorAvailabilitySettings />
              <CallPackageManager />
            </div>
          )}

          {/* Settings Tab */}
          {activeTab === "settings" && (
            <div className="space-y-4">

              {/* Payout Method Card */}
              <div className="glass-card-sm p-5">
                <p className="text-sm font-semibold text-white mb-1">{t.payoutMethodTitle}</p>
                <p className="text-xs mb-4" style={{ color: "#8E8E93" }}>
                  {t.payoutMethodDesc}
                </p>

                {/* Method selector */}
                <div className="flex gap-2 mb-4">
                  {([
                    { key: "meru", label: t.payoutMeruLabel, icon: "📱" },
                    { key: "crypto", label: t.payoutCryptoLabel, icon: "🔑" },
                  ] as const).map((opt) => (
                    <button
                      key={opt.key}
                      onClick={() => {
                        setPayoutMethod(opt.key);
                        setWalletError(null);
                        setWalletSuccess(null);
                      }}
                      disabled={walletLoading}
                      className="flex-1 py-3 rounded-xl text-sm font-semibold transition-all disabled:opacity-40"
                      style={{
                        background: payoutMethod === opt.key
                          ? "linear-gradient(135deg, #D4007A, #E69138)"
                          : "rgba(255,255,255,0.05)",
                        color: payoutMethod === opt.key ? "#fff" : "#8E8E93",
                        border: payoutMethod === opt.key
                          ? "1px solid transparent"
                          : "1px solid rgba(255,255,255,0.08)",
                      }}
                    >
                      <span className="block text-base mb-0.5">{opt.icon}</span>
                      {opt.label}
                    </button>
                  ))}
                </div>

                {walletLoading ? (
                  <div className="h-10 bg-white/5 rounded-lg animate-pulse mb-3" />
                ) : payoutMethod === "meru" ? (
                  <div className="mb-3">
                    <p className="text-xs mb-2" style={{ color: "#8E8E93" }}>
                      {t.meruInputHint}
                    </p>
                    <input
                      type="text"
                      value={meruAccount}
                      onChange={(e) => {
                        setMeruAccount(e.target.value);
                        setWalletError(null);
                        setWalletSuccess(null);
                      }}
                      placeholder={t.meruPlaceholder}
                      autoComplete="off"
                      className="w-full px-3 py-2.5 rounded-lg text-sm text-white placeholder-white/30 bg-white/5 border border-white/10 focus:outline-none focus:border-white/30 transition-colors"
                    />
                  </div>
                ) : (
                  <div className="mb-3">
                    <p className="text-xs mb-2" style={{ color: "#8E8E93" }}>
                      {t.cryptoInputHint}
                    </p>
                    <input
                      type="text"
                      value={walletAddress}
                      onChange={(e) => {
                        setWalletAddress(e.target.value);
                        setWalletError(null);
                        setWalletSuccess(null);
                      }}
                      placeholder={t.cryptoPlaceholder}
                      spellCheck={false}
                      autoComplete="off"
                      className="w-full px-3 py-2.5 rounded-lg text-sm font-mono text-white placeholder-white/30 bg-white/5 border border-white/10 focus:outline-none focus:border-white/30 transition-colors"
                    />
                  </div>
                )}

                {walletSuccess && (
                  <div className="mb-3 px-3 py-2 rounded-lg text-xs" style={{ background: "rgba(94,209,196,0.1)", color: "#5ED1C4" }}>
                    {walletSuccess}
                  </div>
                )}
                {walletError && (
                  <div className="mb-3 px-3 py-2 rounded-lg text-xs text-red-300" style={{ background: "rgba(239,68,68,0.1)" }}>
                    {walletError}
                  </div>
                )}

                <button
                  onClick={handleSaveWallet}
                  disabled={walletSaving || walletLoading || (payoutMethod === "crypto" ? !walletAddress.trim() : !meruAccount.trim())}
                  className="text-xs font-semibold px-4 py-2 rounded-lg transition-colors disabled:opacity-40"
                  style={{ background: "linear-gradient(135deg, #D4007A, #E69138)", color: "#fff" }}
                >
                  {walletSaving ? t.savingWallet : t.savePayoutInfo}
                </button>

                <p className="mt-4 text-xs leading-relaxed" style={{ color: "#8E8E93" }}>
                  {t.payoutScheduleNote}
                </p>
              </div>

              {/* Tier milestone info — read-only */}
              {dashboard.creatorType !== "full_time" && (
                <div className="glass-card-sm p-5">
                  <p className="text-sm font-semibold text-white mb-1">{t.creatorTierTitle}</p>
                  <p className="text-xs mb-4" style={{ color: "#8E8E93" }}>
                    {t.creatorTierDesc}
                  </p>
                  <div className="flex gap-2">
                    {TIERS.map((tier) => {
                      const isCurrent = dashboard.creatorType === tier.key;
                      const tierOrder = { ice: 0, crystal: 1, diamond: 2 };
                      const currentOrder = tierOrder[dashboard.creatorType as keyof typeof tierOrder] ?? -1;
                      const isUnlocked = tierOrder[tier.key] <= currentOrder;
                      return (
                        <div
                          key={tier.key}
                          className="flex-1 py-2.5 rounded-lg text-xs font-semibold text-center"
                          style={{
                            background: isCurrent
                              ? "linear-gradient(135deg, #D4007A, #E69138)"
                              : isUnlocked
                              ? "rgba(212,0,122,0.15)"
                              : "rgba(255,255,255,0.04)",
                            color: isCurrent ? "#fff" : isUnlocked ? "#D4007A" : "#8E8E93",
                            border: isCurrent
                              ? "1px solid transparent"
                              : "1px solid rgba(255,255,255,0.08)",
                          }}
                        >
                          {tier.emoji} {tier.label}
                          {isCurrent && <span className="block text-xs font-normal mt-0.5 opacity-80">{t.tierCurrent}</span>}
                          {!isCurrent && !isUnlocked && <span className="block text-xs font-normal mt-0.5 opacity-60">{t.tierLocked}</span>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ── Eligible — Activate ── */}
      {isEligible && (
        <div className="glass-card-sm p-5 mb-4" style={{ borderColor: "rgba(94,209,196,0.3)" }}>
          <p className="text-lg font-bold text-white mb-2">{t.eligibleTitle}</p>
          <p className="text-sm text-white/70 mb-4">
            {t.eligibleSubtitle}
          </p>

          <div className="space-y-3">
            <div className="rounded-lg p-4" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-semibold text-white">❄ {t.iceCreatorLabel}</span>
                <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "rgba(94,209,196,0.15)", color: "#5ED1C4" }}>{t.iceStartingTier}</span>
              </div>
              <p className="text-xs mt-1 mb-3" style={{ color: "#8E8E93" }}>
                {t.iceDesc}
              </p>
              <button
                onClick={handleActivate}
                className="text-xs font-semibold px-4 py-2 rounded-lg transition-colors"
                style={{ background: "linear-gradient(135deg, #D4007A, #E69138)", color: "#fff" }}
              >
                {t.activateAsCreatorBtn}
              </button>
            </div>

            <div className="rounded-lg p-4" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>
              <p className="text-sm font-semibold text-white">{t.fullTimeCreatorLabel}</p>
              <p className="text-xs mt-1 mb-3" style={{ color: "#8E8E93" }}>
                {t.fullTimeDesc}
              </p>
              <button
                onClick={() => navigate("/apply")}
                className="text-xs font-semibold px-4 py-2 rounded-lg transition-colors"
                style={{ background: "rgba(255,255,255,0.08)", color: "#fff", border: "1px solid rgba(255,255,255,0.2)" }}
              >
                {t.applyFullTimeBtn}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Pending Review ── */}
      {isPending && dashboard?.application && (
        <div className="glass-card-sm p-5 mb-4" style={{ borderColor: "rgba(255,180,84,0.3)" }}>
          <p className="text-lg font-bold text-white mb-2">{t.pendingTitle}</p>
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full" style={{ background: dashboard.application.call_scheduled ? "#5ED1C4" : "#FFB454" }} />
              <span className="text-white/80">
                {dashboard.application.call_scheduled ? t.callScheduled : t.pendingReview}
              </span>
            </div>
            {!dashboard.application.call_scheduled && (
              <a
                href="https://booking.pnptv.app/santino/model-interview"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs font-semibold px-4 py-2 rounded-lg mt-2"
                style={{ background: "linear-gradient(135deg, #D4007A, #E69138)", color: "#fff" }}
              >
                {t.bookInterviewBtn}
              </a>
            )}
          </div>
        </div>
      )}

      {/* ── Share to Feed Modal ── */}
      {shareModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)" }}>
          <div className="w-full max-w-md rounded-2xl p-5 space-y-4" style={{ background: "#1C1C1E", border: "1px solid rgba(255,255,255,0.08)" }}>
            <div className="flex items-center justify-between">
              <p className="text-base font-semibold text-white">{t.shareToFeedTitle}</p>
              <button onClick={() => setShareModal(null)} className="text-white/40 hover:text-white text-xl leading-none">&times;</button>
            </div>

            <p className="text-xs" style={{ color: "#8E8E93" }}>
              {t.shareToFeedDesc}
            </p>

            <textarea
              rows={5}
              value={shareModal.text}
              onChange={(e) => setShareModal({ text: e.target.value })}
              className="w-full px-3 py-2.5 rounded-lg text-sm text-white bg-white/5 border border-white/10 focus:outline-none focus:border-pnp-accent resize-none"
              placeholder={t.sharePlaceholder}
            />

            {shareError && (
              <div className="px-3 py-2 rounded-lg text-xs text-red-300" style={{ background: "rgba(239,68,68,0.1)" }}>
                {shareError}
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={handleConfirmShare}
                disabled={sharePosting || !shareModal.text.trim()}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
              >
                {sharePosting ? t.postingToFeed : t.postToFeedBtn}
              </button>
              <button onClick={() => setShareModal(null)} className="px-4 py-2.5 rounded-xl text-sm text-white/60 border border-white/10 hover:bg-white/5">
                {t.cancelBtn}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Content Delete Confirm Dialog ── */}
      {contentDeleteConfirm !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/70">
          <div className="w-full max-w-xs rounded-2xl p-5 space-y-4" style={{ background: "#1C1C1E", border: "1px solid rgba(255,255,255,0.1)" }}>
            <p className="text-sm font-semibold text-white">{t.deleteContentConfirm}</p>
            <p className="text-xs" style={{ color: "#8E8E93" }}>{t.cannotBeUndone}</p>
            <div className="flex gap-3">
              <button onClick={() => setContentDeleteConfirm(null)} className="flex-1 py-2 rounded-xl text-sm font-medium" style={{ background: "rgba(255,255,255,0.06)", color: "#8E8E93" }}>{t.cancelBtn}</button>
              <button onClick={() => confirmContentDelete(contentDeleteConfirm)} className="flex-1 py-2 rounded-xl text-sm font-semibold text-white" style={{ background: "rgba(239,68,68,0.8)" }}>{t.deleteConfirmBtn}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Show Delete Confirm Dialog ── */}
      {showDeleteConfirm !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/70">
          <div className="w-full max-w-xs rounded-2xl p-5 space-y-4" style={{ background: "#1C1C1E", border: "1px solid rgba(255,255,255,0.1)" }}>
            <p className="text-sm font-semibold text-white">{t.deleteShowConfirm}</p>
            <p className="text-xs" style={{ color: "#8E8E93" }}>{t.cannotBeUndone}</p>
            <div className="flex gap-3">
              <button onClick={() => setShowDeleteConfirm(null)} className="flex-1 py-2 rounded-xl text-sm font-medium" style={{ background: "rgba(255,255,255,0.06)", color: "#8E8E93" }}>{t.cancelBtn}</button>
              <button onClick={() => confirmShowDelete(showDeleteConfirm)} className="flex-1 py-2 rounded-xl text-sm font-semibold text-white" style={{ background: "rgba(239,68,68,0.8)" }}>{t.deleteConfirmBtn}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Activation Modal ── */}
      {showActivateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/70">
          <div className="w-full max-w-sm rounded-2xl p-6 space-y-4" style={{ background: "#1C1C1E", border: "1px solid rgba(255,255,255,0.1)" }}>
            <h2 className="text-lg font-bold text-white">{t.activateTitle}</h2>

            <div className="rounded-xl px-4 py-3" style={{ background: "rgba(94,209,196,0.07)", border: "1px solid rgba(94,209,196,0.2)" }}>
              <p className="text-sm font-semibold text-white mb-1">❄ {t.activateIceTierLabel}</p>
              <p className="text-xs leading-relaxed" style={{ color: "#8E8E93" }}>
                {t.activateIceTierDesc}
              </p>
            </div>

            {/* Terms */}
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={activateTerms}
                onChange={(e) => { setActivateTerms(e.target.checked); setActivateError(null); }}
                className="mt-0.5 w-4 h-4 accent-[#D4007A]"
              />
              <span className="text-xs leading-relaxed" style={{ color: "#8E8E93" }}>
                {t.activateTermsLabel}{" "}
                <a href="/creator-terms" target="_blank" rel="noopener noreferrer" className="underline" style={{ color: "#D4007A" }}>
                  {t.activateTermsLink}
                </a>
                {" "}{t.activateTermsAnd}
              </span>
            </label>

            {activateError && (
              <p className="text-xs text-red-400">{activateError}</p>
            )}

            <div className="flex gap-3 pt-1">
              <button
                onClick={() => setShowActivateModal(false)}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium"
                style={{ background: "rgba(255,255,255,0.06)", color: "#8E8E93" }}
                disabled={activating}
              >
                {t.cancelBtn}
              </button>
              <button
                onClick={handleConfirmActivate}
                disabled={activating || !activateTerms}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-40"
                style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
              >
                {activating ? t.activatingBtn : t.activateBtn}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Not Eligible — Progress ── */}
      {!isActive && !isEligible && !isPending && eligibility && (() => {
        const criteria = [
          { label: t.criteriaMediaPosts, ...eligibility.criteria.mediaPosts },
          { label: t.criteriaTotalLikes, ...eligibility.criteria.totalLikes },
          { label: t.criteriaFollowers, ...eligibility.criteria.followers },
          { label: t.criteriaWeekly, ...eligibility.criteria.weeklyConsistency },
        ];
        const metCount = criteria.filter((c) => c.met).length;
        const totalPct = Math.round(criteria.reduce((acc, c) => acc + Math.min(c.current / c.required, 1), 0) / criteria.length * 100);
        const closest = [...criteria].filter((c) => !c.met).sort((a, b) => (b.current / b.required) - (a.current / a.required))[0];
        return (
          <div className="glass-card-sm p-5 mb-4">
            <div className="flex items-start justify-between mb-1">
              <p className="text-lg font-bold text-white">{t.becomeCreatorTitle}</p>
              <span className="text-sm font-bold" style={{ color: totalPct >= 75 ? "#5ED1C4" : "#E69138" }}>{totalPct}%</span>
            </div>
            <p className="text-sm mb-1" style={{ color: "#8E8E93" }}>
              {metCount === 0 ? t.noCriteriaMet : metCount < criteria.length ? t.someCriteriaMet(metCount, criteria.length) : ""}
            </p>
            {closest && !closest.met && (
              <p className="text-xs mb-4 font-medium" style={{ color: "#E69138" }}>
                {t.closestHint(closest.label, closest.required - closest.current)}
              </p>
            )}
            <CriterionBar label={t.criteriaMediaPosts} {...eligibility.criteria.mediaPosts} />
            <CriterionBar label={t.criteriaTotalLikes} {...eligibility.criteria.totalLikes} />
            <CriterionBar label={t.criteriaFollowers} {...eligibility.criteria.followers} />
            <CriterionBar label={t.criteriaWeekly} {...eligibility.criteria.weeklyConsistency} />
            <p className="text-xs mt-4 text-center" style={{ color: "#8E8E93" }}>
              {t.progressFootnote}
            </p>
          </div>
        );
      })()}

    </div>
  );
}
