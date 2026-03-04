/**
 * ePayco Subscription Plan ID Mapping
 *
 * Maps internal plan IDs to ePayco subscription landing page plan IDs.
 * All ePayco payments are routed through these hosted pages, which handle
 * tokenization, PCI compliance, and charging on ePayco's side.
 *
 * Plans without an entry here fall back to the custom tokenized checkout page.
 */

const EPAYCO_SUBSCRIPTION_PLANS = {
  // PNP MEMBER - PNPMEMBER030 - $9.99 USD (monthly)
  member_monthly: 'PNPMEMBER030',

  // PRIME Trial - 007PASS - $14.99 USD (7 days)
  'week-trial-pass': '007PASS',

  // Monthly PRIME - 030PASS - $24.99 USD (30 days)
  'monthly-pass': '030PASS',

  // Crystal PRIME - 180PASS - $49.99 USD (6 months)
  'crystal-pass': '180PASS',

  // Diamond PRIME - 365PASS - $99.99 USD (1 year)
  'diamond-pass': '365PASS',

  // Lifetime PRIME - LIFETIME - $249.99 USD (one-time payment)
  'lifetime-pass': 'LIFETIME',
};

/**
 * Build ePayco subscription landing page URL with extra params
 * @param {string} planId - Internal plan ID
 * @param {Object} extras - Extra parameters (extra1=userId, extra2=planId, extra3=paymentId)
 * @returns {string|null} Subscription URL or null if not a subscription plan
 */
function getEpaycoSubscriptionUrl(planId, extras = {}) {
  const epaycoId = EPAYCO_SUBSCRIPTION_PLANS[planId];
  if (!epaycoId) return null;

  const url = new URL(`https://subscription-landing.epayco.co/plan/${epaycoId}`);
  if (extras.extra1) url.searchParams.set('extra1', extras.extra1);
  if (extras.extra2) url.searchParams.set('extra2', extras.extra2);
  if (extras.extra3) url.searchParams.set('extra3', extras.extra3);
  return url.toString();
}

/**
 * Check if a plan uses ePayco hosted subscription pages
 * @param {string} planId - Internal plan ID
 * @returns {boolean}
 */
function isSubscriptionPlan(planId) {
  return planId in EPAYCO_SUBSCRIPTION_PLANS;
}

module.exports = {
  EPAYCO_SUBSCRIPTION_PLANS,
  getEpaycoSubscriptionUrl,
  isSubscriptionPlan,
};
