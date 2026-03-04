'use strict';

const CanvaService = require('../../services/canvaService');
const logger = require('../../../utils/logger');

const ITEMS_PER_PAGE = 20;

/**
 * GET /api/webapp/admin/canva/stats
 */
const getCanvaStats = async (req, res) => {
  try {
    const stats = await CanvaService.getCanvaStats();
    return res.json({ success: true, stats });
  } catch (error) {
    logger.error('Error getting Canva stats:', error);
    return res.status(500).json({ error: error.message });
  }
};

/**
 * GET /api/webapp/admin/canva/users
 */
const getConnectedUsers = async (req, res) => {
  try {
    const users = await CanvaService.getConnectedUsers();
    return res.json({ success: true, users });
  } catch (error) {
    logger.error('Error listing Canva users:', error);
    return res.status(500).json({ error: error.message });
  }
};

/**
 * POST /api/webapp/admin/canva/users/:id/unlink
 */
const unlinkUser = async (req, res) => {
  try {
    const { id } = req.params;
    await CanvaService.forceUnlinkUser(id);
    logger.info('Admin force-unlinked Canva user', {
      targetUserId: id,
      adminId: req.session?.user?.id,
      adminUsername: req.session?.user?.username,
    });
    return res.json({ success: true, message: 'User Canva account unlinked' });
  } catch (error) {
    logger.error('Error unlinking Canva user:', error);
    return res.status(500).json({ error: error.message });
  }
};

/**
 * GET /api/webapp/admin/canva/jobs
 */
const listJobs = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || '1'));
    const status = req.query.status || null;
    const limit = ITEMS_PER_PAGE;
    const offset = (page - 1) * limit;

    const { jobs, total } = await CanvaService.getAllExportJobs(offset, limit, status);

    return res.json({
      success: true,
      jobs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    logger.error('Error listing Canva jobs:', error);
    return res.status(500).json({ error: error.message });
  }
};

/**
 * POST /api/webapp/admin/canva/jobs/:id/retry
 */
const retryJob = async (req, res) => {
  try {
    const { id } = req.params;
    await CanvaService.retryExportJob(id);
    logger.info('Admin retried Canva export job', {
      jobId: id,
      adminId: req.session?.user?.id,
      adminUsername: req.session?.user?.username,
    });
    return res.json({ success: true, message: 'Job queued for retry' });
  } catch (error) {
    logger.error('Error retrying Canva job:', error);
    return res.status(500).json({ error: error.message });
  }
};

/**
 * POST /api/webapp/admin/canva/jobs/:id/cancel
 */
const cancelJob = async (req, res) => {
  try {
    const { id } = req.params;
    await CanvaService.cancelExportJob(id);
    logger.info('Admin cancelled Canva export job', {
      jobId: id,
      adminId: req.session?.user?.id,
      adminUsername: req.session?.user?.username,
    });
    return res.json({ success: true, message: 'Job cancelled' });
  } catch (error) {
    logger.error('Error cancelling Canva job:', error);
    return res.status(500).json({ error: error.message });
  }
};

module.exports = {
  getCanvaStats,
  getConnectedUsers,
  unlinkUser,
  listJobs,
  retryJob,
  cancelJob,
};
