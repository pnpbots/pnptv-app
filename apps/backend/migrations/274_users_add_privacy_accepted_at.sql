-- Migration 274: track explicit privacy-policy acceptance timestamp + IP
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS privacy_accepted_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS privacy_accepted_ip  VARCHAR(45);
