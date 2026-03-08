-- Migration: 124_notifications_hardening.sql
-- Purpose:   Harden the notifications table — fix broken dedup constraint,
--            enforce NOT NULL / CHECK constraints, add updated_at, add covering
--            index, update notification_preferences default, and purge the
--            27 K+ hangout_call flood rows that accumulated before rate-limiting
--            was added.
-- Date:      2026-03-08
-- Author:    DBA Agent
-- Reversible: See DOWN section at bottom of file.
-- ============================================================

BEGIN;

-- ============================================================
-- 1. DEDUP CONSTRAINT FIX (CRITICAL)
--    The old UNIQUE constraint on (type, actor_id, target_user_id,
--    entity_type, entity_id) is broken when actor_id IS NULL because
--    NULL != NULL in UNIQUE indexes, so duplicate system/payment
--    notifications slip through.
--    Strategy: replace with two partial unique indexes — one for
--    actor-present rows, one for actor-absent (system) rows.
-- ============================================================

-- 1a. Remove duplicate system notifications first (NULL actor_id rows).
--     Keep the newest occurrence; delete all older duplicates.
DELETE FROM notifications
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY type, target_user_id, entity_type, entity_id
             ORDER BY created_at DESC
           ) AS rn
    FROM notifications
    WHERE actor_id IS NULL
  ) sub
  WHERE rn > 1
);

-- 1b. Drop the broken constraint.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS uq_notification_dedup;

-- 1c. Partial unique index for rows WITH an actor (social, hangout events).
CREATE UNIQUE INDEX IF NOT EXISTS uq_notif_dedup_with_actor
  ON notifications (type, actor_id, target_user_id, entity_type, entity_id)
  WHERE actor_id IS NOT NULL;

-- 1d. Partial unique index for system/payment rows WITHOUT an actor.
CREATE UNIQUE INDEX IF NOT EXISTS uq_notif_dedup_system
  ON notifications (type, target_user_id, entity_type, entity_id)
  WHERE actor_id IS NULL;

-- ============================================================
-- 2. NOT NULL CONSTRAINTS
--    Pre-flight checks (run above) confirmed zero NULLs in
--    these columns, so the ALTERs are safe and instant.
-- ============================================================

ALTER TABLE notifications ALTER COLUMN is_read   SET NOT NULL;
ALTER TABLE notifications ALTER COLUMN created_at SET NOT NULL;
ALTER TABLE notifications ALTER COLUMN metadata   SET NOT NULL;

-- ============================================================
-- 3. CHECK CONSTRAINTS — category and priority enumerations
--    Confirmed: no out-of-range values exist in live data.
-- ============================================================

ALTER TABLE notifications
  ADD CONSTRAINT chk_notifications_category
  CHECK (category IN ('social', 'messaging', 'hangouts', 'commerce', 'system', 'announcements'));

ALTER TABLE notifications
  ADD CONSTRAINT chk_notifications_priority
  CHECK (priority IN ('low', 'normal', 'high'));

-- ============================================================
-- 4. updated_at COLUMN + TRIGGER on notifications
--    Every table must have updated_at per DBA standards.
--    update_timestamp() trigger function already exists in DB.
-- ============================================================

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Back-fill existing rows so updated_at = created_at (best approximation).
UPDATE notifications SET updated_at = created_at WHERE updated_at = NOW() AND created_at < NOW() - INTERVAL '1 second';

DROP TRIGGER IF EXISTS trg_notifications_updated_at ON notifications;
CREATE TRIGGER trg_notifications_updated_at
  BEFORE UPDATE ON notifications
  FOR EACH ROW
  EXECUTE FUNCTION update_timestamp();

-- ============================================================
-- 5. updated_at COLUMN on push_subscriptions
-- ============================================================

ALTER TABLE push_subscriptions
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- ============================================================
-- 6. DROP DEAD INDEX
--    idx_notifications_actor (actor_id WHERE NOT NULL) has
--    near-zero read usage — it exists only to support ON CONFLICT
--    logic that the application does not use. Dropping saves ~1 MB
--    of write amplification on every insert.
-- ============================================================

DROP INDEX IF EXISTS idx_notifications_actor;

-- ============================================================
-- 7. COVERING INDEX for category-filtered queries
--    Replaces idx_notifications_category (non-covering btree on
--    target_user_id, category). The new index adds created_at DESC
--    ordering and INCLUDEs is_read so the notification feed query
--    (WHERE target_user_id = $1 AND category = $2 ORDER BY created_at DESC)
--    is served entirely from the index without a heap fetch for the
--    is_read column.
-- ============================================================

DROP INDEX IF EXISTS idx_notifications_category;

CREATE INDEX IF NOT EXISTS idx_notifications_target_category_created
  ON notifications (target_user_id, category, created_at DESC)
  INCLUDE (is_read);

-- ============================================================
-- 8. notification_preferences — add hangout_calls key
--    a) Back-fill existing users who have the column set but
--       are missing the hangout_calls key.
--    b) Update the column default so new users get it automatically.
-- ============================================================

UPDATE users
SET notification_preferences = notification_preferences || '{"hangout_calls": true}'::jsonb
WHERE notification_preferences IS NOT NULL
  AND notification_preferences -> 'hangout_calls' IS NULL;

ALTER TABLE users
  ALTER COLUMN notification_preferences
  SET DEFAULT '{"likes":true,"replies":true,"dms":true,"group_messages":true,"group_joins":true,"wof":true,"payments":true,"announcements":true,"follows":true,"hangout_calls":true}'::jsonb;

-- ============================================================
-- 9. PURGE hangout_call FLOOD
--    27,241 hangout_call rows were generated by broadcasting
--    call-start events to every active user (~3,483/call × 8 calls
--    = unbounded growth). These are transient alerts; there is no
--    user value in keeping them beyond 7 days.
--    Rows newer than 7 days are preserved in case the user has
--    not yet dismissed them.
-- ============================================================

DELETE FROM notifications
WHERE type = 'hangout_call'
  AND created_at < NOW() - INTERVAL '7 days';

COMMIT;

-- ============================================================
-- DOWN MIGRATION (run manually if rollback is needed)
-- ============================================================
--
-- BEGIN;
--
-- -- Restore old dedup constraint (will fail if duplicates were re-inserted)
-- DROP INDEX IF EXISTS uq_notif_dedup_with_actor;
-- DROP INDEX IF EXISTS uq_notif_dedup_system;
-- ALTER TABLE notifications
--   ADD CONSTRAINT uq_notification_dedup
--   UNIQUE (type, actor_id, target_user_id, entity_type, entity_id);
--
-- -- Restore old covering index
-- DROP INDEX IF EXISTS idx_notifications_target_category_created;
-- CREATE INDEX idx_notifications_category ON notifications (target_user_id, category);
--
-- -- Restore dead index
-- CREATE INDEX idx_notifications_actor ON notifications (actor_id) WHERE actor_id IS NOT NULL;
--
-- -- Remove CHECK constraints
-- ALTER TABLE notifications DROP CONSTRAINT IF EXISTS chk_notifications_category;
-- ALTER TABLE notifications DROP CONSTRAINT IF EXISTS chk_notifications_priority;
--
-- -- Remove NOT NULL enforcement
-- ALTER TABLE notifications ALTER COLUMN is_read   DROP NOT NULL;
-- ALTER TABLE notifications ALTER COLUMN created_at DROP NOT NULL;
-- ALTER TABLE notifications ALTER COLUMN metadata   DROP NOT NULL;
--
-- -- Remove updated_at columns
-- DROP TRIGGER IF EXISTS trg_notifications_updated_at ON notifications;
-- ALTER TABLE notifications DROP COLUMN IF EXISTS updated_at;
-- ALTER TABLE push_subscriptions DROP COLUMN IF EXISTS updated_at;
--
-- -- Restore old notification_preferences default
-- ALTER TABLE users
--   ALTER COLUMN notification_preferences
--   SET DEFAULT '{"dms":true,"wof":true,"likes":true,"follows":true,"replies":true,"payments":true,"group_joins":true,"announcements":true,"group_messages":true}'::jsonb;
--
-- -- NOTE: purged hangout_call rows and deleted duplicate notifications
-- --       cannot be restored from this migration alone. Restore from backup
-- --       if the data is required.
--
-- COMMIT;
