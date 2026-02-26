const logger = require('./logger');

const getBucket = () => process.env.AWS_S3_BUCKET || process.env.S3_BUCKET || '';

const isConfigured = () => Boolean(getBucket());

const buildFallbackResult = (note) => ({
  s3Url: null,
  s3Key: null,
  s3Bucket: null,
  skipped: true,
  note,
});

/**
 * Upload a Telegram file to S3.
 * If S3 is not configured, return a safe fallback so callers can continue
 * using the Telegram file_id directly.
 */
const uploadTelegramFileToS3 = async (bot, fileId, mediaType, options = {}) => {
  if (!isConfigured()) {
    logger.warn('S3 not configured - skipping upload and using Telegram file_id fallback.', {
      fileId,
      mediaType,
    });
    return buildFallbackResult('S3 not configured');
  }

  throw new Error('S3 service is not configured in this build. Please add an S3 implementation.');
};

/**
 * Upload a buffer to S3.
 * This requires a real S3 implementation; throw if not configured.
 */
const uploadFromBuffer = async () => {
  if (!isConfigured()) {
    throw new Error('S3 not configured');
  }
  throw new Error('S3 service is not configured in this build. Please add an S3 implementation.');
};

/**
 * Generate presigned URL for an S3 object.
 */
const getPresignedUrl = async () => {
  if (!isConfigured()) {
    throw new Error('S3 not configured');
  }
  throw new Error('S3 service is not configured in this build. Please add an S3 implementation.');
};

/**
 * Delete an S3 object.
 */
const deleteFile = async () => {
  if (!isConfigured()) {
    throw new Error('S3 not configured');
  }
  throw new Error('S3 service is not configured in this build. Please add an S3 implementation.');
};

module.exports = {
  uploadTelegramFileToS3,
  uploadFromBuffer,
  getPresignedUrl,
  deleteFile,
};
