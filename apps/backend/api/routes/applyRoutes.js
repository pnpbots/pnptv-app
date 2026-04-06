const express = require('express');
const applyController = require('../controllers/applyController');
const authGuard = require('../middleware/authGuard');
const roleGuard = require('../middleware/roleGuard');

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

// POST /api/apply/mark-scheduled — admin-only: mark onboarding call as scheduled.
// This was previously self-reportable by applicants (C-04). Now restricted to admins
// to prevent fraudulent self-certification. Cal.com webhook (C-03) handles automatic
// updates; admins retain manual override capability.
router.post('/mark-scheduled', roleGuard('admin', 'superadmin'), applyController.markScheduled);

module.exports = router;
