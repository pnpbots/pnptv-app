'use strict';

const fs = require('fs');
const path = require('path');
const logger = require('../../../utils/logger');
const streamerSettingsService = require('../../../services/streamerSettingsService');
const { getPool } = require('../../../config/postgres');

// Gap 2: thumbnail storage directory
const THUMB_UPLOAD_DIR = '/opt/pnptvapp/storage/stream-thumbs';
try { fs.mkdirSync(THUMB_UPLOAD_DIR, { recursive: true }); } catch { /* ok */ }

/**
 * GET /api/webapp/live/settings
 *
 * Returns the authenticated user's streamer settings.
 * If no row exists yet the service returns the canonical defaults,
 * so the frontend always receives a fully-populated settings object.
 * Also returns thumbnailUrl from the streamer_settings row if set.
 */
const getSettings = async (req, res) => {
  try {
    // Session stores pnptvId (camelCase); fall back to numeric id if absent.
    const userId = req.user.pnptvId || req.user.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const settings = await streamerSettingsService.getSettings(String(userId));
    // Expose snake_case DB columns as camelCase to frontend
    const thumbnailUrl = settings.thumbnail_url || null;
    const lastStreamTitle = settings.last_stream_title ?? null;
    const lastStreamDescription = settings.last_stream_description ?? null;
    return res.json({ success: true, settings: { ...settings, thumbnailUrl, lastStreamTitle, lastStreamDescription } });
  } catch (err) {
    logger.error('streamerSettingsController.getSettings error', err);
    return res.status(500).json({ success: false, error: 'Failed to retrieve streamer settings' });
  }
};

/**
 * POST /api/webapp/live/thumbnail
 *
 * Accepts JSON { dataUrl: string } — base64-encoded image, max 2 MB after decode.
 * Converts to WebP via sharp, saves to /opt/pnptvapp/storage/stream-thumbs/<userId>-<ts>.webp,
 * persists URL in streamer_settings.thumbnail_url, returns { url }.
 */
const uploadThumbnail = async (req, res) => {
  let sharp;
  try {
    sharp = require('sharp');
  } catch {
    return res.status(500).json({ success: false, error: 'Image processing unavailable' });
  }

  const userId = req.user.pnptvId || req.user.id;
  if (!userId) {
    return res.status(401).json({ success: false, error: 'Not authenticated' });
  }

  const { dataUrl } = req.body || {};
  if (!dataUrl || typeof dataUrl !== 'string') {
    return res.status(400).json({ success: false, error: 'dataUrl is required' });
  }

  // Strip data URI prefix: "data:image/jpeg;base64,..."
  const commaIdx = dataUrl.indexOf(',');
  if (commaIdx === -1) {
    return res.status(400).json({ success: false, error: 'Invalid dataUrl format' });
  }
  const b64 = dataUrl.slice(commaIdx + 1);
  const imageBuffer = Buffer.from(b64, 'base64');

  // Enforce 2 MB limit on the decoded image
  if (imageBuffer.byteLength > 2 * 1024 * 1024) {
    return res.status(413).json({ success: false, error: 'Image exceeds 2 MB limit' });
  }

  const filename = `${userId}-${Date.now()}.webp`;
  const filePath = path.join(THUMB_UPLOAD_DIR, filename);
  const publicUrl = `/static/stream-thumbs/${filename}`;

  try {
    await sharp(imageBuffer)
      .resize({ width: 1280, height: 720, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 85 })
      .toFile(filePath);

    // Persist in streamer_settings
    await getPool().query(
      `INSERT INTO streamer_settings (user_id, thumbnail_url)
       VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET thumbnail_url = $2, updated_at = NOW()`,
      [String(userId), publicUrl]
    );

    return res.json({ success: true, url: publicUrl });
  } catch (err) {
    logger.error('streamerSettingsController.uploadThumbnail error', { userId, err: err.message });
    return res.status(500).json({ success: false, error: 'Failed to process thumbnail' });
  }
};

/**
 * PUT /api/webapp/live/settings
 *
 * Upserts the authenticated user's streamer settings.
 * Unknown or out-of-range values are silently sanitized by the service layer.
 * Returns the full updated settings object.
 */
const updateSettings = async (req, res) => {
  try {
    const userId = req.user.pnptvId || req.user.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    // Translate camelCase body keys to snake_case before passing to service
    const raw = req.body || {};
    const translated = { ...raw };
    if ('lastStreamTitle' in raw)       { translated.last_stream_title       = raw.lastStreamTitle;       delete translated.lastStreamTitle; }
    if ('lastStreamDescription' in raw) { translated.last_stream_description = raw.lastStreamDescription; delete translated.lastStreamDescription; }
    const settings = await streamerSettingsService.upsertSettings(String(userId), translated);
    const lastStreamTitle = settings.last_stream_title ?? null;
    const lastStreamDescription = settings.last_stream_description ?? null;
    return res.json({ success: true, settings: { ...settings, lastStreamTitle, lastStreamDescription } });
  } catch (err) {
    logger.error('streamerSettingsController.updateSettings error', err);
    return res.status(500).json({ success: false, error: 'Failed to update streamer settings' });
  }
};

module.exports = { getSettings, updateSettings, uploadThumbnail };
