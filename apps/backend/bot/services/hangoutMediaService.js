'use strict';

/**
 * hangoutMediaService.js
 *
 * Processes media uploads for hangout group chats, storing files in
 * per-hangout subdirectories: /public/uploads/hangouts/<hangoutId>/
 *
 * Image processing:
 *   - Resize to max 1920px on longest edge (preserving aspect ratio)
 *   - Convert to WebP at quality 80
 *   - Generate 400px thumbnail
 *
 * Video processing:
 *   - Store as-is (mp4/webm)
 *   - Extract poster frame at 1 second via ffmpeg
 *   - Probe duration/dimensions via ffprobe when available
 *
 * This service delegates common validation to chatMediaService's
 * resolveMediaType helper, then does its own storage with hangout-specific
 * directory layout.
 */

const path = require('path');
const fs = require('fs').promises;
const { execFile } = require('child_process');
const { promisify } = require('util');
const sharp = require('sharp');
const logger = require('../../utils/logger');
const { resolveMediaType } = require('./chatMediaService');

const execFileAsync = promisify(execFile);

// ── Configuration ────────────────────────────────────────────────────────────

const IMAGE_MAX_DIMENSION = 1920;
const IMAGE_THUMB_DIMENSION = 400;
const IMAGE_QUALITY = 80;
const THUMB_QUALITY = 72;

// Max file sizes enforced at the multer level, but we double-check here
const IMAGE_MAX_BYTES = 10 * 1024 * 1024;  // 10 MB
const VIDEO_MAX_BYTES = 50 * 1024 * 1024;  // 50 MB

// Base uploads directory relative to monorepo root
// __dirname = /app/apps/backend/bot/services  =>  ../../../../public
const UPLOAD_ROOT = path.join(__dirname, '../../../../public/uploads/hangouts');

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Ensure the per-hangout upload directory exists.
 */
async function ensureDir(hangoutId) {
  const dir = path.join(UPLOAD_ROOT, String(hangoutId));
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Build a public URL path for a file inside the hangout upload directory.
 */
function publicUrl(hangoutId, filename) {
  return `/uploads/hangouts/${hangoutId}/${filename}`;
}

// ── Image processing ─────────────────────────────────────────────────────────

async function processImage(buffer, hangoutId, userId) {
  const dir = await ensureDir(hangoutId);
  const ts = Date.now();
  const mainFilename = `img-${userId}-${ts}.webp`;
  const thumbFilename = `img-${userId}-${ts}-thumb.webp`;
  const mainPath = path.join(dir, mainFilename);
  const thumbPath = path.join(dir, thumbFilename);

  const meta = await sharp(buffer).metadata();

  const mainInfo = await sharp(buffer)
    .rotate()
    .withMetadata(false)
    .resize(IMAGE_MAX_DIMENSION, IMAGE_MAX_DIMENSION, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: IMAGE_QUALITY })
    .toFile(mainPath);

  await sharp(buffer)
    .rotate()
    .withMetadata(false)
    .resize(IMAGE_THUMB_DIMENSION, IMAGE_THUMB_DIMENSION, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: THUMB_QUALITY })
    .toFile(thumbPath);

  return {
    mediaUrl: publicUrl(hangoutId, mainFilename),
    thumbUrl: publicUrl(hangoutId, thumbFilename),
    width: mainInfo.width || meta.width || null,
    height: mainInfo.height || meta.height || null,
    metadata: {
      originalWidth: meta.width || null,
      originalHeight: meta.height || null,
      format: meta.format || null,
    },
  };
}

// ── Video processing ─────────────────────────────────────────────────────────

async function processVideo(buffer, hangoutId, userId, mimetype) {
  const dir = await ensureDir(hangoutId);
  const ts = Date.now();
  const ext = mimetype === 'video/webm' ? 'webm' : 'mp4';
  const videoFilename = `vid-${userId}-${ts}.${ext}`;
  const thumbFilename = `vid-${userId}-${ts}-thumb.webp`;
  const videoPath = path.join(dir, videoFilename);
  const thumbPath = path.join(dir, thumbFilename);

  await fs.writeFile(videoPath, buffer);

  // Extract poster frame
  let thumbUrl = null;
  try {
    await execFileAsync('ffmpeg', [
      '-y',
      '-ss', '00:00:01',
      '-i', videoPath,
      '-frames:v', '1',
      '-vf', 'scale=400:-2',
      '-q:v', '2',
      thumbPath,
    ], { timeout: 30000 });
    thumbUrl = publicUrl(hangoutId, thumbFilename);
  } catch (err) {
    logger.warn('hangoutMediaService: ffmpeg thumbnail failed', {
      file: videoFilename,
      error: err.message,
    });
    await fs.unlink(thumbPath).catch(() => {});
  }

  // Probe video dimensions/duration via ffprobe (best-effort)
  let probeData = {};
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_streams',
      '-show_format',
      videoPath,
    ], { timeout: 15000 });
    const info = JSON.parse(stdout);
    const videoStream = (info.streams || []).find(s => s.codec_type === 'video');
    probeData = {
      duration: info.format?.duration ? parseFloat(info.format.duration) : null,
      width: videoStream?.width || null,
      height: videoStream?.height || null,
      codec: videoStream?.codec_name || null,
      fileSize: info.format?.size ? parseInt(info.format.size, 10) : buffer.length,
    };
  } catch (probeErr) {
    logger.warn('hangoutMediaService: ffprobe failed', { error: probeErr.message });
    probeData = { fileSize: buffer.length };
  }

  return {
    mediaUrl: publicUrl(hangoutId, videoFilename),
    thumbUrl,
    width: probeData.width || null,
    height: probeData.height || null,
    metadata: {
      duration: probeData.duration || null,
      codec: probeData.codec || null,
      fileSize: probeData.fileSize || buffer.length,
    },
  };
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Process a hangout media upload.
 *
 * @param {object}       file       Multer file object (memoryStorage)
 * @param {number|string} hangoutId Hangout group ID (for directory partitioning)
 * @param {number|string} userId    Authenticated user ID (for filename uniqueness)
 * @returns {Promise<{
 *   mediaType: 'image'|'video',
 *   mediaMime: string,
 *   mediaUrl: string,
 *   thumbUrl: string|null,
 *   width: number|null,
 *   height: number|null,
 *   metadata: object,
 * }>}
 * @throws {Error} with .userMessage and .statusCode on validation failure
 */
async function processHangoutMedia(file, hangoutId, userId) {
  if (!file || !file.buffer || !file.mimetype) {
    const err = new Error('No file uploaded');
    err.userMessage = 'No file was received. Please try again.';
    err.statusCode = 400;
    throw err;
  }

  const mediaType = resolveMediaType(file.mimetype);
  if (!mediaType) {
    const err = new Error(`Disallowed mime type: ${file.mimetype}`);
    err.userMessage = 'Only images (jpg, png, webp, gif) and videos (mp4, webm) are allowed.';
    err.statusCode = 400;
    throw err;
  }

  // Enforce size limits per media type
  if (mediaType === 'image' && file.buffer.length > IMAGE_MAX_BYTES) {
    const err = new Error('Image exceeds 10 MB limit');
    err.userMessage = 'Images must be under 10 MB.';
    err.statusCode = 400;
    throw err;
  }
  if (mediaType === 'video' && file.buffer.length > VIDEO_MAX_BYTES) {
    const err = new Error('Video exceeds 50 MB limit');
    err.userMessage = 'Videos must be under 50 MB.';
    err.statusCode = 400;
    throw err;
  }

  try {
    if (mediaType === 'image') {
      const result = await processImage(file.buffer, hangoutId, userId);
      return {
        mediaType: 'image',
        mediaMime: file.mimetype.toLowerCase(),
        mediaUrl: result.mediaUrl,
        thumbUrl: result.thumbUrl,
        width: result.width,
        height: result.height,
        metadata: result.metadata,
      };
    }

    const result = await processVideo(file.buffer, hangoutId, userId, file.mimetype.toLowerCase());
    return {
      mediaType: 'video',
      mediaMime: file.mimetype.toLowerCase(),
      mediaUrl: result.mediaUrl,
      thumbUrl: result.thumbUrl,
      width: result.width,
      height: result.height,
      metadata: result.metadata,
    };
  } catch (processingErr) {
    if (processingErr.userMessage) throw processingErr;
    logger.error('hangoutMediaService: processing error', processingErr);
    const err = new Error('Media processing failed');
    err.userMessage = 'Could not process the uploaded file. Please try a different file.';
    err.statusCode = 500;
    throw err;
  }
}

module.exports = {
  processHangoutMedia,
  IMAGE_MAX_BYTES,
  VIDEO_MAX_BYTES,
};
