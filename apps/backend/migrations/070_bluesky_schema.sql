-- Migration 070: Add Bluesky columns to user_pds_mapping and create supporting tables
-- Date: 2026-02-27
-- Purpose: The BlueskyAutoSetupService and blueskyController reference columns and tables
--          that were never created in migration 064. This migration adds them.

BEGIN;

-- Step 1: Add Bluesky columns to user_pds_mapping
ALTER TABLE user_pds_mapping
  ADD COLUMN IF NOT EXISTS bluesky_handle VARCHAR(255),
  ADD COLUMN IF NOT EXISTS bluesky_did VARCHAR(255),
  ADD COLUMN IF NOT EXISTS bluesky_status VARCHAR(50) DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS bluesky_auto_sync BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS bluesky_synced_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS bluesky_created_at TIMESTAMP;

-- Index for Bluesky handle lookups
CREATE INDEX IF NOT EXISTS idx_user_pds_mapping_bluesky_handle
  ON user_pds_mapping(bluesky_handle) WHERE bluesky_handle IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_user_pds_mapping_bluesky_did
  ON user_pds_mapping(bluesky_did) WHERE bluesky_did IS NOT NULL;

-- Step 2: Create bluesky_profile_syncs table (used by logBlueskyAction and logSync)
CREATE TABLE IF NOT EXISTS bluesky_profile_syncs (
  id BIGSERIAL PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pnptv_uuid UUID NOT NULL,
  sync_type VARCHAR(100) NOT NULL,        -- auto_setup, manual_setup, disconnect, field
  field_name VARCHAR(100),                 -- display_name, bio, avatar (for field syncs)
  old_value TEXT,
  new_value TEXT,
  status VARCHAR(50) DEFAULT 'success',    -- success, failed
  triggered_by VARCHAR(50) DEFAULT 'auto', -- auto, user, manual
  error_message TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT valid_sync_status CHECK (status IN ('success', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_bluesky_syncs_user_id
  ON bluesky_profile_syncs(user_id);
CREATE INDEX IF NOT EXISTS idx_bluesky_syncs_sync_type
  ON bluesky_profile_syncs(sync_type);
CREATE INDEX IF NOT EXISTS idx_bluesky_syncs_created_at
  ON bluesky_profile_syncs(created_at);

-- Step 3: Create bluesky_connection_requests table (used by cleanupExpiredRequests)
CREATE TABLE IF NOT EXISTS bluesky_connection_requests (
  id BIGSERIAL PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_handle VARCHAR(255) NOT NULL,
  status VARCHAR(50) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP + INTERVAL '24 hours',

  CONSTRAINT valid_conn_status CHECK (status IN ('pending', 'accepted', 'rejected', 'expired'))
);

CREATE INDEX IF NOT EXISTS idx_bluesky_conn_user_id
  ON bluesky_connection_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_bluesky_conn_expires_at
  ON bluesky_connection_requests(expires_at);

-- Step 4: Create outbound_federation_blocks table (used by federationPrivacyMiddleware)
CREATE TABLE IF NOT EXISTS outbound_federation_blocks (
  id BIGSERIAL PRIMARY KEY,
  user_id VARCHAR(255),
  blocked_domain VARCHAR(500) NOT NULL,
  blocked_url TEXT,
  method VARCHAR(10),
  reason VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_federation_blocks_domain
  ON outbound_federation_blocks(blocked_domain);
CREATE INDEX IF NOT EXISTS idx_federation_blocks_created_at
  ON outbound_federation_blocks(created_at);

COMMIT;
