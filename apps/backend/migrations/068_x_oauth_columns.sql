-- Migration: X (Twitter) OAuth 2.0 PKCE — Webapp Login Columns
-- Date: 2026-02-26
-- Purpose: Add X OAuth identity and encrypted token columns to the users table.
--          These are distinct from the existing `twitter` (handle) and `x_id` columns
--          which were added for social profile display. The new columns support the
--          full webapp OAuth login flow with token storage.

-- ============================================================================
-- 1. X OAuth identity columns on users
-- ============================================================================

-- x_user_id: The numeric X user ID (stable — survives handle renames).
-- Stored as VARCHAR to avoid BigInt precision issues in JS.
ALTER TABLE users ADD COLUMN IF NOT EXISTS x_user_id VARCHAR(255);

-- x_username: The X handle at time of last login (informational, may change).
ALTER TABLE users ADD COLUMN IF NOT EXISTS x_username VARCHAR(255);

-- x_access_token_encrypted: AES-256-GCM encrypted access token payload.
-- Format: JSON string { data: hex, iv: hex, authTag: hex }
ALTER TABLE users ADD COLUMN IF NOT EXISTS x_access_token_encrypted TEXT;

-- x_refresh_token_encrypted: AES-256-GCM encrypted refresh token payload.
-- Format: JSON string { data: hex, iv: hex, authTag: hex }
-- NULL when offline.access scope was not granted or token has no refresh.
ALTER TABLE users ADD COLUMN IF NOT EXISTS x_refresh_token_encrypted TEXT;

-- x_token_expires_at: When the access token expires (for refresh scheduling).
ALTER TABLE users ADD COLUMN IF NOT EXISTS x_token_expires_at TIMESTAMP;

-- ============================================================================
-- 2. Uniqueness constraint on x_user_id
--    Prevents two PNPtv accounts from being linked to the same X identity.
--    Applied as a partial index to allow NULLs (many users will have no X link).
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_x_user_id_unique
  ON users(x_user_id)
  WHERE x_user_id IS NOT NULL;

-- ============================================================================
-- 3. Additional lookup indexes
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_users_x_username
  ON users(x_username)
  WHERE x_username IS NOT NULL;

-- ============================================================================
-- 4. Grant ownership (match existing convention)
-- ============================================================================

-- No new tables to grant; column additions inherit table ownership.
-- The pnptvbot role already owns the users table.
