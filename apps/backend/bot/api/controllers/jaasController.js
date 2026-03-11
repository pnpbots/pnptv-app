const JaasService = require('../../services/jaasService');
const UserService = require('../../services/userService');
const EntitlementAccessService = require('../../services/entitlementAccessService');
const { query } = require('../../../config/postgres');
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

    // Validate room name format (alphanumeric, hyphens, underscores only)
    if (!JaasService.validateRoomName(roomName)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid room name format'
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

    // Verify user has active membership entitlement
    const hasAccess = await EntitlementAccessService.hasEntitlement(String(userId), 'pnp-member');
    if (!hasAccess) {
      logger.warn('Unauthorized video room access attempt', { userId });
      return res.status(403).json({
        success: false,
        error: 'Active membership required'
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

    // Validate room name format (alphanumeric, hyphens, underscores only)
    if (!JaasService.validateRoomName(roomName)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid room name format'
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

    // Exception: pnp-member who owns the hangout group (or created its call) gets a moderator token
    const isHangoutRoomEarly = roomName.startsWith('hangout-');
    if (!isAdmin && !isCreator && !hasChannel && isHangoutRoomEarly) {
      const hasMembership = await EntitlementAccessService.hasEntitlement(userId, 'pnp-member');
      if (hasMembership) {
        const groupIdMatchEarly = roomName.match(/^hangout-(\d+)/);
        if (groupIdMatchEarly) {
          const hGroupIdEarly = parseInt(groupIdMatchEarly[1], 10);
          const [ownerRowsEarly, callCreatorRowsEarly] = await Promise.all([
            query(
              'SELECT 1 FROM hangout_group_members WHERE group_id=$1 AND user_id=$2 AND role=$3',
              [hGroupIdEarly, userId, 'owner']
            ),
            query(
              'SELECT 1 FROM hangout_video_calls WHERE room_name=$1 AND creator_id=$2 LIMIT 1',
              [roomName, userId]
            ),
          ]);
          if (ownerRowsEarly.rows.length > 0 || callCreatorRowsEarly.rows.length > 0) {
            const token = JaasService.generateModeratorToken(roomName, userId, displayName, email || '', '');
            logger.info('JaaS moderator token granted to hangout owner/creator (pnp-member)', { userId, roomName });
            return res.json({ success: true, token, domain: '8x8.vc', role: 'moderator' });
          }
        }
      }
    }

    if (!isAdmin && !isCreator && !hasChannel) {
      logger.warn('Unauthorized moderator token request', { userId });
      return res.status(403).json({
        success: false,
        error: 'Only streamers and admins can request moderator tokens'
      });
    }

    // HG-05: Verify room ownership — non-admin creators can only moderate their own rooms
    if (!isAdmin) {
      const ownChannel = user.live_channel || `pnptv-live-${userId}`;
      const isOwnChannel = roomName === ownChannel;
      const isHangoutRoom = roomName.startsWith('hangout-');
      if (!isOwnChannel && !isHangoutRoom) {
        logger.warn('Moderator token for foreign room blocked', { userId, roomName });
        return res.status(403).json({
          success: false,
          error: 'Cannot moderate a room you do not own'
        });
      }
      if (isHangoutRoom && !isOwnChannel) {
        // Extract groupId from room name pattern: "hangout-{groupId}-..."
        const groupIdMatch = roomName.match(/^hangout-(\d+)/);
        if (!groupIdMatch) {
          logger.warn('Moderator token for malformed hangout room blocked', { userId, roomName });
          return res.status(403).json({ success: false, error: 'Invalid hangout room name' });
        }
        const hGroupId = parseInt(groupIdMatch[1], 10);
        const { rows: memberRows } = await query(
          'SELECT role FROM hangout_group_members WHERE group_id=$1 AND user_id=$2',
          [hGroupId, userId]
        );
        const isGroupOwner = memberRows.some(r => r.role === 'owner');
        const { rows: callRows } = await query(
          `SELECT 1 FROM hangout_video_calls WHERE room_name=$1 AND creator_id=$2 LIMIT 1`,
          [roomName, userId]
        );
        const isCallCreator = callRows.length > 0;
        if (!isGroupOwner && !isCallCreator) {
          logger.warn('Moderator token for hangout room blocked — not owner or call creator', { userId, roomName, hGroupId });
          return res.status(403).json({ success: false, error: 'Not authorized to moderate this hangout room' });
        }
      }
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
