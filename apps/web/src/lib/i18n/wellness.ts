/**
 * Wellness mode + Self-Care Center i18n bundle.
 * Covers WellnessShell.tsx (the page rendered while in wellness mode) and
 * SelfCareCenter.tsx (/wellness-center landing page).
 *
 * EN + ES are fully localized; the other 14 languages fall back to EN so
 * the I18n type union stays satisfied. Translate them properly later.
 */

const en = {
  // ── WellnessShell.tsx ──────────────────────────────────────────────────────
  shellPageTitle: "Wellness Break · PNPtv",
  shellHeroHeading: "Wellness Break",
  shellHeroBody:
    "You're taking a break from the rest of the platform. Only the wellness hangouts, Cristina, and your settings are reachable right now.",
  shellHeroBodyEmphasis: "You're doing great.",
  shellStatusIndefinite: "Active indefinitely — disable when you're ready in Settings.",
  shellStatusUntil: "Active until {date}",
  shellLoadError:
    "Couldn't load your wellness page — the crisis lines and Cristina below are always available.",

  shellSectionHangouts: "Wellness Hangouts",
  shellHangoutsEmpty:
    "No wellness hangouts available right now. Reach out to support — this is a setup gap.",
  shellMemberOne: "member",
  shellMemberMany: "members",

  shellSectionCristina: "Talk to Cristina",
  shellCristinaName: "Cristina AI",
  shellCristinaBlurb:
    "Need to vent, ask for resources, or find a sponsor? She's here, no judgment.",

  shellSectionQuickLog: "Quick Log",
  shellQuickLogPrivate: "private",
  shellLoggingPrivacy: "Logging is private and never shared.",
  shellTrackerSlam: "Slam",
  shellTrackerSmoke: "Smoke",
  shellLogging: "Logging…",
  shellLogPrefix: "Log {label}",
  shellLogStatsLine: "{today} today · {week}/7d",
  shellLogStatsEmpty: "—",
  shellTrackerAriaLog: "Log a {label}",

  shellSectionCrisis: "If you need help right now",
  shellCrisisSamhsaLabel: "SAMHSA Helpline (US):",
  shellCrisisSamhsaNote: "free, 24/7, confidential",
  shellCrisisCmaLabel: "Crystal Meth Anonymous:",
  shellCrisisTrevorLabel: "Trevor Project (LGBTQ+ crisis):",
  shellCrisisInternationalLabel: "International:",

  shellManageInSettings: "Manage Wellness Break Mode in Settings →",

  // ── SelfCareCenter.tsx ─────────────────────────────────────────────────────
  centerPageTitle: "My Self-Care Center · PNPtv",
  centerEyebrow: "My Self-Care Center",
  centerHeadingPrefix: "Tools to look after",
  centerHeadingHighlight: "yourself",
  centerHeadingSuffix: ".",
  centerHeroBody:
    "Hi {name}. This space is yours. Track your use, take a break when you need one, talk to Cristina when you need someone. Nothing here is shared, judged, or scored.",
  centerHeroNameFallback: "you",

  centerSec1Eyebrow: "Your data",
  centerSec1Title: "Track & take stock",
  centerSec1Subtitle: "Private to you. Awareness over judgment.",

  centerSec2Eyebrow: "Reach out",
  centerSec2Title: "People & places that help",
  centerSec2Subtitle:
    "Talk to someone, join a quiet hangout, or get crisis support.",
  centerLinkCristinaTitle: "Talk to Cristina",
  centerLinkCristinaBody:
    "Vent, ask for resources, or find a sponsor. No judgment, no logs.",
  centerLinkHangoutsTitle: "Wellness Hangouts",
  centerLinkHangoutsEmpty: "Quiet spaces with members on the same path.",
  centerLinkHangoutsActiveOne: "{count} hangout active right now.",
  centerLinkHangoutsActiveMany: "{count} hangouts active right now.",

  centerSec3Eyebrow: "Right now",
  centerSec3Title: "Crisis resources",
  centerSec3Subtitle: "Always free, always confidential. Use them.",
  centerCrisisHeading: "If you need help right now",

  centerSec4Eyebrow: "What's next",
  centerSec4Title: "More tools, soon",
  centerComingSoonHeading: "More tools coming",
  centerComingSoonBadge: "Roadmap",
  centerComingSoonItems: [
    { label: "Sleep tracker", body: "Log sleep windows after each session." },
    { label: "Mood journal", body: "Quick check-ins so patterns surface." },
    { label: "Accountability buddy", body: "Pair with someone in recovery." },
    { label: "Reflection prompts", body: "Cristina-guided journaling." },
  ] as const,
  centerComingSoonFooter:
    "Want something specific? Tell Cristina — she logs feature requests.",

  centerFooterPrivacy:
    "Everything here is private to your account. PNPtv staff cannot see your tracker logs.",
  centerFooterPrivacyLink: "Privacy",
  centerFooterSafetyLink: "Safety",
};

const es: typeof en = {
  shellPageTitle: "Pausa de bienestar · PNPtv",
  shellHeroHeading: "Pausa de bienestar",
  shellHeroBody:
    "Estás tomando un descanso del resto de la plataforma. Por ahora solo puedes acceder a los hangouts de bienestar, Cristina y tus ajustes.",
  shellHeroBodyEmphasis: "Lo estás haciendo bien.",
  shellStatusIndefinite:
    "Activo por tiempo indefinido — desactívalo en Ajustes cuando estés listo.",
  shellStatusUntil: "Activo hasta {date}",
  shellLoadError:
    "No pudimos cargar tu página de bienestar — las líneas de crisis y Cristina aquí abajo siempre están disponibles.",

  shellSectionHangouts: "Hangouts de bienestar",
  shellHangoutsEmpty:
    "No hay hangouts de bienestar disponibles ahora. Contacta a soporte — esto es un hueco de configuración.",
  shellMemberOne: "miembro",
  shellMemberMany: "miembros",

  shellSectionCristina: "Habla con Cristina",
  shellCristinaName: "Cristina AI",
  shellCristinaBlurb:
    "¿Necesitas desahogarte, pedir recursos o encontrar un padrino? Ella está aquí, sin juicios.",

  shellSectionQuickLog: "Registro rápido",
  shellQuickLogPrivate: "privado",
  shellLoggingPrivacy: "El registro es privado y nunca se comparte.",
  shellTrackerSlam: "Slam",
  shellTrackerSmoke: "Fumar",
  shellLogging: "Registrando…",
  shellLogPrefix: "Registrar {label}",
  shellLogStatsLine: "{today} hoy · {week}/7d",
  shellLogStatsEmpty: "—",
  shellTrackerAriaLog: "Registrar un {label}",

  shellSectionCrisis: "Si necesitas ayuda ahora mismo",
  shellCrisisSamhsaLabel: "Línea SAMHSA (EE.UU.):",
  shellCrisisSamhsaNote: "gratis, 24/7, confidencial",
  shellCrisisCmaLabel: "Crystal Meth Anonymous:",
  shellCrisisTrevorLabel: "Trevor Project (crisis LGBTQ+):",
  shellCrisisInternationalLabel: "Internacional:",

  shellManageInSettings: "Gestionar Pausa de bienestar en Ajustes →",

  centerPageTitle: "Mi Centro de Autocuidado · PNPtv",
  centerEyebrow: "Mi Centro de Autocuidado",
  centerHeadingPrefix: "Herramientas para cuidarte",
  centerHeadingHighlight: "a ti mismo",
  centerHeadingSuffix: ".",
  centerHeroBody:
    "Hola {name}. Este espacio es tuyo. Lleva un registro de tu uso, tómate un descanso cuando lo necesites, habla con Cristina cuando necesites a alguien. Nada de aquí se comparte, juzga ni puntúa.",
  centerHeroNameFallback: "tú",

  centerSec1Eyebrow: "Tus datos",
  centerSec1Title: "Lleva un registro y haz un balance",
  centerSec1Subtitle: "Privado para ti. Consciencia sobre juicio.",

  centerSec2Eyebrow: "Pide apoyo",
  centerSec2Title: "Personas y lugares que ayudan",
  centerSec2Subtitle:
    "Habla con alguien, únete a un hangout tranquilo o consigue apoyo de crisis.",
  centerLinkCristinaTitle: "Habla con Cristina",
  centerLinkCristinaBody:
    "Desahógate, pide recursos o encuentra un padrino. Sin juicios, sin registros.",
  centerLinkHangoutsTitle: "Hangouts de bienestar",
  centerLinkHangoutsEmpty: "Espacios tranquilos con miembros en el mismo camino.",
  centerLinkHangoutsActiveOne: "{count} hangout activo ahora mismo.",
  centerLinkHangoutsActiveMany: "{count} hangouts activos ahora mismo.",

  centerSec3Eyebrow: "Ahora mismo",
  centerSec3Title: "Recursos de crisis",
  centerSec3Subtitle: "Siempre gratis, siempre confidencial. Úsalos.",
  centerCrisisHeading: "Si necesitas ayuda ahora mismo",

  centerSec4Eyebrow: "Próximamente",
  centerSec4Title: "Más herramientas, pronto",
  centerComingSoonHeading: "Vienen más herramientas",
  centerComingSoonBadge: "Roadmap",
  centerComingSoonItems: [
    { label: "Registro de sueño", body: "Registra ventanas de sueño tras cada sesión." },
    { label: "Diario de ánimo", body: "Check-ins rápidos para que afloren patrones." },
    { label: "Compañero de rendición de cuentas", body: "Empareja con alguien en recuperación." },
    { label: "Pautas de reflexión", body: "Diario guiado por Cristina." },
  ] as const,
  centerComingSoonFooter:
    "¿Quieres algo específico? Cuéntaselo a Cristina — ella registra solicitudes de funciones.",

  centerFooterPrivacy:
    "Todo aquí es privado para tu cuenta. El equipo de PNPtv no puede ver tus registros.",
  centerFooterPrivacyLink: "Privacidad",
  centerFooterSafetyLink: "Seguridad",
};

// Other 14 languages: fall back to English so the type contract is satisfied.
// Translate each properly when reaching that locale's user base.
const strings = {
  en,
  es,
  pt: en,
  zh: en,
  zhTW: en,
  fr: en,
  de: en,
  th: en,
  it: en,
  tr: en,
  ru: en,
  nl: en,
  vi: en,
  ja: en,
  id: en,
  ar: en,
} as const;

export type WellnessStrings = typeof strings.en;
export { strings as wellness };
