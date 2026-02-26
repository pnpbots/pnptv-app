/**
 * Menu Handlers Index
 * Registers all menu-related handlers
 */

const logger = require('../../../utils/logger');
const UserModel = require('../../../models/userModel');
const {
  handleMenuCommand,
  handleDeepLinkStart,
  handleMenuCallback
} = require('./menuHandler');
const {
  handleCristinaCommand,
  handleCristinaCallback
} = require('../support/cristinaAI');

/**
 * Register all menu handlers
 */
function registerMenuHandlers(bot) {
  try {
    // NOTE: /menu is handled by `src/bot/handlers/media/menu.js` to ensure the group menu is consistent.

    // Register /cristina command
    bot.command('cristina', handleCristinaCommand);

    // Override /start to handle deep links
    bot.start(handleDeepLinkStart);

    // Register menu callback actions
    bot.action(/^menu:/, handleMenuCallback);

    // Register Cristina AI callbacks
    bot.action(/^cristina:/, handleCristinaCallback);

    // Register language selection callbacks
    bot.action(/^lang:/, async (ctx) => {
      try {
        const lang = ctx.callbackQuery.data.split(':')[1];

        // Save language preference to database
        const updated = await UserModel.updateProfile(ctx.from.id, { language: lang });

        if (!updated) {
          logger.warn(`Failed to save language preference for user ${ctx.from.id}`);
        }

        await ctx.answerCbQuery(
          lang === 'es'
            ? '✅ Idioma actualizado a Español'
            : '✅ Language updated to English'
        );

        const message = lang === 'es'
          ? '🌍 *Idioma Actualizado*\n\nTu idioma ha sido actualizado a Español.\n\nUsa /menu para continuar.'
          : '🌍 *Language Updated*\n\nYour language has been updated to English.\n\nUse /menu to continue.';

        await ctx.editMessageText(message, {
          parse_mode: 'Markdown'
        });

        logger.info(`Language preference updated to ${lang} for user ${ctx.from.id}`);
      } catch (error) {
        logger.error('Error handling language selection:', error);
      }
    });

    logger.info('Menu handlers registered successfully');
  } catch (error) {
    logger.error('Error registering menu handlers:', error);
    throw error;
  }
}

module.exports = registerMenuHandlers;
