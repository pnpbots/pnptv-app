const Sentry = require('@sentry/node');
const express = require('express');
const path = require('path');
const fs = require('fs');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const session = require('express-session');
const RedisStore = require('connect-redis').default;
const multer = require('multer');
const axios = require('axios');
const crypto = require('crypto');
const FileType = require('../utils/fileType');
const geoip = require('geoip-lite');
const { getRedis, cache } = require('../../config/redis');
const { getPool, query } = require('../../config/postgres');
const logger = require('../../utils/logger');

// Controllers
const webhookController = require('./controllers/webhookController');
const subscriptionController = require('./controllers/subscriptionController');
const paymentController = require('./controllers/paymentController');
const invitationController = require('./controllers/invitationController');
const playlistController = require('./controllers/playlistController');
const podcastController = require('./controllers/podcastController');
const ageVerificationController = require('./controllers/ageVerificationController');
const healthController = require('./controllers/healthController');
const eventsController = require('./controllers/eventsController');
const { adminGuard, superadminGuard } = require('../../middleware/guards');
const xOAuthRoutes = require('./xOAuthRoutes');
const adminUserRoutes = require('./routes/adminUserRoutes');
const userManagementRoutes = require('./routes/userManagementRoutes');
const nearbyRoutes = require('./routes/nearby.routes');
const NearbyController = require('./controllers/nearbyController');
const { verifyAdminJWT } = require('./middleware/jwtAuth');
const roleGuard = require('./middleware/roleGuard');

// Middleware
const { asyncHandler } = require('./middleware/errorHandler');
const { authenticateUser } = require('./middleware/auth');
const ipTracker = require('./middleware/ipTracker');
const PermissionService = require('../../services/permissionService');
const referralService = require('../../services/referralService');

// Authentication middleware and handlers
const { telegramAuth, checkTermsAccepted } = require('./middleware/telegramAuth');
const { handleTelegramAuth, handleAcceptTerms, checkAuthStatus } = require('./handlers/telegramAuthHandler');

// New route imports for auth, subscriptions, monetization
const authRoutes = require('./routes/authRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const subscriptionRoutes = require('./routes/subscriptionRoutes');
const modelRoutes = require('./routes/modelRoutes');
const applyRoutes = require('./routes/applyRoutes');
const castingRoutes = require('./routes/castingRoutes');
// Matrix removed (migrated to LiveKit/Socket.IO). matrixMessageController stays
// as 410-stub for any stale link/webhook; the empty /api/element Router was
// also removed since nothing called it.
const matrixMessageController = {
  sendHangoutMessage: (_req, res) => res.status(410).json({ error: 'Matrix removed — use Socket.IO' }),
  sendDmMessage: (_req, res) => res.status(410).json({ error: 'Matrix removed — use Socket.IO' }),
};
const creatorRoutes = require('./routes/creatorRoutes');
const gamificationRoutes = require('./routes/gamificationRoutes');
const canvaRoutes = require('./routes/canvaRoutes');
const cashoutRoutes = require('./routes/cashoutRoutes');



// Courtesy invite links — admin/model create, any authenticated user redeems
const courtesyInviteRoutes = require('./routes/courtesyInviteRoutes');

// Admin invite links — Colombia Socio program
const inviteLinkRoutes = require('./routes/inviteLinkRoutes');

// Main Stage — 24/7 LiveKit room
const mainStageController = require('./controllers/mainStageController');

const SoundCloudService = require('../../services/soundCloudService');
const AuthentikService = require('../../services/authentikService');
const { enforceDefaultFollows } = require('../../services/followService');

const PNPTV_SYSTEM_ACCOUNT = '8552451957';

/**
 * Page-level authentication middleware
 * Redirects to login page if user is not authenticated
 * Saves the original URL so user can be redirected back after login
 */
const requirePageAuth = (req, res, next) => {
  const user = req.session?.user;

  if (!user) {
    // Redirect unauthenticated users to home page to login
    logger.info(`Unauthenticated access to ${req.originalUrl}, redirecting to home`);
    return res.redirect('/');
  }

  // User is authenticated
  req.user = user;
  next();
};

// ==========================================
// Soft & Tier Authentication Middleware
// ==========================================

const { requireTier, isMemberOrAbove, isAdmin: isAdminTier } = require('../../services/accessService');

// Entitlement-based access control — replaces requireTier for all route middleware
const EntitlementAccessService = require('../../services/entitlementAccessService');

/**
 * Thin session auth — returns 401 JSON if user is not authenticated.
 * Use this before multer on upload routes to reject unauthenticated
 * requests before any file processing begins.
 */
const requireSessionAuth = async (req, res, next) => {
  if (!req.session?.user?.id) return res.status(401).json({ error: 'Not authenticated' });
  req.user = req.session.user;
  const userId = req.session.user.id;
  try {
    const banKey = `user:banned:${userId}`;
    const cachedBan = await cache.get(banKey);
    if (cachedBan === 'true') return res.status(403).json({ success: false, error: 'Account suspended.', code: 'BANNED' });
    const { rows } = await getPool().query(
      'SELECT role, terms_accepted, age_verified FROM users WHERE id = $1',
      [userId]
    );
    const userRow = rows[0];
    if (userRow?.role === 'banned') {
      await cache.set(banKey, 'true', 120);
      return res.status(403).json({ success: false, error: 'Account suspended.', code: 'BANNED' });
    }
    // Consent gate — admins bypass; all other authenticated users must have completed
    // the VerificationGate (age self-declaration + terms acceptance).
    if (userRow && userRow.role !== 'admin' && userRow.role !== 'superadmin') {
      if (!userRow.age_verified) {
        return res.status(403).json({ success: false, error: 'Age verification required.', code: 'AGE_VERIFICATION_REQUIRED' });
      }
      if (!userRow.terms_accepted) {
        return res.status(403).json({ success: false, error: 'Terms acceptance required.', code: 'CONSENT_REQUIRED' });
      }
    }
  } catch (err) {
    logger.error('requireSessionAuth ban check failed — failing closed', { userId, error: err.message });
    return res.status(503).json({ success: false, error: 'Service temporarily unavailable', code: 'SERVICE_UNAVAILABLE' });
  }
  next();
};

/**
 * Auth-only session check — validates session + ban status but skips the
 * age/terms consent gate. Use ONLY for onboarding endpoints where the user
 * must be able to call the API before completing age/terms verification.
 */
const requireSessionAuthNoConsent = async (req, res, next) => {
  if (!req.session?.user?.id) return res.status(401).json({ error: 'Not authenticated' });
  req.user = req.session.user;
  const userId = req.session.user.id;
  try {
    const banKey = `user:banned:${userId}`;
    const cachedBan = await cache.get(banKey);
    if (cachedBan === 'true') return res.status(403).json({ success: false, error: 'Account suspended.', code: 'BANNED' });
    const { rows } = await getPool().query('SELECT role FROM users WHERE id = $1', [userId]);
    const userRow = rows[0];
    if (userRow?.role === 'banned') {
      await cache.set(banKey, 'true', 120);
      return res.status(403).json({ success: false, error: 'Account suspended.', code: 'BANNED' });
    }
  } catch (err) {
    logger.error('requireSessionAuthNoConsent ban check failed', { userId, error: err.message });
    return res.status(503).json({ success: false, error: 'Service temporarily unavailable', code: 'SERVICE_UNAVAILABLE' });
  }
  next();
};

/**
 * Soft auth — populates req.user from session if present, never blocks
 */
const softAuth = (req, res, next) => {
  if (req.session?.user?.id) {
    req.user = {
      id: req.session.user.id,
      subscriptionStatus: req.session.user.subscription_status || 'free',
    };
  }
  next();
};

// Entitlement gates — route middleware now uses entitlement-based checks.
// requirePrimeTier gates routes that require an active 'prime' entitlement.
// requireMemberTier gates routes that require an active 'pnp-member' entitlement.
// Admins (role=admin|superadmin) always bypass. Banned users get 403 before the check.
const requirePrimeTier = EntitlementAccessService.requireEntitlement('prime');
const requireMemberTier = EntitlementAccessService.requireEntitlement('pnp-member');
// Scoped resource gates — resolve the target resource from req.params and allow
// users who have a scoped entitlement for it, even without pnp-member.
const requireHangoutAccess = EntitlementAccessService.requireResourceAccess('hangout', 'id');
const requireChannelAccess = EntitlementAccessService.requireResourceAccess('channel', 'channelId');

// Rate limiter for page routes (landing pages, policies, etc.)
const pageLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 200, // 200 page requests per 15 min — generous for normal browsing
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests from this IP, please try again later.' },
  skip: (req) => req.path === '/pnp/webhook/telegram', // Skip webhook
});

// ── Colombia access gate ────────────────────────────────────────────────────
// Users whose detected country is 'CO' must hold an active 'pnp-col'
// entitlement to reach any /api/* route. Gate exempts auth, geo, plan
// listing, payment, webhook, health, and CMS endpoints so unsubscribed users
// can still buy the required plan. Admins bypass. Unauthenticated requests
// pass through; downstream auth middleware handles them.
const COLOMBIA_EXEMPT_PREFIXES = [
  '/api/webapp/auth/', '/api/auth-status', '/api/logout', '/api/accept-terms',
  '/api/webapp/geo',
  '/api/subscription/plans', '/api/webapp/plans',
  '/api/payment/', '/api/webapp/payment/', '/api/webapp/payments/',
  '/api/webhook/', '/pnp/webhook/',
  '/api/health', '/health',
  '/api/cms/', '/api/webapp/cms/',
  // Main Stage is free-to-access for everyone, including Colombia users
  // without pnp-col — viewing + going on cam have no tier gates by design.
  '/api/main-stage/',
  // Onboarding must complete before a Colombian user can even purchase pnp-col
  '/api/verify-age-self', '/api/complete-onboarding',
  // Invite links — socios redeem co_only links and claim pending PRIME without pnp-col
  '/api/invite/',
];

async function colombiaAccessGate(req, res, next) {
  const url = req.originalUrl || req.url || '';
  // Scope to /api/* only
  if (!url.startsWith('/api/')) return next();
  // Exempt paths (auth/plans/payment/webhooks/etc.)
  if (COLOMBIA_EXEMPT_PREFIXES.some((p) => url.startsWith(p))) return next();
  // Preflight CORS — let CORS middleware handle it
  if (req.method === 'OPTIONS') return next();

  const user = req.session?.user;
  if (!user?.id) return next(); // Downstream auth decides 401s

  const role = (user.role || '').toLowerCase();
  if (role === 'admin' || role === 'superadmin') return next();

  const ip = req.headers['x-real-ip']
    || req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.ip;
  const geo = geoip.lookup(ip);
  const country = geo?.country || user.country || null;
  if (country !== 'CO') return next();

  try {
    const has = await EntitlementAccessService.hasEntitlement(user.id, 'pnp-col');
    if (has) return next();
  } catch (err) {
    logger.error('[ColombiaGate] entitlement check failed', { userId: user.id, error: err.message });
    // Fail closed for CO users when the check errors — safer than leaking access
  }

  return res.status(403).json({
    success: false,
    error: 'PNP Col subscription required for users in Colombia',
    code: 'PNP_COL_REQUIRED',
    country: 'CO',
    upgradeUrl: '/subscribe?plan=pnp_col',
  });
}

// ── Geo country detection endpoint ──────────────────────────────────────────
// Used by the frontend to determine if the user is in a LATAM country so
// specific features (Social, Hangouts, Channels, Live) can be gated unless
// the user holds a PRIME membership.
// No auth required — IP is the only input.
// Route registered below after session middleware is set up.

const getActorId = (req) => String(req.user?.id || req.user?.userId || '');

const requireSelfOrAdmin = async (req, res, next) => {
  try {
    const actorId = getActorId(req);
    if (!actorId) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const targetUserId = String(req.params.userId || req.body?.userId || '');
    if (!targetUserId) {
      return res.status(400).json({ success: false, error: 'userId is required' });
    }

    if (actorId === targetUserId) {
      return next();
    }

    const isAdmin = await PermissionService.isAdmin(actorId);
    if (!isAdmin) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }

    return next();
  } catch (error) {
    logger.error('requireSelfOrAdmin middleware error', { error: error.message });
    return res.status(500).json({ success: false, error: 'Authorization check failed' });
  }
};

const bindAuthenticatedUserId = (req, res, next) => {
  const actorId = getActorId(req);
  if (!actorId) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }
  if (!req.body || typeof req.body !== 'object') {
    req.body = {};
  }
  req.body.userId = actorId;
  return next();
};

const app = express();

// Initialize Sentry for error tracking
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV,
    integrations: [
      new Sentry.Integrations.Http({ tracing: true }),
      new Sentry.Integrations.Express({ app }),
    ],
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
  });
  app.use(Sentry.Handlers.requestHandler());
  app.use(Sentry.Handlers.tracingHandler());
  logger.info('Sentry error tracking initialized');
}

// Trust proxy - required for secure cookies and rate limiting behind reverse proxy
// Traefik (host mode, SSL termination) → nginx (sets X-Forwarded-Proto: https) → Express
// nginx is the only proxy that sets forwarded headers, so trust 1 hop.
app.set('trust proxy', 1);

// CRITICAL: Apply body parsing FIRST for ALL routes
// This must be before any route registration
// verify callback saves rawBody on req for webhook HMAC validation (BTCPay, etc.)
app.use(express.json({
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  },
}));
app.use(express.urlencoded({ extended: true }));

// Guard: unwrap double-stringified JSON bodies (e.g. `"{\"mode\":\"mentions\"}"`)
// Some clients or proxies may stringify the body twice; detect and fix silently.
app.use((req, _res, next) => {
  if (req.body && typeof req.body === 'string') {
    try { req.body = JSON.parse(req.body); } catch { /* leave as-is */ }
  }
  next();
});

// Session middleware for Telegram auth with Redis store
const redisClient = getRedis();
const resolvedSessionSecret = process.env.SESSION_SECRET;

if (!resolvedSessionSecret) {
  throw new Error('SESSION_SECRET must be configured (separate from JWT_SECRET)');
}
// Session middleware with explicit response hooks to ensure Set-Cookie header is set
// SESSION_TTL: 7 days (was 90). `rolling: true` refreshes TTL on every
// request, so active users stay logged in indefinitely but stolen/abandoned
// cookies expire within a week. Override via SESSION_TTL env var (seconds).
const SESSION_TTL_SECONDS = parseInt(process.env.SESSION_TTL, 10) || 7 * 86400;
const sessionMiddleware = session({
  store: new RedisStore({ client: redisClient, prefix: 'sess:', ttl: SESSION_TTL_SECONDS }),
  secret: resolvedSessionSecret,
  resave: false,
  saveUninitialized: false,
  rolling: true, // Refresh session TTL on each request — active users never expire
  name: '__pnptv_sid',
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: SESSION_TTL_SECONDS * 1000,
    path: '/',
    domain: process.env.NODE_ENV === 'production' ? '.pnptv.app' : undefined
  }
});

app.use(sessionMiddleware);
app.use(ipTracker); // Log every authenticated request IP for security

// Geo-block for jurisdictions with hostile age-verification regimes.
//
// 2026-05-07 — blocks reinstated. States with active, enforced age-verification
// laws as of May 2026: TX (HB 1181 — AG sued Pornhub), LA (RS 14:91.14 — first
// state, active enforcement), UT (SB 287), VA (HB 1515), IN, AR, MS, NC,
// TN (Protect Tennessee Minors Act — hourly re-verify + 7yr data retention),
// FL (HB 3). UK (Online Safety Act 2023 / Ofcom HEAA).
//
// Soft bypass: users who are misidentified by mobile-carrier exit nodes
// (T-Mobile/AT&T/Verizon route via TX regardless of actual location) can
// self-certify via POST /api/public/geo-bypass, which sets a session flag
// allowing them through. This is legally defensible — the platform made a
// good-faith block; the user self-certified a location error.
//
// Returns 451 (Unavailable For Legal Reasons) on API; redirects to a static
// /blocked-jurisdiction page on browser navigation. Admins bypass for debug.
// Cached per-IP in Redis 1h to avoid the geoip lookup on every request.
// (geoip module is already required at the top of the file — reuse it.)
const BLOCKED_US_REGIONS = new Set();
// CO + VE geo-blocks lifted 2026-06-18 — full open access.
const BLOCKED_COUNTRIES = new Set();
// Per-user geo-block whitelist — bypasses the hard country block for specific user IDs.
const GEO_BLOCK_USER_WHITELIST = new Set(['7246621722', '8599671840']); // PNPLatinoBoy, SantinoFurioso
const GEO_BLOCK_BYPASS_PATHS = [
  /^\/blocked-jurisdiction$/,
  /^\/health$/,
  /^\/api\/health\b/,
  /^\/auth\//,                  // login flow stays open so admins can sign in
  /^\/assets\//,
  /^\/sw\.js$/,
  /^\/favicon\.ico$/,
  // Webhooks must never be geo-blocked. Telegram's server IPs sometimes
  // resolve to GB or other blocked regions in the offline GeoIP DB; if we
  // 451 those, the bot stops receiving updates and the platform goes dark
  // for everyone. Same for ePayco/BTCPay/Meru — payment provider servers
  // shouldn't be blocked even if their IP geolocates oddly.
  /^\/webhook\b/,
  /^\/api\/webhooks?\b/,
  // Bypass endpoint must be reachable from the blocked page itself
  /^\/api\/public\/geo-bypass$/,
  // Geo invite token redemption must be reachable before the block fires
  /^\/api\/public\/geo-invite\//,
  // lifetime100 purchase flow is exempt by operator policy
  /^\/api\/public\/lifetime100\b/,
];
function classifyGeo(ip) {
  if (!ip) return null;
  const cleanIp = ip.replace(/^::ffff:/, '');
  const lookup = geoip.lookup(cleanIp);
  if (!lookup) return null;
  const country = lookup.country;
  const region = lookup.region || '';
  if (BLOCKED_COUNTRIES.has(country)) {
    return { blocked: true, country, region, reason: 'UK_OSA' };
  }
  if (country === 'US' && BLOCKED_US_REGIONS.has(region)) {
    return { blocked: true, country, region, reason: `US_${region}_AGE_VERIFICATION` };
  }
  return { blocked: false, country, region };
}

// Bypass endpoint — must be registered BEFORE the geo-block middleware so that
// it is also reachable when the geo-block would otherwise fire (belt-and-
// suspenders alongside the GEO_BLOCK_BYPASS_PATHS regex above).
app.post('/api/public/geo-bypass', (req, res) => {
  // User self-certifies their GeoIP result is wrong (carrier/VPN exit node).
  // We record the acknowledgement in their session (24h rolling).
  req.session.geoBypass = true;
  req.session.geoBypassAt = Date.now();
  req.session.save((err) => {
    if (err) {
      logger.warn('[geo-bypass] session save failed', { error: err.message, ip: req.ip });
    }
    return res.json({ success: true });
  });
});

// Geo invite token redemption — must be registered BEFORE the geo-block middleware.
// Admin creates a token via POST /api/admin/geo-invite; user visits the link from
// the blocked-jurisdiction page; token is validated, session is flagged, user is
// redirected to /.
app.get('/api/public/geo-invite/:token', asyncHandler(async (req, res) => {
  const { token } = req.params;
  if (!token || !/^[a-f0-9]{32}$/.test(token)) {
    return res.redirect(302, '/blocked-jurisdiction?err=invalid_invite');
  }
  const row = await dbQuery(
    `SELECT id, countries, max_uses, uses_count, is_active, expires_at
     FROM geo_invite_tokens
     WHERE token = $1`,
    [token]
  );
  const invite = row.rows[0];
  if (!invite || !invite.is_active) {
    return res.redirect(302, '/blocked-jurisdiction?err=invalid_invite');
  }
  if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
    return res.redirect(302, '/blocked-jurisdiction?err=expired_invite');
  }
  if (invite.uses_count >= invite.max_uses) {
    return res.redirect(302, '/blocked-jurisdiction?err=invite_used');
  }
  // Increment uses, auto-deactivate if exhausted
  await dbQuery(
    `UPDATE geo_invite_tokens
     SET uses_count = uses_count + 1,
         is_active  = CASE WHEN uses_count + 1 >= max_uses THEN false ELSE true END
     WHERE id = $1`,
    [invite.id]
  );
  req.session.geoInviteBypass = true;
  req.session.geoInviteToken  = token;
  req.session.save((err) => {
    if (err) logger.warn('[geo-invite] session save failed', { error: err.message, ip: req.ip });
    return res.redirect(302, '/');
  });
}));

// Admin: create geo invite token
app.post('/api/admin/geo-invite', adminGuard, asyncHandler(async (req, res) => {
  const { countries = ['CO', 'VE'], max_uses = 1, notes = '', expires_at = null } = req.body;
  const crypto = require('crypto');
  const token = crypto.randomBytes(16).toString('hex'); // 32-char hex
  const adminId = req.session.user.id;
  await dbQuery(
    `INSERT INTO geo_invite_tokens (token, countries, created_by, max_uses, notes, expires_at)
     VALUES ($1, $2::text[], $3, $4, $5, $6)`,
    [token, countries, adminId, max_uses, notes || null, expires_at || null]
  );
  const APP_URL = process.env.APP_URL || 'https://pnptv.app';
  return res.json({
    success: true,
    token,
    url: `${APP_URL}/api/public/geo-invite/${token}`,
    countries,
    max_uses,
  });
}));

// Admin: list geo invite tokens
app.get('/api/admin/geo-invite', adminGuard, asyncHandler(async (req, res) => {
  const rows = await dbQuery(
    `SELECT g.id, g.token, g.countries, g.max_uses, g.uses_count, g.is_active,
            g.notes, g.expires_at, g.created_at, u.username AS created_by_username
     FROM geo_invite_tokens g
     LEFT JOIN users u ON u.id = g.created_by
     ORDER BY g.created_at DESC
     LIMIT 100`
  );
  const APP_URL = process.env.APP_URL || 'https://pnptv.app';
  return res.json({
    tokens: rows.rows.map(r => ({
      ...r,
      url: `${APP_URL}/api/public/geo-invite/${r.token}`,
    })),
  });
}));

const { cache: geoCache } = require('../../config/redis');
app.use(async (req, res, next) => {
  if (GEO_BLOCK_BYPASS_PATHS.some(rx => rx.test(req.path))) return next();
  // Admin bypass — once authenticated, admins can travel into blocked regions
  // to debug. Pre-auth requests fall through to the geo check.
  if (req.session?.user?.role === 'admin' || req.session?.user?.role === 'superadmin') return next();
  if (req.session?.user?.id && GEO_BLOCK_USER_WHITELIST.has(String(req.session.user.id))) return next();

  // User-acknowledged bypass — session flag set via POST /api/public/geo-bypass.
  // Honour it for up to 24h so carrier-misidentified users are not repeatedly
  // blocked throughout the same session.
  if (req.session?.geoBypass === true) {
    const bypassAge = Date.now() - (req.session.geoBypassAt || 0);
    if (bypassAge < 24 * 60 * 60 * 1000) return next();
    // Expired — clear and fall through to re-evaluate
    delete req.session.geoBypass;
    delete req.session.geoBypassAt;
  }

  // Admin-issued geo invite bypass — set by GET /api/public/geo-invite/:token.
  // Valid for the lifetime of the session (no expiry — user redeemed a real invite).
  if (req.session?.geoInviteBypass === true) return next();

  // NOTE: paying users are NOT grandfathered. Per platform policy, the
  // geo-block applies uniformly to everyone in blocked jurisdictions —
  // including existing PRIME members. The block page explains the situation
  // and offers the self-certification bypass for carrier-misidentified users.
  // Refunds for genuinely blocked users are handled at support@pnptv.app.

  try {
    const ip = req.ip;
    const cacheKey = `geoblock:${ip}`;
    let cached = await geoCache.get(cacheKey);
    let result;
    if (cached) {
      result = typeof cached === 'string' ? JSON.parse(cached) : cached;
    } else {
      result = classifyGeo(ip);
      if (result) await geoCache.set(cacheKey, JSON.stringify(result), 3600);
    }
    if (result?.blocked) {
      logger.info('Geo-block triggered', { ip, country: result.country, region: result.region, path: req.path });
      if (req.path.startsWith('/api/')) {
        return res.status(451).json({
          error: `This service is not available in your jurisdiction (${result.country}${result.region ? '/' + result.region : ''}) due to local age-verification laws.`,
          code: 'GEO_BLOCKED',
          reason: result.reason,
          jurisdiction: result.region || result.country,
        });
      }
      const jParam = encodeURIComponent(result.region || result.country);
      return res.redirect(302, `/blocked-jurisdiction?j=${jParam}`);
    }
  } catch (err) {
    logger.warn('Geo-block check failed open', { error: err.message });
  }
  return next();
});

// Wellness Mode is now an opt-in surface only. The /wellness page and the
// /api/webapp/wellness-mode/* enable/disable endpoints stay, but no hard
// gate forces wellness-mode users off other routes — users only see the
// wellness shell when they navigate to it themselves.

// express-session handles Set-Cookie automatically — no custom middleware needed

// Geo country detection endpoint retained for compatibility.
// Country-based access restrictions are disabled, so access flags always fail open.
app.get('/api/webapp/geo', asyncHandler(async (req, res) => {
  const ip = req.headers['x-real-ip'] || req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
  const geo = geoip.lookup(ip);
  const country = geo?.country || null;
  const isColombia = country === 'CO';
  let hasPnpCol = false;
  const userId = req.session?.user?.id;
  if (isColombia && userId) {
    try {
      hasPnpCol = await EntitlementAccessService.hasEntitlement(userId, 'pnp-col');
    } catch (err) {
      logger.warn('[geo] pnp-col entitlement check failed', { userId, error: err.message });
    }
  }
  return res.json({
    country,
    isLatam: false,
    landingMode: false,
    isColombia,
    hasPnpCol,
    requiresPnpCol: isColombia && !hasPnpCol,
  });
}));


// Function to conditionally apply middleware (skip for Telegram webhook)
const conditionalMiddleware = (middleware) => (req, res, next) => {
  // Skip middleware for Telegram webhook to prevent connection issues
  if (req.path === '/pnp/webhook/telegram') {
    return next();
  }
  return middleware(req, res, next);
};

// Security middleware - MUST be before any route registration
app.use(conditionalMiddleware(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        "'unsafe-inline'",
        "'unsafe-eval'",
        "https://code.jquery.com",
        "https://telegram.org",
      ],
      styleSrc: ["'self'", "'unsafe-inline'", "https:", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https:", "https://fonts.gstatic.com", "data:"],
      imgSrc: ["'self'", "data:", "https://t.me", "https://*.telegram.org", "https:"],
      connectSrc: [
        "'self'",
        "https://fonts.googleapis.com",
        "https://fonts.gstatic.com",
        "https://oauth.telegram.org",
        "https://api.telegram.org",
        "wss://livekit.pnptv.app",
        "https://livekit.pnptv.app",
      ],
      frameSrc: [
        "'self'",
        "https://oauth.telegram.org",
        "https://telegram.org",
      ],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      scriptSrcAttr: ["'unsafe-inline'"],
      upgradeInsecureRequests: [],
    },
  },
})));

// tus preflight — must run before the global CORS middleware which would absorb OPTIONS
// and not forward it to our app.options() route handler.
app.options('/api/webapp/creator/media/tus', (req, res) => {
  res.setHeader('Tus-Resumable', '1.0.0');
  res.setHeader('Tus-Version', '1.0.0');
  res.setHeader('Tus-Max-Size', '10737418240');
  res.setHeader('Tus-Extension', 'creation,termination');
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'OPTIONS, POST, HEAD, PATCH');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Tus-Resumable, Upload-Length, Upload-Metadata, Upload-Offset, Content-Length, X-CSRF-Token');
  res.setHeader('Access-Control-Expose-Headers', 'Location, Tus-Resumable, Upload-Offset, Upload-Length');
  res.setHeader('Access-Control-Max-Age', '86400');
  return res.status(204).end();
});

// CORS with whitelist (security fix: prevent cross-origin attacks)
app.use(conditionalMiddleware(cors({
  origin: [
    'https://app.pnptv.app',
    'https://pnptv.app',
    'https://www.pnptv.app',
    'https://t.me',
    ...(process.env.NODE_ENV !== 'production' ? ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:3000'] : [])
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'Tus-Resumable', 'Upload-Length', 'Upload-Metadata', 'Upload-Offset'],
  exposedHeaders: ['Location', 'Tus-Resumable', 'Upload-Offset', 'Upload-Length'],
  maxAge: 86400, // 24 hours
})));

app.use(conditionalMiddleware(compression()));

// Logging (before other middleware for accurate request tracking)
// 'short' omits the Authorization header that 'combined' would include in logs
app.use(morgan('short', {
  stream: logger.stream,
  skip: (req, res) => req.path === '/api/auth/validate-hls' && res.statusCode === 401,
}));

// Track user last_active — throttled to once per hour per user via Redis
app.use((req, res, next) => {
  const userId = req.session?.user?.id;
  if (!userId) return next();
  const key = `last_active:${userId}`;
  cache.get(key).then(val => {
    if (val) return; // already tracked within last hour
    cache.set(key, '1', 3600).catch(() => {});
    getPool().query('UPDATE users SET last_active = NOW() WHERE id = $1', [userId]).catch(() => {});
  }).catch(() => {});
  next();
});

// ========== PAYMENT ROUTES (BEFORE static middleware) ==========
// These must be BEFORE serveStaticWithBlocking to ensure they're processed first

const CHECKOUT_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://code.jquery.com",
  "style-src 'self' 'unsafe-inline' https: https://fonts.googleapis.com",
  "font-src 'self' https: https://fonts.gstatic.com data:",
  "img-src 'self' https: data:",
  "connect-src 'self' https:",
  "frame-src https:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self' https:",
  "script-src-attr 'unsafe-inline'",
].join(';');

function sendCheckoutHtml(res, file) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Content-Security-Policy', CHECKOUT_CSP);
  res.sendFile(path.join(__dirname, '../../../public/' + file));
}

app.get('/payment/:paymentId', (req, res) => {
  sendCheckoutHtml(res, 'payment-checkout.html');
});

// PNPtv Smart Checkout v2 (must be before /checkout/:paymentId)
app.get('/checkout/pnp', (req, res) => {
  sendCheckoutHtml(res, 'payment-checkout.html');
});

app.get('/checkout/:paymentId', (req, res) => {
  sendCheckoutHtml(res, 'payment-checkout.html');
});

app.get('/api/pnp/checkout', (req, res) => {
  sendCheckoutHtml(res, 'payment-checkout.html');
});
// ========== END PAYMENT ROUTES ==========

// Protected paths that require authentication (don't serve static files directly)
// All /uploads/* paths holding KYC / ID docs MUST be listed here — they are then
// served only via admin-guarded routes below.
const PROTECTED_PATHS = ['/hangouts', '/live', '/pnplive', '/uploads/creator-2257', '/uploads/creator-enrollments', '/uploads/model-applications'];

// Custom static file middleware with easybots.store blocking and protected path exclusion
const serveStaticWithBlocking = (staticPath) => {
  return (req, res, next) => {
    const host = req.get('host') || '';

    // Skip static serving for root path — let the app.get('/') route handle the redirect
    if (req.path === '/') {
      return next();
    }

    // Skip static serving for protected paths (let auth routes handle them)
    // But allow assets (/hangouts/assets/, /live/assets/)
    const isProtectedPath = PROTECTED_PATHS.some(p =>
      req.path === p ||
      req.path === p + '/' ||
      (req.path.startsWith(p + '/') && !req.path.includes('/assets/'))
    );
    if (isProtectedPath) {
      return next();
    }

    // Block easybots.store from accessing PNPtv static files
    if (host.includes('easybots.store') || host.includes('easybots')) {
      // Define specific payment-related HTML files that should be allowed
      const allowedPaymentHtmls = [
        'payment-checkout.html',
      ];

      // Check if the request path ends with one of the allowed payment HTML files
      const isAllowedPaymentHtml = allowedPaymentHtmls.some(fileName => req.path.endsWith('/' + fileName));

      const isPnptvStaticFile = req.path.endsWith('.html') ||
                                req.path.endsWith('.css') ||
                                req.path.endsWith('.js') ||
                                req.path.endsWith('.jpg') ||
                                req.path.endsWith('.png') ||
                                req.path.endsWith('.gif') ||
                                req.path.endsWith('.svg') ||
                                req.path.endsWith('.ico') ||
                                req.path.endsWith('.webp') ||
                                req.path.endsWith('.mp4') ||
                                req.path.endsWith('.webm');

      // Block if it's a general PNPtv static file AND not one of the specifically allowed payment HTMLs
      if (isPnptvStaticFile && req.path !== '/' && !isAllowedPaymentHtml) {
        return res.status(404).send('Not found');
      }
    }

    express.static(staticPath, { fallthrough: true })(req, res, next);
  };
};

// Subscription/pricing page
app.get('/suscripcion', (req, res) => {
  res.sendFile(path.join(__dirname, '../../../public/suscripcion.html'));
});

// Alias for subscription page (English)
app.get('/subscription', (req, res) => {
  res.redirect(301, '/suscripcion');
});

// Shorthand alias → lifetime100
app.get('/lifetime', (req, res) => res.redirect(302, 'https://app.pnptv.app/lifetime100'));

// LIFETIME100 — redirect to the React SPA, preserving any query string
app.get('/lifetime100', (req, res) => {
  const host = req.get('host') || '';
  if (host.includes('easybots.store') || host.includes('easybots')) {
    return res.status(404).send('Not found');
  }
  const qs = req.url.includes('?') ? '?' + req.url.split('?')[1] : '';
  return res.redirect(302, 'https://app.pnptv.app/lifetime100' + qs);
});

// ── CMS asset proxy ──────────────────────────────────────────────────────────
// Campaign videos reference cms.pnptv.app/assets/<id>.  This route allows
// tweets to link to pnptv.app/cms/assets/<id>.
app.get('/cms/assets/:assetId', async (req, res) => {
  const assetId = req.params.assetId;
  if (!/^[a-f0-9-]+$/i.test(assetId)) return res.status(400).send('Invalid asset ID');
  try {
    const directusUrl = process.env.DIRECTUS_INTERNAL_URL || 'http://directus:8055';
    const upstream = await axios.get(`${directusUrl}/assets/${assetId}`, {
      responseType: 'stream',
      timeout: 30000,
    });
    res.set('Content-Type', upstream.headers['content-type'] || 'application/octet-stream');
    if (upstream.headers['content-length']) res.set('Content-Length', upstream.headers['content-length']);
    res.set('Cache-Control', 'public, max-age=86400');
    upstream.data.pipe(res);
  } catch (err) {
    res.status(err.response?.status || 502).send('Asset unavailable');
  }
});

// Video access guard — multiple layers:
//   1. Hotlink protection: reject requests from external Referer (allows
//      same-origin and direct fetches; blocks <video src="..."> embeds on
//      third-party sites)
//   2. Exclusive-content gate: mirrors getPost access logic — admin OR author
//      OR prime tier — but uses validateTierFresh to defeat stale sessions
//      (a user whose PRIME just expired must not get in via a cached cookie)
//   3. Rate-limit: per-user/IP cap on video fetches to deter bulk scraping
//
// Non-exclusive videos pass through (preserves preview/og:video flows) but
// still get the hotlink + rate-limit checks.
//
// Cache the post-metadata lookup for 60s — video players send many range-
// request fetches per playback and we don't want each one to hit Postgres.
const VIDEO_PATH_RE = /^\/uploads\/posts\/((?:vid-|thumb-vid-)[^/]+\.(?:mp4|webm|mov|jpg))$/i;
const videoMetaCache = new Map(); // url → { isExclusive, authorId, expiresAt }
const VIDEO_FETCH_RATE_LIMIT = parseInt(process.env.VIDEO_FETCH_RATE_LIMIT || '1500', 10);
const VIDEO_FETCH_RATE_WINDOW_SEC = 60 * 60; // 1 hour
const { query: videoGuardQuery } = require('../../config/postgres');
const { validateTierFresh: videoGuardValidateTier } = require('../../services/accessService');
const { cache: videoGuardCache, getRedis: videoGuardGetRedis } = require('../../config/redis');

// Purge video_fetch_log rows older than 90 days. Runs once on startup then daily.
const _runVideoFetchLogCleanup = () => {
  videoGuardQuery(`DELETE FROM video_fetch_log WHERE fetched_at < NOW() - INTERVAL '90 days'`)
    .catch(e => logger.warn('video_fetch_log cleanup error', { error: e.message }));
};
_runVideoFetchLogCleanup();
setInterval(_runVideoFetchLogCleanup, 24 * 60 * 60 * 1000);

const allowedHotlinkHosts = new Set([
  'app.pnptv.app',
  'pnptv.app',
  'www.pnptv.app',
  'auth.pnptv.app',
  'cms.pnptv.app',
]);

app.use(async (req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  if (!VIDEO_PATH_RE.test(req.path)) return next();

  // Layer 1: Hotlink protection. Allow direct fetches (no Referer) and
  // same-origin Referers. Block external embeds. Range-request bursts within
  // a single playback all carry the same Referer so this is consistent.
  const referer = req.get('Referer') || req.get('Referrer') || '';
  if (referer) {
    try {
      const refHost = new URL(referer).hostname;
      if (!allowedHotlinkHosts.has(refHost)) {
        logger.info('Video hotlink blocked', { path: req.path, refererHost: refHost, ip: req.ip });
        return res.status(403).json({ error: 'Hotlinking not allowed' });
      }
    } catch {
      // Malformed Referer — treat as suspicious, block.
      return res.status(403).json({ error: 'Invalid referer' });
    }
  }

  // Layer 3 (run before DB lookup so scrapers don't get free DB pressure):
  // rate-limit per session-user-id, falling back to IP. Backed by Redis so
  // it survives bot restarts — a brief restart used to reset all attackers'
  // counters with the in-memory map.
  const rateKey = `videofetch:${req.session?.user?.id ? `u:${req.session.user.id}` : `ip:${req.ip}`}`;
  const now = Date.now();
  try {
    const count = await videoGuardCache.incr(rateKey, VIDEO_FETCH_RATE_WINDOW_SEC);
    if (count > VIDEO_FETCH_RATE_LIMIT) {
      logger.warn('Video fetch rate limit exceeded', { rateKey, count, path: req.path });
      return res.status(429).json({ error: 'Too many video requests. Try again later.' });
    }
  } catch (rateErr) {
    // If Redis is down, fail open (don't block legitimate viewers). Logged.
    logger.warn('Video rate-limit Redis error — failing open', { error: rateErr.message });
  }

  try {
    const url = req.path;
    let entry = videoMetaCache.get(url);
    if (!entry || entry.expiresAt < now) {
      const { rows } = await videoGuardQuery(
        `SELECT user_id AS author_id, is_exclusive, COALESCE(content_tier, 'free') AS tier
         FROM social_posts WHERE media_url = $1 AND is_deleted = false
         UNION ALL
         SELECT user_id AS author_id, is_exclusive, COALESCE(content_tier, 'free') AS tier
         FROM social_posts WHERE video_thumbnail_url = $1 AND is_deleted = false
         LIMIT 1`,
        [url]
      );
      const r = rows[0];
      entry = {
        // Treat unknown rows as non-exclusive (legacy uploads not tied to a post)
        isExclusive: r ? (r.is_exclusive === true || (r.tier || '').toLowerCase() === 'prime') : false,
        authorId: r ? String(r.author_id) : null,
        expiresAt: now + 60_000,
      };
      videoMetaCache.set(url, entry);
      // Keep the cache from growing unbounded — drop oldest 200 once over 1000.
      if (videoMetaCache.size > 1000) {
        const drop = [...videoMetaCache.entries()]
          .sort((a, b) => a[1].expiresAt - b[1].expiresAt).slice(0, 200);
        for (const [k] of drop) videoMetaCache.delete(k);
      }
    }

    // View logging — record every fetch for leak detection. Deduped per
    // (viewer, url) over 5 min via Redis SET-NX so a single playback's 50+
    // range requests count as ONE view. Fire-and-forget: failures don't block.
    try {
      const viewerKey = req.session?.user?.id || `ip:${req.ip}`;
      const dedupeKey = `videolog:${viewerKey}:${url}`;
      const redis = videoGuardGetRedis();
      const set = await redis.set(dedupeKey, '1', 'EX', 300, 'NX');
      if (set === 'OK') {
        videoGuardQuery(
          `INSERT INTO video_fetch_log (media_url, user_id, ip_address) VALUES ($1, $2, $3)`,
          [url, req.session?.user?.id || null, req.ip || null]
        ).catch(() => {});
      }
    } catch { /* logging failure is never fatal */ }

    // Helper: hand off to R2 with a presigned URL. TTL varies by content tier.
    // Falls through to express.static (disk) on any error.
    const tryR2Redirect = async (ttlSeconds = 3600) => {
      try {
        const objectStorage = require('../../services/objectStorageService');
        if (!objectStorage.isConfigured()) return false;
        const key = objectStorage.keyForMediaUrl(req.path);
        if (!key) return false;
        if (entry.r2Status === undefined) {
          entry.r2Status = await objectStorage.exists(key) ? 'present' : 'missing';
        }
        if (entry.r2Status !== 'present') return false;
        const url = await objectStorage.getPresignedUrl(key, ttlSeconds);
        res.set('Cache-Control', 'private, no-store, max-age=0');
        res.redirect(302, url);
        return true;
      } catch (r2Err) {
        logger.warn('R2 redirect failed — falling back to disk', { path: req.path, error: r2Err.message });
        return false;
      }
    };

    if (!entry.isExclusive) {
      // Public videos: try R2 redirect first (saves bandwidth + faster CDN),
      // fall through to disk otherwise.
      if (await tryR2Redirect(3600)) return;
      return next();
    }

    // Exclusive content from here on: prevent intermediate caching.
    res.set('Cache-Control', 'private, no-store, max-age=0');

    // Layer 2: Mirror getPost access logic — admin OR author OR prime tier.
    const viewerId = req.session?.user?.id;
    if (!viewerId) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const viewerRole = req.session?.user?.role || '';
    const passEntitlement = async () => {
      if (viewerRole === 'admin' || viewerRole === 'superadmin') return true;
      if (entry.authorId && String(viewerId) === entry.authorId) return true;
      const sessionTier = (req.session?.user?.tier || 'free').toLowerCase();
      const freshTier = await videoGuardValidateTier(viewerId, sessionTier);
      if (freshTier === 'prime') {
        if (sessionTier !== freshTier && req.session?.user) {
          req.session.user.tier = freshTier;
        }
        return true;
      }
      return false;
    };

    if (await passEntitlement()) {
      // Authorized — use 5-min TTL for exclusive content to limit URL sharing window
      if (await tryR2Redirect(300)) return;
      return next();
    }

    return res.status(403).json({ error: 'Active PRIME membership required for this content' });
  } catch (err) {
    logger.error('Video access guard error', { error: err.message, path: req.path });
    // Fail open ONLY for non-exclusive content — for exclusive we already
    // know the post is exclusive (otherwise we'd have returned next() above).
    // If we got here on an exception in the auth path, default to deny.
    return res.status(500).json({ error: 'Access check failed' });
  }
});

// ── Private upload auth guard ──────────────────────────────────────────────
// DM media, chat files, and hangout media are private — require a valid
// session. Registered BEFORE express.static so the check runs first.
const PRIVATE_UPLOAD_PREFIXES = ['/uploads/dm-media/', '/uploads/chat/', '/uploads/hangouts/', '/uploads/creator-media/'];
app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  if (!PRIVATE_UPLOAD_PREFIXES.some(p => req.path.startsWith(p))) return next();
  if (!req.session?.user?.id) return res.status(401).json({ error: 'Authentication required' });
  return next();
});

// Serve static files from public directory with blocking
app.use(serveStaticWithBlocking(path.join(__dirname, '../../../../public')));

// Serve static auth pages with blocking
app.use('/auth', serveStaticWithBlocking(path.join(__dirname, '../../../../public/auth')));

// Explicit routes for auth pages without .html extension
app.get('/auth/telegram-login-complete', (req, res) => {
  const host = req.get('host') || '';
  if (host.includes('easybots.store') || host.includes('easybots')) {
    return res.status(404).send('Page not found.');
  }
  res.redirect(302, '/auth/telegram-login-complete.html');
});

app.get('/auth/telegram-login', (req, res) => {
  const host = req.get('host') || '';
  if (host.includes('easybots.store') || host.includes('easybots')) {
    return res.status(404).send('Page not found.');
  }
  res.redirect(302, '/auth/telegram-login.html');
});

app.get('/auth/terms', (req, res) => {
  const host = req.get('host') || '';
  if (host.includes('easybots.store') || host.includes('easybots')) {
    return res.status(404).send('Page not found.');
  }
  res.redirect(302, '/auth/terms.html');
});

app.get('/auth/not-registered', (req, res) => {
  const host = req.get('host') || '';
  if (host.includes('easybots.store') || host.includes('easybots')) {
    return res.status(404).send('Page not found.');
  }
  res.redirect(302, '/auth/not-registered.html');
});

// Portal dashboard - shows after login with navigation buttons
app.get('/portal', pageLimiter, (req, res) => {
  const host = req.get('host') || '';
  if (host.includes('easybots.store') || host.includes('easybots')) {
    return res.status(404).send('Page not found.');
  }
  res.sendFile(path.join(__dirname, '../../../public/portal.html'));
});

// Nearby feature - map-based user discovery
app.get('/nearby', pageLimiter, (req, res) => {
  const host = req.get('host') || '';
  if (host.includes('easybots.store') || host.includes('easybots')) {
    return res.status(404).send('Page not found.');
  }
  res.sendFile(path.join(__dirname, '../../../public/nearby.html'));
});

// Landing page routes
// Home page — serve login page directly; if already authenticated send to React SPA
app.get('/', (req, res) => {
  // Authenticated → go to the React SPA
  if (req.session?.user) {
    return res.redirect(302, 'https://pnptv.app');
  }
  // Not authenticated → show login
  return res.sendFile(path.join(__dirname, '../../../public/login.html'));
});

// /login → same behaviour as /
app.get('/login', (req, res) => {
  if (req.session?.user) {
    return res.redirect(302, 'https://pnptv.app');
  }
  return res.sendFile(path.join(__dirname, '../../../public/login.html'));
});



// Community Features page
app.get('/community-features', (req, res) => {
  const host = req.get('host') || '';
  if (host.includes('easybots.store') || host.includes('easybots')) {
    return res.status(404).send('Not found');
  }
  res.redirect(302, '/community-features.html');
});

// How to Use page (Bilingual) - routes to pnptv.app
app.get('/how-to-use', (req, res) => {
  const host = req.get('host') || '';
  if (host.includes('easybots.store') || host.includes('easybots')) {
    return res.status(404).send('Not found');
  }
  res.redirect(302, '/how-to-use.html');
});



// Terms and Conditions / Privacy Policy
app.get('/terms', pageLimiter, (req, res) => {
  const host = req.get('host') || '';
  if (host.includes('easybots.store') || host.includes('easybots')) {
    return res.sendFile(path.join(__dirname, '../../../public/easybots-terms.html'));
  }
  const lang = req.query.lang || 'en';
  const fileName = lang === 'es' ? 'policies_es.html' : 'terms.html';
  res.sendFile(path.join(__dirname, `../../../public/${fileName}`));
});

app.get('/privacy', pageLimiter, (req, res) => {
  const host = req.get('host') || '';
  if (host.includes('easybots.store') || host.includes('easybots')) {
    return res.sendFile(path.join(__dirname, '../../../public/easybots-terms.html'));
  }
  const lang = req.query.lang || 'en';
  const fileName = lang === 'es' ? 'policies_es.html' : 'privacy.html';
  res.sendFile(path.join(__dirname, `../../../public/${fileName}`));
});

app.get('/policies', pageLimiter, (req, res) => {
  const host = req.get('host') || '';
  if (host.includes('easybots.store') || host.includes('easybots')) {
    return res.sendFile(path.join(__dirname, '../../../public/easybots-terms.html'));
  }
  const lang = req.query.lang || 'en';
  const fileName = lang === 'es' ? 'policies_es.html' : 'terms.html';
  res.sendFile(path.join(__dirname, `../../../public/${fileName}`));
});

// Contact page
app.get('/contact', pageLimiter, (req, res) => {
  const host = req.get('host') || '';
  if (host.includes('easybots.store') || host.includes('easybots')) {
    return res.sendFile(path.join(__dirname, '../../../public/easybots-contact.html'));
  }
  res.sendFile(path.join(__dirname, '../../../public/contact.html'));
});

// Legal pages (cookies, community guidelines, content policy, refunds, subscriptions, creator terms, DMCA, safety)
const legalPages = {
  '/cookies': 'cookies.html',
  '/community-guidelines': 'community-guidelines.html',
  '/content-policy': 'content-policy.html',
  '/refunds': 'refunds.html',
  '/subscriptions': 'subscriptions.html',
  '/creator-terms': 'creator-terms.html',
  '/dmca': 'content-policy.html',  // DMCA is covered in content policy
  '/safety': 'safety.html',
  '/blocked-jurisdiction': 'blocked-jurisdiction.html',
};
for (const [route, file] of Object.entries(legalPages)) {
  app.get(route, pageLimiter, (req, res) => {
    res.sendFile(path.join(__dirname, `../../../public/${file}`));
  });
}

// Age Verification page
app.get('/age-verification', pageLimiter, (req, res) => {
  const host = req.get('host') || '';
  if (host.includes('easybots.store') || host.includes('easybots')) {
    return res.status(404).send('Not found');
  }
  res.sendFile(path.join(__dirname, '../../../public/age-verification.html'));
});



// Meet & Greet Checkout pages (all use unified payment-checkout.html)
app.get('/pnp/meet-greet/checkout/:bookingId', pageLimiter, (req, res) => {
  sendCheckoutHtml(res, 'payment-checkout.html');
});

// PNP Live Checkout pages (all use unified payment-checkout.html)
app.get('/pnp/live/checkout/:bookingId', pageLimiter, (req, res) => {
  sendCheckoutHtml(res, 'payment-checkout.html');
});

// (Security middleware moved to top of middleware chain, before route registration)

// Global middleware to block all PNPtv content for easybots.store
app.use((req, res, next) => {
  const host = req.get('host') || '';
  if (host.includes('easybots.store') || host.includes('easybots')) {
    // Allow only specific paths for easybots.store
    const allowedPaths = [
      '/health',
      '/api/',
      '/pnp/webhook/telegram',
      '/webhook/telegram',
      '/checkout/',
      '/payment/',
      '/api/pnp/checkout', // NEW: Allow the API checkout page
      '/terms',
      '/privacy',
      '/policies',
      '/contact',
      '/cookies',
      '/community-guidelines',
      '/content-policy',
      '/refunds',
      '/subscriptions',
      '/creator-terms',
      '/dmca',
      '/safety'
    ];
    
    const isAllowed = allowedPaths.some(path => 
      req.path.startsWith(path) || req.path === path
    );
    
    if (!isAllowed) {
      return res.status(404).send('Page not found.');
    }
  }
  next();
});

// Rate limiting for API
// A single page navigation fires 5-10 API calls (auth-status, profile,
// notifications, feed, performers, etc.).  100 req / 15 min was causing
// 429s after just a few page switches.  Raised to 600 / 15 min (~40/min)
// and key by session user-id so authenticated users each get their own
// bucket instead of sharing a per-IP bucket behind proxies.
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 600, // ~40 requests per minute — handles rapid page navigation
  message: 'Too many requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Prefer session user id so each logged-in user gets their own bucket.
    // Fall back to IP for unauthenticated requests.
    return req.session?.user?.id
      ? `user:${req.session.user.id}`
      : req.ip;
  },
  skip: (req) => {
    // Skip rate-limiting for lightweight, high-frequency read endpoints
    // that fire on every single page navigation.  These are cheap DB
    // lookups or session reads and should never block normal usage.
    // dm/presence is included because the PresenceProvider polls every 20s
    // for many user IDs at once; if a buggy build loops, it must not be
    // able to poison the IP bucket and block auth/login attempts.
    //
    // IMPORTANT: this limiter is mounted with app.use('/api/', limiter), which
    // strips the '/api' prefix from req.path. We use req.originalUrl (full
    // path) and strip the querystring so the list stays human-readable.
    const skipPaths = [
      '/api/auth-status',
      '/api/webapp/notifications/counts',
      '/api/webapp/dm/presence',
    ];
    // Skip high-frequency streaming endpoints that poll every 2-5s while a
    // user watches a live stream — otherwise watchers exhaust their 600/15min
    // quota and get 429 on unrelated page requests (schedule, performers).
    const skipPrefixes = [
      '/api/proxy/live/hls/',   // HLS segment/manifest (~every 2-3s)
      '/api/webapp/streams/',   // stream health checks (~every 5s)
    ];
    const pathOnly = (req.originalUrl || req.url || '').split('?')[0];
    return skipPaths.includes(pathOnly) || skipPrefixes.some((p) => pathOnly.startsWith(p));
  },
});
app.use('/api/', limiter);
// Colombia gate lifted 2026-05-24 — CO users now access the full platform
// app.use(colombiaAccessGate);

const ageVerificationUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max photo size
  fileFilter: (req, file, cb) => {
    const isImage = /^image\/(jpeg|jpg|png|webp|heic|heif)$/i.test(file.mimetype || '');
    if (isImage) {
      return cb(null, true);
    }
    return cb(new Error('Only image uploads are allowed'));
  }
});

// Avatar upload (profile picture) - 5MB max, images only
const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const isImage = /^image\/(jpeg|jpg|png|webp|gif)$/i.test(file.mimetype || '');
    if (isImage) return cb(null, true);
    cb(new Error('Only image files are allowed'));
  }
});

// Hangout group avatar upload - 5MB max, images only
const hangoutAvatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const isImage = /^image\/(jpeg|jpg|png|webp|gif)$/i.test(file.mimetype || '');
    if (isImage) return cb(null, true);
    cb(new Error('Only image files are allowed'));
  }
});

// Event cover upload - 5 MB max, images only
const eventCoverUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const isImage = /^image\/(jpeg|jpg|png|webp|gif)$/i.test(file.mimetype || '');
    if (isImage) return cb(null, true);
    cb(new Error('Only image files are allowed'));
  }
});

// Channel cover upload - 5 MB max, images only
const channelCoverUploadDir = path.join(__dirname, '../../../../public/uploads/channels');
if (!fs.existsSync(channelCoverUploadDir)) fs.mkdirSync(channelCoverUploadDir, { recursive: true });
const channelCoverUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const isImage = /^image\/(jpeg|jpg|png|webp|gif)$/i.test(file.mimetype || '');
    if (isImage) return cb(null, true);
    cb(new Error('Only image files are allowed'));
  }
});

// ── Magic bytes verification for in-memory uploads (avatars, event covers, etc.) ──
// Multer only checks the Content-Type header which is trivially spoofable.
// This middleware verifies the file's actual magic bytes using file-type.
const verifyMagicBytes = (allowedMimes) => async (req, res, next) => {
  const file = req.file;
  if (!file || !file.buffer) return next();
  try {
    const detected = await FileType.fromBuffer(file.buffer);
    if (!detected || !allowedMimes.has(detected.mime)) {
      logger.warn('Upload rejected: magic bytes mismatch', {
        claimed: file.mimetype,
        detected: detected?.mime ?? 'unknown',
        originalname: file.originalname,
        userId: req.session?.user?.id,
      });
      return res.status(400).json({ error: 'File type does not match its contents. Upload rejected.' });
    }
  } catch (err) {
    logger.error('Magic bytes verification error:', err);
    return res.status(500).json({ error: 'File verification failed' });
  }
  return next();
};

const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heif', 'image/heic', 'image/avif']);

// Creator media (album photos) — 10MB max, images only
const creatorMediaUploadDir = path.join(__dirname, '../../../../public/uploads/creator-media');
if (!fs.existsSync(creatorMediaUploadDir)) fs.mkdirSync(creatorMediaUploadDir, { recursive: true });
const creatorMediaUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (IMAGE_MIMES.has(file.mimetype)) cb(null, true);
    else cb(new Error('Images only'));
  },
});

// Creator album videos — 500MB max, disk storage
const VIDEO_MIMES = new Set(['video/mp4', 'video/quicktime', 'video/webm', 'video/x-msvideo', 'video/x-matroska']);
const creatorVideoTmpDir = '/tmp/pnp-creator-videos';
if (!fs.existsSync(creatorVideoTmpDir)) fs.mkdirSync(creatorVideoTmpDir, { recursive: true });

const CHUNK_DIR = '/tmp/pnp-chunks';
if (!fs.existsSync(CHUNK_DIR)) fs.mkdirSync(CHUNK_DIR, { recursive: true });
const CHUNK_SIZE = 100 * 1024 * 1024; // 100 MB

// Cleanup chunk dirs older than 24h on startup
(async () => {
  try {
    const entries = await fs.promises.readdir(CHUNK_DIR);
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (const e of entries) {
      const p = path.join(CHUNK_DIR, e);
      const stat = await fs.promises.stat(p).catch(() => null);
      if (stat && stat.mtimeMs < cutoff) await fs.promises.rm(p, { recursive: true, force: true }).catch(() => {});
    }
  } catch {}
})();

const chunkUpload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      const uploadId = req.body.uploadId || req.headers['x-upload-id'] || '';
      const dir = path.join(CHUNK_DIR, uploadId.replace(/[^a-zA-Z0-9_-]/g, ''));
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, _file, cb) => {
      const idx = String(parseInt(req.body.chunkIndex || '0', 10)).padStart(6, '0');
      cb(null, `${idx}.part`);
    },
  }),
  limits: { fileSize: 110 * 1024 * 1024 }, // 110 MB — 10% headroom over 100 MB chunks
});

const creatorVideoUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, creatorVideoTmpDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || '.mp4';
      cb(null, `cvid-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
    },
  }),
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (VIDEO_MIMES.has(file.mimetype)) cb(null, true);
    else cb(new Error('Video files only (mp4, mov, webm)'));
  },
});

// Magic bytes verification for disk-stored uploads (post media, large files).
// file.buffer is empty for diskStorage — read first 12 bytes from the saved path instead.
const verifyDiskFileType = async (req, res, next) => {
  const files = req.files || (req.file ? [req.file] : []);
  if (!files.length) return next();
  try {
    for (const file of files) {
      const buf = Buffer.alloc(12);
      const fd = fs.openSync(file.path, 'r');
      fs.readSync(fd, buf, 0, 12, 0);
      fs.closeSync(fd);

      const isJpeg = buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF;
      const isPng  = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47;
      const isGif  = buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38;
      const isWebp = buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46; // RIFF
      const isWebm = buf[0] === 0x1A && buf[1] === 0x45 && buf[2] === 0xDF && buf[3] === 0xA3;
      const isFtyp = buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70; // mp4/mov/hevc

      if (!(isJpeg || isPng || isGif || isWebp || isWebm || isFtyp)) {
        try { fs.unlinkSync(file.path); } catch {}
        logger.warn('Disk upload rejected: magic bytes mismatch', {
          claimed: file.mimetype,
          originalname: file.originalname,
          userId: req.session?.user?.id,
        });
        return res.status(400).json({ error: 'File type does not match its contents. Upload rejected.' });
      }
    }
  } catch (err) {
    logger.error('Disk file type verification error:', err);
    return res.status(500).json({ error: 'File verification failed' });
  }
  return next();
};

// ── Tiered upload limits: 512 MB for regular users, 3 GB for active creators ──
const UPLOAD_LIMIT_REGULAR = 512 * 1024 * 1024;   // 512 MB
const UPLOAD_LIMIT_CREATOR = 3 * 1024 * 1024 * 1024; // 3 GB

const fsSyncMkdir = require('fs');
const MEDIA_TEMP_DIR = '/tmp/pnptv-uploads';
fsSyncMkdir.mkdirSync(MEDIA_TEMP_DIR, { recursive: true });
const PERFORMER_VIDEO_TEMP_DIR = '/tmp/pnptv-videos';
fsSyncMkdir.mkdirSync(PERFORMER_VIDEO_TEMP_DIR, { recursive: true });

const postMediaFileFilter = (req, file, cb) => {
  const isAllowed = /^(image\/(jpeg|jpg|png|webp|gif|heic|heif|avif|tiff|bmp|x-ms-bmp)|video\/(mp4|webm|quicktime|3gpp|hevc|x-m4v))$/i.test(file.mimetype || '');
  if (isAllowed) return cb(null, true);
  logger.warn('postMediaUpload rejected mime', { mime: file.mimetype, originalname: file.originalname, ip: req.ip });
  cb(new Error('Unsupported file type. Supported: images (jpg/png/webp/gif/heic/avif) and videos (mp4/webm/mov)'));
};

// CRIT-4 FIX: Async DB middleware that resolves real-time creator status before
// multer runs. Caches result on req.resolvedCreatorActive so the sync helpers below
// can read it without touching session data.
const attachCreatorStatus = async (req, res, next) => {
  try {
    const userId = req.session?.user?.id;
    if (!userId) {
      req.resolvedCreatorActive = false;
      return next();
    }
    // Admins always get creator limits without a DB round-trip
    const role = req.session.user.role || '';
    if (role === 'admin' || role === 'superadmin') {
      req.resolvedCreatorActive = true;
      return next();
    }
    const { rows } = await getPool().query(
      'SELECT creator_status FROM users WHERE id = $1 LIMIT 1',
      [userId]
    );
    req.resolvedCreatorActive = rows[0]?.creator_status === 'active';
    // Keep session in sync so subsequent non-upload requests stay accurate
    if (req.session.user.creator_status !== rows[0]?.creator_status) {
      req.session.user.creator_status = rows[0]?.creator_status || null;
    }
    return next();
  } catch (err) {
    logger.error('attachCreatorStatus error', err);
    // Fail safe: deny creator limits on error rather than grant them
    req.resolvedCreatorActive = false;
    return next();
  }
};

// Disk storage for large uploads (memory can't handle 3 GB)
const postMediaDiskStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, MEDIA_TEMP_DIR),
  filename: (req, file, cb) => cb(null, `upload-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`),
});

// Dynamic single-file upload middleware — picks limit based on DB-verified creator status
const postMediaUploadMiddleware = (req, res, next) => {
  const isCreator = req.resolvedCreatorActive === true;
  const limit = isCreator ? UPLOAD_LIMIT_CREATOR : UPLOAD_LIMIT_REGULAR;
  const limitLabel = isCreator ? '3 GB' : '512 MB';
  const upload = multer({
    storage: postMediaDiskStorage,
    limits: { fileSize: limit },
    fileFilter: postMediaFileFilter,
  }).single('media');
  upload(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: `File too large. Maximum ${limitLabel}.` });
    return res.status(400).json({ error: err.message || 'Upload error' });
  });
};

// Dynamic multi-file upload middleware — picks limit based on DB-verified creator status
const postMultiMediaUploadMiddleware = (req, res, next) => {
  const isCreator = req.resolvedCreatorActive === true;
  const limit = isCreator ? UPLOAD_LIMIT_CREATOR : UPLOAD_LIMIT_REGULAR;
  const limitLabel = isCreator ? '3 GB' : '512 MB';
  const upload = multer({
    storage: postMediaDiskStorage,
    limits: { fileSize: limit, files: 4 },
    fileFilter: postMediaFileFilter,
  }).array('media', 4);
  upload(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: `File too large. Maximum ${limitLabel} per file.` });
    if (err.code === 'LIMIT_FILE_COUNT') return res.status(400).json({ error: 'Too many files. Maximum 4 at a time.' });
    return res.status(400).json({ error: err.message || 'Upload error' });
  });
};

// Performer bulk video upload — creator-only, 3 GB per file, up to 5 videos, disk storage
const performerVideoStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, PERFORMER_VIDEO_TEMP_DIR),
  filename: (req, file, cb) => cb(null, `vid-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`),
});

const uploadPerformerVideos = (req, res, next) => {
  const upload = multer({
    storage: performerVideoStorage,
    limits: { fileSize: UPLOAD_LIMIT_CREATOR },
    fileFilter: (req, file, cb) => {
      const isVideo = /^video\/(mp4|webm)$/i.test(file.mimetype || '');
      if (isVideo) return cb(null, true);
      cb(new Error('Only video (mp4/webm) files are allowed'));
    },
  }).array('videos', 5);
  upload(req, res, (err) => {
    if (!err) return next();
    let message = 'Invalid video file. Only mp4/webm up to 3 GB are allowed.';
    if (err.code === 'LIMIT_FILE_SIZE') message = 'Video too large. Maximum 3 GB per file.';
    if (err.code === 'LIMIT_FILE_COUNT') message = 'Too many videos. Maximum 5 at a time.';
    return res.status(400).json({ error: message });
  });
};

// Rate limiter for performer bulk video uploads (10 per hour per user)
const bulkVideoLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => req.session?.user?.id || req.ip,
  handler: (req, res) => res.status(429).json({ error: 'Bulk video upload limit reached. Try again in an hour.' }),
  standardHeaders: true,
  legacyHeaders: false,
});

// Chat media upload:
//   Images up to 20 MB — processed by sharp (converted to WebP + thumbnail)
//   Videos up to 100 MB — stored as-is, poster frame via ffmpeg
//   Audio (voice notes) up to 20 MB — stored as-is
// Accepts iPhone formats (HEIC/HEIF, MOV) — real mime validation by magic bytes
// happens in chatMediaService.
const chatMediaUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const m = (file.mimetype || '').toLowerCase();
    const isImage = /^image\/(jpeg|jpg|png|webp|gif|heic|heif)$/.test(m);
    const isVideo = /^video\/(mp4|webm|quicktime|x-m4v)$/.test(m);
    const isAudio = /^audio\/(webm|ogg|mp4|mpeg|mp3|m4a|x-m4a|wav)$/.test(m);
    // Some browsers / iOS send application/octet-stream for HEIC — let the
    // magic-byte validator reject it at the service layer rather than here.
    const isOctet = m === 'application/octet-stream' || m === '';
    if (isImage || isVideo || isAudio || isOctet) return cb(null, true);
    cb(new Error('Only image, video, and voice-note files are allowed'));
  },
});

// Wrap chatMediaUpload to return structured JSON errors consistent with the rest of the API
const uploadChatMedia = (req, res, next) => {
  chatMediaUpload.single('media')(req, res, (err) => {
    if (!err) return next();
    let message = 'Invalid file. Please try a different image or video.';
    if (err.code === 'LIMIT_FILE_SIZE') {
      message = 'File is too large. Max 100 MB.';
    } else if (err.message) {
      message = err.message;
    }
    return res.status(400).json({ error: message });
  });
};

// Hangout media upload:
//   Images up to 10 MB — processed by sharp (WebP + thumbnail, per-hangout dirs)
//   Videos up to 50 MB — stored as-is, poster frame via ffmpeg
const hangoutMediaUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const isAllowed = /^(image\/(jpeg|jpg|png|webp|gif)|video\/(mp4|webm)|audio\/(webm|ogg|mp4|mpeg))$/i.test(file.mimetype || '');
    if (isAllowed) return cb(null, true);
    cb(new Error('Only image, video, and voice message files are allowed'));
  },
});

const uploadHangoutMedia = (req, res, next) => {
  hangoutMediaUpload.single('media')(req, res, (err) => {
    if (!err) return next();
    let message = 'Invalid file. Please try a different image or video.';
    if (err.code === 'LIMIT_FILE_SIZE') {
      message = 'File is too large. Images must be under 10 MB and videos under 50 MB.';
    } else if (err.message) {
      message = err.message;
    }
    return res.status(400).json({ error: message });
  });
};

const uploadAgeVerificationPhoto = (req, res, next) => {
  ageVerificationUpload.single('photo')(req, res, (err) => {
    if (!err) {
      return next();
    }

    let message = 'Invalid upload. Please try again with a clear photo.';
    if (err.code === 'LIMIT_FILE_SIZE') {
      message = 'Photo is too large. Maximum size is 5MB.';
    } else if (err.message && err.message.toLowerCase().includes('image')) {
      message = 'Only image files are allowed. Please upload a JPG or PNG.';
    }

    logger.warn('Age verification upload rejected', {
      error: err.message,
      code: err.code
    });

    return res.status(400).json({
      success: false,
      error: 'INVALID_UPLOAD',
      message
    });
  });
};

// Model application profile photo upload - 5MB max, images only
const modelProfilePhotoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const isImage = /^image\/(jpeg|jpg|png|webp)$/i.test(file.mimetype || '');
    if (isImage) return cb(null, true);
    cb(new Error('Only image files (jpg/png/webp) are allowed'));
  },
});

const uploadModelProfilePhoto = (req, res, next) => {
  modelProfilePhotoUpload.single('photo')(req, res, (err) => {
    if (!err) return next();
    let message = 'Invalid photo. Please try a different image.';
    if (err.code === 'LIMIT_FILE_SIZE') {
      message = 'Photo is too large. Maximum size is 5MB.';
    } else if (err.message) {
      message = err.message;
    }
    return res.status(400).json({ success: false, error: message });
  });
};

// Model application ID document upload - 5MB max per file, images only, front+back
const modelIdDocUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const isImage = /^image\/(jpeg|jpg|png|webp)$/i.test(file.mimetype || '');
    if (isImage) return cb(null, true);
    cb(new Error('Only image files (jpg/png/webp) are allowed'));
  },
});

const uploadModelIdDocuments = (req, res, next) => {
  modelIdDocUpload.fields([
    { name: 'front', maxCount: 1 },
    { name: 'back', maxCount: 1 },
  ])(req, res, (err) => {
    if (!err) return next();
    let message = 'Invalid upload. Please try different images.';
    if (err.code === 'LIMIT_FILE_SIZE') {
      message = 'File is too large. Maximum size is 5MB per image.';
    } else if (err.message) {
      message = err.message;
    }
    return res.status(400).json({ success: false, error: message });
  });
};

// Support ticket attachment upload — images + PDF, 10 MB each, up to 5 files
const supportAttachUploadDir = path.join(__dirname, '../../../../public/uploads/support');
if (!fs.existsSync(supportAttachUploadDir)) fs.mkdirSync(supportAttachUploadDir, { recursive: true });

const supportAttachUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 5 },
  fileFilter: (_req, file, cb) => {
    const m = (file.mimetype || '').toLowerCase();
    if (/^image\/(jpeg|jpg|png|webp|gif)$/.test(m) || m === 'application/pdf') return cb(null, true);
    cb(new Error('Only images (JPG/PNG/WebP/GIF) and PDF files are allowed'));
  },
});

const handleSupportAttach = (req, res, next) => {
  supportAttachUpload.array('files', 5)(req, res, (err) => {
    if (!err) return next();
    const msg = err.code === 'LIMIT_FILE_SIZE' ? 'File too large. Max 10 MB each.' : (err.message || 'Upload failed');
    return res.status(400).json({ success: false, error: msg });
  });
};

// Stricter rate limiting for webhooks to prevent abuse
const webhookLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 50, // Limit each IP to 50 webhook requests per 5 minutes
  message: 'Too many webhook requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
});

// Rate limiting for authentication endpoints (prevent brute force attacks).
// Cap raised to accommodate carrier-NAT IPs that share one bucket across many users.
const authLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 200, // 200 failed auth attempts per 10 min (only failures count)
  message: 'Too many authentication attempts, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Only count failed attempts
});

// Rate limiter for health checks (skip for internal/authorized requests)
const healthLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30, // Allow 30 requests per minute for external clients
  message: 'Too many health check requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting for internal requests
    const isInternal = req.ip === '127.0.0.1' || req.ip === '::1' || req.ip === '::ffff:127.0.0.1';
    return isInternal || req.headers['x-health-secret'] === process.env.HEALTH_SECRET;
  },
});

// Rate limiter for social actions (likes, follows — 30 per minute, per user)
const socialActionLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: (req) => req.session?.user?.id || req.ip,
  handler: (req, res) => res.status(429).json({ error: 'Too many actions. Slow down.' }),
  standardHeaders: true,
  legacyHeaders: false,
});

// Fix #7: Rate limiter for tip submissions (10 per minute per user, prevents wallet drain)
const tipLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator: (req) => `user:${req.session?.user?.id || req.ip}`,
  handler: (req, res) => res.status(429).json({ success: false, error: 'Too many tips. Please slow down.' }),
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiter for file uploads (20 per minute, per user)
const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  keyGenerator: (req) => req.session?.user?.id || req.ip,
  handler: (req, res) => res.status(429).json({ error: 'Upload rate limit exceeded.' }),
  standardHeaders: true,
  legacyHeaders: false,
});

// Health check with dependency checks and security
app.get('/health', healthLimiter, async (req, res) => {
  // Check if request is from internal network or has valid secret
  const isInternal = req.ip === '127.0.0.1' || req.ip === '::1' || req.ip === '::ffff:127.0.0.1';
  const hasValidSecret = process.env.HEALTH_SECRET && req.headers['x-health-secret'] === process.env.HEALTH_SECRET;
  const isAuthorized = isInternal || hasValidSecret;

  // Minimal response for external requests
  const basicHealth = {
    status: 'ok',
    timestamp: new Date().toISOString(),
  };

  // Don't expose details to external requests
  if (!isAuthorized) {
    return res.status(200).json(basicHealth);
  }

  // Full health details only for internal/authorized requests
  try {
    const fullHealth = {
      ...basicHealth,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      version: process.env.APP_VERSION || 'unknown',
      environment: process.env.NODE_ENV,
      dependencies: {},
    };

    try {
      // Check Redis connection
      const { getRedis } = require('../../config/redis');
      const redis = getRedis();
      // Not all test Redis mocks implement ping, guard accordingly
      if (redis && typeof redis.ping === 'function') {
        await redis.ping();
      }
      fullHealth.dependencies.redis = 'ok';
    } catch (error) {
      fullHealth.dependencies.redis = 'error';
      fullHealth.status = 'degraded';
      logger.error('Redis health check failed:', error);
    }

    try {
      // Check PostgreSQL connection (optional in test env)
      const { testConnection } = require('../../config/postgres');
      const dbOk = await testConnection();
      fullHealth.dependencies.database = dbOk ? 'ok' : 'error';
      if (!dbOk) fullHealth.status = 'degraded';
    } catch (error) {
      fullHealth.dependencies.database = 'error';
      fullHealth.status = 'degraded';
      logger.error('Database health check failed:', error);
    }

    const statusCode = fullHealth.status === 'ok' ? 200 : 503;
    res.status(statusCode).json(fullHealth);
  } catch (err) {
    res.status(503).json({
      ...basicHealth,
      status: 'degraded',
      error: isAuthorized ? err.message : 'Service temporarily unavailable',
    });
  }
});


// API routes
// Authentication API endpoints
app.post('/api/telegram-auth', authLimiter, handleTelegramAuth);
app.post('/api/accept-terms', handleAcceptTerms);
// /api/auth-status is fired 5-10x per page nav (Layout, route guards, SW handshake),
// so 120/min trips on normal SPA usage after a few page switches. 600/min (~10/sec)
// matches the page-data limiter at line 1248 and gives headroom for retry storms.
const authStatusLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 600,
  keyGenerator: (req) => req.ip,
  standardHeaders: true,
  legacyHeaders: false,
});
app.get('/api/auth-status', authStatusLimiter, (req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.removeHeader('ETag');
  next();
}, checkAuthStatus);

// Admin check endpoint (for frontend role gate)
// Uses adminGuard which queries DB — never trusts the stale session role.
// adminGuard returns 403 for non-admins; frontend treats any non-200 as isAdmin: false.
const adminCheckLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, keyGenerator: (req) => req.ip, standardHeaders: true, legacyHeaders: false });
const paymentCreateLimiter = rateLimit({ windowMs: 60 * 1000, max: 8, keyGenerator: (req) => req.session?.user?.id || req.ip, handler: (req, res) => res.status(429).json({ success: false, error: 'Demasiados intentos. Espera un minuto antes de intentar nuevamente.' }), standardHeaders: true, legacyHeaders: false });
const creatorSubscriptionLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, keyGenerator: (req) => req.session?.user?.id || req.ip, handler: (req, res) => res.status(429).json({ success: false, error: 'Too many requests. Wait a minute and try again.' }), standardHeaders: true, legacyHeaders: false });
const channelVideoViewLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, keyGenerator: (req) => req.session?.user?.id || req.ip, standardHeaders: true, legacyHeaders: false });
const channelPurchaseLimiter = rateLimit({ windowMs: 60 * 1000, max: 3, keyGenerator: (req) => req.session?.user?.id || req.ip, message: { error: 'Too many purchase attempts. Please wait.' }, standardHeaders: true, legacyHeaders: false });
app.get('/api/admin/check', adminCheckLimiter, adminGuard, (req, res) => {
  res.json({ isAdmin: true });
});

// X OAuth routes (admin-guarded for account management, public alias for callback)
app.use('/api/admin/x/oauth', adminGuard, xOAuthRoutes);
app.use('/api/auth/x', xOAuthRoutes);
// Creator X OAuth (requires active creator, not admin)
const creatorGuardForOAuth = require('./middleware/creatorGuard');
app.use('/api/creator/x/oauth', requireSessionAuth, creatorGuardForOAuth, xOAuthRoutes);

// Audit log middleware — registered here so it covers ALL /api/admin/* routes,
// including those defined before the RBAC block further down the file.
// NOTE: superadminGuard and roleController are required again in the RBAC section
// below for clarity but the auditLog registration must live here to fire first.
const { auditLog } = require('../../middleware/auditLogger');
app.use('/api/admin/', auditLog);

// Client error logging endpoint (used by ErrorBoundary)
app.post('/api/log-error', limiter, requireSessionAuth, (req, res) => {
  const { error, stack, componentStack } = req.body || {};
  if (error) {
    logger.error('Client error:', { error: typeof error === 'string' ? error.slice(0, 500) : String(error).slice(0, 500), stack: stack?.slice(0, 2000), componentStack: componentStack?.slice(0, 2000) });
  }
  res.json({ ok: true });
});

// Logout endpoint
app.post('/api/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      logger.error('Logout error:', err);
      return res.status(500).json({ error: 'Logout failed' });
    }
    res.clearCookie('__pnptv_sid', {
      path: '/',
      domain: process.env.NODE_ENV === 'production' ? '.pnptv.app' : undefined,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
    });
    logger.info('User logged out successfully');
    res.json({ success: true });
  });
});

// ==========================================
// Protected Webapp Routes (require Telegram login)
// ==========================================

// Hangouts - protected
app.get('/hangouts', requirePageAuth, (req, res) => {
  logger.info(`User ${req.user.id} accessing Hangouts`);
  res.sendFile(path.join(__dirname, '../../../public/hangouts/index.html'));
});

app.get('/hangouts/*', requirePageAuth, (req, res) => {
  const assetPath = path.join(__dirname, '../../../public/hangouts', req.path.replace('/hangouts', ''));
  if (fs.existsSync(assetPath) && fs.statSync(assetPath).isFile()) {
    return res.sendFile(assetPath);
  }
  res.sendFile(path.join(__dirname, '../../../public/hangouts/index.html'));
});

// Live - protected
app.get('/live', requirePageAuth, (req, res) => {
  logger.info(`User ${req.user.id} accessing Live`);
  res.sendFile(path.join(__dirname, '../../../public/live/index.html'));
});

app.get('/live/*', requirePageAuth, (req, res) => {
  const assetPath = path.join(__dirname, '../../../public/live', req.path.replace('/live', ''));
  if (fs.existsSync(assetPath) && fs.statSync(assetPath).isFile()) {
    return res.sendFile(assetPath);
  }
  res.sendFile(path.join(__dirname, '../../../public/live/index.html'));
});

// PNP Live portal - protected
app.get('/pnplive', requirePageAuth, (req, res) => {
  logger.info(`User ${req.user.id} accessing PNP Live portal`);
  res.sendFile(path.join(__dirname, '../../../public/live/index.html'));
});

// Age verification (AI camera)
app.post(
  '/api/verify-age',
  requireSessionAuth,
  uploadLimiter,
  uploadAgeVerificationPhoto,
  asyncHandler(ageVerificationController.verifyAge)
);

// Telegram webhook is handled in bot.js, not here
// The webhook handler is registered via apiApp.post(webhookPath, ...) in bot.js

// Webhook endpoints
// ePayco webhook routes removed — ePayco retired

// ── Creator subscription user-facing routes ───────────────────────────────────

const creatorController = require('./controllers/creatorController');
app.get('/api/webapp/creator/:creatorId/subscription-status', requireSessionAuth, asyncHandler(creatorController.getSubscriptionStatus));
app.post('/api/webapp/creator/:creatorId/subscribe', requireSessionAuth, creatorSubscriptionLimiter, asyncHandler(creatorController.subscribeToCreator));
app.post('/api/webapp/creator/:creatorId/unsubscribe', requireSessionAuth, creatorSubscriptionLimiter, asyncHandler(creatorController.unsubscribeFromCreator));

// LiveKit webhook — participant_joined, participant_left, room_finished
// express.raw() is required — livekit-server-sdk verifies the raw body signature
app.post(
  '/api/webhooks/livekit',
  webhookLimiter,
  express.raw({ type: 'application/webhook+json' }),
  webhookController.handleLiveKitWebhook
);
// HIGH-01: rate-limited so the unauthenticated payment-response page can't be
// looped to enumerate paymentIds or harvest plan/email data via x_extra3 polls.
app.get('/api/payment-response', webhookLimiter, webhookController.handlePaymentResponse);

// One-time payment confirmation link sent via Telegram DM after purchase
app.get('/api/confirm-payment/:token', asyncHandler(paymentController.confirmPaymentToken));

// Cal.com webhook — booking lifecycle events (C-03)
// Rate-limited at 10 req/min; verified via HMAC-SHA256 (no session auth).
// express.raw() preserves the raw body required for signature verification.
const calcomWebhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: 'Too many Cal.com webhook requests.',
  standardHeaders: true,
  legacyHeaders: false,
});
app.post(
  '/api/webhooks/calcom',
  calcomWebhookLimiter,
  express.raw({ type: 'application/json' }),
  require('./controllers/calcomWebhookController').handleCalcomWebhook
);

// Payment API routes (modularized)
app.use('/api/payment', paymentRoutes);

// Creator USDT cash-out off-ramp (auth+creatorGuard enforced inside the router)
app.use('/api/cashout', cashoutRoutes);
app.post('/api/webhooks/bitrefill', cashoutRoutes.bitrefillWebhook);
app.post('/api/webhooks/transak', cashoutRoutes.transakWebhook);

// Persona identity verification webhook
// Signature verified inside handlePersonaWebhook — no session auth needed.
// rawBody is available on req.rawBody via the express.json verify callback (line ~286).
// Geo-block bypass already covers /^\/api\/webhooks?\b/ so no extra path entry needed.
app.post('/api/webhooks/persona', webhookLimiter, asyncHandler(async (req, res) => {
  try {
    if (!process.env.PERSONA_WEBHOOK_SECRET) {
      // M-04: return 503 so Persona retries instead of silently discarding
      return res.status(503).json({ error: 'Persona webhook not configured' });
    }
    const signatureHeader = req.headers['persona-signature'];
    if (!signatureHeader) {
      return res.status(400).json({ error: 'Missing Persona-Signature header' });
    }
    if (!req.rawBody) {
      return res.status(400).json({ error: 'Raw body not available' });
    }
    const IdentityVerificationService = require('../../services/identityVerificationService');
    const result = await IdentityVerificationService.handlePersonaWebhook(
      req.rawBody.toString(),
      signatureHeader
    );
    logger.info('Persona webhook processed', result);
    return res.json({ received: true });
  } catch (err) {
    logger.error('Persona webhook error', { message: err.message });
    // Signature errors → 400 so Persona knows not to retry (bad secret / tampering).
    // All other errors → 200 to prevent Persona from retrying transient failures
    // that may have already been partially applied (e.g. DB error after partial write).
    if (err.message && err.message.includes('signature')) {
      return res.status(400).json({ error: 'Invalid webhook signature' });
    }
    return res.status(200).json({ received: false });
  }
}));

// PNP Live API routes (formerly Meet & Greet, now consolidated)
const PNPLiveService = require('../../services/pnpLiveService');
const ModelService = require('../../services/modelService');
const PaymentService = require('../../services/paymentService');
app.get('/api/pnp-live/booking/:bookingId', authenticateUser, asyncHandler(async (req, res) => {
  const { bookingId } = req.params;

  const booking = await PNPLiveService.getBookingById(bookingId);
  if (!booking) {
    return res.status(404).json({ success: false, error: 'Booking not found' });
  }

  const actorId = getActorId(req);
  if (booking.user_id !== actorId) {
    return res.status(403).json({ success: false, error: 'Forbidden' });
  }

  const model = await ModelService.getModelById(booking.model_id);

  res.json({
    success: true,
    booking: {
      id: booking.id,
      userId: booking.user_id,
      modelId: booking.model_id,
      modelName: model?.name || 'Unknown',
      durationMinutes: booking.duration_minutes,
      priceUsd: booking.price_usd,
      bookingTime: booking.booking_time,
      status: booking.status,
      paymentStatus: booking.payment_status,
      paymentMethod: booking.payment_method,
    }
  });
}));

app.post('/api/pnp-live/booking/:bookingId/confirm', authenticateUser, asyncHandler(async (req, res) => {
  const { bookingId } = req.params;
  const { transactionId } = req.body;
  const actorId = getActorId(req);

  if (!transactionId) {
    return res.status(400).json({ success: false, error: 'transactionId is required' });
  }

  const booking = await PNPLiveService.getBookingById(bookingId);
  if (!booking) {
    return res.status(404).json({ success: false, error: 'Booking not found' });
  }

  const isAdmin = await PermissionService.isAdmin(actorId);
  if (!isAdmin) {
    return res.status(403).json({
      success: false,
      error: 'Only admin can manually confirm bookings',
    });
  }

  await PNPLiveService.updateBookingStatus(bookingId, 'confirmed');
  await PNPLiveService.updatePaymentStatus(bookingId, 'paid', transactionId);

  res.json({ success: true, message: 'Booking confirmed' });
}));

// Group Invitation routes
app.get('/api/join-group/:token', asyncHandler(invitationController.verifyGroupInvitation));
app.get('/join-group/:token', asyncHandler(invitationController.redirectToGroup));

// Stats endpoint
app.get('/api/stats', requireSessionAuth, asyncHandler(async (req, res) => {
  const UserService = require('../../services/userService');
  const stats = await UserService.getStatistics();
  res.json(stats);
}));



// Playlist API routes (PROTECTED: require authentication)
app.get('/api/playlists/user', authenticateUser, asyncHandler(playlistController.getUserPlaylists));
app.get('/api/playlists/public', asyncHandler(playlistController.getPublicPlaylists));
app.post('/api/playlists', authenticateUser, asyncHandler(playlistController.createPlaylist));
app.post('/api/playlists/:playlistId/videos', authenticateUser, asyncHandler(playlistController.addToPlaylist));
app.delete('/api/playlists/:playlistId/videos/:videoId', authenticateUser, asyncHandler(playlistController.removeFromPlaylist));
app.patch('/api/playlists/:playlistId', authenticateUser, asyncHandler(playlistController.updatePlaylist));
app.delete('/api/playlists/:playlistId', authenticateUser, asyncHandler(playlistController.deletePlaylist));



// Podcasts uploads (local storage under /public/uploads/podcasts)
app.post(
  '/api/podcasts/upload',
  authenticateUser,
  uploadLimiter,
  podcastController.upload.single('audio'),
  asyncHandler(podcastController.uploadAudio)
);

// Recurring Checkout page - serves unified payment-checkout.html
app.get('/recurring-checkout/:userId/:planId', pageLimiter, (req, res) => {
  sendCheckoutHtml(res, 'payment-checkout.html');
});

// Subscription API routes
const plansLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });
app.get('/api/subscription/plans', plansLimiter, asyncHandler(subscriptionController.getPlans));
app.get('/api/subscription/subscriber/:identifier', verifyAdminJWT, asyncHandler(subscriptionController.getSubscriber));
app.get('/api/subscription/stats', verifyAdminJWT, asyncHandler(subscriptionController.getStatistics));

// ==========================================
// Media Library API
// ==========================================
const MediaPlayerModel = require('../../models/mediaPlayerModel');


// Get media library
app.get('/api/media/library', asyncHandler(async (req, res) => {
  const { type = 'all', category, limit = 50 } = req.query;

  try {
    let media;
    if (category) {
      media = await MediaPlayerModel.getMediaByCategory(category, parseInt(limit));
    } else {
      media = await MediaPlayerModel.getMediaLibrary(type, parseInt(limit));
    }

    res.json({
      success: true,
      data: media,
      count: media.length
    });
  } catch (error) {
    logger.error('Error fetching media library:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch media library',
      data: []
    });
  }
}));

// Get media categories
app.get('/api/media/categories', asyncHandler(async (req, res) => {
  try {
    const { getPool } = require('../../config/postgres');
    const result = await getPool().query(`
      SELECT DISTINCT category FROM media_library
      WHERE is_public = true AND category IS NOT NULL
      ORDER BY category
    `);

    const categories = result.rows.map(r => r.category);
    res.json({
      success: true,
      data: categories.length > 0 ? categories : ['music', 'videos', 'podcast', 'featured']
    });
  } catch (error) {
    logger.error('Error fetching categories:', error);
    res.json({
      success: true,
      data: ['music', 'videos', 'podcast', 'featured']
    });
  }
}));

// Get playlists (must be before :mediaId route)
app.get('/api/media/playlists', asyncHandler(async (req, res) => {
  try {
    const { getPool } = require('../../config/postgres');
    const result = await getPool().query(`
      SELECT * FROM media_playlists
      WHERE is_public = true
      ORDER BY created_at DESC
      LIMIT 20
    `);

    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    logger.error('Error fetching playlists:', error);
    res.json({
      success: true,
      data: []
    });
  }
}));

// Get single media item
app.get('/api/media/:mediaId', softAuth, asyncHandler(async (req, res) => {
  const { mediaId } = req.params;

  try {
    const media = await MediaPlayerModel.getMediaById(mediaId);

    if (!media) {
      return res.status(404).json({
        success: false,
        message: 'Media not found'
      });
    }

    // H-1: gate prime-flagged items
    if (media.is_prime) {
      const sessionUserId = req.session?.user?.id;
      if (!sessionUserId) {
        return res.status(401).json({ success: false, error: 'PRIME membership required' });
      }
      // Check active prime entitlement
      const EntitlementAccessService = require('../../services/entitlementAccessService');
      const hasPrime = await EntitlementAccessService.hasEntitlement(sessionUserId, 'prime');
      if (!hasPrime) {
        return res.status(403).json({ success: false, error: 'PRIME membership required', code: 'PRIME_REQUIRED' });
      }
    }

    res.json({
      success: true,
      data: media
    });
  } catch (error) {
    logger.error('Error fetching media:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch media'
    });
  }
}));

// Get server-side prime content (tier-gated)
app.get('/api/media/prime', softAuth, requirePrimeTier, asyncHandler(async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.query(
      `SELECT id, title, artist, url, type, duration, category, cover_url, description, is_prime, plays, likes
       FROM media_library WHERE is_prime = true AND is_public = true
       ORDER BY created_at DESC LIMIT 100`
    );

    res.json({
      success: true,
      data: result.rows,
      count: result.rows.length
    });
  } catch (error) {
    logger.error('Error fetching prime content:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch prime content',
      data: []
    });
  }
}));

// ==========================================
// RADIO API ROUTES
// ==========================================

// Get radio now playing
app.get('/api/radio/now-playing', asyncHandler(async (req, res) => {
  try {
    const result = await getPool().query(
      `SELECT * FROM radio_now_playing WHERE id = 1 AND updated_at > NOW() - INTERVAL '5 minutes'`
    );

    const nowPlaying = result.rows[0];

    if (!nowPlaying) {
      return res.json({
        track: {
          title: 'PNPtv Radio',
          artist: 'Starting Soon',
          thumbnailUrl: null,
        },
        listenerCount: 0,
      });
    }

    // Get real listener count from Redis cache
    let listenerCount = 0;
    try {
      const cachedCount = await redisClient.get('radio:listener_count');
      listenerCount = cachedCount ? parseInt(cachedCount, 10) : 0;
    } catch (redisError) {
      logger.warn('Failed to fetch listener count from Redis:', redisError);
      listenerCount = 0;
    }

    res.json({
      track: {
        title: nowPlaying.title,
        artist: nowPlaying.artist,
        thumbnailUrl: nowPlaying.cover_url,
        duration: nowPlaying.duration,
        startedAt: nowPlaying.started_at,
      },
      listenerCount,
    });
  } catch (error) {
    logger.error('Error fetching radio now playing:', error);
    res.json({
      track: {
        title: 'PNPtv Radio',
        artist: 'Starting Soon',
        thumbnailUrl: null,
      },
      listenerCount: 0,
    });
  }
}));

// Get radio history
app.get('/api/radio/history', asyncHandler(async (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 20;
    const result = await getPool().query(
      'SELECT * FROM radio_history ORDER BY played_at DESC LIMIT $1',
      [limit]
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    logger.error('Error fetching radio history:', error);
    res.json({ success: true, data: [] });
  }
}));

// Get radio schedule
app.get('/api/radio/schedule', asyncHandler(async (req, res) => {
  try {
    const result = await getPool().query(
      'SELECT * FROM radio_schedule ORDER BY day_of_week, time_slot'
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    logger.error('Error fetching radio schedule:', error);
    res.json({ success: true, data: [] });
  }
}));

// Submit song request (PROTECTED: require authentication)
app.post('/api/radio/request', authenticateUser, asyncHandler(async (req, res) => {
  try {
    const userId = req.user?.id; // Use authenticated user's ID, not from body
    const { songName, artist } = req.body;

    if (!userId || !songName) {
      return res.status(400).json({ error: 'Song name is required' });
    }

    const result = await getPool().query(
      `INSERT INTO radio_requests (user_id, song_name, artist, status)
       VALUES ($1, $2, $3, 'pending')
       RETURNING id`,
      [userId, songName, artist || null]
    );

    res.json({ success: true, requestId: result.rows[0].id });
  } catch (error) {
    logger.error('Error submitting song request:', error);
    res.status(500).json({ error: 'Failed to submit request' });
  }
}));


// ==========================================
// VIDEORAMA COLLECTIONS API
// ==========================================

// Broadcast Queue API Routes
const broadcastQueueRoutes = require('./broadcastQueueRoutes');
app.use('/api/admin/queue', broadcastQueueRoutes);

// Admin User Management Routes
app.use('/api/admin/users', adminUserRoutes);
app.use('/api/users', userManagementRoutes);

// Nearby Geolocation API Routes
app.use('/api/nearby', nearbyRoutes);

// Health Check and Monitoring Endpoints
app.get('/api/health', healthLimiter, asyncHandler(healthController.healthCheck));
app.get('/api/metrics', healthLimiter, adminGuard, asyncHandler(healthController.performanceMetrics));
app.post('/api/metrics/reset', healthLimiter, adminGuard, asyncHandler(healthController.resetMetrics));

// ==========================================
// PRIME Hub Web App API Routes
// ==========================================
const webAppController = require('./controllers/webAppController');
// Phase 1 controllers:
const userLocationController = require('./controllers/userLocationController');
const blockedUsersController = require('./controllers/blockedUsersController');
const directMessagesController = require('./controllers/directMessagesController');
const notificationsController = require('./controllers/notificationsController');

// Rate limiter for the Telegram Login Widget endpoint — 5 attempts/min per IP
const telegramWidgetLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  handler: (req, res) => res.status(429).json({ error: 'Too many login attempts. Try again in a minute.' }),
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiter for /api/webapp/auth/telegram/check — prevents auth probing, 10 req/min per IP
const telegramCheckLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  handler: (req, res) => res.status(429).json({ error: 'Too many auth check attempts. Try again in a minute.' }),
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiter for /api/webapp/auth/verify-email — 5 req per 15 minutes per IP
const verifyEmailLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  handler: (req, res) => res.status(429).json({ error: 'Too many verification attempts. Try again later.' }),
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiter for magic-link start — 3 per 5 min per IP. Verify is GET and
// idempotent (single-use Redis token), no limiter needed.
const magicLinkLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 3,
  handler: (req, res) => res.status(429).json({ success: false, error: 'Too many magic-link requests. Try again in a few minutes.' }),
  standardHeaders: true,
  legacyHeaders: false,
});
const magicLinkVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => req.ip,
  handler: (req, res) => res.status(429).json({ success: false, error: 'Too many verification attempts. Try again later.' }),
  standardHeaders: true,
  legacyHeaders: false,
});

// Web App Authentication
app.get('/api/webapp/auth/telegram/start', asyncHandler(webAppController.telegramStart));
app.get('/api/webapp/auth/telegram/callback', asyncHandler(webAppController.telegramCallback));
app.post('/api/webapp/auth/telegram', authLimiter, asyncHandler(webAppController.telegramLogin));
app.post('/api/webapp/auth/telegram/token', authLimiter, asyncHandler(webAppController.telegramGenerateToken));
app.get('/api/webapp/auth/telegram/check', telegramCheckLimiter, asyncHandler(webAppController.telegramCheckToken));
app.post('/api/webapp/auth/telegram/widget', telegramWidgetLimiter, asyncHandler(webAppController.telegramWidgetAuth));
app.post('/api/webapp/auth/email/register', authLimiter, asyncHandler(webAppController.emailRegister));
app.post('/api/webapp/auth/email/login', authLimiter, asyncHandler(webAppController.emailLogin));
app.post('/api/webapp/auth/oidc/token-exchange', authLimiter, asyncHandler(webAppController.oidcTokenExchange));
app.post('/api/webapp/auth/magic/start', magicLinkLimiter, asyncHandler(webAppController.magicLinkStart));
app.get('/api/webapp/auth/magic/verify', magicLinkVerifyLimiter, asyncHandler(webAppController.magicLinkVerify));
app.get('/api/webapp/auth/passkey/begin', authLimiter, asyncHandler(webAppController.passkeyBegin));
app.post('/api/webapp/auth/passkey/finish', authLimiter, asyncHandler(webAppController.passkeyFinish));

// Request account recovery — Authentik-based password reset.
// Why this path exists: most users (especially Telegram-shadow accounts) have a
// placeholder @telegram.pnptv.app email inside Authentik but their *real* email
// in our DB. Authentik's /if/flow/pnptv-recovery/ form looks up identifiers in
// Authentik directly, so real-email submissions get rejected with
// invalid_identifier. This handler resolves user → pnptv_id → Authentik PK,
// generates a one-time recovery URL via the Authentik admin API, and emails
// it through our SMTP. Always returns 200 to prevent email enumeration.
app.post('/api/webapp/auth/recover-account', authLimiter, asyncHandler(async (req, res) => {
  const email = String(req.body?.email || '').toLowerCase().trim();
  // Validate shape only — never reveal whether the email is in our DB.
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return res.json({ success: true });
  }
  try {
    const { rows } = await getPool().query(
      `SELECT id, pnptv_id, first_name, language, password_hash FROM users
        WHERE LOWER(email) = $1 AND is_deleted = false LIMIT 1`,
      [email]
    );
    if (rows.length === 0) {
      logger.info('[recover-account] no match', { email });
      return res.json({ success: true });
    }
    const u = rows[0];

    // Email/password users: reset the local password_hash so that emailLogin works
    // after the reset. Authentik recovery only changes Authentik's copy, leaving
    // users.password_hash stale and login broken.
    if (u.password_hash) {
      await getPool().query(`
        CREATE TABLE IF NOT EXISTS password_reset_tokens (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          token TEXT NOT NULL UNIQUE,
          expires_at TIMESTAMP NOT NULL,
          used BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await getPool().query('UPDATE password_reset_tokens SET used = TRUE WHERE user_id = $1 AND used = FALSE', [u.id]);
      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
      await getPool().query(
        'INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
        [u.id, tokenHash, expiresAt.toISOString()]
      );
      const resetUrl = `${process.env.WEBAPP_URL || 'https://pnptv.app'}/reset-password?token=${rawToken}`;
      const lang = (u.language || 'en').toLowerCase().startsWith('es') ? 'es' : 'en';
      const displayName = u.first_name || (lang === 'es' ? 'usuario' : 'there');
      const escape = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
      const subject = lang === 'es' ? 'Restablecer contraseña — PNPtv' : 'Reset your PNPtv password';
      const html = lang === 'es'
        ? `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#111;">
              <h2 style="color:#D4007A;margin:0 0 16px;">Restablecer contraseña</h2>
              <p>Hola ${escape(displayName)},</p>
              <p>Recibimos una solicitud para restablecer tu contraseña en PNPtv. Haz clic en el botón para crear una contraseña nueva. El enlace expira en 1 hora y solo se puede usar una vez.</p>
              <p style="margin:24px 0;"><a href="${resetUrl}" style="background:#D4007A;color:#fff;padding:14px 24px;border-radius:10px;text-decoration:none;display:inline-block;font-weight:700;">Restablecer contraseña</a></p>
              <p style="color:#636366;font-size:13px;">Si no solicitaste esto, ignora este correo.</p>
              <p style="margin-top:24px;color:#636366;font-size:13px;">— Equipo PNPtv</p>
            </div>`
        : `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#111;">
              <h2 style="color:#D4007A;margin:0 0 16px;">Reset your password</h2>
              <p>Hey ${escape(displayName)},</p>
              <p>We got a request to reset your PNPtv password. Click below to set a new one. The link expires in 1 hour and can only be used once.</p>
              <p style="margin:24px 0;"><a href="${resetUrl}" style="background:#D4007A;color:#fff;padding:14px 24px;border-radius:10px;text-decoration:none;display:inline-block;font-weight:700;">Reset password</a></p>
              <p style="color:#636366;font-size:13px;">If you didn't request this, ignore this email.</p>
              <p style="margin-top:24px;color:#636366;font-size:13px;">— The PNPtv Team</p>
            </div>`;
      const EmailService = require('../../services/emailService');
      await EmailService.send({ to: email, subject, html });
      logger.info('[recover-account] local token reset email sent', { userId: u.id });
      return res.json({ success: true });
    }

    // Telegram/OIDC-only accounts (no password_hash): use Authentik recovery.
    if (!u.pnptv_id) {
      logger.info('[recover-account] no pnptv_id, nothing to recover', { userId: u.id });
      return res.json({ success: true });
    }
    let authentikPk = await AuthentikService._getUserPkBySub(u.pnptv_id);

    // Fallback: if PK not found by sub, try to find by email in Authentik and heal the pnptv_id
    if (!authentikPk) {
      logger.info('[recover-account] PK not found by sub, trying email fallback', { userId: u.id, email });
      const AuthentikURL = process.env.AUTHENTIK_URL || 'http://authentik-server:9000';
      const AuthentikToken = process.env.AUTHENTIK_API_TOKEN;
      try {
        const searchRes = await axios.get(`${AuthentikURL}/api/v3/core/users/`, {
          params: { email: email },
          headers: { 'Authorization': `Bearer ${AuthentikToken}` },
          timeout: 5000,
        });
        const match = searchRes.data.results.find(au => (au.email || '').toLowerCase() === email);
        if (match) {
          authentikPk = match.pk;
          // Heal the mismatch in our DB — skip if the uuid is already claimed by another user
          await getPool().query(
            'UPDATE users SET pnptv_id = $1, updated_at = NOW() WHERE id = $2 AND NOT EXISTS (SELECT 1 FROM users WHERE pnptv_id = $1 AND id != $2)',
            [match.uuid, u.id]
          );
          logger.info('[recover-account] healed pnptv_id mismatch via email fallback', { userId: u.id, newSub: match.uuid });
        }
      } catch (err) {
        logger.warn('[recover-account] Authentik email search failed', { userId: u.id, error: err.message });
      }
    }

    if (!authentikPk) {
      logger.warn('[recover-account] user has no matching Authentik account', { userId: u.id });
      // Final attempt: trigger Authentik's built-in email recovery flow (less customized)
      await AuthentikService.requestPasswordReset(email).catch(() => {});
      return res.json({ success: true });
    }

    const recoveryLink = (await AuthentikService.generateRecoveryLink(authentikPk))
      ?.replace('http://authentik-server:9000', 'https://auth.pnptv.app');
    if (!recoveryLink) {
      logger.error('[recover-account] generateRecoveryLink failed, falling back to built-in flow', { userId: u.id, pk: authentikPk });
      await AuthentikService.requestPasswordReset(email).catch(() => {});
      return res.json({ success: true });
    }
    const lang = (u.language || 'en').toLowerCase().startsWith('es') ? 'es' : 'en';
    const displayName = u.first_name || (lang === 'es' ? 'usuario' : 'there');
    const escape = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
    const subject = lang === 'es'
      ? 'Restablecer contraseña — PNPtv'
      : 'Reset your PNPtv password';
    const html = lang === 'es'
      ? `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#111;">
            <h2 style="color:#D4007A;margin:0 0 16px;">Restablecer contraseña</h2>
            <p>Hola ${escape(displayName)},</p>
            <p>Recibimos una solicitud para restablecer tu contraseña en PNPtv. Haz clic en el botón para crear una contraseña nueva. El enlace expira pronto y solo se puede usar una vez.</p>
            <p style="margin:24px 0;"><a href="${recoveryLink}" style="background:#D4007A;color:#fff;padding:14px 24px;border-radius:10px;text-decoration:none;display:inline-block;font-weight:700;">Restablecer contraseña</a></p>
            <p style="color:#636366;font-size:13px;">Si no solicitaste esto, ignora este correo.</p>
            <p style="margin-top:24px;color:#636366;font-size:13px;">— Equipo PNPtv</p>
          </div>`
      : `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#111;">
            <h2 style="color:#D4007A;margin:0 0 16px;">Reset your password</h2>
            <p>Hey ${escape(displayName)},</p>
            <p>We got a request to reset your PNPtv password. Click the button below to set a new one. The link expires shortly and can be used only once.</p>
            <p style="margin:24px 0;"><a href="${recoveryLink}" style="background:#D4007A;color:#fff;padding:14px 24px;border-radius:10px;text-decoration:none;display:inline-block;font-weight:700;">Reset password</a></p>
            <p style="color:#636366;font-size:13px;">If you didn't request this, ignore this email.</p>
            <p style="margin-top:24px;color:#636366;font-size:13px;">— The PNPtv Team</p>
          </div>`;
    const EmailService = require('../../services/emailService');
    await EmailService.send({ to: email, subject, html });
    logger.info('[recover-account] recovery email sent', { userId: u.id, pk: authentikPk });
  } catch (err) {
    logger.error('[recover-account] handler error', { email, error: err.message });
  }
  return res.json({ success: true });
}));
app.get('/api/webapp/auth/verify-email', verifyEmailLimiter, asyncHandler(webAppController.verifyEmail));
app.post('/api/webapp/auth/resend-verification', authLimiter, asyncHandler(webAppController.resendVerification));
app.get('/api/webapp/auth/x/start', asyncHandler(webAppController.xLoginStart));
app.get('/api/webapp/auth/x/callback', asyncHandler(webAppController.xLoginCallback));
app.post('/api/webapp/auth/x/unlink', requireSessionAuth, asyncHandler(webAppController.unlinkX));
app.get('/api/me', asyncHandler(webAppController.authStatus));
app.post('/api/webapp/auth/logout', asyncHandler(webAppController.logout));
app.post('/api/webapp/auth/forgot-password', authLimiter, asyncHandler(webAppController.forgotPassword));
app.post('/api/webapp/auth/reset-password', authLimiter, asyncHandler(webAppController.resetPassword));

// ── Authentik OIDC Routes ─────────────────────────────────────────────────────
// Privacy-first: no third-party cookies.  PKCE (S256) eliminates the need to
// send the client_secret from the browser.  State + verifier are stored in
// Redis with a 10-minute TTL.  Session is httpOnly, sameSite=lax, secure.
//
// Required env vars:
//   AUTHENTIK_OIDC_CLIENT_ID      — Client ID from the Authentik application config
//   AUTHENTIK_OIDC_CLIENT_SECRET  — Client secret (server-side only, never sent to browser)
//   AUTHENTIK_OIDC_REDIRECT_URI   — Must match exactly in Authentik (default: https://pnptv.app/auth/oidc/callback)
//   AUTHENTIK_OIDC_ISSUER         — Issuer slug URL (default: https://auth.pnptv.app/application/o/pnptv-app/)
// ─────────────────────────────────────────────────────────────────────────────

// Rate limiter — 10 OIDC login initiations per 15 min per IP
const oidcLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  handler: (req, res) => res.status(429).json({ error: 'Too many login attempts. Try again later.' }),
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiter — 20 callback attempts per 15 min per IP (allows for browser retries)
const oidcCallbackLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  handler: (req, res) => res.status(429).json({ error: 'Too many callback attempts. Try again later.' }),
  standardHeaders: true,
  legacyHeaders: false,
});

const OIDC_ALLOWED_RETURN_HOSTS = new Set([
  'pnptv.app',
  'app.pnptv.app',
]);

function sanitizeOidcReturnTo(raw) {
  if (typeof raw !== 'string' || !raw) return '/';
  // Require alphanumeric second char to block protocol-relative URLs (//evil.com).
  // Anchor with $ so the test covers the full string.
  if (/^\/[a-z0-9][a-z0-9/_\-?=#&%.]*$/i.test(raw)) return raw;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:') return '/';
    if (!OIDC_ALLOWED_RETURN_HOSTS.has(parsed.hostname)) return '/';
    // Strip query/fragment from external URLs to prevent reflected-content issues.
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return '/';
  }
}

/**
 * GET /api/webapp/auth/oidc/login
 * Initiate Authentik OIDC login. Generates a PKCE verifier + state, stores them
 * in Redis for 10 minutes, then redirects the user to Authentik's authorization
 * endpoint. The browser never sees the verifier.
 */
app.get('/api/webapp/auth/oidc/login', oidcLoginLimiter, asyncHandler(async (req, res) => {
  if (!process.env.AUTHENTIK_OIDC_CLIENT_ID) {
    logger.error('[OIDC] AUTHENTIK_OIDC_CLIENT_ID is not configured');
    return res.status(503).json({ error: 'OIDC login is not configured on this server' });
  }

  // Generate cryptographically-secure state + PKCE verifier
  const state = crypto.randomBytes(24).toString('hex'); // 48 hex chars
  const codeVerifier = crypto.randomBytes(48).toString('base64url'); // 64 URL-safe chars

  // Store verifier + optional return URL in Redis (single-use, 10 min TTL)
  const redis = getRedis();
  const returnTo = sanitizeOidcReturnTo(req.query.return_to);
  const pkceKey = `oidc:pkce:${state}`;
  await redis.set(pkceKey, JSON.stringify({ codeVerifier, returnTo }), 'EX', 600);

  // Optional method hint — "passkey" or "magic_link". Mapped to Authentik
  // acr_values so a flow policy (operator-side config) can route the user to
  // the matching auth stage. Unrecognized values are dropped silently.
  const methodHint = ['passkey', 'magic_link', 'register'].includes(req.query.method) ? req.query.method : undefined;
  const loginHint = typeof req.query.login_hint === 'string' ? req.query.login_hint.trim() : '';

  // Build Authentik authorization URL (PKCE S256, no client_secret in URL)
  let authUrl;
  try {
    if (methodHint === 'register') {
      // Route directly to enrollment flow; ?next= brings user back to the
      // authorize endpoint after enrollment, which then fires our callback.
      authUrl = AuthentikService.generateEnrollmentUrl(state, codeVerifier);
    } else {
      authUrl = AuthentikService.generateAuthUrl(
        state,
        codeVerifier,
        {
          ...(methodHint ? { method: methodHint } : {}),
          ...(loginHint ? { loginHint } : {}),
        }
      );
    }
  } catch (err) {
    logger.error('[OIDC] Failed to generate auth URL:', err.message);
    await redis.del(pkceKey);
    return res.status(500).json({ error: 'Failed to initiate OIDC login' });
  }

  logger.info('[OIDC] Redirecting to Authentik', {
    state: state.slice(0, 8) + '...',
    flow: methodHint === 'register' ? 'enrollment' : 'login',
  });
  res.redirect(authUrl);
}));

/**
 * GET /api/webapp/auth/oidc/callback
 * Authentik redirects back here after the user authenticates.
 * Exchanges the authorization code for tokens, validates the id_token,
 * and upserts the PNPtv user account before establishing the session.
 */
app.get('/api/webapp/auth/oidc/callback', oidcCallbackLimiter, asyncHandler(async (req, res) => {
  const APP_URL = process.env.APP_PUBLIC_URL || 'https://pnptv.app';
  const loginRedirect = (code, returnTo) => {
    const qs = new URLSearchParams({ oidc_error: code });
    const safeReturnTo = sanitizeOidcReturnTo(returnTo);
    if (safeReturnTo !== '/') {
      qs.set('returnTo', safeReturnTo);
    }
    return `${APP_URL}/login?${qs.toString()}`;
  };

  // ── 1. Guard: error from Authentik ──────────────────────────────────────────
  if (req.query.error) {
    // Never reflect error_description from the auth server to the browser
    logger.warn('[OIDC] Callback received error from Authentik', {
      error: req.query.error,
      description: req.query.error_description, // logged server-side only
    });
    const safeErrors = new Set(['access_denied', 'server_error', 'temporarily_unavailable']);
    const safeCode = safeErrors.has(req.query.error) ? req.query.error : 'login_failed';
    return res.redirect(loginRedirect(safeCode));
  }

  const { code, state } = req.query;
  if (!code || !state || typeof code !== 'string' || typeof state !== 'string') {
    logger.warn('[OIDC] Callback missing code or state params');
    return res.redirect(loginRedirect('invalid_callback'));
  }

  // ── 2. Consume PKCE state from Redis (single-use) ───────────────────────────
  const redis = getRedis();
  const pkceKey = `oidc:pkce:${state}`;
  const pkceRaw = await redis.get(pkceKey);

  if (!pkceRaw) {
    logger.warn('[OIDC] PKCE state not found or expired', { state: state.slice(0, 8) + '...' });
    return res.redirect(loginRedirect('state_mismatch'));
  }

  // Delete immediately — single-use token prevents replay attacks
  await redis.del(pkceKey);

  let pkceData;
  try {
    pkceData = JSON.parse(pkceRaw);
  } catch {
    logger.error('[OIDC] PKCE Redis value is not valid JSON');
    return res.redirect(loginRedirect('state_mismatch'));
  }

  const { codeVerifier, returnTo } = pkceData;

  // ── 3. Exchange authorization code for tokens ────────────────────────────────
  let tokens;
  try {
    tokens = await AuthentikService.exchangeCode(code, codeVerifier);
  } catch (err) {
    logger.error('[OIDC] Code exchange failed:', err.message);
    const errorCode = err.message.includes('expired') ? 'session_expired'
      : err.message.includes('issuer') ? 'invalid_issuer'
      : 'token_exchange_failed';
    return res.redirect(loginRedirect(errorCode, returnTo));
  }

  const { refreshToken, userInfo } = tokens;
  const { sub, email, name, preferred_username, picture, email_verified } = userInfo;

  if (!sub) {
    logger.error('[OIDC] userInfo missing sub claim — cannot link account');
    return res.redirect(loginRedirect('invalid_userinfo', returnTo));
  }

  logger.info('[OIDC] Callback successful', {
    sub,
    username: preferred_username,
    email: email ? email.replace(/(.{2}).*@/, '$1***@') : null,
  });

  // ── 4. Upsert PNPtv user — link via pnptv_id (stable across renames) ───
  // Anything that throws inside this block (DB FK violations, session
  // regenerate failures, transient pool errors) must redirect the browser
  // back to /login with a safe error code instead of bubbling to the global
  // 500 handler — otherwise the user sees a blank error page and the login
  // button looks broken.
  const pool = getPool();
  let userRow;
  try {

  // Try to find existing user by pnptv_id first (most reliable identity anchor)
  // Fall back to email match so existing email-registered users get linked on first OIDC login

  const subLookup = await pool.query(
    `SELECT id, pnptv_id, username, first_name, last_name, subscription_status,
            tier, terms_accepted, age_verified, photo_file_id, bio, language, role,
            creator_status, content_disclaimer, telegram, twitter, x_user_id, x_id,
            email, last_login_method
     FROM users
     WHERE pnptv_id = $1 AND is_deleted = false
     LIMIT 1`,
    [sub]
  );

  if (subLookup.rows.length > 0) {
    userRow = subLookup.rows[0];
    // Refresh mutable profile fields from Authentik's latest userinfo
    const displayName = name || preferred_username || userRow.first_name || null;
    await pool.query(
      `UPDATE users
       SET last_login_method = 'oidc',
           last_login_at = NOW(),
           first_name = COALESCE(NULLIF($1, ''), first_name),
           photo_file_id = COALESCE(NULLIF($2, ''), photo_file_id)
       WHERE id = $3`,
      [displayName, picture || null, userRow.id]
    );
    userRow.first_name = displayName || userRow.first_name;
    userRow.last_login_method = 'oidc';
  } else if (email) {
    // No existing OIDC link — check if an account with this email already exists (case-insensitive)
    const emailLookup = await pool.query(
      `SELECT id, pnptv_id, username, first_name, last_name, subscription_status,
              tier, terms_accepted, age_verified, photo_file_id, bio, language, role,
              creator_status, content_disclaimer, telegram, twitter, x_user_id, x_id,
              email, last_login_method
       FROM users
       WHERE LOWER(email) = LOWER($1) AND is_deleted = false
       LIMIT 1`,
      [email]
    );
    if (emailLookup.rows.length > 0) {
      userRow = emailLookup.rows[0];
      // Link pnptv_id to the found user (first OIDC login for an existing account)
      const displayName = name || preferred_username || userRow.first_name || null;
      await pool.query(
        `UPDATE users
         SET pnptv_id = $1,
             last_login_method = 'oidc',
             last_login_at = NOW(),
             first_name = COALESCE(NULLIF($2, ''), first_name),
             photo_file_id = COALESCE(NULLIF($3, ''), photo_file_id)
         WHERE id = $4
           AND NOT EXISTS (SELECT 1 FROM users WHERE pnptv_id = $1 AND id != $4)`,
        [sub, displayName, picture || null, userRow.id]
      );
      userRow.pnptv_id = sub;
      userRow.first_name = displayName || userRow.first_name;
      userRow.last_login_method = 'oidc';
      logger.info('[OIDC] Linked pnptv_id to existing email account', { userId: userRow.id, sub });
    }
  }

  // Fallback #3 — username match. Telegram-widget users have placeholder
  // @telegram.pnptv.app emails in Authentik that don't match their real email
  // in our users table, so the email lookup misses. Match by preferred_username
  // before falling through to INSERT (otherwise the unique-username constraint
  // throws 500 on every login attempt).
  if (!userRow && preferred_username) {
    const usernameLookup = await pool.query(
      `SELECT id, pnptv_id, username, first_name, last_name, subscription_status,
              tier, terms_accepted, age_verified, photo_file_id, bio, language, role,
              creator_status, content_disclaimer, telegram, twitter, x_user_id, x_id,
              email, last_login_method
       FROM users
       WHERE LOWER(username) = LOWER($1) AND is_deleted = false
       LIMIT 1`,
      [preferred_username]
    );
    if (usernameLookup.rows.length > 0) {
      userRow = usernameLookup.rows[0];
      const displayName = name || preferred_username || userRow.first_name || null;
      await pool.query(
        `UPDATE users
         SET pnptv_id = $1,
             last_login_method = 'oidc',
             last_login_at = NOW(),
             first_name = COALESCE(NULLIF($2, ''), first_name),
             photo_file_id = COALESCE(NULLIF($3, ''), photo_file_id),
             email = COALESCE(NULLIF($4, ''), email)
         WHERE id = $5
           AND NOT EXISTS (SELECT 1 FROM users WHERE pnptv_id = $1 AND id != $5)`,
        [sub, displayName, picture || null, email || null, userRow.id]
      );
      userRow.pnptv_id = sub;
      userRow.first_name = displayName || userRow.first_name;
      userRow.last_login_method = 'oidc';
      logger.info('[OIDC] Linked pnptv_id to existing username account', { userId: userRow.id, sub, username: preferred_username });
    }
  }

  if (!userRow) {
    // No existing user — create a new PNPtv account linked to this Authentik identity
    const baseUsername = (preferred_username || (email ? email.split('@')[0] : null) || `user_${crypto.randomBytes(4).toString('hex')}`)
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '')
      .slice(0, 30);

    // Ensure username uniqueness by appending a random hex suffix if needed
    let finalUsername = baseUsername || `user_${crypto.randomBytes(4).toString('hex')}`;
    // Probe for collisions (active OR soft-deleted rows). The unique index
    // covers ALL rows, not just active ones, so we must include soft-deleted.
    const usernameCheck = await pool.query(
      'SELECT 1 FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1',
      [finalUsername]
    );
    if (usernameCheck.rows.length > 0) {
      finalUsername = `${finalUsername}_${crypto.randomBytes(3).toString('hex')}`;
    }

    const newUserId = crypto.randomUUID();
    let insertResult;
    try {
      insertResult = await pool.query(
        `INSERT INTO users
           (id, pnptv_id, username, first_name, email, email_verified,
            photo_file_id, tier, subscription_status, terms_accepted,
            role, last_login_method, last_login_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'free', 'free', false,
                 'user', 'oidc', NOW(), NOW(), NOW())
         RETURNING id, pnptv_id, username, first_name, last_name, subscription_status,
                   tier, terms_accepted, age_verified, photo_file_id, bio, language, role,
                   creator_status, content_disclaimer, telegram, twitter, x_user_id, x_id,
                   email, last_login_method`,
        [
          newUserId,
          sub,
          finalUsername,
          name || preferred_username || finalUsername,
          email ? email.toLowerCase() : null,
          email_verified === true,
          picture || null,
        ]
      );
    } catch (err) {
      // Race or soft-deleted-row collision survived the precheck. Last-resort
      // recovery: append entropy and retry once. If that also fails, abort
      // gracefully instead of 500-bouncing the user.
      if (err.code === '23505' && /username/i.test(err.constraint || '')) {
        const recoverUsername = `${finalUsername}_${crypto.randomBytes(4).toString('hex')}`;
        logger.warn('[OIDC] Username collision survived precheck, retrying with entropy suffix', {
          original: finalUsername, retry: recoverUsername, sub,
        });
        insertResult = await pool.query(
          `INSERT INTO users
             (id, pnptv_id, username, first_name, email, email_verified,
              photo_file_id, tier, subscription_status, terms_accepted,
              role, last_login_method, last_login_at, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'free', 'free', false,
                   'user', 'oidc', NOW(), NOW(), NOW())
           RETURNING id, pnptv_id, username, first_name, last_name, subscription_status,
                     tier, terms_accepted, age_verified, photo_file_id, bio, language, role,
                     creator_status, content_disclaimer, telegram, twitter, x_user_id, x_id,
                     email, last_login_method`,
          [
            newUserId,
            sub,
            recoverUsername,
            name || preferred_username || recoverUsername,
            email ? email.toLowerCase() : null,
            email_verified === true,
            picture || null,
          ]
        );
      } else {
        throw err;
      }
    }
    userRow = insertResult.rows[0];
    logger.info('[OIDC] Created new PNPtv user via Authentik OIDC', {
      userId: userRow.id,
      username: userRow.username,
      sub,
    });
    // Auto-follow the PNPtv! system account so its posts reach new users
    void enforceDefaultFollows(userRow.id);
  }

  // ── 5. Regenerate session to prevent session fixation ────────────────────────
  await new Promise((resolve, reject) => {
    req.session.regenerate((err) => (err ? reject(err) : resolve()));
  });

  // Build session object matching the shape of buildSession() in webAppController.js
  req.session.user = {
    id: userRow.id,
    pnptvId: userRow.pnptv_id,
    username: userRow.username,
    displayName: userRow.first_name || userRow.username || 'Member',
    firstName: userRow.first_name,
    lastName: userRow.last_name,
    subscriptionStatus: userRow.subscription_status,
    tier: userRow.tier || 'free',
    acceptedTerms: userRow.terms_accepted,
    ageVerified: userRow.age_verified || false,
    email: userRow.email || null,
    photoUrl: userRow.photo_file_id,
    bio: userRow.bio,
    language: userRow.language,
    role: userRow.role || 'user',
    creator_status: userRow.creator_status || 'none',
    contentDisclaimer: userRow.content_disclaimer || false,
    // X identity
    xHandle: userRow.twitter || userRow.x_username || null,
    // Authentik OIDC identity — refresh_token stored server-side in session only
    pnptv_id: userRow.pnptv_id,
    oidc_refresh_token: refreshToken || null,
    // Hybrid auth method flags
    auth_methods: {
      telegram: !!(userRow.telegram),
      x: !!(userRow.twitter || userRow.x_user_id || userRow.x_id),
      oidc: true,
    },
    last_login_method: 'oidc',
  };

  // Persist session before redirect
  await new Promise((resolve, reject) => {
    req.session.save((err) => (err ? reject(err) : resolve()));
  });

  logger.info('[OIDC] Session established', { userId: userRow.id, sub });

  } catch (err) {
    logger.error('[OIDC] Upsert/session step failed:', {
      message: err.message,
      code: err.code,
      constraint: err.constraint,
      detail: err.detail,
      sub,
    });
    return res.redirect(loginRedirect('login_failed', returnTo));
  }

  // Sync Authentik groups based on PNPtv role/tier (fire-and-forget)
  setImmediate(async () => {
    try {
      await AuthentikService.syncUserGroups(sub, {
        role: userRow.role,
        tier: userRow.tier,
        creatorStatus: userRow.creator_status,
      });
    } catch {}
  });

  // Redirect back to the trusted caller, preserving cross-subdomain Studio SSO.
  const safeReturnTo = sanitizeOidcReturnTo(returnTo);
  if (safeReturnTo.startsWith('https://')) {
    const target = new URL(safeReturnTo);
    target.searchParams.set('oidc_linked', '1');
    return res.redirect(target.toString());
  }
  res.redirect(`${APP_URL}${safeReturnTo === '/' ? '' : safeReturnTo}?oidc_linked=1`);
}));

/**
 * POST /api/webapp/auth/register
 * Native PNPtv account registration — bypasses Authentik enrollment flow.
 * Creates the user in Authentik via admin API, then in PNPtv DB, then
 * establishes the session directly (same shape as OIDC callback).
 */
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => req.ip,
  handler: (req, res) => res.status(429).json({ error: 'Too many registration attempts. Try again later.' }),
  standardHeaders: true,
  legacyHeaders: false,
});

app.post('/api/webapp/auth/register', registerLimiter, asyncHandler(async (req, res) => {
  const { email, username, password } = req.body || {};

  // ── 1. Input validation ──────────────────────────────────────────────────────
  if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return res.status(400).json({ error: 'A valid email address is required.' });
  }
  if (!username || typeof username !== 'string' || !/^[a-zA-Z0-9_]{3,30}$/.test(username.trim())) {
    return res.status(400).json({ error: 'Username must be 3–30 characters (letters, numbers, underscores only).' });
  }
  if (!password || typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }
  if (password.length > 128) {
    return res.status(400).json({ error: 'Password is too long.' });
  }

  const cleanEmail = email.trim().toLowerCase();
  const cleanUsername = username.trim();

  const pool = getPool();
  const AUTHENTIK_URL = process.env.AUTHENTIK_URL || 'https://auth.pnptv.app';
  const AUTHENTIK_TOKEN = process.env.AUTHENTIK_API_TOKEN;

  if (!AUTHENTIK_TOKEN) {
    logger.error('[Register] AUTHENTIK_API_TOKEN is not configured');
    return res.status(503).json({ error: 'Registration is temporarily unavailable.' });
  }

  // ── 2. Check availability in PNPtv DB ───────────────────────────────────────
  const [emailCheck, usernameCheck] = await Promise.all([
    pool.query('SELECT 1 FROM users WHERE LOWER(email) = $1 AND is_deleted = false LIMIT 1', [cleanEmail]),
    pool.query('SELECT 1 FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1', [cleanUsername]),
  ]);
  if (emailCheck.rows.length > 0) {
    return res.status(409).json({ error: 'An account with this email already exists. Sign in instead.' });
  }
  if (usernameCheck.rows.length > 0) {
    return res.status(409).json({ error: 'That username is already taken. Try a different one.' });
  }

  // ── 3. Create user in Authentik ──────────────────────────────────────────────
  let authentikUser;
  try {
    // Check if email already exists in Authentik.
    // Orphaned Authentik accounts (type=external, no PNPtv DB row) are leftovers
    // from the old enrollment flow that failed before writing to our DB — delete
    // them so registration can proceed cleanly.
    const existingRes = await axios.get(`${AUTHENTIK_URL}/api/v3/core/users/`, {
      params: { email: cleanEmail },
      headers: { Authorization: `Bearer ${AUTHENTIK_TOKEN}` },
      timeout: 10000,
    });
    if (existingRes.data.results && existingRes.data.results.length > 0) {
      // Check if any of these have a matching PNPtv DB account
      const subs = existingRes.data.results.map((u) => u.uuid || String(u.pk));
      const dbCheck = await pool.query(
        `SELECT 1 FROM users WHERE pnptv_id = ANY($1::text[]) AND is_deleted = false LIMIT 1`,
        [subs]
      );
      if (dbCheck.rows.length > 0) {
        return res.status(409).json({ error: 'An account with this email already exists. Sign in instead.' });
      }
      // Orphaned Authentik accounts — delete them so we can re-create cleanly
      for (const orphan of existingRes.data.results) {
        try {
          await axios.delete(`${AUTHENTIK_URL}/api/v3/core/users/${orphan.pk}/`, {
            headers: { Authorization: `Bearer ${AUTHENTIK_TOKEN}` },
            timeout: 10000,
          });
          logger.info('[Register] Deleted orphaned Authentik account', { pk: orphan.pk, email: cleanEmail });
        } catch (delErr) {
          logger.warn('[Register] Could not delete orphaned Authentik account', { pk: orphan.pk, error: delErr.message });
        }
      }
    }

    const createRes = await axios.post(`${AUTHENTIK_URL}/api/v3/core/users/`, {
      username: cleanUsername,
      name: cleanUsername,
      email: cleanEmail,
      type: 'internal',
      is_active: true,
      path: 'users',
      attributes: {
        provisioned_via: 'native_registration',
        provisioned_at: new Date().toISOString(),
      },
    }, {
      headers: { Authorization: `Bearer ${AUTHENTIK_TOKEN}` },
      timeout: 10000,
    });
    authentikUser = createRes.data;
  } catch (err) {
    const data = err.response?.data;
    if (err.response?.status === 400 && data?.username) {
      return res.status(409).json({ error: 'That username is already taken in our identity provider. Try a different one.' });
    }
    if (err.response?.status === 400 && data?.email) {
      return res.status(409).json({ error: 'An account with this email already exists. Sign in instead.' });
    }
    logger.error('[Register] Failed to create Authentik user:', err.response?.data || err.message);
    return res.status(503).json({ error: 'Registration failed. Please try again.' });
  }

  // ── 4. Set password ──────────────────────────────────────────────────────────
  try {
    await axios.post(`${AUTHENTIK_URL}/api/v3/core/users/${authentikUser.pk}/set_password/`, {
      password,
    }, {
      headers: { Authorization: `Bearer ${AUTHENTIK_TOKEN}` },
      timeout: 10000,
    });
  } catch (err) {
    // Clean up the Authentik user so it can be retried
    try {
      await axios.delete(`${AUTHENTIK_URL}/api/v3/core/users/${authentikUser.pk}/`, {
        headers: { Authorization: `Bearer ${AUTHENTIK_TOKEN}` },
        timeout: 10000,
      });
    } catch { /* best-effort */ }
    logger.error('[Register] Failed to set Authentik password:', err.response?.data || err.message);
    return res.status(503).json({ error: 'Registration failed. Please try again.' });
  }

  // ── 5. Add to Users group (best-effort) ─────────────────────────────────────
  try {
    const groupRes = await axios.get(`${AUTHENTIK_URL}/api/v3/core/groups/`, {
      params: { name: 'Users' },
      headers: { Authorization: `Bearer ${AUTHENTIK_TOKEN}` },
      timeout: 10000,
    });
    const usersGroup = groupRes.data.results?.find((g) => g.name === 'Users');
    if (usersGroup) {
      await axios.post(`${AUTHENTIK_URL}/api/v3/core/groups/${usersGroup.pk}/add_user/`, {
        pk: authentikUser.pk,
      }, {
        headers: { Authorization: `Bearer ${AUTHENTIK_TOKEN}` },
        timeout: 10000,
      });
    }
  } catch (groupErr) {
    logger.warn('[Register] Failed to add user to Users group (non-fatal):', groupErr.message);
  }

  // ── 6. Create PNPtv DB user ──────────────────────────────────────────────────
  const sub = authentikUser.uuid || String(authentikUser.pk);
  const newUserId = crypto.randomUUID();
  let userRow;
  try {
    const insertResult = await pool.query(
      `INSERT INTO users
         (id, pnptv_id, username, first_name, email, email_verified,
          tier, subscription_status, terms_accepted,
          role, last_login_method, last_login_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, false, 'free', 'free', false,
               'user', 'native_register', NOW(), NOW(), NOW())
       RETURNING id, pnptv_id, username, first_name, last_name, subscription_status,
                 tier, terms_accepted, age_verified, photo_file_id, bio, language, role,
                 creator_status, content_disclaimer, telegram, twitter, x_user_id, x_id,
                 email, last_login_method`,
      [newUserId, sub, cleanUsername, cleanUsername, cleanEmail]
    );
    userRow = insertResult.rows[0];
  } catch (err) {
    // Clean up Authentik user
    try {
      await axios.delete(`${AUTHENTIK_URL}/api/v3/core/users/${authentikUser.pk}/`, {
        headers: { Authorization: `Bearer ${AUTHENTIK_TOKEN}` },
        timeout: 10000,
      });
    } catch { /* best-effort */ }
    if (err.code === '23505') {
      return res.status(409).json({ error: 'An account with this username or email already exists.' });
    }
    logger.error('[Register] Failed to insert PNPtv user:', err.message);
    return res.status(503).json({ error: 'Registration failed. Please try again.' });
  }

  logger.info('[Register] New PNPtv user registered natively', {
    userId: userRow.id,
    username: userRow.username,
    sub,
  });
  // Auto-follow the PNPtv! system account so its posts reach new users
  void enforceDefaultFollows(userRow.id);

  // ── 7. Establish session ─────────────────────────────────────────────────────
  await new Promise((resolve, reject) => {
    req.session.regenerate((err) => (err ? reject(err) : resolve()));
  });

  req.session.user = {
    id: userRow.id,
    pnptvId: userRow.pnptv_id,
    username: userRow.username,
    displayName: userRow.first_name || userRow.username || 'Member',
    firstName: userRow.first_name,
    lastName: userRow.last_name,
    subscriptionStatus: userRow.subscription_status,
    tier: userRow.tier || 'free',
    acceptedTerms: userRow.terms_accepted,
    ageVerified: userRow.age_verified || false,
    email: userRow.email || null,
    photoUrl: userRow.photo_file_id || null,
    bio: userRow.bio || null,
    language: userRow.language || null,
    role: userRow.role || 'user',
    creator_status: userRow.creator_status || 'none',
    contentDisclaimer: userRow.content_disclaimer || false,
    xHandle: null,
    pnptv_id: userRow.pnptv_id,
    oidc_refresh_token: null,
    auth_methods: { telegram: false, x: false, oidc: false },
    last_login_method: 'native_register',
  };

  await new Promise((resolve, reject) => {
    req.session.save((err) => (err ? reject(err) : resolve()));
  });

  return res.json({ success: true });
}));

/**
 * POST /api/webapp/auth/oidc/refresh
 * Refreshes the session's OIDC tokens using the stored refresh_token.
 * Requires an active session. The new refresh token is stored back in the session.
 * The access_token is NOT returned to the client — it is used server-side only.
 */
app.post('/api/webapp/auth/oidc/refresh', requireSessionAuth, asyncHandler(async (req, res) => {
  const user = req.session.user;

  if (!user.oidc_refresh_token) {
    return res.status(400).json({
      error: 'NO_REFRESH_TOKEN',
      message: 'No OIDC refresh token in session. Please log in again.',
    });
  }

  let newTokens;
  try {
    newTokens = await AuthentikService.refreshTokens(user.oidc_refresh_token);
  } catch (err) {
    logger.warn('[OIDC] Token refresh failed', { userId: user.id, error: err.message });
    // Refresh token is invalid or expired — clear it and signal re-authentication
    req.session.user.oidc_refresh_token = null;
    await new Promise((resolve, reject) => {
      req.session.save((err2) => (err2 ? reject(err2) : resolve()));
    });
    return res.status(401).json({
      error: 'REFRESH_FAILED',
      message: 'Session refresh failed. Please log in again.',
    });
  }

  // Store the new refresh token (access token is NOT persisted to session)
  if (newTokens.refreshToken) {
    req.session.user.oidc_refresh_token = newTokens.refreshToken;
  }

  await new Promise((resolve, reject) => {
    req.session.save((err) => (err ? reject(err) : resolve()));
  });

  logger.info('[OIDC] Tokens refreshed', { userId: user.id });
  res.json({ success: true, message: 'Session refreshed' });
}));

/**
 * POST /api/webapp/auth/oidc/logout
 * Revokes the OIDC refresh token at Authentik's revocation endpoint,
 * then destroys the local session (or clears only the OIDC fields if the
 * user still has another auth method active — Telegram, X, or ATProto).
 */
app.post('/api/webapp/auth/oidc/logout', requireSessionAuth, asyncHandler(async (req, res) => {
  const user = req.session.user;
  const storedRefreshToken = user.oidc_refresh_token;

  // Revoke refresh token at Authentik (best-effort — non-blocking)
  if (storedRefreshToken) {
    AuthentikService.revokeToken(storedRefreshToken).catch((err) => {
      logger.warn('[OIDC] Token revocation during logout failed (non-fatal):', err.message);
    });
  }

  const hasOtherAuth = user.auth_methods?.telegram
    || user.auth_methods?.x
    ;

  if (!hasOtherAuth) {
    // Full logout — no other auth method linked
    const userId = user.id;
    await new Promise((resolve) => {
      req.session.destroy(() => resolve());
    });
    res.clearCookie('__pnptv_sid');
    logger.info('[OIDC] Full session destroyed after OIDC logout', { userId });
    return res.json({ success: true, message: 'Logged out' });
  }

  // Partial logout — clear only OIDC fields, retain other auth methods
  req.session.user.pnptv_id = null;
  req.session.user.oidc_refresh_token = null;
  if (req.session.user.auth_methods) {
    req.session.user.auth_methods.oidc = false;
  }

  await new Promise((resolve, reject) => {
    req.session.save((err) => (err ? reject(err) : resolve()));
  });

  logger.info('[OIDC] OIDC session unlinked, other methods retained', {
    userId: user.id,
    remainingMethods: req.session.user.auth_methods,
  });

  res.json({ success: true, message: 'OIDC session revoked, other sessions retained' });
}));

// Rate limiter — 5 enable-pnptv-id attempts per hour per IP
const enablePnptvIdLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  handler: (req, res) => res.status(429).json({ error: 'Too many attempts. Try again later.' }),
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * POST /api/webapp/auth/enable-pnptv-id
 * For Telegram-registered users who want to enable email+password (PNPtv ID) login.
 * Flow: validates email → updates Authentik email + PNPtv DB email → generates
 * one-time recovery link → emails link via our SMTP so user can set a password.
 *
 * Body: { email: string }
 * Auth: session required
 */
app.post('/api/webapp/auth/enable-pnptv-id', requireSessionAuth, enablePnptvIdLimiter, asyncHandler(async (req, res) => {
  const user = req.session.user;
  const rawEmail = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';

  if (!rawEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
    return res.status(400).json({ success: false, error: 'INVALID_EMAIL', message: 'Please provide a valid email address.' });
  }

  if (rawEmail.endsWith('@telegram.pnptv.app')) {
    return res.status(400).json({ success: false, error: 'INVALID_EMAIL', message: 'Please use your real email address, not the placeholder.' });
  }

  if (!user.pnptvId && !user.pnptv_id) {
    return res.status(400).json({ success: false, error: 'NO_AUTHENTIK_SUB', message: 'No Authentik identity linked to this account.' });
  }

  const sub = user.pnptvId || user.pnptv_id;
  const pool = getPool();

  // Guard: email not already used by another PNPtv account
  const dup = await pool.query(
    `SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND id != $2 AND COALESCE(is_deleted, false) = false LIMIT 1`,
    [rawEmail, user.id]
  );
  if (dup.rows.length > 0) {
    return res.status(409).json({ success: false, error: 'EMAIL_TAKEN', message: 'That email is already linked to another PNPtv account.' });
  }

  // Resolve Authentik user pk from our stored sub
  const authentikPk = await AuthentikService._getUserPkBySub(sub);
  if (!authentikPk) {
    logger.error('[enable-pnptv-id] Authentik user not found for sub', { userId: user.id, sub });
    return res.status(500).json({ success: false, error: 'AUTHENTIK_LOOKUP_FAILED', message: 'Could not locate your identity in our identity provider.' });
  }

  // Update Authentik email
  const emailUpdated = await AuthentikService.updateUserEmail(authentikPk, rawEmail);
  if (!emailUpdated) {
    return res.status(500).json({ success: false, error: 'AUTHENTIK_UPDATE_FAILED', message: 'Failed to update your email at our identity provider.' });
  }

  // Mirror the email change in the PNPtv DB
  try {
    await pool.query(
      `UPDATE users SET email = $1, updated_at = NOW() WHERE id = $2`,
      [rawEmail, user.id]
    );
  } catch (dbErr) {
    logger.error('[enable-pnptv-id] Failed to update PNPtv DB email (Authentik already updated)', { userId: user.id, error: dbErr.message });
    // Non-fatal — Authentik is the source of truth for login
  }

  // Generate a one-time recovery link at Authentik and email it via our SMTP
  const recoveryLink = await AuthentikService.generateRecoveryLink(authentikPk);
  if (!recoveryLink) {
    return res.status(500).json({ success: false, error: 'RECOVERY_LINK_FAILED', message: 'Could not generate a set-password link. Please try again.' });
  }

  try {
    const EmailService = require('../../services/emailService');
    const escape = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
    const displayName = user.displayName || user.firstName || user.username || 'there';
    await EmailService.send({
      to: rawEmail,
      subject: 'Set your PNPtv ID password',
      html: `
        <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#111;">
          <h2 style="color:#D4007A;margin:0 0 16px;">Welcome to PNPtv ID login</h2>
          <p>Hey ${escape(displayName)},</p>
          <p>You asked to enable <strong>email + password</strong> login for your PNPtv account. Click the button below to set a password — the link is one-time use and expires shortly.</p>
          <p style="text-align:center;margin:28px 0;">
            <a href="${escape(recoveryLink)}" style="display:inline-block;background:linear-gradient(135deg,#D4007A,#E69138);color:#fff;text-decoration:none;padding:14px 28px;border-radius:10px;font-weight:700;">Set my password</a>
          </p>
          <p style="color:#666;font-size:13px;">If the button doesn't work, paste this link into your browser:<br><span style="word-break:break-all;">${escape(recoveryLink)}</span></p>
          <p style="color:#666;font-size:13px;">If you didn't request this, you can ignore this email — your account stays as it was.</p>
          <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
          <p style="color:#999;font-size:12px;">PNPtv! · <a href="https://pnptv.app" style="color:#999;">pnptv.app</a></p>
        </div>
      `,
    });
  } catch (mailErr) {
    logger.error('[enable-pnptv-id] Failed to send recovery email', { userId: user.id, error: mailErr.message });
    return res.status(500).json({ success: false, error: 'EMAIL_SEND_FAILED', message: 'We saved your email but could not send the set-password link. Please try again.' });
  }

  logger.info('[enable-pnptv-id] PNPtv ID login enabled for user', { userId: user.id, sub });

  res.json({
    success: true,
    message: 'Check your email for a link to set your password.',
    email: rawEmail,
  });
}));

// ── End Authentik OIDC Routes ─────────────────────────────────────────────────

/**
 * POST /api/webapp/settings/change-email
 * Change the account email for an authenticated user.
 * Validates uniqueness, updates DB + Authentik, notifies old + new address.
 *
 * Body: { email: string }
 * Auth: session required
 */
const changeEmailLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  handler: (req, res) => res.status(429).json({ error: 'Too many attempts. Try again later.' }),
  standardHeaders: true,
  legacyHeaders: false,
});
app.post('/api/webapp/settings/change-email', requireSessionAuth, changeEmailLimiter, asyncHandler(async (req, res) => {
  const user = req.session.user;
  const rawEmail = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';

  if (!rawEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
    return res.status(400).json({ error: 'Please provide a valid email address.' });
  }
  if (rawEmail.endsWith('@telegram.pnptv.app')) {
    return res.status(400).json({ error: 'Please use a real email address.' });
  }

  const pool = getPool();

  const currentRow = await pool.query('SELECT email FROM users WHERE id = $1', [user.id]);
  const currentEmail = currentRow.rows[0]?.email ?? '';

  if (currentEmail.toLowerCase() === rawEmail) {
    return res.status(400).json({ error: 'That is already your current email.' });
  }

  const dup = await pool.query(
    `SELECT id FROM users WHERE LOWER(email) = $1 AND id != $2 AND COALESCE(is_deleted, false) = false LIMIT 1`,
    [rawEmail, user.id]
  );
  if (dup.rows.length > 0) {
    return res.status(409).json({ error: 'That email is already linked to another account.' });
  }

  // Update in Authentik if identity is linked
  const sub = user.pnptvId || user.pnptv_id;
  if (sub) {
    const authentikPk = await AuthentikService._getUserPkBySub(sub).catch(() => null);
    if (authentikPk) {
      await AuthentikService.updateUserEmail(authentikPk, rawEmail).catch((err) => {
        logger.warn('[change-email] Authentik email update failed (non-fatal)', { userId: user.id, error: err.message });
      });
    }
  }

  await pool.query(`UPDATE users SET email = $1, updated_at = NOW() WHERE id = $2`, [rawEmail, user.id]);

  // Update session
  req.session.user.email = rawEmail;
  await new Promise((resolve, reject) => req.session.save(err => (err ? reject(err) : resolve())));

  // Send notification emails (non-fatal)
  try {
    const EmailService = require('../../services/emailService');
    const escape = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
    const displayName = user.displayName || user.firstName || user.username || 'there';

    if (currentEmail && !currentEmail.endsWith('@telegram.pnptv.app')) {
      await EmailService.send({
        to: currentEmail,
        subject: 'Your PNPtv email has been changed',
        html: `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#111;">
          <h2 style="color:#D4007A;margin:0 0 16px;">Email address changed</h2>
          <p>Hey ${escape(displayName)},</p>
          <p>Your PNPtv account email was changed to <strong>${escape(rawEmail)}</strong>.</p>
          <p>If you did not make this change, contact us immediately at <a href="mailto:support@pnptv.app">support@pnptv.app</a>.</p>
          <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
          <p style="color:#999;font-size:12px;">PNPtv! · <a href="https://pnptv.app" style="color:#999;">pnptv.app</a></p>
        </div>`,
      }).catch(() => {});
    }

    await EmailService.send({
      to: rawEmail,
      subject: 'PNPtv email address confirmed',
      html: `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#111;">
        <h2 style="color:#D4007A;margin:0 0 16px;">Email address confirmed</h2>
        <p>Hey ${escape(displayName)},</p>
        <p>This email address is now linked to your PNPtv account. You can use it to log in and receive notifications.</p>
        <p style="text-align:center;margin:28px 0;">
          <a href="https://pnptv.app/settings" style="display:inline-block;background:linear-gradient(135deg,#D4007A,#E69138);color:#fff;text-decoration:none;padding:14px 28px;border-radius:10px;font-weight:700;">Go to settings</a>
        </p>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
        <p style="color:#999;font-size:12px;">PNPtv! · <a href="https://pnptv.app" style="color:#999;">pnptv.app</a></p>
      </div>`,
    }).catch(() => {});
  } catch (mailErr) {
    logger.warn('[change-email] Failed to send notification emails', { userId: user.id, error: mailErr.message });
  }

  logger.info('[change-email] Email changed', { userId: user.id, newEmail: rawEmail });
  res.json({ success: true, email: rawEmail });
}));

// Web App Profile
app.get('/api/webapp/profile', requireSessionAuth, asyncHandler(webAppController.getProfile));
app.put('/api/webapp/profile', requireSessionAuth, asyncHandler(webAppController.updateProfile));
app.post('/api/webapp/profile/avatar', requireSessionAuth, uploadLimiter, avatarUpload.single('avatar'), verifyMagicBytes(IMAGE_MIMES), asyncHandler(webAppController.uploadAvatar));
app.post('/api/webapp/profile/telegram/link', telegramWidgetLimiter, requireSessionAuth, asyncHandler(webAppController.linkTelegram));
app.post('/api/webapp/profile/telegram/unlink', requireSessionAuth, asyncHandler(webAppController.unlinkTelegram));
app.post('/api/webapp/upload/event-cover', requireSessionAuth, uploadLimiter, eventCoverUpload.single('media'), verifyMagicBytes(IMAGE_MIMES), asyncHandler(webAppController.uploadEventCover));

// Web App Privacy Settings
app.patch('/api/webapp/privacy', asyncHandler(async (req, res) => {
  const user = req.session?.user;
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  const ALLOWED_KEYS = ['showBio', 'showOnline', 'showLocation', 'showDob', 'allowMessages', 'showInterests', 'autoShareToX'];
  const updates = {};
  for (const key of ALLOWED_KEYS) {
    if (typeof req.body[key] === 'boolean') updates[key] = req.body[key];
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No valid privacy fields provided' });
  }

  const { query: dbQuery } = require('../../config/postgres');

  // Merge validated keys in one parameterized JSONB operation.
  // Never interpolate key names into SQL — even with an allowlist,
  // defense-in-depth demands fully parameterized queries.
  const params = [user.id, JSON.stringify(updates)];

  try {
    const result = await dbQuery(
      `UPDATE users SET privacy = COALESCE(privacy, '{}'::jsonb) || $2::jsonb, updated_at = NOW() WHERE id = $1 RETURNING privacy`,
      params
    );

    // Update session so subsequent auth-status calls reflect the change
    if (req.session?.user) {
      req.session.user.privacy = result.rows[0]?.privacy;
      await new Promise((resolve, reject) =>
        req.session.save(err => (err ? reject(err) : resolve()))
      );
    }

    return res.json({ success: true, privacy: result.rows[0]?.privacy });
  } catch (err) {
    logger.error('PATCH /api/webapp/privacy error:', err);
    return res.status(500).json({ error: 'Failed to update privacy settings' });
  }
}));

// Model Application File Uploads
const applyController = require('./controllers/applyController');
app.post('/api/apply/profile-photo', authenticateUser, uploadLimiter, uploadModelProfilePhoto, asyncHandler(applyController.uploadProfilePhoto));
app.post('/api/apply/id-documents', authenticateUser, uploadLimiter, uploadModelIdDocuments, asyncHandler(applyController.uploadIdDocuments));

// Web App User Location
app.get('/api/webapp/profile/location', requireSessionAuth, asyncHandler(userLocationController.getUserLocation));
app.put('/api/webapp/profile/location', requireSessionAuth, asyncHandler(userLocationController.updateUserLocation));
app.delete('/api/webapp/profile/location', requireSessionAuth, asyncHandler(userLocationController.deleteUserLocation));
app.get('/api/webapp/users/nearby', requireSessionAuth, asyncHandler(userLocationController.getNearbyUsers));

// Web App Block/Unblock Users
app.post('/api/webapp/users/block', requireSessionAuth, asyncHandler(blockedUsersController.blockUser));
app.delete('/api/webapp/users/unblock/:blockedUserId', requireSessionAuth, asyncHandler(blockedUsersController.unblockUser));
app.get('/api/webapp/users/blocked', requireSessionAuth, asyncHandler(blockedUsersController.getBlockedUsers));
app.get('/api/webapp/users/is-blocked/:userId', requireSessionAuth, asyncHandler(blockedUsersController.isUserBlocked));

// ── Community user reporting ──────────────────────────────────────────────
const userReportService = require('../../services/userReportService');

// POST /api/webapp/reports — user-facing
app.post('/api/webapp/reports', requireSessionAuth, socialActionLimiter, asyncHandler(async (req, res) => {
  const reporterId = req.session?.user?.id;
  if (!reporterId) return res.status(401).json({ success: false, error: 'Not authenticated' });

  const { reportedUserId, category, description, evidenceType, evidenceId } = req.body || {};
  const result = await userReportService.createReport({
    reporterId,
    reportedUserId,
    category,
    description,
    evidenceType,
    evidenceId,
  });

  if (!result.success) {
    const statusCode = result.code === 'RATE_LIMITED' ? 429
      : result.code === 'TARGET_NOT_FOUND' ? 404
      : result.code === 'DUPLICATE_OPEN' ? 409
      : 400;
    return res.status(statusCode).json(result);
  }
  return res.json({ success: true, report: { id: result.report.id, status: result.report.status } });
}));

// GET /api/webapp/admin/payment-health — operational dashboard data
// Surfaces stuck payments, recent leak alerts, and reconciler activity in one
// endpoint so the operator has a single page to scan instead of manually
// SQLing each table when alerts fire in the notifications group.
app.get('/api/webapp/admin/payment-health', adminGuard, asyncHandler(async (req, res) => {
  const { query: q } = require('../../config/postgres');


  // Meru: orphan paid links (auto-heal alerts the ops group; this surfaces the
  // pile so the operator can confirm at a glance) plus reserved-pending older
  // than 60 min.
  const meruStuck = await q(`
    SELECT code, status, reserved_for_email, reserved_for_user_id,
           created_at,
           EXTRACT(EPOCH FROM (NOW() - created_at))/3600 AS hours_since_create
    FROM meru_payment_links
    WHERE product = 'lifetime100'
      AND status IN ('active', 'reserved')
      AND created_at > NOW() - INTERVAL '90 days'
      AND (status = 'active' OR (reserved_until IS NOT NULL AND reserved_until < NOW()))
    ORDER BY created_at DESC
    LIMIT 50
  `);

  // BTCPay/Dash: stuck pending invoices (reconciler runs every 30 min).
  const dashStuck = await q(`
    SELECT id, user_id, plan_id, btcpay_invoice_id, usd_amount,
           created_at,
           EXTRACT(EPOCH FROM (NOW() - created_at))/60 AS minutes_pending
    FROM dash_subscription_orders
    WHERE status = 'pending'
      AND created_at < NOW() - INTERVAL '15 minutes'
      AND created_at > NOW() - INTERVAL '14 days'
    ORDER BY created_at DESC
    LIMIT 50
  `);

  // Leak detector signals from the last 7 days — group by URL and surface
  // anything where 2+ users hit the same exclusive video (3+ is the alert
  // threshold; 2+ is "watch this" tier).
  const leaks = await q(`
    SELECT vfl.media_url,
           COUNT(DISTINCT vfl.user_id) FILTER (WHERE vfl.user_id IS NOT NULL) AS distinct_users,
           COUNT(DISTINCT vfl.ip_address) FILTER (WHERE vfl.ip_address IS NOT NULL) AS distinct_ips,
           COUNT(*) AS total_fetches,
           MAX(vfl.fetched_at) AS last_fetched
    FROM video_fetch_log vfl
    JOIN social_posts sp ON sp.media_url = vfl.media_url
    WHERE vfl.fetched_at > NOW() - INTERVAL '7 days'
      AND (sp.is_exclusive = true OR COALESCE(sp.content_tier, 'free') = 'prime')
      AND sp.is_deleted = false
    GROUP BY vfl.media_url
    HAVING COUNT(DISTINCT vfl.user_id) FILTER (WHERE vfl.user_id IS NOT NULL) >= 2
        OR COUNT(DISTINCT vfl.ip_address) FILTER (WHERE vfl.ip_address IS NOT NULL) >= 4
    ORDER BY distinct_users DESC, distinct_ips DESC
    LIMIT 25
  `);

  // 7-day activity context — successful settlement counts to spot-check that
  // the reconcilers aren't silently broken.
  const settlements = await q(`
    SELECT
      (SELECT COUNT(*) FROM dash_subscription_orders WHERE status='completed' AND completed_at > NOW() - INTERVAL '7 days') AS dash_completed_7d,
      (SELECT COUNT(*) FROM meru_payment_links WHERE status='used' AND used_at > NOW() - INTERVAL '7 days') AS meru_completed_7d,
      (SELECT COUNT(*) FROM video_fetch_log WHERE fetched_at > NOW() - INTERVAL '7 days') AS video_views_7d,
      (SELECT COUNT(DISTINCT media_url) FROM video_fetch_log WHERE fetched_at > NOW() - INTERVAL '7 days') AS distinct_videos_7d
  `);

  return res.json({
    success: true,
    stuck: {
      meru: { count: meruStuck.rowCount, items: meruStuck.rows },
      dash: { count: dashStuck.rowCount, items: dashStuck.rows },
    },
    leaks: { count: leaks.rowCount, items: leaks.rows },
    activity: settlements.rows[0] || {},
    generated_at: new Date().toISOString(),
  });
}));

// GET /api/webapp/admin/service-status — ops dashboard: pings + platform + payment stats
app.get('/api/webapp/admin/service-status', adminGuard, asyncHandler(async (_req, res) => {
  const { query: q } = require('../../config/postgres');

  async function ping(url, timeoutMs = 4000) {
    const start = Date.now();
    try {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), timeoutMs);
      const r = await fetch(url, { method: 'HEAD', signal: ctrl.signal, redirect: 'follow' });
      clearTimeout(tid);
      return { ok: r.ok || r.status < 500, status: r.status, ms: Date.now() - start };
    } catch {
      return { ok: false, status: 0, ms: Date.now() - start };
    }
  }

  // Public URLs only — never expose internal env-var addresses to the browser
  const PING_URLS = {
    btcpay:      'https://btcpay.pnptv.app',
    restreamer:  'https://live.pnptv.app',
    livekit:     'https://livekit.pnptv.app',
    authentik:   'https://auth.pnptv.app',
    analytics:   'https://analytics.pnptv.app',
    metabase:    'https://metabase.pnptv.app',
    uptime:      'https://status.pnptv.app',
    calcom:      'https://booking.pnptv.app',
    cms:         'https://cms.pnptv.app',
    backend:     'https://pnptv.app/health',
    nowpayments: 'https://api.nowpayments.io/v1/status',
    ampache:     'http://ampache:80',
  };

  const { getRedis } = require('../../config/redis');
  async function pingRedis() {
    const start = Date.now();
    try {
      const client = getRedis();
      await client.ping();
      return { ok: true, status: 200, ms: Date.now() - start };
    } catch {
      return { ok: false, status: 0, ms: Date.now() - start };
    }
  }

  const [pings, platform, payments] = await Promise.all([
    Promise.all([
      ...Object.entries(PING_URLS).map(async ([k, url]) => [k, await ping(url)]),
      pingRedis().then(r => ['redis', r]),
    ]).then(Object.fromEntries),

    q(`
      SELECT
        (SELECT COUNT(*)::int FROM users)                                                AS users_total,
        (SELECT COUNT(*)::int FROM users WHERE created_at > NOW() - INTERVAL '24 hours') AS users_new_24h,
        (SELECT COUNT(*)::int FROM users WHERE created_at > NOW() - INTERVAL '7 days')  AS users_new_7d,
        (SELECT COUNT(DISTINCT user_id)::int FROM user_entitlements
           WHERE add_on_id IN ('prime','pnp-member')
             AND (is_lifetime OR expires_at > NOW())
             AND NOT is_consumed)                                                         AS prime_members,
        0                                                                                AS open_tickets,
        0                                                                                AS new_tickets_24h,
        (SELECT COUNT(*)::int FROM social_posts WHERE is_deleted = false AND created_at > NOW() - INTERVAL '24 hours') AS posts_24h,
        (SELECT COUNT(*)::int FROM hangouts WHERE is_active = true)                      AS active_hangouts,
        (SELECT COUNT(*)::int FROM live_streams WHERE status = 'live')                   AS live_streams_active,
        (SELECT COUNT(*)::int FROM users WHERE creator_status = 'active' AND role IN ('model','creator')) AS active_creators,
        (SELECT COUNT(*)::int FROM model_applications WHERE status = 'pending')           AS creator_apps_pending
    `).then(r => r.rows[0]),

    q(`
      SELECT
        (SELECT COUNT(*)::int FROM dash_subscription_orders WHERE status='completed' AND completed_at > NOW() - INTERVAL '7 days')
          + (SELECT COUNT(*)::int FROM meru_payment_links WHERE status='used' AND used_at > NOW() - INTERVAL '7 days') AS completed_7d,
        (SELECT COALESCE(SUM(usd_amount),0)::numeric FROM dash_subscription_orders WHERE status='completed' AND completed_at > NOW() - INTERVAL '7 days')
          + (SELECT COUNT(*) * 95 FROM meru_payment_links WHERE status='used' AND used_at > NOW() - INTERVAL '7 days') AS revenue_7d,
        (SELECT COUNT(*)::int FROM dash_subscription_orders WHERE status='completed' AND completed_at > NOW() - INTERVAL '24 hours') AS completed_24h,
        (SELECT COUNT(*)::int FROM dash_subscription_orders WHERE status='pending' AND created_at > NOW() - INTERVAL '24 hours') AS pending_24h,
        (SELECT COUNT(*)::int FROM dash_subscription_orders WHERE status='partially_paid') AS partial_all,
        (SELECT COUNT(*)::int FROM dash_subscription_orders WHERE status='pending' AND metadata->>'provider'='nowpayments' AND created_at > NOW() - INTERVAL '24 hours') AS np_pending_24h,
        (SELECT COUNT(*)::int FROM dash_subscription_orders WHERE status='completed' AND metadata->>'provider'='nowpayments' AND completed_at > NOW() - INTERVAL '7 days') AS np_completed_7d,
        (SELECT COUNT(*)::int FROM dash_subscription_orders WHERE status='pending' AND (metadata->>'provider' IS NULL OR metadata->>'provider'='btcpay') AND created_at > NOW() - INTERVAL '24 hours') AS btcpay_pending_24h,
        (SELECT COUNT(*)::int FROM dash_subscription_orders WHERE status='completed' AND (metadata->>'provider' IS NULL OR metadata->>'provider'='btcpay') AND completed_at > NOW() - INTERVAL '7 days') AS btcpay_completed_7d,
        (SELECT COUNT(*)::int FROM meru_payment_links WHERE status='used' AND used_at > NOW() - INTERVAL '7 days') AS meru_completed_7d,
        (SELECT COUNT(*)::int FROM meru_payment_links WHERE status='active' AND reserved_for_user_id IS NULL) AS meru_available
    `).then(r => r.rows[0]),
  ]);

  return res.json({
    success: true,
    pings,
    platform,
    payments,
    generated_at: new Date().toISOString(),
  });
}));

// GET /api/webapp/admin/hangout-telegram-health — verify linked Telegram chats
// still exist and surface stale chat IDs before operators hit posting failures.
app.get('/api/webapp/admin/hangout-telegram-health', adminGuard, asyncHandler(async (_req, res) => {
  const HangoutTelegramHealthService = require('../../services/hangoutTelegramHealthService');
  const snapshot = await HangoutTelegramHealthService.getSnapshot();
  return res.json(snapshot);
}));

// GET /api/webapp/admin/monitoring — service health dashboard
app.get('/api/webapp/admin/monitoring', adminGuard, asyncHandler(async (_req, res) => {
  const http = require('http');
  const { getPool } = require('../../config/postgres');
  const { cache } = require('../../config/redis');

  function httpPing(url, timeoutMs = 5000) {
    return new Promise((resolve) => {
      const start = Date.now();
      const parsed = new URL(url);
      const options = {
        hostname: parsed.hostname,
        port: parsed.port || 80,
        path: parsed.pathname + parsed.search,
        method: 'GET',
        timeout: timeoutMs,
      };
      const req = http.request(options, (r) => {
        r.resume();
        resolve({ ok: r.statusCode < 500, status: r.statusCode, ms: Date.now() - start });
      });
      req.on('timeout', () => { req.destroy(); resolve({ ok: false, status: 0, ms: timeoutMs }); });
      req.on('error', () => resolve({ ok: false, status: 0, ms: Date.now() - start }));
      req.end();
    });
  }

  async function dbPing() {
    const start = Date.now();
    try {
      const client = await getPool().connect();
      await client.query('SELECT 1');
      client.release();
      return { ok: true, ms: Date.now() - start };
    } catch { return { ok: false, ms: Date.now() - start }; }
  }

  async function redisPing() {
    const start = Date.now();
    try {
      await cache.ping();
      return { ok: true, ms: Date.now() - start };
    } catch { return { ok: false, ms: Date.now() - start }; }
  }

  async function healthchecksJobs() {
    const { Pool } = require('pg');
    const hcPool = new Pool({
      host: process.env.POSTGRES_HOST || 'pg-pnptv',
      port: 5432,
      user: process.env.POSTGRES_USER || 'pnptvbot',
      password: process.env.POSTGRES_PASSWORD,
      database: 'healthchecks',
      max: 1,
      connectionTimeoutMillis: 3000,
    });
    try {
      const { rows } = await hcPool.query(
        `SELECT slug, name, timeout, status, last_ping FROM api_check ORDER BY name`,
      );
      return rows;
    } catch { return []; }
    finally { await hcPool.end().catch(() => {}); }
  }

  const [db, redis, botSelf, web, restreamer, btcpay, livekit, cms, kuma, calcom, hcJobs] = await Promise.all([
    dbPing(),
    redisPing(),
    httpPing('http://localhost:3001/health'),
    httpPing('http://pnptv-web:80/'),
    httpPing('http://restreamer:8080/api/v1/ping'),
    httpPing('http://btcpay-server:23000/'),
    httpPing('http://livekit-pnptv:7880/'),
    httpPing('http://directus:8055/server/health'),
    httpPing('http://uptime-kuma:3001/api/entry-page'),
    httpPing('http://calcom:3000/'),
    healthchecksJobs(),
  ]);

  return res.json({
    checkedAt: new Date().toISOString(),
    services: [
      { key: 'db',          label: 'PostgreSQL',   category: 'core',     ...db },
      { key: 'redis',       label: 'Redis',        category: 'core',     ...redis },
      { key: 'bot',         label: 'API / Bot',    category: 'core',     ...botSelf },
      { key: 'web',         label: 'Web Frontend', category: 'core',     ...web },
      { key: 'restreamer',  label: 'Restreamer',   category: 'stream',   ...restreamer },
      { key: 'livekit',     label: 'LiveKit',      category: 'stream',   ...livekit },
      { key: 'btcpay',      label: 'BTCPay',       category: 'payment',  ...btcpay },
      { key: 'cms',         label: 'CMS (Directus)', category: 'infra',  ...cms },
      { key: 'kuma',        label: 'Uptime Kuma',  category: 'infra',    ...kuma },
      { key: 'calcom',      label: 'Cal.com',      category: 'infra',    ...calcom },
    ],
    cronJobs: hcJobs,
  });
}));

// GET /api/webapp/admin/reports — admin list
app.get('/api/webapp/admin/reports', adminGuard, asyncHandler(async (req, res) => {
  const { status, limit, offset } = req.query || {};
  const data = await userReportService.listReports({ status, limit, offset });
  return res.json({ success: true, ...data });
}));

// PATCH /api/webapp/admin/reports/:id — admin review action
app.patch('/api/webapp/admin/reports/:id', adminGuard, asyncHandler(async (req, res) => {
  const reviewerId = req.session?.user?.id;
  const { action, notes } = req.body || {};
  const result = await userReportService.reviewReport({
    reportId: req.params.id,
    reviewerId,
    action,
    notes,
  });
  if (!result.success) {
    const statusCode = result.code === 'NOT_FOUND' ? 404 : 400;
    return res.status(statusCode).json(result);
  }
  return res.json({ success: true, report: result.report });
}));

// ── Public appeal flow for banned / suspended users ───────────────────────
const appealService = require('../../services/appealService');

function getRequestIp(req) {
  const xfwd = (req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim();
  return xfwd || req.ip || req.socket?.remoteAddress || null;
}

// POST /api/webapp/appeal — PUBLIC (no auth); rate-limited per IP in the service
app.post('/api/webapp/appeal', asyncHandler(async (req, res) => {
  const { submittedIdentifier, contactEmail, explanation, honeypot } = req.body || {};
  const result = await appealService.submitAppeal({
    submittedIdentifier,
    contactEmail,
    explanation,
    honeypot,
    ip: getRequestIp(req),
    userAgent: req.headers['user-agent'],
  });
  if (!result.success) {
    const statusCode = result.code && result.code.startsWith('RATE_LIMITED') ? 429
      : result.code === 'DUPLICATE_PENDING' ? 409
      : 400;
    return res.status(statusCode).json(result);
  }
  return res.json({ success: true, appeal: { id: result.appeal.id, status: result.appeal.status } });
}));

// GET /api/webapp/admin/appeals — admin list
app.get('/api/webapp/admin/appeals', adminGuard, asyncHandler(async (req, res) => {
  const { status, limit, offset } = req.query || {};
  const data = await appealService.listAppeals({ status, limit, offset });
  return res.json({ success: true, ...data });
}));

// PATCH /api/webapp/admin/appeals/:id — admin review action
app.patch('/api/webapp/admin/appeals/:id', adminGuard, asyncHandler(async (req, res) => {
  const reviewerId = req.session?.user?.id;
  const { action, notes } = req.body || {};
  const result = await appealService.reviewAppeal({
    appealId: req.params.id,
    reviewerId,
    action,
    notes,
  });
  if (!result.success) {
    const statusCode = result.code === 'NOT_FOUND' ? 404 : 400;
    return res.status(statusCode).json(result);
  }
  return res.json({ success: true, appeal: result.appeal });
}));

// ── Token wallet (pay-per-use balance for stream heartbeats, tips, etc.) ───
const tokenService = require('../../services/tokenService');
app.get('/api/webapp/users/me/tokens', requireSessionAuth, asyncHandler(async (req, res) => {
  const userId = req.session?.user?.id;
  if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });
  const { rows } = await getPool().query(
    'SELECT balance_tokens, gifted_balance FROM user_token_wallets WHERE user_id = $1',
    [String(userId)]
  );
  const regular = rows.length ? (Number(rows[0].balance_tokens) || 0) : 0;
  const gifted  = rows.length ? (Number(rows[0].gifted_balance)  || 0) : 0;
  return res.json({ success: true, balance: regular + gifted, regularBalance: regular, giftedBalance: gifted });
}));

// ── My active scoped subscriptions (paid channel/hangout 30-day passes) ────
// Lists active channel-access and hangout-access entitlements with the
// resource name, expiry, and renewal status so users can see/manage them.
app.get('/api/webapp/subscriptions', requireSessionAuth, asyncHandler(async (req, res) => {
  const userId = req.session?.user?.id;
  // Include both lifetime and time-limited active grants. The previous
  // `is_lifetime = false` filter silently hid lifetime channel/hangout
  // grants from the user's "My Access" page even though their access
  // was working — surfaced by the 2026-04-28 lifetime audit.
  const { rows } = await getPool().query(`
    SELECT ue.id, ue.add_on_id, ue.creator_id AS scope_id, ue.expires_at,
           ue.auto_renew, ue.is_lifetime,
           CASE
             WHEN ue.add_on_id = 'channel-access' THEN cc.name
             WHEN ue.add_on_id = 'hangout-access' THEN hg.name
             ELSE NULL
           END AS resource_name,
           CASE
             WHEN ue.add_on_id = 'channel-access' THEN cc.price_usd
             WHEN ue.add_on_id = 'hangout-access' THEN hg.price_usd
             ELSE NULL
           END AS price_usd
      FROM user_entitlements ue
      LEFT JOIN creator_channels cc ON ue.add_on_id = 'channel-access' AND cc.id::text = ue.creator_id
      LEFT JOIN hangout_groups hg   ON ue.add_on_id = 'hangout-access' AND hg.id::text = ue.creator_id
     WHERE ue.user_id = $1
       AND ue.add_on_id IN ('channel-access', 'hangout-access')
       AND ue.is_consumed = false
       AND (ue.is_lifetime = true OR (ue.expires_at IS NOT NULL AND ue.expires_at > NOW()))
     ORDER BY ue.is_lifetime DESC, ue.expires_at ASC NULLS LAST
  `, [String(userId)]);
  return res.json({
    success: true,
    subscriptions: rows.map(r => ({
      id: r.id,
      kind: r.add_on_id === 'channel-access' ? 'channel' : 'hangout',
      scopeId: r.scope_id,
      name: r.resource_name,
      priceUsd: r.price_usd ? Number(r.price_usd) : null,
      // Frontends should display 'Lifetime' when isLifetime is true;
      // expiresAt will be null in that case.
      expiresAt: r.is_lifetime ? null : r.expires_at,
      isLifetime: r.is_lifetime,
      autoRenew: r.auto_renew,
    })),
  });
}));

// Cancel auto-renewal for a scoped subscription. The current period stays
// active until expires_at — cancellation only stops future renewal reminders.
app.post('/api/webapp/subscriptions/:entitlementId/cancel', requireSessionAuth, asyncHandler(async (req, res) => {
  const userId = req.session?.user?.id;
  const entitlementId = parseInt(req.params.entitlementId, 10);
  if (!Number.isFinite(entitlementId)) return res.status(400).json({ success: false, error: 'Invalid id' });
  const { rows } = await getPool().query(
    `UPDATE user_entitlements
        SET auto_renew = false, updated_at = NOW()
      WHERE id = $1
        AND user_id = $2
        AND add_on_id IN ('channel-access', 'hangout-access')
        AND is_consumed = false
      RETURNING id, expires_at`,
    [entitlementId, String(userId)]
  );
  if (rows.length === 0) return res.status(404).json({ success: false, error: 'Subscription not found' });
  return res.json({ success: true, expiresAt: rows[0].expires_at, autoRenew: false });
}));

// Re-enable auto-renewal (user can change their mind before expiry).
app.post('/api/webapp/subscriptions/:entitlementId/resume', requireSessionAuth, asyncHandler(async (req, res) => {
  const userId = req.session?.user?.id;
  const entitlementId = parseInt(req.params.entitlementId, 10);
  if (!Number.isFinite(entitlementId)) return res.status(400).json({ success: false, error: 'Invalid id' });
  const { rows } = await getPool().query(
    `UPDATE user_entitlements
        SET auto_renew = true, updated_at = NOW()
      WHERE id = $1
        AND user_id = $2
        AND add_on_id IN ('channel-access', 'hangout-access')
        AND is_consumed = false
      RETURNING id, expires_at`,
    [entitlementId, String(userId)]
  );
  if (rows.length === 0) return res.status(404).json({ success: false, error: 'Subscription not found' });
  return res.json({ success: true, expiresAt: rows[0].expires_at, autoRenew: true });
}));

// ── Admin revenue report (date range + grouping) ──────────────────────────
const RevenueReportService = require('../../services/revenueReportService');
app.get('/api/webapp/admin/revenue-report', adminGuard, asyncHandler(async (req, res) => {
  const { startDate, endDate, groupBy } = req.query || {};
  // Default to last 30 days when caller doesn't provide a range
  const end = endDate ? new Date(endDate) : new Date();
  const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return res.status(400).json({ success: false, error: 'Invalid startDate or endDate' });
  }
  try {
    const report = await RevenueReportService.getRevenueReport(start, end, groupBy || 'day');
    return res.json({ success: true, report });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
}));

// Web App Follow System
const followController = require('./controllers/followController');
app.post('/api/webapp/users/follow',                   requireSessionAuth, socialActionLimiter, asyncHandler(followController.followUser));
app.post('/api/webapp/users/unfollow',                 requireSessionAuth, socialActionLimiter, asyncHandler(followController.unfollowUser));
app.get('/api/webapp/users/follow-status/:userId',     asyncHandler(followController.getFollowStatus));
app.get('/api/webapp/users/:userId/followers',         asyncHandler(followController.getFollowers));
app.get('/api/webapp/users/:userId/following',         asyncHandler(followController.getFollowing));
app.get('/api/webapp/social/feed/following',           requireSessionAuth, asyncHandler(followController.getFollowingFeed));

// Web App Direct Messages
app.get('/api/webapp/messages/threads', requireSessionAuth, asyncHandler(directMessagesController.getThreads));
app.get('/api/webapp/messages/thread/:otherUserId', requireSessionAuth, asyncHandler(directMessagesController.getMessages));
app.post('/api/webapp/messages/send', requireSessionAuth, asyncHandler(directMessagesController.sendMessage));
app.delete('/api/webapp/messages/:messageId', requireSessionAuth, asyncHandler(directMessagesController.deleteMessage));
app.put('/api/webapp/messages/thread/:otherUserId/read', requireSessionAuth, asyncHandler(directMessagesController.markThreadAsRead));

// Rate limiter for notification read endpoints (60 req/min per authenticated user)
const notificationLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  keyGenerator: (req) => req.session?.user?.id || req.ip,
  handler: (req, res) => res.status(429).json({ error: 'Too many notification requests. Slow down.' }),
  standardHeaders: true,
  legacyHeaders: false,
});

// Web App Notifications
app.get('/api/webapp/notifications', requireSessionAuth, notificationLimiter, asyncHandler(notificationsController.getNotifications));
app.get('/api/webapp/notifications/counts', requireSessionAuth, notificationLimiter, asyncHandler(notificationsController.getNotificationCounts));
app.put('/api/webapp/notifications/mark-read', requireSessionAuth, notificationLimiter, asyncHandler(notificationsController.markAsRead));
app.get('/api/webapp/notifications/preferences', requireSessionAuth, notificationLimiter, asyncHandler(notificationsController.getPreferences));
app.put('/api/webapp/notifications/preferences', requireSessionAuth, notificationLimiter, asyncHandler(notificationsController.updatePreferences));

// Web App Mastodon Feed
app.get('/api/webapp/mastodon/feed', requireSessionAuth, asyncHandler(webAppController.getMastodonFeed));

// Web App Hangouts — video calls use Telegram native

// Live Rules Acknowledgment Gate
const liveRulesController = require('./controllers/liveRulesController');
app.get('/api/webapp/live/rules-status', requireSessionAuth, asyncHandler(liveRulesController.getRulesStatus));
app.post('/api/webapp/live/acknowledge-rules', requireSessionAuth, asyncHandler(liveRulesController.acknowledgeRules));
app.post('/api/webapp/live/stream-rules', requireSessionAuth, creatorGuardForOAuth, asyncHandler(liveRulesController.saveStreamRules));

// STUDIO-H-03: BRB emits Socket.IO events to all viewers — cap at 3 toggles per 5 s
const brbLimiter = rateLimit({ windowMs: 5 * 1000, max: 3, keyGenerator: (req) => String(req.session?.user?.id || req.ip), standardHeaders: true, legacyHeaders: false });
// STUDIO-H-03: stream-meta writes Redis key read by all viewers — cap at 5 per 10 s
const streamMetaLimiter = rateLimit({ windowMs: 10 * 1000, max: 5, keyGenerator: (req) => String(req.session?.user?.id || req.ip), standardHeaders: true, legacyHeaders: false });
// STUDIO-SEC: credential endpoints (rtmp-key, provision-channel) — 10 per minute
const credentialLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, keyGenerator: (req) => String(req.session?.user?.id || req.ip), standardHeaders: true, legacyHeaders: false });
// STUDIO-SEC: tip-menu write and goal delete — 5 per 10 s
const tipMenuLimiter = rateLimit({ windowMs: 10 * 1000, max: 5, keyGenerator: (req) => String(req.session?.user?.id || req.ip), standardHeaders: true, legacyHeaders: false });

// Web App Live Streaming Routes
const webappLiveController = require('./controllers/webappLiveController');
app.get('/api/webapp/live/streams', requireSessionAuth, asyncHandler(webappLiveController.listStreams));
app.get('/api/webapp/live/rtmp-key', requireSessionAuth, credentialLimiter, asyncHandler(webappLiveController.getRtmpKey));
app.get('/api/webapp/me/creator-eligibility', requireSessionAuth, asyncHandler(webappLiveController.getCreatorEligibility));
// Self-serve channel provisioning: creator gets a Restreamer channel on first "Go Live"
app.post('/api/webapp/live/provision-channel', requireSessionAuth, credentialLimiter, asyncHandler(webappLiveController.provisionChannel));

// ── Cal.com: creator availability slots ──
const calcomSlotsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: (req) => req.session?.user?.id ? String(req.session.user.id) : req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many slot requests — try again shortly' },
});
app.get('/api/webapp/creator/:creatorId/calcom-slots', softAuth, calcomSlotsLimiter, asyncHandler(async (req, res) => {
  try {
    const calcomService = require('../../services/calcomService');
    const { creatorId } = req.params;
    const { dateFrom, dateTo, duration } = req.query;
    if (!dateFrom || !dateTo) return res.json({ slots: [] });
    const durationMin = Number(duration) === 60 ? 60 : 30;
    const slots = await calcomService.getCreatorAvailability(creatorId, dateFrom, dateTo, durationMin);
    return res.json({ slots: slots || [] });
  } catch (err) {
    logger.error('[calcom-slots] error', { error: err.message });
    return res.json({ slots: [] });
  }
}));

// ── Cal.com: admin provisioning ──
app.post('/api/admin/calcom/provision-all', adminGuard, asyncHandler(async (req, res) => {
  try {
    const calcomService = require('../../services/calcomService');
    const result = await calcomService.provisionAllCreators();
    return res.json({ success: true, provisioned: result?.provisioned ?? 0 });
  } catch (err) {
    logger.error('[calcom] provision-all error', { error: err.message });
    return res.status(500).json({ success: false, error: err.message });
  }
}));

app.post('/api/admin/calcom/provision/:userId', adminGuard, asyncHandler(async (req, res) => {
  try {
    const calcomService = require('../../services/calcomService');
    const { userId } = req.params;
    const { username, email } = req.body;
    if (!username || !email) return res.status(400).json({ success: false, error: 'username and email required' });
    await calcomService.provisionCreator(userId, username, email);
    return res.json({ success: true });
  } catch (err) {
    logger.error('[calcom] provision-user error', { error: err.message });
    return res.status(500).json({ success: false, error: err.message });
  }
}));
// Raid: creator sends all viewers to another live stream
app.post('/api/webapp/live/raid', requireSessionAuth, asyncHandler(webappLiveController.initiateRaid));
// Host mode: embed another channel's stream when offline
app.get('/api/webapp/live/host', requireSessionAuth, asyncHandler(webappLiveController.getHostedChannel));
app.post('/api/webapp/live/host', requireSessionAuth, asyncHandler(webappLiveController.setHostedChannel));
// Stream schedule: upcoming broadcasts for the next 7 days (Redis-cached 5 min)
app.get('/api/webapp/live/schedule',    requireSessionAuth, asyncHandler(webappLiveController.getSchedule));
app.get('/api/webapp/live/time-slots',  requireSessionAuth, asyncHandler(webappLiveController.getSchedule));
// Stream schedule notifications: subscribe/unsubscribe/check for a slot
app.post('/api/webapp/live/schedule/notify', requireSessionAuth, asyncHandler(webappLiveController.subscribeScheduleNotify));
app.delete('/api/webapp/live/schedule/notify', requireSessionAuth, asyncHandler(webappLiveController.unsubscribeScheduleNotify));
app.get('/api/webapp/live/schedule/notify/:slotId', requireSessionAuth, asyncHandler(webappLiveController.checkScheduleNotify));
// Admin: manage Restreamer channel assignments
app.get('/api/webapp/admin/live/channels', adminGuard, asyncHandler(webappLiveController.listChannels));
app.post('/api/webapp/admin/live/assign-channel', adminGuard, asyncHandler(webappLiveController.assignChannel));

// ── Admin: 2257 ID document download — protected, admin-only ─────────────────
// Serves ID documents from creator-2257 and creator-enrollments upload dirs.
// This route MUST be admin-guarded; PROTECTED_PATHS blocks direct /uploads access.
app.get('/api/admin/creator-2257/doc/:filename', adminGuard, (req, res) => {
  const filename = path.basename(req.params.filename);
  if (!filename || filename.includes('..') || filename === '') {
    return res.status(400).json({ error: 'Invalid filename' });
  }
  const filePath = path.join(__dirname, '../../../../public/uploads/creator-2257', filename);
  res.sendFile(filePath, { root: '/' }, (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: 'File not found' });
  });
});

app.get('/api/admin/creator-enrollment/doc/:filename', adminGuard, (req, res) => {
  const filename = path.basename(req.params.filename);
  if (!filename || filename.includes('..') || filename === '') {
    return res.status(400).json({ error: 'Invalid filename' });
  }
  const filePath = path.join(__dirname, '../../../../public/uploads/creator-enrollments', filename);
  res.sendFile(filePath, { root: '/' }, (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: 'File not found' });
  });
});

// Admin: model-application ID document download (profile photo / ID front / ID back)
// :userId is a string (telegram numeric or UUID). The on-disk layout is
// public/uploads/model-applications/<userId>/<kind>/<filename> where <kind> is
// 'profile' or 'id'. We restrict <kind> to that allowlist and apply
// path.basename to filename to block traversal.
app.get('/api/admin/model-application/doc/:userId/:kind/:filename', adminGuard, (req, res) => {
  const userId = String(req.params.userId || '');
  const kind = String(req.params.kind || '');
  const filename = path.basename(req.params.filename || '');
  if (!userId || /[^a-zA-Z0-9_-]/.test(userId)) {
    return res.status(400).json({ error: 'Invalid userId' });
  }
  if (kind !== 'profile' && kind !== 'id') {
    return res.status(400).json({ error: 'Invalid document kind' });
  }
  if (!filename || filename.includes('..') || filename === '') {
    return res.status(400).json({ error: 'Invalid filename' });
  }
  const filePath = path.join(__dirname, '../../../../public/uploads/model-applications', userId, kind, filename);
  res.sendFile(filePath, { root: '/' }, (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: 'File not found' });
  });
});

// Rate limiter for stream health polling — 30 req/min per user (5s poll × 30 = 2.5 min headroom)
// Declared inline here (not in the rate-limiter block below) so it exists before the route registration.
const streamHealthLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: (req) => `user:${req.session?.user?.id || req.ip}`,
  message: { success: false, error: 'Too many stream health requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Stream health — owner-only, polls Restreamer process state + Redis viewer count
app.get('/api/webapp/streams/:streamId/health', requireSessionAuth, streamHealthLimiter, asyncHandler(webappLiveController.getStreamHealth));

// ────────────────────────────────────────────────────────────────────────
// Admin: payment operations (replaces SSH-only backfill scripts)
// ────────────────────────────────────────────────────────────────────────

// GET /api/webapp/admin/payments/stuck-dash — list pending Dash orders >10min
app.get('/api/webapp/admin/payments/stuck-dash', adminGuard, asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT id, user_id, plan_id, btcpay_invoice_id, usd_amount, status, created_at, completed_at, notes,
            EXTRACT(EPOCH FROM (NOW() - created_at)) / 60 AS age_minutes
     FROM dash_subscription_orders
     WHERE status = 'pending'
       AND btcpay_invoice_id IS NOT NULL
       AND created_at < NOW() - INTERVAL '10 minutes'
       AND created_at > NOW() - INTERVAL '30 days'
     ORDER BY created_at DESC
     LIMIT 200`
  );
  res.json({ success: true, count: rows.length, orders: rows });
}));

// POST /api/webapp/admin/payments/dash/:invoiceId/settle — manually settle an invoice
// Calls the same code path the reconciler uses (settleStuckDashInvoice).
// Verifies BTCPay status first to avoid granting on unpaid invoices.
app.post('/api/webapp/admin/payments/dash/:invoiceId/settle', adminGuard, asyncHandler(async (req, res) => {
  const { invoiceId } = req.params;
  if (!invoiceId || !/^[A-Za-z0-9_-]{6,128}$/.test(invoiceId)) {
    return res.status(400).json({ success: false, error: 'Invalid invoice id' });
  }

  const { getInvoice } = require('../../config/btcpay');
  let inv;
  try {
    inv = await getInvoice(invoiceId);
  } catch (err) {
    return res.status(502).json({ success: false, error: 'btcpay_unreachable', detail: err.message });
  }

  // Accept Settled normally, OR Expired+PaidLate where BTCPay confirmed funds received
  // after the 15-minute invoice window. Verify paidAmount >= amount before granting.
  const isPaidLate = inv?.status === 'Expired'
    && inv?.additionalStatus === 'PaidLate'
    && parseFloat(inv?.paidAmount || '0') >= parseFloat(inv?.amount || '0') - 0.01;

  if (inv?.status !== 'Settled' && !isPaidLate) {
    return res.status(409).json({
      success: false,
      error: 'invoice_not_settled',
      btcpayStatus: inv?.status || 'unknown',
      additionalStatus: inv?.additionalStatus || 'None',
    });
  }

  const PaymentRecoveryService = require('../../services/paymentRecoveryService');
  const settleOpts = isPaidLate ? { allowExpired: true } : {};
  // Try subscription order first, fall back to token purchase.
  let result = await PaymentRecoveryService.settleStuckDashInvoice(invoiceId, 'dash_subscription_orders', settleOpts);
  if (result.skipped && result.reason === 'no_order_row') {
    result = await PaymentRecoveryService.settleStuckDashInvoice(invoiceId, 'token_purchases', settleOpts);
  }

  logger.info('Admin manually settled Dash invoice', {
    actorId: req.session?.user?.id, invoiceId, result,
  });
  res.json({ success: true, invoiceId, btcpayStatus: inv.status, result });
}));

// POST /api/webapp/admin/payments/dash/:invoiceId/expire — mark a stuck invoice expired
app.post('/api/webapp/admin/payments/dash/:invoiceId/expire', adminGuard, asyncHandler(async (req, res) => {
  const { invoiceId } = req.params;
  if (!invoiceId || !/^[A-Za-z0-9_-]{6,128}$/.test(invoiceId)) {
    return res.status(400).json({ success: false, error: 'Invalid invoice id' });
  }
  const sub = await query(
    `UPDATE dash_subscription_orders SET status = 'expired',
       notes = COALESCE(notes,'') || ' admin_expired'
     WHERE btcpay_invoice_id = $1 AND status = 'pending' RETURNING id`,
    [invoiceId]
  );
  const tok = await query(
    `UPDATE token_purchases SET status = 'expired'
     WHERE btcpay_invoice_id = $1 AND status = 'pending' RETURNING id`,
    [invoiceId]
  );
  logger.info('Admin manually expired Dash invoice', {
    actorId: req.session?.user?.id, invoiceId,
    subRows: sub.rowCount, tokRows: tok.rowCount,
  });
  res.json({ success: true, invoiceId, subscriptionRowsExpired: sub.rowCount, tokenRowsExpired: tok.rowCount });
}));

// POST /api/webapp/admin/payments/dash/:invoiceId/redeliver — ask BTCPay to resend
// the most recent webhook delivery for this invoice. Useful when reconciler is
// unavailable or to test webhook handler changes.
app.post('/api/webapp/admin/payments/dash/:invoiceId/redeliver', adminGuard, asyncHandler(async (req, res) => {
  const { invoiceId } = req.params;
  if (!invoiceId || !/^[A-Za-z0-9_-]{6,128}$/.test(invoiceId)) {
    return res.status(400).json({ success: false, error: 'Invalid invoice id' });
  }
  const axios = require('axios');
  const { BTCPAY_URL = process.env.BTCPAY_URL, BTCPAY_API_KEY = process.env.BTCPAY_API_KEY, BTCPAY_STORE_ID = process.env.BTCPAY_STORE_ID } = process.env;
  try {
    const whRes = await axios.get(`${BTCPAY_URL}/api/v1/stores/${BTCPAY_STORE_ID}/webhooks`, {
      headers: { Authorization: `token ${BTCPAY_API_KEY}` }, timeout: 8000,
    });
    const wh = (whRes.data || []).find(w => w.enabled);
    if (!wh) return res.status(503).json({ success: false, error: 'no_enabled_webhook' });

    const delivRes = await axios.get(
      `${BTCPAY_URL}/api/v1/stores/${BTCPAY_STORE_ID}/webhooks/${wh.id}/deliveries?count=50`,
      { headers: { Authorization: `token ${BTCPAY_API_KEY}` }, timeout: 8000 }
    );
    // BTCPay delivery list does not include invoiceId per record — we have to
    // fetch each individually to find one matching this invoice. Take the
    // most recent for safety.
    let target = null;
    for (const d of delivRes.data || []) {
      try {
        const detail = await axios.get(
          `${BTCPAY_URL}/api/v1/stores/${BTCPAY_STORE_ID}/webhooks/${wh.id}/deliveries/${d.id}/request`,
          { headers: { Authorization: `token ${BTCPAY_API_KEY}` }, timeout: 4000 }
        );
        if (detail.data?.invoiceId === invoiceId) { target = d; break; }
      } catch { /* try next */ }
    }
    if (!target) return res.status(404).json({ success: false, error: 'no_delivery_found_for_invoice' });

    const redel = await axios.post(
      `${BTCPAY_URL}/api/v1/stores/${BTCPAY_STORE_ID}/webhooks/${wh.id}/deliveries/${target.id}/redeliver`,
      {}, { headers: { Authorization: `token ${BTCPAY_API_KEY}` }, timeout: 8000 }
    );
    logger.info('Admin triggered BTCPay redeliver', {
      actorId: req.session?.user?.id, invoiceId, originalDeliveryId: target.id, newDeliveryId: redel.data,
    });
    res.json({ success: true, invoiceId, newDeliveryId: redel.data });
  } catch (err) {
    res.status(502).json({ success: false, error: 'btcpay_api_error', detail: err.message });
  }
}));

// GET /api/webapp/admin/payments/webhook-events — recent webhook events
app.get('/api/webapp/admin/payments/webhook-events', adminGuard, asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const PaymentWebhookEventModel = require('../../models/paymentWebhookEventModel');
  const [recent, summary] = await Promise.all([
    PaymentWebhookEventModel.getRecent(limit),
    PaymentWebhookEventModel.getSummary({ sinceHours: 24 }),
  ]);
  res.json({ success: true, recent, summary });
}));

// POST /api/admin/alert — send a structured alert to the operator Telegram
// channel. Used by remote audit routines to escalate P0/P1 findings in
// near-real-time (Notion comments are the audit trail; this is the page).
//
// Auth: Bearer token via ADMIN_ALERT_BEARER env var. Same shape as the
// /metrics bearer pattern; should be a long random hex.
//
// Body shape:
//   { severity: 'P0'|'P1'|'P2', source: string, title: string, body?: string, url?: string }
app.post('/api/admin/alert', healthLimiter, asyncHandler(async (req, res) => {
  const bearer = req.headers.authorization?.replace(/^Bearer\s+/, '');
  const expected = process.env.ADMIN_ALERT_BEARER;
  if (!expected || bearer !== expected) {
    return res.status(401).json({ success: false, error: 'unauthorized' });
  }
  const { severity = 'P2', source = 'unknown', title = '(no title)', body = '', url = '' } = req.body || {};
  if (typeof title !== 'string' || title.length === 0 || title.length > 200) {
    return res.status(400).json({ success: false, error: 'title required (1-200 chars)' });
  }

  const sevEmoji = severity === 'P0' ? '🔴' : severity === 'P1' ? '🟠' : '🟡';
  const safeTitle = String(title).slice(0, 200).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
  const safeBody = String(body || '').slice(0, 1500).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
  const safeSource = String(source).slice(0, 80).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
  const safeUrl = url && /^https?:\/\//.test(url) ? String(url).slice(0, 500) : null;

  const message = [
    `${sevEmoji} <b>${severity} ALERT — ${safeSource}</b>`,
    '',
    safeTitle,
    safeBody ? '' : null,
    safeBody || null,
    safeUrl ? `\n🔗 ${safeUrl}` : null,
  ].filter(line => line !== null).join('\n');

  try {
    const BusinessNotificationService = require('../../services/businessNotificationService');
    await BusinessNotificationService.send(message);
    logger.info('Admin alert dispatched', { severity, source, title: safeTitle });
    res.json({ success: true });
  } catch (err) {
    logger.error(`Admin alert dispatch failed: ${err.message}`);
    res.status(500).json({ success: false, error: 'dispatch_failed' });
  }
}));

// POST /api/internal/broadcast/lifetime80 — trigger the lifetime80 promo broadcast.
// Skips users already notified (entity_id dedup). Skips email (Resend domain unverified).
// Auth: Bearer token via BROADCAST_SECRET env var.
app.post('/api/internal/broadcast/lifetime80', healthLimiter, asyncHandler(async (req, res) => {
  const bearer = req.headers.authorization?.replace(/^Bearer\s+/, '');
  const expected = process.env.BROADCAST_SECRET;
  if (!expected || bearer !== expected) {
    return res.status(401).json({ success: false, error: 'unauthorized' });
  }
  const { execFile } = require('child_process');
  const scriptPath = require('path').resolve(__dirname, '../../scripts/broadcast-lifetime80.js');
  execFile(process.execPath, [scriptPath, '--skip-email'], { timeout: 5 * 60 * 1000 }, (err, stdout, stderr) => {
    if (err) {
      logger.error('lifetime80 broadcast failed', { error: err.message, stderr });
      return res.status(500).json({ success: false, error: 'Broadcast script failed. Check server logs.' });
    }
    const summary = stdout.split('\n').slice(-10).join('\n');
    logger.info('lifetime80 broadcast complete', { summary });
    res.json({ success: true, summary });
  });
}));

// GET /api/health/webhooks — public ePayco webhook delivery health (7d window).
// Reports invalid-signature rate (security) + state-code distribution.
app.get('/api/health/webhooks', healthLimiter, asyncHandler(async (req, res) => {
  const WebhookHealthService = require('../../services/webhookHealthService');
  const snapshot = await WebhookHealthService.getSnapshot();
  res.status(snapshot.ok ? 200 : 503).json(snapshot);
}));

// GET /api/health/admins — public dormant-admin audit. Surfaces admin /
// superadmin accounts that haven't logged in for 30+/90+ days. Counts only.
app.get('/api/health/admins', healthLimiter, asyncHandler(async (req, res) => {
  const AdminHealthService = require('../../services/adminHealthService');
  const snapshot = await AdminHealthService.getSnapshot();
  res.status(snapshot.ok ? 200 : 503).json(snapshot);
}));

// GET /api/health/schema — verifies critical schema invariants are intact.
// Catches dropped indexes, rolled-back migrations, drifted constraints.
app.get('/api/health/schema', healthLimiter, asyncHandler(async (req, res) => {
  const SchemaHealthService = require('../../services/schemaHealthService');
  const snapshot = await SchemaHealthService.getSnapshot();
  res.status(snapshot.ok ? 200 : 503).json(snapshot);
}));

// GET /api/health/entitlements — public read-only entitlement-system audit.
// Verifies MembershipCleanupService is actually working and no users are
// stuck in inconsistent state (PRIME tier without entitlement, expired-but-
// not-consumed rows, etc.). Same architecture as /api/health/payments.
app.get('/api/health/entitlements', healthLimiter, asyncHandler(async (req, res) => {
  const EntitlementHealthService = require('../../services/entitlementHealthService');
  const snapshot = await EntitlementHealthService.getSnapshot();
  res.status(snapshot.ok ? 200 : 503).json(snapshot);
}));

// GET /api/health/moderation — public read-only moderation queue triage.
// Surfaces stuck reports/appeals/applications so the support team can clear
// them. Counts only — no PII (no reporter/reported identifiers).
app.get('/api/health/moderation', healthLimiter, asyncHandler(async (req, res) => {
  const ModerationHealthService = require('../../services/moderationHealthService');
  const snapshot = await ModerationHealthService.getSnapshot();
  res.status(snapshot.ok ? 200 : 503).json(snapshot);
}));

// GET /api/health/payments — public read-only payment-pipeline health snapshot.
// Zero PII surfaces. Returns booleans, counts, ISO timestamps. Used by external
// auditors (the scheduled remote regression agent) to verify production state
// without VPS or DB credentials.
//
// Why public: this endpoint intentionally has no auth so a third-party
// auditing agent can hit it directly. Defense-in-depth comes from rate
// limiting and from the strict no-PII output guarantee in
// PaymentHealthService.getSnapshot.
app.get('/api/health/payments', healthLimiter, asyncHandler(async (req, res) => {
  const PaymentHealthService = require('../../services/paymentHealthService');
  const snapshot = await PaymentHealthService.getSnapshot();
  res.status(snapshot.ok ? 200 : 503).json(snapshot);
}));

// GET /metrics — Prometheus-format metrics endpoint.
// Authentication: bearer token via METRICS_BEARER env var, OR admin session.
// Designed for Grafana Cloud remote_write (single-tenant agent) to scrape
// internally. Do NOT expose this through the public proxy without auth —
// the Node.js default metrics include heap/GC info attackers can leverage.
app.get('/metrics', asyncHandler(async (req, res) => {
  const bearer = req.headers.authorization?.replace(/^Bearer\s+/, '');
  const expected = process.env.METRICS_BEARER;
  const isAdmin = req.session?.user?.role === 'admin' || req.session?.user?.role === 'superadmin';
  if (!isAdmin && (!expected || bearer !== expected)) {
    return res.status(401).json({ success: false, error: 'unauthorized' });
  }
  const MetricsService = require('../../services/metricsService');
  res.setHeader('Content-Type', MetricsService.contentType());
  res.send(await MetricsService.render());
}));

// Ticketed live shows — ticket status + purchase
app.get('/api/webapp/live/slot/:id/ticket-status', requireSessionAuth, asyncHandler(webappLiveController.getSlotTicketStatus));
app.post('/api/webapp/live/slot/:id/buy-ticket', requireSessionAuth, asyncHandler(webappLiveController.buySlotTicket));

// AN-01: analytics reads — 30/min per user. Prevents scraping creator session
// data via rapid polling; tight enough to stop abuse while allowing normal
// dashboard refresh cycles.
const analyticsLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  keyGenerator: (req) => String(req.session?.user?.id || req.ip),
  message: { error: 'Too many analytics requests.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Stream analytics — creator only
const creatorGuard = require('./middleware/creatorGuard');
app.get('/api/webapp/live/analytics/sessions', requireSessionAuth, creatorGuard, analyticsLimiter, asyncHandler(webappLiveController.getAnalyticsSessions));
app.get('/api/webapp/live/analytics/summary', requireSessionAuth, creatorGuard, analyticsLimiter, asyncHandler(webappLiveController.getAnalyticsSummary));

// Creator revenue aggregation (tips + tickets + subs + calls)
app.get('/api/webapp/creator/revenue', requireSessionAuth, roleGuard('model', 'creator', 'admin', 'superadmin'), analyticsLimiter, asyncHandler(webappLiveController.getCreatorRevenue));

// CR-SQ-01: 3 broadcasts per hour per user — prevents follower notification spam
const broadcastLiveLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  keyGenerator: (req) => String(req.session?.user?.id || req.ip),
  handler: (req, res) => res.status(429).json({ success: false, error: 'You can only broadcast going-live 3 times per hour. Try again later.' }),
  standardHeaders: true,
  legacyHeaders: false,
});

// Manual going-live broadcast to followers
app.post('/api/webapp/live/broadcast-live-now', requireSessionAuth, roleGuard('model', 'creator', 'admin', 'superadmin'), broadcastLiveLimiter, asyncHandler(webappLiveController.broadcastLiveNow));

// VOD replay recordings
app.get('/api/webapp/creators/:creatorId/recordings', softAuth, asyncHandler(webappLiveController.listCreatorRecordings));
app.delete('/api/webapp/recordings/:id', requireSessionAuth, roleGuard('model', 'creator', 'admin', 'superadmin'), asyncHandler(webappLiveController.deleteRecordingEndpoint));
app.patch('/api/webapp/recordings/:id', requireSessionAuth, roleGuard('model', 'creator', 'admin', 'superadmin'), asyncHandler(webappLiveController.updateRecordingEndpoint));

// GET /api/webapp/live/replay/:channelRef — latest completed recording for a channel (member+ required)
app.get('/api/webapp/live/replay/:channelRef', requireSessionAuth, asyncHandler(async (req, res) => {
  const channelRef = req.params.channelRef;
  if (!channelRef || !/^[a-zA-Z0-9_-]+$/.test(channelRef)) return res.status(400).json({ error: 'invalid_channel_ref' });
  const userRes = await getPool().query('SELECT id FROM users WHERE live_channel = $1 AND is_deleted = FALSE LIMIT 1', [channelRef]);
  if (!userRes.rows[0]) return res.json({ success: true, recording: null });
  const recRes = await getPool().query(
    `SELECT manifest_url AS "manifestUrl", started_at AS "startedAt", ended_at AS "endedAt",
            duration_seconds AS "durationSeconds", thumb_path AS "thumbUrl"
     FROM stream_recordings
     WHERE creator_id = $1 AND status = 'completed' AND is_deleted = false
     ORDER BY started_at DESC LIMIT 1`,
    [String(userRes.rows[0].id)]
  );
  return res.json({ success: true, recording: recRes.rows[0] || null });
}));

// Streamer Settings: persistent encoder + filter preferences
const streamerSettingsController = require('./controllers/streamerSettingsController');
app.get('/api/webapp/live/settings', requireSessionAuth, asyncHandler(streamerSettingsController.getSettings));
app.put('/api/webapp/live/settings', requireSessionAuth, asyncHandler(streamerSettingsController.updateSettings));
// Gap 2: Persistent thumbnail upload
app.post('/api/webapp/live/thumbnail', requireSessionAuth, roleGuard('model', 'creator', 'admin', 'superadmin'), express.json({ limit: '4mb' }), asyncHandler(streamerSettingsController.uploadThumbnail));
// MED-02: 6 MB body limit for snapshot uploads (base64-encoded frame); role guard restricts to creators only
app.post('/api/webapp/live/snapshot', requireSessionAuth, roleGuard('model', 'creator', 'admin', 'superadmin'), express.json({ limit: '6mb' }), asyncHandler(webappLiveController.uploadSnapshot));

// Gap 1: Past-session earnings history for studio panel
app.get('/api/webapp/live/earnings', requireSessionAuth, roleGuard('model', 'creator', 'admin', 'superadmin'), asyncHandler(webappLiveController.getEarningsHistory));

// Gap 4: User-uploaded local recording blob (CR-02: roleGuard prevents non-creator 3 GB uploads)
app.post('/api/webapp/live/recording', requireSessionAuth, roleGuard('model', 'creator', 'admin', 'superadmin'), webappLiveController.uploadLocalRecording);

// Gap 5: Scene presets
app.get('/api/webapp/live/scene-presets', requireSessionAuth, asyncHandler(webappLiveController.getScenePresets));
app.post('/api/webapp/live/scene-presets', requireSessionAuth, asyncHandler(webappLiveController.saveScenePreset));

// Gap 5: Mixer presets
app.get('/api/webapp/live/mixer-presets', requireSessionAuth, asyncHandler(webappLiveController.getMixerPresets));
app.post('/api/webapp/live/mixer-presets', requireSessionAuth, asyncHandler(webappLiveController.saveMixerPreset));

// Stream Bridge: browser → RTMP via WebSocket+FFmpeg (legacy — kept for backward compat)
const streamBridgeController = require('./controllers/streamBridgeController');
app.get('/api/webapp/live/my-channel', requireSessionAuth, roleGuard('model', 'creator', 'admin', 'superadmin'), asyncHandler(streamBridgeController.getMyChannel));

// Stream Auto-Chat (Grok-generated messages that post to live chat at intervals)
const streamAutoController = require('./controllers/streamAutoController');
const grokStreamChatLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => String(req.session?.user?.id || req.ip),
  message: { success: false, error: 'Too many generation requests. Wait before regenerating.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiter for authenticated /api/proxy/live/performers — 30 req/min per user
const livePerformersLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: (req) => `user:${req.session?.user?.id || req.ip}`,
  message: { success: false, error: 'Too many requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// IP-based rate limiter for the public overlay endpoint — 60 req/min per IP
const overlayPublicLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  keyGenerator: (req) => req.ip,
  message: { success: false, error: 'Too many requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});
// Per-user limiter for the connection-test endpoint — 10 req/min to prevent payload abuse
const connectionTestLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator: (req) => req.session?.user?.id || req.ip,
  message: { success: false, error: 'Too many connection tests. Please wait.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.get('/api/webapp/live/stream-profile', requireSessionAuth, roleGuard('model', 'creator', 'admin', 'superadmin'), asyncHandler(streamAutoController.getStreamProfile));
app.post('/api/webapp/live/stream-profile', requireSessionAuth, roleGuard('model', 'creator', 'admin', 'superadmin'), grokStreamChatLimiter, asyncHandler(streamAutoController.saveStreamProfile));
// CR-SQ-02: 10 start/stop per minute per user — each triggers a Grok API call
const autoStreamLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator: (req) => String(req.session?.user?.id || req.ip),
  handler: (req, res) => res.status(429).json({ success: false, error: 'Too many requests. Please wait before toggling AI messages again.' }),
  standardHeaders: true,
  legacyHeaders: false,
});
app.post('/api/webapp/live/stream-auto-start', requireSessionAuth, roleGuard('model', 'creator', 'admin', 'superadmin'), autoStreamLimiter, asyncHandler(streamAutoController.startAutoMessages));
app.post('/api/webapp/live/stream-auto-stop', requireSessionAuth, roleGuard('model', 'creator', 'admin', 'superadmin'), autoStreamLimiter, asyncHandler(streamAutoController.stopAutoMessages));

// ── Stream Metadata (title / description / tags visible on the Live page) ──
// Stored in Redis stream:meta:{channelRef} as JSON — the same key that
// listStreams() enriches public stream listings with.
app.get('/api/webapp/live/stream-meta', requireSessionAuth, roleGuard('model', 'creator', 'admin', 'superadmin'), streamMetaLimiter, asyncHandler(async (req, res) => {
  const userId = req.session.user?.id;
  if (!userId) return res.status(401).json({ success: false, error: 'Not authenticated' });

  try {
    const { rows } = await getPool().query(
      'SELECT live_channel FROM users WHERE id = $1 LIMIT 1',
      [String(userId)]
    );
    const channelRef = rows[0]?.live_channel;
    if (!channelRef) return res.json({ success: true, meta: null });

    const redis = getRedis();
    const raw = await redis.get(`stream:meta:${channelRef}`);
    let meta = null;
    if (raw) {
      try { meta = JSON.parse(raw); } catch { /* ignore */ }
    }
    res.json({ success: true, meta });
  } catch (err) {
    logger.error('GET stream-meta error', { userId, error: err.message });
    res.status(500).json({ success: false, error: 'Failed to fetch stream metadata' });
  }
}));

app.post('/api/webapp/live/stream-meta', requireSessionAuth, roleGuard('model', 'creator', 'admin', 'superadmin'), streamMetaLimiter, asyncHandler(async (req, res) => {
  const userId = req.session.user?.id;
  if (!userId) return res.status(401).json({ success: false, error: 'Not authenticated' });

  const { title, description, tags } = req.body || {};
  if (!title || String(title).trim().length === 0) {
    return res.status(400).json({ success: false, error: 'title is required' });
  }
  const safeTitle = String(title).slice(0, 80).trim();
  const safeDesc = description ? String(description).slice(0, 200).trim() : '';
  const safeTags = Array.isArray(tags)
    ? tags.slice(0, 5).map((t) => String(t).slice(0, 30).trim()).filter(Boolean)
    : [];

  try {
    const { rows } = await getPool().query(
      'SELECT live_channel FROM users WHERE id = $1 LIMIT 1',
      [String(userId)]
    );
    const channelRef = rows[0]?.live_channel;
    if (!channelRef) return res.status(400).json({ success: false, error: 'No streaming channel assigned yet' });

    const redis = getRedis();
    await redis.set(
      `stream:meta:${channelRef}`,
      JSON.stringify({ title: safeTitle, description: safeDesc, tags: safeTags }),
      'EX',
      86400
    );
    res.json({ success: true });
  } catch (err) {
    logger.error('POST stream-meta error', { userId, error: err.message });
    res.status(500).json({ success: false, error: 'Failed to save stream metadata' });
  }
}));

// ── BRB (Be Right Back) toggle — creator emits live:brb to all viewers ──
app.post('/api/webapp/live/brb', requireSessionAuth, roleGuard('model', 'creator', 'admin', 'superadmin'), brbLimiter, asyncHandler(async (req, res) => {
  const userId = req.session.user?.id;
  if (!userId) return res.status(401).json({ success: false, error: 'Not authenticated' });

  const on = req.body?.on === true;

  try {
    const { rows } = await getPool().query(
      'SELECT live_channel FROM users WHERE id = $1 LIMIT 1',
      [String(userId)]
    );
    const channelRef = rows[0]?.live_channel;
    if (!channelRef) return res.status(400).json({ success: false, error: 'No streaming channel assigned yet' });

    // Persist BRB state in Redis so late-joining viewers can know
    const redis = getRedis();
    if (on) {
      await redis.set(`stream:brb:${channelRef}`, '1', 'EX', 7200);
    } else {
      await redis.del(`stream:brb:${channelRef}`);
    }

    // Broadcast to everyone watching this stream
    const socketSingleton = require('../../services/socketSingleton');
    const io = socketSingleton.get();
    if (io) {
      io.to(`live:${channelRef}`).emit('live:brb', { on });
    }

    res.json({ success: true, on });
  } catch (err) {
    logger.error('POST brb error', { userId, error: err.message });
    res.status(500).json({ success: false, error: 'Failed to set BRB state' });
  }
}));

// Connection quality test — server echoes received byte count so the studio
// can compute throughput from its own round-trip timing (performance.now()).
// The frontend POSTs a ~200KB application/octet-stream Blob.
app.post('/api/webapp/live/connection-test', requireSessionAuth, connectionTestLimiter,
  express.raw({ type: ['application/octet-stream', 'application/json'], limit: '512kb' }),
  asyncHandler(async (req, res) => {
    const receivedBytes = Buffer.isBuffer(req.body) ? req.body.length : 0;
    res.json({ success: true, receivedBytes });
  })
);

// Stream history — returns past streams and aggregate stats for the authenticated creator
app.get('/api/webapp/live/stream-history', requireSessionAuth, roleGuard('model', 'creator', 'admin', 'superadmin'), asyncHandler(async (req, res) => {
  const LiveStreamModel = require('../../models/liveStreamModel');
  const userId = req.session.user?.id;
  if (!userId) return res.status(401).json({ success: false, error: 'Session expired' });
  const streams = await LiveStreamModel.getByHostId(String(userId), 20);

  const totalStreams = streams.length;
  const totalDuration = streams.reduce((sum, s) => sum + (s.duration || 0), 0);
  const avgViewers = totalStreams > 0
    ? Math.round(streams.reduce((sum, s) => sum + (s.peakViewers || 0), 0) / totalStreams)
    : 0;
  const totalLikes = streams.reduce((sum, s) => sum + (s.likes || 0), 0);

  res.json({
    success: true,
    streams: streams.map((s) => ({
      id: s.streamId || s.dbId,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      duration: s.duration || 0,
      peakViewers: s.peakViewers || 0,
      totalViews: s.totalViews || 0,
      likes: s.likes || 0,
      status: s.status,
    })),
    summary: { totalStreams, totalDuration, avgViewers, totalLikes },
  });
}));

// Stream Overlay Management (admin CRUD + public viewer endpoint)
// Socket.IO access uses socketSingleton.get() directly inside the controller —
// no wiring step needed here.
const streamOverlayController = require('./controllers/streamOverlayController');
app.get('/api/webapp/admin/stream-overlays', adminGuard, asyncHandler(streamOverlayController.listOverlays));
app.get('/api/webapp/admin/stream-overlays/:channelRef', adminGuard, asyncHandler(streamOverlayController.getOverlay));
app.put('/api/webapp/admin/stream-overlays/:channelRef', adminGuard, asyncHandler(streamOverlayController.updateOverlay));
// Public overlay endpoint — no auth, short cache, used by the frontend LivePlayer
app.get('/api/proxy/live/overlay/:channelRef', overlayPublicLimiter, asyncHandler(streamOverlayController.getPublicOverlay));

// Overlay Asset Library (CMS-managed logos & banners)
const overlayLibraryController = require('./controllers/overlayLibraryController');
app.get('/api/webapp/admin/overlay-library', adminGuard, asyncHandler(overlayLibraryController.listAssets));

// ─── Direct Overlay Asset Upload (logos & banners stored on disk) ─────────────
// Ensure upload directories exist at startup
const OVERLAY_LOGOS_DIR = path.join(process.cwd(), 'public/uploads/overlays/logos');
const OVERLAY_BANNERS_DIR = path.join(process.cwd(), 'public/uploads/overlays/banners');
try { fs.mkdirSync(OVERLAY_LOGOS_DIR, { recursive: true }); } catch (e) { logger.warn(`Could not create overlay logos dir: ${e.message}`); }
try { fs.mkdirSync(OVERLAY_BANNERS_DIR, { recursive: true }); } catch (e) { logger.warn(`Could not create overlay banners dir: ${e.message}`); }

const overlayAssetStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const type = (req.body.type || '').toLowerCase();
    if (type === 'logo') return cb(null, OVERLAY_LOGOS_DIR);
    if (type === 'banner') return cb(null, OVERLAY_BANNERS_DIR);
    cb(new Error('type must be logo or banner'));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '') || '.png';
    const base = path.basename(file.originalname, path.extname(file.originalname))
      .replace(/[^a-z0-9_-]/gi, '_')
      .slice(0, 40)
      .toLowerCase();
    cb(null, `${base}-${Date.now()}${ext}`);
  },
});
const overlayAssetUpload = multer({
  storage: overlayAssetStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB max
  fileFilter: (req, file, cb) => {
    const allowed = /^image\/(jpeg|jpg|png|webp|gif|svg\+xml)$/i.test(file.mimetype || '');
    if (allowed) return cb(null, true);
    cb(new Error('Only image files are allowed for overlay assets (jpg/png/webp/gif/svg)'));
  },
});
const uploadOverlayAsset = (req, res, next) => {
  overlayAssetUpload.single('file')(req, res, (err) => {
    if (!err) return next();
    const status = err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    return res.status(status).json({ success: false, error: err.message || 'Upload error' });
  });
};

// POST /api/webapp/admin/overlay-assets/upload — Upload a logo or banner image
app.post('/api/webapp/admin/overlay-assets/upload', adminGuard, uploadLimiter, uploadOverlayAsset, asyncHandler(async (req, res) => {
  const { type } = req.body;
  if (!type || !['logo', 'banner'].includes(type)) {
    return res.status(400).json({ success: false, error: 'type must be logo or banner' });
  }
  if (!req.file) {
    return res.status(400).json({ success: false, error: 'No file uploaded' });
  }

  // SVG sanitization — strip script tags, event handlers, javascript: URIs, and foreignObject
  if (req.file.mimetype === 'image/svg+xml') {
    try {
      let svgContent = fs.readFileSync(req.file.path, 'utf8');
      svgContent = svgContent.replace(/<script[\s\S]*?<\/script>/gi, '');
      svgContent = svgContent.replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '');
      svgContent = svgContent.replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, '');
      svgContent = svgContent.replace(/\s+(href|xlink:href)\s*=\s*["']javascript:[^"']*["']/gi, '');
      fs.writeFileSync(req.file.path, svgContent, 'utf8');
    } catch (sanitizeErr) {
      logger.warn('SVG sanitization failed, rejecting upload', { error: sanitizeErr.message });
      try { fs.unlinkSync(req.file.path); } catch {}
      return res.status(400).json({ success: false, error: 'SVG file could not be validated.' });
    }
  }

  const dir = type === 'logo' ? 'logos' : 'banners';
  const url = `/uploads/overlays/${dir}/${req.file.filename}`;
  return res.json({ success: true, url, name: req.file.originalname, type, filename: req.file.filename });
}));

// GET /api/webapp/admin/overlay-assets?type=logo|banner — List uploaded overlay assets
app.get('/api/webapp/admin/overlay-assets', adminGuard, asyncHandler(async (req, res) => {
  const { type } = req.query;
  try {
    const collectDir = async (dirPath, dirSlug, typeLabel) => {
      if (!fs.existsSync(dirPath)) return [];
      const entries = fs.readdirSync(dirPath);
      return entries
        .filter(name => /\.(jpg|jpeg|png|webp|gif|svg)$/i.test(name))
        .map(name => {
          const filePath = path.join(dirPath, name);
          let stat;
          try { stat = fs.statSync(filePath); } catch { return null; }
          return {
            name,
            url: `/uploads/overlays/${dirSlug}/${name}`,
            size: stat.size,
            modified: stat.mtime.toISOString(),
            type: typeLabel,
          };
        })
        .filter(Boolean)
        .sort((a, b) => new Date(b.modified) - new Date(a.modified));
    };

    let assets = [];
    if (!type || type === 'logo') {
      assets = assets.concat(await collectDir(OVERLAY_LOGOS_DIR, 'logos', 'logo'));
    }
    if (!type || type === 'banner') {
      assets = assets.concat(await collectDir(OVERLAY_BANNERS_DIR, 'banners', 'banner'));
    }
    return res.json({ success: true, assets });
  } catch (error) {
    logger.error('overlay-assets list error', { error: error.message });
    return res.status(500).json({ success: false, error: 'Failed to list overlay assets' });
  }
}));

// DELETE /api/webapp/admin/overlay-assets/:type/:filename — Delete an overlay asset
app.delete('/api/webapp/admin/overlay-assets/:type/:filename', adminGuard, asyncHandler(async (req, res) => {
  const { type, filename } = req.params;
  if (!['logos', 'banners'].includes(type)) {
    return res.status(400).json({ success: false, error: 'type must be logos or banners' });
  }
  // Sanitize filename — must not contain path traversal characters
  if (!filename || /[/\\]/.test(filename) || filename.startsWith('.')) {
    return res.status(400).json({ success: false, error: 'Invalid filename' });
  }
  const baseDir = type === 'logos' ? OVERLAY_LOGOS_DIR : OVERLAY_BANNERS_DIR;
  const filePath = path.join(baseDir, path.basename(filename));
  try {
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, error: 'File not found' });
    }
    fs.unlinkSync(filePath);
    return res.json({ success: true });
  } catch (error) {
    logger.error('overlay-assets delete error', { error: error.message, filePath });
    return res.status(500).json({ success: false, error: 'Failed to delete overlay asset' });
  }
}));

// Web App Support Chat (Cristina AI)
const supportController = require('./controllers/supportController');
const supportChatLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  message: { success: false, error: 'Too many messages. Please wait a moment.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.post('/api/webapp/support/chat', requireSessionAuth, supportChatLimiter, asyncHandler(supportController.chat));
app.get('/api/webapp/support/suggestions', asyncHandler(supportController.suggestions));
app.delete('/api/webapp/support/history', authenticateUser, asyncHandler(supportController.clearHistory));
// Support Tickets (web → Telegram support group)
app.post('/api/webapp/support/ticket', requireSessionAuth, supportChatLimiter, asyncHandler(supportController.createTicket));
app.get('/api/webapp/support/ticket', requireSessionAuth, asyncHandler(supportController.getTicket));
app.get('/api/webapp/support/ticket/messages', requireSessionAuth, asyncHandler(supportController.getTicketMessages));
app.post('/api/webapp/support/ticket/message', requireSessionAuth, supportChatLimiter, asyncHandler(supportController.addTicketMessage));

// Support attachment upload — images + PDF, max 5 files × 10 MB
app.post('/api/webapp/support/ticket/upload', requireSessionAuth, handleSupportAttach, asyncHandler(async (req, res) => {
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ success: false, error: 'No files provided' });

  const sharp = require('sharp');
  const { v4: uuidv4 } = require('uuid');

  const attachments = [];
  for (const file of files) {
    const isPdf = file.mimetype === 'application/pdf';
    const ext = isPdf ? 'pdf' : 'webp';
    const filename = `${uuidv4()}.${ext}`;
    const dest = path.join(supportAttachUploadDir, filename);

    if (isPdf) {
      await fs.promises.writeFile(dest, file.buffer);
    } else {
      await sharp(file.buffer, { failOn: 'none' }).webp({ quality: 85 }).toFile(dest);
    }

    attachments.push({
      url: `/uploads/support/${filename}`,
      name: file.originalname,
      type: isPdf ? 'application/pdf' : 'image/webp',
      size: file.size,
    });
  }

  res.json({ success: true, attachments });
}));

// Admin: Cristina AI payment verification agent
app.post('/api/webapp/support/verify-payment', adminGuard, asyncHandler(supportController.verifyPayment));

// Admin: manually trigger Cristina ticket worker
app.post('/api/admin/support/cristina/run', verifyAdminJWT, asyncHandler(async (req, res) => {
  const cristinaTicketWorker = require('../../services/cristinaTicketWorker');
  if (cristinaTicketWorker.isRunning) {
    return res.json({ success: false, message: 'Worker is already running' });
  }
  // Fire and forget
  cristinaTicketWorker.processOpenTickets().catch((err) => {
    logger.error('Admin-triggered cristina ticket worker error', { error: err.message });
  });
  return res.json({ success: true, message: 'Cristina ticket worker run triggered' });
}));

// ─── Activation code redemption ────────────────────────────────────────────
app.post('/api/webapp/user/activate', requireSessionAuth, asyncHandler(async (req, res) => {
  const rawCode = (req.body?.code ?? '');
  const code = rawCode.toString().trim().toUpperCase().replace(/\s+/g, '');

  if (!code || !/^[A-Z0-9-]{6,50}$/.test(code)) {
    return res.status(400).json({ success: false, error: 'invalid_format' });
  }

  const { rows } = await query(
    'SELECT code, product, used, used_at, expires_at FROM activation_codes WHERE code = $1',
    [code]
  );

  if (!rows.length) {
    return res.status(404).json({ success: false, error: 'not_found' });
  }

  const record = rows[0];

  if (record.used) {
    return res.status(409).json({ success: false, error: 'already_used' });
  }

  if (record.expires_at && new Date(record.expires_at) < new Date()) {
    return res.status(410).json({ success: false, error: 'expired' });
  }

  if (record.product === 'lifetime100-promo' || record.product === 'lifetime100_promo') {
    return res.status(422).json({ success: false, error: 'use_lifetime100', redirect: '/lifetime100' });
  }

  const { cache: activationCache } = require('../../config/redis');
  const lockKey = `activation:code:${code}`;
  const gotLock = await activationCache.acquireLock(lockKey, 30);
  if (!gotLock) {
    return res.status(409).json({ success: false, error: 'already_used' });
  }

  try {
    const userId = req.session.userId;
    const username = req.session.user?.username || req.session.user?.name || null;

    const updateResult = await query(
      'UPDATE activation_codes SET used=true, used_at=NOW(), used_by=$2, used_by_username=$3 WHERE code=$1 AND used=false',
      [code, userId, username]
    );

    if (!updateResult.rowCount) {
      return res.status(409).json({ success: false, error: 'already_used' });
    }

    await PaymentService.grantEntitlementsForPlan(userId, 'lifetime-pass', 'activation_code', { activationCode: code });

    await query(
      'INSERT INTO activation_logs (user_id, username, code, product, success) VALUES ($1,$2,$3,$4,$5)',
      [userId, username, code, record.product, true]
    ).catch((logErr) => {
      logger.warn('activation_logs insert failed', { error: logErr.message, userId, code });
    });

    logger.info('Activation code redeemed via webapp', { userId, code, product: record.product });

    return res.json({ success: true, product: record.product, message: 'Lifetime PRIME access activated!' });
  } catch (err) {
    logger.error('Activation code redemption error', { error: err.message, code, userId: req.session.userId });
    await query(
      'INSERT INTO activation_logs (user_id, username, code, product, success) VALUES ($1,$2,$3,$4,$5)',
      [req.session.userId, req.session.user?.username || null, code, record.product, false]
    ).catch(() => {});
    throw err;
  } finally {
    await activationCache.releaseLock(lockKey).catch(() => {});
  }
}));

// Web App Payments (session auth → PaymentService)

// ensureEmailCredentials lives in services/userService — single source of truth
// shared with apps/backend/bot/api/routes/paymentRoutes.js
const { ensureEmailCredentials } = require('../../services/userService');

// Get a random available Meru link for a product
// Verifies the link is actually unpaid on Meru before serving it
const meruRandomLinkLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => req.session?.user?.id || req.ip,
  handler: (req, res) => res.status(429).json({ success: false, error: 'Too many requests. Try again later.' }),
  standardHeaders: true,
  legacyHeaders: false,
});
app.get('/api/meru/random-link', requireSessionAuth, meruRandomLinkLimiter, asyncHandler(async (req, res) => {
  // Default to the consolidated 'lifetime100' pool — see migration 195.
  const { product = 'lifetime100' } = req.query;
  const meruLinkService = require('../../services/meruLinkService');
  const meruPaymentService = require('../../services/meruPaymentService');

  try {
    // Try up to 5 random links to find one that's genuinely unpaid on Meru
    const MAX_ATTEMPTS = 5;
    const triedCodes = new Set();

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const link = await meruLinkService.getRandomAvailableLink(product);

      if (!link) break;
      if (triedCodes.has(link.code)) continue;
      triedCodes.add(link.code);

      // Verify link is not already paid on Meru
      const verification = await meruPaymentService.verifyPayment(link.code);
      if (!verification.isPaid) {
        // Fresh link — serve it
        return res.json({ success: true, code: link.code, url: link.meru_link });
      }

      // Already paid on Meru — mark as used so it won't be picked again
      logger.warn('Meru link already paid but was active in DB, marking as used', { code: link.code, paidAt: verification.paidAt });
      await meruLinkService.invalidateLinkAfterActivation(link.code, 'unknown', 'paid-on-meru-no-activation');
    }

    return res.status(404).json({
      success: false,
      error: `No active Meru links found for product: ${product}`
    });
  } catch (error) {
    logger.error('Error in /api/meru/random-link:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}));

// ─────────────────────────────────────────────────────────────────────────────
// Public founder-lifetime flow (no auth required)
// ─────────────────────────────────────────────────────────────────────────────
const lifetime100ReserveLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3,
  message: { success: false, error: 'Too many reservation attempts. Try again in an hour.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip,
});
const lifetime100ActivateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { success: false, error: 'Too many activation attempts. Try again in an hour.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip,
});

// GET /api/public/lifetime100/availability — returns { success, available }
app.get('/api/public/lifetime100/availability', asyncHandler(async (req, res) => {
  const { query: dbQuery } = require('../../config/postgres');
  const { rows } = await dbQuery(
    `SELECT COUNT(*)::int AS n FROM meru_payment_links
      WHERE product='lifetime100' AND status='active'
        AND (reserved_until IS NULL OR reserved_until < NOW())`
  );
  return res.json({ success: true, available: rows[0]?.n || 0 });
}));

// POST /api/public/lifetime100/reserve — capture email, reserve a code, email the user
app.post('/api/public/lifetime100/reserve', lifetime100ReserveLimiter, asyncHandler(async (req, res) => {
  const { email: rawEmail, language: rawLang } = req.body || {};
  const email = String(rawEmail || '').trim().toLowerCase();
  const language = (rawLang === 'en' ? 'en' : 'es');
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return res.status(400).json({ success: false, error: 'A valid email address is required' });
  }

  // Per-email soft rate-limit: max 2 reservations per hour via Redis incr
  const emailRateKey = `lifetime100:reserve:email:${email}`;
  const emailRate = await cache.incr(emailRateKey, 60 * 60);
  if (emailRate > 2) {
    return res.status(429).json({ success: false, error: 'Too many reservations for this email. Try again later.' });
  }

  const meruLinkService = require('../../services/meruLinkService');
  const EmailService = require('../../services/emailservice');
  const { ensureEmailCredentials } = require('../../services/userService');
  const { query: dbQuery } = require('../../config/postgres');
  const crypto = require('crypto');

  // 1) Find or create user record
  const existingUser = await dbQuery(
    `SELECT id FROM users WHERE LOWER(email)=LOWER($1) AND COALESCE(is_deleted,false)=false LIMIT 1`,
    [email]
  );
  let userId;
  if (existingUser.rows.length > 0) {
    userId = existingUser.rows[0].id;
  } else {
    userId = crypto.randomUUID();
    const firstName = email.split('@')[0].slice(0, 80) || 'Founder';
    await dbQuery(
      `INSERT INTO users (id, email, first_name, tier, role, subscription_status, created_at, updated_at)
       VALUES ($1, $2, $3, 'free', 'user', 'free', NOW(), NOW())`,
      [userId, email, firstName]
    );
  }

  // 2) Ensure credentials exist (skip email — we send one combined founder email)
  let credResult;
  try {
    credResult = await ensureEmailCredentials(userId, email, language, { skipEmail: true });
  } catch (credErr) {
    if (String(credErr.message || '').includes('already associated')) {
      return res.status(409).json({ success: false, error: credErr.message });
    }
    logger.error('lifetime100 reserve: credential error', { email, error: credErr.message });
    return res.status(500).json({ success: false, error: 'Failed to provision account' });
  }

  // Only include plaintext password in email for newly-created accounts
  const includeCreds = !!(credResult?.created && credResult?.plainPassword);

  // 3) Atomically reserve a code
  const reservation = await meruLinkService.reserveRandomLink({
    product: 'lifetime100',
    email,
    userId,
    minutes: 60,
  });
  if (!reservation) {
    return res.status(409).json({
      success: false,
      error: 'All founder codes are currently reserved. Please try again in about an hour.',
    });
  }

  // 4) Send combined welcome + code email
  const activationUrl = `https://app.pnptv.app/lifetime100/activate?code=${encodeURIComponent(reservation.code)}`;
  try {
    await EmailService.sendFounderLifetimeEmail({
      to: email,
      language,
      meruCode: reservation.code,
      meruUrl: reservation.meru_link,
      loginEmail: email,
      loginPassword: includeCreds ? credResult.plainPassword : '(use your existing password)',
      recoveryId: userId,
      activationUrl,
    });
  } catch (emailErr) {
    // Non-critical — the code is still reserved; user can retry via the page
    logger.error('lifetime100 reserve: email send failed', { email, code: reservation.code, error: emailErr.message });
  }

  return res.json({
    success: true,
    message: 'Founder code sent to your email. It is valid for 60 minutes.',
    expiresAt: reservation.reserved_until,
    meruUrl: reservation.meru_link,
    code: reservation.code,
  });
}));

// POST /api/public/lifetime100/activate — verify Meru payment, claim code, grant membership, log in
app.post('/api/public/lifetime100/activate', lifetime100ActivateLimiter, asyncHandler(async (req, res) => {
  const code = String(req.body?.code || '').trim();
  if (!code || code.length > 100 || !/^[A-Za-z0-9_\-]+$/.test(code)) {
    return res.status(400).json({ success: false, error: 'A valid code is required' });
  }

  const meruLinkService = require('../../services/meruLinkService');
  const meruPaymentService = require('../../services/meruPaymentService');
  const { getPool } = require('../../config/postgres');
  const pool = getPool();

  const meruLockKey = `meru:activate:${code}`;
  const gotLock = await cache.acquireLock(meruLockKey, 30);
  if (!gotLock) {
    return res.status(409).json({ success: false, error: 'Activation already in progress for this code' });
  }

  try {
    // Validate reservation state
    const reservation = await meruLinkService.getReservation(code);
    if (!reservation) {
      return res.status(404).json({ success: false, error: 'Code not found' });
    }
    if (reservation.status === 'used') {
      return res.status(409).json({ success: false, error: 'Code already used' });
    }
    if (reservation.status !== 'reserved' || !reservation.reserved_until || new Date(reservation.reserved_until) < new Date()) {
      return res.status(410).json({ success: false, error: 'Code expired. Request a new one at /lifetime100' });
    }
    const userId = reservation.reserved_for_user_id;
    const email = reservation.reserved_for_email;
    if (!userId) {
      return res.status(500).json({ success: false, error: 'Reservation is missing an owner. Contact support.' });
    }

    // Verify payment on Meru (Puppeteer)
    const verification = await meruPaymentService.verifyPayment(code);
    if (!verification.isPaid) {
      return res.status(402).json({ success: false, error: 'Payment not yet completed on Meru. Please complete payment first.' });
    }

    // Atomic claim — marks status='used'
    const claim = await meruLinkService.claimReservedCode({ code, userId, username: null, email });
    if (!claim.success) {
      return res.status(409).json({ success: false, error: claim.message || 'Code not found, expired, or already used' });
    }

    // Grant entitlements first — source of truth, must succeed before touching users table
    const EntitlementModel = require('../../models/entitlementModel');
    const EntitlementAccessService = require('../../services/entitlementAccessService');
    const primeExpiry = new Date();
    primeExpiry.setDate(primeExpiry.getDate() + 60);
    try {
      await EntitlementModel.grantEntitlement(userId, 'pnp-member', {
        isLifetime: true, source: 'meru', actorId: 'system',
        reason: 'Meru lifetime100 activation (public flow)',
      });
      await EntitlementModel.grantEntitlement(userId, 'prime', {
        isLifetime: false, durationDays: 60, source: 'meru', actorId: 'system',
        reason: 'Meru lifetime100 activation — 2 month PRIME bonus (public)',
      });
      await EntitlementAccessService.recomputeUserTier(userId);
      await EntitlementAccessService.invalidateCache(userId);
    } catch (entErr) {
      logger.error('public lifetime100 activate: entitlement grant failed', { userId, error: entErr.message });
    }

    // Sync users table — cosmetic/legacy; never block on failure
    const UserModel = require('../../models/userModel');
    await UserModel.updateSubscription(userId, { status: 'active', planId: 'lifetime100', expiry: null });
    try {
      const { getClient: _getClient } = require('../../config/postgres');
      const _txClient = await _getClient();
      try {
        await _txClient.query('BEGIN');
        await _txClient.query("SET LOCAL pnptv.superadmin_bypass = 'true'");
        // Best-plan-wins: keep NULL (lifetime), keep later date, else set new expiry
        await _txClient.query(
          `UPDATE users SET plan_expiry = CASE
             WHEN plan_expiry IS NULL THEN NULL
             WHEN plan_expiry > $2::timestamptz THEN plan_expiry
             ELSE $2::timestamptz
           END, updated_at = NOW() WHERE id = $1`,
          [userId, primeExpiry.toISOString()]
        );
        await _txClient.query('COMMIT');
      } catch (txErr) {
        await _txClient.query('ROLLBACK').catch(() => {});
        throw txErr;
      } finally {
        _txClient.release();
      }
    } catch (planExpiryErr) {
      logger.warn('public lifetime100 activate: plan_expiry update failed (non-critical)', { userId, error: planExpiryErr.message });
    }

    // Award founder gamification badge (non-blocking)
    try {
      const gamificationService = require('../../services/gamificationService');
      await gamificationService.awardBadge(userId, 'founder', null, 'Lifetime100 founding member');
    } catch (badgeErr) {
      logger.warn('lifetime100 public activate: founder badge award failed (non-critical)', { userId, error: badgeErr.message });
    }

    // Create session so the user is logged in on return
    try {
      const { rows: freshUser } = await pool.query(
        `SELECT id, email, username, first_name, tier, role FROM users WHERE id=$1`,
        [userId]
      );
      if (freshUser.length > 0 && req.session) {
        req.session.user = {
          id: freshUser[0].id,
          telegramId: null,
          email: freshUser[0].email,
          username: freshUser[0].username,
          first_name: freshUser[0].first_name,
          tier: freshUser[0].tier,
          role: freshUser[0].role,
          language: 'es',
        };
        await new Promise((resolve) => req.session.save(() => resolve()));
      }
    } catch (sessErr) {
      logger.warn('public lifetime100 activate: session creation failed (non-critical)', { userId, error: sessErr.message });
    }

    // Record payment history (non-critical)
    try {
      const PaymentHistoryService = require('../../services/paymentHistoryService');
      await PaymentHistoryService.recordPayment({
        userId, paymentMethod: 'meru', amount: 100, currency: 'USD',
        planId: 'lifetime100', planName: 'Lifetime Member + 2 Months PRIME',
        product: 'lifetime100', paymentReference: code,
        metadata: { activated_via: 'public_webapp', prime_bonus_expires: primeExpiry.toISOString() },
        ipAddress: req.ip, userAgent: req.get('user-agent'),
      });
    } catch (e) {
      logger.warn('public lifetime100 activate: payment history failed', { code, error: e.message });
    }

    return res.json({
      success: true,
      message: 'Founder membership activated',
      redirect: '/',
    });
  } finally {
    await cache.releaseLock(meruLockKey).catch(() => {});
  }
}));

// Meru Lifetime Pass activation (webapp)
app.post('/api/webapp/activate/meru', requireSessionAuth, asyncHandler(async (req, res) => {
  const user = req.session?.user;
  if (!user?.id) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }

  const { code, email } = req.body;
  if (!code || typeof code !== 'string' || !code.trim()) {
    return res.status(400).json({ success: false, error: 'Meru code is required' });
  }
  if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || email.trim().length > 254) {
    return res.status(400).json({ success: false, error: 'A valid email address is required' });
  }

  const meruCode = code.trim();
  if (meruCode.length > 100 || !/^[A-Za-z0-9_\-]+$/.test(meruCode)) {
    return res.status(400).json({ success: false, error: 'Invalid Meru code format' });
  }
  const userId = String(user.telegramId || user.telegram_id || user.id);
  const username = user.username || user.first_name || null;
  const language = user.language || 'es';

  const meruLockKey = `meru:activate:${meruCode}`;
  const meruLockAcquired = await cache.acquireLock(meruLockKey, 30);
  if (!meruLockAcquired) {
    return res.status(409).json({ success: false, error: 'Activation already in progress for this code' });
  }

  try {
    // Ensure user has email + password credentials before processing payment
    try {
      await ensureEmailCredentials(userId, email.trim(), language);
      req.session.user = { ...req.session.user, email: email.trim() };
    } catch (credErr) {
      if (credErr.message.includes('already associated')) {
        return res.status(409).json({ success: false, error: credErr.message });
      }
      logger.warn('ensureEmailCredentials failed (non-critical)', { userId, error: credErr.message });
    }

    // Guard: prevent a user from consuming a second code if already on lifetime100
    if (user.plan_id === 'lifetime100') {
      return res.status(409).json({ success: false, error: 'Your account already has the Lifetime100 plan activated.' });
    }

    // 1. Check code exists and is available
    const meruLinkService = require('../../services/meruLinkService');
    const availableLinks = await meruLinkService.getAvailableLinks('lifetime100');
    const matchingLink = availableLinks.find((link) => link.code === meruCode);

    if (!matchingLink) {
      return res.status(404).json({ success: false, error: 'Code not found or already used' });
    }

    // 2. Puppeteer verification — confirm payment was made on Meru
    const meruPaymentService = require('../../services/meruPaymentService');
    const verification = await meruPaymentService.verifyPayment(meruCode, language);

    if (!verification.isPaid) {
      return res.status(402).json({ success: false, error: 'Payment not yet completed on Meru. Please complete payment first.' });
    }

    // 2b. Atomically claim the code BEFORE granting membership — this is the real race gate.
    // invalidateLinkAfterActivation uses WHERE status = 'active', so only one concurrent
    // request can win. If 0 rows updated, someone else already claimed it.
    const claimResult = await meruLinkService.invalidateLinkAfterActivation(meruCode, userId, username);
    if (!claimResult.success) {
      return res.status(409).json({ success: false, error: 'Code not found or already used' });
    }

    // 3. Activate membership — entitlements first, users table sync after
    const primeExpiry = new Date();
    primeExpiry.setDate(primeExpiry.getDate() + 60); // 2 months PRIME bonus

    // 3b. Grant entitlements (pnp-member lifetime + prime 60 days) — sole source of truth for access
    // Must run before any users-table update to avoid trigger failures killing the grant
    try {
      const EntitlementModel = require('../../models/entitlementModel');
      await EntitlementModel.grantEntitlement(userId, 'pnp-member', {
        isLifetime: true, source: 'meru', actorId: 'system', reason: 'Meru lifetime100 activation',
      });
      await EntitlementModel.grantEntitlement(userId, 'prime', {
        isLifetime: false, durationDays: 60, source: 'meru', actorId: 'system', reason: 'Meru lifetime100 activation — 2 month PRIME bonus',
      });
      await EntitlementAccessService.recomputeUserTier(userId);
      await EntitlementAccessService.invalidateCache(userId);
    } catch (entErr) {
      logger.error('Meru entitlement grant failed', { userId, error: entErr.message });
    }

    // Sync users table — cosmetic/legacy; never block on failure
    const UserModel = require('../../models/userModel');
    await UserModel.updateSubscription(userId, { status: 'active', planId: 'lifetime100', expiry: null });
    const pool = getPool();
    try {
      const { getClient: _getClientMeru } = require('../../config/postgres');
      const _txClientMeru = await _getClientMeru();
      try {
        await _txClientMeru.query('BEGIN');
        await _txClientMeru.query("SET LOCAL pnptv.superadmin_bypass = 'true'");
        // Best-plan-wins: keep NULL (lifetime), keep later date, else set new expiry
        await _txClientMeru.query(
          `UPDATE users SET plan_expiry = CASE
             WHEN plan_expiry IS NULL THEN NULL
             WHEN plan_expiry > $2::timestamptz THEN plan_expiry
             ELSE $2::timestamptz
           END, updated_at = NOW() WHERE id = $1`,
          [userId, primeExpiry.toISOString()]
        );
        await _txClientMeru.query('COMMIT');
      } catch (txErr) {
        await _txClientMeru.query('ROLLBACK').catch(() => {});
        throw txErr;
      } finally {
        _txClientMeru.release();
      }
    } catch (planExpiryErr) {
      logger.warn('Meru webapp activate: plan_expiry update failed (non-critical)', { userId, error: planExpiryErr.message });
    }

    // Award founder gamification badge (non-blocking)
    try {
      const gamificationService = require('../../services/gamificationService');
      await gamificationService.awardBadge(userId, 'founder', null, 'Lifetime100 founding member');
    } catch (badgeErr) {
      logger.warn('Meru webapp activate: founder badge award failed (non-critical)', { userId, error: badgeErr.message });
    }

    // 4. Mark activation code used in activation_codes table (non-critical; Meru link already claimed above)
    try {
      const { markCodeUsed } = require('../handlers/payments/activation');
      await markCodeUsed(meruCode, userId, username);
    } catch (e) {
      logger.warn('Failed to mark activation code used (non-critical)', { code: meruCode, error: e.message });
    }

    // 5. Record payment history
    const PaymentHistoryService = require('../../services/paymentHistoryService');
    try {
      await PaymentHistoryService.recordPayment({
        userId,
        paymentMethod: 'meru',
        amount: 100,
        currency: 'USD',
        planId: 'lifetime100',
        planName: 'Lifetime Member + 2 Months PRIME',
        product: 'lifetime100',
        paymentReference: meruCode,
        metadata: { activated_via: 'webapp', prime_bonus_expires: primeExpiry.toISOString() },
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      });
    } catch (e) {
      logger.warn('Failed to record payment history (non-critical)', { code: meruCode, error: e.message });
    }

    // 6. Audit log + business notification (non-critical)
    try {
      const { logActivation } = require('../handlers/payments/activation');
      await logActivation({ userId, username, code: meruCode, product: 'lifetime100', success: true });
    } catch (e) {
      logger.warn('Failed to log activation (non-critical)', { error: e.message });
    }
    try {
      const BusinessNotificationService = require('../../services/businessNotificationService');
      await BusinessNotificationService.notifyCodeActivation({ userId, username, code: meruCode, product: 'lifetime100' });
    } catch (e) {
      logger.warn('Failed to send business notification (non-critical)', { error: e.message });
    }

    // 7. Telegram DM with PRIME invite link (async fire-and-forget)
    PaymentService.sendPaymentConfirmationNotification({
      userId,
      plan: { id: 'lifetime100', name: 'Lifetime Member + 2 Months PRIME', display_name: 'Lifetime Member + 2 Months PRIME' },
      transactionId: meruCode,
      amount: 100,
      expiryDate: primeExpiry.toISOString(),
      language,
      provider: 'meru',
    }).catch((e) => logger.warn('Failed to send Telegram DM (non-critical)', { error: e.message }));

    // 8. Invoice + welcome emails (email is now always available)
    const customerEmail = email ? email.trim() : user.email;
    if (customerEmail) {
      const InvoiceService = require('../../services/invoiceservice');
      const EmailService = require('../../services/emailservice');

      // Invoice email
      (async () => {
        try {
          const { buffer: invoicePdf } = await InvoiceService.generateInvoice({
            invoiceNumber: `MERU-${meruCode}`,
            customerName: user.first_name || username || 'Valued Customer',
            planName: 'Lifetime Member + 2 Months PRIME',
            amount: 100,
            currency: 'USD',
            provider: 'meru',
            transactionId: meruCode,
            purchaseDate: new Date(),
            expiryDate: primeExpiry,
            language,
          });

          await EmailService.sendInvoiceEmail({
            to: customerEmail,
            customerName: user.first_name || username || 'Valued Customer',
            invoiceNumber: `MERU-${meruCode}`,
            amount: 100,
            planName: 'Lifetime Member + 2 Months PRIME',
            invoicePdf,
          });
          logger.info('Meru invoice email sent', { to: customerEmail, code: meruCode });
        } catch (emailError) {
          logger.warn('Failed to send invoice email (non-critical)', { error: emailError.message });
        }
      })();

      // Welcome email with onboarding guide
      (async () => {
        try {
          const { buffer: guidePdf } = await InvoiceService.generateOnboardingGuide({
            customerName: user.first_name || username || 'Valued Customer',
            planName: 'Lifetime Member + 2 Months PRIME',
            language,
          });

          await EmailService.sendWelcomeEmail({
            to: customerEmail,
            customerName: user.first_name || username || 'Valued Customer',
            planName: 'Lifetime Member + 2 Months PRIME',
            duration: 36500, // lifetime
            expiryDate: primeExpiry,
            language,
            onboardingGuidePdf: guidePdf,
            userUuid: user.id || userId,
            username: user.username || username,
            loginMethod: user.last_login_method || 'deep_link'
          });
          logger.info('Meru welcome email sent', { to: customerEmail, code: meruCode });
        } catch (emailError) {
          logger.warn('Failed to send welcome email (non-critical)', { error: emailError.message });
        }
      })();
    }

    // 9. Update session so frontend reflects PRIME immediately (bonus period)
    req.session.user = {
      ...req.session.user,
      tier: 'PRIME',
      subscription_status: 'active',
      plan_id: 'lifetime100',
    };

    logger.info('Meru lifetime100 activated via webapp', { userId, code: meruCode, primeExpiry: primeExpiry.toISOString() });
    res.json({ success: true });
  } finally {
    await cache.releaseLock(meruLockKey).catch((err) => {
      logger.warn('Failed to release Meru activation lock', { lockKey: meruLockKey, error: err.message });
    });
  }
}));

// Validate a promo code for the logged-in user without claiming the spot.
// Returns pricing + eligibility so the Subscribe page can show strikethrough
// price before the user commits. Redemption (spot claim) happens during
// /api/webapp/payments/create when promoCode is passed in.
app.get('/api/webapp/promos/:code', requireSessionAuth, asyncHandler(async (req, res) => {
  const user = req.session?.user;
  if (!user?.id) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }

  const code = String(req.params.code || '').trim();
  if (!code || code.length > 64) {
    return res.status(400).json({ success: false, error: 'Invalid promo code' });
  }

  const PromoService = require('../../services/promoService');
  const PromoModel = require('../../models/promoModel');
  const PlanModel = require('../../models/planModel');

  const userId = String(user.telegramId || user.telegram_id || user.id);
  const result = await PromoService.getPromoForUser(code, userId);
  if (!result.success) {
    return res.status(404).json({ success: false, error: result.error, message: result.message });
  }

  // For any-plan promos, let the caller pick a plan via ?planId=…
  const queryPlanId = typeof req.query.planId === 'string' ? req.query.planId.trim() : '';
  let pricing = result.pricing;
  let basePlan = result.basePlan;

  if (PromoModel.isAnyPlanPromo(result.promo) && queryPlanId) {
    const plan = await PlanModel.getById(queryPlanId);
    if (!plan || plan.active === false) {
      return res.status(404).json({ success: false, error: 'plan_not_found', message: 'Plan not found' });
    }
    pricing = PromoModel.calculatePriceForPlan(result.promo, plan);
    basePlan = plan;
  }

  res.json({
    success: true,
    code: result.promo.code,
    name: result.promo.name,
    nameEs: result.promo.nameEs,
    description: result.promo.description,
    descriptionEs: result.promo.descriptionEs,
    isAnyPlan: PromoModel.isAnyPlanPromo(result.promo),
    basePlanId: result.promo.basePlanId,
    discountType: result.promo.discountType,
    discountValue: result.promo.discountValue,
    pricing,
    basePlan: basePlan ? { id: basePlan.id, name: basePlan.display_name || basePlan.name, price: basePlan.price } : null,
    remainingSpots: result.remainingSpots,
    validUntil: result.promo.validUntil,
  });
}));

app.post('/api/webapp/payments/create', requireSessionAuth, paymentCreateLimiter, asyncHandler(async (req, res) => {
  const user = req.session?.user;
  if (!user?.id) return res.status(401).json({ success: false, error: 'Authentication required' });

  const { planId, creatorId, email, promoCode } = req.body;
  if (!planId || typeof planId !== 'string') {
    return res.status(400).json({ success: false, error: 'planId is required' });
  }
  if (email != null && (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || email.trim().length > 254)) {
    return res.status(400).json({ success: false, error: 'Invalid email address' });
  }
  if (promoCode != null && (typeof promoCode !== 'string' || !/^[A-Za-z0-9_-]{3,64}$/.test(promoCode.trim()))) {
    return res.status(400).json({ success: false, error: 'Invalid promo code format' });
  }

  const userId = String(user.telegramId || user.telegram_id || user.id);

  // Guard against stale sessions pointing at deleted users (FK crash prevention)
  {
    const { query: _userExistQuery } = require('../../config/postgres');
    const { rows: userCheck } = await _userExistQuery('SELECT id FROM users WHERE id = $1', [user.id]);
    if (!userCheck.length) {
      if (req.session) req.session.destroy(() => {});
      return res.status(401).json({ success: false, error: 'Session expired. Please log in again.', code: 'USER_NOT_FOUND' });
    }
  }

  const extraMetadata = {};
  if (promoCode) extraMetadata.promoCode = promoCode.trim();

  const result = await PaymentService.createPayment({
    userId,
    planId,
    provider: 'nowpayments',
    creatorId: creatorId ? String(creatorId) : undefined,
    extraMetadata: Object.keys(extraMetadata).length ? extraMetadata : undefined,
  });

  if (!result.success) {
    return res.status(400).json(result);
  }

  return res.json({ success: true, paymentUrl: result.paymentUrl, paymentId: result.paymentId });
}));

// Web App Admin Routes (session auth + role check)
const webappAdminController = require('./controllers/webappAdminController');
const primeController = require('./controllers/primeController');

// Admin endpoints with session-based authentication
app.get('/api/webapp/admin/stats', adminGuard, asyncHandler(webappAdminController.getStats));
app.get('/api/webapp/admin/demographics', adminGuard, asyncHandler(webappAdminController.getDemographics));
app.get('/api/webapp/admin/churn-trend', adminGuard, asyncHandler(webappAdminController.getChurnTrend));
app.get('/api/webapp/admin/creator-leaderboard', adminGuard, asyncHandler(webappAdminController.getCreatorLeaderboard));
app.get('/api/webapp/admin/analytics/umami', adminGuard, asyncHandler(webappAdminController.getUmamiStats));
app.get('/api/webapp/admin/analytics/metabase', adminGuard, asyncHandler(webappAdminController.getMetabaseCard));
app.get('/api/webapp/admin/analytics/usage', adminGuard, asyncHandler(webappAdminController.getUsageAnalytics));
// EfiPay reseller endpoints — called by easybots.store, auth via x-reseller-secret header
const efiPayResellerLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });
app.get('/api/internal/efipay-reseller/product', efiPayResellerLimiter, asyncHandler(webappAdminController.efiPayResellerProduct));
app.post('/api/internal/efipay-reseller/grant', efiPayResellerLimiter, asyncHandler(webappAdminController.efiPayResellerGrant));
app.get('/api/webapp/admin/users', adminGuard, asyncHandler(webappAdminController.listUsers));
// Bulk user operations — registered BEFORE :id routes to avoid route shadowing
app.post('/api/webapp/admin/users/bulk-update', adminGuard, asyncHandler(webappAdminController.bulkUpdateUsers));
app.get('/api/webapp/admin/users/:id', adminGuard, asyncHandler(webappAdminController.getUser));
app.put('/api/webapp/admin/users/:id', adminGuard, asyncHandler(webappAdminController.updateUser));
app.post('/api/webapp/admin/users/:id/ban', adminGuard, asyncHandler(webappAdminController.banUser));
app.post('/api/webapp/admin/users/:id/creator-lock', adminGuard, asyncHandler(webappAdminController.setCreatorLock));
app.get('/api/webapp/admin/users/:id/payments', adminGuard, asyncHandler(webappAdminController.getUserPayments));
app.delete('/api/webapp/admin/users/:id', adminGuard, asyncHandler(webappAdminController.deleteUser));
app.get('/api/webapp/admin/posts', adminGuard, asyncHandler(webappAdminController.listPosts));
app.delete('/api/webapp/admin/posts/:id', adminGuard, asyncHandler(webappAdminController.deletePost));
app.get('/api/webapp/admin/hangouts', adminGuard, asyncHandler(webappAdminController.listHangouts));
app.delete('/api/webapp/admin/hangouts/:id', adminGuard, asyncHandler(webappAdminController.endHangout));

// Nearby Places management
const nearbyPlacesAdminController = require('./controllers/nearbyPlacesAdminController');
app.get('/api/webapp/admin/places', adminGuard, asyncHandler(nearbyPlacesAdminController.listPlaces));
app.get('/api/webapp/admin/places/stats', adminGuard, asyncHandler(nearbyPlacesAdminController.getPlaceStats));
app.post('/api/webapp/admin/places/:id/approve', adminGuard, asyncHandler(nearbyPlacesAdminController.approvePlace));
app.post('/api/webapp/admin/places/:id/reject', adminGuard, asyncHandler(nearbyPlacesAdminController.rejectPlace));
app.post('/api/webapp/admin/places/:id/suspend', adminGuard, asyncHandler(nearbyPlacesAdminController.suspendPlace));
app.delete('/api/webapp/admin/places/:id', adminGuard, asyncHandler(nearbyPlacesAdminController.deletePlace));

// Canva admin management
const canvaAdminController = require('./controllers/canvaAdminController');
app.get('/api/webapp/admin/canva/stats', adminGuard, asyncHandler(canvaAdminController.getCanvaStats));
app.get('/api/webapp/admin/canva/users', adminGuard, asyncHandler(canvaAdminController.getConnectedUsers));
app.post('/api/webapp/admin/canva/users/:id/unlink', adminGuard, asyncHandler(canvaAdminController.unlinkUser));
app.get('/api/webapp/admin/canva/jobs', adminGuard, asyncHandler(canvaAdminController.listJobs));
app.post('/api/webapp/admin/canva/jobs/:id/retry', adminGuard, asyncHandler(canvaAdminController.retryJob));
app.post('/api/webapp/admin/canva/jobs/:id/cancel', adminGuard, asyncHandler(canvaAdminController.cancelJob));

// X Auto Campaigns admin routes
const xAutoCampaignAdminController = require('./controllers/xAutoCampaignAdminController');
app.get('/api/webapp/admin/x-campaigns/stats', adminGuard, asyncHandler(xAutoCampaignAdminController.getStats));
app.get('/api/webapp/admin/x-campaigns/media-folder', adminGuard, asyncHandler(xAutoCampaignAdminController.getMediaFolder));
app.get('/api/webapp/admin/x-campaigns/random-video', adminGuard, asyncHandler(xAutoCampaignAdminController.getRandomVideo));
// Static account-level routes must be before /:id param routes
app.post('/api/webapp/admin/x-campaigns/accounts/:accountId/delete-posts', adminGuard, asyncHandler(xAutoCampaignAdminController.startDeleteAccountPosts));
app.get('/api/webapp/admin/x-campaigns/delete-jobs/:jobId', adminGuard, asyncHandler(xAutoCampaignAdminController.getDeleteJobStatus));
app.get('/api/webapp/admin/x-campaigns', adminGuard, asyncHandler(xAutoCampaignAdminController.listCampaigns));
app.post('/api/webapp/admin/x-campaigns', adminGuard, asyncHandler(xAutoCampaignAdminController.createCampaign));
app.put('/api/webapp/admin/x-campaigns/:id', adminGuard, asyncHandler(xAutoCampaignAdminController.updateCampaign));
app.post('/api/webapp/admin/x-campaigns/:id/pause', adminGuard, asyncHandler(xAutoCampaignAdminController.pauseCampaign));
app.post('/api/webapp/admin/x-campaigns/:id/resume', adminGuard, asyncHandler(xAutoCampaignAdminController.resumeCampaign));
app.delete('/api/webapp/admin/x-campaigns/:id', adminGuard, asyncHandler(xAutoCampaignAdminController.deleteCampaign));
app.get('/api/webapp/admin/x-campaigns/:id/history', adminGuard, asyncHandler(xAutoCampaignAdminController.getCampaignHistory));
app.post('/api/webapp/admin/x-campaigns/:id/generate', adminGuard, asyncHandler(xAutoCampaignAdminController.triggerGenerate));
app.post('/api/webapp/admin/x-campaigns/:id/preview', adminGuard, asyncHandler(xAutoCampaignAdminController.previewCampaign));
app.post('/api/webapp/admin/x-campaigns/:id/duplicate', adminGuard, asyncHandler(xAutoCampaignAdminController.duplicateCampaign));

// Creator Subscription management
// NOTE: static-path routes (/summary, /payouts/process-all) MUST be registered
// before the /:creatorId param route to prevent Express matching them as a creatorId.
const creatorSubscriptionAdminController = require('./controllers/creatorSubscriptionAdminController');
app.get('/api/webapp/admin/creator-subscriptions/summary', adminGuard, asyncHandler(creatorSubscriptionAdminController.getPlatformSummary));
app.post('/api/webapp/admin/creator-subscriptions/payouts/process-all', adminGuard, asyncHandler(creatorSubscriptionAdminController.processAllPayouts));
app.get('/api/webapp/admin/creator-subscriptions', adminGuard, asyncHandler(creatorSubscriptionAdminController.listCreators));
app.get('/api/webapp/admin/creator-subscriptions/:creatorId', adminGuard, asyncHandler(creatorSubscriptionAdminController.getCreatorDetail));
app.post('/api/webapp/admin/creator-subscriptions/:creatorId/payout', adminGuard, asyncHandler(creatorSubscriptionAdminController.processCreatorPayout));
app.post('/api/webapp/admin/creator-subscriptions/:creatorId/subscriptions/:subscriptionId/cancel', adminGuard, asyncHandler(creatorSubscriptionAdminController.cancelSubscription));
app.post('/api/webapp/admin/creator-subscriptions/:creatorId/subscriptions/:subscriptionId/extend', adminGuard, asyncHandler(creatorSubscriptionAdminController.extendSubscription));

// Grok Social Media Manager chat
app.post('/api/webapp/admin/grok/manager-chat', adminGuard, asyncHandler(async (req, res) => {
  const { chatWithGrokManager } = require('../../services/grokService');
  const redis = getRedis();
  const pool = getPool();

  const { message, reset } = req.body;
  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ success: false, error: 'Message is required' });
  }

  const userId = req.session?.user?.id;
  if (!userId) return res.status(401).json({ error: 'Authentication required' });
  const adminId = String(userId);
  const redisKey = `grok:manager:chat:${adminId}`;
  const HISTORY_TTL = 7200; // 2 hours
  const MAX_HISTORY = 20;   // 10 pairs

  // Reset conversation
  if (reset) {
    await redis.del(redisKey).catch(() => {});
    return res.json({ success: true, reset: true });
  }

  // Load conversation history
  let history = [];
  try {
    const stored = await redis.get(redisKey);
    if (stored) history = JSON.parse(stored);
  } catch { /* ignore */ }

  // Build live context block from DB
  // Static parts (demographics, accounts, language dist) are cached 10 min to reduce DB load
  let contextBlock = '';
  try {
    const STATIC_CACHE_KEY = 'pnpapp:xcampaign:grok_static_ctx';
    const STATIC_CTX_TTL = 600; // 10 minutes

    // Dynamic parts — always fresh
    const [campaignsResult, postStatsResult, recentFailedResult] = await Promise.all([
      pool.query(`
        SELECT c.campaign_id, c.name, c.language, c.status, c.interval_minutes,
               c.active_hours_start, c.active_hours_end, c.total_generated,
               c.total_posted, c.total_failed, a.handle
        FROM x_auto_campaigns c
        JOIN x_accounts a ON c.account_id = a.account_id
        ORDER BY c.created_at DESC LIMIT 20`),
      pool.query(`
        SELECT DATE(created_at) as day,
               COUNT(*) FILTER (WHERE status = 'sent') as sent,
               COUNT(*) FILTER (WHERE status = 'failed') as failed,
               COUNT(*) FILTER (WHERE status = 'scheduled') as scheduled
        FROM x_post_jobs
        WHERE created_at > NOW() - INTERVAL '7 days'
        GROUP BY DATE(created_at)
        ORDER BY day DESC LIMIT 7`),
      pool.query(`
        SELECT j.error_message, c.name as campaign_name
        FROM x_post_jobs j
        JOIN x_auto_campaigns c ON j.campaign_id = c.campaign_id
        WHERE j.status = 'failed' AND j.created_at > NOW() - INTERVAL '7 days'
        ORDER BY j.created_at DESC LIMIT 5`),
    ]);
    const campaigns = campaignsResult.rows;
    const postStats = postStatsResult.rows;
    const recentFailed = recentFailedResult.rows;

    // Static parts — try cache first
    let staticCtx = null;
    try { staticCtx = await cache.get(STATIC_CACHE_KEY); } catch { /* ignore */ }

    if (!staticCtx) {
      const [demogResult, langsResult, accountsResult] = await Promise.all([
        pool.query(`
          SELECT
            COUNT(*) as total_users,
            COUNT(*) FILTER (WHERE tier = 'PRIME') as prime_users,
            COUNT(*) FILTER (WHERE tier = 'member') as member_users,
            COUNT(*) FILTER (WHERE tier = 'free' OR tier IS NULL) as free_users,
            COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days') as new_last_30d,
            COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days') as new_last_7d
          FROM users WHERE is_active = true`),
        pool.query(`
          SELECT COALESCE(language, 'unknown') as lang, COUNT(*) as cnt
          FROM users WHERE is_active = true
          GROUP BY language ORDER BY cnt DESC LIMIT 8`),
        pool.query(`
          SELECT handle, display_name, is_active FROM x_accounts ORDER BY updated_at DESC`),
      ]);
      const d = demogResult.rows[0] || {};
      const langs = langsResult.rows;
      const accounts = accountsResult.rows;
      const convRate = d.total_users > 0
        ? ((Number(d.prime_users) + Number(d.member_users)) / Number(d.total_users) * 100).toFixed(1)
        : '0';

      staticCtx = `=== PLATFORM DEMOGRAPHICS ===
Total active users: ${d.total_users || 0}
PRIME members: ${d.prime_users || 0} | Regular members: ${d.member_users || 0} | Free: ${d.free_users || 0}
Paid conversion rate: ${convRate}%
New users last 7 days: ${d.new_last_7d || 0} | Last 30 days: ${d.new_last_30d || 0}

Language distribution:
${langs.map(l => `  ${l.lang}: ${l.cnt} users`).join('\n') || '  No data'}

=== X ACCOUNTS ===
${accounts.map(a => `  @${a.handle} (${a.display_name || 'no display name'}) — ${a.is_active ? 'ACTIVE' : 'INACTIVE'}`).join('\n') || '  No accounts'}`;
      try { await cache.set(STATIC_CACHE_KEY, staticCtx, STATIC_CTX_TTL); } catch { /* ignore */ }
    }

    contextBlock = `${staticCtx}

=== CAMPAIGNS (${campaigns.length} total) ===
${campaigns.map(c => `  [${c.status.toUpperCase()}] "${c.name}" → @${c.handle} | ${c.language} | every ${c.interval_minutes}min | UTC ${c.active_hours_start}-${c.active_hours_end} | generated: ${c.total_generated} | posted: ${c.total_posted} | failed: ${c.total_failed}`).join('\n') || '  No campaigns'}

=== POST PERFORMANCE (last 7 days) ===
${postStats.map(r => `  ${r.day}: ${r.sent} sent / ${r.failed} failed / ${r.scheduled} scheduled`).join('\n') || '  No data yet'}

${recentFailed.length > 0 ? `=== RECENT FAILURES ===\n${recentFailed.map(f => `  [${f.campaign_name}] ${f.error_message || 'unknown error'}`).join('\n')}` : ''}

Today: ${new Date().toISOString().split('T')[0]} UTC`;
  } catch (ctxErr) {
    logger.warn('Grok manager context fetch failed', { error: ctxErr.message });
    contextBlock = 'Context unavailable — answer based on general PNPtv knowledge.';
  }

  // Append user message to history
  const userMsg = { role: 'user', content: message.trim().substring(0, 2000) };
  const messages = [...history, userMsg];

  // Call Grok
  const replyText = await chatWithGrokManager({ messages, contextBlock });

  // Save updated history (cap assistant replies to 2000 chars to prevent history bloat)
  const cappedReply = replyText.length > 2000 ? replyText.substring(0, 2000) : replyText;
  const assistantMsg = { role: 'assistant', content: cappedReply };
  const updatedHistory = [...messages, assistantMsg].slice(-MAX_HISTORY);
  await redis.set(redisKey, JSON.stringify(updatedHistory), 'EX', HISTORY_TTL).catch(() => {});

  res.json({ success: true, message: replyText });
}));

// Mono — personal AI business assistant
app.post('/api/webapp/admin/mono/chat', adminGuard, asyncHandler(async (req, res) => {
  const { chatWithMono } = require('../../services/monoService');
  const { message, reset } = req.body;
  const historyKey = String(req.session?.user?.id || 'admin');
  if (reset) {
    await chatWithMono({ message: '_reset_', historyKey, reset: true });
    return res.json({ success: true, reset: true });
  }
  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ success: false, error: 'Message required' });
  }
  const reply = await chatWithMono({ message, historyKey });
  res.json({ success: true, message: reply });
}));

// ── Admin Support Dashboard ──────────────────────────────────────────────────
app.get('/api/webapp/admin/support/stats', adminGuard, asyncHandler(async (req, res) => {
  const SupportTopicModel = require('../../models/supportTopicModel');
  const pool = getPool();

  const stats = await SupportTopicModel.getStatistics();

  const { rows: [frt] } = await pool.query(`
    SELECT AVG(EXTRACT(EPOCH FROM (first_response_at - created_at))/3600)::numeric(10,1) AS avg_hours
    FROM support_topics WHERE first_response_at IS NOT NULL
  `).catch(() => ({ rows: [{ avg_hours: null }] }));

  const { rows: [csat] } = await pool.query(`
    SELECT AVG(user_satisfaction)::numeric(3,1) AS avg_csat,
           COUNT(user_satisfaction)::int AS total_ratings
    FROM support_topics WHERE user_satisfaction IS NOT NULL
  `).catch(() => ({ rows: [{ avg_csat: null, total_ratings: 0 }] }));

  const { rows: [waiting] } = await pool.query(`
    SELECT COUNT(*)::int AS count
    FROM support_topics WHERE first_response_at IS NULL AND status = 'open'
  `).catch(() => ({ rows: [{ count: 0 }] }));

  const { rows: [today] } = await pool.query(`
    SELECT COUNT(*)::int AS count
    FROM support_topics WHERE created_at > NOW() - INTERVAL '24 hours'
  `).catch(() => ({ rows: [{ count: 0 }] }));

  res.json({
    success: true,
    stats: {
      openTickets: parseInt(stats.open_topics) || 0,
      awaitingFirstResponse: waiting.count || 0,
      avgResponseTimeHours: parseFloat(frt.avg_hours) || 0,
      csatScore: parseFloat(csat.avg_csat) || 0,
      totalRatings: csat.total_ratings || 0,
      slaBreaches: parseInt(stats.sla_breaches) || 0,
      newToday: today.count || 0,
    }
  });
}));

app.get('/api/webapp/admin/support/tickets', adminGuard, asyncHandler(async (req, res) => {
  const pool = getPool();
  const { status, priority, category, search, limit: lim, page: pg } = req.query;

  let where = [];
  let params = [];
  let idx = 1;

  if (status) { where.push(`st.status = $${idx++}`); params.push(status); }
  if (priority) { where.push(`st.priority = $${idx++}`); params.push(priority); }
  if (category) { where.push(`st.category = $${idx++}`); params.push(category); }
  if (search) {
    const escaped = search.replace(/[%_]/g, '\\$&');
    where.push(`(st.user_id::text ILIKE $${idx} OR st.thread_name ILIKE $${idx} OR u.username ILIKE $${idx} OR u.first_name ILIKE $${idx})`);
    params.push(`%${escaped}%`);
    idx++;
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limit = Math.min(parseInt(lim) || 25, 100);
  const page = Math.max(parseInt(pg) || 1, 1);
  const offset = (page - 1) * limit;

  const { rows } = await pool.query(`
    SELECT st.*, u.username, u.first_name, u.last_name, u.tier, u.plan_id, u.language AS user_language,
           (SELECT COUNT(*)::int FROM support_ticket_messages stm WHERE stm.user_id = st.user_id AND stm.sender_type = 'user'
            AND stm.created_at > COALESCE(st.last_agent_message_at, st.created_at)) AS unread_count
    FROM support_topics st
    LEFT JOIN users u ON st.user_id = u.id
    ${whereClause}
    ORDER BY
      CASE st.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
      CASE st.status WHEN 'open' THEN 0 WHEN 'resolved' THEN 1 ELSE 2 END,
      st.last_message_at DESC
    LIMIT $${idx} OFFSET $${idx + 1}
  `, [...params, limit, offset]);

  const { rows: [{ count: total }] } = await pool.query(
    `SELECT COUNT(*)::int AS count FROM support_topics st LEFT JOIN users u ON st.user_id = u.id ${whereClause}`,
    params
  );

  // Map snake_case DB fields to camelCase for frontend
  const tickets = rows.map(r => ({
    userId: r.user_id,
    username: r.username || null,
    firstName: r.first_name || null,
    tier: r.tier || 'free',
    plan: r.plan_id || null,
    language: r.user_language || null,
    status: r.status,
    priority: r.priority,
    category: r.category,
    lastMessage: r.last_message || null,
    lastMessageAt: r.last_message_at,
    unreadCount: r.unread_count || 0,
    createdAt: r.created_at,
    threadName: r.thread_name || null,
  }));

  res.json({ success: true, tickets, hasMore: offset + rows.length < total, total });
}));

app.get('/api/webapp/admin/support/tickets/:userId/messages', adminGuard, asyncHandler(async (req, res) => {
  const SupportTicketMessageModel = require('../../models/supportTicketMessageModel');
  const raw = await SupportTicketMessageModel.getByUserId(req.params.userId);
  const messages = (raw || []).map(m => ({
    id: m.id,
    content: m.content,
    senderRole: m.sender_type === 'agent' ? 'agent' : m.sender_type === 'admin' ? 'admin' : 'user',
    senderName: m.sender_name || null,
    createdAt: m.created_at,
    attachments: Array.isArray(m.attachments) ? m.attachments : [],
  }));
  res.json({ success: true, messages });
}));

app.post('/api/webapp/admin/support/tickets/:userId/reply', adminGuard, asyncHandler(async (req, res) => {
  const { content, attachments } = req.body;
  if (!content || typeof content !== 'string' || !content.trim() || content.length > 2000) {
    return res.status(400).json({ success: false, error: 'Message required (max 2000 chars)' });
  }
  const safeAttachments = Array.isArray(attachments)
    ? attachments.filter(a => a && typeof a.url === 'string' && typeof a.name === 'string').slice(0, 5)
    : [];

  const userId = req.params.userId;
  const adminName = req.session?.user?.displayName || req.session?.user?.username || 'Support';
  const SupportTicketMessageModel = require('../../models/supportTicketMessageModel');
  const SupportTopicModel = require('../../models/supportTopicModel');

  const saved = await SupportTicketMessageModel.create({
    userId,
    senderType: 'agent',
    senderName: adminName,
    content: content.trim(),
    attachments: safeAttachments,
  });

  await SupportTopicModel.updateLastMessage(userId);
  await SupportTopicModel.updateLastAgentMessage(userId);

  const topic = await SupportTopicModel.getByUserId(userId);
  if (topic && !topic.first_response_at) {
    await SupportTopicModel.updateFirstResponse(userId);
  }

  try {
    const io = require('../../services/socketSingleton').get();
    if (io && saved) {
      io.to(`user:${userId}`).emit('support:newMessage', {
        id: saved.id,
        sender_type: 'agent',
        sender_name: adminName,
        content: content.trim(),
        attachments: safeAttachments,
        created_at: saved.created_at || new Date().toISOString(),
      });
    }
  } catch (e) {
    logger.warn('Socket emit failed for support reply', { error: e.message });
  }

  try {
    const bot = require('../core/bot');
    if (bot?.telegram) {
      await bot.telegram.sendMessage(userId, `*Support Reply*\n\n${content.trim()}`, { parse_mode: 'Markdown' }).catch(() => {});
    }
  } catch (e) { /* user may have blocked bot */ }

  res.json({
    success: true,
    message: {
      id: saved.id,
      content: saved.content,
      senderRole: 'agent',
      senderName: adminName,
      attachments: safeAttachments,
      createdAt: saved.created_at || new Date().toISOString(),
    }
  });
}));

app.patch('/api/webapp/admin/support/tickets/:userId', adminGuard, asyncHandler(async (req, res) => {
  const SupportTopicModel = require('../../models/supportTopicModel');
  const userId = req.params.userId;
  const { status, priority, category } = req.body;

  let updated;
  if (status && ['open', 'resolved', 'closed'].includes(status)) {
    updated = await SupportTopicModel.updateStatus(userId, status);
    if (status === 'resolved' || status === 'closed') {
      await SupportTopicModel.updateResolutionTime(userId);
    }
    try {
      const io = require('../../services/socketSingleton').get();
      if (io) io.to(`user:${userId}`).emit('support:statusChange', { status });
    } catch {}
  }
  if (priority && ['low', 'medium', 'high', 'critical'].includes(priority)) {
    updated = await SupportTopicModel.updatePriority(userId, priority);
  }
  if (category) {
    updated = await SupportTopicModel.updateCategory(userId, category);
  }

  if (!updated) {
    return res.status(400).json({ success: false, error: 'No valid fields to update' });
  }

  res.json({
    success: true,
    ticket: {
      userId: updated.user_id,
      status: updated.status,
      priority: updated.priority,
      category: updated.category,
    }
  });
}));

// Quick Reply Templates — hardcoded, no DB needed
app.get('/api/webapp/admin/support/quick-replies', adminGuard, asyncHandler(async (req, res) => {
  const templates = [
    { id: 'payment_pending',      label: 'Payment Pending',       category: 'payment', body: 'Hi! We can see your payment is being processed. Crypto payments typically confirm within 10–30 minutes. You\'ll receive a notification as soon as it\'s confirmed. 🙏' },
    { id: 'payment_confirmed',    label: 'Payment Confirmed',     category: 'payment', body: 'Great news! Your payment has been confirmed and your access has been activated. Welcome to PNPtv PRIME! 🌟 If you have any questions, we\'re here to help.' },
    { id: 'refund_policy',        label: 'Refund Policy',         category: 'payment', body: 'Refunds are available within 24 hours of payment — including crypto. Please confirm you\'d like to proceed with the refund and we\'ll process it within 72 hours.' },
    { id: 'account_access',       label: 'Account Access Issue',  category: 'account', body: 'Let me look into your account access issue. Could you confirm the email address or Telegram username associated with your account?' },
    { id: 'activation_code',      label: 'Activation Code Help',  category: 'account', body: 'To redeem your activation code, go to pnptv.app/subscribe and scroll down to \'Have an activation code?\' — enter your code there. If you run into any issues, reply here with your code and we\'ll activate it manually.' },
    { id: 'technical_issue',      label: 'Technical Issue',       category: 'bug',     body: 'Thanks for reporting this! Could you tell us which device/browser you\'re using, and describe the exact steps to reproduce the issue? A screenshot would also help a lot.' },
    { id: 'closing_resolved',     label: 'Closing – Resolved',    category: 'general', body: 'I\'m glad we could help! I\'ll mark this ticket as resolved. If you need anything else, don\'t hesitate to reach out. Take care! 👋' },
    { id: 'closing_no_response',  label: 'Closing – No Response', category: 'general', body: 'We haven\'t heard back in a while, so we\'ll close this ticket for now. Feel free to open a new one if you need further assistance!' },
    { id: 'escalating',           label: 'Escalating to Team',    category: 'general', body: 'I\'m escalating this to our team for further review. We\'ll get back to you within 24 hours with an update. Thanks for your patience! 🙏' },
  ];
  res.json({ success: true, templates });
}));

// Plan Builder — create, list, update, deactivate plans with auto-derived metadata
const planBuilderController = require('./controllers/planBuilderController');
app.get('/api/webapp/admin/plans',        adminGuard, asyncHandler(planBuilderController.listPlans));
app.post('/api/webapp/admin/plans',       adminGuard, asyncHandler(planBuilderController.createPlan));
app.put('/api/webapp/admin/plans/:id',    adminGuard, asyncHandler(planBuilderController.updatePlan));
app.patch('/api/webapp/admin/plans/:id',  adminGuard, asyncHandler(planBuilderController.updatePlan));
app.delete('/api/webapp/admin/plans/:id', adminGuard, asyncHandler(planBuilderController.deactivatePlan));

// Add-ons catalog
app.get('/api/webapp/admin/add-ons',      adminGuard, asyncHandler(planBuilderController.listAddOns));
// Plan add-on mappings
app.get('/api/webapp/admin/plans/:planId/add-ons', adminGuard, asyncHandler(webappAdminController.getPlanAddOns));
app.put('/api/webapp/admin/plans/:planId/add-ons', adminGuard, asyncHandler(webappAdminController.setPlanAddOns));
// User entitlement management
app.get('/api/webapp/admin/users/:userId/entitlements', adminGuard, asyncHandler(webappAdminController.getUserEntitlements));
app.post('/api/webapp/admin/users/:userId/entitlements', adminGuard, asyncHandler(webappAdminController.grantUserEntitlement));
// One-shot plan assignment — grants all entitlements + syncs plan_id/plan_expiry/tier in one call.
app.post('/api/webapp/admin/users/:userId/assign-plan', adminGuard, asyncHandler(webappAdminController.assignUserPlan));
// Gift a plan to a user (free, immediate, tracked in gifts table)
app.post('/api/webapp/admin/users/:userId/gift-plan', adminGuard, asyncHandler(webappAdminController.giftUserPlan));
// Gift history
app.get('/api/webapp/admin/gifts', adminGuard, asyncHandler(webappAdminController.getAdminGifts));
// Resource picker for the admin scoped grant form. Returns channels, hangouts, or creators.
app.get('/api/webapp/admin/resources', adminGuard, asyncHandler(webappAdminController.searchResources));
app.delete('/api/webapp/admin/users/:userId/entitlements/:addOnId', adminGuard, asyncHandler(webappAdminController.revokeUserEntitlement));
app.put('/api/webapp/admin/users/:userId/entitlements/:addOnId/extend', adminGuard, asyncHandler(webappAdminController.extendUserEntitlement));
// Creator / Live Performer promotion
app.post('/api/webapp/admin/users/:userId/make-creator', adminGuard, asyncHandler(webappAdminController.makeCreator));
app.post('/api/webapp/admin/users/:userId/activate-creator', adminGuard, asyncHandler(webappAdminController.activateCreator));
app.delete('/api/webapp/admin/users/:userId/make-creator', adminGuard, asyncHandler(webappAdminController.revokeCreator));
// MeruLink admin
app.get('/api/webapp/admin/meru-links/stats', requireSessionAuth, adminGuard, asyncHandler(webappAdminController.meruLinkStats));
app.get('/api/webapp/admin/meru-links', requireSessionAuth, adminGuard, asyncHandler(webappAdminController.listMeruLinks));
app.post('/api/webapp/admin/meru-links', requireSessionAuth, adminGuard, asyncHandler(webappAdminController.addMeruLinks));
app.delete('/api/webapp/admin/meru-links/:id', requireSessionAuth, adminGuard, asyncHandler(webappAdminController.deleteMeruLink));
// Duplicate account management — superadmin only (merge/rename are destructive)
const duplicateAccountsController = require('./controllers/duplicateAccountsController');
app.get('/api/webapp/admin/duplicate-accounts',          superadminGuard, asyncHandler(duplicateAccountsController.listCandidates));
app.post('/api/webapp/admin/duplicate-accounts/preview', superadminGuard, asyncHandler(duplicateAccountsController.previewMerge));
app.post('/api/webapp/admin/duplicate-accounts/merge',   superadminGuard, asyncHandler(duplicateAccountsController.mergeDuplicates));
app.post('/api/webapp/admin/duplicate-accounts/rename',  superadminGuard, asyncHandler(duplicateAccountsController.renameTelegramId));
// User-facing entitlements
app.get('/api/webapp/my-entitlements', requireSessionAuth, asyncHandler(webappAdminController.getMyEntitlements));
// Structured access map for the My Access page (joined with channel/hangout/creator metadata)
app.get('/api/me/access', requireSessionAuth, asyncHandler(webappAdminController.getMyAccess));

// Admin push broadcast
app.post('/api/webapp/admin/notifications/push', adminGuard, asyncHandler(webappAdminController.sendPushNotification));

// Admin Telegram broadcast — send a message to all bot users
// Body: { message: string, messageEs?: string }
// messageEs is optional; if provided, users with language='es' get the Spanish version
app.post('/api/webapp/admin/broadcast/telegram', adminGuard, asyncHandler(async (req, res) => {
  const { message, messageEs } = req.body;
  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'message is required' });
  }

  const bot = require('../core/bot');
  if (!bot?.telegram) {
    return res.status(503).json({ error: 'Bot not available' });
  }

  const pool = getPool();
  const result = await pool.query("SELECT id, language FROM users WHERE id != '1087968824'");
  const users = result.rows;

  let sent = 0, failed = 0;
  for (const user of users) {
    try {
      const text = (messageEs && user.language === 'es') ? messageEs : message;
      await bot.telegram.sendMessage(user.id, text, { parse_mode: 'Markdown' });
      sent++;
      await new Promise(r => setTimeout(r, 50));
    } catch (e) {
      failed++;
    }
  }

  logger.info(`Telegram broadcast completed: ${sent} sent, ${failed} failed`);
  res.json({ success: true, total: users.length, sent, failed });
}));

// POST /api/webapp/admin/notifications/digest/test — trigger digest email for a user (SMTP test)
app.post('/api/webapp/admin/notifications/digest/test', adminGuard, asyncHandler(async (req, res) => {
  const { userId } = req.body;
  const targetUserId = userId || req.session.user.id;
  const digestScheduler = require('../../services/notificationDigestScheduler');
  const result = await digestScheduler.sendDigestForUser(targetUserId);
  return res.json({ success: true, result });
}));

// Push subscription management (any authenticated user)
app.post('/api/webapp/push/subscribe', requireSessionAuth, asyncHandler(webappAdminController.subscribePush));
app.delete('/api/webapp/push/unsubscribe', requireSessionAuth, asyncHandler(webappAdminController.unsubscribePush));
app.get('/api/webapp/push/vapid-key', asyncHandler(webappAdminController.getVapidKey));

// PRIME Channel Mirror Admin Routes
const PrimeMirrorController = require('./controllers/primeMirrorController');
app.get('/api/webapp/admin/prime-mirror/status', adminGuard, asyncHandler(PrimeMirrorController.getStatus));
app.post('/api/webapp/admin/prime-mirror/toggle', adminGuard, asyncHandler(PrimeMirrorController.toggleMirror));
app.get('/api/webapp/admin/prime-mirror/log', adminGuard, asyncHandler(PrimeMirrorController.getMigrationLog));

app.get('/api/prime/latest', asyncHandler(primeController.getLatestPrimeVideo));
app.get('/api/hangouts/most-active', (req, res) => res.json({ success: true, data: { title: 'Community Hangout', currentParticipants: 0, link: '/hangouts' } }));

// Live streaming endpoint for featured content
app.get('/api/livestream/active', asyncHandler(async (req, res) => {
  const LiveStreamModel = require('../../models/liveStreamModel');
  try {
    const streams = await LiveStreamModel.getActiveStreams(1);
    const stream = streams.length > 0 ? streams[0] : null;
    res.json({ success: true, data: stream });
  } catch (error) {
    logger.error('getActiveLiveStream error:', error);
    res.status(500).json({ error: 'Failed to load live streams' });
  }
}));

// ==========================================
// Media & Radio Admin Routes
// ==========================================
const mediaAdminController = require('./controllers/mediaAdminController');

// Media library management
app.get('/api/admin/media/library', verifyAdminJWT, asyncHandler(mediaAdminController.getMediaLibrary));
app.get('/api/admin/media/categories', verifyAdminJWT, asyncHandler(mediaAdminController.getCategories));
app.post('/api/admin/media/upload', verifyAdminJWT, mediaAdminController.uploadMedia);
app.put('/api/admin/media/:mediaId', verifyAdminJWT, asyncHandler(mediaAdminController.updateMedia));
app.delete('/api/admin/media/:mediaId', verifyAdminJWT, asyncHandler(mediaAdminController.deleteMedia));

// Radio now playing
app.get('/api/admin/radio/now-playing', verifyAdminJWT, asyncHandler(mediaAdminController.getNowPlaying));
app.post('/api/admin/radio/now-playing', verifyAdminJWT, asyncHandler(mediaAdminController.setNowPlaying));

// Radio queue management
app.get('/api/admin/radio/queue', verifyAdminJWT, asyncHandler(mediaAdminController.getQueue));
app.post('/api/admin/radio/queue', verifyAdminJWT, asyncHandler(mediaAdminController.addToQueue));
app.delete('/api/admin/radio/queue/:queueId', verifyAdminJWT, asyncHandler(mediaAdminController.removeFromQueue));
app.post('/api/admin/radio/queue/clear', verifyAdminJWT, asyncHandler(mediaAdminController.clearQueue));

// Radio requests management
app.get('/api/admin/radio/requests', verifyAdminJWT, asyncHandler(mediaAdminController.getRequests));
app.put('/api/admin/radio/requests/:requestId', verifyAdminJWT, asyncHandler(mediaAdminController.updateRequest));


// ─── Media Library Video Management ─────────

// GET /api/webapp/admin/media-library/videos — List all videos from media_library
app.get('/api/webapp/admin/media-library/videos', adminGuard, asyncHandler(async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.query(
      `SELECT id, title, artist, url, type, category, cover_url, duration, is_prime, is_public,
              ampache_song_id, created_at, updated_at
       FROM media_library
       WHERE type = 'video'
       ORDER BY created_at DESC`
    );
    return res.json({ success: true, videos: result.rows });
  } catch (error) {
    logger.error('media-library/videos list error', { error: error.message });
    return res.status(500).json({ success: false, error: 'Failed to fetch media library videos' });
  }
}));

// PUT /api/webapp/admin/media-library/:id/prime — Toggle is_prime for a media_library record
app.put('/api/webapp/admin/media-library/:id/prime', adminGuard, asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;
    const { is_prime } = req.body;
    if (typeof is_prime !== 'boolean') {
      return res.status(400).json({ success: false, error: 'is_prime must be a boolean' });
    }
    const pool = getPool();
    const result = await pool.query(
      `UPDATE media_library SET is_prime = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING id, title, artist, url, type, category, is_prime, is_public, created_at, updated_at`,
      [is_prime, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Media library record not found' });
    }
    return res.json({ success: true, video: result.rows[0] });
  } catch (error) {
    logger.error('media-library/:id/prime error', { error: error.message });
    return res.status(500).json({ success: false, error: 'Failed to update prime status' });
  }
}));

// ==========================================
// Role-Based Access Control (RBAC) Routes
// ==========================================
// superadminGuard is imported at the top of this file alongside adminGuard
const roleController = require('./controllers/roleController');
const auditLogController = require('./controllers/auditLogController');
// Note: auditLog middleware is registered earlier (after /api/admin/check) to cover
// all /api/admin/* routes from the start. No duplicate app.use needed here.

// Role Management Endpoints
app.put('/api/admin/users/role', adminGuard, asyncHandler((req, res) => roleController.assignRole(req, res)));
app.post('/api/admin/users/:id/role', adminGuard, asyncHandler((req, res) => roleController.assignRole(req, res)));
app.delete('/api/admin/users/:id/role', superadminGuard, asyncHandler((req, res) => roleController.removeRole(req, res)));
app.get('/api/admin/users/:id/roles', adminGuard, asyncHandler((req, res) => roleController.getUserRoles(req, res)));
app.get('/api/admin/roles', adminGuard, asyncHandler((req, res) => roleController.listRoles(req, res)));
app.get('/api/admin/permissions', adminGuard, asyncHandler((req, res) => roleController.getPermissions(req, res)));
app.get('/api/admin/permissions/check', adminGuard, asyncHandler((req, res) => roleController.checkPermission(req, res)));
app.get('/api/admin/users', adminGuard, asyncHandler((req, res) => roleController.filterUsersByRole(req, res)));

// Audit Log Endpoints
app.get('/api/admin/audit-logs', adminGuard, asyncHandler((req, res) => auditLogController.getAuditLogs(req, res)));
app.get('/api/admin/audit-logs/resource', adminGuard, asyncHandler((req, res) => auditLogController.getResourceHistory(req, res)));

// ==========================================
// Social, DM, Chat, Users API Routes
// ==========================================
const chatController = require('./controllers/chatController');
const chatMediaController = require('./controllers/chatMediaController');
const hangoutGroupController = require('./controllers/hangoutGroupController');
const hangoutMediaController = require('./controllers/hangoutMediaController');
// hangoutVideoCallRoutes + hangoutVideoCallController removed — calls use Telegram native
const dmController = require('./controllers/dmController');
const socialController = require('./controllers/socialController');
const promotedPostController = require('./controllers/promotedPostController');
const contentFeedSyncController = require('./controllers/contentFeedSyncController');
const usersController = require('./controllers/usersController');

// ── Community Chat (REST fallback + media) ──────────────────────────────────
app.get('/api/webapp/chat/:room/history', requireSessionAuth, asyncHandler(chatController.getChatHistory));
app.post('/api/webapp/chat/:room/send', requireSessionAuth, asyncHandler(chatController.sendMessage));
// Media upload for community chat rooms (images 20 MB / videos 100 MB)
app.post(
  '/api/webapp/chat/:room/media',
  requireSessionAuth,
  uploadLimiter,
  uploadChatMedia,
  asyncHandler(chatController.sendMediaMessage)
);

// ── Hangout Groups ───────────────────────────────────────────────────────────
app.get('/api/webapp/hangouts/groups', requireSessionAuth, asyncHandler(hangoutGroupController.listGroups));

// Wellness hangouts — surfaces only is_wellness=true groups. Used by the
// wellness shell when wellness-mode is active (the regular /hangouts/groups
// endpoint would be blocked by the wellness guard for non-allowlisted paths).
app.get('/api/webapp/hangouts/wellness', requireSessionAuth, asyncHandler(async (req, res) => {
  const { query: q } = require('../../config/postgres');
  const { rows } = await q(`
    SELECT g.id, g.name, g.description, g.avatar_url, g.is_public, g.is_paid,
           g.created_at,
           (SELECT COUNT(*)::int FROM hangout_group_members m WHERE m.group_id = g.id) AS member_count
    FROM hangout_groups g
    WHERE g.is_wellness = true
    ORDER BY g.created_at ASC
  `);
  return res.json({ success: true, groups: rows });
}));

// Wellness Mode — self-imposed access restriction.
const WellnessModeService = require('../../services/wellnessModeService');
app.get('/api/webapp/wellness-mode', requireSessionAuth, asyncHandler(async (req, res) => {
  const status = await WellnessModeService.getStatus(req.session.user.id);
  return res.json({ success: true, ...status, coolingOffHours: WellnessModeService.COOLING_OFF_HOURS });
}));

app.post('/api/webapp/wellness-mode/enable', requireSessionAuth, asyncHandler(async (req, res) => {
  const raw = req.body?.durationDays;
  // null/undefined = indefinite. String forms allowed for forgiving frontend behavior.
  let durationDays = null;
  if (raw !== null && raw !== undefined && raw !== 'indefinite') {
    durationDays = parseInt(raw, 10);
    if (isNaN(durationDays)) {
      return res.status(400).json({ error: 'durationDays must be 1, 7, 30, or null (indefinite).' });
    }
  }
  const status = await WellnessModeService.enable(req.session.user.id, durationDays);
  return res.json({ success: true, ...status });
}));

app.post('/api/webapp/wellness-mode/disable', requireSessionAuth, asyncHandler(async (req, res) => {
  const status = await WellnessModeService.disable(req.session.user.id);
  return res.json({ success: true, ...status });
}));

app.post('/api/webapp/wellness-mode/cancel-disable', requireSessionAuth, asyncHandler(async (req, res) => {
  const status = await WellnessModeService.cancelDisable(req.session.user.id);
  return res.json({ success: true, ...status });
}));

// Use Tracker — private harm-reduction log (slam / smoke)
function buildUseTypeStats(entries, type) {
  const typed = entries.filter(r => r.type === type);
  const now = new Date();
  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const today = typed.filter(r => new Date(r.logged_at) >= todayStart).length;
  const week  = typed.filter(r => new Date(r.logged_at) >= weekAgo).length;
  const month = typed.length;
  const lastAt = typed.length > 0 ? typed[0].logged_at : null;
  const recentDays = Array.from({ length: 30 }, (_, i) => {
    const dayStart = new Date(todayStart.getTime() - i * 86400000);
    const dayEnd   = new Date(dayStart.getTime() + 86400000);
    return typed.some(r => { const t = new Date(r.logged_at); return t >= dayStart && t < dayEnd; });
  });
  return { lastAt, today, week, month, recentDays };
}

app.get('/api/webapp/use-tracker', requireSessionAuth, asyncHandler(async (req, res) => {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT type, logged_at FROM use_tracker_logs
     WHERE user_id = $1 AND logged_at >= NOW() - INTERVAL '30 days'
     ORDER BY logged_at DESC`,
    [req.session.user.id]
  );
  return res.json({ success: true, slam: buildUseTypeStats(rows, 'slam'), smoke: buildUseTypeStats(rows, 'smoke') });
}));

app.post('/api/webapp/use-tracker/log', requireSessionAuth, asyncHandler(async (req, res) => {
  const { type } = req.body;
  if (type !== 'slam' && type !== 'smoke') return res.status(400).json({ success: false, error: 'Invalid type' });
  const pool = getPool();
  await pool.query('INSERT INTO use_tracker_logs (user_id, type) VALUES ($1, $2)', [req.session.user.id, type]);
  const { rows } = await pool.query(
    `SELECT type, logged_at FROM use_tracker_logs
     WHERE user_id = $1 AND logged_at >= NOW() - INTERVAL '30 days'
     ORDER BY logged_at DESC`,
    [req.session.user.id]
  );
  return res.json({ success: true, slam: buildUseTypeStats(rows, 'slam'), smoke: buildUseTypeStats(rows, 'smoke') });
}));

app.post('/api/webapp/hangouts/groups', requireSessionAuth, asyncHandler(hangoutGroupController.createGroup));


// Discover must be before /:id to avoid route collision
app.get('/api/webapp/hangouts/groups/discover', requireSessionAuth, asyncHandler(hangoutGroupController.discoverGroups));
// join-by-invite must be before /:id to avoid :code being captured as :id
app.post('/api/webapp/hangouts/groups/join-by-invite/:code', requireSessionAuth, asyncHandler(hangoutGroupController.joinByInvite));
app.get('/api/webapp/hangouts/groups/:id', requireSessionAuth, asyncHandler(hangoutGroupController.getGroup));
app.post('/api/webapp/hangouts/groups/:id/join', requireSessionAuth, requireHangoutAccess, asyncHandler(hangoutGroupController.joinGroup));
app.post('/api/webapp/hangouts/groups/:id/leave', requireSessionAuth, asyncHandler(hangoutGroupController.leaveGroup));
app.delete('/api/webapp/hangouts/groups/:id', requireSessionAuth, asyncHandler(hangoutGroupController.deleteGroup));
app.patch('/api/webapp/hangouts/groups/:id', requireSessionAuth, asyncHandler(hangoutGroupController.updateGroup));
app.post('/api/webapp/hangouts/groups/:id/avatar', requireSessionAuth, uploadLimiter, hangoutAvatarUpload.single('avatar'), verifyMagicBytes(IMAGE_MIMES), asyncHandler(hangoutGroupController.updateGroupAvatar));
app.post('/api/webapp/hangouts/groups/:id/kick', requireSessionAuth, requireHangoutAccess, asyncHandler(hangoutGroupController.kickMember));
app.post('/api/webapp/hangouts/groups/:id/members/:userId/role', requireSessionAuth, requireHangoutAccess, asyncHandler(hangoutGroupController.updateMemberRole));
// Join requests for private groups
app.post('/api/webapp/hangouts/groups/:id/request-join', requireSessionAuth, asyncHandler(hangoutGroupController.requestJoinGroup));
app.get('/api/webapp/hangouts/groups/:id/requests', requireSessionAuth, asyncHandler(hangoutGroupController.getJoinRequests));
app.post('/api/webapp/hangouts/groups/:id/requests/:requestId/:action', requireSessionAuth, asyncHandler(hangoutGroupController.handleJoinRequest));

// ── Hangout Group Chat — open to all authenticated users ─────────────────────
app.get('/api/webapp/hangouts/groups/:id/messages', requireSessionAuth, requireHangoutAccess, asyncHandler(hangoutGroupController.getMessages));
// search MUST be registered before /:msgId routes so "search" is not parsed as a msgId
app.get('/api/webapp/hangouts/groups/:id/messages/search', requireSessionAuth, requireHangoutAccess, asyncHandler(hangoutGroupController.searchMessages));
app.patch('/api/webapp/hangouts/groups/:id/messages/:msgId', requireSessionAuth, requireHangoutAccess, asyncHandler(hangoutGroupController.editMessage));
app.delete('/api/webapp/hangouts/groups/:id/messages/:msgId', requireSessionAuth, requireHangoutAccess, asyncHandler(hangoutGroupController.deleteMessage));
app.post('/api/webapp/hangouts/groups/:id/messages/:msgId/react', requireSessionAuth, requireHangoutAccess, asyncHandler(hangoutGroupController.toggleReaction));
app.post('/api/webapp/hangouts/groups/:id/link-telegram', requireSessionAuth, asyncHandler(hangoutGroupController.linkTelegramGroup));
app.post('/api/webapp/hangouts/groups/:id/unlink-telegram', requireSessionAuth, asyncHandler(hangoutGroupController.unlinkTelegramGroup));
app.get('/api/webapp/hangouts/groups/:id/video-chat-status', requireSessionAuth, asyncHandler(hangoutGroupController.getVideoChatStatus));
app.get('/api/webapp/hangouts/groups/:id/messages/:msgId/reactions', requireSessionAuth, requireHangoutAccess, asyncHandler(hangoutGroupController.getReactions));
app.post('/api/webapp/hangouts/groups/:id/messages', requireSessionAuth, requireHangoutAccess, asyncHandler(hangoutGroupController.sendMessage));
// Media upload for hangout group chat (images 10 MB / videos 50 MB, per-hangout dirs)
app.post(
  '/api/webapp/hangouts/groups/:id/media',
  requireSessionAuth,
  requireHangoutAccess,
  uploadLimiter,
  uploadHangoutMedia,
  asyncHandler(hangoutMediaController.uploadHangoutMedia)
);
// Mark group messages as read
app.post('/api/webapp/hangouts/groups/:id/read', requireSessionAuth, requireHangoutAccess, asyncHandler(hangoutGroupController.markAsRead));
// Per-user thread state: pin, user-mute, message-read cursor, forward
app.put('/api/webapp/hangouts/groups/:id/pin', requireSessionAuth, asyncHandler(hangoutGroupController.pinGroup));
app.put('/api/webapp/hangouts/groups/:id/mute', requireSessionAuth, asyncHandler(hangoutGroupController.muteGroupForUser));
app.put('/api/webapp/hangouts/groups/:id/read-message', requireSessionAuth, asyncHandler(hangoutGroupController.markMessageRead));
app.post('/api/webapp/hangouts/messages/:messageId/forward', requireSessionAuth, asyncHandler(hangoutGroupController.forwardMessage));
// Hangout group management (kick is registered above at line 4268 — duplicate removed)
app.post('/api/webapp/hangouts/groups/:id/ban', requireSessionAuth, requireHangoutAccess, asyncHandler(hangoutGroupController.banMember));
app.post('/api/webapp/hangouts/groups/:id/unban', requireSessionAuth, requireHangoutAccess, asyncHandler(hangoutGroupController.unbanMember));
app.post('/api/webapp/hangouts/groups/:id/mute', requireSessionAuth, requireHangoutAccess, asyncHandler(hangoutGroupController.muteMember));
app.post('/api/webapp/hangouts/groups/:id/unmute', requireSessionAuth, requireHangoutAccess, asyncHandler(hangoutGroupController.unmuteMember));
app.post('/api/webapp/hangouts/groups/:id/promote', requireSessionAuth, requireHangoutAccess, asyncHandler(hangoutGroupController.promoteMember));
app.post('/api/webapp/hangouts/groups/:id/demote', requireSessionAuth, requireHangoutAccess, asyncHandler(hangoutGroupController.demoteMember));
app.get('/api/webapp/hangouts/groups/:id/moderation/audit', requireSessionAuth, asyncHandler(hangoutGroupController.getModerationAudit));
app.post('/api/webapp/hangouts/groups/:id/pin', requireSessionAuth, asyncHandler(hangoutGroupController.pinMessage));
app.delete('/api/webapp/hangouts/groups/:id/pin/:eventId', requireSessionAuth, asyncHandler(hangoutGroupController.unpinMessage));
app.get('/api/webapp/hangouts/groups/:id/pins', requireSessionAuth, asyncHandler(hangoutGroupController.getPinnedMessages));
app.put('/api/webapp/hangouts/groups/:id/settings', requireSessionAuth, requireHangoutAccess, asyncHandler(hangoutGroupController.updateGroupSettings));
app.post('/api/webapp/hangouts/groups/:id/transfer', requireSessionAuth, requireHangoutAccess, asyncHandler(hangoutGroupController.transferOwnership));
app.post('/api/webapp/hangouts/groups/:id/notify-online', requireSessionAuth, asyncHandler(hangoutGroupController.notifyOnlineMembers));
app.get('/api/webapp/hangouts/groups/:id/invite-link', requireSessionAuth, asyncHandler(hangoutGroupController.getInviteLink));
app.put('/api/webapp/hangouts/groups/:id/notification', requireSessionAuth, asyncHandler(hangoutGroupController.updateNotificationMode));
app.post('/api/webapp/hangouts/groups/:id/delete-message', requireSessionAuth, requireHangoutAccess, asyncHandler(hangoutGroupController.adminDeleteMessage));
// ── Hangout Feed Integration ────────────────────────────────────────────────
app.get('/api/webapp/hangouts/groups/:id/feed', requireSessionAuth, asyncHandler(socialController.getHangoutFeed));
app.post('/api/webapp/hangouts/groups/:id/drop-to-feed', requireSessionAuth, asyncHandler(socialController.dropToFeed));

// Hangout video calls — LiveKit
const { startCall, joinCall, endCall, leaveCall, refreshCallToken, muteCallParticipant, kickCallParticipant } = require('./controllers/hangoutGroupController');
app.post('/api/webapp/hangouts/groups/:id/calls', requireSessionAuth, asyncHandler(startCall));
app.post('/api/webapp/hangouts/groups/:id/call/start', requireSessionAuth, asyncHandler(startCall));
app.post('/api/webapp/hangouts/groups/:id/call/join', requireSessionAuth, asyncHandler(joinCall));
app.post('/api/webapp/hangouts/groups/:id/call/end', requireSessionAuth, asyncHandler(endCall));
app.post('/api/webapp/hangouts/groups/:id/call/leave', requireSessionAuth, asyncHandler(leaveCall));
app.post('/api/webapp/hangouts/groups/:id/call/token/refresh', requireSessionAuth, asyncHandler(refreshCallToken));
app.post('/api/webapp/hangouts/groups/:id/call/mute-participant', requireSessionAuth, asyncHandler(muteCallParticipant));
app.post('/api/webapp/hangouts/groups/:id/call/kick-participant', requireSessionAuth, asyncHandler(kickCallParticipant));

// DM Video Calls — removed (dead code, never called from frontend)

// ── DM Media ────────────────────────────────────────────────────────────────
// Send an image or video as a direct message
app.post(
  '/api/webapp/dm/media/:recipientId',
  requireSessionAuth,
  uploadLimiter,
  uploadChatMedia,
  asyncHandler(chatMediaController.sendDmMediaMessage)
);

// Nearby (webapp session-auth proxy)
app.post('/api/webapp/nearby/update-location', asyncHandler(async (req, res) => {
  const user = req.session?.user;
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  req.user = { id: user.id, userId: user.id };
  return NearbyController.updateLocation(req, res);
}));
app.get('/api/webapp/nearby/search', asyncHandler(async (req, res) => {
  const user = req.session?.user;
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  req.user = { id: user.id, userId: user.id };
  return NearbyController.searchNearby(req, res);
}));
app.get('/api/webapp/nearby/distance/:userId', asyncHandler(async (req, res) => {
  const user = req.session?.user;
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  req.user = { id: user.id, userId: user.id };
  return NearbyController.getDistanceToUser(req, res);
}));
app.get('/api/webapp/nearby/places', asyncHandler(async (req, res) => {
  const user = req.session?.user;
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  req.user = { id: user.id, userId: user.id };
  return NearbyController.searchNearbyPlaces(req, res);
}));

// Fallback places — nearest 1-5 approved places regardless of radius (so map is never empty)
app.get('/api/webapp/nearby/places/fallback', asyncHandler(async (req, res) => {
  const user = req.session?.user;
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const lat = parseFloat(req.query.lat);
  const lng = parseFloat(req.query.lng);
  if (isNaN(lat) || isNaN(lng)) return res.status(400).json({ error: 'lat/lng required' });
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return res.status(400).json({ error: 'Invalid coordinates' });
  const pool = getPool();
  const { rows } = await pool.query(`
    SELECT id, name, description, address, city, country, place_type,
           location_lat, location_lng, category_id,
           (6371 * acos(
             cos(radians($1)) * cos(radians(location_lat)) *
             cos(radians(location_lng) - radians($2)) +
             sin(radians($1)) * sin(radians(location_lat))
           )) AS dist_km
    FROM nearby_places
    WHERE status = 'approved'
      AND location_lat IS NOT NULL AND location_lng IS NOT NULL
    ORDER BY dist_km ASC
    LIMIT 5
  `, [lat, lng]);
  return res.json({ places: rows.map(p => ({
    id: p.id, name: p.name, description: p.description,
    address: p.address, city: p.city, country: p.country,
    placeType: p.place_type, categoryId: p.category_id,
    location: { lat: parseFloat(p.location_lat), lng: parseFloat(p.location_lng) },
    distance: parseFloat(p.dist_km),
    isFallback: true,
  })), fallback: true });
}));

// Submit a new place
app.post('/api/webapp/nearby/places/submit', asyncHandler(async (req, res) => {
  const user = req.session?.user;
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const { name, description, address, city, country, categoryId, placeType, lat, lng, phone, website, instagram } = req.body;
  const submitKey = `ratelimit:place_submit:${user.id}`;
  const submitCount = await redisClient.incr(submitKey);
  if (submitCount === 1) await redisClient.expire(submitKey, 3600);
  if (submitCount > 5) return res.status(429).json({ error: 'Too many submissions. Try again later.' });
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });
  if (!placeType) return res.status(400).json({ error: 'Place type is required' });
  const VALID_PLACE_TYPES = ['establishment', 'cruising', 'sauna', 'bar', 'community', 'hotel', 'help_center', 'wellness', 'club', 'bath_house'];
  if (!VALID_PLACE_TYPES.includes(placeType)) return res.status(400).json({ error: 'Invalid place type' });
  if (website && !/^https?:\/\//i.test(website.trim())) return res.status(400).json({ error: 'Website must start with http:// or https://' });
  const pool = getPool();
  await pool.query(`
    INSERT INTO nearby_place_submissions
      (submitted_by_user_id, name, description, address, city, country,
       category_id, place_type, location_lat, location_lng, phone, website, instagram)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
  `, [
    user.id, name.trim().slice(0,200), description?.trim().slice(0,1000) || null,
    address?.trim().slice(0,500) || null, city?.trim().slice(0,100) || null,
    country?.trim().slice(0,100) || null, categoryId || null, placeType,
    lat || null, lng || null, phone?.trim().slice(0,50) || null,
    website?.trim().slice(0,500) || null, instagram?.trim().slice(0,100) || null,
  ]);
  return res.json({ success: true, message: 'Place submitted for review!' });
}));

// Get current user's favorited place IDs
app.get('/api/webapp/nearby/places/favorites', asyncHandler(async (req, res) => {
  const user = req.session?.user;
  if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });
  const userId = parseInt(user.id, 10);
  if (isNaN(userId)) return res.json({ success: true, placeIds: [] });
  const pool = getPool();
  const { rows } = await pool.query(
    'SELECT place_id FROM user_place_favorites WHERE user_id = $1',
    [userId]
  );
  return res.json({ success: true, placeIds: rows.map(r => r.place_id) });
}));

// Toggle favorite on a place
app.post('/api/webapp/nearby/places/:id/favorite', asyncHandler(async (req, res) => {
  const user = req.session?.user;
  if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });
  const userId = parseInt(user.id, 10);
  if (isNaN(userId)) return res.status(400).json({ success: false, error: 'Invalid user' });
  const placeId = parseInt(req.params.id, 10);
  if (isNaN(placeId)) return res.status(400).json({ success: false, error: 'Invalid place' });
  const pool = getPool();
  const existing = await pool.query(
    'SELECT 1 FROM user_place_favorites WHERE user_id = $1 AND place_id = $2',
    [userId, placeId]
  );
  if (existing.rows.length > 0) {
    await pool.query('DELETE FROM user_place_favorites WHERE user_id = $1 AND place_id = $2', [userId, placeId]);
    return res.json({ success: true, favorited: false });
  } else {
    await pool.query('INSERT INTO user_place_favorites (user_id, place_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [userId, placeId]);
    return res.json({ success: true, favorited: true });
  }
}));

// Track a place view
app.post('/api/webapp/nearby/places/:id/view', asyncHandler(async (req, res) => {
  const user = req.session?.user;
  if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });
  const placeId = parseInt(req.params.id, 10);
  if (isNaN(placeId)) return res.status(400).json({ success: false, error: 'Invalid place' });
  const pool = getPool();
  await pool.query(
    'UPDATE nearby_places SET view_count = COALESCE(view_count, 0) + 1 WHERE id = $1',
    [placeId]
  );
  return res.json({ success: true });
}));

// Report a place
app.post('/api/webapp/nearby/places/:id/report', asyncHandler(async (req, res) => {
  const user = req.session?.user;
  if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });
  const placeId = parseInt(req.params.id, 10);
  if (isNaN(placeId)) return res.status(400).json({ success: false, error: 'Invalid place' });
  const VALID_TYPES = ['closed', 'incorrect_info', 'inappropriate', 'spam', 'other'];
  const reportType = VALID_TYPES.includes(req.body?.reportType) ? req.body.reportType : 'other';
  const pool = getPool();
  await pool.query(
    `INSERT INTO nearby_place_reports (place_id, user_id, report_type, description)
     VALUES ($1, $2, $3, $4)`,
    [placeId, user.id, reportType, req.body?.description?.slice(0, 500) || null]
  );
  return res.json({ success: true });
}));

// Context-aware nearby endpoints (session-auth required)
app.get('/api/webapp/nearby/feed-posters', requireSessionAuth, asyncHandler((req, res) => NearbyController.feedPosters(req, res)));
app.get('/api/webapp/nearby/hangout-members/:groupId', requireSessionAuth, asyncHandler((req, res) => NearbyController.hangoutMembers(req, res)));
app.get('/api/webapp/nearby/stream-viewers/:streamId', requireSessionAuth, asyncHandler((req, res) => NearbyController.streamViewers(req, res)));
app.get('/api/webapp/nearby/event-attendees/:eventId', requireSessionAuth, asyncHandler((req, res) => NearbyController.eventAttendees(req, res)));
app.get('/api/webapp/nearby/all-users', requireSessionAuth, asyncHandler((req, res) => NearbyController.allUsers(req, res)));
app.get('/api/webapp/nearby/online-users', requireSessionAuth, asyncHandler((req, res) => NearbyController.onlineUsers(req, res)));

// Referral: get my code + stats
app.get('/api/webapp/me/referral', asyncHandler(async (req, res) => {
  const user = req.session?.user;
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const stats = await referralService.getReferralStats(user.id);
  return res.json({ ...stats, link: `https://app.pnptv.app/join?ref=${stats.code}` });
}));

app.get('/api/webapp/me/referral/list', asyncHandler(async (req, res) => {
  const user = req.session?.user;
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const list = await referralService.getReferralList(user.id);
  return res.json({ success: true, list });
}));

// Referral: redeem a code (called on register)
app.post('/api/webapp/referral/redeem', asyncHandler(async (req, res) => {
  const user = req.session?.user;
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'Code required' });
  const redeemKey = `ratelimit:referral_redeem:${user.id}`;
  const redeemCount = await redisClient.incr(redeemKey);
  if (redeemCount === 1) await redisClient.expire(redeemKey, 3600);
  if (redeemCount > 3) return res.status(429).json({ error: 'Too many attempts. Try again later.' });
  const refereeIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || null;
  const result = await referralService.redeemReferral(code, user.id, refereeIp);
  return res.json(result);
}));

// Admin: referrals dashboard
app.get('/api/webapp/admin/referrals', requireSessionAuth, adminGuard, asyncHandler(async (req, res) => {
  const page   = Math.max(1, parseInt(req.query.page  || '1', 10));
  const limit  = Math.min(200, Math.max(1, parseInt(req.query.limit || '50', 10)));
  const offset = (page - 1) * limit;
  const status = req.query.status || 'all';
  const search = (req.query.search || '').trim();

  // Aggregate stats
  const { rows: statsRows } = await query(
    `SELECT
       COUNT(*)                                              AS total,
       COUNT(*) FILTER (WHERE status = 'completed')         AS completed,
       COUNT(*) FILTER (WHERE status = 'pending')           AS pending,
       COALESCE(SUM(reward_tokens) FILTER (WHERE status = 'completed'), 0) AS total_tokens,
       COUNT(DISTINCT referrer_id)                          AS unique_referrers
     FROM referrals`
  );
  const stats = {
    total:           parseInt(statsRows[0].total, 10),
    completed:       parseInt(statsRows[0].completed, 10),
    pending:         parseInt(statsRows[0].pending, 10),
    totalTokensPaidOut: parseInt(statsRows[0].total_tokens, 10),
    uniqueReferrers: parseInt(statsRows[0].unique_referrers, 10),
  };

  // Build dynamic WHERE clause
  const conditions = [];
  const params = [];
  if (status !== 'all') {
    params.push(status);
    conditions.push(`r.status = $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    const idx = params.length;
    conditions.push(`(ru.username ILIKE $${idx} OR ee.username ILIKE $${idx})`);
  }
  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  // Count for pagination
  const countSql = `
    SELECT COUNT(*) AS cnt
    FROM referrals r
    LEFT JOIN users ru ON ru.id = r.referrer_id
    LEFT JOIN users ee ON ee.id = r.referee_id
    ${whereClause}
  `;
  const { rows: countRows } = await query(countSql, params);
  const totalRows = parseInt(countRows[0].cnt, 10);

  // Paginated rows
  const rowsSql = `
    SELECT
      ru.username   AS referrer_username,
      ee.username   AS referee_username,
      r.code,
      r.status,
      r.reward_tokens,
      r.created_at,
      r.completed_at,
      r.referee_ip
    FROM referrals r
    LEFT JOIN users ru ON ru.id = r.referrer_id
    LEFT JOIN users ee ON ee.id = r.referee_id
    ${whereClause}
    ORDER BY r.created_at DESC
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}
  `;
  const { rows } = await query(rowsSql, [...params, limit, offset]);

  return res.json({
    success: true,
    stats,
    rows,
    total: totalRows,
    page,
    pages: Math.ceil(totalRows / limit),
  });
}));

// Admin: trigger Cristina neighbor DM campaign
app.post('/api/webapp/admin/cristina/neighbor-dm', adminGuard, asyncHandler(async (req, res) => {
  const lockKey = 'admin:script:lock:cristina-neighbor-dm';
  const locked = await redisClient.set(lockKey, '1', 'EX', 300, 'NX');
  if (!locked) return res.status(409).json({ error: 'Script already running. Try again later.' });
  const { execFile } = require('child_process');
  const scriptPath = require('path').join(__dirname, '../../../scripts/cristinaNeighborDM.js');
  // execFile (vs exec) avoids shell interpretation. Bounded buffer so a
  // runaway script can't OOM the bot via stdout buffering.
  execFile('node', [scriptPath], { maxBuffer: 512 * 1024 }, (err, stdout, stderr) => {
    if (err) logger.error('cristinaNeighborDM script error', { err: err.message });
    if (stderr) logger.warn('cristinaNeighborDM stderr', { stderr: String(stderr).slice(0, 500) });
  });
  return res.json({ success: true, message: 'Cristina neighbor DM campaign started in background' });
}));

// Admin: revoke unused free trials
app.post('/api/webapp/admin/trials/revoke-unused', adminGuard, asyncHandler(async (req, res) => {
  const lockKey = 'admin:script:lock:revoke-trials';
  const locked = await redisClient.set(lockKey, '1', 'EX', 300, 'NX');
  if (!locked) return res.status(409).json({ error: 'Script already running. Try again later.' });
  const dryRun = req.query.dry_run === '1';
  const { execFile } = require('child_process');
  const scriptPath = require('path').join(__dirname, '../../../scripts/revokeUnusedTrials.js');
  const argv = dryRun ? [scriptPath, '--dry-run'] : [scriptPath];
  // execFile (vs exec) avoids shell interpretation; maxBuffer caps output so
  // a chatty script can't fill memory. Logs are truncated to keep entries
  // shippable in the log pipeline.
  execFile('node', argv, { maxBuffer: 512 * 1024 }, (err, stdout, stderr) => {
    if (err) logger.error('revokeUnusedTrials script error', { err: err.message });
    logger.info('revokeUnusedTrials output', {
      stdout: String(stdout || '').slice(0, 2000),
      stderr: String(stderr || '').slice(0, 500),
    });
  });
  return res.json({ success: true, queued: true, message: `Trial revocation started${dryRun ? ' (dry run)' : ''}` });
}));

// DM threads & conversations
app.get('/api/webapp/dm/threads', requireSessionAuth, asyncHandler(dmController.getThreads));
// Global DM search — MUST be before :partnerId wildcard routes
app.get('/api/webapp/dm/search', requireSessionAuth, asyncHandler(dmController.searchAllDms));
// Presence endpoint — MUST be before wildcard routes
app.get('/api/webapp/dm/presence', requireSessionAuth, asyncHandler(dmController.getPresence));
// Forward a message to one or more recipients
app.post('/api/webapp/dm/forward', requireSessionAuth, asyncHandler(dmController.forwardMessage));
// Per-thread state (pin / mute / archive / unread / pin-message) — register BEFORE :partnerId wildcard
app.put('/api/webapp/dm/thread/:partnerId/pin', requireSessionAuth, asyncHandler(dmController.pinThread));
app.put('/api/webapp/dm/thread/:partnerId/mute', requireSessionAuth, asyncHandler(dmController.muteThread));
app.put('/api/webapp/dm/thread/:partnerId/archive', requireSessionAuth, asyncHandler(dmController.archiveThread));
app.put('/api/webapp/dm/thread/:partnerId/unread', requireSessionAuth, asyncHandler(dmController.markUnread));
app.put('/api/webapp/dm/thread/:partnerId/pin-message', requireSessionAuth, asyncHandler(dmController.pinMessage));
app.put('/api/webapp/dm/thread/:partnerId/read-receipts', requireSessionAuth, asyncHandler(dmController.setReadReceipts));
app.post('/api/webapp/dm/thread/:partnerId/share-post/:postId', requireSessionAuth, socialActionLimiter, asyncHandler(dmController.shareDmPost));
// search MUST be registered before :partnerId wildcard routes to avoid collision
app.get('/api/webapp/dm/conversation/:partnerId/search', requireSessionAuth, asyncHandler(dmController.searchDmMessages));
app.get('/api/webapp/dm/conversation/:partnerId', requireSessionAuth, asyncHandler(dmController.getConversation));
app.get('/api/webapp/dm/user/:partnerId', requireSessionAuth, asyncHandler(dmController.getPartnerInfo));
app.post('/api/webapp/dm/call/join', requireSessionAuth, asyncHandler(dmController.joinDmVideoCall));
app.post('/api/webapp/dm/call/start/:partnerId', requireSessionAuth, asyncHandler(dmController.createDmVideoCallInvite));
app.post('/api/webapp/dm/send/:recipientId', requireSessionAuth, asyncHandler(dmController.sendMessage));
// DM message management (edit / delete)
app.patch('/api/webapp/dm/messages/:msgId', requireSessionAuth, asyncHandler(dmController.editDmMessage));
app.delete('/api/webapp/dm/messages/:msgId', requireSessionAuth, asyncHandler(dmController.deleteDmMessage));

// Social feed, wall, posts
// Public home-feed — no auth required, returns latest posts for the home page preview
app.get('/api/webapp/social/home-feed', pageLimiter, asyncHandler(socialController.getHomeFeed));
// Authenticated feed — full paginated feed with liked_by_me per viewer
app.get('/api/webapp/social/feed', requireSessionAuth, asyncHandler(socialController.getFeed));
// Wall of Fame sub-feed — WoF-only posts
app.get('/api/webapp/social/wof-feed', pageLimiter, asyncHandler(socialController.getWofFeed));
// Hashtag feed — posts containing a specific #tag (?tag=pnp)
app.get('/api/webapp/social/hashtag-feed', requireSessionAuth, asyncHandler(socialController.getHashtagFeed));
app.get('/api/webapp/social/wall/:userId', asyncHandler(socialController.getWall));
app.get('/api/webapp/social/profile/:userId', asyncHandler(socialController.getPublicProfile));
// M-10: 2257 compliance check middleware — enforced for active creators only
const require2257ForCreators = asyncHandler(async (req, res, next) => {
  const userId = req.session?.user?.id;
  const role = req.session?.user?.role || '';
  // Fast path: session says admin — bypass immediately
  if (role === 'admin' || role === 'superadmin') return next();
  if (!userId) return next();
  const IdentityVerificationService = require('../../services/identityVerificationService');
  const { query: dbQ2257 } = require('../../config/postgres');
  const { rows: creatorRows } = await dbQ2257(
    'SELECT creator_status, identity_verified, identity_verification_required_by, role FROM users WHERE id = $1',
    [userId]
  );
  const creatorRow = creatorRows[0];
  // DB role is authoritative — stale sessions may have wrong role
  if (creatorRow?.role === 'admin' || creatorRow?.role === 'superadmin') return next();
  if (creatorRow?.creator_status === 'active' && !IdentityVerificationService.is2257Compliant(creatorRow)) {
    logger.warn('require2257ForCreators: blocking post — 2257 not compliant', {
      userId,
      sessionRole: role,
      dbRole: creatorRow?.role,
      creatorStatus: creatorRow?.creator_status,
      identityVerified: creatorRow?.identity_verified,
    });
    return res.status(403).json({
      success: false,
      error: 'Identity verification required before posting media.',
      code: '2257_REQUIRED',
    });
  }
  return next();
});

app.post('/api/webapp/social/posts', requireSessionAuth, socialActionLimiter, require2257ForCreators, asyncHandler(socialController.createPost));

// ── X (Twitter) oEmbed post ───────────────────────────────────────────────────
// Creators paste a tweet URL; backend fetches oEmbed metadata and stores a
// content_type='x_embed' row in social_posts. No API key required.
app.post('/api/webapp/creator/posts/x-embed', requireSessionAuth, roleGuard('model', 'creator', 'admin', 'superadmin'), require2257ForCreators, asyncHandler(async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const { tweetUrl } = req.body;

  if (!tweetUrl || typeof tweetUrl !== 'string') {
    return res.status(400).json({ success: false, error: 'tweetUrl is required' });
  }

  const tweetPattern = /^https:\/\/(twitter\.com|x\.com)\/[A-Za-z0-9_]+\/status\/\d+/;
  if (!tweetPattern.test(tweetUrl.trim())) {
    return res.status(400).json({ success: false, error: 'URL must be a twitter.com or x.com status link' });
  }

  const cleanUrl = tweetUrl.trim();

  let oEmbed;
  try {
    const oEmbedUrl = `https://publish.twitter.com/oembed?url=${encodeURIComponent(cleanUrl)}&omit_script=true&dnt=true`;
    const oEmbedRes = await axios.get(oEmbedUrl, { timeout: 8000 });
    oEmbed = oEmbedRes.data;
  } catch (oEmbedErr) {
    if (oEmbedErr.response?.status === 404) {
      return res.status(404).json({ success: false, error: 'Tweet not found or has been deleted' });
    }
    if (oEmbedErr.response?.status === 403) {
      return res.status(400).json({ success: false, error: 'Tweet is from a private account' });
    }
    logger.error('x-embed oEmbed fetch failed', { url: cleanUrl, err: oEmbedErr.message });
    return res.status(502).json({ success: false, error: 'Could not fetch tweet data. Please try again.' });
  }

  const authorName = oEmbed.author_name || 'X post';
  const postContent = `${authorName} on X`;

  const { query: dbQ } = require('../../config/postgres');
  const { rows } = await dbQ(
    `WITH ins AS (
       INSERT INTO social_posts (user_id, content, content_type, x_embed_url, is_shareable, category)
       VALUES ($1, $2, 'x_embed', $3, true, 'social')
       RETURNING id, user_id, content, content_type, x_embed_url, created_at,
                 likes_count, reposts_count, replies_count, is_exclusive, is_shareable, content_tier
     )
     SELECT ins.id, ins.content, ins.content_type, ins.x_embed_url, ins.created_at,
            ins.likes_count, ins.reposts_count, ins.replies_count,
            ins.is_exclusive, ins.is_shareable, ins.content_tier,
            u.id::text AS author_id, u.username AS author_username,
            u.first_name AS author_first_name, u.photo_file_id AS author_photo,
            false AS liked_by_me, null AS reply_to_id, null AS repost_of_id
     FROM ins
     JOIN users u ON u.id = ins.user_id`,
    [user.id, postContent, cleanUrl]
  );

  return res.json({ success: true, post: rows[0] });
}));

app.post('/api/webapp/social/posts/with-media', requireSessionAuth, uploadLimiter, attachCreatorStatus, postMediaUploadMiddleware, verifyDiskFileType, require2257ForCreators, asyncHandler(socialController.createPostWithMedia));
app.post('/api/webapp/social/posts/with-multi-media', requireSessionAuth, uploadLimiter, attachCreatorStatus, postMultiMediaUploadMiddleware, verifyDiskFileType, require2257ForCreators, asyncHandler(socialController.createPostWithMultiMedia));
app.post('/api/webapp/social/posts/bulk-videos', requireSessionAuth, bulkVideoLimiter, uploadPerformerVideos, asyncHandler(socialController.bulkCreateVideos));
app.post('/api/webapp/social/posts/:postId/like', requireSessionAuth, socialActionLimiter, asyncHandler(socialController.toggleLike));

// ── Helper: extract N evenly-spaced still frames + duration from a video file. ──
// Runs ffmpeg/ffprobe on the local /directus-uploads volume mount; uploads each
// frame back into the same dir + registers it as a directus_files row via the
// Directus admin API. Returns { duration, frames: [uuid] } or null on failure.
async function generateVideoThumbnails(videoFileUuid, count = 6) {
  const path = require('path');
  const fs = require('fs');
  const { execFile } = require('child_process');
  const { promisify } = require('util');
  const { randomUUID } = require('crypto');
  const execFileAsync = promisify(execFile);

  const uploadsDir = process.env.DIRECTUS_UPLOADS_DIR || '/directus-uploads';
  if (!fs.existsSync(uploadsDir)) {
    logger.warn('directus uploads dir not mounted', { uploadsDir });
    return null;
  }

  const PRIME_FOLDER = '96931d91-bd2f-4342-818f-3116cc9ff23c';
  const ADMIN_UUID = 'eac5f7e8-f13d-4d3b-a267-1949073e5547';

  // Find the source file by filename_disk in directus_files
  const directusUrl = process.env.DIRECTUS_URL || process.env.DIRECTUS_INTERNAL_URL || 'http://directus:8055';
  const adminToken = process.env.DIRECTUS_ADMIN_TOKEN;
  let srcMeta;
  try {
    const r = await axios.get(`${directusUrl}/files/${videoFileUuid}`, {
      headers: { Authorization: `Bearer ${adminToken}` }, timeout: 5000,
    });
    srcMeta = r.data && r.data.data;
  } catch (err) {
    logger.warn('thumbgen: failed to fetch source file meta', { videoFileUuid, error: err.message });
    return null;
  }
  const srcPath = path.join(uploadsDir, srcMeta.filename_disk);
  if (!fs.existsSync(srcPath)) {
    logger.warn('thumbgen: source file missing on disk', { srcPath });
    return null;
  }

  // Probe duration
  let duration = 0;
  try {
    const { stdout } = await execFileAsync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', srcPath]);
    duration = Math.max(1, Math.round(parseFloat(stdout.trim()) || 0));
  } catch (err) {
    logger.warn('thumbgen: ffprobe failed', { srcPath, error: err.message });
    return null;
  }

  // Extract `count` frames at evenly-spaced positions (skip extreme edges)
  const positions = [];
  for (let i = 0; i < count; i++) {
    positions.push(Math.floor(duration * (0.08 + (0.84 * i / Math.max(1, count - 1)))));
  }

  const frames = [];
  const FormData = require('form-data');
  const tmpDir = '/tmp';
  for (let i = 0; i < positions.length; i++) {
    const ts = positions[i];
    const tmpName = `prime-thumb-${randomUUID()}.jpg`;
    const tmpPath = path.join(tmpDir, tmpName);
    try {
      await execFileAsync('ffmpeg', ['-y', '-ss', String(ts), '-i', srcPath, '-frames:v', '1', '-vf', 'scale=1280:-2', '-q:v', '4', tmpPath]);
    } catch (err) {
      logger.warn('thumbgen: ffmpeg failed for frame', { ts, srcPath, error: (err.stderr || err.message || '').toString().slice(0, 300) });
      continue;
    }
    if (!fs.existsSync(tmpPath)) continue;
    // Upload to Directus via multipart API — Directus handles disk placement + ownership
    try {
      const form = new FormData();
      form.append('folder', PRIME_FOLDER);
      form.append('title', `Auto-thumbnail frame ${i + 1}/${count}`);
      form.append('file', fs.createReadStream(tmpPath), {
        filename: `frame-${i + 1}-of-${count}.jpg`,
        contentType: 'image/jpeg',
      });
      const upload = await axios.post(`${directusUrl}/files`, form, {
        headers: { ...form.getHeaders(), Authorization: `Bearer ${adminToken}` },
        timeout: 30000,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      });
      const uploadedId = upload.data && upload.data.data && upload.data.data.id;
      if (uploadedId) frames.push(uploadedId);
    } catch (err) {
      logger.warn('thumbgen: failed to upload frame to directus', { error: err.response?.data?.errors?.[0]?.message || err.message });
    } finally {
      try { fs.unlinkSync(tmpPath); } catch (_) {}
    }
  }

  if (!frames.length) return null;
  return { duration, frames };
}

// ── Directus → bot prime_videos sync webhook ──
// Triggered by a Directus Flow on items.create / update / delete of prime_videos.
// Upserts a matching social_post in the PNPtv! PRIME channel (id=5) keyed by directus_id.
app.post('/api/webapp/internal/prime-videos/sync', asyncHandler(async (req, res) => {
  const expected = process.env.PRIME_SYNC_SECRET;
  if (!expected) return res.status(503).json({ error: 'sync not configured' });
  const provided = req.headers['x-prime-sync-secret'];
  if (!provided || provided !== expected) return res.status(401).json({ error: 'unauthorized' });

  const PRIME_CHANNEL_ID = 5;
  const SANTINO_ID = '8599671840';
  const CMS = (process.env.DIRECTUS_PUBLIC_URL || 'https://cms.pnptv.app').replace(/\/$/, '');

  // Directus may send the trigger payload either as a structured body or
  // (when the operation template is `{{$trigger}}`) as the whole trigger
  // object. Normalize both shapes here.
  const body = req.body || {};
  const rawEvent = String(body.event || 'items.update');
  // Directus event format is "<collection>.items.<verb>" — strip the collection prefix
  const event = rawEvent.includes('.items.') ? `items.${rawEvent.split('.items.')[1]}` : rawEvent;
  const keys = Array.isArray(body.keys)
    ? body.keys
    : (body.key != null ? [body.key] : (body.payload && body.payload.id ? [body.payload.id] : []));
  if (!keys.length) {
    logger.warn('prime-videos sync: missing keys', { event: rawEvent, bodyKeys: Object.keys(body) });
    return res.status(400).json({ error: 'missing keys' });
  }

  const directusUrl = process.env.DIRECTUS_URL || process.env.DIRECTUS_INTERNAL_URL || 'http://directus:8055';
  const adminToken = process.env.DIRECTUS_ADMIN_TOKEN;
  const results = [];

  for (const key of keys) {
    const directusId = parseInt(key, 10);
    if (!Number.isFinite(directusId)) { results.push({ key, status: 'invalid' }); continue; }

    if (event === 'items.delete') {
      await getPool().query(
        `UPDATE social_posts SET is_deleted = true, updated_at = NOW() WHERE directus_id = $1 AND channel_id = $2`,
        [directusId, PRIME_CHANNEL_ID]
      );
      results.push({ key: directusId, status: 'soft_deleted' });
      continue;
    }

    let row = null;
    try {
      const fetched = await axios.get(`${directusUrl}/items/prime_videos/${directusId}`, {
        headers: { Authorization: `Bearer ${adminToken}` }, timeout: 5000,
      });
      row = fetched.data && fetched.data.data;
    } catch (err) {
      if (err.response?.status === 404) {
        await getPool().query(
          `UPDATE social_posts SET is_deleted = true, updated_at = NOW() WHERE directus_id = $1 AND channel_id = $2`,
          [directusId, PRIME_CHANNEL_ID]
        );
        results.push({ key: directusId, status: 'fetched_404_deleted' });
        continue;
      }
      results.push({ key: directusId, status: 'fetch_failed', error: err.message });
      continue;
    }
    if (!row) { results.push({ key: directusId, status: 'no_data' }); continue; }

    if (row.status !== 'published' || !row.video_file) {
      await getPool().query(
        `UPDATE social_posts SET is_deleted = true, updated_at = NOW() WHERE directus_id = $1 AND channel_id = $2`,
        [directusId, PRIME_CHANNEL_ID]
      );
      results.push({ key: directusId, status: 'unpublished_hidden' });
      continue;
    }

    // Auto-generate multi-frame thumbnails on first sync OR when video_file changed
    let storedThumbs = row.thumbnails;
    if (typeof storedThumbs === 'string') { try { storedThumbs = JSON.parse(storedThumbs); } catch (_) { storedThumbs = {}; } }
    storedThumbs = storedThumbs || {};
    const needsThumbs = storedThumbs.video_file !== row.video_file
      || !Array.isArray(storedThumbs.frames)
      || storedThumbs.frames.length < 3;
    let frameUuids = Array.isArray(storedThumbs.frames) ? storedThumbs.frames : [];
    let primaryThumbUuid = row.thumbnail;
    let durationSecs = row.duration;
    if (needsThumbs) {
      const gen = await generateVideoThumbnails(row.video_file, 6);
      if (gen) {
        frameUuids = gen.frames;
        primaryThumbUuid = gen.frames[0];
        durationSecs = gen.duration;
        // Patch back into prime_videos
        try {
          await axios.patch(`${directusUrl}/items/prime_videos/${directusId}`, {
            duration: durationSecs,
            thumbnail: primaryThumbUuid,
            cover_url: `/assets/${primaryThumbUuid}`,
            thumbnails: { video_file: row.video_file, frames: frameUuids },
          }, { headers: { Authorization: `Bearer ${adminToken}` }, timeout: 8000 });
        } catch (err) {
          logger.warn('thumbgen: failed to patch prime_videos', { directusId, error: err.message });
        }
      }
    }

    const mediaUrl = `${CMS}/assets/${row.video_file}`;
    const thumbUrl = primaryThumbUuid ? `${CMS}/assets/${primaryThumbUuid}` : null;
    const frameUrls = frameUuids.map((u) => `${CMS}/assets/${u}`);
    const title = row.title || 'Untitled';
    const description = row.description || '';
    const content = `${title}: ${description}`.slice(0, 2000);

    await getPool().query(
      `INSERT INTO social_posts (
         user_id, content, media_url, media_type, channel_id, content_tier,
         video_thumbnail_url, video_title, video_description, video_thumbnails,
         directus_id, is_exclusive, is_shareable, is_deleted
       ) VALUES ($1, $2, $3, 'video', $4, 'PRIME', $5, $6, $7, $8::jsonb, $9, true, true, false)
       ON CONFLICT (directus_id) WHERE directus_id IS NOT NULL
       DO UPDATE SET
         content = EXCLUDED.content,
         media_url = EXCLUDED.media_url,
         video_thumbnail_url = EXCLUDED.video_thumbnail_url,
         video_title = EXCLUDED.video_title,
         video_description = EXCLUDED.video_description,
         video_thumbnails = EXCLUDED.video_thumbnails,
         is_deleted = false,
         updated_at = NOW()`,
      [SANTINO_ID, content, mediaUrl, PRIME_CHANNEL_ID, thumbUrl, title, description, JSON.stringify(frameUrls), directusId]
    );
    results.push({ key: directusId, status: needsThumbs ? 'upserted_with_new_thumbs' : 'upserted', frames: frameUuids.length });
  }

  // Recompute post_count for the channel
  await getPool().query(
    `UPDATE creator_channels SET post_count = (
       SELECT COUNT(*) FROM social_posts WHERE channel_id = $1 AND is_deleted = false
     ), updated_at = NOW() WHERE id = $1`,
    [PRIME_CHANNEL_ID]
  );

  res.json({ success: true, event, results });
}));
app.post('/api/webapp/social/posts/:postId/view', softAuth, asyncHandler(async (req, res) => {
  const postId = parseInt(req.params.postId, 10);
  if (!postId || Number.isNaN(postId)) return res.status(400).json({ error: 'Invalid post id' });
  const dedupeKey = `view:post:${postId}:${(req.session?.user?.id) || (req.ip || 'anon').replace(/[^a-zA-Z0-9.:_-]/g, '_')}`;
  try {
    const seen = await redisClient.set(dedupeKey, '1', 'EX', 3600, 'NX');
    if (seen !== 'OK') return res.json({ success: true, deduped: true });
  } catch (_) { /* if Redis is down, count anyway */ }
  try {
    const { rows } = await getPool().query(
      `UPDATE social_posts SET view_count = view_count + 1 WHERE id = $1 AND is_deleted = false RETURNING view_count, directus_id`,
      [postId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Post not found' });
    const { view_count, directus_id } = rows[0];
    if (directus_id) {
      const directusUrl = process.env.DIRECTUS_URL || process.env.DIRECTUS_INTERNAL_URL || 'http://directus:8055';
      const token = process.env.DIRECTUS_ADMIN_TOKEN;
      if (token) {
        axios.patch(`${directusUrl}/items/prime_videos/${directus_id}`, { plays: view_count }, {
          headers: { Authorization: `Bearer ${token}` }, timeout: 5000,
        }).catch((err) => logger.warn('prime_videos.plays sync failed', { directus_id, error: err.message }));
      }
    }
    return res.json({ success: true, view_count });
  } catch (err) {
    logger.error('post view increment failed', { postId, error: err.message });
    return res.status(500).json({ error: 'Failed to record view' });
  }
}));
app.delete('/api/webapp/social/posts/:postId', requireSessionAuth, socialActionLimiter, asyncHandler(socialController.deletePost));
app.patch('/api/webapp/social/posts/:postId', requireSessionAuth, socialActionLimiter, asyncHandler(socialController.editPost));
app.post('/api/webapp/social/posts/:postId/assign-channel', requireSessionAuth, socialActionLimiter, asyncHandler(socialController.assignPostToChannel));
app.delete('/api/webapp/social/posts/:postId/assign-channel', requireSessionAuth, socialActionLimiter, asyncHandler(socialController.unassignPostFromChannel));
app.get('/api/webapp/social/posts/:postId', asyncHandler(socialController.getPost));
app.get('/api/webapp/social/posts/:postId/replies', requireSessionAuth, asyncHandler(socialController.getReplies));
app.get('/api/webapp/social/mentions/search', requireSessionAuth, asyncHandler(socialController.searchMentions));
app.post('/api/webapp/social/posts/:postId/mastodon', requireSessionAuth, socialActionLimiter, asyncHandler(socialController.postToMastodon));
app.post('/api/webapp/social/posts/:postId/request-deletion', requireSessionAuth, asyncHandler(socialController.requestWofDeletion));
app.get('/api/webapp/social/wof/leaderboard', asyncHandler(socialController.getWofLeaderboard));
app.get('/api/webapp/social/wof/stats', asyncHandler(socialController.getWofStats));
app.post('/api/admin/social/posts/:postId/wof', adminGuard, asyncHandler(socialController.adminFlagWof));
app.delete('/api/admin/social/posts/:postId/wof', adminGuard, asyncHandler(socialController.adminUnflagWof));

// ── User Hangout Activity (for profiles) ────────────────────────────────────
app.get('/api/webapp/social/hangout-activity/:userId', requireSessionAuth, asyncHandler(socialController.getUserHangoutActivity));

// ── Promoted Posts (CMS Sync) ────────────────────────────────────────────────
app.post('/api/admin/social/sync-promoted', adminGuard, asyncHandler(promotedPostController.handleSyncPromoted));
app.post('/api/admin/social/sync-content', adminGuard, asyncHandler(contentFeedSyncController.handleSyncContent));

// Users search
app.get('/api/webapp/users/search', asyncHandler(usersController.searchUsers));

// Tag taxonomy + discovery endpoints
const discoverService = require('../../services/discoverService');

app.get('/api/webapp/discover/tags', async (req, res) => {
  try {
    const groups = await discoverService.getTagTaxonomy();
    res.json({ success: true, groups });
  } catch (err) {
    console.error('discoverTags:', err);
    res.json({ success: true, groups: {} });
  }
});

app.get('/api/webapp/discover', async (req, res) => {
  try {
    const tags = req.query.tags ? String(req.query.tags).split(',').filter(Boolean) : [];
    const q = String(req.query.q || '').trim().slice(0, 200);
    const entity = ['all','members','creators','channels','videos','hangouts'].includes(req.query.entity)
      ? req.query.entity : 'all';
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(24, Math.max(1, parseInt(req.query.limit, 10) || 12));
    const results = await discoverService.discoverByTags(tags, q, entity, page, limit);
    res.json({ success: true, ...results });
  } catch (err) {
    console.error('discover:', err);
    res.status(500).json({ success: false });
  }
});

// Global search — used by the navbar 🔍 icon. Aggregates users, creators,
// and posts in a single response so the client doesn't have to fan out.
// Client expects: { success, users:[…], creators:[…], posts:[…] }.
app.get('/api/webapp/search', requireSessionAuth, asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').trim();
  const full = req.query.full === '1';
  const limit = full ? 25 : 4;
  if (q.length < 2) return res.json({ success: true, users: [], creators: [], channels: [], hangouts: [], posts: [] });
  const { query } = require('../../config/postgres');
  const viewerId = req.session.user.id;
  const like = `%${q.replace(/[%_\\]/g, '\\$&')}%`;

  const [usersRes, creatorsRes, channelsRes, hangoutsRes, postsRes] = await Promise.all([
    query(
      `SELECT id, username, first_name, last_name, photo_file_id
         FROM users
        WHERE id::text != $1
          AND is_deleted = false
          AND (username ILIKE $2 ESCAPE '\\' OR first_name ILIKE $2 ESCAPE '\\' OR last_name ILIKE $2 ESCAPE '\\')
        ORDER BY first_name ASC
        LIMIT $3`,
      [String(viewerId), like, limit],
    ),
    query(
      `SELECT id, id AS user_id, first_name AS display_name, username,
              photo_file_id AS photo_url,
              COALESCE(creator_verified, false) AS verified
         FROM users
        WHERE is_deleted = false
          AND creator_status = 'active'
          AND (username ILIKE $1 ESCAPE '\\' OR first_name ILIKE $1 ESCAPE '\\' OR last_name ILIKE $1 ESCAPE '\\')
        ORDER BY first_name ASC
        LIMIT $2`,
      [like, limit],
    ),
    query(
      `SELECT id, name, description, access_type, slug, cover_image_url,
              subscriber_count
         FROM creator_channels
        WHERE is_active = true
          AND (name ILIKE $1 ESCAPE '\\' OR description ILIKE $1 ESCAPE '\\' OR slug ILIKE $1 ESCAPE '\\')
        ORDER BY subscriber_count DESC NULLS LAST
        LIMIT $2`,
      [like, limit],
    ),
    query(
      `SELECT g.id, g.name, g.description, g.is_paid,
              (SELECT COUNT(*)::int FROM hangout_group_members m WHERE m.group_id = g.id) AS member_count
         FROM hangout_groups g
        WHERE g.is_public = true
          AND g.is_main = false
          AND g.is_wall_of_fame = false
          AND (g.name ILIKE $1 ESCAPE '\\' OR g.description ILIKE $1 ESCAPE '\\')
        ORDER BY member_count DESC NULLS LAST
        LIMIT $2`,
      [like, limit],
    ),
    query(
      `SELECT p.id, p.content, u.username AS author_username
         FROM social_posts p
         JOIN users u ON u.id::text = p.user_id::text
        WHERE p.is_deleted = false
          AND u.is_deleted = false
          AND p.content ILIKE $1 ESCAPE '\\'
        ORDER BY p.created_at DESC
        LIMIT $2`,
      [like, limit],
    ),
  ]);

  return res.json({
    success: true,
    users: usersRes.rows,
    creators: creatorsRes.rows,
    channels: channelsRes.rows,
    hangouts: hangoutsRes.rows,
    posts: postsRes.rows,
  });
}));

// ── @Mention autocomplete ────────────────────────────────────────────────────
const mentionController = require('./controllers/mentionController');
app.get('/api/webapp/users/mention-search', requireSessionAuth, asyncHandler(mentionController.mentionSearch));

// ── Emoji Reactions ──────────────────────────────────────────────────────────
const reactionController = require('./controllers/reactionController');
// Share post to hangout groups
app.post('/api/webapp/social/posts/:postId/share-to-hangouts', requireSessionAuth, socialActionLimiter, asyncHandler(socialController.sharePostToHangouts));
// Post reactions
app.post('/api/webapp/social/posts/:postId/react', requireSessionAuth, socialActionLimiter, asyncHandler(reactionController.reactToPost));
app.get('/api/webapp/social/posts/:postId/reactions', asyncHandler(reactionController.getPostReactions));
// Chat message reactions
app.post('/api/webapp/chat/messages/:messageId/react', requireSessionAuth, asyncHandler(reactionController.reactToChatMessage));
app.get('/api/webapp/chat/messages/:messageId/reactions', asyncHandler(reactionController.getChatReactions));
// DM reactions
app.post('/api/webapp/dm/messages/:messageId/react', requireSessionAuth, asyncHandler(reactionController.reactToDm));
app.get('/api/webapp/dm/messages/:messageId/reactions', requireSessionAuth, asyncHandler(reactionController.getDmReactions));
// Content reactions (PRIME videos / audio — contentId is a Directus integer ID)
app.get('/api/webapp/content/:contentId/reactions', softAuth, asyncHandler(reactionController.getContentReactions));
app.post('/api/webapp/content/:contentId/react', requireSessionAuth, socialActionLimiter, asyncHandler(reactionController.reactToContent));

// ── Custom Media Packs (stickers / GIFs / custom emojis) ─────────────────────
const mediaPackController = require('./controllers/mediaPackController');
// Public / user routes
app.get('/api/webapp/media-packs', asyncHandler(mediaPackController.listPacks));
app.get('/api/webapp/media-packs/search', asyncHandler(mediaPackController.searchItems));
app.get('/api/webapp/media-packs/favorites', requireSessionAuth, asyncHandler(mediaPackController.getUserFavorites));
app.get('/api/webapp/media-packs/:slug/items', asyncHandler(mediaPackController.getPackItems));
app.post('/api/webapp/media-packs/items/:id/use', requireSessionAuth, asyncHandler(mediaPackController.trackUsage));
// Admin routes
app.post('/api/webapp/admin/media-packs', adminGuard, asyncHandler(mediaPackController.adminCreatePack));
app.patch('/api/webapp/admin/media-packs/:id/toggle', adminGuard, asyncHandler(mediaPackController.adminTogglePack));
app.delete('/api/webapp/admin/media-packs/:id', adminGuard, asyncHandler(mediaPackController.adminDeletePack));
app.post('/api/webapp/admin/media-packs/:packId/items', adminGuard, asyncHandler(mediaPackController.adminAddItem));
app.delete('/api/webapp/admin/media-packs/items/:id', adminGuard, asyncHandler(mediaPackController.adminDeleteItem));

// Account self-deletion (soft — anonymises the record)
const deleteAccountLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 1,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `delete-acct:${req.session?.user?.id || req.ip}`,
  handler: (_req, res) => res.status(429).json({ error: 'Too many requests' }),
});
app.delete('/api/webapp/account', requireSessionAuth, deleteAccountLimiter, asyncHandler(usersController.deleteMyAccount));

// Hard-delete — Right to be Forgotten (GDPR erasure). Body: { confirm: "DELETE MY ACCOUNT" }
// Rate-limited to 1 request per minute (same limiter reused) — erasure is irreversible.
app.delete('/api/users/me/erase', requireSessionAuth, deleteAccountLimiter, asyncHandler(usersController.selfEraseAccount));

// ==========================================
// SERVICE PROXY ENDPOINTS (Media, Live, Social)
// Frontend calls these; backend handles auth to each service
// ==========================================

// --- Media Proxy ---
// Resolve SoundCloud track metadata
app.post('/api/proxy/media/resolve-soundcloud', requireSessionAuth, asyncHandler(async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ success: false, error: 'URL is required' });

  const metadata = await SoundCloudService.resolveTrack(url);
  if (!metadata) return res.status(400).json({ success: false, error: 'Failed to resolve SoundCloud track' });

  res.json({ success: true, metadata });
}));

// Import SoundCloud track to library
app.post('/api/proxy/media/import-soundcloud', requireSessionAuth, adminGuard, asyncHandler(async (req, res) => {
  const { title, artist, coverUrl, url, externalId, label } = req.body;
  if (!title || !url) return res.status(400).json({ success: false, error: 'Title and URL required' });

  // Check for duplicate
  const existing = await getPool().query(
    'SELECT id FROM media_library WHERE url = $1 OR (external_id = $2 AND external_id IS NOT NULL)',
    [url, externalId || null]
  );
  if (existing.rows.length > 0) {
    return res.status(409).json({ success: false, error: 'Track already in library' });
  }

  const result = await getPool().query(
    `INSERT INTO media_library (title, artist, url, type, cover_url, provider, external_id, is_public, label)
     VALUES ($1, $2, $3, 'audio', $4, 'soundcloud', $5, true, $6)
     RETURNING *`,
    [title, artist || 'Unknown', url, coverUrl || null, externalId || null, label || null]
  );

  res.json({ success: true, track: result.rows[0] });
}));

// Fetch SoundCloud artist catalog
app.post('/api/proxy/media/soundcloud-artist', requireSessionAuth, adminGuard, asyncHandler(async (req, res) => {
  const { artistUrl } = req.body;
  if (!artistUrl) return res.status(400).json({ success: false, error: 'Artist URL required' });

  try {
    const tracks = await SoundCloudService.getArtistTracks(artistUrl);
    res.json({ success: true, tracks: tracks || [] });
  } catch (err) {
    logger.error('Artist catalog fetch error:', err.message);
    res.json({ success: true, tracks: [] });
  }
}));

// Admin: list radio requests (webapp session auth)
app.get('/api/webapp/admin/radio/requests', adminGuard, asyncHandler(async (req, res) => {
  const status = req.query.status || 'pending';
  const validStatuses = ['pending', 'approved', 'rejected'];
  const query = validStatuses.includes(status)
    ? { text: 'SELECT * FROM radio_requests WHERE status = $1 ORDER BY requested_at DESC LIMIT 50', values: [status] }
    : { text: 'SELECT * FROM radio_requests ORDER BY requested_at DESC LIMIT 50', values: [] };
  const result = await getPool().query(query.text, query.values);
  res.json({ success: true, requests: result.rows });
}));

// Admin: approve/reject radio request (webapp session auth)
// On approval, the stored URL is re-validated via SoundCloudService.resolveTrack()
// so a previously-accepted URL cannot slip through if the allowlist or resolver
// rules have tightened since the user submitted the request.
app.put('/api/webapp/admin/radio/requests/:requestId', adminGuard, asyncHandler(async (req, res) => {
  const { requestId } = req.params;
  const { status } = req.body;
  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ success: false, error: 'Invalid status' });
  }

  if (status === 'approved') {
    const existing = await getPool().query(
      'SELECT url FROM radio_requests WHERE id = $1',
      [parseInt(requestId, 10)]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Request not found' });
    }
    const storedUrl = existing.rows[0].url;
    try {
      const revalidated = await SoundCloudService.resolveTrack(storedUrl);
      if (!revalidated) {
        return res.status(400).json({ success: false, error: 'Stored URL failed re-validation' });
      }
    } catch (err) {
      return res.status(400).json({
        success: false,
        error: `Stored URL rejected by domain allowlist: ${err.message}`,
      });
    }
  }

  const result = await getPool().query(
    'UPDATE radio_requests SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
    [status, parseInt(requestId, 10)]
  );
  if (result.rows.length === 0) {
    return res.status(404).json({ success: false, error: 'Request not found' });
  }
  res.json({ success: true, request: result.rows[0] });
}));

// Request SoundCloud track
app.post('/api/webapp/radio/request-soundcloud', requireSessionAuth, asyncHandler(async (req, res) => {
  const { url } = req.body;
  const userId = req.user.id;

  if (!url) return res.status(400).json({ success: false, error: 'URL is required' });

  const metadata = await SoundCloudService.resolveTrack(url);
  if (!metadata) return res.status(400).json({ success: false, error: 'Failed to resolve SoundCloud track' });

  const result = await getPool().query(
    `INSERT INTO radio_requests (user_id, song_name, artist, status, url, metadata)
     VALUES ($1, $2, $3, 'pending', $4, $5)
     RETURNING id`,
    [userId, metadata.title, metadata.artist, url, JSON.stringify(metadata)]
  );

  res.json({ success: true, requestId: result.rows[0].id });
}));

app.get('/api/proxy/media/tracks', requireSessionAuth, asyncHandler(async (req, res) => {
  try {
    const limit = Math.min(Math.max(1, parseInt(req.query.limit, 10) || 20), 100);
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);

    // Fetch from media_library (SoundCloud etc.)
    const dbMedia = await MediaPlayerModel.getMediaLibrary('audio', limit, offset);
    const tracks = (dbMedia || []).map(m => ({
      id: `db_${m.id}`,
      title: m.title,
      artist: m.artist,
      album: m.category,
      art: m.cover_url,
      time: m.duration,
      provider: m.provider || 'local',
      external_id: m.external_id,
      url: m.url,
      soundcloud_url: m.provider === 'soundcloud' ? m.url : undefined,
      label: m.label || undefined
    }));

    res.json({ success: true, tracks });
  } catch (error) {
    logger.error(`Media proxy tracks error: ${error.message}`);
    res.json({ success: true, tracks: [] });
  }
}));

// --- Restreamer Live Proxy ---
app.get('/api/proxy/live/streams', requireSessionAuth, asyncHandler(async (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  try {
    const restreamerUrl = (process.env.RESTREAMER_URL || 'http://restreamer:8080').replace(/\/$/, '');
    const restreamerService = require('../../services/restreamerService');
    const token = await restreamerService.getToken().catch(() => null);

    const resp = await axios.get(`${restreamerUrl}/api/v3/process`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      timeout: 10000,
    });

    // Strip trailing slash to prevent double-slash in HLS URLs (e.g. https://live.pnptv.app//memfs/...)
    const publicUrl = (process.env.RESTREAMER_PUBLIC_URL || 'https://live.pnptv.app').replace(/\/$/, '');
    const processes = resp.data || [];
    let rawStreams = processes
      .filter((p) => p.id?.startsWith('restreamer-ui:ingest:'))
      .map((p) => {
        const rawRefId = p.reference || p.id;
        // Allowlist: only alphanumeric, hyphens, underscores, and dots.
        // Prevents path-traversal or query injection if Restreamer returns a crafted ID.
        const refId = typeof rawRefId === 'string'
          ? rawRefId.replace(/[^a-zA-Z0-9\-_.]/g, '')
          : null;
        if (!refId || refId.includes('..')) {
          logger.warn('proxy listStreams: rejected process with unsafe reference ID', { rawRefId });
          return null;
        }
        // isLive requires both the FFmpeg process to be running AND active bitrate > 0.
        // A process can be exec:'running' while waiting for RTMP reconnect with 0 bitrate —
        // that state must not surface as "live" to viewers.
        // Restreamer v3 API: state.progress.bitrate_kbit (number), NOT state.runtime.bitrate (string).
        const bitrateKbps = typeof p.state?.progress?.bitrate_kbit === 'number' ? Math.round(p.state.progress.bitrate_kbit) : 0;
        return {
          id: refId,
          name: p.metadata?.['restreamer-ui']?.meta?.name || 'Live Stream',
          description: p.metadata?.['restreamer-ui']?.meta?.description || '',
          hlsUrl: `/api/proxy/live/master/${refId}.m3u8`,
          isLive: p.state?.exec === 'running' && bitrateKbps > 0,
        };
      })
      .filter(Boolean);

    // Keep only streams that belong to a verified, active creator in DB.
    // Orphaned channels (no matching DB user) are excluded for non-admins.
    // Also inject the owner's userId + pnptv_id onto each stream so the Live
    // page's findLiveStream() fallback can match performer cards to streams
    // when the featured-endpoint snapshot is stale (creator went live AFTER
    // the viewer opened the page).
    const proxyUser = req.session?.user;
    const refIds = rawStreams.map((s) => s.id);
    if (refIds.length > 0) {
      const { rows: ownerRows } = await getPool().query(
        `SELECT id::text AS user_id, pnptv_id::text AS pnptv_id, live_channel
           FROM users
          WHERE live_channel = ANY($1::text[])
            AND is_deleted = FALSE
            AND creator_status = 'active'
            AND creator_locked = FALSE
            AND (
              identity_verified = TRUE
              OR (identity_verification_required_by IS NOT NULL AND identity_verification_required_by > NOW())
            )`,
        [refIds]
      );
      const channelToOwner = new Map(ownerRows.map(r => [r.live_channel, { userId: r.user_id, pnptvId: r.pnptv_id }]));
      const isAdmin = proxyUser && ['admin', 'superadmin'].includes(proxyUser.role);
      rawStreams = rawStreams
        .filter((s) => isAdmin || channelToOwner.has(s.id))
        .map((s) => {
          const owner = channelToOwner.get(s.id);
          return owner ? { ...s, userId: owner.userId, pnptvId: owner.pnptvId } : s;
        });
    }

    // Enrich each live stream with the viewer count and metadata stored in Redis.
    // Polling clients (Socket.IO fallback) can use this to keep the count
    // accurate when the WebSocket connection is unavailable.
    const redis = getRedis();
    const streams = await Promise.all(
      rawStreams.map(async (s) => {
        try {
          const [viewerRaw, metaRaw, thumbUrl] = await Promise.all([
            redis.get(`live:viewers:${s.id}`),
            redis.get(`stream:meta:${s.id}`),
            redis.get(`stream:thumb:${s.id}`),
          ]);

          const viewerCount = Math.max(0, parseInt(viewerRaw, 10) || 0);
          let metadata = {};
          if (metaRaw) {
            try { metadata = JSON.parse(metaRaw); } catch { /* ignore */ }
          }

          return {
            ...s,
            viewerCount,
            name: metadata.title || s.name,
            description: metadata.description || s.description,
            tags: metadata.tags || [],
            thumbnailUrl: thumbUrl || null,
          };
        } catch {
          return { ...s, viewerCount: 0, tags: [] };
        }
      })
    );

    res.json({ success: true, streams });
  } catch (error) {
    logger.warn(`Live proxy streams unavailable: ${error.message}`);
    res.json({ success: true, streams: [] });
  }
}));

// Master HLS playlist — returns a multi-variant (ABR) playlist when the channel
// has a transcoded 720p output, otherwise a single-rendition playlist.
// Cached per-refId for 30s to avoid hammering Restreamer on every segment poll.
const _abrCache = new Map(); // refId -> { hasABR: bool, expiresAt: number }
const _ABR_CACHE_MAX = 200;
async function _getMasterHasABR(refId, restreamerService) {
  const cached = _abrCache.get(refId);
  if (cached && Date.now() < cached.expiresAt) return cached.hasABR;
  const proc = await restreamerService.getProcess(refId);
  const hasABR = (proc?.config?.output?.length || 0) >= 2;
  if (_abrCache.size >= _ABR_CACHE_MAX) _abrCache.delete(_abrCache.keys().next().value);
  _abrCache.set(refId, { hasABR, expiresAt: Date.now() + 30_000 });
  return hasABR;
}

app.get('/api/proxy/live/master/:refId', requireSessionAuth, asyncHandler(async (req, res) => {
  const raw = (req.params.refId || '').replace(/\.m3u8$/, '');
  if (!/^[a-zA-Z0-9_-]+$/.test(raw) || raw.includes('..')) {
    return res.status(400).json({ error: 'invalid_ref' });
  }
  try {
    const restreamerService = require('../../services/restreamerService');
    const hasABR = await _getMasterHasABR(raw, restreamerService);

    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'no-cache, no-store');

    let playlist = '#EXTM3U\n#EXT-X-VERSION:3\n';
    if (hasABR) {
      playlist += `#EXT-X-STREAM-INF:BANDWIDTH=900000,RESOLUTION=1280x720,NAME="720p"\n`;
      playlist += `/api/proxy/live/hls/${raw}_720p.m3u8\n`;
    }
    playlist += `#EXT-X-STREAM-INF:BANDWIDTH=4000000,NAME="source"\n`;
    playlist += `/api/proxy/live/hls/${raw}.m3u8\n`;

    res.send(playlist);
  } catch (err) {
    logger.warn(`master playlist ${raw}: ${err.message}`);
    res.redirect(302, `/api/proxy/live/hls/${raw}.m3u8`);
  }
}));

// HLS segment/manifest proxy — avoids cross-origin cookie issues.
// Clients request /api/proxy/live/hls/<filename> (same-origin) and this
// route validates the session then fetches from Restreamer's internal memfs.
//
// Restreamer wraps HLS output in a two-level structure:
//   GET /memfs/pnptv-X.m3u8           → variant playlist: "pnptv-X.m3u8?session=ABC"
//   GET /memfs/pnptv-X.m3u8?session=  → actual media playlist with #EXTINF + .ts files
//   GET /memfs/pnptv-X_NNNN.ts?session= → video segment
//
// HLS.js only handles two levels (master → media). When this proxy is called
// as the rendition URL from our master playlist, Restreamer's nested variant
// would create a three-level chain HLS.js can't parse. We detect this case
// (response body contains #EXT-X-STREAM-INF without #EXTINF) and transparently
// follow the session redirect, rewriting segment filenames to stay on-proxy.
app.get('/api/proxy/live/hls/:filename', requireSessionAuth, asyncHandler(async (req, res) => {
  const raw = req.params.filename || '';
  // Strict allowlist: alphanumeric, hyphens, underscores, dots only; must end in .m3u8 or .ts
  if (!/^[a-zA-Z0-9_-]+\.(m3u8|ts)$/.test(raw) || raw.includes('..')) {
    return res.status(400).json({ error: 'invalid_filename' });
  }
  try {
    const restreamerUrl = (process.env.RESTREAMER_URL || 'http://restreamer:8080').replace(/\/$/, '');
    const restreamerService = require('../../services/restreamerService');
    const token = await restreamerService.getToken();
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const qs = new URLSearchParams(req.query).toString();
    const upstreamUrl = `${restreamerUrl}/memfs/${raw}${qs ? `?${qs}` : ''}`;
    const timeout = raw.endsWith('.m3u8') ? 4000 : 8000;

    // For .m3u8 files: read as text so we can detect and resolve Restreamer's
    // variant-playlist wrapper before handing the playlist off to HLS.js.
    if (raw.endsWith('.m3u8')) {
      const upstream = await axios.get(upstreamUrl, { headers, responseType: 'text', timeout });
      const body = upstream.data || '';
      const isVariantPlaylist = body.includes('#EXT-X-STREAM-INF') && !body.includes('#EXTINF');

      if (isVariantPlaylist) {
        // Restreamer returned a variant/session wrapper — find the real media URL.
        const sessionLine = body.split('\n').find(l => l.trim() && !l.startsWith('#'));
        if (sessionLine) {
          const sessionUrl = `${restreamerUrl}/memfs/${sessionLine.trim()}`;
          const mediaResp = await axios.get(sessionUrl, { headers, responseType: 'text', timeout: 4000 });
          let mediaBody = mediaResp.data || '';
          // Rewrite segment filenames (pnptv-X_NNNN.ts?session=...) so they
          // stay on-proxy. Only rewrite bare filename lines (not #EXT tags).
          mediaBody = mediaBody.replace(/^([a-zA-Z0-9_-]+\.ts(\?[^\s]*)?)$/gm, '/api/proxy/live/hls/$1');
          res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
          return res.send(mediaBody);
        }
      }

      // Already a media playlist (has session param or direct access) — rewrite segments.
      let mediaBody = body;
      mediaBody = mediaBody.replace(/^([a-zA-Z0-9_-]+\.ts(\?[^\s]*)?)$/gm, '/api/proxy/live/hls/$1');
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      return res.send(mediaBody);
    }

    // .ts segments — stream directly (no body inspection needed).
    const upstream = await axios.get(upstreamUrl, { headers, responseType: 'stream', timeout });
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.setHeader('Content-Type', upstream.headers['content-type'] || 'video/mp2t');
    if (upstream.headers['content-length']) res.setHeader('Content-Length', upstream.headers['content-length']);
    upstream.data.on('error', () => { if (!res.headersSent) res.destroy(); });
    upstream.data.pipe(res);
  } catch (err) {
    const status = err.response?.status || 502;
    if (!res.headersSent) res.status(status).json({ error: 'hls_proxy_error' });
  }
}));


// Directus CMS internal URL (used by live performers and other CMS-backed routes)
const DIRECTUS_INTERNAL_URL = process.env.DIRECTUS_URL || 'http://172.20.0.18:8055';

// Hangouts Proxy — removed (dead code, replaced by hangout group calls)

// --- Performers (Directus CMS-backed) ---
const PerformerModel = require('../../models/performerModel'); // still used by tips endpoint

const mapDirectusPerformer = (p, userPhotoMap) => ({
  id: String(p.id),
  userId: p.pnptv_id || null,
  slug: p.slug || null,
  displayName: p.name,
  bio: p.bio || null,
  photoUrl: p.photo
    ? `https://cms.pnptv.app/assets/${p.photo}`
    : (p.pnptv_id && userPhotoMap?.get(String(p.pnptv_id))) || null,
  isFeatured: p.is_featured || false,
  isAvailable: p.is_available !== false,
  basePrice: p.base_price_cents ? p.base_price_cents / 100 : 100,
  totalCalls: 0,
  averageRating: 0,
});

const DIRECTUS_PERFORMER_FIELDS = ['id', 'name', 'slug', 'bio', 'photo', 'is_featured', 'is_available', 'base_price_cents', 'pnptv_id'];

// Fetch the set of Restreamer ingest reference IDs that are currently `running`.
// Cached in Redis for 20s to avoid hammering Restreamer on every /featured request.
// Returns an empty Set on any failure so callers can degrade gracefully.
function parseLiveChannelBitrateKbps(bitrateStr) {
  const m = String(bitrateStr || '').match(/([\d.]+)\s*kbits/i);
  return m ? parseFloat(m[1]) : 0;
}

async function fetchRunningLiveChannels() {
  const redis = getRedis();
  const cacheKey = 'featured:live-channels';
  try {
    const cached = await redis.get(cacheKey);
    if (cached !== null && cached !== undefined) {
      return new Set(JSON.parse(cached));
    }
  } catch { /* cache miss is fine */ }

  try {
    const restreamerService = require('../../services/restreamerService');
    const restreamerUrl = (process.env.RESTREAMER_URL || 'http://restreamer:8080').replace(/\/$/, '');
    const token = await restreamerService.getToken().catch(() => null);
    const resp = await axios.get(`${restreamerUrl}/api/v3/process`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      timeout: 5000,
    });
    const running = (resp.data || [])
      .filter(p => {
        if (!p.id?.startsWith('restreamer-ui:ingest:')) return false;
        if (p.state?.exec !== 'running') return false;
        // Require actual bitrate > 0: eliminates processes that are "running"
        // (FFmpeg started, waiting for RTMP) but have no active ingest signal.
        // Restreamer v3 API: state.progress.bitrate_kbit (number), NOT state.runtime.bitrate (string).
        return (typeof p.state?.progress?.bitrate_kbit === 'number' ? p.state.progress.bitrate_kbit : 0) > 0;
      })
      .map(p => {
        const ref = typeof (p.reference || p.id) === 'string' ? (p.reference || p.id) : '';
        return ref.replace(/[^a-zA-Z0-9\-_.]/g, '');
      })
      .filter(Boolean);

    // 5-second TTL: fast enough for near-real-time status without hammering Restreamer.
    try { await redis.set(cacheKey, JSON.stringify(running), 'EX', 5); } catch { /* non-fatal */ }
    return new Set(running);
  } catch (err) {
    logger.warn(`fetchRunningLiveChannels failed: ${err.message}`);
    return new Set();
  }
}

// Fetch profile pics from users table for performers missing Directus photos
async function fetchPerformerPhotos(performers) {
  const idsWithoutPhoto = performers
    .filter(p => !p.photo && p.pnptv_id)
    .map(p => String(p.pnptv_id));
  if (!idsWithoutPhoto.length) return new Map();
  try {
    const placeholders = idsWithoutPhoto.map((_, i) => `$${i + 1}`).join(',');
    const { rows } = await getPool().query(
      `SELECT id::text, photo_file_id FROM users WHERE id::text IN (${placeholders}) AND photo_file_id IS NOT NULL`,
      idsWithoutPhoto
    );
    const map = new Map();
    for (const r of rows) {
      const photo = r.photo_file_id;
      if (photo) map.set(r.id, photo.startsWith('/') ? photo : `/${photo}`);
    }
    return map;
  } catch (err) {
    logger.warn(`fetchPerformerPhotos failed: ${err.message}`);
    return new Map();
  }
}

app.get('/api/performers/featured', softAuth, asyncHandler(async (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  try {
    const restreamerUrl = process.env.RESTREAMER_URL || 'http://restreamer:8080';
    const restreamerPublicUrl = (process.env.RESTREAMER_PUBLIC_URL || 'https://live.pnptv.app').replace(/\/$/, '');

    // Fetch featured from Directus + active creators from DB
    const [directusResult, dbResult] = await Promise.allSettled([
      axios.get(`${DIRECTUS_INTERNAL_URL}/items/performers`, {
        params: {
          'filter[status][_eq]': 'published',
          'filter[is_featured][_eq]': true,
          'fields[]': DIRECTUS_PERFORMER_FIELDS,
          sort: 'name',
          limit: 20,
        },
        timeout: 10000,
      }),
      getPool().query(
        `SELECT id, username, first_name, last_name, photo_file_id, bio,
                city, country,
                creator_type, creator_status, creator_price_usd, live_channel, tier
         FROM users
         WHERE creator_status = 'active'
           AND creator_locked = FALSE
           AND is_deleted = FALSE
           AND (
             identity_verified = TRUE
             OR (identity_verification_required_by IS NOT NULL AND identity_verification_required_by > NOW())
           )
         ORDER BY creator_subscriber_count DESC NULLS LAST
         LIMIT 50`
      ),
    ]);

    const directusPerformers = directusResult.status === 'fulfilled'
      ? (directusResult.value.data?.data || [])
      : [];
    const dbCreators = dbResult.status === 'fulfilled'
      ? (dbResult.value.rows || [])
      : [];

    const photoMap = await fetchPerformerPhotos(directusPerformers);
    let mapped = directusPerformers.map(p => mapDirectusPerformer(p, photoMap));

    // Post-filter: exclude Directus performers whose pnptv_id maps to a deleted DB user
    try {
      const directusLinkedIds = mapped.filter(p => p.userId).map(p => String(p.userId));
      if (directusLinkedIds.length > 0) {
        const { rows: deletedRows } = await getPool().query(
          `SELECT id::text FROM users WHERE id = ANY($1::text[]) AND is_deleted = TRUE`,
          [directusLinkedIds]
        );
        if (deletedRows.length > 0) {
          const deletedIds = new Set(deletedRows.map(r => r.id));
          mapped = mapped.filter(p => !p.userId || !deletedIds.has(String(p.userId)));
        }
      }
    } catch (filterErr) {
      logger.warn(`featured: deleted-user filter failed (non-fatal): ${filterErr.message}`);
    }

    const coveredUserIds = new Set(
      directusPerformers.filter(p => p.pnptv_id).map(p => String(p.pnptv_id))
    );

    for (const c of dbCreators) {
      if (coveredUserIds.has(String(c.id))) continue;
      const photo = c.photo_file_id
        ? (c.photo_file_id.startsWith('/') ? c.photo_file_id : `/${c.photo_file_id}`)
        : null;
      mapped.push({
        id: `db-${c.id}`,
        userId: c.id,
        slug: c.username || null,
        displayName: [c.first_name, c.last_name].filter(Boolean).join(' ') || c.username || `Creator ${c.id}`,
        bio: c.bio || null,
        city: c.city || null,
        country: c.country || null,
        photoUrl: photo,
        isFeatured: true,
        isAvailable: true,
        basePrice: c.creator_price_usd || 100,
        totalCalls: 0,
        averageRating: 0,
        isPrime: String(c.tier || '').toUpperCase() === 'PRIME',
      });
    }

    // Inject live status + tier + online presence in a single pass.
    // Cross-reference each performer's live_channel against currently-running
    // Restreamer processes, and their Telegram ID against the socket-heartbeat
    // Redis presence key. Both userToX maps are keyed by BOTH telegram_id AND
    // pnptv_id so lookups work regardless of which one the performer.userId is
    // (dbCreators expose Telegram ID, Directus performers expose pnptv_id).
    try {
      const userIds = mapped.map(p => p.userId).filter(Boolean).map(String);
      if (userIds.length > 0) {
        const [runningChannels, { rows: userRows }] = await Promise.all([
          fetchRunningLiveChannels(),
          getPool().query(
            `SELECT id::text AS telegram_id, pnptv_id::text AS pnptv_id, live_channel, tier
               FROM users
              WHERE id = ANY($1::text[]) OR pnptv_id::text = ANY($1::text[])`,
            [userIds]
          ),
        ]);
        // Presence keys are stored ONLY under Telegram ID (socketHandlers.js:376
        // uses `user:${user.id}:active`), so we must always look up by telegram_id
        // even when the performer's userId is a UUID.
        const redis = getRedis();
        const telegramIds = userRows.map(r => r.telegram_id);
        const presence = telegramIds.length > 0
          ? await Promise.all(telegramIds.map(id => redis.get(`user:${id}:active`)))
          : [];
        const onlineTelegramIds = new Set(
          telegramIds.filter((_, i) => presence[i] !== null && presence[i] !== '0')
        );

        const userToChannel = new Map();
        const userToTier = new Map();
        const userToOnline = new Map();
        for (const row of userRows) {
          const online = onlineTelegramIds.has(row.telegram_id);
          if (row.live_channel) {
            userToChannel.set(row.telegram_id, row.live_channel);
            if (row.pnptv_id) userToChannel.set(row.pnptv_id, row.live_channel);
          }
          if (row.tier) {
            userToTier.set(row.telegram_id, row.tier);
            if (row.pnptv_id) userToTier.set(row.pnptv_id, row.tier);
          }
          userToOnline.set(row.telegram_id, online);
          if (row.pnptv_id) userToOnline.set(row.pnptv_id, online);
        }
        for (const entry of mapped) {
          if (!entry.userId) continue;
          const uid = String(entry.userId);
          const channel = userToChannel.get(uid);
          if (channel && runningChannels.has(channel)) {
            entry.isLive = true;
            entry.hlsUrl = `/api/proxy/live/master/${channel}.m3u8`;
          }
          const tier = userToTier.get(uid);
          if (tier && String(tier).toUpperCase() === 'PRIME') {
            entry.isPrime = true;
          }
          if (userToOnline.get(uid) === true) {
            entry.isOnline = true;
          }
        }
      }
    } catch (liveErr) {
      logger.warn(`featured: live/tier/presence check failed (non-fatal): ${liveErr.message}`);
    }

    // Sort by discovery score:
    //   live=8, online=4, prime=2, featured=1 — stable, online > prime so a
    //   PRIME-but-offline performer still ranks below an active free user.
    const scoreOf = (e) =>
      (e.isLive ? 8 : 0) + (e.isOnline ? 4 : 0) + (e.isPrime ? 2 : 0) + (e.isFeatured ? 1 : 0);
    mapped.sort((a, b) => scoreOf(b) - scoreOf(a));

    // Strip HLS stream URLs for unauthenticated users — prevents public access to stream links.
    const isAuthenticated = !!req.user?.id;
    const safePerformers = isAuthenticated
      ? mapped
      : mapped.map(({ hlsUrl, ...rest }) => rest);

    res.json({ success: true, performers: safePerformers });
  } catch (error) {
    logger.error(`Performers featured error: ${error.message}`);
    res.json({ success: true, performers: [] });
  }
}));

app.get('/api/webapp/channels', softAuth, asyncHandler(async (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

  // Channel entities view
  if (req.query.view === 'channels') {
    try {
      const search = typeof req.query.search === 'string' ? req.query.search.trim() : null;
      const page = Math.max(0, parseInt(req.query.page, 10) || 0);
      const limit = Math.min(48, Math.max(1, parseInt(req.query.limit, 10) || 24));
      const offset = page * limit;

      const conditions = ['cc.is_active = true'];
      const params = [];
      let paramIdx = 1;
      if (search) {
        conditions.push(`(cc.name ILIKE $${paramIdx} OR cc.tags::text ILIKE $${paramIdx})`);
        params.push(`%${search}%`);
        paramIdx++;
      }

      const countRes = await getPool().query(`SELECT COUNT(*)::int AS total FROM creator_channels cc WHERE ${conditions.join(' AND ')}`, params);
      const total = countRes.rows[0]?.total || 0;

      const result = await getPool().query(
        `SELECT cc.*, u.username, u.first_name, u.last_name, u.photo_file_id, u.creator_verified,
                (SELECT COUNT(*)::int FROM channel_videos cv WHERE cv.channel_id = cc.id AND cv.status = 'published') AS video_count
         FROM creator_channels cc
         JOIN users u ON u.id = cc.creator_id
         WHERE ${conditions.join(' AND ')}
         ORDER BY cc.is_featured DESC, cc.post_count DESC, cc.created_at DESC
         LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
        [...params, limit, offset]
      );

      const channels = result.rows.map(ch => {
        const photo = ch.photo_file_id
          ? (ch.photo_file_id.startsWith('/') || ch.photo_file_id.startsWith('http') ? ch.photo_file_id : `/${ch.photo_file_id}`)
          : null;
        return {
          id: ch.id,
          creatorId: ch.creator_id,
          name: ch.name,
          slug: ch.slug,
          description: ch.description,
          coverImageUrl: ch.cover_image_url,
          tags: ch.tags || [],
          isPremium: ch.is_premium,
          accessType: ch.access_type,
          featured: ch.is_featured === true,
          postCount: ch.post_count,
          videoCount: ch.video_count || 0,
          subscriberCount: ch.subscriber_count,
          createdAt: ch.created_at,
          creatorName: [ch.first_name, ch.last_name].filter(Boolean).join(' ') || ch.username || 'Creator',
          creatorUsername: ch.username,
          creatorPhotoUrl: photo,
          creatorVerified: ch.creator_verified === true,
          telegramChannelId: ch.telegram_channel_id || null,
          bridgeEnabled: ch.bridge_enabled === true,
        };
      });

      const nextPage = offset + limit < total ? page + 1 : null;
      return res.json({ success: true, channels, nextPage, total });
    } catch (err) {
      logger.error('Channel entities list error:', err);
      return res.json({ success: true, channels: [], nextPage: null, total: 0 });
    }
  }

  try {
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : null;
    const type = typeof req.query.type === 'string' ? req.query.type : null;
    const featured = req.query.featured === 'true';
    const liveOnly = req.query.live === 'true';
    const sort = ['popular', 'newest', 'az'].includes(req.query.sort) ? req.query.sort : 'popular';
    const page = Math.max(0, parseInt(req.query.page, 10) || 0);
    const limit = Math.min(48, Math.max(1, parseInt(req.query.limit, 10) || 24));
    const offset = page * limit;

    const restreamerUrl = process.env.RESTREAMER_URL || 'http://restreamer:8080';
    const restreamerPublicUrl = (process.env.RESTREAMER_PUBLIC_URL || 'https://live.pnptv.app').replace(/\/$/, '');

    // Build dynamic query
    const conditions = ["u.creator_status = 'active'"];
    const params = [];
    let paramIdx = 1;

    if (search) {
      conditions.push(`(u.first_name ILIKE $${paramIdx} OR u.username ILIKE $${paramIdx} OR u.last_name ILIKE $${paramIdx})`);
      params.push(`%${search}%`);
      paramIdx++;
    }
    if (type) {
      conditions.push(`u.creator_type = $${paramIdx}`);
      params.push(type);
      paramIdx++;
    }
    if (featured) {
      conditions.push(`u.creator_featured = true`);
    }

    let orderBy;
    switch (sort) {
      case 'newest': orderBy = 'u.creator_enabled_at DESC NULLS LAST'; break;
      case 'az': orderBy = "LOWER(COALESCE(u.first_name, u.username, '')) ASC"; break;
      default: orderBy = 'u.creator_subscriber_count DESC NULLS LAST'; break;
    }

    // Count total
    const countQuery = `SELECT COUNT(*)::int AS total FROM users u WHERE ${conditions.join(' AND ')}`;

    // Fetch channels
    const [countResult, channelsResult] = await Promise.allSettled([
      getPool().query(countQuery, params),
      getPool().query(
        `SELECT u.id, u.username, u.first_name, u.last_name, u.photo_file_id, u.bio,
                u.creator_type, u.creator_status, u.creator_price_usd,
                u.creator_subscriber_count, u.creator_verified, u.creator_featured,
                u.live_channel, u.creator_enabled_at,
                (SELECT COUNT(*)::int FROM social_posts WHERE user_id = u.id AND is_deleted = false AND reply_to_id IS NULL) AS post_count
         FROM users u
         WHERE ${conditions.join(' AND ')}
         ORDER BY ${orderBy}
         LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
        [...params, limit, offset]
      ),
    ]);

    const total = countResult.status === 'fulfilled' ? (countResult.value.rows[0]?.total || 0) : 0;
    const rows = channelsResult.status === 'fulfilled' ? (channelsResult.value.rows || []) : [];

    // Map rows to response — live streaming disabled, isLive always false
    let channels = rows.map(c => {
      const uid = String(c.id);
      const photo = c.photo_file_id
        ? (c.photo_file_id.startsWith('/') || c.photo_file_id.startsWith('http') ? c.photo_file_id : `/${c.photo_file_id}`)
        : null;

      return {
        id: uid,
        username: c.username || null,
        displayName: [c.first_name, c.last_name].filter(Boolean).join(' ') || c.username || `Creator`,
        photoUrl: photo,
        bio: c.bio || null,
        creatorType: c.creator_type || 'ice',
        priceUsd: parseFloat(c.creator_price_usd) || 15,
        subscriberCount: c.creator_subscriber_count || 0,
        verified: c.creator_verified === true,
        featured: c.creator_featured === true,
        postCount: c.post_count || 0,
        isLive: false,
        hlsUrl: null,
      };
    });

    // liveOnly filter: no live streams currently, return empty if requested
    if (liveOnly) {
      channels = [];
    }

    const nextPage = offset + limit < total ? page + 1 : null;

    res.json({ success: true, channels, nextPage, total });
  } catch (error) {
    logger.error(`Channels list error: ${error.message}`);
    res.json({ success: true, channels: [], nextPage: null, total: 0 });
  }
}));

// Purchase access to a standalone paid hangout (not linked to a channel).
// For channel-linked paid hangouts, use POST /api/webapp/channels/:channelId/purchase
// instead — that route grants channel-access which covers the linked hangout.
app.post('/api/webapp/hangouts/groups/:id/purchase', requireSessionAuth, asyncHandler(async (req, res) => {
  const user = req.session?.user || req.user;
  const hangoutId = parseInt(req.params.id, 10);
  const { provider, email } = req.body || {};

  if (!Number.isFinite(hangoutId)) {
    return res.status(400).json({ error: 'Invalid hangout ID' });
  }
  if (!provider || !['dash', 'nowpayments'].includes(provider)) {
    return res.status(400).json({ error: 'Provider must be dash or nowpayments' });
  }

  const { rows: groups } = await getPool().query(
    `SELECT id, creator_id, is_paid, price_usd, channel_id, name
       FROM hangout_groups WHERE id = $1 LIMIT 1`,
    [hangoutId]
  );
  if (groups.length === 0) return res.status(404).json({ error: 'Hangout not found' });
  const hangout = groups[0];

  if (hangout.channel_id) {
    // Channel-linked hangouts are purchased via the channel route, which grants
    // channel-access covering both the channel and its linked hangout.
    return res.status(400).json({
      error: 'This hangout is linked to a channel. Purchase channel access instead.',
      channelId: hangout.channel_id,
    });
  }
  if (!hangout.is_paid || !hangout.price_usd || Number(hangout.price_usd) <= 0) {
    return res.status(400).json({ error: 'This hangout does not require payment' });
  }

  // Check if user already has access via the unified resolver.
  const EntitlementAccessService = require('../../services/entitlementAccessService');
  const decision = await EntitlementAccessService.hasResourceAccess(user.id, 'hangout', String(hangout.id));
  if (decision.allowed) {
    return res.status(400).json({ error: 'You already have access to this hangout' });
  }

  const hangoutPrice = Number(hangout.price_usd);
  const userId = String(user.telegram_id || user.id);
  const webappUrlHangout = process.env.WEBAPP_URL || 'https://pnptv.app';
  const scopeMetadata = {
    hangoutGroupId: hangout.id,
    hangoutName: hangout.name,
    ...(email ? { email } : {}),
  };

  // ── Dash / BTCPay branch ──────────────────────────────────────────────────
  if (provider === 'dash') {
    try {
      const orderId = `pnptv-hangout-${userId}-${hangout.id}-${Date.now()}`;
      const invoice = await createDashInvoice({
        usdAmount: hangoutPrice,
        userId,
        orderId,
        description: 'Community access',
        redirectUrl: `${webappUrlHangout}/chat/${hangout.id}`,
      });
      const insertRes = await getPool().query(
        `INSERT INTO dash_subscription_orders
           (user_id, plan_id, email, usd_amount, btcpay_invoice_id, status, metadata)
         VALUES ($1, 'hangout_access', $2, $3, $4, 'pending', $5)
         ON CONFLICT (btcpay_invoice_id) DO UPDATE
           SET status = dash_subscription_orders.status
         RETURNING id`,
        [userId, email || null, hangoutPrice, invoice.invoiceId, JSON.stringify(scopeMetadata)]
      );
      return res.json({
        success: true,
        paymentId: String(insertRes.rows[0].id),
        invoiceId: invoice.invoiceId,
        checkoutUrl: invoice.checkoutUrl,
      });
    } catch (err) {
      logger.error(`Hangout dash purchase failed: ${err.message}`);
      if (err.message?.includes('not configured')) {
        return res.status(503).json({ error: 'Crypto payments are not available yet.', code: 'BTCPAY_NOT_CONFIGURED' });
      }
      return res.status(500).json({ error: 'Failed to create Dash invoice. Please try again.', code: 'BTCPAY_ERROR' });
    }
  }

  // ── NowPayments branch ────────────────────────────────────────────────────
  if (provider === 'nowpayments') {
    const npApiKey = process.env.NOWPAYMENTS_API_KEY || '';
    if (!npApiKey) {
      return res.status(503).json({ error: 'Crypto payments are not available yet.', code: 'NOWPAYMENTS_NOT_CONFIGURED' });
    }
    const npUrl = process.env.NOWPAYMENTS_ENVIRONMENT === 'sandbox'
      ? 'https://api-sandbox.nowpayments.io/v1'
      : 'https://api.nowpayments.io/v1';
    try {
      const orderId = `pnptv-nowp-hangout-${userId}-${hangout.id}-${Date.now()}`;
      const paymentResp = await axios.post(`${npUrl}/invoice`, {
        price_amount: hangoutPrice,
        price_currency: 'usd',
        order_id: orderId,
        order_description: `Hangout access: ${hangout.name}`,
        ipn_callback_url: `${webappUrlHangout}/api/webhooks/nowpayments`,
        success_url: `${webappUrlHangout}/chat/${hangout.id}?payment=success`,
        ...(email ? { customer_email: email } : {}),
      }, {
        headers: { 'x-api-key': npApiKey, 'Content-Type': 'application/json' },
        timeout: 10000,
      });
      const { id: npInvoiceId } = paymentResp.data;
      if (!npInvoiceId) throw new Error('No invoice id in NowPayments response');
      const invoiceUrl = `https://nowpayments.io/payment?iid=${npInvoiceId}`;
      const insertRes = await getPool().query(
        `INSERT INTO dash_subscription_orders
           (user_id, plan_id, email, usd_amount, btcpay_invoice_id, status, metadata)
         VALUES ($1, 'hangout_access', $2, $3, $4, 'pending', $5)
         ON CONFLICT (btcpay_invoice_id) DO UPDATE
           SET status = dash_subscription_orders.status
         RETURNING id`,
        [userId, email || null, hangoutPrice, orderId, JSON.stringify({ ...scopeMetadata, provider: 'nowpayments', invoiceUrl })]
      );
      return res.json({
        success: true,
        paymentId: String(insertRes.rows[0].id),
        invoiceId: orderId,
        checkoutUrl: invoiceUrl,
      });
    } catch (err) {
      logger.error(`Hangout nowpayments purchase failed: ${err.message}`);
      return res.status(502).json({ error: 'Could not reach payment provider. Please try again.', code: 'NOWPAYMENTS_ERROR' });
    }
  }

  return res.status(400).json({ error: 'Unsupported provider' });
}));

// Purchase access to a paid channel (and its linked hangout).
// Creates a channel_access payment with channelId + hangoutGroupId in metadata
// so the webhook handler can scope the channel-access entitlement.
app.post('/api/webapp/channels/:channelId/purchase', requireSessionAuth, channelPurchaseLimiter, asyncHandler(async (req, res) => {
  const user = req.session?.user || req.user;
  const channelId = parseInt(req.params.channelId, 10);
  const { provider, email } = req.body || {};

  if (!Number.isFinite(channelId)) {
    return res.status(400).json({ error: 'Invalid channel ID' });
  }
  if (!provider || !['dash', 'nowpayments'].includes(provider)) {
    return res.status(400).json({ error: 'Provider must be dash or nowpayments' });
  }

  const { rows: channels } = await getPool().query(
    'SELECT id, creator_id, access_type, price_usd, hangout_group_id, name FROM creator_channels WHERE id = $1 AND is_active = true',
    [channelId]
  );
  if (channels.length === 0) return res.status(404).json({ error: 'Channel not found' });
  const channel = channels[0];

  if (channel.access_type === 'prime') {
    return res.status(400).json({ error: 'This channel is included with PRIME membership', code: 'PRIME_REQUIRED' });
  }

  if (channel.access_type !== 'paid' || !channel.price_usd || Number(channel.price_usd) <= 0) {
    return res.status(400).json({ error: 'This channel does not require payment' });
  }

  // Check if user already has access
  const { checkChannelAccess } = require('../../services/accessService');
  const access = await checkChannelAccess(user.id, channel);
  if (access.allowed) {
    return res.status(400).json({ error: 'You already have access to this channel' });
  }

  const channelPrice = Number(channel.price_usd);
  const userId = String(user.telegram_id || user.id);
  const webappUrlChannel = process.env.WEBAPP_URL || 'https://pnptv.app';
  const scopeMetadata = {
    channelId: channel.id,
    hangoutGroupId: channel.hangout_group_id,
    channelName: channel.name,
    ...(email ? { email } : {}),
  };

  // ── Dash / BTCPay branch (5% crypto discount) ─────────────────────────────
  if (provider === 'dash') {
    try {
      const discountedChannelPrice = Math.round(channelPrice * 0.95 * 100) / 100;
      const orderId = `pnptv-channel-${userId}-${channel.id}-${Date.now()}`;
      const invoice = await createDashInvoice({
        usdAmount: discountedChannelPrice,
        userId,
        orderId,
        description: `Channel access: ${channel.name}`,
        redirectUrl: `${webappUrlChannel}/chat/${channel.hangout_group_id || ''}`,
      });
      const insertRes = await getPool().query(
        `INSERT INTO dash_subscription_orders
           (user_id, plan_id, email, usd_amount, btcpay_invoice_id, status, metadata)
         VALUES ($1, 'channel_access', $2, $3, $4, 'pending', $5)
         ON CONFLICT (btcpay_invoice_id) DO UPDATE
           SET status = dash_subscription_orders.status
         RETURNING id`,
        [userId, email || null, discountedChannelPrice, invoice.invoiceId, JSON.stringify(scopeMetadata)]
      );
      return res.json({
        success: true,
        paymentId: String(insertRes.rows[0].id),
        invoiceId: invoice.invoiceId,
        checkoutUrl: invoice.checkoutUrl,
      });
    } catch (err) {
      logger.error(`Channel dash purchase failed: ${err.message}`);
      if (err.message?.includes('not configured')) {
        return res.status(503).json({ error: 'Crypto payments are not available yet.', code: 'BTCPAY_NOT_CONFIGURED' });
      }
      return res.status(500).json({ error: 'Failed to create Dash invoice. Please try again.', code: 'BTCPAY_ERROR' });
    }
  }

  // ── NowPayments branch ────────────────────────────────────────────────────
  if (provider === 'nowpayments') {
    const npApiKey = process.env.NOWPAYMENTS_API_KEY || '';
    if (!npApiKey) {
      return res.status(503).json({ error: 'Crypto payments are not available yet.', code: 'NOWPAYMENTS_NOT_CONFIGURED' });
    }
    const npUrl = process.env.NOWPAYMENTS_ENVIRONMENT === 'sandbox'
      ? 'https://api-sandbox.nowpayments.io/v1'
      : 'https://api.nowpayments.io/v1';
    try {
      const orderId = `pnptv-nowp-channel-${userId}-${channel.id}-${Date.now()}`;
      const paymentResp = await axios.post(`${npUrl}/invoice`, {
        price_amount: channelPrice,
        price_currency: 'usd',
        order_id: orderId,
        order_description: `Channel access: ${channel.name}`,
        ipn_callback_url: `${webappUrlChannel}/api/webhooks/nowpayments`,
        success_url: `${webappUrlChannel}/chat/${channel.hangout_group_id || ''}?payment=success`,
        ...(email ? { customer_email: email } : {}),
      }, {
        headers: { 'x-api-key': npApiKey, 'Content-Type': 'application/json' },
        timeout: 10000,
      });
      const { id: npInvoiceId } = paymentResp.data;
      if (!npInvoiceId) throw new Error('No invoice id in NowPayments response');
      const invoiceUrl = `https://nowpayments.io/payment?iid=${npInvoiceId}`;
      const insertRes = await getPool().query(
        `INSERT INTO dash_subscription_orders
           (user_id, plan_id, email, usd_amount, btcpay_invoice_id, status, metadata)
         VALUES ($1, 'channel_access', $2, $3, $4, 'pending', $5)
         ON CONFLICT (btcpay_invoice_id) DO UPDATE
           SET status = dash_subscription_orders.status
         RETURNING id`,
        [userId, email || null, channelPrice, orderId, JSON.stringify({ ...scopeMetadata, provider: 'nowpayments', invoiceUrl })]
      );
      return res.json({
        success: true,
        paymentId: String(insertRes.rows[0].id),
        invoiceId: orderId,
        checkoutUrl: invoiceUrl,
      });
    } catch (err) {
      logger.error(`Channel nowpayments purchase failed: ${err.message}`);
      return res.status(502).json({ error: 'Could not reach payment provider. Please try again.', code: 'NOWPAYMENTS_ERROR' });
    }
  }

  return res.status(400).json({ error: 'Unsupported provider' });
}));

app.get('/api/webapp/channels/:channelId', softAuth, asyncHandler(async (req, res) => {
  const channelId = parseInt(req.params.channelId, 10);
  if (!Number.isFinite(channelId)) return res.status(400).json({ error: 'Invalid channel ID' });

  try {
    // Fetch channel with creator info
    const chRes = await getPool().query(
      `SELECT cc.*, u.username, u.first_name, u.last_name, u.photo_file_id, u.creator_verified
       FROM creator_channels cc
       JOIN users u ON u.id = cc.creator_id
       WHERE cc.id = $1 AND cc.is_active = true`,
      [channelId]
    );
    if (!chRes.rows.length) return res.status(404).json({ error: 'Channel not found' });

    const ch = chRes.rows[0];
    const photo = ch.photo_file_id
      ? (ch.photo_file_id.startsWith('/') || ch.photo_file_id.startsWith('http') ? ch.photo_file_id : `/${ch.photo_file_id}`)
      : null;

    const viewerId = req.user?.id || req.session?.user?.id || null;
    const isOwner = viewerId !== null && String(viewerId) === String(ch.creator_id);
    const isCollaborator = !isOwner && Array.isArray(ch.collaborators) && ch.collaborators.includes(String(viewerId));

    const videoCountRes = await getPool().query(
      `SELECT COUNT(*)::int AS cnt FROM channel_videos WHERE channel_id = $1 AND status = 'published'`,
      [channelId]
    );
    // Resolve collaborator IDs to display info
    const collaboratorIds = Array.isArray(ch.collaborators) ? ch.collaborators.filter(Boolean) : [];
    let collaboratorProfiles = [];
    if (collaboratorIds.length > 0) {
      const collabRes = await getPool().query(
        `SELECT id::text AS id, username, first_name, last_name, photo_file_id, creator_verified
         FROM users WHERE id::text = ANY($1)`,
        [collaboratorIds]
      );
      collaboratorProfiles = collabRes.rows.map((u) => {
        const p = u.photo_file_id
          ? (u.photo_file_id.startsWith('/') || u.photo_file_id.startsWith('http') ? u.photo_file_id : `/${u.photo_file_id}`)
          : null;
        return {
          id: u.id,
          name: [u.first_name, u.last_name].filter(Boolean).join(' ') || u.username || 'Creator',
          username: u.username,
          photoUrl: p,
          verified: u.creator_verified === true,
        };
      });
    }

    const channel = {
      id: ch.id,
      creatorId: ch.creator_id,
      name: ch.name,
      slug: ch.slug,
      description: ch.description,
      coverImageUrl: ch.cover_image_url,
      tags: ch.tags || [],
      isPremium: ch.is_premium,
      accessType: ch.access_type || (ch.is_premium ? 'subscription' : 'free'),
      postCount: ch.post_count,
      videoCount: videoCountRes.rows[0]?.cnt || 0,
      createdAt: ch.created_at,
      creatorName: [ch.first_name, ch.last_name].filter(Boolean).join(' ') || ch.username || 'Creator',
      creatorUsername: ch.username,
      creatorPhotoUrl: photo,
      creatorVerified: ch.creator_verified === true,
      telegramChannelId: ch.telegram_channel_id || null,
      bridgeEnabled: ch.bridge_enabled === true,
      collaborators: collaboratorIds,
      collaboratorProfiles,
      isOwner,
      isCollaborator,
    };

    // Check access — owner/collaborator always allowed; otherwise delegate to
    // entitlement resolver (handles free/prime/subscription/paid + global prime override).
    let locked = false;
    let lockReason = null;
    if (!isOwner && !isCollaborator) {
      if (!viewerId) {
        locked = true;
        lockReason = ch.access_type === 'free' ? null : 'AUTH_REQUIRED';
        if (ch.access_type === 'free') locked = false;
      } else {
        const decision = await EntitlementAccessService.hasResourceAccess(viewerId, 'channel', channelId);
        if (!decision.allowed) {
          locked = true;
          lockReason = decision.code || 'ACCESS_DENIED';
        }
      }
    }

    // Fetch channel videos (if not locked)
    let videos = [];
    if (!locked) {
      const videosRes = await getPool().query(
        `SELECT id, title, description, tags, duration_sec, thumbnail_url, gif_url, video_url,
                status, created_at, directus_file_id, view_count, promo_post_id, tagged_creator_ids
         FROM channel_videos
         WHERE channel_id = $1 AND status = 'published'
         ORDER BY created_at DESC
         LIMIT 100`,
        [channelId]
      );
      const directusBase = (process.env.DIRECTUS_PUBLIC_URL || 'https://cms.pnptv.app').replace(/\/$/, '');

      // Resolve tagged_creator_ids to display info in one bulk query
      const allTaggedIds = [...new Set(videosRes.rows.flatMap((cv) => cv.tagged_creator_ids || []))];
      const taggedCreatorMap = {};
      if (allTaggedIds.length > 0) {
        const tcRes = await getPool().query(
          `SELECT id::text AS id, username, first_name,
                  CASE WHEN photo_file_id IS NOT NULL THEN '/uploads/avatars/' || photo_file_id ELSE NULL END AS avatar_url
           FROM users WHERE id::text = ANY($1)`,
          [allTaggedIds]
        );
        for (const u of tcRes.rows) taggedCreatorMap[u.id] = u;
      }

      videos = videosRes.rows.map((cv) => {
        const taggedIds = cv.tagged_creator_ids || [];
        return {
          id: cv.id,
          title: cv.title,
          description: cv.description,
          tags: cv.tags || [],
          duration_sec: cv.duration_sec,
          thumbnail_url: cv.thumbnail_url,
          gif_url: cv.gif_url,
          directus_file_id: cv.directus_file_id ?? null,
          directus_video_url: cv.directus_file_id ? `${directusBase}/assets/${cv.directus_file_id}` : null,
          video_url: `/api/webapp/channels/${channelId}/videos/${cv.id}/stream`,
          status: cv.status,
          created_at: cv.created_at,
          view_count: cv.view_count ?? 0,
          promo_post_id: cv.promo_post_id ?? null,
          tagged_creator_ids: taggedIds,
          tagged_creators: taggedIds.map((id) => taggedCreatorMap[id]).filter(Boolean),
        };
      });
    }

    // Fetch channel posts (if not locked)
    let posts = [];
    if (!locked) {
      const postsRes = await getPool().query(
        `SELECT sp.id, sp.content, sp.media_url, sp.media_type, sp.created_at,
                sp.likes_count, sp.replies_count, sp.is_exclusive, sp.content_tier, sp.metadata,
                sp.content_type, sp.x_embed_url, sp.channel_id,
                u.id::text AS author_id, u.username, u.first_name, u.last_name,
                u.photo_file_id, u.creator_verified
         FROM social_posts sp
         JOIN users u ON u.id = sp.user_id
         WHERE sp.channel_id = $1 AND sp.is_deleted = false
         ORDER BY sp.created_at DESC
         LIMIT 100`,
        [channelId]
      );
      posts = postsRes.rows.map((sp) => {
        const authorPhoto = sp.photo_file_id
          ? (sp.photo_file_id.startsWith('/') || sp.photo_file_id.startsWith('http') ? sp.photo_file_id : `/${sp.photo_file_id}`)
          : null;
        return {
          id: sp.id,
          content: sp.content,
          media_url: sp.media_url,
          media_type: sp.media_type,
          created_at: sp.created_at,
          likes_count: sp.likes_count ?? 0,
          replies_count: sp.replies_count ?? 0,
          reposts_count: 0,
          reply_to_id: null,
          repost_of_id: null,
          liked_by_me: false,
          is_exclusive: sp.is_exclusive ?? false,
          content_tier: sp.content_tier ?? 'free',
          metadata: sp.metadata ?? null,
          content_type: sp.content_type ?? null,
          x_embed_url: sp.x_embed_url ?? null,
          channel_id: sp.channel_id ?? null,
          author_id: sp.author_id,
          author_username: sp.username,
          author_first_name: sp.first_name || sp.username || '',
          author_photo: authorPhoto,
        };
      });
    }

    res.json({ success: true, channel, videos, posts, locked, lockReason });
  } catch (err) {
    logger.error('Channel detail error:', err);
    res.status(500).json({ error: 'Failed to load channel' });
  }
}));

// Stream a channel video through the backend so that:
//  1. Range requests return proper 206 (Safari/iOS requires this)
//  2. The actual bytes are gated by hasResourceAccess (Directus URLs were public)
app.get('/api/webapp/channels/:channelId/videos/:videoId/stream', softAuth, asyncHandler(async (req, res) => {
  const { channelId, videoId } = req.params;
  const viewerId = req.session?.user?.id;
  const viewerRole = req.session?.user?.role || '';

  try {
    const { rows } = await getPool().query(
      `SELECT cv.directus_file_id, cv.video_url, cc.creator_id
       FROM channel_videos cv
       JOIN creator_channels cc ON cc.id = cv.channel_id
       WHERE cv.id = $1 AND cv.channel_id = $2 AND cv.status = 'published'`,
      [videoId, channelId]
    );

    if (!rows[0]) return res.status(404).json({ error: 'Video not found' });

    const video = rows[0];
    const isAdmin = viewerRole === 'admin' || viewerRole === 'superadmin';
    const isAuthor = viewerId && String(viewerId) === String(video.creator_id);

    if (!isAdmin && !isAuthor) {
      if (!viewerId) return res.status(401).json({ error: 'Authentication required' });
      const decision = await EntitlementAccessService.hasResourceAccess(viewerId, 'channel', channelId);
      if (!decision.allowed) return res.status(403).json({ error: 'Access denied', code: decision.code });
    }

    const directusInternal = process.env.DIRECTUS_URL || process.env.DIRECTUS_INTERNAL_URL || 'http://directus:8055';
    const upstreamUrl = `${directusInternal}/assets/${video.directus_file_id}`;

    const upstreamHeaders = {};
    if (req.headers['range']) upstreamHeaders['Range'] = req.headers['range'];
    if (req.headers['if-range']) upstreamHeaders['If-Range'] = req.headers['if-range'];

    const upstream = await axios({
      method: 'GET',
      url: upstreamUrl,
      responseType: 'stream',
      headers: upstreamHeaders,
      validateStatus: (s) => s < 500,
      timeout: 10000,
    });

    res.status(upstream.status);
    for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag']) {
      if (upstream.headers[h]) res.set(h, upstream.headers[h]);
    }
    res.set('Cache-Control', 'private, max-age=3600');

    upstream.data.pipe(res);
  } catch (err) {
    logger.error('Channel video stream error', { videoId, channelId, error: err.message });
    if (!res.headersSent) res.status(502).json({ error: 'Video unavailable' });
  }
}));

app.get('/api/performers', softAuth, asyncHandler(async (req, res) => {
  // Live status changes frequently — prevent browser from caching stale isLive values.
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  try {
    const restreamerUrl = process.env.RESTREAMER_URL || 'http://restreamer:8080';
    const restreamerPublicUrl = (process.env.RESTREAMER_PUBLIC_URL || 'https://live.pnptv.app').replace(/\/$/, '');

    // Fetch from Directus CMS and active creators in DB — in parallel
    const [directusResult, dbResult] = await Promise.allSettled([
      axios.get(`${DIRECTUS_INTERNAL_URL}/items/performers`, {
        params: {
          'filter[status][_eq]': 'published',
          'fields[]': DIRECTUS_PERFORMER_FIELDS,
          sort: 'name',
          limit: 50,
        },
        timeout: 10000,
      }),
      getPool().query(
        `SELECT id, username, first_name, last_name, photo_file_id, bio,
                creator_type, creator_status, creator_price_usd
         FROM users
         WHERE creator_status = 'active'
           AND creator_locked = FALSE
           AND is_deleted = FALSE
           AND (
             identity_verified = TRUE
             OR (identity_verification_required_by IS NOT NULL AND identity_verification_required_by > NOW())
           )
         ORDER BY first_name ASC
         LIMIT 100`
      ),
    ]);

    const directusPerformers = directusResult.status === 'fulfilled'
      ? (directusResult.value.data?.data || [])
      : [];
    const dbCreators = dbResult.status === 'fulfilled'
      ? (dbResult.value.rows || [])
      : [];

    // Map Directus performers
    const photoMap = await fetchPerformerPhotos(directusPerformers);
    const mapped = directusPerformers.map(p => mapDirectusPerformer(p, photoMap));

    // Track which DB user IDs and slugs are already covered by Directus performers
    const coveredUserIds = new Set(
      directusPerformers.filter(p => p.pnptv_id).map(p => String(p.pnptv_id))
    );
    const coveredSlugs = new Set(
      directusPerformers.filter(p => p.slug).map(p => String(p.slug).toLowerCase())
    );

    // Add active creators from DB that aren't already in Directus
    for (const c of dbCreators) {
      if (coveredUserIds.has(String(c.id))) continue;
      if (c.username && coveredSlugs.has(String(c.username).toLowerCase())) continue;
      const photo = c.photo_file_id
        ? (c.photo_file_id.startsWith('/') ? c.photo_file_id : `/${c.photo_file_id}`)
        : null;
      mapped.push({
        id: `db-${c.id}`,
        userId: c.id,
        slug: c.username || null,
        displayName: [c.first_name, c.last_name].filter(Boolean).join(' ') || c.username || `Creator ${c.id}`,
        bio: c.bio || null,
        photoUrl: photo,
        isFeatured: false,
        isAvailable: true,
        basePrice: c.creator_price_usd || 100,
        totalCalls: 0,
        averageRating: 0,
      });
    }

    // Inject online presence + accepting-calls flag: check Redis keys for each performer
    try {
      const redis = getRedis();
      const userIds = mapped.map(p => p.userId).filter(Boolean).map(String);
      if (userIds.length > 0) {
        // FIX HIGH-08: fetch both active and accepting_calls keys in parallel
        const [onlineResults, acceptingResults] = await Promise.all([
          Promise.all(userIds.map(id => redis.get(`user:${id}:active`))),
          Promise.all(userIds.map(id => redis.get(`user:${id}:accepting_calls`))),
        ]);
        const onlineIds = new Set(userIds.filter((_, i) => onlineResults[i] !== null && onlineResults[i] !== '0'));
        const acceptingIds = new Set(userIds.filter((_, i) => acceptingResults[i] !== null && acceptingResults[i] !== '0'));
        for (const entry of mapped) {
          if (entry.userId && onlineIds.has(String(entry.userId))) {
            entry.isOnline = true;
          }
          entry.isAcceptingCalls = !!(entry.userId && acceptingIds.has(String(entry.userId)));
        }
      }
    } catch (presenceErr) {
      logger.warn(`performers: presence check failed (non-fatal): ${presenceErr.message}`);
    }

    const safePerformers = mapped;

    res.json({ success: true, performers: safePerformers });
  } catch (error) {
    logger.error(`Performers all error: ${error.message}`);
    res.json({ success: true, performers: [] });
  }
}));

// --- Live Tips Proxy (PNP Live tipping system) ---
const PNPLiveTipsService = require('../../services/pnpLiveTipsService');

// ─── Events ──────────────────────────────────────────────────────────────────
// GET /api/proxy/events/upcoming — Public upcoming events feed
app.get('/api/proxy/events/upcoming', asyncHandler(eventsController.getUpcoming));
// GET /api/proxy/events/featured — Featured/pinned upcoming events
app.get('/api/proxy/events/featured', asyncHandler(eventsController.getFeatured));
// GET /api/proxy/events/:id — Single event detail
app.get('/api/proxy/events/:id', asyncHandler(eventsController.getEvent));

// POST /api/webapp/events — Create event (authenticated)
app.post('/api/webapp/events', requireSessionAuth, asyncHandler(eventsController.createEvent));
// GET /api/webapp/events/mine — Creator's own events
app.get('/api/webapp/events/mine', requireSessionAuth, asyncHandler(eventsController.myEvents));
// GET /api/webapp/events/my-rsvps — Events the user has RSVP'd to
app.get('/api/webapp/events/my-rsvps', requireSessionAuth, asyncHandler(eventsController.myRsvps));
// PUT /api/webapp/events/:id — Update event (creator only)
app.put('/api/webapp/events/:id', requireSessionAuth, asyncHandler(eventsController.updateEvent));
// DELETE /api/webapp/events/:id — Cancel event (creator only)
app.delete('/api/webapp/events/:id', requireSessionAuth, asyncHandler(eventsController.cancelEvent));
// POST /api/webapp/events/:id/rsvp — RSVP to event
app.post('/api/webapp/events/:id/rsvp', requireSessionAuth, asyncHandler(eventsController.rsvpEvent));
// DELETE /api/webapp/events/:id/rsvp — Un-RSVP
app.delete('/api/webapp/events/:id/rsvp', requireSessionAuth, asyncHandler(eventsController.unrsvpEvent));
// PUT /api/webapp/admin/events/:id/feature — Feature/unfeature event (admin)
app.put('/api/webapp/admin/events/:id/feature', requireSessionAuth, adminGuard, asyncHandler(eventsController.featureEvent));

// ── Onboarding wizard ──────────────────────────────────────────────────────
const onboardingController = require('./controllers/onboardingController');
// GET  /api/webapp/onboarding/status  — current step completion state
// POST /api/webapp/onboarding/step    — record a single step { step, payload? }
// POST /api/webapp/onboarding/complete — finalize after all steps verified server-side
// NOTE: these routes intentionally bypass the age/terms consent gate so that
// new users can complete onboarding before age_verified / terms_accepted are set.
app.get('/api/webapp/onboarding/status', requireSessionAuthNoConsent, asyncHandler(onboardingController.getStatus));
app.post('/api/webapp/onboarding/step', requireSessionAuthNoConsent, asyncHandler(onboardingController.markStep));
app.post('/api/webapp/onboarding/complete', requireSessionAuthNoConsent, asyncHandler(onboardingController.completeOnboarding));

// GET /api/proxy/live/performers — List performers from Directus for tip picker
app.get('/api/proxy/live/performers', requireSessionAuth, livePerformersLimiter, asyncHandler(async (req, res) => {
  try {
    const resp = await axios.get(`${DIRECTUS_INTERNAL_URL}/items/performers`, {
      params: {
        'filter[status][_eq]': 'published',
        // is_featured and is_available were missing — tip picker needs both to display correctly
        'fields[]': ['id', 'name', 'slug', 'bio', 'photo', 'is_featured', 'is_available', 'categories'],
        sort: '-is_featured,name',
        limit: 50,
      },
      timeout: 10000,
    });
    const performers = (resp.data?.data || []).map(p => ({
      id: String(p.id),
      name: p.name,
      slug: p.slug,
      bio: p.bio || '',
      photo: p.photo ? `https://cms.pnptv.app/assets/${p.photo}` : null,
      // is_featured and is_available were absent from response — featured performers
      // were indistinguishable from regular ones, and unavailable performers were shown
      isFeatured: p.is_featured || false,
      isAvailable: p.is_available !== false,
      categories: p.categories || [],
    }));
    res.json({ success: true, performers });
  } catch (error) {
    logger.error(`Live performers proxy error: ${error.message}`);
    res.json({ success: true, performers: [] });
  }
}));

// POST /api/proxy/live/tips — Create a tip (member+ required)
// paymentMethod: 'tokens' (instant, deducts from wallet) | 'dash' (BTCPay invoice)
app.post('/api/proxy/live/tips', requireSessionAuth, tipLimiter, asyncHandler(async (req, res) => {
  const user = req.session?.user;

  let { paymentMethod = 'tokens' } = req.body;
  const { performerId, amount, message, idempotencyKey } = req.body;
  if (!performerId || !amount) {
    return res.status(400).json({ success: false, error: 'performerId and amount are required' });
  }

  const validAmounts = PNPLiveTipsService.TIP_AMOUNTS;
  const numAmount = parseFloat(amount);
  if (!validAmounts.includes(numAmount)) {
    return res.status(400).json({ success: false, error: `Amount must be one of: ${validAmounts.join(', ')}` });
  }

  if (!['tokens', 'dash'].includes(paymentMethod)) {
    return res.status(400).json({ success: false, error: 'paymentMethod must be tokens or dash' });
  }

  try {
    const userId = String(user.telegram_id || user.id);

    // --- Resolve performer ID ---
    // The frontend may send:
    //   a) A full Restreamer process ID:  'restreamer-ui:ingest:pnptv-santino'
    //   b) A plain channel ref:           'pnptv-santino'
    //   c) A numeric Directus performer ID (passthrough)
    // Resolve (a) and (b) to the actual performer via the users.live_channel → performers chain.
    let resolvedPerformerId = String(performerId);
    const restreamerMatch = resolvedPerformerId.match(/^restreamer-ui:ingest:([\w-]+)$/);
    // Plain channel ref: contains a hyphen, starts with a non-numeric prefix, and is not a UUID
    const plainChannelRef = !restreamerMatch && /^[a-zA-Z][\w-]+$/.test(resolvedPerformerId) && !/^\d+$/.test(resolvedPerformerId)
      ? resolvedPerformerId
      : null;
    const channelRefToResolve = restreamerMatch ? restreamerMatch[1] : plainChannelRef;
    if (channelRefToResolve) {
      try {
        const { rows } = await getPool().query(
          `SELECT p.id AS performer_id FROM performers p
           JOIN users u ON p.user_id = u.id
           WHERE u.live_channel = $1
           LIMIT 1`,
          [channelRefToResolve]
        );
        if (rows.length > 0 && rows[0].performer_id) {
          resolvedPerformerId = String(rows[0].performer_id);
        } else {
          // No performer linked — try using the user ID directly as performer lookup
          const userRows = await getPool().query('SELECT id FROM users WHERE live_channel = $1 LIMIT 1', [channelRefToResolve]);
          if (userRows.rows.length > 0) {
            resolvedPerformerId = String(userRows.rows[0].id);
          }
        }
      } catch (resolveErr) {
        logger.warn(`Tips: failed to resolve channel ref '${channelRefToResolve}' to performer: ${resolveErr.message}`);
      }
    }

    // --- Validate performer existence ---
    // performers in the tip picker come from Directus CMS via /api/proxy/live/performers.
    // We validate against the same source: a Directus items/performers lookup.
    // Fall back to a local DB lookup if Directus is unreachable.
    let performerValidated = false;
    try {
      const performerResp = await axios.get(`${DIRECTUS_INTERNAL_URL}/items/performers`, {
        params: {
          'filter[id][_eq]': resolvedPerformerId,
          'filter[status][_eq]': 'published',
          'fields[]': ['id', 'name'],
          limit: 1,
        },
        timeout: 5000,
      });
      const found = performerResp.data?.data;
      performerValidated = Array.isArray(found) && found.length > 0;
    } catch (validationErr) {
      logger.warn(`Tips: Directus validation failed for id=${resolvedPerformerId}: ${validationErr.message}`);
    }

    // Fallback: check local performers table if Directus validation failed
    if (!performerValidated) {
      try {
        const localCheck = await getPool().query(
          'SELECT id FROM performers WHERE id::text = $1 OR user_id = $1 LIMIT 1',
          [resolvedPerformerId]
        );
        performerValidated = localCheck.rows.length > 0;
      } catch { /* ignore */ }
    }

    if (!performerValidated) {
      return res.status(404).json({ success: false, error: 'Performer not found' });
    }

    // CRIT-03: Self-tip prevention (route-level gate).
    // Look up the user_id that owns this performer record and reject if it matches
    // the authenticated tipper. This blocks a creator from tipping themselves to
    // farm platform earnings or inflate token stats.
    try {
      const selfCheck = await getPool().query(
        'SELECT user_id FROM performers WHERE id::text = $1 OR user_id = $1 LIMIT 1',
        [resolvedPerformerId]
      );
      if (selfCheck.rows.length > 0 && String(selfCheck.rows[0].user_id) === String(userId)) {
        return res.status(400).json({ success: false, error: 'self_tip_forbidden' });
      }
    } catch (selfErr) {
      logger.warn(`Tips: self-tip check failed (non-fatal): ${selfErr.message}`);
    }

    // Look up performer name for payment description
    let performerName = resolvedPerformerId;
    try {
      const performer = await PerformerModel.getById(resolvedPerformerId);
      if (performer) performerName = performer.displayName;
    } catch { /* ignore */ }

    // --- Token-based instant tip ---
    if (paymentMethod === 'tokens') {
      // processTipWithTokens atomically debits wallet + inserts tip + emits sockets in one transaction.
      // ON CONFLICT on idempotency_key inside processTipWithTokens makes this dedup-safe atomically.
      let tokenTipResult;
      try {
        tokenTipResult = await PNPLiveTipsService.processTipWithTokens(
          userId, numAmount, (message || '').slice(0, 200), resolvedPerformerId, idempotencyKey || null
        );
      } catch (tokenErr) {
        if (tokenErr.name === 'InsufficientFundsError') {
          return res.status(402).json({ success: false, error: 'Insufficient token balance' });
        }
        throw tokenErr;
      }

      return res.json({
        success: true,
        tipId: tokenTipResult.tip.id,
        paymentUrl: null,
        amount: numAmount,
        paymentMethod: 'tokens',
        newBalance: tokenTipResult.newBalance,
        duplicate: tokenTipResult.duplicate || false,
      });
    }

    // --- Dash direct tip (BTCPay invoice) ---
    if (paymentMethod === 'dash') {
      const { createInvoice: createBtcpayInvoiceForTip } = require('../../config/btcpay');

      // LIVE-H-05: Redis dedup lock — prevents double-submission of Dash tips.
      // Key is scoped to creatorId + userId; 10s TTL covers the invoice-creation window.
      const dashTipLockKey = `live:tip:dash:${resolvedPerformerId}:${userId}`;
      try {
        const dashLockRedis = getRedis();
        if (dashLockRedis) {
          const dashLockAcquired = await dashLockRedis.set(dashTipLockKey, '1', 'NX', 'EX', 10);
          if (!dashLockAcquired) {
            return res.status(429).json({ success: false, error: 'Tip already in progress. Please wait a moment.' });
          }
        }
      } catch (dashLockErr) {
        logger.warn('Dash tip dedup lock check failed (fail-open)', { userId, performerId: resolvedPerformerId, error: dashLockErr.message });
      }

      // Create tip record first (pending)
      const tip = await PNPLiveTipsService.createTip(
        userId, null, null,
        numAmount,
        (message || '').slice(0, 200),
        String(resolvedPerformerId)
      );

      if (!tip) {
        return res.status(500).json({ success: false, error: 'Failed to create tip' });
      }

      // Create BTCPay invoice — use createInvoice (not createDashInvoice) so tip
      // metadata is threaded into BTCPay's record. The webhook handler reads
      // event.metadata.{type,tipId,userId,performerId} on InvoiceSettled.
      // planId='tip' is required by createInvoice but is informational only here.
      try {
        const inv = await createBtcpayInvoiceForTip({
          amount: numAmount,
          currency: 'USD',
          orderId: `pnptv-tips-${userId}-${tip.id}`,
          userId,
          planId: 'tip',
          metadata: {
            type: 'tip',
            tipId: tip.id,
            userId,
            performerId: String(resolvedPerformerId),
          },
          redirectUrl: `${process.env.WEBAPP_URL || 'https://pnptv.app'}/live`,
        });

        // Store invoice ID on the tip record
        await getPool().query(
          `UPDATE pnp_tips SET transaction_id = $2, payment_method = 'dash' WHERE id = $1`,
          [tip.id, inv.invoiceId]
        );

        return res.json({
          success: true,
          tipId: tip.id,
          invoiceId: inv.invoiceId,
          checkoutUrl: inv.checkoutLink,
          paymentUrl: null,
          amount: numAmount,
          paymentMethod: 'dash',
        });
      } catch (tipInvErr) {
        logger.error(`Live tip Dash invoice creation failed: ${tipInvErr.message}`);
        // Mark the tip cancelled so it doesn't sit pending forever
        await getPool().query(
          `UPDATE pnp_tips SET payment_status = 'cancelled' WHERE id = $1 AND payment_status = 'pending'`,
          [tip.id]
        ).catch(() => {});
        if (tipInvErr.message?.includes('not configured')) {
          return res.status(503).json({ success: false, error: 'Crypto tips are not available yet. Please use tokens.', code: 'BTCPAY_NOT_CONFIGURED' });
        }
        return res.status(500).json({ success: false, error: 'Failed to create Dash tip invoice. Please try again.', code: 'BTCPAY_ERROR' });
      }
    }

    // Unreachable — the early payment-method gate above guarantees one of the
    // two return-path blocks above (tokens / dash) handled the request.
    return res.status(500).json({ success: false, error: 'Unhandled payment method' });
  } catch (error) {
    logger.error(`Live tips proxy create error: ${error.message}`);
    res.status(500).json({ success: false, error: 'Failed to create tip' });
  }
}));

// GET /api/proxy/live/tips/recent — Recent completed tips (auth required)
app.get('/api/proxy/live/tips/recent', requireSessionAuth, asyncHandler(async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 10, 50);
    const tips = await PNPLiveTipsService.getRecentTips(limit, 30);
    res.json({
      success: true,
      tips: (tips || []).map(t => ({
        id: t.id,
        amount: parseFloat(t.amount),
        user_username: t.user_username || 'Anonymous',
        model_name: t.model_name || 'Performer',
        created_at: t.created_at,
        payment_status: t.payment_status,
      })),
    });
  } catch (error) {
    logger.error(`Live tips proxy recent error: ${error.message}`);
    res.json({ success: true, tips: [] });
  }
}));

// POST /api/webapp/live/heartbeat — deduct 1 token/min from viewer while watching a live stream.
// Returns new balance; INSUFFICIENT_FUNDS signals frontend to pause and show buy-tokens prompt.
app.post('/api/webapp/live/heartbeat', requireSessionAuth, rateLimit({ windowMs: 50 * 1000, max: 3, standardHeaders: true, legacyHeaders: false }), asyncHandler(async (req, res) => {
  const { channelRef } = req.body;
  if (!channelRef || typeof channelRef !== 'string') {
    return res.status(400).json({ success: false, error: 'channelRef is required' });
  }
  const userId = String(req.session.user.telegram_id || req.session.user.id);
  const { processStreamHeartbeat } = require('../../services/tokenService');
  const result = await processStreamHeartbeat(userId, channelRef);
  if (!result.success) {
    const status = result.error === 'INSUFFICIENT_FUNDS' ? 402 : 400;
    return res.status(status).json({ success: false, error: result.error });
  }
  res.json({ success: true, newBalance: result.newBalance });
}));

// ==========================================
// TIP GOALS
// ==========================================

// CR-SQ-03: 30 goal updates per minute per user — prevents Socket.IO broadcast flood
const goalUpdateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: (req) => String(req.session?.user?.id || req.ip),
  handler: (req, res) => res.status(429).json({ success: false, error: 'Too many goal updates. Please slow down.' }),
  standardHeaders: true,
  legacyHeaders: false,
});

// Tip-goal storage lives in Redis at `stream:goal:<channelRef>` as a hash with
// { amount, label, progress, completed, updated_at }. This decouples the goal
// from `live_streams` DB rows (which are NOT created for OBS-based creators),
// lets creators prep a goal BEFORE going live, and survives across stream
// sessions. TTL is 7 days; the creator's DELETE clears it explicitly.
const GOAL_TTL_SECONDS = 7 * 24 * 60 * 60;
const goalKey = (channelRef) => `stream:goal:${channelRef}`;

async function readGoalFromRedis(channelRef) {
  const redis = getRedis();
  const h = await redis.hgetall(goalKey(channelRef));
  if (!h || !h.amount) return null;
  const goalAmount = parseFloat(h.amount);
  const progress = parseFloat(h.progress || '0');
  return {
    goalAmount: Number.isFinite(goalAmount) ? goalAmount : null,
    goalLabel: h.label || null,
    progress: Number.isFinite(progress) ? progress : 0,
    completed: h.completed === '1' || h.completed === 'true',
  };
}

// POST /api/webapp/live/goal — creator sets a tip goal. Works whether the
// creator is currently live or prepping in advance.
app.post('/api/webapp/live/goal', requireSessionAuth, roleGuard('model', 'creator', 'admin', 'superadmin'), goalUpdateLimiter, asyncHandler(async (req, res) => {
  const user = req.session.user;
  const userId = String(user.id);
  const { amount, label } = req.body;

  const parsedAmount = parseFloat(amount);
  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0 || parsedAmount > 10000) {
    return res.status(400).json({ success: false, error: 'amount must be a positive number ≤ 10000' });
  }
  if (!label || typeof label !== 'string' || label.trim().length === 0 || label.trim().length > 120) {
    return res.status(400).json({ success: false, error: 'label must be a non-empty string ≤ 120 characters' });
  }
  const safeLabel = label.trim();

  try {
    const { rows: userRows } = await query(
      'SELECT live_channel FROM users WHERE id = $1',
      [userId]
    );
    const channelRef = userRows[0]?.live_channel;
    if (!channelRef) {
      return res.status(400).json({ success: false, error: 'No channel assigned to your account' });
    }

    // Reset progress + completed on every new-goal write. Existing progress
    // (from prior partial goal) is deliberately discarded when the creator
    // sets a fresh goal — mirrors the old DB behavior on 9814-9815.
    const redis = getRedis();
    const key = goalKey(channelRef);
    await redis.hset(key, {
      amount: String(parsedAmount),
      label: safeLabel,
      progress: '0',
      completed: '0',
      updated_at: new Date().toISOString(),
    });
    await redis.expire(key, GOAL_TTL_SECONDS);

    // Also invalidate the 30s public read cache so viewers see the new goal
    // immediately instead of waiting for TTL.
    try { await cache.del(`live:goal:${channelRef}`); } catch (_) { /* best-effort */ }

    const payload = { goalAmount: parsedAmount, goalLabel: safeLabel, progress: 0, completed: false };

    try {
      const socketSingleton = require('../../services/socketSingleton');
      const io = socketSingleton.get();
      if (io) io.to(`live:${channelRef}`).emit('live:goal_update', payload);
    } catch (sockErr) {
      logger.warn('live/goal POST: socket emit failed (non-fatal)', { error: sockErr.message });
    }

    return res.json({ success: true, goal: payload });
  } catch (err) {
    logger.error('POST /api/webapp/live/goal error', { error: err.message });
    return res.status(500).json({ success: false, error: 'Failed to set tip goal' });
  }
}));

// DELETE /api/webapp/live/goal — creator clears the tip goal. Same rate-limit
// bucket as POST since they're paired ops on the same resource.
app.delete('/api/webapp/live/goal', requireSessionAuth, roleGuard('model', 'creator', 'admin', 'superadmin'), goalUpdateLimiter, asyncHandler(async (req, res) => {
  const user = req.session.user;
  const userId = String(user.id);

  try {
    const { rows: userRows } = await query(
      'SELECT live_channel FROM users WHERE id = $1',
      [userId]
    );
    const channelRef = userRows[0]?.live_channel;
    if (!channelRef) {
      return res.status(400).json({ success: false, error: 'No channel assigned to your account' });
    }

    const redis = getRedis();
    await redis.del(goalKey(channelRef));
    try { await cache.del(`live:goal:${channelRef}`); } catch (_) { /* best-effort */ }

    try {
      const socketSingleton = require('../../services/socketSingleton');
      const io = socketSingleton.get();
      if (io) {
        io.to(`live:${channelRef}`).emit('live:goal_update', {
          goalAmount: null,
          goalLabel: null,
          progress: 0,
          completed: false,
        });
      }
    } catch (sockErr) {
      logger.warn('live/goal DELETE: socket emit failed (non-fatal)', { error: sockErr.message });
    }

    return res.json({ success: true });
  } catch (err) {
    logger.error('DELETE /api/webapp/live/goal error', { error: err.message });
    return res.status(500).json({ success: false, error: 'Failed to clear tip goal' });
  }
}));

// GET /api/proxy/live/goal/:channelRef — public, returns current goal state (30s cache)
app.get('/api/proxy/live/goal/:channelRef', overlayPublicLimiter, asyncHandler(async (req, res) => {
  const channelRef = String(req.params.channelRef || '').trim();
  if (!channelRef || !/^[a-zA-Z0-9-]+$/.test(channelRef)) {
    return res.status(400).json({ success: false, error: 'Invalid channelRef' });
  }

  const cacheKey = `live:goal:${channelRef}`;
  try {
    const cached = await cache.get(cacheKey);
    if (cached) {
      return res.json({ success: true, ...JSON.parse(cached) });
    }
  } catch (_) { /* cache miss, continue */ }

  // Primary read: Redis hash written by the creator's POST /goal. Fall back to
  // the legacy live_streams row so any goals set before this migration still
  // render for viewers watching that stream.
  try {
    let payload = await readGoalFromRedis(channelRef);
    if (!payload) {
      const { rows } = await query(
        `SELECT tip_goal_amount, tip_goal_label, tip_goal_progress, tip_goal_completed
           FROM live_streams
          WHERE channel_name = $1 AND status = 'live'
          ORDER BY created_at DESC
          LIMIT 1`,
        [channelRef]
      );
      const row = rows[0];
      payload = {
        goalAmount: row?.tip_goal_amount != null ? parseFloat(row.tip_goal_amount) : null,
        goalLabel: row?.tip_goal_label || null,
        progress: row?.tip_goal_progress != null ? parseFloat(row.tip_goal_progress) : 0,
        completed: row?.tip_goal_completed || false,
      };
    }

    try {
      await cache.set(cacheKey, JSON.stringify(payload), 30);
    } catch (_) { /* best-effort cache write */ }

    return res.json({ success: true, ...payload });
  } catch (err) {
    logger.error('GET /api/proxy/live/goal/:channelRef error', { error: err.message });
    return res.status(500).json({ success: false, error: 'Failed to fetch tip goal' });
  }
}));

// ==========================================
// TIP MENU
// ==========================================

// GET /api/webapp/live/tip-menu — auth-required self endpoint: returns the authenticated creator's own tip menu
// Must be registered BEFORE the parameterized /:performerId route to avoid being swallowed by it.
app.get('/api/webapp/live/tip-menu', requireSessionAuth, roleGuard('model', 'creator', 'admin', 'superadmin'), asyncHandler(async (req, res) => {
  const userId = String(req.session.user.id);
  try {
    const { rows: perfRows } = await query(
      'SELECT id FROM performers WHERE user_id = $1 LIMIT 1',
      [userId]
    );
    if (perfRows.length === 0) {
      return res.json({ success: true, items: [] });
    }
    const performerId = String(perfRows[0].id);
    const { rows } = await query(
      `SELECT id, tokens_amount AS "tokensAmount", label, sort_order AS "sortOrder"
         FROM tip_menu_items
        WHERE performer_id = $1 AND is_active = true
        ORDER BY sort_order ASC, tokens_amount ASC`,
      [performerId]
    );
    return res.json({ success: true, items: rows });
  } catch (err) {
    logger.error('GET /api/webapp/live/tip-menu (self) error', { error: err.message });
    return res.status(500).json({ success: false, error: 'Failed to fetch tip menu' });
  }
}));

// GET /api/webapp/live/tip-menu/:performerId — public, get performer's active tip menu items
app.get('/api/webapp/live/tip-menu/:performerId', overlayPublicLimiter, asyncHandler(async (req, res) => {
  const performerId = String(req.params.performerId || '').trim();
  if (!performerId) {
    return res.status(400).json({ success: false, error: 'performerId required' });
  }

  try {
    const { rows } = await query(
      `SELECT id, tokens_amount, label, sort_order
         FROM tip_menu_items
        WHERE performer_id = $1 AND is_active = true
        ORDER BY sort_order ASC, tokens_amount ASC`,
      [performerId]
    );
    return res.json({ success: true, items: rows });
  } catch (err) {
    logger.error('GET /api/webapp/live/tip-menu/:performerId error', { error: err.message });
    return res.status(500).json({ success: false, error: 'Failed to fetch tip menu' });
  }
}));

// POST /api/webapp/live/tip-menu — creator saves tip menu (full replace)
app.post('/api/webapp/live/tip-menu', requireSessionAuth, roleGuard('model', 'creator', 'admin', 'superadmin'), tipMenuLimiter, asyncHandler(async (req, res) => {
  const user = req.session.user;
  const userId = String(user.id);
  const { items } = req.body;

  if (!Array.isArray(items)) {
    return res.status(400).json({ success: false, error: 'items must be an array' });
  }
  if (items.length > 10) {
    return res.status(400).json({ success: false, error: 'Maximum 10 tip menu items allowed' });
  }

  // Validate each item
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const tokens = parseInt(item.tokensAmount, 10);
    if (!Number.isInteger(tokens) || tokens <= 0 || tokens > 100000) {
      return res.status(400).json({ success: false, error: `Item ${i + 1}: tokensAmount must be a positive integer ≤ 100000` });
    }
    if (!item.label || typeof item.label !== 'string' || item.label.trim().length === 0 || item.label.trim().length > 120) {
      return res.status(400).json({ success: false, error: `Item ${i + 1}: label must be a non-empty string ≤ 120 characters` });
    }
  }

  const client = await getPool().connect();
  try {
    // Resolve performer ID from session user
    const { rows: perfRows } = await client.query(
      'SELECT id FROM performers WHERE user_id = $1 LIMIT 1',
      [userId]
    );
    if (perfRows.length === 0) {
      client.release();
      return res.status(403).json({ success: false, error: 'No performer profile found' });
    }
    const performerId = String(perfRows[0].id);

    // Full replace wrapped in a transaction to prevent concurrent double-submit corruption
    await client.query('BEGIN');
    await client.query('DELETE FROM tip_menu_items WHERE performer_id = $1', [performerId]);

    if (items.length > 0) {
      const valueClauses = items.map((item, i) => {
        const base = i * 4;
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`;
      });
      const params = [];
      items.forEach((item) => {
        params.push(
          performerId,
          parseInt(item.tokensAmount, 10),
          item.label.trim(),
          Number.isInteger(item.sortOrder) ? item.sortOrder : 0
        );
      });
      await client.query(
        `INSERT INTO tip_menu_items (performer_id, tokens_amount, label, sort_order) VALUES ${valueClauses.join(', ')}`,
        params
      );
    }
    await client.query('COMMIT');

    const { rows: savedItems } = await client.query(
      `SELECT id, tokens_amount, label, sort_order
         FROM tip_menu_items
        WHERE performer_id = $1 AND is_active = true
        ORDER BY sort_order ASC, tokens_amount ASC`,
      [performerId]
    );

    return res.json({ success: true, items: savedItems });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error('POST /api/webapp/live/tip-menu error', { error: err.message });
    return res.status(500).json({ success: false, error: 'Failed to save tip menu' });
  } finally {
    client.release();
  }
}));

// DELETE /api/webapp/live/tip-menu/:itemId — creator soft-deletes a tip menu item
app.delete('/api/webapp/live/tip-menu/:itemId', requireSessionAuth, roleGuard('model', 'creator', 'admin', 'superadmin'), asyncHandler(async (req, res) => {
  const user = req.session.user;
  const userId = String(user.id);
  const itemId = parseInt(req.params.itemId, 10);

  if (!Number.isInteger(itemId) || itemId <= 0) {
    return res.status(400).json({ success: false, error: 'Invalid itemId' });
  }

  try {
    const { rows: perfRows } = await query(
      'SELECT id FROM performers WHERE user_id = $1 LIMIT 1',
      [userId]
    );
    if (perfRows.length === 0) {
      return res.status(403).json({ success: false, error: 'No performer profile found' });
    }
    const performerId = String(perfRows[0].id);

    const { rowCount } = await query(
      'UPDATE tip_menu_items SET is_active = false WHERE id = $1 AND performer_id = $2',
      [itemId, performerId]
    );

    if (rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Item not found or not owned by you' });
    }

    return res.json({ success: true });
  } catch (err) {
    logger.error('DELETE /api/webapp/live/tip-menu/:itemId error', { error: err.message });
    return res.status(500).json({ success: false, error: 'Failed to delete tip menu item' });
  }
}));

// ==========================================
// TIP LEADERBOARD
// ==========================================

// GET /api/proxy/live/tips/leaderboard — public tip leaderboard (60s cache)
app.get('/api/proxy/live/tips/leaderboard', asyncHandler(async (req, res) => {
  const channelRef = req.query.channelRef ? String(req.query.channelRef).trim() : null;
  const period = req.query.period === 'week' ? 'week' : 'today';

  if (channelRef && !/^[a-zA-Z0-9-]+$/.test(channelRef)) {
    return res.status(400).json({ success: false, error: 'Invalid channelRef' });
  }

  const cacheKey = `live:leaderboard:${channelRef || 'global'}:${period}`;
  try {
    const cached = await cache.get(cacheKey);
    if (cached) {
      return res.json({ success: true, leaderboard: JSON.parse(cached) });
    }
  } catch (_) { /* cache miss */ }

  try {
    const periodStart = period === 'week'
      ? `DATE_TRUNC('week', NOW())`
      : `DATE_TRUNC('day', NOW())`;

    let sqlText;
    let params;

    if (channelRef) {
      sqlText = `
        SELECT t.user_id, u.username, SUM(t.amount) AS total, COUNT(*) AS tip_count
          FROM pnp_tips t
          LEFT JOIN users u ON t.user_id = u.id
          JOIN users pu ON pu.live_channel = $1
          JOIN performers p ON p.user_id = pu.id
         WHERE t.payment_status = 'completed'
           AND t.created_at >= ${periodStart}
           AND (t.performer_id = p.id::text OR t.model_id = p.id)
         GROUP BY t.user_id, u.username
         ORDER BY total DESC
         LIMIT 10`;
      params = [channelRef];
    } else {
      sqlText = `
        SELECT t.user_id, u.username, SUM(t.amount) AS total, COUNT(*) AS tip_count
          FROM pnp_tips t
          LEFT JOIN users u ON t.user_id = u.id
         WHERE t.payment_status = 'completed'
           AND t.created_at >= ${periodStart}
         GROUP BY t.user_id, u.username
         ORDER BY total DESC
         LIMIT 10`;
      params = [];
    }

    const { rows } = await query(sqlText, params);
    const leaderboard = rows.map(r => ({
      userId: r.user_id,
      username: r.username || 'Anonymous',
      total: parseFloat(r.total),
      tipCount: parseInt(r.tip_count, 10),
    }));

    try {
      await cache.set(cacheKey, JSON.stringify(leaderboard), 60);
    } catch (_) { /* best-effort */ }

    return res.json({ success: true, leaderboard });
  } catch (err) {
    logger.error('GET /api/proxy/live/tips/leaderboard error', { error: err.message });
    return res.status(500).json({ success: false, error: 'Failed to fetch leaderboard' });
  }
}));

// ==========================================
// CHAT MODERATION (REST)
// ==========================================

// GET /api/webapp/live/chat-bans/:channelRef — creator gets their ban list
app.get('/api/webapp/live/chat-bans/:channelRef', requireSessionAuth, roleGuard('model', 'creator', 'admin', 'superadmin'), asyncHandler(async (req, res) => {
  const user = req.session.user;
  const userId = String(user.id);
  const channelRef = String(req.params.channelRef || '').trim();

  if (!channelRef || !/^[a-zA-Z0-9-]+$/.test(channelRef)) {
    return res.status(400).json({ success: false, error: 'Invalid channelRef' });
  }

  try {
    // Verify the requestor owns this channel (or is admin)
    const { rows: userRows } = await query(
      'SELECT live_channel, role FROM users WHERE id = $1',
      [userId]
    );
    const dbUser = userRows[0];
    const isAdmin = dbUser?.role === 'admin' || dbUser?.role === 'superadmin';
    if (!isAdmin && dbUser?.live_channel !== channelRef) {
      return res.status(403).json({ success: false, error: 'You do not own this channel' });
    }

    const { rows } = await query(
      `SELECT scb.id, scb.banned_user_id, scb.action, scb.mute_until, scb.created_at,
              u.username AS banned_username
         FROM stream_chat_bans scb
         LEFT JOIN users u ON u.id = scb.banned_user_id
        WHERE scb.channel_ref = $1
          AND (scb.mute_until IS NULL OR scb.mute_until > NOW())
        ORDER BY scb.created_at DESC`,
      [channelRef]
    );

    return res.json({ success: true, bans: rows });
  } catch (err) {
    logger.error('GET /api/webapp/live/chat-bans/:channelRef error', { error: err.message });
    return res.status(500).json({ success: false, error: 'Failed to fetch ban list' });
  }
}));

// DELETE /api/webapp/live/chat-bans/:bannedUserId — creator unbans a user
app.delete('/api/webapp/live/chat-bans/:bannedUserId', requireSessionAuth, roleGuard('model', 'creator', 'admin', 'superadmin'), asyncHandler(async (req, res) => {
  const user = req.session.user;
  const userId = String(user.id);
  const bannedUserId = String(req.params.bannedUserId || '').trim();
  const channelRef = String(req.query.channelRef || '').trim();

  if (!bannedUserId || !channelRef || !/^[a-zA-Z0-9-]+$/.test(channelRef)) {
    return res.status(400).json({ success: false, error: 'bannedUserId and channelRef required' });
  }
  if (!/^[0-9a-f-]{8,36}$|^\d{1,20}$/i.test(bannedUserId)) {
    return res.status(400).json({ success: false, error: 'Invalid bannedUserId format' });
  }

  try {
    const { rows: userRows } = await query(
      'SELECT live_channel, role FROM users WHERE id = $1',
      [userId]
    );
    const dbUser = userRows[0];
    const isAdmin = dbUser?.role === 'admin' || dbUser?.role === 'superadmin';
    if (!isAdmin && dbUser?.live_channel !== channelRef) {
      return res.status(403).json({ success: false, error: 'You do not own this channel' });
    }

    const result = await query(
      'DELETE FROM stream_chat_bans WHERE channel_ref = $1 AND banned_user_id = $2',
      [channelRef, bannedUserId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Ban not found' });
    }

    return res.json({ success: true });
  } catch (err) {
    logger.error('DELETE /api/webapp/live/chat-bans/:bannedUserId error', { error: err.message });
    return res.status(500).json({ success: false, error: 'Failed to remove ban' });
  }
}));

// POST /api/proxy/live/tips/callback — Payment webhook callback
app.post('/api/proxy/live/tips/callback', webhookLimiter, asyncHandler(async (req, res) => {
  // C1: Webhook secret verification using timing-safe comparison
  const incomingSecret = req.headers['x-tips-webhook-secret'];
  const expectedSecret = process.env.TIPS_WEBHOOK_SECRET;
  if (!expectedSecret) {
    logger.error('TIPS_WEBHOOK_SECRET env var is not set — rejecting tips callback');
    return res.status(500).json({ success: false, error: 'Webhook secret not configured' });
  }
  if (!incomingSecret) {
    logger.warn('Tips callback rejected: missing x-tips-webhook-secret header', { ip: req.ip });
    return res.status(401).json({ success: false, error: 'Missing webhook secret' });
  }
  try {
    const incomingBuf = Buffer.from(incomingSecret, 'utf8');
    const expectedBuf = Buffer.from(expectedSecret, 'utf8');
    // Pad to same length to prevent length-based timing leak; mismatch detected by timingSafeEqual
    const maxLen = Math.max(incomingBuf.length, expectedBuf.length);
    const paddedIncoming = Buffer.alloc(maxLen, 0);
    const paddedExpected = Buffer.alloc(maxLen, 0);
    incomingBuf.copy(paddedIncoming);
    expectedBuf.copy(paddedExpected);
    if (!crypto.timingSafeEqual(paddedIncoming, paddedExpected)) {
      logger.warn('Tips callback rejected: invalid webhook secret', { ip: req.ip });
      return res.status(401).json({ success: false, error: 'Invalid webhook secret' });
    }
  } catch (authErr) {
    logger.error(`Tips callback secret comparison error: ${authErr.message}`);
    return res.status(401).json({ success: false, error: 'Invalid webhook secret' });
  }

  // Fix #3: Timestamp replay protection — reject requests older than 5 minutes.
  // Callers should include x-tips-timestamp (Unix seconds). Legacy callers without
  // this header are allowed through; add the header to new integrations.
  const tsHeader = req.headers['x-tips-timestamp'];
  if (tsHeader) {
    const ts = parseInt(tsHeader, 10);
    if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) {
      logger.warn('Tips callback rejected: stale or invalid timestamp', { ip: req.ip, ts });
      return res.status(401).json({ success: false, error: 'Request timestamp expired or invalid' });
    }
  }

  const { tipId, transactionId, status } = req.body;

  // C1: Validate required fields before acquiring lock
  if (!tipId || !transactionId) {
    return res.status(400).json({ success: false, error: 'tipId and transactionId required' });
  }

  // C1: Redis idempotency lock — prevents duplicate processing of same tip/transaction pair
  const lockKey = `tips_callback:${tipId}:${transactionId}`;
  let lockAcquired = false;
  try {
    lockAcquired = await cache.acquireLock(lockKey, 120);
    if (!lockAcquired) {
      logger.warn(`Tips callback duplicate request blocked for tip #${tipId} txn ${transactionId}`);
      return res.status(409).json({ success: false, error: 'Duplicate callback — already processing' });
    }

    if (status === 'completed' || status === 'success') {
      await PNPLiveTipsService.confirmTipPayment(parseInt(tipId, 10), transactionId);
      logger.info(`Tip #${tipId} payment confirmed: ${transactionId}`);

      // Emit real-time tip event to all live viewers
      try {
        const tipInfo = await PNPLiveTipsService.getTipById(parseInt(tipId, 10));
        const socketSingleton = require('../../services/socketSingleton');
        const io = socketSingleton.get ? socketSingleton.get() : socketSingleton;
        if (io && tipInfo) {
          // Emit to the specific performer's live room; all viewers in that room receive it
          io.to(`live:${String(tipInfo.performer_id)}`).emit('live:tip', {
            id: tipInfo.id,
            amount: parseFloat(tipInfo.amount),
            username: tipInfo.user_username || 'Anonymous',
            performerName: tipInfo.model_name || 'Performer',
            message: tipInfo.message || '',
            createdAt: tipInfo.created_at,
          });
        }
      } catch (tipEmitErr) {
        logger.warn(`Failed to emit live:tip socket event: ${tipEmitErr.message}`);
      }
    }

    res.json({ success: true });
  } catch (error) {
    logger.error(`Live tips callback error: ${error.message}`);
    res.status(500).json({ success: false, error: 'Callback processing failed' });
  } finally {
    if (lockAcquired) {
      await cache.releaseLock(lockKey).catch(err =>
        logger.warn(`Failed to release tips callback lock: ${err.message}`)
      );
    }
  }
}));

// ==========================================
// DASH TOKEN WALLET ROUTES
// ==========================================
const DashTokenService = require('../../services/dashTokenService');
const {
  createDashInvoice,
  createInvoice: createBtcpayInvoice,
  validateWebhookSignature,
  checkBtcpayHealth,
  checkInvoiceProcessed,
  markInvoiceProcessed,
  isConfigured: btcpayConfigured,
} = require('../../config/btcpay');

// GET /api/webapp/dash/btcpay-status — check if BTCPay is configured and reachable
app.get('/api/webapp/dash/btcpay-status', requireSessionAuth, asyncHandler(async (req, res) => {
  const health = await checkBtcpayHealth();
  res.json({ success: true, ...health });
}));

// GET /api/wallet/balance — get current user's token balance + DPNS
app.get('/api/wallet/balance', requireSessionAuth, asyncHandler(async (req, res) => {
  const user = req.session?.user;
  const userId = String(user.telegram_id || user.id);
  const { rows } = await getPool().query(
    `INSERT INTO user_token_wallets (user_id)
     VALUES ($1)
     ON CONFLICT (user_id) DO UPDATE SET updated_at = NOW()
     RETURNING balance_tokens, gifted_balance, dash_dpns`,
    [userId]
  );
  const row = rows[0] || { balance_tokens: 0, gifted_balance: 0, dash_dpns: null };
  const regular = Number(row.balance_tokens) || 0;
  const gifted  = Number(row.gifted_balance)  || 0;
  res.json({ success: true, balance: regular + gifted, regularBalance: regular, giftedBalance: gifted, dpnsHandle: row.dash_dpns || null });
}));

// GET /api/wallet/packages — available token packages (auth required to prevent
// information disclosure of pricing/availability to unauthenticated visitors)
app.get('/api/wallet/packages', requireSessionAuth, (req, res) => {
  res.json({ success: true, packages: DashTokenService.TOKEN_PACKAGES });
});

// GET /api/wallet/history — purchase history
app.get('/api/wallet/history', requireSessionAuth, asyncHandler(async (req, res) => {
  const user = req.session?.user;
  const userId = String(user.telegram_id || user.id);
  const history = await DashTokenService.getPurchaseHistory(userId, 20);
  res.json({ success: true, history });
}));

const TokenCheckoutService = require('../../services/tokenCheckoutService');

// POST /api/wallet/buy — create a BTCPay Dash invoice for token purchase
app.post('/api/wallet/buy', requireSessionAuth, asyncHandler(async (req, res) => {
  const user = req.session?.user;

  const { packageId } = req.body;
  if (!packageId) return res.status(400).json({ success: false, error: 'packageId is required' });

  const userId = String(user.telegram_id || user.id);

  try {
    const result = await TokenCheckoutService.createDashCheckout(userId, packageId);
    res.json(result);
  } catch (err) {
    logger.error(`Wallet buy (Dash) error: ${err.message}`);
    if (err.code === 'INVALID_PACKAGE') {
      return res.status(400).json({ success: false, error: 'Invalid package ID' });
    }
    if (err.message?.includes('not configured')) {
      return res.status(503).json({ success: false, error: 'Crypto payments are not available yet. Please use another payment method.', code: 'BTCPAY_NOT_CONFIGURED' });
    }
    if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND' || err.code === 'ETIMEDOUT') {
      return res.status(503).json({ success: false, error: 'Payment server is temporarily unavailable. Please try again later.', code: 'BTCPAY_UNREACHABLE' });
    }
    res.status(500).json({ success: false, error: 'Failed to create Dash invoice. Please try again.', code: 'BTCPAY_ERROR' });
  }
}));

// POST /api/wallet/buy-nowpayments — create a NowPayments invoice for token purchase (20% discount)
// Replaces the defunct /api/wallet/buy-btc (BTCPay BTC route).
app.post('/api/wallet/buy-nowpayments', requireSessionAuth, asyncHandler(async (req, res) => {
  const user = req.session?.user;
  const { packageId, payCurrency: rawPayCurrency } = req.body;
  if (!packageId) return res.status(400).json({ success: false, error: 'packageId is required' });

  const ALLOWED_PAY_CURRENCIES = new Set(['btc', 'btcln', 'eth', 'ltc', 'xmr', 'bch', 'usdt', 'usdttrc20', 'usdtbsc', 'usdc', 'usdcbsc', 'usdcsol', 'dash', 'sol', 'doge']);
  const payCurrency = (rawPayCurrency && ALLOWED_PAY_CURRENCIES.has(String(rawPayCurrency).toLowerCase()))
    ? String(rawPayCurrency).toLowerCase() : null;

  const userId = String(user.telegram_id || user.id);

  try {
    const result = await TokenCheckoutService.createNowPaymentsCheckout(userId, packageId, payCurrency);
    return res.json({ success: true, ...result });
  } catch (err) {
    logger.error('[wallet/buy-nowpayments]', { error: err.message, code: err.code });
    if (err.code === 'PACKAGE_NOT_FOUND' || err.code === 'INVALID_PACKAGE') {
      return res.status(404).json({ success: false, error: err.message });
    }
    if (err.code === 'NOWPAYMENTS_NOT_CONFIGURED') {
      return res.status(503).json({ success: false, error: err.message });
    }
    return res.status(500).json({ success: false, error: 'Failed to create crypto invoice.' });
  }
}));


// GET /api/token-checkout/:purchaseId — return checkout page data (ePayco widget config)
app.get('/api/token-checkout/:purchaseId', requireSessionAuth, asyncHandler(async (req, res) => {
  const { purchaseId } = req.params;
  // Strict UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
  if (!purchaseId || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(purchaseId)) {
    return res.status(400).json({ success: false, error: 'Invalid purchaseId' });
  }

  try {
    const data = await TokenCheckoutService.getCheckoutData(purchaseId);
    if (!data) {
      return res.status(404).json({ success: false, error: 'Token purchase not found or uses external checkout page' });
    }

    // Ownership check: the requesting session must own this purchase.
    // token_purchases.user_id is the integer PK from the users table.
    // Session exposes both telegram_id (Telegram numeric ID string) and id (users PK integer).
    const sessionUser = req.session.user;
    const sessionUserId = sessionUser.id ?? null;
    if (!sessionUserId || String(data.userId) !== String(sessionUserId)) {
      logger.warn('Token checkout ownership mismatch', {
        purchaseId,
        purchaseOwner: data.userId,
        requestingUser: sessionUserId,
      });
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    // Strip the internal userId field before sending to the client.
    const { userId: _userId, ...clientData } = data;
    res.json({ success: true, ...clientData });
  } catch (err) {
    if (err.code === 'FX_RATE_UNAVAILABLE') {
      logger.error('[ePayco FX] Rate unavailable for token checkout page', { error: err.message, purchaseId });
      return res.status(503).json({
        success: false,
        error: 'FX rate unavailable, please retry in a few minutes',
        code: 'FX_RATE_UNAVAILABLE',
      });
    }
    logger.error(`Token checkout data error: ${err.message}`, { purchaseId });
    res.status(500).json({ success: false, error: 'Failed to load checkout data. Please try again.' });
  }
}));

// GET /token-checkout/:purchaseId — redirect to the React SPA token-checkout
// page. The React version handles ePayco only.
app.get('/token-checkout/:purchaseId', (req, res) => {
  const purchaseId = encodeURIComponent(req.params.purchaseId);
  const qs = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
  res.redirect(302, `https://pnptv.app/token-checkout/${purchaseId}${qs}`);
});

// POST /api/wallet/link-dpns — link a Dash DPNS handle
app.post('/api/wallet/link-dpns', requireSessionAuth, asyncHandler(async (req, res) => {
  const user = req.session?.user;

  const { dpnsHandle } = req.body;
  if (!dpnsHandle) return res.status(400).json({ success: false, error: 'dpnsHandle is required' });

  const userId = String(user.telegram_id || user.id);
  try {
    await DashTokenService.linkDPNS(userId, dpnsHandle);
    res.json({ success: true, dpnsHandle: dpnsHandle.toLowerCase() });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
}));

// GET /api/invoice/:paymentId — download a PDF invoice for a completed payment
app.get('/api/invoice/:paymentId', requireSessionAuth, asyncHandler(async (req, res) => {
  const { paymentId } = req.params;
  const sessionUserId = req.session?.user?.id;
  if (!sessionUserId) return res.status(401).json({ success: false, error: 'Unauthorized' });

  const row = await query(
    `SELECT p.id, p.reference, p.amount, p.currency, p.provider, p.completed_at,
            u.display_name, u.first_name, u.username,
            pl.display_name AS plan_display_name, pl.name AS plan_name
       FROM payments p
       JOIN users u ON u.id::text = p.user_id::text
       LEFT JOIN plans pl ON pl.id = p.plan_id
      WHERE p.id = $1
        AND p.user_id::text = $2::text
      LIMIT 1`,
    [paymentId, String(sessionUserId)]
  );

  if (row.rows.length === 0) {
    return res.status(404).json({ success: false, error: 'Invoice not found' });
  }

  const r = row.rows[0];
  const InvoiceService = require('../../../services/invoiceservice');
  const customerName = r.display_name || r.first_name || r.username || 'Member';
  const planName = r.plan_display_name || r.plan_name || 'Digital Purchase';
  const invoiceNumber = `INV-${r.id.slice(0, 8).toUpperCase()}`;

  const { buffer } = await InvoiceService.generateInvoice({
    invoiceNumber,
    customerName,
    planName,
    amount: parseFloat(r.amount) || 0,
    currency: r.currency || 'USD',
    provider: r.provider || 'nowpayments',
    transactionId: r.reference || r.id,
    purchaseDate: r.completed_at ? new Date(r.completed_at) : new Date(),
  });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="invoice-${paymentId}.pdf"`);
  res.send(buffer);
}));

const dashAvailableLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  keyGenerator: (req) => req.session?.user?.id || req.ip,
  message: { success: false, error: 'Too many requests. Please wait.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const dashCreateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 5,
  keyGenerator: (req) => req.session?.user?.id || req.ip,
  message: { success: false, error: 'Too many payment requests. Please wait a few minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// GET /api/webapp/payments/dash/available — check if Dash/BTCPay is configured
// Uses config-only check (no outbound HTTP) to avoid live BTCPay calls on every page load.
app.get('/api/webapp/payments/dash/available', dashAvailableLimiter, asyncHandler(async (req, res) => {
  const { isConfigured } = require('../../config/btcpay');
  const configured = !!isConfigured;
  return res.json({ available: configured, configured });
}));

// POST /api/webapp/payments/dash/create — create a BTCPay Dash invoice for a subscription plan.
// When planId === 'creator_monthly' AND creatorId is provided, the price is looked up
// dynamically from users.creator_price_usd (mirrors paymentService.createPayment) and the
// order carries creator_id so the webhook can credit the right creator with a 70/30 split.
app.post('/api/webapp/payments/dash/create', requireSessionAuth, dashCreateLimiter, asyncHandler(async (req, res) => {
  const user = req.session.user;

  const { planId, email, creatorId } = req.body;
  if (!planId) return res.status(400).json({ success: false, error: 'planId is required' });
  if (typeof planId !== 'string' || planId.length > 100 || !/^[a-z0-9_-]+$/.test(planId)) {
    return res.status(400).json({ success: false, error: 'Invalid planId format' });
  }

  const userId = String(user.telegram_id || user.id);

  if (creatorId && String(creatorId) === userId) {
    return res.status(400).json({ success: false, error: 'You cannot subscribe to yourself' });
  }

  const { query: dbQuery } = require('../../config/postgres');

  let planDisplayName;
  let usdAmount;
  let discountInfo = null;

  if (planId === 'creator_monthly') {
    if (!creatorId) {
      return res.status(400).json({ success: false, error: 'creatorId is required for creator subscriptions' });
    }
    const creatorRes = await dbQuery(
      'SELECT id, username, first_name, creator_price_usd, creator_locked, creator_subscription_paused FROM users WHERE id = $1 AND creator_status = $2',
      [String(creatorId), 'active']
    );
    if (creatorRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Creator not found or not active' });
    }
    const creator = creatorRes.rows[0];
    if (creator.creator_locked) {
      return res.status(423).json({ success: false, error: 'This creator is completing onboarding and cannot accept new subscriptions yet.', code: 'CREATOR_LOCKED' });
    }
    if (creator.creator_subscription_paused) {
      return res.status(423).json({ success: false, error: 'This creator has paused new memberships.', code: 'SUBSCRIPTIONS_PAUSED' });
    }
    // CS-PAY-M-02: require pnp-member before creating a creator_monthly BTCPay invoice
    const EASDash = require('../../services/entitlementAccessService');
    const hasMemberDash = await EASDash.hasEntitlement(String(userId), 'pnp-member');
    if (!hasMemberDash) {
      return res.status(403).json({
        success: false,
        error: 'Se requiere membresía Basic para suscribirse a un creador.',
        code: 'MEMBER_REQUIRED',
      });
    }
    const price = parseFloat(creator.creator_price_usd);
    if (!Number.isFinite(price) || price <= 0) {
      return res.status(400).json({ success: false, error: 'Creator has no active subscription price' });
    }
    usdAmount = price;
    planDisplayName = 'Premium subscription';
  } else {
    const PlanModel = require('../../models/planModel');
    const plan = await PlanModel.getById(planId);
    if (!plan) return res.status(404).json({ success: false, error: 'Plan not found' });
    const basePrice = parseFloat(plan.price);
    // $0 plans (free trials) must never reach BTCPay — grant directly and return.
    if (basePrice <= 0) {
      const EASFree = require('../../services/entitlementAccessService');
      await EASFree.grantTrialPrime(userId);
      return res.json({ success: true, free: true, planName: plan.display_name || plan.name });
    }
    // crypto payment_method = fixed promo price, no stacking discount
    if (plan.payment_method === 'crypto') {
      usdAmount = basePrice;
    } else if (basePrice > 50) {
      usdAmount = Math.round(basePrice * 0.80 * 100) / 100;
      discountInfo = { originalAmount: basePrice, discountPct: 20 };
    } else {
      usdAmount = basePrice;
    }
    planDisplayName = plan.display_name || plan.name;
  }

  const orderId = `pnptv-sub-${userId}-${Date.now()}`;
  const isDonation = planId.startsWith('donation-');

  try {
    const invoice = await createDashInvoice({
      usdAmount,
      userId,
      orderId,
      planId,
      description: isDonation ? `PNPtv! donation — ${planDisplayName}` : `${planDisplayName} subscription`,
      redirectUrl: `${process.env.WEBAPP_URL || 'https://pnptv.app'}${isDonation ? '/donate' : '/subscribe'}`,
    });

    await dbQuery(
      `INSERT INTO dash_subscription_orders (user_id, plan_id, email, usd_amount, btcpay_invoice_id, status, creator_id)
       VALUES ($1, $2, $3, $4, $5, 'pending', $6)
       ON CONFLICT (btcpay_invoice_id) DO NOTHING`,
      [userId, planId, email || null, usdAmount, invoice.invoiceId, creatorId ? String(creatorId) : null]
    );

    return res.json({
      success: true,
      invoiceId: invoice.invoiceId,
      checkoutUrl: invoice.checkoutUrl,
      planName: planDisplayName,
      usdAmount,
      ...(discountInfo || {}),
    });
  } catch (err) {
    logger.error(`Dash subscription invoice error: ${err.message}`);
    if (err.message?.includes('not configured')) {
      return res.status(503).json({ success: false, error: 'Crypto payments are not available yet. Please use another payment method.', code: 'BTCPAY_NOT_CONFIGURED' });
    }
    if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND' || err.code === 'ETIMEDOUT') {
      return res.status(503).json({ success: false, error: 'Payment server is temporarily unavailable. Please try again later.', code: 'BTCPAY_UNREACHABLE' });
    }
    return res.status(500).json({ success: false, error: 'Failed to create Dash invoice. Please try again.', code: 'BTCPAY_ERROR' });
  }
}));

const dashStatusLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: (req) => req.session?.user?.id || req.ip,
  message: { success: false, error: 'Too many status requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// GET /api/webapp/payments/dash/status/:invoiceId — poll invoice status
app.get('/api/webapp/payments/dash/status/:invoiceId', requireSessionAuth, dashStatusLimiter, asyncHandler(async (req, res) => {
  const user = req.session?.user;
  if (!user) return res.status(401).json({ success: false, error: 'Authentication required' });

  const { invoiceId } = req.params;
  if (!invoiceId || !/^[A-Za-z0-9_-]{5,64}$/.test(invoiceId)) {
    return res.status(400).json({ success: false, error: 'Invalid invoiceId' });
  }
  const { query: dbQuery } = require('../../config/postgres');
  const result = await dbQuery(
    `SELECT status FROM dash_subscription_orders WHERE btcpay_invoice_id = $1 AND user_id = $2`,
    [invoiceId, String(user.telegram_id || user.id)]
  );

  if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'Order not found' });
  return res.json({ success: true, status: result.rows[0].status });
}));

// GET /api/webapp/payments/dash/details/:invoiceId — fetch Dash payment address + amount for a pending invoice
app.get('/api/webapp/payments/dash/details/:invoiceId', requireSessionAuth, dashStatusLimiter, async (req, res) => {
  try {
    const user = req.session?.user;
    if (!user) return res.status(401).json({ success: false, error: 'Authentication required' });
    const userId = String(user.telegram_id || user.id);
    const { invoiceId } = req.params;

    if (!invoiceId || !/^[A-Za-z0-9_-]{5,64}$/.test(invoiceId)) {
      return res.status(400).json({ success: false, error: 'Invalid invoiceId' });
    }

    const pool = getPool();

    // Verify ownership — check subscription orders, token purchases, and tips
    const ownerCheck = await pool.query(
      `SELECT user_id FROM dash_subscription_orders WHERE btcpay_invoice_id = $1 AND user_id = $2
       UNION ALL
       SELECT user_id FROM token_purchases WHERE btcpay_invoice_id = $1 AND user_id = $2
       UNION ALL
       SELECT user_id FROM pnp_tips WHERE transaction_id = $1 AND user_id = $2
       LIMIT 1`,
      [invoiceId, userId]
    );

    if (ownerCheck.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Invoice not found' });
    }

    const { getInvoicePaymentMethods, getInvoice } = require('../../config/btcpay');

    const [methods, invoice] = await Promise.all([
      getInvoicePaymentMethods(invoiceId),
      getInvoice(invoiceId),
    ]);

    // Find the DASH payment method (could be "DASH", "DASH-CHAIN", or similar)
    const dashMethod = methods.find(m =>
      m.paymentMethodId?.toUpperCase().includes('DASH') ||
      m.cryptoCode?.toUpperCase() === 'DASH' ||
      m.paymentMethod?.toUpperCase().includes('DASH')
    );

    if (!dashMethod) {
      return res.status(404).json({ success: false, error: 'No Dash payment method found for this invoice' });
    }

    let amount = dashMethod.amount || dashMethod.cryptoAmount || '0';
    let invoiceAmount = invoice?.amount ? parseFloat(invoice.amount) : null;

    // For TopUp invoices (token purchases), amount may be "0" — compute from DB record
    if ((!amount || amount === '0') && dashMethod.rate) {
      const tokenRow = await pool.query(
        'SELECT usd_amount FROM token_purchases WHERE btcpay_invoice_id = $1 LIMIT 1',
        [invoiceId]
      );
      if (tokenRow.rows.length > 0 && tokenRow.rows[0].usd_amount) {
        const usd = parseFloat(tokenRow.rows[0].usd_amount);
        const rate = parseFloat(dashMethod.rate);
        if (rate > 0) {
          amount = (usd / rate).toFixed(8);
          invoiceAmount = usd;
        }
      }
    }

    res.json({
      success: true,
      destination: dashMethod.destination || dashMethod.address,
      amount,
      due: dashMethod.due || amount,
      totalDue: dashMethod.totalDue || amount,
      rate: dashMethod.rate || null,
      networkFee: dashMethod.networkFee || '0',
      status: invoice?.status || 'New',
      currency: invoice?.currency || 'USD',
      invoiceAmount,
    });
  } catch (err) {
    logger.error('[Dash] Failed to get payment details', { error: err.message, invoiceId: req.params.invoiceId });
    res.status(500).json({ success: false, error: 'Failed to fetch payment details' });
  }
});

// GET /api/webapp/payments/lightning/available — check if Lightning is configured & enabled in BTCPay store
app.get('/api/webapp/payments/lightning/available', healthLimiter, asyncHandler(async (req, res) => {
  const { checkLightningHealth } = require('../../config/btcpay');
  const health = await checkLightningHealth();
  return res.json({ available: health.configured && health.reachable, ...health });
}));

// POST /api/webapp/payments/lightning/create — create a BTCPay Lightning invoice for a subscription plan.
app.post('/api/webapp/payments/lightning/create', requireSessionAuth, paymentCreateLimiter, asyncHandler(async (req, res) => {
  const user = req.session.user;

  const { planId, email, creatorId } = req.body;
  if (!planId) return res.status(400).json({ success: false, error: 'planId is required' });

  const userId = String(user.telegram_id || user.id);
  const { query: dbQuery } = require('../../config/postgres');

  // Gate: check Lightning is configured before doing any work
  const { checkLightningHealth, createLightningInvoice } = require('../../config/btcpay');
  const health = await checkLightningHealth();
  if (!health.configured) {
    return res.status(503).json({
      success: false,
      error: 'Lightning payments are not available yet. Please use Card or Dash.',
      code: 'LIGHTNING_NOT_CONFIGURED',
    });
  }
  if (!health.reachable) {
    return res.status(503).json({
      success: false,
      error: 'Payment server is temporarily unavailable. Please try again later.',
      code: 'BTCPAY_UNREACHABLE',
    });
  }

  if (creatorId && String(creatorId) === userId) {
    return res.status(400).json({ success: false, error: 'You cannot subscribe to yourself' });
  }

  let planDisplayName;
  let usdAmount;
  let discountInfo = null;

  if (planId === 'creator_monthly') {
    if (!creatorId) {
      return res.status(400).json({ success: false, error: 'creatorId is required for creator subscriptions' });
    }
    const creatorRes = await dbQuery(
      'SELECT id, username, first_name, creator_price_usd, creator_locked, creator_subscription_paused FROM users WHERE id = $1 AND creator_status = $2',
      [String(creatorId), 'active']
    );
    if (creatorRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Creator not found or not active' });
    }
    const creator = creatorRes.rows[0];
    if (creator.creator_locked) {
      return res.status(423).json({ success: false, error: 'This creator is completing onboarding and cannot accept new subscriptions yet.', code: 'CREATOR_LOCKED' });
    }
    if (creator.creator_subscription_paused) {
      return res.status(423).json({ success: false, error: 'This creator has paused new memberships.', code: 'SUBSCRIPTIONS_PAUSED' });
    }
    const price = parseFloat(creator.creator_price_usd);
    if (!Number.isFinite(price) || price <= 0) {
      return res.status(400).json({ success: false, error: 'Creator has no active subscription price' });
    }
    usdAmount = price;
    planDisplayName = 'Premium subscription';
  } else {
    const PlanModel = require('../../models/planModel');
    const plan = await PlanModel.getById(planId);
    if (!plan) return res.status(404).json({ success: false, error: 'Plan not found' });
    const basePrice = parseFloat(plan.price);
    // crypto payment_method = fixed promo price, no stacking discount
    if (plan.payment_method === 'crypto') {
      usdAmount = basePrice;
    } else if (basePrice > 50) {
      usdAmount = Math.round(basePrice * 0.80 * 100) / 100;
      discountInfo = { originalAmount: basePrice, discountPct: 20 };
    } else {
      usdAmount = basePrice;
    }
    planDisplayName = plan.display_name || plan.name;
  }

  // M-8: deduplicate — return existing pending invoice for same user+plan within 15 minutes
  const { rows: existingOrders } = await dbQuery(
    `SELECT id, btcpay_invoice_id FROM dash_subscription_orders
     WHERE user_id = $1 AND plan_id = $2 AND status = 'pending'
       AND created_at > NOW() - INTERVAL '15 minutes'
     LIMIT 1`,
    [userId, planId]
  );
  if (existingOrders.length) {
    const existingInvoiceId = existingOrders[0].btcpay_invoice_id;
    const btcpayBase = (process.env.BTCPAY_URL || 'https://btcpay.pnptv.app').replace(/\/$/, '');
    return res.json({
      success: true,
      invoiceId: existingInvoiceId,
      checkoutUrl: `${btcpayBase}/i/${existingInvoiceId}`,
      planName: planDisplayName,
      usdAmount,
      deduplicated: true,
    });
  }

  const orderId = `pnptv-ln-${userId}-${Date.now()}`;

  try {
    const invoice = await createLightningInvoice({
      usdAmount,
      userId,
      orderId,
      description: `${planDisplayName} subscription`,
      redirectUrl: `${process.env.WEBAPP_URL || 'https://pnptv.app'}/subscribe`,
    });

    await dbQuery(
      `INSERT INTO dash_subscription_orders (user_id, plan_id, email, usd_amount, btcpay_invoice_id, status, creator_id)
       VALUES ($1, $2, $3, $4, $5, 'pending', $6)
       ON CONFLICT (btcpay_invoice_id) DO NOTHING`,
      [userId, planId, email || null, usdAmount, invoice.invoiceId, creatorId ? String(creatorId) : null]
    );

    return res.json({
      success: true,
      invoiceId: invoice.invoiceId,
      checkoutUrl: invoice.checkoutUrl,
      planName: planDisplayName,
      usdAmount,
      ...(discountInfo || {}),
    });
  } catch (err) {
    logger.error(`Lightning subscription invoice error: ${err.message}`);
    if (err.message?.includes('not configured')) {
      return res.status(503).json({ success: false, error: 'Lightning payments are not available yet. Please use another payment method.', code: 'LIGHTNING_NOT_CONFIGURED' });
    }
    if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND' || err.code === 'ETIMEDOUT') {
      return res.status(503).json({ success: false, error: 'Payment server is temporarily unavailable. Please try again later.', code: 'BTCPAY_UNREACHABLE' });
    }
    return res.status(500).json({ success: false, error: 'Failed to create Lightning invoice. Please try again.', code: 'LIGHTNING_ERROR' });
  }
}));

// GET /api/webapp/payments/lightning/status/:invoiceId — poll invoice status
app.get('/api/webapp/payments/lightning/status/:invoiceId', requireSessionAuth, asyncHandler(async (req, res) => {
  const user = req.session?.user;
  if (!user) return res.status(401).json({ success: false, error: 'Authentication required' });

  const { invoiceId } = req.params;
  if (!invoiceId || !/^[A-Za-z0-9_-]{5,64}$/.test(invoiceId)) {
    return res.status(400).json({ success: false, error: 'Invalid invoiceId' });
  }
  const { query: dbQuery } = require('../../config/postgres');
  const result = await dbQuery(
    `SELECT status FROM dash_subscription_orders WHERE btcpay_invoice_id = $1 AND user_id = $2`,
    [invoiceId, String(user.telegram_id || user.id)]
  );

  if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'Order not found' });
  return res.json({ success: true, status: result.rows[0].status });
}));

// GET /api/webapp/payments/lightning/details/:invoiceId — fetch Lightning bolt11 + amount for a pending invoice
app.get('/api/webapp/payments/lightning/details/:invoiceId', requireSessionAuth, async (req, res) => {
  try {
    const user = req.session?.user;
    if (!user) return res.status(401).json({ success: false, error: 'Authentication required' });
    const userId = String(user.telegram_id || user.id);
    const { invoiceId } = req.params;

    if (!invoiceId || !/^[A-Za-z0-9_-]{5,64}$/.test(invoiceId)) {
      return res.status(400).json({ success: false, error: 'Invalid invoiceId' });
    }

    // Verify ownership — Lightning invoices are stored in dash_subscription_orders
    const ownerCheck = await pool.query(
      `SELECT user_id FROM dash_subscription_orders WHERE btcpay_invoice_id = $1 AND user_id = $2 LIMIT 1`,
      [invoiceId, userId]
    );

    if (ownerCheck.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Invoice not found' });
    }

    const { getInvoicePaymentMethods, getInvoice } = require('../../config/btcpay');

    const [methods, invoice] = await Promise.all([
      getInvoicePaymentMethods(invoiceId),
      getInvoice(invoiceId),
    ]);

    // Find the Lightning payment method
    const lightningMethod = methods.find(
      (m) =>
        m.paymentMethodId?.includes('Lightning') ||
        m.paymentMethodId === 'BTC-LightningNetwork'
    );

    if (!lightningMethod) {
      return res.status(404).json({ success: false, error: 'No Lightning payment method found for this invoice' });
    }

    // For Lightning, the destination field IS the bolt11 string
    const bolt11 = lightningMethod.destination || lightningMethod.bolt11 || '';
    const amount = lightningMethod.amount || lightningMethod.cryptoAmount || '0';
    const invoiceAmount = invoice?.amount ? parseFloat(invoice.amount) : null;

    res.json({
      success: true,
      bolt11,
      amount,
      due: lightningMethod.due || amount,
      rate: lightningMethod.rate || null,
      status: invoice?.status || 'New',
      currency: invoice?.currency || 'USD',
      invoiceAmount,
    });
  } catch (err) {
    logger.error('[Lightning] Failed to get payment details', { error: err.message, invoiceId: req.params.invoiceId });
    res.status(500).json({ success: false, error: 'Failed to fetch payment details' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// BTCPay — Bitcoin + Lightning payments
// Buttons are hidden on the frontend when BTC is not yet configured in BTCPay.
// ─────────────────────────────────────────────────────────────────────────────

const btcAvailableLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  keyGenerator: (req) => req.ip,
  standardHeaders: true,
  legacyHeaders: false,
});

// GET /api/webapp/payments/btc/available — returns true only if BTC is configured in the BTCPay store
app.get('/api/webapp/payments/btc/available', btcAvailableLimiter, asyncHandler(async (req, res) => {
  if (!process.env.BTCPAY_API_KEY || !process.env.BTCPAY_STORE_ID || !process.env.BTCPAY_URL) {
    return res.json({ available: false, configured: false });
  }
  try {
    const resp = await axios.get(
      `${process.env.BTCPAY_URL}/api/v1/stores/${process.env.BTCPAY_STORE_ID}/payment-methods`,
      { headers: { Authorization: `token ${process.env.BTCPAY_API_KEY}` }, timeout: 5000 }
    );
    const methods = Array.isArray(resp.data) ? resp.data : [];
    const hasBtc = methods.some(m => m.paymentMethodId === 'BTC-CHAIN' || m.paymentMethodId === 'BTC-LN' || m.paymentMethodId === 'BTC-LightningNetwork');
    return res.json({ available: hasBtc, configured: hasBtc });
  } catch {
    return res.json({ available: false, configured: false });
  }
}));

const btcSubscribeLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 3,
  keyGenerator: (req) => req.session?.user?.id || req.ip,
  message: { success: false, error: 'Too many payment requests. Please wait a few minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// POST /api/webapp/payments/btc/create — create a BTCPay BTC+Lightning invoice for a subscription plan
app.post('/api/webapp/payments/btc/create', requireSessionAuth, btcSubscribeLimiter, asyncHandler(async (req, res) => {
  const user = req.session.user;
  const { planId, creatorId } = req.body;
  if (!planId) return res.status(400).json({ success: false, error: 'planId is required' });

  const userId = String(user.telegram_id || user.id);
  const { query: dbQuery } = require('../../config/postgres');
  const { createInvoice: createBtcpayInvoice } = require('../../config/btcpay');
  const webappUrl = process.env.WEBAPP_URL || 'https://pnptv.app';

  let usdAmount, planDisplayName;

  if (planId === 'creator_monthly') {
    if (!creatorId) return res.status(400).json({ success: false, error: 'creatorId is required for creator subscriptions' });
    if (String(creatorId) === userId) return res.status(400).json({ success: false, error: 'You cannot subscribe to yourself' });
    const creatorRes = await dbQuery('SELECT creator_price_usd, username, first_name FROM users WHERE id = $1 AND creator_status = $2', [String(creatorId), 'active']);
    if (!creatorRes.rows[0]) return res.status(404).json({ success: false, error: 'Creator not found' });
    const price = parseFloat(creatorRes.rows[0].creator_price_usd);
    if (!Number.isFinite(price) || price <= 0) return res.status(400).json({ success: false, error: 'Creator has no active subscription price' });
    usdAmount = price;
    planDisplayName = 'Premium subscription';
  } else {
    const planRes = await dbQuery('SELECT * FROM plans WHERE id = $1 AND active = true', [planId]);
    const plan = planRes.rows[0];
    if (!plan) return res.status(404).json({ success: false, error: 'Plan not found' });
    const basePrice = parseFloat(plan.price);
    usdAmount = (plan.payment_method === 'crypto' || basePrice <= 50) ? basePrice : Math.round(basePrice * 0.80 * 100) / 100;
    planDisplayName = plan.display_name || plan.name;
  }

  // Dedup: resume existing pending BTC invoice within 23h
  const existingRes = await dbQuery(
    `SELECT btcpay_invoice_id, metadata FROM dash_subscription_orders
     WHERE user_id = $1 AND plan_id = $2 AND status = 'pending'
       AND metadata->>'provider' = 'btcpay_btc'
       AND created_at > NOW() - INTERVAL '23 hours'
     ORDER BY created_at DESC LIMIT 1`,
    [userId, planId]
  );
  if (existingRes.rows.length > 0) {
    const meta = existingRes.rows[0].metadata || {};
    if (meta.checkoutUrl) {
      return res.json({ success: true, invoiceId: existingRes.rows[0].btcpay_invoice_id, checkoutUrl: meta.checkoutUrl, planName: planDisplayName, usdAmount, resumed: true });
    }
  }

  const orderId = `pnptv-btc-${userId}-${Date.now()}`;
  let invoice;
  try {
    invoice = await createBtcpayInvoice({
      amount: usdAmount,
      currency: 'USD',
      orderId,
      userId,
      planId,
      metadata: { provider: 'btcpay_btc', flow: 'subscription', creatorId: creatorId || null },
      redirectUrl: `${webappUrl}/subscribe`,
      paymentMethods: ['BTC-LightningNetwork', 'BTC'],
    });
  } catch (err) {
    logger.error('[BTC] Invoice creation failed', { userId, planId, error: err.message });
    return res.status(502).json({ success: false, error: 'Could not create BTC invoice. Please try again.', code: 'BTCPAY_BTC_ERROR' });
  }

  await dbQuery(
    `INSERT INTO dash_subscription_orders (user_id, plan_id, usd_amount, btcpay_invoice_id, status, creator_id, metadata)
     VALUES ($1, $2, $3, $4, 'pending', $5, $6)
     ON CONFLICT (btcpay_invoice_id) DO NOTHING`,
    [userId, planId, usdAmount, invoice.invoiceId, creatorId ? String(creatorId) : null,
     JSON.stringify({ provider: 'btcpay_btc', flow: 'subscription', checkoutUrl: invoice.checkoutLink })]
  );

  logger.info('[BTC] Subscription invoice created', { userId, planId, orderId: invoice.invoiceId, usdAmount });
  return res.json({ success: true, invoiceId: invoice.invoiceId, checkoutUrl: invoice.checkoutLink, planName: planDisplayName, usdAmount });
}));

const btcStatusLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: (req) => req.session?.user?.id || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
});

// GET /api/webapp/payments/btc/status/:invoiceId — poll BTC invoice status from DB
// Checks both dash_subscription_orders (subscription/creator) and token_purchases (wallet top-up).
app.get('/api/webapp/payments/btc/status/:invoiceId', requireSessionAuth, btcStatusLimiter, asyncHandler(async (req, res) => {
  const user = req.session.user;
  const { invoiceId } = req.params;
  if (!invoiceId || !/^[A-Za-z0-9_-]{5,100}$/.test(invoiceId)) {
    return res.status(400).json({ success: false, error: 'Invalid invoiceId' });
  }
  const userId = String(user.telegram_id || user.id);
  const { query: dbQuery } = require('../../config/postgres');

  // Check subscriptions/creator payments first
  const subResult = await dbQuery(
    `SELECT status FROM dash_subscription_orders WHERE btcpay_invoice_id = $1 AND user_id = $2 LIMIT 1`,
    [invoiceId, userId]
  );
  if (subResult.rows.length > 0) {
    const { status } = subResult.rows[0];
    return res.json({
      success: true, status,
      completed: status === 'completed',
      confirming: status === 'confirming' || status === 'confirmed',
      failed: status === 'failed' || status === 'expired',
    });
  }

  // Fall back to token purchases (integer user_id in token_purchases)
  const tokResult = await dbQuery(
    `SELECT tp.status FROM token_purchases tp
     JOIN users u ON u.id = tp.user_id
     WHERE tp.btcpay_invoice_id = $1 AND (u.telegram_id::text = $2 OR u.id::text = $2) LIMIT 1`,
    [invoiceId, userId]
  );
  if (tokResult.rows.length > 0) {
    const { status } = tokResult.rows[0];
    return res.json({
      success: true, status,
      completed: status === 'completed',
      confirming: status === 'confirming' || status === 'confirmed',
      failed: status === 'failed' || status === 'expired',
    });
  }

  return res.status(404).json({ success: false, error: 'Order not found' });
}));

// POST /api/wallet/buy-btc — BTCPay BTC+Lightning invoice for token purchase (20% discount)
app.post('/api/wallet/buy-btc', requireSessionAuth, asyncHandler(async (req, res) => {
  const user = req.session.user;
  const { packageId } = req.body;
  if (!packageId) return res.status(400).json({ success: false, error: 'packageId is required' });
  const userId = String(user.telegram_id || user.id);
  try {
    const result = await TokenCheckoutService.createBtcCheckout(userId, packageId);
    return res.json(result);
  } catch (err) {
    logger.error('[wallet/buy-btc]', { error: err.message, code: err.code });
    if (err.code === 'INVALID_PACKAGE') return res.status(404).json({ success: false, error: err.message });
    return res.status(502).json({ success: false, error: 'Could not create BTC invoice. Please try again.' });
  }
}));

// ─────────────────────────────────────────────────────────────────────────────
// NOWPayments — USDC / USDT stablecoin payments
// ─────────────────────────────────────────────────────────────────────────────

const NOWPAYMENTS_URL = process.env.NOWPAYMENTS_ENVIRONMENT === 'sandbox'
  ? 'https://api-sandbox.nowpayments.io/v1'
  : 'https://api.nowpayments.io/v1';
const NOWPAYMENTS_API_KEY = process.env.NOWPAYMENTS_API_KEY || '';

function validateNowpaymentsIpn(body, signature) {
  const secret = process.env.NOWPAYMENTS_IPN_SECRET || '';
  if (!secret || !signature) return false;
  const sortedBody = Object.keys(body).sort().reduce((acc, key) => {
    acc[key] = body[key];
    return acc;
  }, {});
  const hmac = crypto.createHmac('sha512', secret)
    .update(JSON.stringify(sortedBody))
    .digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(hmac, 'hex'), Buffer.from(signature, 'hex'));
  } catch {
    return false;
  }
}

const usdcAvailableLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  keyGenerator: (req) => req.ip,
  standardHeaders: true,
  legacyHeaders: false,
});

// GET /api/webapp/payments/usdc/available — check if NOWPayments is configured
app.get('/api/webapp/payments/usdc/available', usdcAvailableLimiter, asyncHandler(async (req, res) => {
  const configured = !!NOWPAYMENTS_API_KEY;
  return res.json({ available: configured, configured });
}));

const usdcPrepareLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 5,
  keyGenerator: (req) => req.session?.user?.id || req.ip,
  message: { success: false, error: 'Too many payment requests. Please wait a few minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Subscribable (recurring) plan IDs → NOWPayments subscription plan ID env var names
const NOWPAYMENTS_SUBSCRIPTION_PLAN_MAP = {
  'prime-week-pass-7d': 'NOWPAYMENTS_PLAN_WEEKLY',
  'monthly-pass': 'NOWPAYMENTS_PLAN_MONTHLY',
  'prime-diamond-pass-365d': 'NOWPAYMENTS_PLAN_YEARLY',
};

const usdcSubscribeLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 3,
  keyGenerator: (req) => req.session?.user?.id || req.ip,
  message: { success: false, error: 'Too many subscription requests. Please wait a few minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// POST /api/webapp/payments/usdc/subscribe — create NOWPayments invoice for recurring plans
// Accepts optional payCurrency ('btc', 'btcln', etc.) to pre-select payment currency.
app.post('/api/webapp/payments/usdc/subscribe', requireSessionAuth, usdcSubscribeLimiter, asyncHandler(async (req, res) => {
  if (!NOWPAYMENTS_API_KEY) {
    return res.status(503).json({ success: false, error: 'USDC payments are not configured.', code: 'NOWPAYMENTS_NOT_CONFIGURED' });
  }

  const user = req.session.user;
  const { planId, email: rawEmail, returnUrl: rawReturnUrl, payCurrency: rawPayCurrency } = req.body;
  if (!planId) return res.status(400).json({ success: false, error: 'planId is required' });

  const ALLOWED_PAY_CURRENCIES = new Set(['btc', 'btcln', 'eth', 'ltc', 'xmr', 'bch', 'usdt', 'usdttrc20', 'usdtbsc', 'usdc', 'usdcbsc', 'usdcsol', 'dash', 'sol', 'doge']);
  const validPayCurrency = (rawPayCurrency && ALLOWED_PAY_CURRENCIES.has(String(rawPayCurrency).toLowerCase()))
    ? String(rawPayCurrency).toLowerCase() : null;

  // NP-H-02: validate email if provided
  if (rawEmail != null && (typeof rawEmail !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail.trim()) || rawEmail.trim().length > 254)) {
    return res.status(400).json({ success: false, error: 'Invalid email address' });
  }
  const email = rawEmail?.trim() || null;

  const ALLOWED_RETURN_PATHS = new Set(['/subscribe', '/lifetime100']);
  const returnPath = (typeof rawReturnUrl === 'string' && ALLOWED_RETURN_PATHS.has(rawReturnUrl))
    ? rawReturnUrl
    : '/subscribe';

  const envVarName = NOWPAYMENTS_SUBSCRIPTION_PLAN_MAP[planId];
  if (!envVarName) {
    return res.status(400).json({ success: false, error: 'This plan does not support auto-renewing subscriptions.' });
  }
  const nowpaymentsPlanId = process.env[envVarName];
  if (!nowpaymentsPlanId) {
    return res.status(503).json({ success: false, error: 'Subscription plan not configured.', code: 'NOWPAYMENTS_NOT_CONFIGURED' });
  }

  const userId = String(user.telegram_id || user.id);
  const { query: dbQuery } = require('../../config/postgres');
  const webappUrl = process.env.WEBAPP_URL || 'https://pnptv.app';

  const planRes = await dbQuery('SELECT * FROM plans WHERE id = $1 AND active = true', [planId]);
  const plan = planRes.rows[0];
  if (!plan) return res.status(404).json({ success: false, error: 'Plan not found' });

  // Apply 20% crypto discount for non-crypto-fixed plans over $50
  const basePrice = parseFloat(plan.price);
  const usdAmount = (plan.payment_method === 'crypto' || basePrice <= 50)
    ? basePrice
    : Math.round(basePrice * 0.80 * 100) / 100;
  const planDisplayName = plan.display_name || plan.name;

  // Resume existing pending subscription invoice (within 23 hours)
  const existingRes = await dbQuery(
    `SELECT id, btcpay_invoice_id, metadata FROM dash_subscription_orders
     WHERE user_id = $1 AND plan_id = $2 AND status = 'pending'
       AND metadata->>'flow' = 'subscription'
       AND created_at > NOW() - INTERVAL '23 hours'
     ORDER BY created_at DESC LIMIT 1`,
    [userId, planId]
  );
  if (existingRes.rows.length > 0) {
    const meta = existingRes.rows[0].metadata || {};
    if (meta.invoiceUrl) {
      logger.info('[NOWPayments] Subscribe: resuming existing subscription invoice', { userId, planId });
      return res.json({ success: true, orderId: existingRes.rows[0].btcpay_invoice_id, invoiceUrl: meta.invoiceUrl, planName: planDisplayName, usdAmount, resumed: true });
    }
  }

  const orderId = `pnptv-nowp-sub-${userId}-${Date.now()}`;
  const customerEmail = email || user.email || null;

  let invoiceUrl;
  let npPayInfo = {};
  try {
    const paymentResp = await axios.post(`${NOWPAYMENTS_URL}/invoice`, {
      price_amount: usdAmount,
      price_currency: 'usd',
      pay_currency: validPayCurrency || 'usdcsol',
      order_id: orderId,
      order_description: `${planDisplayName} – PNPtv!`,
      ipn_callback_url: `${webappUrl}/api/webhooks/nowpayments`,
      ...(customerEmail ? { customer_email: customerEmail } : {}),
    }, {
      headers: { 'x-api-key': NOWPAYMENTS_API_KEY, 'Content-Type': 'application/json' },
      timeout: 10000,
    });
    const { id: nowpaymentsInvoiceId } = paymentResp.data;
    if (!nowpaymentsInvoiceId) throw new Error('No invoice id in response');
    invoiceUrl = `https://nowpayments.io/payment?iid=${nowpaymentsInvoiceId}`;
    npPayInfo = { nowpaymentsInvoiceId: String(nowpaymentsInvoiceId), payCurrency: validPayCurrency || 'usdcsol' };
  } catch (err) {
    logger.error('[NOWPayments] Subscription payment creation failed', { userId, planId, payCurrency: validPayCurrency, error: err.response?.data || err.message });
    return res.status(502).json({ success: false, error: 'Could not reach NOWPayments. Please try again.', code: 'NOWPAYMENTS_ERROR' });
  }

  await dbQuery(
    `INSERT INTO dash_subscription_orders
       (user_id, plan_id, email, usd_amount, btcpay_invoice_id, status, metadata)
     VALUES ($1, $2, $3, $4, $5, 'pending', $6)
     ON CONFLICT (btcpay_invoice_id) DO NOTHING`,
    [userId, planId, customerEmail, usdAmount, orderId,
     JSON.stringify({ provider: 'nowpayments', flow: 'subscription', invoiceUrl, nowpaymentsPlanId, ...(validPayCurrency ? { payCurrency: validPayCurrency } : {}) })]
  );

  logger.info('[NOWPayments] Subscription invoice created', { userId, planId, orderId, usdAmount, payCurrency: validPayCurrency });

  return res.json({ success: true, orderId, invoiceUrl, planName: planDisplayName, usdAmount, ...npPayInfo });
}));

// POST /api/webapp/payments/usdc/prepare — create a NowPayments hosted invoice for any plan.
// Accepts optional payCurrency ('btc', 'btcln', etc.) to pre-select payment currency.
app.post('/api/webapp/payments/usdc/prepare', requireSessionAuth, usdcPrepareLimiter, asyncHandler(async (req, res) => {
  if (!NOWPAYMENTS_API_KEY) {
    return res.status(503).json({ success: false, error: 'USDC payments are not configured.', code: 'NOWPAYMENTS_NOT_CONFIGURED' });
  }

  const user = req.session.user;
  const { planId, email, creatorId, returnUrl: rawReturnUrl, payCurrency: rawPayCurrency } = req.body;
  if (!planId) return res.status(400).json({ success: false, error: 'planId is required' });

  if (email != null && (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || email.trim().length > 254)) {
    return res.status(400).json({ success: false, error: 'Invalid email address' });
  }

  const ALLOWED_PAY_CURRENCIES_PREPARE = new Set(['btc', 'btcln', 'eth', 'ltc', 'xmr', 'bch', 'usdt', 'usdttrc20', 'usdtbsc', 'usdc', 'usdcbsc', 'usdcsol', 'dash', 'sol', 'doge']);
  const validPayCurrency = (rawPayCurrency && ALLOWED_PAY_CURRENCIES_PREPARE.has(String(rawPayCurrency).toLowerCase()))
    ? String(rawPayCurrency).toLowerCase() : null;

  const ALLOWED_RETURN_PATHS_PREPARE = new Set(['/subscribe', '/lifetime100']);
  const returnPath = (typeof rawReturnUrl === 'string' && ALLOWED_RETURN_PATHS_PREPARE.has(rawReturnUrl))
    ? rawReturnUrl
    : '/subscribe';

  const userId = String(user.telegram_id || user.id);
  const { query: dbQuery } = require('../../config/postgres');
  const webappUrl = process.env.WEBAPP_URL || 'https://pnptv.app';

  // Return existing pending invoice if created within the last 23 hours — avoids duplicate invoices
  // When payCurrency is specified, only resume invoices for the same currency to avoid
  // returning a USDC invoice when the user requested BTC.
  if (planId !== 'creator_monthly') {
    let resumeRes;
    if (validPayCurrency) {
      resumeRes = await dbQuery(
        `SELECT id, btcpay_invoice_id, usd_amount, plan_id, metadata FROM dash_subscription_orders
         WHERE user_id = $1 AND plan_id = $2 AND status = 'pending'
           AND metadata->>'flow' = 'hosted'
           AND metadata->>'payCurrency' = $3
           AND created_at > NOW() - INTERVAL '23 hours'
         ORDER BY created_at DESC LIMIT 1`,
        [userId, planId, validPayCurrency]
      );
    } else {
      resumeRes = await dbQuery(
        `SELECT id, btcpay_invoice_id, usd_amount, plan_id, metadata FROM dash_subscription_orders
         WHERE user_id = $1 AND plan_id = $2 AND status = 'pending'
           AND metadata->>'flow' = 'hosted'
           AND (metadata->>'payCurrency' IS NULL OR metadata->>'payCurrency' = '')
           AND created_at > NOW() - INTERVAL '23 hours'
         ORDER BY created_at DESC LIMIT 1`,
        [userId, planId]
      );
    }
    if (resumeRes.rows.length > 0) {
      const resumable = resumeRes.rows[0];
      const meta = resumable.metadata || {};
      if (meta.invoiceUrl) {
        logger.info('[NOWPayments] Prepare: resuming existing pending order', { userId, planId, orderId: resumable.btcpay_invoice_id, payCurrency: validPayCurrency });
        const resumePlan = await dbQuery('SELECT display_name, name FROM plans WHERE id = $1', [planId]).catch(() => ({ rows: [] }));
        const resumePlanName = resumePlan.rows[0]?.display_name || resumePlan.rows[0]?.name || planId;
        return res.json({
          success: true,
          orderId: resumable.btcpay_invoice_id,
          usdAmount: parseFloat(resumable.usd_amount),
          planName: resumePlanName,
          invoiceUrl: meta.invoiceUrl,
          resumed: true,
        });
      }
    }
  }

  let planDisplayName;
  let usdAmount;
  let discountInfo = null;

  if (planId === 'creator_monthly') {
    if (!creatorId) return res.status(400).json({ success: false, error: 'creatorId is required for creator subscriptions' });
    if (String(creatorId) === userId) return res.status(400).json({ success: false, error: 'You cannot subscribe to yourself' });
    const creatorRes = await dbQuery(
      'SELECT id, username, first_name, creator_price_usd, creator_locked, creator_subscription_paused FROM users WHERE id = $1 AND creator_status = $2',
      [String(creatorId), 'active']
    );
    if (creatorRes.rows.length === 0) return res.status(404).json({ success: false, error: 'Creator not found or not active' });
    const creator = creatorRes.rows[0];
    if (creator.creator_locked) {
      return res.status(423).json({ success: false, error: 'This creator is completing onboarding and cannot accept new subscriptions yet.', code: 'CREATOR_LOCKED' });
    }
    if (creator.creator_subscription_paused) {
      return res.status(423).json({ success: false, error: 'This creator has paused new memberships.', code: 'SUBSCRIPTIONS_PAUSED' });
    }
    // CS-PAY-M-01: require pnp-member before creating a creator_monthly invoice
    const EASPrepare = require('../../services/entitlementAccessService');
    const hasMemberPrepare = await EASPrepare.hasEntitlement(String(userId), 'pnp-member');
    if (!hasMemberPrepare) {
      return res.status(403).json({
        success: false,
        error: 'Se requiere membresía Basic para suscribirse a un creador.',
        code: 'MEMBER_REQUIRED',
      });
    }
    const price = parseFloat(creator.creator_price_usd);
    if (!Number.isFinite(price) || price <= 0) return res.status(400).json({ success: false, error: 'Creator has no active subscription price' });
    usdAmount = price;
    planDisplayName = 'Premium subscription';
  } else {
    const { query: planQuery } = require('../../config/postgres');
    const planRes = await planQuery('SELECT * FROM plans WHERE id = $1 AND active = true', [planId]);
    const plan = planRes.rows[0];
    if (!plan) return res.status(404).json({ success: false, error: 'Plan not found' });
    const basePrice = parseFloat(plan.price);
    // crypto payment_method = fixed promo price, no stacking discount
    if (plan.payment_method === 'crypto') {
      usdAmount = basePrice;
    } else if (basePrice > 50) {
      usdAmount = Math.round(basePrice * 0.80 * 100) / 100;
      discountInfo = { originalAmount: basePrice, discountPct: 20 };
    } else {
      usdAmount = basePrice;
    }
    planDisplayName = plan.display_name || plan.name;
  }

  const orderId = `pnptv-nowp-${userId}-${Date.now()}`;
  const ipnCallbackUrl = `${webappUrl}/api/webhooks/nowpayments`;

  let invoiceUrl;
  let npPayInfo2 = {};
  try {
    const paymentResp = await axios.post(`${NOWPAYMENTS_URL}/invoice`, {
      price_amount: usdAmount,
      price_currency: 'usd',
      pay_currency: validPayCurrency || 'usdcsol',
      order_id: orderId,
      order_description: `${planDisplayName} – PNPtv!`,
      ipn_callback_url: ipnCallbackUrl,
      ...(email ? { customer_email: email } : {}),
    }, {
      headers: { 'x-api-key': NOWPAYMENTS_API_KEY, 'Content-Type': 'application/json' },
      timeout: 10000,
    });
    const { id: nowpaymentsInvoiceId } = paymentResp.data;
    if (!nowpaymentsInvoiceId) throw new Error('No invoice id in response');
    invoiceUrl = `https://nowpayments.io/payment?iid=${nowpaymentsInvoiceId}`;
    npPayInfo2 = { nowpaymentsInvoiceId: String(nowpaymentsInvoiceId), payCurrency: validPayCurrency || 'usdcsol' };
  } catch (err) {
    logger.error('[NOWPayments] Payment creation failed', { userId, planId, orderId, payCurrency: validPayCurrency, error: err.message });
    return res.status(502).json({ success: false, error: 'Could not reach NOWPayments. Please try again.', code: 'NOWPAYMENTS_ERROR' });
  }

  await dbQuery(
    `INSERT INTO dash_subscription_orders
       (user_id, plan_id, email, usd_amount, btcpay_invoice_id, status, creator_id, metadata)
     VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7)
     ON CONFLICT (btcpay_invoice_id) DO NOTHING`,
    [
      userId,
      planId,
      email || null,
      usdAmount,
      orderId,
      creatorId ? String(creatorId) : null,
      JSON.stringify({ provider: 'nowpayments', flow: 'hosted', invoiceUrl, ...(validPayCurrency ? { payCurrency: validPayCurrency } : {}) }),
    ]
  );

  logger.info('[NOWPayments] Invoice created', { userId, planId, orderId, usdAmount, payCurrency: validPayCurrency, invoiceUrl });

  return res.json({
    success: true,
    orderId,
    usdAmount,
    planName: planDisplayName,
    invoiceUrl,
    ...(discountInfo || {}),
    ...npPayInfo2,
  });
}));

const usdcStatusLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30,
  keyGenerator: (req) => req.session?.user?.id || req.ip,
  message: { success: false, error: 'Too many status requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// GET /api/webapp/payments/usdc/status/:orderId — poll USDC invoice status
app.get('/api/webapp/payments/usdc/status/:orderId', requireSessionAuth, usdcStatusLimiter, asyncHandler(async (req, res) => {
  const user = req.session?.user;
  if (!user) return res.status(401).json({ success: false, error: 'Authentication required' });

  const { orderId } = req.params;
  if (!orderId || !/^pnptv-(tokens-)?nowp-[A-Za-z0-9_-]+-\d+$/.test(orderId)) {
    return res.status(400).json({ success: false, error: 'Invalid orderId' });
  }

  const userId = String(user.telegram_id || user.id);
  const { query: dbQuery } = require('../../config/postgres');
  const result = await dbQuery(
    `SELECT status FROM dash_subscription_orders WHERE btcpay_invoice_id = $1 AND user_id = $2 LIMIT 1`,
    [orderId, userId]
  );

  if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'Order not found' });
  const { status } = result.rows[0];
  return res.json({
    success: true,
    status,
    completed: status === 'completed',
    confirming: status === 'confirming' || status === 'confirmed',
    failed: status === 'failed' || status === 'expired',
    partiallyPaid: status === 'partially_paid',
  });
}));

// POST /api/webapp/payments/efipay/checkout — proxy to easybots.store EfiPay checkout
// Supports: creator_membership, channel_access, call_package, token_package
app.post('/api/webapp/payments/efipay/checkout', requireSessionAuth, asyncHandler(async (req, res) => {
  const user = req.session?.user;
  if (!user) return res.status(401).json({ success: false, error: 'Authentication required' });

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const VALID_TYPES = ['creator_membership', 'channel_access', 'call_package', 'token_package'];
  const { product_type, resource_id, email: bodyEmail } = req.body ?? {};

  // Session email preferred; accept a body-supplied email for Telegram users who have none
  const rawEmail = user.email || bodyEmail;
  if (!rawEmail || !EMAIL_RE.test(String(rawEmail).trim())) {
    return res.status(400).json({ success: false, error: 'no_email_on_account' });
  }
  const email = String(rawEmail).trim().toLowerCase().slice(0, 255);
  if (!product_type || !VALID_TYPES.includes(product_type)) {
    return res.status(400).json({ success: false, error: 'invalid_product_type', valid: VALID_TYPES });
  }
  if (!resource_id) return res.status(400).json({ success: false, error: 'resource_id_required' });

  const easybotsUrl = (process.env.EASYBOTS_API_URL ?? 'https://easybots.store') + '/api/pnptv/checkout';
  const upstream = await fetch(easybotsUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, product_type, resource_id: String(resource_id) }),
    signal: AbortSignal.timeout(15000),
  });
  const data = await upstream.json().catch(() => ({}));
  if (!upstream.ok) {
    // Only forward the safe error code — never spread internal easybots fields
    const safeError = typeof data.error === 'string' ? data.error : 'checkout_unavailable';
    return res.status(upstream.status < 500 ? upstream.status : 502).json({ success: false, error: safeError });
  }
  return res.json({ success: true, checkout_url: data.checkout_url, order_id: data.order_id,
    amount_usd: data.amount_usd, label: data.label });
}));

// POST /api/webhooks/nowpayments — NOWPayments IPN webhook
// Processes synchronously so NOWPayments retries on any 5xx (no fire-and-forget).
// Grant runs BEFORE marking completed so a crash leaves the order retryable.
app.post('/api/webhooks/nowpayments', webhookLimiter, express.json(), asyncHandler(async (req, res) => {
  const sig = req.headers['x-nowpayments-sig'];
  if (!validateNowpaymentsIpn(req.body, sig)) {
    logger.warn('[NOWPayments] Invalid IPN signature');
    return res.status(400).json({ error: 'invalid_signature' });
  }

  const { payment_id, payment_status, order_id, actually_paid, pay_amount, price_amount, price_currency, pay_currency } = req.body;

  // NP-M-05: reject IPNs missing required fields
  if (!payment_id || !payment_status || !order_id) {
    logger.warn('[NOWPayments] IPN: missing required fields', { payment_id, payment_status, order_id });
    return res.status(400).json({ error: 'missing_fields' });
  }

  logger.info('[NOWPayments] IPN received', { payment_id, payment_status, order_id });

  const { query: dbQuery } = require('../../config/postgres');

  // Intermediate / terminal non-success statuses — update DB and ack immediately
  if (payment_status === 'wrong_asset_confirmed') {
    logger.error('[NOWPayments] IPN: wrong asset sent', { order_id, pay_currency, payment_id });
    await dbQuery(
      `UPDATE dash_subscription_orders SET status = 'failed', notes = $2 WHERE btcpay_invoice_id = $1 AND status NOT IN ('completed','failed')`,
      [order_id, `nowpayments:${payment_id}:wrong_asset`]
    );
    return res.json({ received: true });
  }

  if (payment_status === 'partially_paid') {
    logger.warn('[NOWPayments] IPN: partial payment', { order_id, actually_paid, pay_currency });
    await dbQuery(
      `UPDATE dash_subscription_orders SET status = 'partially_paid', notes = $2 WHERE btcpay_invoice_id = $1 AND status NOT IN ('completed','failed')`,
      [order_id, `nowpayments:${payment_id}:partial:${actually_paid}${pay_currency ? ' ' + pay_currency : ''}`]
    );
    return res.json({ received: true });
  }

  if (payment_status === 'failed' || payment_status === 'refunded') {
    await dbQuery(
      `UPDATE dash_subscription_orders SET status = 'failed', notes = $2 WHERE btcpay_invoice_id = $1 AND status NOT IN ('completed','failed')`,
      [order_id, `nowpayments:${payment_id}:${payment_status}`]
    );

    // C-2: For refunds, also revoke entitlements regardless of whether the order
    // was already marked completed (the UPDATE above no-ops on completed orders).
    if (payment_status === 'refunded') {
      try {
        const orderRes = await dbQuery(
          `SELECT user_id, creator_id, plan_id FROM dash_subscription_orders WHERE btcpay_invoice_id = $1 LIMIT 1`,
          [order_id]
        );
        const order = orderRes.rows[0];
        if (order && order.creator_id) {
          const { user_id: refundUserId, creator_id: refundCreatorId } = order;
          await dbQuery(
            `UPDATE user_entitlements SET expires_at = NOW(), updated_at = NOW()
             WHERE user_id = $1 AND add_on_id = 'creator-subscription' AND creator_id = $2
               AND expires_at > NOW()`,
            [String(refundUserId), String(refundCreatorId)]
          );
          await dbQuery(
            `UPDATE creator_subscriptions SET status = 'cancelled', cancelled_at = NOW()
             WHERE subscriber_id = $1 AND creator_id = $2 AND status = 'active'`,
            [String(refundUserId), String(refundCreatorId)]
          );
          // Also revoke any channel-access entitlement tied to this payment
          // and refresh subscriber_count for the affected channel(s)
          const revokedChannelRes = await dbQuery(
            `UPDATE user_entitlements SET expires_at = NOW(), updated_at = NOW()
             WHERE user_id = $1 AND add_on_id = 'channel-access'
               AND source_payment_id = $2 AND expires_at > NOW()
             RETURNING creator_id`,
            [String(refundUserId), order_id]
          );
          if (revokedChannelRes.rows.length > 0) {
            const affectedChannelIds = [...new Set(revokedChannelRes.rows.map(r => r.creator_id).filter(Boolean))];
            for (const chId of affectedChannelIds) {
              try {
                await dbQuery(
                  `UPDATE creator_channels
                     SET subscriber_count = (
                       SELECT COUNT(*) FROM user_entitlements
                       WHERE add_on_id = 'channel-access'
                         AND creator_id = $1::text
                         AND is_consumed = false
                         AND (is_lifetime = true OR expires_at > NOW())
                     )
                   WHERE id = $1::integer`,
                  [chId]
                );
              } catch (_scErr) { /* non-critical */ }
            }
          }
          await dbQuery(
            `UPDATE creator_earnings SET status = 'void'
             WHERE source_payment_id = $1 AND status IN ('holding', 'pending')`,
            [order_id]
          );
          try {
            await EntitlementAccessService.invalidateCache(String(refundUserId));
          } catch (_) { /* non-fatal */ }
          logger.info('[NOWPayments] Refund: entitlements revoked and earnings voided', {
            order_id, userId: refundUserId, creatorId: refundCreatorId,
          });
        }
      } catch (refundErr) {
        logger.error('[NOWPayments] Refund: entitlement revocation failed', { order_id, error: refundErr.message });
      }
    }

    return res.json({ received: true });
  }

  if (payment_status === 'expired') {
    await dbQuery(
      `UPDATE dash_subscription_orders SET status = 'expired', notes = $2 WHERE btcpay_invoice_id = $1 AND status NOT IN ('completed','failed','expired')`,
      [order_id, `nowpayments:${payment_id}:expired`]
    );
    return res.json({ received: true });
  }

  if (payment_status === 'confirming' || payment_status === 'sending') {
    const internalStatus = 'confirming';
    await dbQuery(
      `UPDATE dash_subscription_orders SET status = $2 WHERE btcpay_invoice_id = $1 AND status NOT IN ('completed','failed','confirmed',$2)`,
      [order_id, internalStatus]
    );
    return res.json({ received: true });
  }

  // For stablecoins, on-chain confirmation = settled — treat as finished immediately.
  const STABLECOIN_CURRENCIES = new Set(['usdttrc20', 'usdterc20', 'usdcsol', 'usdcerc20', 'usdcmatic', 'usdc', 'usdt', 'usdcbsc', 'usdtbsc']);
  const isStablecoin = pay_currency && STABLECOIN_CURRENCIES.has(pay_currency.toLowerCase());

  if (payment_status === 'confirmed') {
    await dbQuery(
      `UPDATE dash_subscription_orders SET status = 'confirmed' WHERE btcpay_invoice_id = $1 AND status NOT IN ('completed','failed','confirmed')`,
      [order_id]
    );
    if (!isStablecoin) {
      return res.json({ received: true });
    }
    logger.info('[NOWPayments] IPN: stablecoin confirmed — falling through to grant', { order_id, pay_currency });
    // fall through to the grant path below
  }

  if (payment_status === 'waiting') {
    return res.json({ received: true });
  }

  if (payment_status !== 'finished' && !(payment_status === 'confirmed' && isStablecoin)) {
    logger.warn('[NOWPayments] IPN: unknown payment_status', { payment_status, order_id });
    return res.json({ received: true });
  }

  // Verify payment exists in NowPayments API before granting (covers both 'finished' and stablecoin 'confirmed').
  // Guards against test IPNs sent from the merchant dashboard (they pass HMAC but have fake payment IDs).
  try {
    const verifyRes = await fetch(`${NOWPAYMENTS_URL}/payment/${payment_id}`, {
      headers: { 'x-api-key': NOWPAYMENTS_API_KEY },
    });
    if (verifyRes.status === 404) {
      logger.error('[NOWPayments] IPN: payment_id not found in NowPayments API — likely test IPN, rejecting', { payment_id, order_id });
      return res.status(400).json({ error: 'payment_not_found' });
    }
    if (!verifyRes.ok) {
      logger.error('[NOWPayments] IPN: payment verification API error — rejecting for retry', { payment_id, status: verifyRes.status });
      return res.status(500).json({ error: 'payment_verification_unavailable' });
    }
  } catch (verifyErr) {
    logger.error('[NOWPayments] IPN: payment verification request failed — rejecting for retry', { payment_id, error: verifyErr.message });
    return res.status(500).json({ error: 'payment_verification_unavailable' });
  }

  // NP-H-01: atomic processing lock — prevents double-grant on concurrent IPN deliveries
  const lockRes = await dbQuery(
    `UPDATE dash_subscription_orders SET status = 'processing'
     WHERE btcpay_invoice_id = $1 AND status NOT IN ('completed','failed','processing')
     RETURNING id, user_id, plan_id, usd_amount, creator_id, metadata`,
    [order_id]
  );

  if (lockRes.rows.length === 0) {
    // Either already completed/failed, or another delivery is processing — idempotent ack
    const existingRes = await dbQuery(
      `SELECT id, status, user_id, plan_id, usd_amount, creator_id FROM dash_subscription_orders WHERE btcpay_invoice_id = $1 LIMIT 1`,
      [order_id]
    );
    const existing = existingRes.rows[0];
    if (!existing) {
      logger.error('[NOWPayments] IPN: order not found', { order_id });
      return res.status(404).json({ error: 'order_not_found' });
    }

    // Subscription renewal: the original order is already completed but NOWPayments fires a new
    // IPN with the same order_id for each billing cycle. Create a renewal order and re-grant.
    if (existing.status === 'completed' && req.body.subscription_id) {
      const renewalOrderId = `${order_id}:renewal:${payment_id}`;
      const renewalCheck = await dbQuery(
        `SELECT id FROM dash_subscription_orders WHERE btcpay_invoice_id = $1 LIMIT 1`,
        [renewalOrderId]
      );
      if (renewalCheck.rows.length > 0) {
        logger.info('[NOWPayments] IPN: renewal already processed', { order_id, renewalOrderId });
        return res.json({ received: true });
      }

      logger.info('[NOWPayments] IPN: subscription renewal detected', { order_id, renewalOrderId, subscriptionId: req.body.subscription_id });

      // Verify renewal payment exists (same test-IPN guard as the primary grant path)
      try {
        const renewalVerifyRes = await fetch(`${NOWPAYMENTS_URL}/payment/${payment_id}`, {
          headers: { 'x-api-key': NOWPAYMENTS_API_KEY },
        });
        if (renewalVerifyRes.status === 404) {
          logger.error('[NOWPayments] IPN: renewal payment_id not found in API — likely test IPN, rejecting', { payment_id, renewalOrderId });
          return res.status(400).json({ error: 'payment_not_found' });
        }
        if (!renewalVerifyRes.ok) {
          logger.error('[NOWPayments] IPN: renewal payment verification API error — rejecting for retry', { payment_id, status: renewalVerifyRes.status });
          return res.status(500).json({ error: 'payment_verification_unavailable' });
        }
      } catch (renewalVerifyErr) {
        logger.error('[NOWPayments] IPN: renewal payment verification failed — rejecting for retry', { payment_id, error: renewalVerifyErr.message });
        return res.status(500).json({ error: 'payment_verification_unavailable' });
      }

      await dbQuery(
        `INSERT INTO dash_subscription_orders
           (user_id, plan_id, usd_amount, btcpay_invoice_id, status, metadata)
         VALUES ($1, $2, $3, $4, 'processing', $5)
         ON CONFLICT (btcpay_invoice_id) DO NOTHING`,
        [
          existing.user_id,
          existing.plan_id,
          existing.usd_amount,
          renewalOrderId,
          JSON.stringify({ provider: 'nowpayments', flow: 'subscription_renewal', subscriptionId: req.body.subscription_id, originalOrderId: order_id, paymentId: String(payment_id) }),
        ]
      );

      try {
        const PaymentServiceRenewal = require('../../services/paymentService');
        const isRenewalDonation = existing.plan_id?.startsWith('donation');

        // CS-PAY-M-02: creator_monthly renewal must still hold pnp-member — same gate as initial purchase
        if (existing.plan_id === 'creator_monthly') {
          const EAS = require('../../services/entitlementAccessService');
          const hasMember = await EAS.hasEntitlement(String(existing.user_id), 'pnp-member');
          if (!hasMember) {
            logger.warn('[NOWPayments] IPN: creator_monthly renewal — user lost pnp-member, skipping grant', {
              userId: existing.user_id, renewalOrderId,
            });
            await dbQuery(
              `UPDATE dash_subscription_orders SET status = 'pending', notes = $2 WHERE btcpay_invoice_id = $1`,
              [renewalOrderId, 'creator_monthly_renewal:no_pnp_member']
            ).catch(() => {});
            return res.json({ received: true });
          }
        }

        const renewalGrantResult = await PaymentServiceRenewal.grantEntitlementsForPlan(
          existing.user_id,
          existing.plan_id,
          'nowpayments',
          existing.creator_id ? { creatorId: String(existing.creator_id) } : null,
          renewalOrderId
        );
        if (!isRenewalDonation && (!renewalGrantResult || renewalGrantResult.granted === 0)) {
          await dbQuery(
            `UPDATE dash_subscription_orders SET status = 'pending', notes = $2 WHERE btcpay_invoice_id = $1`,
            [renewalOrderId, `renewal:grant_zero:${existing.plan_id}`]
          ).catch(() => {});
          throw new Error(`grantEntitlementsForPlan returned zero grants for renewal plan ${existing.plan_id}`);
        }
      } catch (renewalGrantErr) {
        await dbQuery(
          `UPDATE dash_subscription_orders SET status = 'pending', notes = $2 WHERE btcpay_invoice_id = $1`,
          [renewalOrderId, `renewal:grant_failed:${renewalGrantErr.message}`.slice(0, 500)]
        ).catch(() => {});
        throw renewalGrantErr;
      }

      await dbQuery(
        `UPDATE dash_subscription_orders SET status = 'completed', completed_at = NOW(), notes = $2 WHERE btcpay_invoice_id = $1`,
        [renewalOrderId, `nowpayments:renewal:${payment_id}`]
      );

      // Record creator earnings on renewal — intentionally non-fatal (entitlement already extended)
      if (existing.plan_id === 'creator_monthly' && existing.creator_id) {
        try {
          const CreatorServiceRenewal = require('../../services/creatorService');
          await CreatorServiceRenewal.subscribeToCreator(
            existing.user_id, String(existing.creator_id), renewalOrderId || order_id
          );
        } catch (renewalCreatorErr) {
          logger.warn('[NOWPayments] IPN: subscribeToCreator failed on renewal (earnings not recorded — manual reconciliation needed)', {
            userId: existing.user_id, creatorId: existing.creator_id, error: renewalCreatorErr.message,
          });
        }
      }

      try {
        const { cache: renewalCache } = require('../../config/redis');
        await renewalCache.del(`user:${existing.user_id}`);
        await renewalCache.del(`session:user:${existing.user_id}`);
      } catch {}

      logger.info('[NOWPayments] IPN: subscription renewal completed', { userId: existing.user_id, planId: existing.plan_id, renewalOrderId });
      return res.json({ received: true });
    }

    logger.info('[NOWPayments] IPN: already processed or in-flight', { order_id, status: existing.status });
    return res.json({ received: true });
  }

  const order = lockRes.rows[0];

  // NP-M-01: amount validation — reject underpayments > 2%
  // For cross-currency payments (e.g. BTC paying a USD invoice) compare actually_paid
  // against pay_amount (both in pay_currency). If pay_amount is missing from the IPN body
  // (observed with some BTC finished IPNs), skip the check entirely — the API verification
  // above already confirmed the payment exists, and the reconciler will catch any real shortfall.
  if (actually_paid != null) {
    const paid = parseFloat(actually_paid);
    const isCrossCurrency = pay_currency && (price_currency || 'usd').toLowerCase() !== pay_currency.toLowerCase();
    // Only run underpayment check when we can compare amounts in the same currency.
    // Cross-currency with missing pay_amount would compare crypto vs fiat — skip to avoid false positives.
    if (!isCrossCurrency || pay_amount != null) {
      const referenceAmount = (isCrossCurrency && pay_amount != null)
        ? parseFloat(pay_amount)
        : (price_amount != null ? parseFloat(price_amount) : null);
      if (referenceAmount != null && Number.isFinite(paid) && Number.isFinite(referenceAmount) && referenceAmount > 0 && paid < referenceAmount * 0.98) {
        logger.warn('[NOWPayments] IPN: underpayment detected', { order_id, actually_paid, pay_amount, price_amount, pay_currency, isCrossCurrency });
        await dbQuery(
          `UPDATE dash_subscription_orders SET status = 'partially_paid', notes = $2 WHERE btcpay_invoice_id = $1`,
          [order_id, `nowpayments:${payment_id}:underpaid:${actually_paid}/${referenceAmount}`]
        );
        return res.json({ received: true });
      }
    }
  }

  // call_package orders: route to callCheckoutService.onCallPaymentSuccess instead of grantEntitlementsForPlan
  if (order.plan_id === 'call_package') {
    const callMeta = order.metadata || {};
    const callPaymentId = callMeta.paymentId;
    if (!callPaymentId) {
      await dbQuery(
        `UPDATE dash_subscription_orders SET status = 'pending', notes = $2 WHERE btcpay_invoice_id = $1`,
        [order_id, 'call_package:missing_paymentId']
      ).catch(() => {});
      throw new Error(`call_package IPN: missing paymentId in DSO metadata for order ${order_id}`);
    }
    try {
      const CallCheckoutSvc = require('../../services/callCheckoutService');
      await CallCheckoutSvc.onCallPaymentSuccess(callPaymentId);
    } catch (callGrantErr) {
      await dbQuery(
        `UPDATE dash_subscription_orders SET status = 'pending', notes = $2 WHERE btcpay_invoice_id = $1`,
        [order_id, `call_package:grant_failed:${callGrantErr.message}`.slice(0, 500)]
      ).catch(() => {});
      throw callGrantErr;
    }
    await dbQuery(
      `UPDATE dash_subscription_orders SET status = 'completed', completed_at = NOW(), notes = $2 WHERE btcpay_invoice_id = $1`,
      [order_id, `nowpayments:call:${payment_id}`]
    );
    logger.info('[NOWPayments] IPN: call_package credits granted', { order_id, callPaymentId, userId: order.user_id });
    // Confirmation notification for call_package (was missing before — path exited early)
    try {
      const PaymentNotifSvcCall = require('../../services/paymentNotificationService');
      await PaymentNotifSvcCall.deliverPurchaseConfirmation(order.user_id, {
        planId: 'call_package',
        planName: 'Call Package',
        amount: parseFloat(order.usd_amount) || 0,
        transactionId: String(payment_id),
        provider: 'nowpayments',
      });
    } catch (_) { /* non-fatal */ }
    return res.json({ received: true });
  }

  // Scoped resource purchase (channel_access / hangout_access via NowPayments)
  const orderMetaScoped = order.metadata || {};
  if ((order.plan_id === 'channel_access' || order.plan_id === 'hangout_access') &&
      (orderMetaScoped.channelId || orderMetaScoped.hangoutGroupId)) {
    try {
      const PaymentServiceScoped = require('../../services/paymentService');
      const scopedGrant = await PaymentServiceScoped.grantEntitlementsForPlan(
        order.user_id,
        order.plan_id,
        'nowpayments',
        orderMetaScoped,
        order_id
      );
      if (!scopedGrant || scopedGrant.granted === 0) {
        await dbQuery(
          `UPDATE dash_subscription_orders SET status = 'pending', notes = $2 WHERE btcpay_invoice_id = $1`,
          [order_id, `nowpayments:scoped_grant_zero:${order.plan_id}`]
        ).catch(() => {});
        throw new Error(`grantEntitlementsForPlan returned zero grants for scoped plan ${order.plan_id}`);
      }
      await dbQuery(
        `UPDATE dash_subscription_orders SET status = 'completed', completed_at = NOW(), notes = $2 WHERE btcpay_invoice_id = $1`,
        [order_id, `nowpayments:scoped:${payment_id}`]
      );
      logger.info('[NOWPayments] IPN: scoped purchase granted', {
        order_id, planId: order.plan_id,
        channelId: orderMetaScoped.channelId, hangoutGroupId: orderMetaScoped.hangoutGroupId,
      });
      return res.json({ received: true });
    } catch (scopedErr) {
      await dbQuery(
        `UPDATE dash_subscription_orders SET status = 'pending', notes = $2 WHERE btcpay_invoice_id = $1`,
        [order_id, `nowpayments:scoped_failed:${scopedErr.message}`.slice(0, 500)]
      ).catch(() => {});
      throw scopedErr;
    }
  }

  // CS-PAY-C-03: creator_monthly requires pnp-member — gate before any grant attempt
  if (order.plan_id === 'creator_monthly') {
    const EAS = require('../../services/entitlementAccessService');
    const hasMember = await EAS.hasEntitlement(String(order.user_id), 'pnp-member');
    if (!hasMember) {
      logger.error('[NOWPayments] IPN: creator_monthly order but user has no pnp-member — skipping grant', { userId: order.user_id, order_id });
      return res.json({ received: true }); // Ack without granting — do not 400
    }
  }

  // Grant FIRST — if this throws, roll back to pending so NOWPayments retries
  let creatorSubExpiresAt = null;
  try {
    const PaymentServiceGf = require('../../services/paymentService');
    // Donation plans (donation-10, donation-25, etc.) have no plan_add_ons and
    // intentionally return zero grants — treat as a successful no-op, not an error.
    const isDonationPlan = order.plan_id?.startsWith('donation');

    // CS-PAY-C-02: for creator_monthly, subscribeToCreator is the sole entitlement grant path.
    // Do NOT also call grantEntitlementsForPlan — it would double-extend the expiry.
    if (order.plan_id === 'creator_monthly' && order.creator_id) {
      const CreatorService = require('../../services/creatorService');
      const subResult = await CreatorService.subscribeToCreator(order.user_id, String(order.creator_id), order_id);
      creatorSubExpiresAt = subResult?.expiresAt || null;
    } else {
      const grantResult = await PaymentServiceGf.grantEntitlementsForPlan(
        order.user_id,
        order.plan_id,
        'nowpayments',
        order.creator_id ? { creatorId: String(order.creator_id) } : null,
        order_id
      );

      // NP-H-03: zero-grant guard — roll back so NOWPayments retries (skip for donations)
      if (!isDonationPlan && (!grantResult || grantResult.granted === 0)) {
        await dbQuery(
          `UPDATE dash_subscription_orders SET status = 'pending', notes = $2 WHERE btcpay_invoice_id = $1`,
          [order_id, `nowpayments:grant_zero:${order.plan_id}`.slice(0, 500)]
        ).catch(() => {});
        throw new Error(`grantEntitlementsForPlan returned zero grants for plan ${order.plan_id}`);
      }
    }
  } catch (grantErr) {
    // Roll back lock so this IPN delivery can be retried
    await dbQuery(
      `UPDATE dash_subscription_orders SET status = 'pending', notes = $2 WHERE btcpay_invoice_id = $1`,
      [order_id, `nowpayments:grant_failed:${grantErr.message}`.slice(0, 500)]
    ).catch(() => {});
    throw grantErr;
  }

  // Mark completed only after successful grant
  await dbQuery(
    `UPDATE dash_subscription_orders SET status = 'completed', completed_at = NOW(), notes = $2 WHERE btcpay_invoice_id = $1`,
    [order_id, `nowpayments:${payment_id}`]
  );

  // Sync users.plan_id + plan_expiry for admin visibility — skip for creator_monthly.
  // NP-NOTE: tier + subscription_status are already synced by recomputeUserTier inside
  // grantEntitlementsForPlan above. We only need plan_id + plan_expiry here.
  // Uses bypass transaction so the lifetime-fields trigger never blocks a legitimate grant.
  if (order.plan_id !== 'creator_monthly') {
    const isDonationForTier = order.plan_id?.startsWith('donation');
    if (isDonationForTier) {
      // Donation plans have no plan_add_ons; recomputeUserTier (already called inside
      // grantEntitlementsForPlan) handles tier. Nothing else to do.
    } else {
      try {
        const PlanModelNpTier = require('../../models/planModel');
        const planForTier = await PlanModelNpTier.getById(order.plan_id).catch(() => null);
        if (planForTier) {
          // NP-H-02: lifetime plans store NULL expiry
          const isLifetimePlan = planForTier.is_lifetime === true || (planForTier.duration_days && planForTier.duration_days >= 36500);
          const newExpiry = isLifetimePlan
            ? null
            : planForTier.duration_days
              ? new Date(Date.now() + planForTier.duration_days * 86400000).toISOString()
              : null;
          const { getClient: _npGetClient } = require('../../config/postgres');
          const _npTx = await _npGetClient();
          try {
            await _npTx.query('BEGIN');
            await _npTx.query("SET LOCAL pnptv.superadmin_bypass = 'true'");
            await _npTx.query(
              `UPDATE users SET plan_id = $2,
                 plan_expiry = CASE
                   WHEN plan_expiry IS NULL THEN NULL
                   WHEN $3::timestamptz IS NULL THEN NULL
                   WHEN plan_expiry > $3::timestamptz THEN plan_expiry
                   ELSE $3::timestamptz
                 END,
                 updated_at = NOW()
               WHERE id = $1`,
              [order.user_id, planForTier.id, newExpiry]
            );
            await _npTx.query('COMMIT');
          } catch (txErr) {
            await _npTx.query('ROLLBACK').catch(() => {});
            throw txErr;
          } finally {
            _npTx.release();
          }
        }
      } catch (planSyncErr) {
        logger.warn('[NOWPayments] IPN: plan_id/plan_expiry sync failed (non-critical)', { userId: order.user_id, planId: order.plan_id, error: planSyncErr.message });
      }
    }
  }

  // Invalidate user session cache so tier update is reflected immediately
  try {
    const { cache: npCache } = require('../../config/redis');
    await npCache.del(`user:${order.user_id}`);
    await npCache.del(`session:user:${order.user_id}`);
  } catch (cacheErr) {
    logger.warn('[NOWPayments] IPN: cache invalidation failed (non-fatal)', { userId: order.user_id, error: cacheErr.message });
  }

  // Send confirmation notifications (non-fatal)
  try {
    const PlanModelNP = require('../../models/planModel');
    const planForNotif = await PlanModelNP.getById(order.plan_id).catch(() => null);
    const planName = planForNotif?.display_name || planForNotif?.name || order.plan_id;
    const isLifetime = planForNotif?.is_lifetime || false;
    const durationDays = planForNotif?.duration_days || 30;
    const expiryDate = order.plan_id === 'creator_monthly' && creatorSubExpiresAt
      ? creatorSubExpiresAt
      : (isLifetime ? null : new Date(Date.now() + durationDays * 86400000));
    const PaymentNotifSvcNP = require('../../services/paymentNotificationService');
    await PaymentNotifSvcNP.deliverPurchaseConfirmation(order.user_id, {
      planId: order.plan_id,
      planName,
      amount: parseFloat(order.usd_amount) || 0,
      transactionId: String(payment_id),
      provider: 'nowpayments',
      expiryDate,
      isLifetime,
    });
  } catch (notifErr) {
    logger.warn('[NOWPayments] IPN: notification block failed (non-fatal)', { userId: order.user_id, error: notifErr.message });
  }

  // Operator alerts — fire-and-forget.
  try {
    const PaymentNotificationServiceNP = require('../../services/paymentNotificationService');
    const BusinessNotificationServiceNP = require('../../services/businessNotificationService');
    const { getBotInstance: getNPBot } = require('../core/bot');
    const { query: pgQ2 } = require('../../config/postgres');
    const PlanModelNP2 = require('../../models/planModel');
    const planForAlert = await PlanModelNP2.getById(order.plan_id).catch(() => null);
    const planNameAlert = planForAlert?.display_name || planForAlert?.name || order.plan_id;
    const uDataAlert = await pgQ2('SELECT first_name FROM users WHERE id = $1', [order.user_id]);
    const customerNameAlert = uDataAlert.rows[0]?.first_name || order.user_id;
    await PaymentNotificationServiceNP.sendAdminPaymentNotification({
      bot: getNPBot(),
      userId: order.user_id,
      planName: planNameAlert,
      amount: parseFloat(order.usd_amount) || 0,
      provider: 'nowpayments',
      transactionId: String(payment_id),
      customerName: customerNameAlert,
      customerEmail: 'N/A',
    });
    await BusinessNotificationServiceNP.notifyPayment({
      userId: order.user_id,
      planName: planNameAlert,
      amount: parseFloat(order.usd_amount) || 0,
      provider: 'USDC (NowPayments)',
      transactionId: String(payment_id),
      customerName: customerNameAlert,
    });
  } catch (alertErr) {
    logger.warn('[NOWPayments] IPN: operator alert failed (non-fatal)', { error: alertErr.message });
  }

  // Record in payment_history for admin visibility
  try {
    const PaymentHistoryService = require('../../services/paymentHistoryService');
    await PaymentHistoryService.recordPayment({
      userId: order.user_id,
      paymentMethod: 'nowpayments',
      amount: parseFloat(order.usd_amount) || 0,
      currency: 'USD',
      planId: order.plan_id,
      product: order.plan_id,
      paymentReference: order_id,
      providerTransactionId: String(payment_id),
      providerPaymentId: String(payment_id),
      webhookData: req.body,
      status: 'completed',
    });
  } catch (histErr) {
    logger.warn('[NOWPayments] IPN: payment_history write failed (non-fatal)', { error: histErr.message });
  }

  // Insert canonical payments row — required for admin panel, reconciliation, and refund tracking
  try {
    const { query: pgInsert } = require('../../config/postgres');
    const PlanModelNP3 = require('../../models/planModel');
    const planForPayment = await PlanModelNP3.getById(order.plan_id).catch(() => null);
    const planNameForPayment = planForPayment?.display_name || planForPayment?.name || order.plan_id;
    await pgInsert(
      `INSERT INTO payments (
         user_id, plan_id, plan_name, amount, currency, provider, payment_method,
         status, payment_id, reference, transaction_id, completed_at, completed_by,
         manual_completion, metadata, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,'USD','nowpayments','usdc','completed',$5,$6,$7,NOW(),'nowpayments_webhook',false,$8::jsonb,NOW(),NOW())
       ON CONFLICT (provider, transaction_id) WHERE transaction_id IS NOT NULL DO NOTHING`,
      [
        order.user_id,
        order.plan_id,
        planNameForPayment,
        parseFloat(order.usd_amount) || 0,
        order_id,
        order_id,
        String(payment_id),
        JSON.stringify({ nowpayments_payment_id: String(payment_id), pay_currency, actually_paid }),
      ]
    );
  } catch (paymentsErr) {
    logger.warn('[NOWPayments] IPN: payments table insert failed (non-fatal)', { error: paymentsErr.message });
  }

  logger.info('[NOWPayments] IPN: payment completed', { userId: order.user_id, planId: order.plan_id, order_id });
  return res.json({ received: true });
}));

// POST /api/webhooks/nowpayments/payout — NowPayments creator payout status webhook
app.post('/api/webhooks/nowpayments/payout', webhookLimiter, express.json(), asyncHandler(async (req, res) => {
  const sig = req.headers['x-nowpayments-sig'];
  if (!validateNowpaymentsIpn(req.body, sig)) {
    logger.warn('[NowPayments Payout Webhook] Invalid IPN signature');
    return res.status(400).json({ error: 'invalid_signature' });
  }
  const { handlePayoutWebhook } = require('../../services/nowpaymentsPayoutService');
  const { id: npPayoutId, batch_withdrawal_id, status } = req.body;
  await handlePayoutWebhook(npPayoutId || batch_withdrawal_id, status, req.body);
  return res.json({ ok: true });
}));

// POST /api/webhooks/btcpay — BTCPay Server webhook (Dash payment confirmed)
// Full handler extracted to btcpayWebhookController for maintainability.
const btcpayWebhookController = require('./controllers/btcpayWebhookController');
app.post('/api/webhooks/btcpay', webhookLimiter, asyncHandler(btcpayWebhookController.handleBtcpayWebhook));

// --- Self-declaration age verification (for gate, not AI-photo) ---
app.post('/api/verify-age-self', authLimiter, asyncHandler(async (req, res) => {
  const user = req.session?.user;
  if (!user) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }
  try {
    const UserModel = require('../../models/userModel');
    const updated = await UserModel.updateAgeVerification(user.id, {
      verified: true,
      method: 'self_declaration',
      expiresHours: 168,
    });
    if (!updated) {
      return res.status(500).json({ success: false, error: 'Verification failed' });
    }
    req.session.user.ageVerified = true;
    await new Promise((resolve, reject) => {
      req.session.save((err) => (err ? reject(err) : resolve()));
    });
    await getPool().query(
      `INSERT INTO audit_logs (actor_id, action, resource_type, resource_id, metadata, ip_address, user_agent, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)`,
      [user.id, 'age_verified_self', 'user', user.id, JSON.stringify({ method: 'self_declaration' }), req.ip || 'unknown', req.headers['user-agent'] || 'unknown']
    );
    logger.info(`User ${user.id} self-declared age verification`);
    res.json({ success: true });
  } catch (error) {
    logger.error(`Age self-verification error: ${error.message}`);
    res.status(500).json({ success: false, error: 'Verification failed' });
  }
}));

// --- Complete onboarding (mark as done, show only once) ---
app.post('/api/complete-onboarding', asyncHandler(async (req, res) => {
  try {
    const user = req.session?.user;
    if (!user) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    await require('../../config/postgres').query(
      'UPDATE users SET onboarding_complete = TRUE WHERE id = $1',
      [user.id]
    );

    req.session.user.onboardingComplete = true;
    logger.info(`User ${user.id} completed onboarding`);
    res.json({ success: true });
  } catch (error) {
    logger.error(`Complete onboarding error: ${error.message}`);
    res.status(500).json({ success: false, error: 'Failed to complete onboarding' });
  }
}));

// ==========================================
// Static storage mounts (Gap 2 & 4 — stream thumbnails and local recording uploads)
// ==========================================
app.use('/static/stream-thumbs', requireSessionAuth, express.static('/opt/pnptvapp/storage/stream-thumbs', {
  maxAge: '7d',
  dotfiles: 'deny',
}));
app.use('/static/stream-recordings', requireSessionAuth, express.static('/opt/pnptvapp/storage/stream-recordings', {
  maxAge: '7d',
  dotfiles: 'deny',
}));
app.use('/static/stream-snapshots', requireSessionAuth, express.static('/opt/pnptvapp/storage/stream-snapshots', {
  maxAge: '7d',
  dotfiles: 'deny',
}));

// ==========================================
// PRIME Hub SPA Serving
// ==========================================
const appPath = path.join(__dirname, '../../../public/prime-hub');

// Serve static assets from app build using root /assets path
app.use('/assets', express.static(path.join(appPath, 'assets'), {
  maxAge: '1y',
  immutable: true
}));

// /app → canonical post-login destination → redirect to React SPA
app.get('/app', (req, res) => {
  if (!req.session?.user) {
    return res.redirect('/');
  }
  return res.redirect(302, 'https://pnptv.app');
});

app.get('/app/*', (req, res) => {
  if (!req.session?.user) {
    return res.redirect('/');
  }
  const requestedPath = req.path.replace('/app', '');
  const filePath = path.join(appPath, requestedPath);
  if (requestedPath !== '/' && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    return res.sendFile(filePath);
  }
  res.sendFile(path.join(appPath, 'index.html'));
});


// ==========================================
// NEW MONETIZATION & AUTH ROUTES
// ==========================================

// Authentication routes
app.use('/api/auth', authRoutes);

// Subscription routes
app.use('/api/subscriptions', subscriptionRoutes);

// Model routes
app.use('/api/model', modelRoutes);

// Model/Creator application routes
app.use('/api/apply', applyRoutes);
app.use('/api/casting', castingRoutes);

// ==========================================
// Matrix / Synapse bridge routes
// All endpoints require an authenticated session
// ==========================================
// Matrix API endpoints removed
app.post('/api/webapp/matrix/hangout/:groupId/message', requireSessionAuth, asyncHandler(matrixMessageController.sendHangoutMessage));
app.post('/api/webapp/matrix/dm/:userId/message',       requireSessionAuth, asyncHandler(matrixMessageController.sendDmMessage));

// Creator monetization routes
app.use('/api/webapp/creator', creatorRoutes);

// Channel cover image upload — separate from creatorRoutes because it needs its own multer middleware
app.post('/api/webapp/creator/channels/:id/cover', requireSessionAuth, uploadLimiter, channelCoverUpload.single('cover'), verifyMagicBytes(IMAGE_MIMES), asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const channelId = parseInt(req.params.id, 10);
  if (!Number.isFinite(channelId)) return res.status(400).json({ error: 'Invalid channel ID' });

  const userId = req.session?.user?.id || req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Not authenticated' });

  // Verify ownership or collaborator access
  const chRes = await getPool().query(
    'SELECT creator_id, collaborators FROM creator_channels WHERE id = $1 AND is_active = true',
    [channelId]
  );
  if (!chRes.rows.length) return res.status(404).json({ error: 'Channel not found' });
  const ch = chRes.rows[0];
  const isOwner = String(ch.creator_id) === String(userId);
  const isCollaborator = Array.isArray(ch.collaborators) && ch.collaborators.includes(String(userId));
  if (!isOwner && !isCollaborator) return res.status(403).json({ error: 'Channel not found or not yours' });

  const sharp = require('sharp');
  const filename = `channel-${channelId}-${Date.now()}.webp`;
  const filePath = path.join(channelCoverUploadDir, filename);
  await sharp(req.file.buffer)
    .rotate()
    .withMetadata(false)
    .resize(1200, 630, { fit: 'cover', position: 'center' })
    .webp({ quality: 80 })
    .toFile(filePath);

  const coverUrl = `/uploads/channels/${filename}`;
  await getPool().query('UPDATE creator_channels SET cover_image_url = $1, updated_at = NOW() WHERE id = $2', [coverUrl, channelId]);
  return res.json({ success: true, coverImageUrl: coverUrl });
}));


// ── Channel video upload + AI assist + publish (universal — replaces the
//    admin-only /admin/prime-videos flow for non-admin creators) ─────────────
{
  const channelVideoService = require('../../services/channelVideoService');
  const channelVideoTmpDir2 = '/tmp/pnp-channel-videos';
  if (!fs.existsSync(channelVideoTmpDir2)) fs.mkdirSync(channelVideoTmpDir2, { recursive: true });
  const channelVideoUpload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, channelVideoTmpDir2),
      filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname || '').toLowerCase() || '.mp4';
        cb(null, `ch-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
      },
    }),
    limits: { fileSize: 20 * 1024 * 1024 * 1024 }, // 20 GB
    fileFilter: (req, file, cb) => {
      if (/^video\//i.test(file.mimetype || '')) return cb(null, true);
      cb(new Error('Only video files are allowed'));
    },
  });
  // 5 uploads / hour / user — back-pressure on storage abuse without
  // blocking legitimate creators uploading a small batch.
  const channelVideoLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 5,
    keyGenerator: (req) => String(req.session?.user?.id || req.ip),
    skip: (req) => req.session?.user?.role === 'admin',
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Upload rate limit reached — try again in an hour' },
  });
  // 20 publishes / day / user — guards against feed spam from rapid republish.
  const channelVideoPublishLimiter = rateLimit({
    windowMs: 24 * 60 * 60 * 1000,
    max: 20,
    keyGenerator: (req) => String(req.session?.user?.id || req.ip),
    skip: (req) => req.session?.user?.role === 'admin',
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Publish rate limit reached — try again tomorrow' },
  });

  function userCtx(req) {
    return {
      userId: req.session?.user?.id,
      isAdmin: ['admin', 'superadmin'].includes(req.session?.user?.role || ''),
    };
  }
  function handleSvcError(res, err) {
    const status = err.status || 500;
    return res.status(status).json({
      success: false,
      error: err.message || 'Internal error',
      code: err.code,
    });
  }

  // ── Chunked upload endpoints — must be registered BEFORE the plain upload
  //    route to prevent Express matching 'init'/'chunk'/'complete' as :channelId

  // POST /api/webapp/channels/:channelId/videos/init
  app.post('/api/webapp/channels/:channelId/videos/init',
    requireSessionAuth,
    channelVideoLimiter,
    asyncHandler(async (req, res) => {
      const channelId = parseInt(req.params.channelId, 10);
      if (!Number.isFinite(channelId)) return res.status(400).json({ success: false, error: 'Invalid channel id' });
      const { fileName, fileSize, totalChunks } = req.body;
      if (!fileName || !fileSize || !totalChunks) {
        return res.status(400).json({ success: false, error: 'fileName, fileSize, totalChunks required' });
      }
      if (typeof fileName !== 'string' || fileName.length > 512) {
        return res.status(400).json({ success: false, error: 'fileName must be a string under 512 characters' });
      }
      const ALLOWED_VIDEO_EXTS = new Set(['.mp4', '.mov', '.webm', '.mkv', '.avi', '.m4v', '.wmv', '.flv', '.ts']);
      const fileExt = require('path').extname(fileName).toLowerCase();
      if (!ALLOWED_VIDEO_EXTS.has(fileExt)) {
        return res.status(400).json({ success: false, error: `File type not allowed: ${fileExt || '(none)'}` });
      }
      if (Number(fileSize) > 20 * 1024 * 1024 * 1024) {
        return res.status(400).json({ success: false, error: 'File too large (max 20 GB)' });
      }
      const { userId, isAdmin } = userCtx(req);
      // Ownership gate — verify caller owns or collaborates on this channel
      try {
        await channelVideoService.loadOwnedChannel(String(channelId), String(userId), isAdmin);
      } catch (ownerErr) {
        return res.status(ownerErr.status || 403).json({ success: false, error: ownerErr.message || 'Access denied', code: ownerErr.code || 'FORBIDDEN' });
      }
      // 2257 compliance gate
      if (!isAdmin) {
        const IdentityVerificationService = require('../../services/identityVerificationService');
        const { rows: compRows } = await query(
          'SELECT creator_status, identity_verified, identity_verification_required_by FROM users WHERE id = $1',
          [userId]
        );
        const creatorRow = compRows[0];
        if (creatorRow?.creator_status === 'active' && !IdentityVerificationService.is2257Compliant(creatorRow)) {
          return res.status(403).json({
            success: false,
            error: 'identity_verification_required',
            message: 'Complete identity verification (18 U.S.C. § 2257) before uploading channel videos.',
          });
        }
      }
      const uploadId = `ch-${channelId}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const dir = path.join(CHUNK_DIR, uploadId);
      await fs.promises.mkdir(dir, { recursive: true });
      await fs.promises.writeFile(
        path.join(dir, '_meta.json'),
        JSON.stringify({ fileName, fileSize: Number(fileSize), totalChunks: Number(totalChunks), channelId, userId: String(userId), isAdmin })
      );
      return res.json({ success: true, uploadId, chunkSize: CHUNK_SIZE });
    }));

  // POST /api/webapp/channels/:channelId/videos/chunk
  app.post('/api/webapp/channels/:channelId/videos/chunk',
    requireSessionAuth,
    chunkUpload.single('chunk'),
    asyncHandler(async (req, res) => {
      const { uploadId, chunkIndex, totalChunks } = req.body;
      if (!uploadId || chunkIndex === undefined || !totalChunks) {
        return res.status(400).json({ success: false, error: 'uploadId, chunkIndex, totalChunks required' });
      }
      const safeId = uploadId.replace(/[^a-zA-Z0-9_-]/g, '');
      const dir = path.join(CHUNK_DIR, safeId);
      let meta;
      try { meta = JSON.parse(await fs.promises.readFile(path.join(dir, '_meta.json'), 'utf8')); } catch {
        return res.status(404).json({ success: false, error: 'Upload session not found' });
      }
      if (String(meta.userId) !== String(req.session?.user?.id)) {
        return res.status(403).json({ success: false, error: 'Forbidden' });
      }
      if (!req.file) return res.status(400).json({ success: false, error: 'No chunk data' });
      const parts = (await fs.promises.readdir(dir)).filter(f => f.endsWith('.part'));
      return res.json({ success: true, received: parts.length, total: Number(totalChunks) });
    }));

  // POST /api/webapp/channels/:channelId/videos/complete
  app.post('/api/webapp/channels/:channelId/videos/complete',
    requireSessionAuth,
    asyncHandler(async (req, res) => {
      const channelId = parseInt(req.params.channelId, 10);
      const { uploadId, title } = req.body;
      if (!uploadId) return res.status(400).json({ success: false, error: 'uploadId required' });
      const safeId = uploadId.replace(/[^a-zA-Z0-9_-]/g, '');
      const dir = path.join(CHUNK_DIR, safeId);
      let meta;
      try { meta = JSON.parse(await fs.promises.readFile(path.join(dir, '_meta.json'), 'utf8')); } catch {
        return res.status(404).json({ success: false, error: 'Upload session not found' });
      }
      if (String(meta.userId) !== String(req.session?.user?.id)) {
        return res.status(403).json({ success: false, error: 'Forbidden' });
      }
      if (meta.channelId !== channelId) {
        return res.status(400).json({ success: false, error: 'Channel mismatch' });
      }
      const allFiles = await fs.promises.readdir(dir);
      const parts = allFiles.filter(f => f.endsWith('.part')).sort();
      if (parts.length !== meta.totalChunks) {
        return res.status(400).json({ success: false, error: `Incomplete: ${parts.length}/${meta.totalChunks} chunks received` });
      }
      // Assemble chunks into a single file
      const ext = path.extname(meta.fileName).toLowerCase() || '.mp4';
      const assembledName = `ch-assembled-${Date.now()}${ext}`;
      const assembledPath = path.join(channelVideoTmpDir2, assembledName);
      const ws = fs.createWriteStream(assembledPath);
      for (const part of parts) {
        const buf = await fs.promises.readFile(path.join(dir, part));
        await new Promise((resolve, reject) => ws.write(buf, err => err ? reject(err) : resolve()));
      }
      await new Promise((resolve, reject) => ws.end(err => err ? reject(err) : resolve()));
      // Clean up chunk directory
      await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
      const mimeForExt = /\.mov$/i.test(meta.fileName) ? 'video/quicktime' : /\.webm$/i.test(meta.fileName) ? 'video/webm' : 'video/mp4';
      try {
        const video = await channelVideoService.uploadVideo({
          channelId,
          uploaderId: meta.userId,
          isAdmin: meta.isAdmin,
          file: {
            path: assembledPath,
            originalname: meta.fileName,
            mimetype: mimeForExt,
            size: meta.fileSize,
          },
          title: title || meta.fileName.replace(/\.[a-z0-9]+$/i, '').slice(0, 255),
        });
        return res.status(201).json({ success: true, video });
      } catch (err) {
        await fs.promises.unlink(assembledPath).catch(() => {});
        return res.status(err.status || 500).json({ success: false, error: err.message, code: err.code });
      }
    }));

  // POST /api/webapp/channels/:channelId/videos — multipart upload (single-shot for small files)
  app.post(
    '/api/webapp/channels/:channelId/videos',
    requireSessionAuth,
    channelVideoLimiter,
    channelVideoUpload.single('file'),
    asyncHandler(async (req, res) => {
      if (!req.file) return res.status(400).json({ success: false, error: 'file required' });
      const channelId = parseInt(req.params.channelId, 10);
      if (!Number.isFinite(channelId)) return res.status(400).json({ success: false, error: 'Invalid channel id' });
      const { userId, isAdmin } = userCtx(req);
      try {
        // 2257 compliance gate — enforce for active creators (admins bypass)
        if (!isAdmin) {
          const IdentityVerificationService = require('../../services/identityVerificationService');
          const { rows: compRows } = await query(
            'SELECT creator_status, identity_verified, identity_verification_required_by FROM users WHERE id = $1',
            [userId]
          );
          const creatorRow = compRows[0];
          if (creatorRow?.creator_status === 'active' && !IdentityVerificationService.is2257Compliant(creatorRow)) {
            return res.status(403).json({
              success: false,
              error: 'identity_verification_required',
              message: 'Complete identity verification (18 U.S.C. § 2257) before uploading channel videos.',
            });
          }
        }
        const video = await channelVideoService.uploadVideo({
          channelId, uploaderId: userId, isAdmin,
          file: req.file, title: req.body?.title,
        });
        res.json({ success: true, video });
      } catch (err) {
        handleSvcError(res, err);
      } finally {
        if (req.file?.path) await fs.promises.unlink(req.file.path).catch(() => {});
      }
    })
  );

  // POST /api/webapp/channels/:channelId/videos/:videoId/ai/title
  app.post(
    '/api/webapp/channels/:channelId/videos/:videoId/ai/title',
    requireSessionAuth,
    asyncHandler(async (req, res) => {
      const videoId = parseInt(req.params.videoId, 10);
      if (!Number.isFinite(videoId)) return res.status(400).json({ success: false, error: 'Invalid video id' });
      const { userId, isAdmin } = userCtx(req);
      try {
        const out = await channelVideoService.aiTitle({ videoId, userId, isAdmin });
        res.json({ success: true, ...out });
      } catch (err) {
        handleSvcError(res, err);
      }
    })
  );

  // POST /api/webapp/channels/:channelId/videos/:videoId/ai/description
  app.post(
    '/api/webapp/channels/:channelId/videos/:videoId/ai/description',
    requireSessionAuth,
    asyncHandler(async (req, res) => {
      const videoId = parseInt(req.params.videoId, 10);
      if (!Number.isFinite(videoId)) return res.status(400).json({ success: false, error: 'Invalid video id' });
      const { userId, isAdmin } = userCtx(req);
      try {
        const out = await channelVideoService.aiDescription({ videoId, userId, isAdmin });
        res.json({ success: true, ...out });
      } catch (err) {
        handleSvcError(res, err);
      }
    })
  );

  // POST /api/webapp/channels/:channelId/videos/:videoId/ai/tags
  app.post(
    '/api/webapp/channels/:channelId/videos/:videoId/ai/tags',
    requireSessionAuth,
    asyncHandler(async (req, res) => {
      const videoId = parseInt(req.params.videoId, 10);
      if (!Number.isFinite(videoId)) return res.status(400).json({ success: false, error: 'Invalid video id' });
      const { userId, isAdmin } = userCtx(req);
      try {
        const out = await channelVideoService.aiTags({ videoId, userId, isAdmin });
        res.json({ success: true, ...out });
      } catch (err) {
        handleSvcError(res, err);
      }
    })
  );

  // PATCH /api/webapp/channels/:channelId/videos/:videoId — edit title/desc/tags
  app.patch(
    '/api/webapp/channels/:channelId/videos/:videoId',
    requireSessionAuth,
    asyncHandler(async (req, res) => {
      const videoId = parseInt(req.params.videoId, 10);
      if (!Number.isFinite(videoId)) return res.status(400).json({ success: false, error: 'Invalid video id' });
      const { userId, isAdmin } = userCtx(req);
      try {
        const video = await channelVideoService.updateVideo({
          videoId, userId, isAdmin, fields: req.body || {},
        });
        res.json({ success: true, video });
      } catch (err) {
        handleSvcError(res, err);
      }
    })
  );

  // PATCH /api/webapp/channels/:channelId/videos/:videoId/tagged-creators
  app.patch(
    '/api/webapp/channels/:channelId/videos/:videoId/tagged-creators',
    requireSessionAuth,
    asyncHandler(async (req, res) => {
      const channelId = parseInt(req.params.channelId, 10);
      const videoId = parseInt(req.params.videoId, 10);
      if (!Number.isFinite(channelId) || !Number.isFinite(videoId)) return res.status(400).json({ error: 'Invalid id' });
      const userId = req.session.user.id;
      const isAdmin = req.session.user.role === 'admin' || req.session.user.role === 'superadmin';
      // Verify ownership (creator or collaborator)
      const { rows: ch } = await getPool().query(
        `SELECT id FROM creator_channels WHERE id = $1 AND (creator_id = $2 OR $2 = ANY(collaborators))`,
        [channelId, userId]
      );
      if (!ch.length && !isAdmin) return res.status(403).json({ error: 'Not authorized' });
      const taggedIds = Array.isArray(req.body.tagged_creator_ids) ? req.body.tagged_creator_ids.filter(id => typeof id === 'string') : [];
      if (taggedIds.length > 10) return res.status(400).json({ error: 'Max 10 tagged creators' });
      const { rows } = await getPool().query(
        `UPDATE channel_videos SET tagged_creator_ids = $1 WHERE id = $2 AND channel_id = $3 RETURNING id, tagged_creator_ids`,
        [taggedIds, videoId, channelId]
      );
      if (!rows.length) return res.status(404).json({ error: 'Video not found' });
      return res.json({ success: true, tagged_creator_ids: rows[0].tagged_creator_ids });
    })
  );

  // POST /api/webapp/channels/:channelId/videos/:videoId/publish — generate
  // GIF + create promo social_posts row + flip status to published.
  app.post(
    '/api/webapp/channels/:channelId/videos/:videoId/publish',
    requireSessionAuth,
    channelVideoPublishLimiter,
    asyncHandler(async (req, res) => {
      const videoId = parseInt(req.params.videoId, 10);
      if (!Number.isFinite(videoId)) return res.status(400).json({ success: false, error: 'Invalid video id' });
      const { userId, isAdmin } = userCtx(req);
      try {
        const video = await channelVideoService.publishVideo({ videoId, userId, isAdmin });
        res.json({ success: true, video });
      } catch (err) {
        handleSvcError(res, err);
      }
    })
  );

  // DELETE /api/webapp/channels/:channelId/videos/:videoId — soft-delete +
  // tombstone the promo social_posts row.
  app.delete(
    '/api/webapp/channels/:channelId/videos/:videoId',
    requireSessionAuth,
    asyncHandler(async (req, res) => {
      const videoId = parseInt(req.params.videoId, 10);
      if (!Number.isFinite(videoId)) return res.status(400).json({ success: false, error: 'Invalid video id' });
      const { userId, isAdmin } = userCtx(req);
      try {
        const out = await channelVideoService.deleteVideo({ videoId, userId, isAdmin });
        res.json({ success: true, ...out });
      } catch (err) {
        handleSvcError(res, err);
      }
    })
  );

  // GET /api/webapp/channels/:channelId/videos — list videos for the channel.
  // Drafts visible only to owner / collaborators / admins.
  app.get(
    '/api/webapp/channels/:channelId/videos',
    softAuth,
    asyncHandler(async (req, res) => {
      const channelId = parseInt(req.params.channelId, 10);
      if (!Number.isFinite(channelId)) return res.status(400).json({ success: false, error: 'Invalid channel id' });
      const viewerId = req.session?.user?.id;
      const isAdmin = ['admin', 'superadmin'].includes(req.session?.user?.role || '');
      const includeDrafts = !!viewerId && (await getPool().query(
        `SELECT 1 FROM creator_channels WHERE id = $1
            AND (creator_id = $2 OR $2 = ANY(collaborators) OR $3)`,
        [channelId, String(viewerId), isAdmin]
      )).rows.length > 0;
      try {
        const videos = await channelVideoService.listChannelVideos({
          channelId, viewerId, includeDrafts,
        });
        res.json({ success: true, videos });
      } catch (err) {
        handleSvcError(res, err);
      }
    })
  );

  // GET /api/webapp/channels/:channelId/videos/tag-taxonomy — surface the
  // bounded tag list to the frontend so the chip picker is in sync with what
  // Grok is allowed to suggest.
  app.get(
    '/api/webapp/channels/:channelId/videos/tag-taxonomy',
    requireSessionAuth,
    asyncHandler(async (_req, res) => {
      res.json({ success: true, tags: channelVideoService.TAG_TAXONOMY });
    })
  );

  // POST /api/webapp/channels/:channelId/videos/:videoId/view
  // Increment view_count with 1-hour Redis dedup per viewer.
  app.post(
    '/api/webapp/channels/:channelId/videos/:videoId/view',
    softAuth,
    channelVideoViewLimiter,
    asyncHandler(async (req, res) => {
      const channelId = parseInt(req.params.channelId, 10);
      const videoId = parseInt(req.params.videoId, 10);
      if (!Number.isFinite(videoId)) return res.status(400).json({ error: 'Invalid video id' });
      if (!Number.isFinite(channelId)) return res.status(400).json({ error: 'Invalid channel id' });

      // Access gate: for non-free channels require entitlement; free channels allow unauthenticated views
      try {
        const { rows: chRows } = await getPool().query(
          'SELECT access_type FROM creator_channels WHERE id = $1 AND is_active = true',
          [channelId]
        );
        if (chRows.length && chRows[0].access_type !== 'free') {
          const viewerId = req.session?.user?.id;
          if (!viewerId) return res.status(401).json({ error: 'Authentication required' });
          const viewerRole = req.session?.user?.role || '';
          const isAdmin = viewerRole === 'admin' || viewerRole === 'superadmin';
          if (!isAdmin) {
            const decision = await EntitlementAccessService.hasResourceAccess(
              String(viewerId), 'channel', String(channelId)
            );
            if (!decision.allowed) return res.status(403).json({ error: 'Access denied', code: decision.code });
          }
        }
      } catch (gateErr) {
        logger.error('channel video view access gate failed', { channelId, error: gateErr.message });
        return res.status(500).json({ error: 'Failed to verify access' });
      }

      const viewerKey = (req.session?.user?.id) || (req.ip || 'anon').replace(/[^a-zA-Z0-9.:_-]/g, '_');
      const dedupeKey = `view:chanvid:${videoId}:${viewerKey}`;
      try {
        const seen = await redisClient.set(dedupeKey, '1', 'EX', 3600, 'NX');
        if (seen !== 'OK') return res.json({ success: true, deduped: true });
      } catch (_) { /* Redis down — count anyway */ }
      try {
        const { rows } = await getPool().query(
          `UPDATE channel_videos SET view_count = view_count + 1
           WHERE id = $1 AND status = 'published' RETURNING view_count`,
          [videoId]
        );
        if (!rows.length) return res.status(404).json({ error: 'Video not found' });
        return res.json({ success: true, view_count: rows[0].view_count });
      } catch (err) {
        logger.error('channel video view increment failed', { videoId, error: err.message });
        return res.status(500).json({ error: 'Failed to record view' });
      }
    })
  );

  // GET /api/webapp/channels/:channelId/videos/:videoId/comments
  // Returns comments (replies against the video's promo social_post).
  app.get(
    '/api/webapp/channels/:channelId/videos/:videoId/comments',
    requireSessionAuth,
    asyncHandler(async (req, res) => {
      const channelId = parseInt(req.params.channelId, 10);
      const videoId = parseInt(req.params.videoId, 10);
      if (!Number.isFinite(videoId)) return res.status(400).json({ error: 'Invalid video id' });
      if (!Number.isFinite(channelId)) return res.status(400).json({ error: 'Invalid channel id' });

      // Channel access gate
      const viewerId = req.session.user.id;
      const viewerRole = req.session.user.role || '';
      const isAdmin = viewerRole === 'admin' || viewerRole === 'superadmin';
      if (!isAdmin) {
        const decision = await EntitlementAccessService.hasResourceAccess(
          String(viewerId), 'channel', String(channelId)
        );
        if (!decision.allowed) return res.status(403).json({ error: 'Access denied', code: decision.code });
      }

      const SocialPostService = require('../../services/socialPostService');
      const { rows } = await getPool().query(
        `SELECT promo_post_id FROM channel_videos WHERE id = $1 AND status = 'published'`,
        [videoId]
      );
      if (!rows.length) return res.status(404).json({ error: 'Video not found' });
      const promoPostId = rows[0].promo_post_id;
      if (!promoPostId) return res.json({ success: true, replies: [], nextCursor: null });
      const result = await SocialPostService.getReplies(promoPostId, viewerId, req.query.cursor || null);
      return res.json({ success: true, ...result });
    })
  );

  // POST /api/webapp/channels/:channelId/videos/:videoId/comments
  // Create a comment (reply to the video's promo social_post).
  app.post(
    '/api/webapp/channels/:channelId/videos/:videoId/comments',
    requireSessionAuth,
    socialActionLimiter,
    asyncHandler(async (req, res) => {
      const channelId = parseInt(req.params.channelId, 10);
      const videoId = parseInt(req.params.videoId, 10);
      if (!Number.isFinite(videoId)) return res.status(400).json({ error: 'Invalid video id' });
      if (!Number.isFinite(channelId)) return res.status(400).json({ error: 'Invalid channel id' });

      // Channel access gate
      const commenterId = req.session.user.id;
      const commenterRole = req.session.user.role || '';
      const isAdminCommenter = commenterRole === 'admin' || commenterRole === 'superadmin';
      if (!isAdminCommenter) {
        const decision = await EntitlementAccessService.hasResourceAccess(
          String(commenterId), 'channel', String(channelId)
        );
        if (!decision.allowed) return res.status(403).json({ error: 'Access denied', code: decision.code });
      }

      const content = String(req.body.content || '').trim();
      if (!content || content.length > 500) return res.status(400).json({ error: 'Comment must be 1–500 characters' });
      const SocialPostService = require('../../services/socialPostService');
      const { rows } = await getPool().query(
        `SELECT promo_post_id FROM channel_videos WHERE id = $1 AND status = 'published'`,
        [videoId]
      );
      if (!rows.length) return res.status(404).json({ error: 'Video not found' });
      const promoPostId = rows[0].promo_post_id;
      if (!promoPostId) return res.status(400).json({ error: 'Comments not available for this video yet' });
      const post = await SocialPostService.createPost(
        commenterId, content, null, null, promoPostId,
        null, false, false, false, null, null, null, null, null, null
      );
      return res.json({ success: true, comment: post });
    })
  );
}

// Gamification routes
app.use('/api/webapp/gamification', gamificationRoutes);

// Canva Connect API routes
app.use('/api/canva', canvaRoutes);

// ── Book a Call ──────────────────────────────────────────────────────────────
const callPackageController = require('./controllers/callPackageController');

// Public: list active call packages for a creator (used on profile pages)
app.get('/api/webapp/creators/:creatorId/call-packages',
  asyncHandler(callPackageController.listPackages));

// Admin: create a call package for a creator
app.post('/api/webapp/admin/creators/:creatorId/call-packages',
  requireSessionAuth, adminGuard,
  asyncHandler(callPackageController.createPackage));

// Admin: deactivate a call package
app.delete('/api/webapp/admin/creators/:creatorId/call-packages/:packageId',
  requireSessionAuth, adminGuard,
  asyncHandler(callPackageController.deactivatePackage));

// CRIT-04: Rate limit booking options endpoint (30 requests/min, keyed by user ID)
const bookCallOptionsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: (req) => req.session?.user?.id || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests, please slow down' },
});

// BC-C-04: Rate limit booking endpoint (3 requests per 60 seconds, keyed by user ID)
const bookCallLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 3,
  keyGenerator: (req) => req.session?.user?.id || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Please wait before booking again' },
});

// Resolve call packages by Restreamer channel ref (for the live stream page)
app.get('/api/webapp/book-call/by-channel/:channelRef/packages',
  requireSessionAuth,
  asyncHandler(callPackageController.getPackagesByChannelRef));

// Member: get booking options — paginated (5 per page), live-status aware
// Query: ?duration=30|60  ?offset=0
app.get('/api/webapp/book-call/:creatorId/options',
  requireSessionAuth, bookCallOptionsLimiter,
  asyncHandler(callPackageController.getBookingOptions));

// Member: book a call using a call credit
app.post('/api/webapp/book-call',
  requireSessionAuth, bookCallLimiter,
  asyncHandler(callPackageController.bookCall));

// Member: get own call credits (optionally filtered by creatorId)
app.get('/api/webapp/my-call-credits',
  requireSessionAuth,
  asyncHandler(callPackageController.myCallCredits));

// HIGH-01: Creator: manage own call packages
app.get('/api/webapp/creator/call-packages',
  requireSessionAuth, creatorGuard,
  asyncHandler(callPackageController.listMyPackages));
app.post('/api/webapp/creator/call-packages',
  requireSessionAuth, creatorGuard,
  asyncHandler(callPackageController.createMyPackage));
app.put('/api/webapp/creator/call-packages/:packageId',
  requireSessionAuth, creatorGuard,
  asyncHandler(callPackageController.updateMyPackage));
app.delete('/api/webapp/creator/call-packages/:packageId',
  requireSessionAuth, creatorGuard,
  asyncHandler(callPackageController.deactivateMyPackage));

// ── Book a Call: Checkout, Booking Management & Creator Availability ─────────
const callBookingController = require('./controllers/callBookingController');

// H-08: Rate limit checkout creation — 5 attempts per 60 seconds, keyed by user ID
const checkoutLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  keyGenerator: (req) => req.session?.user?.id || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many checkout attempts. Please wait before trying again.' },
});


// NowPayments (crypto) checkout for call packages — accepts optional payCurrency ('btc', 'btcln', etc.)
app.post('/api/webapp/book-call/checkout/nowpayments',
  requireSessionAuth, checkoutLimiter,
  asyncHandler(callBookingController.createCheckoutNowPayments));

// BTCPay BTC+Lightning checkout for call packages (hidden on frontend until BTC node is configured)
app.post('/api/webapp/book-call/checkout/btc',
  requireSessionAuth, checkoutLimiter,
  asyncHandler(callBookingController.createCheckoutBtc));

// BTCPay Dash checkout for call packages
app.post('/api/webapp/book-call/checkout/dash',
  requireSessionAuth, checkoutLimiter,
  asyncHandler(callBookingController.createCheckoutDash));

// Token checkout for call packages (instant, no payment gateway)
app.post('/api/webapp/book-call/checkout/tokens',
  requireSessionAuth, checkoutLimiter,
  asyncHandler(callBookingController.createCheckoutTokens));

// Member: upcoming confirmed bookings — must be before /:bookingId catch-all
app.get('/api/webapp/bookings/upcoming',
  requireSessionAuth,
  asyncHandler(callBookingController.getUpcomingBookings));

const bookingStatusLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  keyGenerator: (req) => req.session?.user?.id || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ success: false, error: 'Too many requests' }),
});

// Payment-status poller for Dash checkout flow (must be before /:bookingId catch-all)
app.get('/api/webapp/bookings/:bookingId/payment-status',
  requireSessionAuth,
  bookingStatusLimiter,
  asyncHandler(callBookingController.getBookingPaymentStatus));

const callJoinLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  keyGenerator: (req) => req.session?.user?.id || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
});

// Join a booked private call — returns a LiveKit access token
app.post('/api/webapp/bookings/:bookingId/join',
  requireSessionAuth,
  callJoinLimiter,
  asyncHandler(callBookingController.joinBooking));

app.get('/api/webapp/bookings/:bookingId',
  requireSessionAuth,
  callJoinLimiter,
  asyncHandler(callBookingController.getBooking));

app.post('/api/webapp/bookings/:bookingId/survey',
  requireSessionAuth,
  asyncHandler(callBookingController.submitSurvey));

// SC-W-01: availability schedule writes — 10/min per user. Prevents flooding
// the schedule-save handler (which recalculates slot availability on every write)
// from a rapid-fire client or confused UI retry loop.
const scheduleWriteLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  keyGenerator: (req) => String(req.session?.user?.id || req.ip),
  message: { error: 'Too many schedule updates.' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.get('/api/webapp/creator/availability/schedule',
  requireSessionAuth, creatorGuard,
  asyncHandler(callBookingController.getAvailabilitySchedule));

app.post('/api/webapp/creator/availability/schedule',
  requireSessionAuth, creatorGuard, scheduleWriteLimiter,
  asyncHandler(callBookingController.saveAvailabilitySchedule));

// BC-C-02: PUT alias for frontend compatibility
app.put('/api/webapp/creator/availability/schedule',
  requireSessionAuth, creatorGuard, scheduleWriteLimiter,
  asyncHandler(callBookingController.saveAvailabilitySchedule));

app.put('/api/webapp/creator/online-status',
  requireSessionAuth, creatorGuard,
  asyncHandler(callBookingController.setOnlineStatus));

// Creator: toggle "accepting calls right now"
// Body: { accepting: boolean }
app.put('/api/webapp/creator/accepting-calls',
  requireSessionAuth, creatorGuard,
  asyncHandler(callBookingController.setAcceptingCalls));

// Member (or anyone logged in): read accepting-calls + online status for a creator profile
app.get('/api/webapp/creator/:creatorId/accepting-calls',
  requireSessionAuth,
  asyncHandler(callBookingController.getAcceptingCallsStatus));

app.get('/api/webapp/creator/call-bookings',
  requireSessionAuth, creatorGuard,
  asyncHandler(callBookingController.getMyBookings));

app.get('/api/webapp/creator/call-earnings',
  requireSessionAuth, creatorGuard,
  asyncHandler(callBookingController.getCallEarnings));

// Creator: complete a booking (creator-only action)
app.patch('/api/webapp/bookings/:bookingId/complete',
  requireSessionAuth, creatorGuard,
  asyncHandler(callBookingController.completeBooking));

// Member or creator: cancel a booking
app.post('/api/webapp/bookings/:bookingId/cancel',
  requireSessionAuth,
  asyncHandler(callBookingController.cancelBooking));

// Creator: get/set next show date
app.get('/api/webapp/creator/next-show-date',
  requireSessionAuth, creatorGuard,
  asyncHandler(callBookingController.getNextShowDate));
app.put('/api/webapp/creator/next-show-date',
  requireSessionAuth, creatorGuard,
  asyncHandler(callBookingController.setNextShowDate));

// GET /api/webapp/creator/subscribers — handled by creatorRoutes.js (mounted above)

// ==========================================
// X (TWITTER) CROSS-POST ENDPOINTS
// ==========================================
const xShareController = require('./controllers/xShareController');

// GET /api/social/x-status — returns connected, hasWriteScope, username for the UI
app.get('/api/social/x-status', requireSessionAuth, asyncHandler(xShareController.getXStatus));

// POST /api/webapp/social/posts/:postId/share-x — share a PNPtv post to the user's X account
// Rate-limited to 25 shares per user per 24 h (enforced inside the controller via Redis)
app.post(
  '/api/webapp/social/posts/:postId/share-x',
  requireSessionAuth,
  socialActionLimiter,
  asyncHandler(xShareController.shareToX)
);

// ==========================================
// N8N AUTOMATION ENDPOINTS
// ==========================================
const n8nAutomationController = require('./controllers/n8nAutomationController');

// Auth middleware: validates X-N8N-SECRET header against env var
const requireN8nSecret = (req, res, next) => {
  const provided = req.get('X-N8N-SECRET');
  const expected = process.env.N8N_WEBHOOK_SECRET;
  if (!expected) {
    logger.error('N8N_WEBHOOK_SECRET is not configured — rejecting n8n request');
    return res.status(503).json({ success: false, error: 'N8n integration not configured' });
  }
  if (!provided || provided.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(provided, 'utf8'), Buffer.from(expected, 'utf8'))) {
    logger.warn('n8n endpoint: invalid or missing X-N8N-SECRET', { ip: req.ip, path: req.path });
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  return next();
};

const n8nRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: 'Too many n8n requests',
});

app.get('/api/n8n/payments/failed', requireN8nSecret, n8nRateLimiter, asyncHandler(n8nAutomationController.getFailedPayments));
app.post('/api/n8n/payments/update-status', requireN8nSecret, n8nRateLimiter, asyncHandler(n8nAutomationController.updatePaymentRecoveryStatus));
app.get('/api/n8n/subscriptions/expiry', requireN8nSecret, n8nRateLimiter, asyncHandler(n8nAutomationController.getExpiryNotifications));
app.post('/api/n8n/workflows/log', requireN8nSecret, n8nRateLimiter, asyncHandler(n8nAutomationController.logWorkflowExecution));
app.post('/api/n8n/emails/log', requireN8nSecret, n8nRateLimiter, asyncHandler(n8nAutomationController.logEmailNotification));
app.post('/api/n8n/alerts/admin', requireN8nSecret, n8nRateLimiter, asyncHandler(n8nAutomationController.sendAdminAlert));
app.get('/api/n8n/health', requireN8nSecret, n8nRateLimiter, asyncHandler(n8nAutomationController.checkSystemHealth));
app.get('/api/n8n/errors/summary', requireN8nSecret, n8nRateLimiter, asyncHandler(n8nAutomationController.getErrorSummary));
app.get('/api/n8n/metrics/dashboard', requireN8nSecret, n8nRateLimiter, asyncHandler(n8nAutomationController.getDashboardMetrics));

// ==========================================
// NGINX AUTH_REQUEST ENDPOINT (Internal)
// ==========================================
// Used by Nginx to verify if user is authenticated before serving protected routes
// Nginx calls this endpoint internally with the user's cookies
// Returns 200 if authenticated, 401 if not
app.get('/api/webapp/auth/verify', authenticateUser, (req, res) => {
  // If we reach here, authenticateUser middleware passed (user is authenticated)
  // Nginx just needs a 200 response to allow access
  res.status(200).send();
});


// ── Auto-sync promoted posts from Directus CMS ──────────────────────────────
promotedPostController.startAutoSync();
contentFeedSyncController.startContentFeedSync();

// ==========================================
// COURTESY INVITE LINKS
// GET  /api/courtesy-invites/check/:code  — public, no auth
// GET  /api/courtesy-invites              — list (admin/model auth)
// POST /api/courtesy-invites              — create (admin/model auth)
// DELETE /api/courtesy-invites/:id        — deactivate (creator or admin)
// POST /api/courtesy-invites/:code/redeem — redeem (any authenticated user)
// ==========================================
app.use('/api/courtesy-invites', courtesyInviteRoutes);

// Admin invite links — Colombia Socio program
// GET  /api/invite/:code              — validate (public)
// POST /api/invite/:code/redeem       — redeem (session auth)
// GET  /api/admin/invite-links        — list (admin)
// POST /api/admin/invite-links        — create (admin)
app.use('/api', inviteLinkRoutes);

// ==========================================
// PUBLIC ENDPOINTS (no auth required)
// ==========================================

// Public post endpoint — minimal data for OG crawlers and external embeds.
// Only returns non-deleted, non-exclusive posts.
app.get('/api/public/social/posts/:postId', asyncHandler(socialController.getPublicPost));

// ==========================================
// STAGE TV — 24/7 Video Loop → RTMP → Restreamer
// ==========================================

const { spawn: spawnProcess } = require('child_process');

let stageTvProcess = null;
let stageTvStarting = false;
let stageTvState = { running: false, videos: [], pid: null, startedAt: null, startedBy: null, hlsUrl: null };

// Admin: list available video files
app.get('/api/webapp/admin/stage-tv/videos', adminGuard, asyncHandler(async (req, res) => {
  const uploadsDir = path.join(__dirname, '../../../../public/uploads/posts');
  try {
    const files = await fs.promises.readdir(uploadsDir);
    const videos = files.filter(f => /^vid-.*\.mp4$/i.test(f)).sort();
    res.json({ success: true, videos });
  } catch (err) {
    logger.error('stage-tv list videos error', err);
    res.json({ success: true, videos: [] });
  }
}));

// Admin: start Stage TV
app.post('/api/webapp/admin/stage-tv/start', adminGuard, asyncHandler(async (req, res) => {
  if (stageTvProcess || stageTvStarting) {
    return res.status(409).json({ success: false, error: 'Stage TV is already running or starting' });
  }
  // Set synchronously before first await to close the race window between the
  // guard check above and when stageTvProcess is assigned after spawn.
  stageTvStarting = true;

  const { videos } = req.body;
  if (!Array.isArray(videos) || videos.length === 0) {
    stageTvStarting = false;
    return res.status(400).json({ success: false, error: 'No videos selected' });
  }

  // Validate file names: must match vid-*.mp4 pattern, no path traversal
  const uploadsDir = path.join(__dirname, '../../../../public/uploads/posts');
  const validVideos = [];
  for (const v of videos) {
    const base = path.basename(String(v));
    if (!/^vid-.*\.mp4$/i.test(base)) continue;
    const fullPath = path.join(uploadsDir, base);
    try {
      await fs.promises.access(fullPath, fs.constants.R_OK);
      validVideos.push(fullPath);
    } catch {
      // File doesn't exist or not readable — skip
    }
  }

  if (validVideos.length === 0) {
    stageTvStarting = false;
    return res.status(400).json({ success: false, error: 'No valid video files found' });
  }

  // Write concat playlist file
  const tmpDir = path.join(__dirname, '../../../../tmp');
  await fs.promises.mkdir(tmpDir, { recursive: true });
  const playlistPath = path.join(tmpDir, 'stage-tv-playlist.txt');
  const playlistContent = validVideos.map(p => `file '${p.replace(/'/g, "'\\''")}'`).join('\n');
  await fs.promises.writeFile(playlistPath, playlistContent, 'utf8');

  // Build RTMP URL
  const restreamerUrl = (process.env.RESTREAMER_URL || 'http://restreamer:8080').replace(/^https?:\/\//, '');
  const rtmpHost = restreamerUrl.split(':')[0] || 'restreamer';
  const rtmpToken = process.env.RESTREAMER_RTMP_TOKEN || '';
  const rtmpUrl = `rtmp://${rtmpHost}:1935/live/stage-tv${rtmpToken ? '?token=' + rtmpToken : ''}`;

  const restreamerPublicUrl = (process.env.RESTREAMER_PUBLIC_URL || 'https://live.pnptv.app').replace(/\/$/, '');
  const hlsUrl = `${restreamerPublicUrl}/memfs/stage-tv.m3u8`;

  // Spawn FFmpeg
  const ffmpegArgs = [
    '-stream_loop', '-1',
    '-re',
    '-f', 'concat',
    '-safe', '0',
    '-i', playlistPath,
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-pix_fmt', 'yuv420p',
    '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2',
    '-b:v', '2500k',
    '-maxrate', '3000k',
    '-bufsize', '5000k',
    '-g', '60',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-ar', '44100',
    '-f', 'flv',
    rtmpUrl,
  ];

  const proc = spawnProcess('ffmpeg', ffmpegArgs, {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });

  stageTvProcess = proc;
  stageTvStarting = false;
  stageTvState = {
    running: true,
    videos: validVideos.map(p => path.basename(p)),
    pid: proc.pid,
    startedAt: new Date().toISOString(),
    startedBy: req.session?.user?.id || 'admin',
    hlsUrl,
  };

  proc.stderr.on('data', (chunk) => {
    const msg = chunk.toString().slice(0, 500);
    if (msg.includes('Error') || msg.includes('error')) {
      logger.warn('stage-tv ffmpeg stderr:', msg);
    }
  });

  proc.on('exit', (code) => {
    logger.info(`stage-tv ffmpeg exited with code ${code}`);
    stageTvProcess = null;
    stageTvState = { running: false, videos: [], pid: null, startedAt: null, startedBy: null, hlsUrl: null };
    try {
      const io = req.app.get('io');
      if (io) io.emit('stage-tv:stopped', {});
    } catch { /* silent */ }
  });

  // Emit started event
  try {
    const io = req.app.get('io');
    if (io) io.emit('stage-tv:started', { hlsUrl });
  } catch { /* silent */ }

  logger.info(`Stage TV started by ${stageTvState.startedBy} with ${validVideos.length} videos`);
  res.json({ success: true, hlsUrl, videoCount: validVideos.length });
}));

// Admin: stop Stage TV
app.post('/api/webapp/admin/stage-tv/stop', adminGuard, asyncHandler(async (req, res) => {
  if (!stageTvProcess) {
    return res.json({ success: true, message: 'Stage TV is not running' });
  }
  try {
    stageTvProcess.kill('SIGTERM');
  } catch (err) {
    logger.warn('stage-tv kill error', err);
  }
  stageTvProcess = null;
  stageTvState = { running: false, videos: [], pid: null, startedAt: null, startedBy: null, hlsUrl: null };
  try {
    const io = req.app.get('io');
    if (io) io.emit('stage-tv:stopped', {});
  } catch { /* silent */ }
  res.json({ success: true });
}));

// Admin: full status
app.get('/api/webapp/admin/stage-tv/status', adminGuard, (req, res) => {
  res.json({ success: true, ...stageTvState });
});

// Public: minimal status (session-authed users only)
app.get('/api/webapp/stage-tv/status', requireSessionAuth, (req, res) => {
  res.json({ success: true, running: stageTvState.running, hlsUrl: stageTvState.hlsUrl });
});

// ==========================================
// PRIME CHANNEL — ADMIN MANAGEMENT
// Videos are read/written directly from channel_videos (channel_id=5).
// The Directus prime_videos upload endpoint is kept as dead code for safety.
// ==========================================
{
  const channelVideoService = require('../../services/channelVideoService');
  function handleSvcError(res, err) {
    const status = err.status || 500;
    return res.status(status).json({ success: false, error: err.message || 'Internal error', code: err.code });
  }

  // GET /api/webapp/admin/prime-videos — list all channel_videos for channel_id=5
  app.get('/api/webapp/admin/prime-videos', adminGuard, asyncHandler(async (req, res) => {
    const page  = Math.max(1, parseInt(req.query.page  || '1',   10));
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || '100', 10)));
    const offset = (page - 1) * limit;

    const { rows: items } = await getPool().query(
      `SELECT cv.*
         FROM channel_videos cv
        WHERE cv.channel_id = 5
        ORDER BY cv.created_at DESC
        LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    const { rows: countRows } = await getPool().query(
      `SELECT COUNT(*) AS total FROM channel_videos WHERE channel_id = 5`
    );
    const total = parseInt(countRows[0]?.total || '0', 10);

    const _directusBase = (process.env.DIRECTUS_URL || process.env.DIRECTUS_INTERNAL_URL || 'http://directus:8055').replace(/\/$/, '');
    const shaped = items.map((row) => ({
      id:            row.id,
      title:         row.title,
      description:   row.description,
      status:        row.status,
      tags:          row.tags || [],
      duration_sec:  row.duration_sec,
      is_featured:   row.is_featured ?? false,
      post_to_feed:  row.post_to_feed ?? true,
      thumbnail_url: row.thumbnail_url,
      gif_url:       row.gif_url,
      video_url:     row.video_url || (row.directus_file_id ? `https://cms.pnptv.app/assets/${row.directus_file_id}` : null),
      filesize_bytes: row.filesize_bytes ? Number(row.filesize_bytes) : null,
      channel_id:    row.channel_id,
      promo_post_id: row.promo_post_id ? Number(row.promo_post_id) : null,
      ai_generated_meta: row.ai_generated_meta || {},
      created_at:    row.created_at,
    }));

    res.json({ success: true, items: shaped, total });
  }));

  // PATCH /api/webapp/admin/prime-videos/:id — update fields via channelVideoService
  app.patch('/api/webapp/admin/prime-videos/:id', adminGuard, asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, error: 'invalid id' });

    const allowedFields = ['title', 'description', 'tags', 'status', 'is_featured', 'post_to_feed'];
    const fields = {};
    for (const f of allowedFields) {
      if (req.body && Object.prototype.hasOwnProperty.call(req.body, f)) {
        fields[f] = req.body[f];
      }
    }

    try {
      const updated = await channelVideoService.updateVideo({ videoId: id, userId: null, isAdmin: true, fields });
      res.json({ success: true, item: updated, video: updated });
    } catch (err) {
      handleSvcError(res, err);
    }
  }));

  // POST /api/webapp/admin/prime-videos/:id/generate-description — Grok-powered description
  app.post('/api/webapp/admin/prime-videos/:id/generate-description', adminGuard, asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, error: 'invalid id' });

    const { rows } = await getPool().query(
      `SELECT id, title, duration_sec AS duration, tags, description FROM channel_videos WHERE id = $1 AND channel_id = 5`,
      [id]
    );
    const row = rows[0];
    if (!row) return res.status(404).json({ success: false, error: 'not found' });

    const grokService = require('../../services/grokService');
    const tagPart    = Array.isArray(row.tags) && row.tags.length ? `Tags: ${row.tags.join(', ')}.` : '';
    const durPart    = row.duration ? `Duration: ~${Math.round(row.duration / 60)} minutes.` : '';
    const customHint = (req.body && typeof req.body.hint === 'string' ? req.body.hint.trim() : '').slice(0, 500);
    const hintPart   = customHint ? `Additional context from the editor: ${customHint}` : '';
    const prompt     = [`Title: "${row.title}".`, durPart, tagPart, hintPart].filter(Boolean).join(' ');

    try {
      const result = await grokService.generateBilingualSafeVideoDescription({ prompt });
      res.json({ success: true, description: result.combined, en: result.en, es: result.es });
    } catch (err) {
      logger.error('grok generate-description failed', { id, error: err.message });
      const isSafetyBlock = /SAFETY_CHECK|usage guidelines/i.test(err.message || '');
      const friendly = isSafetyBlock
        ? "Grok's safety filter blocked this title. Add neutral context in the Context for Grok field and try again."
        : (err.message || 'grok failed');
      res.status(502).json({ success: false, error: friendly });
    }
  }));

  // POST /api/webapp/admin/prime-videos/:id/generate-title — clean marketable title
  app.post('/api/webapp/admin/prime-videos/:id/generate-title', adminGuard, asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, error: 'invalid id' });

    const { rows } = await getPool().query(
      `SELECT id, title, duration_sec AS duration, tags, description FROM channel_videos WHERE id = $1 AND channel_id = 5`,
      [id]
    );
    const row = rows[0];
    if (!row) return res.status(404).json({ success: false, error: 'not found' });

    const grokService = require('../../services/grokService');
    const tagPart     = Array.isArray(row.tags) && row.tags.length ? `Tags: ${row.tags.join(', ')}.` : '';
    const durPart     = row.duration ? `Duration: ~${Math.round(row.duration / 60)} minutes.` : '';
    const descSnippet = row.description ? `Existing description excerpt: ${String(row.description).slice(0, 200)}` : '';
    const customHint  = (req.body && typeof req.body.hint === 'string' ? req.body.hint.trim() : '').slice(0, 500);
    const hintPart    = customHint ? `Editor context: ${customHint}` : '';
    const prompt      = [`Current title: "${row.title}".`, durPart, tagPart, descSnippet, hintPart].filter(Boolean).join(' ');

    try {
      const title = await grokService.generateSafeVideoTitle({ prompt });
      res.json({ success: true, title });
    } catch (err) {
      logger.error('grok generate-title failed', { id, error: err.message });
      const isSafetyBlock = /SAFETY_CHECK|usage guidelines/i.test(err.message || '');
      res.status(502).json({
        success: false,
        error: isSafetyBlock ? "Grok's safety filter blocked this. Add neutral context in the Context for Grok field." : (err.message || 'grok failed'),
      });
    }
  }));

  // POST /api/webapp/admin/prime-videos/:id/suggest-tags — pick 3-5 from the 27-tag taxonomy
  app.post('/api/webapp/admin/prime-videos/:id/suggest-tags', adminGuard, asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, error: 'invalid id' });

    const { rows } = await getPool().query(
      `SELECT id, title, duration_sec AS duration, description FROM channel_videos WHERE id = $1 AND channel_id = 5`,
      [id]
    );
    const row = rows[0];
    if (!row) return res.status(404).json({ success: false, error: 'not found' });

    const grokService = require('../../services/grokService');
    const taxonomy    = channelVideoService.TAG_TAXONOMY;
    const durPart     = row.duration ? `Duration: ~${Math.round(row.duration / 60)} minutes.` : '';
    const descSnippet = row.description ? `Description: ${String(row.description).slice(0, 300)}` : '';
    const customHint  = (req.body && typeof req.body.hint === 'string' ? req.body.hint.trim() : '').slice(0, 500);
    const hintPart    = customHint ? `Editor context: ${customHint}` : '';
    const prompt      = [`Title: "${row.title}".`, durPart, descSnippet, hintPart].filter(Boolean).join(' ');

    try {
      const tags = await grokService.suggestSafeTags({ prompt, taxonomy });
      res.json({ success: true, tags, taxonomy });
    } catch (err) {
      logger.error('grok suggest-tags failed', { id, error: err.message });
      const t = (row.title + ' ' + (row.description || '') + ' ' + customHint).toLowerCase();
      const fallback = taxonomy.filter((tag) => t.includes(tag.replace('-', ' ')) || t.includes(tag));
      res.json({ success: true, tags: fallback.slice(0, 5), taxonomy, fallback: true });
    }
  }));

  // POST /api/webapp/admin/prime-videos/upload — multipart video upload
  // Forwards file to Directus, creates prime_videos row, mirrors to social_posts.
  // diskStorage keeps the file on disk so Node never holds a large Buffer in
  // memory; we stream it to Directus and unlink on every exit path.
  const FormData = require('form-data');
  const fsSync = require('fs');
  const PRIME_TMP_DIR = '/tmp/pnp-prime-uploads';
  try { require('fs').mkdirSync(PRIME_TMP_DIR, { recursive: true }); } catch (_) { /* ignore */ }
  const primeUpload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, PRIME_TMP_DIR),
      filename: (_req, file, cb) => {
        const ext = require('path').extname(file.originalname || '') || '';
        cb(null, `${require('crypto').randomUUID()}${ext}`);
      },
    }),
    limits: { fileSize: 4 * 1024 * 1024 * 1024 }, // 4 GB
    fileFilter: (req, file, cb) => {
      if (/^video\//i.test(file.mimetype || '')) return cb(null, true);
      cb(new Error('Only video files are allowed'));
    },
  });

  app.post('/api/webapp/admin/prime-videos/upload',
    adminGuard,
    (req, _res, next) => { req.socket.setTimeout(0); next(); },
    primeUpload.single('file'),
    asyncHandler(async (req, res) => {
      if (!req.file) return res.status(400).json({ success: false, error: 'file required' });

      const tmpPath = req.file.path;
      const titleInput = (req.body?.title || req.file.originalname || 'Untitled').toString().trim();
      const description = req.body?.description ? String(req.body.description).trim() : null;
      const status = ['draft', 'published'].includes(req.body?.status) ? req.body.status : 'published';

      try {

      // Step 1 — stream file from disk to Directus (never loads the whole file into Node memory)
      let fileId;
      try {
        const fd = new FormData();
        fd.append('title', titleInput.slice(0, 255));
        fd.append('file', fsSync.createReadStream(tmpPath), {
          filename: req.file.originalname,
          contentType: req.file.mimetype,
          knownLength: req.file.size,
        });
        const { data } = await axios.post(
          `${directusBaseUrl()}/files`,
          fd,
          {
            headers: { ...fd.getHeaders(), Authorization: `Bearer ${process.env.DIRECTUS_ADMIN_TOKEN}` },
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
            timeout: 1800000, // 30 min — large files on slow internal links
          }
        );
        fileId = data?.data?.id;
      } catch (err) {
        logger.error('prime-videos upload to Directus failed', { error: err.message });
        return res.status(502).json({ success: false, error: 'Directus file upload failed: ' + err.message });
      }
      if (!fileId) return res.status(502).json({ success: false, error: 'Directus returned no file id' });

      // Step 2 — pull file metadata (Directus extracts duration on upload)
      let fileMeta = {};
      try {
        const { data } = await axios.get(
          `${directusBaseUrl()}/files/${fileId}?fields=id,type,duration,filename_disk,filesize`,
          { headers: directusHeaders(), timeout: 5000 }
        );
        fileMeta = data?.data || {};
      } catch (_) { /* non-fatal */ }
      const durationSec = fileMeta.duration ? Math.round(fileMeta.duration / 1000) : null;

      // Step 3 — create prime_videos row
      let primeRow;
      try {
        const { data } = await axios.post(
          `${directusBaseUrl()}/items/prime_videos`,
          {
            title: titleInput.slice(0, 255),
            description,
            status,
            type: 'video',
            category: 'prime_videos',
            video_file: fileId,
            thumbnail: fileId,
            url: `/assets/${fileId}`,
            duration: durationSec,
            is_explicit: false,
            is_featured: false,
            plays: 0,
            likes: 0,
          },
          { headers: directusHeaders(), timeout: 8000 }
        );
        primeRow = data?.data;
      } catch (err) {
        logger.error('prime_videos insert failed', { fileId, error: err.message });
        return res.status(502).json({
          success: false,
          error: 'Created file but failed to create prime_video: ' + err.message,
          file_id: fileId,
        });
      }

      // Step 4 — mirror to social_posts immediately (don't wait for the cron/flow)
      if (status === 'published') {
        try {
          const mediaUrl = `https://cms.pnptv.app/assets/${fileId}`;
          const thumbUrl = `https://cms.pnptv.app/video-thumb/${fileId}.jpg`;
          const content = description && description.trim() ? description : titleInput;
          await getPool().query(
            `INSERT INTO social_posts
              (user_id, channel_id, directus_id, content, video_title, video_description,
               media_url, media_type, content_tier, video_thumbnail_url, video_thumbnails,
               is_shareable, source_channel, created_at, updated_at)
             VALUES ($1, 5, $2, $3, $4, $5, $6, 'video', 'PRIME', $7, '[]'::jsonb, true, 'prime', NOW(), NOW())`,
            ['8599671840', primeRow.id, content, titleInput, description, mediaUrl, thumbUrl]
          );
        } catch (syncErr) {
          logger.warn('social_posts mirror after upload failed (non-fatal)', { id: primeRow.id, error: syncErr.message });
        }
      }

      // Step 5 — insert into channel_videos so the video appears on the /channels/5 page
      try {
        const cvStatus = status === 'published' ? 'published' : 'draft';
        const thumbUrl = `https://cms.pnptv.app/video-thumb/${fileId}.jpg`;
        await getPool().query(
          `INSERT INTO channel_videos
             (channel_id, uploader_id, directus_file_id, title, description, duration_sec,
              thumbnail_url, status, created_at, updated_at)
           VALUES (5, $1, $2, $3, $4, $5, $6, $7, NOW(), NOW())`,
          ['8599671840', fileId, titleInput.slice(0, 255), description, durationSec, thumbUrl, cvStatus]
        );
        logger.info('prime-videos: channel_videos row created', { fileId, status: cvStatus });
      } catch (cvErr) {
        logger.warn('prime-videos: channel_videos insert failed (non-fatal)', { fileId, error: cvErr.message });
      }

      res.json({
        success: true,
        item: {
          ...primeRow,
          poster_url: `https://cms.pnptv.app/video-thumb/${fileId}.jpg`,
          preview_url: `https://cms.pnptv.app/video-thumb/${fileId}_preview.mp4`,
          video_url: `https://cms.pnptv.app/assets/${fileId}`,
        },
        note: 'Thumbnail will appear within 10 minutes (cron generates it).',
      });

      } finally {
        // Always unlink the temp file — regardless of success, error, or early return
        require('fs').promises.unlink(tmpPath).catch((e) => {
          if (e.code !== 'ENOENT') logger.warn('prime-videos: failed to unlink tmp file', { tmpPath, error: e.message });
        });
      }
    })
  );
}

// ==========================================
// CREATOR ALBUM / MEDIA ENDPOINTS
// ==========================================
const creatorMediaController = require('./controllers/creatorMediaController');

// Public: list creator album (premium gating applied via canView flag)
app.get('/api/webapp/creators/:creatorId/media',
  softAuth,
  asyncHandler(creatorMediaController.listMedia));

// Creator-only: file upload for album photos — registered before /reorder and plain POST
// to avoid Express matching /upload as a /:id param on PATCH/DELETE routes.
app.post('/api/webapp/creators/media/upload',
  requireSessionAuth, creatorGuard,
  uploadLimiter,
  creatorMediaUpload.single('file'),
  verifyMagicBytes(IMAGE_MIMES),
  asyncHandler(async (req, res) => {
    const sharp = require('sharp');
    const user = req.user || req.session?.user;
    if (!req.file) return res.status(400).json({ success: false, error: { code: 'NO_FILE', message: 'No file provided' } });

    const filename = `${user.id}-${Date.now()}.webp`;
    const filePath = path.join(creatorMediaUploadDir, filename);
    const publicUrl = `/uploads/creator-media/${filename}`;

    const processedBuf = await sharp(req.file.buffer)
      .rotate()
      .withMetadata(false)
      .resize(1200, null, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer();
    const wmBuf = await require('../../services/watermarkService').applyImageWatermark(processedBuf, user.username);
    await fs.promises.writeFile(filePath, wmBuf);

    const creatorMediaService = require('../../services/creatorMediaService');
    const caption = typeof req.body.caption === 'string' ? req.body.caption.trim() || null : null;
    const isPremium = req.body.isPremium === 'true' || req.body.isPremium === true;
    const item = await creatorMediaService.addMedia(String(user.id), {
      type: 'photo',
      url: publicUrl,
      thumbUrl: null,
      caption,
      isPremium,
    });

    return res.status(201).json({ success: true, item });
  }));

app.post('/api/webapp/creators/media/upload-video/init',
  requireSessionAuth, creatorGuard,
  asyncHandler(async (req, res) => {
    const { fileName, fileSize, totalChunks } = req.body;
    if (!fileName || !fileSize || !totalChunks) {
      return res.status(400).json({ success: false, error: 'fileName, fileSize, totalChunks required' });
    }
    if (Number(fileSize) > 500 * 1024 * 1024) {
      return res.status(400).json({ success: false, error: 'File too large (max 500 MB)' });
    }
    const uploadId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const dir = path.join(CHUNK_DIR, uploadId);
    await fs.promises.mkdir(dir, { recursive: true });
    const user = req.user || req.session?.user;
    await fs.promises.writeFile(
      path.join(dir, '_meta.json'),
      JSON.stringify({ fileName, fileSize: Number(fileSize), totalChunks: Number(totalChunks), userId: String(user.id), username: user.username })
    );
    return res.json({ success: true, uploadId, chunkSize: CHUNK_SIZE });
  }));

app.post('/api/webapp/creators/media/upload-video/chunk',
  requireSessionAuth, creatorGuard,
  chunkUpload.single('chunk'),
  asyncHandler(async (req, res) => {
    const { uploadId, chunkIndex, totalChunks } = req.body;
    if (!uploadId || chunkIndex === undefined || !totalChunks) {
      return res.status(400).json({ success: false, error: 'uploadId, chunkIndex, totalChunks required' });
    }
    const safeId = uploadId.replace(/[^a-zA-Z0-9_-]/g, '');
    const dir = path.join(CHUNK_DIR, safeId);

    const metaPath = path.join(dir, '_meta.json');
    let meta;
    try { meta = JSON.parse(await fs.promises.readFile(metaPath, 'utf8')); } catch {
      return res.status(404).json({ success: false, error: 'Upload session not found' });
    }
    const sessionUserId = String((req.user || req.session?.user).id);
    if (meta.userId !== sessionUserId) return res.status(403).json({ success: false, error: 'Forbidden' });

    if (!req.file) return res.status(400).json({ success: false, error: 'No chunk data' });

    const parts = (await fs.promises.readdir(dir)).filter(f => f.endsWith('.part'));
    return res.json({ success: true, received: parts.length, total: Number(totalChunks) });
  }));

app.post('/api/webapp/creators/media/upload-video/complete',
  requireSessionAuth, creatorGuard,
  asyncHandler(async (req, res) => {
    const { uploadId, caption, isPremium } = req.body;
    if (!uploadId) return res.status(400).json({ success: false, error: 'uploadId required' });
    const safeId = uploadId.replace(/[^a-zA-Z0-9_-]/g, '');
    const dir = path.join(CHUNK_DIR, safeId);

    const metaPath = path.join(dir, '_meta.json');
    let meta;
    try { meta = JSON.parse(await fs.promises.readFile(metaPath, 'utf8')); } catch {
      return res.status(404).json({ success: false, error: 'Upload session not found' });
    }
    const sessionUserId = String((req.user || req.session?.user).id);
    if (meta.userId !== sessionUserId) return res.status(403).json({ success: false, error: 'Forbidden' });

    const allFiles = await fs.promises.readdir(dir);
    const parts = allFiles.filter(f => f.endsWith('.part')).sort();
    if (parts.length !== meta.totalChunks) {
      return res.status(400).json({ success: false, error: `Incomplete upload: got ${parts.length}/${meta.totalChunks} chunks` });
    }

    const ext = path.extname(meta.fileName).toLowerCase() || '.mp4';
    const assembledName = `cvid-assembled-${Date.now()}${ext}`;
    const assembledPath = path.join(creatorVideoTmpDir, assembledName);
    const writeStream = fs.createWriteStream(assembledPath);
    for (const part of parts) {
      const buf = await fs.promises.readFile(path.join(dir, part));
      await new Promise((resolve, reject) => writeStream.write(buf, err => err ? reject(err) : resolve()));
    }
    await new Promise((resolve, reject) => writeStream.end(err => err ? reject(err) : resolve()));

    const finalFilename = `${meta.userId}-${Date.now()}${ext}`;
    const finalPath = path.join(creatorMediaUploadDir, finalFilename);
    await fs.promises.rename(assembledPath, finalPath).catch(async () => {
      await fs.promises.copyFile(assembledPath, finalPath);
      await fs.promises.unlink(assembledPath).catch(() => {});
    });

    try {
      const wmPath = finalPath + '.wm' + ext;
      await require('../../services/watermarkService').applyVideoWatermark(finalPath, wmPath, meta.username);
      await fs.promises.unlink(finalPath).catch(() => {});
      await fs.promises.rename(wmPath, finalPath);
    } catch (wmErr) {
      logger.warn('Chunked video watermark failed, keeping original', { userId: meta.userId, error: wmErr.message });
    }

    await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});

    const publicUrl = `/uploads/creator-media/${finalFilename}`;
    const creatorMediaService = require('../../services/creatorMediaService');
    const item = await creatorMediaService.addMedia(meta.userId, {
      type: 'video',
      url: publicUrl,
      thumbUrl: null,
      caption: typeof caption === 'string' ? caption.trim() || null : null,
      isPremium: isPremium === 'true' || isPremium === true,
    });

    return res.status(201).json({ success: true, item });
  }));

app.post('/api/webapp/creators/media/upload-video',
  requireSessionAuth, creatorGuard,
  uploadLimiter,
  creatorVideoUpload.single('file'),
  verifyDiskFileType,
  asyncHandler(async (req, res) => {
    const user = req.user || req.session?.user;
    if (!req.file) return res.status(400).json({ success: false, error: { code: 'NO_FILE', message: 'No file provided' } });

    const ext = path.extname(req.file.filename).toLowerCase() || '.mp4';
    const filename = `${user.id}-${Date.now()}${ext}`;
    const destPath = path.join(creatorMediaUploadDir, filename);
    const publicUrl = `/uploads/creator-media/${filename}`;

    await fs.promises.rename(req.file.path, destPath).catch(async () => {
      // rename across filesystems fails — fallback to copy+unlink
      await fs.promises.copyFile(req.file.path, destPath);
      await fs.promises.unlink(req.file.path).catch(() => {});
    });

    // Apply username watermark to creator album video
    try {
      const wmPath = destPath + '.watermark' + ext;
      await require('../../services/watermarkService').applyVideoWatermark(destPath, wmPath, user.username);
      await fs.promises.unlink(destPath).catch(() => {});
      await fs.promises.rename(wmPath, destPath);
    } catch (wmErr) {
      logger.warn('Creator album video watermark failed, keeping original', { userId: user.id, error: wmErr.message });
    }

    const creatorMediaService = require('../../services/creatorMediaService');
    const caption = typeof req.body.caption === 'string' ? req.body.caption.trim() || null : null;
    const isPremium = req.body.isPremium === 'true' || req.body.isPremium === true;
    const item = await creatorMediaService.addMedia(String(user.id), {
      type: 'video',
      url: publicUrl,
      thumbUrl: null,
      caption,
      isPremium,
    });

    return res.status(201).json({ success: true, item });
  }));

// reorder must be registered before /:id to avoid param collision
app.post('/api/webapp/creators/media/reorder',
  requireSessionAuth, creatorGuard,
  asyncHandler(creatorMediaController.reorderMedia));

app.post('/api/webapp/creators/media',
  requireSessionAuth, creatorGuard,
  asyncHandler(creatorMediaController.addMedia));

app.patch('/api/webapp/creators/media/:id',
  requireSessionAuth,
  asyncHandler(creatorMediaController.updateMedia));

app.delete('/api/webapp/creators/media/:id',
  requireSessionAuth,
  asyncHandler(creatorMediaController.deleteMedia));

// ==========================================
// CREATOR PROFILE MEDIA — Directus-backed CRUD
// Routes: /api/webapp/creator/media (self-scoped, singular "creator")
// Distinct from /api/webapp/creators/media (peer-view, local disk storage).
// ==========================================
{
  const { uploadBufferToCreatorFolder, directusHeaders: cmsDirectusHeaders } = require('./controllers/cmsCreatorController');
  const CMS_PUBLIC_URL = (process.env.DIRECTUS_PUBLIC_URL || 'https://cms.pnptv.app').replace(/\/$/, '');
  const CMS_INTERNAL_URL = (process.env.DIRECTUS_INTERNAL_URL || 'http://directus:8055').replace(/\/$/, '');

  // ----------------------------------------
  // TUS PROTOCOL — resumable upload endpoints
  // OPTIONS is registered before the global CORS middleware (see above) so that
  // tus capability headers are returned without being swallowed by the cors preflight handler.
  // ----------------------------------------

  // POST /api/webapp/creator/media/tus — create upload session at Directus, store metadata in Redis
  app.post('/api/webapp/creator/media/tus',
    requireSessionAuth, creatorGuard,
    asyncHandler(async (req, res) => {
      const userId = String(req.session.user.id);
      const uploadLength = parseInt(req.headers['upload-length'] || '0', 10);
      if (!Number.isFinite(uploadLength) || uploadLength <= 0) {
        return res.status(400).json({ error: 'Missing or invalid Upload-Length header' });
      }

      // Parse tus metadata header: "key base64value,key base64value"
      const uploadMetadataRaw = req.headers['upload-metadata'] || '';
      const metadata = {};
      uploadMetadataRaw.split(',').forEach((pair) => {
        const parts = pair.trim().split(' ');
        if (parts.length === 2) {
          try { metadata[parts[0]] = Buffer.from(parts[1], 'base64').toString('utf-8'); } catch (_) { /* ignore malformed pairs */ }
        }
      });

      const filename = metadata.filename || `upload-${Date.now()}`;
      const filetype = metadata.filetype || 'video/mp4';
      const caption = metadata.caption || null;
      const isPremium = metadata.is_premium === 'true';
      const mediaType = filetype.startsWith('video/') ? 'video' : 'photo';

      const CREATOR_TUS_ALLOWED = new Set([
        'image/jpeg', 'image/png', 'image/webp',
        'video/mp4', 'video/webm', 'video/quicktime',
      ]);
      if (!CREATOR_TUS_ALLOWED.has(filetype)) {
        return res.status(400).json({ error: `Unsupported file type: ${filetype}` });
      }

      // Create tus upload session at Directus — passes only filename + filetype in metadata
      const tusMeta = [
        `filename ${Buffer.from(filename).toString('base64')}`,
        `filetype ${Buffer.from(filetype).toString('base64')}`,
      ].join(',');

      let tusRes;
      try {
        tusRes = await axios.post(`${CMS_INTERNAL_URL}/files/tus`, '', {
          headers: {
            Authorization: `Bearer ${process.env.DIRECTUS_ADMIN_TOKEN}`,
            'Tus-Resumable': '1.0.0',
            'Upload-Length': String(uploadLength),
            'Upload-Metadata': tusMeta,
            'Content-Length': '0',
            'Content-Type': 'application/offset+octet-stream',
          },
          validateStatus: (s) => s === 201,
          maxRedirects: 0,
        });
      } catch (tusErr) {
        const status = tusErr.response?.status;
        logger.error('Creator tus: Directus session creation failed', { userId, status, error: tusErr.message });
        return res.status(502).json({ error: 'Failed to create upload session at CMS' });
      }

      // Location from Directus is like http://directus:8055/files/tus/<uuid>
      const location = tusRes.headers['location'] || '';
      const uploadId = location.split('/').pop();
      if (!uploadId || uploadId.length < 10) {
        logger.error('Creator tus: Directus returned unexpected Location', { userId, location });
        return res.status(502).json({ error: 'CMS returned no upload ID' });
      }

      // Persist metadata in Redis — 24 h TTL so stalled uploads expire automatically
      const redis = getRedis();
      await redis.set(
        `creator:tus:${uploadId}`,
        JSON.stringify({ userId, caption, isPremium, uploadLength, mediaType }),
        'EX', 86400
      );

      res.setHeader('Tus-Resumable', '1.0.0');
      res.setHeader('Location', `/api/webapp/creator/media/tus/${uploadId}`);
      res.setHeader('Access-Control-Expose-Headers', 'Location, Tus-Resumable');
      return res.status(201).end();
    })
  );

  // HEAD /api/webapp/creator/media/tus/:uploadId — resume offset check
  app.head('/api/webapp/creator/media/tus/:uploadId',
    requireSessionAuth,
    asyncHandler(async (req, res) => {
      const redis = getRedis();
      const metaStr = await redis.get(`creator:tus:${req.params.uploadId}`);
      if (!metaStr) return res.status(404).end();

      let meta;
      try { meta = JSON.parse(metaStr); } catch (_) { return res.status(500).end(); }
      if (String(meta.userId) !== String(req.session.user.id)) return res.status(403).end();

      let headRes;
      try {
        headRes = await axios.head(`${CMS_INTERNAL_URL}/files/tus/${req.params.uploadId}`, {
          headers: {
            Authorization: `Bearer ${process.env.DIRECTUS_ADMIN_TOKEN}`,
            'Tus-Resumable': '1.0.0',
          },
          validateStatus: () => true,
        });
      } catch (headErr) {
        logger.error('Creator tus: HEAD relay to Directus failed', { uploadId: req.params.uploadId, error: headErr.message });
        return res.status(502).end();
      }

      res.setHeader('Tus-Resumable', '1.0.0');
      res.setHeader('Upload-Offset', headRes.headers['upload-offset'] || '0');
      res.setHeader('Upload-Length', headRes.headers['upload-length'] || String(meta.uploadLength));
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Access-Control-Expose-Headers', 'Upload-Offset, Upload-Length, Tus-Resumable');
      return res.status(200).end();
    })
  );

  // PATCH /api/webapp/creator/media/tus/:uploadId — upload chunk; on final chunk insert creator_media row
  // express.raw() at route level buffers the binary body before global json middleware processes it
  app.patch('/api/webapp/creator/media/tus/:uploadId',
    requireSessionAuth,
    express.raw({ type: 'application/offset+octet-stream', limit: '500mb' }),
    asyncHandler(async (req, res) => {
      const redis = getRedis();
      const metaStr = await redis.get(`creator:tus:${req.params.uploadId}`);
      if (!metaStr) return res.status(404).end();

      let meta;
      try { meta = JSON.parse(metaStr); } catch (_) { return res.status(500).end(); }
      if (String(meta.userId) !== String(req.session.user.id)) return res.status(403).end();

      const uploadOffset = parseInt(req.headers['upload-offset'] || '0', 10);
      if (!Number.isFinite(uploadOffset) || uploadOffset < 0) {
        return res.status(400).json({ error: 'Missing or invalid Upload-Offset header' });
      }

      // req.body is a Buffer when express.raw() is used
      const chunk = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);

      let patchRes;
      try {
        patchRes = await axios.patch(
          `${CMS_INTERNAL_URL}/files/tus/${req.params.uploadId}`,
          chunk,
          {
            headers: {
              Authorization: `Bearer ${process.env.DIRECTUS_ADMIN_TOKEN}`,
              'Content-Type': 'application/offset+octet-stream',
              'Upload-Offset': String(uploadOffset),
              'Content-Length': String(chunk.length),
              'Tus-Resumable': '1.0.0',
            },
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
            validateStatus: (s) => s === 204 || s === 200,
          }
        );
      } catch (patchErr) {
        const status = patchErr.response?.status;
        logger.error('Creator tus: PATCH relay to Directus failed', { uploadId: req.params.uploadId, offset: uploadOffset, status, error: patchErr.message });
        return res.status(502).json({ error: 'Chunk upload to CMS failed' });
      }

      const newOffset = parseInt(patchRes.headers['upload-offset'] || '0', 10);

      // When the upload is complete, insert creator_media row and delete Redis key
      if (newOffset >= meta.uploadLength && meta.uploadLength > 0) {
        const fileId = req.params.uploadId;
        const url = `${CMS_PUBLIC_URL}/assets/${fileId}`;
        const thumbUrl = meta.mediaType === 'video' ? `${CMS_PUBLIC_URL}/video-thumb/${fileId}.jpg` : null;

        try {
          await getPool().query(
            `INSERT INTO creator_media (creator_id, media_type, url, thumb_url, caption, is_premium, sort_order)
             VALUES ($1, $2, $3, $4, $5, $6,
               COALESCE((SELECT COALESCE(MAX(sort_order), -1) + 1 FROM creator_media WHERE creator_id = $1), 0))`,
            [meta.userId, meta.mediaType, url, thumbUrl, meta.caption || null, meta.isPremium || false]
          );
        } catch (dbErr) {
          logger.error('Creator tus: creator_media insert failed after upload completion', { uploadId: fileId, userId: meta.userId, error: dbErr.message });
          // Don't surface DB error to client — file is uploaded, a reconcile job can retry
        }

        await redis.del(`creator:tus:${req.params.uploadId}`).catch(() => {});
      }

      res.setHeader('Tus-Resumable', '1.0.0');
      res.setHeader('Upload-Offset', String(newOffset));
      res.setHeader('Access-Control-Expose-Headers', 'Upload-Offset, Tus-Resumable');
      return res.status(204).end();
    })
  );

  const CREATOR_MEDIA_ALLOWED_MIMES = new Set([
    'image/jpeg', 'image/png', 'image/webp',
    'video/mp4', 'video/webm', 'video/quicktime',
  ]);

  // Multer: memory storage with per-type size limits enforced in handler
  const creatorProfileMediaUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB ceiling (images checked below)
    fileFilter: (_req, file, cb) => {
      if (CREATOR_MEDIA_ALLOWED_MIMES.has(file.mimetype)) return cb(null, true);
      cb(new Error(`Unsupported file type: ${file.mimetype}`));
    },
  });

  // 10 uploads / hour per user
  const creatorProfileMediaLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 10,
    keyGenerator: (req) => String(req.session?.user?.id || req.ip),
    skip: (req) => req.session?.user?.role === 'admin' || req.session?.user?.role === 'superadmin',
    handler: (_req, res) => res.status(429).json({ success: false, error: 'Upload rate limit reached — try again in an hour.' }),
    standardHeaders: true,
    legacyHeaders: false,
  });

  // Magic bytes check for creator profile media (images + videos)
  const CREATOR_MEDIA_MAGIC = {
    'image/jpeg':     [[0xFF, 0xD8, 0xFF]],
    'image/png':      [[0x89, 0x50, 0x4E, 0x47]],
    'image/webp':     [[0x52, 0x49, 0x46, 0x46]],
    'video/mp4':      [[0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70],
                       [0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70],
                       [0x66, 0x74, 0x79, 0x70]],
    'video/webm':     [[0x1A, 0x45, 0xDF, 0xA3]],
    'video/quicktime':[[0x00, 0x00, 0x00, 0x14, 0x66, 0x74, 0x79, 0x70], [0x66, 0x74, 0x79, 0x70]],
  };
  function creatorMediaMagicOk(buf, mime) {
    const sigs = CREATOR_MEDIA_MAGIC[mime];
    if (!sigs) return true;
    return sigs.some((sig) => sig.every((byte, i) => buf[i] === byte));
  }

  // Parse Directus file UUID from a stored asset URL
  // Accepts: https://cms.pnptv.app/assets/<uuid> or https://cms.pnptv.app/video-thumb/<uuid>.jpg
  function parseDirectusFileId(url) {
    if (!url || typeof url !== 'string') return null;
    const assetMatch = url.match(/\/assets\/([0-9a-f-]{36})/i);
    if (assetMatch) return assetMatch[1];
    const thumbMatch = url.match(/\/video-thumb\/([0-9a-f-]{36})\.jpg/i);
    if (thumbMatch) return thumbMatch[1];
    return null;
  }

  // GET /api/webapp/creator/media — list own media
  app.get('/api/webapp/creator/media',
    requireSessionAuth, creatorGuard,
    asyncHandler(async (req, res) => {
      const userId = String(req.session.user.id);
      const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
      const { rows } = await getPool().query(
        `SELECT id, media_type, url, thumb_url, caption, is_premium, sort_order, created_at
         FROM creator_media
         WHERE creator_id = $1
         ORDER BY sort_order ASC, created_at DESC
         LIMIT $2`,
        [userId, limit]
      );
      return res.json({
        success: true,
        items: rows.map((r) => ({
          id: String(r.id),
          mediaType: r.media_type,
          url: r.url,
          thumbUrl: r.thumb_url,
          caption: r.caption,
          isPremium: r.is_premium,
          sortOrder: r.sort_order,
          createdAt: r.created_at,
        })),
      });
    })
  );

  // POST /api/webapp/creator/media — upload file to Directus + insert row
  app.post('/api/webapp/creator/media',
    requireSessionAuth, creatorGuard,
    creatorProfileMediaLimiter,
    creatorProfileMediaUpload.single('file'),
    asyncHandler(async (req, res) => {
      if (!req.file) return res.status(400).json({ success: false, error: 'No file provided' });

      const user = req.session.user;
      const userId = String(user.id);
      const { mimetype, buffer, originalname } = req.file;

      // Per-type size enforcement (multer ceiling is 500 MB; images are capped at 20 MB)
      const isVideo = mimetype.startsWith('video/');
      const IMAGE_MAX = 20 * 1024 * 1024;
      if (!isVideo && buffer.length > IMAGE_MAX) {
        return res.status(400).json({ success: false, error: 'Image files must be under 20 MB' });
      }

      // Magic bytes validation
      if (!creatorMediaMagicOk(buffer, mimetype)) {
        return res.status(400).json({ success: false, error: 'File content does not match declared type' });
      }

      const caption = typeof req.body.caption === 'string' ? req.body.caption.trim() || null : null;
      const isPremium = req.body.is_premium === 'true' || req.body.is_premium === true;
      const sortOrder = req.body.sort_order !== undefined ? parseInt(req.body.sort_order, 10) || 0 : undefined;

      // Fetch creator pnptv_id for Directus folder scoping
      const { rows: uRows } = await getPool().query('SELECT pnptv_id FROM users WHERE id = $1', [userId]);
      const pnptvId = uRows[0]?.pnptv_id || userId;

      // Upload buffer to creator's Directus folder
      let fileResult;
      try {
        fileResult = await uploadBufferToCreatorFolder({
          pnptvId,
          buffer,
          filename: originalname || `upload-${Date.now()}`,
          contentType: mimetype,
        });
      } catch (uploadErr) {
        logger.error('Creator profile media: Directus upload failed', { userId, error: uploadErr.message });
        return res.status(502).json({ success: false, error: 'File upload to CMS failed' });
      }

      const assetUrl = fileResult.url; // https://cms.pnptv.app/assets/<uuid>
      const thumbUrl = isVideo ? `${CMS_PUBLIC_URL}/video-thumb/${fileResult.fileId}.jpg` : null;
      const mediaType = isVideo ? 'video' : 'photo';

      // Insert row — sort_order defaults to MAX+1 if not supplied
      const { rows: inserted } = await getPool().query(
        `INSERT INTO creator_media (creator_id, media_type, url, thumb_url, caption, is_premium, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6,
           COALESCE($7, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM creator_media WHERE creator_id = $1)))
         RETURNING id, media_type, url, thumb_url, caption, is_premium, sort_order, created_at`,
        [userId, mediaType, assetUrl, thumbUrl, caption, isPremium, sortOrder !== undefined ? sortOrder : null]
      );
      const row = inserted[0];
      return res.status(201).json({
        success: true,
        item: {
          id: String(row.id),
          mediaType: row.media_type,
          url: row.url,
          thumbUrl: row.thumb_url,
          caption: row.caption,
          isPremium: row.is_premium,
          sortOrder: row.sort_order,
          createdAt: row.created_at,
        },
      });
    })
  );

  // PATCH /api/webapp/creator/media/:id — update caption / is_premium / sort_order
  app.patch('/api/webapp/creator/media/:id',
    requireSessionAuth, creatorGuard,
    asyncHandler(async (req, res) => {
      const userId = String(req.session.user.id);
      const mediaId = parseInt(req.params.id, 10);
      if (!Number.isFinite(mediaId)) return res.status(400).json({ success: false, error: 'Invalid media ID' });

      const setClauses = [];
      const values = [];
      let idx = 1;

      if (req.body.caption !== undefined) {
        const cap = typeof req.body.caption === 'string' ? req.body.caption.trim() || null : null;
        setClauses.push(`caption = $${idx++}`);
        values.push(cap);
      }
      if (req.body.is_premium !== undefined) {
        setClauses.push(`is_premium = $${idx++}`);
        values.push(req.body.is_premium === true || req.body.is_premium === 'true');
      }
      if (req.body.sort_order !== undefined) {
        const so = parseInt(req.body.sort_order, 10);
        if (!Number.isFinite(so)) return res.status(400).json({ success: false, error: 'sort_order must be an integer' });
        setClauses.push(`sort_order = $${idx++}`);
        values.push(so);
      }

      if (setClauses.length === 0) return res.status(400).json({ success: false, error: 'No updatable fields provided' });

      values.push(mediaId, userId);
      const { rows } = await getPool().query(
        `UPDATE creator_media SET ${setClauses.join(', ')}
         WHERE id = $${idx} AND creator_id = $${idx + 1}
         RETURNING id, media_type, url, thumb_url, caption, is_premium, sort_order, created_at`,
        values
      );

      if (!rows.length) return res.status(404).json({ success: false, error: 'Media item not found or not yours' });
      const row = rows[0];
      return res.json({
        success: true,
        item: {
          id: String(row.id),
          mediaType: row.media_type,
          url: row.url,
          thumbUrl: row.thumb_url,
          caption: row.caption,
          isPremium: row.is_premium,
          sortOrder: row.sort_order,
          createdAt: row.created_at,
        },
      });
    })
  );

  // DELETE /api/webapp/creator/media/:id — delete row + Directus file
  app.delete('/api/webapp/creator/media/:id',
    requireSessionAuth, creatorGuard,
    asyncHandler(async (req, res) => {
      const userId = String(req.session.user.id);
      const mediaId = parseInt(req.params.id, 10);
      if (!Number.isFinite(mediaId)) return res.status(400).json({ success: false, error: 'Invalid media ID' });

      // Fetch row first to get URLs for Directus cleanup and verify ownership
      const { rows } = await getPool().query(
        'SELECT id, url, thumb_url FROM creator_media WHERE id = $1 AND creator_id = $2',
        [mediaId, userId]
      );
      if (!rows.length) return res.status(404).json({ success: false, error: 'Media item not found or not yours' });

      const row = rows[0];

      // Delete the DB row
      await getPool().query('DELETE FROM creator_media WHERE id = $1 AND creator_id = $2', [mediaId, userId]);

      // Best-effort: delete Directus file asset (non-fatal on failure)
      const fileId = parseDirectusFileId(row.url);
      if (fileId) {
        axios.delete(`${CMS_INTERNAL_URL}/files/${fileId}`, {
          headers: cmsDirectusHeaders(),
          timeout: 8000,
        }).catch((err) => {
          logger.warn('Creator profile media: Directus file delete failed (non-fatal)', {
            userId, mediaId, fileId, error: err.message,
          });
        });
      }

      return res.json({ success: true });
    })
  );
}

// ==========================================
// PUBLIC CREATOR PROFILE
// GET /api/public/creator/:username
// No auth required; softAuth populates req.user if session present.
// Returns creator info, subscription status, media (premium gated), call packages.
// ==========================================
app.get('/api/public/creator/:username',
  softAuth,
  asyncHandler(async (req, res) => {
    const { username } = req.params;
    if (!username || !/^[a-zA-Z0-9_.-]{1,64}$/.test(username)) {
      return res.status(400).json({ success: false, error: 'Invalid username' });
    }

    const pool = getPool();

    // 1. Fetch creator by username (case-insensitive)
    const { rows: creatorRows } = await pool.query(
      `SELECT id, username, first_name,
              photo_file_id AS photo_url,
              bio, creator_type, creator_price_usd,
              creator_subscriber_count, creator_verified,
              creator_subscription_paused, pnptv_id
       FROM users
       WHERE LOWER(username) = LOWER($1) AND creator_status = 'active'
       LIMIT 1`,
      [username]
    );
    if (!creatorRows.length) return res.status(404).json({ success: false, error: 'Creator not found' });

    const creator = creatorRows[0];
    const creatorId = String(creator.id);
    const viewerId = req.user?.id ? String(req.user.id) : null;

    // 2. Check if viewer is subscribed (only when authenticated and not self)
    let isSubscribed = false;
    if (viewerId && viewerId !== creatorId) {
      try {
        const { rows: subRows } = await pool.query(
          `SELECT 1 FROM creator_subscriptions
           WHERE creator_id = $1 AND subscriber_id = $2
             AND status = 'active' AND expires_at > NOW()
           LIMIT 1`,
          [creatorId, viewerId]
        );
        isSubscribed = subRows.length > 0;
      } catch (subErr) {
        logger.warn('Public creator profile: subscription check failed', { creatorId, viewerId, error: subErr.message });
      }
    } else if (viewerId && viewerId === creatorId) {
      // Creator viewing own profile — treat as subscribed so they see all content
      isSubscribed = true;
    }

    // 3. Fetch creator_media ordered by sort_order ASC, created_at DESC
    const { rows: mediaRows } = await pool.query(
      `SELECT id, media_type, url, thumb_url, caption, is_premium, sort_order, created_at
       FROM creator_media
       WHERE creator_id = $1
       ORDER BY sort_order ASC, created_at DESC`,
      [creatorId]
    );

    // 4. Gate premium media: hide url if is_premium AND viewer is not subscribed
    const media = mediaRows.map((m) => {
      const canView = !m.is_premium || isSubscribed;
      return {
        id: String(m.id),
        mediaType: m.media_type,
        url: canView ? m.url : null,
        thumbUrl: m.thumb_url,
        caption: m.caption,
        isPremium: m.is_premium,
        sortOrder: m.sort_order,
        createdAt: m.created_at,
        canView,
      };
    });

    // 5. Fetch call packages (gracefully skip if table absent)
    let callPackages = [];
    try {
      const { rows: pkgRows } = await pool.query(
        `SELECT id, duration_minutes, price_usd, title, is_active
         FROM call_packages
         WHERE creator_id = $1 AND is_active = true
         ORDER BY price_usd ASC`,
        [creatorId]
      );
      callPackages = pkgRows.map((p) => ({
        id: p.id,
        durationMinutes: p.duration_minutes,
        priceUsd: parseFloat(p.price_usd),
        title: p.title,
        isActive: p.is_active,
      }));
    } catch (pkgErr) {
      // call_packages table may not exist in all environments — non-fatal
      logger.warn('Public creator profile: call_packages fetch failed (non-fatal)', { creatorId, error: pkgErr.message });
    }

    // 6. Fetch last 3 public free social posts
    let recentPosts = [];
    try {
      const { rows: postRows } = await pool.query(
        `SELECT id, content, media_url, media_type, likes_count, created_at
         FROM social_posts
         WHERE user_id = $1
           AND is_deleted = false
           AND is_exclusive = false
           AND reply_to_id IS NULL
           AND repost_of_id IS NULL
           AND content_tier = 'free'
         ORDER BY created_at DESC
         LIMIT 3`,
        [creatorId]
      );
      recentPosts = postRows.map((p) => ({
        id: String(p.id),
        content: p.content,
        media_url: p.media_url || null,
        media_type: p.media_type || null,
        likes_count: p.likes_count || 0,
        created_at: p.created_at,
      }));
    } catch (postsErr) {
      logger.warn('Public creator profile: posts fetch failed', { creatorId, error: postsErr.message });
    }

    // 7. Fetch social links from Directus performer profile
    let socialLinks = {};
    try {
      const DIRECTUS_INT = process.env.CMS_INTERNAL_URL || process.env.DIRECTUS_URL;
      const perfRes = await axios.get(`${DIRECTUS_INT}/items/performers`, {
        headers: { Authorization: `Bearer ${process.env.DIRECTUS_ADMIN_TOKEN}` },
        params: {
          'filter[pnptv_id][_eq]': creator.pnptv_id,
          'fields': 'social_links',
          'limit': 1,
        },
        timeout: 3000,
      });
      socialLinks = perfRes.data?.data?.[0]?.social_links || {};
    } catch (socialErr) {
      // non-fatal — performer may not have a Directus record yet
    }

    // 8. Fetch next upcoming availability slot
    let nextAvailability = null;
    try {
      const { rows: schedRows } = await pool.query(
        `SELECT day_of_week, start_time, end_time, timezone
         FROM creator_availability_schedules
         WHERE creator_id = $1 AND is_active = true
         ORDER BY day_of_week ASC, start_time ASC
         LIMIT 7`,
        [creatorId]
      );
      if (schedRows.length > 0) {
        const todayDow = new Date().getUTCDay(); // 0=Sun
        let nextSlot = null;
        let daysFromNow = 0;
        for (let offset = 0; offset < 7; offset++) {
          const checkDow = (todayDow + offset) % 7;
          const slot = schedRows.find((s) => s.day_of_week === checkDow);
          if (slot) {
            nextSlot = slot;
            daysFromNow = offset;
            break;
          }
        }
        if (nextSlot) {
          nextAvailability = {
            day_of_week: nextSlot.day_of_week,
            start_time: nextSlot.start_time,
            end_time: nextSlot.end_time,
            timezone: nextSlot.timezone,
            days_from_now: daysFromNow,
          };
        }
      }
    } catch (availErr) {
      logger.warn('Public creator profile: availability fetch failed', { creatorId, error: availErr.message });
    }

    // 9. Count total videos across all creator channels
    let videoCount = 0;
    try {
      const { rows: vcRows } = await pool.query(
        `SELECT COUNT(*)::int AS cnt FROM channel_videos cv
         JOIN creator_channels cc ON cc.id = cv.channel_id
         WHERE cc.creator_id = $1 AND cv.is_deleted = false AND cv.status = 'published'`,
        [creatorId]
      );
      videoCount = vcRows[0]?.cnt ?? 0;
    } catch (_) { /* non-fatal */ }

    return res.json({
      success: true,
      creator: {
        id: creatorId,
        username: creator.username,
        first_name: creator.first_name,
        photo_url: creator.photo_url || null,
        bio: creator.bio,
        creator_type: creator.creator_type,
        creator_price_usd: creator.creator_price_usd != null ? parseFloat(creator.creator_price_usd) : null,
        creator_subscriber_count: creator.creator_subscriber_count || 0,
        creator_verified: creator.creator_verified || false,
        creator_subscription_paused: creator.creator_subscription_paused || false,
        videoCount,
      },
      isSubscribed,
      media,
      callPackages,
      recentPosts,
      socialLinks,
      nextAvailability,
    });
  })
);

// ==========================================
// OG / OPEN GRAPH ENDPOINTS
// ==========================================
// These routes serve minimal HTML pages with og: and twitter: meta tags.
// Crawlers (Twitterbot, Facebot, etc.) hit /og/* to get proper previews.
// Real browsers are immediately meta-refreshed to the SPA URL.
const ogController = require('./controllers/ogController');
const XPostServiceForSlug = require('../../services/xPostService');

/**
 * Compute the canonical slug for a post by fetching its video_title from the DB.
 * Returns empty string if no title or on any error.
 */
async function _resolvePostSlug(postId) {
  try {
    const { query: dbQuery } = require('../../config/postgres');
    const result = await dbQuery(
      `SELECT video_title FROM social_posts WHERE id = $1 AND is_deleted = false LIMIT 1`,
      [postId]
    );
    const title = result.rows[0]?.video_title || '';
    return XPostServiceForSlug.slugify(title);
  } catch (_) {
    return '';
  }
}

// Video preview page for X sharing — standalone branded page with OG tags.
// Accepts /v/:postId and /v/:postId/:slug — slug is cosmetic (SEO only).
// If the slug is missing or stale, issue a 301 redirect to the canonical URL.
app.get('/v/:postId/:slug?', asyncHandler(async (req, res, next) => {
  const postId = parseInt(req.params.postId, 10);
  if (!Number.isFinite(postId) || postId <= 0) {
    return ogController.renderVideoPreview(req, res);
  }

  const canonicalSlug = await _resolvePostSlug(postId);
  const incomingSlug = req.params.slug || '';

  if (canonicalSlug && incomingSlug !== canonicalSlug) {
    // Build canonical URL with query string preserved
    const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    const canonicalPath = `/v/${postId}/${canonicalSlug}${qs}`;
    return res.redirect(301, canonicalPath);
  }

  return ogController.renderVideoPreview(req, res);
}));

// JSON preview endpoint for in-app chat link unfurling
app.get('/api/webapp/og-preview', requireSessionAuth, asyncHandler(ogController.getOgPreview));

// Live-stream snapshot proxy — public, no auth. Serves the Restreamer JPG
// snapshot for a channel, falling back to the creator's profile photo, and
// then to the default OG image. Used as og:image by social crawlers, so any
// 401/404 from upstream must degrade gracefully instead of bubbling up.
app.get('/api/og/snapshot/:refId.jpg', asyncHandler(async (req, res) => {
  const raw = String(req.params.refId || '').trim();
  if (!/^[a-zA-Z0-9_-]+$/.test(raw) || raw.length > 60) {
    return res.status(400).end();
  }
  const APP_URL = (process.env.APP_PUBLIC_URL || 'https://pnptv.app').replace(/\/$/, '');
  const defaultOg = `${APP_URL}/og-image.png`;

  const sendRedirect = (url) => {
    res.setHeader('Cache-Control', 'public, max-age=15');
    res.redirect(302, url);
  };

  try {
    const restreamerService = require('../../services/restreamerService');
    const restreamerUrl = (process.env.RESTREAMER_URL || 'http://restreamer:8080').replace(/\/$/, '');
    const token = await restreamerService.getToken().catch(() => null);
    const resp = await axios.get(`${restreamerUrl}/memfs/${raw}.jpg`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      responseType: 'arraybuffer',
      timeout: 4000,
      validateStatus: () => true,
    });
    if (resp.status === 200 && resp.data && resp.data.length > 500) {
      res.setHeader('Content-Type', 'image/jpeg');
      // Short cache — the snapshot refreshes every 5s, so 10s CDN cache is a
      // good balance between crawler re-fetch and freshness.
      res.setHeader('Cache-Control', 'public, max-age=10, s-maxage=10');
      return res.status(200).end(Buffer.from(resp.data));
    }
  } catch (err) {
    logger.debug('og snapshot: Restreamer fetch failed, falling back', { refId: raw, error: err.message });
  }

  // Fall back to the creator's profile photo
  try {
    const { rows } = await getPool().query(
      `SELECT photo_file_id FROM users WHERE live_channel = $1 OR username = $1 LIMIT 1`,
      [raw]
    );
    const photo = rows[0]?.photo_file_id;
    if (photo) {
      const url = photo.startsWith('http')
        ? photo
        : `${APP_URL}${photo.startsWith('/') ? '' : '/'}${photo}`;
      return sendRedirect(url);
    }
  } catch (err) {
    logger.debug('og snapshot: profile photo lookup failed', { refId: raw, error: err.message });
  }

  return sendRedirect(defaultOg);
}));

// Player endpoint must be registered BEFORE the wildcard /og/* route
app.get('/og/player/:postId', asyncHandler(ogController.renderPlayer));
app.get('/og/*', asyncHandler(ogController.renderOG));

// ── Main Stage (24/7 LiveKit room) ────────────────────────────────────────────

const mainStageAdminLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  keyGenerator: (req) => req.ip,
  handler: (_req, res) =>
    res.status(429).json({ success: false, error: 'Too many admin requests. Slow down.' }),
  standardHeaders: true,
  legacyHeaders: false,
});

// Per-user limiter for layout mutators (/mode, /shuffle) — these are open
// to ALL authenticated users, so IP-keying is wrong (shared NAT blocks
// everyone; Tor bypasses entirely). 5 changes/min per account keeps the
// room from getting griefed while leaving enough headroom for normal use.
const mainStageMutatorLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  keyGenerator: (req) => req.user?.id || req.ip,
  handler: (_req, res) =>
    res.status(429).json({ success: false, error: 'Too many layout changes. Take a breath.' }),
  standardHeaders: true,
  legacyHeaders: false,
});

const mainStageTokenLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,   // 30 token mints per user per minute — covers reconnects but blocks floods
  keyGenerator: (req) => req.user?.id || req.ip,
  handler: (_req, res) =>
    res.status(429).json({ success: false, error: 'Too many token requests. Please wait.' }),
  standardHeaders: true,
  legacyHeaders: false,
});

// Public state — IP-rate-limited so a pre-cache-warm burst doesn't stampede Redis.
// The controller keeps a 2-second in-process cache on top of this.
const mainStageStateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  keyGenerator: (req) => req.ip,
  handler: (_req, res) =>
    res.status(429).json({ success: false, error: 'Too many state requests.' }),
  standardHeaders: true,
  legacyHeaders: false,
});
app.get('/api/main-stage/state', mainStageStateLimiter, mainStageController.getState);

// Viewer token — no auth, IP-only rate-limited (5/min to prevent identity flood)
const mainStageViewerTokenLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  keyGenerator: (req) => req.ip,
  handler: (_req, res) =>
    res.status(429).json({ success: false, error: 'Too many viewer token requests.' }),
  standardHeaders: true,
  legacyHeaders: false,
});
app.get('/api/main-stage/viewer-token', mainStageViewerTokenLimiter, mainStageController.viewerToken);

app.get(
  '/api/main-stage/join-check',
  authenticateUser,
  mainStageStateLimiter,
  mainStageController.getJoinCheck
);

app.post(
  '/api/main-stage/accept-consents',
  authenticateUser,
  mainStageMutatorLimiter,
  mainStageController.acceptConsents
);

// Auth required — issue a LiveKit token
app.post(
  '/api/main-stage/token',
  authenticateUser,
  mainStageTokenLimiter,
  mainStageController.token
);

// Layout mode — admin-only write. Guards the room experience from being
// changed by arbitrary authenticated users.
app.post(
  '/api/main-stage/mode',
  authenticateUser,
  roleGuard('admin', 'superadmin'),
  mainStageMutatorLimiter,
  mainStageController.setMode
);

// Shuffle spotlight order — admin-only shared-state mutation.
app.post(
  '/api/main-stage/shuffle',
  authenticateUser,
  roleGuard('admin', 'superadmin'),
  mainStageMutatorLimiter,
  mainStageController.shuffle
);

app.post(
  '/api/main-stage/media',
  authenticateUser,
  roleGuard('admin', 'superadmin'),
  mainStageAdminLimiter,
  mainStageController.setMedia
);

// Auto-play toggle — open to any logged-in member. Anyone in the room can
// pause or resume the music auto-rotation. Rate-limited by mainStageMutatorLimiter
// to prevent toggle-spam griefing.
app.post(
  '/api/main-stage/autoplay',
  authenticateUser,
  requireMemberTier,
  mainStageMutatorLimiter,
  mainStageController.setAutoplay
);

app.post(
  '/api/main-stage/volume',
  authenticateUser,
  roleGuard('admin', 'superadmin'),
  mainStageAdminLimiter,
  mainStageController.setVolume
);

app.post(
  '/api/main-stage/spotlight',
  authenticateUser,
  roleGuard('admin', 'superadmin'),
  mainStageAdminLimiter,
  mainStageController.setSpotlight
);

app.post(
  '/api/main-stage/moderate',
  authenticateUser,
  roleGuard('admin', 'superadmin'),
  mainStageAdminLimiter,
  mainStageController.moderate
);

// ── Main Stage Guest Invites ──────────────────────────────────────────────────

const mainStageInvitesController = require('./controllers/mainStageInvitesController');

// 30 invite creations / admin / min — burst-generous since admins may generate
// several during an event setup.
const mainStageInviteCreateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: (req) => req.user?.id || req.ip,
  handler: (_req, res) =>
    res.status(429).json({ success: false, error: 'Too many invite requests. Slow down.' }),
  standardHeaders: true,
  legacyHeaders: false,
});

// 5 guest-token mints / IP / min — guards against scrapers burning invite slots.
const mainStageGuestTokenLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  keyGenerator: (req) => req.ip,
  handler: (_req, res) =>
    res.status(429).json({ success: false, error: 'Too many join attempts. Please wait a minute.' }),
  standardHeaders: true,
  legacyHeaders: false,
});

// 30 preview lookups / IP / min
const mainStagePreviewLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: (req) => req.ip,
  handler: (_req, res) =>
    res.status(429).json({ success: false, error: 'Too many preview requests.' }),
  standardHeaders: true,
  legacyHeaders: false,
});

// Admin CRUD — auth + role guard
app.post(
  '/api/main-stage/invites',
  authenticateUser,
  roleGuard('admin', 'superadmin'),
  mainStageInviteCreateLimiter,
  mainStageInvitesController.createInvite
);

app.post(
  '/api/main-stage/invites/permanent',
  authenticateUser,
  roleGuard('admin', 'superadmin'),
  mainStageAdminLimiter,
  mainStageInvitesController.createPermanentInvite
);

app.get(
  '/api/main-stage/invites',
  authenticateUser,
  roleGuard('admin', 'superadmin'),
  mainStageAdminLimiter,
  mainStageInvitesController.listInvites
);

app.delete(
  '/api/main-stage/invites/:id',
  authenticateUser,
  roleGuard('admin', 'superadmin'),
  mainStageAdminLimiter,
  mainStageInvitesController.revokeInvite
);

// Public — no auth required; geo-block applies (not in exemption list)
app.get(
  '/api/main-stage/invites/preview/:code',
  mainStagePreviewLimiter,
  mainStageInvitesController.previewInvite
);

app.post(
  '/api/main-stage/guest-token',
  mainStageGuestTokenLimiter,
  mainStageInvitesController.guestToken
);

// Video skip-vote — auth + member+; PRIME play-next — auth + PRIME/admin
app.post(
  '/api/main-stage/vote-skip',
  authenticateUser,
  mainStageController.voteSkip
);

app.post(
  '/api/main-stage/play-next',
  authenticateUser,
  mainStageController.playNext
);

// Member invite CRUD — auth + pnp-member entitlement (checked inside handler)
app.post(
  '/api/main-stage/member-invites',
  authenticateUser,
  mainStageInviteCreateLimiter,
  mainStageInvitesController.createMemberInvite
);

app.get(
  '/api/main-stage/member-invites',
  authenticateUser,
  mainStageAdminLimiter,
  mainStageInvitesController.listMemberInvites
);

// ── End Main Stage ────────────────────────────────────────────────────────────

// ── Moderation Dashboard ──────────────────────────────────────────────────────

app.get('/api/webapp/admin/moderation/bans', adminGuard, asyncHandler(async (req, res) => {
  const { status = 'all', search = '', limit = '50', offset = '0' } = req.query;
  const lim = Math.min(parseInt(limit, 10) || 50, 200);
  const off = parseInt(offset, 10) || 0;
  const searchParam = search ? `%${search}%` : null;

  let whereClause = '';
  const params = [];

  if (status === 'active') {
    params.push(true);
    whereClause += `WHERE pb.is_active = $${params.length}`;
  } else if (status === 'inactive') {
    params.push(false);
    whereClause += `WHERE pb.is_active = $${params.length}`;
  }

  if (searchParam) {
    params.push(searchParam);
    const idx = params.length;
    whereClause += whereClause ? ` AND (pb.username ILIKE $${idx} OR pb.reason ILIKE $${idx})` : `WHERE (pb.username ILIKE $${idx} OR pb.reason ILIKE $${idx})`;
  }

  const countParams = [...params];
  const rowParams = [...params, lim, off];

  const [countResult, rowsResult] = await Promise.all([
    query(`SELECT COUNT(*) FROM platform_bans pb ${whereClause}`, countParams),
    query(
      `SELECT pb.*, u.username AS resolved_username, u.email AS resolved_email
       FROM platform_bans pb
       LEFT JOIN users u ON u.id = pb.user_id
       ${whereClause}
       ORDER BY pb.banned_at DESC
       LIMIT $${rowParams.length - 1} OFFSET $${rowParams.length}`,
      rowParams
    ),
  ]);

  res.json({ bans: rowsResult.rows, total: parseInt(countResult.rows[0].count, 10) });
}));

app.post('/api/webapp/admin/moderation/bans/:id/unban', adminGuard, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body || {};
  const adminId = req.session && req.session.userId;

  if (!reason || !reason.trim()) {
    return res.status(400).json({ error: 'Reason is required' });
  }

  const result = await query(
    `UPDATE platform_bans
     SET is_active = false, unbanned_at = NOW(), unbanned_by = $1, unban_reason = $2
     WHERE id = $3 AND is_active = true
     RETURNING id`,
    [adminId, reason.trim(), id]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Ban not found or already lifted' });
  }

  logger.info({ adminId, banId: id, reason }, 'Ban lifted by admin');
  res.json({ success: true });
}));

app.get('/api/webapp/admin/moderation/audit-log', adminGuard, asyncHandler(async (req, res) => {
  const { action = '', resource_type = '', limit = '50', offset = '0' } = req.query;
  const lim = Math.min(parseInt(limit, 10) || 50, 200);
  const off = parseInt(offset, 10) || 0;

  const conditions = [];
  const params = [];

  if (action) {
    params.push(`%${action}%`);
    conditions.push(`al.action ILIKE $${params.length}`);
  }
  if (resource_type) {
    params.push(resource_type);
    conditions.push(`al.resource_type = $${params.length}`);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const countParams = [...params];
  const rowParams = [...params, lim, off];

  const [countResult, rowsResult] = await Promise.all([
    query(`SELECT COUNT(*) FROM audit_logs al ${whereClause}`, countParams),
    query(
      `SELECT al.*, u.username AS actor_username
       FROM audit_logs al
       LEFT JOIN users u ON u.id = al.actor_id
       ${whereClause}
       ORDER BY al.created_at DESC
       LIMIT $${rowParams.length - 1} OFFSET $${rowParams.length}`,
      rowParams
    ),
  ]);

  res.json({ logs: rowsResult.rows, total: parseInt(countResult.rows[0].count, 10) });
}));

app.get('/api/webapp/admin/moderation/username-history', adminGuard, asyncHandler(async (req, res) => {
  const { search = '', flagged = '', limit = '100', offset = '0' } = req.query;
  const lim = Math.min(parseInt(limit, 10) || 100, 500);
  const off = parseInt(offset, 10) || 0;

  const conditions = [];
  const params = [];

  if (flagged === 'true') {
    conditions.push(`uh.flagged = true`);
  } else if (flagged === 'false') {
    conditions.push(`uh.flagged = false`);
  }

  if (search) {
    params.push(`%${search}%`);
    const idx = params.length;
    conditions.push(`(uh.old_username ILIKE $${idx} OR uh.new_username ILIKE $${idx} OR uh.user_id ILIKE $${idx})`);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const countParams = [...params];
  const rowParams = [...params, lim, off];

  const [countResult, rowsResult] = await Promise.all([
    query(`SELECT COUNT(*) FROM username_history uh ${whereClause}`, countParams),
    query(
      `SELECT uh.*, u.username AS current_username, u.id AS resolved_user_id
       FROM username_history uh
       LEFT JOIN users u ON u.id::text = uh.user_id
       ${whereClause}
       ORDER BY uh.changed_at DESC
       LIMIT $${rowParams.length - 1} OFFSET $${rowParams.length}`,
      rowParams
    ),
  ]);

  res.json({ changes: rowsResult.rows, total: parseInt(countResult.rows[0].count, 10) });
}));

app.patch('/api/webapp/admin/moderation/username-history/:id/flag', adminGuard, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { flagged } = req.body || {};

  if (typeof flagged !== 'boolean') {
    return res.status(400).json({ error: 'flagged must be a boolean' });
  }

  await query('UPDATE username_history SET flagged = $1 WHERE id = $2', [flagged, id]);
  res.json({ success: true });
}));

app.get('/api/webapp/admin/moderation/warnings', adminGuard, asyncHandler(async (req, res) => {
  const { limit = '50', offset = '0' } = req.query;
  const lim = Math.min(parseInt(limit, 10) || 50, 200);
  const off = parseInt(offset, 10) || 0;

  const [countResult, rowsResult] = await Promise.all([
    query('SELECT COUNT(*) FROM user_warnings'),
    query(
      `SELECT uw.*, u.username AS actor_username, u.email AS actor_email
       FROM user_warnings uw
       LEFT JOIN users u ON u.id = uw.user_id
       ORDER BY uw.timestamp DESC
       LIMIT $1 OFFSET $2`,
      [lim, off]
    ),
  ]);

  res.json({ warnings: rowsResult.rows, total: parseInt(countResult.rows[0].count, 10) });
}));

// ── End Moderation Dashboard ──────────────────────────────────────────────────

// Sentry error handler - must be last
if (process.env.SENTRY_DSN) {
  app.use(Sentry.Handlers.errorHandler());
}

// ==========================================
// OG PRERENDER — serves dynamic meta tags for social media crawlers
// nginx routes crawler UAs to /api/og-prerender?path=...
// ==========================================
const { ogPrerenderMiddleware } = require('./middleware/ogPrerender');
app.get('/api/og-prerender', (req, res, next) => {
  // Rewrite req.path from query param so the middleware can match routes
  const targetPath = req.query.path || '/';
  req.url = targetPath;
  req.path = targetPath;
  ogPrerenderMiddleware(req, res, next);
}, (_req, res) => {
  // Fallback if middleware calls next()
  res.type('html').send(`<!DOCTYPE html><html><head>
    <meta property="og:title" content="PNPtv!" />
    <meta property="og:image" content="${process.env.APP_PUBLIC_URL || 'https://pnptv.app'}/og-image.png" />
    <meta name="twitter:card" content="summary_large_image" />
  </head><body></body></html>`);
});

// Export app WITHOUT 404/error handlers
// These will be added in bot.js AFTER the webhook callback
module.exports = app;
