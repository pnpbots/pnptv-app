const logger = require('../../utils/logger');
const {
  getGroupRedirectNotification,
  getRequirePrivateChatPrompt,
} = require('../../config/groupMessages');

/**
 * Send notification to group chat that user was redirected to private chat
 */
async function notifyGroupRedirect(ctx, commandName) {
  try {
    const username = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name;
    const message = getGroupRedirectNotification({ username, commandName });

    await ctx.reply(message, {
      reply_to_message_id: ctx.message?.message_id,
    });

    logger.info(`Group redirect notification sent for user ${ctx.from.id}`);
  } catch (error) {
    logger.error('Error sending group redirect notification:', error);
  }
}

/**
 * Send message to user in private chat
 */
async function sendPrivateMessage(bot, userId, message, options = {}) {
  try {
    await bot.telegram.sendMessage(userId, message, options);
    logger.info(`Private message sent to user ${userId}`);
    return true;
  } catch (error) {
    logger.error(`Error sending private message to user ${userId}:`, error);
    return false;
  }
}

/**
 * Handle command that requires private chat
 * If in group, notify and redirect to private
 */
async function requirePrivateChat(ctx, commandName, privateMessage, options = {}) {
  const isGroup = ['group', 'supergroup'].includes(ctx.chat?.type);

  if (isGroup) {
    // Notify in group
    await notifyGroupRedirect(ctx, commandName);

    // Send private message
    try {
      await ctx.telegram.sendMessage(ctx.from.id, privateMessage, options);
      return false; // Indicates command was redirected
    } catch (error) {
      // User might not have started the bot
      const userDisplay = ctx.from.username ? '@' + ctx.from.username : ctx.from.first_name;
      await ctx.reply(
        getRequirePrivateChatPrompt({
          username: userDisplay,
          botUsername: ctx.botInfo?.username,
        }),
        { reply_to_message_id: ctx.message?.message_id }
      );
      return false;
    }
  }

  return true; // Continue processing in private chat
}

/**
 * Send notification to admin(s)
 */
async function notifyAdmins(bot, adminIds, message, options = {}) {
  const results = [];

  for (const adminId of adminIds) {
    try {
      await bot.telegram.sendMessage(adminId, message, options);
      results.push({ adminId, success: true });
      logger.info(`Admin notification sent to ${adminId}`);
    } catch (error) {
      results.push({ adminId, success: false, error: error.message });
      logger.error(`Error sending notification to admin ${adminId}:`, error);
    }
  }

  return results;
}

/**
 * Send subscription expiry reminder
 */
async function sendSubscriptionReminder(bot, userId, daysLeft, language = 'en') {
  const messages = {
    en: `⏰ Your subscription will expire in ${daysLeft} days. Please renew to continue enjoying premium features!`,
    es: `⏰ Tu suscripción expirará en ${daysLeft} días. ¡Por favor renueva para seguir disfrutando de las funciones premium!`,
  };

  try {
    await bot.telegram.sendMessage(userId, messages[language] || messages.en, {
      reply_markup: {
        inline_keyboard: [
          [{ text: language === 'es' ? '💎 Renovar' : '💎 Renew', callback_data: 'menu_subscribe' }],
        ],
      },
    });
    logger.info(`Subscription reminder sent to user ${userId}`);
  } catch (error) {
    logger.error(`Error sending subscription reminder to user ${userId}:`, error);
  }
}

/**
 * Send welcome message
 */
async function sendWelcomeMessage(ctx, language = 'en') {
  const messages = {
    en: `🎉 Welcome to PNPtv!

We're excited to have you join our community. Here's what you can do:

📍 Connect with nearby users
🎥 Watch live streams

🎥 Join private Hangouts (video rooms)
💎 Subscribe for premium features

Let's get started!`,
    es: `🎉 ¡Bienvenido a PNPtv!

Estamos emocionados de que te unas a nuestra comunidad. Esto es lo que puedes hacer:

📍 Conecta con usuarios cercanos
🎥 Ver transmisiones en vivo

🎥 Unirse a Hangouts privados (video rooms)
💎 Suscríbete para funciones premium

¡Comencemos!`,
  };

  try {
    await ctx.reply(messages[language] || messages.en);
    logger.info(`Welcome message sent to user ${ctx.from.id}`);
  } catch (error) {
    logger.error('Error sending welcome message:', error);
  }
}

module.exports = {
  notifyGroupRedirect,
  sendPrivateMessage,
  requirePrivateChat,
  notifyAdmins,
  sendSubscriptionReminder,
  sendWelcomeMessage,
};
