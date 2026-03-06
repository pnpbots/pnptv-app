const strings = {
  en: {
    // Support page (Support.tsx)
    pageTitle: "Support — PNPtv!",
    pageDescription: "Get instant help with your PNPtv account, subscription, or any questions from Cristina AI.",
    pageHeading: "Cristina AI Support",
    pageSubtitle: "Get instant help with your account, subscription, or any questions about PNPtv.",

    // CristinaWidget — FAB
    openWidgetAriaLabel: "Open Cristina AI Support",

    // CristinaWidget — Header
    widgetName: "Cristina AI",
    widgetSubtitle: "PNPtv Support",
    supportTicketTitle: "Support ticket",
    newConversationTitle: "New conversation",

    // CristinaWidget — Chat welcome
    welcomeGreeting: "Hi! I'm Cristina",
    welcomeSubtitle: "Your PNPtv support assistant. How can I help you?",

    // Chat — open ticket banner
    openTicketBanner: "You have an open support ticket",
    viewTicketLink: "View →",

    // Chat — still need help CTA
    stillNeedHelp: "Still need help? → Create a support ticket",

    // Chat — error response
    chatError: "Sorry, there was an error. Please try again.",

    // Chat — input placeholders
    inputPlaceholderChat: "Type your message...",
    inputPlaceholderTicket: "Reply to ticket...",

    // Ticket form view
    createTicketTitle: "Create Support Ticket",
    selectCategoryLabel: "Select a category:",
    describeIssueLabel: "Describe your issue:",
    descriptionPlaceholder: "Write the details here...",
    submittingTicket: "Submitting...",
    submitTicketBtn: "Submit Ticket",

    // Ticket categories
    categoryPayment: "Payment",
    categoryAccount: "Account",
    categoryBug: "Bug Report",
    categoryFeature: "Feature",
    categoryTechnical: "Technical",
    categoryGeneral: "General",

    // Ticket view
    supportTicketViewTitle: "Support Ticket",
    ticketReplied: "Replied",
    waitingForSupport: "Waiting for support team response...",
  },
  es: {
    pageTitle: "Soporte — PNPtv!",
    pageDescription: "Obtén ayuda instantánea con tu cuenta de PNPtv, suscripción o cualquier pregunta de Cristina AI.",
    pageHeading: "Soporte Cristina AI",
    pageSubtitle: "Obtén ayuda instantánea con tu cuenta, suscripción o cualquier pregunta sobre PNPtv.",

    openWidgetAriaLabel: "Abrir Soporte Cristina AI",

    widgetName: "Cristina AI",
    widgetSubtitle: "Soporte PNPtv",
    supportTicketTitle: "Ticket de soporte",
    newConversationTitle: "Nueva conversación",

    welcomeGreeting: "¡Hola! Soy Cristina",
    welcomeSubtitle: "Tu asistente de soporte PNPtv. ¿En qué puedo ayudarte?",

    openTicketBanner: "Tienes un ticket de soporte abierto",
    viewTicketLink: "Ver →",

    stillNeedHelp: "¿Aún necesitas ayuda? → Crear ticket de soporte",

    chatError: "Lo siento, hubo un error. Por favor intenta de nuevo.",

    inputPlaceholderChat: "Escribe tu mensaje...",
    inputPlaceholderTicket: "Responder al ticket...",

    createTicketTitle: "Crear Ticket de Soporte",
    selectCategoryLabel: "Selecciona una categoría:",
    describeIssueLabel: "Describe tu problema:",
    descriptionPlaceholder: "Escribe los detalles aquí...",
    submittingTicket: "Enviando...",
    submitTicketBtn: "Enviar Ticket",

    categoryPayment: "Pago",
    categoryAccount: "Cuenta",
    categoryBug: "Reporte de Bug",
    categoryFeature: "Sugerencia",
    categoryTechnical: "Técnico",
    categoryGeneral: "General",

    supportTicketViewTitle: "Ticket de Soporte",
    ticketReplied: "Respondido",
    waitingForSupport: "Esperando respuesta del equipo de soporte...",
  },
} as const;

export type SupportStrings = typeof strings.en;
export { strings as support };
