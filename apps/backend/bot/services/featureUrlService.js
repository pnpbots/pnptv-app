/**
 * Feature URL Service
 * Handles API calls to retrieve web app URLs for hybrid features
 * @module featureUrlService
 */

const axios = require('axios');
const logger = require('../../utils/logger');

class FeatureUrlService {
  /**
   * Get the feature API base URL from environment
   * @returns {string} Base URL for feature endpoints
   */
  static getBaseUrl() {
    return process.env.API_BASE_URL || 'http://localhost:3001';
  }

  /**
   * Get Hangouts web app URL from API
   * @param {string|number} telegramUserId - User's Telegram ID
   * @returns {Promise<string>} Hangouts URL
   */
  static async getHangoutUrl(telegramUserId) {
    try {
      const baseUrl = this.getBaseUrl();
      const response = await axios.get(`${baseUrl}/api/features/hangout/url`, {
        headers: {
          'x-telegram-user-id': telegramUserId.toString(),
        },
        timeout: 5000,
      });

      if (response.data && response.data.success && response.data.url) {
        return response.data.url;
      }

      throw new Error('Invalid response from hangout URL endpoint');
    } catch (error) {
      logger.error('Error getting Hangout URL:', {
        userId: telegramUserId,
        error: error.message,
      });
      // Fallback to environment variable
      return process.env.HANGOUTS_WEB_APP_URL || 'https://pnptv.app/hangouts';
    }
  }

  /**
   * Get Videorama web app URL from API
   * @param {string|number} telegramUserId - User's Telegram ID
   * @returns {Promise<string>} Videorama URL
   */
  static async getVideoramaUrl(telegramUserId) {
    try {
      const baseUrl = this.getBaseUrl();
      const response = await axios.get(`${baseUrl}/api/features/videorama/url`, {
        headers: {
          'x-telegram-user-id': telegramUserId.toString(),
        },
        timeout: 5000,
      });

      if (response.data && response.data.success && response.data.url) {
        return response.data.url;
      }

      throw new Error('Invalid response from videorama URL endpoint');
    } catch (error) {
      logger.error('Error getting Videorama URL:', {
        userId: telegramUserId,
        error: error.message,
      });
      // Fallback to environment variable
      return process.env.VIDEORAMA_WEB_APP_URL || 'https://pnptv.app/videorama-app';
    }
  }

  /**
   * Get Nearby web app URL from API
   * @param {string|number} telegramUserId - User's Telegram ID
   * @returns {Promise<string>} Nearby URL
   */
  static async getNearbyUrl(telegramUserId) {
    try {
      const baseUrl = this.getBaseUrl();
      const response = await axios.get(`${baseUrl}/api/features/nearby/url`, {
        headers: {
          'x-telegram-user-id': telegramUserId.toString(),
        },
        timeout: 5000,
      });

      if (response.data && response.data.success && response.data.url) {
        return response.data.url;
      }

      throw new Error('Invalid response from nearby URL endpoint');
    } catch (error) {
      logger.error('Error getting Nearby URL:', {
        userId: telegramUserId,
        error: error.message,
      });
      // Fallback to environment variable
      return process.env.NEARBY_WEB_APP_URL || 'https://pnptv.app/nearby';
    }
  }
}

module.exports = FeatureUrlService;
