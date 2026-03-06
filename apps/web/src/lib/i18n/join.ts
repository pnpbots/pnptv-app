const strings = {
  en: {
    // <title> / meta
    pageTitle: "Join PNPtv! \u2014 The Queer PNP Community",
    metaDescription: "Join PNPtv! \u2014 the private queer community for party & play. Connect, explore exclusive content, and find your people. Free to join.",
    ogDescription: "4,000+ members. Private hangouts. Exclusive content. Join free or go PRIME.",

    // Sticky nav
    openApp: "Open App",
    signIn: "Sign In",
    joinNow: "Join Now",

    // Hero badge
    heroBadge: "The private queer PNP community",

    // Hero headline (two parts split around the gradient span)
    heroHeadlinePart1: "Your people are",
    heroHeadlinePart2: "already here.",

    // Hero body
    heroBody: "PNPtv! is the private digital space for the queer party & play community. Connect, explore, and belong \u2014 on your terms.",

    // Hero stats template (rendered dynamically — individual tokens)
    heroStatsMembersTemplate: "{count}+ members",
    heroStatsJoinedTemplate: "{count}+ joined this month",

    // Hero CTAs
    getPrimeCta: "Get PRIME \u2014 $24.99/mo",
    joinFreeCta: "Join Free",
    noCreditCard: "No credit card required to join free. Cancel anytime.",

    // What is PNPtv! section
    whatIsPnptvLabel: "What is PNPtv!?",
    whatIsCards: [
      {
        title: "Private & Safe",
        desc: "A verified community \u2014 no randos. Every member goes through Telegram-based entry so the space stays real.",
      },
      {
        title: "Exclusive Content",
        desc: "Live shows, videos, and creator content you won\u2019t find anywhere else. Made by the community, for the community.",
      },
      {
        title: "Your People",
        desc: "Connect in private hangout rooms, discover nearby members, and DM freely. No algorithms, no judgment.",
      },
    ] as const,

    // Tier comparison table
    comparePlansLabel: "Compare plans",

    // Comparison column headers
    colFree: "Free",
    colFreePrice: "$0",
    colMember: "Member",
    colMemberPrice: "$9.99",
    colMemberPriceSuffix: "/mo",
    colPrime: "PRIME",
    colPrimePrice: "$24.99",
    colPrimePriceSuffix: "/mo",

    // Comparison rows (12 rows)
    comparisonRows: [
      "Social feed",
      "Home feed posts",
      "Telegram bot access",
      "Create a profile",
      "Browse member profiles",
      "Private hangout rooms",
      "Nearby users discovery",
      "DMs with any member",
      "Exclusive video library",
      "Creator-only content",
      "Live stream access",
      "Priority support",
    ] as const,

    // Choose your plan section
    choosePlanLabel: "Choose your plan",

    // Free plan card
    freePlanName: "Free",
    freePlanPrice: "$0",
    freePlanPeriod: "forever",
    freePlanFeatures: [
      "Create your profile",
      "Browse the social feed",
      "Telegram bot access",
      "Basic community access",
    ] as const,
    freePlanCta: "Join Free",

    // Member plan card
    memberPlanName: "Member",
    memberPlanPrice: "$9.99",
    memberPlanPriceSuffix: "/mo",
    memberPlanPeriod: "billed monthly",
    memberPlanFeatures: [
      "Everything in Free",
      "Private hangout rooms",
      "Browse all member profiles",
      "Nearby users discovery",
      "Unlimited DMs",
    ] as const,
    memberPlanCta: "Get Member",

    // PRIME plan card
    primePlanName: "PRIME",
    primePlanBestValue: "BEST VALUE",
    primePlanPrice: "$24.99",
    primePlanPriceSuffix: "/mo",
    primePlanPeriod: "billed monthly \u00b7 cancel anytime",
    primePlanFeatures: [
      "Everything in Member",
      "Exclusive video library",
      "Creator-only content",
      "Live stream access",
      "Priority support",
      "VIP community status",
    ] as const,
    primePlanCta: "Get PRIME",

    // Longer plans teaser
    longerPlansTitle: "Save more with longer plans",
    longerPlansDesc: "Crystal PRIME (6mo) \u00b7 Diamond PRIME (1yr) \u00b7 Lifetime PRIME",
    longerPlansSeeAll: "See all",

    // Featured creators section
    meetCreatorsLabel: "Meet the creators",

    // Stats section
    stats: [
      { stat: "4,400+", label: "Members worldwide" },
      { stat: "1,200+", label: "Joined this month" },
      { stat: "100%", label: "Private & verified" },
    ] as const,

    // Bottom CTA section
    bottomCtaHeadlinePart1: "Ready to",
    bottomCtaHeadlinePart2: "find your people?",
    bottomCtaBody: "Start free. Upgrade whenever you want. Cancel anytime.",

    // Footer
    footerAdults: "For adults 18+ only",
    footerTerms: "Terms of Service",
    footerPrivacy: "Privacy Policy",
    footerSupport: "Support",
  },

  es: {
    pageTitle: "Unirte a PNPtv! \u2014 La Comunidad Queer PNP",
    metaDescription: "Únete a PNPtv! \u2014 la comunidad queer privada de party & play. Conéctate, explora contenido exclusivo y encuentra a tu gente. Gratis.",
    ogDescription: "4,000+ miembros. Hangouts privados. Contenido exclusivo. Únete gratis o hazte PRIME.",

    openApp: "Abrir App",
    signIn: "Iniciar sesión",
    joinNow: "Únete Ahora",

    heroBadge: "La comunidad queer privada de PNP",

    heroHeadlinePart1: "Tu gente ya",
    heroHeadlinePart2: "está aquí.",

    heroBody: "PNPtv! es el espacio digital privado para la comunidad queer de party & play. Conéctate, explora y pertenece \u2014 a tu manera.",

    heroStatsMembersTemplate: "{count}+ miembros",
    heroStatsJoinedTemplate: "{count}+ se unieron este mes",

    getPrimeCta: "Hazte PRIME \u2014 $24.99/mes",
    joinFreeCta: "Unirse Gratis",
    noCreditCard: "No se requiere tarjeta de crédito para unirse gratis. Cancela cuando quieras.",

    whatIsPnptvLabel: "\u00bfQué es PNPtv!?",
    whatIsCards: [
      {
        title: "Privado y Seguro",
        desc: "Una comunidad verificada \u2014 sin desconocidos. Cada miembro entra a través de Telegram para que el espacio sea real.",
      },
      {
        title: "Contenido Exclusivo",
        desc: "Shows en vivo, videos y contenido de creadores que no encontrarás en otro lugar. Hecho por la comunidad, para la comunidad.",
      },
      {
        title: "Tu Gente",
        desc: "Conéctate en salas privadas, descubre miembros cercanos y escribe DMs libremente. Sin algoritmos, sin prejuicios.",
      },
    ] as const,

    comparePlansLabel: "Comparar planes",

    colFree: "Gratis",
    colFreePrice: "$0",
    colMember: "Member",
    colMemberPrice: "$9.99",
    colMemberPriceSuffix: "/mes",
    colPrime: "PRIME",
    colPrimePrice: "$24.99",
    colPrimePriceSuffix: "/mes",

    comparisonRows: [
      "Feed social",
      "Posts en el feed principal",
      "Acceso al bot de Telegram",
      "Crear un perfil",
      "Ver perfiles de miembros",
      "Salas privadas de hangout",
      "Descubrir usuarios cercanos",
      "DMs con cualquier miembro",
      "Biblioteca de videos exclusivos",
      "Contenido solo para creadores",
      "Acceso a streams en vivo",
      "Soporte prioritario",
    ] as const,

    choosePlanLabel: "Elige tu plan",

    freePlanName: "Gratis",
    freePlanPrice: "$0",
    freePlanPeriod: "para siempre",
    freePlanFeatures: [
      "Crea tu perfil",
      "Explora el feed social",
      "Acceso al bot de Telegram",
      "Acceso básico a la comunidad",
    ] as const,
    freePlanCta: "Unirse Gratis",

    memberPlanName: "Member",
    memberPlanPrice: "$9.99",
    memberPlanPriceSuffix: "/mes",
    memberPlanPeriod: "facturado mensualmente",
    memberPlanFeatures: [
      "Todo lo del plan Gratis",
      "Salas privadas de hangout",
      "Ver todos los perfiles de miembros",
      "Descubrir usuarios cercanos",
      "DMs ilimitados",
    ] as const,
    memberPlanCta: "Hazte Member",

    primePlanName: "PRIME",
    primePlanBestValue: "MEJOR VALOR",
    primePlanPrice: "$24.99",
    primePlanPriceSuffix: "/mes",
    primePlanPeriod: "facturado mensualmente \u00b7 cancela cuando quieras",
    primePlanFeatures: [
      "Todo lo del plan Member",
      "Biblioteca de videos exclusivos",
      "Contenido solo para creadores",
      "Acceso a streams en vivo",
      "Soporte prioritario",
      "Estatus VIP en la comunidad",
    ] as const,
    primePlanCta: "Hazte PRIME",

    longerPlansTitle: "Ahorra más con planes más largos",
    longerPlansDesc: "Crystal PRIME (6 meses) \u00b7 Diamond PRIME (1 año) \u00b7 PRIME de por Vida",
    longerPlansSeeAll: "Ver todos",

    meetCreatorsLabel: "Conoce a los creadores",

    stats: [
      { stat: "4,400+", label: "Miembros en el mundo" },
      { stat: "1,200+", label: "Se unieron este mes" },
      { stat: "100%", label: "Privado y verificado" },
    ] as const,

    bottomCtaHeadlinePart1: "Listo para",
    bottomCtaHeadlinePart2: "encontrar a tu gente?",
    bottomCtaBody: "Empieza gratis. Mejora cuando quieras. Cancela cuando quieras.",

    footerAdults: "Solo para mayores de 18 años",
    footerTerms: "Términos de Servicio",
    footerPrivacy: "Política de Privacidad",
    footerSupport: "Soporte",
  },
} as const;

export type JoinStrings = typeof strings.en;
export { strings as join };
