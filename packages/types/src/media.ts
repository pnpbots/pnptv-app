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
