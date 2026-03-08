const strings = {
  en: {
    // Page meta
    pageTitle: "Live Streams — PNPtv!",
    pageDescription:
      "Watch live broadcasts, tip performers, and book private sessions on PNPtv.",

    // Header
    liveTitle: "Live",
    liveSubtitle: "Watch live broadcasts and tip performers",

    // Stream status badges
    statusLive: "LIVE",
    statusOffline: "Offline",

    // Viewer count
    watching: (n: number) => `${n} watching`,

    // Go Live button
    goLive: "Go Live",
    goLiveLoading: "Loading...",

    // No streams empty state
    noStreamsAvailable: "No Streams Available",
    noStreamsHint: "Check back later for live content",
    refresh: "Refresh",
    refreshStreams: "Refresh streams",

    // Stream sections
    allStreams: "All Streams",
    performers: "Performers",

    // Performer labels
    performerFeatured: "Featured",
    performerAvailable: "Available",
    performerTipping: "Tipping",

    // Error state
    streamServiceUnavailable: "Stream service temporarily unavailable.",

    // Tip bar
    sendATip: "Send a Tip",
    tipTo: (name: string) => `to ${name}`,
    selectPerformerError: "Select a performer to tip",
    insufficientTokens: (balance: number) =>
      `Insufficient tokens. You have ${balance} tokens. Buy more below.`,
    tokensSentSuccess: (amount: number, name: string) =>
      `${amount} tokens sent to ${name}!`,
    paymentWindowOpened: (amount: number) =>
      `Payment window opened for $${amount} tip`,
    tipSubmitted: (amount: number) => `$${amount} tip submitted!`,
    errorFailedToSendTip: "Failed to send tip",

    // Tip payment tabs
    tabTokens: "Tokens",
    tabDaimoCrypto: "Daimo / Crypto",
    tokenInstantNote: "Instant · No popup · 1 token = $1 USD",

    // Add tip message toggle
    addAMessage: "+ Add a message",
    hideMessage: "Hide message",
    tipMessagePlaceholder: "Your message (optional)",

    // Login prompt
    loginToTip: "Log in to send tips to performers",
    loginToChat: "Log in to chat",

    // Token wallet widget
    tokenBalance: "Token Balance",
    tokens: "tokens",
    linkDpns: "Link DPNS",
    history: "History",
    buyTokens: "Buy Tokens",
    dpnsPlaceholder: "yourname.dash",
    save: "Save",
    saving: "Saving...",
    invalidDpnsHandle: "Invalid DPNS handle",
    viewPurchaseHistory: "View purchase history",

    // Buy tokens modal
    buyPnpTokensTitle: "Buy PNP Tokens with Dash",
    buyTokensPoweredBy: "Powered by",
    buyTokensRateNote:
      "1 token = $1 USD. Use tokens for instant tips — no popups, no waiting.",
    buyTokensCheckoutNote:
      "A Dash checkout window will open. Once payment is confirmed, tokens are credited automatically.",
    yourDashIdentity: (handle: string) => ` Your Dash identity: @${handle}`,
    loadingPackages: "Loading packages...",
    tokensLabel: "tokens",
    opening: "Opening...",
    errorDashUnavailable:
      "Dash payments are not available yet. Contact support.",
    errorPaymentServerDown:
      "Payment server is temporarily unavailable. Please try again later.",
    errorFailedToOpenCheckout: "Failed to open Dash checkout",

    // Wallet history modal
    tokenPurchaseHistoryTitle: "Token Purchase History",
    noPurchasesYet: "No purchases yet.",

    // Live chat
    liveChatTitle: "Live Chat",
    chatConnected: "Connected",
    chatConnecting: "Connecting...",
    chatBeFirstToSay: "Be the first to say hi!",
    chatConnectingToChat: "Connecting to chat...",
    saySomething: "Say something...",
    send: "Send",
    sendChatMessage: "Send chat message",

    // Recent tips ticker
    recentTipsTitle: "Recent Tips",
    recentTipBy: "by",
    recentTipTo: "to",
    justNow: "just now",
    minutesAgo: (m: number) => `${m}m ago`,
    hoursAgo: (h: number) => `${h}h ago`,
    daysAgo: (d: number) => `${d}d ago`,

    // Book a session
    bookAPrivateSession: "Book a Private Session",
    openFullCalendar: "Open Full Calendar",
    loadingBooking: "Loading booking...",
    bookingCalendarTitle: "Booking Calendar",
    sessionTimezoneNote:
      "Sessions are scheduled in your local timezone. You'll receive a confirmation with details.",

    // Go Live modal
    goLiveModalTitle: "Go Live",
    goLiveCredentialsNote:
      "Use these credentials in OBS, Streamlabs, or any RTMP broadcaster.",
    rtmpServer: "RTMP Server",
    streamKey: "Stream Key",
    copyRtmpUrl: "Copy RTMP server URL",
    copyStreamKey: "Copy stream key",
    showStreamKey: "Show stream key",
    hideStreamKey: "Hide stream key",
    streamKeyWarning: "Keep this private. Never share your stream key.",
    closeGoLiveModal: "Close Go Live modal",
    errorFailedToLoadCredentials: "Failed to load stream credentials.",
    errorStreamingUnavailable: "Live streaming is not available right now.",

    // Browser Streamer
    browserStreamerTitle: "Browser Streamer",
    browserStreamerSubtitle: "Go live directly from your browser — no OBS required.",
    cameraLabel: "Camera",
    microphoneLabel: "Microphone",
    selectCamera: "Select camera...",
    selectMicrophone: "Select microphone...",
    previewLoading: "Starting preview...",
    cameraUnavailable: "Camera not available",
    cameraUnavailableHint: "Grant camera and microphone access to go live.",
    cameraPermissionDenied: "Camera/mic permission was denied.",
    cameraPermissionHowTo: "On mobile: tap the lock icon in the address bar → Site settings → allow Camera & Microphone. On installed PWA: go to your device Settings → Apps → PNPtv → Permissions.",
    cameraNotFound: "No camera or microphone found on this device.",
    browserNotSupported: "Your browser does not support live streaming. Try Chrome or Edge.",
    startStreaming: "Go Live",
    stopStreaming: "Stop Streaming",
    connecting: "Connecting...",
    statusConnecting: "Connecting",
    statusError: "Error",
    noChannelAssigned: "No streaming channel assigned to your account. Contact support.",
    streamError: "Stream error. Please try again.",
    viewers: (n: number) => `${n} viewer${n === 1 ? "" : "s"}`,
    duration: "Duration",
    connectionQuality: "Quality",
    qualityGood: "Good",
    qualityFair: "Fair",
    qualityPoor: "Poor",
    retryPermissions: "Try Again",
    tryAgain: "Try Again",

    // Live page
    viewProfile: "View Profile",
    communityLive: "Community Live",
    watchLive: "Watch Live",
    upgradeToMember: "Upgrade to Member",
    liveStreamsTitle: "Live Streams",
    freeUserUpsell: "Watch creators go live, tip with tokens, and book private sessions. Upgrade to Member to unlock live streaming.",
    streamNotFound: "Stream not found",
    streamOffline: "Stream Offline",
    checkBackLater: "Check back later",
    backToLive: "Back to Live",
    beFirstToChat: "Be the first to say something!",
    connectingToChat: "Connecting to chat...",
    logInToChat: "Log in to chat",
    tipFailed: "Tip failed",
    tipSuccess: "Tip sent!",
    noPerformersAvailable: "No performers or streams available right now",
    failedToLoadStreams: "Couldn't load streams. Pull down to refresh.",
    loadingBookingFailed: "Booking calendar couldn't load.",
    retryLoading: "Retry",
  },

  es: {
    // Page meta
    pageTitle: "Transmisiones en vivo — PNPtv!",
    pageDescription:
      "Mira transmisiones en vivo, envía propinas a artistas y reserva sesiones privadas en PNPtv.",

    // Header
    liveTitle: "En vivo",
    liveSubtitle: "Mira transmisiones en vivo y da propinas a los artistas",

    // Stream status badges
    statusLive: "EN VIVO",
    statusOffline: "Desconectado",

    // Viewer count
    watching: (n: number) => `${n} viendo`,

    // Go Live button
    goLive: "Transmitir",
    goLiveLoading: "Cargando...",

    // No streams empty state
    noStreamsAvailable: "Sin transmisiones disponibles",
    noStreamsHint: "Vuelve más tarde para ver contenido en vivo",
    refresh: "Actualizar",
    refreshStreams: "Actualizar transmisiones",

    // Stream sections
    allStreams: "Todas las transmisiones",
    performers: "Artistas",

    // Performer labels
    performerFeatured: "Destacado",
    performerAvailable: "Disponible",
    performerTipping: "Propineando",

    // Error state
    streamServiceUnavailable:
      "El servicio de transmisión no está disponible temporalmente.",

    // Tip bar
    sendATip: "Enviar propina",
    tipTo: (name: string) => `a ${name}`,
    selectPerformerError: "Selecciona un artista para dar propina",
    insufficientTokens: (balance: number) =>
      `Tokens insuficientes. Tienes ${balance} tokens. Compra más abajo.`,
    tokensSentSuccess: (amount: number, name: string) =>
      `¡${amount} tokens enviados a ${name}!`,
    paymentWindowOpened: (amount: number) =>
      `Ventana de pago abierta para propina de $${amount}`,
    tipSubmitted: (amount: number) => `¡Propina de $${amount} enviada!`,
    errorFailedToSendTip: "Error al enviar la propina",

    // Tip payment tabs
    tabTokens: "Tokens",
    tabDaimoCrypto: "Daimo / Cripto",
    tokenInstantNote: "Instantáneo · Sin ventanas emergentes · 1 token = $1 USD",

    // Add tip message toggle
    addAMessage: "+ Añadir un mensaje",
    hideMessage: "Ocultar mensaje",
    tipMessagePlaceholder: "Tu mensaje (opcional)",

    // Login prompt
    loginToTip: "Inicia sesión para dar propinas a los artistas",
    loginToChat: "Inicia sesión para chatear",

    // Token wallet widget
    tokenBalance: "Saldo de tokens",
    tokens: "tokens",
    linkDpns: "Vincular DPNS",
    history: "Historial",
    buyTokens: "Comprar tokens",
    dpnsPlaceholder: "tunombre.dash",
    save: "Guardar",
    saving: "Guardando...",
    invalidDpnsHandle: "Identificador DPNS inválido",
    viewPurchaseHistory: "Ver historial de compras",

    // Buy tokens modal
    buyPnpTokensTitle: "Comprar tokens PNP con Dash",
    buyTokensPoweredBy: "Impulsado por",
    buyTokensRateNote:
      "1 token = $1 USD. Usa tokens para propinas instantáneas — sin ventanas emergentes, sin esperas.",
    buyTokensCheckoutNote:
      "Se abrirá una ventana de pago de Dash. Una vez confirmado el pago, los tokens se acreditan automáticamente.",
    yourDashIdentity: (handle: string) =>
      ` Tu identidad Dash: @${handle}`,
    loadingPackages: "Cargando paquetes...",
    tokensLabel: "tokens",
    opening: "Abriendo...",
    errorDashUnavailable:
      "Los pagos con Dash no están disponibles aún. Contacta con soporte.",
    errorPaymentServerDown:
      "El servidor de pagos no está disponible temporalmente. Inténtalo más tarde.",
    errorFailedToOpenCheckout: "Error al abrir el pago de Dash",

    // Wallet history modal
    tokenPurchaseHistoryTitle: "Historial de compra de tokens",
    noPurchasesYet: "Sin compras todavía.",

    // Live chat
    liveChatTitle: "Chat en vivo",
    chatConnected: "Conectado",
    chatConnecting: "Conectando...",
    chatBeFirstToSay: "¡Sé el primero en saludar!",
    chatConnectingToChat: "Conectando al chat...",
    saySomething: "Di algo...",
    send: "Enviar",
    sendChatMessage: "Enviar mensaje al chat",

    // Recent tips ticker
    recentTipsTitle: "Propinas recientes",
    recentTipBy: "de",
    recentTipTo: "a",
    justNow: "ahora mismo",
    minutesAgo: (m: number) => `hace ${m}m`,
    hoursAgo: (h: number) => `hace ${h}h`,
    daysAgo: (d: number) => `hace ${d}d`,

    // Book a session
    bookAPrivateSession: "Reservar una sesión privada",
    openFullCalendar: "Abrir calendario completo",
    loadingBooking: "Cargando reserva...",
    bookingCalendarTitle: "Calendario de reservas",
    sessionTimezoneNote:
      "Las sesiones se programan en tu zona horaria local. Recibirás una confirmación con los detalles.",

    // Go Live modal
    goLiveModalTitle: "Transmitir en vivo",
    goLiveCredentialsNote:
      "Usa estas credenciales en OBS, Streamlabs o cualquier emisor RTMP.",
    rtmpServer: "Servidor RTMP",
    streamKey: "Clave de transmisión",
    copyRtmpUrl: "Copiar URL del servidor RTMP",
    copyStreamKey: "Copiar clave de transmisión",
    showStreamKey: "Mostrar clave de transmisión",
    hideStreamKey: "Ocultar clave de transmisión",
    streamKeyWarning:
      "Mantenla en privado. Nunca compartas tu clave de transmisión.",
    closeGoLiveModal: "Cerrar modal de transmisión",
    errorFailedToLoadCredentials:
      "Error al cargar las credenciales de transmisión.",
    errorStreamingUnavailable:
      "La transmisión en vivo no está disponible ahora mismo.",

    // Browser Streamer
    browserStreamerTitle: "Transmitir desde el Navegador",
    browserStreamerSubtitle: "Transmite en vivo directamente desde tu navegador — sin OBS.",
    cameraLabel: "Cámara",
    microphoneLabel: "Micrófono",
    selectCamera: "Seleccionar cámara...",
    selectMicrophone: "Seleccionar micrófono...",
    previewLoading: "Iniciando vista previa...",
    cameraUnavailable: "Cámara no disponible",
    cameraUnavailableHint: "Permite el acceso a la cámara y micrófono para transmitir.",
    cameraPermissionDenied: "Permiso de cámara/micrófono denegado.",
    cameraPermissionHowTo: "En móvil: toca el ícono del candado en la barra de dirección → Configuración del sitio → permite Cámara y Micrófono. En PWA instalada: ve a Ajustes → Apps → PNPtv → Permisos.",
    cameraNotFound: "No se encontró cámara ni micrófono en este dispositivo.",
    browserNotSupported: "Tu navegador no soporta transmisión en vivo. Prueba Chrome o Edge.",
    startStreaming: "Transmitir",
    stopStreaming: "Detener Transmisión",
    connecting: "Conectando...",
    statusConnecting: "Conectando",
    statusError: "Error",
    noChannelAssigned: "No hay canal asignado a tu cuenta. Contacta con soporte.",
    streamError: "Error de transmisión. Inténtalo de nuevo.",
    viewers: (n: number) => `${n} espectador${n === 1 ? "" : "es"}`,
    duration: "Duración",
    connectionQuality: "Calidad",
    qualityGood: "Buena",
    qualityFair: "Regular",
    qualityPoor: "Mala",
    retryPermissions: "Intentar de nuevo",
    tryAgain: "Intentar de nuevo",

    // Live page
    viewProfile: "Ver Perfil",
    communityLive: "En Vivo Comunidad",
    watchLive: "Ver en Vivo",
    upgradeToMember: "Actualizar a Member",
    liveStreamsTitle: "Transmisiones en Vivo",
    freeUserUpsell: "Mira a creadores en vivo, envía propinas con tokens y reserva sesiones privadas. Actualiza a Member para desbloquear streaming en vivo.",
    streamNotFound: "Transmisión no encontrada",
    streamOffline: "Transmisión Fuera de Línea",
    checkBackLater: "Vuelve más tarde",
    backToLive: "Volver a En Vivo",
    beFirstToChat: "¡Sé el primero en decir algo!",
    connectingToChat: "Conectando al chat...",
    logInToChat: "Inicia sesión para chatear",
    tipFailed: "Propina fallida",
    tipSuccess: "¡Propina enviada!",
    noPerformersAvailable: "No hay performers o transmisiones disponibles ahora",
    failedToLoadStreams: "No se pudieron cargar las transmisiones. Desliza hacia abajo para refrescar.",
    loadingBookingFailed: "No se pudo cargar el calendario de reservas.",
    retryLoading: "Reintentar",
  },
} as const;

export type LiveStrings = typeof strings.en;
export { strings as live };
