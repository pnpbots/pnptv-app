-- Migration 184: Drop legacy JaaS columns from hangout_video_calls
-- These were used by the old Jitsi/JaaS video call system (pre-LiveKit migration).
-- All active code uses room_name + LiveKit; these columns are never written or queried.

ALTER TABLE hangout_video_calls
  DROP COLUMN IF EXISTS jaas_room_name,
  DROP COLUMN IF EXISTS jitsi_domain;
