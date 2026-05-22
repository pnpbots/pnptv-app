-- Migration 252: "Parche 💎" badge for lifetime invite link redemptions
-- Awarded automatically when a user redeems an is_lifetime=true admin invite link.

INSERT INTO gamification_badges (category_id, slug, name_en, name_es, description_en, description_es, icon, level, sort_order)
SELECT
  c.id, 'parche', 'Parche', 'Parche',
  'Joined the family through a special invitation. Welcome to the Parche.',
  'Llegaste a la familia por una invitación especial. Bienvenido al Parche.',
  '💎', 1, 1
FROM gamification_categories c
WHERE c.slug = 'founder'
ON CONFLICT (slug) DO NOTHING;
