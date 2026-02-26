const logger = require('../../../utils/logger');
const UserModel = require('../../../models/userModel');
const { query } = require('../../../config/postgres');

/**
 * User Management Controller
 * Simple API endpoints for modifying user subscriptions
 * No admin authentication required for quick operations
 */
class UserManagementController {
  /**
   * GET /api/users/:userId/status
   * Get user subscription status
   */
  static async getStatus(req, res) {
    try {
      const { userId } = req.params;

      const user = await UserModel.getById(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'User not found',
          userId
        });
      }

      return res.json({
        success: true,
        user: {
          id: user.id,
          username: user.username,
          firstName: user.firstName,
          tier: user.tier,
          subscriptionStatus: user.subscriptionStatus,
          planId: user.planId,
          planExpiry: user.planExpiry,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt
        }
      });
    } catch (error) {
      logger.error('Error getting user status:', error);
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * POST /api/users/:userId/downgrade
   * Downgrade user from PRIME to FREE
   *
   * Body: {}
   */
  static async downgradeToFree(req, res) {
    try {
      const { userId } = req.params;

      const user = await UserModel.getById(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'User not found',
          userId
        });
      }

      // Check if already FREE
      if ((user.tier || '').toLowerCase() === 'free' && user.subscriptionStatus === 'free') {
        return res.status(400).json({
          success: false,
          error: 'User is already in FREE tier',
          currentTier: user.tier,
          currentStatus: user.subscriptionStatus
        });
      }

      // Update subscription to FREE
      const result = await UserModel.updateSubscription(userId, {
        status: 'free',
        planId: null,
        expiry: null
      });

      if (!result) {
        throw new Error('Failed to update subscription');
      }

      // Verify update
      const updatedUser = await UserModel.getById(userId);

      logger.info('User downgraded to FREE', {
        userId,
        previousTier: user.tier,
        newTier: updatedUser.tier,
        timestamp: new Date().toISOString()
      });

      return res.json({
        success: true,
        message: 'User successfully downgraded to FREE',
        user: {
          id: updatedUser.id,
          username: updatedUser.username,
          previousTier: user.tier,
          newTier: updatedUser.tier,
          tier: updatedUser.tier,
          subscriptionStatus: updatedUser.subscriptionStatus,
          planId: updatedUser.planId,
          planExpiry: updatedUser.planExpiry
        }
      });
    } catch (error) {
      logger.error('Error downgrading user to FREE:', error);
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * POST /api/users/:userId/upgrade-prime
   * Upgrade user to PRIME
   *
   * Body: {
   *   planId: "plan-id",
   *   expiryDate: "2026-03-13" (optional)
   * }
   */
  static async upgradeToPrime(req, res) {
    try {
      const { userId } = req.params;
      const { planId, expiryDate } = req.body;

      if (!planId) {
        return res.status(400).json({
          success: false,
          error: 'planId is required'
        });
      }

      const user = await UserModel.getById(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'User not found',
          userId
        });
      }

      // Calculate expiry if not provided
      let expiry = expiryDate;
      if (!expiry) {
        const now = new Date();
        const expiryDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days
        expiry = expiryDate.toISOString().split('T')[0];
      }

      // Update subscription to PRIME
      const result = await UserModel.updateSubscription(userId, {
        status: 'active',
        planId: planId,
        expiry: expiry
      });

      if (!result) {
        throw new Error('Failed to update subscription');
      }

      // Verify update
      const updatedUser = await UserModel.getById(userId);

      logger.info('User upgraded to PRIME', {
        userId,
        planId,
        expiry,
        timestamp: new Date().toISOString()
      });

      return res.json({
        success: true,
        message: 'User successfully upgraded to PRIME',
        user: {
          id: updatedUser.id,
          username: updatedUser.username,
          previousTier: user.tier,
          newTier: updatedUser.tier,
          tier: updatedUser.tier,
          subscriptionStatus: updatedUser.subscriptionStatus,
          planId: updatedUser.planId,
          planExpiry: updatedUser.planExpiry
        }
      });
    } catch (error) {
      logger.error('Error upgrading user to PRIME:', error);
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * POST /api/users/:userId/reset-subscription
   * Reset subscription status (used for payment issues)
   *
   * Body: {
   *   reason: "payment_failed" | "manual_reset" | "testing"
   * }
   */
  static async resetSubscription(req, res) {
    try {
      const { userId } = req.params;
      const { reason = 'manual_reset' } = req.body;

      const user = await UserModel.getById(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'User not found',
          userId
        });
      }

      // Reset to FREE
      const result = await UserModel.updateSubscription(userId, {
        status: 'free',
        planId: null,
        expiry: null
      });

      if (!result) {
        throw new Error('Failed to reset subscription');
      }

      const updatedUser = await UserModel.getById(userId);

      logger.info('User subscription reset', {
        userId,
        reason,
        previousTier: user.tier,
        previousStatus: user.subscriptionStatus,
        newTier: updatedUser.tier,
        newStatus: updatedUser.subscriptionStatus,
        timestamp: new Date().toISOString()
      });

      return res.json({
        success: true,
        message: `Subscription reset (reason: ${reason})`,
        user: {
          id: updatedUser.id,
          username: updatedUser.username,
          tier: updatedUser.tier,
          subscriptionStatus: updatedUser.subscriptionStatus,
          planId: updatedUser.planId,
          planExpiry: updatedUser.planExpiry
        }
      });
    } catch (error) {
      logger.error('Error resetting subscription:', error);
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * POST /api/users/:userId/activate-payment
   * Manually activate a payment/subscription
   * Used when webhook fails
   *
   * Body: {
   *   planId: "plan-id",
   *   transactionId: "trans-123",
   *   amount: 10.00
   * }
   */
  static async activatePayment(req, res) {
    try {
      const { userId } = req.params;
      const { planId, transactionId, amount } = req.body;

      if (!planId) {
        return res.status(400).json({
          success: false,
          error: 'planId is required'
        });
      }

      const user = await UserModel.getById(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'User not found',
          userId
        });
      }

      // Calculate expiry (30 days)
      const expiryDate = new Date();
      expiryDate.setDate(expiryDate.getDate() + 30);
      const expiry = expiryDate.toISOString().split('T')[0];

      // Activate subscription
      const result = await UserModel.updateSubscription(userId, {
        status: 'active',
        planId: planId,
        expiry: expiry
      });

      if (!result) {
        throw new Error('Failed to activate subscription');
      }

      const updatedUser = await UserModel.getById(userId);

      logger.info('Payment manually activated', {
        userId,
        planId,
        transactionId,
        amount,
        expiry,
        timestamp: new Date().toISOString()
      });

      return res.json({
        success: true,
        message: 'Payment manually activated and subscription activated',
        user: {
          id: updatedUser.id,
          username: updatedUser.username,
          tier: updatedUser.tier,
          subscriptionStatus: updatedUser.subscriptionStatus,
          planId: updatedUser.planId,
          planExpiry: updatedUser.planExpiry
        }
      });
    } catch (error) {
      logger.error('Error activating payment:', error);
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
}

module.exports = UserManagementController;
