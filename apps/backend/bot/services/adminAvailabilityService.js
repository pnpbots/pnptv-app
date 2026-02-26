const logger = require('../../utils/logger');
const MeetGreetTimeSlotService = require('./meetGreetTimeSlotService');
const AvailabilityService = require('./availabilityService');

/**
 * Admin Availability Service
 * Improved availability management where admins select date/time frames
 * and the system automatically creates slots for all duration categories
 */

class AdminAvailabilityService {
  /**
   * Create availability slots for a specific time frame
   * @param {number} modelId - Model ID
   * @param {Date} startDateTime - Start date and time
   * @param {Date} endDateTime - End date and time
   * @returns {Promise<Array>} Created availability slots
   */
  static async createAvailabilityForTimeFrame(modelId, startDateTime, endDateTime) {
    try {
      logger.info('Creating availability for time frame', {
        modelId,
        startDateTime,
        endDateTime
      });

      // Validate time frame
      if (startDateTime >= endDateTime) {
        throw new Error('End time must be after start time');
      }

      // Check if the time frame is within Thursday-Monday window
      const startDayValid = MeetGreetTimeSlotService.isDayInWindow(startDateTime);
      const endDayValid = MeetGreetTimeSlotService.isDayInWindow(endDateTime);

      if (!startDayValid || !endDayValid) {
        throw new Error('Availability can only be created for Thursday to Monday');
      }

      // Calculate total duration in minutes
      const totalMinutes = (endDateTime - startDateTime) / (1000 * 60);
      
      if (totalMinutes < 30) {
        throw new Error('Time frame must be at least 30 minutes');
      }

      // Create slots for all duration categories (30, 60, 90 minutes)
      const durations = [30, 60, 90];
      const buffer = 15; // 15-minute buffer between slots
      const createdSlots = [];

      // Start from the beginning of the time frame
      let currentTime = new Date(startDateTime);

      while (currentTime < endDateTime) {
        // Try to create slots for each duration
        for (const duration of durations) {
          const slotEnd = new Date(currentTime.getTime() + duration * 60 * 1000);
          
          // Check if this slot fits within the time frame
          if (slotEnd <= endDateTime) {
            // Create the availability slot
            const slot = {
              model_id: modelId,
              available_from: new Date(currentTime),
              available_to: slotEnd,
              duration_minutes: duration,
              is_booked: false,
              booking_id: null,
              created_at: new Date(),
              updated_at: new Date()
            };

            // Add to database
            const created = await AvailabilityService.addAvailability(
              modelId,
              slot.available_from,
              slot.available_to
            );

            createdSlots.push(created);
            
            logger.info('Created availability slot', {
              slotId: created.id,
              modelId,
              duration: duration,
              start: slot.available_from,
              end: slot.available_to
            });
            
            // Move to next slot start time (current end + buffer)
            currentTime = new Date(slotEnd.getTime() + buffer * 60 * 1000);
            break; // Move to next time slot
          }
        }
        
        // If no slot was created (not enough time left), break
        if (createdSlots.length === 0 || 
            (currentTime.getTime() + Math.min(...durations) * 60 * 1000) > endDateTime) {
          break;
        }
      }

      logger.info('Availability creation complete', {
        modelId,
        slotCount: createdSlots.length,
        startDateTime,
        endDateTime
      });

      return createdSlots;

    } catch (error) {
      logger.error('Error creating availability for time frame:', error);
      throw new Error('Failed to create availability: ' + error.message);
    }
  }

  /**
   * Create availability for multiple time frames
   * @param {number} modelId - Model ID
   * @param {Array} timeFrames - Array of {start, end} objects
   * @returns {Promise<Array>} Created availability slots
   */
  static async createAvailabilityForMultipleTimeFrames(modelId, timeFrames) {
    try {
      const allSlots = [];

      for (const frame of timeFrames) {
        const slots = await this.createAvailabilityForTimeFrame(
          modelId,
          frame.start,
          frame.end
        );
        allSlots.push(...slots);
      }

      logger.info('Bulk availability creation complete', {
        modelId,
        frameCount: timeFrames.length,
        totalSlots: allSlots.length
      });

      return allSlots;

    } catch (error) {
      logger.error('Error creating bulk availability:', error);
      throw new Error('Failed to create bulk availability: ' + error.message);
    }
  }

  /**
   * Get availability slots for a model with admin interface data
   * @param {number} modelId - Model ID
   * @returns {Promise<Object>} Availability data for admin interface
   */
  static async getAvailabilityForAdminInterface(modelId) {
    try {
      // Get all availability slots
      const slots = await AvailabilityService.getAvailability(modelId);

      // Group by date
      const availabilityByDate = {};

      slots.forEach(slot => {
        const dateKey = new Date(slot.available_from).toISOString().split('T')[0];
        
        if (!availabilityByDate[dateKey]) {
          availabilityByDate[dateKey] = [];
        }
        
        availabilityByDate[dateKey].push({
          id: slot.id,
          start: slot.available_from,
          end: slot.available_to,
          duration: slot.duration_minutes,
          isBooked: slot.is_booked,
          bookingId: slot.booking_id
        });
      });

      // Sort dates
      const sortedDates = Object.keys(availabilityByDate).sort();
      
      // Format for admin interface
      const formattedAvailability = sortedDates.map(date => {
        const dateObj = new Date(date);
        const dayName = dateObj.toLocaleDateString('en-US', { weekday: 'long' });
        const dateStr = dateObj.toLocaleDateString();
        
        return {
          date,
          dayName,
          dateStr,
          slots: availabilityByDate[date]
        };
      });

      return {
        modelId,
        availability: formattedAvailability,
        totalSlots: slots.length,
        bookedSlots: slots.filter(s => s.is_booked).length,
        availableSlots: slots.filter(s => !s.is_booked).length
      };

    } catch (error) {
      logger.error('Error getting availability for admin interface:', error);
      throw new Error('Failed to get availability: ' + error.message);
    }
  }

  /**
   * Delete availability slots for a model
   * @param {number} modelId - Model ID
   * @param {Array} slotIds - Array of slot IDs to delete
   * @returns {Promise<Object>} Deletion result
   */
  static async deleteAvailabilitySlots(modelId, slotIds) {
    try {
      let deletedCount = 0;
      let failedCount = 0;

      for (const slotId of slotIds) {
        try {
          // Check if slot is booked
          const slot = await AvailabilityService.getAvailabilityById(slotId);
          
          if (slot && slot.is_booked) {
            logger.warn('Cannot delete booked slot', { slotId, modelId });
            failedCount++;
            continue;
          }
          
          // Delete the slot
          await AvailabilityService.deleteAvailability(slotId);
          deletedCount++;
          
          logger.info('Deleted availability slot', { slotId, modelId });
          
        } catch (error) {
          logger.error('Error deleting slot:', { slotId, error: error.message });
          failedCount++;
        }
      }

      return {
        success: true,
        deletedCount,
        failedCount,
        totalAttempted: slotIds.length
      };

    } catch (error) {
      logger.error('Error deleting availability slots:', error);
      throw new Error('Failed to delete availability: ' + error.message);
    }
  }

  /**
   * Get suggested time frames for availability creation
   * @returns {Array} Suggested time frames
   */
  static getSuggestedTimeFrames() {
    // Suggest common time frames for Meet & Greet
    return [
      {
        name: 'Morning (10AM - 2PM)',
        startHour: 10,
        endHour: 14,
        description: 'Popular morning slots'
      },
      {
        name: 'Afternoon (2PM - 6PM)',
        startHour: 14,
        endHour: 18,
        description: 'Popular afternoon slots'
      },
      {
        name: 'Evening (6PM - 10PM)',
        startHour: 18,
        endHour: 22,
        description: 'Popular evening slots'
      },
      {
        name: 'Full Day (10AM - 10PM)',
        startHour: 10,
        endHour: 22,
        description: 'Maximum availability'
      }
    ];
  }

  /**
   * Validate time frame for availability
   * @param {Date} start - Start time
   * @param {Date} end - End time
   * @returns {Object} Validation result
   */
  static validateTimeFrame(start, end) {
    const result = {
      valid: true,
      errors: [],
      warnings: []
    };

    // Check if end is after start
    if (start >= end) {
      result.valid = false;
      result.errors.push('End time must be after start time');
    }

    // Check minimum duration
    const durationMinutes = (end - start) / (1000 * 60);
    if (durationMinutes < 30) {
      result.valid = false;
      result.errors.push('Time frame must be at least 30 minutes');
    }

    // Check if within Thursday-Monday window
    const startDayValid = MeetGreetTimeSlotService.isDayInWindow(start);
    const endDayValid = MeetGreetTimeSlotService.isDayInWindow(end);

    if (!startDayValid) {
      result.valid = false;
      result.errors.push(`Start day (${start.toLocaleDateString('en-US', { weekday: 'long' })}) is not valid. Must be Thursday-Monday`);
    }

    if (!endDayValid) {
      result.valid = false;
      result.errors.push(`End day (${end.toLocaleDateString('en-US', { weekday: 'long' })}) is not valid. Must be Thursday-Monday`);
    }

    // Check if time frame spans multiple days
    if (start.toDateString() !== end.toDateString()) {
      result.warnings.push('Time frame spans multiple days - this will create slots for each day');
    }

    // Check reasonable duration
    if (durationMinutes > 720) { // 12 hours
      result.warnings.push('Time frame is very long - consider splitting into smaller frames');
    }

    return result;
  }

  /**
   * Calculate potential slots for a time frame
   * @param {Date} start - Start time
   * @param {Date} end - End time
   * @returns {Object} Slot calculation result
   */
  static calculatePotentialSlots(start, end) {
    const durationMinutes = (end - start) / (1000 * 60);
    const buffer = 15;
    const durations = [30, 60, 90];

    // Calculate how many slots could fit
    const potentialSlots = durations.map(duration => {
      const slotWithBuffer = duration + buffer;
      const maxSlots = Math.floor(durationMinutes / slotWithBuffer);
      const totalTimeUsed = maxSlots * slotWithBuffer;
      const remainingTime = durationMinutes - totalTimeUsed;

      return {
        duration,
        maxSlots,
        totalTimeUsed,
        remainingTime,
        efficiency: (totalTimeUsed / durationMinutes * 100).toFixed(1) + '%'
      };
    });

    // Calculate total potential
    const totalPotential = potentialSlots.reduce((sum, slot) => sum + slot.maxSlots, 0);

    return {
      durationMinutes,
      potentialSlots,
      totalPotential,
      averageEfficiency: (potentialSlots.reduce((sum, slot) => sum + parseFloat(slot.efficiency), 0) / potentialSlots.length).toFixed(1) + '%'
    };
  }
}

module.exports = AdminAvailabilityService;