-- Migration 190: hangout_access plan template for standalone paid hangout purchases.
--
-- Standalone paid hangouts (hangout_groups.is_paid=true without a linked channel)
-- need a plan template so grantEntitlementsForPlan's plan_add_ons lookup fires.
-- Actual price is overridden per-purchase at the route level from
-- hangout_groups.price_usd. The plan's price column is a placeholder only.
--
-- Idempotent: safe to re-run.

INSERT INTO plans (id, name, display_name, tier, price, currency, duration, duration_days, active)
VALUES (
  'hangout_access',
  'Hangout Access',
  'Hangout Access',
  'hangout',
  1.00,           -- placeholder; actual amount overridden per-purchase
  'USD',
  36500,          -- legacy duration column (same as duration_days)
  36500,          -- 100 years, acts as lifetime for practical purposes
  false           -- hidden from /subscribe (tier='hangout' also filtered by getPublicPlans)
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO plan_add_ons (plan_id, add_on_id, duration_days, is_lifetime)
VALUES ('hangout_access', 'hangout-access', NULL, false)
ON CONFLICT (plan_id, add_on_id) DO NOTHING;
