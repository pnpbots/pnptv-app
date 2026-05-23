'use strict';

/**
 * stripe-webhook.test.js
 *
 * Integration tests for webhookController.handleStripeWebhook.
 * Tests drive the controller directly (no HTTP server); req/res are mocked.
 *
 * Run with: cd apps/backend && npx jest tests/stripe-webhook.test.js --no-coverage
 */

// ── Environment ───────────────────────────────────────────────────────────────
process.env.LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || 'test-livekit-api-key';
process.env.LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || 'test-livekit-api-secret-min-32-chars-long-xx';
process.env.SESSION_SECRET = 'test-session-secret-padding-padding-padding';
process.env.STRIPE_SECRET_KEY = 'sk_test_placeholder_for_tests_only';
process.env.STRIPE_ALLOW_RESTRICTED_KEY = 'true';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_placeholder';

// ── Stripe service mock ───────────────────────────────────────────────────────
// stripeService is required inline (line 563) after all top-level mocks fire.
// We keep a stable reference so individual tests can override constructWebhookEvent.
const mockConstructWebhookEvent = jest.fn();
const mockGetSubscription = jest.fn();

jest.mock('../services/stripeService', () => ({
  constructWebhookEvent: (...args) => mockConstructWebhookEvent(...args),
  getSubscription: (...args) => mockGetSubscription(...args),
}));

// ── PaymentService mock ───────────────────────────────────────────────────────
const mockProcessStripeCheckout = jest.fn();
const mockDeactivateStripeSubscriptionEntitlements = jest.fn();
const mockScheduleStripeEntitlementExpiry = jest.fn();
const mockRenewStripeSubscriptionEntitlements = jest.fn();

jest.mock('../services/paymentService', () => ({
  processStripeCheckout: (...args) => mockProcessStripeCheckout(...args),
  deactivateStripeSubscriptionEntitlements: (...args) => mockDeactivateStripeSubscriptionEntitlements(...args),
  scheduleStripeEntitlementExpiry: (...args) => mockScheduleStripeEntitlementExpiry(...args),
  renewStripeSubscriptionEntitlements: (...args) => mockRenewStripeSubscriptionEntitlements(...args),
  // ePayco helpers required at module load time by the controller
  normalizeEpaycoTransactionState: jest.fn((s) => s),
  normalizeEpaycoCurrencyCode: jest.fn((c) => c),
}));

// ── Redis mock ────────────────────────────────────────────────────────────────
// redisStore holds per-test state; tests reset it in beforeEach.
const redisStore = {};
const mockRedisGet = jest.fn(async (k) => redisStore[k] ?? null);
const mockRedisSet = jest.fn(async (k, v) => { redisStore[k] = v; return 'OK'; });

jest.mock('../config/redis', () => ({
  getRedis: () => ({
    get: (...args) => mockRedisGet(...args),
    set: (...args) => mockRedisSet(...args),
  }),
  cache: {
    get: jest.fn(async () => null),
    set: jest.fn(async () => 'OK'),
    del: jest.fn(async () => 1),
    acquireLock: jest.fn(async () => true),
    releaseLock: jest.fn(async () => {}),
  },
}));

// ── Postgres mock ─────────────────────────────────────────────────────────────
const mockQuery = jest.fn();
jest.mock('../config/postgres', () => ({
  query: (...args) => mockQuery(...args),
  getClient: jest.fn(),
  getPool: jest.fn(() => ({ query: mockQuery })),
}));

// ── Logger mock ───────────────────────────────────────────────────────────────
jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  stream: { write: jest.fn() },
}));

// ── Other dependencies pulled in at module load time ─────────────────────────
jest.mock('../services/paymentSecurityService', () => ({}));
jest.mock('../models/paymentWebhookEventModel', () => ({}));
jest.mock('../models/paymentModel', () => ({}));
jest.mock('../services/socketSingleton', () => ({ get: jest.fn(() => null) }));
jest.mock('../services/accessService', () => ({ hasAccess: jest.fn(async () => true) }));
jest.mock('../models/blockedUser', () => ({}));
jest.mock('../../workers/mainStageMediaBroadcaster', () => ({}), { virtual: true });
jest.mock('sharp', () => jest.fn(() => ({ resize: jest.fn(), toBuffer: jest.fn() })));
jest.mock('../validation/schemas/payment.schema', () => ({
  schemas: {
    epaycoWebhook: {
      validate: jest.fn(() => ({ error: null })),
    },
  },
}));
jest.mock('livekit-server-sdk', () => ({
  WebhookReceiver: jest.fn().mockImplementation(() => ({
    receive: jest.fn(),
  })),
}));

// ── Subject under test ────────────────────────────────────────────────────────
const { handleStripeWebhook } = require('../bot/api/controllers/webhookController');

// ── Helpers ───────────────────────────────────────────────────────────────────
function createRes() {
  return {
    statusCode: 200,
    body: undefined,
    ended: false,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    end() {
      this.ended = true;
      return this;
    },
    send(payload) {
      this.body = payload;
      return this;
    },
  };
}

/**
 * Build a minimal fake Stripe event object.
 */
function makeEvent(type, dataObject, overrides = {}) {
  return {
    id: `evt_test_${type.replace(/\./g, '_')}_001`,
    type,
    data: { object: dataObject },
    ...overrides,
  };
}

/**
 * Build a req object with rawBody (Buffer) and the stripe-signature header.
 * Additional headers can be passed via extraHeaders.
 */
function createReq(rawBody, extraHeaders = {}) {
  return {
    rawBody: rawBody instanceof Buffer ? rawBody : Buffer.from(JSON.stringify(rawBody || {})),
    body: rawBody || {},
    headers: {
      'stripe-signature': 'v1=test_signature',
      ...extraHeaders,
    },
    session: {},
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('handleStripeWebhook', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Clear the shared Redis store so dedup state does not bleed between tests
    Object.keys(redisStore).forEach((k) => delete redisStore[k]);
    // Default: constructWebhookEvent succeeds, returning a passthrough of the first arg
    mockConstructWebhookEvent.mockImplementation((_rawBody, _sig) => {
      // Return a generic unknown event so tests that don't set a specific
      // mock don't accidentally exercise a real handler branch.
      return makeEvent('test.event', {});
    });
    mockGetSubscription.mockResolvedValue({
      id: 'sub_test',
      metadata: { pnptv_user_id: 'user-123', pnptv_plan_id: 'prime-monthly' },
    });
    mockProcessStripeCheckout.mockResolvedValue({ success: true });
    mockDeactivateStripeSubscriptionEntitlements.mockResolvedValue(undefined);
    mockScheduleStripeEntitlementExpiry.mockResolvedValue(undefined);
    mockRenewStripeSubscriptionEntitlements.mockResolvedValue(undefined);
  });

  // ── 1. Missing stripe-signature header ─────────────────────────────────────
  it('should return 400 when stripe-signature header is missing', async () => {
    const req = createReq({}, { 'stripe-signature': undefined });
    delete req.headers['stripe-signature'];
    const res = createRes();

    await handleStripeWebhook(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ error: 'Missing stripe-signature' });
    expect(mockConstructWebhookEvent).not.toHaveBeenCalled();
  });

  it('should return 400 when stripe-signature header is empty string', async () => {
    const req = createReq({}, { 'stripe-signature': '' });
    const res = createRes();

    await handleStripeWebhook(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ error: 'Missing stripe-signature' });
  });

  // ── 2. rawBody is not a Buffer ──────────────────────────────────────────────
  it('should return 500 when req.rawBody is not a Buffer', async () => {
    const req = {
      rawBody: '{"type":"test"}', // string, not Buffer
      body: {},
      headers: { 'stripe-signature': 'v1=test_signature' },
      session: {},
    };
    const res = createRes();

    await handleStripeWebhook(req, res);

    expect(res.statusCode).toBe(500);
    expect(res.body).toMatchObject({ error: 'Webhook body capture misconfigured' });
    expect(mockConstructWebhookEvent).not.toHaveBeenCalled();
  });

  // ── 3. Invalid signature (constructWebhookEvent throws) ─────────────────────
  it('should return 400 when Stripe signature verification fails', async () => {
    mockConstructWebhookEvent.mockImplementation(() => {
      const err = new Error('No signatures found matching the expected signature for payload');
      throw err;
    });

    const req = createReq({ type: 'checkout.session.completed' });
    const res = createRes();

    await handleStripeWebhook(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain('Webhook signature verification failed');
    expect(mockProcessStripeCheckout).not.toHaveBeenCalled();
  });

  // ── 4. Duplicate event — Redis key already present ──────────────────────────
  it('should return 200 { received: true, duplicate: true } and make no DB writes when event already processed', async () => {
    const event = makeEvent('checkout.session.completed', {
      id: 'cs_test_dup',
      payment_status: 'paid',
    });
    mockConstructWebhookEvent.mockReturnValue(event);

    // Pre-seed the Redis key to simulate a previously processed event
    redisStore[`stripe:evt:${event.id}`] = '1';

    const req = createReq(Buffer.from(JSON.stringify(event)));
    const res = createRes();

    await handleStripeWebhook(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ received: true, duplicate: true });
    expect(mockProcessStripeCheckout).not.toHaveBeenCalled();
    expect(mockDeactivateStripeSubscriptionEntitlements).not.toHaveBeenCalled();
    expect(mockRenewStripeSubscriptionEntitlements).not.toHaveBeenCalled();
  });

  // ── 5. checkout.session.completed with payment_status='paid' ────────────────
  it('should call processStripeCheckout once with the session when checkout.session.completed and payment_status=paid', async () => {
    const session = {
      id: 'cs_test_001',
      payment_status: 'paid',
      metadata: { pnptv_user_id: 'user-abc', pnptv_plan_id: 'prime-monthly' },
    };
    const event = makeEvent('checkout.session.completed', session);
    mockConstructWebhookEvent.mockReturnValue(event);

    const req = createReq(Buffer.from(JSON.stringify(event)));
    const res = createRes();

    await handleStripeWebhook(req, res);

    expect(mockProcessStripeCheckout).toHaveBeenCalledTimes(1);
    expect(mockProcessStripeCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'cs_test_001', payment_status: 'paid' })
    );
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ received: true });
  });

  it('should skip processStripeCheckout when checkout.session.completed but payment_status is not paid or complete', async () => {
    const session = {
      id: 'cs_test_unpaid',
      payment_status: 'unpaid',
      status: 'open',
    };
    const event = makeEvent('checkout.session.completed', session);
    mockConstructWebhookEvent.mockReturnValue(event);

    const req = createReq(Buffer.from(JSON.stringify(event)));
    const res = createRes();

    await handleStripeWebhook(req, res);

    expect(mockProcessStripeCheckout).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ received: true });
  });

  // ── 6. customer.subscription.deleted — cancel_at_period_end already elapsed ─
  it('should call deactivateStripeSubscriptionEntitlements when subscription deleted with past period_end', async () => {
    const pastTimestamp = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
    const sub = {
      id: 'sub_del_001',
      current_period_end: pastTimestamp,
    };
    const event = makeEvent('customer.subscription.deleted', sub);
    mockConstructWebhookEvent.mockReturnValue(event);

    const req = createReq(Buffer.from(JSON.stringify(event)));
    const res = createRes();

    await handleStripeWebhook(req, res);

    expect(mockDeactivateStripeSubscriptionEntitlements).toHaveBeenCalledTimes(1);
    expect(mockDeactivateStripeSubscriptionEntitlements).toHaveBeenCalledWith('sub_del_001');
    expect(mockScheduleStripeEntitlementExpiry).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
  });

  it('should call scheduleStripeEntitlementExpiry when subscription deleted but current_period_end is in the future', async () => {
    const futureTimestamp = Math.floor(Date.now() / 1000) + 86400; // 1 day from now
    const sub = {
      id: 'sub_del_future',
      current_period_end: futureTimestamp,
    };
    const event = makeEvent('customer.subscription.deleted', sub);
    mockConstructWebhookEvent.mockReturnValue(event);

    const req = createReq(Buffer.from(JSON.stringify(event)));
    const res = createRes();

    await handleStripeWebhook(req, res);

    expect(mockScheduleStripeEntitlementExpiry).toHaveBeenCalledTimes(1);
    expect(mockScheduleStripeEntitlementExpiry).toHaveBeenCalledWith(
      'sub_del_future',
      expect.any(Date)
    );
    expect(mockDeactivateStripeSubscriptionEntitlements).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
  });

  // ── 7. invoice.payment_succeeded with billing_reason='subscription_cycle' ───
  it('should call renewStripeSubscriptionEntitlements for subscription_cycle invoice', async () => {
    const subId = 'sub_renew_001';
    const invoice = {
      id: 'in_renew_001',
      subscription: subId,
      billing_reason: 'subscription_cycle',
      amount_paid: 999,
      currency: 'usd',
      payment_intent: 'pi_renew_001',
    };
    const event = makeEvent('invoice.payment_succeeded', invoice);
    mockConstructWebhookEvent.mockReturnValue(event);
    mockGetSubscription.mockResolvedValue({
      id: subId,
      metadata: {
        pnptv_user_id: 'user-renew',
        pnptv_plan_id: 'prime-monthly',
        creatorId: null,
      },
    });

    const req = createReq(Buffer.from(JSON.stringify(event)));
    const res = createRes();

    await handleStripeWebhook(req, res);

    expect(mockGetSubscription).toHaveBeenCalledWith(subId);
    expect(mockRenewStripeSubscriptionEntitlements).toHaveBeenCalledTimes(1);
    expect(mockRenewStripeSubscriptionEntitlements).toHaveBeenCalledWith(
      subId,
      'user-renew',
      'prime-monthly',
      expect.objectContaining({
        invoiceId: 'in_renew_001',
        paymentIntentId: 'pi_renew_001',
        amountTotal: 9.99,
        currency: 'USD',
      })
    );
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ received: true });
  });

  // ── 8. invoice.payment_succeeded with billing_reason='subscription_create' ──
  it('should NOT call renewStripeSubscriptionEntitlements for subscription_create invoice (initial charge)', async () => {
    const invoice = {
      id: 'in_create_001',
      subscription: 'sub_create_001',
      billing_reason: 'subscription_create',
      amount_paid: 999,
      currency: 'usd',
      payment_intent: 'pi_create_001',
    };
    const event = makeEvent('invoice.payment_succeeded', invoice);
    mockConstructWebhookEvent.mockReturnValue(event);

    const req = createReq(Buffer.from(JSON.stringify(event)));
    const res = createRes();

    await handleStripeWebhook(req, res);

    expect(mockRenewStripeSubscriptionEntitlements).not.toHaveBeenCalled();
    expect(mockGetSubscription).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ received: true });
  });

  // ── 9. Unrecognised event type ────────────────────────────────────────────────
  it('should return 200 { received: true } for an unrecognised event type without errors', async () => {
    const event = makeEvent('payment_intent.created', { id: 'pi_unknown_001' });
    mockConstructWebhookEvent.mockReturnValue(event);

    const req = createReq(Buffer.from(JSON.stringify(event)));
    const res = createRes();

    await handleStripeWebhook(req, res);

    expect(mockProcessStripeCheckout).not.toHaveBeenCalled();
    expect(mockDeactivateStripeSubscriptionEntitlements).not.toHaveBeenCalled();
    expect(mockScheduleStripeEntitlementExpiry).not.toHaveBeenCalled();
    expect(mockRenewStripeSubscriptionEntitlements).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ received: true });
  });

  // ── 10. Redis unavailable during dedup check — continue processing ───────────
  it('should continue processing when Redis is unavailable for the dedup check', async () => {
    const session = {
      id: 'cs_test_redis_down',
      payment_status: 'paid',
    };
    const event = makeEvent('checkout.session.completed', session);
    mockConstructWebhookEvent.mockReturnValue(event);

    // Make Redis throw on both get and set calls
    mockRedisGet.mockRejectedValue(new Error('Redis connection refused'));
    mockRedisSet.mockRejectedValue(new Error('Redis connection refused'));

    const req = createReq(Buffer.from(JSON.stringify(event)));
    const res = createRes();

    await handleStripeWebhook(req, res);

    // Despite Redis being down the handler should still process the event
    expect(mockProcessStripeCheckout).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ received: true });
  });

  // ── 11. processStripeCheckout returns a failure result ───────────────────────
  it('should return 200 even when processStripeCheckout reports an error (logged, not thrown)', async () => {
    const session = { id: 'cs_test_fail', payment_status: 'paid' };
    const event = makeEvent('checkout.session.completed', session);
    mockConstructWebhookEvent.mockReturnValue(event);
    mockProcessStripeCheckout.mockResolvedValue({ success: false, error: 'DB write failed' });

    const req = createReq(Buffer.from(JSON.stringify(event)));
    const res = createRes();

    await handleStripeWebhook(req, res);

    expect(mockProcessStripeCheckout).toHaveBeenCalledTimes(1);
    // Handler logs the failure but does NOT crash — Stripe must get 200 so it does not retry
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ received: true });
  });

  // ── 12. invoice.payment_succeeded — missing subscription ID is silently skipped
  it('should silently skip invoice.payment_succeeded when subscription field is absent', async () => {
    const invoice = {
      id: 'in_no_sub',
      subscription: null,
      billing_reason: 'subscription_cycle',
    };
    const event = makeEvent('invoice.payment_succeeded', invoice);
    mockConstructWebhookEvent.mockReturnValue(event);

    const req = createReq(Buffer.from(JSON.stringify(event)));
    const res = createRes();

    await handleStripeWebhook(req, res);

    expect(mockRenewStripeSubscriptionEntitlements).not.toHaveBeenCalled();
    expect(mockGetSubscription).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ received: true });
  });

  // ── 13. customer.subscription.deleted — no current_period_end falls back to now ──
  it('should call deactivateStripeSubscriptionEntitlements immediately when current_period_end is absent', async () => {
    const sub = {
      id: 'sub_no_period',
      current_period_end: null,
    };
    const event = makeEvent('customer.subscription.deleted', sub);
    mockConstructWebhookEvent.mockReturnValue(event);

    const req = createReq(Buffer.from(JSON.stringify(event)));
    const res = createRes();

    await handleStripeWebhook(req, res);

    // periodEnd = new Date() (now), which is not > new Date(), so deactivate is called
    expect(mockDeactivateStripeSubscriptionEntitlements).toHaveBeenCalledTimes(1);
    expect(mockDeactivateStripeSubscriptionEntitlements).toHaveBeenCalledWith('sub_no_period');
    expect(mockScheduleStripeEntitlementExpiry).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
  });

  // ── 14. checkout.session.completed with status='complete' (subscription mode)─
  it('should call processStripeCheckout when status is "complete" regardless of payment_status', async () => {
    const session = {
      id: 'cs_test_sub_mode',
      payment_status: 'no_payment_required', // subscription mode sets this
      status: 'complete',
    };
    const event = makeEvent('checkout.session.completed', session);
    mockConstructWebhookEvent.mockReturnValue(event);

    const req = createReq(Buffer.from(JSON.stringify(event)));
    const res = createRes();

    await handleStripeWebhook(req, res);

    expect(mockProcessStripeCheckout).toHaveBeenCalledTimes(1);
    expect(mockProcessStripeCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'cs_test_sub_mode', status: 'complete' })
    );
    expect(res.statusCode).toBe(200);
  });

  // ── 15. Redis idempotency key written after successful processing ─────────────
  it('should write the stripe:evt:<id> key to Redis after successful processing', async () => {
    const event = makeEvent('test.event.success', {});
    mockConstructWebhookEvent.mockReturnValue(event);

    const req = createReq(Buffer.from(JSON.stringify(event)));
    const res = createRes();

    await handleStripeWebhook(req, res);

    expect(mockRedisSet).toHaveBeenCalledWith(
      `stripe:evt:${event.id}`,
      '1',
      'EX',
      172800
    );
    expect(res.statusCode).toBe(200);
  });
});
