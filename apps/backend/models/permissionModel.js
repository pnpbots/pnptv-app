const logger = require('../utils/logger');

/**
 * Permission Model - Defines roles and permissions for the bot
 *
 * ROLES:
 * - superadmin: Full system access, can manage other admins, create menus, configure bot
 * - admin: User management, broadcasts, view analytics
 * - moderator: Basic support, view users only
 * - user: Regular bot user
 */

/**
 * All available permissions in the system
 */
const PERMISSIONS = {
  // User Management
  VIEW_USERS: 'view_users',
  MODIFY_USERS: 'modify_users',
  DEACTIVATE_USERS: 'deactivate_users',
  EXTEND_SUBSCRIPTIONS: 'extend_subscriptions',

  // Broadcast
  SEND_BROADCAST: 'send_broadcast',
  SEND_BROADCAST_PREMIUM: 'send_broadcast_premium',

  // Menu Management
  VIEW_MENUS: 'view_menus',
  EDIT_MENUS: 'edit_menus',
  CREATE_MENUS: 'create_menus',
  DELETE_MENUS: 'delete_menus',

  // Plan Management
  VIEW_PLANS: 'view_plans',
  EDIT_PLANS: 'edit_plans',
  CREATE_PLANS: 'create_plans',

  // Admin Management (only superadmin)
  MANAGE_ADMINS: 'manage_admins',
  MANAGE_MODERATORS: 'manage_moderators',

  // Analytics
  VIEW_ANALYTICS: 'view_analytics',
  VIEW_REVENUE: 'view_revenue',
  EXPORT_DATA: 'export_data',

  // System (only superadmin)
  VIEW_LOGS: 'view_logs',
  MODIFY_CONFIG: 'modify_config',
  ACCESS_DATABASE: 'access_database',

  // Bot Instance Management (for SaaS model - future)
  MANAGE_INSTANCES: 'manage_instances',
  CLONE_BOT: 'clone_bot',
};

/**
 * Role definitions with their permissions
 */
const ROLES = {
  superadmin: {
    name: 'Super Admin',
    nameEs: 'Super Administrador',
    emoji: '🔴',
    level: 3,
    permissions: [
      // All permissions
      PERMISSIONS.VIEW_USERS,
      PERMISSIONS.MODIFY_USERS,
      PERMISSIONS.DEACTIVATE_USERS,
      PERMISSIONS.EXTEND_SUBSCRIPTIONS,
      PERMISSIONS.SEND_BROADCAST,
      PERMISSIONS.SEND_BROADCAST_PREMIUM,
      PERMISSIONS.VIEW_MENUS,
      PERMISSIONS.EDIT_MENUS,
      PERMISSIONS.CREATE_MENUS,
      PERMISSIONS.DELETE_MENUS,
      PERMISSIONS.VIEW_PLANS,
      PERMISSIONS.EDIT_PLANS,
      PERMISSIONS.CREATE_PLANS,
      PERMISSIONS.MANAGE_ADMINS,
      PERMISSIONS.MANAGE_MODERATORS,
      PERMISSIONS.VIEW_ANALYTICS,
      PERMISSIONS.VIEW_REVENUE,
      PERMISSIONS.EXPORT_DATA,
      PERMISSIONS.VIEW_LOGS,
      PERMISSIONS.MODIFY_CONFIG,
      PERMISSIONS.ACCESS_DATABASE,
      PERMISSIONS.MANAGE_INSTANCES,
      PERMISSIONS.CLONE_BOT,
    ],
  },

  admin: {
    name: 'Admin',
    nameEs: 'Administrador',
    emoji: '🟡',
    level: 2,
    permissions: [
      PERMISSIONS.VIEW_USERS,
      PERMISSIONS.MODIFY_USERS,
      PERMISSIONS.DEACTIVATE_USERS,
      PERMISSIONS.EXTEND_SUBSCRIPTIONS,
      PERMISSIONS.SEND_BROADCAST,
      PERMISSIONS.SEND_BROADCAST_PREMIUM,
      PERMISSIONS.VIEW_MENUS,
      PERMISSIONS.VIEW_PLANS,
      PERMISSIONS.VIEW_ANALYTICS,
      PERMISSIONS.VIEW_REVENUE,
    ],
  },

  moderator: {
    name: 'Moderator',
    nameEs: 'Moderador',
    emoji: '🟢',
    level: 1,
    permissions: [
      PERMISSIONS.VIEW_USERS,
    ],
  },

  user: {
    name: 'User',
    nameEs: 'Usuario',
    emoji: '👤',
    level: 0,
    permissions: [],
  },
};

/**
 * Permission Model Class
 */
class PermissionModel {
  /**
   * Get all available permissions
   * @returns {Object} All permissions
   */
  static getPermissions() {
    return PERMISSIONS;
  }

  /**
   * Get all roles
   * @returns {Object} All roles
   */
  static getRoles() {
    return ROLES;
  }

  /**
   * Get role definition
   * @param {string} role - Role name
   * @returns {Object|null} Role definition
   */
  static getRole(role) {
    return ROLES[role] || null;
  }

  /**
   * Get permissions for a role
   * @param {string} role - Role name
   * @returns {Array<string>} Array of permissions
   */
  static getPermissionsForRole(role) {
    const roleData = ROLES[role];
    if (!roleData) {
      logger.warn(`Role not found: ${role}`);
      return [];
    }
    return roleData.permissions;
  }

  /**
   * Check if a role has a specific permission
   * @param {string} role - Role name
   * @param {string} permission - Permission to check
   * @returns {boolean} True if role has permission
   */
  static roleHasPermission(role, permission) {
    const permissions = this.getPermissionsForRole(role);
    return permissions.includes(permission);
  }

  /**
   * Check if a role has any of the given permissions
   * @param {string} role - Role name
   * @param {Array<string>} permissions - Permissions to check
   * @returns {boolean} True if role has at least one permission
   */
  static roleHasAnyPermission(role, permissions) {
    const rolePermissions = this.getPermissionsForRole(role);
    return permissions.some((p) => rolePermissions.includes(p));
  }

  /**
   * Check if a role has all of the given permissions
   * @param {string} role - Role name
   * @param {Array<string>} permissions - Permissions to check
   * @returns {boolean} True if role has all permissions
   */
  static roleHasAllPermissions(role, permissions) {
    const rolePermissions = this.getPermissionsForRole(role);
    return permissions.every((p) => rolePermissions.includes(p));
  }

  /**
   * Get role level (for hierarchy comparison)
   * @param {string} role - Role name
   * @returns {number} Role level (0-3)
   */
  static getRoleLevel(role) {
    const roleData = ROLES[role];
    return roleData ? roleData.level : 0;
  }

  /**
   * Check if one role can manage another (based on hierarchy)
   * @param {string} managerRole - Role of the manager
   * @param {string} targetRole - Role being managed
   * @returns {boolean} True if manager can manage target
   */
  static canManageRole(managerRole, targetRole) {
    const managerLevel = this.getRoleLevel(managerRole);
    const targetLevel = this.getRoleLevel(targetRole);

    // Can only manage roles below your level
    // Exception: superadmin cannot be managed by anyone
    if (targetRole === 'superadmin') {
      return false;
    }

    return managerLevel > targetLevel;
  }

  /**
   * Validate if a role name is valid
   * @param {string} role - Role name
   * @returns {boolean} True if valid
   */
  static isValidRole(role) {
    return Object.keys(ROLES).includes(role);
  }

  /**
   * Get displayable role name
   * @param {string} role - Role name
   * @param {string} language - Language (en/es)
   * @returns {string} Display name
   */
  static getRoleDisplayName(role, language = 'en') {
    const roleData = ROLES[role];
    if (!roleData) return role;

    const name = language === 'es' ? roleData.nameEs : roleData.name;
    return `${roleData.emoji} ${name}`;
  }

  /**
   * Get all admin roles (roles that can access admin panel)
   * @returns {Array<string>} Admin role names
   */
  static getAdminRoles() {
    return ['superadmin', 'admin', 'moderator'];
  }

  /**
   * Check if role is an admin role
   * @param {string} role - Role name
   * @returns {boolean} True if admin role
   */
  static isAdminRole(role) {
    return this.getAdminRoles().includes(role);
  }

  /**
   * Get role emoji
   * @param {string} role - Role name
   * @returns {string} Emoji
   */
  static getRoleEmoji(role) {
    const roleData = ROLES[role];
    return roleData ? roleData.emoji : '👤';
  }
}

// Export both class and constants
module.exports = PermissionModel;
module.exports.PERMISSIONS = PERMISSIONS;
module.exports.ROLES = ROLES;
