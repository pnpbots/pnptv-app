import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useSearchParams, useNavigate, Link } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { useAuth } from "@/hooks/useAuth";
import { isTelegramContext } from "@/lib/telegram";
import {
  createPayment,
  createDashSubscription,
  getDashSubscriptionStatus,
  getDashAvailable,
  getDashPaymentDetails,
  prepareUsdcSubscription,
  getUsdcSubscriptionStatus,
  getUsdcAvailable,
  assertPaymentUrl,
  ApiError,
} from "@/lib/api";

// ── Bilingual strings ──────────────────────────────────────────────────────────

type Lang = "en" | "es";

const S = {
  en: {
    pageTitle: "Lifetime PRIME — $80 Crypto — PNPtv!",
    heroTitle: "Lifetime PRIME",
    heroSubtitle: "Pay once. Full PRIME forever. Crypto only.",
    oldPrice: "$250",
    badge: "CRYPTO EXCLUSIVE · $80 FLAT",
    benefits: [
      "Pay once — full PRIME access forever, no renewals ever.",
      "PRIME unlocked permanently — all exclusive content from day one.",
      "Everything: Live, Hangouts, Feed, DMs, Nearby, and more.",
      "Private sessions with creators + founding member status.",
      "Priority support, always.",
    ],
    noticeTitle: "Good to know",
    noticeCryptoOnly: "This offer is exclusively available via Dash or USDC crypto.",
    noticeEarlyAccess: "You lock in lifetime PRIME — permanent, no renewals, ever.",
    noticeInProgress: "Some screens still in progress — we're moving fast.",
    alreadyPaid: "Need help?",
    alreadyPaidLink: "Contact support",
    fineprint: "🔒 Encrypted · Discreet · No personal info required · Price in USD",
  },
  es: {
    pageTitle: "Lifetime PRIME — $80 Cripto — PNPtv!",
    heroTitle: "Lifetime PRIME",
    heroSubtitle: "Paga una vez. PRIME completo para siempre. Solo cripto.",
    oldPrice: "$250",
    badge: "EXCLUSIVO CRIPTO · $80 FIJO",
    benefits: [
      "Paga una vez — acceso PRIME completo para siempre, sin renovaciones.",
      "PRIME desbloqueado permanentemente — todo el contenido exclusivo desde el primer día.",
      "Todo: Live, Hangouts, Feed, DMs, Nearby y más.",
      "Sesiones privadas con creadores + estatus de miembro fundador.",
      "Soporte prioritario, siempre.",
    ],
    noticeTitle: "Bueno saber",
    noticeCryptoOnly: "Esta oferta está disponible exclusivamente vía Dash o USDC cripto.",
    noticeEarlyAccess: "Aseguras PRIME de por vida — permanente, sin renovaciones, nunca.",
    noticeInProgress: "Algunas pantallas aún en progreso — avanzando rápido.",
    alreadyPaid: "¿Necesitas ayuda?",
    alreadyPaidLink: "Contacta soporte",
    fineprint: "🔒 Encriptado · Discreto · Sin datos personales requeridos · Precio en USD",
  },
} satisfies Record<Lang, object>;

// ── Sheet strings ──────────────────────────────────────────────────────────────

type SheetStrings = {
  about: { title: string; lead: string; leadEmphasis: string; cards: Array<{ e: string; t: string; b: string }> };
  feed: { title: string; eyebrow: string; p1: string; p1Emphasis: string; p2: string };
  hangouts: { title: string; eyebrow: string; p1: string; p2Emphasis: string };
  live: { title: string; eyebrow: string; p1: string; p2Emphasis: string };
  nearby: { title: string; eyebrow: string; p1: string; p1Emphasis: string; p2: string; p2Emphasis: string };
  creators: { title: string; lead: string; leadEmphasis: string; stats: Array<{ v: string; l: string }>; cta: string };
  payments: { title: string; lead: string; cards: Array<{ e: string; t: string; b: string }>; fineprint: string };
  safety: { title: string; lead: string; checks: string[]; cta: string };
};

const SHEET_STRINGS: Record<Lang, SheetStrings> = {
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
      lead: "Two crypto options — both at $80 flat.",
      cards: [
        { e: "🥷", t: "Dash (BTCPay)", b: "Send Dash from your wallet. Near-instant, no name, no bank." },
        { e: "🪙", t: "USDC (NowPayments)", b: "Pay with USDC stablecoin. Hosted checkout, auto-confirmed." },
      ],
      fineprint: "🔒 Encrypted · Discreet · No card stored",
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
      lead: "Una red social privada hecha para la comunidad queer PNP. Publica, chatea, transmite, conoce gente cerca — sin juicios, sin algoritmos, sin censura.",
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
      p2: "Los creadores pueden publicar contenido exclusivo solo para sus suscriptores.",
    },
    hangouts: {
      title: "Hangouts",
      eyebrow: "Como Discord — pero más simple",
      p1: "Crea un Hangout, invita a los tuyos, entra a videollamada grupal o solo voz. Salas públicas o privadas con contraseña.",
      p2Emphasis: "Sin bots. Sin configurar servidor. Sin 47 canales que nunca usarás.",
    },
    live: {
      title: "Live",
      eyebrow: "Como Chaturbate — pero en la nube ☁️",
      p1: "Transmite directo desde tu navegador o usa OBS con una clave de stream. Tus seguidores reciben aviso al instante, chatean en tiempo real y te dan propinas directo.",
      p2Emphasis: "Sin strikes. Sin suspensiones. Sin policías de contenido.",
    },
    nearby: {
      title: "Nearby",
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
      cta: "Conviértete en Creador →",
    },
    payments: {
      title: "Pagos",
      lead: "Dos opciones cripto — ambas a $80 fijo.",
      cards: [
        { e: "🥷", t: "Dash (BTCPay)", b: "Envía Dash desde tu wallet. Casi instantáneo, sin nombre, sin banco." },
        { e: "🪙", t: "USDC (NowPayments)", b: "Paga con USDC stablecoin. Checkout alojado, confirmación automática." },
      ],
      fineprint: "🔒 Encriptado · Discreto · No guardamos tarjeta",
    },
    safety: {
      title: "Seguridad primero",
      lead: "Nos tomamos la seguridad en serio. Este es tu espacio y lo protegemos.",
      checks: [
        "Verificación de edad e identidad para todos los miembros",
        "Moderación humana — personas reales revisando los reportes",
        "DMs encriptados",
        "Herramientas para bloquear, silenciar y reportar en cada publicación",
        "Recursos de reducción de daños y reglas de comunidad",
      ],
      cta: "Aprende más →",
    },
  },
};

function makeSheets(lang: string): Record<string, { title: string; emoji: string; body: React.ReactNode }> {
  const ss = SHEET_STRINGS[lang === "es" ? "es" : "en"];
  return {
    about: {
      title: ss.about.title, emoji: "👋",
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
      title: ss.feed.title, emoji: "📣",
      body: (
        <div className="space-y-3">
          <p className="text-xs font-bold uppercase tracking-widest text-gradient">{ss.feed.eyebrow}</p>
          <p className="text-pnp-textSecondary text-sm leading-relaxed">
            {ss.feed.p1} <span className="text-white font-medium">{ss.feed.p1Emphasis}</span>
          </p>
          <p className="text-pnp-textSecondary text-sm leading-relaxed">{ss.feed.p2}</p>
        </div>
      ),
    },
    hangouts: {
      title: ss.hangouts.title, emoji: "🎙️",
      body: (
        <div className="space-y-3">
          <p className="text-xs font-bold uppercase tracking-widest text-gradient">{ss.hangouts.eyebrow}</p>
          <p className="text-pnp-textSecondary text-sm leading-relaxed">{ss.hangouts.p1}</p>
          <p className="text-pnp-textSecondary text-sm leading-relaxed">
            <span className="text-white font-medium">{ss.hangouts.p2Emphasis}</span>
          </p>
        </div>
      ),
    },
    live: {
      title: ss.live.title, emoji: "🔴",
      body: (
        <div className="space-y-3">
          <p className="text-xs font-bold uppercase tracking-widest text-gradient">{ss.live.eyebrow}</p>
          <p className="text-pnp-textSecondary text-sm leading-relaxed">{ss.live.p1}</p>
          <p className="text-pnp-textSecondary text-sm leading-relaxed">
            <span className="text-white font-medium">{ss.live.p2Emphasis}</span>
          </p>
        </div>
      ),
    },
    nearby: {
      title: ss.nearby.title, emoji: "📍",
      body: (
        <div className="space-y-3">
          <p className="text-xs font-bold uppercase tracking-widest text-gradient">{ss.nearby.eyebrow}</p>
          <p className="text-pnp-textSecondary text-sm leading-relaxed">
            {ss.nearby.p1}<span className="text-white font-medium"> {ss.nearby.p1Emphasis}</span>
          </p>
          <p className="text-pnp-textSecondary text-sm leading-relaxed">
            {ss.nearby.p2} <span className="text-white font-medium">{ss.nearby.p2Emphasis}</span>
          </p>
        </div>
      ),
    },
    creators: {
      title: ss.creators.title, emoji: "💰",
      body: (
        <div className="space-y-3">
          <p className="text-pnp-textSecondary text-sm leading-relaxed">
            {ss.creators.lead}<span className="text-white font-medium"> {ss.creators.leadEmphasis}</span>
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
      title: ss.payments.title, emoji: "💳",
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
      title: ss.safety.title, emoji: "🛡️",
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

// ── Constants ──────────────────────────────────────────────────────────────────

const PLAN_ID = "lifetime80";
const LANG_KEY = "pnptv:lifetime80:lang";

// ── Helpers ────────────────────────────────────────────────────────────────────

function getInitialLang(): Lang {
  try {
    const stored = localStorage.getItem(LANG_KEY);
    if (stored === "en" || stored === "es") return stored;
  } catch { /* ignore */ }
  return typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("en") ? "en" : "es";
}

function persistLang(lang: Lang): void {
  try { localStorage.setItem(LANG_KEY, lang); } catch { /* ignore */ }
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function Spinner({ size = 18 }: { size?: number }) {
  return (
    <svg className="animate-spin" style={{ width: size, height: size }} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

function DiamondIcon({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ width: 20, height: 20, flexShrink: 0, marginTop: 2 }}>
      <path d="M12 2L2 12L12 22L22 12L12 2Z" fill={color} />
    </svg>
  );
}

function LangToggle({ lang, onChange }: { lang: Lang; onChange: (l: Lang) => void }) {
  const isEn = lang === "en";
  const btnBase: React.CSSProperties = { background: "none", border: "none", padding: "6px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer", borderRadius: 18, transition: "all 0.2s ease", minHeight: 36, minWidth: 44 };
  return (
    <div style={{ display: "flex", background: "rgba(255,255,255,0.10)", borderRadius: 20, padding: 2 }} role="group" aria-label="Language toggle">
      <button onClick={() => onChange("en")} style={{ ...btnBase, background: isEn ? "#ffffff" : "transparent", color: isEn ? "#120d14" : "#8E8E93" }} aria-pressed={isEn}>EN</button>
      <button onClick={() => onChange("es")} style={{ ...btnBase, background: !isEn ? "#ffffff" : "transparent", color: !isEn ? "#120d14" : "#8E8E93" }} aria-pressed={!isEn}>ES</button>
    </div>
  );
}

// ── Nav footer ─────────────────────────────────────────────────────────────────

const NAV_ITEMS = [
  { id: "about",    emoji: "👋", label: "About" },
  { id: "feed",     emoji: "📣", label: "Feed" },
  { id: "hangouts", emoji: "🎙️", label: "Hangouts" },
  { id: "live",     emoji: "🔴", label: "Live" },
  { id: "nearby",   emoji: "📍", label: "Connect" },
  { id: "creators", emoji: "💰", label: "Creators" },
  { id: "payments", emoji: "💳", label: "Payments" },
  { id: "safety",   emoji: "🛡️", label: "Safety" },
] as const;

const LEGAL_LINKS = [
  { label: "Terms", href: "/terms" },
  { label: "Privacy", href: "/privacy" },
  { label: "Cookies", href: "/cookies" },
  { label: "Content Policy", href: "/content-policy" },
  { label: "DMCA", href: "/dmca" },
  { label: "Refunds", href: "/refunds" },
  { label: "Contact", href: "/contact" },
];

function NavFooter({ onOpenSheet }: { onOpenSheet: (id: string) => void }) {
  return (
    <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 40, background: "rgba(18, 13, 20, 0.92)", backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
      <nav style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }} aria-label="Explore PNPtv">
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 16px", height: 48, width: "max-content" }}>
          {NAV_ITEMS.map((item) => (
            <button key={item.id} type="button" onClick={() => onOpenSheet(item.id)}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 9999, fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", border: "1px solid rgba(255,255,255,0.12)", color: "#cfcfd4", cursor: "pointer", flexShrink: 0, background: "transparent", transition: "color 0.15s, border-color 0.15s" }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "#ffffff"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.3)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "#cfcfd4"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.12)"; }}
            >
              <span>{item.emoji}</span><span>{item.label}</span>
            </button>
          ))}
        </div>
      </nav>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "center", columnGap: 12, rowGap: 2, padding: "8px 16px", borderTop: "1px solid rgba(255,255,255,0.08)", paddingBottom: "max(8px, env(safe-area-inset-bottom))" }}>
        {LEGAL_LINKS.map((l) => (
          <a key={l.href} href={l.href}
            style={{ fontSize: 10, color: "rgba(207,207,212,0.4)", textDecoration: "none", whiteSpace: "nowrap", transition: "color 0.15s" }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "#cfcfd4"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "rgba(207,207,212,0.4)"; }}
          >{l.label}</a>
        ))}
      </div>
    </div>
  );
}

// ── Sheet modal ────────────────────────────────────────────────────────────────

function SheetModal({ sheet, onClose }: { sheet: { title: string; emoji: string; body: React.ReactNode }; onClose: () => void }) {
  return (
    <>
      <div className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div className="fixed bottom-0 left-0 right-0 z-[60] glass-nav border-t border-pnp-border rounded-t-2xl overflow-y-auto animate-fade-in-up" style={{ maxHeight: "70dvh", animationDuration: "0.2s" }} role="dialog" aria-label={sheet.title}>
        <div className="flex justify-center pt-3 pb-1 flex-shrink-0"><div className="w-10 h-1 rounded-full bg-pnp-border" /></div>
        <div className="flex items-center justify-between px-4 py-3 border-b border-pnp-border sticky top-0 glass-nav">
          <div className="flex items-center gap-2">
            <span className="text-xl">{sheet.emoji}</span>
            <h2 className="text-sm font-bold text-white">{sheet.title}</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-pnp-textSecondary hover:text-white hover:bg-pnp-surface transition-colors" aria-label="Close">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="px-4 py-4">{sheet.body}</div>
        <div className="px-4 pb-6">
          <Link to="/join" onClick={onClose} className="btn-gradient block w-full text-center py-3 rounded-xl text-sm font-bold text-white">Join free →</Link>
        </div>
      </div>
    </>
  );
}

// ── Payment types ──────────────────────────────────────────────────────────────

type PayMethod = "epayco" | "dash" | "usdc";

type DashInvoice = {
  invoiceId: string;
  checkoutUrl: string;
  planName: string;
  destination?: string;
  amount?: string;
  invoiceAmount?: number | null;
  loadingDetails?: boolean;
  detailsError?: string;
  createdAt: number;
};

// ── Hero view ──────────────────────────────────────────────────────────────────

function HeroView({ lang, onLangChange, onOpenSheet }: { lang: Lang; onLangChange: (l: Lang) => void; onOpenSheet: (id: string) => void }) {
  const { user, refreshUser } = useAuth();
  const [searchParams] = useSearchParams();
  const s = S[lang];
  const es = lang === "es";

  const [payMethod, setPayMethod] = useState<PayMethod>("epayco");
  const [submitting, setSubmitting] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [paymentSuccess, setPaymentSuccess] = useState(false);

  // Dash state
  const [dashAvailable, setDashAvailable] = useState<boolean | null>(null);
  const [dashInvoice, setDashInvoice] = useState<DashInvoice | null>(null);
  const [dashPolling, setDashPolling] = useState(false);
  const [dashCopied, setDashCopied] = useState(false);
  const [dashSecondsLeft, setDashSecondsLeft] = useState(900);
  const [dashPaymentSuccess, setDashPaymentSuccess] = useState(false);
  const dashCountdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const invoiceRef = useRef<HTMLDivElement>(null);

  // USDC state
  const [usdcAvailable, setUsdcAvailable] = useState<boolean | null>(null);
  const [pollingUsdcOrderId, setPollingUsdcOrderId] = useState<string | null>(null);
  const [usdcConfirming, setUsdcConfirming] = useState(false);

  // Init: check availability + resume pending USDC order
  useEffect(() => {
    getDashAvailable()
      .then((r) => setDashAvailable(r.available === true && r.configured === true))
      .catch(() => setDashAvailable(false));
    getUsdcAvailable()
      .then((r) => setUsdcAvailable(r.available === true && r.configured === true))
      .catch(() => setUsdcAvailable(false));
    try {
      const pending = sessionStorage.getItem("pnp_pending_usdc_order_lt80");
      if (pending) { sessionStorage.removeItem("pnp_pending_usdc_order_lt80"); setPollingUsdcOrderId(pending); }
    } catch { /* ignore */ }
  }, []);

  // Resume USDC polling (order opened in external tab)
  useEffect(() => {
    if (searchParams.get("usdc_paid") !== "1") return;
    window.history.replaceState({}, "", window.location.pathname);
    setPaymentSuccess(true);
    refreshUser().catch(() => {});
  }, [searchParams, refreshUser]);

  // USDC order polling
  useEffect(() => {
    if (!pollingUsdcOrderId) return;
    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 120;
    let timerId: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      if (cancelled || attempts >= maxAttempts) {
        if (attempts >= maxAttempts) {
          setPollingUsdcOrderId(null);
          setPayError(es ? "Tiempo de espera agotado. Contacta soporte si completaste el pago." : "Payment check timed out. Contact support if you completed payment.");
        }
        return;
      }
      attempts++;
      try {
        const data = await getUsdcSubscriptionStatus(pollingUsdcOrderId);
        if (cancelled) return;
        if (data.completed) {
          setPollingUsdcOrderId(null);
          setPaymentSuccess(true);
          await refreshUser();
          return;
        }
        if (data.confirming) setUsdcConfirming(true);
        if (data.failed) {
          setPollingUsdcOrderId(null);
          setPayError(es ? "Pago USDC fallido. Intenta de nuevo." : "USDC payment failed. Please try again.");
          return;
        }
        if (!cancelled) timerId = setTimeout(poll, 5000);
      } catch { if (!cancelled) timerId = setTimeout(poll, 8000); }
    };
    poll();
    return () => { cancelled = true; if (timerId) clearTimeout(timerId); };
  }, [pollingUsdcOrderId, refreshUser, es]);

  // Dash invoice polling
  useEffect(() => {
    if (!dashInvoice || !dashPolling) return;
    let cancelled = false;
    let attempts = 0;
    const startedAt = Date.now();
    let timerId: ReturnType<typeof setTimeout> | null = null;
    const nextDelay = (n: number) => Math.min(5000 + Math.floor(n / 5) * 3000, 12000);
    const poll = async () => {
      if (cancelled) return;
      if (Date.now() - startedAt >= 15 * 60 * 1000) { setDashPolling(false); return; }
      attempts++;
      try {
        const data = await getDashSubscriptionStatus(dashInvoice.invoiceId);
        if (cancelled) return;
        if (data.status === "completed") {
          setDashPolling(false); setDashPaymentSuccess(true);
          try { sessionStorage.removeItem("pnp_pending_dash_invoice_lt80"); } catch { /* ignore */ }
          await refreshUser();
          timerId = setTimeout(() => { setDashInvoice(null); setDashPaymentSuccess(false); setPaymentSuccess(true); }, 2000);
          return;
        }
        if (data.status === "expired" || data.status === "invalid") {
          setDashPolling(false);
          try { sessionStorage.removeItem("pnp_pending_dash_invoice_lt80"); } catch { /* ignore */ }
          setPayError(es ? "Factura Dash expirada. Intenta de nuevo." : "Dash invoice expired. Please try again.");
          return;
        }
        if (!cancelled) timerId = setTimeout(poll, nextDelay(attempts));
      } catch { if (!cancelled) timerId = setTimeout(poll, nextDelay(attempts)); }
    };
    poll();
    return () => { cancelled = true; if (timerId) clearTimeout(timerId); };
  }, [dashInvoice, dashPolling, refreshUser, es]);

  // Dash countdown
  useEffect(() => {
    if (!dashInvoice || !dashPolling) {
      if (dashCountdownRef.current) { clearInterval(dashCountdownRef.current); dashCountdownRef.current = null; }
      return;
    }
    const tick = () => {
      const remaining = Math.max(0, 900 - Math.floor((Date.now() - dashInvoice.createdAt) / 1000));
      setDashSecondsLeft(remaining);
      if (remaining === 0) { if (dashCountdownRef.current) { clearInterval(dashCountdownRef.current); dashCountdownRef.current = null; } setDashPolling(false); }
    };
    tick();
    dashCountdownRef.current = setInterval(tick, 1000);
    return () => { if (dashCountdownRef.current) { clearInterval(dashCountdownRef.current); dashCountdownRef.current = null; } };
  }, [dashInvoice, dashPolling]);

  useEffect(() => {
    if (dashInvoice) setTimeout(() => invoiceRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 100);
  }, [!!dashInvoice]); // eslint-disable-line react-hooks/exhaustive-deps

  function cancelDash() {
    setDashInvoice(null); setDashPolling(false); setDashCopied(false); setDashSecondsLeft(900); setDashPaymentSuccess(false);
  }

  const handlePay = useCallback(async () => {
    if (!user) { window.location.href = `/login?returnTo=${encodeURIComponent("/lifetime80")}`; return; }
    if (submitting || (payMethod === "dash" && dashInvoice)) return;
    setSubmitting(true); setPayError(null);
    try {
      if (payMethod === "epayco") {
        const result = await createPayment("lifetime80", "epayco");
        if (result.success && result.paymentUrl) {
          window.location.href = result.paymentUrl;
        } else {
          setPayError(result.error || (es ? "No se pudo iniciar el pago." : "Failed to initiate payment."));
        }
        return;
      } else if (payMethod === "dash") {
        const result = await createDashSubscription(PLAN_ID);
        if (result.success && result.checkoutUrl) {
          const invoice: DashInvoice = { invoiceId: result.invoiceId, checkoutUrl: assertPaymentUrl(result.checkoutUrl), planName: result.planName || "Lifetime Prime $80", loadingDetails: true, createdAt: Date.now() };
          setDashInvoice(invoice); setDashSecondsLeft(900); setDashPolling(true);
          try { sessionStorage.setItem("pnp_pending_dash_invoice_lt80", JSON.stringify({ invoiceId: result.invoiceId, createdAt: invoice.createdAt })); } catch { /* ignore */ }
          getDashPaymentDetails(result.invoiceId)
            .then((d) => {
              if (d.success) setDashInvoice((prev) => prev ? { ...prev, destination: d.destination, amount: d.amount, invoiceAmount: d.invoiceAmount, loadingDetails: false } : prev);
              else setDashInvoice((prev) => prev ? { ...prev, loadingDetails: false, detailsError: es ? "No se pudieron cargar los detalles." : "Could not load payment details." } : prev);
            })
            .catch(() => setDashInvoice((prev) => prev ? { ...prev, loadingDetails: false, detailsError: es ? "No se pudieron cargar los detalles." : "Could not load payment details." } : prev));
        } else {
          setPayError(es ? "No se pudo crear la factura Dash." : "Failed to create Dash invoice. Please try again.");
        }
      } else {
        // USDC: open hosted NowPayments checkout
        const result = await prepareUsdcSubscription(PLAN_ID);
        if (result.success && result.invoiceUrl) {
          const safeUrl = assertPaymentUrl(result.invoiceUrl);
          try { sessionStorage.setItem("pnp_pending_usdc_order_lt80", result.orderId); } catch { /* ignore */ }
          setPollingUsdcOrderId(result.orderId);
          if (isTelegramContext()) { window.Telegram!.WebApp.openLink(safeUrl); }
          else {
            const win = window.open(safeUrl, "_blank", "noopener,noreferrer");
            if (win === null) { setPayError(es ? "Popup bloqueado — abriendo en esta pestaña..." : "Popup blocked — opening checkout in this tab…"); window.location.href = safeUrl; }
          }
        } else {
          setPayError(result.error || (es ? "No se pudo iniciar el pago USDC." : "Failed to create USDC payment."));
        }
      }
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        if (err.code === "BTCPAY_NOT_CONFIGURED") setPayError(es ? "Pagos Dash no configurados." : "Dash payments not configured.");
        else if (err.code === "BTCPAY_UNREACHABLE") setPayError(es ? "Servidor Dash no disponible." : "Dash payment server unavailable.");
        else setPayError(err.message || (es ? "Error de pago." : "Payment error."));
      } else { setPayError(err instanceof Error ? err.message : (es ? "Error inesperado." : "Unexpected error.")); }
    } finally { setSubmitting(false); }
  }, [user, submitting, payMethod, dashInvoice, es]);

  const handleCtaClick = () => {
    if (payMethod === "dash" && dashInvoice) { cancelDash(); return; }
    handlePay();
  };

  const dashUnavailable = dashAvailable === false;
  const usdcUnavailable = usdcAvailable === false;
  const ctaDisabled = submitting || (payMethod === "dash" && dashUnavailable) || (payMethod === "usdc" && usdcUnavailable) || !!pollingUsdcOrderId;

  const ctaLabel = (() => {
    if (submitting) return es ? "Procesando…" : "Processing…";
    if (payMethod === "epayco") {
      if (!user) return es ? "Iniciar sesión para pagar" : "Log in to pay";
      return es ? "Pagar con Tarjeta — $80" : "Pay with Card — $80";
    }
    if (payMethod === "dash") {
      if (dashUnavailable) return es ? "Dash no disponible" : "Dash unavailable";
      if (dashInvoice) return es ? "Cancelar Dash" : "Cancel Dash";
      if (!user) return es ? "Iniciar sesión para pagar" : "Log in to pay";
      return es ? "Pagar con Dash — $80" : "Pay with Dash — $80";
    }
    if (pollingUsdcOrderId) return usdcConfirming ? (es ? "Confirmando pago…" : "Confirming payment…") : (es ? "Esperando confirmación…" : "Waiting for confirmation…");
    if (usdcUnavailable) return es ? "USDC no disponible" : "USDC unavailable";
    if (!user) return es ? "Iniciar sesión para pagar" : "Log in to pay";
    return es ? "Pagar con USDC — $80" : "Pay with USDC — $80";
  })();

  // Success screen
  if (paymentSuccess) {
    return (
      <div style={{ minHeight: "100vh", background: "var(--pnp-background)", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px 16px" }}>
        <div style={{ maxWidth: 400, width: "100%", textAlign: "center" }}>
          <div style={{ width: 80, height: 80, borderRadius: "50%", background: "rgba(255,153,51,0.15)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px" }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none">
              <path d="M5 13l4 4L19 7" stroke="#ff9933" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <h2 style={{ margin: "0 0 12px", fontSize: 26, fontWeight: 900, color: "#ffffff" }}>
            {es ? "¡Bienvenido, miembro! 🎉" : "Welcome, Member! 🎉"}
          </h2>
          <p style={{ margin: "0 0 8px", fontSize: 15, color: "var(--pnp-text-secondary)" }}>
            {es ? "Tu Lifetime PRIME está activo." : "Your Lifetime PRIME is now active."}
          </p>
          <p style={{ margin: "0 0 32px", fontSize: 13, color: "var(--pnp-text-secondary)" }}>
            {es ? "Acceso PRIME permanente — sin renovaciones, nunca." : "Permanent PRIME access — no renewals, ever."}
          </p>
          <button onClick={() => { window.location.href = "/welcome"; }} style={{ padding: "16px 32px", borderRadius: 14, border: "none", background: "linear-gradient(90deg, #ff3377, #ff9933)", color: "#ffffff", fontSize: 15, fontWeight: 800, cursor: "pointer", width: "100%" }}>
            {es ? "Entrar a PNPtv!" : "Enter PNPtv!"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "var(--pnp-background)", color: "#ffffff", display: "flex", flexDirection: "column", overflowX: "hidden", paddingBottom: 300 }}>
      {/* Ambient glow */}
      <div aria-hidden="true" style={{ position: "fixed", top: "-20%", left: "50%", transform: "translateX(-50%)", width: "100vw", height: "100vw", background: "radial-gradient(circle, rgba(38,161,123,0.12) 0%, transparent 70%)", pointerEvents: "none", zIndex: 0 }} />

      {/* Header */}
      <header style={{ position: "relative", zIndex: 1, display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 24px" }}>
        <a href="/" aria-label="PNPtv! home" style={{ display: "flex" }}>
          <img src="/logo-header.png" alt="PNPtv!" style={{ height: 36, width: "auto" }} />
        </a>
        <LangToggle lang={lang} onChange={onLangChange} />
      </header>

      {/* Content */}
      <div style={{ position: "relative", zIndex: 1, width: "100%", maxWidth: 500, margin: "0 auto", padding: "0 16px" }}>

        {/* Hero */}
        <section style={{ textAlign: "center", padding: "12px 8px 20px" }}>
          <h1 style={{ fontSize: "clamp(24px, 6vw, 32px)", fontWeight: 900, lineHeight: 1.1, margin: "0 0 10px", textTransform: "uppercase" }}>
            {s.heroTitle}
          </h1>
          <p style={{ color: "var(--pnp-text-secondary)", fontSize: 15, margin: 0 }}>{s.heroSubtitle}</p>
        </section>

        {/* Pricing glass card */}
        <div style={{ background: "rgba(44,44,46,0.7)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", border: "1px solid rgba(38,161,123,0.40)", borderRadius: 24, padding: "28px 24px", marginBottom: 16, position: "relative", overflow: "hidden", boxShadow: "0 20px 40px rgba(0,0,0,0.5)" }}>
          <div aria-hidden="true" style={{ position: "absolute", top: 0, left: 0, width: "100%", height: 4, background: "linear-gradient(90deg, #26a17b, #008DE4)" }} />
          <span style={{ display: "block", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.15em", color: "#26a17b", fontWeight: 700, marginBottom: 14 }}>
            {s.badge}
          </span>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 20 }}>
            <span style={{ fontSize: 20, color: "#636366", textDecoration: "line-through", fontWeight: 600, marginBottom: 4 }}>{s.oldPrice}</span>
            <div style={{ fontSize: "clamp(56px, 15vw, 72px)", fontWeight: 900, lineHeight: 1, color: "#26a17b", textShadow: "0 0 30px rgba(38,161,123,0.4)", display: "flex", alignItems: "flex-start" }}>
              <span style={{ fontSize: "0.36em", marginTop: "0.55em", opacity: 0.8 }}>$</span>
              <span>80</span>
            </div>
            <span style={{ fontSize: 13, color: "#26a17b", fontWeight: 600, marginTop: 4 }}>🪙 {es ? "Cripto únicamente" : "Crypto only"}</span>
          </div>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, textAlign: "left" }}>
            {s.benefits.map((benefit, i) => (
              <li key={i} style={{ display: "flex", alignItems: "flex-start", marginBottom: 14, fontSize: 14, lineHeight: 1.4, color: "rgba(255,255,255,0.9)", gap: 12 }}>
                <DiamondIcon color="#26a17b" />
                <span>{benefit}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Notice card */}
        <div role="note" style={{ margin: "0 0 16px", padding: "18px 20px", borderRadius: 24, border: "1px solid rgba(38,161,123,0.45)", background: "linear-gradient(135deg, rgba(38,161,123,0.10), rgba(0,141,228,0.06))", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)" }}>
          <p style={{ margin: "0 0 12px", fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#26a17b" }}>{s.noticeTitle}</p>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.55, color: "#d6d6dc", listStyleType: "disc" }}>
            <li style={{ marginBottom: 8 }}>{s.noticeCryptoOnly}</li>
            <li style={{ marginBottom: 8 }}>{s.noticeEarlyAccess}</li>
            <li>{s.noticeInProgress}</li>
          </ul>
        </div>

        {/* Separator */}
        <div aria-hidden="true" style={{ display: "flex", justifyContent: "center", gap: 4, margin: "20px 0", opacity: 0.5 }}>
          <span style={{ color: "#26a17b" }}>⬥</span>
          <span style={{ color: "var(--pnp-text-secondary)" }}>⬥</span>
          <span style={{ color: "#008DE4" }}>⬥</span>
        </div>

        {/* Dash invoice widget */}
        {dashInvoice && (
          <div ref={invoiceRef} style={{ marginBottom: 20, padding: "20px 16px", borderRadius: 20, border: "1px solid rgba(0,141,228,0.40)", background: "rgba(0,141,228,0.06)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#008DE4", animation: "lt80-pulse 1.5s ease-in-out infinite" }} />
              <span style={{ fontSize: 14, fontWeight: 600, color: "#ffffff" }}>{es ? "Esperando pago Dash…" : "Waiting for Dash payment…"}</span>
            </div>
            {dashInvoice.loadingDetails ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "24px 0", gap: 10 }}>
                <Spinner size={24} />
                <p style={{ margin: 0, fontSize: 12, color: "var(--pnp-text-secondary)" }}>{es ? "Cargando detalles…" : "Loading details…"}</p>
              </div>
            ) : dashPaymentSuccess ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "24px 0" }}>
                <div style={{ width: 56, height: 56, borderRadius: "50%", background: "rgba(52,199,89,0.20)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="#34C759" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </div>
                <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "#34C759" }}>{es ? "¡Pago recibido!" : "Payment received!"}</p>
              </div>
            ) : dashSecondsLeft === 0 ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: "20px 0" }}>
                <p style={{ margin: 0, fontSize: 14, color: "#FF453A", fontWeight: 600 }}>{es ? "Factura expirada." : "Invoice expired."}</p>
                <button onClick={cancelDash} style={{ padding: "10px 20px", borderRadius: 10, border: "none", background: "#008DE4", color: "#ffffff", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>{es ? "Reintentar" : "Try again"}</button>
              </div>
            ) : dashInvoice.destination && dashInvoice.amount ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
                <div style={{ background: "#ffffff", padding: 12, borderRadius: 16 }}>
                  <QRCodeSVG value={`dash:${dashInvoice.destination}?amount=${dashInvoice.amount}`} size={176} level="M" />
                </div>
                <p style={{ margin: 0, fontSize: 11, color: "var(--pnp-text-secondary)" }}>{es ? "Escanea con tu wallet Dash" : "Scan with your Dash wallet"}</p>
                <div style={{ textAlign: "center" }}>
                  <p style={{ margin: "0 0 4px", fontSize: 12, color: "var(--pnp-text-secondary)" }}>{es ? "Monto a pagar" : "Amount due"}</p>
                  <p style={{ margin: 0, fontSize: 24, fontWeight: 900, color: "#ffffff" }}>{dashInvoice.amount} DASH</p>
                  {dashInvoice.invoiceAmount != null && <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--pnp-text-secondary)" }}>~${dashInvoice.invoiceAmount.toFixed(2)} USD</p>}
                </div>
                <p style={{ margin: 0, fontSize: 13, fontFamily: "monospace", fontWeight: 600, color: dashSecondsLeft <= 60 ? "#FF453A" : dashSecondsLeft <= 300 ? "#FF9F0A" : "var(--pnp-text-secondary)" }}>
                  {String(Math.floor(dashSecondsLeft / 60)).padStart(2, "0")}:{String(dashSecondsLeft % 60).padStart(2, "0")} {es ? "restantes" : "remaining"}
                </p>
                <div style={{ width: "100%" }}>
                  <p style={{ margin: "0 0 6px", fontSize: 11, color: "var(--pnp-text-secondary)" }}>{es ? "Enviar a" : "Send to"}</p>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderRadius: 10, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.10)" }}>
                    <code style={{ flex: 1, fontSize: 11, color: "rgba(255,255,255,0.80)", wordBreak: "break-all", fontFamily: "monospace" }}>{dashInvoice.destination}</code>
                    <button onClick={() => { navigator.clipboard.writeText(dashInvoice.destination!).catch(() => {}); setDashCopied(true); setTimeout(() => setDashCopied(false), 2000); }} style={{ flexShrink: 0, fontSize: 11, fontWeight: 700, color: dashCopied ? "#34C759" : "#008DE4", background: "none", border: "none", cursor: "pointer", padding: "4px 6px" }}>
                      {dashCopied ? (es ? "Copiado" : "Copied") : (es ? "Copiar" : "Copy")}
                    </button>
                  </div>
                </div>
                <a href={dashInvoice.checkoutUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: "#008DE4", textDecoration: "underline" }}>{es ? "Abrir en BTCPay →" : "Open in BTCPay →"}</a>
              </div>
            ) : (
              <div style={{ textAlign: "center" }}>
                <p style={{ margin: "0 0 12px", fontSize: 12, color: "var(--pnp-text-secondary)" }}>{dashInvoice.detailsError || (es ? "Abre el checkout externo para completar el pago." : "Open the external checkout to complete payment.")}</p>
                <a href={dashInvoice.checkoutUrl} target="_blank" rel="noopener noreferrer" style={{ display: "block", padding: "12px 20px", borderRadius: 12, background: "#008DE4", color: "#ffffff", fontSize: 14, fontWeight: 600, textDecoration: "none" }}>{es ? "Abrir checkout Dash" : "Open Dash checkout"}</a>
              </div>
            )}
            <button onClick={cancelDash} style={{ display: "block", width: "100%", marginTop: 14, padding: "8px", background: "none", border: "none", color: "var(--pnp-text-secondary)", fontSize: 12, cursor: "pointer" }}>{es ? "Cancelar" : "Cancel"}</button>
          </div>
        )}

        {/* USDC polling indicator */}
        {pollingUsdcOrderId && !paymentSuccess && (
          <div style={{ marginBottom: 16, padding: "14px 16px", borderRadius: 14, background: "rgba(38,161,123,0.10)", border: "1px solid rgba(38,161,123,0.25)", textAlign: "center" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 4 }}>
              <Spinner size={14} />
              <span style={{ fontSize: 13, fontWeight: 600, color: "#ffffff" }}>
                {usdcConfirming ? (es ? "Confirmando pago USDC…" : "Confirming USDC payment…") : (es ? "Esperando pago USDC…" : "Waiting for USDC payment…")}
              </span>
            </div>
            <p style={{ margin: 0, fontSize: 12, color: "var(--pnp-text-secondary)" }}>{es ? "Completa el pago en la ventana que se abrió." : "Complete the payment in the window that opened."}</p>
          </div>
        )}

        {/* Info boxes */}
        {payMethod === "dash" && !dashUnavailable && !dashInvoice && (
          <div style={{ marginBottom: 16, padding: "12px 14px", borderRadius: 12, border: "1px solid rgba(0,141,228,0.30)", background: "rgba(0,141,228,0.06)" }}>
            <p style={{ margin: "0 0 4px", fontSize: 13, fontWeight: 700, color: "#008DE4" }}>
              {es ? "🥷 Anónimo, sin banco, sin nombre" : "🥷 Anonymous, no bank, no name"}
            </p>
            <p style={{ margin: "0 0 8px", fontSize: 12, color: "var(--pnp-text-secondary)" }}>
              {es ? "Desde tu wallet Dash. Confirmación en minutos." : "From your Dash wallet. Confirms in minutes."}
            </p>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 11 }}>
              <a href="https://www.dash.org/downloads/" target="_blank" rel="noopener noreferrer" style={{ color: "#008DE4" }}>{es ? "Obtener wallet" : "Get wallet"}</a>
              <span style={{ color: "rgba(255,255,255,0.2)" }}>·</span>
              <a href="https://www.kraken.com/learn/buy-dash-coin" target="_blank" rel="noopener noreferrer" style={{ color: "#008DE4" }}>Kraken</a>
              <span style={{ color: "rgba(255,255,255,0.2)" }}>·</span>
              <a href="https://uphold.com/en/assets/crypto/buy-dash" target="_blank" rel="noopener noreferrer" style={{ color: "#008DE4" }}>Uphold</a>
            </div>
          </div>
        )}
        {payMethod === "usdc" && !usdcUnavailable && !pollingUsdcOrderId && (
          <div style={{ marginBottom: 16, padding: "12px 14px", borderRadius: 12, border: "1px solid rgba(38,161,123,0.30)", background: "rgba(38,161,123,0.06)" }}>
            <p style={{ margin: "0 0 4px", fontSize: 13, fontWeight: 700, color: "#26a17b" }}>
              {es ? "🪙 USDC en múltiples redes" : "🪙 USDC on multiple networks"}
            </p>
            <p style={{ margin: "0 0 8px", fontSize: 12, color: "var(--pnp-text-secondary)" }}>
              {es ? "Paga con USDC en Ethereum, BSC, Polygon, Tron y más. Checkout externo seguro." : "Pay with USDC on Ethereum, BSC, Polygon, Tron & more. Secure external checkout."}
            </p>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 11 }}>
              <a href="https://www.coinbase.com/how-to-buy/usdc" target="_blank" rel="noopener noreferrer" style={{ color: "#26a17b" }}>Coinbase</a>
              <span style={{ color: "rgba(255,255,255,0.2)" }}>·</span>
              <a href="https://www.binance.com/en/buy-USDC" target="_blank" rel="noopener noreferrer" style={{ color: "#26a17b" }}>Binance</a>
              <span style={{ color: "rgba(255,255,255,0.2)" }}>·</span>
              <a href="https://kraken.com" target="_blank" rel="noopener noreferrer" style={{ color: "#26a17b" }}>Kraken</a>
            </div>
          </div>
        )}

        {/* Error */}
        {payError && (
          <div role="alert" style={{ marginBottom: 16, padding: "12px 16px", borderRadius: 12, background: "rgba(255,69,58,0.10)", border: "1px solid rgba(255,69,58,0.25)", textAlign: "center", fontSize: 13, color: "#FF453A" }}>
            {payError}
            <button onClick={() => setPayError(null)} style={{ display: "block", margin: "6px auto 0", fontSize: 11, color: "rgba(255,255,255,0.4)", background: "none", border: "none", cursor: "pointer" }}>{es ? "Cerrar" : "Dismiss"}</button>
          </div>
        )}

        {/* Support link */}
        <p style={{ textAlign: "center", fontSize: 13, color: "var(--pnp-text-secondary)" }}>
          {s.alreadyPaid}{" "}
          <a href="/contact" style={{ color: "#26a17b", fontWeight: 600, borderBottom: "1px solid rgba(38,161,123,0.5)", textDecoration: "none" }}>{s.alreadyPaidLink}</a>
        </p>

        <p style={{ marginTop: 20, fontSize: 11, color: "rgba(207,207,212,0.40)", textAlign: "center", lineHeight: 1.5 }}>
          {s.fineprint}
        </p>
      </div>

      {/* Sticky footer with payment method selector + CTA */}
      <div style={{ position: "fixed", bottom: 0, left: 0, width: "100%", background: "linear-gradient(to top, rgba(18,13,20,0.98) 50%, rgba(18,13,20,0.9) 85%, transparent)", zIndex: 50, boxSizing: "border-box", paddingBottom: "max(16px, env(safe-area-inset-bottom))" }}>

        {/* Nav pills */}
        <nav style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }} aria-label="Explore PNPtv">
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 16px", width: "max-content" }}>
            {NAV_ITEMS.map((item) => (
              <button key={item.id} type="button" onClick={() => onOpenSheet(item.id)} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 9999, fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", border: "1px solid rgba(255,255,255,0.12)", color: "#cfcfd4", cursor: "pointer", flexShrink: 0, background: "rgba(18,13,20,0.6)" }}>
                <span>{item.emoji}</span><span>{item.label}</span>
              </button>
            ))}
          </div>
        </nav>

        {/* Legal links */}
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "center", columnGap: 12, rowGap: 2, padding: "4px 16px 8px" }}>
          {LEGAL_LINKS.map((l) => (
            <a key={l.href} href={l.href} style={{ fontSize: 10, color: "rgba(207,207,212,0.5)", textDecoration: "none", whiteSpace: "nowrap" }}>{l.label}</a>
          ))}
        </div>

        {/* Payment method tabs */}
        <div style={{ padding: "0 16px 6px" }}>
          <p style={{ margin: "0 0 7px", fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(207,207,212,0.45)", textAlign: "center" }}>
            {es ? "¿Cómo quieres pagar?" : "How do you want to pay?"}
          </p>
          <div style={{ display: "flex", gap: 6 }}>
            {([
              { id: "dash" as PayMethod, emoji: "🥷", label: "Dash", sublabel: "$80 · BTCPay", disabled: dashUnavailable },
              { id: "usdc" as PayMethod, emoji: "🪙", label: "USDC", sublabel: "$80 · NowPayments", disabled: usdcUnavailable },
            ]).map(({ id, emoji, label, sublabel, disabled }) => {
              const sel = payMethod === id;
              return (
                <button key={id}
                  onClick={() => { if (!disabled) { setPayMethod(id); setPayError(null); } }}
                  disabled={disabled}
                  style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 1, padding: "8px 4px", borderRadius: 12, border: `1.5px solid ${sel ? "rgba(38,161,123,0.75)" : "rgba(255,255,255,0.10)"}`, background: sel ? "rgba(38,161,123,0.13)" : "rgba(255,255,255,0.03)", color: sel ? "#26a17b" : disabled ? "#636366" : "#cfcfd4", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.45 : 1, boxShadow: sel ? "0 0 16px rgba(38,161,123,0.22)" : "none", transition: "border-color 0.15s, background 0.15s, box-shadow 0.15s" }}
                >
                  <span style={{ fontSize: 18, lineHeight: 1, marginBottom: 2 }}>{emoji}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, lineHeight: 1.2 }}>{label}</span>
                  <span style={{ fontSize: 9, fontWeight: 500, opacity: 0.65, lineHeight: 1.3, textAlign: "center" }}>{sublabel}</span>
                </button>
              );
            })}
          </div>
          <p style={{ margin: "6px 0 0", fontSize: 10, color: "rgba(207,207,212,0.45)", textAlign: "center", lineHeight: 1.4, minHeight: 14 }}>
            {payMethod === "dash" && (es ? "Criptomoneda Dash — rápido, sin nombre, sin banco." : "Dash crypto — fast, no name, no bank required.")}
            {payMethod === "usdc" && (es ? "USDC stablecoin vía NowPayments — múltiples redes." : "USDC stablecoin via NowPayments — multiple networks.")}
          </p>
          <p style={{ margin: "8px 0 0", textAlign: "center" }}>
            <a href="/crypto-guide" style={{ fontSize: 10, color: "rgba(207,207,212,0.50)", textDecoration: "underline", textDecorationStyle: "dotted" }}>
              {es ? "¿No sabes cómo pagar con cripto? Aprende aquí →" : "Don't know how to pay with crypto? Learn how →"}
            </a>
          </p>
        </div>

        {/* CTA */}
        <div style={{ padding: "0 20px" }}>
          <button
            onClick={handleCtaClick}
            disabled={ctaDisabled}
            aria-disabled={ctaDisabled}
            style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", maxWidth: 500, margin: "0 auto", padding: "18px 24px", borderRadius: 16, border: "none", background: ctaDisabled ? "rgba(255,255,255,0.08)" : "linear-gradient(90deg, #26a17b, #008DE4)", color: ctaDisabled ? "#8E8E93" : "#ffffff", fontSize: 15, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", cursor: ctaDisabled ? "not-allowed" : "pointer", minHeight: 56, boxShadow: ctaDisabled ? "none" : "0 8px 32px rgba(38,161,123,0.35)", transition: "opacity 0.15s, transform 0.1s" }}
            onMouseDown={(e) => { if (!ctaDisabled) (e.currentTarget as HTMLButtonElement).style.transform = "scale(0.98)"; }}
            onMouseUp={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = "scale(1)"; }}
            onTouchStart={(e) => { if (!ctaDisabled) (e.currentTarget as HTMLButtonElement).style.transform = "scale(0.98)"; }}
            onTouchEnd={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = "scale(1)"; }}
          >
            {submitting && <Spinner size={16} />}
            {ctaLabel}
          </button>
        </div>
      </div>
      <style>{`@keyframes lt80-pulse{0%,100%{opacity:1}50%{opacity:.4}}`}</style>
    </div>
  );
}

// ── Root ───────────────────────────────────────────────────────────────────────

export default function Lifetime80() {
  const [lang, setLang] = useState<Lang>(getInitialLang);
  const [activeSheet, setActiveSheet] = useState<string | null>(null);
  const localizedSheets = useMemo(() => makeSheets(lang), [lang]);
  const sheetData = activeSheet ? localizedSheets[activeSheet] : null;

  useEffect(() => {
    document.title = S[lang].pageTitle;
  }, [lang]);

  useEffect(() => {
    document.body.style.overflow = activeSheet ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [activeSheet]);

  useEffect(() => {
    const STYLE_ID = "lt80-keyframes";
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `@keyframes lt80-fadeIn{from{opacity:0;transform:scale(0.96)}to{opacity:1;transform:scale(1)}}`;
    document.head.appendChild(style);
    return () => { try { document.head.removeChild(style); } catch { /* already removed */ } };
  }, []);

  const handleLangChange = (next: Lang) => { setLang(next); persistLang(next); };

  return (
    <>
      <HeroView lang={lang} onLangChange={handleLangChange} onOpenSheet={setActiveSheet} />
      <NavFooter onOpenSheet={setActiveSheet} />
      {sheetData && <SheetModal sheet={sheetData} onClose={() => setActiveSheet(null)} />}
    </>
  );
}
