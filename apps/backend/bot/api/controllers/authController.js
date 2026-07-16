const { query } = require('../../../config/postgres');
const logger = require('../../../utils/logger');

/**
 * Authentication Controller
 * Handles login, registration, and authentication flows
 */
class AuthController {
  static localAuthDisabled(res) {
    return res.status(403).json({
      success: false,
      error: {
        code: 'AUTHENTIK_REQUIRED',
        message: 'Local email/password authentication is disabled. Sign in with Authentik.',
      },
    });
  }

  /**
   * Admin login (email + password)
   */
  static async adminLogin(req, res) {
    return AuthController.localAuthDisabled(res);
  }

  /**
   * Model login (email + password)
   */
  static async modelLogin(req, res) {
    return AuthController.localAuthDisabled(res);
  }

  /**
   * Logout
   */
  static async logout(req, res) {
    try {
      const userId = req.session?.user?.id;

      req.session.destroy((err) => {
        if (err) {
          logger.error('Session destruction error:', err);
        }

        if (userId) {
          logger.info('User logged out', { userId });
        }

        res.clearCookie('__pnptv_sid', {
          path: '/',
          domain: process.env.NODE_ENV === 'production' ? '.pnptv.app' : undefined,
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
        });
        res.json({
          success: true,
          data: {
            message: 'Logged out successfully',
          },
        });
      });
    } catch (error) {
      logger.error('Error in logout:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Logout failed',
        },
      });
    }
  }

  /**
   * Register new user (for models)
   */
  static async registerModel(req, res) {
    return AuthController.localAuthDisabled(res);
  }

  /**
   * Check authentication status
   */
  static async checkAuthStatus(req, res) {
    try {
      const user = req.session?.user;

      if (!user) {
        return res.json({
          success: true,
          data: {
            authenticated: false,
            user: null,
          },
        });
      }

      // Get latest user data
      const result = await query(
        `SELECT id, email, username, role, subscription_status, tier FROM users WHERE id = $1`,
        [user.id]
      );

      const latestUser = result.rows[0];
      if (!latestUser) {
        return res.status(401).json({ success: false, error: { code: 'USER_NOT_FOUND', message: 'Session user not found' } });
      }

      res.json({
        success: true,
        data: {
          authenticated: true,
          user: {
            id: latestUser.id,
            email: latestUser.email,
            username: latestUser.username,
            role: latestUser.role,
            subscriptionStatus: latestUser.subscription_status,
            tier: latestUser.tier || 'free',
          },
        },
      });
    } catch (error) {
      logger.error('Error in checkAuthStatus:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Status check failed',
        },
      });
    }
  }

  /**
   * Check admin status
   * Re-fetches role from DB to prevent stale session role escalation.
   */
  static async checkAdminStatus(req, res) {
    try {
      const user = req.session?.user;
      if (!user?.id) {
        return res.json({ success: true, data: { isAdmin: false, user: null } });
      }

      const dbRow = await query('SELECT role, email FROM users WHERE id = $1', [user.id]);
      const currentRole = dbRow.rows[0]?.role || 'user';
      const isAdmin = ['admin', 'superadmin'].includes(currentRole);

      res.json({
        success: true,
        data: {
          isAdmin,
          user: isAdmin
            ? {
                id: user.id,
                email: dbRow.rows[0]?.email || user.email,
                role: currentRole,
              }
            : null,
        },
      });
    } catch (error) {
      logger.error('Error in checkAdminStatus:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Admin check failed',
        },
      });
    }
  }

  /**
   * Check model status
   * Re-fetches role from DB to prevent stale session role escalation.
   */
  static async checkModelStatus(req, res) {
    try {
      const user = req.session?.user;
      if (!user?.id) {
        return res.json({ success: true, data: { isModel: false, user: null } });
      }

      const dbRow = await query('SELECT role, email FROM users WHERE id = $1', [user.id]);
      const currentRole = dbRow.rows[0]?.role || 'user';
      const isModel = ['model', 'creator', 'admin', 'superadmin'].includes(currentRole);

      res.json({
        success: true,
        data: {
          isModel,
          user: isModel
            ? {
                id: user.id,
                email: dbRow.rows[0]?.email || user.email,
                role: currentRole,
              }
            : null,
        },
      });
    } catch (error) {
      logger.error('Error in checkModelStatus:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Model check failed',
        },
      });
    }
  }
}

module.exports = AuthController;
