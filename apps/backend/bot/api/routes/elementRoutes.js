/**
 * elementRoutes.js
 * Routes for Element (Matrix) account provisioning and management
 *
 * Endpoints:
 * POST   /api/element/setup       - Create Element account
 * GET    /api/element/status      - Check account status
 * POST   /api/element/disconnect  - Remove Element link
 * PUT    /api/element/sync-profile - Sync profile to Element
 */

const express = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const elementController = require('../controllers/elementController');
const { authenticateUser } = require('../middleware/auth');

const router = express.Router();

/**
 * All routes require authentication
 */
router.use(authenticateUser);

/**
 * POST /api/element/setup
 * Create Element account
 */
router.post('/setup', asyncHandler(elementController.setupElementAccount));

/**
 * GET /api/element/status
 * Check Element account status
 */
router.get('/status', asyncHandler(elementController.getElementStatus));

/**
 * POST /api/element/disconnect
 * Disconnect Element account
 */
router.post('/disconnect', asyncHandler(elementController.disconnectElement));

/**
 * PUT /api/element/sync-profile
 * Force profile sync to Element
 */
router.put('/sync-profile', asyncHandler(elementController.syncElementProfile));

module.exports = router;
