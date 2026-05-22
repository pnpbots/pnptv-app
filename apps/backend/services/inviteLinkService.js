'use strict';

const crypto = require('crypto');
const { query } = require('../config/postgres');
const logger = require('../utils/logger');

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // unambiguous chars

/**
 * Generate an 8-character random alphanumeric code (uppercase, no I/O/0/1).
 * @returns {string}
 */
function generateCode() {
  const bytes = crypto.randomBytes(8);
  return Array.from(bytes)
    .map((b) => ALPHABET[b % ALPHABET.length])
    .join('');
}

/**
 * Create a new invite link.
 *
 * @param {object} opts
 * @param {string} opts.createdBy  - admin user ID
 * @param {string} [opts.note]
 * @param {number} [opts.maxUses]  - null = unlimited
 * @param {string} [opts.expiresAt] - ISO string or null
 * @returns {Promise<object>}      - full invite_links row
 */
async function createLink({ createdBy, note = null, maxUses = null, expiresAt = null, isLifetime = true } = {}) {
  if (!createdBy) throw new Error('createdBy is required');

  const code = generateCode();
  const { rows } = await query(
    `INSERT INTO invite_links (code, created_by, note, max_uses, expires_at, is_lifetime)
     VALUES ($1, $2, $3, $4, $5::timestamptz, $6)
     RETURNING *`,
    [code, String(createdBy), note, maxUses ?? null, expiresAt ?? null, isLifetime],
  );
  return rows[0];
}

/**
 * List all invite links, newest first.
 * @returns {Promise<object[]>}
 */
async function listLinks() {
  const { rows } = await query(
    `SELECT * FROM invite_links ORDER BY created_at DESC`,
    [],
  );
  return rows;
}

/**
 * Fetch a single invite link by code.
 * @param {string} code
 * @returns {Promise<object|null>}
 */
async function getLink(code) {
  if (!code) return null;
  const { rows } = await query(
    `SELECT * FROM invite_links WHERE code = $1`,
    [String(code).toUpperCase()],
  );
  return rows[0] ?? null;
}

/**
 * Redeem an invite link for a user.
 *
 * Transactional:
 *   1. Lock the invite_links row.
 *   2. Validate existence, expiry, max_uses.
 *   3. Check the user hasn't already redeemed this code.
 *   4. Grant lifetime pnp-member entitlement (upsert — safe to call even if user already has it).
 *   5. Set colombia_badge = true on users.
 *   6. Increment use_count.
 *   7. Insert into invite_link_uses.
 *
 * @param {string} code
 * @param {string} userId   - users.id
 * @returns {Promise<{ success: true, alreadyHadEntitlement: boolean, alreadyRedeemed: boolean }>}
 * @throws {Error} with a user-facing .message on validation failure
 */
async function redeemLink(code, userId) {
  if (!code || !userId) throw new Error('code and userId are required');

  const normalCode = String(code).toUpperCase();
  const uid = String(userId);

  // Open a transaction via multiple statements within a single client session.
  // query() does not expose a client, so we get one from the pool directly.
  const { getPool } = require('../config/postgres');
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    // 1. Lock row
    const linkRes = await client.query(
      `SELECT * FROM invite_links WHERE code = $1 FOR UPDATE`,
      [normalCode],
    );
    if (linkRes.rows.length === 0) {
      await client.query('ROLLBACK');
      const err = new Error('Este enlace de invitación no existe.');
      err.statusCode = 404;
      throw err;
    }
    const link = linkRes.rows[0];

    // 2. Validate
    if (link.expires_at && new Date(link.expires_at) < new Date()) {
      await client.query('ROLLBACK');
      const err = new Error('Este enlace de invitación ha expirado.');
      err.statusCode = 410;
      throw err;
    }
    if (link.max_uses !== null && link.use_count >= link.max_uses) {
      await client.query('ROLLBACK');
      const err = new Error('Este enlace de invitación ya no tiene usos disponibles.');
      err.statusCode = 410;
      throw err;
    }

    // 3. Already redeemed?
    const useRes = await client.query(
      `SELECT 1 FROM invite_link_uses WHERE code = $1 AND user_id = $2`,
      [normalCode, uid],
    );
    const alreadyRedeemed = useRes.rows.length > 0;
    if (alreadyRedeemed) {
      await client.query('ROLLBACK');
      return { success: true, alreadyRedeemed: true, alreadyHadEntitlement: true };
    }

    // 4. Upsert pnp-member entitlement (lifetime)
    //    ON CONFLICT on the unique index (user_id, add_on_id, creator_id NULLS NOT DISTINCT).
    //    The trigger blocks update on existing lifetime rows, so we must not overwrite them —
    //    we skip the update when the row is already lifetime (DO NOTHING).
    const entRes = await client.query(
      `INSERT INTO user_entitlements (user_id, add_on_id, is_lifetime, expires_at, auto_renew)
       VALUES ($1, 'pnp-member', true, NULL, false)
       ON CONFLICT (user_id, add_on_id, creator_id) WHERE creator_id IS NULL
       DO NOTHING
       RETURNING id`,
      [uid],
    );
    const alreadyHadEntitlement = entRes.rows.length === 0;

    // 5. Set colombia_badge
    await client.query(
      `UPDATE users SET colombia_badge = true WHERE id = $1`,
      [uid],
    );

    // 6. Increment use_count
    await client.query(
      `UPDATE invite_links SET use_count = use_count + 1 WHERE code = $1`,
      [normalCode],
    );

    // 7. Record redemption
    await client.query(
      `INSERT INTO invite_link_uses (code, user_id) VALUES ($1, $2)`,
      [normalCode, uid],
    );

    await client.query('COMMIT');

    if (link.is_lifetime) {
      try {
        const gamificationService = require('./gamificationService');
        await gamificationService.awardBadge(uid, 'parche', null, 'Lifetime invite link redemption');
      } catch (badgeErr) {
        logger.warn('parche badge award failed (non-critical)', { userId: uid, error: badgeErr.message });
      }
    }

    logger.info('Invite link redeemed', { code: normalCode, userId: uid, alreadyHadEntitlement });
    return { success: true, alreadyRedeemed: false, alreadyHadEntitlement };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* best-effort */ }
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { generateCode, createLink, listLinks, getLink, redeemLink };
