const { getPool } = require('../config/postgres');
const logger = require('../utils/logger');

const auditLog = async (req, res, next) => {
  req.auditLog = async (action, resourceType, resourceId, oldValue = null, newValue = null, metadata = {}) => {
    try {
      if (!req.session || !req.session.user) return;

      const query = `
        INSERT INTO audit_logs (actor_id, action, resource_type, resource_id, old_value, new_value, metadata, ip_address, user_agent, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)
      `;

      const ipAddress = req.ip || 'unknown';
      const userAgent = req.headers['user-agent'] || 'unknown';

      await getPool().query(query, [
        req.session.user.id,
        action,
        resourceType,
        resourceId,
        oldValue ? JSON.stringify(oldValue) : null,
        newValue ? JSON.stringify(newValue) : null,
        JSON.stringify(metadata),
        ipAddress,
        userAgent
      ]);
    } catch (error) {
      logger.error('Error logging audit:', error);
    }
  };

  next();
};

module.exports = {
  auditLog
};
