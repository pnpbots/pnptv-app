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
