const axios = require('axios');
const logger = require('../../utils/logger');

class VideoCallService {
  /**
   * Create a Daily.co room for a call
   * @param {Object} callData - { callId, userName, scheduledDate }
   * @returns {Promise<string>} Meeting room URL
   */
  static async createMeetingRoom(callData) {
    try {
      const apiKey = process.env.DAILY_API_KEY;

      if (!apiKey) {
        logger.warn('Daily.co API key not configured, using placeholder URL');
        // Fallback: return a Zoom-like generic meeting URL
        return `https://meet.pnptv.com/${callData.callId}`;
      }

      // Create Daily.co room
      const response = await axios.post(
        'https://api.daily.co/v1/rooms',
        {
          name: `pnptv-call-${callData.callId}`,
          properties: {
            max_participants: 2, // 1:1 call
            enable_chat: true,
            enable_screenshare: true,
            enable_recording: 'cloud', // Optional: record calls
            exp: Math.floor(Date.now() / 1000) + (48 * 60 * 60), // Expires in 48 hours
            eject_at_room_exp: true,
          },
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
        },
      );

      const roomUrl = response.data.url;
      logger.info('Daily.co meeting room created', {
        callId: callData.callId,
        roomUrl,
      });

      return roomUrl;
    } catch (error) {
      logger.error('Error creating Daily.co room:', error);

      // Fallback to generic URL if Daily.co fails
      return `https://meet.pnptv.com/${callData.callId}`;
    }
  }
}

module.exports = VideoCallService;
