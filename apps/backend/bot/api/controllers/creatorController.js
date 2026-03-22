const logger = require('../../../utils/logger');
const CreatorService = require('../../services/creatorService');
const { query } = require('../../../config/postgres');
const { hasAccess } = require('../../services/accessService');
const { resolveUserId } = require('../../utils/helpers');

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
    const countResult = await query(
      `SELECT status, COUNT(*)::int as count FROM model_applications GROUP BY status`
    );
    const statusCounts = {};
    for (const r of countResult.rows) statusCounts[r.status] = r.count;
    return res.json({ success: true, applications, statusCounts });
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
    const creatorId = await resolveUserId(req.params.creatorId);
    if (!creatorId) return res.status(404).json({ error: 'Creator not found' });
    const result = await CreatorService.getSubscriptionStatus(req.user.id, creatorId);
    return res.json({ success: true, ...result });
  } catch (err) {
    logger.error('getSubscriptionStatus error', err);
    return res.status(500).json({ error: 'Failed to get subscription status' });
  }
};

// POST /api/webapp/creator/:creatorId/subscribe
const subscribeToCreator = async (req, res) => {
  if (!hasAccess(req.user, 'member')) {
    return res.status(403).json({ error: 'Member subscription required to subscribe to creators' });
  }
  try {
    const creatorId = await resolveUserId(req.params.creatorId);
    if (!creatorId) return res.status(404).json({ error: 'Creator not found' });
    const result = await CreatorService.subscribeToCreator(req.user.id, creatorId, req.body.paymentId);
    return res.json({ success: true, ...result });
  } catch (err) {
    logger.error('subscribeToCreator error', err);
    return res.status(400).json({ error: err.message });
  }
};

// POST /api/webapp/creator/:creatorId/unsubscribe
const unsubscribeFromCreator = async (req, res) => {
  try {
    const creatorId = await resolveUserId(req.params.creatorId);
    if (!creatorId) return res.status(404).json({ error: 'Creator not found' });
    const result = await CreatorService.unsubscribeFromCreator(req.user.id, creatorId);
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
      'SELECT creator_wallet_address, creator_wallet_verified, payout_method, meru_account, creator_payout_chain_id, fiat_payout_method, fiat_payout_account FROM users WHERE id = $1',
      [req.user.id]
    );
    return res.json({
      success: true,
      address: rows[0]?.creator_wallet_address || null,
      verified: rows[0]?.creator_wallet_verified || false,
      payoutMethod: rows[0]?.payout_method || 'crypto',
      meruAccount: rows[0]?.meru_account || null,
      payoutChainId: rows[0]?.creator_payout_chain_id || 10,
      fiatPayoutMethod: rows[0]?.fiat_payout_method || null,
      fiatPayoutAccount: rows[0]?.fiat_payout_account || null,
    });
  } catch (err) {
    logger.error('getWalletAddress error', err);
    return res.status(500).json({ error: 'Failed to get payout info' });
  }
};

// POST /api/webapp/creator/wallet
const saveWalletAddress = async (req, res) => {
  try {
    const { address, payoutMethod, meruAccount, chainId, fiatProvider, fiatAccount } = req.body || {};
    const SUPPORTED_CHAIN_IDS = [10, 8453, 42161, 137, 1];
    const method = payoutMethod === 'meru' ? 'meru' : payoutMethod === 'fiat' ? 'fiat' : 'crypto';

    if (method === 'crypto') {
      if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
        return res.status(400).json({ error: 'Invalid Ethereum wallet address. Must be 0x followed by 40 hex characters.' });
      }
      const resolvedChainId = chainId && SUPPORTED_CHAIN_IDS.includes(Number(chainId)) ? Number(chainId) : 10;
      await query(
        'UPDATE users SET creator_wallet_address = $1, payout_method = $2, meru_account = NULL, creator_payout_chain_id = $3 WHERE id = $4',
        [address.toLowerCase(), 'crypto', resolvedChainId, req.user.id]
      );
    } else if (method === 'fiat') {
      const VALID_FIAT_PROVIDERS = ['venmo', 'cashapp', 'zelle', 'paypal', 'wise', 'revolut'];
      const provider = (fiatProvider || '').trim().toLowerCase();
      const account = (fiatAccount || '').trim();
      if (!VALID_FIAT_PROVIDERS.includes(provider)) {
        return res.status(400).json({ error: 'Invalid fiat provider. Choose venmo, cashapp, zelle, paypal, wise, or revolut.' });
      }
      if (!account || account.length > 200) {
        return res.status(400).json({ error: 'Fiat account handle/email is required (max 200 chars).' });
      }
      await query(
        'UPDATE users SET payout_method = $1, fiat_payout_method = $2, fiat_payout_account = $3, creator_wallet_address = NULL, meru_account = NULL WHERE id = $4',
        ['fiat', provider, account, req.user.id]
      );
    } else {
      const meru = (meruAccount || '').trim();
      if (!meru) {
        return res.status(400).json({ error: 'Meru account (phone number or username) is required.' });
      }
      if (meru.length > 100) {
        return res.status(400).json({ error: 'Meru account too long.' });
      }
      await query(
        'UPDATE users SET payout_method = $1, meru_account = $2, creator_wallet_address = NULL WHERE id = $3',
        ['meru', meru, req.user.id]
      );
    }

    return res.json({ success: true, payoutMethod: method });
  } catch (err) {
    logger.error('saveWalletAddress error', err);
    return res.status(500).json({ error: 'Failed to save payout info' });
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
      `SELECT id, username, first_name, last_name, photo_file_id, creator_type, creator_status,
              creator_strikes, creator_subscriber_count, creator_price_usd, role
       FROM users
       WHERE (creator_status IN ('active', 'suspended', 'pending_review', 'eligible')
          OR role = 'model') AND creator_status IS NOT NULL
       ORDER BY
         CASE creator_status
           WHEN 'active' THEN 0
           WHEN 'pending_review' THEN 1
           WHEN 'eligible' THEN 2
           WHEN 'suspended' THEN 3
           ELSE 4
         END,
         creator_subscriber_count DESC NULLS LAST
       LIMIT 200`
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
    const creatorId = await resolveUserId(req.params.creatorId);
    if (!creatorId) return res.status(404).json({ error: 'Creator not found' });
    const strikes = await CreatorService.getCreatorStrikes(creatorId);
    return res.json({ success: true, strikes });
  } catch (err) {
    logger.error('getStrikes error', err);
    return res.status(500).json({ error: 'Failed to get strikes' });
  }
};

// GET /api/webapp/creator/milestones
// Returns pending milestone notifications for the authenticated user
const getMilestones = async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT id, milestone_type, status, created_at, responded_at, decline_cooldown_until
       FROM creator_milestone_notifications
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 20`,
      [req.user.id]
    );
    return res.json({ success: true, milestones: rows });
  } catch (err) {
    logger.error('getMilestones error', err);
    return res.status(500).json({ error: 'Failed to load milestones' });
  }
};

// POST /api/webapp/creator/milestones/:id/respond
// Body: { response: 'accepted' | 'declined' }
const respondToMilestone = async (req, res) => {
  try {
    const { response } = req.body || {};
    if (!response || !['accepted', 'declined'].includes(response)) {
      return res.status(400).json({ error: "response must be 'accepted' or 'declined'" });
    }
    const result = await CreatorService.respondToMilestone(
      req.user.id,
      req.params.id,
      response
    );
    return res.json({ success: true, ...result });
  } catch (err) {
    const status = err.statusCode || 400;
    logger.error('respondToMilestone error', err);
    return res.status(status).json({ error: err.message });
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
    const creatorId = await resolveUserId(req.params.creatorId);
    if (!creatorId) return res.status(404).json({ error: 'Creator not found' });
    const result = await CreatorService.issueStrike(
      creatorId,
      req.user.id,
      reason.trim()
    );
    return res.json({ success: true, ...result });
  } catch (err) {
    logger.error('issueStrike error', err);
    return res.status(400).json({ error: err.message });
  }
};

const listOwnChannels = async (req, res) => {
  try {
    const result = await query(
      `SELECT * FROM creator_channels WHERE creator_id = $1 AND is_active = true ORDER BY sort_order, created_at`,
      [req.user.id]
    );
    return res.json({ success: true, channels: result.rows });
  } catch (err) {
    logger.error('listOwnChannels error', err);
    return res.status(500).json({ error: 'Failed to list channels' });
  }
};

const createChannel = async (req, res) => {
  try {
    // Verify active creator
    const userRes = await query('SELECT creator_status FROM users WHERE id = $1', [req.user.id]);
    if (!userRes.rows.length || userRes.rows[0].creator_status !== 'active') {
      return res.status(403).json({ error: 'Active creator status required' });
    }

    const { name, description, tags, isPremium } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Channel name is required' });
    }
    const trimmedName = name.trim().slice(0, 100);

    // Generate slug
    let slug = req.body.slug
      ? String(req.body.slug).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
      : trimmedName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    slug = slug.slice(0, 100);

    // Check slug uniqueness, append suffix if taken
    const slugCheck = await query('SELECT id FROM creator_channels WHERE slug = $1', [slug]);
    if (slugCheck.rows.length) {
      slug = `${slug}-${Date.now().toString(36)}`;
    }

    const safeTags = Array.isArray(tags) ? tags.filter(t => typeof t === 'string').map(t => t.trim().slice(0, 50)).slice(0, 10) : [];

    const result = await query(
      `INSERT INTO creator_channels (creator_id, name, slug, description, tags, is_premium)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [req.user.id, trimmedName, slug, (description || '').slice(0, 2000), safeTags, isPremium === true]
    );
    return res.json({ success: true, channel: result.rows[0] });
  } catch (err) {
    logger.error('createChannel error', err);
    return res.status(500).json({ error: 'Failed to create channel' });
  }
};

const updateChannel = async (req, res) => {
  const channelId = parseInt(req.params.id, 10);
  if (!Number.isFinite(channelId)) return res.status(400).json({ error: 'Invalid channel ID' });

  try {
    // Verify ownership
    const chRes = await query('SELECT * FROM creator_channels WHERE id = $1 AND is_active = true', [channelId]);
    if (!chRes.rows.length || chRes.rows[0].creator_id !== req.user.id) {
      return res.status(404).json({ error: 'Channel not found or not yours' });
    }

    const updates = [];
    const params = [];
    let idx = 1;

    const { name, slug, description, coverImageUrl, tags, isPremium, sortOrder } = req.body;
    if (name !== undefined) { updates.push(`name = $${idx++}`); params.push(String(name).trim().slice(0, 100)); }
    if (slug !== undefined) {
      const cleanSlug = String(slug).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 100);
      const slugCheck = await query('SELECT id FROM creator_channels WHERE slug = $1 AND id != $2', [cleanSlug, channelId]);
      if (slugCheck.rows.length) return res.status(400).json({ error: 'Slug already taken' });
      updates.push(`slug = $${idx++}`); params.push(cleanSlug);
    }
    if (description !== undefined) { updates.push(`description = $${idx++}`); params.push(String(description).slice(0, 2000)); }
    if (coverImageUrl !== undefined) { updates.push(`cover_image_url = $${idx++}`); params.push(coverImageUrl); }
    if (tags !== undefined) {
      const safeTags = Array.isArray(tags) ? tags.filter(t => typeof t === 'string').map(t => t.trim().slice(0, 50)).slice(0, 10) : [];
      updates.push(`tags = $${idx++}`); params.push(safeTags);
    }
    if (isPremium !== undefined) { updates.push(`is_premium = $${idx++}`); params.push(isPremium === true); }
    if (sortOrder !== undefined) { updates.push(`sort_order = $${idx++}`); params.push(parseInt(sortOrder, 10) || 0); }

    if (!updates.length) return res.status(400).json({ error: 'No fields to update' });

    updates.push(`updated_at = NOW()`);
    params.push(channelId);
    const result = await query(
      `UPDATE creator_channels SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
      params
    );
    return res.json({ success: true, channel: result.rows[0] });
  } catch (err) {
    logger.error('updateChannel error', err);
    return res.status(500).json({ error: 'Failed to update channel' });
  }
};

const deleteChannel = async (req, res) => {
  const channelId = parseInt(req.params.id, 10);
  if (!Number.isFinite(channelId)) return res.status(400).json({ error: 'Invalid channel ID' });

  try {
    const result = await query(
      'UPDATE creator_channels SET is_active = false, updated_at = NOW() WHERE id = $1 AND creator_id = $2 AND is_active = true RETURNING id',
      [channelId, req.user.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Channel not found or not yours' });

    // Unassign posts from this channel
    await query('UPDATE social_posts SET channel_id = NULL WHERE channel_id = $1', [channelId]);

    return res.json({ success: true });
  } catch (err) {
    logger.error('deleteChannel error', err);
    return res.status(500).json({ error: 'Failed to delete channel' });
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
  getMilestones,
  respondToMilestone,
  listOwnChannels,
  createChannel,
  updateChannel,
  deleteChannel,
};
