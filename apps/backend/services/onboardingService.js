'use strict';

const { query } = require('../config/postgres');
const logger = require('../utils/logger');

// ── Version constants ────────────────────────────────────────────────────────
// Bump these strings to force all users through re-acceptance of a new version.
const RULES_VERSION   = '1.0';
const TERMS_VERSION   = '1.0';
const PRIVACY_VERSION = '1.0';

// Ordered wizard steps. The frontend drives display order; here we just need
// the full set to determine completion.
const ALL_STEPS = ['tiers', 'age', 'terms', 'privacy', 'rules', 'values', 'crypto'];

/**
 * Returns the onboarding status for a user.
 *
 * @param {string} userId
 * @returns {Promise<{
 *   complete: boolean,
 *   steps: Record<string, boolean>,
 *   currentStep: string|null
 * }>}
 */
async function getOnboardingStatus(userId) {
  const { rows } = await query(
    `SELECT
       onboarding_complete,
       tiers_seen_at,
       date_of_birth,
       age_verified,
       terms_accepted,
       privacy_accepted,
       rules_accepted,
       values_acknowledged_at,
       crypto_onboarded_at
     FROM users
     WHERE id = $1`,
    [userId]
  );

  if (rows.length === 0) {
    throw Object.assign(new Error('User not found'), { status: 404 });
  }

  const u = rows[0];

  const steps = {
    tiers:   !!u.tiers_seen_at,
    age:     !!(u.date_of_birth && u.age_verified),
    terms:   !!u.terms_accepted,
    privacy: !!u.privacy_accepted,
    rules:   !!u.rules_accepted,
    values:  !!u.values_acknowledged_at,
    crypto:  !!u.crypto_onboarded_at,
  };

  // First incomplete step in wizard order
  const currentStep = ALL_STEPS.find((s) => !steps[s]) || null;

  return {
    complete: !!u.onboarding_complete,
    steps,
    currentStep,
  };
}

/**
 * Records the user's completion of a single wizard step.
 *
 * @param {string} userId
 * @param {string} step   - one of ALL_STEPS
 * @param {object} payload
 * @param {string} ip
 * @returns {Promise<{ ok: true } | { error: string }>}
 */
async function markStep(userId, step, payload, ip) {
  if (!ALL_STEPS.includes(step)) {
    return { error: 'invalid_step' };
  }

  switch (step) {
    case 'tiers': {
      await query(
        `UPDATE users SET tiers_seen_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [userId]
      );
      break;
    }

    case 'age': {
      const { dob } = payload || {};
      if (!dob || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
        return { error: 'invalid_dob_format' };
      }

      const birthDate = new Date(dob);
      if (isNaN(birthDate.getTime())) {
        return { error: 'invalid_dob_format' };
      }

      // Server-side age calculation — no frontend trust
      const today   = new Date();
      let age        = today.getFullYear() - birthDate.getFullYear();
      const monthDiff = today.getMonth() - birthDate.getMonth();
      if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
        age--;
      }

      if (age < 18) {
        return { error: 'must_be_18' };
      }

      await query(
        `UPDATE users
         SET date_of_birth   = $2,
             age_verified     = true,
             age_verified_at  = NOW(),
             updated_at       = NOW()
         WHERE id = $1`,
        [userId, dob]
      );
      break;
    }

    case 'terms': {
      await query(
        `UPDATE users
         SET terms_accepted     = true,
             terms_accepted_at  = NOW(),
             terms_accepted_ip  = $2,
             terms_version      = $3,
             updated_at         = NOW()
         WHERE id = $1`,
        [userId, ip || null, TERMS_VERSION]
      );
      break;
    }

    case 'privacy': {
      await query(
        `UPDATE users
         SET privacy_accepted     = true,
             privacy_accepted_at  = NOW(),
             privacy_accepted_ip  = $2,
             privacy_version      = $3,
             updated_at           = NOW()
         WHERE id = $1`,
        [userId, ip || null, PRIVACY_VERSION]
      );
      break;
    }

    case 'rules': {
      await query(
        `UPDATE users
         SET rules_accepted     = true,
             rules_accepted_at  = NOW(),
             rules_accepted_ip  = $2,
             rules_version      = $3,
             updated_at         = NOW()
         WHERE id = $1`,
        [userId, ip || null, RULES_VERSION]
      );
      break;
    }

    case 'values': {
      await query(
        `UPDATE users
         SET values_acknowledged_at = NOW(),
             updated_at             = NOW()
         WHERE id = $1`,
        [userId]
      );
      break;
    }

    case 'crypto': {
      await query(
        `UPDATE users
         SET crypto_onboarded_at = NOW(),
             updated_at          = NOW()
         WHERE id = $1`,
        [userId]
      );
      break;
    }

    default:
      return { error: 'invalid_step' };
  }

  return { ok: true };
}

/**
 * Finalizes onboarding after verifying ALL steps are complete server-side.
 * Sets onboarding_complete = true only when all 7 steps pass.
 *
 * @param {string} userId
 * @returns {Promise<{ complete: true } | { error: string, missing: string[] }>}
 */
async function completeOnboarding(userId) {
  const status = await getOnboardingStatus(userId);

  const missing = ALL_STEPS.filter((s) => !status.steps[s]);
  if (missing.length > 0) {
    return { error: 'missing_steps', missing };
  }

  await query(
    `UPDATE users SET onboarding_complete = true, updated_at = NOW() WHERE id = $1`,
    [userId]
  );

  logger.info(`[Onboarding] User ${userId} completed onboarding wizard`);
  return { complete: true };
}

module.exports = {
  RULES_VERSION,
  TERMS_VERSION,
  PRIVACY_VERSION,
  getOnboardingStatus,
  markStep,
  completeOnboarding,
};
