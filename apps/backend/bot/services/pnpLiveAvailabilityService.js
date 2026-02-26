/**
 * PNP Live Unified Availability Service
 * Manages model online status, availability slots, and booking holds
 */

const { query, getClient } = require('../../config/postgres');
const { cache } = require('../../config/redis');
const logger = require('../../utils/logger');

// Constants
const HOLD_DURATION_MINUTES = 10; // How long a slot is held during payment
const PAYMENT_TIMEOUT_MINUTES = 15; // How long before unpaid booking expires
const AUTO_OFFLINE_DEFAULT_MINUTES = 240; // 4 hours
const OPERATING_HOURS = { start: 10, end: 22 }; // 10 AM - 10 PM
const VALID_DAYS = [0, 1, 4, 5, 6]; // Sun, Mon, Thu, Fri, Sat
const VALID_DURATIONS = [30, 60, 90];
const SLOT_BUFFER_MINUTES = 15;

class PNPLiveAvailabilityService {
  // ============================================================
  // MODEL ONLINE STATUS MANAGEMENT
  // ============================================================

  /**
   * Set model online status (self-service or admin)
   * @param {number} modelId - Model ID
   * @param {boolean} isOnline - Online status
   * @param {string} changedBy - User/admin who changed it
   * @param {string} source - Source: manual, auto, system, booking
   * @returns {Promise<Object>} Updated model
   */
  static async setModelOnlineStatus(modelId, isOnline, changedBy = 'system', source = 'manual') {
    const client = await getClient();

    try {
      await client.query('BEGIN');

      // Update model status
      const result = await client.query(
        `UPDATE pnp_models
         SET is_online = $2,
             last_activity_at = NOW(),
             last_online = CASE WHEN $2 = TRUE THEN NOW() ELSE last_online END,
             updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [modelId, isOnline]
      );

      if (!result.rows || result.rows.length === 0) {
        throw new Error('Model not found');
      }

      // Log status change for analytics
      await client.query(
        `INSERT INTO pnp_model_status_history (model_id, status, changed_by, source)
         VALUES ($1, $2, $3, $4)`,
        [modelId, isOnline ? 'online' : 'offline', changedBy, source]
      );

      await client.query('COMMIT');

      // Invalidate cache
      await cache.del(`pnp:model:status:${modelId}`);

      logger.info('Model online status updated', {
        modelId,
        isOnline,
        changedBy,
        source
      });

      return result.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error setting model online status:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Update model activity timestamp (heartbeat)
   * @param {number} modelId - Model ID
   * @returns {Promise<boolean>} Success
   */
  static async updateModelActivity(modelId) {
    try {
      await query(
        `UPDATE pnp_models
         SET last_activity_at = NOW()
         WHERE id = $1 AND is_online = TRUE`,
        [modelId]
      );
      return true;
    } catch (error) {
      logger.error('Error updating model activity:', error);
      return false;
    }
  }

  /**
   * Auto-offline models that have been inactive
   * Called by worker job
   * @returns {Promise<number>} Count of models set offline
   */
  static async autoOfflineInactiveModels() {
    try {
      const result = await query(
        `SELECT auto_offline_inactive_models() as count`
      );

      const count = result.rows?.[0]?.count || 0;

      if (count > 0) {
        logger.info('Auto-offlined inactive models', { count });
      }

      return count;
    } catch (error) {
      logger.error('Error auto-offlining models:', error);
      return 0;
    }
  }

  /**
   * Get model online status with caching
   * @param {number} modelId - Model ID
   * @returns {Promise<Object>} Status info
   */
  static async getModelOnlineStatus(modelId) {
    const cacheKey = `pnp:model:status:${modelId}`;

    try {
      // Check cache
      const cached = await cache.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }

      const result = await query(
        `SELECT id, name, is_online, is_active, last_online, last_activity_at,
                can_instant_book, status_message, auto_offline_minutes
         FROM pnp_models WHERE id = $1`,
        [modelId]
      );

      if (!result.rows || result.rows.length === 0) {
        return null;
      }

      const status = result.rows[0];

      // Cache for 30 seconds
      await cache.setex(cacheKey, 30, JSON.stringify(status));

      return status;
    } catch (error) {
      logger.error('Error getting model online status:', error);
      return null;
    }
  }

  /**
   * Set model status message
   * @param {number} modelId - Model ID
   * @param {string} message - Status message (max 200 chars)
   * @returns {Promise<Object>} Updated model
   */
  static async setModelStatusMessage(modelId, message) {
    try {
      const result = await query(
        `UPDATE pnp_models
         SET status_message = $2, updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [modelId, message?.substring(0, 200)]
      );

      await cache.del(`pnp:model:status:${modelId}`);

      return result.rows?.[0];
    } catch (error) {
      logger.error('Error setting model status message:', error);
      throw error;
    }
  }

  // ============================================================
  // SCHEDULE MANAGEMENT
  // ============================================================

  /**
   * Set model recurring schedule
   * @param {number} modelId - Model ID
   * @param {Array} schedules - Array of {dayOfWeek, startTime, endTime}
   * @returns {Promise<Array>} Created schedules
   */
  static async setModelSchedule(modelId, schedules) {
    const client = await getClient();

    try {
      await client.query('BEGIN');

      // Clear existing schedules
      await client.query(
        `DELETE FROM pnp_model_schedules WHERE model_id = $1`,
        [modelId]
      );

      // Insert new schedules
      const created = [];
      for (const schedule of schedules) {
        const result = await client.query(
          `INSERT INTO pnp_model_schedules
           (model_id, day_of_week, start_time, end_time, is_active)
           VALUES ($1, $2, $3, $4, TRUE)
           RETURNING *`,
          [modelId, schedule.dayOfWeek, schedule.startTime, schedule.endTime]
        );
        if (result.rows?.[0]) {
          created.push(result.rows[0]);
        }
      }

      await client.query('COMMIT');

      logger.info('Model schedule set', { modelId, count: created.length });
      return created;
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error setting model schedule:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get model schedule
   * @param {number} modelId - Model ID
   * @returns {Promise<Array>} Schedules
   */
  static async getModelSchedule(modelId) {
    try {
      const result = await query(
        `SELECT * FROM pnp_model_schedules
         WHERE model_id = $1 AND is_active = TRUE
         ORDER BY day_of_week, start_time`,
        [modelId]
      );
      return result.rows || [];
    } catch (error) {
      logger.error('Error getting model schedule:', error);
      return [];
    }
  }

  /**
   * Add blocked date for model
   * @param {number} modelId - Model ID
   * @param {Date} date - Date to block
   * @param {string} reason - Reason for blocking
   * @returns {Promise<Object>} Created blocked date
   */
  static async addBlockedDate(modelId, date, reason = null) {
    try {
      const result = await query(
        `INSERT INTO pnp_model_blocked_dates (model_id, blocked_date, reason)
         VALUES ($1, $2, $3)
         ON CONFLICT (model_id, blocked_date) DO UPDATE SET reason = $3
         RETURNING *`,
        [modelId, date, reason]
      );
      return result.rows?.[0];
    } catch (error) {
      logger.error('Error adding blocked date:', error);
      throw error;
    }
  }

  /**
   * Remove blocked date
   * @param {number} modelId - Model ID
   * @param {Date} date - Date to unblock
   * @returns {Promise<boolean>} Success
   */
  static async removeBlockedDate(modelId, date) {
    try {
      await query(
        `DELETE FROM pnp_model_blocked_dates WHERE model_id = $1 AND blocked_date = $2`,
        [modelId, date]
      );
      return true;
    } catch (error) {
      logger.error('Error removing blocked date:', error);
      return false;
    }
  }

  /**
   * Get blocked dates for model
   * @param {number} modelId - Model ID
   * @param {Date} startDate - Start of range
   * @param {Date} endDate - End of range
   * @returns {Promise<Array>} Blocked dates
   */
  static async getBlockedDates(modelId, startDate, endDate) {
    try {
      const result = await query(
        `SELECT * FROM pnp_model_blocked_dates
         WHERE model_id = $1
         AND blocked_date >= $2
         AND blocked_date <= $3
         ORDER BY blocked_date`,
        [modelId, startDate, endDate]
      );
      return result.rows || [];
    } catch (error) {
      logger.error('Error getting blocked dates:', error);
      return [];
    }
  }

  /**
   * Generate availability from recurring schedule
   * @param {number} modelId - Model ID
   * @param {Date} startDate - Start date
   * @param {Date} endDate - End date
   * @returns {Promise<number>} Count of slots created
   */
  static async generateRecurringAvailability(modelId, startDate, endDate) {
    try {
      const result = await query(
        `SELECT generate_recurring_availability($1, $2, $3) as count`,
        [modelId, startDate, endDate]
      );
      const count = result.rows?.[0]?.count || 0;
      logger.info('Generated recurring availability', { modelId, count });
      return count;
    } catch (error) {
      logger.error('Error generating recurring availability:', error);
      return 0;
    }
  }

  // ============================================================
  // AVAILABILITY SLOT MANAGEMENT
  // ============================================================

  /**
   * Get available slots for booking (unified approach)
   * Combines database slots with generated slots, checking conflicts
   * @param {number} modelId - Model ID
   * @param {Date} date - Date to check
   * @param {number} durationMinutes - Duration (30, 60, 90)
   * @returns {Promise<Array>} Available slots
   */
  static async getAvailableSlots(modelId, date, durationMinutes) {
    if (!VALID_DURATIONS.includes(durationMinutes)) {
      throw new Error('Invalid duration');
    }

    try {
      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);

      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);

      // Check if day is blocked
      const blocked = await query(
        `SELECT 1 FROM pnp_model_blocked_dates
         WHERE model_id = $1 AND blocked_date = $2`,
        [modelId, startOfDay]
      );

      if (blocked.rows?.length > 0) {
        return [];
      }

      // Check day of week
      const dayOfWeek = startOfDay.getDay();
      if (!VALID_DAYS.includes(dayOfWeek)) {
        return [];
      }

      // Get existing bookings for the day
      const existingBookings = await query(
        `SELECT booking_time, duration_minutes
         FROM pnp_bookings
         WHERE model_id = $1
         AND DATE(booking_time) = DATE($2)
         AND status NOT IN ('cancelled', 'refunded')`,
        [modelId, date]
      );

      // Get held slots
      const heldSlots = await query(
        `SELECT available_from, available_to
         FROM pnp_availability
         WHERE model_id = $1
         AND DATE(available_from) = DATE($2)
         AND hold_user_id IS NOT NULL
         AND hold_expires_at > NOW()`,
        [modelId, date]
      );

      // Generate time slots
      const slots = [];
      const now = new Date();
      const slotDurationWithBuffer = durationMinutes + SLOT_BUFFER_MINUTES;

      for (let hour = OPERATING_HOURS.start; hour < OPERATING_HOURS.end; hour++) {
        for (let minute = 0; minute < 60; minute += slotDurationWithBuffer) {
          const slotStart = new Date(startOfDay);
          slotStart.setHours(hour, minute, 0, 0);

          const slotEnd = new Date(slotStart);
          slotEnd.setMinutes(slotEnd.getMinutes() + durationMinutes);

          // Skip if slot ends after operating hours
          if (slotEnd.getHours() > OPERATING_HOURS.end ||
              (slotEnd.getHours() === OPERATING_HOURS.end && slotEnd.getMinutes() > 0)) {
            continue;
          }

          // Skip if in the past
          if (slotStart <= now) {
            continue;
          }

          // Check for booking conflicts
          const hasBookingConflict = existingBookings.rows?.some(booking => {
            const bookingStart = new Date(booking.booking_time);
            const bookingEnd = new Date(bookingStart);
            bookingEnd.setMinutes(bookingEnd.getMinutes() + booking.duration_minutes);

            return (slotStart < bookingEnd && slotEnd > bookingStart);
          });

          if (hasBookingConflict) {
            continue;
          }

          // Check for hold conflicts
          const hasHoldConflict = heldSlots.rows?.some(hold => {
            const holdStart = new Date(hold.available_from);
            const holdEnd = new Date(hold.available_to);

            return (slotStart < holdEnd && slotEnd > holdStart);
          });

          if (hasHoldConflict) {
            continue;
          }

          slots.push({
            model_id: modelId,
            available_from: slotStart,
            available_to: slotEnd,
            duration_minutes: durationMinutes,
            is_available: true
          });
        }
      }

      return slots;
    } catch (error) {
      logger.error('Error getting available slots:', error);
      return [];
    }
  }

  /**
   * Hold a slot temporarily during payment process
   * @param {number} modelId - Model ID
   * @param {Date} slotStart - Slot start time
   * @param {Date} slotEnd - Slot end time
   * @param {string} userId - User holding the slot
   * @returns {Promise<Object>} Hold record
   */
  static async holdSlot(modelId, slotStart, slotEnd, userId) {
    const client = await getClient();

    try {
      await client.query('BEGIN');

      // Check for conflicts (existing bookings or holds)
      const conflicts = await client.query(
        `SELECT 1 FROM pnp_bookings
         WHERE model_id = $1
         AND booking_time < $3
         AND booking_time + (duration_minutes || ' minutes')::INTERVAL > $2
         AND status NOT IN ('cancelled', 'refunded')
         UNION ALL
         SELECT 1 FROM pnp_availability
         WHERE model_id = $1
         AND available_from < $3
         AND available_to > $2
         AND hold_user_id IS NOT NULL
         AND hold_expires_at > NOW()`,
        [modelId, slotStart, slotEnd]
      );

      if (conflicts.rows?.length > 0) {
        throw new Error('Slot is no longer available');
      }

      const holdExpiresAt = new Date();
      holdExpiresAt.setMinutes(holdExpiresAt.getMinutes() + HOLD_DURATION_MINUTES);

      // Create or update hold record
      const result = await client.query(
        `INSERT INTO pnp_availability
         (model_id, available_from, available_to, hold_user_id, hold_expires_at, slot_type)
         VALUES ($1, $2, $3, $4, $5, 'generated')
         ON CONFLICT (model_id, available_from) DO UPDATE
         SET hold_user_id = $4, hold_expires_at = $5, updated_at = NOW()
         RETURNING *`,
        [modelId, slotStart, slotEnd, userId, holdExpiresAt]
      );

      await client.query('COMMIT');

      logger.info('Slot held', {
        modelId,
        slotStart,
        userId,
        expiresAt: holdExpiresAt
      });

      return result.rows?.[0];
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error holding slot:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Release a held slot
   * @param {number} modelId - Model ID
   * @param {Date} slotStart - Slot start time
   * @param {string} userId - User who held the slot
   * @returns {Promise<boolean>} Success
   */
  static async releaseHold(modelId, slotStart, userId) {
    try {
      const result = await query(
        `UPDATE pnp_availability
         SET hold_user_id = NULL, hold_expires_at = NULL, updated_at = NOW()
         WHERE model_id = $1
         AND available_from = $2
         AND hold_user_id = $3
         RETURNING id`,
        [modelId, slotStart, userId]
      );

      if (result.rows?.length > 0) {
        logger.info('Hold released', { modelId, slotStart, userId });
        return true;
      }
      return false;
    } catch (error) {
      logger.error('Error releasing hold:', error);
      return false;
    }
  }

  /**
   * Release all expired holds (called by worker)
   * @returns {Promise<number>} Count of released holds
   */
  static async releaseExpiredHolds() {
    try {
      const result = await query(`SELECT release_expired_holds() as count`);
      const count = result.rows?.[0]?.count || 0;

      if (count > 0) {
        logger.info('Released expired holds', { count });
      }

      return count;
    } catch (error) {
      logger.error('Error releasing expired holds:', error);
      return 0;
    }
  }

  /**
   * Convert hold to confirmed booking
   * @param {number} modelId - Model ID
   * @param {Date} slotStart - Slot start time
   * @param {string} userId - User ID
   * @param {number} bookingId - Booking ID
   * @returns {Promise<Object>} Updated availability
   */
  static async confirmSlotBooking(modelId, slotStart, userId, bookingId) {
    try {
      const result = await query(
        `UPDATE pnp_availability
         SET is_booked = TRUE,
             booking_id = $4,
             hold_user_id = NULL,
             hold_expires_at = NULL,
             updated_at = NOW()
         WHERE model_id = $1
         AND available_from = $2
         AND (hold_user_id = $3 OR hold_user_id IS NULL)
         RETURNING *`,
        [modelId, slotStart, userId, bookingId]
      );

      logger.info('Slot booking confirmed', { modelId, slotStart, bookingId });
      return result.rows?.[0];
    } catch (error) {
      logger.error('Error confirming slot booking:', error);
      throw error;
    }
  }

  // ============================================================
  // ADMIN OPERATIONS
  // ============================================================

  /**
   * Manually add availability slot (admin)
   * @param {number} modelId - Model ID
   * @param {Date} from - Start time
   * @param {Date} to - End time
   * @returns {Promise<Object>} Created slot
   */
  static async addManualSlot(modelId, from, to) {
    try {
      // Check for conflicts
      const conflicts = await query(
        `SELECT 1 FROM pnp_availability
         WHERE model_id = $1
         AND available_from < $3
         AND available_to > $2`,
        [modelId, from, to]
      );

      if (conflicts.rows?.length > 0) {
        throw new Error('Slot conflicts with existing availability');
      }

      const result = await query(
        `INSERT INTO pnp_availability
         (model_id, available_from, available_to, slot_type)
         VALUES ($1, $2, $3, 'manual')
         RETURNING *`,
        [modelId, from, to]
      );

      logger.info('Manual slot added', { modelId, from, to });
      return result.rows?.[0];
    } catch (error) {
      logger.error('Error adding manual slot:', error);
      throw error;
    }
  }

  /**
   * Delete availability slot (admin)
   * @param {number} slotId - Slot ID
   * @returns {Promise<boolean>} Success
   */
  static async deleteSlot(slotId) {
    try {
      const result = await query(
        `DELETE FROM pnp_availability
         WHERE id = $1
         AND is_booked = FALSE
         RETURNING id`,
        [slotId]
      );

      if (result.rows?.length === 0) {
        throw new Error('Slot not found or already booked');
      }

      logger.info('Slot deleted', { slotId });
      return true;
    } catch (error) {
      logger.error('Error deleting slot:', error);
      throw error;
    }
  }

  /**
   * Get availability calendar for admin
   * @param {number} modelId - Model ID
   * @param {Date} startDate - Start date
   * @param {Date} endDate - End date
   * @returns {Promise<Object>} Calendar data
   */
  static async getAvailabilityCalendar(modelId, startDate, endDate) {
    try {
      // Get all slots
      const slots = await query(
        `SELECT * FROM pnp_availability
         WHERE model_id = $1
         AND available_from >= $2
         AND available_from <= $3
         ORDER BY available_from`,
        [modelId, startDate, endDate]
      );

      // Get all bookings
      const bookings = await query(
        `SELECT * FROM pnp_bookings
         WHERE model_id = $1
         AND booking_time >= $2
         AND booking_time <= $3
         AND status NOT IN ('cancelled', 'refunded')
         ORDER BY booking_time`,
        [modelId, startDate, endDate]
      );

      // Get blocked dates
      const blocked = await query(
        `SELECT * FROM pnp_model_blocked_dates
         WHERE model_id = $1
         AND blocked_date >= $2
         AND blocked_date <= $3
         ORDER BY blocked_date`,
        [modelId, startDate, endDate]
      );

      return {
        slots: slots.rows || [],
        bookings: bookings.rows || [],
        blockedDates: blocked.rows || []
      };
    } catch (error) {
      logger.error('Error getting availability calendar:', error);
      return { slots: [], bookings: [], blockedDates: [] };
    }
  }

  /**
   * Get all online models
   * @returns {Promise<Array>} Online models
   */
  static async getOnlineModels() {
    try {
      const result = await query(
        `SELECT id, name, is_online, avg_rating, total_shows, can_instant_book, status_message
         FROM pnp_models
         WHERE is_active = TRUE AND is_online = TRUE
         ORDER BY avg_rating DESC, total_shows DESC`
      );
      return result.rows || [];
    } catch (error) {
      logger.error('Error getting online models:', error);
      return [];
    }
  }
}

module.exports = PNPLiveAvailabilityService;
