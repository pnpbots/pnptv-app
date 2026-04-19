-- Migration 210: Add thumb_path, title, description to stream_recordings
ALTER TABLE stream_recordings
  ADD COLUMN IF NOT EXISTS thumb_path   TEXT,
  ADD COLUMN IF NOT EXISTS title        TEXT,
  ADD COLUMN IF NOT EXISTS description  TEXT;
