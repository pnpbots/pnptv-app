/**
 * SettingsLegacy.tsx
 *
 * Contains the WellnessModeCard, UseTrackerCard, and their helper utilities
 * that were originally defined in Settings.tsx. Extracted here so they can be
 * imported by SelfCareCenter.tsx and WellnessShell.tsx without pulling in the
 * full Settings page bundle.
 *
 * Settings.tsx re-exports everything from here for backward compatibility.
 */
import React, { useState, useEffect, useCallback } from "react";
import {
  getWellnessMode,
  enableWellnessMode,
  disableWellnessMode,
  cancelDisableWellnessMode,
  getUseStats,
  logUse,
  type WellnessModeStatus,
  type UseTrackerData,
  type UseTypeStats,
} from "@/lib/api";

// ── Wellness Mode helpers ─────────────────────────────────────────────────────

function fmtUntil(iso: string | null, indefinite: boolean): string {
  if (indefinite) return "indefinite";
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

// ── WellnessModeCard ──────────────────────────────────────────────────────────

export function WellnessModeCard() {
  const [status, setStatus] = useState<WellnessModeStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [duration, setDuration] = useState<1 | 7 | 30 | "indefinite">(7);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await getWellnessMode();
      setStatus(r);
    } catch {
      setError("Couldn't reach the server — try refreshing.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const onEnable = async () => {
    setBusy(true); setError(null);
    try {
      const days = duration === "indefinite" ? null : duration;
      const r = await enableWellnessMode(days);
      setStatus(r);
    } catch {
      setError("Something got in the way — give it a moment and try again. You've got this.");
    } finally {
      setBusy(false);
    }
  };

  const onDisableClick = async () => {
    setBusy(true); setError(null);
    try {
      const r = await disableWellnessMode();
      setStatus(r);
    } catch {
      setError("Couldn't reach the server — your Wellness Mode is still protecting you. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  };

  const onCancelDisable = async () => {
    setBusy(true); setError(null);
    try {
      const r = await cancelDisableWellnessMode();
      setStatus(r);
    } catch {
      setError("Couldn't reach the server — your cooling-off period is still running. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="glass-card-sm p-5 mt-4">
        <h2 className="text-sm font-semibold text-white mb-4 tracking-wide uppercase opacity-60">Wellness Break Mode</h2>
        <div className="h-12 rounded bg-white/5 animate-pulse" />
      </div>
    );
  }
  if (!status) return null;

  const inCoolingOff = status.active && status.disableRequestedAt && (status.hoursLeftUntilDisableAllowed ?? 0) > 0;
  const coolingOffComplete = status.active && status.disableRequestedAt && (status.hoursLeftUntilDisableAllowed ?? 1) <= 0;
  const hoursLeft = Math.ceil(status.hoursLeftUntilDisableAllowed ?? 0);

  return (
    <div className="glass-card-sm p-5 mt-4" style={{ borderColor: status.active ? "rgba(94,209,196,0.4)" : undefined }}>
      <h2 className="text-sm font-semibold text-white mb-1 tracking-wide uppercase opacity-60 flex items-center gap-2">
        <span>🧘 Wellness Break Mode</span>
        {status.active && (
          <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded" style={{ background: "rgba(94,209,196,0.2)", color: "#5ED1C4" }}>
            ACTIVE
          </span>
        )}
      </h2>
      {(status.wellnessDaysAccumulated ?? 0) > 0 && (
        <p className="text-xs mb-4" style={{ color: "#5ED1C4" }}>
          {status.wellnessDaysAccumulated} day{status.wellnessDaysAccumulated === 1 ? "" : "s"} of self-care, total. That's real.
        </p>
      )}
      {(status.wellnessDaysAccumulated ?? 0) === 0 && <div className="mb-4" />}

      {!status.active && (
        <>
          <p className="text-sm text-white/70 mb-4 leading-relaxed">
            Hide everything except wellness hangouts, Cristina, and your settings. For when you need a sober break, are in recovery, or just want to step away from the rest of the platform. <strong className="text-white">Once enabled, it cannot be turned off without a 24-hour wait</strong> — that's the point.
          </p>
          <div className="space-y-3">
            <label className="block text-xs uppercase tracking-wider text-white/50">Duration</label>
            <div className="grid grid-cols-4 gap-2">
              {([1, 7, 30, "indefinite"] as const).map((d) => (
                <button
                  key={d}
                  onClick={() => setDuration(d)}
                  disabled={busy}
                  className="rounded-lg py-2 text-sm font-semibold transition-all"
                  style={{
                    background: duration === d ? "rgba(94,209,196,0.2)" : "rgba(255,255,255,0.04)",
                    border: `1px solid ${duration === d ? "rgba(94,209,196,0.5)" : "rgba(255,255,255,0.08)"}`,
                    color: duration === d ? "#5ED1C4" : "rgba(255,255,255,0.7)",
                  }}
                >
                  {d === "indefinite" ? "∞" : `${d}d`}
                </button>
              ))}
            </div>
            <button
              onClick={onEnable}
              disabled={busy}
              className="w-full rounded-lg py-2.5 text-sm font-semibold transition-all"
              style={{ background: "linear-gradient(135deg, #5ED1C4 0%, #4FB3A8 100%)", color: "#0d1f1c" }}
            >
              {busy ? "Enabling…" : `Enable for ${duration === "indefinite" ? "indefinite" : duration + " day" + (duration === 1 ? "" : "s")}`}
            </button>
          </div>
        </>
      )}

      {status.active && !inCoolingOff && !coolingOffComplete && (
        <>
          <p className="text-sm text-white/70 mb-3 leading-relaxed">
            You're in Wellness Break Mode {status.indefinite ? "indefinitely" : `until ${fmtUntil(status.until, false)}`}.
            Only the Wellness Break hangouts, Cristina, and Settings are accessible.
          </p>
          {!status.indefinite && status.until && new Date(status.until).getTime() > Date.now() && (
            <p className="text-xs text-white/50 mb-3">
              Mode will end automatically at the time above. You can extend by re-enabling with a longer duration.
            </p>
          )}
          <button
            onClick={onDisableClick}
            disabled={busy}
            className="w-full rounded-lg py-2.5 text-sm font-semibold border transition-all"
            style={{ borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.7)", background: "transparent" }}
          >
            {busy ? "…" : `Request to disable (24h cooling-off)`}
          </button>
        </>
      )}

      {coolingOffComplete && (
        <>
          <p className="text-sm text-green-300/80 mb-3 leading-relaxed">
            <strong>Cooling-off complete.</strong> Your 24-hour wait has passed. You can now disable Wellness Mode — or stay in it if you've changed your mind.
          </p>
          <div className="flex gap-2">
            <button
              onClick={onDisableClick}
              disabled={busy}
              className="flex-1 rounded-lg py-2.5 text-sm font-semibold transition-all"
              style={{ background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.35)", color: "rgba(252,165,165,0.9)" }}
            >
              {busy ? "…" : "Disable now"}
            </button>
            <button
              onClick={onCancelDisable}
              disabled={busy}
              className="flex-1 rounded-lg py-2.5 text-sm font-semibold transition-all"
              style={{ background: "rgba(94,209,196,0.2)", border: "1px solid rgba(94,209,196,0.4)", color: "#5ED1C4" }}
            >
              {busy ? "…" : "Stay in mode"}
            </button>
          </div>
        </>
      )}

      {inCoolingOff && (
        <>
          <p className="text-sm text-amber-200/80 mb-3 leading-relaxed">
            <strong>Disable requested.</strong> Wellness Mode will turn off in <strong>{hoursLeft} hour{hoursLeft === 1 ? "" : "s"}</strong> if you don't cancel before then. The wait is a feature — give yourself time to make sure this is what you want.
          </p>
          <button
            onClick={onCancelDisable}
            disabled={busy}
            className="w-full rounded-lg py-2.5 text-sm font-semibold transition-all"
            style={{ background: "rgba(94,209,196,0.2)", border: "1px solid rgba(94,209,196,0.4)", color: "#5ED1C4" }}
          >
            {busy ? "…" : "Cancel disable request — stay in Wellness Mode"}
          </button>
        </>
      )}

      {error && (
        <p className="text-xs mt-3 leading-relaxed" style={{ color: "rgba(94,209,196,0.8)" }}>{error}</p>
      )}
    </div>
  );
}

// ── Use Tracker helpers ───────────────────────────────────────────────────────

function relTime(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function daysSinceLastParty(data: UseTrackerData | null): number | null {
  if (!data) return null;
  const candidates = [data.slam.lastAt, data.smoke.lastAt].filter(Boolean) as string[];
  if (candidates.length === 0) return null;
  const latest = Math.max(...candidates.map(s => new Date(s).getTime()));
  const elapsedMs = Date.now() - latest;
  return Math.max(0, Math.floor(elapsedMs / 86_400_000));
}

export function encouragementPhrase(days: number | null): { headline: string; body: string; accent: string } {
  if (days === null) {
    return {
      headline: "Track your first session whenever you're ready.",
      body: "No streaks to chase, just awareness.",
      accent: "rgba(255,255,255,0.5)",
    };
  }
  if (days === 0) {
    return {
      headline: "Logged today.",
      body: "Be gentle with yourself — rest is part of the play. Your body needs time to be ready for the next one.",
      accent: "#FBBF24",
    };
  }
  if (days <= 2) {
    return {
      headline: `It's been ${days} day${days === 1 ? "" : "s"} since you last partied.`,
      body: "Your body's still recovering — keep listening to it. Sleep, water, food. The next one will hit better when you're rested.",
      accent: "#A78BFA",
    };
  }
  if (days <= 6) {
    return {
      headline: `${days} days since your last party.`,
      body: "Your body's getting strong again — that's worth something. Whatever you choose next, you've given yourself the runway.",
      accent: "#5ED1C4",
    };
  }
  if (days <= 29) {
    return {
      headline: `${days} days clear.`,
      body: "Real progress. Whatever comes next, you've earned the rest. You're proving to yourself you've got control over this.",
      accent: "#5ED1C4",
    };
  }
  return {
    headline: `${days} days. That's huge.`,
    body: "Whether this is a long break or a permanent shift, you're doing something most people never even attempt. Keep going.",
    accent: "#5ED1C4",
  };
}

const TRACKER_KINDS = [
  { key: "slam" as const, label: "Slam", icon: "💉", accent: "#A78BFA" },
  { key: "smoke" as const, label: "Smoke", icon: "💨", accent: "#FBBF24" },
];

function StatCell({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex flex-col items-center">
      <div className="text-base font-bold text-white tabular-nums leading-tight">{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-white/40">{label}</div>
    </div>
  );
}

function UsageGrid({ recentDays, accent }: { recentDays: boolean[]; accent: string }) {
  const days = recentDays.slice(0, 30);
  while (days.length < 30) days.push(false);
  const ordered = [...days].reverse();
  return (
    <div className="flex gap-[3px] flex-wrap" aria-label="30-day usage history">
      {ordered.map((used, i) => (
        <div
          key={i}
          className="h-2 w-2 rounded-sm"
          style={{
            background: used ? accent : "rgba(255,255,255,0.07)",
            boxShadow: used ? `0 0 4px ${accent}80` : undefined,
          }}
          title={i === 29 ? "today" : `${29 - i} day${29 - i === 1 ? "" : "s"} ago`}
        />
      ))}
    </div>
  );
}

function TrackerKindRow({
  kind,
  stats,
  busy,
  onLog,
}: {
  kind: typeof TRACKER_KINDS[number];
  stats: UseTypeStats | undefined;
  busy: boolean;
  onLog: () => void;
}) {
  const safe: UseTypeStats = stats ?? { lastAt: null, today: 0, week: 0, month: 0, recentDays: [] };
  return (
    <div
      className="rounded-xl p-3"
      style={{
        background: "rgba(255,255,255,0.03)",
        border: `1px solid ${kind.accent}30`,
      }}
    >
      <div className="flex items-center gap-3 mb-3">
        <button
          onClick={onLog}
          disabled={busy}
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition-all disabled:opacity-50"
          style={{
            background: `${kind.accent}20`,
            border: `1px solid ${kind.accent}50`,
            color: kind.accent,
          }}
          aria-label={`Log a ${kind.label.toLowerCase()}`}
        >
          <span className="text-lg">{kind.icon}</span>
          <span>Log {kind.label}</span>
        </button>
        <div className="flex-1 grid grid-cols-4 gap-2 ml-auto">
          <StatCell label="today" value={safe.today} />
          <StatCell label="7d" value={safe.week} />
          <StatCell label="30d" value={safe.month} />
          <StatCell label="last" value={relTime(safe.lastAt)} />
        </div>
      </div>
      <UsageGrid recentDays={safe.recentDays} accent={kind.accent} />
    </div>
  );
}

// ── UseTrackerCard ────────────────────────────────────────────────────────────

export function UseTrackerCard() {
  const [data, setData] = useState<UseTrackerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"slam" | "smoke" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await getUseStats();
      setData({ slam: r.slam, smoke: r.smoke });
    } catch {
      setError("Couldn't load your tracker — try refreshing.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const onLog = async (type: "slam" | "smoke") => {
    setBusy(type); setError(null);
    try {
      const r = await logUse(type);
      setData({ slam: r.slam, smoke: r.smoke });
    } catch {
      setError("Couldn't save that — your last tap didn't go through. Try again.");
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return (
      <div className="glass-card-sm p-5 mt-4">
        <h2 className="text-sm font-semibold text-white mb-4 tracking-wide uppercase opacity-60">Use Tracker</h2>
        <div className="h-24 rounded bg-white/5 animate-pulse" />
      </div>
    );
  }

  const total = (data?.slam.month ?? 0) + (data?.smoke.month ?? 0);

  return (
    <div className="glass-card-sm p-5 mt-4">
      <div className="flex items-baseline justify-between mb-1">
        <h2 className="text-sm font-semibold text-white tracking-wide uppercase opacity-60">Use Tracker</h2>
        <span className="text-[10px] uppercase tracking-wider text-white/30">Private</span>
      </div>
      <p className="text-xs text-white/50 mb-4 leading-relaxed">
        A private space to track your use — no one else sees this. Awareness is the first step in harm reduction.
      </p>

      {(() => {
        const days = daysSinceLastParty(data);
        const phrase = encouragementPhrase(days);
        return (
          <div
            className="rounded-xl px-3 py-2.5 mb-3 leading-relaxed"
            style={{
              background: `linear-gradient(135deg, ${phrase.accent}18, ${phrase.accent}08)`,
              border: `1px solid ${phrase.accent}30`,
            }}
          >
            <p className="text-sm font-semibold" style={{ color: phrase.accent }}>{phrase.headline}</p>
            <p className="text-xs text-white/70 mt-0.5">{phrase.body}</p>
          </div>
        );
      })()}

      <div className="space-y-3">
        {TRACKER_KINDS.map((k) => (
          <TrackerKindRow
            key={k.key}
            kind={k}
            stats={data?.[k.key]}
            busy={busy !== null}
            onLog={() => onLog(k.key)}
          />
        ))}
      </div>

      {total === 0 && (
        <p className="text-xs text-white/40 mt-3 italic leading-relaxed">
          Nothing logged in the last 30 days. Tap a button when you want to log — no judgment, no streaks to break.
        </p>
      )}

      {error && (
        <p className="text-xs mt-3 leading-relaxed" style={{ color: "rgba(251,191,36,0.85)" }}>{error}</p>
      )}
    </div>
  );
}
