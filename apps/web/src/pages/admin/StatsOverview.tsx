import React, { useState, useEffect, useCallback } from "react";
import { StatCard } from "@/components/admin/StatCard";
import { DataTable } from "@/components/admin/DataTable";
import { Badge } from "@pnptv/ui-kit";
import {
  getAdminStats,
  type AdminStats,
} from "@/lib/api";

function formatCurrency(value: number): string {
  return `$${value.toFixed(2)}`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

const TIER_BADGE_VARIANTS: Record<string, "default" | "accent" | "success" | "warning" | "danger"> = {
  prime: "accent",
  member: "success",
  creator: "warning",
  free: "default",
  banned: "danger",
};

const STATUS_BADGE_VARIANTS: Record<string, "default" | "accent" | "success" | "warning" | "danger"> = {
  active: "success",
  completed: "success",
  pending: "warning",
  failed: "danger",
  refunded: "default",
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
  const maxRevenue = Math.max(...dailyRevenue.map((d) => d.amount), 1);

  const paymentMethodColumns = [
    { key: "method", header: "Method" },
    { key: "transactions", header: "Transactions" },
    {
      key: "revenue",
      header: "Revenue",
      render: (row: AdminStats["topPaymentMethods"][number]) =>
        formatCurrency(row.revenue),
    },
    {
      key: "successRate",
      header: "Success Rate",
      render: (row: AdminStats["topPaymentMethods"][number]) =>
        `${row.successRate.toFixed(1)}%`,
    },
  ];

  const transactionColumns = [
    {
      key: "date",
      header: "Date",
      render: (row: AdminStats["recentTransactions"][number]) =>
        formatDate(row.date),
    },
    { key: "username", header: "User" },
    {
      key: "amount",
      header: "Amount",
      render: (row: AdminStats["recentTransactions"][number]) =>
        formatCurrency(row.amount),
    },
    {
      key: "status",
      header: "Status",
      render: (row: AdminStats["recentTransactions"][number]) => (
        <Badge variant={STATUS_BADGE_VARIANTS[row.status] ?? "default"}>
          {row.status}
        </Badge>
      ),
    },
    { key: "method", header: "Method" },
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
              value={stats ? formatCurrency(stats.totalRevenue) : "$0.00"}
              icon={<DollarIcon />}
              variant="success"
              subtitle="All time"
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
              value={stats ? formatCurrency(stats.monthlyRevenue) : "$0.00"}
              icon={<TrendUpIcon />}
              variant="warning"
              subtitle="This month"
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
            Daily Revenue (Last 30 Days)
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
            {Object.entries(stats.membershipBreakdown).map(([tier, count]) => (
              <div key={tier} className="flex items-center gap-2">
                <Badge variant={TIER_BADGE_VARIANTS[tier] ?? "default"}>
                  {tier}
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
          getRowId={(row) => row.method}
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
          getRowId={(row) => `${row.date}-${row.userId}`}
        />
      </div>
    </div>
  );
}
