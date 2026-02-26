const { Markup } = require('telegraf');
const UserService = require('../../services/userService');
const { t } = require('../../../utils/i18n');
const logger = require('../../../utils/logger');
const { getLanguage } = require('../../utils/helpers');

/**
 * Settings handlers
 * @param {Telegraf} bot - Bot instance
 */
const registerSettingsHandlers = (bot) => {
  // Show settings menu
  bot.action('show_settings', async (ctx) => {
    try {
      const lang = getLanguage(ctx);

      await ctx.editMessageText(
        t('settingsTitle', lang),
        Markup.inlineKeyboard([
          [Markup.button.callback(t('changeLanguage', lang), 'settings_language')],
          [Markup.button.callback(t('notifications', lang), 'settings_notifications')],
          [Markup.button.callback(t('privacy', lang), 'settings_privacy')],
          [Markup.button.callback(t('about', lang), 'settings_about')],
          [Markup.button.callback(t('back', lang), 'back_to_main')],
        ]),
      );
    } catch (error) {
      logger.error('Error showing settings:', error);
    }
  });

  // Language settings
  bot.action('settings_language', async (ctx) => {
    try {
      await ctx.editMessageText(
        'Select Language / Seleccionar Idioma:',
        Markup.inlineKeyboard([
          [
            Markup.button.callback('🇺🇸 English', 'change_lang_en'),
            Markup.button.callback('🇪🇸 Español', 'change_lang_es'),
          ],
          [Markup.button.callback('← Back / Atrás', 'show_settings')],
        ]),
      );
    } catch (error) {
      logger.error('Error showing language settings:', error);
    }
  });

  // Change language
  bot.action(/^change_lang_(.+)$/, async (ctx) => {
    try {
      // Validate match result exists
      if (!ctx.match || !ctx.match[1]) {
        logger.error('Invalid language change action format');
        return;
      }

      const newLang = ctx.match[1];
      ctx.session.language = newLang;
      await ctx.saveSession();

      await UserService.updateProfile(ctx.from.id, { language: newLang });

      const lang = newLang;
      await ctx.editMessageText(
        t('languageChanged', lang),
        Markup.inlineKeyboard([
          [Markup.button.callback(t('back', lang), 'show_settings')],
        ]),
      );
    } catch (error) {
      logger.error('Error changing language:', error);
    }
  });

  // Notifications settings
  bot.action('settings_notifications', async (ctx) => {
    try {
      const lang = getLanguage(ctx);

      await ctx.editMessageText(
        `${t('notifications', lang)}\n\nNotification preferences coming soon...`,
        Markup.inlineKeyboard([
          [Markup.button.callback(t('back', lang), 'show_settings')],
        ]),
      );
    } catch (error) {
      logger.error('Error showing notifications:', error);
    }
  });

  // Privacy settings
  bot.action('settings_privacy', async (ctx) => {
    try {
      const lang = getLanguage(ctx);

      await ctx.editMessageText(
        `${t('privacy', lang)}\n\nPrivacy settings coming soon...`,
        Markup.inlineKeyboard([
          [Markup.button.callback(t('back', lang), 'show_settings')],
        ]),
      );
    } catch (error) {
      logger.error('Error showing privacy:', error);
    }
  });

  // About
  bot.action('settings_about', async (ctx) => {
    try {
      const lang = getLanguage(ctx);

      const aboutText = `${t('about', lang)}\n\n`
        + `🎬 PNPtv Bot v1.0.0\n\n`
        + `Your entertainment hub for live streams, and more!\n\n`
        + `🌐 Website: https://pnptv.com\n`
        + `📧 Support: support@pnptv.com`;
      await ctx.editMessageText(
        aboutText,
        Markup.inlineKeyboard([
          [Markup.button.callback(t('back', lang), 'show_settings')],
        ]),
      );
    } catch (error) {
      logger.error('Error showing about:', error);
    }
  });

  // Language command
  bot.command('language', async (ctx) => {
    try {
      await ctx.reply(
        'Select Language / Seleccionar Idioma:',
        Markup.inlineKeyboard([
          [
            Markup.button.callback('🇺🇸 English', 'change_lang_en'),
            Markup.button.callback('🇪🇸 Español', 'change_lang_es'),
          ],
        ]),
      );
    } catch (error) {
      logger.error('Error in /language command:', error);
    }
  });
};

module.exports = registerSettingsHandlers;
