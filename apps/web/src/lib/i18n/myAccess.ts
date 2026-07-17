const strings = {
  en: {
    pageTitle: "My Access — PNPtv!",
    heading: "My Access",
    subheading: "What you currently have access to on PNPtv.",

    // Membership card
    membershipPrime: "PRIME",
    membershipMember: "Member",
    membershipFree: "FREE",
    primeLabel: "PRIME",
    basicLabel: "BASIC",
    freeLabel: "FREE",
    upgrade: "Upgrade",
    rowPrime: "PRIME",
    rowMember: "Member",
    rowPrivateCalls: "Private call credits",
    noMembership: "No active membership. Upgrade to unlock live streams, hangouts, and more.",

    // Sections
    paidChannelsTitle: "Paid Channels",
    paidChannelsSubtitle: "Channels you have purchased direct access to.",
    paidChannelsEmpty: "No paid channels yet. Buy access from the channel itself.",

    subscribedCreatorsTitle: "Subscribed Creators",
    subscribedCreatorsSubtitle: "Creators you support with a recurring subscription.",
    subscribedCreatorsEmpty: "No creator subscriptions yet. Visit a creator's profile to subscribe.",

    paidHangoutsTitle: "Paid Hangouts",
    paidHangoutsSubtitle: "Standalone paid hangouts you have access to.",
    paidHangoutsEmpty: "No paid hangouts.",

    callCreditsTitle: "Call Credits",
    callCreditsSubtitle: "Prepaid private calls you can book anytime.",
    callCreditsEmpty: "No call credits yet. Buy a package on a creator's profile.",

    // Row subtitles
    rowChannelAccess: "Channel access",
    rowHangoutAccess: "Hangout access",
    rowCallCredit: (remaining: number, duration: number) =>
      `${remaining} × ${duration}-min ${remaining === 1 ? "call" : "calls"} left`,
    rowCallCreditBook: "Book",

    // Expiry formatter
    lifetime: "Lifetime",
    dash: "—",
    expired: "Expired",
    expiresToday: "Expires today",
    daysLeft: (n: number) => `${n} days left`,
    untilDate: (date: string) => `Until ${date}`,

    // Error + loading
    loadError: "Failed to load access",

    // Defaults for empty display data
    defaultChannelName: "Channel",
    defaultHangoutName: "Hangout",
    defaultCreatorName: "Creator",
  },

  es: {
    pageTitle: "Mi Acceso — PNPtv!",
    heading: "Mi Acceso",
    subheading: "A qué tienes acceso actualmente en PNPtv.",

    // Membership card
    membershipPrime: "PRIME",
    membershipMember: "Miembro",
    membershipFree: "GRATIS",
    primeLabel: "PRIME",
    basicLabel: "BÁSICO",
    freeLabel: "GRATIS",
    upgrade: "Mejorar",
    rowPrime: "PRIME",
    rowMember: "Miembro",
    rowPrivateCalls: "Créditos de llamadas privadas",
    noMembership: "Sin membresía activa. Mejora para desbloquear streams en vivo, hangouts y más.",

    // Sections
    paidChannelsTitle: "Canales Pagos",
    paidChannelsSubtitle: "Canales a los que compraste acceso directo.",
    paidChannelsEmpty: "Aún no tienes canales pagos. Compra acceso desde el canal mismo.",

    subscribedCreatorsTitle: "Creadores Suscritos",
    subscribedCreatorsSubtitle: "Creadores que apoyas con una suscripción recurrente.",
    subscribedCreatorsEmpty: "Aún no tienes suscripciones a creadores. Visita el perfil de un creador para suscribirte.",

    paidHangoutsTitle: "Hangouts Pagos",
    paidHangoutsSubtitle: "Hangouts pagos independientes a los que tienes acceso.",
    paidHangoutsEmpty: "Sin hangouts pagos.",

    callCreditsTitle: "Créditos de Llamadas",
    callCreditsSubtitle: "Llamadas privadas prepagadas que puedes reservar en cualquier momento.",
    callCreditsEmpty: "Sin créditos de llamadas. Compra un paquete en el perfil de un creador.",

    // Row subtitles
    rowChannelAccess: "Acceso al canal",
    rowHangoutAccess: "Acceso al hangout",
    rowCallCredit: (remaining: number, duration: number) =>
      `${remaining} × ${remaining === 1 ? "llamada" : "llamadas"} de ${duration} min disponibles`,
    rowCallCreditBook: "Reservar",

    // Expiry formatter
    lifetime: "Permanente",
    dash: "—",
    expired: "Vencido",
    expiresToday: "Vence hoy",
    daysLeft: (n: number) => `${n} días restantes`,
    untilDate: (date: string) => `Hasta ${date}`,

    // Error + loading
    loadError: "Error al cargar el acceso",

    // Defaults for empty display data
    defaultChannelName: "Canal",
    defaultHangoutName: "Hangout",
    defaultCreatorName: "Creador",
  },
} as const;

export type MyAccessStrings = typeof strings.en;
export { strings as myAccess };
