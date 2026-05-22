-- Founders gamification category + Founding Member badge
-- Backfills all current lifetime100 plan holders

INSERT INTO gamification_categories (slug, name_en, name_es, description_en, description_es, icon, sort_order)
VALUES (
  'founder',
  'Founders',
  'Fundadores',
  'Awarded to Lifetime100 founding members who believed in PNPtv from day one.',
  'Otorgado a los miembros fundadores Lifetime100 que creyeron en PNPtv desde el primer día.',
  '🏅',
  0
)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO gamification_badges (category_id, slug, name_en, name_es, description_en, description_es, icon, level, sort_order)
SELECT
  c.id, 'founder', 'Founding Member', 'Miembro Fundador',
  'One of the first to invest in PNPtv. You made this possible.',
  'Uno de los primeros en apostar por PNPtv. Tú lo hiciste posible.',
  '🏅', 1, 0
FROM gamification_categories c
WHERE c.slug = 'founder'
ON CONFLICT (slug) DO NOTHING;

INSERT INTO user_badges (user_id, badge_id, awarded_at, awarded_by, note)
SELECT u.id, b.id, COALESCE(u.updated_at, u.created_at), NULL, 'Retroactive: Lifetime100 founding member'
FROM users u
JOIN gamification_badges b ON b.slug = 'founder'
WHERE u.plan_id = 'lifetime100'
ON CONFLICT (user_id, badge_id) DO NOTHING;
