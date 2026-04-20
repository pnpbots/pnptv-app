import React, { useState, useEffect, useRef, useCallback } from "react";
import { telegramWidgetAuth, type TelegramWidgetUser } from "@/lib/api";
import { login as oidcLogin, rememberReturnTo, sanitizeReturnTo } from "@/lib/auth";
import { getI18n, getLang } from "@/lib/i18n";
import { useAuth } from "@/hooks/useAuth";

const AUTHENTIK_URL = import.meta.env.VITE_AUTHENTIK_URL || "https://auth.pnptv.app";

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

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4 relative overflow-hidden"
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

      <div className="glass-card neon-glow animate-subtle-glow w-full max-w-md p-8 sm:p-10 relative z-10 animate-fade-in-up">
        {/* Logo + tagline */}
        <div className="text-center mb-8">
          <img
            src="/logo-login.png"
            alt="PNPtv!"
            className="w-64 sm:w-72 h-auto mx-auto"
          />
          <p
            className="text-sm mt-4 font-medium"
            style={{ color: "#E69138" }}
          >
            {t.tagline}
          </p>
        </div>

        <div className="space-y-5">
          {/* Last login method indicator */}
          {label && (
            <p className="text-center text-xs text-pnp-textSecondary">
              {t.lastLoginedWith}{" "}
              <span className="font-semibold text-white">{label}</span>
              {lastUsername ? ` (@${lastUsername})` : ""}
            </p>
          )}

          {/* Primary CTA — PNPtv ID */}
          <button
            onClick={handleOidcLogin}
            disabled={oidcLoading}
            className="w-full py-3.5 px-6 rounded-xl font-bold text-sm flex items-center justify-center gap-2.5 text-white transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-70 disabled:cursor-not-allowed"
            style={{
              background: oidcLoading
                ? "linear-gradient(135deg, #a0005e, #b87020)"
                : "linear-gradient(135deg, #D4007A, #E69138)",
              boxShadow: "0 0 24px rgba(212, 0, 122, 0.4)",
            }}
          >
            {oidcLoading ? (
              <Spinner className="h-5 w-5" />
            ) : (
              <ShieldIcon />
            )}
            <span>{t.signInWithPnptvId}</span>
          </button>

          {/* Divider */}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-white/10" />
            <span className="text-[10px] text-pnp-textSecondary uppercase tracking-widest">
              {t.orContinueWith}
            </span>
            <div className="flex-1 h-px bg-white/10" />
          </div>

          {/* Secondary — Telegram widget */}
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
          {widgetStatus === "error" && widgetError && (
            <p className="text-center text-xs text-red-400">{widgetError}</p>
          )}
          {widgetBlocked && (
            <p className="text-center text-xs" style={{ color: "#8E8E93" }}>
              {t.telegramWidgetBlocked}
            </p>
          )}

          {/* Create account link */}
          <p className="text-center text-xs text-pnp-textSecondary pt-1">
            {t.noAccountPrompt}{" "}
            <a
              href={`${AUTHENTIK_URL}/if/flow/default-enrollment-flow/`}
              className="font-semibold underline text-pnp-accent hover:brightness-125 transition-all"
            >
              {t.createAccount}
            </a>
          </p>
        </div>

        {/* Legal footer */}
        <div className="mt-8 pt-6 border-t border-white/5">
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
