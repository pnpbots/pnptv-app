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

      const userResult = await getPool().query(
        'SELECT role FROM users WHERE id = $1',
        [userId]
      );

      if (userResult.rows.length === 0) {
        return res.status(401).json({ success: false, error: { code: 'USER_NOT_FOUND', message: 'Usuario no encontrado' } });
      }

      const userRole = userResult.rows[0].role || ROLES.USER;
      const userRank = ROLE_HIERARCHY[userRole] || 0;
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

      // No separate permissions table exists — grant access if user is
      // superadmin, or if their role rank is admin-level or higher.
      const userResult = await getPool().query(
        'SELECT role FROM users WHERE id = $1',
        [userId]
      );

      if (userResult.rows.length === 0) {
        return res.status(401).json({ success: false, error: { code: 'USER_NOT_FOUND', message: 'Usuario no encontrado' } });
      }

      const userRole = userResult.rows[0].role || ROLES.USER;
      const userRank = ROLE_HIERARCHY[userRole] || 0;
      const adminRank = ROLE_HIERARCHY[ROLES.ADMIN] || 3;

      if (userRank < adminRank) {
        logger.warn(`Permiso denegado: Usuario ${userId} (${userRole}) intenta usar ${requiredPermission}`);
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

// creatorAdminGuard — allows creator, admin, and superadmin.
// Used to protect admin routes that creators may access (stats, moderation,
// support, notifications, creator subscriptions, creator applications).
// Uses the list-based API roleGuard (not rank-based) to avoid unintentionally
// granting access to future roles added at rank >= 2.
const _apiRoleGuard = require('../api/middleware/roleGuard');
const creatorAdminGuard = _apiRoleGuard('creator', 'admin', 'superadmin');

module.exports = {
  roleGuard,
  permissionGuard,
  adminGuard,
  moderatorGuard,
  superadminGuard,
  creatorAdminGuard
};
