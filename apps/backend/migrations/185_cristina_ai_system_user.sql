-- Create the Cristina AI system user for social feed posts
-- Reassign existing SYSTEM social_posts to cristina-ai
-- This user is the in-app personality for PNPTelevision X campaigns

INSERT INTO users (id, username, first_name, photo_file_id, created_at)
VALUES ('cristina-ai', 'cristina', 'Cristina AI', '🧜‍♀️', NOW())
ON CONFLICT (id) DO UPDATE SET
  username = EXCLUDED.username,
  first_name = EXCLUDED.first_name,
  photo_file_id = EXCLUDED.photo_file_id,
  updated_at = NOW();

-- Reassign all existing SYSTEM social_posts to cristina-ai
UPDATE social_posts SET user_id = 'cristina-ai' WHERE user_id = 'SYSTEM';
