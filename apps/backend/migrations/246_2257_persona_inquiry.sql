ALTER TABLE creator_2257_records
  ADD COLUMN IF NOT EXISTS persona_inquiry_id TEXT,
  ADD COLUMN IF NOT EXISTS persona_status TEXT;

CREATE INDEX IF NOT EXISTS idx_2257_persona_inquiry_id
  ON creator_2257_records(persona_inquiry_id)
  WHERE persona_inquiry_id IS NOT NULL;
