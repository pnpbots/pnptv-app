-- Migration 256: Drop Stripe columns from users and payments tables
-- Stripe payment integration was fully removed 2026-05-28.
-- These columns are no longer written to by any code path.

-- users table — Stripe customer ID (used for recurring billing, now retired)
ALTER TABLE users
  DROP COLUMN IF EXISTS stripe_customer_id;

-- payments table — Stripe-specific columns
ALTER TABLE payments
  DROP COLUMN IF EXISTS stripe_session_id,
  DROP COLUMN IF EXISTS stripe_subscription_id,
  DROP COLUMN IF EXISTS stripe_invoice_id,
  DROP COLUMN IF EXISTS stripe_payment_intent_id;

-- plans table — Stripe Price ID (used for checkout session creation, now retired)
ALTER TABLE plans
  DROP COLUMN IF EXISTS stripe_price_id;
