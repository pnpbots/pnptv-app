ALTER TABLE creator_subscriptions
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

UPDATE creator_subscriptions SET updated_at = COALESCE(started_at, created_at);
