'use strict';

const { query } = require('../config/postgres');
const { getRedis } = require('../config/redis');
const logger = require('../utils/logger');

// Cache TTL: 2 minutes for entitlement checks
const ENTITLEMENT_CACHE_TTL = 120;

class EntitlementAccessService {

  /**
   * Check if user has a specific active entitlement.
   * Uses Redis cache to avoid DB hits on every request.
   *
   * @param {string|number} userId
   * @param {string} addOnId - e.g. 'prime', 'pnp-member', 'creator-subscription', 'private-calls'
   * @param {Object} [opts]
   * @param {string|null} [opts.creatorId] - required for creator-subscription checks
   * @returns {Promise<boolean>}
   */
  static async hasEntitlement(userId, addOnId, { creatorId = null } = {}) {
    if (!userId || !addOnId) return false;
    try {
      const redis = getRedis();
      const cacheKey = `ent:${userId}:${addOnId}${creatorId ? `:${creatorId}` : ''}`;
      const cached = await redis.get(cacheKey);
      if (cached !== null) return cached === '1';

      const { rows } = await query(`
        SELECT 1 FROM user_entitlements
        WHERE user_id = $1
          AND add_on_id = $2
          AND ($3::text IS NULL OR creator_id = $3)
          AND is_consumed = false
          AND (is_lifetime = true OR (expires_at IS NOT NULL AND expires_at > NOW()))
        LIMIT 1
      `, [String(userId), addOnId, creatorId ?? null]);

      const has = rows.length > 0;
      await redis.set(cacheKey, has ? '1' : '0', 'EX', ENTITLEMENT_CACHE_TTL);
      return has;
    } catch (err) {
      logger.error('EntitlementAccessService.hasEntitlement failed', { userId, addOnId, error: err.message });
      return false;
    }
  }

  /**
   * Get ALL active entitlements for a user. Returns array of entitlement objects.
   *
   * @param {string|number} userId
   * @returns {Promise<Array>}
   */
  static async getUserEntitlements(userId) {
    if (!userId) return [];
    try {
      const { rows } = await query(`
        SELECT ue.*, a.name AS add_on_name, a.add_on_type
        FROM user_entitlements ue
        JOIN add_ons a ON a.id = ue.add_on_id
        WHERE ue.user_id = $1
          AND ue.is_consumed = false
          AND (ue.is_lifetime = true OR (ue.expires_at IS NOT NULL AND ue.expires_at > NOW()))
        ORDER BY ue.add_on_id
      `, [String(userId)]);
      return rows;
    } catch (err) {
      logger.error('EntitlementAccessService.getUserEntitlements failed', { userId, error: err.message });
      return [];
    }
  }

  /**
   * Compute display label from active entitlements: PRIME / BASIC / FREE
   *
   * Rules:
   *   Has 'prime' entitlement      → PRIME  (marketing badge)
   *   Has 'pnp-member' only        → BASIC
   *   Has nothing active            → FREE
   *
   * This replaces the old users.tier for display and access-gating purposes.
   *
   * @param {string|number} userId
   * @returns {Promise<'PRIME'|'BASIC'|'FREE'>}
   */
  static async getUserLabel(userId) {
    if (!userId) return 'FREE';
    try {
      const redis = getRedis();
      const cacheKey = `user_label:${userId}`;
      const cached = await redis.get(cacheKey);
      if (cached) return cached;

      const hasPrime = await this.hasEntitlement(userId, 'prime');
      if (hasPrime) {
        await redis.set(cacheKey, 'PRIME', 'EX', ENTITLEMENT_CACHE_TTL);
        return 'PRIME';
      }

      const hasMember = await this.hasEntitlement(userId, 'pnp-member');
      if (hasMember) {
        await redis.set(cacheKey, 'BASIC', 'EX', ENTITLEMENT_CACHE_TTL);
        return 'BASIC';
      }

      await redis.set(cacheKey, 'FREE', 'EX', ENTITLEMENT_CACHE_TTL);
      return 'FREE';
    } catch (err) {
      logger.error('EntitlementAccessService.getUserLabel failed', { userId, error: err.message });
      return 'FREE';
    }
  }

  /**
   * Invalidate all entitlement caches for a user.
   * Must be called after granting or revoking entitlements.
   *
   * @param {string|number} userId
   * @returns {Promise<void>}
   */
  static async invalidateCache(userId) {
    if (!userId) return;
    try {
      const redis = getRedis();
      // Use SCAN instead of KEYS to avoid blocking Redis (O(N) scan)
      const entKeys = [];
      let cursor = '0';
      do {
        const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', `ent:${userId}:*`, 'COUNT', 100);
        cursor = nextCursor;
        entKeys.push(...keys);
      } while (cursor !== '0');
      const extraKeys = [`user_label:${userId}`, `tier_check:${userId}`];
      const allKeys = [...entKeys, ...extraKeys];
      if (allKeys.length > 0) {
        await redis.del(...allKeys);
      }
      logger.debug('EntitlementAccessService.invalidateCache: cleared keys', { userId, count: allKeys.length });
    } catch (err) {
      logger.error('EntitlementAccessService.invalidateCache failed', { userId, error: err.message });
    }
  }

  /**
   * Check if a user is platform-banned.
   * Separate from entitlements — bans are stored on users.tier = 'banned'.
   *
   * @param {string|number} userId
   * @returns {Promise<boolean>}
   */
  static async isBanned(userId) {
    if (!userId) return false;
    try {
      const { rows } = await query(
        `SELECT 1 FROM users WHERE id = $1 AND tier = 'banned' LIMIT 1`,
        [String(userId)]
      );
      return rows.length > 0;
    } catch (err) {
      logger.error('EntitlementAccessService.isBanned failed', { userId, error: err.message });
      return false;
    }
  }

  /**
   * Derive the backward-compatible display tier string from a user label.
   * Used to keep users.tier in sync for admin views after entitlements change.
   *
   * PRIME → 'PRIME'
   * BASIC → 'member'
   * FREE  → 'free'
   *
   * @param {'PRIME'|'BASIC'|'FREE'} label
   * @returns {'PRIME'|'member'|'free'}
   */
  static labelToDisplayTier(label) {
    if (label === 'PRIME') return 'PRIME';
    if (label === 'BASIC') return 'member';
    return 'free';
  }

  /**
   * Express middleware factory: require a specific active entitlement to access a route.
   * This is the canonical replacement for the old requireTier() middleware.
   *
   * Behavior:
   *   - 401 if not authenticated
   *   - Admins (role = 'admin' | 'superadmin') always bypass
   *   - 403 with structured error if banned
   *   - 403 with upgrade URL if entitlement is missing
   *   - next() if the user holds the required entitlement
   *
   * Usage:
   *   app.get('/route', EntitlementAccessService.requireEntitlement('pnp-member'), handler)
   *   app.get('/prime', EntitlementAccessService.requireEntitlement('prime'), handler)
   *
   * @param {string} addOnId - The add-on ID to require (e.g. 'prime', 'pnp-member')
   * @returns {import('express').RequestHandler}
   */
  static requireEntitlement(addOnId) {
    return async (req, res, next) => {
      const user = req.session?.user;
      if (!user?.id) {
        return res.status(401).json({ success: false, error: 'Authentication required' });
      }

      // Admins bypass all entitlement gates
      const role = (user.role || '').toLowerCase();
      if (role === 'admin' || role === 'superadmin') return next();

      // Check ban status before anything else
      const banned = await EntitlementAccessService.isBanned(user.id);
      if (banned) {
        return res.status(403).json({ success: false, error: 'Account suspended', code: 'ACCOUNT_SUSPENDED' });
      }

      const has = await EntitlementAccessService.hasEntitlement(user.id, addOnId);
      if (!has) {
        const isPrimeGate = addOnId === 'prime';
        const label = isPrimeGate ? 'PRIME' : 'BASIC';
        const code = isPrimeGate ? 'PRIME_REQUIRED' : 'MEMBER_REQUIRED';
        return res.status(403).json({
          success: false,
          error: `${label} subscription required`,
          code,
          upgradeUrl: '/subscribe',
        });
      }

      return next();
    };
  }
}

module.exports = EntitlementAccessService;
