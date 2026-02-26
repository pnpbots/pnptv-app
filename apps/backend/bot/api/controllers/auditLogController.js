const AuditLogService = require('../../services/AuditLogService');
const logger = require('../../../utils/logger');

const auditLogController = {
  async getAuditLogs(req, res) {
    try {
      const { page = 1, limit = 50, actorId, resourceType, action, startDate, endDate } = req.query;

      const offset = (page - 1) * limit;

      const filters = {};
      if (actorId) filters.actorId = parseInt(actorId);
      if (resourceType) filters.resourceType = resourceType;
      if (action) filters.action = action;
      if (startDate) filters.startDate = startDate;
      if (endDate) filters.endDate = endDate;

      const result = await AuditLogService.getAuditLogs(filters, offset, limit);

      res.json({ success: true, data: result });
    } catch (error) {
      logger.error('Error en getAuditLogs:', error);
      res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: error.message }
      });
    }
  },

  async getResourceHistory(req, res) {
    try {
      const { resourceType, resourceId, limit = 50 } = req.query;

      if (!resourceType || !resourceId) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_INPUT', message: 'resourceType y resourceId requeridos' }
        });
      }

      const history = await AuditLogService.getResourceAuditHistory(resourceType, resourceId, limit);

      res.json({ success: true, data: history });
    } catch (error) {
      logger.error('Error en getResourceHistory:', error);
      res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: error.message }
      });
    }
  }
};

module.exports = auditLogController;
