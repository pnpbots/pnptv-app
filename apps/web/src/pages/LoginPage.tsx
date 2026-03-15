import React, { useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { telegramWidgetAuth, recoverAccount, type TelegramWidgetUser } from "@/lib/api";
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
      email: t.loginWithEmail,
      admin: "Email",
    };
    return map[method] ?? null;
  };

  type WidgetStatus = "idle" | "verifying" | "error";
  const [widgetStatus, setWidgetStatus] = useState<WidgetStatus>("idle");
  const [widgetBlocked, setWidgetBlocked] = useState(false);
  const [widgetError, setWidgetError] = useState<string | null>(null);

  // Recovery state
  const [showRecovery, setShowRecovery] = useState(false);
  const [recoveryEmail, setRecoveryEmail] = useState("");
  const [isRecovering, setIsRecovering] = useState(false);
  const [recoverySent, setRecoverySent] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);

  // Email form state (Admins/Staff)
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [emailVal, setEmailVal] = useState("");
  const [passwordVal, setPasswordVal] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [emailLogging, setEmailLogging] = useState(false);
  const [emailLoginError, setEmailLoginError] = useState<string | null>(null);
  const emailInputRef = useRef<HTMLInputElement>(null);

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
          window.location.href = "/";
        } else {
          setWidgetStatus("error");
          setWidgetError(result.error || t.telegramWidgetError);
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : t.telegramWidgetError;
        setWidgetStatus("error");
        setWidgetError(message);
      }
    },
    [refreshUser, t],
  );

  const handleWidgetLoadError = useCallback(() => {
    setWidgetBlocked(true);
  }, []);

  const handleRecover = async () => {
    if (!recoveryEmail.trim()) return;
    setIsRecovering(true);
    setRecoveryError(null);
    try {
      const res = await recoverAccount(recoveryEmail);
      if (res.success) {
        setRecoverySent(true);
      } else {
        setRecoveryError(res.message || "Failed to initiate recovery");
      }
    } catch (err: any) {
      setRecoveryError(err.message || "Connection error");
    } finally {
      setIsRecovering(false);
    }
  };

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
        body: JSON.stringify({ email: trimmedEmail, password: passwordVal, rememberMe }),
      });
      const data = await res.json();
      if (res.ok && data.authenticated) {
        localStorage.setItem("pnptv_last_auth", "email");
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

  return (
    <div className="min-h-screen flex items-center justify-center px-4 relative overflow-hidden" style={{ background: "#121212" }}>
      <div className="absolute top-[-20%] left-[-10%] w-[500px] h-[500px] rounded-full opacity-20 blur-3xl pointer-events-none"
        style={{ background: "radial-gradient(circle, #D4007A, transparent 70%)" }} />
      <div className="absolute bottom-[-20%] right-[-10%] w-[500px] h-[500px] rounded-full opacity-20 blur-3xl pointer-events-none"
        style={{ background: "radial-gradient(circle, #E69138, transparent 70%)" }} />

      <div className="glass-card neon-glow animate-subtle-glow w-full max-w-md p-8 sm:p-10 relative z-10 animate-fade-in-up">
        <div className="text-center mb-6">
          <img src="/Logo2-50.png" alt="PNPTV" className="h-14 w-auto mx-auto" />
          <p className="text-sm mt-2 font-medium" style={{ color: "#E69138" }}>{t.tagline}</p>
        </div>

        <div className="space-y-4">
          {!showRecovery && !showEmailForm && (
            <>
              {widgetStatus === "verifying" && (
                <div className="flex items-center justify-center gap-3 py-4 text-white text-sm font-medium">
                  <Spinner />
                  <span>{t.telegramWidgetVerifying}</span>
                </div>
              )}
              <div className={widgetStatus === "verifying" ? "hidden" : ""}>
                <TelegramLoginWidget onAuth={handleWidgetAuth} onLoadError={handleWidgetLoadError} />
              </div>
              {widgetBlocked && <p className="text-center text-xs" style={{ color: "#8E8E93" }}>{t.telegramWidgetBlocked}</p>}
            </>
          )}

          {showRecovery && (
            <div className="rounded-xl p-4 space-y-3 bg-white/5 border border-white/10 animate-fade-in-up">
              <h3 className="text-sm font-bold text-white text-center">Recover Legacy Account</h3>
              {recoverySent ? (
                <div className="text-center space-y-2">
                  <p className="text-xs text-green-400">Recovery link sent to your email via Authentik.</p>
                  <button onClick={() => setShowRecovery(false)} className="text-xs underline text-pnp-textSecondary">Back to login</button>
                </div>
              ) : (
                <>
                  <p className="text-[10px] text-pnp-textSecondary text-center">Enter the email you used with X or your old account.</p>
                  <input
                    type="email"
                    value={recoveryEmail}
                    onChange={(e) => setRecoveryEmail(e.target.value)}
                    placeholder="Email address"
                    className="w-full px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-xs text-white focus:outline-none focus:border-pnp-accent"
                  />
                  {recoveryError && <p className="text-[10px] text-red-400">{recoveryError}</p>}
                  <div className="flex gap-2">
                    <button onClick={handleRecover} disabled={isRecovering || !recoveryEmail.includes("@")}
                      className="flex-1 py-2 rounded-lg bg-pnp-accent text-white text-xs font-bold disabled:opacity-50">
                      {isRecovering ? <Spinner className="w-3 h-3 mx-auto" /> : "Send Recovery Link"}
                    </button>
                    <button onClick={() => setShowRecovery(false)} className="px-3 py-2 text-xs text-pnp-textSecondary">Cancel</button>
                  </div>
                </>
              )}
            </div>
          )}

          {showEmailForm && (
            <div className="rounded-xl p-4 space-y-3 bg-white/5 border border-white/10 animate-fade-in-up">
              <h3 className="text-sm font-bold text-white text-center">Staff Login</h3>
              <input ref={emailInputRef} type="email" value={emailVal} onChange={(e) => setEmailVal(e.target.value)}
                placeholder="Email" className="w-full px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-xs text-white focus:outline-none focus:border-pnp-accent" />
              <input type="password" value={passwordVal} onChange={(e) => setPasswordVal(e.target.value)}
                placeholder="Password" className="w-full px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-xs text-white focus:outline-none focus:border-pnp-accent" />
              {emailLoginError && <p className="text-[10px] text-red-400">{emailLoginError}</p>}
              <div className="flex gap-2">
                <button onClick={handleEmailLogin} disabled={emailLogging} className="flex-1 py-2 rounded-lg bg-pnp-accent text-white text-xs font-bold">
                  {emailLogging ? <Spinner className="w-3 h-3 mx-auto" /> : "Log In"}
                </button>
                <button onClick={() => setShowEmailForm(false)} className="px-3 py-2 text-xs text-pnp-textSecondary">Cancel</button>
              </div>
            </div>
          )}
        </div>

        {!showRecovery && !showEmailForm && (
          <div className="mt-6 space-y-3">
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-white/5" />
              <span className="text-[10px] text-pnp-textSecondary uppercase tracking-widest">Legacy Access</span>
              <div className="flex-1 h-px bg-white/5" />
            </div>
            <button onClick={() => setShowRecovery(true)}
              className="w-full py-3 px-6 rounded-xl font-semibold text-sm flex items-center justify-center gap-3 bg-white/5 border border-white/10 text-white hover:bg-white/10 transition-all">
              Recover Account (formerly X)
            </button>
            <div className="text-center pt-2">
              <button onClick={() => setShowEmailForm(true)} className="text-[10px] text-pnp-textSecondary hover:text-white transition-colors uppercase tracking-widest">
                Staff Access
              </button>
            </div>
          </div>
        )}

        <div className="mt-8 pt-6 border-t border-white/5">
          <p className="text-center text-[10px] text-pnp-textSecondary mb-3">
            {t.legalPrefix} <a href="/terms" className="underline text-pnp-accent">{t.legalTerms}</a> {t.legalAnd} <a href="/privacy" className="underline text-pnp-accent">{t.legalPrivacyPolicy}</a>
          </p>
          <div className="flex flex-wrap justify-center gap-x-3 gap-y-1">
            {["cookies", "safety", "contact"].map(key => (
              <a key={key} href={`/${key}`} className="text-[10px] text-pnp-textSecondary hover:underline capitalize">{key}</a>
            ))}
          </div>
          <p className="text-center text-[9px] text-pnp-textSecondary/50 mt-3">{t.copyright}</p>
        </div>
      </div>
    </div>
  );
}

export default LoginPage;
