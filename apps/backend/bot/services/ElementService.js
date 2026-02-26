/**
 * ElementService.js
 * Handles Matrix/Element account provisioning and management
 *
 * Responsibilities:
 * - Create Element (Matrix) accounts automatically
 * - Sync profile data to Element
 * - Manage encryption keys
 * - Verify Element accessibility
 * - Store encrypted credentials
 */

const axios = require('axios');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const logger = require('../../utils/logger');
const { query } = require('../../config/postgres');

const ELEMENT_HOMESERVER = process.env.ELEMENT_HOMESERVER || 'http://127.0.0.1:8008';
const ELEMENT_PUBLIC_URL = process.env.ELEMENT_PUBLIC_URL || 'https://element.pnptv.app';
const ADMIN_TOKEN = process.env.ELEMENT_ADMIN_TOKEN || '';

class ElementService {
  /**
   * Create Element account for user (called after Bluesky setup succeeds)
   */
  static async createElementAccount(userId, displayName, profileData = {}) {
    try {
      const startTime = Date.now();

      logger.info(`[Element] Creating account for user ${userId}, displayName: ${displayName}`);

      // Generate unique Matrix username
      // Format: @user<id>_<random>:element.pnptv.app
      const randomSuffix = crypto.randomBytes(4).toString('hex').substring(0, 6);
      const matrixUsername = `user${userId}_${randomSuffix}`.toLowerCase();
      const matrixUserId = `@${matrixUsername}:element.pnptv.app`;

      // Generate secure password for Element account
      const elementPassword = this.generateSecurePassword();

      // Create account on Element homeserver
      const accountResponse = await axios.post(
        `${ELEMENT_HOMESERVER}/_matrix/client/r0/register`,
        {
          user: matrixUsername,
          password: elementPassword,
          initial_device_display_name: `pnptv-${userId}`,
          auth: { type: 'm.login.dummy' }
        },
        {
          timeout: 10000,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );

      const accessToken = accountResponse.data.access_token;
      const deviceId = accountResponse.data.device_id;

      if (!accessToken) {
        throw new Error('No access token in Element response');
      }

      logger.info(`[Element] Account created: ${matrixUserId}, token received`);

      // Update profile (avatar, display name, bio)
      try {
        await this.syncElementProfile(userId, matrixUserId, accessToken, displayName, profileData);
      } catch (syncError) {
        logger.warn(`[Element] Profile sync warning (non-blocking):`, syncError.message);
        // Don't fail account creation due to profile sync issues
      }

      // Store encrypted credentials
      await this.storeEncryptedCredentials(userId, matrixUserId, matrixUsername, accessToken, deviceId);

      logger.info(`[Element] Account provisioning complete for ${userId} in ${Date.now() - startTime}ms`);

      return {
        success: true,
        matrixUserId,
        matrixUsername,
        displayName,
        createdAt: new Date().toISOString(),
        duration_ms: Date.now() - startTime
      };

    } catch (error) {
      logger.error(`[Element] Account creation error for user ${userId}:`, error.message);

      // Log detailed error for debugging
      if (error.response?.data) {
        logger.debug(`[Element] Error response:`, error.response.data);
      }

      return {
        success: false,
        error: error.message,
        details: error.response?.data || null
      };
    }
  }

  /**
   * Sync profile data to Element account
   */
  static async syncElementProfile(userId, matrixUserId, accessToken, displayName, profileData = {}) {
    try {
      logger.debug(`[Element] Syncing profile for ${matrixUserId}`);

      // Set display name
      if (displayName) {
        await axios.put(
          `${ELEMENT_HOMESERVER}/_matrix/client/r0/profile/${matrixUserId}/displayname`,
          { displayname: displayName },
          {
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json'
            },
            timeout: 5000
          }
        );
      }

      // Set avatar if provided
      if (profileData.avatar_url) {
        try {
          // Upload avatar to Element
          const avatarUploadResponse = await axios.post(
            `${ELEMENT_HOMESERVER}/_matrix/media/r0/upload`,
            profileData.avatar_url,
            {
              headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'image/webp'
              },
              timeout: 10000
            }
          );

          const contentUri = avatarUploadResponse.data.content_uri;

          // Set avatar profile
          if (contentUri) {
            await axios.put(
              `${ELEMENT_HOMESERVER}/_matrix/client/r0/profile/${matrixUserId}/avatar_url`,
              { avatar_url: contentUri },
              {
                headers: {
                  'Authorization': `Bearer ${accessToken}`,
                  'Content-Type': 'application/json'
                },
                timeout: 5000
              }
            );
          }
        } catch (avatarError) {
          logger.warn(`[Element] Avatar sync failed for ${matrixUserId}:`, avatarError.message);
          // Don't fail entire sync due to avatar issues
        }
      }

      logger.info(`[Element] Profile synced for ${matrixUserId}`);
      return { success: true };

    } catch (error) {
      logger.error(`[Element] Profile sync error for ${matrixUserId}:`, error.message);
      throw error;
    }
  }

  /**
   * Get Element account status for user
   */
  static async getElementStatus(userId) {
    try {
      const result = await query(
        `SELECT
          ep.id,
          ep.external_user_id as matrix_user_id,
          ep.external_username as matrix_username,
          ep.profile_name,
          ep.is_verified,
          ep.verified_at,
          ep.last_synced_at,
          ep.created_at,
          ep.access_token_encrypted,
          ep.token_expires_at
         FROM external_profiles ep
         WHERE ep.pnptv_user_id = $1 AND ep.service_type = 'element'`,
        [userId]
      );

      const profile = result.rows[0];

      if (!profile) {
        return {
          setup: false,
          ready: false,
          message: 'Element account not provisioned'
        };
      }

      // Check if credentials still valid
      const isExpired = profile.token_expires_at && new Date(profile.token_expires_at) < new Date();

      return {
        setup: true,
        ready: !isExpired,
        matrixUserId: profile.matrix_user_id,
        matrixUsername: profile.matrix_username,
        displayName: profile.profile_name,
        verified: profile.is_verified,
        verifiedAt: profile.verified_at,
        lastSynced: profile.last_synced_at,
        createdAt: profile.created_at,
        accessTokenValid: !isExpired,
        tokenExpiresAt: profile.token_expires_at
      };

    } catch (error) {
      logger.error(`[Element] Status check error for user ${userId}:`, error);
      return {
        setup: false,
        ready: false,
        error: error.message
      };
    }
  }

  /**
   * Verify Element account accessibility
   */
  static async verifyElementAccessibility(matrixUserId, accessToken) {
    try {
      const response = await axios.get(
        `${ELEMENT_HOMESERVER}/_matrix/client/r0/account/whoami`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`
          },
          timeout: 5000
        }
      );

      const verified = response.data.user_id === matrixUserId;

      if (verified) {
        logger.info(`[Element] Verified accessibility for ${matrixUserId}`);
      }

      return verified;

    } catch (error) {
      logger.warn(`[Element] Accessibility verification failed for ${matrixUserId}:`, error.message);
      return false;
    }
  }

  /**
   * Link to existing Element account
   */
  static async linkToElement(userId, matrixUserId, matrixUsername, accessToken) {
    try {
      logger.info(`[Element] Linking user ${userId} to existing account ${matrixUserId}`);

      // Verify the account is actually accessible
      const isAccessible = await this.verifyElementAccessibility(matrixUserId, accessToken);

      if (!isAccessible) {
        throw new Error('Element account not accessible with provided token');
      }

      // Store credentials
      await this.storeEncryptedCredentials(userId, matrixUserId, matrixUsername, accessToken, null);

      logger.info(`[Element] Successfully linked user ${userId} to ${matrixUserId}`);

      return {
        success: true,
        matrixUserId,
        message: 'Element account linked successfully'
      };

    } catch (error) {
      logger.error(`[Element] Link error for user ${userId}:`, error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Disconnect Element account
   */
  static async disconnectElement(userId) {
    try {
      logger.info(`[Element] Disconnecting Element account for user ${userId}`);

      // Get current Element profile
      const result = await query(
        `SELECT id, access_token_encrypted FROM external_profiles
         WHERE pnptv_user_id = $1 AND service_type = 'element'`,
        [userId]
      );

      const profile = result.rows[0];

      if (profile) {
        // Try to sign out the session before deletion
        try {
          const accessToken = this.decryptToken(profile.access_token_encrypted);

          await axios.post(
            `${ELEMENT_HOMESERVER}/_matrix/client/r0/logout`,
            {},
            {
              headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
              },
              timeout: 5000
            }
          );

          logger.info(`[Element] Signed out session for user ${userId}`);
        } catch (signoutError) {
          logger.warn(`[Element] Logout warning (non-blocking):`, signoutError.message);
          // Continue with deletion even if logout fails
        }

        // Delete profile record
        await query(
          `DELETE FROM external_profiles
           WHERE pnptv_user_id = $1 AND service_type = 'element'`,
          [userId]
        );

        logger.info(`[Element] Disconnected for user ${userId}`);
      }

      return {
        success: true,
        message: 'Element account disconnected'
      };

    } catch (error) {
      logger.error(`[Element] Disconnect error for user ${userId}:`, error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Store encrypted credentials in database
   */
  static async storeEncryptedCredentials(userId, matrixUserId, matrixUsername, accessToken, deviceId) {
    try {
      // Encrypt access token
      const encryptedToken = this.encryptToken(accessToken);

      // Check if profile already exists
      const existing = await query(
        `SELECT id FROM external_profiles
         WHERE pnptv_user_id = $1 AND service_type = 'element'`,
        [userId]
      );

      if (existing.rows.length > 0) {
        // Update existing
        await query(
          `UPDATE external_profiles
           SET external_user_id = $1,
               external_username = $2,
               access_token_encrypted = $3,
               token_expires_at = $4,
               last_synced_at = NOW(),
               updated_at = NOW()
           WHERE pnptv_user_id = $5 AND service_type = 'element'`,
          [matrixUserId, matrixUsername, encryptedToken, null, userId]
        );
      } else {
        // Insert new
        await query(
          `INSERT INTO external_profiles
           (pnptv_user_id, service_type, external_user_id, external_username,
            profile_name, access_token_encrypted, is_verified, verified_at,
            last_synced_at)
           VALUES ($1, 'element', $2, $3, $4, $5, true, NOW(), NOW())`,
          [userId, matrixUserId, matrixUsername, matrixUsername, encryptedToken]
        );
      }

      logger.info(`[Element] Credentials stored for user ${userId}`);
      return true;

    } catch (error) {
      logger.error(`[Element] Credential storage error:`, error);
      throw error;
    }
  }

  /**
   * Encrypt access token
   */
  static encryptToken(token) {
    try {
      const key = crypto
        .createHash('sha256')
        .update(process.env.ENCRYPTION_KEY || 'default-key')
        .digest();

      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);

      let encrypted = cipher.update(token, 'utf8', 'hex');
      encrypted += cipher.final('hex');

      return `${iv.toString('hex')}:${encrypted}`;
    } catch (error) {
      logger.error('[Element] Token encryption error:', error);
      throw error;
    }
  }

  /**
   * Decrypt access token
   */
  static decryptToken(encryptedToken) {
    try {
      const [ivHex, encrypted] = encryptedToken.split(':');
      const key = crypto
        .createHash('sha256')
        .update(process.env.ENCRYPTION_KEY || 'default-key')
        .digest();

      const iv = Buffer.from(ivHex, 'hex');
      const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);

      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      return decrypted;
    } catch (error) {
      logger.error('[Element] Token decryption error:', error);
      throw error;
    }
  }

  /**
   * Generate secure password
   */
  static generateSecurePassword() {
    return crypto.randomBytes(24).toString('base64');
  }
}

module.exports = ElementService;
