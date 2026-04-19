-- 192_user_reports.sql
-- Community reporting system: allow any authenticated user to report another
-- user for rule violations. Admins triage in /admin/reports.

CREATE TABLE IF NOT EXISTS user_reports (
  id                  BIGSERIAL PRIMARY KEY,
  reporter_id         VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reported_user_id    VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category            VARCHAR(40)  NOT NULL,
  description         TEXT,
  evidence_type       VARCHAR(40),
  evidence_id         VARCHAR(255),
  status              VARCHAR(20)  NOT NULL DEFAULT 'pending',
  reviewer_id         VARCHAR(255)         REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at         TIMESTAMPTZ,
  action_notes        TEXT,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT user_reports_no_self_report CHECK (reporter_id <> reported_user_id),
  CONSTRAINT user_reports_category_check CHECK (category IN (
    'harassment','hate','spam_scam','impersonation','csam',
    'nudity_nonconsensual','self_harm','other'
  )),
  CONSTRAINT user_reports_status_check CHECK (status IN (
    'pending','reviewed','action_taken','dismissed'
  ))
);

-- Admin triage queue — most recent pending first
CREATE INDEX IF NOT EXISTS idx_user_reports_status_created
  ON user_reports (status, created_at DESC);

-- Rate-limit lookup: reports created by X in the last 24h
CREATE INDEX IF NOT EXISTS idx_user_reports_reporter_created
  ON user_reports (reporter_id, created_at DESC);

-- Lookup "who has been reported"
CREATE INDEX IF NOT EXISTS idx_user_reports_reported
  ON user_reports (reported_user_id, status);

-- One OPEN report per reporter/reported pair (avoid duplicate pending reports).
-- Closed reports don't block new ones, so a user can re-report if new behavior occurs.
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_reports_unique_open
  ON user_reports (reporter_id, reported_user_id)
  WHERE status = 'pending';

-- auto-update updated_at on UPDATE
CREATE OR REPLACE FUNCTION set_user_reports_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_user_reports_updated_at ON user_reports;
CREATE TRIGGER trg_user_reports_updated_at
BEFORE UPDATE ON user_reports
FOR EACH ROW EXECUTE FUNCTION set_user_reports_updated_at();
