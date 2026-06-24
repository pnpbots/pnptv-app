-- Timestamp when the user acknowledged the live rules (was missing — only user_id + version stored)
ALTER TABLE live_rules_acknowledgments
  ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ DEFAULT NOW();

-- Back-fill existing rows with a sentinel so they are not null
UPDATE live_rules_acknowledgments SET acknowledged_at = NOW() WHERE acknowledged_at IS NULL;
