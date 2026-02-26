const { query } = require('../config/postgres');
const logger = require('../utils/logger');
const ACCESS_CONTROL_CONFIG = require('../config/accessControlConfig');

/**
 * Role Service
 * Manages user roles for access control
 */
class RoleService {
  static tableReady = false;

  static tableInitPromise = null;

  static async ensureTablesReady() {
    if (this.tableReady) return;
    if (!this.tableInitPromise) {
      this.tableInitPromise = this.initializeTables()
        .then(() => {
          this.tableReady = true;
        })
        .finally(() => {
          this.tableInitPromise = null;
        });
    }
    await this.tableInitPromise;
  }

  /**
   * Get user's role
   * @param {string} userId - User ID
   * @returns {Promise<string>} Role name (USER, CONTRIBUTOR, PERFORMER, ADMIN)
   */
  static async getUserRole(userId) {
    try {
      await this.ensureTablesReady();
      const result = await query(
        'SELECT role FROM user_roles WHERE user_id = $1',
        [userId.toString()]
      );

      if (result.rows.length === 0) {
        return 'USER'; // Default role
      }

      return result.rows[0].role;
    } catch (error) {
      logger.error('Error getting user role:', error);
      return 'USER'; // Default on error
    }
  }

  /**
   * Get user's role level (numeric value for comparison)
   * @param {string} userId - User ID
   * @returns {Promise<number>} Role level
   */
  static async getUserRoleLevel(userId) {
    const role = await this.getUserRole(userId);
    return ACCESS_CONTROL_CONFIG.ROLES[role] || ACCESS_CONTROL_CONFIG.ROLES.USER;
  }

  /**
   * Get user's role display name
   * @param {string} userId - User ID
   * @param {string} lang - Language
   * @returns {Promise<string>} Role display name
   */
  static async getUserRoleDisplay(userId, lang) {
    const roleLevel = await this.getUserRoleLevel(userId);
    return ACCESS_CONTROL_CONFIG.ROLE_NAMES[roleLevel] || 'User';
  }

  /**
   * Set user's role
   * @param {string} userId - User ID
   * @param {string} role - Role name (USER, CONTRIBUTOR, PERFORMER, ADMIN)
   * @param {string} grantedBy - Admin who granted the role
   * @returns {Promise<{success: boolean, message: string}>} Result object
   */
  static async setUserRole(userId, role, grantedBy) {
    try {
      await this.ensureTablesReady();
      // Normalize role to uppercase for consistency
      const normalizedRole = role.toUpperCase();

      // Validate role
      if (!ACCESS_CONTROL_CONFIG.ROLES[normalizedRole]) {
        logger.error('Invalid role:', role);
        return { success: false, message: 'Rol inválido' };
      }

      // Upsert role in user_roles table
      await query(
        `INSERT INTO user_roles (user_id, role, granted_by, granted_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (user_id)
         DO UPDATE SET role = $2, granted_by = $3, granted_at = NOW()`,
        [userId.toString(), normalizedRole, grantedBy.toString()]
      );

      // Also update the users table for consistency
      // Keep schema-compatible updates (assigned_by/role_assigned_at may not exist)
      await query(
        `UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2`,
        [normalizedRole.toLowerCase(), userId.toString()]
      );

      logger.info('User role updated', { userId, role: normalizedRole, grantedBy });
      return { success: true, message: `Rol ${normalizedRole} asignado correctamente` };
    } catch (error) {
      logger.error('Error setting user role:', error);
      return { success: false, message: error.message };
    }
  }

  /**
   * Check if user has required role
   * @param {string} userId - User ID
   * @param {string} requiredRole - Required role name
   * @returns {Promise<boolean>} Has permission
   */
  static async hasRole(userId, requiredRole) {
    const userRoleLevel = await this.getUserRoleLevel(userId);
    const requiredLevel = ACCESS_CONTROL_CONFIG.ROLES[requiredRole] || 0;

    return userRoleLevel >= requiredLevel;
  }

  /**
   * Check if user has any of the required roles
   * @param {string} userId - User ID
   * @param {Array<string>} requiredRoles - Array of role names
   * @returns {Promise<boolean>} Has permission
   */
  static async hasAnyRole(userId, requiredRoles) {
    const userRoleLevel = await this.getUserRoleLevel(userId);

    for (const roleName of requiredRoles) {
      const requiredLevel = ACCESS_CONTROL_CONFIG.ROLES[roleName] || 0;
      if (userRoleLevel >= requiredLevel) {
        return true;
      }
    }

    return false;
  }

  /**
   * Get all users with a specific role
   * @param {string} role - Role name
   * @returns {Promise<Array>} Array of user IDs
   */
  static async getUsersByRole(role) {
    try {
      await this.ensureTablesReady();
      // Normalize role to uppercase for query
      const normalizedRole = role.toUpperCase();
      const result = await query(
        'SELECT user_id FROM user_roles WHERE UPPER(role) = $1',
        [normalizedRole]
      );

      return result.rows.map(row => row.user_id);
    } catch (error) {
      logger.error('Error getting users by role:', error);
      return [];
    }
  }

  /**
   * Get all admins
   * @returns {Promise<Array>} Array of admin user IDs
   */
  static async getAdmins() {
    return await this.getUsersByRole('ADMIN');
  }

  /**
   * Get all performers
   * @returns {Promise<Array>} Array of performer user IDs
   */
  static async getPerformers() {
    return await this.getUsersByRole('PERFORMER');
  }

  /**
   * Check if user is admin
   * @param {string} userId - User ID
   * @returns {Promise<boolean>} Is admin
   */
  static async isAdmin(userId) {
    return await this.hasRole(userId, 'ADMIN');
  }

  /**
   * Check if user is superadmin
   * @param {string} userId - User ID
   * @returns {Promise<boolean>} Is superadmin
   */
  static async isSuperAdmin(userId) {
    return await this.hasRole(userId, 'SUPERADMIN');
  }

  /**
   * Remove role from user (reset to USER)
   * @param {string} userId - User ID
   * @param {string} removedBy - Admin who removed the role (optional)
   * @returns {Promise<{success: boolean, message: string}>} Result object
   */
  static async removeRole(userId, removedBy = null) {
    try {
      await this.ensureTablesReady();
      // Remove from user_roles table
      await query(
        'DELETE FROM user_roles WHERE user_id = $1',
        [userId.toString()]
      );

      // Also update the users table for consistency
      // Keep schema-compatible updates (assigned_by/role_assigned_at may not exist)
      await query(
        `UPDATE users SET role = 'user', updated_at = NOW() WHERE id = $1`,
        [userId.toString()]
      );

      logger.info('User role removed', { userId, removedBy });
      return { success: true, message: 'Rol removido correctamente' };
    } catch (error) {
      logger.error('Error removing user role:', error);
      return { success: false, message: error.message };
    }
  }

  /**
   * Get role statistics
   * @returns {Promise<Object>} Role counts
   */
  static async getRoleStats() {
    try {
      await this.ensureTablesReady();
      const result = await query(
        'SELECT UPPER(role) as role, COUNT(*) as count FROM user_roles GROUP BY UPPER(role)'
      );

      const stats = {
        USER: 0,
        CONTRIBUTOR: 0,
        PERFORMER: 0,
        MODERATOR: 0,
        ADMIN: 0,
        SUPERADMIN: 0,
      };

      result.rows.forEach(row => {
        if (stats.hasOwnProperty(row.role)) {
          stats[row.role] = parseInt(row.count);
        }
      });

      return stats;
    } catch (error) {
      logger.error('Error getting role stats:', error);
      return null;
    }
  }

  /**
   * Initialize database tables
   */
  static async initializeTables() {
    try {
      // Create user_roles table
      await query(`
        CREATE TABLE IF NOT EXISTS user_roles (
          user_id VARCHAR(255) PRIMARY KEY,
          role VARCHAR(50) NOT NULL,
          granted_by VARCHAR(255),
          granted_at TIMESTAMP DEFAULT NOW()
        )
      `);

      // Create indexes
      await query('CREATE INDEX IF NOT EXISTS idx_user_roles_role ON user_roles(role)');
      await query('CREATE INDEX IF NOT EXISTS idx_user_roles_granted_at ON user_roles(granted_at)');

      this.tableReady = true;
      logger.info('Role service tables initialized');
    } catch (error) {
      logger.error('Error initializing role tables:', error);
      throw error;
    }
  }
}

module.exports = RoleService;
