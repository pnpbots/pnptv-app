const strings = {
  en: {
    // <title> / meta
    pageTitle: "Welcome \u2014 PNPtv!",
    metaDescription: "Welcome to PNPtv! Explore all features: Media, Hangouts, Live, Social Feed, Nearby, and more.",

    // Hero section
    // Greeting uses the member's display name — use a template token
    welcomeGreeting: "Welcome, {name}!",
    heroBody: "Your membership is active. Here\u2019s everything you can do on PNPtv \u2014 explore each feature below to get started.",

    // Membership badges
    primeActiveBadge: "PRIME Active",
    memberActiveBadge: "Member Active",

    // Community Rules section
    communityRulesTitle: "Community Rules",
    ageRequirementLabel: "18+",
    ageRequirementText: "You must be 18 years or older to use PNPtv! By continuing to use this platform, you confirm that you are at least 18 years of age.",
    prohibitedContentTitle: "The following content is strictly prohibited:",
    prohibitedItems: [
      "Content involving minors in any context",
      "Non-consensual content or any form of coercion",
      "Harassment, threats, doxxing, or hate speech",
      "Illegal drug sales, trafficking, or solicitation",
      "Spam, scams, phishing, or impersonation",
      "Sharing private content without the owner\u2019s consent",
    ] as const,
    violationsNote:
      "Violations will result in immediate account termination and will be reported to the appropriate authorities. We actively monitor content and cooperate fully with law enforcement. By using PNPtv!, you agree to abide by these rules.",
    violationsImmediateTermination: "immediate account termination",
    violationsReportedAuthorities: "reported to the appropriate authorities",

    // Feature cards (8 cards — title + desc only; icons are emoji literals in source)
    exploreFeaturesHeading: "Explore Features",
    featureCards: [
      {
        title: "Media",
        desc: "Videos, music, and podcasts. Browse exclusive PRIME content and create your own playlists.",
      },
      {
        title: "Hangouts",
        desc: "Community video call rooms. Join public groups or create private hangouts with friends.",
      },
      {
        title: "PNP Live",
        desc: "Live streams and exclusive recordings. Watch shows in real time and send tips.",
      },
      {
        title: "Social Feed",
        desc: "Post content, like, repost, and comment. Connect with the community.",
      },
      {
        title: "Nearby",
        desc: "Discover members and venues near you. Enable location to see who\u2019s around.",
      },
      {
        title: "Direct Messages",
        desc: "Send private messages to any member. Share text, images, and videos.",
      },
      {
        title: "Profile",
        desc: "Customize your profile with themes, badges, and bio. Connect Bluesky or X.",
      },
      {
        title: "PRIME Channel",
        desc: "Exclusive Telegram channel with premium content and early announcements.",
      },
    ] as const,

    // Quick start checklist
    quickStartTitle: "Quick Start Checklist",
    quickStartItems: [
      "Complete your profile with a photo and bio",
      "Explore exclusive PRIME content",
      "Join a Hangout or create your own group",
      "Publish your first post on the Social Feed",
      "Join the PRIME Telegram Channel",
    ] as const,

    // CTA buttons
    explorePnptvCta: "Explore PNPtv",
    openTelegramBotCta: "Open Telegram Bot",

    // Support footer
    needHelp: "Need help?",
    contactSupport: "Contact Support",
  },

  es: {
    pageTitle: "Bienvenido \u2014 PNPtv!",
    metaDescription: "Bienvenido a PNPtv! Explora todas las funciones: Media, Hangouts, PNP Live, Feed Social, Cerca y más.",

    welcomeGreeting: "Bienvenido, {name}!",
    heroBody: "Tu membresía está activa. Aquí tienes todo lo que puedes hacer en PNPtv \u2014 explora cada función para empezar.",

    primeActiveBadge: "PRIME Activo",
    memberActiveBadge: "Member Activo",

    communityRulesTitle: "Normas de la Comunidad",
    ageRequirementLabel: "18+",
    ageRequirementText: "Debes tener 18 años o más para usar PNPtv! Al continuar usando esta plataforma, confirmas que tienes al menos 18 años.",
    prohibitedContentTitle: "El siguiente contenido está estrictamente prohibido:",
    prohibitedItems: [
      "Contenido que involucre menores en cualquier contexto",
      "Contenido no consensual o cualquier forma de coerción",
      "Acoso, amenazas, doxxing o discurso de odio",
      "Venta ilegal de drogas, tráfico o solicitud",
      "Spam, estafas, phishing o suplantación de identidad",
      "Compartir contenido privado sin el consentimiento del dueño",
    ] as const,
    violationsNote:
      "Las infracciones resultarán en la terminación inmediata de la cuenta y serán reportadas a las autoridades correspondientes. Monitoreamos el contenido activamente y cooperamos plenamente con las fuerzas del orden. Al usar PNPtv!, aceptas cumplir estas normas.",
    violationsImmediateTermination: "terminación inmediata de la cuenta",
    violationsReportedAuthorities: "reportadas a las autoridades correspondientes",

    exploreFeaturesHeading: "Explorar Funciones",
    featureCards: [
      {
        title: "Media",
        desc: "Videos, música y podcasts. Explora contenido PRIME exclusivo y crea tus propias listas de reproducción.",
      },
      {
        title: "Hangouts",
        desc: "Salas de videollamada comunitarias. Únete a grupos públicos o crea hangouts privados con amigos.",
      },
      {
        title: "PNP Live",
        desc: "Streams en vivo y grabaciones exclusivas. Mira shows en tiempo real y envía propinas.",
      },
      {
        title: "Feed Social",
        desc: "Publica contenido, dale like, república y comenta. Conéctate con la comunidad.",
      },
      {
        title: "Cerca",
        desc: "Descubre miembros y lugares cerca de ti. Activa la ubicación para ver quién está alrededor.",
      },
      {
        title: "Mensajes Directos",
        desc: "Envía mensajes privados a cualquier miembro. Comparte texto, imágenes y videos.",
      },
      {
        title: "Perfil",
        desc: "Personaliza tu perfil con temas, badges y bio. Conecta Bluesky o X.",
      },
      {
        title: "Canal PRIME",
        desc: "Canal exclusivo de Telegram con contenido premium y anuncios anticipados.",
      },
    ] as const,

    quickStartTitle: "Lista de Inicio Rápido",
    quickStartItems: [
      "Completa tu perfil con una foto y bio",
      "Explora el contenido PRIME exclusivo",
      "Únete a un Hangout o crea tu propio grupo",
      "Publica tu primer post en el Feed Social",
      "Únete al Canal PRIME de Telegram",
    ] as const,

    explorePnptvCta: "Explorar PNPtv",
    openTelegramBotCta: "Abrir Bot de Telegram",

    needHelp: "\u00bfNecesitas ayuda?",
    contactSupport: "Contactar Soporte",
  },
} as const;

export type WelcomeStrings = typeof strings.en;
export { strings as welcome };
