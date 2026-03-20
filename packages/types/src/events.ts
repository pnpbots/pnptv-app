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
