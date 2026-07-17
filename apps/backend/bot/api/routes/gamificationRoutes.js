const express = require('express');
const router = express.Router();
const authGuard = require('../middleware/authGuard');
const roleGuard = require('../middleware/roleGuard');
const ctrl = require('../controllers/gamificationController');

// Public routes (auth required)
router.get('/categories', authGuard, ctrl.getCategories);
router.get('/badges', authGuard, ctrl.getBadges);
router.get('/leaderboard/weekly', authGuard, ctrl.getWeeklyLeaderboard);
router.get('/user/:userId/badges', authGuard, ctrl.getUserBadges);

// Admin routes
router.post('/award', authGuard, roleGuard('admin', 'superadmin'), ctrl.awardBadge);
router.post('/revoke', authGuard, roleGuard('admin', 'superadmin'), ctrl.revokeBadge);
router.post('/award-creators-mecuido', authGuard, roleGuard('admin', 'superadmin'), ctrl.awardMeCuidoToCreators);
router.get('/badge/:badgeSlug/holders', authGuard, roleGuard('admin', 'superadmin'), ctrl.getBadgeHolders);

module.exports = router;
