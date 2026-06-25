'use strict';

const onboardingService = require('../../../services/onboardingService');
const logger = require('../../../utils/logger');

/**
 * GET /api/webapp/onboarding/status
 * Returns the user's current wizard step completion state.
 */
const getStatus = async (req, res) => {
  try {
    const userId = req.session.user?.id;
    const status = await onboardingService.getOnboardingStatus(userId);
    return res.json(status);
  } catch (err) {
    if (err.status === 404) {
      return res.status(404).json({ error: 'user_not_found' });
    }
    logger.error('[Onboarding] getStatus error:', err);
    return res.status(500).json({ error: 'internal_error' });
  }
};

/**
 * POST /api/webapp/onboarding/step
 * Body: { step: string, payload?: object }
 * Records completion of a single wizard step.
 */
const markStep = async (req, res) => {
  try {
    const userId = req.session.user?.id;
    const { step, payload } = req.body;

    if (!step) {
      return res.status(400).json({ error: 'step_required' });
    }

    // Extract real client IP — trust X-Forwarded-For set by Nginx Proxy Manager
    const ip =
      (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
      req.ip ||
      null;

    const result = await onboardingService.markStep(userId, step, payload || {}, ip);

    if (result.error) {
      // must_be_18 and invalid_dob_format are client errors
      const clientErrors = ['must_be_18', 'invalid_dob_format', 'invalid_step'];
      if (clientErrors.includes(result.error)) {
        return res.status(400).json(result);
      }
      return res.status(500).json(result);
    }

    return res.json(result);
  } catch (err) {
    logger.error('[Onboarding] markStep error:', err);
    return res.status(500).json({ error: 'internal_error' });
  }
};

/**
 * POST /api/webapp/onboarding/complete
 * Finalizes onboarding after verifying all steps server-side.
 */
const completeOnboarding = async (req, res) => {
  try {
    const userId = req.session.user?.id;
    const result = await onboardingService.completeOnboarding(userId);

    if (result.error) {
      return res.status(400).json(result);
    }

    // Reflect completion in the active session so the frontend doesn't need
    // to reload the full profile to get an updated onboarding_complete flag.
    if (req.session.user) {
      req.session.user.onboardingComplete = true;
    }

    return res.json(result);
  } catch (err) {
    logger.error('[Onboarding] completeOnboarding error:', err);
    return res.status(500).json({ error: 'internal_error' });
  }
};

module.exports = { getStatus, markStep, completeOnboarding };
