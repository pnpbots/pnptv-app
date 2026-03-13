import { createDirectus, rest, authentication, readItems } from "@directus/sdk";

const DIRECTUS_URL = import.meta.env.VITE_DIRECTUS_URL || "https://cms.pnptv.app";

export const directus = createDirectus(DIRECTUS_URL)
  .with(authentication("json"))
  .with(rest());

export { DIRECTUS_URL };

// ------ Collection Types ------

export interface Performer {
  id: number;
  status: "published" | "draft" | "archived";
  name: string;
  slug: string;
  bio: string | null;
  photo: string | null;
  categories: string[];
  social_links: Record<string, string> | null;
  is_featured: boolean;
  date_created: string;
}

export interface Show {
  id: number;
  status: "published" | "draft";
  title: string;
  description: string | null;
  performer: number | Performer | null;
  cover_image: string | null;
  scheduled_at: string;
  duration_minutes: number | null;
  category: string | null;
  is_premium: boolean;
}

export interface Content {
  id: number;
  status: "published" | "draft";
  title: string;
  description: string | null;
  performer: number | Performer | null;
  type: "video" | "audio" | "podcast";
  media_url: string | null;
  thumbnail: string | null;
  duration_seconds: number | null;
  is_premium: boolean;
  tags: string[];
  series: string | null;
  episode_number: number | null;
  date_created: string;
}

export interface PrimeVideo {
  id: number;
  status: "published" | "draft";
  title: string;
  description: string | null;
  video_file: string | null;
  thumbnail: string | null;
  cover_url: string | null;
  duration: number | null;
  artist: string | null;
  category: string | null;
  type: string;
  language: string | null;
  is_explicit: boolean;
  is_featured: boolean;
  tags: string[] | null;
  plays: number;
  likes: number;
  date_created: string;
  date_updated: string | null;
}

export interface Announcement {
  id: number;
  status: "published" | "draft";
  title: string;
  body: string | null;
  type: "news" | "update" | "alert";
  is_pinned: boolean;
  published_at: string | null;
  date_created: string;
}

export interface Page {
  id: number;
  status: "published" | "draft";
  title: string;
  slug: string;
  content: string | null;
}

// ------ Data Fetchers ------

export async function getFeaturedPerformers(limit = 6): Promise<Performer[]> {
  try {
    const items = await directus.request(
      readItems("performers", {
        filter: { status: { _eq: "published" }, is_featured: { _eq: true } },
        sort: ["-date_created"],
        limit,
      })
    );
    return (items as Performer[]) || [];
  } catch {
    return [];
  }
}

export async function getAnnouncements(limit = 5): Promise<Announcement[]> {
  try {
    const items = await directus.request(
      readItems("announcements", {
        filter: { status: { _eq: "published" } },
        sort: ["-is_pinned", "-published_at", "-date_created"],
        limit,
      })
    );
    return (items as Announcement[]) || [];
  } catch {
    return [];
  }
}

export async function getUpcomingShows(limit = 5): Promise<Show[]> {
  try {
    const items = await directus.request(
      readItems("shows", {
        filter: {
          status: { _eq: "published" },
          scheduled_at: { _gte: new Date().toISOString() },
        },
        sort: ["scheduled_at"],
        limit,
        fields: ["*", "performer.name", "performer.slug", "performer.photo"],
      })
    );
    return (items as Show[]) || [];
  } catch {
    return [];
  }
}

export async function getPage(slug: string): Promise<Page | null> {
  try {
    const items = await directus.request(
      readItems("pages", {
        filter: { status: { _eq: "published" }, slug: { _eq: slug } },
        limit: 1,
      })
    );
    return (items as Page[])?.[0] || null;
  } catch {
    return null;
  }
}

export function getAssetUrl(fileId: string | null): string | null {
  if (!fileId) return null;
  return `${DIRECTUS_URL}/assets/${fileId}`;
}
