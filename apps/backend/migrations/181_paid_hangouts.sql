-- 181: Add paid hangout support
-- Allows group owners to set a price for joining their hangout

ALTER TABLE hangout_groups
  ADD COLUMN IF NOT EXISTS is_paid BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS price_usd NUMERIC(10,2) DEFAULT 0;

-- Index for discovering paid hangouts
CREATE INDEX IF NOT EXISTS idx_hangout_groups_is_paid ON hangout_groups (is_paid) WHERE is_paid = true;

COMMENT ON COLUMN hangout_groups.is_paid IS 'Whether this hangout requires payment to join';
COMMENT ON COLUMN hangout_groups.price_usd IS 'Entry price in USD (0 = free)';
