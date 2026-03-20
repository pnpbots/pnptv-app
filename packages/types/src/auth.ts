export interface TelegramAuthResponse {
  success: boolean;
  user?: {
    id?: string;
    pnptv_id?: string;
    telegram_id: number;
    username: string;
    first_name: string;
    display_name: string;
    language: string;
    terms_accepted: boolean;
    age_verified: boolean;
    subscription_type: string;
    tier: string;
    label?: 'PRIME' | 'BASIC' | 'FREE';
    role: string;
    photo_url?: string | null;
    creator_status?: string;
    creator_type?: string | null;
    contentDisclaimer?: boolean;
    last_login_method?: string | null;
    city?: string | null;
    country?: string | null;
    email?: string | null;
  };
  requiresTerms?: boolean;
  error?: string;
}

export interface AuthMethods {
  telegram: boolean;
  atproto: boolean;
}

export interface AuthStatusResponse {
  authenticated: boolean;
  user?: TelegramAuthResponse["user"] & {
    atproto_did?: string | null;
    atproto_handle?: string | null;
    auth_methods?: AuthMethods;
    creator_status?: string;
    creator_type?: string | null;
  };
}

export interface TelegramWidgetUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

export interface TelegramWidgetAuthResponse {
  success: boolean;
  isNew?: boolean;
  user?: {
    id: string;
    pnptvId: string;
    username: string | null;
    firstName: string;
    lastName: string | null;
    photoUrl: string | null;
    subscriptionStatus: string;
    tier: string;
    label?: 'PRIME' | 'BASIC' | 'FREE';
    role: string;
    termsAccepted: boolean;
  };
  error?: string;
}

export interface EmailRegisterPayload {
  email: string;
  password: string;
  firstName: string;
  lastName?: string;
}

export interface EmailRegisterResponse {
  authenticated: boolean;
  requiresVerification?: boolean;
  message?: string;
  user?: {
    id: string;
    email: string;
  };
  error?: string;
}
