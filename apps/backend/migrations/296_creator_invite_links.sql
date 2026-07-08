-- Migration 296: Creator invite links (scoped access)
-- Adds resource_type, resource_id, duration_hours to invite_links so creators
-- can generate links that grant channel-access or creator-subscription access.

ALTER TABLE invite_links
  ADD COLUMN IF NOT EXISTS resource_type  VARCHAR(32),   -- 'channel' | 'creator'
  ADD COLUMN IF NOT EXISTS resource_id    TEXT,          -- channel_id or creator pnptv_id
  ADD COLUMN IF NOT EXISTS duration_hours INT DEFAULT 72; -- timed grant duration

-- Index for creator-owned link lookups
CREATE INDEX IF NOT EXISTS idx_invite_links_created_by ON invite_links (created_by);
