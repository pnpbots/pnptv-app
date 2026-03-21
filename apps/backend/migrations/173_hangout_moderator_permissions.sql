-- ============================================================================
-- 173: Hangout Moderator Permissions
-- ============================================================================
-- Defines what moderators can do per-group. Owners have all permissions
-- implicitly. Each row = one group's moderator permission config.
-- If no row exists for a group, moderators get default permissions.
-- ============================================================================

CREATE TABLE IF NOT EXISTS hangout_moderator_permissions (
  group_id          INTEGER PRIMARY KEY REFERENCES hangout_groups(id) ON DELETE CASCADE,

  -- Member management
  can_kick          BOOLEAN NOT NULL DEFAULT true,
  can_ban           BOOLEAN NOT NULL DEFAULT true,
  can_mute          BOOLEAN NOT NULL DEFAULT true,
  can_unban         BOOLEAN NOT NULL DEFAULT true,

  -- Content management
  can_pin           BOOLEAN NOT NULL DEFAULT true,
  can_delete_msgs   BOOLEAN NOT NULL DEFAULT true,

  -- Group settings (owners-only by default)
  can_edit_info     BOOLEAN NOT NULL DEFAULT false,   -- name, description, tags
  can_change_settings BOOLEAN NOT NULL DEFAULT false, -- slow mode, read-only, allow media, etc.
  can_invite        BOOLEAN NOT NULL DEFAULT true,

  updated_at        TIMESTAMPTZ DEFAULT now()
);

-- Seed default permissions for all existing groups
INSERT INTO hangout_moderator_permissions (group_id)
SELECT id FROM hangout_groups
ON CONFLICT DO NOTHING;

-- Add trigger for updated_at
CREATE OR REPLACE FUNCTION fn_set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_mod_perms_updated_at'
  ) THEN
    CREATE TRIGGER trg_mod_perms_updated_at
      BEFORE UPDATE ON hangout_moderator_permissions
      FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
  END IF;
END $$;
