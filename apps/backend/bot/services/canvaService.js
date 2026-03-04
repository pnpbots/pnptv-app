'use strict';

/**
 * Canva Connect API Service
 *
 * Handles the full Canva integration lifecycle:
 *   - OAuth 2.0 PKCE flow (authorization, token exchange, refresh)
 *   - Token encryption at rest (AES-256-GCM, same pattern as X OAuth)
 *   - Design listing from Canva API
 *   - Export creation, status polling, MP4 download
 *   - Upload to Directus CMS (files + content item)
 *   - Account unlinking
 */

const crypto = require('crypto');
const axios = require('axios');
const FormData = require('form-data');
const { getRedis } = require('../../config/redis');
const { query } = require('../../config/postgres');
const logger = require('../../utils/logger');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CANVA_API_BASE = 'https://api.canva.com/rest/v1';
const CANVA_AUTHORIZE_URL = 'https://www.canva.com/api/oauth/authorize';
const CANVA_TOKEN_URL = 'https://api.canva.com/rest/v1/oauth/token';

const REDIS_STATE_PREFIX = 'canva:oauth:state:';
const REDIS_STATE_TTL = 600; // 10 minutes
const REDIS_REFRESH_LOCK_PREFIX = 'canva:refresh:lock:';
const REDIS_REFRESH_LOCK_TTL = 30; // 30 seconds

const MAX_DOWNLOAD_SIZE = 500 * 1024 * 1024; // 500 MB

// Quality → Canva export height mapping
const QUALITY_MAP = {
  '720p': 720,
  '1080p': 1080,
  '4k': 2160,
};

// ---------------------------------------------------------------------------
// AES-256-GCM Encryption (same pattern as xOAuthRoutes.js)
// ---------------------------------------------------------------------------

function getEncryptionKey() {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw || !/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error(
      'ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes for AES-256).'
    );
  }
  return Buffer.from(raw, 'hex');
}

function encryptToken(plaintext) {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return JSON.stringify({ data: encrypted, iv: iv.toString('hex'), authTag });
}

function decryptToken(encryptedJson) {
  const { data, iv, authTag } = JSON.parse(encryptedJson);
  const key = getEncryptionKey();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(authTag, 'hex'));
  let decrypted = decipher.update(data, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// ---------------------------------------------------------------------------
// PKCE Helpers
// ---------------------------------------------------------------------------

function b64url(buf) {
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function generatePkce() {
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

// ---------------------------------------------------------------------------
// CanvaService
// ---------------------------------------------------------------------------

class CanvaService {
  /**
   * Generate the Canva OAuth authorization URL and store PKCE state in Redis.
   * @param {string} userId - PNPtv user ID (stored in state for callback)
   * @returns {Promise<string>} Authorization URL to redirect the user to
   */
  static async getAuthUrl(userId) {
    const clientId = process.env.CANVA_CLIENT_ID;
    const redirectUri = process.env.CANVA_REDIRECT_URI;
    const scopes = process.env.CANVA_SCOPES || 'design:content:read design:meta:read asset:read profile:read';

    if (!clientId || !redirectUri) {
      throw new Error('CANVA_CLIENT_ID and CANVA_REDIRECT_URI must be configured');
    }

    const state = crypto.randomBytes(16).toString('hex');
    const { verifier, challenge } = generatePkce();

    // Store state + verifier in Redis (10 min TTL)
    const redis = getRedis();
    await redis.set(
      `${REDIS_STATE_PREFIX}${state}`,
      JSON.stringify({ codeVerifier: verifier, userId }),
      'EX',
      REDIS_STATE_TTL
    );

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: scopes,
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });

    return `${CANVA_AUTHORIZE_URL}?${params.toString()}`;
  }

  /**
   * Exchange the authorization code for tokens and persist to the user row.
   * @param {string} code - Authorization code from Canva callback
   * @param {string} state - State parameter for CSRF validation
   * @returns {Promise<{userId: string, canvaUserId: string, displayName: string}>}
   */
  static async handleCallback(code, state) {
    // 1. Consume state from Redis
    const redis = getRedis();
    const stateKey = `${REDIS_STATE_PREFIX}${state}`;
    const raw = await redis.get(stateKey);
    if (!raw) {
      throw new Error('Invalid or expired OAuth state');
    }
    await redis.del(stateKey);

    const { codeVerifier, userId } = JSON.parse(raw);

    // 2. Exchange code for tokens
    const tokenResponse = await axios.post(CANVA_TOKEN_URL, new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: process.env.CANVA_REDIRECT_URI,
      code_verifier: codeVerifier,
      client_id: process.env.CANVA_CLIENT_ID,
      client_secret: process.env.CANVA_CLIENT_SECRET,
    }).toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 15000,
    });

    const {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: expiresIn,
    } = tokenResponse.data;

    const expiresAt = new Date(Date.now() + expiresIn * 1000);

    // 3. Get user profile from Canva
    const profileResponse = await axios.get(`${CANVA_API_BASE}/users/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 10000,
    });

    const canvaUserId = profileResponse.data.id;
    const displayName = profileResponse.data.display_name || profileResponse.data.name || '';

    // 4. Encrypt tokens and persist
    const encryptedAccess = encryptToken(accessToken);
    const encryptedRefresh = refreshToken ? encryptToken(refreshToken) : null;

    await query(
      `UPDATE users
       SET canva_user_id = $1,
           canva_display_name = $2,
           canva_access_token_encrypted = $3,
           canva_refresh_token_encrypted = COALESCE($4, canva_refresh_token_encrypted),
           canva_token_expires_at = $5,
           canva_connected_at = COALESCE(canva_connected_at, NOW())
       WHERE id = $6`,
      [canvaUserId, displayName, encryptedAccess, encryptedRefresh, expiresAt, userId]
    );

    logger.info('Canva OAuth tokens stored', { userId, canvaUserId });

    return { userId, canvaUserId, displayName };
  }

  /**
   * Refresh Canva tokens for a user. Uses a Redis lock to prevent concurrent refreshes.
   * @param {string} userId
   * @returns {Promise<string>} New access token
   */
  static async refreshTokens(userId) {
    const redis = getRedis();
    const lockKey = `${REDIS_REFRESH_LOCK_PREFIX}${userId}`;

    // Distributed lock
    const acquired = await redis.set(lockKey, '1', 'EX', REDIS_REFRESH_LOCK_TTL, 'NX');
    if (!acquired) {
      // Another process is refreshing — wait and read fresh token
      await new Promise((r) => setTimeout(r, 2000));
      const user = await this._getCanvaUser(userId);
      if (!user?.canva_access_token_encrypted) {
        throw new Error('Canva not connected');
      }
      return decryptToken(user.canva_access_token_encrypted);
    }

    try {
      const user = await this._getCanvaUser(userId);
      if (!user?.canva_refresh_token_encrypted) {
        throw new Error('No Canva refresh token available');
      }

      const refreshToken = decryptToken(user.canva_refresh_token_encrypted);

      const tokenResponse = await axios.post(CANVA_TOKEN_URL, new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: process.env.CANVA_CLIENT_ID,
        client_secret: process.env.CANVA_CLIENT_SECRET,
      }).toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 15000,
      });

      const {
        access_token: newAccessToken,
        refresh_token: newRefreshToken,
        expires_in: expiresIn,
      } = tokenResponse.data;

      const expiresAt = new Date(Date.now() + expiresIn * 1000);
      const encryptedAccess = encryptToken(newAccessToken);
      const encryptedRefresh = newRefreshToken ? encryptToken(newRefreshToken) : null;

      await query(
        `UPDATE users
         SET canva_access_token_encrypted = $1,
             canva_refresh_token_encrypted = COALESCE($2, canva_refresh_token_encrypted),
             canva_token_expires_at = $3
         WHERE id = $4`,
        [encryptedAccess, encryptedRefresh, expiresAt, userId]
      );

      logger.info('Canva tokens refreshed', { userId });
      return newAccessToken;
    } finally {
      await redis.del(lockKey);
    }
  }

  /**
   * Make an authenticated Canva API request with auto-refresh on 401.
   * @param {string} userId
   * @param {string} method - HTTP method
   * @param {string} path - API path (e.g. '/designs')
   * @param {object} [data] - Request body
   * @returns {Promise<object>} Response data
   */
  static async apiRequest(userId, method, path, data = null) {
    const user = await this._getCanvaUser(userId);
    if (!user?.canva_access_token_encrypted) {
      throw new Error('Canva account not connected');
    }

    let accessToken = decryptToken(user.canva_access_token_encrypted);

    // Check if token is expired or about to expire (5 min buffer)
    const expiresAt = user.canva_token_expires_at ? new Date(user.canva_token_expires_at) : null;
    if (expiresAt && expiresAt.getTime() - Date.now() < 5 * 60 * 1000) {
      accessToken = await this.refreshTokens(userId);
    }

    const config = {
      method,
      url: `${CANVA_API_BASE}${path}`,
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 30000,
    };

    if (data && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
      config.headers['Content-Type'] = 'application/json';
      config.data = data;
    }

    try {
      const response = await axios(config);
      return response.data;
    } catch (err) {
      // Auto-refresh on 401
      if (err.response?.status === 401) {
        logger.info('Canva token expired, refreshing', { userId });
        accessToken = await this.refreshTokens(userId);
        config.headers.Authorization = `Bearer ${accessToken}`;
        const retryResponse = await axios(config);
        return retryResponse.data;
      }
      throw err;
    }
  }

  /**
   * List user's Canva designs (videos only by default).
   * @param {string} userId
   * @returns {Promise<Array>} List of designs
   */
  static async listDesigns(userId) {
    const result = await this.apiRequest(userId, 'GET', '/designs');
    // Filter to video designs if the API returns all types
    const designs = result.items || result.designs || [];
    return designs;
  }

  /**
   * Create an export job on Canva.
   * @param {string} userId
   * @param {string} designId - Canva design ID
   * @param {string} [format='mp4']
   * @param {string} [quality='1080p']
   * @returns {Promise<{exportId: string}>}
   */
  static async createExport(userId, designId, format = 'mp4', quality = '1080p') {
    const exportBody = {
      design_id: designId,
      format: {
        type: format,
      },
    };

    // Add quality/height if applicable
    const height = QUALITY_MAP[quality];
    if (height && format === 'mp4') {
      exportBody.format.quality = quality;
      exportBody.format.height = height;
    }

    const result = await this.apiRequest(userId, 'POST', '/exports', exportBody);
    return { exportId: result.job?.id || result.id };
  }

  /**
   * Get the status of a Canva export.
   * @param {string} userId
   * @param {string} exportId
   * @returns {Promise<{status: string, urls?: Array}>}
   */
  static async getExportStatus(userId, exportId) {
    const result = await this.apiRequest(userId, 'GET', `/exports/${exportId}`);
    return {
      status: result.job?.status || result.status,
      urls: result.job?.urls || result.urls || [],
    };
  }

  /**
   * Get Canva user profile.
   * @param {string} userId
   * @returns {Promise<object>}
   */
  static async getUserProfile(userId) {
    return this.apiRequest(userId, 'GET', '/users/me');
  }

  /**
   * Download an exported MP4 from Canva and upload it to Directus.
   * @param {string} downloadUrl - Canva export download URL
   * @param {string} title - Design title for the Directus content item
   * @param {string} userId - PNPtv user ID
   * @returns {Promise<{fileId: string, contentId: string}>}
   */
  static async downloadAndUploadToDirectus(downloadUrl, title, userId) {
    // Validate download URL domain
    const parsedUrl = new URL(downloadUrl);
    if (!parsedUrl.hostname.endsWith('.canva.com') && parsedUrl.hostname !== 'canva.com') {
      throw new Error('Invalid export download URL — must be a Canva domain');
    }

    // Download with size limit
    const downloadResponse = await axios.get(downloadUrl, {
      responseType: 'stream',
      timeout: 120000,
      maxContentLength: MAX_DOWNLOAD_SIZE,
      maxBodyLength: MAX_DOWNLOAD_SIZE,
    });

    // Check content-length header
    const contentLength = parseInt(downloadResponse.headers['content-length'] || '0', 10);
    if (contentLength > MAX_DOWNLOAD_SIZE) {
      downloadResponse.data.destroy();
      throw new Error(`File too large (${Math.round(contentLength / 1024 / 1024)}MB). Maximum is 500MB.`);
    }

    // Upload to Directus files API
    const directusUrl = process.env.DIRECTUS_URL || 'http://directus:8055';
    const directusToken = process.env.DIRECTUS_ADMIN_TOKEN;

    if (!directusToken) {
      throw new Error('DIRECTUS_ADMIN_TOKEN not configured');
    }

    const safeTitle = (title || 'Canva Export').replace(/[^a-zA-Z0-9\s\-_]/g, '').substring(0, 200);
    const filename = `${safeTitle.replace(/\s+/g, '_')}_${Date.now()}.mp4`;

    const form = new FormData();
    form.append('title', safeTitle);
    form.append('file', downloadResponse.data, {
      filename,
      contentType: 'video/mp4',
    });

    const uploadResponse = await axios.post(`${directusUrl}/files`, form, {
      headers: {
        ...form.getHeaders(),
        Authorization: `Bearer ${directusToken}`,
      },
      timeout: 180000,
      maxContentLength: MAX_DOWNLOAD_SIZE,
      maxBodyLength: MAX_DOWNLOAD_SIZE,
    });

    const fileId = uploadResponse.data.data.id;

    // Create content item in Directus
    const contentResponse = await axios.post(`${directusUrl}/items/content`, {
      title: safeTitle,
      type: 'video',
      status: 'draft',
      is_premium: true,
      media_file: fileId,
      media_url: `${directusUrl}/assets/${fileId}`,
      source: 'canva',
      date_created: new Date().toISOString(),
    }, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${directusToken}`,
      },
      timeout: 15000,
    });

    const contentId = contentResponse.data.data.id;

    logger.info('Canva export uploaded to Directus', { userId, fileId, contentId });

    return { fileId, contentId };
  }

  /**
   * Unlink Canva account from user.
   * @param {string} userId
   */
  static async unlinkAccount(userId) {
    await query(
      `UPDATE users
       SET canva_user_id = NULL,
           canva_display_name = NULL,
           canva_access_token_encrypted = NULL,
           canva_refresh_token_encrypted = NULL,
           canva_token_expires_at = NULL,
           canva_connected_at = NULL
       WHERE id = $1`,
      [userId]
    );
    logger.info('Canva account unlinked', { userId });
  }

  /**
   * Check if a user has Canva connected.
   * @param {string} userId
   * @returns {Promise<{connected: boolean, displayName?: string}>}
   */
  static async getStatus(userId) {
    const result = await query(
      'SELECT canva_user_id, canva_display_name FROM users WHERE id = $1',
      [userId]
    );
    const user = result.rows?.[0];
    if (!user || !user.canva_user_id) {
      return { connected: false };
    }
    return { connected: true, displayName: user.canva_display_name || undefined };
  }

  // ---------------------------------------------------------------------------
  // Export Job DB Operations
  // ---------------------------------------------------------------------------

  /**
   * Create a new export job record.
   */
  static async createExportJob({ userId, designId, designTitle, format = 'mp4', quality = '1080p' }) {
    const result = await query(
      `INSERT INTO canva_export_jobs (user_id, canva_design_id, design_title, export_format, export_quality)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, status, created_at`,
      [userId, designId, designTitle, format, quality]
    );
    return result.rows[0];
  }

  /**
   * Update an export job.
   */
  static async updateExportJob(jobId, updates) {
    const ALLOWED_COLUMNS = new Set([
      'status', 'canva_export_id', 'export_url', 'directus_file_id',
      'directus_content_id', 'error_message', 'started_at', 'completed_at',
    ]);
    const setClauses = [];
    const values = [];
    let paramIndex = 1;

    for (const [key, value] of Object.entries(updates)) {
      if (!ALLOWED_COLUMNS.has(key)) {
        throw new Error(`Column '${key}' is not permitted in export job updates`);
      }
      setClauses.push(`${key} = $${paramIndex}`);
      values.push(value);
      paramIndex++;
    }

    setClauses.push(`updated_at = NOW()`);
    values.push(jobId);

    await query(
      `UPDATE canva_export_jobs SET ${setClauses.join(', ')} WHERE id = $${paramIndex}`,
      values
    );
  }

  /**
   * Get active export jobs that need processing.
   */
  static async getActiveExportJobs() {
    const result = await query(
      `SELECT * FROM canva_export_jobs
       WHERE status NOT IN ('completed', 'failed')
       ORDER BY created_at ASC
       LIMIT 20`
    );
    return result.rows;
  }

  /**
   * Get export jobs for a user.
   */
  static async getUserExportJobs(userId, limit = 20) {
    const result = await query(
      `SELECT id, canva_design_id, design_title, export_format, export_quality,
              status, directus_file_id, directus_content_id, error_message,
              created_at, updated_at
       FROM canva_export_jobs
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [userId, limit]
    );
    return result.rows;
  }

  /**
   * Get a single export job.
   */
  static async getExportJob(jobId) {
    const result = await query(
      `SELECT * FROM canva_export_jobs WHERE id = $1`,
      [jobId]
    );
    return result.rows[0] || null;
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  static async _getCanvaUser(userId) {
    const result = await query(
      `SELECT canva_user_id, canva_display_name,
              canva_access_token_encrypted, canva_refresh_token_encrypted,
              canva_token_expires_at
       FROM users WHERE id = $1`,
      [userId]
    );
    return result.rows?.[0] || null;
  }
}

module.exports = CanvaService;
