const geoip = require('geoip-lite');
const SubscriberModel = require('../../../models/subscriberModel');
const PlanModel = require('../../../models/planModel');
const logger = require('../../../utils/logger');

/**
 * Subscription Controller - Handles ePayco subscription operations
 */
class SubscriptionController {
  /**
   * Get subscription plans with USD and COP prices
   * GET /api/subscription/plans
   */
  static async getPlans(req, res) {
    try {
      const allPlans = await PlanModel.getPublicPlans();

      // Country-aware filtering: Colombian IPs see ONLY pnp-col plans;
      // everyone else sees the regular catalog minus any pnp-col plans.
      const ip = req.headers['x-real-ip']
        || req.headers['x-forwarded-for']?.split(',')[0]?.trim()
        || req.ip;
      const geo = geoip.lookup(ip);
      const country = geo?.country || req.session?.user?.country || null;
      const isColombia = country === 'CO';

      // Colombia gate lifted 2026-05-24 — all users see the full catalog
      const plans = allPlans.filter((p) => p.tier !== 'pnp-col');

      res.json({
        success: true,
        plans,
        country,
        isColombia,
      });
    } catch (error) {
      logger.error('Error getting subscription plans:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get subscription plans',
      });
    }
  }

  /**
   * Get subscriber information
   * GET /api/subscription/subscriber/:identifier
   */
  static async getSubscriber(req, res) {
    try {
      const { identifier } = req.params;
      const { type = 'email' } = req.query;

      let subscriber;

      if (type === 'telegram') {
        subscriber = await SubscriberModel.getByTelegramId(identifier);
      } else {
        subscriber = await SubscriberModel.getByEmail(identifier);
      }

      if (!subscriber) {
        return res.status(404).json({
          success: false,
          error: 'Subscriber not found',
        });
      }

      res.json({
        success: true,
        subscriber,
      });
    } catch (error) {
      logger.error('Error getting subscriber:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get subscriber',
      });
    }
  }

  /**
   * Get subscription statistics
   * GET /api/subscription/stats
   */
  static async getStatistics(req, res) {
    try {
      const stats = await SubscriberModel.getStatistics();

      res.json({
        success: true,
        stats,
      });
    } catch (error) {
      logger.error('Error getting subscription statistics:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get statistics',
      });
    }
  }
}

module.exports = SubscriptionController;
