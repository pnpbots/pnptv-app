/**
 * elementController.js
 * API endpoints for Element (Matrix) account setup and management
 */

const logger = require('../../../utils/logger');
const { query } = require('../../../config/postgres');
const ElementService = require('../../services/ElementService');
const PDSProvisioningService = require('../../services/PDSProvisioningService');

/**
 * POST /api/element/setup
 * Create Element account (auto-called after Bluesky setup)
 *
 * Request:  {}
 * Response: { success: true, matrixUserId: "@user:element.pnptv.app", ... }
 */
const setupElementAccount = async (req, res) => {
  try {
    const userId = req.session?.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: { code: 'unauthorized', message: 'Please login first' }
      });
    }

    logger.info(`[Element API] Setup request from user ${userId}`);

    // Get user profile for display name
    const userResult = await query(
      `SELECT id, username, email, photo_file_id FROM users WHERE id = $1`,
      [userId]
    );

    const user = userResult.rows[0];
    if (!user) {
      return res.status(404).json({
        success: false,
        error: { code: 'user_not_found', message: 'User profile not found' }
      });
    }

    // Check if already has Element account
    const existingElement = await query(
      `SELECT id, external_user_id FROM external_profiles
       WHERE pnptv_user_id = $1 AND service_type = 'element'`,
      [userId]
    );

    if (existingElement.rows.length > 0) {
      return res.json({
        success: true,
        already_exists: true,
        matrixUserId: existingElement.rows[0].external_user_id,
        message: 'Your Element account is already set up!'
      });
    }

    // Verify PDS is provisioned (Element setup requires PDS)
    const pdsMapping = await PDSProvisioningService.getUserPDSMapping(userId);

    if (!pdsMapping) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'no_pds',
          message: 'PDS must be provisioned first'
        }
      });
    }

    // Create Element account
    const displayName = user.username || `User ${userId}`;

    const result = await ElementService.createElementAccount(
      userId,
      displayName,
      {
        avatar_url: user.photo_file_id ? `/public/uploads/avatars/${user.photo_file_id}` : null
      }
    );

    if (!result.success) {
      logger.error(`[Element API] Setup failed for user ${userId}:`, result.error);

      return res.status(500).json({
        success: false,
        error: {
          code: 'setup_failed',
          message: result.error || 'Failed to create Element account',
          details: result.details
        }
      });
    }

    logger.info(`[Element API] Setup successful for user ${userId}: ${result.matrixUserId}`);

    res.json({
      success: true,
      matrixUserId: result.matrixUserId,
      matrixUsername: result.matrixUsername,
      displayName: result.displayName,
      message: 'Element account created successfully',
      ready: true
    });

  } catch (error) {
    logger.error('[Element API] Setup error:', error);

    res.status(500).json({
      success: false,
      error: {
        code: 'internal_error',
        message: error.message || 'Failed to create Element account'
      }
    });
  }
};

/**
 * GET /api/element/status
 * Check user's Element account status
 *
 * Response: { success: true, setup: true, ready: true, matrixUserId: "...", ... }
 */
const getElementStatus = async (req, res) => {
  try {
    const userId = req.session?.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: { code: 'unauthorized', message: 'Please login first' }
      });
    }

    logger.debug(`[Element API] Status request from user ${userId}`);

    const status = await ElementService.getElementStatus(userId);

    res.json({
      success: true,
      data: status
    });

  } catch (error) {
    logger.error('[Element API] Status error:', error);

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
 * POST /api/element/disconnect
 * Disconnect Element account
 *
 * Request:  {}
 * Response: { success: true }
 */
const disconnectElement = async (req, res) => {
  try {
    const userId = req.session?.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: { code: 'unauthorized', message: 'Please login first' }
      });
    }

    logger.info(`[Element API] Disconnect request from user ${userId}`);

    const result = await ElementService.disconnectElement(userId);

    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: {
          code: 'disconnect_failed',
          message: result.error
        }
      });
    }

    logger.info(`[Element API] Disconnected for user ${userId}`);

    res.json({
      success: true,
      message: 'Element account disconnected'
    });

  } catch (error) {
    logger.error('[Element API] Disconnect error:', error);

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
 * PUT /api/element/sync-profile
 * Force profile sync to Element
 *
 * Request:  { displayName?: string, avatar_url?: string }
 * Response: { success: true }
 */
const syncElementProfile = async (req, res) => {
  try {
    const userId = req.session?.user?.id;
    const { displayName, avatar_url } = req.body;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: { code: 'unauthorized', message: 'Please login first' }
      });
    }

    logger.info(`[Element API] Sync profile request from user ${userId}`);

    // Get current Element profile
    const result = await query(
      `SELECT external_user_id, access_token_encrypted FROM external_profiles
       WHERE pnptv_user_id = $1 AND service_type = 'element'`,
      [userId]
    );

    const profile = result.rows[0];

    if (!profile) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'no_element_account',
          message: 'Element account not provisioned'
        }
      });
    }

    // Decrypt token
    const accessToken = ElementService.decryptToken(profile.access_token_encrypted);

    // Get user data for display name if not provided
    let finalDisplayName = displayName;
    if (!finalDisplayName) {
      const userResult = await query(
        `SELECT username FROM users WHERE id = $1`,
        [userId]
      );
      finalDisplayName = userResult.rows[0]?.username || `User ${userId}`;
    }

    // Sync profile
    await ElementService.syncElementProfile(
      userId,
      profile.external_user_id,
      accessToken,
      finalDisplayName,
      { avatar_url }
    );

    logger.info(`[Element API] Profile synced for user ${userId}`);

    res.json({
      success: true,
      message: 'Element profile synced successfully'
    });

  } catch (error) {
    logger.error('[Element API] Profile sync error:', error);

    res.status(500).json({
      success: false,
      error: {
        code: 'sync_failed',
        message: error.message
      }
    });
  }
};

module.exports = {
  setupElementAccount,
  getElementStatus,
  disconnectElement,
  syncElementProfile
};
