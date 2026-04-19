-- Migration 207: Add stream_rules column to users table
-- Stores per-creator custom stream rules text (max 2000 chars enforced at API layer)

ALTER TABLE users ADD COLUMN IF NOT EXISTS stream_rules TEXT;

COMMENT ON COLUMN users.stream_rules IS
  'Creator-defined house rules shown to viewers in the live rules modal, below platform-wide rules. Max 2000 chars.';
