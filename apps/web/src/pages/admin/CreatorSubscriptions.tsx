import React, { useState, useEffect, useCallback } from "react";
import { Badge } from "@pnptv/ui-kit";
import { useI18n } from "@/lib/i18n";
import { DataTable } from "@/components/admin/DataTable";
import { ConfirmModal } from "@/components/admin/ConfirmModal";
import {
  getCreatorSubscriptions,
  getCreatorSubscriptionDetail,
  getCreatorSubscriptionPlatformSummary,
  processCreatorPayout,
  processAllPayouts,
  adminCancelCreatorSubscription,
  adminExtendCreatorSubscription,
  type CreatorSubscriptionSummary,
  type SubscriptionDetail,
  type CreatorDetailAdmin,
  type MonthlyRevenueRow,
  type CreatorPayoutSummary,
  type PlatformPayoutSummary,
} from "@/lib/api";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtUsd(n: number | string | null | undefined): string {
  const v = parseFloat(String(n ?? 0));
  return isNaN(v) ? "$0.00" : `$${v.toFixed(2)}`;
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function isExpired(expiresAt: string): boolean {
  return new Date(expiresAt) < new Date();
}

const CREATOR_TYPE_BADGE: Record<
  string,
  "default" | "accent" | "success" | "warning" | "error"
> = {
  ice: "default",
  crystal: "success",
  diamond: "accent",
};

const STATUS_BADGE: Record<
  string,
  "default" | "accent" | "success" | "warning" | "error"
> = {
  active: "success",
  cancelled: "error",
  expired: "warning",
};

// ─── Avatar helper ────────────────────────────────────────────────────────────

function Avatar({
  src,
  name,
  size = "sm",
}: {
  src: string | null | undefined;
  name: string;
  size?: "sm" | "md";
}) {
  const initials = (name || "?")[0].toUpperCase();
  const cls =
    size === "md"
      ? "w-10 h-10 rounded-full object-cover flex-shrink-0 bg-pnp-surface flex items-center justify-center text-pnp-textSecondary font-bold text-sm"
      : "w-7 h-7 rounded-full object-cover flex-shrink-0 bg-pnp-surface flex items-center justify-center text-pnp-textSecondary font-bold text-xs";
  if (src) {
    return <img src={src} alt={name} className={cls} />;
  }
  return <div className={cls}>{initials}</div>;
}

// ─── Monthly Revenue Mini-Table ───────────────────────────────────────────────

function MonthlyRevenueTable({
  rows,
  showCreators = false,
}: {
  rows: MonthlyRevenueRow[];
  showCreators?: boolean;
}) {
  const t = useI18n().admin;
  if (rows.length === 0) {
    return (
      <p className="text-xs text-pnp-textSecondary py-2">{t.creatorSubs.noRevenueData}</p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-pnp-border">
            <th className="text-left py-2 pr-4 text-xs font-semibold text-pnp-textSecondary">
              {t.creatorSubs.month}
            </th>
            <th className="text-right py-2 pr-4 text-xs font-semibold text-pnp-textSecondary">
              {t.creatorSubs.gross}
            </th>
            <th className="text-right py-2 pr-4 text-xs font-semibold text-pnp-textSecondary">
              {t.creatorSubs.creatorShare}
            </th>
            <th className="text-right py-2 pr-4 text-xs font-semibold text-pnp-textSecondary">
              {t.creatorSubs.platformShare}
            </th>
            {!showCreators && (
              <th className="text-right py-2 text-xs font-semibold text-pnp-textSecondary">
                {t.creatorSubs.subs}
              </th>
            )}
            {showCreators && (
              <th className="text-right py-2 text-xs font-semibold text-pnp-textSecondary">
                {t.creators.title}
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.month}
              className="border-b border-pnp-border/50 hover:bg-pnp-surface/40 transition-colors"
            >
              <td className="py-2 pr-4 font-mono text-xs text-pnp-textPrimary">
                {r.month}
              </td>
              <td className="py-2 pr-4 text-right text-pnp-textPrimary">
                {fmtUsd(r.gross)}
              </td>
              <td className="py-2 pr-4 text-right text-green-400">
                {fmtUsd(r.creator_share)}
              </td>
              <td className="py-2 pr-4 text-right text-pnp-accent">
                {fmtUsd(r.platform_share)}
              </td>
              <td className="py-2 text-right text-pnp-textSecondary text-xs">
                {showCreators
                  ? r.active_creators ?? "—"
                  : r.subscription_count ?? "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Payout Summary Card ──────────────────────────────────────────────────────

function PayoutSummaryCard({
  summary,
  monthlyRevenue,
  onProcessAll,
  processing,
}: {
  summary: PlatformPayoutSummary;
  monthlyRevenue: MonthlyRevenueRow[];
  onProcessAll: () => void;
  processing: boolean;
}) {
  const t = useI18n().admin;
  return (
    <div className="rounded-xl border border-pnp-border bg-pnp-surface p-5 space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold text-pnp-textPrimary">
          {t.creatorSubs.payoutSummary}
        </h2>
        <button
          onClick={onProcessAll}
          disabled={processing || parseFloat(String(summary.total_pending)) <= 0}
          className="px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {processing ? t.shared.processing : t.creatorSubs.processAll}
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <PayoutStatCard
          label={t.creatorSubs.totalPending}
          value={fmtUsd(summary.total_pending)}
          highlight={parseFloat(String(summary.total_pending)) > 0}
        />
        <PayoutStatCard
          label={t.creatorSubs.paidThisMonth}
          value={fmtUsd(summary.paid_this_month)}
        />
        <PayoutStatCard
          label={t.creatorSubs.creatorsAwaiting}
          value={String(summary.creators_with_pending)}
        />
        <PayoutStatCard
          label={t.creatorSubs.platformRevenue}
          value={fmtUsd(summary.total_platform_revenue)}
        />
      </div>

      <div>
        <h3 className="text-sm font-semibold text-pnp-textSecondary mb-3">
          {t.creatorSubs.monthlyRevenue}
        </h3>
        <MonthlyRevenueTable rows={monthlyRevenue} showCreators />
      </div>
    </div>
  );
}

function PayoutStatCard({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="rounded-lg bg-pnp-background border border-pnp-border p-3">
      <p className="text-xs text-pnp-textSecondary mb-1">{label}</p>
      <p
        className={`text-lg font-bold ${highlight ? "text-amber-400" : "text-pnp-textPrimary"}`}
      >
        {value}
      </p>
    </div>
  );
}

// ─── Subscription Detail Panel ────────────────────────────────────────────────

interface DetailState {
  creator: CreatorDetailAdmin;
  subscriptions: SubscriptionDetail[];
  monthlyRevenue: MonthlyRevenueRow[];
  payoutSummary: CreatorPayoutSummary;
}

function CreatorDetailPanel({
  creatorId,
  onClose,
  onPayoutSuccess,
}: {
  creatorId: string;
  onClose: () => void;
  onPayoutSuccess: () => void;
}) {
  const [detail, setDetail] = useState<DetailState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const t = useI18n().admin;
  const [payoutLoading, setPayoutLoading] = useState(false);
  const [payoutMsg, setPayoutMsg] = useState<string | null>(null);

  const [cancelTarget, setCancelTarget] = useState<SubscriptionDetail | null>(null);
  const [cancelLoading, setCancelLoading] = useState(false);

  const [extendTarget, setExtendTarget] = useState<SubscriptionDetail | null>(null);
  const [extendDays, setExtendDays] = useState("30");
  const [extendLoading, setExtendLoading] = useState(false);
  const [extendError, setExtendError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getCreatorSubscriptionDetail(creatorId);
      setDetail({
        creator: res.creator,
        subscriptions: res.subscriptions,
        monthlyRevenue: res.monthlyRevenue,
        payoutSummary: res.payoutSummary,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load creator detail");
    } finally {
      setLoading(false);
    }
  }, [creatorId]);

  useEffect(() => {
    load();
  }, [load]);

  const [showPayoutConfirm, setShowPayoutConfirm] = useState(false);

  const handlePayout = async () => {
    setShowPayoutConfirm(false);
    setPayoutLoading(true);
    setPayoutMsg(null);
    try {
      const res = await processCreatorPayout(creatorId);
      if (res.amount > 0) {
        setPayoutMsg(
          `Payout of ${fmtUsd(res.amount)} processed for @${res.creator} (${res.earningsCount} records) via ${res.method}.`
        );
      } else {
        setPayoutMsg(res.message ?? "No pending payout.");
      }
      onPayoutSuccess();
      await load();
    } catch (err) {
      setPayoutMsg(err instanceof Error ? err.message : "Payout failed");
    } finally {
      setPayoutLoading(false);
    }
  };

  const handleCancel = async () => {
    if (!cancelTarget) return;
    setCancelLoading(true);
    try {
      await adminCancelCreatorSubscription(creatorId, cancelTarget.id);
      setCancelTarget(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cancel failed");
      setCancelTarget(null);
    } finally {
      setCancelLoading(false);
    }
  };

  const handleExtend = async () => {
    if (!extendTarget) return;
    setExtendLoading(true);
    setExtendError(null);
    try {
      const days = parseInt(extendDays, 10);
      if (!days || days < 1 || days > 365) {
        setExtendError("Enter a value between 1 and 365.");
        setExtendLoading(false);
        return;
      }
      await adminExtendCreatorSubscription(creatorId, extendTarget.id, days);
      setExtendTarget(null);
      await load();
    } catch (err) {
      setExtendError(err instanceof Error ? err.message : "Extend failed");
    } finally {
      setExtendLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end" onClick={onClose}>
      <div className="fixed inset-0 bg-black/50" />
      <div
        className="relative bg-pnp-background border-l border-pnp-border h-full w-full max-w-2xl overflow-y-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-4 border-b border-pnp-border bg-pnp-background">
          <h2 className="text-base font-bold text-pnp-textPrimary">
            {loading ? t.shared.loading : detail?.creator ? `@${detail.creator.username}` : t.creators.title}
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-pnp-textSecondary hover:text-pnp-textPrimary hover:bg-pnp-surface transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {loading && (
          <div className="flex items-center justify-center h-32">
            <div className="w-6 h-6 border-2 border-pnp-accent border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {error && !loading && (
          <div className="m-5 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">
            {error}
          </div>
        )}

        {!loading && detail && (
          <div className="p-5 space-y-6">
            {/* Creator info + payout strip */}
            <div className="flex items-start gap-4">
              <Avatar src={detail.creator.avatar_url} name={detail.creator.first_name} size="md" />
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-pnp-textPrimary">
                  {detail.creator.first_name}{" "}
                  <span className="text-pnp-textSecondary font-normal">
                    @{detail.creator.username}
                  </span>
                </p>
                <p className="text-xs text-pnp-textSecondary mt-0.5">
                  {detail.creator.creator_type ?? "—"} creator &middot; {fmtUsd(detail.creator.creator_price_usd)}/mo &middot; payout: {detail.creator.payout_method ?? "—"}
                </p>
                {detail.creator.creator_wallet_address && (
                  <p className="font-mono text-xs text-pnp-textSecondary mt-0.5 truncate">
                    {detail.creator.creator_wallet_address}
                  </p>
                )}
              </div>
            </div>

            {/* Payout action */}
            <div className="rounded-lg border border-pnp-border bg-pnp-surface p-4 flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex-1">
                <p className="text-xs text-pnp-textSecondary">{t.creatorSubs.pendingPayout}</p>
                <p className="text-xl font-bold text-amber-400">
                  {fmtUsd(detail.payoutSummary.pending_total)}
                </p>
                <p className="text-xs text-pnp-textSecondary">
                  {detail.payoutSummary.pending_count} unpaid earning records &middot; total paid: {fmtUsd(detail.payoutSummary.paid_total)}
                </p>
              </div>
              <button
                onClick={() => setShowPayoutConfirm(true)}
                disabled={payoutLoading || parseFloat(String(detail.payoutSummary.pending_total)) <= 0}
                className="px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
              >
                {payoutLoading ? t.shared.processing : t.creatorSubs.payNow}
              </button>
            </div>

            {payoutMsg && (
              <div className="px-4 py-3 rounded-lg bg-green-500/10 border border-green-500/20 text-sm text-green-400">
                {payoutMsg}
              </div>
            )}

            {/* Monthly revenue */}
            <div>
              <h3 className="text-sm font-semibold text-pnp-textSecondary mb-3">
                {t.creatorSubs.revenueLast6}
              </h3>
              <MonthlyRevenueTable rows={detail.monthlyRevenue} />
            </div>

            {/* Subscriber list */}
            <div>
              <h3 className="text-sm font-semibold text-pnp-textSecondary mb-3">
                {t.creatorSubs.subscribers} ({detail.subscriptions.length})
              </h3>
              {detail.subscriptions.length === 0 ? (
                <p className="text-xs text-pnp-textSecondary">{t.creatorSubs.noSubs}</p>
              ) : (
                <div className="space-y-2">
                  {detail.subscriptions.map((sub) => (
                    <div
                      key={sub.id}
                      className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-lg border border-pnp-border bg-pnp-surface/50 p-3"
                    >
                      <Avatar
                        src={sub.subscriber_avatar}
                        name={sub.subscriber_first_name}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-pnp-textPrimary truncate">
                          {sub.subscriber_first_name}{" "}
                          <span className="text-pnp-textSecondary font-normal">
                            @{sub.subscriber_username}
                          </span>
                        </p>
                        <p className="text-xs text-pnp-textSecondary">
                          Started {fmtDate(sub.started_at)} &middot; Expires{" "}
                          <span
                            className={
                              isExpired(sub.expires_at)
                                ? "text-red-400"
                                : "text-pnp-textSecondary"
                            }
                          >
                            {fmtDate(sub.expires_at)}
                          </span>{" "}
                          &middot; {fmtUsd(sub.price_usd)}/mo &middot; Revenue:{" "}
                          {fmtUsd(sub.revenue)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <Badge variant={STATUS_BADGE[sub.status] ?? "default"}>
                          {sub.status}
                        </Badge>
                        {sub.status === "active" && (
                          <>
                            <button
                              onClick={() => {
                                setExtendTarget(sub);
                                setExtendDays("30");
                                setExtendError(null);
                              }}
                              className="text-xs text-pnp-accent hover:underline"
                            >
                              {t.creatorSubs.extend}
                            </button>
                            <button
                              onClick={() => setCancelTarget(sub)}
                              className="text-xs text-red-400 hover:underline"
                            >
                              {t.shared.cancel}
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Payout confirm */}
      <ConfirmModal
        open={showPayoutConfirm}
        title={t.creatorSubs.processPayout}
        message={`Process payout of ${detail ? fmtUsd(detail.payoutSummary.pending_total) : "$0.00"} to @${detail?.creator.username ?? ""}?`}
        confirmLabel={t.creatorSubs.payNow}
        variant="warning"
        onConfirm={handlePayout}
        onCancel={() => setShowPayoutConfirm(false)}
        loading={payoutLoading}
      />

      {/* Cancel confirm */}
      <ConfirmModal
        open={!!cancelTarget}
        title={t.creatorSubs.cancelSubscription}
        message={`Cancel @${cancelTarget?.subscriber_username ?? ""}'s subscription? They will lose access when the current period ends.`}
        confirmLabel={t.creatorSubs.cancelSubscription}
        variant="danger"
        onConfirm={handleCancel}
        onCancel={() => setCancelTarget(null)}
        loading={cancelLoading}
      />

      {/* Extend modal */}
      {extendTarget && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4"
          onClick={() => setExtendTarget(null)}
        >
          <div className="fixed inset-0 bg-black/60" />
          <div
            className="relative bg-pnp-background border border-pnp-border rounded-xl p-6 max-w-sm w-full shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-bold text-pnp-textPrimary mb-2">
              {t.creatorSubs.extendSubscription}
            </h3>
            <p className="text-xs text-pnp-textSecondary mb-4">
              Extending for @{extendTarget.subscriber_username} (currently expires{" "}
              {fmtDate(extendTarget.expires_at)}).
            </p>
            {extendError && (
              <div className="mb-3 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400">
                {extendError}
              </div>
            )}
            <label className="block text-xs text-pnp-textSecondary mb-1">
              {t.creatorSubs.daysToAdd}
            </label>
            <input
              type="number"
              min="1"
              max="365"
              value={extendDays}
              onChange={(e) => setExtendDays(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-pnp-border bg-pnp-background text-pnp-textPrimary text-sm focus:outline-none focus:border-pnp-accent mb-4"
            />
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setExtendTarget(null)}
                disabled={extendLoading}
                className="px-4 py-2 text-sm rounded-lg border border-pnp-border text-pnp-textSecondary hover:bg-pnp-surface disabled:opacity-50 transition-colors"
              >
                {t.shared.cancel}
              </button>
              <button
                onClick={handleExtend}
                disabled={extendLoading}
                className="px-4 py-2 text-sm rounded-lg bg-pnp-accent text-white font-medium hover:bg-pnp-accent/80 disabled:opacity-50 transition-colors"
              >
                {extendLoading ? t.shared.processing : t.creatorSubs.extend}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

type SortKey = "active_subscribers" | "total_revenue" | "pending_payout";

export default function CreatorSubscriptions() {
  const t = useI18n().admin;
  const [creators, setCreators] = useState<CreatorSubscriptionSummary[]>([]);
  const [loadingCreators, setLoadingCreators] = useState(true);
  const [creatorsError, setCreatorsError] = useState<string | null>(null);

  const [summary, setSummary] = useState<{
    summary: {
      total_pending: number;
      paid_this_month: number;
      creators_with_pending: number;
      total_gross_all_time: number;
      total_platform_revenue: number;
    };
    monthlyRevenue: MonthlyRevenueRow[];
  } | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(true);

  const [sortBy, setSortBy] = useState<SortKey>("active_subscribers");
  const [selectedCreatorId, setSelectedCreatorId] = useState<string | null>(null);

  const [processAllLoading, setProcessAllLoading] = useState(false);
  const [processAllMsg, setProcessAllMsg] = useState<string | null>(null);
  const [showProcessAllConfirm, setShowProcessAllConfirm] = useState(false);

  const loadCreators = useCallback(async () => {
    setLoadingCreators(true);
    try {
      const res = await getCreatorSubscriptions();
      setCreators(res.creators);
      setCreatorsError(null);
    } catch (err) {
      setCreatorsError(
        err instanceof Error ? err.message : "Failed to load creators"
      );
    } finally {
      setLoadingCreators(false);
    }
  }, []);

  const loadSummary = useCallback(async () => {
    setLoadingSummary(true);
    try {
      const res = await getCreatorSubscriptionPlatformSummary();
      setSummary({ summary: res.summary, monthlyRevenue: res.monthlyRevenue });
    } catch {
      // Non-fatal — summary panel will show zeroes
      setSummary({
        summary: {
          total_pending: 0,
          paid_this_month: 0,
          creators_with_pending: 0,
          total_gross_all_time: 0,
          total_platform_revenue: 0,
        },
        monthlyRevenue: [],
      });
    } finally {
      setLoadingSummary(false);
    }
  }, []);

  useEffect(() => {
    loadCreators();
    loadSummary();
  }, [loadCreators, loadSummary]);

  const handleProcessAll = async () => {
    setShowProcessAllConfirm(false);
    setProcessAllLoading(true);
    setProcessAllMsg(null);
    try {
      const res = await processAllPayouts();
      if (res.creatorsCount > 0) {
        setProcessAllMsg(
          `Processed payouts for ${res.creatorsCount} creator(s) — total ${fmtUsd(res.totalAmount)}.`
        );
      } else {
        setProcessAllMsg(res.message ?? "No pending payouts found.");
      }
      await Promise.all([loadCreators(), loadSummary()]);
    } catch (err) {
      setProcessAllMsg(
        err instanceof Error ? err.message : "Process all payouts failed."
      );
    } finally {
      setProcessAllLoading(false);
    }
  };

  const sorted = [...creators].sort((a, b) => {
    const av = parseFloat(String(a[sortBy] ?? 0));
    const bv = parseFloat(String(b[sortBy] ?? 0));
    return bv - av;
  });

  const columns = [
    {
      key: "creator",
      header: "Creator",
      render: (row: CreatorSubscriptionSummary) => (
        <div className="flex items-center gap-2">
          <Avatar src={row.creator_avatar} name={row.creator_first_name} />
          <div className="min-w-0">
            <p className="text-sm font-medium text-pnp-textPrimary truncate">
              {row.creator_first_name}
            </p>
            <p className="text-xs text-pnp-textSecondary truncate">
              @{row.creator_username}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: "creator_type",
      header: t.users.tier,
      render: (row: CreatorSubscriptionSummary) => (
        <Badge variant={CREATOR_TYPE_BADGE[row.creator_type ?? ""] ?? "default"}>
          {row.creator_type ?? "—"}
        </Badge>
      ),
    },
    {
      key: "creator_price_usd",
      header: t.creatorSubs.pricePerMonth,
      render: (row: CreatorSubscriptionSummary) => (
        <span className="text-pnp-textPrimary font-medium">
          {fmtUsd(row.creator_price_usd)}
        </span>
      ),
    },
    {
      key: "active_subscribers",
      header: t.creatorSubs.activeSubs,
      render: (row: CreatorSubscriptionSummary) => (
        <span className="text-pnp-textPrimary font-semibold">
          {row.active_subscribers}
        </span>
      ),
    },
    {
      key: "total_revenue",
      header: t.creatorSubs.totalRevenueSort,
      render: (row: CreatorSubscriptionSummary) => (
        <span className="text-pnp-textPrimary">{fmtUsd(row.total_revenue)}</span>
      ),
    },
    {
      key: "pending_payout",
      header: t.creatorSubs.pendingPayout,
      render: (row: CreatorSubscriptionSummary) => (
        <span
          className={
            parseFloat(String(row.pending_payout)) > 0
              ? "text-amber-400 font-semibold"
              : "text-pnp-textSecondary"
          }
        >
          {fmtUsd(row.pending_payout)}
        </span>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      render: (row: CreatorSubscriptionSummary) => (
        <div className="flex items-center gap-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setSelectedCreatorId(row.creator_id);
            }}
            className="text-xs text-pnp-accent hover:underline"
          >
            {t.creatorSubs.viewDetail}
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="page-container space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-pnp-textPrimary">
            {t.creatorSubs.title}
          </h1>
          <p className="text-sm text-pnp-textSecondary mt-1">
            {t.creatorSubs.subtitle}
          </p>
        </div>
      </div>

      {/* Process all success/error message */}
      {processAllMsg && (
        <div className="px-4 py-3 rounded-lg bg-green-500/10 border border-green-500/20 text-sm text-green-400 flex items-start justify-between gap-4">
          <span>{processAllMsg}</span>
          <button
            onClick={() => setProcessAllMsg(null)}
            className="text-green-400/70 hover:text-green-400 flex-shrink-0"
          >
            {t.shared.dismiss}
          </button>
        </div>
      )}

      {/* Section C: Platform Payout Summary */}
      {loadingSummary ? (
        <div className="rounded-xl border border-pnp-border bg-pnp-surface p-5">
          <div className="h-6 w-48 bg-pnp-background rounded animate-pulse mb-4" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-16 rounded-lg bg-pnp-background animate-pulse" />
            ))}
          </div>
        </div>
      ) : summary ? (
        <PayoutSummaryCard
          summary={summary.summary}
          monthlyRevenue={summary.monthlyRevenue}
          onProcessAll={() => setShowProcessAllConfirm(true)}
          processing={processAllLoading}
        />
      ) : null}

      {/* Section A: Creator Overview Table */}
      <div className="rounded-xl border border-pnp-border bg-pnp-surface p-5 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h2 className="text-base font-bold text-pnp-textPrimary">
            {t.creatorSubs.activeCreators} ({creators.length})
          </h2>
          <div className="flex items-center gap-2">
            <label className="text-xs text-pnp-textSecondary">{t.creatorSubs.sortBy}</label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortKey)}
              className="px-2 py-1.5 rounded-lg border border-pnp-border bg-pnp-background text-pnp-textPrimary text-xs focus:outline-none focus:border-pnp-accent"
            >
              <option value="active_subscribers">{t.creatorSubs.activeSubs}</option>
              <option value="total_revenue">{t.creatorSubs.totalRevenueSort}</option>
              <option value="pending_payout">{t.creatorSubs.pendingPayout}</option>
            </select>
          </div>
        </div>

        {creatorsError && (
          <div className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">
            {creatorsError}
          </div>
        )}

        <DataTable
          columns={columns}
          data={sorted}
          loading={loadingCreators}
          emptyMessage={t.creatorSubs.noActiveCreators}
          getRowId={(row) => row.creator_id}
          onRowClick={(row) => setSelectedCreatorId(row.creator_id)}
        />
      </div>

      {/* Section B: Creator Detail Slide-over */}
      {selectedCreatorId && (
        <CreatorDetailPanel
          creatorId={selectedCreatorId}
          onClose={() => setSelectedCreatorId(null)}
          onPayoutSuccess={() => {
            loadCreators();
            loadSummary();
          }}
        />
      )}

      <ConfirmModal
        open={showProcessAllConfirm}
        title={t.creatorSubs.processAll}
        message={`Process payouts for all ${summary?.summary.creators_with_pending ?? 0} creators with pending balances (${fmtUsd(summary?.summary.total_pending ?? 0)} total)?`}
        confirmLabel={t.creatorSubs.processAll}
        variant="warning"
        onConfirm={handleProcessAll}
        onCancel={() => setShowProcessAllConfirm(false)}
        loading={processAllLoading}
      />
    </div>
  );
}
