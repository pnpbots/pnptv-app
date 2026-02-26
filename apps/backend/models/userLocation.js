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
   * Get nearby users using PostGIS
   */
  static async getNearbyUsers(latitude, longitude, radiusKm = 5, limit = 50) {
    const result = await query(
      `SELECT
         ul.user_id,
         ul.latitude,
         ul.longitude,
         ul.accuracy,
         ul.is_online,
         u.first_name,
         u.username,
         u.photo_file_id,
         ST_Distance(
           ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
           ul.geom::geography
         ) / 1000 AS distance_km
       FROM user_locations ul
       JOIN users u ON ul.user_id = u.id
       WHERE ul.is_online = true
         AND ST_DWithin(
           ul.geom::geography,
           ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
           $3 * 1000
         )
       ORDER BY distance_km ASC
       LIMIT $4`,
      [parseFloat(latitude), parseFloat(longitude), radiusKm, limit]
    );
    return result.rows;
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
