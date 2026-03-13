'use strict';
const callPackageService = require('../../services/callPackageService');
const CallBookingService = require('../../services/CallBookingService');
const livekitService = require('../../services/livekitService');
const callNotificationService = require('../../services/callNotificationService');
const moment = require('moment-timezone');

const logger = require('../../../utils/logger');

/**
 * GET /api/webapp/creators/:creatorId/call-packages
 * Returns active call packages for a creator. Public — no auth required.
 */
async function listPackages(req, res) {
  try {
    const { creatorId } = req.params;
    const packages = await callPackageService.getPackages(creatorId);
    res.json({ success: true, packages });
  } catch (err) {
    logger.error('listPackages error', { error: err.message });
    res.status(500).json({ success: false, error: 'Failed to retrieve packages' });
  }
}

/**
 * POST /api/webapp/admin/creators/:creatorId/call-packages
 * Create a call package for a creator. Admin only.
 * Body: { durationMinutes: 30|60, quantity: number, priceUsd: number, title?: string }
 */
async function createPackage(req, res) {
  try {
    const { creatorId } = req.params;
    const { durationMinutes, quantity, priceUsd, title } = req.body;

    if (![30, 60].includes(Number(durationMinutes))) {
      return res.status(400).json({ error: 'durationMinutes must be 30 or 60' });
    }
    if (!quantity || quantity < 1) {
      return res.status(400).json({ error: 'quantity must be a positive integer' });
    }
    if (!priceUsd || Number(priceUsd) <= 0) {
      return res.status(400).json({ error: 'priceUsd must be a positive number' });
    }
    if (title !== undefined && (typeof title !== 'string' || title.length > 200)) {
      return res.status(400).json({ error: 'Title must be a string under 200 characters' });
    }

    const pkg = await callPackageService.createPackage(creatorId, {
      durationMinutes: Number(durationMinutes),
      quantity: Number(quantity),
      priceUsd: Number(priceUsd),
      title: title || null,
    });
    res.status(201).json({ success: true, package: pkg });
  } catch (err) {
    logger.error('createPackage error', { error: err.message });
    res.status(500).json({ success: false, error: 'Failed to create package' });
  }
}

/**
 * DELETE /api/webapp/admin/creators/:creatorId/call-packages/:packageId
 * Deactivate a call package. Admin only.
 */
async function deactivatePackage(req, res) {
  try {
    const { creatorId, packageId } = req.params;
    const ok = await callPackageService.deactivatePackage(packageId, creatorId);
    if (!ok) return res.status(404).json({ error: 'Package not found' });
    res.json({ success: true });
  } catch (err) {
    logger.error('deactivatePackage error', { error: err.message });
    res.status(500).json({ success: false, error: 'Failed to deactivate package' });
  }
}

/**
 * GET /api/webapp/book-call/:creatorId/options
 * Returns booking options (immediate or next 5 slots) for the authenticated member.
 * Query: ?duration=30|60  (default 30)
 */
async function getBookingOptions(req, res) {
  try {
    const { creatorId } = req.params;
    const durationMinutes = Number(req.query.duration) || 30;

    if (![30, 60].includes(durationMinutes)) {
      return res.status(400).json({ error: 'duration must be 30 or 60' });
    }

    const fromDate = moment.utc().toDate();
    const toDate = moment.utc().add(14, 'days').toDate();
    const slots = await CallBookingService.getAvailableSlots(creatorId, fromDate, toDate, durationMinutes);
    
    res.json({ success: true, slots: slots.slice(0, 5), type: 'slots' });
  } catch (err) {
    logger.error('getBookingOptions error', { error: err.message });
    res.status(500).json({ success: false, error: 'Failed to retrieve booking options' });
  }
}

/**
 * POST /api/webapp/book-call
 * Book a call using a call credit.
 * Body: { creatorId, startAt, creditId, durationMinutes }
 */
async function bookCall(req, res) {
  try {
    const sessionUser = req.session?.user;
    if (!sessionUser?.id) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    const memberId = String(sessionUser.id);
    const { creatorId, startAt, creditId, durationMinutes } = req.body;

    if (!creatorId || !startAt || creditId == null) {
      return res.status(400).json({ error: 'creatorId, startAt, and creditId are required' });
    }

    if (memberId === String(creatorId)) {
      return res.status(400).json({ success: false, error: 'You cannot book a call with yourself' });
    }

    const parsedDuration = Number(durationMinutes);
    if (![30, 60].includes(parsedDuration)) {
      return res.status(400).json({ error: 'durationMinutes must be 30 or 60' });
    }

    // Validate startAt is a valid future ISO string
    if (!moment(startAt, moment.ISO_8601, true).isValid() || moment.utc(startAt).isBefore(moment.utc())) {
      return res.status(400).json({ error: 'startAt must be a valid future ISO timestamp' });
    }
    if (moment.utc(startAt).isAfter(moment.utc().add(90, 'days'))) {
      return res.status(400).json({ error: 'Cannot book more than 90 days in advance' });
    }

    // BC-C-03: Re-verify creator online status from Redis before booking
    const { getRedis } = require('../../../config/redis');
    const redis = getRedis();
    const creatorOnline = await redis.get(`user:${creatorId}:active`);
    if (!creatorOnline) {
      logger.warn('bookCall: creator offline at booking time', { creatorId, memberId });
      // Not blocking — scheduled bookings are valid even if creator is offline
    }

    const booking = await CallBookingService.createBooking({
      memberId,
      creatorId,
      startAt,
      creditId: Number(creditId),
      durationMinutes: parsedDuration,
    });

    // ── Post-booking orchestration (fire-and-forget) ───────────────────────
    // Generate LiveKit room + tokens, send confirmations, schedule reminders.
    // Failures here must NOT block the booking response.
    (async () => {
      try {
        const roomName = `call-credit-${Number(creditId)}`;
        let livekitInfo = null;

        if (livekitService.isConfigured()) {
          await livekitService.ensureRoom(roomName);

          // Fetch display names for both parties
          const { query: dbQuery } = require('../../../config/postgres');
          const [memberResult, creatorResult] = await Promise.all([
            dbQuery('SELECT username, display_name, photo_url FROM users WHERE id = $1', [memberId]),
            dbQuery('SELECT username, display_name, photo_url FROM users WHERE id = $1', [creatorId]),
          ]);
          const member = memberResult.rows[0] || {};
          const creator = creatorResult.rows[0] || {};

          livekitInfo = await livekitService.generateMeetingInfo(
            roomName, memberId,
            member.display_name || member.username || memberId,
            member.photo_url || '', false
          );

          // Generate a separate creator token for the creator's notification
          const creatorLivekitInfo = await livekitService.generateMeetingInfo(
            roomName, creatorId,
            creator.display_name || creator.username || creatorId,
            creator.photo_url || '', true
          );

          // Send confirmations to both parties
          await Promise.allSettled([
            callNotificationService.sendBookingConfirmationToMember(
              memberId,
              { creator_name: creator.display_name || creator.username, start_at: startAt, duration_minutes: parsedDuration },
              livekitInfo
            ),
            callNotificationService.sendBookingConfirmationToCreator(
              creatorId,
              { start_at: startAt, duration_minutes: parsedDuration },
              { username: member.username, display_name: member.display_name },
              creatorLivekitInfo
            ),
          ]);

          // Schedule 1h and 15min reminders
          callNotificationService.scheduleCallReminders(
            Number(creditId), creatorId, memberId, startAt, livekitInfo
          );
        }
      } catch (postErr) {
        logger.warn('bookCall: post-booking orchestration error (non-fatal)', {
          creditId, memberId, creatorId, error: postErr.message,
        });
      }
    })();

    res.status(201).json({ success: true, booking });
  } catch (err) {
    logger.error('bookCall error', { error: err.message, code: err.code });
    if (err.statusCode) {
      return res.status(err.statusCode).json({ success: false, error: err.message, code: err.code });
    }
    return res.status(500).json({ success: false, error: 'Failed to book call' });
  }
}

/**
 * GET /api/webapp/my-call-credits
 * Returns the authenticated member's available call credits.
 * Query: ?creatorId=  (optional — filter by creator)
 */
async function myCallCredits(req, res) {
  try {
    const sessionUser = req.session?.user;
    if (!sessionUser?.id) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    const memberId = String(sessionUser.id);
    const creatorId = req.query.creatorId ? String(req.query.creatorId) : null;

    const credits = await callPackageService.getMemberCredits(memberId, creatorId);
    res.json({ success: true, credits });
  } catch (err) {
    logger.error('myCallCredits error', { error: err.message });
    res.status(500).json({ success: false, error: 'Failed to retrieve call credits' });
  }
}

/**
 * GET /api/webapp/creator/call-packages
 * Returns the logged-in creator's own active packages.
 */
async function listMyPackages(req, res) {
  try {
    const creatorId = String(req.session.user.id);
    const packages = await callPackageService.getPackages(creatorId);
    res.json({ success: true, packages });
  } catch (err) {
    logger.error('listMyPackages error', { error: err.message });
    res.status(500).json({ success: false, error: 'Failed to load packages' });
  }
}

/**
 * POST /api/webapp/creator/call-packages
 * Creator creates their own call package.
 * Body: { durationMinutes: 30|60, quantity: number, priceUsd: number, title?: string }
 */
async function createMyPackage(req, res) {
  try {
    const sessionUser = req.session.user;
    const role = sessionUser.role || '';
    if (!['model', 'admin', 'superadmin'].includes(role)) {
      return res.status(403).json({ success: false, error: 'Only creators can manage packages' });
    }
    const creatorId = String(sessionUser.id);
    const { durationMinutes, quantity, priceUsd, title } = req.body;

    if (![30, 60].includes(Number(durationMinutes))) {
      return res.status(400).json({ success: false, error: 'Duration must be 30 or 60 minutes' });
    }
    if (!quantity || Number(quantity) < 1 || Number(quantity) > 20) {
      return res.status(400).json({ success: false, error: 'Quantity must be 1-20' });
    }
    if (!priceUsd || Number(priceUsd) <= 0 || Number(priceUsd) > 1000) {
      return res.status(400).json({ success: false, error: 'Price must be $0.01-$1000' });
    }
    if (title !== undefined && (typeof title !== 'string' || title.length > 200)) {
      return res.status(400).json({ success: false, error: 'Title must be a string under 200 characters' });
    }

    const pkg = await callPackageService.createPackage(creatorId, {
      durationMinutes: Number(durationMinutes),
      quantity: Number(quantity),
      priceUsd: Number(priceUsd),
      title: title || null,
    });
    res.json({ success: true, package: pkg });
  } catch (err) {
    logger.error('createMyPackage error', { error: err.message });
    res.status(500).json({ success: false, error: 'Failed to create package' });
  }
}

/**
 * PUT /api/webapp/creator/call-packages/:packageId
 * Update price and/or title of own package.
 * Body: { priceUsd?: number, title?: string }
 */
async function updateMyPackage(req, res) {
  try {
    const creatorId = String(req.session.user.id);
    const packageId = Number(req.params.packageId);
    const { priceUsd, title } = req.body;

    // Verify ownership by fetching creator's own packages
    const packages = await callPackageService.getPackages(creatorId);
    const pkg = packages.find((p) => p.id === packageId);
    if (!pkg) {
      return res.status(404).json({ success: false, error: 'Package not found' });
    }

    // CRIT-02: Explicit whitelist SET clauses — no dynamic column names
    // MED-03: Validate title type + 200-char cap
    // MED-04: Validate priceUsd: reject NaN, <=0, >1000
    const setClauses = [];
    const values = [];
    let paramIdx = 1;

    if (priceUsd !== undefined) {
      const numPrice = Number(priceUsd);
      if (isNaN(numPrice) || numPrice <= 0 || numPrice > 1000) {
        return res.status(400).json({ success: false, error: 'Price must be $0.01-$1000' });
      }
      setClauses.push(`price_usd = $${paramIdx++}`);
      values.push(numPrice);
    }

    if (title !== undefined) {
      if (typeof title !== 'string' || title.length > 200) {
        return res.status(400).json({ success: false, error: 'Title must be a string under 200 characters' });
      }
      setClauses.push(`title = $${paramIdx++}`);
      values.push(title);
    }

    if (setClauses.length === 0) {
      return res.status(400).json({ success: false, error: 'Nothing to update' });
    }

    setClauses.push('updated_at = NOW()');
    values.push(packageId, creatorId);

    const { query } = require('../../../config/postgres');
    await query(
      `UPDATE call_packages SET ${setClauses.join(', ')} WHERE id = $${paramIdx} AND creator_id = $${paramIdx + 1}`,
      values
    );

    res.json({ success: true });
  } catch (err) {
    logger.error('updateMyPackage error', { error: err.message });
    res.status(500).json({ success: false, error: 'Failed to update package' });
  }
}

/**
 * DELETE /api/webapp/creator/call-packages/:packageId
 * Deactivate own package. Ownership enforced at the DB level.
 */
async function deactivateMyPackage(req, res) {
  try {
    const creatorId = String(req.session.user.id);
    const packageId = Number(req.params.packageId);
    const ok = await callPackageService.deactivatePackage(packageId, creatorId);
    if (!ok) return res.status(404).json({ success: false, error: 'Package not found' });
    res.json({ success: true });
  } catch (err) {
    logger.error('deactivateMyPackage error', { error: err.message });
    res.status(500).json({ success: false, error: 'Failed to deactivate package' });
  }
}

module.exports = {
  listPackages,
  createPackage,
  deactivatePackage,
  getBookingOptions,
  bookCall,
  myCallCredits,
  listMyPackages,
  createMyPackage,
  updateMyPackage,
  deactivateMyPackage,
};
