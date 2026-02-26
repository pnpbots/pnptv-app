const logger = require('../../utils/logger');

/**
 * PNP Television Live Time Slot Service
 * Generates time slots with PNP-specific constraints:
 * - Duration: 30, 60, or 90 minutes
 * - Days: Thursday to Monday only
 * - Buffer: 15 minutes between slots
 * - Operating hours: 10 AM to 10 PM
 */

class PNPLiveTimeSlotService {
  /**
   * Generate time slots for a model with PNP constraints
   * @param {number} modelId - Model ID
   * @param {Date} startDate - Start date for slot generation
   * @param {number} durationMinutes - Duration in minutes (30, 60, or 90)
   * @returns {Promise<Array>} Available time slots
   */
  static async generateTimeSlots(modelId, startDate, durationMinutes) {
    try {
      // Validate duration
      const validDurations = [30, 60, 90];
      if (!validDurations.includes(durationMinutes)) {
        throw new Error('Invalid duration. Must be 30, 60, or 90 minutes.');
      }

      // Get the current date and time
      const now = new Date();
      const currentDay = now.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
      const currentTime = now.getHours() * 60 + now.getMinutes(); // Time in minutes

      // Calculate the start and end dates for the time window
      // We want slots from Thursday to Monday (5 days)
      const slots = [];
      const daysToGenerate = 5; // Thursday to Monday

      // Start from the given startDate or today if not provided
      const generationStartDate = startDate || new Date();

      // Generate slots for each day in the window
      for (let dayOffset = 0; dayOffset < daysToGenerate; dayOffset++) {
        const currentDate = new Date(generationStartDate);
        currentDate.setDate(generationStartDate.getDate() + dayOffset);
        const dayOfWeek = currentDate.getDay();

        // Only generate slots for Thursday (4) to Monday (1)
        // Note: JavaScript days: 0=Sunday, 1=Monday, 2=Tuesday, 3=Wednesday, 4=Thursday, 5=Friday, 6=Saturday
        const isValidDay = (dayOfWeek === 4) || // Thursday
                          (dayOfWeek === 5) || // Friday
                          (dayOfWeek === 6) || // Saturday
                          (dayOfWeek === 0) || // Sunday
                          (dayOfWeek === 1);   // Monday

        if (!isValidDay) {
          continue; // Skip days outside Thursday-Monday window
        }

        // Generate slots for this day
        // PNP Live operates from 10 AM to 10 PM (12 hours)
        const startHour = 10; // Start at 10 AM
        const endHour = 22;   // End at 10 PM

        // Generate slots every duration + 15 minute buffer
        const slotDurationWithBuffer = durationMinutes + 15; // Duration + 15 min buffer

        for (let hour = startHour; hour < endHour; hour++) {
          for (let minute = 0; minute < 60; minute += slotDurationWithBuffer) {
            // Skip if this slot would end after our end time
            const slotStart = new Date(currentDate);
            slotStart.setHours(hour, minute, 0, 0);

            const slotEnd = new Date(slotStart);
            slotEnd.setMinutes(slotEnd.getMinutes() + durationMinutes);

            if (slotEnd.getHours() > endHour) {
              continue; // Skip slots that would end too late
            }

            // Only include slots that are in the future
            const slotStartTime = slotStart.getTime();
            const nowTime = now.getTime();

            if (slotStartTime < nowTime) {
              continue; // Skip slots in the past
            }

            // Add this slot
            slots.push({
              model_id: modelId,
              available_from: slotStart,
              available_to: slotEnd,
              duration_minutes: durationMinutes,
              is_booked: false,
              booking_id: null,
            });
          }
        }
      }

      // Sort slots by start time
      slots.sort((a, b) => a.available_from - b.available_from);

      logger.info('Generated PNP Live time slots', {
        modelId,
        count: slots.length,
        durationMinutes,
        startDate: generationStartDate,
      });

      return slots;

    } catch (error) {
      logger.error('Error generating PNP Live time slots:', error);
      throw new Error('Failed to generate time slots: ' + error.message);
    }
  }

  /**
   * Generate extended time slots for all durations
   * @param {number} modelId - Model ID
   * @param {Date} startDate - Start date for slot generation
   * @returns {Promise<Array>} Available time slots for extended durations
   */
  static async generateExtendedTimeSlots(modelId, startDate) {
    try {
      // Generate slots for all valid durations
      const durations = [30, 60, 90];
      let allSlots = [];

      for (const duration of durations) {
        const slots = await this.generateTimeSlots(modelId, startDate, duration);
        allSlots = allSlots.concat(slots);
      }

      // Remove duplicate slots (same start time, different durations)
      const uniqueSlots = [];
      const seenStartTimes = new Set();

      for (const slot of allSlots) {
        const startTimeKey = slot.available_from.getTime().toString();
        if (!seenStartTimes.has(startTimeKey)) {
          seenStartTimes.add(startTimeKey);
          uniqueSlots.push(slot);
        }
      }

      return uniqueSlots;

    } catch (error) {
      logger.error('Error generating extended PNP Live time slots:', error);
      throw new Error('Failed to generate extended time slots: ' + error.message);
    }
  }

  /**
   * Get available slots for a specific date range
   * @param {number} modelId - Model ID
   * @param {Date} startDate - Start date
   * @param {Date} endDate - End date
   * @param {number} durationMinutes - Duration in minutes
   * @returns {Promise<Array>} Available slots
   */
  static async getAvailableSlots(modelId, startDate, endDate, durationMinutes) {
    try {
      // Generate all possible slots
      const allSlots = await this.generateTimeSlots(modelId, startDate, durationMinutes);

      // Filter slots within the date range
      const filteredSlots = allSlots.filter(slot => {
        const slotStart = new Date(slot.available_from);
        const slotEnd = new Date(slot.available_to);
        
        return slotStart >= startDate && slotEnd <= endDate;
      });

      return filteredSlots;

    } catch (error) {
      logger.error('Error getting available slots:', error);
      throw new Error('Failed to get available slots: ' + error.message);
    }
  }

  /**
   * Check if a day is within the Thursday-Monday window
   * @param {Date} date - Date to check
   * @returns {boolean} True if within window
   */
  static isDayInWindow(date) {
    const dayOfWeek = date.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
    return dayOfWeek === 4 || dayOfWeek === 5 || dayOfWeek === 6 || dayOfWeek === 0 || dayOfWeek === 1;
  }

  /**
   * Get the next available Thursday
   * @returns {Date} Next Thursday
   */
  static getNextThursday() {
    const now = new Date();
    const currentDay = now.getDay();
    const daysUntilThursday = (4 - currentDay + 7) % 7;
    
    const nextThursday = new Date(now);
    nextThursday.setDate(now.getDate() + daysUntilThursday);
    nextThursday.setHours(10, 0, 0, 0); // 10 AM
    
    return nextThursday;
  }

  /**
   * Get the Monday after next Thursday
   * @returns {Date} Next Monday after Thursday
   */
  static getNextMondayAfterThursday() {
    const nextThursday = this.getNextThursday();
    const nextMonday = new Date(nextThursday);
    nextMonday.setDate(nextThursday.getDate() + 4); // Thursday + 4 days = Monday
    nextMonday.setHours(22, 0, 0, 0); // 10 PM
    
    return nextMonday;
  }

  /**
   * Get available days for PNP Live (Thursday to Monday)
   * @param {number} count - Number of weeks to include
   * @returns {Array} Available days
   */
  static getAvailableDays(count = 2) {
    const days = [];
    const now = new Date();
    
    for (let week = 0; week < count; week++) {
      for (let dayOffset = 0; dayOffset < 5; dayOffset++) {
        const date = new Date(now);
        date.setDate(now.getDate() + week * 7 + dayOffset);
        
        if (this.isDayInWindow(date)) {
          days.push(date);
        }
      }
    }
    
    return days;
  }

  /**
   * Validate if a time slot is within PNP Live operating hours
   * @param {Date} dateTime - Date and time to validate
   * @returns {boolean} True if within operating hours
   */
  static isWithinOperatingHours(dateTime) {
    const hours = dateTime.getHours();
    const minutes = dateTime.getMinutes();
    const totalMinutes = hours * 60 + minutes;
    
    // Operating hours: 10 AM (600 minutes) to 10 PM (1320 minutes)
    return totalMinutes >= 600 && totalMinutes <= 1320;
  }

  /**
   * Calculate buffer time between slots
   * @param {Date} previousEnd - End time of previous slot
   * @param {Date} nextStart - Start time of next slot
   * @returns {number} Buffer time in minutes
   */
  static calculateBufferTime(previousEnd, nextStart) {
    return (nextStart.getTime() - previousEnd.getTime()) / (1000 * 60);
  }
}

module.exports = PNPLiveTimeSlotService;