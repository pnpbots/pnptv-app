-- 088_creator_monetization.sql
-- Creator Monetization System: Two Paths (Occasional & Full-Time)

-- 1a. Creator columns on users
ALTER TABLE users ADD COLUMN IF NOT EXISTS creator_status VARCHAR(20) DEFAULT 'none'
  CHECK (creator_status IN ('none','eligible','pending_review','active','suspended'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS creator_type VARCHAR(20) DEFAULT NULL
  CHECK (creator_type IN ('occasional','full_time'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS creator_enabled_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS creator_subscriber_count INT DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS creator_price_usd NUMERIC(10,2) DEFAULT 15.00;
ALTER TABLE users ADD COLUMN IF NOT EXISTS creator_verified BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS creator_featured BOOLEAN DEFAULT FALSE;

-- 1b. is_exclusive on social_posts
ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS is_exclusive BOOLEAN DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_social_posts_exclusive
  ON social_posts(user_id, id DESC) WHERE is_exclusive = TRUE AND is_deleted = FALSE;

-- 1c. creator_subscriptions table
CREATE TABLE IF NOT EXISTS creator_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id VARCHAR(255) REFERENCES users(id) ON DELETE CASCADE,
  subscriber_id VARCHAR(255) REFERENCES users(id) ON DELETE CASCADE,
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active','cancelled','expired')),
  price_usd NUMERIC(10,2) NOT NULL,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  cancelled_at TIMESTAMPTZ,
  payment_id UUID,
  auto_renew BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(creator_id, subscriber_id),
  CHECK(creator_id != subscriber_id)
);

CREATE INDEX IF NOT EXISTS idx_creator_subs_subscriber ON creator_subscriptions(subscriber_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_creator_subs_creator ON creator_subscriptions(creator_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_creator_subs_expires ON creator_subscriptions(expires_at) WHERE status = 'active';

-- 1d. creator_earnings table
CREATE TABLE IF NOT EXISTS creator_earnings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id VARCHAR(255) REFERENCES users(id) ON DELETE CASCADE,
  subscription_id UUID REFERENCES creator_subscriptions(id),
  amount_gross NUMERIC(10,2) NOT NULL,
  amount_creator NUMERIC(10,2) NOT NULL,
  amount_platform NUMERIC(10,2) NOT NULL,
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','available','paid_out')),
  period_month DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_creator_earnings_creator ON creator_earnings(creator_id, created_at DESC);

-- 1e. Add requested_price_usd to model_applications (used by full-time creator path)
ALTER TABLE model_applications ADD COLUMN IF NOT EXISTS requested_price_usd NUMERIC(10,2);

-- 1f. Seed creator plan in plans
INSERT INTO plans (id, sku, name, display_name, tier, price, currency, duration, duration_days, features, active, is_recurring, billing_interval, billing_interval_count)
VALUES ('creator_monthly', 'EASYBOTS-PNP-CR', 'Creator Subscription', 'Creator Subscription', 'creator', 15.00, 'USD', 30, 30,
  '["Exclusive creator content","Support your favorite creators"]', true, true, 'month', 1)
ON CONFLICT (id) DO NOTHING;
