const { query } = require('../config/postgres');
const logger = require('../utils/logger');

class CallPackageModel {
  static async _tableExists(tableName) {
    try {
      const result = await query(
        `SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = $1`,
        [tableName],
        { cache: false }
      );
      return result.rows.length > 0;
    } catch (error) {
      logger.error('Error checking table', { tableName, error: error.message });
      return false;
    }
  }

  static _mapCatalogRow(row) {
    if (!row) return null;
    const price = row.price_cents ? row.price_cents / 100 : Number(row.price || 0);
    const pricePerCall = row.price_per_call_cents
      ? row.price_per_call_cents / 100
      : Number(row.price_per_call || 0);
    const savings = row.savings_cents ? row.savings_cents / 100 : Number(row.savings || 0);
    const savingsPercent = row.savings_percent ? Number(row.savings_percent) : Number(row.savingsPercent || 0);

    return {
      id: row.id,
      name: row.display_name || row.name || 'Call Package',
      calls: Number(row.calls || row.total_calls || 0),
      price,
      pricePerCall,
      savings,
      savingsPercent,
      popular: row.popular || false,
    };
  }

  static async getAvailablePackages() {
    try {
      if (!await this._tableExists('call_packages_catalog')) {
        return [];
      }

      const result = await query(
        `SELECT id, display_name, calls, price_cents, price_per_call_cents, savings_cents, savings_percent, popular
         FROM call_packages_catalog
         ORDER BY calls ASC`,
        []
      );

      return result.rows.map((row) => this._mapCatalogRow(row));
    } catch (error) {
      logger.error('Error loading call packages', { error: error.message });
      return [];
    }
  }

  static async getById(packageId) {
    try {
      if (!await this._tableExists('call_packages_catalog')) return null;

      const result = await query(
        `SELECT id, display_name, calls, price_cents, price_per_call_cents, savings_cents, savings_percent, popular
         FROM call_packages_catalog
         WHERE id = $1
         LIMIT 1`,
        [packageId]
      );

      return this._mapCatalogRow(result.rows[0]);
    } catch (error) {
      logger.error('Error fetching call package', { packageId, error: error.message });
      return null;
    }
  }

  static async getUserPackages(userId) {
    try {
      if (!await this._tableExists('user_call_packages')) return [];

      const result = await query(
        `SELECT
           u.id,
           u.total_calls,
           u.remaining_calls,
           u.used_calls,
           u.expires_at,
           c.display_name
         FROM user_call_packages u
         LEFT JOIN call_packages_catalog c ON c.id = u.package_id
         WHERE u.user_id = $1 AND u.active = true
         ORDER BY u.expires_at ASC`,
        [String(userId)]
      );

      return result.rows.map((row) => ({
        id: row.id,
        packageName: row.display_name || 'Call Package',
        totalCalls: Number(row.total_calls || 0),
        remainingCalls: Number(row.remaining_calls || 0),
        usedCalls: Number(row.used_calls || 0),
        expiresAt: row.expires_at,
      }));
    } catch (error) {
      logger.error('Error loading user call packages', { userId, error: error.message });
      return [];
    }
  }
}

module.exports = CallPackageModel;
