/**
 * Promo Handler
 * Handles promo deep links and payment flow
 */

const { Markup } = require('telegraf');
const PromoService = require('../../services/promoService');
const PromoModel = require('../../../models/promoModel');
const PlanModel = require('../../../models/planModel');
const logger = require('../../../utils/logger');

/**
 * Get user language from context
 */
function getLanguage(ctx) {
  return ctx.session?.language || ctx.from?.language_code || 'en';
}

async function sendAnyPlanSelection(ctx, promo, remainingSpots, lang) {
  const plans = await PlanModel.getPublicPlans();
  const availablePlans = plans && plans.length > 0 ? plans : await PlanModel.getAll();

  let message = lang === 'es'
    ? `*OFERTA ESPECIAL!*\n\n`
    : `*SPECIAL OFFER!*\n\n`;

  const promoName = lang === 'es' ? (promo.nameEs || promo.name) : promo.name;
  const promoDesc = lang === 'es' ? (promo.descriptionEs || promo.description) : promo.description;

  message += `*${promoName}*\n`;
  if (promoDesc) {
    message += `${promoDesc}\n`;
  }
  message += `━━━━━━━━━━━━━━━━━━\n\n`;
  message += lang === 'es'
    ? `*Descuento:* ${promo.discountValue}% en cualquier plan\n\n`
    : `*Discount:* ${promo.discountValue}% off any plan\n\n`;

  if (remainingSpots !== null && remainingSpots <= 20) {
    message += lang === 'es'
      ? `*Solo ${remainingSpots} cupo${remainingSpots !== 1 ? 's' : ''} disponible${remainingSpots !== 1 ? 's' : ''}!*\n`
      : `*Only ${remainingSpots} spot${remainingSpots !== 1 ? 's' : ''} left!*\n`;
  }

  if (promo.validUntil) {
    const expiryDate = new Date(promo.validUntil);
    const expiryStr = expiryDate.toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    message += lang === 'es'
      ? `Valido hasta: ${expiryStr}\n`
      : `Valid until: ${expiryStr}\n`;
  }

  message += lang === 'es'
    ? '\nSelecciona el plan que quieres comprar:'
    : '\nSelect the plan you want to purchase:';

  const buttons = availablePlans.map((plan) => {
    const price = PromoModel.calculatePriceForPlan(promo, plan);
    const planLabel = lang === 'es' && plan.nameEs ? plan.nameEs : plan.name;
    const label = `${planLabel} - $${price.finalPrice}`;
    return [Markup.button.callback(label, `promo_select_plan_${promo.code}|${plan.id}`)];
  });

  buttons.push([
    Markup.button.callback(lang === 'es' ? 'Menu Principal' : 'Main Menu', 'menu:back'),
  ]);

  const options = {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard(buttons),
  };

  if (ctx.callbackQuery?.message) {
    await ctx.editMessageText(message, options);
  } else {
    await ctx.reply(message, options);
  }
}

/**
 * Handle promo deep link: /start?promo_CODE
 */
async function handlePromoDeepLink(ctx, promoCode) {
  const lang = getLanguage(ctx);
  const userId = ctx.from.id.toString();

  try {
    logger.info('Processing promo deep link', { promoCode, userId });

    // Get promo details and check eligibility
    const result = await PromoService.getPromoForUser(promoCode, userId);

    if (!result.success) {
      // Show appropriate error message
      const errorMessages = {
        not_found: {
          en: 'Sorry, this promotion does not exist.',
          es: 'Lo sentimos, esta promocion no existe.',
        },
        expired: {
          en: 'This promotion has expired.',
          es: 'Esta promocion ha expirado.',
        },
        sold_out: {
          en: 'All spots for this promotion have been claimed.',
          es: 'Todos los cupos para esta promocion han sido tomados.',
        },
        already_redeemed: {
          en: 'You have already claimed this promotion.',
          es: 'Ya has reclamado esta promocion.',
        },
        not_churned: {
          en: 'This promotion is only for returning members.',
          es: 'Esta promocion es solo para miembros que han regresado.',
        },
        not_new_user: {
          en: 'This promotion is only for new users.',
          es: 'Esta promocion es solo para usuarios nuevos.',
        },
        not_free_user: {
          en: 'This promotion is only for users who have not subscribed before.',
          es: 'Esta promocion es solo para usuarios que no se han suscrito antes.',
        },
        inactive: {
          en: 'This promotion is no longer active.',
          es: 'Esta promocion ya no esta activa.',
        },
      };

      const errorMsg = errorMessages[result.error] || {
        en: 'You cannot access this promotion.',
        es: 'No puedes acceder a esta promocion.',
      };

      const message = lang === 'es' ? errorMsg.es : errorMsg.en;

      await ctx.reply(message, Markup.inlineKeyboard([
        [Markup.button.callback(lang === 'es' ? 'Menu Principal' : 'Main Menu', 'menu:back')]
      ]));
      return;
    }

    // Show promo offer
    const { promo, pricing, remainingSpots, basePlan } = result;

    // Any-plan promo flow: let user choose plan
    if (PromoModel.isAnyPlanPromo(promo)) {
      await sendAnyPlanSelection(ctx, promo, remainingSpots, lang);
      return;
    }

    // Build message
    const promoName = lang === 'es' ? (promo.nameEs || promo.name) : promo.name;
    const promoDesc = lang === 'es' ? (promo.descriptionEs || promo.description) : promo.description;
    const planName = lang === 'es' && basePlan.nameEs ? basePlan.nameEs : basePlan.name;

    // Get features - promo features override, otherwise use base plan
    let features = promo.features && promo.features.length > 0 ? promo.features : basePlan.features;
    if (lang === 'es') {
      features = promo.featuresEs && promo.featuresEs.length > 0
        ? promo.featuresEs
        : (basePlan.featuresEs || features);
    }

    let message = lang === 'es'
      ? `*OFERTA ESPECIAL!*\n\n`
      : `*SPECIAL OFFER!*\n\n`;

    message += `*${promoName}*\n`;

    if (promoDesc) {
      message += `${promoDesc}\n`;
    }

    message += `━━━━━━━━━━━━━━━━━━\n\n`;

    // Pricing
    message += lang === 'es'
      ? `Plan: *${planName}*\n`
      : `Plan: *${planName}*\n`;

    message += lang === 'es'
      ? `Precio Original: ~$${pricing.originalPrice}~\n`
      : `Original Price: ~$${pricing.originalPrice}~\n`;

    message += lang === 'es'
      ? `*Tu Precio: $${pricing.finalPrice}*\n`
      : `*Your Price: $${pricing.finalPrice}*\n`;

    message += lang === 'es'
      ? `Ahorras: $${pricing.discountAmount}\n\n`
      : `You Save: $${pricing.discountAmount}\n\n`;

    // Features
    if (features && features.length > 0) {
      message += lang === 'es' ? `*Incluye:*\n` : `*Includes:*\n`;
      features.slice(0, 6).forEach(f => {
        message += `• ${f}\n`;
      });
      message += '\n';
    }

    // Urgency indicators
    if (remainingSpots !== null && remainingSpots <= 20) {
      message += lang === 'es'
        ? `*Solo ${remainingSpots} cupo${remainingSpots !== 1 ? 's' : ''} disponible${remainingSpots !== 1 ? 's' : ''}!*\n`
        : `*Only ${remainingSpots} spot${remainingSpots !== 1 ? 's' : ''} left!*\n`;
    }

    if (promo.validUntil) {
      const expiryDate = new Date(promo.validUntil);
      const expiryStr = expiryDate.toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
      message += lang === 'es'
        ? `Valido hasta: ${expiryStr}\n`
        : `Valid until: ${expiryStr}\n`;
    }

    // Payment buttons
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback(
        lang === 'es' ? `Pagar $${pricing.finalPrice} con Tarjeta` : `Pay $${pricing.finalPrice} with Card`,
        `promo_pay_epayco_${promo.code}`
      )],
      [Markup.button.callback(
        lang === 'es' ? `Pagar $${pricing.finalPrice} con Crypto` : `Pay $${pricing.finalPrice} with Crypto`,
        `promo_pay_daimo_${promo.code}`
      )],
      [Markup.button.callback(lang === 'es' ? 'Menu Principal' : 'Main Menu', 'menu:back')],
    ]);

    await ctx.reply(message, {
      parse_mode: 'Markdown',
      ...keyboard,
    });

  } catch (error) {
    logger.error('Error handling promo deep link:', error);
    await ctx.reply(
      lang === 'es'
        ? 'Error al cargar la promocion. Por favor intenta de nuevo.'
        : 'Error loading promotion. Please try again.'
    );
  }
}

/**
 * Handle promo payment action
 */
async function handlePromoPayment(ctx, provider) {
  const lang = getLanguage(ctx);

  try {
    await ctx.answerCbQuery();

    if (!ctx.match || !ctx.match[1]) {
      logger.error('Invalid promo payment action format');
      return;
    }

    const raw = ctx.match[1];
    const [promoCode, planId] = raw.split('|');
    const userId = ctx.from.id.toString();
    const chatId = ctx.chat?.id;

    await ctx.editMessageText(lang === 'es' ? 'Procesando...' : 'Processing...');

    const result = await PromoService.initiatePromoPayment(promoCode, userId, provider, chatId, planId || null);

    if (result.success) {
      const successMessage = lang === 'es'
        ? `*Promo reservada!*\n\n` +
          `Total a pagar: *$${result.finalPrice}*\n\n` +
          `Haz clic en el boton para completar tu pago.`
        : `*Promo claimed!*\n\n` +
          `Total to pay: *$${result.finalPrice}*\n\n` +
          `Click the button to complete your payment.`;

      await ctx.editMessageText(
        successMessage,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.url(lang === 'es' ? 'Pagar Ahora' : 'Pay Now', result.paymentUrl)],
            [Markup.button.callback(lang === 'es' ? 'Menu Principal' : 'Main Menu', 'menu:back')],
          ]),
        }
      );
    } else {
      const errorMessage = lang === 'es'
        ? `${result.message || 'Error al procesar la promocion.'}`
        : `${result.message || 'Error processing promotion.'}`;

      await ctx.editMessageText(
        errorMessage,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback(lang === 'es' ? 'Menu Principal' : 'Main Menu', 'menu:back')],
          ]),
        }
      );
    }
  } catch (error) {
    logger.error('Error handling promo payment:', error);
    try {
      await ctx.editMessageText(
        lang === 'es'
          ? 'Error al procesar el pago. Por favor intenta de nuevo.'
          : 'Error processing payment. Please try again.',
        {
          ...Markup.inlineKeyboard([
            [Markup.button.callback(lang === 'es' ? 'Menu Principal' : 'Main Menu', 'menu:back')],
          ]),
        }
      );
    } catch (editError) {
      // Ignore edit errors
    }
  }
}

/**
 * Register promo payment action handlers
 */
function registerPromoHandlers(bot) {
  // Select plan for any-plan promo
  bot.action(/^promo_select_plan_(.+)$/, async (ctx) => {
    const lang = getLanguage(ctx);
    try {
      await ctx.answerCbQuery();
      const raw = ctx.match?.[1] || '';
      const [promoCode, planId] = raw.split('|');
      if (!promoCode || !planId) {
        return;
      }

      const userId = ctx.from.id.toString();
      const promoDetails = await PromoService.getPromoForUser(promoCode, userId);
      if (!promoDetails.success) {
        await ctx.reply(lang === 'es' ? 'Promo no disponible.' : 'Promo not available.');
        return;
      }

      const promo = promoDetails.promo;
      const plan = await PlanModel.getById(planId);
      if (!plan) {
        await ctx.reply(lang === 'es' ? 'Plan no encontrado.' : 'Plan not found.');
        return;
      }

      const pricing = PromoModel.calculatePriceForPlan(promo, plan);
      const promoName = lang === 'es' ? (promo.nameEs || promo.name) : promo.name;
      const promoDesc = lang === 'es' ? (promo.descriptionEs || promo.description) : promo.description;
      const planName = lang === 'es' && plan.nameEs ? plan.nameEs : plan.name;

      let message = lang === 'es'
        ? `*OFERTA ESPECIAL!*\n\n`
        : `*SPECIAL OFFER!*\n\n`;

      message += `*${promoName}*\n`;
      if (promoDesc) message += `${promoDesc}\n`;
      message += `━━━━━━━━━━━━━━━━━━\n\n`;
      message += `${lang === 'es' ? 'Plan' : 'Plan'}: *${planName}*\n`;
      message += lang === 'es'
        ? `Precio Original: ~$${pricing.originalPrice}~\n`
        : `Original Price: ~$${pricing.originalPrice}~\n`;
      message += lang === 'es'
        ? `*Tu Precio: $${pricing.finalPrice}*\n`
        : `*Your Price: $${pricing.finalPrice}*\n`;
      message += lang === 'es'
        ? `Ahorras: $${pricing.discountAmount}\n\n`
        : `You Save: $${pricing.discountAmount}\n\n`;

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback(
          lang === 'es' ? `Pagar $${pricing.finalPrice} con Tarjeta` : `Pay $${pricing.finalPrice} with Card`,
          `promo_pay_epayco_${promo.code}|${plan.id}`
        )],
        [Markup.button.callback(
          lang === 'es' ? `Pagar $${pricing.finalPrice} con Crypto` : `Pay $${pricing.finalPrice} with Crypto`,
          `promo_pay_daimo_${promo.code}|${plan.id}`
        )],
        [Markup.button.callback(lang === 'es' ? '◀️ Elegir otro plan' : '◀️ Choose another plan', `promo_select_any_${promo.code}`)],
        [Markup.button.callback(lang === 'es' ? 'Menu Principal' : 'Main Menu', 'menu:back')],
      ]);

      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        ...keyboard,
      });
    } catch (error) {
      logger.error('Error selecting promo plan:', error);
      await ctx.reply(lang === 'es' ? 'Error al cargar el plan.' : 'Error loading plan.');
    }
  });

  // Re-open any-plan selection
  bot.action(/^promo_select_any_(.+)$/, async (ctx) => {
    const lang = getLanguage(ctx);
    try {
      await ctx.answerCbQuery();
      const promoCode = ctx.match?.[1];
      if (!promoCode) return;
      const userId = ctx.from.id.toString();
      const promoDetails = await PromoService.getPromoForUser(promoCode, userId);
      if (!promoDetails.success) {
        await ctx.reply(lang === 'es' ? 'Promo no disponible.' : 'Promo not available.');
        return;
      }
      await sendAnyPlanSelection(ctx, promoDetails.promo, promoDetails.remainingSpots, lang);
    } catch (error) {
      logger.error('Error reopening promo plan selection:', error);
    }
  });

  // Pay with ePayco (credit card)
  bot.action(/^promo_pay_epayco_(.+)$/, async (ctx) => {
    await handlePromoPayment(ctx, 'epayco');
  });

  // Pay with Daimo (crypto)
  bot.action(/^promo_pay_daimo_(.+)$/, async (ctx) => {
    await handlePromoPayment(ctx, 'daimo');
  });

  logger.info('Promo handlers registered');
}

module.exports = { handlePromoDeepLink, registerPromoHandlers };
