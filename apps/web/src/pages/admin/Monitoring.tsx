import React, { useState, useEffect, useCallback } from "react";
import { getMonitoringStatus, type MonitoringStatus, type MonitoringService } from "@/lib/api";

const CATEGORY_LABELS: Record<string, string> = {
  core: "Core Infrastructure",
  stream: "Streaming",
  payment: "Payments",
  infra: "Tools & Services",
};

const EXTERNAL_URLS: Record<string, string> = {
  restreamer: "https://live.pnptv.app",
  btcpay:     "https://btcpay.pnptv.app",
  cms:        "https://cms.pnptv.app",
  kuma:       "https://status.pnptv.app",
  calcom:     "https://booking.pnptv.app",
  livekit:    "https://livekit.pnptv.app",
  bot:        "https://pnptv.app/health",
  web:        "https://pnptv.app",
};

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch { return iso; }
}

function fmtPing(iso: string | null): string {
  if (!iso) return "Never";
  try {
    const ago = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (ago < 60) return `${ago}s ago`;
    if (ago < 3600) return `${Math.floor(ago / 60)}m ago`;
    if (ago < 86400) return `${Math.floor(ago / 3600)}h ago`;
    return `${Math.floor(ago / 86400)}d ago`;
  } catch { return String(iso); }
}

function StatusBadge({ ok, ms }: { ok: boolean; ms: number }) {
  if (ok) {
    return (
      <div className="flex items-center gap-1.5">
        <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]" />
        <span className="text-xs font-medium text-emerald-400">{ms}ms</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-2.5 h-2.5 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]" />
      <span className="text-xs font-medium text-red-400">DOWN</span>
    </div>
  );
}

function ServiceRow({ svc }: { svc: MonitoringService }) {
  const url = EXTERNAL_URLS[svc.key];
  return (
    <div
      className="flex items-center justify-between px-4 py-3 rounded-xl transition-colors"
      style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}
    >
      <div className="flex items-center gap-3 min-w-0">
        <StatusBadge ok={svc.ok} ms={svc.ms} />
        <span className="text-sm font-medium text-pnp-textPrimary truncate">{svc.label}</span>
      </div>
      {url && (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-3 flex-shrink-0 text-xs px-2.5 py-1 rounded-lg text-pnp-accent"
          style={{ background: "rgba(212,0,122,0.1)", border: "1px solid rgba(212,0,122,0.2)" }}
        >
          Open ↗
        </a>
      )}
    </div>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl p-5 flex flex-col gap-4" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
      <h3 className="text-xs font-semibold uppercase tracking-widest text-pnp-textSecondary">{title}</h3>
      {children}
    </div>
  );
}

function SummaryPill({ ok, total }: { ok: number; total: number }) {
  const allGood = ok === total;
  const cls = allGood
    ? "bg-emerald-900/40 text-emerald-300 border-emerald-800"
    : "bg-red-900/40 text-red-300 border-red-800";
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-semibold ${cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${allGood ? "bg-emerald-400" : "bg-red-400"}`} />
      {allGood ? `All ${total} services online` : `${total - ok} of ${total} services DOWN`}
    </span>
  );
}

export default function Monitoring() {
  const [data, setData] = useState<MonitoringStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getMonitoringStatus();
      setData(result);
      setLastRefresh(new Date());
    } catch (e: any) {
      setError(e?.message || "Failed to load monitoring data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const interval = setInterval(load, 60_000);
    return () => clearInterval(interval);
  }, [load]);

  const grouped = data
    ? (["core", "stream", "payment", "infra"] as const).map((cat) => ({
        cat,
        services: data.services.filter((s) => s.category === cat),
      })).filter((g) => g.services.length > 0)
    : [];

  const totalOk = data ? data.services.filter((s) => s.ok).length : 0;
  const total   = data ? data.services.length : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-pnp-textPrimary">Service Monitoring</h1>
          <p className="text-sm text-pnp-textSecondary mt-0.5">Live status of all PNPtv infrastructure. Auto-refreshes every 60s.</p>
        </div>
        <div className="flex items-center gap-3">
          {data && <SummaryPill ok={totalOk} total={total} />}
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium text-pnp-textSecondary hover:text-pnp-textPrimary transition-colors disabled:opacity-50"
            style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}
          >
            <svg className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            {loading ? "Checking…" : "Refresh"}
          </button>
        </div>
      </div>

      {lastRefresh && (
        <p className="text-xs text-pnp-textSecondary">Last checked at {fmtTime(lastRefresh.toISOString())}</p>
      )}

      {error && (
        <div className="rounded-xl px-4 py-3 text-sm text-red-300" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}>
          {error}
        </div>
      )}

      {!loading && !error && data && (
        <>
          {/* Service status grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {grouped.map(({ cat, services }) => (
              <SectionCard key={cat} title={CATEGORY_LABELS[cat] || cat}>
                <div className="space-y-2">
                  {services.map((svc) => <ServiceRow key={svc.key} svc={svc} />)}
                </div>
              </SectionCard>
            ))}
          </div>

          {/* Cron job health */}
          <SectionCard title="Scheduled Job Health (Healthchecks)">
            {data.cronJobs.length === 0 ? (
              <div className="text-center py-6">
                <p className="text-sm font-medium text-pnp-textSecondary mb-1">No cron jobs configured</p>
                <p className="text-xs text-pnp-textSecondary opacity-70">
                  Cron jobs can ping Healthchecks to confirm they ran. Set <code className="text-pnp-accent">HEALTHCHECK_*</code> env vars to activate.
                </p>
                <a
                  href="https://healthchecks.pnptv.app"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 mt-3 text-xs text-pnp-accent"
                >
                  Open Healthchecks dashboard ↗
                </a>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-pnp-textSecondary border-b border-white/5">
                      <th className="pb-2 pr-4">Job</th>
                      <th className="pb-2 pr-4">Status</th>
                      <th className="pb-2 pr-4">Last Ping</th>
                      <th className="pb-2">Timeout</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {data.cronJobs.map((job) => {
                      const isUp = job.status === "up";
                      const isDown = job.status === "down";
                      return (
                        <tr key={job.slug}>
                          <td className="py-2 pr-4 font-medium text-pnp-textPrimary">{job.name}</td>
                          <td className="py-2 pr-4">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                              isUp ? "bg-emerald-900/40 text-emerald-300" :
                              isDown ? "bg-red-900/40 text-red-300" :
                              "bg-amber-900/40 text-amber-300"
                            }`}>
                              {job.status}
                            </span>
                          </td>
                          <td className="py-2 pr-4 text-pnp-textSecondary">{fmtPing(job.last_ping)}</td>
                          <td className="py-2 text-pnp-textSecondary">{job.timeout}s</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>

          {/* External dashboards */}
          <SectionCard title="External Monitoring Dashboards">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {[
                { label: "Uptime Kuma", url: "https://status.pnptv.app", desc: "Public status page" },
                { label: "Healthchecks", url: "https://healthchecks.pnptv.app", desc: "Cron job pings" },
                { label: "Dozzle (Logs)", url: "https://dozzle.pnptv.app", desc: "Container log viewer" },
              ].map((d) => (
                <a
                  key={d.url}
                  href={d.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-xl p-3 flex flex-col gap-1 transition-colors hover:border-pnp-accent/40"
                  style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}
                >
                  <span className="text-sm font-semibold text-pnp-textPrimary">{d.label} ↗</span>
                  <span className="text-xs text-pnp-textSecondary">{d.desc}</span>
                </a>
              ))}
            </div>
          </SectionCard>
        </>
      )}

      {loading && !data && (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-pnp-accent border-t-transparent rounded-full animate-spin" />
        </div>
      )}
    </div>
  );
}
