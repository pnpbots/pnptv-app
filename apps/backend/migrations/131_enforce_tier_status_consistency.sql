-- Migration 131: Enforce tier↔subscription_status consistency
-- Rule: PRIME tier MUST have subscription_status='active'
--       churned/free status MUST NOT have PRIME or member tier
-- ─────────────────────────────────────────────────────────────

-- Step 1: Fix any existing discrepancies

-- PRIME users with wrong status → force 'active'
UPDATE users
SET subscription_status = 'active', updated_at = NOW()
WHERE tier = 'PRIME' AND subscription_status != 'active';

-- member users with wrong status → force 'active'
UPDATE users
SET subscription_status = 'active', updated_at = NOW()
WHERE tier = 'member' AND subscription_status != 'active';

-- churned/free status with paid tier → force 'free' tier
UPDATE users
SET tier = 'free', updated_at = NOW()
WHERE subscription_status IN ('churned', 'free')
  AND tier IN ('PRIME', 'member');

-- Step 2: Add CHECK constraint to prevent future mismatches
-- Allowed combinations:
--   tier='PRIME'  + status='active'
--   tier='member' + status='active'
--   tier='free'   + status IN ('free','churned')
--   tier='banned' + any status (bans are special)
ALTER TABLE users
  ADD CONSTRAINT chk_tier_status_consistency
  CHECK (
    tier = 'banned'
    OR (tier IN ('PRIME', 'member') AND subscription_status = 'active')
    OR (tier = 'free' AND subscription_status IN ('free', 'churned'))
  );
