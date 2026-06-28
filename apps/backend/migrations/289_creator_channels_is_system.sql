-- Migration 289: mark admin-managed channels so they are hidden from Creator Studio
-- Only admins may edit system channels; creators see them in the public browse view
-- but cannot edit/delete/upload to them via creator endpoints.

ALTER TABLE creator_channels
  ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT FALSE;

-- The PNPtv! PRIME channel is admin-managed and must not appear in any creator's
-- own-channels list.
UPDATE creator_channels SET is_system = TRUE WHERE id = 5;
