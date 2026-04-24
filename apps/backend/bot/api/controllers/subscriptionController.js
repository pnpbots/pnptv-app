const geoip = require('geoip-lite');
const { getEpaycoClient } = require('../../../config/epayco');
const SubscriberModel = require('../../../models/subscriberModel');
const PlanModel = require('../../../models/planModel');
const CurrencyConverter = require('../../../utils/currencyConverter');
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

      const plans = isColombia
        ? allPlans.filter((p) => p.tier === 'pnp-col')
        : allPlans.filter((p) => p.tier !== 'pnp-col');

      // Add currency conversion for each plan
      const plansWithPrices = await Promise.all(
        plans.map(async (plan) => {
          const prices = await CurrencyConverter.getDisplayAmounts(plan.price, plan.currency);
          return {
            ...plan,
            priceUSD: prices.usd,
            priceCOP: prices.cop,
            exchangeRate: prices.rate,
          };
        }),
      );

      res.json({
        success: true,
        plans: plansWithPrices,
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
   * Create or get ePayco plan
   * POST /api/subscription/create-plan
   */
  static async createEpaycoPlan(req, res) {
    try {
      const { planId } = req.body;

      if (!planId) {
        return res.status(400).json({
          success: false,
          error: 'planId is required',
        });
      }

      // Get plan details from database
      const plan = await PlanModel.getById(planId);
      if (!plan) {
        return res.status(404).json({
          success: false,
          error: 'Plan not found',
        });
      }

      // Convert price to COP if in USD
      let amountCOP = plan.price;
      if (plan.currency === 'USD') {
        amountCOP = await CurrencyConverter.usdToCop(plan.price);
      }

      const epayco = getEpaycoClient();

      // Create plan in ePayco
      const planInfo = {
        id_plan: `pnptv_${planId}`,
        name: plan.name,
        description: plan.description || `PNPtv ${plan.name} Plan`,
        amount: amountCOP,
        currency: 'cop',
        interval: 'month',
        interval_count: 1,
        trial_days: plan.trialDays || 0,
      };

      const epaycoResponse = await epayco.plans.create(planInfo);

      logger.info('ePayco plan created', { planId, epaycoPlanId: planInfo.id_plan });

      res.json({
        success: true,
        plan: epaycoResponse,
      });
    } catch (error) {
      logger.error('Error creating ePayco plan:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to create plan',
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
