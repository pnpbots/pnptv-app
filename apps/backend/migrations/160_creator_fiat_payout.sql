-- Migration 160: Add fiat payout preferences for creators
-- Supports Peer Protocol off-ramp: Venmo, CashApp, Zelle, PayPal, Wise, Revolut
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS fiat_payout_method TEXT,
  ADD COLUMN IF NOT EXISTS fiat_payout_account TEXT;

COMMENT ON COLUMN users.fiat_payout_method IS 'Fiat off-ramp provider: venmo, cashapp, zelle, paypal, wise, revolut';
COMMENT ON COLUMN users.fiat_payout_account IS 'Fiat off-ramp recipient handle/email/phone';
