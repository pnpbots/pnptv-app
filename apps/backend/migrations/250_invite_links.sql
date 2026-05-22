-- Migration 250: Admin invite links with Colombia badge
-- Creates invite_links and invite_link_uses tables,
-- and adds colombia_badge column to users.

CREATE TABLE IF NOT EXISTS invite_links (
  code         VARCHAR(12) PRIMARY KEY,
  created_by   TEXT NOT NULL,
  note         TEXT,
  sku          VARCHAR(64) NOT NULL DEFAULT 'pnp-member',
  is_lifetime  BOOLEAN NOT NULL DEFAULT true,
  max_uses     INTEGER,
  use_count    INTEGER NOT NULL DEFAULT 0,
  expires_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS invite_link_uses (
  id          SERIAL PRIMARY KEY,
  code        VARCHAR(12) NOT NULL REFERENCES invite_links(code),
  user_id     TEXT NOT NULL,
  redeemed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(code, user_id)
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS colombia_badge BOOLEAN NOT NULL DEFAULT false;
