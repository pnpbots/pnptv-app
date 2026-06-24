import React, { useEffect } from "react";
import { Helmet } from "react-helmet-async";
import { useNavigate, useLocation, Outlet } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/lib/i18n";

// ── Legacy exports (used by SelfCareCenter and other pages) ──────────────────
// Keep these exports so existing imports don't break.
export { WellnessModeCard, UseTrackerCard, daysSinceLastParty, encouragementPhrase } from "./SettingsLegacy";

// ── Hash → sub-route redirect map ────────────────────────────────────────────
// Maps old anchor fragments (/settings#privacy, /settings#account, etc.) to the
// new drill-down URLs so existing deep-links keep working.
const HASH_REDIRECTS: Record<string, string> = {
  "#account":       "/settings/account",
  "#preferences":   "/settings/preferences",
  "#notifications": "/settings/notifications",
  "#privacy":       "/settings/privacy",
  "#payments":      "/settings/payments",
  "#danger":        "/settings/danger",
  // Aliases from the old section titles
  "#data-privacy":  "/settings/privacy",
  "#wallet":        "/settings/payments",
  "#referral":      "/referrals",
};

// ── Category row data ─────────────────────────────────────────────────────────
interface Category {
  slug: string;
  icon: string;
  titleKey: "catAccountTitle" | "catPreferencesTitle" | "catNotificationsTitle" | "catPrivacyTitle" | "catPaymentsTitle" | "catDangerZoneTitle";
  descKey: "catAccountDesc" | "catPreferencesDesc" | "catNotificationsDesc" | "catPrivacyDesc" | "catPaymentsDesc" | "catDangerZoneDesc";
  accentColor: string;
}

const CATEGORIES: Category[] = [
  { slug: "account",       icon: "👤", titleKey: "catAccountTitle",       descKey: "catAccountDesc",       accentColor: "rgba(212,0,122,0.2)" },
  { slug: "preferences",   icon: "🎨", titleKey: "catPreferencesTitle",   descKey: "catPreferencesDesc",   accentColor: "rgba(167,139,250,0.2)" },
  { slug: "notifications", icon: "🔔", titleKey: "catNotificationsTitle", descKey: "catNotificationsDesc", accentColor: "rgba(94,209,196,0.2)" },
  { slug: "privacy",       icon: "🔒", titleKey: "catPrivacyTitle",        descKey: "catPrivacyDesc",       accentColor: "rgba(94,209,196,0.15)" },
  { slug: "payments",      icon: "💳", titleKey: "catPaymentsTitle",       descKey: "catPaymentsDesc",      accentColor: "rgba(0,141,228,0.2)" },
  { slug: "danger",        icon: "⚠️", titleKey: "catDangerZoneTitle",     descKey: "catDangerZoneDesc",    accentColor: "rgba(255,59,48,0.15)" },
];

// ── Sub-page header (shown inside the right column or as standalone header on mobile) ──
function SubPageHeader({ categorySlug }: { categorySlug: string }) {
  const navigate = useNavigate();
  const t = useI18n();
  const p = t.profile;
  const cat = CATEGORIES.find((c) => c.slug === categorySlug);
  if (!cat) return null;

  return (
    <div className="flex items-center gap-3 mb-6">
      {/* Back arrow — only visible on mobile (lg: hidden by parent) */}
      <button
        onClick={() => navigate("/settings")}
        className="lg:hidden flex items-center justify-center w-9 h-9 rounded-xl transition-colors hover:bg-white/10 active:scale-95 flex-shrink-0"
        style={{ color: "var(--pnp-text-secondary)" }}
        aria-label={p.back}
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
        </svg>
      </button>
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="text-xl" aria-hidden>{cat.icon}</span>
        <h1 className="text-lg font-bold text-white truncate">{p[cat.titleKey]}</h1>
      </div>
    </div>
  );
}

// ── Settings Index (the top-level menu page) ──────────────────────────────────
function SettingsIndex() {
  const navigate = useNavigate();
  const location = useLocation();
  const t = useI18n();
  const p = t.profile;

  // Handle legacy hash deep-links: /settings#privacy → /settings/privacy
  useEffect(() => {
    const hash = location.hash;
    if (hash && HASH_REDIRECTS[hash]) {
      navigate(HASH_REDIRECTS[hash], { replace: true });
    }
  }, [location.hash, navigate]);

  return (
    <div>
      <h1 className="text-xl font-bold text-white mb-1">{p.settingsTitle}</h1>
      <p className="text-xs mb-5" style={{ color: "var(--pnp-text-secondary)" }}>
        {p.settingsMenuSubtitle}
      </p>

      {/* ── Self-Care Center promo card (load-bearing pointer) ── */}
      <button
        type="button"
        onClick={() => navigate("/self-care")}
        className="w-full text-left rounded-2xl p-4 mb-5 transition-all hover:scale-[1.005] active:scale-[0.99]"
        style={{
          background: "linear-gradient(135deg, rgba(94,209,196,0.10), rgba(167,139,250,0.06))",
          border: "1px solid rgba(94,209,196,0.25)",
        }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 text-2xl"
            style={{ background: "rgba(94,209,196,0.15)", border: "1px solid rgba(94,209,196,0.35)" }}
            aria-hidden
          >
            🧘
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-white">{p.selfCarePromoTitle}</p>
            <p className="text-xs leading-relaxed" style={{ color: "rgba(255,255,255,0.65)" }}>
              {p.selfCarePromoBody}
            </p>
          </div>
          <span className="text-white/30 text-lg leading-none flex-shrink-0" aria-hidden>›</span>
        </div>
      </button>

      {/* ── Referral Center shortcut ── */}
      <button
        type="button"
        onClick={() => navigate("/referrals")}
        className="w-full text-left rounded-2xl p-4 mb-2 transition-all hover:scale-[1.005] active:scale-[0.99]"
        style={{
          background: "linear-gradient(135deg, rgba(212,0,122,0.10), rgba(155,0,176,0.06))",
          border: "1px solid rgba(212,0,122,0.22)",
        }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 text-2xl"
            style={{ background: "rgba(212,0,122,0.15)", border: "1px solid rgba(212,0,122,0.30)" }}
            aria-hidden
          >
            🔗
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-white">{p.referralProgram}</p>
            <p className="text-xs leading-relaxed" style={{ color: "rgba(255,255,255,0.55)" }}>
              {p.referralInviteDesc} {p.referralFreePrime}
            </p>
          </div>
          <span className="text-white/30 text-lg leading-none flex-shrink-0" aria-hidden>›</span>
        </div>
      </button>

      {/* ── Category rows ── */}
      <nav aria-label="Settings categories">
        <ul className="space-y-2">
          {CATEGORIES.map((cat) => (
            <li key={cat.slug}>
              <button
                type="button"
                onClick={() => navigate(`/settings/${cat.slug}`)}
                className="w-full text-left glass-card-sm px-4 py-3.5 flex items-center gap-3 transition-all hover:scale-[1.005] active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 rounded-2xl"
              >
                {/* Icon */}
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-lg"
                  style={{ background: cat.accentColor }}
                  aria-hidden
                >
                  {cat.icon}
                </div>

                {/* Text */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white">{p[cat.titleKey]}</p>
                  <p className="text-xs mt-0.5 leading-relaxed" style={{ color: "var(--pnp-text-secondary)" }}>
                    {p[cat.descKey]}
                  </p>
                </div>

                {/* Chevron */}
                <svg
                  className="w-4 h-4 flex-shrink-0"
                  style={{ color: "var(--pnp-text-secondary)" }}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2.2}
                  aria-hidden="true"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}

// ── Settings Shell (handles layout + auth guard) ──────────────────────────────
export default function Settings() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated } = useAuth();
  const t = useI18n();
  const p = t.profile;

  // Determine if we're on a sub-page (e.g. /settings/account)
  const pathParts = location.pathname.split("/").filter(Boolean);
  const activeSlug = pathParts[1] ?? null; // "account" | "preferences" | etc. | null
  const isSubPage = activeSlug !== null;
  const activeCat = CATEGORIES.find((c) => c.slug === activeSlug);

  if (!isAuthenticated) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <p className="text-white font-medium mb-4">{p.signInRequired}</p>
        <button
          onClick={() => navigate("/login")}
          className="px-6 py-2 rounded-lg text-sm font-semibold text-white btn-gradient"
        >
          {p.signIn}
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 pb-24">
      <Helmet>
        <title>
          {activeCat ? `${p[activeCat.titleKey]} — ${p.settingsTitle} — PNPtv!` : `${p.settingsTitle} — PNPtv!`}
        </title>
        <meta name="description" content="Manage your PNPtv! account preferences and settings." />
      </Helmet>

      {/* ── Back button (mobile, from sub-page back to profile) ── */}
      {!isSubPage && (
        <button
          onClick={() => navigate("/profile")}
          className="flex items-center gap-2 text-sm mb-4 hover:text-white transition-colors"
          style={{ color: "var(--pnp-text-secondary)" }}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
          {p.back}
        </button>
      )}

      {/*
        Desktop split-view layout:
        Left column (280px): category menu — always visible on lg+
        Right column (flex-1): current sub-page content — only visible when a sub-page is active

        On mobile, only one panel is shown at a time:
        - If !isSubPage → show index
        - If isSubPage → show sub-page (the index is hidden via hidden lg:block)
      */}
      <div className="lg:flex lg:gap-6 lg:items-start">

        {/* ── Left: Category menu ── */}
        <div
          className={`lg:w-[280px] lg:flex-shrink-0 lg:sticky lg:top-6 ${isSubPage ? "hidden lg:block" : "block"}`}
        >
          <SettingsIndex />
        </div>

        {/* ── Right: Sub-page content ── */}
        {isSubPage && (
          <div className="flex-1 min-w-0">
            {activeCat && <SubPageHeader categorySlug={activeCat.slug} />}
            <Outlet />
          </div>
        )}
      </div>
    </div>
  );
}
