'use strict';

/**
 * btcpay-webhook.test.js
 *
 * Integration tests for btcpayWebhookController.handleBtcpayWebhook.
 * Tests drive the controller directly (no HTTP server); req/res are mocked.
 *
 * Run with: cd apps/backend && npx jest tests/btcpay-webhook.test.js
 */

// ── Environment ───────────────────────────────────────────────────────────────
process.env.SESSION_SECRET = 'test-session-secret-padding-padding-padding';
process.env.BTCPAY_WEBHOOK_SECRET = 'test-webhook-secret-32chars!!!';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockValidateWebhookSignature = jest.fn().mockReturnValue(true);
const mockCheckInvoiceProcessed = jest.fn().mockResolvedValue(false);
const mockMarkInvoiceProcessed = jest.fn().mockResolvedValue(undefined);
const mockGetInvoice = jest.fn();

jest.mock('../config/btcpay', () => ({
  validateWebhookSignature: (...args) => mockValidateWebhookSignature(...args),
  checkInvoiceProcessed: (...args) => mockCheckInvoiceProcessed(...args),
  markInvoiceProcessed: (...args) => mockMarkInvoiceProcessed(...args),
  getInvoice: (...args) => mockGetInvoice(...args),
  getInvoicePaymentMethods: jest.fn(async () => []),
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

// Settlement service mock — returned by individual method mocks
const mockSettleSubscription = jest.fn();
const mockSettleScopedPurchase = jest.fn();
const mockSettleCreatorSubscription = jest.fn();
const mockSettleLiveShowTicket = jest.fn();
const mockSettlePrivateCallBooking = jest.fn();
const mockSettleCallPackage = jest.fn();
const mockSettleTokenPurchase = jest.fn();

jest.mock('../services/paymentSettlementService', () => ({
  settleSubscription: (...args) => mockSettleSubscription(...args),
  settleScopedPurchase: (...args) => mockSettleScopedPurchase(...args),
  settleCreatorSubscription: (...args) => mockSettleCreatorSubscription(...args),
  settleLiveShowTicket: (...args) => mockSettleLiveShowTicket(...args),
  settlePrivateCallBooking: (...args) => mockSettlePrivateCallBooking(...args),
  settleCallPackage: (...args) => mockSettleCallPackage(...args),
  settleTokenPurchase: (...args) => mockSettleTokenPurchase(...args),
}));

const mockPlanModelGetById = jest.fn();
jest.mock('../models/planModel', () => ({
  getById: (...args) => mockPlanModelGetById(...args),
}));

const mockGrantEntitlements = jest.fn();
jest.mock('../services/paymentService', () => ({
  grantEntitlementsForPlan: (...args) => mockGrantEntitlements(...args),
}));

const mockEntitlementInvalidate = jest.fn().mockResolvedValue(undefined);
jest.mock('../services/entitlementAccessService', () => ({
  invalidateCache: (...args) => mockEntitlementInvalidate(...args),
  requireEntitlement: () => (req, res, next) => next(),
  requireResourceAccess: () => (req, res, next) => next(),
}));

jest.mock('../services/dashTokenService', () => ({
  creditTokens: jest.fn(),
  getWallet: jest.fn(),
  TOKEN_PACKAGES: [],
}));

jest.mock('../services/pnpLiveTipsService', () => ({
  confirmTipPayment: jest.fn().mockResolvedValue(undefined),
  getTipById: jest.fn().mockResolvedValue(null),
}));

jest.mock('../services/socketSingleton', () => ({
  get: jest.fn().mockReturnValue(null),
}));

jest.mock('../services/creatorPayoutService', () => ({
  settleDashPullPayment: jest.fn().mockResolvedValue({ settled: true }),
}));

// ── Controller import ─────────────────────────────────────────────────────────

let controller;

beforeAll(() => {
  controller = require('../bot/api/controllers/btcpayWebhookController');
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a mock Express req with rawBody set to the serialized event.
 */
function makeReq(event, overrides = {}) {
  const body = JSON.stringify(event);
  return {
    headers: { 'btcpay-sig': 'sha256=validsig' },
    rawBody: Buffer.from(body),
    ip: '127.0.0.1',
    ...overrides,
  };
}

/**
 * Build a mock Express res that captures the response.
 * Returns { res, getBody(), getStatus() }.
 */
function makeRes() {
  let statusCode = 200;
  let body = null;
  const res = {
    status(code) { statusCode = code; return res; },
    json(data) { body = data; return res; },
    getStatus: () => statusCode,
    getBody: () => body,
  };
  return res;
}

function settlementEvent(type = 'InvoiceSettled', invoiceId = 'inv-test-1') {
  return { type, invoiceId, metadata: {} };
}

function defaultSubOrderRows(overrides = {}) {
  return {
    rows: [{
      id: 'ord-1',
      user_id: 'u-1',
      plan_id: 'prime_monthly',
      status: 'pending',
      creator_id: null,
      metadata: null,
      usd_amount: '9.99',
      ...overrides,
    }],
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  Object.keys(redisMem).forEach(k => delete redisMem[k]);
  mockQuery.mockReset();
  mockValidateWebhookSignature.mockReturnValue(true);
  mockCheckInvoiceProcessed.mockResolvedValue(false);
  mockMarkInvoiceProcessed.mockResolvedValue(undefined);
  mockRedis.acquireLock.mockResolvedValue(true);
  mockRedis.releaseLock.mockResolvedValue(undefined);
  mockSettleSubscription.mockReset();
  mockSettleScopedPurchase.mockReset();
  mockSettleCreatorSubscription.mockReset();
  mockSettleLiveShowTicket.mockReset();
  mockSettlePrivateCallBooking.mockReset();
  mockSettleCallPackage.mockReset();
  mockSettleTokenPurchase.mockReset();
  mockPlanModelGetById.mockReset();
  mockGrantEntitlements.mockReset();
});

// =============================================================================
// 1. Signature validation
// =============================================================================

describe('signature validation', () => {
  test('returns 400 when rawBody is missing', async () => {
    const req = makeReq(settlementEvent(), { rawBody: undefined });
    const res = makeRes();

    await controller.handleBtcpayWebhook(req, res);

    expect(res.getStatus()).toBe(400);
    expect(res.getBody().error).toBe('Raw body unavailable');
  });

  test('returns 401 when signature is invalid', async () => {
    mockValidateWebhookSignature.mockReturnValue(false);
    const req = makeReq(settlementEvent());
    const res = makeRes();

    await controller.handleBtcpayWebhook(req, res);

    expect(res.getStatus()).toBe(401);
    expect(res.getBody().error).toBe('Invalid signature');
    // Settlement must not be attempted
    expect(mockSettleSubscription).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('returns 400 on invalid JSON body', async () => {
    const req = {
      headers: { 'btcpay-sig': 'sha256=x' },
      rawBody: Buffer.from('not-json'),
      ip: '127.0.0.1',
    };
    const res = makeRes();

    await controller.handleBtcpayWebhook(req, res);

    expect(res.getStatus()).toBe(400);
    expect(res.getBody().error).toBe('Invalid JSON');
  });
});

// =============================================================================
// 2. Payout events
// =============================================================================

describe('payout events', () => {
  test('PayoutCompleted: delegates to CreatorPayoutService and returns 200', async () => {
    const event = { type: 'PayoutCompleted', pullPaymentId: 'pp-1', payoutId: 'po-1', proofOfPayment: { txId: 'tx1' } };
    const req = makeReq(event);
    const res = makeRes();

    await controller.handleBtcpayWebhook(req, res);

    expect(res.getStatus()).toBe(200);
    expect(res.getBody().type).toBe('payout_completed');
  });

  test('PayoutCancelled: releases earnings back to available', async () => {
    const event = { type: 'PayoutCancelled', pullPaymentId: 'pp-2' };
    const req = makeReq(event);
    const res = makeRes();

    // UPDATE creator_payouts → returns earning_ids
    mockQuery
      .mockResolvedValueOnce({ rows: [{ earning_ids: ['e1', 'e2'], creator_id: 'cr-1' }] })
      // UPDATE creator_earnings
      .mockResolvedValueOnce({ rowCount: 2 });

    await controller.handleBtcpayWebhook(req, res);

    expect(res.getBody().type).toBe('payout_cancelled');
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  test('Other Payout* events: audit-log only, no DB mutations', async () => {
    const event = { type: 'PayoutExpired', pullPaymentId: 'pp-3' };
    const req = makeReq(event);
    const res = makeRes();

    await controller.handleBtcpayWebhook(req, res);

    expect(res.getBody().ignored).toBe(true);
    expect(res.getBody().reason).toBe('payout_lifecycle');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('PayoutCompleted with missing pullPaymentId returns 400', async () => {
    const event = { type: 'PayoutCompleted' };
    const req = makeReq(event);
    const res = makeRes();

    await controller.handleBtcpayWebhook(req, res);

    expect(res.getStatus()).toBe(400);
    expect(res.getBody().error).toBe('Missing pullPaymentId');
  });
});

// =============================================================================
// 3. Terminal failure events (InvoiceExpired / InvoiceInvalid)
// =============================================================================

describe('InvoiceExpired / InvoiceInvalid', () => {
  test('InvoiceExpired: marks rows terminal and expires linked bookings', async () => {
    const event = { type: 'InvoiceExpired', invoiceId: 'inv-exp' };
    const req = makeReq(event);
    const res = makeRes();

    // UPDATE dash_subscription_orders
    mockQuery
      .mockResolvedValueOnce({ rowCount: 1 })
      // UPDATE token_purchases
      .mockResolvedValueOnce({ rowCount: 0 })
      // SELECT metadata for booking expiry
      .mockResolvedValueOnce({ rows: [{ metadata: { resource: 'private_call_booking', paymentId: 'pay-1', bookingId: 'bk-1' } }] })
      // UPDATE booking_payments
      .mockResolvedValueOnce({ rowCount: 1 })
      // UPDATE bookings
      .mockResolvedValueOnce({ rowCount: 1 });

    await controller.handleBtcpayWebhook(req, res);

    expect(res.getBody().type).toBe('expired');
    expect(res.getBody().rowsUpdated).toBe(1);
    // booking expiry queries were issued
    expect(mockQuery.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  test('InvoiceInvalid: marks rows with invalid status', async () => {
    const event = { type: 'InvoiceInvalid', invoiceId: 'inv-bad' };
    const req = makeReq(event);
    const res = makeRes();

    mockQuery
      .mockResolvedValueOnce({ rowCount: 0 })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rows: [] }); // no booking metadata

    await controller.handleBtcpayWebhook(req, res);

    expect(res.getBody().type).toBe('invalid');
    expect(res.getBody().rowsUpdated).toBe(1);
  });
});

// =============================================================================
// 4. InvoiceMarkedInvalid (chargeback)
// =============================================================================

describe('InvoiceMarkedInvalid', () => {
  test('revokes ONLY the entitlements with source_payment_id = invoiceId', async () => {
    const event = { type: 'InvoiceMarkedInvalid', invoiceId: 'inv-chargeback' };
    const req = makeReq(event);
    const res = makeRes();

    // UPDATE dash_subscription_orders
    mockQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ user_id: 'u-1', plan_id: 'prime_monthly', old_status: 'completed' }] })
      // UPDATE token_purchases
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      // UPDATE creator_earnings (void)
      .mockResolvedValueOnce({ rowCount: 0 })
      // DELETE user_entitlements
      .mockResolvedValueOnce({ rowCount: 2 })
      // SELECT remaining entitlements
      .mockResolvedValueOnce({ rowCount: 0 })
      // UPDATE users tier downgrade
      .mockResolvedValueOnce({ rowCount: 1 });

    await controller.handleBtcpayWebhook(req, res);

    expect(res.getBody().type).toBe('marked_invalid');
    expect(res.getBody().ordersUpdated).toBe(1);

    // Verify DELETE used source_payment_id = invoiceId (not plan_id alone)
    const deletCall = mockQuery.mock.calls.find(c => c[0].includes('DELETE FROM user_entitlements'));
    expect(deletCall).toBeDefined();
    expect(deletCall[1]).toEqual(['u-1', 'inv-chargeback']);
  });

  test('preserves tier when user has remaining active entitlements', async () => {
    const event = { type: 'InvoiceMarkedInvalid', invoiceId: 'inv-renew' };
    const req = makeReq(event);
    const res = makeRes();

    mockQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ user_id: 'u-2', plan_id: 'prime_monthly', old_status: 'completed' }] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 0 })   // void earnings (0)
      .mockResolvedValueOnce({ rowCount: 1 })   // revoke (1 row)
      // SELECT remaining entitlements — 1 remaining → preserve tier
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'ent-remaining' }] });

    await controller.handleBtcpayWebhook(req, res);

    const logger = require('../utils/logger');
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('user retains active entitlements'),
      expect.any(Object)
    );
    // UPDATE users SET tier = 'free' must NOT have been called
    const downgradeCall = mockQuery.mock.calls.find(c =>
      c[0].includes("tier = 'free'") && c[0].includes('UPDATE users')
    );
    expect(downgradeCall).toBeUndefined();
  });

  test('no order found: logs no-action and returns 200', async () => {
    const event = { type: 'InvoiceMarkedInvalid', invoiceId: 'inv-none' };
    const req = makeReq(event);
    const res = makeRes();

    mockQuery
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })    // no orders
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })    // no token purchases
      .mockResolvedValueOnce({ rowCount: 0 });             // void earnings

    await controller.handleBtcpayWebhook(req, res);

    expect(res.getBody().ordersUpdated).toBe(0);
    const logger = require('../utils/logger');
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('no order or purchase found'),
      expect.any(Object)
    );
  });

  test('token wallet is debited when token_purchase was paid', async () => {
    const event = { type: 'InvoiceMarkedInvalid', invoiceId: 'inv-tokchargeback' };
    const req = makeReq(event);
    const res = makeRes();

    mockQuery
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // no sub orders
      // token_purchases update returns a paid row
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ user_id: 'u-3', tokens_credited: 100, old_status: 'paid' }] })
      // UPDATE user_token_wallets
      .mockResolvedValueOnce({ rowCount: 1 })
      // void creator earnings
      .mockResolvedValueOnce({ rowCount: 0 });

    await controller.handleBtcpayWebhook(req, res);

    const walletDebit = mockQuery.mock.calls.find(c => c[0].includes('user_token_wallets'));
    expect(walletDebit).toBeDefined();
    expect(walletDebit[1]).toEqual([100, 'u-3']);
  });
});

// =============================================================================
// 5. Replay protection
// =============================================================================

describe('replay protection', () => {
  test('returns duplicate:true when invoice already processed', async () => {
    mockCheckInvoiceProcessed.mockResolvedValue(true);

    const req = makeReq(settlementEvent());
    const res = makeRes();

    await controller.handleBtcpayWebhook(req, res);

    expect(res.getBody().duplicate).toBe(true);
    expect(mockSettleSubscription).not.toHaveBeenCalled();
  });

  test('parallel delivery: second request gets lock-blocked, returns duplicate', async () => {
    // First call gets the lock; second call does not
    mockRedis.acquireLock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    // First call needs DB rows and plan
    mockQuery.mockResolvedValue({ rows: [] }); // no order rows → falls to token purchase
    mockSettleTokenPurchase.mockResolvedValue({ noLocalRecord: true });

    const req1 = makeReq(settlementEvent('InvoiceSettled', 'inv-parallel'));
    const req2 = makeReq(settlementEvent('InvoiceSettled', 'inv-parallel'));
    const res1 = makeRes();
    const res2 = makeRes();

    await Promise.all([
      controller.handleBtcpayWebhook(req1, res1),
      controller.handleBtcpayWebhook(req2, res2),
    ]);

    // One of them gets duplicate:true
    const results = [res1.getBody(), res2.getBody()];
    expect(results.some(r => r.duplicate === true)).toBe(true);
  });
});

// =============================================================================
// 6. InvoicePaymentSettled — out-of-order guard
// =============================================================================

describe('InvoicePaymentSettled out-of-order', () => {
  test('does not grant if BTCPay reports invoice not yet Settled', async () => {
    mockGetInvoice.mockResolvedValue({ status: 'Processing' });

    const event = { type: 'InvoicePaymentSettled', invoiceId: 'inv-partial', paymentMethod: 'DASH', metadata: {} };
    const req = makeReq(event);
    const res = makeRes();

    await controller.handleBtcpayWebhook(req, res);

    expect(res.getBody().ignored).toBe(true);
    expect(res.getBody().reason).toBe('not_yet_settled');
    expect(mockSettleSubscription).not.toHaveBeenCalled();
  });

  test('proceeds when BTCPay confirms invoice is Settled', async () => {
    mockGetInvoice.mockResolvedValue({ status: 'Settled' });

    const event = { type: 'InvoicePaymentSettled', invoiceId: 'inv-settled-partial', metadata: {} };
    const req = makeReq(event);
    const res = makeRes();

    // No order rows → falls to token path
    mockQuery.mockResolvedValue({ rows: [] });
    mockSettleTokenPurchase.mockResolvedValue({ noLocalRecord: true });

    await controller.handleBtcpayWebhook(req, res);

    // Should NOT have short-circuited with not_yet_settled
    expect(res.getBody().reason).not.toBe('not_yet_settled');
  });
});

// =============================================================================
// 7. Underpayment rejection
// =============================================================================

describe('underpayment rejection', () => {
  test('returns 200 with error:underpayment when paidAmount < amount - 0.01', async () => {
    mockGetInvoice.mockResolvedValue({ amount: '10.00', paidAmount: '5.00', status: 'Settled' });

    const event = { type: 'InvoiceSettled', invoiceId: 'inv-underpaid', metadata: {} };
    const req = makeReq(event);
    const res = makeRes();

    await controller.handleBtcpayWebhook(req, res);

    expect(res.getStatus()).toBe(200);
    expect(res.getBody().error).toBe('underpayment');
    expect(mockSettleSubscription).not.toHaveBeenCalled();
  });

  test('does not reject when paidAmount >= amount - 0.01 (tolerance)', async () => {
    // Tiny rounding differences should not block
    mockGetInvoice.mockResolvedValue({ amount: '10.00', paidAmount: '9.995', status: 'Settled' });

    const event = { type: 'InvoiceSettled', invoiceId: 'inv-tolerated', metadata: {} };
    const req = makeReq(event);
    const res = makeRes();

    // Provide order rows so it reaches the settlement path
    mockQuery.mockResolvedValue({ rows: [] });
    mockSettleTokenPurchase.mockResolvedValue({ noLocalRecord: true });

    await controller.handleBtcpayWebhook(req, res);

    expect(res.getBody().error).not.toBe('underpayment');
  });
});

// =============================================================================
// 8. Subscription settle — happy path
// =============================================================================

describe('subscription settlement', () => {
  test('happy path: dispatches to settleSubscription with plan, returns success', async () => {
    const event = settlementEvent();
    const req = makeReq(event);
    const res = makeRes();

    // No underpayment check issues
    mockGetInvoice.mockResolvedValue({ amount: '9.99', paidAmount: '9.99', status: 'Settled' });

    // Subscription order row
    mockQuery.mockResolvedValue(defaultSubOrderRows());
    mockPlanModelGetById.mockResolvedValue({ id: 'prime_monthly', tier: 'PRIME', duration_days: 30, name: 'PRIME Monthly', display_name: 'PRIME' });
    mockSettleSubscription.mockResolvedValue({ type: 'subscription', ok: true, planId: 'prime_monthly' });

    await controller.handleBtcpayWebhook(req, res);

    expect(res.getBody().success).toBe(true);
    expect(res.getBody().type).toBe('subscription');
    expect(mockSettleSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ plan_id: 'prime_monthly' }),
      'inv-test-1',
      expect.any(Object), // plan
      expect.any(Function), // dbQuery
      expect.any(Object)  // opts
    );
  });

  test('grant failure causes 500 so BTCPay redelivers', async () => {
    const event = settlementEvent();
    const req = makeReq(event);
    const res = makeRes();

    mockGetInvoice.mockResolvedValue({ amount: '9.99', paidAmount: '9.99' });
    mockQuery.mockResolvedValue(defaultSubOrderRows());
    mockPlanModelGetById.mockResolvedValue({ id: 'prime_monthly', tier: 'PRIME', duration_days: 30 });
    mockSettleSubscription.mockResolvedValue({ type: 'subscription', error: 'entitlement_grant_failed' });

    await controller.handleBtcpayWebhook(req, res);

    expect(res.getStatus()).toBe(500);
    expect(res.getBody().error).toBe('entitlement_grant_failed');
  });

  test('plan_not_found: returns 200 success:false so BTCPay does not retry forever', async () => {
    const event = settlementEvent();
    const req = makeReq(event);
    const res = makeRes();

    mockGetInvoice.mockResolvedValue({ amount: '9.99', paidAmount: '9.99' });
    mockQuery.mockResolvedValue(defaultSubOrderRows());
    mockPlanModelGetById.mockResolvedValue(null); // plan not found
    // Also mock the UPDATE notes query
    mockQuery.mockResolvedValueOnce(defaultSubOrderRows())  // subResult
             .mockResolvedValueOnce({ rowCount: 1 });       // UPDATE notes

    await controller.handleBtcpayWebhook(req, res);

    expect(res.getStatus()).toBe(200);
    expect(res.getBody().error).toBe('plan_not_found');
  });
});

// =============================================================================
// 9. Scoped purchase — hangout and channel
// =============================================================================

describe('scoped purchase settlement', () => {
  test('hangout scope: dispatches to settleScopedPurchase with metadata', async () => {
    const event = settlementEvent();
    const req = makeReq(event);
    const res = makeRes();

    mockGetInvoice.mockResolvedValue({ amount: '5.00', paidAmount: '5.00' });
    mockQuery.mockResolvedValue(defaultSubOrderRows({
      plan_id: 'hangout_access',
      metadata: { hangoutGroupId: 'grp-5' },
    }));
    mockSettleScopedPurchase.mockResolvedValue({
      type: 'scoped_purchase', ok: true, grantResult: { granted: 1 },
    });

    await controller.handleBtcpayWebhook(req, res);

    expect(res.getBody().scopedPurchase).toBe(true);
    expect(mockSettleScopedPurchase).toHaveBeenCalledWith(
      expect.objectContaining({ plan_id: 'hangout_access' }),
      'inv-test-1',
      expect.objectContaining({ hangoutGroupId: 'grp-5' }),
      expect.any(Function)
    );
    expect(mockMarkInvoiceProcessed).not.toHaveBeenCalled(); // service handles marking
  });

  test('channel scope: correctly routed to settleScopedPurchase', async () => {
    const event = settlementEvent();
    const req = makeReq(event);
    const res = makeRes();

    mockGetInvoice.mockResolvedValue({ amount: '3.00', paidAmount: '3.00' });
    mockQuery.mockResolvedValue(defaultSubOrderRows({
      plan_id: 'channel_sub',
      metadata: { channelId: 'ch-99' },
    }));
    mockSettleScopedPurchase.mockResolvedValue({ type: 'scoped_purchase', ok: true, grantResult: { granted: 1 } });

    await controller.handleBtcpayWebhook(req, res);

    expect(mockSettleScopedPurchase).toHaveBeenCalledWith(
      expect.any(Object),
      'inv-test-1',
      expect.objectContaining({ channelId: 'ch-99' }),
      expect.any(Function)
    );
  });
});

// =============================================================================
// 10. Live show ticket settle
// =============================================================================

describe('live show ticket settlement', () => {
  test('dispatches to settleLiveShowTicket with slotId', async () => {
    const event = settlementEvent();
    const req = makeReq(event);
    const res = makeRes();

    mockGetInvoice.mockResolvedValue({ amount: '20.00', paidAmount: '20.00' });
    mockQuery.mockResolvedValue(defaultSubOrderRows({
      metadata: { resource: 'live_show_ticket', slotId: 'slot-42' },
    }));
    mockSettleLiveShowTicket.mockResolvedValue({ type: 'live_show_ticket', ok: true, slotId: 'slot-42' });

    await controller.handleBtcpayWebhook(req, res);

    expect(res.getBody().type).toBe('live_show_ticket');
    expect(mockSettleLiveShowTicket).toHaveBeenCalledWith(
      expect.any(Object), 'inv-test-1',
      expect.objectContaining({ slotId: 'slot-42' }),
      expect.any(Function)
    );
  });
});

// =============================================================================
// 11. Private call booking settle
// =============================================================================

describe('private call booking settlement', () => {
  test('dispatches to settlePrivateCallBooking', async () => {
    const event = settlementEvent();
    const req = makeReq(event);
    const res = makeRes();

    mockGetInvoice.mockResolvedValue({ amount: '50.00', paidAmount: '50.00' });
    mockQuery.mockResolvedValue(defaultSubOrderRows({
      metadata: { resource: 'private_call_booking', paymentId: 'pay-88', bookingId: 'bk-7' },
    }));
    mockSettlePrivateCallBooking.mockResolvedValue({ type: 'private_call_booking', ok: true, paymentId: 'pay-88' });

    await controller.handleBtcpayWebhook(req, res);

    expect(res.getBody().type).toBe('private_call_booking');
    expect(mockSettlePrivateCallBooking).toHaveBeenCalled();
  });
});

// =============================================================================
// 12. Call package settle
// =============================================================================

describe('call package settlement', () => {
  test('dispatches to settleCallPackage', async () => {
    const event = settlementEvent();
    const req = makeReq(event);
    const res = makeRes();

    mockGetInvoice.mockResolvedValue({ amount: '30.00', paidAmount: '30.00' });
    mockQuery.mockResolvedValue(defaultSubOrderRows({
      metadata: { resource: 'call_package', paymentId: 'cp-11' },
    }));
    mockSettleCallPackage.mockResolvedValue({ type: 'call_package', ok: true, paymentId: 'cp-11' });

    await controller.handleBtcpayWebhook(req, res);

    expect(res.getBody().type).toBe('call_package');
    expect(mockSettleCallPackage).toHaveBeenCalled();
  });
});

// =============================================================================
// 13. Token purchase settle
// =============================================================================

describe('token purchase settlement', () => {
  test('happy path: settleTokenPurchase called, returns success', async () => {
    const event = settlementEvent();
    const req = makeReq(event);
    const res = makeRes();

    mockGetInvoice.mockResolvedValue({ amount: '9.99', paidAmount: '9.99' });
    // No subscription order, no metadata planId
    mockQuery.mockResolvedValue({ rows: [] });
    mockSettleTokenPurchase.mockResolvedValue({
      type: 'token_purchase', ok: true, userId: 'u-5', tokens: 100, newBalance: 200, alreadyProcessed: false,
    });

    await controller.handleBtcpayWebhook(req, res);

    expect(res.getBody().success).toBe(true);
    expect(mockSettleTokenPurchase).toHaveBeenCalled();
  });

  test('no local record: returns 200 with reason:no_local_record_yet (not 404)', async () => {
    const event = settlementEvent();
    const req = makeReq(event);
    const res = makeRes();

    mockGetInvoice.mockResolvedValue({ amount: '9.99', paidAmount: '9.99' });
    mockQuery.mockResolvedValue({ rows: [] });
    mockSettleTokenPurchase.mockResolvedValue({ type: 'token_purchase', noLocalRecord: true });

    await controller.handleBtcpayWebhook(req, res);

    expect(res.getStatus()).toBe(200);
    expect(res.getBody().reason).toBe('no_local_record_yet');
    // Must not be a 404 — BTCPay should be able to retry
    expect(res.getStatus()).not.toBe(404);
  });
});

// =============================================================================
// 14. Missing invoiceId
// =============================================================================

describe('missing invoiceId', () => {
  test('returns 400 for settlement events without invoiceId', async () => {
    const event = { type: 'InvoiceSettled' }; // no invoiceId
    const req = makeReq(event);
    const res = makeRes();

    await controller.handleBtcpayWebhook(req, res);

    expect(res.getStatus()).toBe(400);
    expect(res.getBody().error).toBe('Missing invoiceId');
  });
});

// =============================================================================
// 15. Unknown event type
// =============================================================================

describe('unknown event type', () => {
  test('returns 200 ignored for unrecognized event types', async () => {
    const event = { type: 'SomeUnknownEvent', invoiceId: 'inv-1' };
    const req = makeReq(event);
    const res = makeRes();

    await controller.handleBtcpayWebhook(req, res);

    expect(res.getBody().ignored).toBe(true);
    expect(mockSettleSubscription).not.toHaveBeenCalled();
  });
});

// =============================================================================
// 16. BTCPay API unreachable on InvoicePaymentSettled
// =============================================================================

describe('InvoicePaymentSettled — BTCPay API unreachable', () => {
  test('returns 200 with reason:api_unreachable if getInvoice throws', async () => {
    mockGetInvoice.mockRejectedValue(new Error('ECONNREFUSED'));

    const event = { type: 'InvoicePaymentSettled', invoiceId: 'inv-unreach', paymentMethod: 'DASH', metadata: {} };
    const req = makeReq(event);
    const res = makeRes();

    await controller.handleBtcpayWebhook(req, res);

    expect(res.getBody().reason).toBe('api_unreachable');
    expect(res.getBody().ignored).toBe(true);
  });
});
