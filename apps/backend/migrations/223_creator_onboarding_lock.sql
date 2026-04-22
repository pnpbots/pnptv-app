-- 223_creator_onboarding_lock.sql
-- Temporarily lock all currently-approved creators from using creator tools
-- and from charging users for their content, pending the first-cohort
-- onboarding program starting ~2 weeks from 2026-04-22.
--
-- Design: non-destructive boolean flag separate from creator_status.
-- creator_status stays 'active' so subscriber counts, earnings rows, etc.
-- remain consistent. To unlock a creator after onboarding:
--   UPDATE users SET creator_locked = FALSE WHERE id = $1;

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS creator_locked BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN users.creator_locked IS
  'When TRUE, user is an approved creator whose tools are temporarily disabled pending onboarding. Cleared per-user after onboarding completes.';

-- Lock every currently-approved creator as of this migration,
-- EXCEPT the creators explicitly exempted below. The exempt list is
-- kept in-line rather than in a new table so the migration is
-- self-documenting: future unlocks are a single UPDATE per user.
-- Exempt (2026-04-22): @santinofurioso, @pnplatinoboy.
UPDATE users
   SET creator_locked = TRUE,
       updated_at     = NOW()
 WHERE creator_status = 'active'
   AND creator_locked = FALSE
   AND UPPER(username) NOT IN ('SANTINOFURIOSO', 'PNPLATINOBOY');

-- Partial index for fast "list all locked creators" queries in admin UI.
CREATE INDEX IF NOT EXISTS idx_users_creator_locked
  ON users (id)
  WHERE creator_locked = TRUE;

COMMIT;
