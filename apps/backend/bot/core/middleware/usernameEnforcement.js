const ModerationModel = require('../../../models/moderationModel');
const UserModel = require('../../../models/userModel');
const ChatCleanupService = require('../../services/chatCleanupService');
const logger = require('../../../utils/logger');
const { t } = require('../../../utils/i18n');

/**
 * Username enforcement middleware
 * DISABLED - All username enforcement rules have been disabled
 */
const usernameEnforcement = () => {
  return async (ctx, next) => {
    // Middleware is disabled - no username enforcement
    return next();
  };
};

module.exports = usernameEnforcement;