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
    // error.error can be an object { code, message } from guard middleware — extract string safely
    const errorMessage =
      typeof error.error === "string"
        ? error.error
        : typeof (error.error as { message?: string })?.message === "string"
          ? (error.error as { message: string }).message
          : typeof error.message === "string"
            ? error.message
            : `API error ${res.status}`;
    throw new Error(errorMessage);
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
  location: { lat: number; lng: number } | null;
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

export function getFallbackNearbyPlaces(
  latitude: number,
  longitude: number,
): Promise<NearbyPlacesResponse & { fallback: boolean }> {
  return request(
    `/api/webapp/nearby/places/fallback?lat=${latitude}&lng=${longitude}`
  );
}

export interface SubmitPlacePayload {
  name: string;
  description?: string;
  address?: string;
  city?: string;
  country?: string;
  categoryId?: number;
  placeType: string;
  lat?: number;
  lng?: number;
  phone?: string;
  website?: string;
  instagram?: string;
}

export function submitNearbyPlace(payload: SubmitPlacePayload): Promise<{ success: boolean; message: string }> {
  return request("/api/webapp/nearby/places/submit", { method: "POST", body: payload });
}

export interface ReferralStats {
  code: string;
  link: string;
  total: number;
  completed: number;
}

export function getMyReferral(): Promise<ReferralStats> {
  return request("/api/webapp/me/referral");
}

export function redeemReferralCode(code: string): Promise<{ success?: boolean; alreadyRedeemed?: boolean }> {
  return request("/api/webapp/referral/redeem", { method: "POST", body: { code } });
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
  message?: string,
  paymentMethod: "daimo" | "tokens" = "daimo"
): Promise<{ success: boolean; tipId: number; paymentUrl: string | null; amount: number; paymentMethod: string; newBalance?: number }> {
  return request("/api/proxy/live/tips", {
    method: "POST",
    body: { performerId, amount, message, paymentMethod },
  });
}

// Dash Token Wallet
export interface TokenPackage {
  id: string;
  tokens: number;
  usd: number;
  label: string;
}

export interface TokenPurchase {
  id: number;
  tokens_credited: number;
  usd_amount: number;
  dash_amount: number | null;
  btcpay_invoice_id: string;
  status: string;
  created_at: string;
  settled_at: string | null;
}

export function getWalletBalance(): Promise<{ success: boolean; balance: number; dpnsHandle: string | null }> {
  return request("/api/wallet/balance");
}

export function getTokenPackages(): Promise<{ success: boolean; packages: TokenPackage[] }> {
  return request("/api/wallet/packages");
}

export function buyTokens(packageId: string): Promise<{ success: boolean; invoiceId: string; checkoutUrl: string; tokens: number; usd: number }> {
  return request("/api/wallet/buy", { method: "POST", body: { packageId } });
}

export function linkDPNS(dpnsHandle: string): Promise<{ success: boolean; dpnsHandle: string }> {
  return request("/api/wallet/link-dpns", { method: "POST", body: { dpnsHandle } });
}

export function getWalletHistory(): Promise<{ success: boolean; history: TokenPurchase[] }> {
  return request("/api/wallet/history");
}

export function getRecentTips(
  limit = 10
): Promise<{ success: boolean; tips: RecentTip[] }> {
  return request(`/api/proxy/live/tips/recent?limit=${limit}`);
}

export function getRtmpKey(): Promise<{
  success: boolean;
  rtmpUrl?: string;
  streamKey?: string;
  error?: string;
}> {
  return request("/api/webapp/live/rtmp-key");
}

export function getMyChannel(): Promise<{
  success: boolean;
  channel: { ref: string; streamKey: string; rtmpUrl: string } | null;
}> {
  return request("/api/webapp/live/my-channel");
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
  dateOfBirth?: string | null;
  city?: string | null;
  country?: string | null;
  privacy?: Record<string, boolean>;
  xHandle?: string;
  instagramHandle?: string;
  tiktokHandle?: string;
  youtubeHandle?: string;
  memberSince: string;
  postCount?: number;
  wofPhotoConsent?: boolean;
  contentDisclaimer?: boolean;
  display_name?: string;
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
  // Video thumbnail (poster frame generated server-side)
  video_thumbnail_url?: string | null;
  // Promoted post fields (CMS-managed featured content)
  is_promoted?: boolean;
  promoted_link?: string | null;
  promoted_link_label?: string | null;
  promoted_thumbnail?: string | null;
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
    dateOfBirth: string;
    city: string;
    country: string;
    interests: string;
    xHandle: string;
    instagramHandle: string;
    tiktokHandle: string;
    youtubeHandle: string;
    wofPhotoConsent: boolean;
    contentDisclaimer: boolean;
    language: "en" | "es";
  }>
): Promise<{ success: boolean }> {
  return request("/api/webapp/profile", { method: "PUT", body: fields });
}

export function updatePrivacy(settings: {
  showBio?: boolean;
  showOnline?: boolean;
  showLocation?: boolean;
  showDob?: boolean;
  allowMessages?: boolean;
  showInterests?: boolean;
}): Promise<{ success: boolean; privacy: Record<string, boolean> }> {
  return request("/api/webapp/privacy", { method: "PATCH", body: settings });
}

export function updateLanguage(lang: "en" | "es"): Promise<{ success: boolean }> {
  return updateProfile({ language: lang });
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

export type BulkVideoEntry = {
  file: File;
  caption: string;
  isExclusive: boolean;
  isShareable: boolean;
};

export type BulkUploadProgress = {
  loaded: number;
  total: number;
  percent: number;
};

export function bulkUploadVideos(
  entries: BulkVideoEntry[],
  onProgress?: (p: BulkUploadProgress) => void
): Promise<{ success: boolean; posts: SocialPostItem[]; errors: { index: number; error: string }[] }> {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    entries.forEach((entry) => {
      formData.append("videos", entry.file);
      formData.append("captions", entry.caption || "🎬");
      formData.append("isExclusive", entry.isExclusive ? "true" : "false");
      formData.append("isShareable", entry.isShareable ? "true" : "false");
    });

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE}/api/webapp/social/posts/bulk-videos`);
    xhr.withCredentials = true;

    if (onProgress) {
      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable) {
          onProgress({ loaded: e.loaded, total: e.total, percent: Math.round((e.loaded / e.total) * 100) });
        }
      });
    }

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText)); }
        catch { reject(new Error("Invalid server response")); }
      } else {
        try {
          const err = JSON.parse(xhr.responseText);
          reject(new Error(err.error || `Upload failed (${xhr.status})`));
        } catch { reject(new Error(`Upload failed (${xhr.status})`)); }
      }
    });
    xhr.addEventListener("error", () => reject(new Error("Network error during upload")));
    xhr.addEventListener("abort", () => reject(new Error("Upload cancelled")));
    xhr.send(formData);
  });
}

export function togglePostLike(postId: number): Promise<{ liked: boolean; likes_count?: number }> {
  return request(`/api/webapp/social/posts/${postId}/like`, { method: "POST" });
}

export function deleteSocialPost(postId: number): Promise<{ success: boolean }> {
  return request(`/api/webapp/social/posts/${postId}`, { method: "DELETE" });
}

export function requestWofDeletion(postId: number): Promise<{ success: boolean }> {
  return request(`/api/webapp/social/posts/${postId}/request-deletion`, { method: "POST" });
}

export function adminFlagWofPost(postId: number): Promise<{ success: boolean }> {
  return request(`/api/admin/social/posts/${postId}/wof`, { method: "POST" });
}

export function adminUnflagWofPost(postId: number): Promise<{ success: boolean }> {
  return request(`/api/admin/social/posts/${postId}/wof`, { method: "DELETE" });
}

export function getWofStats(): Promise<{ total_posts: number; total_likes: number; unique_contributors: number }> {
  return request("/api/webapp/social/wof/stats");
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
  displayName?: string;
}

export function searchUsers(
  q: string,
  limit = 20
): Promise<{
  success: boolean;
  users: Array<{
    id: string;
    username: string;
    first_name: string;
    last_name: string | null;
    photo_file_id: string | null;
    pnptv_id: string;
  }>;
}> {
  return request(
    `/api/webapp/users/search?q=${encodeURIComponent(q)}&limit=${limit}`
  );
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
  duration?: number;
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
  provider: "epayco" | "daimo",
  email: string
): Promise<{
  success: boolean;
  paymentUrl: string;
  paymentId: string;
  error?: string;
}> {
  return request("/api/webapp/payments/create", {
    method: "POST",
    body: { planId, provider, email },
  });
}

export function initiateCreatorSubscriptionPayment(
  creatorId: string,
  provider: "epayco" | "daimo",
  email: string
): Promise<{
  success: boolean;
  paymentUrl: string;
  paymentId: string;
  error?: string;
}> {
  return request("/api/webapp/payments/create", {
    method: "POST",
    body: { planId: "creator_monthly", provider, email, creatorId },
  });
}

export function getPaymentStatus(
  paymentId: string
): Promise<{
  success: boolean;
  status: string;
  planName?: string;
  amount?: number;
  currency?: string;
  transactionId?: string;
  message?: string;
  error?: string;
}> {
  return request(`/api/payment/${encodeURIComponent(paymentId)}/status`);
}

export function createDashSubscription(
  planId: string,
  email: string
): Promise<{
  success: boolean;
  invoiceId: string;
  checkoutUrl: string;
  planName?: string;
  usdAmount?: number;
  error?: string;
}> {
  return request("/api/webapp/payments/dash/create", {
    method: "POST",
    body: { planId, email },
  });
}

export function getDashSubscriptionStatus(invoiceId: string): Promise<{
  success: boolean;
  status: string;
  error?: string;
}> {
  return request(`/api/webapp/payments/dash/status/${encodeURIComponent(invoiceId)}`);
}

export function getDashAvailable(): Promise<{
  available: boolean;
  configured: boolean;
  reachable: boolean;
  reason?: string;
}> {
  return request("/api/webapp/payments/dash/available");
}

export function activateMeruCode(
  code: string,
  email: string
): Promise<{
  success: boolean;
  message?: string;
  error?: string;
}> {
  return request("/api/webapp/activate/meru", {
    method: "POST",
    body: { code, email },
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

// Support Ticket Types
export interface SupportTicket {
  user_id: string;
  thread_id: number;
  thread_name: string;
  status: string;
  priority: string;
  category: string;
  language: string;
  created_at: string;
  last_message_at: string;
  first_response_at: string | null;
  message_count: number;
}

export interface TicketMessage {
  id: number;
  sender_type: "user" | "agent";
  sender_name: string;
  content: string;
  created_at: string;
}

export type TicketCategory =
  | "payment"
  | "account"
  | "bug"
  | "feature"
  | "technical"
  | "general";

export function createSupportTicket(
  category: TicketCategory,
  description: string
): Promise<{ success: boolean; ticket: SupportTicket }> {
  return request("/api/webapp/support/ticket", {
    method: "POST",
    body: { category, description },
  });
}

export function getSupportTicket(): Promise<{
  success: boolean;
  ticket: SupportTicket | null;
}> {
  return request("/api/webapp/support/ticket");
}

export function getTicketMessages(since?: string): Promise<{
  success: boolean;
  messages: TicketMessage[];
}> {
  const params = since ? `?since=${encodeURIComponent(since)}` : "";
  return request(`/api/webapp/support/ticket/messages${params}`);
}

export function addTicketMessage(
  message: string
): Promise<{ success: boolean }> {
  return request("/api/webapp/support/ticket/message", {
    method: "POST",
    body: { message },
  });
}

// Performers (Directus CMS-backed)
export interface FeaturedPerformer {
  id: string;
  userId: string | null;
  slug: string | null;
  displayName: string;
  bio: string | null;
  photoUrl: string | null;
  isFeatured: boolean;
  isAvailable: boolean;
  basePrice: number;
  totalCalls: number;
  averageRating: number;
  /** Set by the backend when the performer is currently streaming via Restreamer. */
  isLive?: boolean;
  /** Direct HLS playback URL, populated when isLive is true. */
  hlsUrl?: string | null;
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
  walletAddress?: string | null;
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

export function getCreatorWallet(): Promise<{
  success: boolean;
  address: string | null;
  verified: boolean;
  payoutMethod: "crypto" | "meru";
  meruAccount: string | null;
}> {
  return request("/api/webapp/creator/wallet");
}

export function saveCreatorWallet(payload: {
  payoutMethod: "crypto" | "meru";
  address?: string;
  meruAccount?: string;
}): Promise<{
  success: boolean;
  payoutMethod?: string;
  error?: string;
}> {
  return request("/api/webapp/creator/wallet", { method: "POST", body: payload });
}

export function changeCreatorTier(
  tier: "ice" | "crystal" | "diamond"
): Promise<{
  success: boolean;
  tier: string;
  price: number;
  error?: string;
}> {
  return request("/api/webapp/creator/change-tier", { method: "POST", body: { tier } });
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

export interface ActiveCreator {
  id: string;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  photo_file_id: string | null;
  creator_type: string | null;
  creator_status: "active" | "suspended";
  creator_strikes: number;
  creator_subscriber_count: number;
  creator_price_usd: string | null;
}

export interface CreatorStrike {
  id: string;
  creator_id: string;
  strike_number: number;
  reason: string;
  issued_by: string;
  created_at: string;
}

export function listActiveCreators(): Promise<{
  success: boolean;
  creators: ActiveCreator[];
}> {
  return request("/api/webapp/creator/active");
}

export function issueCreatorStrike(
  creatorId: string,
  reason: string
): Promise<{ success: boolean; strikeCount: number; suspended: boolean }> {
  return request(`/api/webapp/creator/${creatorId}/strike`, {
    method: "POST",
    body: { reason },
  });
}

export function getCreatorStrikes(
  creatorId: string
): Promise<{ success: boolean; strikes: CreatorStrike[] }> {
  return request(`/api/webapp/creator/${creatorId}/strikes`);
}

// ── Creator Enrollments ───────────────────────────────────────────────────────

export interface CreatorEnrollment {
  id: number;
  tier: "ice" | "crystal" | "diamond";
  status: "pending_review" | "approved" | "rejected";
  payment_method: "meru" | "usdc" | "usdt" | null;
  payment_address: string | null;
  payment_network: string | null;
  submitted_at: string;
  reviewed_at: string | null;
  admin_notes: string | null;
}

export function getCreatorEnrollment(): Promise<{ success: boolean; enrollment: CreatorEnrollment | null }> {
  return request("/api/webapp/creator/enrollment");
}

export async function submitCreatorEnrollment(data: {
  tier: string;
  paymentMethod: string;
  paymentAddress: string;
  paymentNetwork: string;
  signatureData: string;
  idDocument: File;
}): Promise<{ success: boolean; submitted: boolean; tier: string; status: string }> {
  const formData = new FormData();
  formData.append("tier", data.tier);
  formData.append("paymentMethod", data.paymentMethod);
  formData.append("paymentAddress", data.paymentAddress);
  formData.append("paymentNetwork", data.paymentNetwork);
  formData.append("signatureData", data.signatureData);
  formData.append("idDocument", data.idDocument);

  const res = await fetch(`${API_BASE}/api/webapp/creator/enroll`, {
    method: "POST",
    credentials: "include",
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `API error ${res.status}`);
  }
  return res.json();
}

export interface EnrollmentListItem extends CreatorEnrollment {
  user_id: string;
  id_document_path: string | null;
  username: string | null;
  first_name: string | null;
  photo_file_id: string | null;
}

export function listCreatorEnrollments(
  status?: string
): Promise<{ success: boolean; enrollments: EnrollmentListItem[] }> {
  const qs = status ? `?status=${encodeURIComponent(status)}` : "";
  return request(`/api/webapp/creator/enrollments${qs}`);
}

export function approveCreatorEnrollment(
  id: number,
  notes?: string
): Promise<{ success: boolean }> {
  return request(`/api/webapp/creator/enrollments/${id}/approve`, {
    method: "POST",
    body: { notes: notes || null },
  });
}

export function rejectCreatorEnrollment(
  id: number,
  notes?: string
): Promise<{ success: boolean }> {
  return request(`/api/webapp/creator/enrollments/${id}/reject`, {
    method: "POST",
    body: { notes: notes || null },
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

// ---------------------------------------------------------------------------
// Canva Connect API
// ---------------------------------------------------------------------------

export interface CanvaDesign {
  id: string;
  title: string;
  thumbnail?: { url: string; width: number; height: number };
  created_at: string;
  updated_at: string;
  urls?: { edit_url?: string; view_url?: string };
}

export interface CanvaExportJob {
  id: string;
  canva_design_id: string;
  design_title: string;
  export_format: string;
  export_quality: string;
  status: "pending" | "exporting" | "downloading" | "uploading" | "completed" | "failed";
  directus_file_id?: string;
  directus_content_id?: string;
  error_message?: string;
  created_at: string;
  updated_at: string;
}

export function getCanvaLoginUrl(): string {
  const base = import.meta.env.VITE_API_URL || "https://pnptv.app";
  return `${base}/api/canva/auth/login?redirect=true`;
}

export function getCanvaStatus(): Promise<{ success: boolean; connected: boolean; displayName?: string }> {
  return request("/api/canva/status");
}

export function unlinkCanva(): Promise<{ success: boolean; message: string }> {
  return request("/api/canva/auth/unlink", { method: "POST" });
}

export function listCanvaDesigns(): Promise<{ success: boolean; designs: CanvaDesign[] }> {
  return request("/api/canva/designs");
}

export function startCanvaExport(
  designId: string,
  title: string,
  quality?: string
): Promise<{ success: boolean; jobId: string; status: string }> {
  return request("/api/canva/export", {
    method: "POST",
    body: { designId, title, quality: quality || "1080p" },
  });
}

export function listCanvaExports(): Promise<{ success: boolean; jobs: CanvaExportJob[] }> {
  return request("/api/canva/exports");
}

export function getCanvaExportStatus(
  jobId: string
): Promise<{ success: boolean; job: CanvaExportJob }> {
  return request(`/api/canva/exports/${jobId}`);
}

// ---------------------------------------------------------------------------
// Admin Canva API
// ---------------------------------------------------------------------------

export interface AdminCanvaStats {
  connectedUsers: number;
  totalExports: number;
  completedExports: number;
  failedExports: number;
  activeJobs: number;
  successRate: number;
}

export interface AdminCanvaUser {
  id: string;
  username: string;
  display_name: string;
  canva_user_id: string;
  canva_display_name: string;
  canva_connected_at: string;
  export_count: number;
}

export interface AdminCanvaJob {
  id: string;
  user_id: string;
  canva_design_id: string;
  design_title: string;
  export_format: string;
  export_quality: string;
  status: string;
  directus_file_id?: string;
  directus_content_id?: string;
  error_message?: string;
  retry_count: number;
  export_url?: string;
  started_at?: string;
  completed_at?: string;
  created_at: string;
  updated_at: string;
  username?: string;
  user_display_name?: string;
}

export function getAdminCanvaStats(): Promise<{ success: boolean; stats: AdminCanvaStats }> {
  return request("/api/webapp/admin/canva/stats");
}

export function getAdminCanvaUsers(): Promise<{ success: boolean; users: AdminCanvaUser[] }> {
  return request("/api/webapp/admin/canva/users");
}

export function adminUnlinkCanvaUser(userId: string): Promise<{ success: boolean; message: string }> {
  return request(`/api/webapp/admin/canva/users/${userId}/unlink`, { method: "POST" });
}

export function getAdminCanvaJobs(
  page = 1,
  status?: string
): Promise<{ success: boolean; jobs: AdminCanvaJob[]; pagination: { page: number; limit: number; total: number; totalPages: number } }> {
  const params = new URLSearchParams({ page: String(page) });
  if (status) params.set("status", status);
  return request(`/api/webapp/admin/canva/jobs?${params}`);
}

export function adminRetryCanvaJob(jobId: string): Promise<{ success: boolean; message: string }> {
  return request(`/api/webapp/admin/canva/jobs/${jobId}/retry`, { method: "POST" });
}

export function adminCancelCanvaJob(jobId: string): Promise<{ success: boolean; message: string }> {
  return request(`/api/webapp/admin/canva/jobs/${jobId}/cancel`, { method: "POST" });
}

// ---------------------------------------------------------------------------
// Admin X Auto Campaigns API
// ---------------------------------------------------------------------------

export interface XAutoCampaignStats {
  totalCampaigns: number;
  activeCampaigns: number;
  pausedCampaigns: number;
  completedCampaigns: number;
  totalGenerated: number;
  totalPosted: number;
  totalFailed: number;
  mediaFolderId?: string;
}

export interface XAutoCampaign {
  campaign_id: string;
  name: string;
  account_id: string;
  handle?: string;
  account_display_name?: string;
  topic: string;
  grok_mode: string;
  language: string;
  custom_prompt?: string;
  interval_minutes: number;
  active_hours_start: number;
  active_hours_end: number;
  status: string;
  last_generated_at?: string;
  next_run_at?: string;
  total_generated: number;
  total_posted: number;
  total_failed: number;
  max_posts?: number;
  created_by_username?: string;
  media_folder_id?: string;
  created_at: string;
  updated_at: string;
}

export interface XAutoCampaignPost {
  post_id: string;
  text: string;
  status: string;
  scheduled_at?: string;
  sent_at?: string;
  error_message?: string;
  created_at: string;
  handle?: string;
}

export interface XActiveAccount {
  account_id: string;
  handle: string;
  display_name?: string;
}

export function getAdminXCampaignStats(): Promise<{ success: boolean; stats: XAutoCampaignStats; accounts: XActiveAccount[]; mediaFolderId?: string }> {
  return request("/api/webapp/admin/x-campaigns/stats");
}

export function getAdminXCampaigns(
  page = 1,
  status?: string
): Promise<{ success: boolean; campaigns: XAutoCampaign[]; pagination: { page: number; limit: number; total: number; totalPages: number } }> {
  const params = new URLSearchParams({ page: String(page) });
  if (status) params.set("status", status);
  return request(`/api/webapp/admin/x-campaigns?${params}`);
}

export function createAdminXCampaign(data: {
  name: string;
  accountId: string;
  topic: string;
  grokMode?: string;
  language?: string;
  customPrompt?: string;
  intervalMinutes?: number;
  activeHoursStart?: number;
  activeHoursEnd?: number;
  maxPosts?: number;
  mediaFolderId?: string;
}): Promise<{ success: boolean; campaignId: string }> {
  return request("/api/webapp/admin/x-campaigns", { method: "POST", body: data });
}

export function updateAdminXCampaign(
  id: string,
  data: Record<string, unknown>
): Promise<{ success: boolean }> {
  return request(`/api/webapp/admin/x-campaigns/${id}`, { method: "PUT", body: data });
}

export function pauseAdminXCampaign(id: string): Promise<{ success: boolean }> {
  return request(`/api/webapp/admin/x-campaigns/${id}/pause`, { method: "POST" });
}

export function resumeAdminXCampaign(id: string): Promise<{ success: boolean }> {
  return request(`/api/webapp/admin/x-campaigns/${id}/resume`, { method: "POST" });
}

export function deleteAdminXCampaign(id: string): Promise<{ success: boolean }> {
  return request(`/api/webapp/admin/x-campaigns/${id}`, { method: "DELETE" });
}

export function getAdminXCampaignHistory(
  id: string,
  page = 1
): Promise<{ success: boolean; posts: XAutoCampaignPost[]; pagination: { page: number; limit: number; total: number; totalPages: number } }> {
  return request(`/api/webapp/admin/x-campaigns/${id}/history?page=${page}`);
}

export function triggerAdminXCampaignGenerate(id: string): Promise<{ success: boolean; postId: string }> {
  return request(`/api/webapp/admin/x-campaigns/${id}/generate`, { method: "POST" });
}

export function getAdminXCampaignMediaFolder(): Promise<{ success: boolean; folderId: string; cmsUrl: string }> {
  return request("/api/webapp/admin/x-campaigns/media-folder");
}

export function getRandomCampaignVideo(campaignId?: string): Promise<{ success: boolean; mediaUrl: string }> {
  const qs = campaignId ? `?campaignId=${campaignId}` : "";
  return request(`/api/webapp/admin/x-campaigns/random-video${qs}`);
}

export function startXOAuth(adminId?: number, adminUsername?: string): Promise<{ success: boolean; url: string }> {
  const params = new URLSearchParams();
  if (adminId) params.set("admin_id", String(adminId));
  if (adminUsername) params.set("admin_username", adminUsername);
  const qs = params.toString();
  return request(`/api/admin/x/oauth/login${qs ? `?${qs}` : ""}`);
}

// ============================================================================
// Admin API
// ============================================================================

export interface AdminStats {
  totalUsers: number;
  activeSubscribers: number;
  monthlyRevenue: number;
  totalRevenue: number;
  churnedUsers: number;
  membershipBreakdown: Record<string, number>;
  topPaymentMethods: { method: string; transactions: number; revenue: number; successRate: number }[];
  recentTransactions: { date: string; userId: string; username: string; amount: number; status: string; method: string }[];
  dailyRevenue?: { date: string; amount: number }[];
}

export interface AdminUser {
  id: string;
  username: string;
  email: string;
  first_name?: string;
  last_name?: string;
  bio?: string;
  role: string;
  tier: string;
  subscription_status: string;
  subscription_plan?: string;
  plan_expiry?: string;
  created_at: string;
  last_payment_date?: string;
  phone_number?: string;
}

export interface AdminPlan {
  id: string;
  sku?: string;
  name: string;
  display_name: string;
  nameEs?: string;
  tier: string;
  price: number;
  currency: string;
  duration: number;
  features: string[];
  featuresEs?: string[];
  active: boolean;
  isLifetime?: boolean;
  isPromo?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface AdminPost {
  id: number;
  authorId: string;
  authorUsername: string;
  authorFirstName: string;
  authorPhotoUrl: string | null;
  content: string;
  mediaUrl: string | null;
  mediaType: string | null;
  likesCount: number;
  repliesCount: number;
  createdAt: string;
}

export interface AdminHangout {
  id: string;
  title: string;
  creatorId: string;
  creatorName: string;
  currentParticipants: number;
  maxParticipants: number;
  isPublic: boolean;
  createdAt: string;
}

export interface PaginatedResponse<T> {
  success: boolean;
  pagination: { page: number; limit: number; total: number; totalPages: number };
  [key: string]: unknown;
}

// Admin Stats
export function getAdminStats(): Promise<{ success: boolean; stats: AdminStats }> {
  return request("/api/webapp/admin/stats");
}

// Admin Demographics
export interface AdminDemographics {
  tiers: { label: string; count: number }[];
  languages: { label: string; count: number }[];
  locations: { label: string; count: number }[];
  signupTrend: { day: string; count: number }[];
  subscriptionTypes: { label: string; count: number }[];
  activity: {
    total: number; active1d: number; active7d: number; active30d: number; active90d: number;
    new7d: number; new30d: number; ageVerified: number; termsAccepted: number; withBio: number; withPhoto: number;
    withLocation: number; avgXp: number;
  };
  xpBuckets: { label: string; count: number }[];
  retention: { cohortSize: number; retained: number; rate: number | null };
  features: {
    posts: number; postLikes: number; dms: number; chatMessages: number; hangouts: number;
    hangoutMembers: number; streams: number; notificationsSent: number; follows: number;
    mediaPlays: number; mediaFavorites: number; tips: number; pushSubscribers: number;
    xLinked: number; blueskyLinked: number;
  };
  insights: { type: string; title: string; body: string }[];
}
export function getAdminDemographics(): Promise<{ success: boolean; demographics: AdminDemographics }> {
  return request("/api/webapp/admin/demographics");
}

// Admin Users
export function getAdminUsers(
  page = 1,
  search = ""
): Promise<{ success: boolean; users: AdminUser[]; pagination: { page: number; limit: number; total: number; totalPages: number } }> {
  const params = new URLSearchParams({ page: String(page) });
  if (search) params.set("search", search);
  return request(`/api/webapp/admin/users?${params}`);
}

export function getAdminUser(id: string): Promise<{ success: boolean; user: AdminUser }> {
  return request(`/api/webapp/admin/users/${id}`);
}

export function updateAdminUser(
  id: string,
  fields: { username?: string; email?: string; subscriptionStatus?: string; subscriptionPlan?: string; tier?: string; planExpiry?: string }
): Promise<{ success: boolean; user: AdminUser }> {
  return request(`/api/webapp/admin/users/${id}`, { method: "PUT", body: fields });
}

export function banAdminUser(
  id: string,
  ban: boolean,
  reason?: string
): Promise<{ success: boolean; user: AdminUser; action: string }> {
  return request(`/api/webapp/admin/users/${id}/ban`, { method: "POST", body: { ban, reason } });
}

export function bulkUpdateMemberships(
  userIds: string[],
  action: "upgrade" | "downgrade" | "ban" | "unban",
  planId?: string,
  expiry?: string
): Promise<{ success: boolean; updated: number; failed: number; errors: string[] }> {
  return request("/api/webapp/admin/users/bulk-update", {
    method: "POST",
    body: { userIds, action, planId, expiry },
  });
}

// Admin Posts
export function getAdminPosts(
  page = 1
): Promise<{ success: boolean; posts: AdminPost[]; pagination: { page: number; limit: number; total: number; totalPages: number } }> {
  return request(`/api/webapp/admin/posts?page=${page}`);
}

export function deleteAdminPost(id: number): Promise<{ success: boolean; message: string }> {
  return request(`/api/webapp/admin/posts/${id}`, { method: "DELETE" });
}

// Admin Hangouts
export function getAdminHangouts(): Promise<{ success: boolean; hangouts: AdminHangout[] }> {
  return request("/api/webapp/admin/hangouts");
}

export function endAdminHangout(id: string): Promise<{ success: boolean; message: string }> {
  return request(`/api/webapp/admin/hangouts/${id}`, { method: "DELETE" });
}

// Admin Plans
export function getAdminPlans(): Promise<{ success: boolean; plans: AdminPlan[] }> {
  return request("/api/webapp/admin/plans");
}

export function createAdminPlan(
  plan: Partial<AdminPlan> & { id: string }
): Promise<{ success: boolean; plan: AdminPlan }> {
  return request("/api/webapp/admin/plans", { method: "POST", body: plan });
}

export function updateAdminPlan(
  id: string,
  plan: Partial<AdminPlan>
): Promise<{ success: boolean; plan: AdminPlan }> {
  return request(`/api/webapp/admin/plans/${id}`, { method: "PUT", body: plan });
}

export function deleteAdminPlan(id: string): Promise<{ success: boolean; message: string }> {
  return request(`/api/webapp/admin/plans/${id}`, { method: "DELETE" });
}

// Admin Nearby Places
export interface AdminPlace {
  id: string;
  name: string;
  description?: string;
  address?: string;
  city?: string;
  country?: string;
  categoryId?: number;
  categoryName?: string;
  categoryNameEs?: string;
  categoryEmoji?: string;
  categorySlug?: string;
  placeType?: string;
  status: string;
  viewCount?: number;
  favoriteCount?: number;
  reportCount?: number;
  createdAt?: string;
}

export function getAdminPlaces(
  page = 1,
  status?: string,
  categoryId?: number,
  search?: string
): Promise<{ success: boolean; places: AdminPlace[]; pagination: { page: number; limit: number; total: number; totalPages: number } }> {
  const params = new URLSearchParams({ page: String(page) });
  if (status) params.set("status", status);
  if (categoryId) params.set("categoryId", String(categoryId));
  if (search) params.set("search", search);
  return request(`/api/webapp/admin/places?${params}`);
}

export function getAdminPlaceStats(): Promise<{ success: boolean; stats: Record<string, number> }> {
  return request("/api/webapp/admin/places/stats");
}

export function approveAdminPlace(id: string): Promise<{ success: boolean }> {
  return request(`/api/webapp/admin/places/${id}/approve`, { method: "POST" });
}

export function rejectAdminPlace(id: string, reason?: string): Promise<{ success: boolean }> {
  return request(`/api/webapp/admin/places/${id}/reject`, { method: "POST", body: { reason } });
}

export function suspendAdminPlace(id: string, suspend: boolean): Promise<{ success: boolean }> {
  return request(`/api/webapp/admin/places/${id}/suspend`, { method: "POST", body: { suspend } });
}

export function deleteAdminPlace(id: string): Promise<{ success: boolean; message: string }> {
  return request(`/api/webapp/admin/places/${id}`, { method: "DELETE" });
}

// Admin Push Notifications
export function sendAdminNotification(payload: {
  title: string;
  body: string;
  url?: string;
  targetType: "all" | "tier" | "users";
  tier?: string;
  userIds?: string[];
}): Promise<{ success: boolean; sent: number; message: string }> {
  return request("/api/webapp/admin/notifications/push", { method: "POST", body: payload });
}

// Push Subscription
export function subscribePush(subscription: {
  endpoint: string;
  keys: { auth: string; p256dh: string };
}): Promise<{ success: boolean }> {
  return request("/api/webapp/push/subscribe", { method: "POST", body: subscription });
}

export function unsubscribePush(endpoint: string): Promise<{ success: boolean }> {
  return request("/api/webapp/push/unsubscribe", { method: "DELETE", body: { endpoint } });
}

export function getVapidKey(): Promise<{ success: boolean; publicKey: string }> {
  return request("/api/webapp/push/vapid-key");
}

// ─── Creator CMS ──────────────────────────────────────────────────────────────

export interface CmsPerformer {
  id: number;
  status: "published" | "draft" | "archived";
  name: string;
  slug: string;
  bio: string | null;
  bio_short: string | null;
  categories: string[];
  social_links: Record<string, string> | null;
  is_available: boolean;
  availability_message: string | null;
  base_price_cents: number | null;
  currency: string | null;
  timezone: string | null;
  durations_minutes: string[];
  pnptv_id: string;
}

export interface CmsContent {
  id: number;
  status: "published" | "draft" | "archived";
  title: string;
  description: string | null;
  type: "video" | "audio" | "podcast";
  media_url: string | null;
  thumbnail: string | null;
  duration_seconds: number | null;
  is_premium: boolean;
  tags: string[];
  series: string | null;
  episode_number: number | null;
  date_created: string;
  date_updated: string;
}

export interface CmsShow {
  id: number;
  status: "published" | "draft";
  title: string;
  description: string | null;
  scheduled_at: string;
  duration_minutes: number | null;
  category: string | null;
  is_premium: boolean;
  date_created: string;
  date_updated: string;
}

export function getCmsProfile(): Promise<{ success: boolean; performer: CmsPerformer }> {
  return request("/api/webapp/creator/cms/profile");
}

export function updateCmsProfile(data: Partial<CmsPerformer>): Promise<{ success: boolean; performer: CmsPerformer }> {
  return request("/api/webapp/creator/cms/profile", { method: "PUT", body: data });
}

export function listCmsContent(params?: { page?: number; limit?: number; type?: string }): Promise<{ success: boolean; content: CmsContent[]; meta: Record<string, unknown> }> {
  const qs = new URLSearchParams();
  if (params?.page) qs.set("page", String(params.page));
  if (params?.limit) qs.set("limit", String(params.limit));
  if (params?.type) qs.set("type", params.type);
  return request(`/api/webapp/creator/cms/content${qs.toString() ? "?" + qs : ""}`);
}

export function createCmsContent(data: Partial<CmsContent>): Promise<{ success: boolean; content: CmsContent }> {
  return request("/api/webapp/creator/cms/content", { method: "POST", body: data });
}

export function updateCmsContent(id: number, data: Partial<CmsContent>): Promise<{ success: boolean; content: CmsContent }> {
  return request(`/api/webapp/creator/cms/content/${id}`, { method: "PATCH", body: data });
}

export function deleteCmsContent(id: number): Promise<{ success: boolean }> {
  return request(`/api/webapp/creator/cms/content/${id}`, { method: "DELETE" });
}

export function listCmsShows(upcoming?: boolean): Promise<{ success: boolean; shows: CmsShow[] }> {
  return request(`/api/webapp/creator/cms/shows${upcoming ? "?upcoming=1" : ""}`);
}

export function createCmsShow(data: Partial<CmsShow>): Promise<{ success: boolean; show: CmsShow }> {
  return request("/api/webapp/creator/cms/shows", { method: "POST", body: data });
}

export function updateCmsShow(id: number, data: Partial<CmsShow>): Promise<{ success: boolean; show: CmsShow }> {
  return request(`/api/webapp/creator/cms/shows/${id}`, { method: "PATCH", body: data });
}

export function deleteCmsShow(id: number): Promise<{ success: boolean }> {
  return request(`/api/webapp/creator/cms/shows/${id}`, { method: "DELETE" });
}

export async function uploadCmsMedia(file: File, folder?: string): Promise<{ success: boolean; fileId: string; url: string }> {
  const form = new FormData();
  form.append("file", file);
  if (folder) form.append("folder", folder);
  const res = await fetch("/api/webapp/creator/cms/upload", {
    method: "POST",
    body: form,
    credentials: "include",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || "Upload failed");
  }
  return res.json();
}


// Grok Social Media Manager
export interface GrokManagerMessage {
  role: "user" | "assistant";
  content: string;
}

export function chatWithGrokManager(message: string): Promise<{ success: boolean; message: string }> {
  return request("/api/webapp/admin/grok/manager-chat", { method: "POST", body: { message } });
}

export function resetGrokManagerChat(): Promise<{ success: boolean; reset: boolean }> {
  return request("/api/webapp/admin/grok/manager-chat", { method: "POST", body: { message: "_reset_", reset: true } });
}

// Mono — personal AI business assistant
export function chatWithMono(message: string): Promise<{ success: boolean; message: string }> {
  return request("/api/webapp/admin/mono/chat", { method: "POST", body: { message } });
}

export function resetMonoChat(): Promise<{ success: boolean }> {
  return request("/api/webapp/admin/mono/chat", { method: "POST", body: { message: "_reset_", reset: true } });
}

// Admin: campaigns
export function triggerCristinaNeighborDM(): Promise<{ success: boolean; message: string }> {
  return request("/api/webapp/admin/cristina/neighbor-dm", { method: "POST" });
}

export function triggerRevokeUnusedTrials(dryRun = false): Promise<{ success: boolean; message: string }> {
  return request(`/api/webapp/admin/trials/revoke-unused${dryRun ? "?dry_run=1" : ""}`, { method: "POST" });
}

// Gamification API

export interface GamificationBadge {
  id: number;
  slug: string;
  name_en: string;
  name_es: string;
  description_en?: string | null;
  description_es?: string | null;
  icon: string;
  level: number;
}

export interface GamificationCategory {
  id: number;
  slug: string;
  name_en: string;
  name_es: string;
  icon: string;
  badges: GamificationBadge[];
}

export interface GamificationHolder {
  id: string;
  first_name: string | null;
  username: string | null;
  awarded_at: string;
}

export interface UserBadgeEntry {
  badge_slug: string;
  badge_name_en: string;
  badge_name_es: string;
  badge_icon: string;
  badge_level: number;
  awarded_at: string;
  note: string | null;
}

export function getGamificationCategories(): Promise<{ success: boolean; categories: GamificationCategory[] }> {
  return request("/api/webapp/gamification/categories");
}

export function getGamificationBadges(category?: string): Promise<{ success: boolean; badges: GamificationBadge[] }> {
  const qs = category ? `?category=${encodeURIComponent(category)}` : "";
  return request(`/api/webapp/gamification/badges${qs}`);
}

export function getUserGamificationBadges(userId: string | number): Promise<{ success: boolean; badges: UserBadgeEntry[] }> {
  return request(`/api/webapp/gamification/user/${userId}/badges`);
}

export function getGamificationBadgeHolders(badgeSlug: string): Promise<{ success: boolean; holders: GamificationHolder[] }> {
  return request(`/api/webapp/gamification/badge/${encodeURIComponent(badgeSlug)}/holders`);
}

export function awardGamificationBadge(
  userId: string | number,
  badgeSlug: string,
  note?: string,
): Promise<{ success: boolean; awarded: boolean; badge: GamificationBadge }> {
  return request("/api/webapp/gamification/award", {
    method: "POST",
    body: { userId, badgeSlug, note },
  });
}

export function revokeGamificationBadge(
  userId: string | number,
  badgeSlug: string,
): Promise<{ success: boolean; revoked: boolean }> {
  return request("/api/webapp/gamification/revoke", {
    method: "POST",
    body: { userId, badgeSlug },
  });
}

export function awardMeCuidoToAllCreators(): Promise<{ success: boolean; awarded: number; total: number }> {
  return request("/api/webapp/gamification/award-creators-mecuido", { method: "POST" });
}

// ============================================================================
// Stream Overlay Admin API
// ============================================================================

export interface StreamOverlay {
  id: string;
  channel_ref: string;
  logo_url: string | null;
  logo_position: string;
  logo_size: number;
  logo_opacity: number;
  banner_text: string | null;
  banner_position: string;
  banner_bg_color: string;
  banner_text_color: string;
  banner_style: string;
  banner_image_url: string | null;
  is_active: boolean;
  updated_by: string | null;
  updated_at: string;
}

export function getStreamOverlays(): Promise<{ success: boolean; overlays: StreamOverlay[] }> {
  return request("/api/webapp/admin/stream-overlays");
}

export function getStreamOverlay(channelRef: string): Promise<{ success: boolean; overlay: StreamOverlay }> {
  return request(`/api/webapp/admin/stream-overlays/${encodeURIComponent(channelRef)}`);
}

export function updateStreamOverlay(
  channelRef: string,
  data: Partial<StreamOverlay>
): Promise<{ success: boolean; overlay: StreamOverlay }> {
  return request(`/api/webapp/admin/stream-overlays/${encodeURIComponent(channelRef)}`, {
    method: "PUT",
    body: data,
  });
}

export function getStreamOverlayPublic(
  channelRef: string
): Promise<{ success: boolean; overlay: StreamOverlay | null }> {
  return request(`/api/proxy/live/overlay/${encodeURIComponent(channelRef)}`);
}

// ============================================================================
// Overlay Asset Library (CMS-managed logos & banners)
// ============================================================================

export interface OverlayAsset {
  id: string;
  type: "logo" | "banner";
  name: string;
  category: string | null;
  sort_order: number;
  image_url: string | null;
  image_filename: string | null;
  image_mime: string | null;
}

export function getOverlayLibrary(type?: "logo" | "banner"): Promise<{ success: boolean; assets: OverlayAsset[] }> {
  const params = type ? `?type=${type}` : "";
  return request(`/api/webapp/admin/overlay-library${params}`);
}

// ============================================================================
// Support Dashboard Admin API
// ============================================================================

export interface SupportStats {
  openTickets: number;
  awaitingFirstResponse: number;
  avgResponseTimeHours: number;
  csatScore: number;
  totalRatings: number;
  slaBreaches: number;
}

export interface SupportTicket {
  userId: number;
  username: string | null;
  firstName: string | null;
  tier: string;
  plan: string | null;
  language: string | null;
  status: string;
  priority: string;
  category: string;
  lastMessage: string | null;
  lastMessageAt: string;
  unreadCount: number;
  createdAt: string;
}

export interface SupportMessage {
  id: number;
  content: string;
  senderRole: "user" | "agent" | "admin";
  senderName: string | null;
  createdAt: string;
}

export function getAdminSupportStats(): Promise<{ success: boolean; stats: SupportStats }> {
  return request("/api/webapp/admin/support/stats");
}

export function getAdminSupportTickets(
  params: Record<string, string>
): Promise<{ success: boolean; tickets: SupportTicket[]; hasMore: boolean; total: number }> {
  const qs = new URLSearchParams(params).toString();
  return request(`/api/webapp/admin/support/tickets?${qs}`);
}

export function getAdminTicketMessages(
  userId: string
): Promise<{ success: boolean; messages: SupportMessage[] }> {
  return request(`/api/webapp/admin/support/tickets/${userId}/messages`);
}

export function sendAdminTicketReply(
  userId: string,
  content: string
): Promise<{ success: boolean; message: SupportMessage }> {
  return request(`/api/webapp/admin/support/tickets/${userId}/reply`, {
    method: "POST",
    body: { content },
  });
}

export function updateAdminTicket(
  userId: string,
  data: Record<string, string>
): Promise<{ success: boolean; ticket: SupportTicket }> {
  return request(`/api/webapp/admin/support/tickets/${userId}`, {
    method: "PATCH",
    body: data,
  });
}

// ============================================================================
// Community Room (Haus) API — 24/7 open video room powered by JaaS
// ============================================================================

export interface CommunityRoomInfo {
  token: string;
  domain: string;
  roomName: string;
  roomId: string;
  isModerator: boolean;
  isTrueModerator: boolean;
  isOpen24_7: boolean;
  room: {
    id: string;
    code: string;
    name: string;
    maxParticipants: number;
    isPersistent: boolean;
    isOpen24_7: boolean;
    description: string;
  };
}

export interface RoomOccupancy {
  activeUsers: number;
  users: Array<{
    userId: string;
    displayName: string;
    role: string;
    joinedAt: string;
  }>;
  roomId: string;
  maxCapacity: number;
}

export function joinCommunityRoom(
  displayName: string
): Promise<CommunityRoomInfo> {
  return request("/api/community-room/join", {
    method: "POST",
    body: { displayName },
  });
}

export function getCommunityRoomOccupancy(): Promise<{
  success: boolean;
  occupancy: RoomOccupancy;
}> {
  return request("/api/community-room/occupancy");
}

export function getCommunityRoomStats(): Promise<{
  success: boolean;
  stats: {
    roomId: string;
    totalActiveUsers: number;
    messageCount: number;
  };
}> {
  return request("/api/community-room/stats");
}
