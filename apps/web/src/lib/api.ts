const API_BASE = import.meta.env.VITE_API_URL || "https://pnptv.app";

interface ApiOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

async function request<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const { method = "GET", body, headers = {} } = options;

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error || `API error ${res.status}`);
  }

  return res.json();
}

// Auth endpoints

export interface TelegramAuthResponse {
  success: boolean;
  user?: {
    id?: string;
    telegram_id: number;
    username: string;
    first_name: string;
    display_name: string;
    language: string;
    terms_accepted: boolean;
    age_verified: boolean;
    subscription_type: string;
    tier: string;
    role: string;
    photo_url?: string | null;
  };
  requiresTerms?: boolean;
  error?: string;
}

export interface AuthStatusResponse {
  authenticated: boolean;
  user?: TelegramAuthResponse["user"];
}

export function telegramAuth(initData: string): Promise<TelegramAuthResponse> {
  return request("/api/telegram-auth", {
    method: "POST",
    body: { initData },
  });
}

export function checkAuthStatus(): Promise<AuthStatusResponse> {
  return request("/api/auth-status");
}

export function acceptTerms(): Promise<{ success: boolean }> {
  return request("/api/accept-terms", { method: "POST" });
}

export function apiLogout(): Promise<{ success: boolean }> {
  return request("/api/logout", { method: "POST" });
}

// Age verification (self-declaration)
export function verifyAgeSelf(): Promise<{ success: boolean }> {
  return request("/api/verify-age-self", { method: "POST" });
}

// Media proxy (Ampache)
export interface MediaTrack {
  id: string;
  title: string;
  artist: { name: string } | string;
  album?: { name: string } | string;
  url: string;
  art?: string;
  time: number;
}

export function getMediaTracks(
  offset = 0,
  limit = 20
): Promise<{ success: boolean; tracks: MediaTrack[] }> {
  return request(`/api/proxy/media/tracks?offset=${offset}&limit=${limit}`);
}

export function searchMedia(
  q: string,
  limit = 20
): Promise<{ success: boolean; tracks: MediaTrack[] }> {
  return request(
    `/api/proxy/media/search?q=${encodeURIComponent(q)}&limit=${limit}`
  );
}

export function getMediaStreamUrl(
  songId: string
): Promise<{ success: boolean; url: string }> {
  return request(`/api/proxy/media/stream/${songId}`);
}

// Live proxy (Restreamer)
export interface LiveStream {
  id: string;
  name: string;
  description: string;
  hlsUrl: string;
  isLive: boolean;
}

export function getLiveStreams(): Promise<{
  success: boolean;
  streams: LiveStream[];
}> {
  return request("/api/proxy/live/streams");
}

// Social proxy (Bluesky)
export interface SocialPost {
  uri: string;
  cid: string;
  author: {
    handle: string;
    displayName?: string;
    avatar?: string;
  };
  record: {
    text: string;
    createdAt: string;
  };
  likeCount?: number;
  repostCount?: number;
  replyCount?: number;
}

export function getSocialFeed(
  limit = 20
): Promise<{ success: boolean; posts: SocialPost[]; message?: string }> {
  return request(`/api/proxy/social/feed?limit=${limit}`);
}

// Local social posts (Directus-backed)
export interface LocalPost {
  id: number;
  text: string;
  media: { id: string; type: string; width?: number; height?: number; filename_download?: string } | null;
  author_name: string;
  author_id: string;
  author_source: string;
  date_created: string;
}

export function getLocalPosts(
  limit = 50,
  offset = 0
): Promise<{ success: boolean; posts: LocalPost[] }> {
  return request(`/api/proxy/social/posts?limit=${limit}&offset=${offset}`);
}

export async function createPost(
  text: string,
  mediaFile?: File
): Promise<{ success: boolean; post: LocalPost }> {
  const formData = new FormData();
  formData.append("text", text);
  if (mediaFile) {
    formData.append("media", mediaFile);
  }

  const res = await fetch(`${API_BASE}/api/proxy/social/posts`, {
    method: "POST",
    credentials: "include",
    body: formData,
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error || `API error ${res.status}`);
  }

  return res.json();
}

export function deletePost(id: number): Promise<{ success: boolean }> {
  return request(`/api/proxy/social/posts/${id}`, { method: "DELETE" });
}

// Nearby geolocation
export interface NearbyUser {
  user_id: number;
  username?: string;
  name?: string;
  latitude: number;
  longitude: number;
  distance_km?: number;
  distance_m?: number;
  accuracy_estimate: string;
  status: string;
}

export interface NearbySearchResponse {
  success: boolean;
  total: number;
  radius_km: number;
  users: NearbyUser[];
  center: { latitude: number; longitude: number };
  privacy_level: string;
}

export function updateNearbyLocation(
  latitude: number,
  longitude: number,
  accuracy: number
): Promise<{ success: boolean }> {
  return request("/api/webapp/nearby/update-location", {
    method: "POST",
    body: { latitude, longitude, accuracy },
  });
}

export function searchNearby(
  latitude: number,
  longitude: number,
  radius = 5,
  limit = 50
): Promise<NearbySearchResponse> {
  return request(
    `/api/webapp/nearby/search?latitude=${latitude}&longitude=${longitude}&radius=${radius}&limit=${limit}`
  );
}

// Live tips proxy
export interface Performer {
  id: number;
  name: string;
  slug: string;
  bio: string;
  photo: string | null;
  categories: string[];
}

export interface RecentTip {
  id: number;
  amount: number;
  user_username: string;
  model_name: string;
  created_at: string;
  payment_status: string;
}

export const TIP_AMOUNTS = [5, 10, 20, 50, 100] as const;

export function getPerformers(): Promise<{
  success: boolean;
  performers: Performer[];
}> {
  return request("/api/proxy/live/performers");
}

export function sendTip(
  performerId: number,
  amount: number,
  message?: string
): Promise<{ success: boolean; tipId: number; paymentUrl: string | null; amount: number }> {
  return request("/api/proxy/live/tips", {
    method: "POST",
    body: { performerId, amount, message },
  });
}

export function getRecentTips(
  limit = 10
): Promise<{ success: boolean; tips: RecentTip[] }> {
  return request(`/api/proxy/live/tips/recent?limit=${limit}`);
}

// Profile
export interface UserProfile {
  id: string;
  pnptvId: string;
  username: string;
  firstName: string;
  lastName: string | null;
  email?: string;
  bio: string | null;
  photoUrl: string | null;
  subscriptionStatus: string;
  tier: string;
  subscriptionPlan?: string;
  subscriptionExpires?: string;
  language?: string;
  interests?: string[];
  locationText?: string;
  xHandle?: string;
  instagramHandle?: string;
  tiktokHandle?: string;
  youtubeHandle?: string;
  memberSince: string;
  postCount?: number;
}

export interface SocialPostItem {
  id: number;
  content: string;
  media_url: string | null;
  media_type: string | null;
  reply_to_id: number | null;
  repost_of_id: number | null;
  likes_count: number;
  reposts_count: number;
  replies_count: number;
  created_at: string;
  author_id: string;
  author_username: string;
  author_first_name: string;
  author_photo: string | null;
  liked_by_me: boolean;
  repost_content?: string;
  repost_created_at?: string;
  repost_author_username?: string;
  repost_author_first_name?: string;
}

export function getProfile(): Promise<{ success: boolean; profile: UserProfile }> {
  return request("/api/webapp/profile");
}

export function updateProfile(
  fields: Partial<{
    firstName: string;
    lastName: string;
    bio: string;
    locationText: string;
    interests: string;
    xHandle: string;
    instagramHandle: string;
    tiktokHandle: string;
    youtubeHandle: string;
  }>
): Promise<{ success: boolean }> {
  return request("/api/webapp/profile", { method: "PUT", body: fields });
}

export async function uploadAvatar(file: File): Promise<{ success: boolean; photoUrl: string }> {
  const formData = new FormData();
  formData.append("avatar", file);

  const res = await fetch(`${API_BASE}/api/webapp/profile/avatar`, {
    method: "POST",
    credentials: "include",
    body: formData,
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error || `API error ${res.status}`);
  }

  return res.json();
}

export function getPublicProfile(
  userId: string,
  cursor?: string,
  limit = 20
): Promise<{
  success: boolean;
  profile: UserProfile;
  posts: SocialPostItem[];
  nextCursor: string | null;
}> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set("cursor", cursor);
  return request(`/api/webapp/social/profile/${userId}?${params}`);
}

export function getSocialFeedPosts(
  cursor?: string,
  limit = 20
): Promise<{ success: boolean; posts: SocialPostItem[]; nextCursor: string | null }> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set("cursor", cursor);
  return request(`/api/webapp/social/feed?${params}`);
}

export function createSocialPost(
  content: string,
  mediaFile?: File
): Promise<{ success: boolean; post: SocialPostItem }> {
  if (mediaFile) {
    // Use FormData for media posts
    const formData = new FormData();
    formData.append("content", content);
    formData.append("media", mediaFile);
    return fetch(`${API_BASE}/api/webapp/social/posts/with-media`, {
      method: "POST",
      credentials: "include",
      body: formData,
    }).then(async (res) => {
      if (!res.ok) {
        const error = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(error.error || `API error ${res.status}`);
      }
      return res.json();
    });
  }
  return request("/api/webapp/social/posts", { method: "POST", body: { content } });
}

export function togglePostLike(postId: number): Promise<{ success: boolean; liked: boolean; likes_count: number }> {
  return request(`/api/webapp/social/posts/${postId}/like`, { method: "POST" });
}

export function deleteSocialPost(postId: number): Promise<{ success: boolean }> {
  return request(`/api/webapp/social/posts/${postId}`, { method: "DELETE" });
}

// Aliases used by Home.tsx internal feed
export type InternalPost = SocialPostItem;

export function getInternalFeed(
  limit = 20
): Promise<{ success: boolean; posts: InternalPost[] }> {
  return getSocialFeedPosts(undefined, limit);
}

// Hangout Groups
export interface HangoutGroup {
  id: number;
  name: string;
  description: string;
  avatarUrl: string | null;
  creatorId: string | null;
  isMain: boolean;
  isPublic: boolean;
  maxMembers: number;
  memberCount: number;
  createdAt: string;
  hasActiveCall: boolean;
  activeCallId: string | null;
  lastMessage: string | null;
}

export interface GroupMessage {
  id: number;
  room: string;
  user_id: string;
  username: string;
  first_name: string;
  photo_url: string | null;
  content: string;
  created_at: string;
}

export interface GroupMember {
  user_id: string;
  role: string;
  joined_at: string;
  username: string;
  first_name: string;
  photo_url: string | null;
}

export function getHangoutGroups(): Promise<{ success: boolean; groups: HangoutGroup[] }> {
  return request("/api/webapp/hangouts/groups");
}

export function createHangoutGroup(
  name: string,
  description?: string
): Promise<{ success: boolean; group: HangoutGroup }> {
  return request("/api/webapp/hangouts/groups", {
    method: "POST",
    body: { name, description },
  });
}

export function getHangoutGroup(
  id: number
): Promise<{ success: boolean; group: HangoutGroup; members: GroupMember[] }> {
  return request(`/api/webapp/hangouts/groups/${id}`);
}

export function joinHangoutGroup(id: number): Promise<{ success: boolean }> {
  return request(`/api/webapp/hangouts/groups/${id}/join`, { method: "POST" });
}

export function leaveHangoutGroup(id: number): Promise<{ success: boolean }> {
  return request(`/api/webapp/hangouts/groups/${id}/leave`, { method: "POST" });
}

export function deleteHangoutGroup(id: number): Promise<{ success: boolean }> {
  return request(`/api/webapp/hangouts/groups/${id}`, { method: "DELETE" });
}

export function getGroupMessages(
  id: number,
  cursor?: string
): Promise<{ success: boolean; messages: GroupMessage[] }> {
  const params = cursor ? `?cursor=${cursor}` : "";
  return request(`/api/webapp/hangouts/groups/${id}/messages${params}`);
}

export function sendGroupMessage(
  id: number,
  content: string
): Promise<{ success: boolean; message: GroupMessage }> {
  return request(`/api/webapp/hangouts/groups/${id}/messages`, {
    method: "POST",
    body: { content },
  });
}

export function startGroupCall(
  id: number
): Promise<{ success: boolean; jitsiUrl: string; callId: string; isNew: boolean }> {
  return request(`/api/webapp/hangouts/groups/${id}/call`, { method: "POST" });
}

// ============================================================================
// Phase 1: User Location API
// ============================================================================

export interface UserLocation {
  latitude: number;
  longitude: number;
  accuracy: number;
  isOnline: boolean;
  lastSeen: string;
  updatedAt: string;
}

export interface NearbyUser {
  id: string;
  username: string;
  firstName: string;
  photoUrl: string | null;
  distance: number; // meters
  isOnline: boolean;
  lastSeen: string;
}

export function getUserLocation(): Promise<{
  success: boolean;
  location: UserLocation | null;
  message?: string;
}> {
  return request("/api/webapp/profile/location");
}

export function updateUserLocation(location: {
  latitude: number;
  longitude: number;
  accuracy?: number;
  isOnline?: boolean;
}): Promise<{ success: boolean; location: UserLocation }> {
  return request("/api/webapp/profile/location", {
    method: "PUT",
    body: location,
  });
}

export function deleteUserLocation(): Promise<{ success: boolean; message: string }> {
  return request("/api/webapp/profile/location", { method: "DELETE" });
}

export function getNearbyUsers(
  radius?: number,
  limit?: number
): Promise<{
  success: boolean;
  users: NearbyUser[];
  radius: number;
  count: number;
}> {
  const params = new URLSearchParams();
  if (radius) params.append("radius", radius.toString());
  if (limit) params.append("limit", limit.toString());
  return request(`/api/webapp/users/nearby?${params.toString()}`);
}

// ============================================================================
// Phase 1: Block/Unblock Users API
// ============================================================================

export interface BlockedUser {
  id: string;
  username: string;
  firstName: string;
  photoUrl: string | null;
  blockedAt: string;
}

export function blockUser(blockedUserId: string): Promise<{
  success: boolean;
  message: string;
}> {
  return request("/api/webapp/users/block", {
    method: "POST",
    body: { blockedUserId },
  });
}

export function unblockUser(blockedUserId: string): Promise<{
  success: boolean;
  message: string;
}> {
  return request(`/api/webapp/users/unblock/${blockedUserId}`, {
    method: "DELETE",
  });
}

export function getBlockedUsers(): Promise<{
  success: boolean;
  blockedUsers: BlockedUser[];
  count: number;
}> {
  return request("/api/webapp/users/blocked");
}

export function isUserBlocked(userId: string): Promise<{
  success: boolean;
  isBlocked: boolean;
}> {
  return request(`/api/webapp/users/is-blocked/${userId}`);
}

// ============================================================================
// Phase 1: Direct Messages API
// ============================================================================

export interface MessageThread {
  userId: string;
  username: string;
  firstName: string;
  photoUrl: string | null;
  lastMessage: string;
  lastMessageAt: string;
  unreadCount: number;
}

export interface DirectMessage {
  id: number;
  senderId: string;
  recipientId: string;
  content: string;
  isRead: boolean;
  createdAt: string;
  isMine: boolean;
}

export function getMessageThreads(): Promise<{
  success: boolean;
  threads: MessageThread[];
  count: number;
}> {
  return request("/api/webapp/messages/threads");
}

export function getMessages(
  otherUserId: string,
  limit?: number,
  before?: number
): Promise<{
  success: boolean;
  messages: DirectMessage[];
  count: number;
  hasMore: boolean;
}> {
  const params = new URLSearchParams();
  if (limit) params.append("limit", limit.toString());
  if (before) params.append("before", before.toString());
  return request(`/api/webapp/messages/thread/${otherUserId}?${params.toString()}`);
}

export function sendMessage(recipientId: string, content: string): Promise<{
  success: boolean;
  message: DirectMessage;
}> {
  return request("/api/webapp/messages/send", {
    method: "POST",
    body: { recipientId, content },
  });
}

export function deleteMessage(messageId: number): Promise<{
  success: boolean;
  message: string;
}> {
  return request(`/api/webapp/messages/${messageId}`, {
    method: "DELETE",
  });
}

export function markThreadAsRead(otherUserId: string): Promise<{
  success: boolean;
  message: string;
}> {
  return request(`/api/webapp/messages/thread/${otherUserId}/read`, {
    method: "PUT",
  });
}

// ============================================================================
// Phase 1: Notifications API
// ============================================================================

export interface Notification {
  id: string;
  type: "like" | "message" | "group_message" | "comment" | "follow";
  actorId: string;
  actorUsername: string;
  actorFirstName: string;
  actorPhotoUrl: string | null;
  postId?: number;
  groupId?: number;
  groupName?: string;
  content?: string;
  createdAt: string;
  message: string;
}

export interface NotificationCounts {
  messages: number;
  likes: number;
  total: number;
}

export function getNotifications(
  limit?: number,
  offset?: number
): Promise<{
  success: boolean;
  notifications: Notification[];
  count: number;
  totalCount: number;
  unreadCounts: NotificationCounts;
  hasMore: boolean;
}> {
  const params = new URLSearchParams();
  if (limit) params.append("limit", limit.toString());
  if (offset) params.append("offset", offset.toString());
  return request(`/api/webapp/notifications?${params.toString()}`);
}

export function getNotificationCounts(): Promise<{
  success: boolean;
  counts: NotificationCounts;
}> {
  return request("/api/webapp/notifications/counts");
}

export function markNotificationsAsRead(
  type?: "messages" | "likes" | "all"
): Promise<{ success: boolean; message: string }> {
  return request("/api/webapp/notifications/mark-read", {
    method: "PUT",
    body: { type },
  });
}

// ============================================================================
// Subscription & Payments
// ============================================================================

export interface SubscriptionPlan {
  id: string;
  name: string;
  display_name?: string;
  sku: string;
  price: number;
  currency: string;
  duration_days: number;
  features?: string[];
  priceUSD: number;
  priceCOP: number;
  exchangeRate?: number;
  active: boolean;
}

export function getSubscriptionPlans(): Promise<{
  success: boolean;
  plans: SubscriptionPlan[];
}> {
  return request("/api/subscription/plans");
}

export function createPayment(
  planId: string,
  provider: "epayco" | "daimo"
): Promise<{
  success: boolean;
  paymentUrl: string;
  paymentId: string;
  error?: string;
}> {
  return request("/api/webapp/payments/create", {
    method: "POST",
    body: { planId, provider },
  });
}

// Health check
export function healthCheck(): Promise<{ status: string }> {
  return request("/health");
}
