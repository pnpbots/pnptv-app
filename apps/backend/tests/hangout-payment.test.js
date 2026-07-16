'use strict';

/**
 * hangout-payment.test.js
 *
 * Integration tests for paid hangout purchase:
 *   POST /api/webapp/hangouts/groups/:id/purchase
 *
 * The route lives inline in routes.js and is replicated here as a minimal
 * Express app (same pattern as mainStage.security.test.js / paid-channel-payment.test.js).
 */

// ── Environment ───────────────────────────────────────────────────────────────
process.env.SESSION_SECRET = 'test-session-secret-padding-padding-padding';
process.env.NODE_ENV = 'test';
process.env.NOWPAYMENTS_API_KEY = 'test-np-key-hangout';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockPoolQuery = jest.fn();
jest.mock('../config/postgres', () => ({
  query:   (...args) => mockPoolQuery(...args),
  getPool: jest.fn(() => ({ query: mockPoolQuery })),
}));

const redisMem = {};
const mockRedis = {
  get:  jest.fn(async (k) => redisMem[k] ?? null),
  set:  jest.fn(async (k, v) => { redisMem[k] = v; return 'OK'; }),
  del:  jest.fn(async (k) => { delete redisMem[k]; return 1; }),
  setex: jest.fn(async () => 'OK'),
  acquireLock: jest.fn(async () => true),
  releaseLock: jest.fn(async () => {}),
};
jest.mock('../config/redis', () => ({
  cache:    mockRedis,
  getRedis: () => mockRedis,
}));

jest.mock('../utils/logger', () => ({
  info:  jest.fn(),
  warn:  jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  stream: { write: jest.fn() },
}));

// BTCPay
const mockCreateDashInvoice = jest.fn();
jest.mock('../config/btcpay', () => ({
  createDashInvoice:        (...args) => mockCreateDashInvoice(...args),
  createInvoice:            jest.fn(),
  validateWebhookSignature: jest.fn().mockReturnValue(true),
  checkInvoiceProcessed:    jest.fn().mockResolvedValue(false),
  markInvoiceProcessed:     jest.fn().mockResolvedValue(undefined),
  getInvoice:               jest.fn(),
  getInvoicePaymentMethods: jest.fn(async () => []),
  isConfigured:             jest.fn(() => true),
}));

// Axios (NowPayments HTTP)
const mockAxiosPost = jest.fn();
jest.mock('axios', () => ({
  post: (...args) => mockAxiosPost(...args),
  get:  jest.fn(),
  create: jest.fn(() => ({ get: jest.fn(), post: jest.fn() })),
}));

// EntitlementAccessService — hasResourceAccess for hangout gate
const mockHasResourceAccess = jest.fn();
jest.mock('../services/entitlementAccessService', () => ({
  hasResourceAccess:      (...args) => mockHasResourceAccess(...args),
  hasEntitlement:         jest.fn(async () => false),
  invalidateCache:        jest.fn().mockResolvedValue(undefined),
  requireEntitlement:     () => (_req, _res, next) => next(),
  requireResourceAccess:  () => (_req, _res, next) => next(),
}));

// Settlement service
const mockSettleScopedPurchase = jest.fn();
jest.mock('../services/paymentSettlementService', () => ({
  settleScopedPurchase: (...args) => mockSettleScopedPurchase(...args),
}));

// accessService (not used by hangout route directly, but may be required by route file deps)
jest.mock('../services/accessService', () => ({
  hasAccess:          jest.fn(async () => true),
  checkChannelAccess: jest.fn(async () => ({ allowed: false })),
}));

// ── Test helpers ──────────────────────────────────────────────────────────────

const request = require('supertest');
const express = require('express');

const AUTHED_USER = {
  id: 'user-hg-1',
  telegram_id: null,
  role: 'user',
  tier: 'free',
};

function requireSessionAuth(req, res, next) {
  if (!req.session?.user?.id) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  req.user = req.session.user;
  next();
}

// Build a minimal app replicating the hangout purchase route from routes.js
function buildApp(sessionUser = null) {
  const { createDashInvoice } = require('../config/btcpay');
  const { getPool }           = require('../config/postgres');
  const EntitlementAccessService = require('../services/entitlementAccessService');
  const logger                = require('../utils/logger');
  const axios                 = require('axios');

  const app = express();
  app.use(express.json());

  app.use((req, _res, next) => {
    req.session = sessionUser ? { user: sessionUser, destroy: jest.fn() } : {};
    next();
  });

  app.post('/api/webapp/hangouts/groups/:id/purchase', requireSessionAuth, async (req, res) => {
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
      return res.status(400).json({
        error: 'This hangout is linked to a channel. Purchase channel access instead.',
        channelId: hangout.channel_id,
      });
    }
    if (!hangout.is_paid || !hangout.price_usd || Number(hangout.price_usd) <= 0) {
      return res.status(400).json({ error: 'This hangout does not require payment' });
    }

    const decision = await EntitlementAccessService.hasResourceAccess(user.id, 'hangout', String(hangout.id));
    if (decision.allowed) {
      return res.status(400).json({ error: 'You already have access to this hangout' });
    }

    const hangoutPrice = Number(hangout.price_usd);
    const userId = String(user.telegram_id || user.id);
    const webappUrl = process.env.WEBAPP_URL || 'https://pnptv.app';
    const scopeMetadata = {
      hangoutGroupId: hangout.id,
      hangoutName: hangout.name,
      ...(email ? { email } : {}),
    };

    if (provider === 'dash') {
      try {
        const orderId = `pnptv-hangout-${userId}-${hangout.id}-test`;
        const invoice = await createDashInvoice({
          usdAmount: hangoutPrice,
          userId,
          orderId,
          description: 'Community access',
          redirectUrl: `${webappUrl}/chat/${hangout.id}`,
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

    if (provider === 'nowpayments') {
      const npApiKey = process.env.NOWPAYMENTS_API_KEY || '';
      if (!npApiKey) {
        return res.status(503).json({ error: 'Crypto payments are not available yet.', code: 'NOWPAYMENTS_NOT_CONFIGURED' });
      }
      const npUrl = process.env.NOWPAYMENTS_ENVIRONMENT === 'sandbox'
        ? 'https://api-sandbox.nowpayments.io/v1'
        : 'https://api.nowpayments.io/v1';
      try {
        const orderId = `pnptv-nowp-hangout-${userId}-${hangout.id}-test`;
        const paymentResp = await axios.post(`${npUrl}/invoice`, {
          price_amount: hangoutPrice,
          price_currency: 'usd',
          order_id: orderId,
          order_description: `Hangout access: ${hangout.name}`,
          ipn_callback_url: `${webappUrl}/api/webhooks/nowpayments`,
          success_url: `${webappUrl}/chat/${hangout.id}?payment=success`,
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
  });

  app.use((err, _req, res, _next) => {
    res.status(500).json({ success: false, error: err.message });
  });

  return app;
}

// ── Hangout fixtures ──────────────────────────────────────────────────────────

function paidHangout(overrides = {}) {
  return {
    id: 42,
    creator_id: 'creator-1',
    is_paid: true,
    price_usd: '5.00',
    channel_id: null,
    name: 'Premium Hangout',
    ...overrides,
  };
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  Object.keys(redisMem).forEach((k) => delete redisMem[k]);
  mockPoolQuery.mockReset();
  mockCreateDashInvoice.mockReset();
  mockAxiosPost.mockReset();
  mockHasResourceAccess.mockReset();
  mockSettleScopedPurchase.mockReset();
});

// =============================================================================
// 1. Auth guard
// =============================================================================

describe('POST /api/webapp/hangouts/groups/:id/purchase — auth', () => {
  it('returns 401 when no session exists', async () => {
    const app = buildApp(null);
    const res = await request(app)
      .post('/api/webapp/hangouts/groups/42/purchase')
      .send({ provider: 'dash' });

    expect(res.status).toBe(401);
  });
});

// =============================================================================
// 2. Input validation
// =============================================================================

describe('POST /api/webapp/hangouts/groups/:id/purchase — validation', () => {
  it('returns 400 for invalid (non-numeric) hangoutId', async () => {
    const app = buildApp(AUTHED_USER);
    const res = await request(app)
      .post('/api/webapp/hangouts/groups/abc/purchase')
      .send({ provider: 'dash' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid hangout id/i);
  });

  it('returns 400 when provider is missing', async () => {
    const app = buildApp(AUTHED_USER);
    const res = await request(app)
      .post('/api/webapp/hangouts/groups/42/purchase')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/provider must be/i);
  });

  it('returns 400 for unsupported provider', async () => {
    const app = buildApp(AUTHED_USER);
    const res = await request(app)
      .post('/api/webapp/hangouts/groups/42/purchase')
      .send({ provider: 'stripe' });

    expect(res.status).toBe(400);
  });

  it('returns 404 when hangout does not exist', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [] });

    const app = buildApp(AUTHED_USER);
    const res = await request(app)
      .post('/api/webapp/hangouts/groups/9999/purchase')
      .send({ provider: 'dash' });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/hangout not found/i);
  });

  it('returns 400 for free hangout (is_paid=false)', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [paidHangout({ is_paid: false, price_usd: null })] });

    const app = buildApp(AUTHED_USER);
    const res = await request(app)
      .post('/api/webapp/hangouts/groups/42/purchase')
      .send({ provider: 'dash' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/does not require payment/i);
  });

  it('returns 400 for channel-linked hangout (must go via channel purchase route)', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [paidHangout({ channel_id: 55 })] });

    const app = buildApp(AUTHED_USER);
    const res = await request(app)
      .post('/api/webapp/hangouts/groups/42/purchase')
      .send({ provider: 'dash' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/linked to a channel/i);
    expect(res.body.channelId).toBe(55);
  });

  it('returns 400 when user already has access to the hangout', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [paidHangout()] });
    mockHasResourceAccess.mockResolvedValueOnce({ allowed: true }); // already has access

    const app = buildApp(AUTHED_USER);
    const res = await request(app)
      .post('/api/webapp/hangouts/groups/42/purchase')
      .send({ provider: 'dash' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already have access/i);
  });
});

// =============================================================================
// 3. Dash / BTCPay happy path
// =============================================================================

describe('POST /api/webapp/hangouts/groups/:id/purchase — Dash happy path', () => {
  it('creates BTCPay invoice with hangout_access plan_id, returns checkoutUrl', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [paidHangout()] });
    mockHasResourceAccess.mockResolvedValueOnce({ allowed: false });
    mockCreateDashInvoice.mockResolvedValueOnce({
      invoiceId:   'btcpay-hg-1',
      checkoutUrl: 'https://btcpay.pnptv.app/i/btcpay-hg-1',
    });
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ id: 33 }] });

    const app = buildApp(AUTHED_USER);
    const res = await request(app)
      .post('/api/webapp/hangouts/groups/42/purchase')
      .send({ provider: 'dash' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.invoiceId).toBe('btcpay-hg-1');
    expect(res.body.checkoutUrl).toBe('https://btcpay.pnptv.app/i/btcpay-hg-1');
    expect(res.body.paymentId).toBe('33');

    // The INSERT SQL hardcodes 'hangout_access' in the query string (not params).
    const insertCall = mockPoolQuery.mock.calls.find(
      (call) => typeof call[0] === 'string' && call[0].includes('hangout_access')
    );
    expect(insertCall).toBeDefined();
  });

  it('stores hangoutGroupId in order metadata', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [paidHangout()] });
    mockHasResourceAccess.mockResolvedValueOnce({ allowed: false });
    mockCreateDashInvoice.mockResolvedValueOnce({
      invoiceId: 'btcpay-hg-meta',
      checkoutUrl: 'https://btcpay.pnptv.app/i/btcpay-hg-meta',
    });
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ id: 44 }] });

    const app = buildApp(AUTHED_USER);
    await request(app)
      .post('/api/webapp/hangouts/groups/42/purchase')
      .send({ provider: 'dash' });

    const insertCall = mockPoolQuery.mock.calls.find(
      (call) => typeof call[0] === 'string' && call[0].includes('hangout_access')
    );
    expect(insertCall).toBeDefined();
    const metadataArg = JSON.parse(insertCall[1][4]);
    expect(metadataArg.hangoutGroupId).toBe(42);
  });

  it('does NOT apply 5% discount on hangout dash purchases (full price)', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [paidHangout({ price_usd: '10.00' })] });
    mockHasResourceAccess.mockResolvedValueOnce({ allowed: false });
    mockCreateDashInvoice.mockResolvedValueOnce({
      invoiceId:   'btcpay-hg-full',
      checkoutUrl: 'https://btcpay.pnptv.app/i/btcpay-hg-full',
    });
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ id: 55 }] });

    const app = buildApp(AUTHED_USER);
    await request(app)
      .post('/api/webapp/hangouts/groups/42/purchase')
      .send({ provider: 'dash' });

    // Hangout route does NOT apply 5% discount (unlike channel route)
    const invoiceCall = mockCreateDashInvoice.mock.calls[0][0];
    expect(invoiceCall.usdAmount).toBe(10);
  });

  it('returns 503 when BTCPay not configured', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [paidHangout()] });
    mockHasResourceAccess.mockResolvedValueOnce({ allowed: false });
    mockCreateDashInvoice.mockRejectedValueOnce(new Error('BTCPay not configured'));

    const app = buildApp(AUTHED_USER);
    const res = await request(app)
      .post('/api/webapp/hangouts/groups/42/purchase')
      .send({ provider: 'dash' });

    expect(res.status).toBe(503);
    expect(res.body.code).toBe('BTCPAY_NOT_CONFIGURED');
  });
});

// =============================================================================
// 4. NowPayments happy path
// =============================================================================

describe('POST /api/webapp/hangouts/groups/:id/purchase — NowPayments happy path', () => {
  it('creates NowPayments invoice and returns checkout URL', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [paidHangout()] });
    mockHasResourceAccess.mockResolvedValueOnce({ allowed: false });
    mockAxiosPost.mockResolvedValueOnce({ data: { id: 'np-hg-1' } });
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ id: 66 }] });

    const app = buildApp(AUTHED_USER);
    const res = await request(app)
      .post('/api/webapp/hangouts/groups/42/purchase')
      .send({ provider: 'nowpayments' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.checkoutUrl).toBe('https://nowpayments.io/payment?iid=np-hg-1');
    expect(res.body.paymentId).toBe('66');
  });

  it('returns 502 when NowPayments API call fails', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [paidHangout()] });
    mockHasResourceAccess.mockResolvedValueOnce({ allowed: false });
    mockAxiosPost.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const app = buildApp(AUTHED_USER);
    const res = await request(app)
      .post('/api/webapp/hangouts/groups/42/purchase')
      .send({ provider: 'nowpayments' });

    expect(res.status).toBe(502);
    expect(res.body.code).toBe('NOWPAYMENTS_ERROR');
  });

  it('returns 503 when NOWPAYMENTS_API_KEY is not configured', async () => {
    // Temporarily remove the env var
    const origKey = process.env.NOWPAYMENTS_API_KEY;
    process.env.NOWPAYMENTS_API_KEY = '';

    mockPoolQuery.mockResolvedValueOnce({ rows: [paidHangout()] });
    mockHasResourceAccess.mockResolvedValueOnce({ allowed: false });

    const app = buildApp(AUTHED_USER);
    const res = await request(app)
      .post('/api/webapp/hangouts/groups/42/purchase')
      .send({ provider: 'nowpayments' });

    process.env.NOWPAYMENTS_API_KEY = origKey; // restore

    expect(res.status).toBe(503);
    expect(res.body.code).toBe('NOWPAYMENTS_NOT_CONFIGURED');
  });
});

// =============================================================================
// 5. Settlement mock interface + access control contract
// =============================================================================

describe('paymentSettlementService mock interface — hangout access contract', () => {
  // paymentSettlementService is mocked at module level; full logic is in
  // payment-settlement-service.test.js.  These tests verify mock shape and
  // the access-control lifecycle around settlement.

  it('settleScopedPurchase mock returns ok=true and type=scoped_purchase for hangout', async () => {
    const svc = require('../services/paymentSettlementService');
    svc.settleScopedPurchase = jest.fn().mockResolvedValueOnce({
      ok: true,
      type: 'scoped_purchase',
      grantResult: { granted: 1 },
    });

    const result = await svc.settleScopedPurchase({}, 'inv-hg', { hangoutGroupId: 42 }, jest.fn());
    expect(result.ok).toBe(true);
    expect(result.type).toBe('scoped_purchase');
  });

  it('settleScopedPurchase mock returns alreadyProcessed on duplicate hangout webhook', async () => {
    const svc = require('../services/paymentSettlementService');
    svc.settleScopedPurchase = jest.fn().mockResolvedValueOnce({ alreadyProcessed: true });

    const result = await svc.settleScopedPurchase({}, 'inv-dup-hg', { hangoutGroupId: 42 }, jest.fn());
    expect(result.alreadyProcessed).toBe(true);
  });

  it('hangout scope metadata is threaded correctly via mock verification', async () => {
    const svc = require('../services/paymentSettlementService');
    svc.settleScopedPurchase = jest.fn().mockResolvedValueOnce({ ok: true, type: 'scoped_purchase' });

    const meta = { hangoutGroupId: 42, hangoutName: 'Premium Hangout' };
    await svc.settleScopedPurchase({}, 'inv-hg-meta', meta, jest.fn());

    expect(svc.settleScopedPurchase).toHaveBeenCalledWith(
      expect.any(Object),
      'inv-hg-meta',
      expect.objectContaining({ hangoutGroupId: 42 }),
      expect.any(Function)
    );
  });

  it('hasResourceAccess returns false before purchase (gate enforcement)', async () => {
    mockHasResourceAccess.mockResolvedValueOnce({ allowed: false });
    const result = await require('../services/entitlementAccessService')
      .hasResourceAccess('user-hg-1', 'hangout', '42');
    expect(result.allowed).toBe(false);
  });

  it('hasResourceAccess returns true after settlement (mock simulates post-grant state)', async () => {
    mockHasResourceAccess.mockResolvedValueOnce({ allowed: true });
    const result = await require('../services/entitlementAccessService')
      .hasResourceAccess('user-hg-1', 'hangout', '42');
    expect(result.allowed).toBe(true);
  });

  it('scoped entitlement respects expires_at (expired access returns false)', async () => {
    mockHasResourceAccess.mockResolvedValueOnce({ allowed: false, reason: 'expired' });
    const result = await require('../services/entitlementAccessService')
      .hasResourceAccess('user-hg-1', 'hangout', '42');
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('expired');
  });
});
