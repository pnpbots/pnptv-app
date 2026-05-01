/**
 * PushNotificationService
 * Sends Web Push notifications via the `web-push` npm package.
 *
 * The `web-push` package is optional. If it is not installed the service
 * degrades gracefully: all send methods log a warning and return 0.
 *
 * Required env vars when web-push IS installed:
 *   VAPID_PUBLIC_KEY   — base64url-encoded VAPID public key
 *   VAPID_PRIVATE_KEY  — base64url-encoded VAPID private key
 *   VAPID_SUBJECT      — mailto: or https: URI identifying the sender
 */

'use strict';

const logger = require('../utils/logger');
const { query } = require('../config/postgres');

/** Attempt to load web-push; if missing, webpush stays null. */
let webpush = null;
try {
  webpush = require('web-push');
} catch (_err) {
  logger.warn(
    '[PushNotificationService] web-push package not found. ' +
    'Push notifications are disabled. Install it with: npm install web-push'
  );
}

class PushNotificationService {
  /**
   * Call once at application startup to configure VAPID credentials.
   * Silently skips if web-push is not available.
   */
  static initialize() {
    if (!webpush) return;

    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    const subject = process.env.VAPID_SUBJECT || 'mailto:admin@pnptv.app';

    if (!publicKey || !privateKey) {
      logger.warn('[PushNotificationService] VAPID_PUBLIC_KEY or VAPID_PRIVATE_KEY not set. Push disabled.');
      webpush = null;
      return;
    }

    webpush.setVapidDetails(subject, publicKey, privateKey);
    logger.info('[PushNotificationService] VAPID details configured successfully.');
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Build the web-push payload object.
   * @param {{ title: string, body: string, url?: string, icon?: string, tag?: string }} opts
   * @returns {string} JSON string
   */
  static _buildPayload({ title, body, url, icon, tag }) {
    const payload = {
      title: title || 'PNPtv!',
      body: body || '',
      url: url || '/',
      icon: icon || '/icons/icon-192x192.png',
      badge: '/icons/badge-96x96.png',
    };
    if (tag) payload.tag = tag;
    return JSON.stringify(payload);
  }

  /**
   * Send a push notification to a single subscription row.
   * Removes the subscription from the DB if the endpoint has expired (410).
   *
   * @param {{ id: bigint|string, endpoint: string, auth: string, p256dh: string }} sub
   * @param {string} payloadJson
   * @returns {Promise<boolean>} true if sent successfully, false otherwise
   */
  static async _sendToSubscription(sub, payloadJson) {
    if (!webpush) return false;

    const pushSubscription = {
      endpoint: sub.endpoint,
      keys: {
        auth: sub.auth,
        p256dh: sub.p256dh,
      },
    };

    try {
      // 8s wall-clock cap per push. Without this, a slow FCM/Apple gateway
      // response can hang the surrounding Promise.all batch indefinitely
      // (web-push has no internal timeout). One stuck endpoint should not
      // block delivery to the rest of the audience.
      await Promise.race([
        webpush.sendNotification(pushSubscription, payloadJson, { TTL: 86400 }),
        new Promise((_, reject) =>
          setTimeout(() => reject(Object.assign(new Error('push send timeout'), { statusCode: 408 })), 8_000)
        ),
      ]);
      return true;
    } catch (err) {
      if (err.statusCode === 410 || err.statusCode === 404) {
        // Subscription has expired or is invalid — remove it
        logger.info('[PushNotificationService] Removing expired subscription', { id: sub.id });
        await this.removeSubscription(sub.id);
      } else {
        logger.warn('[PushNotificationService] Failed to send to subscription', {
          id: sub.id,
          status: err.statusCode,
          message: err.message,
        });
      }
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Public send methods
  // ---------------------------------------------------------------------------

  /**
   * Send a push notification to all subscriptions of a specific user.
   *
   * @param {string} userId
   * @param {{ title: string, body: string, url?: string, icon?: string }} opts
   * @returns {Promise<number>} Number of successful deliveries
   */
  static async sendToUser(userId, opts) {
    if (!webpush) return 0;

    try {
      const result = await query(
        'SELECT id, endpoint, auth, p256dh FROM push_subscriptions WHERE user_id = $1',
        [userId]
      );

      if (result.rows.length === 0) return 0;

      const payloadJson = this._buildPayload(opts);
      const results = await Promise.all(
        result.rows.map(sub => this._sendToSubscription(sub, payloadJson))
      );

      return results.filter(Boolean).length;
    } catch (error) {
      logger.error('[PushNotificationService] sendToUser error', { userId, error: error.message });
      return 0;
    }
  }

  /**
   * Send a push notification to every subscription in the database.
   *
   * @param {{ title: string, body: string, url?: string, icon?: string }} opts
   * @returns {Promise<number>} Number of successful deliveries
   */
  static async sendToAll(opts) {
    if (!webpush) return 0;

    try {
      const result = await query(
        `SELECT ps.id, ps.endpoint, ps.auth, ps.p256dh
           FROM push_subscriptions ps
           JOIN users u ON u.id = ps.user_id
          WHERE u.deleted_at IS NULL
            AND u.tier != 'banned'`
      );

      if (result.rows.length === 0) return 0;

      const payloadJson = this._buildPayload(opts);
      let sent = 0;

      // Send in batches of 50 to avoid overwhelming the event loop
      const batchSize = 50;
      for (let i = 0; i < result.rows.length; i += batchSize) {
        const batch = result.rows.slice(i, i + batchSize);
        const batchResults = await Promise.all(
          batch.map(sub => this._sendToSubscription(sub, payloadJson))
        );
        sent += batchResults.filter(Boolean).length;
      }

      logger.info('[PushNotificationService] sendToAll complete', { total: result.rows.length, sent });
      return sent;
    } catch (error) {
      logger.error('[PushNotificationService] sendToAll error', { error: error.message });
      return 0;
    }
  }

  /**
   * Send a push notification to all subscribers whose account tier matches.
   *
   * @param {string} tier  e.g. 'prime', 'free', 'member'
   * @param {{ title: string, body: string, url?: string, icon?: string }} opts
   * @returns {Promise<number>} Number of successful deliveries
   */
  static async sendToTier(tier, opts) {
    if (!webpush) return 0;

    try {
      const result = await query(
        `SELECT ps.id, ps.endpoint, ps.auth, ps.p256dh
           FROM push_subscriptions ps
           JOIN users u ON u.id = ps.user_id
          WHERE LOWER(u.tier) = LOWER($1)`,
        [tier]
      );

      if (result.rows.length === 0) return 0;

      const payloadJson = this._buildPayload(opts);
      let sent = 0;

      const batchSize = 50;
      for (let i = 0; i < result.rows.length; i += batchSize) {
        const batch = result.rows.slice(i, i + batchSize);
        const batchResults = await Promise.all(
          batch.map(sub => this._sendToSubscription(sub, payloadJson))
        );
        sent += batchResults.filter(Boolean).length;
      }

      logger.info('[PushNotificationService] sendToTier complete', { tier, total: result.rows.length, sent });
      return sent;
    } catch (error) {
      logger.error('[PushNotificationService] sendToTier error', { tier, error: error.message });
      return 0;
    }
  }

  /**
   * Send a push notification to a specific list of user IDs.
   *
   * @param {string[]} userIds
   * @param {{ title: string, body: string, url?: string, icon?: string }} opts
   * @returns {Promise<number>} Number of successful deliveries
   */
  static async sendToUsers(userIds, opts) {
    if (!webpush || !Array.isArray(userIds) || userIds.length === 0) return 0;

    try {
      // Use ANY($1::text[]) for safe parameterized array query
      const result = await query(
        `SELECT id, endpoint, auth, p256dh
           FROM push_subscriptions
          WHERE user_id = ANY($1::text[])`,
        [userIds]
      );

      if (result.rows.length === 0) return 0;

      const payloadJson = this._buildPayload(opts);
      let sent = 0;

      const batchSize = 50;
      for (let i = 0; i < result.rows.length; i += batchSize) {
        const batch = result.rows.slice(i, i + batchSize);
        const batchResults = await Promise.all(
          batch.map(sub => this._sendToSubscription(sub, payloadJson))
        );
        sent += batchResults.filter(Boolean).length;
      }

      logger.info('[PushNotificationService] sendToUsers complete', { userCount: userIds.length, sent });
      return sent;
    } catch (error) {
      logger.error('[PushNotificationService] sendToUsers error', { error: error.message });
      return 0;
    }
  }

  // ---------------------------------------------------------------------------
  // Subscription cleanup
  // ---------------------------------------------------------------------------

  /**
   * Remove a push subscription by its primary key.
   *
   * @param {bigint|string|number} id
   * @returns {Promise<void>}
   */
  static async removeSubscription(id) {
    try {
      await query('DELETE FROM push_subscriptions WHERE id = $1', [id]);
    } catch (error) {
      logger.error('[PushNotificationService] removeSubscription error', { id, error: error.message });
    }
  }
}

module.exports = PushNotificationService;
