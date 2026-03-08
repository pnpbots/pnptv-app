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
 * Validate a user's effective tier against the DB, bypassing a stale session.
 *
 * - Returns immediately for non-PRIME tiers (no DB/Redis overhead).
 * - Checks `tier_check:<userId>` in Redis (5-min TTL) before hitting DB.
 * - If plan_expiry has passed, returns 'free' and caches that result.
 * - Callers should update req.session.user.tier when the returned tier differs.
 *
 * @param {number|string} userId
 * @param {string} sessionTier - tier currently stored in the session
 * @returns {Promise<string>} effective tier (lowercase)
 */
async function validateTierFresh(userId, sessionTier) {
  const normalized = normalizeTier(sessionTier);

  // Only PRIME is at risk of stale-session over-access; skip DB for others.
  if (normalized !== 'prime') return normalized;

  try {
    const redis = getRedis();
    const cacheKey = `tier_check:${userId}`;

    const cached = await redis.get(cacheKey);
    if (cached) return cached;

    const result = await query(
      'SELECT tier, plan_expiry FROM users WHERE id = $1',
      [userId]
    );
    const row = result.rows[0];
    if (!row) {
      await redis.set(cacheKey, 'free', 'EX', 300);
      return 'free';
    }

    const isExpired = row.plan_expiry && new Date(row.plan_expiry) <= new Date();
    const effectiveTier = isExpired ? 'free' : normalizeTier(row.tier);

    await redis.set(cacheKey, effectiveTier, 'EX', 300);
    return effectiveTier;
  } catch (err) {
    logger.warn(`validateTierFresh failed for user ${userId}: ${err.message}`);
    // Fail closed: if we cannot confirm PRIME, treat as free.
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
};
