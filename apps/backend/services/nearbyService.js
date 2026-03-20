/**
 * Nearby Service
 * Business logic for geolocation features
 * - Rate limiting
 * - Privacy filtering (coordinate obfuscation)
 * - Blocked user filtering
 * - Database persistence
 * - Redis GEO integration
 */

const crypto = require('crypto');
const redisGeoService = require('./redisGeoService');
const UserLocation = require('../models/userLocation');
const BlockedUser = require('../models/blockedUser');
const { query } = require('../config/postgres');
const logger = require('../utils/logger');

const RATE_LIMIT_SECONDS = 5;
const PRIVACY_DECIMAL_PLACES = 3; // 40.750° = ~111m accuracy

// GEO_HMAC_SECRET — dedicated secret for coordinate offset derivation.
// Falls back to SESSION_SECRET if not set. Set this var in .env for
// best security hygiene (rotating it will shift all user offsets at once).
const GEO_HMAC_SECRET = process.env.GEO_HMAC_SECRET || process.env.SESSION_SECRET || 'pnptv-geo-fallback';

/**
 * Generates a deterministic coordinate offset using HMAC-SHA256.
 * Same user gets the same offset for the entire UTC day — prevents
 * triangulation attacks from multiple requests while keeping a user's
 * apparent position stable within a session.
 *
 * Offset is keyed on the TARGET user's ID (not the viewer), so every
 * caller sees the same displaced position for a given user on a given day.
 *
 * @param {string|number} userId     - ID of the user whose location is being obfuscated
 * @param {number}        radiusMeters - Maximum offset radius (100–500m, default 100m)
 * @returns {{ latOffset: number, lngOffset: number }}
 */
function getDeterministicOffset(userId, radiusMeters = 100) {
  // Clamp radius: minimum 100m, maximum 500m
  const clampedRadius = Math.min(500, Math.max(100, radiusMeters));

  // Daily salt rotates at midnight UTC — YYYY-MM-DD
  const daySalt = new Date().toISOString().slice(0, 10);

  const hmac = crypto.createHmac('sha256', GEO_HMAC_SECRET);
  hmac.update(`${userId}:${daySalt}`);
  const hash = hmac.digest();

  // Use bytes 0–3 for the directional angle and bytes 4–7 for the radius magnitude.
  // UInt32BE normalised to [0, 1) gives uniform distribution without modulo bias.
  const angle = (hash.readUInt32BE(0) / 0xFFFFFFFF) * 2 * Math.PI;
  const radiusFraction = hash.readUInt32BE(4) / 0xFFFFFFFF; // [0, 1)
  const radius = radiusFraction * clampedRadius;

  // Convert meters to approximate degree offsets.
  // For longitude, we use cos(0) = 1 as a global approximation — good enough
  // for the 100–500m distances involved here (max ~0.0045°).
  const latOffset = (radius * Math.cos(angle)) / 111320;
  const lngOffset = (radius * Math.sin(angle)) / 111320;

  return { latOffset, lngOffset };
}

class NearbyService {
  constructor() {
    this.userUpdateTimes = new Map(); // Track last update per user
  }

  /**
   * Obfuscate coordinates for privacy using a deterministic HMAC-based offset.
   * The offset is stable for a given (userId, UTC day) pair, preventing
   * triangulation attacks from multiple simultaneous API calls.
   *
   * NEVER call this on coordinates destined for the DB or Redis — apply only
   * at the response layer.
   *
   * @param {string|number} userId       - Target user's ID (offset is keyed on this)
   * @param {number}        latitude     - Raw latitude
   * @param {number}        longitude    - Raw longitude
   * @param {number}        privacyRadius - Max offset radius in metres (100–500, default 100)
   * @returns {{ latitude: number, longitude: number }}
   */
  obfuscateCoordinates(userId, latitude, longitude, privacyRadius = 100) {
    // Round to 3 decimal places (~111m grid) first to remove sub-grid precision
    const lat = Math.round(latitude * 1000) / 1000;
    const lon = Math.round(longitude * 1000) / 1000;

    const { latOffset, lngOffset } = getDeterministicOffset(userId, privacyRadius);

    return {
      latitude: lat + latOffset,
      longitude: lon + lngOffset,
    };
  }

  /**
   * Extract privacy_radius from a user's privacy JSONB field.
   * Returns a value clamped to [100, 500] metres.
   *
   * @param {object|string|null} privacyJson - The raw privacy column value
   * @returns {number} radius in metres
   */
  resolvePrivacyRadius(privacyJson) {
    try {
      const parsed = typeof privacyJson === 'string' ? JSON.parse(privacyJson) : privacyJson;
      if (parsed && typeof parsed.privacy_radius === 'number') {
        return Math.min(500, Math.max(100, parsed.privacy_radius));
      }
    } catch (_) {
      // Malformed JSON — fall through to default
    }
    return 100;
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

      // Emit real-time nearby event to grid room
      try {
        const io = require('../bot/services/socketSingleton').get();
        if (io) {
          const gridLat = Math.floor(roundedLatitude * 10) / 10;
          const gridLng = Math.floor(roundedLongitude * 10) / 10;
          const room = `nearby:${gridLat}:${gridLng}`;
          io.to(room).emit('nearby:location-updated', {
            user_id: userId,
            updated_at: Date.now(),
          });
        }
      } catch (ioErr) {
        // Non-fatal — real-time push is best-effort
      }

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
      if (error.code !== 'RATE_LIMITED') {
        logger.error(`❌ Failed to update location:`, error);
      }
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

      const excludeSet = new Set([String(userId), ...blockedUserIds.map(String)]);

      // ── Step 1: online users from Redis (fast, exact positions) ──────────
      const redisUsers = await redisGeoService.getNearbyUsers(
        latitude, longitude, radiusKm,
        { limit, excludeUsers: [userId, ...blockedUserIds] }
      );

      const onlineIds = new Set(redisUsers.map(u => String(u.user_id)));

      // For online users, store raw coords temporarily — obfuscation with the
      // correct per-user privacy_radius is applied after profile enrichment below.
      const privacyFiltered = redisUsers.map(user => ({
        user_id: user.user_id,
        _raw_lat: user.latitude,
        _raw_lng: user.longitude,
        latitude: null,   // filled in after enrichment
        longitude: null,  // filled in after enrichment
        _privacy_radius: 100, // updated after enrichment
        accuracy_estimate: this.getAccuracyEstimate(user.accuracy),
        distance_km: includeDistance ? user.distance_km : undefined,
        distance_m: includeDistance ? user.distance_m : undefined,
        status: 'online',
        last_update: user.last_update,
        last_seen: null,
      }));

      // ── Step 2: recently-offline users from PostgreSQL (last 72 h) ───────
      // This ensures the map is never empty just because no one has the app open
      try {
        const excludeIds = [...excludeSet, ...onlineIds];
        const offlineRows = await UserLocation.getNearbyUsers(
          latitude, longitude, radiusKm, limit, excludeIds
        );
        for (const row of offlineRows) {
          if (excludeSet.has(String(row.user_id)) || onlineIds.has(String(row.user_id))) continue;
          const privacyRadius = this.resolvePrivacyRadius(row.privacy || null);
          const { latitude: obfLat, longitude: obfLon } = this.obfuscateCoordinates(
            row.user_id, parseFloat(row.latitude), parseFloat(row.longitude), privacyRadius
          );
          privacyFiltered.push({
            user_id: row.user_id,
            latitude: obfLat,
            longitude: obfLon,
            accuracy_estimate: this.getAccuracyEstimate(row.accuracy || 100),
            distance_km: includeDistance ? parseFloat(row.distance_km) : undefined,
            distance_m: includeDistance ? parseFloat(row.distance_km) * 1000 : undefined,
            status: row.is_online ? 'online' : 'offline',
            last_update: row.last_seen ? new Date(row.last_seen).toISOString() : null,
            last_seen: row.last_seen ? new Date(row.last_seen).toISOString() : null,
            username: row.username || null,
            name: row.first_name || null,
            photo_url: (row.photo_file_id && (row.photo_file_id.startsWith('/') || row.photo_file_id.startsWith('http')))
              ? row.photo_file_id : null,
          });
        }
      } catch (offlineErr) {
        logger.warn(`Failed to load offline nearby users: ${offlineErr.message}`);
      }

      // ── Step 3: Enrich online users with profile data from PostgreSQL ────
      // Also fetch `privacy` so we can apply the correct privacy_radius offset.
      const onlineFiltered = privacyFiltered.filter(u => u.status === 'online' && !u.username);
      if (onlineFiltered.length > 0) {
        const userIds = onlineFiltered.map(u => u.user_id);
        try {
          const profileResult = await query(
            `SELECT id, username, first_name, photo_file_id, privacy FROM users WHERE id = ANY($1)`,
            [userIds]
          );
          const profileMap = {};
          profileResult.rows.forEach(r => { profileMap[r.id] = r; });
          onlineFiltered.forEach(u => {
            const p = profileMap[u.user_id];
            if (p) {
              u.username = p.username || null;
              u.name = p.first_name || null;
              const photo = p.photo_file_id || null;
              u.photo_url = (photo && (photo.startsWith('/') || photo.startsWith('http'))) ? photo : null;
              u._privacy_radius = this.resolvePrivacyRadius(p.privacy);
            }
          });
        } catch (err) {
          logger.warn(`Failed to enrich nearby users with profiles: ${err.message}`);
        }
      }

      // ── Apply HMAC obfuscation to all online users (after enrichment) ────
      // This runs after enrichment so we have the correct privacy_radius per user.
      privacyFiltered.forEach(u => {
        if (u._raw_lat !== undefined && u._raw_lng !== undefined) {
          const { latitude: obfLat, longitude: obfLon } = this.obfuscateCoordinates(
            u.user_id, u._raw_lat, u._raw_lng, u._privacy_radius || 100
          );
          u.latitude = obfLat;
          u.longitude = obfLon;
          // Remove internal staging fields — never expose them to the frontend
          delete u._raw_lat;
          delete u._raw_lng;
          delete u._privacy_radius;
        }
      });

      // Followers-first ordering: show followed users at the top
      try {
        const followRes = await query(
          'SELECT following_id FROM user_follows WHERE follower_id=$1',
          [userId]
        );
        const followedIds = new Set(followRes.rows.map(r => String(r.following_id)));
        privacyFiltered.forEach(u => {
          u.is_followed = followedIds.has(String(u.user_id));
        });
        privacyFiltered.sort((a, b) => {
          const aF = a.is_followed ? 0 : 1;
          const bF = b.is_followed ? 0 : 1;
          if (aF !== bF) return aF - bF;
          return (a.distance_km ?? 999) - (b.distance_km ?? 999);
        });
      } catch (err) {
        logger.warn(`Failed to apply followers-first sorting: ${err.message}`);
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
