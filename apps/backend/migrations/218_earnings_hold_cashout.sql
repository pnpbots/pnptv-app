-- 218_earnings_hold_cashout.sql
-- Add 72-hour hold to creator_earnings + fiat_cashout_orders table

-- 2a. Extend creator_earnings status enum (existing CHECK allows pending/available/paid_out)
-- We add: holding (new initial state), refund_review (refund filed during hold), void (refund completed)
ALTER TABLE creator_earnings DROP CONSTRAINT IF EXISTS creator_earnings_status_check;
ALTER TABLE creator_earnings ADD CONSTRAINT creator_earnings_status_check
  CHECK (status IN ('pending', 'holding', 'available', 'refund_review', 'void', 'in_payout', 'paid_out'));

-- 2b. available_at — when earnings mature from holding → available
ALTER TABLE creator_earnings ADD COLUMN IF NOT EXISTS available_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_creator_earnings_maturation
  ON creator_earnings(available_at)
  WHERE status = 'holding';

-- 2c. Optional link to originating payment for refund reversal
ALTER TABLE creator_earnings ADD COLUMN IF NOT EXISTS source_payment_id VARCHAR(255);
CREATE INDEX IF NOT EXISTS idx_creator_earnings_source_payment
  ON creator_earnings(source_payment_id) WHERE source_payment_id IS NOT NULL;

-- 2d. fiat_cashout_orders — creator-initiated cash-out via one of 3 lanes
CREATE TABLE IF NOT EXISTS fiat_cashout_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  amount_usd NUMERIC(12,2) NOT NULL CHECK (amount_usd > 0),
  lane VARCHAR(32) NOT NULL CHECK (lane IN ('onchain_usdt','bitrefill','transak')),
  status VARCHAR(32) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','settled','failed','cancelled')),
  -- Lane-specific destination details (TRC-20 address, bitrefill product id, transak session id, etc.)
  destination JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Snapshot of earning IDs being drawn down by this order (for reversibility)
  earning_ids UUID[] NOT NULL DEFAULT '{}',
  -- Provider references
  provider_ref VARCHAR(255),
  provider_meta JSONB DEFAULT '{}'::jsonb,
  -- Error diagnostics
  failure_reason TEXT,
  -- Timeline
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  settled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cashout_creator ON fiat_cashout_orders(creator_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_cashout_status ON fiat_cashout_orders(status) WHERE status IN ('pending','processing');

-- 2e. Backfill safety: any legacy rows currently in 'available' stay 'available' (grandfathered)
-- New inserts will start at 'holding' with available_at set by the services.
