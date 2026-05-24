-- Migration 258: add bonus_tokens to plans
-- Plans can carry a one-time token credit granted at purchase (1 token = $1 USD).
ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS bonus_tokens integer NOT NULL DEFAULT 0;
