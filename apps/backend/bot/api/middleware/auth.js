/**
 * Authentication Middleware
 * Validates JWT tokens and Telegram auth
 */

const jwt = require('jsonwebtoken');
const logger = require('../../../utils/logger');

const AUTH_SECRET = process.env.JWT_SECRET
  || process.env.SESSION_SECRET
  || (process.env.NODE_ENV === 'test' ? 'test-jwt-secret' : null);

/**
 * Authenticate user via JWT token or session (app users)
 * Extracts userId from token or session and attaches to req.user
 */
const authenticateUser = async (req, res, next) => {
  try {
    if (!AUTH_SECRET && !req.session?.user?.id) {
      return res.status(500).json({
        error: 'AUTH_CONFIG_ERROR',
        message: 'JWT secret is not configured',
      });
    }

    // Accept session auth (app users logged in via Telegram/X widget)
    if (req.session?.user?.id) {
      req.user = {
        id: req.session.user.id,
        userId: req.session.user.id,
      };
      return next();
    }

    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'Missing or invalid authorization header'
      });
    }

    const token = authHeader.substring(7); // Remove "Bearer " prefix

    // Verify JWT token
    const decoded = jwt.verify(token, AUTH_SECRET);

    // Extract user ID from token
    const userId = decoded.userId || decoded.sub || decoded.id;
    if (!userId) {
      return res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'Invalid token format'
      });
    }

    // Attach user info to request
    req.user = {
      id: userId,
      userId: userId
    };

    return next();
  } catch (error) {
    logger.warn('Authentication failed:', error.message);

    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        error: 'TOKEN_EXPIRED',
        message: 'Token has expired'
      });
    }

    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        error: 'INVALID_TOKEN',
        message: 'Invalid or malformed token'
      });
    }

    return res.status(401).json({
      error: 'UNAUTHORIZED',
      message: 'Authentication failed'
    });
  }
};

/**
 * Validate JWT token and return decoded payload
 */
const validateToken = (token) => {
  try {
    if (!AUTH_SECRET) {
      return { valid: false, error: 'JWT secret is not configured' };
    }
    const decoded = jwt.verify(token, AUTH_SECRET);
    return { valid: true, decoded };
  } catch (error) {
    return { valid: false, error: error.message };
  }
};

module.exports = {
  authenticateUser,
  validateToken
};
