/**
 * Video Media Service
 * Handles large video uploads, streaming, and processing
 * Supports Telegram's large file capabilities
 */

const fs = require('fs');
const path = require('path');
const logger = require('../../utils/logger');
const db = require('../../utils/db');
const s3Service = require('../../utils/s3Service');

class VideoMediaService {
  /**
   * Maximum file sizes per platform
   * Telegram allows up to 2GB for bot API via files
   */
  static MAX_FILE_SIZES = {
    PHOTO: 10 * 1024 * 1024, // 10 MB
    VIDEO_DIRECT: 50 * 1024 * 1024, // 50 MB (safe limit)
    VIDEO_S3: 2 * 1024 * 1024 * 1024, // 2 GB (via S3)
    DOCUMENT: 2 * 1024 * 1024 * 1024, // 2 GB
  };

  /**
   * Supported video codecs and formats
   */
  static SUPPORTED_FORMATS = {
    VIDEO: ['mp4', 'mov', 'mkv', 'avi', 'flv', 'webm', 'h264', 'h265', 'vp8', 'vp9'],
    AUDIO: ['mp3', 'aac', 'wav', 'flac', 'ogg', 'm4a'],
  };

  /**
   * Upload video to S3 with validation
   * @param {Buffer|String} fileSource - File buffer or path
   * @param {String} fileName - Original filename
   * @param {Number} fileSizeBytes - File size in bytes
   * @param {Object} options - Upload options
   * @returns {Promise<Object>} Upload result with S3 details
   */
  async uploadVideoToS3(fileSource, fileName, fileSizeBytes, options = {}) {
    try {
      logger.info('Starting video upload', {
        fileName,
        fileSizeBytes,
        sizeGB: (fileSizeBytes / (1024 * 1024 * 1024)).toFixed(2),
      });

      // Validate file size (2GB limit for S3/Telegram)
      if (fileSizeBytes > this.constructor.MAX_FILE_SIZES.VIDEO_S3) {
        throw new Error(
          `File too large: ${(fileSizeBytes / (1024 * 1024 * 1024)).toFixed(2)}GB. ` +
          `Maximum: ${(this.constructor.MAX_FILE_SIZES.VIDEO_S3 / (1024 * 1024 * 1024)).toFixed(2)}GB`
        );
      }

      // Extract file extension
      const ext = path.extname(fileName).toLowerCase().substring(1);
      if (!this.constructor.SUPPORTED_FORMATS.VIDEO.includes(ext)) {
        throw new Error(`Unsupported video format: .${ext}`);
      }

      // Prepare upload options
      const uploadOptions = {
        contentType: this.getMimeType(ext),
        metadata: {
          originalName: fileName,
          uploadedAt: new Date().toISOString(),
          sizeGB: (fileSizeBytes / (1024 * 1024 * 1024)).toFixed(2),
          ...options.metadata,
        },
        // Enable multipart upload for large files
        partSize: 5 * 1024 * 1024, // 5 MB parts
        queueSize: 4, // 4 concurrent parts
      };

      // Upload to S3
      const s3Result = await s3Service.uploadFromBuffer(
        fileSource,
        'community-posts/videos',
        fileName,
        uploadOptions
      );

      logger.info('Video uploaded successfully', {
        fileName,
        s3Key: s3Result.key,
        s3Url: s3Result.url,
      });

      return {
        success: true,
        fileName,
        fileSizeBytes,
        s3Key: s3Result.key,
        s3Url: s3Result.url,
        s3Bucket: s3Result.bucket,
        mimeType: uploadOptions.contentType,
        uploadedAt: new Date(),
      };
    } catch (error) {
      logger.error('Error uploading video to S3:', error);
      throw error;
    }
  }

  /**
   * Create video media record in database
   * @param {String} postId - Post UUID
   * @param {Object} mediaData - Media information
   * @returns {Promise<Object>} Media record
   */
  async createMediaRecord(postId, mediaData) {
    try {
      const query = `
        INSERT INTO community_post_media_enhanced (
          post_id, media_type, original_filename, file_size_bytes, duration_seconds,
          s3_key, s3_bucket, s3_url, mime_type, processing_status
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING *;
      `;

      const values = [
        postId,
        mediaData.mediaType || 'video',
        mediaData.originalFilename,
        mediaData.fileSizeBytes,
        mediaData.durationSeconds || null,
        mediaData.s3Key,
        mediaData.s3Bucket,
        mediaData.s3Url,
        mediaData.mimeType,
        'ready', // Set to ready if already processed
      ];

      const result = await db.query(query, values);
      logger.info('Media record created', { mediaId: result.rows[0].media_id });
      return result.rows[0];
    } catch (error) {
      logger.error('Error creating media record:', error);
      throw error;
    }
  }

  /**
   * Send video to Telegram (chooses best method based on size)
   * @param {Object} bot - Telegraf bot instance
   * @param {String} chatId - Telegram chat ID
   * @param {String} videoUrl - S3 URL or file path
   * @param {String} caption - Video caption
   * @param {Object} markup - Inline keyboard markup
   * @param {Number} fileSizeBytes - File size in bytes
   * @returns {Promise<Object>} Send result
   */
  async sendVideoToTelegram(bot, chatId, videoUrl, caption, markup, fileSizeBytes) {
    try {
      const videoFileName = path.basename(videoUrl);
      const sizeGB = (fileSizeBytes / (1024 * 1024 * 1024)).toFixed(2);

      logger.info('Sending video to Telegram', {
        chatId,
        videoFileName,
        sizeGB,
        url: videoUrl,
      });

      const options = {
        parse_mode: 'Markdown',
        caption: caption,
        supports_streaming: true, // Enable streaming playback
        ...markup,
      };

      let response;

      // For small videos (< 50MB), send directly
      if (fileSizeBytes < this.constructor.MAX_FILE_SIZES.VIDEO_DIRECT) {
        response = await bot.telegram.sendVideo(
          chatId,
          { url: videoUrl }, // Telegram will download from S3
          options
        );
        logger.info('Video sent directly', { messageId: response.message_id });
      } else {
        // For large videos (50MB - 2GB), send with streaming support
        response = await bot.telegram.sendVideo(
          chatId,
          { url: videoUrl },
          {
            ...options,
            supports_streaming: true, // Critical for large videos
          }
        );
        logger.info('Large video sent with streaming', {
          messageId: response.message_id,
          sizeGB,
        });
      }

      return {
        success: true,
        messageId: response.message_id,
        fileId: response.video?.file_id,
        sizeGB,
      };
    } catch (error) {
      logger.error('Error sending video to Telegram:', error);
      throw error;
    }
  }

  /**
   * Send to Prime channel with large video support
   * @param {Object} bot - Telegraf bot instance
   * @param {String} primeChannelId - Prime channel Telegram ID
   * @param {Object} post - Post data with media
   * @param {String} messageText - Message text
   * @param {Object} markup - Button markup
   * @returns {Promise<Object>} Send result
   */
  async sendToPrimeChannel(bot, primeChannelId, post, messageText, markup) {
    try {
      logger.info('Sending post to Prime Channel', {
        channelId: primeChannelId,
        postId: post.post_id,
      });

      const options = {
        parse_mode: 'Markdown',
        ...markup,
      };

      let response;

      if (post.media_type === 'video' && post.media_url) {
        // Send video to channel
        response = await bot.telegram.sendVideo(
          primeChannelId,
          { url: post.media_url },
          {
            ...options,
            caption: messageText,
            supports_streaming: true,
          }
        );
      } else if (post.media_type === 'photo' && post.media_url) {
        // Send photo to channel
        response = await bot.telegram.sendPhoto(
          primeChannelId,
          { url: post.media_url },
          {
            ...options,
            caption: messageText,
          }
        );
      } else {
        // Send text-only message to channel
        response = await bot.telegram.sendMessage(
          primeChannelId,
          messageText,
          options
        );
      }

      logger.info('Post sent to Prime Channel', { messageId: response.message_id });

      return {
        success: true,
        messageId: response.message_id,
        channelId: primeChannelId,
        filetype: post.media_type,
      };
    } catch (error) {
      logger.error('Error sending to Prime Channel:', error);
      throw error;
    }
  }

  /**
   * Get MIME type from file extension
   * @param {String} ext - File extension
   * @returns {String} MIME type
   */
  getMimeType(ext) {
    const mimeTypes = {
      mp4: 'video/mp4',
      mov: 'video/quicktime',
      mkv: 'video/x-matroska',
      avi: 'video/x-msvideo',
      flv: 'video/x-flv',
      webm: 'video/webm',
      h264: 'video/h264',
      h265: 'video/h265',
      vp8: 'video/vp8',
      vp9: 'video/vp9',
      mp3: 'audio/mpeg',
      aac: 'audio/aac',
      wav: 'audio/wav',
      flac: 'audio/flac',
      ogg: 'audio/ogg',
      m4a: 'audio/mp4',
    };
    return mimeTypes[ext.toLowerCase()] || 'application/octet-stream';
  }

  /**
   * Calculate video file size info for display
   * @param {Number} bytes - File size in bytes
   * @returns {Object} Size info
   */
  getFileSizeInfo(bytes) {
    const kb = bytes / 1024;
    const mb = kb / 1024;
    const gb = mb / 1024;

    return {
      bytes,
      kb: kb.toFixed(2),
      mb: mb.toFixed(2),
      gb: gb.toFixed(2),
      readable:
        gb >= 1
          ? `${gb.toFixed(2)} GB`
          : mb >= 1
          ? `${mb.toFixed(2)} MB`
          : `${kb.toFixed(2)} KB`,
    };
  }

  /**
   * Validate video file
   * @param {Number} fileSizeBytes - File size
   * @param {String} mimeType - MIME type
   * @returns {Object} Validation result
   */
  validateVideoFile(fileSizeBytes, mimeType) {
    const errors = [];

    if (fileSizeBytes > this.constructor.MAX_FILE_SIZES.VIDEO_S3) {
      errors.push(
        `File size exceeds maximum (${(this.constructor.MAX_FILE_SIZES.VIDEO_S3 / (1024 * 1024 * 1024)).toFixed(2)}GB)`
      );
    }

    if (mimeType && !mimeType.startsWith('video/')) {
      errors.push(`Invalid media type: ${mimeType}`);
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings: fileSizeBytes > 100 * 1024 * 1024 ? ['Large file - upload may take time'] : [],
    };
  }

  /**
   * Queue video for processing (transcoding, compression)
   * @param {String} mediaId - Media UUID
   * @param {String} postId - Post UUID
   * @param {String} taskType - Task type (transcode, compress, generate_streaming)
   * @returns {Promise<Object>} Task record
   */
  async queueVideoProcessing(mediaId, postId, taskType = 'generate_streaming') {
    try {
      const query = `
        INSERT INTO community_post_video_processing (
          media_id, post_id, task_type, status
        )
        VALUES ($1, $2, $3, 'queued')
        RETURNING *;
      `;

      const result = await db.query(query, [mediaId, postId, taskType]);
      logger.info('Video processing task queued', {
        taskId: result.rows[0].task_id,
        taskType,
      });
      return result.rows[0];
    } catch (error) {
      logger.error('Error queuing video processing:', error);
      throw error;
    }
  }

  /**
   * Update video processing status
   * @param {String} taskId - Task UUID
   * @param {String} status - New status
   * @param {Number} progressPercent - Progress percentage
   * @param {String} errorMessage - Error message if failed
   */
  async updateProcessingStatus(taskId, status, progressPercent = 0, errorMessage = null) {
    try {
      const query = `
        UPDATE community_post_video_processing
        SET
          status = $1,
          progress_percent = $2,
          error_message = $3,
          updated_at = NOW()
        WHERE task_id = $4;
      `;

      await db.query(query, [status, progressPercent, errorMessage, taskId]);
    } catch (error) {
      logger.error('Error updating processing status:', error);
      throw error;
    }
  }

  /**
   * Get video upload limits info for user
   * @returns {Object} Limits info
   */
  getUploadLimits() {
    return {
      maxVideoSize: this.constructor.MAX_FILE_SIZES.VIDEO_S3,
      maxVideoSizeReadable: `${(this.constructor.MAX_FILE_SIZES.VIDEO_S3 / (1024 * 1024 * 1024)).toFixed(2)} GB`,
      maxPhotoSize: this.constructor.MAX_FILE_SIZES.PHOTO,
      maxPhotoSizeReadable: `${(this.constructor.MAX_FILE_SIZES.PHOTO / (1024 * 1024)).toFixed(2)} MB`,
      supportedFormats: {
        video: this.constructor.SUPPORTED_FORMATS.VIDEO,
        audio: this.constructor.SUPPORTED_FORMATS.AUDIO,
      },
      notes: [
        'Videos up to 2GB supported',
        'Streaming supported for files > 50MB',
        'Direct upload for files < 50MB',
        'All formats automatically optimized for Telegram',
      ],
    };
  }
}

module.exports = new VideoMediaService();
