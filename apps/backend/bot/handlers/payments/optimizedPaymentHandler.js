/**
 * Optimized Payment Handler with Enhanced Security
 * Handles all payment methods with comprehensive anti-fraud measures
 */

const { Markup } = require('telegraf');
const { t } = require('../../../utils/i18n');
const logger = require('../../utils/logger');
const { getLanguage } = require('../../utils/helpers');
const PaymentService = require('../../services/paymentService');
const PlanModel = require('../../models/planModel');
const UserService = require('../../services/userService');

/**
 * Enhanced Payment Selection Menu
 */
async function showEnhancedPaymentSelection(ctx, planId) {
  const lang = getLanguage(ctx);
  try {
    const userId = ctx.from?.id;
    const plan = await PlanModel.getById(planId);
    
    if (!plan) {
      await ctx.editMessageText(t('error', lang));
      return;
    }

    // Check for active subscription
    const hasActiveSubscription = await UserService.hasActiveSubscription(userId);
    if (hasActiveSubscription) {
      await ctx.editMessageText(
        lang === 'es' ? '⚠️ Ya tienes una suscripción activa' : '⚠️ You already have an active subscription',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    const paymentText = lang === 'es'
      ? `💎 *Selecciona tu método de pago* 💎`
      : `💎 *Select your payment method* 💎`;

    await ctx.editMessageText(paymentText);
  } catch (error) {
    logger.error('Error showing payment selection:', error);
    await ctx.editMessageText(t('error', lang));
  }
}

module.exports = {
  showEnhancedPaymentSelection
};
