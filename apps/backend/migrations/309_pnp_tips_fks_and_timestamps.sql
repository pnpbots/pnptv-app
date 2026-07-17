-- Migration 309: pnp_tips referential integrity + TZ-aware timestamps
--
-- Findings from the 2026-07-17 tokens-flow audit:
--   * pnp_tips has no FK on user_id / performer_id → 4 orphan rows appeared
--     when performers were hard-deleted mid-flight. Orphans were remapped
--     to the system account (id=8552451957) manually before this migration.
--   * pnp_tips.created_at and completed_at are TIMESTAMP WITHOUT TIME ZONE.
--     Every other table in the tokens flow uses TIMESTAMPTZ; joining across
--     silently applies the server's local offset (UTC on this box, but the
--     mismatch is a landmine for anyone reading these in a non-UTC session).
--
-- All ops are additive / idempotent.

-- ── 1. Convert TIMESTAMP → TIMESTAMPTZ ─────────────────────────────────────
-- Existing values are UTC-encoded (server tz is UTC), so an AT TIME ZONE 'UTC'
-- cast turns naive UTC into the tz-aware equivalent without shifting.
ALTER TABLE pnp_tips
  ALTER COLUMN created_at   TYPE TIMESTAMPTZ USING (created_at   AT TIME ZONE 'UTC'),
  ALTER COLUMN completed_at TYPE TIMESTAMPTZ USING (completed_at AT TIME ZONE 'UTC');

-- ── 2. Add FKs on user_id / performer_id ───────────────────────────────────
-- ON DELETE RESTRICT: financial audit rows; deleting a user must be prevented
-- until their tip history is resolved (soft-delete via users.is_deleted stays
-- unaffected — the FK only fires on hard DELETE).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_pnp_tips_user_id' AND conrelid = 'pnp_tips'::regclass
  ) THEN
    ALTER TABLE pnp_tips
      ADD CONSTRAINT fk_pnp_tips_user_id
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_pnp_tips_performer_id' AND conrelid = 'pnp_tips'::regclass
  ) THEN
    ALTER TABLE pnp_tips
      ADD CONSTRAINT fk_pnp_tips_performer_id
      FOREIGN KEY (performer_id) REFERENCES users(id) ON DELETE RESTRICT
      NOT VALID;
  END IF;
END $$;

-- Validate immediately — we cleaned orphans out manually before running this.
-- If validation fails, another orphan snuck in; investigate before proceeding.
ALTER TABLE pnp_tips VALIDATE CONSTRAINT fk_pnp_tips_user_id;
ALTER TABLE pnp_tips VALIDATE CONSTRAINT fk_pnp_tips_performer_id;
