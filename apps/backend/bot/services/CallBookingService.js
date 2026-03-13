'use strict';
const { query } = require('../../config/postgres');
const callPackageService = require('./callPackageService');
const logger = require('../../utils/logger');
const moment = require('moment-timezone');
const { v4: uuidv4 } = require('uuid');

/**
 * CallBookingService.js
 * The single source of truth for all "Book a Call" logic.
 * Consolidates availability checking, booking creation, slot locking, and credit management.
 */
class CallBookingService {

  /**
   * Get available slots for a creator, ensuring all calculations are in UTC.
   */
  static async getAvailableSlots(creatorId, fromDate, toDate, durationMinutes = 30) {
    try {
      const performerResult = await query('SELECT * FROM performers WHERE user_id = $1', [creatorId]);
      const performer = performerResult.rows[0];
      if (!performer || performer.status !== 'active') {
        return [];
      }

      // Get existing bookings for the performer in the date range
      const existingBookingsResult = await query(
        `SELECT start_time_utc, end_time_utc FROM bookings
         WHERE performer_id = $1 AND status IN ('held', 'awaiting_payment', 'confirmed')
         AND start_time_utc >= $2 AND start_time_utc <= $3`,
        [performer.id, fromDate.toISOString(), toDate.toISOString()]
      );
      const activeBookings = existingBookingsResult.rows;

      // Get availability rules from performer's schedules
      const schedulesResult = await query(
        `SELECT day_of_week, start_time, end_time, timezone FROM creator_availability_schedules
         WHERE creator_id = $1 AND is_active = true`,
        [creatorId]
      );
      const availabilitySchedules = schedulesResult.rows;

      const slots = [];
      const bufferBefore = performer.buffer_before_minutes || 5;
      const bufferAfter = performer.buffer_after_minutes || 10;

      // Iterate through each day in the range
      let currentDay = moment.utc(fromDate).startOf('day');
      const endDay = moment.utc(toDate).endOf('day');

      while (currentDay.isSameOrBefore(endDay, 'day')) {
        const dayOfWeek = currentDay.day(); // 0 (Sunday) to 6 (Saturday)
        const schedulesForDay = availabilitySchedules.filter(s => s.day_of_week === dayOfWeek);

        if (schedulesForDay.length > 0) {
          for (const schedule of schedulesForDay) {
            let tz = schedule.timezone || 'UTC';
            if (!moment.tz.zone(tz)) {
              logger.warn(`Invalid timezone "${tz}" in schedule for creator ${creatorId}, falling back to UTC`);
              tz = 'UTC';
            }
            let scheduleStart = moment.tz(`${currentDay.format('YYYY-MM-DD')}T${schedule.start_time}`, tz);
            let scheduleEnd = moment.tz(`${currentDay.format('YYYY-MM-DD')}T${schedule.end_time}`, tz);

            // Convert to UTC for consistent comparison
            scheduleStart = scheduleStart.utc();
            scheduleEnd = scheduleEnd.utc();

            let slotStart = scheduleStart;
            while (slotStart.isBefore(scheduleEnd)) {
              const slotEnd = slotStart.clone().add(durationMinutes, 'minutes');

              // Ensure slot ends within the scheduled availability
              if (slotEnd.isAfter(scheduleEnd)) {
                slotStart = slotStart.clone().add(30, 'minutes');
                continue;
              }

              // Check if slot is in the future (with buffer)
              const nowWithBuffer = moment.utc().add(bufferBefore, 'minutes');
              if (slotStart.isSameOrBefore(nowWithBuffer)) {
                slotStart = slotStart.clone().add(30, 'minutes');
                continue;
              }

              // Check for conflicts with existing bookings
              const hasConflict = activeBookings.some(booking => {
                const bookingStart = moment.utc(booking.start_time_utc);
                const bookingEnd = moment.utc(booking.end_time_utc);

                const conflictStart = bookingStart.clone().subtract(bufferBefore, 'minutes');
                const conflictEnd = bookingEnd.clone().add(bufferAfter, 'minutes');

                return slotStart.isBefore(conflictEnd) && slotEnd.isAfter(conflictStart);
              });

              if (!hasConflict) {
                slots.push({
                  startUtc: slotStart.toISOString(),
                  endUtc: slotEnd.toISOString(),
                  durationMinutes,
                  available: true,
                });
              }
              slotStart = slotStart.clone().add(30, 'minutes');
            }
          }
        }
        currentDay = currentDay.clone().add(1, 'day');
      }

      return slots;
    } catch (error) {
      logger.error('Error getting available slots:', error);
      throw error;
    }
  }

  /**
   * Creates a booking, ensuring atomicity to prevent double bookings.
   */
  static async createBooking(data) {
    const { memberId, creatorId, startAt, creditId, durationMinutes } = data;
    const pool = require('../../config/postgres').getPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // 1. Lock the credit FOR UPDATE to prevent double-spending
      // SEC: bind creator_id to prevent a member from using another creator's credit for a different creator
      const creditResult = await client.query(
        `SELECT cc.*, cp.duration_minutes as pkg_duration
         FROM call_credits cc
         JOIN call_packages cp ON cp.id = cc.package_id
         WHERE cc.id = $1 AND cc.member_id = $2 AND cc.creator_id = $3
           AND cc.status IN ('unused', 'partial')
           AND (cc.expires_at IS NULL OR cc.expires_at > NOW())
         FOR UPDATE`,
        [creditId, memberId, creatorId]
      );

      if (creditResult.rows.length === 0) {
        throw { statusCode: 402, message: 'No valid call credit found', code: 'NO_CREDIT' };
      }

      const credit = creditResult.rows[0];

      // 2. Validate duration matches package
      if (durationMinutes !== credit.pkg_duration) {
        throw { statusCode: 400, message: `This credit is for ${credit.pkg_duration} minutes, but ${durationMinutes} were requested.` };
      }

      // HIGH-03: Enforce 30-min minimum lead-time before booking
      const startMoment = moment.utc(startAt);
      if (startMoment.diff(moment.utc(), 'minutes') < 30) {
        throw { statusCode: 400, message: 'Bookings must be at least 30 minutes in advance', code: 'TOO_SOON' };
      }

      // 3. Check slot availability using a pessimistic lock on existing overlapping bookings
      // HIGH-06: Include 'awaiting_payment' in conflict check status list
      const endTime = startMoment.clone().add(durationMinutes, 'minutes').toISOString();

      const conflictCheck = await client.query(
        `SELECT 1 FROM bookings
         WHERE performer_id = (SELECT id FROM performers WHERE user_id = $1)
           AND status IN ('confirmed', 'held', 'awaiting_payment')
           AND (start_time_utc, end_time_utc) OVERLAPS ($2, $3)
         FOR UPDATE`,
        [creatorId, startAt, endTime]
      );

      if (conflictCheck.rows.length > 0) {
        throw { statusCode: 409, message: 'Slot is no longer available', code: 'SLOT_OCCUPIED' };
      }

      // 4. Double check the performer exists and is active
      const performerResult = await client.query(
        'SELECT id FROM performers WHERE user_id = $1 AND status = \'active\'',
        [creatorId]
      );
      if (performerResult.rows.length === 0) {
        throw { statusCode: 404, message: 'Creator not found or not accepting calls' };
      }
      const performerId = performerResult.rows[0].id;

      // CRIT-03: Reserve credit (quantity_scheduled++) via callPackageService
      // Credit is consumed (quantity_used++) only when call completes
      await callPackageService.reserveCredit(creditId, client);

      // 6. Create the booking record
      const bookingResult = await client.query(
        `INSERT INTO bookings (
          id, user_id, performer_id, start_time_utc, end_time_utc,
          duration_minutes, credit_id, status, call_type
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'confirmed', 'video')
        RETURNING *`,
        [uuidv4(), memberId, performerId, startAt, endTime, durationMinutes, creditId]
      );

      await client.query('COMMIT');
      logger.info('Call booking successful', { bookingId: bookingResult.rows[0].id, memberId, creatorId });
      
      return bookingResult.rows[0];

    } catch (error) {
      await client.query('ROLLBACK');
      if (error.statusCode) throw error;
      logger.error('Call booking transaction failed:', error);
      throw { statusCode: 500, message: 'Internal server error during booking' };
    } finally {
      client.release();
    }
  }
  
  /**
   * DB-H2: Complete a booking — consume credit + update booking status.
   */
  static async completeBooking(bookingId) {
    const pool = require('../../config/postgres').getPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const bookingResult = await client.query(
        `SELECT * FROM bookings WHERE id = $1 AND status = 'confirmed' FOR UPDATE`,
        [bookingId]
      );
      if (bookingResult.rows.length === 0) {
        throw new Error(`Booking ${bookingId} not found or not in confirmed status`);
      }
      const booking = bookingResult.rows[0];

      // Consume the credit (quantity_used++, quantity_scheduled--)
      if (booking.credit_id) {
        await callPackageService.consumeCredit(booking.credit_id, client);
      }

      await client.query(
        `UPDATE bookings SET status = 'completed', completed_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [bookingId]
      );

      await client.query('COMMIT');
      logger.info('Booking completed', { bookingId });
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('completeBooking failed:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * DB-H2: Cancel a booking — unreserve credit + update booking status.
   */
  static async cancelBooking(bookingId, reason = 'User cancellation') {
    const pool = require('../../config/postgres').getPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const bookingResult = await client.query(
        `SELECT * FROM bookings WHERE id = $1 AND status NOT IN ('completed', 'cancelled', 'expired') FOR UPDATE`,
        [bookingId]
      );
      if (bookingResult.rows.length === 0) {
        throw new Error(`Booking ${bookingId} not found or already in terminal status`);
      }
      const booking = bookingResult.rows[0];

      // Unreserve the credit (quantity_scheduled--)
      if (booking.credit_id) {
        await client.query(
          `UPDATE call_credits
           SET quantity_scheduled = GREATEST(0, quantity_scheduled - 1)
           WHERE id = $1`,
          [booking.credit_id]
        );
      }

      await client.query(
        `UPDATE bookings SET status = 'cancelled', cancel_reason = $2, cancelled_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [bookingId, reason]
      );

      await client.query('COMMIT');
      logger.info('Booking cancelled', { bookingId, reason });
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('cancelBooking failed:', error);
      throw error;
    } finally {
      client.release();
    }
  }
}

module.exports = CallBookingService;
