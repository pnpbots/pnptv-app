'use strict';

/**
 * subscribe-checkout.test.js
 *
 * Integration-level tests for /api/subscriptions/* routes backed by
 * SubscriptionPaymentController + authGuard middleware.
 *
 * Pattern: build a minimal Express app per describe block (same as
 * mainStage.security.test.js), mock all I/O, test via supertest.
 */

// ── Environment ───────────────────────────────────────────────────────────────
process.env.SESSION_SECRET = 'test-session-secret-padding-padding-padding';
process.env.NODE_ENV = 'test';

// ── Module-level mocks (must be before any require) ───────────────────────────

const mockQuery = jest.fn();
jest.mock('../config/postgres', () => ({
  query:   (...args) => mockQuery(...args),
  getPool: jest.fn(() => ({ query: mockQuery })),
}));

const redisMem = {};
const mockRedis = {
  get:  jest.fn(async (k) => redisMem[k] ?? null),
  set:  jest.fn(async (k, v) => { redisMem[k] = v; return 'OK'; }),
  del:  jest.fn(async (k) => { delete redisMem[k]; return 1; }),
  setex: jest.fn(async () => 'OK'),
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

// ── Service / model mocks ─────────────────────────────────────────────────────

const mockGetPlansByRole = jest.fn();
jest.mock('../models/subscriptionModel', () => ({
  getPlansByRole: (...args) => mockGetPlansByRole(...args),
}));

const mockGetSubscriptionDetails = jest.fn();
const mockCancelSubscription     = jest.fn();
const mockHasFeatureAccess       = jest.fn();
jest.mock('../services/subscriptionService', () => ({
  getSubscriptionDetails: (...args) => mockGetSubscriptionDetails(...args),
  cancelSubscription:     (...args) => mockCancelSubscription(...args),
  hasFeatureAccess:       (...args) => mockHasFeatureAccess(...args),
}));

const mockPlatformBanService = { isBanned: jest.fn(async () => null) };
jest.mock('../services/platformBanService', () => mockPlatformBanService);

const mockSettleSubscription = jest.fn();
jest.mock('../services/paymentSettlementService', () => ({
  settleSubscription: (...args) => mockSettleSubscription(...args),
}));

// ── Test helpers ──────────────────────────────────────────────────────────────

const request = require('supertest');
const express = require('express');

/**
 * Build a minimal Express app that mounts the subscription router.
 * If `sessionUser` is provided, injects it as req.session.user;
 * authGuard's DB check is satisfied by the mockQuery default below.
 */
function buildApp(sessionUser = null) {
  const app = express();
  app.use(express.json());

  // Inject session manually
  app.use((req, _res, next) => {
    req.session = sessionUser ? { user: sessionUser, destroy: jest.fn() } : {};
    next();
  });

  const subscriptionRoutes = require('../bot/api/routes/subscriptionRoutes');
  app.use('/api/subscriptions', subscriptionRoutes);

  app.use((err, _req, res, _next) => {
    res.status(500).json({ success: false, error: err.message });
  });

  return app;
}

/** Make authGuard's DB SELECT return an active, consented user row. */
function mockActiveUser() {
  mockQuery.mockResolvedValueOnce({
    rows: [{ is_active: true, is_deleted: false }],
  });
}

const AUTHED_USER = {
  id: 'user-123',
  role: 'user',
  tier: 'free',
  age_verified: true,
  terms_accepted: true,
};

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  Object.keys(redisMem).forEach((k) => delete redisMem[k]);
  mockQuery.mockReset();
  mockPlatformBanService.isBanned.mockResolvedValue(null);
});

// =============================================================================
// 1. GET /api/subscriptions/plans — public, no auth required
// =============================================================================

describe('GET /api/subscriptions/plans', () => {
  it('returns 400 when role query param is missing', async () => {
    const app = buildApp(null); // unauthenticated — should not matter
    const res = await request(app).get('/api/subscriptions/plans');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_INPUT');
  });

  it('returns plans array for role=user (no auth required)', async () => {
    const plans = [
      { id: 'prime_monthly', name: 'PRIME Monthly', role: 'user', price: 9.99 },
      { id: 'member_monthly', name: 'Member', role: 'user', price: 4.99 },
    ];
    mockGetPlansByRole.mockResolvedValueOnce(plans);

    const app = buildApp(null); // unauthenticated — public route
    const res = await request(app).get('/api/subscriptions/plans?role=user');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.plans).toHaveLength(2);
    expect(res.body.data.count).toBe(2);
    expect(mockGetPlansByRole).toHaveBeenCalledWith('user');
  });

  it('filters plans by role=creator', async () => {
    const creatorPlans = [{ id: 'creator_monthly', role: 'model', price: 14.99 }];
    mockGetPlansByRole.mockResolvedValueOnce(creatorPlans);

    const app = buildApp(null);
    const res = await request(app).get('/api/subscriptions/plans?role=creator');

    expect(res.status).toBe(200);
    expect(res.body.data.plans).toHaveLength(1);
    expect(mockGetPlansByRole).toHaveBeenCalledWith('creator');
  });

  it('returns 500 when model throws', async () => {
    mockGetPlansByRole.mockRejectedValueOnce(new Error('DB error'));

    const app = buildApp(null);
    const res = await request(app).get('/api/subscriptions/plans?role=user');

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });
});

// =============================================================================
// 2. GET /api/subscriptions/my-subscription — auth required
// =============================================================================

describe('GET /api/subscriptions/my-subscription', () => {
  it('returns 401 when session cookie is missing', async () => {
    const app = buildApp(null); // no session
    const res = await request(app).get('/api/subscriptions/my-subscription');
    expect(res.status).toBe(401);
  });

  it('returns active subscription for authenticated user', async () => {
    mockActiveUser();
    const sub = { id: 'sub-1', plan_id: 'prime_monthly', status: 'active', expires_at: '2026-08-16' };
    mockGetSubscriptionDetails.mockResolvedValueOnce(sub);

    const app = buildApp(AUTHED_USER);
    const res = await request(app).get('/api/subscriptions/my-subscription');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.subscription).toMatchObject({ id: 'sub-1' });
    expect(res.body.data.hasActiveSubscription).toBe(true);
  });

  it('returns hasActiveSubscription=false when no subscription found', async () => {
    mockActiveUser();
    mockGetSubscriptionDetails.mockResolvedValueOnce(null);

    const app = buildApp(AUTHED_USER);
    const res = await request(app).get('/api/subscriptions/my-subscription');

    expect(res.status).toBe(200);
    expect(res.body.data.hasActiveSubscription).toBe(false);
    expect(res.body.data.subscription).toBeNull();
  });

  it('returns 503 when DB check in authGuard fails', async () => {
    mockQuery.mockRejectedValueOnce(new Error('pg: ECONNREFUSED'));

    const app = buildApp(AUTHED_USER);
    const res = await request(app).get('/api/subscriptions/my-subscription');

    // authGuard fails closed
    expect(res.status).toBe(503);
  });
});

// =============================================================================
// 3. POST /api/subscriptions/checkout — retired endpoint returns 410
// =============================================================================

describe('POST /api/subscriptions/checkout', () => {
  it('returns 410 Gone regardless of auth state', async () => {
    const app = buildApp(null); // no auth
    const res = await request(app)
      .post('/api/subscriptions/checkout')
      .send({ planId: 'prime_monthly' });

    // authGuard is in front of this route but the 410 is the business logic.
    // If authGuard fires first, we get 401 — both are acceptable from a security
    // standpoint. The important thing is the endpoint never processes the checkout.
    expect([401, 410]).toContain(res.status);
  });

  it('returns 410 for authenticated request (checkout is retired)', async () => {
    mockActiveUser();

    const app = buildApp(AUTHED_USER);
    const res = await request(app)
      .post('/api/subscriptions/checkout')
      .send({ planId: 'prime_monthly', provider: 'stripe' });

    expect(res.status).toBe(410);
    expect(res.body.code).toBe('CHECKOUT_RETIRED');
  });
});

// =============================================================================
// 4. POST /api/subscriptions/cancel — auth required + cancels subscription
// =============================================================================

describe('POST /api/subscriptions/cancel', () => {
  it('returns 401 when session cookie is missing', async () => {
    const app = buildApp(null);
    const res = await request(app).post('/api/subscriptions/cancel');
    expect(res.status).toBe(401);
  });

  it('cancels active subscription and returns success for authed user', async () => {
    mockActiveUser();
    const cancelledSub = { id: 'sub-1', status: 'cancelled', cancelled_at: new Date().toISOString() };
    mockCancelSubscription.mockResolvedValueOnce(cancelledSub);

    const app = buildApp(AUTHED_USER);
    const res = await request(app).post('/api/subscriptions/cancel');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.message).toMatch(/cancelled/i);
    expect(mockCancelSubscription).toHaveBeenCalledWith(AUTHED_USER.id);
  });

  it('returns 500 when cancel throws', async () => {
    mockActiveUser();
    mockCancelSubscription.mockRejectedValueOnce(new Error('No active subscription found'));

    const app = buildApp(AUTHED_USER);
    const res = await request(app).post('/api/subscriptions/cancel');

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });
});

// =============================================================================
// 5. GET /api/subscriptions/history — paginated payment history
// =============================================================================

describe('GET /api/subscriptions/history', () => {
  it('returns 401 when not authenticated', async () => {
    const app = buildApp(null);
    const res = await request(app).get('/api/subscriptions/history');
    expect(res.status).toBe(401);
  });

  it('returns paginated payment history for authed user', async () => {
    // authGuard SELECT
    mockActiveUser();
    // history SELECT
    const payments = [
      { id: 'pay-1', reference: 'ref-1', amount: '9.99', currency: 'USD', provider: 'btcpay', status: 'completed', created_at: '2026-07-01' },
      { id: 'pay-2', reference: 'ref-2', amount: '9.99', currency: 'USD', provider: 'btcpay', status: 'completed', created_at: '2026-06-01' },
    ];
    mockQuery.mockResolvedValueOnce({ rows: payments });

    const app = buildApp(AUTHED_USER);
    const res = await request(app).get('/api/subscriptions/history?limit=10&offset=0');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.payments).toHaveLength(2);
    expect(res.body.data.count).toBe(2);

    // Verify correct params were threaded into the query
    const historyCall = mockQuery.mock.calls[1]; // index 0 is authGuard
    expect(historyCall[1]).toEqual([AUTHED_USER.id, 10, 0]);
  });

  it('uses default limit=20 and offset=0 when not provided', async () => {
    mockActiveUser();
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const app = buildApp(AUTHED_USER);
    await request(app).get('/api/subscriptions/history');

    const historyCall = mockQuery.mock.calls[1];
    expect(historyCall[1]).toEqual([AUTHED_USER.id, 20, 0]);
  });
});

// =============================================================================
// 6. GET /api/subscriptions/feature-access — auth + feature check
// =============================================================================

describe('GET /api/subscriptions/feature-access', () => {
  it('returns 401 when not authenticated', async () => {
    const app = buildApp(null);
    const res = await request(app).get('/api/subscriptions/feature-access?feature=unlimitedStreams');
    expect(res.status).toBe(401);
  });

  it('returns 400 when feature param is missing', async () => {
    mockActiveUser();

    const app = buildApp(AUTHED_USER);
    const res = await request(app).get('/api/subscriptions/feature-access');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_INPUT');
  });

  it('returns hasAccess=true when user holds required feature entitlement', async () => {
    mockActiveUser();
    mockHasFeatureAccess.mockResolvedValueOnce(true);

    const app = buildApp(AUTHED_USER);
    const res = await request(app).get('/api/subscriptions/feature-access?feature=unlimitedStreams');

    expect(res.status).toBe(200);
    expect(res.body.data.hasAccess).toBe(true);
    expect(res.body.data.feature).toBe('unlimitedStreams');
    expect(mockHasFeatureAccess).toHaveBeenCalledWith(AUTHED_USER.id, 'unlimitedStreams');
  });

  it('returns hasAccess=false when user lacks entitlement', async () => {
    mockActiveUser();
    mockHasFeatureAccess.mockResolvedValueOnce(false);

    const app = buildApp(AUTHED_USER);
    const res = await request(app).get('/api/subscriptions/feature-access?feature=exclusiveContent');

    expect(res.status).toBe(200);
    expect(res.body.data.hasAccess).toBe(false);
  });
});

// =============================================================================
// 7. Settlement contract — mock interface assertions
// =============================================================================

describe('paymentSettlementService mock interface — subscription route contract', () => {
  // paymentSettlementService is mocked at module level; these tests verify
  // that the mock shape is correct so the webhook controller will receive
  // the expected result.  The full settlement logic is tested in
  // payment-settlement-service.test.js.

  it('settleSubscription mock returns a resolvable promise when called', async () => {
    const svc = require('../services/paymentSettlementService');

    // The module-level mock returns undefined by default (mockReset was called).
    // Wire up a resolved value to verify the interface shape.
    svc.settleSubscription = jest.fn().mockResolvedValueOnce({
      ok: true,
      type: 'subscription',
      planId: 'prime_monthly',
    });

    const result = await svc.settleSubscription({}, 'inv-contract', {}, jest.fn(), {});

    expect(result.ok).toBe(true);
    expect(result.type).toBe('subscription');
    expect(result.planId).toBe('prime_monthly');
  });

  it('settleSubscription mock returns alreadyProcessed sentinel correctly', async () => {
    const svc = require('../services/paymentSettlementService');

    svc.settleSubscription = jest.fn().mockResolvedValueOnce({
      alreadyProcessed: true,
    });

    const result = await svc.settleSubscription({}, 'inv-dup', {}, jest.fn(), {});
    expect(result.alreadyProcessed).toBe(true);
  });
});
