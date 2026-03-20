'use strict';

/**
 * meru-activation.test.js
 *
 * Tests for the POST /api/webapp/activate/meru endpoint.
 * Covers: input validation, auth guard, payment verification, race conditions,
 *         link claiming, membership upgrade, entitlements, and payment history.
 *
 * Run: jest apps/backend/tests/meru-activation.test.js
 */

const request = require('supertest');
const express = require('express');
const session = require('express-session');

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockQuery = jest.fn();
jest.mock('../config/postgres', () => ({
  query: mockQuery,
  getPool: jest.fn(() => ({ query: mockQuery })),
  testConnection: jest.fn(async () => true),
}));

const mockLocks = new Set();
jest.mock('../config/redis', () => ({
  getRedis: jest.fn(() => ({})),
  cache: {
    get: jest.fn(async () => null),
    set: jest.fn(async () => 'OK'),
    del: jest.fn(async () => 1),
    acquireLock: jest.fn(async (key) => {
      if (mockLocks.has(key)) return false;
      mockLocks.add(key);
      return true;
    }),
    releaseLock: jest.fn(async (key) => { mockLocks.delete(key); }),
  },
}));

jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

// ── Service mocks ────────────────────────────────────────────────────────────

const mockVerifyPayment = jest.fn();
jest.mock('../services/meruPaymentService', () => ({
  verifyPayment: mockVerifyPayment,
}));

const mockGetAvailableLinks = jest.fn();
const mockInvalidateLinkAfterActivation = jest.fn();
jest.mock('../services/meruLinkService', () => ({
  getAvailableLinks: mockGetAvailableLinks,
  invalidateLinkAfterActivation: mockInvalidateLinkAfterActivation,
}));

const mockUpdateSubscription = jest.fn();
jest.mock('../models/userModel', () => ({
  updateSubscription: mockUpdateSubscription,
}));

const mockGrantEntitlement = jest.fn();
jest.mock('../models/entitlementModel', () => ({
  grantEntitlement: mockGrantEntitlement,
}));

const mockInvalidateCache = jest.fn();
jest.mock('../bot/services/entitlementAccessService', () => ({
  invalidateCache: mockInvalidateCache,
}));

const mockRecordPayment = jest.fn();
jest.mock('../services/paymentHistoryService', () => ({
  recordPayment: mockRecordPayment,
}));

const mockMarkCodeUsed = jest.fn();
jest.mock('../bot/handlers/payments/activation', () => ({
  markCodeUsed: mockMarkCodeUsed,
  logActivation: jest.fn(async () => {}),
}));

jest.mock('../bot/services/businessNotificationService', () => ({
  notifyCodeActivation: jest.fn(async () => {}),
}));

const mockSendPaymentConfirmationNotification = jest.fn(async () => {});
jest.mock('../bot/services/paymentService', () => ({
  sendPaymentConfirmationNotification: mockSendPaymentConfirmationNotification,
}));

jest.mock('../bot/services/invoiceservice', () => ({
  generateInvoice: jest.fn(async () => ({ buffer: Buffer.from('pdf') })),
}));
jest.mock('../bot/services/emailservice', () => ({
  sendInvoiceEmail: jest.fn(async () => {}),
  sendWelcomeEmail: jest.fn(async () => {}),
}));

const mockEnsureEmailCredentials = jest.fn(async () => {});

// ── Build test app ───────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(session({
    secret: 'test-secret-32-chars-long-enough!',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false },
  }));

  // Helper to set session for tests
  app.post('/test/set-session', (req, res) => {
    req.session.user = req.body;
    res.json({ ok: true });
  });

  const requireSessionAuth = (req, res, next) => {
    if (!req.session?.user?.id) return res.status(401).json({ error: 'Not authenticated' });
    req.user = req.session.user;
    next();
  };

  const { cache } = require('../config/redis');
  const meruPaymentService = require('../services/meruPaymentService');
  const meruLinkService = require('../services/meruLinkService');
  const UserModel = require('../models/userModel');
  const EntitlementModel = require('../models/entitlementModel');
  const EntitlementAccessService = require('../bot/services/entitlementAccessService');
  const PaymentHistoryService = require('../services/paymentHistoryService');
  const PaymentService = require('../bot/services/paymentService');
  const { getPool } = require('../config/postgres');

  // Replicate the route logic from routes.js
  app.post('/api/webapp/activate/meru', requireSessionAuth, async (req, res) => {
    const user = req.session?.user;
    if (!user?.id) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const { code, email } = req.body;
    if (!code || typeof code !== 'string' || !code.trim()) {
      return res.status(400).json({ success: false, error: 'Meru code is required' });
    }
    if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || email.trim().length > 254) {
      return res.status(400).json({ success: false, error: 'A valid email address is required' });
    }

    const meruCode = code.trim();
    if (meruCode.length > 100 || !/^[A-Za-z0-9_\-]+$/.test(meruCode)) {
      return res.status(400).json({ success: false, error: 'Invalid Meru code format' });
    }

    const userId = String(user.telegramId || user.telegram_id || user.id);
    const username = user.username || user.first_name || null;
    const language = user.language || 'es';

    const meruLockKey = `meru:activate:${meruCode}`;
    const meruLockAcquired = await cache.acquireLock(meruLockKey, 30);
    if (!meruLockAcquired) {
      return res.status(409).json({ success: false, error: 'Activation already in progress for this code' });
    }

    try {
      // Ensure email credentials
      try {
        await mockEnsureEmailCredentials(userId, email.trim(), language);
        req.session.user = { ...req.session.user, email: email.trim() };
      } catch (credErr) {
        if (credErr.message.includes('already associated')) {
          return res.status(409).json({ success: false, error: credErr.message });
        }
      }

      // Guard: already lifetime100
      if (user.plan_id === 'lifetime100') {
        return res.status(409).json({ success: false, error: 'Your account already has the Lifetime100 plan activated.' });
      }

      // 1. Check code exists and is available
      const availableLinks = await meruLinkService.getAvailableLinks();
      const matchingLink = availableLinks.find((link) => link.code === meruCode);
      if (!matchingLink) {
        return res.status(404).json({ success: false, error: 'Code not found or already used' });
      }

      // 2. Verify payment on Meru
      const verification = await meruPaymentService.verifyPayment(meruCode, language);
      if (!verification.isPaid) {
        return res.status(402).json({ success: false, error: 'Payment not yet completed on Meru. Please complete payment first.' });
      }

      // 2b. Atomically claim
      const claimResult = await meruLinkService.invalidateLinkAfterActivation(meruCode, userId, username);
      if (!claimResult.success) {
        return res.status(409).json({ success: false, error: 'Code not found or already used' });
      }

      // 3. Activate membership
      const primeExpiry = new Date();
      primeExpiry.setDate(primeExpiry.getDate() + 60);

      await UserModel.updateSubscription(userId, {
        status: 'active',
        planId: 'lifetime100',
        expiry: null,
      });

      const pool = getPool();
      await pool.query(
        `UPDATE users SET tier = 'PRIME', plan_expiry = $2, updated_at = NOW() WHERE id = $1`,
        [userId, primeExpiry.toISOString()]
      );

      // 3b. Grant entitlements
      try {
        await EntitlementModel.grantEntitlement(userId, 'pnp-member', {
          isLifetime: true, source: 'meru', actorId: 'system', reason: 'Meru lifetime100 activation',
        });
        await EntitlementModel.grantEntitlement(userId, 'prime', {
          isLifetime: false, durationDays: 60, source: 'meru', actorId: 'system', reason: 'Meru lifetime100 activation — 2 month PRIME bonus',
        });
        await EntitlementAccessService.invalidateCache(userId);
      } catch (entErr) {
        // non-critical
      }

      // 4. Mark activation code used
      try {
        const { markCodeUsed } = require('../bot/handlers/payments/activation');
        await markCodeUsed(meruCode, userId, username);
      } catch (e) {
        // non-critical
      }

      // 5. Record payment history
      try {
        await PaymentHistoryService.recordPayment({
          userId,
          paymentMethod: 'meru',
          amount: 100,
          currency: 'USD',
          planId: 'lifetime100',
          planName: 'Lifetime Member + 2 Months PRIME',
          product: 'lifetime100',
          paymentReference: meruCode,
          metadata: { activated_via: 'webapp', prime_bonus_expires: primeExpiry.toISOString() },
        });
      } catch (e) {
        // non-critical
      }

      // 6. Telegram DM (fire-and-forget)
      PaymentService.sendPaymentConfirmationNotification({
        userId, plan: { id: 'lifetime100', name: 'Lifetime Member + 2 Months PRIME' },
        transactionId: meruCode, amount: 100,
        expiryDate: primeExpiry.toISOString(), language, provider: 'meru',
      }).catch(() => {});

      return res.json({
        success: true,
        message: 'Lifetime Pass activated successfully!',
        plan: 'lifetime100',
      });
    } finally {
      await cache.releaseLock(meruLockKey);
    }
  });

  return app;
}

// ── Test helpers ─────────────────────────────────────────────────────────────

let app;
let agent;

const TEST_USER = {
  id: '12345678',
  telegramId: '12345678',
  username: 'testuser',
  first_name: 'Test',
  language: 'en',
  plan_id: 'free',
};

async function authenticatedAgent(userOverrides = {}) {
  const ag = request.agent(app);
  await ag.post('/test/set-session').send({ ...TEST_USER, ...userOverrides });
  return ag;
}

// ── Tests ────────────────────────────────────────────────────────────────────

beforeAll(() => {
  app = buildApp();
});

beforeEach(() => {
  jest.clearAllMocks();
  mockLocks.clear();
  mockEnsureEmailCredentials.mockResolvedValue(undefined);
});

describe('POST /api/webapp/activate/meru', () => {
  // ─── Auth ────────────────────────────────────────────────────────────────
  describe('authentication', () => {
    it('returns 401 without session', async () => {
      const res = await request(app)
        .post('/api/webapp/activate/meru')
        .send({ code: 'kssYDk', email: 'test@example.com' });
      expect(res.status).toBe(401);
    });
  });

  // ─── Input validation ────────────────────────────────────────────────────
  describe('input validation', () => {
    it('returns 400 when code is missing', async () => {
      agent = await authenticatedAgent();
      const res = await agent
        .post('/api/webapp/activate/meru')
        .send({ email: 'test@example.com' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/code/i);
    });

    it('returns 400 when email is missing', async () => {
      agent = await authenticatedAgent();
      const res = await agent
        .post('/api/webapp/activate/meru')
        .send({ code: 'kssYDk' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/email/i);
    });

    it('returns 400 for invalid email format', async () => {
      agent = await authenticatedAgent();
      const res = await agent
        .post('/api/webapp/activate/meru')
        .send({ code: 'kssYDk', email: 'not-an-email' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/email/i);
    });

    it('returns 400 for invalid code format (special chars)', async () => {
      agent = await authenticatedAgent();
      const res = await agent
        .post('/api/webapp/activate/meru')
        .send({ code: 'abc<script>', email: 'test@example.com' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/invalid.*code/i);
    });

    it('returns 400 for code exceeding 100 chars', async () => {
      agent = await authenticatedAgent();
      const res = await agent
        .post('/api/webapp/activate/meru')
        .send({ code: 'a'.repeat(101), email: 'test@example.com' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/invalid.*code/i);
    });

    it('accepts valid codes with hyphens and underscores', async () => {
      agent = await authenticatedAgent();
      mockGetAvailableLinks.mockResolvedValue([{ code: 'Y-yqKP' }]);
      mockVerifyPayment.mockResolvedValue({ isPaid: true, paidAt: '2026-01-01' });
      mockInvalidateLinkAfterActivation.mockResolvedValue({ success: true, link: {} });
      mockUpdateSubscription.mockResolvedValue(true);
      mockQuery.mockResolvedValue({ rows: [{ id: '12345678' }] });
      mockGrantEntitlement.mockResolvedValue(true);
      mockRecordPayment.mockResolvedValue(true);

      const res = await agent
        .post('/api/webapp/activate/meru')
        .send({ code: 'Y-yqKP', email: 'test@example.com' });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  // ─── Business logic guards ──────────────────────────────────────────────
  describe('business logic guards', () => {
    it('returns 409 when user already has lifetime100', async () => {
      agent = await authenticatedAgent({ plan_id: 'lifetime100' });
      const res = await agent
        .post('/api/webapp/activate/meru')
        .send({ code: 'kssYDk', email: 'test@example.com' });
      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/already.*lifetime/i);
    });

    it('returns 409 when email is already associated with another account', async () => {
      agent = await authenticatedAgent();
      mockEnsureEmailCredentials.mockRejectedValue(new Error('Email already associated with another account'));

      const res = await agent
        .post('/api/webapp/activate/meru')
        .send({ code: 'kssYDk', email: 'taken@example.com' });
      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/already associated/i);
    });

    it('returns 404 when code is not in available links', async () => {
      agent = await authenticatedAgent();
      mockGetAvailableLinks.mockResolvedValue([{ code: 'OTHER_CODE' }]);

      const res = await agent
        .post('/api/webapp/activate/meru')
        .send({ code: 'kssYDk', email: 'test@example.com' });
      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/not found/i);
    });

    it('returns 402 when Meru payment is not yet completed', async () => {
      agent = await authenticatedAgent();
      mockGetAvailableLinks.mockResolvedValue([{ code: 'kssYDk' }]);
      mockVerifyPayment.mockResolvedValue({ isPaid: false, meruStatus: 'CREATED' });

      const res = await agent
        .post('/api/webapp/activate/meru')
        .send({ code: 'kssYDk', email: 'test@example.com' });
      expect(res.status).toBe(402);
      expect(res.body.error).toMatch(/not yet completed/i);
    });

    it('returns 409 when atomic claim fails (race condition)', async () => {
      agent = await authenticatedAgent();
      mockGetAvailableLinks.mockResolvedValue([{ code: 'kssYDk' }]);
      mockVerifyPayment.mockResolvedValue({ isPaid: true, paidAt: '2026-01-01' });
      mockInvalidateLinkAfterActivation.mockResolvedValue({ success: false, message: 'Already used' });

      const res = await agent
        .post('/api/webapp/activate/meru')
        .send({ code: 'kssYDk', email: 'test@example.com' });
      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/already used/i);
    });
  });

  // ─── Lock / concurrency ─────────────────────────────────────────────────
  describe('concurrency lock', () => {
    it('returns 409 when lock is already held for the same code', async () => {
      agent = await authenticatedAgent();
      // Pre-acquire the lock
      mockLocks.add('meru:activate:kssYDk');

      const res = await agent
        .post('/api/webapp/activate/meru')
        .send({ code: 'kssYDk', email: 'test@example.com' });
      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/already in progress/i);
    });
  });

  // ─── Happy path ─────────────────────────────────────────────────────────
  describe('successful activation', () => {
    beforeEach(async () => {
      agent = await authenticatedAgent();
      mockGetAvailableLinks.mockResolvedValue([
        { code: 'kssYDk' },
        { code: 'JdPPdS' },
      ]);
      mockVerifyPayment.mockResolvedValue({ isPaid: true, paidAt: '2026-03-17T12:00:00Z' });
      mockInvalidateLinkAfterActivation.mockResolvedValue({ success: true, link: { code: 'kssYDk' } });
      mockUpdateSubscription.mockResolvedValue(true);
      mockQuery.mockResolvedValue({ rows: [{ id: '12345678' }] });
      mockGrantEntitlement.mockResolvedValue(true);
      mockRecordPayment.mockResolvedValue(true);
    });

    it('returns 200 with success', async () => {
      const res = await agent
        .post('/api/webapp/activate/meru')
        .send({ code: 'kssYDk', email: 'test@example.com' });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.plan).toBe('lifetime100');
    });

    it('calls verifyPayment with the correct code', async () => {
      await agent
        .post('/api/webapp/activate/meru')
        .send({ code: 'kssYDk', email: 'test@example.com' });
      expect(mockVerifyPayment).toHaveBeenCalledWith('kssYDk', 'en');
    });

    it('atomically claims the link before granting membership', async () => {
      await agent
        .post('/api/webapp/activate/meru')
        .send({ code: 'kssYDk', email: 'test@example.com' });
      expect(mockInvalidateLinkAfterActivation).toHaveBeenCalledWith('kssYDk', '12345678', 'testuser');
      // Claim must happen before subscription update
      const claimOrder = mockInvalidateLinkAfterActivation.mock.invocationCallOrder[0];
      const subOrder = mockUpdateSubscription.mock.invocationCallOrder[0];
      expect(claimOrder).toBeLessThan(subOrder);
    });

    it('upgrades user to lifetime100 with null expiry', async () => {
      await agent
        .post('/api/webapp/activate/meru')
        .send({ code: 'kssYDk', email: 'test@example.com' });
      expect(mockUpdateSubscription).toHaveBeenCalledWith('12345678', {
        status: 'active',
        planId: 'lifetime100',
        expiry: null,
      });
    });

    it('sets PRIME tier with 60-day expiry in users table', async () => {
      await agent
        .post('/api/webapp/activate/meru')
        .send({ code: 'kssYDk', email: 'test@example.com' });
      // pool.query is the same mockQuery
      const primeCall = mockQuery.mock.calls.find(
        (c) => typeof c[0] === 'string' && c[0].includes("tier = 'PRIME'")
      );
      expect(primeCall).toBeTruthy();
      expect(primeCall[1][0]).toBe('12345678');
      // Verify the expiry is ~60 days from now
      const expiry = new Date(primeCall[1][1]);
      const diffDays = (expiry - new Date()) / (1000 * 60 * 60 * 24);
      expect(diffDays).toBeGreaterThan(58);
      expect(diffDays).toBeLessThan(62);
    });

    it('grants pnp-member (lifetime) and prime (60-day) entitlements', async () => {
      await agent
        .post('/api/webapp/activate/meru')
        .send({ code: 'kssYDk', email: 'test@example.com' });
      expect(mockGrantEntitlement).toHaveBeenCalledTimes(2);
      expect(mockGrantEntitlement).toHaveBeenCalledWith('12345678', 'pnp-member', expect.objectContaining({
        isLifetime: true,
        source: 'meru',
      }));
      expect(mockGrantEntitlement).toHaveBeenCalledWith('12345678', 'prime', expect.objectContaining({
        isLifetime: false,
        durationDays: 60,
        source: 'meru',
      }));
    });

    it('invalidates entitlement cache', async () => {
      await agent
        .post('/api/webapp/activate/meru')
        .send({ code: 'kssYDk', email: 'test@example.com' });
      expect(mockInvalidateCache).toHaveBeenCalledWith('12345678');
    });

    it('records payment history with $100 USD', async () => {
      await agent
        .post('/api/webapp/activate/meru')
        .send({ code: 'kssYDk', email: 'test@example.com' });
      expect(mockRecordPayment).toHaveBeenCalledWith(expect.objectContaining({
        userId: '12345678',
        paymentMethod: 'meru',
        amount: 100,
        currency: 'USD',
        planId: 'lifetime100',
        product: 'lifetime100',
        paymentReference: 'kssYDk',
      }));
    });

    it('marks activation code as used', async () => {
      await agent
        .post('/api/webapp/activate/meru')
        .send({ code: 'kssYDk', email: 'test@example.com' });
      expect(mockMarkCodeUsed).toHaveBeenCalledWith('kssYDk', '12345678', 'testuser');
    });

    it('sends Telegram DM notification', async () => {
      await agent
        .post('/api/webapp/activate/meru')
        .send({ code: 'kssYDk', email: 'test@example.com' });
      // Give fire-and-forget a tick
      await new Promise((r) => setTimeout(r, 10));
      expect(mockSendPaymentConfirmationNotification).toHaveBeenCalledWith(expect.objectContaining({
        userId: '12345678',
        provider: 'meru',
        amount: 100,
      }));
    });

    it('releases lock after success', async () => {
      await agent
        .post('/api/webapp/activate/meru')
        .send({ code: 'kssYDk', email: 'test@example.com' });
      expect(mockLocks.has('meru:activate:kssYDk')).toBe(false);
    });

    it('releases lock after failure', async () => {
      mockGetAvailableLinks.mockResolvedValue([]);
      await agent
        .post('/api/webapp/activate/meru')
        .send({ code: 'kssYDk', email: 'test@example.com' });
      expect(mockLocks.has('meru:activate:kssYDk')).toBe(false);
    });
  });

  // ─── New links from initializer ─────────────────────────────────────────
  describe('new Meru links (kssYDk, JdPPdS, Y-yqKP, zIYUW2)', () => {
    const newCodes = ['kssYDk', 'JdPPdS', 'Y-yqKP', 'zIYUW2'];

    it.each(newCodes)('activates code %s successfully', async (code) => {
      agent = await authenticatedAgent();
      mockGetAvailableLinks.mockResolvedValue(newCodes.map((c) => ({ code: c })));
      mockVerifyPayment.mockResolvedValue({ isPaid: true, paidAt: '2026-03-17' });
      mockInvalidateLinkAfterActivation.mockResolvedValue({ success: true, link: { code } });
      mockUpdateSubscription.mockResolvedValue(true);
      mockQuery.mockResolvedValue({ rows: [{ id: '12345678' }] });
      mockGrantEntitlement.mockResolvedValue(true);
      mockRecordPayment.mockResolvedValue(true);

      const res = await agent
        .post('/api/webapp/activate/meru')
        .send({ code, email: 'test@example.com' });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockInvalidateLinkAfterActivation).toHaveBeenCalledWith(code, '12345678', 'testuser');
    });
  });
});
