const UserModel = require('../../models/userModel');
const PermissionModel = require('../../models/permissionModel');
const { PERMISSIONS } = require('../../models/permissionModel');
const logger = require('../../utils/logger');

/**
 * Permission Service - Handles permission checks and role management
 */
class PermissionService {
  /**
   * Check if user has a specific permission
   * @param {number|string} userId - User ID
   * @param {string} permission - Permission to check
   * @returns {Promise<boolean>} True if user has permission
   */
  static async hasPermission(userId, permission) {
    try {
      const user = await UserModel.getById(userId);
      if (!user) {
        logger.warn(`User not found for permission check: ${userId}`);
        return false;
      }

      const userRole = user.role || 'user';
      const hasPermission = PermissionModel.roleHasPermission(userRole, permission);

      logger.debug(`Permission check: ${userId} (${userRole}) - ${permission}: ${hasPermission}`);
      return hasPermission;
    } catch (error) {
      logger.error('Error checking permission:', error);
      return false;
    }
  }

  /**
   * Check if user has any of the given permissions
   * @param {number|string} userId - User ID
   * @param {Array<string>} permissions - Permissions to check
   * @returns {Promise<boolean>} True if user has at least one permission
   */
  static async hasAnyPermission(userId, permissions) {
    try {
      const user = await UserModel.getById(userId);
      if (!user) {
        return false;
      }

      const userRole = user.role || 'user';
      return PermissionModel.roleHasAnyPermission(userRole, permissions);
    } catch (error) {
      logger.error('Error checking any permission:', error);
      return false;
    }
  }

  /**
   * Check if user has all of the given permissions
   * @param {number|string} userId - User ID
   * @param {Array<string>} permissions - Permissions to check
   * @returns {Promise<boolean>} True if user has all permissions
   */
  static async hasAllPermissions(userId, permissions) {
    try {
      const user = await UserModel.getById(userId);
      if (!user) {
        return false;
      }

      const userRole = user.role || 'user';
      return PermissionModel.roleHasAllPermissions(userRole, permissions);
    } catch (error) {
      logger.error('Error checking all permissions:', error);
      return false;
    }
  }

  /**
   * Get user's role
   * @param {number|string} userId - User ID
   * @returns {Promise<string>} User role
   */
  static async getUserRole(userId) {
    try {
      // Check env vars first for admin status
      if (this.isEnvSuperAdmin(userId)) {
        return 'superadmin';
      }
      if (this.isEnvAdmin(userId)) {
        return 'admin';
      }
      // Fall back to database role
      const user = await UserModel.getById(userId);
      return user?.role || 'user';
    } catch (error) {
      logger.error('Error getting user role:', error);
      return 'user';
    }
  }

  /**
   * Check if user is admin (any admin role)
   * @param {number|string} userId - User ID
   * @returns {Promise<boolean>} True if user is admin
   */
  static async isAdmin(userId) {
    try {
      if (this.isEnvSuperAdmin(userId) || this.isEnvAdmin(userId)) {
        return true;
      }
      const role = await this.getUserRole(userId);
      return PermissionModel.isAdminRole(role);
    } catch (error) {
      logger.error('Error checking if user is admin:', error);
      return false;
    }
  }

  /**
   * Check if user is super admin
   * @param {number|string} userId - User ID
   * @returns {Promise<boolean>} True if user is super admin
   */
  static async isSuperAdmin(userId) {
    try {
      const role = await this.getUserRole(userId);
      return role === 'superadmin';
    } catch (error) {
      logger.error('Error checking if user is super admin:', error);
      return false;
    }
  }

  /**
   * Assign role to user
   * @param {number|string} targetUserId - User to assign role to
   * @param {string} role - Role to assign
   * @param {number|string} assignedBy - Admin userId assigning the role
   * @returns {Promise<{success: boolean, message: string}>} Result
   */
  static async assignRole(targetUserId, role, assignedBy) {
    try {
      // Validate role
      if (!PermissionModel.isValidRole(role)) {
        return {
          success: false,
          message: `Invalid role: ${role}`,
        };
      }

      // Get assigner's role
      const assignerRole = await this.getUserRole(assignedBy);

      // Check if assigner can manage this role
      if (!PermissionModel.canManageRole(assignerRole, role)) {
        return {
          success: false,
          message: `You don't have permission to assign role: ${role}`,
        };
      }

      // Get target user to check if they exist
      const targetUser = await UserModel.getById(targetUserId);
      if (!targetUser) {
        return {
          success: false,
          message: 'User not found',
        };
      }

      // Prevent assigning superadmin role (only manual DB update should do this)
      if (role === 'superadmin' && assignerRole !== 'superadmin') {
        return {
          success: false,
          message: 'Cannot assign super admin role',
        };
      }

      // Update user role
      const updated = await UserModel.updateRole(targetUserId, role, assignedBy);

      if (updated) {
        logger.info(`Role assigned: ${targetUserId} -> ${role} by ${assignedBy}`);
        return {
          success: true,
          message: `Role ${role} assigned successfully`,
        };
      }

      return {
        success: false,
        message: 'Failed to update role',
      };
    } catch (error) {
      logger.error('Error assigning role:', error);
      return {
        success: false,
        message: 'Internal error assigning role',
      };
    }
  }

  /**
   * Remove admin role from user (demote to regular user)
   * @param {number|string} targetUserId - User to demote
   * @param {number|string} removedBy - Admin userId removing the role
   * @returns {Promise<{success: boolean, message: string}>} Result
   */
  static async removeRole(targetUserId, removedBy) {
    try {
      // Get target user
      const targetUser = await UserModel.getById(targetUserId);
      if (!targetUser) {
        return {
          success: false,
          message: 'User not found',
        };
      }

      // Prevent removing superadmin role
      if (targetUser.role === 'superadmin') {
        return {
          success: false,
          message: 'Cannot remove super admin role',
        };
      }

      // Get remover's role
      const removerRole = await this.getUserRole(removedBy);

      // Check if remover can manage target's role
      if (!PermissionModel.canManageRole(removerRole, targetUser.role)) {
        return {
          success: false,
          message: "You don't have permission to remove this user's role",
        };
      }

      // Demote to regular user
      const updated = await UserModel.updateRole(targetUserId, 'user', removedBy);

      if (updated) {
        logger.info(`Role removed: ${targetUserId} demoted to user by ${removedBy}`);
        return {
          success: true,
          message: 'Role removed successfully',
        };
      }

      return {
        success: false,
        message: 'Failed to remove role',
      };
    } catch (error) {
      logger.error('Error removing role:', error);
      return {
        success: false,
        message: 'Internal error removing role',
      };
    }
  }

  /**
   * Get all users with admin roles
   * @returns {Promise<Array>} Admin users grouped by role
   */
  static async getAllAdmins() {
    try {
      const admins = await UserModel.getAllAdmins();

      // Group by role
      const grouped = {
        superadmins: admins.filter((u) => u.role === 'superadmin'),
        admins: admins.filter((u) => u.role === 'admin'),
        moderators: admins.filter((u) => u.role === 'moderator'),
      };

      return grouped;
    } catch (error) {
      logger.error('Error getting all admins:', error);
      return {
        superadmins: [],
        admins: [],
        moderators: [],
      };
    }
  }

  /**
   * Get permissions for a user
   * @param {number|string} userId - User ID
   * @returns {Promise<Array<string>>} Array of permissions
   */
  static async getUserPermissions(userId) {
    try {
      const role = await this.getUserRole(userId);
      return PermissionModel.getPermissionsForRole(role);
    } catch (error) {
      logger.error('Error getting user permissions:', error);
      return [];
    }
  }

  /**
   * Check if a user can manage another user (based on role hierarchy)
   * @param {number|string} managerId - Manager user ID
   * @param {number|string} targetId - Target user ID
   * @returns {Promise<boolean>} True if manager can manage target
   */
  static async canManageUser(managerId, targetId) {
    try {
      const managerRole = await this.getUserRole(managerId);
      const targetRole = await this.getUserRole(targetId);

      return PermissionModel.canManageRole(managerRole, targetRole);
    } catch (error) {
      logger.error('Error checking if user can manage another:', error);
      return false;
    }
  }

  /**
   * Get role display name with emoji
   * @param {number|string} userId - User ID
   * @param {string} language - Language (en/es)
   * @returns {Promise<string>} Display name
   */
  static async getUserRoleDisplay(userId, language = 'en') {
    try {
      const role = await this.getUserRole(userId);
      return PermissionModel.getRoleDisplayName(role, language);
    } catch (error) {
      logger.error('Error getting role display name:', error);
      return '👤 User';
    }
  }

  /**
   * Check if user is the super admin from environment variable
   * @param {number|string} userId - User ID
   * @returns {boolean} True if user is super admin
   */
  static isEnvSuperAdmin(userId) {
    const superAdminId = process.env.ADMIN_ID?.trim();
    return superAdminId && String(userId) === superAdminId;
  }

  /**
   * Check if user is an admin from environment variable
   * @param {number|string} userId - User ID
   * @returns {boolean} True if user is admin
   */
  static isEnvAdmin(userId) {
    const adminIds = (process.env.ADMIN_USER_IDS || '').split(',').map(id => id.trim()).filter(id => id);
    return adminIds.includes(String(userId));
  }
}

module.exports = PermissionService;
module.exports.PERMISSIONS = PERMISSIONS;
