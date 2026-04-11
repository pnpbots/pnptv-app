const { query } = require('../../../config/postgres');
const logger = require('../../../utils/logger');
const axios = require('axios');

const AUTHENTIK_URL = process.env.AUTHENTIK_URL || 'https://auth.pnptv.app';

// Cache validated OIDC tokens for 5 minutes to avoid hitting Authentik on every request
const _oidcTokenCache = new Map();
const OIDC_CACHE_TTL = 5 * 60 * 1000;

/**
 * Validate an Authentik OIDC access token via the userinfo endpoint.
 * Returns the userinfo profile or null if invalid.
 * @param {string} token
 * @returns {object|null}
 */
async function validateOidcToken(token) {
  // Check cache first
  const cached = _oidcTokenCache.get(token);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.profile;
  }

  try {
    const res = await axios.get(`${AUTHENTIK_URL}/application/o/userinfo/`, {
      headers: { 'Authorization': `Bearer ${token}` },
      timeout: 8000,
    });
    if (res.data?.sub) {
      // Cache the result
      _oidcTokenCache.set(token, { profile: res.data, expiresAt: Date.now() + OIDC_CACHE_TTL });
      // Evict old entries periodically
      if (_oidcTokenCache.size > 1000) {
        const now = Date.now();
        for (const [k, v] of _oidcTokenCache) {
          if (now > v.expiresAt) _oidcTokenCache.delete(k);
        }
      }
      return res.data;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Unified Authentication Middleware
 * Supports two auth modes (checked in order):
 * 1. Express session (Telegram WebApp auth or OIDC token-exchange)
 * 2. Bearer token (Authentik OIDC access_token in Authorization header)
 *
 * Authentik is the single source of truth — session-based auth is still
 * supported for backwards compatibility with the Telegram MiniApp flow.
 */
const telegramAuth = async (req, res, next) => {
  try {
    // --- Mode 1: Session-based auth (Telegram or OIDC token-exchange) ---
    const sessionUser = req.session?.user;

    if (sessionUser) {
      const lookupKey = String(sessionUser.telegramId || sessionUser.pnptvId || sessionUser.id || '');

      const userQuery = await query(
        `SELECT id, telegram, pnptv_id, username, subscription_status, tier, terms_accepted
         FROM users
         WHERE telegram = $1 OR id = $1 OR pnptv_id = $1
         ORDER BY CASE WHEN telegram = $1 THEN 0 WHEN pnptv_id = $1 THEN 1 ELSE 2 END
         LIMIT 1`,
        [lookupKey]
      );

      if (userQuery.rows.length > 0) {
        const user = userQuery.rows[0];
        req.user = {
          id: user.id,
          pnptvId: user.pnptv_id,
          telegramId: user.telegram,
          username: user.username,
          tier: user.tier || 'free',
          subscriptionStatus: user.subscription_status,
          acceptedTerms: user.terms_accepted,
          authMethod: sessionUser.last_login_method || 'session',
        };
        return next();
      }
    }

    // --- Mode 2: Bearer token (Authentik OIDC access_token) ---
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      const profile = await validateOidcToken(token);

      if (profile && profile.sub) {
        // Look up user by Authentik UUID (pnptv_id)
        const userQuery = await query(
          `SELECT id, telegram, pnptv_id, username, subscription_status, tier, terms_accepted
           FROM users
           WHERE pnptv_id = $1
           LIMIT 1`,
          [profile.sub]
        );

        if (userQuery.rows.length > 0) {
          const user = userQuery.rows[0];
          req.user = {
            id: user.id,
            pnptvId: user.pnptv_id,
            telegramId: user.telegram,
            username: user.username,
            tier: user.tier || 'free',
            subscriptionStatus: user.subscription_status,
            acceptedTerms: user.terms_accepted,
            authMethod: 'oidc_bearer',
          };
          return next();
        }

        // User has valid Authentik token but no PNPtv DB record
        logger.warn(`OIDC bearer: valid token for sub ${profile.sub} but no DB user found`);
      }
    }

    // --- No valid auth found ---
    if (!sessionUser && !authHeader) {
      logger.warn('Unauthorized access attempt - no session or bearer token');
    }
    return res.status(401).json({
      error: 'Unauthorized',
      redirect: '/auth/telegram-login'
    });

  } catch (error) {
    logger.error('Auth middleware error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
};

const checkTermsAccepted = (req, res, next) => {
  if (req.user?.acceptedTerms) {
    return next();
  }
  
  res.status(403).json({
    error: 'Terms not accepted',
    redirect: '/auth/terms'
  });
};

const requireMember = (req, res, next) => {
  const tier = (req.user?.tier || '').toLowerCase();
  if (tier === 'member' || tier === 'prime') {
    return next();
  }

  res.status(403).json({
    error: 'Membership required',
    redirect: '/subscribe'
  });
};

const requirePrime = (req, res, next) => {
  if ((req.user?.tier || '').toLowerCase() === 'prime') {
    return next();
  }

  res.status(403).json({
    error: 'Prime membership required',
    redirect: '/auth/upgrade-required'
  });
};

module.exports = {
  telegramAuth,
  checkTermsAccepted,
  requireMember,
  requirePrime
};