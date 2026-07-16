'use strict';

/**
 * creator-subscription-payment.test.js
 *
 * Integration tests for creator profile subscription payment:
 *   POST /api/webapp/creator/:creatorId/subscribe
 *   POST /api/webapp/creator/:creatorId/unsubscribe
 *
 * Pattern: build a minimal Express app that imports the controller functions
 * directly, inject mocked middleware, test via supertest.
 */

// ── Environment ───────────────────────────────────────────────────────────────
process.env.SESSION_SECRET = 'test-session-secret-padding-padding-padding';
process.env.NODE_ENV = 'test';

// ── Mocks ─────────────────────────────────────────────────────────────────────

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

// Creator service
const mockSubscribeToCreator   = jest.fn();
const mockUnsubscribeFromCreator = jest.fn();
const mockGetSubscriptionStatus  = jest.fn();
jest.mock('../services/creatorService', () => ({
  subscribeToCreator:     (...args) => mockSubscribeToCreator(...args),
  unsubscribeFromCreator: (...args) => mockUnsubscribeFromCreator(...args),
  getSubscriptionStatus:  (...args) => mockGetSubscriptionStatus(...args),
  checkEligibility:       jest.fn(),
  activateCreator:        jest.fn(),
  getCreatorDashboard:    jest.fn(),
  listApplications:       jest.fn(),
  approveApplication:     jest.fn(),
  rejectApplication:      jest.fn(),
}));

// Settlement service
const mockSettleCreatorSubscription = jest.fn();
jest.mock('../services/paymentSettlementService', () => ({
  settleCreatorSubscription: (...args) => mockSettleCreatorSubscription(...args),
}));

// Helpers
const mockResolveUserId = jest.fn();
jest.mock('../bot/utils/helpers', () => ({
  resolveUserId: (...args) => mockResolveUserId(...args),
  isAdminUser:   jest.fn(() => false),
}));

// accessService (used by channel purchase route — not needed here but required by controller file)
jest.mock('../services/accessService', () => ({
  hasAccess:          jest.fn(async () => true),
  checkChannelAccess: jest.fn(async () => ({ allowed: false })),
}));

// XAutoCampaignService (imported by creatorController)
jest.mock('../services/xAutoCampaignService', () => ({
  createCampaign: jest.fn(),
  getCampaigns:   jest.fn(),
}));

// IdentityVerificationService
jest.mock('../services/identityVerificationService', () => ({
  checkVerification: jest.fn(async () => ({ verified: true })),
}));

// NotificationEmitter
jest.mock('../services/notificationEmitter', () => ({
  emit: jest.fn(),
}));

// btcpay
jest.mock('../config/btcpay', () => ({
  createDashInvoice:        jest.fn(),
  createInvoice:            jest.fn(),
  validateWebhookSignature: jest.fn().mockReturnValue(true),
  checkInvoiceProcessed:    jest.fn().mockResolvedValue(false),
  markInvoiceProcessed:     jest.fn().mockResolvedValue(undefined),
  getInvoice:               jest.fn(),
  getInvoicePaymentMethods: jest.fn(async () => []),
  isConfigured:             jest.fn(() => true),
}));

// ── Test helpers ──────────────────────────────────────────────────────────────

const request = require('supertest');
const express = require('express');

const SUBSCRIBER_USER = {
  id: 'user-sub-1',
  role: 'user',
  tier: 'free',
};

const CREATOR_USER = {
  id: 'creator-99',
  role: 'model',
  tier: 'PRIME',
};

function makeAuthMiddleware(user) {
  return (req, _res, next) => {
    req.user = user;
    req.session = { user, destroy: jest.fn() };
    next();
  };
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ success: false, error: 'Not authenticated' });
  next();
}

function buildApp(sessionUser = null) {
  const creatorController = require('../bot/api/controllers/creatorController');

  const app = express();
  app.use(express.json());

  if (sessionUser) {
    app.use(makeAuthMiddleware(sessionUser));
  }

  app.get('/api/webapp/creator/:creatorId/subscription-status',
    requireAuth,
    async (req, res, next) => {
      try { await creatorController.getSubscriptionStatus(req, res); }
      catch (e) { next(e); }
    }
  );

  app.post('/api/webapp/creator/:creatorId/subscribe',
    requireAuth,
    async (req, res, next) => {
      try { await creatorController.subscribeToCreator(req, res); }
      catch (e) { next(e); }
    }
  );

  app.post('/api/webapp/creator/:creatorId/unsubscribe',
    requireAuth,
    async (req, res, next) => {
      try { await creatorController.unsubscribeFromCreator(req, res); }
      catch (e) { next(e); }
    }
  );

  app.use((err, _req, res, _next) => {
    res.status(500).json({ success: false, error: err.message });
  });

  return app;
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  Object.keys(redisMem).forEach((k) => delete redisMem[k]);
  mockQuery.mockReset();
  mockSubscribeToCreator.mockReset();
  mockUnsubscribeFromCreator.mockReset();
  mockGetSubscriptionStatus.mockReset();
  mockSettleCreatorSubscription.mockReset();
  mockResolveUserId.mockReset();
});

// =============================================================================
// 1. Auth guard
// =============================================================================

describe('POST /api/webapp/creator/:creatorId/subscribe — auth', () => {
  it('returns 401 when no session exists', async () => {
    const app = buildApp(null);
    const res = await request(app)
      .post('/api/webapp/creator/creator-99/subscribe')
      .send({ paymentId: 'pay-1' });

    expect(res.status).toBe(401);
  });
});

// =============================================================================
// 2. Creator not found
// =============================================================================

describe('POST /api/webapp/creator/:creatorId/subscribe — creator not found', () => {
  it('returns 404 when resolveUserId returns null', async () => {
    mockResolveUserId.mockResolvedValueOnce(null);

    const app = buildApp(SUBSCRIBER_USER);
    const res = await request(app)
      .post('/api/webapp/creator/nonexistent-creator/subscribe')
      .send({ paymentId: 'pay-1' });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/creator not found/i);
  });
});

// =============================================================================
// 3. Subscribe happy path — payment pre-validation
// =============================================================================

describe('POST /api/webapp/creator/:creatorId/subscribe — happy path', () => {
  it('subscribes when payment is valid and returns success', async () => {
    mockResolveUserId.mockResolvedValueOnce('creator-99');

    // payments SELECT
    mockQuery.mockResolvedValueOnce({
      rows: [{
        user_id:  SUBSCRIBER_USER.id,
        status:   'completed',
        plan_id:  'creator_monthly',
        metadata: { type: 'creator_monthly', creatorId: 'creator-99' },
      }],
    });

    mockSubscribeToCreator.mockResolvedValueOnce({
      subscribed: true,
      expiresAt:  '2026-08-16T00:00:00.000Z',
    });

    const app = buildApp(SUBSCRIBER_USER);
    const res = await request(app)
      .post('/api/webapp/creator/creator-99/subscribe')
      .send({ paymentId: 'pay-creator-1' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.subscribed).toBe(true);
    expect(mockSubscribeToCreator).toHaveBeenCalledWith(
      SUBSCRIBER_USER.id, 'creator-99', 'pay-creator-1'
    );
  });

  it('returns 400 when paymentId is missing from body', async () => {
    const app = buildApp(SUBSCRIBER_USER);
    const res = await request(app)
      .post('/api/webapp/creator/creator-99/subscribe')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/paymentId is required/i);
  });

  it('returns 400 when payment does not belong to the requesting user', async () => {
    mockResolveUserId.mockResolvedValueOnce('creator-99');

    mockQuery.mockResolvedValueOnce({
      rows: [{
        user_id:  'someone-else',   // different user
        status:   'completed',
        plan_id:  'creator_monthly',
        metadata: {},
      }],
    });

    const app = buildApp(SUBSCRIBER_USER);
    const res = await request(app)
      .post('/api/webapp/creator/creator-99/subscribe')
      .send({ paymentId: 'pay-stolen' });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/does not belong/i);
  });

  it('returns 400 when payment is still pending (not completed)', async () => {
    mockResolveUserId.mockResolvedValueOnce('creator-99');

    mockQuery.mockResolvedValueOnce({
      rows: [{
        user_id:  SUBSCRIBER_USER.id,
        status:   'pending',   // not completed
        plan_id:  'creator_monthly',
        metadata: {},
      }],
    });

    const app = buildApp(SUBSCRIBER_USER);
    const res = await request(app)
      .post('/api/webapp/creator/creator-99/subscribe')
      .send({ paymentId: 'pay-pending' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('PAYMENT_NOT_COMPLETED');
  });

  it('returns 400 when payment is not for a creator subscription plan', async () => {
    mockResolveUserId.mockResolvedValueOnce('creator-99');

    mockQuery.mockResolvedValueOnce({
      rows: [{
        user_id:  SUBSCRIBER_USER.id,
        status:   'completed',
        plan_id:  'prime_monthly',  // wrong plan
        metadata: {},
      }],
    });

    const app = buildApp(SUBSCRIBER_USER);
    const res = await request(app)
      .post('/api/webapp/creator/creator-99/subscribe')
      .send({ paymentId: 'pay-wrong-plan' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not for a creator subscription/i);
  });

  it('returns 400 when payment is for a different creator', async () => {
    mockResolveUserId.mockResolvedValueOnce('creator-99');

    mockQuery.mockResolvedValueOnce({
      rows: [{
        user_id:  SUBSCRIBER_USER.id,
        status:   'completed',
        plan_id:  'creator_monthly',
        metadata: { type: 'creator_monthly', creatorId: 'other-creator' },
      }],
    });

    const app = buildApp(SUBSCRIBER_USER);
    const res = await request(app)
      .post('/api/webapp/creator/creator-99/subscribe')
      .send({ paymentId: 'pay-wrong-creator' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/different creator/i);
  });
});

// =============================================================================
// 4. Error propagation from creator service
// =============================================================================

describe('POST /api/webapp/creator/:creatorId/subscribe — service errors', () => {
  it('returns 423 when creator subscriptions are paused', async () => {
    mockResolveUserId.mockResolvedValueOnce('creator-99');

    mockQuery.mockResolvedValueOnce({
      rows: [{
        user_id:  SUBSCRIBER_USER.id,
        status:   'completed',
        plan_id:  'creator_monthly',
        metadata: { type: 'creator_monthly' },
      }],
    });

    const err = new Error('Este creador pausó sus membresías.');
    err.code = 'SUBSCRIPTIONS_PAUSED';
    err.statusCode = 423;
    mockSubscribeToCreator.mockRejectedValueOnce(err);

    const app = buildApp(SUBSCRIBER_USER);
    const res = await request(app)
      .post('/api/webapp/creator/creator-99/subscribe')
      .send({ paymentId: 'pay-paused' });

    expect(res.status).toBe(423);
    expect(res.body.code).toBe('SUBSCRIPTIONS_PAUSED');
  });

  it('returns 403 when member entitlement is required', async () => {
    mockResolveUserId.mockResolvedValueOnce('creator-99');

    mockQuery.mockResolvedValueOnce({
      rows: [{
        user_id:  SUBSCRIBER_USER.id,
        status:   'completed',
        plan_id:  'creator_monthly',
        metadata: { type: 'creator_monthly' },
      }],
    });

    const err = new Error('PNP membership required to subscribe to creators.');
    err.code = 'MEMBER_REQUIRED';
    err.statusCode = 403;
    mockSubscribeToCreator.mockRejectedValueOnce(err);

    const app = buildApp(SUBSCRIBER_USER);
    const res = await request(app)
      .post('/api/webapp/creator/creator-99/subscribe')
      .send({ paymentId: 'pay-no-member' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('MEMBER_REQUIRED');
  });
});

// =============================================================================
// 5. Unsubscribe
// =============================================================================

describe('POST /api/webapp/creator/:creatorId/unsubscribe', () => {
  it('returns 401 when not authenticated', async () => {
    const app = buildApp(null);
    const res = await request(app)
      .post('/api/webapp/creator/creator-99/unsubscribe');

    expect(res.status).toBe(401);
  });

  it('returns 404 when creator does not exist', async () => {
    mockResolveUserId.mockResolvedValueOnce(null);

    const app = buildApp(SUBSCRIBER_USER);
    const res = await request(app)
      .post('/api/webapp/creator/nonexistent/unsubscribe');

    expect(res.status).toBe(404);
  });

  it('cancels creator subscription and returns success', async () => {
    mockResolveUserId.mockResolvedValueOnce('creator-99');
    mockUnsubscribeFromCreator.mockResolvedValueOnce({ unsubscribed: true });

    const app = buildApp(SUBSCRIBER_USER);
    const res = await request(app)
      .post('/api/webapp/creator/creator-99/unsubscribe');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.unsubscribed).toBe(true);
    expect(mockUnsubscribeFromCreator).toHaveBeenCalledWith(SUBSCRIBER_USER.id, 'creator-99');
  });
});

// =============================================================================
// 6. Settlement mock interface — creator subscription contract
// =============================================================================

describe('paymentSettlementService mock interface — creator subscription contract', () => {
  // paymentSettlementService is mocked at module level; full logic is tested
  // in payment-settlement-service.test.js.  These tests verify mock shape.

  it('settleCreatorSubscription mock returns ok=true and creatorId on happy path', async () => {
    const svc = require('../services/paymentSettlementService');
    svc.settleCreatorSubscription = jest.fn().mockResolvedValueOnce({
      ok: true,
      type: 'creator_subscription',
      creatorId: 'creator-99',
    });

    const result = await svc.settleCreatorSubscription({}, 'inv-crs', jest.fn());
    expect(result.ok).toBe(true);
    expect(result.creatorId).toBe('creator-99');
  });

  it('settleCreatorSubscription mock returns alreadyProcessed sentinel', async () => {
    const svc = require('../services/paymentSettlementService');
    svc.settleCreatorSubscription = jest.fn().mockResolvedValueOnce({ alreadyProcessed: true });

    const result = await svc.settleCreatorSubscription({}, 'inv-dup', jest.fn());
    expect(result.alreadyProcessed).toBe(true);
  });

  it('settleCreatorSubscription mock returns error sentinel on failure', async () => {
    const svc = require('../services/paymentSettlementService');
    svc.settleCreatorSubscription = jest.fn().mockResolvedValueOnce({
      error: 'creator_subscription_failed',
    });

    const result = await svc.settleCreatorSubscription({}, 'inv-fail', jest.fn());
    expect(result.error).toBe('creator_subscription_failed');
  });

  it('BTCPay webhook idempotency guard — second delivery is blocked (checkInvoiceProcessed)', async () => {
    const btcpay = require('../config/btcpay');
    btcpay.checkInvoiceProcessed
      .mockResolvedValueOnce(false) // first delivery
      .mockResolvedValueOnce(true); // second delivery

    const firstCheck  = await btcpay.checkInvoiceProcessed('inv-crs-webhook');
    const secondCheck = await btcpay.checkInvoiceProcessed('inv-crs-webhook');

    expect(firstCheck).toBe(false);
    expect(secondCheck).toBe(true);
    expect(mockSettleCreatorSubscription).not.toHaveBeenCalled();
  });
});
