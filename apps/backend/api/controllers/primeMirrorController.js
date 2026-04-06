'use strict';

const { query } = require('../../config/postgres');
const logger = require('../../utils/logger');

class PrimeMirrorController {
  /**
   * GET /api/admin/prime-mirror/status
   * Returns mirror status, total migrated, breakdown by status
   */
  static async getStatus(req, res) {
    try {
      const [settingResult, countResult, lastResult] = await Promise.all([
        query("SELECT value FROM app_settings WHERE key = 'prime_channel_mirror_enabled'"),
        query(`SELECT status, COUNT(*)::int as count FROM prime_channel_migration_log GROUP BY status`),
        query(`SELECT MAX(message_id) as last_id FROM prime_channel_migration_log WHERE status = 'success'`),
      ]);

      const enabled = settingResult.rows[0]?.value === 'true';
      const countByStatus = {};
      let totalAttempted = 0;
      for (const row of countResult.rows) {
        countByStatus[row.status] = row.count;
        totalAttempted += row.count;
      }

      res.json({
        success: true,
        data: {
          enabled,
          totalMigratedPosts: countByStatus.success || 0,
          lastMigratedMessageId: lastResult.rows[0]?.last_id || null,
          countByStatus,
          totalAttempted,
        },
      });
    } catch (error) {
      logger.error('Error in getStatus:', error);
      res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to get mirror status' } });
    }
  }

  /**
   * POST /api/admin/prime-mirror/toggle
   * Toggles the mirror on/off
   */
  static async toggleMirror(req, res) {
    try {
      const { rows } = await query("SELECT value FROM app_settings WHERE key = 'prime_channel_mirror_enabled'");
      const currentValue = rows[0]?.value === 'true';
      const newValue = !currentValue;

      await query(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES ('prime_channel_mirror_enabled', $1, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
        [String(newValue)]
      );

      logger.info(`[PrimeMirror] Mirror toggled to ${newValue} by admin ${req.session?.user?.id}`);

      res.json({
        success: true,
        data: { enabled: newValue },
      });
    } catch (error) {
      logger.error('Error in toggleMirror:', error);
      res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to toggle mirror' } });
    }
  }

  /**
   * GET /api/admin/prime-mirror/log?page=1&limit=50
   * Returns paginated migration log entries
   */
  static async getMigrationLog(req, res) {
    try {
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
      const offset = (page - 1) * limit;
      const statusFilter = req.query.status || null;

      const params = [limit, offset];
      let whereClause = '';
      if (statusFilter) {
        whereClause = 'WHERE status = $3';
        params.push(statusFilter);
      }

      const [logResult, countResult] = await Promise.all([
        query(
          `SELECT message_id, status, post_id, media_type, error_msg, attempted_at
           FROM prime_channel_migration_log ${whereClause}
           ORDER BY message_id DESC
           LIMIT $1 OFFSET $2`,
          params
        ),
        query(
          `SELECT COUNT(*)::int as total FROM prime_channel_migration_log ${whereClause}`,
          statusFilter ? [statusFilter] : []
        ),
      ]);

      res.json({
        success: true,
        data: {
          entries: logResult.rows,
          total: countResult.rows[0]?.total || 0,
          page,
          limit,
        },
      });
    } catch (error) {
      logger.error('Error in getMigrationLog:', error);
      res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to get migration log' } });
    }
  }
}

module.exports = PrimeMirrorController;
