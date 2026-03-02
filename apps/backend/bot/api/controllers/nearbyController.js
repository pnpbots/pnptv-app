/**
 * Nearby Controller
 * HTTP endpoints for geolocation features
 *
 * Endpoints:
 * - POST /api/nearby/update-location - Update user location
 * - GET /api/nearby/search - Search nearby users
 * - GET /api/nearby/places - Search nearby places/businesses
 * - GET /api/nearby/stats - Get geolocation stats
 * - POST /api/nearby/clear - Clear user location
 */

const nearbyService = require('../../../services/nearbyService');
const NearbyPlaceModel = require('../../../models/nearbyPlaceModel');
const { validateToken } = require('../middleware/auth');
const logger = require('../../../utils/logger');
const { query: dbQuery } = require('../../../config/postgres');

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
        const uid = req.userId || req.user?.id || 'unknown';
        logger.warn(`⚠️ Rate limit exceeded for user ${uid}`);
        return res.status(429).json({
          error: 'Too many location updates',
          retry_after: error.waitSeconds,
          message: `Please wait ${error.waitSeconds}s before updating again`
        });
      }

      // Handle validation errors
      if (error.message && error.message.includes('Invalid')) {
        return res.status(400).json({ error: 'Invalid location parameters' });
      }

      logger.error('❌ Update location error:', error);
      return res.status(500).json({
        error: 'Failed to update location'
      });
    }
  }

  /**
   * GET /api/nearby/search
   * Search for nearby users — tier-gated response
   */
  static async searchNearby(req, res) {
    try {
      // Verify authentication
      const userId = req.userId || req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      // Determine tier and admin bypass
      const tier = (req.session?.user?.tier || 'free').toLowerCase();
      const role = req.session?.user?.role || '';
      const isAdmin = role === 'admin' || role === 'superadmin';
      const effectiveTier = isAdmin ? 'prime' : tier;

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
      const rad = Math.min(parseFloat(radius) || 25, 50);

      if (isNaN(lat) || isNaN(lon) || isNaN(rad)) {
        return res.status(400).json({
          error: 'Invalid parameter values: latitude, longitude, radius must be numbers'
        });
      }

      // Free tier: count-only response
      if (effectiveTier === 'free') {
        const countResult = await NearbyController._countNearby(userId, lat, lon, rad);
        return res.status(200).json({
          success: true,
          tier: 'free',
          count: countResult,
          upgradeMessage: 'Upgrade to Member to see who is nearby',
        });
      }

      // Run full search
      const result = await nearbyService.searchNearby(
        userId,
        lat,
        lon,
        rad,
        { limit: Math.min(parseInt(limit) || 50, 200) }
      );

      // Member tier: strip sensitive fields (distance, photo URL, lastName)
      if (effectiveTier === 'member') {
        const blurredUsers = (result.users || []).map(u => ({
          id: u.user_id,
          firstName: u.name || null,
          blurredPhoto: true,
        }));
        return res.status(200).json({
          success: true,
          tier: 'member',
          total: blurredUsers.length,
          radius_km: rad,
          users: blurredUsers,
        });
      }

      // Prime / admin: full response
      return res.status(200).json({
        success: true,
        tier: effectiveTier,
        ...result,
      });
    } catch (error) {
      // Handle validation errors
      if (error.message && error.message.includes('Invalid')) {
        return res.status(400).json({ error: 'Invalid search parameters' });
      }

      logger.error('❌ Search nearby error:', error);
      return res.status(500).json({
        error: 'Failed to search nearby users'
      });
    }
  }

  /**
   * Count nearby users in the DB using the user_locations table.
   * Uses PostGIS ST_DWithin for accuracy. Returns an integer count.
   * Excludes the requesting user. Used for free-tier gated response.
   */
  static async _countNearby(userId, lat, lon, radiusKm) {
    try {
      const radiusMeters = radiusKm * 1000;
      const { rows } = await dbQuery(
        `SELECT COUNT(*)::int as count
         FROM user_locations ul
         WHERE ul.user_id != $1
           AND ul.updated_at > NOW() - INTERVAL '30 minutes'
           AND ST_DWithin(
             ul.location::geography,
             ST_MakePoint($3, $2)::geography,
             $4
           )`,
        [userId, lat, lon, radiusMeters]
      );
      return rows[0]?.count || 0;
    } catch (err) {
      logger.error('❌ _countNearby error:', err);
      return 0;
    }
  }

  /**
   * GET /api/nearby/places
   * Search for nearby places / businesses / sites
   */
  static async searchNearbyPlaces(req, res) {
    try {
      const userId = req.userId || req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const { latitude, longitude, radius = 10 } = req.query;

      if (!latitude || !longitude) {
        return res.status(400).json({
          error: 'Missing required parameters: latitude, longitude'
        });
      }

      const lat = parseFloat(latitude);
      const lng = parseFloat(longitude);
      const rad = parseFloat(radius);

      if (isNaN(lat) || isNaN(lng) || isNaN(rad)) {
        return res.status(400).json({
          error: 'Invalid parameter values: latitude, longitude, radius must be numbers'
        });
      }

      const places = await NearbyPlaceModel.getNearby(
        { lat, lng },
        Math.min(rad, 50)
      );

      return res.status(200).json({
        success: true,
        total: places.length,
        radius_km: rad,
        places,
      });
    } catch (error) {
      logger.error('❌ Search nearby places error:', error);
      return res.status(500).json({
        error: 'Failed to search nearby places'
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
        error: 'Failed to get statistics'
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
        error: 'Failed to clear location'
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
            error: 'Update failed'
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
        error: 'Batch update failed'
      });
    }
  }
}

module.exports = NearbyController;
