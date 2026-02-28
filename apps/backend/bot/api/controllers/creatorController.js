const logger = require('../../../utils/logger');
const CreatorService = require('../../services/creatorService');

const authGuard = (req, res) => {
  const user = req.session?.user;
  if (!user) { res.status(401).json({ error: 'Not authenticated' }); return null; }
  return user;
};

const adminGuard = (req, res) => {
  const user = authGuard(req, res);
  if (!user) return null;
  if (user.role !== 'admin' && user.role !== 'superadmin') {
    res.status(403).json({ error: 'Admin access required' });
    return null;
  }
  return user;
};

// GET /api/webapp/creator/eligibility
const getEligibility = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  try {
    const result = await CreatorService.checkEligibility(user.id);
    return res.json({ success: true, ...result });
  } catch (err) {
    logger.error('getEligibility error', err);
    return res.status(500).json({ error: 'Failed to check eligibility' });
  }
};

// POST /api/webapp/creator/activate
const activateCreator = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  try {
    const result = await CreatorService.activateCreator(user.id);
    return res.json({ success: true, ...result });
  } catch (err) {
    logger.error('activateCreator error', err);
    return res.status(400).json({ error: err.message });
  }
};

// Full-time applications use /api/apply (existing model_applications flow)

// GET /api/webapp/creator/dashboard
const getDashboard = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  try {
    const result = await CreatorService.getCreatorDashboard(user.id);
    return res.json({ success: true, ...result });
  } catch (err) {
    logger.error('getDashboard error', err);
    return res.status(500).json({ error: 'Failed to load dashboard' });
  }
};

// GET /api/webapp/creator/applications
const listApplications = async (req, res) => {
  const user = adminGuard(req, res); if (!user) return;
  try {
    const applications = await CreatorService.listApplications(req.query.status);
    return res.json({ success: true, applications });
  } catch (err) {
    logger.error('listApplications error', err);
    return res.status(500).json({ error: 'Failed to list applications' });
  }
};

// POST /api/webapp/creator/applications/:id/approve
const approveApplication = async (req, res) => {
  const user = adminGuard(req, res); if (!user) return;
  try {
    const result = await CreatorService.approveApplication(req.params.id, user.id, req.body.notes);
    return res.json({ success: true, ...result });
  } catch (err) {
    logger.error('approveApplication error', err);
    return res.status(400).json({ error: err.message });
  }
};

// POST /api/webapp/creator/applications/:id/reject
const rejectApplication = async (req, res) => {
  const user = adminGuard(req, res); if (!user) return;
  try {
    const result = await CreatorService.rejectApplication(req.params.id, user.id, req.body.notes);
    return res.json({ success: true, ...result });
  } catch (err) {
    logger.error('rejectApplication error', err);
    return res.status(400).json({ error: err.message });
  }
};

// GET /api/webapp/creator/:creatorId/subscription-status
const getSubscriptionStatus = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  try {
    const result = await CreatorService.getSubscriptionStatus(user.id, req.params.creatorId);
    return res.json({ success: true, ...result });
  } catch (err) {
    logger.error('getSubscriptionStatus error', err);
    return res.status(500).json({ error: 'Failed to get subscription status' });
  }
};

// POST /api/webapp/creator/:creatorId/subscribe
const subscribeToCreator = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  // Check PRIME status
  if (user.subscription_status !== 'active' && user.subscriptionStatus !== 'active') {
    return res.status(403).json({ error: 'PRIME subscription required to subscribe to creators' });
  }
  try {
    const result = await CreatorService.subscribeToCreator(user.id, req.params.creatorId, req.body.paymentId);
    return res.json({ success: true, ...result });
  } catch (err) {
    logger.error('subscribeToCreator error', err);
    return res.status(400).json({ error: err.message });
  }
};

// POST /api/webapp/creator/:creatorId/unsubscribe
const unsubscribeFromCreator = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  try {
    const result = await CreatorService.unsubscribeFromCreator(user.id, req.params.creatorId);
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
