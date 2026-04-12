'use strict';

const { query } = require('../config/postgres');
const logger = require('../utils/logger');

class MenuConfigModel {
  static TABLE = 'menu_configs';

  static async getAll() {
    const result = await query(
      `SELECT * FROM ${this.TABLE} ORDER BY order_position ASC, name ASC`
    );
    return result.rows;
  }

  static async getById(menuId) {
    const result = await query(
      `SELECT * FROM ${this.TABLE} WHERE id = $1 OR menu_id = $1 LIMIT 1`,
      [menuId]
    );
    return result.rows[0] || null;
  }

  static async getAvailableMenusForTier(planId) {
    const result = await query(
      `SELECT * FROM ${this.TABLE}
       WHERE status = 'active'
         AND ($1 = ANY(allowed_tiers) OR allowed_tiers IS NULL OR array_length(allowed_tiers, 1) IS NULL)
       ORDER BY order_position ASC, name ASC`,
      [planId]
    );
    return result.rows;
  }

  static async isMenuAvailable(menuId, planId) {
    const menu = await this.getById(menuId);
    if (!menu || menu.status !== 'active') return false;
    if (!menu.allowed_tiers || menu.allowed_tiers.length === 0) return true;
    return menu.allowed_tiers.includes(planId);
  }

  static async createOrUpdate(menuId, data) {
    const existing = await this.getById(menuId);
    if (existing) {
      const result = await query(
        `UPDATE ${this.TABLE}
         SET name = COALESCE($2, name),
             name_es = COALESCE($3, name_es),
             parent_id = COALESCE($4, parent_id),
             status = COALESCE($5, status),
             allowed_tiers = COALESCE($6, allowed_tiers),
             order_position = COALESCE($7, order_position),
             icon = COALESCE($8, icon),
             action = COALESCE($9, action),
             type = COALESCE($10, type),
             action_type = COALESCE($11, action_type),
             action_data = COALESCE($12, action_data),
             customizable = COALESCE($13, customizable),
             deletable = COALESCE($14, deletable)
         WHERE id = $1
         RETURNING *`,
        [
          existing.id, data.name, data.name_es, data.parent_id, data.status,
          data.allowed_tiers, data.order_position, data.icon, data.action,
          data.type, data.action_type, data.action_data, data.customizable, data.deletable,
        ]
      );
      return result.rows[0];
    }
    const id = menuId || data.id || require('uuid').v4();
    const result = await query(
      `INSERT INTO ${this.TABLE}
       (id, menu_id, name, name_es, parent_id, status, allowed_tiers, order_position, icon, action, type, action_type, action_data, customizable, deletable)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING *`,
      [
        id, data.menu_id || id, data.name, data.name_es, data.parent_id,
        data.status || 'active', data.allowed_tiers, data.order_position || 0,
        data.icon, data.action, data.type || 'default', data.action_type,
        data.action_data, data.customizable !== false, data.deletable !== false,
      ]
    );
    return result.rows[0];
  }

  static async delete(menuId) {
    const result = await query(
      `DELETE FROM ${this.TABLE} WHERE id = $1 RETURNING *`,
      [menuId]
    );
    return result.rows[0] || null;
  }

  static async reorderMenus(menuIds) {
    const results = [];
    for (let i = 0; i < menuIds.length; i++) {
      const result = await query(
        `UPDATE ${this.TABLE} SET order_position = $2 WHERE id = $1 RETURNING *`,
        [menuIds[i], i]
      );
      if (result.rows[0]) results.push(result.rows[0]);
    }
    return results;
  }

  static async initializeDefaultMenus() {
    const existing = await this.getAll();
    if (existing.length > 0) return existing;
    logger.info('No default menus to initialize');
    return [];
  }
}

module.exports = MenuConfigModel;
