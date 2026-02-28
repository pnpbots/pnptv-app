-- Migration 086: Persistent (24/7) video calls for community groups
-- Adds is_persistent flag so calls for is_main groups survive when everyone leaves.

ALTER TABLE hangout_video_calls
  ADD COLUMN IF NOT EXISTS is_persistent BOOLEAN NOT NULL DEFAULT FALSE;

-- Bootstrap a persistent active call for the community group (id=1, is_main=true).
-- Uses a stable room name that never changes, so Jitsi state is continuous.
-- ON CONFLICT: if a call already exists (status=active), this is a no-op.
INSERT INTO hangout_video_calls (group_id, creator_id, room_name, status, is_persistent)
SELECT
  hg.id,
  COALESCE(hg.creator_id, '0'),
  'pnptv-community-haus',
  'active',
  TRUE
FROM hangout_groups hg
WHERE hg.is_main = TRUE
  AND NOT EXISTS (
    SELECT 1 FROM hangout_video_calls hvc
    WHERE hvc.group_id = hg.id AND hvc.status = 'active'
  );
