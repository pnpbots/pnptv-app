const API_BASE = import.meta.env.VITE_API_URL || (window.location.hostname === "pnptv.app" ? "https://pnptv.app" : "https://pnptv.app");

export const NP_COINS = [
  { code: "btc",        label: "BTC",        icon: "₿", color: "#f7931a" },
  { code: "usdttrc20",  label: "USDT-TRX",   icon: "₮", color: "#26a17b" },
  { code: "usdcsol",    label: "USDC-SOL",   icon: "$", color: "#2775ca" },
  { code: "dash",       label: "DASH",       icon: "Ð", color: "#008de4" },
  { code: "eth",        label: "ETH",        icon: "Ξ", color: "#627eea" },
  { code: "usdtbsc",    label: "USDT-BSC",   icon: "₮", color: "#26a17b" },
  { code: "usdcbsc",    label: "USDC-BSC",   icon: "$", color: "#2775ca" },
  { code: "ltc",        label: "LTC",        icon: "Ł", color: "#bfbbbb" },
  { code: "sol",        label: "SOL",        icon: "◎", color: "#9945ff" },
  { code: "bch",        label: "BCH",        icon: "Ƀ", color: "#8dc351" },
  { code: "xmr",        label: "XMR",        icon: "ɱ", color: "#ff6600" },
  { code: "doge",       label: "DOGE",       icon: "Ð", color: "#c2a633" },
] as const;
export type NpCoinCode = (typeof NP_COINS)[number]["code"];

// Creators whose pay buttons are live before the June 1 launch gate lifts
const LAUNCH_UNLOCKED = new Set(['SantinoFurioso', 'PNPLatinoBoy'].map(u => u.toLowerCase()));
export const LAUNCH_DATE = new Date('2026-06-01T00:00:00-05:00');
export function isCreatorPayLocked(username?: string | null): boolean {
  if (new Date() >= LAUNCH_DATE) return false;
  return !LAUNCH_UNLOCKED.has((username ?? '').toLowerCase());
}

function friendlyHttpError(status: number, fallback: string): string {
  if (status === 413) return "File is too large. Max 512 MB (or 3 GB for creators).";
  if (status === 401) return "Please log in again to continue.";
  if (status === 403) return "You don't have permission to do this.";
  if (status === 429) return "Too many requests. Please wait a moment and try again.";
  return fallback;
}

interface ApiOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

/** API error that preserves a machine-readable code from the backend response body. */
/** Structured details returned by the scoped-access middleware on 403. */
export interface ApiAccessDetails {
  scoped?: boolean;
  kind?: "channel" | "hangout" | "creator";
  resourceId?: string;
  accessType?: string;
  creatorId?: string;
  priceUsd?: number;
  upgradeUrl?: string;
  /** Seconds remaining in a rate-limit cooldown (e.g. FREE_USER_COOLDOWN) */
  cooldownSeconds?: number;
}

export class ApiError extends Error {
  public readonly code: string | undefined;
  public readonly status: number;
  public readonly details: ApiAccessDetails;
  constructor(message: string, status: number, code?: string, details: ApiAccessDetails = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** Network-level error (server unreachable, DNS failure, etc.) — distinct from HTTP errors. */
export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NetworkError";
  }
}

function looksLikeMachineCode(value: string): boolean {
  return /^[A-Z0-9_]+$/.test(value);
}

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

function isNetworkError(err: unknown): boolean {
  return err instanceof TypeError || (err instanceof Error && err.name === "NetworkError");
}

async function request<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const { method = "GET", body, headers = {} } = options;
  const fetchOpts: RequestInit = {
    method,
    credentials: "include",
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    ...(body ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
  };

  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(`${API_BASE}${path}`, fetchOpts);

      if (!res.ok) {
        const error = await res.json().catch(() => ({ error: res.statusText }));
        const stringError = typeof error.error === "string" ? error.error : undefined;
        const nestedErrorMessage =
          typeof (error.error as { message?: string })?.message === "string"
            ? (error.error as { message: string }).message
            : undefined;
        const stringMessage = typeof error.message === "string" ? error.message : undefined;
        const errorMessage =
          stringMessage
            || nestedErrorMessage
            || (stringError && !looksLikeMachineCode(stringError) ? stringError : undefined)
            || friendlyHttpError(res.status, `API error ${res.status}`);
        const errorCode =
          typeof error.code === "string"
            ? error.code
            : (stringError && looksLikeMachineCode(stringError) ? stringError : undefined);
        // Colombia gate: redirect to /subscribe so the user can purchase PNP Col.
        // Skip when already on /subscribe to avoid a redirect loop.
        if (
          errorCode === "PNP_COL_REQUIRED" &&
          typeof window !== "undefined" &&
          !window.location.pathname.startsWith("/subscribe")
        ) {
          window.location.replace("/subscribe?plan=pnp_col");
        }
        // Extract structured access details for scoped-resource 403 responses so
        // callers can render the right in-context purchase modal instead of
        // bouncing to /subscribe.
        const details: ApiAccessDetails = {
          scoped: error.scoped === true ? true : undefined,
          kind: typeof error.kind === "string" ? error.kind : undefined,
          resourceId: typeof error.resourceId === "string" ? error.resourceId : undefined,
          accessType: typeof error.accessType === "string" ? error.accessType : undefined,
          creatorId: typeof error.creatorId === "string" ? error.creatorId : undefined,
          priceUsd: typeof error.priceUsd === "number" ? error.priceUsd : undefined,
          upgradeUrl: typeof error.upgradeUrl === "string" ? error.upgradeUrl : undefined,
          cooldownSeconds: typeof error.cooldownSeconds === "number" ? error.cooldownSeconds : undefined,
        };
        throw new ApiError(errorMessage, res.status, errorCode, details);
      }

      return res.json();
    } catch (err) {
      lastError = err;
      // Only retry on network errors (server unreachable), not HTTP errors (4xx/5xx)
      if (!isNetworkError(err) || attempt === MAX_RETRIES) throw err;
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    }
  }

  throw lastError;
}

// Auth endpoints

export interface TelegramAuthResponse {
  success: boolean;
  user?: {
    id?: string;
    pnptv_id?: string;
    telegram_id: number;
    username: string;
    first_name: string;
    display_name: string;
    language: string;
    terms_accepted: boolean;
    age_verified: boolean;
    subscription_type: string;
    tier: string;
    label?: 'PRIME' | 'BASIC' | 'FREE';
    role: string;
    photo_url?: string | null;
    creator_status?: string;
    creator_type?: string | null;
    /** Capability flag: 'creator' | 'performer' | 'both'. NULL until creator_status is approved. */
    creator_role?: "creator" | "performer" | "both" | null;
    /** True when an approved creator is temporarily blocked from using tools pending onboarding. */
    creator_locked?: boolean;
    contentDisclaimer?: boolean;
    hasSeenTutorial?: boolean;
    last_login_method?: string | null;
    city?: string | null;
    country?: string | null;
    email?: string | null;
    onboarding_complete?: boolean;
  };
  requiresTerms?: boolean;
  error?: string;
}

export interface AuthMethods {
  telegram: boolean;
}

export interface AuthStatusResponse {
  authenticated: boolean;
  user?: TelegramAuthResponse["user"] & {
    auth_methods?: AuthMethods;
    creator_status?: string;
    creator_type?: string | null;
    creator_role?: "creator" | "performer" | "both" | null;
  };
}

export function telegramAuth(initData: string): Promise<TelegramAuthResponse> {
  return request("/api/telegram-auth", {
    method: "POST",
    body: { initData },
  });
}

export interface TelegramWidgetUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

export interface TelegramWidgetAuthResponse {
  success: boolean;
  isNew?: boolean;
  user?: {
    id: string;
    pnptvId: string;
    username: string | null;
    firstName: string;
    lastName: string | null;
    photoUrl: string | null;
    subscriptionStatus: string;
    tier: string;
    label?: 'PRIME' | 'BASIC' | 'FREE';
    role: string;
    termsAccepted: boolean;
  };
  error?: string;
}

export function telegramWidgetAuth(
  data: TelegramWidgetUser,
): Promise<TelegramWidgetAuthResponse> {
  return request("/api/webapp/auth/telegram/widget", {
    method: "POST",
    body: data,
  });
}

export interface TelegramLinkResponse {
  success: boolean;
  telegram?: string;
  username?: string | null;
  adoptedUsername?: boolean;
  error?: string;
}

export function linkTelegramAccount(
  data: TelegramWidgetUser,
): Promise<TelegramLinkResponse> {
  return request("/api/webapp/profile/telegram/link", {
    method: "POST",
    body: data,
  });
}

export function unlinkTelegramAccount(): Promise<{ success: boolean; error?: string }> {
  return request("/api/webapp/profile/telegram/unlink", { method: "POST" });
}

export function checkAuthStatus(): Promise<AuthStatusResponse> {
  return request("/api/auth-status");
}

export function getGeoCountry(): Promise<{ country: string | null; isLatam: boolean }> {
  return request("/api/webapp/geo");
}

export function acceptTerms(): Promise<{ success: boolean }> {
  return request("/api/accept-terms", { method: "POST" });
}

export function apiLogout(): Promise<{ success: boolean }> {
  return request("/api/logout", { method: "POST" });
}

export function oidcLogout(): Promise<{ success: boolean }> {
  return request("/api/webapp/auth/oidc/logout", { method: "POST" });
}

// ── Onboarding ────────────────────────────────────────────────────────────────

export type OnboardingStepKey = "tiers" | "age" | "terms" | "privacy" | "rules" | "values" | "crypto";

export interface OnboardingStatus {
  complete: boolean;
  steps: Record<OnboardingStepKey, boolean>;
  currentStep: OnboardingStepKey;
}

export function getOnboardingStatus(): Promise<OnboardingStatus> {
  return request("/api/webapp/onboarding/status");
}

export function submitOnboardingStep(
  step: OnboardingStepKey,
  payload: Record<string, unknown> = {},
): Promise<{ ok: true } | { error: string }> {
  return request("/api/webapp/onboarding/step", {
    method: "POST",
    body: { step, payload },
  });
}

export function completeOnboarding(): Promise<{ complete: true } | { error: string }> {
  return request("/api/webapp/onboarding/complete", { method: "POST" });
}


export function recoverAccount(email: string): Promise<{ success: boolean; message: string }> {
  return request("/api/webapp/auth/recover-account", {
    method: "POST",
    body: { email },
  });
}

export function telegramGenerateLoginToken(): Promise<{ success: boolean; token: string; deepLink: string; error?: string }> {
  return request("/api/webapp/auth/telegram/token", { method: "POST" });
}

export function telegramCheckLoginToken(token: string): Promise<{ authenticated: boolean; user?: { id: string; username: string }; error?: string }> {
  return request(`/api/webapp/auth/telegram/check?token=${encodeURIComponent(token)}`);
}

export function magicLinkStart(email: string): Promise<{ success: boolean; error?: string }> {
  return request("/api/webapp/auth/magic/start", { method: "POST", body: { email } });
}

export interface PublicKeyCredentialRequestOptionsJSON {
  challenge: string;
  rpId?: string;
  allowCredentials?: Array<{ id: string; type: "public-key"; transports?: string[] }>;
  userVerification?: string;
  timeout?: number;
}

export interface PasskeyChallenge {
  success: boolean;
  stateToken?: string;
  publicKey?: PublicKeyCredentialRequestOptionsJSON;
  error?: string;
}

export function passkeyBegin(): Promise<PasskeyChallenge> {
  return request("/api/webapp/auth/passkey/begin");
}

export function passkeyFinish(payload: {
  stateToken: string;
  assertion: unknown;
}): Promise<{ authenticated: boolean; user?: { id: string; username?: string; pnptvId?: string }; error?: string }> {
  return request("/api/webapp/auth/passkey/finish", { method: "POST", body: payload });
}



// Age verification (self-declaration)
export function verifyAgeSelf(): Promise<{ success: boolean }> {
  return request("/api/verify-age-self", { method: "POST" });
}

// Media proxy
export interface MediaTrack {
  id: string;
  title: string;
  artist: { name: string } | string;
  album?: { name: string } | string;
  url: string;
  art?: string;
  time: number;
  provider?: "local" | "soundcloud";
  external_id?: string;
  soundcloud_url?: string;
  label?: string;
}

export function getMediaTracks(
  offset = 0,
  limit = 20,
  label?: string
): Promise<{ success: boolean; tracks: MediaTrack[] }> {
  const params = `offset=${offset}&limit=${limit}${label ? `&label=${encodeURIComponent(label)}` : ''}`;
  return request(`/api/proxy/media/tracks?${params}`);
}

export function resolveSoundCloud(url: string): Promise<{
  success: boolean;
  metadata: {
    title: string;
    artist: string;
    coverUrl: string;
    externalId: string;
    url: string;
  };
}> {
  return request("/api/proxy/media/resolve-soundcloud", {
    method: "POST",
    body: { url },
  });
}

export function importSoundCloud(metadata: any, label?: string): Promise<{
  success: boolean;
  track: MediaTrack;
}> {
  return request("/api/proxy/media/import-soundcloud", {
    method: "POST",
    body: { ...metadata, label },
  });
}

export function getSoundCloudArtistTracks(artistUrl: string): Promise<{
  success: boolean;
  tracks: Array<{ title: string; artist: string; coverUrl: string; url: string; externalId: string }>;
}> {
  return request("/api/proxy/media/soundcloud-artist", {
    method: "POST",
    body: { artistUrl },
  });
}



// Live proxy (Restreamer)
export interface LiveStream {
  id: string;
  name: string;
  description: string;
  hlsUrl: string;
  isLive: boolean;
  /** Viewer count from Redis — included in GET /api/proxy/live/streams responses */
  viewerCount?: number;
  title?: string;
  performerName?: string;
  /** Performer username/slug — used for launch gate check */
  username?: string | null;
  /** Category tags set by the streamer at go-live time */
  tags?: string[];
  /** Base64 JPEG thumbnail data URL captured from the streamer's preview */
  thumbnailUrl?: string | null;
}

export function getLiveStreams(): Promise<{
  success: boolean;
  streams: LiveStream[];
}> {
  return request("/api/proxy/live/streams");
}

export interface LiveStreamWithHost extends LiveStream {
  hostedChannelRef?: string;
  hostedChannelName?: string;
  hostedHlsUrl?: string;
}

export function getWebAppLiveStreams(): Promise<{
  success: boolean;
  streams: LiveStreamWithHost[];
}> {
  return request("/api/webapp/live/streams");
}

export function initiateRaid(targetChannelRef: string): Promise<{
  success: boolean;
  sourceChannelRef?: string;
  targetChannelRef?: string;
  targetName?: string;
  viewerCount?: number;
  error?: string;
}> {
  return request("/api/webapp/live/raid", {
    method: "POST",
    body: { targetChannelRef },
  });
}

export function setHostedChannel(targetChannelRef: string | null): Promise<{
  success: boolean;
  hosting: string | null;
  error?: string;
}> {
  return request("/api/webapp/live/host", {
    method: "POST",
    body: { targetChannelRef },
  });
}

export function getHostedChannel(): Promise<{
  success: boolean;
  sourceChannelRef?: string;
  hosting: string | null;
  error?: string;
}> {
  return request("/api/webapp/live/host");
}

// Ticketed live shows
export function getSlotTicketStatus(slotId: string): Promise<{
  success: boolean;
  isTicketed: boolean;
  priceTokens: number | null;
  priceUsd: string | null;
  hasTicket: boolean;
}> {
  return request(`/api/webapp/live/slot/${encodeURIComponent(slotId)}/ticket-status`);
}

export function buySlotTicket(
  slotId: string,
  currency: "tokens" | "dash"
): Promise<{
  success: boolean;
  hasTicket?: boolean;
  alreadyOwned?: boolean;
  newBalance?: number;
  error?: string;
  provider?: "dash";
  paymentId?: string;
  checkoutUrl?: string;
  invoiceId?: string;
}> {
  return request(`/api/webapp/live/slot/${encodeURIComponent(slotId)}/buy-ticket`, {
    method: "POST",
    body: { currency },
  });
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
  is_followed?: boolean;
  last_seen?: string | null;
  last_update?: string | null;
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

export function getDistanceToUser(
  userId: string
): Promise<{ success: boolean; distance_km: number | null }> {
  return request(`/api/webapp/nearby/distance/${userId}`);
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
  hoursOfOperation?: Record<string, string> | null;
  favoriteCount?: number;
  viewCount?: number;
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

export function favoritePlaceToggle(placeId: number): Promise<{ success: boolean; favorited: boolean }> {
  return request(`/api/webapp/nearby/places/${placeId}/favorite`, { method: "POST" });
}

export function trackPlaceView(placeId: number): Promise<{ success: boolean }> {
  return request(`/api/webapp/nearby/places/${placeId}/view`, { method: "POST" });
}

export function reportPlace(placeId: number): Promise<{ success: boolean }> {
  return request(`/api/webapp/nearby/places/${placeId}/report`, { method: "POST" });
}

export function getPlaceFavorites(): Promise<{ success: boolean; placeIds: number[] }> {
  return request("/api/webapp/nearby/places/favorites");
}

export interface ReferralStats {
  code: string;
  link: string;
  total: number;
  completed: number;
  /** PNP Live tokens earned from completed referrals (since 2026-04-25). */
  tokensEarned?: number;
}

export interface ReferralEntry {
  referee_username: string | null;
  status: "pending" | "completed";
  reward_tokens: number;
  created_at: string;
  completed_at: string | null;
}

export function getMyReferral(): Promise<ReferralStats> {
  return request("/api/webapp/me/referral");
}

export function getReferralList(): Promise<{ success: boolean; list: ReferralEntry[] }> {
  return request("/api/webapp/me/referral/list");
}

export function redeemReferralCode(
  code: string
): Promise<{ success?: boolean; alreadyRedeemed?: boolean; pending?: boolean }> {
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
  paymentMethod: "tokens" | "dash" = "tokens"
): Promise<{ success: boolean; tipId: number; paymentUrl: string | null; invoiceId?: string; checkoutUrl?: string; amount: number; paymentMethod: string; newBalance?: number }> {
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
  payment_method: string | null;
  created_at: string;
  settled_at: string | null;
}

export function getWalletBalance(): Promise<{ success: boolean; balance: number; regularBalance: number; giftedBalance: number; dpnsHandle: string | null }> {
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

export function buyTokensWithNowPayments(packageId: string, payCurrency?: string): Promise<{ success: boolean; invoiceId: string; checkoutUrl: string; tokens: number; usdAmount: number; payAddress?: string | null; payAmount?: number | null; network?: string | null; validUntil?: string | null; error?: string }> {
  return request("/api/wallet/buy-nowpayments", { method: "POST", body: { packageId, ...(payCurrency ? { payCurrency } : {}) } });
}

export interface TokenCheckoutData {
  success: boolean;
  provider: "dash";
  tokens: number;
  usd: number;
  status: string;
}

export function getTokenCheckoutData(purchaseId: string): Promise<TokenCheckoutData> {
  return request(`/api/token-checkout/${encodeURIComponent(purchaseId)}`);
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
  channelRef?: string;
  error?: string;
}> {
  return request("/api/webapp/live/rtmp-key");
}

export function provisionChannel(): Promise<{
  success: boolean;
  alreadyProvisioned?: boolean;
  rtmpUrl?: string;
  streamKey?: string;
  channelRef?: string;
  hlsUrl?: string;
  error?: string;
}> {
  return request("/api/webapp/live/provision-channel", { method: "POST" });
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
  label?: 'PRIME' | 'BASIC' | 'FREE';
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
  autoShareToX?: boolean;
  hasTelegram?: boolean;
  display_name?: string;
  // Creator fields
  creatorStatus?: string;
  creatorType?: string;
  creatorPriceUsd?: number | null;
  creatorVerified?: boolean;
  creatorFeatured?: boolean;
  creatorSubscriberCount?: number;
  exclusiveVideoCount?: number;
  exclusivePhotoCount?: number;
  // Performer fields (set when user has an active performers record)
  performerData?: {
    id: string;
    isAvailable: boolean;
    basePrice: number;
    averageRating: number;
    totalCalls: number;
    availabilityMessage: string | null;
  } | null;
  // Wellness: cumulative days of self-care breaks across all sessions
  wellnessDaysAccumulated?: number;
  // Colombia Socio badge
  colombiaBadge?: boolean;
  // Gamification badges earned by this user
  gamificationBadges?: UserBadgeEntry[];
  // Consent state
  acceptedTerms?: boolean;
}

/** Sidecar metadata stored on social_posts.metadata for channel-promo rows. */
export interface ChannelPromoMetadata {
  kind: "channel_promo";
  channel_id: number;
  channel_slug: string;
  channel_name: string;
  creator_id: string;
  creator_username: string | null;
  access_type: "free" | "subscription" | "prime" | "paid";
  price_usd: number | null;
  video_id: number;
  video_directus_id: string;
  video_url: string;
  has_animated_gif: boolean;
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
  view_count?: number;
  created_at: string;
  author_id: string;
  author_username: string;
  author_first_name: string;
  author_photo: string | null;
  author_city?: string | null;
  author_country?: string | null;
  liked_by_me: boolean;
  repost_content?: string;
  repost_created_at?: string;
  repost_author_username?: string;
  repost_author_first_name?: string;
  is_wof?: boolean;
  // Video metadata
  video_title?: string | null;
  video_description?: string | null;
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
  // Tier-gating fields (free-tier users see blurred posts)
  blurred?: boolean;
  content_locked?: boolean;
  content_tier?: string;
  // Multi-image support (up to 4 files per post)
  media_urls?: Array<{ url: string; type: string; thumbnail_url?: string }> | null;
  // Video thumbnail (poster frame generated server-side)
  video_thumbnail_url?: string | null;
  // Multi-frame thumbnails for hover/cycling preview
  video_thumbnails?: string[] | null;
  // Promoted post fields (CMS-managed featured content)
  is_promoted?: boolean;
  promoted_link?: string | null;
  promoted_link_label?: string | null;
  promoted_thumbnail?: string | null;
  promoted_link2?: string | null;
  promoted_link2_label?: string | null;
  // Per-post sidecar metadata. Used today by channel_promo posts; viewer's
  // CTA is computed client-side from metadata.access_type.
  metadata?: ChannelPromoMetadata | Record<string, unknown> | null;
  // Synthetic "New on PRIME" carousel — backend injects at top of feed page 1
  is_carousel?: boolean;
  // Explicitly tagged performers (distinct from text @mentions)
  tagged_performers?: Array<{ id: string; username: string; avatar_url: string | null }> | null;
  carousel_total?: number;
  carousel_items?: Array<{
    id: number;
    title: string;
    duration: number | null;
    thumbnail_url: string | null;
    link: string;
  }>;
  // Hangout feed integration
  hangout_group_id?: number | null;
  hangout_group_name?: string | null;
  hangout_group_avatar?: string | null;
  source_message_id?: number | null;
  // Emoji reactions (aggregated top 3 by count)
  reactions?: Array<{ emoji: string; count: number; reacted_by_me?: boolean }>;
  my_reaction?: string | null;
}

export interface PostCardSnapshot {
  authorUsername?: string | null;
  authorFirstName?: string | null;
  authorAvatar?: string | null;
  authorPhoto?: string | null;
  authorCreatorStatus?: string | null;
  authorTier?: string | null;
  content?: string | null;
  mediaUrl?: string | null;
  mediaType?: string | null;
  mediaThumbUrl?: string | null;
  createdAt?: string | null;
  postCreatedAt?: string | null;
  isExclusive?: boolean | null;
  likesCount?: number | null;
  repliesCount?: number | null;
  videoThumbnailUrl?: string | null;
  videoTitle?: string | null;
  videoDescription?: string | null;
  /** Forward/share note prepended by the sharer */
  note?: string | null;
}

export interface XStatus {
  linked: boolean;
  hasWriteScope: boolean;
  handle: string | null;
}

export function getXStatus(): Promise<{ success: boolean; status: XStatus }> {
  return request("/api/social/x-status");
}

export function sharePostToX(postId: number): Promise<{
  success: boolean;
  tweetId?: string;
  tweetUrl?: string;
  error?: string;
}> {
  return request(`/api/webapp/social/posts/${postId}/share-x`, { method: "POST" });
}

export function sharePostToHangouts(
  postId: number,
  groupIds: number[],
  note?: string
): Promise<{
  success: boolean;
  results: Array<{
    groupId: number;
    status: "sent" | "skipped";
    messageId?: number;
    reason?: string;
  }>;
}> {
  return request(`/api/webapp/social/posts/${postId}/share-to-hangouts`, {
    method: "POST",
    body: { groupIds, ...(note?.trim() ? { note: note.trim() } : {}) },
  });
}

export function getProfile(): Promise<{ success: boolean; profile: UserProfile }> {
  return request("/api/webapp/profile");
}

export function updateProfile(
  fields: Partial<{
    username: string;
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
    hasSeenTutorial: boolean;
    language: string;
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
  autoShareToX?: boolean;
}): Promise<{ success: boolean; privacy: Record<string, boolean> }> {
  return request("/api/webapp/privacy", { method: "PATCH", body: settings });
}

export function updateLanguage(lang: string): Promise<{ success: boolean }> {
  return updateProfile({ language: lang });
}

export function resendVerificationEmail(email: string): Promise<{ success: boolean; message: string }> {
  return request("/api/webapp/auth/resend-verification", { method: "POST", body: { email } });
}

export interface EnablePnptvIdResponse {
  success: boolean;
  message?: string;
  email?: string;
  error?: string;
}

export function enablePnptvIdLogin(email: string): Promise<EnablePnptvIdResponse> {
  return request("/api/webapp/auth/enable-pnptv-id", {
    method: "POST",
    body: { email },
  });
}

export function changeEmail(email: string): Promise<{ success: boolean; email?: string; error?: string }> {
  return request("/api/webapp/settings/change-email", { method: "POST", body: { email } });
}

export function deleteAccount(): Promise<{ success: boolean }> {
  return request("/api/webapp/account", { method: "DELETE" });
}

export interface EraseAccountReceipt {
  success: boolean;
  erasure_id: string;
  timestamp: string;
  scope: string[];
}

export function eraseMyAccount(): Promise<EraseAccountReceipt> {
  return request("/api/users/me/erase", {
    method: "DELETE",
    body: { confirm: "DELETE MY ACCOUNT" },
  });
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

export async function uploadCreatorMediaFile(
  file: File,
  caption?: string,
  isPremium?: boolean
): Promise<{ success: boolean; item: CreatorMediaItem }> {
  const fd = new FormData();
  fd.append("file", file);
  if (caption) fd.append("caption", caption);
  if (isPremium) fd.append("isPremium", "true");
  const res = await fetch(`${API_BASE}/api/webapp/creators/media/upload`, {
    method: "POST",
    credentials: "include",
    body: fd,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error?.message || body?.error || `Upload failed (${res.status})`);
  }
  return res.json();
}

export async function uploadCreatorVideoFile(
  file: File,
  caption?: string,
  isPremium?: boolean
): Promise<{ success: boolean; item: CreatorMediaItem }> {
  const fd = new FormData();
  fd.append("file", file);
  if (caption) fd.append("caption", caption);
  if (isPremium) fd.append("isPremium", "true");
  const res = await fetch(`${API_BASE}/api/webapp/creators/media/upload-video`, {
    method: "POST",
    credentials: "include",
    body: fd,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error?.message || body?.error || `Upload failed (${res.status})`);
  }
  return res.json();
}

const CHUNK_SIZE = 5 * 1024 * 1024; // 5 MB
const RESUME_KEY = "pnptv_video_upload";

export interface ChunkUploadProgress {
  pct: number;
  doneChunks: number;
  totalChunks: number;
  uploadId: string;
}

export async function uploadCreatorVideoChunked(
  file: File,
  opts: {
    caption?: string;
    isPremium?: boolean;
    onProgress?: (p: ChunkUploadProgress) => void;
    resumeUploadId?: string;
    resumeChunksDone?: number;
  } = {}
): Promise<{ success: boolean; item: CreatorMediaItem }> {
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
  let uploadId = opts.resumeUploadId ?? "";
  let startChunk = opts.resumeChunksDone ?? 0;
  let reinitDone = false;

  async function doInit(): Promise<string> {
    const initRes = await fetch(`${API_BASE}/api/webapp/creators/media/upload-video/init`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileName: file.name, fileSize: file.size, totalChunks }),
    });
    if (!initRes.ok) {
      const b = await initRes.json().catch(() => null);
      throw new Error(b?.error || `Init failed (${initRes.status})`);
    }
    const id = (await initRes.json()).uploadId as string;
    localStorage.setItem(RESUME_KEY, JSON.stringify({ uploadId: id, fileName: file.name, fileSize: file.size, chunksUploaded: 0 }));
    return id;
  }

  if (!uploadId) {
    uploadId = await doInit();
  }

  let i = startChunk;
  while (i < totalChunks) {
    const blob = file.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
    let sessionExpired = false;
    let lastErr: Error | null = null;

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const fd = new FormData();
        fd.append("uploadId", uploadId);
        fd.append("chunkIndex", String(i));
        fd.append("totalChunks", String(totalChunks));
        fd.append("chunk", blob, `chunk-${i}`);
        const r = await fetch(`${API_BASE}/api/webapp/creators/media/upload-video/chunk`, {
          method: "POST",
          credentials: "include",
          body: fd,
        });
        if (!r.ok) {
          const b = await r.json().catch(() => null);
          if (r.status === 404 && !reinitDone) { sessionExpired = true; lastErr = null; break; }
          throw new Error(b?.error || `Chunk ${i} failed (${r.status})`);
        }
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e as Error;
        if (attempt < 2) await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
      }
    }

    if (sessionExpired) {
      reinitDone = true;
      localStorage.removeItem(RESUME_KEY);
      uploadId = await doInit();
      i = 0;
      continue;
    }
    if (lastErr) throw lastErr;

    localStorage.setItem(RESUME_KEY, JSON.stringify({ uploadId, fileName: file.name, fileSize: file.size, chunksUploaded: i + 1 }));
    opts.onProgress?.({ pct: Math.round(((i + 1) / totalChunks) * 100), doneChunks: i + 1, totalChunks, uploadId });
    i++;
  }

  const completeRes = await fetch(`${API_BASE}/api/webapp/creators/media/upload-video/complete`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uploadId, caption: opts.caption ?? null, isPremium: opts.isPremium ?? false }),
  });
  if (!completeRes.ok) {
    const b = await completeRes.json().catch(() => null);
    throw new Error(b?.error || `Complete failed (${completeRes.status})`);
  }
  localStorage.removeItem(RESUME_KEY);
  return completeRes.json();
}

export function getVideoUploadResume(file: File): { uploadId: string; chunksUploaded: number } | null {
  try {
    const raw = localStorage.getItem(RESUME_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data.fileName === file.name && data.fileSize === file.size && data.chunksUploaded > 0) {
      return { uploadId: data.uploadId, chunksUploaded: data.chunksUploaded };
    }
  } catch {}
  return null;
}

export function clearVideoUploadResume(): void {
  localStorage.removeItem(RESUME_KEY);
}

export function changeTier(tier: "ice" | "crystal" | "diamond"): Promise<{ success: boolean; tier: string; price: number }> {
  return request("/api/webapp/creator/change-tier", { method: "POST", body: { tier } });
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

export function getPublicPost(
  postId: string | number
): Promise<{ success: boolean; post: SocialPostItem }> {
  return request(`/api/webapp/social/posts/${postId}`);
}

/**
 * Fetch a single post by ID using the authenticated session endpoint.
 * Respects tier-gating: returns `blurred: true` + `content_locked: true` for
 * posts the viewer's tier cannot access. Alias for `getPublicPost` with a
 * semantically accurate name.
 */
export const getSocialPost = getPublicPost;

export function getSocialFeedPosts(
  cursor?: string,
  limit = 20
): Promise<{ success: boolean; posts: SocialPostItem[]; nextCursor: string | null; freeUserLimited?: boolean }> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set("cursor", cursor);
  return request(`/api/webapp/social/feed?${params}`);
}

export function getPostsByHashtag(
  tag: string,
  cursor?: string,
  limit = 20
): Promise<{ success: boolean; posts: SocialPostItem[]; nextCursor: string | null }> {
  const params = new URLSearchParams({ tag, limit: String(limit) });
  if (cursor) params.set("cursor", cursor);
  return request(`/api/webapp/social/hashtag-feed?${params}`);
}

export function createSocialPost(
  content: string,
  mediaFiles?: File | File[],
  isExclusive?: boolean,
  isShareable?: boolean,
): Promise<{ success: boolean; post: SocialPostItem }> {
  const filesArray = mediaFiles
    ? Array.isArray(mediaFiles)
      ? mediaFiles
      : [mediaFiles]
    : [];

  if (filesArray.length > 1) {
    // Multi-image path — up to 4 files
    const formData = new FormData();
    formData.append("content", content);
    filesArray.forEach((f) => formData.append("media", f));
    if (isExclusive) formData.append("isExclusive", "true");
    if (isShareable === false) formData.append("isShareable", "false");
    return fetch(`${API_BASE}/api/webapp/social/posts/with-multi-media`, {
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

  if (filesArray.length === 1) {
    // Single-file path — use existing endpoint for backward compat
    const formData = new FormData();
    formData.append("content", content);
    formData.append("media", filesArray[0]);
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

  // Text-only path
  return request("/api/webapp/social/posts", {
    method: "POST",
    body: { content, isExclusive: isExclusive ?? false, isShareable: isShareable ?? true },
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
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch {
          reject(new Error("Invalid server response"));
        }
      } else {
        try {
          const err = JSON.parse(xhr.responseText);
          reject(new Error(err.error || `Upload failed (${xhr.status})`));
        } catch {
          reject(new Error(`Upload failed (${xhr.status})`));
        }
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

export function recordPostView(postId: number): Promise<{ success: boolean; view_count?: number; deduped?: boolean }> {
  return request(`/api/webapp/social/posts/${postId}/view`, { method: "POST" });
}

// ── Content (video) reactions ─────────────────────────────────────────────────

export type ContentReaction = {
  emoji: string;
  count: number;
  users: Array<{ id: string; username: string }>;
  reactedByMe?: boolean;
};

export function getContentReactions(contentId: number): Promise<{
  success: boolean;
  reactions: ContentReaction[];
}> {
  return request(`/api/webapp/content/${contentId}/reactions`);
}

export function toggleContentReaction(contentId: number, emoji: string): Promise<{
  success: boolean;
  added: boolean;
  reactions: ContentReaction[];
}> {
  return request(`/api/webapp/content/${contentId}/react`, {
    method: "POST",
    body: { emoji },
  });
}

export function deleteSocialPost(postId: number): Promise<{ success: boolean }> {
  return request(`/api/webapp/social/posts/${postId}`, { method: "DELETE" });
}

export function editSocialPost(
  postId: number,
  content: string,
  opts?: {
    videoTitle?: string | null;
    videoDescription?: string | null;
    taggedPerformerIds?: string[];
  }
): Promise<{ success: boolean; content: string; videoTitle?: string | null; videoDescription?: string | null }> {
  return request(`/api/webapp/social/posts/${postId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content,
      ...(opts?.videoTitle !== undefined && { video_title: opts.videoTitle }),
      ...(opts?.videoDescription !== undefined && { video_description: opts.videoDescription }),
      ...(opts?.taggedPerformerIds !== undefined && { tagged_performer_ids: opts.taggedPerformerIds }),
    }),
  });
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

// ── Matrix bridge endpoints ───────────────────────────────────────────────────





export function getReplies(
  postId: number,
  cursor?: string
): Promise<{ success: boolean; replies: SocialPostItem[]; nextCursor: string | null }> {
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

// Mention autocomplete search
export interface MentionUser {
  id: string;
  username: string;
  avatar_url: string | null;
  creator_status: string | null;
}

export function searchMentions(
  q: string
): Promise<{ success: boolean; users: MentionUser[] }> {
  return request(
    `/api/webapp/social/mentions/search?q=${encodeURIComponent(q)}`
  );
}

export function searchCreators(
  q: string
): Promise<{ success: boolean; users: MentionUser[] }> {
  return request(
    `/api/webapp/social/mentions/search?q=${encodeURIComponent(q)}&creators_only=1`
  );
}

/**
 * Home page preview feed — no auth required, returns latest N posts.
 * liked_by_me is always false; use getSocialFeedPosts on the Social page for
 * accurate per-viewer like state.
 */

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
  tags?: string[];
  feedVisibility?: "public" | "shadow" | "ghost";
  telegramChatId?: number | null;
  telegramInviteLink?: string | null;
  isPaid?: boolean;
  priceUsd?: number;
  rules?: string | null;
  channelId?: number | null;
  channelAccessType?: 'free' | 'prime' | 'subscription' | 'paid' | null;
  channelPriceUsd?: number | null;
  channelName?: string | null;
  // Moderation / posting controls (returned at top-level by hangoutGroupController)
  isReadOnly?: boolean;
  slowModeSeconds?: number;
  // Per-user thread state (pin/mute/read)
  isPinned?: boolean;
  isUserMuted?: boolean;
  userMuteUntil?: string | null;
  lastReadMessageId?: number | null;
}

export type ForwardTarget =
  | { type: "dm"; userId: string }
  | { type: "hangout"; groupId: number };

export interface MessageReaction {
  emoji: string;
  count: number;
  users: string[];
  reacted_by_me: boolean;
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
  media_type: "image" | "video" | "audio" | null;
  media_mime: string | null;
  media_thumb_url: string | null;
  media_width: number | null;
  media_height: number | null;
  media_duration?: number | null;
  reply_to_id?: number | null;
  reply_to?: { name: string; content: string; mediaType?: string | null; mediaThumbUrl?: string | null; mediaUrl?: string | null } | null;
  created_at: string;
  edited_at?: string | null;
  edit_count?: number;
  is_deleted?: boolean;
  is_pinned?: boolean;
  reactions?: MessageReaction[];
  message_type?: "text" | "post_card" | string;
  meta?: MessageMeta | null;
}

export interface ForwardSource {
  type: "dm" | "hangout" | "post";
  messageId?: number;
  groupId?: number;
  authorId?: string | null;
  authorUsername?: string | null;
  authorFirstName?: string | null;
  authorPhoto?: string | null;
  createdAt?: string | null;
  text?: string | null;
  mediaUrl?: string | null;
  mediaType?: "image" | "video" | "audio" | null;
  mediaThumbUrl?: string | null;
}

export type MessageMeta =
  | { postId: number; snapshot?: PostCardSnapshot; kind?: undefined; source?: undefined; note?: string | null }
  | { kind: "forward"; source: ForwardSource; note?: string | null; postId?: undefined; snapshot?: undefined }
  | { postId?: number; snapshot?: PostCardSnapshot; kind?: string; source?: ForwardSource; note?: string | null };

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
  isPublic?: boolean,
  isPaid?: boolean,
  priceUsd?: number,
  rules?: string,
  channelId?: number | null
): Promise<{ success: boolean; group: HangoutGroup }> {
  return request("/api/webapp/hangouts/groups", {
    method: "POST",
    body: { name, description, isPublic, isPaid, priceUsd, rules, channelId },
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
  tags?: string[];
  isPaid?: boolean;
  priceUsd?: number;
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

export function updateHangoutGroup(
  groupId: number,
  data: { name?: string; description?: string; isPublic?: boolean; rules?: string }
): Promise<{ success: boolean }> {
  return request(`/api/webapp/hangouts/groups/${groupId}`, { method: "PATCH", body: data });
}

export function uploadGroupAvatar(
  groupId: number,
  file: File
): Promise<{ success: boolean; avatarUrl?: string }> {
  const form = new FormData();
  form.append("avatar", file);
  return fetch(`${API_BASE}/api/webapp/hangouts/groups/${groupId}/avatar`, {
    method: "POST",
    credentials: "include",
    body: form,
  }).then((r) => r.json());
}

export function kickGroupMember(
  groupId: number,
  userId: string
): Promise<{ success: boolean }> {
  return request(`/api/webapp/hangouts/groups/${groupId}/kick`, { method: "POST", body: { userId } });
}

export function updateMemberRole(
  groupId: number,
  userId: string,
  role: string
): Promise<{ success: boolean }> {
  return request(`/api/webapp/hangouts/groups/${groupId}/members/${userId}/role`, { method: "POST", body: { role } });
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
  content: string,
  replyToId?: number | null
): Promise<{ success: boolean; message: GroupMessage }> {
  return request(`/api/webapp/hangouts/groups/${id}/messages`, {
    method: "POST",
    body: { content, ...(replyToId ? { replyToId } : {}) },
  });
}

export function editGroupMessage(
  groupId: number,
  messageId: number,
  content: string
): Promise<{ success: boolean; message: GroupMessage }> {
  return request(`/api/webapp/hangouts/groups/${groupId}/messages/${messageId}`, {
    method: "PATCH",
    body: { content },
  });
}

export function deleteGroupMessage(
  groupId: number,
  messageId: number,
  forAll: boolean = false
): Promise<{ success: boolean }> {
  return request(`/api/webapp/hangouts/groups/${groupId}/messages/${messageId}?forAll=${forAll}`, {
    method: "DELETE",
  });
}


export function toggleMessageReaction(
  groupId: number,
  messageId: number,
  emoji: string
): Promise<{ success: boolean; reactions: MessageReaction[] }> {
  return request(`/api/webapp/hangouts/groups/${groupId}/messages/${messageId}/react`, {
    method: "POST",
    body: { emoji },
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

export function markGroupAsRead(groupId: number): Promise<{ success: boolean }> {
  return request(`/api/webapp/hangouts/groups/${groupId}/read`, { method: "POST" });
}

// ── Hangout thread state (pin / mute / read) ────────────────────────────────

export function pinHangoutGroup(
  groupId: number,
  pinned: boolean
): Promise<{ success: boolean; pinned: boolean }> {
  return request(`/api/webapp/hangouts/groups/${groupId}/pin`, {
    method: "PUT",
    body: { pinned },
  });
}

export function muteHangoutGroupForUser(
  groupId: number,
  until: string | "forever" | null
): Promise<{ success: boolean; mutedUntil: string | null }> {
  return request(`/api/webapp/hangouts/groups/${groupId}/mute`, {
    method: "PUT",
    body: { until },
  });
}


export function forwardHangoutMessage(
  messageId: number,
  targets: ForwardTarget[],
  note?: string
): Promise<{
  success: boolean;
  results: Array<{
    target: ForwardTarget;
    status: "sent" | "skipped";
    messageId?: number;
    reason?: string;
  }>;
}> {
  return request(`/api/webapp/hangouts/messages/${messageId}/forward`, {
    method: "POST",
    body: { targets, ...(note?.trim() ? { note: note.trim() } : {}) },
  });
}

// ── Hangout Group Management ────────────────────────────────────────────────

export function kickHangoutMember(groupId: number, userId: string): Promise<{ success: boolean }> {
  return request(`/api/webapp/hangouts/groups/${groupId}/kick`, {
    method: "POST",
    body: { userId },
  });
}

export function banHangoutMember(groupId: number, userId: string): Promise<{ success: boolean }> {
  return request(`/api/webapp/hangouts/groups/${groupId}/ban`, {
    method: "POST",
    body: { userId },
  });
}

export function unbanHangoutMember(groupId: number, userId: string): Promise<{ success: boolean }> {
  return request(`/api/webapp/hangouts/groups/${groupId}/unban`, {
    method: "POST",
    body: { userId },
  });
}

export function muteHangoutMember(groupId: number, userId: string, durationMinutes = 60): Promise<{ success: boolean; mutedUntil: string }> {
  return request(`/api/webapp/hangouts/groups/${groupId}/mute`, {
    method: "POST",
    body: { userId, durationMinutes },
  });
}

export function unmuteHangoutMember(groupId: number, userId: string): Promise<{ success: boolean }> {
  return request(`/api/webapp/hangouts/groups/${groupId}/unmute`, {
    method: "POST",
    body: { userId },
  });
}

export function promoteHangoutMember(groupId: number, userId: string): Promise<{ success: boolean }> {
  return request(`/api/webapp/hangouts/groups/${groupId}/promote`, {
    method: "POST",
    body: { userId },
  });
}

export function demoteHangoutMember(groupId: number, userId: string): Promise<{ success: boolean }> {
  return request(`/api/webapp/hangouts/groups/${groupId}/demote`, {
    method: "POST",
    body: { userId },
  });
}

export function updateHangoutSettings(groupId: number, settings: {
  slowModeSeconds?: number;
  isReadOnly?: boolean;
  allowMedia?: boolean;
  allowMemberInvites?: boolean;
  autoDeleteHours?: number;
  tags?: string[];
  isPublic?: boolean;
  name?: string;
  description?: string;
  feedVisibility?: "public" | "shadow" | "ghost";
}): Promise<{ success: boolean; settings: Record<string, unknown> }> {
  return request(`/api/webapp/hangouts/groups/${groupId}/settings`, {
    method: "PUT",
    body: settings,
  });
}


export function getHangoutInviteLink(groupId: number): Promise<{ success: boolean; inviteCode: string; inviteUrl: string }> {
  return request(`/api/webapp/hangouts/groups/${groupId}/invite-link`);
}

export function joinHangoutByInvite(code: string): Promise<{ success: boolean; groupId: number }> {
  return request(`/api/webapp/hangouts/groups/join-by-invite/${encodeURIComponent(code)}`, {
    method: "POST",
  });
}

export function updateHangoutNotification(groupId: number, mode: "all" | "mentions" | "muted"): Promise<{ success: boolean }> {
  return request(`/api/webapp/hangouts/groups/${groupId}/notification`, {
    method: "PUT",
    body: { mode },
  });
}


// GetActiveCallResponse, getActiveGroupCall, leaveGroupCall removed — calls use Telegram native

// ============================================================================
// Hangout Feed Integration
// ============================================================================

export function getHangoutFeed(groupId: number, cursor?: string, limit = 20): Promise<{ success: boolean; posts: SocialPostItem[]; nextCursor: string | null }> {
  const params = new URLSearchParams();
  if (cursor) params.set("cursor", cursor);
  params.set("limit", String(limit));
  return request(`/api/webapp/hangouts/groups/${groupId}/feed?${params}`);
}

export function dropToFeed(groupId: number, messageId: number, note?: string): Promise<{ success: boolean; post: SocialPostItem }> {
  return request(`/api/webapp/hangouts/groups/${groupId}/drop-to-feed`, {
    method: "POST",
    body: { messageId, ...(note?.trim() ? { note: note.trim() } : {}) },
  });
}

export interface HangoutActivity {
  id: number;
  name: string;
  avatarUrl: string | null;
  isMain: boolean;
  memberCount: number;
  messageCount: number;
  lastActiveAt: string | null;
}

export function getUserHangoutActivity(userId: string): Promise<{ success: boolean; hangouts: HangoutActivity[] }> {
  return request(`/api/webapp/social/hangout-activity/${userId}`);
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

export interface GlobalSearchResult {
  success: boolean;
  users: Array<{
    id: string;
    username: string;
    first_name: string;
    last_name: string | null;
    photo_file_id: string | null;
    pnptv_id: string;
  }>;
  creators: Array<{
    id: string;
    user_id: string;
    display_name: string;
    username: string;
    photo_url: string | null;
    category: string | null;
    verified: boolean;
  }>;
  posts: Array<{
    id: string;
    content: string;
    author_id: string;
    author_username: string;
    author_name: string;
    author_photo: string | null;
    created_at: string;
    media_count: number;
  }>;
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
// Community Reports — report a user for rule violations
// ============================================================================

export type ReportCategory =
  | "harassment"
  | "hate"
  | "spam_scam"
  | "impersonation"
  | "csam"
  | "nudity_nonconsensual"
  | "self_harm"
  | "other";

export type ReportEvidenceType = "profile" | "post" | "hangout_message" | "dm";

export type ReportStatus = "pending" | "reviewed" | "action_taken" | "dismissed";

export interface CreateReportInput {
  reportedUserId: string;
  category: ReportCategory;
  description?: string;
  evidenceType?: ReportEvidenceType;
  evidenceId?: string | number;
}

export function createUserReport(input: CreateReportInput): Promise<{
  success: boolean;
  report?: { id: number; status: ReportStatus };
  error?: string;
  code?: string;
}> {
  return request("/api/webapp/reports", {
    method: "POST",
    body: input,
  });
}

export interface AdminReport {
  id: number;
  reporter_id: string;
  reported_user_id: string;
  category: ReportCategory;
  description: string | null;
  evidence_type: ReportEvidenceType | null;
  evidence_id: string | null;
  status: ReportStatus;
  reviewer_id: string | null;
  reviewed_at: string | null;
  action_notes: string | null;
  created_at: string;
  updated_at: string;
  reporter_first_name: string | null;
  reporter_username: string | null;
  reporter_photo: string | null;
  reported_first_name: string | null;
  reported_username: string | null;
  reported_photo: string | null;
  reported_role: string | null;
  reported_is_active: boolean;
}

export function listAdminReports(params?: {
  status?: ReportStatus | "all";
  limit?: number;
  offset?: number;
}): Promise<{
  success: boolean;
  reports: AdminReport[];
  counts: Partial<Record<ReportStatus, number>>;
  pending: number;
}> {
  const qs = new URLSearchParams();
  if (params?.status) qs.set("status", params.status);
  if (params?.limit != null) qs.set("limit", String(params.limit));
  if (params?.offset != null) qs.set("offset", String(params.offset));
  const query = qs.toString();
  return request(`/api/webapp/admin/reports${query ? `?${query}` : ""}`);
}

export type ReportAction = "dismiss" | "warn" | "suspend_7d" | "ban";

export function reviewAdminReport(
  reportId: number,
  action: ReportAction,
  notes?: string,
): Promise<{ success: boolean; report?: AdminReport; error?: string; code?: string }> {
  return request(`/api/webapp/admin/reports/${reportId}`, {
    method: "PATCH",
    body: { action, notes },
  });
}

// ============================================================================
// Appeals — public appeal form for banned users + admin review
// ============================================================================

export type AppealStatus = "pending" | "approved" | "denied";

export interface SubmitAppealInput {
  submittedIdentifier: string;
  contactEmail: string;
  explanation: string;
  honeypot?: string;
}

export function submitAppeal(input: SubmitAppealInput): Promise<{
  success: boolean;
  appeal?: { id: number; status: AppealStatus };
  error?: string;
  code?: string;
}> {
  return request("/api/webapp/appeal", {
    method: "POST",
    body: input,
  });
}

export interface AdminAppeal {
  id: number;
  submitted_identifier: string;
  resolved_user_id: string | null;
  contact_email: string;
  explanation: string;
  status: AppealStatus;
  admin_notes: string | null;
  reviewer_id: string | null;
  reviewed_at: string | null;
  ip: string | null;
  created_at: string;
  updated_at: string;
  resolved_first_name: string | null;
  resolved_username: string | null;
  resolved_role: string | null;
  resolved_is_active: boolean | null;
  resolved_photo: string | null;
}

export function listAdminAppeals(params?: {
  status?: AppealStatus | "all";
  limit?: number;
  offset?: number;
}): Promise<{
  success: boolean;
  appeals: AdminAppeal[];
  counts: Partial<Record<AppealStatus, number>>;
  pending: number;
}> {
  const qs = new URLSearchParams();
  if (params?.status) qs.set("status", params.status);
  if (params?.limit != null) qs.set("limit", String(params.limit));
  if (params?.offset != null) qs.set("offset", String(params.offset));
  const query = qs.toString();
  return request(`/api/webapp/admin/appeals${query ? `?${query}` : ""}`);
}

export function reviewAdminAppeal(
  appealId: number,
  action: "approve" | "deny",
  notes?: string,
): Promise<{ success: boolean; appeal?: AdminAppeal; error?: string; code?: string }> {
  return request(`/api/webapp/admin/appeals/${appealId}`, {
    method: "PATCH",
    body: { action, notes },
  });
}

// ============================================================================
// Phase 1: Direct Messages API
// ============================================================================

export interface MessageThread {
  // identity
  partnerId: string;
  partnerUsername: string;
  partnerFirstName: string;
  partnerPhoto: string | null;
  partnerPnptvId?: string | null;

  // last message preview
  lastMessage: string;
  lastMessageAt: string;
  lastMessageSenderId: string | null;
  lastMessageMediaType: 'image' | 'video' | 'audio' | null;
  lastMessageReadByOther: boolean;

  // counts
  unread: number;

  // per-user thread state
  pinnedAt: string | null;
  mutedUntil: string | null;
  archivedAt: string | null;
  pinnedMessageId: number | null;
  hideReadReceipts?: boolean;

  // presence
  online: boolean;
  lastSeen: string | null;

  // legacy aliases for backwards compatibility — keep these so older code paths
  // that still read `userId` / `username` / `firstName` / `photoUrl` / `unreadCount`
  // do not break. The new server payload includes both shapes.
  userId?: string;
  username?: string;
  firstName?: string;
  photoUrl?: string | null;
  unreadCount?: number;
}

export function getDmThreads(): Promise<{ success: boolean; threads: MessageThread[] }> {
  return request('/api/webapp/dm/threads');
}

export function getMessageThreads(): Promise<{
  success: boolean;
  threads: MessageThread[];
  count: number;
}> {
  return getDmThreads().then(r => ({ ...r, count: r.threads?.length || 0 }));
}

export function markThreadAsRead(otherUserId: string): Promise<{
  success: boolean;
  message: string;
}> {
  return request(`/api/webapp/messages/thread/${otherUserId}/read`, {
    method: "PUT",
  });
}

// ── DM Thread management (pin / mute / archive / mark-unread) ────────────────

export function pinDmThread(
  partnerId: string
): Promise<{ success: boolean; pinned: boolean; pinnedAt: string | null }> {
  return request(`/api/webapp/dm/thread/${encodeURIComponent(partnerId)}/pin`, { method: 'PUT' });
}

export function muteDmThread(
  partnerId: string,
  untilIso: string | null | 'forever'
): Promise<{ success: boolean; mutedUntil: string | null }> {
  return request(`/api/webapp/dm/thread/${encodeURIComponent(partnerId)}/mute`, { method: 'PUT', body: { untilIso } });
}

export function archiveDmThread(
  partnerId: string
): Promise<{ success: boolean; archived: boolean; archivedAt: string | null }> {
  return request(`/api/webapp/dm/thread/${encodeURIComponent(partnerId)}/archive`, { method: 'PUT' });
}

export function markDmThreadUnread(
  partnerId: string
): Promise<{ success: boolean }> {
  return request(`/api/webapp/dm/thread/${encodeURIComponent(partnerId)}/unread`, { method: 'PUT' });
}

export function pinDmMessage(
  partnerId: string,
  messageId: number | null
): Promise<{ success: boolean; pinnedMessageId: number | null }> {
  return request(`/api/webapp/dm/thread/${encodeURIComponent(partnerId)}/pin-message`, { method: 'PUT', body: { messageId } });
}

// N-07: per-thread read-receipts privacy toggle
export function setDmReadReceipts(
  partnerId: string,
  hide: boolean
): Promise<{ success: boolean; hideReadReceipts: boolean }> {
  return request(`/api/webapp/dm/thread/${encodeURIComponent(partnerId)}/read-receipts`, { method: 'PUT', body: { hide } });
}

// Share a feed post to a DM thread (renders as post_card on the recipient's side)
export function sharePostToDm(
  partnerId: string,
  postId: number,
  note?: string
): Promise<{ success: boolean; messageId: number }> {
  return request(`/api/webapp/dm/thread/${encodeURIComponent(partnerId)}/share-post/${postId}`, {
    method: 'POST',
    body: note?.trim() ? { note: note.trim() } : {},
  });
}

// ── DM Global search ─────────────────────────────────────────────────────────

export interface DmSearchResult {
  id: number;
  partnerId: string;
  partnerName: string;
  partnerPhoto: string | null;
  snippet: string;
  mediaType: 'image' | 'video' | 'audio' | null;
  createdAt: string;
  isMine: boolean;
}

export function searchAllDms(
  q: string
): Promise<{ success: boolean; results: DmSearchResult[] }> {
  return request(`/api/webapp/dm/search?q=${encodeURIComponent(q)}`);
}

// ── DM Forward ───────────────────────────────────────────────────────────────

export function forwardDmMessage(
  messageId: number,
  recipientIds: string[],
  note?: string
): Promise<{ success: boolean; sent: Array<{ recipientId: string; messageId: number }> }> {
  return request('/api/webapp/dm/forward', { method: 'POST', body: { messageId, recipientIds, note } });
}

// ── DM Presence ──────────────────────────────────────────────────────────────

export interface PresenceInfo {
  id: string;
  online: boolean;
  lastSeen: string | null;
}

export function getDmPresence(
  ids: string[]
): Promise<{ success: boolean; presence: PresenceInfo[] }> {
  if (!ids.length) return Promise.resolve({ success: true, presence: [] });
  return request(`/api/webapp/dm/presence?ids=${ids.map(encodeURIComponent).join(',')}`);
}

// ── User picker for new chat (reuses existing searchUsers endpoint) ───────────

export function searchUsersForNewChat(
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
  return searchUsers(q, limit);
}

// ── DM Send with reply support ────────────────────────────────────────────────

export interface SendDmOptions {
  content?: string;
  replyToId?: number | null;
}


// ── DM Telegram-style features ───────────────────────────────────────────────

export function editDmMessage(
  messageId: number,
  content: string
): Promise<{ success: boolean }> {
  return request(`/api/webapp/dm/messages/${messageId}`, {
    method: "PATCH",
    body: { content },
  });
}

export function deleteDmMessage(messageId: number): Promise<{ success: boolean }> {
  return request(`/api/webapp/dm/messages/${messageId}`, { method: "DELETE" });
}



export interface DmVideoCallInvite {
  callId: string;
  roomName: string;
  callLink: string;
  callerId: string;
  calleeId: string;
  expiresAt: string;
  token: string;
  livekitUrl: string;
}

export interface DmVideoCallSession extends DmVideoCallInvite {
  role: "moderator" | "viewer";
}

export function createDmVideoCall(
  partnerId: string
): Promise<{ success: boolean } & DmVideoCallInvite> {
  return request(`/api/webapp/dm/call/start/${encodeURIComponent(partnerId)}`, {
    method: "POST",
  });
}

export function joinDmVideoCall(
  roomName: string
): Promise<{ success: boolean } & DmVideoCallSession> {
  return request("/api/webapp/dm/call/join", {
    method: "POST",
    body: { roomName },
  });
}

// ── DM Message Reactions ─────────────────────────────────────────────────────

export function toggleDmMessageReaction(
  messageId: number,
  emoji: string
): Promise<{ added: boolean; reactions: Array<{ emoji: string; count: number; users: Array<{ id: string; username: string }> }> }> {
  return request(`/api/webapp/dm/messages/${messageId}/react`, {
    method: "POST",
    body: { emoji },
  });
}

// ── Chat Message Reactions ────────────────────────────────────────────────────




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
  offset?: number,
  category?: string
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
  if (offset != null && offset > 0) params.append("offset", offset.toString());
  if (category) params.append("category", category);
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

export interface PlanAddOn {
  id: string;
  name?: string;
  add_on_id?: string;
  duration_days: number | null;
  is_lifetime: boolean;
}

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
  description?: string;
  addOns?: PlanAddOn[];
  priceUSD: number;
  priceCOP: number;
  exchangeRate?: number;
  active: boolean;
  tier?: string;
  isLifetime?: boolean;
}

export function getSubscriptionPlans(): Promise<{
  success: boolean;
  plans: SubscriptionPlan[];
}> {
  return request("/api/subscription/plans");
}

// ── My Access ───────────────────────────────────────────────────────────────
// Structured access map for the user's current entitlements, with channel/
// hangout/creator metadata already joined. Backed by /api/me/access.
export interface MyAccessChannel {
  id: string;
  name: string;
  coverUrl: string | null;
  creatorId: string | null;
  expiresAt: string | null;
  isLifetime: boolean;
  url: string;
}
export interface MyAccessHangout {
  id: string;
  name: string;
  avatarUrl: string | null;
  expiresAt: string | null;
  isLifetime: boolean;
  url: string;
}
export interface MyAccessCreator {
  id: string;
  displayName: string;
  handle: string | null;
  avatarUrl: string | null;
  expiresAt: string | null;
  isLifetime: boolean;
  url: string;
}
export interface MyAccessResponse {
  success: boolean;
  tier: "PRIME" | "BASIC" | "FREE";
  global: {
    primeExpiresAt: string | null;
    primeLifetime: boolean;
    memberExpiresAt: string | null;
    memberLifetime: boolean;
    privateCallCredits: number;
  };
  channels: MyAccessChannel[];
  hangouts: MyAccessHangout[];
  creators: MyAccessCreator[];
}
export function getMyAccess(): Promise<MyAccessResponse> {
  return request("/api/me/access");
}

export function createPayment(
  planId: string,
  provider: "dash" | "nowpayments",
  email?: string,
  promoCode?: string
): Promise<{
  success: boolean;
  paymentUrl: string;
  paymentId: string;
  finalPrice?: number;
  error?: string;
  message?: string;
}> {
  const body: Record<string, string> = { planId, provider };
  if (email) body.email = email;
  if (promoCode) body.promoCode = promoCode;
  return request("/api/webapp/payments/create", {
    method: "POST",
    body,
  });
}

// ─────────────────────────────────────────────────────────────────────────────

export type PromoPricing = {
  originalPrice: number | null;
  discountAmount: number | null;
  finalPrice: number | null;
  basePlan: unknown;
  isAnyPlan?: boolean;
};

export function validatePromoCode(
  code: string,
  planId?: string
): Promise<{
  success: boolean;
  code?: string;
  name?: string;
  description?: string;
  isAnyPlan?: boolean;
  basePlanId?: string;
  discountType?: "percentage" | "fixed_price";
  discountValue?: number;
  pricing?: PromoPricing | null;
  basePlan?: { id: string; name: string; price: number } | null;
  remainingSpots?: number | null;
  validUntil?: string;
  error?: string;
  message?: string;
}> {
  const qs = planId ? `?planId=${encodeURIComponent(planId)}` : "";
  return request(`/api/webapp/promos/${encodeURIComponent(code)}${qs}`);
}


export function initiateCreatorSubscriptionPayment(
  creatorId: string,
  provider: "dash" | "nowpayments",
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

export function purchaseChannelAccess(
  channelId: number,
  provider: 'dash',
  email?: string
): Promise<{ success: boolean; paymentId: string; paymentUrl: string; checkoutUrl: string }> {
  return request(`/api/webapp/channels/${channelId}/purchase`, {
    method: 'POST',
    body: { provider, email },
  });
}

// Purchase access to a standalone paid hangout (not linked to a channel).
// For channel-linked paid hangouts, use purchaseChannelAccess instead —
// channel-access grants cover both the channel and its linked hangout.
export function purchaseHangoutAccess(
  hangoutGroupId: number,
  provider: 'dash',
  email?: string
): Promise<{ success: boolean; paymentId: string; paymentUrl: string; checkoutUrl: string }> {
  return request(`/api/webapp/hangouts/groups/${hangoutGroupId}/purchase`, {
    method: 'POST',
    body: { provider, email },
  });
}

export function createDashSubscription(
  planId: string,
  email?: string,
  creatorId?: string,
): Promise<{
  success: boolean;
  invoiceId: string;
  checkoutUrl: string;
  planName?: string;
  usdAmount?: number;
  error?: string;
}> {
  const body: Record<string, string> = { planId };
  if (email) body.email = email;
  if (creatorId) body.creatorId = creatorId;
  return request("/api/webapp/payments/dash/create", {
    method: "POST",
    body,
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

export function getDashPaymentDetails(
  invoiceId: string
): Promise<{
  success: boolean;
  destination: string;
  amount: string;
  due: string;
  totalDue: string;
  rate: string | null;
  networkFee: string;
  status: string;
  currency: string;
  invoiceAmount: number | null;
}> {
  return request(`/api/webapp/payments/dash/details/${encodeURIComponent(invoiceId)}`);
}

export function createLightningSubscription(
  planId: string,
  email?: string,
  creatorId?: string,
): Promise<{
  success: boolean;
  invoiceId: string;
  checkoutUrl: string;
  planName?: string;
  usdAmount?: number;
  error?: string;
}> {
  const body: Record<string, string> = { planId };
  if (email) body.email = email;
  if (creatorId) body.creatorId = creatorId;
  return request("/api/webapp/payments/lightning/create", {
    method: "POST",
    body,
  });
}

export function getLightningSubscriptionStatus(invoiceId: string): Promise<{
  success: boolean;
  status: string;
  error?: string;
}> {
  return request(`/api/webapp/payments/lightning/status/${encodeURIComponent(invoiceId)}`);
}

export function getLightningAvailable(): Promise<{
  available: boolean;
  configured: boolean;
  reachable: boolean;
  reason?: string;
}> {
  return request("/api/webapp/payments/lightning/available");
}

export function getLightningPaymentDetails(
  invoiceId: string
): Promise<{
  success: boolean;
  bolt11: string;
  amount: string;
  due: string;
  rate: string | null;
  status: string;
  currency: string;
  invoiceAmount: number | null;
}> {
  return request(`/api/webapp/payments/lightning/details/${encodeURIComponent(invoiceId)}`);
}

// BTCPay BTC routes removed — Bitcoin payments use NowPayments via prepareUsdcSubscription
// with payCurrency:'btc', or buyTokensWithNowPayments with payCurrency:'btc'.

export function prepareUsdcSubscription(
  planId: string,
  email?: string,
  creatorId?: string,
): Promise<{
  success: boolean;
  orderId: string;
  usdAmount: number;
  planName: string;
  invoiceUrl: string;
  originalAmount?: number;
  discountPct?: number;
  error?: string;
}> {
  const body: Record<string, string> = { planId };
  if (email) body.email = email;
  if (creatorId) body.creatorId = creatorId;
  return request("/api/webapp/payments/usdc/prepare", { method: "POST", body });
}


export function getUsdcSubscriptionStatus(orderId: string): Promise<{
  success: boolean;
  status: string;
  completed: boolean;
  confirming: boolean;
  failed: boolean;
  partiallyPaid: boolean;
  error?: string;
}> {
  return request(`/api/webapp/payments/usdc/status/${encodeURIComponent(orderId)}`);
}

export function getUsdcAvailable(): Promise<{
  available: boolean;
  configured: boolean;
}> {
  return request("/api/webapp/payments/usdc/available");
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
  attachments?: SupportAttachment[];
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
  message: string,
  attachments?: SupportAttachment[]
): Promise<{ success: boolean }> {
  return request("/api/webapp/support/ticket/message", {
    method: "POST",
    body: { message, attachments: attachments ?? [] },
  });
}

// Cristina AI Payment Verification (admin-only)
export interface PaymentVerificationResult {
  valid: boolean;
  confidence: "high" | "medium" | "low";
  reason: string;
  recommendation: "activate" | "reject" | "manual_review";
  warnings: string[];
}

export interface PaymentVerificationResponse {
  success: boolean;
  analysis: PaymentVerificationResult;
  activation: { success: boolean; granted?: number; errors?: number; warning?: string | null; error?: string } | null;
  error?: string;
}

export function verifyPaymentWithCristina(params: {
  userId: string;
  provider: string;
  reference: string;
  amount: number;
  planId: string;
  notes?: string;
  activate?: boolean;
}): Promise<PaymentVerificationResponse> {
  return request("/api/webapp/support/verify-payment", {
    method: "POST",
    body: params,
  });
}

// Performers (Directus CMS-backed)
export interface FeaturedPerformer {
  id: string;
  userId: string | null;
  slug: string | null;
  displayName: string;
  name?: string;
  bio: string | null;
  photoUrl: string | null;
  isFeatured: boolean;
  isAvailable: boolean;
  basePrice: number;
  totalCalls: number;
  averageRating: number;
  /** True when the performer has an active webapp session (Socket.IO presence). Used for call availability. */
  isOnline?: boolean;
  /** True when the performer's live_channel matches a currently-running Restreamer ingest. Populated by /api/performers/featured. */
  isLive?: boolean;
  /** Direct HLS playback URL, populated when isLive is true. Stripped for unauthenticated viewers. */
  hlsUrl?: string | null;
  live_channel?: string | null;
  city?: string | null;
  country?: string | null;
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
  creatorStatus?: string;
  creatorType?: string;
  eligibleForFullTime?: boolean;
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
  streamRules?: string | null;
  subscriptionPaused?: boolean;
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

// ── Channels ─────────────────────────────────────────────────────────────────

export interface Channel {
  id: string;
  username: string | null;
  displayName: string;
  photoUrl: string | null;
  bio: string | null;
  creatorType: string;
  priceUsd: number;
  subscriberCount: number;
  verified: boolean;
  featured: boolean;
  postCount: number;
  latestMediaUrl: string | null;
  isLive: boolean;
  hlsUrl: string | null;
}

export function getChannels(params?: {
  search?: string;
  type?: string;
  featured?: boolean;
  live?: boolean;
  sort?: "popular" | "newest" | "az";
  page?: number;
  limit?: number;
}): Promise<{
  success: boolean;
  channels: Channel[];
  nextPage: number | null;
  total: number;
}> {
  const qp = new URLSearchParams();
  if (params?.search) qp.set("search", params.search);
  if (params?.type) qp.set("type", params.type);
  if (params?.featured) qp.set("featured", "true");
  if (params?.live) qp.set("live", "true");
  if (params?.sort) qp.set("sort", params.sort);
  if (params?.page !== undefined) qp.set("page", String(params.page));
  if (params?.limit) qp.set("limit", String(params.limit));
  const qs = qp.toString();
  return request(`/api/webapp/channels${qs ? `?${qs}` : ""}`);
}

// ── Creator Channels (named channel entities) ────────────────────────────────

export interface CreatorChannel {
  id: number;
  creatorId: string;
  name: string;
  slug: string;
  description: string | null;
  coverImageUrl: string | null;
  tags: string[];
  isPremium?: boolean;
  featured?: boolean;
  accessType: 'free' | 'prime' | 'subscription' | 'paid';
  priceUsd: number;
  hangoutGroupId: number | null;
  hangoutGroupName?: string | null;
  postCount: number;
  videoCount?: number;
  sortOrder: number;
  createdAt: string;
  creatorName?: string;
  creatorUsername?: string;
  creatorPhotoUrl?: string | null;
  creatorVerified?: boolean;
  collaborators?: string[];
  subscriberCount?: number;
  isSubscribed?: boolean;
  isOwner?: boolean;
  isCollaborator?: boolean;
  telegramChannelId?: string | null;
  bridgeEnabled?: boolean;
}

export function getOwnChannels(): Promise<{ success: boolean; channels: CreatorChannel[] }> {
  return request("/api/webapp/creator/channels");
}

export function createCreatorChannel(data: {
  name: string;
  slug?: string;
  description?: string;
  tags?: string[];
  isPremium?: boolean;
  accessType?: 'free' | 'prime' | 'subscription' | 'paid';
  priceUsd?: number;
  linkedHangoutGroupId?: number | null;
  telegramChannelId?: string | null;
  bridgeEnabled?: boolean;
}): Promise<{ success: boolean; channel: CreatorChannel }> {
  return request("/api/webapp/creator/channels", { method: "POST", body: data });
}

export function updateCreatorChannel(
  id: number,
  data: Partial<{
    name: string;
    slug: string;
    description: string;
    tags: string[];
    isPremium: boolean;
    accessType: 'free' | 'prime' | 'subscription' | 'paid';
    priceUsd: number;
    linkedHangoutGroupId: number | null;
    sortOrder: number;
    coverImageUrl: string;
    telegramChannelId: string | null;
    bridgeEnabled: boolean;
  }>
): Promise<{ success: boolean; channel: CreatorChannel }> {
  return request(`/api/webapp/creator/channels/${id}`, { method: "PATCH", body: data });
}

export function deleteCreatorChannel(id: number): Promise<{ success: boolean }> {
  return request(`/api/webapp/creator/channels/${id}`, { method: "DELETE" });
}

export function getChannelDetail(channelId: number): Promise<{
  success: boolean;
  channel: CreatorChannel;
  posts: SocialPostItem[];
  videos: ChannelVideo[];
  locked: boolean;
}> {
  return request(`/api/webapp/channels/${channelId}`);
}

export function browseCreatorChannels(params?: {
  search?: string;
  page?: number;
  limit?: number;
}): Promise<{ success: boolean; channels: CreatorChannel[]; total: number; nextPage: number | null }> {
  const qp = new URLSearchParams();
  qp.set("view", "channels");
  if (params?.search) qp.set("search", params.search);
  if (params?.page !== undefined) qp.set("page", String(params.page));
  if (params?.limit) qp.set("limit", String(params.limit));
  return request(`/api/webapp/channels?${qp.toString()}`);
}

export function assignPostToChannel(postId: number, channelId: number): Promise<{ success: boolean }> {
  return request(`/api/webapp/social/posts/${postId}/assign-channel`, { method: "POST", body: { channelId } });
}

export function unassignPostFromChannel(postId: number): Promise<{ success: boolean }> {
  return request(`/api/webapp/social/posts/${postId}/assign-channel`, { method: "DELETE" });
}

export async function uploadChannelCover(channelId: number, file: File): Promise<{ success: boolean; coverImageUrl: string }> {
  const formData = new FormData();
  formData.append("cover", file);
  const res = await fetch(`${API_BASE}/api/webapp/creator/channels/${channelId}/cover`, {
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


export function addChannelCollaborator(channelId: number, userId: string): Promise<{ success: boolean; channel: CreatorChannel }> {
  return request(`/api/webapp/creator/channels/${channelId}/collaborators`, { method: "POST", body: { userId } });
}

export function removeChannelCollaborator(channelId: number, userId: string): Promise<{ success: boolean; channel: CreatorChannel }> {
  return request(`/api/webapp/creator/channels/${channelId}/collaborators`, { method: "DELETE", body: { userId } });
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

// ── 18 U.S.C. § 2257 identity verification ───────────────────────────────────

export async function submit2257Identity(formData: FormData): Promise<{
  success: boolean;
  record: { verification_status: string; submitted_at: string };
}> {
  const API_BASE = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");
  const res = await fetch(`${API_BASE}/api/webapp/creator/identity/submit`, {
    method: "POST",
    credentials: "include",
    body: formData, // multipart/form-data with idDocument file
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as Record<string, string>;
    throw new Error(err.message || err.error || "Identity submission failed");
  }
  return res.json();
}

export function get2257Status(): Promise<{
  success: boolean;
  identity_verified: boolean;
  identity_verification_required_by: string | null;
  record: {
    verification_status: "pending" | "approved" | "rejected";
    submitted_at: string;
    admin_notes: string | null;
    resubmission_count: number;
    banned_from_applying_until: string | null;
  } | null;
}> {
  return request("/api/webapp/creator/identity/status");
}

export type SetupItemKey = "identity" | "creator_terms" | "payout" | "profile" | "first_post";
export interface CreatorSetupItem {
  key: SetupItemKey;
  label: string;
  required: boolean;
  done: boolean;
  status: string;
}
export interface CreatorSetupStatus {
  success: boolean;
  completion_pct: number;
  required_done: boolean;
  setup_complete: boolean;
  items: CreatorSetupItem[];
}
export function getCreatorSetupStatus(): Promise<CreatorSetupStatus> {
  return request("/api/webapp/creator/setup/status");
}

// ── Persona hosted-flow identity verification ─────────────────────────────────

export function startPersonaInquiry(): Promise<{
  success: boolean;
  inquiryId: string;
  sessionToken: string | null;
  hostedFlowUrl: string;
}> {
  return request("/api/webapp/creator/identity/persona/start", { method: "POST" });
}

export function getPersonaStatus(): Promise<{
  success: boolean;
  configured: boolean;
  persona_inquiry_id: string | null;
  persona_status: string | null;
}> {
  return request("/api/webapp/creator/identity/persona/status");
}

// ── 18 U.S.C. § 2257 admin endpoints ─────────────────────────────────────────

export interface Record2257 {
  id: string;
  user_id: string;
  username: string;
  first_name: string | null;
  last_name: string | null;
  legal_name: string;
  date_of_birth: string;
  id_type: string;
  id_document_path: string | null;
  verification_status: "pending" | "approved" | "rejected";
  submitted_at: string;
  admin_notes: string | null;
  verified_at: string | null;
  verified_by: string | null;
  ip_address: string | null;
  creator_status: string | null;
  resubmission_count: number;
  banned_from_applying_until: string | null;
}

export function get2257Records(status?: "pending" | "approved" | "rejected"): Promise<{
  success: boolean;
  records: Record2257[];
}> {
  const qs = status ? `?status=${status}` : "";
  return request(`/api/webapp/creator/2257/records${qs}`);
}

export function approve2257Record(userId: string, notes?: string): Promise<{ success: boolean }> {
  return request(`/api/webapp/creator/2257/records/${userId}/approve`, {
    method: "POST",
    body: { notes: notes || "" },
  });
}

export function reject2257Record(userId: string, notes: string): Promise<{ success: boolean }> {
  return request(`/api/webapp/creator/2257/records/${userId}/reject`, {
    method: "POST",
    body: { notes },
  });
}

export async function export2257Records(): Promise<void> {
  const res = await fetch(`${API_BASE}/api/webapp/creator/2257/records/export`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error("Export failed");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `2257-records-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// Full-time applications use /api/apply (existing model_applications flow)

export function getCreatorDashboard(): Promise<{
  success: boolean;
} & CreatorDashboard> {
  return request("/api/webapp/creator/dashboard");
}

// Payout destinations are stored as a per-lane jsonb blob. The 5 supported
// lanes are: meru / btc / dash / usdt_tron / usdt_base. Lane payloads:
//   meru      → { handle: string }
//   others    → { address: string }
export type PayoutLane = "meru" | "btc" | "dash" | "usdt_tron" | "usdt_base";

export type PayoutDestinations = Partial<{
  meru:      { handle:  string };
  btc:       { address: string };
  dash:      { address: string };
  usdt_tron: { address: string };
  usdt_base: { address: string };
}>;

export function getCreatorWallet(): Promise<{
  success: boolean;
  destinations: PayoutDestinations;
  verified: boolean;
  // Legacy mirrors — present for backward compat with the old single-method UI.
  payoutMethod: "dash" | "meru" | "fiat";
  meruAccount: string | null;
  fiatPayoutMethod: string | null;
  fiatPayoutAccount: string | null;
  dashAddress: string | null;
}> {
  return request("/api/webapp/creator/wallet");
}

export function saveCreatorWallet(payload: {
  destinations?: PayoutDestinations;
  // Legacy fields still accepted by the backend and mapped to destinations.*
  payoutMethod?: "dash" | "meru" | "fiat";
  dashAddress?: string;
  meruAccount?: string;
  fiatProvider?: string;
  fiatAccount?: string;
}): Promise<{
  success: boolean;
  destinations?: PayoutDestinations;
  error?: string;
}> {
  return request("/api/webapp/creator/wallet", { method: "POST", body: payload });
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
): Promise<{ success: boolean; applications: CreatorApplication[]; statusCounts?: Record<string, number> }> {
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
  creator_status: "active" | "suspended" | "pending_review" | "eligible";
  creator_strikes: number;
  creator_subscriber_count: number;
  creator_price_usd: string | null;
  creator_locked: boolean;
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
  legalName: string;
  dateOfBirth: string;
  idType: string;
}): Promise<{ success: boolean; submitted: boolean; tier: string; status: string }> {
  const formData = new FormData();
  formData.append("tier", data.tier);
  formData.append("paymentMethod", data.paymentMethod);
  formData.append("paymentAddress", data.paymentAddress);
  formData.append("paymentNetwork", data.paymentNetwork);
  formData.append("signatureData", data.signatureData);
  formData.append("idDocument", data.idDocument);
  formData.append("legalName", data.legalName);
  formData.append("dateOfBirth", data.dateOfBirth);
  formData.append("idType", data.idType);

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

// ── Creator Panel: Subscribers ───────────────────────────────────────────────

export function getCreatorMySubscribers(page = 1): Promise<{
  success: boolean;
  subscribers: Array<{
    id: string;
    subscriber_username: string;
    subscriber_first_name: string;
    subscriber_avatar: string | null;
    started_at: string;
    expires_at: string;
    status: string;
    price_usd: number;
    auto_renew: boolean;
    revenue: number;
  }>;
  stats: {
    active_count: number;
    total_count: number;
    new_this_month: number;
    churn_rate: number;
  };
  pagination: { page: number; limit: number; total: number; totalPages: number };
}> {
  return request(`/api/webapp/creator/subscribers?page=${page}`);
}

// ── Creator Panel: Consents ──────────────────────────────────────────────────

export function getCreatorConsents(): Promise<{
  success: boolean;
  userId?: string | number;
  consents: {
    // Generic platform consents
    terms_accepted: boolean;
    privacy_accepted: boolean;
    privacy_accepted_at: string | null;
    privacy_accepted_ip: string | null;
    age_verified: boolean;
    age_verified_at: string | null;
    wof_photo_consent: boolean;
    content_disclaimer: boolean;
    content_disclaimer_accepted_at: string | null;
    created_at: string;
    // Payout configuration (non-secret summaries only)
    fiat_payout_method: string | null;
    wallet_address_set: boolean;
    creator_wallet_verified: boolean;
    // Latest model/creator application (null when no application submitted)
    application_id: string | null;
    application_type: "live" | "content_creator" | "both" | null;
    application_status: "pending" | "approved" | "rejected" | "withdrawn" | null;
    application_created_at: string | null;
    stage_name: string | null;
    legal_full_name: string | null;
    date_of_birth: string | null;
    country: string | null;
    city_state: string | null;
    id_front_submitted: boolean;
    id_back_submitted: boolean;
    creator_terms_agreed: boolean;
    creator_terms_version: string | null;
    creator_terms_agreed_at: string | null;
    call_scheduled: boolean;
    call_scheduled_at: string | null;
  };
}> {
  return request("/api/webapp/creator/consents");
}

export function acceptCreatorPrivacyPolicy(): Promise<{ success: boolean }> {
  return request("/api/webapp/creator/privacy/accept", { method: "POST" });
}

export function acceptCreatorTerms(): Promise<{ success: boolean }> {
  return request("/api/webapp/creator/terms/accept", { method: "POST" });
}

// ── Creator Panel: X Account & Campaigns ─────────────────────────────────────

export function getCreatorXAccount(): Promise<{
  success: boolean;
  account: { account_id: string; handle: string; display_name: string } | null;
}> {
  return request("/api/webapp/creator/x-account");
}

export function startCreatorXOAuth(): Promise<{ success: boolean; url: string }> {
  return request("/api/creator/x/oauth/start");
}

export function getCreatorXCampaigns(): Promise<{
  success: boolean;
  campaigns: XAutoCampaign[];
  campaignLimit: number;
}> {
  return request("/api/webapp/creator/x-campaigns");
}

export function createCreatorXCampaign(data: {
  name: string;
  accountId: string;
  topic: string;
  grokMode?: string;
  language?: string;
  intervalMinutes?: number;
  activeHoursStart?: number;
  activeHoursEnd?: number;
}): Promise<{ success: boolean; campaignId: string }> {
  return request("/api/webapp/creator/x-campaigns", { method: "POST", body: data });
}

export function updateCreatorXCampaign(id: string, data: Record<string, unknown>): Promise<{ success: boolean }> {
  return request(`/api/webapp/creator/x-campaigns/${id}`, { method: "PUT", body: data });
}

export function pauseCreatorXCampaign(id: string): Promise<{ success: boolean }> {
  return request(`/api/webapp/creator/x-campaigns/${id}/pause`, { method: "POST" });
}

export function resumeCreatorXCampaign(id: string): Promise<{ success: boolean }> {
  return request(`/api/webapp/creator/x-campaigns/${id}/resume`, { method: "POST" });
}

export function deleteCreatorXCampaign(id: string): Promise<{ success: boolean }> {
  return request(`/api/webapp/creator/x-campaigns/${id}`, { method: "DELETE" });
}

export function getCreatorXCampaignHistory(id: string, page = 1): Promise<{
  success: boolean;
  posts: XAutoCampaignPost[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}> {
  return request(`/api/webapp/creator/x-campaigns/${id}/history?page=${page}`);
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
  method = "bank_transfer",
  paymentDetails: Record<string, string> = {}
): Promise<{
  success: boolean;
  data: { withdrawal: ModelWithdrawal; earningsCount: number };
}> {
  return request("/api/model/withdrawal/request", {
    method: "POST",
    body: { method, paymentDetails },
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

export function getXLoginUrl(): string {
  const base = import.meta.env.VITE_API_URL || "https://pnptv.app";
  return `${base}/api/webapp/auth/x/start?redirect=true`;
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
  persona_type?: "santino" | "lex" | "generic";
  consecutive_failures?: number;
  paused_reason?: string;
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
  personaType?: "santino" | "lex" | "generic";
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

export function previewAdminXCampaign(id: string): Promise<{ success: boolean; options: string[] }> {
  return request(`/api/webapp/admin/x-campaigns/${id}/preview`, { method: "POST" });
}

export function duplicateAdminXCampaign(id: string): Promise<{ success: boolean; campaignId: string }> {
  return request(`/api/webapp/admin/x-campaigns/${id}/duplicate`, { method: "POST" });
}

export function deleteXAccountPosts(
  accountId: string,
  timeRange: "24h" | "7d" | "all"
): Promise<{ success: boolean; jobId: string }> {
  return request(`/api/webapp/admin/x-campaigns/accounts/${accountId}/delete-posts`, {
    method: "POST",
    body: { timeRange },
  });
}

export function getXDeleteJobStatus(jobId: string): Promise<{
  success: boolean;
  status: "running" | "completed" | "failed";
  total: number;
  deleted: number;
  failed: number;
  errors: string[];
  rateLimited?: boolean;
  retryAfter?: number;
}> {
  return request(`/api/webapp/admin/x-campaigns/delete-jobs/${jobId}`);
}

export function startXOAuth(adminId?: number, adminUsername?: string): Promise<{ success: boolean; url: string }> {
  const params = new URLSearchParams();
  if (adminId) params.set("admin_id", String(adminId));
  if (adminUsername) params.set("admin_username", adminUsername);
  const qs = params.toString();
  return request(`/api/admin/x/oauth/start${qs ? `?${qs}` : ""}`);
}

export function startXOAuth1(app?: string): Promise<{ success: boolean; url: string }> {
  const qs = app ? `?app=${encodeURIComponent(app)}` : "";
  return request(`/api/admin/x/oauth/1a/start${qs}`);
}

// ============================================================================
// Admin API
// ============================================================================

export interface AdminStats {
  totalUsers: number;
  appUsers: number;
  activeAppUsers: number;
  linkedAppUsers: number;
  authentikUsers: number;
  orphanAuthentikIdentities: number;
  appUsersMissingAuthentikIdentity: number;
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
  photo_file_id?: string | null;
  bio?: string;
  role: string;
  tier: string;
  label?: 'PRIME' | 'BASIC' | 'FREE';
  subscription_status: string;
  subscription_plan?: string;
  plan_expiry?: string;
  created_at: string;
  last_payment_date?: string;
  last_payment_method?: string;
  last_payment_amount?: number;
  last_login_at?: string;
  last_login_method?: string;
  last_active?: string;
  telegram?: string;
  twitter?: string;
  x_username?: string;
  pnptv_id?: string;
  language?: string;
  location_name?: string;
  phone_number?: string;
  // Creator / Live Performer fields
  creator_status?: string;
  creator_type?: string;
  /** Capability flag granted to approved creators: 'creator' = exclusive paid content (Ice/Crystal/Diamond tiers); 'performer' = PNP Live; 'both' = both. */
  creator_role?: CreatorRole | null;
  /** True when an approved creator is temporarily blocked from using tools pending onboarding. */
  creator_locked?: boolean;
  creator_price_usd?: number;
  live_channel?: string;
}

export interface AdminPayment {
  id: string;
  payment_method: string;
  amount: number;
  currency: string;
  plan_id?: string;
  plan_name?: string;
  product?: string;
  payment_reference: string;
  provider_transaction_id?: string;
  status: string;
  payment_date: string;
  metadata?: Record<string, unknown>;
}

export interface PlanAddOnEntry {
  id: string;
  add_on_id: string;
  name: string;
  duration_days: number | null;
  is_lifetime: boolean;
}

export interface AdminPlan {
  id: string;
  sku?: string;
  name: string;
  display_name: string;
  tier: string;
  price: number;
  currency: string;
  duration: number;
  duration_days?: number;
  description?: string;
  features: string[];
  active: boolean;
  is_lifetime?: boolean;
  add_ons?: PlanAddOnEntry[];
  created_at?: string;
  updated_at?: string;
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
  description: string;
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

// Use Tracker — private harm-reduction log
export interface UseTypeStats {
  lastAt: string | null;
  today: number;
  week: number;
  month: number;
  recentDays: boolean[]; // 30 entries, index 0 = today, index 29 = 29 days ago
}

export interface UseTrackerData {
  slam: UseTypeStats;
  smoke: UseTypeStats;
}

export function getUseStats(): Promise<{ success: boolean } & UseTrackerData> {
  return request("/api/webapp/use-tracker");
}

export function logUse(type: "slam" | "smoke"): Promise<{ success: boolean } & UseTrackerData> {
  return request("/api/webapp/use-tracker/log", {
    method: "POST",
    body: JSON.stringify({ type }),
  });
}

// Wellness Mode — self-imposed access restriction
export interface WellnessModeStatus {
  active: boolean;
  until: string | null;          // ISO timestamp; null when indefinite or off
  indefinite: boolean;
  disableRequestedAt: string | null;
  hoursLeftUntilDisableAllowed: number | null;
  coolingOffHours?: number;
  wellnessDaysAccumulated?: number;
}

export interface WellnessHangout {
  id: number;
  name: string;
  description: string;
  avatar_url: string | null;
  is_public: boolean;
  is_paid: boolean;
  member_count: number;
  created_at: string;
}

export function getWellnessMode(): Promise<{ success: boolean } & WellnessModeStatus> {
  return request("/api/webapp/wellness-mode");
}

export function enableWellnessMode(durationDays: 1 | 7 | 30 | null): Promise<{ success: boolean } & WellnessModeStatus> {
  return request("/api/webapp/wellness-mode/enable", {
    method: "POST",
    body: JSON.stringify({ durationDays }),
  });
}

export function disableWellnessMode(): Promise<{ success: boolean } & WellnessModeStatus> {
  return request("/api/webapp/wellness-mode/disable", { method: "POST" });
}

export function cancelDisableWellnessMode(): Promise<{ success: boolean } & WellnessModeStatus> {
  return request("/api/webapp/wellness-mode/cancel-disable", { method: "POST" });
}

export function getWellnessHangouts(): Promise<{ success: boolean; groups: WellnessHangout[] }> {
  return request("/api/webapp/hangouts/wellness");
}

// Admin Payment Health (operational dashboard)
export interface PaymentHealthStuckPayment {
  id?: string;
  code?: string;
  user_id?: string;
  plan_id?: string;
  amount?: string | number;
  currency?: string;
  reference?: string;
  reserved_for_email?: string | null;
  reserved_for_user_id?: string | null;
  btcpay_invoice_id?: string;
  usd_amount?: string | number;
  created_at: string;
  hours_pending?: number;
  hours_since_create?: number;
  minutes_pending?: number;
  status?: string;
}

export interface PaymentHealthLeak {
  media_url: string;
  distinct_users: string | number;
  distinct_ips: string | number;
  total_fetches: string | number;
  last_fetched: string;
}

export interface PaymentHealth {
  success: boolean;
  stuck: {
    meru: { count: number; items: PaymentHealthStuckPayment[] };
    dash: { count: number; items: PaymentHealthStuckPayment[] };
    nowpayments: { count: number; items: PaymentHealthStuckPayment[] };
  };
  leaks: { count: number; items: PaymentHealthLeak[] };
  activity: {
    dash_completed_7d?: string | number;
    meru_completed_7d?: string | number;
    video_views_7d?: string | number;
    distinct_videos_7d?: string | number;
  };
  generated_at: string;
}

export function getPaymentHealth(): Promise<PaymentHealth> {
  return request("/api/webapp/admin/payment-health");
}

export interface HangoutTelegramHealthItem {
  groupId: number;
  groupName: string;
  telegramChatId: string;
  telegramInviteLink: string | null;
  status: "ok" | "stale" | "error" | "unknown";
  chatType: string | null;
  telegramTitle: string | null;
  error: string | null;
}

export interface HangoutTelegramHealth {
  success: boolean;
  checkedAt: string;
  summary: {
    totalLinked: number;
    ok: number;
    stale: number;
    missingInviteLink: number;
    telegramConfigured: boolean;
  };
  items: HangoutTelegramHealthItem[];
  error?: string;
}

export function getHangoutTelegramHealth(): Promise<HangoutTelegramHealth> {
  return request("/api/webapp/admin/hangout-telegram-health");
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
    xLinked: number;
  };
  insights: { type: string; title: string; body: string }[];
}
export function getAdminDemographics(): Promise<{ success: boolean; demographics: AdminDemographics }> {
  return request("/api/webapp/admin/demographics");
}

// Admin Users
export interface AdminUserFilters {
  tier?: string;
  status?: string;
  plan?: string;
  role?: string;
  /** 'linked' | 'unlinked' */
  telegram?: string;
  /** Exact email match (case-insensitive) */
  emailFilter?: string;
}

export function getAdminUsers(
  page = 1,
  search = "",
  filters?: AdminUserFilters
): Promise<{ success: boolean; users: AdminUser[]; pagination: { page: number; limit: number; total: number; totalPages: number } }> {
  const params = new URLSearchParams({ page: String(page) });
  if (search) params.set("search", search);
  if (filters?.tier) params.set("tier", filters.tier);
  if (filters?.status) params.set("status", filters.status);
  if (filters?.plan) params.set("plan", filters.plan);
  if (filters?.role) params.set("role", filters.role);
  if (filters?.telegram) params.set("telegram", filters.telegram);
  if (filters?.emailFilter) params.set("emailFilter", filters.emailFilter);
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

export function deleteAdminUser(
  id: string
): Promise<{ success: boolean; message: string }> {
  return request(`/api/webapp/admin/users/${id}`, { method: "DELETE" });
}

export function banAdminUser(
  id: string,
  ban: boolean,
  reason?: string
): Promise<{ success: boolean; user: AdminUser; action: string }> {
  return request(`/api/webapp/admin/users/${id}/ban`, { method: "POST", body: { ban, reason } });
}

export function setCreatorLock(
  id: string,
  locked: boolean
): Promise<{ success: boolean; user: { id: string; username: string; creator_status: string; creator_locked: boolean } }> {
  return request(`/api/webapp/admin/users/${id}/creator-lock`, { method: "POST", body: { locked } });
}

export function bulkUpdateMemberships(
  userIds: string[],
  action: "upgrade" | "downgrade" | "ban" | "unban" | "delete",
  planId?: string,
  expiry?: string
): Promise<{ success: boolean; updated: number; failed: number; errors: string[] }> {
  return request("/api/webapp/admin/users/bulk-update", {
    method: "POST",
    body: { userIds, action, planId, expiry },
  });
}

export function getAdminUserPayments(
  id: string,
  page = 1
): Promise<{ success: boolean; payments: AdminPayment[]; pagination: { page: number; limit: number; total: number; totalPages: number } }> {
  return request(`/api/webapp/admin/users/${id}/payments?page=${page}`);
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
export function getAdminPlans(opts?: { includeInactive?: boolean }): Promise<{ success: boolean; plans: AdminPlan[] }> {
  const qs = opts?.includeInactive ? "?includeInactive=true" : "";
  return request(`/api/webapp/admin/plans${qs}`);
}

/**
 * Assign a plan to a user in one shot. Grants every entitlement defined by
 * the plan (with the right duration), runs the prime → pnp-member cascade,
 * syncs users.tier + subscription_status + plan_id + plan_expiry. Returns
 * the fresh user row.
 */
export function assignAdminUserPlan(
  userId: string,
  planId: string
): Promise<{
  success: boolean;
  user: AdminUser;
  plan: { id: string; displayName: string; tier: string };
  grantResult: { granted: number; errors: number; warning?: string };
}> {
  return request(`/api/webapp/admin/users/${userId}/assign-plan`, {
    method: "POST",
    body: { planId },
  });
}

export function createAdminPlan(
  plan: {
    name: string;
    price: number;
    add_ons: { add_on_id: string; duration_days?: number; is_lifetime?: boolean }[];
    display_name?: string;
    is_active?: boolean;
    id?: string;
  }
): Promise<{ success: boolean; plan: AdminPlan }> {
  return request("/api/webapp/admin/plans", { method: "POST", body: plan });
}

export function updateAdminPlan(
  id: string,
  plan: {
    name?: string;
    price?: number;
    add_ons?: { add_on_id: string; duration_days?: number; is_lifetime?: boolean }[];
    display_name?: string;
    is_active?: boolean;
  }
): Promise<{ success: boolean }> {
  return request(`/api/webapp/admin/plans/${id}`, { method: "PUT", body: plan });
}

export function deleteAdminPlan(id: string): Promise<{ success: boolean; message: string }> {
  return request(`/api/webapp/admin/plans/${id}`, { method: "DELETE" });
}

// Admin Plan Add-Ons
export interface AddOn {
  id: string;
  name: string;
  ui_description?: string;
  features?: string[];
}

export interface AdminPlanAddOn {
  add_on_id: string;
  name: string;
  duration_days: number | null;
  is_lifetime: boolean;
}

export function getAddOns(): Promise<{ success: boolean; addOns: AddOn[] }> {
  return request("/api/webapp/admin/add-ons");
}



/** Convenience alias — same as getAdminPlans */
export const listAdminPlans = getAdminPlans;

/** Named add-on identifiers used by the plan builder UI */
export interface PlanAddOnConfig {
  add_on_id: 'pnp-member' | 'prime' | 'creator-subscription' | 'private-calls';
  duration_days?: number;
  is_lifetime?: boolean;
}

/** Payload shape for the plan builder quick-create flow */
export interface CreatePlanPayload {
  name: string;
  price_usd: number;
  add_ons: PlanAddOnConfig[];
}

// Admin User Entitlements

export interface AdminEntitlement {
  id: number;
  add_on_id: string;
  add_on_name: string;
  is_lifetime: boolean;
  is_consumed: boolean;
  expires_at: string | null;
  granted_by_plan: string | null;
  source: string | null;
  created_at: string;
}

export interface EntitlementAuditEntry {
  id: number;
  action: string;
  details: unknown;
  created_at: string;
}

export function getAdminUserEntitlements(userId: string): Promise<{
  success: boolean;
  entitlements: AdminEntitlement[];
  auditLog: EntitlementAuditEntry[];
}> {
  return request(`/api/webapp/admin/users/${userId}/entitlements`);
}

export function grantAdminUserEntitlement(
  userId: string,
  data: { addOnId: string; durationDays?: number; isLifetime?: boolean; reason?: string; resourceId?: string }
): Promise<{ success: boolean }> {
  return request(`/api/webapp/admin/users/${userId}/entitlements`, {
    method: "POST",
    body: data,
  });
}

// Resource picker for the scoped-entitlement admin form.
export interface AdminResourceResult {
  id: string;
  name: string;
  thumbnailUrl: string | null;
  creatorId?: string | null;
  accessType?: string | null;
  priceUsd?: number | null;
  isPaid?: boolean | null;
  handle?: string | null;
}
export function searchAdminResources(
  kind: "channel" | "hangout" | "creator",
  q: string
): Promise<{ success: boolean; kind: string; results: AdminResourceResult[] }> {
  const params = new URLSearchParams({ kind, q });
  return request(`/api/webapp/admin/resources?${params.toString()}`);
}

export function revokeAdminUserEntitlement(
  userId: string,
  addOnId: string
): Promise<{ success: boolean }> {
  return request(`/api/webapp/admin/users/${userId}/entitlements/${addOnId}`, {
    method: "DELETE",
  });
}

export function extendAdminUserEntitlement(
  userId: string,
  addOnId: string,
  data: { extraDays: number; reason?: string }
): Promise<{ success: boolean }> {
  return request(`/api/webapp/admin/users/${userId}/entitlements/${addOnId}/extend`, {
    method: "PUT",
    body: data,
  });
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
  channels?: string[];
}): Promise<{ success: boolean; sent: number; botDmSent: number; emailSent: number; message: string }> {
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

export type RevenueReportGroupBy = "day" | "week" | "month" | "method";

export interface AdminRevenueReport {
  period: { start: string; end: string };
  groupedBy: RevenueReportGroupBy;
  rows: Array<{
    period: string;
    transaction_count: number;
    unique_payers: number;
    total_revenue: number;
    avg_transaction: number;
    min_transaction: number;
    max_transaction: number;
    completed_count: number;
    failed_count: number;
    pending_count: number;
  }>;
  totals?: Record<string, unknown>;
}

export function getAdminRevenueReport(params?: {
  startDate?: string | Date;
  endDate?: string | Date;
  groupBy?: RevenueReportGroupBy;
}): Promise<{ success: boolean; report: AdminRevenueReport; error?: string }> {
  const qs = new URLSearchParams();
  if (params?.startDate) qs.set("startDate", params.startDate instanceof Date ? params.startDate.toISOString() : params.startDate);
  if (params?.endDate)   qs.set("endDate",   params.endDate   instanceof Date ? params.endDate.toISOString()   : params.endDate);
  if (params?.groupBy)   qs.set("groupBy",   params.groupBy);
  const q = qs.toString();
  return request(`/api/webapp/admin/revenue-report${q ? `?${q}` : ""}`);
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
  id: number;
  badge_id: number;
  slug: string;
  name_en: string;
  name_es: string;
  description_en?: string | null;
  description_es?: string | null;
  icon: string;
  level: number;
  awarded_at: string;
  note: string | null;
  category_slug: string;
  category_name_en: string;
  category_name_es: string;
  category_icon: string;
}

export function getGamificationCategories(): Promise<{ success: boolean; categories: GamificationCategory[] }> {
  return request("/api/webapp/gamification/categories");
}

export function getUserGamificationBadges(userId: string): Promise<{ success: boolean; badges: UserBadgeEntry[] }> {
  return request(`/api/webapp/gamification/user/${encodeURIComponent(userId)}/badges`);
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

export interface AdminSupportTicket {
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

export interface SupportAttachment {
  url: string;
  name: string;
  type: string;
  size?: number;
}

export interface SupportMessage {
  id: number;
  content: string;
  senderRole: "user" | "agent" | "admin";
  senderName: string | null;
  createdAt: string;
  attachments?: SupportAttachment[];
}

export function getAdminSupportStats(): Promise<{ success: boolean; stats: SupportStats }> {
  return request("/api/webapp/admin/support/stats");
}

export function getAdminSupportTickets(
  params: Record<string, string>
): Promise<{ success: boolean; tickets: AdminSupportTicket[]; hasMore: boolean; total: number }> {
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
  content: string,
  attachments?: SupportAttachment[]
): Promise<{ success: boolean; message: SupportMessage }> {
  return request(`/api/webapp/admin/support/tickets/${userId}/reply`, {
    method: "POST",
    body: { content, attachments: attachments ?? [] },
  });
}

export function updateAdminTicket(
  userId: string,
  data: Record<string, string>
): Promise<{ success: boolean; ticket: AdminSupportTicket }> {
  return request(`/api/webapp/admin/support/tickets/${userId}`, {
    method: "PATCH",
    body: data,
  });
}

export async function uploadSupportAttachment(files: FileList | File[]): Promise<SupportAttachment[]> {
  const fd = new FormData();
  Array.from(files).forEach((f) => fd.append("files", f));
  const res = await fetch(`${API_BASE}/api/webapp/support/ticket/upload`, {
    method: "POST",
    credentials: "include",
    body: fd,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `Upload failed (${res.status})`);
  }
  const data = await res.json();
  return data.attachments as SupportAttachment[];
}

export function adminAssignUserPlan(
  userId: string,
  planId: string
): Promise<{ success: boolean; user?: object; plan?: { id: string; displayName: string; tier: string }; error?: string }> {
  return request(`/api/webapp/admin/users/${userId}/assign-plan`, {
    method: "POST",
    body: { planId },
  });
}

export function adminGrantUserEntitlement(
  userId: string,
  addOnId: string,
  opts: { durationDays?: number; isLifetime?: boolean; reason?: string }
): Promise<{ success: boolean; error?: string }> {
  return request(`/api/webapp/admin/users/${userId}/entitlements`, {
    method: "POST",
    body: { addOnId, ...opts },
  });
}

// Live Rules Acknowledgment Gate

export function getLiveRulesStatus(channelRef?: string | null): Promise<{
  success: boolean;
  acknowledged: boolean;
  version: number;
  creatorRules: string | null;
  creatorName: string | null;
}> {
  const qs = channelRef ? `?channelRef=${encodeURIComponent(channelRef)}` : "";
  return request(`/api/webapp/live/rules-status${qs}`);
}

export function acknowledgeLiveRules(): Promise<{ success: boolean }> {
  return request("/api/webapp/live/acknowledge-rules", { method: "POST" });
}

export function toggleCreatorSubscription(): Promise<{ success: boolean; subscriptionPaused: boolean; error?: string }> {
  return request("/api/webapp/creator/toggle-subscription", { method: "POST" });
}

export function saveStreamRules(rules: string): Promise<{ success: boolean; rules: string | null; error?: string }> {
  return request("/api/webapp/live/stream-rules", {
    method: "POST",
    body: { rules },
  });
}

// ---------------------------------------------------------------------------
// Entitlement-derived label utilities
// ---------------------------------------------------------------------------

/**
 * Resolve a display label from the entitlement-derived `label` field (preferred)
 * or fall back to the legacy `tier` column for backward compatibility.
 */
export function getUserLabel(user: { tier?: string; label?: string }): 'PRIME' | 'BASIC' | 'FREE' {
  if (user.label === 'PRIME' || user.label === 'BASIC' || user.label === 'FREE') {
    return user.label;
  }
  const t = (user.tier || '').toLowerCase();
  if (t === 'prime' || t === 'creator') return 'PRIME';
  if (t === 'member') return 'BASIC';
  return 'FREE';
}

/**
 * Return Tailwind classes for rendering a label badge consistently.
 * Uses only preset `pnp-*` tokens plus standard Tailwind amber/blue utilities.
 */
export function getLabelColor(label: string): string {
  switch (label) {
    case 'PRIME': return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
    case 'BASIC': return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
    default:      return 'bg-pnp-surfaceHover/60 text-pnp-textSecondary border-pnp-border';
  }
}

// ─── Creator Subscription Admin ───────────────────────────────────────────────

export interface CreatorSubscriptionSummary {
  creator_id: string;
  creator_username: string;
  creator_first_name: string;
  creator_avatar: string | null;
  creator_type: string | null;
  creator_price_usd: number;
  active_subscribers: number;
  total_revenue: number;
  total_creator_earnings: number;
  pending_payout: number;
}

export interface SubscriptionDetail {
  id: string;
  subscriber_id: string;
  subscriber_username: string;
  subscriber_first_name: string;
  subscriber_avatar: string | null;
  started_at: string;
  expires_at: string;
  status: "active" | "cancelled" | "expired";
  price_usd: number;
  auto_renew: boolean;
  revenue: number;
}

export interface MonthlyRevenueRow {
  month: string;
  gross: number;
  creator_share: number;
  platform_share: number;
  subscription_count: number;
  pending_amount?: number;
  active_creators?: number;
}

export interface CreatorPayoutSummary {
  pending_total: number;
  paid_total: number;
  pending_count: number;
}

export interface CreatorDetailAdmin {
  id: string;
  username: string;
  first_name: string;
  avatar_url: string | null;
  creator_type: string | null;
  creator_price_usd: number;
  creator_subscriber_count: number;
  creator_dash_address: string | null;
  payout_method: string | null;
  email: string | null;
}

export interface PlatformPayoutSummary {
  total_pending: number;
  paid_this_month: number;
  creators_with_pending: number;
  total_gross_all_time: number;
  total_platform_revenue: number;
}

export function getCreatorSubscriptions(): Promise<{
  success: boolean;
  creators: CreatorSubscriptionSummary[];
}> {
  return request("/api/webapp/admin/creator-subscriptions");
}

export function getCreatorSubscriptionDetail(creatorId: string): Promise<{
  success: boolean;
  creator: CreatorDetailAdmin;
  subscriptions: SubscriptionDetail[];
  monthlyRevenue: MonthlyRevenueRow[];
  payoutSummary: CreatorPayoutSummary;
}> {
  return request(`/api/webapp/admin/creator-subscriptions/${creatorId}`);
}

export function getCreatorSubscriptionPlatformSummary(): Promise<{
  success: boolean;
  summary: PlatformPayoutSummary;
  monthlyRevenue: MonthlyRevenueRow[];
}> {
  return request("/api/webapp/admin/creator-subscriptions/summary");
}

export function processCreatorPayout(creatorId: string): Promise<{
  success: boolean;
  amount: number;
  earningsCount: number;
  creator: string;
  method: string;
  walletAddress: string | null;
  message?: string;
}> {
  return request(`/api/webapp/admin/creator-subscriptions/${creatorId}/payout`, {
    method: "POST",
  });
}

export function processAllPayouts(): Promise<{
  success: boolean;
  creatorsCount: number;
  totalAmount: number;
  payouts: Array<{ creatorId: string; creatorUsername: string; amount: number }>;
  message?: string;
}> {
  return request("/api/webapp/admin/creator-subscriptions/payouts/process-all", {
    method: "POST",
  });
}

export function adminCancelCreatorSubscription(
  creatorId: string,
  subscriptionId: string
): Promise<{ success: boolean; message: string }> {
  return request(
    `/api/webapp/admin/creator-subscriptions/${creatorId}/subscriptions/${subscriptionId}/cancel`,
    { method: "POST" }
  );
}

export function adminExtendCreatorSubscription(
  creatorId: string,
  subscriptionId: string,
  days: number
): Promise<{ success: boolean; newExpiresAt: string }> {
  return request(
    `/api/webapp/admin/creator-subscriptions/${creatorId}/subscriptions/${subscriptionId}/extend`,
    { method: "POST", body: { days } }
  );
}

// ─── Overlay Asset Direct Upload ─────────────────────────────────────────────

export interface UploadedOverlayAsset {
  success: boolean;
  url: string;
  name: string;
  type: "logo" | "banner";
  filename: string;
}

export interface LocalOverlayAsset {
  name: string;
  url: string;
  size: number;
  modified: string;
  type: "logo" | "banner";
}

export async function uploadOverlayAsset(
  type: "logo" | "banner",
  file: File
): Promise<UploadedOverlayAsset> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("type", type);

  const res = await fetch(`${API_BASE}/api/webapp/admin/overlay-assets/upload`, {
    method: "POST",
    credentials: "include",
    body: formData,
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error || `Upload failed (${res.status})`);
  }

  return res.json();
}

export function getOverlayAssets(
  type?: "logo" | "banner"
): Promise<{ success: boolean; assets: LocalOverlayAsset[] }> {
  const params = type ? `?type=${type}` : "";
  return request(`/api/webapp/admin/overlay-assets${params}`);
}

export function deleteOverlayAsset(
  type: "logos" | "banners",
  filename: string
): Promise<{ success: boolean }> {
  return request(
    `/api/webapp/admin/overlay-assets/${type}/${encodeURIComponent(filename)}`,
    { method: "DELETE" }
  );
}

// ─── Media Library Video Management ──────────────────────────────────────────

export interface MediaLibraryVideo {
  id: string;
  title: string;
  artist: string;
  url: string;
  type: string;
  category: string;
  cover_url: string | null;
  duration: number;
  is_prime: boolean;
  is_public: boolean;
  created_at: string;
  updated_at: string;
}




/**
 * Allowed hostnames for payment redirect URLs.  Any checkout link returned by
 * the backend MUST belong to one of these domains (or a subdomain), otherwise
 * the client refuses to navigate — preventing open-redirect & phishing attacks.
 */
const ALLOWED_PAYMENT_HOSTS = [
  "pnptv.app",
  "app.pnptv.app",
  "btcpay.pnptv.app",
  "nowpayments.io",
];

function isAllowedPaymentHost(hostname: string): boolean {
  return ALLOWED_PAYMENT_HOSTS.some(
    (h) => hostname === h || hostname.endsWith(`.${h}`),
  );
}

/**
 * Validates that a payment redirect URL is an absolute HTTPS URL on a trusted
 * domain before the caller navigates to it.  Throws if the value is missing,
 * uses a disallowed scheme, or targets an untrusted host.
 */
export function assertPaymentUrl(url: unknown): string {
  if (typeof url !== "string" || !url.startsWith("https://")) {
    throw new Error("Invalid payment URL — must be https://");
  }
  try {
    const parsed = new URL(url);
    if (!isAllowedPaymentHost(parsed.hostname)) {
      throw new Error("Untrusted payment domain");
    }
  } catch (e) {
    if (e instanceof Error && e.message === "Untrusted payment domain") throw e;
    throw new Error("Invalid payment URL — malformed");
  }
  return url;
}

// ─── Events ──────────────────────────────────────────────────────────────────

export interface EventItem {
  id: string;
  type: "live_stream" | "hangout_event";
  title: string;
  description?: string;
  coverImage?: string;
  scheduledAt: string;
  durationMinutes: number;
  status: "upcoming" | "live" | "ended" | "cancelled";
  isFeatured: boolean;
  maxAttendees?: number;
  rsvpCount: number;
  userRsvpd: boolean;
  creatorId: string;
  creatorName?: string;
  creatorUsername?: string | null;
  creatorPhoto?: string;
  hangoutGroupId?: number | null;
  tags?: string[];
}

export function getUpcomingEvents(params?: {
  type?: "live_stream" | "hangout_event";
  limit?: number;
  hangoutGroupId?: number;
}): Promise<{ success: boolean; events: EventItem[] }> {
  const qs = new URLSearchParams();
  if (params?.type) qs.set("type", params.type);
  if (params?.limit) qs.set("limit", String(params.limit));
  if (params?.hangoutGroupId) qs.set("hangout_group_id", String(params.hangoutGroupId));
  const q = qs.toString();
  return request(`/api/proxy/events/upcoming${q ? `?${q}` : ""}`);
}



export function createEvent(data: {
  type: "live_stream" | "hangout_event";
  title: string;
  description?: string;
  coverImage?: string;
  scheduledAt: string;
  durationMinutes?: number;
  maxAttendees?: number;
  hangoutGroupId?: number;
  tags?: string[];
}): Promise<{ success: boolean; event: EventItem }> {
  return request("/api/webapp/events", { method: "POST", body: data });
}

export function updateEvent(
  id: string,
  data: Partial<{
    title: string;
    description: string;
    coverImage: string;
    scheduledAt: string;
    durationMinutes: number;
    maxAttendees: number;
    hangoutGroupId: number | null;
    tags: string[];
    status: string;
  }>
): Promise<{ success: boolean; event: EventItem }> {
  return request(`/api/webapp/events/${encodeURIComponent(id)}`, { method: "PUT", body: data });
}

export function cancelEvent(id: string): Promise<{ success: boolean }> {
  return request(`/api/webapp/events/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// ── Playlists ────────────────────────────────────────────────────────────────



export function rsvpEvent(id: string): Promise<{ success: boolean; rsvpCount: number; userRsvpd: boolean }> {
  return request(`/api/webapp/events/${encodeURIComponent(id)}/rsvp`, { method: "POST" });
}

export function unrsvpEvent(id: string): Promise<{ success: boolean; rsvpCount: number; userRsvpd: boolean }> {
  return request(`/api/webapp/events/${encodeURIComponent(id)}/rsvp`, { method: "DELETE" });
}


export function getMyEvents(): Promise<{ success: boolean; events: EventItem[] }> {
  return request("/api/webapp/events/mine");
}

// ─── Courtesy Invite Links ────────────────────────────────────────────────────

export interface CourtesyInvite {
  id: number;
  code: string;
  created_by: string;
  label: string | null;
  max_uses: number;
  uses_count: number;
  grant_days: number;
  is_active: boolean;
  expires_at: string | null;
  created_at: string;
  invite_url: string;
  redemption_count?: number;
  creator_username?: string | null;
  creator_first_name?: string | null;
}

export interface CourtesyInviteCheckResult {
  valid: boolean;
  grant_days?: number;
  label?: string | null;
  creator_name?: string;
  uses_remaining?: number | null;
  error?: string;
}






// ---------------------------------------------------------------------------
// Admin: Creator / Live Performer management
// ---------------------------------------------------------------------------

export interface AdminChannel {
  id: string;
  reference: string;
  rtmpName: string | null;
  hlsUrl: string | null;
  isLive: boolean;
  assignedUser: { id: string; username: string; displayName: string } | null;
}

export function getAdminLiveChannels(): Promise<{ success: boolean; channels: AdminChannel[] }> {
  return request("/api/webapp/admin/live/channels");
}

export type CreatorRole = "creator" | "performer" | "both";

export function makeAdminUserCreator(
  userId: string,
  payload: {
    creatorRole: CreatorRole;
    channelRef?: string;
    creatorType?: string;
    priceUsd?: number;
    grantMonetization?: boolean;
  }
): Promise<{ success: boolean; user: Partial<AdminUser> }> {
  return request(`/api/webapp/admin/users/${userId}/make-creator`, {
    method: "POST",
    body: payload,
  });
}

export function activateAdminUserCreator(
  userId: string
): Promise<{ success: boolean; user: Partial<AdminUser> }> {
  return request(`/api/webapp/admin/users/${userId}/activate-creator`, {
    method: "POST",
  });
}

export function revokeAdminUserCreator(
  userId: string
): Promise<{ success: boolean; user: Partial<AdminUser> }> {
  return request(`/api/webapp/admin/users/${userId}/make-creator`, {
    method: "DELETE",
  });
}

// ─── Book a Call ─────────────────────────────────────────────────────────────

export interface CallPackage {
  id: number;
  creator_id: string;
  duration_minutes: 30 | 60;
  quantity: number;
  price_usd: string;
  sku: string;
  title: string | null;
  is_active: boolean;
  created_at: string;
}

export interface CallCredit {
  id: number;
  member_id: string;
  creator_id: string;
  package_id: number;
  quantity_total: number;
  quantity_used: number;
  quantity_scheduled: number;
  status: "unused" | "partial" | "completed" | "expired" | "refunded";
  expires_at: string | null;
  created_at: string;
  duration_minutes: 30 | 60;
  package_title: string | null;
  creator_username?: string;
  creator_photo?: string | null;
}

export interface BookingSlot {
  startUtc: string;
  endUtc: string;
  durationMinutes: number;
  available: boolean;
}

export interface BookingOptionsResponse {
  success: boolean;
  type: "immediate" | "slots";
  startAt?: string;
  slots?: BookingSlot[];
  durationMinutes: number;
  hasMore?: boolean;
  isLive?: boolean;
  liveMessage?: string | null;
  isOnline?: boolean;
}

export function getCreatorCallPackages(
  creatorId: string
): Promise<{ success: boolean; packages: CallPackage[] }> {
  return request(`/api/webapp/creators/${creatorId}/call-packages`);
}

export function getBookingOptions(
  creatorId: string,
  durationMinutes?: number,
  offset?: number
): Promise<BookingOptionsResponse> {
  const params = new URLSearchParams();
  if (durationMinutes) params.set("duration", String(durationMinutes));
  if (offset) params.set("offset", String(offset));
  return request(`/api/webapp/book-call/${creatorId}/options?${params}`);
}



// ─── Creator: manage own call packages ───────────────────────────────────────

export function getMyCallPackages(): Promise<{
  success: boolean;
  packages: CallPackage[];
}> {
  return request("/api/webapp/creator/call-packages");
}

export function createMyCallPackage(data: {
  durationMinutes: 30 | 60;
  quantity: number;
  priceUsd: number;
  title?: string;
}): Promise<{ success: boolean; package: CallPackage }> {
  return request("/api/webapp/creator/call-packages", {
    method: "POST",
    body: data,
  });
}

export function updateMyCallPackage(
  packageId: number,
  data: { priceUsd?: number; title?: string }
): Promise<{ success: boolean }> {
  return request(`/api/webapp/creator/call-packages/${packageId}`, {
    method: "PUT",
    body: data,
  });
}

export function deactivateMyCallPackage(
  packageId: number
): Promise<{ success: boolean }> {
  return request(`/api/webapp/creator/call-packages/${packageId}`, {
    method: "DELETE",
  });
}

export interface CreatorCallBooking {
  id: number;
  member_id: string;
  creator_id: string;
  package_id: number;
  quantity_total: number;
  quantity_used: number;
  quantity_scheduled: number;
  status: "unused" | "partial" | "completed" | "expired" | "refunded";
  expires_at: string | null;
  created_at: string;
  updated_at: string;
  duration_minutes: number;
  package_title: string | null;
  price_usd: string;
  member_username: string | null;
  member_display_name: string | null;
  member_photo: string | null;
}

export interface CreatorCallEarnings {
  totalRevenue: number;
  totalPurchases: number;
  totalCallsSold: number;
  totalCallsCompleted: number;
  totalCallsScheduled: number;
  averageRating: number;
  totalReviews: number;
}



export interface CallCheckoutPayload {
  packageId: number;
  provider: "nowpayments";
  email: string;
  quantity?: number;
  selectedSlot?: string | null;
  startTimeUtc?: string;
  endTimeUtc?: string;
}

export interface CallCheckoutResponse {
  success: boolean;
  checkoutUrl?: string;
  paymentId?: string;
  startAt?: string;
  durationMinutes?: number;
}

export function createCallCheckout(
  data: CallCheckoutPayload
): Promise<CallCheckoutResponse> {
  return request("/api/webapp/book-call/checkout", {
    method: "POST",
    body: data,
  });
}

export function createCallCheckoutNowPayments(
  packageId: number,
  startTimeUtc?: string,
  endTimeUtc?: string,
  payCurrency?: string,
  clientNotes?: string
): Promise<{ success: boolean; invoiceUrl: string; paymentId: string; amountUsd: number; expiresAt?: string; bookingId?: string; orderId?: string }> {
  const body: Record<string, unknown> = { packageId };
  if (startTimeUtc) body.startTimeUtc = startTimeUtc;
  if (endTimeUtc) body.endTimeUtc = endTimeUtc;
  if (payCurrency) body.payCurrency = payCurrency;
  if (clientNotes) body.clientNotes = clientNotes;
  return request("/api/webapp/book-call/checkout/nowpayments", {
    method: "POST",
    body,
  });
}
export function createCallCheckoutBtc(
  packageId: number,
  startTimeUtc?: string,
  endTimeUtc?: string,
  clientNotes?: string
): Promise<{ success: boolean; invoiceId: string; checkoutUrl: string; amountUsd: number; bookingId?: string }> {
  const body: Record<string, unknown> = { packageId };
  if (startTimeUtc) body.startTimeUtc = startTimeUtc;
  if (endTimeUtc) body.endTimeUtc = endTimeUtc;
  if (clientNotes) body.clientNotes = clientNotes;
  return request("/api/webapp/book-call/checkout/btc", { method: "POST", body });
}

export function createCallCheckoutDash(
  packageId: number,
  startTimeUtc?: string,
  endTimeUtc?: string,
  clientNotes?: string
): Promise<{ success: boolean; invoiceId: string; checkoutUrl: string; paymentId: string; amountUsd: number; bookingId?: string; orderId?: string }> {
  const body: Record<string, unknown> = { packageId };
  if (startTimeUtc) body.startTimeUtc = startTimeUtc;
  if (endTimeUtc) body.endTimeUtc = endTimeUtc;
  if (clientNotes) body.clientNotes = clientNotes;
  return request("/api/webapp/book-call/checkout/dash", { method: "POST", body });
}

export interface MyCallCredit {
  id: number;
  creator_id: string;
  package_id: number;
  duration_minutes: number;
  quantity_total: number;
  quantity_used: number;
  quantity_scheduled: number;
  status: "unused" | "partial" | "completed" | "expired" | "refunded";
  expires_at: string | null;
}

export function getMyCallCredits(
  creatorId?: string
): Promise<{ success: boolean; credits: MyCallCredit[] }> {
  const qs = creatorId ? `?creatorId=${encodeURIComponent(creatorId)}` : "";
  return request(`/api/webapp/my-call-credits${qs}`);
}

export function bookCallWithCredit(data: {
  creatorId: string;
  startAt: string;
  creditId: number;
  durationMinutes: number;
}): Promise<{ success: boolean; booking?: { id: string; startAt: string }; error?: string }> {
  return request("/api/webapp/book-call", { method: "POST", body: data });
}

export function getBtcAvailable(): Promise<{ available: boolean; configured: boolean }> {
  return request("/api/webapp/payments/btc/available");
}

export function createBtcSubscription(
  planId: string,
  creatorId?: string | number
): Promise<{ success: boolean; invoiceId: string; checkoutUrl: string; planName?: string; usdAmount?: number; error?: string }> {
  return request("/api/webapp/payments/btc/create", {
    method: "POST",
    body: { planId, ...(creatorId ? { creatorId } : {}) },
  });
}

export function getBtcSubscriptionStatus(
  invoiceId: string
): Promise<{ success: boolean; status: string; completed: boolean; confirming: boolean; failed: boolean }> {
  return request(`/api/webapp/payments/btc/status/${encodeURIComponent(invoiceId)}`);
}

export function buyTokensWithBtc(
  packageId: string
): Promise<{ success: boolean; invoiceId: string; checkoutUrl: string; tokens: number; usd: number; error?: string }> {
  return request("/api/wallet/buy-btc", { method: "POST", body: { packageId } });
}

export interface BookingPaymentStatus {
  status: "pending" | "paid" | "expired" | "failed";
  bookingId?: string | number;
  roomName?: string;
}

export function getBookingPaymentStatus(
  bookingId: string | number
): Promise<BookingPaymentStatus> {
  return request(`/api/webapp/bookings/${encodeURIComponent(String(bookingId))}/payment-status`);
}

export interface UpcomingBooking {
  id: string | number;
  performer_id: string;
  performer_name: string;
  performer_photo?: string | null;
  start_time_utc: string;
  end_time_utc: string;
  room_name?: string | null;
  duration_minutes?: number;
  creator_username?: string;
  creator_name?: string;
}

export function getUpcomingBookings(): Promise<{ bookings: UpcomingBooking[] }> {
  return request("/api/webapp/bookings/upcoming");
}

export interface CallBooking {
  id: number;
  creator_id: string;
  member_id: string;
  package_id: number;
  start_at: string;
  end_at: string;
  duration_minutes: 30 | 60;
  status: "pending" | "confirmed" | "active" | "completed" | "cancelled" | "no_show";
  payment_status: "pending" | "paid" | "refunded" | "failed";
  creator_username: string;
  creator_photo: string | null;
  member_username: string;
  created_at: string;
}

export function getCallBooking(
  bookingId: string | number
): Promise<{ success: boolean; booking: CallBooking }> {
  return request(`/api/webapp/bookings/${bookingId}`);
}

export interface CallSurveyPayload {
  rating: 1 | 2 | 3 | 4 | 5;
  feedback?: string;
}

export function submitCallSurvey(
  bookingId: string | number,
  data: CallSurveyPayload
): Promise<{ success: boolean }> {
  return request(`/api/webapp/bookings/${bookingId}/survey`, {
    method: "POST",
    body: data,
  });
}

export interface AvailabilityDaySlot {
  enabled: boolean;
  startTime: string;
  endTime: string;
  timezone: string;
  breakMinutes?: number;
}

export type WeeklyAvailabilitySchedule = {
  [day in "sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat"]: AvailabilityDaySlot;
};

export interface AvailabilityDayRow {
  day_of_week: number;
  start_time: string;
  end_time: string;
  timezone: string;
  break_minutes: number;
}

export interface CreatorAvailabilityResponse {
  success: boolean;
  schedule: AvailabilityDayRow[] | WeeklyAvailabilitySchedule | null;
  online: boolean;
  isOnline?: boolean;
}

export function getCreatorAvailabilitySchedule(): Promise<CreatorAvailabilityResponse> {
  return request("/api/webapp/creator/availability/schedule");
}

export interface AvailabilitySlotPayload {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  timezone: string;
  breakMinutes: number;
  enabled: boolean;
}

export function saveCreatorAvailabilitySchedule(
  slots: AvailabilitySlotPayload[]
): Promise<{ success: boolean }> {
  return request("/api/webapp/creator/availability/schedule", {
    method: "PUT",
    body: { schedule: slots },
  });
}

export function setCreatorOnlineStatus(
  online: boolean
): Promise<{ success: boolean; online: boolean }> {
  return request("/api/webapp/creator/online-status", {
    method: "PUT",
    body: { online },
  });
}

export function getNextShowDate(): Promise<{ nextShowDate: string | null }> {
  return request("/api/webapp/creator/next-show-date");
}

export function setNextShowDate(
  date: string | null
): Promise<{ nextShowDate: string | null }> {
  return request("/api/webapp/creator/next-show-date", {
    method: "POST",
    body: { nextShowDate: date },
  });
}

// ─── Accepting Calls (Real-time availability) ─────────────────────────────────

export interface AcceptingCallsStatus {
  accepting: boolean;
  online: boolean;
}

export interface SetAcceptingCallsResponse {
  success: boolean;
  /** ISO string — only present when accepting=true */
  acceptingUntil?: string;
}

/** Creator: read own accepting-calls state (use own userId). */
export function getAcceptingCallsStatus(
  creatorId: string
): Promise<AcceptingCallsStatus> {
  return request(`/api/webapp/creator/${creatorId}/accepting-calls`);
}

/** Creator: toggle accepting-calls on/off. */
export function setAcceptingCalls(
  accepting: boolean
): Promise<SetAcceptingCallsResponse> {
  return request("/api/webapp/creator/accepting-calls", {
    method: "PUT",
    body: { accepting },
  });
}


// ─── Media Packs (Admin) ──────────────────────────────────────────────────────

export interface MediaPack {
  id: number;
  slug: string;
  name: string;
  description?: string;
  pack_type: "sticker" | "gif" | "emoji";
  is_active: boolean;
  is_premium: boolean;
  item_count: number;
  created_at: string;
}

export interface MediaPackItem {
  id: number;
  slug: string;
  name: string;
  alt_text?: string;
  file_url: string;
  thumbnail_url?: string;
  file_type: string;
  use_count: number;
  is_active: boolean;
}

export function getMediaPacks(): Promise<{ packs: MediaPack[] }> {
  return request("/api/webapp/media-packs");
}

export function getMediaPackItems(slug: string): Promise<{ items: MediaPackItem[] }> {
  return request(`/api/webapp/media-packs/${encodeURIComponent(slug)}/items`);
}

export function createMediaPack(data: {
  slug: string;
  name: string;
  description?: string;
  pack_type: string;
  is_premium: boolean;
}): Promise<{ pack: MediaPack }> {
  return request("/api/webapp/admin/media-packs", { method: "POST", body: data });
}

export function toggleMediaPack(packId: number, is_active: boolean): Promise<{ success: boolean }> {
  return request(`/api/webapp/admin/media-packs/${packId}/toggle`, {
    method: "PATCH",
    body: { is_active },
  });
}

export function deleteMediaPack(packId: number): Promise<{ success: boolean }> {
  return request(`/api/webapp/admin/media-packs/${packId}`, { method: "DELETE" });
}

export function deleteMediaPackItem(itemId: number): Promise<{ success: boolean }> {
  return request(`/api/webapp/admin/media-packs/items/${itemId}`, { method: "DELETE" });
}

// ─── Live Schedule ────────────────────────────────────────────────────────────

export interface LiveScheduleSlot {
  id: string | number;
  title: string | null;
  performer_display_name: string | null;
  performer_avatar: string | null;
  start_time: string; // ISO 8601
  end_time: string | null;
  is_live: boolean;
}

export interface LiveScheduleResponse {
  success: boolean;
  slots: LiveScheduleSlot[];
}

export function getLiveSchedule(): Promise<LiveScheduleResponse> {
  return request("/api/webapp/live/schedule");
}

export function subscribeToSlotReminder(slotId: string | number): Promise<{ success: boolean }> {
  return request("/api/webapp/live/schedule/notify", {
    method: "POST",
    body: { slotId },
  });
}

export function unsubscribeFromSlotReminder(slotId: string | number): Promise<{ success: boolean }> {
  return request("/api/webapp/live/schedule/notify", {
    method: "DELETE",
    body: { slotId },
  });
}

export function getSlotNotifyStatus(slotId: string | number): Promise<{ subscribed: boolean }> {
  return request(`/api/webapp/live/schedule/notify/${slotId}`);
}

// ============================================================================
// Stage TV API
// ============================================================================






// ============================================================================
// Radio Requests API (Admin)
// ============================================================================

export interface RadioRequest {
  id: number;
  user_id: string;
  song_name: string;
  artist: string;
  status: "pending" | "approved" | "rejected";
  url: string | null;
  metadata: Record<string, unknown> | null;
  requested_at: string;
  updated_at: string | null;
}

export function getRadioRequests(status = "pending"): Promise<{ success: boolean; requests: RadioRequest[] }> {
  return request(`/api/webapp/admin/radio/requests?status=${status}`);
}

export function updateRadioRequest(requestId: number, status: "approved" | "rejected"): Promise<{ success: boolean; request: RadioRequest }> {
  return request(`/api/webapp/admin/radio/requests/${requestId}`, { method: "PUT", body: { status } });
}

// ============================================================================
// Nearby Context API
// ============================================================================

export interface NearbyContextUser {
  user_id: number | string;
  username?: string | null;
  name?: string | null;
  photo_url?: string | null;
  distance_km: number;
  is_online?: boolean;
  // Feed context extras:
  last_post_media?: string | null;
  last_post_caption?: string | null;
  last_post_at?: string | null;
}

export function getNearbyFeedPosters(): Promise<{ success: boolean; users: NearbyContextUser[] }> {
  return request("/api/webapp/nearby/feed-posters");
}

export function getNearbyHangoutMembers(groupId: number): Promise<{ success: boolean; users: NearbyContextUser[] }> {
  return request(`/api/webapp/nearby/hangout-members/${groupId}`);
}

export function getNearbyStreamViewers(streamId: string): Promise<{ success: boolean; users: NearbyContextUser[] }> {
  return request(`/api/webapp/nearby/stream-viewers/${encodeURIComponent(streamId)}`);
}

export function getNearbyEventAttendees(eventId: string): Promise<{ success: boolean; users: NearbyContextUser[] }> {
  return request(`/api/webapp/nearby/event-attendees/${encodeURIComponent(eventId)}`);
}

export function getNearbyAllUsers(): Promise<{ success: boolean; users: NearbyContextUser[] }> {
  return request("/api/webapp/nearby/all-users");
}

// ── Casting Applications ─────────────────────────────────────────────────────

export interface CastingStatus {
  success: boolean;
  eligible: boolean;
  hasPhoto: boolean;
  postCount: number;
  requiredPosts: number;
  tier: string;
  application: { id: string; status: string; createdAt: string } | null;
}

export function getCastingStatus(): Promise<CastingStatus> {
  return request("/api/casting/status");
}

export function submitCastingApplication(): Promise<{ success: boolean; application: { id: string; status: string; createdAt: string } }> {
  return request("/api/casting/apply", { method: "POST" });
}

export interface CastingApplication {
  id: string;
  user_id: string;
  username: string;
  first_name: string;
  photo_file_id: string | null;
  tier: string;
  post_count: number;
  status: string;
  admin_notes: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export function getCastingApplications(status?: string): Promise<{ success: boolean; applications: CastingApplication[]; statusCounts: Record<string, number> }> {
  const params = status ? `?status=${status}` : "";
  return request(`/api/casting/admin/list${params}`);
}

export function reviewCastingApplication(applicationId: string, decision: "approved" | "rejected", notes?: string): Promise<{ success: boolean }> {
  return request("/api/casting/review", { method: "POST", body: { applicationId, decision, notes } });
}

export function startHangoutCall(groupId: number): Promise<{ token: string; livekitUrl: string; roomName: string }> {
  return request(`/api/webapp/hangouts/groups/${groupId}/call/start`, { method: "POST" });
}

export function joinHangoutCall(groupId: number): Promise<{ token: string; livekitUrl: string; roomName: string }> {
  return request(`/api/webapp/hangouts/groups/${groupId}/call/join`, { method: "POST" });
}

export function leaveHangoutCall(groupId: number | string): Promise<{ ok: boolean; participantCount: number }> {
  return request(`/api/webapp/hangouts/groups/${groupId}/call/leave`, { method: "POST" });
}

export function muteHangoutCallParticipant(groupId: number | string, identity: string): Promise<{ success: boolean; mutedCount: number }> {
  return request(`/api/webapp/hangouts/groups/${groupId}/call/mute-participant`, {
    method: "POST", body: JSON.stringify({ identity }),
  });
}

export function kickHangoutCallParticipant(groupId: number | string, identity: string): Promise<{ success: boolean }> {
  return request(`/api/webapp/hangouts/groups/${groupId}/call/kick-participant`, {
    method: "POST", body: JSON.stringify({ identity }),
  });
}

// ── Online Users ──────────────────────────────────────────────────────────────

export interface OnlineUser {
  user_id: string;
  username?: string;
  name?: string;
  photo_url?: string | null;
  city?: string | null;
  country?: string | null;
  last_active?: string;
  is_online: boolean;
  telegram?: string;
}

export function getOnlineUsers(region?: string, limit = 100): Promise<{ success: boolean; total: number; users: OnlineUser[] }> {
  const params = new URLSearchParams();
  if (region) params.append("region", region);
  params.append("limit", String(limit));
  return request(`/api/webapp/nearby/online-users?${params}`);
}

// ─── MeruLink admin ───────────────────────────────────────────────────────────

export interface MeruLinkStat {
  product: string;
  total: number;
  used: number;
  available: number;
}

export interface MeruLink {
  id: string;
  product: string;
  url: string;
  is_used: boolean;
  status: string;
  used_by: string | null;
  used_by_username: string | null;
  used_at: string | null;
  created_at: string | null;
}

export function getMeruLinkStats(): Promise<{ success: boolean; stats: MeruLinkStat[] }> {
  return request("/api/webapp/admin/meru-links/stats");
}

export function listMeruLinks(): Promise<{ success: boolean; links: MeruLink[] }> {
  return request("/api/webapp/admin/meru-links");
}

export function addMeruLinks(
  product: string,
  links: string[]
): Promise<{ success: boolean; added: number }> {
  return request("/api/webapp/admin/meru-links", {
    method: "POST",
    body: { product, links },
  });
}

export function deleteMeruLink(id: string): Promise<{ success: boolean; message: string }> {
  return request(`/api/webapp/admin/meru-links/${id}`, { method: "DELETE" });
}

// ─── Invite Links (Colombia Socio program) ────────────────────────────────────

export interface InviteLink {
  code: string;
  created_by: string;
  note: string | null;
  sku: string;
  is_lifetime: boolean;
  prime_hours: number;
  max_uses: number | null;
  use_count: number;
  click_count: number;
  expires_at: string | null;
  created_at: string;
}

export interface InviteLinkStats {
  totalLinks: number;
  totalClicks: number;
  totalSignups: number;
  avgConversion: number;
}

export interface InviteLinkCheck {
  valid: boolean;
  reason?: "expired" | "exhausted";
  note?: string | null;
  expiresAt?: string | null;
  maxUses?: number | null;
  useCount?: number;
  sku?: string;
  isLifetime?: boolean;
  primeHours?: number;
}

export function checkInviteLink(code: string): Promise<InviteLinkCheck> {
  return request(`/api/invite/${encodeURIComponent(code)}`);
}

export function redeemInviteLink(code: string): Promise<{ success: boolean; alreadyRedeemed: boolean; alreadyHadEntitlement: boolean; primeGranted: boolean; error?: string }> {
  return request(`/api/invite/${encodeURIComponent(code)}/redeem`, { method: "POST" });
}

export function listAdminInviteLinks(): Promise<{ success: boolean; links: InviteLink[]; stats: InviteLinkStats }> {
  return request("/api/admin/invite-links");
}

export function createAdminInviteLink(data: {
  note?: string;
  maxUses?: number | null;
  expiresAt?: string | null;
  isLifetime?: boolean;
  primeHours?: number;
}): Promise<{ success: boolean; code: string; url: string; link: InviteLink }> {
  return request("/api/admin/invite-links", { method: "POST", body: data });
}

// ── Stream Analytics ──────────────────────────────────────────────────────────

export interface StreamSession {
  id: string;
  channel_ref: string;
  started_at: string;
  ended_at: string | null;
  peak_viewers: number;
  unique_viewers: number | null;
  duration_seconds: number;
  total_tips_tokens: number;
  total_tips_usd: string;
}

export interface StreamAnalyticsSummary {
  total_sessions: number;
  total_hours_live: number;
  avg_peak_viewers: number;
  total_tips_tokens: number;
  total_tips_usd: string;
}

export function getCreatorSessions(limit = 20): Promise<{ success: boolean; sessions: StreamSession[] }> {
  return request(`/api/webapp/live/analytics/sessions?limit=${limit}`);
}

export function getCreatorSummary(days = 30): Promise<{ success: boolean; summary: StreamAnalyticsSummary }> {
  return request(`/api/webapp/live/analytics/summary?days=${days}`);
}

// ── Creator Revenue ───────────────────────────────────────────────────────────

export interface CreatorRevenueDayEntry {
  date: string;
  usd: number;
  tokens: number;
}

export interface CreatorRevenueBySource {
  count: number;
  tokens: number;
  usd: number;
}

export interface CreatorRevenueResponse {
  success: boolean;
  days: number;
  totals: { usd: number; tokens: number };
  byDay: CreatorRevenueDayEntry[];
  bySource: {
    tips: CreatorRevenueBySource;
    tickets: CreatorRevenueBySource;
    subs: CreatorRevenueBySource;
    calls: CreatorRevenueBySource;
  };
}

export function getCreatorRevenue(days = 30, creatorId?: string): Promise<CreatorRevenueResponse> {
  const qs = creatorId
    ? `/api/webapp/creator/revenue?days=${days}&creatorId=${encodeURIComponent(creatorId)}`
    : `/api/webapp/creator/revenue?days=${days}`;
  return request(qs);
}

export function broadcastLiveNow(opts?: { message?: string }): Promise<{ success: boolean; dispatched: number; skippedDedup: boolean }> {
  return request('/api/webapp/live/broadcast-live-now', { method: 'POST', body: opts ?? {} });
}

export interface CreatorLiveEligibility {
  success: boolean;
  canGoLive: boolean;
  canPostExclusive: boolean;
  creatorStatus: string;
  isLocked: boolean;
  is2257Compliant: boolean;
  hasLiveChannel: boolean;
  followersCount?: number;
  issues: string[];
}

export function getCreatorEligibilityStatus(): Promise<CreatorLiveEligibility> {
  return request('/api/webapp/me/creator-eligibility');
}

// ============================================================================
// Creator Album / Media
// ============================================================================

export interface CreatorMediaItem {
  id: string;
  type: "photo" | "video";
  url: string | null;
  thumbUrl: string | null;
  caption?: string | null;
  isPremium: boolean;
  canView: boolean;
  sortOrder?: number;
  createdAt?: string;
}

export function listCreatorMedia(
  creatorId: string,
  limit = 50
): Promise<{ success: boolean; items: CreatorMediaItem[] }> {
  return request(`/api/webapp/creators/${creatorId}/media?limit=${limit}`);
}

export function addCreatorMedia(data: {
  type: "photo" | "video";
  url: string;
  thumbUrl?: string | null;
  caption?: string | null;
  isPremium?: boolean;
}): Promise<{ success: boolean; item: CreatorMediaItem }> {
  return request("/api/webapp/creators/media", { method: "POST", body: data });
}

export function updateCreatorMedia(
  id: string,
  patch: Partial<{
    url: string;
    thumbUrl: string | null;
    caption: string | null;
    isPremium: boolean;
    sortOrder: number;
  }>
): Promise<{ success: boolean; item: CreatorMediaItem }> {
  return request(`/api/webapp/creators/media/${id}`, { method: "PATCH", body: patch });
}

export function deleteCreatorMedia(id: string): Promise<{ success: boolean }> {
  return request(`/api/webapp/creators/media/${id}`, { method: "DELETE" });
}

export function reorderCreatorMedia(
  items: { id: string; sort_order: number }[]
): Promise<{ success: boolean; updated: number }> {
  return request("/api/webapp/creators/media/reorder", { method: "POST", body: { items } });
}

// ── VOD Replay Recordings ──────────────────────────────────────────────────

export interface StreamRecording {
  id: string;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
  sizeBytes: number | null;
  manifestUrl: string | null;
  thumbUrl: string | null;
  title: string | null;
  description: string | null;
  requiresSubscription: boolean;
}

export function listCreatorRecordings(
  creatorId: string
): Promise<{ success: boolean; recordings: StreamRecording[] }> {
  return request(`/api/webapp/creators/${creatorId}/recordings`);
}

export function deleteRecording(id: string): Promise<{ success: boolean }> {
  return request(`/api/webapp/recordings/${id}`, { method: "DELETE" });
}

export function updateRecording(
  id: string,
  data: { title?: string; description?: string }
): Promise<{ success: boolean; title: string | null; description: string | null }> {
  return request(`/api/webapp/recordings/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

// ============================================================================
// Main Stage
// ============================================================================

export interface MainStageState {
  mode: "spotlight" | "cinema" | "equal" | "theater" | "karaoke";
  spotlight: {
    cammer: string | null;
    nextAt: number | null;
    queue: string[];
  };
  media: {
    kind: "video" | "music" | "off";
    src: string | null;
    title: string | null;
    playing: boolean;
    volume: number;
    startedAt: number | null;
    elapsedMs?: number;
    playbackRate?: number;
    adminLocked?: boolean;
  };
  cams: {
    volume: number;
  };
  autoplay_enabled: boolean;
  counts: {
    participants: number;
    guests: number;
    cammers: number;
    viewers: number;
  };
}

export interface MainStageTokenResponse {
  token: string;
  livekitUrl: string;
  roomName: string;
  role: "admin" | "member" | "guest";
  canScreenShare?: boolean;
  participantTier?: "newcomer" | "member" | "prime" | "admin";
  /** ms timestamp — only present for newcomer (free) users */
  sessionStartedAt?: number;
  /** seconds — only present for newcomer (free) users */
  sessionLimitSeconds?: number;
}

export interface MainStageCooldownError {
  success: false;
  code: "FREE_USER_COOLDOWN";
  cooldownSeconds: number;
  error: string;
}

export interface MainStageJoinCheck {
  termsVersion: string;
  privacyVersion: string;
  ageConfirmed: boolean;
  termsAccepted: boolean;
  privacyAccepted: boolean;
  requiresAgeVerification: boolean;
  requiresTermsAcceptance: boolean;
  requiresPrivacyAcceptance: boolean;
  canJoin: boolean;
}

export function getMainStageState(): Promise<MainStageState> {
  return request<{ success: boolean; state: MainStageState }>("/api/main-stage/state").then(
    (res) => res.state
  );
}

export function getMainStageToken(): Promise<MainStageTokenResponse> {
  return request("/api/main-stage/token", { method: "POST" });
}

export function getMainStageViewerToken(): Promise<MainStageTokenResponse> {
  return request("/api/main-stage/viewer-token");
}

export function getMainStageJoinCheck(): Promise<MainStageJoinCheck> {
  return request<{ success: boolean } & MainStageJoinCheck>("/api/main-stage/join-check");
}

export function acceptMainStageConsents(body: {
  acceptTerms: boolean;
  acceptPrivacy: boolean;
  ageConfirmed: boolean;
}): Promise<MainStageJoinCheck> {
  return request<{ success: boolean } & MainStageJoinCheck>("/api/main-stage/accept-consents", {
    method: "POST",
    body,
  });
}

export function redeemMainStageInviteWithConsents(
  code: string,
  displayName: string,
  email: string,
  consents: {
    acceptTerms: boolean;
    acceptPrivacy: boolean;
    ageConfirmed: boolean;
  },
  language?: "en" | "es"
): Promise<{
  success: boolean;
  token: string;
  livekitUrl: string;
  roomName: string;
  role: "guest";
  identity: string;
}> {
  return request('/api/main-stage/guest-token', {
    method: 'POST',
    body: {
      code,
      displayName,
      email,
      language: language || "en",
      acceptTerms: consents.acceptTerms,
      acceptPrivacy: consents.acceptPrivacy,
      ageConfirmed: consents.ageConfirmed,
    },
  });
}

export function setMainStageMode(mode: MainStageState["mode"]): Promise<{ success: boolean }> {
  return request("/api/main-stage/mode", { method: "POST", body: { mode } });
}

export function setMainStageMedia(payload: {
  kind: "video" | "music" | "off";
  src?: string | null;
  playing?: boolean;
  volume?: number;
  adminLocked?: boolean;
}): Promise<{ success: boolean }> {
  return request("/api/main-stage/media", { method: "POST", body: payload });
}

export function setMainStageVolume(payload: {
  cams?: number;
  media?: number;
}): Promise<{ success: boolean }> {
  return request("/api/main-stage/volume", { method: "POST", body: payload });
}

export function setMainStageAutoplay(enabled: boolean): Promise<{ success: boolean }> {
  return request("/api/main-stage/autoplay", { method: "POST", body: { enabled } });
}

export function setMainStageSpotlight(cammer: string): Promise<{ success: boolean }> {
  return request("/api/main-stage/spotlight", { method: "POST", body: { cammer } });
}

export function moderateMainStage(
  action: "skip" | "mute" | "kick",
  identity: string
): Promise<{ success: boolean }> {
  return request("/api/main-stage/moderate", { method: "POST", body: { action, identity } });
}

export function shuffleMainStageCammers(): Promise<{ success: boolean }> {
  return request("/api/main-stage/shuffle", { method: "POST" });
}

// ── Main Stage Guest Invites ──────────────────────────────────────────────────

export interface MainStageInvite {
  id: number;
  code: string;
  url: string;
  label: string | null;
  expiresAt: string;
  maxUses: number;
  usedCount?: number;
  isExpired?: boolean;
  isRevoked?: boolean;
  createdAt?: string;
}

export interface MainStageInvitePreview {
  valid: boolean;
  hostName?: string | null;
  expiresAt?: string;
}

export interface MainStageGuestTokenResponse {
  token: string;
  livekitUrl: string;
  roomName: string;
  role: "guest";
  identity: string;
}

export function createMainStageInvite(opts: {
  label?: string;
  expiresInHours?: number;
  maxUses?: number;
}): Promise<MainStageInvite> {
  return request<{ success: boolean; invite: MainStageInvite }>(
    "/api/main-stage/invites",
    { method: "POST", body: opts }
  ).then((res) => res.invite);
}

export function listMainStageInvites(): Promise<MainStageInvite[]> {
  return request<{ success: boolean; invites: MainStageInvite[] }>(
    "/api/main-stage/invites"
  ).then((res) => res.invites);
}

export function revokeMainStageInvite(id: number): Promise<void> {
  return request(`/api/main-stage/invites/${id}`, { method: "DELETE" }).then(() => undefined);
}

export function createMemberMainStageInvite(label?: string): Promise<MainStageInvite & { url: string }> {
  return request<{ success: boolean } & MainStageInvite & { url: string }>(
    "/api/main-stage/member-invites",
    { method: "POST", body: JSON.stringify({ label }) }
  ).then(({ success: _s, ...invite }) => invite as MainStageInvite & { url: string });
}

export function listMemberMainStageInvites(): Promise<MainStageInvite[]> {
  return request<{ success: boolean; invites: MainStageInvite[] }>(
    "/api/main-stage/member-invites"
  ).then((res) => res.invites);
}

export function voteSkipMainStage(): Promise<{ count: number; threshold: number; triggered: boolean }> {
  return request<{ success: boolean; count: number; threshold: number; triggered: boolean }>(
    "/api/main-stage/vote-skip",
    { method: "POST" }
  ).then(({ count, threshold, triggered }) => ({ count, threshold, triggered }));
}

export function playNextMainStage(): Promise<{ cooldownSeconds?: number }> {
  return request<{ success: boolean; cooldownSeconds?: number }>(
    "/api/main-stage/play-next",
    { method: "POST" }
  ).then(({ cooldownSeconds }) => ({ cooldownSeconds }));
}

export function previewMainStageInvite(code: string): Promise<MainStageInvitePreview> {
  return request<{ success: boolean } & MainStageInvitePreview>(
    `/api/main-stage/invites/preview/${encodeURIComponent(code)}`
  ).then(({ valid, hostName, expiresAt }) => ({ valid, hostName, expiresAt }));
}

export function redeemMainStageInvite(
  code: string,
  displayName: string
): Promise<MainStageGuestTokenResponse> {
  return request<{ success: boolean } & MainStageGuestTokenResponse>(
    "/api/main-stage/guest-token",
    { method: "POST", body: { code, displayName } }
  );
}

// ── Cash-out / USDT off-ramp ──────────────────────────────────────────────────

export interface CashoutBalance {
  holding_usd: number;
  holding_count: number;
  available_usd: number;
  available_count: number;
  earliest_available_at: string | null;
}

export interface CashoutRequestBody {
  amount_usd: number;
  lane: PayoutLane;
  destination: Record<string, unknown>;
}

export interface CashoutRequestResponse {
  order_id: string;
  status: "pending" | "processing";
  provider_ref?: string;
  provider_meta?: Record<string, unknown>;
}

export interface CashoutHistoryItem {
  id: string;
  amount_usd: number;
  lane: PayoutLane;
  status: string;
  requested_at: string;
  settled_at: string | null;
}

export function getCashoutBalance(): Promise<CashoutBalance> {
  return request("/api/cashout/balance");
}

export function requestCashout(body: CashoutRequestBody): Promise<CashoutRequestResponse> {
  return request("/api/cashout/request", { method: "POST", body });
}

export function getCashoutHistory(): Promise<CashoutHistoryItem[]> {
  return request("/api/cashout/history");
}

// ─── Duplicate Account Management ──────────────────────────────────────────

export interface MergeUserSnapshot {
  id: string;
  username: string | null;
  firstName: string | null;
  email: string | null;
  tier: string;
  planId: string | null;
  planExpiry: string | null;
  createdAt: string | null;
  lastActive: string | null;
  telegram: string | null;
  pnptvId: string | null;
  activeEntitlements: number;
  paymentCount: number;
}

export interface MergeCandidate {
  sourceId: string;
  targetId: string;
  dimension: "email" | "telegram" | "x_id" | "pnptv_id" | "manual";
  confidence: number;
  sourceSnapshot: MergeUserSnapshot;
  targetSnapshot: MergeUserSnapshot;
}

export interface MergePreview {
  sourceSnapshot: MergeUserSnapshot;
  targetSnapshot: MergeUserSnapshot;
  tablesAffected: Record<string, number>;
  warnings: string[];
}

export interface MergeLogEntry {
  id: number;
  loser_id: string;
  winner_id: string;
  merge_reason: string;
  dimension: string;
  rows_transferred: Record<string, number>;
  merged_at: string;
  performed_by: string;
  loser_username: string | null;
  loser_first_name: string | null;
  winner_username: string | null;
  winner_first_name: string | null;
  performed_by_username: string | null;
}

export interface MergeResult {
  success: boolean;
  mergeLogId: number;
  rowsTransferred: Record<string, number>;
}

export function getDuplicateAccounts(limit = 50): Promise<{
  success: boolean;
  candidates: MergeCandidate[];
  mergeLog: MergeLogEntry[];
}> {
  return request(`/api/webapp/admin/duplicate-accounts?limit=${limit}`);
}

export function previewAccountMerge(
  sourceId: string,
  targetId: string
): Promise<{ success: boolean; preview: MergePreview }> {
  return request("/api/webapp/admin/duplicate-accounts/preview", {
    method: "POST",
    body: { sourceId, targetId },
  });
}

export function mergeAccounts(
  sourceId: string,
  targetId: string,
  reason: string,
  dimension: string
): Promise<MergeResult> {
  return request("/api/webapp/admin/duplicate-accounts/merge", {
    method: "POST",
    body: { sourceId, targetId, reason, dimension },
  });
}

export function renameAccountToTelegramId(
  sourceId: string,
  telegramId: string
): Promise<{ success: boolean; mergeLogId: number }> {
  return request("/api/webapp/admin/duplicate-accounts/rename", {
    method: "POST",
    body: { sourceId, telegramId },
  });
}

// ──────────────────────────────────────────────────────────────────────────
// Admin: Prime Channel video editor
// ──────────────────────────────────────────────────────────────────────────
export interface AdminPrimeVideo {
  id: number;
  title: string;
  description: string | null;
  status: "draft" | "published" | "archived";
  category: string | null;
  duration: number | null;
  is_featured: boolean;
  is_explicit: boolean;
  tags: string[] | null;
  plays: number;
  likes: number;
  video_file: string | null;
  thumbnail: string | null;
  date_created: string | null;
  date_updated: string | null;
  poster_url: string | null;
  preview_url: string | null;
  video_url: string | null;
  social_post_id: number | null;
  share_url: string | null;
}

export function listAdminPrimeVideos(
  page = 1,
  limit = 100,
): Promise<{ success: boolean; items: ChannelVideo[]; total: number }> {
  return request(`/api/webapp/admin/prime-videos?page=${page}&limit=${limit}`);
}

export function updateAdminPrimeVideo(
  id: number,
  patch: Partial<Pick<AdminPrimeVideo, "title" | "description" | "status" | "is_featured" | "is_explicit" | "category" | "tags">>,
): Promise<{ success: boolean; item: AdminPrimeVideo }> {
  return request(`/api/webapp/admin/prime-videos/${id}`, {
    method: "PATCH",
    body: patch,
  });
}

export function generatePrimeVideoDescription(
  id: number,
  options: { hint?: string; includeSantino?: boolean; includeLex?: boolean } = {},
): Promise<{ success: boolean; description: string; en: string; es: string }> {
  return request(`/api/webapp/admin/prime-videos/${id}/generate-description`, {
    method: "POST",
    body: options,
  });
}

export function generatePrimeVideoTitle(
  id: number,
  options: { hint?: string } = {},
): Promise<{ success: boolean; title: string }> {
  return request(`/api/webapp/admin/prime-videos/${id}/generate-title`, {
    method: "POST",
    body: options,
  });
}

export function suggestPrimeVideoTags(
  id: number,
  options: { hint?: string } = {},
): Promise<{ success: boolean; tags: string[]; taxonomy: string[]; fallback?: boolean }> {
  return request(`/api/webapp/admin/prime-videos/${id}/suggest-tags`, {
    method: "POST",
    body: options,
  });
}

export function uploadAdminPrimeVideo(
  file: File,
  options: { title?: string; description?: string; status?: "draft" | "published"; onProgress?: (pct: number) => void } = {},
): Promise<{ success: boolean; item: AdminPrimeVideo; note?: string }> {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append("file", file);
    if (options.title) fd.append("title", options.title);
    if (options.description) fd.append("description", options.description);
    if (options.status) fd.append("status", options.status);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/webapp/admin/prime-videos/upload", true);
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && options.onProgress) {
        options.onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () => {
      try {
        const body = JSON.parse(xhr.responseText || "{}");
        if (xhr.status >= 200 && xhr.status < 300 && body.success) resolve(body);
        else reject(new Error(body.error || `Upload failed (${xhr.status})`));
      } catch (e) {
        reject(new Error(`Upload failed (${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.send(fd);
  });
}

// ── Channel video upload (universal — every creator's channel) ──────────────

export interface ChannelVideo {
  id: number;
  channel_id: number;
  title: string;
  description: string | null;
  tags: string[];
  tagged_creator_ids?: string[];
  tagged_creators?: { id: string; username: string; first_name: string | null; avatar_url: string | null }[];
  duration_sec: number | null;
  filesize_bytes: number | null;
  thumbnail_url: string | null;
  gif_url: string | null;
  video_url: string;
  status: "processing" | "published" | "draft" | "failed" | "removed";
  is_featured: boolean;
  post_to_feed: boolean;
  promo_post_id: number | null;
  view_count: number;
  ai_generated_meta: Record<string, "ai" | "human" | "mixed">;
  created_at: string;
  channel?: {
    id: number;
    slug: string;
    name: string;
    access_type: "free" | "subscription" | "prime" | "paid";
    price_usd: number | null;
  };
}

export interface ChannelVideoComment {
  id: number;
  content: string;
  likes_count: number;
  replies_count: number;
  created_at: string;
  liked_by_me: boolean;
  author_id: string;
  author_username: string | null;
  author_first_name: string | null;
  author_photo: string | null;
}

export function uploadChannelVideoV2(
  channelId: number,
  file: File,
  options: { title?: string; onProgress?: (pct: number) => void } = {},
): Promise<{ success: boolean; video: ChannelVideo }> {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append("file", file);
    if (options.title) fd.append("title", options.title);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/webapp/channels/${channelId}/videos`, true);
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && options.onProgress) {
        options.onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () => {
      try {
        const body = JSON.parse(xhr.responseText || "{}");
        if (xhr.status >= 200 && xhr.status < 300 && body.success) resolve(body);
        else reject(new Error(body.error || `Upload failed (${xhr.status})`));
      } catch {
        reject(new Error(`Upload failed (${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.send(fd);
  });
}

export async function uploadChannelVideoChunked(
  channelId: number,
  file: File,
  opts: {
    title?: string;
    onProgress?: (p: ChunkUploadProgress) => void;
    resumeUploadId?: string;
    resumeChunksDone?: number;
  } = {}
): Promise<{ success: boolean; video: ChannelVideo }> {
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
  let uploadId = opts.resumeUploadId ?? "";
  let startChunk = opts.resumeChunksDone ?? 0;
  const resumeKey = `pnptv_ch_upload_${channelId}`;
  let reinitDone = false;

  async function doInit(): Promise<string> {
    const initRes = await fetch(`${API_BASE}/api/webapp/channels/${channelId}/videos/init`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileName: file.name, fileSize: file.size, totalChunks }),
    });
    if (!initRes.ok) {
      const b = await initRes.json().catch(() => null);
      throw new Error(b?.error || b?.message || `Init failed (${initRes.status})`);
    }
    const id = (await initRes.json()).uploadId as string;
    localStorage.setItem(resumeKey, JSON.stringify({ uploadId: id, fileName: file.name, fileSize: file.size, chunksUploaded: 0 }));
    return id;
  }

  if (!uploadId) {
    uploadId = await doInit();
  }

  let i = startChunk;
  while (i < totalChunks) {
    const blob = file.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
    let sessionExpired = false;
    let lastErr: Error | null = null;

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const fd = new FormData();
        fd.append("uploadId", uploadId);
        fd.append("chunkIndex", String(i));
        fd.append("totalChunks", String(totalChunks));
        fd.append("chunk", blob, `chunk-${i}`);
        const r = await fetch(`${API_BASE}/api/webapp/channels/${channelId}/videos/chunk`, {
          method: "POST",
          credentials: "include",
          body: fd,
        });
        if (!r.ok) {
          const b = await r.json().catch(() => null);
          if (r.status === 404 && !reinitDone) { sessionExpired = true; lastErr = null; break; }
          throw new Error(b?.error || `Chunk ${i} failed (${r.status})`);
        }
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e as Error;
        if (attempt < 2) await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
      }
    }

    if (sessionExpired) {
      reinitDone = true;
      localStorage.removeItem(resumeKey);
      uploadId = await doInit();
      i = 0;
      continue;
    }
    if (lastErr) throw lastErr;

    localStorage.setItem(resumeKey, JSON.stringify({ uploadId, fileName: file.name, fileSize: file.size, chunksUploaded: i + 1 }));
    opts.onProgress?.({ pct: Math.round(((i + 1) / totalChunks) * 100), doneChunks: i + 1, totalChunks, uploadId });
    i++;
  }

  const completeRes = await fetch(`${API_BASE}/api/webapp/channels/${channelId}/videos/complete`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uploadId, title: opts.title }),
  });
  if (!completeRes.ok) {
    const b = await completeRes.json().catch(() => null);
    throw new Error(b?.error || b?.message || `Complete failed (${completeRes.status})`);
  }
  localStorage.removeItem(resumeKey);
  return completeRes.json();
}

export function getChannelVideoResume(channelId: number, file: File): { uploadId: string; chunksUploaded: number } | null {
  try {
    const raw = localStorage.getItem(`pnptv_ch_upload_${channelId}`);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data.fileName === file.name && data.fileSize === file.size && data.chunksUploaded > 0) {
      return { uploadId: data.uploadId, chunksUploaded: data.chunksUploaded };
    }
  } catch {}
  return null;
}

export function clearChannelVideoResume(channelId: number): void {
  localStorage.removeItem(`pnptv_ch_upload_${channelId}`);
}

export async function aiTitleChannelVideo(channelId: number, videoId: number) {
  return request<{ success: boolean; title: string }>(
    `/api/webapp/channels/${channelId}/videos/${videoId}/ai/title`,
    { method: "POST" },
  );
}
export async function aiDescriptionChannelVideo(channelId: number, videoId: number) {
  return request<{ success: boolean; description: string; en: string; es: string }>(
    `/api/webapp/channels/${channelId}/videos/${videoId}/ai/description`,
    { method: "POST" },
  );
}
export async function aiTagsChannelVideo(channelId: number, videoId: number) {
  return request<{ success: boolean; tags: string[] }>(
    `/api/webapp/channels/${channelId}/videos/${videoId}/ai/tags`,
    { method: "POST" },
  );
}
export async function updateChannelVideo(
  channelId: number, videoId: number,
  fields: { title?: string; description?: string | null; tags?: string[]; status?: string; is_featured?: boolean; post_to_feed?: boolean },
) {
  return request<{ success: boolean; video: ChannelVideo }>(
    `/api/webapp/channels/${channelId}/videos/${videoId}`,
    { method: "PATCH", body: fields },
  );
}
export async function publishChannelVideo(channelId: number, videoId: number) {
  return request<{ success: boolean; video: ChannelVideo }>(
    `/api/webapp/channels/${channelId}/videos/${videoId}/publish`,
    { method: "POST" },
  );
}
export async function deleteChannelVideo(channelId: number, videoId: number) {
  return request<{ success: boolean; ok?: boolean }>(
    `/api/webapp/channels/${channelId}/videos/${videoId}`,
    { method: "DELETE" },
  );
}
export async function listChannelVideos(channelId: number) {
  return request<{ success: boolean; videos: ChannelVideo[] }>(
    `/api/webapp/channels/${channelId}/videos`,
  );
}
export async function getChannelTagTaxonomy(channelId: number) {
  return request<{ success: boolean; tags: string[] }>(
    `/api/webapp/channels/${channelId}/videos/tag-taxonomy`,
  );
}
export async function recordChannelVideoView(channelId: number, videoId: number) {
  return request<{ success: boolean; view_count?: number; deduped?: boolean }>(
    `/api/webapp/channels/${channelId}/videos/${videoId}/view`,
    { method: "POST" },
  );
}
export async function updateVideoTaggedCreators(channelId: number, videoId: number, taggedCreatorIds: string[]) {
  return request<{ success: boolean; tagged_creator_ids: string[] }>(
    `/api/webapp/channels/${channelId}/videos/${videoId}/tagged-creators`,
    { method: "PATCH", body: JSON.stringify({ tagged_creator_ids: taggedCreatorIds }), headers: { "Content-Type": "application/json" } },
  );
}
export async function getChannelVideoComments(channelId: number, videoId: number, cursor?: string) {
  const q = cursor ? `?cursor=${cursor}` : "";
  return request<{ success: boolean; replies: ChannelVideoComment[]; nextCursor: string | null }>(
    `/api/webapp/channels/${channelId}/videos/${videoId}/comments${q}`,
  );
}
export async function postChannelVideoComment(channelId: number, videoId: number, content: string) {
  return request<{ success: boolean; comment: ChannelVideoComment }>(
    `/api/webapp/channels/${channelId}/videos/${videoId}/comments`,
    { method: "POST", body: JSON.stringify({ content }), headers: { "Content-Type": "application/json" } },
  );
}

// ── Stream Health ──────────────────────────────────────────────────────────
export interface StreamHealth {
  inputState: "connected" | "idle" | "failed" | "unknown";
  bitrateKbps: number;
  fps: number;
  viewerCount: number;
  lastInputAt: string | null;
  uptimeSeconds: number;
  errorMessage?: string;
  error?: string;
}

export async function getStreamHealth(streamId: string): Promise<StreamHealth> {
  return request<StreamHealth>(
    `/api/webapp/streams/${encodeURIComponent(streamId)}/health`,
  );
}

export const PRIME_TAG_TAXONOMY: { key: string; label: string }[] = [
  { key: "slam", label: "Slam" },
  { key: "clouds", label: "Clouds" },
  { key: "outdoors", label: "Outdoors" },
  { key: "group", label: "Group" },
  { key: "meth-daddy", label: "Meth Daddy" },
  { key: "twink", label: "Twink" },
  { key: "colombian", label: "Colombian" },
  { key: "venezuelan", label: "Venezuelan" },
  { key: "threesome", label: "Threesome" },
  { key: "golden-rain", label: "Golden Rain" },
];

// ── Live tip goal, tip menu, leaderboard ──────────────────────────────────────

export interface TipGoal {
  goalAmount: number | null;
  goalLabel: string | null;
  progress: number;
  completed: boolean;
}

export interface TipMenuItem {
  id: number;
  tokensAmount: number;
  label: string;
  sortOrder: number;
}

export function getLiveGoal(channelRef: string): Promise<TipGoal> {
  return request(`/api/proxy/live/goal/${encodeURIComponent(channelRef)}`);
}

export function setLiveGoal(amount: number, label: string): Promise<{ success: boolean }> {
  return request("/api/webapp/live/goal", { method: "POST", body: { amount, label } });
}

export function clearLiveGoal(): Promise<{ success: boolean }> {
  return request("/api/webapp/live/goal", { method: "DELETE" });
}

export function getTipMenu(performerId: string): Promise<{ items: TipMenuItem[] }> {
  return request(`/api/webapp/live/tip-menu/${encodeURIComponent(performerId)}`);
}

/** Fetch the authenticated creator's own tip menu items (no param needed). */
export function getMyTipMenu(): Promise<{ success: boolean; items: TipMenuItem[] }> {
  return request("/api/webapp/live/tip-menu");
}

export function saveTipMenu(
  items: { tokensAmount: number; label: string; sortOrder: number }[]
): Promise<{ success: boolean }> {
  return request("/api/webapp/live/tip-menu", { method: "POST", body: { items } });
}

export function getTipLeaderboard(
  channelRef: string,
  period: "today" | "week"
): Promise<{ leaderboard: { username: string; total: number; tipCount: number }[] }> {
  return request(
    `/api/proxy/live/tips/leaderboard?channelRef=${encodeURIComponent(channelRef)}&period=${period}`
  );
}

export function getCreatorRecordings(creatorId: string): Promise<{
  success: boolean;
  recordings: { id: string; title: string | null; manifestUrl: string; startedAt: string; endedAt: string | null; durationSeconds: number | null; sizeBytes: number | null; thumbUrl: string | null; requiresSubscription: boolean }[];
}> {
  return request(`/api/webapp/creators/${encodeURIComponent(creatorId)}/recordings`);
}

export function getDiscoverTags(): Promise<{ success: boolean; groups: Record<string, { name: string; emoji: string }[]> }> {
  return request("/api/webapp/discover/tags");
}

export function discover(params: {
  tags?: string[];
  q?: string;
  entity?: "all" | "members" | "creators" | "channels" | "videos" | "hangouts";
  page?: number;
  limit?: number;
}): Promise<{
  success: boolean;
  members?: any[];
  creators?: any[];
  channels?: any[];
  videos?: any[];
  hangouts?: any[];
}> {
  const qp = new URLSearchParams();
  if (params.tags?.length) qp.set("tags", params.tags.join(","));
  if (params.q) qp.set("q", params.q);
  if (params.entity) qp.set("entity", params.entity);
  if (params.page) qp.set("page", String(params.page));
  if (params.limit) qp.set("limit", String(params.limit));
  return request(`/api/webapp/discover?${qp}`);
}
