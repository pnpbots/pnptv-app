/**
 * WellnessShell.tsx — the page rendered when a user has active Wellness Mode
 * and tries to access anything outside the allowlist. The API redirects them
 * to /wellness via window.location.replace from the WELLNESS_MODE 403 handler
 * in lib/api.ts.
 *
 * The shell intentionally keeps things minimal: list the wellness hangouts,
 * show a button into Cristina, link to settings (where they can request to
 * disable), and surface the harm-reduction resources from the policy page.
 */

import React, { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import {
  getWellnessHangouts,
  getWellnessMode,
  getUseStats,
  logUse,
  type WellnessHangout,
  type WellnessModeStatus,
  type UseTrackerData,
} from "@/lib/api";
import { daysSinceLastParty, encouragementPhrase } from "@/pages/Settings";
import { useI18n } from "@/lib/i18n";

export default function WellnessShell() {
  const t = useI18n();
  const TRACKER_KINDS = [
    { key: "slam" as const, label: t.wellness.shellTrackerSlam, icon: "💉", accent: "#A78BFA" },
    { key: "smoke" as const, label: t.wellness.shellTrackerSmoke, icon: "💨", accent: "#FBBF24" },
  ];

  const [hangouts, setHangouts] = useState<WellnessHangout[]>([]);
  const [status, setStatus] = useState<WellnessModeStatus | null>(null);
  const [tracker, setTracker] = useState<UseTrackerData | null>(null);
  const [trackerBusy, setTrackerBusy] = useState<"slam" | "smoke" | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [h, s, ts] = await Promise.all([
        getWellnessHangouts(),
        getWellnessMode(),
        getUseStats().catch(() => null),
      ]);
      setHangouts(h.groups || []);
      setStatus(s);
      if (ts) setTracker({ slam: ts.slam, smoke: ts.smoke });
    } catch {
      setError(t.wellness.shellLoadError);
    } finally {
      setLoading(false);
    }
  }, [t.wellness.shellLoadError]);

  useEffect(() => { load(); }, [load]);

  const onLogUse = async (type: "slam" | "smoke") => {
    setTrackerBusy(type);
    try {
      const r = await logUse(type);
      setTracker({ slam: r.slam, smoke: r.smoke });
    } catch {
      // Silent — don't add another error in this context. The Settings card
      // is the primary place to see/correct logs.
    } finally {
      setTrackerBusy(null);
    }
  };

  return (
    <>
      <Helmet>
        <title>{t.wellness.shellPageTitle}</title>
      </Helmet>
      <div className="min-h-dvh bg-pnp-bg" style={{
        backgroundImage: "radial-gradient(circle at top right, rgba(94,209,196,0.08), transparent 50%)",
      }}>
        <div className="max-w-2xl mx-auto px-4 py-10">
          <div className="text-center mb-8">
            <div className="text-5xl mb-3">🧘</div>
            <h1 className="text-2xl font-bold text-white mb-2">{t.wellness.shellHeroHeading}</h1>
            <p className="text-sm text-white/60 max-w-md mx-auto leading-relaxed">
              {t.wellness.shellHeroBody} <strong className="text-white">{t.wellness.shellHeroBodyEmphasis}</strong>
            </p>
            {status?.active && (
              <p className="text-xs text-white/40 mt-3">
                {status.indefinite
                  ? t.wellness.shellStatusIndefinite
                  : status.until
                    ? t.wellness.shellStatusUntil.replace("{date}", new Date(status.until).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }))
                    : ""}
              </p>
            )}
          </div>

          {/* Wellness hangouts */}
          <section className="mb-6">
            <h2 className="text-xs uppercase tracking-wider text-white/50 mb-3">{t.wellness.shellSectionHangouts}</h2>
            {loading && <div className="h-24 rounded-2xl bg-white/5 animate-pulse" />}
            {error && (
              <p className="text-sm leading-relaxed" style={{ color: "rgba(94,209,196,0.8)" }}>
                {error}
              </p>
            )}
            {!loading && hangouts.length === 0 && (
              <p className="text-sm text-white/50 italic">{t.wellness.shellHangoutsEmpty}</p>
            )}
            <div className="space-y-3">
              {hangouts.map((h) => (
                <Link
                  key={h.id}
                  to={`/hangouts/${h.id}`}
                  className="block rounded-2xl p-4 transition-all hover:scale-[1.01]"
                  style={{
                    background: "linear-gradient(135deg, rgba(94,209,196,0.1), rgba(94,209,196,0.04))",
                    border: "1px solid rgba(94,209,196,0.25)",
                  }}
                >
                  <div className="flex items-start gap-3">
                    <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: "rgba(94,209,196,0.2)" }}>
                      <span className="text-2xl">🌿</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-base font-bold text-white">{h.name}</h3>
                      <p className="text-xs text-white/60 leading-relaxed mt-1 line-clamp-3">{h.description}</p>
                      <p className="text-[11px] text-white/40 mt-2">{h.member_count} {h.member_count === 1 ? t.wellness.shellMemberOne : t.wellness.shellMemberMany}</p>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </section>

          {/* Cristina */}
          <section className="mb-6">
            <h2 className="text-xs uppercase tracking-wider text-white/50 mb-3">{t.wellness.shellSectionCristina}</h2>
            <Link
              to="/cristina"
              className="block rounded-2xl p-4 transition-all hover:scale-[1.01]"
              style={{ background: "rgba(212,0,122,0.08)", border: "1px solid rgba(212,0,122,0.25)" }}
            >
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 text-2xl" style={{ background: "rgba(212,0,122,0.15)" }}>🧜‍♀️</div>
                <div className="flex-1">
                  <h3 className="text-base font-bold text-white">{t.wellness.shellCristinaName}</h3>
                  <p className="text-xs text-white/60">{t.wellness.shellCristinaBlurb}</p>
                </div>
              </div>
            </Link>
          </section>

          {/* Use Tracker — quick log even while in wellness mode */}
          <section className="mb-6">
            <h2 className="text-xs uppercase tracking-wider text-white/50 mb-3">
              {t.wellness.shellSectionQuickLog} <span className="text-white/30">· {t.wellness.shellQuickLogPrivate}</span>
            </h2>
            <div className="rounded-2xl p-4" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>
              {(() => {
                const days = daysSinceLastParty(tracker);
                const phrase = encouragementPhrase(days, t.wellness);
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
              <p className="text-xs text-white/50 mb-3 leading-relaxed">
                {t.wellness.shellLoggingPrivacy}
              </p>
              <div className="grid grid-cols-2 gap-2">
                {TRACKER_KINDS.map((k) => {
                  const stats = tracker?.[k.key];
                  return (
                    <button
                      key={k.key}
                      onClick={() => onLogUse(k.key)}
                      disabled={trackerBusy !== null}
                      className="flex items-center justify-between rounded-xl px-3 py-2.5 transition-all disabled:opacity-50"
                      style={{
                        background: `${k.accent}15`,
                        border: `1px solid ${k.accent}40`,
                      }}
                      aria-label={t.wellness.shellTrackerAriaLog.replace("{label}", k.label.toLowerCase())}
                    >
                      <span className="flex items-center gap-2 text-sm font-semibold" style={{ color: k.accent }}>
                        <span className="text-lg">{k.icon}</span>
                        <span>{trackerBusy === k.key ? t.wellness.shellLogging : t.wellness.shellLogPrefix.replace("{label}", k.label)}</span>
                      </span>
                      <span className="text-[11px] text-white/40 tabular-nums">
                        {stats ? t.wellness.shellLogStatsLine.replace("{today}", String(stats.today)).replace("{week}", String(stats.week)) : t.wellness.shellLogStatsEmpty}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </section>

          {/* Crisis lines */}
          <section className="mb-6">
            <h2 className="text-xs uppercase tracking-wider text-white/50 mb-3">{t.wellness.shellSectionCrisis}</h2>
            <div className="rounded-2xl p-4 space-y-2 text-sm" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>
              <p className="text-white/80"><strong>{t.wellness.shellCrisisSamhsaLabel}</strong> <a href="tel:18006624357" className="text-pnp-primary">1-800-662-4357</a> — {t.wellness.shellCrisisSamhsaNote}</p>
              <p className="text-white/80"><strong>{t.wellness.shellCrisisCmaLabel}</strong> <a href="https://crystalmeth.org" target="_blank" rel="noopener" className="text-pnp-primary">crystalmeth.org</a></p>
              <p className="text-white/80"><strong>{t.wellness.shellCrisisTrevorLabel}</strong> <a href="tel:18664887386" className="text-pnp-primary">1-866-488-7386</a></p>
              <p className="text-white/80"><strong>{t.wellness.shellCrisisInternationalLabel}</strong> <a href="https://findahelpline.com" target="_blank" rel="noopener" className="text-pnp-primary">findahelpline.com</a></p>
            </div>
          </section>

          {/* Manage mode */}
          <section className="text-center mt-10">
            <Link
              to="/settings"
              className="inline-block text-xs text-white/50 hover:text-white/80 transition-colors"
            >
              {t.wellness.shellManageInSettings}
            </Link>
          </section>
        </div>
      </div>
    </>
  );
}
