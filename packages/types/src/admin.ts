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
  label?: 'PRIME' | 'BASIC' | 'FREE';
  subscription_status: string;
  subscription_plan?: string;
  plan_expiry?: string;
  created_at: string;
  last_payment_date?: string;
  phone_number?: string;
  /** Telegram numeric user ID if the account is linked to Telegram, else null/undefined. */
  telegram?: string | null;
  // Creator / Live Performer fields
  creator_status?: string;
  creator_type?: string;
  creator_price_usd?: number;
  live_channel?: string;
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

export interface AdminUserFilters {
  tier?: string;
  status?: string;
  plan?: string;
  role?: string;
  /** 'linked' | 'unlinked' — filter users by Telegram link status. */
  telegram?: string;
}

export interface AddOn {
  id: string;
  name: string;
  ui_description?: string;
  features?: string[];
}

export interface PlanAddOn {
  add_on_id: string;
  name: string;
  duration_days: number | null;
  is_lifetime: boolean;
}

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

export interface AdminChannel {
  id: string;
  reference: string;
  rtmpName: string | null;
  hlsUrl: string | null;
  isLive: boolean;
  assignedUser: { id: string; username: string; displayName: string } | null;
}

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
  creator_wallet_address: string | null;
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
