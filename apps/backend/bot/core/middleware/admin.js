const { config } = require('../../config/botConfig');
const logger = require('../../../utils/logger');

/**
 * Check if user is an admin
 */
const isAdmin = (userId) => {
  return config.adminIds.includes(userId);
};

/**
 * Middleware to restrict access to admin commands
 */
const adminOnly = () => {
  return async (ctx, next) => {
    const userId = ctx.from?.id;

    if (!userId) {
      return ctx.reply('❌ Unable to verify user identity.');
    }

    if (!isAdmin(userId)) {
      logger.warn(`Unauthorized admin access attempt by user ${userId}`);
      return ctx.reply('❌ Access denied. This command is for administrators only.');
    }

    logger.info(`Admin command accessed by user ${userId}`);
    return next();
  };
};

/**
 * Middleware to add admin status to context
 */
const checkAdminStatus = () => {
  return async (ctx, next) => {
    ctx.isAdmin = isAdmin(ctx.from?.id);
    return next();
  };
};

module.exports = {
  isAdmin,
  adminOnly,
  checkAdminStatus,
};
