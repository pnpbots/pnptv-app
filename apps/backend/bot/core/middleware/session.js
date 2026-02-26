const { cache } = require('../../../config/redis');
const logger = require('../../../utils/logger');

/**
 * Session middleware for Telegraf
 * Uses Redis for session storage, falls back to in-memory
 */

// In-memory session fallback
const memoryStore = new Map();

/**
 * Get session key for user
 * @param {import('telegraf').Context} ctx - Telegraf context
 * @returns {string} Session key
 */
const getSessionKey = (ctx) => {
  const userId = ctx.from?.id || ctx.chat?.id;
  return `session:${userId}`;
};

/**
 * Session middleware
 * @returns {(ctx: import('telegraf').Context, next: Function) => Promise<void>} Middleware function
 */
const sessionMiddleware = () => async (ctx, next) => {
  const sessionKey = getSessionKey(ctx);

  try {
    // Try to load session from Redis, fallback to memory
    let session;
    try {
      session = await cache.get(sessionKey);
    } catch (redisError) {
      logger.warn('Redis unavailable, using in-memory session:', redisError.message);
      session = memoryStore.get(sessionKey);
    }

    if (!session) {
      session = {
        language: ctx.from?.language_code || 'en',
        userId: ctx.from?.id,
        temp: {}, // Temporary data for multi-step flows
      };
    }

    // Attach session to context
    ctx.session = session;

    // Save session method
    ctx.saveSession = async () => {
      try {
        const ttl = parseInt(process.env.SESSION_TTL || '86400', 10);
        try {
          await cache.set(sessionKey, ctx.session, ttl);
        } catch (_redisError) {
          // Fallback to in-memory storage
          memoryStore.set(sessionKey, ctx.session);
        }
      } catch (error) {
        logger.error('Error saving session:', error);
      }
    };

    // Clear session method
    ctx.clearSession = async () => {
      try {
        try {
          await cache.del(sessionKey);
        } catch (_redisError) {
          memoryStore.delete(sessionKey);
        }
        ctx.session = {
          language: ctx.from?.language_code || 'en',
          userId: ctx.from?.id,
          temp: {},
        };
      } catch (error) {
        logger.error('Error clearing session:', error);
      }
    };

    // Use try-finally to ensure session is always saved
    try {
      // Execute next middleware
      await next();
    } finally {
      // Auto-save session after processing (always executes)
      try {
        await ctx.saveSession();
      } catch (saveError) {
        logger.error('Failed to save session after middleware:', saveError);
      }
    }
  } catch (error) {
    logger.error('Session middleware error:', error);
    throw error;
  }
};

module.exports = sessionMiddleware;
