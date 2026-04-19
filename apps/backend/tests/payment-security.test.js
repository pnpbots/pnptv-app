'use strict';

/**
 * payment-security.test.js
 *
 * Tests for:
 *   - PaymentSecurityService — encryption, tokens, webhooks, replay prevention, PCI
 *   - FraudDetectionService  — velocity, location, device fingerprint, brute force, blacklist
 *   - PaymentRecoveryService — stuck payment processing, lock management, cleanup
 *
 * Run with: jest apps/backend/tests/payment-security.test.js
 */

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockQuery = jest.fn();
jest.mock('../config/postgres', () => ({
  query: (...args) => mockQuery(...args),
}));

const redisMem = {};
const mockRedis = {
  get: jest.fn(async (k) => redisMem[k] ?? null),
  set: jest.fn(async (k, v) => { redisMem[k] = v; return 'OK'; }),
  del: jest.fn(async (k) => { delete redisMem[k]; return 1; }),
  setex: jest.fn(async (k, _ttl, v) => { redisMem[k] = v; return 'OK'; }),
  incr: jest.fn(async (k) => {
    redisMem[k] = (parseInt(redisMem[k] || '0', 10) + 1);
    return redisMem[k];
  }),
  expire: jest.fn(async () => 1),
  acquireLock: jest.fn(async () => true),
  releaseLock: jest.fn(async () => {}),
};

// FraudDetectionService uses `require('../../config/redis')` directly (not destructured)
// so mock must export incr/get/set/setex/del/expire at top level too
jest.mock('../config/redis', () => ({
  getRedis: () => mockRedis,
  cache: mockRedis,
  // FraudDetectionService imports redis directly and calls redis.incr etc
  incr: mockRedis.incr,
  get: mockRedis.get,
  set: mockRedis.set,
  setex: mockRedis.setex,
  del: mockRedis.del,
  expire: mockRedis.expire,
}));

jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

// PaymentRecoveryService dependencies
const mockRecoverStuckPendingPayment = jest.fn();
const mockProcessDaimoWebhook = jest.fn();
jest.mock('../services/paymentService', () => ({
  recoverStuckPendingPayment: mockRecoverStuckPendingPayment,
  processDaimoWebhook: mockProcessDaimoWebhook,
}));

// (Daimo config mock removed — config/daimo.js was deleted when Daimo Pay was
//  retired. The mock was dead code: no test asserted on mockCheckDaimoStatus.)

const mockUpdateStatus = jest.fn();
jest.mock('../models/paymentModel', () => ({
  updateStatus: mockUpdateStatus,
}));

// ── Imports ──────────────────────────────────────────────────────────────────

const crypto = require('crypto');

let PaymentSecurityService;
let FraudDetectionService;
let PaymentRecoveryService;

beforeAll(() => {
  process.env.ENCRYPTION_KEY = 'test-encryption-key-32chars!!';
  process.env.JWT_SECRET = 'test-jwt-secret-for-hmac';
  PaymentSecurityService = require('../services/paymentSecurityService');
  FraudDetectionService = require('../services/fraudDetectionService');
  PaymentRecoveryService = require('../services/paymentRecoveryService');
});

beforeEach(() => {
  jest.clearAllMocks();
  // Clear redis mem
  Object.keys(redisMem).forEach(k => delete redisMem[k]);
  mockQuery.mockReset();
  mockRecoverStuckPendingPayment.mockReset();
  mockProcessDaimoWebhook.mockReset();
  mockUpdateStatus.mockReset();
});

// =============================================================================
// PaymentSecurityService
// =============================================================================

describe('PaymentSecurityService', () => {

  describe('encrypt/decrypt round-trip', () => {
    it('encrypts and decrypts data back to original', () => {
      const data = { userId: 'u1', amount: 49900, plan: 'prime' };
      const encrypted = PaymentSecurityService.encryptSensitiveData(data);
      expect(encrypted).toBeTruthy();
      expect(encrypted).toContain(':'); // iv:ciphertext format

      const decrypted = PaymentSecurityService.decryptSensitiveData(encrypted);
      expect(decrypted).toEqual(data);
    });

    it('produces different ciphertext for same input (random IV)', () => {
      const data = { test: 'same-data' };
      const enc1 = PaymentSecurityService.encryptSensitiveData(data);
      const enc2 = PaymentSecurityService.encryptSensitiveData(data);
      expect(enc1).not.toBe(enc2); // Different IVs
    });

    it('returns null when ENCRYPTION_KEY is missing', () => {
      const saved = process.env.ENCRYPTION_KEY;
      delete process.env.ENCRYPTION_KEY;
      const result = PaymentSecurityService.encryptSensitiveData({ test: 1 });
      expect(result).toBeNull();
      process.env.ENCRYPTION_KEY = saved;
    });

    it('decrypt returns null for corrupted ciphertext', () => {
      const result = PaymentSecurityService.decryptSensitiveData('not-valid-hex:garbage');
      expect(result).toBeNull();
    });

    it('decrypt returns null when ENCRYPTION_KEY is missing', () => {
      const saved = process.env.ENCRYPTION_KEY;
      delete process.env.ENCRYPTION_KEY;
      const result = PaymentSecurityService.decryptSensitiveData('abc:def');
      expect(result).toBeNull();
      process.env.ENCRYPTION_KEY = saved;
    });
  });

  describe('generateSecurePaymentToken', () => {
    it('generates a hex token and stores it in Redis', async () => {
      const token = await PaymentSecurityService.generateSecurePaymentToken('pay1', 'u1', 49900);
      expect(token).toMatch(/^[a-f0-9]{64}$/);
      expect(mockRedis.set).toHaveBeenCalledWith(
        `payment:token:${token}`,
        expect.objectContaining({ paymentId: 'pay1', userId: 'u1', amount: 49900 }),
        3600
      );
    });

    it('returns null when JWT_SECRET is missing', async () => {
      const saved = process.env.JWT_SECRET;
      delete process.env.JWT_SECRET;
      const token = await PaymentSecurityService.generateSecurePaymentToken('pay1', 'u1', 100);
      expect(token).toBeNull();
      process.env.JWT_SECRET = saved;
    });
  });

  describe('validatePaymentToken', () => {
    it('returns valid:true for a token in Redis with future expiry', async () => {
      const tokenKey = 'test-token-abc';
      redisMem[`payment:token:${tokenKey}`] = {
        paymentId: 'pay1',
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      };
      const result = await PaymentSecurityService.validatePaymentToken(tokenKey);
      expect(result.valid).toBe(true);
      expect(result.data.paymentId).toBe('pay1');
    });

    it('returns valid:false for unknown token', async () => {
      const result = await PaymentSecurityService.validatePaymentToken('nonexistent');
      expect(result.valid).toBe(false);
    });

    it('returns valid:false and deletes expired token', async () => {
      const tokenKey = 'expired-token';
      redisMem[`payment:token:${tokenKey}`] = {
        paymentId: 'pay1',
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      };
      const result = await PaymentSecurityService.validatePaymentToken(tokenKey);
      expect(result.valid).toBe(false);
      expect(mockRedis.del).toHaveBeenCalledWith(`payment:token:${tokenKey}`);
    });
  });

  describe('createPaymentRequestHash / verifyPaymentRequestHash', () => {
    const paymentData = {
      userId: 'u1', amount: 49900, currency: 'COP',
      planId: 'prime_monthly', timestamp: '2026-01-01T00:00:00Z',
    };

    it('creates a deterministic HMAC hash', () => {
      const hash = PaymentSecurityService.createPaymentRequestHash(paymentData);
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
      // Same input → same hash
      const hash2 = PaymentSecurityService.createPaymentRequestHash(paymentData);
      expect(hash).toBe(hash2);
    });

    it('verifies a valid hash returns true', () => {
      const hash = PaymentSecurityService.createPaymentRequestHash(paymentData);
      expect(PaymentSecurityService.verifyPaymentRequestHash(paymentData, hash)).toBe(true);
    });

    it('detects tampered data', () => {
      const hash = PaymentSecurityService.createPaymentRequestHash(paymentData);
      const tampered = { ...paymentData, amount: 100 };
      expect(PaymentSecurityService.verifyPaymentRequestHash(tampered, hash)).toBe(false);
    });

    it('returns null/false when ENCRYPTION_KEY is missing', () => {
      const saved = process.env.ENCRYPTION_KEY;
      delete process.env.ENCRYPTION_KEY;
      expect(PaymentSecurityService.createPaymentRequestHash(paymentData)).toBeNull();
      expect(PaymentSecurityService.verifyPaymentRequestHash(paymentData, 'abc')).toBe(false);
      process.env.ENCRYPTION_KEY = saved;
    });
  });

  describe('validatePaymentAmount', () => {
    it('returns valid:true when amount matches', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ amount: '49900.00' }] });
      const result = await PaymentSecurityService.validatePaymentAmount('pay1', 49900);
      expect(result.valid).toBe(true);
    });

    it('allows 1-cent tolerance', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ amount: '49900.005' }] });
      const result = await PaymentSecurityService.validatePaymentAmount('pay1', 49900);
      expect(result.valid).toBe(true);
    });

    it('rejects amount mismatch beyond tolerance', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ amount: '50000' }] });
      const result = await PaymentSecurityService.validatePaymentAmount('pay1', 49900);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Amount mismatch');
    });

    it('returns valid:false when payment not found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const result = await PaymentSecurityService.validatePaymentAmount('pay1', 100);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Payment not found');
    });

    it('handles DB errors gracefully', async () => {
      mockQuery.mockRejectedValueOnce(new Error('DB down'));
      const result = await PaymentSecurityService.validatePaymentAmount('pay1', 100);
      expect(result.valid).toBe(false);
    });
  });

  describe('checkPaymentRateLimit', () => {
    it('allows first attempt', async () => {
      const result = await PaymentSecurityService.checkPaymentRateLimit('u1', 10);
      expect(result.allowed).toBe(true);
      expect(result.attempts).toBe(1);
    });

    it('blocks after exceeding max per hour', async () => {
      redisMem['payment:ratelimit:u1'] = 10; // already at max
      const result = await PaymentSecurityService.checkPaymentRateLimit('u1', 10);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Max 10');
    });

    it('fails open on Redis error', async () => {
      mockRedis.incr.mockRejectedValueOnce(new Error('Redis down'));
      const result = await PaymentSecurityService.checkPaymentRateLimit('u1');
      expect(result.allowed).toBe(true);
    });
  });

  describe('validateWebhookSignature', () => {
    it('validates a correct signature', () => {
      const payload = { event: 'payment.success', amount: 100 };
      const secret = 'webhook-secret';
      const sig = crypto.createHmac('sha256', secret)
        .update(JSON.stringify(payload)).digest('hex');
      expect(PaymentSecurityService.validateWebhookSignature(payload, sig, secret)).toBe(true);
    });

    it('rejects tampered payload', () => {
      const secret = 'webhook-secret';
      const sig = crypto.createHmac('sha256', secret)
        .update(JSON.stringify({ amount: 100 })).digest('hex');
      expect(PaymentSecurityService.validateWebhookSignature({ amount: 999 }, sig, secret)).toBe(false);
    });

    it('rejects wrong secret', () => {
      const payload = { test: 1 };
      const sig = crypto.createHmac('sha256', 'correct').update(JSON.stringify(payload)).digest('hex');
      expect(PaymentSecurityService.validateWebhookSignature(payload, sig, 'wrong')).toBe(false);
    });

    it('returns false on length mismatch (no crash)', () => {
      // timingSafeEqual throws on different lengths — should be caught
      expect(PaymentSecurityService.validateWebhookSignature('test', 'short', 'secret')).toBe(false);
    });
  });

  describe('checkReplayAttack', () => {
    it('first submission passes', async () => {
      const result = await PaymentSecurityService.checkReplayAttack('txn-1', 'epayco');
      expect(result.isReplay).toBe(false);
    });

    it('duplicate submission is flagged', async () => {
      redisMem['payment:replay:epayco:txn-1'] = 'processed';
      const result = await PaymentSecurityService.checkReplayAttack('txn-1', 'epayco');
      expect(result.isReplay).toBe(true);
    });

    it('different providers are isolated', async () => {
      redisMem['payment:replay:epayco:txn-1'] = 'processed';
      const result = await PaymentSecurityService.checkReplayAttack('txn-1', 'daimo');
      expect(result.isReplay).toBe(false);
    });
  });

  describe('validatePCICompliance', () => {
    it('passes for valid card data', () => {
      const result = PaymentSecurityService.validatePCICompliance({
        lastFour: '4242', brand: 'visa',
      });
      expect(result.compliant).toBe(true);
    });

    it('rejects full card number', () => {
      const result = PaymentSecurityService.validatePCICompliance({
        fullNumber: '4242424242424242',
      });
      expect(result.compliant).toBe(false);
      expect(result.reason).toContain('Full card number');
    });

    it('rejects CVV data', () => {
      const result = PaymentSecurityService.validatePCICompliance({
        lastFour: '4242', CVV: '123',
      });
      expect(result.compliant).toBe(false);
      expect(result.reason).toContain('CVV');
    });

    it('rejects invalid lastFour length', () => {
      const result = PaymentSecurityService.validatePCICompliance({
        lastFour: '42',
      });
      expect(result.compliant).toBe(false);
      expect(result.reason).toContain('Invalid card format');
    });
  });

  describe('setPaymentTimeout / checkPaymentTimeout', () => {
    it('sets timeout and check returns not expired', async () => {
      await PaymentSecurityService.setPaymentTimeout('pay1', 3600);
      expect(mockRedis.set).toHaveBeenCalledWith(
        'payment:timeout:pay1',
        expect.objectContaining({ paymentId: 'pay1' }),
        3600
      );
    });

    it('check returns expired:true when key is missing', async () => {
      const result = await PaymentSecurityService.checkPaymentTimeout('pay-gone');
      expect(result.expired).toBe(true);
    });

    it('check returns expired:false when key exists', async () => {
      redisMem['payment:timeout:pay1'] = { paymentId: 'pay1' };
      const result = await PaymentSecurityService.checkPaymentTimeout('pay1');
      expect(result.expired).toBe(false);
    });
  });
});

// =============================================================================
// FraudDetectionService
// =============================================================================

describe('FraudDetectionService', () => {

  describe('checkVelocityAbuse', () => {
    it('first attempt is not flagged', async () => {
      const result = await FraudDetectionService.checkVelocityAbuse('u1');
      expect(result.flagged).toBe(false);
      expect(result.attempts).toBe(1);
    });

    it('3rd attempt is not flagged (threshold is > 3)', async () => {
      redisMem['fraud:velocity:u1'] = 2; // next incr → 3
      const result = await FraudDetectionService.checkVelocityAbuse('u1');
      expect(result.flagged).toBe(false);
      expect(result.attempts).toBe(3);
    });

    it('4th attempt IS flagged', async () => {
      redisMem['fraud:velocity:u1'] = 3; // next incr → 4
      const result = await FraudDetectionService.checkVelocityAbuse('u1');
      expect(result.flagged).toBe(true);
      expect(result.reason).toBe('Velocity abuse detected');
    });

    it('sets expiry on first attempt', async () => {
      mockRedis.incr.mockResolvedValueOnce(1);
      await FraudDetectionService.checkVelocityAbuse('u1', 10);
      expect(mockRedis.expire).toHaveBeenCalledWith('fraud:velocity:u1', 600);
    });

    it('fails open on Redis error', async () => {
      mockRedis.incr.mockRejectedValueOnce(new Error('Redis down'));
      const result = await FraudDetectionService.checkVelocityAbuse('u1');
      expect(result.flagged).toBe(false);
    });
  });

  describe('checkLocationAnomaly', () => {
    const bogota = { lat: 4.711, lng: -74.0721 };
    const medellin = { lat: 6.2442, lng: -75.5812 }; // ~250km away
    const madrid = { lat: 40.4168, lng: -3.7038 };   // ~8000km away

    it('first check (no previous location) is not flagged', async () => {
      const result = await FraudDetectionService.checkLocationAnomaly('u1', bogota);
      expect(result.flagged).toBe(false);
    });

    it('stores current location in Redis', async () => {
      await FraudDetectionService.checkLocationAnomaly('u1', bogota);
      expect(mockRedis.setex).toHaveBeenCalledWith(
        'fraud:location:u1', 3600, JSON.stringify(bogota)
      );
    });

    it('normal travel distance is not flagged', async () => {
      // Bogota → Medellin: ~250km, at 5min = 3000 km/h... actually this IS impossible
      // Let's use closer cities
      redisMem['fraud:location:u1'] = JSON.stringify(bogota);
      // 250km in 5 min = 3000 km/h which IS > 900, so medellin WILL flag
      // Use a closer point instead
      const nearby = { lat: 4.72, lng: -74.08 }; // ~1km away
      const result = await FraudDetectionService.checkLocationAnomaly('u1', nearby);
      expect(result.flagged).toBe(false);
    });

    it('impossible travel IS flagged (Bogota → Madrid in 5 min)', async () => {
      redisMem['fraud:location:u1'] = JSON.stringify(bogota);
      const result = await FraudDetectionService.checkLocationAnomaly('u1', madrid);
      expect(result.flagged).toBe(true);
      expect(result.reason).toContain('Impossible travel');
    });

    it('fails open on Redis error', async () => {
      mockRedis.get.mockRejectedValueOnce(new Error('Redis down'));
      const result = await FraudDetectionService.checkLocationAnomaly('u1', bogota);
      expect(result.flagged).toBe(false);
    });
  });

  describe('calculateDistance (Haversine)', () => {
    it('returns 0 for identical coordinates', () => {
      const p = { lat: 4.711, lng: -74.072 };
      expect(FraudDetectionService.calculateDistance(p, p)).toBeCloseTo(0, 5);
    });

    it('calculates known distance approximately (Bogota → Medellin ~250km)', () => {
      const bogota = { lat: 4.711, lng: -74.0721 };
      const medellin = { lat: 6.2442, lng: -75.5812 };
      const dist = FraudDetectionService.calculateDistance(bogota, medellin);
      expect(dist).toBeGreaterThan(200);
      expect(dist).toBeLessThan(300);
    });
  });

  describe('checkBruteForce', () => {
    it('first failed attempt is not flagged', async () => {
      const result = await FraudDetectionService.checkBruteForce('u1');
      expect(result.flagged).toBe(false);
      expect(result.failedAttempts).toBe(1);
    });

    it('6th failed attempt IS flagged (max is 5)', async () => {
      redisMem['fraud:failed:u1'] = 5; // next incr → 6
      const result = await FraudDetectionService.checkBruteForce('u1');
      expect(result.flagged).toBe(true);
      expect(result.reason).toContain('Too many failed');
    });

    it('sets expiry on first attempt', async () => {
      mockRedis.incr.mockResolvedValueOnce(1);
      await FraudDetectionService.checkBruteForce('u1');
      expect(mockRedis.expire).toHaveBeenCalledWith('fraud:failed:u1', 3600);
    });
  });

  describe('checkDeviceFingerprint', () => {
    it('first visit is not flagged', async () => {
      const result = await FraudDetectionService.checkDeviceFingerprint('u1', '1.2.3.4', 'Chrome/120');
      expect(result.flagged).toBe(false);
      expect(result.newDevice).toBe(false);
    });

    it('same device is not flagged', async () => {
      const fp = crypto.createHash('sha256').update('1.2.3.4:Chrome/120').digest('hex');
      redisMem['fraud:device:u1'] = fp;
      const result = await FraudDetectionService.checkDeviceFingerprint('u1', '1.2.3.4', 'Chrome/120');
      expect(result.flagged).toBe(false);
    });

    it('new device IS flagged', async () => {
      const fp = crypto.createHash('sha256').update('1.2.3.4:Chrome/120').digest('hex');
      redisMem['fraud:device:u1'] = fp;
      const result = await FraudDetectionService.checkDeviceFingerprint('u1', '5.6.7.8', 'Firefox/130');
      expect(result.flagged).toBe(true);
      expect(result.newDevice).toBe(true);
    });
  });

  describe('checkBlacklistedCard', () => {
    it('clean card is not flagged', async () => {
      const result = await FraudDetectionService.checkBlacklistedCard('4242', 'visa');
      expect(result.flagged).toBe(false);
    });

    it('blacklisted card IS flagged', async () => {
      redisMem['fraud:blacklist:card:visa:4242'] = JSON.stringify({ reason: 'fraud' });
      const result = await FraudDetectionService.checkBlacklistedCard('4242', 'visa');
      expect(result.flagged).toBe(true);
    });
  });

  describe('blacklistCard', () => {
    it('stores card in Redis with TTL', async () => {
      await FraudDetectionService.blacklistCard('4242', 'visa', 'fraud', 30);
      expect(mockRedis.setex).toHaveBeenCalledWith(
        'fraud:blacklist:card:visa:4242',
        30 * 86400,
        expect.any(String)
      );
    });
  });

  describe('checkHighRiskCountry', () => {
    it('safe country is not flagged', async () => {
      const result = await FraudDetectionService.checkHighRiskCountry('CO');
      expect(result.flagged).toBe(false);
    });

    it('North Korea IS flagged', async () => {
      const result = await FraudDetectionService.checkHighRiskCountry('KP');
      expect(result.flagged).toBe(true);
    });

    it('Iran IS flagged', async () => {
      const result = await FraudDetectionService.checkHighRiskCountry('IR');
      expect(result.flagged).toBe(true);
    });

    it('handles lowercase input', async () => {
      const result = await FraudDetectionService.checkHighRiskCountry('kp');
      expect(result.flagged).toBe(true);
    });

    it('handles null input gracefully', async () => {
      const result = await FraudDetectionService.checkHighRiskCountry(null);
      expect(result.flagged).toBe(false);
    });
  });

  describe('resetFailedCounter', () => {
    it('deletes the Redis key', async () => {
      await FraudDetectionService.resetFailedCounter('u1');
      expect(mockRedis.del).toHaveBeenCalledWith('fraud:failed:u1');
    });
  });

  describe('checkAmountAnomaly', () => {
    it('no transaction history is not flagged', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ avg_amount: null }] });
      const result = await FraudDetectionService.checkAmountAnomaly('u1', 50000);
      expect(result.flagged).toBe(false);
    });

    it('amount within 3 standard deviations is not flagged', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ avg_amount: '50000', stddev: '5000' }],
      });
      const result = await FraudDetectionService.checkAmountAnomaly('u1', 55000);
      expect(result.flagged).toBe(false);
    });

    it('amount beyond 3 standard deviations IS flagged', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ avg_amount: '50000', stddev: '5000' }],
      });
      const result = await FraudDetectionService.checkAmountAnomaly('u1', 80000); // z=6
      expect(result.flagged).toBe(true);
      expect(result.reason).toBe('Unusual transaction amount');
    });

    it('handles DB error gracefully', async () => {
      mockQuery.mockRejectedValueOnce(new Error('DB down'));
      const result = await FraudDetectionService.checkAmountAnomaly('u1', 100);
      expect(result.flagged).toBe(false);
    });
  });
});

// =============================================================================
// PaymentRecoveryService
// =============================================================================

describe('PaymentRecoveryService', () => {

  describe('processStuckPayments', () => {
    it('acquires lock before processing', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      await PaymentRecoveryService.processStuckPayments();
      expect(mockRedis.acquireLock).toHaveBeenCalledWith('payment:recovery:lock', 1800);
    });

    it('skips if lock already held', async () => {
      mockRedis.acquireLock.mockResolvedValueOnce(false);
      const results = await PaymentRecoveryService.processStuckPayments();
      expect(results.checked).toBe(0);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('releases lock after processing', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      await PaymentRecoveryService.processStuckPayments();
      expect(mockRedis.releaseLock).toHaveBeenCalledWith('payment:recovery:lock');
    });

    it('processes stuck payments and counts recovered', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { id: 'pay1', epayco_ref: 'ref1', user_id: 'u1', plan_id: 'prime', created_at: new Date() },
        ],
      });
      mockRecoverStuckPendingPayment.mockResolvedValueOnce({
        success: true, recovered: true, webhookReplayed: true,
      });

      const results = await PaymentRecoveryService.processStuckPayments();
      expect(results.checked).toBe(1);
      expect(results.recovered).toBe(1);
    });

    it('counts stillPending when ePayco says Pendiente', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'pay1', epayco_ref: 'ref1', user_id: 'u1', created_at: new Date() }],
      });
      mockRecoverStuckPendingPayment.mockResolvedValueOnce({
        success: true, recovered: false, currentStatus: 'Pendiente',
      });

      const results = await PaymentRecoveryService.processStuckPayments();
      expect(results.stillPending).toBe(1);
    });

    it('counts failed when recovery fails', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'pay1', epayco_ref: 'ref1', user_id: 'u1', created_at: new Date() }],
      });
      mockRecoverStuckPendingPayment.mockResolvedValueOnce({
        success: false, error: 'Not found at ePayco',
      });

      const results = await PaymentRecoveryService.processStuckPayments();
      expect(results.failed).toBe(1);
    });

    it('isolates errors per payment — one failure does not stop others', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { id: 'pay1', epayco_ref: 'ref1', user_id: 'u1', created_at: new Date() },
          { id: 'pay2', epayco_ref: 'ref2', user_id: 'u2', created_at: new Date() },
        ],
      });
      mockRecoverStuckPendingPayment
        .mockRejectedValueOnce(new Error('crash'))
        .mockResolvedValueOnce({ success: true, recovered: true, webhookReplayed: true });

      const results = await PaymentRecoveryService.processStuckPayments();
      expect(results.errors).toBe(1);
      expect(results.recovered).toBe(1);
    });
  });

  describe('cleanupAbandonedPayments', () => {
    it('marks old pending payments as abandoned', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 3, rows: [
        { id: 'p1', user_id: 'u1', reference: 'r1' },
        { id: 'p2', user_id: 'u2', reference: 'r2' },
        { id: 'p3', user_id: 'u3', reference: 'r3' },
      ]});
      const results = await PaymentRecoveryService.cleanupAbandonedPayments();
      expect(results.cleaned).toBe(3);
    });

    it('handles zero abandoned payments', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });
      const results = await PaymentRecoveryService.cleanupAbandonedPayments();
      expect(results.cleaned).toBe(0);
    });

    it('handles DB error gracefully', async () => {
      mockQuery.mockRejectedValueOnce(new Error('DB down'));
      const results = await PaymentRecoveryService.cleanupAbandonedPayments();
      expect(results.errors).toBe(1);
    });
  });

  describe('getStats', () => {
    it('returns parsed statistics', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{
          total_pending: '5',
          stuck_payments: '2',
          abandoned_payments: '1',
          oldest_pending: '2026-01-01T00:00:00Z',
          newest_pending: '2026-03-09T00:00:00Z',
        }],
      });
      const stats = await PaymentRecoveryService.getStats();
      expect(stats.totalPending).toBe(5);
      expect(stats.stuckPayments).toBe(2);
      expect(stats.abandonedPayments).toBe(1);
      expect(stats.timestamp).toBeInstanceOf(Date);
    });

    it('returns null on DB error', async () => {
      mockQuery.mockRejectedValueOnce(new Error('DB down'));
      const stats = await PaymentRecoveryService.getStats();
      expect(stats).toBeNull();
    });
  });
});
