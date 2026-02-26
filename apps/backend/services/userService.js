const logger = require('../utils/logger');
const UserModel = require('../models/userModel');

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
        // Ensure onboardingComplete is false for new users
        user = await UserModel.createOrUpdate({
          id: userId,
          ...userData,
          onboardingComplete: false,
          status: 'online', // Default status for new users
        });
      } else {
        // Optionally update existing user's basic info if needed, e.g., username change
        // For simplicity, we'll only update status if it's not already online or active
        if (user.status === 'offline') {
          user = await UserModel.createOrUpdate({ id: userId, status: 'online' });
        }
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
      
      const user = await UserModel.getById(userId); // Use getById
      return user && user.subscriptionStatus === 'active';
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
}

module.exports = new UserService();
