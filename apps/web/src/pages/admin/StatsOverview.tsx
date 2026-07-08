import React, { useState, useEffect, useCallback } from "react";
import { StatCard } from "@/components/admin/StatCard";
import { DataTable } from "@/components/admin/DataTable";
import { ConfirmModal } from "@/components/admin/ConfirmModal";
import { STATUS_BADGE_VARIANTS } from "@/components/admin/shared";
import { Badge } from "@pnptv/ui-kit";
import { ServiceCard } from "@/components/ServiceCard";
import { useI18n } from "@/lib/i18n";
import {
  getAdminStats,
  triggerCristinaNeighborDM,
  triggerRevokeUnusedTrials,
  getAdminRevenueReport,
  getAdminChurnTrend,
  getAdminCreatorLeaderboard,
  type AdminStats,
  type ChurnWeek,
  type CreatorLeaderboardEntry,
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
  const t = useI18n().admin;
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [showRevokeConfirm, setShowRevokeConfirm] = useState(false);
  const [churnData, setChurnData] = useState<{ signups: ChurnWeek[]; churn: ChurnWeek[] } | null>(null);
  const [creators, setCreators] = useState<CreatorLeaderboardEntry[]>([]);
  const [biLoading, setBiLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await getAdminStats();
      setStats(res.stats);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.statsOverview.failedToLoadStats);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 60_000);
    return () => clearInterval(interval);
  }, [load]);

  useEffect(() => {
    setBiLoading(true);
    Promise.all([getAdminChurnTrend(12), getAdminCreatorLeaderboard(10)])
      .then(([churn, board]) => {
        setChurnData({ signups: churn.signups, churn: churn.churn });
        setCreators(board.creators);
      })
      .catch(() => {})
      .finally(() => setBiLoading(false));
  }, []);

  const dailyRevenue = stats?.dailyRevenue ?? [];
  const maxRevenue = Math.max(...dailyRevenue.map((d) => isNaN(d.amount) ? 0 : d.amount), 1);

  const paymentMethodColumns = [
    {
      key: "method",
      header: t.statsOverview.method,
      render: (row: AdminStats["topPaymentMethods"][number]) => (
        <span className="text-pnp-textPrimary font-medium">{row.method ?? "—"}</span>
      ),
    },
    {
      key: "transactions",
      header: t.statsOverview.transactions,
      render: (row: AdminStats["topPaymentMethods"][number]) => (
        <span className="text-pnp-textSecondary">{row.transactions ?? 0}</span>
      ),
    },
    {
      key: "revenue",
      header: t.statsOverview.revenue,
      render: (row: AdminStats["topPaymentMethods"][number]) =>
        formatCurrency(typeof row.revenue === "number" && !isNaN(row.revenue) ? row.revenue : 0),
    },
    {
      key: "successRate",
      header: t.statsOverview.successRate,
      render: (row: AdminStats["topPaymentMethods"][number]) => {
        const rate = typeof row.successRate === "number" && !isNaN(row.successRate) ? row.successRate : 0;
        return `${rate.toFixed(1)}%`;
      },
    },
  ];

  const transactionColumns = [
    {
      key: "date",
      header: t.statsOverview.date,
      render: (row: AdminStats["recentTransactions"][number]) =>
        row.date ? formatDate(row.date) : "—",
    },
    {
      key: "username",
      header: t.statsOverview.user,
      render: (row: AdminStats["recentTransactions"][number]) => (
        <span className="text-pnp-textPrimary">{row.username ?? "—"}</span>
      ),
    },
    {
      key: "amount",
      header: t.statsOverview.amount,
      render: (row: AdminStats["recentTransactions"][number]) =>
        formatCurrency(typeof row.amount === "number" && !isNaN(row.amount) ? row.amount : 0),
    },
    {
      key: "status",
      header: t.shared.status,
      render: (row: AdminStats["recentTransactions"][number]) => (
        <Badge variant={STATUS_BADGE_VARIANTS[row.status] ?? "default"}>
          {row.status ?? "—"}
        </Badge>
      ),
    },
    {
      key: "method",
      header: t.statsOverview.method,
      render: (row: AdminStats["recentTransactions"][number]) => (
        <span className="text-pnp-textSecondary">{row.method ?? "—"}</span>
      ),
    },
  ];

  return (
    <div className="page-container space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-pnp-textPrimary">{t.statsOverview.title}</h1>
          <p className="text-sm text-pnp-textSecondary mt-1">
            {t.statsOverview.subtitle}
          </p>
        </div>
        {loading && !stats && (
          <span className="text-xs text-pnp-textSecondary">{t.shared.loading}</span>
        )}
        {!loading && (
          <button
            onClick={load}
            className="text-xs text-pnp-textSecondary hover:text-pnp-textPrimary border border-pnp-border rounded-lg px-3 py-1.5 transition-colors"
          >
            {t.shared.refresh}
          </button>
        )}
      </div>

      {error && (
        <div className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Service status notices */}
      <div className="flex flex-wrap gap-3">
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300">
          <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <span><span className="font-semibold">Grok AI:</span> Credits exhausted — stream profile generation falling back to default messages.</span>
        </div>
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-500/10 border border-blue-500/20 text-xs text-blue-300">
          <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span><span className="font-semibold">Active payment providers:</span> NowPayments + BTCPay only. ePayco closed 2026-06-27. Daimo retired 2026-04-21.</span>
        </div>
      </div>

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
              label={t.statsOverview.totalRevenue}
              value={stats ? formatCurrency(stats.totalRevenue) : "$0.00 USD"}
              icon={<DollarIcon />}
              variant="success"
              subtitle={t.statsOverview.allTimeUsd}
            />
            <StatCard
              label={t.statsOverview.activeSubscribers}
              value={stats?.activeSubscribers ?? 0}
              icon={<UsersIcon />}
              variant="default"
              subtitle={`of ${stats?.totalUsers ?? 0} total users`}
            />
            <StatCard
              label={t.statsOverview.monthlyRevenue}
              value={stats ? formatCurrency(stats.monthlyRevenue) : "$0.00 USD"}
              icon={<TrendUpIcon />}
              variant="warning"
              subtitle={t.statsOverview.rolling30Days}
            />
            <StatCard
              label={t.statsOverview.churnedUsers}
              value={stats?.churnedUsers ?? 0}
              icon={<TrendDownIcon />}
              variant="danger"
              subtitle={t.statsOverview.cancelledSubs}
            />
          </>
        )}
      </div>

      {/* Business Metrics */}
      <div className="rounded-xl bg-pnp-surface border border-pnp-border p-4 space-y-4">
        <h2 className="text-sm font-semibold text-pnp-textSecondary uppercase tracking-wider">Business Metrics</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label="Conversion Rate (90d)"
            value={stats ? `${(stats.conversionRate ?? 0).toFixed(1)}%` : "—"}
            icon={<TrendUpIcon />}
            variant="success"
            subtitle="Free → paid, last 90 days"
          />
          <StatCard
            label="Active Sub Rate (90d)"
            value={stats ? `${(stats.activeRate ?? 0).toFixed(1)}%` : "—"}
            icon={<TrendUpIcon />}
            variant="default"
            subtitle="Currently active subscribers"
          />
          <StatCard
            label="Avg LTV"
            value={stats ? formatCurrency(stats.avgLTV ?? 0) : "—"}
            icon={<DollarIcon />}
            variant="warning"
            subtitle="Revenue per paying user"
          />
          <StatCard
            label="Total Payers (90d)"
            value={stats?.totalPayers ?? 0}
            icon={<UsersIcon />}
            variant="default"
            subtitle="Unique users who paid"
          />
        </div>
      </div>

      {/* Churn Trend Chart */}
      {(biLoading || (churnData && (churnData.signups.length > 0 || churnData.churn.length > 0))) && (
        <div className="rounded-xl bg-pnp-surface border border-pnp-border p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-pnp-textSecondary uppercase tracking-wider">
              Weekly Signups vs Expirations (12 weeks)
            </h2>
            <div className="flex items-center gap-3 text-xs text-pnp-textSecondary">
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: "#5BC8F5" }} />Signups</span>
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: "#FF453A" }} />Expirations</span>
            </div>
          </div>
          {biLoading ? (
            <div className="h-28 flex items-center justify-center">
              <div className="w-5 h-5 border-2 border-pnp-accent border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (() => {
            const weeks = Array.from(new Set([
              ...(churnData?.signups ?? []).map(r => r.week),
              ...(churnData?.churn ?? []).map(r => r.week),
            ])).sort();
            const signupMap = Object.fromEntries((churnData?.signups ?? []).map(r => [r.week, r.count]));
            const churnMap = Object.fromEntries((churnData?.churn ?? []).map(r => [r.week, r.count]));
            const maxVal = Math.max(...weeks.flatMap(w => [signupMap[w] ?? 0, churnMap[w] ?? 0]), 1);
            return (
              <div className="space-y-1">
                <div className="flex items-end gap-0.5 h-28">
                  {weeks.map(week => (
                    <div key={week} className="group flex-1 flex items-end gap-px h-full relative">
                      <div
                        className="flex-1 rounded-t transition-all"
                        style={{ height: `${Math.max(((signupMap[week] ?? 0) / maxVal) * 100, 1)}%`, background: "#5BC8F5", opacity: 0.75 }}
                        title={`${week}: ${signupMap[week] ?? 0} signups`}
                      />
                      <div
                        className="flex-1 rounded-t transition-all"
                        style={{ height: `${Math.max(((churnMap[week] ?? 0) / maxVal) * 100, 1)}%`, background: "#FF453A", opacity: 0.65 }}
                        title={`${week}: ${churnMap[week] ?? 0} expirations`}
                      />
                      <div className="absolute -top-8 left-1/2 -translate-x-1/2 hidden group-hover:flex flex-col items-center bg-pnp-background border border-pnp-border rounded px-2 py-1 text-xs text-pnp-textPrimary whitespace-nowrap z-10 pointer-events-none gap-0.5">
                        <span className="text-[#5BC8F5]">+{signupMap[week] ?? 0}</span>
                        <span className="text-[#FF453A]">-{churnMap[week] ?? 0}</span>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex justify-between text-xs text-pnp-textSecondary/60">
                  {weeks[0] && <span>{weeks[0]}</span>}
                  {weeks[weeks.length - 1] && <span>{weeks[weeks.length - 1]}</span>}
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* Creator Revenue Leaderboard */}
      <div className="rounded-xl bg-pnp-surface border border-pnp-border p-4">
        <h2 className="text-sm font-semibold text-pnp-textSecondary uppercase tracking-wider mb-4">
          Creator Revenue Leaderboard
        </h2>
        {biLoading ? (
          <div className="flex items-center justify-center py-6">
            <div className="w-5 h-5 border-2 border-pnp-accent border-t-transparent rounded-full animate-spin" />
          </div>
        ) : creators.length === 0 ? (
          <p className="text-sm text-pnp-textSecondary text-center py-4">No creator earnings data yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-pnp-textSecondary/70 border-b border-pnp-border">
                  <th className="text-left pb-2 font-semibold">#</th>
                  <th className="text-left pb-2 font-semibold">Creator</th>
                  <th className="text-right pb-2 font-semibold">Earnings</th>
                  <th className="text-right pb-2 font-semibold hidden sm:table-cell">Tips</th>
                  <th className="text-right pb-2 font-semibold hidden md:table-cell">Streams</th>
                  <th className="text-right pb-2 font-semibold hidden md:table-cell">Hrs Live</th>
                  <th className="text-right pb-2 font-semibold hidden lg:table-cell">Avg Viewers</th>
                  <th className="text-right pb-2 font-semibold hidden lg:table-cell">Last Stream</th>
                </tr>
              </thead>
              <tbody>
                {creators.map((c, i) => (
                  <tr key={c.id} className="border-b border-pnp-border/50 hover:bg-white/2 transition-colors">
                    <td className="py-2.5 pr-3 text-pnp-textSecondary/60 font-mono text-xs">{i + 1}</td>
                    <td className="py-2.5 pr-3">
                      <div className="flex items-center gap-2">
                        {c.photo ? (
                          <img src={c.photo.startsWith('/') || c.photo.startsWith('http') ? c.photo : undefined} alt="" className="w-7 h-7 rounded-full object-cover bg-pnp-border" />
                        ) : (
                          <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0" style={{ background: "linear-gradient(135deg,#D4007A,#E69138)", color: "#fff" }}>
                            {(c.name || "?")[0].toUpperCase()}
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="font-medium text-pnp-textPrimary truncate">{c.name}</p>
                          {c.username && <p className="text-xs text-pnp-textSecondary/60 truncate">@{c.username}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="py-2.5 text-right font-semibold text-green-400">{formatCurrency(c.totalEarningsUsd)}</td>
                    <td className="py-2.5 text-right text-pnp-textSecondary hidden sm:table-cell">{formatCurrency(c.totalTipsUsd)}</td>
                    <td className="py-2.5 text-right text-pnp-textSecondary hidden md:table-cell">{c.totalStreams}</td>
                    <td className="py-2.5 text-right text-pnp-textSecondary hidden md:table-cell">{c.totalHoursLive.toFixed(1)}</td>
                    <td className="py-2.5 text-right text-pnp-textSecondary hidden lg:table-cell">{c.avgPeakViewers.toFixed(0)}</td>
                    <td className="py-2.5 text-right text-pnp-textSecondary/60 text-xs hidden lg:table-cell">
                      {c.lastStreamedAt ? new Date(c.lastStreamedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rounded-xl bg-pnp-surface border border-pnp-border p-4 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-pnp-textSecondary uppercase tracking-wider">
            Identity Health
          </h2>
          <p className="text-xs text-pnp-textSecondary mt-1">
            Live comparison between PNPtv app accounts and Authentik identities.
          </p>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
          <StatCard
            label="App Users"
            value={stats?.appUsers ?? 0}
            icon={<UsersIcon />}
            variant="default"
            subtitle="All rows in app users table"
          />
          <StatCard
            label="Active App Users"
            value={stats?.activeAppUsers ?? 0}
            icon={<UsersIcon />}
            variant="success"
            subtitle="Active app accounts"
          />
          <StatCard
            label="Linked App Users"
            value={stats?.linkedAppUsers ?? 0}
            icon={<UsersIcon />}
            variant="warning"
            subtitle="App users with valid UUID pnptv_id"
          />
          <StatCard
            label="Authentik Users"
            value={stats?.authentikUsers ?? 0}
            icon={<UsersIcon />}
            variant="default"
            subtitle="Live Authentik identities"
          />
          <StatCard
            label="Authentik Orphans"
            value={stats?.orphanAuthentikIdentities ?? 0}
            icon={<TrendDownIcon />}
            variant={(stats?.orphanAuthentikIdentities ?? 0) > 0 ? "danger" : "success"}
            subtitle={(stats?.orphanAuthentikIdentities ?? 0) > 0 ? "Needs cleanup" : "No orphan identities"}
          />
          <StatCard
            label="Missing Authentik"
            value={stats?.appUsersMissingAuthentikIdentity ?? 0}
            icon={<TrendDownIcon />}
            variant={(stats?.appUsersMissingAuthentikIdentity ?? 0) > 0 ? "warning" : "success"}
            subtitle={(stats?.appUsersMissingAuthentikIdentity ?? 0) > 0 ? "App users without identity" : "Fully linked"}
          />
        </div>
      </div>

      {/* Revenue Chart */}
      {dailyRevenue.length > 0 && (
        <div className="rounded-xl bg-pnp-surface border border-pnp-border p-4">
          <h2 className="text-sm font-semibold text-pnp-textSecondary uppercase tracking-wider mb-4">
            {t.statsOverview.dailyRevenue}
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
            {t.statsOverview.membershipBreakdown}
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
          {t.statsOverview.topPaymentMethods}
        </h2>
        <DataTable
          columns={paymentMethodColumns}
          data={stats?.topPaymentMethods ?? []}
          loading={loading && !stats}
          emptyMessage={t.statsOverview.noPaymentData}
          getRowId={(row, idx) => row.method ?? `method-${idx}`}
        />
      </div>

      {/* Recent Transactions */}
      <div>
        <h2 className="text-sm font-semibold text-pnp-textSecondary uppercase tracking-wider mb-3">
          {t.statsOverview.recentTransactions}
        </h2>
        <DataTable
          columns={transactionColumns}
          data={stats?.recentTransactions ?? []}
          loading={loading && !stats}
          emptyMessage={t.statsOverview.noRecentTransactions}
          getRowId={(row, idx) =>
            `${row.date ?? ""}-${row.userId ?? ""}-${row.amount ?? 0}-${row.status ?? ""}-${idx}`
          }
        />
      </div>

      {/* Admin Campaign Actions */}
      <div className="rounded-xl bg-pnp-surface border border-pnp-border p-4">
        <h2 className="text-sm font-semibold text-pnp-textSecondary uppercase tracking-wider mb-4">
          {t.statsOverview.autoCampaigns}
        </h2>
        {actionMsg && (
          <div className="mb-3 px-3 py-2 rounded-lg bg-green-500/10 border border-green-500/20 text-sm text-green-400">
            {actionMsg}
          </div>
        )}
        <div className="flex flex-wrap gap-3">
          <div className="flex-1 min-w-[220px] p-3 rounded-lg border border-pnp-border bg-pnp-background">
            <p className="text-sm font-medium text-pnp-textPrimary mb-1">{t.statsOverview.cristinaNeighborDm}</p>
            <p className="text-xs text-pnp-textSecondary mb-1">{t.statsOverview.cristinaNeighborDesc}</p>
            <p className="text-xs text-pnp-textSecondary/70 mb-3">Messages send from <span className="font-mono text-pnp-textPrimary">@pnptv</span> (id 8552451957).</p>
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
              {actionLoading === "neighbor" ? t.statsOverview.starting : t.statsOverview.runCampaign}
            </button>
          </div>
          <div className="flex-1 min-w-[220px] p-3 rounded-lg border border-pnp-border bg-pnp-background">
            <p className="text-sm font-medium text-pnp-textPrimary mb-1">{t.statsOverview.revokeTrials}</p>
            <p className="text-xs text-pnp-textSecondary mb-3">{t.statsOverview.revokeTrialsDesc}</p>
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
                {actionLoading === "revoke-dry" ? t.statsOverview.running : t.statsOverview.dryRun}
              </button>
              <button
                disabled={!!actionLoading}
                onClick={() => setShowRevokeConfirm(true)}
                className="px-3 py-1.5 text-xs rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 disabled:opacity-40 transition-colors"
              >
                {actionLoading === "revoke" ? t.statsOverview.running : t.statsOverview.revokeNow}
              </button>
            </div>
          </div>
          <div className="flex-1 min-w-[220px] p-3 rounded-lg border border-pnp-border bg-pnp-background">
            <p className="text-sm font-medium text-pnp-textPrimary mb-1">Revenue report</p>
            <p className="text-xs text-pnp-textSecondary mb-3">Download a JSON breakdown of completed payments for the last 30 days, grouped by day.</p>
            <button
              disabled={!!actionLoading}
              onClick={async () => {
                setActionLoading("revenue");
                try {
                  const r = await getAdminRevenueReport({ groupBy: "day" });
                  const blob = new Blob([JSON.stringify(r.report, null, 2)], { type: "application/json" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  const stamp = new Date().toISOString().slice(0, 10);
                  a.href = url;
                  a.download = `pnptv-revenue-report-${stamp}.json`;
                  document.body.appendChild(a);
                  a.click();
                  a.remove();
                  URL.revokeObjectURL(url);
                  setActionMsg("Revenue report downloaded");
                  setTimeout(() => setActionMsg(null), 5000);
                } catch (err) {
                  setActionMsg(err instanceof Error ? err.message : "Error generating revenue report");
                } finally {
                  setActionLoading(null);
                }
              }}
              className="px-3 py-1.5 text-xs rounded-lg bg-pnp-accent/20 text-pnp-accent border border-pnp-accent/30 hover:bg-pnp-accent/30 disabled:opacity-40 transition-colors"
            >
              {actionLoading === "revenue" ? "Generating…" : "Download report (30d)"}
            </button>
          </div>
        </div>
      </div>

      {/* Quick Links */}
      <div>
        <h2 className="text-sm font-semibold text-pnp-textSecondary uppercase tracking-wider mb-3">
          {t.statsOverview.quickLinks}
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <ServiceCard
            to="/admin/users"
            title={t.statsOverview.qlUsers}
            description={t.statsOverview.qlUsersDesc}
            status="online"
            icon={
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            }
          />
          <ServiceCard
            to="/admin/plans"
            title={t.statsOverview.qlPlans}
            description={t.statsOverview.qlPlansDesc}
            status="online"
            icon={
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
              </svg>
            }
          />
          <ServiceCard
            to="/admin/creators"
            title={t.statsOverview.qlCreators}
            description={t.statsOverview.qlCreatorsDesc}
            status="online"
            icon={
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
              </svg>
            }
          />
          <ServiceCard
            to="/admin/notifications"
            title={t.statsOverview.qlNotifications}
            description={t.statsOverview.qlNotificationsDesc}
            status="online"
            icon={
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
            }
          />
          <ServiceCard
            to="/admin/moderation"
            title={t.statsOverview.qlContent}
            description={t.statsOverview.qlContentDesc}
            status="online"
            icon={
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            }
          />
          <ServiceCard
            to="/admin/streams"
            title={t.statsOverview.qlStreams}
            description={t.statsOverview.qlStreamsDesc}
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
        title={t.statsOverview.revokeTrials}
        message={t.statsOverview.revokeConfirm}
        confirmLabel={t.statsOverview.revokeNow}
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
