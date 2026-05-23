'use strict';

process.env.SESSION_SECRET = 'test-session-secret-padding-padding-padding';

const mockQuery = jest.fn();
const mockClient = {
  query: jest.fn(),
  release: jest.fn(),
};

jest.mock('../config/postgres', () => ({
  query: (...args) => mockQuery(...args),
  getClient: jest.fn(async () => mockClient),
}));

jest.mock('../config/redis', () => ({
  cache: {
    get: jest.fn(async () => null),
    set: jest.fn(async () => 'OK'),
    del: jest.fn(async () => 1),
    acquireLock: jest.fn(async () => true),
    releaseLock: jest.fn(async () => {}),
    setNX: jest.fn(async () => true),
    incr: jest.fn(async () => 1),
  },
  getRedis: jest.fn(() => ({
    get: jest.fn(async () => null),
    set: jest.fn(async () => 'OK'),
    del: jest.fn(async () => 1),
    scan: jest.fn(async () => ['0', []]),
  })),
}));

jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../models/paymentModel', () => ({
  getById: jest.fn(),
  updateStatus: jest.fn(),
}));
jest.mock('../services/invoiceservice', () => ({}));
jest.mock('../services/emailservice', () => ({}));
jest.mock('../models/planModel', () => ({
  getById: jest.fn(),
}));
jest.mock('../models/userModel', () => ({
  getById: jest.fn(),
  updateSubscription: jest.fn(),
}));
jest.mock('../models/bookingModel', () => ({}));
jest.mock('../services/promoService', () => ({}));
jest.mock('../models/subscriberModel', () => ({
  create: jest.fn(),
}));
jest.mock('../services/modelService', () => ({}));
jest.mock('../services/pnpLiveService', () => ({}));
jest.mock('telegraf', () => ({
  Telegraf: jest.fn(() => ({ telegram: { sendMessage: jest.fn() } })),
}));
jest.mock('../services/messageTemplates', () => ({}));
jest.mock('../utils/sanitizer', () => ({
  telegramMarkdown: (v) => v,
}));
jest.mock('../services/businessNotificationService', () => ({}));
jest.mock('../services/paymentNotificationService', () => ({}));
jest.mock('../services/notificationEmitter', () => ({
  emit: jest.fn(),
}));
jest.mock('../services/paymentSecurityService', () => ({}));
jest.mock('../config/epaycoSubscriptionPlans', () => ({
  isSubscriptionPlan: jest.fn(() => false),
  getEpaycoSubscriptionUrl: jest.fn(),
}));
jest.mock('../services/paymentHistoryService', () => ({}));
jest.mock('../models/paymentWebhookEventModel', () => ({
  logEvent: jest.fn(),
}));
jest.mock('axios', () => ({}));

const mockHasEntitlement = jest.fn();
const mockInvalidateCache = jest.fn();
const mockRecomputeUserTier = jest.fn();
jest.mock('../services/entitlementAccessService', () => ({
  hasEntitlement: (...args) => mockHasEntitlement(...args),
  invalidateCache: (...args) => mockInvalidateCache(...args),
  recomputeUserTier: (...args) => mockRecomputeUserTier(...args),
}));

let PaymentService;

beforeAll(() => {
  PaymentService = require('../services/paymentService');
});

beforeEach(() => {
  jest.clearAllMocks();
  mockClient.query.mockReset();
  mockClient.release.mockReset();
});

describe('Stripe migration fixes', () => {
  test('upsertStripeRenewalPayment updates an existing Stripe renewal row without relying on a unique reference constraint', async () => {
    // 1st query: invoice_id check — miss (tests the fallback reference path)
    // 2nd query: reference check — hit (existing row found)
    // 3rd query: UPDATE to complete the row
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'pay_existing_1' }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });

    const paymentId = await PaymentService.upsertStripeRenewalPayment({
      userId: 'user-9',
      planId: 'creator_monthly',
      stripeSubscriptionId: 'sub_existing_1',
      invoiceId: 'in_existing_1',
      paymentIntentId: 'pi_existing_1',
      amountTotal: 29,
      currency: 'USD',
      metadata: { source: 'webhook' },
    });

    expect(paymentId).toBe('pay_existing_1');
    // Call 1: idempotency check by stripe_invoice_id
    expect(mockQuery).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('SELECT id'),
      ['in_existing_1']
    );
    // Call 2: fallback reference check by payment_intent
    expect(mockQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('SELECT id'),
      ['pi_existing_1']
    );
    // Call 3: UPDATE existing row — includes invoiceId as 8th param
    expect(mockQuery).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('UPDATE payments'),
      [
        'pay_existing_1',
        'user-9',
        'creator_monthly',
        29,
        'USD',
        'sub_existing_1',
        expect.stringContaining('"stripe_payment_intent_id":"pi_existing_1"'),
        'in_existing_1',
      ]
    );
  });

  test('processStripeCheckout stores payment_intent as reference and runs creator settlement side effects', async () => {
    // 1st query: idempotency check (stripe_session_id) — miss
    // 2nd query: PRIME entitlement check — hit (user has PRIME)
    // 3rd query: INSERT payment row
    // 4th query: stamp stripe_subscription_id on entitlements
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'prime-ent-1' }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });

    mockHasEntitlement.mockResolvedValue(true);
    jest.spyOn(PaymentService, 'grantEntitlementsForPlan').mockResolvedValue({ granted: 1, errors: 0 });
    jest.spyOn(PaymentService, 'syncStripeCreatorSubscriptionSettlement').mockResolvedValue({
      subscriptionId: 'sub-row-1',
    });

    const session = {
      id: 'cs_test_123',
      payment_intent: 'pi_test_123',
      subscription: 'sub_test_123',
      amount_total: 1900,
      currency: 'usd',
      metadata: {
        pnptv_user_id: 'user-1',
        pnptv_plan_id: 'creator_monthly',
        payment_type: 'creator_subscription',
        creatorId: 'creator-9',
      },
    };

    const result = await PaymentService.processStripeCheckout(session);

    expect(result).toEqual({ success: true });
    // Call index 2 (0-based) = 3rd query = INSERT payment; params[1] = reference = payment_intent
    expect(mockQuery.mock.calls[2][1][1]).toBe('pi_test_123');
    expect(PaymentService.grantEntitlementsForPlan).toHaveBeenCalledWith(
      'user-1',
      'creator_monthly',
      'stripe',
      expect.objectContaining({
        creatorId: 'creator-9',
        stripeSubscriptionId: 'sub_test_123',
      }),
      expect.any(String)
    );
    expect(PaymentService.syncStripeCreatorSubscriptionSettlement).toHaveBeenCalledWith({
      subscriberId: 'user-1',
      creatorId: 'creator-9',
      paymentId: expect.any(String),
      notifyNewSubscriber: true,
    });
  });

  test('renewStripeSubscriptionEntitlements records a renewal payment and runs creator settlement for creator plans', async () => {
    // upsertStripeRenewalPayment is mocked — first real DB call is the PRIME check
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'prime-ent-1' }] })
      .mockResolvedValue({ rowCount: 1, rows: [] });
    jest.spyOn(PaymentService, 'upsertStripeRenewalPayment').mockResolvedValue('pay_renew_1');
    jest.spyOn(PaymentService, 'grantEntitlementsForPlan').mockResolvedValue({ granted: 1, errors: 0 });
    jest.spyOn(PaymentService, 'syncStripeCreatorSubscriptionSettlement').mockResolvedValue({
      subscriptionId: 'creator-sub-1',
    });

    const result = await PaymentService.renewStripeSubscriptionEntitlements(
      'sub_renew_1',
      'user-2',
      'creator_monthly',
      {
        creatorId: 'creator-77',
        invoiceId: 'in_renew_1',
        paymentIntentId: 'pi_renew_1',
        amountTotal: 29,
        currency: 'USD',
      }
    );

    expect(result).toEqual({ success: true });
    expect(PaymentService.upsertStripeRenewalPayment).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-2',
      planId: 'creator_monthly',
      stripeSubscriptionId: 'sub_renew_1',
      invoiceId: 'in_renew_1',
      paymentIntentId: 'pi_renew_1',
      amountTotal: 29,
      currency: 'USD',
    }));
    expect(PaymentService.grantEntitlementsForPlan).toHaveBeenCalledWith(
      'user-2',
      'creator_monthly',
      'stripe_renewal',
      expect.objectContaining({
        stripeSubscriptionId: 'sub_renew_1',
        creatorId: 'creator-77',
      }),
      'pay_renew_1'
    );
    expect(PaymentService.syncStripeCreatorSubscriptionSettlement).toHaveBeenCalledWith({
      subscriberId: 'user-2',
      creatorId: 'creator-77',
      paymentId: 'pay_renew_1',
      notifyNewSubscriber: false,
    });
  });

  test('deactivateStripeSubscriptionEntitlements recomputes tier and invalidates cache for affected users', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 'e1', user_id: 'user-1' },
        { id: 'e2', user_id: 'user-1' },
        { id: 'e3', user_id: 'user-2' },
      ],
    });
    mockInvalidateCache.mockResolvedValue(undefined);
    mockRecomputeUserTier.mockResolvedValue('free');

    const result = await PaymentService.deactivateStripeSubscriptionEntitlements('sub_cancel_1');

    expect(result).toEqual({ success: true, deactivated: 3 });
    expect(mockInvalidateCache).toHaveBeenCalledTimes(2);
    expect(mockInvalidateCache).toHaveBeenCalledWith('user-1');
    expect(mockInvalidateCache).toHaveBeenCalledWith('user-2');
    expect(mockRecomputeUserTier).toHaveBeenCalledTimes(2);
  });
});
