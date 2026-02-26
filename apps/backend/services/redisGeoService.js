/**
 * Redis Geolocation Service
 * Manages online user locations in Redis using GEO commands
 * Fast in-memory geospatial queries (~50ms)
 *
 * Key design:
 * - Set name: "geo:users:online" (ZSET with geohashes)
 * - Per-user data: hash "geo:user:{userId}" (latitude, longitude, accuracy, timestamp)
 */

const logger = require('../utils/logger');

class RedisGeoService {
  constructor() {
    this.redis = null;
    this.geoKey = 'geo:users:online';
    this.timeout = 5 * 60 * 1000; // 5 minutes before user goes offline
  }

  /**
   * Initialize Redis connection
   */
  async initialize(redisClient) {
    try {
      this.redis = redisClient;
      logger.info('✅ RedisGeoService initialized');
    } catch (error) {
      logger.error('❌ Redis initialization failed:', error);
      throw error;
    }
  }

  /**
   * Add or update user location
   * @param {string} userId - User ID (UUID or Telegram ID)
   * @param {number} latitude - GPS latitude
   * @param {number} longitude - GPS longitude
   * @param {number} accuracy - GPS accuracy in meters
   */
  async updateUserLocation(userId, latitude, longitude, accuracy) {
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
      if (accuracy < 0 || accuracy > 10000) {
        throw new Error('Invalid accuracy (must be 0-10000)');
      }

      // Store in GEO set (for spatial queries)
      await this.redis.geoadd(this.geoKey, longitude, latitude, userId);

      // Store user metadata in hash
      const userKey = `geo:user:${userId}`;
      await this.redis.hset(userKey, {
        latitude: latitude.toString(),
        longitude: longitude.toString(),
        accuracy: Math.round(accuracy).toString(),
        timestamp: Date.now().toString(),
        last_update: new Date().toISOString()
      });

      // Set expiration (5 minutes)
      await this.redis.expire(userKey, 300);
      await this.redis.expire(this.geoKey, 300);

      logger.debug(`🔴 User ${userId} location updated: ${latitude}, ${longitude}`);

      return {
        success: true,
        userId,
        latitude,
        longitude,
        accuracy
      };
    } catch (error) {
      logger.error(`❌ Failed to update user location:`, error);
      throw error;
    }
  }

  /**
   * Get nearby users within radius
   * @param {number} latitude - Center latitude
   * @param {number} longitude - Center longitude
   * @param {number} radiusKm - Search radius in kilometers
   * @param {Object} options - Additional options (limit, excludeUsers, etc)
   * @returns {Array} Nearby users
   */
  async getNearbyUsers(latitude, longitude, radiusKm = 5, options = {}) {
    try {
      const {
        limit = 50,
        excludeUsers = [],
        unit = 'km'
      } = options;

      // Validate inputs
      if (radiusKm < 0.1 || radiusKm > 100) {
        throw new Error('Radius must be between 0.1 and 100 km');
      }

      // Query Redis GEO — ioredis positional-arg style with WITHCOORD + WITHDIST
      // Returns: [['member', 'distance_str', ['lon_str', 'lat_str']], ...]
      const results = await this.redis.georadius(
        this.geoKey,
        longitude,
        latitude,
        radiusKm,
        unit.toLowerCase(),
        'WITHCOORD',
        'WITHDIST',
        'COUNT',
        limit,
        'ASC'
      );

      // Fetch user metadata for each result
      const nearbyUsers = [];
      for (const result of results) {
        // ioredis returns [member, distance, [lon, lat]] when both WITHCOORD and WITHDIST are set
        const userId = Array.isArray(result) ? result[0] : result;
        const distanceStr = Array.isArray(result) ? result[1] : '0';
        const coords = Array.isArray(result) && Array.isArray(result[2]) ? result[2] : null;

        // Skip excluded users
        if (excludeUsers.includes(userId)) continue;

        // Get user metadata (accurate coords + accuracy + timestamp)
        const userKey = `geo:user:${userId}`;
        const userData = await this.redis.hgetall(userKey);

        const distKm = parseFloat(distanceStr) || 0;

        nearbyUsers.push({
          user_id: userId,
          latitude: userData && userData.latitude ? parseFloat(userData.latitude) : (coords ? parseFloat(coords[1]) : 0),
          longitude: userData && userData.longitude ? parseFloat(userData.longitude) : (coords ? parseFloat(coords[0]) : 0),
          accuracy: userData && userData.accuracy ? parseInt(userData.accuracy) : 0,
          distance_km: distKm,
          distance_m: Math.round(distKm * 1000),
          last_update: (userData && userData.last_update) || null,
          status: 'online'
        });
      }

      logger.debug(`✅ Found ${nearbyUsers.length} nearby users within ${radiusKm}km`);

      return nearbyUsers;
    } catch (error) {
      logger.error(`❌ Failed to get nearby users:`, error);
      throw error;
    }
  }

  /**
   * Get user location
   * @param {string} userId - User ID
   */
  async getUserLocation(userId) {
    try {
      const userKey = `geo:user:${userId}`;
      const userData = await this.redis.hgetall(userKey);

      if (!userData || !userData.latitude) {
        return null;
      }

      return {
        user_id: userId,
        latitude: parseFloat(userData.latitude),
        longitude: parseFloat(userData.longitude),
        accuracy: parseInt(userData.accuracy) || 0,
        timestamp: parseInt(userData.timestamp) || null,
        last_update: userData.last_update || null
      };
    } catch (error) {
      logger.error(`❌ Failed to get user location:`, error);
      throw error;
    }
  }

  /**
   * Remove user from online list
   * @param {string} userId - User ID
   */
  async removeUser(userId) {
    try {
      await this.redis.zrem(this.geoKey, userId);
      await this.redis.del(`geo:user:${userId}`);

      logger.debug(`👋 User ${userId} removed from online list`);

      return { success: true };
    } catch (error) {
      logger.error(`❌ Failed to remove user:`, error);
      throw error;
    }
  }

  /**
   * Get number of online users
   */
  async getOnlineCount() {
    try {
      const count = await this.redis.zcard(this.geoKey);
      return count || 0;
    } catch (error) {
      logger.error(`❌ Failed to get online count:`, error);
      return 0;
    }
  }

  /**
   * Get all online users (careful with large datasets)
   * @param {number} limit - Maximum number of users
   */
  async getAllOnlineUsers(limit = 1000) {
    try {
      const userIds = await this.redis.zrange(this.geoKey, 0, limit - 1);

      const users = [];
      for (const userId of userIds) {
        const location = await this.getUserLocation(userId);
        if (location) {
          users.push({
            ...location,
            status: 'online'
          });
        }
      }

      return users;
    } catch (error) {
      logger.error(`❌ Failed to get all online users:`, error);
      return [];
    }
  }

  /**
   * Cleanup expired users
   * Redis handles TTL automatically, but this can be called manually
   */
  async cleanupExpired() {
    try {
      const beforeCount = await this.getOnlineCount();

      // Redis TTL will handle cleanup automatically
      // This is just for monitoring/logging

      const afterCount = await this.getOnlineCount();
      const removed = beforeCount - afterCount;

      if (removed > 0) {
        logger.info(`🧹 Cleaned up ${removed} expired user locations`);
      }

      return { removed };
    } catch (error) {
      logger.error(`❌ Failed to cleanup expired users:`, error);
      throw error;
    }
  }

  /**
   * Calculate distance between two points (Haversine formula)
   */
  static calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth radius in km
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }
}

module.exports = new RedisGeoService();
