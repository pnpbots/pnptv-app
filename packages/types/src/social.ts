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
  // Bluesky cross-post fields
  bluesky_uri?: string | null;
  bluesky_cid?: string | null;
  source?: "local" | "bluesky";
  bsky_author_handle?: string | null;
  bsky_author_avatar?: string | null;
  bsky_author_display_name?: string | null;
  // Tier-gating fields (free-tier users see blurred posts)
  blurred?: boolean;
  content_locked?: boolean;
  content_tier?: string;
  // Multi-image support (up to 4 files per post)
  media_urls?: Array<{ url: string; type: string; thumbnail_url?: string }> | null;
  // Video thumbnail (poster frame generated server-side)
  video_thumbnail_url?: string | null;
  // Promoted post fields (CMS-managed featured content)
  is_promoted?: boolean;
  promoted_link?: string | null;
  promoted_link_label?: string | null;
  promoted_thumbnail?: string | null;
}

export type ContentReaction = {
  emoji: string;
  count: number;
  users: Array<{ id: string; username: string }>;
  reactedByMe?: boolean;
};

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

// Aliases used by Home.tsx internal feed
export type InternalPost = SocialPostItem;

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

export interface XStatus {
  linked: boolean;
  hasWriteScope: boolean;
  handle: string | null;
}
