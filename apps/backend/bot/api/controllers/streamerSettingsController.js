'use strict';

const logger = require('../../../utils/logger');
const streamerSettingsService = require('../../services/streamerSettingsService');

/**
 * GET /api/webapp/live/settings
 *
 * Returns the authenticated user's streamer settings.
 * If no row exists yet the service returns the canonical defaults,
 * so the frontend always receives a fully-populated settings object.
 */
const getSettings = async (req, res) => {
  try {
    // Session stores pnptvId (camelCase); fall back to numeric id if absent.
    const userId = req.user.pnptvId || req.user.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const settings = await streamerSettingsService.getSettings(String(userId));
    return res.json({ success: true, settings });
  } catch (err) {
    logger.error('streamerSettingsController.getSettings error', err);
    return res.status(500).json({ success: false, error: 'Failed to retrieve streamer settings' });
  }
};

/**
 * PUT /api/webapp/live/settings
 *
 * Upserts the authenticated user's streamer settings.
 * Unknown or out-of-range values are silently sanitized by the service layer.
 * Returns the full updated settings object.
 */
const updateSettings = async (req, res) => {
  try {
    const userId = req.user.pnptvId || req.user.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const settings = await streamerSettingsService.upsertSettings(String(userId), req.body || {});
    return res.json({ success: true, settings });
  } catch (err) {
    logger.error('streamerSettingsController.updateSettings error', err);
    return res.status(500).json({ success: false, error: 'Failed to update streamer settings' });
  }
};

module.exports = { getSettings, updateSettings };
