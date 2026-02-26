/**
 * BlueskyAutoSetupService.js
 * One-click Bluesky account setup and automatic profile syncing
 *
 * Philosophy: Zero friction, maximum magic
 * - Auto-create Bluesky account during login
 * - Auto-generate handle from pnptv username
 * - Auto-sync profile (avatar, bio, display name)
 * - Keep both profiles in sync automatically
 */

const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const axios = require('axios');
const logger = require('../../utils/logger');
const { query } = require('../../config/postgres');
const PDSProvisioningService = require('./PDSProvisioningService');

const ENCRYPTION_ALGORITHM = 'aes-256-gcm';

class BlueskyAutoSetupService {
  /**
   * Main entry point: Auto-setup Bluesky during PDS provisioning
   * Called by PDSProvisioningService.createOrLinkPDS()
   */
  static async autoSetupBluesky(user, pdsMapping) {
    try {
      if (!user || !user.id || !pdsMapping) {
        logger.warn('[Bluesky] Missing user or PDS mapping for auto-setup');
        return { success: false, reason: 'missing_data' };
      }

      // Check if already has Bluesky
      if (pdsMapping.bluesky_handle) {
        logger.info(`[Bluesky] User ${user.id} already has Bluesky account`);
        return { success: true, already_setup: true };
      }

      // Skip if auto-setup disabled globally
      if (process.env.BLUESKY_AUTO_SETUP !== 'true') {
        logger.debug('[Bluesky] Auto-setup disabled globally');
        return { success: false, reason: 'auto_setup_disabled' };
      }

      logger.info(`[Bluesky] Starting auto-setup for user ${user.id}`);

      // Generate Bluesky handle
      const blueskyHandle = this.generateBlueskyHandle(user);

      // Check if handle already taken
      const handleExists = await this.checkHandleExists(blueskyHandle);
      if (handleExists) {
        logger.warn(`[Bluesky] Handle ${blueskyHandle} already exists, skipping auto-setup`);
        return { success: false, reason: 'handle_taken' };
      }

      // Create Bluesky DID
      const blueskyDid = await this.createBlueskyDID(user, blueskyHandle);

      // Create Bluesky account via PDS
      const blueskyAccount = await this.createBlueskyAccount(user, blueskyHandle, blueskyDid);

      if (!blueskyAccount) {
        throw new Error('Failed to create Bluesky account');
      }

      // Auto-sync profile from pnptv
      const syncResult = await this.syncProfileToBluesky(user, blueskyAccount);

      // Update user_pds_mapping with Bluesky info
      await this.updatePDSMappingWithBluesky(user.id, blueskyHandle, blueskyDid, 'active');

      // Auto-setup Element (async, non-blocking)
      setImmediate(async () => {
        try {
          const ElementService = require('./ElementService');
          const displayName = user.username || `User ${user.id}`;
          await ElementService.createElementAccount(user.id, displayName, {
            avatar_url: user.photo_file_id ? `/public/uploads/avatars/${user.photo_file_id}` : null
          });
          logger.info(`[Bluesky] Element auto-setup completed for user ${user.id}`);
        } catch (elementError) {
          logger.warn(`[Bluesky] Element auto-setup failed (non-blocking):`, elementError.message);
          // Don't throw - Bluesky setup still succeeds
        }
      });

      // Log the auto-setup action
      await this.logBlueskyAction(user.id, 'auto_setup', 'success', {
        handle: blueskyHandle,
        did: blueskyDid,
        profile_synced: syncResult.success
      });

      logger.info(`[Bluesky] Auto-setup complete for user ${user.id}: ${blueskyHandle}`);

      return {
        success: true,
        blueskyHandle,
        blueskyDid,
        profile_synced: syncResult.success
      };

    } catch (error) {
      logger.error(`[Bluesky] Auto-setup error for user ${user?.id}:`, error);

      // Log the failure
      if (user?.id) {
        try {
          await this.logBlueskyAction(user.id, 'auto_setup', 'failed', {
            error: error.message
          });
        } catch (logError) {
          logger.error(`[Bluesky] Failed to log auto-setup error:`, logError);
        }
      }

      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * One-click setup endpoint: Create Bluesky account on demand
   * User clicks button → account ready instantly
   */
  static async createBlueskyAccountOnClick(userId) {
    try {
      logger.info(`[Bluesky] One-click setup initiated for user ${userId}`);

      // Get user
      const userResult = await query(
        'SELECT id, username, email, photo_file_id FROM users WHERE id = $1',
        [userId]
      );

      if (!userResult.rows[0]) {
        throw new Error('User not found');
      }

      const user = userResult.rows[0];

      // Get existing PDS mapping
      const pdsMapping = await PDSProvisioningService.getUserPDSMapping(userId);

      if (!pdsMapping) {
        throw new Error('User does not have PDS provisioned');
      }

      // Check if already has Bluesky
      if (pdsMapping.bluesky_handle) {
        return {
          success: true,
          already_exists: true,
          blueskyHandle: pdsMapping.bluesky_handle,
          blueskyDid: pdsMapping.bluesky_did
        };
      }

      // Generate handle
      const blueskyHandle = this.generateBlueskyHandle(user);

      // Check if handle taken
      const handleExists = await this.checkHandleExists(blueskyHandle);
      if (handleExists) {
        throw new Error(`Handle @${blueskyHandle} is already taken. Try a different username in settings.`);
      }

      // Create Bluesky DID
      const blueskyDid = await this.createBlueskyDID(user, blueskyHandle);

      // Create account
      const blueskyAccount = await this.createBlueskyAccount(user, blueskyHandle, blueskyDid);

      if (!blueskyAccount) {
        throw new Error('Failed to create Bluesky account');
      }

      // Sync profile
      const syncResult = await this.syncProfileToBluesky(user, blueskyAccount);

      // Update database
      await this.updatePDSMappingWithBluesky(userId, blueskyHandle, blueskyDid, 'active');

      // Auto-setup Element (async, non-blocking)
      setImmediate(async () => {
        try {
          const ElementService = require('./ElementService');
          const displayName = user.username || `User ${userId}`;
          await ElementService.createElementAccount(userId, displayName, {
            avatar_url: user.photo_file_id ? `/public/uploads/avatars/${user.photo_file_id}` : null
          });
          logger.info(`[Bluesky] Element auto-setup completed for user ${userId}`);
        } catch (elementError) {
          logger.warn(`[Bluesky] Element auto-setup failed (non-blocking):`, elementError.message);
          // Don't throw - Bluesky setup still succeeds
        }
      });

      // Log
      await this.logBlueskyAction(userId, 'manual_setup', 'success', {
        handle: blueskyHandle,
        did: blueskyDid,
        profile_synced: syncResult.success
      });

      logger.info(`[Bluesky] One-click setup complete for user ${userId}: ${blueskyHandle}`);

      return {
        success: true,
        blueskyHandle,
        blueskyDid,
        profileSynced: syncResult.success,
        message: `Welcome to Bluesky! Your account @${blueskyHandle} is ready.`
      };

    } catch (error) {
      logger.error(`[Bluesky] One-click setup error for user ${userId}:`, error);

      try {
        await this.logBlueskyAction(userId, 'manual_setup', 'failed', {
          error: error.message
        });
      } catch (logError) {
        logger.warn(`[Bluesky] Failed to log setup error:`, logError);
      }

      throw error;
    }
  }

  /**
   * Generate Bluesky handle: @username.pnptv.app
   */
  static generateBlueskyHandle(user) {
    const domain = process.env.BLUESKY_HANDLE_DOMAIN || 'pnptv.app';
    const handle = (user.username || `user${user.id}`)
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '')
      .substring(0, 20);
    return `@${handle}.${domain}`;
  }

  /**
   * Check if Bluesky handle already exists
   */
  static async checkHandleExists(handle) {
    try {
      const blueskyUrl = process.env.BLUESKY_PDS_URL || 'https://bsky.social';

      // Try to resolve handle via Bluesky API
      const response = await axios.get(
        `${blueskyUrl}/xrpc/com.atproto.identity.resolveHandle`,
        {
          params: { handle },
          timeout: 5000
        }
      );

      return response.status === 200 && !!response.data.did;

    } catch (error) {
      if (error.response?.status === 400 || error.response?.status === 404) {
        return false; // Handle doesn't exist
      }

      logger.warn(`[Bluesky] Error checking handle existence:`, error.message);
      return false; // Assume free on error to allow creation
    }
  }

  /**
   * Create Bluesky DID (Decentralized Identifier)
   * Format: did:key:z... (generated locally, or did:web:...)
   */
  static async createBlueskyDID(user, handle) {
    try {
      // Generate Ed25519 key pair for this account
      const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
        publicKeyEncoding: { format: 'spki', type: 'spki' },
        privateKeyEncoding: { format: 'pkcs8', type: 'pkcs8' }
      });

      // For now, use a simple did:key format (can be enhanced)
      // In production, PDS should generate the actual DID
      const keyBytes = crypto.randomBytes(32);
      const did = `did:key:z${Buffer.from(keyBytes).toString('base64url')}`;

      logger.debug(`[Bluesky] Generated DID: ${did}`);
      return did;

    } catch (error) {
      logger.error(`[Bluesky] Error creating DID:`, error);
      throw error;
    }
  }

  /**
   * Create Bluesky account via PDS
   * Uses existing PDS (local or remote) to create account
   */
  static async createBlueskyAccount(user, handle, did) {
    try {
      const pdsMapping = await PDSProvisioningService.getUserPDSMapping(user.id);

      if (!pdsMapping || !pdsMapping.pds_endpoint) {
        throw new Error('PDS not provisioned for user');
      }

      // Generate secure password for Bluesky account
      const password = PDSProvisioningService.generateSecurePassword();

      const pdsUrl = pdsMapping.pds_endpoint;
      const response = await axios.post(
        `${pdsUrl}/xrpc/com.atproto.server.createAccount`,
        {
          handle: handle.replace('@', ''),  // Remove @ prefix
          password,
          did,
          email: user.email || `${user.id}@pnptv.app`
        },
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 10000
        }
      );

      logger.info(`[Bluesky] Account created: ${handle}`);

      return {
        did: response.data.did,
        handle: response.data.handle,
        accessJwt: response.data.accessJwt,
        refreshJwt: response.data.refreshJwt
      };

    } catch (error) {
      logger.error(`[Bluesky] Error creating account:`, error.message);
      throw error;
    }
  }

  /**
   * Auto-sync pnptv profile to Bluesky
   * Syncs: avatar, bio, display name
   */
  static async syncProfileToBluesky(user, blueskyAccount) {
    try {
      const pdsUrl = (await PDSProvisioningService.getUserPDSMapping(user.id))?.pds_endpoint;

      if (!pdsUrl || !blueskyAccount.accessJwt) {
        logger.warn('[Bluesky] Missing PDS or access token for profile sync');
        return { success: false };
      }

      const profileData = {};

      // Sync display name
      if (user.username) {
        profileData.displayName = user.username;
        await this.logSync(user.id, 'display_name', null, user.username, 'auto');
      }

      // Sync bio (if exists in users table)
      if (user.bio) {
        profileData.description = user.bio;
        await this.logSync(user.id, 'bio', null, user.bio, 'auto');
      }

      // Sync avatar (if exists)
      if (user.photo_file_id) {
        const avatarUrl = this.getProfileAvatarUrl(user.photo_file_id);
        if (avatarUrl) {
          profileData.avatar = avatarUrl;
          await this.logSync(user.id, 'avatar', null, avatarUrl, 'auto');
        }
      }

      // Add pnptv link to profile
      profileData.description = (profileData.description || '')
        + `\n\n🔗 PNPtv member | pnptv.app`;

      // Update profile via PDS
      if (Object.keys(profileData).length > 0) {
        await axios.post(
          `${pdsUrl}/xrpc/com.atproto.repo.putRecord`,
          {
            repo: blueskyAccount.did,
            collection: 'app.bsky.actor.profile',
            rkey: 'self',
            record: {
              $type: 'app.bsky.actor.profile',
              ...profileData,
              createdAt: new Date().toISOString()
            }
          },
          {
            headers: {
              'Authorization': `Bearer ${blueskyAccount.accessJwt}`,
              'Content-Type': 'application/json'
            },
            timeout: 10000
          }
        );

        logger.info(`[Bluesky] Profile synced for user ${user.id}`);
        return { success: true };
      }

      return { success: true };

    } catch (error) {
      logger.warn(`[Bluesky] Profile sync error:`, error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Auto-sync when pnptv profile fields change
   * Called when user updates avatar, bio, or display name
   */
  static async autoSyncProfileChange(userId, fieldName, oldValue, newValue) {
    try {
      // Get Bluesky account
      const pdsMapping = await PDSProvisioningService.getUserPDSMapping(userId);

      if (!pdsMapping?.bluesky_handle || !pdsMapping?.bluesky_auto_sync) {
        logger.debug(`[Bluesky] Auto-sync disabled or no Bluesky account for user ${userId}`);
        return { success: false };
      }

      if (pdsMapping.bluesky_status !== 'active') {
        logger.warn(`[Bluesky] Account not active, skipping sync for user ${userId}`);
        return { success: false };
      }

      logger.info(`[Bluesky] Auto-syncing ${fieldName} for user ${userId}`);

      // Get user
      const userResult = await query(
        'SELECT id, username, email, photo_file_id, bio FROM users WHERE id = $1',
        [userId]
      );

      if (!userResult.rows[0]) {
        return { success: false };
      }

      const user = userResult.rows[0];

      // Get PDS mapping with credentials
      const pdsUrl = pdsMapping.pds_endpoint;

      // Map field to Bluesky profile field
      const profileUpdate = {};

      switch (fieldName) {
        case 'username':
          profileUpdate.displayName = newValue;
          break;
        case 'avatar':
          if (newValue) {
            profileUpdate.avatar = this.getProfileAvatarUrl(newValue);
          }
          break;
        case 'bio':
          profileUpdate.description = newValue
            ? `${newValue}\n\n🔗 PNPtv member | pnptv.app`
            : '🔗 PNPtv member | pnptv.app';
          break;
        default:
          return { success: false };
      }

      // Update Bluesky profile
      await axios.post(
        `${pdsUrl}/xrpc/com.atproto.repo.putRecord`,
        {
          repo: pdsMapping.bluesky_did,
          collection: 'app.bsky.actor.profile',
          rkey: 'self',
          record: {
            $type: 'app.bsky.actor.profile',
            ...profileUpdate,
            createdAt: new Date().toISOString()
          }
        },
        {
          headers: {
            'Authorization': `Bearer ${pdsMapping.pds_access_token}`,
            'Content-Type': 'application/json'
          },
          timeout: 10000
        }
      );

      // Log sync
      await this.logSync(userId, fieldName, oldValue, newValue, 'auto');

      logger.info(`[Bluesky] Synced ${fieldName} for user ${userId}`);

      return { success: true };

    } catch (error) {
      logger.warn(`[Bluesky] Auto-sync error for user ${userId}:`, error.message);

      try {
        await this.logSync(userId, fieldName, oldValue, newValue, 'auto', 'failed', error.message);
      } catch (logError) {
        logger.warn(`[Bluesky] Failed to log sync error:`, logError);
      }

      return { success: false, error: error.message };
    }
  }

  /**
   * Get Bluesky account status
   */
  static async getBlueskyStatus(userId) {
    try {
      const pdsMapping = await PDSProvisioningService.getUserPDSMapping(userId);

      if (!pdsMapping?.bluesky_handle) {
        return {
          setup: false,
          ready: false
        };
      }

      return {
        setup: true,
        ready: pdsMapping.bluesky_status === 'active',
        handle: pdsMapping.bluesky_handle,
        did: pdsMapping.bluesky_did,
        synced_at: pdsMapping.bluesky_synced_at,
        auto_sync_enabled: pdsMapping.bluesky_auto_sync,
        status: pdsMapping.bluesky_status
      };

    } catch (error) {
      logger.error(`[Bluesky] Error getting status for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Disconnect Bluesky account (user-initiated)
   */
  static async disconnectBluesky(userId) {
    try {
      logger.info(`[Bluesky] Disconnecting account for user ${userId}`);

      await query(
        `UPDATE user_pds_mapping
         SET bluesky_handle = NULL,
             bluesky_did = NULL,
             bluesky_status = 'disconnected',
             bluesky_synced_at = NULL,
             updated_at = CURRENT_TIMESTAMP
         WHERE user_id = $1`,
        [userId]
      );

      await this.logBlueskyAction(userId, 'disconnect', 'success', {
        triggered_by: 'user'
      });

      logger.info(`[Bluesky] Account disconnected for user ${userId}`);

      return { success: true };

    } catch (error) {
      logger.error(`[Bluesky] Error disconnecting account for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Update PDS mapping with Bluesky info
   */
  static async updatePDSMappingWithBluesky(userId, blueskyHandle, blueskyDid, status) {
    try {
      await query(
        `UPDATE user_pds_mapping
         SET bluesky_handle = $1,
             bluesky_did = $2,
             bluesky_status = $3,
             bluesky_created_at = CURRENT_TIMESTAMP,
             bluesky_synced_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE user_id = $4`,
        [blueskyHandle, blueskyDid, status, userId]
      );

      logger.debug(`[Bluesky] Updated PDS mapping for user ${userId}`);

    } catch (error) {
      logger.error(`[Bluesky] Error updating PDS mapping:`, error);
      throw error;
    }
  }

  /**
   * Log Bluesky action (auto-setup, manual, etc.)
   */
  static async logBlueskyAction(userId, action, status, details = {}) {
    try {
      await query(
        `INSERT INTO bluesky_profile_syncs (user_id, pnptv_uuid, sync_type, status, triggered_by)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT DO NOTHING`,
        [userId, uuidv4(), action, status, details.triggered_by || 'auto']
      );
    } catch (error) {
      logger.warn(`[Bluesky] Failed to log action:`, error);
    }
  }

  /**
   * Log profile sync operation
   */
  static async logSync(userId, fieldName, oldValue, newValue, triggeredBy = 'auto', status = 'success', errorMessage = null) {
    try {
      await query(
        `INSERT INTO bluesky_profile_syncs (user_id, pnptv_uuid, sync_type, field_name, old_value, new_value, status, triggered_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [userId, uuidv4(), 'field', fieldName, oldValue || '', newValue || '', status, triggeredBy]
      );
    } catch (error) {
      logger.warn(`[Bluesky] Failed to log sync:`, error);
    }
  }

  /**
   * Get profile avatar URL from file ID
   */
  static getProfileAvatarUrl(photoFileId) {
    if (!photoFileId) return null;
    // Assume public/uploads/avatars/ structure
    return `${process.env.BASE_URL || 'https://pnptv.app'}/public/uploads/avatars/${photoFileId}.webp`;
  }

  /**
   * Clean up expired connection requests (background job)
   */
  static async cleanupExpiredRequests() {
    try {
      const result = await query(
        'DELETE FROM bluesky_connection_requests WHERE expires_at < NOW()'
      );

      logger.debug(`[Bluesky] Cleaned up ${result.rowCount} expired requests`);

    } catch (error) {
      logger.warn(`[Bluesky] Error cleaning up expired requests:`, error);
    }
  }
}

module.exports = BlueskyAutoSetupService;
