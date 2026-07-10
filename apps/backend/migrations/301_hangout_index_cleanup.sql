-- Migration 301: Hangout index cleanup and performance indexes
--
-- 1. Drop duplicate indexes on chat_message_reactions (created by two migration runs)
-- 2. Drop duplicate unique partial index on hangout_video_calls
-- 3. Add missing performance indexes for hangout queries

-- Drop duplicates on chat_message_reactions
DROP INDEX IF EXISTS idx_chat_reactions_message_id;
DROP INDEX IF EXISTS idx_chat_reactions_user_id;

-- Drop duplicate unique constraint on hangout_video_calls (keep uniq_hangout_active_call)
DROP INDEX IF EXISTS idx_hangout_video_calls_active;

-- group_points: composite index for getWeeklyPoints() date-range scan
CREATE INDEX IF NOT EXISTS idx_gp_chat_date
  ON group_points (telegram_chat_id, created_at)
  WHERE created_at IS NOT NULL;

-- group_activity_ranks: ordering index for weekly ranking within a group
CREATE INDEX IF NOT EXISTS idx_gar_chat_week_rank
  ON group_activity_ranks (telegram_chat_id, week_start, points DESC);

-- hangout_group_members: covering index for role lookups (isOwnerOrMod, permission checks)
CREATE INDEX IF NOT EXISTS idx_hgm_group_user_role
  ON hangout_group_members (group_id, user_id, role);

-- chat_messages: index for slow-mode check (room + user + recent message)
CREATE INDEX IF NOT EXISTS idx_chat_messages_room_user_recent
  ON chat_messages (room, user_id, created_at DESC)
  WHERE is_deleted = false;
