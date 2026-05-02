'use strict';

const { getPool } = require('../config/postgres');

const CURRENT_TERMS_VERSION = process.env.MAIN_STAGE_TERMS_VERSION || '2026-05-01';
const CURRENT_PRIVACY_VERSION = process.env.MAIN_STAGE_PRIVACY_VERSION || '2026-05-01';

let _ensured = false;
let _ensuring = null;

async function ensureTable() {
  if (_ensured) return;
  if (_ensuring) return _ensuring;

  const pool = getPool();
  _ensuring = pool.query(`
    CREATE TABLE IF NOT EXISTS main_stage_consents (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NULL,
      guest_identity TEXT NULL,
      guest_display_name TEXT NULL,
      guest_email TEXT NULL,
      invite_id BIGINT NULL,
      terms_version TEXT NOT NULL,
      privacy_version TEXT NOT NULL,
      age_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
      accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ip TEXT NULL,
      user_agent TEXT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `).then(() =>
    pool.query(`ALTER TABLE main_stage_consents ADD COLUMN IF NOT EXISTS guest_display_name TEXT NULL`)
  ).then(() =>
    pool.query(`ALTER TABLE main_stage_consents ADD COLUMN IF NOT EXISTS guest_email TEXT NULL`)
  ).then(() =>
    pool.query(`CREATE INDEX IF NOT EXISTS idx_main_stage_consents_guest_email ON main_stage_consents (LOWER(guest_email)) WHERE guest_email IS NOT NULL`)
  ).then(() => {
    _ensured = true;
  }).finally(() => {
    _ensuring = null;
  });

  return _ensuring;
}

async function getLatestConsentForUser(userId) {
  await ensureTable();
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT *
       FROM main_stage_consents
      WHERE user_id = $1::text
      ORDER BY accepted_at DESC, id DESC
      LIMIT 1`,
    [String(userId)]
  );
  return rows[0] || null;
}

async function recordUserConsent({ userId, ip, userAgent, ageConfirmed }) {
  await ensureTable();
  const pool = getPool();
  await pool.query(
    `INSERT INTO main_stage_consents
      (user_id, terms_version, privacy_version, age_confirmed, ip, user_agent)
     VALUES ($1::text, $2, $3, $4, $5, $6)`,
    [
      String(userId),
      CURRENT_TERMS_VERSION,
      CURRENT_PRIVACY_VERSION,
      Boolean(ageConfirmed),
      ip || null,
      userAgent || null,
    ]
  );
}

async function recordGuestConsent({ guestIdentity, guestDisplayName, guestEmail, inviteId, ip, userAgent, ageConfirmed }) {
  await ensureTable();
  const pool = getPool();
  await pool.query(
    `INSERT INTO main_stage_consents
      (guest_identity, guest_display_name, guest_email, invite_id, terms_version, privacy_version, age_confirmed, ip, user_agent)
     VALUES ($1::text, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      String(guestIdentity),
      guestDisplayName || null,
      guestEmail ? String(guestEmail).trim().toLowerCase() : null,
      inviteId || null,
      CURRENT_TERMS_VERSION,
      CURRENT_PRIVACY_VERSION,
      Boolean(ageConfirmed),
      ip || null,
      userAgent || null,
    ]
  );
}

function buildJoinCheck(latestConsent) {
  const ageConfirmed = Boolean(latestConsent?.age_confirmed);
  const termsAccepted = latestConsent?.terms_version === CURRENT_TERMS_VERSION;
  const privacyAccepted = latestConsent?.privacy_version === CURRENT_PRIVACY_VERSION;
  return {
    termsVersion: CURRENT_TERMS_VERSION,
    privacyVersion: CURRENT_PRIVACY_VERSION,
    ageConfirmed,
    termsAccepted,
    privacyAccepted,
    requiresAgeVerification: !ageConfirmed,
    requiresTermsAcceptance: !termsAccepted,
    requiresPrivacyAcceptance: !privacyAccepted,
    canJoin: ageConfirmed && termsAccepted && privacyAccepted,
  };
}

module.exports = {
  CURRENT_TERMS_VERSION,
  CURRENT_PRIVACY_VERSION,
  getLatestConsentForUser,
  recordUserConsent,
  recordGuestConsent,
  buildJoinCheck,
};
