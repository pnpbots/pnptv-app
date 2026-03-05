/**
 * Feed UI translations (EN / ES).
 * Keyed to the user's `language` profile field set via the Profile toggle.
 */

const strings = {
  en: {
    // Social page header
    socialFeedTitle: "Social Feed",
    socialFeedSubtitle: "Share updates with the PNPTV community",
    community: "Community",
    // Featured performers
    featured: "Featured",
    live: "Live",
    // Composer
    whatOnYourMind: "What's on your mind?",
    photo: "Photo",
    video: "Video",
    post: "Post",
    posting: "Posting...",
    bulkUploadVideos: "Bulk Upload Videos",
    exclusiveToggle: "Exclusive content (subscribers only)",
    alsoPostBluesky: "Also post to Bluesky",
    allowSharing: "Allow sharing",
    // Tabs
    allPosts: "All Posts",
    wallOfFame: "Wall of Fame",
    following: "Following",
    // Feed states
    feedUnavailable: "Feed Unavailable",
    retry: "Retry",
    noPostsYet: "No Posts Yet",
    beTheFirst: "Be the first to share something with the community!",
    noWofPostsYet: "No Wall of Fame Posts Yet",
    wofHint: "Post photos in the Telegram group to appear here!",
    noFollowingPostsYet: "No Posts Yet",
    followSomeone: "Follow some creators to see their posts here",
    loadMore: "Load More",
    loading: "Loading...",
    // Post actions
    translate: "Translate",
    showOriginal: "Show original",
    translating: "...",
    // Comments
    writeComment: "Write a comment...",
    send: "Send",
    loadingComments: "Loading comments...",
    noCommentsYet: "No comments yet",
    // WoF removal
    remove: "Remove",
    removing: "Removing...",
    // Home page
    socialFeed: "Social Feed",
    viewAll: "View all",
    viewAllPosts: "View all posts",
    noPostsHome: "No posts yet",
    beFirstHome: "Be the first to post something!",
  },
  es: {
    socialFeedTitle: "Feed Social",
    socialFeedSubtitle: "Comparte con la comunidad de PNPtv",
    community: "Comunidad",
    featured: "Destacados",
    live: "En vivo",
    whatOnYourMind: "¿Qué estás pensando?",
    photo: "Foto",
    video: "Video",
    post: "Publicar",
    posting: "Publicando...",
    bulkUploadVideos: "Subir videos en lote",
    exclusiveToggle: "Contenido exclusivo (solo suscriptores)",
    alsoPostBluesky: "También publicar en Bluesky",
    allowSharing: "Permitir compartir",
    allPosts: "Todos",
    wallOfFame: "Muro de la Fama",
    following: "Siguiendo",
    feedUnavailable: "Feed no disponible",
    retry: "Reintentar",
    noPostsYet: "Aún no hay publicaciones",
    beTheFirst: "¡Sé el primero en compartir algo con la comunidad!",
    noWofPostsYet: "Aún no hay publicaciones en el Muro de la Fama",
    wofHint: "¡Publica fotos en el grupo de Telegram para aparecer aquí!",
    noFollowingPostsYet: "Aún no hay publicaciones",
    followSomeone: "Sigue a creadores para ver sus publicaciones aquí",
    loadMore: "Cargar más",
    loading: "Cargando...",
    translate: "Traducir",
    showOriginal: "Ver original",
    translating: "...",
    writeComment: "Escribe un comentario...",
    send: "Enviar",
    loadingComments: "Cargando comentarios...",
    noCommentsYet: "Aún no hay comentarios",
    remove: "Eliminar",
    removing: "Eliminando...",
    socialFeed: "Feed Social",
    viewAll: "Ver todo",
    viewAllPosts: "Ver todas las publicaciones",
    noPostsHome: "Aún no hay publicaciones",
    beFirstHome: "¡Sé el primero en publicar algo!",
  },
} as const;

export type FeedStrings = typeof strings.en;

export function useFeedI18n(lang?: string | null): FeedStrings {
  return strings[lang === "es" ? "es" : "en"];
}

/**
 * Translate `text` to the target language using the MyMemory free API.
 * Source language is auto-detected by the service.
 * Returns null on failure.
 */
export async function translateText(
  text: string,
  targetLang: "en" | "es"
): Promise<string | null> {
  if (!text.trim()) return null;
  const sourceLang = targetLang === "es" ? "en" : "es";
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text.slice(0, 500))}&langpair=${sourceLang}|${targetLang}`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (data?.responseStatus === 200 && data?.responseData?.translatedText) {
      return data.responseData.translatedText as string;
    }
  } catch { /* network error */ }
  return null;
}
