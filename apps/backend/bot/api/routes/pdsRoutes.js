/**
 * pdsRoutes.js
 * Routes for PDS provisioning and management
 */

const express = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const pdsController = require('../controllers/pdsController');
const { authenticateUser } = require('../middleware/auth');

const router = express.Router();

/**
 * PDS Provisioning Routes
 * All routes require authentication
 */

// Apply authentication to all routes
router.use(authenticateUser);

// Admin endpoints
router.post('/provision', asyncHandler(pdsController.manuallyProvisionPDS));

// User endpoints
router.get('/info', asyncHandler(pdsController.getUserPDSInfo));
router.post('/retry-provision', asyncHandler(pdsController.retryProvisioning));
router.get('/health', asyncHandler(pdsController.checkPDSHealth));
router.get('/provisioning-log', asyncHandler(pdsController.getProvisioningLog));
router.post('/create-backup', asyncHandler(pdsController.createBackup));
router.get('/verify-2fa', asyncHandler(pdsController.verify2FAForCredentialAccess));
router.get('/health-checks', asyncHandler(pdsController.getHealthChecks));

module.exports = router;
