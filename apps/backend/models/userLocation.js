/**
 * UserLocation Model
 * Stores current user locations for geolocation features
 */

const { query } = require('../config/postgres');
const logger = require('../utils/logger');

class UserLocation {
  /**
   * Upsert user location — insert or update on conflict
   */
  static async upsert(data) {
    const { user_id, latitude, longitude, accuracy } = data;
    const result = await query(
      `INSERT INTO user_locations (user_id, latitude, longitude, accuracy, is_online, last_seen, updated_at)
       VALUES ($1, $2, $3, $4, true, NOW(), NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         latitude   = EXCLUDED.latitude,
         longitude  = EXCLUDED.longitude,
         accuracy   = EXCLUDED.accuracy,
         is_online  = true,
         last_seen  = NOW(),
         updated_at = NOW()
       RETURNING *`,
      [user_id, latitude, longitude, accuracy]
    );
    return result.rows[0];
  }

  /**
   * Mark user offline
   */
  static async markOffline(userId) {
    await query(
      `UPDATE user_locations SET is_online = false, last_seen = NOW() WHERE user_id = $1`,
      [userId]
    );
  }

  /**
   * Count total tracked locations
   */
  static async count() {
    const result = await query(`SELECT COUNT(*) FROM user_locations`);
    return parseInt(result.rows[0].count, 10);
  }

  /**
   * Get nearby users using bounding box + Haversine (no PostGIS needed)
   */
  static async getNearbyUsers(latitude, longitude, radiusKm = 5, limit = 50, excludeUserIds = []) {
    const lat = parseFloat(latitude);
    const lon = parseFloat(longitude);
    const latDelta = radiusKm / 111;
    const lngDelta = radiusKm / (111 * Math.cos(lat * Math.PI / 180));
    // Include online users AND offline users seen within the last year
    // so the map shows everyone who has shared a location, regardless of online state
    const excludeClause = excludeUserIds.length
      ? `AND ul.user_id != ALL($8::text[])`
      : '';
    const params = [lat, lon, lat - latDelta, lat + latDelta, lon - lngDelta, lon + lngDelta, limit];
    if (excludeUserIds.length) params.push(excludeUserIds);
    const result = await query(
      `SELECT
         ul.user_id,
         ul.latitude,
         ul.longitude,
         ul.accuracy,
         ul.is_online,
         ul.last_seen,
         u.first_name,
         u.username,
         u.photo_file_id,
         u.privacy,
         (6371 * acos(
           LEAST(1, cos(radians($1)) * cos(radians(ul.latitude))
           * cos(radians(ul.longitude) - radians($2))
           + sin(radians($1)) * sin(radians(ul.latitude)))
         )) AS distance_km
       FROM user_locations ul
       JOIN users u ON ul.user_id = u.id
       WHERE ul.last_seen > NOW() - INTERVAL '365 days'
         AND ul.latitude BETWEEN $3 AND $4
         AND ul.longitude BETWEEN $5 AND $6
         ${excludeClause}
       ORDER BY ul.is_online DESC, distance_km ASC
       LIMIT $7`,
      params
    );
    return result.rows;
  }

  /**
   * Get user location by user ID
   */
  static async getByUserId(userId) {
    const result = await query(
      `SELECT user_id, latitude, longitude, accuracy, is_online, last_seen
       FROM user_locations WHERE user_id = $1`,
      [userId]
    );
    return result.rows[0] || null;
  }

  /**
   * Clear old offline locations
   */
  static async clearOldLocations(hoursOld = 24) {
    const result = await query(
      `DELETE FROM user_locations
       WHERE is_online = false
         AND last_seen < NOW() - INTERVAL '${parseInt(hoursOld, 10)} hours'`,
      []
    );
    return result.rowCount;
  }
}

module.exports = UserLocation;
