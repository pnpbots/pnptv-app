const strings = {
  en: {
    // Page meta
    pageTitle: "Connect — PNPtv!",
    pageDescription:
      "Discover PNPtv members and venues near you. See who's around on the interactive map.",

    // Map heading
    nearby: "PNP Connect",
    nearbySubtitle: "Discover people & places near you",

    // Location states
    locationOnline: "Online",
    locationLastSeen: "Last seen",
    locationLastKnown: "Last known",
    minutesAgo: (m: number) => `${m}m ago`,

    // Loading / denied
    findingLocation: "Finding your location...",
    grantLocationAccess: "Grant location access to discover nearby users",
    locationAccessNeeded: "Location Access Needed",
    locationAccessBody:
      "Enable location permissions in your browser or device settings to discover nearby users.",
    tryAgain: "Try Again",

    // Filters
    filterAll: "All",
    filterUsers: "Users",
    filterPlaces: "Places",

    // Badge counts
    userSingular: "user",
    userPlural: "users",
    placeSingular: "place",
    placePlural: "places",

    // Distance formatting
    metersAway: (m: number) => `${m}m away`,
    kmAway: (km: string) => `${km}km away`,
    nearbyFallback: "nearby",

    // Free-tier count card
    personSingular: "person",
    personPlural: "people",
    nearYou: "near you",
    freeUpgradeBody:
      "Upgrade to see who's nearby, browse profiles, and discover PNP spots on the map.",
    upgradeToSeeMap: "Upgrade to see the map",

    // Member-tier list
    nearbyTitle: "Connect",
    nearbyCount: (n: number, label: string) => `${n} ${label} nearby`,
    upgradeToPrime: "Upgrade to PRIME",
    upgradePrimePrompt: "Upgrade to",
    upgradePrimeBody: "for the full map with exact distances",
    nobodyNearbyYet: "Nobody nearby yet",
    nobodyNearbyHint: "Check back later or expand your search area",

    // User detail sheet
    viewProfile: "View Profile",
    close: "Close",

    // Place detail sheet
    visitWebsite: "Visit Website",

    // Place categories
    categoryWellness: "Wellness",
    categoryCruisingSpots: "Cruising Spots",
    categoryAdultBusinesses: "+18 Businesses",
    categoryPnpFriendly: "PNP Friendly",
    categoryHelpCenters: "Help Centers",
    categorySaunas: "Saunas & Bath Houses",
    categoryBarsClubs: "Bars & Clubs",
    categoryCommunityBusinesses: "Community Businesses",
    categoryHotelsLodging: "Hotels & Lodging",

    // Submit place modal
    addAPlace: "Add a Place",
    placeName: "Place name *",
    selectCategory: "Select category",
    address: "Address",
    city: "City",
    country: "Country",
    descriptionOptional: "Description (optional)",
    instagramOptional: "Instagram (optional)",
    websiteOptional: "Website (optional)",
    submitForReview: "Submit for Review",
    submitting: "Submitting...",
    submitThanksTitle: "Thanks!",
    submitThanksBody:
      "Your place has been submitted for review. We'll approve it within 24h.",

    // Submit place validation errors
    errorNameRequired: "Name is required",
    errorInvalidCoordinates: "Invalid coordinates",
    errorFailedToSubmit: "Failed to submit",

    // Empty / no results
    nothingNearbyYet: "Nothing nearby yet",
    tryIncreasingRadius: "Try increasing the search radius",

    // Incognito toggle
    incognitoOn: "Incognito ON — your location is hidden",
    incognitoOff: "Incognito OFF — you are visible",

    // Radius selector (unit suffix)
    radiusKm: (r: number) => `${r}km`,

    // Add place FAB tooltip
    addPlace: "Add a place",
  },

  es: {
    // Page meta
    pageTitle: "Conectar — PNPtv!",
    pageDescription:
      "Descubre miembros y lugares de PNPtv cerca de ti. Ve quién está cerca en el mapa interactivo.",

    // Map heading
    nearby: "PNP Connect",
    nearbySubtitle: "Descubre personas y lugares cerca de ti",

    // Location states
    locationOnline: "En línea",
    locationLastSeen: "Visto por última vez",
    locationLastKnown: "Última ubicación conocida",
    minutesAgo: (m: number) => `hace ${m}m`,

    // Loading / denied
    findingLocation: "Buscando tu ubicación...",
    grantLocationAccess:
      "Permite el acceso a la ubicación para descubrir usuarios cercanos",
    locationAccessNeeded: "Se necesita acceso a la ubicación",
    locationAccessBody:
      "Activa los permisos de ubicación en tu navegador o configuración del dispositivo para descubrir usuarios cercanos.",
    tryAgain: "Intentar de nuevo",

    // Filters
    filterAll: "Todos",
    filterUsers: "Usuarios",
    filterPlaces: "Lugares",

    // Badge counts
    userSingular: "usuario",
    userPlural: "usuarios",
    placeSingular: "lugar",
    placePlural: "lugares",

    // Distance formatting
    metersAway: (m: number) => `a ${m}m`,
    kmAway: (km: string) => `a ${km}km`,
    nearbyFallback: "cerca",

    // Free-tier count card
    personSingular: "persona",
    personPlural: "personas",
    nearYou: "cerca de ti",
    freeUpgradeBody:
      "Mejora tu plan para ver quién está cerca, explorar perfiles y descubrir lugares PNP en el mapa.",
    upgradeToSeeMap: "Mejorar para ver el mapa",

    // Member-tier list
    nearbyTitle: "Cerca",
    nearbyCount: (n: number, label: string) => `${n} ${label} cerca`,
    upgradeToPrime: "Mejorar a PRIME",
    upgradePrimePrompt: "Mejora a",
    upgradePrimeBody: "para el mapa completo con distancias exactas",
    nobodyNearbyYet: "Nadie cerca todavía",
    nobodyNearbyHint: "Vuelve más tarde o amplía el radio de búsqueda",

    // User detail sheet
    viewProfile: "Ver perfil",
    close: "Cerrar",

    // Place detail sheet
    visitWebsite: "Visitar sitio web",

    // Place categories
    categoryWellness: "Bienestar",
    categoryCruisingSpots: "Lugares de Cruising",
    categoryAdultBusinesses: "Negocios +18",
    categoryPnpFriendly: "PNP Friendly",
    categoryHelpCenters: "Centros de Ayuda",
    categorySaunas: "Saunas y Casas de Baños",
    categoryBarsClubs: "Bares y Clubes",
    categoryCommunityBusinesses: "Negocios Comunitarios",
    categoryHotelsLodging: "Hoteles y Alojamiento",

    // Submit place modal
    addAPlace: "Agregar un lugar",
    placeName: "Nombre del lugar *",
    selectCategory: "Seleccionar categoría",
    address: "Dirección",
    city: "Ciudad",
    country: "País",
    descriptionOptional: "Descripción (opcional)",
    instagramOptional: "Instagram (opcional)",
    websiteOptional: "Sitio web (opcional)",
    submitForReview: "Enviar para revisión",
    submitting: "Enviando...",
    submitThanksTitle: "¡Gracias!",
    submitThanksBody:
      "Tu lugar ha sido enviado para revisión. Lo aprobaremos en 24h.",

    // Submit place validation errors
    errorNameRequired: "El nombre es obligatorio",
    errorInvalidCoordinates: "Coordenadas inválidas",
    errorFailedToSubmit: "Error al enviar",

    // Empty / no results
    nothingNearbyYet: "Nada cerca todavía",
    tryIncreasingRadius: "Intenta aumentar el radio de búsqueda",

    // Incognito toggle
    incognitoOn: "Modo incógnito ACTIVADO — tu ubicación está oculta",
    incognitoOff: "Modo incógnito DESACTIVADO — eres visible",

    // Radius selector (unit suffix)
    radiusKm: (r: number) => `${r}km`,

    // Add place FAB tooltip
    addPlace: "Agregar un lugar",
  },
} as const;

export type BookingStrings = typeof strings.en;
export { strings as booking };
