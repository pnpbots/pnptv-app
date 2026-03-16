-- Migration: 168_creator_upgrade_flow.sql
-- Purpose: Creator/Model upgrade flow — subscription code, engagement scoring,
--          live channel helper, milestone notifications, and add-on seed.
-- Safe to re-run: all DDL uses IF NOT EXISTS / CREATE OR REPLACE / ON CONFLICT.

BEGIN;

-- ============================================================
-- 1. Add creator_subscription_code to users
--    Internal reference code, unique per creator.
--    Generated at activation time by generate_creator_code().
-- ============================================================
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS creator_subscription_code VARCHAR(32);

-- Add the UNIQUE constraint only if it doesn't already exist.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'users_creator_subscription_code_key'
      AND conrelid = 'users'::regclass
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_creator_subscription_code_key
      UNIQUE (creator_subscription_code);
  END IF;
END;
$$;

-- ============================================================
-- 2. Add creator engagement score columns to users
--    Computed externally from last-30-day interactions;
--    written back here for fast tier lookups / pricing logic.
-- ============================================================
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS creator_engagement_score INTEGER NOT NULL DEFAULT 0;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS creator_engagement_updated_at TIMESTAMPTZ;

-- Partial index: only active creators need fast engagement lookups.
CREATE INDEX IF NOT EXISTS idx_users_creator_engagement
  ON users (creator_engagement_score DESC)
  WHERE creator_status = 'active';

-- ============================================================
-- 3. generate_live_channel()
--    Returns 'pnptv-<sanitised_username>' with numeric suffix
--    fallback on collision. Called by the backend when
--    creator_status transitions to 'active' and
--    users.live_channel IS NULL.
-- ============================================================
CREATE OR REPLACE FUNCTION generate_live_channel(p_username TEXT, p_user_id VARCHAR)
RETURNS VARCHAR(100) LANGUAGE plpgsql AS $$
DECLARE
  v_slug   VARCHAR(100);
  v_base   VARCHAR(80);
  v_suffix INT := 0;
  v_exists BOOLEAN;
BEGIN
  -- Sanitise: lowercase, strip non-alphanumeric, keep hyphens
  v_base := lower(regexp_replace(coalesce(p_username, 'creator'), '[^a-z0-9\-]', '', 'g'));
  -- Trim to 60 chars and remove leading/trailing hyphens
  v_base := trim(BOTH '-' FROM substring(v_base, 1, 60));
  IF length(v_base) = 0 THEN
    v_base := 'creator';
  END IF;

  v_slug := 'pnptv-' || v_base;
  LOOP
    SELECT EXISTS (
      SELECT 1 FROM users WHERE live_channel = v_slug AND id != p_user_id
    ) INTO v_exists;
    EXIT WHEN NOT v_exists;
    v_suffix := v_suffix + 1;
    v_slug := 'pnptv-' || v_base || '-' || v_suffix::TEXT;
  END LOOP;
  RETURN v_slug;
END;
$$;

-- ============================================================
-- 4. generate_creator_code()
--    Generates a unique 12-char alphanumeric code.
--    Called once per creator activation.
-- ============================================================
CREATE OR REPLACE FUNCTION generate_creator_code()
RETURNS VARCHAR(32) LANGUAGE plpgsql AS $$
DECLARE
  v_code VARCHAR(32);
  v_exists BOOLEAN;
BEGIN
  LOOP
    v_code := upper(substring(
      replace(replace(replace(
        encode(gen_random_bytes(9), 'base64'),
        '+', ''),
        '/', ''),
        '=', ''),
      1, 12
    ));
    SELECT EXISTS (
      SELECT 1 FROM users WHERE creator_subscription_code = v_code
    ) INTO v_exists;
    EXIT WHEN NOT v_exists;
  END LOOP;
  RETURN v_code;
END;
$$;

-- ============================================================
-- 5. creator_milestone_notifications
--    Tracks eligibility and engagement-tier-up notifications
--    sent to users on their journey to becoming creators.
-- ============================================================
CREATE TABLE IF NOT EXISTS creator_milestone_notifications (
  id               BIGSERIAL PRIMARY KEY,
  user_id          VARCHAR NOT NULL
                     REFERENCES users(id) ON DELETE CASCADE,
  milestone_type   VARCHAR(64)  NOT NULL DEFAULT 'eligible',
  status           VARCHAR(32)  NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'accepted', 'declined')),
  responded_at     TIMESTAMPTZ,
  decline_cooldown_until TIMESTAMPTZ,
  metadata         JSONB        NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_creator_milestone_user_id
  ON creator_milestone_notifications (user_id);

CREATE INDEX IF NOT EXISTS idx_creator_milestone_status
  ON creator_milestone_notifications (user_id, status, milestone_type);

-- ============================================================
-- 6. Seed add_ons — ensure 'creator-subscription' row exists.
-- ============================================================
INSERT INTO add_ons (id, name, description, add_on_type, is_active)
VALUES (
  'creator-subscription',
  'Creator Subscription',
  'Subscribe to a creator for exclusive content and direct messaging',
  'recurring',
  true
)
ON CONFLICT (id) DO UPDATE SET
  name        = EXCLUDED.name,
  description = EXCLUDED.description,
  is_active   = true;

COMMIT;
