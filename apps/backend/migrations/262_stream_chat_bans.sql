CREATE TABLE IF NOT EXISTS stream_chat_bans (
  id           SERIAL PRIMARY KEY,
  channel_ref  VARCHAR(120) NOT NULL,
  banned_user_id VARCHAR(255) NOT NULL,
  banned_by_user_id VARCHAR(255) NOT NULL,
  action       VARCHAR(20) NOT NULL DEFAULT 'ban',  -- 'ban' | 'mute'
  mute_until   TIMESTAMPTZ DEFAULT NULL,            -- NULL = permanent ban from chat
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(channel_ref, banned_user_id)
);
CREATE INDEX IF NOT EXISTS idx_chat_bans_channel ON stream_chat_bans(channel_ref);
