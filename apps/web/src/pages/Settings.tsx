import React, { useState, useEffect, useCallback, useRef } from "react";
import { Helmet } from "react-helmet-async";
import { useNavigate } from "react-router-dom";
import { Badge } from "@pnptv/ui-kit";
import { useAuth } from "@/hooks/useAuth";
import { useTier } from "@/hooks/useTier";
import { useI18n, type Lang } from "@/lib/i18n";
import {
  getProfile,
  getMyReferral,
  updateProfile,
  updateLanguage,
  deleteAccount,
  eraseMyAccount,
  getBlockedUsers,
  unblockUser,
  type ReferralStats,
  type BlockedUser,
  type EraseAccountReceipt,
} from "@/lib/api";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(dateStr: string, lang: string): string {
  return new Date(dateStr).toLocaleDateString(lang, {
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
  const { user, isAuthenticated, refreshUser, logout } = useAuth();
  const { tier, isPrime } = useTier();
  const t = useI18n();
  const p = t.profile;
  const uiLang = t.lang; // current UI language (drives i18n strings)

  // ── Profile data ──────────────────────────────────────────────────────────
  const [memberSince, setMemberSince] = useState<string | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);

  // ── App Preferences state ─────────────────────────────────────────────────
  // selectedLang: the value shown in the language <select> (may briefly differ
  // from uiLang while a save is in-flight, reverted on error)
  const [selectedLang, setSelectedLang] = useState<Lang>("en");
  const [langSaving, setLangSaving] = useState(false);
  const [langError, setLangError] = useState<string | null>(null);

  const [wofConsent, setWofConsent] = useState(false);
  const [wofConsentSaving, setWofConsentSaving] = useState(false);

  const [contentDisclaimer, setContentDisclaimer] = useState(false);
  const [contentDisclaimerSaving, setContentDisclaimerSaving] = useState(false);

  // ── Notification Preferences state ───────────────────────────────────────
  type ChannelPrefs = { inApp: boolean; bot: boolean; email: boolean; push: boolean };
  type NotifPrefs = Record<string, ChannelPrefs | { enabled: boolean; start: string; end: string }>;
  const [notifPrefs, setNotifPrefs] = useState<NotifPrefs | null>(null);
  const [notifLoading, setNotifLoading] = useState(true);

  // ── Delete account state ──────────────────────────────────────────────────
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const deleteInputRef = useRef<HTMLInputElement>(null);
  const deleteModalRef = useRef<HTMLDivElement>(null); // backdrop element for focus trap root

  // ── GDPR erase state ──────────────────────────────────────────────────────
  const [showEraseModal, setShowEraseModal] = useState(false);
  const [eraseConfirmText, setEraseConfirmText] = useState("");
  const [erasing, setErasing] = useState(false);
  const [eraseError, setEraseError] = useState<string | null>(null);
  const [eraseReceipt, setEraseReceipt] = useState<EraseAccountReceipt | null>(null);
  const eraseInputRef = useRef<HTMLInputElement>(null);
  const eraseModalRef = useRef<HTMLDivElement>(null);

  // ── Focus management: move focus into modal when it opens ─────────────────
  useEffect(() => {
    if (showDeleteModal) {
      // autoFocus on the input handles initial focus; the modal container
      // captures global keydown for Escape so we also focus it as a trap root
      deleteInputRef.current?.focus();
    }
  }, [showDeleteModal]);

  useEffect(() => {
    if (showEraseModal) {
      eraseInputRef.current?.focus();
    }
  }, [showEraseModal]);

  // ── Referral state ────────────────────────────────────────────────────────
  const [referralStats, setReferralStats] = useState<ReferralStats | null>(null);
  const [referralCopied, setReferralCopied] = useState(false);

  // ── Blocked users state ───────────────────────────────────────────────────
  const [blockedUsers, setBlockedUsers] = useState<BlockedUser[]>([]);
  const [blockedLoading, setBlockedLoading] = useState(true);
  const [unblockingId, setUnblockingId] = useState<string | null>(null);

  // ── Load data ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isAuthenticated) return;

    let cancelled = false;

    async function load() {
      setProfileLoading(true);
      setBlockedLoading(true);
      try {
        const [profileRes, referralRes, notifRes, blockedRes] = await Promise.all([
          getProfile(),
          getMyReferral().catch(() => null),
          fetch(`${import.meta.env.VITE_API_URL || "https://pnptv.app"}/api/webapp/notifications/preferences`, { credentials: "include" })
            .then(r => r.ok ? r.json() : null).catch(() => null),
          getBlockedUsers().catch(() => null),
        ]);

        if (cancelled) return;

        const profile = profileRes.profile;
        setMemberSince(profile.memberSince ?? null);
        setWofConsent(profile.wofPhotoConsent ?? false);
        setContentDisclaimer(profile.contentDisclaimer ?? false);
        setSelectedLang((profile.language as Lang) ?? (user?.language as Lang) ?? "en");

        if (referralRes) {
          setReferralStats(referralRes);
        }
        if (notifRes?.preferences) {
          setNotifPrefs(notifRes.preferences);
        }
        setNotifLoading(false);
        if (blockedRes?.success) {
          setBlockedUsers(blockedRes.blockedUsers);
        }
        setBlockedLoading(false);
      } catch {
        // Silent — individual sections degrade gracefully
      } finally {
        if (!cancelled) {
          setProfileLoading(false);
          setBlockedLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, user?.language]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleLanguageChange = useCallback(
    async (newLang: Lang) => {
      if (newLang === selectedLang || langSaving) return;
      const prevLang = selectedLang;
      setLangSaving(true);
      setLangError(null);
      setSelectedLang(newLang);
      try {
        await updateLanguage(newLang);
        await refreshUser();
      } catch (err) {
        setSelectedLang(prevLang);
        setLangError(
          err instanceof Error ? err.message : p.langUpdateError
        );
        setTimeout(() => setLangError(null), 4000);
      } finally {
        setLangSaving(false);
      }
    },
    [selectedLang, langSaving, refreshUser]
  );

  const handleDeleteAccount = useCallback(async () => {
    if (deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteAccount();
      setShowDeleteModal(false);
      navigate("/");
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : p.deleteAccountFailed);
      setDeleting(false);
    }
  }, [deleting, navigate]);

  const handleEraseAccount = useCallback(async () => {
    if (erasing) return;
    setErasing(true);
    setEraseError(null);
    try {
      const receipt = await eraseMyAccount();
      setEraseReceipt(receipt);
      // Give the user 3 seconds to read the receipt, then log out and redirect
      setTimeout(async () => {
        try {
          await logout();
        } catch {
          // Ignore logout errors — session was destroyed server-side
        }
        navigate("/login");
      }, 3000);
    } catch (err) {
      setEraseError(err instanceof Error ? err.message : "Data erasure failed. Please try again.");
      setErasing(false);
    }
  }, [erasing, logout, navigate]);

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

  const handleNotifToggle = useCallback(async (type: string, channel: string, newValue: boolean) => {
    if (!notifPrefs) return;
    // Optimistic update
    const prev = { ...notifPrefs };
    const typePref = notifPrefs[type] as ChannelPrefs;
    setNotifPrefs({ ...notifPrefs, [type]: { ...typePref, [channel]: newValue } });
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL || "https://pnptv.app"}/api/webapp/notifications/preferences`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [type]: { [channel]: newValue } }),
      });
      if (!res.ok) setNotifPrefs(prev); // revert
    } catch {
      setNotifPrefs(prev); // revert
    }
  }, [notifPrefs]);

  const handleQuietHoursToggle = useCallback(async () => {
    if (!notifPrefs) return;
    const qh = notifPrefs.quiet_hours as { enabled: boolean; start: string; end: string } | undefined;
    const newEnabled = !(qh?.enabled ?? false);
    const prev = { ...notifPrefs };
    setNotifPrefs({ ...notifPrefs, quiet_hours: { enabled: newEnabled, start: qh?.start ?? "23:00", end: qh?.end ?? "08:00" } });
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL || "https://pnptv.app"}/api/webapp/notifications/preferences`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quiet_hours: { enabled: newEnabled } }),
      });
      if (!res.ok) setNotifPrefs(prev);
    } catch {
      setNotifPrefs(prev);
    }
  }, [notifPrefs]);

  const handleUnblock = useCallback(async (userId: string) => {
    if (unblockingId) return;
    setUnblockingId(userId);
    try {
      await unblockUser(userId);
      setBlockedUsers((prev) => prev.filter((u) => u.id !== userId));
    } catch { /* silent */ }
    setUnblockingId(null);
  }, [unblockingId]);

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
        <title>{p.settingsTitle} — PNPtv!</title>
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
      <h1 className="text-xl font-bold text-white mb-2">{p.settingsTitle}</h1>

      {/* ── Account ─────────────────────────────────────────────────────── */}
      <Section title={p.accountSection}>
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
                {p.joined} {formatDate(memberSince, uiLang)}
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
          <select
            value={selectedLang}
            onChange={(e) => handleLanguageChange(e.target.value as Lang)}
            disabled={langSaving}
            className="rounded-lg px-3 py-2 text-sm flex-shrink-0 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-white/20"
            style={{
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.12)",
              color: "#fff",
            }}
          >
            <option value="en">English</option>
            <option value="es">Español</option>
            <option value="pt">Português</option>
            <option value="fr">Français</option>
            <option value="de">Deutsch</option>
            <option value="it">Italiano</option>
            <option value="zh">中文 (简)</option>
            <option value="zhTW">中文 (繁)</option>
            <option value="ja">日本語</option>
            <option value="ru">Русский</option>
            <option value="ar">العربية</option>
            <option value="th">ไทย</option>
            <option value="tr">Türkçe</option>
            <option value="nl">Nederlands</option>
            <option value="vi">Tiếng Việt</option>
            <option value="id">Indonesia</option>
          </select>
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
                ? p.contentDisclaimerAccepted
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

      {/* ── Notifications ─────────────────────────────────────────────────── */}
      <Section title={p.notificationsSection}>
        {notifLoading ? (
          <div className="space-y-3">
            <div className="h-4 rounded bg-white/10 animate-pulse w-48" />
            <div className="h-4 rounded bg-white/10 animate-pulse w-40" />
            <div className="h-4 rounded bg-white/10 animate-pulse w-44" />
          </div>
        ) : notifPrefs ? (
          <>
            <p className="text-xs mb-3" style={{ color: "#8E8E93" }}>
              {p.notifChooseHow}
            </p>

            {/* Column headers */}
            <div className="flex items-center gap-1 mb-2 px-1">
              <div className="flex-1" />
              <div className="w-11 text-center text-[10px] font-medium" style={{ color: "#8E8E93" }}>{p.notifChannelPush}</div>
              <div className="w-11 text-center text-[10px] font-medium" style={{ color: "#8E8E93" }}>{p.notifChannelBot}</div>
              <div className="w-11 text-center text-[10px] font-medium" style={{ color: "#8E8E93" }}>{p.notifChannelEmail}</div>
            </div>

            {/* Notification type rows */}
            {([
              ["likes", p.notifLikes],
              ["follows", p.notifFollowers],
              ["replies", p.notifReplies],
              ["dms", p.notifDms],
              ["payments", p.notifPayments],
              ["announcements", p.notifAnnouncements],
              ["hangout_calls", p.notifHangoutCalls],
            ] as const).map(([key, label]) => {
              const pref = notifPrefs[key] as ChannelPrefs | undefined;
              if (!pref) return null;
              return (
                <div
                  key={key}
                  className="flex items-center gap-1 rounded-lg px-3 py-2.5 mb-1"
                  style={{ background: "rgba(255,255,255,0.03)" }}
                >
                  <p className="flex-1 text-sm text-white truncate">{label}</p>
                  <div className="w-11 flex justify-center">
                    <Toggle
                      checked={pref.push !== false}
                      onChange={() => handleNotifToggle(key, "push", pref.push === false)}
                      accentColor="#5ED1C4"
                    />
                  </div>
                  <div className="w-11 flex justify-center">
                    <Toggle
                      checked={pref.bot === true}
                      onChange={() => handleNotifToggle(key, "bot", !pref.bot)}
                      accentColor="#5ED1C4"
                    />
                  </div>
                  <div className="w-11 flex justify-center">
                    <Toggle
                      checked={pref.email === true}
                      onChange={() => handleNotifToggle(key, "email", !pref.email)}
                      accentColor="#5ED1C4"
                    />
                  </div>
                </div>
              );
            })}

            {/* Quiet Hours */}
            <div
              className="flex items-center justify-between rounded-lg px-3 py-3 mt-3"
              style={{ background: "rgba(102,126,234,0.06)", border: "1px solid rgba(102,126,234,0.15)" }}
            >
              <div className="flex-1 min-w-0 mr-3">
                <p className="text-sm font-medium text-white">{p.quietHours}</p>
                <p className="text-xs mt-0.5" style={{ color: "#8E8E93" }}>
                  {p.quietHoursDesc}
                </p>
              </div>
              <Toggle
                checked={(notifPrefs.quiet_hours as { enabled: boolean })?.enabled === true}
                onChange={handleQuietHoursToggle}
                accentColor="#667eea"
              />
            </div>
          </>
        ) : (
          <p className="text-xs" style={{ color: "#8E8E93" }}>
            {p.notifLoadError}
          </p>
        )}
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
            {p.referralLoadError}
          </p>
        )}
      </Section>

      {/* ── Blocked Users ─────────────────────────────────────────────────── */}
      <Section title="Blocked Users">
        {blockedLoading ? (
          <div className="space-y-3">
            <div className="h-12 rounded-lg animate-pulse" style={{ background: "rgba(255,255,255,0.05)" }} />
            <div className="h-12 rounded-lg animate-pulse" style={{ background: "rgba(255,255,255,0.05)" }} />
          </div>
        ) : blockedUsers.length === 0 ? (
          <div className="text-center py-4">
            <svg className="w-8 h-8 mx-auto mb-2" style={{ color: "#8E8E93" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
            </svg>
            <p className="text-sm" style={{ color: "#8E8E93" }}>No blocked users</p>
          </div>
        ) : (
          <div className="space-y-2">
            {blockedUsers.map((u) => {
              const photo = u.photoUrl && (u.photoUrl.startsWith("/") || u.photoUrl.startsWith("http")) ? u.photoUrl : null;
              const initial = (u.firstName || u.username || "?")[0].toUpperCase();
              return (
                <div
                  key={u.id}
                  className="flex items-center gap-3 rounded-lg px-3 py-2.5"
                  style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
                >
                  {photo ? (
                    <img src={photo} alt={u.firstName} className="w-9 h-9 rounded-full object-cover flex-shrink-0" />
                  ) : (
                    <div
                      className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
                      style={{ background: "linear-gradient(135deg, #D4007A, #E69138)", color: "#fff" }}
                    >
                      {initial}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">{u.firstName || u.username}</p>
                    {u.username && (
                      <p className="text-xs truncate" style={{ color: "#8E8E93" }}>@{u.username}</p>
                    )}
                  </div>
                  <button
                    onClick={() => handleUnblock(u.id)}
                    disabled={unblockingId === u.id}
                    className="text-xs px-3 py-1.5 rounded-lg flex-shrink-0 disabled:opacity-50 transition-colors"
                    style={{ background: "rgba(255,59,48,0.12)", color: "#FF453A", border: "1px solid rgba(255,59,48,0.25)" }}
                  >
                    {unblockingId === u.id ? "..." : "Unblock"}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      {/* ── Data & Privacy ───────────────────────────────────────────────── */}
      <Section title={p.dataPrivacySection}>
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
                {p.dataPrivacyTitle}
              </p>
              <p className="text-xs leading-relaxed" style={{ color: "rgba(255,255,255,0.6)" }}>
                {p.dataPrivacyBody}
              </p>
            </div>
          </div>
        </div>
      </Section>

      {/* ── Danger Zone ──────────────────────────────────────────────────── */}
      <Section title={p.dangerZoneSection}>
        <div
          className="rounded-xl p-4"
          style={{
            background: "rgba(255,59,48,0.05)",
            border: "1px solid rgba(255,59,48,0.15)",
          }}
        >
          <p className="text-sm font-medium text-white mb-1">{p.deleteAccount}</p>
          <p className="text-xs mb-3" style={{ color: "#8E8E93" }}>
            {p.deleteAccountDesc}
          </p>
          <button
            onClick={() => {
              setDeleteConfirmText("");
              setDeleteError(null);
              setShowDeleteModal(true);
            }}
            className="px-4 py-2 rounded-lg text-xs font-semibold transition-opacity hover:opacity-80"
            style={{
              background: "rgba(255,59,48,0.15)",
              color: "#FF3B30",
              border: "1px solid rgba(255,59,48,0.3)",
            }}
          >
            {p.deleteAccount}
          </button>
        </div>

        {/* ── GDPR Full Erasure ── */}
        <div
          className="rounded-xl p-4 mt-4"
          style={{
            background: "rgba(255,59,48,0.08)",
            border: "1px solid rgba(255,59,48,0.3)",
          }}
        >
          <div className="flex items-start gap-3 mb-3">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
              style={{ background: "rgba(255,59,48,0.2)" }}
            >
              <svg
                className="w-4 h-4"
                style={{ color: "#FF3B30" }}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-white mb-1">
                Erase All My Data (GDPR Article 17)
              </p>
              <p className="text-xs leading-relaxed" style={{ color: "rgba(255,255,255,0.55)" }}>
                This permanently deletes ALL your data from our servers, including messages, payment history, and chat history. This action cannot be undone.
              </p>
            </div>
          </div>
          <button
            onClick={() => {
              setEraseConfirmText("");
              setEraseError(null);
              setEraseReceipt(null);
              setShowEraseModal(true);
            }}
            className="px-4 py-2 rounded-lg text-xs font-semibold transition-opacity hover:opacity-80"
            style={{
              background: "rgba(255,59,48,0.25)",
              color: "#FF3B30",
              border: "1px solid rgba(255,59,48,0.5)",
            }}
          >
            Request Full Data Erasure
          </button>
        </div>
      </Section>

      {/* ── Delete Account Modal ──────────────────────────────────────────── */}
      {showDeleteModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-modal-title"
          aria-describedby="delete-modal-desc"
          onKeyDown={(e) => {
            if (e.key === "Escape" && !deleting) setShowDeleteModal(false);
          }}
          tabIndex={-1}
          ref={deleteModalRef}
        >
          <div
            className="w-full max-w-sm rounded-2xl p-6"
            style={{ background: "#13131a", border: "1px solid rgba(255,59,48,0.25)" }}
          >
            <h2
              id="delete-modal-title"
              className="text-base font-bold text-white mb-3"
            >
              {p.deleteAccountConfirm}
            </h2>
            <p id="delete-modal-desc" className="text-xs leading-relaxed mb-4" style={{ color: "#8E8E93" }}>
              {p.deleteAccountWarning}
            </p>
            <p className="text-xs mb-2" style={{ color: "rgba(255,255,255,0.5)" }}>
              {p.typeToConfirm.replace("{word}", p.deleteConfirmWord)}
            </p>
            <input
              ref={deleteInputRef}
              type="text"
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              disabled={deleting}
              autoFocus
              className="w-full rounded-lg px-3 py-2 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-red-500/50 disabled:opacity-50"
              style={{
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,59,48,0.3)",
                color: "#fff",
              }}
              placeholder={p.deleteConfirmWord}
              aria-label={p.typeToConfirm.replace("{word}", p.deleteConfirmWord)}
            />
            {deleteError && (
              <p className="text-xs mb-3" style={{ color: "#FF6B6B" }}>{deleteError}</p>
            )}
            <div className="flex gap-3">
              <button
                onClick={() => !deleting && setShowDeleteModal(false)}
                disabled={deleting}
                className="flex-1 py-2 rounded-lg text-sm font-medium transition-opacity hover:opacity-80 disabled:opacity-40"
                style={{
                  background: "rgba(255,255,255,0.08)",
                  color: "#fff",
                  border: "1px solid rgba(255,255,255,0.12)",
                }}
              >
                {p.cancel}
              </button>
              <button
                onClick={handleDeleteAccount}
                disabled={
                  deleting ||
                  deleteConfirmText.toUpperCase() !== p.deleteConfirmWord.toUpperCase()
                }
                className="flex-1 py-2 rounded-lg text-sm font-semibold transition-opacity hover:opacity-80 disabled:opacity-30 disabled:cursor-not-allowed"
                style={{
                  background: "rgba(255,59,48,0.25)",
                  color: "#FF3B30",
                  border: "1px solid rgba(255,59,48,0.4)",
                }}
              >
                {deleting ? p.deletingAccount : p.deleteAccount}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── GDPR Erase Modal ──────────────────────────────────────────────── */}
      {showEraseModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="erase-modal-title"
          aria-describedby="erase-modal-desc"
          onKeyDown={(e) => {
            if (e.key === "Escape" && !erasing && !eraseReceipt) setShowEraseModal(false);
          }}
          tabIndex={-1}
          ref={eraseModalRef}
        >
          <div
            className="w-full max-w-sm rounded-2xl p-6"
            style={{ background: "#13131a", border: "1px solid rgba(255,59,48,0.4)" }}
          >
            {eraseReceipt ? (
              /* ── Receipt view ── */
              <>
                <div className="flex items-center gap-2 mb-3">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{ background: "rgba(94,209,196,0.15)" }}
                  >
                    <svg className="w-4 h-4" style={{ color: "#5ED1C4" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                  </div>
                  <h2 id="erase-modal-title" className="text-base font-bold text-white">
                    Erasure Requested
                  </h2>
                </div>
                <p className="text-xs leading-relaxed mb-4" style={{ color: "rgba(255,255,255,0.6)" }}>
                  Your data erasure request has been logged. You will be signed out in a moment.
                </p>
                <div
                  className="rounded-lg p-3 space-y-1.5"
                  style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
                >
                  <div>
                    <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: "#8E8E93" }}>Erasure ID</p>
                    <p className="text-xs font-mono text-white break-all">{eraseReceipt.erasure_id}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: "#8E8E93" }}>Timestamp</p>
                    <p className="text-xs text-white">
                      {new Date(eraseReceipt.timestamp).toLocaleString()}
                    </p>
                  </div>
                  {eraseReceipt.scope && eraseReceipt.scope.length > 0 && (
                    <div>
                      <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: "#8E8E93" }}>Scope</p>
                      <p className="text-xs text-white">{eraseReceipt.scope.join(", ")}</p>
                    </div>
                  )}
                </div>
              </>
            ) : (
              /* ── Confirmation form ── */
              <>
                <div className="flex items-start gap-3 mb-4">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                    style={{ background: "rgba(255,59,48,0.2)" }}
                  >
                    <svg className="w-4 h-4" style={{ color: "#FF3B30" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                    </svg>
                  </div>
                  <div>
                    <h2 id="erase-modal-title" className="text-base font-bold text-white mb-1">
                      Erase All My Data (GDPR Article 17)
                    </h2>
                    <p id="erase-modal-desc" className="text-xs leading-relaxed" style={{ color: "#8E8E93" }}>
                      This permanently deletes ALL your data from our servers, including messages, payment history, and chat history. This action cannot be undone.
                    </p>
                  </div>
                </div>

                <p className="text-xs mb-2" style={{ color: "rgba(255,255,255,0.5)" }}>
                  Type <span className="font-mono font-semibold" style={{ color: "#FF3B30" }}>DELETE MY ACCOUNT</span> to confirm
                </p>
                <input
                  ref={eraseInputRef}
                  type="text"
                  value={eraseConfirmText}
                  onChange={(e) => setEraseConfirmText(e.target.value)}
                  disabled={erasing}
                  autoFocus
                  className="w-full rounded-lg px-3 py-2 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-red-500/50 disabled:opacity-50"
                  style={{
                    background: "rgba(255,255,255,0.05)",
                    border: "1px solid rgba(255,59,48,0.4)",
                    color: "#fff",
                  }}
                  placeholder="DELETE MY ACCOUNT"
                  aria-label="Type DELETE MY ACCOUNT to confirm erasure"
                />
                {eraseError && (
                  <p className="text-xs mb-3" style={{ color: "#FF6B6B" }}>{eraseError}</p>
                )}
                <div className="flex gap-3">
                  <button
                    onClick={() => !erasing && setShowEraseModal(false)}
                    disabled={erasing}
                    className="flex-1 py-2 rounded-lg text-sm font-medium transition-opacity hover:opacity-80 disabled:opacity-40"
                    style={{
                      background: "rgba(255,255,255,0.08)",
                      color: "#fff",
                      border: "1px solid rgba(255,255,255,0.12)",
                    }}
                  >
                    {p.cancel}
                  </button>
                  <button
                    onClick={handleEraseAccount}
                    disabled={erasing || eraseConfirmText !== "DELETE MY ACCOUNT"}
                    className="flex-1 py-2 rounded-lg text-sm font-semibold transition-opacity hover:opacity-80 disabled:opacity-30 disabled:cursor-not-allowed"
                    style={{
                      background: "rgba(255,59,48,0.3)",
                      color: "#FF3B30",
                      border: "1px solid rgba(255,59,48,0.5)",
                    }}
                  >
                    {erasing ? "Erasing..." : "Erase All Data"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
