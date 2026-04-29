-- Migration 238: Wellness Break Mode.
--
-- Self-imposed access restriction for users in recovery, during cravings,
-- or just taking a sober break. When active, only wellness hangouts +
-- educational material + Cristina + account settings are accessible. The
-- entitlement guard enforces this server-side; the frontend blurs the
-- rest as a UX layer on top.
--
-- Two columns:
--   users.wellness_mode_until — when wellness mode expires. NULL = off.
--     'infinity' represents "indefinite" (until user disables).
--   users.wellness_mode_disable_requested_at — set when user clicks
--     disable. After 24h passes, an actual disable can succeed. Lets the
--     user back out of an impulsive disable during a craving.
--   hangout_groups.is_wellness — whether this hangout is in the wellness
--     allowlist. Wellness-mode users see only is_wellness=true hangouts.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS wellness_mode_until TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS wellness_mode_disable_requested_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_users_wellness_mode_active
  ON users (wellness_mode_until) WHERE wellness_mode_until IS NOT NULL;

ALTER TABLE hangout_groups
  ADD COLUMN IF NOT EXISTS is_wellness BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_hangout_groups_is_wellness
  ON hangout_groups (is_wellness) WHERE is_wellness = true;

-- Seed: create one English + one Spanish wellness hangout if none exists.
-- A real moderator should later seed messages and nominate sponsors.
INSERT INTO hangout_groups (name, description, is_public, is_paid, is_main, is_wellness, creator_id, created_at, updated_at)
SELECT 'Wellness Break',
       'A judgment-free space for community members in recovery, taking a sober break, or considering one. Open to everyone — share what you need, ask for support, or just hang quietly. Sponsors welcome. House rules: no use talk that could trigger others, no sourcing, no sharing what someone said outside this room.',
       true, false, false, true,
       (SELECT id FROM users WHERE role = 'superadmin' ORDER BY created_at LIMIT 1),
       NOW(), NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM hangout_groups WHERE is_wellness = true AND LOWER(name) LIKE '%wellness%'
);

INSERT INTO hangout_groups (name, description, is_public, is_paid, is_main, is_wellness, creator_id, created_at, updated_at)
SELECT 'Descanso de Bienestar',
       'Un espacio sin juicios para miembros de la comunidad en recuperacion, tomando un descanso sober o considerandolo. Abierto para todos — comparte lo que necesites, pide apoyo, o solo acompana en silencio. Sponsors bienvenidos. Reglas de la casa: no hablar de uso de forma que pueda triggerear a otros, no sourcing, no compartir lo que alguien diga fuera de esta sala.',
       true, false, false, true,
       (SELECT id FROM users WHERE role = 'superadmin' ORDER BY created_at LIMIT 1),
       NOW(), NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM hangout_groups WHERE is_wellness = true AND LOWER(name) LIKE '%descanso%'
);
