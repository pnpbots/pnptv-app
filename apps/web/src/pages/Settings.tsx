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
  updatePrivacy,
  updateLanguage,
  deleteAccount,
  eraseMyAccount,
  getBlockedUsers,
  unblockUser,
  getWalletBalance,
  getWalletHistory,
  linkDPNS,
  getVapidKey,
  subscribePush,
  unsubscribePush,
  type ReferralStats,
  type BlockedUser,
  type EraseAccountReceipt,
  type TokenPurchase,
} from "@/lib/api";
import IdentityConnections from "@/components/profile/IdentityConnections";

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

  const [autoShareToX, setAutoShareToX] = useState(false);
  const [autoShareToXSaving, setAutoShareToXSaving] = useState(false);
  const [xHandle, setXHandle] = useState<string | null>(null);

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

  // ── Wallet & DPNS state ─────────────────────────────────────────────────
  const [dpnsHandle, setDpnsHandle] = useState<string | null>(null);
  const [dpnsInput, setDpnsInput] = useState("");
  const [dpnsSaving, setDpnsSaving] = useState(false);
  const [dpnsError, setDpnsError] = useState<string | null>(null);
  const [showDpnsInput, setShowDpnsInput] = useState(false);
  const [dpnsSuccess, setDpnsSuccess] = useState(false);
  const [tokenBalance, setTokenBalance] = useState<number>(0);

  // ── Transaction history state ───────────────────────────────────────────
  const [txHistory, setTxHistory] = useState<TokenPurchase[]>([]);
  const [txLoading, setTxLoading] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  // ── Newsletter subscription state ─────────────────────────────────────
  const [newsletterSubscribed, setNewsletterSubscribed] = useState(() => {
    try { return localStorage.getItem("pnp_newsletter_subscribed") === "1"; } catch { return false; }
  });
  const [newsletterLoading, setNewsletterLoading] = useState(false);

  // ── Browser push notifications state ─────────────────────────────────
  type PushState = "unsupported" | "denied" | "enabled" | "disabled";
  const [pushState, setPushState] = useState<PushState>("disabled");
  const [pushLoading, setPushLoading] = useState(false);

  // ── Detect current push subscription state on mount ─────────────────────
  useEffect(() => {
    if (!isAuthenticated) return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setPushState("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setPushState("denied");
      return;
    }
    navigator.serviceWorker.ready.then((reg) => {
      reg.pushManager.getSubscription().then((sub) => {
        setPushState(sub ? "enabled" : "disabled");
      }).catch(() => setPushState("disabled"));
    }).catch(() => setPushState("disabled"));
  }, [isAuthenticated]);

  // ── Load data ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isAuthenticated) return;

    let cancelled = false;

    async function load() {
      setProfileLoading(true);
      setBlockedLoading(true);
      try {
        const [profileRes, referralRes, notifRes, blockedRes, walletRes] = await Promise.all([
          getProfile(),
          getMyReferral().catch(() => null),
          fetch(`${import.meta.env.VITE_API_URL || "https://pnptv.app"}/api/webapp/notifications/preferences`, { credentials: "include" })
            .then(r => r.ok ? r.json() : null).catch(() => null),
          getBlockedUsers().catch(() => null),
          getWalletBalance().catch(() => null),
        ]);

        if (cancelled) return;

        const profile = profileRes.profile;
        setMemberSince(profile.memberSince ?? null);
        setWofConsent(profile.wofPhotoConsent ?? false);
        setContentDisclaimer(profile.contentDisclaimer ?? false);
        setAutoShareToX(profile.autoShareToX ?? false);
        setXHandle(profile.xHandle ?? null);
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
        if (walletRes) {
          setDpnsHandle(walletRes.dpnsHandle ?? null);
          setTokenBalance(walletRes.balance ?? 0);
        }
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

  const handleAutoShareToXToggle = useCallback(async () => {
    const newValue = !autoShareToX;
    setAutoShareToXSaving(true);
    try {
      await updatePrivacy({ autoShareToX: newValue });
      setAutoShareToX(newValue);
    } catch {
      // Revert silently
    } finally {
      setAutoShareToXSaving(false);
    }
  }, [autoShareToX]);

  const handleSaveDpns = useCallback(async () => {
    const handle = dpnsInput.trim();
    if (!handle || dpnsSaving) return;
    if (!/^[a-z0-9_-]{3,63}(\.dash)?$/i.test(handle)) {
      setDpnsError(p.dpnsInvalidFormat);
      return;
    }
    setDpnsSaving(true);
    setDpnsError(null);
    try {
      const result = await linkDPNS(handle);
      setDpnsHandle(result.dpnsHandle);
      setShowDpnsInput(false);
      setDpnsInput("");
      setDpnsSuccess(true);
      setTimeout(() => setDpnsSuccess(false), 3000);
    } catch (err) {
      setDpnsError(err instanceof Error ? err.message : "Failed to link DPNS");
    } finally {
      setDpnsSaving(false);
    }
  }, [dpnsInput, dpnsSaving, p]);

  const handleShowHistory = useCallback(async () => {
    if (showHistory) {
      setShowHistory(false);
      return;
    }
    setShowHistory(true);
    setTxLoading(true);
    try {
      const res = await getWalletHistory();
      setTxHistory(res.history || []);
    } catch {
      setTxHistory([]);
    }
    setTxLoading(false);
  }, [showHistory]);

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
    const text = referralStats.link;
    const onSuccess = () => {
      setReferralCopied(true);
      setTimeout(() => setReferralCopied(false), 2000);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(onSuccess).catch(() => {
        // Fallback for in-app browsers that block clipboard API
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        onSuccess();
      });
    } else {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      onSuccess();
    }
  }, [referralStats]);

  const handleNewsletterToggle = useCallback(async () => {
    if (!user?.email) return;
    setNewsletterLoading(true);
    try {
      if (newsletterSubscribed) {
        // Unsubscribe: POST to unsubscribe endpoint (Listmonk public API)
        const res = await fetch("/api/newsletter/subscription/form", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: user.email, list_uuids: [], unsubscribe: true }),
        });
        if (res.ok) {
          localStorage.setItem("pnp_newsletter_subscribed", "0");
          setNewsletterSubscribed(false);
        }
      } else {
        // Subscribe
        const res = await fetch("/api/newsletter/subscription", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: user.email, list_ids: [3], name: user.firstName || undefined }),
        });
        if (res.ok) {
          localStorage.setItem("pnp_newsletter_subscribed", "1");
          setNewsletterSubscribed(true);
        }
      }
    } catch { /* silent — toggle reverts visually */ }
    finally { setNewsletterLoading(false); }
  }, [user, newsletterSubscribed]);

  const handlePushToggle = useCallback(async () => {
    if (pushLoading || pushState === "unsupported" || pushState === "denied") return;

    setPushLoading(true);
    try {
      if (pushState === "enabled") {
        // Unsubscribe
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          await unsubscribePush(sub.endpoint).catch(() => {});
          await sub.unsubscribe();
        }
        setPushState("disabled");
      } else {
        // Request permission
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          setPushState(permission === "denied" ? "denied" : "disabled");
          return;
        }
        // Fetch VAPID key and subscribe
        const { publicKey } = await getVapidKey();
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: publicKey,
        });
        await subscribePush(sub.toJSON() as { endpoint: string; keys: { auth: string; p256dh: string } });
        setPushState("enabled");
      }
    } catch (err) {
      // Silent — state reverts
      console.warn("Push toggle error:", err);
    } finally {
      setPushLoading(false);
    }
  }, [pushLoading, pushState]);

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

      {/* ── Identity & Connections ──────────────────────────────────────── */}
      <IdentityConnections telegramUsername={user?.username || undefined} />

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
            className="rounded-lg px-3 py-2 flex-shrink-0 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-white/20"
            style={{
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.12)",
              color: "#fff",
              fontSize: "16px",
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

        {/* Auto-share posts to X */}
        <div
          className="flex items-center justify-between rounded-lg px-3 py-3 mt-3"
          style={{ background: "rgba(0,0,0,0.25)", border: "1px solid rgba(255,255,255,0.1)" }}
        >
          <div className="flex-1 min-w-0 mr-3">
            <div className="flex items-center gap-1.5 flex-wrap">
              <p className="text-sm font-medium text-white">Share posts to X by default</p>
              {xHandle && (
                <span className="text-xs px-1.5 py-0.5 rounded-full font-medium" style={{ background: "rgba(255,255,255,0.08)", color: "#8E8E93" }}>
                  @{xHandle}
                </span>
              )}
            </div>
            <p className="text-xs mt-0.5" style={{ color: "#8E8E93" }}>
              {xHandle
                ? "Automatically cross-post new posts to your X account when published."
                : "Add your X account in Edit Profile first to enable cross-posting."}
            </p>
          </div>
          <Toggle
            checked={autoShareToX}
            onChange={handleAutoShareToXToggle}
            disabled={autoShareToXSaving || !xHandle}
            accentColor="#000000"
          />
        </div>
      </Section>

      {/* ── Wallet & Dash Identity ────────────────────────────────────────── */}
      <Section title={p.walletDashSection}>
        <p className="text-xs mb-3" style={{ color: "#8E8E93" }}>
          {p.walletDashDesc}
        </p>

        {/* Token balance */}
        <div
          className="flex items-center justify-between rounded-lg px-3 py-3 mb-3"
          style={{ background: "rgba(0,141,228,0.06)", border: "1px solid rgba(0,141,228,0.2)" }}
        >
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 flex-shrink-0" style={{ color: "#008DE4" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
            </svg>
            <span className="text-sm font-medium text-white">{p.dpnsTokenBalance}</span>
          </div>
          <span className="text-sm font-bold" style={{ color: "#008DE4" }}>{tokenBalance}</span>
        </div>

        {/* DPNS handle display / link */}
        <div
          className="rounded-lg px-3 py-3"
          style={{ background: "rgba(0,141,228,0.06)", border: "1px solid rgba(0,141,228,0.2)" }}
        >
          {dpnsHandle ? (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-white">{p.dpnsLinked}</span>
                <span
                  className="text-xs font-semibold px-2 py-0.5 rounded-full"
                  style={{ background: "rgba(0,141,228,0.2)", color: "#008DE4" }}
                >
                  @{dpnsHandle}
                </span>
              </div>
              <button
                onClick={() => { setShowDpnsInput(!showDpnsInput); setDpnsInput(dpnsHandle); setDpnsError(null); }}
                className="text-xs hover:underline transition-colors"
                style={{ color: "#008DE4" }}
              >
                {p.editProfileTitle?.includes("Edit") ? "Edit" : "Editar"}
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-white">{p.dpnsLinked}</span>
              <button
                onClick={() => { setShowDpnsInput(true); setDpnsError(null); }}
                className="text-xs font-semibold px-3 py-1 rounded-lg transition-colors"
                style={{ background: "rgba(0,141,228,0.2)", color: "#008DE4" }}
              >
                {p.linkDpnsIdentity}
              </button>
            </div>
          )}

          {showDpnsInput && (
            <div className="mt-3 flex gap-2">
              <input
                type="text"
                value={dpnsInput}
                onChange={(e) => { setDpnsInput(e.target.value); setDpnsError(null); }}
                placeholder={p.dpnsPlaceholder}
                disabled={dpnsSaving}
                className="flex-1 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#008DE4]/40 disabled:opacity-50"
                style={{
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.12)",
                  color: "#fff",
                  fontSize: "16px",
                }}
              />
              <button
                onClick={handleSaveDpns}
                disabled={!dpnsInput.trim() || dpnsSaving}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ background: "#008DE4" }}
              >
                {dpnsSaving ? p.dpnsSaving : p.dpnsSave}
              </button>
            </div>
          )}

          {dpnsError && (
            <p className="mt-2 text-xs" style={{ color: "#FF6B6B" }}>{dpnsError}</p>
          )}
          {dpnsSuccess && (
            <p className="mt-2 text-xs" style={{ color: "#34C759" }}>{p.dpnsSaved}</p>
          )}
        </div>

        {/* ── Transaction History ─────────────────────────────────────────── */}
        <div className="mt-3">
          <button
            onClick={handleShowHistory}
            className="w-full flex items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium transition-colors"
            style={{ background: "rgba(0,141,228,0.08)", border: "1px solid rgba(0,141,228,0.18)", color: "#008DE4" }}
          >
            <span className="flex items-center gap-2">
              <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {showHistory ? p.txHistoryHide : p.txHistoryToggle}
            </span>
            <svg
              className="w-4 h-4 flex-shrink-0 transition-transform"
              style={{ transform: showHistory ? "rotate(180deg)" : "rotate(0deg)" }}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {showHistory && (
            <div className="mt-2 space-y-1.5">
              {txLoading ? (
                <>
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="h-12 rounded-lg animate-pulse" style={{ background: "rgba(255,255,255,0.05)" }} />
                  ))}
                </>
              ) : txHistory.length === 0 ? (
                <div
                  className="rounded-lg px-3 py-4 text-center text-sm"
                  style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", color: "#8E8E93" }}
                >
                  {p.txHistoryEmpty}
                </div>
              ) : (
                txHistory.map((tx) => {
                  const dateStr = new Date(tx.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
                  const method = (tx.payment_method ?? "").toLowerCase();
                  const methodLabel =
                    method === "dash" || method === "btcpay" ? p.txMethodDash :
                    method === "card" || method === "epayco" || method === "tokenized_card" ? p.txMethodCard :
                    method === "usdc" ? p.txMethodUsdc :
                    method === "usdt" ? p.txMethodUsdt :
                    method === "wallet" ? p.txMethodWallet :
                    p.txMethodDash;
                  const methodColor =
                    method === "dash" || method === "btcpay" ? { bg: "rgba(0,141,228,0.15)", fg: "#008DE4" } :
                    method === "card" || method === "epayco" || method === "tokenized_card" ? { bg: "rgba(52,199,89,0.15)", fg: "#34C759" } :
                    method === "usdc" ? { bg: "rgba(130,80,255,0.15)", fg: "#8250FF" } :
                    method === "usdt" ? { bg: "rgba(38,161,123,0.15)", fg: "#26A17B" } :
                    { bg: "rgba(0,141,228,0.15)", fg: "#008DE4" };
                  const statusLower = (tx.status ?? "").toLowerCase();
                  const statusLabel =
                    statusLower === "settled" || statusLower === "completed" || statusLower === "paid" ? p.txStatusCompleted :
                    statusLower === "expired" || statusLower === "invalid" ? p.txStatusExpired :
                    p.txStatusPending;
                  const statusColor =
                    statusLower === "settled" || statusLower === "completed" || statusLower === "paid"
                      ? { bg: "rgba(52,199,89,0.13)", fg: "#34C759" }
                      : statusLower === "expired" || statusLower === "invalid"
                      ? { bg: "rgba(255,59,48,0.13)", fg: "#FF3B30" }
                      : { bg: "rgba(255,204,0,0.13)", fg: "#FFCC00" };

                  return (
                    <div
                      key={tx.id}
                      className="flex items-center justify-between rounded-lg px-3 py-2.5 gap-2"
                      style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}
                    >
                      <div className="flex flex-col min-w-0">
                        <span className="text-xs" style={{ color: "#8E8E93" }}>{dateStr}</span>
                        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                          <span className="text-xs font-semibold" style={{ color: "#008DE4" }}>+{tx.tokens_credited} tokens</span>
                          <span className="text-xs" style={{ color: "#6E6E73" }}>·</span>
                          <span className="text-xs" style={{ color: "#8E8E93" }}>${Number(tx.usd_amount).toFixed(2)}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <span
                          className="text-xs font-medium px-2 py-0.5 rounded-full"
                          style={{ background: methodColor.bg, color: methodColor.fg }}
                        >
                          {methodLabel}
                        </span>
                        <span
                          className="text-xs font-medium px-2 py-0.5 rounded-full"
                          style={{ background: statusColor.bg, color: statusColor.fg }}
                        >
                          {statusLabel}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
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
            <div className="flex items-center gap-0.5 mb-2 px-1">
              <div className="flex-1 min-w-0" />
              <div className="w-10 text-center text-[9px] font-medium" style={{ color: "#8E8E93" }}>{p.notifChannelPush}</div>
              <div className="w-10 text-center text-[9px] font-medium" style={{ color: "#8E8E93" }}>{p.notifChannelBot}</div>
              <div className="w-10 text-center text-[9px] font-medium" style={{ color: "#8E8E93" }}>{p.notifChannelEmail}</div>
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
              ["going_live", "Notify me when creators I follow go live"],
            ] as const).map(([key, label]) => {
              const pref = notifPrefs[key] as ChannelPrefs | undefined;
              if (!pref) return null;
              return (
                <div
                  key={key}
                  className="flex items-center gap-0.5 rounded-lg px-2 py-2.5 mb-1"
                  style={{ background: "rgba(255,255,255,0.03)" }}
                >
                  <p className="flex-1 min-w-0 text-sm text-white truncate pr-1">{label}</p>
                  <div className="w-10 flex justify-center flex-shrink-0">
                    <Toggle
                      checked={pref.push !== false}
                      onChange={() => handleNotifToggle(key, "push", pref.push === false)}
                      accentColor="#5ED1C4"
                    />
                  </div>
                  <div className="w-10 flex justify-center flex-shrink-0">
                    <Toggle
                      checked={pref.bot === true}
                      onChange={() => handleNotifToggle(key, "bot", !pref.bot)}
                      accentColor="#5ED1C4"
                    />
                  </div>
                  <div className="w-10 flex justify-center flex-shrink-0">
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

      {/* ── Communications ───────────────────────────────────────────────── */}
      <Section title="Communications">
        <div className="flex items-center justify-between">
          <div className="flex-1 min-w-0 mr-4">
            <p className="text-sm text-white font-medium">PNPtv! Newsletter</p>
            <p className="text-xs mt-0.5" style={{ color: "#8E8E93" }}>
              Receive creator drops, platform news, and exclusive offers by email.
            </p>
          </div>
          <Toggle
            checked={newsletterSubscribed}
            onChange={handleNewsletterToggle}
            disabled={newsletterLoading || !user?.email}
            accentColor="#D4007A"
          />
        </div>

        {/* Browser push notifications */}
        <div className="flex items-center justify-between mt-4">
          <div className="flex-1 min-w-0 mr-4">
            <p className="text-sm text-white font-medium">Browser Notifications</p>
            <p className="text-xs mt-0.5" style={{ color: "#8E8E93" }}>
              {pushState === "unsupported"
                ? "Push notifications are not supported in this browser."
                : pushState === "denied"
                ? "Notifications blocked. Allow them in your browser settings."
                : pushState === "enabled"
                ? "You will receive push notifications for messages and invites."
                : "Enable to get notified about messages and hangout invites."}
            </p>
          </div>
          {pushState === "unsupported" || pushState === "denied" ? (
            <span
              className="text-xs px-2.5 py-1 rounded-full flex-shrink-0"
              style={{
                background: "rgba(255,255,255,0.07)",
                color: "#8E8E93",
                border: "1px solid rgba(255,255,255,0.12)",
              }}
            >
              {pushState === "unsupported" ? "N/A" : "Blocked"}
            </span>
          ) : (
            <Toggle
              checked={pushState === "enabled"}
              onChange={handlePushToggle}
              disabled={pushLoading}
              accentColor="#5ED1C4"
            />
          )}
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
                  <button onClick={() => navigate(`/profile/${u.id}`)} className="flex-shrink-0">
                    {photo ? (
                      <img src={photo} alt={u.firstName} className="w-9 h-9 rounded-full object-cover cursor-pointer" />
                    ) : (
                      <div
                        className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold cursor-pointer"
                        style={{ background: "linear-gradient(135deg, #D4007A, #E69138)", color: "#fff" }}
                      >
                        {initial}
                      </div>
                    )}
                  </button>
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
              className="w-full rounded-lg px-3 py-2 mb-4 focus:outline-none focus:ring-2 focus:ring-red-500/50 disabled:opacity-50"
              style={{
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,59,48,0.3)",
                color: "#fff",
                fontSize: "16px",
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
                  className="w-full rounded-lg px-3 py-2 mb-4 focus:outline-none focus:ring-2 focus:ring-red-500/50 disabled:opacity-50"
                  style={{
                    background: "rgba(255,255,255,0.05)",
                    border: "1px solid rgba(255,59,48,0.4)",
                    color: "#fff",
                    fontSize: "16px",
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
