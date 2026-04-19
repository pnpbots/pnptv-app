-- Migration 209: Restore PNPtv Community (group id=26) as the auto-join
-- main/default group.
--
-- Context: 200_demote_main_stage_group.sql cleared is_main=TRUE on every row
-- to retire the deleted Main Stage UI. ensureMainGroupMembership() still
-- queries WHERE is_main=TRUE to auto-join new users, so after 200 no user
-- signed up was auto-joined. 153 users (as of this migration) are missing
-- from group 26 and cannot join its video calls.
--
-- Fix: flip is_main=TRUE for group 26 only, and backfill missing members.

UPDATE hangout_groups SET is_main = TRUE WHERE id = 26;

INSERT INTO hangout_group_members (group_id, user_id, role)
SELECT 26, u.id, 'member'
  FROM users u
  LEFT JOIN hangout_group_members m
    ON m.group_id = 26 AND m.user_id = u.id
 WHERE m.user_id IS NULL
ON CONFLICT (group_id, user_id) DO NOTHING;
