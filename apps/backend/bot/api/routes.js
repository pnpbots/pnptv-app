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
const { getRedis } = require('../../config/redis');
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
const xOAuthRoutes = require('./xOAuthRoutes');
const xFollowersRoutes = require('./xFollowersRoutes');
const adminUserRoutes = require('./routes/adminUserRoutes');
const userManagementRoutes = require('./routes/userManagementRoutes');
const nearbyRoutes = require('./routes/nearby.routes');
const NearbyController = require('./controllers/nearbyController');
const { verifyAdminJWT } = require('./middleware/jwtAuth');

// Middleware
const { asyncHandler } = require('./middleware/errorHandler');
const { authenticateUser } = require('./middleware/auth');
const PermissionService = require('../services/permissionService');

// Authentication middleware and handlers
const { telegramAuth, checkTermsAccepted } = require('../../api/middleware/telegramAuth');
const { handleTelegramAuth, handleAcceptTerms, checkAuthStatus } = require('../../api/handlers/telegramAuthHandler');

// New route imports for auth, subscriptions, monetization, and PDS
const authRoutes = require('./routes/authRoutes');
const subscriptionRoutes = require('./routes/subscriptionRoutes');
const modelRoutes = require('./routes/modelRoutes');
const pdsRoutes = require('./routes/pdsRoutes');
const blueskyRoutes = require('./routes/blueskyRoutes');
const elementRoutes = require('./routes/elementRoutes');
const atprotoOAuthRoutes = require('./routes/atprotoOAuthRoutes');
const webappXOAuthRoutes = require('./routes/xOAuthRoutes');

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

/**
 * Soft auth — populates req.user from session if present, never blocks
 */
const softAuth = (req, res, next) => {
  if (req.session?.user?.id) {
    req.user = {
      id: req.session.user.id,
      tier: req.session.user.tier || 'free',
      subscriptionStatus: req.session.user.subscriptionStatus || req.session.user.subscription_status || 'free',
    };
  }
  next();
};

/**
 * Tier gate — requires active or prime subscription
 */
const requirePrimeTier = (req, res, next) => {
  const tier = (req.session?.user?.tier || req.user?.tier || 'free').toLowerCase();
  if (tier !== 'prime') {
    return res.status(403).json({
      success: false,
      error: 'Prime subscription required',
      code: 'PRIME_REQUIRED'
    });
  }
  next();
};

// Rate limiter for page routes (landing pages, policies, etc.)
const pageLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 60,
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
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session middleware for Telegram auth with Redis store
const redisClient = getRedis();
const resolvedSessionSecret = process.env.SESSION_SECRET;

if (!resolvedSessionSecret) {
  throw new Error('SESSION_SECRET must be configured (separate from JWT_SECRET)');
}
// Session middleware with explicit response hooks to ensure Set-Cookie header is set
// sameSite: 'none' + secure: true is required for iOS Safari compatibility.
// The Telegram deep link login flow sends users to t.me and back — iOS Safari
// treats this as a cross-site navigation and drops 'lax' cookies entirely.
// 'none' requires 'secure: true' (HTTPS only) per RFC 6265bis.
const sessionMiddleware = session({
  store: new RedisStore({ client: redisClient, prefix: 'sess:' }),
  secret: resolvedSessionSecret,
  resave: false,
  saveUninitialized: false,
  rolling: true, // Refresh session TTL on each request
  name: '__pnptv_sid', // Obscure session cookie name (was: connect.sid)
  cookie: {
    secure: true, // Required for sameSite=none; always true in production (HTTPS)
    httpOnly: true,
    sameSite: 'none', // Required for iOS Safari cross-site cookie survival
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    path: '/',
    domain: process.env.NODE_ENV === 'production' ? '.pnptv.app' : undefined
  }
});

app.use(sessionMiddleware);

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
        "https://code.jquery.com",
        "https://multimedia.epayco.co",
        "https://songbird.cardinalcommerce.com",
        "https://centinelapi.cardinalcommerce.com",
        "https://checkout.epayco.co",
        "https://secure.payco.co",
        "https://secure.epayco.co",
        "https://api.secure.payco.co",
        "https://telegram.org",
      ],
      styleSrc: ["'self'", "'unsafe-inline'", "https:", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https:", "https://fonts.gstatic.com", "data:"],
      imgSrc: ["'self'", "data:", "https://t.me", "https://*.telegram.org", "https:"],
      connectSrc: [
        "'self'",
        "https://multimedia.epayco.co",
        "https://songbird.cardinalcommerce.com",
        "https://centinelapi.cardinalcommerce.com",
        "https://checkout.epayco.co",
        "https://secure.epayco.co",
        "https://secure.payco.co",
        "https://api.secure.payco.co",
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
        "https://centinelapi.cardinalcommerce.com",
        "https://oauth.telegram.org",
        "https://telegram.org",
        // 3DS bank challenge iframes can come from any bank domain
        "https:",
      ],
      // frame-ancestors: allow ePayco/banks to embed our response pages during 3DS
      frameAncestors: [
        "'self'",
        "https://*.epayco.co",
        "https://*.payco.co",
        "https://*.cardinalcommerce.com",
      ],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: [
        "'self'",
        "https://checkout.epayco.co",
        "https://secure.epayco.co",
        "https://secure.payco.co",
        "https://api.secure.payco.co",
        "https://centinelapi.cardinalcommerce.com",
        "https://songbird.cardinalcommerce.com",
        // 3DS challenge forms may POST to any bank domain
        "https:",
      ],
      scriptSrcAttr: ["'unsafe-inline'"],
      upgradeInsecureRequests: [],
    },
  },
  // Disable X-Frame-Options since we use CSP frame-ancestors (which takes precedence)
  // X-Frame-Options: DENY would block 3DS challenge iframes from banks
  frameguard: false,
  // Allow cross-origin popups for 3DS challenge windows
  crossOriginOpenerPolicy: { policy: 'unsafe-none' },
  // Don't set COEP as it blocks cross-origin 3DS resources
  crossOriginEmbedderPolicy: false,
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
app.use(morgan('combined', { stream: logger.stream }));

// ========== PAYMENT ROUTES (BEFORE static middleware) ==========
// These must be BEFORE serveStaticWithBlocking to ensure they're processed first

// 3DS bank challenge iframes load from bank domains (e.g. jpmorgan.com, bancolombia.com).
// Override helmet's restrictive CSP for checkout pages so frame-src, connect-src, img-src,
// and form-action allow any HTTPS origin. script-src stays locked to known payment SDKs.
// frame-ancestors allows ePayco/banks to embed our page in their 3DS challenge iframes.
const CHECKOUT_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://code.jquery.com https://multimedia.epayco.co https://songbird.cardinalcommerce.com https://centinelapi.cardinalcommerce.com https://checkout.epayco.co https://secure.payco.co https://secure.epayco.co https://api.secure.payco.co",
  "style-src 'self' 'unsafe-inline' https: https://fonts.googleapis.com",
  "font-src 'self' https: https://fonts.gstatic.com data:",
  "img-src 'self' https: data:",
  "connect-src 'self' https:",
  "frame-src https:",
  // frame-ancestors: allow banks and ePayco to embed our 3DS callback/response pages
  "frame-ancestors 'self' https://*.epayco.co https://*.payco.co https://*.cardinalcommerce.com https:",
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
  // Remove restrictive headers that break 3DS bank iframes, challenge windows, and redirects
  res.removeHeader('X-Frame-Options');
  res.setHeader('Referrer-Policy', 'no-referrer-when-downgrade');
  // COOP/COEP must be permissive for 3DS cross-origin popups and iframes
  res.setHeader('Cross-Origin-Opener-Policy', 'unsafe-none');
  res.removeHeader('Cross-Origin-Embedder-Policy');
  // Permissions-Policy: allow payment API for 3DS
  res.setHeader('Permissions-Policy', 'payment=(self "https://*.epayco.co" "https://*.payco.co")');
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
  sendCheckoutHtml(res, 'daimo-checkout.html');
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
        'pnp-live-checkout.html',
        'pnp-live-daimo-checkout.html',
        'recurring-checkout.html',
        'meet-greet-daimo-checkout.html',
        'daimo-checkout.html'
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

// Contact page (EasyBots only)
app.get('/contact', pageLimiter, (req, res) => {
  const host = req.get('host') || '';
  if (host.includes('easybots.store') || host.includes('easybots')) {
    return res.sendFile(path.join(__dirname, '../../../public/easybots-contact.html'));
  }
  return res.status(404).send('Not found');
});

// Age Verification page
app.get('/age-verification', pageLimiter, (req, res) => {
  const host = req.get('host') || '';
  if (host.includes('easybots.store') || host.includes('easybots')) {
    return res.status(404).send('Not found');
  }
  res.sendFile(path.join(__dirname, '../../../public/age-verification.html'));
});



// Meet & Greet Checkout pages — use sendCheckoutHtml for proper 3DS CSP headers
app.get('/pnp/meet-greet/checkout/:bookingId', pageLimiter, (req, res) => {
  sendCheckoutHtml(res, 'payment-checkout.html');
});

app.get('/pnp/meet-greet/daimo-checkout/:bookingId', pageLimiter, (req, res) => {
  sendCheckoutHtml(res, 'daimo-checkout.html');
});

// PNP Live Checkout pages — use sendCheckoutHtml for proper 3DS CSP headers
app.get('/pnp/live/checkout/:bookingId', pageLimiter, (req, res) => {
  sendCheckoutHtml(res, 'payment-checkout.html');
});

app.get('/pnp/live/daimo-checkout/:bookingId', pageLimiter, (req, res) => {
  sendCheckoutHtml(res, 'daimo-checkout.html');
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
      '/contact'
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
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
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

// Social post media upload - 50MB max, images or videos
const postMediaUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const isAllowed = /^(image\/(jpeg|jpg|png|webp|gif)|video\/(mp4|webm))$/i.test(file.mimetype || '');
    if (isAllowed) return cb(null, true);
    cb(new Error('Only image (jpg/png/webp/gif) and video (mp4/webm) files are allowed'));
  }
});

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
  max: 10, // Limit each IP to 10 failed attempts per 15 minutes
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

// ==========================================
// ATProto OAuth Routes (PUBLIC — no auth guard)
// These MUST be before any auth-protected routes.
// /oauth/client-metadata.json and /.well-known/oauth-protected-resource
// are fetched by authorization servers and must be publicly accessible.
// ==========================================
app.use(atprotoOAuthRoutes);

// ==========================================
// X (Twitter) OAuth 2.0 PKCE Webapp Routes (PUBLIC — no auth guard)
// GET /api/webapp/auth/x/login    — initiate PKCE flow
// GET /api/webapp/auth/x/callback — exchange code, create session
// These are mounted BEFORE the per-method wiring below (lines 1711-1712) so
// the dedicated route file with its own rate limiters takes precedence.
// ==========================================
app.use('/api/webapp/auth/x', webappXOAuthRoutes);

// API routes
// Authentication API endpoints
app.post('/api/telegram-auth', authLimiter, handleTelegramAuth);
app.post('/api/accept-terms', handleAcceptTerms);
app.get('/api/auth-status', checkAuthStatus);

// Admin check endpoint (for frontend role gate)
app.get('/api/admin/check', (req, res) => {
  const user = req.session?.user;
  if (!user) return res.json({ isAdmin: false });
  const role = user.role || 'user';
  res.json({ isAdmin: role === 'admin' || role === 'superadmin' });
});

// Logout endpoint
app.post('/api/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      logger.error('Logout error:', err);
      return res.status(500).json({ error: 'Logout failed' });
    }
    res.clearCookie('__pnptv_sid');
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
  const base = path.resolve(__dirname, '../../../public/videorama');
  const assetPath = path.resolve(base, req.path.replace(/^\/app\/videorama\/?/, ''));
  // Guard against path traversal: resolved path must remain inside base directory
  if (!assetPath.startsWith(base + path.sep) && assetPath !== base) {
    return res.status(403).send('Forbidden');
  }
  if (fs.existsSync(assetPath) && fs.statSync(assetPath).isFile()) {
    return res.sendFile(assetPath);
  }
  res.sendFile(path.join(base, 'index.html'));
});

// Hangouts - protected
app.get('/hangouts', requirePageAuth, (req, res) => {
  logger.info(`User ${req.user.id} accessing Hangouts`);
  res.sendFile(path.join(__dirname, '../../../public/hangouts/index.html'));
});

app.get('/hangouts/*', requirePageAuth, (req, res) => {
  const base = path.resolve(__dirname, '../../../public/hangouts');
  const assetPath = path.resolve(base, req.path.replace(/^\/hangouts\/?/, ''));
  if (!assetPath.startsWith(base + path.sep) && assetPath !== base) {
    return res.status(403).send('Forbidden');
  }
  if (fs.existsSync(assetPath) && fs.statSync(assetPath).isFile()) {
    return res.sendFile(assetPath);
  }
  res.sendFile(path.join(base, 'index.html'));
});

// Live - protected
app.get('/live', requirePageAuth, (req, res) => {
  logger.info(`User ${req.user.id} accessing Live`);
  res.sendFile(path.join(__dirname, '../../../public/live/index.html'));
});

app.get('/live/*', requirePageAuth, (req, res) => {
  const base = path.resolve(__dirname, '../../../public/live');
  const assetPath = path.resolve(base, req.path.replace(/^\/live\/?/, ''));
  if (!assetPath.startsWith(base + path.sep) && assetPath !== base) {
    return res.status(403).send('Forbidden');
  }
  if (fs.existsSync(assetPath) && fs.statSync(assetPath).isFile()) {
    return res.sendFile(assetPath);
  }
  res.sendFile(path.join(base, 'index.html'));
});

// PNP Live portal - protected
app.get('/pnplive', requirePageAuth, (req, res) => {
  logger.info(`User ${req.user.id} accessing PNP Live portal`);
  res.sendFile(path.join(__dirname, '../../../public/live/index.html'));
});

// Age verification (AI camera) — requires authentication to prevent spoofed user_id
app.post(
  '/api/verify-age',
  authenticateUser,
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

// Daimo webhook diagnostic endpoint (for debugging)
app.post('/api/webhooks/daimo/debug', express.raw({ type: 'application/json' }), asyncHandler(async (req, res) => {
  try {
    const contentType = req.headers['content-type'] || 'none';
    const contentLength = req.headers['content-length'] || '0';
    const rawBody = req.body ? (typeof req.body === 'string' ? req.body : JSON.stringify(req.body)) : '';
    const bodyPreview = rawBody.slice(0, 1000);

    logger.info('[Daimo] Diagnostic webhook received', {
      contentType,
      contentLength,
      bodyLength: rawBody.length,
      authHeader: !!req.headers['authorization'],
      xDaimoSignature: !!req.headers['x-daimo-signature'],
      headersKeys: Object.keys(req.headers)
    });

    res.json({
      received: true,
      length: rawBody.length,
      contentType,
      preview: bodyPreview,
      headers: {
        'content-type': contentType,
        'content-length': contentLength,
        'authorization': req.headers['authorization'] ? 'present' : 'missing',
        'x-daimo-signature': req.headers['x-daimo-signature'] ? 'present' : 'missing'
      }
    });
  } catch (error) {
    logger.error('[Daimo] Diagnostic error:', error);
    res.status(500).json({ error: error.message });
  }
}));

// Main Daimo webhook handler
app.post('/api/webhooks/daimo', webhookLimiter, webhookController.handleDaimoWebhook);
app.post('/api/webhooks/visa-cybersource', webhookLimiter, require('./controllers/visaCybersourceWebhookController').handleWebhook);
app.get('/api/webhooks/visa-cybersource/health', require('./controllers/visaCybersourceWebhookController').healthCheck);
app.get('/api/payment-response', webhookController.handlePaymentResponse);

// Payment API routes
app.get('/api/payment/:paymentId', asyncHandler(paymentController.getPaymentInfo));
app.get('/api/payment/:paymentId/status', asyncHandler(paymentController.getPaymentStatus));
app.post('/api/payment/tokenized-charge', asyncHandler(paymentController.processTokenizedCharge));
app.post('/api/payment/verify-2fa', asyncHandler(paymentController.verify2FA));
app.post('/api/payment/complete-3ds-2', asyncHandler(paymentController.complete3DS2Authentication));
app.get('/api/confirm-payment/:token', asyncHandler(paymentController.confirmPaymentToken));
// Payment recovery endpoints for stuck 3DS payments

app.post('/api/payment/:paymentId/retry-webhook', asyncHandler(paymentController.retryPaymentWebhook));

// PNP Live API routes (formerly Meet & Greet, now consolidated)
const PNPLiveService = require('../services/pnpLiveService');
const ModelService = require('../services/modelService');
const PaymentService = require('../services/paymentService');
app.get('/api/pnp-live/booking/:bookingId', asyncHandler(async (req, res) => {
  const { bookingId } = req.params;

  const booking = await PNPLiveService.getBookingById(bookingId);
  if (!booking) {
    return res.status(404).json({ success: false, error: 'Booking not found' });
  }

  const model = await ModelService.getModelById(booking.model_id);

  // Generate ePayco checkout config for frontend
  const invoice = `PNP-LIVE-${booking.id}`;
  const amount = String(booking.price_usd);
  const currencyCode = 'USD';
  const webhookDomain = process.env.BOT_WEBHOOK_DOMAIN || 'https://pnptv.app';
  const epaycoWebhookDomain = process.env.EPAYCO_WEBHOOK_DOMAIN || 'https://easybots.site';

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
      confirmationUrl: `${epaycoWebhookDomain}/api/webhook/epayco`,
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
app.get('/api/stats', asyncHandler(async (req, res) => {
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



// Podcasts uploads (local storage under /public/uploads/podcasts) — requires auth
app.post(
  '/api/podcasts/upload',
  authenticateUser,
  podcastController.upload.single('audio'),
  asyncHandler(podcastController.uploadAudio)
);

// Recurring Checkout page — use sendCheckoutHtml for proper 3DS CSP headers
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

  // Token should be a pre-generated token from ePayco.js frontend tokenization
  try {
    // Store or process the pre-generated token securely
    // The actual service call depends on your token storage/subscription flow
    const result = {
      success: true,
      message: 'Token received successfully',
      token: cardToken
    };

    res.json(result);
  } catch (error) {
    logger.error('Error processing tokenized card:', error);
    res.status(500).json({ success: false, error: 'Failed to process token' });
  }
}));

// Create recurring subscription
app.post('/api/recurring/subscribe', authenticateUser, bindAuthenticatedUserId, asyncHandler(async (req, res) => {
  const { userId, planId, cardToken, email, trialDays } = req.body;

  if (!userId || !planId) {
    return res.status(400).json({ success: false, error: 'Missing required fields' });
  }

  const result = await VisaCybersourceService.createRecurringSubscription({
    userId,
    planId,
    cardToken,
    email,
    trialDays: trialDays || 0,
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
app.post('/api/subscription/create-checkout', asyncHandler(subscriptionController.createCheckout));
app.post(
  '/api/subscription/epayco/confirmation',
  webhookLimiter,
  asyncHandler(subscriptionController.handleEpaycoConfirmation)
);
app.get('/api/subscription/payment-response', asyncHandler(subscriptionController.handlePaymentResponse));
app.get('/api/subscription/subscriber/:identifier', verifyAdminJWT, asyncHandler(subscriptionController.getSubscriber));
app.get('/api/subscription/stats', verifyAdminJWT, asyncHandler(subscriptionController.getStatistics));

// Audio Management API
const audioStreamer = require('../../services/audioStreamer');

// List all available audio files
app.get('/api/audio/list', asyncHandler(async (req, res) => {
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
app.delete('/api/audio/:filename', asyncHandler(async (req, res) => {
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
app.get('/api/hangouts/public', asyncHandler(hangoutsController.listPublic));
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
app.get('/api/radio/stream', asyncHandler(async (req, res) => {
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

// Audit logging for all admin routes — must be registered before admin route handlers
const { auditLog: adminAuditLog } = require('../../middleware/auditLogger');
app.use('/api/admin/', adminAuditLog);

// Broadcast Queue API Routes
const broadcastQueueRoutes = require('./broadcastQueueRoutes');
app.use('/api/admin/queue', verifyAdminJWT, broadcastQueueRoutes);

// Admin User Management Routes
app.use('/api/admin/users', adminUserRoutes);
app.use('/api/users', userManagementRoutes);

// Nearby Geolocation API Routes
app.use('/api/nearby', nearbyRoutes);

app.use('/api/admin/x/oauth', xOAuthRoutes);
app.use('/api/auth/x', xOAuthRoutes); // Alias for X Developer Portal redirect URI
app.use('/api/x/followers', xFollowersRoutes);

// Health Check and Monitoring Endpoints
app.get('/api/health', healthLimiter, asyncHandler(healthController.healthCheck));
app.get('/api/metrics', healthLimiter, verifyAdminJWT, asyncHandler(healthController.performanceMetrics));
app.post('/api/metrics/reset', healthLimiter, verifyAdminJWT, asyncHandler(healthController.resetMetrics));

// ==========================================
// PRIME Hub Web App API Routes
// ==========================================
const webAppController = require('./controllers/webAppController');
// Phase 1 controllers:
const userLocationController = require('../../api/controllers/userLocationController');
const blockedUsersController = require('../../api/controllers/blockedUsersController');
const directMessagesController = require('../../api/controllers/directMessagesController');
const notificationsController = require('../../api/controllers/notificationsController');

// Web App Authentication
app.get('/api/webapp/auth/telegram/start', asyncHandler(webAppController.telegramStart));
app.get('/api/webapp/auth/telegram/callback', asyncHandler(webAppController.telegramCallback));
app.post('/api/webapp/auth/telegram', asyncHandler(webAppController.telegramLogin));
app.post('/api/webapp/auth/telegram/token', asyncHandler(webAppController.telegramGenerateToken));
app.get('/api/webapp/auth/telegram/check', asyncHandler(webAppController.telegramCheckToken));
app.post('/api/webapp/auth/email/register', authLimiter, asyncHandler(webAppController.emailRegister));
app.post('/api/webapp/auth/email/login', authLimiter, asyncHandler(webAppController.emailLogin));
app.get('/api/webapp/auth/verify-email', asyncHandler(webAppController.verifyEmail));
app.post('/api/webapp/auth/resend-verification', authLimiter, asyncHandler(webAppController.resendVerification));
// X OAuth routes now handled by webappXOAuthRoutes (mounted earlier at /api/webapp/auth/x)
// app.get('/api/webapp/auth/x/start', asyncHandler(webAppController.xLoginStart));
// app.get('/api/webapp/auth/x/callback', asyncHandler(webAppController.xLoginCallback));
app.get('/api/me', asyncHandler(webAppController.authStatus));
app.post('/api/webapp/auth/logout', asyncHandler(webAppController.logout));
app.post('/api/webapp/auth/forgot-password', asyncHandler(webAppController.forgotPassword));
app.post('/api/webapp/auth/reset-password', asyncHandler(webAppController.resetPassword));

// ATProto identity unlink — removes the Bluesky/ATProto identity from the user's account.
// The Telegram session is preserved. The stored OAuth session row is deleted.
app.post('/api/webapp/auth/atproto/unlink', authenticateUser, asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const did = req.session?.user?.atproto_did;

  if (!did) {
    return res.status(400).json({ success: false, error: 'No ATProto identity is linked to this account.' });
  }

  const { query: dbQuery } = require('../../config/postgres');

  // Clear ATProto fields from the users table using parameterized query
  await dbQuery(
    `UPDATE users SET atproto_did = NULL, atproto_handle = NULL, atproto_pds_url = NULL, updated_at = NOW() WHERE id = $1`,
    [userId]
  );

  // Delete the stored OAuth session for this DID (best-effort; row may not exist if session expired)
  try {
    await dbQuery('DELETE FROM atproto_oauth_sessions WHERE did = $1', [did]);
  } catch (oauthSessionErr) {
    logger.warn('[ATProto] Could not delete oauth session row (non-blocking):', oauthSessionErr.message);
  }

  // Attempt to revoke the remote ATProto session token (best-effort; don't fail the unlink if this errors)
  try {
    const atproto = require('../services/atprotoOAuthService');
    const client = await atproto.getClient();
    const oauthSession = await client.restore(did);
    if (oauthSession && typeof oauthSession.signOut === 'function') {
      await oauthSession.signOut();
    }
  } catch (revokeErr) {
    logger.debug('[ATProto] Remote session revocation during unlink (non-blocking):', revokeErr.message);
  }

  // Update the express session in-place so the frontend reflects the change immediately
  if (req.session?.user) {
    req.session.user.atproto_did = null;
    req.session.user.atproto_handle = null;
    req.session.user.atproto_pds_url = null;
    if (req.session.user.auth_methods) {
      req.session.user.auth_methods.atproto = false;
    }
    await new Promise((resolve, reject) => {
      req.session.save((err) => (err ? reject(err) : resolve()));
    });
  }

  logger.info('[ATProto] Unlinked ATProto identity from user', { userId, did });
  res.json({ success: true, message: 'Bluesky account unlinked successfully.' });
}));

// Web App Profile
app.get('/api/webapp/profile', asyncHandler(webAppController.getProfile));
app.put('/api/webapp/profile', asyncHandler(webAppController.updateProfile));
app.post('/api/webapp/profile/avatar', avatarUpload.single('avatar'), asyncHandler(webAppController.uploadAvatar));

// Web App User Location
app.get('/api/webapp/profile/location', asyncHandler(userLocationController.getUserLocation));
app.put('/api/webapp/profile/location', asyncHandler(userLocationController.updateUserLocation));
app.delete('/api/webapp/profile/location', asyncHandler(userLocationController.deleteUserLocation));
app.get('/api/webapp/users/nearby', asyncHandler(userLocationController.getNearbyUsers));

// Web App Block/Unblock Users
app.post('/api/webapp/users/block', asyncHandler(blockedUsersController.blockUser));
app.delete('/api/webapp/users/unblock/:blockedUserId', asyncHandler(blockedUsersController.unblockUser));
app.get('/api/webapp/users/blocked', asyncHandler(blockedUsersController.getBlockedUsers));
app.get('/api/webapp/users/is-blocked/:userId', asyncHandler(blockedUsersController.isUserBlocked));

// Web App Direct Messages
app.get('/api/webapp/messages/threads', asyncHandler(directMessagesController.getThreads));
app.get('/api/webapp/messages/thread/:otherUserId', asyncHandler(directMessagesController.getMessages));
app.post('/api/webapp/messages/send', asyncHandler(directMessagesController.sendMessage));
app.delete('/api/webapp/messages/:messageId', asyncHandler(directMessagesController.deleteMessage));
app.put('/api/webapp/messages/thread/:otherUserId/read', asyncHandler(directMessagesController.markThreadAsRead));

// Web App Notifications
app.get('/api/webapp/notifications', asyncHandler(notificationsController.getNotifications));
app.get('/api/webapp/notifications/counts', asyncHandler(notificationsController.getNotificationCounts));
app.put('/api/webapp/notifications/mark-read', asyncHandler(notificationsController.markAsRead));

// Web App Mastodon Feed
app.get('/api/webapp/mastodon/feed', asyncHandler(webAppController.getMastodonFeed));

// Web App Hangouts (session auth)
const webappHangoutsController = require('./controllers/webappHangoutsController');
app.get('/api/webapp/hangouts/public', asyncHandler(webappHangoutsController.listPublic));
app.post('/api/webapp/hangouts/create', asyncHandler(webappHangoutsController.createRoom));
app.post('/api/webapp/hangouts/join/:callId', asyncHandler(webappHangoutsController.joinRoom));
app.post('/api/webapp/hangouts/leave/:callId', asyncHandler(webappHangoutsController.leaveRoom));
app.delete('/api/webapp/hangouts/:callId', asyncHandler(webappHangoutsController.endRoom));

// Web App Hangout Groups (session auth)
const hangoutGroupController = require('./controllers/hangoutGroupController');
app.get('/api/webapp/hangouts/groups', asyncHandler(hangoutGroupController.listGroups));
app.post('/api/webapp/hangouts/groups', asyncHandler(hangoutGroupController.createGroup));
app.get('/api/webapp/hangouts/groups/:id', asyncHandler(hangoutGroupController.getGroup));
app.post('/api/webapp/hangouts/groups/:id/join', asyncHandler(hangoutGroupController.joinGroup));
app.post('/api/webapp/hangouts/groups/:id/leave', asyncHandler(hangoutGroupController.leaveGroup));
app.delete('/api/webapp/hangouts/groups/:id', asyncHandler(hangoutGroupController.deleteGroup));
app.get('/api/webapp/hangouts/groups/:id/messages', asyncHandler(hangoutGroupController.getMessages));
app.post('/api/webapp/hangouts/groups/:id/messages', asyncHandler(hangoutGroupController.sendMessage));
app.post('/api/webapp/hangouts/groups/:id/call', asyncHandler(hangoutGroupController.startCall));

// Web App Live Streaming Routes
const webappLiveController = require('./controllers/webappLiveController');
app.get('/api/webapp/live/streams', asyncHandler(webappLiveController.listStreams));
app.post('/api/webapp/live/start', asyncHandler(webappLiveController.startStream));
app.get('/api/webapp/live/streams/:streamId/join', asyncHandler(webappLiveController.joinStream));
app.post('/api/webapp/live/streams/:streamId/end', asyncHandler(webappLiveController.endStream));
app.post('/api/webapp/live/streams/:streamId/leave', asyncHandler(webappLiveController.leaveStream));

// Web App Payments (session auth → PaymentService)
app.post('/api/webapp/payments/create', asyncHandler(async (req, res) => {
  const user = req.session?.user;
  if (!user?.id) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }

  const { planId, provider } = req.body;
  if (!planId) {
    return res.status(400).json({ success: false, error: 'planId is required' });
  }
  if (provider && !['epayco', 'daimo'].includes(provider)) {
    return res.status(400).json({ success: false, error: 'Invalid provider. Must be epayco or daimo' });
  }

  const result = await PaymentService.createPayment({
    userId: user.telegramId || user.telegram_id || user.id,
    planId,
    provider: provider || 'epayco',
    chatId: user.telegramId || user.telegram_id || null,
  });

  res.json(result);
}));

// Web App Admin Routes (session auth + role check)
const webappAdminController = require('./controllers/webappAdminController');
const primeController = require('./controllers/primeController');
const { adminGuard } = require('../../middleware/guards');

// Admin endpoints with session-based authentication
app.get('/api/webapp/admin/stats', adminGuard, asyncHandler(webappAdminController.getStats));
app.get('/api/webapp/admin/users', adminGuard, asyncHandler(webappAdminController.listUsers));
app.get('/api/webapp/admin/users/:id', adminGuard, asyncHandler(webappAdminController.getUser));
app.put('/api/webapp/admin/users/:id', adminGuard, asyncHandler(webappAdminController.updateUser));
app.post('/api/webapp/admin/users/:id/ban', adminGuard, asyncHandler(webappAdminController.banUser));
app.get('/api/webapp/admin/posts', adminGuard, asyncHandler(webappAdminController.listPosts));
app.delete('/api/webapp/admin/posts/:id', adminGuard, asyncHandler(webappAdminController.deletePost));
app.get('/api/webapp/admin/hangouts', adminGuard, asyncHandler(webappAdminController.listHangouts));
app.delete('/api/webapp/admin/hangouts/:id', adminGuard, asyncHandler(webappAdminController.endHangout));

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
app.get('/api/webapp/admin/ampache/catalog', verifyAdminJWT, asyncHandler(async (req, res) => {
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
app.post('/api/webapp/admin/ampache/import', verifyAdminJWT, asyncHandler(async (req, res) => {
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
app.post('/api/webapp/admin/ampache/sync', verifyAdminJWT, asyncHandler(async (req, res) => {
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
app.post('/api/webapp/admin/ampache/set-radio', verifyAdminJWT, asyncHandler(async (req, res) => {
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
app.get('/api/webapp/admin/ampache/ping', verifyAdminJWT, asyncHandler(async (req, res) => {
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
// Role-Based Access Control (RBAC) Routes
// ==========================================
const { superadminGuard } = require('../../middleware/guards');
const roleController = require('./controllers/roleController');
const auditLogController = require('./controllers/auditLogController');

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
const dmController = require('./controllers/dmController');
const socialController = require('./controllers/socialController');
const usersController = require('./controllers/usersController');

// Chat (REST fallback for Socket.IO)
app.get('/api/webapp/chat/:room/history', asyncHandler(chatController.getChatHistory));
app.post('/api/webapp/chat/:room/send', asyncHandler(chatController.sendMessage));

// Nearby (webapp session-auth proxy — Prime only)
app.post('/api/webapp/nearby/update-location', requirePrimeTier, asyncHandler(async (req, res) => {
  const user = req.session?.user;
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  req.user = { id: user.id, userId: user.id };
  return NearbyController.updateLocation(req, res);
}));
app.get('/api/webapp/nearby/search', requirePrimeTier, asyncHandler(async (req, res) => {
  const user = req.session?.user;
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  req.user = { id: user.id, userId: user.id };
  return NearbyController.searchNearby(req, res);
}));

// DM threads & conversations
app.get('/api/webapp/dm/threads', asyncHandler(dmController.getThreads));
app.get('/api/webapp/dm/conversation/:partnerId', asyncHandler(dmController.getConversation));
app.get('/api/webapp/dm/user/:partnerId', asyncHandler(dmController.getPartnerInfo));
app.post('/api/webapp/dm/send/:recipientId', asyncHandler(dmController.sendMessage));

// Social feed, wall, posts
app.get('/api/webapp/social/feed', asyncHandler(socialController.getFeed));
app.get('/api/webapp/social/wall/:userId', asyncHandler(socialController.getWall));
app.get('/api/webapp/social/profile/:userId', asyncHandler(socialController.getPublicProfile));
app.post('/api/webapp/social/posts', asyncHandler(socialController.createPost));
app.post('/api/webapp/social/posts/with-media', postMediaUpload.single('media'), asyncHandler(socialController.createPostWithMedia));
app.post('/api/webapp/social/posts/:postId/like', asyncHandler(socialController.toggleLike));
app.delete('/api/webapp/social/posts/:postId', asyncHandler(socialController.deletePost));
app.get('/api/webapp/social/posts/:postId/replies', asyncHandler(socialController.getReplies));
app.post('/api/webapp/social/posts/:postId/mastodon', asyncHandler(socialController.postToMastodon));

// Users search
app.get('/api/webapp/users/search', asyncHandler(usersController.searchUsers));

// ==========================================
// SERVICE PROXY ENDPOINTS (Media, Live, Social)
// Frontend calls these; backend handles auth to each service
// ==========================================

// --- Ampache Media Proxy ---
app.get('/api/proxy/media/tracks', asyncHandler(async (req, res) => {
  try {
    const AmpacheService = require('../services/ampacheService');
    const { offset = 0, limit = 20 } = req.query;
    const songs = await AmpacheService.getSongs({ offset: +offset, limit: +limit });
    res.json({ success: true, tracks: songs });
  } catch (error) {
    logger.error('Media proxy tracks error:', error.message);
    res.json({ success: true, tracks: [] });
  }
}));

app.get('/api/proxy/media/search', asyncHandler(async (req, res) => {
  try {
    const AmpacheService = require('../services/ampacheService');
    const { q = '', limit = 20 } = req.query;
    if (!q.trim()) {
      return res.json({ success: true, tracks: [] });
    }
    const token = await AmpacheService.getAuthToken();
    const resp = await axios.get(`${process.env.AMPACHE_URL || 'http://ampache:80'}/server/json.server.php`, {
      params: { action: 'search_songs', auth: token, filter: q, limit: +limit },
      timeout: 10000,
    });
    const songs = resp.data.song || [];
    res.json({ success: true, tracks: Array.isArray(songs) ? songs : [songs] });
  } catch (error) {
    logger.error('Media proxy search error:', error.message);
    res.json({ success: true, tracks: [] });
  }
}));

app.get('/api/proxy/media/stream/:songId', asyncHandler(async (req, res) => {
  try {
    const AmpacheService = require('../services/ampacheService');
    const streamUrl = await AmpacheService.getStreamUrl('song', req.params.songId);
    res.json({ success: true, url: streamUrl });
  } catch (error) {
    logger.error('Media proxy stream error:', error.message);
    res.status(500).json({ success: false, error: 'Stream unavailable' });
  }
}));

// --- Restreamer Live Proxy ---
app.get('/api/proxy/live/streams', asyncHandler(async (req, res) => {
  try {
    const restreamerUrl = process.env.RESTREAMER_URL || 'http://restreamer:8080';
    const restreamerUser = process.env.RESTREAMER_USER || 'admin';
    const restreamerPass = process.env.RESTREAMER_PASSWORD || '';

    let token = null;
    if (restreamerUser && restreamerPass) {
      try {
        const loginResp = await axios.post(`${restreamerUrl}/api/login`, {
          username: restreamerUser,
          password: restreamerPass,
        }, { timeout: 5000 });
        token = loginResp.data?.access_token;
      } catch (loginErr) {
        logger.warn('Restreamer login failed, trying without auth:', loginErr.message);
      }
    }

    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const resp = await axios.get(`${restreamerUrl}/api/v3/process`, {
      headers,
      timeout: 10000,
    });

    const publicUrl = process.env.RESTREAMER_PUBLIC_URL || 'https://live.pnptv.app';
    const processes = resp.data || [];
    const streams = processes
      .filter((p) => p.id?.startsWith('restreamer-ui:ingest:'))
      .map((p) => {
        const refId = p.reference || p.id;
        return {
          id: p.id,
          name: p.metadata?.['restreamer-ui']?.meta?.name || 'Live Stream',
          description: p.metadata?.['restreamer-ui']?.meta?.description || '',
          hlsUrl: `${publicUrl}/memfs/${refId}.m3u8`,
          isLive: p.state?.exec === 'running',
        };
      });

    res.json({ success: true, streams });
  } catch (error) {
    logger.error('Live proxy streams error:', error.message);
    res.json({ success: true, streams: [] });
  }
}));

// --- Bluesky Social Proxy (PDS feed) ---
const pdsFeedController = require('./controllers/pdsFeedController');
app.get('/api/proxy/social/feed', asyncHandler(pdsFeedController.getFeed));

// --- Directus-backed Social Posts Proxy ---
const directusSocialController = require('./controllers/directusSocialController');
app.get('/api/proxy/social/posts', asyncHandler(directusSocialController.getPosts));
app.post('/api/proxy/social/posts', postMediaUpload.single('media'), asyncHandler(directusSocialController.createPost));
app.delete('/api/proxy/social/posts/:id', asyncHandler(directusSocialController.deletePost));

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
    logger.error('Hangouts proxy list error:', error.message);
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
    logger.error('Hangouts proxy create error:', error.message);
    res.status(400).json({ success: false, error: error.message || 'Failed to create room' });
  }
}));

// GET /api/proxy/hangouts/rooms/:code — Get room details by code
app.get('/api/proxy/hangouts/rooms/:code', asyncHandler(async (req, res) => {
  try {
    const room = await JitsiService.getRoom(req.params.code);
    if (!room) {
      return res.status(404).json({ success: false, error: 'Room not found' });
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
        is_public: room.is_public !== false,
        max_participants: room.max_participants,
        current_participants: room.current_participants || 0,
        status: room.status,
        join_url: JitsiService.generateJoinUrl(room),
        created_at: room.created_at,
      },
    });
  } catch (error) {
    logger.error('Hangouts proxy get room error:', error.message);
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
    logger.error('Hangouts proxy join error:', error.message);
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
    logger.error('Hangouts proxy end error:', error.message);
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
    logger.error('Hangouts proxy my-rooms error:', error.message);
    res.json({ success: true, rooms: [] });
  }
}));

// --- Live Tips Proxy (PNP Live tipping system) ---
const PNPLiveTipsService = require('../services/pnpLiveTipsService');

// GET /api/proxy/live/performers — List performers from Directus
app.get('/api/proxy/live/performers', asyncHandler(async (req, res) => {
  try {
    const resp = await axios.get(`${DIRECTUS_INTERNAL_URL}/items/performers`, {
      params: {
        'filter[status][_eq]': 'published',
        'fields[]': ['id', 'name', 'slug', 'bio', 'photo', 'categories'],
        sort: 'name',
        limit: 50,
      },
      timeout: 10000,
    });
    const performers = (resp.data?.data || []).map(p => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      bio: p.bio || '',
      photo: p.photo ? `${DIRECTUS_INTERNAL_URL}/assets/${p.photo}` : null,
      categories: p.categories || [],
    }));
    res.json({ success: true, performers });
  } catch (error) {
    logger.error('Live performers proxy error:', error.message);
    res.json({ success: true, performers: [] });
  }
}));

// POST /api/proxy/live/tips — Create a tip (auth required)
app.post('/api/proxy/live/tips', asyncHandler(async (req, res) => {
  const user = req.session?.user;
  if (!user) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }

  const { performerId, amount, message } = req.body;
  if (!performerId || !amount) {
    return res.status(400).json({ success: false, error: 'performerId and amount are required' });
  }

  const validAmounts = PNPLiveTipsService.TIP_AMOUNTS;
  const numAmount = parseFloat(amount);
  if (!validAmounts.includes(numAmount)) {
    return res.status(400).json({ success: false, error: `Amount must be one of: ${validAmounts.join(', ')}` });
  }

  try {
    const userId = String(user.telegram_id || user.id);
    const tip = await PNPLiveTipsService.createTip(
      userId,
      parseInt(performerId, 10),
      null,
      numAmount,
      (message || '').slice(0, 200)
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
        description: `Tip for performer #${performerId}`,
      });
      if (daimoResult.success) {
        paymentUrl = daimoResult.paymentUrl;
      }
    } catch (daimoErr) {
      logger.warn('Daimo payment creation failed for tip, falling back:', daimoErr.message);
    }

    res.json({
      success: true,
      tipId: tip.id,
      paymentUrl,
      amount: numAmount,
    });
  } catch (error) {
    logger.error('Live tips proxy create error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to create tip' });
  }
}));

// GET /api/proxy/live/tips/recent — Recent completed tips
app.get('/api/proxy/live/tips/recent', asyncHandler(async (req, res) => {
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
    logger.error('Live tips proxy recent error:', error.message);
    res.json({ success: true, tips: [] });
  }
}));

// POST /api/proxy/live/tips/callback — Payment webhook callback (requires webhook secret)
app.post('/api/proxy/live/tips/callback', webhookLimiter, asyncHandler(async (req, res) => {
  try {
    // Verify webhook secret to prevent payment bypass
    const webhookSecret = process.env.DAIMO_WEBHOOK_SECRET || process.env.N8N_WEBHOOK_SECRET;
    const providedSecret = req.get('X-Webhook-Secret') || req.get('X-N8N-SECRET');
    if (!webhookSecret || providedSecret !== webhookSecret) {
      logger.warn('Tips callback: invalid or missing webhook secret', { ip: req.ip });
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const { tipId, transactionId, status } = req.body;
    if (!tipId || !transactionId) {
      return res.status(400).json({ success: false, error: 'tipId and transactionId required' });
    }

    if (status === 'completed' || status === 'success') {
      await PNPLiveTipsService.confirmTipPayment(parseInt(tipId, 10), transactionId);
      logger.info(`Tip #${tipId} payment confirmed: ${transactionId}`);
    }

    res.json({ success: true });
  } catch (error) {
    logger.error('Live tips callback error:', error.message);
    res.status(500).json({ success: false, error: 'Callback processing failed' });
  }
}));

// --- Self-declaration age verification (for gate, not AI-photo) ---
app.post('/api/verify-age-self', asyncHandler(async (req, res) => {
  try {
    const user = req.session?.user;
    if (!user) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    // Use UserModel to properly update DB, set timestamps, AND invalidate Redis cache
    const UserModel = require('../../models/userModel');
    const updated = await UserModel.updateAgeVerification(user.id, {
      verified: true,
      method: 'self_declaration',
      expiresHours: 8760, // 1 year for self-declaration
    });

    if (!updated) {
      return res.status(500).json({ success: false, error: 'Failed to update verification' });
    }

    req.session.user.ageVerified = true;
    await new Promise((resolve, reject) => {
      req.session.save((err) => err ? reject(err) : resolve());
    });
    logger.info(`User ${user.id} self-declared age verification`);
    res.json({ success: true });
  } catch (error) {
    logger.error('Age self-verification error:', error.message);
    res.status(500).json({ success: false, error: 'Verification failed' });
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

// PDS provisioning routes
app.use('/api/pds', pdsRoutes);
app.use('/api/bluesky', blueskyRoutes);
app.use('/api/element', elementRoutes);

// ==========================================
// N8N AUTOMATION ENDPOINTS
// ==========================================
const n8nAutomationController = require('./controllers/n8nAutomationController');
const n8nRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: 'Too many n8n requests',
  skip: (req) => req.get('X-N8N-SECRET') === process.env.N8N_WEBHOOK_SECRET
});

// Require X-N8N-SECRET header for all n8n endpoints (PII exposure risk without this)
const requireN8nSecret = (req, res, next) => {
  const secret = process.env.N8N_WEBHOOK_SECRET;
  if (!secret || req.get('X-N8N-SECRET') !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

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


// Sentry error handler - must be last
if (process.env.SENTRY_DSN) {
  app.use(Sentry.Handlers.errorHandler());
}

// Export app WITHOUT 404/error handlers
// These will be added in bot.js AFTER the webhook callback
module.exports = app;
