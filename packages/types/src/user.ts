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

export interface FollowListUser {
  id: string;
  username: string;
  firstName: string;
  lastName: string | null;
  photoUrl: string | null;
  followedAt: string;
  displayName?: string;
}

export interface BlockedUser {
  id: string;
  username: string;
  firstName: string;
  photoUrl: string | null;
  blockedAt: string;
}

export interface MentionUser {
  id: string;
  username: string;
  avatar_url: string | null;
  creator_status: string | null;
}

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

export interface ReferralStats {
  code: string;
  link: string;
  total: number;
  completed: number;
}
