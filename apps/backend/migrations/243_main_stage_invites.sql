-- Migration 243: Main Stage guest invites
-- Allows admins to generate short-lived invite links for external guests.

BEGIN;

CREATE TABLE main_stage_invites (
  id            BIGSERIAL PRIMARY KEY,
  code          TEXT NOT NULL UNIQUE,
  created_by    TEXT NOT NULL REFERENCES users(id),
  label         TEXT,
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
  max_uses      INTEGER NOT NULL DEFAULT 1,   -- 0 = unlimited
  used_count    INTEGER NOT NULL DEFAULT 0,
  revoked_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_main_stage_invites_code
  ON main_stage_invites (code)
  WHERE revoked_at IS NULL;

CREATE INDEX idx_main_stage_invites_creator
  ON main_stage_invites (created_by, created_at DESC);

-- Audit log: one row per redemption attempt (successful or failed).
CREATE TABLE main_stage_invite_uses (
  id              BIGSERIAL PRIMARY KEY,
  invite_id       BIGINT NOT NULL REFERENCES main_stage_invites(id) ON DELETE CASCADE,
  display_name    TEXT NOT NULL,
  -- SHA-256 hash of concat(ip, user_agent) — never store raw PII
  fingerprint_hash TEXT,
  -- livekit identity issued on success; NULL means redemption was rejected
  lk_identity     TEXT,
  error_code      TEXT,   -- e.g. INVITE_EXPIRED if rejected
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ms_invite_uses_invite_id ON main_stage_invite_uses (invite_id, created_at DESC);

COMMIT;
