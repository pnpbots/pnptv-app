-- 239_users_plan_id_index.sql
-- Adds a btree index on users.plan_id to speed up the lifetime/plan-based
-- membership-sync UPDATE that ran ~780ms full-scan at boot.

CREATE INDEX IF NOT EXISTS idx_users_plan_id ON users (plan_id);
