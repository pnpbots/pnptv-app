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

const IMAGE_MAX_DIMENSION = 1280; // px, longest edge
const IMAGE_THUMB_DIMENSION = 400; // px, longest edge for thumbnail
const IMAGE_QUALITY = 78;
const THUMB_QUALITY = 72;
const UPLOAD_BASE = path.join(__dirname, '../../../public/uploads/chat');

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

  // Process main image
  const mainSharp = sharp(buffer)
    .rotate() // auto-orient from EXIF
    .resize(IMAGE_MAX_DIMENSION, IMAGE_MAX_DIMENSION, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: IMAGE_QUALITY });

  const mainInfo = await mainSharp.toFile(mainPath);

  // Process thumbnail
  await sharp(buffer)
    .rotate()
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
async function processChatMedia(file, userId) {
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

  try {
    if (mediaType === 'image') {
      const { mediaUrl, thumbUrl, width, height } = await processImage(file.buffer, userId);
      return {
        mediaType: 'image',
        mediaMime: file.mimetype.toLowerCase(),
        mediaUrl,
        thumbUrl,
        width,
        height,
      };
    } else {
      const { mediaUrl, thumbUrl } = await processVideo(file.buffer, userId, file.mimetype.toLowerCase());
      return {
        mediaType: 'video',
        mediaMime: file.mimetype.toLowerCase(),
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

module.exports = {
  processChatMedia,
  resolveMediaType,
  ALLOWED_IMAGE_MIMES,
  ALLOWED_VIDEO_MIMES,
};
