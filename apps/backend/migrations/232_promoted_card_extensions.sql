-- Add second-CTA fields to social_posts so a single promoted card can carry
-- two clickable destinations (e.g. Main Stage + Hangouts).
ALTER TABLE social_posts
  ADD COLUMN IF NOT EXISTS promoted_link2       TEXT,
  ADD COLUMN IF NOT EXISTS promoted_link2_label TEXT;
