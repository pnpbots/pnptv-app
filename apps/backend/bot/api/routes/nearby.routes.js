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

// Middleware
router.use(authenticateUser);

// Tier gate — only prime users can access Nearby
const requirePrimeTier = (req, res, next) => {
  const tier = (req.user?.tier || 'free').toLowerCase();
  if (tier !== 'prime') {
    return res.status(403).json({
      error: 'Prime subscription required',
      code: 'PRIME_REQUIRED'
    });
  }
  next();
};
router.use(requirePrimeTier);

// Update user location
router.post('/update-location', (req, res) => {
  NearbyController.updateLocation(req, res);
});

// Search nearby users
router.get('/search', (req, res) => {
  NearbyController.searchNearby(req, res);
});

// Get statistics
router.get('/stats', (req, res) => {
  NearbyController.getStats(req, res);
});

// Clear user location (go offline)
router.post('/clear', (req, res) => {
  NearbyController.clearLocation(req, res);
});

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
