/**
 * Shared deep-link resolver for notifications.
 * Mirrors the backend buildNotificationUrl() logic so in-app clicks
 * navigate to the same destination as push notification taps.
 */
export function getNotificationDeepLink(notif: {
  type?: string;
  entityType?: string;
  entityId?: string;
  actorId?: string;
  metadata?: Record<string, unknown>;
}): string {
  const { type, entityType, entityId, actorId, metadata } = notif;

  // Route by notification type first (most specific)
  switch (type) {
    case "follow":
      return entityId ? `/profile/${entityId}` : "/social";

    case "like":
    case "reply":
    case "reaction_post":
    case "mention_post": {
      const postId = entityId || (metadata?.postId as string);
      return postId ? `/social/post/${postId}` : "/social";
    }

    case "dm":
      if (actorId && /^\d+$/.test(String(actorId))) {
        return `/dm/${actorId}`;
      }
      return entityId ? `/dm/${entityId}` : "/dm";

    case "group_message":
    case "group_join":
    case "group_join_request":
    case "group_request_accepted":
    case "reaction_chat":
    case "mention_chat":
    case "hangout_call":
    case "hangout_creator_joined":
      return entityId ? `/chat/${entityId}` : "/chat";

    case "payment":
      return "/subscribe";

    case "wof_winner":
      return "/social";

    case "live_stream_started":
      return entityId ? `/live/${entityId}` : "/live";

    case "announcement":
    case "system":
      return "/";
  }

  // Fallback: route by entity type
  switch (entityType) {
    case "post": {
      const postId = entityId || (metadata?.postId as string);
      return postId ? `/social/post/${postId}` : "/social";
    }
    case "message":
      if (actorId && /^\d+$/.test(String(actorId))) {
        return `/dm/${actorId}`;
      }
      return "/dm";
    case "group":
    case "hangout":
      return entityId ? `/chat/${entityId}` : "/chat";
    case "stream":
      return entityId ? `/live/${entityId}` : "/live";
    case "payment":
      return "/subscribe";
    default:
      return "/";
  }
}
