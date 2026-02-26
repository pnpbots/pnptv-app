const { Markup } = require('telegraf');
const UserService = require('../../services/userService');
const { t } = require('../../../utils/i18n');
const logger = require('../../../utils/logger');
const { getLanguage } = require('../../utils/helpers');

/**
 * Legacy nearby users handlers - kept for backward compatibility
 * Main nearby functionality is now in nearbyUnified.js
 * @param {Telegraf} bot - Bot instance
 */
const registerNearbyHandlers = (bot) => {

  // Legacy radius selection handler (for old UI that used radius buttons)
  bot.action(/^nearby_radius_(\d+)$/, async (ctx) => {
    try {
      const radius = parseInt(ctx.match[1], 10);
      const lang = getLanguage(ctx);

      if (!ctx.from?.id) {
        logger.error('Missing user context in nearby users search');
        await ctx.reply(t('error', lang));
        return;
      }

      const userId = ctx.from.id;

      // Check if user has location set
      const currentUser = await UserService.getOrCreateFromContext(ctx);
      if (!currentUser.location || !currentUser.location.lat) {
        const noLocationText =
          lang === 'es'
            ? '`📍 Ubicación Requerida`\n\n' +
              'Necesitas compartir tu ubicación primero!\n\n' +
              '_Ve a tu Perfil → Ubicación para compartir tu ubicación._'
            : '`📍 Location Required`\n\n' +
              'You need to share your location first!\n\n' +
              '_Go to your Profile → Location to share your location._';

        await ctx.editMessageText(
          noLocationText,
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback(lang === 'es' ? '📝 Ir al Perfil' : '📝 Go to Profile', 'edit_profile')],
              [Markup.button.callback('🔙 Back', 'show_nearby')],
            ]),
          }
        );
        return;
      }

      await ctx.editMessageText(
        lang === 'es' ? '🔍 _Escaneando tu área..._' : '🔍 _Scanning your area..._',
        { parse_mode: 'Markdown' }
      );

      const nearbyUsers = await UserService.getNearbyUsers(userId, radius);

      if (nearbyUsers.length === 0) {
        const noResultsText =
          lang === 'es'
            ? '`😢 Sin Resultados`\n\n' +
              `No se encontraron usuarios dentro de ${radius} km 😔\n\n` +
              '_Intenta un radio más grande o vuelve más tarde!_'
            : '`😢 No Results`\n\n' +
              `No users found within ${radius} km 😔\n\n` +
              '_Try a larger radius or check back later!_';

        await ctx.editMessageText(
          noResultsText,
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('🔄 Try Again', 'show_nearby')],
              [Markup.button.callback('🔙 Back', 'back_to_main')],
            ]),
          }
        );
        return;
      }

      // Show list of nearby users
      let message =
        lang === 'es'
          ? '`🔥 Usuarios Cercanos 🔥`\n\n' +
            `Encontrados **${nearbyUsers.length}** usuarios dentro de ${radius} km 👀\n\n`
          : '`🔥 Nearby Users 🔥`\n\n' +
            `Found **${nearbyUsers.length}** users within ${radius} km 👀\n\n`;

      const buttons = [];
      nearbyUsers.slice(0, 10).forEach((user, index) => {
        const name = user.firstName || 'Anonymous';
        const distance = user.distance.toFixed(1);
        const emoji = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '👤';
        message += `${emoji} **${name}** - _${distance} km away_\n`;

        const label = user.username ? `@${user.username}` : name;
        buttons.push([Markup.button.callback(`View ${label}`, `view_user_${user.id}`)]);
      });

      message += lang === 'es'
        ? '\n_Toca para ver el perfil_ 😏'
        : '\n_Tap to view the profile_ 😏';

      buttons.push([Markup.button.callback('🔙 Back', 'show_nearby')]);

      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(buttons),
      });
    } catch (error) {
      logger.error('Error showing nearby users by radius:', error);
      const lang = getLanguage(ctx);
      await ctx.reply(t('error', lang));
    }
  });
};

module.exports = registerNearbyHandlers;
