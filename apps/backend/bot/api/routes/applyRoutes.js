const express = require('express');
const rateLimit = require('express-rate-limit');
const applyController = require('../controllers/applyController');
const authGuard = require('../middleware/authGuard');
const roleGuard = require('../middleware/roleGuard');

const router = express.Router();

// 5 submissions/hour per user — prevents admin-queue spam and protects the
// Telegram admin-notification fire-and-forget from being weaponized.
const applySubmitLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => req.session?.user?.id || req.ip,
  handler: (_req, res) =>
    res.status(429).json({
      success: false,
      error: 'Too many submissions. Please wait before resubmitting.',
    }),
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Model/Creator Application Routes
 * All routes require authentication
 */

router.use(authGuard);

// GET /api/apply/status — check for existing application
router.get('/status', applyController.getStatus);

// POST /api/apply/submit — submit full application
router.post('/submit', applySubmitLimiter, applyController.submit);

// POST /api/apply/mark-scheduled — admin-only: mark onboarding call as scheduled.
// This was previously self-reportable by applicants (C-04). Now restricted to admins
// to prevent fraudulent self-certification. Cal.com webhook (C-03) handles automatic
// updates; admins retain manual override capability.
router.post('/mark-scheduled', roleGuard('admin', 'superadmin'), applyController.markScheduled);

module.exports = router;
