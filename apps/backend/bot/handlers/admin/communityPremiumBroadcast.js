const { Markup } = require('telegraf');
const UserModel = require('../../../models/userModel');
const PermissionService = require('../../services/permissionService');
const logger = require('../../../utils/logger');
const { getLanguage } = require('../../utils/helpers');

/**
 * Community Premium Broadcast Handler
 * Sends a thank you broadcast to community with self-activation button for 1-day premium access
 */
const registerCommunityPremiumBroadcast = (bot) => {
  /**
   * Admin action to start community premium broadcast
   */
  bot.action('admin_community_premium_broadcast', async (ctx) => {
    try {
      await ctx.answerCbQuery();

      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) {
        await ctx.answerCbQuery('❌ No autorizado');
        return;
      }

      const lang = getLanguage(ctx);

      // Show confirmation
      await ctx.editMessageText(
        '🎁 **Difusión de Premium Comunitario**\n\n' +
        '¿Deseas enviar un mensaje de agradecimiento a todos los usuarios con acceso premium de 1 día?\n\n' +
        '📊 **Detalles:**\n' +
        '• Todos los usuarios recibirán el mensaje\n' +
        '• Incluye botón de auto-activación\n' +
        '• 1 día de acceso premium\n' +
        '• Mensaje bilingüe (EN/ES)\n\n' +
        '¿Continuar?',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('✅ Sí, Enviar Broadcast', 'admin_community_premium_confirm')],
            [Markup.button.callback('❌ Cancelar', 'admin_cancel')],
          ]),
        }
      );
    } catch (error) {
      logger.error('Error starting community premium broadcast:', error);
      await ctx.answerCbQuery('❌ Error al iniciar broadcast');
    }
  });

  /**
   * Confirm and send community premium broadcast
   */
  bot.action('admin_community_premium_confirm', async (ctx) => {
    try {
      await ctx.answerCbQuery('📤 Enviando broadcast...');

      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) {
        return;
      }

      await ctx.editMessageText(
        '📤 **Enviando Broadcast...**\n\nProcesando...',
        { parse_mode: 'Markdown' }
      );

      // Get all users
      const result = await UserModel.getAll(10000);
      const users = result.users;

      let sent = 0;
      let failed = 0;
      let alreadyPremium = 0;

      // Send broadcast to each user
      for (const user of users) {
        try {
          const userLang = user.language || 'en';

          // Check if user already has active premium (including lifetime)
          const hasActivePremium = user.subscriptionStatus === 'active' && (
            user.lifetimeAccess === true || // Lifetime members
            (user.planExpiry && new Date(user.planExpiry) > new Date()) // Time-limited premium
          );

          if (hasActivePremium) {
            alreadyPremium++;
            // Skip users who already have premium (including lifetime)
            continue;
          }

          const messageText = userLang === 'es'
            ? '🎉 **¡Gracias por ser parte de nuestra comunidad!**\n\n' +
              'Como agradecimiento, te ofrecemos **1 día de acceso premium GRATIS**.\n\n' +
              '✨ **Beneficios Premium:**\n' +
              '• Videos HD/4K completos\n' +
              '• Contenido exclusivo PNP\n' +
              '• Función "Quién está cerca"\n' +
              '• Soporte prioritario\n' +
              '• Sin anuncios\n\n' +
              '👇 **Haz clic abajo para activar tu premium ahora:**'
            : '🎉 **Thank you for being part of our community!**\n\n' +
              'As a token of appreciation, we\'re offering you **1 day of FREE premium access**.\n\n' +
              '✨ **Premium Benefits:**\n' +
              '• Full HD/4K videos\n' +
              '• Exclusive PNP content\n' +
              '• "Who\'s Nearby" feature\n' +
              '• Priority support\n' +
              '• No ads\n\n' +
              '👇 **Click below to activate your premium now:**';

          const buttonText = userLang === 'es' ? '✨ Activar Premium Gratis' : '✨ Activate Free Premium';

          await ctx.telegram.sendMessage(user.id, messageText, {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback(buttonText, 'activate_community_premium')],
            ]),
          });

          sent++;

          // Small delay to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 50));
        } catch (sendError) {
          failed++;
          const errorMsg = sendError.message || '';

          if (errorMsg.includes('bot was blocked') ||
              errorMsg.includes('user is deactivated') ||
              errorMsg.includes('chat not found')) {
            logger.debug('User unavailable for broadcast:', { userId: user.id });
          } else {
            logger.warn('Failed to send community premium broadcast:', {
              userId: user.id,
              error: errorMsg
            });
          }
        }
      }

      await ctx.editMessageText(
        `✅ **Broadcast Completado**\n\n` +
        `📊 **Estadísticas:**\n` +
        `✓ Enviados: ${sent}\n` +
        `✗ Fallidos: ${failed}\n` +
        `💎 Ya Premium: ${alreadyPremium}\n` +
        `📈 Total usuarios: ${users.length}\n\n` +
        `🎯 Tipo: Acceso Premium Comunitario\n` +
        `⏱️ Duración: 1 día\n` +
        `🌐 Mensajes bilingües: EN / ES`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('◀️ Volver al Panel Admin', 'admin_cancel')],
          ]),
        }
      );

      logger.info('Community premium broadcast sent', {
        adminId: ctx.from.id,
        sent,
        failed,
        alreadyPremium,
        total: users.length,
      });
    } catch (error) {
      logger.error('Error sending community premium broadcast:', error);
      await ctx.editMessageText(
        '❌ **Error al enviar el broadcast**\n\nPor favor intenta de nuevo.',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🔄 Reintentar', 'admin_community_premium_broadcast')],
            [Markup.button.callback('◀️ Volver', 'admin_cancel')],
          ]),
        }
      );
    }
  });

  /**
   * Handle community premium self-activation button
   */
  bot.action('activate_community_premium', async (ctx) => {
    try {
      await ctx.answerCbQuery('⏳ Activando premium...');

      const userId = ctx.from.id;
      const user = await UserModel.getById(userId);
      const lang = user?.language || getLanguage(ctx) || 'en';

      if (!user) {
        await ctx.reply(
          lang === 'es'
            ? '❌ Error: Usuario no encontrado. Por favor usa /start primero.'
            : '❌ Error: User not found. Please use /start first.'
        );
        return;
      }

      // Check if user already has active premium (including lifetime)
      const hasActivePremium = user.subscriptionStatus === 'active' && (
        user.lifetimeAccess === true || // Lifetime members
        (user.planExpiry && new Date(user.planExpiry) > new Date()) // Time-limited premium
      );

      if (hasActivePremium) {
        await ctx.answerCbQuery(
          lang === 'es'
            ? '✅ Ya tienes una membresía premium activa'
            : '✅ You already have an active premium membership',
          { show_alert: true }
        );
        return;
      }

      // Check if user already used this community premium promotion
      // We'll check if they have a plan_id starting with 'community_premium_'
      if (user.planId && user.planId.startsWith('community_premium_')) {
        await ctx.answerCbQuery(
          lang === 'es'
            ? '❌ Ya activaste esta promoción anteriormente'
            : '❌ You have already activated this promotion',
          { show_alert: true }
        );
        return;
      }

      // Calculate 1-day expiry
      const expiryDate = new Date();
      expiryDate.setDate(expiryDate.getDate() + 1);

      // Activate 1-day premium with special plan ID
      const currentDate = new Date().toISOString().split('T')[0];
      await UserModel.updateSubscription(userId, {
        status: 'active',
        planId: `community_premium_${currentDate}`,
        expiry: expiryDate,
      });

      logger.info('Community premium activated', {
        userId,
        expiryDate,
        source: 'community_broadcast',
      });

      // Get Telegram channel invite link
      let channelInviteLink = null;
      try {
        // Create one-time invite link for premium channel
        const inviteLink = await ctx.telegram.createChatInviteLink(
          process.env.CHANNEL_ID,
          {
            member_limit: 1, // One-time use
            name: `Premium Access - User ${userId}`,
          }
        );
        channelInviteLink = inviteLink.invite_link;
      } catch (linkError) {
        logger.error('Error creating channel invite link:', linkError);
        // Continue without link if it fails
      }

      // Send success message with channel link
      let successMessage = lang === 'es'
        ? '🎉 **¡Premium Activado!**\n\n' +
          '✅ Tu acceso premium de **1 día** ha sido activado exitosamente.\n\n' +
          `📅 Válido hasta: **${expiryDate.toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' })}**\n\n` +
          '💎 **Disfruta de:**\n' +
          '• Videos HD/4K completos\n' +
          '• Contenido exclusivo PNP\n' +
          '• Función "Quién está cerca"\n' +
          '• Soporte prioritario\n' +
          '• Sin anuncios'
        : '🎉 **Premium Activated!**\n\n' +
          '✅ Your **1-day premium access** has been successfully activated.\n\n' +
          `📅 Valid until: **${expiryDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}**\n\n` +
          '💎 **Enjoy:**\n' +
          '• Full HD/4K videos\n' +
          '• Exclusive PNP content\n' +
          '• "Who\'s Nearby" feature\n' +
          '• Priority support\n' +
          '• No ads';

      if (channelInviteLink) {
        successMessage += lang === 'es'
          ? `\n\n🔗 **Acceso Exclusivo al Canal:**\n${channelInviteLink}\n\n⚠️ _Este enlace es de un solo uso y personal._`
          : `\n\n🔗 **Exclusive Channel Access:**\n${channelInviteLink}\n\n⚠️ _This link is for one-time use only._`;
      }

      successMessage += lang === 'es'
        ? '\n\n📱 Usa /menu para explorar todas las funciones premium.'
        : '\n\n📱 Use /menu to explore all premium features.';

      await ctx.reply(successMessage, { parse_mode: 'Markdown' });

      // Update the button to show it's been activated
      try {
        await ctx.editMessageReplyMarkup({
          inline_keyboard: [
            [
              {
                text: lang === 'es' ? '✅ Premium Activado' : '✅ Premium Activated',
                callback_data: 'premium_already_activated',
              },
            ],
          ],
        });
      } catch (editError) {
        // Ignore if message is too old to edit
        logger.debug('Could not edit message markup:', editError.message);
      }

      await ctx.answerCbQuery(
        lang === 'es' ? '✅ ¡Premium activado!' : '✅ Premium activated!'
      );
    } catch (error) {
      logger.error('Error activating community premium:', error);
      const lang = getLanguage(ctx);
      await ctx.answerCbQuery(
        lang === 'es'
          ? '❌ Error al activar premium. Por favor contacta soporte.'
          : '❌ Error activating premium. Please contact support.',
        { show_alert: true }
      );
    }
  });

  // Handle already activated callback
  bot.action('premium_already_activated', async (ctx) => {
    const lang = getLanguage(ctx);
    await ctx.answerCbQuery(
      lang === 'es'
        ? 'Ya activaste tu premium de 1 día'
        : 'You already activated your 1-day premium',
      { show_alert: false }
    );
  });
};

module.exports = registerCommunityPremiumBroadcast;
