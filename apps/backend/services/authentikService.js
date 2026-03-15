const axios = require('axios');
const logger = require('../utils/logger');

const AUTHENTIK_URL = process.env.AUTHENTIK_URL || 'https://auth.pnptv.app';
const AUTHENTIK_TOKEN = process.env.AUTHENTIK_API_TOKEN;

class AuthentikService {
  /**
   * Sync a Telegram user with Authentik.
   * Ensures the user exists in Authentik and returns their UUID (sub).
   */
  static async syncTelegramUser(telegramUser) {
    if (!AUTHENTIK_TOKEN) {
      logger.error('AUTHENTIK_API_TOKEN is not configured');
      return null;
    }

    try {
      const telegramId = String(telegramUser.id);
      const username = telegramUser.username || `tg_${telegramId}`;
      const email = `${telegramId}@telegram.pnptv.app`; // Virtual email for Authentik

      // 1. Check if user exists in Authentik using a filter
      // Note: We use the telegram_id as a custom attribute or username in Authentik
      const searchRes = await axios.get(`${AUTHENTIK_URL}/api/v3/core/users/`, {
        params: { username: username },
        headers: { 'Authorization': `Bearer ${AUTHENTIK_TOKEN}` }
      });

      let authentikUser = searchRes.data.results.find(u => u.username === username);

      if (authentikUser) {
        logger.debug(`Found existing Authentik user: ${username}`);
        // Update user if needed (e.g., first_name changed)
        if (authentikUser.name !== telegramUser.first_name) {
          await axios.patch(`${AUTHENTIK_URL}/api/v3/core/users/${authentikUser.pk}/`, {
            name: telegramUser.first_name || username
          }, {
            headers: { 'Authorization': `Bearer ${AUTHENTIK_TOKEN}` }
          });
        }
      } else {
        logger.info(`Creating new Authentik user for Telegram ID: ${telegramId}`);
        // 2. Create user in Authentik
        const createRes = await axios.post(`${AUTHENTIK_URL}/api/v3/core/users/`, {
          username: username,
          name: telegramUser.first_name || username,
          email: email,
          type: 'internal',
          path: 'users/telegram',
          attributes: {
            telegram_id: telegramId
          }
        }, {
          headers: { 'Authorization': `Bearer ${AUTHENTIK_TOKEN}` }
        });
        authentikUser = createRes.data;
      }

      // Authentik 'pk' is the UUID if configured correctly, or we might need to get the 'sub'
      // In Authentik v3, 'pk' is often the ID, and 'uuid' is also available.
      return authentikUser.uuid || authentikUser.pk;

    } catch (error) {
      logger.error('Error syncing user with Authentik:', error.response?.data || error.message);
      return null;
    }
  }

  /**
   * Trigger a password reset flow in Authentik for the given email.
   * This sends an email to the user with a recovery link.
   */
  static async requestPasswordReset(email) {
    if (!AUTHENTIK_TOKEN) {
      logger.error('AUTHENTIK_API_TOKEN is not configured');
      return { success: false, error: 'Identity provider not configured' };
    }

    try {
      // Find user by email in Authentik
      const searchRes = await axios.get(`${AUTHENTIK_URL}/api/v3/core/users/`, {
        params: { email: email },
        headers: { 'Authorization': `Bearer ${AUTHENTIK_TOKEN}` }
      });

      const authentikUser = searchRes.data.results.find(u => u.email.toLowerCase() === email.toLowerCase());

      if (!authentikUser) {
        return { success: false, error: 'User not found' };
      }

      // Trigger recovery flow (requires a configured recovery flow in Authentik)
      // Note: This API endpoint depends on Authentik configuration.
      // Usually POST to /api/v3/flows/executor/recovery/
      await axios.post(`${AUTHENTIK_URL}/api/v3/flows/executor/recovery/`, {
        email: email
      }, {
        headers: { 'Authorization': `Bearer ${AUTHENTIK_TOKEN}` }
      });

      return { success: true };
    } catch (error) {
      logger.error('Error requesting Authentik password reset:', error.response?.data || error.message);
      return { success: false, error: 'Failed to trigger recovery flow' };
    }
  }
}

module.exports = AuthentikService;
