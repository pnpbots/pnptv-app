const express = require('express');
const authController = require('../controllers/authController');
const authGuard = require('../middleware/authGuard');

const router = express.Router();

/**
 * Admin Authentication Routes
 */

// POST /api/auth/admin-login
router.post('/admin-login', authController.adminLogin);

/**
 * Model Authentication Routes
 */

// POST /api/auth/model-login
router.post('/model-login', authController.modelLogin);

// POST /api/auth/register-model
router.post('/register-model', authController.registerModel);

/**
 * Public Auth Endpoints
 */

// GET /api/auth/status
router.get('/status', authController.checkAuthStatus);

// GET /api/auth/admin-check
router.get('/admin-check', authController.checkAdminStatus);

// GET /api/auth/model-check
router.get('/model-check', authController.checkModelStatus);

/**
 * Protected Endpoints
 */

// POST /api/auth/logout
router.post('/logout', authGuard, authController.logout);

module.exports = router;
