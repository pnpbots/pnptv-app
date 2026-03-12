import React, { useState, useEffect, useRef, useCallback } from "react";
import { getXLoginUrl, telegramWidgetAuth, emailRegister, resendVerificationEmail, type TelegramWidgetUser, type EmailRegisterPayload, type EmailRegisterResponse } from "@/lib/api";
import { getI18n, getLang } from "@/lib/i18n";
import { useAuth } from "@/hooks/useAuth";

const API_BASE = import.meta.env.VITE_API_URL || "https://pnptv.app";

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

// ── TelegramLoginWidget ────────────────────────────────────────────────────────

interface TelegramWidgetProps {
  onAuth: (user: TelegramWidgetUser) => void;
  onLoadError: () => void;
}

/**
 * Injects the official Telegram Login Widget script into a container div.
 * The widget renders its own styled button; we must NOT try to style it.
 * The global `window.onTelegramAuth` callback is set before the script loads
 * so it is available the moment Telegram invokes it.
 */
function TelegramLoginWidget({ onAuth, onLoadError }: TelegramWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scriptRef = useRef<HTMLScriptElement | null>(null);
  const onAuthRef = useRef(onAuth);
  const onLoadErrorRef = useRef(onLoadError);

  // Keep refs current without recreating the effect
  useEffect(() => {
    onAuthRef.current = onAuth;
  }, [onAuth]);
  useEffect(() => {
    onLoadErrorRef.current = onLoadError;
  }, [onLoadError]);

  useEffect(() => {
    const botUsername = getBotUsername();

    // Register global callback BEFORE the script loads
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

    // Detect load failure (ad-blocker, network error, etc.)
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
  }, []); // intentionally empty — widget is mounted once

  return <div ref={containerRef} className="flex justify-center" />;
}

// ── LoginPage ─────────────────────────────────────────────────────────────────

export function LoginPage() {
  const lang = getLang(
    navigator.language?.startsWith("es") ? "es" : undefined,
  );
  const t = getI18n(lang).login;
  const { refreshUser } = useAuth();

  // ── Last login method + username hint (from localStorage)
  const [lastMethod, setLastMethod] = useState<string | null>(null);
  const [lastUsername, setLastUsername] = useState<string | null>(null);
  useEffect(() => {
    const storedMethod = localStorage.getItem("pnptv_last_auth");
    const storedUser = localStorage.getItem("pnptv_last_username");
    if (storedMethod) setLastMethod(storedMethod);
    if (storedUser) setLastUsername(storedUser);
  }, []);

  const methodLabel = (method: string | null) => {
    if (!method) return null;
    const map: Record<string, string> = {
      telegram: "Telegram",
      deep_link: "Telegram",
      x: "X (Twitter)",
      email: t.loginWithEmail,
      admin: "Email",
    };
    return map[method] ?? null;
  };

  // ── Widget flow state
  type WidgetStatus = "idle" | "verifying" | "error";
  const [widgetStatus, setWidgetStatus] = useState<WidgetStatus>("idle");
  const [widgetBlocked, setWidgetBlocked] = useState(false);
  const [widgetError, setWidgetError] = useState<string | null>(null);

  // ── Deep-link fallback flow state
  type DeepLinkStatus = "idle" | "waiting" | "error";
  const [deepLinkStatus, setDeepLinkStatus] = useState<DeepLinkStatus>("idle");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── X state
  const [xRedirecting, setXRedirecting] = useState(false);

  // ── Email form state (auto-expand if last method was email)
  const [showEmailForm, setShowEmailForm] = useState(
    () => localStorage.getItem("pnptv_last_auth") === "email",
  );
  const [emailVal, setEmailVal] = useState("");
  const [passwordVal, setPasswordVal] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [emailLogging, setEmailLogging] = useState(false);
  const [emailLoginError, setEmailLoginError] = useState<string | null>(null);
  const emailInputRef = useRef<HTMLInputElement>(null);

  // ── Email registration form state
  const [showRegisterForm, setShowRegisterForm] = useState(false);
  const [registerFirstName, setRegisterFirstName] = useState("");
  const [registerLastName, setRegisterLastName] = useState("");
  const [registerEmail, setRegisterEmail] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const [registerLogging, setRegisterLogging] = useState(false);
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [registrationSuccess, setRegistrationSuccess] = useState(false);
  const [emailVerificationNeeded, setEmailVerificationNeeded] = useState(false);
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null);
  const [resendEmailStatus, setResendEmailStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const registerFirstNameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // ── Widget auth callback ──────────────────────────────────────────────────

  const handleWidgetAuth = useCallback(
    async (userData: TelegramWidgetUser) => {
      setWidgetStatus("verifying");
      setWidgetError(null);
      try {
        const result = await telegramWidgetAuth(userData);
        if (result.success) {
          localStorage.setItem("pnptv_last_auth", "telegram");
          if (result.user?.username) localStorage.setItem("pnptv_last_username", result.user.username);
          await refreshUser();
          // Session cookie is now set; navigate to root so the router
          // picks up the authenticated state.
          window.location.href = "/";
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
    [refreshUser, t],
  );

  const handleWidgetLoadError = useCallback(() => {
    setWidgetBlocked(true);
  }, []);

  // ── Deep-link fallback ────────────────────────────────────────────────────

  const handleDeepLinkLogin = async () => {
    try {
      setDeepLinkStatus("waiting");

      // Open window synchronously (inside click handler) so mobile browsers
      // don't block the popup.
      const win = window.open("about:blank", "_blank");

      const res = await fetch(`${API_BASE}/api/webapp/auth/telegram/token`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();

      if (!data.success || !data.token || !data.deepLink) {
        if (win) win.close();
        setDeepLinkStatus("error");
        return;
      }

      const isValidDeepLink = (url: string) => url.startsWith('/') || url.startsWith('https://');
      if (!isValidDeepLink(data.deepLink)) {
        if (win) win.close();
        setDeepLinkStatus("error");
        return;
      }

      if (win) {
        win.location.href = data.deepLink;
      } else {
        window.location.href = data.deepLink;
      }

      let attempts = 0;
      const maxAttempts = 60; // 5 minutes at 5-second intervals
      pollRef.current = setInterval(async () => {
        attempts++;
        if (attempts > maxAttempts) {
          if (pollRef.current) clearInterval(pollRef.current);
          setDeepLinkStatus("error");
          return;
        }
        try {
          const check = await fetch(
            `${API_BASE}/api/webapp/auth/telegram/check?token=${data.token}`,
            { credentials: "include" },
          );
          const result = await check.json();
          if (result.authenticated) {
            if (pollRef.current) clearInterval(pollRef.current);
            localStorage.setItem("pnptv_last_auth", "telegram");
            window.location.href = "/";
          }
        } catch {
          // Network blip — keep polling
        }
      }, 5000);
    } catch {
      setDeepLinkStatus("error");
    }
  };

  // ── X login ───────────────────────────────────────────────────────────────

  const handleXClick = () => {
    setXRedirecting(true);
    localStorage.setItem("pnptv_last_auth", "x");
    window.location.href = getXLoginUrl();
  };

  // ── Email login ───────────────────────────────────────────────────────────

  const handleEmailLogin = async () => {
    const trimmedEmail = emailVal.trim().toLowerCase();
    if (!trimmedEmail || !passwordVal) {
      setEmailLoginError(t.emailAndPasswordRequired);
      return;
    }
    setEmailLogging(true);
    setEmailLoginError(null);
    try {
      const res = await fetch(`${API_BASE}/api/webapp/auth/email/login`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: trimmedEmail,
          password: passwordVal,
          rememberMe,
        }),
      });
      const data = await res.json();
      if (res.ok && data.authenticated) {
        localStorage.setItem("pnptv_last_auth", "email");
        if (data.user?.username) localStorage.setItem("pnptv_last_username", data.user.username);
        window.location.href = "/";
      } else {
        setEmailLoginError(data.error || data.message || t.loginFailed);
      }
    } catch {
      setEmailLoginError(t.connectionError);
    } finally {
      setEmailLogging(false);
    }
  };

  const handleEmailRegister = async () => {
    const trimmedEmail = registerEmail.trim().toLowerCase();
    const trimmedFirstName = registerFirstName.trim();
    if (!trimmedEmail || !registerPassword || !trimmedFirstName) {
      setRegisterError(t.emailPasswordFirstNameRequired);
      return;
    }
    setRegisterLogging(true);
    setRegisterError(null);
    try {
      const payload: EmailRegisterPayload = {
        email: trimmedEmail,
        password: registerPassword,
        firstName: trimmedFirstName,
        lastName: registerLastName.trim() || undefined,
      };
      const result = await emailRegister(payload);
      if (result.authenticated || result.requiresVerification) {
        setRegistrationSuccess(true);
        if (result.requiresVerification) {
          setEmailVerificationNeeded(true);
          setUnverifiedEmail(trimmedEmail);
        } else {
          // Should not happen with current backend logic, but handle it
          window.location.href = "/";
        }
      } else {
        setRegisterError(result.error || result.message || t.registrationFailed);
      }
    } catch (err: unknown) {
      setRegisterError((err instanceof Error ? err.message : t.connectionError));
    } finally {
      setRegisterLogging(false);
    }
  };

  const handleResendVerificationEmail = async () => {
    if (!unverifiedEmail) return;
    setResendEmailStatus("sending");
    try {
      await resendVerificationEmail(unverifiedEmail);
      setResendEmailStatus("sent");
    } catch (err: unknown) {
      setResendEmailStatus("error");
      setRegisterError((err instanceof Error ? err.message : t.resendFailed));
    } finally {
      setTimeout(() => setResendEmailStatus("idle"), 5000);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4 relative overflow-hidden"
      style={{ background: "#121212" }}
    >
      {/* Background gradient orbs */}
      <div
        className="absolute top-[-20%] left-[-10%] w-[500px] h-[500px] rounded-full opacity-20 blur-3xl pointer-events-none"
        style={{
          background: "radial-gradient(circle, #D4007A, transparent 70%)",
        }}
      />
      <div
        className="absolute bottom-[-20%] right-[-10%] w-[500px] h-[500px] rounded-full opacity-20 blur-3xl pointer-events-none"
        style={{
          background: "radial-gradient(circle, #E69138, transparent 70%)",
        }}
      />

      {/* Glass card */}
      <div className="glass-card neon-glow animate-subtle-glow w-full max-w-md p-8 sm:p-10 relative z-10 animate-fade-in-up">
        {/* Logo / Brand */}
        <div className="text-center mb-6">
          <img
            src="/Logo2-50.png"
            alt="PNPTV"
            className="h-14 w-auto mx-auto"
          />
          <p className="text-sm mt-2 font-medium" style={{ color: "#E69138" }}>
            {t.tagline}
          </p>
        </div>

        {/* Welcome back banner + last login method hint */}
        {(lastUsername || (lastMethod && methodLabel(lastMethod))) && (
          <div className="mb-4 space-y-1.5 text-center animate-fade-in-up">
            {lastUsername && (
              <p className="text-sm font-medium" style={{ color: "#FFFFFF" }}>
                {lang === "es" ? "Bienvenido de vuelta," : "Welcome back,"}{" "}
                <span style={{ color: "#D4007A" }}>@{lastUsername}</span>
              </p>
            )}
            {lastMethod && methodLabel(lastMethod) && (
              <div className="flex items-center justify-center gap-1.5">
                <span className="text-[11px]" style={{ color: "#636366" }}>
                  {lang === "es" ? "Último acceso con" : "Last used:"}
                </span>
                <span
                  className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
                  style={{
                    background: "rgba(212, 0, 122, 0.12)",
                    color: "#D4007A",
                    border: "1px solid rgba(212, 0, 122, 0.2)",
                  }}
                >
                  {methodLabel(lastMethod)}
                </span>
              </div>
            )}
          </div>
        )}

        {/* ── PRIMARY: Telegram Widget ─────────────────────────────────────── */}
        <div className="space-y-4">
          {/* Widget verifying overlay */}
          {widgetStatus === "verifying" && (
            <div className="flex items-center justify-center gap-3 py-4 text-white text-sm font-medium">
              <Spinner />
              <span>{t.telegramWidgetVerifying}</span>
            </div>
          )}

          {/* Widget error state */}
          {widgetStatus === "error" && (
            <div className="rounded-xl p-4 text-center space-y-2"
              style={{ background: "rgba(255,69,58,0.08)", border: "1px solid rgba(255,69,58,0.2)" }}>
              <p className="text-sm text-red-400">
                {widgetError || t.telegramWidgetError}
              </p>
              <button
                onClick={() => {
                  setWidgetStatus("idle");
                  setWidgetError(null);
                }}
                className="text-xs underline text-red-300 hover:text-red-200 transition-colors"
              >
                {t.telegramWidgetRetry}
              </button>
            </div>
          )}

          {/* Telegram Login Widget — always mounted so the script loads once */}
          {widgetStatus !== "verifying" && (
            <div className={widgetStatus === "error" ? "hidden" : ""}>
              <TelegramLoginWidget
                onAuth={handleWidgetAuth}
                onLoadError={handleWidgetLoadError}
              />
            </div>
          )}

          {/* Widget blocked / fallback notice */}
          {widgetBlocked && widgetStatus === "idle" && (
            <p
              className="text-center text-xs"
              style={{ color: "#8E8E93" }}
            >
              {t.telegramWidgetBlocked}
            </p>
          )}

          {/* ── SECONDARY: X Login ────────────────────────────────────────── */}
          <button
            onClick={handleXClick}
            disabled={xRedirecting}
            className="w-full py-3.5 px-6 rounded-xl font-semibold text-base flex items-center justify-center gap-3 transition-all duration-200 hover:bg-white/10 disabled:opacity-60"
            style={{
              background: "rgba(255, 255, 255, 0.05)",
              border: "1px solid rgba(255, 255, 255, 0.15)",
              color: "#FFFFFF",
            }}
          >
            {xRedirecting ? (
              <>
                <Spinner />
                {t.redirectingToX}
              </>
            ) : (
              <>
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
                {t.loginWithX}
              </>
            )}
          </button>
        </div>

        {/* ── TERTIARY: Email login/register/verification (collapsible) ─────────────────────────── */}
        <div className="flex items-center gap-3 mt-6 mb-4">
          <div className="flex-1 h-px" style={{ background: "rgba(255, 255, 255, 0.08)" }} />
          <span className="text-xs" style={{ color: "#8E8E93" }}>{t.orDivider}</span>
          <div className="flex-1 h-px" style={{ background: "rgba(255, 255, 255, 0.08)" }} />
        </div>

        {emailVerificationNeeded ? (
          <div
            className="rounded-xl p-4 space-y-3 animate-fade-in-up text-center"
            style={{ background: "rgba(212, 0, 122, 0.06)", border: "1px solid rgba(212, 0, 122, 0.2)" }}
          >
            <svg className="w-12 h-12 text-pnp-accent mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3 8.689l12.603 7.562a.96.96 0 001.077-.074L21 8.689m-16.5 6.311V21.75A2.25 2.25 0 007.5 24h9a2.25 2.25 0 002.25-2.25V15.001M18.75 8.25a.75.75 0 00-1.5 0v3.75a.75.75 0 001.5 0V8.25z" /></svg>
            <h3 className="text-base font-bold text-white">{t.verifyEmailTitle}</h3>
            <p className="text-sm text-pnp-textSecondary">
              {t.verifyEmailInstructions.replace("{email}", unverifiedEmail || "your email")}
            </p>
            {resendEmailStatus === "error" && (
              <p className="text-xs text-red-400">{registerError}</p>
            )}
            <button
              onClick={handleResendVerificationEmail}
              disabled={resendEmailStatus === "sending"}
              className="text-xs underline text-pnp-textSecondary hover:text-white transition-colors mt-2 disabled:opacity-50"
            >
              {resendEmailStatus === "sending" ? t.sendingEmail : resendEmailStatus === "sent" ? t.emailSent : t.resendEmail}
            </button>
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => {
                  setEmailVerificationNeeded(false);
                  setRegistrationSuccess(false);
                  setShowEmailForm(false);
                  setRegisterError(null);
                  setUnverifiedEmail(null);
                }}
                className="flex-1 py-2.5 rounded-lg text-sm font-medium hover:bg-white/5 transition-colors"
                style={{ color: "#8E8E93" }}
              >
                {t.backToLogin}
              </button>
            </div>
          </div>
        ) : registrationSuccess ? (
          <div
            className="rounded-xl p-4 space-y-3 animate-fade-in-up text-center"
            style={{ background: "rgba(52,199,89,0.08)", border: "1px solid rgba(52,199,89,0.2)" }}
          >
            <svg className="w-12 h-12 text-green-400 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12c0 1.01-1.253 1.01-1.253 1.01H12c-.75-1.25-1.5-2.5-1.5-2.5" /></svg>
            <h3 className="text-base font-bold text-white">{t.registrationCompleteTitle}</h3>
            <p className="text-sm text-pnp-textSecondary">{t.registrationCompleteMessage}</p>
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => {
                  setEmailVerificationNeeded(false);
                  setRegistrationSuccess(false);
                  setShowEmailForm(false);
                  setRegisterError(null);
                  setUnverifiedEmail(null);
                }}
                className="flex-1 py-2.5 rounded-lg text-sm font-medium hover:bg-white/5 transition-colors"
                style={{ color: "#8E8E93" }}
              >
                {t.backToLogin}
              </button>
            </div>
          </div>
        ) : (
          <>
            {!showEmailForm ? (
              <button
                onClick={() => {
                  setShowEmailForm(true);
                  setShowRegisterForm(false); // Ensure we switch to login view
                  setTimeout(() => emailInputRef.current?.focus(), 100);
                }}
                className="w-full py-3.5 px-6 rounded-xl font-semibold text-base flex items-center justify-center gap-3 transition-all duration-200 hover:bg-white/10"
                style={{
                  background: "rgba(255, 255, 255, 0.05)",
                  border: "1px solid rgba(255, 255, 255, 0.15)",
                  color: "#FFFFFF",
                }}
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <rect x="2" y="4" width="20" height="16" rx="2" />
                  <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                </svg>
                {t.loginWithEmail}
              </button>
            ) : (
              <div
                className="rounded-xl p-4 space-y-3 animate-fade-in-up"
                style={{
                  background: "rgba(212, 0, 122, 0.06)",
                  border: "1px solid rgba(212, 0, 122, 0.2)",
                }}
              >
                {!showRegisterForm ? (
                  <>
                    {/* Login Form */}
                    <input
                      ref={emailInputRef}
                      type="email"
                      value={emailVal}
                      onChange={(e) => {
                        setEmailVal(e.target.value);
                        setEmailLoginError(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleEmailLogin();
                      }}
                      placeholder={t.emailPlaceholder}
                      disabled={emailLogging}
                      className="w-full px-3 py-2.5 rounded-lg border text-sm bg-transparent text-white outline-none transition-colors placeholder-[#8E8E93]"
                      style={{
                        borderColor: emailLoginError
                          ? "#FF453A"
                          : "rgba(255,255,255,0.15)",
                      }}
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                    />
                    <input
                      type="password"
                      value={passwordVal}
                      onChange={(e) => {
                        setPasswordVal(e.target.value);
                        setEmailLoginError(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleEmailLogin();
                      }}
                      placeholder={t.passwordPlaceholder}
                      disabled={emailLogging}
                      className="w-full px-3 py-2.5 rounded-lg border text-sm bg-transparent text-white outline-none transition-colors placeholder-[#8E8E93]"
                      style={{
                        borderColor: emailLoginError
                          ? "#FF453A"
                          : "rgba(255,255,255,0.15)",
                      }}
                    />
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={rememberMe}
                        onChange={(e) => setRememberMe(e.target.checked)}
                        className="w-3.5 h-3.5 rounded accent-[#D4007A]"
                      />
                      <span className="text-xs" style={{ color: "#8E8E93" }}>
                        {t.rememberMe}
                      </span>
                    </label>
                    {emailLoginError && (
                      <p className="text-xs text-red-400">{emailLoginError}</p>
                    )}
                    <div className="flex gap-2">
                      <button
                        onClick={handleEmailLogin}
                        disabled={emailLogging || !emailVal.trim() || !passwordVal}
                        className="flex-1 py-2.5 rounded-lg text-white text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                        style={{
                          background: "linear-gradient(135deg, #D4007A, #E69138)",
                        }}
                      >
                        {emailLogging ? <Spinner className="w-4 h-4" /> : t.logIn}
                      </button>
                      <button
                        onClick={() => {
                          setShowEmailForm(false);
                          setEmailVal("");
                          setPasswordVal("");
                          setEmailLoginError(null);
                        }}
                        className="px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-white/5 transition-colors"
                        style={{ color: "#8E8E93" }}
                      >
                        {t.cancel}
                      </button>
                    </div>
                    <div className="text-center mt-3">
                      <button
                        onClick={() => setShowRegisterForm(true)}
                        className="text-xs underline text-pnp-textSecondary hover:text-white transition-colors"
                      >
                        {t.dontHaveAccount}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    {/* Registration Form */}
                    <input
                      ref={registerFirstNameRef}
                      type="text"
                      value={registerFirstName}
                      onChange={(e) => setRegisterFirstName(e.target.value)}
                      placeholder={t.firstNamePlaceholder}
                      disabled={registerLogging}
                      className="w-full px-3 py-2.5 rounded-lg border text-sm bg-transparent text-white outline-none transition-colors placeholder-[#8E8E93]"
                      style={{
                        borderColor: registerError
                          ? "#FF453A"
                          : "rgba(255,255,255,0.15)",
                      }}
                    />
                    <input
                      type="text"
                      value={registerLastName}
                      onChange={(e) => setRegisterLastName(e.target.value)}
                      placeholder={t.lastNamePlaceholder}
                      disabled={registerLogging}
                      className="w-full px-3 py-2.5 rounded-lg border text-sm bg-transparent text-white outline-none transition-colors placeholder-[#8E8E93]"
                      style={{
                        borderColor: registerError
                          ? "#FF453A"
                          : "rgba(255,255,255,0.15)",
                      }}
                    />
                    <input
                      type="email"
                      value={registerEmail}
                      onChange={(e) => setRegisterEmail(e.target.value)}
                      placeholder={t.emailPlaceholder}
                      disabled={registerLogging}
                      className="w-full px-3 py-2.5 rounded-lg border text-sm bg-transparent text-white outline-none transition-colors placeholder-[#8E8E93]"
                      style={{
                        borderColor: registerError
                          ? "#FF453A"
                          : "rgba(255,255,255,0.15)",
                      }}
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                    />
                    <input
                      type="password"
                      value={registerPassword}
                      onChange={(e) => setRegisterPassword(e.target.value)}
                      placeholder={t.passwordPlaceholder}
                      disabled={registerLogging}
                      className="w-full px-3 py-2.5 rounded-lg border text-sm bg-transparent text-white outline-none transition-colors placeholder-[#8E8E93]"
                      style={{
                        borderColor: registerError
                          ? "#FF453A"
                          : "rgba(255,255,255,0.15)",
                      }}
                    />
                    {registerError && (
                      <p className="text-xs text-red-400">{registerError}</p>
                    )}
                    <div className="flex gap-2">
                      <button
                        onClick={handleEmailRegister}
                        disabled={
                          registerLogging ||
                          !registerEmail.trim() ||
                          !registerPassword ||
                          !registerFirstName.trim()
                        }
                        className="flex-1 py-2.5 rounded-lg text-white text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                        style={{
                          background: "linear-gradient(135deg, #D4007A, #E69138)",
                        }}
                      >
                        {registerLogging ? <Spinner className="w-4 h-4" /> : t.register}
                      </button>
                      <button
                        onClick={() => {
                          setShowRegisterForm(false);
                          setRegisterFirstName("");
                          setRegisterLastName("");
                          setRegisterEmail("");
                          setRegisterPassword("");
                          setRegisterError(null);
                        }}
                        className="px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-white/5 transition-colors"
                        style={{ color: "#8E8E93" }}
                      >
                        {t.cancel}
                      </button>
                    </div>
                    <div className="text-center mt-3">
                      <button
                        onClick={() => setShowRegisterForm(false)}
                        className="text-xs underline text-pnp-textSecondary hover:text-white transition-colors"
                      >
                        {t.alreadyHaveAccount}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </>
        )}

        {/* ── Deep-link fallback (low-prominence) ─────────────────────────── */}
        <div className="mt-5 text-center">
          {deepLinkStatus === "idle" && (
            <button
              onClick={handleDeepLinkLogin}
              className="text-xs underline transition-colors hover:text-white"
              style={{ color: "#636366" }}
            >
              {t.telegramWidgetFallbackLink}
            </button>
          )}

          {deepLinkStatus === "waiting" && (
            <div className="space-y-1">
              <p className="text-xs flex items-center justify-center gap-2" style={{ color: "#8E8E93" }}>
                <Spinner className="h-3.5 w-3.5" />
                {t.waitingForTelegram}
              </p>
              <p className="text-[11px]" style={{ color: "#636366" }}>
                {t.telegramInstructions}
              </p>
            </div>
          )}

          {deepLinkStatus === "error" && (
            <div className="space-y-1">
              <p className="text-xs text-red-400">{t.loginFailedRetry}</p>
              <button
                onClick={() => setDeepLinkStatus("idle")}
                className="text-xs underline text-red-300 hover:text-red-200 transition-colors"
              >
                {t.telegramWidgetRetry}
              </button>
            </div>
          )}
        </div>

        {/* Legal footer */}
        <div
          className="mt-8 pt-6"
          style={{ borderTop: "1px solid rgba(255, 255, 255, 0.08)" }}
        >
          <p
            className="text-center text-xs mb-3"
            style={{ color: "#8E8E93" }}
          >
            {t.legalPrefix}{" "}
            <a
              href="/terms"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-white transition-colors"
              style={{ color: "#D4007A" }}
            >
              {t.legalTerms}
            </a>{" "}
            {t.legalAnd}{" "}
            <a
              href="/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-white transition-colors"
              style={{ color: "#D4007A" }}
            >
              {t.legalPrivacyPolicy}
            </a>
          </p>
          <div className="flex flex-wrap justify-center gap-x-3 gap-y-1">
            {(
              [
                { href: "/cookies", label: t.footerLinks.cookies },
                {
                  href: "/community-guidelines",
                  label: t.footerLinks.communityGuidelines,
                },
                { href: "/content-policy", label: t.footerLinks.contentPolicy },
                { href: "/refunds", label: t.footerLinks.refunds },
                { href: "/subscriptions", label: t.footerLinks.subscriptions },
                { href: "/creator-terms", label: t.footerLinks.creatorTerms },
                { href: "/dmca", label: t.footerLinks.dmca },
                { href: "/safety", label: t.footerLinks.safety },
                { href: "/contact", label: t.footerLinks.contact },
              ] as { href: string; label: string }[]
            ).map(({ href, label }) => (
              <a
                key={href}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] hover:underline transition-colors"
                style={{ color: "#8E8E93" }}
              >
                {label}
              </a>
            ))}
          </div>
          <p
            className="text-center text-[10px] mt-3"
            style={{ color: "#636366" }}
          >
            {t.copyright}
          </p>
        </div>
      </div>
    </div>
  );
}

export default LoginPage;
