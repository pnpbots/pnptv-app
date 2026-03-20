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
