const strings = {
  en: {
    // Page meta
    pageTitle: "Messages — PNPtv!",
    pageDescription: "Direct messages on PNPtv. Chat privately with community members.",

    // Thread list header
    messagesTitle: "Messages",
    directMessagesSubtitle: "Direct messages",

    // Thread list states
    loadThreadsError: "Failed to load messages",
    retry: "Retry",
    noThreadsTitle: "No messages yet",
    noThreadsHint: "Visit a profile and tap Message to start a conversation",
    mediaFallback: "Photo/Video",

    // Conversation header
    conversationFallbackTitle: "Conversation",
    tapToViewProfile: "Tap to view profile",
    backToThreads: "Back to message threads",

    // Conversation states
    loadMessagesError: "Failed to load messages. Tap to retry.",
    tryAgain: "Try Again",
    noConversationMessages: "No messages yet",
    sayHello: "Say hello!",

    // Input area
    placeholderText: "Type a message…",
    placeholderCaption: "Add a caption…",
    attachPhotoVideo: "Attach photo or video",
    selectPhotoVideo: "Select photo or video to send",
    messageInput: "Message input",
    sendMessage: "Send message",

    // Upload preview
    uploading: "Uploading…",
    pressToShare: "Press send to share",
    removeMedia: "Remove selected media",
    videoPreview: "Video preview",
    uploadPreview: "Upload preview",

    // File type labels
    vidLabel: "VID",
    imgLabel: "IMG",

    // Upload errors
    invalidFileType: "Only images (JPG, PNG, WebP, GIF) and videos (MP4, WebM) are allowed.",
    fileTooLarge: "File too large. Maximum size is 50 MB.",
    uploadFailed: "Upload failed. Try again.",

    // Send errors
    limitReached: "Daily message limit reached. Upgrade for unlimited messaging.",
    sendFailed: "Failed to send message. Try again.",
    dismissError: "Dismiss error",

    // Free-tier DM quota
    messagesRemaining: (remaining: number, limit: number) => `${remaining} of ${limit} messages left today`,
    dailyLimitReached: "Daily message limit reached",
    goUnlimited: "Go unlimited",

    // Timestamps
    timeNow: "now",

    // Lightbox
    imageLightboxLabel: "Image fullscreen view",
    closeLightbox: "Close fullscreen image",
    sharedImage: "Shared image",
    sharedVideo: "Shared video",
    viewFullImage: "View full image",
    imageFailedToLoad: "Image failed to load",
    videoFailedToLoad: "Video failed to load",

    // Avatars / profiles
    viewYourProfile: "View your profile",
    viewPartnerProfile: "View conversation partner's profile",
  },
  es: {
    pageTitle: "Mensajes — PNPtv!",
    pageDescription: "Mensajes directos en PNPtv. Chatea en privado con miembros de la comunidad.",

    messagesTitle: "Mensajes",
    directMessagesSubtitle: "Mensajes directos",

    loadThreadsError: "No se pudieron cargar los mensajes",
    retry: "Reintentar",
    noThreadsTitle: "Sin mensajes aún",
    noThreadsHint: "Visita un perfil y toca Mensaje para iniciar una conversación",
    mediaFallback: "Foto/Video",

    conversationFallbackTitle: "Conversación",
    tapToViewProfile: "Toca para ver el perfil",
    backToThreads: "Volver a los mensajes",

    loadMessagesError: "No se pudieron cargar los mensajes. Toca para reintentar.",
    tryAgain: "Intentar de nuevo",
    noConversationMessages: "Sin mensajes aún",
    sayHello: "¡Di hola!",

    placeholderText: "Escribe un mensaje…",
    placeholderCaption: "Agrega una descripción…",
    attachPhotoVideo: "Adjuntar foto o video",
    selectPhotoVideo: "Selecciona una foto o video para enviar",
    messageInput: "Campo de mensaje",
    sendMessage: "Enviar mensaje",

    uploading: "Subiendo…",
    pressToShare: "Presiona enviar para compartir",
    removeMedia: "Quitar archivo seleccionado",
    videoPreview: "Vista previa del video",
    uploadPreview: "Vista previa",

    vidLabel: "VID",
    imgLabel: "IMG",

    invalidFileType: "Solo se permiten imágenes (JPG, PNG, WebP, GIF) y videos (MP4, WebM).",
    fileTooLarge: "Archivo muy grande. El tamaño máximo es 50 MB.",
    uploadFailed: "Error al subir. Intenta de nuevo.",

    limitReached: "Límite diario de mensajes alcanzado. Mejora para mensajería ilimitada.",
    sendFailed: "Error al enviar el mensaje. Intenta de nuevo.",
    dismissError: "Cerrar error",

    messagesRemaining: (remaining: number, limit: number) => `${remaining} de ${limit} mensajes hoy`,
    dailyLimitReached: "Límite diario de mensajes alcanzado",
    goUnlimited: "Sin límites",

    timeNow: "ahora",

    imageLightboxLabel: "Imagen en pantalla completa",
    closeLightbox: "Cerrar imagen en pantalla completa",
    sharedImage: "Imagen compartida",
    sharedVideo: "Video compartido",
    viewFullImage: "Ver imagen completa",
    imageFailedToLoad: "Error al cargar la imagen",
    videoFailedToLoad: "Error al cargar el video",

    viewYourProfile: "Ver tu perfil",
    viewPartnerProfile: "Ver el perfil del contacto",
  },
} as const;

export type DmStrings = typeof strings.en;
export { strings as dm };
