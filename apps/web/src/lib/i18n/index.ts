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
import { booking, type BookingStrings } from "./booking";
import { chat, type ChatStrings } from "./chat";
import { live, type LiveStrings } from "./live";
import { media, type MediaStrings } from "./media";
import { dm, type DmStrings } from "./dm";
import { apply, type ApplyStrings } from "./apply";
import { creator, type CreatorStrings } from "./creator";
import { gates, type GatesStrings } from "./gates";
import { checkout, type CheckoutStrings } from "./checkout";
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

export type Lang = "en" | "es";

export interface I18n {
  lang: Lang;
  common: CommonStrings;
  nav: NavStrings;
  login: LoginStrings;
  join: JoinStrings;
  welcome: WelcomeStrings;
  profile: ProfileStrings;
  subscribe: SubscribeStrings;
  booking: BookingStrings;
  chat: ChatStrings;
  live: LiveStrings;
  media: MediaStrings;
  dm: DmStrings;
  apply: ApplyStrings;
  creator: CreatorStrings;
  gates: GatesStrings;
  checkout: CheckoutStrings;
  support: SupportStrings;
  feed: FeedStrings;
  gamification: GamificationStrings;
  becomeModel: BecomeModelStrings;
  landing: LandingStrings;
  blog: BlogStrings;
  about: AboutStrings;
  careers: CareersStrings;
  communityResources: CommunityResourcesStrings;
  shop: ShopStrings;
  notifications: NotificationsStrings;
}

function resolve(lang: Lang): I18n {
  return {
    lang,
    common: common[lang],
    nav: nav[lang],
    login: login[lang],
    join: join[lang],
    welcome: welcome[lang],
    profile: profile[lang],
    subscribe: subscribe[lang],
    booking: booking[lang],
    chat: chat[lang],
    live: live[lang],
    media: media[lang],
    dm: dm[lang],
    apply: apply[lang],
    creator: creator[lang],
    gates: gates[lang],
    checkout: checkout[lang],
    support: support[lang],
    feed: feed[lang],
    gamification: gamification[lang],
    becomeModel: becomeModel[lang],
    landing: landing[lang],
    blog: blog[lang],
    about: about[lang],
    careers: careers[lang],
    communityResources: communityResources[lang],
    shop: shop[lang],
    notifications: notifications[lang],
  };
}

/** Get the current language from user profile or browser. */
export function getLang(userLang?: string | null): Lang {
  if (userLang === "es") return "es";
  return "en";
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
