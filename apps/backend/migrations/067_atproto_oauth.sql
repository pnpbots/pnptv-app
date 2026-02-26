-- Migration: ATProto OAuth Integration
-- Date: 2026-02-26
-- Purpose: Add ATProto identity columns to users table and create OAuth session storage

-- ============================================================================
-- 1. Add ATProto identity columns to the users table
-- ============================================================================

-- atproto_did: The decentralized identifier (did:plc:... or did:web:...).
-- This is the CANONICAL identity — it persists even if the user migrates PDS.
ALTER TABLE users ADD COLUMN IF NOT EXISTS atproto_did VARCHAR(255) UNIQUE;

-- atproto_handle: The human-readable handle (e.g., alice.bsky.social).
-- Can change over time; the DID is the stable identifier.
ALTER TABLE users ADD COLUMN IF NOT EXISTS atproto_handle VARCHAR(255);

-- atproto_pds_url: The user's current Personal Data Server URL.
-- Updated on each login as the user may migrate between PDS instances.
ALTER TABLE users ADD COLUMN IF NOT EXISTS atproto_pds_url VARCHAR(500);

-- Indexes for ATProto lookups
CREATE INDEX IF NOT EXISTS idx_users_atproto_did ON users(atproto_did) WHERE atproto_did IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_atproto_handle ON users(atproto_handle) WHERE atproto_handle IS NOT NULL;

-- ============================================================================
-- 2. ATProto OAuth Session Storage
--    Stores encrypted DPoP-bound session tokens keyed by DID.
--    The @atproto/oauth-client-node sessionStore interface requires set/get/del by DID.
-- ============================================================================

CREATE TABLE IF NOT EXISTS atproto_oauth_sessions (
  id BIGSERIAL PRIMARY KEY,
  did VARCHAR(255) NOT NULL UNIQUE,

  -- Session data is encrypted at rest (AES-256-GCM) because it contains
  -- DPoP private keys and refresh tokens.
  session_data_encrypted TEXT NOT NULL,
  session_iv VARCHAR(32) NOT NULL,
  session_auth_tag VARCHAR(32) NOT NULL,

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index for fast DID lookups
CREATE INDEX IF NOT EXISTS idx_atproto_sessions_did ON atproto_oauth_sessions(did);

-- Auto-update trigger for updated_at
CREATE OR REPLACE FUNCTION update_atproto_session_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_atproto_session_update_timestamp ON atproto_oauth_sessions;
CREATE TRIGGER trigger_atproto_session_update_timestamp
BEFORE UPDATE ON atproto_oauth_sessions
FOR EACH ROW
EXECUTE FUNCTION update_atproto_session_timestamp();

-- ============================================================================
-- 3. ATProto OAuth State Store (ephemeral — backup for Redis failures)
--    Normally state is stored in Redis with 10-minute TTL.
--    This table serves as a persistent fallback.
-- ============================================================================

CREATE TABLE IF NOT EXISTS atproto_oauth_state (
  id BIGSERIAL PRIMARY KEY,
  state_key VARCHAR(255) NOT NULL UNIQUE,
  state_data JSONB NOT NULL,
  expires_at TIMESTAMP NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '10 minutes'),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_atproto_state_key ON atproto_oauth_state(state_key);
CREATE INDEX IF NOT EXISTS idx_atproto_state_expires ON atproto_oauth_state(expires_at);

-- ============================================================================
-- 4. Grant ownership (match existing convention)
-- ============================================================================

ALTER TABLE atproto_oauth_sessions OWNER TO pnptvbot;
ALTER TABLE atproto_oauth_state OWNER TO pnptvbot;
