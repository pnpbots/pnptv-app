import React, { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  getServiceStatus, type ServiceStatus, type ServicePing,
  getAdminUmamiStats, type UmamiData, type UmamiMetric,
  getAdminMetabaseCard, type MetabaseCardData,
} from "@/lib/api";

// ── Helpers ───────────────────────────────────────────────────────────────────

function n(v: number | string | undefined, decimals = 0): string {
  const num = typeof v === "string" ? parseFloat(v) : (v ?? 0);
  if (isNaN(num)) return "0";
  return num.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function ago(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatusDot({ ping }: { ping?: ServicePing }) {
  if (!ping) return <span className="w-2 h-2 rounded-full bg-gray-500 inline-block" />;
  const color = ping.ok ? "bg-green-400" : "bg-red-500";
  return (
    <span className="flex items-center gap-1.5">
      <span className={`w-2 h-2 rounded-full ${color} ${ping.ok ? "shadow-[0_0_6px_rgba(74,222,128,0.7)]" : ""}`} />
      <span className="text-[10px] text-pnp-textSecondary">{ping.ok ? `${ping.ms}ms` : "DOWN"}</span>
    </span>
  );
}

function KpiCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div
      className="rounded-xl p-4 flex flex-col gap-1"
      style={{ background: "rgba(255,255,255,0.04)", border: `1px solid ${accent ? "rgba(212,0,122,0.3)" : "rgba(255,255,255,0.08)"}` }}
    >
      <p className="text-[11px] uppercase tracking-wider text-pnp-textSecondary font-semibold">{label}</p>
      <p className={`text-2xl font-bold ${accent ? "text-pnp-accent" : "text-pnp-textPrimary"}`}>{value}</p>
      {sub && <p className="text-[11px] text-pnp-textSecondary">{sub}</p>}
    </div>
  );
}

// Public URLs for "Open" buttons — never derived from server response
const PUBLIC_URLS: Record<string, string> = {
  nowpayments: "https://nowpayments.io/merchant-dashboard",
  btcpay:      "https://btcpay.pnptv.app",
  restreamer:  "https://live.pnptv.app",
  livekit:     "https://livekit.pnptv.app",
  authentik:   "https://auth.pnptv.app",
  analytics:   "https://analytics.pnptv.app",
  metabase:    "https://metabase.pnptv.app",
  uptime:      "https://status.pnptv.app",
  calcom:      "https://booking.pnptv.app",
  cms:         "https://cms.pnptv.app",
  backend:     "https://pnptv.app/health",
};

function ServiceCard({
  title, desc, pingKey, statLine, url, actionLabel, onAction, pings,
}: {
  title: string; desc: string; pingKey?: string; statLine?: string;
  url?: string; actionLabel?: string; onAction?: () => void;
  pings: Record<string, ServicePing>;
}) {
  const ping = pingKey ? pings[pingKey] : undefined;
  const href = url ?? (pingKey ? PUBLIC_URLS[pingKey] : undefined);

  return (
    <div
      className="rounded-xl p-4 flex flex-col gap-3"
      style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-pnp-textPrimary truncate">{title}</p>
          <p className="text-[11px] text-pnp-textSecondary mt-0.5 leading-snug">{desc}</p>
        </div>
        {pingKey && <StatusDot ping={ping} />}
      </div>

      {statLine && (
        <p className="text-xs text-pnp-textPrimary font-medium border-t border-white/5 pt-2">{statLine}</p>
      )}

      <div className="flex gap-2 mt-auto">
        {href && (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 text-center px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
            style={{ background: "rgba(212,0,122,0.12)", color: "#D4007A", border: "1px solid rgba(212,0,122,0.25)" }}
          >
            Open ↗
          </a>
        )}
        {onAction && (
          <button
            onClick={onAction}
            className="flex-1 px-3 py-1.5 rounded-lg text-xs font-medium text-pnp-textSecondary hover:text-pnp-textPrimary transition-colors"
            style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}
          >
            {actionLabel}
          </button>
        )}
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[11px] font-bold uppercase tracking-widest text-pnp-textSecondary mb-3 mt-6 first:mt-0">
      {children}
    </h2>
  );
}

// ── Analytics Hub sub-components ─────────────────────────────────────────────

function StatBadge({ label, value, sub, positive }: { label: string; value: string; sub?: string; positive?: boolean }) {
  return (
    <div className="rounded-xl p-4 flex flex-col gap-1" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
      <p className="text-[11px] uppercase tracking-wider text-pnp-textSecondary font-semibold">{label}</p>
      <p className="text-2xl font-bold text-pnp-textPrimary">{value}</p>
      {sub !== undefined && (
        <p className={`text-[11px] ${positive === undefined ? "text-pnp-textSecondary" : positive ? "text-green-400" : "text-red-400"}`}>{sub}</p>
      )}
    </div>
  );
}

function MiniBar({ items, total }: { items: UmamiMetric[]; total: number }) {
  return (
    <div className="flex flex-col gap-1.5">
      {items.map((item) => (
        <div key={item.x} className="flex items-center gap-2 text-xs">
          <span className="w-24 truncate text-pnp-textSecondary text-right text-[11px]">{item.x || "—"}</span>
          <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
            <div
              className="h-full rounded-full"
              style={{ width: `${Math.min(100, (item.y / (total || 1)) * 100)}%`, background: "rgba(212,0,122,0.7)" }}
            />
          </div>
          <span className="w-10 text-right text-pnp-textPrimary font-medium">{n(item.y)}</span>
        </div>
      ))}
    </div>
  );
}

function SimpleLineChart({ rows, dateCol = 0, valueCol = 1, color = "#D4007A" }: {
  rows: (string | number | null)[][];
  dateCol?: number;
  valueCol?: number;
  color?: string;
}) {
  if (!rows || rows.length < 2) return <p className="text-xs text-pnp-textSecondary text-center py-6">No data</p>;
  const values = rows.map(r => Number(r[valueCol]) || 0);
  const max = Math.max(...values, 1);
  const W = 560; const H = 120; const PAD = 8;
  const step = (W - PAD * 2) / (rows.length - 1);
  const pts = values.map((v, i) => `${PAD + i * step},${H - PAD - ((v / max) * (H - PAD * 2))}`).join(" ");
  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: 280 }}>
        <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
        {values.map((v, i) => (
          <circle key={i} cx={PAD + i * step} cy={H - PAD - ((v / max) * (H - PAD * 2))} r="3" fill={color}>
            <title>{String(rows[i][dateCol] ?? "").split("T")[0]}: {n(v)}</title>
          </circle>
        ))}
      </svg>
      <div className="flex justify-between text-[10px] text-pnp-textSecondary mt-1 px-1">
        <span>{String(rows[0][dateCol] ?? "").split("T")[0]}</span>
        <span>{String(rows[rows.length - 1][dateCol] ?? "").split("T")[0]}</span>
      </div>
    </div>
  );
}

function AnalyticsHub() {
  const [days, setDays] = useState(30);
  const [umami, setUmami] = useState<UmamiData | null>(null);
  const [umamiLoading, setUmamiLoading] = useState(true);
  const [umamiError, setUmamiError] = useState<string | null>(null);
  const [revenue, setRevenue] = useState<MetabaseCardData | null>(null);
  const [users, setUsers] = useState<MetabaseCardData | null>(null);
  const [mbLoading, setMbLoading] = useState(true);
  const [mbError, setMbError] = useState<string | null>(null);

  const loadUmami = useCallback(async () => {
    setUmamiLoading(true);
    setUmamiError(null);
    try {
      const d = await getAdminUmamiStats(days);
      setUmami(d);
    } catch (e: any) {
      setUmamiError(e.message || "Failed to load");
    } finally {
      setUmamiLoading(false);
    }
  }, [days]);

  const loadMetabase = useCallback(async () => {
    setMbLoading(true);
    setMbError(null);
    try {
      const [rev, usr] = await Promise.all([
        getAdminMetabaseCard(1),
        getAdminMetabaseCard(2),
      ]);
      setRevenue(rev);
      setUsers(usr);
    } catch (e: any) {
      setMbError(e.message || "Failed to load Metabase data");
    } finally {
      setMbLoading(false);
    }
  }, []);

  useEffect(() => { loadUmami(); }, [loadUmami]);
  useEffect(() => { loadMetabase(); }, [loadMetabase]);

  const s = umami?.stats;
  const bounceRate = s ? Math.round((s.bounces.value / Math.max(s.visits.value, 1)) * 100) : 0;
  const avgDuration = s ? Math.round(s.totaltime.value / Math.max(s.visits.value, 1)) : 0;
  const pagesTotal = (umami?.pages ?? []).reduce((a, m) => a + m.y, 0);
  const countriesTotal = (umami?.countries ?? []).reduce((a, m) => a + m.y, 0);

  return (
    <div>
      {/* Controls */}
      <div className="flex items-center gap-2 mb-4">
        <span className="text-xs text-pnp-textSecondary">Period:</span>
        {[7, 14, 30, 90].map(d => (
          <button
            key={d}
            onClick={() => setDays(d)}
            className="px-2.5 py-1 rounded-lg text-xs font-medium transition-colors"
            style={{
              background: days === d ? "rgba(212,0,122,0.2)" : "rgba(255,255,255,0.04)",
              border: `1px solid ${days === d ? "rgba(212,0,122,0.5)" : "rgba(255,255,255,0.08)"}`,
              color: days === d ? "#D4007A" : "var(--pnp-textSecondary)",
            }}
          >
            {d}d
          </button>
        ))}
        <button
          onClick={() => { loadUmami(); loadMetabase(); }}
          className="ml-auto px-2.5 py-1 rounded-lg text-xs text-pnp-textSecondary hover:text-pnp-textPrimary transition-colors"
          style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}
        >
          ↺ Refresh
        </button>
      </div>

      {/* Umami overview KPIs */}
      <SectionTitle>Web Traffic — Last {days} Days (Umami)</SectionTitle>
      {umamiError && (
        <p className="text-xs text-red-400 mb-3">{umamiError}</p>
      )}
      {umamiLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          {[0,1,2,3].map(i => <div key={i} className="rounded-xl p-4 h-20 animate-pulse" style={{ background: "rgba(255,255,255,0.04)" }} />)}
        </div>
      ) : s ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <StatBadge label="Pageviews" value={n(s.pageviews.value)} sub={`${s.pageviews.change >= 0 ? "+" : ""}${n(s.pageviews.change)} vs prev`} positive={s.pageviews.change >= 0} />
          <StatBadge label="Unique Visitors" value={n(s.visitors.value)} sub={`${s.visitors.change >= 0 ? "+" : ""}${n(s.visitors.change)} vs prev`} positive={s.visitors.change >= 0} />
          <StatBadge label="Sessions" value={n(s.visits.value)} sub={`Bounce ${bounceRate}%`} />
          <StatBadge label="Avg. Session" value={avgDuration >= 60 ? `${Math.floor(avgDuration / 60)}m ${avgDuration % 60}s` : `${avgDuration}s`} />
        </div>
      ) : null}

      {/* Top pages + countries */}
      {!umamiLoading && umami && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
          <div className="rounded-xl p-4" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
            <p className="text-[11px] font-bold uppercase tracking-widest text-pnp-textSecondary mb-3">Top Pages</p>
            {umami.pages.length > 0 ? <MiniBar items={umami.pages.slice(0, 8)} total={pagesTotal} /> : <p className="text-xs text-pnp-textSecondary">No data</p>}
          </div>
          <div className="rounded-xl p-4" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
            <p className="text-[11px] font-bold uppercase tracking-widest text-pnp-textSecondary mb-3">Top Countries</p>
            {umami.countries.length > 0 ? <MiniBar items={umami.countries.slice(0, 8)} total={countriesTotal} /> : <p className="text-xs text-pnp-textSecondary">No data</p>}
          </div>
        </div>
      )}

      {/* Devices */}
      {!umamiLoading && umami && umami.devices.length > 0 && (
        <div className="rounded-xl p-4 mb-6" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
          <p className="text-[11px] font-bold uppercase tracking-widest text-pnp-textSecondary mb-3">Device Types</p>
          <div className="flex gap-4 flex-wrap">
            {umami.devices.map(d => (
              <div key={d.x} className="flex items-center gap-1.5 text-xs">
                <span className="text-pnp-textSecondary capitalize">{d.x || "Unknown"}:</span>
                <span className="text-pnp-textPrimary font-semibold">{n(d.y)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Metabase charts */}
      <SectionTitle>Revenue & Growth (Metabase)</SectionTitle>
      {mbLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[0,1].map(i => <div key={i} className="rounded-xl h-40 animate-pulse" style={{ background: "rgba(255,255,255,0.04)" }} />)}
        </div>
      ) : mbError ? (
        <div className="rounded-xl p-4 mb-6 text-sm text-red-400" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}>
          Metabase unavailable: {mbError}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
          <div className="rounded-xl p-4" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
            <p className="text-[11px] font-bold uppercase tracking-widest text-pnp-textSecondary mb-3">Daily Revenue (30d)</p>
            <SimpleLineChart rows={revenue?.rows ?? []} dateCol={0} valueCol={1} color="#D4007A" />
            {revenue && <p className="text-[10px] text-pnp-textSecondary mt-1 text-right">Total: ${n(revenue.rows.reduce((a, r) => a + (Number(r[1]) || 0), 0), 2)}</p>}
          </div>
          <div className="rounded-xl p-4" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
            <p className="text-[11px] font-bold uppercase tracking-widest text-pnp-textSecondary mb-3">New Users per Day (30d)</p>
            <SimpleLineChart rows={users?.rows ?? []} dateCol={0} valueCol={1} color="#7C3AED" />
            {users && <p className="text-[10px] text-pnp-textSecondary mt-1 text-right">Total: {n(users.rows.reduce((a, r) => a + (Number(r[1]) || 0), 0))}</p>}
          </div>
        </div>
      )}

      {/* Deep-link to services */}
      <div className="flex gap-2 mt-4">
        <a href="https://analytics.pnptv.app" target="_blank" rel="noopener noreferrer"
          className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
          style={{ background: "rgba(212,0,122,0.12)", color: "#D4007A", border: "1px solid rgba(212,0,122,0.25)" }}>
          Open Umami ↗
        </a>
        <a href="https://metabase.pnptv.app/dashboard/1" target="_blank" rel="noopener noreferrer"
          className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
          style={{ background: "rgba(255,255,255,0.06)", color: "var(--pnp-textSecondary)", border: "1px solid rgba(255,255,255,0.1)" }}>
          Open Metabase ↗
        </a>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ExternalServices() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<"services" | "analytics">("services");
  const [data, setData] = useState<ServiceStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<string | null>(null);
  const [provisioning, setProvisioning] = useState(false);
  const [provisionMsg, setProvisionMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await getServiceStatus();
      setData(d);
      setLastFetch(new Date().toISOString());
      setError(null);
    } catch (e: any) {
      setError(e.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleProvisionCalcom = async () => {
    if (provisioning) return;
    if (!window.confirm("Provision Cal.com accounts for all active creators? Safe to run multiple times.")) return;
    setProvisioning(true);
    setProvisionMsg(null);
    try {
      const res = await fetch("/api/admin/calcom/provision-all", { method: "POST", credentials: "include" });
      const d = await res.json().catch(() => ({}));
      setProvisionMsg(res.ok ? `Done — ${d.provisioned ?? 0} provisioned` : `Error: ${d.error || "unknown"}`);
    } catch {
      setProvisionMsg("Request failed — check logs");
    } finally {
      setProvisioning(false);
    }
  };

  const pings: Record<string, ServicePing> = data?.pings ?? {};
  const pl = data?.platform;
  const pay = data?.payments;

  return (
    <div className="page-container max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-pnp-textPrimary">Services & Analytics</h1>
          <p className="text-sm text-pnp-textSecondary mt-0.5">
            {tab === "services" ? "Live status + key metrics for every service" : "Umami web traffic · Metabase revenue & growth"}
            {tab === "services" && lastFetch && <span className="ml-2 opacity-60">· {ago(lastFetch)}</span>}
          </p>
        </div>
        {tab === "services" && (
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-pnp-textSecondary hover:text-pnp-textPrimary transition-colors"
            style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}
          >
            <svg className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 p-1 rounded-xl" style={{ background: "rgba(255,255,255,0.04)", width: "fit-content" }}>
        {(["services", "analytics"] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors capitalize"
            style={{
              background: tab === t ? "rgba(212,0,122,0.2)" : "transparent",
              color: tab === t ? "#D4007A" : "var(--pnp-textSecondary)",
              border: tab === t ? "1px solid rgba(212,0,122,0.4)" : "1px solid transparent",
            }}
          >
            {t === "services" ? "Services & Ops" : "Analytics Hub"}
          </button>
        ))}
      </div>

      {error && tab === "services" && (
        <div className="mb-4 px-4 py-3 rounded-xl text-sm text-red-400" style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)" }}>
          {error}
        </div>
      )}

      {tab === "analytics" && <AnalyticsHub />}

      {tab === "services" && <>
      {/* Platform KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <KpiCard label="Total Users" value={pl ? n(pl.users_total) : "—"} sub={`+${pl ? n(pl.users_new_24h) : "—"} today`} />
        <KpiCard label="PRIME Members" value={pl ? n(pl.prime_members) : "—"} accent />
        <KpiCard label="Revenue 7d" value={pay ? `$${n(pay.revenue_7d, 0)}` : "—"} sub={`${pay ? n(pay.completed_7d) : "—"} payments`} accent />
        <KpiCard label="Open Tickets" value={pl ? n(pl.open_tickets) : "—"} sub={`${pl ? n(pl.new_tickets_24h) : "—"} new today`} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <KpiCard label="New Users 7d" value={pl ? n(pl.users_new_7d) : "—"} />
        <KpiCard label="Posts Today" value={pl ? n(pl.posts_24h) : "—"} />
        <KpiCard label="Active Hangouts" value={pl ? n(pl.active_hangouts) : "—"} />
        <KpiCard label="Payments Today" value={pay ? n(pay.completed_24h) : "—"} sub={`${pay ? n(pay.pending_24h) : "—"} pending`} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-8">
        <KpiCard label="Live Streams" value={pl ? n(pl.live_streams_active) : "—"} sub="right now" />
        <KpiCard label="Active Creators" value={pl ? n(pl.active_creators) : "—"} />
        <KpiCard label="Creator Apps" value={pl ? n(pl.creator_apps_pending) : "—"} sub="pending review" />
      </div>

      {/* Payment Providers */}
      <SectionTitle>Payment Providers</SectionTitle>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <ServiceCard
          title="NowPayments"
          desc="Crypto processing — active provider (BTC, DASH, USDT)"
          pingKey="nowpayments"
          statLine={pay ? `7d: ${n(pay.np_completed_7d)} completed · ${n(pay.np_pending_24h)} pending today · ${n(pay.partial_all)} partially paid` : undefined}
          pings={pings}
        />
        <ServiceCard
          title="BTCPay Server"
          desc="Self-hosted Dash/BTC checkout — active provider"
          pingKey="btcpay"
          statLine={pay ? `7d: ${n(pay.btcpay_completed_7d)} completed · ${n(pay.btcpay_pending_24h)} pending today` : undefined}
          pings={pings}
        />
        <ServiceCard
          title="Meru (Card)"
          desc="Credit card checkout links for Lifetime100"
          statLine={pay ? `7d: ${n(pay.meru_completed_7d)} completed · ${n(pay.meru_available)} links available` : undefined}
          url={undefined}
          onAction={() => navigate("/admin/meru-links")}
          actionLabel="Manage Links"
          pings={pings}
        />
      </div>

      {/* Infrastructure */}
      <SectionTitle>Infrastructure</SectionTitle>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <ServiceCard
          title="Backend API"
          desc="Node.js/Express — main platform API"
          pingKey="backend"
          statLine={pings.backend ? `HTTP ${pings.backend.status} · ${pings.backend.ms}ms` : undefined}
          url="https://pnptv.app/health"
          pings={pings}
        />
        <ServiceCard
          title="Authentik (SSO)"
          desc="Identity & SSO — email/SMTP via Hostinger"
          pingKey="authentik"
          statLine={pl ? `${n(pl.users_total)} user accounts` : undefined}
          pings={pings}
        />
        <ServiceCard
          title="NPM (Nginx Proxy)"
          desc="Reverse proxy & SSL for all domains"
          statLine="148.230.80.210:81"
          url="https://148.230.80.210:81"
          pings={pings}
        />
        <ServiceCard
          title="Redis"
          desc="Cache & session store — real-time pub/sub backbone"
          pingKey="redis"
          statLine={pings.redis ? `PING ${pings.redis.ms}ms` : undefined}
          pings={pings}
        />
      </div>

      {/* Content & Media */}
      <SectionTitle>Content & Media</SectionTitle>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <ServiceCard
          title="Directus CMS"
          desc="Content management — posts, files, CRM"
          pingKey="cms"
          pings={pings}
        />
        <ServiceCard
          title="Restreamer"
          desc="RTMP live stream ingest & relay"
          pingKey="restreamer"
          pings={pings}
        />
        <ServiceCard
          title="LiveKit"
          desc="Video call infrastructure — only video provider"
          pingKey="livekit"
          pings={pings}
        />
        <ServiceCard
          title="Ampache Radio"
          desc="Self-hosted music streaming & radio playlists"
          pingKey="ampache"
          pings={pings}
        />
      </div>

      {/* Analytics & BI */}
      <SectionTitle>Analytics & Business Intelligence</SectionTitle>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <ServiceCard
          title="Umami Analytics"
          desc="Privacy-first usage analytics — page views, sessions, conversions"
          pingKey="analytics"
          pings={pings}
        />
        <ServiceCard
          title="Metabase (BI)"
          desc="Revenue dashboards, cohort analysis, operator reports"
          pingKey="metabase"
          pings={pings}
        />
      </div>

      {/* Booking */}
      <SectionTitle>Booking & Scheduling</SectionTitle>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <ServiceCard
          title="Cal.com Admin"
          desc="Private call booking config — creator calendars & availability"
          pingKey="calcom"
          pings={pings}
        />
        <ServiceCard
          title="Provision Creator Calendars"
          desc="Auto-create Cal.com accounts for all active creators (idempotent)"
          onAction={handleProvisionCalcom}
          actionLabel={provisioning ? "Provisioning…" : "Run Provisioning"}
          pings={pings}
        />
      </div>
      {provisionMsg && (
        <p className={`mt-2 text-xs px-3 py-2 rounded-lg ${provisionMsg.startsWith("Error") ? "text-red-400 bg-red-500/10" : "text-green-400 bg-green-500/10"}`}>
          {provisionMsg}
        </p>
      )}

      {/* Monitoring */}

      <SectionTitle>Monitoring</SectionTitle>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <ServiceCard
          title="Uptime Kuma"
          desc="Service uptime monitoring & public status page"
          pingKey="uptime"
          pings={pings}
        />
        <ServiceCard
          title="Healthchecks.io"
          desc="Cron job & background worker dead-man switches"
          url="https://checks.pnptv.app"
          pings={pings}
        />
      </div>

      {/* App shortcuts */}
      <SectionTitle>App Pages</SectionTitle>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          { label: "Social Feed", to: "/social" },
          { label: "Hangouts", to: "/chat" },
          { label: "Direct Messages", to: "/dm" },
          { label: "Nearby", to: "/nearby" },
          { label: "Subscribe", to: "/subscribe" },
          { label: "Creator Apps", to: "/admin/creators" },
          { label: "AI Support", to: "/support" },
          { label: "Payment Health", to: "/admin/payment-health" },
        ].map(({ label, to }) => (
          <button
            key={to}
            onClick={() => navigate(to)}
            className="px-3 py-2.5 rounded-lg text-xs font-medium text-pnp-textSecondary hover:text-pnp-textPrimary text-left transition-colors"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
          >
            {label} →
          </button>
        ))}
      </div>
      </>}
    </div>
  );
}
