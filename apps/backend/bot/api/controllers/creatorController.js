const logger = require('../../../utils/logger');
const CreatorService = require('../../services/creatorService');
const { query } = require('../../../config/postgres');

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
    if (req.session?.user?.role !== undefined) {
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

// GET /api/webapp/creator/wallet
const getWalletAddress = async (req, res) => {
  try {
    const { rows } = await query(
      'SELECT creator_wallet_address, creator_wallet_verified FROM users WHERE id = $1',
      [req.user.id]
    );
    return res.json({
      success: true,
      address: rows[0]?.creator_wallet_address || null,
      verified: rows[0]?.creator_wallet_verified || false,
    });
  } catch (err) {
    logger.error('getWalletAddress error', err);
    return res.status(500).json({ error: 'Failed to get wallet address' });
  }
};

// POST /api/webapp/creator/wallet
const saveWalletAddress = async (req, res) => {
  try {
    const { address } = req.body || {};
    if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
      return res.status(400).json({ error: 'Invalid Ethereum wallet address. Must be 0x followed by 40 hex characters.' });
    }
    await query(
      'UPDATE users SET creator_wallet_address = $1 WHERE id = $2',
      [address.toLowerCase(), req.user.id]
    );
    return res.json({ success: true });
  } catch (err) {
    logger.error('saveWalletAddress error', err);
    return res.status(500).json({ error: 'Failed to save wallet address' });
  }
};

// POST /api/webapp/creator/change-tier
const changeTier = async (req, res) => {
  try {
    const { tier } = req.body || {};
    const validTiers = { ice: 5.00, crystal: 10.00, diamond: 15.00 };
    if (!tier || !validTiers[tier]) {
      return res.status(400).json({ error: 'Invalid tier. Choose ice, crystal, or diamond.' });
    }

    const userRes = await query(
      'SELECT creator_status, creator_type FROM users WHERE id = $1',
      [req.user.id]
    );
    const user = userRes.rows[0];
    if (!user || user.creator_status !== 'active') {
      return res.status(403).json({ error: 'Creator profile not active' });
    }
    if (user.creator_type === tier) {
      return res.status(400).json({ error: 'Already on this tier' });
    }

    await query(
      'UPDATE users SET creator_type = $1, creator_price_usd = $2 WHERE id = $3',
      [tier, validTiers[tier], req.user.id]
    );
    return res.json({ success: true, tier, price: validTiers[tier] });
  } catch (err) {
    logger.error('changeTier error', err);
    return res.status(500).json({ error: 'Failed to change tier' });
  }
};

// POST /api/webapp/creator/enroll
const submitEnrollment = async (req, res) => {
  try {
    const { tier, paymentMethod, paymentAddress, paymentNetwork, signatureData } = req.body || {};
    const idDocumentPath = req.file
      ? `/uploads/creator-enrollments/${req.file.filename}`
      : null;
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || null;
    const result = await CreatorService.submitEnrollment(
      req.user.id,
      { tier, paymentMethod, paymentAddress, paymentNetwork, signatureData },
      idDocumentPath,
      ip
    );
    return res.json({ success: true, ...result });
  } catch (err) {
    logger.error('submitEnrollment error', err);
    return res.status(400).json({ error: err.message });
  }
};

// GET /api/webapp/creator/enrollment
const getEnrollment = async (req, res) => {
  try {
    const enrollment = await CreatorService.getEnrollment(req.user.id);
    return res.json({ success: true, enrollment });
  } catch (err) {
    logger.error('getEnrollment error', err);
    return res.status(500).json({ error: 'Failed to get enrollment' });
  }
};

// GET /api/webapp/creator/enrollments (admin)
const listEnrollments = async (req, res) => {
  try {
    const enrollments = await CreatorService.listEnrollments(req.query.status || null);
    return res.json({ success: true, enrollments });
  } catch (err) {
    logger.error('listEnrollments error', err);
    return res.status(500).json({ error: 'Failed to list enrollments' });
  }
};

// POST /api/webapp/creator/enrollments/:id/approve (admin)
const approveEnrollment = async (req, res) => {
  try {
    const result = await CreatorService.approveEnrollment(
      req.params.id, req.user.id, req.body.notes || null
    );
    return res.json({ success: true, ...result });
  } catch (err) {
    logger.error('approveEnrollment error', err);
    return res.status(400).json({ error: err.message });
  }
};

// POST /api/webapp/creator/enrollments/:id/reject (admin)
const rejectEnrollment = async (req, res) => {
  try {
    const result = await CreatorService.rejectEnrollment(
      req.params.id, req.user.id, req.body.notes || null
    );
    return res.json({ success: true, ...result });
  } catch (err) {
    logger.error('rejectEnrollment error', err);
    return res.status(400).json({ error: err.message });
  }
};

// GET /api/webapp/creator/active
// Protected at route level by roleGuard('admin', 'superadmin')
const listActiveCreators = async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT id, username, first_name, last_name, photo_url, creator_type, creator_status,
              creator_strikes, creator_subscriber_count, creator_price_usd
       FROM users
       WHERE creator_status IN ('active', 'suspended')
       ORDER BY creator_subscriber_count DESC NULLS LAST
       LIMIT 100`
    );
    return res.json({ success: true, creators: rows });
  } catch (err) {
    logger.error('listActiveCreators error', err);
    return res.status(500).json({ error: 'Failed to list active creators' });
  }
};

// GET /api/webapp/creator/:creatorId/strikes
// Protected at route level by roleGuard('admin', 'superadmin')
const getStrikes = async (req, res) => {
  try {
    const strikes = await CreatorService.getCreatorStrikes(req.params.creatorId);
    return res.json({ success: true, strikes });
  } catch (err) {
    logger.error('getStrikes error', err);
    return res.status(500).json({ error: 'Failed to get strikes' });
  }
};

// POST /api/webapp/creator/:creatorId/strike
// Protected at route level by roleGuard('admin', 'superadmin')
const issueStrike = async (req, res) => {
  const { reason } = req.body || {};
  if (!reason?.trim()) {
    return res.status(400).json({ error: 'Reason is required' });
  }
  try {
    const result = await CreatorService.issueStrike(
      req.params.creatorId,
      req.user.id,
      reason.trim()
    );
    return res.json({ success: true, ...result });
  } catch (err) {
    logger.error('issueStrike error', err);
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
  getWalletAddress,
  saveWalletAddress,
  changeTier,
  listActiveCreators,
  getStrikes,
  issueStrike,
  submitEnrollment,
  getEnrollment,
  listEnrollments,
  approveEnrollment,
  rejectEnrollment,
};
