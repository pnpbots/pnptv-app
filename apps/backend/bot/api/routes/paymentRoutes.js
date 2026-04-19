const express = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { authenticateUser } = require('../middleware/auth');
const paymentController = require('../controllers/paymentController');
const { verifyAdminJWT } = require('../middleware/jwtAuth');

// Controllers and services needed for inline route logic
const { ensureEmailCredentials } = require('../../../services/userService');
const logger = require('../../../utils/logger');
const rateLimit = require('express-rate-limit');

const router = express.Router();

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

// C5: getPaymentInfo exposes ePayco keys, signatures, and userId — requires authentication.
// Only the owner of the payment (or an admin) may load checkout data.
router.get('/:paymentId', authenticateUser, asyncHandler(paymentController.getPaymentInfo));

// C5: getPaymentStatus is polled by the server-rendered payment-response page which has no
// session cookies. We protect it with a dedicated rate limiter to prevent payment-ID enumeration.
router.get('/:paymentId/status', paymentStatusLimiter, asyncHandler(paymentController.getPaymentStatus));

// Update email for a payment (collected on checkout page instead of subscribe page)
router.post('/:paymentId/email', authenticateUser, asyncHandler(async (req, res) => {
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

router.post('/tokenized-charge', authenticateUser, asyncHandler(async (req, res) => {
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

router.post('/verify-2fa', authenticateUser, asyncHandler(paymentController.verify2FA));
router.post('/complete-3ds-2', authenticateUser, asyncHandler(paymentController.complete3DS2Authentication));
router.get('/confirm-payment/:token', asyncHandler(paymentController.confirmPaymentToken));

// Retry payment webhook (admin only)
router.post('/:paymentId/retry-webhook', verifyAdminJWT, asyncHandler(paymentController.retryPaymentWebhook));

module.exports = router;
