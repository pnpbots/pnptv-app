-- Migration 166: Matrix bridge layer
-- Adds Matrix/Synapse credentials to users and mapping tables for DM + hangout rooms

-- User-level Matrix credentials (provisioned on first use via shared-secret registration)
ALTER TABLE users ADD COLUMN IF NOT EXISTS matrix_user_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS matrix_access_token TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS matrix_device_id TEXT;

-- Unique index so we can look up a PNPtv user from a Matrix user ID
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_matrix_user_id
  ON users(matrix_user_id)
  WHERE matrix_user_id IS NOT NULL;

-- One Matrix room per hangout group (1-to-1 mapping, cascades on group deletion)
CREATE TABLE IF NOT EXISTS hangout_matrix_rooms (
  hangout_group_id INTEGER PRIMARY KEY REFERENCES hangout_groups(id) ON DELETE CASCADE,
  matrix_room_id   TEXT NOT NULL,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- One Matrix DM room per ordered pair of PNPtv user IDs
-- user_a < user_b enforced in application layer to prevent duplicate pairs
CREATE TABLE IF NOT EXISTS dm_matrix_rooms (
  id             SERIAL PRIMARY KEY,
  user_a         INTEGER NOT NULL,
  user_b         INTEGER NOT NULL,
  matrix_room_id TEXT NOT NULL UNIQUE,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_a, user_b)
);

CREATE INDEX IF NOT EXISTS idx_dm_matrix_rooms_users
  ON dm_matrix_rooms(user_a, user_b);
