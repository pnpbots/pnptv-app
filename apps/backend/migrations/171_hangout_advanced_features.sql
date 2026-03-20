-- Migration 171: Hangout Advanced Features
-- Adds schema support for 12 new hangout group chat features:
--   1. Slow mode (per-group cooldown between messages)
--   2. Read-only mode (freeze chat for non-moderators)
--   3. Media toggle (enable/disable media uploads per group)
--   4. Member invite toggle (allow/restrict member-driven invites)
--   5. Auto-delete (TTL-based message expiry, hours)
--   6. Group tags (freeform categorization array)
--   7. Invite codes (shareable join links)
--   8. Member mute (soft mute per member)
--   9. Timed mute (mute expiry timestamp)
--  10. Member ban (hard ban from group)
--  11. Notification mode (per-member notification preference: all/mentions/none)
--  12. Pinned messages (group-scoped pinned message log)

-- hangout_groups: group-level settings
ALTER TABLE hangout_groups ADD COLUMN IF NOT EXISTS slow_mode_seconds INTEGER NOT NULL DEFAULT 0;
ALTER TABLE hangout_groups ADD COLUMN IF NOT EXISTS is_read_only BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE hangout_groups ADD COLUMN IF NOT EXISTS allow_media BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE hangout_groups ADD COLUMN IF NOT EXISTS allow_member_invites BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE hangout_groups ADD COLUMN IF NOT EXISTS auto_delete_hours INTEGER NOT NULL DEFAULT 0;
ALTER TABLE hangout_groups ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE hangout_groups ADD COLUMN IF NOT EXISTS invite_code TEXT UNIQUE;

-- hangout_group_members: per-member moderation and preference columns
ALTER TABLE hangout_group_members ADD COLUMN IF NOT EXISTS is_muted BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE hangout_group_members ADD COLUMN IF NOT EXISTS muted_until TIMESTAMPTZ;
ALTER TABLE hangout_group_members ADD COLUMN IF NOT EXISTS is_banned BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE hangout_group_members ADD COLUMN IF NOT EXISTS notification_mode TEXT NOT NULL DEFAULT 'all';

-- hangout_pinned_messages: tracks pinned messages per group (keyed by Matrix event ID)
CREATE TABLE IF NOT EXISTS hangout_pinned_messages (
  id SERIAL PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES hangout_groups(id) ON DELETE CASCADE,
  matrix_event_id TEXT NOT NULL,
  message_body TEXT,
  pinned_by TEXT NOT NULL,
  pinned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(group_id, matrix_event_id)
);

CREATE INDEX IF NOT EXISTS idx_hangout_pinned_messages_group ON hangout_pinned_messages(group_id);

-- Partial index for invite code lookups (only indexes non-null values)
CREATE INDEX IF NOT EXISTS idx_hangout_groups_invite_code ON hangout_groups(invite_code) WHERE invite_code IS NOT NULL;
