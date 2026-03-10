CREATE TABLE IF NOT EXISTS stream_auto_messages (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  boundaries TEXT NOT NULL DEFAULT '',
  turn_ons TEXT NOT NULL DEFAULT '',
  stream_goal TEXT NOT NULL DEFAULT '',
  messages JSONB NOT NULL DEFAULT '[]',
  is_active BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_stream_auto_msgs_user ON stream_auto_messages(user_id);
