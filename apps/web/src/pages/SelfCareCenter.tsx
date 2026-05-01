/**
 * SelfCareCenter.tsx — "My Self-Care Center"
 *
 * Dedicated home for the platform's harm-reduction and wellness tooling.
 * Hosts the Use Tracker dashboard and Wellness Break Mode controls today,
 * with deliberate space carved out for future tools (sleep, mood, sponsor
 * matching, etc).
 *
 * The page is intentionally calm: no ads, no notifications, no algorithmic
 * surfaces. Big breathing room, soft gradients, slow motion. The visual
 * language signals "you're safe here, take your time."
 */

import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { useAuth } from "@/hooks/useAuth";
import {
  UseTrackerCard,
  WellnessModeCard,
  daysSinceLastParty,
  encouragementPhrase,
} from "@/pages/Settings";
import {
  getUseStats,
  getWellnessHangouts,
  type UseTrackerData,
  type WellnessHangout,
} from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useTutorial } from "@/hooks/useTutorial";
import { TutorialOverlay } from "@/components/tutorial/TutorialOverlay";

// ── Section header ───────────────────────────────────────────────────────────
function SectionHeader({ eyebrow, title, subtitle }: { eyebrow?: string; title: string; subtitle?: string }) {
  return (
    <div className="mb-3">
      {eyebrow && (
        <p className="text-[10px] uppercase tracking-[0.2em] mb-1.5" style={{ color: "rgba(94,209,196,0.7)" }}>
          {eyebrow}
        </p>
      )}
      <h2 className="text-lg font-bold text-white leading-tight">{title}</h2>
      {subtitle && <p className="text-xs text-white/55 mt-1 leading-relaxed">{subtitle}</p>}
    </div>
  );
}

// ── Quick-link card (used for Cristina, Hangouts, Crisis) ────────────────────
function LinkCard({
  to,
  href,
  icon,
  title,
  body,
  accent,
  badge,
  external,
}: {
  to?: string;
  href?: string;
  icon: string;
  title: string;
  body: string;
  accent: string;
  badge?: string;
  external?: boolean;
}) {
  const inner = (
    <div
      className="block rounded-2xl p-4 transition-all hover:scale-[1.01] active:scale-[0.99] h-full"
      style={{
        background: `linear-gradient(135deg, ${accent}10, ${accent}04)`,
        border: `1px solid ${accent}33`,
      }}
    >
      <div className="flex items-start gap-3">
        <div
          className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 text-2xl"
          style={{ background: `${accent}22`, border: `1px solid ${accent}40` }}
        >
          <span aria-hidden>{icon}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold text-white">{title}</h3>
            {badge && (
              <span
                className="text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded"
                style={{ background: `${accent}25`, color: accent }}
              >
                {badge}
              </span>
            )}
          </div>
          <p className="text-xs text-white/60 leading-relaxed mt-1">{body}</p>
        </div>
        <span className="text-white/30 text-lg leading-none mt-1" aria-hidden>›</span>
      </div>
    </div>
  );
  if (href) {
    return (
      <a href={href} target={external ? "_blank" : undefined} rel={external ? "noopener" : undefined} className="block h-full">
        {inner}
      </a>
    );
  }
  return <Link to={to ?? "#"} className="block h-full">{inner}</Link>;
}

// ── Crisis resources block ───────────────────────────────────────────────────
function CrisisCard() {
  const t = useI18n();
  return (
    <div
      className="rounded-2xl p-4 space-y-2 text-sm"
      style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xl" aria-hidden>🆘</span>
        <h3 className="text-sm font-bold text-white">{t.wellness.centerCrisisHeading}</h3>
      </div>
      <p className="text-white/80"><strong>{t.wellness.shellCrisisSamhsaLabel}</strong> <a href="tel:18006624357" className="text-pnp-primary">1-800-662-4357</a> — {t.wellness.shellCrisisSamhsaNote}</p>
      <p className="text-white/80"><strong>{t.wellness.shellCrisisCmaLabel}</strong> <a href="https://crystalmeth.org" target="_blank" rel="noopener" className="text-pnp-primary">crystalmeth.org</a></p>
      <p className="text-white/80"><strong>{t.wellness.shellCrisisTrevorLabel}</strong> <a href="tel:18664887386" className="text-pnp-primary">1-866-488-7386</a></p>
      <p className="text-white/80"><strong>{t.wellness.shellCrisisInternationalLabel}</strong> <a href="https://findahelpline.com" target="_blank" rel="noopener" className="text-pnp-primary">findahelpline.com</a></p>
    </div>
  );
}

// ── Coming Soon roadmap card ────────────────────────────────────────────────
function ComingSoonCard() {
  const t = useI18n();
  const icons = ["💤", "🧠", "🤝", "📓"];
  const items = t.wellness.centerComingSoonItems.map((it, i) => ({ ...it, icon: icons[i] }));
  return (
    <div
      className="rounded-2xl p-4"
      style={{
        background: "linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01))",
        border: "1px dashed rgba(255,255,255,0.15)",
      }}
    >
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xl" aria-hidden>🛠️</span>
        <h3 className="text-sm font-bold text-white">{t.wellness.centerComingSoonHeading}</h3>
        <span className="text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded ml-auto" style={{ background: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.7)" }}>
          {t.wellness.centerComingSoonBadge}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {items.map((it) => (
          <div key={it.label} className="rounded-xl px-3 py-2.5" style={{ background: "rgba(255,255,255,0.03)" }}>
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className="text-base" aria-hidden>{it.icon}</span>
              <span className="text-xs font-semibold text-white/80">{it.label}</span>
            </div>
            <p className="text-[10px] text-white/45 leading-snug">{it.body}</p>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-white/40 mt-3 text-center">
        {t.wellness.centerComingSoonFooter}
      </p>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function SelfCareCenter() {
  const { user } = useAuth();
  const t = useI18n();
  const [tracker, setTracker] = useState<UseTrackerData | null>(null);
  const [hangouts, setHangouts] = useState<WellnessHangout[]>([]);
  const { showTutorial, dismissTutorial, dismissForever } = useTutorial("selfCare");

  useEffect(() => {
    // Best-effort fetches — used only for the hero summary line. Failures here
    // shouldn't block the page from rendering its primary tools.
    getUseStats()
      .then((r) => setTracker({ slam: r.slam, smoke: r.smoke }))
      .catch(() => null);
    getWellnessHangouts()
      .then((r) => setHangouts(r.groups || []))
      .catch(() => null);
  }, []);

  const days = daysSinceLastParty(tracker);
  const phrase = encouragementPhrase(days);
  const firstName = user?.first_name || user?.firstName || t.wellness.centerHeroNameFallback;

  return (
    <>
      <Helmet>
        <title>{t.wellness.centerPageTitle}</title>
      </Helmet>

      {showTutorial && (
        <TutorialOverlay
          section="selfCare"
          onDismiss={dismissTutorial}
          onDismissForever={dismissForever}
        />
      )}

      <div
        className="min-h-screen"
        style={{
          background: `
            radial-gradient(ellipse at top right, rgba(94,209,196,0.10), transparent 55%),
            radial-gradient(ellipse at bottom left, rgba(167,139,250,0.08), transparent 60%),
            #0A0A0F
          `,
        }}
      >
        <div className="max-w-3xl mx-auto px-4 pt-8 pb-16">

          {/* ── Hero ────────────────────────────────────────────────────────── */}
          <header className="mb-8">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-3xl" aria-hidden>🧘</span>
              <span className="text-[11px] uppercase tracking-[0.25em] text-white/45 font-semibold">
                {t.wellness.centerEyebrow}
              </span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-extrabold text-white leading-tight tracking-tight">
              {t.wellness.centerHeadingPrefix}{" "}
              <span style={{ background: "linear-gradient(135deg, #5ED1C4, #A78BFA)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                {t.wellness.centerHeadingHighlight}
              </span>
              {t.wellness.centerHeadingSuffix}
            </h1>
            <p className="text-sm text-white/60 mt-3 leading-relaxed max-w-xl">
              {t.wellness.centerHeroBody.replace("{name}", firstName)}
            </p>

            {/* Encouragement banner */}
            <div
              className="mt-5 rounded-2xl px-4 py-3.5 leading-relaxed"
              style={{
                background: `linear-gradient(135deg, ${phrase.accent}1f, ${phrase.accent}08)`,
                border: `1px solid ${phrase.accent}3a`,
              }}
            >
              <p className="text-sm font-bold" style={{ color: phrase.accent }}>{phrase.headline}</p>
              <p className="text-xs text-white/75 mt-1">{phrase.body}</p>
            </div>
          </header>

          {/* ── Section 1: The trackers (the core) ──────────────────────────── */}
          <section className="mb-8">
            <SectionHeader
              eyebrow={t.wellness.centerSec1Eyebrow}
              title={t.wellness.centerSec1Title}
              subtitle={t.wellness.centerSec1Subtitle}
            />
            <div className="space-y-3">
              {/* These render the exact same cards from Settings.tsx so the
                  controls behave identically across both pages. */}
              <UseTrackerCard />
              <WellnessModeCard />
            </div>
          </section>

          {/* ── Section 2: Quick links to support tools ─────────────────────── */}
          <section className="mb-8">
            <SectionHeader
              eyebrow={t.wellness.centerSec2Eyebrow}
              title={t.wellness.centerSec2Title}
              subtitle={t.wellness.centerSec2Subtitle}
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <LinkCard
                to="/cristina"
                icon="🧜‍♀️"
                title={t.wellness.centerLinkCristinaTitle}
                body={t.wellness.centerLinkCristinaBody}
                accent="#D4007A"
              />
              <LinkCard
                to="/wellness"
                icon="🌿"
                title={t.wellness.centerLinkHangoutsTitle}
                body={
                  hangouts.length === 0
                    ? t.wellness.centerLinkHangoutsEmpty
                    : (hangouts.length === 1
                        ? t.wellness.centerLinkHangoutsActiveOne
                        : t.wellness.centerLinkHangoutsActiveMany).replace("{count}", String(hangouts.length))
                }
                accent="#5ED1C4"
                badge={hangouts.length > 0 ? `${hangouts.length}` : undefined}
              />
            </div>
          </section>

          {/* ── Section 3: Crisis resources ─────────────────────────────────── */}
          <section className="mb-8">
            <SectionHeader
              eyebrow={t.wellness.centerSec3Eyebrow}
              title={t.wellness.centerSec3Title}
              subtitle={t.wellness.centerSec3Subtitle}
            />
            <CrisisCard />
          </section>

          {/* ── Section 4: Roadmap ──────────────────────────────────────────── */}
          <section className="mb-8">
            <SectionHeader
              eyebrow={t.wellness.centerSec4Eyebrow}
              title={t.wellness.centerSec4Title}
            />
            <ComingSoonCard />
          </section>

          {/* ── Foot ────────────────────────────────────────────────────────── */}
          <footer className="text-center pt-4 pb-2">
            <p className="text-[11px] text-white/35 leading-relaxed max-w-md mx-auto">
              {t.wellness.centerFooterPrivacy}
              {" "}
              <Link to="/privacy" className="underline underline-offset-2 hover:text-white/60">{t.wellness.centerFooterPrivacyLink}</Link>
              {" · "}
              <Link to="/safety" className="underline underline-offset-2 hover:text-white/60">{t.wellness.centerFooterSafetyLink}</Link>
            </p>
          </footer>
        </div>
      </div>
    </>
  );
}
