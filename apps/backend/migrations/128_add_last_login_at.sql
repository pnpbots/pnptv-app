-- Migration 128: Add missing last_login_at column to users table
-- This column is referenced in login handlers but was missing from the schema

ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP;
CREATE INDEX IF NOT EXISTS idx_users_last_login_at ON users(last_login_at) WHERE last_login_at IS NOT NULL;
