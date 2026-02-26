const { RateLimiterRedis } = require('rate-limiter-flexible');
const { getRedis } = require('../../../config/redis');
const logger = require('../../../utils/logger');
const { t } = require('../../../utils/i18n');

let rateLimiter = null;

/**
 * Initialize rate limiter
 * @returns {RateLimiterRedis} Rate limiter instance
 */
const initRateLimiter = () => {
  if (rateLimiter) return rateLimiter;

  const redisClient = getRedis();

  rateLimiter = new RateLimiterRedis({
    storeClient: redisClient,
    keyPrefix: 'ratelimit',
    points: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '30', 10),
    duration: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10) / 1000,
    blockDuration: 60, // Block for 60 seconds if limit exceeded
  });

  return rateLimiter;
};

/**
 * Rate limiting middleware
 * @returns {Function} Middleware function
 */
const rateLimitMiddleware = () => {
  const limiter = initRateLimiter();

  return async (ctx, next) => {
    const userId = ctx.from?.id;

    if (!userId) {
      return next();
    }

    try {
      await limiter.consume(userId.toString());
      return next();
    } catch (rejRes) {
      const lang = ctx.session?.language || 'en';

      if (rejRes instanceof Error) {
        logger.error('Rate limiter error:', rejRes);
        return next();
      }

      // Rate limit exceeded
      const retryAfter = Math.round(rejRes.msBeforeNext / 1000) || 60;

      logger.warn('Rate limit exceeded', {
        userId,
        retryAfter,
      });

      await ctx.reply(
        `⚠️ ${t('error', lang)}\n\nToo many requests. Please wait ${retryAfter} seconds.`,
      );
    }
  };
};

module.exports = rateLimitMiddleware;
