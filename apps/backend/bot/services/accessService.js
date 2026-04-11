'use strict';

const { getRedis } = require('../../config/redis');
const { query } = require('../../config/postgres');
const logger = require('../../utils/logger');

// Canonical tier constants. DB stores 'PRIME' uppercase — normalizeTier handles it.
const TIER = Object.freeze({
  FREE: 'free',
  MEMBER: 'member',
  PRIME: 'PRIME',
  BANNED: 'banned',
});

// Numeric hierarchy for range comparisons.
// Keys include both canonical DB values and their lowercase equivalents so
// TIER_LEVEL lookups work regardless of whether the caller normalized first.
const TIER_LEVEL = Object.freeze({
  [TIER.BANNED]: -1,
  banned: -1,
  [TIER.FREE]: 0,
  free: 0,
  [TIER.MEMBER]: 1,
  member: 1,
  [TIER.PRIME]: 2,
  prime: 2,
});

/**
 * Normalize a tier string for comparison.
 * Handles null/undefined and the DB-stored uppercase 'PRIME'.
 *
 * @param {string|null|undefined} tier
 * @returns {string} lowercase tier string, defaults to 'free'
 */
function normalizeTier(tier) {
  return (tier || 'free').toLowerCase();
}

// ---------------------------------------------------------------------------
// Pure tier checks — accept a tier *string* (raw from DB or normalized).
// ---------------------------------------------------------------------------

function isPrime(tier) {
  return normalizeTier(tier) === 'prime';
}

function isMember(tier) {
  return normalizeTier(tier) === 'member';
}

function isFree(tier) {
  return normalizeTier(tier) === 'free';
}

function isBanned(tier) {
  return normalizeTier(tier) === 'banned';
}

function isMemberOrAbove(tier) {
  const t = normalizeTier(tier);
  return t === 'member' || t === 'prime';
}

/**
 * Compare two tier strings by hierarchy level.
 * Works with both raw DB values ('PRIME') and normalized values ('prime').
 *
 * @param {string} userTier    - tier the user currently holds
 * @param {string} requiredTier - minimum tier required
 * @returns {boolean}
 */
function hasMinTier(userTier, requiredTier) {
  const userLevel = TIER_LEVEL[userTier] ?? TIER_LEVEL[normalizeTier(userTier)] ?? -1;
  const requiredLevel = TIER_LEVEL[requiredTier] ?? TIER_LEVEL[normalizeTier(requiredTier)] ?? 0;
  return userLevel >= requiredLevel;
}

// ---------------------------------------------------------------------------
// User-object checks — accept a user object with { tier, role }.
// ---------------------------------------------------------------------------

/**
 * Returns true for admin and superadmin roles.
 * Admins bypass all tier gates.
 *
 * @param {{ role?: string }} user
 * @returns {boolean}
 */
function isAdmin(user) {
  const role = (user?.role || '').toLowerCase();
  return role === 'admin' || role === 'superadmin';
}

/**
 * Returns true if the user meets or exceeds the required tier,
 * OR if the user is an admin (admins always pass).
 *
 * @param {{ tier?: string, role?: string }} user
 * @param {string} requiredTier
 * @returns {boolean}
 */
function hasAccess(user, requiredTier) {
  if (isAdmin(user)) return true;
  return hasMinTier(user?.tier, requiredTier);
}

// ---------------------------------------------------------------------------
// Fresh tier validation — prevents stale-session PRIME access after expiry.
// Only hits DB when the session claims PRIME; caches result in Redis for 5 min.
// ---------------------------------------------------------------------------

/**
 * Validate a user's effective tier against live entitlements, bypassing a stale session.
 *
 * Now delegates entirely to EntitlementAccessService.getUserLabel() so that the
 * entitlement table is the single source of truth. The old plan_expiry / users.tier
 * DB path is removed — those columns are now backward-compat display fields only.
 *
 * Returned values are lowercase and backward-compatible with all existing callers:
 *   PRIME label → 'prime'
 *   BASIC label → 'member'
 *   FREE  label → 'free'
 *
 * @param {number|string} userId
 * @param {string} sessionTier - tier currently stored in the session (used as fallback only)
 * @returns {Promise<string>} effective tier (lowercase)
 */
async function validateTierFresh(userId, sessionTier) {
  try {
    // Lazy-require to avoid circular dependency (entitlementAccessService → postgres → ...)
    const EntitlementAccessService = require('./entitlementAccessService');
    const label = await EntitlementAccessService.getUserLabel(userId);
    if (label === 'PRIME') return 'prime';
    if (label === 'BASIC') return 'member';
    return 'free';
  } catch (err) {
    logger.warn(`validateTierFresh failed for user ${userId}: ${err.message}`);
    // Fail closed: if entitlement check is unavailable, treat as free.
    return 'free';
  }
}

// ---------------------------------------------------------------------------
// Express middleware factory.
// Replaces the inline requirePrimeTier / requireMemberTier in routes.js.
// ---------------------------------------------------------------------------

/**
 * Express middleware that gates a route behind a minimum tier.
 *
 * Usage:
 *   router.get('/prime-only', requireTier(TIER.PRIME), handler);
 *   router.get('/members',    requireTier(TIER.MEMBER), handler);
 *
 * Admins always pass through regardless of their tier.
 * For PRIME-gated routes, performs a lightweight DB re-validation (5-min Redis
 * cache) to prevent stale-session access after subscription expiry (HIGH-04).
 *
 * @param {string} requiredTier - one of TIER.FREE | TIER.MEMBER | TIER.PRIME
 * @returns {import('express').RequestHandler}
 */
function requireTier(requiredTier) {
  const normalized = normalizeTier(requiredTier);
  const needsFreshCheck = normalized === 'prime';

  return async (req, res, next) => {
    const user = req.session?.user;

    if (!user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Admins bypass all tier gates — no DB check needed.
    if (isAdmin(user)) {
      return next();
    }

    let effectiveTier = user.tier;

    if (needsFreshCheck) {
      try {
        effectiveTier = await validateTierFresh(user.id, user.tier);
        // Keep session in sync so downstream handlers see the corrected tier.
        if (effectiveTier !== normalizeTier(user.tier)) {
          req.session.user.tier = effectiveTier;
        }
      } catch (err) {
        logger.warn(`requireTier fresh-check error for user ${user.id}: ${err.message}`);
        effectiveTier = 'free';
      }
    }

    if (hasMinTier(effectiveTier, requiredTier)) {
      return next();
    }

    const tierName = normalized === 'prime' ? 'Prime' : 'Member';
    const code = normalized === 'prime' ? 'PRIME_REQUIRED' : 'MEMBER_REQUIRED';

    return res.status(403).json({
      error: `${tierName} subscription required`,
      code,
      upgradeUrl: '/subscribe',
    });
  };
}

/**
 * Check if a user has an active, non-consumed entitlement for a given add-on.
 * Considers lifetime entitlements and time-limited entitlements (not expired).
 * For creator-subscription add-ons, pass creatorId to check a specific creator's content.
 *
 * @param {string} userId
 * @param {string} addOnId - e.g. 'prime', 'pnp-member', 'private-calls', 'creator-subscription'
 * @param {Object} [opts]
 * @param {string} [opts.creatorId] - required for 'creator-subscription' checks
 * @returns {Promise<boolean>}
 */
async function hasEntitlement(userId, addOnId, { creatorId = null } = {}) {
  if (!userId || !addOnId) return false;
  try {
    const { rows } = await query(`
      SELECT 1 FROM user_entitlements
      WHERE user_id = $1
        AND add_on_id = $2
        AND ($3::text IS NULL OR creator_id = $3)
        AND is_consumed = false
        AND (is_lifetime = true OR (expires_at IS NOT NULL AND expires_at > NOW()))
      LIMIT 1
    `, [String(userId), addOnId, creatorId ?? null]);
    return rows.length > 0;
  } catch (err) {
    logger.error('hasEntitlement check failed', { userId, addOnId, error: err.message });
    return false;
  }
}

// ---------------------------------------------------------------------------
// Channel access gate — evaluates creator_channels.access_type for a user.
// ---------------------------------------------------------------------------

/**
 * Determine whether a user may access a creator channel (or a hangout linked
 * to that channel).
 *
 * @param {string|number|null} userId
 * @param {{ id?: number, access_type: string, price_usd: number|string, creator_id: string }} channel
 * @returns {Promise<{
 *   allowed: boolean,
 *   reason: string,
 *   requiresPayment?: boolean,
 *   priceUsd?: number,
 *   accessType?: string,
 *   creatorId?: string,
 * }>}
 */
async function checkChannelAccess(userId, channel) {
  // Thin compatibility wrapper around EntitlementAccessService.hasResourceAccess.
  // Keeps the legacy response shape so existing callers
  // (hangoutGroupController.joinGroup, etc.) do not need to change.
  const EntitlementAccessService = require('./entitlementAccessService');
  const { access_type } = channel || {};
  const channelId = channel?.id || channel?.creator_id;

  // Free channels are always accessible — preserve fast path for unauthenticated callers too.
  if (access_type === 'free') {
    return { allowed: true, reason: 'free' };
  }
  if (!userId) {
    return { allowed: false, reason: 'unauthenticated', accessType: access_type };
  }
  if (!channelId) {
    return { allowed: false, reason: 'not_found' };
  }

  // Channel owner always has access.
  if (String(userId) === String(channel.creator_id)) {
    return { allowed: true, reason: 'owner' };
  }

  try {
    const decision = await EntitlementAccessService.hasResourceAccess(userId, 'channel', String(channelId));
    return {
      allowed: decision.allowed,
      reason: decision.reason || (decision.allowed ? 'allowed' : 'denied'),
      accessType: decision.accessType || access_type,
      creatorId: decision.creatorId || channel?.creator_id,
      priceUsd: decision.priceUsd ?? (channel?.price_usd != null ? Number(channel.price_usd) : undefined),
      requiresPayment: decision.code === 'PAYMENT_REQUIRED',
      scoped: decision.scoped === true,
      code: decision.code,
    };
  } catch (err) {
    logger.error('checkChannelAccess error', { userId, channelId, error: err.message });
    return { allowed: false, reason: 'error', accessType: access_type };
  }
}

module.exports = {
  TIER,
  TIER_LEVEL,
  normalizeTier,
  isPrime,
  isMember,
  isFree,
  isBanned,
  isMemberOrAbove,
  hasMinTier,
  isAdmin,
  hasAccess,
  validateTierFresh,
  requireTier,
  hasEntitlement,
  checkChannelAccess,
};
