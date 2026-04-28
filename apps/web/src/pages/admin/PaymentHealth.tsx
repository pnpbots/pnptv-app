import React, { useState, useEffect, useCallback } from "react";
import { getPaymentHealth, type PaymentHealth, type PaymentHealthStuckPayment, type PaymentHealthLeak } from "@/lib/api";

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return String(iso);
  }
}

function fmtAge(hours: number | undefined, minutes: number | undefined): string {
  const h = typeof hours === "number" ? hours : (typeof minutes === "number" ? minutes / 60 : 0);
  if (h < 1) return `${Math.round(h * 60)}m`;
  if (h < 48) return `${Math.round(h)}h`;
  return `${Math.round(h / 24)}d`;
}

function truncate(s: string | null | undefined, max = 24): string {
  if (!s) return "—";
  return s.length > max ? s.slice(0, max) + "…" : s;
}

function num(v: string | number | undefined): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") return parseInt(v, 10) || 0;
  return 0;
}

function StatusPill({ count, label }: { count: number; label: string }) {
  const tone = count === 0
    ? "bg-emerald-900/40 text-emerald-300 border-emerald-800"
    : count < 5
      ? "bg-amber-900/40 text-amber-300 border-amber-800"
      : "bg-red-900/40 text-red-300 border-red-800";
  return (
    <div className={`rounded-lg border px-4 py-3 ${tone}`}>
      <div className="text-xs uppercase tracking-wide opacity-80">{label}</div>
      <div className="text-2xl font-semibold mt-1">{count}</div>
    </div>
  );
}

function StuckEpaycoTable({ items }: { items: PaymentHealthStuckPayment[] }) {
  if (!items.length) return <p className="text-sm text-zinc-400 italic">No stuck ePayco payments.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-zinc-400 border-b border-zinc-700">
          <tr>
            <th className="py-2 pr-3">User</th>
            <th className="py-2 pr-3">Plan</th>
            <th className="py-2 pr-3">Amount</th>
            <th className="py-2 pr-3">Reference</th>
            <th className="py-2 pr-3">Age</th>
            <th className="py-2 pr-3">Created</th>
          </tr>
        </thead>
        <tbody>
          {items.map((p) => (
            <tr key={p.id} className="border-b border-zinc-800 hover:bg-zinc-800/40">
              <td className="py-2 pr-3 font-mono text-xs">{truncate(p.user_id, 24)}</td>
              <td className="py-2 pr-3">{p.plan_id || "—"}</td>
              <td className="py-2 pr-3">${p.amount} {p.currency}</td>
              <td className="py-2 pr-3 font-mono text-xs">{truncate(p.reference, 20)}</td>
              <td className="py-2 pr-3">{fmtAge(p.hours_pending, undefined)}</td>
              <td className="py-2 pr-3">{fmtTime(p.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StuckMeruTable({ items }: { items: PaymentHealthStuckPayment[] }) {
  if (!items.length) return <p className="text-sm text-zinc-400 italic">No stuck Meru links. Reconciler is keeping up.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-zinc-400 border-b border-zinc-700">
          <tr>
            <th className="py-2 pr-3">Code</th>
            <th className="py-2 pr-3">Status</th>
            <th className="py-2 pr-3">Reserved Email</th>
            <th className="py-2 pr-3">Reserved User</th>
            <th className="py-2 pr-3">Age</th>
            <th className="py-2 pr-3">Created</th>
          </tr>
        </thead>
        <tbody>
          {items.map((p) => (
            <tr key={p.code} className="border-b border-zinc-800 hover:bg-zinc-800/40">
              <td className="py-2 pr-3 font-mono">{p.code}</td>
              <td className="py-2 pr-3">{p.status}</td>
              <td className="py-2 pr-3">{p.reserved_for_email || "(orphan)"}</td>
              <td className="py-2 pr-3 font-mono text-xs">{truncate(p.reserved_for_user_id, 20)}</td>
              <td className="py-2 pr-3">{fmtAge(p.hours_since_create, undefined)}</td>
              <td className="py-2 pr-3">{fmtTime(p.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StuckDashTable({ items }: { items: PaymentHealthStuckPayment[] }) {
  if (!items.length) return <p className="text-sm text-zinc-400 italic">No stuck Dash/BTCPay invoices.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-zinc-400 border-b border-zinc-700">
          <tr>
            <th className="py-2 pr-3">User</th>
            <th className="py-2 pr-3">Plan</th>
            <th className="py-2 pr-3">USD</th>
            <th className="py-2 pr-3">Invoice</th>
            <th className="py-2 pr-3">Age</th>
            <th className="py-2 pr-3">Created</th>
          </tr>
        </thead>
        <tbody>
          {items.map((p) => (
            <tr key={p.id} className="border-b border-zinc-800 hover:bg-zinc-800/40">
              <td className="py-2 pr-3 font-mono text-xs">{truncate(p.user_id, 24)}</td>
              <td className="py-2 pr-3">{p.plan_id || "—"}</td>
              <td className="py-2 pr-3">${p.usd_amount}</td>
              <td className="py-2 pr-3 font-mono text-xs">{truncate(p.btcpay_invoice_id, 16)}</td>
              <td className="py-2 pr-3">{fmtAge(undefined, p.minutes_pending)}</td>
              <td className="py-2 pr-3">{fmtTime(p.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LeaksTable({ items }: { items: PaymentHealthLeak[] }) {
  if (!items.length) return <p className="text-sm text-zinc-400 italic">No suspicious access patterns in the last 7 days. ✓</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-zinc-400 border-b border-zinc-700">
          <tr>
            <th className="py-2 pr-3">URL</th>
            <th className="py-2 pr-3">Distinct Users</th>
            <th className="py-2 pr-3">Distinct IPs</th>
            <th className="py-2 pr-3">Fetches</th>
            <th className="py-2 pr-3">Last Hit</th>
          </tr>
        </thead>
        <tbody>
          {items.map((l) => {
            const u = num(l.distinct_users);
            const ips = num(l.distinct_ips);
            const danger = u >= 3 || ips >= 5;
            return (
              <tr key={l.media_url} className={`border-b border-zinc-800 hover:bg-zinc-800/40 ${danger ? "bg-red-900/10" : ""}`}>
                <td className="py-2 pr-3 font-mono text-xs">{truncate(l.media_url, 50)}</td>
                <td className="py-2 pr-3">{u}</td>
                <td className="py-2 pr-3">{ips}</td>
                <td className="py-2 pr-3">{l.total_fetches}</td>
                <td className="py-2 pr-3">{fmtTime(l.last_fetched)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function PaymentHealth() {
  const [data, setData] = useState<PaymentHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getPaymentHealth();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh every 60s while page is open.
  useEffect(() => {
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [load]);

  if (loading && !data) {
    return <div className="p-6 text-zinc-400">Loading payment health…</div>;
  }
  if (error) {
    return (
      <div className="p-6">
        <p className="text-red-400">{error}</p>
        <button onClick={load} className="mt-3 px-3 py-1 bg-zinc-800 rounded hover:bg-zinc-700">Retry</button>
      </div>
    );
  }
  if (!data) return null;

  const total = data.stuck.epayco.count + data.stuck.meru.count + data.stuck.dash.count;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Payment Health</h1>
          <p className="text-sm text-zinc-400 mt-1">
            Stuck payments, suspicious access, and reconciler activity. Refreshes every 60s.
          </p>
        </div>
        <button
          onClick={load}
          className="px-4 py-2 bg-pnp-primary hover:bg-pnp-primary/80 rounded text-sm"
          disabled={loading}
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatusPill count={total} label="Stuck Total" />
        <StatusPill count={data.stuck.epayco.count} label="ePayco Stuck" />
        <StatusPill count={data.stuck.meru.count} label="Meru Stuck" />
        <StatusPill count={data.stuck.dash.count} label="Dash Stuck" />
      </div>

      {/* 7-day activity */}
      <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-4">
        <h2 className="text-sm uppercase tracking-wide text-zinc-400 mb-3">7-day Activity</h2>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
          <div><div className="text-zinc-400 text-xs">ePayco completed</div><div className="text-lg font-mono">{data.activity.epayco_completed_7d ?? 0}</div></div>
          <div><div className="text-zinc-400 text-xs">Dash completed</div><div className="text-lg font-mono">{data.activity.dash_completed_7d ?? 0}</div></div>
          <div><div className="text-zinc-400 text-xs">Meru completed</div><div className="text-lg font-mono">{data.activity.meru_completed_7d ?? 0}</div></div>
          <div><div className="text-zinc-400 text-xs">Video fetches</div><div className="text-lg font-mono">{data.activity.video_views_7d ?? 0}</div></div>
          <div><div className="text-zinc-400 text-xs">Distinct videos</div><div className="text-lg font-mono">{data.activity.distinct_videos_7d ?? 0}</div></div>
        </div>
      </div>

      {/* Leaks first — highest priority for security review */}
      <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-4">
        <h2 className="text-sm uppercase tracking-wide text-zinc-400 mb-3">
          Suspicious Access (last 7d) — {data.leaks.count}
        </h2>
        <LeaksTable items={data.leaks.items} />
      </div>

      <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-4">
        <h2 className="text-sm uppercase tracking-wide text-zinc-400 mb-3">
          Stuck ePayco — {data.stuck.epayco.count}
        </h2>
        <StuckEpaycoTable items={data.stuck.epayco.items} />
      </div>

      <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-4">
        <h2 className="text-sm uppercase tracking-wide text-zinc-400 mb-3">
          Stuck Meru — {data.stuck.meru.count}
        </h2>
        <StuckMeruTable items={data.stuck.meru.items} />
      </div>

      <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-4">
        <h2 className="text-sm uppercase tracking-wide text-zinc-400 mb-3">
          Stuck Dash/BTCPay — {data.stuck.dash.count}
        </h2>
        <StuckDashTable items={data.stuck.dash.items} />
      </div>

      <p className="text-xs text-zinc-500">
        Generated at {fmtTime(data.generated_at)}.
      </p>
    </div>
  );
}
