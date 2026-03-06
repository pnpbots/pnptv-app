-- Gamification system: categories, badges, user_badges

CREATE TABLE IF NOT EXISTS gamification_categories (
  id SERIAL PRIMARY KEY,
  slug VARCHAR(50) UNIQUE NOT NULL,
  name_en VARCHAR(100) NOT NULL,
  name_es VARCHAR(100) NOT NULL,
  description_en TEXT,
  description_es TEXT,
  icon VARCHAR(50),
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS gamification_badges (
  id SERIAL PRIMARY KEY,
  category_id INT NOT NULL REFERENCES gamification_categories(id),
  slug VARCHAR(80) UNIQUE NOT NULL,
  name_en VARCHAR(100) NOT NULL,
  name_es VARCHAR(100) NOT NULL,
  description_en TEXT,
  description_es TEXT,
  icon VARCHAR(50),
  level INT DEFAULT 1,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_badges (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL REFERENCES users(id),
  badge_id INT NOT NULL REFERENCES gamification_badges(id),
  awarded_at TIMESTAMPTZ DEFAULT NOW(),
  awarded_by VARCHAR(255) REFERENCES users(id),
  note TEXT,
  UNIQUE(user_id, badge_id)
);

CREATE INDEX idx_user_badges_user ON user_badges(user_id);
CREATE INDEX idx_user_badges_badge ON user_badges(badge_id);
CREATE INDEX idx_gamification_badges_category ON gamification_badges(category_id);

-- Seed categories
INSERT INTO gamification_categories (slug, name_en, name_es, description_en, description_es, icon, sort_order) VALUES
  ('engagement', 'Feature Engagement', 'Engagement en Funciones', 'Badges earned by actively using platform features', 'Insignias ganadas al usar activamente las funciones de la plataforma', 'zap', 1),
  ('wellness', 'Safe & Responsible Use', 'Uso Seguro y Responsable', 'Badges earned by completing safe and responsible use courses', 'Insignias ganadas al completar cursos de uso seguro y responsable', 'heart', 2)
ON CONFLICT (slug) DO NOTHING;

-- Seed Me Cuido badges (wellness category)
INSERT INTO gamification_badges (category_id, slug, name_en, name_es, description_en, description_es, icon, level, sort_order)
SELECT c.id, 'me-cuido-1', 'Me Cuido 1', 'Me Cuido 1', 'Completed Wellness Level 1 - Basic safe practices', 'Completo Bienestar Nivel 1 - Practicas seguras basicas', 'shield', 1, 1
FROM gamification_categories c WHERE c.slug = 'wellness'
ON CONFLICT (slug) DO NOTHING;

INSERT INTO gamification_badges (category_id, slug, name_en, name_es, description_en, description_es, icon, level, sort_order)
SELECT c.id, 'me-cuido-2', 'Me Cuido 2', 'Me Cuido 2', 'Completed Wellness Level 2 - Intermediate wellness', 'Completo Bienestar Nivel 2 - Bienestar intermedio', 'shield-check', 2, 2
FROM gamification_categories c WHERE c.slug = 'wellness'
ON CONFLICT (slug) DO NOTHING;

INSERT INTO gamification_badges (category_id, slug, name_en, name_es, description_en, description_es, icon, level, sort_order)
SELECT c.id, 'me-cuido-3', 'Me Cuido 3', 'Me Cuido 3', 'Completed Wellness Level 3 - Advanced harm reduction', 'Completo Bienestar Nivel 3 - Reduccion de danos avanzada', 'shield-star', 3, 3
FROM gamification_categories c WHERE c.slug = 'wellness'
ON CONFLICT (slug) DO NOTHING;
