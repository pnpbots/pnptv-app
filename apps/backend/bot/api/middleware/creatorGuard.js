'use strict';

const { getPool } = require('../../../config/postgres');
const logger = require('../../../utils/logger');

const LOCKED_RESPONSE = {
  success: false,
  error: {
    code: 'CREATOR_LOCKED',
    message: 'Your creator tools are temporarily paused pending onboarding. Our team will contact you with an exact date within 2 weeks.',
  },
};

/**
 * creatorLockGuard
 * Lightweight middleware that rejects requests from creators whose tools are
 * temporarily locked pending onboarding. Does NOT require an active creator
 * profile — used on CMS / channel routes where non-approved creators are
 * still permitted (e.g. pending applicants preparing drafts).
 */
async function creatorLockGuard(req, res, next) {
  const sessionUser = req.session?.user;
  if (!sessionUser) return next(); // leave auth enforcement to authGuard upstream

  try {
    const { rows } = await getPool().query(
      'SELECT creator_locked FROM users WHERE id = $1',
      [sessionUser.id]
    );
    if (rows.length > 0 && rows[0].creator_locked === true) {
      logger.info('creatorLockGuard: access denied — onboarding lock active', {
        userId: sessionUser.id,
        path: req.path,
      });
      return res.status(423).json(LOCKED_RESPONSE);
    }
    return next();
  } catch (error) {
    logger.error('creatorLockGuard DB error:', error);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Internal server error' } });
  }
}

/**
 * Creator Guard Middleware
 * Protects routes that require an active creator profile.
 * Validates creator_status directly from the DB on every request — never trusts
 * the stale session value. Mirrors the pattern used by roleGuard.js.
 */
async function creatorGuard(req, res, next) {
  const sessionUser = req.session?.user;

  if (!sessionUser) {
    return res.status(401).json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication required',
      },
    });
  }

  try {
    const result = await getPool().query(
      'SELECT role, creator_status, creator_locked FROM users WHERE id = $1',
      [sessionUser.id]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User not found',
        },
      });
    }

    const { role, creator_status, creator_locked } = result.rows[0];

    const isAdmin = ['admin', 'superadmin'].includes(role);
    const isCreator = ['active', 'eligible'].includes(creator_status);

    if (!isAdmin && !isCreator) {
      logger.warn('creatorGuard: access denied — no active creator profile', {
        userId: sessionUser.id,
        creator_status,
        path: req.path,
      });

      return res.status(403).json({
        success: false,
        error: {
          code: 'CREATOR_REQUIRED',
          message: 'An active creator profile is required to access this resource.',
        },
      });
    }

    if (creator_locked === true) {
      logger.info('creatorGuard: access denied — creator onboarding lock active', {
        userId: sessionUser.id,
        path: req.path,
      });
      return res.status(423).json({
        success: false,
        error: {
          code: 'CREATOR_LOCKED',
          message: 'Your creator tools are temporarily paused pending onboarding. Our team will contact you with an exact date within 2 weeks.',
        },
      });
    }

    // Attach fresh creator_status to req.user so downstream handlers can rely on it
    req.user = { ...sessionUser, creator_status, creator_locked: false };
    next();
  } catch (error) {
    logger.error('creatorGuard DB error:', error);
    return res.status(500).json({
      success: false,
      error: {
        code: 'SERVER_ERROR',
        message: 'Internal server error',
      },
    });
  }
}

module.exports = creatorGuard;
module.exports.creatorGuard = creatorGuard;
module.exports.creatorLockGuard = creatorLockGuard;
