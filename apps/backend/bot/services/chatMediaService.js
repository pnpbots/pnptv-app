'use strict';

/**
 * chatMediaService.js
 *
 * Processes and persists chat media uploads (images and videos).
 * Used by both the community chat controller and hangout group chat controller.
 *
 * Images  : converted to WebP (max 1280px), thumbnail at 400px WebP
 * Videos  : stored as-is (mp4/webm), poster frame extracted with ffmpeg at 1 second
 */

const path = require('path');
const fs = require('fs').promises;
const { execFile } = require('child_process');
const { promisify } = require('util');
const sharp = require('sharp');
const FileType = require('file-type');
const logger = require('../../utils/logger');

const execFileAsync = promisify(execFile);

// Allowed mime types
const ALLOWED_IMAGE_MIMES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
]);

const ALLOWED_VIDEO_MIMES = new Set([
  'video/mp4',
  'video/webm',
]);

const ALLOWED_AUDIO_MIMES = new Set([
  'audio/webm',
  'audio/ogg',
  'audio/mp4',
  'audio/mpeg',
]);

const IMAGE_MAX_DIMENSION = 1280; // px, longest edge
const IMAGE_THUMB_DIMENSION = 400; // px, longest edge for thumbnail
const IMAGE_QUALITY = 78;
const THUMB_QUALITY = 72;
// __dirname = /app/apps/backend/bot/services
// 4 levels up reaches /app (monorepo root), then /public
const UPLOAD_BASE = path.join(__dirname, '../../../../public/uploads/chat');

/**
 * Ensure the upload directory exists.
 * Called once per request — mkdir is idempotent with { recursive: true }.
 */
async function ensureUploadDir() {
  await fs.mkdir(UPLOAD_BASE, { recursive: true });
}

/**
 * Validate that the file's mime type is permitted for chat media.
 * @param {string} mimetype
 * @returns {'image'|'video'|null}
 */
function resolveMediaType(mimetype) {
  const normalized = (mimetype || '').toLowerCase().trim();
  if (ALLOWED_IMAGE_MIMES.has(normalized)) return 'image';
  if (ALLOWED_VIDEO_MIMES.has(normalized)) return 'video';
  if (ALLOWED_AUDIO_MIMES.has(normalized)) return 'audio';
  return null;
}

/**
 * Process an image buffer:
 *  - resize to max IMAGE_MAX_DIMENSION on longest edge, preserving aspect ratio
 *  - convert to WebP
 *  - generate a thumbnail at IMAGE_THUMB_DIMENSION
 *
 * @param {Buffer} buffer        Raw upload buffer
 * @param {string} userId        User id (used for filename uniqueness)
 * @returns {Promise<{mediaUrl: string, thumbUrl: string, width: number, height: number}>}
 */
async function processImage(buffer, userId) {
  await ensureUploadDir();

  const ts = Date.now();
  const mainFilename = `img-${userId}-${ts}.webp`;
  const thumbFilename = `img-${userId}-${ts}-thumb.webp`;
  const mainPath = path.join(UPLOAD_BASE, mainFilename);
  const thumbPath = path.join(UPLOAD_BASE, thumbFilename);

  // Get original dimensions before processing
  const meta = await sharp(buffer).metadata();
  const origWidth = meta.width || 0;
  const origHeight = meta.height || 0;

  // Process main image — strip ALL metadata including EXIF/GPS for privacy
  const mainSharp = sharp(buffer)
    .rotate() // auto-orient from EXIF before stripping
    .withMetadata(false) // STRIP ALL METADATA (EXIF, GPS, ICC profiles)
    .resize(IMAGE_MAX_DIMENSION, IMAGE_MAX_DIMENSION, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: IMAGE_QUALITY });

  const mainInfo = await mainSharp.toFile(mainPath);

  // Process thumbnail — also strip metadata
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
    mediaUrl: `/uploads/chat/${mainFilename}`,
    thumbUrl: `/uploads/chat/${thumbFilename}`,
    width: mainInfo.width || origWidth,
    height: mainInfo.height || origHeight,
  };
}

/**
 * Process a video buffer:
 *  - write video file as-is (mp4 or webm)
 *  - extract poster frame at 1 second using ffmpeg
 *
 * @param {Buffer} buffer        Raw upload buffer
 * @param {string} userId        User id
 * @param {string} mimetype      Original mime type
 * @returns {Promise<{mediaUrl: string, thumbUrl: string|null}>}
 */
async function processVideo(buffer, userId, mimetype) {
  await ensureUploadDir();

  const ts = Date.now();
  const ext = mimetype === 'video/webm' ? 'webm' : 'mp4';
  const videoFilename = `vid-${userId}-${ts}.${ext}`;
  const thumbFilename = `vid-${userId}-${ts}-thumb.webp`;
  const videoPath = path.join(UPLOAD_BASE, videoFilename);
  const thumbPath = path.join(UPLOAD_BASE, thumbFilename);

  // Write the video to disk
  await fs.writeFile(videoPath, buffer);

  // Extract poster frame at 1 second via ffmpeg
  let thumbUrl = null;
  try {
    await execFileAsync('ffmpeg', [
      '-y',                    // overwrite output
      '-ss', '00:00:01',       // seek to 1 second
      '-i', videoPath,
      '-frames:v', '1',        // extract a single frame
      '-vf', 'scale=400:-2',   // scale to 400px wide, maintain aspect (even height)
      '-q:v', '2',
      thumbPath,
    ], { timeout: 30000 });

    thumbUrl = `/uploads/chat/${thumbFilename}`;
  } catch (ffmpegErr) {
    // Non-fatal: video is still uploaded, just without a thumbnail
    logger.warn('chatMediaService: ffmpeg thumbnail extraction failed', {
      file: videoFilename,
      error: ffmpegErr.message,
    });
    // Clean up orphaned thumb file if it was partially written
    await fs.unlink(thumbPath).catch(() => {});
  }

  return {
    mediaUrl: `/uploads/chat/${videoFilename}`,
    thumbUrl,
  };
}

/**
 * Main entry point: validate and process an uploaded file.
 *
 * @param {object} file          Express multer file object (memoryStorage)
 * @param {string} userId        Authenticated user id
 * @returns {Promise<{
 *   mediaType: 'image'|'video',
 *   mediaMime: string,
 *   mediaUrl: string,
 *   thumbUrl: string|null,
 *   width: number|null,
 *   height: number|null,
 * }>}
 * @throws {Error} with a human-readable `.userMessage` property on validation failure
 */
// Magic byte → media type mapping for server-side file validation
const MAGIC_TO_MEDIA_TYPE = {
  'image/jpeg': 'image',
  'image/png':  'image',
  'image/webp': 'image',
  'image/gif':  'image',
  'video/mp4':  'video',
  'video/webm': 'video',
};

async function processChatMedia(file, userId) {
  if (!file || !file.buffer || !file.mimetype) {
    const err = new Error('No file uploaded');
    err.userMessage = 'No file was received. Please try again.';
    err.statusCode = 400;
    throw err;
  }

  // --- MAGIC BYTE VALIDATION ---
  // Never trust client-supplied Content-Type; inspect actual file bytes
  const detected = await FileType.fromBuffer(file.buffer);
  const detectedMime = detected?.mime;
  const mediaType = MAGIC_TO_MEDIA_TYPE[detectedMime];

  if (!mediaType) {
    logger.warn('chatMediaService: rejected file — magic bytes do not match allowed types', {
      userId,
      claimedMime: file.mimetype,
      detectedMime: detectedMime || 'unknown',
    });
    const err = new Error(`File content rejected: detected ${detectedMime || 'unknown'}`);
    err.userMessage = 'Only images (jpg, png, webp, gif) and videos (mp4, webm) are allowed.';
    err.statusCode = 400;
    throw err;
  }

  // Log mismatches between claimed and detected MIME for monitoring
  const claimedType = resolveMediaType(file.mimetype);
  if (claimedType !== mediaType) {
    logger.warn('chatMediaService: MIME type mismatch — using detected type', {
      userId,
      claimedMime: file.mimetype,
      detectedMime,
    });
  }

  try {
    if (mediaType === 'image') {
      const { mediaUrl, thumbUrl, width, height } = await processImage(file.buffer, userId);
      return {
        mediaType: 'image',
        mediaMime: detectedMime,
        mediaUrl,
        thumbUrl,
        width,
        height,
      };
    } else {
      const { mediaUrl, thumbUrl } = await processVideo(file.buffer, userId, detectedMime);
      return {
        mediaType: 'video',
        mediaMime: detectedMime,
        mediaUrl,
        thumbUrl,
        width: null,
        height: null,
      };
    }
  } catch (processingErr) {
    if (processingErr.userMessage) throw processingErr;
    logger.error('chatMediaService: processing error', processingErr);
    const err = new Error('Media processing failed');
    err.userMessage = 'Could not process the uploaded file. Please try a different file.';
    err.statusCode = 500;
    throw err;
  }
}

/**
 * Unified media processing entry point.
 * Supports configurable output subdirectory and image dimensions.
 *
 * @param {object} file                   Multer file object (memoryStorage)
 * @param {string} userId                 Authenticated user id
 * @param {object} [options]
 * @param {string} [options.subdir='chat']  Subdirectory under /public/uploads/
 * @param {number} [options.maxDimension=1280]  Max image dimension in px
 * @param {number} [options.imageQuality=78]
 * @returns {Promise<object>}  Same shape as processChatMedia
 */
async function processMedia(file, userId, options = {}) {
  const {
    subdir = 'chat',
    maxDimension = IMAGE_MAX_DIMENSION,
    imageQuality = IMAGE_QUALITY,
  } = options;

  if (!file || !file.buffer || !file.mimetype) {
    const err = new Error('No file uploaded');
    err.userMessage = 'No file was received. Please try again.';
    err.statusCode = 400;
    throw err;
  }

  const detected = await FileType.fromBuffer(file.buffer);
  const detectedMime = detected?.mime;
  const mediaType = MAGIC_TO_MEDIA_TYPE[detectedMime];

  if (!mediaType) {
    const err = new Error(`File content rejected: detected ${detectedMime || 'unknown'}`);
    err.userMessage = 'Only images (jpg, png, webp, gif) and videos (mp4, webm) are allowed.';
    err.statusCode = 400;
    throw err;
  }

  const uploadDir = path.join(__dirname, `../../../../public/uploads/${subdir}`);
  await fs.mkdir(uploadDir, { recursive: true });

  try {
    if (mediaType === 'image') {
      const ts = Date.now();
      const mainFilename = `img-${userId}-${ts}.webp`;
      const thumbFilename = `img-${userId}-${ts}-thumb.webp`;

      const meta = await sharp(file.buffer).metadata();
      const mainInfo = await sharp(file.buffer)
        .rotate()
        .withMetadata(false)
        .resize(maxDimension, maxDimension, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: imageQuality })
        .toFile(path.join(uploadDir, mainFilename));

      await sharp(file.buffer)
        .rotate()
        .withMetadata(false)
        .resize(IMAGE_THUMB_DIMENSION, IMAGE_THUMB_DIMENSION, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: THUMB_QUALITY })
        .toFile(path.join(uploadDir, thumbFilename));

      return {
        mediaType: 'image',
        mediaMime: detectedMime,
        mediaUrl: `/uploads/${subdir}/${mainFilename}`,
        thumbUrl: `/uploads/${subdir}/${thumbFilename}`,
        width: mainInfo.width || meta.width || null,
        height: mainInfo.height || meta.height || null,
      };
    } else {
      const ts = Date.now();
      const ext = detectedMime === 'video/webm' ? 'webm' : 'mp4';
      const videoFilename = `vid-${userId}-${ts}.${ext}`;
      const thumbFilename = `vid-${userId}-${ts}-thumb.webp`;
      const videoPath = path.join(uploadDir, videoFilename);
      const thumbPath = path.join(uploadDir, thumbFilename);

      await fs.writeFile(videoPath, file.buffer);

      let thumbUrl = null;
      try {
        await execFileAsync('ffmpeg', [
          '-y', '-ss', '00:00:01', '-i', videoPath,
          '-frames:v', '1', '-vf', 'scale=400:-2', '-q:v', '2', thumbPath,
        ], { timeout: 30000 });
        thumbUrl = `/uploads/${subdir}/${thumbFilename}`;
      } catch (ffmpegErr) {
        logger.warn('processMedia: ffmpeg thumbnail failed', { error: ffmpegErr.message });
        await fs.unlink(thumbPath).catch(() => {});
      }

      return {
        mediaType: 'video',
        mediaMime: detectedMime,
        mediaUrl: `/uploads/${subdir}/${videoFilename}`,
        thumbUrl,
        width: null,
        height: null,
      };
    }
  } catch (processingErr) {
    if (processingErr.userMessage) throw processingErr;
    logger.error('processMedia: processing error', processingErr);
    const err = new Error('Media processing failed');
    err.userMessage = 'Could not process the uploaded file. Please try a different file.';
    err.statusCode = 500;
    throw err;
  }
}

module.exports = {
  processChatMedia,
  processMedia,
  resolveMediaType,
  ALLOWED_IMAGE_MIMES,
  ALLOWED_VIDEO_MIMES,
  ALLOWED_AUDIO_MIMES,
};
