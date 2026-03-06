-- Migration 113: Nearby place submissions (user-submitted places pending review)

CREATE TABLE IF NOT EXISTS nearby_place_submissions (
  id                    SERIAL PRIMARY KEY,
  submitted_by_user_id  VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name                  VARCHAR(200) NOT NULL,
  description           TEXT,
  address               VARCHAR(500),
  city                  VARCHAR(100),
  country               VARCHAR(100),
  category_id           INTEGER,
  place_type            VARCHAR(50),
  location_lat          DOUBLE PRECISION,
  location_lng          DOUBLE PRECISION,
  phone                 VARCHAR(50),
  website               VARCHAR(500),
  instagram             VARCHAR(100),
  status                VARCHAR(20) NOT NULL DEFAULT 'pending',
  created_at            TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nearby_place_submissions_user ON nearby_place_submissions(submitted_by_user_id);
CREATE INDEX IF NOT EXISTS idx_nearby_place_submissions_status ON nearby_place_submissions(status);
