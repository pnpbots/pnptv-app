-- Migration 139: Account Deletion Integrity
-- Created: 2026-03-11
-- Purpose: Fixes three critical gaps in the account deletion/anonymization flow:
--   1. The deleteMyAccount UPDATE sets non-existent columns (photo_url, location)
--      and omits is_deleted=true / deleted_at=NOW() which already exist on users.
--   2. The user_badges FK (user_id -> users.id) is ON DELETE NO ACTION — blocks
--      physical deletion of any user who has badges. Changed to CASCADE.
--   3. The audit_logs FK (actor_id -> users.id) is ON DELETE NO ACTION — while
--      we intentionally want to keep audit history, we must allow actor_id to go
--      NULL so deletion is not blocked. Changed to SET NULL.
--
-- NO DOWN migration for FK changes (restoring NO ACTION would leave data at risk).

BEGIN;

-- ============================================================
-- 1. FIX user_badges FK: NO ACTION -> CASCADE
--    Rationale: badges belong to the user; deleting the user
--    should remove their badge records. Historical badge data
--    has no standalone value without the user record.
-- ============================================================
ALTER TABLE user_badges
  DROP CONSTRAINT IF EXISTS user_badges_user_id_fkey;

ALTER TABLE user_badges
  ADD CONSTRAINT user_badges_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- The awarded_by FK is intentional SET NULL (admin who awarded it may persist).
-- Leave awarded_by as NO ACTION → SET NULL upgrade is safe and desirable.
ALTER TABLE user_badges
  DROP CONSTRAINT IF EXISTS user_badges_awarded_by_fkey;

ALTER TABLE user_badges
  ADD CONSTRAINT user_badges_awarded_by_fkey
    FOREIGN KEY (awarded_by) REFERENCES users(id) ON DELETE SET NULL;

-- ============================================================
-- 2. FIX audit_logs FK: NO ACTION -> SET NULL
--    Rationale: audit history must be preserved for compliance.
--    The actor (deleted user) becomes anonymous — actor_id = NULL
--    is correct semantics for "action performed by deleted account".
-- ============================================================
ALTER TABLE audit_logs
  DROP CONSTRAINT IF EXISTS audit_logs_actor_id_fkey;

ALTER TABLE audit_logs
  ADD CONSTRAINT audit_logs_actor_id_fkey
    FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL;

-- ============================================================
-- 3. FIX creator_enrollments.reviewed_by: NO ACTION -> SET NULL
--    Rationale: enrollment review record should persist; the
--    reviewer becoming NULL is semantically correct.
-- ============================================================
ALTER TABLE creator_enrollments
  DROP CONSTRAINT IF EXISTS creator_enrollments_reviewed_by_fkey;

ALTER TABLE creator_enrollments
  ADD CONSTRAINT creator_enrollments_reviewed_by_fkey
    FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL;

-- ============================================================
-- 4. FIX model_applications.reviewed_by: NO ACTION -> SET NULL
-- ============================================================
ALTER TABLE model_applications
  DROP CONSTRAINT IF EXISTS model_applications_reviewed_by_fkey;

ALTER TABLE model_applications
  ADD CONSTRAINT model_applications_reviewed_by_fkey
    FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL;

-- ============================================================
-- 5. user_moderation_actions.moderator_id: NO ACTION -> SET NULL
--    (Already noted in prior audit — fixing here.)
-- ============================================================
ALTER TABLE user_moderation_actions
  DROP CONSTRAINT IF EXISTS user_moderation_actions_moderator_id_fkey;

ALTER TABLE user_moderation_actions
  ADD CONSTRAINT user_moderation_actions_moderator_id_fkey
    FOREIGN KEY (moderator_id) REFERENCES users(id) ON DELETE SET NULL;

-- ============================================================
-- 6. Add index on user_follows (follower_id, created_at DESC)
--    for cursor-based pagination on the follow feed.
--    The existing idx_user_follows_follower covers WHERE clauses
--    but not ORDER BY created_at for pagination.
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_user_follows_follower_created
  ON user_follows (follower_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_follows_following_created
  ON user_follows (following_id, created_at DESC);

COMMIT;
