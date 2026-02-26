const fs = require('fs').promises;
const path = require('path');
const logger = require('../../utils/logger');
const { query } = require('../../config/postgres');

/**
 * Media Cleanup Service
 * Automatically deletes orphaned media files when posts are deleted
 * and removes old avatar files to minimize storage costs
 */
class MediaCleanupService {
  /**
   * Delete media file if it exists
   */
  static async deleteMediaFile(mediaUrl) {
    if (!mediaUrl) return;
    try {
      const filePath = path.join(__dirname, '../../..', 'public', mediaUrl.replace(/^\//, ''));
      await fs.unlink(filePath);
      logger.info(`Deleted media file: ${mediaUrl}`);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        logger.warn(`Failed to delete media file ${mediaUrl}:`, error.message);
      }
    }
  }

  /**
   * When a post is deleted, also delete its media
   */
  static async deletePostMedia(postId) {
    try {
      const { rows } = await query(
        'SELECT media_url FROM social_posts WHERE id = $1',
        [postId]
      );
      if (rows[0]?.media_url) {
        await this.deleteMediaFile(rows[0].media_url);
      }
    } catch (error) {
      logger.error('Error deleting post media:', error);
    }
  }

  /**
   * Clean up old post media files (older than retention period)
   * Run this daily via cron job
   */
  static async cleanupOldPostMedia(retentionDays = 90) {
    try {
      logger.info(`Starting media cleanup: removing posts older than ${retentionDays} days`);

      // Find deleted or very old media
      const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
      const { rows } = await query(
        'SELECT media_url FROM social_posts WHERE media_url IS NOT NULL AND created_at < $1 AND is_deleted = true',
        [cutoffDate]
      );

      let deletedCount = 0;
      for (const row of rows) {
        await this.deleteMediaFile(row.media_url);
        deletedCount++;
      }

      logger.info(`Media cleanup complete: deleted ${deletedCount} orphaned files`);
    } catch (error) {
      logger.error('Media cleanup error:', error);
    }
  }

  /**
   * Cleanup orphaned avatar files (older than 30 days of inactivity)
   * Only keep the most recent avatar per user
   */
  static async cleanupOldAvatars() {
    try {
      logger.info('Starting avatar cleanup');
      const uploadsDir = path.join(__dirname, '../../../public/uploads/avatars');

      // Get all users with their current photo_file_id
      const { rows: users } = await query(
        'SELECT id, photo_file_id FROM users WHERE photo_file_id IS NOT NULL'
      );

      const currentFiles = new Set();
      for (const user of users) {
        if (user.photo_file_id) {
          const match = user.photo_file_id.match(/([^\/]+)$/);
          if (match) currentFiles.add(match[1]);
        }
      }

      // Delete all avatar files except current ones
      const files = await fs.readdir(uploadsDir);
      let deletedCount = 0;
      for (const file of files) {
        if (!currentFiles.has(file)) {
          await fs.unlink(path.join(uploadsDir, file));
          deletedCount++;
        }
      }

      logger.info(`Avatar cleanup complete: deleted ${deletedCount} old files`);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        logger.error('Avatar cleanup error:', error);
      }
    }
  }
}

module.exports = MediaCleanupService;
