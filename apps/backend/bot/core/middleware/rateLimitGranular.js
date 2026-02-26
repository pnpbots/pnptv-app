const { RateLimiterRedis } = require('rate-limiter-flexible');
const { getRedis } = require('../../../config/redis');
const logger = require('../../../utils/logger');
const { t } = require('../../../utils/i18n');

/**
 * Granular rate limiting middleware
 * Different limits for different types of operations
 */

// Rate limiter instances for different contexts
const limiters = {};

/**
 * Rate limit configurations by context
 */
const RATE_LIMITS = {
  // Default rate limit for general commands
  default: {
    points: 20, // 20 requests
    duration: 60, // per 60 seconds
    blockDuration: 60, // block for 60 seconds
  },

  // Payment operations (more restrictive)
  payment: {
    points: 5, // 5 payment attempts
    duration: 60, // per 60 seconds
    blockDuration: 300, // block for 5 minutes
  },

  // Admin operations (more permissive for authorized users)
  admin: {
    points: 100, // 100 requests
    duration: 60, // per 60 seconds
    blockDuration: 30, // block for 30 seconds
  },

  // Registration/onboarding (very restrictive)
  registration: {
    points: 3, // 3 attempts
    duration: 300, // per 5 minutes
    blockDuration: 600, // block for 10 minutes
  },

  // Media streaming (moderate)
  media: {
    points: 30, // 30 requests
    duration: 60, // per 60 seconds
    blockDuration: 60, // block for 60 seconds
  },

  // Search/queries (moderate)
  search: {
    points: 15, // 15 queries
    duration: 60, // per 60 seconds
    blockDuration: 60, // block for 60 seconds
  },

  // File uploads (very restrictive)
  upload: {
    points: 5, // 5 uploads
    duration: 300, // per 5 minutes
    blockDuration: 300, // block for 5 minutes
  },

  // Video call creation (restrictive to prevent abuse)
  videocall: {
    points: 5, // 5 calls
    duration: 3600, // per hour
    blockDuration: 1800, // block for 30 minutes
  },

  // Message sending (moderate, anti-spam)
  message: {
    points: 40, // 40 messages
    duration: 60, // per 60 seconds
    blockDuration: 120, // block for 2 minutes
  },

  // API webhooks (very permissive, external calls)
  webhook: {
    points: 1000, // 1000 requests
    duration: 60, // per 60 seconds
    blockDuration: 10, // block for 10 seconds
  },
};

/**
 * Initialize a rate limiter for a specific context
 * @param {string} context - Context name (payment, admin, etc.)
 * @returns {RateLimiterRedis} Rate limiter instance
 */
const initRateLimiter = (context = 'default') => {
  // Return cached limiter if exists
  if (limiters[context]) {
    return limiters[context];
  }

  const redisClient = getRedis();
  const config = RATE_LIMITS[context] || RATE_LIMITS.default;

  limiters[context] = new RateLimiterRedis({
    storeClient: redisClient,
    keyPrefix: `ratelimit:${context}`,
    points: config.points,
    duration: config.duration,
    blockDuration: config.blockDuration,
  });

  logger.info(`Rate limiter initialized for context: ${context}`, config);

  return limiters[context];
};

/**
 * Rate limiting middleware factory
 * @param {string} context - Rate limit context (payment, admin, etc.)
 * @param {object} options - Additional options
 * @returns {Function} Telegraf middleware
 */
const rateLimitByContext = (context = 'default', options = {}) => {
  const {
    skipForAdmins = false,
    customKeyGenerator = null,
    onLimitReached = null,
  } = options;

  const limiter = initRateLimiter(context);
  const config = RATE_LIMITS[context] || RATE_LIMITS.default;

  return async (ctx, next) => {
    const userId = ctx.from?.id;

    if (!userId) {
      // If no user ID, skip rate limiting (shouldn't happen in normal flow)
      return next();
    }

    // Skip rate limiting for admins if configured
    if (skipForAdmins && ctx.session?.isAdmin) {
      logger.debug('Rate limit skipped for admin user', { userId, context });
      return next();
    }

    // Generate rate limit key
    let key = userId.toString();
    if (customKeyGenerator) {
      key = customKeyGenerator(ctx);
    }

    try {
      // Try to consume a point
      const rateLimitRes = await limiter.consume(key);

      // Add rate limit info to context for monitoring
      ctx.rateLimit = {
        context,
        remainingPoints: rateLimitRes.remainingPoints,
        consumedPoints: rateLimitRes.consumedPoints,
        msBeforeNext: rateLimitRes.msBeforeNext,
      };

      // Log warning if user is approaching limit
      if (rateLimitRes.remainingPoints <= 2) {
        logger.warn('User approaching rate limit', {
          userId,
          context,
          remainingPoints: rateLimitRes.remainingPoints,
        });
      }

      return next();
    } catch (rejRes) {
      const lang = ctx.session?.language || 'en';

      // Handle actual errors (not rate limit rejections)
      if (rejRes instanceof Error) {
        logger.error('Rate limiter error:', {
          error: rejRes.message,
          context,
          userId,
        });
        // Allow request to proceed on error (fail open)
        return next();
      }

      // Rate limit exceeded
      const retryAfter = Math.round(rejRes.msBeforeNext / 1000) || config.blockDuration;

      logger.warn('Rate limit exceeded', {
        userId,
        username: ctx.from?.username,
        context,
        retryAfter,
        consumedPoints: rejRes.consumedPoints,
      });

      // Custom handler for rate limit reached
      if (onLimitReached) {
        return onLimitReached(ctx, retryAfter, context);
      }

      // Default response
      const messages = {
        payment: `🚫 Demasiados intentos de pago. `
          + `Por favor espera ${retryAfter} segundos antes de intentar nuevamente.\n\n`
          + `Si necesitas ayuda, contacta a soporte.`,
        registration: `🚫 Demasiados intentos de registro. `
          + `Por favor espera ${retryAfter} segundos.\n\n`
          + `Verifica tu información e intenta nuevamente.`,
        upload: `📁 Demasiadas cargas de archivos. `
          + `Por favor espera ${retryAfter} segundos.`,
        message: `💬 Estás enviando mensajes muy rápido. `
          + `Por favor espera ${retryAfter} segundos.`,
        default: `⏱ Demasiadas solicitudes. `
          + `Por favor espera ${retryAfter} segundos antes de continuar.`,
      };

      const message = messages[context] || messages.default;

      await ctx.reply(message);

      // Don't call next() - stop the middleware chain
    }
  };
};

/**
 * Check if user has remaining points without consuming
 * Useful for pre-checking before expensive operations
 * @param {string} userId - User ID
 * @param {string} context - Rate limit context
 * @returns {Promise<{allowed: boolean, remainingPoints: number}>}
 */
const checkRateLimit = async (userId, context = 'default') => {
  const limiter = initRateLimiter(context);

  try {
    const res = await limiter.get(userId.toString());

    if (!res) {
      // No rate limit data exists yet
      return { allowed: true, remainingPoints: RATE_LIMITS[context].points };
    }

    const remainingPoints = Math.max(0, RATE_LIMITS[context].points - res.consumedPoints);

    return {
      allowed: remainingPoints > 0,
      remainingPoints,
      msBeforeNext: res.msBeforeNext,
    };
  } catch (error) {
    logger.error('Error checking rate limit:', error);
    return { allowed: true, remainingPoints: 0 };
  }
};

/**
 * Manually consume points (useful for operations outside middleware)
 * @param {string} userId - User ID
 * @param {string} context - Rate limit context
 * @param {number} points - Number of points to consume (default: 1)
 * @returns {Promise<boolean>} True if allowed, false if rate limited
 */
const consumeRateLimit = async (userId, context = 'default', points = 1) => {
  const limiter = initRateLimiter(context);

  try {
    await limiter.consume(userId.toString(), points);
    return true;
  } catch (rejRes) {
    if (rejRes instanceof Error) {
      logger.error('Error consuming rate limit:', rejRes);
      return true; // Fail open
    }
    return false; // Rate limited
  }
};

/**
 * Reset rate limit for a user (admin function)
 * @param {string} userId - User ID
 * @param {string} context - Rate limit context (or 'all' for all contexts)
 */
const resetRateLimit = async (userId, context = 'all') => {
  try {
    if (context === 'all') {
      // Reset all contexts
      const promises = Object.keys(RATE_LIMITS).map((ctx) => {
        const limiter = initRateLimiter(ctx);
        return limiter.delete(userId.toString());
      });
      await Promise.all(promises);
      logger.info('All rate limits reset for user', { userId });
    } else {
      // Reset specific context
      const limiter = initRateLimiter(context);
      await limiter.delete(userId.toString());
      logger.info('Rate limit reset for user', { userId, context });
    }
    return true;
  } catch (error) {
    logger.error('Error resetting rate limit:', error);
    return false;
  }
};

/**
 * Get rate limit info for a user
 * @param {string} userId - User ID
 * @param {string} context - Rate limit context
 * @returns {Promise<object>} Rate limit info
 */
const getRateLimitInfo = async (userId, context = 'default') => {
  const limiter = initRateLimiter(context);
  const config = RATE_LIMITS[context] || RATE_LIMITS.default;

  try {
    const res = await limiter.get(userId.toString());

    if (!res) {
      return {
        context,
        consumed: 0,
        remaining: config.points,
        limit: config.points,
        resetIn: 0,
      };
    }

    return {
      context,
      consumed: res.consumedPoints,
      remaining: Math.max(0, config.points - res.consumedPoints),
      limit: config.points,
      resetIn: Math.round(res.msBeforeNext / 1000),
    };
  } catch (error) {
    logger.error('Error getting rate limit info:', error);
    return null;
  }
};

module.exports = {
  rateLimitByContext,
  checkRateLimit,
  consumeRateLimit,
  resetRateLimit,
  getRateLimitInfo,
  RATE_LIMITS, // Export for reference
};
