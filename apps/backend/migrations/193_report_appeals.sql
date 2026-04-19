-- 193_report_appeals.sql
-- Public appeal form for banned / suspended users. Submitter is not
-- authenticated; we match them to a user record via submitted_identifier
-- (Telegram username or numeric id or email) at review time.

CREATE TABLE IF NOT EXISTS report_appeals (
  id                      BIGSERIAL PRIMARY KEY,
  submitted_identifier    VARCHAR(255) NOT NULL,           -- user-typed: @handle, numeric id, or email
  resolved_user_id        VARCHAR(255)      REFERENCES users(id) ON DELETE SET NULL,
  contact_email           VARCHAR(255) NOT NULL,
  explanation             TEXT         NOT NULL,
  status                  VARCHAR(20)  NOT NULL DEFAULT 'pending',
  admin_notes             TEXT,
  reviewer_id             VARCHAR(255)      REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at             TIMESTAMPTZ,
  ip                      INET,
  user_agent              TEXT,
  created_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT report_appeals_status_check CHECK (status IN (
    'pending','approved','denied'
  )),
  CONSTRAINT report_appeals_email_format CHECK (contact_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  CONSTRAINT report_appeals_explanation_len CHECK (char_length(explanation) BETWEEN 20 AND 2000)
);

CREATE INDEX IF NOT EXISTS idx_report_appeals_status_created
  ON report_appeals (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_report_appeals_ip_created
  ON report_appeals (ip, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_report_appeals_resolved_user
  ON report_appeals (resolved_user_id)
  WHERE resolved_user_id IS NOT NULL;

-- One PENDING appeal per resolved user at a time (prevents spam once matched).
CREATE UNIQUE INDEX IF NOT EXISTS idx_report_appeals_unique_pending
  ON report_appeals (resolved_user_id)
  WHERE status = 'pending' AND resolved_user_id IS NOT NULL;

CREATE OR REPLACE FUNCTION set_report_appeals_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_report_appeals_updated_at ON report_appeals;
CREATE TRIGGER trg_report_appeals_updated_at
BEFORE UPDATE ON report_appeals
FOR EACH ROW EXECUTE FUNCTION set_report_appeals_updated_at();
