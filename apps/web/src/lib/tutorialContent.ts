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
        titleEn: "The new improved Telegram groups",
        titleEs: "Los nuevos Telegram groups mejorados",
        descEn: "Hangouts work like the Telegram groups you already love — group chat, voice, video, screen-share — but rebuilt inside PNPtv with our community tools wired in.",
        descEs: "Los Hangouts funcionan como los Telegram groups que ya conoces — chat grupal, voz, video, compartir pantalla — pero reconstruidos dentro de PNPtv con nuestras herramientas de comunidad integradas.",
        illustration: "groupChat",
      },
      {
        titleEn: "Already have a TG group? Move it here.",
        titleEs: "¿Ya tienes un grupo de TG? Muevelo aqui.",
        descEn: "If you run a queer/PNP group on Telegram, you can move the whole crew into PNPtv as a Hangout. Reach out to Cristina AI from the menu and we'll help you migrate everyone over.",
        descEs: "Si manejas un grupo queer/PNP en Telegram, puedes mover toda la banda a PNPtv como un Hangout. Escribele a Cristina AI desde el menu y te ayudamos a migrar a todos.",
        illustration: "shareMedia",
      },
      {
        titleEn: "Voice & Video Calls",
        titleEs: "Llamadas de Voz y Video",
        descEn: "Tap the call button inside any Hangout to start voice or video. Anyone in the room can drop in — face to face, no scheduling needed.",
        descEs: "Toca el boton de llamada dentro de cualquier Hangout para iniciar voz o video. Quien este en la sala puede entrar — cara a cara, sin programar.",
        illustration: "videoCall",
      },
      {
        titleEn: "Create Your Own",
        titleEs: "Crea el Tuyo",
        descEn: "PRIME members spin up private Hangouts and invite who they want. Public, members-only, or invite-only — your call.",
        descEs: "Los miembros PRIME crean Hangouts privados e invitan a quienes quieran. Publico, solo-miembros o solo-por-invitacion — tu decides.",
        illustration: "createGroup",
      },
      {
        titleEn: "Community Rules",
        titleEs: "Reglas de la Comunidad",
        descEn: "Complaints and support requests in Hangouts are prohibited and may result in a ban. For help, chat with Cristina AI — your support assistant — available anytime from the menu.",
        descEs: "Las quejas y solicitudes de soporte en los Hangouts estan prohibidas y pueden resultar en un ban. Para ayuda, habla con Cristina AI — tu asistente de soporte — disponible en cualquier momento desde el menu.",
        illustration: "navigate",
      },
      {
        titleEn: "Illegal Content",
        titleEs: "Contenido Ilegal",
        descEn: "Any illegal content shared in Hangouts will be immediately reported to law enforcement authorities. Keep the community safe.",
        descEs: "Cualquier contenido ilegal compartido en los Hangouts sera reportado de inmediato a las autoridades policiales. Mantengamos la comunidad segura.",
        illustration: "welcome",
      },
    ],
  },

  mainstage: {
    slides: [
      {
        titleEn: "Online cinema, camming included",
        titleEs: "Cinema online, con camming incluido",
        descEn: "Main Stage is our online cinema. Watch PRIME videos with the whole room — and cam with the other guys at the same time. Cinema and after-party in one place.",
        descEs: "El Main Stage es nuestro cinema online. Mira videos PRIME con toda la sala — y camea con los otros parceros al mismo tiempo. Cinema y after en el mismo lugar.",
        illustration: "primeContent",
      },
      {
        titleEn: "Switch the view mode",
        titleEs: "Cambia el modo de vista",
        descEn: "Spotlight, Theater, Cinema, Karaoke or Everyone — pick the layout that fits the moment. Each viewer controls their own view, no one is locked in.",
        descEs: "Spotlight, Theater, Cinema, Karaoke o Everyone — elige el layout que va con el momento. Cada viewer controla su propia vista, nadie queda atado.",
        illustration: "browse",
      },
      {
        titleEn: "Control the video",
        titleEs: "Controla el video",
        descEn: "Skip, pause, or swap to a different PRIME video — and the whole room follows along in sync. No one falls behind, no one watches alone.",
        descEs: "Salta, pausa o cambia a otro video PRIME — y toda la sala lo sigue en sincronia. Nadie se atrasa, nadie ve solo.",
        illustration: "feed",
      },
      {
        titleEn: "Control the music",
        titleEs: "Controla la musica",
        descEn: "Cristina's radio plays in the background. Pause it, change the track, queue something hotter — even when a video is on. Set the vibe.",
        descEs: "La radio de Cristina suena de fondo. Pausala, cambia el track, mete algo mas caliente — incluso con un video puesto. Pon el ambiente.",
        illustration: "tips",
      },
    ],
  },

  prime: {
    slides: [
      {
        titleEn: "PNPtv PRIME Channel",
        titleEs: "Canal PNPtv PRIME",
        descEn: "Exclusive videos from top performers and the PNPtv crew. New uploads drop on the channel daily — keep checking back.",
        descEs: "Videos exclusivos de los mejores performers y del equipo PNPtv. Subimos contenido nuevo al canal todos los dias — vuelve seguido.",
        illustration: "primeContent",
      },
      {
        titleEn: "Browse & Watch",
        titleEs: "Explora y Mira",
        descEn: "Filter by performer, category or tag. Tap any video to watch full-screen, like it, or share the link with someone.",
        descEs: "Filtra por performer, categoria o tag. Toca cualquier video para verlo en pantalla completa, darle like o compartir el enlace.",
        illustration: "browse",
      },
      {
        titleEn: "See It in the Feed",
        titleEs: "Velo en el Feed",
        descEn: "The latest 10 PRIME drops also appear in a row at the top of your Feed. Swipe through and tap to watch — no need to leave the page.",
        descEs: "Los 10 ultimos drops de PRIME aparecen en una fila al inicio de tu Feed. Deslizate y toca para ver — sin salir de la pagina.",
        illustration: "feed",
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
        titleEn: "The Feed is LIVE",
        titleEs: "El Feed esta EN VIVO",
        descEn: "Post text, photos, videos — everything the community is talking about lands here. The featured card at the top is always the latest announcement.",
        descEs: "Publica texto, fotos, videos — todo lo que la comunidad esta hablando aterriza aqui. La tarjeta destacada arriba siempre es el anuncio mas reciente.",
        illustration: "socialPost",
      },
      {
        titleEn: "Engage & Connect",
        titleEs: "Interactua y Conecta",
        descEn: "Like, comment, share and translate any post. The PRIME video row at the top of the feed shows the latest drops — tap any thumbnail to watch.",
        descEs: "Dale like, comenta, comparte y traduce cualquier publicacion. La fila de videos PRIME al inicio del feed muestra los drops mas recientes — toca cualquier miniatura para ver.",
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
        descEn: "Private one-on-one conversations. Your messages stay between you and them — no group, no audience.",
        descEs: "Conversaciones privadas uno a uno. Tus mensajes se quedan entre ustedes — sin grupo, sin audiencia.",
        illustration: "directMessage",
      },
      {
        titleEn: "1:1 Video Calls",
        titleEs: "Videollamadas 1:1",
        descEn: "Tap the call button at the top of any DM to start a private video call. Face-to-face, end-to-end inside the app — no scheduling, no third-party app.",
        descEs: "Toca el boton de llamada en la parte superior de cualquier DM para iniciar una videollamada privada. Cara a cara, dentro de la app — sin programar, sin apps de terceros.",
        illustration: "videoCall",
      },
      {
        titleEn: "Share Media",
        titleEs: "Comparte Media",
        descEn: "Send photos, videos, and voice notes directly in your private chats. They disappear when you unfriend — no permanent trail.",
        descEs: "Envia fotos, videos y notas de voz directamente en tus chats privados. Desaparecen cuando dejas de ser amigo — sin rastro permanente.",
        illustration: "shareMedia",
      },
      {
        titleEn: "PRIME Required",
        titleEs: "Requiere PRIME",
        descEn: "Video calls in DMs are a PRIME feature. Upgrade from Subscribe if you don't have PRIME yet.",
        descEs: "Las videollamadas en DM son una funcion PRIME. Actualiza desde Suscribirse si aun no tienes PRIME.",
        illustration: "subscribePlans",
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
        titleEn: "Pay with Bitcoin / Crypto",
        titleEs: "Paga con Bitcoin / Crypto",
        descEn: "Option A — Bitcoin & 100+ coins: Select the Crypto tab. A NowPayments checkout opens. Choose your coin (BTC, ETH, USDT, and more), then scan the QR code or copy the wallet address. Send the exact amount shown. Confirmation typically lands in a few minutes.",
        descEs: "Opcion A — Bitcoin y mas de 100 criptomonedas: Selecciona la pestana Crypto. Se abre un checkout de NowPayments. Elige tu moneda (BTC, ETH, USDT, y mas), escanea el codigo QR o copia la direccion de wallet. Envia la cantidad exacta indicada. La confirmacion suele llegar en minutos.",
        illustration: "paymentMethods",
      },
      {
        titleEn: "Pay with Dash",
        titleEs: "Paga con Dash",
        descEn: "Option B — Dash crypto: Select the Dash tab (the ninja icon). A QR code and Dash address appear. Scan with any Dash wallet — the official Dash Wallet, Kraken, Uphold, or any exchange that supports Dash. Send the exact amount shown. Confirmation typically lands in 2-5 minutes thanks to InstantSend.",
        descEs: "Opcion B — Crypto Dash: Selecciona la pestana Dash (el icono ninja). Aparece un codigo QR y una direccion Dash. Escanea con cualquier wallet Dash — Dash Wallet oficial, Kraken, Uphold, o cualquier exchange que soporte Dash. Envia la cantidad exacta. La confirmacion suele llegar en 2-5 minutos gracias a InstantSend.",
        illustration: "paymentMethods",
      },
      {
        titleEn: "Confirm Your Payment",
        titleEs: "Confirma Tu Pago",
        descEn: "Step 3: After paying, come back to the app and tap 'I've already paid'. We'll verify your payment. The page updates automatically once your payment confirms on the blockchain (typically 2-5 minutes for Dash, a few minutes for other crypto).",
        descEs: "Paso 3: Despues de pagar, regresa a la app y toca 'Ya pague'. Verificaremos tu pago. La pagina se actualiza automaticamente cuando se confirme en la blockchain (tipicamente 2-5 minutos para Dash, unos minutos para otra crypto).",
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

  selfCare: {
    slides: [
      {
        titleEn: "Your Self-Care Center",
        titleEs: "Tu Centro de Autocuidado",
        descEn: "It's Cristina. This space is yours — optional, private, and always here when you want to take stock or take a break. Nothing leaves your account.",
        descEs: "Soy Cristina. Este espacio es tuyo — opcional, privado y siempre aquí cuando quieras hacer balance o tomar un descanso. Nada sale de tu cuenta.",
        illustration: "welcome",
      },
      {
        titleEn: "Use Tracker — Awareness, Not Judgment",
        titleEs: "Use Tracker — Consciencia, no juicio",
        descEn: "Log slams or smokes if you want to. Patterns surface gently over time. PNPtv staff cannot see your logs — they're encrypted to your account only.",
        descEs: "Registra slams o smokes si quieres. Los patrones aparecen suavemente con el tiempo. El equipo de PNPtv no puede ver tus registros — están cifrados solo para tu cuenta.",
        illustration: "privacy",
      },
      {
        titleEn: "Wellness Mode — Take a Break",
        titleEs: "Modo Bienestar — Toma un descanso",
        descEn: "When you need a sober break or just want to step away, flip Wellness Mode on. Only the wellness hangouts, Cristina, and your settings stay reachable. Once on, it can't be turned off for 24 hours — that's the point.",
        descEs: "Cuando necesites un descanso sobrio o solo quieras alejarte, activa Modo Bienestar. Solo los hangouts de bienestar, Cristina y tus ajustes quedan accesibles. Una vez activo, no se puede desactivar por 24 horas — ese es el punto.",
        illustration: "primeContent",
      },
      {
        titleEn: "Cristina — Your PNP Sister",
        titleEs: "Cristina — Tu hermana PNP",
        descEn: "Vent, ask for resources, find a sponsor, or just talk. No logs, no judgment, no scoring. What you tell her stays between you two.",
        descEs: "Desahógate, pide recursos, encuentra un padrino, o solo platica. Sin registros, sin juicios, sin puntuaciones. Lo que le cuentes queda entre ustedes dos.",
        illustration: "directMessage",
      },
    ],
  },

  channelUpload: {
    slides: [
      {
        titleEn: "Upload to Your Channel",
        titleEs: "Sube a tu Canal",
        descEn: "Drop a video file or tap to choose. Up to 4 GB. The video stays inside your channel — it doesn't auto-post to the social feed.",
        descEs: "Suelta un video o toca para elegir. Hasta 4 GB. El video se queda en tu canal — no se publica automáticamente al feed social.",
        illustration: "shareMedia",
      },
      {
        titleEn: "✨ AI Assist — Cristina Helps",
        titleEs: "✨ Asistente IA — Cristina te ayuda",
        descEn: "Tap Generate next to title, description, or tags. Cristina/Grok suggests bilingual copy and tags from your video's context. Always editable — accept, tweak, or rewrite.",
        descEs: "Toca Generar junto al título, descripción o tags. Cristina/Grok sugiere texto bilingüe y tags según el contexto del video. Siempre editable — acepta, ajusta o reescribe.",
        illustration: "engage",
      },
      {
        titleEn: "Smart Promo — One Card, Right CTA",
        titleEs: "Promo inteligente — Una tarjeta, el CTA correcto",
        descEn: "On publish, a teaser GIF lands in the social feed with the right call-to-action: free channels show Watch now, prime/paid channels show the upsell, and existing subscribers see Watch now too.",
        descEs: "Al publicar, un GIF teaser aparece en el feed social con el CTA correcto: canales gratis muestran Ver ahora, los canales prime/pagos muestran el upsell, y los suscriptores existentes también ven Ver ahora.",
        illustration: "subscribePlans",
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

  channels: {
    slides: [
      {
        titleEn: "Creator Channels",
        titleEs: "Canales de Creadores",
        descEn: "Channels are creator-owned video collections — exclusive content curated by your favorite performers. Each creator controls their own channel with original uploads just for subscribers.",
        descEs: "Los canales son colecciones de videos de creadores — contenido exclusivo curado por tus performers favoritos. Cada creador controla su propio canal con subidas originales solo para suscriptores.",
        illustration: "primeContent",
      },
      {
        titleEn: "Browse & Discover",
        titleEs: "Explora y Descubre",
        descEn: "Switch between Channels, Videos, and Discover tabs to find new creators. Use the search bar to filter by name or tag, or browse the creator strip at the bottom.",
        descEs: "Cambia entre las pestanas Canales, Videos y Descubrir para encontrar nuevos creadores. Usa la barra de busqueda para filtrar por nombre o etiqueta, o explora la tira de creadores abajo.",
        illustration: "browse",
      },
      {
        titleEn: "Free vs. Locked Content",
        titleEs: "Contenido Libre vs. Bloqueado",
        descEn: "Some channels are free to browse. Others require a creator subscription or PRIME. Locked videos show a preview thumbnail — subscribe to the creator to unlock full access.",
        descEs: "Algunos canales son gratis. Otros requieren una suscripcion al creador o PRIME. Los videos bloqueados muestran una miniatura — suscribete al creador para desbloquear el acceso completo.",
        illustration: "subscribePlans",
      },
      {
        titleEn: "Subscribe to a Creator",
        titleEs: "Suscribete a un Creador",
        descEn: "Tap any creator channel card and look for the Subscribe button. Subscriptions unlock all their exclusive content and support the creator directly.",
        descEs: "Toca cualquier tarjeta de canal de creador y busca el boton Suscribirse. Las suscripciones desbloquean todo su contenido exclusivo y apoyan al creador directamente.",
        illustration: "instantAccess",
      },
    ],
  },

  stream: {
    slides: [
      {
        titleEn: "Watching a Live Stream",
        titleEs: "Ver una Transmision en Vivo",
        descEn: "You are watching live — no rewind, no pause. The player starts automatically. If the stream has not started yet, the page will update as soon as it goes live.",
        descEs: "Estas viendo en vivo — sin rebobinar, sin pausar. El reproductor arranca automaticamente. Si la transmision aun no empezo, la pagina se actualizara en cuanto comience.",
        illustration: "liveStream",
      },
      {
        titleEn: "Chat & Etiquette",
        titleEs: "Chat y Etiqueta",
        descEn: "Use the chat panel to interact with the performer and other viewers. Keep it respectful — harassment or spam will get you removed. Support requests or complaints must go to Cristina AI, not the chat.",
        descEs: "Usa el panel de chat para interactuar con el performer y otros viewers. Mantente respetuoso — el acoso o spam te sacara de la sala. Las solicitudes de soporte o quejas deben ir a Cristina AI, no al chat.",
        illustration: "engage",
      },
      {
        titleEn: "Tip with Tokens",
        titleEs: "Propinas con Tokens",
        descEn: "Tap the tip button to send tokens to the performer. Choose a preset amount or enter a custom one. Tips are instant and appear in the stream as a shout-out. You can top up tokens anytime from the tip panel.",
        descEs: "Toca el boton de propina para enviar tokens al performer. Elige un monto predefinido o ingresa uno personalizado. Las propinas son instantaneas y aparecen en la transmision como un saludo. Puedes recargar tokens desde el panel de propinas.",
        illustration: "tips",
      },
      {
        titleEn: "Live Rules",
        titleEs: "Reglas del Vivo",
        descEn: "Some streams require you to acknowledge the creator's rules before entering. Read them carefully — they cover what is allowed in chat and during the session.",
        descEs: "Algunas transmisiones requieren que aceptes las reglas del creador antes de entrar. Lelas con atencion — cubren lo que esta permitido en el chat y durante la sesion.",
        illustration: "navigate",
      },
    ],
  },

  settings: {
    slides: [
      {
        titleEn: "Your Settings Hub",
        titleEs: "Tu Centro de Ajustes",
        descEn: "Everything that controls your account lives here: notifications, privacy, language, billing, and security. Tap any category to dive in — changes save instantly.",
        descEs: "Todo lo que controla tu cuenta vive aqui: notificaciones, privacidad, idioma, facturacion y seguridad. Toca cualquier categoria para acceder — los cambios se guardan al instante.",
        illustration: "profileCustomize",
      },
      {
        titleEn: "Privacy & Language",
        titleEs: "Privacidad e Idioma",
        descEn: "Under Privacy you control who sees your profile and location. Under Preferences you switch the app language between English and Spanish — and enable Wellness Mode when you need a break.",
        descEs: "En Privacidad controlas quien ve tu perfil y ubicacion. En Preferencias cambias el idioma de la app entre ingles y espanol — y activas Modo Bienestar cuando necesitas un descanso.",
        illustration: "privacy",
      },
      {
        titleEn: "Account & Billing",
        titleEs: "Cuenta y Facturacion",
        descEn: "Account lets you update your email, password, and linked identity providers. Payments shows your subscription status, active plan, and transaction history.",
        descEs: "Cuenta te permite actualizar tu email, contrasena y proveedores de identidad vinculados. Pagos muestra tu estado de suscripcion, plan activo e historial de transacciones.",
        illustration: "subscribePlans",
      },
    ],
  },

  creatorProfile: {
    slides: [
      {
        titleEn: "Creator Profile",
        titleEs: "Perfil de Creador",
        descEn: "This is a creator's public profile. Browse their posts, exclusive content, and channel videos all in one place. Tap Follow to see their updates in your feed.",
        descEs: "Este es el perfil publico de un creador. Explora sus publicaciones, contenido exclusivo y videos de canal en un solo lugar. Toca Seguir para ver sus novedades en tu feed.",
        illustration: "socialPost",
      },
      {
        titleEn: "Tip & Subscribe",
        titleEs: "Propina y Suscripcion",
        descEn: "Tap the Tip button to send tokens directly to this creator. To unlock their exclusive content, look for the Subscribe button — it opens the creator's channel subscription.",
        descEs: "Toca el boton Propina para enviar tokens directamente a este creador. Para desbloquear su contenido exclusivo, busca el boton Suscribirse — abre la suscripcion al canal del creador.",
        illustration: "tips",
      },
      {
        titleEn: "Channels & Exclusive Content",
        titleEs: "Canales y Contenido Exclusivo",
        descEn: "The Channels tab shows all videos this creator has published. The Exclusive tab (when available) shows subscriber-only posts. Subscribe to this creator to see everything they have made.",
        descEs: "La pestana Canales muestra todos los videos que este creador ha publicado. La pestana Exclusivo (cuando esta disponible) muestra publicaciones solo para suscriptores. Suscribete a este creador para ver todo lo que ha hecho.",
        illustration: "primeContent",
      },
    ],
  },
};
