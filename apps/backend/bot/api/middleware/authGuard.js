const logger = require('../../../utils/logger');
const PlatformBanService = require('../../services/platformBanService');

/**
 * Auth Guard Middleware
 * Protects routes requiring authentication.
 * Also enforces platform bans — no banned identity vector can reach any
 * protected endpoint regardless of which login method they used.
 */
const authGuard = async (req, res, next) => {
  const user = req.session?.user;

  if (!user) {
    logger.warn('Unauthorized access attempt', {
      path: req.path,
      method: req.method,
      ip: req.ip,
    });
    return res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
    });
  }

  // ── Platform ban check ────────────────────────────────────────────────────
  try {
    if (user.tier === 'banned') {
      req.session?.destroy?.(() => {});
      return res.status(403).json({
        success: false,
        error: { code: 'ACCOUNT_BANNED', message: 'Tu cuenta ha sido suspendida permanentemente.' },
      });
    }

    const ban = await PlatformBanService.isBanned({
      userId:     String(user.id),
      telegramId: user.telegramId || undefined,
      pnptvId:    user.pnptvId   || undefined,
      email:      user.email     || undefined,
    });

    if (ban) {
      logger.warn('authGuard — banned user hit protected API', { userId: user.id, path: req.path });
      req.session?.destroy?.(() => {});
      return res.status(403).json({
        success: false,
        error: { code: 'ACCOUNT_BANNED', message: 'Tu cuenta ha sido suspendida permanentemente.' },
      });
    }
  } catch (banErr) {
    // Fail open — never block a legitimate user on a DB hiccup
    logger.error('authGuard — ban check error (fail open)', { error: banErr.message });
  }
  // ─────────────────────────────────────────────────────────────────────────

  req.user = user;
  next();
};

module.exports = authGuard;
