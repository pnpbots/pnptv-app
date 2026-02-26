const { ROLES, PERMISSIONS } = require('../../../config/roles.config');
const RoleService = require('../../services/RoleService');
const AuditLogService = require('../../services/AuditLogService');
const { getPool } = require('../../../config/postgres');
const logger = require('../../../utils/logger');

const roleController = {
  async assignRole(req, res) {
    try {
      const { userId, roleName, reason } = req.body;

      if (!userId || !roleName) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_INPUT', message: 'userId y roleName requeridos' }
        });
      }

      // Validate role exists
      const roleCheck = await getPool().query('SELECT id FROM roles WHERE name = $1', [roleName]);
      if (roleCheck.rows.length === 0) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_ROLE', message: `Rol no encontrado: ${roleName}` }
        });
      }

      const result = await RoleService.assignRole(userId, roleName, req.session.user.id, reason || '');

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
      const roles = await RoleService.listRoles();

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

      let permissions;

      if (roleName) {
        permissions = await RoleService.getPermissionsForRole(roleName);
      } else {
        const result = await getPool().query(`
          SELECT id, name, display_name, description, category FROM permissions
          ORDER BY category, display_name
        `);
        permissions = result.rows;
      }

      res.json({ success: true, data: permissions });
    } catch (error) {
      logger.error('Error en getPermissions:', error);
      res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: error.message }
      });
    }
  },

  async filterUsersByRole(req, res) {
    try {
      const { role, page = 1, limit = 20 } = req.query;

      if (!role) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_INPUT', message: 'Rol requerido' }
        });
      }

      const offset = (page - 1) * limit;
      const result = await RoleService.filterUsersByRole(role, offset, limit);

      res.json({ success: true, data: result });
    } catch (error) {
      logger.error('Error en filterUsersByRole:', error);
      res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: error.message }
      });
    }
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
