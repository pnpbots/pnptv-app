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
  /** Set by the backend when the performer is currently streaming via Restreamer. */
  isLive?: boolean;
  /** Direct HLS playback URL, populated when isLive is true. */
  hlsUrl?: string | null;
  live_channel?: string | null;
}

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
}

export interface CreatorStrike {
  id: string;
  creator_id: string;
  strike_number: number;
  reason: string;
  issued_by: string;
  created_at: string;
}

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

export interface EnrollmentListItem extends CreatorEnrollment {
  user_id: string;
  id_document_path: string | null;
  username: string | null;
  first_name: string | null;
  photo_file_id: string | null;
}

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
