BEGIN;

ALTER TABLE creator_channels ADD COLUMN IF NOT EXISTS collaborators TEXT[] DEFAULT '{}';

COMMENT ON COLUMN creator_channels.collaborators IS 'Array of user IDs (as text) who are co-creators on this channel. Only the channel owner (creator_id) can add/remove entries.';

COMMIT;
