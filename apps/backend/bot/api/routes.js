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
const hangoutsController = require('./controllers/hangoutsController');
const eventsController = require('./controllers/eventsController');
const xOAuthRoutes = require('./xOAuthRoutes');
const xFollowersRoutes = require('./xFollowersRoutes');
const { adminGuard: xOAuthAdminGuard, adminGuard } = require('../../middleware/guards');
const adminUserRoutes = require('./routes/adminUserRoutes');
const userManagementRoutes = require('./routes/userManagementRoutes');
const nearbyRoutes = require('./routes/nearby.routes');
const NearbyController = require('./controllers/nearbyController');
const { verifyAdminJWT } = require('./middleware/jwtAuth');

// Middleware
const { asyncHandler } = require('./middleware/errorHandler');
const { authenticateUser } = require('./middleware/auth');
const ipTracker = require('./middleware/ipTracker');
const PermissionService = require('../services/permissionService');
const referralService = require('../services/referralService');

// Authentication middleware and handlers
const { telegramAuth, checkTermsAccepted } = require('../../api/middleware/telegramAuth');
const { handleTelegramAuth, handleAcceptTerms, checkAuthStatus } = require('../../api/handlers/telegramAuthHandler');

// New route imports for auth, subscriptions, monetization, and PDS
const authRoutes = require('./routes/authRoutes');
const subscriptionRoutes = require('./routes/subscriptionRoutes');
const modelRoutes = require('./routes/modelRoutes');
const applyRoutes = require('./routes/applyRoutes');
const pdsRoutes = require('./routes/pdsRoutes');
const blueskyRoutes = require('./routes/blueskyRoutes');
const elementRoutes = require('./routes/elementRoutes');
const creatorRoutes = require('./routes/creatorRoutes');
const gamificationRoutes = require('./routes/gamificationRoutes');
const canvaRoutes = require('./routes/canvaRoutes');

// ATProto / Bluesky OAuth routes (public endpoints served at the monorepo root)
const atprotoOAuthRoutes = require('./routes/atprotoOAuthRoutes');

// Courtesy invite links — admin/model create, any authenticated user redeems
const courtesyInviteRoutes = require('./routes/courtesyInviteRoutes');

// Community Room (Haus) — 24/7 open video room powered by JaaS
const communityRoomController = require('./controllers/communityRoomController');

// JaaS token generation (viewer, moderator, live streaming)
const jaasController = require('./controllers/jaasController');

// ATProto controller for profile fetching, unlinking, and cross-posting
const atprotoController = require('./controllers/atprotoController');

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

const { requireTier, isMemberOrAbove, isAdmin: isAdminTier } = require('../services/accessService');

// Entitlement-based access control — replaces requireTier for all route middleware
const EntitlementAccessService = require('../services/entitlementAccessService');

/**
 * Thin session auth — returns 401 JSON if user is not authenticated.
 * Use this before multer on upload routes to reject unauthenticated
 * requests before any file processing begins.
 */
const requireSessionAuth = (req, res, next) => {
  if (!req.session?.user?.id) return res.status(401).json({ error: 'Not authenticated' });
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
    const EntitlementAccessService = require('./services/entitlementAccessService');
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

// Trust proxy - required for rate limiting behind reverse proxy (nginx, etc.)
// Setting to 1 trusts the first proxy (direct connection from nginx)
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

// Session middleware for Telegram auth with Redis store
const redisClient = getRedis();
const resolvedSessionSecret = process.env.SESSION_SECRET;

if (!resolvedSessionSecret) {
  throw new Error('SESSION_SECRET must be configured (separate from JWT_SECRET)');
}
// Session middleware with explicit response hooks to ensure Set-Cookie header is set
const sessionMiddleware = session({
  store: new RedisStore({ client: redisClient, prefix: 'sess:', ttl: 90 * 86400 }),
  secret: resolvedSessionSecret,
  resave: false,
  saveUninitialized: false,
  rolling: true, // Refresh session TTL on each request
  name: '__pnptv_sid', // Obscure session cookie name (was: connect.sid)
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 90 * 24 * 60 * 60 * 1000, // 90 days — active users stay logged in
    path: '/',
    domain: process.env.NODE_ENV === 'production' ? '.pnptv.app' : undefined
  }
});

app.use(sessionMiddleware);
app.use(ipTracker); // Log every authenticated request IP for security

// express-session handles Set-Cookie automatically — no custom middleware needed


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
        "https://8x8.vc",
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

// 3DS bank challenge iframes load from bank domains (e.g. jpmorgan.com, bancolombia.com).
// Override helmet's restrictive CSP for checkout pages so frame-src, connect-src, img-src,
// and form-action allow any HTTPS origin. script-src stays locked to known payment SDKs.
const CHECKOUT_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://code.jquery.com https://cdn.epayco.co https://multimedia.epayco.co https://checkout.epayco.co https://secure.epayco.co https://secure.payco.co https://api.secure.payco.co https://songbird.cardinalcommerce.com https://songbirdstag.cardinalcommerce.com https://centinelapi.cardinalcommerce.com https://centinelapistag.cardinalcommerce.com https://3ds.epayco.com https://3ds-green.epayco.com https://apiflow.epayco.co https://apiflow-green.epayco.co https://apiflow.epayco.io https://eks-ms-3ds-service.epayco.io",
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

app.get('/daimo-checkout/:paymentId', (req, res) => {
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

// LIFETIME100 pass promo page
app.get('/lifetime100', pageLimiter, (req, res) => {
  const host = req.get('host') || '';
  if (host.includes('easybots.store') || host.includes('easybots')) {
    return res.status(404).send('Not found');
  }
  res.sendFile(path.join(__dirname, '../../../../public/lifetime-pass.html'));
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
    return res.redirect(302, 'https://app.pnptv.app');
  }
  // Not authenticated → show login
  return res.sendFile(path.join(__dirname, '../../../public/login.html'));
});

// /login → redirect to /
app.get('/login', (req, res) => res.redirect(301, '/'));

// PNPtv Haus page
app.get('/community-room', (req, res) => {
  const host = req.get('host') || '';
  if (host.includes('easybots.store') || host.includes('easybots')) {
    return res.status(404).send('Not found');
  }
  res.redirect(302, '/community-room.html');
});

// PNPtv Haus alias
app.get('/pnptv-haus', (req, res) => {
  const host = req.get('host') || '';
  if (host.includes('easybots.store') || host.includes('easybots')) {
    return res.status(404).send('Not found');
  }
  res.redirect(302, '/community-room.html');
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

app.get('/pnp/meet-greet/daimo-checkout/:bookingId', pageLimiter, (req, res) => {
  sendCheckoutHtml(res, 'payment-checkout.html');
});

// PNP Live Checkout pages (all use unified payment-checkout.html)
app.get('/pnp/live/checkout/:bookingId', pageLimiter, (req, res) => {
  sendCheckoutHtml(res, 'payment-checkout.html');
});

app.get('/pnp/live/daimo-checkout/:bookingId', pageLimiter, (req, res) => {
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
      '/daimo-checkout/',
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
// A single multer instance handles both; mime validation happens in chatMediaService.
const chatMediaUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const isAllowed = /^(image\/(jpeg|jpg|png|webp|gif)|video\/(mp4|webm))$/i.test(file.mimetype || '');
    if (isAllowed) return cb(null, true);
    cb(new Error('Only image (jpg/png/webp/gif) and video (mp4/webm) files are allowed in chat'));
  },
});

// Wrap chatMediaUpload to return structured JSON errors consistent with the rest of the API
const uploadChatMedia = (req, res, next) => {
  chatMediaUpload.single('media')(req, res, (err) => {
    if (!err) return next();
    let message = 'Invalid file. Please try a different image or video.';
    if (err.code === 'LIMIT_FILE_SIZE') {
      message = 'File is too large. Images must be under 20 MB and videos under 100 MB.';
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
    const isAllowed = /^(image\/(jpeg|jpg|png|webp|gif)|video\/(mp4|webm))$/i.test(file.mimetype || '');
    if (isAllowed) return cb(null, true);
    cb(new Error('Only image (jpg/png/webp/gif) and video (mp4/webm) files are allowed'));
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
  keyGenerator: (req) => req.session?.user?.id || req.ip,
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

// C5: Dedicated rate limiter for payment status polling endpoint
// Tightened to max 10/min per IP to prevent payment-ID enumeration.
const paymentStatusLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 polls per minute per IP — prevents payment-ID enumeration
  keyGenerator: (req) => req.ip,
  handler: (req, res) => res.status(429).json({ error: 'Too many status requests, please wait.' }),
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
app.get('/api/auth-status', authStatusLimiter, checkAuthStatus);

// Admin check endpoint (for frontend role gate)
// Uses adminGuard which queries DB — never trusts the stale session role.
// adminGuard returns 403 for non-admins; frontend treats any non-200 as isAdmin: false.
const adminCheckLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, keyGenerator: (req) => req.ip, standardHeaders: true, legacyHeaders: false });
app.get('/api/admin/check', adminCheckLimiter, adminGuard, (req, res) => {
  res.json({ isAdmin: true });
});

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

// Main Daimo webhook handler
app.post('/api/webhooks/daimo', webhookLimiter, webhookController.handleDaimoWebhook);
app.post('/api/webhooks/visa-cybersource', webhookLimiter, require('./controllers/visaCybersourceWebhookController').handleWebhook);
app.get('/api/webhooks/visa-cybersource/health', adminGuard, require('./controllers/visaCybersourceWebhookController').healthCheck);
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

// Payment API routes
// C5: getPaymentInfo exposes ePayco keys, signatures, and userId — requires authentication.
// Only the owner of the payment (or an admin) may load checkout data.
app.get('/api/payment/:paymentId', authenticateUser, asyncHandler(paymentController.getPaymentInfo));
// C5: getPaymentStatus is polled by the server-rendered payment-response page which has no
// session cookies. We protect it with a dedicated rate limiter to prevent payment-ID enumeration.
app.get('/api/payment/:paymentId/status', paymentStatusLimiter, asyncHandler(paymentController.getPaymentStatus));

// Update email for a payment (collected on checkout page instead of subscribe page)
app.post('/api/payment/:paymentId/email', authenticateUser, asyncHandler(async (req, res) => {
  const user = req.session?.user;
  if (!user?.id) return res.status(401).json({ success: false, error: 'Authentication required' });

  const { email } = req.body;
  if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || email.trim().length > 254) {
    return res.status(400).json({ success: false, error: 'A valid email address is required' });
  }

  const userId = String(user.telegramId || user.telegram_id || user.id);
  const language = user.language || 'es';

  try {
    await ensureEmailCredentials(userId, email.trim(), language);
    req.session.user = { ...req.session.user, email: email.trim() };
    res.json({ success: true });
  } catch (credErr) {
    if (credErr.message.includes('already associated')) {
      return res.status(409).json({ success: false, error: credErr.message });
    }
    logger.warn('ensureEmailCredentials failed (non-critical)', { userId, error: credErr.message });
    res.json({ success: true });
  }
}));

app.post('/api/payment/tokenized-charge', authenticateUser, asyncHandler(async (req, res) => {
  // After charge completes, provision email credentials from the card form email
  const originalJson = res.json.bind(res);
  res.json = function(data) {
    // Fire-and-forget email credential provisioning after successful charge
    if (data && data.success && req.body?.email && req.session?.user) {
      const email = String(req.body.email).trim();
      const userId = String(req.session.user.telegramId || req.session.user.telegram_id || req.session.user.id);
      const language = req.session.user.language || 'es';
      ensureEmailCredentials(userId, email, language)
        .then(() => { req.session.user = { ...req.session.user, email }; })
        .catch((err) => logger.warn('ensureEmailCredentials after tokenized-charge (non-critical)', { userId, error: err.message }));
    }
    return originalJson(data);
  };
  return paymentController.processTokenizedCharge(req, res);
}));
app.post('/api/payment/verify-2fa', authenticateUser, asyncHandler(paymentController.verify2FA));
app.post('/api/payment/complete-3ds-2', authenticateUser, asyncHandler(paymentController.complete3DS2Authentication));
app.get('/api/confirm-payment/:token', asyncHandler(paymentController.confirmPaymentToken));
// Payment recovery endpoints for stuck 3DS payments

app.post('/api/payment/:paymentId/retry-webhook', verifyAdminJWT, asyncHandler(paymentController.retryPaymentWebhook));

// PNP Live API routes (formerly Meet & Greet, now consolidated)
const PNPLiveService = require('../services/pnpLiveService');
const ModelService = require('../services/modelService');
const PaymentService = require('../services/paymentService');
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
  const UserService = require('../services/userService');
  const stats = await UserService.getStatistics();
  res.json(stats);
}));



// Playlist API routes (PROTECTED: require authentication)
app.get('/api/playlists/user', authenticateUser, asyncHandler(playlistController.getUserPlaylists));
app.get('/api/playlists/public', asyncHandler(playlistController.getPublicPlaylists));
app.post('/api/playlists', authenticateUser, asyncHandler(playlistController.createPlaylist));
app.post('/api/playlists/:playlistId/videos', authenticateUser, asyncHandler(playlistController.addToPlaylist));
app.delete('/api/playlists/:playlistId/videos/:videoId', authenticateUser, asyncHandler(playlistController.removeFromPlaylist));
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

// Recurring Subscription API routes
const VisaCybersourceService = require('../services/visaCybersourceService');

// Tokenize card for recurring subscription
app.post('/api/recurring/tokenize', authenticateUser, bindAuthenticatedUserId, asyncHandler(async (req, res) => {
  const { userId, cardToken } = req.body;

  // PCI DSS Compliance: Reject any raw card data sent to the server
  const forbiddenFields = ['cardNumber', 'cvc', 'expMonth', 'expYear', 'card_number', 'cvv', 'exp_month', 'exp_year'];
  for (const field of forbiddenFields) {
    if (req.body.hasOwnProperty(field)) {
      return res.status(400).json({
        success: false,
        error: 'Raw card data cannot be sent to server. Use ePayco.js tokenization in browser.'
      });
    }
  }

  if (!userId || !cardToken) {
    return res.status(400).json({ success: false, error: 'Missing required fields: userId and cardToken' });
  }

  // Token should be a pre-generated token from ePayco.js frontend tokenization.
  // The token is never echoed back in the response — doing so would expose it to
  // any MitM observer or browser extension that captures XHR responses.
  try {
    res.json({ success: true, message: 'Token received' });
  } catch (error) {
    logger.error('Error processing tokenized card:', error);
    res.status(500).json({ success: false, error: 'Failed to process token' });
  }
}));

// Rate limiter for recurring subscribe — 2 attempts per 10 minutes per user.
// Prevents automated subscription-creation loops and trial-period abuse where
// an attacker rapidly creates/cancels subscriptions to probe billing logic.
const recurringSubscribeLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 2,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.session?.user?.id || req.ip,
  handler: (req, res) => res.status(429).json({
    success: false,
    error: 'Too many subscription attempts. Please wait 10 minutes before trying again.',
  }),
});

// Create recurring subscription
app.post('/api/recurring/subscribe', recurringSubscribeLimiter, authenticateUser, bindAuthenticatedUserId, asyncHandler(async (req, res) => {
  // Security: userId is always taken from the authenticated session — never from req.body.
  // bindAuthenticatedUserId middleware already overwrites req.body.userId with the session
  // value, but we read directly from the session here as an explicit defence-in-depth
  // measure so that the auth source is unambiguous even if middleware order changes.
  const userId = getActorId(req);
  if (!userId) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }

  // trialDays is intentionally NOT accepted from the client body — trial duration is
  // determined server-side from the plan record to prevent free-trial abuse.
  const { planId, cardToken, email } = req.body;

  if (!planId) {
    return res.status(400).json({ success: false, error: 'Missing required field: planId' });
  }

  const result = await VisaCybersourceService.createRecurringSubscription({
    userId,
    planId,
    cardToken,
    email,
  });

  res.json(result);
}));

// Get subscription details
app.get('/api/recurring/subscription/:userId', authenticateUser, requireSelfOrAdmin, asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const subscription = await VisaCybersourceService.getSubscriptionDetails(userId);
  res.json({ success: true, subscription });
}));

// Cancel subscription
app.post('/api/recurring/cancel', authenticateUser, bindAuthenticatedUserId, asyncHandler(async (req, res) => {
  const { userId, immediately } = req.body;

  if (!userId) {
    return res.status(400).json({ success: false, error: 'Missing userId' });
  }

  const result = await VisaCybersourceService.cancelRecurringSubscription(userId, immediately || false);
  res.json(result);
}));

// Reactivate subscription
app.post('/api/recurring/reactivate', authenticateUser, bindAuthenticatedUserId, asyncHandler(async (req, res) => {
  const { userId } = req.body;

  if (!userId) {
    return res.status(400).json({ success: false, error: 'Missing userId' });
  }

  const result = await VisaCybersourceService.reactivateSubscription(userId);
  res.json(result);
}));

// Subscription API routes
app.get('/api/subscription/plans', asyncHandler(subscriptionController.getPlans));
app.post('/api/subscription/create-plan', verifyAdminJWT, asyncHandler(subscriptionController.createEpaycoPlan));
app.get('/api/subscription/subscriber/:identifier', verifyAdminJWT, asyncHandler(subscriptionController.getSubscriber));
app.get('/api/subscription/stats', verifyAdminJWT, asyncHandler(subscriptionController.getStatistics));

// Audio Management API
const audioStreamer = require('../../services/audioStreamer');

// List all available audio files
app.get('/api/audio/list', verifyAdminJWT, asyncHandler(async (req, res) => {
  const files = audioStreamer.listAudioFiles();
  res.json({
    success: true,
    files,
    current: audioStreamer.getCurrentTrack()
  });
}));

// Setup background audio from SoundCloud (PROTECTED: require authentication)
app.post('/api/audio/setup-soundcloud', authenticateUser, asyncHandler(async (req, res) => {
  const { soundcloudUrl, trackName = 'background-music' } = req.body;

  if (!soundcloudUrl) {
    return res.status(400).json({
      success: false,
      message: 'SoundCloud URL is required'
    });
  }

  try {
    const result = await audioStreamer.setupBackgroundAudio(soundcloudUrl, trackName);
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to setup audio',
      error: error.message
    });
  }
}));

// Get current audio track
app.get('/api/audio/current', asyncHandler(async (req, res) => {
  const current = audioStreamer.getCurrentTrack();
  res.json({
    success: true,
    current
  });
}));

// Stop background audio (PROTECTED: require authentication)
app.post('/api/audio/stop', authenticateUser, asyncHandler(async (req, res) => {
  audioStreamer.stopBackgroundAudio();
  res.json({
    success: true,
    message: 'Background audio stopped'
  });
}));

// Delete audio file
app.delete('/api/audio/:filename', verifyAdminJWT, asyncHandler(async (req, res) => {
  const { filename } = req.params;

  try {
    const deleted = audioStreamer.deleteAudioFile(filename);
    res.json({
      success: deleted,
      message: deleted ? 'Audio file deleted' : 'Audio file not found'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to delete audio',
      error: error.message
    });
  }
}));

// ==========================================
// Hangouts API (PROTECTED: create/join require authentication)
// ==========================================
app.get('/api/hangouts/public', requireSessionAuth, asyncHandler(hangoutsController.listPublic));
app.post('/api/hangouts/create', authenticateUser, asyncHandler(hangoutsController.create));
app.post('/api/hangouts/join/:callId', authenticateUser, asyncHandler(hangoutsController.join));

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
      'SELECT * FROM radio_now_playing WHERE id = 1'
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

// Audio stream proxy (streams current radio track from Ampache)
app.get('/api/radio/stream', requireSessionAuth, asyncHandler(async (req, res) => {
  try {
    const AmpacheService = require('../services/ampacheService');
    const pool = getPool();

    // Get current radio track's Ampache ID
    const result = await pool.query('SELECT ampache_song_id FROM radio_now_playing WHERE id = 1');
    const songId = result.rows[0]?.ampache_song_id;

    if (!songId) {
      return res.status(404).json({ success: false, error: 'No radio stream configured' });
    }

    // Get stream URL from Ampache
    const streamUrl = await AmpacheService.getStreamUrl('song', songId);

    // Proxy the stream
    const upstream = await axios.get(streamUrl, { responseType: 'stream', timeout: 30000 });
    res.setHeader('Content-Type', upstream.headers['content-type'] || 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Accept-Ranges', 'bytes');

    upstream.data.pipe(res);

    upstream.data.on('error', (err) => {
      logger.error('Ampache stream error:', err);
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: 'Stream error' });
      }
    });
  } catch (error) {
    logger.error('Radio stream error:', error);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: 'Failed to get radio stream' });
    }
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

app.use('/api/admin/x/oauth', xOAuthAdminGuard, xOAuthRoutes);
app.use('/api/auth/x', xOAuthRoutes); // Alias for X Developer Portal redirect URI
app.use('/api/x/followers', xFollowersRoutes);

// Health Check and Monitoring Endpoints
app.get('/api/health', healthLimiter, asyncHandler(healthController.healthCheck));
app.get('/api/metrics', healthLimiter, adminGuard, asyncHandler(healthController.performanceMetrics));
app.post('/api/metrics/reset', healthLimiter, adminGuard, asyncHandler(healthController.resetMetrics));

// ==========================================
// PRIME Hub Web App API Routes
// ==========================================
const webAppController = require('./controllers/webAppController');
// Phase 1 controllers:
const userLocationController = require('../../api/controllers/userLocationController');
const blockedUsersController = require('../../api/controllers/blockedUsersController');
const directMessagesController = require('../../api/controllers/directMessagesController');
const notificationsController = require('../../api/controllers/notificationsController');

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
app.get('/api/webapp/auth/verify-email', verifyEmailLimiter, asyncHandler(webAppController.verifyEmail));
app.post('/api/webapp/auth/resend-verification', authLimiter, asyncHandler(webAppController.resendVerification));
app.get('/api/webapp/auth/x/start', asyncHandler(webAppController.xLoginStart));
app.get('/api/webapp/auth/x/callback', asyncHandler(webAppController.xLoginCallback));
app.post('/api/webapp/auth/x/unlink', requireSessionAuth, asyncHandler(webAppController.unlinkX));
app.get('/api/me', asyncHandler(webAppController.authStatus));
app.post('/api/webapp/auth/logout', asyncHandler(webAppController.logout));
app.post('/api/webapp/auth/forgot-password', authLimiter, asyncHandler(webAppController.forgotPassword));
app.post('/api/webapp/auth/reset-password', authLimiter, asyncHandler(webAppController.resetPassword));

// Web App Profile
app.get('/api/webapp/profile', requireSessionAuth, asyncHandler(webAppController.getProfile));
app.put('/api/webapp/profile', requireSessionAuth, asyncHandler(webAppController.updateProfile));
app.post('/api/webapp/profile/avatar', requireSessionAuth, uploadLimiter, avatarUpload.single('avatar'), asyncHandler(webAppController.uploadAvatar));

// Web App Privacy Settings
app.patch('/api/webapp/privacy', asyncHandler(async (req, res) => {
  const user = req.session?.user;
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  const ALLOWED_KEYS = ['showBio', 'showOnline', 'showLocation', 'showDob', 'allowMessages', 'showInterests'];
  const updates = {};
  for (const key of ALLOWED_KEYS) {
    if (typeof req.body[key] === 'boolean') updates[key] = req.body[key];
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No valid privacy fields provided' });
  }

  const { query: dbQuery } = require('../../config/postgres');

  // Build jsonb_set chain
  let privacyExpr = "COALESCE(privacy, '{}'::jsonb)";
  const params = [user.id];
  for (const [key, val] of Object.entries(updates)) {
    params.push(JSON.stringify(val));
    privacyExpr = `jsonb_set(${privacyExpr}, '{${key}}', $${params.length}::jsonb)`;
  }

  try {
    const result = await dbQuery(
      `UPDATE users SET privacy = ${privacyExpr}, updated_at = NOW() WHERE id = $1 RETURNING privacy`,
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
app.post('/api/webapp/messages/send', requireFreeTierDmLimit, asyncHandler(directMessagesController.sendMessage));
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

// Web App Hangouts (session auth)
const webappHangoutsController = require('./controllers/webappHangoutsController');
app.get('/api/webapp/hangouts/public', requireSessionAuth, asyncHandler(webappHangoutsController.listPublic));
app.post('/api/webapp/hangouts/create', requireSessionAuth, requireMemberTier, asyncHandler(webappHangoutsController.createRoom));
app.post('/api/webapp/hangouts/join/:callId', requireSessionAuth, asyncHandler(webappHangoutsController.joinRoom));
app.post('/api/webapp/hangouts/leave/:callId', requireSessionAuth, asyncHandler(webappHangoutsController.leaveRoom));
app.delete('/api/webapp/hangouts/:callId', requireSessionAuth, asyncHandler(webappHangoutsController.endRoom));

// Live Rules Acknowledgment Gate
const liveRulesController = require('./controllers/liveRulesController');
app.get('/api/webapp/live/rules-status', requireSessionAuth, asyncHandler(liveRulesController.getRulesStatus));
app.post('/api/webapp/live/acknowledge-rules', requireSessionAuth, asyncHandler(liveRulesController.acknowledgeRules));

// Web App Live Streaming Routes
const webappLiveController = require('./controllers/webappLiveController');
app.get('/api/webapp/live/streams', requireSessionAuth, requireMemberTier, asyncHandler(webappLiveController.listStreams));
app.get('/api/webapp/live/rtmp-key', requireSessionAuth, asyncHandler(webappLiveController.getRtmpKey));
// Admin: manage Restreamer channel assignments
app.get('/api/webapp/admin/live/channels', adminGuard, asyncHandler(webappLiveController.listChannels));
app.post('/api/webapp/admin/live/assign-channel', adminGuard, asyncHandler(webappLiveController.assignChannel));

// Streamer Settings: persistent encoder + filter preferences
const streamerSettingsController = require('./controllers/streamerSettingsController');
app.get('/api/webapp/live/settings', requireSessionAuth, asyncHandler(streamerSettingsController.getSettings));
app.put('/api/webapp/live/settings', requireSessionAuth, asyncHandler(streamerSettingsController.updateSettings));

// Stream Bridge: browser → RTMP via WebSocket+FFmpeg
const streamBridgeController = require('./controllers/streamBridgeController');
app.get('/api/webapp/live/my-channel', requireSessionAuth, asyncHandler(streamBridgeController.getMyChannel));

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
app.get('/api/webapp/live/stream-profile', requireSessionAuth, asyncHandler(streamAutoController.getStreamProfile));
app.post('/api/webapp/live/stream-profile', requireSessionAuth, grokStreamChatLimiter, asyncHandler(streamAutoController.saveStreamProfile));
app.post('/api/webapp/live/stream-auto-start', requireSessionAuth, asyncHandler(streamAutoController.startAutoMessages));
app.post('/api/webapp/live/stream-auto-stop', requireSessionAuth, asyncHandler(streamAutoController.stopAutoMessages));

// Stream Overlay Management (admin CRUD + public viewer endpoint)
// Socket.IO access uses socketSingleton.get() directly inside the controller —
// no wiring step needed here.
const streamOverlayController = require('./controllers/streamOverlayController');
app.get('/api/webapp/admin/stream-overlays', adminGuard, asyncHandler(streamOverlayController.listOverlays));
app.get('/api/webapp/admin/stream-overlays/:channelRef', adminGuard, asyncHandler(streamOverlayController.getOverlay));
app.put('/api/webapp/admin/stream-overlays/:channelRef', adminGuard, asyncHandler(streamOverlayController.updateOverlay));
// Public overlay endpoint — no auth, short cache, used by the frontend LivePlayer
app.get('/api/proxy/live/overlay/:channelRef', asyncHandler(streamOverlayController.getPublicOverlay));

// Overlay Asset Library (CMS-managed logos & banners)
const overlayLibraryController = require('./controllers/overlayLibraryController');
app.get('/api/webapp/admin/overlay-library', adminGuard, asyncHandler(overlayLibraryController.listAssets));

// ─── Direct Overlay Asset Upload (logos & banners stored on disk) ─────────────
// Ensure upload directories exist at startup
const OVERLAY_LOGOS_DIR = '/opt/pnptvapp/public/uploads/overlays/logos';
const OVERLAY_BANNERS_DIR = '/opt/pnptvapp/public/uploads/overlays/banners';
fs.mkdirSync(OVERLAY_LOGOS_DIR, { recursive: true });
fs.mkdirSync(OVERLAY_BANNERS_DIR, { recursive: true });

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

// Admin: manually trigger Cristina ticket worker
app.post('/api/admin/support/cristina/run', verifyAdminJWT, asyncHandler(async (req, res) => {
  const cristinaTicketWorker = require('../services/cristinaTicketWorker');
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

// Helper: HTML-escape for safe email template interpolation
function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Helper: ensure user has email + password credentials (for all payment flows)
async function ensureEmailCredentials(userId, email, language) {
  const crypto = require('crypto');
  const { query } = require('../../config/postgres');
  const EmailService = require('../services/emailservice');

  // 1. Check if another user already has this email (UNIQUE constraint)
  const { rows: emailConflict } = await query(
    'SELECT id FROM users WHERE email = $1 AND id != $2', [email, String(userId)]
  );
  if (emailConflict.length > 0) {
    throw new Error('This email is already associated with another account');
  }

  // 2. Check if user already has credentials — if so, just update email if different
  const { rows: existing } = await query('SELECT email, password_hash FROM users WHERE id = $1', [String(userId)]);
  if (!existing.length) {
    logger.warn('ensureEmailCredentials: user not found', { userId });
    return { created: false };
  }

  if (existing[0].password_hash) {
    // Already has password — update email if different, skip credential generation
    if (existing[0].email !== email) {
      await query('UPDATE users SET email = $1 WHERE id = $2', [email, String(userId)]);
    }
    return { created: false };
  }

  // 3. Generate 12-char random password (9 bytes → 12 base64url chars, 72 bits entropy)
  const plainPassword = crypto.randomBytes(9).toString('base64url');

  // 4. Hash with crypto.scrypt (same salt:hash pattern as webAppController.js)
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await new Promise((resolve, reject) =>
    crypto.scrypt(plainPassword, salt, 64, (err, key) => (err ? reject(err) : resolve(key.toString('hex'))))
  );
  const passwordHash = `${salt}:${hash}`;

  // 5. Atomic conditional update — only sets credentials if password_hash is still NULL
  //    Prevents race condition where two concurrent requests both generate passwords
  const { rowCount } = await query(
    `UPDATE users SET email = $1, password_hash = $2, email_verified = true
     WHERE id = $3 AND (password_hash IS NULL OR password_hash = '')
     RETURNING id`,
    [email, passwordHash, String(userId)]
  );

  // If another request already wrote credentials, skip email
  if (rowCount === 0) {
    return { created: false };
  }

  // 6. Send credentials email (only after DB write confirmed)
  const isEs = (language || 'es').startsWith('es');
  const safeEmail = escapeHtml(email);
  try {
    const transporter = EmailService.transporters?.pnptv;
    if (!transporter) {
      logger.warn('PNPtv SMTP transporter not available, credentials email not sent', { to: email });
    } else {
    await transporter.sendMail({
      from: process.env.PNPTV_FROM_EMAIL || 'noreply@pnptv.app',
      to: email,
      subject: isEs ? 'Tus credenciales de acceso PNPtv' : 'Your PNPtv Login Credentials',
      html: isEs
        ? `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#1C1C1E;color:#F5F5F7;border-radius:12px;">
            <h2 style="color:#D4007A;margin-top:0;">Bienvenido a PNPtv!</h2>
            <p>Ahora puedes iniciar sesi&oacute;n en la web con estas credenciales:</p>
            <table style="width:100%;border-collapse:collapse;margin:16px 0;">
              <tr><td style="padding:8px 0;color:#A1A1A6;">Email:</td><td style="padding:8px 0;font-weight:bold;">${safeEmail}</td></tr>
              <tr><td style="padding:8px 0;color:#A1A1A6;">Contrase&ntilde;a:</td><td style="padding:8px 0;font-weight:bold;font-family:monospace;font-size:16px;">${plainPassword}</td></tr>
            </table>
            <p style="font-size:13px;color:#A1A1A6;">Puedes cambiar tu contrase&ntilde;a en cualquier momento desde tu perfil.</p>
            <a href="https://app.pnptv.app/login" style="display:inline-block;margin-top:16px;padding:12px 24px;background:#D4007A;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;">Iniciar sesi&oacute;n</a>
          </div>`
        : `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#1C1C1E;color:#F5F5F7;border-radius:12px;">
            <h2 style="color:#D4007A;margin-top:0;">Welcome to PNPtv!</h2>
            <p>You can now log in to the web app with these credentials:</p>
            <table style="width:100%;border-collapse:collapse;margin:16px 0;">
              <tr><td style="padding:8px 0;color:#A1A1A6;">Email:</td><td style="padding:8px 0;font-weight:bold;">${safeEmail}</td></tr>
              <tr><td style="padding:8px 0;color:#A1A1A6;">Password:</td><td style="padding:8px 0;font-weight:bold;font-family:monospace;font-size:16px;">${plainPassword}</td></tr>
            </table>
            <p style="font-size:13px;color:#A1A1A6;">You can change your password anytime from your profile settings.</p>
            <a href="https://app.pnptv.app/login" style="display:inline-block;margin-top:16px;padding:12px 24px;background:#D4007A;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;">Log In</a>
          </div>`,
    });
    }
  } catch (emailErr) {
    logger.warn('Failed to send credentials email (non-critical)', { to: email, error: emailErr.message });
  }

  return { created: true };
}

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

    // 1. Check code exists and is available
    const meruLinkService = require('../../services/meruLinkService');
    const availableLinks = await meruLinkService.getAvailableLinks();
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
      const EntitlementAccessService = require('./services/entitlementAccessService');
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

    // 4. Invalidate the Meru link + mark activation code used (non-critical)
    try {
      await meruLinkService.invalidateLinkAfterActivation(meruCode, userId, username);
    } catch (e) {
      logger.warn('Failed to invalidate Meru link (non-critical)', { code: meruCode, error: e.message });
    }
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
      const BusinessNotificationService = require('../services/businessNotificationService');
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
      const InvoiceService = require('../services/invoiceservice');
      const EmailService = require('../services/emailservice');

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
            duration: 'Lifetime Member + 2 months PRIME',
            expiryDate: primeExpiry,
            language,
            onboardingGuidePdf: guidePdf,
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

app.post('/api/webapp/payments/create', requireSessionAuth, asyncHandler(async (req, res) => {
  const user = req.session?.user;
  if (!user?.id) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }

  const { planId, provider, creatorId, email } = req.body;
  if (!planId) {
    return res.status(400).json({ success: false, error: 'planId is required' });
  }
  if (provider && !['epayco', 'daimo'].includes(provider)) {
    return res.status(400).json({ success: false, error: 'Invalid provider. Must be epayco or daimo' });
  }
  if (email && (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || email.trim().length > 254)) {
    return res.status(400).json({ success: false, error: 'Invalid email address' });
  }

  const userId = String(user.telegramId || user.telegram_id || user.id);
  const language = user.language || 'es';

  const result = await PaymentService.createPayment({
    userId,
    planId,
    provider: provider || 'epayco',
    chatId: user.telegramId || user.telegram_id || null,
    creatorId: creatorId || null,
  });

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
app.get('/api/webapp/admin/x-campaigns', adminGuard, asyncHandler(xAutoCampaignAdminController.listCampaigns));
app.post('/api/webapp/admin/x-campaigns', adminGuard, asyncHandler(xAutoCampaignAdminController.createCampaign));
app.put('/api/webapp/admin/x-campaigns/:id', adminGuard, asyncHandler(xAutoCampaignAdminController.updateCampaign));
app.post('/api/webapp/admin/x-campaigns/:id/pause', adminGuard, asyncHandler(xAutoCampaignAdminController.pauseCampaign));
app.post('/api/webapp/admin/x-campaigns/:id/resume', adminGuard, asyncHandler(xAutoCampaignAdminController.resumeCampaign));
app.delete('/api/webapp/admin/x-campaigns/:id', adminGuard, asyncHandler(xAutoCampaignAdminController.deleteCampaign));
app.get('/api/webapp/admin/x-campaigns/:id/history', adminGuard, asyncHandler(xAutoCampaignAdminController.getCampaignHistory));
app.post('/api/webapp/admin/x-campaigns/:id/generate', adminGuard, asyncHandler(xAutoCampaignAdminController.triggerGenerate));

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
  const { chatWithGrokManager } = require('../services/grokService');
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
  let contextBlock = '';
  try {
    // Campaigns
    const { rows: campaigns } = await pool.query(`
      SELECT c.campaign_id, c.name, c.language, c.status, c.interval_minutes,
             c.active_hours_start, c.active_hours_end, c.total_generated,
             c.total_posted, c.total_failed, a.handle
      FROM x_auto_campaigns c
      JOIN x_accounts a ON c.account_id = a.account_id
      ORDER BY c.created_at DESC LIMIT 20`);

    // Recent post performance (last 7 days)
    const { rows: postStats } = await pool.query(`
      SELECT DATE(created_at) as day,
             COUNT(*) FILTER (WHERE status = 'sent') as sent,
             COUNT(*) FILTER (WHERE status = 'failed') as failed,
             COUNT(*) FILTER (WHERE status = 'scheduled') as scheduled
      FROM x_post_jobs
      WHERE created_at > NOW() - INTERVAL '7 days'
      GROUP BY DATE(created_at)
      ORDER BY day DESC LIMIT 7`);

    // User demographics
    const { rows: demog } = await pool.query(`
      SELECT
        COUNT(*) as total_users,
        COUNT(*) FILTER (WHERE tier = 'PRIME') as prime_users,
        COUNT(*) FILTER (WHERE tier = 'member') as member_users,
        COUNT(*) FILTER (WHERE tier = 'free' OR tier IS NULL) as free_users,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days') as new_last_30d,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days') as new_last_7d
      FROM users WHERE is_active = true`);

    // Language distribution
    const { rows: langs } = await pool.query(`
      SELECT COALESCE(language, 'unknown') as lang, COUNT(*) as cnt
      FROM users WHERE is_active = true
      GROUP BY language ORDER BY cnt DESC LIMIT 8`);

    // Accounts
    const { rows: accounts } = await pool.query(`
      SELECT handle, display_name, is_active FROM x_accounts ORDER BY updated_at DESC`);

    // Recent failed posts (for analysis)
    const { rows: recentFailed } = await pool.query(`
      SELECT j.error_message, c.name as campaign_name
      FROM x_post_jobs j
      JOIN x_auto_campaigns c ON j.campaign_id = c.campaign_id
      WHERE j.status = 'failed' AND j.created_at > NOW() - INTERVAL '7 days'
      ORDER BY j.created_at DESC LIMIT 5`);

    const d = demog[0] || {};
    const convRate = d.total_users > 0
      ? ((Number(d.prime_users) + Number(d.member_users)) / Number(d.total_users) * 100).toFixed(1)
      : '0';

    contextBlock = `=== PLATFORM DEMOGRAPHICS ===
Total active users: ${d.total_users || 0}
PRIME members: ${d.prime_users || 0} | Regular members: ${d.member_users || 0} | Free: ${d.free_users || 0}
Paid conversion rate: ${convRate}%
New users last 7 days: ${d.new_last_7d || 0} | Last 30 days: ${d.new_last_30d || 0}

Language distribution:
${langs.map(l => `  ${l.lang}: ${l.cnt} users`).join('\n') || '  No data'}

=== X ACCOUNTS ===
${accounts.map(a => `  @${a.handle} (${a.display_name || 'no display name'}) — ${a.is_active ? 'ACTIVE' : 'INACTIVE'}`).join('\n') || '  No accounts'}

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

  // Save updated history
  const assistantMsg = { role: 'assistant', content: replyText };
  const updatedHistory = [...messages, assistantMsg].slice(-MAX_HISTORY);
  await redis.set(redisKey, JSON.stringify(updatedHistory), 'EX', HISTORY_TTL).catch(() => {});

  res.json({ success: true, message: replyText });
}));

// Mono — personal AI business assistant
app.post('/api/webapp/admin/mono/chat', adminGuard, asyncHandler(async (req, res) => {
  const { chatWithMono } = require('../services/monoService');
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
    data: {
      ...stats,
      avg_first_response_hours: frt.avg_hours,
      avg_csat: csat.avg_csat,
      total_ratings: csat.total_ratings,
      awaiting_first_response: waiting.count,
      new_today: today.count,
    }
  });
}));

app.get('/api/webapp/admin/support/tickets', adminGuard, asyncHandler(async (req, res) => {
  const pool = getPool();
  const { status, priority, category, search, limit: lim, offset: off } = req.query;

  let where = [];
  let params = [];
  let idx = 1;

  if (status) { where.push(`st.status = $${idx++}`); params.push(status); }
  if (priority) { where.push(`st.priority = $${idx++}`); params.push(priority); }
  if (category) { where.push(`st.category = $${idx++}`); params.push(category); }
  if (search) {
    where.push(`(st.user_id ILIKE $${idx} OR st.thread_name ILIKE $${idx} OR u.username ILIKE $${idx} OR u.first_name ILIKE $${idx})`);
    params.push(`%${search}%`);
    idx++;
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limit = Math.min(parseInt(lim) || 50, 100);
  const offset = parseInt(off) || 0;

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

  res.json({ success: true, data: rows, total, limit, offset });
}));

app.get('/api/webapp/admin/support/tickets/:userId/messages', adminGuard, asyncHandler(async (req, res) => {
  const SupportTicketMessageModel = require('../../models/supportTicketMessageModel');
  const messages = await SupportTicketMessageModel.getByUserId(req.params.userId);
  res.json({ success: true, data: messages });
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
    const io = require('../services/socketSingleton').get();
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

  res.json({ success: true, data: saved });
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
      const io = require('../services/socketSingleton').get();
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

  res.json({ success: true, data: updated });
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
app.delete('/api/webapp/admin/users/:userId/entitlements/:addOnId', adminGuard, asyncHandler(webappAdminController.revokeUserEntitlement));
app.put('/api/webapp/admin/users/:userId/entitlements/:addOnId/extend', adminGuard, asyncHandler(webappAdminController.extendUserEntitlement));
// User-facing entitlements
app.get('/api/webapp/my-entitlements', requireSessionAuth, asyncHandler(webappAdminController.getMyEntitlements));

// Admin push broadcast
app.post('/api/webapp/admin/notifications/push', adminGuard, asyncHandler(webappAdminController.sendPushNotification));

// POST /api/webapp/admin/notifications/digest/test — trigger digest email for a user (SMTP test)
app.post('/api/webapp/admin/notifications/digest/test', adminGuard, asyncHandler(async (req, res) => {
  const { userId } = req.body;
  const targetUserId = userId || req.session.user.id;
  const digestScheduler = require('../services/notificationDigestScheduler');
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
app.get('/api/hangouts/most-active', asyncHandler(hangoutsController.getMostActiveHangout));

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

// ==========================================
// AMPACHE CATALOG ADMIN ROUTES
// ==========================================

// Browse Ampache catalog
app.get('/api/webapp/admin/ampache/catalog', adminGuard, asyncHandler(async (req, res) => {
  try {
    const AmpacheService = require('../services/ampacheService');
    const { type = 'songs', offset = 0, limit = 50 } = req.query;

    const items = type === 'videos'
      ? await AmpacheService.getVideos({ offset: +offset, limit: +limit })
      : await AmpacheService.getSongs({ offset: +offset, limit: +limit });

    res.json({ success: true, data: items, type, offset: +offset, limit: +limit });
  } catch (error) {
    logger.error('Error fetching Ampache catalog:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to fetch Ampache catalog' });
  }
}));

// Import single Ampache item to media_library
app.post('/api/webapp/admin/ampache/import', adminGuard, asyncHandler(async (req, res) => {
  try {
    const AmpacheService = require('../services/ampacheService');
    const pool = getPool();
    const { ampache_id, type, title, artist, cover_url, duration, is_prime = false } = req.body;

    if (!ampache_id || !title) {
      return res.status(400).json({ success: false, error: 'ampache_id and title are required' });
    }

    const streamUrl = await AmpacheService.getStreamUrl(type === 'video' ? 'video' : 'song', ampache_id);

    await pool.query(
      `INSERT INTO media_library (title, artist, url, type, duration, cover_url, is_prime, ampache_song_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (ampache_song_id) DO UPDATE SET title=$1, artist=$2, url=$3, cover_url=$6, is_prime=$7`,
      [title, artist || '', streamUrl, type || 'audio', duration || 0, cover_url || null, is_prime, String(ampache_id)]
    );

    res.json({ success: true, message: 'Item imported successfully' });
  } catch (error) {
    logger.error('Error importing Ampache item:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to import item' });
  }
}));

// Bulk sync Ampache catalog to media_library
app.post('/api/webapp/admin/ampache/sync', adminGuard, asyncHandler(async (req, res) => {
  try {
    const AmpacheService = require('../services/ampacheService');
    const pool = getPool();
    const { limit = 200 } = req.body;

    const songs = await AmpacheService.getSongs({ limit: Math.min(+limit, 500) });
    let imported = 0;

    for (const song of songs) {
      try {
        const streamUrl = await AmpacheService.getStreamUrl('song', song.id);
        await pool.query(
          `INSERT INTO media_library (title, artist, url, type, duration, cover_url, ampache_song_id)
           VALUES ($1, $2, $3, 'audio', $4, $5, $6)
           ON CONFLICT (ampache_song_id) DO UPDATE SET url=$3, title=$1`,
          [
            song.title || 'Unknown',
            (song.artist?.name || song.artist) || '',
            streamUrl,
            song.time || 0,
            song.art || null,
            String(song.id)
          ]
        );
        imported++;
      } catch (itemError) {
        logger.warn(`Failed to sync Ampache song ${song.id}:`, itemError.message);
      }
    }

    res.json({ success: true, imported, total: songs.length });
  } catch (error) {
    logger.error('Error syncing Ampache catalog:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to sync catalog' });
  }
}));

// Set current radio track from Ampache
app.post('/api/webapp/admin/ampache/set-radio', adminGuard, asyncHandler(async (req, res) => {
  try {
    const pool = getPool();
    const { ampache_id, title, artist, cover_url, duration } = req.body;

    if (!ampache_id) {
      return res.status(400).json({ success: false, error: 'ampache_id is required' });
    }

    await pool.query(
      `UPDATE radio_now_playing SET title=$1, artist=$2, cover_url=$3, duration=$4, ampache_song_id=$5,
       started_at=NOW() WHERE id=1`,
      [title || '', artist || '', cover_url || null, duration || 0, String(ampache_id)]
    );

    res.json({ success: true, message: 'Radio track updated' });
  } catch (error) {
    logger.error('Error setting radio track:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to set radio track' });
  }
}));

// Ampache server health check
app.get('/api/webapp/admin/ampache/ping', adminGuard, asyncHandler(async (req, res) => {
  try {
    const AmpacheService = require('../services/ampacheService');
    const result = await AmpacheService.ping();
    res.json({ success: true, data: result });
  } catch (error) {
    logger.error('Ampache ping error:', error);
    res.status(500).json({ success: false, error: error.message || 'Ampache server unreachable' });
  }
}));

// ==========================================
// Ampache Media File Management
// ==========================================
const AMPACHE_MEDIA_DIR = process.env.AMPACHE_MEDIA_DIR || '/media';
const AMPACHE_VALID_CATEGORIES = ['music', 'podcasts', 'videos'];

// GET /api/webapp/admin/ampache/files — List files in all 3 categories (or filter by ?category=)
app.get('/api/webapp/admin/ampache/files', adminGuard, asyncHandler(async (req, res) => {
  const { category } = req.query;
  if (category && !AMPACHE_VALID_CATEGORIES.includes(category)) {
    return res.status(400).json({ success: false, error: 'Invalid category. Must be music, podcasts, or videos.' });
  }
  const categoriesToList = category ? [category] : AMPACHE_VALID_CATEGORIES;
  const result = { music: [], podcasts: [], videos: [] };
  try {
    await Promise.all(categoriesToList.map(async (cat) => {
      const dirPath = `${AMPACHE_MEDIA_DIR}/${cat}`;
      let entries;
      try {
        entries = await fs.promises.readdir(dirPath);
      } catch (err) {
        if (err.code === 'ENOENT') return;
        throw err;
      }
      const stats = await Promise.all(
        entries.map(async (name) => {
          try {
            const stat = await fs.promises.lstat(`${dirPath}/${name}`);
            if (!stat.isFile() || stat.isSymbolicLink()) return null;
            return { name, size: stat.size, modified: stat.mtime.toISOString(), category: cat };
          } catch {
            return null;
          }
        })
      );
      result[cat] = stats.filter(Boolean);
    }));
    res.json({ success: true, files: result });
  } catch (error) {
    logger.error('Ampache list files error:', error);
    res.status(500).json({ success: false, error: 'Failed to list media files' });
  }
}));

// POST /api/webapp/admin/ampache/files/upload — Upload file(s) to a category directory

// Rate limiter: 10 uploads per 15 minutes per IP (admin-only route, but belt-and-suspenders)
const ampacheUploadRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ success: false, error: 'Too many uploads. Limit is 10 per 15 minutes.' }),
});

// Allowed magic bytes for audio and video uploads
const AMPACHE_ALLOWED_AUDIO_MIMES = new Set([
  'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/flac', 'audio/wav',
  'audio/x-flac', 'audio/aac', 'audio/x-m4a',
]);
const AMPACHE_ALLOWED_VIDEO_MIMES = new Set([
  'video/mp4', 'video/webm', 'video/x-matroska', 'video/quicktime',
]);

const ampacheUploadStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const { category } = req.body;
    if (!category || !AMPACHE_VALID_CATEGORIES.includes(category)) {
      return cb(new Error('Invalid or missing category'));
    }
    cb(null, `${AMPACHE_MEDIA_DIR}/${category}`);
  },
  filename: (req, file, cb) => {
    const sanitized = file.originalname.replace(/[^a-zA-Z0-9._\-]/g, '_');
    const stamp = Date.now();
    cb(null, `${stamp}-${sanitized}`);
  },
});
const ampacheUpload = multer({
  storage: ampacheUploadStorage,
  limits: { fileSize: 2 * 1024 * 1024 * 1024, files: 10 },
  fileFilter: (req, file, cb) => {
    const { category } = req.body;
    const audioMimes = ['audio/mpeg', 'audio/flac', 'audio/ogg', 'audio/wav', 'audio/aac', 'audio/mp4', 'audio/x-m4a'];
    const videoMimes = ['video/mp4', 'video/webm', 'video/x-matroska', 'video/quicktime'];
    const audioExts = /\.(mp3|flac|ogg|wav|aac|m4a)$/i;
    const videoExts = /\.(mp4|webm|mkv|mov)$/i;
    if (category === 'videos') {
      if (videoMimes.includes(file.mimetype) && videoExts.test(file.originalname)) return cb(null, true);
      return cb(new Error('Videos category only accepts mp4, webm, mkv, mov files'));
    }
    if (category === 'music' || category === 'podcasts') {
      if (audioMimes.includes(file.mimetype) && audioExts.test(file.originalname)) return cb(null, true);
      return cb(new Error(`${category} category only accepts mp3, flac, ogg, wav, aac, m4a files`));
    }
    cb(new Error('Invalid category'));
  },
});
app.post('/api/webapp/admin/ampache/files/upload', adminGuard, ampacheUploadRateLimit, (req, res, next) => {
  ampacheUpload.array('files', 10)(req, res, (err) => {
    if (err) {
      const status = err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      return res.status(status).json({ success: false, error: err.message });
    }
    next();
  });
}, asyncHandler(async (req, res) => {
  const { category } = req.body;
  if (!category || !AMPACHE_VALID_CATEGORIES.includes(category)) {
    return res.status(400).json({ success: false, error: 'Invalid or missing category. Must be music, podcasts, or videos.' });
  }
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ success: false, error: 'No files uploaded' });
  }

  // Magic byte validation — read the first 4100 bytes of each uploaded file from disk
  const allowedMimes = category === 'videos' ? AMPACHE_ALLOWED_VIDEO_MIMES : AMPACHE_ALLOWED_AUDIO_MIMES;
  const rejectedFiles = [];
  const acceptedFiles = [];
  await Promise.all(req.files.map(async (f) => {
    try {
      const fd = await fs.promises.open(f.path, 'r');
      const headerBuf = Buffer.alloc(4100);
      const { bytesRead } = await fd.read(headerBuf, 0, 4100, 0);
      await fd.close();
      const detected = await FileType.fromBuffer(headerBuf.slice(0, bytesRead));
      if (!detected || !allowedMimes.has(detected.mime)) {
        logger.warn(`Ampache upload: rejected file ${f.filename} — magic bytes mismatch (detected: ${detected?.mime ?? 'unknown'}, claimed: ${f.mimetype})`, { adminId: req.user?.id });
        await fs.promises.unlink(f.path).catch(() => {});
        rejectedFiles.push({ name: f.originalname, reason: 'Magic bytes do not match allowed media types for this category' });
      } else {
        acceptedFiles.push({ name: f.filename, size: f.size, category });
      }
    } catch (magicErr) {
      logger.error(`Ampache upload: magic byte check failed for ${f.filename}:`, magicErr);
      await fs.promises.unlink(f.path).catch(() => {});
      rejectedFiles.push({ name: f.originalname, reason: 'Could not verify file type' });
    }
  }));

  if (acceptedFiles.length === 0) {
    return res.status(400).json({ success: false, error: 'All uploaded files were rejected due to invalid file types', rejected: rejectedFiles });
  }

  logger.info(`Ampache upload: ${acceptedFiles.length} file(s) accepted, ${rejectedFiles.length} rejected for category ${category} by admin userId=${req.user?.id}`);

  // Trigger Ampache catalog scan so new files appear in radio immediately
  try {
    const AmpacheService = require('../services/ampacheService');
    const token = await AmpacheService.getAuthToken();
    const http = require('http');
    const scanUrl = `${process.env.AMPACHE_URL || 'http://ampache:80'}/server/json.server.php?action=catalog_action&auth=${encodeURIComponent(token)}&task=add_to_catalog&catalog=1`;
    http.get(scanUrl, () => {}).on('error', () => {});
    logger.info('Triggered Ampache catalog scan after upload');
  } catch (scanErr) {
    logger.warn('Could not trigger Ampache catalog scan:', scanErr.message);
  }

  res.json({ success: true, uploaded: acceptedFiles, ...(rejectedFiles.length > 0 && { rejected: rejectedFiles }) });
}));

// DELETE /api/webapp/admin/ampache/files/:category/:filename — Delete a single media file
app.delete('/api/webapp/admin/ampache/files/:category/:filename', adminGuard, asyncHandler(async (req, res) => {
  const { category, filename } = req.params;
  if (!AMPACHE_VALID_CATEGORIES.includes(category)) {
    return res.status(400).json({ success: false, error: 'Invalid category. Must be music, podcasts, or videos.' });
  }
  if (!filename || filename.includes('\0')) {
    return res.status(400).json({ success: false, error: 'Invalid filename' });
  }
  const filePath = path.resolve(AMPACHE_MEDIA_DIR, category, filename);
  const expectedBase = path.resolve(AMPACHE_MEDIA_DIR, category);
  if (!filePath.startsWith(expectedBase + path.sep) && filePath !== expectedBase) {
    return res.status(400).json({ success: false, error: 'Invalid filename' });
  }
  try {
    const stat = await fs.promises.lstat(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      return res.status(400).json({ success: false, error: 'Invalid filename' });
    }
    await fs.promises.unlink(filePath);
    logger.info(`Ampache delete: ${category}/${filename} by admin userId=${req.user?.id}`);
    res.json({ success: true });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return res.status(404).json({ success: false, error: 'File not found' });
    }
    logger.error('Ampache delete file error:', error);
    res.status(500).json({ success: false, error: 'Failed to delete file' });
  }
}));

// GET /api/webapp/admin/ampache/files/:category/:filename/tags — Read metadata tags
app.get('/api/webapp/admin/ampache/files/:category/:filename/tags', adminGuard, asyncHandler(async (req, res) => {
  const { category, filename } = req.params;
  if (!AMPACHE_VALID_CATEGORIES.includes(category)) {
    return res.status(400).json({ success: false, error: 'Invalid category' });
  }
  if (!filename || filename.includes('\0')) {
    return res.status(400).json({ success: false, error: 'Invalid filename' });
  }
  const filePath = path.resolve(AMPACHE_MEDIA_DIR, category, filename);
  const expectedBase = path.resolve(AMPACHE_MEDIA_DIR, category);
  if (!filePath.startsWith(expectedBase + path.sep)) {
    return res.status(400).json({ success: false, error: 'Invalid filename' });
  }
  try {
    const mm = require('music-metadata');
    const metadata = await mm.parseFile(filePath);
    const { title, artist, album, genre, year, track } = metadata.common;
    const duration = metadata.format.duration || 0;
    res.json({
      success: true,
      tags: {
        title: title || '',
        artist: artist || '',
        album: album || '',
        genre: (genre || [])[0] || '',
        year: year || null,
        track: track?.no || null,
        duration: Math.round(duration),
      },
    });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return res.status(404).json({ success: false, error: 'File not found' });
    }
    logger.error('Ampache read tags error:', error);
    res.status(500).json({ success: false, error: 'Failed to read metadata' });
  }
}));

// PUT /api/webapp/admin/ampache/files/:category/:filename/tags — Update metadata tags (MP3 only)
app.put('/api/webapp/admin/ampache/files/:category/:filename/tags', adminGuard, asyncHandler(async (req, res) => {
  const { category, filename } = req.params;
  if (!AMPACHE_VALID_CATEGORIES.includes(category)) {
    return res.status(400).json({ success: false, error: 'Invalid category' });
  }
  if (!filename || filename.includes('\0')) {
    return res.status(400).json({ success: false, error: 'Invalid filename' });
  }
  const filePath = path.resolve(AMPACHE_MEDIA_DIR, category, filename);
  const expectedBase = path.resolve(AMPACHE_MEDIA_DIR, category);
  if (!filePath.startsWith(expectedBase + path.sep)) {
    return res.status(400).json({ success: false, error: 'Invalid filename' });
  }

  // Only MP3 files support tag writing via node-id3
  const ext = path.extname(filename).toLowerCase();
  if (ext !== '.mp3') {
    return res.status(400).json({ success: false, error: 'Tag editing is only supported for MP3 files. For other formats, rename the file instead.' });
  }

  try {
    await fs.promises.access(filePath);
  } catch {
    return res.status(404).json({ success: false, error: 'File not found' });
  }

  const { title, artist, album, genre, year, trackNumber } = req.body;
  if (!title && !artist && !album && !genre && year === undefined && trackNumber === undefined) {
    return res.status(400).json({ success: false, error: 'No tags to update' });
  }

  try {
    const NodeID3 = require('node-id3');
    const tags = {};
    if (title !== undefined) tags.title = String(title).slice(0, 256);
    if (artist !== undefined) tags.artist = String(artist).slice(0, 256);
    if (album !== undefined) tags.album = String(album).slice(0, 256);
    if (genre !== undefined) tags.genre = String(genre).slice(0, 128);
    if (year !== undefined) tags.year = String(year).slice(0, 4);
    if (trackNumber !== undefined) tags.trackNumber = String(trackNumber).slice(0, 8);

    const result = NodeID3.update(tags, filePath);
    if (result !== true) {
      throw new Error('Failed to write ID3 tags');
    }

    logger.info(`Ampache tags updated: ${category}/${filename} by admin userId=${req.user?.id}`, tags);

    // Trigger Ampache catalog rescan so changes reflect in radio
    try {
      const AmpacheService = require('../services/ampacheService');
      const token = await AmpacheService.getAuthToken();
      const scanUrl = `${process.env.AMPACHE_URL || 'http://ampache:80'}/server/json.server.php?action=catalog_action&auth=${encodeURIComponent(token)}&task=add_to_catalog&catalog=1`;
      axios.get(scanUrl).catch(() => {});
    } catch (scanErr) {
      logger.warn('Could not trigger Ampache catalog scan after tag update:', scanErr.message);
    }

    res.json({ success: true });
  } catch (error) {
    logger.error('Ampache write tags error:', error);
    res.status(500).json({ success: false, error: 'Failed to update tags' });
  }
}));

// PUT /api/webapp/admin/ampache/files/:category/:filename/rename — Rename a media file
app.put('/api/webapp/admin/ampache/files/:category/:filename/rename', adminGuard, asyncHandler(async (req, res) => {
  const { category, filename } = req.params;
  const { newName } = req.body;

  if (!AMPACHE_VALID_CATEGORIES.includes(category)) {
    return res.status(400).json({ success: false, error: 'Invalid category' });
  }
  if (!filename || filename.includes('\0') || !newName || newName.includes('\0')) {
    return res.status(400).json({ success: false, error: 'Invalid filename' });
  }

  // Validate newName: must preserve extension, no path separators, reasonable length
  const oldExt = path.extname(filename).toLowerCase();
  const newExt = path.extname(newName).toLowerCase();
  if (oldExt !== newExt) {
    return res.status(400).json({ success: false, error: `File extension must remain ${oldExt}` });
  }
  if (newName.includes('/') || newName.includes('\\') || newName.length > 255) {
    return res.status(400).json({ success: false, error: 'Invalid new filename' });
  }
  // Sanitize: remove any characters that could cause filesystem issues
  const sanitized = newName.replace(/[<>:"|?*\x00-\x1F]/g, '');
  if (!sanitized || sanitized !== newName) {
    return res.status(400).json({ success: false, error: 'Filename contains invalid characters' });
  }

  const oldPath = path.resolve(AMPACHE_MEDIA_DIR, category, filename);
  const newPath = path.resolve(AMPACHE_MEDIA_DIR, category, sanitized);
  const expectedBase = path.resolve(AMPACHE_MEDIA_DIR, category);

  if (!oldPath.startsWith(expectedBase + path.sep) || !newPath.startsWith(expectedBase + path.sep)) {
    return res.status(400).json({ success: false, error: 'Invalid filename' });
  }

  try {
    await fs.promises.access(oldPath);
  } catch {
    return res.status(404).json({ success: false, error: 'File not found' });
  }

  // Check if target name already exists
  try {
    await fs.promises.access(newPath);
    return res.status(409).json({ success: false, error: 'A file with that name already exists' });
  } catch {
    // Good — target doesn't exist
  }

  try {
    await fs.promises.rename(oldPath, newPath);
    logger.info(`Ampache rename: ${category}/${filename} → ${sanitized} by admin userId=${req.user?.id}`);

    // Trigger Ampache catalog rescan
    try {
      const AmpacheService = require('../services/ampacheService');
      const token = await AmpacheService.getAuthToken();
      const scanUrl = `${process.env.AMPACHE_URL || 'http://ampache:80'}/server/json.server.php?action=catalog_action&auth=${encodeURIComponent(token)}&task=add_to_catalog&catalog=1`;
      axios.get(scanUrl).catch(() => {});
    } catch (scanErr) {
      logger.warn('Could not trigger Ampache catalog scan after rename:', scanErr.message);
    }

    res.json({ success: true, newName: sanitized });
  } catch (error) {
    logger.error('Ampache rename file error:', error);
    res.status(500).json({ success: false, error: 'Failed to rename file' });
  }
}));

// ─── Media Library Video Management (Prime toggle for Ampache videos) ─────────

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

// POST /api/webapp/admin/media-library/sync-video — Sync an Ampache video into media_library
app.post('/api/webapp/admin/media-library/sync-video', adminGuard, asyncHandler(async (req, res) => {
  try {
    const { filename, title, category } = req.body;
    if (!filename || typeof filename !== 'string' || !filename.trim()) {
      return res.status(400).json({ success: false, error: 'filename is required' });
    }
    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ success: false, error: 'title is required' });
    }
    const pool = getPool();
    // Check if already in library by filename match against title or url
    const existing = await pool.query(
      `SELECT id, title, is_prime, is_public, category FROM media_library
       WHERE type = 'video' AND (url ILIKE $1 OR title = $2)
       LIMIT 1`,
      [`%${filename.trim()}%`, title.trim()]
    );
    if (existing.rows.length > 0) {
      return res.json({ success: true, video: existing.rows[0], isNew: false });
    }
    const inserted = await pool.query(
      `INSERT INTO media_library (title, artist, url, type, category, is_prime, is_public)
       VALUES ($1, '', $2, 'video', $3, false, true)
       RETURNING id, title, artist, url, type, category, is_prime, is_public, created_at, updated_at`,
      [title.trim(), filename.trim(), (category || 'general').trim()]
    );
    return res.json({ success: true, video: inserted.rows[0], isNew: true });
  } catch (error) {
    logger.error('media-library/sync-video error', { error: error.message });
    return res.status(500).json({ success: false, error: 'Failed to sync video to media library' });
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
const { superadminGuard } = require('../../middleware/guards');
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
const hangoutVideoCallRoutes = require('./routes/hangoutVideoCallRoutes');
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
app.get('/api/webapp/hangouts/groups/:id', requireSessionAuth, asyncHandler(hangoutGroupController.getGroup));
app.post('/api/webapp/hangouts/groups/:id/join', requireSessionAuth, requireMemberTier, asyncHandler(hangoutGroupController.joinGroup));
app.post('/api/webapp/hangouts/groups/:id/leave', requireSessionAuth, asyncHandler(hangoutGroupController.leaveGroup));
app.delete('/api/webapp/hangouts/groups/:id', requireSessionAuth, asyncHandler(hangoutGroupController.deleteGroup));
// Join requests for private groups
app.post('/api/webapp/hangouts/groups/:id/request-join', requireSessionAuth, asyncHandler(hangoutGroupController.requestJoinGroup));
app.get('/api/webapp/hangouts/groups/:id/requests', requireSessionAuth, asyncHandler(hangoutGroupController.getJoinRequests));
app.post('/api/webapp/hangouts/groups/:id/requests/:requestId/:action', requireSessionAuth, asyncHandler(hangoutGroupController.handleJoinRequest));

// ── Hangout Group Chat ───────────────────────────────────────────────────────
app.get('/api/webapp/hangouts/groups/:id/messages', requireSessionAuth, requireMemberTier, asyncHandler(hangoutGroupController.getMessages));
app.post('/api/webapp/hangouts/groups/:id/messages', requireSessionAuth, requireMemberTier, asyncHandler(hangoutGroupController.sendMessage));
// Media upload for hangout group chat (images 10 MB / videos 50 MB, per-hangout dirs)
app.post(
  '/api/webapp/hangouts/groups/:id/media',
  requireSessionAuth,
  requireMemberTier,
  uploadLimiter,
  uploadHangoutMedia,
  asyncHandler(hangoutMediaController.uploadHangoutMedia)
);
// Mark group messages as read
app.post('/api/webapp/hangouts/groups/:id/read', requireSessionAuth, asyncHandler(hangoutGroupController.markAsRead));
// Legacy single-call endpoint (kept for backward compatibility)
app.post('/api/webapp/hangouts/groups/:id/call', requireSessionAuth, asyncHandler(hangoutGroupController.startCall));

// ── Hangout Video Calls (JaaS) ──────────────────────────────────────────────
app.use('/api/webapp/hangouts/groups', requireSessionAuth, hangoutVideoCallRoutes);

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

// Referral: get my code + stats
app.get('/api/webapp/me/referral', asyncHandler(async (req, res) => {
  const user = req.session?.user;
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const stats = await referralService.getReferralStats(user.id);
  return res.json({ ...stats, link: `https://pnptv.app/join?ref=${stats.code}` });
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
app.get('/api/webapp/dm/conversation/:partnerId', requireSessionAuth, asyncHandler(dmController.getConversation));
app.get('/api/webapp/dm/user/:partnerId', requireSessionAuth, asyncHandler(dmController.getPartnerInfo));
app.post('/api/webapp/dm/send/:recipientId', requireFreeTierDmLimit, asyncHandler(dmController.sendMessage));

// Social feed, wall, posts
// Public home-feed — no auth required, returns latest posts for the home page preview
app.get('/api/webapp/social/home-feed', asyncHandler(socialController.getHomeFeed));
// Authenticated feed — full paginated feed with liked_by_me per viewer
app.get('/api/webapp/social/feed', requireSessionAuth, asyncHandler(socialController.getFeed));
// Wall of Fame sub-feed — WoF-only posts
app.get('/api/webapp/social/wof-feed', asyncHandler(socialController.getWofFeed));
app.get('/api/webapp/social/wall/:userId', asyncHandler(socialController.getWall));
app.get('/api/webapp/social/profile/:userId', asyncHandler(socialController.getPublicProfile));
app.post('/api/webapp/social/posts', requireSessionAuth, socialPostLimiter, asyncHandler(socialController.createPost));
app.post('/api/webapp/social/posts/with-media', requireSessionAuth, socialPostLimiter, uploadLimiter, attachCreatorStatus, postMediaUploadMiddleware, asyncHandler(socialController.createPostWithMedia));
app.post('/api/webapp/social/posts/with-multi-media', requireSessionAuth, socialPostLimiter, uploadLimiter, attachCreatorStatus, postMultiMediaUploadMiddleware, asyncHandler(socialController.createPostWithMultiMedia));
app.post('/api/webapp/social/posts/bulk-videos', requireSessionAuth, bulkVideoLimiter, uploadPerformerVideos, asyncHandler(socialController.bulkCreateVideos));
app.post('/api/webapp/social/posts/:postId/like', requireSessionAuth, socialActionLimiter, asyncHandler(socialController.toggleLike));
app.delete('/api/webapp/social/posts/:postId', requireSessionAuth, asyncHandler(socialController.deletePost));
app.get('/api/webapp/social/posts/:postId', asyncHandler(socialController.getPost));
app.get('/api/webapp/social/posts/:postId/replies', requireSessionAuth, asyncHandler(socialController.getReplies));
app.post('/api/webapp/social/posts/:postId/mastodon', requireSessionAuth, socialActionLimiter, asyncHandler(socialController.postToMastodon));
app.post('/api/webapp/social/posts/:postId/request-deletion', requireSessionAuth, asyncHandler(socialController.requestWofDeletion));
app.get('/api/webapp/social/wof/leaderboard', asyncHandler(socialController.getWofLeaderboard));
app.get('/api/webapp/social/wof/stats', asyncHandler(socialController.getWofStats));
app.post('/api/admin/social/posts/:postId/wof', adminGuard, asyncHandler(socialController.adminFlagWof));
app.delete('/api/admin/social/posts/:postId/wof', adminGuard, asyncHandler(socialController.adminUnflagWof));

// ── Promoted Posts (CMS Sync) ────────────────────────────────────────────────
app.post('/api/admin/social/sync-promoted', adminGuard, asyncHandler(promotedPostController.handleSyncPromoted));
app.post('/api/admin/social/sync-content', adminGuard, asyncHandler(contentFeedSyncController.handleSyncContent));

// Users search
app.get('/api/webapp/users/search', asyncHandler(usersController.searchUsers));

// ── @Mention autocomplete ────────────────────────────────────────────────────
const mentionController = require('./controllers/mentionController');
app.get('/api/webapp/users/mention-search', requireSessionAuth, asyncHandler(mentionController.mentionSearch));

// ── Emoji Reactions ──────────────────────────────────────────────────────────
const reactionController = require('./controllers/reactionController');
// Post reactions
app.post('/api/webapp/social/posts/:postId/react', requireSessionAuth, socialActionLimiter, asyncHandler(reactionController.reactToPost));
app.get('/api/webapp/social/posts/:postId/reactions', asyncHandler(reactionController.getPostReactions));
// Chat message reactions
app.post('/api/webapp/chat/messages/:messageId/react', requireSessionAuth, asyncHandler(reactionController.reactToChatMessage));
app.get('/api/webapp/chat/messages/:messageId/reactions', asyncHandler(reactionController.getChatReactions));
// DM reactions
app.post('/api/webapp/dm/messages/:messageId/react', requireSessionAuth, asyncHandler(reactionController.reactToDm));

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

// Account self-deletion
const deleteAccountLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 1,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `delete-acct:${req.session?.user?.id || req.ip}`,
  handler: (_req, res) => res.status(429).json({ error: 'Too many requests' }),
});
app.delete('/api/webapp/account', requireSessionAuth, deleteAccountLimiter, asyncHandler(usersController.deleteMyAccount));

// ==========================================
// SERVICE PROXY ENDPOINTS (Media, Live, Social)
// Frontend calls these; backend handles auth to each service
// ==========================================

// --- Ampache Media Proxy ---
// Fix 2: requireSessionAuth on all three routes (tokens must not be exposed to unauthenticated callers)
// Fix 3: Strip Ampache session token from outgoing track objects (never expose internal auth tokens to clients)
// Fix 4: Validate songId as numeric only (SSRF prevention)
// Fix 5: Proxy the audio stream through Express (browser cannot reach http://ampache:80)
// Fix 6: Use parseInt for offset/limit (unary + coerces NaN to 0 silently; parseInt + bounds enforced)
app.get('/api/proxy/media/tracks', requireSessionAuth, asyncHandler(async (req, res) => {
  try {
    const AmpacheService = require('../services/ampacheService');
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    const limit = Math.min(Math.max(1, parseInt(req.query.limit, 10) || 20), 100);
    const songs = await AmpacheService.getSongs({ offset, limit });
    const safeTracks = (songs || []).map(s => ({
      id: s.id,
      title: s.title,
      artist: s.artist,
      album: s.album,
      art: s.art,
      time: s.time,
    }));
    res.json({ success: true, tracks: safeTracks });
  } catch (error) {
    logger.error(`Media proxy tracks error: ${error.message}`);
    res.json({ success: true, tracks: [] });
  }
}));

app.get('/api/proxy/media/search', requireSessionAuth, asyncHandler(async (req, res) => {
  try {
    const AmpacheService = require('../services/ampacheService');
    const q = (req.query.q || '').trim();
    const limit = Math.min(Math.max(1, parseInt(req.query.limit, 10) || 20), 100);
    if (!q) {
      return res.json({ success: true, tracks: [] });
    }
    const token = await AmpacheService.getAuthToken();
    const resp = await axios.get(`${process.env.AMPACHE_URL || 'http://ampache:80'}/server/json.server.php`, {
      params: { action: 'search_songs', auth: token, filter: q, limit },
      timeout: 10000,
    });
    const songs = resp.data.song || [];
    const raw = Array.isArray(songs) ? songs : [songs];
    const safeTracks = raw.map(s => ({
      id: s.id,
      title: s.title,
      artist: s.artist,
      album: s.album,
      art: s.art,
      time: s.time,
    }));
    res.json({ success: true, tracks: safeTracks });
  } catch (error) {
    logger.error(`Media proxy search error: ${error.message}`);
    res.json({ success: true, tracks: [] });
  }
}));

app.get('/api/proxy/media/stream/:songId', requireSessionAuth, asyncHandler(async (req, res) => {
  const id = req.params.songId;
  if (!/^\d+$/.test(id)) {
    return res.status(400).json({ success: false, error: 'Invalid song ID' });
  }
  try {
    const AmpacheService = require('../services/ampacheService');
    const streamUrl = await AmpacheService.getStreamUrl('song', id);
    const rangeHeader = req.headers.range;
    const upstream = await axios.get(streamUrl, {
      responseType: 'stream',
      timeout: 30000,
      headers: rangeHeader ? { Range: rangeHeader } : {},
    });
    res.setHeader('Content-Type', upstream.headers['content-type'] || 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Accept-Ranges', 'bytes');
    if (upstream.headers['content-length']) {
      res.setHeader('Content-Length', upstream.headers['content-length']);
    }
    if (upstream.status === 206) res.status(206);
    upstream.data.pipe(res);
    upstream.data.on('error', () => {
      if (!res.headersSent) res.status(500).end();
    });
  } catch (error) {
    logger.error(`Media proxy stream error: ${error.message}`);
    if (!res.headersSent) res.status(500).json({ success: false, error: 'Stream unavailable' });
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
    const streams = processes
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
          id: p.id,
          name: p.metadata?.['restreamer-ui']?.meta?.name || 'Live Stream',
          description: p.metadata?.['restreamer-ui']?.meta?.description || '',
          hlsUrl: `${publicUrl}/memfs/${refId}.m3u8`,
          isLive: p.state?.exec === 'running',
        };
      })
      .filter(Boolean);

    res.json({ success: true, streams });
  } catch (error) {
    logger.warn(`Live proxy streams unavailable: ${error.message}`);
    res.json({ success: true, streams: [] });
  }
}));

// --- Bluesky Social Proxy ---
let _pdsAccessJwt = null;
let _pdsJwtExpiry = 0;

async function getPdsAccessToken() {
  const now = Date.now();
  if (_pdsAccessJwt && now < _pdsJwtExpiry) {
    return _pdsAccessJwt;
  }
  const pdsUrl = process.env.BLUESKY_PDS_URL || 'http://bluesky-pds:3000';
  const pdsHandle = process.env.PDS_ADMIN_HANDLE || '';
  const pdsPassword = process.env.PDS_ACCOUNT_PASSWORD || '';
  if (!pdsHandle || !pdsPassword) return null;

  const resp = await axios.post(`${pdsUrl}/xrpc/com.atproto.server.createSession`, {
    identifier: pdsHandle,
    password: pdsPassword,
  }, { timeout: 10000 });

  _pdsAccessJwt = resp.data?.accessJwt;
  // Cache for 90 minutes (tokens last ~2 hours)
  _pdsJwtExpiry = now + 90 * 60 * 1000;
  return _pdsAccessJwt;
}

app.get('/api/proxy/social/feed', requireSessionAuth, asyncHandler(async (req, res) => {
  try {
    const pdsUrl = process.env.BLUESKY_PDS_URL || 'http://bluesky-pds:3000';
    const pdsHandle = process.env.PDS_ADMIN_HANDLE || '';
    const { limit = 20 } = req.query;

    if (!pdsHandle) {
      return res.json({ success: true, posts: [], message: 'No PDS handle configured' });
    }

    // Authenticate to PDS
    const token = await getPdsAccessToken();
    const headers = token ? { Authorization: `Bearer ${token}` } : {};

    // Self-hosted PDS: use listRecords instead of getAuthorFeed
    // (getAuthorFeed requires AppView relay which standalone PDS lacks)
    const handleResp = await axios.get(`${pdsUrl}/xrpc/com.atproto.identity.resolveHandle`, {
      params: { handle: pdsHandle },
      timeout: 5000,
    });
    const did = handleResp.data?.did;
    if (!did) {
      return res.json({ success: true, posts: [], message: 'Could not resolve handle' });
    }

    const resp = await axios.get(`${pdsUrl}/xrpc/com.atproto.repo.listRecords`, {
      params: { repo: did, collection: 'app.bsky.feed.post', limit: +limit, reverse: true },
      headers,
      timeout: 10000,
    });

    // Also get the profile for display info
    let profileName = '';
    try {
      const profileResp = await axios.get(`${pdsUrl}/xrpc/com.atproto.repo.getRecord`, {
        params: { repo: did, collection: 'app.bsky.actor.profile', rkey: 'self' },
        headers,
        timeout: 5000,
      });
      profileName = profileResp.data?.value?.displayName || '';
    } catch (_) { /* ignore if no profile */ }

    const posts = (resp.data?.records || []).map((record) => ({
      uri: record.uri,
      cid: record.cid,
      author: {
        handle: pdsHandle,
        displayName: profileName,
        avatar: '',
      },
      record: {
        text: record.value?.text || '',
        createdAt: record.value?.createdAt || '',
      },
      likeCount: 0,
      repostCount: 0,
      replyCount: 0,
    }));

    res.json({ success: true, posts });
  } catch (error) {
    logger.error(`Social proxy feed error: ${error.message}`);
    // Clear cached token on auth errors
    if (error.response?.status === 401) {
      _pdsAccessJwt = null;
      _pdsJwtExpiry = 0;
    }
    res.json({ success: true, posts: [], message: 'Feed temporarily unavailable' });
  }
}));

// Directus CMS internal URL (used by live performers and other CMS-backed routes)
const DIRECTUS_INTERNAL_URL = process.env.DIRECTUS_URL || 'http://172.20.0.18:8055';

// --- Hangouts Proxy (Jitsi rooms for React SPA) ---
const JitsiService = require('../services/jitsiService');

// GET /api/proxy/hangouts/rooms — List active public rooms
app.get('/api/proxy/hangouts/rooms', asyncHandler(async (req, res) => {
  try {
    const rooms = await JitsiService.getActiveRooms();
    res.json({ success: true, rooms: (rooms || []).map(r => ({
      id: r.id,
      room_code: r.room_code,
      title: r.title || 'Hangout Room',
      tier: r.tier || 'mini',
      host_name: r.host_name || 'Host',
      host_user_id: r.host_user_id,
      is_public: r.is_public !== false,
      max_participants: r.max_participants || 10,
      current_participants: r.current_participants || 0,
      status: r.status || 'active',
      join_url: JitsiService.generateJoinUrl(r),
      created_at: r.created_at,
    }))});
  } catch (error) {
    logger.error(`Hangouts proxy list error: ${error.message}`);
    res.json({ success: true, rooms: [] });
  }
}));

// POST /api/proxy/hangouts/rooms — Create a room (auth required)
app.post('/api/proxy/hangouts/rooms', asyncHandler(async (req, res) => {
  const user = req.session?.user;
  if (!user) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }

  const { title, tier = 'mini', isPublic = true, password } = req.body;
  if (!title || typeof title !== 'string' || title.trim().length === 0) {
    return res.status(400).json({ success: false, error: 'Title is required' });
  }

  try {
    const result = await JitsiService.createRoom({
      userId: user.id,
      telegramId: user.telegram_id,
      displayName: user.display_name || user.first_name || user.username || 'User',
      tier: ['mini', 'medium', 'unlimited'].includes(tier) ? tier : 'mini',
      title: title.trim().slice(0, 80),
      isPublic: Boolean(isPublic),
      password: password || undefined,
    });

    res.json({
      success: true,
      room: {
        id: result.room.id,
        room_code: result.room.room_code,
        title: result.room.title,
        tier: result.room.tier,
        host_name: result.room.host_name,
        max_participants: result.room.max_participants,
        current_participants: 0,
        status: 'active',
        join_url: result.joinUrl,
        created_at: result.room.created_at,
      },
      joinUrl: result.joinUrl,
    });
  } catch (error) {
    logger.error(`Hangouts proxy create error: ${error.message}`);
    res.status(400).json({ success: false, error: error.message || 'Failed to create room' });
  }
}));

// GET /api/proxy/hangouts/rooms/:code — Get room details by code (auth required)
app.get('/api/proxy/hangouts/rooms/:code', requireSessionAuth, asyncHandler(async (req, res) => {
  try {
    const room = await JitsiService.getRoom(req.params.code);
    if (!room) {
      return res.status(404).json({ success: false, error: 'Room not found' });
    }

    const userId = req.session.user?.id;
    const isPublic = room.is_public !== false;
    const isHost = room.host_user_id && String(room.host_user_id) === String(userId);

    // For private rooms, verify the requesting user is the host or a member
    if (!isPublic && !isHost) {
      const isMember = await JitsiService.isRoomMember(room.id, userId).catch(() => false);
      if (!isMember) {
        return res.status(403).json({ success: false, error: 'Access denied' });
      }
    }

    res.json({
      success: true,
      room: {
        id: room.id,
        room_code: room.room_code,
        title: room.title || 'Hangout Room',
        tier: room.tier,
        host_name: room.host_name,
        host_user_id: room.host_user_id,
        is_public: isPublic,
        max_participants: room.max_participants,
        current_participants: room.current_participants || 0,
        status: room.status,
        join_url: JitsiService.generateJoinUrl(room),
        created_at: room.created_at,
      },
    });
  } catch (error) {
    logger.error(`Hangouts proxy get room error: ${error.message}`);
    res.status(500).json({ success: false, error: 'Failed to get room' });
  }
}));

// POST /api/proxy/hangouts/rooms/:code/join — Join a room (auth required)
app.post('/api/proxy/hangouts/rooms/:code/join', asyncHandler(async (req, res) => {
  const user = req.session?.user;
  if (!user) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }

  try {
    const result = await JitsiService.joinRoom(req.params.code, {
      userId: user.id,
      displayName: user.display_name || user.first_name || user.username || 'User',
      password: req.body.password,
    });
    res.json({ success: true, joinUrl: result.joinUrl });
  } catch (error) {
    logger.error(`Hangouts proxy join error: ${error.message}`);
    const status = error.message?.includes('full') ? 409
      : error.message?.includes('password') ? 403
      : error.message?.includes('ended') ? 410
      : 400;
    res.status(status).json({ success: false, error: error.message || 'Failed to join room' });
  }
}));

// POST /api/proxy/hangouts/rooms/:id/end — End a room (host only, auth required)
app.post('/api/proxy/hangouts/rooms/:id/end', asyncHandler(async (req, res) => {
  const user = req.session?.user;
  if (!user) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }

  try {
    await JitsiService.endRoom(parseInt(req.params.id, 10), user.id);
    res.json({ success: true });
  } catch (error) {
    logger.error(`Hangouts proxy end error: ${error.message}`);
    const status = error.message?.includes('host') || error.message?.includes('Only') ? 403 : 400;
    res.status(status).json({ success: false, error: error.message || 'Failed to end room' });
  }
}));

// GET /api/proxy/hangouts/my-rooms — User's created rooms (auth required)
app.get('/api/proxy/hangouts/my-rooms', asyncHandler(async (req, res) => {
  const user = req.session?.user;
  if (!user) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }

  try {
    const rooms = await JitsiService.getUserRooms(user.id, { status: 'active' });
    res.json({ success: true, rooms: (rooms || []).map(r => ({
      id: r.id,
      room_code: r.room_code,
      title: r.title || 'Hangout Room',
      tier: r.tier,
      host_name: r.host_name,
      max_participants: r.max_participants,
      current_participants: r.current_participants || 0,
      status: r.status,
      join_url: JitsiService.generateJoinUrl(r),
      created_at: r.created_at,
    }))});
  } catch (error) {
    logger.error(`Hangouts proxy my-rooms error: ${error.message}`);
    res.json({ success: true, rooms: [] });
  }
}));

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

app.get('/api/performers/featured', asyncHandler(async (req, res) => {
  try {
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
                creator_type, creator_status, creator_price_usd
         FROM users
         WHERE creator_status = 'active'
         ORDER BY creator_subscriber_count DESC NULLS LAST
         LIMIT 20`
      ),
    ]);

    const directusPerformers = directusResult.status === 'fulfilled'
      ? (directusResult.value.data?.data || [])
      : [];
    const dbCreators = dbResult.status === 'fulfilled'
      ? (dbResult.value.rows || [])
      : [];

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

    res.json({ success: true, performers: mapped });
  } catch (error) {
    logger.error(`Performers featured error: ${error.message}`);
    res.json({ success: true, performers: [] });
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

    // Track which DB user IDs are already covered by Directus performers
    const coveredUserIds = new Set(
      directusPerformers.filter(p => p.pnptv_id).map(p => String(p.pnptv_id))
    );

    // Add active creators from DB that aren't already in Directus
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

    // --- Inject currently-live users ---
    // Each Restreamer process has a 'reference' slug (e.g. 'pnptv-frank') that is set
    // when the channel is created via the Restreamer UI. Users are assigned a channel
    // via the users.live_channel column. We join the running processes against the DB
    // to resolve which user owns each active channel — no Redis hex lookup needed.
    if (liveProcesses.length > 0) {
      try {
        // Collect the reference slugs of all currently-running processes.
        const liveRefs = liveProcesses
          .map(p => (typeof p.reference === 'string' && p.reference) ? p.reference : null)
          .filter(Boolean);

        if (liveRefs.length > 0) {
          // Single DB query: find all users whose assigned channel is currently live.
          const placeholders = liveRefs.map((_, i) => `$${i + 1}`).join(',');
          const { rows: channelUsers } = await getPool().query(
            `SELECT id, username, first_name, last_name, photo_file_id, bio, live_channel
             FROM users
             WHERE live_channel IN (${placeholders})`,
            liveRefs
          );

          for (const u of channelUsers) {
            const channelRef = u.live_channel;

            // Sanitize reference before embedding in URL (prevent path traversal).
            const safeRef = typeof channelRef === 'string'
              ? channelRef.replace(/[^a-zA-Z0-9\-_.]/g, '')
              : null;
            const hlsUrl = safeRef && !safeRef.includes('..')
              ? `${restreamerPublicUrl}/memfs/${safeRef}.m3u8`
              : null;

            const uid = String(u.id);

            if (coveredUserIds.has(uid)) {
              // User is already in the performers/creators list — mark them live.
              for (const entry of mapped) {
                if (entry.userId && String(entry.userId) === uid) {
                  entry.isLive = true;
                  if (hlsUrl) entry.hlsUrl = hlsUrl;
                  break;
                }
              }
            } else {
              // User has a live stream but is not yet in the performers list — inject them.
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
const PNPLiveTipsService = require('../services/pnpLiveTipsService');

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
app.get('/api/proxy/live/performers', asyncHandler(async (req, res) => {
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
// paymentMethod: 'daimo' (default) | 'tokens' (instant, deducts from wallet)
app.post('/api/proxy/live/tips', requireSessionAuth, requireMemberTier, tipLimiter, asyncHandler(async (req, res) => {
  const user = req.session?.user;

  const { performerId, amount, message, paymentMethod = 'daimo', idempotencyKey } = req.body;
  if (!performerId || !amount) {
    return res.status(400).json({ success: false, error: 'performerId and amount are required' });
  }

  const validAmounts = PNPLiveTipsService.TIP_AMOUNTS;
  const numAmount = parseFloat(amount);
  if (!validAmounts.includes(numAmount)) {
    return res.status(400).json({ success: false, error: `Amount must be one of: ${validAmounts.join(', ')}` });
  }

  if (!['daimo', 'tokens'].includes(paymentMethod)) {
    return res.status(400).json({ success: false, error: 'paymentMethod must be daimo or tokens' });
  }

  try {
    const userId = String(user.telegram_id || user.id);

    // --- Resolve performer ID ---
    // The frontend may send a Restreamer process ID (e.g. 'restreamer-ui:ingest:pnptv-santino')
    // instead of a Directus performer ID. Resolve it to the actual performer via the
    // users.live_channel → performers.user_id chain.
    let resolvedPerformerId = String(performerId);
    const restreamerMatch = resolvedPerformerId.match(/^restreamer-ui:ingest:([\w-]+)$/);
    if (restreamerMatch) {
      const channelRef = restreamerMatch[1];
      try {
        const { rows } = await getPool().query(
          `SELECT p.id AS performer_id FROM performers p
           JOIN users u ON p.user_id = u.id
           WHERE u.live_channel = $1
           LIMIT 1`,
          [channelRef]
        );
        if (rows.length > 0 && rows[0].performer_id) {
          resolvedPerformerId = String(rows[0].performer_id);
        } else {
          // No performer linked — try using the user ID directly as performer lookup
          const userRows = await getPool().query('SELECT id FROM users WHERE live_channel = $1 LIMIT 1', [channelRef]);
          if (userRows.rows.length > 0) {
            resolvedPerformerId = String(userRows.rows[0].id);
          }
        }
      } catch (resolveErr) {
        logger.warn(`Tips: failed to resolve channel ref '${channelRef}' to performer: ${resolveErr.message}`);
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

      const DashTokenService = require('../services/dashTokenService');
      const debit = await DashTokenService.debitTokens(userId, numAmount);
      if (!debit.success) {
        return res.status(402).json({ success: false, error: debit.error || 'Insufficient token balance' });
      }

      const tip = await PNPLiveTipsService.createTip(
        userId, null, null,
        numAmount,
        (message || '').slice(0, 200),
        String(resolvedPerformerId)
      );

      if (!tip) {
        // Refund tokens on failure
        await DashTokenService.creditTokens(userId, numAmount, `refund-tip-fail-${Date.now()}`, { usdAmount: numAmount }).catch(() => {});
        return res.status(500).json({ success: false, error: 'Failed to create tip' });
      }

      // Mark tip as immediately paid
      await PNPLiveTipsService.confirmTipPayment(tip.id, `TOKEN-${tip.id}`);

      // Emit real-time tip event
      try {
        const tipInfo = await PNPLiveTipsService.getTipById(tip.id);
        const socketSingleton = require('../services/socketSingleton');
        const io = socketSingleton.get ? socketSingleton.get() : socketSingleton;
        if (io && tipInfo) {
          const tipPayload = {
            id: tipInfo.id,
            amount: parseFloat(tipInfo.amount),
            username: tipInfo.user_username || 'Anonymous',
            performerName: tipInfo.model_name || 'Performer',
            message: tipInfo.message || '',
            createdAt: tipInfo.created_at,
            paymentMethod: 'tokens',
          };
          // Emit to the specific performer's live room; all viewers in that room receive it
          // Emit to both the resolved performer room and the original stream room
          io.to(`live:${String(resolvedPerformerId)}`).emit('live:tip', tipPayload);
          if (resolvedPerformerId !== String(performerId)) {
            io.to(`live:${String(performerId)}`).emit('live:tip', tipPayload);
          }
          // Notify sender of new balance
          const socketId = req.session?.socketId;
          if (socketId) {
            io.to(socketId).emit('wallet:updated', { balance: debit.newBalance });
          }
        }
      } catch (emitErr) {
        logger.warn(`Token tip socket emit failed: ${emitErr.message}`);
      }

      return res.json({
        success: true,
        tipId: tip.id,
        paymentUrl: null,
        amount: numAmount,
        paymentMethod: 'tokens',
        newBalance: debit.newBalance,
      });
    }

    // --- Daimo payment flow (existing) ---
    const tip = await PNPLiveTipsService.createTip(
      userId,
      null,       // model_id (legacy, no longer used)
      null,       // booking_id
      numAmount,
      (message || '').slice(0, 200),
      String(resolvedPerformerId)  // performer_id (resolved from channel ref if needed)
    );

    if (!tip) {
      return res.status(500).json({ success: false, error: 'Failed to create tip' });
    }

    // Try to create Daimo payment
    let paymentUrl = null;
    try {
      const { createDaimoPayment } = require('../../config/daimo');
      const daimoResult = await createDaimoPayment({
        amount: numAmount,
        userId,
        planId: `tip-${tip.id}`,
        paymentId: `TIP-${tip.id}`,
        description: `Tip for ${performerName}`,
      });
      if (daimoResult.success && daimoResult.daimoPaymentId) {
        paymentUrl = `https://pay.daimo.com/checkout?session=${daimoResult.daimoPaymentId}`;
      }
    } catch (daimoErr) {
      logger.warn(`Daimo payment creation failed for tip, falling back: ${daimoErr.message}`);
    }

    res.json({
      success: true,
      tipId: tip.id,
      paymentUrl,
      amount: numAmount,
      paymentMethod: 'daimo',
    });
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
        const socketSingleton = require('../services/socketSingleton');
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
const DashTokenService = require('../services/dashTokenService');
const { createDashInvoice, validateWebhookSignature, checkBtcpayHealth, isConfigured: btcpayConfigured } = require('../../config/btcpay');

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

const TokenCheckoutService = require('../services/tokenCheckoutService');

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

// POST /api/wallet/buy-wallet — purchase tokens via Daimo crypto wallet checkout
app.post('/api/wallet/buy-wallet', asyncHandler(async (req, res) => {
  const user = req.session?.user;
  if (!user) return res.status(401).json({ success: false, error: 'Authentication required' });

  const { packageId } = req.body;
  if (!packageId) return res.status(400).json({ success: false, error: 'packageId is required' });

  const userId = String(user.telegram_id || user.id);

  try {
    const result = await TokenCheckoutService.createWalletCheckout(userId, packageId);
    res.json(result);
  } catch (err) {
    logger.error(`Wallet buy-wallet error: ${err.message}`);
    if (err.code === 'INVALID_PACKAGE') {
      return res.status(400).json({ success: false, error: 'Invalid package ID' });
    }
    if (err.code === 'DAIMO_ERROR') {
      return res.status(503).json({ success: false, error: err.message, code: 'DAIMO_ERROR' });
    }
    if (err.message?.includes('DAIMO_TREASURY_ADDRESS')) {
      return res.status(503).json({ success: false, error: 'Crypto wallet payments are not yet configured.', code: 'DAIMO_NOT_CONFIGURED' });
    }
    res.status(500).json({ success: false, error: 'Failed to create wallet checkout. Please try again.' });
  }
}));

// GET /api/token-checkout/:purchaseId — return checkout page data (ePayco widget config or Daimo session)
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

// GET /token-checkout/:purchaseId — serve the static token checkout HTML page
app.get('/token-checkout/:purchaseId', (req, res) => {
  res.sendFile(path.join(__dirname, '../../../../public/token-checkout.html'));
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

// POST /api/webapp/payments/dash/create — create a BTCPay Dash invoice for a subscription plan
app.post('/api/webapp/payments/dash/create', requireSessionAuth, asyncHandler(async (req, res) => {
  const user = req.session.user;

  const { planId, email } = req.body;
  if (!planId) return res.status(400).json({ success: false, error: 'planId is required' });

  const PlanModel = require('../../models/planModel');
  const plan = await PlanModel.getById(planId);
  if (!plan) return res.status(404).json({ success: false, error: 'Plan not found' });

  const userId = String(user.telegram_id || user.id);
  const orderId = `pnptv-sub-${userId}-${Date.now()}`;
  const usdAmount = parseFloat(plan.price);

  try {
    const invoice = await createDashInvoice({
      usdAmount,
      userId,
      orderId,
      description: `PNPtv ${plan.display_name || plan.name} subscription`,
      redirectUrl: `${process.env.WEBAPP_URL || 'https://app.pnptv.app'}/subscribe`,
    });

    const { query: dbQuery } = require('../../config/postgres');
    await dbQuery(
      `INSERT INTO dash_subscription_orders (user_id, plan_id, email, usd_amount, btcpay_invoice_id, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')`,
      [userId, planId, email || null, usdAmount, invoice.invoiceId]
    );

    return res.json({
      success: true,
      invoiceId: invoice.invoiceId,
      checkoutUrl: invoice.checkoutUrl,
      planName: plan.display_name || plan.name,
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
          const EntitlementAccessService = require('../services/entitlementAccessService');
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

    // Only process successful invoice settlements beyond this point
    if (event.type !== 'InvoiceSettled') {
      return res.json({ success: true, ignored: true });
    }

    // Idempotency: acquire a Redis lock to prevent duplicate delivery race conditions.
    const settleLock = await cache.acquireLock(`btcpay:settled:${invoiceId}`, 120).catch(() => false);
    if (!settleLock) {
      logger.info('BTCPay InvoiceSettled duplicate delivery blocked', { invoiceId });
      return res.json({ success: true, duplicate: true });
    }

    try {

    const { query: dbQuery } = require('../../config/postgres');

    // Fix 1.1: Verify paid amount against invoice before granting access.
    // Prevents attackers from underpaying (e.g., $0.01) and receiving full entitlements.
    try {
      const { getInvoice } = require('../../config/btcpay');
      const invoiceDetails = await getInvoice(invoiceId);
      const paidAmount = parseFloat(invoiceDetails.amount || invoiceDetails.paidAmount || '0');
      const invoicedAmount = parseFloat(invoiceDetails.amount || '0');
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

    // --- 1. Check if this is a subscription order ---
    const subResult = await dbQuery(
      `SELECT id, user_id, plan_id, status FROM dash_subscription_orders
       WHERE btcpay_invoice_id = $1`,
      [invoiceId]
    );

    if (subResult.rows.length > 0) {
      const order = subResult.rows[0];

      const PlanModel = require('../../models/planModel');
      const plan = await PlanModel.getById(order.plan_id);
      if (!plan) {
        logger.error('BTCPay: plan not found for settled invoice', { invoiceId, planId: order.plan_id });
        await dbQuery(
          `UPDATE dash_subscription_orders SET status = 'failed', notes = 'plan_not_found' WHERE id = $1`,
          [order.id]
        );
        return res.status(200).json({ success: false, error: 'plan_not_found', invoiceId });
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

      await dbQuery(
        `UPDATE users
         SET tier = $2, subscription_status = 'active', plan_id = $3, plan_expiry = $4, updated_at = NOW()
         WHERE id = $1 OR telegram = $1`,
        [order.user_id, newTier, order.plan_id, expiryDate]
      );

      logger.info('BTCPay: subscription activated', { userId: order.user_id, planId: order.plan_id, invoiceId });

      // Grant entitlements — sole source of truth for access control (users.tier is display only).
      // This matches the post-payment flow used by ePayco and Daimo.
      try {
        const PaymentService = require('../services/paymentService');
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
        const socketSingleton = require('../services/socketSingleton');
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
              const PaymentNotificationService = require('../services/paymentNotificationService');
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
              const InvoiceService = require('../services/invoiceservice');
              const EmailService = require('../services/emailservice');
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
                guidePdf,
                language,
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

      return res.json({ success: true, type: 'subscription', planId: order.plan_id });
    }

    // --- 2. Fall through to token purchase ---
    const purchaseResult = await dbQuery(
      `SELECT user_id, tokens_credited, usd_amount FROM token_purchases
       WHERE btcpay_invoice_id = $1`,
      [invoiceId]
    );

    if (purchaseResult.rows.length === 0) {
      logger.warn('BTCPay webhook: unknown invoice', { invoiceId });
      return res.status(404).json({ success: false, error: 'Purchase not found' });
    }

    const { user_id: userId, tokens_credited: tokens, usd_amount: usdAmount } = purchaseResult.rows[0];
    const { newBalance, alreadyProcessed } = await DashTokenService.creditTokens(
      userId, tokens, invoiceId, { usdAmount }
    );

    if (!alreadyProcessed) {
      logger.info('BTCPay: tokens credited', { userId, tokens, invoiceId, newBalance });

      try {
        const socketSingleton = require('../services/socketSingleton');
        const io = socketSingleton.get ? socketSingleton.get() : socketSingleton;
        if (io) {
          io.to(`user:${userId}`).emit('wallet:updated', { balance: newBalance, credited: tokens });
        }
      } catch (emitErr) {
        logger.warn(`BTCPay wallet socket emit failed: ${emitErr.message}`);
      }
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
  return res.redirect(302, 'https://app.pnptv.app');
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

// PDS provisioning routes
app.use('/api/pds', pdsRoutes);
app.use('/api/bluesky', blueskyRoutes);
app.use('/api/element', elementRoutes);

// Creator monetization routes
app.use('/api/webapp/creator', creatorRoutes);

// Gamification routes
app.use('/api/webapp/gamification', gamificationRoutes);

// Canva Connect API routes
app.use('/api/canva', canvaRoutes);

// ==========================================
// Community Room (Haus) — 24/7 open video room powered by JaaS
// ==========================================
app.post('/api/community-room/join', requireSessionAuth, asyncHandler(communityRoomController.joinCommunityRoom));
app.get('/api/community-room/occupancy', requireSessionAuth, asyncHandler(communityRoomController.getRoomOccupancy));
app.get('/api/community-room/chat-history', requireSessionAuth, asyncHandler(communityRoomController.getChatHistory));
app.post('/api/community-room/message', requireSessionAuth, asyncHandler(communityRoomController.addMessage));
app.get('/api/community-room/stats', requireSessionAuth, asyncHandler(communityRoomController.getRoomStats));
app.get('/api/community-room/leaderboard', requireSessionAuth, asyncHandler(communityRoomController.getLeaderboard));
app.post('/api/community-room/moderation/mute', verifyAdminJWT, asyncHandler(communityRoomController.muteUser));
app.post('/api/community-room/moderation/remove', verifyAdminJWT, asyncHandler(communityRoomController.removeUser));
app.post('/api/community-room/moderation/clear-chat', verifyAdminJWT, asyncHandler(communityRoomController.clearChat));

// ── JaaS Token Endpoints ────────────────────────────────────────────────────
const jaasTokenLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator: (req) => String(req.session?.user?.id || req.ip),
  handler: (req, res) => res.status(429).json({ error: 'Too many token requests. Please wait before generating another token.' }),
  standardHeaders: true,
  legacyHeaders: false,
  skipFailedRequests: false,
});

app.get('/api/jaas/status', requireSessionAuth, asyncHandler(jaasController.getStatus));
app.post('/api/jaas/token', requireSessionAuth, jaasTokenLimiter, asyncHandler(jaasController.generateToken));
app.post('/api/jaas/moderator-token', requireSessionAuth, jaasTokenLimiter, asyncHandler(jaasController.generateModeratorToken));
app.post('/api/jaas/live-token', requireSessionAuth, jaasTokenLimiter, asyncHandler(jaasController.generateLiveToken));

// ==========================================
// ATProto / Bluesky OAuth Routes (PUBLIC — no session required)
// These must be mounted at app root so the client_id URL and redirect_uri
// match exactly what is served (e.g. https://pnptv.app/oauth/client-metadata.json)
// ==========================================
app.use('/', atprotoOAuthRoutes);

// ==========================================
// ATProto / Bluesky Profile & Social API Routes (session auth required)
// ==========================================

// GET  /api/atproto/profile       — fetch linked Bluesky profile (live from PDS)
app.get('/api/atproto/profile', asyncHandler(atprotoController.getAtprotoProfile));

// GET  /api/atproto/feed          — fetch user's Bluesky home timeline
app.get('/api/atproto/feed', asyncHandler(atprotoController.getAtprotoFeed));

// POST /api/atproto/like          — like a Bluesky post { uri, cid }
app.post('/api/atproto/like', asyncHandler(atprotoController.likeBlueskyPost));

// POST /api/atproto/repost        — repost a Bluesky post { uri, cid }
app.post('/api/atproto/repost', asyncHandler(atprotoController.repostBlueskyPost));

// POST /api/atproto/follow        — follow a Bluesky user { targetDid }
app.post('/api/atproto/follow', asyncHandler(atprotoController.followBlueskyUser));

// POST /api/webapp/auth/atproto/unlink — unlink Bluesky account (clears DID from user + revokes)
app.post('/api/webapp/auth/atproto/unlink', requireSessionAuth, asyncHandler(atprotoController.unlinkAtproto));

// POST /api/webapp/social/posts/:postId/crosspost-bluesky — cross-post a PNPtv post to Bluesky
app.post(
  '/api/webapp/social/posts/:postId/crosspost-bluesky',
  requireSessionAuth,
  socialActionLimiter,
  asyncHandler(atprotoController.crossPostToBluesky)
);

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
// OG / OPEN GRAPH ENDPOINTS
// ==========================================
// These routes serve minimal HTML pages with og: and twitter: meta tags.
// Crawlers (Twitterbot, Facebot, etc.) hit /og/* to get proper previews.
// Real browsers are immediately meta-refreshed to the SPA URL.
const ogController = require('./controllers/ogController');
// Player endpoint must be registered BEFORE the wildcard /og/* route
app.get('/og/player/:postId', asyncHandler(ogController.renderPlayer));
app.get('/og/*', asyncHandler(ogController.renderOG));

// Sentry error handler - must be last
if (process.env.SENTRY_DSN) {
  app.use(Sentry.Handlers.errorHandler());
}

// Export app WITHOUT 404/error handlers
// These will be added in bot.js AFTER the webhook callback
module.exports = app;
