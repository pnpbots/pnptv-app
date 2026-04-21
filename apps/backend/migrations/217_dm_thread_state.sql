-- Telegram-style inbox: per-user thread state (pin / mute / archive / pin-message)
-- and read-receipt timestamps for ✓✓ visualization.

CREATE TABLE IF NOT EXISTS dm_thread_state (
  user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  partner_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pinned_at TIMESTAMPTZ,
  muted_until TIMESTAMPTZ,
  archived_at TIMESTAMPTZ,
  pinned_message_id BIGINT REFERENCES direct_messages(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, partner_id)
);

CREATE INDEX IF NOT EXISTS idx_dm_state_user_pinned ON dm_thread_state(user_id, pinned_at) WHERE pinned_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dm_state_user_archived ON dm_thread_state(user_id, archived_at) WHERE archived_at IS NOT NULL;

-- Read receipts: when did the recipient read this message
ALTER TABLE direct_messages ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_dm_read_at ON direct_messages(recipient_id, read_at) WHERE read_at IS NOT NULL;
