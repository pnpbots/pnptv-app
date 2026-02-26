const { query } = require('../config/postgres');
const { cache } = require('../config/redis');
const logger = require('../utils/logger');

const TABLE = 'nearby_place_submissions';
const CACHE_PREFIX = 'place_submission';
const CACHE_TTL = 300; // 5 minutes

/**
 * Nearby Place Submission Model - Handles user-submitted place proposals
 */
class NearbyPlaceSubmissionModel {
  /**
   * Map database row to submission object
   */
  static mapRowToSubmission(row) {
    if (!row) return null;
    return {
      id: row.id,
      submittedByUserId: row.submitted_by_user_id,
      submittedAt: row.submitted_at,
      name: row.name,
      description: row.description,
      address: row.address,
      city: row.city,
      country: row.country,
      location: row.location_lat && row.location_lng ? {
        lat: parseFloat(row.location_lat),
        lng: parseFloat(row.location_lng),
      } : null,
      categoryId: row.category_id,
      placeType: row.place_type,
      phone: row.phone,
      email: row.email,
      website: row.website,
      telegramUsername: row.telegram_username,
      instagram: row.instagram,
      isCommunityOwned: row.is_community_owned,
      photoFileId: row.photo_file_id,
      hoursOfOperation: typeof row.hours_of_operation === 'string'
        ? JSON.parse(row.hours_of_operation)
        : (row.hours_of_operation || {}),
      priceRange: row.price_range,
      status: row.status,
      moderatedBy: row.moderated_by,
      moderatedAt: row.moderated_at,
      rejectionReason: row.rejection_reason,
      adminNotes: row.admin_notes,
      createdPlaceId: row.created_place_id,
      updatedAt: row.updated_at,
      // Joined fields (when available)
      categoryName: row.category_name_en,
      categoryNameEs: row.category_name_es,
      categoryEmoji: row.category_emoji,
      submitterUsername: row.submitter_username,
      submitterFirstName: row.submitter_first_name,
    };
  }

  /**
   * Create a new submission
   */
  static async create(submissionData) {
    try {
      const sql = `
        INSERT INTO ${TABLE} (
          submitted_by_user_id, name, description, address, city, country,
          location_lat, location_lng, category_id, place_type,
          phone, email, website, telegram_username, instagram,
          is_community_owned, photo_file_id, hours_of_operation, price_range
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15, $16, $17, $18, $19
        )
        RETURNING *
      `;

      const result = await query(sql, [
        submissionData.submittedByUserId,
        submissionData.name,
        submissionData.description || null,
        submissionData.address || null,
        submissionData.city || null,
        submissionData.country || null,
        submissionData.location?.lat || null,
        submissionData.location?.lng || null,
        submissionData.categoryId || null,
        submissionData.placeType,
        submissionData.phone || null,
        submissionData.email || null,
        submissionData.website || null,
        submissionData.telegramUsername || null,
        submissionData.instagram || null,
        submissionData.isCommunityOwned || false,
        submissionData.photoFileId || null,
        JSON.stringify(submissionData.hoursOfOperation || {}),
        submissionData.priceRange || null,
      ]);

      // Clear cache
      await cache.delPattern(`${CACHE_PREFIX}:*`);

      logger.info('Place submission created', {
        submissionId: result.rows[0].id,
        userId: submissionData.submittedByUserId,
        name: submissionData.name,
      });

      return this.mapRowToSubmission(result.rows[0]);
    } catch (error) {
      logger.error('Error creating submission:', error);
      throw error;
    }
  }

  /**
   * Get submission by ID
   */
  static async getById(submissionId) {
    try {
      const result = await query(
        `SELECT s.*,
                c.name_en as category_name_en,
                c.name_es as category_name_es,
                c.emoji as category_emoji,
                u.username as submitter_username,
                u.first_name as submitter_first_name
         FROM ${TABLE} s
         LEFT JOIN nearby_place_categories c ON s.category_id = c.id
         LEFT JOIN users u ON s.submitted_by_user_id = u.id
         WHERE s.id = $1`,
        [submissionId]
      );

      if (result.rows.length === 0) return null;
      return this.mapRowToSubmission(result.rows[0]);
    } catch (error) {
      logger.error('Error getting submission by ID:', error);
      return null;
    }
  }

  /**
   * Get pending submissions for admin review
   */
  static async getPending(limit = 20) {
    try {
      const result = await query(
        `SELECT s.*,
                c.name_en as category_name_en,
                c.emoji as category_emoji,
                u.username as submitter_username,
                u.first_name as submitter_first_name
         FROM ${TABLE} s
         LEFT JOIN nearby_place_categories c ON s.category_id = c.id
         LEFT JOIN users u ON s.submitted_by_user_id = u.id
         WHERE s.status = 'pending'
         ORDER BY s.submitted_at ASC
         LIMIT $1`,
        [limit]
      );
      return result.rows.map(row => this.mapRowToSubmission(row));
    } catch (error) {
      logger.error('Error getting pending submissions:', error);
      return [];
    }
  }

  /**
   * Get submissions by user
   */
  static async getByUser(userId, limit = 10) {
    try {
      const result = await query(
        `SELECT s.*,
                c.name_en as category_name_en,
                c.emoji as category_emoji
         FROM ${TABLE} s
         LEFT JOIN nearby_place_categories c ON s.category_id = c.id
         WHERE s.submitted_by_user_id = $1
         ORDER BY s.submitted_at DESC
         LIMIT $2`,
        [userId, limit]
      );
      return result.rows.map(row => this.mapRowToSubmission(row));
    } catch (error) {
      logger.error('Error getting user submissions:', error);
      return [];
    }
  }

  /**
   * Update submission status
   */
  static async updateStatus(submissionId, status, moderatedBy, rejectionReason = null, createdPlaceId = null) {
    try {
      const result = await query(
        `UPDATE ${TABLE}
         SET status = $2, moderated_by = $3, moderated_at = NOW(),
             rejection_reason = $4, created_place_id = $5, updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [submissionId, status, moderatedBy, rejectionReason, createdPlaceId]
      );

      // Clear caches
      await cache.delPattern(`${CACHE_PREFIX}:*`);

      logger.info('Submission status updated', { submissionId, status, moderatedBy });
      return result.rows.length > 0 ? this.mapRowToSubmission(result.rows[0]) : null;
    } catch (error) {
      logger.error('Error updating submission status:', error);
      throw error;
    }
  }

  /**
   * Add admin notes to submission
   */
  static async addAdminNotes(submissionId, notes) {
    try {
      const result = await query(
        `UPDATE ${TABLE}
         SET admin_notes = $2, updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [submissionId, notes]
      );
      return result.rows.length > 0 ? this.mapRowToSubmission(result.rows[0]) : null;
    } catch (error) {
      logger.error('Error adding admin notes:', error);
      return null;
    }
  }

  /**
   * Get all submissions with filters (admin)
   */
  static async getAll(filters = {}, limit = 50, offset = 0) {
    try {
      let sql = `
        SELECT s.*,
               c.name_en as category_name_en,
               c.emoji as category_emoji,
               u.username as submitter_username
        FROM ${TABLE} s
        LEFT JOIN nearby_place_categories c ON s.category_id = c.id
        LEFT JOIN users u ON s.submitted_by_user_id = u.id
        WHERE 1=1
      `;
      const params = [];
      let paramIndex = 1;

      if (filters.status) {
        sql += ` AND s.status = $${paramIndex++}`;
        params.push(filters.status);
      }

      if (filters.categoryId) {
        sql += ` AND s.category_id = $${paramIndex++}`;
        params.push(filters.categoryId);
      }

      if (filters.placeType) {
        sql += ` AND s.place_type = $${paramIndex++}`;
        params.push(filters.placeType);
      }

      if (filters.userId) {
        sql += ` AND s.submitted_by_user_id = $${paramIndex++}`;
        params.push(filters.userId);
      }

      sql += ` ORDER BY s.submitted_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
      params.push(limit, offset);

      const result = await query(sql, params);
      return result.rows.map(row => this.mapRowToSubmission(row));
    } catch (error) {
      logger.error('Error getting all submissions:', error);
      return [];
    }
  }

  /**
   * Get submission statistics
   */
  static async getStats() {
    try {
      const result = await query(`
        SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE status = 'pending') as pending,
          COUNT(*) FILTER (WHERE status = 'approved') as approved,
          COUNT(*) FILTER (WHERE status = 'rejected') as rejected
        FROM ${TABLE}
      `);
      return result.rows[0];
    } catch (error) {
      logger.error('Error getting submission stats:', error);
      return null;
    }
  }

  /**
   * Update submission (for user edits on pending submissions)
   */
  static async update(submissionId, updates) {
    try {
      const allowedFields = [
        'name', 'description', 'address', 'city', 'country',
        'phone', 'email', 'website', 'telegram_username', 'instagram',
        'photo_file_id', 'hours_of_operation', 'price_range'
      ];

      const setClauses = [];
      const params = [submissionId];
      let paramIndex = 2;

      // Map camelCase to snake_case
      const fieldMap = {
        telegramUsername: 'telegram_username',
        photoFileId: 'photo_file_id',
        hoursOfOperation: 'hours_of_operation',
        priceRange: 'price_range'
      };

      for (const [key, value] of Object.entries(updates)) {
        const dbField = fieldMap[key] || key;
        if (allowedFields.includes(dbField)) {
          setClauses.push(`${dbField} = $${paramIndex++}`);
          params.push(key === 'hoursOfOperation' ? JSON.stringify(value) : value);
        }
      }

      if (setClauses.length === 0) {
        return null;
      }

      setClauses.push('updated_at = NOW()');

      const sql = `
        UPDATE ${TABLE}
        SET ${setClauses.join(', ')}
        WHERE id = $1 AND status = 'pending'
        RETURNING *
      `;

      const result = await query(sql, params);
      await cache.delPattern(`${CACHE_PREFIX}:*`);

      if (result.rows.length === 0) return null;
      return this.mapRowToSubmission(result.rows[0]);
    } catch (error) {
      logger.error('Error updating submission:', error);
      throw error;
    }
  }

  /**
   * Delete submission
   */
  static async delete(submissionId) {
    try {
      await query(`DELETE FROM ${TABLE} WHERE id = $1`, [submissionId]);
      await cache.delPattern(`${CACHE_PREFIX}:*`);
      logger.info('Submission deleted', { submissionId });
      return true;
    } catch (error) {
      logger.error('Error deleting submission:', error);
      return false;
    }
  }

  /**
   * Count pending submissions (for admin badge)
   */
  static async countPending() {
    try {
      const result = await query(`SELECT COUNT(*) as count FROM ${TABLE} WHERE status = 'pending'`);
      return parseInt(result.rows[0].count) || 0;
    } catch (error) {
      logger.error('Error counting pending submissions:', error);
      return 0;
    }
  }
}

module.exports = NearbyPlaceSubmissionModel;
