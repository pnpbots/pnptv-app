-- 076: Dedicated hangout video calls table
-- Tracks JaaS-backed video calls within hangout groups.
-- Replaces the loose video_calls + group_id pattern with a purpose-built table.

BEGIN;

CREATE TABLE IF NOT EXISTS hangout_video_calls (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id      INTEGER NOT NULL REFERENCES hangout_groups(id) ON DELETE CASCADE,
  creator_id    INTEGER NOT NULL,
  room_name     VARCHAR(120) NOT NULL,
  status        VARCHAR(20) NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'ended')),
  max_participants INTEGER NOT NULL DEFAULT 50,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at      TIMESTAMPTZ,
  ended_by      INTEGER
);

-- Fast lookup of the active call for a given group (at most one active at a time)
CREATE UNIQUE INDEX IF NOT EXISTS idx_hangout_video_calls_active
  ON hangout_video_calls (group_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_hangout_video_calls_group
  ON hangout_video_calls (group_id, created_at DESC);

-- Participants who have joined/left a hangout video call
CREATE TABLE IF NOT EXISTS hangout_call_participants (
  id            SERIAL PRIMARY KEY,
  call_id       UUID NOT NULL REFERENCES hangout_video_calls(id) ON DELETE CASCADE,
  user_id       INTEGER NOT NULL,
  display_name  VARCHAR(120),
  joined_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  left_at       TIMESTAMPTZ,
  UNIQUE (call_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_hangout_call_participants_call
  ON hangout_call_participants (call_id);

-- Add a media_metadata JSONB column to chat_messages for extended file info
-- (dimensions, duration, original filename, etc.)
ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS media_metadata JSONB DEFAULT NULL;

COMMIT;
