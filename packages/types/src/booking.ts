export interface CallPackage {
  id: number;
  creator_id: string;
  duration_minutes: 30 | 60;
  quantity: number;
  price_usd: string;
  sku: string;
  title: string | null;
  is_active: boolean;
  created_at: string;
}

export interface CallCredit {
  id: number;
  member_id: string;
  creator_id: string;
  package_id: number;
  quantity_total: number;
  quantity_used: number;
  quantity_scheduled: number;
  status: "unused" | "partial" | "completed" | "expired" | "refunded";
  expires_at: string | null;
  created_at: string;
  duration_minutes: 30 | 60;
  package_title: string | null;
  creator_username?: string;
  creator_photo?: string | null;
}

export interface BookingSlot {
  startUtc: string;
  endUtc: string;
  durationMinutes: number;
  available: boolean;
}

export interface BookingOptionsResponse {
  success: boolean;
  type: "immediate" | "slots";
  startAt?: string;
  slots?: BookingSlot[];
  durationMinutes: number;
  hasMore?: boolean;
  isLive?: boolean;
  liveMessage?: string | null;
}

export interface CreatorCallBooking {
  id: number;
  member_id: string;
  creator_id: string;
  package_id: number;
  quantity_total: number;
  quantity_used: number;
  quantity_scheduled: number;
  status: "unused" | "partial" | "completed" | "expired" | "refunded";
  expires_at: string | null;
  created_at: string;
  updated_at: string;
  duration_minutes: number;
  package_title: string | null;
  price_usd: string;
  member_username: string | null;
  member_display_name: string | null;
  member_photo: string | null;
}

export interface CreatorCallEarnings {
  totalRevenue: number;
  totalPurchases: number;
  totalCallsSold: number;
  totalCallsCompleted: number;
  totalCallsScheduled: number;
  averageRating: number;
  totalReviews: number;
}

export interface CallCheckoutPayload {
  packageId: number;
  provider: "epayco" | "daimo";
  email: string;
  quantity?: number;
  selectedSlot?: string | null;
}

export interface CallCheckoutResponse {
  success: boolean;
  checkoutUrl?: string;
  paymentId?: string;
  startAt?: string;
  durationMinutes?: number;
}

export interface CallBookingLiveKit {
  token: string;
  wsUrl: string;
  roomName: string;
}

export interface CallBooking {
  id: number;
  creator_id: string;
  member_id: string;
  package_id: number;
  start_at: string;
  end_at: string;
  duration_minutes: 30 | 60;
  status: "pending" | "confirmed" | "active" | "completed" | "cancelled" | "no_show";
  payment_status: "pending" | "paid" | "refunded" | "failed";
  creator_username: string;
  creator_photo: string | null;
  member_username: string;
  livekit?: CallBookingLiveKit | null;
  created_at: string;
}

export interface CallSurveyPayload {
  rating: 1 | 2 | 3 | 4 | 5;
  feedback?: string;
}

export interface AvailabilityDaySlot {
  enabled: boolean;
  startTime: string;
  endTime: string;
  timezone: string;
  breakMinutes?: number;
}

export type WeeklyAvailabilitySchedule = {
  [day in "sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat"]: AvailabilityDaySlot;
};

export interface AvailabilityDayRow {
  day_of_week: number;
  start_time: string;
  end_time: string;
  timezone: string;
  break_minutes: number;
}

export interface CreatorAvailabilityResponse {
  success: boolean;
  schedule: AvailabilityDayRow[] | WeeklyAvailabilitySchedule | null;
  online: boolean;
  isOnline?: boolean;
}

export interface AvailabilitySlotPayload {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  timezone: string;
  breakMinutes: number;
  enabled: boolean;
}
