const { getPool } = require('../../config/postgres');
const logger = require('../../utils/logger');

class AuditLogService {
  async getAuditLogs(filters = {}, offset = 0, limit = 50) {
    let query = `
      SELECT al.id, al.action, al.resource_type, al.resource_id, al.old_value, al.new_value,
             al.metadata, al.ip_address, al.user_agent, al.created_at,
             u.email as actor_email, u.username as actor_username
      FROM audit_logs al
      JOIN users u ON al.actor_id = u.id
      WHERE 1=1
    `;

    const params = [];
    let paramCount = 1;

    if (filters.actorId) {
      query += ` AND al.actor_id = $${paramCount}`;
      params.push(filters.actorId);
      paramCount++;
    }

    if (filters.resourceType) {
      query += ` AND al.resource_type = $${paramCount}`;
      params.push(filters.resourceType);
      paramCount++;
    }

    if (filters.action) {
      query += ` AND al.action = $${paramCount}`;
      params.push(filters.action);
      paramCount++;
    }

    if (filters.startDate) {
      query += ` AND al.created_at >= $${paramCount}`;
      params.push(filters.startDate);
      paramCount++;
    }

    if (filters.endDate) {
      query += ` AND al.created_at <= $${paramCount}`;
      params.push(filters.endDate);
      paramCount++;
    }

    query += ` ORDER BY al.created_at DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
    params.push(limit, offset);

    const result = await getPool().query(query, params);

    // Get total count
    let countQuery = `SELECT COUNT(*) as count FROM audit_logs WHERE 1=1`;
    const countParams = [];
    let countParamCount = 1;

    if (filters.actorId) {
      countQuery += ` AND actor_id = $${countParamCount}`;
      countParams.push(filters.actorId);
      countParamCount++;
    }

    if (filters.resourceType) {
      countQuery += ` AND resource_type = $${countParamCount}`;
      countParams.push(filters.resourceType);
      countParamCount++;
    }

    if (filters.action) {
      countQuery += ` AND action = $${countParamCount}`;
      countParams.push(filters.action);
      countParamCount++;
    }

    if (filters.startDate) {
      countQuery += ` AND created_at >= $${countParamCount}`;
      countParams.push(filters.startDate);
      countParamCount++;
    }

    if (filters.endDate) {
      countQuery += ` AND created_at <= $${countParamCount}`;
      countParams.push(filters.endDate);
      countParamCount++;
    }

    const countResult = await getPool().query(countQuery, countParams);

    return {
      logs: result.rows,
      total: parseInt(countResult.rows[0].count),
      offset,
      limit
    };
  }

  async getResourceAuditHistory(resourceType, resourceId, limit = 50) {
    const query = `
      SELECT al.id, al.action, al.old_value, al.new_value, al.metadata, al.created_at,
             u.email as actor_email, u.username as actor_username
      FROM audit_logs al
      JOIN users u ON al.actor_id = u.id
      WHERE al.resource_type = $1 AND al.resource_id = $2
      ORDER BY al.created_at DESC
      LIMIT $3
    `;

    const result = await getPool().query(query, [resourceType, resourceId, limit]);
    return result.rows;
  }

  async cleanupOldLogs(retentionDays = 90) {
    const query = `
      DELETE FROM audit_logs
      WHERE created_at < NOW() - INTERVAL '${retentionDays} days'
    `;

    try {
      const result = await getPool().query(query);
      logger.info(`Cleaned up ${result.rowCount} old audit logs`);
      return result.rowCount;
    } catch (error) {
      logger.error('Error cleaning up audit logs:', error);
      throw error;
    }
  }
}

module.exports = new AuditLogService();
