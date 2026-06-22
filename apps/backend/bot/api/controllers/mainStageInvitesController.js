'use strict';

/**
 * Main Stage Invites Controller
 *
 * Handles invite CRUD (admin) and guest token minting (public).
 * Separated from mainStageController.js to keep each file focused.
 */

const crypto             = require('crypto');
const logger             = require('../../../utils/logger');
const { asyncHandler }   = require('../middleware/errorHandler');
const mainStageService   = require('../../../services/mainStageService');
const livekitService     = require('../../../services/livekitService');
const mainStageInviteService = require('../../../services/mainStageInviteService');
const emailService       = require('../../../services/emailService');
const EntitlementAccessService = require('../../../services/entitlementAccessService');
const { getRedis }       = require('../../../config/redis');

// RFC 5322-leaning practical email regex — keeps quoted local-parts out
// (nodemailer-parser CVE class) but accepts every realistic address.
const EMAIL_RE = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,24}$/;

const ROOM_NAME = mainStageService.ROOM_NAME;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a request fingerprint hash from IP + User-Agent.
 * SHA-256 — never stores raw values. Used only for abuse tracing.
 */
function buildFingerprint(req) {
  const ip = req.ip || req.connection?.remoteAddress || '';
  const ua = req.get('user-agent') || '';
  return crypto.createHash('sha256').update(`${ip}|${ua}`).digest('hex');
}

// ── Admin endpoints ───────────────────────────────────────────────────────────

/**
 * POST /api/main-stage/invites
 * Admin only. Creates a new invite link.
 * Body: { label?, expiresInHours?, maxUses? }
 */
const createInvite = asyncHandler(async (req, res) => {
  const { label, expiresInHours, maxUses } = req.body || {};

  const expiresInSeconds = expiresInHours
    ? Math.round(Number(expiresInHours) * 3600)
    : 86400; // default 24 h

  const invite = await mainStageInviteService.createInvite({
    creatorUserId:    req.user.id,
    label:            label || null,
    expiresInSeconds,
    maxUses:          maxUses !== undefined ? Number(maxUses) : 1,
  });

  return res.status(201).json({
    success: true,
    invite: {
      id:        invite.id,
      code:      invite.code,
      url:       invite.url,
      expiresAt: invite.expiresAt,
      maxUses:   invite.maxUses,
      label:     label || null,
    },
  });
});

/**
 * GET /api/main-stage/invites
 * Admin only. Returns all invites created by the calling admin.
 */
const listInvites = asyncHandler(async (req, res) => {
  const invites = await mainStageInviteService.listInvites({ creatorUserId: req.user.id });
  return res.json({ success: true, invites });
});

/**
 * DELETE /api/main-stage/invites/:id
 * Admin only. Revokes the invite.
 */
const revokeInvite = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const numId = parseInt(id, 10);
  if (!numId || numId <= 0) {
    return res.status(400).json({ success: false, error: 'Invalid invite id' });
  }

  const ok = await mainStageInviteService.revokeInvite({
    id:            numId,
    creatorUserId: req.user.id,
  });

  if (!ok) {
    return res.status(404).json({ success: false, error: 'Invite not found or already revoked' });
  }
  return res.json({ success: true });
});

/**
 * POST /api/main-stage/invites/permanent
 * Admin only. Creates a permanent invite: no expiry, unlimited uses.
 * Body: { label? }
 */
const createPermanentInvite = asyncHandler(async (req, res) => {
  const { label } = req.body || {};

  const invite = await mainStageInviteService.createInvite({
    creatorUserId: req.user.id,
    label:         label || 'Permanent invite',
    permanent:     true,
  });

  return res.status(201).json({
    success: true,
    invite: {
      id:        invite.id,
      code:      invite.code,
      url:       invite.url,
      expiresAt: null,
      maxUses:   0,
      permanent: true,
      label:     invite.label || label || 'Permanent invite',
    },
  });
});

// ── Public endpoints ──────────────────────────────────────────────────────────

/**
 * GET /api/main-stage/invites/preview/:code
 * No auth required. Returns invite validity metadata without redeeming.
 */
const previewInvite = asyncHandler(async (req, res) => {
  const { code } = req.params;
  if (!code || !/^[A-Za-z0-9_-]{8,32}$/.test(code)) {
    return res.status(400).json({ success: false, valid: false, error: 'Invalid code format' });
  }

  const preview = await mainStageInviteService.previewInvite(code);
  return res.json({ success: true, ...preview });
});

/**
 * POST /api/main-stage/guest-token
 * No auth required. Validates invite code, mints a LiveKit guest token.
 * Body: { code, displayName }
 * Rate-limited to 5/min/IP at the route layer.
 */
const guestToken = asyncHandler(async (req, res) => {
  const { code, displayName, email, language, acceptTerms, acceptPrivacy, ageConfirmed } = req.body || {};
  const mainStageConsentService = require('../../../services/mainStageConsentService');

  // ── Input validation ──
  if (!code || typeof code !== 'string' || !/^[A-Za-z0-9_-]{8,32}$/.test(code)) {
    return res.status(400).json({ success: false, error: 'Invalid invite code' });
  }

  const name = typeof displayName === 'string' ? displayName.trim() : '';
  if (name.length < 2 || name.length > 30) {
    return res.status(400).json({
      success: false,
      error: 'Display name must be 2–30 characters',
    });
  }

  // Reject names with HTML/script injection characters.
  if (/<|>|&|"/.test(name)) {
    return res.status(400).json({ success: false, error: 'Display name contains disallowed characters' });
  }

  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!normalizedEmail || normalizedEmail.length > 254 || !EMAIL_RE.test(normalizedEmail)) {
    return res.status(400).json({
      success: false,
      error: 'A valid email address is required',
      code: 'MAIN_STAGE_EMAIL_REQUIRED',
    });
  }

  if (acceptTerms !== true || acceptPrivacy !== true || ageConfirmed !== true) {
    return res.status(400).json({
      success: false,
      error: 'terms, privacy, and age confirmation are required',
      code: 'MAIN_STAGE_CONSENT_REQUIRED',
    });
  }

  const guestLanguage = language === 'es' ? 'es' : 'en';
  const fingerprint = buildFingerprint(req);

  // ── Redeem invite (atomic) ──
  const redeem = await mainStageInviteService.redeemInvite({ code, displayName: name, fingerprint });

  if (!redeem.success) {
    const httpStatus =
      redeem.errorCode === 'INVITE_NOT_FOUND'  ? 404 :
      redeem.errorCode === 'INVITE_REVOKED'    ? 410 :
      redeem.errorCode === 'INVITE_EXPIRED'    ? 410 :
      redeem.errorCode === 'INVITE_EXHAUSTED'  ? 410 : 400;

    return res.status(httpStatus).json({
      success: false,
      error:   redeem.errorCode,
      code:    redeem.errorCode,
    });
  }

  // ── Kicked-set check ──
  // A guest who was kicked previously holds a `mainstage:kicked:<lkIdentity>`
  // key for 24h. If they redeem another invite (or this invite a second time
  // before TTL expiry) we must refuse to mint a fresh token using the same
  // identity. The lkIdentity is freshly generated per redemption, so a kick
  // only blocks the specific identity issued for the previous join. This
  // still meaningfully blocks the most common abuse path: a guest who was
  // kicked attempting to immediately rejoin via the same redemption (same
  // browser/tab keeps the same redeem result, and re-redemption would only
  // succeed for unlimited-use invites — in that case the new identity is
  // unkicked, which is the correct semantics: kicks target identities).
  try {
    const redis = getRedis();
    const isKicked = await redis.get(`mainstage:kicked:${String(redeem.lkIdentity)}`);
    if (isKicked) {
      return res.status(403).json({
        success: false,
        error: 'You have been removed from Main Stage.',
        code: 'MAIN_STAGE_KICKED',
      });
    }
  } catch (redisErr) {
    logger.error('[MainStage] guestToken: Redis unavailable (kicked-set check)', { error: redisErr.message });
    return res.status(503).json({
      success: false,
      error: 'Service temporarily unavailable.',
      code: 'SESSION_BACKEND_UNAVAILABLE',
    });
  }

  // ── Reserve a stage slot + mint LiveKit token ──
  // Guest entrants join the same room model as authenticated participants,
  // so they also consume a rotation/visibility slot.
  const addResult = await mainStageService.addCammer(String(redeem.lkIdentity));
  if (addResult === 'full') {
    return res.status(429).json({
      success: false,
      error: 'Main Stage is full',
      code: 'CAMMER_CAP_REACHED',
    });
  }

  await mainStageConsentService.recordGuestConsent({
    guestIdentity: redeem.lkIdentity,
    guestDisplayName: name,
    guestEmail: normalizedEmail,
    inviteId: redeem.inviteId,
    ageConfirmed: true,
    ip: req.ip || req.headers['x-forwarded-for'] || null,
    userAgent: req.get('user-agent') || null,
  });

  const lkToken = await livekitService.generateToken(
    ROOM_NAME,
    redeem.lkIdentity,
    name,
    false, // not a moderator
    {
      canPublishVideo: true,
      canPublishAudio: false,
      ttlSeconds:      15 * 60, // 15-minute guest session
    }
  );

  logger.info('[MainStage] guest token issued', {
    inviteId: redeem.inviteId,
    lkIdentity: redeem.lkIdentity,
    displayName: name,
  });

  // Fire-and-forget welcome + lifetime100 promo. Never blocks the join.
  if (typeof emailService.sendMainStageGuestPromoEmail === 'function') {
    setImmediate(() => {
      emailService
        .sendMainStageGuestPromoEmail({
          to: normalizedEmail,
          displayName: name,
          language: guestLanguage,
        })
        .catch((err) => {
          logger.warn('[MainStage] guest promo email failed', {
            email: normalizedEmail,
            err: err?.message || String(err),
          });
        });
    });
  }

  return res.json({
    success:          true,
    token:            lkToken,
    livekitUrl:       livekitService.LIVEKIT_WS_URL,
    roomName:         ROOM_NAME,
    role:             'guest',
    identity:         redeem.lkIdentity,
    canScreenShare:   false,
    sessionLimitSeconds: 15 * 60,
    sessionStartedAt: Date.now(),
  });
});

/**
 * POST /api/main-stage/member-invites
 * Auth required + pnp-member entitlement. Max 3 invites per 24h rolling window.
 * Creates a single-use, 24h invite that any member can share with a friend.
 */
const createMemberInvite = asyncHandler(async (req, res) => {
  const userId = req.user?.id;

  const hasMembership = await EntitlementAccessService.hasEntitlement(String(userId), 'pnp-member');
  if (!hasMembership) {
    return res.status(403).json({
      success: false,
      error: 'PNP membership is required to create invites.',
      code: 'MEMBERSHIP_REQUIRED',
    });
  }

  const DAILY_LIMIT = 3;
  const QUOTA_KEY   = `mainstage:member-invite-quota:${String(userId)}`;

  let redis;
  try {
    redis = getRedis();
    const count = await redis.incr(QUOTA_KEY);
    if (count === 1) await redis.expire(QUOTA_KEY, 24 * 3600);
    if (count > DAILY_LIMIT) {
      const ttl = await redis.ttl(QUOTA_KEY);
      return res.status(429).json({
        success: false,
        error: `You can create up to ${DAILY_LIMIT} invites per day.`,
        code: 'MEMBER_INVITE_QUOTA_EXCEEDED',
        resetsInSeconds: ttl > 0 ? ttl : 86400,
      });
    }
  } catch (redisErr) {
    logger.error('[MainStage] createMemberInvite: Redis unavailable', { error: redisErr.message });
    return res.status(503).json({ success: false, error: 'Service temporarily unavailable.', code: 'SESSION_BACKEND_UNAVAILABLE' });
  }

  const { label } = req.body;
  const invite = await mainStageInviteService.createInvite({
    creatorUserId:    userId,
    label:            label ? String(label).slice(0, 100) : 'Member invite',
    expiresInSeconds: 24 * 3600,
    maxUses:          1,
  });

  logger.info('[MainStage] member invite created', { userId, inviteId: invite.id });
  return res.json({ success: true, ...invite });
});

/**
 * GET /api/main-stage/member-invites
 * Auth required + pnp-member entitlement. Lists the caller's own member invites.
 */
const listMemberInvites = asyncHandler(async (req, res) => {
  const userId = req.user?.id;

  const hasMembership = await EntitlementAccessService.hasEntitlement(String(userId), 'pnp-member');
  if (!hasMembership) {
    return res.status(403).json({ success: false, error: 'PNP membership is required.', code: 'MEMBERSHIP_REQUIRED' });
  }

  const invites = await mainStageInviteService.listInvites({ creatorUserId: userId });
  return res.json({ success: true, invites });
});

module.exports = {
  createInvite,
  createPermanentInvite,
  listInvites,
  revokeInvite,
  previewInvite,
  guestToken,
  createMemberInvite,
  listMemberInvites,
};
