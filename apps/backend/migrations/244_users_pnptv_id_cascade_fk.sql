-- Migration 244: cascade pnptv_id renames through child FKs
--
-- Reason: when an existing user logs in via OIDC for the first time
-- (or after Authentik re-provisioning) the callback in
-- apps/backend/bot/api/routes.js does
--     UPDATE users SET pnptv_id = $newSub WHERE id = $localId
-- to relink the local account to the Authentik identity. Two child
-- tables FK to users(pnptv_id) with ON UPDATE NO ACTION, so the
-- relink leaves their rows orphaned and Postgres throws 23503
-- (`update or delete on table "users" violates foreign key constraint`)
-- at COMMIT — bouncing the user out of every OIDC login attempt.
--
-- courtesy_invites already does ON UPDATE CASCADE; this migration
-- gives the other two the same behaviour so a pnptv_id rename
-- cascades cleanly.
--
-- Affected users: anyone in the 87-account 2026-04-30 bulk-provision
-- batch whose old pnptv_id is still referenced by streamer_settings or
-- courtesy_invite_redemptions (e.g. SantinoFurioso hit this 2026-05-01).

BEGIN;

ALTER TABLE streamer_settings
  DROP CONSTRAINT streamer_settings_user_id_fkey;

ALTER TABLE streamer_settings
  ADD CONSTRAINT streamer_settings_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(pnptv_id)
  ON UPDATE CASCADE
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE courtesy_invite_redemptions
  DROP CONSTRAINT courtesy_invite_redemptions_redeemed_by_fkey;

ALTER TABLE courtesy_invite_redemptions
  ADD CONSTRAINT courtesy_invite_redemptions_redeemed_by_fkey
  FOREIGN KEY (redeemed_by) REFERENCES users(pnptv_id)
  ON UPDATE CASCADE
  ON DELETE CASCADE;

COMMIT;
