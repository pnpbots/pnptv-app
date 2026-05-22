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

const { query, getPool } = require('../../../config/postgres');
const { getRedis } = require('../../../config/redis');
const callCheckoutService = require('../../../services/callCheckoutService');
const callPackageService = require('../../../services/callPackageService');
const { generateToken, LIVEKIT_WS_URL } = require('../../../services/livekitService');
const CallBookingService = require('../../../services/CallBookingService');
const moment = require('moment-timezone');
const logger = require('../../../utils/logger');

// Redis key for creator online presence
const ONLINE_KEY = (userId) => `user:${userId}:active`;
// TTL for the online presence key (30 minutes — heartbeat is expected from frontend)
const ONLINE_TTL_SECONDS = 30 * 60;

// UUID pattern
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INT_RE = /^\d+$/;

/**
 * Resolve a booking by either call_credits.id (positive integer string)
 * or bookings.id (UUID). Returns the credit row with booking times merged in,
 * or null if not found or caller is not a participant.
 */
async function resolveBooking(rawId, callerUserId) {
  if (UUID_RE.test(rawId)) {
    const result = await query(
      `SELECT cc.*,
              cp.duration_minutes, cp.title AS package_title,
              u_creator.username AS creator_username,
              u_creator.display_name AS creator_display_name,
              u_creator.photo_url AS creator_photo,
              u_member.username AS member_username,
              u_member.display_name AS member_display_name,
              u_member.photo_url AS member_photo,
              b.start_time_utc AS start_at,
              b.end_time_utc AS end_at,
              b.status AS booking_status
       FROM bookings b
       JOIN call_credits cc ON cc.id = b.credit_id
       JOIN call_packages cp ON cp.id = cc.package_id
       JOIN users u_creator ON u_creator.id = cc.creator_id
       JOIN users u_member  ON u_member.id  = cc.member_id
       WHERE b.id = $1
         AND b.status IN ('confirmed', 'held', 'awaiting_payment')
         AND (cc.member_id = $2 OR cc.creator_id = $2)`,
      [rawId, callerUserId]
    );
    return result.rows[0] || null;
  }

  if (INT_RE.test(rawId)) {
    // Cap digit length to avoid float precision issues with very large integers
    if (rawId.length > 15) return null;
    const creditId = Number(rawId);
    if (!Number.isInteger(creditId) || creditId < 1) return null;
    const result = await query(
      `SELECT cc.*,
              cp.duration_minutes, cp.title AS package_title,
              u_creator.username AS creator_username,
              u_creator.display_name AS creator_display_name,
              u_creator.photo_url AS creator_photo,
              u_member.username AS member_username,
              u_member.display_name AS member_display_name,
              u_member.photo_url AS member_photo,
              b.start_time_utc AS start_at,
              b.end_time_utc AS end_at,
              b.status AS booking_status
       FROM call_credits cc
       JOIN call_packages cp ON cp.id = cc.package_id
       JOIN users u_creator ON u_creator.id = cc.creator_id
       JOIN users u_member  ON u_member.id  = cc.member_id
       LEFT JOIN bookings b ON b.credit_id = cc.id
                           AND b.status IN ('confirmed', 'held', 'awaiting_payment')
       WHERE cc.id = $1
         AND (cc.member_id = $2 OR cc.creator_id = $2)`,
      [creditId, callerUserId]
    );
    return result.rows[0] || null;
  }

  return null;
}

// ---------------------------------------------------------------------------
// POST /api/webapp/book-call/checkout
// ---------------------------------------------------------------------------

/**
 * Create a payment intent for a call package.
 * Body: { packageId: number, provider: 'epayco', email: string,
 *         startTimeUtc?: string, endTimeUtc?: string }
 * Dash payments use POST /book-call/checkout/dash instead.
 */
async function createCheckout(req, res) {
  try {
    const sessionUser = req.session?.user;
    if (!sessionUser?.id) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    const memberId = String(sessionUser.id);

    const { packageId, provider, email, startTimeUtc, endTimeUtc } = req.body;

    if (!packageId || !Number.isInteger(Number(packageId)) || Number(packageId) < 1) {
      return res.status(400).json({ success: false, error: 'packageId must be a positive integer' });
    }
    if (!provider || !['epayco'].includes(provider)) {
      // Dash is handled by the dedicated /book-call/checkout/dash endpoint
      // since it needs startTime/endTime params and a BTCPay invoice flow.
      return res.status(400).json({ success: false, error: 'provider must be epayco (use /book-call/checkout/dash for crypto)' });
    }
    if (!email || typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, error: 'A valid email is required' });
    }
    // Optional slot times — when both are provided the service locks the slot
    // at checkout and a bookings row is created with status='awaiting_payment'.
    // When omitted, the legacy credit-only flow runs (no scheduled booking).
    const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/;
    let slotTimes = null;
    if (startTimeUtc || endTimeUtc) {
      if (!startTimeUtc || !endTimeUtc || !ISO_RE.test(startTimeUtc) || !ISO_RE.test(endTimeUtc)) {
        return res.status(400).json({ success: false, error: 'startTimeUtc and endTimeUtc must both be ISO 8601 timestamps with timezone' });
      }
      const s = new Date(startTimeUtc);
      const e = new Date(endTimeUtc);
      if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) {
        return res.status(400).json({ success: false, error: 'startTimeUtc or endTimeUtc is not a valid date' });
      }
      if (e <= s) {
        return res.status(400).json({ success: false, error: 'endTimeUtc must be after startTimeUtc' });
      }
      if (s <= new Date()) {
        return res.status(400).json({ success: false, error: 'startTimeUtc must be in the future' });
      }
      slotTimes = { startTimeUtc, endTimeUtc };
    }

    const result = await callCheckoutService.createCallCheckout(
      memberId,
      Number(packageId),
      provider,
      email.trim().toLowerCase(),
      slotTimes
    );

    return res.status(201).json({ success: true, ...result });
  } catch (err) {
    logger.error('[callBookingController] createCheckout error', { error: err.message, code: err.code });

    if (err.code === 'FX_RATE_UNAVAILABLE') {
      return res.status(503).json({
        success: false,
        error: 'FX rate unavailable, please retry in a few minutes',
        code: 'FX_RATE_UNAVAILABLE',
      });
    }
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
 * Returns credit details plus a fresh LiveKit token for the caller.
 * :bookingId accepts call_credits.id (integer) or bookings.id (UUID).
 */
async function getBooking(req, res) {
  try {
    const sessionUser = req.session?.user;
    if (!sessionUser?.id) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    const userId = String(sessionUser.id);
    const { bookingId } = req.params;

    const credit = await resolveBooking(bookingId, userId);
    if (!credit) {
      if (!UUID_RE.test(bookingId) && !INT_RE.test(bookingId)) {
        return res.status(400).json({ success: false, error: 'Invalid bookingId' });
      }
      return res.status(404).json({ success: false, error: 'Booking not found' });
    }

    const roomName = `booking-${credit.id}`;
    const isModerator = userId === String(credit.creator_id);
    const displayName = (isModerator ? credit.creator_display_name : credit.member_display_name) || userId;

    let livekitInfo = null;
    try {
      const token = await generateToken(roomName, userId, displayName, isModerator, {
        canPublishAudio: true,
        canPublishVideo: true,
      });
      livekitInfo = { token, roomName, livekitUrl: LIVEKIT_WS_URL };
    } catch (livekitErr) {
      logger.warn('[callBookingController] LiveKit token generation failed', {
        creditId: credit.id,
        error: livekitErr.message,
      });
    }

    const booking = {
      id: credit.id,
      member_id: credit.member_id,
      creator_id: credit.creator_id,
      credit_id: credit.id,
      duration_minutes: credit.duration_minutes,
      package_title: credit.package_title,
      status: credit.booking_status || credit.status,
      start_at: credit.start_at || null,
      end_at: credit.end_at || null,
      room_name: roomName,
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
// POST /api/webapp/bookings/:bookingId/join
// ---------------------------------------------------------------------------

/**
 * Generate a LiveKit access token for joining a booked private call.
 * :bookingId accepts call_credits.id (integer) or bookings.id (UUID).
 * Both the member and creator can join; both get publish rights so they
 * can send audio and video to each other.
 */
async function joinBooking(req, res) {
  try {
    const sessionUser = req.session?.user;
    if (!sessionUser?.id) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    const userId = String(sessionUser.id);
    const { bookingId } = req.params;

    const credit = await resolveBooking(bookingId, userId);
    if (!credit) {
      if (!UUID_RE.test(bookingId) && !INT_RE.test(bookingId)) {
        return res.status(400).json({ success: false, error: 'Invalid bookingId' });
      }
      return res.status(404).json({ success: false, error: 'Booking not found' });
    }

    // Reject terminal credit statuses (expired, refunded, cancelled)
    const TERMINAL_STATUSES = new Set(['expired', 'refunded', 'cancelled']);
    if (TERMINAL_STATUSES.has(credit.status)) {
      return res.status(403).json({ success: false, error: 'This booking is no longer active' });
    }

    // Enforce join window when a scheduled time exists
    if (credit.start_at) {
      const startMs = new Date(credit.start_at).getTime();
      const durationMs = (credit.duration_minutes || 60) * 60 * 1000;
      const nowMs = Date.now();
      const EARLY_MS = 15 * 60 * 1000;  // allow joining 15 min before
      const GRACE_MS = 30 * 60 * 1000;  // allow joining up to 30 min after end

      if (nowMs < startMs - EARLY_MS) {
        return res.status(403).json({
          success: false,
          error: 'The call has not started yet',
          startAt: credit.start_at,
        });
      }
      if (nowMs > startMs + durationMs + GRACE_MS) {
        return res.status(410).json({ success: false, error: 'This call has ended' });
      }
    }

    const roomName = `booking-${credit.id}`;
    const isModerator = userId === String(credit.creator_id);
    const displayName = isModerator
      ? (credit.creator_display_name || credit.creator_username || userId)
      : (credit.member_display_name || credit.member_username || userId);

    // TTL = booking duration + 30 min buffer so the token outlasts the call
    const ttlSeconds = (credit.duration_minutes || 60) * 60 + 30 * 60;

    const token = await generateToken(roomName, userId, displayName, isModerator, {
      canPublishAudio: true,
      canPublishVideo: true,
      ttlSeconds,
    });

    logger.info('[callBookingController] joinBooking token issued', {
      creditId: credit.id,
      userId,
      roomName,
      isModerator,
      ttlSeconds,
    });
    return res.json({ token, livekitUrl: LIVEKIT_WS_URL, roomName, ttlSeconds });
  } catch (err) {
    logger.error('[callBookingController] joinBooking error', { error: err.message });
    return res.status(500).json({ success: false, error: 'Failed to join call' });
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
      `SELECT day_of_week, start_time, end_time, timezone, break_minutes
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
      break_minutes: row.break_minutes,
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

    let { schedule } = req.body;

    // BC-C-02: Normalize WeeklyAvailabilitySchedule object → array
    // Frontend may send { "0": {...}, "1": {...} } instead of [...]
    if (schedule && typeof schedule === 'object' && !Array.isArray(schedule)) {
      schedule = Object.values(schedule);
    }

    if (!Array.isArray(schedule)) {
      return res.status(400).json({ success: false, error: 'schedule must be an array' });
    }
    if (schedule.length > 50) {
      return res.status(400).json({ success: false, error: 'schedule cannot have more than 50 entries' });
    }

    const TIME_RE = /^\d{2}:\d{2}$/;
    const VALID_TZ_CHARS = /^[A-Za-z0-9/_+-]+$/;
    const VALID_BREAK_MINUTES = new Set([0, 5, 10, 15, 20, 30]);

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
      if (!moment.tz.zone(slot.timezone)) {
        return res.status(400).json({ success: false, error: `schedule[${i}].timezone is not a recognized IANA timezone` });
      }
      if (slot.breakMinutes !== undefined) {
        const bm = Number(slot.breakMinutes);
        if (!Number.isInteger(bm) || !VALID_BREAK_MINUTES.has(bm)) {
          return res.status(400).json({ success: false, error: `schedule[${i}].breakMinutes must be one of 0, 5, 10, 15, 20, 30` });
        }
      }
    }

    // HIGH-02: Full replace strategy wrapped in a transaction
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        'UPDATE creator_availability_schedules SET is_active = false WHERE creator_id = $1',
        [creatorId]
      );

      for (const slot of schedule) {
        const breakMins = Number.isInteger(Number(slot.breakMinutes)) ? Number(slot.breakMinutes) : 10;
        await client.query(
          `INSERT INTO creator_availability_schedules
             (creator_id, day_of_week, start_time, end_time, timezone, break_minutes, is_active)
           VALUES ($1, $2, $3::time, $4::time, $5, $6, true)
           ON CONFLICT (creator_id, day_of_week, start_time)
           DO UPDATE SET
             end_time = EXCLUDED.end_time,
             timezone = EXCLUDED.timezone,
             break_minutes = EXCLUDED.break_minutes,
             is_active = true,
             updated_at = NOW()`,
          [creatorId, Number(slot.dayOfWeek), slot.startTime, slot.endTime, slot.timezone, breakMins]
        );
      }

      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
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

// ---------------------------------------------------------------------------
// GET /api/webapp/creator/call-bookings
// ---------------------------------------------------------------------------

/**
 * Get creator's call credits (upcoming + recent) — filterable by status.
 * Since call_credits IS the booking record, we query that table directly.
 * Query param: status = 'upcoming' | 'completed' | 'cancelled'
 */
async function getMyBookings(req, res) {
  try {
    const sessionUser = req.session?.user;
    if (!sessionUser?.id) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const creatorId = String(sessionUser.id);
    const { status } = req.query;

    let statusFilter = '';
    const params = [creatorId];

    if (status === 'upcoming') {
      // Upcoming = credits that still have uses remaining (unused or partial)
      statusFilter = `AND cc.status IN ('unused', 'partial')`;
    } else if (status === 'completed') {
      statusFilter = `AND cc.status = 'completed'`;
    } else if (status === 'cancelled') {
      statusFilter = `AND cc.status IN ('expired', 'refunded')`;
    }

    const result = await query(`
      SELECT
        cc.id,
        cc.member_id,
        cc.creator_id,
        cc.package_id,
        cc.quantity_total,
        cc.quantity_used,
        cc.quantity_scheduled,
        cc.status,
        cc.expires_at,
        cc.created_at,
        cc.updated_at,
        cp.duration_minutes,
        cp.title AS package_title,
        cp.price_usd,
        u_member.username  AS member_username,
        u_member.display_name AS member_display_name,
        u_member.photo_url AS member_photo
      FROM call_credits cc
      JOIN call_packages cp ON cp.id = cc.package_id
      JOIN users u_member  ON u_member.id = cc.member_id
      WHERE cc.creator_id = $1
      ${statusFilter}
      ORDER BY cc.created_at DESC
      LIMIT 50
    `, params);

    return res.json({ success: true, bookings: result.rows });
  } catch (err) {
    logger.error('[callBookingController] getMyBookings error', { error: err.message });
    return res.status(500).json({ success: false, error: 'Failed to load bookings' });
  }
}

// ---------------------------------------------------------------------------
// GET /api/webapp/creator/call-earnings
// ---------------------------------------------------------------------------

/**
 * Get creator's call revenue summary — total revenue, calls sold/completed, average rating.
 */
async function getCallEarnings(req, res) {
  try {
    const sessionUser = req.session?.user;
    if (!sessionUser?.id) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const creatorId = String(sessionUser.id);

    // Credits summary — counts of calls sold, completed, scheduled
    const creditsResult = await query(`
      SELECT
        COUNT(*)                         AS total_credits_sold,
        COALESCE(SUM(cc.quantity_total), 0) AS total_calls_sold,
        COALESCE(SUM(cc.quantity_used), 0)  AS total_calls_completed,
        COALESCE(SUM(cc.quantity_scheduled), 0) AS total_calls_scheduled
      FROM call_credits cc
      WHERE cc.creator_id = $1
    `, [creatorId]);

    // MED-05: Revenue — per-call revenue: price / quantity * quantity_used
    // Exclude refunded credits so cancelled purchases don't inflate totals
    const revenueResult = await query(`
      SELECT
        COALESCE(SUM(cp.price_usd / NULLIF(cp.quantity, 0) * cc.quantity_used), 0) AS total_revenue,
        COUNT(DISTINCT cc.id)           AS total_purchases
      FROM call_credits cc
      JOIN call_packages cp ON cp.id = cc.package_id
      WHERE cc.creator_id = $1
        AND cc.status NOT IN ('refunded')
    `, [creatorId]);

    // Average rating from surveys
    const ratingResult = await query(`
      SELECT
        COALESCE(AVG(rating), 0) AS average_rating,
        COUNT(*)                 AS total_reviews
      FROM call_booking_surveys
      WHERE creator_id = $1
    `, [creatorId]);

    const credits = creditsResult.rows[0] || {};
    const revenue = revenueResult.rows[0] || {};
    const rating  = ratingResult.rows[0]  || {};

    return res.json({
      success: true,
      earnings: {
        totalRevenue:         parseFloat(revenue.total_revenue)          || 0,
        totalPurchases:       parseInt(revenue.total_purchases, 10)      || 0,
        totalCallsSold:       parseInt(credits.total_calls_sold, 10)     || 0,
        totalCallsCompleted:  parseInt(credits.total_calls_completed, 10)|| 0,
        totalCallsScheduled:  parseInt(credits.total_calls_scheduled, 10)|| 0,
        averageRating:        parseFloat(rating.average_rating)          || 0,
        totalReviews:         parseInt(rating.total_reviews, 10)         || 0,
      },
    });
  } catch (err) {
    logger.error('[callBookingController] getCallEarnings error', { error: err.message });
    return res.status(500).json({ success: false, error: 'Failed to load earnings' });
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/webapp/bookings/:bookingId/complete
// ---------------------------------------------------------------------------

/**
 * Mark a booking as completed. Only the creator of the booking may call this.
 * :bookingId is bookings.id (UUID).
 */
async function completeBooking(req, res) {
  try {
    const sessionUser = req.session?.user;
    if (!sessionUser?.id) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    const userId = String(sessionUser.id);
    const { bookingId } = req.params;

    if (!bookingId) {
      return res.status(400).json({ success: false, error: 'Invalid bookingId' });
    }

    // Verify the caller is the creator of this booking
    const ownerCheck = await query(
      `SELECT b.id FROM bookings b
       JOIN performers p ON p.id = b.performer_id
       WHERE b.id = $1 AND p.user_id = $2`,
      [bookingId, userId]
    );
    if (ownerCheck.rows.length === 0) {
      return res.status(403).json({ success: false, error: 'Only the creator can complete this booking' });
    }

    await CallBookingService.completeBooking(bookingId);

    logger.info('[callBookingController] booking completed', { bookingId, userId });
    return res.json({ success: true });
  } catch (err) {
    logger.error('[callBookingController] completeBooking error', { error: err.message });
    if (err.message && err.message.includes('not found or not in confirmed status')) {
      return res.status(409).json({ success: false, error: err.message });
    }
    return res.status(500).json({ success: false, error: 'Failed to complete booking' });
  }
}

// ---------------------------------------------------------------------------
// POST /api/webapp/bookings/:bookingId/cancel
// ---------------------------------------------------------------------------

/**
 * Cancel a booking. Either the member or the creator of the booking may cancel.
 * :bookingId is bookings.id (UUID).
 * Body: { reason?: string }
 */
async function cancelBooking(req, res) {
  try {
    const sessionUser = req.session?.user;
    if (!sessionUser?.id) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    const userId = String(sessionUser.id);
    const { bookingId } = req.params;

    if (!bookingId) {
      return res.status(400).json({ success: false, error: 'Invalid bookingId' });
    }

    // Verify the caller is either the member or the creator of this booking
    const ownerCheck = await query(
      `SELECT b.id FROM bookings b
       JOIN performers p ON p.id = b.performer_id
       WHERE b.id = $1 AND (b.user_id = $2 OR p.user_id = $2)`,
      [bookingId, userId]
    );
    if (ownerCheck.rows.length === 0) {
      return res.status(403).json({ success: false, error: 'Not authorised to cancel this booking' });
    }

    const reason = typeof req.body?.reason === 'string'
      ? req.body.reason.trim().slice(0, 500)
      : 'User cancellation';

    await CallBookingService.cancelBooking(bookingId, reason);

    logger.info('[callBookingController] booking cancelled', { bookingId, userId, reason });
    return res.json({ success: true });
  } catch (err) {
    logger.error('[callBookingController] cancelBooking error', { error: err.message });
    if (err.message && err.message.includes('not found or already in terminal status')) {
      return res.status(409).json({ success: false, error: err.message });
    }
    return res.status(500).json({ success: false, error: 'Failed to cancel booking' });
  }
}

// ---------------------------------------------------------------------------
// GET /api/webapp/creator/next-show-date
// PUT /api/webapp/creator/next-show-date
// ---------------------------------------------------------------------------

/**
 * Return the authenticated creator's next show date.
 */
async function getNextShowDate(req, res) {
  try {
    const sessionUser = req.session?.user;
    if (!sessionUser?.id) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    const creatorId = String(sessionUser.id);

    const result = await query(
      'SELECT next_show_date FROM performers WHERE user_id = $1',
      [creatorId]
    );

    const nextShowDate = result.rows[0]?.next_show_date || null;
    return res.json({ success: true, nextShowDate });
  } catch (err) {
    logger.error('[callBookingController] getNextShowDate error', { error: err.message });
    return res.status(500).json({ success: false, error: 'Failed to retrieve next show date' });
  }
}

/**
 * Set the authenticated creator's next show date.
 * Body: { nextShowDate: ISO 8601 string, must be in the future }
 */
async function setNextShowDate(req, res) {
  try {
    const sessionUser = req.session?.user;
    if (!sessionUser?.id) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    const creatorId = String(sessionUser.id);

    const { nextShowDate } = req.body;

    // Allow explicit null/empty to clear the date
    if (nextShowDate === null || nextShowDate === undefined || nextShowDate === '') {
      await query(
        'UPDATE performers SET next_show_date = NULL, updated_at = NOW() WHERE user_id = $1',
        [creatorId]
      );
      return res.json({ success: true, nextShowDate: null });
    }

    // Validate ISO 8601 format
    if (typeof nextShowDate !== 'string') {
      return res.status(400).json({ success: false, error: 'nextShowDate must be an ISO 8601 string' });
    }

    // Use moment.ISO_8601 for strict parsing
    const parsed = moment(nextShowDate, moment.ISO_8601, true);
    if (!parsed.isValid()) {
      return res.status(400).json({ success: false, error: 'nextShowDate must be a valid ISO 8601 timestamp' });
    }
    if (parsed.isSameOrBefore(moment.utc())) {
      return res.status(400).json({ success: false, error: 'nextShowDate must be in the future' });
    }

    await query(
      'UPDATE performers SET next_show_date = $1, updated_at = NOW() WHERE user_id = $2',
      [parsed.toISOString(), creatorId]
    );

    logger.info('[callBookingController] next show date updated', { creatorId, nextShowDate: parsed.toISOString() });
    return res.json({ success: true, nextShowDate: parsed.toISOString() });
  } catch (err) {
    logger.error('[callBookingController] setNextShowDate error', { error: err.message });
    return res.status(500).json({ success: false, error: 'Failed to update next show date' });
  }
}

// ---------------------------------------------------------------------------
// POST /api/webapp/book-call/checkout/dash
// ---------------------------------------------------------------------------

/**
 * Create a BTCPay Dash invoice for a call package purchase.
 * Body: { packageId: number, startTimeUtc: string (ISO 8601), endTimeUtc: string (ISO 8601) }
 * Returns: { invoiceId, checkoutUrl, paymentId, bookingId, amountUsd, expiresAt }
 */
async function createCheckoutDash(req, res) {
  try {
    const sessionUser = req.session?.user;
    if (!sessionUser?.id) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    const userId = String(sessionUser.id);

    const { packageId, startTimeUtc, endTimeUtc } = req.body;

    if (!packageId || !Number.isInteger(Number(packageId)) || Number(packageId) < 1) {
      return res.status(400).json({ success: false, error: 'packageId must be a positive integer' });
    }

    const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
    if (!startTimeUtc || typeof startTimeUtc !== 'string' || !ISO_RE.test(startTimeUtc)) {
      return res.status(400).json({ success: false, error: 'startTimeUtc must be an ISO 8601 timestamp with timezone' });
    }
    if (!endTimeUtc || typeof endTimeUtc !== 'string' || !ISO_RE.test(endTimeUtc)) {
      return res.status(400).json({ success: false, error: 'endTimeUtc must be an ISO 8601 timestamp with timezone' });
    }

    const start = new Date(startTimeUtc);
    const end = new Date(endTimeUtc);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return res.status(400).json({ success: false, error: 'startTimeUtc or endTimeUtc is not a valid date' });
    }
    if (start >= end) {
      return res.status(400).json({ success: false, error: 'endTimeUtc must be after startTimeUtc' });
    }
    if (start <= new Date()) {
      return res.status(400).json({ success: false, error: 'startTimeUtc must be in the future' });
    }

    const result = await callCheckoutService.createCallCheckoutDash({
      userId,
      packageId: Number(packageId),
      startTimeUtc,
      endTimeUtc,
    });

    return res.status(201).json({ success: true, ...result });
  } catch (err) {
    logger.error('[callBookingController] createCheckoutDash error', { error: err.message, code: err.code });

    if (err.code === 'PACKAGE_NOT_FOUND') {
      return res.status(404).json({ success: false, error: 'Call package not found or inactive' });
    }
    if (err.code === 'PERFORMER_NOT_FOUND') {
      return res.status(404).json({ success: false, error: 'Creator profile not found' });
    }
    if (err.code === 'SLOT_TAKEN') {
      return res.status(409).json({ success: false, error: 'The requested time slot is no longer available' });
    }
    return res.status(500).json({ success: false, error: 'Failed to create Dash checkout' });
  }
}

// ---------------------------------------------------------------------------
// GET /api/webapp/bookings/:bookingId/payment-status
// ---------------------------------------------------------------------------

/**
 * Poll payment status for a booking created via the Dash checkout flow.
 * Auth: only the buyer (user_id) or the performer (via performers table) may read.
 *
 * Returns:
 *   { status: 'pending'|'paid'|'expired'|'failed', bookingId, roomName? }
 */
async function getBookingPaymentStatus(req, res) {
  try {
    const sessionUser = req.session?.user;
    if (!sessionUser?.id) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    const callerUserId = String(sessionUser.id);

    // bookingId is a UUID (bookings.id)
    const { bookingId } = req.params;
    if (!bookingId || typeof bookingId !== 'string') {
      return res.status(400).json({ success: false, error: 'Invalid bookingId' });
    }

    // Load booking + join payment + performer user for auth check
    const result = await query(
      `SELECT
         b.id                  AS booking_id,
         b.user_id             AS member_id,
         b.status              AS booking_status,
         b.payment_id,
         b.start_time_utc,
         b.end_time_utc,
         b.credit_id,
         p_row.status          AS payment_status,
         p_row.metadata        AS payment_metadata,
         perf_user.id          AS performer_user_id,
         CONCAT('booking-', b.credit_id::text) AS room_name
       FROM bookings b
       LEFT JOIN payments p_row ON p_row.id = b.payment_id
       LEFT JOIN performers perf ON perf.id = b.performer_id
       LEFT JOIN users perf_user ON perf_user.id = perf.user_id
       WHERE b.id = $1`,
      [bookingId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Booking not found' });
    }

    const row = result.rows[0];

    // Owner check: must be buyer or performer
    if (row.member_id !== callerUserId && row.performer_user_id !== callerUserId) {
      return res.status(403).json({ success: false, error: 'Not authorized to view this booking' });
    }

    // Derive normalized status
    let status;
    const bookingStatus = row.booking_status;
    const paymentStatus = row.payment_status;

    if (bookingStatus === 'confirmed') {
      status = 'paid';
    } else if (bookingStatus === 'expired' || bookingStatus === 'cancelled') {
      status = 'expired';
    } else {
      // awaiting_payment — check the underlying payment/DSO
      if (paymentStatus === 'completed') {
        status = 'paid';
      } else if (paymentStatus === 'failed') {
        status = 'failed';
      } else {
        // Check dash_subscription_orders for invoice expiry
        const meta = row.payment_metadata || {};
        let invoiceStatus = null;
        if (meta.btcpay_invoice_id) {
          const dsoRes = await query(
            `SELECT status FROM dash_subscription_orders WHERE btcpay_invoice_id = $1`,
            [meta.btcpay_invoice_id]
          );
          invoiceStatus = dsoRes.rows[0]?.status || null;
        }
        if (invoiceStatus === 'expired' || invoiceStatus === 'invalid') {
          status = 'expired';
        } else {
          status = 'pending';
        }
      }
    }

    // roomName is always booking-{credit_id} — consistent with joinBooking and getBooking
    const roomName = row.credit_id ? `booking-${row.credit_id}` : row.room_name;

    return res.json({
      success: true,
      status,
      bookingId: row.booking_id,
      roomName: status === 'paid' ? roomName : undefined,
    });
  } catch (err) {
    logger.error('[callBookingController] getBookingPaymentStatus error', { error: err.message });
    return res.status(500).json({ success: false, error: 'Failed to retrieve payment status' });
  }
}

// ---------------------------------------------------------------------------
// GET /api/webapp/bookings/upcoming
// ---------------------------------------------------------------------------

/**
 * Returns the caller's confirmed bookings with start_time_utc > NOW() - 15 min.
 * Includes a 15-min join window so the caller can still see the booking while
 * they are already inside it.
 */
async function getUpcomingBookings(req, res) {
  try {
    const sessionUser = req.session?.user;
    if (!sessionUser?.id) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    const userId = String(sessionUser.id);

    const result = await query(
      `SELECT
         b.id,
         b.performer_id,
         u_creator.id          AS creator_id,
         u_creator.username    AS performer_username,
         COALESCE(u_creator.display_name, u_creator.username) AS performer_name,
         u_creator.photo_url   AS performer_photo,
         b.start_time_utc,
         b.end_time_utc,
         b.duration_minutes,
         b.status,
         b.call_type,
         CONCAT('booking-', b.credit_id::text) AS room_name
       FROM bookings b
       JOIN performers p ON p.id = b.performer_id
       JOIN users u_creator ON u_creator.id = p.user_id
       WHERE b.user_id = $1
         AND b.status = 'confirmed'
         AND b.start_time_utc > NOW() - INTERVAL '15 minutes'
       ORDER BY b.start_time_utc ASC
       LIMIT 50`,
      [userId]
    );

    return res.json({ success: true, bookings: result.rows });
  } catch (err) {
    logger.error('[callBookingController] getUpcomingBookings error', { error: err.message });
    return res.status(500).json({ success: false, error: 'Failed to retrieve upcoming bookings' });
  }
}

module.exports = {
  createCheckout,
  createCheckoutDash,
  getBooking,
  joinBooking,
  getBookingPaymentStatus,
  submitSurvey,
  saveAvailabilitySchedule,
  setOnlineStatus,
  getAvailabilitySchedule,
  getMyBookings,
  getCallEarnings,
  completeBooking,
  cancelBooking,
  getNextShowDate,
  setNextShowDate,
  getUpcomingBookings,
};
