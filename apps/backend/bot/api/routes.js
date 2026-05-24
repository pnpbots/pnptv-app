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
const { getPool } = require('../../config/postgres');
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
const requireSessionAuth = (req, res, next) => {
  if (!req.session?.user?.id) return res.status(401).json({ error: 'Not authenticated' });
  req.user = req.session.user;
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
const BLOCKED_COUNTRIES = new Set();
// Per-user geo-block whitelist — bypasses the hard country block for specific user IDs.
const GEO_BLOCK_USER_WHITELIST = new Set(['7246621722']); // PNPLatinoBoy
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
        "https://cdn.epayco.co",
        "https://multimedia.epayco.co",
        "https://checkout.epayco.co",
        "https://secure.epayco.co",
        "https://secure.payco.co",
        "https://api.secure.payco.co",
        "https://songbird.cardinalcommerce.com",
        "https://songbirdstag.cardinalcommerce.com",
        "https://centinelapi.cardinalcommerce.com",
        "https://centinelapistag.cardinalcommerce.com",
        "https://3ds.epayco.com",
        "https://3ds-green.epayco.com",
        "https://apiflow.epayco.co",
        "https://apiflow-green.epayco.co",
        "https://apiflow.epayco.io",
        "https://eks-ms-3ds-service.epayco.io",
        "https://telegram.org",
      ],
      styleSrc: ["'self'", "'unsafe-inline'", "https:", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https:", "https://fonts.gstatic.com", "data:"],
      imgSrc: ["'self'", "data:", "https://t.me", "https://*.telegram.org", "https:"],
      connectSrc: [
        "'self'",
        "https://multimedia.epayco.co",
        "https://songbird.cardinalcommerce.com",
        "https://songbirdstag.cardinalcommerce.com",
        "https://centinelapi.cardinalcommerce.com",
        "https://centinelapistag.cardinalcommerce.com",
        "https://3ds.epayco.com",
        "https://3ds-green.epayco.com",
        "https://apiflow.epayco.co",
        "https://apiflow-green.epayco.co",
        "https://apiflow.epayco.io",
        "https://eks-ms-3ds-service.epayco.io",
        "https://checkout.epayco.co",
        "https://secure.epayco.co",
        "https://secure.payco.co",
        "https://api.secure.payco.co",
        "https://cdn.epayco.co",
        "https://fonts.googleapis.com",
        "https://fonts.gstatic.com",
        "https://oauth.telegram.org",
        "https://api.telegram.org",
        "wss://livekit.pnptv.app",
        "https://livekit.pnptv.app",
      ],
      frameSrc: [
        "'self'",
        // Wildcards mirror CHECKOUT_CSP — required because ePayco rotates 3DS
        // sub-hosts between deploys (apiflow-*.epayco.co, eks-ms-3ds-*.epayco.io).
        // Without wildcards, helmet-served backend pages that host ePayco iframes
        // silently break post-rotation. Issuer bank ACS pages also live on
        // unenumerable hosts → see form-action 'https:' below.
        "https://*.epayco.co",
        "https://*.epayco.com",
        "https://*.epayco.io",
        "https://*.payco.co",
        "https://*.cardinalcommerce.com",
        "https://oauth.telegram.org",
        "https://telegram.org",
      ],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'", "https://checkout.epayco.co", "https://secure.epayco.co", "https://secure.payco.co", "https://api.secure.payco.co", "https://centinelapi.cardinalcommerce.com"],
      scriptSrcAttr: ["'unsafe-inline'"],
      upgradeInsecureRequests: [],
    },
  },
})));

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
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
  maxAge: 86400, // 24 hours
})));

app.use(conditionalMiddleware(compression()));

// Logging (before other middleware for accurate request tracking)
// 'short' omits the Authorization header that 'combined' would include in logs
app.use(morgan('short', { stream: logger.stream }));

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

// ╔══════════════════════════════════════════════════════════════════════╗
// ║  STOP — DO NOT NARROW THE script-src WILDCARDS BELOW                  ║
// ╠══════════════════════════════════════════════════════════════════════╣
// ║  CHECKOUT_CSP is load-bearing. The wildcards                          ║
// ║    https://*.epayco.co  https://*.epayco.com  https://*.epayco.io     ║
// ║    https://*.payco.co  https://*.cardinalcommerce.com                 ║
// ║  are required because:                                                ║
// ║   1. multimedia.epayco.co/general/3DS/validateThreeds.min.js (the     ║
// ║      script that exposes window.validate3ds) MUST be allowed          ║
// ║   2. ePayco loads ephemeral 3DS DDC scripts at runtime from           ║
// ║      subdomains that change between deploys (apiflow-*.epayco.co,     ║
// ║      eks-ms-3ds-*.epayco.io, etc.)                                    ║
// ║                                                                      ║
// ║  Replacing these wildcards with an exact-match list silently          ║
// ║  breaks ePayco card payments. See feedback_epayco_3ds_do_not_modify   ║
// ║  in the project memory and commit a37f127 / 4ea6fbf for the           ║
// ║  regression history.                                                  ║
// ║                                                                      ║
// ║  frame-src/connect-src/form-action are intentionally permissive       ║
// ║  ('self' https:) because 3DS bank challenge iframes load from         ║
// ║  arbitrary issuer-bank domains (bancolombia.com, davivienda.com,      ║
// ║  etc.) that we cannot enumerate ahead of time.                        ║
// ╚══════════════════════════════════════════════════════════════════════╝
const CHECKOUT_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://code.jquery.com https://*.epayco.co https://*.epayco.com https://*.epayco.io https://*.payco.co https://*.cardinalcommerce.com",
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
const PROTECTED_PATHS = ['/hangouts', '/live', '/pnplive'];

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
const VIDEO_PATH_RE = /^\/uploads\/posts\/(vid-[^/]+\.(?:mp4|webm|mov))$/i;
const videoMetaCache = new Map(); // url → { isExclusive, authorId, expiresAt }
const VIDEO_FETCH_RATE_LIMIT = parseInt(process.env.VIDEO_FETCH_RATE_LIMIT || '1500', 10);
const VIDEO_FETCH_RATE_WINDOW_SEC = 60 * 60; // 1 hour
const { query: videoGuardQuery } = require('../../config/postgres');
const { validateTierFresh: videoGuardValidateTier } = require('../../services/accessService');
const { cache: videoGuardCache, getRedis: videoGuardGetRedis } = require('../../config/redis');

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
         FROM social_posts WHERE media_url = $1 AND is_deleted = false LIMIT 1`,
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

    // Helper: hand off to R2 with a 1h presigned URL when available.
    // Falls through to express.static (disk) on any error, so a broken R2
    // doesn't break video playback — disk copy is the safety net during
    // migration and after.
    const tryR2Redirect = async () => {
      try {
        const objectStorage = require('../../services/objectStorageService');
        if (!objectStorage.isConfigured()) return false;
        const key = objectStorage.keyForMediaUrl(req.path);
        if (!key) return false;
        // Cache "exists in R2" on the videoMetaCache entry so we don't HEAD
        // on every range-request fetch.
        if (entry.r2Status === undefined) {
          entry.r2Status = await objectStorage.exists(key) ? 'present' : 'missing';
        }
        if (entry.r2Status !== 'present') return false;
        const url = await objectStorage.getPresignedUrl(key, 3600);
        // Set Cache-Control before redirect; browsers honor headers on 302.
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
      if (await tryR2Redirect()) return;
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
      // Authorized — try R2 first, fall back to disk
      if (await tryR2Redirect()) return;
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
    const skipPaths = [
      '/api/auth-status',
      '/api/webapp/notifications/counts',
    ];
    return skipPaths.includes(req.path);
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

// Stricter rate limiting for webhooks to prevent abuse
const webhookLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 50, // Limit each IP to 50 webhook requests per 5 minutes
  message: 'Too many webhook requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
});

// Rate limiting for authentication endpoints (prevent brute force attacks)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30, // 30 failed auth attempts per 15 min (only failures count)
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
const authStatusLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
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
app.post('/api/webhooks/epayco', webhookLimiter, webhookController.handleEpaycoWebhook);
app.post('/api/webhook/epayco', webhookLimiter, webhookController.handleEpaycoWebhook); // singular alias
// New route for pnptv-bot ePayco payments via easybots.store domain
app.post('/checkout/pnp', webhookLimiter, webhookController.handleEpaycoWebhook);
app.post('/checkout/pnp/confirmation', webhookLimiter, webhookController.handleEpaycoWebhook);

// Stripe webhook — checkout.session.completed, subscription events, invoice events
// The global express.json() verify callback (line ~291) already stores the raw body
// buffer in req.rawBody — handleStripeWebhook reads that directly.
app.post(
  '/api/webhooks/stripe',
  webhookLimiter,
  asyncHandler(webhookController.handleStripeWebhook)
);

// ── Stripe checkout / portal routes (authenticated) ───────────────────────────

const stripeService = require('../../services/stripeService');

// POST /api/webapp/payments/stripe/checkout — one-time payment checkout
app.post('/api/webapp/payments/stripe/checkout', requireSessionAuth, asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { planId, sku, metadata } = req.body;

  if (!planId) {
    return res.status(400).json({ success: false, error: 'planId is required' });
  }

  const pg = require('../../config/postgres');
  const { rows: planRows } = await pg.query(
    'SELECT stripe_price_id FROM plans WHERE id = $1 AND active = true',
    [planId]
  );
  const priceId = planRows[0]?.stripe_price_id;
  if (!priceId) {
    return res.status(400).json({ success: false, error: 'This plan is not available for card payment' });
  }

  const RESERVED_META = new Set(['user_id', 'plan_id', 'sku', 'payment_type', 'payment_id']);
  const safeMetadata = Object.fromEntries(
    Object.entries(metadata || {}).filter(([k]) => !RESERVED_META.has(k))
  );
  if (safeMetadata.promo_code) {
    return res.status(400).json({
      success: false,
      error: 'Promo codes are not supported on Stripe checkout yet. Please use Dash or the standard checkout flow.',
    });
  }

  const _stripeDomain = process.env.CHECKOUT_DOMAIN || 'https://pnptv.app';
  const returnPath = planId === 'lifetime100' ? '/lifetime100' : '/subscribe';
  const successUrl = `${_stripeDomain}${returnPath}?stripe_paid=1&plan=${encodeURIComponent(planId)}&session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${_stripeDomain}${planId === 'lifetime100' ? '/lifetime100' : '/'}`;

  let email;
  try {
    const { rows } = await pg.query(
      'SELECT email FROM users WHERE id = $1',
      [userId]
    );
    email = rows[0]?.email || undefined;
  } catch (_) { /* non-fatal */ }

  const { sessionId, url } = await stripeService.createCheckoutSession({
    userId,
    planId,
    sku: sku || '',
    priceId,
    successUrl,
    cancelUrl,
    customerEmail: email,
    metadata: safeMetadata,
  });

  return res.json({ success: true, sessionId, checkoutUrl: url });
}));

// POST /api/webapp/payments/stripe/subscription — recurring subscription checkout
app.post('/api/webapp/payments/stripe/subscription', requireSessionAuth, asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { planId, sku, metadata } = req.body;

  if (!planId) {
    return res.status(400).json({ success: false, error: 'planId is required' });
  }

  const pg = require('../../config/postgres');
  const { rows: planRows } = await pg.query(
    'SELECT stripe_price_id FROM plans WHERE id = $1 AND active = true',
    [planId]
  );
  const priceId = planRows[0]?.stripe_price_id;
  if (!priceId) {
    return res.status(400).json({ success: false, error: 'This plan is not available for card payment' });
  }

  const RESERVED_META2 = new Set(['user_id', 'plan_id', 'sku', 'payment_type', 'payment_id']);
  const safeMetadata = Object.fromEntries(
    Object.entries(metadata || {}).filter(([k]) => !RESERVED_META2.has(k))
  );
  if (safeMetadata.promo_code) {
    return res.status(400).json({
      success: false,
      error: 'Promo codes are not supported on Stripe checkout yet. Please use Dash or the standard checkout flow.',
    });
  }

  const _stripeDomain2 = process.env.CHECKOUT_DOMAIN || 'https://pnptv.app';
  const successUrl = `${_stripeDomain2}/subscribe?stripe_paid=1&plan=${encodeURIComponent(planId)}&session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${_stripeDomain2}/`;

  let email;
  try {
    const { rows } = await pg.query(
      'SELECT email FROM users WHERE id = $1',
      [userId]
    );
    email = rows[0]?.email || undefined;
  } catch (_) { /* non-fatal */ }

  const { sessionId, url } = await stripeService.createSubscriptionCheckout({
    userId,
    planId,
    sku: sku || '',
    priceId,
    successUrl,
    cancelUrl,
    customerEmail: email,
    metadata: safeMetadata,
  });

  return res.json({ success: true, sessionId, checkoutUrl: url });
}));

// POST /api/webapp/payments/stripe/portal — customer portal (manage/cancel subscription)
app.post('/api/webapp/payments/stripe/portal', requireSessionAuth, asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const returnUrl = `https://pnptv.app/settings/payments`;

  // Look up the stripe customer id
  const { rows } = await require('../../config/postgres').query(
    'SELECT stripe_customer_id, email FROM users WHERE id = $1',
    [userId]
  );
  const user = rows[0];

  let customerId = user?.stripe_customer_id;
  if (!customerId) {
    // Create customer on demand so the portal session can be opened
    customerId = await stripeService.getOrCreateCustomer(userId, user?.email || undefined);
  }

  const { url } = await stripeService.createCustomerPortalSession(customerId, returnUrl);
  return res.json({ success: true, url });
}));

// POST /api/webapp/payments/stripe/creator-subscription — subscribe to a specific creator
app.post('/api/webapp/payments/stripe/creator-subscription', requireSessionAuth, asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { creatorId } = req.body;
  if (!creatorId) return res.status(400).json({ success: false, error: 'creatorId is required' });

  if (String(userId) === String(creatorId)) {
    return res.status(400).json({ success: false, error: 'Cannot subscribe to yourself' });
  }

  const pg = require('../../config/postgres');
  const EntitlementAccessService = require('../../services/entitlementAccessService');

  const hasPrime = await EntitlementAccessService.hasEntitlement(userId, 'prime');
  if (!hasPrime) {
    return res.status(403).json({ success: false, error: 'PRIME subscription required to subscribe to creators' });
  }

  // Resolve creator type to determine pricing tier
  const { rows: creatorRows } = await pg.query(
    `SELECT u.creator_type, u.creator_status, u.creator_locked
       FROM users u
      WHERE u.id = $1::text AND u.role IN ('creator','model')`,
    [creatorId]
  );
  if (!creatorRows.length) return res.status(404).json({ success: false, error: 'Creator not found' });
  if (creatorRows[0].creator_status !== 'active') {
    return res.status(409).json({ success: false, error: 'Creator is not active' });
  }
  if (creatorRows[0].creator_locked === true) {
    return res.status(423).json({ success: false, error: 'This creator is completing onboarding and cannot accept new subscriptions yet.' });
  }

  const creatorType = creatorRows[0].creator_type;
  const planMap = { ice: 'creator_ice', crystal: 'creator_crystal', diamond: 'creator_diamond' };
  const planId = planMap[creatorType] || 'creator_monthly';

  const { rows: planRows } = await pg.query(
    'SELECT stripe_price_id FROM plans WHERE id = $1 AND active = true',
    [planId]
  );
  const priceId = planRows[0]?.stripe_price_id;
  if (!priceId) return res.status(400).json({ success: false, error: 'Stripe not configured for this creator tier' });

  let email;
  try {
    const { rows } = await pg.query('SELECT email FROM users WHERE id = $1', [userId]);
    email = rows[0]?.email || undefined;
  } catch (_) { /* non-fatal */ }

  const _cdDomain = process.env.CHECKOUT_DOMAIN || 'https://pnptv.app';
  const successUrl = `${_cdDomain}/profile/${creatorId}?stripe_sub=1`;
  const cancelUrl  = `${_cdDomain}/profile/${creatorId}`;

  const { sessionId, url } = await stripeService.createSubscriptionCheckout({
    userId,
    planId,
    sku: planId,
    priceId,
    successUrl,
    cancelUrl,
    customerEmail: email,
    metadata: { creatorId, payment_type: 'creator_subscription' },
  });

  return res.json({ success: true, sessionId, checkoutUrl: url });
}));

// ── Creator subscription user-facing routes ───────────────────────────────────

const creatorController = require('./controllers/creatorController');
app.get('/api/webapp/creator/:creatorId/subscription-status', requireSessionAuth, asyncHandler(creatorController.getSubscriptionStatus));
app.post('/api/webapp/creator/:creatorId/subscribe', requireSessionAuth, asyncHandler(creatorController.subscribeToCreator));
app.post('/api/webapp/creator/:creatorId/unsubscribe', requireSessionAuth, asyncHandler(creatorController.unsubscribeFromCreator));

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
      return res.status(400).json({ error: err.message });
    }
    return res.status(200).json({ error: err.message });
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

  // Generate ePayco checkout config for frontend
  const invoice = `PNP-LIVE-${booking.id}`;
  const amount = String(booking.price_usd);
  const currencyCode = 'USD';
  const webhookDomain = process.env.BOT_WEBHOOK_DOMAIN || 'https://pnptv.app';
  const epaycoWebhookDomain = process.env.EPAYCO_WEBHOOK_DOMAIN || 'https://pnptv.app';

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
      epaycoPublicKey: process.env.EPAYCO_PUBLIC_KEY,
      testMode: process.env.EPAYCO_TEST_MODE === 'true',
      epaycoSignature: PaymentService.generateEpaycoCheckoutSignature({ invoice, amount, currencyCode }),
      confirmationUrl: `${epaycoWebhookDomain}/api/webhooks/epayco`,
      responseUrl: `${webhookDomain}/api/payment-response`,
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

// NOTE: The /api/recurring/* routes and VisaCybersourceService integration
// were removed. The service was non-functional in production because its
// required config (config/payment.config.js) never existed — every call
// resolved to `undefined/token/card` via an unconfigured axios endpoint.
// Recurring-subscription tokenization is handled inside the regular ePayco
// webhook path; frontends use the unified /api/webapp/payments/create flow.

// Subscription API routes
app.get('/api/subscription/plans', asyncHandler(subscriptionController.getPlans));
app.post('/api/subscription/create-plan', verifyAdminJWT, asyncHandler(subscriptionController.createEpaycoPlan));
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
app.get('/api/media/:mediaId', asyncHandler(async (req, res) => {
  const { mediaId } = req.params;

  try {
    const media = await MediaPlayerModel.getMediaById(mediaId);

    if (!media) {
      return res.status(404).json({
        success: false,
        message: 'Media not found'
      });
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
app.get('/api/webapp/auth/magic/verify', asyncHandler(webAppController.magicLinkVerify));
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
          // Heal the mismatch in our DB
          await getPool().query('UPDATE users SET pnptv_id = $1, updated_at = NOW() WHERE id = $2', [match.uuid, u.id]);
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
  'studio.pnptv.app',
]);

function sanitizeOidcReturnTo(raw) {
  if (typeof raw !== 'string' || !raw) return '/';
  if (/^\/[a-z0-9/_-]*/i.test(raw)) return raw;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:') return '/';
    if (!OIDC_ALLOWED_RETURN_HOSTS.has(parsed.hostname)) return '/';
    return parsed.toString();
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
    authUrl = AuthentikService.generateAuthUrl(
      state,
      codeVerifier,
      {
        ...(methodHint ? { method: methodHint } : {}),
        ...(loginHint ? { loginHint } : {}),
      }
    );
  } catch (err) {
    logger.error('[OIDC] Failed to generate auth URL:', err.message);
    await redis.del(pkceKey);
    return res.status(500).json({ error: 'Failed to initiate OIDC login' });
  }

  logger.info('[OIDC] Redirecting to Authentik', { state: state.slice(0, 8) + '...' });
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
            tier, terms_accepted, photo_file_id, bio, language, role,
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
              tier, terms_accepted, photo_file_id, bio, language, role,
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
         WHERE id = $4`,
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
              tier, terms_accepted, photo_file_id, bio, language, role,
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
         WHERE id = $5`,
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
                   tier, terms_accepted, photo_file_id, bio, language, role,
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
                     tier, terms_accepted, photo_file_id, bio, language, role,
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

  // ePayco: payments still pending past the abandon threshold (24h cutoff handled
  // by cleanupAbandonedPayments cron — anything pending >1h is interesting).
  const epaycoStuck = await q(`
    SELECT id, user_id, plan_id, amount, currency, reference,
           created_at,
           EXTRACT(EPOCH FROM (NOW() - created_at))/3600 AS hours_pending
    FROM payments
    WHERE status = 'pending'
      AND provider = 'epayco'
      AND created_at < NOW() - INTERVAL '1 hour'
      AND created_at > NOW() - INTERVAL '30 days'
    ORDER BY created_at ASC
    LIMIT 50
  `);

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
      (SELECT COUNT(*) FROM payments WHERE status='completed' AND provider='epayco' AND completed_at > NOW() - INTERVAL '7 days') AS epayco_completed_7d,
      (SELECT COUNT(*) FROM dash_subscription_orders WHERE status='completed' AND completed_at > NOW() - INTERVAL '7 days') AS dash_completed_7d,
      (SELECT COUNT(*) FROM meru_payment_links WHERE status='used' AND used_at > NOW() - INTERVAL '7 days') AS meru_completed_7d,
      (SELECT COUNT(*) FROM video_fetch_log WHERE fetched_at > NOW() - INTERVAL '7 days') AS video_views_7d,
      (SELECT COUNT(DISTINCT media_url) FROM video_fetch_log WHERE fetched_at > NOW() - INTERVAL '7 days') AS distinct_videos_7d
  `);

  return res.json({
    success: true,
    stuck: {
      epayco: { count: epaycoStuck.rowCount, items: epaycoStuck.rows },
      meru: { count: meruStuck.rowCount, items: meruStuck.rows },
      dash: { count: dashStuck.rowCount, items: dashStuck.rows },
    },
    leaks: { count: leaks.rowCount, items: leaks.rows },
    activity: settlements.rows[0] || {},
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
  const balance = await tokenService.getBalance(userId);
  return res.json({ success: true, balance });
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
app.post('/api/webapp/live/stream-rules', requireSessionAuth, asyncHandler(liveRulesController.saveStreamRules));

// Web App Live Streaming Routes
const webappLiveController = require('./controllers/webappLiveController');
app.get('/api/webapp/live/streams', requireSessionAuth, requireMemberTier, asyncHandler(webappLiveController.listStreams));
app.get('/api/webapp/live/rtmp-key', requireSessionAuth, asyncHandler(webappLiveController.getRtmpKey));
// Self-serve channel provisioning: creator gets a Restreamer channel on first "Go Live"
app.post('/api/webapp/live/provision-channel', requireSessionAuth, asyncHandler(webappLiveController.provisionChannel));
// Raid: creator sends all viewers to another live stream
app.post('/api/webapp/live/raid', requireSessionAuth, asyncHandler(webappLiveController.initiateRaid));
// Host mode: embed another channel's stream when offline
app.get('/api/webapp/live/host', requireSessionAuth, asyncHandler(webappLiveController.getHostedChannel));
app.post('/api/webapp/live/host', requireSessionAuth, asyncHandler(webappLiveController.setHostedChannel));
// Stream schedule: upcoming broadcasts for the next 7 days (Redis-cached 5 min)
app.get('/api/webapp/live/schedule', requireSessionAuth, asyncHandler(webappLiveController.getSchedule));
// Stream schedule notifications: subscribe/unsubscribe/check for a slot
app.post('/api/webapp/live/schedule/notify', requireSessionAuth, asyncHandler(webappLiveController.subscribeScheduleNotify));
app.delete('/api/webapp/live/schedule/notify', requireSessionAuth, asyncHandler(webappLiveController.unsubscribeScheduleNotify));
app.get('/api/webapp/live/schedule/notify/:slotId', requireSessionAuth, asyncHandler(webappLiveController.checkScheduleNotify));
// Admin: manage Restreamer channel assignments
app.get('/api/webapp/admin/live/channels', adminGuard, asyncHandler(webappLiveController.listChannels));
app.post('/api/webapp/admin/live/assign-channel', adminGuard, asyncHandler(webappLiveController.assignChannel));

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

// Stream analytics — creator only
const creatorGuard = require('./middleware/creatorGuard');
app.get('/api/webapp/live/analytics/sessions', requireSessionAuth, creatorGuard, asyncHandler(webappLiveController.getAnalyticsSessions));
app.get('/api/webapp/live/analytics/summary', requireSessionAuth, creatorGuard, asyncHandler(webappLiveController.getAnalyticsSummary));

// Creator revenue aggregation (tips + tickets + subs + calls)
app.get('/api/webapp/creator/revenue', requireSessionAuth, roleGuard('model', 'creator', 'admin', 'superadmin'), asyncHandler(webappLiveController.getCreatorRevenue));

// Manual going-live broadcast to followers
app.post('/api/webapp/live/broadcast-live-now', requireSessionAuth, roleGuard('model', 'creator', 'admin', 'superadmin'), asyncHandler(webappLiveController.broadcastLiveNow));

// VOD replay recordings
app.get('/api/webapp/creators/:creatorId/recordings', softAuth, asyncHandler(webappLiveController.listCreatorRecordings));
app.delete('/api/webapp/recordings/:id', requireSessionAuth, roleGuard('model', 'creator', 'admin', 'superadmin'), asyncHandler(webappLiveController.deleteRecordingEndpoint));
app.patch('/api/webapp/recordings/:id', requireSessionAuth, roleGuard('model', 'creator', 'admin', 'superadmin'), asyncHandler(webappLiveController.updateRecordingEndpoint));

// Streamer Settings: persistent encoder + filter preferences
const streamerSettingsController = require('./controllers/streamerSettingsController');
app.get('/api/webapp/live/settings', requireSessionAuth, asyncHandler(streamerSettingsController.getSettings));
app.put('/api/webapp/live/settings', requireSessionAuth, asyncHandler(streamerSettingsController.updateSettings));
// Gap 2: Persistent thumbnail upload
app.post('/api/webapp/live/thumbnail', requireSessionAuth, asyncHandler(streamerSettingsController.uploadThumbnail));
// MED-02: 6 MB body limit for snapshot uploads (base64-encoded frame); role guard restricts to creators only
app.post('/api/webapp/live/snapshot', requireSessionAuth, roleGuard('model', 'creator', 'admin', 'superadmin'), express.json({ limit: '6mb' }), asyncHandler(webappLiveController.uploadSnapshot));

// Gap 1: Past-session earnings history for studio panel
app.get('/api/webapp/live/earnings', requireSessionAuth, roleGuard('model', 'creator', 'admin', 'superadmin'), asyncHandler(webappLiveController.getEarningsHistory));

// Gap 4: User-uploaded local recording blob
app.post('/api/webapp/live/recording', requireSessionAuth, webappLiveController.uploadLocalRecording);

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
app.get('/api/webapp/live/stream-profile', requireSessionAuth, asyncHandler(streamAutoController.getStreamProfile));
app.post('/api/webapp/live/stream-profile', requireSessionAuth, grokStreamChatLimiter, asyncHandler(streamAutoController.saveStreamProfile));
app.post('/api/webapp/live/stream-auto-start', requireSessionAuth, roleGuard('model', 'creator', 'admin', 'superadmin'), asyncHandler(streamAutoController.startAutoMessages));
app.post('/api/webapp/live/stream-auto-stop', requireSessionAuth, roleGuard('model', 'creator', 'admin', 'superadmin'), asyncHandler(streamAutoController.stopAutoMessages));

// Connection quality test — measures round-trip latency and upload throughput
app.post('/api/webapp/live/connection-test', requireSessionAuth, connectionTestLimiter, asyncHandler(async (req, res) => {
  const start = Date.now();
  const payloadSize = req.body?.payload?.length || 0;
  const latencyMs = Date.now() - start;
  const payloadBytes = payloadSize * 0.75; // base64 to bytes
  const uploadKbps = payloadBytes > 0 ? Math.round((payloadBytes * 8) / (latencyMs || 1)) : 0;
  const quality = uploadKbps >= 5000 ? 'excellent' : uploadKbps >= 2500 ? 'good' : uploadKbps >= 1000 ? 'fair' : 'poor';
  res.json({ success: true, uploadKbps, latencyMs, quality });
}));

// Stream history — returns past streams and aggregate stats for the authenticated creator
app.get('/api/webapp/live/stream-history', requireSessionAuth, roleGuard('model', 'creator', 'admin', 'superadmin'), asyncHandler(async (req, res) => {
  const LiveStreamModel = require('../../models/liveStreamModel');
  const userId = req.session.userId || req.session.user?.id;
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

// Web App Payments (session auth → PaymentService)

// ensureEmailCredentials lives in services/userService — single source of truth
// shared with apps/backend/bot/api/routes/paymentRoutes.js
const { ensureEmailCredentials } = require('../../services/userService');

// Get a random available Meru link for a product
// Verifies the link is actually unpaid on Meru before serving it
app.get('/api/meru/random-link', asyncHandler(async (req, res) => {
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

    // Grant membership — mirrors the existing /api/webapp/activate/meru pattern
    const UserModel = require('../../models/userModel');
    const primeExpiry = new Date();
    primeExpiry.setDate(primeExpiry.getDate() + 60);
    await UserModel.updateSubscription(userId, { status: 'active', planId: 'lifetime100', expiry: null });
    await pool.query(
      `UPDATE users SET tier='PRIME', plan_expiry=$2, updated_at=NOW() WHERE id=$1`,
      [userId, primeExpiry.toISOString()]
    );

    // Grant entitlements — pnp-member (lifetime) + prime (60 days)
    try {
      const EntitlementModel = require('../../models/entitlementModel');
      const EntitlementAccessService = require('../../services/entitlementAccessService');
      await EntitlementModel.grantEntitlement(userId, 'pnp-member', {
        isLifetime: true, source: 'meru', actorId: 'system',
        reason: 'Meru lifetime100 activation (public flow)',
      });
      await EntitlementModel.grantEntitlement(userId, 'prime', {
        isLifetime: false, durationDays: 60, source: 'meru', actorId: 'system',
        reason: 'Meru lifetime100 activation — 2 month PRIME bonus (public)',
      });
      await EntitlementAccessService.invalidateCache(userId);
    } catch (entErr) {
      logger.error('public lifetime100 activate: entitlement grant failed', { userId, error: entErr.message });
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

    // 3. Activate membership — set lifetime100 (member tier) + 2 months PRIME bonus
    const UserModel = require('../../models/userModel');
    const primeExpiry = new Date();
    primeExpiry.setDate(primeExpiry.getDate() + 60); // 2 months PRIME bonus

    // Start with PRIME tier (for the 2-month bonus period), then cron/expiry will downgrade to member
    await UserModel.updateSubscription(userId, {
      status: 'active',
      planId: 'lifetime100',
      expiry: null, // lifetime member — no expiry on the base plan
    });

    // Grant PRIME for 2 months by temporarily setting tier to PRIME with expiry
    // The plan_expiry tracks when PRIME expires; after that the user stays as lifetime member
    const pool = getPool();
    await pool.query(
      `UPDATE users SET tier = 'PRIME', plan_expiry = $2, updated_at = NOW() WHERE id = $1`,
      [userId, primeExpiry.toISOString()]
    );

    // 3b. Grant entitlements (pnp-member lifetime + prime 60 days) — sole source of truth for access
    try {
      const EntitlementModel = require('../../models/entitlementModel');
      // Lifetime pnp-member
      await EntitlementModel.grantEntitlement(userId, 'pnp-member', {
        isLifetime: true, source: 'meru', actorId: 'system', reason: 'Meru lifetime100 activation',
      });
      // 60-day prime bonus
      await EntitlementModel.grantEntitlement(userId, 'prime', {
        isLifetime: false, durationDays: 60, source: 'meru', actorId: 'system', reason: 'Meru lifetime100 activation — 2 month PRIME bonus',
      });
      await EntitlementAccessService.invalidateCache(userId);
    } catch (entErr) {
      logger.error('Meru entitlement grant failed (user has tier but no entitlements)', { userId, error: entErr.message });
      // Continue — users.tier is set, so legacy paths still work; entitlements will be synced by daily cleanup
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

app.post('/api/webapp/payments/create', requireSessionAuth, asyncHandler(async (req, res) => {
  const user = req.session?.user;
  if (!user?.id) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }

  const { planId, provider, creatorId, email, promoCode } = req.body;
  if (!planId) {
    return res.status(400).json({ success: false, error: 'planId is required' });
  }
  if (provider && !['stripe'].includes(provider)) {
    return res.status(400).json({ success: false, error: 'Invalid provider. Must be stripe' });
  }
  if (email && (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || email.trim().length > 254)) {
    return res.status(400).json({ success: false, error: 'Invalid email address' });
  }
  if (promoCode != null) {
    if (typeof promoCode !== 'string' || !/^[A-Za-z0-9_-]{3,64}$/.test(promoCode.trim())) {
      return res.status(400).json({ success: false, error: 'Invalid promo code' });
    }
  }

  const userId = String(user.telegramId || user.telegram_id || user.id);
  const language = user.language || 'es';
  if (promoCode) {
    return res.status(400).json({
      success: false,
      error: 'Promo codes are no longer supported on this legacy endpoint. Use /subscribe with the promo code in the web app.',
    });
  }

  const pg = require('../../config/postgres');
  const { rows: planRows } = await pg.query(
    'SELECT stripe_price_id, duration_days FROM plans WHERE id = $1 AND active = true',
    [planId]
  );
  const plan = planRows[0];
  if (!plan?.stripe_price_id) {
    return res.status(400).json({ success: false, error: 'This plan is not available for Stripe checkout' });
  }

  let emailFromDb;
  try {
    const { rows } = await pg.query('SELECT email FROM users WHERE id = $1', [userId]);
    emailFromDb = rows[0]?.email || undefined;
  } catch (_) { /* non-fatal */ }

  const stripePayload = {
    userId,
    planId,
    sku: creatorId ? String(creatorId) : planId,
    priceId: plan.stripe_price_id,
    successUrl: `${process.env.CHECKOUT_DOMAIN || 'https://pnptv.app'}/subscribe?stripe_paid=1&plan=${encodeURIComponent(planId)}&session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${process.env.CHECKOUT_DOMAIN || 'https://pnptv.app'}/subscribe`,
    customerEmail: emailFromDb,
    metadata: creatorId ? { creatorId: String(creatorId) } : {},
  };

  const result = Number(plan.duration_days || 0) > 0 && Number(plan.duration_days || 0) <= 365
    ? await stripeService.createSubscriptionCheckout(stripePayload)
    : await stripeService.createCheckoutSession(stripePayload);

  // Only provision email credentials if email was provided
  if (email) {
    try {
      await ensureEmailCredentials(userId, email.trim(), language);
      req.session.user = { ...req.session.user, email: email.trim() };
    } catch (credErr) {
      if (credErr.message.includes('already associated')) {
        return res.status(409).json({ success: false, error: credErr.message });
      }
      logger.warn('ensureEmailCredentials failed after payment creation (non-critical)', { userId, error: credErr.message });
    }
  }

  res.json({
    success: true,
    paymentUrl: result.url,
    paymentId: result.sessionId,
  });
}));

// Web App Admin Routes (session auth + role check)
const webappAdminController = require('./controllers/webappAdminController');
const primeController = require('./controllers/primeController');

// Admin endpoints with session-based authentication
app.get('/api/webapp/admin/stats', adminGuard, asyncHandler(webappAdminController.getStats));
app.get('/api/webapp/admin/demographics', adminGuard, asyncHandler(webappAdminController.getDemographics));
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
  }));
  res.json({ success: true, messages });
}));

app.post('/api/webapp/admin/support/tickets/:userId/reply', adminGuard, asyncHandler(async (req, res) => {
  const { content } = req.body;
  if (!content || typeof content !== 'string' || !content.trim() || content.length > 2000) {
    return res.status(400).json({ success: false, error: 'Message required (max 2000 chars)' });
  }

  const userId = req.params.userId;
  const adminName = req.session?.user?.displayName || req.session?.user?.username || 'Support';
  const SupportTicketMessageModel = require('../../models/supportTicketMessageModel');
  const SupportTopicModel = require('../../models/supportTopicModel');

  const saved = await SupportTicketMessageModel.create({
    userId,
    senderType: 'agent',
    senderName: adminName,
    content: content.trim(),
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
// Resource picker for the admin scoped grant form. Returns channels, hangouts, or creators.
app.get('/api/webapp/admin/resources', adminGuard, asyncHandler(webappAdminController.searchResources));
app.delete('/api/webapp/admin/users/:userId/entitlements/:addOnId', adminGuard, asyncHandler(webappAdminController.revokeUserEntitlement));
app.put('/api/webapp/admin/users/:userId/entitlements/:addOnId/extend', adminGuard, asyncHandler(webappAdminController.extendUserEntitlement));
// Creator / Live Performer promotion
app.post('/api/webapp/admin/users/:userId/make-creator', adminGuard, asyncHandler(webappAdminController.makeCreator));
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
app.get('/api/webapp/hangouts/groups/:id/invite-link', requireSessionAuth, asyncHandler(hangoutGroupController.getInviteLink));
app.put('/api/webapp/hangouts/groups/:id/notification', requireSessionAuth, asyncHandler(hangoutGroupController.updateNotificationMode));
app.post('/api/webapp/hangouts/groups/:id/delete-message', requireSessionAuth, requireHangoutAccess, asyncHandler(hangoutGroupController.adminDeleteMessage));
// ── Hangout Feed Integration ────────────────────────────────────────────────
app.get('/api/webapp/hangouts/groups/:id/feed', requireSessionAuth, asyncHandler(socialController.getHangoutFeed));
app.post('/api/webapp/hangouts/groups/:id/drop-to-feed', requireSessionAuth, asyncHandler(socialController.dropToFeed));

// Hangout video calls — LiveKit
const { startCall, joinCall, endCall, leaveCall, refreshCallToken, muteCallParticipant, kickCallParticipant } = require('./controllers/hangoutGroupController');
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
  const result = await referralService.redeemReferral(code, user.id);
  return res.json(result);
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
app.get('/api/webapp/social/home-feed', asyncHandler(socialController.getHomeFeed));
// Authenticated feed — full paginated feed with liked_by_me per viewer
app.get('/api/webapp/social/feed', requireSessionAuth, asyncHandler(socialController.getFeed));
// Wall of Fame sub-feed — WoF-only posts
app.get('/api/webapp/social/wof-feed', asyncHandler(socialController.getWofFeed));
// Hashtag feed — posts containing a specific #tag (?tag=pnp)
app.get('/api/webapp/social/hashtag-feed', requireSessionAuth, asyncHandler(socialController.getHashtagFeed));
app.get('/api/webapp/social/wall/:userId', asyncHandler(socialController.getWall));
app.get('/api/webapp/social/profile/:userId', asyncHandler(socialController.getPublicProfile));
app.post('/api/webapp/social/posts', requireSessionAuth, asyncHandler(socialController.createPost));
app.post('/api/webapp/social/posts/with-media', requireSessionAuth, uploadLimiter, attachCreatorStatus, postMediaUploadMiddleware, asyncHandler(socialController.createPostWithMedia));
app.post('/api/webapp/social/posts/with-multi-media', requireSessionAuth, uploadLimiter, attachCreatorStatus, postMultiMediaUploadMiddleware, asyncHandler(socialController.createPostWithMultiMedia));
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
  const dedupeKey = `view:post:${postId}:${(req.session?.userId) || (req.ip || 'anon').replace(/[^a-zA-Z0-9.:_-]/g, '_')}`;
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

// Global search — used by the navbar 🔍 icon. Aggregates users, creators,
// and posts in a single response so the client doesn't have to fan out.
// Client expects: { success, users:[…], creators:[…], posts:[…] }.
app.get('/api/webapp/search', requireSessionAuth, asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ success: true, users: [], creators: [], posts: [] });
  const { query } = require('../../config/postgres');
  const viewerId = req.session.user.id;
  const like = `%${q.replace(/[%_\\]/g, '\\$&')}%`;

  const [usersRes, creatorsRes, postsRes] = await Promise.all([
    query(
      `SELECT id, username, first_name, last_name, photo_file_id
         FROM users
        WHERE id::text != $1
          AND is_deleted = false
          AND (username ILIKE $2 ESCAPE '\\' OR first_name ILIKE $2 ESCAPE '\\' OR last_name ILIKE $2 ESCAPE '\\')
        ORDER BY first_name ASC
        LIMIT 8`,
      [String(viewerId), like],
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
        LIMIT 8`,
      [like],
    ),
    query(
      `SELECT p.id, p.content, u.username AS author_username
         FROM social_posts p
         JOIN users u ON u.id::text = p.user_id::text
        WHERE p.is_deleted = false
          AND u.is_deleted = false
          AND p.content ILIKE $1 ESCAPE '\\'
        ORDER BY p.created_at DESC
        LIMIT 8`,
      [like],
    ),
  ]);

  return res.json({
    success: true,
    users: usersRes.rows,
    creators: creatorsRes.rows,
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
app.get('/api/proxy/live/streams', requireSessionAuth, requireMemberTier, asyncHandler(async (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  try {
    const restreamerUrl = process.env.RESTREAMER_URL || 'http://restreamer:8080';
    // Use undefined-check: a deliberately empty password string must still be passed to login.
    // The || '' fallback would make an empty RESTREAMER_PASSWORD falsy, skipping auth entirely
    // and causing Restreamer to reject the unauthenticated /api/v3/process request with a 401,
    // which surfaces as an empty streams list with no error logged.
    const restreamerUser = process.env.RESTREAMER_USER !== undefined ? process.env.RESTREAMER_USER : 'admin';
    const restreamerPass = process.env.RESTREAMER_PASSWORD !== undefined ? process.env.RESTREAMER_PASSWORD : null;

    let token = null;
    if (restreamerUser && restreamerPass !== null) {
      try {
        const loginResp = await axios.post(`${restreamerUrl}/api/login`, {
          username: restreamerUser,
          password: restreamerPass,
        }, { timeout: 5000 });
        token = loginResp.data?.access_token;
      } catch (loginErr) {
        logger.warn(`Restreamer login failed, trying without auth: ${loginErr.message}`);
      }
    }

    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const resp = await axios.get(`${restreamerUrl}/api/v3/process`, {
      headers,
      timeout: 10000,
    });

    // Strip trailing slash to prevent double-slash in HLS URLs (e.g. https://live.pnptv.app//memfs/...)
    const publicUrl = (process.env.RESTREAMER_PUBLIC_URL || 'https://live.pnptv.app').replace(/\/$/, '');
    const processes = resp.data || [];
    const rawStreams = processes
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
        return {
          id: refId,
          name: p.metadata?.['restreamer-ui']?.meta?.name || 'Live Stream',
          description: p.metadata?.['restreamer-ui']?.meta?.description || '',
          hlsUrl: `${publicUrl}/memfs/${refId}.m3u8`,
          isLive: p.state?.exec === 'running',
        };
      })
      .filter(Boolean);

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

    // Fetch featured from Directus + active creators from DB + live streams from Restreamer
    const [directusResult, dbResult, streamsResult] = await Promise.allSettled([
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
                creator_type, creator_status, creator_price_usd, live_channel
         FROM users
         WHERE creator_status = 'active'
         ORDER BY creator_subscriber_count DESC NULLS LAST
         LIMIT 20`
      ),
      (async () => {
        if (process.env.RESTREAMER_USER === undefined || process.env.RESTREAMER_PASSWORD === undefined) return [];
        try {
          let token = null;
          try {
            const loginResp = await axios.post(`${restreamerUrl}/api/login`, {
              username: process.env.RESTREAMER_USER,
              password: process.env.RESTREAMER_PASSWORD,
            }, { timeout: 5000 });
            token = loginResp.data?.access_token ?? null;
          } catch (loginErr) {
            logger.warn(`featured: Restreamer login failed (non-fatal): ${loginErr.message}`);
          }
          const headers = token ? { Authorization: `Bearer ${token}` } : {};
          const procResp = await axios.get(`${restreamerUrl}/api/v3/process`, { headers, timeout: 8000 });
          return (procResp.data || []).filter(p =>
            p.id?.startsWith('restreamer-ui:ingest:') && p.state?.exec === 'running'
          );
        } catch (e) {
          logger.warn(`featured: Restreamer fetch failed (non-fatal): ${e.message}`);
          return [];
        }
      })(),
    ]);

    const directusPerformers = directusResult.status === 'fulfilled'
      ? (directusResult.value.data?.data || [])
      : [];
    const dbCreators = dbResult.status === 'fulfilled'
      ? (dbResult.value.rows || [])
      : [];
    const liveProcesses = streamsResult.status === 'fulfilled'
      ? (streamsResult.value || [])
      : [];

    // Build set of currently-live Restreamer channel references
    const liveRefs = new Set(
      liveProcesses
        .map(p => (typeof p.reference === 'string' && p.reference) ? p.reference : null)
        .filter(Boolean)
    );

    const photoMap = await fetchPerformerPhotos(directusPerformers);
    const mapped = directusPerformers.map(p => mapDirectusPerformer(p, photoMap));

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
        photoUrl: photo,
        isFeatured: false,
        isAvailable: true,
        basePrice: c.creator_price_usd || 100,
        totalCalls: 0,
        averageRating: 0,
      });
    }

    // Inject live status: match users by live_channel against running Restreamer processes
    if (liveRefs.size > 0) {
      try {
        const placeholders = [...liveRefs].map((_, i) => `$${i + 1}`).join(',');
        const { rows: channelUsers } = await getPool().query(
          `SELECT id, live_channel FROM users WHERE live_channel IN (${placeholders})`,
          [...liveRefs]
        );

        const redis = getRedis();
        for (const u of channelUsers) {
          const channelRef = u.live_channel;
          const safeRef = typeof channelRef === 'string'
            ? channelRef.replace(/[^a-zA-Z0-9\-_.]/g, '')
            : null;
          const hlsUrl = safeRef && !safeRef.includes('..')
            ? `${restreamerPublicUrl}/memfs/${safeRef}.m3u8`
            : null;

          // Fetch metadata and thumbnail from Redis
          let metadata = {};
          let thumbUrl = null;
          if (redis && safeRef) {
            try {
              const [metaRaw, thumbRaw] = await Promise.all([
                redis.get(`stream:meta:${safeRef}`),
                redis.get(`stream:thumb:${safeRef}`),
              ]);
              if (metaRaw) metadata = JSON.parse(metaRaw);
              thumbUrl = thumbRaw;
            } catch { /* ignore */ }
          }

          const uid = String(u.id);
          for (const entry of mapped) {
            if (entry.userId && String(entry.userId) === uid) {
              entry.isLive = true;
              entry.hlsUrl = hlsUrl;
              if (metadata.title) entry.displayName = metadata.title; // Optional: or use a separate field
              entry.streamTitle = metadata.title || null;
              entry.tags = metadata.tags || [];
              entry.thumbnailUrl = thumbUrl || null;
            }
          }
        }
      } catch (liveErr) {
        logger.warn(`featured: live injection failed (non-fatal): ${liveErr.message}`);
      }
    }

    // Sort: live performers first, then featured, then rest
    mapped.sort((a, b) => {
      if (a.isLive && !b.isLive) return -1;
      if (!a.isLive && b.isLive) return 1;
      if (a.isFeatured && !b.isFeatured) return -1;
      if (!a.isFeatured && b.isFeatured) return 1;
      return 0;
    });

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
        `SELECT cc.*, u.username, u.first_name, u.last_name, u.photo_file_id, u.creator_verified
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

    // Fetch channels + live processes in parallel
    const [countResult, channelsResult, streamsResult] = await Promise.allSettled([
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
      (async () => {
        if (!process.env.RESTREAMER_USER || !process.env.RESTREAMER_PASSWORD) return [];
        try {
          let token = null;
          try {
            const loginResp = await axios.post(`${restreamerUrl}/api/login`, {
              username: process.env.RESTREAMER_USER,
              password: process.env.RESTREAMER_PASSWORD,
            }, { timeout: 5000 });
            token = loginResp.data?.access_token ?? null;
          } catch (loginErr) {
            logger.warn(`channels: Restreamer login failed (non-fatal): ${loginErr.message}`);
          }
          const headers = token ? { Authorization: `Bearer ${token}` } : {};
          const procResp = await axios.get(`${restreamerUrl}/api/v3/process`, { headers, timeout: 8000 });
          return (procResp.data || []).filter(p =>
            p.id?.startsWith('restreamer-ui:ingest:') && p.state?.exec === 'running'
          );
        } catch (e) {
          logger.warn(`channels: Restreamer fetch failed (non-fatal): ${e.message}`);
          return [];
        }
      })(),
    ]);

    const total = countResult.status === 'fulfilled' ? (countResult.value.rows[0]?.total || 0) : 0;
    const rows = channelsResult.status === 'fulfilled' ? (channelsResult.value.rows || []) : [];
    const liveProcesses = streamsResult.status === 'fulfilled' ? (streamsResult.value || []) : [];

    // Build live refs set
    const liveRefs = new Set(
      liveProcesses
        .map(p => (typeof p.reference === 'string' && p.reference) ? p.reference : null)
        .filter(Boolean)
    );

    // Map live channels to user IDs
    let liveUserIds = new Set();
    if (liveRefs.size > 0) {
      try {
        const placeholders = [...liveRefs].map((_, i) => `$${i + 1}`).join(',');
        const { rows: channelUsers } = await getPool().query(
          `SELECT id, live_channel FROM users WHERE live_channel IN (${placeholders})`,
          [...liveRefs]
        );
        for (const u of channelUsers) liveUserIds.add(String(u.id));
      } catch (e) {
        logger.warn(`channels: live user lookup failed (non-fatal): ${e.message}`);
      }
    }

    // Map rows to response
    let channels = rows.map(c => {
      const uid = String(c.id);
      const isLive = liveUserIds.has(uid);
      const safeChannel = typeof c.live_channel === 'string'
        ? c.live_channel.replace(/[^a-zA-Z0-9\-_.]/g, '')
        : null;
      const hlsUrl = isLive && safeChannel && !safeChannel.includes('..')
        ? `${restreamerPublicUrl}/memfs/${safeChannel}.m3u8`
        : null;
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
        isLive,
        hlsUrl,
      };
    });

    // Filter live-only after injection
    if (liveOnly) {
      channels = channels.filter(c => c.isLive);
    }

    // Sort: live first, then preserve original DB order
    channels.sort((a, b) => {
      if (a.isLive && !b.isLive) return -1;
      if (!a.isLive && b.isLive) return 1;
      return 0;
    });

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
  if (!['stripe', 'dash'].includes(provider)) {
    return res.status(400).json({ error: 'Provider must be stripe or dash' });
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
  const scopeMetadata = {
    hangoutGroupId: hangout.id,
    hangoutName: hangout.name,
    ...(email ? { email } : {}),
  };

  // ── Dash branch ───────────────────────────────────────────────────────────
  // Open a BTCPay invoice and stash the hangout scope on the dash order. The
  // BTCPay webhook reads order.metadata and routes through
  // grantEntitlementsForPlan(..., 'dash', metadata) — same code path the
  // ePayco webhook uses for hangout-access grants.
  if (provider === 'dash') {
    try {
      const userId = String(user.telegram_id || user.id);
      const orderId = `pnptv-hangout-${userId}-${hangout.id}-${Date.now()}`;
      const invoice = await createDashInvoice({
        usdAmount: hangoutPrice,
        userId,
        orderId,
        description: 'Community access',
        redirectUrl: `${process.env.WEBAPP_URL || 'https://pnptv.app'}/chat/${hangout.id}`,
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
        return res.status(503).json({ error: 'Crypto payments are not available yet. Please use Card.', code: 'BTCPAY_NOT_CONFIGURED' });
      }
      return res.status(500).json({ error: 'Failed to create Dash invoice. Please try again.', code: 'BTCPAY_ERROR' });
    }
  }

  // ── Stripe branch ─────────────────────────────────────────────────────────
  const PaymentModel = require('../../models/paymentModel');
  const stripeService = require('../../services/stripeService');
  const payment = await PaymentModel.create({
    userId: user.id,
    planId: 'hangout_access',
    provider: 'stripe',
    sku: 'hangout_access',
    amount: hangoutPrice,
    currency: 'USD',
    status: 'pending',
    metadata: {
      type: 'hangout_access',
      payment_type: 'one_time',
      ...scopeMetadata,
    },
  });

  const _hDomain = process.env.CHECKOUT_DOMAIN || 'https://pnptv.app';
  const successUrl = `${_hDomain}/chat/${hangout.id}?stripe_paid=1`;
  const cancelUrl = `${_hDomain}/chat/${hangout.id}`;
  const stripeCheckout = await stripeService.createCustomCheckoutSession({
    userId: String(user.id),
    planId: 'hangout_access',
    sku: 'hangout_access',
    amountUsd: hangoutPrice,
    productName: 'Community Access',
    description: 'One-time membership access',
    successUrl,
    cancelUrl,
    customerEmail: email || user.email || undefined,
    metadata: {
      payment_id: payment.id,
      hangoutGroupId: String(hangout.id),
      hangoutName: hangout.name || '',
    },
  });

  await getPool().query(
    `UPDATE payments
        SET stripe_session_id = $2,
            metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb,
            updated_at = NOW()
      WHERE id = $1`,
    [payment.id, stripeCheckout.sessionId, JSON.stringify({ stripe_session_id: stripeCheckout.sessionId, payment_url: stripeCheckout.url })]
  );

  return res.json({
    success: true,
    paymentId: payment.id,
    paymentUrl: stripeCheckout.url,
    checkoutUrl: stripeCheckout.url,
  });
}));

// Purchase access to a paid channel (and its linked hangout).
// Creates a channel_access payment with channelId + hangoutGroupId in metadata
// so the webhook handler can scope the channel-access entitlement.
app.post('/api/webapp/channels/:channelId/purchase', requireSessionAuth, asyncHandler(async (req, res) => {
  const user = req.session?.user || req.user;
  const channelId = parseInt(req.params.channelId, 10);
  const { provider, email } = req.body || {};

  if (!Number.isFinite(channelId)) {
    return res.status(400).json({ error: 'Invalid channel ID' });
  }
  if (!['stripe', 'dash'].includes(provider)) {
    return res.status(400).json({ error: 'Provider must be stripe or dash' });
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
  const scopeMetadata = {
    channelId: channel.id,
    hangoutGroupId: channel.hangout_group_id,
    channelName: channel.name,
    ...(email ? { email } : {}),
  };

  // ── Dash branch ───────────────────────────────────────────────────────────
  if (provider === 'dash') {
    try {
      const userId = String(user.telegram_id || user.id);
      const discountedChannelPrice = Math.round(channelPrice * 0.95 * 100) / 100;
      const orderId = `pnptv-channel-${userId}-${channel.id}-${Date.now()}`;
      const invoice = await createDashInvoice({
        usdAmount: discountedChannelPrice,
        userId,
        orderId,
        description: `Channel access: ${channel.name}`,
        redirectUrl: `${process.env.WEBAPP_URL || 'https://pnptv.app'}/chat/${channel.hangout_group_id || ''}`,
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
        return res.status(503).json({ error: 'Crypto payments are not available yet. Please use Card.', code: 'BTCPAY_NOT_CONFIGURED' });
      }
      return res.status(500).json({ error: 'Failed to create Dash invoice. Please try again.', code: 'BTCPAY_ERROR' });
    }
  }

  // ── Stripe branch ─────────────────────────────────────────────────────────
  const { CHANNEL_PRICE_MAP } = require('../../config/channelPricing');
  const priceId = CHANNEL_PRICE_MAP[String(channelPrice)];
  if (!priceId) {
    return res.status(400).json({ error: 'No payment option available for this channel price', code: 'UNSUPPORTED_PRICE' });
  }

  const PaymentModel = require('../../models/paymentModel');
  const stripeService = require('../../services/stripeService');
  const payment = await PaymentModel.create({
    userId: user.id,
    planId: 'channel_access',
    provider: 'stripe',
    sku: 'channel_access',
    amount: channelPrice,
    currency: 'USD',
    status: 'pending',
    metadata: {
      type: 'channel_access',
      payment_type: 'one_time',
      ...scopeMetadata,
    },
  });

  const _chDomain = process.env.CHECKOUT_DOMAIN || 'https://pnptv.app';
  const successUrl = `${_chDomain}/chat/${channel.hangout_group_id || ''}?stripe_paid=1`;
  const cancelUrl = `${_chDomain}/chat/${channel.hangout_group_id || ''}`;
  const stripeCheckout = await stripeService.createCheckoutSession({
    userId: String(user.id),
    planId: 'channel_access',
    sku: 'channel_access',
    priceId,
    successUrl,
    cancelUrl,
    customerEmail: email || user.email || undefined,
    metadata: {
      payment_id: payment.id,
      access_type: 'channel_access',
      channelId: String(channel.id),
      hangoutGroupId: channel.hangout_group_id ? String(channel.hangout_group_id) : '',
    },
  });

  await getPool().query(
    `UPDATE payments
        SET stripe_session_id = $2,
            metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb,
            updated_at = NOW()
      WHERE id = $1`,
    [payment.id, stripeCheckout.sessionId, JSON.stringify({ stripe_session_id: stripeCheckout.sessionId, payment_url: stripeCheckout.url })]
  );

  return res.json({
    success: true,
    paymentId: payment.id,
    paymentUrl: stripeCheckout.url,
    checkoutUrl: stripeCheckout.url,
  });
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
      createdAt: ch.created_at,
      creatorName: [ch.first_name, ch.last_name].filter(Boolean).join(' ') || ch.username || 'Creator',
      creatorUsername: ch.username,
      creatorPhotoUrl: photo,
      creatorVerified: ch.creator_verified === true,
      telegramChannelId: ch.telegram_channel_id || null,
      bridgeEnabled: ch.bridge_enabled === true,
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
                status, created_at, directus_file_id
         FROM channel_videos
         WHERE channel_id = $1 AND status = 'published'
         ORDER BY created_at DESC
         LIMIT 100`,
        [channelId]
      );
      const directusBase = (process.env.DIRECTUS_PUBLIC_URL || 'https://cms.pnptv.app').replace(/\/$/, '');
      videos = videosRes.rows.map((cv) => ({
        id: cv.id,
        title: cv.title,
        description: cv.description,
        tags: cv.tags || [],
        duration_sec: cv.duration_sec,
        thumbnail_url: cv.thumbnail_url,
        gif_url: cv.gif_url,
        video_url: cv.video_url || `${directusBase}/assets/${cv.directus_file_id}`,
        status: cv.status,
        created_at: cv.created_at,
      }));
    }

    res.json({ success: true, channel, videos, locked, lockReason });
  } catch (err) {
    logger.error('Channel detail error:', err);
    res.status(500).json({ error: 'Failed to load channel' });
  }
}));

app.get('/api/performers', softAuth, asyncHandler(async (req, res) => {
  // Live status changes frequently — prevent browser from caching stale isLive values.
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  try {
    const restreamerUrl = process.env.RESTREAMER_URL || 'http://restreamer:8080';
    const restreamerPublicUrl = (process.env.RESTREAMER_PUBLIC_URL || 'https://live.pnptv.app').replace(/\/$/, '');

    // Fetch from Directus CMS, active creators in DB, and live Restreamer streams — all in parallel
    const [directusResult, dbResult, streamsResult] = await Promise.allSettled([
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
         ORDER BY first_name ASC
         LIMIT 100`
      ),
      // Fetch live streams from Restreamer (best-effort — failures are non-fatal).
      // Only returns processes that are actively running (state.exec === 'running').
      (async () => {
        if (process.env.RESTREAMER_USER === undefined || process.env.RESTREAMER_PASSWORD === undefined) return [];
        try {
          // Use strict undefined-check: empty-string password is valid and must be sent.
          let token = null;
          try {
            const loginResp = await axios.post(`${restreamerUrl}/api/login`, {
              username: process.env.RESTREAMER_USER,
              password: process.env.RESTREAMER_PASSWORD,
            }, { timeout: 5000 });
            token = loginResp.data?.access_token ?? null;
          } catch (loginErr) {
            logger.warn(`performers: Restreamer login failed (non-fatal): ${loginErr.message}`);
          }
          const headers = token ? { Authorization: `Bearer ${token}` } : {};
          const procResp = await axios.get(`${restreamerUrl}/api/v3/process`, {
            headers,
            timeout: 8000,
          });
          return (procResp.data || []).filter(p =>
            p.id?.startsWith('restreamer-ui:ingest:') && p.state?.exec === 'running'
          );
        } catch (e) {
          logger.warn(`performers: Restreamer fetch failed (non-fatal): ${e.message}`);
          return [];
        }
      })(),
    ]);

    const directusPerformers = directusResult.status === 'fulfilled'
      ? (directusResult.value.data?.data || [])
      : [];
    const dbCreators = dbResult.status === 'fulfilled'
      ? (dbResult.value.rows || [])
      : [];
    const liveProcesses = streamsResult.status === 'fulfilled'
      ? (streamsResult.value || [])
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

    // --- Inject currently-live users ---
    if (liveProcesses.length > 0) {
      try {
        const liveRefs = liveProcesses
          .map(p => (typeof p.reference === 'string' && p.reference) ? p.reference : null)
          .filter(Boolean);

        if (liveRefs.length > 0) {
          const placeholders = liveRefs.map((_, i) => `$${i + 1}`).join(',');
          const { rows: channelUsers } = await getPool().query(
            `SELECT id, username, first_name, last_name, photo_file_id, bio, live_channel
             FROM users
             WHERE live_channel IN (${placeholders})`,
            liveRefs
          );

          const redis = getRedis();
          for (const u of channelUsers) {
            const channelRef = u.live_channel;
            const safeRef = typeof channelRef === 'string'
              ? channelRef.replace(/[^a-zA-Z0-9\-_.]/g, '')
              : null;
            const hlsUrl = safeRef && !safeRef.includes('..')
              ? `${restreamerPublicUrl}/memfs/${safeRef}.m3u8`
              : null;

            // Fetch metadata and thumbnail from Redis
            let metadata = {};
            let thumbUrl = null;
            if (redis && safeRef) {
              try {
                const [metaRaw, thumbRaw] = await Promise.all([
                  redis.get(`stream:meta:${safeRef}`),
                  redis.get(`stream:thumb:${safeRef}`),
                ]);
                if (metaRaw) metadata = JSON.parse(metaRaw);
                thumbUrl = thumbRaw;
              } catch { /* ignore */ }
            }

            const uid = String(u.id);

            if (coveredUserIds.has(uid)) {
              for (const entry of mapped) {
                if (entry.userId && String(entry.userId) === uid) {
                  entry.isLive = true;
                  if (hlsUrl) entry.hlsUrl = hlsUrl;
                  entry.streamTitle = metadata.title || null;
                  entry.tags = metadata.tags || [];
                  entry.thumbnailUrl = thumbUrl || null;
                  break;
                }
              }
            } else {
              const photo = u.photo_file_id
                ? (u.photo_file_id.startsWith('/') ? u.photo_file_id : `/${u.photo_file_id}`)
                : null;
              mapped.push({
                id: `live-${u.id}`,
                userId: u.id,
                slug: u.username || null,
                displayName: [u.first_name, u.last_name].filter(Boolean).join(' ') || u.username || `User ${u.id}`,
                bio: u.bio || null,
                photoUrl: photo,
                isFeatured: false,
                isAvailable: true,
                isLive: true,
                hlsUrl,
                streamTitle: metadata.title || null,
                tags: metadata.tags || [],
                thumbnailUrl: thumbUrl || null,
                basePrice: 0,
                totalCalls: 0,
                averageRating: 0,
              });
              coveredUserIds.add(uid);
            }
          }
        }
      } catch (liveErr) {
        logger.warn(`performers: live-user injection failed (non-fatal): ${liveErr.message}`);
      }
    }

    // Strip HLS stream URLs for unauthenticated users — prevents public access to stream links.
    const isAuthenticated = !!req.user?.id;
    const safePerformers = isAuthenticated
      ? mapped
      : mapped.map(p => { const { hlsUrl, ...rest } = p; return rest; });

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
app.post('/api/proxy/live/tips', requireSessionAuth, requireMemberTier, tipLimiter, asyncHandler(async (req, res) => {
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
      // --- Idempotency check (Fix 4) ---
      // If an idempotencyKey is supplied, check for a matching tip created within the last 5 seconds
      // from the same user to the same performer for the same amount. Return the existing tip if found.
      if (idempotencyKey && typeof idempotencyKey === 'string') {
        try {
          const dupCheck = await getPool().query(
            `SELECT id, amount, created_at FROM pnp_tips
             WHERE user_id = $1
               AND performer_id = $2
               AND amount = $3
               AND payment_method = 'tokens'
               AND created_at > NOW() - INTERVAL '60 seconds'
             ORDER BY created_at DESC
             LIMIT 1`,
            [userId, String(resolvedPerformerId), numAmount]
          );
          if (dupCheck.rows.length > 0) {
            const existing = dupCheck.rows[0];
            logger.info(`Tips: idempotency hit — returning existing tip ${existing.id} for user ${userId}`);
            return res.json({
              success: true,
              tipId: existing.id,
              paymentUrl: null,
              amount: parseFloat(existing.amount),
              paymentMethod: 'tokens',
              duplicate: true,
            });
          }
        } catch (idempErr) {
          // Non-fatal: if the idempotency check errors, proceed with normal creation
          logger.warn(`Tips: idempotency check failed: ${idempErr.message}`);
        }
      }

      // processTipWithTokens atomically debits wallet + inserts tip + emits sockets in one transaction.
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
      });
    }

    // --- Dash direct tip (BTCPay invoice) ---
    if (paymentMethod === 'dash') {
      const { createInvoice: createBtcpayInvoiceForTip } = require('../../config/btcpay');

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
          orderId: `pnptv-tip-${tip.id}-${Date.now()}`,
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
app.get('/api/proxy/live/tips/recent', requireSessionAuth, requireMemberTier, asyncHandler(async (req, res) => {
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
  const wallet = await DashTokenService.getWallet(userId);
  res.json({ success: true, balance: wallet.balance_tokens, dpnsHandle: wallet.dash_dpns || null });
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

// POST /api/wallet/buy-card — compatibility endpoint for token card checkout.
// Card payments now use Stripe Checkout; keep this route so older clients that
// still call "buy-card" continue to work without exposing ePayco again.
app.post('/api/wallet/buy-card', requireSessionAuth, (req, res, next) => {
  res.setHeader('Deprecation', 'true');
  res.setHeader('Link', '</api/wallet/buy-stripe>; rel="successor-version"');
  next();
}, asyncHandler(async (req, res) => {
  const user = req.session?.user;

  const { packageId } = req.body;
  if (!packageId) return res.status(400).json({ success: false, error: 'packageId is required' });

  const userId = String(user.id);

  try {
    const result = await TokenCheckoutService.createStripeCheckout(userId, packageId);
    res.json(result);
  } catch (err) {
    logger.error(`Wallet buy-card error: ${err.message}`);
    if (err.code === 'INVALID_PACKAGE') {
      return res.status(400).json({ success: false, error: 'Invalid package ID' });
    }
    res.status(500).json({ success: false, error: 'Failed to create Stripe checkout. Please try again.' });
  }
}));

// POST /api/wallet/buy-stripe — purchase tokens via Stripe Checkout
app.post('/api/wallet/buy-stripe', requireSessionAuth, asyncHandler(async (req, res) => {
  const user = req.session?.user;
  const { packageId } = req.body;
  if (!packageId) return res.status(400).json({ success: false, error: 'packageId is required' });
  const userId = String(user.id);
  try {
    const result = await TokenCheckoutService.createStripeCheckout(userId, packageId);
    res.json(result);
  } catch (err) {
    logger.error(`Wallet buy-stripe error: ${err.message}`);
    if (err.code === 'INVALID_PACKAGE') return res.status(400).json({ success: false, error: 'Invalid package ID' });
    res.status(500).json({ success: false, error: 'Failed to create Stripe checkout. Please try again.' });
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
            p.stripe_invoice_id,
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
  const invoiceNumber = r.stripe_invoice_id || `INV-${r.id.slice(0, 8).toUpperCase()}`;

  const { buffer } = await InvoiceService.generateInvoice({
    invoiceNumber,
    customerName,
    planName,
    amount: parseFloat(r.amount) || 0,
    currency: r.currency || 'USD',
    provider: r.provider || 'stripe',
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
      'SELECT id, username, first_name, creator_price_usd FROM users WHERE id = $1 AND creator_status = $2',
      [String(creatorId), 'active']
    );
    if (creatorRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Creator not found or not active' });
    }
    const creator = creatorRes.rows[0];
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
    const isLongTerm = plan.is_lifetime || (plan.duration_days || 0) >= 365;
    if (isLongTerm) {
      usdAmount = Math.round(basePrice * 0.80 * 100) / 100;
      discountInfo = { originalAmount: basePrice, discountPct: 20 };
    } else {
      usdAmount = Math.round(basePrice * 0.95 * 100) / 100;
      discountInfo = { originalAmount: basePrice, discountPct: 5 };
    }
    planDisplayName = plan.display_name || plan.name;
  }

  const orderId = `pnptv-sub-${userId}-${Date.now()}`;

  try {
    const invoice = await createDashInvoice({
      usdAmount,
      userId,
      orderId,
      planId,
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
app.get('/api/webapp/payments/lightning/available', asyncHandler(async (req, res) => {
  const { checkLightningHealth } = require('../../config/btcpay');
  const health = await checkLightningHealth();
  return res.json({ available: health.configured && health.reachable, ...health });
}));

// POST /api/webapp/payments/lightning/create — create a BTCPay Lightning invoice for a subscription plan.
app.post('/api/webapp/payments/lightning/create', requireSessionAuth, asyncHandler(async (req, res) => {
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

  let planDisplayName;
  let usdAmount;
  let discountInfo = null;

  if (planId === 'creator_monthly') {
    if (!creatorId) {
      return res.status(400).json({ success: false, error: 'creatorId is required for creator subscriptions' });
    }
    const creatorRes = await dbQuery(
      'SELECT id, username, first_name, creator_price_usd FROM users WHERE id = $1 AND creator_status = $2',
      [String(creatorId), 'active']
    );
    if (creatorRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Creator not found or not active' });
    }
    const creator = creatorRes.rows[0];
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
    const isLongTerm = plan.is_lifetime || (plan.duration_days || 0) >= 365;
    if (isLongTerm) {
      usdAmount = Math.round(basePrice * 0.80 * 100) / 100;
      discountInfo = { originalAmount: basePrice, discountPct: 20 };
    } else {
      usdAmount = Math.round(basePrice * 0.95 * 100) / 100;
      discountInfo = { originalAmount: basePrice, discountPct: 5 };
    }
    planDisplayName = plan.display_name || plan.name;
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

// GET /api/webapp/payments/usdc/available — check if NOWPayments is configured
app.get('/api/webapp/payments/usdc/available', asyncHandler(async (req, res) => {
  const configured = !!(NOWPAYMENTS_API_KEY && process.env.NOWPAYMENTS_PUBLIC_KEY);
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

// POST /api/webapp/payments/usdc/prepare — create DB order record for widget flow (no NOWPayments API call)
app.post('/api/webapp/payments/usdc/prepare', requireSessionAuth, usdcPrepareLimiter, asyncHandler(async (req, res) => {
  if (!NOWPAYMENTS_API_KEY) {
    return res.status(503).json({ success: false, error: 'USDC payments are not configured.', code: 'NOWPAYMENTS_NOT_CONFIGURED' });
  }

  const user = req.session.user;
  const { planId, email, creatorId } = req.body;
  if (!planId) return res.status(400).json({ success: false, error: 'planId is required' });

  const userId = String(user.telegram_id || user.id);
  const { query: dbQuery } = require('../../config/postgres');
  const webappUrl = process.env.WEBAPP_URL || 'https://pnptv.app';

  let planDisplayName;
  let usdAmount;
  let discountInfo = null;

  if (planId === 'creator_monthly') {
    if (!creatorId) return res.status(400).json({ success: false, error: 'creatorId is required for creator subscriptions' });
    if (String(creatorId) === userId) return res.status(400).json({ success: false, error: 'You cannot subscribe to yourself' });
    const creatorRes = await dbQuery(
      'SELECT id, username, first_name, creator_price_usd FROM users WHERE id = $1 AND creator_status = $2',
      [String(creatorId), 'active']
    );
    if (creatorRes.rows.length === 0) return res.status(404).json({ success: false, error: 'Creator not found or not active' });
    const creator = creatorRes.rows[0];
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
    const isLongTerm = plan.is_lifetime || (plan.duration_days || 0) >= 365;
    if (isLongTerm) {
      usdAmount = Math.round(basePrice * 0.80 * 100) / 100;
      discountInfo = { originalAmount: basePrice, discountPct: 20 };
    } else {
      usdAmount = Math.round(basePrice * 0.95 * 100) / 100;
      discountInfo = { originalAmount: basePrice, discountPct: 5 };
    }
    planDisplayName = plan.display_name || plan.name;
  }

  const orderId = `pnptv-nowp-${userId}-${Date.now()}`;
  const ipnCallbackUrl = `${webappUrl}/api/webhooks/nowpayments`;

  // Create a hosted invoice via NOWPayments API — returns an invoice_url the
  // user opens directly. The embedded widget CDN (payment-widget.js) no longer
  // exists, so hosted checkout is the only reliable path.
  let invoiceUrl;
  try {
    const invoiceResp = await axios.post(`${NOWPAYMENTS_URL}/invoice`, {
      price_amount: usdAmount,
      price_currency: 'usd',
      order_id: orderId,
      order_description: `${planDisplayName} – PNPtv!`,
      ipn_callback_url: ipnCallbackUrl,
      success_url: `${webappUrl}/subscribe?nowpayments=success&order=${encodeURIComponent(orderId)}`,
      cancel_url: `${webappUrl}/subscribe`,
      ...(email ? { customer_email: email } : {}),
    }, {
      headers: { 'x-api-key': NOWPAYMENTS_API_KEY, 'Content-Type': 'application/json' },
      timeout: 10000,
    });
    invoiceUrl = invoiceResp.data?.invoice_url;
    if (!invoiceUrl) throw new Error('No invoice_url in response');
  } catch (err) {
    logger.error('[NOWPayments] Invoice creation failed', { userId, planId, orderId, error: err.message });
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
      JSON.stringify({ provider: 'nowpayments', flow: 'hosted', invoiceUrl }),
    ]
  );

  logger.info('[NOWPayments] Invoice created', { userId, planId, orderId, usdAmount, invoiceUrl });

  return res.json({
    success: true,
    orderId,
    usdAmount,
    planName: planDisplayName,
    invoiceUrl,
    ...(discountInfo || {}),
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
  if (!orderId || !/^pnptv-nowp-[A-Za-z0-9_-]+-\d+$/.test(orderId)) {
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

// POST /api/webhooks/nowpayments — NOWPayments IPN webhook
// Processes synchronously so NOWPayments retries on any 5xx (no fire-and-forget).
// Grant runs BEFORE marking completed so a crash leaves the order retryable.
app.post('/api/webhooks/nowpayments', webhookLimiter, express.json(), asyncHandler(async (req, res) => {
  const sig = req.headers['x-nowpayments-sig'];
  if (!validateNowpaymentsIpn(req.body, sig)) {
    logger.warn('[NOWPayments] Invalid IPN signature');
    return res.status(400).json({ error: 'invalid_signature' });
  }

  const { payment_id, payment_status, order_id, actually_paid, price_amount, pay_currency } = req.body;

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
    return res.json({ received: true });
  }

  if (payment_status === 'expired') {
    await dbQuery(
      `UPDATE dash_subscription_orders SET status = 'expired', notes = $2 WHERE btcpay_invoice_id = $1 AND status NOT IN ('completed','failed','expired')`,
      [order_id, `nowpayments:${payment_id}:expired`]
    );
    return res.json({ received: true });
  }

  if (payment_status === 'confirming' || payment_status === 'confirmed' || payment_status === 'sending') {
    const internalStatus = payment_status === 'sending' ? 'confirming' : payment_status;
    await dbQuery(
      `UPDATE dash_subscription_orders SET status = $2 WHERE btcpay_invoice_id = $1 AND status NOT IN ('completed','failed','confirmed',$2)`,
      [order_id, internalStatus]
    );
    return res.json({ received: true });
  }

  if (payment_status === 'waiting') {
    return res.json({ received: true });
  }

  if (payment_status !== 'finished') {
    logger.warn('[NOWPayments] IPN: unknown payment_status', { payment_status, order_id });
    return res.json({ received: true });
  }

  // payment_status === 'finished' — grant entitlements synchronously
  // Respond with 5xx on failure so NOWPayments retries.

  // NP-H-01: atomic processing lock — prevents double-grant on concurrent IPN deliveries
  const lockRes = await dbQuery(
    `UPDATE dash_subscription_orders SET status = 'processing'
     WHERE btcpay_invoice_id = $1 AND status NOT IN ('completed','failed','processing')
     RETURNING id, user_id, plan_id, usd_amount, creator_id`,
    [order_id]
  );

  if (lockRes.rows.length === 0) {
    // Either already completed/failed, or another delivery is processing — idempotent ack
    const existingRes = await dbQuery(
      `SELECT status FROM dash_subscription_orders WHERE btcpay_invoice_id = $1 LIMIT 1`,
      [order_id]
    );
    const existing = existingRes.rows[0];
    if (!existing) {
      logger.error('[NOWPayments] IPN: order not found', { order_id });
      return res.status(404).json({ error: 'order_not_found' });
    }
    logger.info('[NOWPayments] IPN: already processed or in-flight', { order_id, status: existing.status });
    return res.json({ received: true });
  }

  const order = lockRes.rows[0];

  // NP-M-01: amount validation — reject underpayments > 1%
  if (actually_paid != null && price_amount != null) {
    const paid = parseFloat(actually_paid);
    const expected = parseFloat(price_amount);
    if (Number.isFinite(paid) && Number.isFinite(expected) && paid < expected * 0.99) {
      logger.warn('[NOWPayments] IPN: underpayment detected', { order_id, actually_paid, price_amount });
      await dbQuery(
        `UPDATE dash_subscription_orders SET status = 'partially_paid', notes = $2 WHERE btcpay_invoice_id = $1`,
        [order_id, `nowpayments:${payment_id}:underpaid:${actually_paid}/${price_amount}`]
      );
      return res.json({ received: true });
    }
  } else if (order.usd_amount) {
    // IPN fields absent — validate against DB authoritative amount as fallback
    const paid = parseFloat(actually_paid || '0');
    const expected = parseFloat(order.usd_amount);
    if (paid > 0 && Number.isFinite(expected) && paid < expected * 0.99) {
      logger.warn('[NOWPayments] IPN: underpayment (fallback DB check)', { order_id, actually_paid, dbAmount: order.usd_amount });
      await dbQuery(
        `UPDATE dash_subscription_orders SET status = 'partially_paid', notes = $2 WHERE btcpay_invoice_id = $1`,
        [order_id, `nowpayments:${payment_id}:underpaid_fallback:${actually_paid}`]
      );
      return res.json({ received: true });
    }
  }

  // Grant FIRST — if this throws, roll back to pending so NOWPayments retries
  try {
    const PaymentServiceGf = require('../../services/paymentService');
    const grantResult = await PaymentServiceGf.grantEntitlementsForPlan(
      order.user_id,
      order.plan_id,
      'nowpayments',
      order.creator_id ? { creatorId: String(order.creator_id) } : null,
      order_id
    );

    // NP-H-03: zero-grant guard — roll back so NOWPayments retries
    if (!grantResult || grantResult.granted === 0) {
      await dbQuery(
        `UPDATE dash_subscription_orders SET status = 'pending', notes = $2 WHERE btcpay_invoice_id = $1`,
        [order_id, `nowpayments:grant_zero:${order.plan_id}`.slice(0, 500)]
      ).catch(() => {});
      throw new Error(`grantEntitlementsForPlan returned zero grants for plan ${order.plan_id}`);
    }

    // NP-H-02: wire up creator subscription relationship for creator_monthly orders
    if (order.plan_id === 'creator_monthly' && order.creator_id) {
      try {
        const CreatorService = require('../../services/creatorService');
        await CreatorService.subscribeToCreator(order.user_id, String(order.creator_id), order_id);
      } catch (creatorErr) {
        logger.warn('[NOWPayments] IPN: subscribeToCreator failed (non-fatal)', {
          userId: order.user_id, creatorId: order.creator_id, error: creatorErr.message,
        });
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

  // Update users.tier — skip for creator_monthly (must not clobber buyer's own subscription)
  if (order.plan_id !== 'creator_monthly') {
    const PlanModel = require('../../models/planModel');
    const plan = await PlanModel.getById(order.plan_id).catch((err) => {
      logger.error('[NOWPayments] IPN: plan lookup failed, tier not updated', { error: err.message, planId: order.plan_id, order_id });
      return null;
    });
    if (plan) {
      const expiry = plan.duration_days
        ? new Date(Date.now() + plan.duration_days * 86400000).toISOString()
        : null;
      await dbQuery(
        `UPDATE users SET tier = $2, subscription_status = 'active', plan_id = $3, plan_expiry = $4, updated_at = NOW() WHERE id = $1`,
        [order.user_id, plan.tier || 'prime', plan.id, expiry]
      );
    } else {
      logger.error('[NOWPayments] IPN: plan not found, users.tier not updated', { planId: order.plan_id, order_id });
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
    const { query: pgQuery } = require('../../config/postgres');
    const userData = await pgQuery('SELECT email, language, telegram FROM users WHERE id = $1', [order.user_id]);
    const u = userData.rows[0];
    if (u) {
      const PlanModelNP = require('../../models/planModel');
      const planForNotif = await PlanModelNP.getById(order.plan_id).catch(() => null);
      const planName = planForNotif?.display_name || planForNotif?.name || order.plan_id;
      const language = u.language || 'es';
      if (u.telegram) {
        try {
          const PaymentNotificationService = require('../../services/paymentNotificationService');
          await PaymentNotificationService.sendPaymentConfirmation(order.user_id, {
            planId: order.plan_id,
            planName,
            amount: parseFloat(order.usd_amount) || 0,
            currency: 'USD',
            provider: 'nowpayments',
            language,
          });
        } catch (dmErr) {
          logger.warn('[NOWPayments] IPN: Telegram DM failed (non-fatal)', { userId: order.user_id, error: dmErr.message });
        }
      }
      if (u.email) {
        try {
          const InvoiceService = require('../../services/invoiceservice');
          const EmailService = require('../../services/emailservice');
          const { buffer: invoicePdf } = await InvoiceService.generateInvoice({
            invoiceNumber: order_id,
            customerName: u.telegram || order.user_id,
            customerEmail: u.email,
            planName,
            amount: parseFloat(order.usd_amount) || 0,
            currency: 'USD',
            paymentDate: new Date(),
            provider: 'NOWPayments/USDC',
            language,
          });
          await EmailService.sendInvoiceEmail({
            to: u.email,
            invoicePdf,
            invoiceNumber: order_id,
            customerName: u.telegram || order.user_id,
            amount: parseFloat(order.usd_amount) || 0,
            currency: 'USD',
            planName,
          });
        } catch (emailErr) {
          logger.warn('[NOWPayments] IPN: invoice email failed (non-fatal)', { userId: order.user_id, error: emailErr.message });
        }
      }
    }
  } catch (notifErr) {
    logger.warn('[NOWPayments] IPN: notification block failed (non-fatal)', { userId: order.user_id, error: notifErr.message });
  }

  logger.info('[NOWPayments] IPN: payment completed', { userId: order.user_id, planId: order.plan_id, order_id });
  return res.json({ received: true });
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
app.use('/static/stream-thumbs', express.static('/opt/pnptvapp/storage/stream-thumbs', {
  maxAge: '7d',
  dotfiles: 'deny',
}));
app.use('/static/stream-recordings', express.static('/opt/pnptvapp/storage/stream-recordings', {
  maxAge: '7d',
  dotfiles: 'deny',
}));
app.use('/static/stream-snapshots', express.static('/opt/pnptvapp/storage/stream-snapshots', {
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
  const isOwner = ch.creator_id === userId;
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
  const channelVideoUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 4 * 1024 * 1024 * 1024 }, // 4 GB matches PRIME upload
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
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Upload rate limit reached — try again in an hour' },
  });
  // 20 publishes / day / user — guards against feed spam from rapid republish.
  const channelVideoPublishLimiter = rateLimit({
    windowMs: 24 * 60 * 60 * 1000,
    max: 20,
    keyGenerator: (req) => String(req.session?.user?.id || req.ip),
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

  // POST /api/webapp/channels/:channelId/videos — multipart upload
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
        const video = await channelVideoService.uploadVideo({
          channelId, uploaderId: userId, isAdmin,
          file: req.file, title: req.body?.title,
        });
        res.json({ success: true, video });
      } catch (err) {
        handleSvcError(res, err);
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
    asyncHandler(async (_req, res) => {
      res.json({ success: true, tags: channelVideoService.TAG_TAXONOMY });
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

// HIGH-01: Creator: manage own call packages (role-gated via middleware + controller)
app.get('/api/webapp/creator/call-packages',
  requireSessionAuth, roleGuard('model', 'admin', 'superadmin'),
  asyncHandler(callPackageController.listMyPackages));
app.post('/api/webapp/creator/call-packages',
  requireSessionAuth, roleGuard('model', 'admin', 'superadmin'),
  asyncHandler(callPackageController.createMyPackage));
app.put('/api/webapp/creator/call-packages/:packageId',
  requireSessionAuth, roleGuard('model', 'admin', 'superadmin'),
  asyncHandler(callPackageController.updateMyPackage));
app.delete('/api/webapp/creator/call-packages/:packageId',
  requireSessionAuth, roleGuard('model', 'admin', 'superadmin'),
  asyncHandler(callPackageController.deactivateMyPackage));

// ── Book a Call: Checkout, Booking Management & Creator Availability ─────────
const callBookingController = require('./controllers/callBookingController');

app.post('/api/webapp/book-call/checkout',
  requireSessionAuth,
  asyncHandler(callBookingController.createCheckout));

// Dash/BTCPay checkout for call packages
app.post('/api/webapp/book-call/checkout/dash',
  requireSessionAuth,
  asyncHandler(callBookingController.createCheckoutDash));

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

app.get('/api/webapp/creator/availability/schedule',
  requireSessionAuth,
  asyncHandler(callBookingController.getAvailabilitySchedule));

app.post('/api/webapp/creator/availability/schedule',
  requireSessionAuth, roleGuard('model', 'admin', 'superadmin'),
  asyncHandler(callBookingController.saveAvailabilitySchedule));

// BC-C-02: PUT alias for frontend compatibility
app.put('/api/webapp/creator/availability/schedule',
  requireSessionAuth, roleGuard('model', 'admin', 'superadmin'),
  asyncHandler(callBookingController.saveAvailabilitySchedule));

app.put('/api/webapp/creator/online-status',
  requireSessionAuth, roleGuard('model', 'admin', 'superadmin'),
  asyncHandler(callBookingController.setOnlineStatus));

app.get('/api/webapp/creator/call-bookings',
  requireSessionAuth, roleGuard('model', 'admin', 'superadmin'),
  asyncHandler(callBookingController.getMyBookings));

app.get('/api/webapp/creator/call-earnings',
  requireSessionAuth, roleGuard('model', 'admin', 'superadmin'),
  asyncHandler(callBookingController.getCallEarnings));

// Creator: complete a booking (creator-only action)
app.patch('/api/webapp/bookings/:bookingId/complete',
  requireSessionAuth, roleGuard('model', 'admin', 'superadmin'),
  asyncHandler(callBookingController.completeBooking));

// Member or creator: cancel a booking
app.post('/api/webapp/bookings/:bookingId/cancel',
  requireSessionAuth,
  asyncHandler(callBookingController.cancelBooking));

// Creator: get/set next show date
app.get('/api/webapp/creator/next-show-date',
  requireSessionAuth, roleGuard('model', 'admin', 'superadmin'),
  asyncHandler(callBookingController.getNextShowDate));
app.put('/api/webapp/creator/next-show-date',
  requireSessionAuth, roleGuard('model', 'admin', 'superadmin'),
  asyncHandler(callBookingController.setNextShowDate));


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
  if (stageTvProcess) {
    return res.status(409).json({ success: false, error: 'Stage TV is already running' });
  }

  const { videos } = req.body;
  if (!Array.isArray(videos) || videos.length === 0) {
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
// In-app editor for prime_videos (Directus-backed).
// All edits go through Directus API so the existing Directus Flow webhook
// (which fans out to social_posts) fires automatically.
// ==========================================
{
  const directusBaseUrl = () => (process.env.DIRECTUS_URL || process.env.DIRECTUS_INTERNAL_URL || 'http://directus:8055').replace(/\/$/, '');
  const directusHeaders = () => {
    const token = process.env.DIRECTUS_ADMIN_TOKEN;
    if (!token) throw new Error('DIRECTUS_ADMIN_TOKEN not configured');
    return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  };

  // GET /api/webapp/admin/prime-videos — list all prime_videos with poster URLs + share links
  app.get('/api/webapp/admin/prime-videos', adminGuard, asyncHandler(async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const fields = ['id', 'title', 'description', 'status', 'category', 'duration',
                    'is_featured', 'is_explicit', 'tags', 'plays', 'likes',
                    'video_file', 'thumbnail', 'date_created', 'date_updated'].join(',');
    const url = `${directusBaseUrl()}/items/prime_videos?fields=${fields}&limit=${limit}&page=${page}&sort=-date_created&meta=filter_count`;
    try {
      const { data } = await axios.get(url, { headers: directusHeaders(), timeout: 8000 });
      const directusItems = data?.data || [];

      // Look up social_posts for share URL building. directus_id is the prime_videos.id.
      const directusIds = directusItems.map((r) => r.id).filter(Boolean);
      const postMap = new Map();
      if (directusIds.length) {
        const { rows } = await getPool().query(
          `SELECT id, directus_id FROM social_posts
            WHERE channel_id = 5 AND directus_id = ANY($1::int[])`,
          [directusIds]
        );
        for (const r of rows) postMap.set(r.directus_id, r.id);
      }

      const items = directusItems.map((row) => {
        const postId = postMap.get(row.id) || null;
        return {
          ...row,
          social_post_id: postId,
          poster_url: row.video_file ? `https://cms.pnptv.app/video-thumb/${row.video_file}.jpg` : null,
          preview_url: row.video_file ? `https://cms.pnptv.app/video-thumb/${row.video_file}_preview.mp4` : null,
          video_url: row.video_file ? `https://cms.pnptv.app/assets/${row.video_file}` : null,
          // Shareable link with OG preview — pretty slug appended for X cards
          share_url: postId ? `https://pnptv.app/v/${postId}` : null,
        };
      });
      res.json({ success: true, items, total: data?.meta?.filter_count ?? items.length });
    } catch (err) {
      logger.error('admin prime-videos list failed', { error: err.message });
      res.status(502).json({ success: false, error: 'Directus fetch failed' });
    }
  }));

  // PATCH /api/webapp/admin/prime-videos/:id — update title/description/status/is_featured
  app.patch('/api/webapp/admin/prime-videos/:id', adminGuard, asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, error: 'invalid id' });

    const allowed = ['title', 'description', 'status', 'is_featured', 'is_explicit', 'category', 'tags'];
    const patch = {};
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(req.body, key)) patch[key] = req.body[key];
    }
    if (!Object.keys(patch).length) return res.status(400).json({ success: false, error: 'no fields' });

    if (patch.status && !['draft', 'published', 'archived'].includes(patch.status)) {
      return res.status(400).json({ success: false, error: 'bad status' });
    }
    if (typeof patch.title === 'string' && patch.title.length > 255) {
      patch.title = patch.title.slice(0, 255);
    }

    let updated;
    try {
      const { data } = await axios.patch(
        `${directusBaseUrl()}/items/prime_videos/${id}`,
        patch,
        { headers: directusHeaders(), timeout: 8000 }
      );
      updated = data?.data;
    } catch (err) {
      logger.error('admin prime-videos patch failed', { id, error: err.message });
      const status = err.response?.status === 404 ? 404 : 502;
      return res.status(status).json({ success: false, error: err.response?.data?.errors?.[0]?.message || err.message });
    }

    // PRIME_SYNC_SECRET-bypass: mirror relevant fields to social_posts directly so
    // the in-app editor doesn't depend on a Directus Flow webhook being configured.
    try {
      const syncFields = [];
      const syncVals = [id];
      let i = 2;
      if (Object.prototype.hasOwnProperty.call(patch, 'title')) {
        syncFields.push(`video_title = $${i++}`);
        syncVals.push(updated.title);
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'description')) {
        syncFields.push(`video_description = $${i++}`, `content = $${i++}`);
        const content = updated.description && String(updated.description).trim() ? updated.description : updated.title;
        syncVals.push(updated.description || null, content);
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'status')) {
        syncFields.push(`is_deleted = $${i++}`);
        syncVals.push(updated.status !== 'published');
      }
      if (syncFields.length) {
        syncFields.push(`updated_at = NOW()`);
        await getPool().query(
          `UPDATE social_posts SET ${syncFields.join(', ')} WHERE directus_id = $1 AND channel_id = 5`,
          syncVals
        );
      }
    } catch (syncErr) {
      logger.warn('admin prime-videos social_posts mirror failed (non-fatal)', { id, error: syncErr.message });
    }

    res.json({ success: true, item: updated });
  }));

  // POST /api/webapp/admin/prime-videos/:id/generate-description — Grok-powered description
  app.post('/api/webapp/admin/prime-videos/:id/generate-description', adminGuard, asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, error: 'invalid id' });

    let row;
    try {
      const { data } = await axios.get(
        `${directusBaseUrl()}/items/prime_videos/${id}?fields=id,title,duration,tags,category`,
        { headers: directusHeaders(), timeout: 5000 }
      );
      row = data?.data;
    } catch (err) {
      return res.status(502).json({ success: false, error: 'Directus fetch failed' });
    }
    if (!row) return res.status(404).json({ success: false, error: 'not found' });

    const grokService = require('../../services/grokService');
    const tagPart = Array.isArray(row.tags) && row.tags.length ? `Tags: ${row.tags.join(', ')}.` : '';
    const durPart = row.duration ? `Duration: ~${Math.round(row.duration / 60)} minutes.` : '';
    const customHint = (req.body && typeof req.body.hint === 'string' ? req.body.hint.trim() : '').slice(0, 500);
    const hintPart = customHint ? `Additional context from the editor: ${customHint}` : '';
    const prompt = [`Title: "${row.title}".`, durPart, tagPart, hintPart].filter(Boolean).join(' ');

    try {
      const result = await grokService.generateBilingualSafeVideoDescription({ prompt });
      res.json({ success: true, description: result.combined, en: result.en, es: result.es });
    } catch (err) {
      logger.error('grok generate-description failed', { id, error: err.message });
      const isSafetyBlock = /SAFETY_CHECK|usage guidelines/i.test(err.message || '');
      const friendly = isSafetyBlock
        ? "Grok's safety filter blocked this title. Add neutral context (e.g. \"two adult men, gym setting\") in the Context for Grok field and try again, or rename the title to something less explicit."
        : (err.message || 'grok failed');
      res.status(502).json({ success: false, error: friendly });
    }
  }));

  // POST /api/webapp/admin/prime-videos/:id/generate-title — clean marketable title
  app.post('/api/webapp/admin/prime-videos/:id/generate-title', adminGuard, asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, error: 'invalid id' });

    let row;
    try {
      const { data } = await axios.get(
        `${directusBaseUrl()}/items/prime_videos/${id}?fields=id,title,duration,tags,description`,
        { headers: directusHeaders(), timeout: 5000 }
      );
      row = data?.data;
    } catch (err) {
      return res.status(502).json({ success: false, error: 'Directus fetch failed' });
    }
    if (!row) return res.status(404).json({ success: false, error: 'not found' });

    const grokService = require('../../services/grokService');
    const tagPart = Array.isArray(row.tags) && row.tags.length ? `Tags: ${row.tags.join(', ')}.` : '';
    const durPart = row.duration ? `Duration: ~${Math.round(row.duration / 60)} minutes.` : '';
    const descSnippet = row.description ? `Existing description excerpt: ${String(row.description).slice(0, 200)}` : '';
    const customHint = (req.body && typeof req.body.hint === 'string' ? req.body.hint.trim() : '').slice(0, 500);
    const hintPart = customHint ? `Editor context: ${customHint}` : '';
    const prompt = [
      `Current title: "${row.title}".`,
      durPart, tagPart, descSnippet, hintPart,
    ].filter(Boolean).join(' ');

    try {
      const title = await grokService.generateSafeVideoTitle({ prompt });
      res.json({ success: true, title });
    } catch (err) {
      logger.error('grok generate-title failed', { id, error: err.message });
      const isSafetyBlock = /SAFETY_CHECK|usage guidelines/i.test(err.message || '');
      res.status(502).json({
        success: false,
        error: isSafetyBlock
          ? "Grok's safety filter blocked this. Add neutral context in the Context for Grok field."
          : (err.message || 'grok failed'),
      });
    }
  }));

  // POST /api/webapp/admin/prime-videos/:id/suggest-tags — pick 3-5 from the Media.tsx taxonomy
  const PRIME_TAG_TAXONOMY = [
    'slam', 'clouds', 'outdoors', 'group',
    'meth-daddy', 'twink', 'colombian', 'venezuelan',
    'threesome', 'golden-rain',
  ];
  app.post('/api/webapp/admin/prime-videos/:id/suggest-tags', adminGuard, asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, error: 'invalid id' });

    let row;
    try {
      const { data } = await axios.get(
        `${directusBaseUrl()}/items/prime_videos/${id}?fields=id,title,duration,description`,
        { headers: directusHeaders(), timeout: 5000 }
      );
      row = data?.data;
    } catch (err) {
      return res.status(502).json({ success: false, error: 'Directus fetch failed' });
    }
    if (!row) return res.status(404).json({ success: false, error: 'not found' });

    const grokService = require('../../services/grokService');
    const durPart = row.duration ? `Duration: ~${Math.round(row.duration / 60)} minutes.` : '';
    const descSnippet = row.description ? `Description: ${String(row.description).slice(0, 300)}` : '';
    const customHint = (req.body && typeof req.body.hint === 'string' ? req.body.hint.trim() : '').slice(0, 500);
    const hintPart = customHint ? `Editor context: ${customHint}` : '';
    const prompt = [`Title: "${row.title}".`, durPart, descSnippet, hintPart].filter(Boolean).join(' ');

    try {
      const tags = await grokService.suggestSafeTags({ prompt, taxonomy: PRIME_TAG_TAXONOMY });
      res.json({ success: true, tags, taxonomy: PRIME_TAG_TAXONOMY });
    } catch (err) {
      logger.error('grok suggest-tags failed', { id, error: err.message });
      // Fall back to keyword heuristics so the UI still gets something useful
      const t = (row.title + ' ' + (row.description || '') + ' ' + customHint).toLowerCase();
      const fallback = PRIME_TAG_TAXONOMY.filter((tag) => t.includes(tag.replace('-', ' ')) || t.includes(tag));
      res.json({ success: true, tags: fallback.slice(0, 5), taxonomy: PRIME_TAG_TAXONOMY, fallback: true });
    }
  }));

  // POST /api/webapp/admin/prime-videos/upload — multipart video upload
  // Forwards file to Directus, creates prime_videos row, mirrors to social_posts.
  const FormData = require('form-data');
  const primeUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 4 * 1024 * 1024 * 1024 }, // 4 GB
    fileFilter: (req, file, cb) => {
      if (/^video\//i.test(file.mimetype || '')) return cb(null, true);
      cb(new Error('Only video files are allowed'));
    },
  });

  app.post('/api/webapp/admin/prime-videos/upload',
    adminGuard,
    primeUpload.single('file'),
    asyncHandler(async (req, res) => {
      if (!req.file) return res.status(400).json({ success: false, error: 'file required' });

      const titleInput = (req.body?.title || req.file.originalname || 'Untitled').toString().trim();
      const description = req.body?.description ? String(req.body.description).trim() : null;
      const status = ['draft', 'published'].includes(req.body?.status) ? req.body.status : 'published';

      // Step 1 — upload file to Directus
      let fileId;
      try {
        const fd = new FormData();
        fd.append('title', titleInput.slice(0, 255));
        fd.append('file', req.file.buffer, {
          filename: req.file.originalname,
          contentType: req.file.mimetype,
        });
        const { data } = await axios.post(
          `${directusBaseUrl()}/files`,
          fd,
          {
            headers: { ...fd.getHeaders(), Authorization: `Bearer ${process.env.DIRECTUS_ADMIN_TOKEN}` },
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
            timeout: 600000,
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

// Creator-only: add, update, delete, reorder
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

// ── End Main Stage ────────────────────────────────────────────────────────────

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
