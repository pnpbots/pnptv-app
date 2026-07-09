'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const geoip = require('geoip-lite');
const { asyncHandler } = require('../middleware/errorHandler');
const inviteLinkService = require('../../../services/inviteLinkService');
const PermissionService = require('../../../services/permissionService');
const { verifyAdminJWT } = require('../middleware/jwtAuth');

const router = express.Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractIp(req) {
  return req.headers['x-real-ip']
    || req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.ip
    || null;
}

// ── Middleware ────────────────────────────────────────────────────────────────

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
  } catch (_err) {
    return res.status(500).json({ success: false, error: 'Authorization check failed' });
  }
};

const checkLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  keyGenerator: (req) => req.ip,
  handler: (_req, res) =>
    res.status(429).json({ valid: false, error: 'Too many requests. Please wait a moment.' }),
  standardHeaders: true,
  legacyHeaders: false,
});

const redeemLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => String(req.session?.user?.id || req.ip),
  handler: (_req, res) =>
    res.status(429).json({ success: false, error: 'Too many redemption attempts. Please wait a moment.' }),
  standardHeaders: true,
  legacyHeaders: false,
});

// ── Public routes ─────────────────────────────────────────────────────────────

/**
 * GET /api/invite/:code
 * Returns validity info. For co_only links also returns colombiaOnly + isFromColombia.
 */
router.get('/invite/:code', checkLimiter, asyncHandler(async (req, res) => {
  const code = String(req.params.code || '').toUpperCase().trim();
  if (!code) return res.status(400).json({ valid: false, error: 'Missing code' });

  const link = await inviteLinkService.getLink(code);
  if (!link) return res.status(404).json({ valid: false });

  const now = new Date();
  if (link.expires_at && new Date(link.expires_at) < now) {
    return res.status(410).json({ valid: false, reason: 'expired' });
  }
  if (link.max_uses !== null && link.use_count >= link.max_uses) {
    return res.status(410).json({ valid: false, reason: 'exhausted' });
  }

  // Fire-and-forget click tracking
  inviteLinkService.trackClick(code);

  const response = {
    valid: true,
    note: link.note || null,
    expiresAt: link.expires_at || null,
    maxUses: link.max_uses || null,
    useCount: link.use_count,
    sku: link.sku,
    isLifetime: link.is_lifetime,
    primeHours: link.prime_hours || 0,
    colombiaOnly: !!link.co_only,
  };

  // For Colombia-only links, tell the frontend whether the caller's IP qualifies
  if (link.co_only) {
    const ip = extractIp(req);
    const geo = ip ? geoip.lookup(ip) : null;
    response.isFromColombia = geo?.country === 'CO';
  }

  return res.json(response);
}));

// ── Authenticated redemption ───────────────────────────────────────────────────

/**
 * POST /api/invite/:code/redeem
 */
router.post('/invite/:code/redeem', redeemLimiter, asyncHandler(async (req, res) => {
  const sessionUser = req.session?.user;
  if (!sessionUser?.id) {
    return res.status(401).json({ success: false, error: 'Debes iniciar sesión para activar este acceso.' });
  }

  const code = String(req.params.code || '').toUpperCase().trim();
  if (!code) return res.status(400).json({ success: false, error: 'Missing code' });

  const ip = extractIp(req);
  const result = await inviteLinkService.redeemLink(code, sessionUser.id, { ip });
  return res.json(result);
}));

/**
 * POST /api/invite/claim-pending-prime
 * Called by users who redeemed a co_only link and now meet profile requirements.
 */
router.post('/invite/claim-pending-prime', redeemLimiter, asyncHandler(async (req, res) => {
  const sessionUser = req.session?.user;
  if (!sessionUser?.id) {
    return res.status(401).json({ success: false, error: 'Debes iniciar sesión.' });
  }
  const result = await inviteLinkService.claimPendingPrime(sessionUser.id);
  return res.json(result);
}));

// ── Admin routes ──────────────────────────────────────────────────────────────

/**
 * GET /api/admin/invite-links
 */
router.get('/admin/invite-links', requireAdminAccess, asyncHandler(async (_req, res) => {
  const links = await inviteLinkService.listLinks();

  // Aggregate stats
  const totalClicks  = links.reduce((s, l) => s + (l.click_count || 0), 0);
  const totalSignups = links.reduce((s, l) => s + (l.use_count   || 0), 0);
  const stats = {
    totalLinks:  links.length,
    totalClicks,
    totalSignups,
    avgConversion: totalClicks > 0 ? Math.round((totalSignups / totalClicks) * 100) : 0,
  };

  return res.json({ success: true, links, stats });
}));

/**
 * POST /api/admin/invite-links
 * Body: { note?, maxUses?, expiresAt?, isLifetime?, primeHours?, coOnly? }
 */
router.post('/admin/invite-links', requireAdminAccess, asyncHandler(async (req, res) => {
  const { note, maxUses, expiresAt, isLifetime, primeHours, coOnly } = req.body;
  const createdBy = req.user?.id || req.session?.user?.id;

  const link = await inviteLinkService.createLink({
    createdBy,
    note:       note || null,
    maxUses:    maxUses    ? parseInt(maxUses, 10)    : null,
    expiresAt:  expiresAt  || null,
    isLifetime: isLifetime !== false,
    primeHours: primeHours ? parseInt(primeHours, 10) : 0,
    coOnly:     !!coOnly,
  });

  return res.status(201).json({
    success: true,
    code: link.code,
    url: `https://pnptv.app/invite/${link.code}`,
    link,
  });
}));

module.exports = router;
