-- Migration 069: Fix Telegram user identity split
-- Problem: Bot users have id = Telegram numeric ID, but telegram column = NULL
-- Web auth searches by telegram column, creating duplicate records
-- 167 duplicate pairs exist as of 2026-02-26

BEGIN;

-- Step 0: Ensure pnptv_id column exists (may have been added ad hoc)
ALTER TABLE users ADD COLUMN IF NOT EXISTS pnptv_id UUID;

-- Step 1: Backfill telegram column for ALL bot users with numeric IDs
-- This sets telegram = id for users created by the bot (who have numeric string IDs)
UPDATE users
SET telegram = id, updated_at = NOW()
WHERE id ~ '^[0-9]+$'
  AND (telegram IS NULL OR telegram = '');

-- Step 2: Merge duplicate pairs
-- For each pair: bot record (u1.id = numeric) + web record (u2.telegram = same numeric)
-- Keep bot record (has bot history), copy useful fields from web record, delete web record

-- 2a: Copy pnptv_id from web record to bot record where bot record lacks it
UPDATE users bot
SET pnptv_id = web.pnptv_id
FROM users web
WHERE bot.id = web.telegram
  AND bot.id ~ '^[0-9]+$'
  AND bot.id != web.id
  AND bot.pnptv_id IS NULL
  AND web.pnptv_id IS NOT NULL;

-- 2b: Copy email from web record where bot record lacks it
UPDATE users bot
SET email = web.email
FROM users web
WHERE bot.id = web.telegram
  AND bot.id ~ '^[0-9]+$'
  AND bot.id != web.id
  AND (bot.email IS NULL OR bot.email = '')
  AND web.email IS NOT NULL
  AND web.email != '';

-- 2c: Upgrade tier if web record has prime
UPDATE users bot
SET tier = 'prime', subscription_status = 'active'
FROM users web
WHERE bot.id = web.telegram
  AND bot.id ~ '^[0-9]+$'
  AND bot.id != web.id
  AND LOWER(web.tier) = 'prime'
  AND LOWER(bot.tier) != 'prime';

-- 2d: Upgrade role if web record has higher role
UPDATE users bot
SET role = web.role
FROM users web
WHERE bot.id = web.telegram
  AND bot.id ~ '^[0-9]+$'
  AND bot.id != web.id
  AND web.role IN ('admin', 'superadmin')
  AND bot.role = 'user';

-- 2e: Reassign DM messages from web duplicate to bot record (if table exists)
-- Join approach avoids NULL subquery results that would violate NOT NULL / FK constraints.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'direct_messages') THEN
    UPDATE direct_messages dm
    SET sender_id = bot.id
    FROM users web
    JOIN users bot ON bot.id = web.telegram
    WHERE dm.sender_id = web.id
      AND bot.id ~ '^[0-9]+$'
      AND bot.id != web.id;

    UPDATE direct_messages dm
    SET recipient_id = bot.id
    FROM users web
    JOIN users bot ON bot.id = web.telegram
    WHERE dm.recipient_id = web.id
      AND bot.id ~ '^[0-9]+$'
      AND bot.id != web.id;
  END IF;
END;
$$;

-- 2f: Delete the web duplicate records
DELETE FROM users web
USING users bot
WHERE bot.id = web.telegram
  AND bot.id ~ '^[0-9]+$'
  AND bot.id != web.id;

COMMIT;
