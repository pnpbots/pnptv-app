-- Hangout group join requests for private groups
CREATE TABLE IF NOT EXISTS hangout_join_requests (
  id SERIAL PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES hangout_groups(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT,
  UNIQUE (group_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_hangout_join_requests_group_status
  ON hangout_join_requests (group_id, status);
