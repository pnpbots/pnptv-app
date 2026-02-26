const { query } = require('../config/postgres');
const { cache } = require('../config/redis');
const logger = require('../utils/logger');

const TABLE = 'nearby_places';
const CACHE_PREFIX = 'nearby_place';
const CACHE_TTL = 300; // 5 minutes

/**
 * Nearby Place Model - Handles all place/business data operations
 */
class NearbyPlaceModel {
  /**
   * Map database row to place object (camelCase)
   */
  static mapRowToPlace(row) {
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      address: row.address,
      city: row.city,
      country: row.country,
      location: row.location_lat && row.location_lng ? {
        lat: parseFloat(row.location_lat),
        lng: parseFloat(row.location_lng),
        geohash: row.location_geohash,
      } : null,
      categoryId: row.category_id,
      placeType: row.place_type,
      phone: row.phone,
      email: row.email,
      website: row.website,
      telegramUsername: row.telegram_username,
      instagram: row.instagram,
      isCommunityOwned: row.is_community_owned,
      ownerUserId: row.owner_user_id,
      recommenderUserId: row.recommender_user_id,
      photoUrl: row.photo_url,
      photoFileId: row.photo_file_id,
      hoursOfOperation: typeof row.hours_of_operation === 'string'
        ? JSON.parse(row.hours_of_operation)
        : (row.hours_of_operation || {}),
      priceRange: row.price_range,
      status: row.status,
      rejectionReason: row.rejection_reason,
      moderatedBy: row.moderated_by,
      moderatedAt: row.moderated_at,
      viewCount: row.view_count || 0,
      favoriteCount: row.favorite_count || 0,
      reportCount: row.report_count || 0,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      // Joined fields (when available)
      distance: row.distance !== undefined ? parseFloat(row.distance) : undefined,
      categoryName: row.category_name_en || row.category_name,
      categoryNameEs: row.category_name_es,
      categoryEmoji: row.category_emoji,
      categorySlug: row.category_slug,
      requiresAgeVerification: row.requires_age_verification,
    };
  }

  /**
   * Get place by ID
   */
  static async getById(placeId) {
    try {
      const cacheKey = `${CACHE_PREFIX}:${placeId}`;

      // Try cache first
      const cached = await cache.get(cacheKey);
      if (cached) return cached;

      const result = await query(
        `SELECT p.*,
                c.name_en as category_name_en,
                c.name_es as category_name_es,
                c.emoji as category_emoji,
                c.slug as category_slug,
                c.requires_age_verification
         FROM ${TABLE} p
         LEFT JOIN nearby_place_categories c ON p.category_id = c.id
         WHERE p.id = $1`,
        [placeId]
      );

      if (result.rows.length === 0) return null;

      const place = this.mapRowToPlace(result.rows[0]);

      // Cache result
      if (cache.set) await cache.set(cacheKey, place, CACHE_TTL);

      return place;
    } catch (error) {
      logger.error('Error getting place by ID:', error);
      return null;
    }
  }

  /**
   * Get nearby places using Haversine formula with bounding box optimization
   * Similar pattern to UserModel.getNearby
   */
  static async getNearby(location, radiusKm = 25, filters = {}) {
    try {
      const lat = location.lat;
      const lng = location.lng;

      // Round for cache key
      const roundedLat = Math.round(lat * 100) / 100;
      const roundedLng = Math.round(lng * 100) / 100;
      const categoryKey = Array.isArray(filters.categoryIds)
        ? filters.categoryIds.slice().sort((a, b) => a - b).join(',')
        : (filters.categoryId || 'all');
      const cacheKey = `nearby_places:${roundedLat},${roundedLng}:${radiusKm}:${categoryKey}:${filters.placeType || 'all'}`;

      const fetchNearby = async () => {
        // Calculate bounding box for SQL pre-filtering
        const latDelta = radiusKm / 111;
        const lngDelta = radiusKm / (111 * Math.cos(this.toRad(lat)));

        const minLat = lat - latDelta;
        const maxLat = lat + latDelta;
        const minLng = lng - lngDelta;
        const maxLng = lng + lngDelta;

        let sql = `
          SELECT p.*,
                 c.name_en as category_name_en,
                 c.name_es as category_name_es,
                 c.emoji as category_emoji,
                 c.slug as category_slug,
                 c.requires_age_verification
          FROM ${TABLE} p
          LEFT JOIN nearby_place_categories c ON p.category_id = c.id
          WHERE p.status = 'approved'
            AND p.location_lat IS NOT NULL
            AND p.location_lng IS NOT NULL
            AND p.location_lat BETWEEN $1 AND $2
            AND p.location_lng BETWEEN $3 AND $4
        `;

        const params = [minLat, maxLat, minLng, maxLng];
        let paramIndex = 5;

        // Apply filters
        if (Array.isArray(filters.categoryIds) && filters.categoryIds.length > 0) {
          sql += ` AND p.category_id = ANY($${paramIndex++})`;
          params.push(filters.categoryIds);
        } else if (filters.categoryId) {
          sql += ` AND p.category_id = $${paramIndex++}`;
          params.push(filters.categoryId);
        }

        if (filters.placeType) {
          sql += ` AND p.place_type = $${paramIndex++}`;
          params.push(filters.placeType);
        }

        sql += ` LIMIT 200`;

        const result = await query(sql, params);

        // Calculate exact distances and filter
        const places = [];
        for (const row of result.rows) {
          const place = this.mapRowToPlace(row);
          if (place.location) {
            const distance = this.calculateDistance(lat, lng, place.location.lat, place.location.lng);
            if (distance <= radiusKm) {
              places.push({ ...place, distance });
            }
          }
        }

        // Sort by distance
        places.sort((a, b) => a.distance - b.distance);

        logger.info(`Found ${places.length} nearby places within ${radiusKm}km (pre-filtered ${result.rows.length})`);
        return places;
      };

      // Try cache
      if (cache.getOrSet && typeof cache.getOrSet === 'function') {
        const maybeCached = await cache.getOrSet(cacheKey, fetchNearby, CACHE_TTL);
        if (maybeCached !== undefined) return maybeCached;
      }

      const cached = await cache.get(cacheKey);
      if (cached) return cached;

      const places = await fetchNearby();
      if (cache.set) await cache.set(cacheKey, places, CACHE_TTL);
      return places;
    } catch (error) {
      logger.error('Error getting nearby places:', error);
      return [];
    }
  }

  /**
   * Create a new place
   */
  static async create(placeData) {
    try {
      const sql = `
        INSERT INTO ${TABLE} (
          name, description, address, city, country,
          location_lat, location_lng, location_geohash,
          category_id, place_type, phone, email, website,
          telegram_username, instagram, is_community_owned,
          owner_user_id, recommender_user_id, photo_url, photo_file_id,
          hours_of_operation, price_range, status
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
          $21, $22, $23
        )
        RETURNING *
      `;

      const result = await query(sql, [
        placeData.name,
        placeData.description || null,
        placeData.address || null,
        placeData.city || null,
        placeData.country || null,
        placeData.location?.lat || null,
        placeData.location?.lng || null,
        placeData.location?.geohash || null,
        placeData.categoryId || null,
        placeData.placeType,
        placeData.phone || null,
        placeData.email || null,
        placeData.website || null,
        placeData.telegramUsername || null,
        placeData.instagram || null,
        placeData.isCommunityOwned || false,
        placeData.ownerUserId || null,
        placeData.recommenderUserId || null,
        placeData.photoUrl || null,
        placeData.photoFileId || null,
        JSON.stringify(placeData.hoursOfOperation || {}),
        placeData.priceRange || null,
        placeData.status || 'pending',
      ]);

      // Clear nearby cache
      await cache.delPattern('nearby_places:*');

      logger.info('Place created', { placeId: result.rows[0].id, name: placeData.name });
      return this.mapRowToPlace(result.rows[0]);
    } catch (error) {
      logger.error('Error creating place:', error);
      throw error;
    }
  }

  /**
   * Update place
   */
  static async update(placeId, updates) {
    try {
      const setClauses = ['updated_at = NOW()'];
      const values = [placeId];
      let paramIndex = 2;

      const fieldMap = {
        name: 'name',
        description: 'description',
        address: 'address',
        city: 'city',
        country: 'country',
        categoryId: 'category_id',
        placeType: 'place_type',
        phone: 'phone',
        email: 'email',
        website: 'website',
        telegramUsername: 'telegram_username',
        instagram: 'instagram',
        isCommunityOwned: 'is_community_owned',
        ownerUserId: 'owner_user_id',
        recommenderUserId: 'recommender_user_id',
        photoUrl: 'photo_url',
        photoFileId: 'photo_file_id',
        priceRange: 'price_range',
        status: 'status',
        rejectionReason: 'rejection_reason',
        moderatedBy: 'moderated_by',
      };

      for (const [key, col] of Object.entries(fieldMap)) {
        if (updates[key] !== undefined) {
          setClauses.push(`${col} = $${paramIndex++}`);
          values.push(updates[key]);
        }
      }

      // Handle location
      if (updates.location) {
        setClauses.push(`location_lat = $${paramIndex++}`);
        values.push(updates.location.lat);
        setClauses.push(`location_lng = $${paramIndex++}`);
        values.push(updates.location.lng);
        if (updates.location.geohash) {
          setClauses.push(`location_geohash = $${paramIndex++}`);
          values.push(updates.location.geohash);
        }
      }

      // Handle hours of operation
      if (updates.hoursOfOperation) {
        setClauses.push(`hours_of_operation = $${paramIndex++}`);
        values.push(JSON.stringify(updates.hoursOfOperation));
      }

      // Handle moderation timestamp
      if (updates.status === 'approved' || updates.status === 'rejected') {
        setClauses.push(`moderated_at = NOW()`);
      }

      const result = await query(
        `UPDATE ${TABLE} SET ${setClauses.join(', ')} WHERE id = $1 RETURNING *`,
        values
      );

      // Clear caches
      await cache.del(`${CACHE_PREFIX}:${placeId}`);
      await cache.delPattern('nearby_places:*');

      logger.info('Place updated', { placeId });
      return result.rows.length > 0 ? this.mapRowToPlace(result.rows[0]) : null;
    } catch (error) {
      logger.error('Error updating place:', error);
      throw error;
    }
  }

  /**
   * Update place status (approve/reject)
   */
  static async updateStatus(placeId, status, moderatedBy, rejectionReason = null) {
    try {
      const result = await query(
        `UPDATE ${TABLE}
         SET status = $2, moderated_by = $3, moderated_at = NOW(), rejection_reason = $4, updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [placeId, status, moderatedBy, rejectionReason]
      );

      // Clear caches
      await cache.del(`${CACHE_PREFIX}:${placeId}`);
      await cache.delPattern('nearby_places:*');

      logger.info('Place status updated', { placeId, status, moderatedBy });
      return result.rows.length > 0 ? this.mapRowToPlace(result.rows[0]) : null;
    } catch (error) {
      logger.error('Error updating place status:', error);
      throw error;
    }
  }

  /**
   * Get pending places for admin review
   */
  static async getPending(limit = 20) {
    try {
      const result = await query(
        `SELECT p.*,
                c.name_en as category_name_en,
                c.emoji as category_emoji,
                c.slug as category_slug
         FROM ${TABLE} p
         LEFT JOIN nearby_place_categories c ON p.category_id = c.id
         WHERE p.status = 'pending'
         ORDER BY p.created_at ASC
         LIMIT $1`,
        [limit]
      );
      return result.rows.map(row => this.mapRowToPlace(row));
    } catch (error) {
      logger.error('Error getting pending places:', error);
      return [];
    }
  }

  /**
   * Get all places with filters (admin)
   */
  static async getAll(filters = {}, limit = 50, offset = 0) {
    try {
      let sql = `
        SELECT p.*,
               c.name_en as category_name_en,
               c.emoji as category_emoji
        FROM ${TABLE} p
        LEFT JOIN nearby_place_categories c ON p.category_id = c.id
        WHERE 1=1
      `;
      const params = [];
      let paramIndex = 1;

      if (filters.status) {
        sql += ` AND p.status = $${paramIndex++}`;
        params.push(filters.status);
      }

      if (filters.categoryId) {
        sql += ` AND p.category_id = $${paramIndex++}`;
        params.push(filters.categoryId);
      }

      if (filters.placeType) {
        sql += ` AND p.place_type = $${paramIndex++}`;
        params.push(filters.placeType);
      }

      if (filters.city) {
        sql += ` AND LOWER(p.city) LIKE LOWER($${paramIndex++})`;
        params.push(`%${filters.city}%`);
      }

      sql += ` ORDER BY p.created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
      params.push(limit, offset);

      const result = await query(sql, params);
      return result.rows.map(row => this.mapRowToPlace(row));
    } catch (error) {
      logger.error('Error getting all places:', error);
      return [];
    }
  }

  /**
   * Increment view count
   */
  static async incrementViewCount(placeId) {
    try {
      await query(`UPDATE ${TABLE} SET view_count = view_count + 1 WHERE id = $1`, [placeId]);
      await cache.del(`${CACHE_PREFIX}:${placeId}`);
    } catch (error) {
      logger.error('Error incrementing view count:', error);
    }
  }

  /**
   * Increment favorite count
   */
  static async incrementFavoriteCount(placeId, increment = 1) {
    try {
      await query(
        `UPDATE ${TABLE} SET favorite_count = favorite_count + $2 WHERE id = $1`,
        [placeId, increment]
      );
      await cache.del(`${CACHE_PREFIX}:${placeId}`);
    } catch (error) {
      logger.error('Error updating favorite count:', error);
    }
  }

  /**
   * Get statistics
   */
  static async getStats() {
    try {
      const result = await query(`
        SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE status = 'pending') as pending,
          COUNT(*) FILTER (WHERE status = 'approved') as approved,
          COUNT(*) FILTER (WHERE status = 'rejected') as rejected,
          COUNT(*) FILTER (WHERE place_type = 'business') as businesses,
          COUNT(*) FILTER (WHERE place_type = 'place_of_interest') as places_of_interest,
          SUM(view_count) as total_views
        FROM ${TABLE}
      `);
      return result.rows[0];
    } catch (error) {
      logger.error('Error getting place stats:', error);
      return null;
    }
  }

  /**
   * Delete place
   */
  static async delete(placeId) {
    try {
      await query(`DELETE FROM ${TABLE} WHERE id = $1`, [placeId]);
      await cache.del(`${CACHE_PREFIX}:${placeId}`);
      await cache.delPattern('nearby_places:*');
      logger.info('Place deleted', { placeId });
      return true;
    } catch (error) {
      logger.error('Error deleting place:', error);
      return false;
    }
  }

  /**
   * Calculate distance between two coordinates (Haversine formula)
   */
  static calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth radius in km
    const dLat = this.toRad(lat2 - lat1);
    const dLon = this.toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRad(lat1)) * Math.cos(this.toRad(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  static toRad(deg) {
    return deg * (Math.PI / 180);
  }
}

module.exports = NearbyPlaceModel;
