-- Migration 169: Add reply_to_id to chat_messages for reply-to-message feature
-- Allows users to reply to specific messages in group chat and hangout rooms

ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS reply_to_id INTEGER REFERENCES chat_messages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_chat_messages_reply_to ON chat_messages(reply_to_id) WHERE reply_to_id IS NOT NULL;
