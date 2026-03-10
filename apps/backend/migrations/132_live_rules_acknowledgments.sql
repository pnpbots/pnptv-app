-- Migration 132: Live stream rules acknowledgment tracking
-- Stores a record per user per rules version when they acknowledge the
-- live stream rules modal before joining a broadcast.
-- Bumping `version` in application code re-triggers the modal for all users.
--
-- UP ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS live_rules_acknowledgments (
  id               SERIAL      PRIMARY KEY,
  user_id          TEXT        NOT NULL,
  version          INTEGER     NOT NULL DEFAULT 1,
  acknowledged_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_live_rules_ack_user_version UNIQUE (user_id, version)
);

-- Fast lookup: "has this user acked the current version?"
-- Query pattern: WHERE user_id = $1 AND version = $2
CREATE INDEX IF NOT EXISTS idx_live_rules_ack_user
  ON live_rules_acknowledgments (user_id);

-- No FK on user_id intentionally: acknowledgments are audit records and must
-- survive user deletion (ON DELETE CASCADE would destroy compliance history).

-- ─────────────────────────────────────────────────────────────────────────────
-- DOWN (reverse this migration manually if needed)
-- DROP INDEX IF EXISTS idx_live_rules_ack_user;
-- DROP TABLE IF EXISTS live_rules_acknowledgments;
-- ─────────────────────────────────────────────────────────────────────────────
