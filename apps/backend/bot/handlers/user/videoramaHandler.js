const { Markup } = require('telegraf');
const MediaPlayerModel = require('../../../models/mediaPlayerModel');
const UserModel = require('../../../models/userModel');
const RoleService = require('../../../services/roleService');

const { query } = require('../../../config/postgres');
const logger = require('../../../utils/logger');
const { safeReplyOrEdit } = require('../../utils/helpers');
const FeatureUrlService = require('../../../services/featureUrlService');

/**
 * Videorama handlers - Media center with Radio integration
 * @param {Telegraf} bot - Bot instance
 */
const registerVideoramaHandlers = (bot) => {
  const VIDEORAMA_WEB_APP_URL = process.env.VIDEORAMA_WEB_APP_URL || 'https://pnptv.app/videorama-app';

  /**
   * Get Videorama webapp URL from backend API
   * The API endpoint handles role and subscription checking
   * @param {string} userId - User's Telegram ID
   * @param {Object} options - Additional URL options (unused, kept for compatibility)
   * @returns {Promise<string>} Full webapp URL
   */
  async function buildVideoramaUrl(userId, options = {}) {
    try {
      // Call the API service to get the URL (handles auth, role, subscription)
      return await FeatureUrlService.getVideoramaUrl(userId);
    } catch (error) {
      logger.error('Error getting Videorama URL:', error);
      return VIDEORAMA_WEB_APP_URL;
    }
  }


  // ==========================================
  // VIDEORAMA MENU
  // ==========================================

  /**
   * Show Videorama menu with media stats and radio integration
   */
  bot.action('menu_videorama', async (ctx) => {
    try {
      const lang = ctx.session?.language || 'en';
      const userId = ctx.from?.id;

      // Check if admin for pre-launch testing
      const PermissionService = require('../../../services/permissionService');
      const isAdmin = PermissionService.isEnvSuperAdmin(userId) || PermissionService.isEnvAdmin(userId);

      if (isAdmin) {
        // Show full videorama menu for admin testing
        await showVideoramaMenu(ctx);
      } else {
        // Coming soon for regular users
        await ctx.answerCbQuery(
          lang === 'es' ? '🚧 ESTRENO EL FIN DE SEMANA' : '🚧 COMING OUT THIS WEEKEND',
          { show_alert: true }
        );
      }
    } catch (error) {
      logger.error('Error in menu_videorama:', error);
    }
  });

  /**
   * Show the full videorama menu
   * @param {Context} ctx - Telegraf context
   */
  async function showVideoramaMenu(ctx) {
    try {
      await ctx.answerCbQuery();
      const lang = ctx.session?.language || 'en';
      const userId = ctx.from?.id;

      // Get media stats
      const stats = await getMediaStats();

      // Build URL with user role info
      const webappUrl = await buildVideoramaUrl(userId);

      const message = lang === 'es'
        ? `🎶 *PNP Videorama*\n\nTu centro multimedia con videos, música y podcasts.\n\n📹 *Videos:* ${stats.videos}\n🎵 *Música:* ${stats.music}\n🎙️ *Podcasts:* ${stats.podcasts}\n`
        : `🎶 *PNP Videorama*\n\nYour media center with videos, music and podcasts.\n\n📹 *Videos:* ${stats.videos}\n🎵 *Music:* ${stats.music}\n🎙️ *Podcasts:* ${stats.podcasts}\n`;

      await safeReplyOrEdit(ctx, message, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback(`📹 ${lang === 'es' ? 'Videos' : 'Videos'}`, 'videorama_videos'),
            Markup.button.callback(`🎵 ${lang === 'es' ? 'Música' : 'Music'}`, 'videorama_music'),
          ],
          [
            Markup.button.callback(`🎙️ Podcasts`, 'videorama_podcasts'),
          ],
          [Markup.button.webApp(
            lang === 'es' ? '🎬 Abrir Videorama' : '🎬 Open Videorama',
            webappUrl
          )],
          [Markup.button.callback(lang === 'es' ? '⬅️ Menú Principal' : '⬅️ Main Menu', 'back_to_main')],
        ]),
      });
    } catch (error) {
      logger.error('Error showing videorama menu:', error);
      const lang = ctx.session?.language || 'en';
      await ctx.answerCbQuery(
        lang === 'es' ? '❌ Error cargando menú' : '❌ Error loading menu',
        { show_alert: true }
      );
    }
  }



  // ==========================================
  // CATEGORY HANDLERS
  // ==========================================

  /**
   * Show videos category
   */
  bot.action('videorama_videos', async (ctx) => {
    await showMediaCategory(ctx, 'video', '📹');
  });

  /**
   * Show music category
   */
  bot.action('videorama_music', async (ctx) => {
    await showMediaCategory(ctx, 'audio', '🎵');
  });

  /**
   * Show podcasts category
   */
  bot.action('videorama_podcasts', async (ctx) => {
    await showMediaCategory(ctx, 'podcast', '🎙️');
  });

  /**
   * Show media by category
   */
  async function showMediaCategory(ctx, type, emoji) {
    try {
      await ctx.answerCbQuery();
      const lang = ctx.session?.language || 'en';
      const userId = ctx.from?.id;

      const media = await MediaPlayerModel.getMediaLibrary(type, 10);

      if (media.length === 0) {
        const message = lang === 'es'
          ? `${emoji} *Sin contenido*\n\nNo hay contenido disponible en esta categoría todavía.`
          : `${emoji} *No content*\n\nNo content available in this category yet.`;

        await safeReplyOrEdit(ctx, message, {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback(lang === 'es' ? '⬅️ Volver' : '⬅️ Back', 'menu_videorama')],
          ]),
        });
        return;
      }

      const typeName = type === 'video' ? (lang === 'es' ? 'Videos' : 'Videos')
        : type === 'audio' ? (lang === 'es' ? 'Música' : 'Music')
        : (lang === 'es' ? 'Podcasts' : 'Podcasts');

      const mediaList = media.slice(0, 8).map((item, index) => {
        const duration = item.duration ? formatDuration(item.duration) : '';
        return `${index + 1}. *${item.title}*\n   ${item.artist || (lang === 'es' ? 'Desconocido' : 'Unknown')} ${duration ? `• ${duration}` : ''}`;
      }).join('\n\n');

      const message = lang === 'es'
        ? `${emoji} *${typeName}*\n\n${mediaList}\n\n_Abre Videorama para ver más_`
        : `${emoji} *${typeName}*\n\n${mediaList}\n\n_Open Videorama to see more_`;

      // Build URL with view and user role info
      const webappUrl = await buildVideoramaUrl(userId, { view: type });

      await safeReplyOrEdit(ctx, message, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.webApp(
            lang === 'es' ? '🎬 Abrir Videorama' : '🎬 Open Videorama',
            webappUrl
          )],
          [Markup.button.callback(lang === 'es' ? '⬅️ Volver' : '⬅️ Back', 'menu_videorama')],
        ]),
      });
    } catch (error) {
      logger.error('Error showing media category:', error);
      const lang = ctx.session?.language || 'en';
      await ctx.answerCbQuery(lang === 'es' ? '❌ Error' : '❌ Error');
    }
  }

  // ==========================================
  // HELPER FUNCTIONS
  // ==========================================

  /**
   * Get media library stats
   */
  async function getMediaStats() {
    try {
      const result = await query(`
        SELECT
          COUNT(*) FILTER (WHERE type = 'video') as videos,
          COUNT(*) FILTER (WHERE type = 'audio') as music,
          COUNT(*) FILTER (WHERE type = 'podcast') as podcasts
        FROM media_library
        WHERE is_public = true
      `);

      const stats = result.rows[0] || {};
      return {
        videos: parseInt(stats.videos) || 0,
        music: parseInt(stats.music) || 0,
        podcasts: parseInt(stats.podcasts) || 0,
      };
    } catch (error) {
      logger.error('Error getting media stats:', error);
      return { videos: 0, music: 0, podcasts: 0 };
    }
  }

  

  /**
   * Format duration in seconds to MM:SS or HH:MM:SS
   */
  function formatDuration(seconds) {
    if (!seconds) return '';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;

    if (mins >= 60) {
      const hrs = Math.floor(mins / 60);
      const remainMins = mins % 60;
      return `${hrs}:${remainMins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }

    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }
};

module.exports = registerVideoramaHandlers;
