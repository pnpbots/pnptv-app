const logger = require('../../../utils/logger');

/**
 * Role Guard Middleware
 * Protects routes requiring specific roles
 */
const roleGuard = (...allowedRoles) => {
  return (req, res, next) => {
    const user = req.session?.user;

    if (!user) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
        },
      });
    }

    const userRole = user.role;

    if (!allowedRoles.includes(userRole)) {
      logger.warn('Forbidden access attempt', {
        userId: user.id,
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

    next();
  };
};

module.exports = roleGuard;
