const { query } = require('../../config/postgres');
const logger = require('../../utils/logger');

/**
 * User Location Controller
 * Handles user location management for nearby features
 */

/**
 * Get user's current location
 * GET /api/webapp/profile/location
 */
async function getUserLocation(req, res) {
  try {
    const userId = req.session?.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Not authenticated'
      });
    }

    const result = await query(
      `SELECT
        latitude,
        longitude,
        accuracy,
        is_online,
        last_seen,
        updated_at
      FROM user_locations
      WHERE user_id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.json({
        success: true,
        location: null,
        message: 'Location not set'
      });
    }

    res.json({
      success: true,
      location: {
        latitude: parseFloat(result.rows[0].latitude),
        longitude: parseFloat(result.rows[0].longitude),
        accuracy: result.rows[0].accuracy,
        isOnline: result.rows[0].is_online,
        lastSeen: result.rows[0].last_seen,
        updatedAt: result.rows[0].updated_at
      }
    });

  } catch (error) {
    logger.error('Get user location error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get location'
    });
  }
}

/**
 * Update user's location
 * PUT /api/webapp/profile/location
 * Body: { latitude, longitude, accuracy?, isOnline? }
 */
async function updateUserLocation(req, res) {
  try {
    const userId = req.session?.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Not authenticated'
      });
    }

    const { latitude, longitude, accuracy = 0, isOnline = true } = req.body;

    // Validate required fields
    if (latitude === undefined || longitude === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Latitude and longitude are required'
      });
    }

    // Validate ranges
    const lat = parseFloat(latitude);
    const lon = parseFloat(longitude);
    const acc = parseInt(accuracy);

    if (isNaN(lat) || lat < -90 || lat > 90) {
      return res.status(400).json({
        success: false,
        error: 'Invalid latitude (must be between -90 and 90)'
      });
    }

    if (isNaN(lon) || lon < -180 || lon > 180) {
      return res.status(400).json({
        success: false,
        error: 'Invalid longitude (must be between -180 and 180)'
      });
    }

    if (isNaN(acc) || acc < 0 || acc > 10000) {
      return res.status(400).json({
        success: false,
        error: 'Invalid accuracy (must be between 0 and 10000 meters)'
      });
    }

    // Upsert location (insert or update if exists)
    const result = await query(
      `INSERT INTO user_locations (user_id, latitude, longitude, accuracy, is_online, last_seen)
      VALUES ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT (user_id)
      DO UPDATE SET
        latitude = EXCLUDED.latitude,
        longitude = EXCLUDED.longitude,
        accuracy = EXCLUDED.accuracy,
        is_online = EXCLUDED.is_online,
        last_seen = NOW(),
        updated_at = NOW()
      RETURNING
        latitude,
        longitude,
        accuracy,
        is_online,
        last_seen,
        updated_at`,
      [userId, lat, lon, acc, isOnline]
    );

    res.json({
      success: true,
      location: {
        latitude: parseFloat(result.rows[0].latitude),
        longitude: parseFloat(result.rows[0].longitude),
        accuracy: result.rows[0].accuracy,
        isOnline: result.rows[0].is_online,
        lastSeen: result.rows[0].last_seen,
        updatedAt: result.rows[0].updated_at
      }
    });

  } catch (error) {
    logger.error('Update user location error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update location'
    });
  }
}

/**
 * Delete user's location
 * DELETE /api/webapp/profile/location
 */
async function deleteUserLocation(req, res) {
  try {
    const userId = req.session?.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Not authenticated'
      });
    }

    await query(
      'DELETE FROM user_locations WHERE user_id = $1',
      [userId]
    );

    res.json({
      success: true,
      message: 'Location deleted'
    });

  } catch (error) {
    logger.error('Delete user location error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete location'
    });
  }
}

/**
 * Get nearby users
 * GET /api/webapp/users/nearby?radius=5000&limit=50
 * Query params: radius (meters), limit (max results)
 */
async function getNearbyUsers(req, res) {
  try {
    const userId = req.session?.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Not authenticated'
      });
    }

    const radius = parseInt(req.query.radius) || 5000; // 5km default
    const limit = Math.min(parseInt(req.query.limit) || 50, 100); // Max 100

    // Get user's location first
    const userLocation = await query(
      'SELECT latitude, longitude FROM user_locations WHERE user_id = $1',
      [userId]
    );

    if (userLocation.rows.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'User location not set'
      });
    }

    const { latitude: userLat, longitude: userLon } = userLocation.rows[0];

    // Find nearby users using Haversine formula
    // Distance in meters
    const result = await query(
      `SELECT
        u.id,
        u.username,
        u."firstName",
        u."photoUrl",
        ul.latitude,
        ul.longitude,
        ul.is_online,
        ul.last_seen,
        (
          6371000 * acos(
            cos(radians($2)) * cos(radians(ul.latitude)) *
            cos(radians(ul.longitude) - radians($3)) +
            sin(radians($2)) * sin(radians(ul.latitude))
          )
        ) AS distance
      FROM user_locations ul
      JOIN users u ON ul.user_id = u.id
      WHERE ul.user_id != $1
        AND ul.is_online = true
        AND ul.last_seen > NOW() - INTERVAL '1 hour'
        AND (
          6371000 * acos(
            cos(radians($2)) * cos(radians(ul.latitude)) *
            cos(radians(ul.longitude) - radians($3)) +
            sin(radians($2)) * sin(radians(ul.latitude))
          )
        ) <= $4
      ORDER BY distance ASC
      LIMIT $5`,
      [userId, userLat, userLon, radius, limit]
    );

    res.json({
      success: true,
      users: result.rows.map(row => ({
        id: row.id,
        username: row.username,
        firstName: row.firstName,
        photoUrl: row.photoUrl,
        distance: Math.round(row.distance), // meters
        isOnline: row.is_online,
        lastSeen: row.last_seen
      })),
      radius,
      count: result.rows.length
    });

  } catch (error) {
    logger.error('Get nearby users error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get nearby users'
    });
  }
}

module.exports = {
  getUserLocation,
  updateUserLocation,
  deleteUserLocation,
  getNearbyUsers
};
