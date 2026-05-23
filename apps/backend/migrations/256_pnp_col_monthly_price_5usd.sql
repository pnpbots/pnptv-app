-- Migration 256: Correct pnp_col_monthly price to $5.00 USD.
--
-- Commit 880f1416 intended to lower the Colombia monthly plan from $49.99 to
-- $5.00 but only touched routes.js; the DB was never updated.  The Stripe
-- price_id also needs replacing because Stripe prices are immutable.
-- Run scripts/fix-pnp-col-price.js BEFORE applying this migration — that
-- script creates the new $5 Stripe price and outputs the new price_id which
-- you paste into the UPDATE below.
--
-- After running the script, fill in NEW_STRIPE_PRICE_ID and apply:
--   docker exec pg-pnptv psql -U pnptvbot -d pnptvbot -f /path/to/256_pnp_col_monthly_price_5usd.sql

UPDATE plans
SET
  price          = 5.00,
  price_in_cop   = ROUND(5.00 * 4000)::numeric(10,2),
  stripe_price_id = 'price_1TaAOr2cOQFhFdEWRWJxqTtd'
WHERE id = 'pnp_col_monthly';
