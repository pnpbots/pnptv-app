-- Sanitize photo_file_id: NULL out any Telegram file IDs (non-URL values)
-- and add a CHECK constraint to prevent future bad writes.

-- Clean existing data
UPDATE users SET photo_file_id = NULL
WHERE photo_file_id IS NOT NULL
  AND photo_file_id != ''
  AND photo_file_id NOT LIKE '/%'
  AND photo_file_id NOT LIKE 'http%';

-- Add CHECK constraint: photo_file_id must be a web-servable path or URL
ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_photo_file_id_url;
ALTER TABLE users ADD CONSTRAINT chk_photo_file_id_url
  CHECK (photo_file_id IS NULL OR photo_file_id LIKE '/%' OR photo_file_id LIKE 'http%');
