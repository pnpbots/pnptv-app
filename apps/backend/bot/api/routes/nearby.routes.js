/**
 * Nearby Routes
 * Geolocation API endpoints
 *
 * Routes:
 * - POST /api/nearby/update-location - Update user location
 * - GET /api/nearby/search - Search nearby users
 * - GET /api/nearby/stats - Get statistics
 * - POST /api/nearby/clear - Clear user location
 * - POST /api/nearby/batch-update - Batch update (testing)
 */

const express = require('express');
const router = express.Router();

const NearbyController = require('../controllers/nearbyController');
const { authenticateUser } = require('../middleware/auth');
const redisGeoService = require('../../../services/redisGeoService');
const { getRedis } = require('../../../config/redis');

// Initialize redisGeoService with Redis client
const initializeGeoService = async () => {
  try {
    const redisClient = getRedis();
    if (redisClient && !redisGeoService.redis) {
      await redisGeoService.initialize(redisClient);
    }
  } catch (error) {
    console.error('Failed to initialize redisGeoService:', error.message);
  }
};

// Call initialization when route is loaded
initializeGeoService();

// Middleware — all authenticated users can share/clear their location
router.use(authenticateUser);

// All nearby features open to all authenticated users
router.post('/update-location', (req, res) => {
  NearbyController.updateLocation(req, res);
});
router.post('/clear', (req, res) => {
  NearbyController.clearLocation(req, res);
});
router.get('/search', (req, res) => {
  NearbyController.searchNearby(req, res);
});
router.get('/places', (req, res) => {
  NearbyController.searchNearbyPlaces(req, res);
});
router.get('/stats', (req, res) => {
  NearbyController.getStats(req, res);
});

// Place interactions
router.post('/places/:id/favorite', (req, res) => NearbyController.favoritePlace(req, res));
router.post('/places/:id/view', (req, res) => NearbyController.trackView(req, res));
router.post('/places/:id/report', (req, res) => NearbyController.reportPlace(req, res));
router.get('/places/favorites', (req, res) => NearbyController.getFavorites(req, res));

// Batch update locations (admin only)
const requireAdmin = (req, res, next) => {
  const role = (req.user?.role || '').toLowerCase();
  if (role !== 'admin' && role !== 'superadmin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};
router.post('/batch-update', requireAdmin, (req, res) => {
  NearbyController.batchUpdate(req, res);
});

module.exports = router;
