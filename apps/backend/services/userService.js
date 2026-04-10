const logger = require('../utils/logger');
const UserModel = require('../models/userModel');
const { query } = require('../config/postgres');

/**
 * Helper to check if user is admin/superadmin from env vars
 * @param {string|number} userId - User ID
 * @returns {boolean}
 */
function isEnvAdminOrSuperAdmin(userId) {
  const superAdminId = process.env.ADMIN_ID?.trim();
  const adminIds = (process.env.ADMIN_USER_IDS || '').split(',').map(id => id.trim()).filter(id => id);
  const userIdStr = String(userId);
  return (superAdminId && userIdStr === superAdminId) || adminIds.includes(userIdStr);
}

/**
 * User Service - Handles user-related operations
 */
class UserService {
  /**
   * Get or create user
   * @param {string|number} userId - Telegram user ID
   * @param {Object.<string, *>} userData - Initial user data if creating
   * @returns {Promise<Object>} User object
   */
  async getOrCreateUser(userId, userData) {
    try {
      let user = await UserModel.getById(userId);
      if (!user) {
        logger.info('User not found, creating new user', { userId });
        user = await UserModel.createOrUpdate({
          id: userId,
          ...userData,
          onboardingComplete: false,
        });
      }
      return user;
    } catch (error) {
      logger.error('Error in getOrCreateUser:', error);
      throw error;
    }
  }

  /**
   * Get user by ID
   * @param {string|number} userId - Telegram user ID
   * @returns {Promise<Object|null>} User object or null
   */
  async getUser(userId) {
    try {
      return await UserModel.getById(userId);
    } catch (error) {
      logger.error('Error getting user:', error);
      return null;
    }
  }

  /**
   * Update user
   * @param {string|number} userId - Telegram user ID
   * @param {Object.<string, *>} updates - Fields to update
   * @returns {Promise<Object|null>} Updated user object or null
   */
  async updateUser(userId, updates) {
    try {
      await UserModel.updateProfile(userId, updates);
      // After update, fetch the latest user data to return
      const updatedUser = await UserModel.getById(userId);
      logger.info('User updated', { userId, updates });
      return updatedUser;
    } catch (error) {
      logger.error('Error updating user:', error);
      return null;
    }
  }

  /**
   * Get user by email
   * @param {string} email - Email address
   * @returns {Promise<Object|null>} User object or null
   */
  async getByEmail(email) {
    try {
      return await UserModel.getByEmail(email);
    } catch (error) {
      logger.error('Error getting user by email:', error);
      return null;
    }
  }

  /**
   * Check if user is premium
   * Admin/SuperAdmin users ALWAYS have access (bypass premium check)
   * @param {string|number} userId - Telegram user ID
   * @returns {Promise<boolean>}
   */
  async isPremium(userId) {
    try {
      // BYPASS: Admin and SuperAdmin always have premium access
      if (isEnvAdminOrSuperAdmin(userId)) {
        logger.debug('Admin/SuperAdmin bypass: premium check skipped', { userId });
        return true;
      }
      
      const user = await UserModel.getById(userId);
      return user && (user.tier || '').toLowerCase() === 'prime';
    } catch (error) {
      logger.error('Error checking premium status:', error);
      return false;
    }
  }

  /**
   * Check if user is admin
   * @param {string|number} userId - Telegram user ID
   * @returns {Promise<boolean>}
   */
  async isAdmin(userId) {
    try {
      const adminIds = (process.env.ADMIN_USER_IDS || '').split(',').map(id => id.trim());
      return adminIds.includes(String(userId));
    } catch (error) {
      logger.error('Error checking admin status:', error);
      return false;
    }
  }

  /**
   * Get user subscription
   * @param {string|number} userId - Telegram user ID
   * @returns {Promise<Object|null>}
   */
  async getUserSubscription(userId) {
    try {
      const user = await UserModel.getById(userId); // Use getById
      if (!user) return null;

      return {
        status: user.subscriptionStatus,
        planId: user.planId,
        expiryDate: user.subscriptionExpiry,
        autoRenew: user.autoRenew,
      };
    } catch (error) {
      logger.error('Error getting user subscription:', error);
      return null;
    }
  }

  /**
   * Record user activity
   * @param {string|number} userId - Telegram user ID
   * @param {string} action - Action name
   * @param {Object} metadata - Additional data
   * @returns {Promise<boolean>}
   */
  async recordActivity(userId, action, metadata = {}) {
    try {
      logger.info('User activity recorded', {
        userId,
        action,
        metadata,
      });
      return true;
    } catch (error) {
      logger.error('Error recording activity:', error);
      return false;
    }
  }

  /**
   * Calculate a user's activity score.
   * Score = posts*3 + DMs(30d) + chat_messages(30d)
   */
  async getActivityScore(userId) {
    const { rows } = await query(
      `SELECT
         (SELECT COUNT(*) FROM social_posts WHERE user_id = $1 AND is_deleted = false) * 3 +
         (SELECT COUNT(*) FROM direct_messages WHERE sender_id = $1 AND created_at > NOW() - INTERVAL '30 days') +
         (SELECT COUNT(*) FROM chat_messages WHERE user_id = $1 AND created_at > NOW() - INTERVAL '30 days') AS score`,
      [String(userId)]
    );
    return Number(rows[0]?.score || 0);
  }

  /**
   * Get the top-10% activity score threshold (among users with score > 0).
   */
  async getTop10PctThreshold() {
    const { rows } = await query(
      `WITH active_scores AS (
         SELECT
           (SELECT COUNT(*) FROM social_posts WHERE user_id = u.id::text AND is_deleted = false) * 3 +
           (SELECT COUNT(*) FROM direct_messages WHERE sender_id = u.id::text AND created_at > NOW() - INTERVAL '30 days') +
           (SELECT COUNT(*) FROM chat_messages WHERE user_id = u.id::text AND created_at > NOW() - INTERVAL '30 days') AS score
         FROM users u
         WHERE u.is_deleted = false AND u.role NOT IN ('blocked','system')
       )
       SELECT COALESCE(PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY score), 1) AS threshold
       FROM active_scores
       WHERE score > 0`
    );
    return Math.max(Number(rows[0]?.threshold || 1), 1);
  }

  /**
   * Check whether a user meets performer eligibility:
   *  1. Has a profile picture
   *  2. Activity score is in the top 10% of active users
   * Returns { eligible, reasons[] }
   */
  async checkPerformerEligibility(userId) {
    const reasons = [];

    const { rows } = await query(
      `SELECT photo_file_id FROM users WHERE id = $1 AND is_deleted = false`,
      [String(userId)]
    );
    if (rows.length === 0) return { eligible: false, reasons: ['user_not_found'] };

    const hasPhoto = rows[0].photo_file_id && rows[0].photo_file_id.trim() !== '';
    if (!hasPhoto) reasons.push('no_profile_picture');

    const [score, threshold] = await Promise.all([
      this.getActivityScore(userId),
      this.getTop10PctThreshold(),
    ]);

    if (score < threshold) {
      reasons.push(`activity_too_low`);
    }

    return { eligible: reasons.length === 0, reasons, score, threshold };
  }

  /**
   * Revoke performers who no longer meet eligibility criteria.
   * Returns { revoked: string[], kept: string[] }
   */
  async enforcePerformerEligibility() {
    const { rows: creators } = await query(
      `SELECT id, username FROM users WHERE role = 'creator' AND is_deleted = false`
    );

    const threshold = await this.getTop10PctThreshold();
    const revoked = [];
    const kept = [];

    for (const creator of creators) {
      const { eligible, reasons, score } = await this.checkPerformerEligibility(creator.id);
      if (!eligible) {
        await query(`UPDATE users SET role = 'user' WHERE id = $1`, [creator.id]);
        revoked.push({ id: creator.id, username: creator.username, score, threshold, reasons });
        logger.info('Performer revoked — eligibility failed', { userId: creator.id, username: creator.username, score, threshold, reasons });
      } else {
        kept.push({ id: creator.id, username: creator.username, score });
      }
    }

    return { revoked, kept, threshold };
  }
}

module.exports = new UserService();
