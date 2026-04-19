CREATE TABLE IF NOT EXISTS hangout_moderation_audit (
  id BIGSERIAL PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES hangout_groups(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL,
  target_id TEXT,
  action TEXT NOT NULL,
  reason TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hangout_moderation_audit_group_created
  ON hangout_moderation_audit (group_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_hangout_moderation_audit_actor
  ON hangout_moderation_audit (actor_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_hangout_moderation_audit_target
  ON hangout_moderation_audit (target_id, created_at DESC);
