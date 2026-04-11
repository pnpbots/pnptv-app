const logger = require('../../utils/logger');
const CreatorService = require('../../services/creatorService');
const { query, getPool } = require('../../config/postgres');
const { hasAccess } = require('../../services/accessService');
const { resolveUserId } = require('../../utils/helpers');
const XAutoCampaignService = require('../../services/xAutoCampaignService');
const { uploadBufferToCreatorFolder } = require('./cmsCreatorController');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_GROK_MODES = new Set(['xPost', 'broadcast', 'salesPost']);
const VALID_LANGUAGES = new Set(['en', 'es', 'bilingual']);

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
      `SELECT id, creator_id, name, slug, description, tags, is_premium, access_type, price_usd, hangout_group_id,
              cover_image_url, collaborators, telegram_channel_id, bridge_enabled, sort_order, post_count, created_at, updated_at
       FROM creator_channels
       WHERE is_active = true AND (creator_id = $1 OR $1 = ANY(collaborators))
       ORDER BY sort_order, created_at`,
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

    const { name, description, tags, isPremium, collaborators, telegramChannelId, bridgeEnabled,
            accessType: rawAccessType, priceUsd: rawPriceUsd, linkedHangoutGroupId } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Channel name is required' });
    }
    const trimmedName = name.trim().slice(0, 100);

    // Validate accessType
    const VALID_ACCESS_TYPES = ['free', 'prime', 'subscription', 'paid'];
    const accessType = VALID_ACCESS_TYPES.includes(rawAccessType) ? rawAccessType : 'free';

    // Validate priceUsd
    const VALID_PAID_PRICES = [5, 10, 15, 20, 25];
    let priceUsd = 0;
    if (accessType === 'paid') {
      const parsed = Number(rawPriceUsd);
      if (!VALID_PAID_PRICES.includes(parsed)) {
        return res.status(400).json({ error: 'Price must be one of $5, $10, $15, $20, $25 for paid channels' });
      }
      priceUsd = parsed;
    }

    // Validate and sanitize telegramChannelId
    let safeTelegramChannelId = null;
    if (telegramChannelId && typeof telegramChannelId === 'string') {
      const tgId = telegramChannelId.trim().slice(0, 50);
      if (tgId && !(/^(-100\d+|@[a-zA-Z][a-zA-Z0-9_]{3,})$/.test(tgId))) {
        return res.status(400).json({ error: 'Invalid Telegram channel ID. Use numeric ID (e.g. -1001234567890) or @username.' });
      }
      if (tgId) {
        const dupCheck = await query(
          `SELECT id FROM creator_channels WHERE telegram_channel_id = $1 AND is_active = true`,
          [tgId]
        );
        if (dupCheck.rows.length) {
          return res.status(409).json({ error: 'This Telegram channel is already linked to another app channel.' });
        }
        safeTelegramChannelId = tgId;
      }
    }
    const safeBridgeEnabled = safeTelegramChannelId ? (bridgeEnabled === true) : false;

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

    // Validate collaborators: must be active creators, no more than 10
    let safeCollaborators = [];
    if (Array.isArray(collaborators) && collaborators.length > 0) {
      const collabIds = collaborators.map(id => String(id)).filter(Boolean).slice(0, 10);
      if (collabIds.length > 0) {
        const collabRes = await query(
          `SELECT id::text FROM users WHERE id::text = ANY($1) AND creator_status = 'active'`,
          [collabIds]
        );
        safeCollaborators = collabRes.rows.map(r => r.id);
      }
    }

    // is_premium kept for backward compat: true when accessType is 'subscription'
    const isPremiumValue = accessType === 'subscription' || isPremium === true;

    const result = await query(
      `INSERT INTO creator_channels (creator_id, name, slug, description, tags, is_premium, access_type, price_usd, collaborators, telegram_channel_id, bridge_enabled)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [req.user.id, trimmedName, slug, (description || '').slice(0, 2000), safeTags, isPremiumValue, accessType, priceUsd, safeCollaborators, safeTelegramChannelId, safeBridgeEnabled]
    );

    const newChannel = result.rows[0];

    // Link hangout group if requested
    if (linkedHangoutGroupId) {
      const hangoutId = parseInt(linkedHangoutGroupId, 10);
      if (Number.isFinite(hangoutId)) {
        try {
          // Verify hangout exists, is owned by this user, and is not already linked
          const hangoutRes = await query(
            `SELECT id, creator_id, channel_id FROM hangout_groups WHERE id = $1`,
            [hangoutId]
          );
          if (hangoutRes.rows.length === 0) {
            logger.warn(`createChannel: hangout ${hangoutId} not found, skipping link`);
          } else if (String(hangoutRes.rows[0].creator_id) !== String(req.user.id)) {
            logger.warn(`createChannel: hangout ${hangoutId} not owned by user ${req.user.id}, skipping link`);
          } else if (hangoutRes.rows[0].channel_id !== null) {
            logger.warn(`createChannel: hangout ${hangoutId} already linked to channel ${hangoutRes.rows[0].channel_id}, skipping`);
          } else {
            await Promise.all([
              query(`UPDATE hangout_groups SET channel_id = $1 WHERE id = $2`, [newChannel.id, hangoutId]),
              query(`UPDATE creator_channels SET hangout_group_id = $1 WHERE id = $2`, [hangoutId, newChannel.id]),
            ]);
            newChannel.hangout_group_id = hangoutId;
          }
        } catch (linkErr) {
          logger.error('createChannel: hangout link failed (non-fatal)', linkErr);
        }
      }
    }

    return res.json({ success: true, channel: newChannel });
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

    const { name, slug, description, coverImageUrl, tags, isPremium, sortOrder, collaborators,
            telegramChannelId, bridgeEnabled,
            accessType: rawAccessType, priceUsd: rawPriceUsd, linkedHangoutGroupId } = req.body;

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
    if (sortOrder !== undefined) { updates.push(`sort_order = $${idx++}`); params.push(parseInt(sortOrder, 10) || 0); }
    if (collaborators !== undefined) {
      // Only channel owner can update the full collaborators list; validate each is an active creator
      if (chRes.rows[0].creator_id !== req.user.id) {
        return res.status(403).json({ error: 'Only the channel owner can update collaborators' });
      }
      let safeCollaborators = [];
      if (Array.isArray(collaborators) && collaborators.length > 0) {
        const collabIds = collaborators.map(id => String(id)).filter(Boolean).slice(0, 10);
        if (collabIds.length > 0) {
          const collabRes = await query(
            `SELECT id::text FROM users WHERE id::text = ANY($1) AND creator_status = 'active'`,
            [collabIds]
          );
          safeCollaborators = collabRes.rows.map(r => r.id);
        }
      }
      updates.push(`collaborators = $${idx++}`); params.push(safeCollaborators);
    }
    if (telegramChannelId !== undefined) {
      if (telegramChannelId === null || telegramChannelId === '') {
        // Unlink Telegram channel
        updates.push(`telegram_channel_id = $${idx++}`); params.push(null);
        updates.push(`bridge_enabled = $${idx++}`); params.push(false);
      } else {
        const tgId = String(telegramChannelId).trim().slice(0, 50);
        if (!(/^(-100\d+|@[a-zA-Z][a-zA-Z0-9_]{3,})$/.test(tgId))) {
          return res.status(400).json({ error: 'Invalid Telegram channel ID. Use numeric ID (e.g. -1001234567890) or @username.' });
        }
        const dupCheck = await query(
          `SELECT id FROM creator_channels WHERE telegram_channel_id = $1 AND is_active = true AND id != $2`,
          [tgId, channelId]
        );
        if (dupCheck.rows.length) {
          return res.status(409).json({ error: 'This Telegram channel is already linked to another app channel.' });
        }
        updates.push(`telegram_channel_id = $${idx++}`); params.push(tgId);
      }
    }
    if (bridgeEnabled !== undefined) {
      updates.push(`bridge_enabled = $${idx++}`); params.push(bridgeEnabled === true);
    }

    // Validate and apply accessType + priceUsd
    const VALID_ACCESS_TYPES = ['free', 'prime', 'subscription', 'paid'];
    const VALID_PAID_PRICES = [5, 10, 15, 20, 25];
    if (rawAccessType !== undefined) {
      if (!VALID_ACCESS_TYPES.includes(rawAccessType)) {
        return res.status(400).json({ error: 'Invalid access type. Must be one of: free, prime, subscription, paid' });
      }
      let newPriceUsd = 0;
      if (rawAccessType === 'paid') {
        const parsed = Number(rawPriceUsd);
        if (!VALID_PAID_PRICES.includes(parsed)) {
          return res.status(400).json({ error: 'Price must be one of $5, $10, $15, $20, $25 for paid channels' });
        }
        newPriceUsd = parsed;
      } else if (rawPriceUsd !== undefined) {
        // Non-paid type — price must be 0
        newPriceUsd = 0;
      }
      updates.push(`access_type = $${idx++}`); params.push(rawAccessType);
      updates.push(`price_usd = $${idx++}`); params.push(newPriceUsd);
      // Keep is_premium in sync for backward compat
      updates.push(`is_premium = $${idx++}`); params.push(rawAccessType === 'subscription');
    } else if (isPremium !== undefined) {
      // Legacy isPremium field — still supported
      updates.push(`is_premium = $${idx++}`); params.push(isPremium === true);
      if (isPremium === true) {
        // Sync access_type to subscription
        updates.push(`access_type = $${idx++}`); params.push('subscription');
      }
    }

    if (!updates.length) return res.status(400).json({ error: 'No fields to update' });

    updates.push(`updated_at = NOW()`);
    params.push(channelId);
    const result = await query(
      `UPDATE creator_channels SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
      params
    );
    const updatedChannel = result.rows[0];

    // Handle hangout group link/unlink
    if (linkedHangoutGroupId !== undefined) {
      const currentLinkedId = chRes.rows[0].hangout_group_id;
      if (linkedHangoutGroupId === null || linkedHangoutGroupId === '') {
        // Unlink: clear both sides
        if (currentLinkedId) {
          await Promise.all([
            query(`UPDATE hangout_groups SET channel_id = NULL WHERE id = $1 AND channel_id = $2`, [currentLinkedId, channelId]),
            query(`UPDATE creator_channels SET hangout_group_id = NULL WHERE id = $1`, [channelId]),
          ]);
          updatedChannel.hangout_group_id = null;
        }
      } else {
        const newHangoutId = parseInt(linkedHangoutGroupId, 10);
        if (!Number.isFinite(newHangoutId)) {
          return res.status(400).json({ error: 'Invalid linkedHangoutGroupId' });
        }
        // Verify new hangout: exists, owned by same user, not already linked to another channel
        const hangoutRes = await query(
          `SELECT id, creator_id, channel_id FROM hangout_groups WHERE id = $1`,
          [newHangoutId]
        );
        if (!hangoutRes.rows.length) return res.status(404).json({ error: 'Hangout group not found' });
        if (String(hangoutRes.rows[0].creator_id) !== String(req.user.id)) {
          return res.status(403).json({ error: 'You do not own that hangout group' });
        }
        if (hangoutRes.rows[0].channel_id !== null && hangoutRes.rows[0].channel_id !== channelId) {
          return res.status(409).json({ error: 'That hangout is already linked to another channel' });
        }
        // Clear old link if switching
        if (currentLinkedId && currentLinkedId !== newHangoutId) {
          await query(`UPDATE hangout_groups SET channel_id = NULL WHERE id = $1`, [currentLinkedId]);
        }
        await Promise.all([
          query(`UPDATE hangout_groups SET channel_id = $1 WHERE id = $2`, [channelId, newHangoutId]),
          query(`UPDATE creator_channels SET hangout_group_id = $1 WHERE id = $2`, [newHangoutId, channelId]),
        ]);
        updatedChannel.hangout_group_id = newHangoutId;
      }
    }

    return res.json({ success: true, channel: updatedChannel });
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

const addCollaborator = async (req, res) => {
  const channelId = parseInt(req.params.id, 10);
  if (!Number.isFinite(channelId)) return res.status(400).json({ error: 'Invalid channel ID' });
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId is required' });

  try {
    // Only the channel owner can add collaborators
    const chRes = await query('SELECT creator_id, collaborators FROM creator_channels WHERE id = $1 AND is_active = true', [channelId]);
    if (!chRes.rows.length || chRes.rows[0].creator_id !== req.user.id) {
      return res.status(404).json({ error: 'Channel not found or not yours' });
    }

    // Verify the target user is an active creator
    const userRes = await query('SELECT creator_status FROM users WHERE id::text = $1 OR id = $2', [String(userId), parseInt(userId, 10) || -1]);
    if (!userRes.rows.length || userRes.rows[0].creator_status !== 'active') {
      return res.status(400).json({ error: 'User is not an active creator' });
    }

    await query(
      `UPDATE creator_channels
       SET collaborators = array_append(collaborators, $1), updated_at = NOW()
       WHERE id = $2 AND NOT ($1 = ANY(collaborators))`,
      [String(userId), channelId]
    );
    const updated = await query('SELECT * FROM creator_channels WHERE id = $1', [channelId]);
    return res.json({ success: true, channel: updated.rows[0] });
  } catch (err) {
    logger.error('addCollaborator error', err);
    return res.status(500).json({ error: 'Failed to add collaborator' });
  }
};

const removeCollaborator = async (req, res) => {
  const channelId = parseInt(req.params.id, 10);
  if (!Number.isFinite(channelId)) return res.status(400).json({ error: 'Invalid channel ID' });
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId is required' });

  try {
    // Only the channel owner can remove collaborators
    const chRes = await query('SELECT creator_id FROM creator_channels WHERE id = $1 AND is_active = true', [channelId]);
    if (!chRes.rows.length || chRes.rows[0].creator_id !== req.user.id) {
      return res.status(404).json({ error: 'Channel not found or not yours' });
    }

    await query(
      `UPDATE creator_channels
       SET collaborators = array_remove(collaborators, $1), updated_at = NOW()
       WHERE id = $2`,
      [String(userId), channelId]
    );
    const updated = await query('SELECT * FROM creator_channels WHERE id = $1', [channelId]);
    return res.json({ success: true, channel: updated.rows[0] });
  } catch (err) {
    logger.error('removeCollaborator error', err);
    return res.status(500).json({ error: 'Failed to remove collaborator' });
  }
};

// GET /api/creator/subscribers
const getMySubscribers = async (req, res) => {
  try {
    const creatorId = req.session?.user?.id;
    const page = Math.max(1, parseInt(req.query.page || '1'));
    const limit = 20;
    const offset = (page - 1) * limit;

    // Stats
    const statsResult = await query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'active') as active_count,
        COUNT(*) as total_count,
        COUNT(*) FILTER (WHERE started_at >= date_trunc('month', NOW())) as new_this_month,
        COUNT(*) FILTER (WHERE status IN ('expired', 'cancelled') AND started_at >= NOW() - interval '30 days') as churned_recent,
        COUNT(*) FILTER (WHERE started_at < NOW() - interval '30 days') as base_for_churn
      FROM creator_subscriptions WHERE creator_id = $1
    `, [creatorId]);
    const s = statsResult.rows[0];
    const churnRate = Number(s.base_for_churn) > 0 ? Math.round((Number(s.churned_recent) / Number(s.base_for_churn)) * 100) : 0;

    // Paginated list
    const subsResult = await query(`
      SELECT cs.id, cs.status, cs.started_at, cs.expires_at, cs.price_usd, cs.auto_renew,
             u.username as subscriber_username, u.first_name as subscriber_first_name, u.photo_file_id as subscriber_avatar,
             COALESCE(SUM(ce.amount_creator), 0)::numeric as revenue
      FROM creator_subscriptions cs
      JOIN users u ON u.id = cs.subscriber_id
      LEFT JOIN creator_earnings ce ON ce.subscription_id = cs.id
      WHERE cs.creator_id = $1
      GROUP BY cs.id, u.id
      ORDER BY cs.started_at DESC
      LIMIT $2 OFFSET $3
    `, [creatorId, limit, offset]);

    const totalResult = await query('SELECT COUNT(*) FROM creator_subscriptions WHERE creator_id = $1', [creatorId]);
    const total = parseInt(totalResult.rows[0].count);

    return res.json({
      success: true,
      subscribers: subsResult.rows,
      stats: {
        active_count: Number(s.active_count),
        total_count: Number(s.total_count),
        new_this_month: Number(s.new_this_month),
        churn_rate: churnRate,
      },
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    logger.error('getMySubscribers error', err);
    return res.status(500).json({ error: 'Failed to load subscribers' });
  }
};

// GET /api/creator/consents
const getMyConsents = async (req, res) => {
  try {
    const userId = req.session?.user?.id;
    const result = await query(`
      SELECT terms_accepted, privacy_accepted, age_verified, age_verified_at,
             wof_photo_consent, content_disclaimer, content_disclaimer_accepted_at,
             created_at
      FROM users WHERE id = $1
    `, [userId]);
    if (!result.rows[0]) return res.status(404).json({ error: 'User not found' });
    return res.json({ success: true, consents: result.rows[0] });
  } catch (err) {
    logger.error('getMyConsents error', err);
    return res.status(500).json({ error: 'Failed to load consents' });
  }
};

// GET /api/creator/x-account
const getMyXAccount = async (req, res) => {
  try {
    const userId = req.session?.user?.id;
    const result = await query(`
      SELECT account_id, handle, display_name FROM x_accounts
      WHERE created_by = $1 AND is_active = TRUE LIMIT 1
    `, [String(userId)]);
    return res.json({ success: true, account: result.rows[0] || null });
  } catch (err) {
    logger.error('getMyXAccount error', err);
    return res.status(500).json({ error: 'Failed to load X account' });
  }
};

const CREATOR_CAMPAIGN_LIMIT = 2;

// GET /api/creator/x-campaigns
const getMyXCampaigns = async (req, res) => {
  try {
    const creatorId = String(req.session?.user?.id);
    const result = await query(`
      SELECT c.*, a.handle, a.display_name as account_display_name
      FROM x_auto_campaigns c
      LEFT JOIN x_accounts a ON a.account_id = c.account_id
      WHERE c.created_by = $1
      ORDER BY c.created_at DESC
      LIMIT 10
    `, [creatorId]);
    return res.json({ success: true, campaigns: result.rows, campaignLimit: CREATOR_CAMPAIGN_LIMIT });
  } catch (err) {
    logger.error('getMyXCampaigns error', err);
    return res.status(500).json({ error: 'Failed to load campaigns' });
  }
};

// POST /api/creator/x-campaigns
const createMyXCampaign = async (req, res) => {
  try {
    const creatorId = String(req.session?.user?.id);
    const creatorUsername = req.session?.user?.username;

    // Validate required fields
    const { accountId, name, topic, grokMode, language, intervalMinutes, activeHoursStart, activeHoursEnd } = req.body;
    if (!name || !accountId || !topic) {
      return res.status(400).json({ error: 'name, accountId, and topic are required' });
    }
    if (String(name).length > 200) return res.status(400).json({ error: 'name too long (max 200 chars)' });
    if (String(topic).length > 2000) return res.status(400).json({ error: 'topic too long (max 2000 chars)' });
    if (grokMode && !VALID_GROK_MODES.has(grokMode)) return res.status(400).json({ error: 'Invalid grokMode' });
    if (language && !VALID_LANGUAGES.has(language)) return res.status(400).json({ error: 'Invalid language' });
    const safeStart = Math.max(0, Math.min(23, Number(activeHoursStart) || 9));
    const safeEnd = Math.max(0, Math.min(23, Number(activeHoursEnd) || 22));

    // Verify account ownership
    const acctResult = await query('SELECT 1 FROM x_accounts WHERE account_id = $1 AND created_by = $2 AND is_active = TRUE', [accountId, creatorId]);
    if (acctResult.rows.length === 0) {
      return res.status(403).json({ error: 'X account not found or not yours' });
    }

    // Enforce campaign limit with advisory lock to prevent TOCTOU race
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [creatorId]);
      const countResult = await client.query(
        "SELECT COUNT(*) FROM x_auto_campaigns WHERE created_by = $1 AND status != 'completed'",
        [creatorId]
      );
      if (parseInt(countResult.rows[0].count) >= CREATOR_CAMPAIGN_LIMIT) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Campaign limit reached (max ${CREATOR_CAMPAIGN_LIMIT})` });
      }
      await client.query('COMMIT');
    } catch (lockErr) {
      await client.query('ROLLBACK').catch(() => {});
      throw lockErr;
    } finally {
      client.release();
    }

    const campaignId = await XAutoCampaignService.createCampaign({
      name: String(name).substring(0, 200),
      accountId,
      topic: String(topic).substring(0, 2000),
      grokMode: grokMode || 'xPost',
      language: language || 'en',
      intervalMinutes: Math.max(30, Number(intervalMinutes) || 60),
      activeHoursStart: safeStart,
      activeHoursEnd: safeEnd,
      maxPosts: null,
      createdBy: creatorId,
      createdByUsername: creatorUsername,
      mediaFolderId: null,
      personaType: 'generic',
    });

    return res.json({ success: true, campaignId });
  } catch (err) {
    logger.error('createMyXCampaign error', err);
    return res.status(500).json({ error: 'Failed to create campaign' });
  }
};

// Helper: verify campaign ownership
const _verifyCampaignOwnership = async (campaignId, userId) => {
  if (!UUID_RE.test(campaignId)) return null;
  const campaign = await XAutoCampaignService.getCampaign(campaignId);
  if (!campaign || String(campaign.created_by) !== String(userId)) return null;
  return campaign;
};

// PUT /api/creator/x-campaigns/:id
const updateMyXCampaign = async (req, res) => {
  try {
    const campaign = await _verifyCampaignOwnership(req.params.id, req.session?.user?.id);
    if (!campaign) return res.status(403).json({ error: 'Not your campaign' });

    const allowed = ['name', 'topic', 'grokMode', 'language', 'intervalMinutes', 'activeHoursStart', 'activeHoursEnd'];
    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    if (updates.intervalMinutes !== undefined) updates.intervalMinutes = Math.max(30, Number(updates.intervalMinutes) || 60);
    if (updates.grokMode && !VALID_GROK_MODES.has(updates.grokMode)) return res.status(400).json({ error: 'Invalid grokMode' });
    if (updates.language && !VALID_LANGUAGES.has(updates.language)) return res.status(400).json({ error: 'Invalid language' });
    if (updates.activeHoursStart !== undefined) updates.activeHoursStart = Math.max(0, Math.min(23, Number(updates.activeHoursStart)));
    if (updates.activeHoursEnd !== undefined) updates.activeHoursEnd = Math.max(0, Math.min(23, Number(updates.activeHoursEnd)));
    if (updates.name && String(updates.name).length > 200) return res.status(400).json({ error: 'name too long' });
    if (updates.topic && String(updates.topic).length > 2000) return res.status(400).json({ error: 'topic too long' });

    await XAutoCampaignService.updateCampaign(req.params.id, updates);
    return res.json({ success: true });
  } catch (err) {
    logger.error('updateMyXCampaign error', err);
    return res.status(500).json({ error: 'Failed to update campaign' });
  }
};

// POST /api/creator/x-campaigns/:id/pause
const pauseMyXCampaign = async (req, res) => {
  try {
    const campaign = await _verifyCampaignOwnership(req.params.id, req.session?.user?.id);
    if (!campaign) return res.status(403).json({ error: 'Not your campaign' });
    await XAutoCampaignService.pauseCampaign(req.params.id);
    return res.json({ success: true });
  } catch (err) {
    logger.error('pauseMyXCampaign error', err);
    return res.status(500).json({ error: 'Failed to pause campaign' });
  }
};

// POST /api/creator/x-campaigns/:id/resume
const resumeMyXCampaign = async (req, res) => {
  try {
    const campaign = await _verifyCampaignOwnership(req.params.id, req.session?.user?.id);
    if (!campaign) return res.status(403).json({ error: 'Not your campaign' });
    await XAutoCampaignService.resumeCampaign(req.params.id);
    return res.json({ success: true });
  } catch (err) {
    logger.error('resumeMyXCampaign error', err);
    return res.status(500).json({ error: 'Failed to resume campaign' });
  }
};

// DELETE /api/creator/x-campaigns/:id
const deleteMyXCampaign = async (req, res) => {
  try {
    const campaign = await _verifyCampaignOwnership(req.params.id, req.session?.user?.id);
    if (!campaign) return res.status(403).json({ error: 'Not your campaign' });
    await XAutoCampaignService.deleteCampaign(req.params.id);
    return res.json({ success: true });
  } catch (err) {
    logger.error('deleteMyXCampaign error', err);
    return res.status(500).json({ error: 'Failed to delete campaign' });
  }
};

// GET /api/creator/x-campaigns/:campId/history
const getMyXCampaignHistory = async (req, res) => {
  try {
    const campaign = await _verifyCampaignOwnership(req.params.campId, req.session?.user?.id);
    if (!campaign) return res.status(403).json({ error: 'Not your campaign' });
    const page = Math.max(1, parseInt(req.query.page || '1'));
    const limit = 20;
    const { posts, total } = await XAutoCampaignService.getCampaignHistory(req.params.campId, page, limit);
    return res.json({
      success: true,
      posts,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    logger.error('getMyXCampaignHistory error', err);
    return res.status(500).json({ error: 'Failed to load history' });
  }
};

// POST /api/webapp/creator/channels/:id/video
// Owner-only: uploads a video file into the creator's private Directus folder
// and publishes it as a social_post in this channel in a single round-trip.
const uploadChannelVideo = async (req, res) => {
  const channelId = parseInt(req.params.id, 10);
  if (!Number.isFinite(channelId)) return res.status(400).json({ error: 'Invalid channel ID' });

  try {
    if (!req.file) return res.status(400).json({ error: 'No video file provided' });

    const chRes = await query(
      'SELECT id, creator_id FROM creator_channels WHERE id = $1 AND is_active = true',
      [channelId]
    );
    if (!chRes.rows.length || chRes.rows[0].creator_id !== req.user.id) {
      return res.status(404).json({ error: 'Channel not found or not yours' });
    }

    const userRes = await query(
      'SELECT pnptv_id, creator_status FROM users WHERE id = $1',
      [req.user.id]
    );
    const user = userRes.rows[0];
    if (!user || user.creator_status !== 'active') {
      return res.status(403).json({ error: 'Active creator account required' });
    }
    if (!user.pnptv_id) {
      return res.status(500).json({ error: 'Creator missing pnptv_id — cannot scope CMS folder' });
    }

    const { fileId, url } = await uploadBufferToCreatorFolder({
      pnptvId: user.pnptv_id,
      buffer: req.file.buffer,
      filename: req.file.originalname,
      contentType: req.file.mimetype,
    });

    if (!fileId || !url) {
      return res.status(502).json({ error: 'CMS did not return a file id' });
    }

    const caption = typeof req.body?.caption === 'string'
      ? req.body.caption.trim().slice(0, 2000)
      : '';
    const mediaItems = [{ url, type: 'video', cmsFileId: fileId }];

    const insertRes = await query(
      `INSERT INTO social_posts
         (user_id, content, media_url, media_type, media_urls,
          is_wof, is_exclusive, is_shareable, content_tier, channel_id)
       VALUES ($1, $2, $3, 'video', $4, false, false, true, 'free', $5)
       RETURNING id, content, media_url, media_type, media_urls, video_thumbnail_url,
                 channel_id, likes_count, reposts_count, replies_count,
                 is_wof, is_exclusive, is_shareable, content_tier, created_at`,
      [req.user.id, caption, url, JSON.stringify(mediaItems), channelId]
    );

    await query(
      `UPDATE creator_channels SET post_count = (
         SELECT COUNT(*) FROM social_posts WHERE channel_id = $1 AND is_deleted = false
       ) WHERE id = $1`,
      [channelId]
    );

    return res.json({ success: true, post: insertRes.rows[0], fileId });
  } catch (err) {
    logger.error('uploadChannelVideo error', err?.response?.data || err);
    return res.status(500).json({ error: 'Failed to upload channel video' });
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
  uploadChannelVideo,
  addCollaborator,
  removeCollaborator,
  getMySubscribers,
  getMyConsents,
  getMyXAccount,
  getMyXCampaigns,
  createMyXCampaign,
  updateMyXCampaign,
  pauseMyXCampaign,
  resumeMyXCampaign,
  deleteMyXCampaign,
  getMyXCampaignHistory,
};
