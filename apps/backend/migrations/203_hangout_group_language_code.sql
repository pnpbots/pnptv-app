-- Add language_code to hangout_groups to support auto-join by user language.
-- NULL means the group is not a language-specific group.
-- Supported values: 'en', 'es' (only those two are auto-joined; others are ignored).
-- Admins must manually set this column on existing or new groups via the admin UI or SQL:
--   UPDATE hangout_groups SET language_code = 'en' WHERE id = <en_group_id>;
--   UPDATE hangout_groups SET language_code = 'es' WHERE id = <es_group_id>;

ALTER TABLE hangout_groups
  ADD COLUMN IF NOT EXISTS language_code TEXT;

CREATE INDEX IF NOT EXISTS idx_hangout_groups_language_code
  ON hangout_groups (language_code)
  WHERE language_code IS NOT NULL;
