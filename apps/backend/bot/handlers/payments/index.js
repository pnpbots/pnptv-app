const { Markup } = require('telegraf');
const PaymentService = require('../../../services/paymentService');
const PlanModel = require('../../../models/planModel');
const UserService = require('../../../services/userService');
const { t } = require('../../../utils/i18n');
const logger = require('../../../utils/logger');
const { getLanguage, safeReplyOrEdit } = require('../../utils/helpers');
// Daimo retired — DaimoConfig require removed; pay_daimo callback below is a silent ack.
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

      // Check if this is the lifetime100 promo - exclude all auto-checkout buttons
      const isLifetime100Promo = plan.id === 'lifetime100-promo' || plan.sku === 'EASYBOTS-PNP-100';

      const paymentButtons = [];

      if (!isLifetime100Promo) {
        paymentButtons.push([Markup.button.url(
          lang === 'es' ? '💳 Pagar con Tarjeta (Stripe)' : '💳 Pay with Card (Stripe)',
          `https://app.pnptv.app/subscribe?plan=${encodeURIComponent(planId)}`
        )]);
        paymentButtons.push([Markup.button.url(
          lang === 'es' ? '🥷 Pagar con Dash (en la app)' : '🥷 Pay with Dash (in the app)',
          'https://app.pnptv.app/subscribe',
        )]);
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

  // Legacy card callback kept for stale inline keyboards already delivered to users.
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

      const subscribeUrl = `https://app.pnptv.app/subscribe?plan=${encodeURIComponent(planId)}`;
      logger.info('Redirecting legacy card callback to Stripe subscribe flow', { planId, userId });

      await ctx.editMessageText(
        lang === 'es'
          ? '💳 *Pago con tarjeta*\n\nLa compra con tarjeta ahora se hace en la app web con Stripe.\n\nToca el boton para continuar.'
          : '💳 *Card payment*\n\nCard checkout now happens in the web app with Stripe.\n\nTap the button below to continue.',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.url(lang === 'es' ? 'Abrir pago con tarjeta' : 'Open card checkout', subscribeUrl)],
            [Markup.button.callback(t('back', lang), `select_plan_${planId}`)],
          ]),
        }
      );
    } catch (error) {
      logger.error('Error redirecting legacy card callback:', error);
      const errorMsg = lang === 'es'
        ? '❌ **Error al abrir el pago**\n\nIntenta nuevamente desde la app web.'
        : '❌ **Error opening checkout**\n\nPlease try again from the web app.';

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

  // Pay with Daimo handler removed (Daimo retired). The user-facing button
  // is gone from menus.js + payments/index.js, and any stale callback that
  // still arrives is acknowledged silently — no checkout is created.
  bot.action(/^pay_daimo_(.+)$/, async (ctx) => {
    try { await ctx.answerCbQuery('Daimo Pay retired — please use Card or Dash in the app', { show_alert: true }); } catch (_) { /* noop */ }
  });
};

module.exports = registerPaymentHandlers;
module.exports.showSubscriptionPlans = showSubscriptionPlans;
