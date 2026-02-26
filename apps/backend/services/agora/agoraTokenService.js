/**
 * Agora Token Service
 * Generates RTC and RTM tokens for all PNPtv features
 */

const { RtcTokenBuilder, RtmTokenBuilder, RtcRole } = require('agora-token');
const logger = require('../../utils/logger');

class AgoraTokenService {
  constructor() {
    this.appId = process.env.AGORA_APP_ID;
    this.appCertificate = process.env.AGORA_APP_CERTIFICATE;

    if (!this.appId || !this.appCertificate) {
      logger.warn('Agora credentials not configured. Set AGORA_APP_ID and AGORA_APP_CERTIFICATE');
    }
  }

  /**
   * Check if Agora is properly configured
   */
  isConfigured() {
    return !!(this.appId && this.appCertificate);
  }

  /**
   * Generate RTC token for video/audio channels
   * @param {Object} options - Token generation options
   * @returns {string} RTC token
   */
  generateRTCToken(options = {}) {
    if (!this.isConfigured()) {
      // Return mock token for development
      logger.warn('Using mock Agora token - configure credentials for production');
      return `mock_rtc_token_${Date.now()}`;
    }

    const {
      channelName,
      userId,
      role = 'publisher', // 'publisher' or 'subscriber'
      expirationTimeInSeconds = 3600, // 1 hour default
    } = options;

    if (!channelName) {
      throw new Error('Channel name is required for RTC token generation');
    }

    const numericUid = Number(userId);
    const uid = Number.isFinite(numericUid) ? numericUid : 0; // 0 = any user can join (fallback)
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const privilegeExpiredTs = currentTimestamp + expirationTimeInSeconds;

    const roleEnum = role === 'publisher' ? RtcRole.PUBLISHER : RtcRole.SUBSCRIBER;

    try {
      const token = RtcTokenBuilder.buildTokenWithUid(
        this.appId,
        this.appCertificate,
        channelName,
        uid,
        roleEnum,
        privilegeExpiredTs,
      );

      logger.info('Generated RTC token', { channelName, role, expiresIn: expirationTimeInSeconds });
      return token;
    } catch (error) {
      logger.error('Error generating RTC token:', error);
      throw new Error('Failed to generate RTC token');
    }
  }

  /**
   * Generate RTM token for messaging
   * @param {string} userId - User ID
   * @param {number} expirationTimeInSeconds - Token expiration time
   * @returns {string} RTM token
   */
  generateRTMToken(userId, expirationTimeInSeconds = 3600) {
    if (!this.isConfigured()) {
      logger.warn('Using mock RTM token - configure credentials for production');
      return `mock_rtm_token_${Date.now()}`;
    }

    if (!userId) {
      throw new Error('User ID is required for RTM token generation');
    }

    const currentTimestamp = Math.floor(Date.now() / 1000);
    const privilegeExpiredTs = currentTimestamp + expirationTimeInSeconds;

    try {
      const token = RtmTokenBuilder.buildToken(
        this.appId,
        this.appCertificate,
        String(userId),
        privilegeExpiredTs,
      );

      logger.info('Generated RTM token', { userId, expiresIn: expirationTimeInSeconds });
      return token;
    } catch (error) {
      logger.error('Error generating RTM token:', error);
      throw new Error('Failed to generate RTM token');
    }
  }

  /**
   * Generate host token (publisher with extended privileges)
   */
  generateHostToken(channelName, userId) {
    return this.generateRTCToken({
      channelName,
      userId,
      role: 'publisher',
      expirationTimeInSeconds: 7200, // 2 hours for hosts
    });
  }

  /**
   * Generate viewer token (subscriber)
   */
  generateViewerToken(channelName, userId) {
    return this.generateRTCToken({
      channelName,
      userId,
      role: 'subscriber',
      expirationTimeInSeconds: 3600, // 1 hour for viewers
    });
  }

  /**
   * Generate tokens for video call (10-person calls)
   */
  generateVideoCallTokens(channelName, userId, isHost = false) {
    const rtcToken = this.generateRTCToken({
      channelName,
      userId,
      role: 'publisher', // All participants can publish
      expirationTimeInSeconds: isHost ? 7200 : 3600,
    });

    const rtmToken = this.generateRTMToken(userId, isHost ? 7200 : 3600);

    return {
      rtcToken,
      rtmToken,
      appId: this.appId,
      channelName,
      userId: String(userId),
    };
  }

  /**
   * Generate tokens for main rooms (50-person rooms)
   */
  generateMainRoomTokens(channelName, userId, canPublish = false) {
    // Start as subscriber, can upgrade to publisher later
    const role = canPublish ? 'publisher' : 'subscriber';

    const rtcToken = this.generateRTCToken({
      channelName,
      userId,
      role,
      expirationTimeInSeconds: 7200, // 2 hours
    });

    const rtmToken = this.generateRTMToken(userId, 7200);

    return {
      rtcToken,
      rtmToken,
      appId: this.appId,
      channelName,
      userId: String(userId),
      role,
    };
  }

  /**
   * Generate tokens for webinars (200 attendees)
   */
  generateWebinarTokens(channelName, userId, isHost = false) {
    const role = isHost ? 'publisher' : 'subscriber';

    const rtcToken = this.generateRTCToken({
      channelName,
      userId,
      role,
      expirationTimeInSeconds: 10800, // 3 hours for webinars
    });

    const rtmToken = this.generateRTMToken(userId, 10800);

    return {
      rtcToken,
      rtmToken,
      appId: this.appId,
      channelName,
      userId: String(userId),
      role,
    };
  }



  /**
   * Generate bot tokens (for room hosts and )
   */
  generateBotTokens(channelName, botUserId) {
    const rtcToken = this.generateRTCToken({
      channelName,
      userId: botUserId,
      role: 'publisher',
      expirationTimeInSeconds: 86400, // 24 hours for bots
    });

    const rtmToken = this.generateRTMToken(botUserId, 86400);

    return {
      rtcToken,
      rtmToken,
      appId: this.appId,
      channelName,
      userId: String(botUserId),
    };
  }
}

module.exports = new AgoraTokenService();
