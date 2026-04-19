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
        descEn: "Step 1: Go to the Subscribe tab. You'll see two plans — Member (social features & hangouts) and PRIME (everything unlocked: PRIME media, exclusive content, nearby premium, creator subscriptions, and more). Tap the plan you want.",
        descEs: "Paso 1: Ve a la pestana Suscribirse. Veras dos planes — Member (funciones sociales y hangouts) y PRIME (todo desbloqueado: PRIME media, contenido exclusivo, nearby premium, suscripciones a creadores y mas). Toca el plan que quieras.",
        illustration: "subscribePlans",
      },
      {
        titleEn: "Enter Your Email",
        titleEs: "Ingresa Tu Email",
        descEn: "Step 2: Enter the email where you want to receive your login credentials and payment receipt. Double-check it — this is where your account info will be sent.",
        descEs: "Paso 2: Ingresa el email donde quieres recibir tus credenciales de acceso y recibo de pago. Verificalo bien — ahi se enviara la informacion de tu cuenta.",
        illustration: "subscribePlans",
      },
      {
        titleEn: "Pay with Card (ePayco)",
        titleEs: "Paga con Tarjeta (ePayco)",
        descEn: "Option A — Card / PSE: Select ePayco as your payment method. A secure checkout window opens. Enter your credit card, debit card, or PSE bank transfer details. Follow the on-screen prompts to confirm. Your payment is processed instantly.",
        descEs: "Opcion A — Tarjeta / PSE: Selecciona ePayco como metodo de pago. Se abre una ventana de pago segura. Ingresa los datos de tu tarjeta de credito, debito o transferencia PSE. Sigue las instrucciones en pantalla para confirmar. Tu pago se procesa al instante.",
        illustration: "paymentMethods",
      },
      {
        titleEn: "Pay with Dash (Crypto)",
        titleEs: "Paga con Dash (Crypto)",
        descEn: "Option B — Dash crypto: Select the Dash tab (the ninja icon). A payment screen opens with a QR code and Dash address. Scan it with any Dash wallet — the official Dash Wallet, Kraken, Uphold, or any exchange that supports Dash. Send the exact Dash amount shown. Confirmation typically lands in 2-5 minutes thanks to InstantSend.",
        descEs: "Opcion B — Crypto Dash: Selecciona la pestaña Dash (el ícono ninja). Se abre una pantalla de pago con código QR y dirección Dash. Escaneala con cualquier wallet Dash — Dash Wallet oficial, Kraken, Uphold, o cualquier exchange que soporte Dash. Envía la cantidad exacta de Dash que se muestra. La confirmación suele llegar en 2-5 minutos gracias a InstantSend.",
        illustration: "paymentMethods",
      },
      {
        titleEn: "Confirm Your Payment",
        titleEs: "Confirma Tu Pago",
        descEn: "Step 3: After paying, come back to the app and tap 'I've already paid'. We'll verify your payment. If using Dash, the page updates automatically once your payment confirms on the blockchain (typically 2-5 minutes). If using ePayco, confirmation is instant.",
        descEs: "Paso 3: Despues de pagar, regresa a la app y toca 'Ya pague'. Verificaremos tu pago. Si usas Dash, la página se actualiza automáticamente cuando se confirme en la blockchain (típicamente 2-5 minutos). Si usas ePayco, la confirmacion es instantanea.",
        illustration: "paymentMethods",
      },
      {
        titleEn: "You're In!",
        titleEs: "Ya Estas Dentro!",
        descEn: "Step 4: Once confirmed, your subscription activates immediately. Your login credentials are sent to your email and Telegram. No waiting, no approval needed — you're part of the community now. If anything goes wrong, chat with Cristina AI for instant help.",
        descEs: "Paso 4: Una vez confirmado, tu suscripcion se activa de inmediato. Tus credenciales se envian a tu email y Telegram. Sin esperas, sin aprobacion — ya eres parte de la comunidad. Si algo sale mal, habla con Cristina AI para ayuda instantanea.",
        illustration: "instantAccess",
      },
    ],
  },

  profile: {
    slides: [
      {
        titleEn: "We're Private, Not Invisible",
        titleEs: "Somos Privados, No Invisibles",
        descEn: "Hey! It's Cristina. Upload a profile pic — a selfie, an avatar, anything that represents you. This is a community where everyone is recognized and valued. Your face (or your vibe) helps others connect with you.",
        descEs: "Hey! Soy Cristina. Sube una foto de perfil — un selfie, un avatar, lo que te represente. Esta es una comunidad donde todos son reconocidos y valorados. Tu cara (o tu onda) ayuda a otros a conectar contigo.",
        illustration: "profileCustomize",
      },
      {
        titleEn: "Complete Your Profile",
        titleEs: "Completa Tu Perfil",
        descEn: "While you're at it, update your birthday and location too! Your birthday helps us celebrate you, and your location helps you find community nearby. Tap 'Edit Profile' to get started — it only takes a minute.",
        descEs: "Ya que estas aqui, actualiza tu fecha de nacimiento y ubicacion tambien! Tu cumple nos ayuda a celebrarte, y tu ubicacion te ayuda a encontrar comunidad cerca. Toca 'Editar Perfil' para empezar — solo toma un minuto.",
        illustration: "profileCustomize",
      },
      {
        titleEn: "Connect Accounts",
        titleEs: "Conecta Cuentas",
        descEn: "Link your X account to enrich your profile and cross-post.",
        descEs: "Vincula tu cuenta de X para enriquecer tu perfil y publicar en ambos.",
        illustration: "connectAccounts",
      },
    ],
  },
};
