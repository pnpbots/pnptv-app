import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import { telegramWidgetAuth, recoverAccount, TelegramWidgetUser } from "@/lib/api";
import { login as oidcLogin } from "@/lib/auth";
import { useAuth } from "@/hooks/useAuth";
import { LanguageSelector } from "@/components/LanguageSelector";
import { useI18n } from "@/lib/i18n";

const API_BASE = import.meta.env.VITE_API_URL || "https://pnptv.app";
const AUTHENTIK_URL = import.meta.env.VITE_AUTHENTIK_URL || "https://auth.pnptv.app";
const ENROLLMENT_FLOW_URL = `${AUTHENTIK_URL}/if/flow/pnptv-enrollment/`;
const RECOVERY_FLOW_URL = `${AUTHENTIK_URL}/if/flow/pnptv-recovery/`;

function getBotUsername(): string {
  const raw = import.meta.env.VITE_TELEGRAM_BOT_USERNAME || "PNPLatinoTV_Bot";
  return raw.startsWith("@") ? raw.slice(1) : raw;
}

// ── Spinner ───────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

// ── Telegram Widget ───────────────────────────────────────────────────────────

function TelegramLoginWidget({ onAuth, onLoadError }: { onAuth: (u: TelegramWidgetUser) => void; onLoadError: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onAuthRef = useRef(onAuth);
  const onLoadErrorRef = useRef(onLoadError);
  useEffect(() => { onAuthRef.current = onAuth; }, [onAuth]);
  useEffect(() => { onLoadErrorRef.current = onLoadError; }, [onLoadError]);
  useEffect(() => {
    (window as unknown as Record<string, unknown>)["onTelegramAuth"] = (user: TelegramWidgetUser) => { onAuthRef.current(user); };
    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.async = true;
    script.setAttribute("data-telegram-login", getBotUsername());
    script.setAttribute("data-size", "large");
    script.setAttribute("data-radius", "12");
    script.setAttribute("data-onauth", "onTelegramAuth(user)");
    script.setAttribute("data-request-access", "write");
    const timer = setTimeout(() => onLoadErrorRef.current(), 8000);
    script.onload = () => clearTimeout(timer);
    script.onerror = () => { clearTimeout(timer); onLoadErrorRef.current(); };
    containerRef.current?.appendChild(script);
    return () => {
      clearTimeout(timer);
      delete (window as unknown as Record<string, unknown>)["onTelegramAuth"];
    };
  }, []);
  return <div ref={containerRef} className="flex justify-center" />;
}

// ── Sheet content ─────────────────────────────────────────────────────────────
// Translations for each sheet — keyed strings consumed by `makeSheets(lang)`.
// Only EN + ES are localized; other languages fall back to EN.

type SheetLang = "en" | "es";
const SHEET_STRINGS: Record<SheetLang, {
  about: { title: string; lead: string; leadEmphasis: string; cards: Array<{ e: string; t: string; b: string }> };
  feed: { title: string; eyebrow: string; p1: string; p1Emphasis: string; p2: string };
  hangouts: { title: string; eyebrow: string; p1: string; p2Emphasis: string };
  live: { title: string; eyebrow: string; p1: string; p2Emphasis: string };
  nearby: { title: string; eyebrow: string; p1: string; p1Emphasis: string; p2: string; p2Emphasis: string };
  creators: { title: string; lead: string; leadEmphasis: string; stats: Array<{ v: string; l: string }>; cta: string };
  payments: { title: string; lead: string; cards: Array<{ e: string; t: string; b: string }>; fineprint: string };
  safety: { title: string; lead: string; checks: string[]; cta: string };
}> = {
  en: {
    about: {
      title: "What is PNPtv?",
      lead: "A private social network built for the queer PNP community. Post, chat, stream, meet people nearby — without judgment, algorithms, or bans.",
      leadEmphasis: "Your data stays with us.",
      cards: [
        { e: "🔒", t: "Private by default", b: "Nothing you post leaves our walls unless you share it yourself." },
        { e: "🌈", t: "Built for you", b: "Every feature designed with the queer PNP community in mind." },
        { e: "📱", t: "Works in your browser", b: "No app store. Open pnptv.app on any phone. Install it for push notifications." },
      ],
    },
    feed: {
      title: "Feed",
      eyebrow: "Your feed, your rules",
      p1: "Post text, photos, or videos. Like, reply, repost. Follow people you vibe with and get a feed that's actually relevant —",
      p1Emphasis: "no shadow banning, no ads, no content cops.",
      p2: "Creators can lock exclusive posts for subscribers only.",
    },
    hangouts: {
      title: "Hangouts",
      eyebrow: "Like Discord — but simpler",
      p1: "Create a Hangout, invite your people, jump into group video or voice. Public rooms or private ones with a password.",
      p2Emphasis: "No bots. No server setup. No 47 channels you'll never use.",
    },
    live: {
      title: "Live",
      eyebrow: "Like Chaturbate — but cloudy ☁️",
      p1: "Stream directly from your browser or use OBS with a streaming key. Followers get notified instantly, chat in real-time, and tip you directly.",
      p2Emphasis: "No strikes. No suspensions. No content police.",
    },
    nearby: {
      title: "Connect",
      eyebrow: "Like Grindr — but for real PNP stans",
      p1: "See community members and PNP-friendly venues near you on a map.",
      p1Emphasis: "No bots, no escorts, no judgment.",
      p2: "Way more private than Grindr. You control your location.",
      p2Emphasis: "Nothing is ever sold to data brokers.",
    },
    creators: {
      title: "Creators",
      lead: "Subscriptions, exclusive content, tips, live streaming —",
      leadEmphasis: "you keep 80% of everything.",
      stats: [{ v: "80%", l: "Revenue yours" }, { v: "0", l: "Middlemen" }, { v: "Fast", l: "Payouts" }],
      cta: "Apply as a Creator →",
    },
    payments: {
      title: "Payments",
      lead: "Multiple ways to pay — pick what works for you.",
      cards: [
        { e: "💳", t: "Credit & Debit Card", b: "Visa, Mastercard via ePayco. Fast and familiar." },
        { e: "⚡", t: "Crypto (USDC)", b: "Pay with USDC on Base via Daimo. Near-instant, low fees." },
        { e: "🪙", t: "PNP Tokens", b: "Buy tokens inside the app for tips, subscriptions & exclusive content." },
      ],
      fineprint: "🔒 Encrypted · Discreet billing · We never store your card",
    },
    safety: {
      title: "Safety First",
      lead: "We take safety seriously. This is your space and we protect it.",
      checks: [
        "Age & identity verification for all members",
        "Human moderation — real people reviewing reports",
        "Encrypted direct messages",
        "Block, mute, and report tools on every post",
        "Harm reduction resources & community guidelines",
      ],
      cta: "Learn more →",
    },
  },
  es: {
    about: {
      title: "¿Qué es PNPtv?",
      lead: "Una red social privada hecha para la comunidad queer PNP. Publica, chatea, transmite, conoce gente cerca — sin juicios, sin algoritmos, sin baneos.",
      leadEmphasis: "Tus datos se quedan con nosotros.",
      cards: [
        { e: "🔒", t: "Privado por defecto", b: "Nada de lo que publiques sale de nuestras paredes a menos que tú mismo lo compartas." },
        { e: "🌈", t: "Hecho para ti", b: "Cada función diseñada pensando en la comunidad queer PNP." },
        { e: "📱", t: "Funciona en tu navegador", b: "Sin app store. Abre pnptv.app en cualquier teléfono. Instálala para recibir notificaciones push." },
      ],
    },
    feed: {
      title: "Feed",
      eyebrow: "Tu feed, tus reglas",
      p1: "Publica texto, fotos o videos. Da like, responde, repostea. Sigue a quien vibres y recibe un feed que sí es relevante —",
      p1Emphasis: "sin shadow banning, sin anuncios, sin policías de contenido.",
      p2: "Los creadores pueden bloquear publicaciones exclusivas solo para suscriptores.",
    },
    hangouts: {
      title: "Hangouts",
      eyebrow: "Como Discord — pero más simple",
      p1: "Crea un Hangout, invita a los tuyos, entra a video o voz grupal. Salas públicas o privadas con contraseña.",
      p2Emphasis: "Sin bots. Sin configurar servidor. Sin 47 canales que nunca usarás.",
    },
    live: {
      title: "En Vivo",
      eyebrow: "Como Chaturbate — pero en la nube ☁️",
      p1: "Transmite directo desde tu navegador o usa OBS con una clave de stream. Tus seguidores reciben aviso al instante, chatean en tiempo real y te dan propinas directo.",
      p2Emphasis: "Sin strikes. Sin suspensiones. Sin policías de contenido.",
    },
    nearby: {
      title: "Conectar",
      eyebrow: "Como Grindr — pero para PNP de verdad",
      p1: "Ve miembros de la comunidad y lugares PNP-friendly cerca de ti en un mapa.",
      p1Emphasis: "Sin bots, sin escorts, sin juicios.",
      p2: "Mucho más privado que Grindr. Tú controlas tu ubicación.",
      p2Emphasis: "Nada se vende nunca a data brokers.",
    },
    creators: {
      title: "Creadores",
      lead: "Suscripciones, contenido exclusivo, propinas, transmisión en vivo —",
      leadEmphasis: "te quedas con el 80% de todo.",
      stats: [{ v: "80%", l: "Ingresos tuyos" }, { v: "0", l: "Intermediarios" }, { v: "Rápido", l: "Pagos" }],
      cta: "Aplica como Creador →",
    },
    payments: {
      title: "Pagos",
      lead: "Varias formas de pagar — elige la que te funcione.",
      cards: [
        { e: "💳", t: "Tarjeta crédito y débito", b: "Visa, Mastercard vía ePayco. Rápido y familiar." },
        { e: "⚡", t: "Cripto (USDC)", b: "Paga con USDC en Base vía Daimo. Casi instantáneo, comisiones bajas." },
        { e: "🪙", t: "PNP Tokens", b: "Compra tokens dentro de la app para propinas, suscripciones y contenido exclusivo." },
      ],
      fineprint: "🔒 Encriptado · Cobro discreto · Nunca guardamos tu tarjeta",
    },
    safety: {
      title: "Seguridad primero",
      lead: "Nos tomamos la seguridad en serio. Este es tu espacio y lo protegemos.",
      checks: [
        "Verificación de edad e identidad para todos los miembros",
        "Moderación humana — personas reales revisando los reportes",
        "Mensajes directos encriptados",
        "Herramientas para bloquear, silenciar y reportar en cada publicación",
        "Recursos de reducción de daños y reglas de comunidad",
      ],
      cta: "Aprende más →",
    },
  },
};

export function makeSheets(lang: string): Record<string, { title: string; emoji: string; body: React.ReactNode }> {
  const ss = SHEET_STRINGS[lang === "es" ? "es" : "en"];
  return {
    about: {
      title: ss.about.title,
      emoji: "👋",
      body: (
        <div className="space-y-3">
          <p className="text-pnp-textSecondary text-sm leading-relaxed">
            {ss.about.lead} <span className="text-white font-medium">{ss.about.leadEmphasis}</span>
          </p>
          <div className="space-y-2">
            {ss.about.cards.map(c => (
              <div key={c.t} className="flex gap-3 p-3 rounded-xl bg-pnp-surface border border-pnp-border">
                <span className="text-lg flex-shrink-0">{c.e}</span>
                <div>
                  <p className="text-white text-xs font-semibold">{c.t}</p>
                  <p className="text-pnp-textSecondary text-xs mt-0.5">{c.b}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      ),
    },
    feed: {
      title: ss.feed.title,
      emoji: "📣",
      body: (
        <div className="space-y-3">
          <p className="text-xs font-bold uppercase tracking-widest text-gradient">{ss.feed.eyebrow}</p>
          <p className="text-pnp-textSecondary text-sm leading-relaxed">
            {ss.feed.p1} <span className="text-white font-medium">{ss.feed.p1Emphasis}</span>
          </p>
          <p className="text-pnp-textSecondary text-sm leading-relaxed">
            {ss.feed.p2}
          </p>
        </div>
      ),
    },
    hangouts: {
      title: ss.hangouts.title,
      emoji: "🎙️",
      body: (
        <div className="space-y-3">
          <p className="text-xs font-bold uppercase tracking-widest text-gradient">{ss.hangouts.eyebrow}</p>
          <p className="text-pnp-textSecondary text-sm leading-relaxed">
            {ss.hangouts.p1}
          </p>
          <p className="text-pnp-textSecondary text-sm leading-relaxed">
            <span className="text-white font-medium">{ss.hangouts.p2Emphasis}</span>
          </p>
        </div>
      ),
    },
    live: {
      title: ss.live.title,
      emoji: "🔴",
      body: (
        <div className="space-y-3">
          <p className="text-xs font-bold uppercase tracking-widest text-gradient">{ss.live.eyebrow}</p>
          <p className="text-pnp-textSecondary text-sm leading-relaxed">
            {ss.live.p1}
          </p>
          <p className="text-pnp-textSecondary text-sm leading-relaxed">
            <span className="text-white font-medium">{ss.live.p2Emphasis}</span>
          </p>
        </div>
      ),
    },
    nearby: {
      title: ss.nearby.title,
      emoji: "📍",
      body: (
        <div className="space-y-3">
          <p className="text-xs font-bold uppercase tracking-widest text-gradient">{ss.nearby.eyebrow}</p>
          <p className="text-pnp-textSecondary text-sm leading-relaxed">
            {ss.nearby.p1}
            <span className="text-white font-medium"> {ss.nearby.p1Emphasis}</span>
          </p>
          <p className="text-pnp-textSecondary text-sm leading-relaxed">
            {ss.nearby.p2} <span className="text-white font-medium">{ss.nearby.p2Emphasis}</span>
          </p>
        </div>
      ),
    },
    creators: {
      title: ss.creators.title,
      emoji: "💰",
      body: (
        <div className="space-y-3">
          <p className="text-pnp-textSecondary text-sm leading-relaxed">
            {ss.creators.lead}
            <span className="text-white font-medium"> {ss.creators.leadEmphasis}</span>
          </p>
          <div className="flex gap-2">
            {ss.creators.stats.map(s => (
              <div key={s.l} className="flex-1 text-center p-3 rounded-xl bg-pnp-surface border border-pnp-border">
                <div className="text-base font-bold text-gradient">{s.v}</div>
                <div className="text-pnp-textSecondary text-[10px] mt-0.5">{s.l}</div>
              </div>
            ))}
          </div>
          <Link to="/become-a-model" className="block w-full text-center py-3 rounded-xl text-sm font-semibold border border-pnp-border text-pnp-textSecondary hover:text-white hover:border-white/30 transition-colors">
            {ss.creators.cta}
          </Link>
        </div>
      ),
    },
    payments: {
      title: ss.payments.title,
      emoji: "💳",
      body: (
        <div className="space-y-2">
          <p className="text-pnp-textSecondary text-sm mb-3">{ss.payments.lead}</p>
          {ss.payments.cards.map(c => (
            <div key={c.t} className="flex gap-3 p-3 rounded-xl bg-pnp-surface border border-pnp-border">
              <span className="text-lg flex-shrink-0">{c.e}</span>
              <div>
                <p className="text-white text-xs font-semibold">{c.t}</p>
                <p className="text-pnp-textSecondary text-xs mt-0.5">{c.b}</p>
              </div>
            </div>
          ))}
          <p className="text-pnp-textSecondary/50 text-[10px] text-center pt-1">{ss.payments.fineprint}</p>
        </div>
      ),
    },
    safety: {
      title: ss.safety.title,
      emoji: "🛡️",
      body: (
        <div className="space-y-3">
          <p className="text-pnp-textSecondary text-sm leading-relaxed">{ss.safety.lead}</p>
          <div className="space-y-2">
            {ss.safety.checks.map(item => (
              <div key={item} className="flex gap-2.5 items-start">
                <svg className="w-4 h-4 mt-0.5 flex-shrink-0 text-pnp-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
                <p className="text-pnp-textSecondary text-sm">{item}</p>
              </div>
            ))}
          </div>
          <a href="/safety" className="block text-center text-sm font-semibold text-gradient mt-2">{ss.safety.cta}</a>
        </div>
      ),
    },
  };
}

// Back-compat: existing import sites keep working with default English. New
// callers should use `makeSheets(lang)` to honor language switching.
export const sheets = makeSheets("en");

const navItems = [
  { id: "about",    emoji: "👋", label: "About" },
  { id: "feed",     emoji: "📣", label: "Feed" },
  { id: "hangouts", emoji: "🎙️", label: "Hangouts" },
  { id: "live",     emoji: "🔴", label: "Live" },
  { id: "nearby",   emoji: "📍", label: "Connect" },
  { id: "creators", emoji: "💰", label: "Creators" },
  { id: "payments", emoji: "💳", label: "Payments" },
  { id: "safety",   emoji: "🛡️", label: "Safety" },
] as const;

const legalLinks = [
  { label: "Terms", href: "/terms" },
  { label: "Privacy", href: "/privacy" },
  { label: "Cookies", href: "/cookies" },
  { label: "Content Policy", href: "/content-policy" },
  { label: "DMCA", href: "/dmca" },
  { label: "Refunds", href: "/refunds" },
  { label: "Contact", href: "/contact" },
];

// ── LandingPage ───────────────────────────────────────────────────────────────

export function LandingPage() {
  const { refreshUser } = useAuth();

  const [loginOpen, setLoginOpen] = useState(false);
  const [loginView, setLoginView] = useState<"options" | "telegram">("options");

  const returningUsername = (() => {
    try { return localStorage.getItem("pnptv_last_username") || null; } catch { return null; }
  })();
  const returningMethod = (() => {
    try { return localStorage.getItem("pnptv_last_auth") || null; } catch { return null; }
  })();

  const handleContinueAs = () => {
    if (returningMethod === "telegram") {
      setLoginOpen(true);
      setLoginView("telegram");
    } else {
      window.location.href = "/api/webapp/auth/oidc/login";
    }
  };

  // Surface OIDC errors from backend redirect (?oidc_error=...) and open login panel
  const [oidcError, setOidcError] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("oidc_error");
  });
  useEffect(() => {
    if (oidcError) {
      setLoginOpen(true);
    }
  }, [oidcError]);

  const [widgetStatus, setWidgetStatus] = useState<"idle" | "verifying" | "error">("idle");
  const [widgetBlocked, setWidgetBlocked] = useState(false);
  const [widgetError, setWidgetError] = useState<string | null>(null);

  // Signup / email-capture (primary CTA)
  const [signupEmail, setSignupEmail] = useState("");
  const [signupEmailError, setSignupEmailError] = useState<string | null>(null);

  const [recoverEmail, setRecoverEmail] = useState("");
  const [recoverLoading, setRecoverLoading] = useState(false);
  const [recoverSent, setRecoverSent] = useState(false);
  const [recoverError, setRecoverError] = useState<string | null>(null);

  const [activeSheet, setActiveSheet] = useState<string | null>(() => {
    // Deep-link support: /landing?sheet=feed opens the Feed sheet on mount
    const params = new URLSearchParams(window.location.search);
    const requested = params.get("sheet");
    const valid = new Set(["about", "feed", "hangouts", "live", "nearby", "creators", "payments", "safety"]);
    return requested && valid.has(requested) ? requested : null;
  });
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // LATAM performer-focus mode — backend redirects non-grandfathered LATAM
  // visitors here with ?focus=performer and surfaces the performer CTA banner.
  const performerFocus = (() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("focus") === "performer";
  })();
  const performerCountry = (() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("country") || null;
  })();

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  useEffect(() => {
    document.body.style.overflow = activeSheet ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [activeSheet]);

  const handleWidgetAuth = useCallback(async (userData: TelegramWidgetUser) => {
    setWidgetStatus("verifying");
    try {
      const result = await telegramWidgetAuth(userData);
      if (result.success) {
        localStorage.setItem("pnptv_last_auth", "telegram");
        if (result.user?.username) localStorage.setItem("pnptv_last_username", result.user.username);
        await refreshUser();
        window.location.href = "/";
      } else {
        setWidgetStatus("error");
        setWidgetError(result.error || "Authentication failed");
      }
    } catch {
      setWidgetStatus("error");
      setWidgetError("Something went wrong. Try again.");
    }
  }, [refreshUser]);

  const handleWidgetLoadError = useCallback(() => setWidgetBlocked(true), []);

  const handleDeepLink = async () => {
    try {
      const win = window.open("about:blank", "_blank");
      const res = await fetch(`${API_BASE}/api/webapp/auth/telegram/token`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" } });
      const data = await res.json();
      if (!data.success || !data.token || !data.deepLink) { win?.close(); return; }
      const isValidDeepLink = (url: string) => url.startsWith('/') || url.startsWith('https://');
      if (!isValidDeepLink(data.deepLink)) { win?.close(); return; }
      if (win) win.location.href = data.deepLink; else window.location.href = data.deepLink;
      let attempts = 0;
      pollRef.current = setInterval(async () => {
        if (++attempts > 60) { clearInterval(pollRef.current!); return; }
        try {
          const check = await fetch(`${API_BASE}/api/webapp/auth/telegram/check?token=${data.token}`, { credentials: "include" });
          const result = await check.json();
          if (result.authenticated) { clearInterval(pollRef.current!); localStorage.setItem("pnptv_last_auth", "telegram"); window.location.href = "/"; }
        } catch { /* keep polling */ }
      }, 5000);
    } catch { /* silent */ }
  };

  const handleCreateAccount = (e: React.FormEvent) => {
    e.preventDefault();
    const email = signupEmail.trim();
    if (!email) { setSignupEmailError("Please enter your email to continue"); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setSignupEmailError("That doesn't look like a valid email"); return; }
    setSignupEmailError(null);
    try { localStorage.setItem("pnptv_signup_email", email); } catch { /* ignore */ }
    window.location.href = `${ENROLLMENT_FLOW_URL}?email=${encodeURIComponent(email)}`;
  };

  const handleRecover = async () => {
    if (!recoverEmail.trim() || !recoverEmail.includes("@")) return;
    setRecoverLoading(true);
    setRecoverError(null);
    try {
      const res = await recoverAccount(recoverEmail.trim().toLowerCase());
      if (res.success) {
        setRecoverSent(true);
      } else {
        setRecoverError(res.message || "Recovery failed");
      }
    } catch { setRecoverError("Connection error. Try again."); }
    finally { setRecoverLoading(false); }
  };

  const i18n = useI18n();
  const localizedSheets = useMemo(() => makeSheets(i18n.lang), [i18n.lang]);
  const sheet = activeSheet ? localizedSheets[activeSheet] : null;

  return (
    <div className="app-shell bg-pnp-background">

      {/* ── HEADER ──────────────────────────────────────────────────────────── */}
      <header className="glass-nav border-b border-pnp-border flex items-center justify-end px-4 h-14 flex-shrink-0">
        <LanguageSelector />
      </header>

      {/* ── HERO ────────────────────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col items-center justify-center text-center px-4 overflow-y-auto">
        <div className="w-full max-w-xs flex flex-col items-center gap-4">

          {/* Logo — hero centerpiece */}
          <img src="/logo-login.png" alt="PNPtv!" className="w-56 h-auto" />

          {/* Tagline */}
          <div>
            <p className="text-gradient text-xs font-bold uppercase tracking-widest mb-1">The Clouds &amp; Rush Network</p>
            <p className="text-pnp-textSecondary text-xs">The #1 queer PNP community</p>
          </div>

          {/* Performer focus banner — shown to LATAM visitors redirected by the
             backend geo gate. Puts the "Become a Performer" flow front-and-center. */}
          {performerFocus && (
            <div className="w-full rounded-2xl border border-pnp-accent/30 bg-gradient-to-br from-pink-500/10 via-purple-500/10 to-orange-500/10 p-4 space-y-3 text-left">
              <div className="flex items-center gap-2">
                <span className="text-xl">🎬</span>
                <p className="text-xs font-bold uppercase tracking-widest text-gradient">
                  {performerCountry === "CO" ? "Colombia · Only performers" : "Only performers in your region"}
                </p>
              </div>
              <p className="text-[13px] leading-relaxed text-white font-medium">
                The full PNPtv app isn't available here yet — but you can apply to become a performer.
              </p>
              <p className="text-xs text-pnp-textSecondary leading-relaxed">
                Stream, post exclusive content, and keep <span className="text-white font-semibold">80%</span> of everything you earn. Verified performers get full access.
              </p>
              <Link
                to="/become-a-model"
                className="btn-gradient block w-full text-center py-3 rounded-xl text-sm font-bold text-white hover:opacity-90 active:scale-[0.98] transition-all"
              >
                Become a Performer →
              </Link>
              <Link
                to="/apply"
                className="block w-full text-center text-xs text-pnp-textSecondary/80 hover:text-white transition-colors"
              >
                Already have an account? Apply now
              </Link>
            </div>
          )}

          {/* ── PRIMARY CTA: Join PNPtv (email capture → Authentik enrollment) ── */}
          <form onSubmit={handleCreateAccount} noValidate className="w-full space-y-2">
            <div className="glass-card-sm p-4 space-y-3">
              <p className="text-sm font-bold text-white text-center">Join PNPtv today</p>
              <input
                type="email"
                inputMode="email"
                autoComplete="email"
                value={signupEmail}
                onChange={(e) => { setSignupEmail(e.target.value); setSignupEmailError(null); }}
                placeholder="your@email.com"
                aria-label="Email address"
                aria-invalid={!!signupEmailError}
                className="w-full px-3 py-3 rounded-xl text-sm text-white bg-pnp-surface placeholder-pnp-textSecondary/50 focus:outline-none focus:border-pnp-accent transition-colors"
                style={{ border: signupEmailError ? "1px solid #ef4444" : "1px solid rgba(255,255,255,0.1)" }}
              />
              {signupEmailError && (
                <p className="text-xs text-red-400">{signupEmailError}</p>
              )}
              <button
                type="submit"
                className="btn-gradient w-full py-3 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 hover:brightness-110 active:scale-[0.98] transition-all"
              >
                Create my account →
              </button>
              <p className="text-center text-[11px] text-pnp-textSecondary">Free. Takes 30 seconds.</p>
            </div>
          </form>

          {/* Join existing — accordion */}
          <div className="w-full">
            {returningUsername ? (
              <div className="space-y-1.5">
                <button
                  onClick={handleContinueAs}
                  className="w-full py-3.5 rounded-xl text-sm font-semibold text-white border border-white/20 hover:border-white/40 hover:bg-white/5 flex items-center justify-center gap-2 transition-colors"
                >
                  Continue as @{returningUsername}
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                  </svg>
                </button>
                <button
                  onClick={() => { setLoginOpen(v => !v); setLoginView("options"); }}
                  className="w-full text-center text-[11px] text-pnp-textSecondary hover:text-white transition-colors py-1"
                >
                  Not you? Sign in differently {loginOpen ? "▲" : "▼"}
                </button>
              </div>
            ) : (
              <button
                onClick={() => { setLoginOpen(v => !v); setLoginView("options"); }}
                className="w-full py-3.5 rounded-xl text-sm font-semibold text-pnp-textSecondary border border-pnp-border hover:border-white/30 hover:text-white flex items-center justify-center gap-2 transition-colors"
              >
                Already a member? Log in
                <svg className={`w-4 h-4 transition-transform duration-200 ${loginOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            )}

            {/* Accordion body */}
            <div
              className="overflow-hidden transition-all duration-300"
              style={{ maxHeight: loginOpen ? "420px" : "0px", opacity: loginOpen ? 1 : 0 }}
            >
              <div className="glass-card-sm mt-2 p-3 space-y-2">

                {loginView === "options" && (
                  <>
                    {oidcError && (
                      <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20">
                        <svg className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                        </svg>
                        <p className="text-xs text-red-300">
                          {oidcError === "access_denied" ? "Access was denied. Please try again." :
                           oidcError === "session_expired" ? "Session expired. Please try again." :
                           "Sign-in failed. Please try again."}
                        </p>
                        <button onClick={() => setOidcError(null)} className="ml-auto text-red-400 hover:text-red-300">
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    )}
                    <button
                      onClick={() => { window.location.href = "/api/webapp/auth/oidc/login"; }}
                      className="w-full flex items-center justify-center gap-2.5 px-4 py-3 rounded-xl text-sm font-bold text-white transition-all hover:brightness-110 active:scale-[0.98]"
                      style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 flex-shrink-0" aria-hidden="true">
                        <path fillRule="evenodd" d="M12 1.5a5.25 5.25 0 00-5.25 5.25v3a3 3 0 00-3 3v6.75a3 3 0 003 3h10.5a3 3 0 003-3v-6.75a3 3 0 00-3-3v-3c0-2.9-2.35-5.25-5.25-5.25zm3.75 8.25v-3a3.75 3.75 0 10-7.5 0v3h7.5z" clipRule="evenodd" />
                      </svg>
                      Sign in with PNPtv ID
                    </button>

                    <div className="flex items-center gap-3">
                      <div className="flex-1 h-px bg-white/10" />
                      <span className="text-[10px] text-pnp-textSecondary uppercase tracking-widest">or</span>
                      <div className="flex-1 h-px bg-white/10" />
                    </div>

                    <button onClick={() => setLoginView("telegram")} className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-white border border-pnp-border hover:border-white/30 hover:bg-pnp-surface transition-colors">
                      <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor" style={{ color: "#29B6F6" }}>
                        <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.562 8.248l-1.97 9.289c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12L7.062 13.85l-2.946-.924c-.64-.203-.654-.64.136-.953l11.5-4.431c.534-.194 1.001.13.81.706z" />
                      </svg>
                      Continue with Telegram
                    </button>

                    <p className="text-center text-xs text-pnp-textSecondary pt-1">
                      New here?{" "}
                      <a href={ENROLLMENT_FLOW_URL} className="font-semibold underline text-pnp-accent hover:brightness-125 transition-all">
                        Create a PNPtv ID
                      </a>
                    </p>

                    <a
                      href={RECOVERY_FLOW_URL}
                      className="block text-center text-xs text-pnp-textSecondary/70 hover:text-white transition-colors pt-1 underline"
                    >
                      Forgot password?
                    </a>
                  </>
                )}

                {loginView === "telegram" && (
                  <div className="space-y-3">
                    <button onClick={() => setLoginView("options")} className="flex items-center gap-1 text-xs text-pnp-textSecondary hover:text-white transition-colors">
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
                      Back
                    </button>
                    {widgetStatus === "verifying" && (
                      <div className="flex items-center justify-center gap-2 py-3 text-pnp-textSecondary text-sm"><Spinner /> Verifying…</div>
                    )}
                    {widgetStatus === "error" && (
                      <div className="text-center space-y-2">
                        <p className="text-pnp-error text-sm">{widgetError}</p>
                        <button onClick={() => setWidgetStatus("idle")} className="text-xs text-pnp-textSecondary underline">Try again</button>
                      </div>
                    )}
                    {widgetStatus === "idle" && (
                      widgetBlocked ? (
                        <div className="space-y-2">
                          <p className="text-pnp-textSecondary text-xs text-center">Widget blocked — ad blocker?</p>
                          <button onClick={handleDeepLink} className="btn-gradient w-full py-3 rounded-xl text-sm font-bold text-white">
                            Open Telegram App
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <TelegramLoginWidget onAuth={handleWidgetAuth} onLoadError={handleWidgetLoadError} />
                          <button onClick={handleDeepLink} className="w-full text-xs text-pnp-textSecondary hover:text-white transition-colors py-1">
                            Use Telegram app instead →
                          </button>
                        </div>
                      )
                    )}
                  </div>
                )}

              </div>
            </div>
          </div>
        </div>
      </main>

      {/* ── BOTTOM BAR ──────────────────────────────────────────────────────── */}
      <div className="glass-nav border-t border-pnp-border flex-shrink-0">
        {/* Carousel nav */}
        <nav className="overflow-x-auto no-scrollbar" aria-label="Explore PNPtv">
          <div className="flex items-center gap-2 px-4 h-12 w-max">
            {navItems.map(item => (
              <button
                key={item.id}
                onClick={() => setActiveSheet(activeSheet === item.id ? null : item.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all duration-150 flex-shrink-0 border ${
                  activeSheet === item.id
                    ? "btn-gradient border-transparent text-white"
                    : "border-pnp-border text-pnp-textSecondary hover:text-white hover:border-white/30"
                }`}
              >
                <span>{item.emoji}</span>
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        </nav>

        {/* Legal links */}
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-0.5 px-4 py-2 border-t border-pnp-border safe-area-bottom">
          {legalLinks.map(l => (
            <a key={l.href} href={l.href} className="text-[10px] text-pnp-textSecondary/40 hover:text-pnp-textSecondary transition-colors whitespace-nowrap">
              {l.label}
            </a>
          ))}
        </div>
      </div>

      {/* ── BOTTOM SHEET ────────────────────────────────────────────────────── */}
      {sheet && (
        <>
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" onClick={() => setActiveSheet(null)} aria-hidden="true" />
          <div
            className="fixed bottom-0 left-0 right-0 z-50 glass-nav border-t border-pnp-border rounded-t-2xl overflow-y-auto animate-fade-in-up"
            style={{ maxHeight: "70dvh", animationDuration: "0.2s" }}
            role="dialog"
            aria-label={sheet.title}
          >
            {/* Handle */}
            <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
              <div className="w-10 h-1 rounded-full bg-pnp-border" />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-pnp-border sticky top-0 glass-nav">
              <div className="flex items-center gap-2">
                <span className="text-xl">{sheet.emoji}</span>
                <h2 className="text-sm font-bold text-white">{sheet.title}</h2>
              </div>
              <button onClick={() => setActiveSheet(null)} className="p-1.5 rounded-lg text-pnp-textSecondary hover:text-white hover:bg-pnp-surface transition-colors" aria-label="Close">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Content */}
            <div className="px-4 py-4">{sheet.body}</div>

            {/* CTA */}
            <div className="px-4 pb-6">
              <Link to="/join" onClick={() => setActiveSheet(null)} className="btn-gradient block w-full text-center py-3 rounded-xl text-sm font-bold text-white">
                Join free →
              </Link>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default LandingPage;
