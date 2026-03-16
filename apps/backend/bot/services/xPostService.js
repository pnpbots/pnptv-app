const axios = require('axios');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const FormData = require('form-data');
const db = require('../../utils/db');
const logger = require('../../utils/logger');
const PaymentSecurityService = require('./paymentSecurityService');

const X_API_BASE = 'https://api.twitter.com/2';
const X_MEDIA_UPLOAD_V2_BASE = 'https://api.x.com/2/media/upload';
const X_MEDIA_UPLOAD_V1_URL = 'https://upload.twitter.com/1.1/media/upload.json';
const X_MAX_TEXT_LENGTH = 280;
const X_TOKEN_EXPIRY_BUFFER_MS = 2 * 60 * 1000;
const X_MEDIA_CHUNK_SIZE = 1 * 1024 * 1024; // 1MB (v2 limit)

// Inline OAuth2 token refresh (formerly in xOAuthService)
async function refreshAccountTokens(account) {
  // NEVER refresh OAuth 1.0a tokens via OAuth 2.0 — they are permanent
  if (account.oauth_version === '1.0a') {
    throw new Error(`Cannot refresh OAuth 1.0a account @${account.handle} via OAuth 2.0 flow`);
  }

  let refreshData;
  try {
    refreshData = PaymentSecurityService.decryptSensitiveData(account.encrypted_refresh_token);
  } catch (error) {
    logger.warn('Failed to decrypt X refresh token', { accountId: account.account_id, error: error.message });
  }

  const refreshToken = refreshData?.refreshToken || account.encrypted_refresh_token;
  if (!refreshToken) throw new Error('Refresh token no disponible para X');

  const clientId = process.env.TWITTER_CLIENT_ID;
  const clientSecret = process.env.TWITTER_CLIENT_SECRET;
  if (!clientId) throw new Error('TWITTER_CLIENT_ID not configured');

  const payload = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
  });
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (clientSecret) {
    headers.Authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
  }

  const response = await axios.post('https://api.twitter.com/2/oauth2/token', payload.toString(), { headers, timeout: 15000 });
  const tokens = response.data;

  const tokenExpiresAt = tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : null;

  const encryptedAccess = PaymentSecurityService.encryptSensitiveData({
    accessToken: tokens.access_token,
    tokenType: tokens.token_type,
    scope: tokens.scope,
    expiresAt: tokenExpiresAt?.toISOString() || null,
  });
  if (!encryptedAccess) throw new Error('No se pudo cifrar el access token actualizado de X');

  const encryptedRefresh = tokens.refresh_token
    ? PaymentSecurityService.encryptSensitiveData({ refreshToken: tokens.refresh_token })
    : account.encrypted_refresh_token;
  if (tokens.refresh_token && !encryptedRefresh) throw new Error('No se pudo cifrar el refresh token actualizado de X');

  await db.query(
    `UPDATE x_accounts SET encrypted_access_token = $1, encrypted_refresh_token = $2, token_expires_at = $3, updated_at = CURRENT_TIMESTAMP WHERE account_id = $4`,
    [encryptedAccess, encryptedRefresh, tokenExpiresAt, account.account_id]
  );

  return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token || refreshToken };
}

// ---------------------------------------------------------------------------
// SSRF Protection — URL validation for outbound media downloads
// ---------------------------------------------------------------------------

const net = require('net');

/**
 * Validates a URL against SSRF attack vectors.
 * Throws an error if the URL is not safe to fetch.
 *
 * Rules:
 *   1. Only https:// scheme allowed.
 *   2. Hostname must not be `localhost` or any loopback variant.
 *   3. Hostname must not resolve to a private/link-local IP range:
 *        127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12,
 *        192.168.0.0/16, 169.254.0.0/16 (link-local), ::1 (IPv6 loopback).
 */
function validateUrlForSsrf(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('URL inválida para descarga de media');
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('Solo se permiten URLs HTTPS para descarga de media');
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, ''); // strip IPv6 brackets

  // Block localhost by name
  if (hostname === 'localhost' || hostname === 'ip6-localhost' || hostname === 'ip6-loopback') {
    throw new Error('URL de media apunta a un destino privado no permitido');
  }

  // If hostname is a literal IP address, validate it against private ranges
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) {
      throw new Error('URL de media apunta a un destino privado no permitido');
    }
  }
  // Note: DNS-based SSRF (hostname that resolves to private IP) is not preventable
  // purely at parse time without a DNS pre-resolution step. The Axios timeout and
  // the explicit block of literal IPs + localhost covers the primary vectors for
  // this application's threat model. A full solution would require a custom
  // Axios adapter with DNS pre-resolution — out of scope for this patch.
}

/**
 * Returns true if the given IP address (v4 or v6) falls within a private,
 * loopback, or link-local range.
 */
function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    const [a, b, c] = parts; // eslint-disable-line no-unused-vars

    // 127.0.0.0/8 — loopback
    if (a === 127) return true;
    // 10.0.0.0/8 — private
    if (a === 10) return true;
    // 172.16.0.0/12 — private (172.16.x.x – 172.31.x.x)
    if (a === 172 && b >= 16 && b <= 31) return true;
    // 192.168.0.0/16 — private
    if (a === 192 && b === 168) return true;
    // 169.254.0.0/16 — link-local (APIPA / cloud metadata)
    if (a === 169 && b === 254) return true;
    // 0.0.0.0/8 — "this" network
    if (a === 0) return true;
    return false;
  }

  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    // ::1 — loopback
    if (lower === '::1' || lower === '0:0:0:0:0:0:0:1') return true;
    // fc00::/7 — unique local (fd...)
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
    // fe80::/10 — link-local
    if (lower.startsWith('fe80') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true;
    return false;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Detect MIME type from file magic bytes
function detectMimeType(filePath) {
  const fd = fs.openSync(filePath, 'r');
  const buf = Buffer.alloc(12);
  fs.readSync(fd, buf, 0, 12, 0);
  fs.closeSync(fd);

  // JPEG: FF D8 FF
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'image/jpeg';
  // PNG: 89 50 4E 47
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return 'image/png';
  // GIF: 47 49 46
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'image/gif';
  // BMP: 42 4D
  if (buf[0] === 0x42 && buf[1] === 0x4D) return 'image/bmp';
  // WebP: 52 49 46 46 ... 57 45 42 50
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
      buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return 'image/webp';
  // MP4: ... 66 74 79 70 (ftyp at offset 4)
  if (buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) return 'video/mp4';
  // WebM: 1A 45 DF A3
  if (buf[0] === 0x1A && buf[1] === 0x45 && buf[2] === 0xDF && buf[3] === 0xA3) return 'video/webm';

  return null;
}

class XPostService {
  static normalizeXText(text) {
    const trimmed = (text || '').trim();
    if (trimmed.length <= X_MAX_TEXT_LENGTH) {
      return { text: trimmed, truncated: false };
    }

    const truncatedText = trimmed.slice(0, X_MAX_TEXT_LENGTH - 1).trimEnd();
    return { text: `${truncatedText}…`, truncated: true };
  }

  static ensureRequiredLinks(text, links = [], maxLength = X_MAX_TEXT_LENGTH) {
    const trimmed = (text || '').trim();
    const required = links.filter(Boolean);
    const missing = required.filter((link) => {
      const escaped = link.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return !new RegExp(escaped, 'i').test(trimmed);
    });

    if (missing.length === 0) {
      return this.normalizeXText(trimmed);
    }

    const linksText = missing.join(' ');
    const appendLength = (trimmed ? 1 : 0) + linksText.length; // newline + links
    let base = trimmed;
    let truncated = false;

    if (base.length + appendLength > maxLength) {
      const allowed = maxLength - appendLength;
      if (allowed <= 0) {
        base = '';
      } else {
        base = base.slice(0, allowed).trimEnd();
      }
      truncated = trimmed.length !== base.length;
    }

    const combined = base ? `${base}\n${linksText}` : linksText;
    return { text: combined, truncated };
  }

  static async listActiveAccounts() {
    const query = `
      SELECT account_id, handle, display_name, is_active
      FROM x_accounts
      WHERE is_active = TRUE
      ORDER BY display_name NULLS LAST, handle ASC
    `;
    const result = await db.query(query, [], { cache: false });
    return result.rows;
  }

  static async getAccount(accountId) {
    const query = `
      SELECT account_id, handle, display_name, encrypted_access_token, encrypted_refresh_token,
             token_expires_at, is_active, oauth_version, encrypted_access_token_secret, consumer_key_ref
      FROM x_accounts
      WHERE account_id = $1
    `;
    const result = await db.query(query, [accountId], { cache: false });
    return result.rows[0] || null;
  }

  static async deactivateAccount(accountId) {
    const query = `
      UPDATE x_accounts
      SET is_active = FALSE,
          updated_at = CURRENT_TIMESTAMP
      WHERE account_id = $1
      RETURNING account_id, handle
    `;
    const result = await db.query(query, [accountId], { cache: false });
    if (!result.rows[0]) {
      throw new Error('Cuenta de X no encontrada');
    }
    return result.rows[0];
  }

  static async createPostJob({
    accountId,
    adminId,
    adminUsername,
    text,
    mediaUrl = null,
    scheduledAt = null,
    status = 'scheduled',
    responseJson = null,
    errorMessage = null,
    sentAt = null,
  }) {
    const query = `
      INSERT INTO x_post_jobs (
        account_id, admin_id, admin_username, text, media_url, scheduled_at,
        status, response_json, error_message, sent_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING post_id
    `;

    const values = [
      accountId,
      adminId,
      adminUsername,
      text,
      mediaUrl,
      scheduledAt,
      status,
      responseJson ? JSON.stringify(responseJson) : null,
      errorMessage,
      sentAt,
    ];

    const result = await db.query(query, values);
    return result.rows[0]?.post_id;
  }

  static async updatePostJob(postId, { status, responseJson, errorMessage, sentAt }) {
    const query = `
      UPDATE x_post_jobs
      SET status = $1,
          response_json = $2,
          error_message = $3,
          sent_at = $4,
          updated_at = CURRENT_TIMESTAMP
      WHERE post_id = $5
    `;
    await db.query(query, [
      status,
      responseJson ? JSON.stringify(responseJson) : null,
      errorMessage || null,
      sentAt || null,
      postId,
    ]);
  }

  static async sendPostNow({ accountId, adminId, adminUsername, text, mediaUrl = null }) {
    const account = await this.getAccount(accountId);
    if (!account || !account.is_active) {
      throw new Error('Cuenta de X inválida o inactiva');
    }

    const { text: normalizedText, truncated } = this.normalizeXText(text);

    const postId = await this.createPostJob({
      accountId,
      adminId,
      adminUsername,
      text: normalizedText,
      mediaUrl,
      status: 'sending',
    });

    try {
      const response = await this.postToX(account, normalizedText, mediaUrl);

      await this.updatePostJob(postId, {
        status: 'sent',
        responseJson: response,
        sentAt: new Date(),
      });

      return {
        postId,
        response,
        truncated,
      };
    } catch (error) {
      // On 429 rate limit, auto-schedule for later instead of failing
      if (error.response?.status === 429) {
        const retryAfter = parseInt(error.response?.headers?.['retry-after'] || '0', 10);
        const delayMinutes = retryAfter > 0 ? Math.ceil(retryAfter / 60) : 15;
        const scheduledAt = new Date(Date.now() + delayMinutes * 60 * 1000);

        await this.updatePostJob(postId, {
          status: 'scheduled',
          errorMessage: null,
        });
        await db.query(
          `UPDATE x_post_jobs SET scheduled_at = $1, updated_at = CURRENT_TIMESTAMP WHERE post_id = $2`,
          [scheduledAt, postId]
        );

        logger.warn('X API rate limited on send now, auto-scheduled', {
          postId,
          delayMinutes,
          scheduledAt: scheduledAt.toISOString(),
        });

        const rateLimitError = new Error(`Rate limited por X. Post programado automáticamente para ${delayMinutes} minutos.`);
        rateLimitError.rescheduled = true;
        rateLimitError.scheduledAt = scheduledAt;
        rateLimitError.delayMinutes = delayMinutes;
        throw rateLimitError;
      }

      const errorMessage = error.response?.data || error.message || 'Error desconocido';

      await this.updatePostJob(postId, {
        status: 'failed',
        errorMessage: typeof errorMessage === 'string' ? errorMessage : JSON.stringify(errorMessage),
      });

      throw error;
    }
  }

  static async publishScheduledPost(post) {
    const account = await this.getAccount(post.account_id);
    if (!account || !account.is_active) {
      throw new Error('Cuenta de X inválida o inactiva');
    }

    const { text: normalizedText } = this.normalizeXText(post.text);
    const response = await this.postToX(account, normalizedText, post.media_url);

    await this.updatePostJob(post.post_id, {
      status: 'sent',
      responseJson: response,
      sentAt: new Date(),
    });

    return response;
  }

  static async postToX(account, text, mediaUrl = null) {
    // Route OAuth 1.0a accounts through dedicated signing path
    if (account.oauth_version === '1.0a') {
      return this.postToXWithOAuth1(account, text, mediaUrl);
    }

    const accessToken = await this.getValidAccessToken(account);

    if (!accessToken) {
      throw new Error('Token de acceso inválido para la cuenta de X');
    }

    const payload = { text };
    if (mediaUrl) {
      logger.info('Uploading media for X post', {
        accountId: account.account_id,
        handle: account.handle,
      });
      let mediaId = null;
      try {
        mediaId = await this.uploadMediaToX({
          accessToken,
          mediaUrl,
        });
      } catch (error) {
        if (error?.response?.status === 403) {
          throw new Error('X API 403 al subir media. Reconecta la cuenta desde ⚙️ Gestionar Cuentas para obtener el scope media.write.');
        }
        // Fallback: post without media if processing times out or fails
        if (error.message && error.message.includes('Media processing failed')) {
          logger.warn('Media processing failed, posting without media', {
            accountId: account.account_id,
            handle: account.handle,
            error: error.message,
          });
          mediaId = null;
        } else {
          throw error;
        }
      }
      if (mediaId) {
        // Alt text improves SEO + accessibility — use first 1000 chars of tweet text
        const altText = (text || 'PNPtv! community content').slice(0, 1000);
        payload.media = { media_ids: [String(mediaId)] };
        // Set alt text via metadata endpoint (fire-and-forget — non-critical)
        try {
          await axios.post(
            'https://upload.twitter.com/1.1/media/metadata/create.json',
            { media_id: String(mediaId), alt_text: { text: altText } },
            { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, timeout: 5000 }
          );
        } catch (altErr) {
          logger.warn('Failed to set media alt_text', { mediaId, error: altErr.message });
        }
      }
    }

    let response;
    try {
      response = await axios.post(
        `${X_API_BASE}/tweets`,
        payload,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          timeout: 15000,
        }
      );
    } catch (error) {
      if (error?.response?.status === 403) {
        throw new Error(`403 Forbidden al publicar tweet con @${account.handle}. Reconecta la cuenta desde ⚙️ Gestionar Cuentas para renovar los permisos.`);
      }
      throw error;
    }

    logger.info('X post published', {
      accountId: account.account_id,
      handle: account.handle,
      tweetId: response.data?.data?.id,
    });

    return response.data;
  }

  /**
   * Post to X using OAuth 1.0a HMAC-SHA1 signed requests (permanent tokens, no expiry).
   */
  static async postToXWithOAuth1(account, text, mediaUrl = null) {
    const XOAuth1Service = require('./xOAuth1Service');

    // Look up the consumer key/secret for this account's X app.
    // consumer_key_ref ('santino'|'lex'|'generic') maps to env var prefix.
    const ref = (account.consumer_key_ref || 'generic').toUpperCase();
    const consumerKey = process.env[`${ref}_CONSUMER_KEY`] || process.env.TWITTER_CONSUMER_KEY;
    const consumerSecret = process.env[`${ref}_CONSUMER_SECRET`] || process.env.TWITTER_CONSUMER_SECRET;

    if (!consumerKey || !consumerSecret) {
      throw new Error(`OAuth 1.0a consumer key/secret not configured for ref="${ref}". Set ${ref}_CONSUMER_KEY and ${ref}_CONSUMER_SECRET.`);
    }

    // Decrypt permanent access token
    let decryptedToken;
    try {
      decryptedToken = PaymentSecurityService.decryptSensitiveData(account.encrypted_access_token);
    } catch (err) {
      throw new Error(`OAuth 1.0a: failed to decrypt access token for @${account.handle}: ${err.message}`);
    }
    const accessToken = decryptedToken?.accessToken || decryptedToken?.token;
    if (!accessToken) throw new Error(`OAuth 1.0a: no access token found for @${account.handle}`);

    // Decrypt permanent token secret
    let decryptedSecret;
    try {
      decryptedSecret = PaymentSecurityService.decryptSensitiveData(account.encrypted_access_token_secret);
    } catch (err) {
      throw new Error(`OAuth 1.0a: failed to decrypt token secret for @${account.handle}: ${err.message}`);
    }
    const tokenSecret = decryptedSecret?.accessToken || decryptedSecret?.token;
    if (!tokenSecret) throw new Error(`OAuth 1.0a: no token secret found for @${account.handle}`);

    const credentials = { consumerKey, consumerSecret, accessToken, tokenSecret };

    // Upload media via v1.1 (native OAuth1 endpoint) if needed
    const payload = { text };
    if (mediaUrl) {
      logger.info('Uploading media for X post (OAuth1)', { accountId: account.account_id, handle: account.handle });
      try {
        const mediaId = await this.uploadMediaToXV1WithOAuth1({ credentials, mediaUrl });
        if (mediaId) {
          payload.media = { media_ids: [String(mediaId)] };
          // Set alt text for SEO + accessibility (fire-and-forget)
          try {
            const altText = (text || 'PNPtv! community content').slice(0, 1000);
            const metaUrl = 'https://upload.twitter.com/1.1/media/metadata/create.json';
            const metaBody = JSON.stringify({ media_id: String(mediaId), alt_text: { text: altText } });
            const metaAuth = XOAuth1Service.buildAuthHeader('POST', metaUrl, {}, credentials);
            await axios.post(metaUrl, metaBody, {
              headers: { Authorization: metaAuth, 'Content-Type': 'application/json' },
              timeout: 5000,
            });
          } catch (altErr) {
            logger.warn('OAuth1: Failed to set media alt_text', { error: altErr.message });
          }
        }
      } catch (err) {
        logger.warn('OAuth1 media upload failed, posting without media', { error: err.message });
      }
    }

    // POST tweet via v2 API with OAuth1 header
    const tweetUrl = `${X_API_BASE}/tweets`;
    const authHeader = XOAuth1Service.buildAuthHeader('POST', tweetUrl, {}, credentials);

    let response;
    try {
      response = await axios.post(tweetUrl, payload, {
        headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
        timeout: 15000,
      });
    } catch (error) {
      logger.error('OAuth1 tweet post failed', {
        handle: account.handle,
        status: error?.response?.status,
        responseData: error?.response?.data,
        consumerKeyRef: ref,
        consumerKeyPrefix: consumerKey?.substring(0, 6),
      });
      if (error?.response?.status === 403) {
        throw new Error(`403 Forbidden al publicar tweet OAuth1 con @${account.handle}. Verifica los permisos de la app.`);
      }
      throw error;
    }

    logger.info('X post published (OAuth1)', {
      accountId: account.account_id,
      handle: account.handle,
      tweetId: response.data?.data?.id,
    });
    return response.data;
  }

  /**
   * Upload media using OAuth 1.0a signed requests (v1.1 upload endpoint).
   * Uses chunked (INIT/APPEND/FINALIZE) for files > 5MB or videos, simple upload otherwise.
   */
  static async uploadMediaToXV1WithOAuth1({ credentials, mediaUrl }) {
    const XOAuth1Service = require('./xOAuth1Service');
    const { filePath, mimeType, size } = await this.downloadMediaToFile(mediaUrl);

    try {
      this.validateMediaSize(mimeType, size);

      const uploadUrl = X_MEDIA_UPLOAD_V1_URL;
      const isVideo = mimeType?.startsWith('video/');
      const SIMPLE_LIMIT = 5 * 1024 * 1024; // 5MB

      // Use chunked upload for videos or large files
      if (isVideo || size > SIMPLE_LIMIT) {
        return await this._chunkedUploadOAuth1({ credentials, filePath, mimeType, size });
      }

      // Simple upload for small images
      const form = new FormData();
      form.append('media', fs.createReadStream(filePath), {
        filename: path.basename(filePath),
        contentType: mimeType,
      });

      const authHeader = XOAuth1Service.buildAuthHeader('POST', uploadUrl, {}, credentials);
      const uploadRes = await axios.post(uploadUrl, form, {
        headers: { ...form.getHeaders(), Authorization: authHeader },
        timeout: 60000,
      });

      const mediaId = uploadRes.data?.media_id_string || String(uploadRes.data?.media_id || '');
      if (!mediaId) throw new Error('No media_id returned from v1.1 upload');
      logger.info('OAuth1 media uploaded (simple)', { mediaId });
      return mediaId;
    } finally {
      try { await fs.promises.unlink(filePath); } catch (_) {} // eslint-disable-line no-empty
    }
  }

  /**
   * Chunked upload (INIT/APPEND/FINALIZE) with OAuth 1.0a for large files and videos.
   */
  static async _chunkedUploadOAuth1({ credentials, filePath, mimeType, size }) {
    const XOAuth1Service = require('./xOAuth1Service');
    const uploadUrl = X_MEDIA_UPLOAD_V1_URL;
    const mediaCategory = this.getMediaCategory(mimeType);
    const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB chunks for v1.1

    logger.info('OAuth1 chunked media upload INIT', { mimeType, size, mediaCategory });

    // INIT
    const initParams = {
      command: 'INIT',
      total_bytes: String(size),
      media_type: mimeType,
      media_category: mediaCategory,
    };
    const initAuth = XOAuth1Service.buildAuthHeader('POST', uploadUrl, initParams, credentials);
    const initRes = await axios.post(uploadUrl, new URLSearchParams(initParams), {
      headers: { Authorization: initAuth, 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 30000,
    });

    const mediaId = initRes.data?.media_id_string || String(initRes.data?.media_id || '');
    if (!mediaId) throw new Error('No media_id from OAuth1 chunked INIT');
    logger.info('OAuth1 chunked INIT ok', { mediaId });

    // APPEND chunks
    const fileHandle = await fs.promises.open(filePath, 'r');
    try {
      const buffer = Buffer.alloc(CHUNK_SIZE);
      let offset = 0;
      let segment = 0;

      while (true) {
        const { bytesRead } = await fileHandle.read(buffer, 0, CHUNK_SIZE, offset);
        if (!bytesRead) break;

        const chunk = buffer.subarray(0, bytesRead);
        const appendForm = new FormData();
        appendForm.append('command', 'APPEND');
        appendForm.append('media_id', mediaId);
        appendForm.append('segment_index', String(segment));
        appendForm.append('media_data', chunk.toString('base64'));

        const appendAuth = XOAuth1Service.buildAuthHeader('POST', uploadUrl, {}, credentials);
        await axios.post(uploadUrl, appendForm, {
          headers: { ...appendForm.getHeaders(), Authorization: appendAuth },
          timeout: 60000,
          maxBodyLength: Infinity,
        });

        offset += bytesRead;
        segment++;
      }
    } finally {
      await fileHandle.close();
    }

    logger.info('OAuth1 chunked APPEND complete', { mediaId, segments: Math.ceil(size / CHUNK_SIZE) });

    // FINALIZE
    const finalizeParams = { command: 'FINALIZE', media_id: mediaId };
    const finalizeAuth = XOAuth1Service.buildAuthHeader('POST', uploadUrl, finalizeParams, credentials);
    const finalizeRes = await axios.post(uploadUrl, new URLSearchParams(finalizeParams), {
      headers: { Authorization: finalizeAuth, 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 30000,
      maxBodyLength: Infinity,
    });

    // Wait for processing if needed (videos)
    const processingInfo = finalizeRes.data?.processing_info;
    if (processingInfo) {
      await this._waitForProcessingOAuth1(credentials, mediaId, processingInfo);
    }

    logger.info('OAuth1 chunked media upload complete', { mediaId });
    return mediaId;
  }

  /**
   * Poll processing status for OAuth 1.0a chunked uploads (videos).
   */
  static async _waitForProcessingOAuth1(credentials, mediaId, processingInfo) {
    const XOAuth1Service = require('./xOAuth1Service');
    let state = processingInfo?.state;
    let checkAfterSecs = processingInfo?.check_after_secs || 5;

    while (state === 'pending' || state === 'in_progress') {
      await new Promise((r) => setTimeout(r, checkAfterSecs * 1000));

      const statusParams = { command: 'STATUS', media_id: mediaId };
      const statusAuth = XOAuth1Service.buildAuthHeader('GET', X_MEDIA_UPLOAD_V1_URL, statusParams, credentials);
      const statusRes = await axios.get(X_MEDIA_UPLOAD_V1_URL, {
        params: statusParams,
        headers: { Authorization: statusAuth },
        timeout: 15000,
      });

      const info = statusRes.data?.processing_info;
      if (!info) break;
      state = info.state;
      checkAfterSecs = info.check_after_secs || 5;

      if (state === 'failed') {
        throw new Error(`OAuth1 media processing failed: ${JSON.stringify(info.error || {})}`);
      }
    }
  }

  static async resolveMediaUrl(mediaUrlOrFileId) {
    if (!mediaUrlOrFileId) return null;
    if (typeof mediaUrlOrFileId !== 'string') return null;
    if (mediaUrlOrFileId.startsWith('http://') || mediaUrlOrFileId.startsWith('https://')) {
      return mediaUrlOrFileId;
    }

    const botToken = process.env.BOT_TOKEN;
    if (!botToken) {
      throw new Error('BOT_TOKEN no configurado para resolver media de Telegram');
    }

    let res;
    try {
      res = await axios.get(`https://api.telegram.org/bot${botToken}/getFile`, {
        params: { file_id: mediaUrlOrFileId },
        timeout: 15000,
      });
    } catch (error) {
      const tgError = error.response?.data?.description || error.message;
      if (tgError && tgError.toLowerCase().includes('file is too big')) {
        throw new Error('El archivo es demasiado grande para descargar desde Telegram (máx 20MB para bots). Envía un archivo más pequeño.');
      }
      throw new Error(`Error al obtener archivo de Telegram: ${tgError}`);
    }

    const filePath = res.data?.result?.file_path;
    if (!filePath) {
      throw new Error('No se pudo obtener file_path desde Telegram');
    }

    return `https://api.telegram.org/file/bot${botToken}/${filePath}`;
  }

  static async downloadMediaToFile(mediaUrl) {
    const resolvedUrl = await this.resolveMediaUrl(mediaUrl);
    if (!resolvedUrl) {
      throw new Error('Media URL inválida');
    }

    // SSRF guard — reject private/local destinations and non-HTTPS schemes
    validateUrlForSsrf(resolvedUrl);

    const tempName = `xmedia_${Date.now()}_${crypto.randomUUID()}`;
    const tempPath = path.join(os.tmpdir(), tempName);

    const response = await axios.get(resolvedUrl, {
      responseType: 'stream',
      timeout: 60000,
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });

    const rawContentType = response.headers['content-type'] || '';
    const headerType = rawContentType.split(';')[0].trim();
    const totalBytes = Number(response.headers['content-length'] || 0);

    await new Promise((resolve, reject) => {
      const writer = fs.createWriteStream(tempPath);
      response.data.pipe(writer);
      writer.on('finish', resolve);
      writer.on('error', reject);
    });

    const stats = await fs.promises.stat(tempPath);

    let mimeType = headerType && headerType !== 'application/octet-stream' ? headerType : null;
    if (!mimeType) {
      const detected = detectMimeType(tempPath);
      if (detected) {
        mimeType = detected;
      }
    }

    if (!mimeType) {
      throw new Error('No se pudo detectar el tipo MIME del archivo (solo imágenes y videos son válidos)');
    }

    return {
      filePath: tempPath,
      mimeType,
      size: totalBytes || stats.size,
    };
  }

  static getMediaCategory(mimeType) {
    if (!mimeType) return 'tweet_image';
    if (mimeType.startsWith('video/')) return 'tweet_video';
    if (mimeType === 'image/gif') return 'tweet_gif';
    return 'tweet_image';
  }

  static validateMediaSize(mimeType, size) {
    const sizeMB = size / (1024 * 1024);
    if (mimeType === 'image/gif' && size > 15 * 1024 * 1024) {
      throw new Error(`GIF demasiado grande (${sizeMB.toFixed(1)}MB). X permite máx 15MB para GIFs.`);
    }
    if (mimeType?.startsWith('image/') && size > 5 * 1024 * 1024) {
      throw new Error(`Imagen demasiado grande (${sizeMB.toFixed(1)}MB). X permite máx 5MB para imágenes.`);
    }
    if (mimeType?.startsWith('video/') && size > 512 * 1024 * 1024) {
      throw new Error(`Video demasiado grande (${sizeMB.toFixed(1)}MB). X permite máx 512MB para videos.`);
    }
  }

  static async uploadMediaToX({ accessToken, mediaUrl }) {
    const { filePath, mimeType, size } = await this.downloadMediaToFile(mediaUrl);

    try {
      this.validateMediaSize(mimeType, size);
      try {
        return await this.uploadMediaToXV2({ accessToken, filePath, mimeType, size });
      } catch (v2Error) {
        const v2Status = v2Error.response?.status;
        if (v2Status === 401 || v2Status === 403) {
          logger.warn('X v2 media upload failed with auth error — falling back to v1.1', {
            status: v2Status,
            data: v2Error.response?.data,
          });
          return await this.uploadMediaToXV1({ accessToken, filePath, mimeType, size });
        }
        logger.error('X media upload failed (v2)', {
          status: v2Status,
          data: v2Error.response?.data,
          message: v2Error.message,
        });
        throw v2Error;
      }
    } finally {
      try {
        await fs.promises.unlink(filePath);
      } catch (error) {
        logger.warn('Failed to delete temp media file', { filePath, error: error.message });
      }
    }
  }

  static async uploadMediaToXV2({ accessToken, filePath, mimeType, size }) {
    const authHeader = `Bearer ${accessToken}`;
    const mediaCategory = this.getMediaCategory(mimeType);
    logger.info('X media upload INIT (v2)', { mimeType, size, mediaCategory });

    // INIT (v2)
    const initRes = await axios.post(
      `${X_MEDIA_UPLOAD_V2_BASE}/initialize`,
      {
        media_type: mimeType,
        total_bytes: size,
        media_category: mediaCategory,
      },
      {
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
        maxBodyLength: Infinity,
      }
    );

    // v2 returns 'id' in data, v1.1 returned 'media_id_string'
    const mediaId = initRes.data?.data?.id || initRes.data?.id || initRes.data?.media_id_string || initRes.data?.media_id;
    if (!mediaId) {
      logger.error('X media upload INIT failed - no media_id', { responseData: initRes.data });
      throw new Error('No se recibió media_id al inicializar upload');
    }
    logger.info('X media upload INIT ok', { mediaId });

    const appendUrl = `${X_MEDIA_UPLOAD_V2_BASE}/${mediaId}/append`;

    // APPEND chunks
    const fileHandle = await fs.promises.open(filePath, 'r');
    try {
      const buffer = Buffer.alloc(X_MEDIA_CHUNK_SIZE);
      let offset = 0;
      let segmentIndex = 0;

      while (true) {
        const { bytesRead } = await fileHandle.read(buffer, 0, X_MEDIA_CHUNK_SIZE, offset);
        if (!bytesRead) break;

        const chunk = buffer.subarray(0, bytesRead);
        const appendForm = new FormData();
        appendForm.append('segment_index', String(segmentIndex));
        appendForm.append('media', chunk, {
          filename: `chunk_${segmentIndex}`,
          contentType: mimeType,
        });

        await axios.post(
          appendUrl,
          appendForm,
          {
            headers: {
              Authorization: authHeader,
              ...appendForm.getHeaders(),
            },
            timeout: 60000,
            maxBodyLength: Infinity,
          }
        );

        offset += bytesRead;
        segmentIndex += 1;
      }
    } finally {
      await fileHandle.close();
    }

    // FINALIZE (v2)
    const finalizeRes = await axios.post(
      `${X_MEDIA_UPLOAD_V2_BASE}/${mediaId}/finalize`,
      {},
      {
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
        maxBodyLength: Infinity,
      }
    );

    const processingInfo = finalizeRes.data?.data?.processing_info || finalizeRes.data?.processing_info;
    logger.info('X media upload FINALIZE ok', { mediaId, hasProcessing: !!processingInfo });
    if (processingInfo) {
      await this.waitForMediaProcessingV2(accessToken, mediaId, processingInfo);
    }

    logger.info('X media upload completed successfully (v2)', { mediaId });
    return mediaId;
  }

  static async uploadMediaToXV1({ accessToken, filePath, mimeType, size }) {
    const authHeader = `Bearer ${accessToken}`;
    const mediaCategory = this.getMediaCategory(mimeType);
    logger.info('X media upload INIT (v1.1)', { mimeType, size, mediaCategory });

    const initParams = new URLSearchParams({
      command: 'INIT',
      total_bytes: String(size),
      media_type: mimeType,
      media_category: mediaCategory,
    });

    const initRes = await axios.post(
      X_MEDIA_UPLOAD_V1_URL,
      initParams,
      {
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        timeout: 30000,
        maxBodyLength: Infinity,
      }
    );

    const mediaId = initRes.data?.media_id_string || initRes.data?.media_id;
    if (!mediaId) {
      logger.error('X media upload INIT failed - no media_id (v1.1)', { responseData: initRes.data });
      throw new Error('No se recibió media_id al inicializar upload');
    }
    logger.info('X media upload INIT ok (v1.1)', { mediaId });

    // APPEND chunks
    const fileHandle = await fs.promises.open(filePath, 'r');
    try {
      const buffer = Buffer.alloc(X_MEDIA_CHUNK_SIZE);
      let offset = 0;
      let segmentIndex = 0;

      while (true) {
        const { bytesRead } = await fileHandle.read(buffer, 0, X_MEDIA_CHUNK_SIZE, offset);
        if (!bytesRead) break;

        const chunk = buffer.subarray(0, bytesRead);
        const appendForm = new FormData();
        appendForm.append('command', 'APPEND');
        appendForm.append('media_id', mediaId);
        appendForm.append('segment_index', String(segmentIndex));
        appendForm.append('media', chunk, {
          filename: `chunk_${segmentIndex}`,
          contentType: mimeType,
        });

        await axios.post(
          X_MEDIA_UPLOAD_V1_URL,
          appendForm,
          {
            headers: {
              Authorization: authHeader,
              ...appendForm.getHeaders(),
            },
            timeout: 60000,
            maxBodyLength: Infinity,
          }
        );

        offset += bytesRead;
        segmentIndex += 1;
      }
    } finally {
      await fileHandle.close();
    }

    // FINALIZE (v1.1)
    const finalizeParams = new URLSearchParams({
      command: 'FINALIZE',
      media_id: mediaId,
    });

    const finalizeRes = await axios.post(
      X_MEDIA_UPLOAD_V1_URL,
      finalizeParams,
      {
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        timeout: 30000,
        maxBodyLength: Infinity,
      }
    );

    const processingInfo = finalizeRes.data?.processing_info;
    logger.info('X media upload FINALIZE ok (v1.1)', { mediaId, hasProcessing: !!processingInfo });
    if (processingInfo) {
      await this.waitForMediaProcessingV1(accessToken, mediaId, processingInfo);
    }

    logger.info('X media upload completed successfully (v1.1)', { mediaId });
    return mediaId;
  }

  static async waitForMediaProcessingV2(accessToken, mediaId, processingInfo) {
    let state = processingInfo?.state;
    let checkAfter = processingInfo?.check_after_secs || 5;
    let attempts = 0;

    logger.info('Waiting for X media processing', { mediaId, initialState: state, checkAfter });

    while (state && state !== 'succeeded' && state !== 'failed' && attempts < 20) {
      await new Promise((resolve) => setTimeout(resolve, checkAfter * 1000));
      const statusRes = await axios.get(
        X_MEDIA_UPLOAD_V2_BASE,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          params: { command: 'STATUS', media_id: mediaId },
          timeout: 15000,
        }
      );

      const info = statusRes.data?.data?.processing_info || statusRes.data?.processing_info;
      state = info?.state || state;
      checkAfter = Math.min(info?.check_after_secs || checkAfter, 10); // cap at 10s per poll
      attempts += 1;

      logger.info('X media processing status check', { mediaId, state, attempts });
    }

    if (state && state !== 'succeeded') {
      throw new Error(`Media processing failed: ${state}`);
    }

    logger.info('X media processing completed', { mediaId, finalState: state });
  }

  static async waitForMediaProcessingV1(accessToken, mediaId, processingInfo) {
    let state = processingInfo?.state;
    let checkAfter = processingInfo?.check_after_secs || 5;
    let attempts = 0;

    logger.info('Waiting for X media processing (v1.1)', { mediaId, initialState: state, checkAfter });

    while (state && state !== 'succeeded' && state !== 'failed' && attempts < 20) {
      await new Promise((resolve) => setTimeout(resolve, checkAfter * 1000));
      const statusRes = await axios.get(
        X_MEDIA_UPLOAD_V1_URL,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          params: { command: 'STATUS', media_id: mediaId },
          timeout: 15000,
        }
      );

      const info = statusRes.data?.processing_info;
      state = info?.state || state;
      checkAfter = Math.min(info?.check_after_secs || checkAfter, 10); // cap at 10s per poll
      attempts += 1;

      logger.info('X media processing status check (v1.1)', { mediaId, state, attempts });
    }

    if (state && state !== 'succeeded') {
      throw new Error(`Media processing failed: ${state}`);
    }

    logger.info('X media processing completed (v1.1)', { mediaId, finalState: state });
  }

  static async getValidAccessToken(account) {
    // OAuth 1.0a tokens are permanent — never refresh via OAuth 2.0 flow
    if (account.oauth_version === '1.0a') {
      let decrypted;
      try {
        decrypted = PaymentSecurityService.decryptSensitiveData(account.encrypted_access_token);
      } catch (error) {
        throw new Error(`OAuth 1.0a access token decryption failed for @${account.handle}: ${error.message}`);
      }
      const accessToken = decrypted?.accessToken || decrypted?.token;
      if (!accessToken) {
        throw new Error(`Token de acceso OAuth 1.0a inválido para @${account.handle}`);
      }
      return accessToken;
    }

    let decrypted;
    try {
      decrypted = PaymentSecurityService.decryptSensitiveData(account.encrypted_access_token);
    } catch (error) {
      logger.error('Failed to decrypt X access token — cannot use encrypted blob as token', {
        accountId: account.account_id,
        error: error.message,
      });
      throw new Error(`X access token decryption failed for account ${account.account_id}: ${error.message}`);
    }

    if (!decrypted) {
      logger.error('X access token decryption returned null — triggering token refresh', { accountId: account.account_id });
      try {
        const refreshed = await refreshAccountTokens(account);
        return refreshed.accessToken;
      } catch (refreshErr) {
        throw new Error(`X access token decryption failed and refresh also failed for account ${account.account_id}`);
      }
    }

    const accessToken = decrypted?.accessToken || decrypted?.token;

    // OAuth 2.0: check expiry and refresh if needed
    const expiresAt = decrypted?.expiresAt ? new Date(decrypted.expiresAt) : account.token_expires_at;

    if (expiresAt && expiresAt.getTime() - Date.now() <= X_TOKEN_EXPIRY_BUFFER_MS) {
      try {
        const refreshed = await refreshAccountTokens(account);
        return refreshed.accessToken;
      } catch (refreshErr) {
        logger.error('X token refresh failed — deactivating account and pausing campaigns', {
          accountId: account.account_id,
          handle: account.handle,
          error: refreshErr.message,
        });

        // Deactivate the account so no more posts are attempted
        await db.query(
          'UPDATE x_accounts SET is_active = FALSE, updated_at = NOW() WHERE account_id = $1',
          [account.account_id]
        );

        // Auto-pause all active campaigns using this account
        const paused = await db.query(
          `UPDATE x_auto_campaigns
           SET status = 'paused', next_run_at = NULL, updated_at = NOW()
           WHERE account_id = $1 AND status = 'active'
           RETURNING campaign_id, name`,
          [account.account_id]
        );
        if (paused.rows.length) {
          logger.warn('Auto-paused campaigns due to dead X token', {
            handle: account.handle,
            campaigns: paused.rows.map(r => r.name),
          });
        }

        const err = new Error(
          `Token de X expirado para @${account.handle}. Reconecta la cuenta desde Gestionar Cuentas.`
        );
        err.tokenExpired = true;
        throw err;
      }
    }

    if (!accessToken) {
      throw new Error('Token de acceso inválido para la cuenta de X');
    }

    return accessToken;
  }

  static async getPendingPosts() {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const query = `
        UPDATE x_post_jobs
        SET status = 'sending',
            updated_at = CURRENT_TIMESTAMP
        WHERE post_id = (
            SELECT post_id
            FROM x_post_jobs
            WHERE status = 'scheduled'
              AND scheduled_at <= NOW()
            ORDER BY scheduled_at ASC
            FOR UPDATE SKIP LOCKED
            LIMIT 1
        )
        RETURNING post_id, account_id, text, media_url, admin_id, admin_username, retry_count, campaign_id;
      `;
      const result = await client.query(query);
      await client.query('COMMIT');
      return result.rows; // Will return an array with 0 or 1 post
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error claiming pending X post:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  static async getScheduledPosts() {
    const query = `
      SELECT j.post_id, j.account_id, j.text, j.media_url, j.scheduled_at,
             j.admin_id, j.admin_username, j.created_at,
             a.handle, a.display_name
      FROM x_post_jobs j
      LEFT JOIN x_accounts a ON a.account_id::text = j.account_id::text
      WHERE j.status = 'scheduled'
      ORDER BY j.scheduled_at ASC
    `;
    const result = await db.query(query);
    return result.rows;
  }

  static async getRecentPosts(limit = 5) {
    const query = `
      SELECT j.post_id, j.account_id, j.text, j.status, j.scheduled_at,
             j.sent_at, j.error_message, j.created_at,
             a.handle, a.display_name
      FROM x_post_jobs j
      LEFT JOIN x_accounts a ON a.account_id::text = j.account_id::text
      ORDER BY COALESCE(j.sent_at, j.scheduled_at, j.created_at) DESC
      LIMIT $1
    `;
    const result = await db.query(query, [limit]);
    return result.rows;
  }

  static async getPostHistory(limit = 20) {
    const query = `
      SELECT j.post_id, j.account_id, j.text, j.status, j.scheduled_at,
             j.sent_at, j.error_message, j.response_json, j.created_at,
             a.handle, a.display_name
      FROM x_post_jobs j
      LEFT JOIN x_accounts a ON a.account_id::text = j.account_id::text
      WHERE j.status IN ('sent', 'failed')
      ORDER BY COALESCE(j.sent_at, j.created_at) DESC
      LIMIT $1
    `;
    const result = await db.query(query, [limit]);
    return result.rows;
  }

  static async cancelScheduledPost(postId) {
    const query = `
      DELETE FROM x_post_jobs
      WHERE post_id = $1 AND status = 'scheduled'
      RETURNING post_id
    `;
    const result = await db.query(query, [postId]);
    if (result.rowCount === 0) {
      throw new Error('Post not found or already processed');
    }
    return result.rows[0];
  }

  static async getPostById(postId) {
    const query = `
      SELECT j.*, a.handle, a.display_name
      FROM x_post_jobs j
      LEFT JOIN x_accounts a ON a.account_id::text = j.account_id::text
      WHERE j.post_id = $1
    `;
    const result = await db.query(query, [postId]);
    return result.rows[0] || null;
  }

  static async incrementRetryCount(postId) {
    const query = `
      UPDATE x_post_jobs
      SET retry_count = COALESCE(retry_count, 0) + 1,
          updated_at = CURRENT_TIMESTAMP
      WHERE post_id = $1
      RETURNING retry_count
    `;
    const result = await db.query(query, [postId]);
    return result.rows[0]?.retry_count || 0;
  }

  static async reschedulePost(postId, delayMinutes) {
    const query = `
      UPDATE x_post_jobs
      SET scheduled_at = NOW() + ($1 * INTERVAL '1 minute'),
          status = 'scheduled',
          updated_at = CURRENT_TIMESTAMP
      WHERE post_id = $2
    `;
    await db.query(query, [delayMinutes, postId]);
  }
}

module.exports = XPostService;
module.exports.refreshAccountTokens = refreshAccountTokens;
