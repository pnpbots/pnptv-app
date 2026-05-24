import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useI18n } from "@/lib/i18n";
import { mainStageTips } from "@/lib/i18n/mainStageTips";
import { getMainStageState, type MainStageState } from "@/lib/api";
import { connectSocket } from "@/lib/socket";

// Global announcement strip pinned above the bottom nav (mobile) and at the
// bottom of the viewport, offset by the side rail (desktop).
//
// Behavior:
//   - When Main Stage is broadcasting (live cammers OR media playing) the strip
//     pins a single LIVE entry that links to /main-stage (no rotation).
//   - Otherwise it rotates UPDATE / WELLNESS / TIP entries every ROTATION_MS.
//   - Each category has its own color, icon, and label, all bilingual.
//   - UPDATE entries can carry a `href` deep link; tapping navigates there.
//   - Auto-hides while the user is already on /main-stage.

type Category = "LIVE" | "UPDATE" | "WELLNESS" | "TIP";
type Lang = "en" | "es";

interface AnnouncementEntry {
  category: Category;
  text: string;
  href?: string;
}

interface RawMessage {
  category: "UPDATE" | "TIP";
  en: string;
  es: string;
  href?: string;
}

const ROTATION_MS = 18000;
const FADE_MS = 350;
// Marquee timing: pause briefly so the user sees the start, then scroll the
// overflow distance over SCROLL_MS. The remaining ROTATION_MS - START_PAUSE_MS
// - SCROLL_MS is end-rest before the next slot rotates in.
const MARQUEE_START_PAUSE_MS = 1500;
const MARQUEE_SCROLL_MS = 14000;
const MARQUEE_END_PAD_PX = 12; // ensure the last character clears the edge

// ── Static content ────────────────────────────────────────────────────────────
// New features and fixes — UPDATE entries deep-link into the feature.
// Add entries at the top of the list to surface them more frequently after
// a build (the pool is shuffled but new entries get a fresh pass through).
const UPDATE_MESSAGES: RawMessage[] = [
  {
    category: "UPDATE",
    en: "Save 20% on yearly & lifetime plans when you pay with Dash, USDC, or Lightning.",
    es: "Ahorra 20% en planes anuales y lifetime pagando con Dash, USDC o Lightning.",
    href: "/subscribe",
  },
  {
    category: "UPDATE",
    en: "Crypto prices now shown on every plan card — pick your method and see your savings instantly.",
    es: "Los precios cripto ahora aparecen en cada plan — elige tu método y ve tus ahorros al instante.",
    href: "/subscribe",
  },
  {
    category: "UPDATE",
    en: "Apple Pay & Google Pay are back — subscribe in two taps, no card details needed.",
    es: "Apple Pay y Google Pay están de vuelta — suscríbete en dos toques, sin datos de tarjeta.",
    href: "/subscribe",
  },
  {
    category: "UPDATE",
    en: "PNP Live launches June 1st — live cams, real-time tips, and the community all in one place.",
    es: "PNP Live arranca el 1 de junio — cams en vivo, tips en tiempo real y la comunidad reunida.",
    href: "/live",
  },
  {
    category: "UPDATE",
    en: "PRIME Lifetime Pass — $250 once, yours forever. Includes $20 in tip credit.",
    es: "Pase Lifetime PRIME — $250 una vez, tuyo para siempre. Incluye $20 en crédito de tips.",
    href: "/subscribe",
  },
  {
    category: "UPDATE",
    en: "Payments are faster and more reliable — Dash and USDC flows rebuilt from the ground up.",
    es: "Los pagos son más rápidos y confiables — flujos de Dash y USDC reconstruidos desde cero.",
    href: "/subscribe",
  },
  {
    category: "UPDATE",
    en: "Set up a passkey — one tap to log in, no password needed.",
    es: "Configura un passkey — un toque para entrar, sin contraseña.",
    href: "/settings/account",
  },
  {
    category: "UPDATE",
    en: "Book a 1-on-1 video call with a creator — private, no middleman.",
    es: "Reserva una videollamada 1 a 1 con un creador — privada, sin intermediarios.",
    href: "/creators",
  },
  {
    category: "UPDATE",
    en: "Cristina has your back 24/7 — ask her anything in the Self-Care Center.",
    es: "Cristina te acompaña 24/7 — pregúntale lo que quieras en el Centro de Autocuidado.",
    href: "/self-care",
  },
];

const TIP_MESSAGES: RawMessage[] = [
  { category: "TIP", en: "Voice notes work in DMs — hold the mic, speak, send.", es: "Las notas de voz funcionan en los DMs — mantén el mic, habla, envía.", href: "/messages" },
  { category: "TIP", en: "Apply for creator and turn your cam into income.", es: "Solicita ser creador y convierte tu cámara en ingresos.", href: "/become-a-model" },
  { category: "TIP", en: "Book a 1-on-1 call with a creator from their profile.", es: "Reserva una llamada 1-a-1 con un creador desde su perfil.", href: "/creators" },
  { category: "TIP", en: "Schedule a hangout — invite exactly the people you want.", es: "Programa un hangout — invita exactamente a la gente que quieras.", href: "/chat" },
  { category: "TIP", en: "PRIME videos load faster than ever. Open one now.", es: "Los videos PRIME cargan más rápido que nunca. Abre uno ya.", href: "/prime" },
  { category: "TIP", en: "Find people nearby on the map — cruising, made easy.", es: "Encuentra gente cerca en el mapa — cruising, sin complicarte.", href: "/nearby" },
];

// ── Category presentation ─────────────────────────────────────────────────────

const CATEGORY_STYLES: Record<Category, {
  label: Record<Lang, string>;
  color: string;
  bg: string;
  border: string;
  Icon: React.FC<{ className?: string }>;
}> = {
  LIVE: {
    label: { en: "LIVE", es: "EN VIVO" },
    color: "#FF3D7F",
    bg: "rgba(255,61,127,0.12)",
    border: "rgba(255,61,127,0.45)",
    Icon: ({ className }) => (
      <span className={`relative flex h-2 w-2 ${className ?? ""}`} aria-hidden>
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-current opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-current" />
      </span>
    ),
  },
  UPDATE: {
    label: { en: "NEW", es: "NUEVO" },
    color: "#E5C54A",
    bg: "rgba(229,197,74,0.12)",
    border: "rgba(229,197,74,0.30)",
    Icon: ({ className }) => (
      <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d="M12 2l1.5 5.5L19 9l-5.5 1.5L12 16l-1.5-5.5L5 9l5.5-1.5L12 2zM19 14l.8 2.7L22 17l-2.2.7L19 20l-.8-2.7L16 17l2.2-.7L19 14zM5 14l.6 2L7 16.5l-1.6.5L5 19l-.6-2L3 16.5l1.6-.5L5 14z" />
      </svg>
    ),
  },
  WELLNESS: {
    label: { en: "WELLNESS", es: "BIENESTAR" },
    color: "#5ED1C4",
    bg: "rgba(94,209,196,0.12)",
    border: "rgba(94,209,196,0.30)",
    Icon: ({ className }) => (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" />
      </svg>
    ),
  },
  TIP: {
    label: { en: "TIP", es: "TIP" },
    color: "#A990FF",
    bg: "rgba(169,144,255,0.12)",
    border: "rgba(169,144,255,0.30)",
    Icon: ({ className }) => (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M9 18h6M10 22h4M12 2a7 7 0 00-4 12.74V17h8v-2.26A7 7 0 0012 2z" />
      </svg>
    ),
  },
};

// ── Pool helpers ──────────────────────────────────────────────────────────────

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function buildUpdatePool(lang: Lang): AnnouncementEntry[] {
  return UPDATE_MESSAGES.map((m) => ({
    category: m.category,
    text: m[lang],
    href: m.href,
  }));
}

function buildSecondaryPool(lang: Lang): AnnouncementEntry[] {
  const tips: AnnouncementEntry[] = TIP_MESSAGES.map((m) => ({
    category: m.category,
    text: m[lang],
    href: m.href,
  }));
  const wellness: AnnouncementEntry[] = mainStageTips[lang].map((tip) => ({
    category: "WELLNESS",
    text: `${tip.emoji} ${tip.body}`,
  }));
  return [...tips, ...wellness];
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AnnouncementStrip() {
  const navigate = useNavigate();
  const location = useLocation();
  const t = useI18n();
  const lang: Lang = t.lang === "es" ? "es" : "en";

  const [state, setState] = useState<MainStageState | null>(null);

  // Subscribe to mainstage state for the LIVE category.
  useEffect(() => {
    let cancelled = false;
    getMainStageState().then((res) => { if (!cancelled) setState(res); }).catch(() => {});
    const socket = connectSocket();
    const onState = (payload: MainStageState) => { if (!cancelled) setState(payload); };
    socket.on("mainstage:state", onState);
    return () => { cancelled = true; socket.off("mainstage:state", onState); };
  }, []);

  const isBroadcasting = useMemo(() => {
    const cammers = state?.counts?.cammers ?? 0;
    const mediaPlaying =
      !!state?.media &&
      state.media.kind !== "off" &&
      state.media.playing &&
      !!state.media.src;
    return cammers > 0 || mediaPlaying;
  }, [state]);

  // Two separate pools so UPDATE entries (fixes/news) get top priority.
  // Rotation strictly alternates: UPDATE → secondary → UPDATE → secondary...
  // This guarantees fixes/news land in 50% of slots regardless of how large
  // the wellness/tips pool grows.
  const updatePoolRef = useRef<AnnouncementEntry[]>([]);
  const secondaryPoolRef = useRef<AnnouncementEntry[]>([]);
  const slotRef = useRef<"update" | "secondary">("update");
  const [current, setCurrent] = useState<AnnouncementEntry | null>(null);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    updatePoolRef.current = shuffle(buildUpdatePool(lang));
    secondaryPoolRef.current = shuffle(buildSecondaryPool(lang));
    slotRef.current = "update";

    const nextRotated = (): AnnouncementEntry | null => {
      const slot = slotRef.current;
      const ref = slot === "update" ? updatePoolRef : secondaryPoolRef;
      if (ref.current.length === 0) {
        ref.current = shuffle(slot === "update" ? buildUpdatePool(lang) : buildSecondaryPool(lang));
      }
      const item = ref.current.shift() ?? null;
      slotRef.current = slot === "update" ? "secondary" : "update";
      return item;
    };

    setCurrent(nextRotated());
    setVisible(true);

    const id = setInterval(() => {
      setVisible(false);
      setTimeout(() => {
        setCurrent(nextRotated());
        setVisible(true);
      }, FADE_MS);
    }, ROTATION_MS);
    return () => clearInterval(id);
  }, [lang]);

  // When Main Stage is broadcasting, weave LIVE into the rotation rather than
  // pinning it. We stamp every third slot as LIVE and let the rotated content
  // fill the other two slots. Tracked via a counter so the cadence stays
  // stable when broadcasting state flips on/off.
  const liveSlotCounterRef = useRef(0);
  const [showLiveThisSlot, setShowLiveThisSlot] = useState(false);

  useEffect(() => {
    if (!isBroadcasting) {
      liveSlotCounterRef.current = 0;
      setShowLiveThisSlot(false);
      return;
    }
    // Show LIVE immediately when it just came on, then every 3rd slot.
    setShowLiveThisSlot(true);
    liveSlotCounterRef.current = 0;

    const id = setInterval(() => {
      liveSlotCounterRef.current = (liveSlotCounterRef.current + 1) % 3;
      setShowLiveThisSlot(liveSlotCounterRef.current === 0);
    }, ROTATION_MS);
    return () => clearInterval(id);
  }, [isBroadcasting]);

  // LIVE shares slots with the rotation when broadcasting (every 3rd slot).
  // Computed in render so the JSX below + the marquee hook can both consume it.
  const liveEntry: AnnouncementEntry | null = isBroadcasting && showLiveThisSlot
    ? {
        category: "LIVE",
        text: lang === "es"
          ? `Main Stage está en vivo${state?.media?.title ? ` — ${state.media.title}` : ""}`
          : `Main Stage is live${state?.media?.title ? ` — ${state.media.title}` : ""}`,
        href: "/main-stage",
      }
    : null;
  const entry: AnnouncementEntry | null = liveEntry ?? current;

  // Marquee: when the entry text overflows the visible window, scroll it
  // horizontally so the full message reads through during the slot. Honours
  // prefers-reduced-motion (just truncates instead). All hooks must run
  // unconditionally — the early returns below come AFTER this block.
  const marqueeWrapRef = useRef<HTMLSpanElement | null>(null);
  const marqueeTextRef = useRef<HTMLSpanElement | null>(null);
  const reducedMotion = useMemo(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);
  const [marquee, setMarquee] = useState<{ shift: number; running: boolean }>({ shift: 0, running: false });

  useLayoutEffect(() => {
    setMarquee({ shift: 0, running: false });
    if (reducedMotion) return;
    const wrap = marqueeWrapRef.current;
    const track = marqueeTextRef.current;
    if (!wrap || !track) return;
    const overflow = track.scrollWidth - wrap.clientWidth;
    if (overflow <= 0) return;
    const id = setTimeout(() => {
      setMarquee({ shift: overflow + MARQUEE_END_PAD_PX, running: true });
    }, MARQUEE_START_PAUSE_MS);
    return () => clearTimeout(id);
  }, [entry?.text, reducedMotion]);

  // Hide when on /main-stage entirely — the page itself is the announcement.
  if (location.pathname === "/main-stage") return null;
  if (!entry) return null;

  const style = CATEGORY_STYLES[entry.category];
  const Icon = style.Icon;
  const labelText = style.label[lang];
  const ctaText = entry.category === "LIVE"
    ? (lang === "es" ? "Ver →" : "Watch →")
    : entry.href
      ? (lang === "es" ? "Abrir →" : "Open →")
      : null;

  const handleClick = () => {
    if (entry.href) navigate(entry.href);
  };

  // Fade in/out with the rotation timer.
  const fadeClass = visible ? "opacity-100" : "opacity-0";

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={!entry.href}
      aria-label={`${labelText}: ${entry.text}`}
      className={`
        w-full flex items-center gap-2.5 px-3 py-2 text-left
        backdrop-blur-md
        transition-opacity duration-300 ${fadeClass}
        ${entry.href ? "cursor-pointer active:scale-[0.995]" : "cursor-default"}
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent
      `.replace(/\s+/g, " ").trim()}
      style={{
        background: `linear-gradient(180deg, rgba(10,10,20,0.92), rgba(10,10,20,0.96)), ${style.bg}`,
        borderTop: `1px solid ${style.border}`,
      }}
    >
      <span
        className="flex-shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-md"
        style={{ color: style.color, background: style.bg }}
        aria-hidden
      >
        <Icon className="w-3.5 h-3.5" />
      </span>

      <span
        className="flex-shrink-0 text-[10px] font-bold uppercase tracking-[0.12em]"
        style={{ color: style.color }}
      >
        {labelText}
      </span>

      <span className="flex-shrink-0 text-pnp-textSecondary/40 text-xs" aria-hidden>·</span>

      {/* Visible window — clips the marquee track to the available space. */}
      <span
        ref={marqueeWrapRef}
        className="flex-1 min-w-0 overflow-hidden text-sm text-pnp-textPrimary"
      >
        <span
          ref={marqueeTextRef}
          className="inline-block whitespace-nowrap"
          style={{
            transform: `translateX(${-marquee.shift}px)`,
            transition: marquee.running
              ? `transform ${MARQUEE_SCROLL_MS}ms linear`
              : "none",
            willChange: marquee.running ? "transform" : undefined,
          }}
        >
          {entry.text}
        </span>
      </span>

      {ctaText && (
        <span className="flex-shrink-0 text-xs font-semibold whitespace-nowrap" style={{ color: style.color }}>
          {ctaText}
        </span>
      )}
    </button>
  );
}
