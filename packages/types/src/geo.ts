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
