-- Migration 117: Add live_channel column to users table
-- Stores the Restreamer channel reference slug assigned to a user (e.g. 'pnptv-frank').
-- Used by /api/performers to resolve which user is behind a live Restreamer process,
-- and by /api/webapp/live/rtmp-key to return the correct RTMP stream name to the user.
-- NULL means the user has no assigned streaming channel.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS live_channel VARCHAR(100) DEFAULT NULL;

-- Unique partial index: a channel slug can be owned by at most one user at a time.
-- Allows multiple rows with NULL (unassigned users).
CREATE UNIQUE INDEX IF NOT EXISTS users_live_channel_unique
  ON users (live_channel)
  WHERE live_channel IS NOT NULL;

COMMENT ON COLUMN users.live_channel IS
  'Restreamer channel reference slug assigned to this user for RTMP streaming (e.g. pnptv-frank). NULL = no channel assigned.';
