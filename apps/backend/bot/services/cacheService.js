const { cache } = require('../../config/redis');
const PlanModel = require('../../models/planModel');
const UserModel = require('../../models/userModel');
const logger = require('../../utils/logger');

/**
 * Cache Management Service
 * Centralized cache operations for the application
 */
class CacheService {
  /**
   * Prewarm all critical caches
   * Call this on application startup
   * @returns {Promise<Object>} Prewarming results
   */
  static async prewarmAll() {
    const results = {
      plans: false,
      success: false,
      errors: [],
    };

    try {
      logger.info('Starting cache prewarming...');

      // Prewarm plans cache
      try {
        await PlanModel.prewarmCache();
        results.plans = true;
        logger.info('✓ Plans cache prewarmed');
      } catch (error) {
        logger.warn('Plans cache prewarming failed:', error.message);
        results.errors.push({ type: 'plans', error: error.message });
      }

      // Add more prewarming tasks here
      // For example: prewarm popular user searches, statistics, etc.

      results.success = results.plans;
      logger.info('Cache prewarming completed', results);

      return results;
    } catch (error) {
      logger.error('Cache prewarming error:', error);
      results.errors.push({ type: 'general', error: error.message });
      return results;
    }
  }

  /**
   * Clear all application caches
   * Use with caution - will impact performance temporarily
   * @returns {Promise<Object>} Clear results
   */
  static async clearAll() {
    const results = {
      plans: 0,
      users: 0,
      nearby: 0,
      locks: 0,
      stats: 0,
      total: 0,
    };

    try {
      logger.info('Clearing all caches...');

      // Clear plans cache
      results.plans = await cache.delPattern('plan:*');
      await cache.del('plans:all');

      // Clear users cache
      results.users = await cache.delPattern('user:*');

      // Clear nearby searches
      results.nearby = await cache.delPattern('nearby:*');

      // Clear locks (be careful with this!)
      results.locks = await cache.delPattern('lock:*');

      // Clear stats
      await cache.del('stats:users');
      results.stats = 1;

      results.total = results.plans + results.users + results.nearby + results.locks + results.stats;

      logger.info(`All caches cleared. Total keys deleted: ${results.total}`, results);

      return results;
    } catch (error) {
      logger.error('Error clearing caches:', error);
      return results;
    }
  }

  /**
   * Get cache statistics
   * @returns {Promise<Object>} Cache stats
   */
  static async getStats() {
    try {
      const stats = {
        plans: await cache.scanKeys('plan:*', 100),
        users: await cache.scanKeys('user:*', 100),
        nearby: await cache.scanKeys('nearby:*', 100),
        locks: await cache.scanKeys('lock:*', 100),
        webhooks: await cache.scanKeys('webhook:*', 100),
        ratelimit: await cache.scanKeys('ratelimit:*', 100),
      };

      const totals = {
        plans: stats.plans.length,
        users: stats.users.length,
        nearby: stats.nearby.length,
        locks: stats.locks.length,
        webhooks: stats.webhooks.length,
        ratelimit: stats.ratelimit.length,
        total: stats.plans.length + stats.users.length + stats.nearby.length
          + stats.locks.length + stats.webhooks.length + stats.ratelimit.length,
      };

      logger.info('Cache statistics:', totals);

      return {
        totals,
        keys: stats,
      };
    } catch (error) {
      logger.error('Error getting cache stats:', error);
      return {
        totals: {
          plans: 0, users: 0, nearby: 0, locks: 0, webhooks: 0, ratelimit: 0, total: 0,
        },
        keys: {},
      };
    }
  }

  /**
   * Invalidate cache for a specific user
   * @param {number|string} userId - User ID
   * @returns {Promise<boolean>} Success status
   */
  static async invalidateUser(userId) {
    try {
      await UserModel.invalidateCache(userId);
      logger.info(`Cache invalidated for user: ${userId}`);
      return true;
    } catch (error) {
      logger.error(`Error invalidating cache for user ${userId}:`, error);
      return false;
    }
  }

  /**
   * Invalidate all plan caches
   * @returns {Promise<boolean>} Success status
   */
  static async invalidatePlans() {
    try {
      await PlanModel.invalidateCache();
      logger.info('All plan caches invalidated');
      return true;
    } catch (error) {
      logger.error('Error invalidating plan caches:', error);
      return false;
    }
  }

  /**
   * Refresh cache for specific data type
   * Clears and rewarms the cache
   * @param {string} type - Cache type ('plans', 'stats')
   * @returns {Promise<boolean>} Success status
   */
  static async refresh(type) {
    try {
      logger.info(`Refreshing ${type} cache...`);

      switch (type) {
        case 'plans':
          await this.invalidatePlans();
          await PlanModel.prewarmCache();
          logger.info('Plans cache refreshed');
          return true;

        case 'stats':
          await cache.del('stats:users');
          await UserModel.getStatistics(); // This will recalculate and cache
          logger.info('Stats cache refreshed');
          return true;

        default:
          logger.warn(`Unknown cache type: ${type}`);
          return false;
      }
    } catch (error) {
      logger.error(`Error refreshing ${type} cache:`, error);
      return false;
    }
  }

  /**
   * Clean up expired locks (for maintenance)
   * @returns {Promise<number>} Number of expired locks found
   */
  static async cleanupExpiredLocks() {
    try {
      const lockKeys = await cache.scanKeys('lock:*', 1000);
      let expiredCount = 0;

      for (const key of lockKeys) {
        const lockData = await cache.get(key);
        if (!lockData) {
          expiredCount++;
        }
      }

      logger.info(`Found ${expiredCount} expired locks out of ${lockKeys.length} total locks`);
      return expiredCount;
    } catch (error) {
      logger.error('Error cleaning up expired locks:', error);
      return 0;
    }
  }
}

module.exports = CacheService;
