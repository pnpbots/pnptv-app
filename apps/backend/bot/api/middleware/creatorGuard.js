'use strict';

const { getPool } = require('../../../config/postgres');
const logger = require('../../../utils/logger');

/**
 * Creator Guard Middleware
 * Protects routes that require an active creator profile.
 * Validates creator_status directly from the DB on every request — never trusts
 * the stale session value. Mirrors the pattern used by roleGuard.js.
 */
module.exports = async function creatorGuard(req, res, next) {
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
      'SELECT creator_status FROM users WHERE id = $1',
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

    const { creator_status } = result.rows[0];

    if (creator_status !== 'active') {
      logger.warn('creatorGuard: access denied — creator profile not active', {
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

    // Attach fresh creator_status to req.user so downstream handlers can rely on it
    req.user = { ...sessionUser, creator_status };
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
};
