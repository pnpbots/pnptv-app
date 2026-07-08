'use strict';

const crypto = require('crypto');
const { query } = require('../config/postgres');
const logger = require('../utils/logger');

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // unambiguous chars

function generateCode() {
  const bytes = crypto.randomBytes(8);
  return Array.from(bytes)
    .map((b) => ALPHABET[b % ALPHABET.length])
    .join('');
}

/**
 * Create a new invite link.
 * @param {object} opts
 * @param {string}  opts.createdBy
 * @param {string}  [opts.note]
 * @param {number}  [opts.maxUses]
 * @param {string}  [opts.expiresAt]
 * @param {boolean} [opts.isLifetime=true]
 * @param {number}  [opts.primeHours=0]  — hours of PRIME to grant on redemption (0 = none)
 * @returns {Promise<object>}
 */
async function createLink({ createdBy, note = null, maxUses = null, expiresAt = null, isLifetime = true, primeHours = 0 } = {}) {
  if (!createdBy) throw new Error('createdBy is required');

  const code = generateCode();
  const { rows } = await query(
    `INSERT INTO invite_links (code, created_by, note, max_uses, expires_at, is_lifetime, prime_hours)
     VALUES ($1, $2, $3, $4, $5::timestamptz, $6, $7)
     RETURNING *`,
    [code, String(createdBy), note, maxUses ?? null, expiresAt ?? null, isLifetime, Math.max(0, Math.floor(Number(primeHours) || 0))],
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
 * Increment click_count for a link (fire-and-forget safe).
 * Called when a user lands on the /invite/:code page.
 * @param {string} code
 */
async function trackClick(code) {
  if (!code) return;
  try {
    await query(
      `UPDATE invite_links SET click_count = click_count + 1 WHERE code = $1`,
      [String(code).toUpperCase()],
    );
  } catch (err) {
    logger.warn('trackClick failed (non-critical)', { code, error: err.message });
  }
}

/**
 * Redeem an invite link for a user.
 *
 * Transactional:
 *   1. Lock the invite_links row.
 *   2. Validate existence, expiry, max_uses.
 *   3. Check the user hasn't already redeemed this code.
 *   4. Grant lifetime pnp-member entitlement (if is_lifetime).
 *   5. Grant timed PRIME entitlement (if prime_hours > 0).
 *   6. Set colombia_badge = true on users.
 *   7. Increment use_count.
 *   8. Insert into invite_link_uses.
 *
 * @param {string} code
 * @param {string} userId
 * @returns {Promise<{ success: true, alreadyHadEntitlement: boolean, alreadyRedeemed: boolean, primeGranted: boolean }>}
 */
async function redeemLink(code, userId) {
  if (!code || !userId) throw new Error('code and userId are required');

  const normalCode = String(code).toUpperCase();
  const uid = String(userId);

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
    if (useRes.rows.length > 0) {
      await client.query('ROLLBACK');
      return { success: true, alreadyRedeemed: true, alreadyHadEntitlement: true, primeGranted: false };
    }

    // 4. Upsert pnp-member entitlement (lifetime) — only if is_lifetime
    // Best-plan-wins: upgrade timed to lifetime; never downgrade an existing lifetime row.
    let alreadyHadEntitlement = false;
    if (link.is_lifetime) {
      const entRes = await client.query(
        `INSERT INTO user_entitlements (user_id, add_on_id, is_lifetime, expires_at, auto_renew)
         VALUES ($1, 'pnp-member', true, NULL, false)
         ON CONFLICT (user_id, add_on_id, creator_id) WHERE creator_id IS NULL
         DO UPDATE SET is_lifetime = true, expires_at = NULL, is_consumed = false, updated_at = NOW()
         RETURNING id, xmax`,
        [uid],
      );
      // xmax=0 → INSERT (new row); xmax>0 → UPDATE (user had a prior row, may have been upgraded)
      alreadyHadEntitlement = entRes.rows.length > 0 && entRes.rows[0].xmax !== '0';
    }

    // 5. Grant timed PRIME if prime_hours > 0
    // Also co-grant pnp-member (matching the system-wide invariant: prime always ships with member).
    let primeGranted = false;
    const primeHours = Number(link.prime_hours) || 0;
    if (primeHours > 0) {
      // Prime — extend if still active, never downgrade lifetime
      await client.query(
        `INSERT INTO user_entitlements (user_id, add_on_id, is_lifetime, expires_at, auto_renew)
         VALUES ($1, 'prime', false, NOW() + ($2 || ' hours')::interval, false)
         ON CONFLICT (user_id, add_on_id, creator_id) WHERE creator_id IS NULL
         DO UPDATE SET
           expires_at = CASE
             WHEN user_entitlements.is_lifetime THEN user_entitlements.expires_at
             WHEN user_entitlements.expires_at IS NOT NULL AND user_entitlements.expires_at > NOW()
               THEN GREATEST(user_entitlements.expires_at, EXCLUDED.expires_at)
             ELSE EXCLUDED.expires_at
           END,
           is_consumed = false, updated_at = NOW()
         WHERE NOT user_entitlements.is_lifetime`,
        [uid, String(primeHours)],
      );
      // pnp-member co-grant: prime always includes base membership
      await client.query(
        `INSERT INTO user_entitlements (user_id, add_on_id, is_lifetime, expires_at, auto_renew)
         VALUES ($1, 'pnp-member', false, NOW() + ($2 || ' hours')::interval, false)
         ON CONFLICT (user_id, add_on_id, creator_id) WHERE creator_id IS NULL
         DO UPDATE SET
           expires_at = CASE
             WHEN user_entitlements.is_lifetime THEN user_entitlements.expires_at
             WHEN user_entitlements.expires_at IS NOT NULL AND user_entitlements.expires_at > NOW()
               THEN GREATEST(user_entitlements.expires_at, EXCLUDED.expires_at)
             ELSE EXCLUDED.expires_at
           END,
           is_consumed = false, updated_at = NOW()
         WHERE NOT user_entitlements.is_lifetime`,
        [uid, String(primeHours)],
      );
      primeGranted = true;
    }

    // 6. Set colombia_badge
    await client.query(
      `UPDATE users SET colombia_badge = true WHERE id = $1`,
      [uid],
    );

    // 7. Increment use_count
    await client.query(
      `UPDATE invite_links SET use_count = use_count + 1 WHERE code = $1`,
      [normalCode],
    );

    // 8. Record redemption
    await client.query(
      `INSERT INTO invite_link_uses (code, user_id) VALUES ($1, $2)`,
      [normalCode, uid],
    );

    await client.query('COMMIT');

    // Sync users.tier + clear entitlement cache so the badge reflects immediately
    try {
      const EntitlementAccessService = require('./entitlementAccessService');
      await EntitlementAccessService.recomputeUserTier(uid);
      await EntitlementAccessService.invalidateCache(uid);
    } catch (tierErr) {
      logger.warn('redeemLink: tier sync failed (non-critical)', { userId: uid, error: tierErr.message });
    }

    // Business notification with full grant detail
    try {
      const { query: pgQuery } = require('../config/postgres');
      const userRow = await pgQuery('SELECT username FROM users WHERE id = $1', [uid]).catch(() => ({ rows: [] }));
      const username = userRow.rows[0]?.username || null;
      const BusinessNotificationService = require('./businessNotificationService');
      await BusinessNotificationService.notifyInviteLinkRedemption({
        userId: uid,
        username,
        code: normalCode,
        isLifetime: !!link.is_lifetime,
        primeGranted,
        primeHours: link.prime_hours || 0,
      });
    } catch (_) { /* non-critical */ }

    if (link.is_lifetime) {
      try {
        const gamificationService = require('./gamificationService');
        await gamificationService.awardBadge(uid, 'parche', null, 'Lifetime invite link redemption');
      } catch (badgeErr) {
        logger.warn('parche badge award failed (non-critical)', { userId: uid, error: badgeErr.message });
      }
    }

    logger.info('Invite link redeemed', { code: normalCode, userId: uid, alreadyHadEntitlement, primeGranted });
    return { success: true, alreadyRedeemed: false, alreadyHadEntitlement, primeGranted };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* best-effort */ }
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { generateCode, createLink, listLinks, getLink, trackClick, redeemLink };
