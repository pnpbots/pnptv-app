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
    const { roomName, displayName, email } = req.body;

    // SECURITY: Always use the authenticated session identity — never trust req.body.userId
    const sessionUser = req.session?.user || req.user;
    if (!sessionUser?.id) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    const userId = String(sessionUser.id);

    // Validate required fields
    if (!roomName || !displayName) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: roomName, displayName'
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
    const hasAccess = await UserService.hasActiveSubscription(userId);
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
    const { roomName, displayName, email } = req.body;

    // SECURITY: Always use the authenticated session identity — never trust req.body.userId
    const sessionUser = req.session?.user || req.user;
    if (!sessionUser?.id) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    const userId = String(sessionUser.id);

    // Validate required fields
    if (!roomName || !displayName) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: roomName, displayName'
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

    // Check if user is admin, active creator, or assigned performer
    const user = await UserService.getById(userId);
    const isAdmin = user && (user.role === 'admin' || user.role === 'superadmin');
    const isCreator = user && user.creator_status === 'active';
    const hasChannel = user && user.live_channel;
    if (!isAdmin && !isCreator && !hasChannel) {
      logger.warn('Unauthorized moderator token request', { userId });
      return res.status(403).json({
        success: false,
        error: 'Only streamers and admins can request moderator tokens'
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
 * Generate JaaS live streaming token for assigned channel
 * POST /api/jaas/live-token
 */
const generateLiveToken = async (req, res) => {
  try {
    const sessionUser = req.session?.user || req.user;
    if (!sessionUser?.id) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    const userId = String(sessionUser.id);

    if (!JaasService.isConfigured()) {
      return res.status(503).json({ success: false, error: 'Video service temporarily unavailable' });
    }

    const user = await UserService.getById(userId);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const isAdmin = user.role === 'admin' || user.role === 'superadmin';
    const isCreator = user.creator_status === 'active';
    const hasChannel = !!user.live_channel;
    if (!isAdmin && !isCreator && !hasChannel) {
      return res.status(403).json({ success: false, error: 'Not authorized to livestream' });
    }

    const roomName = user.live_channel || `pnptv-live-${userId}`;
    const displayName = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || 'Streamer';
    const avatarUrl = user.photo_file_id
      ? (user.photo_file_id.startsWith('/') ? user.photo_file_id : '/' + user.photo_file_id)
      : '';

    const token = JaasService.generateToken({
      roomName,
      userId,
      userName: displayName,
      userEmail: user.email || '',
      userAvatar: avatarUrl,
      isModerator: true,
      enableLivestreaming: true,
      enableRecording: false,
      enableTranscription: false,
      expiresIn: '4h'
    });

    const meetingUrl = JaasService.generateMeetingUrl(roomName, token);

    logger.info('JaaS live streaming token generated', { userId, roomName, displayName });

    res.json({
      success: true,
      token,
      roomName,
      meetingUrl,
      domain: '8x8.vc',
      role: 'moderator',
      features: { livestreaming: true, recording: false }
    });
  } catch (error) {
    logger.error('Error generating live token:', error);
    res.status(500).json({ success: false, error: 'Failed to generate live streaming token' });
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
  generateLiveToken,
  getStatus
};
