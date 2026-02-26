const UserModel = require('../../models/userModel');
const logger = require('../../utils/logger');

/**
 * Subscription Service - Handles subscription and trial management
 */
class SubscriptionService {
  /**
   * Add free trial days to a user's subscription
   * @param {number|string} userId - User ID
   * @param {number} days - Number of trial days
   * @param {string} reason - Reason for the trial (e.g., 'legend_of_the_day')
   * @returns {Promise<Object>} Result with success status
   */
  static async addFreeTrial(userId, days, reason = 'free_trial') {
    try {
      const user = await UserModel.getById(userId);

      if (!user) {
        return { success: false, error: 'User not found' };
      }

      // Calculate new expiry date
      const currentExpiry = user.plan_expiry ? new Date(user.plan_expiry) : new Date();
      const now = new Date();

      // If current subscription is expired, start from now; otherwise extend from current expiry
      const baseDate = currentExpiry > now ? currentExpiry : now;
      const newExpiry = new Date(baseDate);
      newExpiry.setDate(newExpiry.getDate() + days);

      // Update user subscription to active/prime with new expiry
      await UserModel.updateSubscription(userId, {
        status: 'active',
        planId: 'trial',
        expiry: newExpiry
      });

      logger.info('Free trial added to user', {
        userId,
        days,
        reason,
        newExpiry: newExpiry.toISOString()
      });

      return {
        success: true,
        newExpiry: newExpiry,
        daysAdded: days,
        reason
      };
    } catch (error) {
      logger.error('Error adding free trial:', {
        userId,
        days,
        reason,
        error: error.message
      });
      return { success: false, error: error.message };
    }
  }

  /**
   * Check if user has active subscription
   * @param {number|string} userId - User ID
   * @returns {Promise<boolean>} True if subscription is active
   */
  static async hasActiveSubscription(userId) {
    try {
      const user = await UserModel.getById(userId);
      if (!user) return false;

      const now = new Date();
      const expiry = user.plan_expiry ? new Date(user.plan_expiry) : null;

      return (user.tier || '').toLowerCase() === 'prime' && expiry && expiry > now;
    } catch (error) {
      logger.error('Error checking subscription status:', { userId, error: error.message });
      return false;
    }
  }
}

module.exports = SubscriptionService;
