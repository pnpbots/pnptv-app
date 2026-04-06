'use strict';

const { getPool } = require('../../config/postgres');
const logger = require('../../utils/logger');

const LIVE_RULES_VERSION = 1;

/**
 * GET /api/webapp/live/rules-status
 * Returns whether the authenticated user has acknowledged the current live rules version.
 */
const getRulesStatus = async (req, res) => {
  const user = req.session?.user;
  if (!user?.id) {
    return res.status(401).json({ success: false, error: 'Not authenticated' });
  }

  try {
    const pool = getPool();
    const result = await pool.query(
      `SELECT id FROM live_rules_acknowledgments
       WHERE user_id = $1 AND version = $2
       LIMIT 1`,
      [String(user.id), LIVE_RULES_VERSION]
    );

    return res.json({
      success: true,
      acknowledged: result.rowCount > 0,
      version: LIVE_RULES_VERSION,
    });
  } catch (err) {
    logger.error('liveRulesController.getRulesStatus error', { error: err.message, userId: user.id });
    return res.status(500).json({ success: false, error: 'Failed to check rules status' });
  }
};

/**
 * POST /api/webapp/live/acknowledge-rules
 * Records that the authenticated user has acknowledged the current live rules version.
 */
const acknowledgeRules = async (req, res) => {
  const user = req.session?.user;
  if (!user?.id) {
    return res.status(401).json({ success: false, error: 'Not authenticated' });
  }

  try {
    const pool = getPool();
    await pool.query(
      `INSERT INTO live_rules_acknowledgments (user_id, version)
       VALUES ($1, $2)
       ON CONFLICT (user_id, version) DO NOTHING`,
      [String(user.id), LIVE_RULES_VERSION]
    );

    return res.json({ success: true });
  } catch (err) {
    logger.error('liveRulesController.acknowledgeRules error', { error: err.message, userId: user.id });
    return res.status(500).json({ success: false, error: 'Failed to record acknowledgment' });
  }
};

module.exports = { getRulesStatus, acknowledgeRules };
