const logger = require('./logger');

/**
 * Admin Utilities - Shared functions for admin/permission checks
 */

/**
 * Check if user is admin in a chat
 * @param {Object} ctx - Telegraf context
 * @param {string|number} userId - User ID to check (defaults to ctx.from.id)
 * @param {string|number} chatId - Chat ID to check (defaults to ctx.chat.id)
 * @returns {Promise<boolean>} Is admin
 */
async function isAdmin(ctx, userId = null, chatId = null) {
  try {
    const userToCheck = userId || ctx.from?.id;
    const chatToCheck = chatId || ctx.chat?.id;

    if (!userToCheck || !chatToCheck) {
      return false;
    }

    const member = await ctx.telegram.getChatMember(chatToCheck, userToCheck);
    return ['creator', 'administrator'].includes(member.status);
  } catch (error) {
    logger.error('Error checking admin status:', error);
    return false;
  }
}

/**
 * Check if user is the chat creator
 * @param {Object} ctx - Telegraf context
 * @param {string|number} userId - User ID to check
 * @param {string|number} chatId - Chat ID to check
 * @returns {Promise<boolean>} Is creator
 */
async function isCreator(ctx, userId = null, chatId = null) {
  try {
    const userToCheck = userId || ctx.from?.id;
    const chatToCheck = chatId || ctx.chat?.id;

    if (!userToCheck || !chatToCheck) {
      return false;
    }

    const member = await ctx.telegram.getChatMember(chatToCheck, userToCheck);
    return member.status === 'creator';
  } catch (error) {
    logger.error('Error checking creator status:', error);
    return false;
  }
}

/**
 * Check if bot is admin in a chat
 * @param {Object} ctx - Telegraf context
 * @param {string|number} chatId - Chat ID to check
 * @returns {Promise<boolean>} Bot is admin
 */
async function isBotAdmin(ctx, chatId = null) {
  try {
    const chatToCheck = chatId || ctx.chat?.id;

    if (!chatToCheck) {
      return false;
    }

    const botInfo = ctx.botInfo || await ctx.telegram.getMe();
    const member = await ctx.telegram.getChatMember(chatToCheck, botInfo.id);
    return ['administrator'].includes(member.status);
  } catch (error) {
    logger.error('Error checking bot admin status:', error);
    return false;
  }
}

/**
 * Get user info from reply or command args
 * @param {Object} ctx - Telegraf context
 * @returns {Object|null} { id, username } or null
 */
function getUserFromContext(ctx) {
  // Check if replying to a message
  if (ctx.message?.reply_to_message) {
    return {
      id: ctx.message.reply_to_message.from.id,
      username: ctx.message.reply_to_message.from.username || ctx.message.reply_to_message.from.first_name,
      firstName: ctx.message.reply_to_message.from.first_name,
    };
  }

  // Check if user ID or username in command
  if (!ctx.message?.text) {
    return null;
  }

  const args = ctx.message.text.split(' ').slice(1);
  if (args.length > 0) {
    const userRef = args[0];

    // Check if it's a user ID (numeric)
    if (/^\d+$/.test(userRef)) {
      return { id: parseInt(userRef), username: null, firstName: null };
    }

    // Check if it's a mention (@username)
    if (userRef.startsWith('@')) {
      return { username: userRef.substring(1), id: null, firstName: null };
    }
  }

  return null;
}

/**
 * Check if chat is a group or supergroup
 * @param {Object} ctx - Telegraf context
 * @returns {boolean} Is group
 */
function isGroupChat(ctx) {
  const chatType = ctx.chat?.type;
  return chatType === 'group' || chatType === 'supergroup';
}

/**
 * Check if user is a global admin (from ADMIN_IDS env)
 * @param {string|number} userId - User ID to check
 * @returns {boolean} Is global admin
 */
function isGlobalAdmin(userId) {
  const adminIds = (process.env.ADMIN_IDS || process.env.ADMIN_USER_IDS || '')
    .split(',')
    .map(id => id.trim())
    .filter(id => id);

  return adminIds.includes(String(userId));
}

module.exports = {
  isAdmin,
  isCreator,
  isBotAdmin,
  getUserFromContext,
  isGroupChat,
  isGlobalAdmin,
};
