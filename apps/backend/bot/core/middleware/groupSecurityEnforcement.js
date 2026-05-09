const logger = require('../../../utils/logger');
const { query } = require('../../../config/postgres');

// Cache of hangout-linked telegram chat IDs (refreshed every 5 min)
let _linkedChatIds = new Set();
let _linkedCacheTime = 0;
const LINKED_CACHE_TTL = 5 * 60 * 1000;

async function getLinkedChatIds() {
  if (Date.now() - _linkedCacheTime < LINKED_CACHE_TTL) return _linkedChatIds;
  try {
    const { rows } = await query('SELECT telegram_chat_id FROM hangout_groups WHERE telegram_chat_id IS NOT NULL');
    _linkedChatIds = new Set(rows.map(r => String(r.telegram_chat_id)));
    _linkedCacheTime = Date.now();
  } catch (err) {
    logger.warn('Failed to refresh linked chat IDs cache', { error: err.message });
  }
  return _linkedChatIds;
}

// Invalidate cache when a new group is linked
function invalidateLinkedCache() { _linkedCacheTime = 0; }

async function isAuthorizedChat(chatIdStr) {
  const primeChannelId = process.env.PRIME_CHANNEL_ID;
  const groupId = process.env.GROUP_ID;
  const supportGroupId = process.env.SUPPORT_GROUP_ID;
  const envChats = [primeChannelId, groupId, supportGroupId].filter(Boolean).map(id => String(id));
  if (envChats.includes(chatIdStr)) return true;
  const linked = await getLinkedChatIds();
  return linked.has(chatIdStr);
}

/**
 * Group/Channel Security Enforcement Middleware
 * Allows bot in: whitelisted env chats + hangout-linked Telegram groups
 * All other groups/channels: bot stays and waits for /link command
 */
function groupSecurityEnforcementMiddleware() {
  return async (ctx, next) => {
    try {
      const chatType = ctx.chat?.type;
      if (chatType === 'private') return next();
      // Allow all groups/channels — the bot needs to stay so owners can run /link
      return next();
    } catch (error) {
      logger.error('Error in group security enforcement middleware:', error);
      return next();
    }
  };
}

/**
 * Handle my_chat_member updates (when bot is added/removed from groups)
 * Enforces strict control over bot additions
 */
function registerGroupSecurityHandlers(bot) {
  bot.on('my_chat_member', async (ctx) => {
    try {
      const newStatus = ctx.myChatMember?.new_chat_member?.status;
      const chatId = ctx.chat?.id;
      const chatType = ctx.chat?.type;
      const chatTitle = ctx.chat?.title || 'Unknown';
      const chatIdStr = String(chatId);

      logger.info('Bot status changed in chat', { chatId: chatIdStr, chatTitle, chatType, newStatus });

      if (['member', 'administrator'].includes(newStatus) && chatType !== 'private' && chatType !== 'channel') {
        // Don't send /link instructions in the main community group — it's already
        // set up and we don't want to encourage command usage there.
        const mainGroupId = process.env.GROUP_ID;
        if (mainGroupId && chatIdStr === mainGroupId) {
          logger.info('Bot added to main community group, skipping /link welcome', { chatIdStr });
        } else {
          // External group — tell the owner how to link it to a hangout
          try {
            await ctx.reply(
              `👋 Hello! I'm the PNPtv bot.\n\n` +
              `To link this group to a PNPtv hangout, the hangout owner should run:\n` +
              `/link <hangout_id>\n\n` +
              `You can find the hangout ID in the PNPtv webapp.`
            );
          } catch (e) {
            logger.debug('Could not send welcome message', { error: e.message });
          }
        }
      }

      if (newStatus === 'left' || newStatus === 'kicked') {
        logger.info('Bot removed from chat', { chatId: chatIdStr, chatTitle, reason: newStatus });
      }
    } catch (error) {
      logger.error('Error handling my_chat_member update:', error);
    }
  });
}

module.exports = {
  groupSecurityEnforcementMiddleware,
  registerGroupSecurityHandlers,
  invalidateLinkedCache,
};
