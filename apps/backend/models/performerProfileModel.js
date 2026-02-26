const { query } = require('../config/postgres');
const logger = require('../utils/logger');

const TABLE = 'performer_profiles';

class PerformerProfileModel {
  static async create(userId) {
    try {
      const sql = `
        INSERT INTO ${TABLE} (user_id)
        VALUES ($1)
        ON CONFLICT (user_id) DO NOTHING
        RETURNING *
      `;
      const result = await query(sql, [userId]);
      return result.rows[0];
    } catch (error) {
      logger.error('Error creating performer profile:', error);
      throw error;
    }
  }

  static async getByUserId(userId) {
    try {
      const result = await query(`SELECT * FROM ${TABLE} WHERE user_id = $1`, [userId]);
      return result.rows[0];
    } catch (error) {
      logger.error('Error getting performer profile:', error);
      return null;
    }
  }

  static async update(userId, updates) {
    try {
      const setClauses = ['updated_at = NOW()'];
      const values = [userId];
      let paramIndex = 2;

      const fieldMap = {
        bio: 'bio',
        photos: 'photos',
        videos: 'videos',
        tags: 'tags',
        rates: 'rates',
      };

      for (const [key, col] of Object.entries(fieldMap)) {
        if (updates[key] !== undefined) {
          setClauses.push(`${col} = $${paramIndex++}`);
          values.push(updates[key]);
        }
      }

      await query(`UPDATE ${TABLE} SET ${setClauses.join(', ')} WHERE user_id = $1`, values);
      return true;
    } catch (error) {
      logger.error('Error updating performer profile:', error);
      return false;
    }
  }
}

module.exports = PerformerProfileModel;
