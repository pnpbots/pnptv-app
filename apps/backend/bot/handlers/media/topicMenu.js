const { Markup } = require('telegraf');
const logger = require('../../../utils/logger');

/**
 * Topic-specific menu handler for video call rooms
 * Only works in topic 3809
 */

const VIDEOCALL_TOPIC_ID = 3809;

/**
 * Register topic menu handlers
 * @param {Telegraf} bot - Bot instance
 */
const registerTopicMenuHandlers = (bot) => {
  // /startcall command - only works in topic 3809
  bot.command('startcall', async (ctx) => {
    try {
      const chatType = ctx.chat?.type;
      const messageThreadId = ctx.message?.message_thread_id;

      // Only work in groups/supergroups with specific topic
      if ((chatType === 'group' || chatType === 'supergroup') && messageThreadId === VIDEOCALL_TOPIC_ID) {
        await showVideoCallMenu(ctx, VIDEOCALL_TOPIC_ID);
      } else {
        // Silently ignore if not in the correct topic
        logger.debug(`/startcall ignored - not in topic ${VIDEOCALL_TOPIC_ID} (current: ${messageThreadId})`);
      }
    } catch (error) {
      logger.error('Error handling /startcall command:', error);
    }
  });

  // Handle video call menu actions in topic
  bot.action('topic_video_menu', async (ctx) => {
    try {
      await showVideoCallMenu(ctx, VIDEOCALL_TOPIC_ID);
    } catch (error) {
      logger.error('Error showing topic video menu:', error);
    }
  });

  bot.action('topic_create_room', async (ctx) => {
    try {
      const messageThreadId = ctx.callbackQuery?.message?.message_thread_id;
      
      if (messageThreadId === VIDEOCALL_TOPIC_ID) {
        // Redirect user to private chat with bot
        await ctx.answerCbQuery('Check your private messages! 💬', { show_alert: false });
        
        const botUsername = ctx.botInfo?.username || 'PNPtvbot';
        const username = ctx.from?.username ? `@${ctx.from.username}` : ctx.from?.first_name || 'user';
        
        // Notify in topic
        const topicMsg = `${username} I sent you a private message to join community rooms! 📹`;
        await ctx.reply(topicMsg, { message_thread_id: VIDEOCALL_TOPIC_ID });
        
        // Send private message with link
        try {
          const pmLink = `https://t.me/${botUsername}?start=hangouts_join_main`;
          const pmMsg = [
            '📹 *PNPtv Haus 24/7*',
            '',
            'Click the button below to join PNPtv Haus:',
            '',
            `[Open PNPtv Haus](${pmLink})`
          ].join('\n');

          await ctx.telegram.sendMessage(ctx.from.id, pmMsg, {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('📹 Join PNPtv Haus', 'hangouts_join_main')]
            ])
          });
        } catch (pmError) {
          logger.debug('Could not send private message:', pmError.message);
          await ctx.reply(
            `${username} Please start a private chat with me first: https://t.me/${botUsername}`,
            { message_thread_id: VIDEOCALL_TOPIC_ID }
          );
        }
      } else {
        await ctx.answerCbQuery('❌ This feature only works in the video call topic', { show_alert: true });
      }
    } catch (error) {
      logger.error('Error creating room from topic:', error);
      await ctx.answerCbQuery('❌ Error opening video rooms');
    }
  });

  bot.action('topic_close_menu', async (ctx) => {
    try {
      await ctx.deleteMessage();
      await ctx.answerCbQuery('Menu closed');
    } catch (error) {
      logger.error('Error closing topic menu:', error);
    }
  });
};

/**
 * Show video call menu in topic 3809
 * @param {Context} ctx - Telegraf context
 * @param {number} topicId - Topic ID to reply in
 */
async function showVideoCallMenu(ctx, topicId) {
  const message = [
    '📹 *Salas Comunitarias 24/7*',
    '',
    'Join PNPtv community rooms - always active!',
    '',
    '🎥 3 Rooms - 50 participants each',
    '👥 No moderator required',
    '🔓 Open guest access',
    '⚡ Instant join'
  ].join('\n');

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('🎥 Join PNPtv Haus', 'topic_create_room')],
    [Markup.button.callback('❌ Close Menu', 'topic_close_menu')]
  ]);

  const replyOptions = {
    parse_mode: 'Markdown',
    message_thread_id: topicId,
    ...keyboard
  };

  if (ctx.callbackQuery) {
    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      ...keyboard
    });
  } else {
    await ctx.reply(message, replyOptions);
  }
}

module.exports = {
  registerTopicMenuHandlers,
  showVideoCallMenu,
  VIDEOCALL_TOPIC_ID
};
