import React, { useState, useEffect, useCallback } from "react";
import { Helmet } from "react-helmet-async";
import { useNavigate } from "react-router-dom";
import { Badge } from "@pnptv/ui-kit";
import { useAuth } from "@/hooks/useAuth";
import { useTier } from "@/hooks/useTier";
import { useI18n } from "@/lib/i18n";
import {
  getProfile,
  getMyReferral,
  updateProfile,
  updateLanguage,
  type ReferralStats,
} from "@/lib/api";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

// ── Toggle Switch ─────────────────────────────────────────────────────────────

function Toggle({
  checked,
  onChange,
  disabled,
  accentColor,
}: {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  accentColor: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      disabled={disabled}
      className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
      style={{ background: checked ? accentColor : "rgba(255,255,255,0.15)" }}
    >
      <span
        className="inline-block h-4 w-4 rounded-full bg-white shadow transition-transform duration-200"
        style={{ transform: checked ? "translateX(22px)" : "translateX(3px)" }}
      />
    </button>
  );
}

// ── Section wrapper ───────────────────────────────────────────────────────────

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="glass-card-sm p-5 mt-4">
      <h2 className="text-sm font-semibold text-white mb-4 tracking-wide uppercase opacity-60">
        {title}
      </h2>
      {children}
    </div>
  );
}

// ── Settings Page ─────────────────────────────────────────────────────────────

export default function Settings() {
  const navigate = useNavigate();
  const { user, isAuthenticated, refreshUser } = useAuth();
  const { tier, isPrime } = useTier();
  const t = useI18n();
  const p = t.profile;

  // ── Profile data ──────────────────────────────────────────────────────────
  const [memberSince, setMemberSince] = useState<string | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);

  // ── App Preferences state ─────────────────────────────────────────────────
  const [lang, setLang] = useState<"en" | "es">("en");
  const [langSaving, setLangSaving] = useState(false);
  const [langError, setLangError] = useState<string | null>(null);

  const [wofConsent, setWofConsent] = useState(false);
  const [wofConsentSaving, setWofConsentSaving] = useState(false);

  const [contentDisclaimer, setContentDisclaimer] = useState(false);
  const [contentDisclaimerSaving, setContentDisclaimerSaving] = useState(false);

  // ── Referral state ────────────────────────────────────────────────────────
  const [referralStats, setReferralStats] = useState<ReferralStats | null>(null);
  const [referralCopied, setReferralCopied] = useState(false);

  // ── Load data ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isAuthenticated) return;

    let cancelled = false;

    async function load() {
      setProfileLoading(true);
      try {
        const [profileRes, referralRes] = await Promise.all([
          getProfile(),
          getMyReferral().catch(() => null),
        ]);

        if (cancelled) return;

        const profile = profileRes.profile;
        setMemberSince(profile.memberSince ?? null);
        setWofConsent(profile.wofPhotoConsent ?? false);
        setContentDisclaimer(profile.contentDisclaimer ?? false);
        setLang((profile.language as "en" | "es") ?? user?.language ?? "en");

        if (referralRes) {
          setReferralStats(referralRes);
        }
      } catch {
        // Silent — individual sections degrade gracefully
      } finally {
        if (!cancelled) setProfileLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, user?.language]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleLanguageChange = useCallback(
    async (newLang: "en" | "es") => {
      if (newLang === lang || langSaving) return;
      const prevLang = lang;
      setLangSaving(true);
      setLangError(null);
      setLang(newLang);
      try {
        await updateLanguage(newLang);
        await refreshUser();
      } catch (err) {
        setLang(prevLang);
        setLangError(
          err instanceof Error ? err.message : "Failed to update language"
        );
        setTimeout(() => setLangError(null), 4000);
      } finally {
        setLangSaving(false);
      }
    },
    [lang, langSaving, refreshUser]
  );

  const handleWofConsentToggle = useCallback(async () => {
    const newValue = !wofConsent;
    setWofConsentSaving(true);
    try {
      await updateProfile({ wofPhotoConsent: newValue });
      setWofConsent(newValue);
    } catch {
      // Revert silently — state did not change
    } finally {
      setWofConsentSaving(false);
    }
  }, [wofConsent]);

  const handleContentDisclaimerToggle = useCallback(async () => {
    if (contentDisclaimer) return; // once accepted, cannot revert
    setContentDisclaimerSaving(true);
    try {
      await updateProfile({ contentDisclaimer: true });
      setContentDisclaimer(true);
    } catch {
      // Silent fail
    } finally {
      setContentDisclaimerSaving(false);
    }
  }, [contentDisclaimer]);

  const handleCopyReferral = useCallback(() => {
    if (!referralStats?.link) return;
    navigator.clipboard.writeText(referralStats.link).then(() => {
      setReferralCopied(true);
      setTimeout(() => setReferralCopied(false), 2000);
    });
  }, [referralStats]);

  // ── Auth guard ────────────────────────────────────────────────────────────

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

  // ── Tier badge label ──────────────────────────────────────────────────────

  const tierLabel = isPrime ? "PRIME" : tier.charAt(0).toUpperCase() + tier.slice(1);

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 pb-24">
      <Helmet>
        <title>Settings — PNPtv!</title>
        <meta name="description" content="Manage your PNPtv! account preferences and settings." />
      </Helmet>

      {/* ── Back button ── */}
      <button
        onClick={() => navigate("/profile")}
        className="flex items-center gap-2 text-sm mb-4 hover:text-white transition-colors"
        style={{ color: "#8E8E93" }}
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
        </svg>
        {p.back}
      </button>

      {/* ── Page title ── */}
      <h1 className="text-xl font-bold text-white mb-2">Settings</h1>

      {/* ── Account ─────────────────────────────────────────────────────── */}
      <Section title="Account">
        {profileLoading ? (
          <div className="space-y-3">
            <div className="h-4 rounded bg-white/10 animate-pulse w-40" />
            <div className="h-3 rounded bg-white/10 animate-pulse w-28" />
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-white">
                  {user?.displayName || user?.firstName || "—"}
                </p>
                {user?.username && (
                  <p className="text-xs mt-0.5" style={{ color: "#8E8E93" }}>
                    @{user.username}
                  </p>
                )}
              </div>
              <Badge variant={isPrime ? "accent" : "default"}>{tierLabel}</Badge>
            </div>
            {memberSince && (
              <p className="text-xs flex items-center gap-1.5" style={{ color: "#8E8E93" }}>
                <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
                </svg>
                {p.joined} {formatDate(memberSince)}
              </p>
            )}
          </div>
        )}
      </Section>

      {/* ── App Preferences ──────────────────────────────────────────────── */}
      <Section title={p.appPreferences}>
        {/* Language toggle */}
        <div
          className="flex items-center justify-between rounded-lg px-3 py-3 mb-3"
          style={{ background: "rgba(94,209,196,0.06)", border: "1px solid rgba(94,209,196,0.2)" }}
        >
          <div className="flex-1 min-w-0 mr-3">
            <p className="text-sm font-medium text-white">{p.languageIdioma}</p>
            <p className="text-xs mt-0.5" style={{ color: "#8E8E93" }}>
              {p.choosePreferredLanguage}
            </p>
          </div>
          <div
            className="flex items-center rounded-full p-0.5 flex-shrink-0"
            style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)" }}
          >
            <button
              onClick={() => handleLanguageChange("en")}
              disabled={langSaving}
              aria-pressed={lang === "en"}
              className="px-3 py-1 rounded-full text-xs font-semibold transition-all duration-200 disabled:opacity-50"
              style={{
                background: lang === "en" ? "linear-gradient(135deg, #5ED1C4, #D4007A)" : "transparent",
                color: lang === "en" ? "#fff" : "#8E8E93",
              }}
            >
              EN
            </button>
            <button
              onClick={() => handleLanguageChange("es")}
              disabled={langSaving}
              aria-pressed={lang === "es"}
              className="px-3 py-1 rounded-full text-xs font-semibold transition-all duration-200 disabled:opacity-50"
              style={{
                background: lang === "es" ? "linear-gradient(135deg, #5ED1C4, #D4007A)" : "transparent",
                color: lang === "es" ? "#fff" : "#8E8E93",
              }}
            >
              ES
            </button>
          </div>
        </div>
        {langError && (
          <p className="text-xs mb-3" style={{ color: "#FF6B6B" }}>{langError}</p>
        )}

        {/* Wall of Fame consent */}
        <div
          className="flex items-center justify-between rounded-lg px-3 py-3"
          style={{ background: "rgba(255,180,84,0.06)", border: "1px solid rgba(255,180,84,0.15)" }}
        >
          <div className="flex-1 min-w-0 mr-3">
            <p className="text-sm font-medium text-white">{p.wallOfFameConsent}</p>
            <p className="text-xs mt-0.5" style={{ color: "#8E8E93" }}>
              {p.wallOfFameConsentDesc}
            </p>
          </div>
          <Toggle
            checked={wofConsent}
            onChange={handleWofConsentToggle}
            disabled={wofConsentSaving}
            accentColor="#FFB454"
          />
        </div>

        {/* Content disclaimer */}
        <div
          className="flex items-center justify-between rounded-lg px-3 py-3 mt-3"
          style={{ background: "rgba(212,0,122,0.06)", border: "1px solid rgba(212,0,122,0.15)" }}
        >
          <div className="flex-1 min-w-0 mr-3">
            <p className="text-sm font-medium text-white">{p.contentDisclaimer}</p>
            <p className="text-xs mt-0.5" style={{ color: "#8E8E93" }}>
              {contentDisclaimer
                ? "Accepted. This cannot be reverted."
                : p.contentDisclaimerDesc}
            </p>
          </div>
          <Toggle
            checked={contentDisclaimer}
            onChange={handleContentDisclaimerToggle}
            disabled={contentDisclaimerSaving || contentDisclaimer}
            accentColor="#D4007A"
          />
        </div>
      </Section>

      {/* ── Referral Program ─────────────────────────────────────────────── */}
      <Section title={p.referralProgram}>
        <p className="text-xs mb-4" style={{ color: "#8E8E93" }}>
          {p.referralInviteDesc}{" "}
          <strong style={{ color: "#FFB454" }}>{p.referralFreePrime}</strong>{" "}
          {p.referralWhenTheyJoin}
        </p>
        {profileLoading ? (
          <div className="h-16 rounded-lg animate-pulse" style={{ background: "rgba(255,255,255,0.05)" }} />
        ) : referralStats ? (
          <>
            <div className="flex items-center gap-2 mb-3">
              <div
                className="flex-1 px-3 py-2 rounded-lg text-xs font-mono truncate"
                style={{
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  color: "#fff",
                }}
              >
                {referralStats.link}
              </div>
              <button
                onClick={handleCopyReferral}
                className="px-3 py-2 rounded-lg text-xs font-medium flex-shrink-0 transition-colors"
                style={{
                  background: referralCopied
                    ? "rgba(94,209,196,0.15)"
                    : "rgba(255,180,84,0.15)",
                  border: referralCopied
                    ? "1px solid rgba(94,209,196,0.4)"
                    : "1px solid rgba(255,180,84,0.4)",
                  color: referralCopied ? "#5ED1C4" : "#FFB454",
                }}
              >
                {referralCopied ? p.copied : p.copy}
              </button>
            </div>
            <div className="flex gap-4">
              <div className="text-center">
                <div className="text-xl font-bold text-white">{referralStats.total}</div>
                <div className="text-[10px]" style={{ color: "#8E8E93" }}>{p.invited}</div>
              </div>
              <div className="text-center">
                <div className="text-xl font-bold" style={{ color: "#FFB454" }}>
                  {referralStats.completed}
                </div>
                <div className="text-[10px]" style={{ color: "#8E8E93" }}>{p.joined_noun}</div>
              </div>
              <div className="text-center">
                <div className="text-xl font-bold" style={{ color: "#5ED1C4" }}>
                  {referralStats.completed * 3}
                </div>
                <div className="text-[10px]" style={{ color: "#8E8E93" }}>{p.daysEarned}</div>
              </div>
            </div>
          </>
        ) : (
          <p className="text-xs" style={{ color: "#8E8E93" }}>
            Unable to load referral data.
          </p>
        )}
      </Section>

      {/* ── Data & Privacy ───────────────────────────────────────────────── */}
      <Section title="Data & Privacy">
        <div
          className="rounded-xl p-4"
          style={{
            background: "rgba(94,209,196,0.05)",
            border: "1px solid rgba(94,209,196,0.15)",
          }}
        >
          <div className="flex items-start gap-3">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
              style={{ background: "rgba(94,209,196,0.15)" }}
            >
              <svg
                className="w-4 h-4"
                style={{ color: "#5ED1C4" }}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-white mb-1">
                Your PNPtv! Identity is Sovereign
              </p>
              <p className="text-xs leading-relaxed" style={{ color: "rgba(255,255,255,0.6)" }}>
                Your PNPtv! ID is your primary identity. All your data — posts, messages, connections — lives exclusively on our servers. Nothing is shared externally unless you explicitly choose to cross-post (e.g., Share to X). Your content, your control.
              </p>
            </div>
          </div>
        </div>
      </Section>

      {/* ── Danger Zone ──────────────────────────────────────────────────── */}
      <Section title="Danger Zone">
        <div
          className="rounded-xl p-4"
          style={{
            background: "rgba(255,59,48,0.05)",
            border: "1px solid rgba(255,59,48,0.15)",
          }}
        >
          <p className="text-sm font-medium text-white mb-1">Delete Account</p>
          <p className="text-xs mb-3" style={{ color: "#8E8E93" }}>
            Permanently delete your account and all associated data. This action cannot be undone.
          </p>
          <button
            disabled
            className="px-4 py-2 rounded-lg text-xs font-semibold opacity-40 cursor-not-allowed"
            style={{
              background: "rgba(255,59,48,0.15)",
              color: "#FF3B30",
              border: "1px solid rgba(255,59,48,0.3)",
            }}
          >
            Delete Account — Coming Soon
          </button>
        </div>
      </Section>
    </div>
  );
}
