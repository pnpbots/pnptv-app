import React, { useState, useEffect, useRef, useCallback } from "react";
import { telegramWidgetAuth, type TelegramWidgetUser } from "@/lib/api";
import { login as oidcLogin, rememberReturnTo, sanitizeReturnTo } from "@/lib/auth";
import { getI18n, getLang } from "@/lib/i18n";
import { useAuth } from "@/hooks/useAuth";

const AUTHENTIK_URL = import.meta.env.VITE_AUTHENTIK_URL || "https://auth.pnptv.app";
const ENROLLMENT_FLOW_URL = `${AUTHENTIK_URL}/if/flow/pnptv-enrollment/`;
const RECOVERY_FLOW_URL = `${AUTHENTIK_URL}/if/flow/pnptv-recovery/`;

// Strip leading '@' if present (BotFather usernames may be stored with it)
function getBotUsername(): string {
  const raw =
    import.meta.env.VITE_TELEGRAM_BOT_USERNAME || "PNPLatinoTV_Bot";
  return raw.startsWith("@") ? raw.slice(1) : raw;
}

// ── Spinner ───────────────────────────────────────────────────────────────────

function Spinner({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg
      className={`animate-spin ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

// ── ShieldIcon ────────────────────────────────────────────────────────────────

function ShieldIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className="w-5 h-5 flex-shrink-0"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M12 1.5a.75.75 0 0 1 .75.75V4.5a.75.75 0 0 1-1.5 0V2.25A.75.75 0 0 1 12 1.5ZM5.636 4.136a.75.75 0 0 1 1.06 0l1.592 1.591a.75.75 0 0 1-1.061 1.06L5.636 5.197a.75.75 0 0 1 0-1.06Zm12.728 0a.75.75 0 0 1 0 1.06l-1.591 1.592a.75.75 0 0 1-1.061-1.061l1.591-1.591a.75.75 0 0 1 1.061 0Zm-6.816 4.496a.75.75 0 0 1 .82.311l5.228 7.917a.75.75 0 0 1-.777 1.148l-2.097-.43 1.045 3.9a.75.75 0 0 1-1.45.388l-1.044-3.899-1.601 1.42a.75.75 0 0 1-1.247-.606l.569-9.47a.75.75 0 0 1 .554-.678ZM3 10.5a.75.75 0 0 1 .75-.75H6a.75.75 0 0 1 0 1.5H3.75A.75.75 0 0 1 3 10.5Zm14.25 0a.75.75 0 0 1 .75-.75h2.25a.75.75 0 0 1 0 1.5H18a.75.75 0 0 1-.75-.75Zm-8.962 3.712a.75.75 0 0 1 0 1.061l-1.591 1.591a.75.75 0 1 1-1.061-1.06l1.591-1.592a.75.75 0 0 1 1.06 0Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

// ── TelegramLoginWidget ────────────────────────────────────────────────────────

interface TelegramWidgetProps {
  onAuth: (user: TelegramWidgetUser) => void;
  onLoadError: () => void;
}

function TelegramLoginWidget({ onAuth, onLoadError }: TelegramWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scriptRef = useRef<HTMLScriptElement | null>(null);
  const onAuthRef = useRef(onAuth);
  const onLoadErrorRef = useRef(onLoadError);

  useEffect(() => {
    onAuthRef.current = onAuth;
  }, [onAuth]);
  useEffect(() => {
    onLoadErrorRef.current = onLoadError;
  }, [onLoadError]);

  useEffect(() => {
    const botUsername = getBotUsername();

    (window as unknown as Record<string, unknown>)["onTelegramAuth"] = (
      user: TelegramWidgetUser,
    ) => {
      onAuthRef.current(user);
    };

    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.async = true;
    script.setAttribute("data-telegram-login", botUsername);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-radius", "12");
    script.setAttribute("data-onauth", "onTelegramAuth(user)");
    script.setAttribute("data-request-access", "write");

    const LOAD_TIMEOUT_MS = 8000;
    const timer = setTimeout(() => {
      onLoadErrorRef.current();
    }, LOAD_TIMEOUT_MS);

    script.onload = () => clearTimeout(timer);
    script.onerror = () => {
      clearTimeout(timer);
      onLoadErrorRef.current();
    };

    scriptRef.current = script;
    containerRef.current?.appendChild(script);

    return () => {
      clearTimeout(timer);
      delete (window as unknown as Record<string, unknown>)["onTelegramAuth"];
      if (
        scriptRef.current &&
        containerRef.current?.contains(scriptRef.current)
      ) {
        containerRef.current.removeChild(scriptRef.current);
      }
    };
  }, []);

  return <div ref={containerRef} className="flex justify-center" />;
}

// ── LoginPage ─────────────────────────────────────────────────────────────────

export function LoginPage() {
  const lang = getLang(
    navigator.language?.startsWith("es") ? "es" : undefined,
  );
  const t = getI18n(lang).login;
  const { refreshUser } = useAuth();

  const [lastMethod, setLastMethod] = useState<string | null>(null);
  const [lastUsername, setLastUsername] = useState<string | null>(null);
  const [returnTo, setReturnTo] = useState<string | null>(null);
  useEffect(() => {
    const storedMethod = localStorage.getItem("pnptv_last_auth");
    const storedUser = localStorage.getItem("pnptv_last_username");
    if (storedMethod) setLastMethod(storedMethod);
    if (storedUser) setLastUsername(storedUser);
    const raw = new URLSearchParams(window.location.search).get("returnTo");
    const safe = sanitizeReturnTo(raw);
    if (safe) {
      setReturnTo(safe);
      rememberReturnTo(safe);
    }
  }, []);

  const methodLabel = (method: string | null): string | null => {
    if (!method) return null;
    const map: Record<string, string> = {
      telegram: "Telegram",
      deep_link: "Telegram",
      oidc: "PNPtv ID",
      pnptv_id: "PNPtv ID",
    };
    return map[method] ?? null;
  };

  // Email capture for signup
  const [signupEmail, setSignupEmail] = useState("");
  const [signupEmailError, setSignupEmailError] = useState<string | null>(null);
  const isValidEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());

  const handleCreateAccount = (e: React.FormEvent) => {
    e.preventDefault();
    const email = signupEmail.trim();
    if (!email) {
      setSignupEmailError(t.emailRequiredForSignup);
      return;
    }
    if (!isValidEmail(email)) {
      setSignupEmailError(t.emailInvalid);
      return;
    }
    setSignupEmailError(null);
    // Persist so Settings / downstream can pick it up, and pre-fill Authentik
    try { localStorage.setItem("pnptv_signup_email", email); } catch { /* ignore */ }
    const url = `${ENROLLMENT_FLOW_URL}?email=${encodeURIComponent(email)}`;
    window.location.href = url;
  };

  const handleCreateAccountNoEmail = () => {
    // Fallback: user clicks CTA without filling email
    window.location.href = ENROLLMENT_FLOW_URL;
  };

  const [oidcLoading, setOidcLoading] = useState(false);

  type WidgetStatus = "idle" | "verifying" | "error";
  const [widgetStatus, setWidgetStatus] = useState<WidgetStatus>("idle");
  const [widgetBlocked, setWidgetBlocked] = useState(false);
  const [widgetError, setWidgetError] = useState<string | null>(null);

  const handleOidcLogin = async () => {
    setOidcLoading(true);
    try {
      localStorage.setItem("pnptv_last_auth", "pnptv_id");
      await oidcLogin();
      // signinRedirect() navigates away; no need to reset loading state
    } catch {
      setOidcLoading(false);
    }
  };

  const handleWidgetAuth = useCallback(
    async (userData: TelegramWidgetUser) => {
      setWidgetStatus("verifying");
      setWidgetError(null);
      try {
        const result = await telegramWidgetAuth(userData);
        if (result.success) {
          localStorage.setItem("pnptv_last_auth", "telegram");
          if (result.user?.username)
            localStorage.setItem("pnptv_last_username", result.user.username);
          await refreshUser();
          window.location.href = returnTo || "/";
        } else {
          setWidgetStatus("error");
          setWidgetError(result.error || t.telegramWidgetError);
        }
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : t.telegramWidgetError;
        setWidgetStatus("error");
        setWidgetError(message);
      }
    },
    [refreshUser, returnTo, t],
  );

  const handleWidgetLoadError = useCallback(() => {
    setWidgetBlocked(true);
  }, []);

  const label = methodLabel(lastMethod);
  const returningUser = !!label;

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4 py-8 relative overflow-hidden"
      style={{ background: "#121212" }}
    >
      {/* Background glows */}
      <div
        className="absolute top-[-20%] left-[-10%] w-[500px] h-[500px] rounded-full opacity-20 blur-3xl pointer-events-none"
        style={{ background: "radial-gradient(circle, #D4007A, transparent 70%)" }}
      />
      <div
        className="absolute bottom-[-20%] right-[-10%] w-[500px] h-[500px] rounded-full opacity-20 blur-3xl pointer-events-none"
        style={{ background: "radial-gradient(circle, #E69138, transparent 70%)" }}
      />

      <div className="glass-card neon-glow animate-subtle-glow w-full max-w-md p-6 sm:p-8 relative z-10 animate-fade-in-up">
        {/* Logo + tagline */}
        <div className="text-center mb-5">
          <img
            src="/logo-login.png"
            alt="PNPtv!"
            className="w-48 sm:w-56 h-auto mx-auto"
          />
          <p
            className="text-xs mt-2 font-medium"
            style={{ color: "#E69138" }}
          >
            {t.tagline}
          </p>
        </div>

        {/* Lifetime deal banner */}
        <a
          href="/subscribe?plan=lifetime"
          className="block rounded-xl p-3 mb-4 text-center transition-all hover:brightness-110 active:scale-[0.98]"
          style={{
            background: "linear-gradient(135deg, rgba(212,0,122,0.15), rgba(230,145,56,0.15))",
            border: "1px solid rgba(230,145,56,0.35)",
          }}
        >
          <div className="flex items-center justify-center gap-2">
            <span
              className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
              style={{ background: "#E69138", color: "#121212" }}
            >
              {t.lifetimeDealLabel}
            </span>
          </div>
          <p className="text-sm font-bold text-white mt-1.5">
            {t.lifetimeDealTitle}
          </p>
          <p className="text-[11px] mt-0.5" style={{ color: "#E69138" }}>
            {t.lifetimeDealSub} <span className="font-semibold">{t.lifetimeDealCta}</span>
          </p>
        </a>

        {/* Feature badges — 3-up */}
        <div className="grid grid-cols-3 gap-2 mb-5">
          {t.featureBadges.map((b) => (
            <div
              key={b.title}
              className="rounded-lg px-2 py-2 text-center"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}
            >
              <p className="text-[11px] font-bold text-white leading-tight">{b.title}</p>
              <p className="text-[9px] mt-0.5" style={{ color: "#8E8E93" }}>{b.sub}</p>
            </div>
          ))}
        </div>

        {/* ── PRIMARY: Join + email capture ─────────────────────────────── */}
        <form onSubmit={handleCreateAccount} noValidate className="space-y-3">
          <div>
            <h2 className="text-base font-bold text-white mb-2 text-center">
              {t.joinHeadline}
            </h2>
            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              value={signupEmail}
              onChange={(e) => { setSignupEmail(e.target.value); setSignupEmailError(null); }}
              placeholder={t.emailPlaceholder}
              aria-label={t.emailPlaceholder}
              aria-invalid={!!signupEmailError}
              aria-describedby={signupEmailError ? "signup-email-error" : undefined}
              className="w-full py-3 px-4 rounded-xl text-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-2 transition-all"
              style={{
                background: "rgba(255,255,255,0.06)",
                border: signupEmailError ? "1px solid #ef4444" : "1px solid rgba(255,255,255,0.1)",
              }}
            />
            {signupEmailError && (
              <p id="signup-email-error" className="text-xs text-red-400 mt-1 px-1">
                {signupEmailError}
              </p>
            )}
          </div>
          <button
            type="submit"
            className="w-full py-3.5 px-6 rounded-xl font-bold text-sm flex items-center justify-center gap-2 text-white transition-all hover:brightness-110 active:scale-[0.98]"
            style={{
              background: "linear-gradient(135deg, #D4007A, #E69138)",
              boxShadow: "0 0 24px rgba(212, 0, 122, 0.4)",
            }}
          >
            <span>{t.createMyAccount}</span>
            <span aria-hidden="true">→</span>
          </button>
          <p className="text-center text-[11px]" style={{ color: "#8E8E93" }}>
            {t.freeTakes30s}
          </p>
        </form>

        {/* Divider */}
        <div className="flex items-center gap-3 my-5">
          <div className="flex-1 h-px bg-white/10" />
          <span className="text-[10px] text-pnp-textSecondary uppercase tracking-widest">
            {t.orContinueWith}
          </span>
          <div className="flex-1 h-px bg-white/10" />
        </div>

        {/* Telegram widget — great for returning Telegram users */}
        <div>
          {widgetStatus === "verifying" && (
            <div className="flex items-center justify-center gap-3 py-4 text-white text-sm font-medium">
              <Spinner />
              <span>{t.telegramWidgetVerifying}</span>
            </div>
          )}
          <div className={widgetStatus === "verifying" ? "hidden" : ""}>
            <TelegramLoginWidget
              onAuth={handleWidgetAuth}
              onLoadError={handleWidgetLoadError}
            />
          </div>
          <p className="text-center text-[11px] mt-2" style={{ color: "#8E8E93" }}>
            {t.recommendedForBot}
          </p>
          {widgetStatus === "error" && widgetError && (
            <p className="text-center text-xs text-red-400 mt-2">{widgetError}</p>
          )}
          {widgetBlocked && (
            <p className="text-center text-xs mt-2" style={{ color: "#8E8E93" }}>
              {t.telegramWidgetBlocked}
            </p>
          )}
        </div>

        {/* ── SECONDARY: already a member? ──────────────────────────────── */}
        <div className="mt-6 pt-5 border-t border-white/10">
          <p className="text-center text-xs text-pnp-textSecondary mb-3">
            {t.alreadyMember}
          </p>
          {returningUser && (
            <p className="text-center text-[11px] mb-2" style={{ color: "#8E8E93" }}>
              {t.lastLoginedWith}{" "}
              <span className="font-semibold text-white">{label}</span>
              {lastUsername ? ` (@${lastUsername})` : ""}
            </p>
          )}
          <button
            onClick={handleOidcLogin}
            disabled={oidcLoading}
            className="w-full py-2.5 px-4 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all hover:bg-white/10 active:scale-[0.98] disabled:opacity-70 disabled:cursor-not-allowed"
            style={{
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.12)",
              color: "#FFFFFF",
            }}
          >
            {oidcLoading ? <Spinner className="h-4 w-4" /> : <ShieldIcon />}
            <span>{t.signInWithEmail}</span>
          </button>
          <p className="text-center text-[10px] mt-1.5" style={{ color: "#636366" }}>
            {t.signInSubLabel}
          </p>
          <p className="text-center text-xs mt-3">
            <a
              href={RECOVERY_FLOW_URL}
              className="underline text-pnp-accent hover:brightness-125 transition-all"
            >
              {t.forgotPassword}
            </a>
          </p>
        </div>

        {/* Signup fallback if they click without typing email — edge case kept accessible */}
        <p className="sr-only">
          <button type="button" onClick={handleCreateAccountNoEmail}>
            {t.createAccount}
          </button>
        </p>

        {/* Legal footer */}
        <div className="mt-6 pt-5 border-t border-white/5">
          <p className="text-center text-[10px] text-pnp-textSecondary mb-3">
            {t.legalPrefix}{" "}
            <a href="/terms" className="underline text-pnp-accent">
              {t.legalTerms}
            </a>{" "}
            {t.legalAnd}{" "}
            <a href="/privacy" className="underline text-pnp-accent">
              {t.legalPrivacyPolicy}
            </a>
          </p>
          <div className="flex flex-wrap justify-center gap-x-3 gap-y-1">
            {["cookies", "safety", "contact"].map((key) => (
              <a
                key={key}
                href={`/${key}`}
                className="text-[10px] text-pnp-textSecondary hover:underline capitalize"
              >
                {key}
              </a>
            ))}
          </div>
          <p className="text-center text-[9px] text-pnp-textSecondary/50 mt-3">
            {t.copyright}
          </p>
        </div>
      </div>
    </div>
  );
}

export default LoginPage;
