/**
 * Nearby Service
 * Business logic for geolocation features
 * - Rate limiting
 * - Privacy filtering (coordinate obfuscation)
 * - Blocked user filtering
 * - Database persistence
 * - Redis GEO integration
 */

const redisGeoService = require('./redisGeoService');
const UserLocation = require('../models/userLocation');
const BlockedUser = require('../models/blockedUser');
const { query } = require('../config/postgres');
const logger = require('../utils/logger');

const RATE_LIMIT_SECONDS = 5;
const PRIVACY_DECIMAL_PLACES = 3; // 40.750° = ~111m accuracy

class NearbyService {
  constructor() {
    this.userUpdateTimes = new Map(); // Track last update per user
  }

  /**
   * Obfuscate coordinates for privacy
   * Rounds to 3 decimal places (~111m) and adds random noise
   */
  obfuscateCoordinates(latitude, longitude, accuracy) {
    // Round to 3 decimals (~111m)
    let lat = Math.round(latitude * 1000) / 1000;
    let lon = Math.round(longitude * 1000) / 1000;

    // Add noise: ±50-900m based on accuracy
    const noiseRange = Math.min(900, Math.max(50, accuracy * 1.5));
    const noiseLat = (Math.random() - 0.5) * (noiseRange / 111000);
    const noiseLon = (Math.random() - 0.5) * (noiseRange / 111000);

    lat += noiseLat;
    lon += noiseLon;

    return { latitude: lat, longitude: lon };
  }

  /**
   * Check rate limit for location updates (1 update per 5 seconds)
   */
  checkRateLimit(userId) {
    const now = Date.now();
    const lastUpdate = this.userUpdateTimes.get(userId) || 0;
    const timeSinceUpdate = (now - lastUpdate) / 1000;

    if (timeSinceUpdate < RATE_LIMIT_SECONDS) {
      const waitTime = Math.ceil(RATE_LIMIT_SECONDS - timeSinceUpdate);
      return {
        allowed: false,
        waitSeconds: waitTime
      };
    }

    this.userUpdateTimes.set(userId, now);
    return { allowed: true };
  }

  /**
   * Update user location
   * - Validates coordinates
   * - Enforces rate limiting
   * - Stores in PostgreSQL and Redis
   */
  async updateLocation(userId, latitude, longitude, accuracy, options = {}) {
    try {
      // Validate coordinates
      if (
        typeof latitude !== 'number' ||
        typeof longitude !== 'number' ||
        latitude < -90 ||
        latitude > 90 ||
        longitude < -180 ||
        longitude > 180
      ) {
        throw new Error('Invalid coordinates');
      }

      // Validate accuracy
      if (typeof accuracy !== 'number' || accuracy < 0 || accuracy > 10000) {
        throw new Error('Invalid accuracy (must be 0-10000 meters)');
      }

      // Check rate limit
      const rateLimitCheck = this.checkRateLimit(userId);
      if (!rateLimitCheck.allowed) {
        const error = new Error('Too many location updates');
        error.code = 'RATE_LIMITED';
        error.waitSeconds = rateLimitCheck.waitSeconds;
        throw error;
      }

      // Round coordinates to 3 decimals (~111m precision) for privacy BEFORE storage
      const roundedLatitude = Math.round(latitude * 1000) / 1000;
      const roundedLongitude = Math.round(longitude * 1000) / 1000;

      // Store in PostgreSQL (persistent)
      const userLocation = await UserLocation.upsert({
        user_id: userId,
        latitude: roundedLatitude,
        longitude: roundedLongitude,
        accuracy: Math.round(accuracy)
      });

      // Store in Redis GEO (for fast queries)
      await redisGeoService.updateUserLocation(
        userId,
        roundedLatitude,
        roundedLongitude,
        accuracy
      );

      logger.info(`✅ Location updated for user ${userId}`);

      return {
        success: true,
        user_id: userId,
        latitude: roundedLatitude,
        longitude: roundedLongitude,
        accuracy,
        timestamp: new Date(),
        stored_in: ['postgres', 'redis']
      };
    } catch (error) {
      logger.error(`❌ Failed to update location:`, error);
      throw error;
    }
  }

  /**
   * Search nearby users
   * - Uses Redis for fast queries
   * - Applies privacy filtering
   * - Filters blocked users
   * - Enriches with user profile data
   */
  async searchNearby(userId, latitude, longitude, radiusKm = 5, options = {}) {
    try {
      const {
        limit = 50,
        includeDistance = true
      } = options;

      // Validate coordinates
      if (
        latitude < -90 ||
        latitude > 90 ||
        longitude < -180 ||
        longitude > 180
      ) {
        throw new Error('Invalid search coordinates');
      }

      // Get blocked users (who blocked current user)
      const blockedUsers = await this.getBlockedUsers(userId);
      const blockedUserIds = blockedUsers.map(b => b.blocked_user_id);

      // Query nearby users from Redis
      const nearbyUsers = await redisGeoService.getNearbyUsers(
        latitude,
        longitude,
        radiusKm,
        {
          limit,
          excludeUsers: [userId, ...blockedUserIds]
        }
      );

      // Apply privacy filtering
      const privacyFiltered = nearbyUsers.map(user => {
        const { latitude: obfLat, longitude: obfLon } = this.obfuscateCoordinates(
          user.latitude,
          user.longitude,
          user.accuracy
        );

        return {
          user_id: user.user_id,
          latitude: obfLat,
          longitude: obfLon,
          accuracy_estimate: this.getAccuracyEstimate(user.accuracy),
          distance_km: includeDistance ? user.distance_km : undefined,
          distance_m: includeDistance ? user.distance_m : undefined,
          status: 'online',
          last_update: user.last_update
        };
      });

      // Enrich with username / first_name from PostgreSQL
      if (privacyFiltered.length > 0) {
        const userIds = privacyFiltered.map(u => u.user_id);
        try {
          const profileResult = await query(
            `SELECT id, username, first_name FROM users WHERE id = ANY($1)`,
            [userIds]
          );
          const profileMap = {};
          profileResult.rows.forEach(r => { profileMap[r.id] = r; });
          privacyFiltered.forEach(u => {
            const p = profileMap[u.user_id];
            if (p) {
              u.username = p.username || null;
              u.name = p.first_name || null;
            }
          });
        } catch (err) {
          logger.warn('Failed to enrich nearby users with profiles:', err.message);
        }
      }

      logger.info(`✅ Found ${privacyFiltered.length} nearby users for ${userId}`);

      return {
        success: true,
        total: privacyFiltered.length,
        radius_km: radiusKm,
        users: privacyFiltered,
        center: { latitude, longitude },
        privacy_level: 'high' // Coordinates obfuscated
      };
    } catch (error) {
      logger.error(`❌ Failed to search nearby users:`, error);
      throw error;
    }
  }

  /**
   * Get accuracy estimate (don't expose exact accuracy for privacy)
   */
  getAccuracyEstimate(accuracy) {
    if (accuracy < 10) return 'excellent';
    if (accuracy < 50) return 'good';
    if (accuracy < 100) return 'fair';
    if (accuracy < 500) return 'poor';
    return 'very_poor';
  }

  /**
   * Get users who have blocked this user
   */
  async getBlockedUsers(userId) {
    try {
      return await BlockedUser.getBlockedByUser(userId);
    } catch (error) {
      logger.warn(`⚠️ Failed to get blocked users:`, error);
      return [];
    }
  }

  /**
   * Clear user location (when they go offline)
   */
  async clearLocation(userId) {
    try {
      // Remove from Redis
      await redisGeoService.removeUser(userId);

      // Mark as offline in PostgreSQL (optional - keep history)
      await UserLocation.markOffline(userId);

      logger.info(`👋 Location cleared for user ${userId}`);

      return { success: true };
    } catch (error) {
      logger.error(`❌ Failed to clear location:`, error);
      throw error;
    }
  }

  /**
   * Get statistics
   */
  async getStats() {
    try {
      const onlineCount = await redisGeoService.getOnlineCount();
      const totalLocations = await UserLocation.count() || 0;

      return {
        online_users: onlineCount,
        total_tracked: totalLocations,
        rate_limited_users: this.userUpdateTimes.size
      };
    } catch (error) {
      logger.error(`❌ Failed to get stats:`, error);
      return {};
    }
  }
}

module.exports = new NearbyService();
