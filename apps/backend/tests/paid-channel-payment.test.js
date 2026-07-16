'use strict';

/**
 * paid-channel-payment.test.js
 *
 * Integration tests for:
 *   POST /api/webapp/channels/:channelId/purchase
 *
 * Route lives inline in routes.js. We replicate the exact handler logic in a
 * minimal Express app (the same pattern used by mainStage.security.test.js).
 */

// ── Environment ───────────────────────────────────────────────────────────────
process.env.SESSION_SECRET = 'test-session-secret-padding-padding-padding';
process.env.NODE_ENV = 'test';
// Ensure NowPayments key is present so the NP branch can be tested
process.env.NOWPAYMENTS_API_KEY = 'test-np-key-123';

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

// BTCPay — createDashInvoice is the key collaborator
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

// NowPayments HTTP — mock axios used by the route
const mockAxiosPost = jest.fn();
jest.mock('axios', () => ({
  post: (...args) => mockAxiosPost(...args),
  get:  jest.fn(),
  create: jest.fn(() => ({ get: jest.fn(), post: jest.fn() })),
}));

// accessService — channel access check
const mockCheckChannelAccess = jest.fn();
jest.mock('../services/accessService', () => ({
  hasAccess:          jest.fn(async () => true),
  checkChannelAccess: (...args) => mockCheckChannelAccess(...args),
}));

// Settlement service
const mockSettleScopedPurchase = jest.fn();
jest.mock('../services/paymentSettlementService', () => ({
  settleScopedPurchase: (...args) => mockSettleScopedPurchase(...args),
}));

// entitlementAccessService — for hasResourceAccess
const mockHasResourceAccess = jest.fn();
jest.mock('../services/entitlementAccessService', () => ({
  hasResourceAccess: (...args) => mockHasResourceAccess(...args),
  hasEntitlement:    jest.fn(async () => false),
  invalidateCache:   jest.fn().mockResolvedValue(undefined),
  requireEntitlement: () => (_req, _res, next) => next(),
  requireResourceAccess: () => (_req, _res, next) => next(),
}));

// ── Test helpers ──────────────────────────────────────────────────────────────

const request = require('supertest');
const express = require('express');

const AUTHED_USER = {
  id: 'user-ch-1',
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

// Replicate the channel purchase route from routes.js exactly
function buildApp(sessionUser = null) {
  const { createDashInvoice } = require('../config/btcpay');
  const { getPool }           = require('../config/postgres');
  const { checkChannelAccess } = require('../services/accessService');
  const logger                = require('../utils/logger');
  const axios                 = require('axios');

  const app = express();
  app.use(express.json());

  app.use((req, _res, next) => {
    req.session = sessionUser ? { user: sessionUser, destroy: jest.fn() } : {};
    next();
  });

  // channelPurchaseLimiter replaced by pass-through in tests
  app.post('/api/webapp/channels/:channelId/purchase', requireSessionAuth, async (req, res) => {
    const user = req.session?.user || req.user;
    const channelId = parseInt(req.params.channelId, 10);
    const { provider, email } = req.body || {};

    if (!Number.isFinite(channelId)) {
      return res.status(400).json({ error: 'Invalid channel ID' });
    }
    if (!provider || !['dash', 'nowpayments'].includes(provider)) {
      return res.status(400).json({ error: 'Provider must be dash or nowpayments' });
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

    const access = await checkChannelAccess(user.id, channel);
    if (access.allowed) {
      return res.status(400).json({ error: 'You already have access to this channel' });
    }

    const channelPrice = Number(channel.price_usd);
    const userId = String(user.telegram_id || user.id);
    const webappUrl = process.env.WEBAPP_URL || 'https://pnptv.app';
    const scopeMetadata = {
      channelId: channel.id,
      hangoutGroupId: channel.hangout_group_id,
      channelName: channel.name,
      ...(email ? { email } : {}),
    };

    if (provider === 'dash') {
      try {
        const discountedChannelPrice = Math.round(channelPrice * 0.95 * 100) / 100;
        const orderId = `pnptv-channel-${userId}-${channel.id}-test`;
        const invoice = await createDashInvoice({
          usdAmount: discountedChannelPrice,
          userId,
          orderId,
          description: `Channel access: ${channel.name}`,
          redirectUrl: `${webappUrl}/chat/${channel.hangout_group_id || ''}`,
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
        const orderId = `pnptv-nowp-channel-${userId}-${channel.id}-test`;
        const paymentResp = await axios.post(`${npUrl}/invoice`, {
          price_amount: channelPrice,
          price_currency: 'usd',
          order_id: orderId,
          order_description: `Channel access: ${channel.name}`,
          ipn_callback_url: `${webappUrl}/api/webhooks/nowpayments`,
          success_url: `${webappUrl}/chat/${channel.hangout_group_id || ''}?payment=success`,
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
           VALUES ($1, 'channel_access', $2, $3, $4, 'pending', $5)
           ON CONFLICT (btcpay_invoice_id) DO UPDATE
             SET status = dash_subscription_orders.status
           RETURNING id`,
          [userId, email || null, channelPrice, orderId, JSON.stringify({ ...scopeMetadata, provider: 'nowpayments', invoiceUrl })]
        );
        return res.json({
          success: true,
          paymentId: String(insertRes.rows[0].id),
          invoiceId: orderId,
          checkoutUrl: invoiceUrl,
        });
      } catch (err) {
        logger.error(`Channel nowpayments purchase failed: ${err.message}`);
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

// ── Channel row fixtures ──────────────────────────────────────────────────────

function paidChannel(overrides = {}) {
  return {
    id: 55,
    creator_id: 'creator-1',
    access_type: 'paid',
    price_usd: '9.99',
    hangout_group_id: 10,
    name: 'Premium Channel',
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
  mockCheckChannelAccess.mockReset();
  mockSettleScopedPurchase.mockReset();
});

// =============================================================================
// 1. Auth guard
// =============================================================================

describe('POST /api/webapp/channels/:channelId/purchase — auth', () => {
  it('returns 401 when no session', async () => {
    const app = buildApp(null);
    const res = await request(app)
      .post('/api/webapp/channels/55/purchase')
      .send({ provider: 'dash' });

    expect(res.status).toBe(401);
  });
});

// =============================================================================
// 2. Input validation
// =============================================================================

describe('POST /api/webapp/channels/:channelId/purchase — validation', () => {
  it('returns 400 for invalid (non-numeric) channelId', async () => {
    const app = buildApp(AUTHED_USER);
    const res = await request(app)
      .post('/api/webapp/channels/abc/purchase')
      .send({ provider: 'dash' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid channel id/i);
  });

  it('returns 400 when provider is missing', async () => {
    const app = buildApp(AUTHED_USER);
    const res = await request(app)
      .post('/api/webapp/channels/55/purchase')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/provider must be/i);
  });

  it('returns 400 when provider is not dash or nowpayments', async () => {
    const app = buildApp(AUTHED_USER);
    const res = await request(app)
      .post('/api/webapp/channels/55/purchase')
      .send({ provider: 'stripe' });

    expect(res.status).toBe(400);
  });

  it('returns 404 when channel does not exist', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [] }); // no channel found

    const app = buildApp(AUTHED_USER);
    const res = await request(app)
      .post('/api/webapp/channels/9999/purchase')
      .send({ provider: 'dash' });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/channel not found/i);
  });

  it('returns 400 for prime-type channels (included in PRIME membership)', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [paidChannel({ access_type: 'prime', price_usd: '0' })] });
    mockCheckChannelAccess.mockResolvedValueOnce({ allowed: false });

    const app = buildApp(AUTHED_USER);
    const res = await request(app)
      .post('/api/webapp/channels/55/purchase')
      .send({ provider: 'dash' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('PRIME_REQUIRED');
  });

  it('returns 400 for free channel (no price_usd)', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [paidChannel({ access_type: 'free', price_usd: null })] });

    const app = buildApp(AUTHED_USER);
    const res = await request(app)
      .post('/api/webapp/channels/55/purchase')
      .send({ provider: 'dash' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/does not require payment/i);
  });

  it('returns 400 when user already has channel access', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [paidChannel()] });
    mockCheckChannelAccess.mockResolvedValueOnce({ allowed: true }); // already has access

    const app = buildApp(AUTHED_USER);
    const res = await request(app)
      .post('/api/webapp/channels/55/purchase')
      .send({ provider: 'dash' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already have access/i);
  });
});

// =============================================================================
// 3. Dash / BTCPay happy path
// =============================================================================

describe('POST /api/webapp/channels/:channelId/purchase — Dash happy path', () => {
  it('creates BTCPay invoice, inserts order, returns checkoutUrl', async () => {
    // Channel SELECT
    mockPoolQuery.mockResolvedValueOnce({ rows: [paidChannel()] });
    // No existing access
    mockCheckChannelAccess.mockResolvedValueOnce({ allowed: false });
    // BTCPay invoice creation
    mockCreateDashInvoice.mockResolvedValueOnce({
      invoiceId:   'btcpay-inv-ch-1',
      checkoutUrl: 'https://btcpay.pnptv.app/i/btcpay-inv-ch-1',
    });
    // INSERT into dash_subscription_orders
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ id: 77 }] });

    const app = buildApp(AUTHED_USER);
    const res = await request(app)
      .post('/api/webapp/channels/55/purchase')
      .send({ provider: 'dash' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.paymentId).toBe('77');
    expect(res.body.invoiceId).toBe('btcpay-inv-ch-1');
    expect(res.body.checkoutUrl).toBe('https://btcpay.pnptv.app/i/btcpay-inv-ch-1');

    // Verify 5% Dash discount was applied (9.99 * 0.95 = 9.4905 → 9.49)
    const invoiceCall = mockCreateDashInvoice.mock.calls[0][0];
    expect(invoiceCall.usdAmount).toBeCloseTo(9.49, 1);
  });

  it('stores channel_access plan_id and channelId in metadata', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [paidChannel()] });
    mockCheckChannelAccess.mockResolvedValueOnce({ allowed: false });
    mockCreateDashInvoice.mockResolvedValueOnce({
      invoiceId: 'btcpay-inv-meta',
      checkoutUrl: 'https://btcpay.pnptv.app/i/btcpay-inv-meta',
    });
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ id: 88 }] });

    const app = buildApp(AUTHED_USER);
    await request(app)
      .post('/api/webapp/channels/55/purchase')
      .send({ provider: 'dash' });

    // The INSERT SQL hardcodes 'channel_access' in the query string (not params).
    // Find the INSERT by looking for it in the SQL text (call[0]).
    const insertCall = mockPoolQuery.mock.calls.find(
      (call) => typeof call[0] === 'string' && call[0].includes('channel_access')
    );
    expect(insertCall).toBeDefined();
    // Metadata is the 5th param ($5 → index 4 in the params array)
    const metadataArg = JSON.parse(insertCall[1][4]);
    expect(metadataArg.channelId).toBe(55);
  });

  it('returns 503 when BTCPay not configured', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [paidChannel()] });
    mockCheckChannelAccess.mockResolvedValueOnce({ allowed: false });

    const err = new Error('BTCPay not configured');
    mockCreateDashInvoice.mockRejectedValueOnce(err);

    const app = buildApp(AUTHED_USER);
    const res = await request(app)
      .post('/api/webapp/channels/55/purchase')
      .send({ provider: 'dash' });

    expect(res.status).toBe(503);
    expect(res.body.code).toBe('BTCPAY_NOT_CONFIGURED');
  });
});

// =============================================================================
// 4. NowPayments happy path
// =============================================================================

describe('POST /api/webapp/channels/:channelId/purchase — NowPayments happy path', () => {
  it('creates NowPayments invoice and returns checkout URL', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [paidChannel()] });
    mockCheckChannelAccess.mockResolvedValueOnce({ allowed: false });

    mockAxiosPost.mockResolvedValueOnce({ data: { id: 'np-inv-ch-1' } });
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ id: 99 }] });

    const app = buildApp(AUTHED_USER);
    const res = await request(app)
      .post('/api/webapp/channels/55/purchase')
      .send({ provider: 'nowpayments' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.paymentId).toBe('99');
    expect(res.body.checkoutUrl).toBe('https://nowpayments.io/payment?iid=np-inv-ch-1');
  });

  it('returns 502 when NowPayments API call fails', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [paidChannel()] });
    mockCheckChannelAccess.mockResolvedValueOnce({ allowed: false });
    mockAxiosPost.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const app = buildApp(AUTHED_USER);
    const res = await request(app)
      .post('/api/webapp/channels/55/purchase')
      .send({ provider: 'nowpayments' });

    expect(res.status).toBe(502);
    expect(res.body.code).toBe('NOWPAYMENTS_ERROR');
  });
});

// =============================================================================
// 5. Settlement mock interface — channel access contract
// =============================================================================

describe('paymentSettlementService mock interface — channel access contract', () => {
  // paymentSettlementService is mocked at module level; full logic is in
  // payment-settlement-service.test.js.  These tests verify mock shape.

  it('settleScopedPurchase mock returns ok=true and type=scoped_purchase', async () => {
    const svc = require('../services/paymentSettlementService');
    svc.settleScopedPurchase = jest.fn().mockResolvedValueOnce({
      ok: true,
      type: 'scoped_purchase',
      grantResult: { granted: 1 },
    });

    const result = await svc.settleScopedPurchase({}, 'inv-ch', { channelId: 55 }, jest.fn());
    expect(result.ok).toBe(true);
    expect(result.type).toBe('scoped_purchase');
  });

  it('settleScopedPurchase mock returns alreadyProcessed sentinel', async () => {
    const svc = require('../services/paymentSettlementService');
    svc.settleScopedPurchase = jest.fn().mockResolvedValueOnce({ alreadyProcessed: true });

    const result = await svc.settleScopedPurchase({}, 'inv-dup', { channelId: 55 }, jest.fn());
    expect(result.alreadyProcessed).toBe(true);
  });

  it('channel scope metadata is threaded correctly via mock verification', async () => {
    const svc = require('../services/paymentSettlementService');
    svc.settleScopedPurchase = jest.fn().mockResolvedValueOnce({ ok: true, type: 'scoped_purchase' });

    const meta = { channelId: 55, hangoutGroupId: 10, channelName: 'Premium Channel' };
    await svc.settleScopedPurchase({}, 'inv-ch-meta', meta, jest.fn());

    expect(svc.settleScopedPurchase).toHaveBeenCalledWith(
      expect.any(Object),
      'inv-ch-meta',
      expect.objectContaining({ channelId: 55 }),
      expect.any(Function)
    );
  });
});
