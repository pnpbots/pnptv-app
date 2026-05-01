import React, { useState, useEffect, useRef, useCallback } from "react";
import { telegramWidgetAuth, type TelegramWidgetUser } from "@/lib/api";
import { rememberReturnTo, sanitizeReturnTo } from "@/lib/auth";
import { useAuth } from "@/hooks/useAuth";

const AUTHENTIK_URL = import.meta.env.VITE_AUTHENTIK_URL || "https://auth.pnptv.app";
const ENROLLMENT_FLOW_URL = `${AUTHENTIK_URL}/if/flow/pnptv-enrollment/`;

function getBotUsername(): string {
  const raw = import.meta.env.VITE_TELEGRAM_BOT_USERNAME || "PNPLatinoTV_Bot";
  return raw.startsWith("@") ? raw.slice(1) : raw;
}

// ── i18n ──────────────────────────────────────────────────────────────────────

const T = {
  en: {
    tagline:   "The Queer PNP Community",
    oidc:      "Continue with PNPtv ID",
    or:        "or",
    telegram:  "Login with Telegram",
    noAcc:     "No account?",
    create:    " Create one",
    lastWith:  "Last signed in with",
    verifying: "Verifying…",
    blocked:   "Telegram widget unavailable. Try PNPtv ID instead.",
    error:     "Authentication failed. Try again.",
  },
  es: {
    tagline:   "La Comunidad Queer PNP",
    oidc:      "Continuar con PNPtv ID",
    or:        "o",
    telegram:  "Iniciar con Telegram",
    noAcc:     "¿Sin cuenta?",
    create:    " Créala aquí",
    lastWith:  "Último acceso con",
    verifying: "Verificando…",
    blocked:   "Widget de Telegram no disponible. Usa PNPtv ID.",
    error:     "Error de autenticación. Intenta de nuevo.",
  },
};

// ── Spinner ───────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <svg className="animate-spin" style={{ width: 18, height: 18, flexShrink: 0 }}
      viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

// ── LangToggle ────────────────────────────────────────────────────────────────

function LangToggle({ lang, onChange }: { lang: "en" | "es"; onChange: (l: "en" | "es") => void }) {
  const pill: React.CSSProperties = {
    background: "none", border: "none", padding: "5px 12px",
    fontFamily: "'Roboto Mono', monospace", fontSize: 11, fontWeight: 600,
    cursor: "pointer", borderRadius: 18, transition: "all 0.2s",
    minHeight: 32,
  };
  return (
    <div style={{ position: "fixed", top: 18, right: 18, display: "flex",
      background: "rgba(255,255,255,0.10)", borderRadius: 20, padding: 2, zIndex: 50 }}
      role="group" aria-label="Language">
      <button onClick={() => onChange("en")} aria-pressed={lang === "en"}
        style={{ ...pill, background: lang === "en" ? "#fff" : "transparent",
          color: lang === "en" ? "#120d14" : "rgba(207,207,212,0.55)" }}>
        EN
      </button>
      <button onClick={() => onChange("es")} aria-pressed={lang === "es"}
        style={{ ...pill, background: lang === "es" ? "#fff" : "transparent",
          color: lang === "es" ? "#120d14" : "rgba(207,207,212,0.55)" }}>
        ES
      </button>
    </div>
  );
}

// ── TelegramLoginWidget ────────────────────────────────────────────────────────

function TelegramLoginWidget({
  onAuth, onLoadError,
}: {
  onAuth: (u: TelegramWidgetUser) => void;
  onLoadError: () => void;
}) {
  const containerRef  = useRef<HTMLDivElement>(null);
  const onAuthRef     = useRef(onAuth);
  const onErrorRef    = useRef(onLoadError);
  useEffect(() => { onAuthRef.current = onAuth; }, [onAuth]);
  useEffect(() => { onErrorRef.current = onLoadError; }, [onLoadError]);

  useEffect(() => {
    (window as Record<string, unknown>)["onTelegramAuth"] = (u: TelegramWidgetUser) => onAuthRef.current(u);
    const script = document.createElement("script");
    script.src   = "https://telegram.org/js/telegram-widget.js?22";
    script.async = true;
    script.setAttribute("data-telegram-login", getBotUsername());
    script.setAttribute("data-size", "large");
    script.setAttribute("data-radius", "12");
    script.setAttribute("data-onauth", "onTelegramAuth(user)");
    script.setAttribute("data-request-access", "write");
    const timer = setTimeout(() => onErrorRef.current(), 8000);
    script.onload  = () => clearTimeout(timer);
    script.onerror = () => { clearTimeout(timer); onErrorRef.current(); };
    containerRef.current?.appendChild(script);
    return () => {
      clearTimeout(timer);
      delete (window as Record<string, unknown>)["onTelegramAuth"];
    };
  }, []);

  return <div ref={containerRef} style={{ display: "flex", justifyContent: "center" }} />;
}

// ── LoginPage ─────────────────────────────────────────────────────────────────

export function LoginPage() {
  const isEs = navigator.language?.startsWith("es");
  const [lang, setLang] = useState<"en" | "es">(isEs ? "es" : "en");
  const t = T[lang];
  const { refreshUser } = useAuth();

  const [returnTo, setReturnTo] = useState<string | null>(null);
  const [lastMethod, setLastMethod] = useState<string | null>(null);
  const [lastUsername, setLastUsername] = useState<string | null>(null);

  useEffect(() => {
    setLastMethod(localStorage.getItem("pnptv_last_auth"));
    setLastUsername(localStorage.getItem("pnptv_last_username"));
    const raw  = new URLSearchParams(window.location.search).get("returnTo");
    const safe = sanitizeReturnTo(raw);
    if (safe) { setReturnTo(safe); rememberReturnTo(safe); }
  }, []);

  const methodLabel = (m: string | null) => {
    const map: Record<string, string> = { telegram: "Telegram", deep_link: "Telegram", oidc: "PNPtv ID", pnptv_id: "PNPtv ID" };
    return m ? (map[m] ?? null) : null;
  };

  // ── OIDC ─────────────────────────────────────────────────────────────────────

  const [oidcLoading, setOidcLoading] = useState(false);

  const handleOidcLogin = useCallback(async () => {
    setOidcLoading(true);
    try {
      localStorage.setItem("pnptv_last_auth", "pnptv_id");
      const rt = new URLSearchParams(window.location.search).get("returnTo");
      window.location.href = "/api/webapp/auth/oidc/login" + (rt ? `?return_to=${encodeURIComponent(rt)}` : "");
    } catch { setOidcLoading(false); }
  }, []);

  // ── Telegram widget ───────────────────────────────────────────────────────────

  const [widgetStatus, setWidgetStatus] = useState<"idle" | "verifying" | "error">("idle");
  const [widgetBlocked, setWidgetBlocked] = useState(false);
  const [widgetError, setWidgetError]   = useState<string | null>(null);

  const handleWidgetAuth = useCallback(async (u: TelegramWidgetUser) => {
    setWidgetStatus("verifying");
    try {
      const result = await telegramWidgetAuth(u);
      if (result.success) {
        localStorage.setItem("pnptv_last_auth", "telegram");
        if (result.user?.username) localStorage.setItem("pnptv_last_username", result.user.username);
        await refreshUser();
        window.location.href = returnTo || "/";
      } else {
        setWidgetStatus("error");
        setWidgetError(result.error || t.error);
      }
    } catch (err) {
      setWidgetStatus("error");
      setWidgetError(err instanceof Error ? err.message : t.error);
    }
  }, [refreshUser, returnTo, t]);

  const label = methodLabel(lastMethod);

  // ── Shared card styles (mirrors Lifetime100) ──────────────────────────────────

  const s = {
    page: {
      minHeight: "100vh",
      background: "#121212",
      display: "flex",
      flexDirection: "column" as const,
      alignItems: "center",
      justifyContent: "center",
      padding: "24px 16px 80px",
      overflowX: "hidden" as const,
      position: "relative" as const,
    },
    glow: {
      position: "fixed" as const, top: "-25%", left: "50%",
      transform: "translateX(-50%)", width: "100vw", height: "100vw",
      background: "radial-gradient(circle, rgba(255,0,204,0.10) 0%, transparent 70%)",
      pointerEvents: "none" as const, zIndex: 0,
    },
    card: {
      position: "relative" as const, zIndex: 1,
      width: "100%", maxWidth: 400,
      background: "rgba(44,44,46,0.72)",
      backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
      border: "1px solid rgba(255,180,84,0.28)",
      borderRadius: 24, overflow: "hidden",
      boxShadow: "0 20px 48px rgba(0,0,0,0.55)",
    },
    rope: {
      position: "absolute" as const, top: 0, left: 0, right: 0,
      height: 4, background: "linear-gradient(90deg, #ff3377, #ff9933)",
    },
    inner: { padding: "40px 28px 32px" } as React.CSSProperties,
    tagline: {
      textAlign: "center" as const, fontSize: 10, fontWeight: 700,
      letterSpacing: "0.18em", textTransform: "uppercase" as const,
      color: "#ff9933", marginBottom: 28,
    },
    diamonds: {
      display: "flex", justifyContent: "center", gap: 5,
      marginBottom: 28, opacity: 0.5, fontSize: 14,
    },
    hint: {
      textAlign: "center" as const, fontSize: 11,
      color: "rgba(207,207,212,0.55)", marginBottom: 18,
    },
    btnPrimary: {
      display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
      width: "100%", minHeight: 52, border: "none", borderRadius: 14,
      fontFamily: "'Roboto Mono', monospace", fontSize: 14, fontWeight: 800,
      letterSpacing: "0.06em", textTransform: "uppercase" as const,
      color: "#fff", cursor: "pointer",
      background: "linear-gradient(90deg, #ff3377, #ff9933)",
      boxShadow: "0 8px 28px rgba(255,51,119,0.38)",
      transition: "opacity 0.15s, transform 0.12s",
    },
    btnGlass: {
      display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
      width: "100%", minHeight: 52,
      background: "rgba(255,255,255,0.07)",
      border: "1px solid rgba(255,255,255,0.14)",
      borderRadius: 14, fontFamily: "'Roboto Mono', monospace",
      fontSize: 14, fontWeight: 800, letterSpacing: "0.06em",
      textTransform: "uppercase" as const, color: "#fff", cursor: "pointer",
      transition: "opacity 0.15s, transform 0.12s",
    },
    divider: { display: "flex", alignItems: "center", gap: 10, margin: "14px 0" },
    divLine: { flex: 1, height: 1, background: "rgba(255,255,255,0.08)" },
    divText: { fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase" as const, color: "rgba(207,207,212,0.55)" },
    create: { textAlign: "center" as const, fontSize: 12, color: "rgba(207,207,212,0.55)", marginTop: 18 },
    errText: { textAlign: "center" as const, fontSize: 12, color: "#ff6363", marginTop: 10 },
    footer: {
      position: "fixed" as const, bottom: 0, left: 0, right: 0, zIndex: 50,
      background: "linear-gradient(to top, rgba(18,13,20,0.98) 50%, transparent)",
      padding: "12px 16px", display: "flex", flexWrap: "wrap" as const,
      justifyContent: "center", gap: "4px 10px",
    },
    footLink: { fontSize: 10, color: "rgba(207,207,212,0.5)", textDecoration: "none", whiteSpace: "nowrap" as const },
  };

  const LEGAL = lang === "es"
    ? [["Términos","/terms"],["Privacidad","/privacy"],["Cookies","/cookies"],["Seguridad","/safety"],["Contacto","/contact"]]
    : [["Terms","/terms"],["Privacy","/privacy"],["Cookies","/cookies"],["Safety","/safety"],["Contact","/contact"]];

  const ShieldIcon = () => (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3L4 7V12C4 17 7.4 21.4 12 22C16.6 21.4 20 17 20 12V7L12 3Z"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M9 12L11 14L15 10" stroke="currentColor" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );

  const TgIcon = () => (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.479.33-.913.492-1.302.48-.428-.013-1.252-.242-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
    </svg>
  );

  return (
    <div style={s.page}>
      <div style={s.glow} aria-hidden="true" />
      <LangToggle lang={lang} onChange={setLang} />

      <div style={s.card}>
        <div style={s.rope} aria-hidden="true" />
        <div style={s.inner}>

          {/* Logo */}
          <div style={{ textAlign: "center", marginBottom: 8 }}>
            <img src="/logo-login.png" alt="PNPtv!" style={{ height: 48, width: "auto" }} />
          </div>

          {/* Tagline */}
          <p style={s.tagline}>{t.tagline}</p>

          {/* Diamond separator */}
          <div style={s.diamonds} aria-hidden="true">
            <span style={{ color: "#ff3377" }}>⬥</span>
            <span style={{ color: "rgba(207,207,212,0.5)" }}>⬥</span>
            <span style={{ color: "#ff9933" }}>⬥</span>
          </div>

          {/* Returning-user hint */}
          {label && (
            <p style={s.hint}>
              {t.lastWith} <strong style={{ color: "#fff" }}>{label}</strong>
              {lastUsername ? ` (@${lastUsername})` : ""}
            </p>
          )}

          {/* PRIMARY — PNPtv ID */}
          <button onClick={handleOidcLogin} disabled={oidcLoading} style={s.btnPrimary}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.opacity = "0.88"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.opacity = "1"; }}
            onMouseDown={e => { (e.currentTarget as HTMLButtonElement).style.transform = "scale(0.975)"; }}
            onMouseUp={e => { (e.currentTarget as HTMLButtonElement).style.transform = "scale(1)"; }}>
            {oidcLoading ? <Spinner /> : <ShieldIcon />}
            {t.oidc}
          </button>

          {/* Divider */}
          <div style={s.divider}>
            <div style={s.divLine} />
            <span style={s.divText}>{t.or}</span>
            <div style={s.divLine} />
          </div>

          {/* SECONDARY — Telegram widget */}
          {widgetStatus === "verifying" ? (
            <div style={{ ...s.btnGlass, cursor: "default" }}>
              <Spinner />
              {t.verifying}
            </div>
          ) : (
            <TelegramLoginWidget
              onAuth={handleWidgetAuth}
              onLoadError={() => setWidgetBlocked(true)}
            />
          )}

          {widgetStatus === "error" && widgetError && (
            <p style={s.errText}>{widgetError}</p>
          )}
          {widgetBlocked && (
            <p style={{ ...s.hint, marginTop: 8 }}>{t.blocked}</p>
          )}

          {/* Create account */}
          <p style={s.create}>
            {t.noAcc}
            <a href={ENROLLMENT_FLOW_URL}
              style={{ color: "#ff9933", fontWeight: 700, textDecoration: "underline" }}>
              {t.create}
            </a>
          </p>

        </div>
      </div>

      {/* Fixed legal footer */}
      <footer style={s.footer}>
        {LEGAL.map(([label, href]) => (
          <a key={href} href={href} style={s.footLink}
            onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.color = "#fff"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.color = "rgba(207,207,212,0.5)"; }}>
            {label}
          </a>
        ))}
      </footer>
    </div>
  );
}

export default LoginPage;
