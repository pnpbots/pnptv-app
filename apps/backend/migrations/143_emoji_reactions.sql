-- Migration 143: Emoji reactions for posts, chat messages, and DMs

-- Reactions on social posts
CREATE TABLE IF NOT EXISTS post_reactions (
  id SERIAL PRIMARY KEY,
  post_id INTEGER NOT NULL REFERENCES social_posts(id) ON DELETE CASCADE,
  user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji VARCHAR(50) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(post_id, user_id, emoji)
);

CREATE INDEX IF NOT EXISTS idx_post_reactions_post_id ON post_reactions(post_id);
CREATE INDEX IF NOT EXISTS idx_post_reactions_user_id ON post_reactions(user_id);

-- Reactions on chat room messages
CREATE TABLE IF NOT EXISTS chat_message_reactions (
  id SERIAL PRIMARY KEY,
  message_id INTEGER NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji VARCHAR(50) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(message_id, user_id, emoji)
);

CREATE INDEX IF NOT EXISTS idx_chat_reactions_message_id ON chat_message_reactions(message_id);
CREATE INDEX IF NOT EXISTS idx_chat_reactions_user_id ON chat_message_reactions(user_id);

-- Reactions on direct messages
CREATE TABLE IF NOT EXISTS dm_reactions (
  id SERIAL PRIMARY KEY,
  message_id INTEGER NOT NULL REFERENCES direct_messages(id) ON DELETE CASCADE,
  user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji VARCHAR(50) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(message_id, user_id, emoji)
);

CREATE INDEX IF NOT EXISTS idx_dm_reactions_message_id ON dm_reactions(message_id);
CREATE INDEX IF NOT EXISTS idx_dm_reactions_user_id ON dm_reactions(user_id);
