const PermissionService = require('../services/permissionService');
const { PERMISSIONS } = require('../../models/permissionModel');
const logger = require('../../utils/logger');
const { t } = require('../../utils/i18n');

/**
 * Middleware to check if user has required permission
 * @param {string|Array<string>} permission - Required permission(s)
 * @param {Object} options - Options
 * @param {boolean} options.requireAll - If true, require ALL permissions (default: false - require ANY)
 * @returns {Function} Middleware function
 */
function requirePermission(permission, options = {}) {
  const { requireAll = false } = options;

  return async (ctx, next) => {
    try {
      const userId = ctx.from?.id;

      if (!userId) {
        logger.warn('No user ID found in context for permission check');
        await ctx.answerCbQuery(t('errors.unauthorized', ctx.user?.language || 'en'));
        return;
      }

      let hasAccess = false;

      if (Array.isArray(permission)) {
        // Multiple permissions
        if (requireAll) {
          hasAccess = await PermissionService.hasAllPermissions(userId, permission);
        } else {
          hasAccess = await PermissionService.hasAnyPermission(userId, permission);
        }
      } else {
        // Single permission
        hasAccess = await PermissionService.hasPermission(userId, permission);
      }

      if (!hasAccess) {
        const userRole = await PermissionService.getUserRole(userId);
        logger.warn(`Access denied: User ${userId} (${userRole}) lacks permission: ${permission}`);

        const message = t('errors.noPermission', ctx.user?.language || 'en');

        // If it's a callback query, answer it
        if (ctx.callbackQuery) {
          await ctx.answerCbQuery(message);
        } else {
          await ctx.reply(message);
        }
        return;
      }

      // User has permission, continue
      return next();
    } catch (error) {
      logger.error('Error in permission middleware:', error);
      await ctx.answerCbQuery(t('errors.general', ctx.user?.language || 'en'));
    }
  };
}

/**
 * Middleware to check if user is admin (any admin role)
 * @returns {Function} Middleware function
 */
function requireAdmin() {
  return async (ctx, next) => {
    try {
      const userId = ctx.from?.id;

      if (!userId) {
        await ctx.answerCbQuery(t('errors.unauthorized', ctx.user?.language || 'en'));
        return;
      }

      const isAdmin = await PermissionService.isAdmin(userId);

      if (!isAdmin) {
        const role = await PermissionService.getUserRole(userId);
        logger.warn(`Access denied: User ${userId} (${role}) is not an admin`);

        const message = t('errors.adminOnly', ctx.user?.language || 'en');

        if (ctx.callbackQuery) {
          await ctx.answerCbQuery(message);
        } else {
          await ctx.reply(message);
        }
        return;
      }

      return next();
    } catch (error) {
      logger.error('Error in admin middleware:', error);
      await ctx.answerCbQuery(t('errors.general', ctx.user?.language || 'en'));
    }
  };
}

/**
 * Middleware to check if user is super admin
 * @returns {Function} Middleware function
 */
function requireSuperAdmin() {
  return async (ctx, next) => {
    try {
      const userId = ctx.from?.id;

      if (!userId) {
        await ctx.answerCbQuery(t('errors.unauthorized', ctx.user?.language || 'en'));
        return;
      }

      const isSuperAdmin = await PermissionService.isSuperAdmin(userId);

      if (!isSuperAdmin) {
        const role = await PermissionService.getUserRole(userId);
        logger.warn(`Access denied: User ${userId} (${role}) is not a super admin`);

        const message = t('errors.superAdminOnly', ctx.user?.language || 'en');

        if (ctx.callbackQuery) {
          await ctx.answerCbQuery(message);
        } else {
          await ctx.reply(message);
        }
        return;
      }

      return next();
    } catch (error) {
      logger.error('Error in super admin middleware:', error);
      await ctx.answerCbQuery(t('errors.general', ctx.user?.language || 'en'));
    }
  };
}

/**
 * Middleware to check if user can manage another user
 * Extracts target user ID from callback data or message
 * @returns {Function} Middleware function
 */
function requireCanManageUser() {
  return async (ctx, next) => {
    try {
      const managerId = ctx.from?.id;

      // Extract target user ID from callback data or session
      let targetUserId = null;

      if (ctx.callbackQuery?.data) {
        // Try to extract from callback data (format: action_targetUserId)
        const parts = ctx.callbackQuery.data.split('_');
        if (parts.length > 1) {
          targetUserId = parts[parts.length - 1];
        }
      }

      // Also check session if available
      if (!targetUserId && ctx.session?.targetUserId) {
        targetUserId = ctx.session.targetUserId;
      }

      if (!targetUserId) {
        logger.warn('No target user ID found for management permission check');
        await ctx.answerCbQuery(t('errors.invalidUser', ctx.user?.language || 'en'));
        return;
      }

      const canManage = await PermissionService.canManageUser(managerId, targetUserId);

      if (!canManage) {
        const managerRole = await PermissionService.getUserRole(managerId);
        const targetRole = await PermissionService.getUserRole(targetUserId);
        logger.warn(`Access denied: User ${managerId} (${managerRole}) cannot manage ${targetUserId} (${targetRole})`);

        const message = t('errors.cannotManageUser', ctx.user?.language || 'en');
        await ctx.answerCbQuery(message);
        return;
      }

      // Store target user ID in context for handler use
      ctx.targetUserId = targetUserId;
      return next();
    } catch (error) {
      logger.error('Error in can manage user middleware:', error);
      await ctx.answerCbQuery(t('errors.general', ctx.user?.language || 'en'));
    }
  };
}

/**
 * Attach user's role and permissions to context
 * Useful for displaying different UI based on role
 * @returns {Function} Middleware function
 */
function attachUserRole() {
  return async (ctx, next) => {
    try {
      const userId = ctx.from?.id;

      if (userId) {
        const role = await PermissionService.getUserRole(userId);
        const permissions = await PermissionService.getUserPermissions(userId);
        const roleDisplay = await PermissionService.getUserRoleDisplay(userId, ctx.user?.language || 'en');

        // Attach to context
        ctx.userRole = role;
        ctx.userPermissions = permissions;
        ctx.userRoleDisplay = roleDisplay;
      }

      return next();
    } catch (error) {
      logger.error('Error attaching user role:', error);
      return next(); // Continue even if role attachment fails
    }
  };
}

module.exports = {
  requirePermission,
  requireAdmin,
  requireSuperAdmin,
  requireCanManageUser,
  attachUserRole,
  PERMISSIONS, // Re-export for convenience
};
