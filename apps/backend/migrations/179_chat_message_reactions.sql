-- Migration 179: Chat message reactions
-- The chat_message_reactions table already exists from migration 143,
-- but was created in production with a broken UNIQUE(message_id, user_id) constraint
-- (missing `emoji`). This migration:
--   1. Creates the table idempotently (no-op if already exists)
--   2. Fixes the unique constraint to include `emoji` so users can react
--      with multiple different emoji per message.
-- All statements use IF NOT EXISTS / DROP IF EXISTS for idempotency.

BEGIN;

-- ============================================================
-- 1. Reactions table
-- ============================================================

CREATE TABLE IF NOT EXISTS chat_message_reactions (
  id           SERIAL PRIMARY KEY,
  message_id   INTEGER      NOT NULL,
  user_id      VARCHAR(255) NOT NULL,
  emoji        VARCHAR(20)  NOT NULL,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (message_id, user_id, emoji)
);

-- Fix broken unique constraint (production had UNIQUE(message_id, user_id) without emoji)
ALTER TABLE chat_message_reactions
  DROP CONSTRAINT IF EXISTS chat_message_reactions_message_id_user_id_key;

-- Ensure the correct per-emoji unique constraint exists
ALTER TABLE chat_message_reactions
  DROP CONSTRAINT IF EXISTS chat_message_reactions_message_id_user_id_emoji_key;
ALTER TABLE chat_message_reactions
  ADD CONSTRAINT chat_message_reactions_message_id_user_id_emoji_key
  UNIQUE (message_id, user_id, emoji);

-- Fast lookups: all reactions for a given message
CREATE INDEX IF NOT EXISTS idx_cmr_message_id
  ON chat_message_reactions (message_id);

-- Fast lookups: all reactions by a given user (for feed / undo flows)
CREATE INDEX IF NOT EXISTS idx_cmr_user_id
  ON chat_message_reactions (user_id);

-- ============================================================
-- 2. Verification
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'chat_message_reactions'
  ) THEN
    RAISE EXCEPTION 'Migration 179 FAILED — chat_message_reactions table missing';
  ELSE
    RAISE NOTICE 'Migration 179 OK — chat_message_reactions table present.';
  END IF;
END;
$$;

COMMIT;

-- ============================================================
-- DOWN MIGRATION (run manually to reverse)
-- ============================================================
-- BEGIN;
-- DROP TABLE IF EXISTS chat_message_reactions;
-- COMMIT;
