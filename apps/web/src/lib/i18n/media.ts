const strings = {
  en: {
    // Page meta
    pageTitle: "PRIME Media — PNPtv!",
    pageDescription: "Exclusive PRIME video collection. Watch premium content from top PNPtv creators.",

    // Header
    headerTitle: "PRIME",
    headerSubtitle: "Exclusive video collection",
    videosCount: (n: number) => `${n} videos`,

    // Upsell hero — member variant
    memberBadge: "You're a Member — one step away!",
    upgradeTitle: "Upgrade to PRIME",
    upgradeSubtitle: "Your Member plan doesn't include the video library. Upgrade now and get everything.",
    upgradeCta: "Upgrade to PRIME →",

    // Upsell hero — free variant
    unlockTitle: "Unlock Full Access",
    unlockSubtitle: (count: number) =>
      `${count > 0 ? `${count} exclusive videos` : "Exclusive videos"}, live streams, and raw content — all locked behind PRIME.`,
    trialCta: "Start PRIME Trial — $14.99/wk →",
    pricingHint: "Monthly from $24.99 · Lifetime available",

    // Benefits list
    benefitLibrary: "Unlimited access to the full video library",
    benefitHd: "HD streams & raw creator content",
    benefitLive: "Private live rooms & call access",
    benefitCommunity: "Priority community features",
    benefitMemberBonus: "Everything in your current Member plan",
    benefitCancel: "Cancel anytime, no questions asked",

    // Sticky bottom banner
    videosLocked: (n: number) => `${n} videos locked`,
    upgradeToWatch: "Upgrade to PRIME to watch",
    trialFromHint: "Trial from $14.99 · Cancel anytime",
    upgradeBannerCta: "Upgrade",
    getPrimeCta: "Get PRIME",

    // Category filter
    allSeries: "All",
    categoryClouding: "Clouding",
    categorySlamming: "Slamming",
    categoryLiveShow: "Live Show",

    // Video card
    playingBadge: "PLAYING",
    episodePrefix: "Ep",

    // Active player
    closePlayer: "Close player",

    // States
    loadingError: "Video service is temporarily unavailable. Please try again later.",
    noVideos: "No videos yet",
    noVideosHint: "New content is added regularly. Check back soon!",
  },
  es: {
    pageTitle: "PRIME Media — PNPtv!",
    pageDescription: "Colección exclusiva de videos PRIME. Mira contenido premium de los mejores creadores de PNPtv.",

    headerTitle: "PRIME",
    headerSubtitle: "Colección exclusiva de videos",
    videosCount: (n: number) => `${n} videos`,

    memberBadge: "Eres Member — ¡a un paso!",
    upgradeTitle: "Mejora a PRIME",
    upgradeSubtitle: "Tu plan Member no incluye la videoteca. Mejora ahora y obtén todo.",
    upgradeCta: "Mejora a PRIME →",

    unlockTitle: "Acceso Completo",
    unlockSubtitle: (count: number) =>
      `${count > 0 ? `${count} videos exclusivos` : "Videos exclusivos"}, transmisiones en vivo y contenido sin filtro — todo detrás de PRIME.`,
    trialCta: "Prueba PRIME — $14.99/sem →",
    pricingHint: "Mensual desde $24.99 · Disponible de por vida",

    benefitLibrary: "Acceso ilimitado a toda la videoteca",
    benefitHd: "Streams en HD y contenido crudo de creadores",
    benefitLive: "Salas privadas en vivo y acceso a llamadas",
    benefitCommunity: "Funciones de comunidad prioritarias",
    benefitMemberBonus: "Todo lo de tu plan Member actual",
    benefitCancel: "Cancela cuando quieras, sin preguntas",

    videosLocked: (n: number) => `${n} videos bloqueados`,
    upgradeToWatch: "Mejora a PRIME para ver",
    trialFromHint: "Prueba desde $14.99 · Cancela cuando quieras",
    upgradeBannerCta: "Mejorar",
    getPrimeCta: "Obtener PRIME",

    allSeries: "Todos",
    categoryClouding: "Clouding",
    categorySlamming: "Slamming",
    categoryLiveShow: "Live Show",

    playingBadge: "REPRODUCIENDO",
    episodePrefix: "Ep",

    closePlayer: "Cerrar reproductor",

    loadingError: "El servicio de video no está disponible temporalmente. Intenta de nuevo más tarde.",
    noVideos: "Sin videos aún",
    noVideosHint: "Se agrega contenido nuevo regularmente. ¡Vuelve pronto!",
  },
} as const;

export type MediaStrings = typeof strings.en;
export { strings as media };
