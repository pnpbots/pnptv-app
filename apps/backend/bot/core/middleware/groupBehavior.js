const logger = require('../../../utils/logger');
const ChatCleanupService = require('../../../services/chatCleanupService');
const PermissionService = require('../../../services/permissionService');
const {
  getPersonalInfoRedirect,
  getCallbackRedirectText,
  getHangoutChatRedirectMessage,
  getHangoutCommandRedirectMessage,
} = require('../../../config/groupMessages');

// Per-user cooldown for hangout redirect notices (avoids spamming on every message)
const hangoutRedirectCooldown = {};

/**
 * Lookup whether a Telegram chat is linked to a hangout group.
 * Returns { hangoutId, hangoutName } or null if not linked.
 * Results are cached in Redis for 5 minutes.
 */
async function getLinkedHangout(chatId) {
  try {
    const { getRedis } = require('../../config/redis');
    const { query: dbQuery } = require('../../../config/postgres');
    const redis = getRedis();
    // Use a separate key for the full object (rules included) so the bridge's
    // tg-hangout-link:<chatId> integer cache in bot.js is not disrupted.
    const fullCacheKey = `tg-hangout-full:${chatId}`;
    const noneKey = `tg-hangout-link:${chatId}`;

    // Fast-path: if the simple bridge cache says 'none', no need to hit DB
    const noneCheck = await redis.get(noneKey);
    if (noneCheck === 'none') return null;

    const cached = await redis.get(fullCacheKey);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        return { hangoutId: parsed.id, hangoutName: parsed.name || null, hangoutRules: parsed.rules || null };
      } catch (_) { /* fall through to DB */ }
    }

    const { rows } = await dbQuery(
      'SELECT id, name, rules FROM hangout_groups WHERE telegram_chat_id = $1 LIMIT 1',
      [chatId]
    );
    if (rows.length === 0) {
      await redis.set(noneKey, 'none', 'EX', 300);
      return null;
    }

    const { id, name, rules } = rows[0];
    await redis.set(fullCacheKey, JSON.stringify({ id, name: name || null, rules: rules || null }), 'EX', 300);
    return { hangoutId: id, hangoutName: name || null, hangoutRules: rules || null };
  } catch (err) {
    logger.debug('getLinkedHangout error:', err.message);
    return null;
  }
}

const GROUP_ID = process.env.GROUP_ID;
const PRIME_CHANNEL_ID = process.env.PRIME_CHANNEL_ID;
const NOTIFICATIONS_TOPIC_ID = parseInt(process.env.NOTIFICATIONS_TOPIC_ID || '10682', 10);
const AUTO_DELETE_DELAY = 3 * 60 * 1000; // 3 minutes
const CRISTINA_INVOCATION_REGEX = /\b(?:ey|hey)\s*[,.:;!?-]?\s*cristina\b/i;

// Cache valid topic IDs per chat to avoid repeated failed attempts
const validTopicsPerChat = {};

/**
 * PRIME Channel Silent Redirect Middleware
 * Makes PRIME channel 100% clean - NO bot messages at all
 * Silently redirects ALL user interactions to private chat
 */
function primeChannelSilentRedirectMiddleware() {
  return async (ctx, next) => {
    const chatId = ctx.chat?.id?.toString();
    const isGroup = ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup';

    // Only apply to PRIME channel
    if (!isGroup || !PRIME_CHANNEL_ID || chatId !== PRIME_CHANNEL_ID) {
      return next();
    }

    const userId = ctx.from?.id;

    // PRIME channel must stay clean: block bot responses for everyone

    // BLOCK ALL BOT RESPONSES IN PRIME CHANNEL
    // Override ctx.reply to silently block any message
    const originalReply = ctx.reply?.bind(ctx);
    ctx.reply = async () => {
      logger.debug('Blocked bot reply in PRIME channel', { chatId, userId });
      return null; // Silently block
    };

    // Override ctx.replyWithMarkdown
    ctx.replyWithMarkdown = async () => null;
    ctx.replyWithHTML = async () => null;
    ctx.replyWithPhoto = async () => null;
    ctx.replyWithVideo = async () => null;
    ctx.replyWithDocument = async () => null;
    ctx.replyWithAudio = async () => null;
    ctx.replyWithVoice = async () => null;
    ctx.replyWithSticker = async () => null;
    ctx.replyWithAnimation = async () => null;

    // Override editMessageText to block edits
    const originalEditMessageText = ctx.editMessageText?.bind(ctx);
    ctx.editMessageText = async () => {
      logger.debug('Blocked bot edit in PRIME channel', { chatId, userId });
      return null;
    };

    // Store original sendMessage to use for private messages
    const originalSendMessage = ctx.telegram.sendMessage.bind(ctx.telegram);

    // Override ctx.telegram.sendMessage to block messages TO the PRIME channel
    ctx.telegram.sendMessage = async (targetChatId, text, extra = {}) => {
      const targetChatIdStr = targetChatId?.toString();
      // Block messages to PRIME channel, allow to other chats
      if (targetChatIdStr === PRIME_CHANNEL_ID) {
        logger.debug('Blocked sendMessage to PRIME channel', { targetChatId });
        return null;
      }
      return originalSendMessage(targetChatId, text, extra);
    };

    // Check if this is any user interaction
    const messageText = ctx.message?.text || '';
    const isCommand = messageText.startsWith('/');
    const isCallback = ctx.callbackQuery;
    const isAnyMessage = ctx.message;

    // Delete user's message silently if it's a command or bot mention
    if (ctx.message?.message_id && (isCommand || messageText.includes('@'))) {
      try {
        await ctx.deleteMessage();
      } catch (error) {
        logger.debug('Could not delete user message in PRIME channel:', error.message);
      }
    }

    // Answer callback silently if it's a callback query
    if (isCallback) {
      try {
        await ctx.answerCbQuery();
      } catch (error) {
        logger.debug('Could not answer callback in PRIME channel:', error.message);
      }
    }

    // Only send private redirect for commands/callbacks (not every message)
    if (isCommand || isCallback) {
      const userLang = ctx.session?.language || ctx.from?.language_code || 'en';
      const isSpanish = userLang.startsWith('es');
      const botUsername = ctx.botInfo?.username || 'PNPLatinoTV_bot';

      // Send private message to user redirecting them to bot
      try {
        const privateMessage = isSpanish
          ? `👋 ¡Hola! Para usar el menú y todas las funciones del bot, por favor usa nuestro chat privado.\n\n👉 Toca aquí: @${botUsername}`
          : `👋 Hi! To use the menu and all bot features, please use our private chat.\n\n👉 Tap here: @${botUsername}`;

        await originalSendMessage(userId, privateMessage);
        logger.info('User silently redirected from PRIME channel to private chat', { userId, chatId });
      } catch (error) {
        // User might have blocked the bot or never started it
        logger.debug('Could not send private redirect message:', error.message);
      }
    }

    // Don't proceed with normal handler chain - channel stays 100% clean
    return;
  };
}

/**
 * Group Behavior Middleware
 * Redirects ALL bot responses to private chat instead of the group.
 * Keeps the community group clean - no bot spam.
 */
function groupBehaviorMiddleware() {
  return async (ctx, next) => {
    const isGroup = ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup';
    const chatId = ctx.chat?.id;
    const chatIdStr = chatId?.toString();

    if (!isGroup) return next();

    const messageText = ctx.message?.text || '';
    if (CRISTINA_INVOCATION_REGEX.test(messageText)) {
      return next();
    }

    const userId = ctx.from?.id;
    const isAdmin = userId && (
      PermissionService.isEnvSuperAdmin(userId) ||
      PermissionService.isEnvAdmin(userId)
    );
    const incomingText = messageText.toLowerCase();
    const isCommand = incomingText.startsWith('/');
    const botUsername = ctx.botInfo?.username || 'PNPLatinoTV_bot';
    const userLang = ctx.session?.language || ctx.from?.language_code || 'en';
    const displayName = ctx.from?.username || ctx.from?.first_name || 'friend';

    // ── Check if this group is linked to a hangout ──────────────────────────
    const linkedHangout = await getLinkedHangout(chatId);

    // For groups that are neither GROUP_ID nor a linked hangout group, skip entirely
    const isMainGroup = GROUP_ID && chatIdStr === GROUP_ID;
    if (!isMainGroup && !linkedHangout) {
      return next();
    }

    // Store original sendMessage for private fallback
    const originalSendMessage = ctx.telegram.sendMessage.bind(ctx.telegram);

    // Admins can use bot normally in group, but still delete their commands
    if (isAdmin) {
      if (isCommand && ctx.message?.message_id) {
        try {
          await ctx.deleteMessage();
        } catch (e) {
          ChatCleanupService.scheduleDelete(
            ctx.telegram,
            chatId,
            ctx.message.message_id,
            'admin-command-delete',
            500
          );
        }
      }
      return next();
    }

    if (linkedHangout) {
      // ── GROUP IS LINKED TO A HANGOUT ──────────────────────────────────────
      // Commands are disabled; all messages redirect to the webapp hangout.

      if (isCommand && ctx.message?.message_id) {
        // Delete the command to keep group clean
        ChatCleanupService.scheduleDelete(
          ctx.telegram,
          chatId,
          ctx.message.message_id,
          'hangout-group-command-delete',
          2000
        );

        // Send webapp redirect with direct hangout link
        const { text, buttonText, buttonUrl } = getHangoutCommandRedirectMessage({
          lang: userLang,
          hangoutId: linkedHangout.hangoutId,
          hangoutName: linkedHangout.hangoutName,
          rules: linkedHangout.hangoutRules,
        });

        try {
          const notice = await originalSendMessage(chatId, text, {
            message_thread_id: ctx.message?.message_thread_id,
            reply_markup: { inline_keyboard: [[{ text: buttonText, url: buttonUrl }]] },
          });
          if (notice) {
            ChatCleanupService.scheduleDelete(
              ctx.telegram, chatId, notice.message_id, 'hangout-cmd-notice', 15000
            );
          }
        } catch (err) {
          logger.debug('Could not send hangout command redirect:', err.message);
        }

        // Do NOT call next() — suppress all command processing
        return;
      }

      // Linked hangout groups are already bridged into the app in real time.
      // Do not inject Cristina redirect notices on normal chat messages here;
      // they add noise and make the Telegram side feel spammy.

      // Still call next() so the bridge handler can mirror the message to the webapp
      return next();
    }

    // ── GROUP IS NOT LINKED TO A HANGOUT — standard bot redirect behavior ──

    // Override ctx.reply to send to private chat instead
    ctx.reply = async (text, extra = {}) => {
      try {
        const privateExtra = { ...extra };
        delete privateExtra.message_thread_id;
        delete privateExtra.reply_to_message_id;

        const message = await originalSendMessage(userId, text, privateExtra);
        logger.debug('Bot response redirected to private chat', { userId, groupChatId: chatId });
        return message;
      } catch (error) {
        if (error.description && error.description.includes('bot was blocked')) {
          logger.info('User has blocked bot, cannot send private message', { userId });
        } else if (error.description && error.description.includes("bot can't initiate")) {
          logger.info('User has not started bot, cannot send private message', { userId });
        } else {
          logger.error(`Failed to send private message: ${error.message}`);
        }
        return null;
      }
    };

    ctx.replyWithMarkdown = ctx.reply;
    ctx.replyWithHTML = ctx.reply;

    ctx.telegram.sendMessage = async (targetChatId, text, extra = {}) => {
      const targetChatIdStr = targetChatId?.toString();
      const isTargetGroup = GROUP_ID ? targetChatIdStr === GROUP_ID : targetChatIdStr?.startsWith('-');

      if (isTargetGroup && userId) {
        const privateExtra = { ...extra };
        delete privateExtra.message_thread_id;
        delete privateExtra.reply_to_message_id;
        try {
          return await originalSendMessage(userId, text, privateExtra);
        } catch (error) {
          logger.debug('Could not redirect group message to private:', error.message);
          return null;
        }
      }
      return originalSendMessage(targetChatId, text, extra);
    };

    if (isCommand && ctx.message?.message_id) {
      ChatCleanupService.scheduleDelete(
        ctx.telegram, chatId, ctx.message.message_id, 'group-user-command', 5000
      );
    }

    if (isCommand) {
      const isSpanish = userLang.startsWith('es');
      const redirectNotice = isSpanish
        ? `💬 @${displayName}, revisa tu chat privado con @${botUsername}`
        : `💬 @${displayName}, check your private chat with @${botUsername}`;

      try {
        const notice = await originalSendMessage(chatId, redirectNotice, {
          message_thread_id: ctx.message?.message_thread_id || NOTIFICATIONS_TOPIC_ID,
        });
        if (notice) {
          ChatCleanupService.scheduleDelete(
            ctx.telegram, chatId, notice.message_id, 'group-redirect-notice', 10000
          );
        }
      } catch (error) {
        logger.debug('Could not send redirect notice:', error.message);
      }
    }

    // Regular text in non-linked group: generic hangout redirect
    const isRegularTextMessage = ctx.message?.text && !isCommand;
    if (isRegularTextMessage && userId) {
      const HANGOUT_COOLDOWN_MS = 10 * 60 * 1000;
      const cooldownKey = `u${userId}`;
      const lastSent = hangoutRedirectCooldown[cooldownKey] || 0;

      if (Date.now() - lastSent > HANGOUT_COOLDOWN_MS) {
        hangoutRedirectCooldown[cooldownKey] = Date.now();

        const { text, buttonText, buttonUrl } = getHangoutChatRedirectMessage({
          username: displayName,
          lang: userLang,
        });

        try {
          const notice = await originalSendMessage(chatId, text, {
            message_thread_id: ctx.message?.message_thread_id,
            reply_to_message_id: ctx.message?.message_id,
            reply_markup: { inline_keyboard: [[{ text: buttonText, url: buttonUrl }]] },
          });
          if (notice) {
            ChatCleanupService.scheduleDelete(
              ctx.telegram, chatId, notice.message_id, 'hangout-redirect-notice', AUTO_DELETE_DELAY
            );
          }
          logger.info('Hangout redirect sent for group chat message', { userId, chatId });
        } catch (error) {
          logger.debug('Could not send hangout redirect notice:', error.message);
        }
      }
    }

    return next();
  };
}

/**
 * Cristina AI Group Filter Middleware
 * Detects personal information in Cristina responses and redirects to private chat
 */
function cristinaGroupFilterMiddleware() {
  return async (ctx, next) => {
    const isGroup = ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup';

    if (!isGroup) {
      return next();
    }

    // Personal info keywords (English & Spanish)
    const personalInfoKeywords = [
      // English
      'my email', 'my phone', 'my password', 'credit card', 'billing',
      'login', 'credentials', 'my address', 'my account',
      // Spanish
      'mi email', 'mi correo', 'mi teléfono', 'mi contraseña',
      'tarjeta de crédito', 'factura', 'iniciar sesión',
      'mi dirección', 'mi cuenta'
    ];

    const messageText = ctx.message?.text?.toLowerCase() || '';

    // Check if message contains personal info keywords
    const containsPersonalInfo = personalInfoKeywords.some(keyword =>
      messageText.includes(keyword.toLowerCase())
    );

    if (containsPersonalInfo) {
      const userLang = ctx.from?.language_code || 'en';
      const redirectMessage = getPersonalInfoRedirect(userLang);

      // Delete original message
      try {
        await ctx.deleteMessage();
      } catch (error) {
        logger.debug('Could not delete message with personal info:', error.message);
      }

      // Send redirect notice - Cristina messages are NOT auto-deleted
      await ctx.reply(redirectMessage);

      logger.info('Personal info detected in group, message redirected to private', {
        userId: ctx.from?.id,
        chatId: ctx.chat.id,
      });

      return; // Don't proceed with message processing
    }

    return next();
  };
}

/**
 * Group Callback Redirect Middleware
 * Redirects ALL inline button clicks to private chat
 */
function groupCallbackRedirectMiddleware() {
  return async (ctx, next) => {
    const isGroup = ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup';
    const isCallback = ctx.callbackQuery;

    if (!isGroup || !isCallback) {
      return next();
    }

    const chatIdStr = ctx.chat?.id?.toString();

    // Only apply to configured community group
    if (GROUP_ID && chatIdStr !== GROUP_ID) {
      return next();
    }

    // Check if user is admin
    const userId = ctx.from?.id;
    const isAdmin = userId && (
      PermissionService.isEnvSuperAdmin(userId) ||
      PermissionService.isEnvAdmin(userId)
    );

    // Admins can use callbacks normally
    if (isAdmin) {
      return next();
    }

    const callbackData = ctx.callbackQuery.data || '';
    const userLang = ctx.from?.language_code || 'en';
    const botUsername = ctx.botInfo?.username || 'PNPLatinoTV_bot';

    // Map callback actions to deep links for direct navigation
    const CALLBACK_DEEP_LINKS = {
      'show_subscription_plans': 'plans',
      'menu_nearby': 'nearby',
      'menu_content': 'content',
      'menu_profile': 'profile',
      'show_profile': 'profile',
      'menu_hangouts': 'hangouts',
      'show_hangouts': 'hangouts',
      'cristina': 'cristina',
      'menu_cristina': 'cristina',
      'show_live': 'show_live',
      'pnp_live': 'pnp_live',
      'show_leaderboard': 'leaderboard',
      'menu_leaderboard': 'leaderboard',
    };

    // Get specific deep link or use generic menu link
    const deepLink = CALLBACK_DEEP_LINKS[callbackData] || 'menu';
    const pmLink = `https://t.me/${botUsername}?start=${deepLink}`;

    // Answer callback with redirect message
    const redirectText = getCallbackRedirectText(userLang);

    try {
      await ctx.answerCbQuery(redirectText, { show_alert: false, url: pmLink });
      logger.info('Callback redirected to private chat', { callbackData, deepLink, userId });
    } catch (error) {
      logger.debug('Could not answer callback with redirect:', error.message);
    }

    return; // Don't proceed with callback handler - ALL callbacks redirect to private
  };
}

/**
 * Group Menu Button Redirect Middleware (Legacy - kept for compatibility)
 * @deprecated Use groupCallbackRedirectMiddleware instead
 */
function groupMenuRedirectMiddleware() {
  return async (ctx, next) => {
    return next();
  };
}

/**
 * Delete user commands in group quickly to keep group clean
 */
function groupCommandDeleteMiddleware() {
  return async (ctx, next) => {
    const isGroup = ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup';

    if (!isGroup) {
      return next();
    }

    const messageText = ctx.message?.text || '';
    const isCommand = messageText.startsWith('/');

    if (isCommand && ctx.message?.message_id) {
      // Schedule deletion of user command after 5 seconds (keep group clean)
      ChatCleanupService.scheduleDelete(
        ctx.telegram,
        ctx.chat.id,
        ctx.message.message_id,
        'group-user-command',
        5000 // 5 seconds
      );

      logger.debug('User command scheduled for deletion', {
        chatId: ctx.chat.id,
        messageId: ctx.message.message_id,
        command: messageText.split(' ')[0],
        deleteIn: '5 seconds',
      });
    }

    return next();
  };
}

module.exports = {
  groupBehaviorMiddleware,
  cristinaGroupFilterMiddleware,
  groupMenuRedirectMiddleware,
  groupCallbackRedirectMiddleware,
  groupCommandDeleteMiddleware,
  primeChannelSilentRedirectMiddleware,
};
