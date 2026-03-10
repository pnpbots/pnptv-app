-- Migration 137: Place interactions (favorites + reports)

-- User place favorites (toggle per user)
CREATE TABLE IF NOT EXISTS user_place_favorites (
  user_id     BIGINT NOT NULL,
  place_id    INTEGER NOT NULL REFERENCES nearby_places(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, place_id)
);
CREATE INDEX IF NOT EXISTS idx_upf_user ON user_place_favorites(user_id);
CREATE INDEX IF NOT EXISTS idx_upf_place ON user_place_favorites(place_id);

-- Place reports (one per user per place)
CREATE TABLE IF NOT EXISTS place_reports (
  id          SERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL,
  place_id    INTEGER NOT NULL REFERENCES nearby_places(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, place_id)
);
CREATE INDEX IF NOT EXISTS idx_pr_place ON place_reports(place_id);
