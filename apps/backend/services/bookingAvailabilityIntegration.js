/**
 * Booking Availability Integration Service
 * Bridges the comprehensive availability system with the booking system
 */

const ComprehensiveAvailabilityService = require('./comprehensiveAvailabilityService');
const BookingModel = require('../models/bookingModel');
const logger = require('../utils/logger');
const { getClient } = require('../config/postgres');

class BookingAvailabilityIntegration {
  /**
   * Create a booking with smart availability selection
   * @param {Object} bookingData - Booking data
   * @param {number} bookingData.userId - User ID
   * @param {number} bookingData.modelId - Model ID
   * @param {number} bookingData.durationMinutes - Duration in minutes
   * @param {Date} bookingData.preferredStartTime - Preferred start time
   * @param {Date} bookingData.searchStartTime - Search start time
   * @param {Date} bookingData.searchEndTime - Search end time
   * @returns {Promise<Object>} Created booking with availability
   */
  static async createSmartBooking(bookingData) {
    try {
      const {
        userId,
        modelId,
        durationMinutes,
        preferredStartTime,
        searchStartTime,
        searchEndTime
      } = bookingData;

      // Find best matching available slot
      const availableSlots = await ComprehensiveAvailabilityService.findSmartAvailableSlots(
        modelId,
        durationMinutes,
        preferredStartTime,
        searchStartTime,
        searchEndTime
      );

      if (availableSlots.length === 0) {
        throw new Error('No available slots found for the requested time period');
      }

      // Select the best match (highest score)
      const bestSlot = availableSlots[0];

      // Hold the slot for booking
      const heldSlot = await ComprehensiveAvailabilityService.holdSlotForBooking(
        bestSlot.id,
        userId,
        durationMinutes
      );

      // Create the booking
      const booking = await BookingModel.create({
        userId,
        performerId: modelId,
        callType: 'private',
        durationMinutes,
        priceCents: this._calculatePrice(durationMinutes),
        currency: 'USD',
        startTimeUtc: bestSlot.available_from,
        // Add availability reference
        availabilityId: bestSlot.id
      });

      logger.info('Smart booking created with availability integration', {
        bookingId: booking.id,
        userId,
        modelId,
        availabilityId: bestSlot.id,
        matchScore: bestSlot.matchScore
      });

      return {
        booking,
        availabilitySlot: heldSlot,
        matchScore: bestSlot.matchScore,
        timeDifferenceMinutes: bestSlot.timeDifferenceMinutes
      };
    } catch (error) {
      logger.error('Error creating smart booking:', error);
      throw new Error('Failed to create smart booking');
    }
  }

  /**
   * Complete a booking by converting hold to confirmed booking
   * @param {string} bookingId - Booking ID
   * @param {number} availabilityId - Availability slot ID
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Completed booking
   */
  static async completeBooking(bookingId, availabilityId, userId) {
    try {
      // Book the held slot
      const bookedSlot = await ComprehensiveAvailabilityService.bookHeldSlot(
        availabilityId,
        bookingId,
        userId
      );

      // Update booking status
      const updatedResult = await BookingModel.updateStatus(bookingId, 'confirmed');
      if (!updatedResult.success) {
        throw new Error(updatedResult.error || 'Failed to update booking status');
      }

      logger.info('Booking completed and availability slot booked', {
        bookingId,
        availabilityId,
        userId
      });

      return {
        booking: updatedResult.booking,
        availabilitySlot: bookedSlot
      };
    } catch (error) {
      logger.error('Error completing booking:', error);
      throw new Error('Failed to complete booking');
    }
  }

  /**
   * Cancel a booking and release the held slot
   * @param {string} bookingId - Booking ID
   * @param {number} availabilityId - Availability slot ID
   * @param {string} userId - User ID
   * @param {string} reason - Cancellation reason
   * @returns {Promise<Object>} Cancellation result
   */
  static async cancelBooking(bookingId, availabilityId, userId, reason) {
    try {
      // Cancel the booking
      const cancelledResult = await BookingModel.cancel(bookingId, reason, userId);
      if (!cancelledResult.success) {
        throw new Error(cancelledResult.error || 'Failed to cancel booking');
      }

      // Release the held slot
      const releasedSlot = await ComprehensiveAvailabilityService.releaseHeldSlot(availabilityId);

      logger.info('Booking cancelled and availability slot released', {
        bookingId,
        availabilityId,
        userId,
        reason
      });

      return {
        booking: cancelledResult.booking,
        availabilitySlot: releasedSlot
      };
    } catch (error) {
      logger.error('Error cancelling booking:', error);
      throw new Error('Failed to cancel booking');
    }
  }

  /**
   * Get booking with availability information
   * @param {string} bookingId - Booking ID
   * @returns {Promise<Object>} Booking with availability details
   */
  static async getBookingWithAvailability(bookingId) {
    try {
      const booking = await BookingModel.getById(bookingId);

      if (!booking) {
        throw new Error('Booking not found');
      }

      let availabilitySlot = null;
      if (booking.availabilityId) {
        availabilitySlot = await ComprehensiveAvailabilityService.getAvailabilityById(
          booking.availabilityId
        );
      }

      return {
        booking,
        availabilitySlot
      };
    } catch (error) {
      logger.error('Error getting booking with availability:', error);
      throw new Error('Failed to get booking details');
    }
  }

  /**
   * Get user's bookings with availability status
   * @param {string} userId - User ID
   * @param {Object} options - Filter options
   * @returns {Promise<Array>} Bookings with availability status
   */
  static async getUserBookingsWithAvailability(userId, options = {}) {
    try {
      const bookings = await BookingModel.getByUser(userId, options);

      // Enrich with availability information
      const enrichedBookings = await Promise.all(bookings.map(async (booking) => {
        let availabilityStatus = 'unknown';
        let availabilitySlot = null;

        if (booking.availabilityId) {
          try {
            availabilitySlot = await ComprehensiveAvailabilityService.getAvailabilityById(
              booking.availabilityId
            );

            if (availabilitySlot) {
              if (availabilitySlot.is_booked && availabilitySlot.booking_id === booking.id) {
                availabilityStatus = 'confirmed';
              } else if (availabilitySlot.hold_user_id === userId) {
                availabilityStatus = 'held';
              } else if (availabilitySlot.is_booked) {
                availabilityStatus = 'booked_by_others';
              } else {
                availabilityStatus = 'available';
              }
            }
          } catch (error) {
            logger.warn('Error getting availability for booking:', error.message);
            availabilityStatus = 'error';
          }
        }

        return {
          ...booking,
          availabilityStatus,
          availabilitySlot
        };
      }));

      return enrichedBookings;
    } catch (error) {
      logger.error('Error getting user bookings with availability:', error);
      throw new Error('Failed to get user bookings');
    }
  }

  /**
   * Get model's bookings with availability calendar
   * @param {number} modelId - Model ID
   * @param {Object} options - Filter options
   * @returns {Promise<Object>} Bookings with availability calendar
   */
  static async getModelBookingsWithCalendar(modelId, options = {}) {
    try {
      const bookings = await BookingModel.getByPerformer(modelId, options);
      const availabilitySettings = await ComprehensiveAvailabilityService.getModelAvailabilitySettings(modelId);

      // Create calendar view
      const calendar = this._createAvailabilityCalendar(
        availabilitySettings.manualAvailability,
        bookings
      );

      return {
        bookings,
        availabilitySettings,
        calendar
      };
    } catch (error) {
      logger.error('Error getting model bookings with calendar:', error);
      throw new Error('Failed to get model bookings');
    }
  }

  /**
   * Create availability calendar view
   */
  static _createAvailabilityCalendar(availabilitySlots, bookings) {
    const now = new Date();
    const calendar = {
      slots: [],
      bookings: [],
      statistics: {
        totalSlots: 0,
        bookedSlots: 0,
        availableSlots: 0,
        utilizationRate: 0
      }
    };

    // Process availability slots
    calendar.statistics.totalSlots = availabilitySlots.length;
    calendar.statistics.bookedSlots = availabilitySlots.filter(s => s.is_booked).length;
    calendar.statistics.availableSlots = availabilitySlots.filter(s => !s.is_booked).length;
    calendar.statistics.utilizationRate = calendar.statistics.totalSlots > 0
      ? Math.round((calendar.statistics.bookedSlots / calendar.statistics.totalSlots) * 100)
      : 0;

    // Add slots to calendar
    calendar.slots = availabilitySlots.map(slot => ({
      ...slot,
      status: slot.is_booked ? 'booked' : (slot.hold_user_id ? 'held' : 'available'),
      isPast: new Date(slot.available_to) < now
    }));

    // Add bookings to calendar
    calendar.bookings = bookings.map(booking => ({
      ...booking,
      status: booking.status,
      isPast: new Date(booking.endTimeUtc) < now,
      isUpcoming: new Date(booking.startTimeUtc) > now
    }));

    return calendar;
  }

  /**
   * Check if a model is available for instant booking
   * @param {number} modelId - Model ID
   * @param {number} durationMinutes - Duration in minutes
   * @returns {Promise<Object>} Availability check result
   */
  static async checkInstantAvailability(modelId, durationMinutes) {
    try {
      const modelSettings = await ComprehensiveAvailabilityService.getModelAvailabilitySettings(modelId);

      if (!modelSettings.modelInfo.can_instant_book) {
        return {
          available: false,
          reason: 'Model does not allow instant booking',
          nextAvailableSlot: modelSettings.statistics.nextAvailableSlot
        };
      }

      // Check for immediate availability
      const now = new Date();
      const searchEnd = new Date();
      searchEnd.setHours(searchEnd.getHours() + 2); // Look 2 hours ahead

      const availableSlots = await ComprehensiveAvailabilityService.findSmartAvailableSlots(
        modelId,
        durationMinutes,
        now,
        now,
        searchEnd
      );

      if (availableSlots.length > 0) {
        return {
          available: true,
          bestSlot: availableSlots[0],
          allSlots: availableSlots
        };
      } else {
        return {
          available: false,
          reason: 'No immediate availability',
          nextAvailableSlot: modelSettings.statistics.nextAvailableSlot
        };
      }
    } catch (error) {
      logger.error('Error checking instant availability:', error);
      throw new Error('Failed to check availability');
    }
  }

  /**
   * Calculate price based on duration
   */
  static _calculatePrice(durationMinutes) {
    // This should be replaced with actual pricing logic from the model's settings
    const basePrice = 100; // $1 per minute base
    return basePrice * durationMinutes;
  }

  /**
   * Get availability conflicts for a booking request
   * @param {number} modelId - Model ID
   * @param {Date} startTime - Proposed start time
   * @param {Date} endTime - Proposed end time
   * @returns {Promise<Object>} Conflict analysis
   */
  static async checkBookingConflicts(modelId, startTime, endTime) {
    try {
      // Check availability conflicts
      const conflicts = await ComprehensiveAvailabilityService.checkAvailabilityConflicts(
        modelId,
        startTime,
        endTime
      );

      // Check booking conflicts
      const existingBookings = await BookingModel.getByPerformer(modelId, {
        statuses: ['confirmed', 'pending']
      });

      const bookingConflicts = existingBookings.filter(booking => {
        const bookingStart = new Date(booking.startTimeUtc);
        const bookingEnd = new Date(booking.endTimeUtc);
        const proposedStart = new Date(startTime);
        const proposedEnd = new Date(endTime);

        return bookingStart < proposedEnd && bookingEnd > proposedStart;
      });

      return {
        availabilityConflicts: conflicts,
        bookingConflicts,
        canBook: conflicts.length === 0 && bookingConflicts.length === 0
      };
    } catch (error) {
      logger.error('Error checking booking conflicts:', error);
      throw new Error('Failed to check conflicts');
    }
  }

  /**
   * Reschedule a booking with availability updates
   * @param {string} bookingId - Booking ID
   * @param {Date} newStartTime - New start time
   * @param {number} newDurationMinutes - New duration
   * @returns {Promise<Object>} Rescheduling result
   */
  static async rescheduleBooking(bookingId, newStartTime, newDurationMinutes) {
    try {
      const client = await getClient();

      try {
        await client.query('BEGIN');

        // Get current booking
        const currentBooking = await BookingModel.getById(bookingId);

        if (!currentBooking) {
          throw new Error('Booking not found');
        }

        // Check conflicts for new time
        const newEndTime = new Date(
          new Date(newStartTime).getTime() + newDurationMinutes * 60 * 1000
        );

        const conflictCheck = await this.checkBookingConflicts(
          currentBooking.performerId,
          newStartTime,
          newEndTime
        );

        if (!conflictCheck.canBook) {
          throw new Error('New time conflicts with existing availability or bookings');
        }

        // Find new availability slot or create one
        let newAvailabilitySlot;
        const availableSlots = await ComprehensiveAvailabilityService.findSmartAvailableSlots(
          currentBooking.performerId,
          newDurationMinutes,
          newStartTime,
          newStartTime,
          newEndTime
        );

        if (availableSlots.length > 0) {
          // Use existing slot
          newAvailabilitySlot = availableSlots[0];
          await ComprehensiveAvailabilityService.holdSlotForBooking(
            newAvailabilitySlot.id,
            currentBooking.userId,
            newDurationMinutes
          );
        } else {
          // Create new availability slot
          const createdSlot = await ComprehensiveAvailabilityService.addAvailability(
            currentBooking.performerId,
            newStartTime,
            newEndTime
          );
          newAvailabilitySlot = createdSlot;
          await ComprehensiveAvailabilityService.holdSlotForBooking(
            newAvailabilitySlot.id,
            currentBooking.userId,
            newDurationMinutes
          );
        }

        // Release old slot if it exists
        if (currentBooking.availabilityId) {
          await ComprehensiveAvailabilityService.releaseHeldSlot(currentBooking.availabilityId);
        }

        // Update booking
        const updatedResult = await BookingModel.update(bookingId, {
          startTimeUtc: newStartTime,
          durationMinutes: newDurationMinutes,
          availabilityId: newAvailabilitySlot.id
        });
        if (!updatedResult.success) {
          throw new Error(updatedResult.error || 'Failed to update booking');
        }

        await client.query('COMMIT');

        logger.info('Booking rescheduled successfully', {
          bookingId,
          oldStartTime: currentBooking.startTimeUtc,
          newStartTime,
          oldDuration: currentBooking.durationMinutes,
          newDuration: newDurationMinutes
        });

        return {
          success: true,
          oldBooking: currentBooking,
          newBooking: updatedResult.booking,
          newAvailabilitySlot
        };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      logger.error('Error rescheduling booking:', error);
      throw new Error('Failed to reschedule booking');
    }
  }

  /**
   * Get availability statistics for a model
   * @param {number} modelId - Model ID
   * @param {Date} startDate - Start date for statistics
   * @param {Date} endDate - End date for statistics
   * @returns {Promise<Object>} Availability statistics
   */
  static async getAvailabilityStatistics(modelId, startDate, endDate) {
    try {
      const settings = await ComprehensiveAvailabilityService.getModelAvailabilitySettings(modelId);

      // Filter slots by date range
      const filteredSlots = settings.manualAvailability.filter(slot => {
        const slotDate = new Date(slot.available_from);
        return slotDate >= startDate && slotDate <= endDate;
      });

      const filteredBookings = settings.upcomingBookings.filter(booking => {
        const bookingDate = new Date(booking.booking_time);
        return bookingDate >= startDate && bookingDate <= endDate;
      });

      // Calculate statistics
      const stats = {
        periodStart: startDate,
        periodEnd: endDate,
        totalSlots: filteredSlots.length,
        bookedSlots: filteredSlots.filter(s => s.is_booked).length,
        availableSlots: filteredSlots.filter(s => !s.is_booked).length,
        totalBookings: filteredBookings.length,
        confirmedBookings: filteredBookings.filter(b => b.status === 'confirmed').length,
        pendingBookings: filteredBookings.filter(b => b.status === 'pending').length,
        utilizationRate: filteredSlots.length > 0
          ? Math.round((filteredSlots.filter(s => s.is_booked).length / filteredSlots.length) * 100)
          : 0,
        revenuePotential: this._calculateRevenuePotential(filteredSlots),
        confirmedRevenue: this._calculateConfirmedRevenue(filteredBookings)
      };

      return stats;
    } catch (error) {
      logger.error('Error getting availability statistics:', error);
      throw new Error('Failed to get statistics');
    }
  }

  /**
   * Calculate revenue potential from available slots
   */
  static _calculateRevenuePotential(slots) {
    // This should use actual pricing from model settings
    const averagePricePerMinute = 1.5; // Example average price
    return slots.reduce((total, slot) => {
      const duration = (new Date(slot.available_to) - new Date(slot.available_from)) / (1000 * 60);
      return total + (duration * averagePricePerMinute * 100); // in cents
    }, 0);
  }

  /**
   * Calculate confirmed revenue from bookings
   */
  static _calculateConfirmedRevenue(bookings) {
    return bookings.reduce((total, booking) => {
      if (booking.status === 'confirmed' || booking.status === 'completed') {
        if (booking.priceCents !== undefined) {
          return total + Number(booking.priceCents || 0);
        }
        if (booking.price_usd !== undefined) {
          return total + Number(booking.price_usd || 0) * 100;
        }
      }
      return total;
    }, 0);
  }

  /**
   * Export booking and availability data for a model
   * @param {number} modelId - Model ID
   * @param {Date} startDate - Start date
   * @param {Date} endDate - End date
   * @returns {Promise<Object>} Export data
   */
  static async exportModelData(modelId, startDate, endDate) {
    try {
      const bookings = await BookingModel.getByPerformer(modelId, {
        statuses: ['pending', 'confirmed', 'completed', 'cancelled']
      });

      const availabilitySettings = await ComprehensiveAvailabilityService.getModelAvailabilitySettings(modelId);

      // Filter by date range
      const filteredBookings = bookings.filter(booking => {
        const bookingDate = new Date(booking.booking_time);
        return bookingDate >= startDate && bookingDate <= endDate;
      });

      const filteredAvailability = availabilitySettings.manualAvailability.filter(slot => {
        const slotDate = new Date(slot.available_from);
        return slotDate >= startDate && slotDate <= endDate;
      });

      return {
        modelId,
        exportDate: new Date(),
        dateRange: { startDate, endDate },
        bookings: filteredBookings,
        availability: filteredAvailability,
        statistics: this._calculateExportStatistics(filteredBookings, filteredAvailability)
      };
    } catch (error) {
      logger.error('Error exporting model data:', error);
      throw new Error('Failed to export data');
    }
  }

  /**
   * Calculate export statistics
   */
  static _calculateExportStatistics(bookings, availability) {
    return {
      totalBookings: bookings.length,
      totalAvailabilitySlots: availability.length,
      bookingStatuses: {
        pending: bookings.filter(b => b.status === 'pending').length,
        confirmed: bookings.filter(b => b.status === 'confirmed').length,
        completed: bookings.filter(b => b.status === 'completed').length,
        cancelled: bookings.filter(b => b.status === 'cancelled').length
      },
      availabilityStatuses: {
        available: availability.filter(s => !s.is_booked).length,
        booked: availability.filter(s => s.is_booked).length,
        held: availability.filter(s => s.hold_user_id).length
      }
    };
  }
}

module.exports = BookingAvailabilityIntegration;
