-- 080: Add is_featured column to performers table
ALTER TABLE performers ADD COLUMN IF NOT EXISTS is_featured BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_performers_featured ON performers(is_featured) WHERE is_featured = TRUE;

-- Mark all active performers as featured initially
UPDATE performers SET is_featured = TRUE WHERE status = 'active';
