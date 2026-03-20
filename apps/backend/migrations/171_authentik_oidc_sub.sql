-- Migration 171: Add authentik_sub column for OIDC identity linking
-- The authentik_sub stores the stable OIDC "sub" claim (UUID) returned by Authentik
-- on every login. It is the canonical identifier used to match an Authentik OIDC
-- session to a PNPtv user account. Unique partial index excludes NULL rows.
-- Date: 2026-03-20

BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS authentik_sub VARCHAR(255);

-- Unique partial index: only enforce uniqueness on non-NULL values
-- so existing users without an OIDC link can coexist safely.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_authentik_sub_unique
  ON users (authentik_sub)
  WHERE authentik_sub IS NOT NULL;

-- Standard lookup index used during callback upsert
CREATE INDEX IF NOT EXISTS idx_users_authentik_sub
  ON users (authentik_sub)
  WHERE authentik_sub IS NOT NULL;

COMMIT;
