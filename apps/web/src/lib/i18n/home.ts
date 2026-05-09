/**
 * Home / PNP Hub dashboard i18n bundle.
 * Covers Home.tsx — the authenticated landing page after login.
 * EN + ES localized; other 14 languages fall back to EN.
 */

const en = {
  pageTitle: "Home — PNPtv!",
  metaDescription:
    "Your PNPtv home. Browse your feed, upcoming events, and community posts.",

  // Welcome / Hub card
  hubTitle: "PNP Hub",
  hubSubtitle: "Your dashboard — everything at a glance",
  benefitsHeading: "Your {tier} benefits:",
  upgradeToPrime: "Upgrade to PRIME",
  upgradeToMember: "Upgrade to Member",
  upgradeArrow: "→",

  // Tier labels (used in the tier badge)
  tierLabelFree: "Free",
  tierLabelMember: "Member",
  tierLabelPrime: "PRIME",

  // Tier benefit lists
  benefitsFree: [
    "Browse the community",
    "View public posts",
  ],
  benefitsMember: [
    "Social feed & reactions",
    "DMs & messaging",
    "Hangouts video rooms",
    "PNP Live & Radio",
    "Nearby discovery",
  ],
  benefitsPrime: [
    "Everything in Member +",
    "PRIME exclusive live shows",
    "PRIME-only VOD & posts",
    "Early access & priority",
    "Private video calls",
  ],

  // Latest Posts preview
  latestPosts: "Latest Posts",
  viewAll: "View all",
  noPostsYet: "No posts yet. Be the first to share!",

  // Upcoming Events component
  upcomingEvents: "Upcoming Events",

  // Feature highlight cards (NEW pills)
  newBadge: "NEW",
  featureHangouts: "Hangouts",
  featureHangoutsDesc:
    "Voice + video group rooms — drop in face-to-face, no schedule",
  featureMainStage: "Main Stage",
  featureMainStageDesc:
    "Cinema + camming — synced PRIME videos with the whole room on cam",
  featureDmCalls: "DM Video Calls",
  featureDmCallsPrime: "Private 1:1 video — call any DM directly",
  featureDmCallsLocked: "PRIME unlocks 1:1 video calls in DMs",

  // Mobile PRIME CTA banner
  primeCtaUpgrade: "Upgrade to PRIME — DMs, video calls & more",
  primeCtaUnlock: "Unlock PRIME — DMs, video calls & more",
};

const es: typeof en = {
  pageTitle: "Inicio — PNPtv!",
  metaDescription:
    "Tu inicio en PNPtv. Explora tu feed, próximos eventos y publicaciones de la comunidad.",

  hubTitle: "PNP Hub",
  hubSubtitle: "Tu panel — todo a simple vista",
  benefitsHeading: "Tus beneficios {tier}:",
  upgradeToPrime: "Actualizar a PRIME",
  upgradeToMember: "Actualizar a Member",
  upgradeArrow: "→",

  tierLabelFree: "Gratis",
  tierLabelMember: "Member",
  tierLabelPrime: "PRIME",

  benefitsFree: [
    "Explora la comunidad",
    "Ve publicaciones públicas",
  ],
  benefitsMember: [
    "Feed social y reacciones",
    "DMs y mensajería",
    "Salas de video Hangouts",
    "PNP Live y Radio",
    "Descubrimiento Nearby",
  ],
  benefitsPrime: [
    "Todo lo de Member +",
    "Shows en vivo exclusivos PRIME",
    "VOD y publicaciones solo PRIME",
    "Acceso anticipado y prioridad",
    "Videollamadas privadas",
  ],

  latestPosts: "Últimas publicaciones",
  viewAll: "Ver todas",
  noPostsYet: "Aún no hay publicaciones. ¡Sé el primero en compartir!",

  upcomingEvents: "Próximos eventos",

  newBadge: "NUEVO",
  featureHangouts: "Hangouts",
  featureHangoutsDesc:
    "Salas grupales de voz + video — entra cara a cara, sin agendar",
  featureMainStage: "Main Stage",
  featureMainStageDesc:
    "Cine + camming — videos PRIME sincronizados con toda la sala en cámara",
  featureDmCalls: "Videollamadas DM",
  featureDmCallsPrime: "Video privado 1:1 — llama directo desde cualquier DM",
  featureDmCallsLocked: "PRIME desbloquea videollamadas 1:1 en DMs",

  primeCtaUpgrade: "Actualiza a PRIME — DMs, videollamadas y más",
  primeCtaUnlock: "Desbloquea PRIME — DMs, videollamadas y más",
};

const strings = {
  en,
  es,
  pt: en, zh: en, zhTW: en, fr: en, de: en, th: en, it: en, tr: en,
  ru: en, nl: en, vi: en, ja: en, id: en, ar: en,
} as const;

export type HomeStrings = typeof strings.en;
export { strings as home };
