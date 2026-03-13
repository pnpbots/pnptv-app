-- Migration 162: Enable push + bot for ALL notification types by default
--
-- Changes:
--   1. group_messages: push false→true, bot false→true
--   2. group_joins:    push false→true, bot false→true
--   3. Add "reactions" and "mentions" preference keys (were missing)
--   4. Backfill existing users with new defaults (user overrides preserved)

-- ─── NEW DEFAULT ─────────────────────────────────────────────────────────────

ALTER TABLE users ALTER COLUMN notification_preferences SET DEFAULT '{
  "likes":          { "inApp": true,  "bot": true,  "email": true,  "push": true  },
  "follows":        { "inApp": true,  "bot": true,  "email": true,  "push": true  },
  "replies":        { "inApp": true,  "bot": true,  "email": true,  "push": true  },
  "dms":            { "inApp": true,  "bot": true,  "email": false, "push": true  },
  "group_messages": { "inApp": true,  "bot": true,  "email": false, "push": true  },
  "group_joins":    { "inApp": true,  "bot": true,  "email": false, "push": true  },
  "reactions":      { "inApp": true,  "bot": true,  "email": true,  "push": true  },
  "mentions":       { "inApp": true,  "bot": true,  "email": true,  "push": true  },
  "wof":            { "inApp": true,  "bot": true,  "email": true,  "push": true  },
  "payments":       { "inApp": true,  "bot": true,  "email": true,  "push": true  },
  "announcements":  { "inApp": true,  "bot": true,  "email": true,  "push": true  },
  "hangout_calls":  { "inApp": true,  "bot": true,  "email": false, "push": true  },
  "quiet_hours":    { "enabled": false, "start": "23:00", "end": "08:00" }
}'::jsonb;

-- ─── BACKFILL: add missing keys + upgrade group_messages/group_joins ────────

-- 1. Add "reactions" key where missing
UPDATE users
SET notification_preferences = notification_preferences || '{"reactions": {"inApp": true, "bot": true, "email": true, "push": true}}'::jsonb
WHERE notification_preferences IS NOT NULL
  AND NOT (notification_preferences ? 'reactions');

-- 2. Add "mentions" key where missing
UPDATE users
SET notification_preferences = notification_preferences || '{"mentions": {"inApp": true, "bot": true, "email": true, "push": true}}'::jsonb
WHERE notification_preferences IS NOT NULL
  AND NOT (notification_preferences ? 'mentions');

-- 3. Enable push+bot for group_messages (only if currently false)
UPDATE users
SET notification_preferences = jsonb_set(
  jsonb_set(notification_preferences, '{group_messages,push}', 'true'::jsonb),
  '{group_messages,bot}', 'true'::jsonb
)
WHERE notification_preferences IS NOT NULL
  AND notification_preferences ? 'group_messages'
  AND jsonb_typeof(notification_preferences -> 'group_messages') = 'object'
  AND (
    (notification_preferences -> 'group_messages' -> 'push')::text = 'false'
    OR (notification_preferences -> 'group_messages' -> 'bot')::text = 'false'
  );

-- 4. Enable push+bot for group_joins (only if currently false)
UPDATE users
SET notification_preferences = jsonb_set(
  jsonb_set(notification_preferences, '{group_joins,push}', 'true'::jsonb),
  '{group_joins,bot}', 'true'::jsonb
)
WHERE notification_preferences IS NOT NULL
  AND notification_preferences ? 'group_joins'
  AND jsonb_typeof(notification_preferences -> 'group_joins') = 'object'
  AND (
    (notification_preferences -> 'group_joins' -> 'push')::text = 'false'
    OR (notification_preferences -> 'group_joins' -> 'bot')::text = 'false'
  );

-- 5. Enable bot for dms (was false by default)
UPDATE users
SET notification_preferences = jsonb_set(notification_preferences, '{dms,bot}', 'true'::jsonb)
WHERE notification_preferences IS NOT NULL
  AND notification_preferences ? 'dms'
  AND jsonb_typeof(notification_preferences -> 'dms') = 'object'
  AND (notification_preferences -> 'dms' -> 'bot')::text = 'false';
