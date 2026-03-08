const strings = {
  en: {
    // Brand tagline
    tagline: "The #1 queer PNP community",

    // Feature badges
    featureBadges: [
      { title: "Hot Performers", sub: "Latino & más" },
      { title: "PNP Content", sub: "Uncensored" },
      { title: "Video Rooms", sub: "Live & private" },
    ] as const,

    // Lifetime deal banner
    lifetimeDealLabel: "Lifetime Deal",
    lifetimeDealTitle: "$100 — PRIME access, forever",
    lifetimeDealSub: "One payment. No renewals. Never expires.",
    lifetimeDealCta: "Get it →",

    // Auth buttons
    loginWithTelegram: "Login with Telegram",
    waitingForTelegram: "Waiting for Telegram...",
    telegramInstructions: "Open Telegram and press Start to log in",
    loginWithX: "Login with X",
    redirectingToX: "Redirecting to X...",
    loginWithEmail: "Login with Email",

    // Telegram Widget flow
    telegramWidgetVerifying: "Verifying with Telegram...",
    telegramWidgetError: "Telegram verification failed. Please try again.",
    telegramWidgetRetry: "Try again",
    telegramWidgetFallbackLink: "Having trouble? Try the alternative login",
    telegramWidgetBlocked: "If the Telegram button didn't appear, try the alternative login below.",
    alternativeTelegramLogin: "Alternative Telegram login",

    // Divider
    orDivider: "or",

    // Email form
    emailPlaceholder: "Email address",
    passwordPlaceholder: "Password",
    rememberMe: "Remember me",
    logIn: "Log In",
    cancel: "Cancel",

    // Inline validation / errors
    emailAndPasswordRequired: "Please enter your email and password",
    loginFailed: "Login failed",
    connectionError: "Connection error. Please try again.",
    loginFailedRetry: "Login failed. Please try again.",

    // Legal footer
    legalPrefix: "By continuing, you agree to our",
    legalTerms: "Terms",
    legalAnd: "and",
    legalPrivacyPolicy: "Privacy Policy",

    // Footer links
    footerLinks: {
      cookies: "Cookies",
      communityGuidelines: "Community Guidelines",
      contentPolicy: "Content Policy",
      refunds: "Refunds",
      subscriptions: "Subscriptions",
      creatorTerms: "Creator Terms",
      dmca: "DMCA",
      safety: "Safety",
      contact: "Contact",
    },

    copyright: "\u00a9 2026 PNPtv. All rights reserved.",
  },

  es: {
    tagline: "La comunidad queer #1 de PNP",

    featureBadges: [
      { title: "Performers Hot", sub: "Latino & más" },
      { title: "Contenido PNP", sub: "Sin censura" },
      { title: "Salas de Video", sub: "En vivo y privadas" },
    ] as const,

    lifetimeDealLabel: "Oferta de por Vida",
    lifetimeDealTitle: "$100 — acceso PRIME, para siempre",
    lifetimeDealSub: "Un solo pago. Sin renovaciones. Nunca vence.",
    lifetimeDealCta: "Obtenerlo →",

    loginWithTelegram: "Entrar con Telegram",
    waitingForTelegram: "Esperando Telegram...",
    telegramInstructions: "Abre Telegram y presiona Iniciar para entrar",
    loginWithX: "Entrar con X",
    redirectingToX: "Redirigiendo a X...",
    loginWithEmail: "Entrar con Email",

    // Telegram Widget flow
    telegramWidgetVerifying: "Verificando con Telegram...",
    telegramWidgetError: "Verificación de Telegram fallida. Por favor intenta de nuevo.",
    telegramWidgetRetry: "Intentar de nuevo",
    telegramWidgetFallbackLink: "¿Problemas? Prueba el inicio de sesión alternativo",
    telegramWidgetBlocked: "Si el botón de Telegram no aparece, usa el inicio de sesión alternativo abajo.",
    alternativeTelegramLogin: "Inicio de sesión alternativo de Telegram",

    orDivider: "o",

    emailPlaceholder: "Correo electrónico",
    passwordPlaceholder: "Contraseña",
    rememberMe: "Recordarme",
    logIn: "Iniciar sesión",
    cancel: "Cancelar",

    emailAndPasswordRequired: "Ingresa tu correo y contraseña",
    loginFailed: "Error al iniciar sesión",
    connectionError: "Error de conexión. Por favor intenta de nuevo.",
    loginFailedRetry: "Error al iniciar sesión. Por favor intenta de nuevo.",

    legalPrefix: "Al continuar, aceptas nuestros",
    legalTerms: "Términos",
    legalAnd: "y la",
    legalPrivacyPolicy: "Política de Privacidad",

    footerLinks: {
      cookies: "Cookies",
      communityGuidelines: "Normas de la Comunidad",
      contentPolicy: "Política de Contenido",
      refunds: "Reembolsos",
      subscriptions: "Suscripciones",
      creatorTerms: "Términos del Creador",
      dmca: "DMCA",
      safety: "Seguridad",
      contact: "Contacto",
    },

    copyright: "\u00a9 2026 PNPtv. Todos los derechos reservados.",
  },
} as const;

export type LoginStrings = typeof strings.en;
export { strings as login };
