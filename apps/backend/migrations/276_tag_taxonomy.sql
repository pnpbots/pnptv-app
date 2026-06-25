CREATE TABLE IF NOT EXISTS tag_taxonomy (
  id SERIAL PRIMARY KEY,
  name VARCHAR(64) NOT NULL UNIQUE,
  emoji VARCHAR(8),
  group_name VARCHAR(64) NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS users_interests_gin ON users USING GIN(interests);
CREATE INDEX IF NOT EXISTS creator_channels_tags_gin ON creator_channels USING GIN(tags);
CREATE INDEX IF NOT EXISTS channel_videos_tags_gin ON channel_videos USING GIN(tags);
CREATE INDEX IF NOT EXISTS hangout_groups_tags_gin ON hangout_groups USING GIN(tags);

INSERT INTO tag_taxonomy (name, emoji, group_name, sort_order) VALUES
  ('twink',          '🌸', 'body',       1),
  ('bear',           '🐻', 'body',       2),
  ('daddy',          '👨', 'body',       3),
  ('jock',           '💪', 'body',       4),
  ('otter',          '🦦', 'body',       5),
  ('muscle',         '🏋️', 'body',       6),
  ('chub',           '🐷', 'body',       7),
  ('latino',         '🌶️', 'ethnicity',  10),
  ('black',          '✊', 'ethnicity',  11),
  ('asian',          '🌏', 'ethnicity',  12),
  ('white',          '⬜', 'ethnicity',  13),
  ('mixed',          '🌈', 'ethnicity',  14),
  ('clouds',         '☁️', 'scene',      20),
  ('party',          '🎉', 'scene',      21),
  ('sober',          '💧', 'scene',      22),
  ('raw',            '🔥', 'sex',        30),
  ('breeding',       '💦', 'sex',        31),
  ('oral',           '👄', 'sex',        32),
  ('rim',            '🍑', 'sex',        33),
  ('condom',         '🛡️', 'sex',        34),
  ('leather',        '🥋', 'kink',       40),
  ('gear',           '⚙️', 'kink',       41),
  ('bdsm',           '⛓️', 'kink',       42),
  ('bondage',        '🪢', 'kink',       43),
  ('fisting',        '✊', 'kink',       44),
  ('pig-play',       '🐷', 'kink',       45),
  ('watersports',    '💦', 'kink',       46),
  ('golden-shower',  '🚿', 'kink',       47),
  ('foot',           '🦶', 'kink',       48),
  ('spit',           '💧', 'kink',       49),
  ('spanking',       '👋', 'kink',       50),
  ('s&m',            '🔗', 'kink',       51),
  ('sex-slave',      '🔒', 'kink',       52),
  ('voyeur',         '👁️', 'style',      60),
  ('exhibition',     '📸', 'style',      61),
  ('outdoor',        '🌲', 'style',      62),
  ('roleplay',       '🎭', 'style',      63),
  ('public',         '🏙️', 'style',      64),
  ('solo',           '1️⃣', 'cast',       70),
  ('duo',            '2️⃣', 'cast',       71),
  ('group',          '👥', 'cast',       72),
  ('orgy',           '🎊', 'cast',       73),
  ('amateur',        '📱', 'experience', 80),
  ('professional',   '🎬', 'experience', 81)
ON CONFLICT (name) DO NOTHING;
