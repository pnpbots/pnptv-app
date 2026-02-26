const logger = require('../utils/logger');
const { query } = require('../utils/db');

/**
 * MeruLinkService - Manages Meru payment links and tracks their usage
 * Prevents duplicate payments and sales loss by marking links as invalid when used
 */
class MeruLinkService {
  /**
   * Mark a Meru link as used/invalidated
   * This prevents the same link from being used again in the randomizer
   * @param {string} meruCode - The code extracted from the Meru link (e.g., "daq_Ak")
   * @param {string} userId - The user who activated this link
   * @param {string} username - The username of the user
   * @returns {Promise<{success: boolean, message: string}>}
   */
  async invalidateLinkAfterActivation(meruCode, userId, username) {
    try {
      const result = await query(
        `UPDATE meru_payment_links
         SET status = 'used',
             used_by = $2,
             used_by_username = $3,
             used_at = NOW()
         WHERE code = $1 AND status = 'active'
         RETURNING id, code, meru_link`,
        [meruCode, userId, username]
      );

      if (result.rows.length === 0) {
        logger.warn('Meru link not found or already used', { code: meruCode, userId });
        return {
          success: false,
          message: 'Link not found or already used',
        };
      }

      const link = result.rows[0];
      logger.info('Meru link invalidated after activation', {
        code: meruCode,
        linkId: link.id,
        userId,
        username,
      });

      return {
        success: true,
        message: 'Link invalidated and marked as used',
        link,
      };
    } catch (error) {
      logger.error('Error invalidating Meru link:', error);
      return {
        success: false,
        message: `Error: ${error.message}`,
      };
    }
  }

  /**
   * Get all active/available Meru links for randomizer
   * Excludes used, expired, or invalid links
   * @param {string} product - Product type (default: 'lifetime-pass')
   * @returns {Promise<Array>}
   */
  async getAvailableLinks(product = 'lifetime-pass') {
    try {
      const result = await query(
        `SELECT id, code, meru_link, product, status, created_at
         FROM meru_payment_links
         WHERE status = 'active' AND product = $1
         ORDER BY created_at ASC`,
        [product]
      );

      return result.rows;
    } catch (error) {
      logger.error('Error fetching available Meru links:', error);
      return [];
    }
  }

  /**
   * Get a random available link for new users
   * @param {string} product - Product type (default: 'lifetime-pass')
   * @returns {Promise<{code: string, meru_link: string} | null>}
   */
  async getRandomAvailableLink(product = 'lifetime-pass') {
    try {
      const result = await query(
        `SELECT code, meru_link FROM meru_payment_links
         WHERE status = 'active' AND product = $1
         ORDER BY RANDOM()
         LIMIT 1`,
        [product]
      );

      return result.rows[0] || null;
    } catch (error) {
      logger.error('Error getting random Meru link:', error);
      return null;
    }
  }

  /**
   * Get link statistics
   * @returns {Promise<Object>}
   */
  async getLinkStatistics() {
    try {
      const result = await query(
        `SELECT
           COUNT(*) as total,
           COUNT(CASE WHEN status = 'active' THEN 1 END) as active,
           COUNT(CASE WHEN status = 'used' THEN 1 END) as used,
           COUNT(CASE WHEN status = 'expired' THEN 1 END) as expired,
           COUNT(CASE WHEN status = 'invalid' THEN 1 END) as invalid
         FROM meru_payment_links`
      );

      return result.rows[0];
    } catch (error) {
      logger.error('Error fetching Meru link statistics:', error);
      return {
        total: 0,
        active: 0,
        used: 0,
        expired: 0,
        invalid: 0,
      };
    }
  }

  /**
   * Mark a link as expired (e.g., if Meru confirms it's expired)
   * @param {string} meruCode - The code to expire
   * @param {string} reason - Reason for expiration
   * @returns {Promise<boolean>}
   */
  async expireLink(meruCode, reason = 'Payment link expired') {
    try {
      const result = await query(
        `UPDATE meru_payment_links
         SET status = 'expired',
             invalidated_at = NOW(),
             invalidation_reason = $2
         WHERE code = $1
         RETURNING code`,
        [meruCode, reason]
      );

      if (result.rows.length > 0) {
        logger.info('Meru link marked as expired', { code: meruCode, reason });
        return true;
      }

      return false;
    } catch (error) {
      logger.error('Error expiring Meru link:', error);
      return false;
    }
  }

  /**
   * Invalidate a link manually (admin action)
   * @param {string} meruCode - The code to invalidate
   * @param {string} reason - Reason for invalidation
   * @returns {Promise<boolean>}
   */
  async invalidateLink(meruCode, reason = 'Manually invalidated') {
    try {
      const result = await query(
        `UPDATE meru_payment_links
         SET status = 'invalid',
             invalidated_at = NOW(),
             invalidation_reason = $2
         WHERE code = $1
         RETURNING code`,
        [meruCode, reason]
      );

      if (result.rows.length > 0) {
        logger.info('Meru link invalidated', { code: meruCode, reason });
        return true;
      }

      return false;
    } catch (error) {
      logger.error('Error invalidating Meru link:', error);
      return false;
    }
  }

  /**
   * Add a new Meru link to the system
   * @param {string} meruCode - The code from the link
   * @param {string} meruLink - Full Meru payment link
   * @param {string} product - Product type
   * @returns {Promise<boolean>}
   */
  async addLink(meruCode, meruLink, product = 'lifetime-pass') {
    try {
      await query(
        `INSERT INTO meru_payment_links (code, meru_link, product, status)
         VALUES ($1, $2, $3, 'active')
         ON CONFLICT (code) DO UPDATE SET status = 'active'`,
        [meruCode, meruLink, product]
      );

      logger.info('Meru link added to system', { code: meruCode, product });
      return true;
    } catch (error) {
      logger.error('Error adding Meru link:', error);
      return false;
    }
  }
}

module.exports = new MeruLinkService();
