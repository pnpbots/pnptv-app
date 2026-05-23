'use strict';

/**
 * payment-routes-contract.test.js
 *
 * Guards against the regression class where a payment route destructures a
 * service export that doesn't exist (`undefined`), which then throws a
 * TypeError only when the route is exercised under load in production.
 *
 * Concrete history: 2026-04-21 — `paymentRoutes.js` imported
 * `{ ensureEmailCredentials }` from userService; the function was actually
 * declared locally in `routes.js` and never exported. 4 customers saw their
 * 3DS charges return HTTP 500. See memory / payment_errors table.
 *
 * This test loads every destructured import used by the payment route
 * surface and asserts each name resolves to a function.
 */

// Minimum env needed to require modules without them blowing up at load time.
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-session-secret-padding-padding-padding';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-padding-padding';
process.env.NODE_ENV = 'test';

jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  stream: { write: jest.fn() },
  addUserContext: jest.fn(() => ({})),
}));

describe('payment routes — import contract', () => {
  test('services/userService exports ensureEmailCredentials as a function', () => {
    const userService = require('../services/userService');
    expect(typeof userService.ensureEmailCredentials).toBe('function');
  });

  test('bot/api/routes/paymentRoutes.js destructured imports all resolve', () => {
    // Mirror the destructured imports at the top of paymentRoutes.js.
    // If any of these resolves to `undefined`, the route will 500 at call time.
    const userService = require('../services/userService');
    const logger = require('../utils/logger');
    const errorHandler = require('../bot/api/middleware/errorHandler');
    const auth = require('../bot/api/middleware/auth');
    const jwtAuth = require('../bot/api/middleware/jwtAuth');
    const paymentController = require('../bot/api/controllers/paymentController');

    expect(typeof userService.ensureEmailCredentials).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof errorHandler.asyncHandler).toBe('function');
    expect(typeof auth.authenticateUser).toBe('function');
    expect(typeof jwtAuth.verifyAdminJWT).toBe('function');
    expect(typeof paymentController.getPaymentInfo).toBe('function');
    expect(typeof paymentController.getPaymentStatus).toBe('function');
    expect(typeof paymentController.processTokenizedCharge).toBe('function');
    expect(typeof paymentController.verify2FA).toBe('function');
    expect(typeof paymentController.complete3DS2Authentication).toBe('function');
    expect(typeof paymentController.confirmPaymentToken).toBe('function');
    expect(typeof paymentController.retryPaymentWebhook).toBe('function');
  });

  test('paymentController destructured imports all resolve', () => {
    // Pieces the controller pulls from shared services; missing exports here
    // would surface as runtime TypeErrors during the charge flow.
    const userService = require('../services/userService');
    expect(typeof userService.ensureEmailCredentials).toBe('function');
  });
});
