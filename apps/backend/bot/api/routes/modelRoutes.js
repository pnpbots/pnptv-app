const express = require('express');
const rateLimit = require('express-rate-limit');
const modelController = require('../controllers/modelController');
const authGuard = require('../middleware/authGuard');
const roleGuard = require('../middleware/roleGuard');

// W-01: 3 withdrawal requests per hour per user — prevents rapid drain attempts
// on a stolen session between the time a balance is read and when fraud is detected.
const withdrawalLimiter = rateLimit({
  windowMs: 3600_000,
  max: 3,
  keyGenerator: (req) => String(req.session?.user?.id || req.ip),
  message: { error: 'Too many withdrawal requests. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const router = express.Router();

/**
 * Model-Only Routes (protected)
 */

// GET /api/model/dashboard
router.get('/dashboard', authGuard, roleGuard('model', 'admin', 'superadmin'), modelController.getDashboard);

// POST /api/model/content/upload
router.post('/content/upload', authGuard, roleGuard('model', 'admin', 'superadmin'), modelController.uploadContent);

// GET /api/model/content
router.get('/content', authGuard, roleGuard('model', 'admin', 'superadmin'), modelController.getMyContent);

// DELETE /api/model/content/:contentId
router.delete('/content/:contentId', authGuard, roleGuard('model', 'admin', 'superadmin'), modelController.deleteContent);

// GET /api/model/content/:contentId/analytics
router.get('/content/:contentId/analytics', authGuard, roleGuard('model', 'admin', 'superadmin'), modelController.getContentAnalytics);

// GET /api/model/earnings
router.get('/earnings', authGuard, roleGuard('model', 'admin', 'superadmin'), modelController.getEarnings);

// POST /api/model/withdrawal/request
router.post('/withdrawal/request', authGuard, roleGuard('model', 'admin', 'superadmin'), withdrawalLimiter, modelController.requestWithdrawal);

// GET /api/model/withdrawal/history
router.get('/withdrawal/history', authGuard, roleGuard('model', 'admin', 'superadmin'), modelController.getWithdrawalHistory);

// GET /api/model/withdrawal/available
router.get('/withdrawal/available', authGuard, roleGuard('model', 'admin', 'superadmin'), modelController.getWithdrawableAmount);

// GET /api/model/streaming/limits
router.get('/streaming/limits', authGuard, roleGuard('model', 'admin', 'superadmin'), modelController.checkStreamingLimits);

// PUT /api/model/profile
router.put('/profile', authGuard, roleGuard('model', 'admin', 'superadmin'), modelController.updateProfile);

module.exports = router;
