'use strict';

const crypto = require('crypto');
const geoip = require('geoip-lite');
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
 * @param {number}  [opts.primeHours=0]
 * @param {string}  [opts.resourceType]
 * @param {string}  [opts.resourceId]
 * @param {number}  [opts.durationHours=72]
 * @param {boolean} [opts.coOnly=false]  — Colombia-only: restrict to CO IPs, defer PRIME
 * @returns {Promise<object>}
 */
async function createLink({ createdBy, note = null, maxUses = null, expiresAt = null, isLifetime = true, primeHours = 0, resourceType = null, resourceId = null, durationHours = 72, badgeSlug = null, coOnly = false } = {}) {
  if (!createdBy) throw new Error('createdBy is required');

  const code = generateCode();
  const { rows } = await query(
    `INSERT INTO invite_links (code, created_by, note, max_uses, expires_at, is_lifetime, prime_hours, resource_type, resource_id, duration_hours, badge_slug, co_only)
     VALUES ($1, $2, $3, $4, $5::timestamptz, $6, $7, $8, $9, $10, $11, $12)
     RETURNING *`,
    [code, String(createdBy), note, maxUses ?? null, expiresAt ?? null, isLifetime, Math.max(0, Math.floor(Number(primeHours) || 0)), resourceType ?? null, resourceId ? String(resourceId) : null, Math.max(1, Math.floor(Number(durationHours) || 72)), badgeSlug ?? null, !!coOnly],
  );
  return rows[0];
}

/**
 * List all invite links, newest first.
 */
async function listLinks() {
  const { rows } = await query(`SELECT * FROM invite_links ORDER BY created_at DESC`, []);
  return rows;
}

/**
 * List invite links created by a specific user (creator-facing).
 */
async function listLinksByCreator(createdBy) {
  const { rows } = await query(
    `SELECT * FROM invite_links WHERE created_by = $1 AND resource_type IS NOT NULL ORDER BY created_at DESC`,
    [String(createdBy)],
  );
  return rows;
}

/**
 * Deactivate an invite link (sets max_uses = use_count to exhaust it).
 */
async function deactivateLink(code, createdBy) {
  const { rowCount } = await query(
    `UPDATE invite_links SET max_uses = use_count WHERE code = $1 AND created_by = $2 AND resource_type IS NOT NULL`,
    [String(code).toUpperCase(), String(createdBy)],
  );
  return rowCount > 0;
}

/**
 * Fetch a single invite link by code.
 */
async function getLink(code) {
  if (!code) return null;
  const { rows } = await query(`SELECT * FROM invite_links WHERE code = $1`, [String(code).toUpperCase()]);
  return rows[0] ?? null;
}

/**
 * Increment click_count for a link (fire-and-forget safe).
 */
async function trackClick(code) {
  if (!code) return;
  try {
    await query(`UPDATE invite_links SET click_count = click_count + 1 WHERE code = $1`, [String(code).toUpperCase()]);
  } catch (err) {
    logger.warn('trackClick failed (non-critical)', { code, error: err.message });
  }
}

/**
 * Check if user meets Colombia socios PRIME requirements (photo + 3 posts).
 * @param {string} userId
 * @returns {Promise<{ hasPhoto: boolean, postCount: number, met: boolean }>}
 */
async function checkColombiaRequirements(userId) {
  const { rows } = await query(
    `SELECT
       u.photo_file_id,
       (SELECT COUNT(*)::int FROM social_posts WHERE user_id = $1::text AND is_deleted = false) AS post_count
     FROM users u WHERE u.id = $1::text`,
    [String(userId)],
  );
  if (!rows[0]) return { hasPhoto: false, postCount: 0, met: false };
  const hasPhoto = !!rows[0].photo_file_id;
  const postCount = rows[0].post_count || 0;
  return { hasPhoto, postCount, met: hasPhoto && postCount >= 3 };
}

// ─── Shared helper for colombia_socios PRIME upsert ───────────────────────────
// Grants PRIME tagged as 'colombia_socios'. The grant_source field is preserved
// if a paid entitlement (source_payment_id / stripe_subscription_id / source_plan_id)
// already exists for this user, so BTCPay/Stripe PRIME is never mis-tagged.
async function _grantColombiaSOCIOSPrime(client, userId, primeHours) {
  await client.query(
    `INSERT INTO user_entitlements (user_id, add_on_id, is_lifetime, expires_at, auto_renew, grant_source)
     VALUES ($1, 'prime', false, NOW() + ($2 || ' hours')::interval, false, 'colombia_socios')
     ON CONFLICT (user_id, add_on_id, creator_id) WHERE creator_id IS NULL
     DO UPDATE SET
       expires_at = CASE
         WHEN user_entitlements.is_lifetime THEN user_entitlements.expires_at
         WHEN user_entitlements.expires_at IS NOT NULL AND user_entitlements.expires_at > NOW()
           THEN GREATEST(user_entitlements.expires_at, EXCLUDED.expires_at)
         ELSE EXCLUDED.expires_at
       END,
       is_consumed = false,
       updated_at = NOW(),
       grant_source = CASE
         WHEN user_entitlements.source_payment_id IS NOT NULL
           OR user_entitlements.stripe_subscription_id IS NOT NULL
           OR user_entitlements.source_plan_id IS NOT NULL
         THEN user_entitlements.grant_source
         ELSE 'colombia_socios'
       END
     WHERE NOT user_entitlements.is_lifetime`,
    [String(userId), String(primeHours)],
  );
}

/**
 * Claim pending Colombia PRIME for a user who now meets requirements.
 * Safe to call multiple times — idempotent via FOR UPDATE lock.
 * @param {string} userId
 * @returns {Promise<{ success: boolean, met: boolean, primeGranted: boolean, requirements?: object, expiresAt?: string }>}
 */
async function claimPendingPrime(userId) {
  const uid = String(userId);

  const { getPool } = require('../config/postgres');
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    // Lock the pending row to prevent double-claim race
    const { rows: pending } = await client.query(
      `SELECT ilu.code, ilu.pending_prime_hours
       FROM invite_link_uses ilu
       JOIN invite_links il ON il.code = ilu.code
       WHERE ilu.user_id = $1 AND il.co_only = true AND ilu.pending_prime_hours IS NOT NULL AND ilu.pending_prime_hours > 0
       ORDER BY ilu.redeemed_at DESC LIMIT 1
       FOR UPDATE`,
      [uid],
    );

    if (!pending[0]) {
      await client.query('ROLLBACK');
      return { success: false, met: false, primeGranted: false, error: 'No pending PRIME found' };
    }

    const { code, pending_prime_hours } = pending[0];
    const reqs = await checkColombiaRequirements(uid);

    if (!reqs.met) {
      await client.query('ROLLBACK');
      return { success: false, met: false, primeGranted: false, requirements: reqs };
    }

    await _grantColombiaSOCIOSPrime(client, uid, pending_prime_hours);

    // Fetch expires_at for the response
    const { rows: entRows } = await client.query(
      `SELECT expires_at FROM user_entitlements WHERE user_id = $1 AND add_on_id = 'prime' AND creator_id IS NULL`,
      [uid],
    );

    // Clear pending flag
    await client.query(
      `UPDATE invite_link_uses SET pending_prime_hours = NULL WHERE code = $1 AND user_id = $2`,
      [code, uid],
    );

    await client.query('COMMIT');

    try {
      const EntitlementAccessService = require('./entitlementAccessService');
      await EntitlementAccessService.recomputeUserTier(uid);
      await EntitlementAccessService.invalidateCache(uid);
    } catch (tierErr) {
      logger.warn('claimPendingPrime: tier sync failed (non-critical)', { userId: uid, error: tierErr.message });
    }

    logger.info('[ColombiaInvite] PRIME claimed', { userId: uid, hours: pending_prime_hours });
    return { success: true, met: true, primeGranted: true, expiresAt: entRows[0]?.expires_at ?? null };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* best-effort */ }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Redeem an invite link for a user.
 *
 * Transactional:
 *   1. Lock row. Validate existence, expiry, max_uses.
 *   2. For co_only links: verify IP is Colombian.
 *   3. Check no duplicate redemption.
 *   4. Grant pnp-member (lifetime). For co_only: also grant pnp-col (lifetime) so user can use the app.
 *   5. For co_only links: store pending_prime_hours instead of granting PRIME immediately.
 *   6. Set colombia_badge = true, increment use_count, record in invite_link_uses.
 *
 * @param {string} code
 * @param {string} userId
 * @param {object} [opts]
 * @param {string} [opts.ip] — caller's IP for Colombia gate check
 */
async function redeemLink(code, userId, { ip = null } = {}) {
  if (!code || !userId) throw new Error('code and userId are required');

  const normalCode = String(code).toUpperCase();
  const uid = String(userId);

  const { getPool } = require('../config/postgres');
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    // 1. Lock row
    const linkRes = await client.query(`SELECT * FROM invite_links WHERE code = $1 FOR UPDATE`, [normalCode]);
    if (linkRes.rows.length === 0) {
      await client.query('ROLLBACK');
      const err = new Error('Este enlace de invitación no existe.');
      err.statusCode = 404;
      throw err;
    }
    const link = linkRes.rows[0];

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

    // 2. Colombia-only gate — reject non-CO IPs
    if (link.co_only) {
      const geo = ip ? geoip.lookup(ip) : null;
      if (geo?.country !== 'CO') {
        await client.query('ROLLBACK');
        const err = new Error('Este enlace solo puede activarse desde Colombia.');
        err.statusCode = 403;
        err.code = 'CO_IP_REQUIRED';
        throw err;
      }
    }

    // 3. Already redeemed?
    const useRes = await client.query(
      `SELECT 1 FROM invite_link_uses WHERE code = $1 AND user_id = $2`,
      [normalCode, uid],
    );
    if (useRes.rows.length > 0) {
      await client.query('ROLLBACK');
      return { success: true, alreadyRedeemed: true, alreadyHadEntitlement: true, primeGranted: false, primePending: false, pendingPrimeHours: 0 };
    }

    let alreadyHadEntitlement = false;
    let primeGranted = false;
    let primePending = false;
    let pendingPrimeHours = 0;
    const resourceType = link.resource_type;
    const resourceId   = link.resource_id;
    const durationHours = Number(link.duration_hours) || 72;

    if (resourceType && resourceId) {
      // Scoped creator/channel grant
      const addOnId = resourceType === 'creator' ? 'creator-subscription' : 'channel-access';
      const entRes = await client.query(
        `INSERT INTO user_entitlements (user_id, add_on_id, is_lifetime, expires_at, creator_id, auto_renew)
         VALUES ($1, $2, false, NOW() + ($3 || ' hours')::interval, $4, false)
         ON CONFLICT (user_id, add_on_id, creator_id)
         DO UPDATE SET
           expires_at = CASE
             WHEN user_entitlements.is_lifetime THEN user_entitlements.expires_at
             WHEN user_entitlements.expires_at IS NOT NULL AND user_entitlements.expires_at > NOW()
               THEN GREATEST(user_entitlements.expires_at, EXCLUDED.expires_at)
             ELSE EXCLUDED.expires_at
           END,
           is_consumed = false, updated_at = NOW()
         WHERE NOT user_entitlements.is_lifetime
         RETURNING id, xmax`,
        [uid, addOnId, String(durationHours), String(resourceId)],
      );
      alreadyHadEntitlement = entRes.rows.length > 0 && entRes.rows[0].xmax !== '0';
    } else {
      // Platform-wide admin link
      if (link.is_lifetime) {
        const entRes = await client.query(
          `INSERT INTO user_entitlements (user_id, add_on_id, is_lifetime, expires_at, auto_renew)
           VALUES ($1, 'pnp-member', true, NULL, false)
           ON CONFLICT (user_id, add_on_id, creator_id) WHERE creator_id IS NULL
           DO UPDATE SET is_lifetime = true, expires_at = NULL, is_consumed = false, updated_at = NOW()
           RETURNING id, xmax`,
          [uid],
        );
        alreadyHadEntitlement = entRes.rows.length > 0 && entRes.rows[0].xmax !== '0';
      }

      const primeHours = Number(link.prime_hours) || 0;
      if (primeHours > 0) {
        if (link.co_only) {
          // Defer PRIME — grant pnp-col now so user can use the app while completing requirements
          await client.query(
            `INSERT INTO user_entitlements (user_id, add_on_id, is_lifetime, expires_at, auto_renew, grant_source)
             VALUES ($1, 'pnp-col', true, NULL, false, 'colombia_socios')
             ON CONFLICT (user_id, add_on_id, creator_id) WHERE creator_id IS NULL
             DO UPDATE SET is_lifetime = true, expires_at = NULL, is_consumed = false, updated_at = NOW()`,
            [uid],
          );
          primePending = true;
          pendingPrimeHours = primeHours;
        } else {
          // Normal immediate PRIME grant
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
      }
    }

    // Set colombia_badge (platform-wide links only)
    if (!resourceType) {
      await client.query(`UPDATE users SET colombia_badge = true WHERE id = $1`, [uid]);
    }

    await client.query(`UPDATE invite_links SET use_count = use_count + 1 WHERE code = $1`, [normalCode]);
    await client.query(
      `INSERT INTO invite_link_uses (code, user_id, pending_prime_hours) VALUES ($1, $2, $3)`,
      [normalCode, uid, primePending ? pendingPrimeHours : null],
    );

    await client.query('COMMIT');

    try {
      const EntitlementAccessService = require('./entitlementAccessService');
      await EntitlementAccessService.recomputeUserTier(uid);
      await EntitlementAccessService.invalidateCache(uid);
    } catch (tierErr) {
      logger.warn('redeemLink: tier sync failed (non-critical)', { userId: uid, error: tierErr.message });
    }

    try {
      const { query: pgQuery } = require('../config/postgres');
      const userRow = await pgQuery('SELECT username FROM users WHERE id = $1', [uid]).catch(() => ({ rows: [] }));
      const username = userRow.rows[0]?.username || null;
      const BusinessNotificationService = require('./businessNotificationService');
      await BusinessNotificationService.notifyInviteLinkRedemption({
        userId: uid, username, code: normalCode, isLifetime: !!link.is_lifetime, primeGranted, primeHours: link.prime_hours || 0,
      });
    } catch (_) { /* non-critical */ }

    if (!resourceType && link.is_lifetime) {
      try {
        const gamificationService = require('./gamificationService');
        await gamificationService.awardBadge(uid, 'parche', null, 'Lifetime invite link redemption');
      } catch (badgeErr) {
        logger.warn('parche badge award failed (non-critical)', { userId: uid, error: badgeErr.message });
      }
    }

    if (link.badge_slug) {
      try {
        const gamificationService = require('./gamificationService');
        await gamificationService.awardBadge(uid, link.badge_slug, null, `Invite link redemption: ${normalCode}`);
      } catch (badgeErr) {
        logger.warn('badge_slug award failed (non-critical)', { userId: uid, badge: link.badge_slug, error: badgeErr.message });
      }
    }

    logger.info('Invite link redeemed', { code: normalCode, userId: uid, alreadyHadEntitlement, primeGranted, primePending });
    return { success: true, alreadyRedeemed: false, alreadyHadEntitlement, primeGranted, primePending, pendingPrimeHours };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* best-effort */ }
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { generateCode, createLink, listLinks, listLinksByCreator, deactivateLink, getLink, trackClick, redeemLink, checkColombiaRequirements, claimPendingPrime };
