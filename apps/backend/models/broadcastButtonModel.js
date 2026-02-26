/**
 * Broadcast Button Model
 * Manages custom buttons and CTAs for broadcasts
 */

const { getPool } = require('../config/postgres');
const logger = require('../utils/logger');

class BroadcastButtonModel {
  /**
   * Initialize broadcast buttons tables
   */
  static async initializeTables() {
    const client = await getPool().connect();
    try {
      // Create presets table
      await client.query(`
        CREATE TABLE IF NOT EXISTS broadcast_button_presets (
          preset_id SERIAL PRIMARY KEY,
          name VARCHAR(100) NOT NULL UNIQUE,
          description TEXT,
          icon VARCHAR(10),
          buttons JSONB NOT NULL,
          enabled BOOLEAN DEFAULT true,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Create buttons table
      await client.query(`
        CREATE TABLE IF NOT EXISTS broadcast_buttons (
          button_id SERIAL PRIMARY KEY,
          broadcast_id UUID NOT NULL REFERENCES broadcasts(id) ON DELETE CASCADE,
          preset_id INT REFERENCES broadcast_button_presets(preset_id),
          button_text VARCHAR(255) NOT NULL,
          button_type VARCHAR(50) NOT NULL,
          button_target VARCHAR(500),
          button_order INT NOT NULL DEFAULT 0,
          button_icon VARCHAR(10),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Create indexes
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_broadcast_buttons_broadcast_id
        ON broadcast_buttons(broadcast_id)
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_broadcast_buttons_preset_id
        ON broadcast_buttons(preset_id)
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_broadcast_button_presets_enabled
        ON broadcast_button_presets(enabled)
      `);

      // Insert default presets with translation keys
      await client.query(`
        INSERT INTO broadcast_button_presets (name, description, icon, buttons, enabled) VALUES
        ('Plans Promo', 'Link to subscription plans page', '💎', $1::jsonb, true),
        ('Premium Offer', 'Direct link to premium plan', '⭐', $2::jsonb, true),
        ('Support & Share', 'Support link and share option', '🆘', $3::jsonb, true),
        ('Features Showcase', 'Link to app features', '✨', $4::jsonb, true),
        ('Community Links', 'Community engagement buttons', '👥', $5::jsonb, true),
        ('Engagement Full', 'All engagement options', '🎯', $6::jsonb, true)
        ON CONFLICT (name) DO NOTHING
      `, [
        '[{"text":"💎 View Plans","translationKey":"broadcast_button_plans","type":"command","target":"/plans"}]',
        '[{"text":"⭐ Get Premium","translationKey":"broadcast_button_premium","type":"plan","target":"premium"}]',
        '[{"text":"🆘 Get Help","translationKey":"broadcast_button_help","type":"command","target":"/support"},{"text":"📢 Share","translationKey":"broadcast_button_share","type":"command","target":"/share"}]',
        '[{"text":"✨ Explore Features","translationKey":"broadcast_button_features","type":"command","target":"/features"}]',
        '[{"text":"👥 Join Community","translationKey":"broadcast_button_community","type":"url","target":"https://t.me/pnptv_community"},{"text":"📣 Channel","translationKey":"broadcast_button_channel","type":"url","target":"https://t.me/pnptv_channel"}]',
        '[{"text":"💎 Plans","translationKey":"broadcast_button_plans","type":"command","target":"/plans"},{"text":"🆘 Support","translationKey":"broadcast_button_support","type":"command","target":"/support"},{"text":"📢 Share","translationKey":"broadcast_button_share","type":"command","target":"/share"}]'
      ]);

      logger.info('✓ Broadcast buttons tables initialized');
    } catch (error) {
      logger.error('Error initializing broadcast buttons tables:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get all available button presets
   */
  static async getAllPresets() {
    try {
      const result = await getPool().query(`
        SELECT preset_id, name, description, icon, buttons
        FROM broadcast_button_presets
        WHERE enabled = true
        ORDER BY name
      `);
      return result.rows;
    } catch (error) {
      // If table doesn't exist in production yet, create it and retry once.
      if (error && error.code === '42P01') {
        logger.warn('broadcast_button_presets missing; initializing tables');
        try {
          await this.initializeTables();
          const result = await getPool().query(`
            SELECT preset_id, name, description, icon, buttons
            FROM broadcast_button_presets
            WHERE enabled = true
            ORDER BY name
          `);
          return result.rows;
        } catch (initError) {
          logger.error('Failed to initialize broadcast buttons tables, continuing without presets:', initError);
          return [];
        }
      }
      logger.error('Error getting button presets:', error);
      throw error;
    }
  }

  /**
   * Get preset by ID
   */
  static async getPresetById(presetId) {
    try {
      const result = await getPool().query(`
        SELECT preset_id, name, description, icon, buttons
        FROM broadcast_button_presets
        WHERE preset_id = $1 AND enabled = true
      `, [presetId]);
      return result.rows[0] || null;
    } catch (error) {
      if (error && error.code === '42P01') {
        logger.warn('broadcast_button_presets missing; initializing tables');
        try {
          await this.initializeTables();
          const result = await getPool().query(`
            SELECT preset_id, name, description, icon, buttons
            FROM broadcast_button_presets
            WHERE preset_id = $1 AND enabled = true
          `, [presetId]);
          return result.rows[0] || null;
        } catch (initError) {
          logger.error('Failed to initialize broadcast buttons tables, continuing without preset:', initError);
          return null;
        }
      }
      logger.error('Error getting preset:', error);
      throw error;
    }
  }

  /**
   * Add buttons to a broadcast
   */
  static async addButtonsToBroadcast(broadcastId, buttons) {
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');

      // Delete existing buttons for this broadcast
      await client.query(
        'DELETE FROM broadcast_buttons WHERE broadcast_id = $1',
        [broadcastId]
      );

      // Insert new buttons
      for (let i = 0; i < buttons.length; i++) {
        const button = buttons[i];
        await client.query(`
          INSERT INTO broadcast_buttons
          (broadcast_id, preset_id, button_text, button_type, button_target, button_order, button_icon)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [
          broadcastId,
          button.presetId || null,
          button.text,
          button.type,
          button.target,
          i,
          button.icon || null
        ]);
      }

      await client.query('COMMIT');
      logger.info('Buttons added to broadcast:', { broadcastId, count: buttons.length });
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error adding buttons to broadcast:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get buttons for a broadcast
   */
  static async getButtonsForBroadcast(broadcastId) {
    try {
      const result = await getPool().query(`
        SELECT
          button_id,
          button_text,
          button_type,
          button_target,
          button_order,
          button_icon
        FROM broadcast_buttons
        WHERE broadcast_id = $1
        ORDER BY button_order ASC
      `, [broadcastId]);
      return result.rows;
    } catch (error) {
      logger.error('Error getting broadcast buttons:', error);
      throw error;
    }
  }

  /**
   * Delete buttons from a broadcast
   */
  static async deleteButtonsFromBroadcast(broadcastId) {
    try {
      await getPool().query(
        'DELETE FROM broadcast_buttons WHERE broadcast_id = $1',
        [broadcastId]
      );
      logger.info('Buttons deleted from broadcast:', { broadcastId });
    } catch (error) {
      logger.error('Error deleting broadcast buttons:', error);
      throw error;
    }
  }

  /**
   * Update a button
   */
  static async updateButton(buttonId, updates) {
    try {
      const result = await getPool().query(`
        UPDATE broadcast_buttons
        SET
          button_text = COALESCE($2, button_text),
          button_type = COALESCE($3, button_type),
          button_target = COALESCE($4, button_target),
          button_icon = COALESCE($5, button_icon),
          updated_at = CURRENT_TIMESTAMP
        WHERE button_id = $1
        RETURNING *
      `, [
        buttonId,
        updates.text || null,
        updates.type || null,
        updates.target || null,
        updates.icon || null
      ]);
      return result.rows[0];
    } catch (error) {
      logger.error('Error updating button:', error);
      throw error;
    }
  }
}

module.exports = BroadcastButtonModel;
