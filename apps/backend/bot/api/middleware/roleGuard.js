const { getPool } = require('../../../config/postgres');
const logger = require('../../../utils/logger');
const AuthentikService = require('../../../services/authentikService');

/**
 * Role Guard Middleware
 * Protects routes requiring specific roles.
 * Validates role from DB on every request — never trusts the stale session role.
 * This prevents demoted admins from retaining access for the full 90-day session TTL.
 */
const roleGuard = (...allowedRoles) => {
  return async (req, res, next) => {
    const sessionUser = req.session?.user;

    if (!sessionUser) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
        },
      });
    }

    try {
      const result = await getPool().query(
        'SELECT role, pnptv_id FROM users WHERE id = $1',
        [sessionUser.id]
      );

      if (result.rows.length === 0) {
        return res.status(401).json({
          success: false,
          error: {
            code: 'USER_NOT_FOUND',
            message: 'User not found',
          },
        });
      }

      let userRole = result.rows[0].role || 'user';
      const pnptvId = result.rows[0].pnptv_id || sessionUser.pnptvId || sessionUser.pnptv_id || null;

      if (pnptvId && userRole !== 'superadmin' && (userRole === 'admin' || allowedRoles.includes('admin'))) {
        try {
          const resolvedRole = await AuthentikService.resolveEffectiveRole({
            authentikSub: pnptvId,
            dbRole: userRole,
          });
          if (resolvedRole !== userRole) {
            await getPool().query(
              'UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2',
              [resolvedRole, sessionUser.id]
            );
            userRole = resolvedRole;
          }
        } catch (authentikErr) {
          logger.warn('roleGuard Authentik role check failed, falling back to DB role', {
            userId: sessionUser.id,
            error: authentikErr.message,
          });
        }
      }

      if (!allowedRoles.includes(userRole)) {
        logger.warn('Forbidden access attempt', {
          userId: sessionUser.id,
          requiredRoles: allowedRoles,
          userRole,
          path: req.path,
        });

        return res.status(403).json({
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: `Access denied. Required roles: ${allowedRoles.join(', ')}`,
          },
        });
      }

      // Attach fresh DB-sourced role to req.user for downstream handlers
      req.user = { ...sessionUser, role: userRole };
      next();
    } catch (error) {
      logger.error('roleGuard DB error:', error);
      return res.status(500).json({
        success: false,
        error: {
          code: 'SERVER_ERROR',
          message: 'Internal server error',
        },
      });
    }
  };
};

module.exports = roleGuard;
