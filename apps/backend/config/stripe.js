'use strict';

const Stripe = require('stripe');

const STRIPE_API_VERSION = '2024-04-10';

function getStripeSecretKey() {
  return process.env.STRIPE_SECRET_KEY?.trim() || '';
}

function getStripeWebhookSecret() {
  return process.env.STRIPE_WEBHOOK_SECRET?.trim() || '';
}

function isRestrictedStripeKey(key = getStripeSecretKey()) {
  return key.startsWith('rk_');
}

function getRestrictedKeyRequiredScopes() {
  return [
    'Customers: write',
    'Checkout Sessions: write',
    'Customer portal: write',
    'Subscriptions: read/write',
  ];
}

function assertStripeSecretKeyConfigured() {
  const key = getStripeSecretKey();

  if (!key) {
    throw new Error('STRIPE_SECRET_KEY environment variable is not configured');
  }

  if (key.startsWith('pk_')) {
    throw new Error('STRIPE_SECRET_KEY is using a publishable Stripe key; a server-side secret or restricted key is required');
  }

  if (isRestrictedStripeKey(key) && process.env.STRIPE_ALLOW_RESTRICTED_KEY !== 'true') {
    throw new Error(
      `STRIPE_SECRET_KEY is a restricted Stripe key. Set STRIPE_ALLOW_RESTRICTED_KEY=true only if that key includes: ${getRestrictedKeyRequiredScopes().join(', ')}`
    );
  }

  return key;
}

function createStripeClient() {
  return new Stripe(assertStripeSecretKeyConfigured(), { apiVersion: STRIPE_API_VERSION });
}

module.exports = {
  STRIPE_API_VERSION,
  assertStripeSecretKeyConfigured,
  createStripeClient,
  getRestrictedKeyRequiredScopes,
  getStripeSecretKey,
  getStripeWebhookSecret,
  isRestrictedStripeKey,
};
