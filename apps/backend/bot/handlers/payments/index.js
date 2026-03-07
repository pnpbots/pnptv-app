const { Markup } = require('telegraf');
const PaymentService = require('../../services/paymentService');
const PlanModel = require('../../../models/planModel');
const UserService = require('../../services/userService');
const { t } = require('../../../utils/i18n');
const logger = require('../../../utils/logger');
const { getLanguage, safeReplyOrEdit } = require('../../utils/helpers');
const DaimoConfig = require('../../../config/daimo');
const registerActivationHandlers = require('./activation');

const showSubscriptionPlans = async (ctx, options = {}) => {
  const { forceReply = false, respectAdminViewMode = false } = options;
  const lang = getLanguage(ctx);

  const isAdminViewingAsFree = respectAdminViewMode && ctx.session?.adminViewMode === 'free';
  const hasActiveSubscription = !isAdminViewingAsFree
    && await UserService.hasActiveSubscription(ctx.from.id);

  const sendMessage = async (message, extraOptions) => {
    if (forceReply || !ctx.callbackQuery) {
      return ctx.reply(message, extraOptions);
    }
    return safeReplyOrEdit(ctx, message, extraOptions);
  };

  if (hasActiveSubscription) {
    const warningMsg = lang === 'es'
      ? '⚠️ **Ya tienes una suscripción activa**\n\n'
        + 'No puedes comprar una nueva suscripción mientras tengas una activa.\n\n'
        + 'Para evitar pagos duplicados, por favor espera a que tu suscripción actual expire o contacta soporte para cambiar tu plan.'
      : '⚠️ **You already have an active subscription**\n\n'
        + 'You cannot purchase a new subscription while you have an active one.\n\n'
        + 'To avoid double payments, please wait until your current subscription expires or contact support to change your plan.';

    return sendMessage(
      warningMsg,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback(t('back', lang), 'back_to_main')]
        ])
      }
    );
  }

  const plans = await PlanModel.getPublicPlans();

  // Header with internationalization
  let message = `${t('subscriptionHeader', lang)}\n`;
  message += `${t('subscriptionDivider', lang)}\n\n`;
  message += `${t('subscriptionDescription', lang)}\n\n\n`;

  const buttons = [];
  plans.forEach((plan) => {
    const planName = plan.display_name || plan.name;
    const durationText = plan.duration_days || plan.duration;
    const price = parseFloat(plan.price);

    // Format buttons with i18n
    let buttonText;
    if (plan.is_lifetime) {
      // Lifetime Pass without duration
      buttonText = `${planName} | $${price.toFixed(2)}`;
    } else {
      // Regular plans with duration
      buttonText = `${planName} | ${durationText} ${t('days', lang)} | $${price.toFixed(2)}`;
    }

    buttons.push([
      Markup.button.callback(buttonText, `select_plan_${plan.id}`),
    ]);
  });

  buttons.push([Markup.button.callback(t('back', lang), 'back_to_main')]);

  return sendMessage(message, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard(buttons)
  });
};

/**
 * Payment handlers
 * @param {Telegraf} bot - Bot instance
 */
const registerPaymentHandlers = (bot) => {
  // Register activation code handlers
  registerActivationHandlers(bot);

  // /subscribe command - shows subscription plans directly
  bot.command('subscribe', async (ctx) => {
    try {
      await showSubscriptionPlans(ctx, { forceReply: true });
      logger.info('User viewed subscription plans via /subscribe', { userId: ctx.from.id });
    } catch (error) {
      logger.error('Error in /subscribe command:', error);
      await ctx.reply('Error loading plans. Please try again.');
    }
  });

  // Show subscription plans (callback action)
  bot.action('show_subscription_plans', async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const sentMessage = await showSubscriptionPlans(ctx, { respectAdminViewMode: true });

      // Auto-delete after 30 seconds of inactivity (for group chats)
      if (sentMessage && (ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup')) {
        setTimeout(async () => {
          try {
            await ctx.telegram.deleteMessage(ctx.chat.id, sentMessage.message_id);
          } catch (error) {
            // Message may have already been deleted or chat may not allow deletion
          }
        }, 30000);
      }
    } catch (error) {
      logger.error('Error showing subscription plans:', error);
      await ctx.answerCbQuery('Error loading plans. Please try again.').catch(() => {});
    }
  });

  // Select plan
  bot.action(/^select_plan_(.+)$/, async (ctx) => {
    try {
      await ctx.answerCbQuery();

      // Validate match result exists
      if (!ctx.match || !ctx.match[1]) {
        logger.error('Invalid plan selection action format');
        return;
      }

      const planId = ctx.match[1];
      const lang = getLanguage(ctx);

      logger.info('Plan selected', { planId, userId: ctx.from?.id });

      // Obtener detalles del plan
      const plan = await PlanModel.getById(planId);
      if (!plan) {
        await ctx.editMessageText(
          t('error', lang),
          Markup.inlineKeyboard([
            [Markup.button.callback(t('back', lang), 'show_subscription_plans')],
          ]),
        );
        return;
      }

      ctx.session.temp.selectedPlan = planId;
      await ctx.saveSession();

      // Obtener descripción del plan desde i18n
      let planDesc = '';
      switch (plan.sku) {
        case 'TRIAL':
          planDesc = t('planTrialDesc', lang);
          break;
        case 'CRYSTAL':
          planDesc = t('planCrystalDesc', lang);
          break;
        case 'DIAMOND':
          planDesc = t('planDiamondDesc', lang);
          break;
        case 'LIFETIME':
          planDesc = t('planLifetimeDesc', lang);
          break;
        case 'MONTHLY':
          planDesc = t('planMonthlyDesc', lang);
          break;
        default:
          planDesc = plan.description || '';
      }

      // Normalize plan feature list for display (DB may store JSON or array)
      let features = [];
      try {
        if (Array.isArray(plan.features)) {
          features = plan.features;
        } else if (typeof plan.features === 'string' && plan.features.trim()) {
          const parsed = JSON.parse(plan.features);
          features = Array.isArray(parsed) ? parsed : [];
        }
      } catch (_) {
        features = [];
      }

      const planName = plan.display_name || plan.name;
      const price = parseFloat(plan.price);
      const durationDays = plan.duration_days || plan.duration;
      let planHeader = `${t('planDetails', lang)}\n`;
      planHeader += `*${planName}* | $${price.toFixed(2)}\n`;
      if (!plan.is_lifetime && durationDays) {
        planHeader += `${t('duration', lang)}: *${durationDays} ${t('days', lang)}*\n`;
      }
      planHeader += '\n';
      planHeader += `${planDesc}\n\n`;
      if (features.length) {
        const shown = features.slice(0, 8);
        planHeader += `${t('features', lang)}\n`;
        planHeader += shown.map((f) => `• ${String(f)}`).join('\n');
        planHeader += '\n\n';
      }
      planHeader += `${t('paymentMethod', lang)}`;
      planHeader += `${t('paymentFooter', lang)}`;

      // Check if this is the lifetime100 promo - exclude ePayco and Daimo
      const isLifetime100Promo = plan.id === 'lifetime100-promo' || plan.sku === 'EASYBOTS-PNP-100';

      const paymentButtons = [];
      
      if (!isLifetime100Promo) {
        paymentButtons.push([Markup.button.callback(t('payWithEpayco', lang), `pay_epayco_${planId}`)]);
        paymentButtons.push([Markup.button.callback(t('payWithDaimo', lang), `pay_daimo_${planId}`)]);
      }

      // For lifetime100 promo, show manual payment instructions
      if (isLifetime100Promo) {
        const manualPaymentMsg = lang === 'es'
          ? '\n\n📝 *Pago manual requerido*\n\nPara el Lifetime100 Promo, por favor envía tu recibo de pago a soporte. Puedes comprar en: https://pnptv.app/lifetime100'
          : '\n\n📝 *Manual payment required*\n\nFor Lifetime100 Promo, please send your payment receipt to support. You can purchase at: https://pnptv.app/lifetime100';
        
        planHeader += manualPaymentMsg;
      }

      paymentButtons.push([Markup.button.callback(t('back', lang), 'back_to_main')]);

      await ctx.editMessageText(
        planHeader,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard(paymentButtons),
        },
      );
    } catch (error) {
      logger.error('Error selecting plan:', error);
      await ctx.answerCbQuery('Error selecting plan. Please try again.').catch(() => {});
    }
  });

  // Pay with ePayco
  bot.action(/^pay_epayco_(.+)$/, async (ctx) => {
    const lang = getLanguage(ctx);
    try {
      await ctx.answerCbQuery();

      // Validate match result exists
      if (!ctx.match || !ctx.match[1]) {
        logger.error('Invalid ePayco payment action format');
        return;
      }

      const planId = ctx.match[1];

      // Validate user context exists
      if (!ctx.from?.id) {
        logger.error('Missing user context in ePayco payment');
        await ctx.reply(t('error', lang));
        return;
      }

      const userId = ctx.from.id;

      // Double-check if user has active subscription before creating payment
      // Skip this check if admin is in "View as Free" mode
      const isAdminViewingAsFree = ctx.session?.adminViewMode === 'free';
      const hasActiveSubscription = !isAdminViewingAsFree && await UserService.hasActiveSubscription(userId);

      if (hasActiveSubscription) {
        const warningMsg = lang === 'es'
          ? '⚠️ **Ya tienes una suscripción activa**\n\n'
            + 'No puedes realizar un nuevo pago mientras tengas una suscripción activa.\n\n'
            + 'Esto evita pagos duplicados. Si deseas cambiar tu plan, contacta soporte.'
          : '⚠️ **You already have an active subscription**\n\n'
            + 'You cannot make a new payment while you have an active subscription.\n\n'
            + 'This prevents double payments. If you want to change your plan, contact support.';
        
        await ctx.editMessageText(
          warningMsg,
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback(t('back', lang), 'back_to_main')]
            ])
          }
        );
        return;
      }

      logger.info('Creating ePayco payment', { planId, userId });

      await ctx.editMessageText(t('loading', lang));

      const result = await PaymentService.createPayment({
        userId,
        planId,
        provider: 'epayco',
      });

      if (result.success) {
        await ctx.editMessageText(
          t('paymentInstructions', lang, { paymentUrl: result.paymentUrl }),
          Markup.inlineKeyboard([
            [Markup.button.url('💳 Pay Now', result.paymentUrl)],
            [Markup.button.callback(t('back', lang), `select_plan_${planId}`)],
          ]),
        );
      } else {
        await ctx.editMessageText(
          `${t('error', lang)}\n\n${result.error}`,
          Markup.inlineKeyboard([
            [Markup.button.callback(t('back', lang), `select_plan_${planId}`)],
          ]),
        );
      }
    } catch (error) {
      logger.error('Error creating ePayco payment:', error);
      const errorMsg = lang === 'es'
        ? '❌ **Error al procesar el pago**\n\nOcurrió un error al crear tu pago con ePayco. Por favor intenta nuevamente o contacta soporte si el problema persiste.'
        : '❌ **Payment Processing Error**\n\nAn error occurred while creating your ePayco payment. Please try again or contact support if the problem persists.';

      const errorPlanId = ctx.match?.[1] || 'unknown';
      await ctx.editMessageText(
        errorMsg,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback(t('back', lang), `select_plan_${errorPlanId}`)],
          ]),
        },
      ).catch(() => {});
    }
  });

  // Pay with Daimo
  bot.action(/^pay_daimo_(.+)$/, async (ctx) => {
    try {
      await ctx.answerCbQuery();

      // Validate match result exists
      if (!ctx.match || !ctx.match[1]) {
        logger.error('Invalid Daimo payment action format');
        return;
      }

      const planId = ctx.match[1];
      const lang = getLanguage(ctx);

      // Validate user context exists
      if (!ctx.from?.id) {
        logger.error('Missing user context in Daimo payment');
        await ctx.reply(t('error', lang));
        return;
      }

      const userId = ctx.from.id;
      const chatId = ctx.chat?.id;

      // Double-check if user has active subscription before creating payment
      // Skip this check if admin is in "View as Free" mode
      const isAdminViewingAsFree = ctx.session?.adminViewMode === 'free';
      const hasActiveSubscription = !isAdminViewingAsFree && await UserService.hasActiveSubscription(userId);

      if (hasActiveSubscription) {
        const warningMsg = lang === 'es'
          ? '⚠️ **Ya tienes una suscripción activa**\n\n'
            + 'No puedes realizar un nuevo pago mientras tengas una suscripción activa.\n\n'
            + 'Esto evita pagos duplicados. Si deseas cambiar tu plan, contacta soporte.'
          : '⚠️ **You already have an active subscription**\n\n'
            + 'You cannot make a new payment while you have an active subscription.\n\n'
            + 'This prevents double payments. If you want to change your plan, contact support.';
        
        await ctx.editMessageText(
          warningMsg,
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback(t('back', lang), 'back_to_main')]
            ])
          }
        );
        return;
      }

      logger.info('Creating Daimo payment', { planId, userId });

      await ctx.editMessageText(t('loading', lang));

      // Get plan details for display
      const plan = await PlanModel.getById(planId);
      if (!plan) {
        await ctx.editMessageText(
          t('error', lang),
          Markup.inlineKeyboard([
            [Markup.button.callback(t('back', lang), 'show_subscription_plans')],
          ]),
        );
        return;
      }

      const result = await PaymentService.createPayment({
        userId,
        planId,
        provider: 'daimo',
        chatId,
      });

      if (result.success) {
        const message = lang === 'es'
          ? '🪙 *Paga en Crypto con Daimo Pay*\n\n'
            + `Plan: ${plan.display_name || plan.name}\n`
            + `Precio: $${plan.price} USDC\n\n`
            + 'Completa tu suscripción usando crypto a través de nuestro checkout de Daimo Pay — rápido, seguro, discreto y perfecto para miembros que prefieren pagos privados y sin fronteras.\n\n'
            + '💳 *Daimo Pay acepta USDC, y puedes pagar usando wallets populares como:*\n'
            + 'Binance • Coinbase Wallet • MetaMask • Trust Wallet • Phantom • Rainbow • OKX Wallet, y más.\n\n'
            + 'Solo elige tu wallet, confirma la transacción, y listo.\n\n'
            + '✅ *Una vez confirmado tu pago, recibirás automáticamente:*\n'
            + '• Tu mensaje de acceso PRIME\n'
            + '• Tu factura\n'
            + '• Tus instrucciones de onboarding\n\n'
            + '💬 Si necesitas ayuda durante el checkout, escríbele a Cristina, nuestra asistente AI — ella te guiará paso a paso o te conectará con Santino si es necesario.'
          : '🪙 *Pay in Crypto with Daimo Pay*\n\n'
            + `Plan: ${plan.display_name || plan.name}\n`
            + `Price: $${plan.price} USDC\n\n`
            + 'You can complete your subscription using crypto through our Daimo Pay checkout — fast, secure, discreet, and perfect for members who prefer private, borderless payments.\n\n'
            + '💳 *Daimo Pay accepts USDC, and you can pay using popular wallets such as:*\n'
            + 'Binance • Coinbase Wallet • MetaMask • Trust Wallet • Phantom • Rainbow • OKX Wallet, and more.\n\n'
            + 'Just choose your wallet, confirm the transaction, and you\'re done.\n\n'
            + '✅ *Once your payment is confirmed, you\'ll automatically receive:*\n'
            + '• Your PRIME access message\n'
            + '• Your invoice\n'
            + '• Your onboarding instructions\n\n'
            + '💬 If you need help during checkout, just message Cristina, our AI assistant — she\'ll guide you step by step or pass you to Santino if needed.';

        await ctx.editMessageText(
          message,
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.url('💰 Pay Now', result.paymentUrl)],
              [Markup.button.callback(t('back', lang), `select_plan_${planId}`)],
            ]),
          },
        );
      } else {
        await ctx.editMessageText(
          `${t('error', lang)}\n\n${result.error}`,
          Markup.inlineKeyboard([
            [Markup.button.callback(t('back', lang), `select_plan_${planId}`)],
          ]),
        );
      }
    } catch (error) {
      logger.error('Error creating Daimo payment:', error);
      const lang = getLanguage(ctx);
      const errorMsg = lang === 'es'
        ? '❌ **Error al procesar el pago**\n\nOcurrió un error al crear tu pago con Daimo. Por favor intenta nuevamente o contacta soporte si el problema persiste.\n\n💡 *Sugerencia:* Puedes intentar con otro método de pago como ePayco.'
        : '❌ **Payment Processing Error**\n\nAn error occurred while creating your Daimo payment. Please try again or contact support if the problem persists.\n\n💡 *Tip:* You can try another payment method like ePayco.';

      const errorPlanId = ctx.match?.[1] || 'unknown';
      await ctx.editMessageText(
        errorMsg,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback(t('back', lang), `select_plan_${errorPlanId}`)],
          ]),
        },
      ).catch(() => {});
    }
  });
};

module.exports = registerPaymentHandlers;
module.exports.showSubscriptionPlans = showSubscriptionPlans;
