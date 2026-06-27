-- Migration 283: Add creator_role column + approved_hold status
-- 2026-06-27

BEGIN;

-- 1. Drop and re-create the creator_status CHECK to include 'approved_hold'
ALTER TABLE users
  DROP CONSTRAINT users_creator_status_check;

ALTER TABLE users
  ADD CONSTRAINT users_creator_status_check
    CHECK (creator_status = ANY (ARRAY[
      'none','eligible','pending_review','active','suspended','approved_hold'
    ]));

COMMENT ON COLUMN users.creator_status IS
  'Creator application state. none=default, eligible=unlocked for apply, pending_review=under review, active=fully live, suspended=disabled, approved_hold=approved by self-service flow but capabilities paused until admin clicks Activate.';

-- 2. Add creator_role column
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS creator_role VARCHAR(20) DEFAULT NULL;

ALTER TABLE users
  ADD CONSTRAINT chk_users_creator_role
    CHECK (creator_role IS NULL OR creator_role IN ('creator','performer','both'));

COMMENT ON COLUMN users.creator_role IS
  'Role granted to an approved creator. ''creator''=exclusive paid content (Ice/Crystal/Diamond tiers). ''performer''=PNP Live streaming. ''both''=both capabilities. NULL until creator_status reaches an approved state.';

-- 3. Partial index for fast role filtering
CREATE INDEX IF NOT EXISTS idx_users_creator_role
  ON users(creator_role)
  WHERE creator_role IS NOT NULL;

-- 4. Backfill: all active creators with no role assigned → 'both'
UPDATE users
  SET creator_role = 'both'
  WHERE creator_status = 'active'
    AND creator_role IS NULL;

-- Backfilled 42 rows (SELECT COUNT(*) FROM users WHERE creator_status='active' run 2026-06-27)

COMMIT;
