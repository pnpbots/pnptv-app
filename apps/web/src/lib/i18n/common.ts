const strings = {
  en: {
    // Buttons
    save: "Save",
    cancel: "Cancel",
    close: "Close",
    delete: "Delete",
    edit: "Edit",
    copy: "Copy",
    copied: "Copied",
    confirm: "Confirm",
    back: "Back",
    next: "Next",
    retry: "Retry",
    submit: "Submit",
    loading: "Loading...",
    saving: "Saving...",
    deleting: "Deleting...",
    sending: "Sending...",

    // States
    error: "Error",
    success: "Success",
    noResults: "No results found",
    somethingWentWrong: "Something went wrong",

    // Labels
    email: "Email",
    password: "Password",
    search: "Search",
    settings: "Settings",
    notifications: "Notifications",

    // Time
    now: "Now",
    today: "Today",
    yesterday: "Yesterday",
    justNow: "Just now",

    // Errors
    connectionError: "Connection error",
    failedToLoad: "Failed to load",
    tryAgain: "Try again",
    networkError: "Network error. Please check your connection.",

    // Auth
    logIn: "Log in",
    logOut: "Log out",
    signIn: "Sign in",
    signUp: "Sign up",

    // Content actions
    photo: "Photo",
    video: "Video",
    post: "Post",
    comment: "Comment",
    share: "Share",
    like: "Like",
    unlike: "Unlike",
    follow: "Follow",
    unfollow: "Unfollow",
    block: "Block",
    report: "Report",
    mute: "Mute",

    // Misc
    forAdults18Plus: "For adults 18+",
    allRightsReserved: "All rights reserved",
    termsOfService: "Terms of Service",
    privacyPolicy: "Privacy Policy",
    support: "Support",
    goBack: "Go back",
    viewAll: "View all",
    seeAll: "See all",
    pageNotFound: "Page not found",
    copyrightNotice: "© {year} PNPtv. All rights reserved.",
  },
  es: {
    // Buttons
    save: "Guardar",
    cancel: "Cancelar",
    close: "Cerrar",
    delete: "Eliminar",
    edit: "Editar",
    copy: "Copiar",
    copied: "Copiado",
    confirm: "Confirmar",
    back: "Atrás",
    next: "Siguiente",
    retry: "Reintentar",
    submit: "Enviar",
    loading: "Cargando...",
    saving: "Guardando...",
    deleting: "Eliminando...",
    sending: "Enviando...",

    // States
    error: "Error",
    success: "Éxito",
    noResults: "Sin resultados",
    somethingWentWrong: "Algo salió mal",

    // Labels
    email: "Correo electrónico",
    password: "Contraseña",
    search: "Buscar",
    settings: "Configuración",
    notifications: "Notificaciones",

    // Time
    now: "Ahora",
    today: "Hoy",
    yesterday: "Ayer",
    justNow: "Justo ahora",

    // Errors
    connectionError: "Error de conexión",
    failedToLoad: "No se pudo cargar",
    tryAgain: "Intentar de nuevo",
    networkError: "Error de red. Por favor verifica tu conexión.",

    // Auth
    logIn: "Iniciar sesión",
    logOut: "Cerrar sesión",
    signIn: "Entrar",
    signUp: "Registrarse",

    // Content actions
    photo: "Foto",
    video: "Video",
    post: "Publicar",
    comment: "Comentar",
    share: "Compartir",
    like: "Me gusta",
    unlike: "Ya no me gusta",
    follow: "Seguir",
    unfollow: "Dejar de seguir",
    block: "Bloquear",
    report: "Reportar",
    mute: "Silenciar",

    // Misc
    forAdults18Plus: "Para adultos mayores de 18 años",
    allRightsReserved: "Todos los derechos reservados",
    termsOfService: "Términos de Servicio",
    privacyPolicy: "Política de Privacidad",
    support: "Soporte",
    goBack: "Volver",
    viewAll: "Ver todo",
    seeAll: "Ver todo",
    pageNotFound: "Página no encontrada",
    copyrightNotice: "© {year} PNPtv. Todos los derechos reservados.",
  },
} as const;

export type CommonStrings = typeof strings.en;
export { strings as common };
