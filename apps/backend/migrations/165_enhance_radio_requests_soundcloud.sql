-- 165_enhance_radio_requests_soundcloud.sql
-- Enhance radio_requests to support SoundCloud URLs and metadata

-- Add metadata column for storing resolved SoundCloud info
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'radio_requests' AND column_name = 'metadata') THEN
        ALTER TABLE radio_requests ADD COLUMN metadata JSONB;
    END IF;
END
$$;

-- Add url column for the source link
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'radio_requests' AND column_name = 'url') THEN
        ALTER TABLE radio_requests ADD COLUMN url TEXT;
    END IF;
END
$$;
