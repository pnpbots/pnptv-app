-- Migration 307: fix status CHECK constraints exposed by tokens-system audit
--
-- CRIT-2: token_purchases.status did not include 'failed', so BTCPay error
--   recovery in tokenCheckoutService.js:190,288 threw a CHECK violation,
--   leaving purchases stuck in 'pending' forever.
--
-- CRIT-3: pnp_tips.payment_status did not include 'cancelled', so both
--   pnpLiveTipsService.cancelTip and the Dash tip abort path in routes.js:9894
--   raised CHECK violations. cancelTip also referenced a non-existent
--   cancelled_at column.
--
-- All three changes are additive (widen the allowed set, add a nullable
-- column) and safe to re-run — the DROP CONSTRAINT uses IF EXISTS and the
-- ADD COLUMN uses IF NOT EXISTS.

-- ── token_purchases.status: add 'failed' ────────────────────────────────
ALTER TABLE token_purchases DROP CONSTRAINT IF EXISTS token_purchases_status_check;
ALTER TABLE token_purchases
  ADD CONSTRAINT token_purchases_status_check
  CHECK (status IN ('pending', 'paid', 'expired', 'invalid', 'failed'));

-- ── pnp_tips.payment_status: add 'cancelled' + column ───────────────────
ALTER TABLE pnp_tips ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;

ALTER TABLE pnp_tips DROP CONSTRAINT IF EXISTS pnp_tips_payment_status_check;
ALTER TABLE pnp_tips
  ADD CONSTRAINT pnp_tips_payment_status_check
  CHECK (payment_status IN ('pending', 'completed', 'failed', 'refunded', 'cancelled'));
