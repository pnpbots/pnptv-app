import React, { useState, useEffect, useCallback, useRef } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ReferralStats {
  total: number;
  completed: number;
  pending: number;
  totalTokensPaidOut: number;
  uniqueReferrers: number;
}

interface ReferralRow {
  referrer_username: string | null;
  referee_username: string | null;
  code: string;
  status: "pending" | "completed";
  reward_tokens: number;
  created_at: string;
  completed_at: string | null;
  referee_ip: string | null;
}

interface AdminReferralResponse {
  success: boolean;
  stats: ReferralStats;
  rows: ReferralRow[];
  total: number;
  page: number;
  pages: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short", day: "numeric", year: "numeric",
    });
  } catch {
    return iso;
  }
}

function StatCard({ label, value, accent }: { label: string; value: string | number; accent?: boolean }) {
  return (
    <div
      className="rounded-xl px-4 py-3 flex flex-col gap-1"
      style={{
        background: accent ? "rgba(212,0,122,0.10)" : "rgba(255,255,255,0.04)",
        border: accent ? "1px solid rgba(212,0,122,0.25)" : "1px solid rgba(255,255,255,0.08)",
      }}
    >
      <span className="text-xs uppercase tracking-wide" style={{ color: "rgba(255,255,255,0.45)" }}>{label}</span>
      <span
        className="text-2xl font-bold"
        style={{ color: accent ? "#D4007A" : "#fff" }}
      >
        {value}
      </span>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const completed = status === "completed";
  return (
    <span
      className="text-xs font-semibold px-2 py-0.5 rounded-full"
      style={
        completed
          ? { background: "rgba(34,197,94,0.12)", color: "#4ADE80", border: "1px solid rgba(34,197,94,0.20)" }
          : { background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.45)", border: "1px solid rgba(255,255,255,0.10)" }
      }
    >
      {completed ? "Completed" : "Pending"}
    </span>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ReferralAdmin() {
  const [data, setData]       = useState<AdminReferralResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [status, setStatus]   = useState<"all" | "pending" | "completed">("all");
  const [search, setSearch]   = useState("");
  const [page, setPage]       = useState(1);
  const debounceRef           = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchData = useCallback(async (s: string, st: string, p: number) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(p), limit: "50", status: st });
      if (s.trim()) params.set("search", s.trim());
      const res = await fetch(`/api/webapp/admin/referrals?${params.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: AdminReferralResponse = await res.json();
      setData(json);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load referral data");
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial + refetch on filter/page change
  useEffect(() => {
    fetchData(search, status, page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, page]);

  // Debounced search
  const handleSearchChange = (val: string) => {
    setSearch(val);
    setPage(1);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchData(val, status, 1);
    }, 350);
  };

  const handleStatusChange = (val: "all" | "pending" | "completed") => {
    setStatus(val);
    setPage(1);
  };

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white">Referrals</h1>
        <p className="text-sm mt-1" style={{ color: "rgba(255,255,255,0.45)" }}>
          All referral attributions and rewards
        </p>
      </div>

      {/* Stats bar */}
      {data?.stats && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
          <StatCard label="Total" value={data.stats.total} />
          <StatCard label="Completed" value={data.stats.completed} accent />
          <StatCard label="Pending" value={data.stats.pending} />
          <StatCard label="Tokens paid out" value={data.stats.totalTokensPaidOut} />
          <StatCard label="Unique referrers" value={data.stats.uniqueReferrers} />
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <select
          value={status}
          onChange={(e) => handleStatusChange(e.target.value as "all" | "pending" | "completed")}
          className="rounded-xl px-3 py-2 text-sm text-white focus:outline-none"
          style={{
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.12)",
          }}
        >
          <option value="all">All statuses</option>
          <option value="pending">Pending</option>
          <option value="completed">Completed</option>
        </select>
        <input
          type="text"
          placeholder="Search by username..."
          value={search}
          onChange={(e) => handleSearchChange(e.target.value)}
          className="flex-1 rounded-xl px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none"
          style={{
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.12)",
          }}
        />
        <button
          type="button"
          onClick={() => fetchData(search, status, page)}
          className="px-4 py-2 rounded-xl text-sm font-semibold text-white transition-all"
          style={{ background: "rgba(212,0,122,0.20)", border: "1px solid rgba(212,0,122,0.35)" }}
        >
          Refresh
        </button>
      </div>

      {/* Error */}
      {error && (
        <div
          className="rounded-xl p-4 text-sm text-red-400 mb-5"
          style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.20)" }}
        >
          {error}
        </div>
      )}

      {/* Table */}
      <div
        className="rounded-2xl overflow-hidden"
        style={{ border: "1px solid rgba(255,255,255,0.08)" }}
      >
        {/* Table header */}
        <div
          className="hidden sm:grid text-xs uppercase tracking-wide px-4 py-2.5"
          style={{
            gridTemplateColumns: "1fr 1fr 80px 90px 70px 100px 90px 120px",
            background: "rgba(255,255,255,0.04)",
            borderBottom: "1px solid rgba(255,255,255,0.07)",
            color: "rgba(255,255,255,0.40)",
          }}
        >
          <span>Referrer</span>
          <span>Referee</span>
          <span>Code</span>
          <span>Status</span>
          <span>Tokens</span>
          <span>IP</span>
          <span>Date</span>
          <span>Completed</span>
        </div>

        {/* Loading */}
        {loading && (
          <div className="px-4 py-8 text-center text-sm" style={{ color: "rgba(255,255,255,0.35)" }}>
            Loading...
          </div>
        )}

        {/* Rows */}
        {!loading && data && data.rows.length === 0 && (
          <div className="px-4 py-8 text-center text-sm" style={{ color: "rgba(255,255,255,0.35)" }}>
            No referrals found.
          </div>
        )}

        {!loading && data && data.rows.map((row, i) => (
          <div
            key={i}
            className="sm:grid px-4 py-3 text-sm"
            style={{
              gridTemplateColumns: "1fr 1fr 80px 90px 70px 100px 90px 120px",
              background: i % 2 === 0 ? "rgba(255,255,255,0.02)" : "transparent",
              borderBottom: i < data.rows.length - 1 ? "1px solid rgba(255,255,255,0.05)" : "none",
            }}
          >
            {/* Mobile label + Desktop grid */}
            <span className="block sm:hidden text-xs mb-1" style={{ color: "rgba(255,255,255,0.30)" }}>
              {row.referrer_username ?? "—"} → {row.referee_username ?? "—"}
            </span>
            <span className="hidden sm:block text-white/75 truncate">{row.referrer_username ?? "—"}</span>
            <span className="hidden sm:block text-white/75 truncate">{row.referee_username ?? "—"}</span>
            <span
              className="hidden sm:block font-mono text-xs self-center"
              style={{ color: "rgba(255,255,255,0.50)" }}
            >
              {row.code}
            </span>
            <span className="hidden sm:flex items-center">
              <StatusBadge status={row.status} />
            </span>
            <span
              className="hidden sm:block self-center font-semibold"
              style={{ color: row.reward_tokens > 0 ? "#D4007A" : "rgba(255,255,255,0.35)" }}
            >
              {row.reward_tokens > 0 ? `+${row.reward_tokens}` : "—"}
            </span>
            <span
              className="hidden sm:block font-mono text-xs self-center truncate"
              style={{ color: "rgba(255,255,255,0.35)" }}
            >
              {row.referee_ip ?? "—"}
            </span>
            <span
              className="hidden sm:block text-xs self-center"
              style={{ color: "rgba(255,255,255,0.45)" }}
            >
              {fmtDate(row.created_at)}
            </span>
            <span
              className="hidden sm:block text-xs self-center"
              style={{ color: "rgba(255,255,255,0.45)" }}
            >
              {fmtDate(row.completed_at)}
            </span>

            {/* Mobile summary row */}
            <div className="sm:hidden flex items-center justify-between mt-1">
              <StatusBadge status={row.status} />
              <span className="text-xs" style={{ color: "rgba(255,255,255,0.40)" }}>
                {fmtDate(row.created_at)}
              </span>
              {row.reward_tokens > 0 && (
                <span className="text-xs font-bold" style={{ color: "#D4007A" }}>
                  +{row.reward_tokens} tokens
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Pagination */}
      {data && data.pages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <span className="text-xs" style={{ color: "rgba(255,255,255,0.40)" }}>
            Page {data.page} of {data.pages} ({data.total} rows)
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-40 transition-all"
              style={{
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.10)",
                color: "rgba(255,255,255,0.75)",
              }}
            >
              Prev
            </button>
            <button
              type="button"
              disabled={page >= (data.pages ?? 1)}
              onClick={() => setPage((p) => p + 1)}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-40 transition-all"
              style={{
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.10)",
                color: "rgba(255,255,255,0.75)",
              }}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
