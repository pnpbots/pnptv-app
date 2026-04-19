'use strict';

const { getPool } = require('../../../config/postgres');
const logger = require('../../../utils/logger');

const LIVE_RULES_VERSION = 1;
const STREAM_RULES_MAX_CHARS = 2000;

// Basic HTML sanitization — strip all tags; collapses to plain text.
function stripHtml(input) {
  return input.replace(/<[^>]*>/g, '').trim();
}

/**
 * GET /api/webapp/live/rules-status
 * Returns whether the authenticated user has acknowledged the current live rules version.
 * Optional query param: ?channelRef=<live_channel> — if provided, also returns the channel
 * owner's stream_rules (creatorRules) and display name (creatorName).
 */
const getRulesStatus = async (req, res) => {
  const user = req.session?.user;
  if (!user?.id) {
    return res.status(401).json({ success: false, error: 'Not authenticated' });
  }

  try {
    const pool = getPool();
    const ackResult = await pool.query(
      `SELECT id FROM live_rules_acknowledgments
       WHERE user_id = $1 AND version = $2
       LIMIT 1`,
      [String(user.id), LIVE_RULES_VERSION]
    );

    const response = {
      success: true,
      acknowledged: ackResult.rowCount > 0,
      version: LIVE_RULES_VERSION,
      creatorRules: null,
      creatorName: null,
    };

    const { channelRef } = req.query;
    if (channelRef && typeof channelRef === 'string') {
      const creatorResult = await pool.query(
        `SELECT display_name, username, stream_rules
         FROM users
         WHERE live_channel = $1
         LIMIT 1`,
        [channelRef]
      );
      if (creatorResult.rowCount > 0) {
        const row = creatorResult.rows[0];
        response.creatorRules = row.stream_rules || null;
        response.creatorName = row.display_name || row.username || null;
      }
    }

    return res.json(response);
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

/**
 * POST /api/webapp/live/stream-rules
 * Body: { rules: string } — max 2000 chars, HTML stripped.
 * Saves the authenticated creator's custom stream rules to users.stream_rules.
 */
const saveStreamRules = async (req, res) => {
  const user = req.session?.user;
  if (!user?.id) {
    return res.status(401).json({ success: false, error: 'Not authenticated' });
  }

  const raw = req.body?.rules;
  if (raw === undefined || raw === null) {
    return res.status(400).json({ success: false, error: 'rules field is required' });
  }
  if (typeof raw !== 'string') {
    return res.status(400).json({ success: false, error: 'rules must be a string' });
  }

  const sanitized = stripHtml(raw);
  if (sanitized.length > STREAM_RULES_MAX_CHARS) {
    return res.status(400).json({
      success: false,
      error: `rules must be at most ${STREAM_RULES_MAX_CHARS} characters`,
    });
  }

  try {
    const pool = getPool();
    await pool.query(
      `UPDATE users SET stream_rules = $1 WHERE id = $2`,
      [sanitized.length > 0 ? sanitized : null, String(user.id)]
    );

    logger.info('liveRulesController.saveStreamRules saved', { userId: user.id, len: sanitized.length });
    return res.json({ success: true, rules: sanitized.length > 0 ? sanitized : null });
  } catch (err) {
    logger.error('liveRulesController.saveStreamRules error', { error: err.message, userId: user.id });
    return res.status(500).json({ success: false, error: 'Failed to save stream rules' });
  }
};

module.exports = { getRulesStatus, acknowledgeRules, saveStreamRules };
