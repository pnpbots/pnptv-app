const JaasService = require('../../services/jaasService');
const UserService = require('../../services/userService');
const logger = require('../../../utils/logger');

/**
 * Generate JaaS JWT token for video rooms access
 * POST /api/jaas/token
 * Body: { roomName, userId, displayName, email }
 */
const generateToken = async (req, res) => {
  try {
    const { roomName, userId, displayName, email } = req.body;

    // Validate required fields
    if (!roomName || !userId || !displayName) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: roomName, userId, displayName'
      });
    }

    // Verify JaaS is configured
    if (!JaasService.isConfigured()) {
      logger.error('JaaS not configured for token generation');
      return res.status(503).json({
        success: false,
        error: 'Video service temporarily unavailable'
      });
    }

    // Verify user has active subscription
    const hasAccess = await UserService.hasActiveSubscription(parseInt(userId));
    if (!hasAccess) {
      logger.warn('Unauthorized video room access attempt', { userId });
      return res.status(403).json({
        success: false,
        error: 'Premium subscription required for video rooms'
      });
    }

    // Generate JWT token for viewer (non-moderator)
    const token = JaasService.generateViewerToken(
      roomName,
      userId,
      displayName,
      email || '',
      '' // userAvatar - optional
    );

    logger.info('JaaS token generated successfully', {
      userId,
      roomName,
      displayName
    });

    res.json({
      success: true,
      token,
      domain: '8x8.vc'
    });

  } catch (error) {
    logger.error('Error generating JaaS token:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate authentication token'
    });
  }
};

/**
 * Generate moderator token (for admins/hosts)
 * POST /api/jaas/moderator-token
 * Body: { roomName, userId, displayName, email }
 */
const generateModeratorToken = async (req, res) => {
  try {
    const { roomName, userId, displayName, email } = req.body;

    // Validate required fields
    if (!roomName || !userId || !displayName) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: roomName, userId, displayName'
      });
    }

    // Verify JaaS is configured
    if (!JaasService.isConfigured()) {
      logger.error('JaaS not configured for token generation');
      return res.status(503).json({
        success: false,
        error: 'Video service temporarily unavailable'
      });
    }

    // Check if user is admin or has special privileges
    const user = await UserService.getById(parseInt(userId));
    if (!user || (user.role !== 'admin' && user.role !== 'superadmin')) {
      logger.warn('Unauthorized moderator token request', { userId });
      return res.status(403).json({
        success: false,
        error: 'Only admins can request moderator tokens'
      });
    }

    // Generate JWT token for moderator (with all features)
    const token = JaasService.generateModeratorToken(
      roomName,
      userId,
      displayName,
      email || '',
      '' // userAvatar - optional
    );

    logger.info('JaaS moderator token generated successfully', {
      userId,
      roomName,
      displayName
    });

    res.json({
      success: true,
      token,
      domain: '8x8.vc',
      role: 'moderator'
    });

  } catch (error) {
    logger.error('Error generating moderator token:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate moderator token'
    });
  }
};

/**
 * Check JaaS configuration status
 * GET /api/jaas/status
 */
const getStatus = async (req, res) => {
  try {
    const isConfigured = JaasService.isConfigured();

    res.json({
      success: true,
      configured: isConfigured,
      domain: '8x8.vc',
      message: isConfigured
        ? 'JaaS is ready for video sessions'
        : 'JaaS is not properly configured'
    });

  } catch (error) {
    logger.error('Error checking JaaS status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check service status'
    });
  }
};

module.exports = {
  generateToken,
  generateModeratorToken,
  getStatus
};
