const express = require('express');
const modelController = require('../controllers/modelController');
const authGuard = require('../middleware/authGuard');
const roleGuard = require('../middleware/roleGuard');

const router = express.Router();

/**
 * Model-Only Routes (protected)
 */

// GET /api/model/dashboard
router.get('/dashboard', authGuard, roleGuard('model', 'admin', 'superadmin'), modelController.getDashboard);

// POST /api/model/content/upload
router.post('/content/upload', authGuard, roleGuard('model', 'admin'), modelController.uploadContent);

// GET /api/model/content
router.get('/content', authGuard, roleGuard('model', 'admin'), modelController.getMyContent);

// DELETE /api/model/content/:contentId
router.delete('/content/:contentId', authGuard, roleGuard('model', 'admin'), modelController.deleteContent);

// GET /api/model/content/:contentId/analytics
router.get('/content/:contentId/analytics', authGuard, roleGuard('model', 'admin'), modelController.getContentAnalytics);

// GET /api/model/earnings
router.get('/earnings', authGuard, roleGuard('model', 'admin'), modelController.getEarnings);

// POST /api/model/withdrawal/request
router.post('/withdrawal/request', authGuard, roleGuard('model', 'admin'), modelController.requestWithdrawal);

// GET /api/model/withdrawal/history
router.get('/withdrawal/history', authGuard, roleGuard('model', 'admin'), modelController.getWithdrawalHistory);

// GET /api/model/withdrawal/available
router.get('/withdrawal/available', authGuard, roleGuard('model', 'admin'), modelController.getWithdrawableAmount);

// GET /api/model/streaming/limits
router.get('/streaming/limits', authGuard, roleGuard('model', 'admin'), modelController.checkStreamingLimits);

// PUT /api/model/profile
router.put('/profile', authGuard, roleGuard('model', 'admin'), modelController.updateProfile);

module.exports = router;
