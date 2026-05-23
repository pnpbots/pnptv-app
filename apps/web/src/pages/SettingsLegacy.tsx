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
import { useI18n } from "@/lib/i18n";
import type { I18n } from "@/lib/i18n";

// ── Wellness Mode helpers ─────────────────────────────────────────────────────

function fmtUntil(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

// ── WellnessModeCard ──────────────────────────────────────────────────────────

export function WellnessModeCard() {
  const t = useI18n();
  const tw = t.wellness;
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
      setError(tw.modeCardErrLoad);
    } finally {
      setLoading(false);
    }
  }, [tw.modeCardErrLoad]);

  useEffect(() => { load(); }, [load]);

  const onEnable = async () => {
    setBusy(true); setError(null);
    try {
      const days = duration === "indefinite" ? null : duration;
      const r = await enableWellnessMode(days);
      setStatus(r);
    } catch {
      setError(tw.modeCardErrEnable);
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
      setError(tw.modeCardErrDisable);
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
      setError(tw.modeCardErrCancelDisable);
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="glass-card-sm p-5 mt-4">
        <h2 className="text-sm font-semibold text-white mb-4 tracking-wide uppercase opacity-60">{tw.modeCardTitle}</h2>
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
        <span>🧘 {tw.modeCardTitle}</span>
        {status.active && (
          <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded" style={{ background: "rgba(94,209,196,0.2)", color: "#5ED1C4" }}>
            {tw.modeCardActiveBadge}
          </span>
        )}
      </h2>
      {(status.wellnessDaysAccumulated ?? 0) > 0 && (
        <p className="text-xs mb-4" style={{ color: "#5ED1C4" }}>
          {((status.wellnessDaysAccumulated ?? 0) === 1 ? tw.modeCardDaysAccumulatedOne : tw.modeCardDaysAccumulatedMany)
            .replace("{days}", String(status.wellnessDaysAccumulated))}
        </p>
      )}
      {(status.wellnessDaysAccumulated ?? 0) === 0 && <div className="mb-4" />}

      {!status.active && (
        <>
          <p className="text-sm text-white/70 mb-4 leading-relaxed">
            {tw.modeCardDescInactive}{" "}
            <strong className="text-white">{tw.modeCardDescInactiveBold}</strong>.
          </p>
          <div className="space-y-3">
            <label className="block text-xs uppercase tracking-wider text-white/50">{tw.modeCardDurationLabel}</label>
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
              {busy
                ? tw.modeCardEnablingBusy
                : duration === "indefinite"
                  ? tw.modeCardEnableIndefinite
                  : duration === 1
                    ? tw.modeCardEnableForDayOne
                    : tw.modeCardEnableForDays.replace("{days}", String(duration))}
            </button>
          </div>
        </>
      )}

      {status.active && !inCoolingOff && !coolingOffComplete && (
        <>
          <p className="text-sm text-white/70 mb-3 leading-relaxed">
            {status.indefinite
              ? tw.modeCardActiveIndefinite
              : tw.modeCardActiveUntil.replace("{date}", fmtUntil(status.until))}
          </p>
          {!status.indefinite && status.until && new Date(status.until).getTime() > Date.now() && (
            <p className="text-xs text-white/50 mb-3">{tw.modeCardAutoEndNote}</p>
          )}
          <button
            onClick={onDisableClick}
            disabled={busy}
            className="w-full rounded-lg py-2.5 text-sm font-semibold border transition-all"
            style={{ borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.7)", background: "transparent" }}
          >
            {busy ? tw.modeCardBusy : tw.modeCardDisableButton}
          </button>
        </>
      )}

      {coolingOffComplete && (
        <>
          <p className="text-sm text-green-300/80 mb-3 leading-relaxed">{tw.modeCardCoolingCompleteText}</p>
          <div className="flex gap-2">
            <button
              onClick={onDisableClick}
              disabled={busy}
              className="flex-1 rounded-lg py-2.5 text-sm font-semibold transition-all"
              style={{ background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.35)", color: "rgba(252,165,165,0.9)" }}
            >
              {busy ? tw.modeCardBusy : tw.modeCardDisableNow}
            </button>
            <button
              onClick={onCancelDisable}
              disabled={busy}
              className="flex-1 rounded-lg py-2.5 text-sm font-semibold transition-all"
              style={{ background: "rgba(94,209,196,0.2)", border: "1px solid rgba(94,209,196,0.4)", color: "#5ED1C4" }}
            >
              {busy ? tw.modeCardBusy : tw.modeCardStayInMode}
            </button>
          </div>
        </>
      )}

      {inCoolingOff && (
        <>
          <p className="text-sm text-amber-200/80 mb-3 leading-relaxed">
            {(hoursLeft === 1 ? tw.modeCardCoolingOffHourOne : tw.modeCardCoolingOffHours)
              .replace("{hours}", String(hoursLeft))}
          </p>
          <button
            onClick={onCancelDisable}
            disabled={busy}
            className="w-full rounded-lg py-2.5 text-sm font-semibold transition-all"
            style={{ background: "rgba(94,209,196,0.2)", border: "1px solid rgba(94,209,196,0.4)", color: "#5ED1C4" }}
          >
            {busy ? tw.modeCardBusy : tw.modeCardCancelButton}
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

function relTime(iso: string | null, tw: I18n["wellness"]): string {
  if (!iso) return tw.relTimeNever;
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return tw.relTimeJustNow;
  const m = Math.floor(ms / 60_000);
  if (m < 60) return tw.relTimeMinAgo.replace("{m}", String(m));
  const h = Math.floor(m / 60);
  if (h < 24) return tw.relTimeHourAgo.replace("{h}", String(h));
  const d = Math.floor(h / 24);
  if (d < 7) return tw.relTimeDayAgo.replace("{d}", String(d));
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

export function encouragementPhrase(
  days: number | null,
  tw: I18n["wellness"],
): { headline: string; body: string; accent: string } {
  if (days === null) {
    return { headline: tw.phraseNullHeadline, body: tw.phraseNullBody, accent: "rgba(255,255,255,0.5)" };
  }
  if (days === 0) {
    return { headline: tw.phrase0Headline, body: tw.phrase0Body, accent: "#FBBF24" };
  }
  if (days <= 2) {
    return {
      headline: (days === 1 ? tw.phrase1Headline : tw.phrase2Headline).replace("{days}", String(days)),
      body: tw.phrase1to2Body,
      accent: "#A78BFA",
    };
  }
  if (days <= 6) {
    return {
      headline: tw.phrase3to6Headline.replace("{days}", String(days)),
      body: tw.phrase3to6Body,
      accent: "#5ED1C4",
    };
  }
  if (days <= 29) {
    return {
      headline: tw.phrase7to29Headline.replace("{days}", String(days)),
      body: tw.phrase7to29Body,
      accent: "#5ED1C4",
    };
  }
  return {
    headline: tw.phrase30plusHeadline.replace("{days}", String(days)),
    body: tw.phrase30plusBody,
    accent: "#5ED1C4",
  };
}

type TrackerKind = { key: "slam" | "smoke"; label: string; icon: string; accent: string };

function StatCell({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex flex-col items-center">
      <div className="text-base font-bold text-white tabular-nums leading-tight">{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-white/40">{label}</div>
    </div>
  );
}

function UsageGrid({ recentDays, accent }: { recentDays: boolean[]; accent: string }) {
  const t = useI18n();
  const tw = t.wellness;
  const days = recentDays.slice(0, 30);
  while (days.length < 30) days.push(false);
  const ordered = [...days].reverse();
  return (
    <div className="flex gap-[3px] flex-wrap" aria-label={tw.trackerGridAria}>
      {ordered.map((used, i) => (
        <div
          key={i}
          className="h-2 w-2 rounded-sm"
          style={{
            background: used ? accent : "rgba(255,255,255,0.07)",
            boxShadow: used ? `0 0 4px ${accent}80` : undefined,
          }}
          title={
            i === 29
              ? tw.trackerGridTooltipToday
              : (29 - i === 1 ? tw.trackerGridTooltipDayAgo : tw.trackerGridTooltipDaysAgo)
                  .replace("{n}", String(29 - i))
          }
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
  kind: TrackerKind;
  stats: UseTypeStats | undefined;
  busy: boolean;
  onLog: () => void;
}) {
  const t = useI18n();
  const tw = t.wellness;
  const safe: UseTypeStats = stats ?? { lastAt: null, today: 0, week: 0, month: 0, recentDays: [] };
  return (
    <div
      className="rounded-xl p-3"
      style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${kind.accent}30` }}
    >
      <div className="flex items-center gap-3 mb-3">
        <button
          onClick={onLog}
          disabled={busy}
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition-all disabled:opacity-50"
          style={{ background: `${kind.accent}20`, border: `1px solid ${kind.accent}50`, color: kind.accent }}
          aria-label={tw.trackerRowAriaLog.replace("{label}", kind.label.toLowerCase())}
        >
          <span className="text-lg">{kind.icon}</span>
          <span>{tw.trackerRowLogButton.replace("{label}", kind.label)}</span>
        </button>
        <div className="flex-1 grid grid-cols-4 gap-2 ml-auto">
          <StatCell label={tw.trackerStatToday} value={safe.today} />
          <StatCell label={tw.trackerStat7d} value={safe.week} />
          <StatCell label={tw.trackerStat30d} value={safe.month} />
          <StatCell label={tw.trackerStatLast} value={relTime(safe.lastAt, tw)} />
        </div>
      </div>
      <UsageGrid recentDays={safe.recentDays} accent={kind.accent} />
    </div>
  );
}

// ── UseTrackerCard ────────────────────────────────────────────────────────────

export function UseTrackerCard() {
  const t = useI18n();
  const tw = t.wellness;
  const TRACKER_KINDS: TrackerKind[] = [
    { key: "slam", label: tw.trackerKindSlamLabel, icon: "💉", accent: "#A78BFA" },
    { key: "smoke", label: tw.trackerKindSmokeLabel, icon: "💨", accent: "#FBBF24" },
  ];

  const [data, setData] = useState<UseTrackerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"slam" | "smoke" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await getUseStats();
      setData({ slam: r.slam, smoke: r.smoke });
    } catch {
      setError(tw.trackerErrLoad);
    } finally {
      setLoading(false);
    }
  }, [tw.trackerErrLoad]);

  useEffect(() => { load(); }, [load]);

  const onLog = async (type: "slam" | "smoke") => {
    setBusy(type); setError(null);
    try {
      const r = await logUse(type);
      setData({ slam: r.slam, smoke: r.smoke });
    } catch {
      setError(tw.trackerErrSave);
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return (
      <div className="glass-card-sm p-5 mt-4">
        <h2 className="text-sm font-semibold text-white mb-4 tracking-wide uppercase opacity-60">{tw.trackerTitle}</h2>
        <div className="h-24 rounded bg-white/5 animate-pulse" />
      </div>
    );
  }

  const total = (data?.slam.month ?? 0) + (data?.smoke.month ?? 0);

  return (
    <div className="glass-card-sm p-5 mt-4">
      <div className="flex items-baseline justify-between mb-1">
        <h2 className="text-sm font-semibold text-white tracking-wide uppercase opacity-60">{tw.trackerTitle}</h2>
        <span className="text-[10px] uppercase tracking-wider text-white/30">{tw.trackerPrivateLabel}</span>
      </div>
      <p className="text-xs text-white/50 mb-4 leading-relaxed">{tw.trackerDesc}</p>

      {(() => {
        const days = daysSinceLastParty(data);
        const phrase = encouragementPhrase(days, tw);
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
        <p className="text-xs text-white/40 mt-3 italic leading-relaxed">{tw.trackerEmpty}</p>
      )}

      {error && (
        <p className="text-xs mt-3 leading-relaxed" style={{ color: "rgba(251,191,36,0.85)" }}>{error}</p>
      )}
    </div>
  );
}
