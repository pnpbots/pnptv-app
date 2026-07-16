const express = require('express');
const authController = require('../controllers/authController');
const authGuard = require('../middleware/authGuard');
const cookieSignature = require('cookie-signature');
const cookie = require('cookie');
const { getRedis } = require('../../../config/redis');

const router = express.Router();

/**
 * Admin Authentication Routes
 */

// POST /api/auth/admin-login
router.post('/admin-login', authController.adminLogin);

/**
 * Model Authentication Routes
 */

// POST /api/auth/model-login
router.post('/model-login', authController.modelLogin);

// POST /api/auth/register-model
router.post('/register-model', authController.registerModel);

/**
 * HLS Stream Authentication — called by Nginx auth_request on live.pnptv.app
 *
 * Fast Redis-only session check: no DB hit, no middleware overhead.
 * Returns 200 if the request carries a valid __pnptv_sid session cookie,
 * 401 otherwise. Nginx blocks or allows the HLS segment based on this response.
 *
 * Session cookie: __pnptv_sid (signed, value = "s:<sid>.<sig>")
 * Redis key:      pnptv:sess:<sid>   (prefix comes from ioredis keyPrefix)
 */
// GET /api/auth/validate-hls
router.get('/validate-hls', async (req, res) => {
  try {
    // Parse the raw Cookie header manually — no cookie-parser middleware in this app
    const cookieHeader = req.headers.cookie;
    if (!cookieHeader) return res.sendStatus(401);
    const cookies = cookie.parse(cookieHeader);
    const raw = cookies['__pnptv_sid'];
    if (!raw) return res.sendStatus(401);

    // Signed cookies produced by express-session start with "s:"
    if (!raw.startsWith('s:')) return res.sendStatus(401);

    const sessionSecret = process.env.SESSION_SECRET;
    if (!sessionSecret) return res.sendStatus(401);

    // Unsign the cookie value (strip "s:" prefix first)
    const unsigned = cookieSignature.unsign(raw.slice(2), sessionSecret);
    if (!unsigned) return res.sendStatus(401);

    // Look up session in Redis — key is sess:<sid> (ioredis adds the pnptv: prefix)
    const redis = getRedis();
    const data = await redis.get(`sess:${unsigned}`);
    if (!data) return res.sendStatus(401);

    // Parse and validate session has a user
    let session;
    try {
      session = JSON.parse(data);
    } catch {
      return res.sendStatus(401);
    }

    if (!session?.user?.id) return res.sendStatus(401);

    return res.sendStatus(200);
  } catch (err) {
    // Fail closed — any unexpected error denies access
    return res.sendStatus(401);
  }
});

/**
 * Public Auth Endpoints
 */

// GET /api/auth/status
router.get('/status', authController.checkAuthStatus);

// GET /api/auth/admin-check
router.get('/admin-check', authGuard, authController.checkAdminStatus);

// GET /api/auth/model-check
router.get('/model-check', authGuard, authController.checkModelStatus);

/**
 * Protected Endpoints
 */

// POST /api/auth/logout
router.post('/logout', authGuard, authController.logout);

module.exports = router;
