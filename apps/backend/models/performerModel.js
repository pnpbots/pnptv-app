const { v4: uuidv4 } = require('uuid');
const { query } = require('../config/postgres');
const logger = require('../utils/logger');

const TABLE = 'performers';
const AVAILABILITY_SLOTS_TABLE = 'call_availability_slots';

/**
 * Performer Model - Manages performers for 1:1 private calls
 */
class PerformerModel {
  /**
   * Create a new performer
   * @param {Object} performerData - Performer data
   * @returns {Promise<Object>} Created performer
   */
  static async create(performerData) {
    try {
      const performerId = uuidv4();
      
      const sql = `
        INSERT INTO ${TABLE} (
          id, user_id, display_name, bio, photo_url, 
          availability_schedule, timezone, allowed_call_types, 
          max_call_duration, base_price, buffer_time_before, buffer_time_after,
          status, is_available, availability_message, 
          total_calls, total_rating, rating_count, 
          created_by, updated_by
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20
        )
        RETURNING *
      `;

      const result = await query(sql, [
        performerId,
        performerData.userId,
        performerData.displayName,
        performerData.bio,
        performerData.photoUrl,
        JSON.stringify(performerData.availabilitySchedule || []),
        performerData.timezone || 'UTC',
        performerData.allowedCallTypes || ['video', 'audio'],
        performerData.maxCallDuration || 60,
        performerData.basePrice || 100.00,
        performerData.bufferTimeBefore || 15,
        performerData.bufferTimeAfter || 15,
        performerData.status || 'active',
        performerData.isAvailable !== undefined ? performerData.isAvailable : true,
        performerData.availabilityMessage,
        performerData.totalCalls || 0,
        performerData.totalRating || 0.00,
        performerData.ratingCount || 0,
        performerData.createdBy || 'system',
        performerData.updatedBy || 'system'
      ]);

      logger.info('Performer created', {
        performerId,
        displayName: performerData.displayName,
      });

      return this.mapRowToPerformer(result.rows[0]);
    } catch (error) {
      logger.error('Error creating performer:', error);
      throw error;
    }
  }

  /**
   * Map database row to performer object
   */
  static mapRowToPerformer(row) {
    if (!row) return null;
    
    return {
      id: row.id,
      userId: row.user_id,
      displayName: row.display_name,
      bio: row.bio,
      photoUrl: row.photo_url,
      availabilitySchedule: row.availability_schedule ? JSON.parse(row.availability_schedule) : [],
      timezone: row.timezone,
      allowedCallTypes: row.allowed_call_types,
      maxCallDuration: row.max_call_duration,
      basePrice: parseFloat(row.base_price),
      bufferTimeBefore: row.buffer_time_before,
      bufferTimeAfter: row.buffer_time_after,
      status: row.status,
      isAvailable: row.is_available,
      availabilityMessage: row.availability_message,
      totalCalls: row.total_calls,
      totalRating: parseFloat(row.total_rating),
      ratingCount: row.rating_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      createdBy: row.created_by,
      updatedBy: row.updated_by
    };
  }

  /**
   * Get performer by ID
   * @param {string} performerId - Performer ID
   * @returns {Promise<Object|null>} Performer or null
   */
  static async getById(performerId) {
    try {
      const result = await query(`SELECT * FROM ${TABLE} WHERE id = $1`, [performerId]);
      if (result.rows.length === 0) return null;
      return this.mapRowToPerformer(result.rows[0]);
    } catch (error) {
      logger.error('Error getting performer by ID:', error);
      return null;
    }
  }

  /**
   * Get performer by display name
   * @param {string} displayName - Performer display name
   * @returns {Promise<Object|null>} Performer or null
   */
  static async getByDisplayName(displayName) {
    try {
      const result = await query(`SELECT * FROM ${TABLE} WHERE display_name = $1`, [displayName]);
      if (result.rows.length === 0) return null;
      return this.mapRowToPerformer(result.rows[0]);
    } catch (error) {
      logger.error('Error getting performer by display name:', error);
      return null;
    }
  }

  /**
   * Get all performers
   * @param {Object} filters - Filter options
   * @returns {Promise<Array>} List of performers
   */
  static async getAll(filters = {}) {
    try {
      let sql = `SELECT * FROM ${TABLE} WHERE 1=1`;
      const params = [];
      let paramIndex = 1;

      // Apply filters
      if (filters.status) {
        sql += ` AND status = $${paramIndex++}`;
        params.push(filters.status);
      }

      if (filters.isAvailable !== undefined) {
        sql += ` AND is_available = $${paramIndex++}`;
        params.push(filters.isAvailable);
      }

      if (filters.search) {
        sql += ` AND (display_name ILIKE $${paramIndex} OR bio ILIKE $${paramIndex})`;
        params.push(`%${filters.search}%`);
        paramIndex++;
      }

      sql += ` ORDER BY display_name ASC`;

      const result = await query(sql, params);
      return result.rows.map((row) => this.mapRowToPerformer(row));
    } catch (error) {
      logger.error('Error getting all performers:', error);
      return [];
    }
  }

  /**
   * Get available performers
   * @returns {Promise<Array>} List of available performers
   */
  static async getAvailable() {
    try {
      const result = await query(
        `SELECT * FROM ${TABLE} WHERE is_available = true AND status = 'active' ORDER BY display_name ASC`
      );
      return result.rows.map((row) => this.mapRowToPerformer(row));
    } catch (error) {
      logger.error('Error getting available performers:', error);
      return [];
    }
  }

  /**
   * Update performer
   * @param {string} performerId - Performer ID
   * @param {Object} updateData - Data to update
   * @returns {Promise<Object>} Updated performer
   */
  static async update(performerId, updateData) {
    try {
      const updates = [];
      const values = [];
      let paramIndex = 1;

      // Build update query dynamically
      if (updateData.displayName !== undefined) {
        updates.push(`display_name = $${paramIndex++}`);
        values.push(updateData.displayName);
      }

      if (updateData.bio !== undefined) {
        updates.push(`bio = $${paramIndex++}`);
        values.push(updateData.bio);
      }

      if (updateData.photoUrl !== undefined) {
        updates.push(`photo_url = $${paramIndex++}`);
        values.push(updateData.photoUrl);
      }

      if (updateData.availabilitySchedule !== undefined) {
        updates.push(`availability_schedule = $${paramIndex++}`);
        values.push(JSON.stringify(updateData.availabilitySchedule));
      }

      if (updateData.timezone !== undefined) {
        updates.push(`timezone = $${paramIndex++}`);
        values.push(updateData.timezone);
      }

      if (updateData.allowedCallTypes !== undefined) {
        updates.push(`allowed_call_types = $${paramIndex++}`);
        values.push(updateData.allowedCallTypes);
      }

      if (updateData.maxCallDuration !== undefined) {
        updates.push(`max_call_duration = $${paramIndex++}`);
        values.push(updateData.maxCallDuration);
      }

      if (updateData.basePrice !== undefined) {
        updates.push(`base_price = $${paramIndex++}`);
        values.push(updateData.basePrice);
      }

      if (updateData.bufferTimeBefore !== undefined) {
        updates.push(`buffer_time_before = $${paramIndex++}`);
        values.push(updateData.bufferTimeBefore);
      }

      if (updateData.bufferTimeAfter !== undefined) {
        updates.push(`buffer_time_after = $${paramIndex++}`);
        values.push(updateData.bufferTimeAfter);
      }

      if (updateData.status !== undefined) {
        updates.push(`status = $${paramIndex++}`);
        values.push(updateData.status);
      }

      if (updateData.isAvailable !== undefined) {
        updates.push(`is_available = $${paramIndex++}`);
        values.push(updateData.isAvailable);
      }

      if (updateData.availabilityMessage !== undefined) {
        updates.push(`availability_message = $${paramIndex++}`);
        values.push(updateData.availabilityMessage);
      }

      if (updateData.updatedBy !== undefined) {
        updates.push(`updated_by = $${paramIndex++}`);
        values.push(updateData.updatedBy);
      }

      // Add updated_at
      updates.push(`updated_at = NOW()`);

      values.push(performerId);

      const sql = `
        UPDATE ${TABLE}
        SET ${updates.join(', ')}
        WHERE id = $${paramIndex}
        RETURNING *
      `;

      const result = await query(sql, values);
      
      if (result.rows.length === 0) {
        throw new Error('Performer not found');
      }

      logger.info('Performer updated', {
        performerId,
        displayName: updateData.displayName,
      });

      return this.mapRowToPerformer(result.rows[0]);
    } catch (error) {
      logger.error('Error updating performer:', error);
      throw error;
    }
  }

  /**
   * Update performer availability
   * @param {string} performerId - Performer ID
   * @param {boolean} isAvailable - Availability status
   * @param {string} message - Availability message
   * @returns {Promise<Object>} Updated performer
   */
  static async updateAvailability(performerId, isAvailable, message = null) {
    try {
      const sql = `
        UPDATE ${TABLE}
        SET 
          is_available = $1,
          availability_message = $2,
          updated_at = NOW()
        WHERE id = $3
        RETURNING *
      `;

      const result = await query(sql, [isAvailable, message, performerId]);
      
      if (result.rows.length === 0) {
        throw new Error('Performer not found');
      }

      logger.info('Performer availability updated', {
        performerId,
        isAvailable,
      });

      return this.mapRowToPerformer(result.rows[0]);
    } catch (error) {
      logger.error('Error updating performer availability:', error);
      throw error;
    }
  }

  /**
   * Delete performer
   * @param {string} performerId - Performer ID
   * @returns {Promise<boolean>} Success status
   */
  static async delete(performerId) {
    try {
      await query(`DELETE FROM ${TABLE} WHERE id = $1`, [performerId]);
      
      logger.info('Performer deleted', {
        performerId,
      });

      return true;
    } catch (error) {
      logger.error('Error deleting performer:', error);
      return false;
    }
  }

  /**
   * Get performer statistics
   * @param {string} performerId - Performer ID
   * @returns {Promise<Object>} Performer statistics
   */
  static async getStatistics(performerId) {
    try {
      const result = await query(
        `SELECT total_calls, total_rating, rating_count FROM ${TABLE} WHERE id = $1`,
        [performerId]
      );
      
      if (result.rows.length === 0) {
        return {
          totalCalls: 0,
          averageRating: 0.00,
          ratingCount: 0
        };
      }

      const row = result.rows[0];
      const averageRating = row.rating_count > 0 
        ? parseFloat((row.total_rating / row.rating_count).toFixed(2))
        : 0.00;

      return {
        totalCalls: row.total_calls,
        averageRating,
        ratingCount: row.rating_count
      };
    } catch (error) {
      logger.error('Error getting performer statistics:', error);
      return {
        totalCalls: 0,
        averageRating: 0.00,
        ratingCount: 0
      };
    }
  }

  /**
   * Update performer statistics
   * @param {string} performerId - Performer ID
   * @param {Object} stats - Statistics to update
   * @returns {Promise<boolean>} Success status
   */
  static async updateStatistics(performerId, stats) {
    try {
      const updates = [];
      const values = [];
      let paramIndex = 1;

      if (stats.totalCalls !== undefined) {
        updates.push(`total_calls = $${paramIndex++}`);
        values.push(stats.totalCalls);
      }

      if (stats.totalRating !== undefined) {
        updates.push(`total_rating = $${paramIndex++}`);
        values.push(stats.totalRating);
      }

      if (stats.ratingCount !== undefined) {
        updates.push(`rating_count = $${paramIndex++}`);
        values.push(stats.ratingCount);
      }

      if (updates.length === 0) {
        return true; // Nothing to update
      }

      updates.push(`updated_at = NOW()`);
      values.push(performerId);

      const sql = `
        UPDATE ${TABLE}
        SET ${updates.join(', ')}
        WHERE id = $${paramIndex}
      `;

      await query(sql, values);
      
      logger.info('Performer statistics updated', {
        performerId,
        stats,
      });

      return true;
    } catch (error) {
      logger.error('Error updating performer statistics:', error);
      return false;
    }
  }

  // =====================================================
  // AVAILABILITY SLOTS MANAGEMENT
  // =====================================================

  /**
   * Create availability slots for performer
   * @param {string} performerId - Performer ID
   * @param {Array} slots - Array of slot objects
   * @returns {Promise<Array>} Created slots
   */
  static async createAvailabilitySlots(performerId, slots) {
    try {
      if (!Array.isArray(slots) || slots.length === 0) {
        return [];
      }

      const createdSlots = [];

      for (const slot of slots) {
        const slotId = uuidv4();
        
        const sql = `
          INSERT INTO ${AVAILABILITY_SLOTS_TABLE} (
            id, performer_id, date, start_time, end_time, timezone, is_available, is_booked
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8
          )
          ON CONFLICT (performer_id, date, start_time)
          DO UPDATE SET
            end_time = EXCLUDED.end_time,
            timezone = EXCLUDED.timezone,
            is_available = EXCLUDED.is_available,
            is_booked = EXCLUDED.is_booked,
            updated_at = NOW()
          RETURNING *
        `;

        const result = await query(sql, [
          slotId,
          performerId,
          slot.date,
          slot.startTime,
          slot.endTime,
          slot.timezone || 'UTC',
          slot.isAvailable !== undefined ? slot.isAvailable : true,
          slot.isBooked || false
        ]);

        createdSlots.push(this.mapSlotRowToObject(result.rows[0]));
      }

      logger.info('Availability slots created', {
        performerId,
        count: createdSlots.length,
      });

      return createdSlots;
    } catch (error) {
      logger.error('Error creating availability slots:', error);
      throw error;
    }
  }

  /**
   * Map slot database row to object
   */
  static mapSlotRowToObject(row) {
    if (!row) return null;
    
    return {
      id: row.id,
      performerId: row.performer_id,
      date: row.date,
      startTime: row.start_time,
      endTime: row.end_time,
      timezone: row.timezone,
      isAvailable: row.is_available,
      isBooked: row.is_booked,
      bookingId: row.booking_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  /**
   * Get availability slots for performer
   * @param {string} performerId - Performer ID
   * @param {Object} filters - Filter options
   * @returns {Promise<Array>} Available slots
   */
  static async getAvailabilitySlots(performerId, filters = {}) {
    try {
      let sql = `SELECT * FROM ${AVAILABILITY_SLOTS_TABLE} WHERE performer_id = $1`;
      const params = [performerId];
      let paramIndex = 2;

      // Apply filters
      if (filters.date) {
        sql += ` AND date = $${paramIndex++}`;
        params.push(filters.date);
      }

      if (filters.startDate && filters.endDate) {
        sql += ` AND date BETWEEN $${paramIndex++} AND $${paramIndex++}`;
        params.push(filters.startDate, filters.endDate);
      }

      if (filters.isAvailable !== undefined) {
        sql += ` AND is_available = $${paramIndex++}`;
        params.push(filters.isAvailable);
      }

      if (filters.isBooked !== undefined) {
        sql += ` AND is_booked = $${paramIndex++}`;
        params.push(filters.isBooked);
      }

      sql += ` ORDER BY date ASC, start_time ASC`;

      const result = await query(sql, params);
      return result.rows.map((row) => this.mapSlotRowToObject(row));
    } catch (error) {
      logger.error('Error getting availability slots:', error);
      return [];
    }
  }

  /**
   * Get available slots for performer
   * @param {string} performerId - Performer ID
   * @param {Object} filters - Filter options
   * @returns {Promise<Array>} Available slots
   */
  static async getAvailableSlots(performerId, filters = {}) {
    try {
      let sql = `SELECT * FROM ${AVAILABILITY_SLOTS_TABLE} 
                 WHERE performer_id = $1 
                 AND is_available = true 
                 AND is_booked = false`;
      const params = [performerId];
      let paramIndex = 2;

      // Apply filters
      if (filters.date) {
        sql += ` AND date = $${paramIndex++}`;
        params.push(filters.date);
      }

      if (filters.startDate && filters.endDate) {
        sql += ` AND date BETWEEN $${paramIndex++} AND $${paramIndex++}`;
        params.push(filters.startDate, filters.endDate);
      }

      sql += ` ORDER BY date ASC, start_time ASC`;

      const result = await query(sql, params);
      return result.rows.map((row) => this.mapSlotRowToObject(row));
    } catch (error) {
      logger.error('Error getting available slots:', error);
      return [];
    }
  }

  /**
   * Book a time slot
   * @param {string} slotId - Slot ID
   * @param {string} bookingId - Booking ID
   * @returns {Promise<Object>} Updated slot
   */
  static async bookSlot(slotId, bookingId) {
    try {
      const sql = `
        UPDATE ${AVAILABILITY_SLOTS_TABLE}
        SET 
          is_booked = true,
          booking_id = $1,
          updated_at = NOW()
        WHERE id = $2
        RETURNING *
      `;

      const result = await query(sql, [bookingId, slotId]);
      
      if (result.rows.length === 0) {
        throw new Error('Slot not found');
      }

      logger.info('Slot booked', {
        slotId,
        bookingId,
      });

      return this.mapSlotRowToObject(result.rows[0]);
    } catch (error) {
      logger.error('Error booking slot:', error);
      throw error;
    }
  }

  /**
   * Release a booked slot
   * @param {string} slotId - Slot ID
   * @returns {Promise<Object>} Updated slot
   */
  static async releaseSlot(slotId) {
    try {
      const sql = `
        UPDATE ${AVAILABILITY_SLOTS_TABLE}
        SET 
          is_booked = false,
          booking_id = NULL,
          updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `;

      const result = await query(sql, [slotId]);
      
      if (result.rows.length === 0) {
        throw new Error('Slot not found');
      }

      logger.info('Slot released', {
        slotId,
      });

      return this.mapSlotRowToObject(result.rows[0]);
    } catch (error) {
      logger.error('Error releasing slot:', error);
      throw error;
    }
  }

  /**
   * Delete availability slots
   * @param {string} performerId - Performer ID
   * @param {Object} filters - Filter options
   * @returns {Promise<number>} Number of deleted slots
   */
  static async deleteAvailabilitySlots(performerId, filters = {}) {
    try {
      let sql = `DELETE FROM ${AVAILABILITY_SLOTS_TABLE} WHERE performer_id = $1`;
      const params = [performerId];
      let paramIndex = 2;

      // Apply filters
      if (filters.date) {
        sql += ` AND date = $${paramIndex++}`;
        params.push(filters.date);
      }

      if (filters.startDate && filters.endDate) {
        sql += ` AND date BETWEEN $${paramIndex++} AND $${paramIndex++}`;
        params.push(filters.startDate, filters.endDate);
      }

      const result = await query(sql, params);
      
      logger.info('Availability slots deleted', {
        performerId,
        count: result.rowCount,
      });

      return result.rowCount;
    } catch (error) {
      logger.error('Error deleting availability slots:', error);
      return 0;
    }
  }

  /**
   * Check if performer has availability for a specific time
   * @param {string} performerId - Performer ID
   * @param {string} date - Date (YYYY-MM-DD)
   * @param {string} startTime - Start time (HH:MM:SS)
   * @param {string} endTime - End time (HH:MM:SS)
   * @returns {Promise<boolean>} Availability status
   */
  static async checkAvailability(performerId, date, startTime, endTime) {
    try {
      const sql = `
        SELECT COUNT(*) as count
        FROM ${AVAILABILITY_SLOTS_TABLE}
        WHERE performer_id = $1
        AND date = $2
        AND is_available = true
        AND is_booked = false
        AND (
          (start_time <= $3 AND end_time >= $4) OR
          (start_time <= $4 AND end_time >= $3) OR
          (start_time >= $3 AND end_time <= $4)
        )
      `;

      const result = await query(sql, [performerId, date, startTime, endTime]);
      const count = parseInt(result.rows[0].count);
      
      return count > 0;
    } catch (error) {
      logger.error('Error checking availability:', error);
      return false;
    }
  }
}

module.exports = PerformerModel;