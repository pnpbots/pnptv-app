-- Migration 215: Cristina-in-call presence
-- Tracks which hangout calls Cristina is attached to and when she last spoke,
-- so tip rotation survives pod restarts without spamming participants.

CREATE TABLE IF NOT EXISTS hangout_call_cristina_sessions (
  call_id       UUID         PRIMARY KEY REFERENCES hangout_video_calls(id) ON DELETE CASCADE,
  group_id      INTEGER      NOT NULL,
  attached_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  last_tip_at   TIMESTAMPTZ,
  last_video_at TIMESTAMPTZ,
  tip_count     INT          NOT NULL DEFAULT 0,
  ask_count     INT          NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_hangout_call_cristina_group
  ON hangout_call_cristina_sessions(group_id);

CREATE INDEX IF NOT EXISTS idx_hangout_call_cristina_attached
  ON hangout_call_cristina_sessions(attached_at DESC);
