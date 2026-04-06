const { query } = require('../config/postgres');
const logger = require('../utils/logger');

/**
 * Model Service - Manages models for PNP Television Live system
 */
class ModelService {
  static TABLE = 'performers';

  /**
   * Create a new model
   * @param {Object} modelData - Model data
   * @returns {Promise<Object>} Created model
   */
  static async createModel(modelData) {
    try {
      const { name, bio, profile_image_url, is_active = true, base_price = 0 } = modelData;
      const status = is_active ? 'active' : 'inactive';

      const result = await query(
        `INSERT INTO ${ModelService.TABLE} (display_name, bio, photo_url, status, base_price)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [name, bio, profile_image_url, status, base_price]
      );

      const model = result.rows && result.rows[0];
      logger.info('Model created successfully', { modelId: model?.id, name });
      return model;
    } catch (error) {
      logger.error('Error creating model:', error);
      throw new Error('Failed to create model');
    }
  }

  /**
   * Get model by ID
   * @param {number} modelId - Model ID
   * @returns {Promise<Object|null>} Model or null if not found
   */
  static async getModelById(modelId) {
    try {
      const result = await query(
        `SELECT * FROM ${ModelService.TABLE} WHERE id = $1`,
        [modelId]
      );

      return result.rows && result.rows.length > 0 ? result.rows[0] : null;
    } catch (error) {
      logger.error('Error getting model by ID:', error);
      throw new Error('Failed to get model');
    }
  }

  /**
   * Get model by username
   * @param {string} username - Model username
   * @returns {Promise<Object|null>} Model or null if not found
   */
  static async getModelByUsername(username) {
    try {
      const result = await query(
        `SELECT * FROM ${ModelService.TABLE} WHERE display_name = $1`,
        [username]
      );

      return result.rows && result.rows.length > 0 ? result.rows[0] : null;
    } catch (error) {
      logger.error('Error getting model by username:', error);
      throw new Error('Failed to get model');
    }
  }

  /**
   * Get all active models
   * @returns {Promise<Array>} Array of active models
   */
  static async getAllActiveModels() {
    try {
      const result = await query(
        `SELECT * FROM ${ModelService.TABLE} WHERE status = 'active' ORDER BY display_name`
      );

      return result.rows || [];
    } catch (error) {
      logger.error('Error getting active models:', error);
      throw new Error('Failed to get active models');
    }
  }

  /**
   * Update model
   * @param {number} modelId - Model ID
   * @param {Object} updateData - Data to update
   * @returns {Promise<Object>} Updated model
   */
  static async updateModel(modelId, updateData) {
    try {
      const { name, bio, profile_image_url, is_active } = updateData;
      const status = is_active !== undefined ? (is_active ? 'active' : 'inactive') : undefined;

      const result = await query(
        `UPDATE ${ModelService.TABLE}
         SET display_name = COALESCE($1, display_name),
             bio = COALESCE($2, bio),
             photo_url = COALESCE($3, photo_url),
             status = COALESCE($4, status)
         WHERE id = $5
         RETURNING *`,
        [name, bio, profile_image_url, status, modelId]
      );

      if (!result.rows || result.rows.length === 0) {
        throw new Error('Model not found');
      }

      logger.info('Model updated successfully', { modelId });
      return result.rows[0];
    } catch (error) {
      logger.error('Error updating model:', error);
      throw new Error('Failed to update model');
    }
  }

  /**
   * Get model by user ID
   * @param {number} userId - User ID
   * @returns {Promise<Object|null>} Model or null if not found
   */
  static async getModelByUserId(userId) {
    try {
      const result = await query(
        `SELECT m.* FROM ${ModelService.TABLE} m
         WHERE m.user_id = $1`,
        [userId]
      );

      return result.rows && result.rows.length > 0 ? result.rows[0] : null;
    } catch (error) {
      logger.error('Error getting model by user ID:', error);
      throw new Error('Failed to get model');
    }
  }

  /**
   * Update model online status
   * @param {number} modelId - Model ID
   * @param {boolean} isOnline - Online status
   * @returns {Promise<Object>} Updated model
   */
  static async updateModelStatus(modelId, isOnline) {
    try {
      const result = await query(
        `UPDATE ${ModelService.TABLE}
         SET is_available = $1
         WHERE id = $2
         RETURNING *`,
        [isOnline, modelId]
      );

      if (!result.rows || result.rows.length === 0) {
        throw new Error('Model not found');
      }

      logger.info(`Model status updated to ${isOnline ? 'online' : 'offline'}`, { modelId });
      return result.rows[0];
    } catch (error) {
      logger.error('Error updating model status:', error);
      throw new Error('Failed to update model status');
    }
  }

  /**
   * Delete model (soft delete - mark as inactive)
   * @param {number} modelId - Model ID
   * @returns {Promise<boolean>} True if successful
   */
  static async deleteModel(modelId) {
    try {
      const result = await query(
        `UPDATE ${ModelService.TABLE}
         SET status = 'inactive'
         WHERE id = $1
         RETURNING id`,
        [modelId]
      );

      if (!result.rows || result.rows.length === 0) {
        throw new Error('Model not found');
      }

      logger.info('Model deleted successfully', { modelId });
      return true;
    } catch (error) {
      logger.error('Error deleting model:', error);
      throw new Error('Failed to delete model');
    }
  }

  /**
   * Get models with availability
   * @param {Date} startDate - Start date for availability
   * @param {Date} endDate - End date for availability
   * @returns {Promise<Array>} Models with availability
   */
  static async getModelsWithAvailability(startDate, endDate) {
    try {
      const result = await query(
        `SELECT m.*,
                COUNT(ma.id) AS available_slots
         FROM models m
         LEFT JOIN model_availability ma
           ON m.id = ma.model_id
           AND ma.is_booked = FALSE
           AND ma.available_from >= $1
           AND ma.available_to <= $2
         WHERE m.is_active = TRUE
         GROUP BY m.id
         HAVING COUNT(ma.id) > 0
         ORDER BY m.name`,
        [startDate, endDate]
      );

      return result.rows || [];
    } catch (error) {
      logger.error('Error getting models with availability:', error);
      throw new Error('Failed to get models with availability');
    }
  }
}

module.exports = ModelService;