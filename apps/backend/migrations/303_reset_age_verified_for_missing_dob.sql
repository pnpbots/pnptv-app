-- Migration 303: Reset age_verified for users without a date_of_birth
--
-- Context: The age verification gate previously accepted a checkbox with no
-- DOB collection. It has been updated to require actual date-of-birth input.
-- Users who slipped through the old gate without providing their DOB must be
-- reset to age_verified = false so they encounter the updated gate on next
-- login and are required to supply their birthday.
--
-- Users who completed the new onboarding (which always collects DOB) are
-- unaffected because they already have date_of_birth set.
--
-- Scope: active non-admin users only; no column additions or drops.
--
-- Down: there is no safe automatic rollback — the set of affected users would
-- need to be captured before the update. Manually re-verify individuals via
-- the admin panel if a rollback is ever required.

UPDATE users
SET
  age_verified     = false,
  age_verified_at  = NULL
WHERE
  date_of_birth IS NULL
  AND role NOT IN ('admin', 'superadmin')
  AND is_active = true;
