-- Migration 254: Stripe integrity fixes
-- 1. Unique constraint on payments.stripe_session_id prevents concurrent webhook
--    deliveries from double-inserting and double-granting entitlements.
--    NULL values are exempt from the constraint (many payments use other providers).
-- 2. Add stripe_session_id to token_purchases so Stripe token checkouts have a
--    proper idempotency link (tokenCheckoutService.js:380 writes this column).

ALTER TABLE payments
  ADD CONSTRAINT payments_stripe_session_id_unique
  UNIQUE (stripe_session_id);

ALTER TABLE token_purchases
  ADD COLUMN IF NOT EXISTS stripe_session_id VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_token_purchases_stripe_session_id
  ON token_purchases (stripe_session_id)
  WHERE stripe_session_id IS NOT NULL;
