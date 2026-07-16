const { ROLES, PERMISSIONS } = require('../../../config/roles.config');
const RoleService = require('../../../services/roleService');
const AuditLogService = require('../../../services/AuditLogService');
const { getPool } = require('../../../config/postgres');
const logger = require('../../../utils/logger');

const roleController = {
  async assignRole(req, res) {
    try {
      const { userId, roleName, reason } = req.body;
      const actorId = req.session?.user?.id;

      if (!userId || !roleName) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_INPUT', message: 'userId y roleName requeridos' }
        });
      }

      // Validate role name against the users.role domain (lowercase)
      const VALID_ROLES = ['user', 'creator', 'moderator', 'admin', 'superadmin'];
      if (!VALID_ROLES.includes(roleName)) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_ROLE', message: `Rol no válido: ${roleName}` }
        });
      }

      // Privilege escalation guard — actors cannot assign roles >= their own rank
      const ROLE_RANKS = { user: 0, creator: 1, moderator: 2, admin: 3, superadmin: 4 };
      const actorRoleRow = await getPool().query('SELECT role FROM users WHERE id = $1', [actorId]);
      const actorRole = actorRoleRow.rows[0]?.role || 'user';
      const actorRank = ROLE_RANKS[actorRole] ?? 0;
      const targetRank = ROLE_RANKS[roleName] ?? 0;
      if (actorRank < 4 && targetRank >= actorRank) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Cannot assign a role equal to or higher than your own' }
        });
      }

      const result = await RoleService.setUserRole(userId, roleName, actorId);

      // Audit log
      await req.auditLog('ROLE_ASSIGNED', 'user', userId, {}, { role: roleName }, { reason });

      res.json({ success: true, data: result });
    } catch (error) {
      logger.error('Error en assignRole:', error);
      res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: error.message }
      });
    }
  },

  async removeRole(req, res) {
    try {
      const { userId, roleName } = req.body;

      if (!userId || !roleName) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_INPUT', message: 'userId y roleName requeridos' }
        });
      }

      // Privilege escalation guard — actors cannot remove roles >= their own rank
      const ROLE_RANKS = { user: 0, creator: 1, moderator: 2, admin: 3, superadmin: 4 };
      const actorId = req.session?.user?.id;
      const actorRoleRow = await getPool().query('SELECT role FROM users WHERE id = $1', [actorId]);
      const actorRank = ROLE_RANKS[actorRoleRow.rows[0]?.role ?? 'user'] ?? 0;
      const targetRoleRow = await getPool().query('SELECT role FROM users WHERE id = $1', [userId]);
      const targetRank = ROLE_RANKS[targetRoleRow.rows[0]?.role ?? 'user'] ?? 0;
      if (actorRank < 4 && targetRank >= actorRank) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Cannot remove a role equal to or higher than your own' }
        });
      }

      // NOTE: RoleService.removeRole resets the user to the default role ('user')
      // in the user_roles table. It does NOT selectively remove only the named role;
      // the users table has a single role column so "removing" always resets to 'user'.
      const result = await RoleService.removeRole(userId, roleName, req.session.user.id);

      // Audit log
      await req.auditLog('ROLE_REMOVED', 'user', userId, { role: roleName }, {});

      res.json({ success: true, data: result });
    } catch (error) {
      logger.error('Error en removeRole:', error);
      res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: error.message }
      });
    }
  },

  async getUserRoles(req, res) {
    try {
      const { userId } = req.params;

      const roles = await RoleService.getUserRoles(userId);

      res.json({ success: true, data: roles });
    } catch (error) {
      logger.error('Error en getUserRoles:', error);
      res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: error.message }
      });
    }
  },

  async listRoles(req, res) {
    try {
      const result = await getPool().query('SELECT DISTINCT role FROM users ORDER BY role');
      const roles = result.rows.map(r => r.role);
      res.json({ success: true, data: roles });
    } catch (error) {
      logger.error('Error en listRoles:', error);
      res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: error.message }
      });
    }
  },

  async getPermissions(req, res) {
    try {
      const { roleName } = req.query;

      if (roleName) {
        // Per-role permission lookup not implemented
        return res.status(501).json({ success: false, error: 'Not implemented' });
      }

      const result = await getPool().query(`
        SELECT id, name, display_name, description, category FROM permissions
        ORDER BY category, display_name
      `);

      res.json({ success: true, data: result.rows });
    } catch (error) {
      logger.error('Error en getPermissions:', error);
      res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: error.message }
      });
    }
  },

  async filterUsersByRole(req, res) {
    return res.status(501).json({ success: false, error: 'Not implemented' });
  },

  async checkPermission(req, res) {
    try {
      const { userId, permission } = req.query;

      if (!userId || !permission) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_INPUT', message: 'userId y permission requeridos' }
        });
      }

      const hasPermission = await RoleService.hasPermission(userId, permission);

      res.json({ success: true, data: { hasPermission } });
    } catch (error) {
      logger.error('Error en checkPermission:', error);
      res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: error.message }
      });
    }
  }
};

module.exports = roleController;
