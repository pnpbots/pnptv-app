const logger = require('../../../utils/logger');
const CreatorService = require('../../../services/creatorService');
const IdentityVerificationService = require('../../../services/identityVerificationService');
const NotificationEmitter = require('../../../services/notificationEmitter');
const { query, getPool } = require('../../../config/postgres');
const { hasAccess } = require('../../../services/accessService');
const { resolveUserId } = require('../../utils/helpers');
const XAutoCampaignService = require('../../../services/xAutoCampaignService');
const fs = require('fs');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Map a creator_channels DB row to the camelCase shape expected by the frontend
// CreatorChannel interface (api.ts). All three mutating handlers (create/update/list)
// must pass rows through this function before sending them in responses.
function shapeChannel(row) {
  return {
    id: row.id,
    creatorId: row.creator_id,
    name: row.name,
    slug: row.slug,
    description: row.description ?? null,
    coverImageUrl: row.cover_image_url ?? null,
    tags: row.tags || [],
    isPremium: row.is_premium ?? false,
    featured: row.featured ?? false,
    accessType: row.access_type ?? 'free',
    priceUsd: row.price_usd != null ? Number(row.price_usd) : 0,
    hangoutGroupId: row.hangout_group_id ?? null,
    postCount: row.post_count ?? 0,
    videoCount: row.video_count != null ? Number(row.video_count) : undefined,
    sortOrder: row.sort_order ?? 0,
    collaborators: row.collaborators || [],
    telegramChannelId: row.telegram_channel_id ?? null,
    bridgeEnabled: row.bridge_enabled ?? false,
    creatorUsername: row.creator_username ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
const VALID_GROK_MODES = new Set(['xPost', 'broadcast', 'salesPost']);
const VALID_LANGUAGES = new Set(['en', 'es', 'bilingual']);
const MIN_MONETIZATION_VIDEO_COUNT = 5;
const MIN_MONETIZATION_VIDEO_DURATION_SEC = 5 * 60;
const MONETIZATION_INELIGIBLE_MESSAGE =
  'Upload at least 5 exclusive videos of 5 minutes or more before charging for memberships or paid channels.';

async function getCreatorMonetizationEligibility(creatorId) {
  const result = await query(
    `SELECT COUNT(*)::int AS eligible_count
       FROM channel_videos cv
       JOIN creator_channels cc ON cc.id = cv.channel_id
      WHERE cc.creator_id = $1
        AND cc.is_active = true
        AND cc.access_type IN ('subscription', 'paid')
        AND cv.status = 'published'
        AND COALESCE(cv.duration_sec, 0) >= $2`,
    [creatorId, MIN_MONETIZATION_VIDEO_DURATION_SEC]
  );
  const eligibleVideoCount = Number(result.rows[0]?.eligible_count || 0);
  return {
    eligible: eligibleVideoCount >= MIN_MONETIZATION_VIDEO_COUNT,
    eligibleVideoCount,
    requiredVideoCount: MIN_MONETIZATION_VIDEO_COUNT,
    requiredDurationSec: MIN_MONETIZATION_VIDEO_DURATION_SEC,
  };
}

function sendMonetizationEligibilityError(res, eligibility) {
  return res.status(403).json({
    error: MONETIZATION_INELIGIBLE_MESSAGE,
    code: 'CREATOR_MONETIZATION_CONTENT_REQUIRED',
    eligibleVideoCount: eligibility.eligibleVideoCount,
    requiredVideoCount: eligibility.requiredVideoCount,
    requiredDurationSec: eligibility.requiredDurationSec,
  });
}

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
    if (err.code === 'CREATOR_LOCKED') {
      return res.status(err.statusCode || 423).json({ error: err.message, code: 'CREATOR_LOCKED' });
    }
    if (err.code === 'SUBSCRIPTIONS_PAUSED') {
      return res.status(err.statusCode || 423).json({ error: err.message, code: 'SUBSCRIPTIONS_PAUSED' });
    }
    if (err.code === 'MEMBER_REQUIRED') {
      return res.status(err.statusCode || 403).json({ error: err.message, code: 'MEMBER_REQUIRED' });
    }
    logger.error('subscribeToCreator error', { error: err.message, stack: err.stack });
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

// ── Payout destination validators (server-side; must mirror cashoutService) ──
// Lanes: meru | btc | dash | usdt_tron | usdt_base
const PAYOUT_VALIDATORS = {
  meru: (d) => {
    const handle = (d?.handle || '').trim();
    if (!handle) return 'Meru handle is required.';
    if (handle.length > 100) return 'Meru handle too long.';
    if (!/^(\+?[0-9]{7,15}|[a-zA-Z0-9._-]{3,50})$/.test(handle)) {
      return 'Invalid Meru handle. Use international phone (+57…) or alphanumeric username (3–50 chars).';
    }
    return null;
  },
  btc: (d) => {
    const a = (d?.address || '').trim();
    if (!a) return 'BTC address is required.';
    if (!/^bc1[ac-hj-np-z02-9]{6,87}$/.test(a) && !/^[13][1-9A-HJ-NP-Za-km-z]{25,34}$/.test(a)) {
      return 'Invalid BTC mainnet address. Use bc1… (segwit) or 1…/3… (legacy).';
    }
    return null;
  },
  dash: (d) => {
    const a = (d?.address || '').trim();
    if (!a) return 'Dash address is required.';
    if (!/^[X7][1-9A-HJ-NP-Za-km-z]{33}$/.test(a)) {
      return 'Invalid Dash address. Starts with X (P2PKH) or 7 (P2SH), 34 chars.';
    }
    return null;
  },
  usdt_tron: (d) => {
    const a = (d?.address || '').trim();
    if (!a) return 'USDT-TRON address is required.';
    if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(a)) {
      return 'Invalid TRC-20 address. Starts with T, 34 chars.';
    }
    return null;
  },
  usdt_base: (d) => {
    const a = (d?.address || '').trim();
    if (!a) return 'USDT-Base address is required.';
    if (!/^0x[0-9a-fA-F]{40}$/.test(a)) {
      return 'Invalid Base EVM address. Starts with 0x, 42 chars.';
    }
    return null;
  },
};

const VALID_PAYOUT_LANES = Object.keys(PAYOUT_VALIDATORS);

// GET /api/webapp/creator/wallet
// Returns the per-lane destinations blob plus legacy mirrors for the old UI.
const getWalletAddress = async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT creator_payout_destinations,
              creator_dash_address, creator_wallet_verified,
              payout_method, meru_account,
              fiat_payout_method, fiat_payout_account
         FROM users WHERE id = $1`,
      [req.user.id]
    );
    const row = rows[0] || {};
    return res.json({
      success: true,
      destinations: row.creator_payout_destinations || {},
      // Legacy fields — kept for the existing SettingsTab UI until it migrates.
      dashAddress: row.creator_dash_address || null,
      verified: row.creator_wallet_verified || false,
      payoutMethod: row.payout_method || 'dash',
      meruAccount: row.meru_account || null,
      fiatPayoutMethod: row.fiat_payout_method || null,
      fiatPayoutAccount: row.fiat_payout_account || null,
    });
  } catch (err) {
    logger.error('getWalletAddress error', err);
    return res.status(500).json({ error: 'Failed to get payout info' });
  }
};

// POST /api/webapp/creator/wallet
// Accepts either:
//   - new shape: { destinations: { meru: { handle }, btc: { address }, … } }
//     Each provided lane is validated + jsonb-merged into the existing column.
//   - legacy shape: { dashAddress, payoutMethod, meruAccount, fiatProvider, fiatAccount }
//     Translated to the new shape and merged. Legacy columns also stay updated
//     so the old SettingsTab UI keeps working during the rollover.
const saveWalletAddress = async (req, res) => {
  try {
    const body = req.body || {};

    // Translate any legacy fields into per-lane destination updates.
    const destUpdates = {};
    if (body.destinations && typeof body.destinations === 'object') {
      for (const lane of VALID_PAYOUT_LANES) {
        if (body.destinations[lane] && typeof body.destinations[lane] === 'object') {
          destUpdates[lane] = body.destinations[lane];
        }
      }
    }
    if (typeof body.dashAddress === 'string' && body.dashAddress.trim()) {
      destUpdates.dash = { address: body.dashAddress.trim() };
    }
    if (typeof body.meruAccount === 'string' && body.meruAccount.trim()) {
      destUpdates.meru = { handle: body.meruAccount.trim() };
    }

    if (Object.keys(destUpdates).length === 0
        && !body.fiatProvider && !body.fiatAccount) {
      return res.status(400).json({ error: 'No destinations or legacy fields provided.' });
    }

    // Validate every lane in the patch before any DB write.
    const sanitized = {};
    for (const [lane, payload] of Object.entries(destUpdates)) {
      const error = PAYOUT_VALIDATORS[lane](payload);
      if (error) return res.status(400).json({ error });
      // Normalise whitespace in stored values.
      if (lane === 'meru') sanitized[lane] = { handle: payload.handle.trim() };
      else sanitized[lane] = { address: payload.address.trim() };
    }

    if (Object.keys(sanitized).length > 0) {
      await query(
        `UPDATE users
            SET creator_payout_destinations = COALESCE(creator_payout_destinations, '{}'::jsonb) || $1::jsonb,
                creator_dash_address = COALESCE($2, creator_dash_address),
                meru_account = COALESCE($3, meru_account),
                updated_at = NOW()
          WHERE id = $4`,
        [
          JSON.stringify(sanitized),
          sanitized.dash?.address || null,
          sanitized.meru?.handle || null,
          req.user.id,
        ]
      );
    }

    // Legacy fiat path stays as-is — fiat is not a cashout lane anymore but
    // some creators may still have it set and the old UI may write to it.
    if (body.fiatProvider !== undefined || body.fiatAccount !== undefined) {
      const VALID_FIAT_PROVIDERS = ['venmo', 'cashapp', 'zelle', 'paypal', 'wise', 'revolut'];
      const provider = (body.fiatProvider || '').trim().toLowerCase();
      const account = (body.fiatAccount || '').trim().replace(/<[^>]*>/g, '');
      if (provider && !VALID_FIAT_PROVIDERS.includes(provider)) {
        return res.status(400).json({ error: 'Invalid fiat provider.' });
      }
      if (account.length > 200) {
        return res.status(400).json({ error: 'Fiat account too long.' });
      }
      if (provider && account) {
        await query(
          `UPDATE users
              SET payout_method = 'fiat',
                  fiat_payout_method = $1,
                  fiat_payout_account = $2,
                  updated_at = NOW()
            WHERE id = $3`,
          [provider, account, req.user.id]
        );
      }
    }

    // Payout address save satisfies checklist item 2 — check if the creator is
    // now fully ready to accept subscribers (identity + terms may already be set).
    CreatorService.checkAndMaybeUnlockCreator(req.user.id).catch(err =>
      logger.warn('saveWalletAddress: checkAndMaybeUnlockCreator failed (non-fatal)', {
        userId: req.user.id,
        error: err.message,
      })
    );

    // Return the fresh destinations blob so the client can update state without a refetch.
    const { rows: fresh } = await query(
      `SELECT creator_payout_destinations FROM users WHERE id = $1`,
      [req.user.id]
    );
    return res.json({
      success: true,
      destinations: fresh[0]?.creator_payout_destinations || {},
    });
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
    if (!paused) {
      const eligibility = await getCreatorMonetizationEligibility(req.user.id);
      if (!eligibility.eligible) {
        return sendMonetizationEligibilityError(res, eligibility);
      }
    }
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
      'SELECT creator_status, creator_type, creator_subscriber_count, username FROM users WHERE id = $1',
      [req.user.id]
    );
    const user = userRes.rows[0];
    if (!user || user.creator_status !== 'active') {
      return res.status(403).json({ error: 'Creator profile not active' });
    }
    if (user.creator_type === 'full_time') {
      return res.status(403).json({ error: 'Full-time creators cannot change tier via self-service.' });
    }
    if (user.creator_type === tier) {
      return res.status(400).json({ error: 'Already on this tier' });
    }

    const oldTier = user.creator_type;
    await query(
      'UPDATE users SET creator_type = $1, creator_price_usd = $2 WHERE id = $3',
      [tier, validTiers[tier], req.user.id]
    );

    // Operator notification (non-fatal)
    try {
      const adminId = process.env.ADMIN_ID;
      if (adminId) {
        const { getBotInstance } = require('../../../bot/core/bot');
        const bot = getBotInstance();
        if (bot) {
          const handle = user.username ? `@${user.username}` : String(req.user.id);
          await bot.telegram.sendMessage(
            adminId,
            `🔄 Creator tier changed\nUser: ${handle} (ID: ${req.user.id})\nOld tier: ${oldTier} → New tier: ${tier}\nActive subscribers: ${user.creator_subscriber_count || 0}`
          );
        }
      }
    } catch (_) {}

    return res.json({ success: true, tier, price: validTiers[tier] });
  } catch (err) {
    logger.error('changeTier error', err);
    return res.status(500).json({ error: 'Failed to change tier' });
  }
};

// POST /api/webapp/creator/enroll
const submitEnrollment = async (req, res) => {
  try {
    const { tier, paymentMethod, paymentAddress, paymentNetwork, signatureData, legalName, dateOfBirth, idType } = req.body || {};

    // Required identity fields — cannot be omitted or the 2257 record is skipped
    if (!legalName?.trim())  return res.status(400).json({ error: 'Legal name is required' });
    if (!dateOfBirth)         return res.status(400).json({ error: 'Date of birth is required' });
    if (!idType)              return res.status(400).json({ error: 'ID type is required' });

    // Guard against excessively large base64 signature payloads
    const MAX_SIG_BYTES = 250 * 1024;
    if (signatureData && Buffer.byteLength(signatureData, 'utf8') > MAX_SIG_BYTES) {
      return res.status(400).json({ error: 'Signature data too large' });
    }

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

    // FIX 7: Auto-create the 2257 identity record whenever the three required text
    // fields are present — regardless of whether an ID document was uploaded.
    // Creators without a doc upload can still pass grace-period review; admin
    // flags the record for follow-up via the /admin/creator/2257/records panel.
    if (legalName && dateOfBirth && idType) {
      try {
        await IdentityVerificationService.submit2257Record(req.user.id, {
          legalName: legalName.trim(),
          dateOfBirth,
          idType,
          idDocumentPath: idDocumentPath || null,
          ip,
        });
      } catch (idErr) {
        // Non-fatal: enrollment saved; creator can resubmit 2257 manually on /creators/apply.
        logger.warn('[enrollCreator] 2257 record auto-create failed', { userId: req.user.id, error: idErr.message });
      }
    }

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
    const idDocFile = req.files?.idDocument?.[0];
    const idSelfieFile = req.files?.idSelfie?.[0];
    if (!idDocFile) {
      return res.status(400).json({ error: 'ID document photo is required' });
    }
    if (!idSelfieFile) {
      return res.status(400).json({ error: 'Selfie holding ID is required' });
    }
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || null;
    const idDocumentPath = `/uploads/creator-2257/${idDocFile.filename}`;
    const idSelfiePath = `/uploads/creator-2257/${idSelfieFile.filename}`;
    const record = await IdentityVerificationService.submit2257Record(req.user.id, {
      legalName,
      dateOfBirth,
      idType,
      idDocumentPath,
      idSelfiePath,
      ip,
    });
    // H-03: notify admin on every new submission
    const adminId = process.env.ADMIN_ID;
    if (adminId) {
      try {
        const { getBotInstance } = require('../../../bot/core/bot');
        const bot = getBotInstance();
        const displayName = req.user.username || req.user.first_name || req.user.id;
        if (bot) await bot.telegram.sendMessage(
          adminId,
          `📋 New 2257 record submitted by user ${req.user.id} (${displayName}). Review at /admin/compliance-2257`
        );
      } catch (_) {}
    }
    return res.json({
      success: true,
      record: {
        verification_status: record.verification_status,
        submitted_at: record.submitted_at,
      },
    });
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
            resubmission_count: record.resubmission_count ?? 0,
            banned_from_applying_until: record.banned_from_applying_until || null,
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

    // Identity approval satisfies checklist item 1 — check if the creator is
    // now fully ready to accept subscribers (payout + terms may already be set).
    CreatorService.checkAndMaybeUnlockCreator(req.params.userId).catch(err =>
      logger.warn('approve2257: checkAndMaybeUnlockCreator failed (non-fatal)', {
        userId: req.params.userId,
        error: err.message,
      })
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
              creator_strikes, creator_subscriber_count, creator_price_usd, creator_locked, role
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
      `SELECT cc.id, cc.creator_id, cc.name, cc.slug, cc.description, cc.cover_image_url,
              cc.tags, cc.is_premium, cc.access_type, cc.price_usd, cc.sort_order,
              cc.post_count, cc.hangout_group_id, cc.telegram_channel_id, cc.bridge_enabled,
              cc.collaborators, cc.is_system, cc.created_at, cc.updated_at,
              u.username AS creator_username
       FROM creator_channels cc
       JOIN users u ON u.id = cc.creator_id
       WHERE cc.is_active = true
         AND cc.is_system = FALSE
         AND (cc.creator_id = $1 OR $1 = ANY(cc.collaborators))
       ORDER BY cc.sort_order ASC NULLS LAST, cc.created_at ASC`,
      [req.user.id]
    );
    return res.json({ success: true, channels: result.rows.map(shapeChannel) });
  } catch (err) {
    logger.error('listOwnChannels error', err);
    return res.status(500).json({ error: 'Failed to list channels' });
  }
};

const MAX_CHANNELS_PER_CREATOR = 20;

const createChannel = async (req, res) => {
  try {
    // Verify active creator
    const userRes = await query('SELECT creator_status FROM users WHERE id = $1', [req.user.id]);
    if (!userRes.rows.length || userRes.rows[0].creator_status !== 'active') {
      return res.status(403).json({ error: 'Active creator status required' });
    }

    // Enforce per-creator channel limit to prevent storage/index abuse.
    const channelCountRes = await query(
      'SELECT COUNT(*)::int AS n FROM creator_channels WHERE creator_id = $1 AND is_active = true AND is_system = false',
      [req.user.id]
    );
    if (channelCountRes.rows[0].n >= MAX_CHANNELS_PER_CREATOR) {
      return res.status(400).json({ error: `Channel limit reached (max ${MAX_CHANNELS_PER_CREATOR} active channels per creator)` });
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
      const eligibility = await getCreatorMonetizationEligibility(req.user.id);
      if (!eligibility.eligible) {
        return sendMonetizationEligibilityError(res, eligibility);
      }
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
    return res.json({ success: true, channel: shapeChannel(result.rows[0]) });
  } catch (err) {
    logger.error('createChannel error', err);
    return res.status(500).json({ error: 'Failed to create channel' });
  }
};

const updateChannel = async (req, res) => {
  const channelId = parseInt(req.params.id, 10);
  if (!Number.isFinite(channelId)) return res.status(400).json({ error: 'Invalid channel ID' });

  try {
    // Verify ownership and not a system-managed channel
    const chRes = await query('SELECT * FROM creator_channels WHERE id = $1 AND is_active = true', [channelId]);
    if (!chRes.rows.length || chRes.rows[0].creator_id !== req.user.id) {
      return res.status(404).json({ error: 'Channel not found or not yours' });
    }
    if (chRes.rows[0].is_system) {
      return res.status(403).json({ error: 'This channel is managed by the admin panel and cannot be edited here.' });
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
    if (coverImageUrl !== undefined) {
      // Cover images may be cleared (null/empty) OR must originate from a
      // trusted PNPtv-controlled domain — blocks `javascript:` XSS and
      // arbitrary-origin SSRF when an upstream renderer pre-fetches the image.
      const TRUSTED_COVER_ORIGINS = [
        /^https:\/\/cms\.pnptv\.app\/assets\//,
        /^\/uploads\/channels\//,
      ];
      let safeCover = null;
      if (coverImageUrl !== null && coverImageUrl !== '') {
        const raw = String(coverImageUrl).trim().slice(0, 2048);
        if (!TRUSTED_COVER_ORIGINS.some(re => re.test(raw))) {
          return res.status(400).json({ error: 'coverImageUrl must be from a trusted PNPtv origin.' });
        }
        safeCover = raw;
      }
      updates.push(`cover_image_url = $${idx++}`); params.push(safeCover);
    }
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
        if (chRes.rows[0].access_type !== 'paid') {
          const eligibility = await getCreatorMonetizationEligibility(req.user.id);
          if (!eligibility.eligible) {
            return sendMonetizationEligibilityError(res, eligibility);
          }
        }
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
    return res.json({ success: true, channel: shapeChannel(result.rows[0]) });
  } catch (err) {
    logger.error('updateChannel error', err);
    return res.status(500).json({ error: 'Failed to update channel' });
  }
};

const deleteChannel = async (req, res) => {
  const channelId = parseInt(req.params.id, 10);
  if (!Number.isFinite(channelId)) return res.status(400).json({ error: 'Invalid channel ID' });

  try {
    // Verify ownership first, then check the system flag — this order avoids
    // leaking channel metadata (is_system=true) to users who don't own the channel.
    const ownerCheck = await query(
      'SELECT id, is_system, is_active FROM creator_channels WHERE id = $1 AND creator_id = $2',
      [channelId, req.user.id]
    );
    if (!ownerCheck.rows.length) return res.status(404).json({ error: 'Channel not found or not yours' });
    if (ownerCheck.rows[0].is_system) {
      return res.status(403).json({ error: 'This channel is managed by the admin panel and cannot be deleted here.' });
    }
    if (!ownerCheck.rows[0].is_active) return res.status(404).json({ error: 'Channel not found or not yours' });

    const client = await getPool().connect();
    let result;
    try {
      await client.query('BEGIN');
      // Unlink posts first so no post is ever associated with an inactive channel
      await client.query('UPDATE social_posts SET channel_id = NULL WHERE channel_id = $1', [channelId]);
      result = await client.query(
        'UPDATE creator_channels SET is_active = false, updated_at = NOW() WHERE id = $1 AND creator_id = $2 AND is_active = true RETURNING id',
        [channelId, req.user.id]
      );
      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
      throw txErr;
    }
    client.release();
    if (!result.rows.length) return res.status(404).json({ error: 'Channel not found or not yours' });

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
    // Only the channel owner can add collaborators; system channels are admin-only
    const chRes = await query('SELECT creator_id, collaborators, is_system FROM creator_channels WHERE id = $1 AND is_active = true', [channelId]);
    if (!chRes.rows.length || chRes.rows[0].creator_id !== req.user.id) {
      return res.status(404).json({ error: 'Channel not found or not yours' });
    }
    if (chRes.rows[0].is_system) {
      return res.status(403).json({ error: 'This channel is managed by the admin panel.' });
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
    return res.json({ success: true, channel: shapeChannel(updated.rows[0]) });
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
    const chRes = await query('SELECT creator_id, is_system FROM creator_channels WHERE id = $1 AND is_active = true', [channelId]);
    if (!chRes.rows.length || chRes.rows[0].creator_id !== req.user.id) {
      return res.status(404).json({ error: 'Channel not found or not yours' });
    }
    const ch = chRes.rows[0];
    if (ch.is_system) {
      return res.status(403).json({ error: 'This channel is managed by the admin panel.' });
    }

    await query(
      `UPDATE creator_channels
       SET collaborators = array_remove(collaborators, $1), updated_at = NOW()
       WHERE id = $2`,
      [String(userId), channelId]
    );
    const updated = await query('SELECT * FROM creator_channels WHERE id = $1', [channelId]);
    return res.json({ success: true, channel: shapeChannel(updated.rows[0]) });
  } catch (err) {
    logger.error('removeCollaborator error', err);
    return res.status(500).json({ error: 'Failed to remove collaborator' });
  }
};

// ── Creator Panel: subscribers, consents, X campaigns ────────────────────────

const getMySubscribers = async (req, res) => {
  try {
    const creatorId = req.user.id;
    const page = Math.max(1, parseInt(req.query.page || '1'));
    const limit = 20;
    const offset = (page - 1) * limit;

    const statsResult = await query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'active') as active_count,
        COUNT(*) as total_count,
        COUNT(*) FILTER (WHERE started_at >= date_trunc('month', NOW())) as new_this_month,
        COUNT(*) FILTER (WHERE status IN ('cancelled','expired') AND updated_at >= NOW() - INTERVAL '30 days') AS churned_this_month
      FROM creator_subscriptions WHERE creator_id = $1
    `, [creatorId]);
    const s = statsResult.rows[0];
    const active = Number(s.active_count);
    const churned = Number(s.churned_this_month);
    const churnRate = active > 0 ? Math.round((churned / active) * 100) : 0;

    const subsResult = await query(`
      SELECT cs.id, cs.status, cs.started_at, cs.expires_at, cs.price_usd, cs.auto_renew,
             u.username as subscriber_username, u.first_name as subscriber_first_name,
             u.photo_file_id AS subscriber_avatar,
             COALESCE(SUM(ce.amount_creator), 0)::numeric as revenue
      FROM creator_subscriptions cs
      JOIN users u ON u.id = cs.subscriber_id
      LEFT JOIN creator_earnings ce ON ce.subscription_id = cs.id AND ce.status = 'available'
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
      stats: { active_count: active, total_count: Number(s.total_count), new_this_month: Number(s.new_this_month), churn_rate: churnRate },
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    logger.error('getMySubscribers error', err);
    return res.status(500).json({ error: 'Failed to load subscribers' });
  }
};

const getMyChannelSubscribers = async (req, res) => {
  try {
    const creatorId = req.user.id;

    const channelsResult = await query(`
      SELECT
        cc.id, cc.name, cc.slug, cc.access_type, cc.price_usd, cc.cover_image_url,
        COUNT(cs.user_id) AS subscriber_count,
        COUNT(cs.user_id) FILTER (WHERE cs.created_at >= date_trunc('month', NOW())) AS new_this_month
      FROM creator_channels cc
      LEFT JOIN channel_subscribers cs ON cs.channel_id = cc.id
      WHERE cc.creator_id = $1 AND cc.is_active = true AND NOT cc.is_system
      GROUP BY cc.id
      ORDER BY cc.sort_order ASC, cc.created_at ASC
    `, [creatorId]);

    const channelsWithSubs = await Promise.all(channelsResult.rows.map(async (ch) => {
      const subsResult = await query(`
        SELECT cs.user_id, cs.created_at,
               u.username, u.first_name,
               u.photo_file_id AS avatar
        FROM channel_subscribers cs
        JOIN users u ON u.id = cs.user_id
        WHERE cs.channel_id = $1
        ORDER BY cs.created_at DESC
        LIMIT 20
      `, [ch.id]);
      return { ...ch, subscriber_count: Number(ch.subscriber_count), new_this_month: Number(ch.new_this_month), subscribers: subsResult.rows };
    }));

    const totalChannelSubs = channelsWithSubs.reduce((acc, ch) => acc + ch.subscriber_count, 0);

    return res.json({
      success: true,
      channels: channelsWithSubs,
      summary: {
        total_channels: channelsWithSubs.length,
        total_channel_subscribers: totalChannelSubs,
      },
    });
  } catch (err) {
    logger.error('getMyChannelSubscribers error', err);
    return res.status(500).json({ error: 'Failed to load channel subscribers' });
  }
};

const getMyConsents = async (req, res) => {
  try {
    const userId = req.user.id;
    // Pull generic consent flags from users plus payout-config flags. Joined to
    // the latest model_application so the consents page can also show creator/
    // performer-specific form status (2257 ID, legal name).
    // Also joined to creator_2257_records and creator_enrollments so that
    // completed actions from the /2257 page and enrollment wizard are reflected
    // here even when the user has no model_applications row.
    // Sensitive PII (raw ID URLs, full payout account handle, wallet address)
    // is NEVER returned — only "submitted" booleans + non-secret summaries.
    const result = await query(`
      SELECT
        u.terms_accepted, u.privacy_accepted,
        u.privacy_accepted_at,
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
        COALESCE(NULLIF(ma.stage_name, ''), NULLIF(u.first_name, ''))          AS stage_name,
        COALESCE(NULLIF(ma.legal_full_name, ''), r.legal_name)                 AS legal_full_name,
        COALESCE(ma.date_of_birth, r.date_of_birth)                            AS date_of_birth,
        COALESCE(NULLIF(ma.country, ''), NULLIF(u.country, ''))                AS country,
        COALESCE(NULLIF(ma.city_state, ''), NULLIF(u.city, ''))                AS city_state,
        (
          (ma.id_front_url IS NOT NULL AND ma.id_front_url <> '')
          OR (r.id_document_path IS NOT NULL AND r.id_document_path <> '')
        )                                                                        AS id_front_submitted,
        (
          (ma.id_back_url IS NOT NULL AND ma.id_back_url <> '')
          OR (r.id_document_path IS NOT NULL AND r.id_document_path <> '')
        )                                                                        AS id_back_submitted,
        (
          COALESCE(ma.terms_agreed, FALSE)
          OR ce.terms_accepted_at IS NOT NULL
          OR u.creator_terms_accepted_at IS NOT NULL
        )                                                                        AS creator_terms_agreed,
        ma.terms_version                                                        AS creator_terms_version,
        COALESCE(ma.terms_agreed_at, ce.terms_accepted_at, u.creator_terms_accepted_at)
                                                                                AS creator_terms_agreed_at
      FROM users u
      LEFT JOIN LATERAL (
        SELECT * FROM model_applications
        WHERE user_id = u.id::text
        ORDER BY created_at DESC
        LIMIT 1
      ) ma ON TRUE
      LEFT JOIN creator_2257_records r ON r.user_id = u.id::text
      LEFT JOIN creator_enrollments ce ON ce.user_id = u.id::text AND ce.status = 'approved'
      WHERE u.id = $1
    `, [userId]);
    if (!result.rows[0]) return res.status(404).json({ error: 'User not found' });
    return res.json({ success: true, userId, consents: result.rows[0] });
  } catch (err) {
    logger.error('getMyConsents error', err);
    return res.status(500).json({ error: 'Failed to load consents' });
  }
};

const acceptCreatorTerms = async (req, res) => {
  try {
    const userId = req.user.id;
    if (!userId) return res.status(400).json({ error: 'User ID missing' });
    const version = process.env.CREATOR_TERMS_VERSION || '2026-01-01';
    await query(
      `UPDATE users
         SET creator_terms_accepted_at = NOW(),
             creator_terms_version = $2::varchar
       WHERE id = $1`,
      [userId, version]
    );
    return res.json({ success: true });
  } catch (err) {
    logger.error('acceptCreatorTerms error', err);
    return res.status(500).json({ error: 'Failed to record creator terms acceptance' });
  }
};

const acceptPrivacyPolicy = async (req, res) => {
  try {
    const userId = req.user.id;
    const ip = req.ip || req.headers['x-forwarded-for'] || null;
    await query(
      `UPDATE users
         SET privacy_accepted    = TRUE,
             privacy_accepted_at = NOW(),
             privacy_accepted_ip = $2::text
       WHERE id = $1`,
      [userId, ip],
    );
    req.session.user = { ...req.session.user, privacy_accepted: true };
    return res.json({ success: true });
  } catch (err) {
    logger.error('acceptPrivacyPolicy error', err);
    return res.status(500).json({ error: 'Failed to record privacy acceptance' });
  }
};

const getSetupStatus = async (req, res) => {
  try {
    if (req.user.creator_status !== 'active') {
      return res.status(403).json({ error: 'Creator account not active' });
    }
    const userId = req.user.id || req.user.telegram_id;
    const { rows } = await query(`
      SELECT
        u.identity_verified,
        u.fiat_payout_method,
        u.meru_account,
        u.creator_wallet_address,
        (u.creator_dash_address IS NOT NULL AND u.creator_dash_address <> '') AS wallet_set,
        (u.creator_payout_destinations IS NOT NULL AND u.creator_payout_destinations != '{}'::jsonb) AS payout_destinations_set,
        r.verification_status                                                  AS identity_record_status,
        (
          COALESCE(ma.terms_agreed, FALSE)
          OR ce.terms_accepted_at IS NOT NULL
          OR u.creator_terms_accepted_at IS NOT NULL
        )                                                                       AS creator_terms,
        ce.payment_address                                                      AS enrollment_payment_address,
        (COALESCE(ma.stage_name, u.first_name, '') <> '')                       AS has_stage_name,
        (COALESCE(ma.bio, u.bio, '') <> '')                                    AS has_bio,
        EXISTS(
          SELECT 1 FROM social_posts sp
          WHERE sp.user_id = u.id::text
            AND sp.is_exclusive = TRUE
            AND sp.is_deleted = FALSE
        )                                                                       AS has_exclusive_post
      FROM users u
      LEFT JOIN creator_2257_records r ON r.user_id = u.id::text
      LEFT JOIN LATERAL (
        SELECT * FROM model_applications
        WHERE user_id = u.id::text
        ORDER BY created_at DESC
        LIMIT 1
      ) ma ON TRUE
      LEFT JOIN creator_enrollments ce
        ON ce.user_id = u.id::text AND ce.status = 'approved'
      WHERE u.id = $1
    `, [userId]);

    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    const d = rows[0];

    const identityDone = d.identity_verified === true;
    const payoutDone   = !!(
      d.fiat_payout_method ||
      d.wallet_set ||
      d.meru_account ||
      d.creator_wallet_address ||
      d.enrollment_payment_address ||
      d.payout_destinations_set
    );
    const profileDone  = !!(d.has_stage_name && d.has_bio);

    const items = [
      {
        key: 'identity',
        label: 'Identity Verification (18 U.S.C. § 2257)',
        required: true,
        done: identityDone,
        status: d.identity_record_status || 'none',
      },
      {
        key: 'creator_terms',
        label: 'Creator Agreement',
        required: true,
        done: d.creator_terms === true,
        status: d.creator_terms ? 'done' : 'none',
      },
      {
        key: 'payout',
        label: 'Payout Method',
        required: true,
        done: payoutDone,
        status: payoutDone ? 'done' : 'none',
      },
      {
        key: 'profile',
        label: 'Stage Name & Bio',
        required: false,
        done: profileDone,
        status: profileDone ? 'done' : 'none',
      },
      {
        key: 'first_post',
        label: 'First Exclusive Post',
        required: false,
        done: d.has_exclusive_post === true,
        status: d.has_exclusive_post ? 'done' : 'none',
      },
    ];

    const doneCount    = items.filter(i => i.done).length;
    const requiredDone = items.filter(i => i.required).every(i => i.done);
    const completionPct = Math.round((doneCount / items.length) * 100);

    return res.json({
      success: true,
      completion_pct: completionPct,
      required_done: requiredDone,
      setup_complete: items.every(i => i.done),
      items,
    });
  } catch (err) {
    logger.error('getSetupStatus error', err);
    return res.status(500).json({ error: 'Failed to load setup status' });
  }
};

const getMyXAccount = async (req, res) => {
  try {
    const userId = req.user.id;
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
    const creatorId = String(req.user.id);
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
    const creatorId = String(req.user.id);
    const creatorUsername = req.user.username;
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

    // Enforce campaign limit with advisory lock to prevent TOCTOU race.
    // The INSERT happens inside the same transaction so the advisory lock covers it.
    let campaignId;
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [creatorId]);
      const countResult = await client.query("SELECT COUNT(*) FROM x_auto_campaigns WHERE created_by = $1 AND status != 'completed'", [creatorId]);
      if (parseInt(countResult.rows[0].count) >= CREATOR_CAMPAIGN_LIMIT) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Campaign limit reached (max ${CREATOR_CAMPAIGN_LIMIT})` });
      }
      const insertResult = await client.query(
        `INSERT INTO x_auto_campaigns
          (name, account_id, topic, grok_mode, language, custom_prompt,
           interval_minutes, active_hours_start, active_hours_end, max_posts,
           created_by, created_by_username, media_folder_id, persona_type)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         RETURNING campaign_id`,
        [String(name).substring(0, 200), accountId, String(topic).substring(0, 2000),
         grokMode || 'xPost', language || 'en', null,
         Math.max(30, Number(intervalMinutes) || 60),
         safeStart, safeEnd, null,
         creatorId, creatorUsername, null, 'generic']
      );
      campaignId = insertResult.rows[0].campaign_id;
      await client.query('COMMIT');
    } catch (lockErr) {
      await client.query('ROLLBACK').catch(() => {});
      throw lockErr;
    } finally {
      client.release();
    }
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
    const campaign = await _verifyCampaignOwnership(req.params.id, req.user.id);
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
    const campaign = await _verifyCampaignOwnership(req.params.id, req.user.id);
    if (!campaign) return res.status(403).json({ error: 'Not your campaign' });
    await XAutoCampaignService.pauseCampaign(req.params.id);
    return res.json({ success: true });
  } catch (err) { logger.error('pauseMyXCampaign error', err); return res.status(500).json({ error: 'Failed to pause campaign' }); }
};

const resumeMyXCampaign = async (req, res) => {
  try {
    const campaign = await _verifyCampaignOwnership(req.params.id, req.user.id);
    if (!campaign) return res.status(403).json({ error: 'Not your campaign' });
    await XAutoCampaignService.resumeCampaign(req.params.id);
    return res.json({ success: true });
  } catch (err) { logger.error('resumeMyXCampaign error', err); return res.status(500).json({ error: 'Failed to resume campaign' }); }
};

const deleteMyXCampaign = async (req, res) => {
  try {
    const campaign = await _verifyCampaignOwnership(req.params.id, req.user.id);
    if (!campaign) return res.status(403).json({ error: 'Not your campaign' });
    await XAutoCampaignService.deleteCampaign(req.params.id);
    return res.json({ success: true });
  } catch (err) { logger.error('deleteMyXCampaign error', err); return res.status(500).json({ error: 'Failed to delete campaign' }); }
};

const getMyXCampaignHistory = async (req, res) => {
  try {
    const campaign = await _verifyCampaignOwnership(req.params.campId, req.user.id);
    if (!campaign) return res.status(403).json({ error: 'Not your campaign' });
    const page = Math.max(1, parseInt(req.query.page || '1'));
    const limit = 20;
    const { posts, total } = await XAutoCampaignService.getCampaignHistory(req.params.campId, page, limit);
    return res.json({ success: true, posts, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  } catch (err) { logger.error('getMyXCampaignHistory error', err); return res.status(500).json({ error: 'Failed to load history' }); }
};

// POST /api/webapp/creator/:creatorId/promote (admin)
// Promotes an eligible creator to active status with a chosen tier.
// Passes termsAccepted = true on behalf of the admin.
const adminActivateCreator = async (req, res) => {
  try {
    const creatorId = await resolveUserId(req.params.creatorId);
    if (!creatorId) return res.status(404).json({ error: 'Creator not found' });

    const tier = req.body.tier || 'ice';
    if (!['ice', 'crystal', 'diamond'].includes(tier)) {
      return res.status(400).json({ error: 'Invalid tier. Choose ice, crystal, or diamond.' });
    }

    const statusRes = await query(
      'SELECT creator_status FROM users WHERE id = $1',
      [creatorId]
    );
    const user = statusRes.rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.creator_status !== 'eligible') {
      return res.status(400).json({
        error: `Cannot activate: user creator_status is '${user.creator_status}', must be 'eligible'`,
      });
    }

    await CreatorService.activateCreator(creatorId, tier, true);
    return res.json({ success: true, creatorId, tier });
  } catch (err) {
    logger.error('adminActivateCreator error', err);
    return res.status(400).json({ error: err.message });
  }
};

// GET /api/webapp/creator/:creatorId/engagement (admin)
// Returns composite engagement score and tier recommendation for the given creator.
const getCreatorEngagement = async (req, res) => {
  try {
    const creatorId = await resolveUserId(req.params.creatorId);
    if (!creatorId) return res.status(404).json({ error: 'Creator not found' });
    const result = await CreatorService.calculateEngagementScore(creatorId);
    return res.json({ success: true, ...result });
  } catch (err) {
    logger.error('getCreatorEngagement error', err);
    return res.status(500).json({ error: 'Failed to compute engagement score' });
  }
};

// POST /api/webapp/creator/:creatorId/set-eligible (admin)
// Marks a user as eligible so they can be promoted via adminActivateCreator.
const adminSetEligible = async (req, res) => {
  try {
    const creatorId = await resolveUserId(req.params.creatorId);
    if (!creatorId) return res.status(404).json({ error: 'Creator not found' });

    const result = await query(
      `UPDATE users
          SET creator_status = 'eligible', updated_at = NOW()
        WHERE id = $1
          AND (creator_status IS NULL OR creator_status NOT IN ('active', 'suspended'))
        RETURNING id`,
      [creatorId]
    );

    if (!result.rows.length) {
      return res.status(400).json({
        error: 'Cannot set eligible: user is already active or suspended',
      });
    }

    return res.json({ success: true });
  } catch (err) {
    logger.error('adminSetEligible error', err);
    return res.status(500).json({ error: 'Failed to set eligible status' });
  }
};

// GET /api/webapp/creator/earnings
const getCreatorEarnings = async (req, res) => {
  try {
    const creatorId = req.user.id;
    // FIX 8: Accept ?months= param (3–12), default 6
    const months = Math.min(Math.max(parseInt(req.query.months, 10) || 6, 1), 12);

    const [summaryRes, trendsRes] = await Promise.all([
      query(
        // FIX 10: Include 'holding' in summary totals so creators see their full lifetime figure
        `SELECT
           COALESCE(SUM(amount_gross), 0)::numeric    AS total_gross,
           COALESCE(SUM(amount_creator), 0)::numeric  AS total_creator,
           COALESCE(SUM(amount_platform), 0)::numeric AS total_platform
         FROM creator_earnings
         WHERE creator_id = $1
           AND status IN ('available', 'holding', 'in_payout', 'paid_out')`,
        [creatorId]
      ),
      query(
        // FIX 8: Use parameterised months interval instead of hardcoded 6
        `SELECT
           date_trunc('month', created_at)::date           AS month,
           COALESCE(SUM(amount_creator), 0)::numeric       AS amount
         FROM creator_earnings
         WHERE creator_id = $1
           AND status IN ('available', 'holding', 'in_payout', 'paid_out')
           AND created_at >= NOW() - ($2 * INTERVAL '1 month')
         GROUP BY 1
         ORDER BY 1 ASC`,
        [creatorId, months]
      ),
    ]);

    const s = summaryRes.rows[0] || {};
    return res.json({
      success: true,
      summary: {
        total_gross:    parseFloat(s.total_gross)    || 0,
        total_creator:  parseFloat(s.total_creator)  || 0,
        total_platform: parseFloat(s.total_platform) || 0,
      },
      trends: trendsRes.rows.map(r => ({
        month:  r.month,
        amount: parseFloat(r.amount) || 0,
      })),
    });
  } catch (err) {
    logger.error('getCreatorEarnings error', err);
    return res.status(500).json({ error: 'Failed to load earnings' });
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
  addCollaborator,
  removeCollaborator,
  getMySubscribers,
  getMyChannelSubscribers,
  getMyConsents,
  acceptCreatorTerms,
  acceptPrivacyPolicy,
  getSetupStatus,
  getMyXAccount,
  getMyXCampaigns,
  createMyXCampaign,
  updateMyXCampaign,
  pauseMyXCampaign,
  resumeMyXCampaign,
  deleteMyXCampaign,
  getMyXCampaignHistory,
  getCreatorEarnings,
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
  // Admin creator promotion
  adminActivateCreator,
  adminSetEligible,
  getCreatorEngagement,
};
