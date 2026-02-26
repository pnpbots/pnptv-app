const jaasService = require('../services/jaasService');
const logger = require('../../utils/logger');

const DEFAULT_BASE_URL = 'https://pnptv.app/hangouts/jitsi';

/**
 * Build Jitsi/JAAS Web App URL with JWT authentication
 * @param {Object} options - URL building options
 * @returns {string} Complete Jitsi meeting URL with JWT token
 */
const buildJitsiHangoutsUrl = ({
  baseUrl = process.env.HANGOUTS_WEB_APP_URL || DEFAULT_BASE_URL,
  roomName,
  userId,
  userName,
  userEmail = '',
  userAvatar = '',
  isModerator = false,
  callId,
  type = 'private',
} = {}) => {
  try {
    if (!roomName) {
      throw new Error('roomName is required for Jitsi hangouts');
    }

    // Check if JAAS is configured
    if (!jaasService.isConfigured()) {
      logger.warn('JAAS not configured, falling back to public Jitsi');
      return buildPublicJitsiUrl({ roomName, userName, type });
    }

    // Generate JWT token based on role
    const token = isModerator
      ? jaasService.generateModeratorToken(roomName, userId, userName, userEmail, userAvatar)
      : jaasService.generateViewerToken(roomName, userId, userName, userEmail, userAvatar);

    // Generate the meeting URL
    const meetingUrl = jaasService.generateMeetingUrl(roomName, token);

    logger.info('Generated Jitsi hangouts URL', {
      roomName,
      userId,
      userName,
      isModerator,
      callId,
    });

    return meetingUrl;
  } catch (error) {
    logger.error('Error building Jitsi hangouts URL:', error);
    // Fallback to public Jitsi on error
    return buildPublicJitsiUrl({ roomName, userName, type });
  }
};

/**
 * Build public Jitsi URL without authentication (fallback)
 * @param {Object} options - URL building options
 * @returns {string} Public Jitsi meeting URL
 */
const buildPublicJitsiUrl = ({
  roomName,
  userName = 'Guest',
  type = 'private',
} = {}) => {
  const domain = process.env.JITSI_DOMAIN || 'meet.jit.si';
  const sanitizedRoom = roomName.replace(/[^a-zA-Z0-9_-]/g, '');
  const sanitizedName = encodeURIComponent(userName);

  // Build URL with configuration
  const url = new URL(`https://${domain}/${sanitizedRoom}`);
  url.hash = `config.prejoinPageEnabled=false&config.startWithAudioMuted=false&config.startWithVideoMuted=false&userInfo.displayName=${sanitizedName}`;

  return url.toString();
};

/**
 * Build complete room configuration for Jitsi hangouts
 * @param {Object} options - Configuration options
 * @returns {Object} Room configuration with URLs and tokens
 */
const buildJitsiRoomConfig = ({
  roomName,
  creatorId,
  creatorName,
  callId,
  isPublic = false,
  maxParticipants = 10,
} = {}) => {
  try {
    // Creator is always moderator
    const moderatorUrl = buildJitsiHangoutsUrl({
      roomName,
      userId: creatorId,
      userName: creatorName,
      isModerator: true,
      callId,
      type: isPublic ? 'public' : 'private',
    });

    // Generate a join URL for participants (without JWT, will be generated on join)
    const joinUrl = `https://t.me/${process.env.BOT_USERNAME}?start=jitsi_${callId}`;

    return {
      success: true,
      roomName,
      moderatorUrl,
      joinUrl,
      callId,
      isPublic,
      maxParticipants,
      platform: 'jitsi',
    };
  } catch (error) {
    logger.error('Error building Jitsi room config:', error);
    return {
      success: false,
      error: error.message,
    };
  }
};

/**
 * Generate participant join URL
 * @param {Object} options - Participant options
 * @returns {string} Participant join URL with JWT
 */
const generateParticipantUrl = ({
  roomName,
  userId,
  userName,
  userEmail = '',
  userAvatar = '',
} = {}) => {
  return buildJitsiHangoutsUrl({
    roomName,
    userId,
    userName,
    userEmail,
    userAvatar,
    isModerator: false,
    type: 'private',
  });
};

module.exports = {
  buildJitsiHangoutsUrl,
  buildPublicJitsiUrl,
  buildJitsiRoomConfig,
  generateParticipantUrl,
};
