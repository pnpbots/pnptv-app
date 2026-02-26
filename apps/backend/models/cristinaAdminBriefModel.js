const { query } = require('../config/postgres');
const logger = require('../utils/logger');

const TABLE_NAME = 'cristina_admin_briefs';

class CristinaAdminBriefModel {
  static async getAll() {
    try {
      const result = await query(`SELECT key, value FROM ${TABLE_NAME}`);
      const records = {};
      result.rows.forEach((row) => {
        records[row.key] = row.value;
      });
      return records;
    } catch (error) {
      logger.error('Error loading Cristina admin brief records', { error: error.message });
      return {};
    }
  }

  static async upsert({ key, value }) {
    try {
      const sql = `
        INSERT INTO ${TABLE_NAME} (key, value)
        VALUES ($1, $2)
        ON CONFLICT (key)
        DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
      `;
      await query(sql, [key, value]);
      logger.info('Cristina admin brief updated', { key });
    } catch (error) {
      logger.error('Error updating Cristina admin brief', { key, error: error.message });
      throw error;
    }
  }
}

module.exports = CristinaAdminBriefModel;
