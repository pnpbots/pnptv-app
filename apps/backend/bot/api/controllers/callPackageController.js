'use strict';
const callPackageService = require('../../services/callPackageService');
const bookACallService = require('../../services/bookACallService');
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

    const options = await bookACallService.getBookingOptions(creatorId, durationMinutes);
    res.json({ success: true, ...options });
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

    const parsedDuration = Number(durationMinutes) || 30;
    if (![30, 60].includes(parsedDuration)) {
      return res.status(400).json({ error: 'durationMinutes must be 30 or 60' });
    }

    // Validate startAt is a valid future timestamp
    const startDate = new Date(startAt);
    if (isNaN(startDate.getTime()) || startDate <= new Date()) {
      return res.status(400).json({ error: 'startAt must be a valid future ISO timestamp' });
    }

    const booking = await bookACallService.bookCall(
      memberId,
      String(creatorId),
      startAt,
      Number(creditId),
      parsedDuration
    );

    res.status(201).json({ success: true, booking });
  } catch (err) {
    logger.error('bookCall error', { error: err.message, code: err.code });

    if (err.code === 'NO_CREDIT') {
      return res.status(402).json({ success: false, error: 'No valid call credit available', code: 'NO_CREDIT' });
    }
    if (err.code === 'slot_not_available' || err.code === 'BOOKING_FAILED') {
      return res.status(409).json({ success: false, error: err.message || 'Slot is no longer available', code: err.code });
    }
    res.status(500).json({ success: false, error: 'Failed to book call' });
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

    const updates = {};
    if (priceUsd !== undefined) updates.price_usd = Number(priceUsd);
    if (title !== undefined) updates.title = title;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, error: 'Nothing to update' });
    }

    const setClauses = Object.keys(updates).map((k, i) => `${k} = $${i + 1}`);
    const values = [...Object.values(updates), packageId, creatorId];

    const { query } = require('../../../config/postgres');
    await query(
      `UPDATE call_packages SET ${setClauses.join(', ')}, updated_at = NOW() WHERE id = $${values.length - 1} AND creator_id = $${values.length}`,
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
