-- 088_model_applications.sql
-- Self-service model/creator application system

CREATE TABLE IF NOT EXISTS model_applications (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  application_type  TEXT        NOT NULL CHECK (application_type IN ('live','content_creator','both')),
  -- Step 2: Basic Info
  stage_name        TEXT        NOT NULL,
  bio               TEXT,
  instagram_handle  TEXT,
  twitter_handle    TEXT,
  onlyfans_url      TEXT,
  profile_photo_url TEXT,
  -- Step 3: Legal (2257 compliance)
  legal_full_name   TEXT        NOT NULL,
  date_of_birth     DATE        NOT NULL,
  country           TEXT        NOT NULL,
  city_state        TEXT        NOT NULL,
  id_front_url      TEXT        NOT NULL,
  id_back_url       TEXT        NOT NULL,
  -- Step 4: Agreement
  terms_agreed      BOOLEAN     NOT NULL DEFAULT FALSE,
  terms_agreed_at   TIMESTAMPTZ,
  terms_version     TEXT        DEFAULT '1.0',
  -- Step 5: Cal.com scheduling
  call_scheduled    BOOLEAN     DEFAULT FALSE,
  call_scheduled_at TIMESTAMPTZ,
  -- Admin review
  status            TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','withdrawn')),
  admin_notes       TEXT,
  reviewed_by       TEXT        REFERENCES users(id),
  reviewed_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_model_apps_user   ON model_applications(user_id);
CREATE INDEX IF NOT EXISTS idx_model_apps_status ON model_applications(status);

CREATE TRIGGER update_model_applications_updated_at
  BEFORE UPDATE ON model_applications
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
