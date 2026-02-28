-- 091_creator_tiers_strikes.sql
-- Creator Tiers (Ice/Crystal/Diamond) + Strike System

-- 1. Add strikes counter
ALTER TABLE users ADD COLUMN IF NOT EXISTS creator_strikes INT DEFAULT 0;

-- 2. Add terms acceptance timestamp
ALTER TABLE users ADD COLUMN IF NOT EXISTS creator_terms_accepted_at TIMESTAMPTZ;

-- 3. Expand creator_type to allow tier values
-- Drop old CHECK constraint, add new one
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_creator_type_check;
ALTER TABLE users ADD CONSTRAINT users_creator_type_check
  CHECK (creator_type IN ('ice', 'crystal', 'diamond', 'occasional', 'full_time'));

-- 4. Creator strike log for audit trail
CREATE TABLE IF NOT EXISTS creator_strike_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id VARCHAR(255) REFERENCES users(id) ON DELETE CASCADE,
  strike_number INT NOT NULL,
  reason TEXT NOT NULL,
  issued_by VARCHAR(255) DEFAULT 'system',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_creator_strike_log_creator
  ON creator_strike_log(creator_id, created_at DESC);

-- 5. Update plans seed with tier pricing
INSERT INTO plans (id, sku, name, display_name, tier, price, currency, duration, duration_days, features, active, is_recurring, billing_interval, billing_interval_count)
VALUES
  ('creator_ice', 'PNP-CR-ICE', 'Ice Profile', 'Ice Profile', 'creator', 5.00, 'USD', 30, 30,
    '["Ice creator badge","Exclusive content access","Basic monetization"]', true, true, 'month', 1),
  ('creator_crystal', 'PNP-CR-CRYSTAL', 'Crystal Profile', 'Crystal Profile', 'creator', 10.00, 'USD', 30, 30,
    '["Crystal creator badge","Exclusive content access","Enhanced monetization","Priority placement"]', true, true, 'month', 1),
  ('creator_diamond', 'PNP-CR-DIAMOND', 'Diamond Profile', 'Diamond Profile', 'creator', 15.00, 'USD', 30, 30,
    '["Diamond creator badge","Exclusive content access","Full monetization","Featured placement","Priority support"]', true, true, 'month', 1)
ON CONFLICT (id) DO NOTHING;
