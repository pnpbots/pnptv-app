const strings = {
  en: {
    // Page header
    title: "Gamification",
    subtitle: "Manage badges, categories, and award achievements to users",

    // Section labels
    categories: "Categories",
    badges: "Badges",
    noBadges: "No badges in this category",
    noCategories: "No categories found",

    // Badge detail
    level: "Level",
    holders: "Holders",
    viewHolders: "View Holders",
    hideHolders: "Hide Holders",
    noHolders: "No one holds this badge yet",
    loadingHolders: "Loading holders...",
    awardedAt: "Awarded",

    // Award form
    awardBadge: "Award Badge",
    awardFormTitle: "Award a Badge",
    awardFormSubtitle: "Manually award a badge to a user by their Telegram ID",
    telegramId: "Telegram ID",
    telegramIdPlaceholder: "Enter numeric Telegram ID",
    selectBadge: "Select Badge",
    selectBadgePlaceholder: "Choose a badge...",
    note: "Note (optional)",
    notePlaceholder: "Reason for awarding this badge...",
    award: "Award Badge",
    awarding: "Awarding...",
    awardSuccess: "Badge awarded successfully",
    awardError: "Failed to award badge",

    // Revoke
    revoke: "Revoke",
    revoking: "Revoking...",
    revokeSuccess: "Badge revoked successfully",
    revokeError: "Failed to revoke badge",
    revokeConfirm: "Revoke this badge from",

    // Bulk action
    awardAllCreators: "Award Me Cuido 1 to All Active Creators",
    awardAllCreatorsConfirm: "This will award the Me Cuido 1 badge to every active creator who does not already have it. Continue?",
    awardAllCreatorsSuccess: "Awarded to {count} creators",
    awardAllCreatorsError: "Bulk award failed",
    awardingAll: "Awarding...",

    // Category / badge name overrides for display
    meCuido: "Me Cuido",
    wellness: "Wellness",
    engagement: "Engagement",

    // States
    loadingCategories: "Loading categories...",
    errorLoading: "Failed to load gamification data",
    retry: "Try Again",
  },
  es: {
    // Page header
    title: "Gamificacion",
    subtitle: "Administra insignias, categorias y otorga logros a los usuarios",

    // Section labels
    categories: "Categorias",
    badges: "Insignias",
    noBadges: "Sin insignias en esta categoria",
    noCategories: "No se encontraron categorias",

    // Badge detail
    level: "Nivel",
    holders: "Poseedores",
    viewHolders: "Ver Poseedores",
    hideHolders: "Ocultar Poseedores",
    noHolders: "Nadie tiene esta insignia todavia",
    loadingHolders: "Cargando poseedores...",
    awardedAt: "Otorgado",

    // Award form
    awardBadge: "Otorgar Insignia",
    awardFormTitle: "Otorgar una Insignia",
    awardFormSubtitle: "Otorga manualmente una insignia a un usuario mediante su ID de Telegram",
    telegramId: "ID de Telegram",
    telegramIdPlaceholder: "Ingresa el ID numerico de Telegram",
    selectBadge: "Seleccionar Insignia",
    selectBadgePlaceholder: "Elige una insignia...",
    note: "Nota (opcional)",
    notePlaceholder: "Razon para otorgar esta insignia...",
    award: "Otorgar Insignia",
    awarding: "Otorgando...",
    awardSuccess: "Insignia otorgada exitosamente",
    awardError: "No se pudo otorgar la insignia",

    // Revoke
    revoke: "Revocar",
    revoking: "Revocando...",
    revokeSuccess: "Insignia revocada exitosamente",
    revokeError: "No se pudo revocar la insignia",
    revokeConfirm: "Revocar esta insignia de",

    // Bulk action
    awardAllCreators: "Otorgar Me Cuido 1 a Todos los Creadores Activos",
    awardAllCreatorsConfirm: "Esto otorgara la insignia Me Cuido 1 a cada creador activo que aun no la tenga. Continuar?",
    awardAllCreatorsSuccess: "Otorgado a {count} creadores",
    awardAllCreatorsError: "El otorgamiento masivo fallo",
    awardingAll: "Otorgando...",

    // Category / badge name overrides for display
    meCuido: "Me Cuido",
    wellness: "Bienestar",
    engagement: "Engagement",

    // States
    loadingCategories: "Cargando categorias...",
    errorLoading: "No se pudieron cargar los datos de gamificacion",
    retry: "Intentar de nuevo",
  },
} as const;

export type GamificationStrings = typeof strings.en;
export { strings as gamification };
