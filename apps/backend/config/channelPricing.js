'use strict';

/**
 * channelPricing.js
 * Maps creator channel price tiers (USD) to pre-created Stripe Price IDs.
 * Product: "Creator Content" (prod_UZT2ogeGLowQgU) — discreet name shown in Stripe checkout.
 * All prices are one-time payments.
 */

const CHANNEL_PRICE_MAP = {
  '4.99':  'price_1TaK6RHObVVNoB7Q2l68PH3V',
  '9.99':  'price_1TaK6UHObVVNoB7QsvjOxNDc',
  '14.99': 'price_1TaK6YHObVVNoB7Q9lMESONB',
};

module.exports = { CHANNEL_PRICE_MAP };
