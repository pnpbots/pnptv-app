const { query } = require('../../config/postgres');
const logger = require('../../utils/logger');

/**
 * Availability Service - Manages model availability for Meet & Greet system
 */
class AvailabilityService {
  /**
   * Add availability for a model
   * @param {number} modelId - Model ID
   * @param {Date} from - Start time
   * @param {Date} to - End time
   * @returns {Promise<Object>} Created availability
   */
  static async addAvailability(modelId, from, to) {
    try {
      // Check for conflicts
      const conflicts = await query(
        `SELECT * FROM pnp_availability
         WHERE model_id = $1
         AND ((available_from < $3 AND available_to > $2)
              OR (available_from < $4 AND available_to > $2)
              OR (available_from >= $2 AND available_to <= $3))`,
        [modelId, from, to, to]
      );

      if (conflicts.rows && conflicts.rows.length > 0) {
        throw new Error('Availability conflict detected');
      }

      const result = await query(
        `INSERT INTO pnp_availability (model_id, available_from, available_to)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [modelId, from, to]
      );

      const availability = result.rows && result.rows[0];
      logger.info('Availability added successfully', {
        availabilityId: availability?.id,
        modelId,
        from,
        to
      });
      return availability;
    } catch (error) {
      logger.error('Error adding availability:', error);
      throw new Error('Failed to add availability');
    }
  }

  /**
   * Get availability slot by ID
   * @param {number} availabilityId - Availability slot ID
   * @returns {Promise<Object|null>} Availability slot or null if not found
   */
  static async getAvailabilityById(availabilityId) {
    try {
      const result = await query(
        `SELECT * FROM pnp_availability WHERE id = $1`,
        [availabilityId]
      );

      return result.rows && result.rows.length > 0 ? result.rows[0] : null;
    } catch (error) {
      logger.error('Error getting availability by ID:', error);
      throw new Error('Failed to get availability');
    }
  }

  /**
   * Get availability for a model
   * @param {number} modelId - Model ID
   * @param {Date} startDate - Start date (optional)
   * @param {Date} endDate - End date (optional)
   * @returns {Promise<Array>} Array of availability slots
   */
  static async getAvailability(modelId, startDate = null, endDate = null) {
    try {
      let queryText = `SELECT * FROM pnp_availability WHERE model_id = $1`;
      let params = [modelId];
      
      if (startDate && endDate) {
        queryText += ` AND available_from >= $2 AND available_to <= $3`;
        params.push(startDate, endDate);
      } else if (startDate) {
        queryText += ` AND available_from >= $2`;
        params.push(startDate);
      } else if (endDate) {
        queryText += ` AND available_to <= $2`;
        params.push(endDate);
      }
      
      queryText += ` ORDER BY available_from`;

      const result = await query(queryText, params);
      return result.rows || [];
    } catch (error) {
      logger.error('Error getting availability:', error);
      throw new Error('Failed to get availability');
    }
  }

  /**
   * Update availability
   * @param {number} availabilityId - Availability ID
   * @param {Date} from - New start time
   * @param {Date} to - New end time
   * @returns {Promise<Object>} Updated availability
   */
  static async updateAvailability(availabilityId, from, to) {
    try {
      // Get current availability to check for conflicts
      const current = await query(
        `SELECT * FROM pnp_availability WHERE id = $1`,
        [availabilityId]
      );

      if (!current.rows || current.rows.length === 0) {
        throw new Error('Availability not found');
      }

      const modelId = current.rows[0].model_id;

      // Check for conflicts (excluding current availability)
      const conflicts = await query(
        `SELECT * FROM pnp_availability
         WHERE model_id = $1
         AND id != $2
         AND ((available_from < $4 AND available_to > $3)
              OR (available_from < $5 AND available_to > $3)
              OR (available_from >= $3 AND available_to <= $4))`,
        [modelId, availabilityId, from, to, to]
      );

      if (conflicts.rows && conflicts.rows.length > 0) {
        throw new Error('Availability conflict detected');
      }

      const result = await query(
        `UPDATE pnp_availability
         SET available_from = $2, available_to = $3, updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [availabilityId, from, to]
      );

      logger.info('Availability updated successfully', { availabilityId });
      return result.rows && result.rows[0];
    } catch (error) {
      logger.error('Error updating availability:', error);
      throw new Error('Failed to update availability');
    }
  }

  /**
   * Delete availability
   * @param {number} availabilityId - Availability ID
   * @returns {Promise<boolean>} True if successful
   */
  static async deleteAvailability(availabilityId) {
    try {
      const result = await query(
        `DELETE FROM pnp_availability WHERE id = $1 RETURNING id`,
        [availabilityId]
      );

      if (!result.rows || result.rows.length === 0) {
        throw new Error('Availability not found');
      }

      logger.info('Availability deleted successfully', { availabilityId });
      return true;
    } catch (error) {
      logger.error('Error deleting availability:', error);
      throw new Error('Failed to delete availability');
    }
  }

  /**
   * Book availability slot
   * @param {number} availabilityId - Availability ID
   * @param {number} bookingId - Booking ID
   * @returns {Promise<Object>} Updated availability
   */
  static async bookAvailability(availabilityId, bookingId) {
    try {
      const result = await query(
        `UPDATE pnp_availability
         SET is_booked = TRUE, booking_id = $2, updated_at = NOW()
         WHERE id = $1 AND is_booked = FALSE
         RETURNING *`,
        [availabilityId, bookingId]
      );

      if (!result.rows || result.rows.length === 0) {
        throw new Error('Availability not found or already booked');
      }

      logger.info('Availability booked successfully', {
        availabilityId,
        bookingId
      });
      return result.rows[0];
    } catch (error) {
      logger.error('Error booking availability:', error);
      throw new Error('Failed to book availability');
    }
  }

  /**
   * Release booked availability
   * @param {number} availabilityId - Availability ID
   * @returns {Promise<Object>} Updated availability
   */
  static async releaseAvailability(availabilityId) {
    try {
      const result = await query(
        `UPDATE pnp_availability
         SET is_booked = FALSE, booking_id = NULL, updated_at = NOW()
         WHERE id = $1 AND is_booked = TRUE
         RETURNING *`,
        [availabilityId]
      );

      if (!result.rows || result.rows.length === 0) {
        throw new Error('Availability not found or not booked');
      }

      logger.info('Availability released successfully', { availabilityId });
      return result.rows[0];
    } catch (error) {
      logger.error('Error releasing availability:', error);
      throw new Error('Failed to release availability');
    }
  }

  /**
   * Get available slots for a model
   * @param {number} modelId - Model ID
   * @param {Date} startDate - Start date
   * @param {Date} endDate - End date
   * @returns {Promise<Array>} Available slots
   */
  static async getAvailableSlots(modelId, startDate, endDate) {
    try {
      // Find slots where the start time falls within the date range
      const result = await query(
        `SELECT * FROM pnp_availability
         WHERE model_id = $1
         AND is_booked = FALSE
         AND available_from >= $2
         AND available_from < $3
         ORDER BY available_from`,
        [modelId, startDate, endDate]
      );

      return result.rows || [];
    } catch (error) {
      logger.error('Error getting available slots:', error);
      throw new Error('Failed to get available slots');
    }
  }

  /**
   * Bulk add availability for a model
   * @param {number} modelId - Model ID
   * @param {Array} slots - Array of {from, to} objects
   * @returns {Promise<Array>} Created availabilities
   */
  static async bulkAddAvailability(modelId, slots) {
    try {
      // Check for conflicts first
      for (const slot of slots) {
        const conflicts = await query(
          `SELECT * FROM pnp_availability
           WHERE model_id = $1
           AND ((available_from < $3 AND available_to > $2)
                OR (available_from < $4 AND available_to > $2)
                OR (available_from >= $2 AND available_to <= $3))`,
          [modelId, slot.from, slot.to, slot.to]
        );

        if (conflicts.rows && conflicts.rows.length > 0) {
          throw new Error(`Conflict detected for slot ${slot.from} to ${slot.to}`);
        }
      }

      // Insert all slots
      const createdSlots = [];
      for (const slot of slots) {
        const result = await query(
          `INSERT INTO pnp_availability (model_id, available_from, available_to)
           VALUES ($1, $2, $3)
           RETURNING *`,
          [modelId, slot.from, slot.to]
        );
        if (result.rows && result.rows[0]) {
          createdSlots.push(result.rows[0]);
        }
      }

      logger.info('Bulk availability added successfully', {
        modelId,
        count: createdSlots.length
      });
      return createdSlots;
    } catch (error) {
      logger.error('Error bulk adding availability:', error);
      throw new Error('Failed to bulk add availability');
    }
  }
}

module.exports = AvailabilityService;