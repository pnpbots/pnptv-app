-- 078_tier_system_migration.sql
-- Consolidate users.status into users.tier
-- Tier values: 'free', 'member', 'PRIME', 'banned'
-- Also adds content_tier column to social_posts

BEGIN;

-- Step 1: Migrate banned users from status column to tier
UPDATE users SET tier = 'banned' WHERE status = 'banned';

-- Step 2: Normalize existing tier values to canonical casing
UPDATE users SET tier = 'PRIME' WHERE LOWER(tier) = 'prime' AND tier != 'PRIME';
UPDATE users SET tier = 'free'  WHERE LOWER(tier) = 'free'  AND tier != 'free';

-- Step 3: Drop the old status CHECK constraint if it exists
DO $$ BEGIN
  ALTER TABLE users DROP CONSTRAINT IF EXISTS users_status_check;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

-- Step 4: Drop the status column
ALTER TABLE users DROP COLUMN IF EXISTS status;

-- Step 5: Drop old tier CHECK constraint if it exists
DO $$ BEGIN
  ALTER TABLE users DROP CONSTRAINT IF EXISTS users_tier_check;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

-- Step 6: Add new tier CHECK constraint
ALTER TABLE users ADD CONSTRAINT users_tier_check
  CHECK (tier IN ('free', 'member', 'PRIME', 'banned'));

-- Step 7: Add content_tier column to social_posts
ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS content_tier VARCHAR(10) DEFAULT 'free';

DO $$ BEGIN
  ALTER TABLE social_posts DROP CONSTRAINT IF EXISTS social_posts_content_tier_check;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

ALTER TABLE social_posts ADD CONSTRAINT social_posts_content_tier_check
  CHECK (content_tier IN ('free', 'member', 'PRIME'));

COMMIT;
