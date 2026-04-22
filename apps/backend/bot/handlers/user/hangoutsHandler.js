const { Markup } = require('telegraf');
const logger = require('../../../utils/logger');
const { safeReplyOrEdit } = require('../../utils/helpers');
const FeatureUrlService = require('../../../services/featureUrlService');

/**
 * Hangouts handlers for video calls and main rooms
 * @param {Telegraf} bot - Bot instance
 */
const registerHangoutsHandlers = (bot) => {
  /**
   * Web-first /hangout command
   * Calls backend API to get the Hangouts web app URL
   */
  bot.command('hangout', async (ctx) => {
    try {
      const lang = ctx.session?.language || 'en';
      const userId = ctx.from?.id;

      if (!userId) {
        await ctx.reply(lang === 'es' ? '❌ Usuario no identificado.' : '❌ User not identified.');
        return;
      }

      // Call the API service to get the hangout URL
      const webAppUrl = await FeatureUrlService.getHangoutUrl(userId);

      const message = lang === 'es'
        ? '🎥 *PNP Hangouts* ha sido movido a nuestra aplicación web para una mejor experiencia.'
        : '🎥 *PNP Hangouts* has been moved to our web app for a better experience.';

      await ctx.reply(message, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.webApp(lang === 'es' ? '🚀 Abrir Hangouts' : '🚀 Open Hangouts', webAppUrl)],
        ]),
      });
    } catch (error) {
      logger.error('Error in /hangout command:', error);
      const lang = ctx.session?.language || 'en';
      await ctx.reply(lang === 'es' ? '❌ No se pudo cargar Hangouts.' : '❌ Could not load Hangouts.');
    }
  });

  // ==========================================
  // HANGOUTS MENU
  // ==========================================

  /**
   * Show hangouts menu (replaces menu_hangouts in menu.js)
   * This provides the full hangouts experience with video calls and main rooms
   */
  bot.action('hangouts_menu', async (ctx) => {
    try {
      const lang = ctx.session?.language || 'en';
      const user = ctx.session?.user || {};
      const userId = ctx.from?.id;

      // Check if admin for pre-launch testing
      const PermissionService = require('../../../services/permissionService');
      const isAdmin = PermissionService.isEnvSuperAdmin(userId) || PermissionService.isEnvAdmin(userId);

      if (isAdmin) {
        // Show full hangouts menu for admin testing
        await showHangoutsMenu(ctx);
      } else {
        // Coming soon for regular users
        await ctx.answerCbQuery(
          lang === 'es' ? '🚧 ESTRENO EL FIN DE SEMANA' : '🚧 COMING OUT THIS WEEKEND',
          { show_alert: true }
        );
      }
    } catch (error) {
      logger.error('Error in hangouts_menu:', error);
    }
  });

  /**
   * Show the full hangouts menu
   * @param {Context} ctx - Telegraf context
   */
  async function showHangoutsMenu(ctx) {
    try {
      await ctx.answerCbQuery();
      const lang = ctx.session?.language || 'en';
      const userId = ctx.from?.id;

      // Get the hangout URL
      const webAppUrl = await FeatureUrlService.getHangoutUrl(userId);

      const message = lang === 'es'
        ? `🎥 *PNP Hangouts*\n\n` +
          `Las videollamadas y salas comunitarias se han movido a nuestra plataforma web.\n\n` +
          `Únete a conversaciones en vivo, comparte medios y conoce a la comunidad en tiempo real.`
        : `🎥 *PNP Hangouts*\n\n` +
          `Video calls and community rooms have moved to our web platform.\n\n` +
          `Join live conversations, share media, and meet the community in real time.`;

      await safeReplyOrEdit(ctx, message, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.webApp(lang === 'es' ? '🚀 Abrir Hangouts' : '🚀 Open Hangouts', webAppUrl)],
          [Markup.button.callback(lang === 'es' ? '⬅️ Menú Principal' : '⬅️ Main Menu', 'back_to_main')],
        ]),
      });
    } catch (error) {
      logger.error('Error showing hangouts menu:', error);
      const lang = ctx.session?.language || 'en';
      await ctx.answerCbQuery(
        lang === 'es' ? '❌ Error cargando menú' : '❌ Error loading menu',
        { show_alert: true }
      );
    }
  }

  // Legacy actions now redirected or disabled
  bot.action('create_video_call', showHangoutsMenu);
  bot.action('my_active_calls', showHangoutsMenu);
  bot.action(/^view_call_(.+)$/, showHangoutsMenu);
  bot.action(/^end_call_(.+)$/, async (ctx) => {
    const lang = ctx.session?.language || 'en';
    await ctx.answerCbQuery(lang === 'es' ? 'Llamada terminada en la WebApp' : 'Call ended in WebApp', { show_alert: true });
  });

};

module.exports = registerHangoutsHandlers;
module.exports.registerHangoutsHandlers = registerHangoutsHandlers;
