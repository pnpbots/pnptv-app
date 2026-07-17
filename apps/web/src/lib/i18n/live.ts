const strings = {
  en: {
    // Page meta
    pageTitle: "Live Streams — PNPtv!",
    pageDescription:
      "Watch live broadcasts, tip performers, and book private sessions on PNPtv.",

    // Header
    liveTitle: "PNP Live",
    liveSubtitle: "Live broadcasts, tips & private sessions",

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
      `Tokens insuficientes. Tienes ${balance} tokens. Compra más abajo.`,
    tokensSentSuccess: (amount: number, name: string) =>
      `¡${amount} tokens enviados a ${name}!`,
    paymentWindowOpened: (amount: number) =>
      `Payment window opened for ${amount} tokens tip`,
    tipSubmitted: (amount: number) => `${amount} tokens tip sent!`,
    errorFailedToSendTip: "Failed to send tip",

    // Tip payment tabs
    tabTokens: "Tokens",
    tokenInstantNote: "Instant · No popup · No waiting",

    // Add tip message toggle
    addAMessage: "+ Add a message",
    hideMessage: "Hide message",
    tipMessagePlaceholder: "Your message (optional)",

    // Login prompt
    loginToTip: "Log in to send tips to performers",
    loginToChat: "Log in to chat",

    // Token wallet widget
    tokenBalance: "My Tokens",
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
      "Use tokens for instant tips — no popups, no waiting.",
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
    tokenPurchaseHistoryTitle: "Ficha Purchase History",
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

    // Pre-stream setup screen
    setupTitle: "Stream Setup",
    setupSubtitle: "Set your stream details before going live",
    streamTitleLabel: "Stream Title",
    streamTitlePlaceholder: "What are you streaming today?",
    streamTitleRequired: "A stream title is required",
    streamDescLabel: "Description",
    streamDescPlaceholder: "Tell viewers what this stream is about (optional)",
    categoryLabel: "Category",
    thumbnailLabel: "Thumbnail",
    captureThumbnail: "Capture from Preview",
    thumbnailCaptured: "Thumbnail captured",
    recapture: "Recapture",
    connectionTestLabel: "Connection Test",
    testConnection: "Test Connection",
    testingConnection: "Testing...",
    connectionExcellent: "Excellent",
    connectionGood: "Good",
    connectionFair: "Fair",
    connectionPoor: "Poor",
    connectionTestHint: "Tests upload speed to estimate stream quality",
    continueSetup: "Continue to Preview",
    backToSetup: "Back to Setup",

    // Countdown overlay
    countdownLabel: "Going live in",

    // Category tags
    tagClouds: "Clouds",
    tagSlamming: "Slamming",
    tagKinks: "Kinks",
    tagChill: "Chill",
    tagParty: "Party",
    tagHookups: "Hookups",
    tagAfterHours: "After Hours",

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

    // Main Stage — modes
    mainStageModeSpotlight: "Spotlight",
    mainStageModeTheater: "Theater",
    mainStageModeCinema: "Cinema",
    mainStageModeKaraoke: "Karaoke",
    mainStageModeEqual: "Everyone",

    // Main Stage — mode subtitles (admin panel)
    mainStageModeSpotlightSub: "Pin one cammer as hero",
    mainStageModeTheaterSub: "Velvet curtains frame the video",
    mainStageModeCinemaSub: "Media takes the stage",
    mainStageModeKaraokeSub: "Video full, cammer in corner",
    mainStageModeEqualSub: "Grid of all cammers",

    // Main Stage — header
    mainStageTitle: "Main Stage",

    // Main Stage — bottom bar buttons
    mainStageLeave: "Leave",
    mainStageStop: "Stop",
    mainStageGoLive: "Go live",

    // Main Stage — bottom bar aria-labels
    mainStageAriaLeave: "Leave Main Stage",
    mainStageAriaStopCam: "Stop streaming (leave cam)",
    mainStageAriaStartCam: "Go live (start streaming)",
    mainStageAriaMicDisabled: "Microphone disabled (turn on camera first)",
    mainStageAriaMicMute: "Mute microphone",
    mainStageAriaMicUnmute: "Unmute microphone",
    mainStageAriaOpenAdmin: "Open admin controls",
    mainStageAriaCloseAdmin: "Close admin panel",
    mainStageAriaDismiss: "Dismiss",

    // Main Stage — connection overlay
    mainStageConnectionLost: "Connection lost",
    mainStageReconnecting: "Reconnecting…",
    mainStageConnecting: "Connecting…",

    // Main Stage — error / unavailable states
    mainStageFailedToConnect: "Failed to connect",
    mainStageNoState: "No state received from the server. Try reloading.",
    mainStageUnavailable: "Main Stage unavailable",
    mainStageTryAgain: "Try again",
    mainStageGoBack: "Go back",
    mainStageReload: "Reload",
    mainStageAdminOnly: "Admin only",
    mainStageNoPermission: "You don't have permission to view this page.",
    mainStageBackToStage: "Back to Main Stage",
    mainStageLoading: "Loading…",
    mainStageFailedToLoadState: "Failed to load state",
    mainStageRetry: "Retry",

    // Main Stage — camera / device errors
    mainStageErrCameraPermission: "Camera permission denied. Enable it in your browser settings and tap Go live again.",
    mainStageErrNoCamera: "No camera detected. Make sure a camera is connected.",
    mainStageErrCameraInUse: "Camera is in use by another app. Close it and retry.",

    // Main Stage — toolbar buttons (aria / title)
    mainStageAriaFullscreen: "Enter fullscreen",
    mainStageAriaExitFullscreen: "Exit fullscreen",
    mainStageTitleFullscreen: "Fullscreen",
    mainStageAriaShuffle: "Shuffle cammers",
    mainStageAriaResetView: "Reset to room default",
    mainStageAriaGoToStage: "Go to Main Stage",
    mainStageAriaShowTutorial: "Show how-to guide",
    mainStageSettingsTitle: "Settings",
    mainStageHostControlsBanner: "Video, audio, and participants are managed by the host.",
    mainStageResetToRoomDefault: "Reset to room default",
    mainStageLayoutPersonalHint: "Pick your view — only you see this. The host's pick is the room default.",

    // Main Stage — FAB labels
    mainStageFabLabel: "Main Stage",
    mainStageFabOnCam: "ON CAM",
    mainStageFabLiveNow: "LIVE NOW",

    // Main Stage — admin panel
    mainStageAdminTitle: "Admin Controls",
    mainStageAdminSectionLayout: "Layout Mode",
    mainStageAdminSectionPrimeVideos: "Prime Videos",
    mainStageAdminSectionCustomUrl: "Custom URL",
    mainStageAdminSectionParticipants: "Participants",
    mainStageAdminNoCammers: "No cammers on stage",
    mainStageAdminSpotlighted: "Spotlighted",
    mainStageAdminMute: "Mute",
    mainStageAdminKick: "Kick",
    mainStageAdminTitleSpotlight: "Set as spotlight",
    mainStageAdminAriaSpotlight: (identity: string) => `Spotlight ${identity}`,
    mainStageAdminAriaMute: (identity: string) => `Mute ${identity}`,
    mainStageAdminAriaKick: (identity: string) => `Kick ${identity}`,
    mainStageAdminPause: "Pause",
    mainStageAdminResume: "Resume",
    mainStageAdminStop: "Stop",
    mainStageAdminPlay: "Play",
    mainStageAdminNoPrimeVideos: "No published Prime Videos in CMS",
    mainStageAdminUrlPlaceholder: "Video or stream URL…",
    mainStageAdminAriaMediaUrl: "Media URL",
    mainStageAdminAriaPlayVideo: (title: string) => `Play ${title}`,
    mainStageAdminConsole: "Admin Console",
    mainStageAdminSectionAudio: "Audio Mix",
    mainStageAdminAudioMedia: "Media",
    mainStageAdminAudioCams: "Cammers",
    mainStageAdminAudioHint: "Drops are debounced. Release to commit.",
    mainStageQueuePosition: (pos: number, total: number) =>
      `Position ${pos} / ${total}`,
    mainStageQueueLive: "Live now",
    mainStageQueueNext: (sec: number) =>
      sec > 0 ? `~${sec}s to live` : "Live next",

    // Main Stage — standby / empty states
    mainStageStandby: "Standby",
    mainStageNoMediaPlaying: "No media playing · Admin controls playback",
    mainStageStageQuiet: "The stage is yours",
    mainStageStageQuietHint: "Drop in. Turn the cam on. Own the moment.",
    mainStageNobodyOnCam: "Nobody on cam yet",
    mainStageNobodyOnCamHint: "Expose yourself. The room is here for you — tap Go live to be first on.",
    // Main Stage — hero copy (cam-first framing)
    mainStageHeroTitle: "Main Stage — your spotlight.",
    mainStageHeroSubtitle: "Go live and be seen.",
    mainStageHeroCta: "Expose yourself.",

    // Main Stage — media player
    mainStageNowPlaying: "Now Playing",
    mainStagePaused: "Paused",
    mainStageTapForSound: "Tap for sound",
    mainStageAriaUnmute: "Unmute",
    mainStageNowPlayingLabel: "Now playing",
    mainStageNowPlayingAriaLabel: (title: string) => `Now playing: ${title}`,

    // Main Stage — Prime watermark
    mainStageWatermarkSubscribeTo: "Subscribe to",
    mainStageWatermarkCta: "to watch without limits →",
    mainStageWatermarkAria: "Subscribe to PNPtv! PRIME",

    // Main Stage — spotlight countdown chip
    mainStageCountdownRotating: "Rotating...",
    mainStageCountdownNext: (m: number, s: string) => `Next: ${m}:${s}`,
    mainStageAriaFocusTile: (identity: string) => `Focus ${identity}`,

    // Main Stage — wellness tips overlay
    mainStageWellnessTipLabel: "Wellness tip",
    mainStageWellnessMoreResources: "More resources",
    mainStageWellnessAriaDismiss: "Dismiss wellness tip",

    // Main Stage — reconnecting banner
    mainStageReconnectingBanner: "Reconnecting…",

    // Main Stage — admin counts subtitle
    mainStageCammers: "cammers",
    mainStageWatching: "watching",
  },

  es: {
    // Page meta
    pageTitle: "Transmisiones en vivo — PNPtv!",
    pageDescription:
      "Mira transmisiones en vivo, envía propinas a artistas y reserva sesiones privadas en PNPtv.",

    // Header
    liveTitle: "PNP Live",
    liveSubtitle: "Transmisiones en vivo, propinas y sesiones privadas",

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
      `Ventana de pago abierta para propina de ${amount} tokens`,
    tipSubmitted: (amount: number) => `¡Propina de ${amount} tokens enviada!`,
    errorFailedToSendTip: "Error al enviar la propina",

    // Tip payment tabs
    tabTokens: "Tokens",
    tokenInstantNote: "Instantáneo · Sin esperas · Sin ventanas emergentes",

    // Add tip message toggle
    addAMessage: "+ Añadir un mensaje",
    hideMessage: "Ocultar mensaje",
    tipMessagePlaceholder: "Tu mensaje (opcional)",

    // Login prompt
    loginToTip: "Inicia sesión para dar propinas a los artistas",
    loginToChat: "Inicia sesión para chatear",

    // Token wallet widget
    tokenBalance: "Mis Tokens",
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
    buyPnpTokensTitle: "Comprar Tokens PNP con Dash",
    buyTokensPoweredBy: "Impulsado por",
    buyTokensRateNote:
      "Usa tokens para propinas instantáneas — sin ventanas emergentes, sin esperas.",
    buyTokensCheckoutNote:
      "Se abrirá una ventana de pago de Dash. Una vez confirmado el pago, las tokens se acreditan automáticamente.",
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
    tokenPurchaseHistoryTitle: "Historial de tokens",
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

    // Pre-stream setup screen
    setupTitle: "Configuración del Stream",
    setupSubtitle: "Define los detalles antes de transmitir",
    streamTitleLabel: "Título del Stream",
    streamTitlePlaceholder: "¿Qué vas a transmitir hoy?",
    streamTitleRequired: "El título del stream es obligatorio",
    streamDescLabel: "Descripción",
    streamDescPlaceholder: "Cuéntales a los espectadores de qué trata (opcional)",
    categoryLabel: "Categoría",
    thumbnailLabel: "Miniatura",
    captureThumbnail: "Capturar de la vista previa",
    thumbnailCaptured: "Miniatura capturada",
    recapture: "Recapturar",
    connectionTestLabel: "Prueba de conexión",
    testConnection: "Probar conexión",
    testingConnection: "Probando...",
    connectionExcellent: "Excelente",
    connectionGood: "Buena",
    connectionFair: "Regular",
    connectionPoor: "Mala",
    connectionTestHint: "Mide la velocidad de subida para estimar la calidad del stream",
    continueSetup: "Continuar a la vista previa",
    backToSetup: "Volver a configuración",

    // Countdown overlay
    countdownLabel: "En vivo en",

    // Category tags
    tagClouds: "Nubes",
    tagSlamming: "Slamming",
    tagKinks: "Kinks",
    tagChill: "Chill",
    tagParty: "Fiesta",
    tagHookups: "Encuentros",
    tagAfterHours: "After Hours",

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

    // Main Stage — modes
    mainStageModeSpotlight: "Destacado",
    mainStageModeTheater: "Teatro",
    mainStageModeCinema: "Cine",
    mainStageModeKaraoke: "Karaoke",
    mainStageModeEqual: "Todes",

    // Main Stage — mode subtitles (admin panel)
    mainStageModeSpotlightSub: "Un cammer como protagonista",
    mainStageModeTheaterSub: "Cortinas de terciopelo enmarcan el video",
    mainStageModeCinemaSub: "El contenido toma el escenario",
    mainStageModeKaraokeSub: "Video completo, cammer en esquina",
    mainStageModeEqualSub: "Grilla con todes los cammers",

    // Main Stage — header
    mainStageTitle: "Escenario Principal",

    // Main Stage — bottom bar buttons
    mainStageLeave: "Salir",
    mainStageStop: "Detener",
    mainStageGoLive: "Salir al aire",

    // Main Stage — bottom bar aria-labels
    mainStageAriaLeave: "Salir del Escenario Principal",
    mainStageAriaStopCam: "Dejar de transmitir (salir del cam)",
    mainStageAriaStartCam: "Salir al aire (iniciar transmisión)",
    mainStageAriaMicDisabled: "Micrófono desactivado (enciende la cámara primero)",
    mainStageAriaMicMute: "Silenciar micrófono",
    mainStageAriaMicUnmute: "Activar micrófono",
    mainStageAriaOpenAdmin: "Abrir controles de administración",
    mainStageAriaCloseAdmin: "Cerrar panel de administración",
    mainStageAriaDismiss: "Descartar",

    // Main Stage — connection overlay
    mainStageConnectionLost: "Conexión perdida",
    mainStageReconnecting: "Reconectando…",
    mainStageConnecting: "Conectando…",

    // Main Stage — error / unavailable states
    mainStageFailedToConnect: "Error al conectar",
    mainStageNoState: "No se recibió información del servidor. Intenta recargar.",
    mainStageUnavailable: "Escenario Principal no disponible",
    mainStageTryAgain: "Intentar de nuevo",
    mainStageGoBack: "Volver",
    mainStageReload: "Recargar",
    mainStageAdminOnly: "Solo administradores",
    mainStageNoPermission: "No tenés permiso para ver esta página.",
    mainStageBackToStage: "Volver al Escenario",
    mainStageLoading: "Cargando…",
    mainStageFailedToLoadState: "Error al cargar el estado",
    mainStageRetry: "Reintentar",

    // Main Stage — camera / device errors
    mainStageErrCameraPermission: "Permiso de cámara denegado. Actívalo en la configuración de tu navegador y volvé a tocar Salir al aire.",
    mainStageErrNoCamera: "No se detectó cámara. Asegurate de tener una conectada.",
    mainStageErrCameraInUse: "La cámara está en uso por otra app. Cerrala y volvé a intentar.",

    // Main Stage — toolbar buttons (aria / title)
    mainStageAriaFullscreen: "Pantalla completa",
    mainStageAriaExitFullscreen: "Salir de pantalla completa",
    mainStageTitleFullscreen: "Pantalla completa",
    mainStageAriaShuffle: "Mezclar cammers",
    mainStageAriaResetView: "Restablecer vista predeterminada",
    mainStageAriaGoToStage: "Ir al Escenario Principal",
    mainStageAriaShowTutorial: "Mostrar guía",
    mainStageSettingsTitle: "Ajustes",
    mainStageHostControlsBanner: "El video, audio y los participantes los maneja el host.",
    mainStageResetToRoomDefault: "Volver a la vista del host",
    mainStageLayoutPersonalHint: "Elige tu vista — solo tú la ves. La elección del host es la predeterminada.",

    // Main Stage — FAB labels
    mainStageFabLabel: "Escenario",
    mainStageFabOnCam: "EN CAM",
    mainStageFabLiveNow: "EN VIVO",

    // Main Stage — admin panel
    mainStageAdminTitle: "Controles de Admin",
    mainStageAdminSectionLayout: "Modo de Vista",
    mainStageAdminSectionPrimeVideos: "Videos PRIME",
    mainStageAdminSectionCustomUrl: "URL Personalizada",
    mainStageAdminSectionParticipants: "Participantes",
    mainStageAdminNoCammers: "Ningún cammer en escena",
    mainStageAdminSpotlighted: "Destacado",
    mainStageAdminMute: "Silenciar",
    mainStageAdminKick: "Expulsar",
    mainStageAdminTitleSpotlight: "Poner en spotlight",
    mainStageAdminAriaSpotlight: (identity: string) => `Destacar a ${identity}`,
    mainStageAdminAriaMute: (identity: string) => `Silenciar a ${identity}`,
    mainStageAdminAriaKick: (identity: string) => `Expulsar a ${identity}`,
    mainStageAdminPause: "Pausar",
    mainStageAdminResume: "Reanudar",
    mainStageAdminStop: "Detener",
    mainStageAdminPlay: "Reproducir",
    mainStageAdminNoPrimeVideos: "Sin videos PRIME publicados en el CMS",
    mainStageAdminUrlPlaceholder: "URL de video o stream…",
    mainStageAdminAriaMediaUrl: "URL de contenido",
    mainStageAdminAriaPlayVideo: (title: string) => `Reproducir ${title}`,
    mainStageAdminConsole: "Consola de Admin",
    mainStageAdminSectionAudio: "Mezcla de audio",
    mainStageAdminAudioMedia: "Contenido",
    mainStageAdminAudioCams: "Cammers",
    mainStageAdminAudioHint: "Se aplica al soltar (debounced).",
    mainStageQueuePosition: (pos: number, total: number) =>
      `Posición ${pos} / ${total}`,
    mainStageQueueLive: "En vivo",
    mainStageQueueNext: (sec: number) =>
      sec > 0 ? `~${sec}s para entrar` : "Entras a continuación",

    // Main Stage — standby / empty states
    mainStageStandby: "En espera",
    mainStageNoMediaPlaying: "Sin contenido · El admin controla la reproducción",
    mainStageStageQuiet: "El escenario es tuyo",
    mainStageStageQuietHint: "Métete. Préndela. Es tu momento.",
    mainStageNobodyOnCam: "Nadie en cámara todavía",
    mainStageNobodyOnCamHint: "Exhíbete. La sala está aquí por ti — tocá Salir al aire para ser el primero.",
    // Main Stage — hero copy (cam-first framing)
    mainStageHeroTitle: "Escenario Principal — tu reflector.",
    mainStageHeroSubtitle: "Préndete y déjate ver.",
    mainStageHeroCta: "Exhíbete.",

    // Main Stage — media player
    mainStageNowPlaying: "Reproduciendo",
    mainStagePaused: "Pausado",
    mainStageTapForSound: "Tocá para escuchar",
    mainStageAriaUnmute: "Activar sonido",
    mainStageNowPlayingLabel: "Reproduciendo ahora",
    mainStageNowPlayingAriaLabel: (title: string) => `Reproduciendo ahora: ${title}`,

    // Main Stage — Prime watermark
    mainStageWatermarkSubscribeTo: "Suscribite a",
    mainStageWatermarkCta: "para ver sin límites →",
    mainStageWatermarkAria: "Suscribite a PNPtv! PRIME",

    // Main Stage — spotlight countdown chip
    mainStageCountdownRotating: "Rotando...",
    mainStageCountdownNext: (m: number, s: string) => `Siguiente: ${m}:${s}`,
    mainStageAriaFocusTile: (identity: string) => `Enfocar ${identity}`,

    // Main Stage — wellness tips overlay
    mainStageWellnessTipLabel: "Consejo de bienestar",
    mainStageWellnessMoreResources: "Más recursos",
    mainStageWellnessAriaDismiss: "Descartar consejo de bienestar",

    // Main Stage — reconnecting banner
    mainStageReconnectingBanner: "Reconectando…",

    // Main Stage — admin counts subtitle
    mainStageCammers: "cammers",
    mainStageWatching: "viendo",
  },
} as const;

export type LiveStrings = typeof strings.en;
export { strings as live };
