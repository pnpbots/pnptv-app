/**
 * externalProfileRoutes.js
 * Routes for Bluesky and Element profile linking and management
 * All routes require authentication
 */

const express = require('express');
const router = express.Router();

module.exports = (pool) => {
  const ExternalProfileController = require('../controllers/externalProfileController');
  const controller = new ExternalProfileController(pool);

  // All routes require authentication
  router.use((req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
        },
      });
    }
    next();
  });

  // ==================== EXTERNAL PROFILES ====================

  /**
   * GET /api/webapp/profile/external
   * Fetch all linked external profiles for user
   */
  router.get('/external', (req, res) => controller.getExternalProfiles(req, res));

  /**
   * POST /api/webapp/profile/external/link
   * Initiate linking to Bluesky profile
   * Body: { handle: "alice.bsky.social" }
   */
  router.post('/external/link', (req, res) => controller.initiateBlueskyLink(req, res));

  /**
   * POST /api/webapp/profile/external/:profileId/verify
   * Verify external profile ownership
   * Body: { signedChallenge: "...", accessToken: "..." }
   */
  router.post('/external/:profileId/verify', (req, res) =>
    controller.verifyProfileOwnership(req, res)
  );

  /**
   * PATCH /api/webapp/profile/external/:profileId
   * Update external profile privacy settings
   * Body: { showOnProfile, showFollowerCount, showActivityStatus, publicLinking }
   */
  router.patch('/external/:profileId', (req, res) => controller.updateProfileSettings(req, res));

  /**
   * DELETE /api/webapp/profile/external/:profileId
   * Unlink external profile from pnptv account
   */
  router.delete('/external/:profileId', (req, res) => controller.unlinkProfile(req, res));

  // ==================== FEED PREFERENCES ====================

  /**
   * GET /api/webapp/feed/preferences
   * Fetch user's feed preferences (Bluesky, Element, combined feed settings)
   */
  router.get('/preferences', (req, res) => controller.getFeedPreferences(req, res));

  /**
   * PUT /api/webapp/feed/preferences
   * Update user's feed preferences
   * Body: {
   *   showBlueskyFeed: true,
   *   blueskyFeedEnabled: true,
   *   blueskyAutoSync: false,
   *   combinedFeedOrder: "recent",
   *   externalContentRatio: 30,
   *   ...
   * }
   */
  router.put('/preferences', (req, res) => controller.updateFeedPreferences(req, res));

  // ==================== FEED FILTERING ====================

  /**
   * POST /api/webapp/feed/mute
   * Mute external user in feed
   * Body: { externalUserId: "did:plc:...", mute: true }
   */
  router.post('/mute', (req, res) => controller.muteUser(req, res));

  /**
   * POST /api/webapp/feed/block
   * Block external user (hide all posts)
   * Body: { externalUserId: "did:plc:...", block: true }
   */
  router.post('/block', (req, res) => controller.blockUser(req, res));

  // ==================== FEED DISPLAY ====================

  /**
   * GET /api/webapp/feed/bluesky
   * Fetch user's Bluesky feed (cached posts from followed profiles)
   * Query params: ?limit=20&offset=0
   */
  router.get('/bluesky', (req, res) => controller.getBlueskyFeed(req, res));

  return router;
};
