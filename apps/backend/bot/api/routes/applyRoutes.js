const express = require('express');
const applyController = require('../controllers/applyController');
const authGuard = require('../middleware/authGuard');

const router = express.Router();

/**
 * Model/Creator Application Routes
 * All routes require authentication
 */

router.use(authGuard);

// GET /api/apply/status — check for existing application
router.get('/status', applyController.getStatus);

// POST /api/apply/submit — submit full application
router.post('/submit', applyController.submit);

// POST /api/apply/mark-scheduled — mark onboarding call as scheduled
router.post('/mark-scheduled', applyController.markScheduled);

module.exports = router;
