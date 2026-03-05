-- Creator self-service enrollment table
CREATE TABLE IF NOT EXISTS creator_enrollments (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tier VARCHAR(20) NOT NULL CHECK (tier IN ('ice', 'crystal', 'diamond')),
  status VARCHAR(30) NOT NULL DEFAULT 'pending_review'
    CHECK (status IN ('pending_review', 'approved', 'rejected')),
  terms_accepted_at TIMESTAMPTZ,
  terms_accepted_ip VARCHAR(45),
  content_commitment_accepted_at TIMESTAMPTZ,
  payment_method VARCHAR(20) CHECK (payment_method IN ('meru', 'usdc', 'usdt')),
  payment_address TEXT,
  payment_network VARCHAR(50),
  id_document_path TEXT,
  signature_data TEXT,
  submitted_at TIMESTAMPTZ DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by TEXT REFERENCES users(id),
  admin_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_creator_enrollments_status
  ON creator_enrollments(status, submitted_at DESC);
