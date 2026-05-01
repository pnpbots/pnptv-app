/**
 * Centralized i18n system for PNPtv (EN / ES).
 * Usage:  const t = useI18n();  →  t.nav.home, t.common.save, t.login.title, etc.
 */

import { useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import { common, type CommonStrings } from "./common";
import { nav, type NavStrings } from "./nav";
import { login, type LoginStrings } from "./login";
import { join, type JoinStrings } from "./join";
import { welcome, type WelcomeStrings } from "./welcome";
import { profile, type ProfileStrings } from "./profile";
import { subscribe, type SubscribeStrings } from "./subscribe";
import { myAccess, type MyAccessStrings } from "./myAccess";
import { booking, type BookingStrings } from "./booking";
import { chat, type ChatStrings } from "./chat";
import { live, type LiveStrings } from "./live";
import { dm, type DmStrings } from "./dm";
import { apply, type ApplyStrings } from "./apply";
import { creator, type CreatorStrings } from "./creator";
import { gates, type GatesStrings } from "./gates";
// checkout i18n bundle removed — only the deleted DaimoCheckout page consumed it.
import { support, type SupportStrings } from "./support";
import { feed, type FeedStrings } from "./feed";
import { gamification, type GamificationStrings } from "./gamification";
import { becomeModel, type BecomeModelStrings } from "./becomeModel";
import { landing, type LandingStrings } from "./landing";
import { blog, type BlogStrings } from "./blog";
import { about, type AboutStrings } from "./about";
import { careers, type CareersStrings } from "./careers";
import { communityResources, type CommunityResourcesStrings } from "./communityResources";
import { shop, type ShopStrings } from "./shop";
import { notifications, type NotificationsStrings } from "./notifications";
import { admin, type AdminStrings } from "./admin";
import { wellness, type WellnessStrings } from "./wellness";
import { home, type HomeStrings } from "./home";

export type Lang = "en" | "es" | "pt" | "zh" | "zhTW" | "fr" | "de" | "th" | "it" | "tr" | "ru" | "nl" | "vi" | "ja" | "id" | "ar";

/** Widen literal string types to plain string for i18n compatibility across languages. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Widen<T> = T extends (...args: any[]) => any ? T
  : T extends readonly (infer _)[] ? T
  : T extends Record<string, unknown> ? { [K in keyof T]: Widen<T[K]> }
  : T extends string ? string
  : T;

export interface I18n {
  lang: Lang;
  common: Widen<CommonStrings>;
  nav: Widen<NavStrings>;
  login: Widen<LoginStrings>;
  join: Widen<JoinStrings>;
  welcome: Widen<WelcomeStrings>;
  profile: Widen<ProfileStrings>;
  subscribe: Widen<SubscribeStrings>;
  myAccess: Widen<MyAccessStrings>;
  booking: Widen<BookingStrings>;
  chat: Widen<ChatStrings>;
  live: Widen<LiveStrings>;
  dm: Widen<DmStrings>;
  apply: Widen<ApplyStrings>;
  creator: Widen<CreatorStrings>;
  gates: Widen<GatesStrings>;
  support: Widen<SupportStrings>;
  feed: Widen<FeedStrings>;
  gamification: Widen<GamificationStrings>;
  becomeModel: Widen<BecomeModelStrings>;
  landing: Widen<LandingStrings>;
  blog: Widen<BlogStrings>;
  about: Widen<AboutStrings>;
  careers: Widen<CareersStrings>;
  communityResources: Widen<CommunityResourcesStrings>;
  shop: Widen<ShopStrings>;
  notifications: Widen<NotificationsStrings>;
  admin: Widen<AdminStrings>;
  wellness: Widen<WellnessStrings>;
  home: Widen<HomeStrings>;
}

/** Safely index an i18n module, falling back to "en" for unsupported languages. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pick(mod: Record<string, any>, lang: Lang): any {
  return mod[lang] ?? mod.en;
}

function resolve(lang: Lang): I18n {
  return {
    lang,
    common: pick(common, lang),
    nav: pick(nav, lang),
    login: pick(login, lang),
    join: pick(join, lang),
    welcome: pick(welcome, lang),
    profile: pick(profile, lang),
    subscribe: pick(subscribe, lang),
    myAccess: pick(myAccess, lang),
    booking: pick(booking, lang),
    chat: pick(chat, lang),
    live: pick(live, lang),
    dm: pick(dm, lang),
    apply: pick(apply, lang),
    creator: pick(creator, lang),
    gates: pick(gates, lang),
    support: pick(support, lang),
    feed: pick(feed, lang),
    gamification: pick(gamification, lang),
    becomeModel: pick(becomeModel, lang),
    landing: pick(landing, lang),
    blog: pick(blog, lang),
    about: pick(about, lang),
    careers: pick(careers, lang),
    communityResources: pick(communityResources, lang),
    shop: pick(shop, lang),
    notifications: pick(notifications, lang),
    admin: pick(admin, lang),
    wellness: pick(wellness, lang),
    home: pick(home, lang),
  } as I18n;
}

/** Map from database/browser language codes to our Lang keys */
const LANG_MAP: Record<string, Lang> = {
  en: "en", es: "es", pt: "pt", "pt-br": "pt", fr: "fr", de: "de",
  it: "it", ja: "ja", zh: "zh", "zh-hans": "zh", "zh-hant": "zhTW",
  "zh-tw": "zhTW", ru: "ru", ar: "ar", th: "th", nl: "nl",
  vi: "vi", id: "id", tr: "tr",
};

const SUPPORTED_LANGS = new Set<Lang>(["en","es","pt","zh","zhTW","fr","de","th","it","tr","ru","nl","vi","ja","id","ar"]);

/** Get the current language from user profile, localStorage, or browser. */
export function getLang(userLang?: string | null): Lang {
  if (userLang) {
    const lower = userLang.toLowerCase();
    // Exact match
    if (LANG_MAP[lower]) return LANG_MAP[lower];
    // Try base language (e.g., "en-US" → "en")
    const base = lower.split("-")[0];
    if (LANG_MAP[base]) return LANG_MAP[base];
  }
  // localStorage fallback (for unauthenticated visitors)
  if (typeof localStorage !== "undefined") {
    try {
      const stored = localStorage.getItem("pnptv_lang");
      if (stored && LANG_MAP[stored]) return LANG_MAP[stored];
    } catch { /* private browsing */ }
  }
  // Browser detection fallback
  if (typeof navigator !== "undefined" && navigator.language) {
    const browserLang = navigator.language.toLowerCase();
    if (LANG_MAP[browserLang]) return LANG_MAP[browserLang];
    const base = browserLang.split("-")[0];
    if (LANG_MAP[base]) return LANG_MAP[base];
  }
  return "en";
}

/** Save language preference to localStorage (for unauthenticated visitors). */
export function setGuestLang(lang: Lang): void {
  try { localStorage.setItem("pnptv_lang", lang); } catch { /* ignore */ }
}

/** Hook: returns all i18n strings for the user's language. */
export function useI18n(): I18n {
  const { user } = useAuth();
  const lang = getLang(user?.language);
  return useMemo(() => resolve(lang), [lang]);
}

/** Standalone resolver for contexts without React (e.g., utilities). */
export function getI18n(lang: Lang): I18n {
  return resolve(lang);
}
