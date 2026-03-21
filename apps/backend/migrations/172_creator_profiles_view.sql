-- Creator Profiles VIEW + Performance Indexes
-- Provides a clean read model for creator data without moving columns

CREATE OR REPLACE VIEW creator_profiles AS
SELECT
  u.id,
  u.username,
  u.first_name,
  u.last_name,
  u.creator_status,
  u.creator_type,
  u.creator_verified,
  u.creator_featured,
  u.creator_price_usd,
  u.creator_wallet_address,
  u.creator_wallet_verified,
  u.creator_payout_chain_id,
  u.payout_method,
  u.meru_account,
  u.fiat_payout_method,
  u.fiat_payout_account,
  u.creator_strikes,
  u.creator_subscriber_count,
  u.creator_engagement_score,
  u.creator_engagement_updated_at,
  u.creator_subscription_code,
  u.live_channel,
  u.creator_enabled_at,
  u.creator_terms_accepted_at,
  u.authentik_sub,
  u.email,
  u.created_at,
  u.updated_at
FROM users u
WHERE u.creator_status IN ('active', 'eligible', 'pending_review', 'suspended');

-- Partial indexes for creator queries (only index rows where creator data exists)
CREATE INDEX IF NOT EXISTS idx_users_creator_status
  ON users(creator_status) WHERE creator_status IS NOT NULL AND creator_status != 'none';

CREATE INDEX IF NOT EXISTS idx_users_creator_type
  ON users(creator_type) WHERE creator_type IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_creator_subscription_code
  ON users(creator_subscription_code) WHERE creator_subscription_code IS NOT NULL;
