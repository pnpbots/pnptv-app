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
const { query, getPool } = require('../../config/postgres');
const logger = require('../../utils/logger');

/**
 * Fetch the minimum break_minutes setting for a creator across all their active
 * availability schedule rows.  Falls back to 0 if no schedule exists so that
 * the slot list is unchanged when a creator has not configured the setting.
 *
 * @param {string} creatorId
 * @returns {Promise<number>} break gap in minutes
 */
async function getCreatorBreakMinutes(creatorId) {
  try {
    const result = await query(
      `SELECT COALESCE(MIN(break_minutes), 0) AS break_minutes
       FROM creator_availability_schedules
       WHERE creator_id = $1 AND is_active = true`,
      [creatorId]
    );
    return parseInt(result.rows[0]?.break_minutes ?? 0, 10);
  } catch (err) {
    logger.warn('[bookACallService] could not fetch break_minutes', { creatorId, error: err.message });
    return 0;
  }
}

/**
 * Filter a sorted list of slots so that consecutive slots have at least
 * `breakMinutes` of gap between the end of one and the start of the next.
 *
 * @param {Array<{startUtc: string, endUtc: string}>} slots - already sorted ascending
 * @param {number} breakMinutes
 * @returns {Array}
 */
function applyBreakFilter(slots, breakMinutes) {
  if (!breakMinutes || slots.length === 0) return slots;
  const gap = breakMinutes * 60 * 1000;
  const filtered = [slots[0]];
  for (let i = 1; i < slots.length; i++) {
    const prevEnd = new Date(filtered[filtered.length - 1].endUtc).getTime();
    const nextStart = new Date(slots[i].startUtc).getTime();
    if (nextStart - prevEnd >= gap) {
      filtered.push(slots[i]);
    }
  }
  return filtered;
}

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

  const [allSlots, breakMinutes] = await Promise.all([
    PrivateCallBookingService.getAvailableSlots(creatorId, fromDate, toDate, durationMinutes),
    getCreatorBreakMinutes(creatorId),
  ]);

  const filteredSlots = applyBreakFilter(allSlots, breakMinutes);

  return {
    type: 'slots',
    slots: filteredSlots.slice(0, 5),
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
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Validate credit belongs to member + creator and is still available — inside transaction
    // so no concurrent booking can consume it between this check and the reservation.
    const creditResult = await client.query(
      `SELECT * FROM call_credits
       WHERE id = $1 AND member_id = $2 AND creator_id = $3
         AND status IN ('unused','partial')
         AND (expires_at IS NULL OR expires_at > NOW())
       FOR UPDATE`,
      [creditId, memberId, creatorId]
    );
    if (!creditResult.rows[0]) {
      throw Object.assign(new Error('No valid call credit found'), { code: 'NO_CREDIT' });
    }

    // Reserve the credit slot first — prevents double-booking if another request races
    await callPackageService.reserveCredit(creditId, client);

    // Create the booking record
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

    // Consume the reserved credit slot
    await callPackageService.consumeCredit(creditId, client);

    await client.query('COMMIT');
    logger.info('call booked', { memberId, creatorId, creditId, startAt, durationMinutes });
    return result.booking;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { isCreatorOnline, getBookingOptions, bookCall };
