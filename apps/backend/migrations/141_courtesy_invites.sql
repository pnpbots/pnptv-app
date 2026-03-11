-- Migration 141: Courtesy Invite Links
-- Admins and models can generate invite links that grant PRIME access to redeemers.

CREATE TABLE IF NOT EXISTS courtesy_invites (
  id SERIAL PRIMARY KEY,
  code VARCHAR(32) UNIQUE NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(pnptv_id) ON DELETE CASCADE,
  label TEXT,
  max_uses INTEGER NOT NULL DEFAULT 1,
  uses_count INTEGER NOT NULL DEFAULT 0,
  grant_days INTEGER NOT NULL DEFAULT 30,
  is_active BOOLEAN NOT NULL DEFAULT true,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS courtesy_invite_redemptions (
  id SERIAL PRIMARY KEY,
  invite_id INTEGER NOT NULL REFERENCES courtesy_invites(id) ON DELETE CASCADE,
  redeemed_by TEXT NOT NULL REFERENCES users(pnptv_id) ON DELETE CASCADE,
  redeemed_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(redeemed_by, invite_id)
);

CREATE INDEX IF NOT EXISTS idx_courtesy_invites_code ON courtesy_invites(code);
CREATE INDEX IF NOT EXISTS idx_courtesy_invites_created_by ON courtesy_invites(created_by);
CREATE INDEX IF NOT EXISTS idx_courtesy_redemptions_invite_id ON courtesy_invite_redemptions(invite_id);
CREATE INDEX IF NOT EXISTS idx_courtesy_redemptions_redeemed_by ON courtesy_invite_redemptions(redeemed_by);
