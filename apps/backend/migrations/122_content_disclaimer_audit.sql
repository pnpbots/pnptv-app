-- Migration: 122_content_disclaimer_audit
-- Purpose: Add audit columns for content disclaimer acceptance (timestamp + IP)
-- Once accepted, this consent cannot be reverted.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS content_disclaimer_accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS content_disclaimer_accepted_ip VARCHAR(45);
