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
const FileType = require('file-type');
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

/**
 * DM rate limit for free tier users — uses Redis daily counter
 */
const requireFreeTierDmLimit = async (req, res, next) => {
  const user = req.session?.user;
  if (!user) {
    return res.status(401).json({ success: false, error: 'Authentication required', code: 'AUTH_REQUIRED' });
  }
  // Admin bypass (no DB needed)
  if (isAdminTier(user)) {
    return next();
  }
  // Member/Prime bypass via live entitlement check (not stale session.tier)
  try {
    if (await EntitlementAccessService.hasEntitlement(user.id, 'pnp-member')) {
      return next();
    }
  } catch (err) {
    logger.warn(`requireFreeTierDmLimit entitlement check failed for user ${user.id}: ${err.message}`);
    // Fall through to rate limit (fail closed)
  }
  try {
    const redis = getRedis();
    const today = new Date().toISOString().slice(0, 10);
    const key = `pnptv:dm_limit:${user.id}:${today}`;
    // Determine limit based on account age
    const createdAt = user.created_at || user.createdAt;
    let limit = 3;
    if (createdAt) {
      const daysSince = (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24);
      if (daysSince > 14) limit = 1;
    }
    // Atomic increment — prevents race conditions with parallel requests
    const newCount = await redis.incr(key);
    if (newCount === 1) {
      const now = new Date();
      const midnight = new Date(now);
      midnight.setUTCDate(midnight.getUTCDate() + 1);
      midnight.setUTCHours(0, 0, 0, 0);
      const ttl = Math.ceil((midnight - now) / 1000);
      await redis.expire(key, ttl);
    }
    if (newCount > limit) {
      // Already incremented past limit — decrement back
      await redis.decr(key);
      return res.status(429).json({
        success: false,
        error: 'Daily message limit reached',
        code: 'DM_LIMIT_REACHED',
        limit,
        used: limit,
        remaining: 0,
        upgradeUrl: '/subscribe',
      });
    }
    req.dmLimit = { limit, used: newCount, remaining: limit - newCount };
    return next();
  } catch (err) {
    logger.error('DM limit check error (Redis unavailable — failing closed)', { error: err.message });
    return res.status(503).json({ success: false, error: 'Service temporarily unavailable. Please try again.', code: 'SERVICE_UNAVAILABLE' });
  }
};

// Rate limiter for page routes (landing pages, policies, etc.)
const pageLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 200, // 200 page requests per 15 min — generous for normal browsing
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests from this IP, please try again later.' },
  skip: (req) => req.path === '/pnp/webhook/telegram', // Skip webhook
});

// ── Geo-block middleware — blocks LATAM + Caribbean from the entire site ─────
// Existing active users (last_login_at within 30 days) are grandfathered in.
const LATAM_COUNTRIES = new Set([
  // South America
  'AR', 'BO', 'BR', 'CL', 'CO', 'EC', 'GY', 'PY', 'PE', 'SR', 'UY', 'VE', 'GF',
  // Central America + Mexico
  'BZ', 'CR', 'SV', 'GT', 'HN', 'MX', 'NI', 'PA',
  // Caribbean
  'AG', 'AW', 'BS', 'BB', 'BQ', 'CU', 'CW', 'DM', 'DO', 'GD', 'GP', 'HT',
  'JM', 'KN', 'KY', 'LC', 'MF', 'MQ', 'MS', 'PR', 'BL', 'SX', 'TC', 'TT',
  'VC', 'VG', 'AI',
]);

// Paths exempt from geo-blocking (webhooks, health checks, etc.)
const GEO_EXEMPT_PATHS = ['/pnp/webhook/', '/health', '/api/health', '/api/webapp/auth/', '/auth/oidc/', '/auth/', '/api/auth-status'];

// LATAM "landing mode": non-grandfathered visitors from LATAM are allowed to
// reach the marketing landing page and the become-a-performer flow only.
// Everything else redirects to /landing with a performer-focused CTA.
const LATAM_ALLOWED_EXACT = new Set([
  '/', '/landing', '/join', '/auth',
  '/become-a-model', '/become-model', '/apply', '/creator',
  '/about', '/blog', '/careers', '/resources', '/download',
  '/terms', '/privacy', '/cookies', '/community-guidelines',
  '/content-policy', '/refunds', '/subscriptions', '/creator-terms',
  '/dmca', '/safety', '/contact',
]);

const LATAM_ALLOWED_PREFIXES = [
  '/assets/', '/static/', '/locales/', '/flags/', '/public/',
  '/page/', '/blog/',
  '/auth/', '/api/webapp/auth/', '/api/webapp/geo',
  '/api/auth-status', '/api/logout', '/api/accept-terms',
  '/api/cms/', '/api/webapp/cms/',
  '/api/webapp/creator/apply', '/api/creator/apply',
];

const LATAM_STATIC_ASSET_RE = /\.(js|mjs|css|map|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|eot|json|txt|xml|mp4|webm|mp3)$/i;

async function latamGeoBlock(req, res, next) {
  const ip = req.headers['x-real-ip'] || req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
  const geo = geoip.lookup(ip);
  if (!geo || !LATAM_COUNTRIES.has(geo.country)) return next();

  // Exempt critical paths (webhooks, health, etc.)
  if (GEO_EXEMPT_PATHS.some(p => req.path.startsWith(p))) return next();

  // Check if user is an authenticated, active (last 30 days) grandfathered user
  const userId = req.session?.user?.id;
  if (userId) {
    try {
      const redis = getRedis();
      const cacheKey = `geo:exempt:${userId}`;
      const cached = await redis.get(cacheKey);

      if (cached === '1') return next();       // Cached as exempt
      if (cached === '0') return latamLandingResponse(req, res, next, geo.country); // Cached as non-exempt

      // Cache miss — check DB
      const pool = getPool();
      const { rows } = await pool.query(
        `SELECT last_login_at FROM users WHERE id = $1`, [userId]
      );
      const lastLogin = rows[0]?.last_login_at;
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      if (lastLogin && new Date(lastLogin) >= thirtyDaysAgo) {
        await redis.set(cacheKey, '1', 'EX', 3600); // Cache 1 hour
        return next();
      }
      await redis.set(cacheKey, '0', 'EX', 3600);
    } catch (err) {
      logger.error('[GeoBlock] Error checking exemption:', err.message);
      // On error, fail open for authenticated users to avoid locking out legit users
      return next();
    }
  }

  return latamLandingResponse(req, res, next, geo.country);
}

function latamLandingResponse(req, res, next, countryCode) {
  const p = req.path;

  // Static assets — always allow (CSS, JS, images, fonts, etc.)
  if (LATAM_STATIC_ASSET_RE.test(p)) return next();

  // Exact or prefix-based allowlist for landing + performer flow
  if (LATAM_ALLOWED_EXACT.has(p)) return next();
  if (LATAM_ALLOWED_PREFIXES.some(prefix => p.startsWith(prefix))) return next();

  // Not allowed — API gets 451 JSON, HTML gets redirected to landing
  const isApi = p.startsWith('/api/') || req.headers.accept?.includes('application/json');
  if (isApi) {
    return res.status(451).json({
      error: 'not_available_in_region',
      message: 'PNPtv is not yet fully available in your country. You can still join as a performer.',
      country: countryCode,
      landingUrl: `/landing?country=${countryCode}&focus=performer`,
    });
  }

  return res.redirect(302, `/landing?country=${countryCode}&focus=performer`);
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
// app.use(latamGeoBlock); // LATAM geo-block — DISABLED until further notice

// express-session handles Set-Cookie automatically — no custom middleware needed

// Geo country detection endpoint retained for compatibility.
// Country-based access restrictions are disabled, so access flags always fail open.
app.get('/api/webapp/geo', asyncHandler(async (req, res) => {
  const ip = req.headers['x-real-ip'] || req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
  const geo = geoip.lookup(ip);
  const country = geo?.country || null;
  return res.json({ country, isLatam: false, landingMode: false });
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
      ],
      frameSrc: [
        "'self'",
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
        "https://oauth.telegram.org",
        "https://telegram.org",
        // 8x8.vc removed — video calls use Telegram native
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
    // But allow assets (/videorama/assets/, /hangouts/assets/, /live/assets/)
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

// ==========================================
// Redirect legacy /videorama paths to /app/videorama BEFORE static middleware
// ==========================================
app.get('/videorama', (req, res) => {
  res.redirect(301, '/app/videorama');
});

app.get('/videorama/*', (req, res) => {
  const newPath = req.path.replace('/videorama', '/app/videorama');
  res.redirect(301, newPath);
});

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

// ── CMS asset proxy — LATAM geo-block handled globally via latamGeoBlock ─────
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

// Add cache control headers for static assets to prevent browser caching issues
app.use((req, res, next) => {
  if (req.path.startsWith('/videorama-app/') &&
      (req.path.endsWith('.js') || req.path.endsWith('.css') || req.path.endsWith('.html'))) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
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



// Lifetime Pass landing page
app.get('/lifetime-pass', (req, res) => {
  const host = req.get('host') || '';
  if (host.includes('easybots.store') || host.includes('easybots')) {
    return res.status(404).send('Not found');
  }
  res.redirect(302, '/lifetime-pass.html');
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

// Rate limiter for social post creation (10 posts per 5 minutes, per user)
const socialPostLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => req.session?.user?.id || req.ip,
  handler: (req, res) => res.status(429).json({ error: 'Too many posts. Please wait.' }),
  standardHeaders: true,
  legacyHeaders: false,
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

// Videorama - protected
app.get('/app/videorama', requirePageAuth, (req, res) => {
  res.sendFile(path.join(__dirname, '../../../public/videorama/index.html'));
});

app.get('/app/videorama/*', requirePageAuth, (req, res) => {
  const assetPath = path.join(__dirname, '../../../public/videorama', req.path.replace('/app/videorama', ''));
  if (fs.existsSync(assetPath) && fs.statSync(assetPath).isFile()) {
    return res.sendFile(assetPath);
  }
  res.sendFile(path.join(__dirname, '../../../public/videorama/index.html'));
});

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

// LiveKit webhook — participant_joined, participant_left, room_finished
// express.raw() is required — livekit-server-sdk verifies the raw body signature
app.post(
  '/api/webhooks/livekit',
  webhookLimiter,
  express.raw({ type: 'application/webhook+json' }),
  webhookController.handleLiveKitWebhook
);
app.get('/api/payment-response', webhookController.handlePaymentResponse);

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
// Media Library API (for Videorama)
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

// Get Videorama collections (curated playlists/featured content)
app.get('/api/videorama/collections', asyncHandler(async (req, res) => {
  try {
    // Get featured playlists as collections
    const playlistsResult = await getPool().query(`
      SELECT
        mp.id,
        mp.name as title,
        mp.description,
        mp.cover_url as thumbnail,
        mp.is_public,
        COUNT(pi.id) as item_count,
        'playlist' as type
      FROM media_playlists mp
      LEFT JOIN playlist_items pi ON mp.id = pi.playlist_id
      WHERE mp.is_public = true
      GROUP BY mp.id
      ORDER BY mp.total_likes DESC, mp.created_at DESC
      LIMIT 10
    `);

    // Get category-based collections
    const categoriesResult = await getPool().query(`
      SELECT
        category as id,
        category as title,
        COUNT(*) as item_count,
        'category' as type
      FROM media_library
      WHERE is_public = true AND category IS NOT NULL
      GROUP BY category
      ORDER BY COUNT(*) DESC
    `);

    const collections = [
      ...playlistsResult.rows.map(p => ({
        id: p.id,
        title: p.title,
        description: p.description,
        thumbnail: p.thumbnail,
        itemCount: parseInt(p.item_count) || 0,
        type: 'playlist',
      })),
      ...categoriesResult.rows.map(c => ({
        id: c.id,
        title: c.title.charAt(0).toUpperCase() + c.title.slice(1),
        description: `${c.item_count} items`,
        thumbnail: null,
        itemCount: parseInt(c.item_count) || 0,
        type: 'category',
      })),
    ];

    res.json({ success: true, collections });
  } catch (error) {
    logger.error('Error fetching videorama collections:', error);
    res.json({ success: true, collections: [] });
  }
}));

// Get collection items
app.get('/api/videorama/collections/:collectionId', asyncHandler(async (req, res) => {
  const { collectionId } = req.params;
  const { type } = req.query;

  try {
    let items = [];

    if (type === 'playlist') {
      const result = await getPool().query(`
        SELECT m.*
        FROM playlist_items pi
        JOIN media_library m ON pi.media_id = m.id
        WHERE pi.playlist_id = $1
        ORDER BY pi.position ASC
      `, [collectionId]);
      items = result.rows;
    } else if (type === 'category') {
      const result = await getPool().query(`
        SELECT * FROM media_library
        WHERE category = $1 AND is_public = true
        ORDER BY plays DESC, created_at DESC
        LIMIT 50
      `, [collectionId]);
      items = result.rows;
    }

    res.json({ success: true, items });
  } catch (error) {
    logger.error('Error fetching collection items:', error);
    res.json({ success: true, items: [] });
  }
}));

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

// Request account recovery — delegates to the existing forgot-password handler
app.post('/api/webapp/auth/recover-account', authLimiter, asyncHandler(async (req, res) => {
  // Reuse the existing forgot-password flow (sends real SMTP email with reset link)
  req.body.email = req.body.email || '';
  return webAppController.forgotPassword(req, res);
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
  const returnTo = typeof req.query.return_to === 'string' && /^\/[a-z0-9/_-]*/i.test(req.query.return_to)
    ? req.query.return_to
    : '/';
  const pkceKey = `oidc:pkce:${state}`;
  await redis.set(pkceKey, JSON.stringify({ codeVerifier, returnTo }), 'EX', 600);

  // Build Authentik authorization URL (PKCE S256, no client_secret in URL)
  let authUrl;
  try {
    authUrl = AuthentikService.generateAuthUrl(state, codeVerifier);
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

  // ── 1. Guard: error from Authentik ──────────────────────────────────────────
  if (req.query.error) {
    // Never reflect error_description from the auth server to the browser
    logger.warn('[OIDC] Callback received error from Authentik', {
      error: req.query.error,
      description: req.query.error_description, // logged server-side only
    });
    const safeErrors = new Set(['access_denied', 'server_error', 'temporarily_unavailable']);
    const safeCode = safeErrors.has(req.query.error) ? req.query.error : 'login_failed';
    return res.redirect(`${APP_URL}?oidc_error=${safeCode}`);
  }

  const { code, state } = req.query;
  if (!code || !state || typeof code !== 'string' || typeof state !== 'string') {
    logger.warn('[OIDC] Callback missing code or state params');
    return res.redirect(`${APP_URL}?oidc_error=invalid_callback`);
  }

  // ── 2. Consume PKCE state from Redis (single-use) ───────────────────────────
  const redis = getRedis();
  const pkceKey = `oidc:pkce:${state}`;
  const pkceRaw = await redis.get(pkceKey);

  if (!pkceRaw) {
    logger.warn('[OIDC] PKCE state not found or expired', { state: state.slice(0, 8) + '...' });
    return res.redirect(`${APP_URL}?oidc_error=state_mismatch`);
  }

  // Delete immediately — single-use token prevents replay attacks
  await redis.del(pkceKey);

  let pkceData;
  try {
    pkceData = JSON.parse(pkceRaw);
  } catch {
    logger.error('[OIDC] PKCE Redis value is not valid JSON');
    return res.redirect(`${APP_URL}?oidc_error=state_mismatch`);
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
    return res.redirect(`${APP_URL}?oidc_error=${errorCode}`);
  }

  const { refreshToken, userInfo } = tokens;
  const { sub, email, name, preferred_username, picture, email_verified } = userInfo;

  if (!sub) {
    logger.error('[OIDC] userInfo missing sub claim — cannot link account');
    return res.redirect(`${APP_URL}?oidc_error=invalid_userinfo`);
  }

  logger.info('[OIDC] Callback successful', {
    sub,
    username: preferred_username,
    email: email ? email.replace(/(.{2}).*@/, '$1***@') : null,
  });

  // ── 4. Upsert PNPtv user — link via pnptv_id (stable across renames) ───
  const pool = getPool();

  // Try to find existing user by pnptv_id first (most reliable identity anchor)
  // Fall back to email match so existing email-registered users get linked on first OIDC login
  let userRow;

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

  if (!userRow) {
    // No existing user — create a new PNPtv account linked to this Authentik identity
    const baseUsername = (preferred_username || (email ? email.split('@')[0] : null) || `user_${crypto.randomBytes(4).toString('hex')}`)
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '')
      .slice(0, 30);

    // Ensure username uniqueness by appending a random hex suffix if needed
    let finalUsername = baseUsername || `user_${crypto.randomBytes(4).toString('hex')}`;
    const usernameCheck = await pool.query(
      'SELECT 1 FROM users WHERE username = $1 LIMIT 1',
      [finalUsername]
    );
    if (usernameCheck.rows.length > 0) {
      finalUsername = `${finalUsername}_${crypto.randomBytes(3).toString('hex')}`;
    }

    const newUserId = crypto.randomUUID();
    const newPnptvId = crypto.randomUUID();
    const insertResult = await pool.query(
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
        sub,  // pnptv_id = Authentik sub (source of truth)
        finalUsername,
        name || preferred_username || finalUsername,
        email ? email.toLowerCase() : null,
        email_verified === true,
        picture || null,
      ]
    );
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

  // Redirect to the app (return_to must start with / to prevent open redirect)
  const safeReturnTo = typeof returnTo === 'string' && /^\/[a-z0-9/_-]*/i.test(returnTo) ? returnTo : '/';
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
    const EmailService = require('../../services/emailservice');
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

// Ticketed live shows — ticket status + purchase
app.get('/api/webapp/live/slot/:id/ticket-status', requireSessionAuth, asyncHandler(webappLiveController.getSlotTicketStatus));
app.post('/api/webapp/live/slot/:id/buy-ticket', requireSessionAuth, asyncHandler(webappLiveController.buySlotTicket));

// Stream analytics — creator only
const creatorGuard = require('./middleware/creatorGuard');
app.get('/api/webapp/live/analytics/sessions', requireSessionAuth, creatorGuard, asyncHandler(webappLiveController.getAnalyticsSessions));
app.get('/api/webapp/live/analytics/summary', requireSessionAuth, creatorGuard, asyncHandler(webappLiveController.getAnalyticsSummary));

// Creator revenue aggregation (tips + tickets + subs + calls)
app.get('/api/webapp/creator/revenue', requireSessionAuth, asyncHandler(webappLiveController.getCreatorRevenue));

// Manual going-live broadcast to followers
app.post('/api/webapp/live/broadcast-live-now', requireSessionAuth, asyncHandler(webappLiveController.broadcastLiveNow));

// VOD replay recordings
app.get('/api/webapp/creators/:creatorId/recordings', softAuth, asyncHandler(webappLiveController.listCreatorRecordings));
app.delete('/api/webapp/recordings/:id', requireSessionAuth, asyncHandler(webappLiveController.deleteRecordingEndpoint));
app.patch('/api/webapp/recordings/:id', requireSessionAuth, asyncHandler(webappLiveController.updateRecordingEndpoint));

// Streamer Settings: persistent encoder + filter preferences
const streamerSettingsController = require('./controllers/streamerSettingsController');
app.get('/api/webapp/live/settings', requireSessionAuth, asyncHandler(streamerSettingsController.getSettings));
app.put('/api/webapp/live/settings', requireSessionAuth, asyncHandler(streamerSettingsController.updateSettings));
// Gap 2: Persistent thumbnail upload
app.post('/api/webapp/live/thumbnail', requireSessionAuth, asyncHandler(streamerSettingsController.uploadThumbnail));
app.post('/api/webapp/live/snapshot', requireSessionAuth, asyncHandler(webappLiveController.uploadSnapshot));

// Gap 1: Past-session earnings history for studio panel
app.get('/api/webapp/live/earnings', requireSessionAuth, asyncHandler(webappLiveController.getEarningsHistory));

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
  if (provider && !['epayco'].includes(provider)) {
    return res.status(400).json({ success: false, error: 'Invalid provider. Must be epayco' });
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
  const resolvedProvider = provider || 'epayco';

  // Promo path — delegate to PromoService.initiatePromoPayment so spot claim,
  // eligibility, and discount pricing go through the canonical flow used by
  // the bot. This is the only place user-submitted promo codes get applied.
  let result;
  if (promoCode) {
    const PromoService = require('../../services/promoService');
    result = await PromoService.initiatePromoPayment(
      promoCode.trim(),
      userId,
      resolvedProvider,
      user.telegramId || user.telegram_id || null,
      planId,
    );
    if (!result.success) {
      const status = ({
        not_found: 404, expired: 410, sold_out: 409, inactive: 410,
        already_redeemed: 409, not_churned: 403, not_new_user: 403,
        not_free_user: 403, user_not_found: 404, missing_plan: 400,
        plan_not_found: 404, promo_not_valid: 410,
      })[result.error] || 400;
      return res.status(status).json(result);
    }
  } else {
    result = await PaymentService.createPayment({
      userId,
      planId,
      provider: resolvedProvider,
      chatId: user.telegramId || user.telegram_id || null,
      creatorId: creatorId || null,
    });
  }

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

  res.json(result);
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
app.get('/api/videorama/latest', asyncHandler(primeController.getLatestVideoramaVideo));
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
app.post('/api/webapp/hangouts/groups/:id/kick', requireSessionAuth, asyncHandler(hangoutGroupController.kickMember));
app.post('/api/webapp/hangouts/groups/:id/members/:userId/role', requireSessionAuth, asyncHandler(hangoutGroupController.updateMemberRole));
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
app.post('/api/webapp/hangouts/groups/:id/ban', requireSessionAuth, asyncHandler(hangoutGroupController.banMember));
app.post('/api/webapp/hangouts/groups/:id/unban', requireSessionAuth, asyncHandler(hangoutGroupController.unbanMember));
app.post('/api/webapp/hangouts/groups/:id/mute', requireSessionAuth, asyncHandler(hangoutGroupController.muteMember));
app.post('/api/webapp/hangouts/groups/:id/unmute', requireSessionAuth, asyncHandler(hangoutGroupController.unmuteMember));
app.post('/api/webapp/hangouts/groups/:id/promote', requireSessionAuth, asyncHandler(hangoutGroupController.promoteMember));
app.post('/api/webapp/hangouts/groups/:id/demote', requireSessionAuth, asyncHandler(hangoutGroupController.demoteMember));
app.get('/api/webapp/hangouts/groups/:id/moderation/audit', requireSessionAuth, asyncHandler(hangoutGroupController.getModerationAudit));
app.post('/api/webapp/hangouts/groups/:id/pin', requireSessionAuth, asyncHandler(hangoutGroupController.pinMessage));
app.delete('/api/webapp/hangouts/groups/:id/pin/:eventId', requireSessionAuth, asyncHandler(hangoutGroupController.unpinMessage));
app.get('/api/webapp/hangouts/groups/:id/pins', requireSessionAuth, asyncHandler(hangoutGroupController.getPinnedMessages));
app.put('/api/webapp/hangouts/groups/:id/settings', requireSessionAuth, asyncHandler(hangoutGroupController.updateGroupSettings));
app.post('/api/webapp/hangouts/groups/:id/transfer', requireSessionAuth, asyncHandler(hangoutGroupController.transferOwnership));
app.get('/api/webapp/hangouts/groups/:id/invite-link', requireSessionAuth, asyncHandler(hangoutGroupController.getInviteLink));
app.put('/api/webapp/hangouts/groups/:id/notification', requireSessionAuth, asyncHandler(hangoutGroupController.updateNotificationMode));
app.post('/api/webapp/hangouts/groups/:id/delete-message', requireSessionAuth, asyncHandler(hangoutGroupController.adminDeleteMessage));
// ── Hangout Feed Integration ────────────────────────────────────────────────
app.get('/api/webapp/hangouts/groups/:id/feed', requireSessionAuth, asyncHandler(socialController.getHangoutFeed));
app.post('/api/webapp/hangouts/groups/:id/drop-to-feed', requireSessionAuth, asyncHandler(socialController.dropToFeed));

// Hangout video calls — LiveKit
const { startCall, joinCall, endCall, leaveCall } = require('./controllers/hangoutGroupController');
app.post('/api/webapp/hangouts/groups/:id/call/start', requireSessionAuth, asyncHandler(startCall));
app.post('/api/webapp/hangouts/groups/:id/call/join', requireSessionAuth, asyncHandler(joinCall));
app.post('/api/webapp/hangouts/groups/:id/call/end', requireSessionAuth, asyncHandler(endCall));
app.post('/api/webapp/hangouts/groups/:id/call/leave', requireSessionAuth, asyncHandler(leaveCall));

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
  const { exec } = require('child_process');
  const scriptPath = require('path').join(__dirname, '../../../scripts/cristinaNeighborDM.js');
  exec(`node ${scriptPath}`, (err, stdout, stderr) => {
    if (err) logger.error('cristinaNeighborDM script error', { err: err.message });
  });
  return res.json({ success: true, message: 'Cristina neighbor DM campaign started in background' });
}));

// Admin: revoke unused free trials
app.post('/api/webapp/admin/trials/revoke-unused', adminGuard, asyncHandler(async (req, res) => {
  const lockKey = 'admin:script:lock:revoke-trials';
  const locked = await redisClient.set(lockKey, '1', 'EX', 300, 'NX');
  if (!locked) return res.status(409).json({ error: 'Script already running. Try again later.' });
  const dryRun = req.query.dry_run === '1';
  const { exec } = require('child_process');
  const scriptPath = require('path').join(__dirname, '../../../scripts/revokeUnusedTrials.js');
  const args = dryRun ? '--dry-run' : '';
  exec(`node ${scriptPath} ${args}`, (err, stdout, stderr) => {
    if (err) logger.error('revokeUnusedTrials script error', { err: err.message });
    logger.info('revokeUnusedTrials output', { stdout, stderr });
  });
  return res.json({ success: true, message: `Trial revocation started${dryRun ? ' (dry run)' : ''}` });
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
app.post('/api/webapp/social/posts', requireSessionAuth, socialPostLimiter, asyncHandler(socialController.createPost));
app.post('/api/webapp/social/posts/with-media', requireSessionAuth, socialPostLimiter, uploadLimiter, attachCreatorStatus, postMediaUploadMiddleware, asyncHandler(socialController.createPostWithMedia));
app.post('/api/webapp/social/posts/with-multi-media', requireSessionAuth, socialPostLimiter, uploadLimiter, attachCreatorStatus, postMultiMediaUploadMiddleware, asyncHandler(socialController.createPostWithMultiMedia));
app.post('/api/webapp/social/posts/bulk-videos', requireSessionAuth, bulkVideoLimiter, uploadPerformerVideos, asyncHandler(socialController.bulkCreateVideos));
app.post('/api/webapp/social/posts/:postId/like', requireSessionAuth, socialActionLimiter, asyncHandler(socialController.toggleLike));
app.delete('/api/webapp/social/posts/:postId', requireSessionAuth, asyncHandler(socialController.deletePost));
app.patch('/api/webapp/social/posts/:postId', requireSessionAuth, asyncHandler(socialController.editPost));
app.post('/api/webapp/social/posts/:postId/assign-channel', requireSessionAuth, asyncHandler(socialController.assignPostToChannel));
app.delete('/api/webapp/social/posts/:postId/assign-channel', requireSessionAuth, asyncHandler(socialController.unassignPostFromChannel));
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
         ORDER BY cc.post_count DESC, cc.created_at DESC
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
          postCount: ch.post_count,
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
  if (!['epayco', 'dash'].includes(provider)) {
    return res.status(400).json({ error: 'Provider must be epayco or dash' });
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
        description: `Hangout access: ${hangout.name}`,
        redirectUrl: `${process.env.WEBAPP_URL || 'https://pnptv.app'}/chat/${hangout.id}`,
      });
      const insertRes = await getPool().query(
        `INSERT INTO dash_subscription_orders
           (user_id, plan_id, email, usd_amount, btcpay_invoice_id, status, metadata)
         VALUES ($1, 'hangout_access', $2, $3, $4, 'pending', $5)
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

  // ── ePayco branch (unchanged) ─────────────────────────────────────────────
  // Create a hangout_access payment with the actual hangout price and scope
  // metadata atomically at insert time — no follow-up UPDATE, no TOCTOU window
  // where a webhook could race and see an unscoped unpriced payment.
  const PaymentService = require('../../services/paymentService');
  const payment = await PaymentService.createPayment({
    userId: user.id,
    planId: 'hangout_access',
    provider,
    amountOverride: hangoutPrice,
    extraMetadata: scopeMetadata,
  });

  return res.json({
    success: true,
    paymentId: payment.id,
    paymentUrl: payment.paymentUrl || `/payment/${payment.id}`,
    checkoutUrl: payment.checkoutUrl || `/checkout/${payment.id}`,
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
  if (!['epayco', 'dash'].includes(provider)) {
    return res.status(400).json({ error: 'Provider must be epayco or dash' });
  }

  const { rows: channels } = await getPool().query(
    'SELECT id, creator_id, access_type, price_usd, hangout_group_id, name FROM creator_channels WHERE id = $1 AND is_active = true',
    [channelId]
  );
  if (channels.length === 0) return res.status(404).json({ error: 'Channel not found' });
  const channel = channels[0];

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
      const orderId = `pnptv-channel-${userId}-${channel.id}-${Date.now()}`;
      const invoice = await createDashInvoice({
        usdAmount: channelPrice,
        userId,
        orderId,
        description: `Channel access: ${channel.name}`,
        redirectUrl: `${process.env.WEBAPP_URL || 'https://pnptv.app'}/chat/${channel.hangout_group_id || ''}`,
      });
      const insertRes = await getPool().query(
        `INSERT INTO dash_subscription_orders
           (user_id, plan_id, email, usd_amount, btcpay_invoice_id, status, metadata)
         VALUES ($1, 'channel_access', $2, $3, $4, 'pending', $5)
         RETURNING id`,
        [userId, email || null, channelPrice, invoice.invoiceId, JSON.stringify(scopeMetadata)]
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

  // ── ePayco branch (unchanged) ─────────────────────────────────────────────
  // Create a channel_access payment. creatorId is overloaded to carry the
  // channel id so createPayment's dynamic-price branch looks up
  // creator_channels.price_usd. Scope metadata is stamped atomically via
  // extraMetadata — no follow-up UPDATE, no TOCTOU window.
  const PaymentService = require('../../services/paymentService');
  const payment = await PaymentService.createPayment({
    userId: user.id,
    planId: 'channel_access',
    provider,
    creatorId: String(channel.id),
    extraMetadata: scopeMetadata,
  });

  return res.json({
    success: true,
    paymentId: payment.id,
    paymentUrl: payment.paymentUrl || `/payment/${payment.id}`,
    checkoutUrl: payment.checkoutUrl || `/checkout/${payment.id}`,
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

    // Check premium access
    let locked = false;
    if (ch.is_premium) {
      if (!viewerId || !isOwner) {
        if (viewerId) {
          const subRes = await getPool().query(
            `SELECT id FROM creator_subscriptions WHERE creator_id = $1 AND subscriber_id = $2 AND expires_at > NOW()`,
            [ch.creator_id, viewerId]
          );
          if (!subRes.rows.length) locked = true;
        } else {
          locked = true;
        }
      }
    }

    // Fetch posts (if not locked)
    let posts = [];
    if (!locked) {
      const postsRes = await getPool().query(
        `SELECT sp.id, sp.content, sp.media_url, sp.media_type, sp.media_urls,
                sp.video_thumbnail_url, sp.likes_count, sp.replies_count, sp.created_at,
                sp.user_id AS author_id,
                u.username AS author_username, u.first_name AS author_first_name, u.photo_file_id AS author_photo
         FROM social_posts sp
         JOIN users u ON sp.user_id = u.id
         WHERE sp.channel_id = $1 AND sp.is_deleted = false
         ORDER BY sp.id DESC
         LIMIT 50`,
        [channelId]
      );
      posts = postsRes.rows;
    }

    res.json({ success: true, channel, posts, locked });
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
               AND created_at > NOW() - INTERVAL '5 seconds'
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
      const { createDashInvoice } = require('../../config/btcpay');

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

      // Create BTCPay invoice with tip metadata
      const inv = await createDashInvoice({
        amount: numAmount,
        currency: 'USD',
        metadata: {
          type: 'tip',
          tipId: tip.id,
          userId,
          performerId: String(resolvedPerformerId),
        },
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
        checkoutUrl: inv.checkoutUrl,
        paymentUrl: null,
        amount: numAmount,
        paymentMethod: 'dash',
      });
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
app.get('/api/wallet/balance', asyncHandler(async (req, res) => {
  const user = req.session?.user;
  if (!user) return res.status(401).json({ success: false, error: 'Authentication required' });
  const userId = String(user.telegram_id || user.id);
  const wallet = await DashTokenService.getWallet(userId);
  res.json({ success: true, balance: wallet.balance_tokens, dpnsHandle: wallet.dash_dpns || null });
}));

// GET /api/wallet/packages — available token packages
app.get('/api/wallet/packages', (req, res) => {
  res.json({ success: true, packages: DashTokenService.TOKEN_PACKAGES });
});

// GET /api/wallet/history — purchase history
app.get('/api/wallet/history', asyncHandler(async (req, res) => {
  const user = req.session?.user;
  if (!user) return res.status(401).json({ success: false, error: 'Authentication required' });
  const userId = String(user.telegram_id || user.id);
  const history = await DashTokenService.getPurchaseHistory(userId, 20);
  res.json({ success: true, history });
}));

const TokenCheckoutService = require('../../services/tokenCheckoutService');

// POST /api/wallet/buy — create a BTCPay Dash invoice for token purchase
app.post('/api/wallet/buy', asyncHandler(async (req, res) => {
  const user = req.session?.user;
  if (!user) return res.status(401).json({ success: false, error: 'Authentication required' });

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

// POST /api/wallet/buy-card — purchase tokens via ePayco card checkout
app.post('/api/wallet/buy-card', asyncHandler(async (req, res) => {
  const user = req.session?.user;
  if (!user) return res.status(401).json({ success: false, error: 'Authentication required' });

  const { packageId } = req.body;
  if (!packageId) return res.status(400).json({ success: false, error: 'packageId is required' });

  const userId = String(user.telegram_id || user.id);

  try {
    const result = await TokenCheckoutService.createCardCheckout(userId, packageId);
    res.json(result);
  } catch (err) {
    logger.error(`Wallet buy-card error: ${err.message}`);
    if (err.code === 'INVALID_PACKAGE') {
      return res.status(400).json({ success: false, error: 'Invalid package ID' });
    }
    res.status(500).json({ success: false, error: 'Failed to create card checkout. Please try again.' });
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
    logger.error(`Token checkout data error: ${err.message}`, { purchaseId });
    res.status(500).json({ success: false, error: 'Failed to load checkout data. Please try again.' });
  }
}));

// GET /token-checkout/:purchaseId — redirect to the React SPA token-checkout
// page. The React version handles ePayco only.
app.get('/token-checkout/:purchaseId', (req, res) => {
  const purchaseId = encodeURIComponent(req.params.purchaseId);
  const qs = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
  res.redirect(302, `https://app.pnptv.app/token-checkout/${purchaseId}${qs}`);
});

// POST /api/wallet/link-dpns — link a Dash DPNS handle
app.post('/api/wallet/link-dpns', asyncHandler(async (req, res) => {
  const user = req.session?.user;
  if (!user) return res.status(401).json({ success: false, error: 'Authentication required' });

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

// GET /api/webapp/payments/dash/available — check if Dash/BTCPay is configured & reachable
app.get('/api/webapp/payments/dash/available', requireSessionAuth, asyncHandler(async (req, res) => {
  const { checkBtcpayHealth } = require('../../config/btcpay');
  const health = await checkBtcpayHealth();
  return res.json({ available: health.configured && health.reachable, ...health });
}));

// POST /api/webapp/payments/dash/create — create a BTCPay Dash invoice for a subscription plan.
// When planId === 'creator_monthly' AND creatorId is provided, the price is looked up
// dynamically from users.creator_price_usd (mirrors paymentService.createPayment) and the
// order carries creator_id so the webhook can credit the right creator with a 70/30 split.
app.post('/api/webapp/payments/dash/create', requireSessionAuth, asyncHandler(async (req, res) => {
  const user = req.session.user;

  const { planId, email, creatorId } = req.body;
  if (!planId) return res.status(400).json({ success: false, error: 'planId is required' });

  const userId = String(user.telegram_id || user.id);
  const { query: dbQuery } = require('../../config/postgres');

  let planDisplayName;
  let usdAmount;

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
    planDisplayName = `Creator subscription: ${creator.username || creator.first_name || 'creator'}`;
  } else {
    const PlanModel = require('../../models/planModel');
    const plan = await PlanModel.getById(planId);
    if (!plan) return res.status(404).json({ success: false, error: 'Plan not found' });
    usdAmount = parseFloat(plan.price);
    planDisplayName = plan.display_name || plan.name;
  }

  const orderId = `pnptv-sub-${userId}-${Date.now()}`;

  try {
    const invoice = await createDashInvoice({
      usdAmount,
      userId,
      orderId,
      description: `PNPtv ${planDisplayName} subscription`,
      redirectUrl: `${process.env.WEBAPP_URL || 'https://pnptv.app'}/subscribe`,
    });

    await dbQuery(
      `INSERT INTO dash_subscription_orders (user_id, plan_id, email, usd_amount, btcpay_invoice_id, status, creator_id)
       VALUES ($1, $2, $3, $4, $5, 'pending', $6)`,
      [userId, planId, email || null, usdAmount, invoice.invoiceId, creatorId ? String(creatorId) : null]
    );

    return res.json({
      success: true,
      invoiceId: invoice.invoiceId,
      checkoutUrl: invoice.checkoutUrl,
      planName: planDisplayName,
      usdAmount,
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

// GET /api/webapp/payments/dash/status/:invoiceId — poll invoice status
app.get('/api/webapp/payments/dash/status/:invoiceId', asyncHandler(async (req, res) => {
  const user = req.session?.user;
  if (!user) return res.status(401).json({ success: false, error: 'Authentication required' });

  const { invoiceId } = req.params;
  const { query: dbQuery } = require('../../config/postgres');
  const result = await dbQuery(
    `SELECT status FROM dash_subscription_orders WHERE btcpay_invoice_id = $1 AND user_id = $2`,
    [invoiceId, String(user.telegram_id || user.id)]
  );

  if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'Order not found' });
  return res.json({ success: true, status: result.rows[0].status });
}));

// GET /api/webapp/payments/dash/details/:invoiceId — fetch Dash payment address + amount for a pending invoice
app.get('/api/webapp/payments/dash/details/:invoiceId', requireSessionAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const { invoiceId } = req.params;

    if (!invoiceId) {
      return res.status(400).json({ success: false, error: 'Missing invoiceId' });
    }

    // Verify ownership — check both subscription orders and token purchases
    const ownerCheck = await pool.query(
      `SELECT user_id FROM dash_subscription_orders WHERE btcpay_invoice_id = $1 AND user_id = $2
       UNION ALL
       SELECT user_id FROM token_purchases WHERE btcpay_invoice_id = $1 AND user_id = $2
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
    console.error('[Dash] Failed to get payment details:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch payment details' });
  }
});

// POST /api/webhooks/btcpay — BTCPay Server webhook (Dash payment confirmed)
app.post('/api/webhooks/btcpay', webhookLimiter, asyncHandler(async (req, res) => {
    const signature = req.headers['btcpay-sig'];
    // Require rawBody captured by express.json verify callback — fallback silently breaks HMAC
    if (!req.rawBody) {
      logger.error('BTCPay webhook rejected: rawBody missing — express.json verify callback not firing', { ip: req.ip });
      return res.status(400).json({ success: false, error: 'Raw body unavailable' });
    }
    const rawBody = req.rawBody.toString('utf8');

    if (!validateWebhookSignature(rawBody, signature)) {
      logger.warn('BTCPay webhook rejected: invalid signature', { ip: req.ip });
      return res.status(401).json({ success: false, error: 'Invalid signature' });
    }

    let event;
    try {
      event = JSON.parse(rawBody);
    } catch {
      return res.status(400).json({ success: false, error: 'Invalid JSON' });
    }

    // ── Pull-Payment / Payout events (creator outbound payouts in Dash) ──────
    // These events do NOT carry invoiceId — they carry payoutId + pullPaymentId.
    // We act only on the terminal Completed/Cancelled events.
    if (event.type === 'PayoutCompleted' || event.type === 'PayoutCancelled') {
      const pullPaymentId = event.pullPaymentId;
      if (!pullPaymentId) {
        logger.warn('BTCPay payout webhook missing pullPaymentId', { type: event.type, payoutId: event.payoutId });
        return res.status(400).json({ success: false, error: 'Missing pullPaymentId' });
      }
      try {
        const CreatorPayoutService = require('../../services/creatorPayoutService');
        if (event.type === 'PayoutCompleted') {
          const result = await CreatorPayoutService.settleDashPullPayment(pullPaymentId, {
            txHash: event.proofOfPayment?.txId || event.txId || null,
            payoutId: event.payoutId || null,
          });
          return res.json({ success: true, type: 'payout_completed', ...result });
        }
        // PayoutCancelled: release the earnings back to 'available' so the next
        // monthly run can re-attempt with whatever payout method the creator has now.
        const { rows } = await query(
          `UPDATE creator_payouts SET status = 'cancelled', notes = COALESCE(notes,'') || ' cancelled_via_webhook'
           WHERE btcpay_pull_payment_id = $1 AND status IN ('pending', 'claimed')
           RETURNING earning_ids, creator_id`,
          [pullPaymentId]
        );
        if (rows[0]?.earning_ids) {
          await query(
            `UPDATE creator_earnings SET status = 'available'
             WHERE id = ANY($1) AND status = 'in_payout'`,
            [rows[0].earning_ids]
          );
          logger.info('BTCPay PayoutCancelled: released earnings back to available', {
            pullPaymentId, creatorId: rows[0].creator_id, earningCount: rows[0].earning_ids.length,
          });
        }
        return res.json({ success: true, type: 'payout_cancelled' });
      } catch (payoutErr) {
        logger.error('BTCPay payout webhook handler error', {
          type: event.type, pullPaymentId, error: payoutErr.message,
        });
        return res.status(500).json({ success: false, error: 'payout_handler_error' });
      }
    }

    // Other pull-payment lifecycle events we don't act on (audit-log only).
    if (event.type && event.type.startsWith('Payout')) {
      logger.info('BTCPay payout lifecycle event (no-op)', {
        type: event.type, pullPaymentId: event.pullPaymentId, payoutId: event.payoutId,
      });
      return res.json({ success: true, ignored: true, reason: 'payout_lifecycle' });
    }

    const invoiceId = event.invoiceId;
    if (!invoiceId) return res.status(400).json({ success: false, error: 'Missing invoiceId' });

    // Handle terminal failure states — mark stale pending rows so they stop accumulating
    if (event.type === 'InvoiceExpired' || event.type === 'InvoiceInvalid') {
      const terminalStatus = event.type === 'InvoiceExpired' ? 'expired' : 'invalid';
      const { query: dbQuery } = require('../../config/postgres');

      const [subUpd, purchUpd] = await Promise.all([
        dbQuery(
          `UPDATE dash_subscription_orders SET status = $2 WHERE btcpay_invoice_id = $1 AND status = 'pending'`,
          [invoiceId, terminalStatus]
        ),
        dbQuery(
          `UPDATE token_purchases SET status = $2 WHERE btcpay_invoice_id = $1 AND status = 'pending'`,
          [invoiceId, terminalStatus]
        ),
      ]);

      // Expire any awaiting_payment booking rows linked to this invoice via the order metadata
      try {
        const expiredOrders = await dbQuery(
          `SELECT metadata FROM dash_subscription_orders
           WHERE btcpay_invoice_id = $1
             AND metadata->>'resource' IN ('call_package', 'private_call_booking')`,
          [invoiceId]
        );
        for (const expiredOrder of expiredOrders.rows) {
          const meta = expiredOrder.metadata && typeof expiredOrder.metadata === 'object'
            ? expiredOrder.metadata
            : (() => { try { return JSON.parse(expiredOrder.metadata); } catch { return null; } })();
          if (meta?.paymentId) {
            if (meta.resource === 'private_call_booking') {
              await dbQuery(
                `UPDATE booking_payments SET status = 'expired' WHERE id = $1 AND status IN ('created','pending')`,
                [meta.paymentId]
              );
              if (meta.bookingId) {
                await dbQuery(
                  `UPDATE bookings SET status = 'expired', updated_at = NOW()
                   WHERE id = $1 AND status = 'awaiting_payment'`,
                  [meta.bookingId]
                );
              }
            } else {
              await dbQuery(
                `UPDATE bookings SET status = 'expired', updated_at = NOW()
                 WHERE payment_id = $1 AND status = 'awaiting_payment'`,
                [meta.paymentId]
              );
            }
            logger.info('BTCPay: expired call booking on invoice expiry', {
              invoiceId, paymentId: meta.paymentId, resource: meta.resource,
            });
          }
        }
      } catch (expireBookingErr) {
        logger.warn('BTCPay: failed to expire call booking on invoice expiry (non-critical)', {
          invoiceId, error: expireBookingErr.message,
        });
      }

      const affected = (subUpd.rowCount || 0) + (purchUpd.rowCount || 0);
      logger.info(`BTCPay webhook: ${event.type}`, { invoiceId, rowsUpdated: affected });
      return res.json({ success: true, type: terminalStatus, rowsUpdated: affected });
    }

    // Fix 1.4: InvoiceMarkedInvalid — revoke entitlements for any completed subscription order.
    // Handles manual admin invalidations and chargeback-equivalent scenarios on BTCPay.
    if (event.type === 'InvoiceMarkedInvalid') {
      const { query: dbQuery } = require('../../config/postgres');

      const markedResult = await dbQuery(
        `UPDATE dash_subscription_orders SET status = 'invalid', notes = 'invoice_marked_invalid'
         WHERE btcpay_invoice_id = $1 AND status IN ('pending', 'completed')
         RETURNING id, user_id, plan_id, status AS old_status`,
        [invoiceId]
      );

      if (markedResult.rows.length > 0) {
        const { user_id: invalidUserId, plan_id: invalidPlanId } = markedResult.rows[0];

        // Revoke user_entitlements granted by this plan payment
        try {
          await dbQuery(
            `DELETE FROM user_entitlements WHERE user_id = $1 AND source_plan_id = $2 AND is_lifetime = false`,
            [invalidUserId, invalidPlanId]
          );
          logger.info('BTCPay InvoiceMarkedInvalid: entitlements revoked', { userId: invalidUserId, planId: invalidPlanId, invoiceId });
        } catch (revokeEntErr) {
          logger.error('BTCPay InvoiceMarkedInvalid: entitlement revocation failed', { userId: invalidUserId, planId: invalidPlanId, error: revokeEntErr.message });
        }

        // Invalidate entitlement cache
        try {
          await EntitlementAccessService.invalidateCache(invalidUserId);
        } catch (cacheErr) {
          logger.warn('BTCPay InvoiceMarkedInvalid: cache invalidation failed', { error: cacheErr.message });
        }

        // Downgrade tier
        try {
          await dbQuery(
            `UPDATE users SET tier = 'free', subscription_status = 'churned', plan_id = NULL, plan_expiry = NOW(), updated_at = NOW()
             WHERE id = $1 OR telegram = $1`,
            [invalidUserId]
          );
          logger.info('BTCPay InvoiceMarkedInvalid: user tier downgraded', { userId: invalidUserId });
        } catch (tierErr) {
          logger.error('BTCPay InvoiceMarkedInvalid: tier downgrade failed', { userId: invalidUserId, error: tierErr.message });
        }
      } else {
        logger.info('BTCPay InvoiceMarkedInvalid: no pending/completed order found — no action taken', { invoiceId });
      }

      return res.json({ success: true, type: 'marked_invalid', rowsUpdated: markedResult.rowCount || 0 });
    }

    // Only process successful invoice settlements beyond this point.
    // InvoicePaymentSettled fires per crypto payment received; InvoiceSettled fires when
    // the invoice reaches the Settled state. We handle both but gate entitlement grants on
    // confirmed Settled status so partial payments cannot trigger access grants.
    const isSettledEvent = event.type === 'InvoiceSettled';
    const isPaymentSettledEvent = event.type === 'InvoicePaymentSettled';

    if (!isSettledEvent && !isPaymentSettledEvent) {
      return res.json({ success: true, ignored: true });
    }

    // For InvoicePaymentSettled: verify the invoice is fully settled via API before granting.
    // This event fires on every individual crypto payment, including partial payments.
    if (isPaymentSettledEvent) {
      try {
        const { getInvoice } = require('../../config/btcpay');
        const invoiceDetails = await getInvoice(invoiceId);
        if (invoiceDetails.status !== 'Settled') {
          logger.info('BTCPay InvoicePaymentSettled: invoice not yet fully settled — skipping entitlement grant', {
            invoiceId,
            invoiceStatus: invoiceDetails.status,
            paymentMethod: event.paymentMethod,
          });
          return res.json({ success: true, ignored: true, reason: 'not_yet_settled' });
        }
        logger.info('BTCPay InvoicePaymentSettled: invoice confirmed Settled — proceeding with grant', {
          invoiceId,
          paymentMethod: event.paymentMethod,
        });
      } catch (paymentSettledCheckErr) {
        // If BTCPay API is unreachable, do not grant — wait for InvoiceSettled which carries
        // stronger confirmation and will retry via BTCPay's own webhook delivery mechanism.
        logger.warn('BTCPay InvoicePaymentSettled: could not verify invoice status — skipping (will retry on InvoiceSettled)', {
          invoiceId,
          error: paymentSettledCheckErr.message,
        });
        return res.json({ success: true, ignored: true, reason: 'api_unreachable' });
      }
    }

    // Replay protection: check if this exact invoice has already been fully processed.
    // checkInvoiceProcessed uses a 48-hour Redis TTL — separate from the per-request lock below.
    const alreadyProcessedReplay = await checkInvoiceProcessed(invoiceId);
    if (alreadyProcessedReplay) {
      logger.info('BTCPay webhook: invoice already processed (replay protection)', {
        invoiceId,
        eventType: event.type,
      });
      return res.json({ success: true, duplicate: true });
    }

    // Idempotency: acquire a Redis lock to prevent duplicate delivery race conditions.
    const settleLock = await cache.acquireLock(`btcpay:settled:${invoiceId}`, 120).catch(() => false);
    if (!settleLock) {
      logger.info('BTCPay settlement duplicate delivery blocked', { invoiceId, eventType: event.type });
      return res.json({ success: true, duplicate: true });
    }

    try {

    const { query: dbQuery } = require('../../config/postgres');

    // Fix 1.1: Verify paid amount against invoice before granting access.
    // Prevents attackers from underpaying (e.g., $0.01) and receiving full entitlements.
    // Skip for InvoicePaymentSettled — we already confirmed Settled status above.
    if (isSettledEvent) {
      try {
        const { getInvoice } = require('../../config/btcpay');
        const invoiceDetails = await getInvoice(invoiceId);
        // BTCPay's settled invoice has `amount` (original) and `paidAmount` (actual crypto paid in currency-equivalent)
        // Use paidAmount if available, else fall back to amount (already-settled invoices may match)
        const actualPaid = parseFloat(invoiceDetails.paidAmount ?? invoiceDetails.amount ?? '0');
        const expectedAmount = parseFloat(invoiceDetails.amount ?? '0');
        if (actualPaid > 0 && expectedAmount > 0 && actualPaid < expectedAmount - 0.01) {
          logger.error('BTCPay InvoiceSettled: underpayment detected — aborting entitlement grant', {
            invoiceId,
            expectedAmount,
            actualPaid,
            shortfall: expectedAmount - actualPaid,
          });
          return res.status(200).json({ success: false, error: 'underpayment', invoiceId });
        }
      } catch (invoiceCheckErr) {
        // Log but do NOT block — if BTCPay API is unreachable we still trust the webhook signature
        logger.warn('BTCPay InvoiceSettled: could not fetch invoice for amount verification (proceeding)', {
          invoiceId, error: invoiceCheckErr.message,
        });
      }
    }

    // --- 1. Check if this is a subscription order (legacy Dash flow) ---
    const subResult = await dbQuery(
      `SELECT id, user_id, plan_id, status, creator_id, metadata FROM dash_subscription_orders
       WHERE btcpay_invoice_id = $1`,
      [invoiceId]
    );

    if (subResult.rows.length > 0) {
      const order = subResult.rows[0];

      // ── Scoped resource purchases (hangout-access / channel-access) ──────
      // When order.metadata carries hangoutGroupId or channelId we route the
      // grant through PaymentService.grantEntitlementsForPlan with source='dash'
      // — same code path the ePayco webhook uses for these plans. Skips the
      // tier/users-table mutation block below (which would wrongly clobber
      // the buyer's main subscription expiry).
      const orderMetadata = order.metadata && typeof order.metadata === 'object'
        ? order.metadata
        : (typeof order.metadata === 'string' ? (() => { try { return JSON.parse(order.metadata); } catch { return null; } })() : null);

      // ── Live show ticket purchase (Dash/BTCPay) ──────────────────────────
      if (orderMetadata?.resource === 'live_show_ticket' && orderMetadata?.slotId) {
        // Atomic idempotency — flip status once.
        const settleTicket = await dbQuery(
          `UPDATE dash_subscription_orders SET status = 'completed', completed_at = NOW()
           WHERE id = $1 AND status = 'pending' RETURNING id`,
          [order.id]
        );
        if (settleTicket.rowCount === 0) {
          return res.json({ success: true, alreadyProcessed: true });
        }
        try {
          const { handleTicketSettlement } = require('../../bot/api/controllers/webappLiveController');
          await handleTicketSettlement(
            order.user_id,
            orderMetadata.slotId,
            'dash',
            parseFloat(order.usd_amount || 0)
          );
          await markInvoiceProcessed(invoiceId, {
            userId: order.user_id,
            slotId: orderMetadata.slotId,
            source: 'live_show_ticket',
          });
          logger.info('BTCPay: live show ticket settled', {
            invoiceId,
            userId: order.user_id,
            slotId: orderMetadata.slotId,
          });
          return res.json({ success: true, type: 'live_show_ticket', slotId: orderMetadata.slotId });
        } catch (ticketErr) {
          logger.error('BTCPay: live show ticket settlement failed', {
            invoiceId, orderId: order.id, error: ticketErr.message,
          });
          await dbQuery(
            `UPDATE dash_subscription_orders SET notes = $2 WHERE id = $1`,
            [order.id, `ticket_settlement_failed: ${ticketErr.message}`.slice(0, 500)]
          );
          return res.status(500).json({ success: false, error: 'ticket_settlement_failed', invoiceId });
        }
      }

      // ── Private-call booking (Dash/BTCPay, bot flow) ────────────────────
      if (orderMetadata?.resource === 'private_call_booking' && orderMetadata?.paymentId) {
        const settleBooking = await dbQuery(
          `UPDATE dash_subscription_orders SET status = 'completed', completed_at = NOW()
           WHERE id = $1 AND status = 'pending' RETURNING id`,
          [order.id]
        );
        if (settleBooking.rowCount === 0) {
          return res.json({ success: true, alreadyProcessed: true });
        }
        try {
          const PrivateCallBookingService = require('../../services/privateCallBookingService');
          const settleResult = await PrivateCallBookingService.handlePaymentComplete(
            orderMetadata.paymentId,
            invoiceId
          );
          if (!settleResult?.success) {
            logger.error('BTCPay: private-call booking settlement failed', {
              invoiceId, paymentId: orderMetadata.paymentId, error: settleResult?.error,
            });
            await dbQuery(
              `UPDATE dash_subscription_orders SET notes = $2 WHERE id = $1`,
              [order.id, `booking_settlement_failed: ${settleResult?.error || 'unknown'}`.slice(0, 500)]
            );
            return res.status(500).json({ success: false, error: 'booking_settlement_failed', invoiceId });
          }
          await markInvoiceProcessed(invoiceId, {
            userId: order.user_id,
            paymentId: orderMetadata.paymentId,
            source: 'private_call_booking',
          });
          logger.info('BTCPay: private-call booking settled', {
            invoiceId,
            userId: order.user_id,
            paymentId: orderMetadata.paymentId,
            bookingId: orderMetadata.bookingId,
          });
          return res.json({ success: true, type: 'private_call_booking', paymentId: orderMetadata.paymentId });
        } catch (bookingErr) {
          logger.error('BTCPay: private-call booking settlement error', {
            invoiceId, orderId: order.id, error: bookingErr.message,
          });
          await dbQuery(
            `UPDATE dash_subscription_orders SET notes = $2 WHERE id = $1`,
            [order.id, `booking_settlement_error: ${bookingErr.message}`.slice(0, 500)]
          );
          return res.status(500).json({ success: false, error: 'booking_settlement_error', invoiceId });
        }
      }

      // ── Call package purchase (Dash/BTCPay) ─────────────────────────────
      if (orderMetadata?.resource === 'call_package' && orderMetadata?.paymentId) {
        // Atomic idempotency — flip status once
        const settleCall = await dbQuery(
          `UPDATE dash_subscription_orders SET status = 'completed', completed_at = NOW()
           WHERE id = $1 AND status = 'pending' RETURNING id`,
          [order.id]
        );
        if (settleCall.rowCount === 0) {
          return res.json({ success: true, alreadyProcessed: true });
        }
        try {
          const callCheckoutSvc = require('../../services/callCheckoutService');
          await callCheckoutSvc.onCallPaymentSuccess(orderMetadata.paymentId);
          await markInvoiceProcessed(invoiceId, {
            userId: order.user_id,
            paymentId: orderMetadata.paymentId,
            source: 'call_package',
          });
          logger.info('BTCPay: call package settled', {
            invoiceId,
            userId: order.user_id,
            paymentId: orderMetadata.paymentId,
            bookingId: orderMetadata.bookingId,
          });
          return res.json({ success: true, type: 'call_package', paymentId: orderMetadata.paymentId });
        } catch (callErr) {
          logger.error('BTCPay: call package settlement failed', {
            invoiceId, orderId: order.id, error: callErr.message,
          });
          await dbQuery(
            `UPDATE dash_subscription_orders SET notes = $2 WHERE id = $1`,
            [order.id, `call_settlement_failed: ${callErr.message}`.slice(0, 500)]
          );
          return res.status(500).json({ success: false, error: 'call_settlement_failed', invoiceId });
        }
      }

      const isScopedPurchase = orderMetadata && (orderMetadata.hangoutGroupId || orderMetadata.channelId);

      if (isScopedPurchase) {
        // Atomic idempotency — only one webhook delivery should grant.
        const settleScoped = await dbQuery(
          `UPDATE dash_subscription_orders SET status = 'completed', completed_at = NOW()
             WHERE id = $1 AND status = 'pending' RETURNING id`,
          [order.id]
        );
        if (settleScoped.rowCount === 0) {
          return res.json({ success: true, alreadyProcessed: true });
        }
        try {
          const PaymentService = require('../../services/paymentService');
          const grantResult = await PaymentService.grantEntitlementsForPlan(
            order.user_id,
            order.plan_id,
            'dash',
            orderMetadata
          );
          logger.info('BTCPay scoped resource purchase granted', {
            invoiceId,
            orderId: order.id,
            planId: order.plan_id,
            scope: orderMetadata.hangoutGroupId ? `hangout:${orderMetadata.hangoutGroupId}` : `channel:${orderMetadata.channelId}`,
            grantResult,
          });
          return res.json({ success: true, scopedPurchase: true, grantResult });
        } catch (grantErr) {
          logger.error('BTCPay scoped grant failed', {
            invoiceId, orderId: order.id, planId: order.plan_id, error: grantErr.message,
          });
          await dbQuery(
            `UPDATE dash_subscription_orders SET notes = $2 WHERE id = $1`,
            [order.id, `scoped_grant_failed: ${grantErr.message}`.slice(0, 500)]
          );
          return res.status(500).json({ success: false, error: 'scoped_grant_failed', invoiceId });
        }
      }

      const isCreatorSub = order.plan_id === 'creator_monthly' && order.creator_id;

      // For creator_monthly there is no row in `plans`. Synthesize a plan-like
      // shape so the rest of the flow (tier set, socket emit, notifications)
      // still works without forcing the user's main plan_expiry to flip.
      let plan;
      if (isCreatorSub) {
        plan = {
          id: 'creator_monthly',
          name: 'Creator Subscription',
          display_name: 'Creator Subscription',
          tier: null,           // do not change user's main tier on creator-only purchase
          duration_days: 30,
        };
      } else {
        const PlanModel = require('../../models/planModel');
        plan = await PlanModel.getById(order.plan_id);
        if (!plan) {
          logger.error('BTCPay: plan not found for settled invoice', { invoiceId, planId: order.plan_id });
          await dbQuery(
            `UPDATE dash_subscription_orders SET status = 'failed', notes = 'plan_not_found' WHERE id = $1`,
            [order.id]
          );
          return res.status(200).json({ success: false, error: 'plan_not_found', invoiceId });
        }
      }

      const durationDays = plan.duration_days || plan.duration || 30;
      const isLifetime = durationDays >= 36500;
      const expiryDate = isLifetime ? null : new Date(Date.now() + durationDays * 86400000);
      // Derive tier from plan: use plan.tier if set, else infer from plan_id prefix
      const newTier = (plan.tier === 'member' || order.plan_id.startsWith('member_')) ? 'member' : 'PRIME';

      // Atomic idempotency guard: only proceed if the order is still in 'pending' state.
      // If another webhook delivery already completed it, rowCount will be 0.
      const settleResult = await dbQuery(
        `UPDATE dash_subscription_orders SET status = 'completed', completed_at = NOW() WHERE id = $1 AND status = 'pending' RETURNING id`,
        [order.id]
      );
      if (settleResult.rowCount === 0) {
        logger.info('BTCPay subscription already processed or not pending', { invoiceId, orderId: order.id });
        return res.json({ success: true, alreadyProcessed: true });
      }

      // Creator subscriptions: route through CreatorService.subscribeToCreator() which
      // handles entitlement + creator_subscriptions row + 70/30 earnings split + sockets.
      // Skip the tier/users-table mutation below — buying a creator sub must NOT clobber
      // the buyer's main subscription expiry.
      if (isCreatorSub) {
        try {
          const CreatorService = require('../../services/creatorService');
          await CreatorService.subscribeToCreator(order.user_id, order.creator_id, null);
          logger.info('BTCPay: creator subscription activated', {
            userId: order.user_id, creatorId: order.creator_id, invoiceId,
          });
        } catch (creatorErr) {
          logger.error('BTCPay creator subscription activation failed', {
            error: creatorErr.message, userId: order.user_id, creatorId: order.creator_id, invoiceId,
          });
          // Mark the order so an operator can investigate — payment is settled on-chain.
          await dbQuery(
            `UPDATE dash_subscription_orders SET notes = $2 WHERE id = $1`,
            [order.id, `creator_sub_failed: ${creatorErr.message}`.slice(0, 500)]
          );
          return res.status(500).json({ success: false, error: 'creator_subscription_failed', invoiceId });
        }
        return res.json({ success: true, creatorSubscription: true, creatorId: order.creator_id });
      }

      await dbQuery(
        `UPDATE users
         SET tier = $2, subscription_status = 'active', plan_id = $3, plan_expiry = $4, updated_at = NOW()
         WHERE id = $1 OR telegram = $1`,
        [order.user_id, newTier, order.plan_id, expiryDate]
      );

      logger.info('BTCPay: subscription activated', { userId: order.user_id, planId: order.plan_id, invoiceId });

      // Grant entitlements — sole source of truth for access control (users.tier is display only).
      // This matches the post-payment flow used by ePayco.
      try {
        const PaymentService = require('../../services/paymentService');
        await PaymentService.grantEntitlementsForPlan(order.user_id, order.plan_id, 'btcpay');
        logger.info('BTCPay: entitlements granted', { userId: order.user_id, planId: order.plan_id });
      } catch (entErr) {
        // Non-fatal: users.tier is already set so legacy access paths still work.
        // Entitlements will be reconciled by the daily cleanup cron.
        logger.error('BTCPay: entitlement grant failed (non-fatal, tier already set)', {
          userId: order.user_id,
          planId: order.plan_id,
          error: entErr.message,
        });
      }

      // PAY-006: Invalidate Redis user cache after raw SQL tier update.
      try {
        const { cache } = require('../../../config/redis');
        await cache.del(`user:${order.user_id}`);
        logger.info('Cleared user cache after BTCPay subscription activation', { userId: order.user_id });
      } catch (cacheErr) {
        logger.warn('Failed to clear user cache after BTCPay activation', { error: cacheErr.message });
      }

      try {
        const socketSingleton = require('../../services/socketSingleton');
        const io = socketSingleton.get ? socketSingleton.get() : socketSingleton;
        if (io) {
          io.to(`user:${order.user_id}`).emit('subscription:activated', {
            planId: order.plan_id,
            planName: plan.display_name || plan.name,
            tier: newTier,
            expiryDate,
          });
        }
      } catch (emitErr) {
        logger.warn(`BTCPay sub socket emit failed: ${emitErr.message}`);
      }

      // F-02: Post-purchase notifications for BTCPay users (fire-and-forget)
      try {
        const userData = await dbQuery(
          'SELECT email, language, telegram FROM users WHERE id = $1',
          [order.user_id]
        );
        const u = userData.rows[0];
        if (u) {
          const planName = plan.display_name || plan.name || order.plan_id;
          const language = u.language || 'es';
          // Telegram DM (only for users with Telegram)
          if (u.telegram) {
            try {
              const PaymentNotificationService = require('../../services/paymentNotificationService');
              await PaymentNotificationService.sendPaymentConfirmation(order.user_id, {
                planId: order.plan_id,
                planName,
                amount: order.amount || 0,
                currency: 'USD',
                provider: 'btcpay',
                language,
              });
            } catch (dmErr) {
              logger.warn('BTCPay: Telegram DM failed (non-critical)', { userId: order.user_id, error: dmErr.message });
            }
          }
          // Email invoice + welcome (only if email available)
          if (u.email) {
            try {
              const InvoiceService = require('../../services/invoiceservice');
              const EmailService = require('../../services/emailservice');
              const { buffer: invoicePdf } = await InvoiceService.generateInvoice({
                invoiceNumber: invoiceId,
                customerName: u.telegram || order.user_id,
                customerEmail: u.email,
                planName,
                amount: order.amount || 0,
                currency: 'USD',
                paymentDate: new Date(),
                provider: 'Dash/BTCPay',
                language,
              });
              await EmailService.sendInvoiceEmail({
                to: u.email,
                invoicePdf,
                invoiceNumber: invoiceId,
                customerName: u.telegram || order.user_id,
                amount: order.amount || 0,
                currency: 'USD',
                planName,
              });
              const { buffer: guidePdf } = await InvoiceService.generateOnboardingGuide({
                customerName: u.telegram || order.user_id,
                planName,
                language,
              });
              await EmailService.sendWelcomeEmail({
                to: u.email,
                customerName: u.telegram || order.user_id,
                planName,
                onboardingGuidePdf: guidePdf,
                language,
                userUuid: u.id,
                username: u.username,
                loginMethod: u.last_login_method
              });
              logger.info('BTCPay: invoice + welcome emails sent', { to: u.email, planId: order.plan_id });
            } catch (emailErr) {
              logger.warn('BTCPay: email notification failed (non-critical)', { userId: order.user_id, error: emailErr.message });
            }
          }
        }
      } catch (notifErr) {
        logger.warn('BTCPay post-purchase notification block failed', { error: notifErr.message });
      }

      // Mark invoice as processed in Redis to prevent replay delivery from re-granting.
      await markInvoiceProcessed(invoiceId, { userId: order.user_id, planId: order.plan_id, source: 'subscription' });

      return res.json({ success: true, type: 'subscription', planId: order.plan_id });
    }

    // --- 2. Metadata fallback: invoice created via createInvoice (Greenfield API) ---
    // Invoices created with the new createInvoice() embed userId + planId directly in
    // invoice.metadata. If no dash_subscription_orders row exists, extract those fields
    // from the webhook event payload and grant entitlements directly.
    const metaUserId = event.metadata?.userId || null;
    const metaPlanId = event.metadata?.planId || null;

    if (metaUserId && metaPlanId) {
      logger.info('BTCPay settlement: processing via invoice metadata (Greenfield flow)', {
        invoiceId,
        eventType: event.type,
        userId: metaUserId,
        planId: metaPlanId,
        amount: event.amount,
        currency: event.currency,
      });

      const PlanModelGf = require('../../models/planModel');
      const metaPlan = await PlanModelGf.getById(metaPlanId);
      if (!metaPlan) {
        logger.error('BTCPay metadata flow: plan not found — entitlements NOT granted', {
          invoiceId,
          planId: metaPlanId,
          userId: metaUserId,
        });
        // Return 200 so BTCPay does not endlessly retry a permanently missing plan.
        return res.status(200).json({ success: false, error: 'plan_not_found', invoiceId });
      }

      // Grant entitlements — idempotent via ON CONFLICT in grantEntitlementsForPlan.
      let metaGrantResult;
      try {
        const PaymentServiceGf = require('../../services/paymentService');
        metaGrantResult = await PaymentServiceGf.grantEntitlementsForPlan(metaUserId, metaPlanId, 'btcpay');
        logger.info('BTCPay metadata flow: entitlements granted', {
          invoiceId,
          userId: metaUserId,
          planId: metaPlanId,
          granted: metaGrantResult.granted,
          errors: metaGrantResult.errors,
          amount: event.amount,
          currency: event.currency,
        });

        if (metaGrantResult.granted === 0 && metaGrantResult.warning !== 'NO_PLAN_ADDONS') {
          // Zero grants without a known warning — signal BTCPay to retry.
          logger.error('BTCPay metadata flow: grantEntitlementsForPlan returned zero grants', {
            invoiceId, userId: metaUserId, planId: metaPlanId,
          });
          return res.status(500).json({ success: false, error: 'entitlement_grant_zero', invoiceId });
        }
      } catch (metaEntErr) {
        logger.error('BTCPay metadata flow: entitlement grant threw unexpectedly', {
          invoiceId,
          userId: metaUserId,
          planId: metaPlanId,
          error: metaEntErr.message,
        });
        // Return 500 so BTCPay retries delivery.
        return res.status(500).json({ success: false, error: 'entitlement_grant_failed', invoiceId });
      }

      // Sync users.tier for admin display (non-critical).
      try {
        const metaDurationDays = metaPlan.duration_days || 30;
        const metaIsLifetime = metaDurationDays >= 36500;
        const metaExpiryDate = metaIsLifetime ? null : new Date(Date.now() + metaDurationDays * 86400000);
        const metaNewTier = (metaPlan.tier === 'member' || metaPlanId.startsWith('member_')) ? 'member' : 'PRIME';
        await dbQuery(
          `UPDATE users
           SET tier = $2, subscription_status = 'active', plan_id = $3, plan_expiry = $4, updated_at = NOW()
           WHERE id = $1 OR telegram = $1`,
          [metaUserId, metaNewTier, metaPlanId, metaExpiryDate]
        );
      } catch (metaTierErr) {
        logger.warn('BTCPay metadata flow: tier sync failed (non-critical)', {
          userId: metaUserId,
          planId: metaPlanId,
          error: metaTierErr.message,
        });
      }

      // Invalidate user Redis cache (non-critical).
      cache.del(`user:${metaUserId}`).catch(() => {});

      // Socket notification (non-critical).
      try {
        const socketSingleton = require('../../services/socketSingleton');
        const io = socketSingleton.get ? socketSingleton.get() : socketSingleton;
        if (io) {
          io.to(`user:${metaUserId}`).emit('subscription:activated', {
            planId: metaPlanId,
            planName: metaPlan.display_name || metaPlan.name,
            invoiceId,
          });
        }
      } catch (metaEmitErr) {
        logger.warn(`BTCPay metadata flow socket emit failed: ${metaEmitErr.message}`);
      }

      // Mark processed in Redis.
      await markInvoiceProcessed(invoiceId, { userId: metaUserId, planId: metaPlanId, source: 'metadata' });

      return res.json({ success: true, type: 'metadata_subscription', planId: metaPlanId, invoiceId });
    }

    // --- 3. Fall through to token purchase ---
    const purchaseResult = await dbQuery(
      `SELECT user_id, tokens_credited, usd_amount FROM token_purchases
       WHERE btcpay_invoice_id = $1`,
      [invoiceId]
    );

    // --- 3a. Check if this is a Dash tip invoice ---
    if (event.metadata?.type === 'tip' && event.metadata?.tipId) {
      const tipId = event.metadata.tipId;
      const tipUserId = event.metadata.userId;
      const tipPerformerId = event.metadata.performerId;

      // Confirm the tip payment
      try {
        await PNPLiveTipsService.confirmTipPayment(tipId, invoiceId);
        logger.info('BTCPay: Dash tip confirmed', { tipId, invoiceId, userId: tipUserId, performerId: tipPerformerId });

        // Emit real-time tip event
        const tipInfo = await PNPLiveTipsService.getTipById(tipId);
        const socketSingleton = require('../../services/socketSingleton');
        const io = socketSingleton.get ? socketSingleton.get() : socketSingleton;
        if (io && tipInfo) {
          const tipPayload = {
            id: tipInfo.id,
            amount: parseFloat(tipInfo.amount),
            username: tipInfo.user_username || 'Anonymous',
            performerName: tipInfo.model_name || 'Performer',
            message: tipInfo.message || '',
            createdAt: tipInfo.created_at,
            paymentMethod: 'dash',
          };
          io.to(`live:${tipPerformerId}`).emit('live:tip', tipPayload);
        }
      } catch (tipErr) {
        logger.error('BTCPay: Dash tip confirmation failed', { tipId, invoiceId, error: tipErr.message });
      }

      await markInvoiceProcessed(invoiceId, { tipId, userId: tipUserId, source: 'dash_tip' });
      return res.json({ success: true, type: 'dash_tip', tipId });
    }

    if (purchaseResult.rows.length === 0) {
      logger.warn('BTCPay webhook: unknown invoice — no subscription order, no metadata planId, no token purchase', {
        invoiceId,
        eventType: event.type,
        metadataKeys: Object.keys(event.metadata || {}),
      });
      return res.status(404).json({ success: false, error: 'Purchase not found' });
    }

    const { user_id: userId, tokens_credited: tokens, usd_amount: usdAmount } = purchaseResult.rows[0];
    const { newBalance, alreadyProcessed } = await DashTokenService.creditTokens(
      userId, tokens, invoiceId, { usdAmount }
    );

    if (!alreadyProcessed) {
      logger.info('BTCPay: tokens credited', { userId, tokens, invoiceId, newBalance });

      try {
        const socketSingleton = require('../../services/socketSingleton');
        const io = socketSingleton.get ? socketSingleton.get() : socketSingleton;
        if (io) {
          io.to(`user:${userId}`).emit('wallet:updated', { balance: newBalance, credited: tokens });
        }
      } catch (emitErr) {
        logger.warn(`BTCPay wallet socket emit failed: ${emitErr.message}`);
      }

      // Mark processed in Redis after token credit.
      await markInvoiceProcessed(invoiceId, { userId, source: 'token_purchase' });
    }

    res.json({ success: true, alreadyProcessed });

    } finally {
      await cache.releaseLock(`btcpay:settled:${invoiceId}`);
    }
  })
);

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

// Payment-status poller for Dash checkout flow (must be before /:bookingId catch-all)
app.get('/api/webapp/bookings/:bookingId/payment-status',
  requireSessionAuth,
  asyncHandler(callBookingController.getBookingPaymentStatus));

app.get('/api/webapp/bookings/:bookingId',
  requireSessionAuth,
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

// Member: upcoming confirmed bookings (with 15-min join window)
app.get('/api/webapp/bookings/upcoming',
  requireSessionAuth,
  asyncHandler(callBookingController.getUpcomingBookings));

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

// Auth required — issue a LiveKit token
app.post(
  '/api/main-stage/token',
  authenticateUser,
  mainStageTokenLimiter,
  mainStageController.token
);

// Admin writes — auth + role guard + rate limit
app.post(
  '/api/main-stage/mode',
  authenticateUser,
  roleGuard('admin', 'superadmin'),
  mainStageAdminLimiter,
  mainStageController.setMode
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
