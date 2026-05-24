'use strict';

/**
 * stripeService.js
 * Stripe SDK wrapper for PNPtv checkout and subscription management.
 * All Stripe operations go through this module so secrets never leak
 * to frontend code.
 *
 * Hosted at pay.codigosdemujeres.com — the checkout/webhook domain is
 * separate from pnptv.app but points at the same Express backend.
 */

const { query } = require('../config/postgres');
const { getRedis } = require('../config/redis');
const {
  assertStripeSecretKeyConfigured,
  createStripeClient,
  getRestrictedKeyRequiredScopes,
  getStripeSecretKey,
  getStripeWebhookSecret,
  isRestrictedStripeKey,
} = require('../config/stripe');
const logger = require('../utils/logger');

// Fail fast at startup if the secret key is not set
const STRIPE_SECRET_KEY = getStripeSecretKey();
if (!STRIPE_SECRET_KEY) {
  logger.warn('[stripeService] STRIPE_SECRET_KEY is not set — Stripe operations will fail at runtime');
} else if (isRestrictedStripeKey(STRIPE_SECRET_KEY)) {
  logger.warn('[stripeService] STRIPE_SECRET_KEY is a restricted key', {
    allowRestricted: process.env.STRIPE_ALLOW_RESTRICTED_KEY === 'true',
    requiredScopes: getRestrictedKeyRequiredScopes(),
  });
}

const STRIPE_WEBHOOK_SECRET = getStripeWebhookSecret();

// Redis key prefix for customer-id cache (TTL: 24 h)
const CUSTOMER_CACHE_PREFIX = 'stripe:cust:';
const CUSTOMER_CACHE_TTL = 86400;

/**
 * Lazily initialise the Stripe client so tests that never call Stripe can
 * boot without the env var being set.
 */
let _stripe = null;
function getStripe() {
  if (!_stripe) {
    assertStripeSecretKeyConfigured();
    _stripe = createStripeClient();
  }
  return _stripe;
}

// ─── Customer management ──────────────────────────────────────────────────────

/**
 * Find or create a Stripe Customer for a PNPtv user.
 * Caches the customer ID in Redis (24 h) and writes it to users.stripe_customer_id.
 *
 * @param {string} userId  - PNPtv internal user UUID
 * @param {string} email   - User email for the Customer object
 * @returns {Promise<string>} Stripe customer ID (cus_xxx)
 */
async function getOrCreateCustomer(userId, email) {
  if (!userId) throw new Error('getOrCreateCustomer: userId is required');

  const redis = getRedis();
  const cacheKey = `${CUSTOMER_CACHE_PREFIX}${userId}`;

  // 1. Check Redis cache
  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      logger.debug('[stripeService] customer from Redis cache', { userId, customerId: cached });
      return cached;
    }
  } catch (redisErr) {
    logger.warn('[stripeService] Redis read failed for customer cache', { error: redisErr.message });
  }

  // 2. Check DB column
  try {
    const { rows } = await query(
      'SELECT stripe_customer_id FROM users WHERE id = $1',
      [userId]
    );
    if (rows[0]?.stripe_customer_id) {
      const customerId = rows[0].stripe_customer_id;
      try { await redis.set(cacheKey, customerId, 'EX', CUSTOMER_CACHE_TTL); } catch (_) { /* non-fatal */ }
      return customerId;
    }
  } catch (dbErr) {
    logger.warn('[stripeService] DB read failed for stripe_customer_id', { error: dbErr.message });
  }

  // 3. Create in Stripe
  const stripe = getStripe();
  const customer = await stripe.customers.create({
    email: email || undefined,
    metadata: { user_id: String(userId) },
  });

  const customerId = customer.id;

  // 4. Persist to DB and cache
  try {
    await query(
      'UPDATE users SET stripe_customer_id = $1 WHERE id = $2',
      [customerId, userId]
    );
  } catch (dbErr) {
    logger.error('[stripeService] Failed to persist stripe_customer_id to DB', { userId, customerId, error: dbErr.message });
    // Non-fatal — the customer was created, we just can't cache it in DB
  }

  try {
    await redis.set(cacheKey, customerId, 'EX', CUSTOMER_CACHE_TTL);
  } catch (_) { /* non-fatal */ }

  logger.info('[stripeService] Customer created', { userId, customerId });
  return customerId;
}

// ─── Checkout sessions ────────────────────────────────────────────────────────

/**
 * Create a Stripe Checkout Session for a one-time payment.
 * Used for: week passes, lifetime plans, call bookings.
 *
 * @param {object} opts
 * @param {string} opts.userId
 * @param {string} opts.planId
 * @param {string} opts.sku
 * @param {string} opts.priceId       - Stripe Price ID (price_xxx)
 * @param {string} opts.successUrl
 * @param {string} opts.cancelUrl
 * @param {string} [opts.customerEmail]
 * @param {object} [opts.metadata]    - Arbitrary KV stored on the session
 * @returns {Promise<{sessionId: string, url: string}>}
 */
async function createCheckoutSession({
  userId,
  planId,
  sku,
  priceId,
  successUrl,
  cancelUrl,
  customerEmail,
  metadata = {},
}) {
  const stripe = getStripe();

  let customerId;
  try {
    customerId = await getOrCreateCustomer(userId, customerEmail);
  } catch (err) {
    logger.warn('[stripeService] Could not resolve customer; creating anonymous session', { error: err.message });
  }

  const sessionParams = {
    mode: 'payment',
    payment_method_types: ['card', 'link'],
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: {
      ...metadata,
      user_id: String(userId),
      plan_id: planId || '',
      sku: sku || '',
      payment_type: 'one_time',
    },
    allow_promotion_codes: true,
    billing_address_collection: 'auto',
  };

  if (customerId) {
    sessionParams.customer = customerId;
  } else if (customerEmail) {
    sessionParams.customer_email = customerEmail;
  }

  const session = await stripe.checkout.sessions.create(sessionParams);
  logger.info('[stripeService] Checkout session created', { userId, planId, sessionId: session.id });
  return { sessionId: session.id, url: session.url };
}

/**
 * Create a Stripe Checkout Session for a custom one-time price.
 * Used for resource-priced purchases that do not map 1:1 to a static Stripe Price.
 *
 * @param {object} opts
 * @param {string} opts.userId
 * @param {string} [opts.planId]
 * @param {string} [opts.sku]
 * @param {number} opts.amountUsd
 * @param {string} opts.productName
 * @param {string} [opts.description]
 * @param {string} opts.successUrl
 * @param {string} opts.cancelUrl
 * @param {string} [opts.customerEmail]
 * @param {object} [opts.metadata]
 * @returns {Promise<{sessionId: string, url: string}>}
 */
async function createCustomCheckoutSession({
  userId,
  planId,
  sku,
  amountUsd,
  productName,
  description,
  successUrl,
  cancelUrl,
  customerEmail,
  metadata = {},
}) {
  if (!(Number(amountUsd) > 0)) {
    throw new Error('createCustomCheckoutSession: amountUsd must be > 0');
  }

  const stripe = getStripe();

  let customerId;
  try {
    customerId = await getOrCreateCustomer(userId, customerEmail);
  } catch (err) {
    logger.warn('[stripeService] Could not resolve customer for custom checkout', { error: err.message });
  }

  const sessionParams = {
    mode: 'payment',
    payment_method_types: ['card', 'link'],
    line_items: [{
      quantity: 1,
      price_data: {
        currency: 'usd',
        unit_amount: Math.round(Number(amountUsd) * 100),
        product_data: {
          name: productName,
          ...(description ? { description } : {}),
        },
      },
    }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: {
      ...metadata,
      user_id: String(userId),
      plan_id: planId || '',
      sku: sku || '',
      payment_type: metadata.payment_type || 'one_time',
    },
    billing_address_collection: 'auto',
  };

  if (customerId) {
    sessionParams.customer = customerId;
  } else if (customerEmail) {
    sessionParams.customer_email = customerEmail;
  }

  const session = await stripe.checkout.sessions.create(sessionParams);
  logger.info('[stripeService] Custom checkout session created', {
    userId,
    planId,
    sessionId: session.id,
    amountUsd,
  });
  return { sessionId: session.id, url: session.url };
}

/**
 * Create a Stripe Checkout Session for a recurring subscription.
 * Used for: monthly, annual plans.
 *
 * @param {object} opts
 * @param {string} opts.userId
 * @param {string} opts.planId
 * @param {string} opts.sku
 * @param {string} opts.priceId       - Stripe recurring Price ID
 * @param {string} opts.successUrl
 * @param {string} opts.cancelUrl
 * @param {string} [opts.customerEmail]
 * @param {object} [opts.metadata]
 * @returns {Promise<{sessionId: string, url: string}>}
 */
async function createSubscriptionCheckout({
  userId,
  planId,
  sku,
  priceId,
  successUrl,
  cancelUrl,
  customerEmail,
  metadata = {},
}) {
  const stripe = getStripe();

  let customerId;
  try {
    customerId = await getOrCreateCustomer(userId, customerEmail);
  } catch (err) {
    logger.warn('[stripeService] Could not resolve customer for subscription', { error: err.message });
  }

  const sessionParams = {
    mode: 'subscription',
    payment_method_types: ['card', 'link'],
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: {
      ...metadata,
      user_id: String(userId),
      plan_id: planId || '',
      sku: sku || '',
      payment_type: 'subscription',
    },
    subscription_data: {
      metadata: {
        ...metadata,
        user_id: String(userId),
        plan_id: planId || '',
        sku: sku || '',
      },
    },
    allow_promotion_codes: true,
    billing_address_collection: 'auto',
  };

  if (customerId) {
    sessionParams.customer = customerId;
  } else if (customerEmail) {
    sessionParams.customer_email = customerEmail;
  }

  const session = await stripe.checkout.sessions.create(sessionParams);
  logger.info('[stripeService] Subscription checkout session created', { userId, planId, sessionId: session.id });
  return { sessionId: session.id, url: session.url };
}

// ─── Customer portal ──────────────────────────────────────────────────────────

/**
 * Create a Stripe Customer Portal session for self-service subscription management.
 *
 * @param {string} stripeCustomerId  - Stripe cus_xxx ID
 * @param {string} returnUrl         - Where to send the user after portal actions
 * @returns {Promise<{url: string}>}
 */
async function createCustomerPortalSession(stripeCustomerId, returnUrl) {
  if (!stripeCustomerId) throw new Error('createCustomerPortalSession: stripeCustomerId is required');
  const stripe = getStripe();
  const session = await stripe.billingPortal.sessions.create({
    customer: stripeCustomerId,
    return_url: returnUrl,
  });
  return { url: session.url };
}

// ─── Subscription management ──────────────────────────────────────────────────

/**
 * Cancel a Stripe subscription at the end of the current billing period.
 *
 * @param {string} stripeSubscriptionId  - Stripe sub_xxx ID
 * @returns {Promise<void>}
 */
async function cancelSubscription(stripeSubscriptionId) {
  if (!stripeSubscriptionId) throw new Error('cancelSubscription: stripeSubscriptionId is required');
  const stripe = getStripe();
  await stripe.subscriptions.update(stripeSubscriptionId, { cancel_at_period_end: true });
  logger.info('[stripeService] Subscription set to cancel at period end', { stripeSubscriptionId });
}

// ─── Webhook verification ─────────────────────────────────────────────────────

/**
 * Verify the Stripe-Signature header and construct the event object.
 * Requires the raw request body (Buffer), not the parsed JSON.
 *
 * @param {Buffer|string} rawBody
 * @param {string}        signature  - Value of stripe-signature header
 * @param {string}        [secret]   - Override webhook secret (for tests)
 * @returns {import('stripe').Stripe.Event}
 * @throws if signature is invalid
 */
function constructWebhookEvent(rawBody, signature, secret) {
  const stripe = getStripe();
  const webhookSecret = secret || STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    throw new Error('STRIPE_WEBHOOK_SECRET is not configured');
  }
  return stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
}

// ─── Subscription retrieval ───────────────────────────────────────────────────

/**
 * Retrieve a Stripe Subscription object by ID.
 * Used by webhook handlers to avoid inline Stripe client instantiation.
 *
 * @param {string} subscriptionId  - Stripe sub_xxx ID
 * @returns {Promise<import('stripe').Stripe.Subscription>}
 */
async function getSubscription(subscriptionId) {
  const stripe = getStripe();
  return stripe.subscriptions.retrieve(subscriptionId);
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  getStripe,
  getOrCreateCustomer,
  createCheckoutSession,
  createCustomCheckoutSession,
  createSubscriptionCheckout,
  createCustomerPortalSession,
  cancelSubscription,
  constructWebhookEvent,
  getSubscription,
};
