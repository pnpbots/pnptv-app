'use strict';

/**
 * Main Stage Invite Service
 *
 * Creates, lists, revokes and redeems short-lived guest invite codes.
 * Each code admits an external person (no PNPtv account required) to
 * join Main Stage as a guest participant with publish permissions.
 *
 * Import path for bot/api/controllers: require('../../../services/mainStageInviteService')
 */

const crypto  = require('crypto');
const logger  = require('../utils/logger');
const { getPool } = require('../config/postgres');

// ── Token generation ──────────────────────────────────────────────────────────

/**
 * Generate a URL-safe random code (16 chars, ~96 bits of entropy).
 * Uses base64url so the code is safe in URLs without percent-encoding.
 */
function generateCode() {
  return crypto.randomBytes(12).toString('base64url');
}

/**
 * Build the public shareable URL for a given code.
 * Falls back to pnptv.app if APP_PUBLIC_URL is unset.
 */
function buildInviteUrl(code) {
  const base = (process.env.APP_PUBLIC_URL || 'https://pnptv.app').replace(/\/$/, '');
  return `${base}/main-stage/join/${encodeURIComponent(code)}`;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Create a new invite.
 *
 * @param {object} opts
 * @param {string} opts.creatorUserId   - ID of the admin creating the invite.
 * @param {string} [opts.label]         - Human-readable note (optional, max 200 chars).
 * @param {number|null} [opts.expiresInSeconds=86400] - TTL in seconds. Capped at 7 days. null = permanent.
 * @param {number} [opts.maxUses=1]     - 0 = unlimited.
 * @param {boolean} [opts.permanent]    - Shorthand: no expiry + unlimited uses.
 * @returns {Promise<{id: bigint, code: string, url: string, expiresAt: string|null, maxUses: number}>}
 */
async function createInvite({ creatorUserId, label, expiresInSeconds, maxUses, permanent }) {
  const pool = getPool();

  const isPermanent = permanent === true || expiresInSeconds === null;
  const ttl  = isPermanent ? null : Math.min(Math.max(Number(expiresInSeconds) || 86400, 60), 7 * 24 * 3600);
  const uses = isPermanent ? 0 : (Number.isInteger(Number(maxUses)) && Number(maxUses) >= 0 ? Number(maxUses) : 1);
  const code = generateCode();
  const labelSafe = label ? String(label).slice(0, 200) : null;

  let row;
  if (isPermanent) {
    const { rows } = await pool.query(
      `INSERT INTO main_stage_invites
         (code, created_by, label, expires_at, max_uses, used_count)
       VALUES ($1, $2::text, $3, NULL, $4, 0)
       RETURNING id, code, expires_at, max_uses`,
      [code, String(creatorUserId), labelSafe, uses]
    );
    row = rows[0];
  } else {
    const { rows } = await pool.query(
      `INSERT INTO main_stage_invites
         (code, created_by, label, expires_at, max_uses, used_count)
       VALUES ($1, $2::text, $3, NOW() + ($4 || ' seconds')::interval, $5, 0)
       RETURNING id, code, expires_at, max_uses`,
      [code, String(creatorUserId), labelSafe, String(ttl), uses]
    );
    row = rows[0];
  }

  logger.info('[mainStageInvite] created', { id: row.id, creatorUserId, maxUses: row.max_uses, isPermanent });

  return {
    id:        row.id,
    code:      row.code,
    url:       buildInviteUrl(row.code),
    expiresAt: row.expires_at,
    maxUses:   row.max_uses,
    permanent: isPermanent,
  };
}

/**
 * List all non-revoked invites created by a given admin.
 *
 * @param {object} opts
 * @param {string} opts.creatorUserId
 * @returns {Promise<Array>}
 */
async function listInvites({ creatorUserId }) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id, code, label, expires_at, max_uses, used_count,
            revoked_at, created_at,
            (expires_at IS NOT NULL AND expires_at < NOW() AND revoked_at IS NULL) AS is_expired
     FROM main_stage_invites
     WHERE created_by = $1::text
     ORDER BY created_at DESC
     LIMIT 100`,
    [String(creatorUserId)]
  );

  return rows.map((r) => ({
    id:         r.id,
    code:       r.code,
    url:        buildInviteUrl(r.code),
    label:      r.label,
    expiresAt:  r.expires_at,
    maxUses:    r.max_uses,
    usedCount:  r.used_count,
    isExpired:  r.is_expired,
    isRevoked:  r.revoked_at !== null,
    createdAt:  r.created_at,
    permanent:  r.expires_at === null,
  }));
}

/**
 * Revoke an invite. Only the creator can revoke.
 *
 * @param {object} opts
 * @param {string|number} opts.id
 * @param {string} opts.creatorUserId
 * @returns {Promise<boolean>} true if revoked, false if not found / already revoked
 */
async function revokeInvite({ id, creatorUserId }) {
  const pool = getPool();
  const { rowCount } = await pool.query(
    `UPDATE main_stage_invites
     SET revoked_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND created_by = $2::text AND revoked_at IS NULL`,
    [id, String(creatorUserId)]
  );

  if (rowCount > 0) {
    logger.info('[mainStageInvite] revoked', { id, creatorUserId });
  }
  return rowCount > 0;
}

/**
 * Lightweight preview of an invite — used by the guest landing page to show
 * who invited them and whether the link is still valid, WITHOUT consuming a use.
 *
 * @param {string} code
 * @returns {Promise<{valid: boolean, hostName?: string, expiresAt?: string}>}
 */
async function previewInvite(code) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT msi.expires_at, msi.revoked_at, msi.used_count, msi.max_uses,
            u.first_name, u.username
     FROM main_stage_invites msi
     JOIN users u ON u.id = msi.created_by
     WHERE msi.code = $1
     LIMIT 1`,
    [code]
  );

  if (rows.length === 0) {
    return { valid: false };
  }

  const r = rows[0];
  const isRevoked  = r.revoked_at !== null;
  const isExpired  = r.expires_at !== null && new Date(r.expires_at) < new Date();
  const isExhausted = r.max_uses > 0 && r.used_count >= r.max_uses;

  const valid = !isRevoked && !isExpired && !isExhausted;
  const hostName = r.first_name || r.username || null;

  return { valid, hostName, expiresAt: r.expires_at, permanent: r.expires_at === null };
}

/**
 * Atomically validate and redeem an invite.
 * Logs every attempt (success or failure) to the audit table.
 *
 * @param {object} opts
 * @param {string} opts.code
 * @param {string} opts.displayName    - Guest-supplied display name (pre-validated by caller).
 * @param {string} [opts.fingerprint]  - SHA-256 hash of IP+UA for abuse tracing.
 * @returns {Promise<{success: true, inviteId: bigint} | {success: false, errorCode: string}>}
 */
async function redeemInvite({ code, displayName, fingerprint }) {
  const pool   = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Lock the row so concurrent redemptions don't race through the used_count check.
    const { rows } = await client.query(
      `SELECT id, expires_at, revoked_at, used_count, max_uses
       FROM main_stage_invites
       WHERE code = $1
       FOR UPDATE`,
      [code]
    );

    if (rows.length === 0) {
      await client.query('ROLLBACK');
      await _logUse(pool, null, displayName, fingerprint, null, 'INVITE_NOT_FOUND');
      return { success: false, errorCode: 'INVITE_NOT_FOUND' };
    }

    const r = rows[0];

    if (r.revoked_at !== null) {
      await client.query('ROLLBACK');
      await _logUse(pool, r.id, displayName, fingerprint, null, 'INVITE_REVOKED');
      return { success: false, errorCode: 'INVITE_REVOKED' };
    }

    if (r.expires_at !== null && new Date(r.expires_at) < new Date()) {
      await client.query('ROLLBACK');
      await _logUse(pool, r.id, displayName, fingerprint, null, 'INVITE_EXPIRED');
      return { success: false, errorCode: 'INVITE_EXPIRED' };
    }

    if (r.max_uses > 0 && r.used_count >= r.max_uses) {
      await client.query('ROLLBACK');
      await _logUse(pool, r.id, displayName, fingerprint, null, 'INVITE_EXHAUSTED');
      return { success: false, errorCode: 'INVITE_EXHAUSTED' };
    }

    // Generate a stable guest identity for this session.
    const lkIdentity = `guest_${crypto.randomBytes(6).toString('base64url')}`;

    await client.query(
      `UPDATE main_stage_invites
       SET used_count = used_count + 1, updated_at = NOW()
       WHERE id = $1`,
      [r.id]
    );

    await client.query('COMMIT');

    // Audit log after successful commit so the log row is always consistent.
    await _logUse(pool, r.id, displayName, fingerprint, lkIdentity, null);

    logger.info('[mainStageInvite] redeemed', {
      inviteId: r.id,
      lkIdentity,
      usedCount: r.used_count + 1,
    });

    return { success: true, inviteId: r.id, lkIdentity };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error('[mainStageInvite] redeemInvite error', { error: err.message });
    throw err;
  } finally {
    client.release();
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

async function _logUse(pool, inviteId, displayName, fingerprintHash, lkIdentity, errorCode) {
  try {
    await pool.query(
      `INSERT INTO main_stage_invite_uses
         (invite_id, display_name, fingerprint_hash, lk_identity, error_code)
       VALUES ($1, $2, $3, $4, $5)`,
      [inviteId || null, displayName, fingerprintHash || null, lkIdentity || null, errorCode || null]
    );
  } catch (e) {
    // Never let audit-logging failures propagate to the caller.
    logger.warn('[mainStageInvite] audit log failed', { error: e.message });
  }
}

module.exports = {
  createInvite,
  listInvites,
  revokeInvite,
  previewInvite,
  redeemInvite,
  buildInviteUrl,
};
