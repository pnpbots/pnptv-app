import React, { useEffect, useState } from "react";
import { Helmet } from "react-helmet-async";
import { useCreatorData } from "@/hooks/useCreatorData";
import { getCreatorSessions, getCreatorSummary, type StreamSession, type StreamAnalyticsSummary } from "@/lib/api";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDuration(seconds: number): string {
  if (!seconds || seconds < 0) return "0m";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

// ── CSS Bar Chart ─────────────────────────────────────────────────────────────
// recharts is not in package.json; using a plain CSS implementation.

interface BarChartProps {
  sessions: StreamSession[];
}

function PeakViewersChart({ sessions }: BarChartProps) {
  const displayed = [...sessions].reverse().slice(-10); // oldest→newest, max 10
  const maxPeak = Math.max(...displayed.map(s => s.peak_viewers), 1);

  return (
    <div className="glass-card-sm p-4">
      <p className="text-sm font-medium text-white mb-3">Peak Viewers — Last {displayed.length} Sessions</p>
      <div className="flex items-end gap-1.5 h-24">
        {displayed.map((s) => {
          const pct = Math.round((s.peak_viewers / maxPeak) * 100);
          return (
            <div key={String(s.id)} className="flex-1 flex flex-col items-center gap-1 group relative">
              {/* Tooltip */}
              <span
                className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 text-[10px] font-medium text-white bg-black/80 rounded px-1.5 py-0.5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10"
              >
                {s.peak_viewers} viewers
                <br />
                {fmtDate(s.started_at)}
              </span>
              <div
                className="w-full rounded-sm transition-all"
                style={{
                  height: `${Math.max(pct, 4)}%`,
                  background: "linear-gradient(180deg, #5ED1C4 0%, #D4007A 100%)",
                  minHeight: "4px",
                }}
              />
            </div>
          );
        })}
      </div>
      {displayed.length === 0 && (
        <p className="text-xs text-center py-4" style={{ color: "#8E8E93" }}>No sessions yet.</p>
      )}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function CreatorAnalytics() {
  const { dashboard, loading: dashLoading } = useCreatorData();

  const [sessions, setSessions] = useState<StreamSession[]>([]);
  const [summary, setSummary] = useState<StreamAnalyticsSummary | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setAnalyticsLoading(true);
    Promise.all([getCreatorSessions(20), getCreatorSummary(30)])
      .then(([sessRes, sumRes]) => {
        if (cancelled) return;
        if (sessRes.success) setSessions(sessRes.sessions);
        if (sumRes.success) setSummary(sumRes.summary);
      })
      .catch(() => {
        if (!cancelled) setError("Failed to load analytics.");
      })
      .finally(() => {
        if (!cancelled) setAnalyticsLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const loading = dashLoading || analyticsLoading;

  return (
    <>
      <Helmet>
        <title>Analytics — Creator Studio — PNPtv!</title>
      </Helmet>
      <div className="p-4 lg:p-6 space-y-6">
        <div>
          <h1 className="text-xl font-bold text-white mb-1">Analytics</h1>
          <p className="text-sm" style={{ color: "#8E8E93" }}>Live stream performance · last 30 days</p>
        </div>

        {loading ? (
          <div className="animate-pulse space-y-4">
            <div className="grid grid-cols-2 gap-3">
              {[1,2,3,4].map(i => <div key={i} className="h-24 bg-white/5 rounded-lg" />)}
            </div>
            <div className="h-32 bg-white/5 rounded-lg" />
            <div className="h-48 bg-white/5 rounded-lg" />
          </div>
        ) : error ? (
          <div className="glass-card-sm p-6 text-center">
            <p className="text-sm" style={{ color: "#D4007A" }}>{error}</p>
          </div>
        ) : (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-2 gap-3">
              <div className="glass-card-sm p-4 text-center">
                <p className="text-2xl font-bold text-white">{summary?.total_sessions ?? 0}</p>
                <p className="text-xs mt-1" style={{ color: "#8E8E93" }}>Total Sessions</p>
              </div>
              <div className="glass-card-sm p-4 text-center">
                <p className="text-2xl font-bold" style={{ color: "#5ED1C4" }}>
                  {summary?.total_hours_live?.toFixed(1) ?? "0.0"}h
                </p>
                <p className="text-xs mt-1" style={{ color: "#8E8E93" }}>Hours Live</p>
              </div>
              <div className="glass-card-sm p-4 text-center">
                <p className="text-2xl font-bold text-white">
                  {summary?.avg_peak_viewers?.toFixed(1) ?? "0.0"}
                </p>
                <p className="text-xs mt-1" style={{ color: "#8E8E93" }}>Avg Peak Viewers</p>
              </div>
              <div className="glass-card-sm p-4 text-center">
                <p className="text-2xl font-bold" style={{ color: "#D4007A" }}>
                  {summary?.total_tips_tokens ?? 0}
                </p>
                <p className="text-xs mt-1" style={{ color: "#8E8E93" }}>Tokens Earned</p>
              </div>
            </div>

            {/* Subscriber / earnings from existing dashboard (non-live) */}
            {dashboard && (
              <div className="grid grid-cols-2 gap-3">
                <div className="glass-card-sm p-4 text-center">
                  <p className="text-2xl font-bold text-white">{dashboard.subscriberCount}</p>
                  <p className="text-xs mt-1" style={{ color: "#8E8E93" }}>Subscribers</p>
                </div>
                <div className="glass-card-sm p-4 text-center">
                  <p className="text-2xl font-bold" style={{ color: "#5ED1C4" }}>
                    ${dashboard.monthlyEarnings.toFixed(2)}
                  </p>
                  <p className="text-xs mt-1" style={{ color: "#8E8E93" }}>Month Earnings</p>
                </div>
              </div>
            )}

            {/* Bar chart */}
            {sessions.length > 0 && <PeakViewersChart sessions={sessions} />}

            {/* Sessions table */}
            <div className="glass-card-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-white/5">
                <p className="text-sm font-semibold text-white">Recent Sessions</p>
              </div>
              {sessions.length === 0 ? (
                <div className="p-6 text-center">
                  <p className="text-sm" style={{ color: "#8E8E93" }}>No stream sessions recorded yet.</p>
                  <p className="text-xs mt-1" style={{ color: "#8E8E93" }}>Session tracking begins automatically when you go live.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs uppercase" style={{ color: "#8E8E93" }}>
                        <th className="px-4 py-2 text-left font-medium">Date</th>
                        <th className="px-4 py-2 text-right font-medium">Duration</th>
                        <th className="px-4 py-2 text-right font-medium">Peak</th>
                        <th className="px-4 py-2 text-right font-medium">Tokens</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sessions.map((s, i) => (
                        <tr
                          key={String(s.id)}
                          className="border-t border-white/5"
                          style={{ background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.02)" }}
                        >
                          <td className="px-4 py-2.5 text-white">
                            <span>{fmtDate(s.started_at)}</span>
                            {!s.ended_at && (
                              <span className="ml-2 text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: "rgba(94,209,196,0.15)", color: "#5ED1C4" }}>
                                LIVE
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-right" style={{ color: "#8E8E93" }}>
                            {fmtDuration(s.duration_seconds)}
                          </td>
                          <td className="px-4 py-2.5 text-right" style={{ color: "#5ED1C4" }}>
                            {s.peak_viewers}
                          </td>
                          <td className="px-4 py-2.5 text-right" style={{ color: "#D4007A" }}>
                            {s.total_tips_tokens}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}
