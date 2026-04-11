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

  // ───────────────────────────────────────────────────────────────────────
  // Scoped (per-resource) access
  //
  // hasResourceAccess(userId, kind, resourceId) is the single entry point for
  // deciding whether a user can use a specific channel, hangout, or creator.
  // Scoped access is standalone: a user with channel-access:X keeps access to
  // channel X for the full paid period regardless of pnp-member state.
  //
  // Resolution ladder (fail-open on first match):
  //   1. banned → deny
  //   2. admin → allow
  //   3. direct scope match (channel-access:id, hangout-access:id, creator-subscription:id)
  //   4. global prime → allow (prime unlocks everything)
  //   5. kind/access_type specific rules (free / prime / subscription / paid)
  //   6. otherwise require pnp-member (free-community fallback)
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Load a resource row (channel / hangout / creator) given its kind + id.
   * Returns a normalized object with access_type + creator_id where relevant.
   *
   * @param {'channel'|'hangout'|'creator'} kind
   * @param {string} resourceId
   * @returns {Promise<object|null>}
   */
  static async _loadResource(kind, resourceId) {
    if (!kind || !resourceId) return null;
    try {
      if (kind === 'channel') {
        const { rows } = await query(
          `SELECT id, creator_id, access_type, price_usd, hangout_group_id, name, cover_image_url
             FROM creator_channels
             WHERE id = $1 LIMIT 1`,
          [String(resourceId)]
        );
        return rows[0] || null;
      }
      if (kind === 'hangout') {
        const { rows } = await query(
          `SELECT id, creator_id, is_paid, price_usd, channel_id, name
             FROM hangout_groups
             WHERE id = $1 LIMIT 1`,
          [String(resourceId)]
        );
        return rows[0] || null;
      }
      if (kind === 'creator') {
        const { rows } = await query(
          `SELECT id FROM users WHERE id = $1 LIMIT 1`,
          [String(resourceId)]
        );
        return rows[0] || null;
      }
    } catch (err) {
      logger.error('EntitlementAccessService._loadResource failed', {
        kind, resourceId, error: err.message,
      });
    }
    return null;
  }

  /**
   * Check whether a user has access to a specific resource.
   * Returns a structured decision object the caller can turn into JSON / 403.
   *
   * @param {string|number} userId
   * @param {'channel'|'hangout'|'creator'} kind
   * @param {string} resourceId
   * @returns {Promise<{allowed: boolean, reason: string, scoped?: boolean,
   *                    accessType?: string, creatorId?: string, priceUsd?: number,
   *                    code?: string}>}
   */
  static async hasResourceAccess(userId, kind, resourceId) {
    if (!userId) {
      return { allowed: false, reason: 'unauthenticated', code: 'AUTH_REQUIRED' };
    }

    // 1. banned
    if (await EntitlementAccessService.isBanned(userId)) {
      return { allowed: false, reason: 'banned', code: 'ACCOUNT_SUSPENDED' };
    }

    const resource = await EntitlementAccessService._loadResource(kind, resourceId);
    if (!resource) {
      return { allowed: false, reason: 'not_found', code: 'NOT_FOUND' };
    }

    // 3. direct scope match — highest priority because it's what the user paid for
    if (kind === 'channel') {
      if (await EntitlementAccessService.hasEntitlement(userId, 'channel-access', { creatorId: String(resource.id) })) {
        return { allowed: true, reason: 'scoped_channel_access', scoped: true };
      }
    }
    if (kind === 'hangout') {
      // Standalone paid hangout
      if (await EntitlementAccessService.hasEntitlement(userId, 'hangout-access', { creatorId: String(resource.id) })) {
        return { allowed: true, reason: 'scoped_hangout_access', scoped: true };
      }
      // If the hangout is linked to a channel, a paid channel-access on that channel grants it.
      if (resource.channel_id) {
        if (await EntitlementAccessService.hasEntitlement(userId, 'channel-access', { creatorId: String(resource.channel_id) })) {
          return { allowed: true, reason: 'scoped_via_channel', scoped: true };
        }
      }
      // Existing membership grandfather: for FREE community hangouts only —
      // neither is_paid nor channel-linked. Preserves pre-refactor behavior
      // where joining a free hangout gave permanent chat access until the
      // user left, regardless of tier. Paid / channel-linked hangouts are
      // intentionally NOT grandfathered: when the scoped entitlement
      // (hangout-access or channel-access) expires, access is lost even if a
      // hangout_group_members row persists.
      if (!resource.is_paid && !resource.channel_id) {
        try {
          const membership = await query(
            `SELECT 1 FROM hangout_group_members
               WHERE group_id = $1 AND user_id = $2
                 AND (is_banned = false OR is_banned IS NULL)
               LIMIT 1`,
            [String(resource.id), String(userId)]
          );
          if (membership.rows.length > 0) {
            return { allowed: true, reason: 'existing_member' };
          }
        } catch (memberErr) {
          logger.warn('hasResourceAccess: hangout_group_members check failed', {
            userId, hangoutId: resource.id, error: memberErr.message,
          });
        }
      }
    }
    if (kind === 'creator') {
      if (await EntitlementAccessService.hasEntitlement(userId, 'creator-subscription', { creatorId: String(resource.id) })) {
        return { allowed: true, reason: 'scoped_creator_subscription', scoped: true };
      }
    }

    // 4. global PRIME override — prime unlocks everything except banned state
    if (await EntitlementAccessService.hasEntitlement(userId, 'prime')) {
      return { allowed: true, reason: 'prime_override' };
    }

    // 5. kind-specific resolution
    if (kind === 'channel') {
      const accessType = resource.access_type || 'free';
      if (accessType === 'free') {
        return { allowed: true, reason: 'free' };
      }
      if (accessType === 'prime') {
        return {
          allowed: false,
          reason: 'requires_prime',
          accessType: 'prime',
          code: 'PRIME_REQUIRED',
        };
      }
      if (accessType === 'subscription') {
        const creatorId = String(resource.creator_id);
        if (await EntitlementAccessService.hasEntitlement(userId, 'creator-subscription', { creatorId })) {
          return { allowed: true, reason: 'creator_subscriber', scoped: true };
        }
        return {
          allowed: false,
          reason: 'requires_subscription',
          accessType: 'subscription',
          creatorId,
          code: 'CREATOR_SUBSCRIPTION_REQUIRED',
        };
      }
      if (accessType === 'paid') {
        return {
          allowed: false,
          reason: 'requires_payment',
          accessType: 'paid',
          creatorId: resource.creator_id ? String(resource.creator_id) : undefined,
          priceUsd: resource.price_usd ? Number(resource.price_usd) : undefined,
          code: 'PAYMENT_REQUIRED',
        };
      }
    }

    if (kind === 'hangout') {
      // Channel-linked hangouts delegate to the channel's access model.
      if (resource.channel_id) {
        return EntitlementAccessService.hasResourceAccess(userId, 'channel', resource.channel_id);
      }
      // Standalone paid hangout without a direct scope entitlement
      if (resource.is_paid) {
        return {
          allowed: false,
          reason: 'requires_payment',
          accessType: 'paid',
          creatorId: resource.creator_id ? String(resource.creator_id) : undefined,
          priceUsd: resource.price_usd ? Number(resource.price_usd) : undefined,
          code: 'PAYMENT_REQUIRED',
        };
      }
      // Free community hangout → require pnp-member
    }

    if (kind === 'creator') {
      // Viewing a creator profile itself is public. Callers should only use
      // hasResourceAccess('creator', id) when gating creator-exclusive content.
      return {
        allowed: false,
        reason: 'requires_subscription',
        accessType: 'subscription',
        creatorId: String(resource.id),
        code: 'CREATOR_SUBSCRIPTION_REQUIRED',
      };
    }

    // 6. Free-community fallback: require pnp-member for everything else.
    if (await EntitlementAccessService.hasEntitlement(userId, 'pnp-member')) {
      return { allowed: true, reason: 'pnp_member' };
    }
    return {
      allowed: false,
      reason: 'requires_member',
      code: 'MEMBER_REQUIRED',
    };
  }

  /**
   * Express middleware factory that requires scoped resource access.
   * Reads the resource id from req.params[paramName]. On deny, returns a
   * structured 403 the frontend can use to render the correct payment modal.
   *
   * @param {'channel'|'hangout'|'creator'} kind
   * @param {string} [paramName='id']
   * @returns {import('express').RequestHandler}
   */
  static requireResourceAccess(kind, paramName = 'id') {
    return async (req, res, next) => {
      const user = req.session?.user;
      if (!user?.id) {
        return res.status(401).json({ success: false, error: 'Authentication required', code: 'AUTH_REQUIRED' });
      }
      // Admins bypass
      const role = (user.role || '').toLowerCase();
      if (role === 'admin' || role === 'superadmin') return next();

      const resourceId = req.params?.[paramName];
      if (!resourceId) {
        return res.status(400).json({ success: false, error: `Missing ${paramName} param` });
      }

      const decision = await EntitlementAccessService.hasResourceAccess(user.id, kind, resourceId);
      if (decision.allowed) return next();

      // Map decision to HTTP response
      const status =
        decision.code === 'AUTH_REQUIRED' ? 401 :
        decision.code === 'NOT_FOUND' ? 404 :
        decision.code === 'ACCOUNT_SUSPENDED' ? 403 :
        403;

      return res.status(status).json({
        success: false,
        error: decision.reason || 'Access denied',
        code: decision.code || 'ACCESS_DENIED',
        accessType: decision.accessType,
        creatorId: decision.creatorId,
        priceUsd: decision.priceUsd,
        scoped: decision.scoped === true,
        kind,
        resourceId,
        upgradeUrl: decision.code === 'PRIME_REQUIRED' || decision.code === 'MEMBER_REQUIRED' ? '/subscribe' : undefined,
      });
    };
  }

  /**
   * Aggregate structured access data for the My Access user page.
   * Returns a flat object: global membership, paid channels, subscribed creators,
   * paid hangouts, and private call credit count.
   *
   * @param {string|number} userId
   * @returns {Promise<{
   *   tier: 'PRIME'|'BASIC'|'FREE',
   *   global: {primeExpiresAt: string|null, primeLifetime: boolean,
   *            memberExpiresAt: string|null, memberLifetime: boolean,
   *            privateCallCredits: number},
   *   channels: Array<{id, name, coverUrl, creatorId, creatorHandle, expiresAt, isLifetime, url}>,
   *   hangouts: Array<{id, name, avatarUrl, expiresAt, isLifetime, url}>,
   *   creators: Array<{id, displayName, handle, avatarUrl, expiresAt, isLifetime, url}>
   * }>}
   */
  static async getUserResourceAccess(userId) {
    const empty = {
      tier: 'FREE',
      global: {
        primeExpiresAt: null, primeLifetime: false,
        memberExpiresAt: null, memberLifetime: false,
        privateCallCredits: 0,
      },
      channels: [],
      hangouts: [],
      creators: [],
    };
    if (!userId) return empty;

    try {
      const [entRes, tier] = await Promise.all([
        query(`
          SELECT ue.id, ue.add_on_id, ue.creator_id, ue.is_lifetime, ue.expires_at,
                 ue.is_consumed, ue.granted_at
            FROM user_entitlements ue
            WHERE ue.user_id = $1
              AND ue.is_consumed = false
              AND (ue.is_lifetime = true OR (ue.expires_at IS NOT NULL AND ue.expires_at > NOW()))
            ORDER BY ue.granted_at DESC
        `, [String(userId)]),
        EntitlementAccessService.getUserLabel(userId),
      ]);

      const rows = entRes.rows;
      const result = { ...empty, tier, channels: [], hangouts: [], creators: [] };

      // Partition rows by add_on_id
      const channelRows = [];
      const hangoutRows = [];
      const creatorRows = [];
      let privateCallCredits = 0;

      for (const r of rows) {
        if (r.add_on_id === 'prime') {
          result.global.primeExpiresAt = r.expires_at;
          result.global.primeLifetime = !!r.is_lifetime;
        } else if (r.add_on_id === 'pnp-member') {
          result.global.memberExpiresAt = r.expires_at;
          result.global.memberLifetime = !!r.is_lifetime;
        } else if (r.add_on_id === 'private-calls') {
          privateCallCredits += 1;
        } else if (r.add_on_id === 'channel-access' && r.creator_id) {
          channelRows.push(r);
        } else if (r.add_on_id === 'hangout-access' && r.creator_id) {
          hangoutRows.push(r);
        } else if (r.add_on_id === 'creator-subscription' && r.creator_id) {
          creatorRows.push(r);
        }
      }
      // Also count unconsumed private-calls credits
      // (we already counted above; include legacy consumed=false rows that are lifetime)
      result.global.privateCallCredits = privateCallCredits;

      // Resolve display metadata in parallel.
      // Note: creator_id in a user_entitlements row is the SCOPE id for that
      // add-on — a channel id, hangout id, or user id depending on the add_on_id.
      const [channelMeta, hangoutMeta, creatorMeta] = await Promise.all([
        channelRows.length > 0
          ? query(
              `SELECT id, name, cover_image_url, creator_id FROM creator_channels WHERE id::text = ANY($1::text[])`,
              [channelRows.map((r) => String(r.creator_id))]
            ).then((x) => x.rows).catch(() => [])
          : Promise.resolve([]),
        hangoutRows.length > 0
          ? query(
              `SELECT id, name, avatar_url FROM hangout_groups WHERE id::text = ANY($1::text[])`,
              [hangoutRows.map((r) => String(r.creator_id))]
            ).then((x) => x.rows).catch(() => [])
          : Promise.resolve([]),
        creatorRows.length > 0
          ? query(
              `SELECT id, first_name, last_name, username, photo_file_id FROM users WHERE id = ANY($1::text[])`,
              [creatorRows.map((r) => String(r.creator_id))]
            ).then((x) => x.rows).catch(() => [])
          : Promise.resolve([]),
      ]);

      const chById = new Map(channelMeta.map((c) => [String(c.id), c]));
      const hgById = new Map(hangoutMeta.map((h) => [String(h.id), h]));
      const crById = new Map(creatorMeta.map((u) => [String(u.id), u]));

      result.channels = channelRows.map((r) => {
        const meta = chById.get(String(r.creator_id)) || {};
        return {
          id: String(r.creator_id),
          name: meta.name || 'Channel',
          coverUrl: meta.cover_image_url || null,
          creatorId: meta.creator_id ? String(meta.creator_id) : null,
          expiresAt: r.expires_at,
          isLifetime: !!r.is_lifetime,
          url: `/channels/${r.creator_id}`,
        };
      });

      result.hangouts = hangoutRows.map((r) => {
        const meta = hgById.get(String(r.creator_id)) || {};
        return {
          id: String(r.creator_id),
          name: meta.name || 'Hangout',
          avatarUrl: meta.avatar_url || null,
          expiresAt: r.expires_at,
          isLifetime: !!r.is_lifetime,
          url: `/chat/${r.creator_id}`,
        };
      });

      result.creators = creatorRows.map((r) => {
        const meta = crById.get(String(r.creator_id)) || {};
        const displayName =
          [meta.first_name, meta.last_name].filter(Boolean).join(' ').trim()
          || meta.username
          || 'Creator';
        return {
          id: String(r.creator_id),
          displayName,
          handle: meta.username || null,
          avatarUrl: meta.photo_file_id || null,
          expiresAt: r.expires_at,
          isLifetime: !!r.is_lifetime,
          url: `/profile/${r.creator_id}`,
        };
      });

      return result;
    } catch (err) {
      logger.error('EntitlementAccessService.getUserResourceAccess failed', {
        userId, error: err.message,
      });
      return empty;
    }
  }
}

module.exports = EntitlementAccessService;
