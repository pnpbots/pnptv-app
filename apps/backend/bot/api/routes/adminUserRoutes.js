const express = require('express');
const AdminUserController = require('../controllers/adminUserController');
const { verifyAdminJWT } = require('../middleware/jwtAuth');
const PermissionService = require('../../services/permissionService');

const router = express.Router();

/**
 * Admin User Management Routes
 * All routes require admin authentication via middleware (session admin or admin JWT)
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
    return res.status(500).json({ success: false, error: 'Authorization check failed' });
  }
};

router.use(requireAdminAccess);

// Search users
router.get('/search', AdminUserController.searchUsers);

// Get user details
router.get('/:userId', AdminUserController.getUser);

// Update user (username, email, subscription, tier)
router.put('/:userId', AdminUserController.updateUser);

// Ban/Unban user
router.post('/:userId/ban', AdminUserController.toggleBan);

// Send direct message via customer service
router.post('/:userId/send-message', AdminUserController.sendDirectMessage);

module.exports = router;
