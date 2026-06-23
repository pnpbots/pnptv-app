const logger = require('../utils/logger');
const { query } = require('../config/postgres');

/**
 * PNP Television Live Media Service
 * Handles model images, galleries, and media assets
 */

class PNPLiveMediaService {
  /**
   * Get model profile image URL
   * @param {number} modelId - Model ID
   * @returns {Promise<string|null>} Profile image URL or null
   */
  static async getModelProfileImage(modelId) {
    try {
      const result = await query(
        `SELECT photo_url FROM performers WHERE id = $1`,
        [modelId]
      );

      return result.rows?.[0]?.photo_url || null;
    } catch (error) {
      logger.error('Error getting model profile image:', error);
      return null;
    }
  }

  /**
   * Get multiple model profile images for carousel
   * @param {Array<number>} modelIds - Array of model IDs
   * @returns {Promise<Array>} Array of {modelId, imageUrl, name}
   */
  static async getModelImagesForCarousel(modelIds) {
    try {
      if (!modelIds || modelIds.length === 0) {
        return [];
      }
      
      const result = await query(
        `SELECT id, display_name, photo_url
         FROM performers
         WHERE id = ANY($1) AND photo_url IS NOT NULL
         ORDER BY is_available DESC, display_name ASC`,
        [modelIds]
      );

      return result.rows.map(row => ({
        modelId: row.id,
        name: row.display_name,
        imageUrl: row.photo_url
      }));
    } catch (error) {
      logger.error('Error getting model images for carousel:', error);
      return [];
    }
  }

  /**
   * Get featured models with images (online models with profile pictures)
   * @param {number} limit - Maximum number of models to return
   * @returns {Promise<Array>} Array of featured models with images
   */
  static async getFeaturedModelsWithImages(limit = 6) {
    try {
      const result = await query(
        `SELECT id, display_name, photo_url, is_available
         FROM performers
         WHERE status = 'active'
         AND photo_url IS NOT NULL
         ORDER BY is_available DESC, display_name ASC
         LIMIT $1`,
        [limit]
      );

      return result.rows.map(row => ({
        modelId: row.id,
        name: row.display_name,
        imageUrl: row.photo_url,
        isOnline: row.is_available,
        status: row.is_available ? '🟢 Online' : '⚪ Available'
      }));
    } catch (error) {
      logger.error('Error getting featured models with images:', error);
      return [];
    }
  }

  /**
   * Get model gallery images (if implemented in future)
   * @param {number} modelId - Model ID
   * @returns {Promise<Array>} Array of gallery images
   */
  static async getModelGalleryImages(_modelId) {
    // Not yet implemented — callers should handle an empty array gracefully
    return [];
  }

  /**
   * Update model profile image
   * @param {number} modelId - Model ID
   * @param {string} imageUrl - New image URL
   * @returns {Promise<boolean>} Success status
   */
  static async updateModelProfileImage(modelId, imageUrl) {
    try {
      await query(
        `UPDATE performers
         SET photo_url = $2
         WHERE id = $1`,
        [modelId, imageUrl]
      );
      
      logger.info('Model profile image updated', { modelId });
      return true;
    } catch (error) {
      logger.error('Error updating model profile image:', error);
      return false;
    }
  }

  /**
   * Get default placeholder image URL
   * @returns {string} Default placeholder image
   */
  static getDefaultPlaceholderImage() {
    // Self-contained SVG — no external dependency
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect width="300" height="300" fill="#000"/><text x="150" y="160" font-family="sans-serif" font-size="20" fill="#fff" text-anchor="middle">PNP Live</text></svg>')}`;
  }

  /**
   * Get PNP Television Live branding assets
   * @returns {Object} Branding assets
   */
  static getBrandingAssets() {
    return {
      logo: `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="#000"/><text x="100" y="56" font-family="sans-serif" font-size="14" fill="#fff" text-anchor="middle">PNP Latino Live</text></svg>')}`,
      banner: `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="200"><rect width="800" height="200" fill="#000"/><text x="400" y="110" font-family="sans-serif" font-size="24" fill="#fff" text-anchor="middle">Private Shows</text></svg>')}`,
      icon: '📹'
    };
  }

  /**
   * Create media carousel markup for Telegram
   * @param {Array} items - Array of carousel items
   * @param {string} lang - Language code
   * @returns {Object} Telegram markup object
   */
  static createMediaCarousel(items, lang) {
    if (!items || items.length === 0) {
      return null;
    }

    // Create buttons for carousel navigation
    const buttons = [];
    
    // Add featured models
    for (const item of items) {
      const statusEmoji = item.isOnline ? '🟢' : '⚪';
      buttons.push([{
        text: `${item.name} ${statusEmoji}`,
        callback_data: `pnp_select_model_${item.modelId}`
      }]);
    }

    // Add navigation buttons
    buttons.push([
      {
        text: lang === 'es' ? '🔍 Ver Todos' : '🔍 View All',
        callback_data: 'PNP_LIVE_START'
      }
    ]);

    return {
      inline_keyboard: buttons
    };
  }

  /**
   * Create image gallery markup (for future implementation)
   * @param {Array} images - Array of image URLs
   * @returns {Object} Telegram markup object
   */
  static createImageGallery(images) {
    if (!images || images.length === 0) {
      return null;
    }

    // For now, return simple markup
    // Future implementation could use Telegram's media groups
    return {
      inline_keyboard: images.map((img, index) => [{
        text: `📷 Imagen ${index + 1}`,
        url: img
      }])
    };
  }

  /**
   * Get model media stats
   * @param {number} modelId - Model ID
   * @returns {Promise<Object>} Media statistics
   */
  static async getModelMediaStats(modelId) {
    try {
      const result = await query(
        `SELECT
            photo_url IS NOT NULL as has_profile_image,
            (SELECT COUNT(*) FROM pnp_bookings WHERE model_id = $1) as booking_count,
            (SELECT AVG(rating) FROM pnp_feedback WHERE booking_id IN
                (SELECT id FROM pnp_bookings WHERE model_id = $1)) as avg_rating
         FROM performers
         WHERE id = $1`,
        [modelId]
      );
      
      return result.rows?.[0] || {
        has_profile_image: false,
        booking_count: 0,
        avg_rating: 0
      };
    } catch (error) {
      logger.error('Error getting model media stats:', error);
      return {
        has_profile_image: false,
        booking_count: 0,
        avg_rating: 0
      };
    }
  }

  /**
   * Validate image URL
   * @param {string} url - Image URL to validate
   * @returns {boolean} Is valid image URL
   */
  static validateImageUrl(url) {
    if (!url) return false;
    
    // Simple URL validation for images
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    return imageExtensions.some(ext => url.toLowerCase().endsWith(ext));
  }

  /**
   * Get optimized image URL for Telegram
   * @param {string} originalUrl - Original image URL
   * @param {number} width - Desired width
   * @param {number} height - Desired height
   * @returns {string} Optimized image URL
   */
  static getOptimizedImageUrl(originalUrl, width = 300, height = 300) {
    // For now, return original URL
    // Future implementation could use image CDN
    return originalUrl;
  }
}

module.exports = PNPLiveMediaService;
