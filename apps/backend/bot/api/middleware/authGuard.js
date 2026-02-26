const logger = require('../../../utils/logger');

/**
 * Auth Guard Middleware
 * Protects routes requiring authentication
 */
const authGuard = (req, res, next) => {
  const user = req.session?.user;

  if (!user) {
    logger.warn('Unauthorized access attempt', {
      path: req.path,
      method: req.method,
      ip: req.ip,
    });

    return res.status(401).json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication required',
      },
    });
  }

  req.user = user;
  next();
};

module.exports = authGuard;
