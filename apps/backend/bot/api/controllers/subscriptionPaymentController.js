const SubscriptionModel = require('../../../models/subscriptionModel');
const SubscriptionService = require('../../../services/subscriptionService');
const { query } = require('../../../config/postgres');
const logger = require('../../../utils/logger');

/**
 * Subscription Payment Controller
 * Handles subscription checkout and processing
 */
class SubscriptionPaymentController {
  /**
   * Get subscription plans for user
   */
  static async getPlans(req, res) {
    try {
      const { role } = req.query;

      if (!role) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_INPUT',
            message: 'Role is required',
          },
        });
      }

      const plans = await SubscriptionModel.getPlansByRole(role);

      res.json({
        success: true,
        data: {
          plans,
          count: plans.length,
        },
      });
    } catch (error) {
      logger.error('Error in getPlans:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch plans',
        },
      });
    }
  }

  /**
   * Get user's current subscription
   */
  static async getMySubscription(req, res) {
    try {
      const userId = req.session?.user?.id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required',
          },
        });
      }

      const subscription = await SubscriptionService.getSubscriptionDetails(userId);

      res.json({
        success: true,
        data: {
          subscription,
          hasActiveSubscription: subscription !== null,
        },
      });
    } catch (error) {
      logger.error('Error in getMySubscription:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch subscription',
        },
      });
    }
  }

  /**
   * Create checkout session for subscription
   * Card checkout via this controller has been retired. Use the main webapp
   * /subscribe page which supports ePayco and Dash (BTCPay).
   */
  static async createCheckout(req, res) {
    return res.status(410).json({
      success: false,
      error: 'Card checkout via this endpoint has been retired. Please use the web app at https://pnptv.app/subscribe.',
      code: 'CHECKOUT_RETIRED',
    });
  }

  /**
   * Cancel user's subscription
   */
  static async cancelSubscription(req, res) {
    try {
      const userId = req.session?.user?.id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required',
          },
        });
      }

      const cancelled = await SubscriptionService.cancelSubscription(userId);

      res.json({
        success: true,
        data: {
          subscription: cancelled,
          message: 'Subscription cancelled successfully',
        },
      });
    } catch (error) {
      logger.error('Error in cancelSubscription:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: error.message || 'Failed to cancel subscription',
        },
      });
    }
  }

  /**
   * Get payment history
   */
  static async getPaymentHistory(req, res) {
    try {
      const userId = req.session?.user?.id;
      const { limit = 20, offset = 0 } = req.query;

      if (!userId) {
        return res.status(401).json({
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required',
          },
        });
      }

      const result = await query(
        `SELECT id, reference, amount, currency, provider, status, created_at
         FROM payments
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT $2 OFFSET $3`,
        [userId, parseInt(limit), parseInt(offset)]
      );

      res.json({
        success: true,
        data: {
          payments: result.rows,
          count: result.rows.length,
        },
      });
    } catch (error) {
      logger.error('Error in getPaymentHistory:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch payment history',
        },
      });
    }
  }

  /**
   * Validate subscription eligibility for feature
   */
  static async checkFeatureAccess(req, res) {
    try {
      const userId = req.session?.user?.id;
      const { feature } = req.query;

      if (!userId) {
        return res.status(401).json({
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required',
          },
        });
      }

      if (!feature) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_INPUT',
            message: 'Feature name is required',
          },
        });
      }

      const hasAccess = await SubscriptionService.hasFeatureAccess(userId, feature);

      res.json({
        success: true,
        data: {
          hasAccess,
          feature,
        },
      });
    } catch (error) {
      logger.error('Error in checkFeatureAccess:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to check feature access',
        },
      });
    }
  }
}

module.exports = SubscriptionPaymentController;
