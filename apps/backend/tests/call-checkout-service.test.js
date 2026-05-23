'use strict';

/**
 * Tests for callCheckoutService.js
 *
 * Covers:
 *  1. createCallCheckout — ePayco slot-lock uses a proper DB transaction (BUG FIX)
 *  2. createCallCheckout — priceUsd (not priceCents) passed to lock helper (BUG FIX)
 *  3. createCallCheckoutDash — redirectUrl uses /booking/:id/confirm (BUG FIX)
 *  4. onCallPaymentSuccess — idempotency: duplicate webhook is skipped
 *  5. onCallPaymentSuccess — first call grants credits + booking + earnings
 *  6. onCallPaymentSuccess — returns early when payment not found / wrong type
 *  7. createCallCheckout — slot-lock failure marks payment failed + re-throws
 */

// ─── Mock: pg client + pool ───────────────────────────────────────────────────

const mockClientQuery = jest.fn();
const mockClientRelease = jest.fn();
const mockClient = { query: mockClientQuery, release: mockClientRelease };
const mockPoolConnect = jest.fn();

const mockQuery = jest.fn();
const mockGetPool = jest.fn(() => ({ connect: mockPoolConnect }));

jest.mock('../config/postgres', () => ({
  query: mockQuery,
  getPool: mockGetPool,
}));

// ─── Mock: PaymentModel ───────────────────────────────────────────────────────

const mockPaymentCreate = jest.fn();
const mockPaymentUpdateStatus = jest.fn();

jest.mock('../models/paymentModel', () => ({
  create: mockPaymentCreate,
  updateStatus: mockPaymentUpdateStatus,
}));

// ─── Mock: callPackageService ─────────────────────────────────────────────────

jest.mock('../services/callPackageService', () => ({
  grantCallCredits: jest.fn(),
}));

// ─── Mock: notifications + email ─────────────────────────────────────────────

jest.mock('../services/notificationBotDelivery', () => ({
  sendNotificationViaTelegram: jest.fn(async () => {}),
}));

jest.mock('../services/emailservice', () => ({ transporters: {} }));

// ─── Mock: logger ─────────────────────────────────────────────────────────────

jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

// ─── Mock: paymentService (getEpaycoCopRate) ──────────────────────────────────

jest.mock('../services/paymentService', () => ({}));

// ─── Mock: Stripe config + stripeService ──────────────────────────────────────

const mockStripeSessionCreate = jest.fn();
const mockStripeClient = { checkout: { sessions: { create: mockStripeSessionCreate } } };

jest.mock('../config/stripe', () => ({
  assertStripeSecretKeyConfigured: jest.fn(() => 'sk_test_mock'),
  createStripeClient: jest.fn(() => mockStripeClient),
  getStripeSecretKey: jest.fn(() => 'sk_test_mock'),
  getStripeWebhookSecret: jest.fn(() => 'whsec_test'),
  isRestrictedStripeKey: jest.fn(() => false),
  getRestrictedKeyRequiredScopes: jest.fn(() => []),
  STRIPE_API_VERSION: '2024-04-10',
}));

const mockGetOrCreateCustomer = jest.fn();

jest.mock('../services/stripeService', () => ({
  getOrCreateCustomer: (...args) => mockGetOrCreateCustomer(...args),
}));

// ─── Mock: monetizationConfig ─────────────────────────────────────────────────

jest.mock('../config/monetizationConfig', () => ({
  CREATOR_REVENUE_RATE: 0.7,
  PLATFORM_COMMISSION_RATE: 0.3,
  EARNINGS_HOLD_HOURS: 24,
}));

// ─── Mock: btcpay (lazy require inside getBtcpay()) ───────────────────────────

const mockCreateInvoice = jest.fn();

jest.mock('../config/btcpay', () => ({
  createInvoice: mockCreateInvoice,
}));

// ─── Mock: callNotificationService (lazy require) ─────────────────────────────

jest.mock('../services/callNotificationService', () => ({
  scheduleCallReminders: jest.fn(),
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const PACKAGE = {
  id: 7,
  sku: 'call-30min',
  creator_id: 'creator-uuid-123',
  duration_minutes: 30,
  price_usd: '60.00',
  quantity: 1,
  is_active: true,
};

const PAYMENT = {
  id: 'payment-uuid-abc',
  user_id: 'member-uuid-xyz',
  metadata: {
    type: 'call_package',
    packageId: 7,
    creatorId: 'creator-uuid-123',
    email: 'test@example.com',
  },
  status: 'pending',
};

const SLOT_TIMES = {
  startTimeUtc: '2026-06-01T15:00:00Z',
  endTimeUtc: '2026-06-01T15:30:00Z',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Wire up the standard happy-path client queries for slot-lock + Stripe checkout. */
function setupSlotLockClientMocks({ bookingId = 99 } = {}) {
  mockPoolConnect.mockResolvedValueOnce(mockClient);
  mockClientQuery
    .mockResolvedValueOnce({})                                      // BEGIN
    .mockResolvedValueOnce({ rows: [{ id: 'perf-001' }] })          // _getPerformerId SELECT
    .mockResolvedValueOnce({ rows: [] })                             // overlap check (empty → slot free)
    .mockResolvedValueOnce({ rows: [{ id: bookingId }] })           // INSERT bookings RETURNING
    .mockResolvedValueOnce({ rowCount: 1 })                          // UPDATE payments SET metadata (bookingId)
    .mockResolvedValueOnce({});                                      // COMMIT
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('callCheckoutService', () => {
  let service;

  beforeEach(() => {
    // resetAllMocks drains mockResolvedValueOnce queues AND clears call history
    jest.resetAllMocks();

    // Re-wire constant return values that resetAllMocks wiped
    mockGetPool.mockReturnValue({ connect: mockPoolConnect });
    mockPaymentUpdateStatus.mockResolvedValue({});
    mockGetOrCreateCustomer.mockResolvedValue('cus_test_mock');
    mockStripeSessionCreate.mockResolvedValue({
      id: 'cs_test_session_123',
      url: 'https://checkout.stripe.com/pay/cs_test_session_123',
    });
    require('../config/stripe').createStripeClient.mockReturnValue(mockStripeClient);

    service = require('../services/callCheckoutService');
  });

  // ── createCallCheckout — Stripe slot-lock path ───────────────────────────────

  describe('createCallCheckout with slotTimes (Stripe)', () => {
    function setupCheckout() {
      mockQuery.mockResolvedValueOnce({ rows: [PACKAGE] });          // package lookup
      mockPaymentCreate.mockResolvedValueOnce(PAYMENT);
      setupSlotLockClientMocks();
      mockQuery.mockResolvedValueOnce({ rows: [] });                 // SELECT email FROM users
      mockQuery.mockResolvedValueOnce({ rowCount: 1 });              // UPDATE payments SET stripe_session_id
    }

    it('opens a pool client for the slot-lock transaction', async () => {
      setupCheckout();
      await service.createCallCheckout('member-uuid-xyz', 7, 'stripe', 'test@example.com', SLOT_TIMES);
      expect(mockPoolConnect).toHaveBeenCalledTimes(1);
    });

    it('issues BEGIN as the first client query', async () => {
      setupCheckout();
      await service.createCallCheckout('member-uuid-xyz', 7, 'stripe', 'test@example.com', SLOT_TIMES);
      expect(mockClientQuery.mock.calls[0][0]).toBe('BEGIN');
    });

    it('issues COMMIT as the last client query on success', async () => {
      setupCheckout();
      await service.createCallCheckout('member-uuid-xyz', 7, 'stripe', 'test@example.com', SLOT_TIMES);
      const last = mockClientQuery.mock.calls.at(-1);
      expect(last[0]).toBe('COMMIT');
    });

    it('releases the client after the transaction', async () => {
      setupCheckout();
      await service.createCallCheckout('member-uuid-xyz', 7, 'stripe', 'test@example.com', SLOT_TIMES);
      expect(mockClientRelease).toHaveBeenCalledTimes(1);
    });

    it('passes priceUsd (not priceCents) to the INSERT bookings query', async () => {
      setupCheckout();
      await service.createCallCheckout('member-uuid-xyz', 7, 'stripe', 'test@example.com', SLOT_TIMES);

      // _lockSlotAndInsertBooking does: Math.round(parseFloat(priceUsd) * 100) internally
      // price_usd = '60.00' → expected priceCents param = 6000
      const insertCall = mockClientQuery.mock.calls.find(
        (c) => typeof c[0] === 'string' && c[0].includes('INSERT INTO bookings')
      );
      expect(insertCall).toBeDefined();
      const insertParams = insertCall[1];
      expect(insertParams).toContain(6000); // priceCents = 60 * 100
    });

    it('ROLLBACKs and marks payment failed when slot is already taken', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [PACKAGE] });
      mockPaymentCreate.mockResolvedValueOnce(PAYMENT);
      mockPoolConnect.mockResolvedValueOnce(mockClient);
      mockClientQuery
        .mockResolvedValueOnce({})                                    // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 'perf-001' }] })        // _getPerformerId
        .mockResolvedValueOnce({ rows: [{ id: 50 }] })               // overlap → slot taken
        .mockResolvedValueOnce({});                                   // ROLLBACK

      await expect(
        service.createCallCheckout('member-uuid-xyz', 7, 'stripe', 'test@example.com', SLOT_TIMES)
      ).rejects.toThrow('no longer available');

      const rollbackCall = mockClientQuery.mock.calls.find((c) => c[0] === 'ROLLBACK');
      expect(rollbackCall).toBeDefined();
      expect(mockPaymentUpdateStatus).toHaveBeenCalledWith(
        PAYMENT.id,
        'failed',
        expect.objectContaining({ error_reason: expect.stringContaining('slot_lock_failed') })
      );
    });
  });

  // ── createCallCheckout — no slot selected ────────────────────────────────────

  describe('createCallCheckout without slotTimes', () => {
    it('does NOT open a pool client', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [PACKAGE] });
      mockPaymentCreate.mockResolvedValueOnce(PAYMENT);
      mockQuery.mockResolvedValueOnce({ rows: [] });       // SELECT email FROM users
      mockQuery.mockResolvedValueOnce({ rowCount: 1 });    // UPDATE payments SET stripe_session_id

      await service.createCallCheckout('member-uuid-xyz', 7, 'stripe', 'test@example.com', null);
      expect(mockPoolConnect).not.toHaveBeenCalled();
    });

    it('returns a Stripe checkoutUrl', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [PACKAGE] });
      mockPaymentCreate.mockResolvedValueOnce(PAYMENT);
      mockQuery.mockResolvedValueOnce({ rows: [] });       // SELECT email FROM users
      mockQuery.mockResolvedValueOnce({ rowCount: 1 });    // UPDATE payments SET stripe_session_id

      const result = await service.createCallCheckout(
        'member-uuid-xyz', 7, 'stripe', 'test@example.com', null
      );
      expect(result.checkoutUrl).toMatch(/checkout\.stripe\.com/);
      expect(result.paymentId).toBe(PAYMENT.id);
    });
  });

  // ── createCallCheckoutDash — redirectUrl ─────────────────────────────────────

  describe('createCallCheckoutDash', () => {
    it('uses /booking/:id/confirm in the BTCPay redirectUrl (not /bookings/)', async () => {
      const BOOKING_ID = 42;
      mockQuery.mockResolvedValueOnce({ rows: [PACKAGE] });
      mockPaymentCreate.mockResolvedValueOnce(PAYMENT);
      mockPoolConnect.mockResolvedValueOnce(mockClient);
      mockClientQuery
        .mockResolvedValueOnce({})                                      // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 'perf-001' }] })          // _getPerformerId
        .mockResolvedValueOnce({ rows: [] })                             // overlap check
        .mockResolvedValueOnce({ rows: [{ id: BOOKING_ID }] })          // INSERT bookings
        .mockResolvedValueOnce({});                                      // COMMIT

      mockCreateInvoice.mockResolvedValueOnce({
        invoiceId: 'btcpay-inv-1',
        checkoutUrl: 'https://btcpay.pnptv.app/i/btcpay-inv-1',
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      });

      // dash_subscription_orders INSERT
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await service.createCallCheckoutDash({
        userId: 'member-uuid-xyz',
        packageId: 7,
        startTimeUtc: SLOT_TIMES.startTimeUtc,
        endTimeUtc: SLOT_TIMES.endTimeUtc,
      });

      const invoiceArgs = mockCreateInvoice.mock.calls[0][0];
      expect(invoiceArgs.redirectUrl).toMatch(`/booking/${BOOKING_ID}/confirm`);
      expect(invoiceArgs.redirectUrl).not.toMatch('/bookings/');
    });
  });

  // ── onCallPaymentSuccess ──────────────────────────────────────────────────────

  describe('onCallPaymentSuccess', () => {
    it('returns early without hitting the pool when payment is not found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      await expect(service.onCallPaymentSuccess('nonexistent-id')).resolves.toBeUndefined();
      expect(mockPoolConnect).not.toHaveBeenCalled();
    });

    it('returns early without hitting the pool when payment type is not call_package', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ ...PAYMENT, metadata: { type: 'subscription' } }],
      });
      await expect(service.onCallPaymentSuccess(PAYMENT.id)).resolves.toBeUndefined();
      expect(mockPoolConnect).not.toHaveBeenCalled();
    });

    it('ROLLBACKs and returns on duplicate webhook (ON CONFLICT returns 0 rows)', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [PAYMENT] }); // load payment
      mockPoolConnect.mockResolvedValueOnce(mockClient);
      mockClientQuery
        .mockResolvedValueOnce({})                          // BEGIN
        .mockResolvedValueOnce({ rows: [PACKAGE] })         // SELECT call_packages
        .mockResolvedValueOnce({ rows: [] })                // INSERT call_credits → 0 rows = duplicate
        .mockResolvedValueOnce({});                         // ROLLBACK

      await expect(service.onCallPaymentSuccess(PAYMENT.id)).resolves.toBeUndefined();

      const rollback = mockClientQuery.mock.calls.find((c) => c[0] === 'ROLLBACK');
      expect(rollback).toBeDefined();
    });

    it('grants credits, updates payment status, and COMMITs on first webhook', async () => {
      const credit = { id: 'credit-uuid-1' };
      mockQuery.mockResolvedValueOnce({ rows: [PAYMENT] }); // load payment
      mockPoolConnect.mockResolvedValueOnce(mockClient);
      mockClientQuery
        .mockResolvedValueOnce({})                          // BEGIN
        .mockResolvedValueOnce({ rows: [PACKAGE] })         // SELECT call_packages
        .mockResolvedValueOnce({ rows: [credit] })          // INSERT call_credits (new row)
        .mockResolvedValueOnce({ rowCount: 1 })             // UPDATE payments status = 'completed'
        .mockResolvedValueOnce({});                         // COMMIT

      // fire-and-forget earnings INSERT
      mockQuery.mockResolvedValueOnce({ rowCount: 1 });

      await service.onCallPaymentSuccess(PAYMENT.id);

      const commit = mockClientQuery.mock.calls.find((c) => c[0] === 'COMMIT');
      expect(commit).toBeDefined();

      const creditsInsert = mockClientQuery.mock.calls.find(
        (c) => typeof c[0] === 'string' && c[0].includes('INSERT INTO call_credits')
      );
      expect(creditsInsert).toBeDefined();
      expect(creditsInsert[1]).toContain(PAYMENT.id);
    });
  });
});
