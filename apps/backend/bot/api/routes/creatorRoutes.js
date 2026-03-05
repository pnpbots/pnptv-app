const express = require('express');
const creatorController = require('../controllers/creatorController');
const authGuard = require('../middleware/authGuard');
const roleGuard = require('../middleware/roleGuard');

const router = express.Router();

// User routes (auth required)
router.get('/eligibility', authGuard, creatorController.getEligibility);
router.post('/activate', authGuard, creatorController.activateCreator);
// Full-time applications use /api/apply (existing model_applications flow)
router.get('/dashboard', authGuard, creatorController.getDashboard);

// Admin routes — require admin or superadmin role at the middleware layer
router.get('/applications', authGuard, roleGuard('admin', 'superadmin'), creatorController.listApplications);
router.post('/applications/:id/approve', authGuard, roleGuard('admin', 'superadmin'), creatorController.approveApplication);
router.post('/applications/:id/reject', authGuard, roleGuard('admin', 'superadmin'), creatorController.rejectApplication);
// IMPORTANT: /active must come BEFORE /:creatorId/* routes to avoid param capture
router.get('/active', authGuard, roleGuard('admin', 'superadmin'), creatorController.listActiveCreators);
router.get('/:creatorId/strikes', authGuard, roleGuard('admin', 'superadmin'), creatorController.getStrikes);
router.post('/:creatorId/strike', authGuard, roleGuard('admin', 'superadmin'), creatorController.issueStrike);

// Creator wallet routes
router.get('/wallet', authGuard, creatorController.getWalletAddress);
router.post('/wallet', authGuard, creatorController.saveWalletAddress);

// Creator tier change
router.post('/change-tier', authGuard, creatorController.changeTier);

// Creator subscription routes
router.get('/:creatorId/subscription-status', authGuard, creatorController.getSubscriptionStatus);
router.post('/:creatorId/subscribe', authGuard, creatorController.subscribeToCreator);
router.post('/:creatorId/unsubscribe', authGuard, creatorController.unsubscribeFromCreator);

module.exports = router;
