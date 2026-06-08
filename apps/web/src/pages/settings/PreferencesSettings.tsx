import React, { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useI18n, type Lang } from "@/lib/i18n";
import { getProfile, updateProfile, updatePrivacy, updateLanguage } from "@/lib/api";

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

// ── Theme Picker ──────────────────────────────────────────────────────────────

type ThemeChoice = "dark" | "light" | "system";

function readStoredTheme(): ThemeChoice {
  try {
    const raw = localStorage.getItem("pnptv:theme");
    if (raw === "dark" || raw === "light" || raw === "system") return raw;
  } catch { /* noop */ }
  return "system";
}

function applyTheme(choice: ThemeChoice) {
  const root = document.documentElement;
  const effective: "dark" | "light" =
    choice === "light" ? "light" : "dark";
  root.classList.add("theme-transition");
  if (effective === "light") root.setAttribute("data-theme", "light");
  else root.removeAttribute("data-theme");
  setTimeout(() => root.classList.remove("theme-transition"), 250);
}

function ThemePicker() {
  const [choice, setChoice] = useState<ThemeChoice>(() => readStoredTheme());

  useEffect(() => {
    if (choice !== "system" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [choice]);

  const update = useCallback((next: ThemeChoice) => {
    setChoice(next);
    try { localStorage.setItem("pnptv:theme", next); } catch { /* noop */ }
    applyTheme(next);
  }, []);

  const options: Array<{ id: ThemeChoice; label: string; icon: string }> = [
    { id: "dark",   label: "Dark",   icon: "🌙" },
    { id: "light",  label: "Light",  icon: "☀️" },
    { id: "system", label: "System", icon: "🖥️" },
  ];

  return (
    <div
      className="rounded-lg px-3 py-3 mb-3"
      style={{ background: "rgba(167,139,250,0.06)", border: "1px solid rgba(167,139,250,0.2)" }}
    >
      <div className="mb-2.5">
        <p className="text-sm font-medium text-white">Theme</p>
        <p className="text-xs mt-0.5" style={{ color: "var(--pnp-text-secondary)" }}>
          Choose how PNPtv looks. System follows your device.
        </p>
      </div>
      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Theme">
        {options.map((opt) => {
          const active = choice === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => update(opt.id)}
              className="flex flex-col items-center gap-1 py-2.5 rounded-lg text-xs font-semibold transition-all active:scale-[0.97]"
              style={{
                background: active
                  ? "linear-gradient(135deg, rgba(212,0,122,0.30), rgba(167,139,250,0.25))"
                  : "rgba(255,255,255,0.04)",
                border: active
                  ? "1px solid rgba(212,0,122,0.45)"
                  : "1px solid rgba(255,255,255,0.10)",
                color: active ? "#fff" : "rgba(255,255,255,0.70)",
              }}
            >
              <span className="text-base" aria-hidden>{opt.icon}</span>
              <span>{opt.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── PreferencesSettings ───────────────────────────────────────────────────────

export default function PreferencesSettings() {
  const navigate = useNavigate();
  const { isAuthenticated, refreshUser } = useAuth();
  const t = useI18n();
  const p = t.profile;

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

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    setLoading(true);
    getProfile()
      .then((res) => {
        if (cancelled) return;
        const profile = res.profile;
        setWofConsent(profile.wofPhotoConsent ?? false);
        setContentDisclaimer(profile.contentDisclaimer ?? false);
        setAutoShareToX(profile.autoShareToX ?? false);
        setXHandle(profile.xHandle ?? null);
        setSelectedLang((profile.language as Lang) ?? "en");
      })
      .catch(() => { /* silent */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [isAuthenticated]);

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
        setLangError(err instanceof Error ? err.message : p.langUpdateError);
        setTimeout(() => setLangError(null), 4000);
      } finally {
        setLangSaving(false);
      }
    },
    [selectedLang, langSaving, refreshUser, p],
  );

  const handleWofConsentToggle = useCallback(async () => {
    const newValue = !wofConsent;
    setWofConsentSaving(true);
    try {
      await updateProfile({ wofPhotoConsent: newValue });
      setWofConsent(newValue);
    } catch { /* silent */ }
    finally { setWofConsentSaving(false); }
  }, [wofConsent]);

  const handleContentDisclaimerToggle = useCallback(async () => {
    if (contentDisclaimer) return;
    setContentDisclaimerSaving(true);
    try {
      await updateProfile({ contentDisclaimer: true });
      setContentDisclaimer(true);
    } catch { /* silent */ }
    finally { setContentDisclaimerSaving(false); }
  }, [contentDisclaimer]);

  const handleAutoShareToXToggle = useCallback(async () => {
    const newValue = !autoShareToX;
    setAutoShareToXSaving(true);
    try {
      await updatePrivacy({ autoShareToX: newValue });
      setAutoShareToX(newValue);
    } catch { /* silent */ }
    finally { setAutoShareToXSaving(false); }
  }, [autoShareToX]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="glass-card-sm p-5">
          <div className="h-4 rounded bg-white/10 animate-pulse w-32 mb-4" />
          <div className="h-12 rounded bg-white/5 animate-pulse mb-3" />
          <div className="h-12 rounded bg-white/5 animate-pulse" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="glass-card-sm p-5">
        <h2 className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-4">
          {p.appPreferences}
        </h2>

        {/* Language */}
        <div
          className="flex items-center justify-between rounded-lg px-3 py-3 mb-3"
          style={{ background: "rgba(94,209,196,0.06)", border: "1px solid rgba(94,209,196,0.2)" }}
        >
          <div className="flex-1 min-w-0 mr-3">
            <p className="text-sm font-medium text-white">{p.languageIdioma}</p>
            <p className="text-xs mt-0.5" style={{ color: "var(--pnp-text-secondary)" }}>
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

        {/* Theme */}
        <ThemePicker />

        {/* Wall of Fame consent */}
        <div
          className="flex items-center justify-between rounded-lg px-3 py-3 mb-3"
          style={{ background: "rgba(255,180,84,0.06)", border: "1px solid rgba(255,180,84,0.15)" }}
        >
          <div className="flex-1 min-w-0 mr-3">
            <p className="text-sm font-medium text-white">{p.wallOfFameConsent}</p>
            <p className="text-xs mt-0.5" style={{ color: "var(--pnp-text-secondary)" }}>
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
          className="flex items-center justify-between rounded-lg px-3 py-3 mb-3"
          style={{ background: "rgba(212,0,122,0.06)", border: "1px solid rgba(212,0,122,0.15)" }}
        >
          <div className="flex-1 min-w-0 mr-3">
            <p className="text-sm font-medium text-white">{p.contentDisclaimer}</p>
            <p className="text-xs mt-0.5" style={{ color: "var(--pnp-text-secondary)" }}>
              {contentDisclaimer ? p.contentDisclaimerAccepted : p.contentDisclaimerDesc}
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
          className="flex items-center justify-between rounded-lg px-3 py-3"
          style={{ background: "rgba(0,0,0,0.25)", border: "1px solid rgba(255,255,255,0.1)" }}
        >
          <div className="flex-1 min-w-0 mr-3">
            <div className="flex items-center gap-1.5 flex-wrap">
              <p className="text-sm font-medium text-white">Share posts to X by default</p>
              {xHandle && (
                <span
                  className="text-xs px-1.5 py-0.5 rounded-full font-medium"
                  style={{ background: "rgba(255,255,255,0.08)", color: "var(--pnp-text-secondary)" }}
                >
                  @{xHandle}
                </span>
              )}
            </div>
            <p className="text-xs mt-0.5" style={{ color: "var(--pnp-text-secondary)" }}>
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
      </div>

      {/* ── Back to settings ── */}
      <button
        onClick={() => navigate("/settings")}
        className="w-full py-3 rounded-xl text-sm font-medium transition-colors hover:text-white"
        style={{ color: "var(--pnp-text-secondary)", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}
      >
        {p.back}
      </button>
    </div>
  );
}
