/**
 * Promo Service
 * Business logic for promotional offers
 */

const PromoModel = require('../../models/promoModel');
const PlanModel = require('../../models/planModel');
const PaymentModel = require('../../models/paymentModel');
const UserModel = require('../../models/userModel');
const DaimoConfig = require('../../config/daimo');
const logger = require('../../utils/logger');

class PromoService {
  /**
   * Get full promo details for display (with eligibility check)
   */
  static async getPromoForUser(promoCode, userId) {
    try {
      const promo = await PromoModel.getByCode(promoCode);

      if (!promo) {
        return { success: false, error: 'not_found', message: 'Promo not found' };
      }

      if (!PromoModel.isPromoValid(promo)) {
        // Determine specific reason
        if (!promo.active) {
          return { success: false, error: 'inactive', message: 'This promo is no longer active' };
        }
        if (promo.validUntil && new Date(promo.validUntil) < new Date()) {
          return { success: false, error: 'expired', message: 'This promo has expired' };
        }
        if (promo.maxSpots !== null && promo.currentSpotsUsed >= promo.maxSpots) {
          return { success: false, error: 'sold_out', message: 'All promo spots have been claimed' };
        }
        return { success: false, error: 'invalid', message: 'This promo is not available' };
      }

      // Check user eligibility
      const eligibility = await PromoModel.isUserEligible(promo, userId);
      if (!eligibility.eligible) {
        const messages = {
          already_redeemed: 'You have already claimed this promo',
          not_churned: 'This promo is only for returning members',
          not_new_user: 'This promo is only for new users',
          not_free_user: 'This promo is only for free users',
          user_not_found: 'User not found',
        };
        return {
          success: false,
          error: eligibility.reason,
          message: messages[eligibility.reason] || 'You are not eligible for this promo'
        };
      }

      // Calculate pricing (skip for any-plan promos)
      const pricing = PromoModel.isAnyPlanPromo(promo)
        ? null
        : await PromoModel.calculatePrice(promo);

      // Calculate remaining spots
      const remainingSpots = promo.maxSpots !== null
        ? promo.maxSpots - promo.currentSpotsUsed
        : null;

      return {
        success: true,
        promo,
        pricing,
        remainingSpots,
        basePlan: pricing?.basePlan || null,
      };
    } catch (error) {
      logger.error('Error getting promo for user:', error);
      return { success: false, error: 'internal', message: 'An error occurred' };
    }
  }

  /**
   * Initiate promo payment flow
   */
  static async initiatePromoPayment(promoCode, userId, provider, chatId = null, planIdOverride = null) {
    try {
      // Get promo and validate
      const promoDetails = await this.getPromoForUser(promoCode, userId);
      if (!promoDetails.success) {
        return promoDetails;
      }

      const { promo } = promoDetails;
      const isAnyPlan = PromoModel.isAnyPlanPromo(promo);
      const planId = isAnyPlan ? planIdOverride : promo.basePlanId;

      if (isAnyPlan && !planId) {
        return { success: false, error: 'missing_plan', message: 'Plan is required for this promo' };
      }

      const basePlan = await PlanModel.getById(planId);
      if (!basePlan || basePlan.active === false) {
        return { success: false, error: 'plan_not_found', message: 'Plan not found' };
      }

      const pricing = PromoModel.calculatePriceForPlan(promo, basePlan);

      // Claim spot atomically
      const claimResult = await PromoModel.claimSpot(promo.id, userId, pricing);
      if (!claimResult.success) {
        const messages = {
          promo_not_valid: 'This promo is no longer available',
          already_claimed: 'You have already claimed this promo',
          internal_error: 'An error occurred claiming the spot',
        };
        return {
          success: false,
          error: claimResult.error,
          message: messages[claimResult.error] || 'Failed to claim promo'
        };
      }

      // Create payment with promo pricing
      const checkoutDomain = process.env.CHECKOUT_DOMAIN || process.env.BOT_WEBHOOK_DOMAIN || 'https://easybots.site';

      const payment = await PaymentModel.create({
        userId: userId.toString(),
        planId,
        provider,
        sku: basePlan.sku,
        amount: pricing.finalPrice,
        currency: basePlan.currency || 'USD',
        status: 'pending',
        metadata: {
          promoId: promo.id,
          promoCode: promo.code,
          redemptionId: claimResult.redemption.id,
          originalPrice: pricing.originalPrice,
          discountAmount: pricing.discountAmount,
        },
      });

      let paymentUrl;

      if (provider === 'epayco') {
        // Direct tokenized checkout page with promo metadata
        paymentUrl = `${checkoutDomain}/payment/${payment.id}?promo=${promo.code}`;
        await PaymentModel.updateStatus(payment.id, 'pending', {
          paymentUrl,
          provider,
          fallback: true,
        });
      } else if (provider === 'daimo') {
        // Create Daimo payment with promo price
        try {
          const daimoResult = await DaimoConfig.createDaimoPayment({
            amount: pricing.finalPrice,
            userId,
            planId,
            chatId,
            paymentId: payment.id,
            description: `${promo.name} - ${basePlan.name || basePlan.display_name}`,
          });

          if (daimoResult.success && daimoResult.paymentUrl) {
            paymentUrl = daimoResult.paymentUrl;
            await PaymentModel.updateStatus(payment.id, 'pending', {
              paymentUrl,
              provider,
              daimo_payment_id: daimoResult.daimoPaymentId,
            });
          } else {
            throw new Error(daimoResult.error || 'Daimo payment creation failed');
          }
        } catch (daimoError) {
          logger.error('Daimo API error for promo, using fallback:', {
            error: daimoError.message,
            paymentId: payment.id,
          });
          paymentUrl = `${checkoutDomain}/daimo-checkout/${payment.id}?promo=${promo.code}`;
          await PaymentModel.updateStatus(payment.id, 'pending', {
            paymentUrl,
            provider,
            fallback: true,
          });
        }
      } else {
        paymentUrl = `${checkoutDomain}/payment/${payment.id}?promo=${promo.code}`;
      }

      logger.info('Promo payment initiated', {
        promoCode: promo.code,
        userId,
        provider,
        paymentId: payment.id,
        finalPrice: pricing.finalPrice,
      });

      return {
        success: true,
        paymentUrl,
        paymentId: payment.id,
        redemptionId: claimResult.redemption.id,
        finalPrice: pricing.finalPrice,
        promo,
      };
    } catch (error) {
      logger.error('Error initiating promo payment:', error);
      return { success: false, error: 'internal', message: 'An error occurred' };
    }
  }

  /**
   * Complete promo redemption (called after payment success)
   */
  static async completePromoRedemption(redemptionId, paymentId) {
    try {
      const redemption = await PromoModel.completeRedemption(redemptionId, paymentId);
      if (!redemption) {
        logger.error('Failed to complete promo redemption', { redemptionId, paymentId });
        return false;
      }

      logger.info('Promo redemption completed', {
        redemptionId,
        paymentId,
        userId: redemption.user_id,
        finalPrice: redemption.final_price,
      });

      return true;
    } catch (error) {
      logger.error('Error completing promo redemption:', error);
      return false;
    }
  }

  /**
   * Get promo statistics for admin
   */
  static async getPromoStats(promoId) {
    return await PromoModel.getStats(promoId);
  }

  /**
   * Get all promos for admin
   */
  static async getAllPromos(includeInactive = false) {
    return await PromoModel.getAll(includeInactive);
  }

  /**
   * Create new promo (admin)
   */
  static async createPromo(promoData) {
    const isAnyPlan = PromoModel.isAnyPlanPromo(promoData);

    // Validate base plan exists (unless any-plan promo)
    let basePlan = null;
    if (!isAnyPlan) {
      basePlan = await PlanModel.getById(promoData.basePlanId);
      if (!basePlan) {
        throw new Error('Base plan not found');
      }
    }

    // Validate discount
    if (promoData.discountType === 'percentage') {
      if (promoData.discountValue < 0 || promoData.discountValue > 100) {
        throw new Error('Percentage discount must be between 0 and 100');
      }
    } else if (promoData.discountType === 'fixed_price') {
      if (isAnyPlan) {
        throw new Error('Fixed price discounts are not supported for any-plan promos');
      }
      if (promoData.discountValue < 0) {
        throw new Error('Fixed price must be positive');
      }
      if (basePlan && promoData.discountValue > basePlan.price) {
        throw new Error('Fixed price cannot exceed base plan price');
      }
    }

    return await PromoModel.create(promoData);
  }

  /**
   * Update promo (admin)
   */
  static async updatePromo(promoId, updates) {
    return await PromoModel.update(promoId, updates);
  }

  /**
   * Deactivate promo (admin)
   */
  static async deactivatePromo(promoId) {
    return await PromoModel.deactivate(promoId);
  }

  /**
   * Generate broadcast button for promo
   */
  static generateBroadcastButton(promoCode, lang = 'en') {
    const buttonText = lang === 'es'
      ? 'Obtener esta promo'
      : 'Get this promo';

    return {
      text: buttonText,
      type: 'url',
      target: PromoModel.generateDeepLink(promoCode),
    };
  }

  /**
   * Get promo redemption by payment ID (for webhook processing)
   */
  static async getRedemptionByPaymentMetadata(paymentId) {
    try {
      const payment = await PaymentModel.getPaymentById(paymentId);
      if (!payment || !payment.metadata?.redemptionId) {
        return null;
      }
      return {
        redemptionId: payment.metadata.redemptionId,
        promoId: payment.metadata.promoId,
        promoCode: payment.metadata.promoCode,
      };
    } catch (error) {
      logger.error('Error getting redemption by payment metadata:', error);
      return null;
    }
  }
}

module.exports = PromoService;
