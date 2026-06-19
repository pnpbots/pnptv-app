CREATE TABLE IF NOT EXISTS geo_invite_tokens (
  id          SERIAL PRIMARY KEY,
  token       VARCHAR(32)   NOT NULL UNIQUE,
  countries   TEXT[]        NOT NULL DEFAULT '{}',
  created_by  VARCHAR(255)  REFERENCES users(id) ON DELETE SET NULL,
  max_uses    INTEGER       NOT NULL DEFAULT 1,
  uses_count  INTEGER       NOT NULL DEFAULT 0,
  notes       TEXT,
  is_active   BOOLEAN       NOT NULL DEFAULT true,
  expires_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_geo_invite_tokens_token    ON geo_invite_tokens(token) WHERE is_active = true;
CREATE INDEX idx_geo_invite_tokens_creator  ON geo_invite_tokens(created_by);
