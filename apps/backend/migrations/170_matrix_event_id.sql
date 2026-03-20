-- Migration 170: Add matrix_event_id to chat_messages and direct_messages
-- Enables PG sync of Matrix-primary messages

ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS matrix_event_id TEXT;
ALTER TABLE direct_messages ADD COLUMN IF NOT EXISTS matrix_event_id TEXT;

CREATE INDEX IF NOT EXISTS idx_chat_messages_matrix_eid ON chat_messages(matrix_event_id) WHERE matrix_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dm_matrix_eid ON direct_messages(matrix_event_id) WHERE matrix_event_id IS NOT NULL;
