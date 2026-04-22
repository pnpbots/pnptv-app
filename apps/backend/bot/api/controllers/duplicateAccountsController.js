'use strict';

/**
 * duplicateAccountsController.js
 *
 * Handles the admin API for duplicate-account review, preview, merge, and rename.
 * All routes are protected by superadminGuard (only superadmins can merge accounts).
 *
 * Import path depth: bot/api/controllers/ → use ../../../services/
 */

const accountMergeService = require('../../../services/accountMergeService');
const logger = require('../../../utils/logger');

/**
 * GET /api/webapp/admin/duplicate-accounts
 * Returns candidate pairs and recent merge log entries.
 */
const listCandidates = async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
    const logLimit = Math.min(parseInt(req.query.logLimit || '100', 10), 500);

    const [candidates, mergeLog] = await Promise.all([
      accountMergeService.findCandidates({ limit }),
      accountMergeService.listMergeLog({ limit: logLimit, offset: 0 }),
    ]);

    res.json({ success: true, candidates, mergeLog });
  } catch (err) {
    logger.error('duplicateAccountsController.listCandidates error', { error: err.message });
    res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * POST /api/webapp/admin/duplicate-accounts/preview
 * Body: { sourceId, targetId }
 * Returns per-table row counts + user snapshots without writing anything.
 */
const previewMerge = async (req, res) => {
  const { sourceId, targetId } = req.body;

  if (!sourceId || typeof sourceId !== 'string') {
    return res.status(400).json({ success: false, error: 'sourceId is required' });
  }
  if (!targetId || typeof targetId !== 'string') {
    return res.status(400).json({ success: false, error: 'targetId is required' });
  }

  try {
    const preview = await accountMergeService.previewMerge(sourceId.trim(), targetId.trim());
    res.json({ success: true, preview });
  } catch (err) {
    logger.error('duplicateAccountsController.previewMerge error', {
      sourceId, targetId, error: err.message,
    });
    const status = err.message.startsWith('MERGE_COLLISION') ? 409 :
                   err.message.includes('not found') ? 404 : 400;
    res.status(status).json({ success: false, error: err.message });
  }
};

/**
 * POST /api/webapp/admin/duplicate-accounts/merge
 * Body: { sourceId, targetId, reason, dimension }
 * Performs the full merge. performedBy comes from session.
 */
const mergeDuplicates = async (req, res) => {
  const { sourceId, targetId, reason, dimension } = req.body;
  const performedBy = req.session?.user?.id || req.user?.id;

  if (!sourceId || typeof sourceId !== 'string') {
    return res.status(400).json({ success: false, error: 'sourceId is required' });
  }
  if (!targetId || typeof targetId !== 'string') {
    return res.status(400).json({ success: false, error: 'targetId is required' });
  }
  if (!performedBy) {
    return res.status(401).json({ success: false, error: 'No authenticated session' });
  }

  const allowedDimensions = ['email', 'telegram', 'manual', 'x_id', 'pnptv_id'];
  const safeDimension = allowedDimensions.includes(dimension) ? dimension : 'manual';

  try {
    const result = await accountMergeService.mergeUserAccounts(
      sourceId.trim(),
      targetId.trim(),
      {
        reason: typeof reason === 'string' ? reason.slice(0, 500) : 'admin_manual',
        dimension: safeDimension,
        performedBy,
      }
    );

    logger.info('duplicateAccountsController: merge completed', {
      sourceId, targetId, mergeLogId: result.mergeLogId, performedBy,
    });

    res.json({ success: true, ...result });
  } catch (err) {
    logger.error('duplicateAccountsController.mergeDuplicates error', {
      sourceId, targetId, error: err.message, performedBy,
    });
    const status = err.message.startsWith('MERGE_COLLISION') ? 409 :
                   err.message.includes('not found') ? 404 : 400;
    res.status(status).json({ success: false, error: err.message });
  }
};

/**
 * POST /api/webapp/admin/duplicate-accounts/rename
 * Body: { sourceId, telegramId }
 * Renames a UUID source account to its corresponding numeric Telegram id.
 */
const renameTelegramId = async (req, res) => {
  const { sourceId, telegramId } = req.body;
  const performedBy = req.session?.user?.id || req.user?.id;

  if (!sourceId || typeof sourceId !== 'string') {
    return res.status(400).json({ success: false, error: 'sourceId is required' });
  }
  if (!telegramId || typeof telegramId !== 'string') {
    return res.status(400).json({ success: false, error: 'telegramId is required' });
  }
  if (!/^\d+$/.test(telegramId.trim())) {
    return res.status(400).json({ success: false, error: 'telegramId must be a numeric string' });
  }
  if (!performedBy) {
    return res.status(401).json({ success: false, error: 'No authenticated session' });
  }

  try {
    const result = await accountMergeService.renameToTelegramId(
      sourceId.trim(),
      telegramId.trim(),
      { performedBy }
    );

    logger.info('duplicateAccountsController: rename completed', {
      sourceId, telegramId, mergeLogId: result.mergeLogId, performedBy,
    });

    res.json({ success: true, ...result });
  } catch (err) {
    logger.error('duplicateAccountsController.renameTelegramId error', {
      sourceId, telegramId, error: err.message, performedBy,
    });
    const status = err.message.startsWith('MERGE_COLLISION') ? 409 :
                   err.message.includes('not found') ? 404 : 400;
    res.status(status).json({ success: false, error: err.message });
  }
};

module.exports = {
  listCandidates,
  previewMerge,
  mergeDuplicates,
  renameTelegramId,
};
