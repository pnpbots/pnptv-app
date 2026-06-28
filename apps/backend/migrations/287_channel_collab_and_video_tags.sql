-- Migration 287: channel collaborators + per-video creator tags
-- 2026-06-28
BEGIN;

-- Allow multiple uploaders on a channel (co-owners)
ALTER TABLE creator_channels
  ADD COLUMN IF NOT EXISTS collaborator_ids TEXT[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_creator_channels_collaborators
  ON creator_channels USING GIN (collaborator_ids);

-- Per-video creator tags (performers featured in this video)
ALTER TABLE channel_videos
  ADD COLUMN IF NOT EXISTS tagged_creator_ids TEXT[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_channel_videos_tagged_creators
  ON channel_videos USING GIN (tagged_creator_ids);

COMMIT;
