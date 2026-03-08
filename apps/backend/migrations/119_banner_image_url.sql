-- Migration 119: Add banner_image_url to stream_overlays
-- Allows image-based banners from the CMS overlay asset library (PNG/GIF).

ALTER TABLE stream_overlays
  ADD COLUMN IF NOT EXISTS banner_image_url TEXT;

COMMENT ON COLUMN stream_overlays.banner_image_url IS
  'URL of an image banner from the CMS overlay library. When set, rendered as an image instead of text.';
