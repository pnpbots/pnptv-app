-- 164_add_media_provider_soundcloud.sql
-- Add provider and external_id to media_library to support SoundCloud and other external sources

-- Add provider column if it doesn't exist (default to 'local')
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'media_library' AND column_name = 'provider') THEN
        ALTER TABLE media_library ADD COLUMN provider VARCHAR(50) DEFAULT 'local';
    END IF;
END
$$;

-- Add external_id column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'media_library' AND column_name = 'external_id') THEN
        ALTER TABLE media_library ADD COLUMN external_id VARCHAR(255);
    END IF;
END
$$;

-- Add index for provider/external_id lookups
CREATE INDEX IF NOT EXISTS idx_media_library_provider_external ON media_library(provider, external_id);

-- Update existing records to 'local' provider if they are null
UPDATE media_library SET provider = 'local' WHERE provider IS NULL;
