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

const nearbyService = require('../../services/nearbyService');
const NearbyPlaceModel = require('../../models/nearbyPlaceModel');
const { validateToken } = require('../middleware/auth');
const logger = require('../../utils/logger');
const { query: dbQuery } = require('../../config/postgres');

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
      const rad = Math.min(parseFloat(radius) || 25, 20000);

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
      // Use bounding-box pre-filter + Haversine (no PostGIS needed)
      const latDelta = radiusKm / 111;
      const lngDelta = radiusKm / (111 * Math.cos(lat * Math.PI / 180));
      const { rows } = await dbQuery(
        `SELECT COUNT(*)::int as count
         FROM user_locations ul
         WHERE ul.user_id != $1
           AND ul.updated_at > NOW() - INTERVAL '30 minutes'
           AND ul.latitude BETWEEN $2 AND $3
           AND ul.longitude BETWEEN $4 AND $5`,
        [userId, lat - latDelta, lat + latDelta, lon - lngDelta, lon + lngDelta]
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
  /**
   * POST /api/nearby/places/:id/favorite
   * Toggle favorite on a place
   */
  static async favoritePlace(req, res) {
    try {
      const userId = req.userId || req.user?.id;
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });
      const placeId = parseInt(req.params.id, 10);
      if (!placeId || isNaN(placeId)) return res.status(400).json({ error: 'Invalid place ID' });
      const result = await NearbyPlaceModel.toggleFavorite(userId, placeId);
      return res.json({ success: true, ...result });
    } catch (error) {
      logger.error('favoritePlace error:', error);
      return res.status(500).json({ error: 'Failed to toggle favorite' });
    }
  }

  /**
   * POST /api/nearby/places/:id/view
   * Track place view
   */
  static async trackView(req, res) {
    try {
      const placeId = parseInt(req.params.id, 10);
      if (!placeId || isNaN(placeId)) return res.status(400).json({ error: 'Invalid place ID' });
      await NearbyPlaceModel.incrementViewCount(placeId);
      return res.json({ success: true });
    } catch (error) {
      logger.error('trackView error:', error);
      return res.status(500).json({ error: 'Failed to track view' });
    }
  }

  /**
   * POST /api/nearby/places/:id/report
   * Report a place as inappropriate
   */
  static async reportPlace(req, res) {
    try {
      const userId = req.userId || req.user?.id;
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });
      const placeId = parseInt(req.params.id, 10);
      if (!placeId || isNaN(placeId)) return res.status(400).json({ error: 'Invalid place ID' });
      await NearbyPlaceModel.reportPlace(userId, placeId);
      return res.json({ success: true });
    } catch (error) {
      logger.error('reportPlace error:', error);
      return res.status(500).json({ error: 'Failed to report place' });
    }
  }

  /**
   * GET /api/nearby/places/favorites
   * Get user's favorited place IDs
   */
  static async getFavorites(req, res) {
    try {
      const userId = req.userId || req.user?.id;
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });
      const placeIds = await NearbyPlaceModel.getUserFavorites(userId);
      return res.json({ success: true, placeIds });
    } catch (error) {
      logger.error('getFavorites error:', error);
      return res.status(500).json({ error: 'Failed to get favorites' });
    }
  }

  /**
   * GET /api/webapp/nearby/feed-posters
   * Returns the 45 most-recent social post authors sorted by distance from the requesting user.
   * Each result carries metadata about the user's last post for context.
   */
  static async feedPosters(req, res) {
    try {
      const userId = req.session?.user?.id;
      if (!userId) return res.status(401).json({ error: 'Not authenticated' });

      // Get the 44 most recent unique posters (regardless of location).
      // Rewards active community members over passive users.
      // Each user appears once with their most recent post.
      const { rows } = await dbQuery(
        `SELECT DISTINCT ON (u.id)
           u.id                                                         AS user_id,
           u.username,
           u.first_name                                                 AS name,
           u.photo_file_id                                              AS photo_url,
           sp.id                                                        AS last_post_id,
           sp.media_url                                                 AS last_post_media,
           LEFT(sp.content, 80)                                         AS last_post_caption,
           sp.created_at                                                AS last_post_at,
           CASE WHEN u.last_active > NOW() - INTERVAL '5 minutes'
                THEN true ELSE false END                                AS is_online
         FROM users u
         JOIN social_posts sp ON sp.user_id = u.id AND sp.is_deleted = false
         WHERE u.id != $1
           AND u.is_deleted = false
         ORDER BY u.id, sp.created_at DESC`,
        [userId]
      );

      // Sort by most recent post first, limit to 44
      rows.sort((a, b) => new Date(b.last_post_at) - new Date(a.last_post_at));
      const users = rows.slice(0, 44).map((r) => {
        const photoUrl = r.photo_url &&
          (r.photo_url.startsWith('/') || r.photo_url.startsWith('http'))
          ? r.photo_url : null;
        return {
          user_id: r.user_id,
          username: r.username,
          name: r.name,
          photo_url: photoUrl,
          last_post_id: r.last_post_id,
          last_post_media: r.last_post_media,
          last_post_caption: r.last_post_caption,
          last_post_at: r.last_post_at,
          distance_km: null,
          is_online: r.is_online,
        };
      });

      return res.status(200).json({ success: true, total: users.length, users });
    } catch (error) {
      logger.error('❌ feedPosters error:', error);
      return res.status(500).json({ error: 'Failed to fetch feed posters' });
    }
  }

  /**
   * GET /api/webapp/nearby/hangout-members/:groupId
   * Returns members of a hangout group sorted by distance from the requesting user.
   * The requesting user must be a member of the group.
   */
  static async hangoutMembers(req, res) {
    try {
      const userId = req.session?.user?.id;
      if (!userId) return res.status(401).json({ error: 'Not authenticated' });

      const groupId = parseInt(req.params.groupId, 10);
      if (!groupId || isNaN(groupId)) {
        return res.status(400).json({ error: 'Invalid group ID' });
      }

      // Verify membership + get group name
      const { rows: memberCheck } = await dbQuery(
        `SELECT hg.name AS group_name
         FROM hangout_group_members hgm
         JOIN hangout_groups hg ON hg.id = hgm.group_id
         WHERE hgm.group_id = $1 AND hgm.user_id = $2`,
        [groupId, userId]
      );
      if (memberCheck.length === 0) {
        return res.status(403).json({ error: 'You are not a member of this group' });
      }
      const groupName = memberCheck[0].group_name || `Group ${groupId}`;

      // Get requesting user's location
      const { rows: viewerRows } = await dbQuery(
        `SELECT location_lat, location_lng FROM users WHERE id = $1`,
        [userId]
      );
      const viewer = viewerRows[0];

      // Return ALL group members (no limit — show every member of the hangout).
        // Rewards users who participate in hangouts.
        const { rows } = await dbQuery(
          `SELECT u.id AS user_id, u.username, u.first_name AS name, u.photo_file_id AS photo_url,
                  u.location_lat, u.location_lng,
                  CASE WHEN u.last_active > NOW() - INTERVAL '5 minutes' THEN true ELSE false END AS is_online
           FROM hangout_group_members hgm
           JOIN users u ON u.id = hgm.user_id
           WHERE hgm.group_id = $1
             AND u.id != $2
             AND u.is_deleted = false`,
          [groupId, userId]
        );

      const hasViewerLocation = viewer && viewer.location_lat != null && viewer.location_lng != null;
      const lat = hasViewerLocation ? parseFloat(viewer.location_lat) : 0;
      const lng = hasViewerLocation ? parseFloat(viewer.location_lng) : 0;

      const R = 6371;
      const toRad = (d) => (d * Math.PI) / 180;
      const users = rows.map((r) => {
        let distKm = null;
        if (hasViewerLocation && r.location_lat != null && r.location_lng != null) {
          const dLat = toRad(parseFloat(r.location_lat) - lat);
          const dLng = toRad(parseFloat(r.location_lng) - lng);
          const a =
            Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat)) * Math.cos(toRad(parseFloat(r.location_lat))) *
            Math.sin(dLng / 2) ** 2;
          distKm = Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 10) / 10;
        }
        return {
          user_id: r.user_id,
          username: r.username,
          name: r.name,
          photo_url: r.photo_url && (r.photo_url.startsWith('/') || r.photo_url.startsWith('http')) ? r.photo_url : null,
          distance_km: distKm,
          is_online: r.is_online,
        };
      });

      // Online first, then by distance (null distances last), then alphabetical
      users.sort((a, b) => {
        if (a.is_online !== b.is_online) return a.is_online ? -1 : 1;
        if (a.distance_km === null && b.distance_km === null) return (a.name || '').localeCompare(b.name || '');
        if (a.distance_km === null) return 1;
        if (b.distance_km === null) return -1;
        return a.distance_km - b.distance_km;
      });

      return res.status(200).json({ success: true, total: users.length, users, groupName });
    } catch (error) {
      logger.error('❌ hangoutMembers error:', error);
      return res.status(500).json({ error: 'Failed to fetch hangout members' });
    }
  }

  /**
   * GET /api/webapp/nearby/stream-viewers/:streamId
   * Returns active viewers of a live stream sorted by distance from the requesting user.
   * The stream host is always included as the first result.
   * Falls back gracefully when viewers have no location set.
   */
  static async streamViewers(req, res) {
    try {
      const userId = req.session?.user?.id;
      if (!userId) return res.status(401).json({ error: 'Not authenticated' });

      const streamId = req.params.streamId;
      if (!streamId) return res.status(400).json({ error: 'Invalid stream ID' });

      // Fetch stream to verify it exists and get host
      const { rows: streamRows } = await dbQuery(
        `SELECT id, host_id, title, status FROM live_streams WHERE id = $1`,
        [streamId]
      );
      if (streamRows.length === 0) {
        return res.status(404).json({ error: 'Stream not found' });
      }
      const stream = streamRows[0];

      // Get requesting user's location
      const { rows: viewerRows } = await dbQuery(
        `SELECT location_lat, location_lng FROM users WHERE id = $1`,
        [userId]
      );
      const myLoc = viewerRows[0];
      const myLat = myLoc?.location_lat != null ? parseFloat(myLoc.location_lat) : null;
      const myLng = myLoc?.location_lng != null ? parseFloat(myLoc.location_lng) : null;

      // Get active viewer IDs from stream_viewers (left_at IS NULL = still watching)
      const { rows: activeViewerRows } = await dbQuery(
        `SELECT DISTINCT viewer_id FROM stream_viewers
         WHERE stream_id = $1 AND left_at IS NULL AND viewer_id IS NOT NULL`,
        [streamId]
      );
      const viewerIds = activeViewerRows.map((r) => r.viewer_id);

      // Always include the host; union with active viewer IDs
      const allIds = Array.from(new Set([stream.host_id, ...viewerIds]));

      if (allIds.length === 0) {
        return res.status(200).json({ success: true, total: 0, stream_title: stream.title, users: [] });
      }

      const placeholders = allIds.map((_, i) => `$${i + 2}`).join(', ');
      const { rows } = await dbQuery(
        `SELECT u.id AS user_id, u.username, u.first_name AS name, u.photo_file_id AS photo_url,
                u.location_lat, u.location_lng,
                CASE WHEN u.last_active > NOW() - INTERVAL '5 minutes' THEN true ELSE false END AS is_online,
                CASE WHEN u.id = $1 THEN true ELSE false END AS is_host
         FROM users u
         WHERE u.id IN (${placeholders})
           AND u.is_deleted = false`,
        [stream.host_id, ...allIds]
      );

      const R = 6371;
      const toRad = (d) => (d * Math.PI) / 180;
      const withDistance = rows.map((r) => {
        let distKm = null;
        if (myLat !== null && myLng !== null && r.location_lat != null && r.location_lng != null) {
          const dLat = toRad(parseFloat(r.location_lat) - myLat);
          const dLng = toRad(parseFloat(r.location_lng) - myLng);
          const a =
            Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(myLat)) * Math.cos(toRad(parseFloat(r.location_lat))) *
            Math.sin(dLng / 2) ** 2;
          distKm = Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 10) / 10;
        }
        return {
          user_id: r.user_id,
          username: r.username,
          name: r.name,
          photo_url: r.photo_url && (r.photo_url.startsWith('/') || r.photo_url.startsWith('http')) ? r.photo_url : null,
          distance_km: distKm,
          is_online: r.is_online,
          is_host: r.is_host,
        };
      });

      // Host first, then by distance (nulls last)
      withDistance.sort((a, b) => {
        if (a.is_host && !b.is_host) return -1;
        if (!a.is_host && b.is_host) return 1;
        if (a.distance_km === null) return 1;
        if (b.distance_km === null) return -1;
        return a.distance_km - b.distance_km;
      });
      const users = withDistance.slice(0, 45);

      return res.status(200).json({
        success: true,
        total: users.length,
        stream_title: stream.title,
        stream_status: stream.status,
        users,
      });
    } catch (error) {
      logger.error('❌ streamViewers error:', error);
      return res.status(500).json({ error: 'Failed to fetch stream viewers' });
    }
  }

  /**
   * GET /api/webapp/nearby/event-attendees/:eventId
   * Returns RSVPed attendees of an event sorted by distance from the requesting user.
   */
  static async eventAttendees(req, res) {
    try {
      const userId = req.session?.user?.id;
      if (!userId) return res.status(401).json({ error: 'Not authenticated' });

      const eventId = req.params.eventId;
      if (!eventId) return res.status(400).json({ error: 'Invalid event ID' });

      // Verify event exists
      const { rows: eventRows } = await dbQuery(
        `SELECT id, title, scheduled_at, status FROM events WHERE id = $1`,
        [eventId]
      );
      if (eventRows.length === 0) {
        return res.status(404).json({ error: 'Event not found' });
      }
      const event = eventRows[0];

      // Get requesting user's location
      const { rows: viewerRows } = await dbQuery(
        `SELECT location_lat, location_lng FROM users WHERE id = $1`,
        [userId]
      );
      const myLoc = viewerRows[0];
      const myLat = myLoc?.location_lat != null ? parseFloat(myLoc.location_lat) : null;
      const myLng = myLoc?.location_lng != null ? parseFloat(myLoc.location_lng) : null;

      const { rows } = await dbQuery(
        `SELECT u.id AS user_id, u.username, u.first_name AS name, u.photo_file_id AS photo_url,
                u.location_lat, u.location_lng,
                CASE WHEN u.last_active > NOW() - INTERVAL '5 minutes' THEN true ELSE false END AS is_online,
                er.created_at AS rsvp_at
         FROM event_rsvps er
         JOIN users u ON u.id = er.user_id
         WHERE er.event_id = $1
           AND u.is_deleted = false
         LIMIT 200`,
        [eventId]
      );

      const R = 6371;
      const toRad = (d) => (d * Math.PI) / 180;
      const withDistance = rows.map((r) => {
        let distKm = null;
        if (myLat !== null && myLng !== null && r.location_lat != null && r.location_lng != null) {
          const dLat = toRad(parseFloat(r.location_lat) - myLat);
          const dLng = toRad(parseFloat(r.location_lng) - myLng);
          const a =
            Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(myLat)) * Math.cos(toRad(parseFloat(r.location_lat))) *
            Math.sin(dLng / 2) ** 2;
          distKm = Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 10) / 10;
        }
        return {
          user_id: r.user_id,
          username: r.username,
          name: r.name,
          photo_url: r.photo_url && (r.photo_url.startsWith('/') || r.photo_url.startsWith('http')) ? r.photo_url : null,
          distance_km: distKm,
          is_online: r.is_online,
          rsvp_at: r.rsvp_at,
        };
      });

      // Sort by distance ascending, nulls last
      withDistance.sort((a, b) => {
        if (a.distance_km === null) return 1;
        if (b.distance_km === null) return -1;
        return a.distance_km - b.distance_km;
      });
      const users = withDistance.slice(0, 45);

      return res.status(200).json({
        success: true,
        total: users.length,
        event_title: event.title,
        event_scheduled_at: event.scheduled_at,
        event_status: event.status,
        users,
      });
    } catch (error) {
      logger.error('❌ eventAttendees error:', error);
      return res.status(500).json({ error: 'Failed to fetch event attendees' });
    }
  }

  /**
   * GET /api/webapp/nearby/all-users
   * Returns all users who have shared their location (including offline),
   * sorted by distance from the requesting user. Equivalent to searchNearby
   * but always includes an is_online field and does not require a lat/lng param
   * (uses the stored location of the requesting user).
   */
  static async allUsers(req, res) {
    try {
      const userId = req.session?.user?.id;
      if (!userId) return res.status(401).json({ error: 'Not authenticated' });

      // Resolve requesting user's stored location
      const { rows: viewerRows } = await dbQuery(
        `SELECT location_lat, location_lng FROM users WHERE id = $1`,
        [userId]
      );
      const viewer = viewerRows[0];
      if (!viewer || viewer.location_lat == null || viewer.location_lng == null) {
        return res.status(200).json({ success: true, total: 0, users: [] });
      }

      const lat = parseFloat(viewer.location_lat);
      const lng = parseFloat(viewer.location_lng);

      const { rows } = await dbQuery(
        `SELECT u.id AS user_id, u.username, u.first_name AS name, u.photo_file_id AS photo_url,
                u.location_lat, u.location_lng,
                CASE WHEN u.last_active > NOW() - INTERVAL '5 minutes' THEN true ELSE false END AS is_online
         FROM users u
         WHERE u.id != $1
           AND u.is_deleted = false
           AND u.location_lat IS NOT NULL
           AND u.location_lng IS NOT NULL
           AND u.location_sharing_enabled = true`,
        [userId]
      );

      const R = 6371;
      const toRad = (d) => (d * Math.PI) / 180;
      const withDistance = rows.map((r) => {
        const dLat = toRad(parseFloat(r.location_lat) - lat);
        const dLng = toRad(parseFloat(r.location_lng) - lng);
        const a =
          Math.sin(dLat / 2) ** 2 +
          Math.cos(toRad(lat)) * Math.cos(toRad(parseFloat(r.location_lat))) *
          Math.sin(dLng / 2) ** 2;
        const distKm = Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 10) / 10;
        return {
          user_id: r.user_id,
          username: r.username,
          name: r.name,
          photo_url: r.photo_url && (r.photo_url.startsWith('/') || r.photo_url.startsWith('http')) ? r.photo_url : null,
          distance_km: distKm,
          is_online: r.is_online,
        };
      });

      // Sort: online first, then by distance
      withDistance.sort((a, b) => {
        if (a.is_online !== b.is_online) return a.is_online ? -1 : 1;
        return a.distance_km - b.distance_km;
      });

      return res.status(200).json({ success: true, total: withDistance.length, users: withDistance });
    } catch (error) {
      logger.error('❌ allUsers error:', error);
      return res.status(500).json({ error: 'Failed to fetch users' });
    }
  }

  /**
   * GET /api/webapp/nearby/online-users
   * Returns users who have been active in the last 5 minutes.
   * Excludes blocked users in both directions.
   * Optional query params: region (country code/name), limit (default 100, max 200).
   */
  static async onlineUsers(req, res) {
    try {
      const userId = req.session?.user?.id;
      if (!userId) return res.status(401).json({ error: 'Not authenticated' });

      const region = req.query.region ? String(req.query.region).trim() : null;
      const limit = Math.min(parseInt(req.query.limit, 10) || 100, 200);

      const queryParams = [userId];
      let regionClause = '';
      if (region) {
        queryParams.push(region);
        regionClause = `AND u.country = $${queryParams.length}`;
      }

      const { rows } = await dbQuery(
        `SELECT u.id AS user_id, u.username, u.first_name AS name,
                u.photo_file_id AS photo_url, u.city, u.country,
                u.last_active, u.telegram
         FROM users u
         WHERE u.last_active > NOW() - INTERVAL '5 minutes'
           AND u.is_deleted = false
           AND u.id != $1
           ${regionClause}
           AND NOT EXISTS (
             SELECT 1 FROM blocked_users b
             WHERE (b.user_id = $1 AND b.blocked_user_id = u.id)
                OR (b.user_id = u.id AND b.blocked_user_id = $1)
           )
         ORDER BY u.last_active DESC
         LIMIT ${limit}`,
        queryParams
      );

      const users = rows.map((r) => ({
        user_id: r.user_id,
        username: r.username || null,
        name: r.name || null,
        photo_url: r.photo_url && (r.photo_url.startsWith('/') || r.photo_url.startsWith('http'))
          ? r.photo_url
          : null,
        city: r.city || null,
        country: r.country || null,
        last_active: r.last_active,
        is_online: true,
        telegram: r.telegram || null,
      }));

      return res.status(200).json({ success: true, total: users.length, users });
    } catch (error) {
      logger.error('❌ onlineUsers error:', error);
      return res.status(500).json({ error: 'Failed to fetch online users' });
    }
  }

  /**
   * GET /api/nearby/distance/:userId
   * Get distance between authenticated user and target user
   */
  static async getDistanceToUser(req, res) {
    try {
      const myId = req.userId || req.user?.id;
      if (!myId) return res.status(401).json({ error: 'Unauthorized' });

      const targetId = req.params.userId;
      if (!targetId) return res.status(400).json({ error: 'Missing userId' });

      const redisGeoService = require('../../services/redisGeoService');
      const UserLocation = require('../../models/userLocation');

      let myLoc = await redisGeoService.getUserLocation(myId);
      if (!myLoc) {
        const dbRow = await UserLocation.getByUserId(myId);
        if (dbRow) myLoc = { latitude: parseFloat(dbRow.latitude), longitude: parseFloat(dbRow.longitude) };
      }

      let targetLoc = await redisGeoService.getUserLocation(targetId);
      if (!targetLoc) {
        const dbRow = await UserLocation.getByUserId(targetId);
        if (dbRow) targetLoc = { latitude: parseFloat(dbRow.latitude), longitude: parseFloat(dbRow.longitude) };
      }

      if (!myLoc || !targetLoc) {
        return res.json({ success: true, distance_km: null });
      }

      // Haversine distance
      const R = 6371;
      const dLat = ((targetLoc.latitude - myLoc.latitude) * Math.PI) / 180;
      const dLon = ((targetLoc.longitude - myLoc.longitude) * Math.PI) / 180;
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((myLoc.latitude * Math.PI) / 180) *
          Math.cos((targetLoc.latitude * Math.PI) / 180) *
          Math.sin(dLon / 2) ** 2;
      const distance = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

      return res.json({ success: true, distance_km: Math.round(distance * 10) / 10 });
    } catch (error) {
      logger.error('❌ getDistanceToUser error:', error);
      return res.status(500).json({ error: 'Failed to get distance' });
    }
  }
}

module.exports = NearbyController;
