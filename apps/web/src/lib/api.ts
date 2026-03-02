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

export interface AuthMethods {
  telegram: boolean;
  atproto: boolean;
  x: boolean;
}

export interface AuthStatusResponse {
  authenticated: boolean;
  user?: TelegramAuthResponse["user"] & {
    atproto_did?: string | null;
    atproto_handle?: string | null;
    x_handle?: string | null;
    auth_methods?: AuthMethods;
    creator_status?: string;
    creator_type?: string | null;
  };
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

export function unlinkAtproto(): Promise<{ success: boolean; message: string }> {
  return request("/api/webapp/auth/atproto/unlink", { method: "POST" });
}

export function unlinkX(): Promise<{ success: boolean; message: string }> {
  return request("/api/webapp/auth/x/unlink", { method: "POST" });
}

export function getXLoginUrl(): string {
  const base = import.meta.env.VITE_API_URL || "https://pnptv.app";
  return `${base}/api/webapp/auth/x/start?redirect=true`;
}

/**
 * Initiates an ATProto/Bluesky OAuth flow for the given handle.
 * This is a redirect — the function builds the URL and navigates to it.
 * The backend /oauth/login?handle=X will redirect to the Bluesky authorization server.
 */
export function getAtprotoLoginUrl(handle: string): string {
  const base = import.meta.env.VITE_API_URL || "https://pnptv.app";
  return `${base}/oauth/login?handle=${encodeURIComponent(handle)}`;
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

// Nearby geolocation
export interface NearbyUser {
  user_id: number;
  username?: string;
  name?: string;
  photo_url?: string | null;
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
  /** Present only on free-tier responses — identifies the response shape */
  tier?: string;
  /** Present only on free-tier responses — count of nearby users without exposing locations */
  count?: number;
}

/** Free-tier nearby response — only returns a count, no user data */
export interface NearbyFreeTierResponse {
  success: boolean;
  tier: "free";
  count: number;
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

export interface NearbyPlace {
  id: number;
  name: string;
  description?: string;
  address?: string;
  city?: string;
  placeType?: string;
  categoryName?: string;
  categoryEmoji?: string;
  categorySlug?: string;
  location: { lat: number; lng: number };
  distance: number;
  website?: string;
  phone?: string;
  instagram?: string;
  telegramUsername?: string;
  photoUrl?: string;
}

export interface NearbyPlacesResponse {
  success: boolean;
  total: number;
  radius_km: number;
  places: NearbyPlace[];
}

export function searchNearbyPlaces(
  latitude: number,
  longitude: number,
  radius = 10
): Promise<NearbyPlacesResponse> {
  return request(
    `/api/webapp/nearby/places?latitude=${latitude}&longitude=${longitude}&radius=${radius}`
  );
}

// Live tips
export interface RecentTip {
  id: number;
  amount: number;
  user_username: string;
  model_name: string;
  created_at: string;
  payment_status: string;
}

export const TIP_AMOUNTS = [5, 10, 20, 50, 100] as const;

export function sendTip(
  performerId: string,
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
  wofPhotoConsent?: boolean;
  // Creator fields
  creatorStatus?: string;
  creatorType?: string;
  creatorPriceUsd?: number | null;
  creatorVerified?: boolean;
  creatorFeatured?: boolean;
  creatorSubscriberCount?: number;
  // Performer fields (set when user has an active performers record)
  performerData?: {
    id: string;
    isAvailable: boolean;
    basePrice: number;
    averageRating: number;
    totalCalls: number;
    availabilityMessage: string | null;
  } | null;
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
  is_wof?: boolean;
  // Exclusive content fields
  is_exclusive?: boolean;
  exclusive_status?: "unlocked" | "teaser" | "locked";
  locked_reason?: "not_prime" | "not_subscribed";
  // Creator info on author
  author_creator_status?: string;
  author_creator_type?: string;
  author_creator_verified?: boolean;
  author_creator_price?: number;
  // Sharing control
  is_shareable?: boolean;
  // Bluesky cross-post fields
  bluesky_uri?: string | null;
  bluesky_cid?: string | null;
  source?: "local" | "bluesky";
  bsky_author_handle?: string | null;
  bsky_author_avatar?: string | null;
  bsky_author_display_name?: string | null;
  // Tier-gating fields (free-tier users see blurred posts)
  blurred?: boolean;
  content_tier?: string;
}

// ============================================================================
// ATProto / Bluesky Profile API
// ============================================================================

export interface AtprotoProfile {
  did: string;
  handle: string;
  displayName?: string;
  description?: string;
  avatar?: string;
  followersCount?: number;
  followsCount?: number;
  postsCount?: number;
  profileUrl: string;
}

export function getAtprotoProfile(): Promise<{
  success: boolean;
  linked: boolean;
  profile: AtprotoProfile | null;
  error?: string;
}> {
  return request("/api/atproto/profile");
}

export function crossPostToBluesky(postId: number): Promise<{
  success: boolean;
  uri?: string;
  cid?: string;
  error?: string;
}> {
  return request(`/api/webapp/social/posts/${postId}/crosspost-bluesky`, {
    method: "POST",
  });
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
    wofPhotoConsent: boolean;
    contentDisclaimer: boolean;
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

export function getWofFeedPosts(
  cursor?: string,
  limit = 20
): Promise<{ success: boolean; posts: SocialPostItem[]; nextCursor: string | null }> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set("cursor", cursor);
  return request(`/api/webapp/social/wof-feed?${params}`);
}

export function createSocialPost(
  content: string,
  mediaFile?: File,
  crossPostBluesky?: boolean,
  isExclusive?: boolean,
  isShareable?: boolean
): Promise<{ success: boolean; post: SocialPostItem }> {
  if (mediaFile) {
    // Use FormData for media posts
    const formData = new FormData();
    formData.append("content", content);
    formData.append("media", mediaFile);
    if (crossPostBluesky) formData.append("crossPostBluesky", "true");
    if (isExclusive) formData.append("isExclusive", "true");
    if (isShareable === false) formData.append("isShareable", "false");
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
  return request("/api/webapp/social/posts", {
    method: "POST",
    body: { content, crossPostBluesky: crossPostBluesky ?? false, isExclusive: isExclusive ?? false, isShareable: isShareable ?? true },
  });
}

export function togglePostLike(postId: number): Promise<{ liked: boolean }> {
  return request(`/api/webapp/social/posts/${postId}/like`, { method: "POST" });
}

export function deleteSocialPost(postId: number): Promise<{ success: boolean }> {
  return request(`/api/webapp/social/posts/${postId}`, { method: "DELETE" });
}

export function requestWofDeletion(postId: number): Promise<{ success: boolean }> {
  return request(`/api/webapp/social/posts/${postId}/request-deletion`, { method: "POST" });
}

export function getReplies(
  postId: number,
  cursor?: string
): Promise<{ success: boolean; replies: SocialPostItem[] }> {
  const params = new URLSearchParams();
  if (cursor) params.set("cursor", cursor);
  return request(`/api/webapp/social/posts/${postId}/replies?${params}`);
}

export function createReply(
  postId: number,
  content: string
): Promise<{ success: boolean; post: SocialPostItem }> {
  return request("/api/webapp/social/posts", {
    method: "POST",
    body: { content, replyToId: postId },
  });
}

// Aliases used by Home.tsx internal feed
export type InternalPost = SocialPostItem;

export function getInternalFeed(
  limit = 20
): Promise<{ success: boolean; posts: InternalPost[] }> {
  return getSocialFeedPosts(undefined, limit);
}

/**
 * Home page preview feed — no auth required, returns latest N posts.
 * liked_by_me is always false; use getSocialFeedPosts on the Social page for
 * accurate per-viewer like state.
 */
export function getHomeFeedPosts(
  limit = 10
): Promise<{ success: boolean; posts: SocialPostItem[] }> {
  const params = new URLSearchParams({ limit: String(limit) });
  return request(`/api/webapp/social/home-feed?${params}`);
}

// Hangout Groups
export interface HangoutGroup {
  id: number;
  name: string;
  description: string;
  avatarUrl: string | null;
  creatorId: string | null;
  isMain: boolean;
  isWallOfFame?: boolean;
  isPublic: boolean;
  maxMembers: number;
  memberCount: number;
  createdAt: string;
  hasActiveCall: boolean;
  activeCallId: string | null;
  lastMessage: string | null;
  unreadCount?: number;
}

export interface GroupMessage {
  id: number;
  room: string;
  user_id: string;
  username: string;
  first_name: string;
  photo_url: string | null;
  content: string | null;
  media_url: string | null;
  media_type: "image" | "video" | null;
  media_mime: string | null;
  media_thumb_url: string | null;
  media_width: number | null;
  media_height: number | null;
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
  description?: string,
  isPublic?: boolean
): Promise<{ success: boolean; group: HangoutGroup }> {
  return request("/api/webapp/hangouts/groups", {
    method: "POST",
    body: { name, description, isPublic },
  });
}

export interface DiscoverGroup {
  id: number;
  name: string;
  description: string;
  avatarUrl: string | null;
  creatorId: string | null;
  isPublic: boolean;
  memberCount: number;
  createdAt: string;
  myRequestStatus: "pending" | "accepted" | "rejected" | null;
}

export function discoverHangoutGroups(): Promise<{ success: boolean; groups: DiscoverGroup[] }> {
  return request("/api/webapp/hangouts/groups/discover");
}

export function requestJoinGroup(id: number): Promise<{ success: boolean }> {
  return request(`/api/webapp/hangouts/groups/${id}/request-join`, { method: "POST" });
}

export interface JoinRequest {
  id: number;
  user_id: string;
  status: string;
  created_at: string;
  username: string;
  first_name: string;
  photo_url: string | null;
}

export function getJoinRequests(id: number): Promise<{ success: boolean; requests: JoinRequest[] }> {
  return request(`/api/webapp/hangouts/groups/${id}/requests`);
}

export function handleJoinRequest(
  groupId: number,
  requestId: number,
  action: "accept" | "reject"
): Promise<{ success: boolean; status: string }> {
  return request(`/api/webapp/hangouts/groups/${groupId}/requests/${requestId}/${action}`, {
    method: "POST",
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
  const params = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
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

export async function sendGroupMediaMessage(
  groupId: number,
  mediaFile: File,
  caption?: string
): Promise<{ success: boolean; message: GroupMessage }> {
  const formData = new FormData();
  formData.append("media", mediaFile);
  if (caption?.trim()) formData.append("content", caption.trim());

  const res = await fetch(
    `${API_BASE}/api/webapp/hangouts/groups/${groupId}/media`,
    {
      method: "POST",
      credentials: "include",
      body: formData,
    }
  );

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error || `API error ${res.status}`);
  }

  return res.json();
}

export interface JaasCallInfo {
  token: string;
  meetingUrl: string;
  domain: string;
  appId: string;
}

export interface ActiveCallInfo {
  id: string;
  groupId: number;
  roomName: string;
  creatorId: string;
  createdAt: string;
  isPersistent?: boolean;
  isModerator?: boolean;
  participantCount?: number;
  participants?: Array<{
    userId: string;
    displayName: string;
    username: string;
    photoUrl: string | null;
    joinedAt: string;
  }>;
}

export interface StartCallResponse {
  success: boolean;
  isNew: boolean;
  call: ActiveCallInfo;
  jaas: JaasCallInfo | null;
}

export function startGroupCall(id: number): Promise<StartCallResponse> {
  return request(`/api/webapp/hangouts/groups/${id}/calls`, { method: "POST" });
}

export function markGroupAsRead(groupId: number): Promise<{ success: boolean }> {
  return request(`/api/webapp/hangouts/groups/${groupId}/read`, { method: "POST" });
}

export interface GetActiveCallResponse {
  success: boolean;
  call: ActiveCallInfo | null;
  jaas: JaasCallInfo | null;
}

export function getActiveGroupCall(groupId: number): Promise<GetActiveCallResponse> {
  return request(`/api/webapp/hangouts/groups/${groupId}/calls/active`);
}

export function leaveGroupCall(
  groupId: number,
  callId: string
): Promise<{ success: boolean }> {
  return request(`/api/webapp/hangouts/groups/${groupId}/calls/${callId}/leave`, {
    method: "POST",
  });
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

export interface NearbyUserBasic {
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
  users: NearbyUserBasic[];
  radius: number;
  count: number;
}> {
  const params = new URLSearchParams();
  if (radius) params.append("radius", radius.toString());
  if (limit) params.append("limit", limit.toString());
  return request(`/api/webapp/users/nearby?${params.toString()}`);
}

// ============================================================================
// Follow System API
// ============================================================================

export interface FollowListUser {
  id: string;
  username: string;
  firstName: string;
  lastName: string | null;
  photoUrl: string | null;
  followedAt: string;
}

export function followUser(userId: string): Promise<{
  success: boolean;
  isFollowing: boolean;
  followerCount: number;
  followingCount: number;
}> {
  return request("/api/webapp/users/follow", { method: "POST", body: { userId } });
}

export function unfollowUser(userId: string): Promise<{
  success: boolean;
  isFollowing: boolean;
  followerCount: number;
  followingCount: number;
}> {
  return request("/api/webapp/users/unfollow", { method: "POST", body: { userId } });
}

export function getFollowStatus(userId: string): Promise<{
  success: boolean;
  isFollowing: boolean;
  followerCount: number;
  followingCount: number;
}> {
  return request(`/api/webapp/users/follow-status/${userId}`);
}

export function getFollowersList(
  userId: string,
  cursor?: string
): Promise<{ success: boolean; users: FollowListUser[]; nextCursor: string | null }> {
  const params = new URLSearchParams();
  if (cursor) params.set("cursor", cursor);
  return request(`/api/webapp/users/${userId}/followers?${params}`);
}

export function getFollowingList(
  userId: string,
  cursor?: string
): Promise<{ success: boolean; users: FollowListUser[]; nextCursor: string | null }> {
  const params = new URLSearchParams();
  if (cursor) params.set("cursor", cursor);
  return request(`/api/webapp/users/${userId}/following?${params}`);
}

export function getFollowingFeed(
  cursor?: string
): Promise<{ success: boolean; posts: SocialPostItem[]; nextCursor: string | null }> {
  const params = new URLSearchParams();
  if (cursor) params.set("cursor", cursor);
  return request(`/api/webapp/social/feed/following?${params}`);
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
  content: string | null;
  mediaUrl: string | null;
  mediaType: "image" | "video" | null;
  mediaMime: string | null;
  mediaThumbUrl: string | null;
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
  /** Remaining DM sends for today (free-tier users only) */
  remaining?: number;
  /** Daily DM limit (free-tier users only) */
  limit?: number;
}> {
  return request("/api/webapp/messages/send", {
    method: "POST",
    body: { recipientId, content },
  });
}

export async function sendDmMediaMessage(
  recipientId: string,
  mediaFile: File,
  caption?: string
): Promise<{ success: boolean; message: DirectMessage; remaining?: number; limit?: number }> {
  const formData = new FormData();
  formData.append("media", mediaFile);
  if (caption?.trim()) formData.append("content", caption.trim());

  const res = await fetch(
    `${API_BASE}/api/webapp/dm/media/${encodeURIComponent(recipientId)}`,
    {
      method: "POST",
      credentials: "include",
      body: formData,
    }
  );

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error || `API error ${res.status}`);
  }

  return res.json();
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
  type: string;
  category?: string;
  priority?: string;
  actorId: string;
  actorUsername: string;
  actorFirstName: string;
  actorPhotoUrl: string | null;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  isRead?: boolean;
  postId?: number;
  groupId?: number;
  groupName?: string;
  content?: string;
  createdAt: string;
  message: string;
}

export interface NotificationCounts {
  social?: number;
  messaging?: number;
  hangouts?: number;
  commerce?: number;
  system?: number;
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
  tier?: string;
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

// ============================================================================
// Cristina AI Support
// ============================================================================

export interface SupportSuggestion {
  id: string;
  label: string;
  icon: string;
}

export interface SupportChatResponse {
  success: boolean;
  response: string;
  historyLength: number;
}

export function getSupportSuggestions(
  lang = "en"
): Promise<{ success: boolean; suggestions: SupportSuggestion[] }> {
  return request(`/api/webapp/support/suggestions?lang=${lang}`);
}

export function sendSupportMessage(
  message: string,
  lang = "en"
): Promise<SupportChatResponse> {
  return request("/api/webapp/support/chat", {
    method: "POST",
    body: { message, lang },
  });
}

export function clearSupportHistory(): Promise<{ success: boolean }> {
  return request("/api/webapp/support/history", { method: "DELETE" });
}

// Performers (Directus CMS-backed)
export interface FeaturedPerformer {
  id: string;
  userId: string | null;
  displayName: string;
  bio: string | null;
  photoUrl: string | null;
  isFeatured: boolean;
  isAvailable: boolean;
  basePrice: number;
  totalCalls: number;
  averageRating: number;
}

export function getFeaturedPerformers(): Promise<{
  success: boolean;
  performers: FeaturedPerformer[];
}> {
  return request("/api/performers/featured");
}

export function getAllPerformers(): Promise<{
  success: boolean;
  performers: FeaturedPerformer[];
}> {
  return request("/api/performers");
}

// ============================================================================
// Model/Creator Application API
// ============================================================================

export interface ModelApplication {
  id: string;
  application_type: "live" | "content_creator" | "both";
  stage_name: string;
  status: "pending" | "approved" | "rejected" | "withdrawn";
  call_scheduled: boolean;
  created_at: string;
  updated_at: string;
}

export interface ModelApplicationPayload {
  applicationType: "live" | "content_creator" | "both";
  stageName: string;
  bio?: string;
  instagramHandle?: string;
  twitterHandle?: string;
  onlyfansUrl?: string;
  profilePhotoUrl?: string;
  legalFullName: string;
  dateOfBirth: string;
  country: string;
  cityState: string;
  idFrontUrl: string;
  idBackUrl: string;
  termsAgreed: boolean;
}

export function getApplicationStatus(): Promise<{
  success: boolean;
  hasApplication: boolean;
  application?: ModelApplication;
}> {
  return request("/api/apply/status");
}

export async function uploadApplicationProfilePhoto(
  file: File
): Promise<{ success: boolean; photoUrl: string }> {
  const formData = new FormData();
  formData.append("photo", file);

  const res = await fetch(`${API_BASE}/api/apply/profile-photo`, {
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

export async function uploadApplicationIdDocuments(
  front: File,
  back: File
): Promise<{ success: boolean; idFrontUrl: string; idBackUrl: string }> {
  const formData = new FormData();
  formData.append("front", front);
  formData.append("back", back);

  const res = await fetch(`${API_BASE}/api/apply/id-documents`, {
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

export function submitModelApplication(
  payload: ModelApplicationPayload
): Promise<{ success: boolean; application: { id: string; status: string; created_at: string } }> {
  return request("/api/apply/submit", { method: "POST", body: payload });
}

export function markCallScheduled(
  applicationId?: string
): Promise<{ success: boolean; applicationId: string }> {
  return request("/api/apply/mark-scheduled", {
    method: "POST",
    body: { applicationId },
  });
}

// ============================================================================
// Creator Monetization API
// ============================================================================

export interface CreatorEligibility {
  eligible: boolean;
  criteria: {
    mediaPosts: { current: number; required: number; met: boolean };
    totalLikes: { current: number; required: number; met: boolean };
    followers: { current: number; required: number; met: boolean };
    weeklyConsistency: { current: number; required: number; met: boolean };
  };
  missing: string[];
}

export interface CreatorDashboard {
  subscriberCount: number;
  creatorStatus: string;
  creatorType: string | null;
  priceUsd: number;
  verified: boolean;
  featured: boolean;
  totalEarnings: number;
  monthlyEarnings: number;
  exclusivePostCount: number;
  application: {
    id: string;
    status: string;
    call_scheduled: boolean;
    call_scheduled_at: string | null;
    created_at: string;
  } | null;
}

export interface CreatorSubscriptionStatus {
  subscribed: boolean;
  subscription: {
    id: string;
    status: string;
    price_usd: number;
    started_at: string;
    expires_at: string;
    auto_renew: boolean;
  } | null;
  creator: {
    status: string;
    type: string;
    priceUsd: number;
    verified: boolean;
    subscriberCount: number;
  };
}

export interface CreatorApplication {
  id: string;
  user_id: string;
  username: string;
  first_name: string;
  photo_file_id: string | null;
  application_type: "live" | "content_creator" | "both";
  stage_name: string;
  bio: string | null;
  status: "pending" | "approved" | "rejected" | "withdrawn";
  requested_price_usd: number | null;
  call_scheduled: boolean;
  call_scheduled_at: string | null;
  admin_notes: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export function getCreatorEligibility(): Promise<{
  success: boolean;
} & CreatorEligibility> {
  return request("/api/webapp/creator/eligibility");
}

export function activateCreator(
  tier: "ice" | "crystal" | "diamond",
  termsAccepted: boolean
): Promise<{
  success: boolean;
  type: string;
  price: number;
}> {
  return request("/api/webapp/creator/activate", {
    method: "POST",
    body: { tier, termsAccepted },
  });
}

// Full-time applications use /api/apply (existing model_applications flow)

export function getCreatorDashboard(): Promise<{
  success: boolean;
} & CreatorDashboard> {
  return request("/api/webapp/creator/dashboard");
}

export function getCreatorSubscriptionStatus(
  creatorId: string
): Promise<{ success: boolean } & CreatorSubscriptionStatus> {
  return request(`/api/webapp/creator/${creatorId}/subscription-status`);
}

export function subscribeToCreator(
  creatorId: string,
  paymentId?: string
): Promise<{
  success: boolean;
  subscriptionId: string;
  expiresAt: string;
  price: number;
}> {
  return request(`/api/webapp/creator/${creatorId}/subscribe`, {
    method: "POST",
    body: { paymentId },
  });
}

export function unsubscribeFromCreator(
  creatorId: string
): Promise<{ success: boolean }> {
  return request(`/api/webapp/creator/${creatorId}/unsubscribe`, {
    method: "POST",
  });
}

export function getCreatorApplications(
  status?: string
): Promise<{ success: boolean; applications: CreatorApplication[] }> {
  const params = status ? `?status=${status}` : "";
  return request(`/api/webapp/creator/applications${params}`);
}

export function approveCreatorApplication(
  applicationId: string,
  notes?: string
): Promise<{ success: boolean }> {
  return request(`/api/webapp/creator/applications/${applicationId}/approve`, {
    method: "POST",
    body: { notes },
  });
}

export function rejectCreatorApplication(
  applicationId: string,
  notes?: string
): Promise<{ success: boolean }> {
  return request(`/api/webapp/creator/applications/${applicationId}/reject`, {
    method: "POST",
    body: { notes },
  });
}

// ============================================================================
// Model Dashboard API (role-protected: model/admin)
// ============================================================================

export interface ModelDashboardStats {
  totalEarnings: number;
  monthlyEarnings: number;
  totalContent: number;
  activeSubscribers: number;
  pendingWithdrawals: number;
}

export interface ModelEarnings {
  summary: {
    total_gross: number;
    total_creator: number;
    total_platform: number;
    pending_amount: number;
  };
  byType: Record<string, number>;
  trends: Array<{ month: string; amount: number }>;
}

export interface ModelWithdrawal {
  id: string;
  amountUsd: number;
  method: string;
  status: string;
  requestedAt: string;
  processedAt: string | null;
}

export function getModelDashboard(): Promise<{
  success: boolean;
  data: { stats: ModelDashboardStats };
}> {
  return request("/api/model/dashboard");
}

export function getModelEarnings(): Promise<{
  success: boolean;
  data: ModelEarnings;
}> {
  return request("/api/model/earnings");
}

export function getWithdrawableAmount(): Promise<{
  success: boolean;
  data: { withdrawable: { amount: number; currency: string } };
}> {
  return request("/api/model/withdrawal/available");
}

export function requestWithdrawal(
  method = "bank_transfer"
): Promise<{
  success: boolean;
  data: { withdrawal: ModelWithdrawal; earningsCount: number };
}> {
  return request("/api/model/withdrawal/request", {
    method: "POST",
    body: { method },
  });
}

export function getWithdrawalHistory(
  status?: string
): Promise<{
  success: boolean;
  data: {
    withdrawals: ModelWithdrawal[];
    stats: { totalWithdrawn: number; pendingAmount: number };
    count: number;
  };
}> {
  const params = status ? `?status=${status}` : "";
  return request(`/api/model/withdrawal/history${params}`);
}

// Health check
export function healthCheck(): Promise<{ status: string }> {
  return request("/health");
}
