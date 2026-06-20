-- =============================================================================
-- Migration 220: Account Deduplication Phase 2 — SCHEDULED CLEANUP
-- Created: 2026-04-22
-- Scheduled to run:  2026-05-22 (30 days after 219)
-- Purpose: Hard-delete Category C2 free-tier non-Telegram accounts that were
--          flagged by migration 219 and have NOT linked Telegram within the
--          30-day grace window.
--
-- DO NOT RUN BEFORE 2026-05-22 UNLESS THE OUTREACH DEADLINE IS EXPLICITLY
-- CONFIRMED. The safety WHERE clause below requires flagged_at older than
-- 29 days so an accidental early run short-circuits.
--
-- This migration also:
--   - Retires any Cat C PRIME users who STILL haven't linked Telegram, by
--     downgrading to `free` + `subscription_status='churned'` and emailing
--     them a refund offer (refund handled out-of-band).
--   - Does NOT hard-delete Cat C PRIME users — money was paid; preserve row
--     for support/audit, just downgrade access.
--
-- BACKUP FIRST:
--   docker exec pg-pnptv pg_dump -U pnptvbot -d pnptvbot -t users \
--     -t user_entitlements -t payments -t user_merge_log \
--     > /opt/pnptv_backups/pre_220_$(date +%Y%m%d_%H%M%S).sql
-- =============================================================================

BEGIN;
SET LOCAL pnptv.superadmin_bypass = 'true';
SET LOCAL lock_timeout = '10s';

-- Safety gate: abort if flagged_at is less than 29 days old for any flagged row.
-- Prevents accidentally running this migration before the grace window ends.
DO $gate$
DECLARE
  youngest_flag_age INTERVAL;
BEGIN
  SELECT MIN(NOW() - (note->>'flagged_at')::timestamptz)
    INTO youngest_flag_age
    FROM users, jsonb_array_elements(merge_notes) AS note
   WHERE note->>'action' = 'flagged_for_deletion';

  IF youngest_flag_age IS NOT NULL AND youngest_flag_age < INTERVAL '29 days' THEN
    RAISE EXCEPTION 'SAFETY GATE: youngest flag is only % old — grace window not yet closed. Aborting.',
      youngest_flag_age;
  END IF;
END;
$gate$;

-- =============================================================================
-- STEP 1: Hard-delete Category C2 free-tier accounts that did not link Telegram
-- =============================================================================
-- Exclude any row that later picked up a Telegram linkage or was otherwise
-- promoted (tier != 'free' or telegram populated).

DO $delete_c2$
DECLARE
  victim RECORD;
  del_count INT := 0;
BEGIN
  FOR victim IN
    SELECT id, username, email, tier, merge_notes
      FROM users
     WHERE COALESCE(is_deleted, false) = false
       AND id !~ '^[0-9]+$'
       AND id <> 'SYSTEM'
       AND tier = 'free'
       AND (telegram IS NULL OR telegram = '' OR telegram !~ '^[0-9]+$')
       AND merge_notes::text LIKE '%flagged_for_deletion%'
       AND merge_notes::text LIKE '%dedup_outreach_sent%'
       -- Skip if they came back and logged in recently
       AND (last_active IS NULL OR last_active < NOW() - INTERVAL '14 days')
  LOOP
    -- Revoke any entitlements first (shouldn't exist for free, but defensive)
    DELETE FROM user_entitlements WHERE user_id = victim.id;

    -- Delete actor-side notifications before user delete to avoid SET NULL
    -- colliding with the uq_notif_dedup_system unique constraint on
    -- (type, target_user_id, entity_type, entity_id).
    DELETE FROM notifications WHERE actor_id = victim.id;

    -- Hard delete — FKs cascade
    DELETE FROM users WHERE id = victim.id;

    INSERT INTO user_merge_log (loser_id, winner_id, merge_reason, dimension, rows_transferred, performed_by)
    VALUES (
      victim.id,
      'DELETED',
      'Cat C2: free-tier, no Telegram link, grace window expired, outreach sent',
      'grace_expired',
      '{}'::jsonb,
      'migration_220'
    );

    del_count := del_count + 1;
  END LOOP;

  RAISE NOTICE 'Cat C2 hard-deletions: % users', del_count;
END;
$delete_c2$;

-- =============================================================================
-- STEP 2: Downgrade Category C PRIME users who still haven't linked Telegram
-- =============================================================================
-- Money was paid; keep the row for support/audit, but downgrade access until
-- they link Telegram. This triggers the access resolver to deny PRIME content
-- but preserves payment history and contact info.

DO $downgrade_c$
DECLARE
  victim RECORD;
  downgrade_count INT := 0;
BEGIN
  FOR victim IN
    SELECT id, username, email
      FROM users
     WHERE COALESCE(is_deleted, false) = false
       AND id !~ '^[0-9]+$'
       AND id <> 'SYSTEM'
       AND tier = 'PRIME'
       AND (telegram IS NULL OR telegram = '' OR telegram !~ '^[0-9]+$')
       AND merge_notes::text LIKE '%flagged_for_outreach%'
       AND merge_notes::text LIKE '%dedup_outreach_sent%'
  LOOP
    -- Downgrade tier to free, mark subscription as churned
    UPDATE users
       SET tier = 'free',
           subscription_status = 'churned',
           plan_id = NULL,
           plan_expiry = NULL,
           merge_notes = COALESCE(merge_notes, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
             'action', 'downgraded_no_tg_link',
             'reason', 'prime_grace_expired',
             'migration', '220',
             'at', NOW()::text,
             'prior_tier', 'PRIME'
           ))
     WHERE id = victim.id;

    -- Mark entitlements consumed (access resolver denies).
    -- Lifetime rows (is_lifetime=true) must keep expires_at=NULL per chk_lifetime_no_expiry.
    UPDATE user_entitlements
       SET is_consumed = true,
           expires_at  = CASE WHEN is_lifetime THEN NULL ELSE NOW() END
     WHERE user_id = victim.id AND is_consumed = false;

    INSERT INTO user_merge_log (loser_id, winner_id, merge_reason, dimension, rows_transferred, performed_by)
    VALUES (
      victim.id,
      victim.id,
      'Cat C: PRIME no-TG link, grace expired, downgraded. Refund offered out-of-band.',
      'grace_expired',
      '{}'::jsonb,
      'migration_220'
    );

    downgrade_count := downgrade_count + 1;
  END LOOP;

  RAISE NOTICE 'Cat C PRIME downgrades: % users (manual refund follow-up required)', downgrade_count;
END;
$downgrade_c$;

-- =============================================================================
-- STEP 3: Summary
-- =============================================================================

\echo '--- Migration 220 summary ---'
SELECT
  COUNT(*) FILTER (WHERE performed_by='migration_220' AND dimension='grace_expired' AND winner_id='DELETED') AS c2_hard_deleted,
  COUNT(*) FILTER (WHERE performed_by='migration_220' AND dimension='grace_expired' AND winner_id<>'DELETED') AS c_prime_downgraded
FROM user_merge_log
WHERE merged_at >= CURRENT_DATE;

SELECT
  COUNT(*) FILTER (WHERE id !~ '^[0-9]+$' AND COALESCE(is_deleted,false)=false AND id <> 'SYSTEM') AS remaining_non_tg_active,
  COUNT(*) FILTER (WHERE id !~ '^[0-9]+$' AND COALESCE(is_deleted,false)=false AND tier='PRIME') AS remaining_non_tg_prime,
  COUNT(*) FILTER (WHERE id ~ '^[0-9]+$' AND COALESCE(is_deleted,false)=false) AS active_telegram
FROM users;

COMMIT;

-- =============================================================================
-- DOWN — NOT SAFE in production. Restore from pre_220 pg_dump if needed.
-- =============================================================================
