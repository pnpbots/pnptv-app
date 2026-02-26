const { requirePrivateChat } = require('../../utils/notifications');
const userService = require('../../services/userService');
const VisaCybersourceService = require('../../services/visaCybersourceService');
const PlanModel = require('../../../models/planModel');
const i18n = require('../../utils/i18n');
const logger = require('../../../utils/logger');
const { Markup } = require('telegraf');

/**
 * Handle /subscription command - View and manage recurring subscription
 */
async function handleSubscriptionCommand(ctx) {
  try {
    const userId = ctx.from.id.toString();
    const user = await userService.getUser(userId);
    const language = user?.language || 'en';
    const isSpanish = language.startsWith('es');

    // Check if command is in private chat
    const isPrivate = await requirePrivateChat(
      ctx,
      'Manage Subscription',
      isSpanish ? 'Administrar Suscripción' : 'Manage Subscription'
    );

    if (!isPrivate) return;

    // Get subscription details
    const subscription = await VisaCybersourceService.getSubscriptionDetails(userId);

    if (subscription) {
      // User has an active recurring subscription
      const periodEndStr = subscription.currentPeriodEnd?.toLocaleDateString(
        isSpanish ? 'es-ES' : 'en-US',
        { year: 'numeric', month: 'long', day: 'numeric' }
      );

      const statusEmoji = {
        active: '✅',
        trialing: '🎁',
        past_due: '⚠️',
        cancelled: '❌',
      };

      const statusText = {
        active: isSpanish ? 'Activa' : 'Active',
        trialing: isSpanish ? 'Período de prueba' : 'Trial',
        past_due: isSpanish ? 'Pago pendiente' : 'Past Due',
        cancelled: isSpanish ? 'Cancelada' : 'Cancelled',
      };

      let message = isSpanish
        ? `📋 *Tu Suscripción Recurrente*

${statusEmoji[subscription.status] || '📋'} *Estado:* ${statusText[subscription.status] || subscription.status}
💎 *Plan:* ${subscription.planName || 'PRIME Monthly'}
💰 *Precio:* $${subscription.amount?.toFixed(2)} USD/mes
💳 *Tarjeta:* ${subscription.cardFranchise?.toUpperCase() || 'VISA'} ${subscription.cardMask || '****'}
📅 *Próxima renovación:* ${periodEndStr}`
        : `📋 *Your Recurring Subscription*

${statusEmoji[subscription.status] || '📋'} *Status:* ${statusText[subscription.status] || subscription.status}
💎 *Plan:* ${subscription.planName || 'PRIME Monthly'}
💰 *Price:* $${subscription.amount?.toFixed(2)} USD/month
💳 *Card:* ${subscription.cardFranchise?.toUpperCase() || 'VISA'} ${subscription.cardMask || '****'}
📅 *Next renewal:* ${periodEndStr}`;

      if (subscription.cancelAtPeriodEnd) {
        message += isSpanish
          ? `\n\n⚠️ _Tu suscripción se cancelará el ${periodEndStr}_`
          : `\n\n⚠️ _Your subscription will be cancelled on ${periodEndStr}_`;
      }

      if (subscription.billingFailures > 0) {
        message += isSpanish
          ? `\n\n⚠️ _${subscription.billingFailures} intento(s) de pago fallido(s)_`
          : `\n\n⚠️ _${subscription.billingFailures} failed payment attempt(s)_`;
      }

      // Build inline keyboard
      const buttons = [];

      if (subscription.cancelAtPeriodEnd) {
        // Option to reactivate
        buttons.push([
          Markup.button.callback(
            isSpanish ? '🔄 Reactivar Suscripción' : '🔄 Reactivate Subscription',
            'subscription_reactivate'
          ),
        ]);
      } else if (subscription.status === 'active' || subscription.status === 'trialing') {
        // Option to cancel
        buttons.push([
          Markup.button.callback(
            isSpanish ? '❌ Cancelar Suscripción' : '❌ Cancel Subscription',
            'subscription_cancel_menu'
          ),
        ]);
      }

      // Update payment method
      buttons.push([
        Markup.button.callback(
          isSpanish ? '💳 Actualizar Método de Pago' : '💳 Update Payment Method',
          'subscription_update_card'
        ),
      ]);

      // Back to menu
      buttons.push([
        Markup.button.callback(
          isSpanish ? '⬅️ Volver al Menú' : '⬅️ Back to Menu',
          'main_menu'
        ),
      ]);

      await ctx.reply(message, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(buttons),
      });
    } else {
      // No active recurring subscription
      const isActive = await userService.isSubscriptionActive(userId);

      if (isActive) {
        // User has one-time subscription
        const expiryDate = user?.planExpiry?.toLocaleDateString(
          isSpanish ? 'es-ES' : 'en-US',
          { year: 'numeric', month: 'long', day: 'numeric' }
        );

        const message = isSpanish
          ? `📋 *Tu Membresía PRIME*

✅ *Estado:* Activa (pago único)
📅 *Vence:* ${expiryDate || 'N/A'}

🔄 *¿Quieres renovación automática?*
Activa la suscripción mensual para nunca perder acceso.`
          : `📋 *Your PRIME Membership*

✅ *Status:* Active (one-time payment)
📅 *Expires:* ${expiryDate || 'N/A'}

🔄 *Want automatic renewal?*
Enable monthly subscription to never lose access.`;

        await ctx.reply(message, {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [
              Markup.button.callback(
                isSpanish ? '🔄 Activar Renovación Automática' : '🔄 Enable Auto-Renewal',
                'subscription_setup_recurring'
              ),
            ],
            [
              Markup.button.callback(
                isSpanish ? '⬅️ Volver al Menú' : '⬅️ Back to Menu',
                'main_menu'
              ),
            ],
          ]),
        });
      } else {
        // No subscription at all
        const message = isSpanish
          ? `📋 *Suscripción*

No tienes una membresía PRIME activa.

🔄 *Opciones:*
• Compra única con /prime
• Suscripción mensual automática`
          : `📋 *Subscription*

You don't have an active PRIME membership.

🔄 *Options:*
• One-time purchase with /prime
• Monthly automatic subscription`;

        await ctx.reply(message, {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [
              Markup.button.callback(
                isSpanish ? '💎 Ver Planes' : '💎 View Plans',
                'prime_plans'
              ),
            ],
            [
              Markup.button.callback(
                isSpanish ? '🔄 Suscripción Mensual' : '🔄 Monthly Subscription',
                'subscription_setup_recurring'
              ),
            ],
            [
              Markup.button.callback(
                isSpanish ? '⬅️ Volver al Menú' : '⬅️ Back to Menu',
                'main_menu'
              ),
            ],
          ]),
        });
      }
    }

    logger.info(`User ${userId} viewed subscription management`);
  } catch (error) {
    logger.error('Error in subscription command:', error);
    await ctx.reply(i18n.t('error_occurred', 'en'));
  }
}

/**
 * Handle recurring subscription setup
 */
async function handleSetupRecurring(ctx) {
  try {
    await ctx.answerCbQuery();

    const userId = ctx.from.id.toString();
    const user = await userService.getUser(userId);
    const isSpanish = user?.language?.startsWith('es');

    // Get monthly plan
    const plans = await PlanModel.getPublicPlans();
    const monthlyPlan = plans.find(p => p.duration === 30 || p.id?.includes('monthly'));

    if (!monthlyPlan) {
      await ctx.editMessageText(
        isSpanish
          ? '❌ No hay plan mensual disponible en este momento.'
          : '❌ No monthly plan available at this time.',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    const message = isSpanish
      ? `🔄 *Configurar Suscripción Mensual*

📋 *Plan:* ${monthlyPlan.nameEs || monthlyPlan.name}
💰 *Precio:* $${monthlyPlan.price?.toFixed(2)} USD/mes
🔄 *Renovación:* Automática cada mes

*Beneficios:*
• Nunca pierdas acceso a PRIME
• Cancela cuando quieras
• Sin compromisos a largo plazo

Para continuar, necesitas agregar una tarjeta de crédito/débito.`
      : `🔄 *Setup Monthly Subscription*

📋 *Plan:* ${monthlyPlan.name}
💰 *Price:* $${monthlyPlan.price?.toFixed(2)} USD/month
🔄 *Renewal:* Automatic every month

*Benefits:*
• Never lose PRIME access
• Cancel anytime
• No long-term commitment

To continue, you need to add a credit/debit card.`;

    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback(
            isSpanish ? '💳 Agregar Tarjeta' : '💳 Add Card',
            `subscription_add_card_${monthlyPlan.id}`
          ),
        ],
        [
          Markup.button.callback(
            isSpanish ? '⬅️ Volver' : '⬅️ Back',
            'subscription_back'
          ),
        ],
      ]),
    });

    logger.info(`User ${userId} initiated recurring subscription setup`);
  } catch (error) {
    logger.error('Error setting up recurring subscription:', error);
    await ctx.answerCbQuery('Error occurred');
  }
}

/**
 * Handle add card for recurring subscription
 */
async function handleAddCard(ctx) {
  try {
    await ctx.answerCbQuery();

    const userId = ctx.from.id.toString();
    const user = await userService.getUser(userId);
    const isSpanish = user?.language?.startsWith('es');
    const planId = ctx.callbackQuery.data.split('_').pop();

    // Generate checkout URL for card tokenization
    const checkoutUrl = `${process.env.BOT_WEBHOOK_DOMAIN}/recurring-checkout/${userId}/${planId}`;

    const message = isSpanish
      ? `💳 *Agregar Método de Pago*

Haz clic en el botón de abajo para agregar tu tarjeta de forma segura.

🔒 Tus datos están protegidos con encriptación SSL.
💳 Aceptamos Visa, Mastercard, y American Express.`
      : `💳 *Add Payment Method*

Click the button below to securely add your card.

🔒 Your data is protected with SSL encryption.
💳 We accept Visa, Mastercard, and American Express.`;

    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [
          Markup.button.url(
            isSpanish ? '💳 Agregar Tarjeta Segura' : '💳 Add Card Securely',
            checkoutUrl
          ),
        ],
        [
          Markup.button.callback(
            isSpanish ? '⬅️ Volver' : '⬅️ Back',
            'subscription_setup_recurring'
          ),
        ],
      ]),
    });

    logger.info(`User ${userId} requested to add card for plan ${planId}`);
  } catch (error) {
    logger.error('Error handling add card:', error);
    await ctx.answerCbQuery('Error occurred');
  }
}

/**
 * Handle cancel subscription menu
 */
async function handleCancelMenu(ctx) {
  try {
    await ctx.answerCbQuery();

    const userId = ctx.from.id.toString();
    const user = await userService.getUser(userId);
    const isSpanish = user?.language?.startsWith('es');

    const subscription = await VisaCybersourceService.getSubscriptionDetails(userId);

    if (!subscription) {
      await ctx.editMessageText(
        isSpanish ? '❌ No tienes una suscripción activa.' : '❌ You don\'t have an active subscription.',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    const periodEndStr = subscription.currentPeriodEnd?.toLocaleDateString(
      isSpanish ? 'es-ES' : 'en-US',
      { year: 'numeric', month: 'long', day: 'numeric' }
    );

    const message = isSpanish
      ? `❌ *Cancelar Suscripción*

¿Estás seguro de que deseas cancelar tu suscripción?

*Opciones:*
• *Cancelar al final del período:* Mantén acceso hasta ${periodEndStr}
• *Cancelar inmediatamente:* Pierdes acceso ahora

⚠️ Puedes reactivar en cualquier momento antes de que termine el período.`
      : `❌ *Cancel Subscription*

Are you sure you want to cancel your subscription?

*Options:*
• *Cancel at period end:* Keep access until ${periodEndStr}
• *Cancel immediately:* Lose access now

⚠️ You can reactivate anytime before the period ends.`;

    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback(
            isSpanish ? '📅 Cancelar al Final del Período' : '📅 Cancel at Period End',
            'subscription_cancel_end'
          ),
        ],
        [
          Markup.button.callback(
            isSpanish ? '⚡ Cancelar Inmediatamente' : '⚡ Cancel Immediately',
            'subscription_cancel_now'
          ),
        ],
        [
          Markup.button.callback(
            isSpanish ? '⬅️ Volver' : '⬅️ Back',
            'subscription_back'
          ),
        ],
      ]),
    });
  } catch (error) {
    logger.error('Error showing cancel menu:', error);
    await ctx.answerCbQuery('Error occurred');
  }
}

/**
 * Handle cancel subscription at period end
 */
async function handleCancelAtEnd(ctx) {
  try {
    await ctx.answerCbQuery();

    const userId = ctx.from.id.toString();
    const user = await userService.getUser(userId);
    const isSpanish = user?.language?.startsWith('es');

    const result = await VisaCybersourceService.cancelRecurringSubscription(userId, false);

    if (result.success) {
      const periodEndStr = result.currentPeriodEnd?.toLocaleDateString(
        isSpanish ? 'es-ES' : 'en-US',
        { year: 'numeric', month: 'long', day: 'numeric' }
      );

      await ctx.editMessageText(
        isSpanish
          ? `✅ *Suscripción Cancelada*

Tu suscripción se cancelará el ${periodEndStr}.

Mantienes acceso PRIME hasta esa fecha.

¿Cambiaste de opinión? Puedes reactivar con /subscription`
          : `✅ *Subscription Cancelled*

Your subscription will be cancelled on ${periodEndStr}.

You keep PRIME access until that date.

Changed your mind? Reactivate with /subscription`,
        { parse_mode: 'Markdown' }
      );
    } else {
      await ctx.editMessageText(
        isSpanish
          ? `❌ Error al cancelar: ${result.error}`
          : `❌ Error cancelling: ${result.error}`,
        { parse_mode: 'Markdown' }
      );
    }

    logger.info(`User ${userId} cancelled subscription at period end`);
  } catch (error) {
    logger.error('Error cancelling subscription:', error);
    await ctx.answerCbQuery('Error occurred');
  }
}

/**
 * Handle cancel subscription immediately
 */
async function handleCancelNow(ctx) {
  try {
    await ctx.answerCbQuery();

    const userId = ctx.from.id.toString();
    const user = await userService.getUser(userId);
    const isSpanish = user?.language?.startsWith('es');

    const result = await VisaCybersourceService.cancelRecurringSubscription(userId, true);

    if (result.success) {
      await ctx.editMessageText(
        isSpanish
          ? `✅ *Suscripción Cancelada*

Tu suscripción ha sido cancelada inmediatamente.

Tu acceso PRIME ha terminado.

¿Quieres volver? Escribe /subscribe para reactivar.`
          : `✅ *Subscription Cancelled*

Your subscription has been cancelled immediately.

Your PRIME access has ended.

Want to come back? Type /subscribe to reactivate.`,
        { parse_mode: 'Markdown' }
      );
    } else {
      await ctx.editMessageText(
        isSpanish
          ? `❌ Error al cancelar: ${result.error}`
          : `❌ Error cancelling: ${result.error}`,
        { parse_mode: 'Markdown' }
      );
    }

    logger.info(`User ${userId} cancelled subscription immediately`);
  } catch (error) {
    logger.error('Error cancelling subscription:', error);
    await ctx.answerCbQuery('Error occurred');
  }
}

/**
 * Handle reactivate subscription
 */
async function handleReactivate(ctx) {
  try {
    await ctx.answerCbQuery();

    const userId = ctx.from.id.toString();
    const user = await userService.getUser(userId);
    const isSpanish = user?.language?.startsWith('es');

    const result = await VisaCybersourceService.reactivateSubscription(userId);

    if (result.success) {
      const nextBillingStr = result.nextBillingDate?.toLocaleDateString(
        isSpanish ? 'es-ES' : 'en-US',
        { year: 'numeric', month: 'long', day: 'numeric' }
      );

      await ctx.editMessageText(
        isSpanish
          ? `🎉 *¡Suscripción Reactivada!*

Tu suscripción PRIME ha sido reactivada.

📅 *Próxima renovación:* ${nextBillingStr}

¡Gracias por quedarte con nosotros!`
          : `🎉 *Subscription Reactivated!*

Your PRIME subscription has been reactivated.

📅 *Next renewal:* ${nextBillingStr}

Thank you for staying with us!`,
        { parse_mode: 'Markdown' }
      );
    } else {
      await ctx.editMessageText(
        isSpanish
          ? `❌ Error al reactivar: ${result.error}`
          : `❌ Error reactivating: ${result.error}`,
        { parse_mode: 'Markdown' }
      );
    }

    logger.info(`User ${userId} reactivated subscription`);
  } catch (error) {
    logger.error('Error reactivating subscription:', error);
    await ctx.answerCbQuery('Error occurred');
  }
}

/**
 * Handle back to subscription menu
 */
async function handleBack(ctx) {
  try {
    await ctx.answerCbQuery();
    // Simulate /subscription command
    await handleSubscriptionCommand(ctx);
  } catch (error) {
    logger.error('Error going back:', error);
    await ctx.answerCbQuery('Error occurred');
  }
}

/**
 * Register subscription management handlers
 */
function registerSubscriptionHandlers(bot) {
  // Commands
  bot.command('subscription', handleSubscriptionCommand);

  // Callback queries
  bot.action('subscription_setup_recurring', handleSetupRecurring);
  bot.action(/^subscription_add_card_/, handleAddCard);
  bot.action('subscription_cancel_menu', handleCancelMenu);
  bot.action('subscription_cancel_end', handleCancelAtEnd);
  bot.action('subscription_cancel_now', handleCancelNow);
  bot.action('subscription_reactivate', handleReactivate);
  bot.action('subscription_update_card', handleAddCard);
  bot.action('subscription_back', handleBack);

  logger.info('Subscription management handlers registered');
}

module.exports = {
  handleSubscriptionCommand,
  handleSetupRecurring,
  handleAddCard,
  handleCancelMenu,
  handleCancelAtEnd,
  handleCancelNow,
  handleReactivate,
  handleBack,
  registerSubscriptionHandlers,
};
