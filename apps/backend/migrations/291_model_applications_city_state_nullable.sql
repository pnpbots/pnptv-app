-- city_state was removed from the creator application form (privacy improvement).
-- Drop the NOT NULL constraint so existing rows and new submissions without it are valid.
ALTER TABLE model_applications ALTER COLUMN city_state DROP NOT NULL;
