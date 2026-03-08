-- =============================================================================
-- Migration 127: User Deduplication & Merge
-- Created: 2026-03-08
-- Executed: 2026-03-08 17:08 UTC
-- Author: DBA Agent
-- =============================================================================
-- PURPOSE:
--   Full duplicate user audit and safe soft-merge on the pnptvbot database.
--   Duplicates identified across four dimensions:
--     1. Same telegram column value
--     2. Same x_id column value
--     3. Same email address
--     4. Numeric-ID users with UUID twin via cross-linked identifiers
--
-- AUDIT FINDINGS (2026-03-08, total users: 4,657):
--   - same_telegram:      0 duplicate groups (already resolved by migration 126)
--   - same_x_id:          0 duplicate groups (already resolved by migration 126)
--   - same_email:         1 duplicate group  (1 excess row merged below)
--   - pnptv_id_cross_ref: 0 duplicate groups
--   - numeric/UUID twins: 0 duplicate groups
--   TOTAL: 1 merge operation performed.
--
-- MERGE:
--   Winner: 7645865396  (created 2025-11-27 -- oldest account wins per Strategy 3)
--   Loser:  8145576090  (created 2025-12-28 -- newer account, soft-deleted)
--   Match dimension: email (a25jack90123@gmail.com)
--   Reason: Neither account has payment history. Strategy 3 applies: keep oldest.
--
-- NOTIFICATION CONFLICT NOTE:
--   All 7 of the loser's notifications were exact duplicates already present on
--   the winner (same type, actor_id, entity_type, entity_id). They were deleted
--   rather than transferred to avoid violating uq_notif_dedup_with_actor.
--
-- FOLLOW CONFLICT NOTE:
--   Loser's 2 outgoing follows (->8552451957, ->8599671840) conflicted with
--   winner's identical follows. Deleted (winner already has them). No net loss.
--
-- POST-MERGE STATE (winner 7645865396):
--   first_name absorbed from loser ("Allen"), following_count = 6 (3+3 absorbed).
--   Email, tier, and subscription_status unchanged (both were free/churned).
--
-- RESULTS:
--   Active users before: 4,657  |  After: 4,656 (1 soft-deleted)
--   user_merge_log records created: 1
-- =============================================================================

-- ============================================================
-- UP
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- STEP 1: Add soft-delete and merge tracking columns to users
-- ------------------------------------------------------------

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_deleted      BOOLEAN      NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS deleted_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS merge_winner_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS merge_notes     JSONB        NOT NULL DEFAULT '[]'::jsonb;

-- Partial index: fast filter of non-deleted users in all read queries
CREATE INDEX IF NOT EXISTS idx_users_not_deleted
  ON users (id)
  WHERE is_deleted = FALSE;

-- ------------------------------------------------------------
-- STEP 2: Create user_merge_log audit table
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS user_merge_log (
  id               BIGSERIAL    PRIMARY KEY,
  loser_id         VARCHAR(255) NOT NULL,
  winner_id        VARCHAR(255) NOT NULL,
  merge_reason     TEXT         NOT NULL,
  dimension        VARCHAR(50)  NOT NULL,  -- 'email','telegram','x_id','manual'
  rows_transferred JSONB        NOT NULL DEFAULT '{}'::jsonb,
  merged_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  performed_by     VARCHAR(255) NOT NULL DEFAULT 'dba_migration_127'
);

COMMENT ON TABLE user_merge_log IS
  'Immutable audit log of every user soft-merge operation. Never truncated.';

-- ------------------------------------------------------------
-- STEP 3: Merge loser 8145576090 -> winner 7645865396
-- ------------------------------------------------------------

-- 3a: Delete loser notifications that are exact duplicates on the winner.
--     The unique constraint uq_notif_dedup_with_actor prevents transfer of
--     duplicate (type, actor_id, target_user_id, entity_type, entity_id) tuples.
--     All 7 loser notifications were exact duplicates; delete rather than transfer.
DELETE FROM notifications
WHERE target_user_id = '8145576090'
  AND EXISTS (
    SELECT 1 FROM notifications n_win
    WHERE n_win.target_user_id = '7645865396'
      AND n_win.type          = notifications.type
      AND n_win.entity_type   IS NOT DISTINCT FROM notifications.entity_type
      AND n_win.entity_id     IS NOT DISTINCT FROM notifications.entity_id
      AND n_win.actor_id      IS NOT DISTINCT FROM notifications.actor_id
  );

-- Transfer any remaining non-conflicting notifications
UPDATE notifications SET target_user_id = '7645865396' WHERE target_user_id = '8145576090';
UPDATE notifications SET actor_id       = '7645865396' WHERE actor_id       = '8145576090';

-- 3b: Delete loser outgoing follows that conflict with winner's (PK guard)
DELETE FROM user_follows
WHERE follower_id = '8145576090'
  AND following_id IN (
    SELECT following_id FROM user_follows WHERE follower_id = '7645865396'
  );

-- Transfer any remaining non-conflicting outgoing follows
UPDATE user_follows SET follower_id = '7645865396' WHERE follower_id = '8145576090';

-- 3c: Delete loser incoming follows that conflict with winner's
DELETE FROM user_follows
WHERE following_id = '8145576090'
  AND follower_id IN (
    SELECT follower_id FROM user_follows WHERE following_id = '7645865396'
  );

-- Transfer any remaining non-conflicting incoming follows
UPDATE user_follows SET following_id = '7645865396' WHERE following_id = '8145576090';

-- 3d: Transfer payment and content records
UPDATE social_posts       SET user_id = '7645865396' WHERE user_id = '8145576090';
UPDATE token_purchases    SET user_id = '7645865396' WHERE user_id = '8145576090';
UPDATE payment_history    SET user_id = '7645865396' WHERE user_id = '8145576090';
UPDATE payments           SET user_id = '7645865396' WHERE user_id = '8145576090';
UPDATE recurring_payments SET user_id = '7645865396' WHERE user_id = '8145576090';

-- social_post_likes: delete conflicts first, then transfer remainder
DELETE FROM social_post_likes
WHERE user_id = '8145576090'
  AND post_id IN (SELECT post_id FROM social_post_likes WHERE user_id = '7645865396');
UPDATE social_post_likes SET user_id = '7645865396' WHERE user_id = '8145576090';

-- user_token_wallets: delete loser wallet if winner already has one, else transfer
DELETE FROM user_token_wallets
WHERE user_id = '8145576090'
  AND EXISTS (SELECT 1 FROM user_token_wallets WHERE user_id = '7645865396');
UPDATE user_token_wallets SET user_id = '7645865396' WHERE user_id = '8145576090';

-- 3e: Absorb best attributes from loser onto winner
UPDATE users w
SET
  first_name = CASE
    WHEN (w.first_name IS NULL OR w.first_name = '')
      AND (l.first_name IS NOT NULL AND l.first_name <> '')
    THEN l.first_name ELSE w.first_name END,
  xp              = w.xp + l.xp,
  profile_views   = w.profile_views + l.profile_views,
  followers_count = w.followers_count + l.followers_count,
  following_count = w.following_count + l.following_count,
  tier = CASE
    WHEN 'lifetime'   IN (w.tier, l.tier)                                                  THEN 'lifetime'
    WHEN 'prime_plus' IN (w.tier, l.tier)                                                  THEN 'prime_plus'
    WHEN l.tier IN ('PRIME','prime')
      AND w.tier NOT IN ('lifetime','prime_plus','PRIME','prime')                          THEN l.tier
    WHEN l.tier = 'creator'
      AND w.tier NOT IN ('lifetime','prime_plus','PRIME','prime','creator')                THEN 'creator'
    WHEN l.tier = 'basic' AND w.tier = 'free'                                              THEN 'basic'
    ELSE w.tier END,
  subscription_status = CASE
    WHEN l.subscription_status = 'active' AND w.subscription_status <> 'active'
    THEN 'active' ELSE w.subscription_status END,
  plan_id = CASE
    WHEN l.subscription_status = 'active' AND w.subscription_status <> 'active'
    THEN l.plan_id ELSE w.plan_id END,
  plan_expiry = CASE
    WHEN l.subscription_status = 'active' AND w.subscription_status <> 'active'  THEN l.plan_expiry
    WHEN l.plan_expiry IS NOT NULL
      AND (w.plan_expiry IS NULL OR l.plan_expiry > w.plan_expiry)                THEN l.plan_expiry
    ELSE w.plan_expiry END
FROM users l
WHERE w.id = '7645865396' AND l.id = '8145576090';

-- 3f: Soft-delete the loser (null out email to prevent future false-positive dedup hits)
UPDATE users
SET
  is_deleted          = TRUE,
  deleted_at          = NOW(),
  merge_winner_id     = '7645865396',
  merge_notes         = jsonb_build_array(jsonb_build_object(
    'action',    'merged_into',
    'winner_id', '7645865396',
    'reason',    'email_duplicate_oldest_wins',
    'dimension', 'email',
    'email_was', 'a25jack90123@gmail.com',
    'merged_at', NOW()::TEXT
  )),
  email               = NULL,
  is_active           = FALSE,
  deactivated_at      = NOW(),
  deactivation_reason = 'merged_into_7645865396'
WHERE id = '8145576090';

-- 3g: Write audit log entry
INSERT INTO user_merge_log (loser_id, winner_id, merge_reason, dimension, rows_transferred)
VALUES (
  '8145576090',
  '7645865396',
  'Both accounts share email a25jack90123@gmail.com. Neither has payment history. Strategy 3: oldest created_at wins. Winner 7645865396 created 2025-11-27; loser 8145576090 created 2025-12-28.',
  'email',
  jsonb_build_object(
    'notifications_duplicate_deleted',    7,
    'notifications_transferred',          0,
    'follows_outgoing_conflicts_deleted', 2,
    'follows_outgoing_transferred',       0,
    'follows_incoming_conflicts_deleted', 0,
    'follows_incoming_transferred',       0
  )
);

COMMIT;

-- ============================================================
-- DOWN (for dev/staging rollback only -- not safe in production)
-- WARNING: Does not undo FK transfers. Use a forward-fix migration in production.
-- ============================================================
--
-- BEGIN;
--
-- UPDATE users
-- SET is_deleted = FALSE, deleted_at = NULL, merge_winner_id = NULL,
--     merge_notes = '[]'::jsonb, is_active = TRUE, deactivated_at = NULL,
--     deactivation_reason = NULL, email = 'a25jack90123@gmail.com'
-- WHERE id = '8145576090';
--
-- DELETE FROM user_merge_log WHERE loser_id = '8145576090' AND winner_id = '7645865396';
--
-- -- Column drops only safe if no application code has adopted them yet:
-- -- ALTER TABLE users DROP COLUMN IF EXISTS is_deleted;
-- -- ALTER TABLE users DROP COLUMN IF EXISTS deleted_at;
-- -- ALTER TABLE users DROP COLUMN IF EXISTS merge_winner_id;
-- -- ALTER TABLE users DROP COLUMN IF EXISTS merge_notes;
-- -- DROP TABLE IF EXISTS user_merge_log;
--
-- COMMIT;
