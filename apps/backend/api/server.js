const express = require('express');
const session = require('express-session');
const RedisStore = require('connect-redis').default;
const { getRedis } = require('../config/redis');
const { config } = require('../bot/config/botConfig');
const logger = require('../utils/logger');
const { telegramAuth, checkTermsAccepted } = require('./middleware/telegramAuth');
const { handleTelegramAuth, handleAcceptTerms, checkAuthStatus } = require('./handlers/telegramAuthHandler');
const {
  healthCheck, authStatus, runAuthTests,
  getAuthActivity, getSystemMetrics
} = require('./handlers/monitoringHandler');

const app = express();
const port = config.port;

// Validate required secrets at startup
if (!process.env.SESSION_SECRET) {
  logger.error('FATAL: SESSION_SECRET environment variable is not set. Exiting.');
  process.exit(1);
}

const ADMIN_IDS = (process.env.ADMIN_USER_IDS || '').split(',').filter(Boolean);
if (ADMIN_IDS.length === 0) {
  logger.warn('ADMIN_USER_IDS is not set. All /api/monitor/* endpoints will return 403.');
}

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session middleware for Telegram auth with Redis store
const redisClient = getRedis();
app.use(session({
  store: new RedisStore({ client: redisClient, prefix: 'sess:' }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000,
  }
}));

// Serve static auth pages
app.use('/auth', express.static(__dirname + '/../../public/auth'));

// Serve monitoring dashboard
app.use('/monitoring', express.static(__dirname + '/../../public/monitoring'));

// Serve public static files (HTML pages, CSS, etc.)
app.use(express.static(__dirname + '/../../public'));

// Clean URL routes for legal pages (without .html extension)
app.get('/terms', (req, res) => {
  res.sendFile('terms.html', { root: __dirname + '/../../public' });
});

app.get('/privacy', (req, res) => {
  res.sendFile('privacy.html', { root: __dirname + '/../../public' });
});

app.get('/age-verification', (req, res) => {
  res.sendFile('age-verification.html', { root: __dirname + '/../../public' });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Legacy webhook paths — proper handlers live in webhookController.js with signature verification.
// Log and reject any stray traffic still hitting these deprecated paths.
app.post('/webhook/epayco', (req, res) => {
  logger.warn('Rejected request to deprecated /webhook/epayco (use /api/webhooks/epayco)', {
    ip: req.ip,
    ref: req.body?.x_ref_payco,
  });
  res.status(410).json({ error: 'Gone. This endpoint has been removed.' });
});

app.post('/webhook/daimo', (req, res) => {
  logger.warn('Rejected request to deprecated /webhook/daimo (use /api/webhooks/daimo)', {
    ip: req.ip,
  });
  res.status(410).json({ error: 'Gone. This endpoint has been removed.' });
});

// Error handler
app.use((error, req, res, _next) => {
  logger.error('Express error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

// Telegram Authentication API endpoints
app.post('/api/telegram-auth', handleTelegramAuth);
app.post('/api/accept-terms', handleAcceptTerms);
app.get('/api/auth-status', checkAuthStatus);

// Manual age verification endpoint (for web page) — requires Telegram auth
app.post('/api/verify-age-manual', telegramAuth, async (req, res) => {
  try {
    const userId = req.session.telegramUser.id;
    const { method, lang } = req.body;

    logger.info(`Manual age verification: user ${userId}, method: ${method}, lang: ${lang}`);

    const User = require('../models/userModel');
    const user = await User.findOne({ where: { telegram_id: userId } });

    if (user) {
      user.age_verified = true;
      user.age_verification_method = method || 'manual_web';
      user.age_verification_date = new Date();
      await user.save();
      logger.info(`Age verification updated for user ${userId}`);
    }

    res.json({ success: true, message: 'Age verification recorded' });
  } catch (error) {
    logger.error('Error processing manual age verification:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Public health check
app.get('/api/health', healthCheck);

// Admin-only monitoring endpoints
const requireAdmin = (req, res, next) => {
  const telegramId = String(req.session?.telegramUser?.id || '');
  if (!ADMIN_IDS.includes(telegramId)) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

app.get('/api/monitor/auth-status', telegramAuth, requireAdmin, authStatus);
app.get('/api/monitor/run-tests', telegramAuth, requireAdmin, runAuthTests);
app.get('/api/monitor/auth-activity', telegramAuth, requireAdmin, getAuthActivity);
app.get('/api/monitor/system-metrics', telegramAuth, requireAdmin, getSystemMetrics);

// Logout endpoint
app.post('/api/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      logger.error('Logout error:', err);
      return res.status(500).json({ error: 'Logout failed' });
    }
    res.clearCookie('connect.sid');
    logger.info('User logged out successfully');
    res.json({ success: true });
  });
});

// --- PNPtv Hybrid Feature Endpoints ---

// Middleware to protect feature endpoints
const featureAuthMiddleware = [
  telegramAuth,
  checkTermsAccepted,
];

// Hangouts URL Endpoint
app.get('/api/features/hangout/url', ...featureAuthMiddleware, (req, res) => {
  try {
    const hangoutUrl = process.env.HANGOUTS_WEB_URL;
    if (!hangoutUrl) {
      throw new Error('HANGOUTS_WEB_URL is not configured');
    }
    // Here you could add logic to generate a specific room or token
    res.json({ success: true, url: hangoutUrl });
  } catch (error) {
    logger.error('Error getting Hangout URL:', error);
    res.status(500).json({ success: false, error: 'Could not retrieve Hangout URL.' });
  }
});

// Videorama URL Endpoint
app.get('/api/features/videorama/url', ...featureAuthMiddleware, (req, res) => {
  try {
    const videoramaUrl = process.env.VIDEORAMA_WEB_URL; // Assuming this env var exists
    if (!videoramaUrl) {
      throw new Error('VIDEORAMA_WEB_URL is not configured');
    }
    res.json({ success: true, url: videoramaUrl });
  } catch (error) {
    logger.error('Error getting Videorama URL:', error);
    res.status(500).json({ success: false, error: 'Could not retrieve Videorama URL.' });
  }
});

// Nearby URL Endpoint
app.get('/api/features/nearby/url', ...featureAuthMiddleware, (req, res) => {
  try {
    const nearbyUrl = process.env.NEARBY_WEB_URL; // Assuming this env var exists
    if (!nearbyUrl) {
      throw new Error('NEARBY_WEB_URL is not configured');
    }
    res.json({ success: true, url: nearbyUrl });
  } catch (error) {
    logger.error('Error getting Nearby URL:', error);
    res.status(500).json({ success: false, error: 'Could not retrieve Nearby URL.' });
  }
});

// Start server
function startServer() {
  app.listen(port, () => {
    logger.info(`API server running on port ${port}`);
  });
}

module.exports = {
  app,
  startServer,
};
