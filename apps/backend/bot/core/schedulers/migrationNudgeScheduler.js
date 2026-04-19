'use strict';

/**
 * Migration Nudge Scheduler
 *
 * Posts the bilingual migration message to the main Telegram community group
 * once a day at 18:00 America/Bogota. The message body and send logic live in
 * apps/backend/scripts/sendMigrationNudge.js — this scheduler is a thin cron
 * wrapper around it.
 */

const cron = require('node-cron');
const path = require('path');
const logger = require('../../../utils/logger');

const NUDGE_CRON = '0 18 * * *';
const NUDGE_TZ = 'America/Bogota';

const { sendMigrationToGroup } = require(path.join(__dirname, '../../../scripts/sendMigrationNudge'));

async function runMigrationNudge() {
  logger.info('[MigrationNudge] Posting daily migration message to main group');
  try {
    const result = await sendMigrationToGroup();
    if (result.ok) {
      logger.info('[MigrationNudge] Sent OK', { messageId: result.messageId });
    } else {
      logger.warn('[MigrationNudge] Send failed', {
        error: result.error,
        retryAfter: result.retryAfter,
      });
    }
  } catch (err) {
    logger.error('[MigrationNudge] Unexpected error', { error: err.message, stack: err.stack });
  }
}

function startMigrationNudgeScheduler() {
  if (!cron.validate(NUDGE_CRON)) {
    logger.error('[MigrationNudge] Invalid cron expression', { cron: NUDGE_CRON });
    return;
  }

  cron.schedule(NUDGE_CRON, runMigrationNudge, { timezone: NUDGE_TZ });

  logger.info('[MigrationNudge] Scheduler started', {
    cron: NUDGE_CRON,
    timezone: NUDGE_TZ,
    nextRun: '18:00 America/Bogota daily',
  });
}

module.exports = { startMigrationNudgeScheduler, runMigrationNudge };
