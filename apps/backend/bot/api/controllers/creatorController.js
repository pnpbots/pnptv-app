const logger = require('../../../utils/logger');
const CreatorService = require('../../services/creatorService');

// GET /api/webapp/creator/eligibility
const getEligibility = async (req, res) => {
  try {
    const result = await CreatorService.checkEligibility(req.user.id);
    return res.json({ success: true, ...result });
  } catch (err) {
    logger.error('getEligibility error', err);
    return res.status(500).json({ error: 'Failed to check eligibility' });
  }
};

// POST /api/webapp/creator/activate
const activateCreator = async (req, res) => {
  try {
    const { tier, termsAccepted } = req.body || {};
    const result = await CreatorService.activateCreator(req.user.id, tier, termsAccepted);
    // Update session role so model routes work immediately without re-login
    if (req.session?.user) {
      req.session.user.role = 'model';
    }
    return res.json({ success: true, ...result });
  } catch (err) {
    logger.error('activateCreator error', err);
    return res.status(400).json({ error: err.message });
  }
};

// GET /api/webapp/creator/dashboard
const getDashboard = async (req, res) => {
  try {
    const result = await CreatorService.getCreatorDashboard(req.user.id);
    return res.json({ success: true, ...result });
  } catch (err) {
    logger.error('getDashboard error', err);
    return res.status(500).json({ error: 'Failed to load dashboard' });
  }
};

// GET /api/webapp/creator/applications
// Protected at route level by roleGuard('admin', 'superadmin')
const listApplications = async (req, res) => {
  try {
    const applications = await CreatorService.listApplications(req.query.status || null);
    return res.json({ success: true, applications });
  } catch (err) {
    logger.error('listApplications error', err);
    return res.status(500).json({ error: 'Failed to list applications' });
  }
};

// POST /api/webapp/creator/applications/:id/approve
// Protected at route level by roleGuard('admin', 'superadmin')
const approveApplication = async (req, res) => {
  try {
    const result = await CreatorService.approveApplication(
      req.params.id,
      req.user.id,
      req.body.notes || null
    );
    return res.json({ success: true, ...result });
  } catch (err) {
    logger.error('approveApplication error', err);
    return res.status(400).json({ error: err.message });
  }
};

// POST /api/webapp/creator/applications/:id/reject
// Protected at route level by roleGuard('admin', 'superadmin')
const rejectApplication = async (req, res) => {
  try {
    const result = await CreatorService.rejectApplication(
      req.params.id,
      req.user.id,
      req.body.notes || null
    );
    return res.json({ success: true, ...result });
  } catch (err) {
    logger.error('rejectApplication error', err);
    return res.status(400).json({ error: err.message });
  }
};

// GET /api/webapp/creator/:creatorId/subscription-status
const getSubscriptionStatus = async (req, res) => {
  try {
    const result = await CreatorService.getSubscriptionStatus(req.user.id, req.params.creatorId);
    return res.json({ success: true, ...result });
  } catch (err) {
    logger.error('getSubscriptionStatus error', err);
    return res.status(500).json({ error: 'Failed to get subscription status' });
  }
};

// POST /api/webapp/creator/:creatorId/subscribe
const subscribeToCreator = async (req, res) => {
  const userTier = (req.user.tier || '').toLowerCase();
  const isAdminRole = req.user.role === 'admin' || req.user.role === 'superadmin';
  if (userTier !== 'prime' && !isAdminRole) {
    return res.status(403).json({ error: 'PRIME subscription required to subscribe to creators' });
  }
  try {
    const result = await CreatorService.subscribeToCreator(req.user.id, req.params.creatorId, req.body.paymentId);
    return res.json({ success: true, ...result });
  } catch (err) {
    logger.error('subscribeToCreator error', err);
    return res.status(400).json({ error: err.message });
  }
};

// POST /api/webapp/creator/:creatorId/unsubscribe
const unsubscribeFromCreator = async (req, res) => {
  try {
    const result = await CreatorService.unsubscribeFromCreator(req.user.id, req.params.creatorId);
    return res.json({ success: true, ...result });
  } catch (err) {
    logger.error('unsubscribeFromCreator error', err);
    return res.status(400).json({ error: err.message });
  }
};

module.exports = {
  getEligibility,
  activateCreator,
  getDashboard,
  listApplications,
  approveApplication,
  rejectApplication,
  getSubscriptionStatus,
  subscribeToCreator,
  unsubscribeFromCreator,
};
