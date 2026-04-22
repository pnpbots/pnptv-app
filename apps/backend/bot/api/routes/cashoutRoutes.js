'use strict';

const express = require('express');
const crypto = require('crypto');

const authGuard = require('../middleware/authGuard');
const creatorGuard = require('../middleware/creatorGuard');
const cashoutService = require('../../../services/cashoutService');
const { query } = require('../../../config/postgres');
const logger = require('../../../utils/logger');

const router = express.Router();

function respondError(res, e) {
  const status = typeof e.status === 'number' ? e.status : 500;
  res.status(status).json({
    success: false,
    error: { code: e.code || 'INTERNAL', message: e.message || 'Internal error' },
  });
}

// ── Creator-facing endpoints (auth + active creator required) ────────────────

router.get('/balance', authGuard, creatorGuard, async (req, res) => {
  try {
    const balance = await cashoutService.getCreatorBalance(req.user.id);
    res.json(balance);
  } catch (e) {
    logger.error('GET /api/cashout/balance failed', { userId: req.user?.id, error: e.message });
    respondError(res, e);
  }
});

router.post('/request', authGuard, creatorGuard, async (req, res) => {
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

router.get('/history', authGuard, creatorGuard, async (req, res) => {
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
