-- Membership gifts: tracks who gifted what plan to whom.
-- gifter_id / recipient_id are TEXT (not FK) so gift history survives user deletion.

CREATE TABLE IF NOT EXISTS gifts (
  id             BIGSERIAL PRIMARY KEY,
  gifter_id      TEXT      NOT NULL,
  recipient_id   TEXT      NOT NULL,
  plan_id        TEXT      NOT NULL REFERENCES plans(id),
  duration_days  INT       NOT NULL,
  note           TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gifts_gifter    ON gifts(gifter_id);
CREATE INDEX IF NOT EXISTS idx_gifts_recipient ON gifts(recipient_id);
CREATE INDEX IF NOT EXISTS idx_gifts_created   ON gifts(created_at DESC);

-- Links each gifted entitlement row back to the gifter for traceability.
ALTER TABLE user_entitlements
  ADD COLUMN IF NOT EXISTS gifted_by TEXT;
