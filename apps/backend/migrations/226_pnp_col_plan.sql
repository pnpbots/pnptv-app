-- Migration 226: PNP Col plan + 'pnp-col' marker add-on.
--
-- Users located in Colombia (country='CO') have NO access to any content
-- unless they hold an active 'pnp-col' entitlement. The check lives in the
-- colombiaAccessGate middleware in bot/api/routes.js. This migration seeds
-- the required plans + add-on + mappings; grantEntitlementsForPlan issues
-- the entitlements through the existing plan_add_ons pipeline after payment.
--
-- Two SKUs per the approved plan: monthly $49.99 (30-day recurring) and
-- lifetime $49.99 (one-time). Both grant the marker 'pnp-col' plus 'prime'
-- for full-UX parity with global Prime subscribers.
--
-- Idempotent: safe to re-run.

-- 1. Marker add-on: 'pnp-col'
INSERT INTO add_ons (id, name, description, add_on_type, is_active)
VALUES (
  'pnp-col',
  'PNP Col Access',
  'Required for users located in Colombia to access the platform.',
  'recurring',
  true
)
ON CONFLICT (id) DO NOTHING;

-- 2. Plan: PNP Col Monthly (30-day recurring, $49.99 USD)
INSERT INTO plans (
  id, sku, name, display_name, tier,
  price, currency, price_in_cop,
  duration, duration_days,
  description, features, active, is_lifetime,
  is_recurring, billing_interval, billing_interval_count
)
VALUES (
  'pnp_col_monthly',
  'PNP-COL-M30',
  'PNP Col Monthly',
  'PNP Col — Monthly',
  'pnp-col',
  49.99, 'USD', ROUND(49.99 * 4000)::numeric(10,2),
  30, 30,
  'Full platform access for users in Colombia. Billed every 30 days.',
  '["Full platform access for Colombia","Prime UX tier","Renews every 30 days"]'::jsonb,
  true, false,
  true, 'month', 1
)
ON CONFLICT (id) DO NOTHING;

-- 3. Plan: PNP Col Lifetime (one-time, $49.99 USD)
INSERT INTO plans (
  id, sku, name, display_name, tier,
  price, currency, price_in_cop,
  duration, duration_days,
  description, features, active, is_lifetime,
  is_recurring
)
VALUES (
  'pnp_col_lifetime',
  'PNP-COL-LIFE',
  'PNP Col Lifetime',
  'PNP Col — Lifetime',
  'pnp-col',
  49.99, 'USD', ROUND(49.99 * 4000)::numeric(10,2),
  36500, 36500,
  'Lifetime platform access for users in Colombia. One-time payment.',
  '["Full platform access for Colombia","Prime UX tier","One-time payment — never expires"]'::jsonb,
  true, true,
  false
)
ON CONFLICT (id) DO NOTHING;

-- 4. Plan → add-on mappings.
-- Monthly grants 30-day pnp-col + 30-day prime. Lifetime grants lifetime both.
INSERT INTO plan_add_ons (plan_id, add_on_id, duration_days, is_lifetime) VALUES
  ('pnp_col_monthly',  'pnp-col', 30,   false),
  ('pnp_col_monthly',  'prime',   30,   false),
  ('pnp_col_lifetime', 'pnp-col', NULL, true),
  ('pnp_col_lifetime', 'prime',   NULL, true)
ON CONFLICT (plan_id, add_on_id) DO NOTHING;
