'use strict';
/**
 * bookACallService.js
 * Orchestrates "Book a Call" flow:
 *  - If creator is online → immediate slot (now + 15 min)
 *  - If creator is offline → next 5 available slots from availability calendar
 */
const { getRedis } = require('../../config/redis');
const PrivateCallBookingService = require('./privateCallBookingService');
const callPackageService = require('./callPackageService');
const { query } = require('../../config/postgres');
const logger = require('../../utils/logger');

const ONLINE_KEY = (userId) => `user:${userId}:active`;
const IMMEDIATE_BUFFER_MINUTES = 15;

/** Check if a user is currently online via Redis presence key. */
async function isCreatorOnline(creatorId) {
  try {
    const redis = getRedis();
    const val = await redis.get(ONLINE_KEY(creatorId));
    return val !== null;
  } catch {
    return false;
  }
}

/**
 * Get booking options for a creator.
 * Returns either an immediate slot or the next 5 available slots.
 *
 * @param {string} creatorId
 * @param {number} durationMinutes - 30 or 60
 * @returns {{ type: 'immediate'|'slots', startAt?: string, slots?: Array, durationMinutes: number }}
 */
async function getBookingOptions(creatorId, durationMinutes = 30) {
  const online = await isCreatorOnline(creatorId);

  if (online) {
    const startAt = new Date(Date.now() + IMMEDIATE_BUFFER_MINUTES * 60 * 1000);
    return {
      type: 'immediate',
      startAt: startAt.toISOString(),
      durationMinutes,
    };
  }

  // Fetch next 5 available slots within the next 14 days
  const fromDate = new Date();
  const toDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

  const allSlots = await PrivateCallBookingService.getAvailableSlots(
    creatorId, fromDate, toDate, durationMinutes
  );

  return {
    type: 'slots',
    slots: allSlots.slice(0, 5),
    durationMinutes,
  };
}

/**
 * Book a call — consumes one credit and creates a booking record via
 * PrivateCallBookingService.createBooking.
 *
 * PrivateCallBookingService.createBooking({ userId, performerId, callType,
 *   durationMinutes, startTimeUtc }) → { success, booking } | { success, error }
 *
 * @param {string} memberId
 * @param {string} creatorId
 * @param {string} startAt - ISO timestamp for call start
 * @param {number} creditId - call_credits.id to consume
 * @param {number} durationMinutes
 */
async function bookCall(memberId, creatorId, startAt, creditId, durationMinutes) {
  // Validate credit belongs to member + creator and is still available
  const creditResult = await query(
    `SELECT * FROM call_credits
     WHERE id = $1 AND member_id = $2 AND creator_id = $3
       AND status IN ('unused','partial')
       AND (expires_at IS NULL OR expires_at > NOW())`,
    [creditId, memberId, creatorId]
  );
  if (!creditResult.rows[0]) {
    throw Object.assign(new Error('No valid call credit found'), { code: 'NO_CREDIT' });
  }

  // Delegate booking creation to the existing service
  const result = await PrivateCallBookingService.createBooking({
    userId: memberId,
    performerId: creatorId,
    callType: 'private',
    durationMinutes,
    startTimeUtc: startAt,
  });

  if (!result.success) {
    const err = new Error(result.error || 'Booking creation failed');
    err.code = result.error || 'BOOKING_FAILED';
    throw err;
  }

  // Consume the credit after the booking is successfully created
  await callPackageService.consumeCredit(creditId);

  logger.info('call booked', { memberId, creatorId, creditId, startAt, durationMinutes });
  return result.booking;
}

module.exports = { isCreatorOnline, getBookingOptions, bookCall };
