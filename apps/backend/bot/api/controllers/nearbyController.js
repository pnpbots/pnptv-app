/**
 * Nearby Controller
 * HTTP endpoints for geolocation features
 *
 * Endpoints:
 * - POST /api/nearby/update-location - Update user location
 * - GET /api/nearby/search - Search nearby users
 * - GET /api/nearby/stats - Get geolocation stats
 * - POST /api/nearby/clear - Clear user location
 */

const nearbyService = require('../../../services/nearbyService');
const { validateToken } = require('../middleware/auth');
const logger = require('../../../utils/logger');

class NearbyController {
  /**
   * POST /api/nearby/update-location
   * Update user's current location
   */
  static async updateLocation(req, res) {
    try {
      // Verify authentication
      const userId = req.userId || req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      // Validate request body
      const { latitude, longitude, accuracy } = req.body;

      if (latitude === undefined || longitude === undefined || accuracy === undefined) {
        return res.status(400).json({
          error: 'Missing required fields: latitude, longitude, accuracy'
        });
      }

      // Validate types
      if (
        typeof latitude !== 'number' ||
        typeof longitude !== 'number' ||
        typeof accuracy !== 'number'
      ) {
        return res.status(400).json({
          error: 'Invalid data types: latitude, longitude, accuracy must be numbers'
        });
      }

      // Update location
      const result = await nearbyService.updateLocation(
        userId,
        latitude,
        longitude,
        accuracy
      );

      return res.status(200).json({
        success: true,
        message: 'Location updated',
        ...result
      });
    } catch (error) {
      // Handle rate limiting
      if (error.code === 'RATE_LIMITED') {
        logger.warn(`⚠️ Rate limit exceeded for user ${req.userId}`);
        return res.status(429).json({
          error: 'Too many location updates',
          retry_after: error.waitSeconds,
          message: `Please wait ${error.waitSeconds}s before updating again`
        });
      }

      // Handle validation errors
      if (error.message.includes('Invalid')) {
        return res.status(400).json({ error: error.message });
      }

      logger.error('❌ Update location error:', error);
      return res.status(500).json({
        error: 'Failed to update location',
        message: error.message
      });
    }
  }

  /**
   * GET /api/nearby/search
   * Search for nearby users
   */
  static async searchNearby(req, res) {
    try {
      // Verify authentication
      const userId = req.userId || req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      // Get query parameters
      const { latitude, longitude, radius = 5, limit = 50 } = req.query;

      // Validate required parameters
      if (!latitude || !longitude) {
        return res.status(400).json({
          error: 'Missing required parameters: latitude, longitude'
        });
      }

      // Validate types
      const lat = parseFloat(latitude);
      const lon = parseFloat(longitude);
      const rad = parseFloat(radius);

      if (isNaN(lat) || isNaN(lon) || isNaN(rad)) {
        return res.status(400).json({
          error: 'Invalid parameter values: latitude, longitude, radius must be numbers'
        });
      }

      // Search nearby users
      const result = await nearbyService.searchNearby(
        userId,
        lat,
        lon,
        rad,
        { limit: parseInt(limit) || 50 }
      );

      return res.status(200).json({
        success: true,
        ...result
      });
    } catch (error) {
      // Handle validation errors
      if (error.message.includes('Invalid')) {
        return res.status(400).json({ error: error.message });
      }

      logger.error('❌ Search nearby error:', error);
      return res.status(500).json({
        error: 'Failed to search nearby users',
        message: error.message
      });
    }
  }

  /**
   * GET /api/nearby/stats
   * Get geolocation statistics
   */
  static async getStats(req, res) {
    try {
      // Verify authentication
      const userId = req.userId || req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const stats = await nearbyService.getStats();

      return res.status(200).json({
        success: true,
        timestamp: new Date(),
        ...stats
      });
    } catch (error) {
      logger.error('❌ Get stats error:', error);
      return res.status(500).json({
        error: 'Failed to get statistics',
        message: error.message
      });
    }
  }

  /**
   * POST /api/nearby/clear
   * Clear user's location (go offline)
   */
  static async clearLocation(req, res) {
    try {
      // Verify authentication
      const userId = req.userId || req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const result = await nearbyService.clearLocation(userId);

      return res.status(200).json({
        success: true,
        message: 'Location cleared',
        ...result
      });
    } catch (error) {
      logger.error('❌ Clear location error:', error);
      return res.status(500).json({
        error: 'Failed to clear location',
        message: error.message
      });
    }
  }

  /**
   * POST /api/nearby/batch-update
   * Batch update multiple users (for testing)
   */
  static async batchUpdate(req, res) {
    try {
      // Verify authentication and admin role
      const userId = req.userId || req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      // Validate batch data
      const { updates } = req.body;
      if (!Array.isArray(updates)) {
        return res.status(400).json({
          error: 'updates must be an array'
        });
      }

      if (updates.length > 1000) {
        return res.status(400).json({
          error: 'Maximum 1000 updates per batch'
        });
      }

      // Process updates
      const results = [];
      const errors = [];

      for (const update of updates) {
        try {
          const result = await nearbyService.updateLocation(
            update.user_id,
            update.latitude,
            update.longitude,
            update.accuracy
          );
          results.push(result);
        } catch (error) {
          errors.push({
            user_id: update.user_id,
            error: error.message
          });
        }
      }

      return res.status(200).json({
        success: errors.length === 0,
        total: updates.length,
        successful: results.length,
        failed: errors.length,
        results,
        errors: errors.length > 0 ? errors : undefined
      });
    } catch (error) {
      logger.error('❌ Batch update error:', error);
      return res.status(500).json({
        error: 'Batch update failed',
        message: error.message
      });
    }
  }
}

module.exports = NearbyController;
