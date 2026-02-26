const logger = require('../../utils/logger');
const { query } = require('../../config/postgres');

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
        `SELECT profile_image_url FROM pnp_models WHERE id = $1`,
        [modelId]
      );
      
      return result.rows?.[0]?.profile_image_url || null;
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
        `SELECT id, name, profile_image_url 
         FROM pnp_models 
         WHERE id = ANY($1) AND profile_image_url IS NOT NULL
         ORDER BY is_online DESC, name ASC`,
        [modelIds]
      );
      
      return result.rows.map(row => ({
        modelId: row.id,
        name: row.name,
        imageUrl: row.profile_image_url
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
        `SELECT id, name, profile_image_url, is_online 
         FROM pnp_models 
         WHERE is_active = TRUE 
         AND profile_image_url IS NOT NULL
         ORDER BY is_online DESC, last_online DESC NULLS LAST, name ASC
         LIMIT $1`,
        [limit]
      );
      
      return result.rows.map(row => ({
        modelId: row.id,
        name: row.name,
        imageUrl: row.profile_image_url,
        isOnline: row.is_online,
        status: row.is_online ? '🟢 Online' : '⚪ Available'
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
  static async getModelGalleryImages(modelId) {
    // Future implementation for model galleries
    // For now, return empty array
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
        `UPDATE pnp_models 
         SET profile_image_url = $2, updated_at = NOW()
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
    return 'https://via.placeholder.com/300x300/000000/FFFFFF?text=PNP+Live';
  }

  /**
   * Get PNP Television Live branding assets
   * @returns {Object} Branding assets
   */
  static getBrandingAssets() {
    return {
      logo: 'https://via.placeholder.com/200x100/000000/FFFFFF?text=PNP+Latino+Live',
      banner: 'https://via.placeholder.com/800x200/000000/FFFFFF?text=Private+Shows+📹',
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
            profile_image_url IS NOT NULL as has_profile_image,
            (SELECT COUNT(*) FROM pnp_bookings WHERE model_id = $1) as booking_count,
            (SELECT AVG(rating) FROM pnp_feedback WHERE booking_id IN 
                (SELECT id FROM pnp_bookings WHERE model_id = $1)) as avg_rating
         FROM pnp_models 
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
