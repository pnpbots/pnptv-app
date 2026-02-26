-- Migration: User PDS Mapping Tables
-- Date: 2026-02-21
-- Purpose: Store PDS provisioning mappings and audit trail

-- Create user_pds_mapping table
CREATE TABLE IF NOT EXISTS user_pds_mapping (
  id BIGSERIAL PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  pnptv_uuid UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  pds_did VARCHAR(255) UNIQUE, -- Decentralized Identifier (e.g., did:web:username.pnptv.app)
  pds_handle VARCHAR(255) UNIQUE, -- AT Protocol handle (e.g., @username.pnptv.app)
  pds_endpoint VARCHAR(500), -- PDS server URL (e.g., https://pds.pnptv.app)
  pds_public_key TEXT, -- Public key for signing
  pds_private_key_encrypted TEXT, -- AES-256-GCM encrypted private key
  pds_private_key_iv VARCHAR(32), -- IV for decryption
  pds_private_key_auth_tag VARCHAR(32), -- Auth tag for GCM
  pds_access_token VARCHAR(1000), -- AT Protocol access token
  pds_refresh_token VARCHAR(1000), -- AT Protocol refresh token (if applicable)
  status VARCHAR(50) DEFAULT 'pending', -- pending, active, error, revoked
  error_message TEXT, -- Error details if status = error
  last_verified_at TIMESTAMP, -- Last health check
  verification_status VARCHAR(50), -- accessible, inaccessible, unknown
  key_rotation_date TIMESTAMP, -- When keys were last rotated
  next_key_rotation TIMESTAMP DEFAULT CURRENT_TIMESTAMP + INTERVAL '90 days',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT valid_status CHECK (status IN ('pending', 'active', 'error', 'revoked')),
  CONSTRAINT valid_verification_status CHECK (verification_status IN ('accessible', 'inaccessible', 'unknown'))
);

-- Indexes for user_pds_mapping
CREATE INDEX idx_user_pds_mapping_user_id ON user_pds_mapping(user_id);
CREATE INDEX idx_user_pds_mapping_pnptv_uuid ON user_pds_mapping(pnptv_uuid);
CREATE INDEX idx_user_pds_mapping_pds_did ON user_pds_mapping(pds_did);
CREATE INDEX idx_user_pds_mapping_pds_handle ON user_pds_mapping(pds_handle);
CREATE INDEX idx_user_pds_mapping_status ON user_pds_mapping(status);
CREATE INDEX idx_user_pds_mapping_created_at ON user_pds_mapping(created_at);

-- Create pds_provisioning_log table for audit trail
CREATE TABLE IF NOT EXISTS pds_provisioning_log (
  id BIGSERIAL PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pnptv_uuid UUID NOT NULL,
  action VARCHAR(100) NOT NULL, -- created, updated, verified, error, revoked, key_rotated
  status VARCHAR(50) NOT NULL, -- success, failed, pending
  details JSONB, -- Additional context (error details, old values, etc.)
  error_code VARCHAR(100), -- Error code if failed
  error_message TEXT, -- Human-readable error
  created_by VARCHAR(255), -- User/system that triggered action
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT valid_log_action CHECK (action IN ('created', 'updated', 'verified', 'error', 'revoked', 'key_rotated', 'retry', 'health_check')),
  CONSTRAINT valid_log_status CHECK (status IN ('success', 'failed', 'pending'))
);

-- Indexes for pds_provisioning_log
CREATE INDEX idx_pds_log_user_id ON pds_provisioning_log(user_id);
CREATE INDEX idx_pds_log_pnptv_uuid ON pds_provisioning_log(pnptv_uuid);
CREATE INDEX idx_pds_log_action ON pds_provisioning_log(action);
CREATE INDEX idx_pds_log_status ON pds_provisioning_log(status);
CREATE INDEX idx_pds_log_created_at ON pds_provisioning_log(created_at);

-- Create pds_health_checks table for monitoring
CREATE TABLE IF NOT EXISTS pds_health_checks (
  id BIGSERIAL PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pnptv_uuid UUID NOT NULL,
  pds_endpoint VARCHAR(500),
  check_type VARCHAR(50) NOT NULL, -- connectivity, endpoint_reachable, at_protocol, credentials
  status VARCHAR(50) NOT NULL, -- success, failed, timeout
  response_time_ms INTEGER,
  details JSONB,
  error_message TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT valid_check_type CHECK (check_type IN ('connectivity', 'endpoint_reachable', 'at_protocol', 'credentials')),
  CONSTRAINT valid_check_status CHECK (status IN ('success', 'failed', 'timeout'))
);

-- Indexes for pds_health_checks
CREATE INDEX idx_pds_health_user_id ON pds_health_checks(user_id);
CREATE INDEX idx_pds_health_pnptv_uuid ON pds_health_checks(pnptv_uuid);
CREATE INDEX idx_pds_health_check_type ON pds_health_checks(check_type);
CREATE INDEX idx_pds_health_status ON pds_health_checks(status);
CREATE INDEX idx_pds_health_created_at ON pds_health_checks(created_at);

-- Create pds_credential_backups table for recovery
CREATE TABLE IF NOT EXISTS pds_credential_backups (
  id BIGSERIAL PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pnptv_uuid UUID NOT NULL,
  backup_type VARCHAR(50) NOT NULL, -- manual, auto, recovery
  backup_data_encrypted TEXT NOT NULL, -- Full encrypted backup
  backup_iv VARCHAR(32),
  backup_auth_tag VARCHAR(32),
  is_used BOOLEAN DEFAULT FALSE,
  used_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP + INTERVAL '30 days',

  CONSTRAINT valid_backup_type CHECK (backup_type IN ('manual', 'auto', 'recovery'))
);

-- Indexes for pds_credential_backups
CREATE INDEX idx_pds_backup_user_id ON pds_credential_backups(user_id);
CREATE INDEX idx_pds_backup_pnptv_uuid ON pds_credential_backups(pnptv_uuid);
CREATE INDEX idx_pds_backup_is_used ON pds_credential_backups(is_used);
CREATE INDEX idx_pds_backup_created_at ON pds_credential_backups(created_at);

-- Create PDS provisioning queue for async retry
CREATE TABLE IF NOT EXISTS pds_provisioning_queue (
  id BIGSERIAL PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pnptv_uuid UUID NOT NULL,
  action VARCHAR(100) NOT NULL, -- create, verify, rotate_keys, retry
  attempt_count INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,
  next_retry TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  error_details JSONB,
  status VARCHAR(50) DEFAULT 'pending', -- pending, processing, completed, failed
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT valid_queue_action CHECK (action IN ('create', 'verify', 'rotate_keys', 'retry')),
  CONSTRAINT valid_queue_status CHECK (status IN ('pending', 'processing', 'completed', 'failed'))
);

-- Indexes for pds_provisioning_queue
CREATE INDEX idx_pds_queue_user_id ON pds_provisioning_queue(user_id);
CREATE INDEX idx_pds_queue_status ON pds_provisioning_queue(status);
CREATE INDEX idx_pds_queue_next_retry ON pds_provisioning_queue(next_retry);
CREATE INDEX idx_pds_queue_created_at ON pds_provisioning_queue(created_at);

-- Create function to auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_pds_mapping_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for user_pds_mapping
CREATE TRIGGER trigger_pds_mapping_update_timestamp
BEFORE UPDATE ON user_pds_mapping
FOR EACH ROW
EXECUTE FUNCTION update_pds_mapping_timestamp();

-- Grant permissions (adjust as needed)
ALTER TABLE user_pds_mapping OWNER TO postgres;
ALTER TABLE pds_provisioning_log OWNER TO postgres;
ALTER TABLE pds_health_checks OWNER TO postgres;
ALTER TABLE pds_credential_backups OWNER TO postgres;
ALTER TABLE pds_provisioning_queue OWNER TO postgres;
