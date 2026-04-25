'use strict';

const { query } = require('../config/postgres');
const crypto = require('crypto');
const logger = require('../utils/logger');

// PNP Live token reward by plan_id. Anything not listed gets the default.
// Updated 2026-04-25: switched from "3 days PRIME" to PNP Live tokens.
//   • week pass + any monthly pass (PRIME or Basic)  → 1 token
//   • everything longer (quarterly, half-year, year, lifetime, Colombia) → 3
// IDs come from the active rows in the `plans` table; keep in sync with init-plans.js.
const REFERRAL_TOKEN_REWARD = {
  'prime-week-pass-7d': 1,  // PRIME Week Pass
  'monthly-pass':       1,  // PRIME Monthly Pass
  'member_monthly':     1,  // PNP Stans Basic Plan (Basic monthly)
  'pnp_col_monthly':    1,  // PNP Col — Monthly
};
const REFERRAL_TOKEN_REWARD_DEFAULT = 3;

/**
 * Resolve the PNP Live token reward for a given plan_id.
 * @param {string} planId
 * @returns {number} number of tokens to credit the referrer
 */
function tokenRewardForPlan(planId) {
  if (!planId) return 0;
  if (Object.prototype.hasOwnProperty.call(REFERRAL_TOKEN_REWARD, planId)) {
    return REFERRAL_TOKEN_REWARD[planId];
  }
  return REFERRAL_TOKEN_REWARD_DEFAULT;
}

function generateCode(userId) {
  return crypto.createHash('md5').update(userId + 'pnptv2026ref').digest('hex').slice(0, 8).toUpperCase();
}

async function getOrCreateRefCode(userId) {
  const { rows } = await query('SELECT ref_code FROM users WHERE id=$1', [userId]);
  if (rows[0]?.ref_code) return rows[0].ref_code;
  const code = generateCode(userId);
  await query('UPDATE users SET ref_code=$1 WHERE id=$2', [code, userId]);
  return code;
}

async function getReferralStats(userId) {
  const code = await getOrCreateRefCode(userId);
  const { rows } = await query(
    `SELECT
       COUNT(*)                                       AS total,
       COUNT(*) FILTER (WHERE status='completed')     AS completed,
       COALESCE(SUM(reward_tokens), 0)                AS tokens_earned
     FROM referrals WHERE referrer_id=$1`,
    [userId]
  );
  return {
    code,
    total:        parseInt(rows[0].total, 10),
    completed:    parseInt(rows[0].completed, 10),
    tokensEarned: parseInt(rows[0].tokens_earned, 10),
  };
}

/**
 * Attribute a referral. Called when a referee enters/clicks a referral code.
 *
 * Inserts a `referrals` row with status='pending'. The actual reward
 * (PNP Live tokens to the referrer) is granted later, ONCE, when the referee
 * makes their first paid plan purchase — see PaymentService.grantEntitlementsForPlan.
 *
 * Returns:
 *   { success: true, pending: true }   — newly attributed
 *   { alreadyRedeemed: true }          — referee already linked to this code
 *
 * Throws:
 *   400 'Invalid referral code'         — code doesn't match a user
 *   400 'Cannot use your own referral code'
 *
 * @param {string} code
 * @param {string} refereeId
 * @returns {Promise<object>}
 */
async function redeemReferral(code, refereeId) {
  const upperCode = String(code || '').toUpperCase();
  const { rows: refRows } = await query(
    'SELECT id FROM users WHERE ref_code=$1',
    [upperCode]
  );
  if (!refRows.length) {
    const err = new Error('Invalid referral code');
    err.status = 400;
    throw err;
  }
  const referrerId = refRows[0].id;
  if (String(referrerId) === String(refereeId)) {
    const err = new Error('Cannot use your own referral code');
    err.status = 400;
    throw err;
  }

  // Idempotent attribution. Reward stays at 0 until the referee buys a plan.
  const { rows: inserted } = await query(
    `INSERT INTO referrals (code, referrer_id, referee_id, status, reward_tokens, reward_days)
     VALUES ($1, $2, $3, 'pending', 0, 0)
     ON CONFLICT (code, referee_id) DO NOTHING
     RETURNING id`,
    [upperCode, referrerId, String(refereeId)]
  );

  if (!inserted.length) {
    return { alreadyRedeemed: true };
  }

  logger.info('Referral attributed (pending reward)', { referrerId, refereeId, code: upperCode });
  return { success: true, pending: true, referrerId };
}

/**
 * Grant the referral reward when the referee buys their first paid plan.
 * Called from PaymentService.grantEntitlementsForPlan after entitlements are
 * granted on a successful payment. Idempotent — only the first pending
 * attribution per referee fires; subsequent purchases do nothing.
 *
 * Reward (credited to the referrer's PNP Live wallet):
 *   • week_pass or member-monthly  → 1 token
 *   • any other paid plan           → 3 tokens
 *
 * Failure here MUST NOT block the payment — caller should swallow exceptions.
 *
 * @param {string} refereeId  user who just purchased a plan
 * @param {string} planId     the plan they purchased
 * @returns {Promise<{credited: boolean, referrerId?: string, tokens?: number, planId?: string}>}
 */
async function grantReferralReward(refereeId, planId) {
  if (!refereeId || !planId) return { credited: false };

  // Find the single pending attribution for this referee, if any.
  const { rows } = await query(
    `SELECT id, code, referrer_id
       FROM referrals
       WHERE referee_id = $1 AND status = 'pending'
       ORDER BY created_at ASC
       LIMIT 1`,
    [String(refereeId)]
  );
  if (!rows.length) return { credited: false };

  const referralRow = rows[0];
  const tokens = tokenRewardForPlan(planId);
  if (tokens <= 0) return { credited: false };

  // Credit the referrer's wallet. Use the existing tokenService so the wallet
  // is created lazily and the cache is invalidated correctly.
  const tokenService = require('./tokenService');
  const credited = await tokenService.creditTokens(
    referralRow.referrer_id,
    tokens,
    `referral_reward_${planId}`
  );
  if (!credited) {
    logger.warn('grantReferralReward: tokenService.creditTokens returned false', {
      referrerId: referralRow.referrer_id, refereeId, planId, tokens,
    });
    return { credited: false };
  }

  // Mark the referral completed. Concurrent payments for the same referee
  // are de-duped by the WHERE status='pending' clause + the row's PK.
  await query(
    `UPDATE referrals
       SET status = 'completed',
           completed_at = NOW(),
           reward_tokens = $2
       WHERE id = $1 AND status = 'pending'`,
    [referralRow.id, tokens]
  );

  logger.info('Referral reward credited', {
    referrerId: referralRow.referrer_id,
    refereeId,
    planId,
    tokens,
  });

  return { credited: true, referrerId: referralRow.referrer_id, tokens, planId };
}

module.exports = {
  getOrCreateRefCode,
  getReferralStats,
  redeemReferral,
  grantReferralReward,
  tokenRewardForPlan,
};
