-- Migration 126: Auth hardening
-- Adds last_login_method column, fixes NULL usernames, backfills legacy telegram column
-- Date: 2026-03-08

BEGIN;

-- 1. Add last_login_method column if it doesn't exist
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_method VARCHAR(20);

-- 2. Backfill last_login_method from existing data
UPDATE users SET last_login_method = 'telegram'
WHERE last_login_method IS NULL
  AND telegram IS NOT NULL AND telegram <> '';

UPDATE users SET last_login_method = 'x'
WHERE last_login_method IS NULL
  AND x_id IS NOT NULL AND x_id <> '';

UPDATE users SET last_login_method = 'email'
WHERE last_login_method IS NULL
  AND email IS NOT NULL AND password_hash IS NOT NULL;

-- 3. Backfill telegram column for legacy users (numeric id = telegram id)
-- Legacy bot users had Telegram ID as their primary key (UUID-format check fails for these)
UPDATE users SET telegram = id
WHERE telegram IS NULL
  AND id ~ '^[0-9]+$';

-- 4. Fix NULL usernames — generate fallback pnptv_XXXXXX
-- Uses a DO block to handle each row individually to avoid collisions
DO $$
DECLARE
  rec RECORD;
  candidate TEXT;
  suffix TEXT;
BEGIN
  FOR rec IN SELECT id FROM users WHERE username IS NULL OR username = '' LOOP
    LOOP
      suffix := lower(substring(md5(random()::text || rec.id), 1, 6));
      candidate := 'pnptv_' || suffix;
      EXIT WHEN NOT EXISTS (SELECT 1 FROM users WHERE username = candidate);
    END LOOP;
    UPDATE users SET username = candidate WHERE id = rec.id;
  END LOOP;
END;
$$;

-- 5. Handle duplicate telegram IDs (keep the one with best plan, merge others)
-- Mark duplicates to be deactivated (we soft-deactivate, never delete)
-- The "winner" is the user with the highest tier or most recent activity
DO $$
DECLARE
  dup RECORD;
  winner_id TEXT;
BEGIN
  FOR dup IN
    SELECT telegram, COUNT(*) as cnt
    FROM users
    WHERE telegram IS NOT NULL AND telegram <> ''
    GROUP BY telegram
    HAVING COUNT(*) > 1
  LOOP
    -- Pick winner: prefer prime > creator > free, then most recent activity
    SELECT id INTO winner_id
    FROM users
    WHERE telegram = dup.telegram
    ORDER BY
      CASE tier
        WHEN 'lifetime' THEN 6
        WHEN 'prime_plus' THEN 5
        WHEN 'prime' THEN 4
        WHEN 'creator' THEN 3
        WHEN 'basic' THEN 2
        ELSE 1
      END DESC,
      CASE subscription_status
        WHEN 'active' THEN 2
        WHEN 'trial' THEN 1
        ELSE 0
      END DESC,
      last_login_at DESC NULLS LAST,
      created_at ASC
    LIMIT 1;

    -- Nullify telegram on losers so unique index constraint holds
    -- We keep their data but unlink from the telegram ID to prevent login confusion
    UPDATE users
    SET telegram = NULL,
        updated_at = NOW()
    WHERE telegram = dup.telegram
      AND id <> winner_id;

    RAISE NOTICE 'Resolved duplicate telegram %, winner: %', dup.telegram, winner_id;
  END LOOP;
END;
$$;

-- 6. Handle duplicate x_id (same strategy)
DO $$
DECLARE
  dup RECORD;
  winner_id TEXT;
BEGIN
  FOR dup IN
    SELECT x_id, COUNT(*) as cnt
    FROM users
    WHERE x_id IS NOT NULL AND x_id <> ''
    GROUP BY x_id
    HAVING COUNT(*) > 1
  LOOP
    SELECT id INTO winner_id
    FROM users
    WHERE x_id = dup.x_id
    ORDER BY
      CASE tier
        WHEN 'lifetime' THEN 6
        WHEN 'prime_plus' THEN 5
        WHEN 'prime' THEN 4
        WHEN 'creator' THEN 3
        WHEN 'basic' THEN 2
        ELSE 1
      END DESC,
      CASE subscription_status
        WHEN 'active' THEN 2
        WHEN 'trial' THEN 1
        ELSE 0
      END DESC,
      last_login_at DESC NULLS LAST,
      created_at ASC
    LIMIT 1;

    UPDATE users
    SET x_id = NULL,
        updated_at = NOW()
    WHERE x_id = dup.x_id
      AND id <> winner_id;

    RAISE NOTICE 'Resolved duplicate x_id %, winner: %', dup.x_id, winner_id;
  END LOOP;
END;
$$;

-- 7. Add index for last_login_method queries
CREATE INDEX IF NOT EXISTS idx_users_last_login_method ON users(last_login_method) WHERE last_login_method IS NOT NULL;

COMMIT;
