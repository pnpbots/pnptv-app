-- Migration 129: Upgrade notification_preferences to per-channel format
--
-- OLD format (boolean per key):
--   { "likes": true, "dms": false, ... }
--
-- NEW format (object per key with channel flags):
--   { "likes": { "inApp": true, "bot": true, "email": true, "push": true }, ... }
--
-- quiet_hours key shape (unchanged structure, newly enforced):
--   { "enabled": false, "start": "23:00", "end": "08:00" }

-- ─── NEW DEFAULT ─────────────────────────────────────────────────────────────

ALTER TABLE users ALTER COLUMN notification_preferences SET DEFAULT '{
  "likes":          { "inApp": true,  "bot": true,  "email": true,  "push": true  },
  "follows":        { "inApp": true,  "bot": true,  "email": true,  "push": true  },
  "replies":        { "inApp": true,  "bot": true,  "email": true,  "push": true  },
  "dms":            { "inApp": true,  "bot": false, "email": false, "push": true  },
  "group_messages": { "inApp": true,  "bot": false, "email": false, "push": false },
  "group_joins":    { "inApp": true,  "bot": false, "email": false, "push": false },
  "wof":            { "inApp": true,  "bot": true,  "email": true,  "push": true  },
  "payments":       { "inApp": true,  "bot": true,  "email": true,  "push": true  },
  "announcements":  { "inApp": true,  "bot": true,  "email": true,  "push": true  },
  "hangout_calls":  { "inApp": true,  "bot": true,  "email": false, "push": true  },
  "quiet_hours":    { "enabled": false, "start": "23:00", "end": "08:00" }
}'::jsonb;

-- ─── MIGRATE EXISTING ROWS ───────────────────────────────────────────────────

-- 1. Seed NULL rows with the new default
UPDATE users
SET notification_preferences = '{
  "likes":          { "inApp": true,  "bot": true,  "email": true,  "push": true  },
  "follows":        { "inApp": true,  "bot": true,  "email": true,  "push": true  },
  "replies":        { "inApp": true,  "bot": true,  "email": true,  "push": true  },
  "dms":            { "inApp": true,  "bot": false, "email": false, "push": true  },
  "group_messages": { "inApp": true,  "bot": false, "email": false, "push": false },
  "group_joins":    { "inApp": true,  "bot": false, "email": false, "push": false },
  "wof":            { "inApp": true,  "bot": true,  "email": true,  "push": true  },
  "payments":       { "inApp": true,  "bot": true,  "email": true,  "push": true  },
  "announcements":  { "inApp": true,  "bot": true,  "email": true,  "push": true  },
  "hangout_calls":  { "inApp": true,  "bot": true,  "email": false, "push": true  },
  "quiet_hours":    { "enabled": false, "start": "23:00", "end": "08:00" }
}'::jsonb
WHERE notification_preferences IS NULL;

-- 2. Convert any boolean-valued keys to channel objects.
--    boolean TRUE  → per-key default object (preserves intended per-channel defaults)
--    boolean FALSE → all-channels-off object
--    Keys already in object format are untouched (idempotent).
DO $$
DECLARE
  bool_keys TEXT[] := ARRAY[
    'likes', 'follows', 'replies', 'dms',
    'group_messages', 'group_joins', 'wof',
    'payments', 'announcements', 'hangout_calls'
  ];

  all_off CONSTANT JSONB := '{"inApp": false, "bot": false, "email": false, "push": false}'::jsonb;

  -- Per-key defaults used when the old value was TRUE.
  -- Using per-key objects (not all-on) to preserve the intended channel defaults.
  defaults JSONB := '{
    "likes":          { "inApp": true,  "bot": true,  "email": true,  "push": true  },
    "follows":        { "inApp": true,  "bot": true,  "email": true,  "push": true  },
    "replies":        { "inApp": true,  "bot": true,  "email": true,  "push": true  },
    "dms":            { "inApp": true,  "bot": false, "email": false, "push": true  },
    "group_messages": { "inApp": true,  "bot": false, "email": false, "push": false },
    "group_joins":    { "inApp": true,  "bot": false, "email": false, "push": false },
    "wof":            { "inApp": true,  "bot": true,  "email": true,  "push": true  },
    "payments":       { "inApp": true,  "bot": true,  "email": true,  "push": true  },
    "announcements":  { "inApp": true,  "bot": true,  "email": true,  "push": true  },
    "hangout_calls":  { "inApp": true,  "bot": true,  "email": false, "push": true  }
  }'::jsonb;

  k TEXT;
BEGIN
  FOREACH k IN ARRAY bool_keys LOOP
    -- boolean TRUE → per-key default object
    UPDATE users
    SET notification_preferences = jsonb_set(
      notification_preferences,
      ARRAY[k],
      defaults -> k
    )
    WHERE notification_preferences ? k
      AND jsonb_typeof(notification_preferences -> k) = 'boolean'
      AND (notification_preferences -> k)::text = 'true';

    -- boolean FALSE → all-off object
    UPDATE users
    SET notification_preferences = jsonb_set(
      notification_preferences,
      ARRAY[k],
      all_off
    )
    WHERE notification_preferences ? k
      AND jsonb_typeof(notification_preferences -> k) = 'boolean'
      AND (notification_preferences -> k)::text = 'false';
  END LOOP;
END;
$$;

-- 3. Back-fill any rows missing one or more keys.
--    Defaults go on the LEFT so the user's existing values (right side) always win.
UPDATE users
SET notification_preferences = (
  '{
    "likes":          { "inApp": true,  "bot": true,  "email": true,  "push": true  },
    "follows":        { "inApp": true,  "bot": true,  "email": true,  "push": true  },
    "replies":        { "inApp": true,  "bot": true,  "email": true,  "push": true  },
    "dms":            { "inApp": true,  "bot": false, "email": false, "push": true  },
    "group_messages": { "inApp": true,  "bot": false, "email": false, "push": false },
    "group_joins":    { "inApp": true,  "bot": false, "email": false, "push": false },
    "wof":            { "inApp": true,  "bot": true,  "email": true,  "push": true  },
    "payments":       { "inApp": true,  "bot": true,  "email": true,  "push": true  },
    "announcements":  { "inApp": true,  "bot": true,  "email": true,  "push": true  },
    "hangout_calls":  { "inApp": true,  "bot": true,  "email": false, "push": true  },
    "quiet_hours":    { "enabled": false, "start": "23:00", "end": "08:00" }
  }'::jsonb || notification_preferences
)
WHERE notification_preferences IS NOT NULL
  AND NOT (
    notification_preferences ? 'likes'
    AND notification_preferences ? 'follows'
    AND notification_preferences ? 'replies'
    AND notification_preferences ? 'dms'
    AND notification_preferences ? 'group_messages'
    AND notification_preferences ? 'group_joins'
    AND notification_preferences ? 'wof'
    AND notification_preferences ? 'payments'
    AND notification_preferences ? 'announcements'
    AND notification_preferences ? 'hangout_calls'
    AND notification_preferences ? 'quiet_hours'
  );

-- ─── DOWN (commented out — run manually to revert) ───────────────────────────
--
-- WARNING: Converts objects back to booleans using the inApp channel value.
-- Data loss: per-channel bot/email/push settings are discarded on revert.
--
-- DO $$
-- DECLARE
--   bool_keys TEXT[] := ARRAY[
--     'likes', 'follows', 'replies', 'dms',
--     'group_messages', 'group_joins', 'wof',
--     'payments', 'announcements', 'hangout_calls'
--   ];
--   k TEXT;
-- BEGIN
--   FOREACH k IN ARRAY bool_keys LOOP
--     UPDATE users
--     SET notification_preferences = jsonb_set(
--       notification_preferences,
--       ARRAY[k],
--       CASE
--         WHEN jsonb_typeof(notification_preferences -> k) = 'object'
--          AND (notification_preferences -> k -> 'inApp') IS NOT NULL
--         THEN (notification_preferences -> k -> 'inApp')
--         ELSE 'true'::jsonb
--       END
--     )
--     WHERE notification_preferences ? k
--       AND jsonb_typeof(notification_preferences -> k) = 'object';
--   END LOOP;
-- END;
-- $$;
--
-- ALTER TABLE users ALTER COLUMN notification_preferences SET DEFAULT '{
--   "likes": true, "follows": true, "replies": true, "dms": true,
--   "group_messages": true, "group_joins": true, "wof": true,
--   "payments": true, "announcements": true
-- }'::jsonb;
