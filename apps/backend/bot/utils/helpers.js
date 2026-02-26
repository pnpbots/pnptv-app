const logger = require('../../utils/logger');
const { t } = require('../../utils/i18n');

// Admin IDs from environment for pre-launch testing
const getAdminIds = () => {
  const superAdmin = process.env.ADMIN_ID?.trim();
  const adminIds = (process.env.ADMIN_USER_IDS || '').split(',').map(id => id.trim()).filter(id => id);
  return superAdmin ? [superAdmin, ...adminIds] : adminIds;
};

/**
 * Check if user ID is an admin (for pre-launch testing access)
 * @param {number|string} userId - User ID to check
 * @returns {boolean} True if user is admin
 */
const isAdminUser = (userId) => {
  if (!userId) return false;
  const adminIds = getAdminIds();
  return adminIds.includes(String(userId));
};

/**
 * Get user language from context safely
 * @param {Context} ctx - Telegraf context
 * @returns {string} Language code ('en' or 'es')
 */
const getLanguage = (ctx) => ctx.session?.language || 'en';

/**
 * Normalize subscription status into access state
 * PRIME access is based solely on active status.
 * @param {string} status - Raw subscription status
 * @returns {'active'|'inactive'} Normalized access state
 */
const normalizeSubscriptionStatus = (status) => {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'active' || normalized === 'prime' || normalized === 'trial') {
    return 'active';
  }
  return 'inactive';
};

/**
 * Check if user has PRIME/active membership
 * Unified logic: active = PRIME access, everything else is inactive.
 * @param {Object} user - User object with subscriptionStatus
 * @returns {boolean} True if user has active PRIME membership
 */
const isPrimeUser = (user) => {
  if (!user) return false;
  return (user.tier || user.subscription?.tier || '').toLowerCase() === 'prime';
};

/**
 * Check if user has full feature access (PRIME or Admin)
 * Admins get full access for pre-launch testing
 * @param {Object} user - User object
 * @param {number|string} userId - User ID (optional, for admin check)
 * @returns {boolean} True if user has full access
 */
const hasFullAccess = (user, userId) => {
  // Admins always have full access (pre-launch testing)
  if (userId && isAdminUser(userId)) {
    return true;
  }

  // Check user object for admin role
  if (user?.role === 'admin' || user?.role === 'superadmin') {
    return true;
  }

  // Otherwise check PRIME status
  return isPrimeUser(user);
};

/**
 * Safe handler wrapper with error handling
 * Automatically handles errors and sends user-friendly messages
 * @param {Function} handlerFn - Handler function to wrap
 * @returns {Function} Wrapped handler
 */
const safeHandler = (handlerFn) => async (ctx) => {
  try {
    await handlerFn(ctx);
  } catch (error) {
    const lang = getLanguage(ctx);
    logger.error('Handler error:', {
      error: error.message,
      stack: error.stack,
      action: ctx.callbackQuery?.data,
      command: ctx.message?.text,
      userId: ctx.from?.id,
    });

    try {
      await ctx.reply(`❌ ${t('error', lang)}`);
    } catch (replyError) {
      logger.error('Failed to send error message:', replyError);
    }
  }
};

/**
 * Validate user text input
 * @param {string} text - User input text
 * @param {number} maxLength - Maximum allowed length
 * @returns {string|null} Validated and trimmed text, or null if invalid
 */
const validateUserInput = (text, maxLength = 500) => {
  if (!text || typeof text !== 'string') {
    return null;
  }

  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > maxLength) {
    return null;
  }

  return trimmed.substring(0, maxLength);
};

/**
 * Check if session temp state is expired
 * @param {Object} ctx - Telegraf context
 * @param {string} stateKey - State key to check
 * @param {number} _timeoutMinutes - Timeout in minutes (unused, default: 5)
 * @returns {boolean} True if expired or not set
 */
const isSessionExpired = (ctx, stateKey, _timeoutMinutes = 5) => {
  const tempState = ctx.session?.temp?.[stateKey];
  if (!tempState) return true;

  if (tempState.expiresAt && Date.now() > tempState.expiresAt) {
    // Clean up expired state
    delete ctx.session.temp[stateKey];
    return true;
  }

  return false;
};

/**
 * Set session temp state with expiration
 * @param {Object} ctx - Telegraf context
 * @param {string} stateKey - State key
 * @param {any} value - State value
 * @param {number} timeoutMinutes - Timeout in minutes (default: 5)
 */
const setSessionState = (ctx, stateKey, value, timeoutMinutes = 5) => {
  if (!ctx.session.temp) {
    ctx.session.temp = {};
  }

  ctx.session.temp[stateKey] = {
    value,
    createdAt: Date.now(),
    expiresAt: Date.now() + (timeoutMinutes * 60 * 1000),
  };
};

/**
 * Get session temp state value
 * @param {Object} ctx - Telegraf context
 * @param {string} stateKey - State key
 * @returns {any} State value or null if not set/expired
 */
const getSessionState = (ctx, stateKey) => {
  if (isSessionExpired(ctx, stateKey)) {
    return null;
  }

  return ctx.session?.temp?.[stateKey]?.value;
};

/**
 * Clear session temp state
 * @param {Object} ctx - Telegraf context
 * @param {string} stateKey - State key to clear (if not provided, clears all)
 */
const clearSessionState = (ctx, stateKey = null) => {
  if (!ctx.session?.temp) return;

  if (stateKey) {
    delete ctx.session.temp[stateKey];
  } else {
    ctx.session.temp = {};
  }
};

/**
 * Check if the callback query message is a media message (photo, video, etc.)
 * Media messages cannot use editMessageText - they need editMessageCaption or reply
 * @param {Object} ctx - Telegraf context with callback_query
 * @returns {boolean} True if the message contains media
 */
const isMediaMessage = (ctx) => {
  const msg = ctx.callbackQuery?.message;
  if (!msg) return false;

  // Check for any media types
  return !!(msg.photo || msg.video || msg.animation || msg.document ||
            msg.audio || msg.voice || msg.video_note || msg.sticker);
};

/**
 * Safely reply or edit a message based on whether the original is a media message
 * If from broadcast (media), sends new message. If text message, edits in place.
 * @param {Object} ctx - Telegraf context
 * @param {string} text - Message text to send/edit
 * @param {Object} options - Additional options (parse_mode, reply_markup, etc.)
 * @returns {Promise<Object>} Sent or edited message
 */
const safeReplyOrEdit = async (ctx, text, options = {}) => {
  // If this is a media message (like from a broadcast with photo/video),
  // we can't use editMessageText - send a new message instead
  if (isMediaMessage(ctx)) {
    return ctx.reply(text, options);
  }

  // For text-only messages, edit in place for better UX
  try {
    return await ctx.editMessageText(text, options);
  } catch (error) {
    // Fallback to reply if edit fails for any reason
    if (error.message?.includes('no text in the message to edit') ||
        error.message?.includes('message is not modified') ||
        error.message?.includes("message can't be edited") ||
        error.message?.includes('message to edit not found')) {
      return ctx.reply(text, options);
    }
    throw error;
  }
};

/**
 * Safely edit message text, ignoring "message is not modified" errors
 * Use this when you want to update a message but it's okay if content hasn't changed
 * @param {Object} ctx - Telegraf context
 * @param {string} text - Message text
 * @param {Object} options - Additional options (parse_mode, reply_markup, etc.)
 * @returns {Promise<Object|null>} Edited message or null if not modified
 */
const safeEditMessage = async (ctx, text, options = {}) => {
  try {
    return await ctx.editMessageText(text, options);
  } catch (error) {
    // Silently ignore "message is not modified" - this is expected behavior
    if (error.message?.includes('message is not modified')) {
      return null;
    }
    // For other common Telegram errors, log at debug level and return null
    if (error.message?.includes('message to edit not found') ||
        error.message?.includes('query is too old')) {
      logger.debug('Safe edit message skipped:', error.message);
      return null;
    }
    throw error;
  }
};

/**
 * Safely answer callback query, ignoring timeout errors
 * @param {Object} ctx - Telegraf context
 * @param {string} text - Optional notification text
 * @param {boolean} showAlert - Show alert instead of notification
 * @returns {Promise<boolean>} Success status
 */
const safeAnswerCbQuery = async (ctx, text = '', showAlert = false) => {
  try {
    await ctx.answerCbQuery(text, { show_alert: showAlert });
    return true;
  } catch (error) {
    // Ignore timeout and already answered errors
    if (error.message?.includes('query is too old') ||
        error.message?.includes('query has already been answered')) {
      return false;
    }
    logger.debug('Safe answer callback query failed:', error.message);
    return false;
  }
};

module.exports = {
  getLanguage,
  normalizeSubscriptionStatus,
  isPrimeUser,
  isAdminUser,
  hasFullAccess,
  safeHandler,
  validateUserInput,
  isSessionExpired,
  setSessionState,
  getSessionState,
  clearSessionState,
  isMediaMessage,
  safeReplyOrEdit,
  safeEditMessage,
  safeAnswerCbQuery,
};
