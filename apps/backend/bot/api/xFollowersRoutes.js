const express = require('express');
const XFollowersController = require('./controllers/xFollowersController');

const router = express.Router();

/**
 * GET /api/x/followers/non-mutuals
 * Analyze non-mutual followers (people you follow but who don't follow back)
 * Query: { xUserId: "12345" }
 * Header: x-telegram-init-data (Telegram Web App auth)
 */
router.get('/non-mutuals', XFollowersController.analyzNonMutuals);

/**
 * POST /api/x/followers/unfollow-non-mutuals
 * Actually unfollow non-mutual followers
 * Admin only
 * Body: { xUserId: "12345", dryRun: true }
 * Header: x-telegram-init-data (Telegram Web App auth)
 */
router.post('/unfollow-non-mutuals', XFollowersController.unfollowNonMutuals);

/**
 * GET /api/x/followers/stats
 * Get follower/following stats
 * Query: { xUserId: "12345" }
 * Header: x-telegram-init-data (Telegram Web App auth)
 */
router.get('/stats', XFollowersController.getStats);

module.exports = router;
