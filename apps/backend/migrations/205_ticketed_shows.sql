-- Migration 205: ticketed live shows
-- live_streams is the schedule table (status='scheduled' rows are upcoming slots)
-- host_id is VARCHAR(255) referencing users(id)

ALTER TABLE live_streams
  ADD COLUMN IF NOT EXISTS is_ticketed BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS ticket_price_usd NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS ticket_price_tokens INTEGER;

CREATE TABLE IF NOT EXISTS live_show_tickets (
  id            BIGSERIAL PRIMARY KEY,
  slot_id       UUID NOT NULL REFERENCES live_streams(id) ON DELETE CASCADE,
  user_id       VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purchased_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  price_paid_tokens INTEGER,
  price_paid_usd    NUMERIC(10,2),
  UNIQUE(slot_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_live_show_tickets_user ON live_show_tickets(user_id);
CREATE INDEX IF NOT EXISTS idx_live_show_tickets_slot ON live_show_tickets(slot_id);
