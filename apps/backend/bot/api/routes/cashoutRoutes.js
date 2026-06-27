'use strict';

const express = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');

const authGuard = require('../middleware/authGuard');
const creatorGuard = require('../middleware/creatorGuard');
const cashoutService = require('../../../services/cashoutService');
const { query } = require('../../../config/postgres');
const logger = require('../../../utils/logger');

const router = express.Router();

// 10 cashout requests/hour per creator — the service uses SKIP LOCKED so the
// DB is safe, but each request dispatches against an external provider
// (Bitrefill / Transak). This caps abuse and accidental retry storms.
const cashoutRequestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => req.session?.user?.id || req.ip,
  handler: (_req, res) =>
    res.status(429).json({
      success: false,
      error: { code: 'RATE_LIMITED', message: 'Too many cashout requests. Please wait before retrying.' },
    }),
  standardHeaders: true,
  legacyHeaders: false,
});

function respondError(res, e) {
  const status = typeof e.status === 'number' ? e.status : 500;
  res.status(status).json({
    success: false,
    error: { code: e.code || 'INTERNAL', message: e.message || 'Internal error' },
  });
}

// ── Creator-facing endpoints (auth + active creator required) ────────────────

// Cashout routes require ACTIVE creator status — eligible-only users have no
// earnings rows yet and shouldn't be able to hit the payout pipeline.
async function requireActiveCreator(req, res, next) {
  if (req.user?.creator_status !== 'active' && !['admin', 'superadmin'].includes(req.user?.role)) {
    return res.status(403).json({
      success: false,
      error: { code: 'CREATOR_NOT_ACTIVE', message: 'Active creator status required for cashout.' },
    });
  }
  return next();
}

router.get('/balance', authGuard, creatorGuard, requireActiveCreator, async (req, res) => {
  try {
    const balance = await cashoutService.getCreatorBalance(req.user.id);
    res.json(balance);
  } catch (e) {
    logger.error('GET /api/cashout/balance failed', { userId: req.user?.id, error: e.message });
    respondError(res, e);
  }
});

router.post('/request', authGuard, creatorGuard, requireActiveCreator, cashoutRequestLimiter, async (req, res) => {
  try {
    const { amount_usd, lane, destination } = req.body || {};
    const amountUsd = typeof amount_usd === 'string' ? parseFloat(amount_usd) : amount_usd;
    const { order, dispatch } = await cashoutService.requestCashout({
      creatorId: req.user.id,
      amountUsd,
      lane,
      destination,
    });
    res.json({
      order_id: order.id,
      status: order.status,
      provider_ref: order.provider_ref || undefined,
      provider_meta: dispatch || undefined,
    });
  } catch (e) {
    logger.warn('POST /api/cashout/request failed', {
      userId: req.user?.id, code: e.code, error: e.message,
    });
    respondError(res, e);
  }
});

router.get('/history', authGuard, creatorGuard, requireActiveCreator, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT id, amount_usd, lane, status, requested_at, settled_at
         FROM fiat_cashout_orders
        WHERE creator_id = $1
        ORDER BY requested_at DESC
        LIMIT 100`,
      [String(req.user.id)]
    );
    res.json(rows.map(r => ({
      id: r.id,
      amount_usd: parseFloat(r.amount_usd),
      lane: r.lane,
      status: r.status,
      requested_at: r.requested_at,
      settled_at: r.settled_at,
    })));
  } catch (e) {
    logger.error('GET /api/cashout/history failed', { userId: req.user?.id, error: e.message });
    respondError(res, e);
  }
});

// ── Webhooks (no auth — HMAC-validated) ──────────────────────────────────────
// Mounted by the caller under /api/webhooks/bitrefill and /api/webhooks/transak.

function timingSafeEqualHex(aHex, bHex) {
  if (!aHex || !bHex || aHex.length !== bHex.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(aHex, 'hex'), Buffer.from(bHex, 'hex'));
  } catch {
    return false;
  }
}

async function bitrefillWebhook(req, res) {
  const secret = process.env.BITREFILL_WEBHOOK_SECRET || '';
  const signature = req.get('x-bitrefill-signature') || '';

  if (!secret) {
    logger.error('bitrefill webhook rejected: BITREFILL_WEBHOOK_SECRET not configured');
    return res.status(503).json({ success: false, error: 'webhook secret not configured' });
  }
  if (!req.rawBody) {
    logger.error('bitrefill webhook rejected: rawBody missing');
    return res.status(400).json({ success: false, error: 'raw body required' });
  }

  const expected = crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex');
  if (!timingSafeEqualHex(expected, signature)) {
    logger.warn('bitrefill webhook rejected: bad signature', { ip: req.ip });
    return res.status(401).json({ success: false, error: 'invalid signature' });
  }

  const event = req.body || {};
  const orderId = event.ref_id || event.reference || event.orderId;
  const providerRef = event.id || event.invoice_id || null;
  const eventType = String(event.event || event.status || '').toLowerCase();

  if (!orderId) {
    logger.warn('bitrefill webhook: missing orderId/ref_id', { event });
    return res.status(400).json({ success: false, error: 'missing ref_id' });
  }

  try {
    if (['paid', 'completed', 'delivered', 'invoice.paid', 'invoice.completed'].includes(eventType)) {
      await cashoutService.settleCashoutOrder(orderId, providerRef);
    } else if (['failed', 'expired', 'cancelled', 'invoice.failed', 'invoice.expired'].includes(eventType)) {
      await cashoutService.failCashoutOrder(orderId, `bitrefill: ${eventType}`);
    } else {
      logger.info('bitrefill webhook: non-terminal event ignored', { eventType, orderId });
    }
    return res.json({ success: true });
  } catch (e) {
    logger.error('bitrefill webhook handler error', { orderId, error: e.message });
    return res.status(500).json({ success: false, error: e.message });
  }
}

async function transakWebhook(req, res) {
  const secret = process.env.TRANSAK_WEBHOOK_SECRET || '';
  const signature = req.get('x-transak-signature') || '';

  if (!secret) {
    logger.error('transak webhook rejected: TRANSAK_WEBHOOK_SECRET not configured');
    return res.status(503).json({ success: false, error: 'webhook secret not configured' });
  }
  if (!req.rawBody) {
    logger.error('transak webhook rejected: rawBody missing');
    return res.status(400).json({ success: false, error: 'raw body required' });
  }

  const expected = crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex');
  if (!timingSafeEqualHex(expected, signature)) {
    logger.warn('transak webhook rejected: bad signature', { ip: req.ip });
    return res.status(401).json({ success: false, error: 'invalid signature' });
  }

  const event = req.body || {};
  const data = event.data || event;
  const orderId = data.partnerOrderId || data.partner_order_id || data.ref_id;
  const providerRef = data.id || data.orderId || null;
  const eventType = String(event.eventID || event.event || data.status || '').toUpperCase();

  if (!orderId) {
    logger.warn('transak webhook: missing partnerOrderId', { event });
    return res.status(400).json({ success: false, error: 'missing partnerOrderId' });
  }

  try {
    if (['ORDER_COMPLETED', 'COMPLETED', 'SETTLED', 'ORDER_PAYMENT_VERIFIED'].includes(eventType)) {
      await cashoutService.settleCashoutOrder(orderId, providerRef);
    } else if (['ORDER_FAILED', 'FAILED', 'ORDER_CANCELLED', 'CANCELLED', 'EXPIRED'].includes(eventType)) {
      await cashoutService.failCashoutOrder(orderId, `transak: ${eventType}`);
    } else {
      logger.info('transak webhook: non-terminal event ignored', { eventType, orderId });
    }
    return res.json({ success: true });
  } catch (e) {
    logger.error('transak webhook handler error', { orderId, error: e.message });
    return res.status(500).json({ success: false, error: e.message });
  }
}

module.exports = router;
module.exports.bitrefillWebhook = bitrefillWebhook;
module.exports.transakWebhook = transakWebhook;
