'use strict';

const { Markup } = require('telegraf');
const UserService = require('../../services/userService');
const { t } = require('../../../utils/i18n');
const logger = require('../../../utils/logger');
const { getLanguage } = require('../../utils/helpers');
const { query } = require('../../../config/postgres');
const { invalidatePrefsCache } = require('../../services/notificationEmitter');

// ── Notification preferences helpers ─────────────────────────────────────────

const NOTIF_TYPES = ['follows', 'likes', 'replies', 'announcements'];

const NOTIF_LABELS = {
  follows:       'Follows via Bot',
  likes:         'Likes via Bot',
  replies:       'Replies via Bot',
  announcements: 'Announcements via Bot',
};

/**
 * Normalise raw notification_preferences JSONB into a flat { key: boolean } map
 * representing the bot-channel state for each notification type.
 * Handles both legacy boolean format and new per-channel object format.
 */
function normalisePrefs(raw) {
  const prefs = raw && typeof raw === 'object' ? raw : {};
  const result = {};
  for (const key of NOTIF_TYPES) {
    const val = prefs[key];
    if (val === null || val === undefined) {
      result[key] = true; // default on
    } else if (typeof val === 'object') {
      result[key] = val.bot !== false; // new format
    } else {
      result[key] = val !== false; // legacy boolean
    }
  }
  return result;
}

function getQuietHours(raw) {
  const prefs = raw && typeof raw === 'object' ? raw : {};
  const qh = prefs.quiet_hours;
  if (typeof qh === 'object' && qh !== null) return qh.enabled === true;
  return qh === true; // legacy flat boolean
}

function buildNotifKeyboard(prefs, quietHours, lang) {
  const rows = NOTIF_TYPES.map((type) => {
    const label = `${NOTIF_LABELS[type]}: ${prefs[type] ? 'ON' : 'OFF'}`;
    return [Markup.button.callback(label, `notif_toggle_${type}_bot`)];
  });
  rows.push([Markup.button.callback(`Quiet Hours: ${quietHours ? 'ON' : 'OFF'}`, 'notif_quiet_hours')]);
  rows.push([Markup.button.callback(t('back', lang), 'show_settings')]);
  return Markup.inlineKeyboard(rows);
}

function buildNotifText(lang) {
  return `${t('notifications', lang)}\n\nChoose which notifications to receive via the bot:`;
}

// ── Settings handlers ─────────────────────────────────────────────────────────

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

  // Notification settings — show current state with toggleable buttons
  bot.action('settings_notifications', async (ctx) => {
    try {
      const lang = getLanguage(ctx);
      const telegramId = String(ctx.from.id);

      const { rows } = await query(
        'SELECT notification_preferences FROM users WHERE telegram = $1',
        [telegramId],
      );

      const rawPrefs = rows[0]?.notification_preferences || {};
      const prefs = normalisePrefs(rawPrefs);
      const quietHours = getQuietHours(rawPrefs);

      await ctx.editMessageText(
        buildNotifText(lang),
        buildNotifKeyboard(prefs, quietHours, lang),
      );
    } catch (error) {
      logger.error('Error showing notifications:', error);
    }
  });

  // Toggle a notification type on/off for the bot channel
  bot.action(/^notif_toggle_(.+)_(.+)$/, async (ctx) => {
    try {
      const type = ctx.match[1];

      if (!NOTIF_TYPES.includes(type)) {
        await ctx.answerCbQuery('Unknown notification type');
        return;
      }

      const lang = getLanguage(ctx);
      const telegramId = String(ctx.from.id);

      const { rows } = await query(
        'SELECT id, notification_preferences FROM users WHERE telegram = $1',
        [telegramId],
      );

      if (rows.length === 0) {
        await ctx.answerCbQuery('User not found');
        return;
      }

      const userId = rows[0].id;
      const rawPrefs = rows[0].notification_preferences || {};
      const prefs = normalisePrefs(rawPrefs);
      const quietHours = getQuietHours(rawPrefs);

      // Flip the target key
      prefs[type] = !prefs[type];

      // Build updated prefs — preserve all existing keys
      const updatedPrefs = { ...rawPrefs };
      for (const key of NOTIF_TYPES) {
        const existing = updatedPrefs[key];
        if (existing !== null && existing !== undefined && typeof existing === 'object') {
          updatedPrefs[key] = { ...existing, bot: prefs[key] };
        } else {
          // Legacy boolean or missing — set as new format
          updatedPrefs[key] = { inApp: true, bot: prefs[key], email: false, push: true };
        }
      }

      await query(
        'UPDATE users SET notification_preferences = $1 WHERE id = $2',
        [JSON.stringify(updatedPrefs), userId],
      );

      invalidatePrefsCache(userId).catch(() => {});

      await ctx.answerCbQuery(`${NOTIF_LABELS[type]} ${prefs[type] ? 'enabled' : 'disabled'}`);
      await ctx.editMessageText(
        buildNotifText(lang),
        buildNotifKeyboard(prefs, quietHours, lang),
      );
    } catch (error) {
      logger.error('Error toggling notification preference:', error);
      await ctx.answerCbQuery('Something went wrong.').catch(() => {});
    }
  });

  // Toggle quiet hours
  bot.action('notif_quiet_hours', async (ctx) => {
    try {
      const lang = getLanguage(ctx);
      const telegramId = String(ctx.from.id);

      const { rows } = await query(
        'SELECT id, notification_preferences FROM users WHERE telegram = $1',
        [telegramId],
      );

      if (rows.length === 0) {
        await ctx.answerCbQuery('User not found');
        return;
      }

      const userId = rows[0].id;
      const rawPrefs = rows[0].notification_preferences || {};
      const currentQH = getQuietHours(rawPrefs);
      const newEnabled = !currentQH;

      // Update quiet_hours as the new object format
      const updatedPrefs = { ...rawPrefs };
      if (typeof updatedPrefs.quiet_hours === 'object' && updatedPrefs.quiet_hours !== null) {
        updatedPrefs.quiet_hours = { ...updatedPrefs.quiet_hours, enabled: newEnabled };
      } else {
        updatedPrefs.quiet_hours = { enabled: newEnabled, start: '23:00', end: '08:00' };
      }

      await query(
        'UPDATE users SET notification_preferences = $1 WHERE id = $2',
        [JSON.stringify(updatedPrefs), userId],
      );

      invalidatePrefsCache(userId).catch(() => {});

      await ctx.answerCbQuery(`Quiet Hours ${newEnabled ? 'enabled' : 'disabled'}`);

      const prefs = normalisePrefs(updatedPrefs);
      await ctx.editMessageText(
        buildNotifText(lang),
        buildNotifKeyboard(prefs, newEnabled, lang),
      );
    } catch (error) {
      logger.error('Error toggling quiet hours:', error);
      await ctx.answerCbQuery('Something went wrong.').catch(() => {});
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
