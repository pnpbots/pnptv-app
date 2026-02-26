/**
 * ePayco Subscription Plan ID Mapping
 *
 * Maps internal plan IDs to ePayco subscription landing page plan IDs.
 * Recurring plans use ePayco's hosted subscription pages.
 * One-time plans (week_pass, lifetime_pass) use the custom checkout page.
 */

const EPAYCO_SUBSCRIPTION_PLANS = {
  // WEEK PASS - 007PASS - $14.99 USD
  week_pass: '007PASS',

  // 3X MONTHLY PASS - 090PASS - $49.99 USD (3 months = 90 days)
  three_months_pass: '090PASS',

  // CRYSTAL PASS - 180PASS - $74.99 USD (6 months = 180 days)
  crystal_pass: '180PASS',
  six_months_pass: '180PASS',

  // YEARLY PASS - 365PASS
  yearly_pass: '989cc3619e2a37cfe0111f0',

  // LIFETIME PASS - LIFETIME100 - $100 USD (one-time payment)
  lifetime_pass: 'LIFETIME100',
  lifetime_100: 'LIFETIME100',
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
