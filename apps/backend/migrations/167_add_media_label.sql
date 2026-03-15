-- 167_add_media_label.sql
-- Add label column to media_library to support filtering by curator-defined label

-- Add label column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'media_library' AND column_name = 'label') THEN
        ALTER TABLE media_library ADD COLUMN label VARCHAR(50);
    END IF;
END
$$;

-- Add index for label-based filtering
CREATE INDEX IF NOT EXISTS idx_media_library_label ON media_library(label);
