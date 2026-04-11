-- Migration 187: Channel-Hangout Linking
-- Adds access_type pricing tiers to creator_channels and a bidirectional FK
-- between creator_channels and hangout_groups.
--
-- access_type values:
--   free         → anyone can access
--   prime        → requires active PRIME entitlement
--   subscription → requires active creator_subscriptions row for this creator
--   paid         → one-time payment via user_entitlements
--
-- price_usd allowed: 0, 5, 10, 15, 20, 25
-- Constraint names are idempotent-safe via IF NOT EXISTS (Postgres 11+).

-- 1. New columns on creator_channels
ALTER TABLE creator_channels ADD COLUMN IF NOT EXISTS access_type TEXT NOT NULL DEFAULT 'free';
ALTER TABLE creator_channels DROP CONSTRAINT IF EXISTS chk_channel_access_type;
ALTER TABLE creator_channels ADD CONSTRAINT chk_channel_access_type
  CHECK (access_type IN ('free','prime','subscription','paid'));

ALTER TABLE creator_channels ADD COLUMN IF NOT EXISTS price_usd NUMERIC(10,2) DEFAULT 0;
ALTER TABLE creator_channels DROP CONSTRAINT IF EXISTS chk_channel_price;
ALTER TABLE creator_channels ADD CONSTRAINT chk_channel_price
  CHECK (price_usd IN (0,5,10,15,20,25));

ALTER TABLE creator_channels ADD COLUMN IF NOT EXISTS hangout_group_id INTEGER
  UNIQUE REFERENCES hangout_groups(id) ON DELETE SET NULL;

-- 2. New column on hangout_groups (back-reference)
ALTER TABLE hangout_groups ADD COLUMN IF NOT EXISTS channel_id INTEGER
  UNIQUE REFERENCES creator_channels(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_hangout_groups_channel
  ON hangout_groups(channel_id)
  WHERE channel_id IS NOT NULL;

-- 3. Backfill existing channels from binary is_premium flag
UPDATE creator_channels SET access_type = 'subscription' WHERE is_premium = true;
UPDATE creator_channels SET access_type = 'free'         WHERE is_premium = false OR is_premium IS NULL;
