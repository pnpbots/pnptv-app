const logger = require('../../../utils/logger');
const performanceMonitor = require('../../../utils/performanceMonitor');
const { getPool, getQueryCacheStats } = require('../../../config/postgres');
const { cache } = require('../../../config/redis');

/**
 * Health check controller
 */
class HealthController {
  /**
   * Basic health check endpoint
   * @param {Object} req - Express request
   * @param {Object} res - Express response
   */
  static async healthCheck(req, res) {
    try {
      const startTime = process.hrtime();
      
      // Check database connection
      let dbStatus = 'unknown';
      let redisStatus = 'unknown';
      
      try {
        const pool = getPool();
        if (pool) {
          const client = await pool.connect();
          await client.query('SELECT 1');
          client.release();
          dbStatus = 'healthy';
        }
      } catch (dbError) {
        dbStatus = `unhealthy: ${dbError.message}`;
      }

      // Check Redis connection
      try {
        if (cache && typeof cache.get === 'function') {
          await cache.get('health_check_test');
          redisStatus = 'healthy';
        }
      } catch (redisError) {
        redisStatus = `unhealthy: ${redisError.message}`;
      }

      const diff = process.hrtime(startTime);
      const responseTimeMs = (diff[0] * 1000) + (diff[1] / 1000000);

      const healthData = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage(),
        database: dbStatus,
        redis: redisStatus,
        responseTimeMs,
        nodeVersion: process.version,
        performanceMetrics: performanceMonitor.getAllMetrics(),
        queryCache: getQueryCacheStats()
      };

      res.status(200).json(healthData);
    } catch (error) {
      logger.error('Health check failed:', error);
      res.status(503).json({
        status: 'unhealthy',
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Detailed performance metrics endpoint
   * @param {Object} req - Express request
   * @param {Object} res - Express response
   */
  static async performanceMetrics(req, res) {
    try {
      const metrics = performanceMonitor.getAllMetrics();
      
      res.status(200).json({
        status: 'success',
        timestamp: new Date().toISOString(),
        metrics,
        process: {
          uptime: process.uptime(),
          memoryUsage: process.memoryUsage(),
          cpuUsage: process.cpuUsage()
        }
      });
    } catch (error) {
      logger.error('Failed to get performance metrics:', error);
      res.status(500).json({
        status: 'error',
        error: error.message
      });
    }
  }

  /**
   * Reset performance metrics
   * @param {Object} req - Express request
   * @param {Object} res - Express response
   */
  static async resetMetrics(req, res) {
    try {
      performanceMonitor.reset();
      res.status(200).json({
        status: 'success',
        message: 'Performance metrics reset successfully'
      });
    } catch (error) {
      logger.error('Failed to reset metrics:', error);
      res.status(500).json({
        status: 'error',
        error: error.message
      });
    }
  }
}

module.exports = HealthController;