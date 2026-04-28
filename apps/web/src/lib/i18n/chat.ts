const strings = {
  en: {
    // Page meta
    pageTitle: "Hangouts — PNPtv!",
    pageDescription:
      "Join or create video call rooms and group chats on PNPtv Hangouts.",

    // Header
    hangoutsTitle: "PNP Hangouts",
    hangoutsSubtitle: "Chat groups with video rooms, a 24/7 Main Stage, and community events",
    mainStageStripDescription: "Online cinema — watch PRIME videos with the room while camming with other guys",

    // Group creation
    newGroup: "+ New Group",
    createSubgroupTitle: "Create Subgroup",
    createSubgroupHint:
      "Max 25 members · 3 per month · Inactive groups are auto-deleted after 72h",
    groupNamePlaceholder: "Group name...",
    groupNameLabel: "Group name",
    groupDescriptionPlaceholder: "Description (optional)...",
    groupDescriptionLabel: "Group description",
    anyoneCanJoin: "Anyone can join",
    approvalRequired: "Approval required to join",
    cancel: "Cancel",
    create: "Create",
    creating: "Creating...",
    errorFailedToCreate: "Failed to create group",

    // Group list
    membersSingular: "member",
    membersPlural: "members",
    labelMain: "MAIN",
    labelWallOfFame: "WALL OF FAME",
    labelPrivate: "PRIVATE",
    labelLive: "LIVE",
    noGroupsYet: "No groups yet",
    noGroupsLoginHint: "Log in to join the community",

    // Free-tier upsell
    freeTierJoinPrompt: "Become a Member to join hangout rooms",
    freeTierJoinButton: "Become a Member",
    freeTierDiscoverButton: "Upgrade to Join",

    // PRIME upsell
    primeUpsellTitle: "Want to create your own group?",
    primeUpsellBody: "Upgrade to PRIME to create subgroups with video calls",
    upgradeToPrime: "Upgrade to PRIME",

    // Discover groups
    discoverGroups: "Discover Groups",
    noGroupsToDiscover: "No groups to discover right now.",
    joinButton: "Join",
    requestButton: "Request",
    requestedStatus: "Requested",

    // Pending join requests
    pendingRequests: "Pending Requests",
    noPendingRequests: "No pending requests.",
    accept: "Accept",
    deny: "Deny",

    // Chat view header
    backToGroupList: "Back to group list",
    onlineNow: "Online Now",
    onlineOfTotal: (online: number, total: number) =>
      `${online} of ${total} members`,
    showOnlineMembers: "Show online members",
    closeOnlinePanel: "Close online panel",
    noOtherMembersOnline: "No other members online right now",
    you: "(you)",
    online: "Online",
    invite: "Invite",
    dismissInvite: "Dismiss invite",

    // Call states
    callInviteTitle: (fromName: string) => `${fromName} invited you`,
    callInviteBody: (groupName: string) =>
      `Join the video call in ${groupName}`,
    callEndedHostLeft: "Call ended: the host left the call",
    videoCallsUnavailable:
      "Video calls are not available right now. Please contact support.",
    videoCallUrlInvalid:
      "Video call URL is invalid. Please contact support.",
    joinCall: "Join",
    leaveCall: "Leave",
    callActiveBanner: "Call in progress — tap to join",
    callActiveBannerWith: (name: string) =>
      `${name} started a call — tap to join`,
    callActiveParticipants: (n: number) =>
      `${n} ${n === 1 ? "person" : "people"} in call`,

    // Delete / leave group confirmations
    leaveGroupConfirm: "Leave this group?",
    deleteGroupConfirm:
      "Permanently delete this group and all its messages?",
    deleteGroup: "Delete",
    leaveGroup: "Leave",

    // Messages area
    noMessagesYet: "No messages yet",
    beFirstToSay: "Be the first to say something!",

    // Typing indicator
    isTyping: (name: string) => `${name} is typing`,
    areTyping: (name: string, name2: string) =>
      `${name} and ${name2} are typing`,
    othersTyping: (name: string, count: number) =>
      `${name} and ${count} others are typing`,

    // Date separators
    today: "Today",
    yesterday: "Yesterday",

    // Input bar
    typeAMessage: "Type a message...",
    addACaption: "Add a caption...",
    sendMessage: "Send message",
    mediaUploadButton: "Attach media",

    // Upload / send errors
    errorFailedToSend: "Failed to send message",
    errorUploadFailed: "Upload failed",
    dismissError: "Dismiss error",

    // Connection status indicator (in chat header)
    connected: "Connected",
  },

  es: {
    // Page meta
    pageTitle: "Hangouts — PNPtv!",
    pageDescription:
      "Únete o crea salas de videollamadas y chats grupales en PNPtv Hangouts.",

    // Header
    hangoutsTitle: "PNP Hangouts",
    hangoutsSubtitle: "Grupos de chat con video, un Main Stage 24/7 y eventos comunitarios",
    mainStageStripDescription: "Cine online — mira videos PRIME con la sala mientras cameas con otros chicos",

    // Group creation
    newGroup: "+ Nuevo grupo",
    createSubgroupTitle: "Crear subgrupo",
    createSubgroupHint:
      "Máx. 25 miembros · 3 por mes · Los grupos inactivos se eliminan automáticamente a las 72h",
    groupNamePlaceholder: "Nombre del grupo...",
    groupNameLabel: "Nombre del grupo",
    groupDescriptionPlaceholder: "Descripción (opcional)...",
    groupDescriptionLabel: "Descripción del grupo",
    anyoneCanJoin: "Cualquiera puede unirse",
    approvalRequired: "Se requiere aprobación para unirse",
    cancel: "Cancelar",
    create: "Crear",
    creating: "Creando...",
    errorFailedToCreate: "Error al crear el grupo",

    // Group list
    membersSingular: "miembro",
    membersPlural: "miembros",
    labelMain: "PRINCIPAL",
    labelWallOfFame: "MURO DE LA FAMA",
    labelPrivate: "PRIVADO",
    labelLive: "EN VIVO",
    noGroupsYet: "Sin grupos todavía",
    noGroupsLoginHint: "Inicia sesión para unirte a la comunidad",

    // Free-tier upsell
    freeTierJoinPrompt: "Hazte Miembro para unirte a las salas de hangout",
    freeTierJoinButton: "Hazte Miembro",
    freeTierDiscoverButton: "Mejora para unirte",

    // PRIME upsell
    primeUpsellTitle: "¿Quieres crear tu propio grupo?",
    primeUpsellBody:
      "Mejora a PRIME para crear subgrupos con videollamadas",
    upgradeToPrime: "Mejorar a PRIME",

    // Discover groups
    discoverGroups: "Descubrir grupos",
    noGroupsToDiscover: "No hay grupos para descubrir ahora mismo.",
    joinButton: "Unirse",
    requestButton: "Solicitar",
    requestedStatus: "Solicitado",

    // Pending join requests
    pendingRequests: "Solicitudes pendientes",
    noPendingRequests: "No hay solicitudes pendientes.",
    accept: "Aceptar",
    deny: "Rechazar",

    // Chat view header
    backToGroupList: "Volver a la lista de grupos",
    onlineNow: "En línea ahora",
    onlineOfTotal: (online: number, total: number) =>
      `${online} de ${total} miembros`,
    showOnlineMembers: "Mostrar miembros en línea",
    closeOnlinePanel: "Cerrar panel de conectados",
    noOtherMembersOnline: "No hay otros miembros en línea ahora mismo",
    you: "(tú)",
    online: "En línea",
    invite: "Invitar",
    dismissInvite: "Descartar invitación",

    // Call states
    callInviteTitle: (fromName: string) => `${fromName} te invitó`,
    callInviteBody: (groupName: string) =>
      `Únete a la videollamada en ${groupName}`,
    callEndedHostLeft: "Llamada finalizada: el anfitrión abandonó la llamada",
    videoCallsUnavailable:
      "Las videollamadas no están disponibles ahora. Contacta con soporte.",
    videoCallUrlInvalid:
      "La URL de la videollamada no es válida. Contacta con soporte.",
    joinCall: "Unirse",
    leaveCall: "Salir",
    callActiveBanner: "Llamada en curso — toca para unirte",
    callActiveBannerWith: (name: string) =>
      `${name} inició una llamada — toca para unirte`,
    callActiveParticipants: (n: number) =>
      `${n} ${n === 1 ? "persona" : "personas"} en la llamada`,

    // Delete / leave group confirmations
    leaveGroupConfirm: "¿Salir de este grupo?",
    deleteGroupConfirm:
      "¿Eliminar permanentemente este grupo y todos sus mensajes?",
    deleteGroup: "Eliminar",
    leaveGroup: "Salir",

    // Messages area
    noMessagesYet: "Sin mensajes todavía",
    beFirstToSay: "¡Sé el primero en decir algo!",

    // Typing indicator
    isTyping: (name: string) => `${name} está escribiendo`,
    areTyping: (name: string, name2: string) =>
      `${name} y ${name2} están escribiendo`,
    othersTyping: (name: string, count: number) =>
      `${name} y ${count} más están escribiendo`,

    // Date separators
    today: "Hoy",
    yesterday: "Ayer",

    // Input bar
    typeAMessage: "Escribe un mensaje...",
    addACaption: "Añadir una leyenda...",
    sendMessage: "Enviar mensaje",
    mediaUploadButton: "Adjuntar media",

    // Upload / send errors
    errorFailedToSend: "Error al enviar el mensaje",
    errorUploadFailed: "Error al subir el archivo",
    dismissError: "Descartar error",

    // Connection status indicator (in chat header)
    connected: "Conectado",
  },
} as const;

export type ChatStrings = typeof strings.en;
export { strings as chat };
