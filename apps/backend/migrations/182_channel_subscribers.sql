-- Channel Subscribers: Telegram-style channel follow/subscribe system
BEGIN;

CREATE TABLE IF NOT EXISTS channel_subscribers (
  channel_id   INT          NOT NULL REFERENCES creator_channels(id) ON DELETE CASCADE,
  user_id      VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (channel_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_channel_subs_channel ON channel_subscribers (channel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_channel_subs_user    ON channel_subscribers (user_id, created_at DESC);

-- Denormalized subscriber count on creator_channels (same pattern as users.followers_count)
ALTER TABLE creator_channels ADD COLUMN IF NOT EXISTS subscriber_count INT NOT NULL DEFAULT 0;

COMMIT;
