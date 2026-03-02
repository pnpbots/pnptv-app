-- Migration 097: Canva Connect API OAuth Integration
-- Adds Canva OAuth columns to users table and creates canva_export_jobs table

-- Canva OAuth columns on users table (matches X/ATProto pattern)
ALTER TABLE users ADD COLUMN IF NOT EXISTS canva_user_id VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS canva_display_name VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS canva_access_token_encrypted TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS canva_refresh_token_encrypted TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS canva_token_expires_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS canva_connected_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_canva_user_id
  ON users(canva_user_id) WHERE canva_user_id IS NOT NULL;

-- Export jobs table (tracks async export -> Directus upload pipeline)
CREATE TABLE IF NOT EXISTS canva_export_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  canva_design_id VARCHAR(255) NOT NULL,
  canva_export_id VARCHAR(255),
  design_title VARCHAR(500),
  export_format VARCHAR(10) NOT NULL DEFAULT 'mp4',
  export_quality VARCHAR(10) NOT NULL DEFAULT '1080p',
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','exporting','downloading','uploading','completed','failed')),
  directus_file_id VARCHAR(255),
  directus_content_id VARCHAR(255),
  error_message TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_canva_exports_user ON canva_export_jobs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_canva_exports_status ON canva_export_jobs(status) WHERE status NOT IN ('completed','failed');

ALTER TABLE canva_export_jobs OWNER TO pnptvbot;
