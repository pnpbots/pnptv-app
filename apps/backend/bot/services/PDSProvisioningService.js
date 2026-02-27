/**
 * PDSProvisioningService.js
 * Automatic PDS (Personal Data Server) provisioning on Telegram login
 *
 * Responsibilities:
 * - Create/link PDS instances for users
 * - Generate and manage DIDs (Decentralized Identifiers)
 * - Encrypt and store PDS credentials
 * - Health checks and verification
 * - Automatic key rotation
 * - Audit logging
 */

const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const axios = require('axios');
const logger = require('../../utils/logger');
const { query } = require('../../config/postgres');
const { getRedis } = require('../../config/redis');

const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const SALT_LENGTH = 32;
const TAG_LENGTH = 16;

class PDSProvisioningService {
  /**
   * Main entry point: Create or link PDS for user
   * Called immediately after Telegram auth success
   */
  static async createOrLinkPDS(user) {
    try {
      const startTime = Date.now();

      if (!user || !user.id) {
        throw new Error('Invalid user object provided to createOrLinkPDS');
      }

      logger.info(`[PDS] Starting provisioning for user: ${user.id}`);

      // Check if user already has PDS mapping
      const existingMapping = await this.getUserPDSMapping(user.id);

      if (existingMapping) {
        logger.info(`[PDS] User ${user.id} already has PDS, verifying...`);

        // Verify existing PDS is still accessible
        const isAccessible = await this.verifyPDSAccessibility(existingMapping);

        if (isAccessible) {
          logger.info(`[PDS] Existing PDS verified for user ${user.id}`);

          // Update last verified timestamp
          await query(
            'UPDATE user_pds_mapping SET last_health_check = CURRENT_TIMESTAMP WHERE user_id = $1',
            [user.id]
          );

          await this.logProvisioningAction(user.id, existingMapping.pnptv_uuid, 'verified', 'success', {
            existing: true,
            accessible: true
          });

          return {
            success: true,
            pnptv_uuid: existingMapping.pnptv_uuid,
            pds_handle: existingMapping.pds_handle,
            pds_did: existingMapping.pds_did,
            status: existingMapping.status,
            duration_ms: Date.now() - startTime
          };
        } else {
          logger.warn(`[PDS] Existing PDS inaccessible for user ${user.id}, marking error`);

          await query(
            'UPDATE user_pds_mapping SET health_status = $1, sync_error = $2 WHERE user_id = $3',
            ['error', 'PDS endpoint unreachable', user.id]
          );

          // Queue for retry
          await this.queueProvisioningAction(user.id, existingMapping.pnptv_uuid, 'retry', {
            reason: 'accessibility_check_failed'
          });
        }
      }

      // Create new PDS for this user
      const pnptv_uuid = uuidv4();
      logger.info(`[PDS] Creating new PDS with UUID: ${pnptv_uuid}`);

      // Generate PDS DID and credentials
      const pds_did = await this.generateDID(user);
      const pds_handle = this.generatePDSHandle(user);

      logger.info(`[PDS] Generated DID: ${pds_did}, Handle: ${pds_handle}`);

      // Provision PDS instance
      const pdsConfig = await this.provisionPDSInstance(pnptv_uuid, user, pds_did, pds_handle);

      if (!pdsConfig) {
        throw new Error('Failed to provision PDS instance');
      }

      // Create AT Protocol account
      const atProtoAccount = await this.createATProtocolAccount(pds_did, pds_handle, pdsConfig);

      if (!atProtoAccount) {
        throw new Error('Failed to create AT Protocol account');
      }

      // Encrypt and store credentials
      const encryptedCreds = await this.encryptAndStoreCredentials(
        user.id,
        pnptv_uuid,
        pds_did,
        pds_handle,
        pdsConfig,
        atProtoAccount
      );

      if (!encryptedCreds) {
        throw new Error('Failed to encrypt and store credentials');
      }

      // Auto-setup Bluesky (async, non-blocking)
      setImmediate(async () => {
        try {
          const BlueskyAutoSetupService = require('./BlueskyAutoSetupService');
          await BlueskyAutoSetupService.autoSetupBluesky(user, encryptedCreds);
        } catch (blueskyError) {
          logger.warn(`[PDS] Bluesky auto-setup failed (non-blocking):`, blueskyError.message);
          // Don't throw - PDS provisioning still succeeds
        }
      });

      logger.info(`[PDS] Successfully provisioned PDS for user ${user.id}, duration: ${Date.now() - startTime}ms`);

      // Log success
      await this.logProvisioningAction(user.id, pnptv_uuid, 'created', 'success', {
        pds_did,
        pds_handle,
        pds_endpoint: pdsConfig.endpoint
      });

      return {
        success: true,
        pnptv_uuid,
        pds_handle,
        pds_did,
        pds_endpoint: pdsConfig.endpoint,
        status: 'active',
        duration_ms: Date.now() - startTime
      };

    } catch (error) {
      logger.error(`[PDS] Provisioning error for user ${user?.id}:`, error);

      // Still allow login but log error
      if (user?.id) {
        try {
          const pnptv_uuid = uuidv4();
          await this.logProvisioningAction(user.id, pnptv_uuid, 'error', 'failed', {
            error: error.message,
            stack: error.stack
          });

          // Queue for retry
          await this.queueProvisioningAction(user.id, pnptv_uuid, 'retry', {
            reason: 'initial_provisioning_failed',
            error: error.message
          });
        } catch (logError) {
          logger.error(`[PDS] Failed to log provisioning error:`, logError);
        }
      }

      return {
        success: false,
        error: error.message,
        retry_queued: true
      };
    }
  }

  /**
   * Get existing PDS mapping for user
   */
  static async getUserPDSMapping(userId) {
    try {
      const result = await query(
        `SELECT
          id, user_id, pds_did, pds_handle,
          pds_instance_url AS pds_endpoint,
          health_status AS status,
          sync_error AS error_message,
          last_health_check AS last_verified_at,
          bluesky_handle, bluesky_did, bluesky_status,
          bluesky_auto_sync, bluesky_synced_at, bluesky_created_at,
          created_at, updated_at
         FROM user_pds_mapping
         WHERE user_id = $1`,
        [userId]
      );

      return result.rows[0] || null;
    } catch (error) {
      logger.error(`[PDS] Error fetching PDS mapping for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Generate DID (Decentralized Identifier)
   * Format: did:web:username.pnptv.app
   */
  static async generateDID(user) {
    try {
      const domain = process.env.PDS_DOMAIN || 'pnptv.app';
      const handle = (user.username || `user${user.id}`).toLowerCase().replace(/[^a-z0-9_-]/g, '');

      // Ensure uniqueness by adding random suffix if needed
      const suffix = crypto.randomBytes(4).toString('hex').substring(0, 6);
      const did = `did:web:${handle}-${suffix}.${domain}`;

      logger.debug(`[PDS] Generated DID: ${did}`);
      return did;
    } catch (error) {
      logger.error(`[PDS] Error generating DID:`, error);
      throw error;
    }
  }

  /**
   * Generate PDS handle for AT Protocol
   * Format: @username.pnptv.app
   */
  static generatePDSHandle(user) {
    const domain = process.env.PDS_DOMAIN || 'pnptv.app';
    const handle = (user.username || `user${user.id}`).toLowerCase().replace(/[^a-z0-9_-]/g, '');
    return `@${handle}.${domain}`;
  }

  /**
   * Provision PDS instance (local or remote)
   */
  static async provisionPDSInstance(pnptv_uuid, user, pds_did, pds_handle) {
    try {
      const pdsMode = process.env.PDS_MODE || 'local';

      logger.info(`[PDS] Provisioning ${pdsMode} PDS instance for ${pds_handle}`);

      if (pdsMode === 'local') {
        return await this.provisionLocalPDS(pnptv_uuid, user, pds_did, pds_handle);
      } else if (pdsMode === 'remote') {
        return await this.provisionRemotePDS(pnptv_uuid, user, pds_did, pds_handle);
      } else if (pdsMode === 'hybrid') {
        return await this.provisionHybridPDS(pnptv_uuid, user, pds_did, pds_handle);
      }

      throw new Error(`Unknown PDS mode: ${pdsMode}`);
    } catch (error) {
      logger.error(`[PDS] PDS provisioning error:`, error);
      throw error;
    }
  }

  /**
   * Provision local PDS instance
   */
  static async provisionLocalPDS(pnptv_uuid, user, pds_did, pds_handle) {
    try {
      const adminDid = process.env.PDS_ADMIN_DID;
      const adminPassword = process.env.PDS_ADMIN_PASSWORD;
      const localEndpoint = process.env.PDS_LOCAL_ENDPOINT || 'http://127.0.0.1:3000';

      if (!adminDid || !adminPassword) {
        throw new Error('PDS_ADMIN_DID or PDS_ADMIN_PASSWORD not configured');
      }

      // Call local PDS API to create account
      const response = await axios.post(`${localEndpoint}/xrpc/com.atproto.server.createAccount`, {
        handle: pds_handle,
        password: this.generateSecurePassword(),
        did: pds_did,
        email: user.email || `${user.id}@pnptv.app`
      }, {
        headers: {
          'Authorization': `Bearer ${adminDid}:${adminPassword}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      });

      logger.info(`[PDS] Local PDS account created: ${pds_handle}`);

      return {
        endpoint: localEndpoint,
        did: response.data.did,
        accessJwt: response.data.accessJwt,
        refreshJwt: response.data.refreshJwt,
        handle: response.data.handle
      };

    } catch (error) {
      logger.error(`[PDS] Local PDS provisioning error:`, error);
      throw error;
    }
  }

  /**
   * Provision remote PDS instance
   */
  static async provisionRemotePDS(pnptv_uuid, user, pds_did, pds_handle) {
    try {
      const remoteProvider = process.env.PDS_REMOTE_PROVIDER || 'https://pds.bluesky.social';

      logger.info(`[PDS] Provisioning remote PDS via ${remoteProvider}`);

      const response = await axios.post(`${remoteProvider}/xrpc/com.atproto.server.createAccount`, {
        handle: pds_handle,
        password: this.generateSecurePassword(),
        email: user.email || `${user.id}@pnptv.app`
      }, {
        timeout: 10000
      });

      logger.info(`[PDS] Remote PDS account created: ${pds_handle}`);

      return {
        endpoint: remoteProvider,
        did: response.data.did,
        accessJwt: response.data.accessJwt,
        refreshJwt: response.data.refreshJwt,
        handle: response.data.handle
      };

    } catch (error) {
      logger.error(`[PDS] Remote PDS provisioning error:`, error);
      throw error;
    }
  }

  /**
   * Provision hybrid PDS (mix of local and remote with load balancing)
   */
  static async provisionHybridPDS(pnptv_uuid, user, pds_did, pds_handle) {
    try {
      // Use simple round-robin: hash user ID to determine which provider
      const hash = crypto.createHash('sha256').update(user.id).digest();
      const useLocal = hash[0] % 2 === 0;

      logger.info(`[PDS] Provisioning hybrid PDS, using ${useLocal ? 'local' : 'remote'} for ${pds_handle}`);

      if (useLocal) {
        return await this.provisionLocalPDS(pnptv_uuid, user, pds_did, pds_handle);
      } else {
        return await this.provisionRemotePDS(pnptv_uuid, user, pds_did, pds_handle);
      }

    } catch (error) {
      logger.error(`[PDS] Hybrid PDS provisioning error:`, error);

      // Fallback to opposite provider if one fails
      try {
        logger.info(`[PDS] Falling back to opposite provider...`);
        const useLocal = (crypto.createHash('sha256').update(user.id).digest()[0] % 2) === 0;

        if (useLocal) {
          return await this.provisionRemotePDS(pnptv_uuid, user, pds_did, pds_handle);
        } else {
          return await this.provisionLocalPDS(pnptv_uuid, user, pds_did, pds_handle);
        }
      } catch (fallbackError) {
        logger.error(`[PDS] Fallback provisioning also failed:`, fallbackError);
        throw new Error(`All PDS provisioning methods failed: ${error.message}`);
      }
    }
  }

  /**
   * Create AT Protocol account
   */
  static async createATProtocolAccount(pds_did, pds_handle, pdsConfig) {
    try {
      logger.info(`[PDS] Creating AT Protocol account for ${pds_handle}`);

      // Generate signing keys
      const { publicKey, privateKey } = this.generateSigningKeys();

      // Return account credentials
      return {
        did: pdsConfig.did,
        handle: pds_handle,
        publicKey,
        privateKey,
        accessJwt: pdsConfig.accessJwt,
        refreshJwt: pdsConfig.refreshJwt
      };

    } catch (error) {
      logger.error(`[PDS] AT Protocol account creation error:`, error);
      throw error;
    }
  }

  /**
   * Generate Ed25519 signing key pair
   */
  static generateSigningKeys() {
    try {
      const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
        publicKeyEncoding: {
          format: 'spki',
          type: 'spki'
        },
        privateKeyEncoding: {
          format: 'pkcs8',
          type: 'pkcs8'
        }
      });

      return {
        publicKey: publicKey.toString('base64'),
        privateKey: privateKey.toString('base64')
      };
    } catch (error) {
      logger.error(`[PDS] Error generating signing keys:`, error);
      throw error;
    }
  }

  /**
   * Encrypt and store PDS credentials
   */
  static async encryptAndStoreCredentials(userId, pnptv_uuid, pds_did, pds_handle, pdsConfig, atProtoAccount) {
    try {
      const encryptionKey = process.env.PDS_ENCRYPTION_KEY;

      if (!encryptionKey || encryptionKey.length < 32) {
        throw new Error('PDS_ENCRYPTION_KEY not configured or too short');
      }

      // Generate random IV
      const iv = crypto.randomBytes(16);

      // Create cipher
      const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, Buffer.from(encryptionKey.slice(0, 32)), iv);

      // Data to encrypt
      const credentialsToEncrypt = JSON.stringify({
        publicKey: atProtoAccount.publicKey,
        privateKey: atProtoAccount.privateKey,
        accessJwt: pdsConfig.accessJwt,
        refreshJwt: pdsConfig.refreshJwt
      });

      // Encrypt
      let encrypted = cipher.update(credentialsToEncrypt, 'utf8', 'hex');
      encrypted += cipher.final('hex');

      // Get auth tag
      const authTag = cipher.getAuthTag();

      // Build encrypted credentials blob (actual schema uses single encrypted_credentials column)
      const encryptedBlob = JSON.stringify({
        data: encrypted,
        iv: iv.toString('hex'),
        authTag: authTag.toString('hex')
      });

      // Store in database (matches actual user_pds_mapping schema)
      const result = await query(
        `INSERT INTO user_pds_mapping (
          user_id, pds_did, pds_handle, pds_instance_url,
          encrypted_credentials, encryption_version, health_status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (user_id) DO UPDATE SET
          pds_did = $2, pds_handle = $3, pds_instance_url = $4,
          encrypted_credentials = $5, encryption_version = $6,
          health_status = $7, updated_at = CURRENT_TIMESTAMP
        RETURNING *`,
        [
          userId,
          pds_did,
          pds_handle,
          pdsConfig.endpoint || process.env.PDS_LOCAL_ENDPOINT,
          encryptedBlob,
          1,
          'active'
        ]
      );

      logger.info(`[PDS] Credentials encrypted and stored for user ${userId}`);

      // Create automatic backup
      await this.createAutoBackup(userId, pnptv_uuid, credentialsToEncrypt, iv, authTag);

      return result.rows[0];

    } catch (error) {
      logger.error(`[PDS] Error encrypting and storing credentials:`, error);
      throw error;
    }
  }

  /**
   * Create automatic backup of credentials
   */
  static async createAutoBackup(userId, pnptv_uuid, credentialsJson, iv, authTag) {
    try {
      const encryptionKey = process.env.PDS_ENCRYPTION_KEY;
      const backupIv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, Buffer.from(encryptionKey.slice(0, 32)), backupIv);

      let encrypted = cipher.update(credentialsJson, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      const backupAuthTag = cipher.getAuthTag();

      await query(
        `INSERT INTO pds_credential_backups (
          user_id, pnptv_uuid, backup_type, backup_data_encrypted,
          backup_iv, backup_auth_tag, expires_at
        ) VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP + INTERVAL '30 days')`,
        [userId, pnptv_uuid, 'auto', encrypted, backupIv.toString('hex'), backupAuthTag.toString('hex')]
      );

      logger.debug(`[PDS] Auto backup created for user ${userId}`);
    } catch (error) {
      logger.warn(`[PDS] Failed to create auto backup:`, error);
      // Don't throw - backup failure shouldn't block provisioning
    }
  }

  /**
   * Verify PDS accessibility
   */
  static async verifyPDSAccessibility(pdsMapping) {
    try {
      if (!pdsMapping?.pds_endpoint || !pdsMapping?.pds_did) {
        logger.warn(`[PDS] Missing endpoint or DID for verification`);
        return false;
      }

      const startTime = Date.now();

      // Health check 1: Connectivity
      try {
        const response = await axios.get(`${pdsMapping.pds_endpoint}/.well-known/atproto-did`, {
          timeout: 5000
        });

        const responseTime = Date.now() - startTime;

        await this.logHealthCheck(
          pdsMapping.user_id,
          pdsMapping.pnptv_uuid,
          'connectivity',
          'success',
          responseTime,
          { did: response.data.did }
        );

        logger.info(`[PDS] PDS endpoint accessible in ${responseTime}ms`);
        return true;

      } catch (error) {
        logger.warn(`[PDS] PDS endpoint not accessible:`, error.message);

        await this.logHealthCheck(
          pdsMapping.user_id,
          pdsMapping.pnptv_uuid,
          'connectivity',
          'failed',
          Date.now() - startTime,
          { error: error.message }
        );

        return false;
      }

    } catch (error) {
      logger.error(`[PDS] Error verifying PDS accessibility:`, error);
      return false;
    }
  }

  /**
   * Log provisioning action
   */
  static async logProvisioningAction(userId, pdsDid, action, status, details = {}) {
    try {
      await query(
        `INSERT INTO pds_provisioning_log (
          user_id, event_type, status, pds_did, request_data
        ) VALUES ($1, $2, $3, $4, $5)`,
        [userId, action, status, pdsDid || null, JSON.stringify(details)]
      );
    } catch (error) {
      logger.error(`[PDS] Error logging provisioning action:`, error);
    }
  }

  /**
   * Log health check
   */
  static async logHealthCheck(userId, pdsDid, checkType, status, responseTime, details = {}) {
    try {
      await query(
        `INSERT INTO pds_health_checks (
          user_id, pds_did, status, response_time_ms, last_error
        ) VALUES ($1, $2, $3, $4, $5)`,
        [userId, pdsDid, status, responseTime, details.error || null]
      );
    } catch (error) {
      logger.warn(`[PDS] Error logging health check:`, error);
    }
  }

  /**
   * Queue provisioning action for async retry
   */
  static async queueProvisioningAction(userId, pdsDid, action, errorDetails = {}) {
    try {
      await query(
        `INSERT INTO pds_provisioning_queue (
          user_id, queue_type, status, metadata, scheduled_at
        ) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP + INTERVAL '5 minutes')`,
        [userId, action, 'pending', JSON.stringify({ pds_did: pdsDid, ...errorDetails })]
      );

      logger.info(`[PDS] Queued ${action} retry for user ${userId}`);
    } catch (error) {
      logger.error(`[PDS] Error queuing provisioning action:`, error);
    }
  }

  /**
   * Process queued provisioning actions (called by background worker)
   */
  static async processQueuedActions() {
    try {
      const pendingQueue = await query(
        `SELECT * FROM pds_provisioning_queue
         WHERE status = 'pending' AND next_retry <= CURRENT_TIMESTAMP AND attempt_count < max_attempts
         ORDER BY created_at ASC
         LIMIT 10`
      );

      for (const queueItem of pendingQueue.rows) {
        try {
          logger.info(`[PDS] Processing queued action: ${queueItem.action} for user ${queueItem.user_id}`);

          // Update status
          await query(
            `UPDATE pds_provisioning_queue SET status = 'processing' WHERE id = $1`,
            [queueItem.id]
          );

          // Get user
          const userResult = await query('SELECT * FROM users WHERE id = $1', [queueItem.user_id]);
          const user = userResult.rows[0];

          if (!user) {
            throw new Error('User not found');
          }

          // Execute action
          if (queueItem.action === 'create') {
            await this.createOrLinkPDS(user);
          } else if (queueItem.action === 'verify') {
            const pdsMapping = await this.getUserPDSMapping(user.id);
            if (pdsMapping) {
              await this.verifyPDSAccessibility(pdsMapping);
            }
          } else if (queueItem.action === 'rotate_keys') {
            await this.rotateKeys(user.id);
          } else if (queueItem.action === 'retry') {
            // Retry original provisioning
            await this.createOrLinkPDS(user);
          }

          // Mark as completed
          await query(
            `UPDATE pds_provisioning_queue SET status = 'completed' WHERE id = $1`,
            [queueItem.id]
          );

          logger.info(`[PDS] Successfully completed queued action for user ${queueItem.user_id}`);

        } catch (actionError) {
          logger.error(`[PDS] Error processing queued action:`, actionError);

          // Increment attempt count and schedule retry
          const nextRetry = new Date(Date.now() + (5 * 60 * 1000 * (queueItem.attempt_count + 1)));

          await query(
            `UPDATE pds_provisioning_queue
             SET attempt_count = attempt_count + 1,
                 next_retry = $1,
                 error_details = jsonb_set(error_details, '{lastError}', $2),
                 status = CASE WHEN attempt_count + 1 >= max_attempts THEN 'failed' ELSE 'pending' END
             WHERE id = $3`,
            [nextRetry, JSON.stringify(actionError.message), queueItem.id]
          );
        }
      }

    } catch (error) {
      logger.error(`[PDS] Error processing queue:`, error);
    }
  }

  /**
   * Rotate PDS keys (called every 90 days)
   */
  static async rotateKeys(userId) {
    try {
      logger.info(`[PDS] Rotating keys for user ${userId}`);

      const pdsMapping = await this.getUserPDSMapping(userId);

      if (!pdsMapping) {
        throw new Error('PDS mapping not found for user');
      }

      // Generate new signing keys
      const { publicKey, privateKey } = this.generateSigningKeys();

      // Encrypt new private key
      const encryptionKey = process.env.PDS_ENCRYPTION_KEY;
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, Buffer.from(encryptionKey.slice(0, 32)), iv);

      let encrypted = cipher.update(privateKey, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      const authTag = cipher.getAuthTag();

      // Update encrypted credentials in database
      const encryptedBlob = JSON.stringify({
        data: encrypted,
        iv: iv.toString('hex'),
        authTag: authTag.toString('hex'),
        publicKey
      });

      await query(
        `UPDATE user_pds_mapping
         SET encrypted_credentials = $1, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = $2`,
        [encryptedBlob, userId]
      );

      // Log rotation
      await this.logProvisioningAction(userId, pdsMapping.pds_did, 'key_rotated', 'success', {
        publicKeyFingerprint: publicKey.substring(0, 20) + '...'
      });

      logger.info(`[PDS] Keys rotated successfully for user ${userId}`);

      return true;

    } catch (error) {
      logger.error(`[PDS] Error rotating keys:`, error);
      throw error;
    }
  }

  /**
   * Get user's PDS info (requires authentication)
   */
  static async getPDSInfo(userId, include2FAVerified = false) {
    try {
      const pdsMapping = await this.getUserPDSMapping(userId);

      if (!pdsMapping) {
        return null;
      }

      // Basic info always available
      const info = {
        pnptv_uuid: pdsMapping.pnptv_uuid,
        pds_handle: pdsMapping.pds_handle,
        pds_did: pdsMapping.pds_did,
        pds_endpoint: pdsMapping.pds_endpoint,
        status: pdsMapping.status,
        verification_status: pdsMapping.verification_status,
        created_at: pdsMapping.created_at
      };

      // Sensitive info only with 2FA verification
      if (include2FAVerified) {
        info.pds_public_key = pdsMapping.pds_public_key;
        // Never return encrypted keys even with 2FA
      }

      return info;

    } catch (error) {
      logger.error(`[PDS] Error getting PDS info for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Generate secure random password
   */
  static generateSecurePassword() {
    return crypto.randomBytes(24).toString('base64').replace(/[^a-zA-Z0-9]/g, '').substring(0, 32);
  }

  /**
   * Decrypt PDS credentials (requires 2FA verification)
   */
  static async decryptCredentials(userId, encryptedData, iv, authTag) {
    try {
      const encryptionKey = process.env.PDS_ENCRYPTION_KEY;

      const decipher = crypto.createDecipheriv(
        ENCRYPTION_ALGORITHM,
        Buffer.from(encryptionKey.slice(0, 32)),
        Buffer.from(iv, 'hex')
      );

      decipher.setAuthTag(Buffer.from(authTag, 'hex'));

      let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      return JSON.parse(decrypted);

    } catch (error) {
      logger.error(`[PDS] Error decrypting credentials:`, error);
      throw new Error('Failed to decrypt PDS credentials - may be corrupted or tampered');
    }
  }

  /**
   * Retry failed provisioning for user
   */
  static async retryFailedProvisioning(userId) {
    try {
      logger.info(`[PDS] Manual retry for user ${userId}`);

      const userResult = await query('SELECT * FROM users WHERE id = $1', [userId]);
      const user = userResult.rows[0];

      if (!user) {
        throw new Error('User not found');
      }

      // Delete old mapping if exists
      await query('DELETE FROM user_pds_mapping WHERE user_id = $1', [userId]);

      // Reprovision
      return await this.createOrLinkPDS(user);

    } catch (error) {
      logger.error(`[PDS] Error retrying provisioning:`, error);
      throw error;
    }
  }
}

module.exports = PDSProvisioningService;
