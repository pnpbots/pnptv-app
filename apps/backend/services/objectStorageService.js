/**
 * objectStorageService.js — S3-compatible object storage for video files.
 *
 * Uses Cloudflare R2 in production (free egress, $0.015/GB at rest, AES-256
 * SSE built-in). The SDK is S3-compatible so the same code works for any
 * S3-compatible backend (AWS S3, Backblaze B2, MinIO, etc.) by swapping
 * S3_ENDPOINT.
 *
 * Falls through to disk-only mode when S3_ENDPOINT is unset — lets dev/test
 * environments work without R2 credentials.
 *
 * Key convention: /uploads/posts/vid-XXX.mp4 (DB media_url) maps to the R2
 * object key `posts/vid-XXX.mp4`. The guard middleware translates the URL to
 * a presigned URL with 1h TTL when serving exclusive content.
 */

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

let s3Client = null;
let presigner = null;
let configured = false;

function initialize() {
  if (!process.env.S3_ENDPOINT || !process.env.S3_ACCESS_KEY_ID || !process.env.S3_SECRET_ACCESS_KEY || !process.env.S3_BUCKET) {
    logger.info('Object storage: not configured (S3_* env vars missing) — using disk-only mode');
    return;
  }
  try {
    const { S3Client } = require('@aws-sdk/client-s3');
    const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
    s3Client = new S3Client({
      region: process.env.S3_REGION || 'auto',
      endpoint: process.env.S3_ENDPOINT,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
      },
    });
    presigner = getSignedUrl;
    configured = true;
    logger.info('Object storage: initialized', {
      endpoint: process.env.S3_ENDPOINT,
      bucket: process.env.S3_BUCKET,
    });
  } catch (err) {
    logger.error('Object storage: SDK init failed — disk-only mode', { error: err.message });
  }
}

initialize();

/** Translate a public media URL (DB column) to an R2 object key. */
function keyForMediaUrl(mediaUrl) {
  if (!mediaUrl) return null;
  // /uploads/posts/vid-xxx.mp4 → posts/vid-xxx.mp4
  // /uploads/posts/thumb-xxx.jpg → posts/thumb-xxx.jpg
  const m = String(mediaUrl).match(/^\/uploads\/(.+)$/);
  return m ? m[1] : null;
}

/** Upload a local file to R2. Reads from disk; deletes nothing. */
async function uploadFile(localPath, key, contentType) {
  if (!configured) throw new Error('Object storage not configured');
  const { PutObjectCommand } = require('@aws-sdk/client-s3');
  const body = fs.createReadStream(localPath);
  await s3Client.send(new PutObjectCommand({
    Bucket: process.env.S3_BUCKET,
    Key: key,
    Body: body,
    ContentType: contentType || guessContentType(localPath),
  }));
}

/** HEAD to check if an object exists. Returns true/false. */
async function exists(key) {
  if (!configured) return false;
  try {
    const { HeadObjectCommand } = require('@aws-sdk/client-s3');
    await s3Client.send(new HeadObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }));
    return true;
  } catch (err) {
    if (err.$metadata?.httpStatusCode === 404 || err.name === 'NotFound') return false;
    throw err;
  }
}

/** Generate a presigned GET URL with TTL in seconds (default 1h). */
async function getPresignedUrl(key, ttlSeconds = 3600) {
  if (!configured) throw new Error('Object storage not configured');
  const { GetObjectCommand } = require('@aws-sdk/client-s3');
  const cmd = new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key });
  return await presigner(s3Client, cmd, { expiresIn: ttlSeconds });
}

/** Delete an object from R2. */
async function deleteFile(key) {
  if (!configured) throw new Error('Object storage not configured');
  const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
  await s3Client.send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }));
}

function guessContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.mp4') return 'video/mp4';
  if (ext === '.webm') return 'video/webm';
  if (ext === '.mov') return 'video/quicktime';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  return 'application/octet-stream';
}

module.exports = {
  isConfigured: () => configured,
  keyForMediaUrl,
  uploadFile,
  exists,
  getPresignedUrl,
  deleteFile,
};
