-- Migration 151: Add consumer_key_ref to x_accounts
-- Stores which X app consumer key pair to use when signing OAuth 1.0a requests.
-- Values map to env var prefix: 'generic' → GENERIC_CONSUMER_KEY, 'santino' → SANTINO_CONSUMER_KEY, etc.
ALTER TABLE x_accounts
  ADD COLUMN IF NOT EXISTS consumer_key_ref VARCHAR(20) NOT NULL DEFAULT 'generic';
