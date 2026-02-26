/**
 * Comprehensive Availability Management Service
 * Advanced availability system with recurring schedules, blocked dates, and smart booking integration
 */

const { query, getClient } = require('../config/postgres');
const logger = require('../utils/logger');
const { cache } = require('../config/redis');

// Constants
const DEFAULT_SLOT_DURATIONS = [30, 60, 90]; // minutes
const MAX_ADVANCE_BOOKING_DAYS = 90; // 3 months
const MIN_ADVANCE_BOOKING_MINUTES = 30; // 30 minutes
const BUFFER_TIME_MINUTES = 15; // 15 minutes between slots
const HOLD_DURATION_MINUTES = 10; // 10 minutes for payment hold

class ComprehensiveAvailabilityService {
  // ============================================================
  // CORE AVAILABILITY MANAGEMENT
  // ============================================================

  /**
   * Get comprehensive availability settings for a model
   * @param {number} modelId - Model ID
   * @returns {Promise<Object>} Complete availability configuration
   */
  static async getModelAvailabilitySettings(modelId) {
    try {
      const cacheKey = `availability:settings:${modelId}`;
      const cached = await cache.get(cacheKey);

      if (cached) {
        return JSON.parse(cached);
      }

      const client = await getClient();

      try {
        await client.query('BEGIN');

        // Get model settings
        const modelResult = await client.query(
          `SELECT 
           id, name, is_online, can_instant_book,
           auto_offline_minutes, status_message,
           last_activity_at, created_at
           FROM pnp_models WHERE id = $1`,
          [modelId]
        );

        if (!modelResult.rows || modelResult.rows.length === 0) {
          throw new Error('Model not found');
        }

        const model = modelResult.rows[0];

        // Get recurring schedules
        const schedulesResult = await client.query(
          `SELECT * FROM pnp_model_schedules 
           WHERE model_id = $1 ORDER BY day_of_week, start_time`,
          [modelId]
        );

        // Get blocked dates
        const blockedDatesResult = await client.query(
          `SELECT * FROM pnp_model_blocked_dates 
           WHERE model_id = $1 ORDER BY blocked_date`,
          [modelId]
        );

        // Get manual availability slots
        const availabilityResult = await client.query(
          `SELECT * FROM pnp_availability 
           WHERE model_id = $1 
           AND available_from > NOW() 
           ORDER BY available_from`,
          [modelId]
        );

        // Get existing bookings
        const bookingsResult = await client.query(
          `SELECT * FROM pnp_bookings 
           WHERE model_id = $1 
           AND booking_time > NOW() 
           ORDER BY booking_time`,
          [modelId]
        );

        await client.query('COMMIT');

        const settings = {
          modelInfo: model,
          recurringSchedules: schedulesResult.rows || [],
          blockedDates: blockedDatesResult.rows || [],
          manualAvailability: availabilityResult.rows || [],
          upcomingBookings: bookingsResult.rows || [],
          statistics: this._calculateAvailabilityStatistics(
            schedulesResult.rows,
            availabilityResult.rows,
            bookingsResult.rows
          )
        };

        await cache.setex(cacheKey, 300, JSON.stringify(settings));
        return settings;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      logger.error('Error getting model availability settings:', error);
      throw new Error('Failed to retrieve availability settings');
    }
  }

  /**
   * Calculate availability statistics
   */
  static _calculateAvailabilityStatistics(schedules, availability, bookings) {
    const now = new Date();
    const stats = {
      totalRecurringSlots: schedules.length,
      totalManualSlots: availability.length,
      totalUpcomingBookings: bookings.length,
      bookedSlots: 0,
      availableSlots: 0,
      utilizationRate: 0,
      nextAvailableSlot: null,
      nextBooking: null
    };

    // Count booked slots
    stats.bookedSlots = availability.filter(slot => slot.is_booked).length;
    stats.availableSlots = availability.filter(slot => !slot.is_booked).length;

    // Calculate utilization rate
    const totalSlots = stats.totalManualSlots + stats.totalRecurringSlots;
    stats.utilizationRate = totalSlots > 0 
      ? Math.round((stats.bookedSlots / totalSlots) * 100) 
      : 0;

    // Find next available slot
    const availableSlots = availability.filter(slot => !slot.is_booked && new Date(slot.available_from) > now);
    if (availableSlots.length > 0) {
      stats.nextAvailableSlot = availableSlots.sort((a, b) => 
        new Date(a.available_from) - new Date(b.available_from)
      )[0];
    }

    // Find next booking
    const upcomingBookings = bookings.filter(b => new Date(b.booking_time) > now);
    if (upcomingBookings.length > 0) {
      stats.nextBooking = upcomingBookings.sort((a, b) => 
        new Date(a.booking_time) - new Date(b.booking_time)
      )[0];
    }

    return stats;
  }

  // ============================================================
  // RECURRING SCHEDULE MANAGEMENT
  // ============================================================

  /**
   * Add recurring schedule for a model
   * @param {number} modelId - Model ID
   * @param {Object} scheduleData - Schedule data
   * @returns {Promise<Object>} Created schedule
   */
  static async addRecurringSchedule(modelId, scheduleData) {
    try {
      const { dayOfWeek, startTime, endTime, isActive = true } = scheduleData;

      // Validate input
      if (dayOfWeek < 0 || dayOfWeek > 6) {
        throw new Error('Invalid day of week (0-6)');
      }

      if (startTime >= endTime) {
        throw new Error('Start time must be before end time');
      }

      // Check for conflicts
      const conflicts = await query(
        `SELECT * FROM pnp_model_schedules 
         WHERE model_id = $1 
         AND day_of_week = $2 
         AND ((start_time < $4 AND end_time > $3) 
              OR (start_time < $5 AND end_time > $3) 
              OR (start_time >= $3 AND end_time <= $4))`,
        [modelId, dayOfWeek, startTime, endTime, endTime]
      );

      if (conflicts.rows && conflicts.rows.length > 0) {
        throw new Error('Schedule conflict detected');
      }

      const result = await query(
        `INSERT INTO pnp_model_schedules 
         (model_id, day_of_week, start_time, end_time, is_active)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [modelId, dayOfWeek, startTime, endTime, isActive]
      );

      // Invalidate cache
      await cache.del(`availability:settings:${modelId}`);

      logger.info('Recurring schedule added', {
        scheduleId: result.rows[0].id,
        modelId,
        dayOfWeek,
        startTime,
        endTime
      });

      return result.rows[0];
    } catch (error) {
      logger.error('Error adding recurring schedule:', error);
      throw new Error('Failed to add recurring schedule');
    }
  }

  /**
   * Update recurring schedule
   * @param {number} scheduleId - Schedule ID
   * @param {Object} updates - Updates to apply
   * @returns {Promise<Object>} Updated schedule
   */
  static async updateRecurringSchedule(scheduleId, updates) {
    try {
      const { dayOfWeek, startTime, endTime, isActive } = updates;

      // Get current schedule
      const current = await query(
        `SELECT * FROM pnp_model_schedules WHERE id = $1`,
        [scheduleId]
      );

      if (!current.rows || current.rows.length === 0) {
        throw new Error('Schedule not found');
      }

      const modelId = current.rows[0].model_id;
      const currentDay = current.rows[0].day_of_week;
      const currentStart = current.rows[0].start_time;
      const currentEnd = current.rows[0].end_time;

      // Validate updates
      if (dayOfWeek !== undefined && (dayOfWeek < 0 || dayOfWeek > 6)) {
        throw new Error('Invalid day of week (0-6)');
      }

      if ((startTime !== undefined || endTime !== undefined) && 
          (startTime >= endTime || 
           (startTime === undefined && endTime <= currentStart) ||
           (endTime === undefined && startTime >= currentEnd))) {
        throw new Error('Start time must be before end time');
      }

      // Check for conflicts (excluding current schedule)
      const conflictCheck = await query(
        `SELECT * FROM pnp_model_schedules 
         WHERE model_id = $1 
         AND id != $2 
         AND day_of_week = COALESCE($3, day_of_week) 
         AND ((start_time < COALESCE($5, end_time) AND end_time > COALESCE($4, start_time)) 
              OR (start_time < COALESCE($6, end_time) AND end_time > COALESCE($4, start_time)) 
              OR (start_time >= COALESCE($4, start_time) AND end_time <= COALESCE($5, end_time)))`,
        [modelId, scheduleId, dayOfWeek, startTime, endTime, endTime]
      );

      if (conflictCheck.rows && conflictCheck.rows.length > 0) {
        throw new Error('Schedule conflict detected');
      }

      // Build update query
      const updatesArray = [];
      const params = [scheduleId];
      let paramIndex = 2;

      if (dayOfWeek !== undefined) {
        updatesArray.push(`day_of_week = $${paramIndex}`);
        params.push(dayOfWeek);
        paramIndex++;
      }

      if (startTime !== undefined) {
        updatesArray.push(`start_time = $${paramIndex}`);
        params.push(startTime);
        paramIndex++;
      }

      if (endTime !== undefined) {
        updatesArray.push(`end_time = $${paramIndex}`);
        params.push(endTime);
        paramIndex++;
      }

      if (isActive !== undefined) {
        updatesArray.push(`is_active = $${paramIndex}`);
        params.push(isActive);
        paramIndex++;
      }

      updatesArray.push(`updated_at = NOW()`);

      const result = await query(
        `UPDATE pnp_model_schedules 
         SET ${updatesArray.join(', ')} 
         WHERE id = $1 
         RETURNING *`,
        params
      );

      // Invalidate cache
      await cache.del(`availability:settings:${modelId}`);

      logger.info('Recurring schedule updated', { scheduleId });
      return result.rows[0];
    } catch (error) {
      logger.error('Error updating recurring schedule:', error);
      throw new Error('Failed to update recurring schedule');
    }
  }

  /**
   * Delete recurring schedule
   * @param {number} scheduleId - Schedule ID
   * @returns {Promise<boolean>} Success
   */
  static async deleteRecurringSchedule(scheduleId) {
    try {
      const current = await query(
        `SELECT model_id FROM pnp_model_schedules WHERE id = $1`,
        [scheduleId]
      );

      if (!current.rows || current.rows.length === 0) {
        throw new Error('Schedule not found');
      }

      const modelId = current.rows[0].model_id;

      await query(
        `DELETE FROM pnp_model_schedules WHERE id = $1`,
        [scheduleId]
      );

      // Invalidate cache
      await cache.del(`availability:settings:${modelId}`);

      logger.info('Recurring schedule deleted', { scheduleId });
      return true;
    } catch (error) {
      logger.error('Error deleting recurring schedule:', error);
      throw new Error('Failed to delete recurring schedule');
    }
  }

  // ============================================================
  // BLOCKED DATES MANAGEMENT
  // ============================================================

  /**
   * Add blocked date for a model
   * @param {number} modelId - Model ID
   * @param {Date} date - Date to block
   * @param {string} reason - Reason for blocking
   * @returns {Promise<Object>} Created blocked date
   */
  static async addBlockedDate(modelId, date, reason = '') {
    try {
      // Validate date
      const dateObj = new Date(date);
      if (isNaN(dateObj.getTime())) {
        throw new Error('Invalid date');
      }

      // Check if already blocked
      const existing = await query(
        `SELECT * FROM pnp_model_blocked_dates 
         WHERE model_id = $1 AND blocked_date = $2`,
        [modelId, dateObj.toISOString().split('T')[0]]
      );

      if (existing.rows && existing.rows.length > 0) {
        throw new Error('Date already blocked');
      }

      const result = await query(
        `INSERT INTO pnp_model_blocked_dates 
         (model_id, blocked_date, reason)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [modelId, dateObj.toISOString().split('T')[0], reason]
      );

      // Invalidate cache
      await cache.del(`availability:settings:${modelId}`);

      logger.info('Blocked date added', {
        blockedDateId: result.rows[0].id,
        modelId,
        date: dateObj.toISOString().split('T')[0]
      });

      return result.rows[0];
    } catch (error) {
      logger.error('Error adding blocked date:', error);
      throw new Error('Failed to add blocked date');
    }
  }

  /**
   * Delete blocked date
   * @param {number} blockedDateId - Blocked date ID
   * @returns {Promise<boolean>} Success
   */
  static async deleteBlockedDate(blockedDateId) {
    try {
      const current = await query(
        `SELECT model_id FROM pnp_model_blocked_dates WHERE id = $1`,
        [blockedDateId]
      );

      if (!current.rows || current.rows.length === 0) {
        throw new Error('Blocked date not found');
      }

      const modelId = current.rows[0].model_id;

      await query(
        `DELETE FROM pnp_model_blocked_dates WHERE id = $1`,
        [blockedDateId]
      );

      // Invalidate cache
      await cache.del(`availability:settings:${modelId}`);

      logger.info('Blocked date deleted', { blockedDateId });
      return true;
    } catch (error) {
      logger.error('Error deleting blocked date:', error);
      throw new Error('Failed to delete blocked date');
    }
  }

  // ============================================================
  // SMART AVAILABILITY GENERATION
  // ============================================================

  /**
   * Generate availability slots from recurring schedules
   * @param {number} modelId - Model ID
   * @param {Date} startDate - Start date for generation
   * @param {Date} endDate - End date for generation
   * @returns {Promise<Array>} Generated availability slots
   */
  static async generateAvailabilityFromSchedules(modelId, startDate, endDate) {
    try {
      const client = await getClient();

      try {
        await client.query('BEGIN');

        // Get recurring schedules
        const schedules = await client.query(
          `SELECT * FROM pnp_model_schedules 
           WHERE model_id = $1 AND is_active = TRUE`,
          [modelId]
        );

        // Get blocked dates
        const blockedDates = await client.query(
          `SELECT blocked_date FROM pnp_model_blocked_dates 
           WHERE model_id = $1`,
          [modelId]
        );

        const blockedDateSet = new Set(blockedDates.rows.map(row => row.blocked_date));

        const generatedSlots = [];
        const currentDate = new Date(startDate);
        const endDateObj = new Date(endDate);

        while (currentDate <= endDateObj) {
          const dayOfWeek = currentDate.getDay();
          const dateStr = currentDate.toISOString().split('T')[0];

          // Skip blocked dates
          if (blockedDateSet.has(dateStr)) {
            currentDate.setDate(currentDate.getDate() + 1);
            continue;
          }

          // Find schedules for this day
          const daySchedules = schedules.rows.filter(s => s.day_of_week === dayOfWeek);

          for (const schedule of daySchedules) {
            // Calculate slot times
            const slotDate = new Date(dateStr);
            const [startHours, startMinutes] = schedule.start_time.split(':').map(Number);
            const [endHours, endMinutes] = schedule.end_time.split(':').map(Number);

            const slotStart = new Date(slotDate);
            slotStart.setHours(startHours, startMinutes, 0, 0);

            const slotEnd = new Date(slotDate);
            slotEnd.setHours(endHours, endMinutes, 0, 0);

            // Check for conflicts with existing availability
            const conflicts = await client.query(
              `SELECT * FROM pnp_availability 
               WHERE model_id = $1 
               AND ((available_from < $3 AND available_to > $2) 
                    OR (available_from < $4 AND available_to > $2) 
                    OR (available_from >= $2 AND available_to <= $3))`,
              [modelId, slotStart, slotEnd, slotEnd]
            );

            if (conflicts.rows && conflicts.rows.length === 0) {
              // Add the slot
              const result = await client.query(
                `INSERT INTO pnp_availability 
                 (model_id, available_from, available_to, slot_type)
                 VALUES ($1, $2, $3, 'recurring')
                 RETURNING *`,
                [modelId, slotStart, slotEnd]
              );

              generatedSlots.push(result.rows[0]);
            }
          }

          currentDate.setDate(currentDate.getDate() + 1);
        }

        await client.query('COMMIT');

        // Invalidate cache
        await cache.del(`availability:settings:${modelId}`);

        logger.info('Generated availability from schedules', {
          modelId,
          count: generatedSlots.length,
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString()
        });

        return generatedSlots;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      logger.error('Error generating availability from schedules:', error);
      throw new Error('Failed to generate availability');
    }
  }

  // ============================================================
  // SMART BOOKING INTEGRATION
  // ============================================================

  /**
   * Find available slots for booking with smart matching
   * @param {number} modelId - Model ID
   * @param {number} durationMinutes - Desired duration
   * @param {Date} preferredStart - Preferred start time
   * @param {Date} searchStart - Search start time
   * @param {Date} searchEnd - Search end time
   * @returns {Promise<Array>} Available slots with match scores
   */
  static async findSmartAvailableSlots(modelId, durationMinutes, preferredStart, searchStart, searchEnd) {
    try {
      // Validate duration
      if (!DEFAULT_SLOT_DURATIONS.includes(durationMinutes)) {
        throw new Error(`Invalid duration. Must be one of: ${DEFAULT_SLOT_DURATIONS.join(', ')}`);
      }

      // Get all available slots
      const slots = await query(
        `SELECT * FROM pnp_availability 
         WHERE model_id = $1 
         AND is_booked = FALSE 
         AND available_from >= $2 
         AND available_from <= $3 
         AND available_to > NOW() 
         ORDER BY available_from`,
        [modelId, searchStart, searchEnd]
      );

      const availableSlots = [];
      const preferredStartDate = new Date(preferredStart);

      for (const slot of slots.rows) {
        const slotStart = new Date(slot.available_from);
        const slotEnd = new Date(slot.available_to);
        const slotDuration = (slotEnd - slotStart) / (1000 * 60);

        // Check if slot can accommodate the requested duration
        if (slotDuration >= durationMinutes) {
          // Calculate match score
          const matchScore = this._calculateSlotMatchScore(
            slotStart, 
            preferredStartDate, 
            durationMinutes
          );

          availableSlots.push({
            ...slot,
            matchScore,
            timeDifferenceMinutes: Math.abs((slotStart - preferredStartDate) / (1000 * 60))
          });
        }
      }

      // Sort by match score (highest first)
      return availableSlots.sort((a, b) => b.matchScore - a.matchScore);
    } catch (error) {
      logger.error('Error finding smart available slots:', error);
      throw new Error('Failed to find available slots');
    }
  }

  /**
   * Calculate slot match score based on preference matching
   */
  static _calculateSlotMatchScore(slotStart, preferredStart, durationMinutes) {
    const timeDiffMinutes = Math.abs((slotStart - preferredStart) / (1000 * 60));

    // Score components
    let score = 100; // Base score

    // Time proximity (0-50 points)
    if (timeDiffMinutes === 0) {
      score += 50; // Perfect match
    } else if (timeDiffMinutes <= 30) {
      score += 40; // Very close
    } else if (timeDiffMinutes <= 60) {
      score += 30; // Close
    } else if (timeDiffMinutes <= 120) {
      score += 20; // Reasonable
    } else if (timeDiffMinutes <= 240) {
      score += 10; // Far
    }

    // Duration match (0-30 points)
    const slotDuration = (new Date(slotStart.getTime() + durationMinutes * 60 * 1000) - slotStart) / (1000 * 60);
    if (slotDuration === durationMinutes) {
      score += 30; // Exact duration match
    } else if (slotDuration > durationMinutes) {
      score += 20; // Can accommodate
    }

    // Day of week preference (0-20 points)
    if (slotStart.getDay() === preferredStart.getDay()) {
      score += 20; // Same day of week
    }

    return Math.min(score, 100); // Cap at 100
  }

  /**
   * Hold a slot for booking (with expiration)
   * @param {number} availabilityId - Availability slot ID
   * @param {string} userId - User ID
   * @param {number} durationMinutes - Duration to hold
   * @returns {Promise<Object>} Held slot with expiration
   */
  static async holdSlotForBooking(availabilityId, userId, durationMinutes) {
    try {
      const client = await getClient();

      try {
        await client.query('BEGIN');

        // Get the slot
        const slotResult = await client.query(
          `SELECT * FROM pnp_availability WHERE id = $1 FOR UPDATE`,
          [availabilityId]
        );

        if (!slotResult.rows || slotResult.rows.length === 0) {
          throw new Error('Availability slot not found');
        }

        const slot = slotResult.rows[0];

        if (slot.is_booked) {
          throw new Error('Slot already booked');
        }

        if (slot.hold_user_id && slot.hold_user_id !== userId) {
          throw new Error('Slot already held by another user');
        }

        // Check if slot can accommodate the duration
        const slotStart = new Date(slot.available_from);
        const slotEnd = new Date(slot.available_to);
        const slotDuration = (slotEnd - slotStart) / (1000 * 60);

        if (slotDuration < durationMinutes) {
          throw new Error('Slot duration insufficient for requested booking');
        }

        // Calculate hold expiration
        const holdExpiresAt = new Date();
        holdExpiresAt.setMinutes(holdExpiresAt.getMinutes() + HOLD_DURATION_MINUTES);

        // Update slot with hold
        const updateResult = await client.query(
          `UPDATE pnp_availability 
           SET hold_user_id = $2, 
               hold_expires_at = $3,
               updated_at = NOW()
           WHERE id = $1 
           RETURNING *`,
          [availabilityId, userId, holdExpiresAt]
        );

        await client.query('COMMIT');

        // Invalidate cache
        await cache.del(`availability:settings:${slot.model_id}`);

        logger.info('Slot held for booking', {
          availabilityId,
          userId,
          holdExpiresAt: holdExpiresAt.toISOString()
        });

        return {
          ...updateResult.rows[0],
          holdExpiresAt
        };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      logger.error('Error holding slot for booking:', error);
      throw new Error('Failed to hold slot');
    }
  }

  /**
   * Release a held slot
   * @param {number} availabilityId - Availability slot ID
   * @returns {Promise<Object>} Released slot
   */
  static async releaseHeldSlot(availabilityId) {
    try {
      const result = await query(
        `UPDATE pnp_availability 
         SET hold_user_id = NULL, 
             hold_expires_at = NULL,
             updated_at = NOW()
         WHERE id = $1 
         RETURNING *`,
        [availabilityId]
      );

      if (!result.rows || result.rows.length === 0) {
        throw new Error('Slot not found');
      }

      const slot = result.rows[0];

      // Invalidate cache
      await cache.del(`availability:settings:${slot.model_id}`);

      logger.info('Held slot released', { availabilityId });
      return slot;
    } catch (error) {
      logger.error('Error releasing held slot:', error);
      throw new Error('Failed to release slot');
    }
  }

  /**
   * Book a held slot (convert hold to booking)
   * @param {number} availabilityId - Availability slot ID
   * @param {number} bookingId - Booking ID
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Booked slot
   */
  static async bookHeldSlot(availabilityId, bookingId, userId) {
    try {
      const client = await getClient();

      try {
        await client.query('BEGIN');

        // Verify the slot is held by this user
        const slotResult = await client.query(
          `SELECT * FROM pnp_availability WHERE id = $1 FOR UPDATE`,
          [availabilityId]
        );

        if (!slotResult.rows || slotResult.rows.length === 0) {
          throw new Error('Slot not found');
        }

        const slot = slotResult.rows[0];

        if (slot.hold_user_id !== userId) {
          throw new Error('Slot not held by this user');
        }

        if (slot.is_booked) {
          throw new Error('Slot already booked');
        }

        // Book the slot
        const updateResult = await client.query(
          `UPDATE pnp_availability 
           SET is_booked = TRUE, 
               booking_id = $2,
               hold_user_id = NULL,
               hold_expires_at = NULL,
               updated_at = NOW()
           WHERE id = $1 
           RETURNING *`,
          [availabilityId, bookingId]
        );

        await client.query('COMMIT');

        // Invalidate cache
        await cache.del(`availability:settings:${slot.model_id}`);

        logger.info('Held slot booked', {
          availabilityId,
          bookingId,
          userId
        });

        return updateResult.rows[0];
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      logger.error('Error booking held slot:', error);
      throw new Error('Failed to book slot');
    }
  }

  // ============================================================
  // CONFLICT DETECTION AND RESOLUTION
  // ============================================================

  /**
   * Check for availability conflicts
   * @param {number} modelId - Model ID
   * @param {Date} startTime - Start time to check
   * @param {Date} endTime - End time to check
   * @param {number} excludeId - Availability ID to exclude (for updates)
   * @returns {Promise<Array>} Conflicting slots
   */
  static async checkAvailabilityConflicts(modelId, startTime, endTime, excludeId = null) {
    try {
      let queryText = `
        SELECT * FROM pnp_availability 
        WHERE model_id = $1 
        AND ((available_from < $3 AND available_to > $2) 
             OR (available_from < $4 AND available_to > $2) 
             OR (available_from >= $2 AND available_to <= $3))
      `;

      let params = [modelId, startTime, endTime, endTime];

      if (excludeId) {
        queryText += ' AND id != $5';
        params.push(excludeId);
      }

      queryText += ' ORDER BY available_from';

      const result = await query(queryText, params);
      return result.rows || [];
    } catch (error) {
      logger.error('Error checking availability conflicts:', error);
      throw new Error('Failed to check conflicts');
    }
  }

  /**
   * Resolve conflicts by adjusting or removing overlapping slots
   * @param {number} modelId - Model ID
   * @param {Date} newStart - New slot start time
   * @param {Date} newEnd - New slot end time
   * @param {string} resolutionStrategy - 'adjust', 'remove', or 'merge'
   * @returns {Promise<Object>} Resolution result
   */
  static async resolveConflicts(modelId, newStart, newEnd, resolutionStrategy = 'adjust') {
    try {
      const client = await getClient();

      try {
        await client.query('BEGIN');

        // Find conflicts
        const conflicts = await client.query(
          `SELECT * FROM pnp_availability 
           WHERE model_id = $1 
           AND ((available_from < $3 AND available_to > $2) 
                OR (available_from < $4 AND available_to > $2) 
                OR (available_from >= $2 AND available_to <= $3)) 
           ORDER BY available_from`,
          [modelId, newStart, newEnd, newEnd]
        );

        if (!conflicts.rows || conflicts.rows.length === 0) {
          await client.query('COMMIT');
          return { resolved: false, message: 'No conflicts found' };
        }

        let resolutionResult;

        switch (resolutionStrategy) {
          case 'remove':
            resolutionResult = await this._resolveByRemovingConflicts(client, conflicts.rows);
            break;
          case 'merge':
            resolutionResult = await this._resolveByMergingConflicts(client, conflicts.rows, newStart, newEnd);
            break;
          case 'adjust':
          default:
            resolutionResult = await this._resolveByAdjustingConflicts(client, conflicts.rows, newStart, newEnd);
            break;
        }

        await client.query('COMMIT');

        // Invalidate cache
        await cache.del(`availability:settings:${modelId}`);

        logger.info('Availability conflicts resolved', {
          modelId,
          conflictsResolved: resolutionResult.conflictsResolved,
          strategy: resolutionStrategy
        });

        return {
          resolved: true,
          conflictsResolved: resolutionResult.conflictsResolved,
          strategy: resolutionStrategy,
          ...resolutionResult
        };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      logger.error('Error resolving availability conflicts:', error);
      throw new Error('Failed to resolve conflicts');
    }
  }

  /**
   * Resolve conflicts by removing conflicting slots
   */
  static async _resolveByRemovingConflicts(client, conflicts) {
    const conflictIds = conflicts.map(c => c.id);
    
    await client.query(
      `DELETE FROM pnp_availability WHERE id = ANY($1)`,
      [conflictIds]
    );

    return {
      conflictsResolved: conflictIds.length,
      action: 'removed',
      removedSlots: conflictIds.length
    };
  }

  /**
   * Resolve conflicts by adjusting conflicting slots
   */
  static async _resolveByAdjustingConflicts(client, conflicts, newStart, newEnd) {
    let adjustedCount = 0;
    const newStartTime = new Date(newStart).getTime();
    const newEndTime = new Date(newEnd).getTime();

    for (const conflict of conflicts) {
      const conflictStart = new Date(conflict.available_from).getTime();
      const conflictEnd = new Date(conflict.available_to).getTime();

      // Adjust slots that overlap with new slot
      if (conflictStart < newStartTime && conflictEnd > newStartTime) {
        // Shorten from the right
        await client.query(
          `UPDATE pnp_availability 
           SET available_to = $2, updated_at = NOW()
           WHERE id = $1`,
          [conflict.id, new Date(newStartTime - BUFFER_TIME_MINUTES * 60 * 1000)]
        );
        adjustedCount++;
      } else if (conflictStart < newEndTime && conflictEnd > newEndTime) {
        // Shorten from the left
        await client.query(
          `UPDATE pnp_availability 
           SET available_from = $2, updated_at = NOW()
           WHERE id = $1`,
          [conflict.id, new Date(newEndTime + BUFFER_TIME_MINUTES * 60 * 1000)]
        );
        adjustedCount++;
      } else if (conflictStart >= newStartTime && conflictEnd <= newEndTime) {
        // Completely overlapped - remove
        await client.query(
          `DELETE FROM pnp_availability WHERE id = $1`,
          [conflict.id]
        );
        adjustedCount++;
      }
    }

    return {
      conflictsResolved: adjustedCount,
      action: 'adjusted',
      adjustedSlots: adjustedCount
    };
  }

  /**
   * Resolve conflicts by merging with new slot
   */
  static async _resolveByMergingConflicts(client, conflicts, newStart, newEnd) {
    // Find the earliest start and latest end
    let earliestStart = new Date(newStart);
    let latestEnd = new Date(newEnd);

    for (const conflict of conflicts) {
      const conflictStart = new Date(conflict.available_from);
      const conflictEnd = new Date(conflict.available_to);

      if (conflictStart < earliestStart) earliestStart = conflictStart;
      if (conflictEnd > latestEnd) latestEnd = conflictEnd;
    }

    // Remove all conflicting slots
    const conflictIds = conflicts.map(c => c.id);
    await client.query(
      `DELETE FROM pnp_availability WHERE id = ANY($1)`,
      [conflictIds]
    );

    // Create merged slot
    const result = await client.query(
      `INSERT INTO pnp_availability 
       (model_id, available_from, available_to, slot_type)
       VALUES ($1, $2, $3, 'merged')
       RETURNING *`,
      [conflicts[0].model_id, earliestStart, latestEnd]
    );

    return {
      conflictsResolved: conflictIds.length,
      action: 'merged',
      mergedIntoSlot: result.rows[0].id,
      originalSlots: conflictIds.length
    };
  }

  // ============================================================
  // AVAILABILITY NOTIFICATIONS
  // ============================================================

  /**
   * Get subscribers for availability notifications
   * @param {number} modelId - Model ID
   * @returns {Promise<Array>} Subscriber user IDs
   */
  static async getAvailabilitySubscribers(modelId) {
    try {
      const result = await query(
        `SELECT user_id FROM user_notifications 
         WHERE notification_type = 'availability' 
         AND model_id = $1 
         AND is_active = TRUE`,
        [modelId]
      );

      return result.rows.map(row => row.user_id) || [];
    } catch (error) {
      logger.error('Error getting availability subscribers:', error);
      return [];
    }
  }

  /**
   * Notify subscribers about new availability
   * @param {number} modelId - Model ID
   * @param {Array} newSlots - New availability slots
   * @param {Function} sendNotification - Notification function
   * @returns {Promise<number>} Number of notifications sent
   */
  static async notifySubscribersAboutNewAvailability(modelId, newSlots, sendNotification) {
    try {
      const subscribers = await this.getAvailabilitySubscribers(modelId);
      let notificationsSent = 0;

      for (const subscriberId of subscribers) {
        try {
          const earliestSlot = newSlots.sort((a, b) => 
            new Date(a.available_from) - new Date(b.available_from)
          )[0];

          await sendNotification(
            subscriberId,
            `📅 New availability from your favorite model!

` +
            `💃 Model is now available on ${earliestSlot.available_from.toLocaleDateString()}
` +
            `🕒 Starting at ${earliestSlot.available_from.toLocaleTimeString()}

` +
            `Tap to book now before slots fill up!`,
            { modelId, slotId: earliestSlot.id }
          );
          notificationsSent++;
        } catch (notifyError) {
          logger.warn('Failed to notify subscriber:', notifyError.message);
        }
      }

      logger.info('Availability notifications sent', {
        modelId,
        notificationsSent,
        totalSubscribers: subscribers.length
      });

      return notificationsSent;
    } catch (error) {
      logger.error('Error notifying subscribers about new availability:', error);
      return 0;
    }
  }

  // ============================================================
  // AVAILABILITY EXPORT/IMPORT
  // ============================================================

  /**
   * Export availability settings for a model
   * @param {number} modelId - Model ID
   * @returns {Promise<Object>} Export data
   */
  static async exportAvailabilitySettings(modelId) {
    try {
      const settings = await this.getModelAvailabilitySettings(modelId);

      return {
        modelId,
        exportedAt: new Date(),
        settings: {
          recurringSchedules: settings.recurringSchedules,
          blockedDates: settings.blockedDates,
          manualAvailability: settings.manualAvailability
        }
      };
    } catch (error) {
      logger.error('Error exporting availability settings:', error);
      throw new Error('Failed to export settings');
    }
  }

  /**
   * Import availability settings for a model
   * @param {number} modelId - Model ID
   * @param {Object} importData - Import data
   * @returns {Promise<Object>} Import result
   */
  static async importAvailabilitySettings(modelId, importData) {
    try {
      const client = await getClient();

      try {
        await client.query('BEGIN');

        // Clear existing data (optional - could be parameterized)
        await client.query(
          `DELETE FROM pnp_model_schedules WHERE model_id = $1`,
          [modelId]
        );

        await client.query(
          `DELETE FROM pnp_model_blocked_dates WHERE model_id = $1`,
          [modelId]
        );

        await client.query(
          `DELETE FROM pnp_availability WHERE model_id = $1 AND slot_type != 'manual'`,
          [modelId]
        );

        // Import recurring schedules
        let importedSchedules = 0;
        if (importData.settings?.recurringSchedules) {
          for (const schedule of importData.settings.recurringSchedules) {
            await client.query(
              `INSERT INTO pnp_model_schedules 
               (model_id, day_of_week, start_time, end_time, is_active)
               VALUES ($1, $2, $3, $4, $5)`,
              [modelId, schedule.day_of_week, schedule.start_time, schedule.end_time, schedule.is_active]
            );
            importedSchedules++;
          }
        }

        // Import blocked dates
        let importedBlockedDates = 0;
        if (importData.settings?.blockedDates) {
          for (const blockedDate of importData.settings.blockedDates) {
            await client.query(
              `INSERT INTO pnp_model_blocked_dates 
               (model_id, blocked_date, reason)
               VALUES ($1, $2, $3)`,
              [modelId, blockedDate.blocked_date, blockedDate.reason]
            );
            importedBlockedDates++;
          }
        }

        // Import manual availability
        let importedAvailability = 0;
        if (importData.settings?.manualAvailability) {
          for (const availability of importData.settings.manualAvailability) {
            await client.query(
              `INSERT INTO pnp_availability 
               (model_id, available_from, available_to, slot_type, is_booked, booking_id)
               VALUES ($1, $2, $3, $4, $5, $6)`,
              [
                modelId,
                availability.available_from,
                availability.available_to,
                availability.slot_type || 'manual',
                availability.is_booked || false,
                availability.booking_id || null
              ]
            );
            importedAvailability++;
          }
        }

        await client.query('COMMIT');

        // Invalidate cache
        await cache.del(`availability:settings:${modelId}`);

        logger.info('Availability settings imported', {
          modelId,
          importedSchedules,
          importedBlockedDates,
          importedAvailability
        });

        return {
          success: true,
          importedSchedules,
          importedBlockedDates,
          importedAvailability,
          totalImported: importedSchedules + importedBlockedDates + importedAvailability
        };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      logger.error('Error importing availability settings:', error);
      throw new Error('Failed to import settings');
    }
  }
}

// Export service and constants
module.exports = ComprehensiveAvailabilityService;
module.exports.DEFAULT_SLOT_DURATIONS = DEFAULT_SLOT_DURATIONS;
module.exports.MAX_ADVANCE_BOOKING_DAYS = MAX_ADVANCE_BOOKING_DAYS;
module.exports.HOLD_DURATION_MINUTES = HOLD_DURATION_MINUTES;