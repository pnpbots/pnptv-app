-- Migration 253: Add Stripe payment columns
-- Adds stripe_customer_id to users, stripe session/subscription tracking to payments,
-- stripe_subscription_id to user_entitlements for renewal lifecycle management,
-- and stripe_price_id to plans so each plan maps to a Stripe Price object.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(255);

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS stripe_session_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS stripe_subscription_id VARCHAR(255);

ALTER TABLE user_entitlements
  ADD COLUMN IF NOT EXISTS stripe_subscription_id VARCHAR(255);

-- Stripe Price ID per plan (set via admin or direct DB update per plan)
ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS stripe_price_id VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_users_stripe_customer_id
  ON users (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payments_stripe_session_id
  ON payments (stripe_session_id)
  WHERE stripe_session_id IS NOT NULL;
