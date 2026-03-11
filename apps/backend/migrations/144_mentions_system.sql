-- Migration 144: @username mention tracking for posts, chat, and DMs

-- Mentions in social posts / replies
CREATE TABLE IF NOT EXISTS post_mentions (
  id SERIAL PRIMARY KEY,
  post_id INTEGER NOT NULL REFERENCES social_posts(id) ON DELETE CASCADE,
  mentioned_user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mentioner_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(post_id, mentioned_user_id)
);

CREATE INDEX IF NOT EXISTS idx_post_mentions_post_id ON post_mentions(post_id);
CREATE INDEX IF NOT EXISTS idx_post_mentions_mentioned_user ON post_mentions(mentioned_user_id);

-- Mentions in chat room messages
CREATE TABLE IF NOT EXISTS chat_message_mentions (
  id SERIAL PRIMARY KEY,
  message_id INTEGER NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  mentioned_user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mentioner_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(message_id, mentioned_user_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_mentions_message_id ON chat_message_mentions(message_id);
CREATE INDEX IF NOT EXISTS idx_chat_mentions_mentioned_user ON chat_message_mentions(mentioned_user_id);

-- Mentions in direct messages
CREATE TABLE IF NOT EXISTS dm_mentions (
  id SERIAL PRIMARY KEY,
  dm_id INTEGER NOT NULL REFERENCES direct_messages(id) ON DELETE CASCADE,
  mentioned_user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mentioner_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(dm_id, mentioned_user_id)
);

CREATE INDEX IF NOT EXISTS idx_dm_mentions_dm_id ON dm_mentions(dm_id);
CREATE INDEX IF NOT EXISTS idx_dm_mentions_mentioned_user ON dm_mentions(mentioned_user_id);
