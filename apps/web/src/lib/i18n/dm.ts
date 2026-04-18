const strings = {
  en: {
    // Page meta
    pageTitle: "Messages — PNPtv!",
    pageDescription: "Direct messages on PNPtv. Chat privately with community members.",

    // Thread list header
    messagesTitle: "PNP Messages",
    messagesSubtitle: "Private conversations",
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
    tryAgain: "Try Again",

    // Empty state
    noConversations: "No conversations yet",

    // Timestamps
    timeNow: "now",
  },
  es: {
    pageTitle: "Mensajes — PNPtv!",
    pageDescription: "Mensajes directos en PNPtv. Chatea en privado con miembros de la comunidad.",

    messagesTitle: "PNP Messages",
    messagesSubtitle: "Conversaciones privadas",
    directMessagesSubtitle: "Mensajes directos",

    loadThreadsError: "No se pudieron cargar los mensajes",
    retry: "Reintentar",
    noThreadsTitle: "Sin mensajes aún",
    noThreadsHint: "Visita un perfil y toca Mensaje para iniciar una conversación",
    mediaFallback: "Foto/Video",

    conversationFallbackTitle: "Conversación",
    tapToViewProfile: "Toca para ver el perfil",
    backToThreads: "Volver a los mensajes",

    tryAgain: "Intentar de nuevo",

    noConversations: "Sin conversaciones aún",

    timeNow: "ahora",
  },
} as const;

export type DmStrings = typeof strings.en;
export { strings as dm };
