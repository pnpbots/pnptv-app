'use strict';

const { query } = require('../../../config/postgres');
const { getRedis } = require('../../../config/redis');
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
      // FIX 16: Explicit columns instead of SELECT *
      const due = await query(`
        SELECT id, chat_id, text, media_file_id, media_type, parse_mode,
               recurrence_pattern, scheduled_at, next_run_at, run_count, max_runs, retry_count
        FROM group_broadcast_schedules
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
            recurrence_pattern, run_count, max_runs, retry_count } = row;

    // FIX 10: Redis concurrency guard — prevent duplicate sends in multi-instance deployments
    const redis = getRedis();
    const lockKey = `bcast:lock:${id}`;
    const acquired = redis ? await redis.set(lockKey, '1', 'EX', 120, 'NX') : '1';
    if (!acquired) {
      logger.info('[GroupBroadcastScheduler] row already being processed by another instance, skipping', { id });
      return;
    }

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
      // FIX 9: Retry logic for transient Telegram errors
      const code = err.response?.error_code;
      const isTransient = !code || code === 429 || code >= 500;
      const newRetryCount = (retry_count || 0) + 1;
      if (isTransient && newRetryCount < 3) {
        // Retry in 5 minutes
        await query(
          `UPDATE group_broadcast_schedules SET status='scheduled', retry_count=$1, next_run_at=NOW()+INTERVAL '5 minutes', updated_at=NOW() WHERE id=$2`,
          [newRetryCount, id]
        ).catch(() => {});
        logger.warn('[GroupBroadcastScheduler] transient error, will retry', { id, attempt: newRetryCount, error: err.message });
      } else {
        await query(
          `UPDATE group_broadcast_schedules SET status='failed', updated_at=NOW() WHERE id=$1`,
          [id]
        ).catch(() => {});
        logger.error('[GroupBroadcastScheduler] permanent failure', { id, chat_id, error: err.message });
      }
    } finally {
      // FIX 10: Always release the Redis lock
      if (redis) await redis.del(lockKey).catch(() => {});
    }
  }
}

module.exports = GroupBroadcastScheduler;
