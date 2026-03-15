-- 163_consolidate_authentik_uuid.sql
-- Migration to ensure all users have a unique UUID (pnptv_id) mapped to Authentik sub

-- Ensure uuid-ossp extension is enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Add pnptv_id column if it doesn't exist, ensure it's UUID type
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'pnptv_id') THEN
        ALTER TABLE users ADD COLUMN pnptv_id UUID;
    END IF;
END
$$;

-- Backfill pnptv_id for users that don't have one
UPDATE users SET pnptv_id = uuid_generate_v4() WHERE pnptv_id IS NULL;

-- Make pnptv_id UNIQUE and NOT NULL
ALTER TABLE users ALTER COLUMN pnptv_id SET NOT NULL;
-- Ensure the constraint doesn't already exist (from migration 130)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_pnptv_id_unique') THEN
        ALTER TABLE users ADD CONSTRAINT users_pnptv_id_unique UNIQUE (pnptv_id);
    END IF;
END
$$;

-- Add index for performance
CREATE INDEX IF NOT EXISTS idx_users_pnptv_id ON users(pnptv_id);
