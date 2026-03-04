const NearbyPlaceModel = require('../../../models/nearbyPlaceModel');
const NearbyPlaceService = require('../../services/nearbyPlaceService');
const logger = require('../../../utils/logger');

const ITEMS_PER_PAGE = 20;

/**
 * GET /api/webapp/admin/places
 */
const listPlaces = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || '1'));
    const status = req.query.status || null;
    const categoryId = req.query.categoryId ? parseInt(req.query.categoryId) : null;
    const city = req.query.city ? String(req.query.city).trim() : null;
    const search = req.query.search ? String(req.query.search).trim() : null;
    const offset = (page - 1) * ITEMS_PER_PAGE;

    const filters = {};
    if (status) filters.status = status;
    if (categoryId) filters.categoryId = categoryId;
    if (city) filters.city = city;
    if (search) filters.search = search;

    const [places, total] = await Promise.all([
      NearbyPlaceModel.getAll(filters, ITEMS_PER_PAGE, offset),
      NearbyPlaceModel.countAll(filters),
    ]);

    return res.json({
      success: true,
      places,
      pagination: {
        page,
        limit: ITEMS_PER_PAGE,
        total,
        totalPages: Math.ceil(total / ITEMS_PER_PAGE),
      },
    });
  } catch (error) {
    logger.error('Error listing admin places:', error);
    return res.status(500).json({ error: error.message });
  }
};

/**
 * GET /api/webapp/admin/places/stats
 */
const getPlaceStats = async (req, res) => {
  try {
    const stats = await NearbyPlaceModel.getStats();
    return res.json({ success: true, stats: stats || {} });
  } catch (error) {
    logger.error('Error getting place stats:', error);
    return res.status(500).json({ error: error.message });
  }
};

/**
 * POST /api/webapp/admin/places/:id/approve
 */
const approvePlace = async (req, res) => {
  try {
    const { id } = req.params;
    const adminId = req.user?.id || req.session?.user?.id;
    const place = await NearbyPlaceModel.updateStatus(id, 'approved', adminId);
    if (!place) {
      return res.status(404).json({ success: false, error: 'Place not found' });
    }
    logger.info('Admin approved place', { placeId: id, adminId });
    return res.json({ success: true, place });
  } catch (error) {
    logger.error('Error approving place:', error);
    return res.status(500).json({ error: error.message });
  }
};

/**
 * POST /api/webapp/admin/places/:id/reject
 */
const rejectPlace = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const adminId = req.user?.id || req.session?.user?.id;
    const place = await NearbyPlaceModel.updateStatus(id, 'rejected', adminId, reason || null);
    if (!place) {
      return res.status(404).json({ success: false, error: 'Place not found' });
    }
    logger.info('Admin rejected place', { placeId: id, adminId, reason });
    return res.json({ success: true, place });
  } catch (error) {
    logger.error('Error rejecting place:', error);
    return res.status(500).json({ error: error.message });
  }
};

/**
 * POST /api/webapp/admin/places/:id/suspend
 */
const suspendPlace = async (req, res) => {
  try {
    const { id } = req.params;
    const { suspend } = req.body;
    const adminId = req.user?.id || req.session?.user?.id;
    const result = await NearbyPlaceService.toggleSuspend(id, !!suspend, adminId);
    if (!result.success) {
      return res.status(404).json({ success: false, error: result.error || 'Place not found' });
    }
    logger.info(`Admin ${suspend ? 'suspended' : 'unsuspended'} place`, { placeId: id, adminId });
    return res.json({ success: true, place: result.place });
  } catch (error) {
    logger.error('Error suspending place:', error);
    return res.status(500).json({ error: error.message });
  }
};

/**
 * DELETE /api/webapp/admin/places/:id
 */
const deletePlace = async (req, res) => {
  try {
    const { id } = req.params;
    const adminId = req.user?.id || req.session?.user?.id;
    await NearbyPlaceModel.delete(id);
    logger.info('Admin deleted place', { placeId: id, adminId });
    return res.json({ success: true, message: 'Place deleted' });
  } catch (error) {
    logger.error('Error deleting place:', error);
    return res.status(500).json({ error: error.message });
  }
};

module.exports = {
  listPlaces,
  getPlaceStats,
  approvePlace,
  rejectPlace,
  suspendPlace,
  deletePlace,
};
