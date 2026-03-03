-- Migration 100: Add CHECK constraint to plans.tier column
-- Risk remediation: plans.tier was a free-text VARCHAR with no validation.
-- This adds a constraint matching the canonical tier vocabulary used across the platform.
-- Canonical values: 'free' (unused for plans but allowed), 'member', 'PRIME', 'creator'
--
-- Safe to apply: will fail with a descriptive error if any row has an invalid tier value,
-- allowing the operator to inspect and fix before the constraint goes live.

-- Up
DO $$ BEGIN
  -- Guard: only add if constraint does not already exist
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'plans'::regclass AND conname = 'plans_tier_check'
  ) THEN
    ALTER TABLE plans ADD CONSTRAINT plans_tier_check
      CHECK (tier IN ('free', 'member', 'PRIME', 'creator'));
  END IF;
END $$;

-- Down (to revert)
-- ALTER TABLE plans DROP CONSTRAINT IF EXISTS plans_tier_check;
