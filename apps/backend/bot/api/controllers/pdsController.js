/**
 * pdsController.js
 * API endpoints for PDS management and retrieval
 */

const logger = require('../../../utils/logger');
const { query } = require('../../../config/postgres');
const PDSProvisioningService = require('../../services/PDSProvisioningService');

/**
 * POST /api/pds/provision (admin)
 * Manually trigger PDS provisioning for a user
 */
const manuallyProvisionPDS = async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'userId is required'
      });
    }

    // Verify admin
    if (req.session?.user?.role !== 'admin' && req.session?.user?.role !== 'superadmin') {
      return res.status(403).json({
        success: false,
        error: 'Admin access required'
      });
    }

    logger.info(`[PDS] Admin manual provision request for user ${userId}`);

    // Get user
    const userResult = await query('SELECT id, username, email FROM users WHERE id = $1', [userId]);

    if (!userResult.rows[0]) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    const user = userResult.rows[0];

    // Provision PDS
    const result = await PDSProvisioningService.createOrLinkPDS(user);

    res.json({
      success: result.success,
      data: {
        pnptv_uuid: result.pnptv_uuid,
        pds_handle: result.pds_handle,
        pds_did: result.pds_did,
        pds_endpoint: result.pds_endpoint,
        status: result.status,
        duration_ms: result.duration_ms
      }
    });

  } catch (error) {
    logger.error('[PDS] Manual provision error:', error);

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * GET /api/user/pds-info
 * Get authenticated user's PDS information
 */
const getUserPDSInfo = async (req, res) => {
  try {
    const userId = req.session?.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized'
      });
    }

    logger.debug(`[PDS] Fetching PDS info for user ${userId}`);

    const pdsInfo = await PDSProvisioningService.getPDSInfo(userId, false);

    if (!pdsInfo) {
      return res.json({
        success: true,
        data: null,
        message: 'User has no PDS configured'
      });
    }

    res.json({
      success: true,
      data: pdsInfo
    });

  } catch (error) {
    logger.error('[PDS] Get PDS info error:', error);

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * POST /api/pds/retry-provision
 * Manually retry PDS provisioning
 */
const retryProvisioning = async (req, res) => {
  try {
    const userId = req.session?.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized'
      });
    }

    logger.info(`[PDS] User ${userId} requesting retry`);

    const result = await PDSProvisioningService.retryFailedProvisioning(userId);

    res.json({
      success: result.success,
      data: {
        pnptv_uuid: result.pnptv_uuid,
        pds_handle: result.pds_handle,
        pds_did: result.pds_did,
        status: result.status
      }
    });

  } catch (error) {
    logger.error('[PDS] Retry provisioning error:', error);

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * GET /api/pds/health
 * Check PDS endpoint accessibility
 */
const checkPDSHealth = async (req, res) => {
  try {
    const userId = req.session?.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized'
      });
    }

    logger.debug(`[PDS] Health check for user ${userId}`);

    const pdsMapping = await PDSProvisioningService.getUserPDSMapping(userId);

    if (!pdsMapping) {
      return res.json({
        success: true,
        data: {
          has_pds: false
        }
      });
    }

    // Verify accessibility
    const isAccessible = await PDSProvisioningService.verifyPDSAccessibility(pdsMapping);

    res.json({
      success: true,
      data: {
        has_pds: true,
        pds_handle: pdsMapping.pds_handle,
        pds_did: pdsMapping.pds_did,
        status: pdsMapping.status,
        verification_status: pdsMapping.verification_status,
        accessible: isAccessible,
        last_verified_at: pdsMapping.last_verified_at
      }
    });

  } catch (error) {
    logger.error('[PDS] Health check error:', error);

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * GET /api/pds/provisioning-log
 * Get user's provisioning action log
 */
const getProvisioningLog = async (req, res) => {
  try {
    const userId = req.session?.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized'
      });
    }

    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const offset = parseInt(req.query.offset) || 0;

    logger.debug(`[PDS] Fetching provisioning log for user ${userId}`);

    const result = await query(
      `SELECT id, action, status, details, error_message, created_at
       FROM pds_provisioning_log
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );

    const countResult = await query(
      'SELECT COUNT(*) as total FROM pds_provisioning_log WHERE user_id = $1',
      [userId]
    );

    res.json({
      success: true,
      data: result.rows,
      pagination: {
        limit,
        offset,
        total: parseInt(countResult.rows[0].total)
      }
    });

  } catch (error) {
    logger.error('[PDS] Get provisioning log error:', error);

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * POST /api/pds/create-backup
 * Create manual backup of PDS credentials
 */
const createBackup = async (req, res) => {
  try {
    const userId = req.session?.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized'
      });
    }

    logger.info(`[PDS] Manual backup request from user ${userId}`);

    const pdsMapping = await PDSProvisioningService.getUserPDSMapping(userId);

    if (!pdsMapping) {
      return res.status(404).json({
        success: false,
        error: 'User has no PDS configured'
      });
    }

    // Create backup
    const encryptionKey = process.env.PDS_ENCRYPTION_KEY;
    const crypto = require('crypto');
    const backupIv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(encryptionKey.slice(0, 32)), backupIv);

    const credentialsJson = JSON.stringify({
      pds_did: pdsMapping.pds_did,
      pds_handle: pdsMapping.pds_handle,
      pds_endpoint: pdsMapping.pds_endpoint,
      pds_public_key: pdsMapping.pds_public_key,
      backed_up_at: new Date().toISOString()
    });

    let encrypted = cipher.update(credentialsJson, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const backupAuthTag = cipher.getAuthTag();

    const backupResult = await query(
      `INSERT INTO pds_credential_backups (
        user_id, pnptv_uuid, backup_type, backup_data_encrypted,
        backup_iv, backup_auth_tag, expires_at
      ) VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP + INTERVAL '30 days')
       RETURNING id, created_at, expires_at`,
      [userId, pdsMapping.pnptv_uuid, 'manual', encrypted, backupIv.toString('hex'), backupAuthTag.toString('hex')]
    );

    res.json({
      success: true,
      data: {
        backup_id: backupResult.rows[0].id,
        created_at: backupResult.rows[0].created_at,
        expires_at: backupResult.rows[0].expires_at
      }
    });

  } catch (error) {
    logger.error('[PDS] Create backup error:', error);

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * GET /api/pds/verify-2fa
 * Check if user has verified 2FA for credential access
 */
const verify2FAForCredentialAccess = async (req, res) => {
  try {
    const userId = req.session?.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized'
      });
    }

    // TODO: Implement 2FA verification check
    // For now, return false
    const has2FA = false;

    res.json({
      success: true,
      data: {
        has_2fa_verified: has2FA,
        can_access_credentials: has2FA
      }
    });

  } catch (error) {
    logger.error('[PDS] 2FA verification check error:', error);

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * GET /api/pds/health-checks
 * Get recent health checks for user's PDS
 */
const getHealthChecks = async (req, res) => {
  try {
    const userId = req.session?.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized'
      });
    }

    const limit = Math.min(parseInt(req.query.limit) || 20, 100);

    const result = await query(
      `SELECT id, check_type, status, response_time_ms, details, created_at
       FROM pds_health_checks
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [userId, limit]
    );

    res.json({
      success: true,
      data: result.rows
    });

  } catch (error) {
    logger.error('[PDS] Get health checks error:', error);

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

module.exports = {
  manuallyProvisionPDS,
  getUserPDSInfo,
  retryProvisioning,
  checkPDSHealth,
  getProvisioningLog,
  createBackup,
  verify2FAForCredentialAccess,
  getHealthChecks
};
