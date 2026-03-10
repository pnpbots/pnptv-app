-- Migration 138: Hangouts schema hardening (audit remediation)
-- Date: 2026-03-10
-- Remediates findings from hangouts-audit-2026-03-10.md:
--   1. Missing FK on hangout_call_participants.user_id
--   2. Missing Wall of Fame hangout group (from migration 079, not in live DB)
--   3. Stale active legacy video_calls (9 rows older than 24h)
--   4. Orphaned hangout chat_messages for deleted groups
--   5. Missing updated_at trigger on hangout_groups
--   6. Missing composite index for discoverGroups endpoint
--   7. Missing creator_id partial index for monthly group creation limit
--   8. Replace full idx_chat_messages_room_created with partial (exclude deleted)
--
-- Prerequisites verified before writing this migration:
--   - idx_hangout_groups_wall_of_fame UNIQUE partial index EXISTS (safe for ON CONFLICT)
--   - idx_chat_messages_room_created EXISTS (safe to drop)
--   - fn_set_updated_at does NOT exist (safe to create)
--   - hangout_call_participants.user_id has NO FK to users (confirmed from \d output)
--   - 9 stale active video_calls older than 24h
--   - 49 orphaned chat_messages in rooms hangout:8, hangout:10, hangout:11

BEGIN;

-- ============================================================
-- Fix 1: Add missing FK on hangout_call_participants.user_id
-- ============================================================
-- ON DELETE CASCADE: when a user is deleted, their call participation
-- records should be removed. Call history is not preserved per-user
-- after account deletion (privacy-appropriate for this platform).
ALTER TABLE hangout_call_participants
  ADD CONSTRAINT fk_hcp_user_id
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- ============================================================
-- Fix 2: Re-seed missing Wall of Fame hangout group
-- ============================================================
-- The Wall of Fame group was defined in migration 079 but does not
-- exist in the live DB. Using a conditional INSERT guarded by the
-- unique partial index idx_hangout_groups_wall_of_fame (is_wall_of_fame=true)
-- so this is safe to re-run. ON CONFLICT on the named constraint
-- ensures idempotency.
INSERT INTO hangout_groups (name, description, creator_id, is_main, is_wall_of_fame, is_public, max_members)
SELECT
  'Wall of Fame',
  'Community photo & video gallery — daily cult title winners featured here.',
  NULL,
  FALSE,
  TRUE,
  TRUE,
  10000
WHERE NOT EXISTS (
  SELECT 1 FROM hangout_groups WHERE is_wall_of_fame = true
);

-- ============================================================
-- Fix 3: End stale legacy active calls (older than 24h)
-- ============================================================
-- These are rows in video_calls (the legacy general JaaS table,
-- NOT hangout_video_calls). 9 rows confirmed stale.
UPDATE video_calls
SET    is_active  = false,
       ended_at   = NOW()
WHERE  is_active  = true
  AND  created_at < NOW() - INTERVAL '24 hours';

-- ============================================================
-- Fix 4: Clean up orphaned hangout chat messages
-- ============================================================
-- Removes chat_messages whose room references a hangout group that
-- no longer exists. Confirmed orphans: rooms hangout:8, hangout:10,
-- hangout:11 (49 rows from audit). Using regex to scope to hangout
-- rooms only — does not touch 'general' or other room types.
DELETE FROM chat_messages
WHERE room ~ '^hangout:\d+$'
  AND NOT EXISTS (
    SELECT 1 FROM hangout_groups hg
    WHERE chat_messages.room = 'hangout:' || hg.id::text
  );

-- ============================================================
-- Fix 5: Add updated_at auto-update trigger to hangout_groups
-- ============================================================
-- hangout_groups has an updated_at column but no trigger to maintain
-- it — it remains at the insert-time default. This function and trigger
-- fix that. The function is shared and can be reused by other tables.
CREATE OR REPLACE FUNCTION fn_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname    = 'trg_hangout_groups_updated_at'
      AND tgrelid   = 'hangout_groups'::regclass
  ) THEN
    CREATE TRIGGER trg_hangout_groups_updated_at
      BEFORE UPDATE ON hangout_groups
      FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
  END IF;
END $$;

-- ============================================================
-- Fix 6: Composite index for discoverGroups endpoint
-- ============================================================
-- discoverGroups queries ORDER BY created_at DESC and filters out
-- main and wall_of_fame groups. This partial index satisfies both
-- the filter predicate and the sort without a full-table scan.
CREATE INDEX IF NOT EXISTS idx_hangout_groups_discover
  ON hangout_groups (created_at DESC)
  WHERE is_main = false AND is_wall_of_fame = false;

-- ============================================================
-- Fix 7: creator_id partial index for monthly group creation limit
-- ============================================================
-- The monthly group creation cap queries WHERE creator_id = $1 AND
-- is_main = false AND is_wall_of_fame = false AND created_at > $2.
-- This partial index covers creator_id lookups within the correct
-- subset, enabling an index scan rather than a seq scan.
CREATE INDEX IF NOT EXISTS idx_hangout_groups_creator_id
  ON hangout_groups (creator_id)
  WHERE is_main = false AND is_wall_of_fame = false;

-- ============================================================
-- Fix 8: Replace full room index with partial (exclude deleted rows)
-- ============================================================
-- idx_chat_messages_room_created covers (room, created_at DESC) but
-- includes soft-deleted rows that are never returned to clients.
-- The new partial index halves the index size on an active platform
-- and improves cache efficiency. All chat queries filter
-- WHERE is_deleted = false, so the planner will use the partial index.
DROP INDEX IF EXISTS idx_chat_messages_room_created;
CREATE INDEX IF NOT EXISTS idx_chat_messages_room_active
  ON chat_messages (room, created_at DESC)
  WHERE is_deleted = false;

COMMIT;
