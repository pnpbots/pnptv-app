ALTER TABLE meru_payment_links
  ADD COLUMN IF NOT EXISTS reserved_until TIMESTAMP,
  ADD COLUMN IF NOT EXISTS reserved_for_email VARCHAR(255),
  ADD COLUMN IF NOT EXISTS reserved_for_user_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS reserved_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_meru_links_reservation
  ON meru_payment_links (product, status, reserved_until);

CREATE INDEX IF NOT EXISTS idx_meru_links_reserved_email
  ON meru_payment_links (LOWER(reserved_for_email))
  WHERE reserved_for_email IS NOT NULL;
