const crypto = require('crypto');
const axios = require('axios');
const { cache } = require('../../config/redis');
const logger = require('../../utils/logger');

const AMPACHE_BASE = process.env.AMPACHE_URL || 'http://127.0.0.1:32768';
const AMPACHE_USER = process.env.AMPACHE_USER || 'admin';
const AMPACHE_PASS = process.env.AMPACHE_PASSWORD || '';
const TOKEN_TTL = 55 * 60; // 55 min (tokens expire in 1h, cache expires before that)

class AmpacheService {
  /**
   * Authenticate with Ampache and get session token
   * Uses Redis cache to avoid repeated authentication
   */
  static async getAuthToken() {
    try {
      return await cache.getOrSet('ampache:session_token', async () => {
        logger.info('Fetching new Ampache session token');

        const timestamp = Math.floor(Date.now() / 1000);
        const passphrase = crypto.createHash('sha256').update(AMPACHE_PASS).digest('hex');
        const auth = crypto.createHash('sha256').update(`${timestamp}${passphrase}`).digest('hex');

        const resp = await axios.get(`${AMPACHE_BASE}/server/json.server.php`, {
          params: {
            action: 'handshake',
            auth,
            timestamp,
            user: AMPACHE_USER,
            version: '6.0.0'
          },
          timeout: 5000
        });

        if (!resp.data || !resp.data.auth) {
          throw new Error('Ampache handshake failed: no auth token returned');
        }

        logger.info('✓ Ampache authentication successful');
        return resp.data.auth;
      }, TOKEN_TTL);
    } catch (error) {
      logger.error('Ampache getAuthToken error:', error.message);
      throw error;
    }
  }

  /**
   * Get songs from Ampache catalog
   * @param {Object} options - Query options
   * @param {number} options.offset - Pagination offset (default 0)
   * @param {number} options.limit - Items per page (default 50)
   * @returns {Promise<Array>} Array of song objects
   */
  static async getSongs({ offset = 0, limit = 50 } = {}) {
    try {
      const token = await this.getAuthToken();
      const resp = await axios.get(`${AMPACHE_BASE}/server/json.server.php`, {
        params: {
          action: 'songs',
          auth: token,
          offset: Math.max(0, +offset),
          limit: Math.min(+limit, 100) // Cap at 100
        },
        timeout: 10000
      });

      const songs = resp.data.song || [];
      logger.info(`Retrieved ${songs.length} songs from Ampache`);
      return Array.isArray(songs) ? songs : [songs];
    } catch (error) {
      logger.error('Ampache getSongs error:', error.message);
      throw error;
    }
  }

  /**
   * Get videos from Ampache catalog
   * @param {Object} options - Query options
   * @param {number} options.offset - Pagination offset (default 0)
   * @param {number} options.limit - Items per page (default 50)
   * @returns {Promise<Array>} Array of video objects
   */
  static async getVideos({ offset = 0, limit = 50 } = {}) {
    try {
      const token = await this.getAuthToken();
      const resp = await axios.get(`${AMPACHE_BASE}/server/json.server.php`, {
        params: {
          action: 'videos',
          auth: token,
          offset: Math.max(0, +offset),
          limit: Math.min(+limit, 100) // Cap at 100
        },
        timeout: 10000
      });

      const videos = resp.data.video || [];
      logger.info(`Retrieved ${videos.length} videos from Ampache`);
      return Array.isArray(videos) ? videos : [videos];
    } catch (error) {
      logger.error('Ampache getVideos error:', error.message);
      throw error;
    }
  }

  /**
   * Get direct stream URL for a media item
   * @param {string} type - Media type: 'song' or 'video'
   * @param {string|number} id - Ampache item ID
   * @returns {Promise<string>} Stream URL
   */
  static async getStreamUrl(type, id) {
    try {
      const token = await this.getAuthToken();
      const streamUrl = `${AMPACHE_BASE}/server/json.server.php?action=stream&type=${type}&id=${id}&auth=${token}&format=mp3`;
      logger.debug(`Generated stream URL for ${type} ${id}`);
      return streamUrl;
    } catch (error) {
      logger.error('Ampache getStreamUrl error:', error.message);
      throw error;
    }
  }

  /**
   * Check Ampache server health
   * @returns {Promise<Object>} Ping response
   */
  static async ping() {
    try {
      const resp = await axios.get(`${AMPACHE_BASE}/server/json.server.php`, {
        params: { action: 'ping' },
        timeout: 5000
      });
      logger.info('✓ Ampache server ping successful');
      return resp.data;
    } catch (error) {
      logger.error('Ampache ping error:', error.message);
      throw error;
    }
  }

  /**
   * Clear cached session token (useful after auth failures)
   */
  static async clearTokenCache() {
    try {
      await cache.del('ampache:session_token');
      logger.info('Cleared Ampache session token cache');
    } catch (error) {
      logger.error('Error clearing Ampache token cache:', error.message);
    }
  }
}

module.exports = AmpacheService;
