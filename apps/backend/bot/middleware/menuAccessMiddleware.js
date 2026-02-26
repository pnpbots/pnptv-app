const MenuConfigService = require('../services/menuConfigService');
const logger = require('../../utils/logger');
const { t } = require('../../utils/i18n');

/**
 * Extract menu ID from callback query action
 * @param {string} action - Callback query action (e.g., 'show_subscription_plans')
 * @returns {string|null} Menu ID
 */
function extractMenuIdFromAction(action) {
  if (!action) return null;

  // Map common actions to menu IDs
  const actionToMenuId = {
    show_subscription_plans: 'subscribe',
    show_profile: 'profile',
    show_nearby_unified: 'nearby',
    show_live: 'live',

    show_jitsi: 'jitsi',
    show_support: 'support',
    show_settings: 'settings',
  };

  // Check if it's a mapped action
  if (actionToMenuId[action]) {
    return actionToMenuId[action];
  }

  // Check if it's a custom menu action (format: custom_{menuId})
  if (action.startsWith('custom_')) {
    return action.replace('custom_', '');
  }

  // Try to extract from show_{menuId} pattern
  const match = action.match(/^show_(.+)$/);
  if (match) {
    return match[1];
  }

  return null;
}

/**
 * Middleware to check if user has access to a menu
 * @returns {Function} Middleware function
 */
function checkMenuAccess() {
  return async (ctx, next) => {
    try {
      // Only check for callback queries with menu actions
      if (!ctx.callbackQuery?.data) {
        return next();
      }

      const action = ctx.callbackQuery.data;
      const menuId = extractMenuIdFromAction(action);

      // If we can't determine the menu ID, allow access (might not be a menu action)
      if (!menuId) {
        return next();
      }

      const userId = ctx.from?.id;

      if (!userId) {
        logger.warn('No user ID found in context for menu access check');
        await ctx.answerCbQuery(t('errors.unauthorized', ctx.user?.language || 'en'));
        return;
      }

      // Check if menu is available for this user
      const hasAccess = await MenuConfigService.isMenuAvailableForUser(menuId, userId);

      if (!hasAccess) {
        logger.info(`Menu access denied: User ${userId} cannot access menu: ${menuId}`);

        const message = t('errors.menuNotAvailable', ctx.user?.language || 'en');
        await ctx.answerCbQuery(message);
        return;
      }

      // User has access, continue to handler
      return next();
    } catch (error) {
      logger.error('Error in menu access middleware:', error);
      // On error, allow access (fail open to prevent blocking legitimate users)
      return next();
    }
  };
}

/**
 * Middleware to attach available menus to context
 * Useful for building dynamic menu keyboards
 * @returns {Function} Middleware function
 */
function attachAvailableMenus() {
  return async (ctx, next) => {
    try {
      const userId = ctx.from?.id;

      if (userId) {
        const availableMenus = await MenuConfigService.getAvailableMenusForUser(userId);
        ctx.availableMenus = availableMenus;

        logger.debug(`Attached ${availableMenus.length} available menus to context for user ${userId}`);
      }

      return next();
    } catch (error) {
      logger.error('Error attaching available menus:', error);
      ctx.availableMenus = [];
      return next(); // Continue even if attachment fails
    }
  };
}

/**
 * Check if user has access to a specific menu ID
 * Helper function that can be used in handlers
 * @param {Context} ctx - Telegraf context
 * @param {string} menuId - Menu ID to check
 * @returns {Promise<boolean>} True if user has access
 */
async function userHasMenuAccess(ctx, menuId) {
  try {
    const userId = ctx.from?.id;
    if (!userId) return false;

    return await MenuConfigService.isMenuAvailableForUser(menuId, userId);
  } catch (error) {
    logger.error('Error checking user menu access:', error);
    return false;
  }
}

/**
 * Filter menu items based on user access
 * Used for building dynamic keyboards
 * @param {Context} ctx - Telegraf context
 * @param {Array<Object>} menuItems - Menu items with menuId property
 * @returns {Promise<Array<Object>>} Filtered menu items
 */
async function filterMenusByAccess(ctx, menuItems) {
  try {
    const userId = ctx.from?.id;
    if (!userId) return [];

    const filteredItems = [];

    for (const item of menuItems) {
      const hasAccess = await MenuConfigService.isMenuAvailableForUser(item.menuId, userId);
      if (hasAccess) {
        filteredItems.push(item);
      }
    }

    logger.debug(`Filtered ${menuItems.length} menu items to ${filteredItems.length} for user ${userId}`);
    return filteredItems;
  } catch (error) {
    logger.error('Error filtering menus by access:', error);
    return [];
  }
}

/**
 * Get tier requirement message for a menu
 * @param {string} menuId - Menu ID
 * @param {string} language - Language (en/es)
 * @returns {Promise<string>} Tier requirement message
 */
async function getMenuTierRequirement(menuId, language = 'en') {
  try {
    const menu = await MenuConfigService.getMenu(menuId);

    if (!menu) {
      return t('errors.menuNotFound', language);
    }

    if (menu.status === 'disabled') {
      return t('errors.menuDisabled', language);
    }

    if (menu.status === 'tier_restricted' && menu.allowedTiers.length > 0) {
      const tiers = menu.allowedTiers.join(', ');
      return t('errors.requiresTier', language, { tiers });
    }

    return '';
  } catch (error) {
    logger.error('Error getting menu tier requirement:', error);
    return '';
  }
}

module.exports = {
  checkMenuAccess,
  attachAvailableMenus,
  userHasMenuAccess,
  filterMenusByAccess,
  getMenuTierRequirement,
  extractMenuIdFromAction,
};
