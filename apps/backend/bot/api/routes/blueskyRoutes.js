/**
 * blueskyRoutes.js
 * Routes for one-click Bluesky setup and management
 *
 * Endpoints:
 * POST   /api/bluesky/setup       - Create Bluesky account (the magic one-click!)
 * GET    /api/bluesky/status      - Check account status
 * POST   /api/bluesky/disconnect  - Remove Bluesky link
 */

const express = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const blueskyController = require('../controllers/blueskyController');
const { authenticateUser } = require('../middleware/auth');

const router = express.Router();

/**
 * All routes require authentication
 */
router.use(authenticateUser);

/**
 * POST /api/bluesky/setup
 * One-click account creation - the simplest possible UX
 */
router.post('/setup', asyncHandler(blueskyController.setupBlueskyAccount));

/**
 * GET /api/bluesky/status
 * Check Bluesky account status
 */
router.get('/status', asyncHandler(blueskyController.getBlueskyStatus));

/**
 * POST /api/bluesky/disconnect
 * Disconnect Bluesky account
 */
router.post('/disconnect', asyncHandler(blueskyController.disconnectBluesky));

module.exports = router;
