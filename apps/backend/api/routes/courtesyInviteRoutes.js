'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const { asyncHandler } = require('../middleware/errorHandler');
const courtesyInviteController = require('../controllers/courtesyInviteController');

const router = express.Router();

// Rate limiter for check endpoint — public, so tighter limit
const checkLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 60,
  keyGenerator: (req) => req.ip,
  handler: (_req, res) =>
    res.status(429).json({ valid: false, error: 'Too many requests. Please wait a moment.' }),
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiter for redemption — once per user per 5 min (Redis key gating also enforced in controller)
const redeemLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => String(req.session?.user?.id || req.ip),
  handler: (_req, res) =>
    res.status(429).json({ success: false, error: 'Too many redemption attempts. Please wait a moment.' }),
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiter for invite creation
const createLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 50,
  keyGenerator: (req) => String(req.session?.user?.id || req.ip),
  handler: (_req, res) =>
    res.status(429).json({ success: false, error: 'Invite creation limit reached. Try again later.' }),
  standardHeaders: true,
  legacyHeaders: false,
});

// PUBLIC — no auth, check before authenticated routes to avoid route conflicts
router.get('/check/:code', checkLimiter, asyncHandler(courtesyInviteController.checkInvite));

// Authenticated routes
router.get('/', asyncHandler(courtesyInviteController.listInvites));
router.post('/', createLimiter, asyncHandler(courtesyInviteController.createInvite));
router.delete('/:id', asyncHandler(courtesyInviteController.deactivateInvite));
router.post('/:code/redeem', redeemLimiter, asyncHandler(courtesyInviteController.redeemInvite));

module.exports = router;
