'use strict';

/**
 * callBookingController.js
 * Handles checkout, booking detail retrieval, post-call surveys,
 * creator availability schedule management, and online presence.
 *
 * NOTE: "bookingId" in route params for getBooking / submitSurvey refers to
 * call_credits.id — there is no separate app_call_bookings table; the credit
 * record IS the booking record for the new Book-a-Call flow.
 */

const { query } = require('../../../config/postgres');
const { getRedis } = require('../../../config/redis');
const callCheckoutService = require('../../services/callCheckoutService');
const callPackageService = require('../../services/callPackageService');
const livekitService = require('../../services/livekitService');
const logger = require('../../../utils/logger');

// Redis key for creator online presence (matches bookACallService.js)
const ONLINE_KEY = (userId) => `user:${userId}:active`;
// TTL for the online presence key (30 minutes — heartbeat is expected from frontend)
const ONLINE_TTL_SECONDS = 30 * 60;

// ---------------------------------------------------------------------------
// POST /api/webapp/book-call/checkout
// ---------------------------------------------------------------------------

/**
 * Create a payment intent for a call package.
 * Body: { packageId: number, provider: 'epayco'|'daimo', email: string }
 */
async function createCheckout(req, res) {
  try {
    const sessionUser = req.session?.user;
    if (!sessionUser?.id) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    const memberId = String(sessionUser.id);

    const { packageId, provider, email } = req.body;

    if (!packageId || !Number.isInteger(Number(packageId)) || Number(packageId) < 1) {
      return res.status(400).json({ success: false, error: 'packageId must be a positive integer' });
    }
    if (!provider || !['epayco', 'daimo'].includes(provider)) {
      return res.status(400).json({ success: false, error: 'provider must be epayco or daimo' });
    }
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return res.status(400).json({ success: false, error: 'A valid email is required' });
    }

    const result = await callCheckoutService.createCallCheckout(
      memberId,
      Number(packageId),
      provider,
      email.trim().toLowerCase()
    );

    return res.status(201).json({ success: true, ...result });
  } catch (err) {
    logger.error('[callBookingController] createCheckout error', { error: err.message, code: err.code });

    if (err.code === 'PACKAGE_NOT_FOUND') {
      return res.status(404).json({ success: false, error: 'Call package not found or inactive' });
    }
    if (err.code === 'INVALID_PROVIDER') {
      return res.status(400).json({ success: false, error: err.message });
    }
    return res.status(500).json({ success: false, error: 'Failed to create checkout' });
  }
}

// ---------------------------------------------------------------------------
// GET /api/webapp/bookings/:bookingId
// ---------------------------------------------------------------------------

/**
 * Returns credit details plus a fresh LiveKit token for the member.
 * :bookingId is call_credits.id.
 */
async function getBooking(req, res) {
  try {
    const sessionUser = req.session?.user;
    if (!sessionUser?.id) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    const userId = String(sessionUser.id);
    const creditId = Number(req.params.bookingId);

    if (!Number.isInteger(creditId) || creditId < 1) {
      return res.status(400).json({ success: false, error: 'Invalid bookingId' });
    }

    // Load credit — accessible by the member OR the creator
    const creditResult = await query(
      `SELECT cc.*,
              cp.duration_minutes, cp.title AS package_title,
              u_creator.username AS creator_username,
              u_creator.display_name AS creator_display_name,
              u_creator.photo_url AS creator_photo,
              u_member.username AS member_username,
              u_member.display_name AS member_display_name,
              u_member.photo_url AS member_photo
       FROM call_credits cc
       JOIN call_packages cp ON cp.id = cc.package_id
       JOIN users u_creator ON u_creator.id = cc.creator_id
       JOIN users u_member  ON u_member.id  = cc.member_id
       WHERE cc.id = $1
         AND (cc.member_id = $2 OR cc.creator_id = $2)`,
      [creditId, userId]
    );

    const credit = creditResult.rows[0];
    if (!credit) {
      return res.status(404).json({ success: false, error: 'Booking not found' });
    }

    // Determine a LiveKit room name for this credit (deterministic, stable per credit)
    const roomName = `call-credit-${credit.id}`;
    const isModerator = userId === credit.creator_id;

    let livekitInfo = null;
    if (livekitService.isConfigured()) {
      try {
        await livekitService.ensureRoom(roomName);
        livekitInfo = await livekitService.generateMeetingInfo(
          roomName,
          userId,
          (isModerator ? credit.creator_display_name : credit.member_display_name) || userId,
          (isModerator ? credit.creator_photo : credit.member_photo) || '',
          isModerator
        );
      } catch (lkErr) {
        logger.warn('[callBookingController] LiveKit token generation failed', {
          creditId,
          error: lkErr.message,
        });
      }
    }

    const booking = {
      id: credit.id,
      member_id: credit.member_id,
      creator_id: credit.creator_id,
      credit_id: credit.id,
      duration_minutes: credit.duration_minutes,
      package_title: credit.package_title,
      status: credit.status,
      livekit_room: roomName,
      created_at: credit.created_at,
      creator_username: credit.creator_username,
      creator_display_name: credit.creator_display_name,
      creator_photo: credit.creator_photo,
      member_username: credit.member_username,
      member_display_name: credit.member_display_name,
      member_photo: credit.member_photo,
    };

    return res.json({ success: true, booking, livekit: livekitInfo });
  } catch (err) {
    logger.error('[callBookingController] getBooking error', { error: err.message });
    return res.status(500).json({ success: false, error: 'Failed to retrieve booking' });
  }
}

// ---------------------------------------------------------------------------
// POST /api/webapp/bookings/:bookingId/survey
// ---------------------------------------------------------------------------

/**
 * Submit a post-call rating + feedback survey.
 * :bookingId is call_credits.id.
 * Body: { rating: 1-5, feedback?: string }
 */
async function submitSurvey(req, res) {
  try {
    const sessionUser = req.session?.user;
    if (!sessionUser?.id) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    const memberId = String(sessionUser.id);
    const creditId = Number(req.params.bookingId);

    if (!Number.isInteger(creditId) || creditId < 1) {
      return res.status(400).json({ success: false, error: 'Invalid bookingId' });
    }

    const { rating, feedback } = req.body;
    const numRating = Number(rating);
    if (!Number.isInteger(numRating) || numRating < 1 || numRating > 5) {
      return res.status(400).json({ success: false, error: 'rating must be an integer from 1 to 5' });
    }

    // Validate the credit belongs to this member and has been used at least once
    const creditResult = await query(
      `SELECT cc.id, cc.creator_id, cc.quantity_used
       FROM call_credits cc
       WHERE cc.id = $1 AND cc.member_id = $2`,
      [creditId, memberId]
    );
    const credit = creditResult.rows[0];
    if (!credit) {
      return res.status(404).json({ success: false, error: 'Booking not found or not accessible' });
    }
    if (credit.quantity_used < 1) {
      return res.status(409).json({ success: false, error: 'Cannot submit survey before the call has taken place' });
    }

    // Sanitize feedback text
    const sanitizedFeedback = typeof feedback === 'string'
      ? feedback.trim().slice(0, 2000) || null
      : null;

    // Insert survey (UNIQUE constraint on credit_id prevents duplicates)
    try {
      await query(
        `INSERT INTO call_booking_surveys (credit_id, member_id, creator_id, rating, feedback)
         VALUES ($1, $2, $3, $4, $5)`,
        [creditId, memberId, credit.creator_id, numRating, sanitizedFeedback]
      );
    } catch (insertErr) {
      if (insertErr.code === '23505') {
        // Unique violation — survey already submitted
        return res.status(409).json({ success: false, error: 'Survey already submitted for this booking' });
      }
      throw insertErr;
    }

    logger.info('[callBookingController] survey submitted', { creditId, memberId, rating: numRating });
    return res.json({ success: true });
  } catch (err) {
    logger.error('[callBookingController] submitSurvey error', { error: err.message });
    return res.status(500).json({ success: false, error: 'Failed to submit survey' });
  }
}

// ---------------------------------------------------------------------------
// GET /api/webapp/creator/availability/schedule
// ---------------------------------------------------------------------------

/**
 * Return the authenticated creator's weekly availability schedule.
 */
async function getAvailabilitySchedule(req, res) {
  try {
    const sessionUser = req.session?.user;
    if (!sessionUser?.id) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    const creatorId = String(sessionUser.id);

    const result = await query(
      `SELECT day_of_week, start_time, end_time, timezone
       FROM creator_availability_schedules
       WHERE creator_id = $1 AND is_active = true
       ORDER BY day_of_week, start_time`,
      [creatorId]
    );

    // Normalize TIME values to "HH:MM" strings
    const schedule = result.rows.map((row) => ({
      day_of_week: row.day_of_week,
      start_time: String(row.start_time).slice(0, 5),
      end_time: String(row.end_time).slice(0, 5),
      timezone: row.timezone,
    }));

    return res.json({ success: true, schedule });
  } catch (err) {
    logger.error('[callBookingController] getAvailabilitySchedule error', { error: err.message });
    return res.status(500).json({ success: false, error: 'Failed to retrieve availability schedule' });
  }
}

// ---------------------------------------------------------------------------
// POST /api/webapp/creator/availability/schedule
// ---------------------------------------------------------------------------

/**
 * Replace the authenticated creator's weekly availability schedule (full replace).
 * Body: { schedule: [{ dayOfWeek: 0-6, startTime: "HH:MM", endTime: "HH:MM", timezone: string }] }
 */
async function saveAvailabilitySchedule(req, res) {
  try {
    const sessionUser = req.session?.user;
    if (!sessionUser?.id) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    const creatorId = String(sessionUser.id);

    // Only creators (role: 'model'), admins, and superadmins may manage availability
    const userRole = sessionUser.role || '';
    if (!['model', 'admin', 'superadmin'].includes(userRole)) {
      return res.status(403).json({ success: false, error: 'Only creators can manage availability' });
    }

    const { schedule } = req.body;
    if (!Array.isArray(schedule)) {
      return res.status(400).json({ success: false, error: 'schedule must be an array' });
    }
    if (schedule.length > 50) {
      return res.status(400).json({ success: false, error: 'schedule cannot have more than 50 entries' });
    }

    const TIME_RE = /^\d{2}:\d{2}$/;
    const VALID_TZ_CHARS = /^[A-Za-z0-9/_+-]+$/;

    for (let i = 0; i < schedule.length; i++) {
      const slot = schedule[i];
      const dow = Number(slot.dayOfWeek);
      if (!Number.isInteger(dow) || dow < 0 || dow > 6) {
        return res.status(400).json({ success: false, error: `schedule[${i}].dayOfWeek must be 0-6` });
      }
      if (!slot.startTime || !TIME_RE.test(slot.startTime)) {
        return res.status(400).json({ success: false, error: `schedule[${i}].startTime must be HH:MM` });
      }
      if (!slot.endTime || !TIME_RE.test(slot.endTime)) {
        return res.status(400).json({ success: false, error: `schedule[${i}].endTime must be HH:MM` });
      }
      if (slot.startTime >= slot.endTime) {
        return res.status(400).json({ success: false, error: `schedule[${i}].endTime must be after startTime` });
      }
      if (!slot.timezone || !VALID_TZ_CHARS.test(slot.timezone) || slot.timezone.length > 100) {
        return res.status(400).json({ success: false, error: `schedule[${i}].timezone is invalid` });
      }
    }

    // Full replace strategy — deactivate all existing, insert new rows
    await query(
      'UPDATE creator_availability_schedules SET is_active = false WHERE creator_id = $1',
      [creatorId]
    );

    for (const slot of schedule) {
      await query(
        `INSERT INTO creator_availability_schedules
           (creator_id, day_of_week, start_time, end_time, timezone, is_active)
         VALUES ($1, $2, $3::time, $4::time, $5, true)
         ON CONFLICT (creator_id, day_of_week, start_time)
         DO UPDATE SET
           end_time = EXCLUDED.end_time,
           timezone = EXCLUDED.timezone,
           is_active = true,
           updated_at = NOW()`,
        [creatorId, Number(slot.dayOfWeek), slot.startTime, slot.endTime, slot.timezone]
      );
    }

    logger.info('[callBookingController] availability schedule saved', {
      creatorId,
      slotCount: schedule.length,
    });
    return res.json({ success: true });
  } catch (err) {
    logger.error('[callBookingController] saveAvailabilitySchedule error', { error: err.message });
    return res.status(500).json({ success: false, error: 'Failed to save availability schedule' });
  }
}

// ---------------------------------------------------------------------------
// PUT /api/webapp/creator/online-status
// ---------------------------------------------------------------------------

/**
 * Set or clear the creator's Redis online presence key.
 * Body: { online: boolean }
 */
async function setOnlineStatus(req, res) {
  try {
    const sessionUser = req.session?.user;
    if (!sessionUser?.id) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    const userId = String(sessionUser.id);

    const { online } = req.body;
    if (typeof online !== 'boolean') {
      return res.status(400).json({ success: false, error: 'online must be a boolean' });
    }

    const redis = getRedis();
    const key = ONLINE_KEY(userId);

    if (online) {
      await redis.set(key, '1', 'EX', ONLINE_TTL_SECONDS);
    } else {
      await redis.del(key);
    }

    logger.info('[callBookingController] creator online status updated', { userId, online });
    return res.json({ success: true, online });
  } catch (err) {
    logger.error('[callBookingController] setOnlineStatus error', { error: err.message });
    return res.status(500).json({ success: false, error: 'Failed to update online status' });
  }
}

module.exports = {
  createCheckout,
  getBooking,
  submitSurvey,
  saveAvailabilitySchedule,
  setOnlineStatus,
  getAvailabilitySchedule,
};
