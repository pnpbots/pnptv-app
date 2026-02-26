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
const XOAuthService = require('./xOAuthService');
const X_MEDIA_CHUNK_SIZE = 1 * 1024 * 1024; // 1MB (v2 limit)

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
      SELECT account_id, handle, display_name, encrypted_access_token, encrypted_refresh_token, token_expires_at, is_active
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
        throw error;
      }
      if (mediaId) {
        payload.media = { media_ids: [String(mediaId)] };
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
      return await this.uploadMediaToXV2({ accessToken, filePath, mimeType, size });
    } catch (error) {
      const status = error.response?.status;
      const data = error.response?.data;
      logger.error('X media upload failed', {
        status,
        data,
        message: error.message,
      });
      throw error;
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

    while (state && state !== 'succeeded' && state !== 'failed' && attempts < 10) {
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
      checkAfter = info?.check_after_secs || checkAfter;
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

    while (state && state !== 'succeeded' && state !== 'failed' && attempts < 10) {
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
      checkAfter = info?.check_after_secs || checkAfter;
      attempts += 1;

      logger.info('X media processing status check (v1.1)', { mediaId, state, attempts });
    }

    if (state && state !== 'succeeded') {
      throw new Error(`Media processing failed: ${state}`);
    }

    logger.info('X media processing completed (v1.1)', { mediaId, finalState: state });
  }

  static async getValidAccessToken(account) {
    let decrypted;
    try {
      decrypted = PaymentSecurityService.decryptSensitiveData(account.encrypted_access_token);
    } catch (error) {
      logger.warn('Failed to decrypt X access token, falling back to raw value', {
        accountId: account.account_id,
        error: error.message,
      });
      decrypted = account.encrypted_access_token;
    }

    const accessToken = decrypted?.accessToken || decrypted?.token || decrypted;
    const expiresAt = decrypted?.expiresAt ? new Date(decrypted.expiresAt) : account.token_expires_at;

    if (expiresAt && expiresAt.getTime() - Date.now() <= X_TOKEN_EXPIRY_BUFFER_MS) {
      const refreshed = await XOAuthService.refreshAccountTokens(account);
      return refreshed.accessToken;
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
        RETURNING post_id, account_id, text, media_url, admin_id, admin_username, retry_count;
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
      SET scheduled_at = NOW() + INTERVAL '${delayMinutes} minutes',
          status = 'scheduled',
          updated_at = CURRENT_TIMESTAMP
      WHERE post_id = $1
    `;
    await db.query(query, [postId]);
  }
}

module.exports = XPostService;
