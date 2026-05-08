-- Migration 245: 18 U.S.C. § 2257 identity verification system
-- Adds identity_verified columns to users and a dedicated 2257 records table.

-- ── users table additions ─────────────────────────────────────────────────────

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS identity_verified BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS identity_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS identity_verification_required_by TIMESTAMPTZ;

-- 30-day grace period for existing active creators who are not yet verified
UPDATE users
  SET identity_verification_required_by = NOW() + INTERVAL '30 days'
  WHERE creator_status = 'active'
    AND identity_verified = FALSE;

-- ── 2257 records table ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS creator_2257_records (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  legal_name VARCHAR(255) NOT NULL,
  date_of_birth DATE NOT NULL,
  id_type VARCHAR(50) NOT NULL CHECK (id_type IN ('passport','drivers_license','national_id','state_id','other')),
  id_document_path TEXT NOT NULL,
  verification_status VARCHAR(30) NOT NULL DEFAULT 'pending'
    CHECK (verification_status IN ('pending','approved','rejected')),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  verified_at TIMESTAMPTZ,
  verified_by TEXT REFERENCES users(id),
  admin_notes TEXT,
  ip_address INET,
  UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_2257_records_user_id ON creator_2257_records(user_id);
CREATE INDEX IF NOT EXISTS idx_2257_records_status ON creator_2257_records(verification_status);
