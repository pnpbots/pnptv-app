'use strict';

const { getRedis } = require('../../../config/redis');
const { query } = require('../../../config/postgres');
const logger = require('../../../utils/logger');

const PING_INTERVAL_MS = 55 * 60 * 1000;  // run every 55 min
const PING_WINDOW_SECONDS = 660;           // ping when TTL ≤ 11 min remaining
const DEDUP_TTL_SECONDS = 50 * 60;        // don't re-ping within 50 min

const ACCEPTING_CALLS_KEY = (id) => `user:${id}:accepting_calls`;
const PING_SENT_KEY = (id) => `avail:ping_sent:${id}`;

class CreatorAvailabilityPingScheduler {
  constructor() {
    this.interval = null;
    this.isRunning = false;
    this.isProcessing = false;
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.runChecks();
    this.interval = setInterval(() => this.runChecks(), PING_INTERVAL_MS);
    logger.info('Creator availability ping scheduler started (55 min interval)');
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
      this.isRunning = false;
      logger.info('Creator availability ping scheduler stopped');
    }
  }

  async runChecks() {
    if (this.isProcessing) return;
    this.isProcessing = true;
    try {
      await this._pingExpiring();
    } catch (err) {
      logger.error('[availPingScheduler] runChecks error', { error: err.message });
    } finally {
      this.isProcessing = false;
    }
  }

  async _pingExpiring() {
    const redis = getRedis();
    if (!redis) return;

    // SCAN for all accepting_calls keys
    const keys = [];
    let cursor = '0';
    do {
      const [nextCursor, batch] = await redis.scan(
        cursor, 'MATCH', 'user:*:accepting_calls', 'COUNT', '100'
      );
      cursor = nextCursor;
      keys.push(...batch);
    } while (cursor !== '0');

    if (keys.length === 0) return;

    // Filter to those with TTL within the ping window, skipping recently pinged
    const toNotify = [];
    for (const key of keys) {
      const ttl = await redis.ttl(key);
      if (ttl <= 0 || ttl > PING_WINDOW_SECONDS) continue;

      const userId = key.slice('user:'.length, -':accepting_calls'.length);
      const acquired = await redis.set(PING_SENT_KEY(userId), '1', 'EX', DEDUP_TTL_SECONDS, 'NX');
      if (!acquired) continue;
      toNotify.push(userId);
    }

    if (toNotify.length === 0) return;

    const { rows: creators } = await query(
      `SELECT id, telegram, username, first_name
       FROM users
       WHERE id = ANY($1::text[]) AND creator_status = 'active'`,
      [toNotify]
    );

    for (const creator of creators) {
      await this._sendPing(creator);
    }

    logger.info(`[availPingScheduler] Pinged ${creators.length} creator(s) for expiring availability`);
  }

  async _sendPing(creator) {
    const userId = String(creator.id);
    const name = creator.first_name || creator.username || 'Creator';
    const appUrl = process.env.APP_PUBLIC_URL || 'https://pnptv.app';

    // Telegram DM with renewal buttons
    try {
      const { getBotInstance } = require('../bot');
      const bot = getBotInstance();
      if (bot && creator.telegram) {
        await bot.telegram.sendMessage(
          creator.telegram,
          `⏰ ¿Sigues disponible para llamadas, ${name}?\n\nTu ventana de disponibilidad está a punto de expirar.`,
          {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [[
                { text: '💚 Sí, 60 min más', callback_data: `avail_ping_yes:${userId}` },
                { text: '🔴 Ya terminé', callback_data: `avail_ping_no:${userId}` },
              ]],
            },
          }
        );
      }
    } catch (err) {
      const code = err.response?.error_code;
      if (code !== 403 && code !== 400) {
        logger.warn('[availPingScheduler] Telegram DM failed', { userId, error: err.message });
      }
    }

    // In-app push notification
    try {
      const PushNotificationService = require('../../../services/pushNotificationService');
      await PushNotificationService.sendToUser(userId, {
        title: '⏰ ¿Sigues disponible para llamadas?',
        body: 'Tu ventana está a punto de expirar. Renuévala fácilmente.',
        url: `${appUrl}/creators/availability`,
        tag: `avail-ping-${userId}`,
      });
    } catch (err) {
      logger.warn('[availPingScheduler] Push notification failed', { userId, error: err.message });
    }
  }
}

module.exports = CreatorAvailabilityPingScheduler;
