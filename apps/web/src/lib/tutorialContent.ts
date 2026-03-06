export interface TutorialSlide {
  titleEn: string;
  titleEs: string;
  descEn: string;
  descEs: string;
  illustration: string; // key into tutorialIllustrations
}

export interface TutorialSection {
  slides: TutorialSlide[];
}

export const tutorialContent: Record<string, TutorialSection> = {
  home: {
    slides: [
      {
        titleEn: "Welcome to PNPtv!",
        titleEs: "Bienvenido a PNPtv!",
        descEn: "Your queer community hub. This is an 18+ platform. Content involving minors, non-consensual material, harassment, illegal sales, and spam are strictly prohibited. Violations are reported to authorities.",
        descEs: "Tu centro comunitario queer. Esta es una plataforma para mayores de 18. Contenido con menores, material no consensual, acoso, ventas ilegales y spam estan estrictamente prohibidos. Las violaciones se reportan a las autoridades.",
        illustration: "welcome",
      },
      {
        titleEn: "Your Feed",
        titleEs: "Tu Feed",
        descEn: "See announcements, featured performers, and the latest posts from the community all in one place.",
        descEs: "Ve anuncios, performers destacados y las publicaciones mas recientes de la comunidad en un solo lugar.",
        illustration: "feed",
      },
      {
        titleEn: "Navigate & Explore",
        titleEs: "Navega y Explora",
        descEn: "Use the tabs at the bottom to jump between sections: Hangouts, PRIME, Live, Nearby, and more.",
        descEs: "Usa las pestanas en la parte inferior para moverte entre secciones: Hangouts, PRIME, Live, Nearby y mas.",
        illustration: "navigate",
      },
    ],
  },

  hangouts: {
    slides: [
      {
        titleEn: "Group Hangouts",
        titleEs: "Hangouts Grupales",
        descEn: "Join group chats to meet and vibe with the community. Share messages, media, and have fun together.",
        descEs: "Unete a chats grupales para conocer y compartir con la comunidad. Comparte mensajes, media y diviertete.",
        illustration: "groupChat",
      },
      {
        titleEn: "Video Calls",
        titleEs: "Videollamadas",
        descEn: "Start or join live video calls right from any hangout group. Face-to-face, anytime.",
        descEs: "Inicia o unete a videollamadas en vivo desde cualquier grupo. Cara a cara, cuando quieras.",
        illustration: "videoCall",
      },
      {
        titleEn: "Create Your Own",
        titleEs: "Crea el Tuyo",
        descEn: "PRIME members can create private hangout groups and invite who they want.",
        descEs: "Los miembros PRIME pueden crear grupos privados e invitar a quienes quieran.",
        illustration: "createGroup",
      },
      {
        titleEn: "Community Rules",
        titleEs: "Reglas de la Comunidad",
        descEn: "Complaints and support requests in hangouts are prohibited and may result in a ban. For help, chat with Cristina AI — your customer support assistant — available anytime from the menu.",
        descEs: "Las quejas y solicitudes de soporte en hangouts estan prohibidas y pueden resultar en un ban. Para ayuda, habla con Cristina AI — tu asistente de soporte — disponible en cualquier momento desde el menu.",
        illustration: "navigate",
      },
      {
        titleEn: "Illegal Content",
        titleEs: "Contenido Ilegal",
        descEn: "Any illegal content shared in hangouts will be immediately reported to law enforcement authorities. Keep the community safe.",
        descEs: "Cualquier contenido ilegal compartido en hangouts sera reportado de inmediato a las autoridades policiales. Mantengamos la comunidad segura.",
        illustration: "welcome",
      },
    ],
  },

  prime: {
    slides: [
      {
        titleEn: "PRIME Content",
        titleEs: "Contenido PRIME",
        descEn: "Exclusive videos, photos, and content from top performers — only for subscribers.",
        descEs: "Videos, fotos y contenido exclusivo de los mejores performers — solo para suscriptores.",
        illustration: "primeContent",
      },
      {
        titleEn: "Browse & Watch",
        titleEs: "Explora y Mira",
        descEn: "Filter by performer or category. Tap any item to watch or view in full screen.",
        descEs: "Filtra por performer o categoria. Toca cualquier elemento para ver en pantalla completa.",
        illustration: "browse",
      },
    ],
  },

  live: {
    slides: [
      {
        titleEn: "Live Streams",
        titleEs: "Transmisiones en Vivo",
        descEn: "Watch performers streaming live. Real-time interaction with your favorites.",
        descEs: "Mira performers transmitiendo en vivo. Interaccion en tiempo real con tus favoritos.",
        illustration: "liveStream",
      },
      {
        titleEn: "Send Tips",
        titleEs: "Envia Propinas",
        descEn: "Show love to performers with tips during their streams. Support the creators you enjoy.",
        descEs: "Demuestra tu apoyo a los performers con propinas durante sus transmisiones.",
        illustration: "tips",
      },
      {
        titleEn: "Book Sessions",
        titleEs: "Reserva Sesiones",
        descEn: "Book private sessions with performers for one-on-one time.",
        descEs: "Reserva sesiones privadas con performers para tiempo uno a uno.",
        illustration: "bookSession",
      },
    ],
  },

  nearby: {
    slides: [
      {
        titleEn: "Discover Nearby",
        titleEs: "Descubre Cercanos",
        descEn: "Find community members and places near you on an interactive map.",
        descEs: "Encuentra miembros de la comunidad y lugares cercanos en un mapa interactivo.",
        illustration: "mapDiscovery",
      },
      {
        titleEn: "Privacy Controls",
        titleEs: "Controles de Privacidad",
        descEn: "Adjust your search radius or go incognito. You control who can see you.",
        descEs: "Ajusta tu radio de busqueda o activa el modo incognito. Tu controlas quien te ve.",
        illustration: "privacy",
      },
    ],
  },

  social: {
    slides: [
      {
        titleEn: "Social Feed",
        titleEs: "Feed Social",
        descEn: "Share thoughts, photos, and moments with the community. Express yourself freely.",
        descEs: "Comparte pensamientos, fotos y momentos con la comunidad. Expresate libremente.",
        illustration: "socialPost",
      },
      {
        titleEn: "Engage & Connect",
        titleEs: "Interactua y Conecta",
        descEn: "Like posts, follow people, and build your network within the community.",
        descEs: "Da like a publicaciones, sigue personas y construye tu red dentro de la comunidad.",
        illustration: "engage",
      },
      {
        titleEn: "Community Rules",
        titleEs: "Reglas de la Comunidad",
        descEn: "Complaints and support requests on the social feed are prohibited and may result in a ban. For help, contact Cristina AI — your customer support assistant — available anytime from the menu.",
        descEs: "Las quejas y solicitudes de soporte en el feed social estan prohibidas y pueden resultar en un ban. Para ayuda, contacta a Cristina AI — tu asistente de soporte — disponible en cualquier momento desde el menu.",
        illustration: "navigate",
      },
      {
        titleEn: "Illegal Content",
        titleEs: "Contenido Ilegal",
        descEn: "Any illegal content posted on the feed will be immediately reported to law enforcement authorities. Keep the community safe.",
        descEs: "Cualquier contenido ilegal publicado en el feed sera reportado de inmediato a las autoridades policiales. Mantengamos la comunidad segura.",
        illustration: "welcome",
      },
    ],
  },

  dm: {
    slides: [
      {
        titleEn: "Direct Messages",
        titleEs: "Mensajes Directos",
        descEn: "Private one-on-one conversations. Your messages stay between you and them.",
        descEs: "Conversaciones privadas uno a uno. Tus mensajes se quedan entre ustedes.",
        illustration: "directMessage",
      },
      {
        titleEn: "Share Media",
        titleEs: "Comparte Media",
        descEn: "Send photos and media directly in your private chats.",
        descEs: "Envia fotos y media directamente en tus chats privados.",
        illustration: "shareMedia",
      },
    ],
  },

  subscribe: {
    slides: [
      {
        titleEn: "Choose Your Plan",
        titleEs: "Elige Tu Plan",
        descEn: "Pick the plan that fits you. Member gives you social features and hangouts. PRIME unlocks everything — PRIME media, exclusive content, nearby premium, and more.",
        descEs: "Elige el plan que te convenga. Member te da funciones sociales y hangouts. PRIME desbloquea todo — PRIME media, contenido exclusivo, nearby premium y mas.",
        illustration: "subscribePlans",
      },
      {
        titleEn: "Pay Your Way",
        titleEs: "Paga a Tu Manera",
        descEn: "Pay with credit/debit card or PSE bank transfer via ePayco. Or pay with USDC crypto from any wallet or exchange — Coinbase, MetaMask, Binance, and more via Daimo.",
        descEs: "Paga con tarjeta de credito/debito o transferencia PSE via ePayco. O paga con crypto USDC desde cualquier wallet o exchange — Coinbase, MetaMask, Binance y mas via Daimo.",
        illustration: "paymentMethods",
      },
      {
        titleEn: "Instant Access",
        titleEs: "Acceso Instantaneo",
        descEn: "After payment, your credentials are sent to your email and Telegram. Your subscription activates immediately — no waiting.",
        descEs: "Despues del pago, tus credenciales se envian a tu email y Telegram. Tu suscripcion se activa de inmediato — sin esperas.",
        illustration: "instantAccess",
      },
    ],
  },

  profile: {
    slides: [
      {
        titleEn: "Your Profile",
        titleEs: "Tu Perfil",
        descEn: "Customize your avatar, display name, and bio. Control your privacy — choose what others can see, like your location and interests.",
        descEs: "Personaliza tu avatar, nombre y bio. Controla tu privacidad — elige que pueden ver los demas, como tu ubicacion e intereses.",
        illustration: "profileCustomize",
      },
      {
        titleEn: "Connect Accounts",
        titleEs: "Conecta Cuentas",
        descEn: "Link your Bluesky or X account to enrich your profile and cross-post.",
        descEs: "Vincula tu cuenta de Bluesky o X para enriquecer tu perfil y publicar en ambos.",
        illustration: "connectAccounts",
      },
    ],
  },
};
