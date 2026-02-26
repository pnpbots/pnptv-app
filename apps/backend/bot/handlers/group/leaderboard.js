const { Markup } = require('telegraf');
const logger = require('../../../utils/logger');
const TopicConfigModel = require('../../../models/topicConfigModel');

/**
 * Leaderboard Handler
 * Displays topic-specific leaderboards for user engagement
 */

/**
 * Show leaderboard for a topic
 */
async function showLeaderboard(ctx) {
  try {
    const messageThreadId = ctx.message?.message_thread_id;
    const lang = ctx.from.language_code === 'es' ? 'es' : 'en';

    if (!messageThreadId) {
      await ctx.reply(
        lang === 'es'
          ? '⚠️ Este comando solo funciona en temas del grupo.'
          : '⚠️ This command only works in group topics.'
      );
      return;
    }

    // Get topic configuration
    const topicConfig = await TopicConfigModel.getByThreadId(messageThreadId);

    if (!topicConfig || !topicConfig.enable_leaderboard) {
      await ctx.reply(
        lang === 'es'
          ? '⚠️ El ranking no está habilitado en este tema.'
          : '⚠️ Leaderboard is not enabled in this topic.'
      );
      return;
    }

    // Get leaderboards
    const topPosters = await TopicConfigModel.getLeaderboard(messageThreadId, 'media', 10);
    const topReactors = await TopicConfigModel.getLeaderboard(messageThreadId, 'reactions_given', 10);
    const mostLiked = await TopicConfigModel.getLeaderboard(messageThreadId, 'reactions_received', 10);

    // Build leaderboard message
    let message = lang === 'es'
      ? `🏆 **Ranking de ${topicConfig.topic_name}**\n\n`
      : `🏆 **${topicConfig.topic_name} Leaderboard**\n\n`;

    // Top media posters
    message += lang === 'es'
      ? '📸 **Usuarios con más fotos/videos:**\n'
      : '📸 **Top Media Sharers:**\n';

    if (topPosters.length > 0) {
      topPosters.forEach((user, index) => {
        const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
        message += `${medal} @${user.username || 'User'} - ${user.total_media_shared} ${lang === 'es' ? 'medios' : 'media'}\n`;
      });
    } else {
      message += lang === 'es' ? '_No hay datos aún_\n' : '_No data yet_\n';
    }

    message += '\n';

    // Most liked content
    message += lang === 'es'
      ? '❤️ **Contenido más popular:**\n'
      : '❤️ **Most Liked Content:**\n';

    if (mostLiked.length > 0) {
      mostLiked.forEach((user, index) => {
        const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
        message += `${medal} @${user.username || 'User'} - ${user.total_reactions_received} ${lang === 'es' ? 'reacciones' : 'reactions'}\n`;
      });
    } else {
      message += lang === 'es' ? '_No hay datos aún_\n' : '_No data yet_\n';
    }

    message += '\n';

    // Most reactions given (users who react the most)
    message += lang === 'es'
      ? '👍 **Usuarios que más reaccionan:**\n'
      : '👍 **Most Active Reactors:**\n';

    if (topReactors.length > 0) {
      topReactors.forEach((user, index) => {
        const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
        message += `${medal} @${user.username || 'User'} - ${user.total_reactions_given} ${lang === 'es' ? 'reacciones' : 'reactions'}\n`;
      });
    } else {
      message += lang === 'es' ? '_No hay datos aún_\n' : '_No data yet_\n';
    }

    message += '\n_' + (lang === 'es'
      ? 'Actualizado en tiempo real • Sigue compartiendo!'
      : 'Updated in real-time • Keep sharing!') + '_';

    await ctx.reply(message, {
      parse_mode: 'Markdown',
      message_thread_id: messageThreadId
    });

  } catch (error) {
    logger.error('Error showing leaderboard:', error);
    await ctx.reply('❌ Error al mostrar el ranking.');
  }
}

/**
 * Register leaderboard handlers
 */
function registerLeaderboardHandlers(bot) {
  // Command: /leaderboard or /ranking
  bot.command('leaderboard', showLeaderboard);
  bot.command('ranking', showLeaderboard);
  bot.command('top', showLeaderboard);
}

module.exports = {
  showLeaderboard,
  registerLeaderboardHandlers
};
