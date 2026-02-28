-- Migration 079: Wall of Fame Hangout Group
-- Adds is_wall_of_fame column to hangout_groups and creates the WoF group row.

-- 1. Add the flag column
ALTER TABLE hangout_groups
  ADD COLUMN IF NOT EXISTS is_wall_of_fame BOOLEAN NOT NULL DEFAULT FALSE;

-- 2. Partial unique index: only one group can be the Wall of Fame (same pattern as is_main)
CREATE UNIQUE INDEX IF NOT EXISTS idx_hangout_groups_wall_of_fame
  ON hangout_groups (is_wall_of_fame) WHERE is_wall_of_fame = TRUE;

-- 3. Insert the Wall of Fame hangout group
INSERT INTO hangout_groups (name, description, creator_id, is_main, is_wall_of_fame, is_public, max_members)
VALUES (
  'Wall of Fame',
  'Community photo & video gallery — daily cult title winners featured here.',
  NULL,
  FALSE,
  TRUE,
  TRUE,
  10000
)
ON CONFLICT DO NOTHING;
