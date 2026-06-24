-- Consent audit columns: when/where/which version of platform ToS was accepted
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS terms_accepted_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS terms_accepted_ip   VARCHAR(45),
  ADD COLUMN IF NOT EXISTS terms_version       VARCHAR(20);

-- privacy_accepted was never actually written; set to match terms_accepted so existing
-- users who already clicked through the gate are not forced to re-consent.
UPDATE users SET privacy_accepted = TRUE WHERE terms_accepted = TRUE AND privacy_accepted = FALSE;
