const logger = require('../../../utils/logger');
const CreatorService = require('../../../services/creatorService');
const IdentityVerificationService = require('../../../services/identityVerificationService');
const NotificationEmitter = require('../../../services/notificationEmitter');
const { query, getPool } = require('../../../config/postgres');
const { hasAccess } = require('../../../services/accessService');
const { resolveUserId } = require('../../utils/helpers');
const XAutoCampaignService = require('../../../services/xAutoCampaignService');
const { uploadBufferToCreatorFolder, uploadStreamToCreatorFolder } = require('./cmsCreatorController');
const fs = require('fs');

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
  const { paymentId } = req.body || {};
  if (!paymentId) {
    return res.status(400).json({ error: 'paymentId is required' });
  }
  try {
    const creatorId = await resolveUserId(req.params.creatorId);
    if (!creatorId) return res.status(404).json({ error: 'Creator not found' });

    // Verify the payment belongs to this user, is completed, and targets this creator.
    // This prevents PRIME users from subscribing to any creator for free by omitting payment.
    const payRes = await query(
      `SELECT user_id, status, plan_id, metadata FROM payments WHERE id = $1`,
      [paymentId]
    );
    const payment = payRes.rows[0];
    if (!payment) {
      return res.status(400).json({ error: 'Payment not found' });
    }
    if (String(payment.user_id) !== String(req.user.id)) {
      return res.status(403).json({ error: 'Payment does not belong to this user' });
    }
    if (payment.status !== 'completed') {
      return res.status(400).json({ error: 'Payment has not been completed', code: 'PAYMENT_NOT_COMPLETED' });
    }
    const meta = payment.metadata || {};
    if (meta.type !== 'creator_monthly' && payment.plan_id !== 'creator_monthly') {
      return res.status(400).json({ error: 'Payment is not for a creator subscription' });
    }
    if (meta.creatorId && String(meta.creatorId) !== String(creatorId)) {
      return res.status(400).json({ error: 'Payment is for a different creator' });
    }

    const result = await CreatorService.subscribeToCreator(req.user.id, creatorId, paymentId);
    return res.json({ success: true, ...result });
  } catch (err) {
    logger.error('subscribeToCreator error', err);
    if (err.code === 'CREATOR_LOCKED') {
      return res.status(err.statusCode || 423).json({ error: err.message, code: 'CREATOR_LOCKED' });
    }
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
      `SELECT creator_dash_address, creator_wallet_verified,
              payout_method, meru_account,
              fiat_payout_method, fiat_payout_account
       FROM users WHERE id = $1`,
      [req.user.id]
    );
    return res.json({
      success: true,
      dashAddress: rows[0]?.creator_dash_address || null,
      verified: rows[0]?.creator_wallet_verified || false,
      payoutMethod: rows[0]?.payout_method || 'dash',
      meruAccount: rows[0]?.meru_account || null,
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
    const { dashAddress, payoutMethod, meruAccount, fiatProvider, fiatAccount } = req.body || {};
    // 'crypto' (USDC EVM) is no longer accepted — Dash is the only crypto path.
    // The legacy creator_wallet_address column was dropped in migration 123.
    const method = payoutMethod === 'meru' ? 'meru'
      : payoutMethod === 'fiat'  ? 'fiat'
      : 'dash';                                 // default

    if (method === 'dash') {
      const trimmed = (dashAddress || '').trim();
      if (!trimmed || !/^[X7][1-9A-HJ-NP-Za-km-z]{33}$/.test(trimmed)) {
        return res.status(400).json({
          error: 'Invalid Dash wallet address. Dash mainnet addresses start with X (or 7 for P2SH) and are 34 characters long (e.g. Xa1bc…).',
        });
      }
      await query(
        `UPDATE users
         SET creator_dash_address = $1,
             payout_method = 'dash',
             meru_account = NULL
         WHERE id = $2`,
        [trimmed, req.user.id]
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
        'UPDATE users SET payout_method = $1, fiat_payout_method = $2, fiat_payout_account = $3, meru_account = NULL WHERE id = $4',
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
        'UPDATE users SET payout_method = $1, meru_account = $2 WHERE id = $3',
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
const toggleSubscription = async (req, res) => {
  try {
    const userRes = await query(
      'SELECT creator_status, creator_subscription_paused FROM users WHERE id = $1',
      [req.user.id]
    );
    const user = userRes.rows[0];
    if (!user || user.creator_status !== 'active') {
      return res.status(403).json({ error: 'Creator profile not active' });
    }
    const paused = !user.creator_subscription_paused;
    await query(
      'UPDATE users SET creator_subscription_paused = $1 WHERE id = $2',
      [paused, req.user.id]
    );
    return res.json({ success: true, subscriptionPaused: paused });
  } catch (err) {
    logger.error('toggleSubscription error', err);
    return res.status(500).json({ error: 'Failed to update subscription setting' });
  }
};

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
    // ── 2257 compliance gate ──────────────────────────────────────────────────
    // A creator must have an approved identity record OR be within the grace
    // period (existing active creators given 30 days) before they can enroll.
    const idRecord = await IdentityVerificationService.get2257Record(req.user.id);
    const graceCompliant = IdentityVerificationService.is2257Compliant(req.user);
    if (!graceCompliant && (!idRecord || idRecord.verification_status !== 'approved')) {
      return res.status(403).json({
        error: 'identity_verification_required',
        message: 'You must complete identity verification (18 U.S.C. § 2257) before enrolling as a creator.',
      });
    }
    // ─────────────────────────────────────────────────────────────────────────

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
    // Fetch the enrollment's user_id BEFORE calling service so we can auto-approve
    // the 2257 record after. CreatorService.approveEnrollment only returns { success: true }.
    let creatorUserId = null;
    try {
      const { rows: enrollRows } = await query(
        'SELECT user_id FROM creator_enrollments WHERE id = $1',
        [req.params.id]
      );
      creatorUserId = enrollRows[0]?.user_id || null;
    } catch (_) {}

    const result = await CreatorService.approveEnrollment(
      req.params.id, req.user.id, req.body.notes || null
    );

    // Auto-approve the creator's 2257 record if it exists and is still pending.
    if (creatorUserId) {
      try {
        const idRecord = await IdentityVerificationService.get2257Record(creatorUserId);
        if (idRecord && idRecord.verification_status === 'pending') {
          await IdentityVerificationService.approve2257Record(
            creatorUserId,
            req.user.id,
            'Auto-approved via enrollment approval'
          );
        }
      } catch (idErr) {
        logger.error('approveEnrollment: auto-approve 2257 record failed — manual review required', {
          enrollmentId: req.params.id,
          creatorUserId,
          error: idErr.message,
        });
        // Notify admin so this doesn't get buried in logs
        NotificationEmitter.emit({
          type: 'admin_alert',
          category: 'compliance',
          priority: 'high',
          targetUserId: req.user.id,
          message: `2257 auto-approval failed for creator ${creatorUserId} (enrollment ${req.params.id}). Manual review required. Error: ${idErr.message}`,
        }).catch(() => {});
      }
    }

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

// ── 2257 identity verification handlers ──────────────────────────────────────

// POST /api/webapp/creator/identity/submit
const submit2257 = async (req, res) => {
  try {
    const { legalName, dateOfBirth, idType } = req.body || {};
    if (!legalName || !dateOfBirth || !idType) {
      return res.status(400).json({ error: 'legalName, dateOfBirth, and idType are required' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'ID document image is required' });
    }
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || null;
    // H-07: store relative path so documents are served via the protected admin endpoint
    const idDocumentPath = `/uploads/creator-2257/${req.file.filename}`;
    const record = await IdentityVerificationService.submit2257Record(req.user.id, {
      legalName,
      dateOfBirth,
      idType,
      idDocumentPath,
      ip,
    });
    // H-03: notify admin on every new submission
    const adminId = process.env.ADMIN_ID;
    if (adminId) {
      try {
        const bot = require('../../../bot/core/bot');
        const displayName = req.user.username || req.user.first_name || req.user.id;
        await bot.telegram.sendMessage(
          adminId,
          `📋 New 2257 record submitted by user ${req.user.id} (${displayName}). Review at /admin/compliance-2257`
        );
      } catch (_) {}
    }
    return res.json({ success: true, record });
  } catch (err) {
    logger.error('submit2257 error', err);
    return res.status(400).json({ error: err.message });
  }
};

// GET /api/webapp/creator/identity/status
const get2257Status = async (req, res) => {
  try {
    const userId = req.user.id || req.user.telegram_id;
    // L-01: always read fresh from DB — session may be stale after admin approval
    const { rows: statusRows } = await query(
      'SELECT identity_verified, identity_verification_required_by FROM users WHERE id = $1',
      [userId]
    );
    const freshUser = statusRows[0] || {};
    const record = await IdentityVerificationService.get2257Record(userId);
    return res.json({
      success: true,
      identity_verified: freshUser.identity_verified || false,
      identity_verification_required_by: freshUser.identity_verification_required_by || null,
      record: record
        ? {
            verification_status: record.verification_status,
            submitted_at: record.submitted_at,
            admin_notes: record.admin_notes,
          }
        : null,
    });
  } catch (err) {
    logger.error('get2257Status error', err);
    return res.status(500).json({ error: err.message });
  }
};

// GET /api/webapp/creator/2257/records (admin)
const list2257Records = async (req, res) => {
  try {
    const { status } = req.query;
    const records = await IdentityVerificationService.list2257Records(status || null);
    return res.json({ success: true, records });
  } catch (err) {
    logger.error('list2257Records error', err);
    return res.status(500).json({ error: err.message });
  }
};

// POST /api/webapp/creator/2257/records/:userId/approve (admin)
const approve2257 = async (req, res) => {
  try {
    const record = await IdentityVerificationService.approve2257Record(
      req.params.userId,
      req.user.id,
      req.body.notes || null
    );
    return res.json({ success: true, record });
  } catch (err) {
    logger.error('approve2257 error', err);
    return res.status(400).json({ error: err.message });
  }
};

// POST /api/webapp/creator/2257/records/:userId/reject (admin)
const reject2257 = async (req, res) => {
  try {
    if (!req.body.notes) {
      return res.status(400).json({ error: 'notes (reason) are required for rejection' });
    }
    const record = await IdentityVerificationService.reject2257Record(
      req.params.userId,
      req.user.id,
      req.body.notes
    );
    return res.json({ success: true, record });
  } catch (err) {
    logger.error('reject2257 error', err);
    return res.status(400).json({ error: err.message });
  }
};

// GET /api/webapp/creator/2257/records/export (admin)
const export2257Records = async (req, res) => {
  try {
    const records = await IdentityVerificationService.export2257Records();
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="2257-records-${Date.now()}.json"`);
    return res.json(records);
  } catch (err) {
    logger.error('export2257Records error', err);
    return res.status(500).json({ error: err.message });
  }
};

// POST /api/webapp/creator/identity/persona/start
const startPersonaInquiry = async (req, res) => {
  try {
    if (!IdentityVerificationService.isPersonaConfigured()) {
      return res.status(503).json({
        error: 'persona_not_configured',
        message: 'Automated verification is not available. Use manual ID upload.',
      });
    }
    const redirectUri = `${process.env.APP_URL || 'https://pnptv.app'}/creators/apply?persona_status=completed`;
    const result = await IdentityVerificationService.startPersonaInquiry(req.user.id, redirectUri);
    return res.json({ success: true, ...result });
  } catch (err) {
    logger.error('startPersonaInquiry error', err);
    return res.status(400).json({ error: err.message });
  }
};

// GET /api/webapp/creator/identity/persona/status
const getPersonaStatus = async (req, res) => {
  try {
    const record = await IdentityVerificationService.get2257Record(req.user.id);
    return res.json({
      success: true,
      configured: IdentityVerificationService.isPersonaConfigured(),
      persona_inquiry_id: record?.persona_inquiry_id || null,
      persona_status: record?.persona_status || null,
    });
  } catch (err) {
    logger.error('getPersonaStatus error', err);
    return res.status(500).json({ error: err.message });
  }
};

// ── Active creator listing ────────────────────────────────────────────────────

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
      `SELECT * FROM creator_channels WHERE is_active = true AND (creator_id = $1 OR $1 = ANY(collaborators)) ORDER BY sort_order, created_at`,
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

    const { name, description, tags, isPremium, collaborators, telegramChannelId, bridgeEnabled, accessType, priceUsd } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Channel name is required' });
    }
    const trimmedName = name.trim().slice(0, 100);

    // Access tier — creators choose:
    //   free         — open to everyone
    //   paid         — separate monthly fee for this specific channel
    //   subscription — included with creator's profile subscription (Ice/Crystal/Diamond)
    //   prime        — included with PRIME (any active prime entitlement unlocks)
    const ALLOWED_ACCESS_TYPES = new Set(['free', 'paid', 'subscription', 'prime']);
    const safeAccessType = ALLOWED_ACCESS_TYPES.has(accessType) ? accessType : 'free';
    let safePriceUsd = 0;
    if (safeAccessType === 'paid') {
      const parsed = Number(priceUsd);
      if (!Number.isFinite(parsed) || parsed < 0.99 || parsed > 999.99) {
        return res.status(400).json({ error: 'Paid channel price must be between $0.99 and $999.99' });
      }
      safePriceUsd = Math.round(parsed * 100) / 100;
    }

    try {
      const { assertCleanText } = require('../../../services/contentModerationFilter');
      assertCleanText(trimmedName, 'name');
      if (description) assertCleanText(description, 'description');
      if (Array.isArray(tags)) {
        for (const tag of tags) assertCleanText(tag, 'tag');
      }
    } catch (err) {
      if (err.code === 'FORBIDDEN_CONTENT') {
        return res.status(400).json({ error: err.message, code: err.code, field: err.field, categories: err.categories });
      }
      throw err;
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
          `SELECT id FROM creator_channels WHERE telegram_channel_id = $1`,
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

    const result = await query(
      `INSERT INTO creator_channels (creator_id, name, slug, description, tags, is_premium, collaborators, telegram_channel_id, bridge_enabled, access_type, price_usd)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [req.user.id, trimmedName, slug, (description || '').slice(0, 2000), safeTags, isPremium === true, safeCollaborators, safeTelegramChannelId, safeBridgeEnabled, safeAccessType, safePriceUsd]
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

    const { name, slug, description, coverImageUrl, tags, isPremium, sortOrder, collaborators, telegramChannelId, bridgeEnabled, accessType, priceUsd } = req.body;

    try {
      const { assertCleanText } = require('../../../services/contentModerationFilter');
      if (name !== undefined) assertCleanText(name, 'name');
      if (description !== undefined) assertCleanText(description, 'description');
      if (Array.isArray(tags)) {
        for (const tag of tags) assertCleanText(tag, 'tag');
      }
    } catch (err) {
      if (err.code === 'FORBIDDEN_CONTENT') {
        return res.status(400).json({ error: err.message, code: err.code, field: err.field, categories: err.categories });
      }
      throw err;
    }

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
          `SELECT id FROM creator_channels WHERE telegram_channel_id = $1 AND id != $2`,
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

    // Access tier + price (creator-set: free | paid | subscription | prime)
    if (accessType !== undefined || priceUsd !== undefined) {
      const ALLOWED_ACCESS_TYPES = new Set(['free', 'paid', 'subscription', 'prime']);
      const newAccessType = accessType !== undefined
        ? (ALLOWED_ACCESS_TYPES.has(accessType) ? accessType : null)
        : chRes.rows[0].access_type;
      if (newAccessType === null) {
        return res.status(400).json({ error: 'Invalid accessType. Must be free, paid, subscription, or prime.' });
      }
      let newPrice = 0;
      if (newAccessType === 'paid') {
        const rawPrice = priceUsd !== undefined ? priceUsd : chRes.rows[0].price_usd;
        const parsed = Number(rawPrice);
        if (!Number.isFinite(parsed) || parsed < 0.99 || parsed > 999.99) {
          return res.status(400).json({ error: 'Paid channel price must be between $0.99 and $999.99' });
        }
        newPrice = Math.round(parsed * 100) / 100;
      }
      if (accessType !== undefined) {
        updates.push(`access_type = $${idx++}`); params.push(newAccessType);
      }
      updates.push(`price_usd = $${idx++}`); params.push(newPrice);
    }

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

// ── Creator Panel: subscribers, consents, X campaigns ────────────────────────

const getMySubscribers = async (req, res) => {
  try {
    const creatorId = req.session?.user?.id;
    const page = Math.max(1, parseInt(req.query.page || '1'));
    const limit = 20;
    const offset = (page - 1) * limit;

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
      stats: { active_count: Number(s.active_count), total_count: Number(s.total_count), new_this_month: Number(s.new_this_month), churn_rate: churnRate },
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    logger.error('getMySubscribers error', err);
    return res.status(500).json({ error: 'Failed to load subscribers' });
  }
};

const getMyConsents = async (req, res) => {
  try {
    const userId = req.session?.user?.id;
    // Pull generic consent flags from users plus payout-config flags. Joined to
    // the latest model_application so the consents page can also show creator/
    // performer-specific form status (2257 ID, legal name, onboarding call).
    // Sensitive PII (raw ID URLs, full payout account handle, wallet address)
    // is NEVER returned — only "submitted" booleans + non-secret summaries.
    const result = await query(`
      SELECT
        u.terms_accepted, u.privacy_accepted,
        u.age_verified, u.age_verified_at,
        u.wof_photo_consent,
        u.content_disclaimer, u.content_disclaimer_accepted_at,
        u.created_at,
        u.fiat_payout_method,
        (u.creator_dash_address IS NOT NULL AND u.creator_dash_address <> '') AS wallet_address_set,
        u.creator_wallet_verified,
        ma.id                AS application_id,
        ma.application_type,
        ma.status            AS application_status,
        ma.created_at        AS application_created_at,
        ma.stage_name,
        ma.legal_full_name,
        ma.date_of_birth,
        ma.country,
        ma.city_state,
        (ma.id_front_url IS NOT NULL AND ma.id_front_url <> '') AS id_front_submitted,
        (ma.id_back_url  IS NOT NULL AND ma.id_back_url  <> '') AS id_back_submitted,
        ma.terms_agreed      AS creator_terms_agreed,
        ma.terms_version     AS creator_terms_version,
        ma.terms_agreed_at   AS creator_terms_agreed_at,
        ma.call_scheduled,
        ma.call_scheduled_at
      FROM users u
      LEFT JOIN LATERAL (
        SELECT * FROM model_applications
        WHERE user_id = u.id
        ORDER BY created_at DESC
        LIMIT 1
      ) ma ON TRUE
      WHERE u.id = $1
    `, [userId]);
    if (!result.rows[0]) return res.status(404).json({ error: 'User not found' });
    return res.json({ success: true, userId, consents: result.rows[0] });
  } catch (err) {
    logger.error('getMyConsents error', err);
    return res.status(500).json({ error: 'Failed to load consents' });
  }
};

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

const createMyXCampaign = async (req, res) => {
  try {
    const creatorId = String(req.session?.user?.id);
    const creatorUsername = req.session?.user?.username;
    const { accountId, name, topic, grokMode, language, intervalMinutes, activeHoursStart, activeHoursEnd } = req.body;
    if (!name || !accountId || !topic) return res.status(400).json({ error: 'name, accountId, and topic are required' });
    if (String(name).length > 200) return res.status(400).json({ error: 'name too long (max 200 chars)' });
    if (String(topic).length > 2000) return res.status(400).json({ error: 'topic too long (max 2000 chars)' });
    if (grokMode && !VALID_GROK_MODES.has(grokMode)) return res.status(400).json({ error: 'Invalid grokMode' });
    if (language && !VALID_LANGUAGES.has(language)) return res.status(400).json({ error: 'Invalid language' });
    const safeStart = Math.max(0, Math.min(23, Number(activeHoursStart) || 9));
    const safeEnd = Math.max(0, Math.min(23, Number(activeHoursEnd) || 22));

    const acctResult = await query('SELECT 1 FROM x_accounts WHERE account_id = $1 AND created_by = $2 AND is_active = TRUE', [accountId, creatorId]);
    if (acctResult.rows.length === 0) return res.status(403).json({ error: 'X account not found or not yours' });

    // Enforce campaign limit with advisory lock to prevent TOCTOU race
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [creatorId]);
      const countResult = await client.query("SELECT COUNT(*) FROM x_auto_campaigns WHERE created_by = $1 AND status != 'completed'", [creatorId]);
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
      name: String(name).substring(0, 200), accountId, topic: String(topic).substring(0, 2000),
      grokMode: grokMode || 'xPost', language: language || 'en',
      intervalMinutes: Math.max(30, Number(intervalMinutes) || 60),
      activeHoursStart: safeStart, activeHoursEnd: safeEnd,
      maxPosts: null, createdBy: creatorId, createdByUsername: creatorUsername,
      mediaFolderId: null, personaType: 'generic',
    });
    return res.json({ success: true, campaignId });
  } catch (err) {
    logger.error('createMyXCampaign error', err);
    return res.status(500).json({ error: 'Failed to create campaign' });
  }
};

const _verifyCampaignOwnership = async (campaignId, userId) => {
  if (!UUID_RE.test(campaignId)) return null;
  const campaign = await XAutoCampaignService.getCampaign(campaignId);
  if (!campaign || String(campaign.created_by) !== String(userId)) return null;
  return campaign;
};

const updateMyXCampaign = async (req, res) => {
  try {
    const campaign = await _verifyCampaignOwnership(req.params.id, req.session?.user?.id);
    if (!campaign) return res.status(403).json({ error: 'Not your campaign' });
    const allowed = ['name', 'topic', 'grokMode', 'language', 'intervalMinutes', 'activeHoursStart', 'activeHoursEnd'];
    const updates = {};
    for (const key of allowed) { if (req.body[key] !== undefined) updates[key] = req.body[key]; }
    if (updates.intervalMinutes !== undefined) updates.intervalMinutes = Math.max(30, Number(updates.intervalMinutes) || 60);
    if (updates.grokMode && !VALID_GROK_MODES.has(updates.grokMode)) return res.status(400).json({ error: 'Invalid grokMode' });
    if (updates.language && !VALID_LANGUAGES.has(updates.language)) return res.status(400).json({ error: 'Invalid language' });
    await XAutoCampaignService.updateCampaign(req.params.id, updates);
    return res.json({ success: true });
  } catch (err) { logger.error('updateMyXCampaign error', err); return res.status(500).json({ error: 'Failed to update campaign' }); }
};

const pauseMyXCampaign = async (req, res) => {
  try {
    const campaign = await _verifyCampaignOwnership(req.params.id, req.session?.user?.id);
    if (!campaign) return res.status(403).json({ error: 'Not your campaign' });
    await XAutoCampaignService.pauseCampaign(req.params.id);
    return res.json({ success: true });
  } catch (err) { logger.error('pauseMyXCampaign error', err); return res.status(500).json({ error: 'Failed to pause campaign' }); }
};

const resumeMyXCampaign = async (req, res) => {
  try {
    const campaign = await _verifyCampaignOwnership(req.params.id, req.session?.user?.id);
    if (!campaign) return res.status(403).json({ error: 'Not your campaign' });
    await XAutoCampaignService.resumeCampaign(req.params.id);
    return res.json({ success: true });
  } catch (err) { logger.error('resumeMyXCampaign error', err); return res.status(500).json({ error: 'Failed to resume campaign' }); }
};

const deleteMyXCampaign = async (req, res) => {
  try {
    const campaign = await _verifyCampaignOwnership(req.params.id, req.session?.user?.id);
    if (!campaign) return res.status(403).json({ error: 'Not your campaign' });
    await XAutoCampaignService.deleteCampaign(req.params.id);
    return res.json({ success: true });
  } catch (err) { logger.error('deleteMyXCampaign error', err); return res.status(500).json({ error: 'Failed to delete campaign' }); }
};

const getMyXCampaignHistory = async (req, res) => {
  try {
    const campaign = await _verifyCampaignOwnership(req.params.campId, req.session?.user?.id);
    if (!campaign) return res.status(403).json({ error: 'Not your campaign' });
    const page = Math.max(1, parseInt(req.query.page || '1'));
    const limit = 20;
    const { posts, total } = await XAutoCampaignService.getCampaignHistory(req.params.campId, page, limit);
    return res.json({ success: true, posts, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  } catch (err) { logger.error('getMyXCampaignHistory error', err); return res.status(500).json({ error: 'Failed to load history' }); }
};

// POST /api/webapp/creator/channels/:id/video
// Owner-only: uploads a video file into the creator's private Directus folder
// and publishes it as a social_post in this channel in a single round-trip.
const uploadChannelVideo = async (req, res) => {
  const channelId = parseInt(req.params.id, 10);
  if (!Number.isFinite(channelId)) return res.status(400).json({ error: 'Invalid channel ID' });

  // Multer wrote the upload to disk (see channelVideoUpload in cmsCreatorController).
  // We must unlink the temp file on every exit path — success, error, or early return —
  // otherwise /tmp fills up with orphaned 2 GB blobs.
  const tmpPath = req.file?.path || null;

  try {
    if (!req.file) return res.status(400).json({ error: 'No video file provided' });

    // ── 2257 compliance gate ──────────────────────────────────────────────────
    // Load fresh columns from DB since session may not have them after migration
    const { rows: compRows } = await query(
      'SELECT identity_verified, identity_verification_required_by FROM users WHERE id = $1',
      [req.user.id]
    );
    const dbUserComp = compRows[0] || {};
    if (!IdentityVerificationService.is2257Compliant(dbUserComp)) {
      return res.status(403).json({
        error: 'identity_verification_required',
        message: 'Complete identity verification (18 U.S.C. § 2257) before uploading content.',
      });
    }
    // ─────────────────────────────────────────────────────────────────────────

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

    const { fileId, url } = await uploadStreamToCreatorFolder({
      pnptvId: user.pnptv_id,
      filePath: req.file.path,
      filename: req.file.originalname,
      contentType: req.file.mimetype,
      knownLength: req.file.size,
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
  } finally {
    if (tmpPath) {
      fs.promises.unlink(tmpPath).catch((err) => {
        if (err.code !== 'ENOENT') {
          logger.warn('Failed to unlink channel-video temp file', { tmpPath, err: err.message });
        }
      });
    }
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
  toggleSubscription,
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
  // 2257 identity verification
  submit2257,
  get2257Status,
  list2257Records,
  approve2257,
  reject2257,
  export2257Records,
  // Persona hosted-flow
  startPersonaInquiry,
  getPersonaStatus,
};
