-- Add date_of_birth to users table for marketing/planning data collection
ALTER TABLE users ADD COLUMN IF NOT EXISTS date_of_birth DATE;
-- Add showDob to privacy JSONB default
UPDATE users SET privacy = jsonb_set(COALESCE(privacy, '{}'::jsonb), '{showDob}', 'true') WHERE privacy->>'showDob' IS NULL;
-- Index for age-based queries
CREATE INDEX IF NOT EXISTS idx_users_date_of_birth ON users (date_of_birth) WHERE date_of_birth IS NOT NULL;
