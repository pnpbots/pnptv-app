-- PostgreSQL Schema for PNPtv Bot
-- Migration from Firestore to PostgreSQL

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(255) PRIMARY KEY,  -- Telegram user ID (can be numeric or string)
  username VARCHAR(255),
  first_name VARCHAR(255) NOT NULL,
  last_name VARCHAR(255),
  email VARCHAR(255) UNIQUE,
  email_verified BOOLEAN DEFAULT FALSE,

  -- Profile
  bio TEXT,
  photo_file_id VARCHAR(255),
  photo_updated_at TIMESTAMP,
  interests TEXT[], -- Array of interests
  looking_for VARCHAR(200),
  tribe VARCHAR(100),

  -- Location & Address
  city VARCHAR(100),
  country VARCHAR(100),

  -- Social Media
  instagram VARCHAR(100),
  twitter VARCHAR(100),
  facebook VARCHAR(100),
  tiktok VARCHAR(100),
  youtube VARCHAR(200),
  telegram VARCHAR(100),

  -- Location
  location_lat DECIMAL(10, 8),
  location_lng DECIMAL(11, 8),
  location_name VARCHAR(255),
  location_geohash VARCHAR(50),
  location_updated_at TIMESTAMP,
  location_sharing_enabled BOOLEAN DEFAULT TRUE,

  -- Subscription & Membership
  -- status: account state ('active'/'inactive'/'banned') — set by onboarding completion
  -- tier: access level ('free'/'prime') — determines feature gates
  -- subscription_status: lifecycle segment ('free'/'active'/'churned') — used for comms targeting
  subscription_status VARCHAR(50) DEFAULT 'free',
  plan_id VARCHAR(100),
  plan_expiry TIMESTAMP,
  tier VARCHAR(50) DEFAULT 'free',

  -- Role & Permissions
  role VARCHAR(255) DEFAULT 'user',
  assigned_by VARCHAR(255),
  role_assigned_at TIMESTAMP,

  -- Privacy settings (stored as JSONB)
  privacy JSONB DEFAULT '{"showLocation": true, "showInterests": true, "showBio": true, "allowMessages": true, "showOnline": true}'::jsonb,

  -- Counters
  profile_views INTEGER DEFAULT 0,
  xp INTEGER DEFAULT 0,

  -- Arrays
  favorites TEXT[] DEFAULT '{}',
  blocked TEXT[] DEFAULT '{}',
  badges TEXT[] DEFAULT '{}',

  -- Onboarding & Verification
  onboarding_complete BOOLEAN DEFAULT FALSE,
  age_verified BOOLEAN DEFAULT FALSE,
  age_verified_at TIMESTAMP,
  age_verification_expires_at TIMESTAMP,
  age_verification_interval_hours INTEGER DEFAULT 168, -- 7 days
  terms_accepted BOOLEAN DEFAULT FALSE,
  privacy_accepted BOOLEAN DEFAULT FALSE,

  -- Activity tracking
  last_active TIMESTAMP,
  last_activity_in_group VARCHAR(255),
  group_activity_log JSONB,

  -- Timezone
  timezone VARCHAR(100),
  timezone_detected BOOLEAN DEFAULT FALSE,
  timezone_updated_at TIMESTAMP,

  -- Metadata
  language VARCHAR(10) DEFAULT 'en',
  is_active BOOLEAN DEFAULT TRUE,
  deactivated_at TIMESTAMP,
  deactivation_reason TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for users table
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_subscription_status ON users(subscription_status);
CREATE INDEX IF NOT EXISTS idx_users_tier ON users(tier);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_location ON users(location_lat, location_lng) WHERE location_lat IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_location_sharing ON users(location_sharing_enabled) WHERE location_sharing_enabled = TRUE;
CREATE INDEX IF NOT EXISTS idx_users_plan_expiry ON users(plan_expiry) WHERE plan_expiry IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_last_active ON users(last_active);

-- User roles table (access control)
CREATE TABLE IF NOT EXISTS user_roles (
  user_id VARCHAR(255) PRIMARY KEY,
  role VARCHAR(50) NOT NULL,
  granted_by VARCHAR(255),
  granted_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_roles_role ON user_roles(role);
CREATE INDEX IF NOT EXISTS idx_user_roles_granted_at ON user_roles(granted_at);

-- Plans table
CREATE TABLE IF NOT EXISTS plans (
  id VARCHAR(100) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  tier VARCHAR(50) NOT NULL,
  price DECIMAL(10, 2) NOT NULL,
  price_in_cop DECIMAL(10, 2),
  currency VARCHAR(10) DEFAULT 'USD',
  duration INTEGER NOT NULL, -- in days
  duration_days INTEGER, -- compatibility field
  description TEXT,
  features JSONB DEFAULT '[]'::jsonb,
  icon VARCHAR(50),
  active BOOLEAN DEFAULT TRUE,
  recommended BOOLEAN DEFAULT FALSE,
  is_lifetime BOOLEAN DEFAULT FALSE,
  requires_manual_activation BOOLEAN DEFAULT FALSE,
  payment_method VARCHAR(50),
  wompi_payment_link TEXT,
  crypto_bonus JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Payments table
CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id VARCHAR(100) REFERENCES plans(id),
  plan_name VARCHAR(255),

  -- Payment details
  amount DECIMAL(10, 2) NOT NULL,
  currency VARCHAR(10) DEFAULT 'USD',
  provider VARCHAR(50),
  payment_method VARCHAR(50),
  status VARCHAR(50) DEFAULT 'pending',

  -- Transaction info
  payment_id VARCHAR(255),
  reference VARCHAR(255),
  destination_address VARCHAR(255),
  payment_url TEXT,

  -- Blockchain specific
  chain JSONB, -- Can store chain info or chain ID
  chain_id INTEGER,

  -- Completion
  completed_at TIMESTAMP,
  completed_by VARCHAR(255),
  manual_completion BOOLEAN DEFAULT FALSE,
  expires_at TIMESTAMP,

  -- Metadata
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for payments
CREATE INDEX IF NOT EXISTS idx_payments_user_id ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_plan_id ON payments(plan_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_created_at ON payments(created_at);
CREATE INDEX IF NOT EXISTS idx_payments_provider ON payments(provider);

-- Payment webhook events (audit all payment attempts)
CREATE TABLE IF NOT EXISTS payment_webhook_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider VARCHAR(50) NOT NULL,
  event_id VARCHAR(255),
  payment_id UUID,
  status VARCHAR(50),
  state_code VARCHAR(50),
  is_valid_signature BOOLEAN DEFAULT TRUE,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_webhook_events_provider
  ON payment_webhook_events(provider);
CREATE INDEX IF NOT EXISTS idx_payment_webhook_events_event_id
  ON payment_webhook_events(event_id);
CREATE INDEX IF NOT EXISTS idx_payment_webhook_events_payment_id
  ON payment_webhook_events(payment_id);
CREATE INDEX IF NOT EXISTS idx_payment_webhook_events_created_at
  ON payment_webhook_events(created_at DESC);

-- Calls table
CREATE TABLE IF NOT EXISTS calls (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  caller_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  receiver_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Call details
  status VARCHAR(50) DEFAULT 'pending', -- pending, active, completed, missed, cancelled
  call_type VARCHAR(50) DEFAULT 'video', -- video, audio
  duration INTEGER DEFAULT 0, -- in seconds

  -- Scheduling
  scheduled_at TIMESTAMP,
  started_at TIMESTAMP,
  ended_at TIMESTAMP,

  -- Ratings & Feedback
  caller_rating INTEGER CHECK (caller_rating >= 1 AND caller_rating <= 5),
  receiver_rating INTEGER CHECK (receiver_rating >= 1 AND receiver_rating <= 5),
  caller_feedback TEXT,
  receiver_feedback TEXT,

  -- Metadata
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for calls
CREATE INDEX IF NOT EXISTS idx_calls_caller_id ON calls(caller_id);
CREATE INDEX IF NOT EXISTS idx_calls_receiver_id ON calls(receiver_id);
CREATE INDEX IF NOT EXISTS idx_calls_status ON calls(status);
CREATE INDEX IF NOT EXISTS idx_calls_scheduled_at ON calls(scheduled_at);

-- Call packages table
CREATE TABLE IF NOT EXISTS call_packages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  package_type VARCHAR(50) NOT NULL,

  -- Package details
  total_minutes INTEGER NOT NULL,
  used_minutes INTEGER DEFAULT 0,
  remaining_minutes INTEGER NOT NULL,

  -- Validity
  purchased_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NOT NULL,
  active BOOLEAN DEFAULT TRUE,

  -- Metadata
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for call packages
CREATE INDEX IF NOT EXISTS idx_call_packages_user_id ON call_packages(user_id);
CREATE INDEX IF NOT EXISTS idx_call_packages_active ON call_packages(active);

-- Live streams table
CREATE TABLE IF NOT EXISTS live_streams (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  host_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Stream details
  title VARCHAR(255) NOT NULL,
  description TEXT,
  category VARCHAR(100),
  stream_url TEXT,
  thumbnail_url TEXT,

  -- Status
  status VARCHAR(50) DEFAULT 'scheduled', -- scheduled, live, ended
  is_public BOOLEAN DEFAULT TRUE,

  -- Schedule
  scheduled_at TIMESTAMP,
  started_at TIMESTAMP,
  ended_at TIMESTAMP,

  -- Stats
  viewers_count INTEGER DEFAULT 0,
  max_viewers INTEGER DEFAULT 0,

  -- Metadata
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for live streams
CREATE INDEX IF NOT EXISTS idx_live_streams_host_id ON live_streams(host_id);
CREATE INDEX IF NOT EXISTS idx_live_streams_status ON live_streams(status);
CREATE INDEX IF NOT EXISTS idx_live_streams_scheduled_at ON live_streams(scheduled_at);

-- X (Twitter) accounts and scheduled posts
CREATE TABLE IF NOT EXISTS x_accounts (
  account_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  x_user_id VARCHAR(40),
  handle VARCHAR(50) NOT NULL,
  display_name VARCHAR(120),
  encrypted_access_token TEXT NOT NULL,
  encrypted_refresh_token TEXT,
  token_expires_at TIMESTAMP,
  created_by BIGINT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_x_accounts_handle ON x_accounts(handle);
CREATE UNIQUE INDEX IF NOT EXISTS idx_x_accounts_user_id ON x_accounts(x_user_id);
CREATE INDEX IF NOT EXISTS idx_x_accounts_active ON x_accounts(is_active);

CREATE TABLE IF NOT EXISTS x_oauth_states (
  state VARCHAR(64) PRIMARY KEY,
  code_verifier TEXT NOT NULL,
  admin_id BIGINT,
  admin_username VARCHAR(100),
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_x_oauth_states_expires_at ON x_oauth_states(expires_at);

CREATE TABLE IF NOT EXISTS x_post_jobs (
  post_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES x_accounts(account_id) ON DELETE CASCADE,
  admin_id BIGINT,
  admin_username VARCHAR(100),
  text TEXT NOT NULL,
  media_url TEXT,
  scheduled_at TIMESTAMP,
  status VARCHAR(20) DEFAULT 'scheduled',
  response_json JSONB,
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  sent_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_x_post_jobs_status ON x_post_jobs(status);
CREATE INDEX IF NOT EXISTS idx_x_post_jobs_scheduled_at ON x_post_jobs(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_x_post_jobs_account_id ON x_post_jobs(account_id);

-- Radio stations table
CREATE TABLE IF NOT EXISTS radio_stations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  stream_url TEXT NOT NULL,
  website_url TEXT,
  logo_url TEXT,

  -- Categorization
  genre VARCHAR(100),
  country VARCHAR(100),
  language VARCHAR(50),

  -- Status
  active BOOLEAN DEFAULT TRUE,
  featured BOOLEAN DEFAULT FALSE,

  -- Stats
  listeners_count INTEGER DEFAULT 0,

  -- Metadata
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for radio stations
CREATE INDEX IF NOT EXISTS idx_radio_stations_genre ON radio_stations(genre);
CREATE INDEX IF NOT EXISTS idx_radio_stations_active ON radio_stations(active);

-- Promo codes table
CREATE TABLE IF NOT EXISTS promo_codes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code VARCHAR(100) NOT NULL UNIQUE,

  -- Discount details
  discount_type VARCHAR(50) NOT NULL, -- percentage, fixed
  discount_value DECIMAL(10, 2) NOT NULL,

  -- Applicable plans
  applicable_plans TEXT[], -- Array of plan IDs

  -- Usage limits
  max_uses INTEGER,
  current_uses INTEGER DEFAULT 0,
  max_uses_per_user INTEGER DEFAULT 1,

  -- Validity
  valid_from TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  valid_until TIMESTAMP,
  active BOOLEAN DEFAULT TRUE,

  -- Metadata
  created_by VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for promo codes
CREATE INDEX IF NOT EXISTS idx_promo_codes_code ON promo_codes(code);
CREATE INDEX IF NOT EXISTS idx_promo_codes_active ON promo_codes(active);

-- Wall of Fame tracking
CREATE TABLE IF NOT EXISTS wall_of_fame_posts (
  id SERIAL PRIMARY KEY,
  group_id BIGINT NOT NULL,
  message_id BIGINT NOT NULL,
  user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date_key DATE NOT NULL,
  reactions_count INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(group_id, message_id)
);

CREATE TABLE IF NOT EXISTS wall_of_fame_daily_stats (
  date_key DATE NOT NULL,
  user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  photos_shared INTEGER DEFAULT 0,
  reactions_received INTEGER DEFAULT 0,
  is_new_member BOOLEAN DEFAULT FALSE,
  first_post_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (date_key, user_id)
);

CREATE TABLE IF NOT EXISTS wall_of_fame_daily_winners (
  date_key DATE PRIMARY KEY,
  legend_user_id VARCHAR(255) REFERENCES users(id) ON DELETE SET NULL,
  new_member_user_id VARCHAR(255) REFERENCES users(id) ON DELETE SET NULL,
  active_user_id VARCHAR(255) REFERENCES users(id) ON DELETE SET NULL,
  processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_wall_of_fame_posts_group ON wall_of_fame_posts(group_id);
CREATE INDEX IF NOT EXISTS idx_wall_of_fame_posts_date ON wall_of_fame_posts(date_key);
CREATE INDEX IF NOT EXISTS idx_wall_of_fame_stats_reactions ON wall_of_fame_daily_stats(reactions_received);

CREATE TABLE IF NOT EXISTS cult_event_registrations (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type VARCHAR(50) NOT NULL,
  month_key VARCHAR(7) NOT NULL,
  event_at TIMESTAMP NOT NULL,
  status VARCHAR(20) DEFAULT 'registered',
  claimed_at TIMESTAMP,
  reminder_7d_sent BOOLEAN DEFAULT FALSE,
  reminder_3d_sent BOOLEAN DEFAULT FALSE,
  reminder_day_sent BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, event_type, month_key)
);

CREATE INDEX IF NOT EXISTS idx_cult_event_registrations_event ON cult_event_registrations(event_type, event_at);

-- Moderation table
CREATE TABLE IF NOT EXISTS moderation (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Banned content
  words TEXT[] DEFAULT '{}',
  links TEXT[] DEFAULT '{}',
  patterns TEXT[] DEFAULT '{}',

  -- Metadata
  updated_by VARCHAR(255),
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- User moderation actions
CREATE TABLE IF NOT EXISTS user_moderation_actions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  moderator_id VARCHAR(255) NOT NULL REFERENCES users(id),

  -- Action details
  action_type VARCHAR(50) NOT NULL, -- warn, mute, ban, unban
  reason TEXT,
  duration INTEGER, -- in minutes, null for permanent

  -- Status
  active BOOLEAN DEFAULT TRUE,
  expires_at TIMESTAMP,

  -- Metadata
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for moderation actions
CREATE INDEX IF NOT EXISTS idx_moderation_actions_user_id ON user_moderation_actions(user_id);
CREATE INDEX IF NOT EXISTS idx_moderation_actions_active ON user_moderation_actions(active);

-- Warnings table for warning system
CREATE TABLE IF NOT EXISTS warnings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  admin_id VARCHAR(255) NOT NULL REFERENCES users(id),
  group_id VARCHAR(255) NOT NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  cleared BOOLEAN DEFAULT FALSE,
  cleared_at TIMESTAMP,
  cleared_by VARCHAR(255),
  expires_at TIMESTAMP
);

-- Indexes for warnings
CREATE INDEX IF NOT EXISTS idx_warnings_user_id ON warnings(user_id);
CREATE INDEX IF NOT EXISTS idx_warnings_group_id ON warnings(group_id);
CREATE INDEX IF NOT EXISTS idx_warnings_active ON warnings(cleared);

-- Banned users table
CREATE TABLE IF NOT EXISTS banned_users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id VARCHAR(255) NOT NULL,
  reason TEXT,
  banned_by VARCHAR(255) NOT NULL,
  banned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP,
  active BOOLEAN DEFAULT TRUE,
  UNIQUE(user_id, group_id)
);

-- Indexes for banned users
CREATE INDEX IF NOT EXISTS idx_banned_users_user_id ON banned_users(user_id);
CREATE INDEX IF NOT EXISTS idx_banned_users_group_id ON banned_users(group_id);
CREATE INDEX IF NOT EXISTS idx_banned_users_active ON banned_users(active);

-- Moderation logs table
CREATE TABLE IF NOT EXISTS moderation_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  group_id VARCHAR(255) NOT NULL,
  action VARCHAR(50) NOT NULL,
  user_id VARCHAR(255),
  moderator_id VARCHAR(255),
  target_user_id VARCHAR(255),
  reason TEXT,
  details JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for moderation logs
CREATE INDEX IF NOT EXISTS idx_moderation_logs_group_id ON moderation_logs(group_id);
CREATE INDEX IF NOT EXISTS idx_moderation_logs_action ON moderation_logs(action);
CREATE INDEX IF NOT EXISTS idx_moderation_logs_user_id ON moderation_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_moderation_logs_created_at ON moderation_logs(created_at);

-- Username history table
CREATE TABLE IF NOT EXISTS username_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  old_username VARCHAR(255),
  new_username VARCHAR(255),
  group_id VARCHAR(255),
  changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  flagged BOOLEAN DEFAULT FALSE,
  flagged_by VARCHAR(255),
  flag_reason TEXT
);

-- Indexes for username history
CREATE INDEX IF NOT EXISTS idx_username_history_user_id ON username_history(user_id);
CREATE INDEX IF NOT EXISTS idx_username_history_group_id ON username_history(group_id);
CREATE INDEX IF NOT EXISTS idx_username_history_flagged ON username_history(flagged);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for updated_at
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_plans_updated_at BEFORE UPDATE ON plans FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_payments_updated_at BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_calls_updated_at BEFORE UPDATE ON calls FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_call_packages_updated_at BEFORE UPDATE ON call_packages FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_live_streams_updated_at BEFORE UPDATE ON live_streams FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_radio_stations_updated_at BEFORE UPDATE ON radio_stations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_promo_codes_updated_at BEFORE UPDATE ON promo_codes FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
