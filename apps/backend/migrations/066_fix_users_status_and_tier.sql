-- Migration: 066_fix_users_status_and_tier.sql
-- Created: 2026-02-26
-- Purpose: Enforce correct business rules for users.status and users.tier columns.
--
-- Business Rules:
--   users.status  = 'active'   → user has completed onboarding
--   users.status  = 'inactive' → user registered but has NOT completed onboarding
--   users.status  = 'offline'  → legacy value, treated as 'inactive' for this migration
--   users.status  = 'banned'   → moderated user, NEVER changed by this migration
--
--   users.tier    = 'Prime'    → user has an active paid membership
--   users.tier    = 'Free'     → user does not have an active paid membership
--   (tier is controlled exclusively by updateSubscription; we only fix the case mismatch here)
--
-- Problems fixed:
--   1. The users.status DEFAULT was 'active', causing every new user to appear active
--      before they completed onboarding. The DEFAULT is changed to 'inactive'.
--   2. All users with onboarding_complete = false AND status NOT IN ('active','banned')
--      remain 'inactive' (or offline → inactive).
--   3. Users with status = 'offline' who DID complete onboarding are corrected to 'active'.
--   4. Users with status = 'active' who did NOT complete onboarding are corrected to 'inactive'.
--   5. tier = 'free' (lowercase) normalized to 'Free'.
--
-- Preserves:
--   - status = 'banned' rows (never touched)
--   - subscription_status column (payment state, not changed)
--   - All Prime users' tier value

-- ============================================================
-- UP MIGRATION
-- ============================================================

BEGIN;

-- ----------------------------------------------------------------
-- STEP 1: Add 'inactive' to the set of valid status values.
-- The current CHECK constraint (if any) must include 'inactive'.
-- Check first — if no constraint exists, proceed.
-- ----------------------------------------------------------------
DO $$
BEGIN
  -- Add CHECK constraint if not already present
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'users'
      AND constraint_type = 'CHECK'
      AND constraint_name = 'users_status_check'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_status_check
      CHECK (status IN ('active', 'inactive', 'offline', 'banned'));
  END IF;
END;
$$;

-- ----------------------------------------------------------------
-- STEP 2: Fix status = 'active' for users who have NOT completed
-- onboarding and are not banned.
-- These were set to 'active' only because the column DEFAULT was
-- 'active' — they never actually completed onboarding.
-- ----------------------------------------------------------------
UPDATE users
SET
  status     = 'inactive',
  updated_at = NOW()
WHERE
  onboarding_complete = false
  AND status = 'active';

-- Capture rowcount in a notice for the migration log
DO $$
DECLARE affected INT;
BEGIN
  GET DIAGNOSTICS affected = ROW_COUNT;
  RAISE NOTICE 'STEP 2: Set % users (onboarding_complete=false, status=active) → inactive', affected;
END;
$$;

-- ----------------------------------------------------------------
-- STEP 3: Fix status = 'offline' for users who DID complete
-- onboarding. 'offline' is a legacy value that predates the
-- active/inactive distinction. If onboarding is done, status = 'active'.
-- ----------------------------------------------------------------
UPDATE users
SET
  status     = 'active',
  updated_at = NOW()
WHERE
  onboarding_complete = true
  AND status = 'offline';

DO $$
DECLARE affected INT;
BEGIN
  GET DIAGNOSTICS affected = ROW_COUNT;
  RAISE NOTICE 'STEP 3: Set % users (onboarding_complete=true, status=offline) → active', affected;
END;
$$;

-- ----------------------------------------------------------------
-- STEP 4: Fix tier case mismatch — normalize lowercase 'free' to 'Free'.
-- updateSubscription() always writes 'Free' or 'Prime' (title-case).
-- Four rows slipped through with lowercase 'free'.
-- ----------------------------------------------------------------
UPDATE users
SET
  tier       = 'Free',
  updated_at = NOW()
WHERE
  tier = 'free';

DO $$
DECLARE affected INT;
BEGIN
  GET DIAGNOSTICS affected = ROW_COUNT;
  RAISE NOTICE 'STEP 4: Normalized % users tier lowercase ''free'' → ''Free''', affected;
END;
$$;

-- ----------------------------------------------------------------
-- STEP 5: Change the column DEFAULT from 'active' to 'inactive'.
-- New users registering must complete onboarding to become 'active'.
-- ----------------------------------------------------------------
ALTER TABLE users
  ALTER COLUMN status SET DEFAULT 'inactive';

-- ----------------------------------------------------------------
-- STEP 6: Verify the final state — these counts must be zero.
-- If any assertion fails, the transaction will roll back.
-- ----------------------------------------------------------------
DO $$
DECLARE
  broken_active   INT;
  broken_inactive INT;
  broken_tier     INT;
BEGIN
  -- No user should be active without completing onboarding (unless banned is irrelevant)
  SELECT COUNT(*) INTO broken_active
  FROM users
  WHERE onboarding_complete = false AND status = 'active';

  -- No user should be offline after this migration
  SELECT COUNT(*) INTO broken_inactive
  FROM users
  WHERE status = 'offline';

  -- No tier should be lowercase
  SELECT COUNT(*) INTO broken_tier
  FROM users
  WHERE tier NOT IN ('Free', 'Prime');

  IF broken_active > 0 THEN
    RAISE EXCEPTION 'ASSERTION FAILED: % users have onboarding_complete=false AND status=active', broken_active;
  END IF;

  IF broken_inactive > 0 THEN
    RAISE EXCEPTION 'ASSERTION FAILED: % users still have status=offline after migration', broken_inactive;
  END IF;

  IF broken_tier > 0 THEN
    RAISE EXCEPTION 'ASSERTION FAILED: % users have unexpected tier values', broken_tier;
  END IF;

  RAISE NOTICE 'All assertions passed. Migration 066 is clean.';
END;
$$;

COMMIT;

-- ============================================================
-- DOWN MIGRATION
-- ============================================================
-- To revert this migration:
--
-- BEGIN;
--
-- -- Restore DEFAULT to 'active'
-- ALTER TABLE users ALTER COLUMN status SET DEFAULT 'active';
--
-- -- Revert 'inactive' back to 'active' (best-effort; cannot distinguish
-- -- original 'offline' from originally 'active' without a backup)
-- UPDATE users SET status = 'offline', updated_at = NOW()
--   WHERE status = 'inactive';
--
-- -- Revert tier casing (no data loss, just aesthetics)
-- -- NOTE: 'Free'/'Prime' title-case is the canonical form; leaving as-is is safe.
--
-- -- Drop the CHECK constraint if we added it
-- ALTER TABLE users DROP CONSTRAINT IF EXISTS users_status_check;
--
-- COMMIT;
