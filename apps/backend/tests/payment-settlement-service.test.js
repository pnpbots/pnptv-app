'use strict';

/**
 * payment-settlement-service.test.js
 *
 * Unit tests for PaymentSettlementService methods directly (no HTTP layer).
 * All external collaborators are mocked; tests exercise only the service logic.
 *
 * Run with: cd apps/backend && npx jest tests/payment-settlement-service.test.js
 */

// ── Environment ───────────────────────────────────────────────────────────────
process.env.SESSION_SECRET = 'test-session-secret-padding-padding-padding';
process.env.BTCPAY_WEBHOOK_SECRET = 'test-webhook-secret';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockMarkInvoiceProcessed = jest.fn().mockResolvedValue(undefined);
jest.mock('../config/btcpay', () => ({
  markInvoiceProcessed: (...args) => mockMarkInvoiceProcessed(...args),
  checkInvoiceProcessed: jest.fn().mockResolvedValue(false),
  validateWebhookSignature: jest.fn().mockReturnValue(true),
  getInvoice: jest.fn(),
}));

const mockQuery = jest.fn();
jest.mock('../config/postgres', () => ({
  query: (...args) => mockQuery(...args),
}));

const redisMem = {};
const mockRedis = {
  get: jest.fn(async (k) => redisMem[k] ?? null),
  set: jest.fn(async (k, v) => { redisMem[k] = v; return 'OK'; }),
  del: jest.fn(async (k) => { delete redisMem[k]; return 1; }),
  setex: jest.fn(async () => 'OK'),
  acquireLock: jest.fn(async () => true),
  releaseLock: jest.fn(async () => {}),
};
jest.mock('../config/redis', () => ({
  cache: mockRedis,
  getRedis: () => mockRedis,
}));

jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const mockGrantEntitlements = jest.fn();
jest.mock('../services/paymentService', () => ({
  grantEntitlementsForPlan: (...args) => mockGrantEntitlements(...args),
}));

const mockCreatorSubscribe = jest.fn();
jest.mock('../services/creatorService', () => ({
  subscribeToCreator: (...args) => mockCreatorSubscribe(...args),
}));

const mockHandleTicketSettlement = jest.fn();
jest.mock('../bot/api/controllers/webappLiveController', () => ({
  handleTicketSettlement: (...args) => mockHandleTicketSettlement(...args),
}));

const mockHandlePaymentComplete = jest.fn();
jest.mock('../services/privateCallBookingService', () => ({
  handlePaymentComplete: (...args) => mockHandlePaymentComplete(...args),
}));

const mockOnCallPaymentSuccess = jest.fn();
jest.mock('../services/callCheckoutService', () => ({
  onCallPaymentSuccess: (...args) => mockOnCallPaymentSuccess(...args),
}));

// Notification mocks (fire-and-forget paths)
jest.mock('../services/paymentNotificationService', () => ({
  sendPaymentConfirmation: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../services/invoiceservice', () => ({
  generateInvoice: jest.fn().mockResolvedValue({ buffer: Buffer.from('pdf') }),
  generateOnboardingGuide: jest.fn().mockResolvedValue({ buffer: Buffer.from('guide') }),
}));
jest.mock('../services/emailservice', () => ({
  sendInvoiceEmail: jest.fn().mockResolvedValue(undefined),
  sendWelcomeEmail: jest.fn().mockResolvedValue(undefined),
}));

// ── Imports ───────────────────────────────────────────────────────────────────

let PaymentSettlementService;

beforeAll(() => {
  PaymentSettlementService = require('../services/paymentSettlementService');
});

beforeEach(() => {
  jest.clearAllMocks();
  Object.keys(redisMem).forEach(k => delete redisMem[k]);
  mockQuery.mockReset();
  mockGrantEntitlements.mockReset();
  mockCreatorSubscribe.mockReset();
  mockMarkInvoiceProcessed.mockReset().mockResolvedValue(undefined);
  mockHandleTicketSettlement.mockReset();
  mockHandlePaymentComplete.mockReset();
  mockOnCallPaymentSuccess.mockReset();
});

// Convenience: build a minimal order row
function makeOrder(overrides = {}) {
  return {
    id: 'order-1',
    user_id: 'user-abc',
    plan_id: 'prime_monthly',
    status: 'pending',
    creator_id: null,
    metadata: null,
    usd_amount: '9.99',
    amount: '9.99',
    ...overrides,
  };
}

function makePlan(overrides = {}) {
  return {
    id: 'prime_monthly',
    name: 'PRIME Monthly',
    display_name: 'PRIME Monthly',
    tier: 'PRIME',
    duration_days: 30,
    ...overrides,
  };
}

// ── settleSubscription ────────────────────────────────────────────────────────

describe('settleSubscription', () => {
  test('happy path: grants entitlements, updates users.tier, marks processed', async () => {
    const order = makeOrder();
    const plan = makePlan();

    // Atomic status flip returns 1 row
    mockQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'order-1' }] })  // UPDATE … RETURNING id
      .mockResolvedValueOnce({ rowCount: 1 })                              // UPDATE users SET tier
      .mockResolvedValueOnce({ rows: [{ email: 'u@test.com', language: 'es', telegram: '12345' }] }); // SELECT email

    mockGrantEntitlements.mockResolvedValue({ granted: 1, errors: [] });

    const result = await PaymentSettlementService.settleSubscription(
      order, 'inv-001', plan, mockQuery, { cache: mockRedis }
    );

    expect(result.ok).toBe(true);
    expect(result.type).toBe('subscription');
    expect(result.planId).toBe('prime_monthly');
    expect(mockGrantEntitlements).toHaveBeenCalledWith(
      order.user_id, order.plan_id, 'btcpay', null, 'inv-001'
    );
    expect(mockMarkInvoiceProcessed).toHaveBeenCalledWith(
      'inv-001',
      expect.objectContaining({ userId: order.user_id, planId: order.plan_id, source: 'subscription' })
    );
  });

  test('idempotency: returns alreadyProcessed when order is not in pending state', async () => {
    const order = makeOrder();
    const plan = makePlan();

    // Atomic flip returns 0 rows → already processed
    mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });

    const result = await PaymentSettlementService.settleSubscription(order, 'inv-dup', plan, mockQuery, {});

    expect(result.alreadyProcessed).toBe(true);
    expect(mockGrantEntitlements).not.toHaveBeenCalled();
    expect(mockMarkInvoiceProcessed).not.toHaveBeenCalled();
  });

  test('grant failure rolls back order to pending and returns error', async () => {
    const order = makeOrder();
    const plan = makePlan();

    // Atomic flip succeeds
    mockQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'order-1' }] })
      // Rollback UPDATE
      .mockResolvedValueOnce({ rowCount: 1 });

    mockGrantEntitlements.mockRejectedValue(new Error('pg connection refused'));

    const result = await PaymentSettlementService.settleSubscription(order, 'inv-fail', plan, mockQuery, {});

    expect(result.error).toBe('entitlement_grant_failed');
    expect(result.ok).toBeUndefined();
    // Verify rollback was issued
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("SET status = 'pending'"),
      expect.arrayContaining(['order-1'])
    );
    expect(mockMarkInvoiceProcessed).not.toHaveBeenCalled();
  });

  test('grant returning zero throws and rolls back', async () => {
    const order = makeOrder();
    const plan = makePlan();

    mockQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'order-1' }] })
      .mockResolvedValueOnce({ rowCount: 1 });

    mockGrantEntitlements.mockResolvedValue({ granted: 0, errors: [] });

    const result = await PaymentSettlementService.settleSubscription(order, 'inv-zero', plan, mockQuery, {});

    expect(result.error).toBe('entitlement_grant_failed');
    expect(mockMarkInvoiceProcessed).not.toHaveBeenCalled();
  });

  test('threads source_payment_id (invoiceId) into grantEntitlementsForPlan', async () => {
    const order = makeOrder();
    const plan = makePlan();

    mockQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'order-1' }] })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rows: [] }); // user select (no email)

    mockGrantEntitlements.mockResolvedValue({ granted: 2, errors: [] });

    await PaymentSettlementService.settleSubscription(order, 'inv-thread', plan, mockQuery, {});

    const grantCall = mockGrantEntitlements.mock.calls[0];
    // 5th argument is source_payment_id (invoiceId)
    expect(grantCall[4]).toBe('inv-thread');
  });
});

// ── settleScopedPurchase ──────────────────────────────────────────────────────

describe('settleScopedPurchase', () => {
  test('hangout scope: calls grantEntitlementsForPlan with full metadata', async () => {
    const order = makeOrder({ plan_id: 'hangout_access' });
    const meta = { hangoutGroupId: 'grp-99' };

    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'order-1' }] });
    mockGrantEntitlements.mockResolvedValue({ granted: 1, errors: [] });

    const result = await PaymentSettlementService.settleScopedPurchase(order, 'inv-scope', meta, mockQuery);

    expect(result.ok).toBe(true);
    expect(result.type).toBe('scoped_purchase');
    expect(mockGrantEntitlements).toHaveBeenCalledWith(
      order.user_id, 'hangout_access', 'dash', meta, 'inv-scope'
    );
    expect(mockMarkInvoiceProcessed).toHaveBeenCalledWith(
      'inv-scope',
      expect.objectContaining({ source: 'scoped_purchase', scope: 'hangout:grp-99' })
    );
  });

  test('channel scope: resolves scope string correctly', async () => {
    const order = makeOrder({ plan_id: 'channel_access' });
    const meta = { channelId: 'ch-42' };

    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'order-1' }] });
    mockGrantEntitlements.mockResolvedValue({ granted: 1, errors: [] });

    const result = await PaymentSettlementService.settleScopedPurchase(order, 'inv-ch', meta, mockQuery);

    expect(result.ok).toBe(true);
    expect(mockMarkInvoiceProcessed).toHaveBeenCalledWith(
      'inv-ch',
      expect.objectContaining({ scope: 'channel:ch-42' })
    );
  });

  test('idempotency: returns alreadyProcessed when status flip returns 0 rows', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });

    const result = await PaymentSettlementService.settleScopedPurchase(
      makeOrder(), 'inv-dup', { hangoutGroupId: 'g1' }, mockQuery
    );

    expect(result.alreadyProcessed).toBe(true);
    expect(mockGrantEntitlements).not.toHaveBeenCalled();
  });

  test('grant failure: updates notes, returns error', async () => {
    const order = makeOrder();
    mockQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'order-1' }] })
      .mockResolvedValueOnce({ rowCount: 1 }); // notes update

    mockGrantEntitlements.mockRejectedValue(new Error('timeout'));

    const result = await PaymentSettlementService.settleScopedPurchase(
      order, 'inv-fail', { hangoutGroupId: 'g1' }, mockQuery
    );

    expect(result.error).toBe('scoped_grant_failed');
    expect(mockMarkInvoiceProcessed).not.toHaveBeenCalled();
  });
});

// ── settleLiveShowTicket ──────────────────────────────────────────────────────

describe('settleLiveShowTicket', () => {
  test('happy path: calls handleTicketSettlement, marks processed', async () => {
    const order = makeOrder({ usd_amount: '5.00' });
    const meta = { slotId: 'slot-77' };

    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'order-1' }] });
    mockHandleTicketSettlement.mockResolvedValue(undefined);

    const result = await PaymentSettlementService.settleLiveShowTicket(order, 'inv-ticket', meta, mockQuery);

    expect(result.ok).toBe(true);
    expect(result.slotId).toBe('slot-77');
    expect(mockHandleTicketSettlement).toHaveBeenCalledWith(order.user_id, 'slot-77', 'dash', 5);
    expect(mockMarkInvoiceProcessed).toHaveBeenCalledWith(
      'inv-ticket',
      expect.objectContaining({ source: 'live_show_ticket', slotId: 'slot-77' })
    );
  });

  test('idempotency', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const result = await PaymentSettlementService.settleLiveShowTicket(
      makeOrder(), 'inv-dup', { slotId: 's1' }, mockQuery
    );
    expect(result.alreadyProcessed).toBe(true);
    expect(mockHandleTicketSettlement).not.toHaveBeenCalled();
  });

  test('settlement failure: returns error, does NOT mark processed', async () => {
    mockQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'order-1' }] })
      .mockResolvedValueOnce({ rowCount: 1 }); // notes

    mockHandleTicketSettlement.mockRejectedValue(new Error('slot not found'));

    const result = await PaymentSettlementService.settleLiveShowTicket(
      makeOrder(), 'inv-fail', { slotId: 's-gone' }, mockQuery
    );

    expect(result.error).toBe('ticket_settlement_failed');
    expect(mockMarkInvoiceProcessed).not.toHaveBeenCalled();
  });
});

// ── settlePrivateCallBooking ──────────────────────────────────────────────────

describe('settlePrivateCallBooking', () => {
  test('happy path', async () => {
    const order = makeOrder();
    const meta = { paymentId: 'pay-33', bookingId: 'book-1' };

    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'order-1' }] });
    mockHandlePaymentComplete.mockResolvedValue({ success: true });

    const result = await PaymentSettlementService.settlePrivateCallBooking(order, 'inv-call', meta, mockQuery);

    expect(result.ok).toBe(true);
    expect(result.paymentId).toBe('pay-33');
    expect(mockMarkInvoiceProcessed).toHaveBeenCalledWith(
      'inv-call',
      expect.objectContaining({ source: 'private_call_booking' })
    );
  });

  test('idempotency', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const result = await PaymentSettlementService.settlePrivateCallBooking(
      makeOrder(), 'inv-dup', { paymentId: 'p1' }, mockQuery
    );
    expect(result.alreadyProcessed).toBe(true);
  });

  test('service returns failure: returns error without marking processed', async () => {
    mockQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'order-1' }] })
      .mockResolvedValueOnce({ rowCount: 1 }); // notes

    mockHandlePaymentComplete.mockResolvedValue({ success: false, error: 'booking_not_found' });

    const result = await PaymentSettlementService.settlePrivateCallBooking(
      makeOrder(), 'inv-nope', { paymentId: 'p-bad' }, mockQuery
    );

    expect(result.error).toBe('booking_settlement_failed');
    expect(mockMarkInvoiceProcessed).not.toHaveBeenCalled();
  });
});

// ── settleCallPackage ─────────────────────────────────────────────────────────

describe('settleCallPackage', () => {
  test('happy path: calls onCallPaymentSuccess, marks processed', async () => {
    const order = makeOrder();
    const meta = { paymentId: 'cp-55', bookingId: 'bk-2' };

    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'order-1' }] });
    mockOnCallPaymentSuccess.mockResolvedValue(undefined);

    const result = await PaymentSettlementService.settleCallPackage(order, 'inv-cpkg', meta, mockQuery);

    expect(result.ok).toBe(true);
    expect(result.paymentId).toBe('cp-55');
    expect(mockOnCallPaymentSuccess).toHaveBeenCalledWith('cp-55');
    expect(mockMarkInvoiceProcessed).toHaveBeenCalled();
  });

  test('idempotency', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const result = await PaymentSettlementService.settleCallPackage(
      makeOrder(), 'inv-dup', { paymentId: 'p1' }, mockQuery
    );
    expect(result.alreadyProcessed).toBe(true);
  });

  test('call service throws: returns error', async () => {
    mockQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'order-1' }] })
      .mockResolvedValueOnce({ rowCount: 1 });

    mockOnCallPaymentSuccess.mockRejectedValue(new Error('livekit error'));

    const result = await PaymentSettlementService.settleCallPackage(
      makeOrder(), 'inv-err', { paymentId: 'p1' }, mockQuery
    );

    expect(result.error).toBe('call_settlement_failed');
    expect(mockMarkInvoiceProcessed).not.toHaveBeenCalled();
  });
});

// ── settleCreatorSubscription ─────────────────────────────────────────────────

describe('settleCreatorSubscription', () => {
  test('happy path: calls CreatorService.subscribeToCreator, marks processed', async () => {
    const order = makeOrder({ plan_id: 'creator_monthly', creator_id: 'cr-7' });

    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'order-1' }] });
    mockCreatorSubscribe.mockResolvedValue(undefined);

    const result = await PaymentSettlementService.settleCreatorSubscription(order, 'inv-crs', mockQuery);

    expect(result.ok).toBe(true);
    expect(result.creatorId).toBe('cr-7');
    expect(mockCreatorSubscribe).toHaveBeenCalledWith('user-abc', 'cr-7', null);
    expect(mockMarkInvoiceProcessed).toHaveBeenCalledWith(
      'inv-crs',
      expect.objectContaining({ source: 'creator_subscription' })
    );
  });

  test('idempotency', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const result = await PaymentSettlementService.settleCreatorSubscription(
      makeOrder({ plan_id: 'creator_monthly', creator_id: 'cr-9' }), 'inv-dup', mockQuery
    );
    expect(result.alreadyProcessed).toBe(true);
    expect(mockCreatorSubscribe).not.toHaveBeenCalled();
  });

  test('creator service throws: returns error, does NOT mark processed', async () => {
    const order = makeOrder({ plan_id: 'creator_monthly', creator_id: 'cr-bad' });

    mockQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'order-1' }] })
      .mockResolvedValueOnce({ rowCount: 1 }); // notes

    mockCreatorSubscribe.mockRejectedValue(new Error('creator not found'));

    const result = await PaymentSettlementService.settleCreatorSubscription(order, 'inv-err', mockQuery);

    expect(result.error).toBe('creator_subscription_failed');
    expect(mockMarkInvoiceProcessed).not.toHaveBeenCalled();
  });
});

// ── settleTokenPurchase ───────────────────────────────────────────────────────

describe('settleTokenPurchase', () => {
  const mockDashTokenService = {
    creditTokens: jest.fn(),
  };

  beforeEach(() => {
    mockDashTokenService.creditTokens.mockReset();
  });

  test('happy path: credits tokens, marks processed', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ user_id: 'u1', tokens_credited: 100, usd_amount: '9.99' }],
    });
    mockDashTokenService.creditTokens.mockResolvedValue({ newBalance: 150, alreadyProcessed: false });

    const result = await PaymentSettlementService.settleTokenPurchase(
      'inv-tok', mockDashTokenService, mockQuery, {}
    );

    expect(result.ok).toBe(true);
    expect(result.tokens).toBe(100);
    expect(result.newBalance).toBe(150);
    expect(mockMarkInvoiceProcessed).toHaveBeenCalledWith(
      'inv-tok',
      expect.objectContaining({ source: 'token_purchase' })
    );
  });

  test('no local record: returns noLocalRecord sentinel (not 404)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await PaymentSettlementService.settleTokenPurchase(
      'inv-unknown', mockDashTokenService, mockQuery, {}
    );

    expect(result.noLocalRecord).toBe(true);
    expect(result.ok).toBeUndefined();
    expect(mockDashTokenService.creditTokens).not.toHaveBeenCalled();
  });

  test('already processed by creditTokens: returns alreadyProcessed without re-marking', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ user_id: 'u1', tokens_credited: 50, usd_amount: '4.99' }],
    });
    mockDashTokenService.creditTokens.mockResolvedValue({ newBalance: 100, alreadyProcessed: true });

    const result = await PaymentSettlementService.settleTokenPurchase(
      'inv-dup', mockDashTokenService, mockQuery, {}
    );

    expect(result.alreadyProcessed).toBe(true);
    // markInvoiceProcessed should NOT be called again if already processed
    expect(mockMarkInvoiceProcessed).not.toHaveBeenCalled();
  });
});
