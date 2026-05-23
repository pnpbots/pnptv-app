'use strict';

const mockQuery = jest.fn();
const mockAcquireLock = jest.fn();
const mockReleaseLock = jest.fn();
const mockPaymentGetById = jest.fn();
const mockPaymentUpdateStatus = jest.fn();
const mockCreditTokensFromPayment = jest.fn();
const mockMarkPurchaseTerminalStatus = jest.fn();
const mockTryClaimEvent = jest.fn();

jest.mock('../config/postgres', () => ({
  query: (...args) => mockQuery(...args),
  getClient: jest.fn(),
}));

jest.mock('../config/redis', () => ({
  cache: {
    acquireLock: (...args) => mockAcquireLock(...args),
    releaseLock: (...args) => mockReleaseLock(...args),
    del: jest.fn(),
  },
  getRedis: jest.fn(),
}));

jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../models/paymentModel', () => ({
  getById: (...args) => mockPaymentGetById(...args),
  updateStatus: (...args) => mockPaymentUpdateStatus(...args),
}));

jest.mock('../services/tokenCheckoutService', () => ({
  creditTokensFromPayment: (...args) => mockCreditTokensFromPayment(...args),
  markPurchaseTerminalStatus: (...args) => mockMarkPurchaseTerminalStatus(...args),
}));

jest.mock('../models/paymentWebhookEventModel', () => ({
  tryClaimEvent: (...args) => mockTryClaimEvent(...args),
}));

jest.mock('../services/paymentSecurityService', () => ({
  logPaymentEvent: jest.fn().mockResolvedValue(undefined),
  logPaymentError: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../models/planModel', () => ({ getById: jest.fn() }));
jest.mock('../models/userModel', () => ({ getById: jest.fn(), updateSubscription: jest.fn() }));
jest.mock('../models/subscriberModel', () => ({
  getBySubscriptionId: jest.fn(),
  getByTelegramId: jest.fn(),
  create: jest.fn(),
}));
jest.mock('../services/paymentHistoryService', () => ({ recordPayment: jest.fn() }));
jest.mock('../services/notificationEmitter', () => ({ emit: jest.fn() }));
jest.mock('../services/paymentNotificationService', () => ({ sendAdminPaymentNotification: jest.fn() }));
jest.mock('../services/businessNotificationService', () => ({ notifyPayment: jest.fn() }));
jest.mock('../services/invoiceservice', () => ({
  generateInvoice: jest.fn(),
  generateOnboardingGuide: jest.fn(),
}));
jest.mock('../services/emailservice', () => ({
  sendInvoiceEmail: jest.fn(),
  sendWelcomeEmail: jest.fn(),
}));

const PaymentService = require('../services/paymentService');

describe('PaymentService.processEpaycoWebhook token_purchase flow', () => {
  const purchaseUuid = '11111111-1111-4111-8111-111111111111';

  beforeEach(() => {
    jest.clearAllMocks();
    mockQuery.mockReset();
    mockAcquireLock.mockResolvedValue(true);
    mockReleaseLock.mockResolvedValue(undefined);
    mockTryClaimEvent.mockResolvedValue({ claimed: true });
    mockPaymentGetById.mockResolvedValue(null);
    mockPaymentUpdateStatus.mockResolvedValue(0);
    mockCreditTokensFromPayment.mockResolvedValue({
      success: true,
      alreadyProcessed: false,
      userId: 'user-1',
      tokens: 25,
      newBalance: 100,
    });
    mockMarkPurchaseTerminalStatus.mockResolvedValue({ success: true, updated: true });
  });

  it('credits token purchases without requiring a payments row', async () => {
    const result = await PaymentService.processEpaycoWebhook({
      x_ref_payco: 'ref-123',
      x_transaction_id: 'txn-123',
      x_transaction_state: 'Aceptada',
      x_cod_transaction_state: '1',
      x_amount: '40000',
      x_currency_code: 'COP',
      x_extra1: 'user-1',
      x_extra2: 'token_purchase',
      x_extra3: purchaseUuid,
    });

    expect(result).toEqual({ success: true, type: 'token_purchase' });
    expect(mockCreditTokensFromPayment).toHaveBeenCalledWith(
      purchaseUuid,
      'epayco',
      expect.objectContaining({
        transactionId: 'txn-123',
        referenceCode: 'ref-123',
      }),
    );
    expect(mockPaymentUpdateStatus).not.toHaveBeenCalled();
  });

  it('marks failed token purchases on token_purchases instead of payments', async () => {
    const result = await PaymentService.processEpaycoWebhook({
      x_ref_payco: 'ref-456',
      x_transaction_id: 'txn-456',
      x_transaction_state: 'Rechazada',
      x_cod_transaction_state: '2',
      x_amount: '40000',
      x_currency_code: 'COP',
      x_extra1: 'user-1',
      x_extra2: 'token_purchase',
      x_extra3: purchaseUuid,
    });

    expect(result).toEqual({ success: true });
    expect(mockMarkPurchaseTerminalStatus).toHaveBeenCalledWith(
      purchaseUuid,
      'epayco',
      'invalid',
      expect.objectContaining({
        transactionId: 'txn-456',
        referenceCode: 'ref-456',
        epaycoState: 'Rechazada',
      }),
    );
    expect(mockPaymentUpdateStatus).not.toHaveBeenCalled();
  });
});
