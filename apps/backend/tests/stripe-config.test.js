'use strict';

describe('Stripe config guardrails', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.resetModules();
  });

  test('rejects restricted keys unless explicitly allowed', () => {
    process.env.STRIPE_SECRET_KEY = 'rk_live_example';
    delete process.env.STRIPE_ALLOW_RESTRICTED_KEY;

    const { assertStripeSecretKeyConfigured } = require('../config/stripe');

    expect(() => assertStripeSecretKeyConfigured()).toThrow(/STRIPE_ALLOW_RESTRICTED_KEY=true/);
  });

  test('accepts restricted keys when explicitly allowed', () => {
    process.env.STRIPE_SECRET_KEY = 'rk_live_example';
    process.env.STRIPE_ALLOW_RESTRICTED_KEY = 'true';

    const { assertStripeSecretKeyConfigured } = require('../config/stripe');

    expect(assertStripeSecretKeyConfigured()).toBe('rk_live_example');
  });

  test('rejects publishable keys in server secret slot', () => {
    process.env.STRIPE_SECRET_KEY = 'pk_live_example';

    const { assertStripeSecretKeyConfigured } = require('../config/stripe');

    expect(() => assertStripeSecretKeyConfigured()).toThrow(/publishable Stripe key/);
  });
});
