'use strict';

const { query } = require('../../../config/postgres');
const logger = require('../../../utils/logger');

const CHECK_INTERVAL_MS = 60_000; // every 60s

function calcNextRun(scheduledAt, pattern) {
  if (!scheduledAt) return null;
  const d = new Date(scheduledAt);
  if (isNaN(d.getTime())) return null;
  switch (pattern) {
    case 'daily':   d.setDate(d.getDate() + 1); break;
    case 'weekly':  d.setDate(d.getDate() + 7); break;
    case 'monthly': d.setMonth(d.getMonth() + 1); break;
    default: return null;
  }
  return d;
}

class GroupBroadcastScheduler {
  constructor() {
    this.interval = null;
    this.isRunning = false;
    this._telegram = null;
  }

  setTelegram(telegram) {
    this._telegram = telegram;
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this._tick();
    this.interval = setInterval(() => this._tick(), CHECK_INTERVAL_MS);
    logger.info('[GroupBroadcastScheduler] Started (60s interval)');
  }

  stop() {
    if (this.interval) clearInterval(this.interval);
    this.isRunning = false;
  }

  async _tick() {
    if (!this._telegram) return;
    try {
      const due = await query(`
        SELECT * FROM group_broadcast_schedules
        WHERE status IN ('scheduled', 'active')
          AND next_run_at <= NOW()
        ORDER BY next_run_at ASC
        LIMIT 20
      `);
      for (const row of due.rows) {
        await this._send(row);
      }
    } catch (err) {
      logger.error('[GroupBroadcastScheduler] tick error', { error: err.message });
    }
  }

  async _send(row) {
    const { id, chat_id, text, media_file_id, media_type, parse_mode,
            recurrence_pattern, run_count, max_runs } = row;
    try {
      const tg = this._telegram;
      const opts = text ? { caption: text, parse_mode: parse_mode || 'Markdown' } : {};

      if (media_file_id && media_type) {
        if (media_type === 'photo')     await tg.sendPhoto(chat_id, media_file_id, opts);
        else if (media_type === 'video') await tg.sendVideo(chat_id, media_file_id, opts);
        else if (media_type === 'animation') await tg.sendAnimation(chat_id, media_file_id, opts);
        else await tg.sendDocument(chat_id, media_file_id, opts);
      } else if (text) {
        await tg.sendMessage(chat_id, text, { parse_mode: parse_mode || 'Markdown' });
      }

      logger.info('[GroupBroadcastScheduler] Sent', { id, chat_id, recurrence_pattern });

      const newRunCount = (run_count || 0) + 1;
      const isOnce = recurrence_pattern === 'once' || !recurrence_pattern;
      const hitMax = max_runs && newRunCount >= max_runs;

      if (isOnce || hitMax) {
        await query(
          `UPDATE group_broadcast_schedules SET status='done', last_run_at=NOW(), run_count=$1, updated_at=NOW() WHERE id=$2`,
          [newRunCount, id]
        );
      } else {
        const next = calcNextRun(row.next_run_at, recurrence_pattern);
        if (!next) {
          logger.error('[GroupBroadcastScheduler] calcNextRun returned null — marking done', { id, recurrence_pattern });
          await query(
            `UPDATE group_broadcast_schedules SET status='done', last_run_at=NOW(), run_count=$1, updated_at=NOW() WHERE id=$2`,
            [newRunCount, id]
          );
        } else {
          await query(
            `UPDATE group_broadcast_schedules SET status='active', last_run_at=NOW(), next_run_at=$1, run_count=$2, updated_at=NOW() WHERE id=$3`,
            [next, newRunCount, id]
          );
        }
      }
    } catch (err) {
      logger.error('[GroupBroadcastScheduler] send failed', { id, chat_id, error: err.message });
      await query(
        `UPDATE group_broadcast_schedules SET status='failed', updated_at=NOW() WHERE id=$1`,
        [id]
      ).catch(() => {});
    }
  }
}

module.exports = GroupBroadcastScheduler;
