const express = require('express');
const UserManagementController = require('../controllers/userManagementController');
const { verifyAdminJWT } = require('../middleware/jwtAuth');
const PermissionService = require('../../services/permissionService');

const router = express.Router();

/**
 * User Management Routes
 * Endpoints for managing user subscriptions
 * Admin-only access (session admin or admin JWT)
 */

const requireAdminAccess = async (req, res, next) => {
  try {
    const sessionUser = req.session?.user;
    if (sessionUser?.id) {
      const role = String(sessionUser.role || '').toLowerCase();
      if (role === 'admin' || role === 'superadmin') {
        req.user = sessionUser;
        return next();
      }

      const isAdmin = await PermissionService.isAdmin(sessionUser.id);
      if (isAdmin) {
        req.user = sessionUser;
        return next();
      }
    }

    return verifyAdminJWT(req, res, next);
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: 'Authorization check failed',
    });
  }
};

router.use(requireAdminAccess);

// Get user subscription status
router.get('/:userId/status', UserManagementController.getStatus);

// Downgrade user from PRIME to FREE
router.post('/:userId/downgrade', UserManagementController.downgradeToFree);

// Upgrade user to PRIME
router.post('/:userId/upgrade-prime', UserManagementController.upgradeToPrime);

// Reset subscription status
router.post('/:userId/reset-subscription', UserManagementController.resetSubscription);

// Manually activate a payment
router.post('/:userId/activate-payment', UserManagementController.activatePayment);

module.exports = router;
