-- Migration 288: Add id_selfie_path to creator_2257_records
-- Creators must now submit two photos: their ID document AND a selfie holding it.

ALTER TABLE creator_2257_records
  ADD COLUMN IF NOT EXISTS id_selfie_path TEXT;

-- Flag all existing pending records as needing resubmission with the new selfie requirement
UPDATE creator_2257_records
  SET admin_notes = COALESCE(admin_notes || ' | ', '') || 'Selfie with ID required — please resubmit with both photos'
WHERE verification_status = 'pending'
  AND id_selfie_path IS NULL;
