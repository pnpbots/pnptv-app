-- Migration 299: Weekly group activity ranking + strike system
--
-- group_activity_ranks:
--   One row per (group, user, week). Records the points earned in that week,
--   final rank position, whether they landed in the reward tier (top 30% → 7-day PRIME),
--   and audit of when the prime grant expires.
--
-- group_activity_strikes:
--   One row per (group, user). Tracks consecutive weeks with zero activity.
--   Two zero-activity weeks in a row → auto-kick from the Telegram group AND
--   removal from the linked hangout_groups room in the webapp.
--
-- Both tables are additive; nothing else changes.

CREATE TABLE IF NOT EXISTS group_activity_ranks (
  id                BIGSERIAL PRIMARY KEY,
  telegram_chat_id  TEXT        NOT NULL,
  user_id           TEXT        NOT NULL,
  telegram_user_id  TEXT,
  username          TEXT,
  week_start        DATE        NOT NULL,
  points            INTEGER     NOT NULL DEFAULT 0,
  rank_position     INTEGER,
  total_ranked      INTEGER,
  prime_awarded     BOOLEAN     NOT NULL DEFAULT false,
  prime_expires_at  TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (telegram_chat_id, user_id, week_start)
);

CREATE INDEX IF NOT EXISTS idx_gar_chat_week
  ON group_activity_ranks (telegram_chat_id, week_start);
CREATE INDEX IF NOT EXISTS idx_gar_user
  ON group_activity_ranks (user_id, week_start);
CREATE INDEX IF NOT EXISTS idx_gar_prime_active
  ON group_activity_ranks (prime_expires_at)
  WHERE prime_awarded = true AND prime_expires_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS group_activity_strikes (
  id                       BIGSERIAL PRIMARY KEY,
  telegram_chat_id         TEXT        NOT NULL,
  user_id                  TEXT        NOT NULL,
  telegram_user_id         TEXT,
  username                 TEXT,
  consecutive_zero_weeks   INTEGER     NOT NULL DEFAULT 1,
  last_zero_week_start     DATE        NOT NULL,
  first_zero_week_start    DATE        NOT NULL,
  kicked_at                TIMESTAMPTZ,
  hangout_removed_at       TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (telegram_chat_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_gas_chat
  ON group_activity_strikes (telegram_chat_id);
CREATE INDEX IF NOT EXISTS idx_gas_active
  ON group_activity_strikes (telegram_chat_id, consecutive_zero_weeks)
  WHERE kicked_at IS NULL;
