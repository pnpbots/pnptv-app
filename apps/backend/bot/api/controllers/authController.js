const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../../../config/postgres');
const { cache } = require('../../../config/redis');
const logger = require('../../../utils/logger');
const SubscriptionService = require('../../services/subscriptionService');

/**
 * Authentication Controller
 * Handles login, registration, and authentication flows
 */
class AuthController {
  /**
   * Admin login (email + password)
   */
  static async adminLogin(req, res) {
    try {
      const { email, password, rememberMe } = req.body;

      // Validate input
      if (!email || !password) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_INPUT',
            message: 'Email and password are required',
          },
        });
      }

      // Find user and verify role
      const result = await query(
        `SELECT id, email, password_hash, role, tier, username, created_at
         FROM users
         WHERE email = $1 AND (role = 'admin' OR role = 'superadmin')`,
        [email.toLowerCase()]
      );

      const user = result.rows[0];

      if (!user) {
        logger.warn('Admin login failed - user not found', { email });
        return res.status(401).json({
          success: false,
          error: {
            code: 'INVALID_CREDENTIALS',
            message: 'Invalid email or password',
          },
        });
      }

      // Verify password
      const isPasswordValid = await bcrypt.compare(password, user.password_hash);

      if (!isPasswordValid) {
        logger.warn('Admin login failed - invalid password', { userId: user.id });
        return res.status(401).json({
          success: false,
          error: {
            code: 'INVALID_CREDENTIALS',
            message: 'Invalid email or password',
          },
        });
      }

      // Update last login
      await query(
        `UPDATE users SET last_login_at = NOW() WHERE id = $1`,
        [user.id]
      );

      // Set session
      req.session.user = {
        id: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
        tier: user.tier || 'free',
      };

      // Set cookie maxAge if remember me
      if (rememberMe) {
        req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days
      }

      logger.info('Admin login successful', {
        userId: user.id,
        email: user.email,
        role: user.role,
      });

      res.json({
        success: true,
        data: {
          user: {
            id: user.id,
            email: user.email,
            username: user.username,
            role: user.role,
          },
        },
      });
    } catch (error) {
      logger.error('Error in adminLogin:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Login failed',
        },
      });
    }
  }

  /**
   * Model login (email + password)
   */
  static async modelLogin(req, res) {
    try {
      const { email, password } = req.body;

      // Validate input
      if (!email || !password) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_INPUT',
            message: 'Email and password are required',
          },
        });
      }

      const result = await query(
        `SELECT id, email, password_hash, role, tier, username, telegram, subscription_status
         FROM users
         WHERE email = $1 AND (role = 'model' OR role = 'admin' OR role = 'superadmin')`,
        [email.toLowerCase()]
      );

      const user = result.rows[0];

      if (!user) {
        logger.warn('Model login failed - user not found', { email });
        return res.status(401).json({
          success: false,
          error: {
            code: 'INVALID_CREDENTIALS',
            message: 'Invalid email or password',
          },
        });
      }

      const isPasswordValid = await bcrypt.compare(password, user.password_hash);
      if (!isPasswordValid) {
        logger.warn('Model login failed - invalid password', { userId: user.id });
        return res.status(401).json({
          success: false,
          error: {
            code: 'INVALID_CREDENTIALS',
            message: 'Invalid email or password',
          },
        });
      }

      // Update last login
      await query(
        `UPDATE users SET last_login_at = NOW() WHERE id = $1`,
        [user.id]
      );

      // Set session
      req.session.user = {
        id: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
        tier: user.tier || 'free',
        telegramId: user.telegram,
      };

      logger.info('Model login successful', {
        userId: user.id,
        email: user.email,
        role: user.role,
      });

      res.json({
        success: true,
        data: {
          user: {
            id: user.id,
            email: user.email,
            username: user.username,
            role: user.role,
            telegramId: user.telegram,
            subscriptionStatus: user.subscription_status,
          },
        },
      });
    } catch (error) {
      logger.error('Error in modelLogin:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Login failed',
        },
      });
    }
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
    try {
      const { email, password, username } = req.body;

      // Validate input
      if (!email || !password || !username) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_INPUT',
            message: 'Email, password, and username are required',
          },
        });
      }

      // Check if email exists
      const existingUser = await query(
        `SELECT id FROM users WHERE email = $1`,
        [email.toLowerCase()]
      );

      if (existingUser.rows.length > 0) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'EMAIL_EXISTS',
            message: 'Email already registered',
          },
        });
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(password, 10);

      // Create user
      const userId = uuidv4();
      const timestamp = new Date();

      await query(
        `INSERT INTO users (id, email, username, password_hash, role, email_verified, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          userId,
          email.toLowerCase(),
          username,
          hashedPassword,
          'model',
          false,
          timestamp,
          timestamp,
        ]
      );

      // Initialize default subscription for model
      try {
        const plans = await SubscriptionService.initializeDefaultPlans();
        // Model gets free access initially
      } catch (error) {
        logger.warn('Error initializing plans:', error);
      }

      logger.info('Model registered successfully', {
        userId,
        email,
        username,
      });

      res.status(201).json({
        success: true,
        data: {
          user: {
            id: userId,
            email,
            username,
            role: 'model',
          },
          message: 'Registration successful. Please log in.',
        },
      });
    } catch (error) {
      logger.error('Error in registerModel:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Registration failed',
        },
      });
    }
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
        `SELECT id, email, username, role, subscription_status FROM users WHERE id = $1`,
        [user.id]
      );

      const latestUser = result.rows[0];

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
   */
  static async checkAdminStatus(req, res) {
    try {
      const user = req.session?.user;

      const isAdmin = user && ['admin', 'superadmin'].includes(user.role);

      res.json({
        success: true,
        data: {
          isAdmin,
          user: isAdmin
            ? {
                id: user.id,
                email: user.email,
                role: user.role,
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
   */
  static async checkModelStatus(req, res) {
    try {
      const user = req.session?.user;

      const isModel = user && ['model', 'admin', 'superadmin'].includes(user.role);

      res.json({
        success: true,
        data: {
          isModel,
          user: isModel
            ? {
                id: user.id,
                email: user.email,
                role: user.role,
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
