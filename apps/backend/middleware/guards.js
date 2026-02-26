const { ROLES, ROLE_HIERARCHY } = require('../config/roles.config');
const { getPool } = require('../config/postgres');
const logger = require('../utils/logger');

const roleGuard = (requiredRole) => {
  return async (req, res, next) => {
    try {
      if (!req.session || !req.session.user) {
        return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'No autenticado' } });
      }

      const userId = req.session.user.id;

      const userQuery = `
        SELECT r.name, r.rank FROM users u
        LEFT JOIN roles r ON u.role_id = r.id
        WHERE u.id = $1
      `;
      const userResult = await getPool().query(userQuery, [userId]);

      if (userResult.rows.length === 0) {
        return res.status(401).json({ success: false, error: { code: 'USER_NOT_FOUND', message: 'Usuario no encontrado' } });
      }

      const userRole = userResult.rows[0].name || ROLES.USER;
      const userRank = userResult.rows[0].rank || 0;
      const requiredRank = ROLE_HIERARCHY[requiredRole] || 0;

      if (userRank < requiredRank) {
        logger.warn(`Acceso denegado: Usuario ${userId} (${userRole}) intenta acceder a ${requiredRole}`);
        return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Permiso insuficiente' } });
      }

      req.user = { ...req.session.user, role: userRole, rank: userRank };
      next();
    } catch (error) {
      logger.error('Error en roleGuard:', error);
      res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
    }
  };
};

const permissionGuard = (requiredPermission) => {
  return async (req, res, next) => {
    try {
      if (!req.session || !req.session.user) {
        return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'No autenticado' } });
      }

      const userId = req.session.user.id;

      const permQuery = `
        SELECT DISTINCT p.name
        FROM users u
        LEFT JOIN user_roles ur ON u.id = ur.user_id
        LEFT JOIN roles r ON COALESCE(ur.role_id, u.role_id) = r.id
        LEFT JOIN role_permissions rp ON r.id = rp.role_id
        LEFT JOIN permissions p ON rp.permission_id = p.id
        WHERE u.id = $1 AND (p.name = $2 OR r.name = $3)
      `;
      const permResult = await getPool().query(permQuery, [userId, requiredPermission, ROLES.SUPERADMIN]);

      if (permResult.rows.length === 0) {
        logger.warn(`Permiso denegado: Usuario ${userId} intenta usar ${requiredPermission}`);
        return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: `Permiso requerido: ${requiredPermission}` } });
      }

      next();
    } catch (error) {
      logger.error('Error en permissionGuard:', error);
      res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
    }
  };
};

const adminGuard = async (req, res, next) => {
  return roleGuard(ROLES.ADMIN)(req, res, next);
};

const moderatorGuard = async (req, res, next) => {
  return roleGuard(ROLES.MODERATOR)(req, res, next);
};

const superadminGuard = async (req, res, next) => {
  return roleGuard(ROLES.SUPERADMIN)(req, res, next);
};

module.exports = {
  roleGuard,
  permissionGuard,
  adminGuard,
  moderatorGuard,
  superadminGuard
};
