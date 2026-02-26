/**
 * blueskyController.js
 * API endpoints for one-click Bluesky setup
 *
 * Philosophy: Dead simple, no friction
 * - POST /api/bluesky/setup - Create Bluesky account (one click!)
 * - GET  /api/bluesky/status - Check Bluesky status
 * - POST /api/bluesky/disconnect - Remove Bluesky link
 */

const logger = require('../../../utils/logger');
const { query } = require('../../../config/postgres');
const BlueskyAutoSetupService = require('../../services/BlueskyAutoSetupService');
const PDSProvisioningService = require('../../services/PDSProvisioningService');

/**
 * POST /api/bluesky/setup
 * One-click Bluesky account creation
 *
 * Request:  {} (no parameters needed!)
 * Response: { success: true, blueskyHandle: "@username.pnptv.app", profileSynced: true }
 */
const setupBlueskyAccount = async (req, res) => {
  try {
    const userId = req.session?.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: { code: 'unauthorized', message: 'Please login first' }
      });
    }

    logger.info(`[Bluesky API] Setup request from user ${userId}`);

    // Verify user has PDS
    const pdsMapping = await PDSProvisioningService.getUserPDSMapping(userId);

    if (!pdsMapping) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'no_pds',
          message: 'PDS must be provisioned first. Please refresh your page.'
        }
      });
    }

    // Check if already has Bluesky
    if (pdsMapping.bluesky_handle) {
      return res.json({
        success: true,
        already_exists: true,
        blueskyHandle: pdsMapping.bluesky_handle,
        blueskyDid: pdsMapping.bluesky_did,
        message: 'Your Bluesky account is already set up!'
      });
    }

    // Create Bluesky account
    const result = await BlueskyAutoSetupService.createBlueskyAccountOnClick(userId);

    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: {
          code: 'setup_failed',
          message: result.error || 'Failed to create Bluesky account'
        }
      });
    }

    logger.info(`[Bluesky API] Setup successful for user ${userId}: ${result.blueskyHandle}`);

    res.json({
      success: true,
      blueskyHandle: result.blueskyHandle,
      blueskyDid: result.blueskyDid,
      profileSynced: result.profileSynced,
      message: result.message,
      ready: true
    });

  } catch (error) {
    logger.error('[Bluesky API] Setup error:', error);

    res.status(500).json({
      success: false,
      error: {
        code: 'internal_error',
        message: error.message || 'Failed to create Bluesky account'
      }
    });
  }
};

/**
 * GET /api/bluesky/status
 * Check user's Bluesky account status
 *
 * Response: { success: true, setup: true, ready: true, handle: "@user.pnptv.app", ... }
 */
const getBlueskyStatus = async (req, res) => {
  try {
    const userId = req.session?.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: { code: 'unauthorized', message: 'Please login first' }
      });
    }

    logger.debug(`[Bluesky API] Status request from user ${userId}`);

    const status = await BlueskyAutoSetupService.getBlueskyStatus(userId);

    res.json({
      success: true,
      data: status
    });

  } catch (error) {
    logger.error('[Bluesky API] Status error:', error);

    res.status(500).json({
      success: false,
      error: {
        code: 'internal_error',
        message: error.message
      }
    });
  }
};

/**
 * POST /api/bluesky/disconnect
 * Disconnect Bluesky account (user-initiated)
 *
 * Request:  {}
 * Response: { success: true }
 */
const disconnectBluesky = async (req, res) => {
  try {
    const userId = req.session?.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: { code: 'unauthorized', message: 'Please login first' }
      });
    }

    logger.info(`[Bluesky API] Disconnect request from user ${userId}`);

    // Verify has Bluesky account
    const pdsMapping = await PDSProvisioningService.getUserPDSMapping(userId);

    if (!pdsMapping?.bluesky_handle) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'no_bluesky_account',
          message: 'No Bluesky account linked'
        }
      });
    }

    // Disconnect
    const result = await BlueskyAutoSetupService.disconnectBluesky(userId);

    logger.info(`[Bluesky API] Disconnected Bluesky for user ${userId}`);

    res.json({
      success: true,
      message: 'Bluesky account disconnected'
    });

  } catch (error) {
    logger.error('[Bluesky API] Disconnect error:', error);

    res.status(500).json({
      success: false,
      error: {
        code: 'internal_error',
        message: error.message
      }
    });
  }
};

module.exports = {
  setupBlueskyAccount,
  getBlueskyStatus,
  disconnectBluesky
};
