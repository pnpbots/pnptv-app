import React, { useState, useEffect, useCallback } from "react";
import { StatCard } from "@/components/admin/StatCard";
import { DataTable } from "@/components/admin/DataTable";
import { ConfirmModal } from "@/components/admin/ConfirmModal";
import { STATUS_BADGE_VARIANTS } from "@/components/admin/shared";
import { Badge } from "@pnptv/ui-kit";
import { ServiceCard } from "@/components/ServiceCard";
import {
  getAdminStats,
  triggerCristinaNeighborDM,
  triggerRevokeUnusedTrials,
  type AdminStats,
} from "@/lib/api";

function formatCurrency(value: unknown): string {
  const n = typeof value === "number" && !isNaN(value) ? value : parseFloat(String(value ?? 0));
  return `$${(isNaN(n) ? 0 : n).toFixed(2)} USD`;
}

function formatDate(dateStr: unknown): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr as string);
  if (isNaN(d.getTime())) return String(dateStr);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

// membershipBreakdown is keyed by subscription_status, not tier
const MEMBERSHIP_BADGE_VARIANTS: Record<string, "default" | "accent" | "success" | "warning" | "error"> = {
  active: "success",
  free: "default",
  expired: "warning",
  cancelled: "error",
  churned: "error",
};

const DollarIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

const UsersIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
);

const TrendUpIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
  </svg>
);

const TrendDownIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 17h8m0 0V9m0 8l-8-8-4 4-6-6" />
  </svg>
);

function SkeletonStatCard() {
  return (
    <div className="rounded-xl bg-pnp-surface border border-pnp-border p-4 animate-pulse">
      <div className="h-3 w-24 bg-pnp-border rounded mb-3" />
      <div className="h-8 w-32 bg-pnp-border rounded mb-2" />
      <div className="h-3 w-20 bg-pnp-border rounded" />
    </div>
  );
}

export default function StatsOverview() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [showRevokeConfirm, setShowRevokeConfirm] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await getAdminStats();
      setStats(res.stats);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load stats");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 60_000);
    return () => clearInterval(interval);
  }, [load]);

  const dailyRevenue = stats?.dailyRevenue ?? [];
  const maxRevenue = Math.max(...dailyRevenue.map((d) => isNaN(d.amount) ? 0 : d.amount), 1);

  const paymentMethodColumns = [
    {
      key: "method",
      header: "Method",
      render: (row: AdminStats["topPaymentMethods"][number]) => (
        <span className="text-pnp-textPrimary font-medium">{row.method ?? "—"}</span>
      ),
    },
    {
      key: "transactions",
      header: "Transactions",
      render: (row: AdminStats["topPaymentMethods"][number]) => (
        <span className="text-pnp-textSecondary">{row.transactions ?? 0}</span>
      ),
    },
    {
      key: "revenue",
      header: "Revenue",
      render: (row: AdminStats["topPaymentMethods"][number]) =>
        formatCurrency(typeof row.revenue === "number" && !isNaN(row.revenue) ? row.revenue : 0),
    },
    {
      key: "successRate",
      header: "Success Rate",
      render: (row: AdminStats["topPaymentMethods"][number]) => {
        const rate = typeof row.successRate === "number" && !isNaN(row.successRate) ? row.successRate : 0;
        return `${rate.toFixed(1)}%`;
      },
    },
  ];

  const transactionColumns = [
    {
      key: "date",
      header: "Date",
      render: (row: AdminStats["recentTransactions"][number]) =>
        row.date ? formatDate(row.date) : "—",
    },
    {
      key: "username",
      header: "User",
      render: (row: AdminStats["recentTransactions"][number]) => (
        <span className="text-pnp-textPrimary">{row.username ?? "—"}</span>
      ),
    },
    {
      key: "amount",
      header: "Amount",
      render: (row: AdminStats["recentTransactions"][number]) =>
        formatCurrency(typeof row.amount === "number" && !isNaN(row.amount) ? row.amount : 0),
    },
    {
      key: "status",
      header: "Status",
      render: (row: AdminStats["recentTransactions"][number]) => (
        <Badge variant={STATUS_BADGE_VARIANTS[row.status] ?? "default"}>
          {row.status ?? "—"}
        </Badge>
      ),
    },
    {
      key: "method",
      header: "Method",
      render: (row: AdminStats["recentTransactions"][number]) => (
        <span className="text-pnp-textSecondary">{row.method ?? "—"}</span>
      ),
    },
  ];

  return (
    <div className="page-container space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-pnp-textPrimary">Stats Overview</h1>
          <p className="text-sm text-pnp-textSecondary mt-1">
            Platform metrics · auto-refreshes every 60s
          </p>
        </div>
        {loading && !stats && (
          <span className="text-xs text-pnp-textSecondary">Loading...</span>
        )}
        {!loading && (
          <button
            onClick={load}
            className="text-xs text-pnp-textSecondary hover:text-pnp-textPrimary border border-pnp-border rounded-lg px-3 py-1.5 transition-colors"
          >
            Refresh
          </button>
        )}
      </div>

      {error && (
        <div className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {loading && !stats ? (
          <>
            <SkeletonStatCard />
            <SkeletonStatCard />
            <SkeletonStatCard />
            <SkeletonStatCard />
          </>
        ) : (
          <>
            <StatCard
              label="Total Revenue"
              value={stats ? formatCurrency(stats.totalRevenue) : "$0.00 USD"}
              icon={<DollarIcon />}
              variant="success"
              subtitle="All time (USD)"
            />
            <StatCard
              label="Active Subscribers"
              value={stats?.activeSubscribers ?? 0}
              icon={<UsersIcon />}
              variant="default"
              subtitle={`of ${stats?.totalUsers ?? 0} total users`}
            />
            <StatCard
              label="Monthly Revenue"
              value={stats ? formatCurrency(stats.monthlyRevenue) : "$0.00 USD"}
              icon={<TrendUpIcon />}
              variant="warning"
              subtitle="Rolling 30 days (USD)"
            />
            <StatCard
              label="Churned Users"
              value={stats?.churnedUsers ?? 0}
              icon={<TrendDownIcon />}
              variant="danger"
              subtitle="Cancelled subscriptions"
            />
          </>
        )}
      </div>

      {/* Revenue Chart */}
      {dailyRevenue.length > 0 && (
        <div className="rounded-xl bg-pnp-surface border border-pnp-border p-4">
          <h2 className="text-sm font-semibold text-pnp-textSecondary uppercase tracking-wider mb-4">
            Daily Revenue USD (Last 30 Days)
          </h2>
          <div className="flex items-end gap-1 max-h-32 h-32">
            {dailyRevenue.map((day, idx) => {
              const heightPct = maxRevenue > 0 ? (day.amount / maxRevenue) * 100 : 0;
              return (
                <div
                  key={idx}
                  className="group relative flex-1 flex flex-col items-center justify-end"
                >
                  <div
                    className="w-full bg-pnp-accent/60 hover:bg-pnp-accent rounded-t transition-colors min-h-[2px]"
                    style={{ height: `${Math.max(heightPct, 1)}%` }}
                    title={`${formatDate(day.date)}: ${formatCurrency(day.amount)}`}
                  />
                  <div className="absolute -top-8 left-1/2 -translate-x-1/2 hidden group-hover:block bg-pnp-background border border-pnp-border rounded px-2 py-1 text-xs text-pnp-textPrimary whitespace-nowrap z-10 pointer-events-none">
                    {formatDate(day.date)}: {formatCurrency(day.amount)}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex justify-between mt-2 text-xs text-pnp-textSecondary">
            {dailyRevenue[0] && <span>{formatDate(dailyRevenue[0].date)}</span>}
            {dailyRevenue[dailyRevenue.length - 1] && (
              <span>{formatDate(dailyRevenue[dailyRevenue.length - 1].date)}</span>
            )}
          </div>
        </div>
      )}

      {/* Membership Breakdown */}
      {stats?.membershipBreakdown && Object.keys(stats.membershipBreakdown).length > 0 && (
        <div className="rounded-xl bg-pnp-surface border border-pnp-border p-4">
          <h2 className="text-sm font-semibold text-pnp-textSecondary uppercase tracking-wider mb-4">
            Membership Breakdown
          </h2>
          <div className="flex flex-wrap gap-3">
            {Object.entries(stats.membershipBreakdown).map(([status, count]) => (
              <div key={status} className="flex items-center gap-2">
                <Badge variant={MEMBERSHIP_BADGE_VARIANTS[status] ?? "default"}>
                  {status}
                </Badge>
                <span className="text-sm font-semibold text-pnp-textPrimary">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top Payment Methods */}
      <div>
        <h2 className="text-sm font-semibold text-pnp-textSecondary uppercase tracking-wider mb-3">
          Top Payment Methods
        </h2>
        <DataTable
          columns={paymentMethodColumns}
          data={stats?.topPaymentMethods ?? []}
          loading={loading && !stats}
          emptyMessage="No payment method data"
          getRowId={(row, idx) => row.method ?? `method-${idx}`}
        />
      </div>

      {/* Recent Transactions */}
      <div>
        <h2 className="text-sm font-semibold text-pnp-textSecondary uppercase tracking-wider mb-3">
          Recent Transactions
        </h2>
        <DataTable
          columns={transactionColumns}
          data={stats?.recentTransactions ?? []}
          loading={loading && !stats}
          emptyMessage="No recent transactions"
          getRowId={(row, idx) =>
            `${row.date ?? ""}-${row.userId ?? ""}-${row.amount ?? 0}-${row.status ?? ""}-${idx}`
          }
        />
      </div>

      {/* Admin Campaign Actions */}
      <div className="rounded-xl bg-pnp-surface border border-pnp-border p-4">
        <h2 className="text-sm font-semibold text-pnp-textSecondary uppercase tracking-wider mb-4">
          Automated Campaigns
        </h2>
        {actionMsg && (
          <div className="mb-3 px-3 py-2 rounded-lg bg-green-500/10 border border-green-500/20 text-sm text-green-400">
            {actionMsg}
          </div>
        )}
        <div className="flex flex-wrap gap-3">
          <div className="flex-1 min-w-[220px] p-3 rounded-lg border border-pnp-border bg-pnp-background">
            <p className="text-sm font-medium text-pnp-textPrimary mb-1">Cristina — Neighbor DM</p>
            <p className="text-xs text-pnp-textSecondary mb-3">Send each user a DM from Cristina about their closest neighbor + referral link. One send per user per 30 days.</p>
            <button
              disabled={!!actionLoading}
              onClick={async () => {
                setActionLoading("neighbor");
                try {
                  const r = await triggerCristinaNeighborDM();
                  setActionMsg(r.message);
                  setTimeout(() => setActionMsg(null), 8000);
                } catch { setActionMsg("Error triggering campaign"); }
                finally { setActionLoading(null); }
              }}
              className="px-3 py-1.5 text-xs rounded-lg bg-pnp-accent/20 text-pnp-accent border border-pnp-accent/30 hover:bg-pnp-accent/30 disabled:opacity-40 transition-colors"
            >
              {actionLoading === "neighbor" ? "Starting..." : "Run Campaign"}
            </button>
          </div>
          <div className="flex-1 min-w-[220px] p-3 rounded-lg border border-pnp-border bg-pnp-background">
            <p className="text-sm font-medium text-pnp-textPrimary mb-1">Revoke Unused Trials</p>
            <p className="text-xs text-pnp-textSecondary mb-3">Downgrade PRIME trial users who have 0 posts and incomplete profiles. Sends each user a Cristina DM.</p>
            <div className="flex gap-2">
              <button
                disabled={!!actionLoading}
                onClick={async () => {
                  setActionLoading("revoke-dry");
                  try {
                    const r = await triggerRevokeUnusedTrials(true);
                    setActionMsg("Dry run: " + r.message + " (check server logs for details)");
                    setTimeout(() => setActionMsg(null), 8000);
                  } catch { setActionMsg("Error"); }
                  finally { setActionLoading(null); }
                }}
                className="px-3 py-1.5 text-xs rounded-lg border border-pnp-border text-pnp-textSecondary hover:bg-pnp-surface disabled:opacity-40 transition-colors"
              >
                {actionLoading === "revoke-dry" ? "Running..." : "Dry Run"}
              </button>
              <button
                disabled={!!actionLoading}
                onClick={() => setShowRevokeConfirm(true)}
                className="px-3 py-1.5 text-xs rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 disabled:opacity-40 transition-colors"
              >
                {actionLoading === "revoke" ? "Running..." : "Revoke Now"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Links */}
      <div>
        <h2 className="text-sm font-semibold text-pnp-textSecondary uppercase tracking-wider mb-3">
          Quick Links
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <ServiceCard
            to="/admin/users"
            title="User Management"
            description="View, search, and manage all registered platform users."
            status="online"
            icon={
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            }
          />
          <ServiceCard
            to="/admin/plans"
            title="Plan Management"
            description="Configure subscription plans, pricing, and trial settings."
            status="online"
            icon={
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
              </svg>
            }
          />
          <ServiceCard
            to="/admin/creators"
            title="Creator Applications"
            description="Review and approve pending creator program applications."
            status="online"
            icon={
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
              </svg>
            }
          />
          <ServiceCard
            to="/admin/notifications"
            title="Notifications"
            description="Send broadcasts, push alerts, and Cristina AI messages."
            status="online"
            icon={
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
            }
          />
          <ServiceCard
            to="/admin/moderation"
            title="Content Moderation"
            description="Review flagged posts, reports, and enforce community standards."
            status="online"
            icon={
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            }
          />
          <ServiceCard
            to="/admin/streams"
            title="Stream Management"
            description="Monitor live streams, manage time slots, and view overlays."
            status="online"
            icon={
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.069A1 1 0 0121 8.845v6.31a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            }
          />
        </div>
      </div>

      <ConfirmModal
        open={showRevokeConfirm}
        title="Revoke Unused Trials"
        message="This will revoke PRIME trials for inactive users and send each one a Cristina DM. Are you sure?"
        confirmLabel="Revoke Now"
        variant="danger"
        onConfirm={async () => {
          setShowRevokeConfirm(false);
          setActionLoading("revoke");
          try {
            const r = await triggerRevokeUnusedTrials(false);
            setActionMsg(r.message);
            setTimeout(() => setActionMsg(null), 8000);
          } catch { setActionMsg("Error"); }
          finally { setActionLoading(null); }
        }}
        onCancel={() => setShowRevokeConfirm(false)}
        loading={actionLoading === "revoke"}
      />
    </div>
  );
}
