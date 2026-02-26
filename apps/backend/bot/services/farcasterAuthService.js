const { verifyJwt } = require('@farcaster/quick-auth');
const logger = require('../../utils/logger');

/**
 * Farcaster Quick Auth Service
 * Handles authentication of Farcaster users via Quick Auth tokens
 * Used in conjunction with Daimo Pay for enhanced user verification
 */
class FarcasterAuthService {
  constructor() {
    // Domain for JWT verification (must match your app domain)
    this.domain = process.env.FARCASTER_APP_DOMAIN || process.env.BOT_WEBHOOK_DOMAIN?.replace('https://', '').replace('http://', '');

    logger.info('Farcaster Auth Service initialized', {
      domain: this.domain,
    });
  }

  /**
   * Verify a Quick Auth JWT token
   * @param {string} token - The JWT token from Quick Auth
   * @returns {Promise<Object>} Verified payload with FID
   */
  async verifyToken(token) {
    try {
      if (!token) {
        throw new Error('No token provided');
      }

      if (!this.domain) {
        logger.warn('FARCASTER_APP_DOMAIN not configured, cannot verify tokens');
        throw new Error('Farcaster authentication not configured');
      }

      // Verify the JWT token using Farcaster Quick Auth
      const payload = await verifyJwt({ token, domain: this.domain });

      // Extract FID from the subject claim
      const fid = payload.sub;

      if (!fid) {
        throw new Error('Invalid token: missing FID');
      }

      logger.info('Farcaster token verified successfully', {
        fid,
        domain: this.domain,
      });

      return {
        valid: true,
        fid,
        payload,
      };
    } catch (error) {
      logger.error('Error verifying Farcaster token:', {
        error: error.message,
        domain: this.domain,
      });

      return {
        valid: false,
        error: error.message,
      };
    }
  }

  /**
   * Extract FID from Authorization header
   * @param {string} authHeader - Authorization header value (Bearer token)
   * @returns {Promise<Object>} Verification result
   */
  async verifyAuthHeader(authHeader) {
    try {
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw new Error('Invalid authorization header format');
      }

      const token = authHeader.replace('Bearer ', '');
      return await this.verifyToken(token);
    } catch (error) {
      logger.error('Error verifying auth header:', {
        error: error.message,
      });

      return {
        valid: false,
        error: error.message,
      };
    }
  }

  /**
   * Middleware for Express routes requiring Farcaster authentication
   * @param {boolean} optional - If true, continues even without auth
   * @returns {Function} Express middleware
   */
  authMiddleware(optional = false) {
    return async (req, res, next) => {
      try {
        const authHeader = req.headers.authorization;

        if (!authHeader) {
          if (optional) {
            req.farcasterUser = null;
            return next();
          }
          return res.status(401).json({
            success: false,
            error: 'Authorization header required',
          });
        }

        const result = await this.verifyAuthHeader(authHeader);

        if (!result.valid) {
          if (optional) {
            req.farcasterUser = null;
            return next();
          }
          return res.status(401).json({
            success: false,
            error: result.error || 'Invalid token',
          });
        }

        // Attach Farcaster user info to request
        req.farcasterUser = {
          fid: result.fid,
          payload: result.payload,
        };

        next();
      } catch (error) {
        logger.error('Auth middleware error:', {
          error: error.message,
        });

        if (optional) {
          req.farcasterUser = null;
          return next();
        }

        res.status(500).json({
          success: false,
          error: 'Authentication error',
        });
      }
    };
  }

  /**
   * Link a Farcaster FID with a Telegram user
   * @param {string} telegramUserId - Telegram user ID
   * @param {string} fid - Farcaster FID
   * @returns {Promise<Object>} Link result
   */
  async linkFarcasterToTelegram(telegramUserId, fid) {
    try {
      const UserModel = require('../../models/userModel');

      // Update user with Farcaster FID using updateProfile
      await UserModel.updateProfile(telegramUserId, {
        farcaster_fid: fid,
        farcaster_linked_at: new Date(),
      });

      logger.info('Farcaster FID linked to Telegram user', {
        telegramUserId,
        fid,
      });

      return {
        success: true,
        telegramUserId,
        fid,
      };
    } catch (error) {
      logger.error('Error linking Farcaster to Telegram:', {
        error: error.message,
        telegramUserId,
        fid,
      });

      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get Farcaster user profile by FID
   * @param {string} fid - Farcaster FID
   * @returns {Promise<Object>} User profile data
   */
  async getFarcasterProfile(fid) {
    try {
      // Use Neynar or Farcaster Hub API to fetch profile
      const axios = require('axios');
      const neynarApiKey = process.env.NEYNAR_API_KEY;

      if (!neynarApiKey) {
        logger.warn('NEYNAR_API_KEY not configured, cannot fetch profile');
        return {
          success: false,
          error: 'Profile lookup not configured',
        };
      }

      const response = await axios.get(`https://api.neynar.com/v2/farcaster/user/bulk?fids=${fid}`, {
        headers: {
          'api_key': neynarApiKey,
        },
      });

      const user = response.data?.users?.[0];

      if (!user) {
        return {
          success: false,
          error: 'User not found',
        };
      }

      return {
        success: true,
        profile: {
          fid: user.fid,
          username: user.username,
          displayName: user.display_name,
          pfpUrl: user.pfp_url,
          bio: user.profile?.bio?.text,
          followerCount: user.follower_count,
          followingCount: user.following_count,
          verifiedAddresses: user.verified_addresses,
        },
      };
    } catch (error) {
      logger.error('Error fetching Farcaster profile:', {
        error: error.message,
        fid,
      });

      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Check if service is properly configured
   * @returns {boolean} True if configured
   */
  isConfigured() {
    return !!this.domain;
  }
}

// Export singleton instance
module.exports = new FarcasterAuthService();
