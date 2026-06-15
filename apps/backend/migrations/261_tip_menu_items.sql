CREATE TABLE IF NOT EXISTS tip_menu_items (
  id          SERIAL PRIMARY KEY,
  performer_id VARCHAR(255) NOT NULL,
  tokens_amount INT NOT NULL CHECK (tokens_amount > 0),
  label       VARCHAR(120) NOT NULL,
  sort_order  INT NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tip_menu_performer ON tip_menu_items(performer_id);
